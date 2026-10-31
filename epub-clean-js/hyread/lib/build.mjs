import { readFile, writeFile, mkdir, mkdtemp, unlink, lstat, link, rename } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DOMParser } from 'linkedom';
import { XMLParser } from 'fast-xml-parser';
import { readEpub, writeEpub } from '../../src/core/zip-io.js';
import { validateOutput } from '../../src/core/validator.js';
import { XHTML_ATTR_RE } from '../../src/core/patchers.js';
import { loadSession, validateSession } from './session.mjs';
import { safeJoin, safeRelativePath } from './paths.mjs';
import { validateCapture, itemBaseFor, resourceHref } from './artifacts.mjs';
import { inspectXhtml, normalizeText, applyApprovedCorrections } from './content.mjs';
import { cssReferences, assertWellFormedXml, xmlMarkupTokens } from './syntax.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const escapeXml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/>/g, '&gt;');
const array = (v) => v === undefined ? [] : Array.isArray(v) ? v : [v];
const CSS_TEXT = ['style-reset.css', 'style-standard.css', 'style-advance.css', 'book-style.css', 'style-bc-kadokawa.css', 'style-check.css'];
const CSS_IMG = ['style-reset.css', 'fixed-layout-jp.css'];
const FIXED_LABELS = { 'xhtml/p-cover.xhtml': '封面', 'xhtml/p-titlepage.xhtml': '書名頁', 'xhtml/p-toc-001.xhtml': '目次', 'xhtml/p-001.xhtml': '引言', 'xhtml/p-colophon.xhtml': '版權頁' };
const stripHdf = (xml) => xml.replace(/[ \t]*<meta\b(?=[^>]*\bproperty\s*=\s*(["'])hdf\1)[^>]*(?:\/>|>[\s\S]*?<\/meta>)\s*\n?/gi, '');

function assertConfig(config, session) {
  if (config.volume !== session.volume || config.assetId !== session.assetId || config.bookTitle !== session.title) throw new Error('Config belongs to another session');
}

async function readVerifiedResource(config, session, href) {
  const path = `${session.resourceRoot}/ebookservice/epub/${session.assetId}/item/${href}`;
  const bytes = await readFile(await safeJoin(config.workDir, path));
  const expected = session.resources[href];
  if (!expected || bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) throw new Error(`Resource integrity mismatch: ${href}`);
  return bytes;
}

function imageStylesheet(name, entries, seen = new Set()) {
  if (posix.basename(name).toLowerCase() === 'fixed-layout-jp.css') return true;
  if (seen.has(name)) return false;
  seen.add(name);
  if (!entries[name]) throw new Error(`Missing stylesheet dependency: ${name}`);
  return cssReferences(entries[name].toString('utf8')).imports.some((value) => imageStylesheet(resolveReference(value, name).path, entries, seen));
}

function stylesheetTarget(value, name, session) {
  if (session && value.startsWith(itemBaseFor(session))) return `item/${resourceHref(value, session)}`;
  return resolveReference(value, name).path;
}

function cleanXhtml(html, href, session, entries) {
  assertWellFormedXml(html);
  const tokens = xmlMarkupTokens(html), stack = [], ends = new Map(), edits = [];
  for (const token of tokens) {
    if (token.type === 'open') {
      if (token.selfClosing) ends.set(token.start, token.end);
      else stack.push(token);
    } else if (token.type === 'close') ends.set(stack.pop().start, token.end);
  }
  const imageOnly = tokens.some((token) => token.type === 'open' && token.name.toLowerCase() === 'svg') && !inspectXhtml(html).bodyText;
  let removed = false, skipUntil = -1;
  for (const token of tokens) {
    if (token.type !== 'open' || token.start < skipUntil) continue;
    const tag = token.name.toLowerCase(), attributes = new Map(token.attributes.map((attribute) => [attribute.name, attribute]));
    const source = attributes.get('href')?.value;
    let remove = tag === 'base' || (tag === 'link' && source?.startsWith('blob:')) || (tag === 'style' && attributes.get('xmlns')?.value === '');
    if (!remove && !imageOnly && tag === 'link' && source && (attributes.get('rel')?.value ?? '').toLowerCase().split(/\s+/).includes('stylesheet') && imageStylesheet(stylesheetTarget(source, `item/${href}`, session), entries)) {
      remove = true; removed = true;
    }
    if (remove) {
      skipUntil = ends.get(token.start); edits.push({ start: token.start, end: skipUntil, value: '' }); continue;
    }
    for (const attribute of token.attributes) {
      if (attribute.name === 'style' && (tag === 'html' || tag === 'body' || (tag === 'div' && attributes.get('class')?.value === 'main'))) edits.push({ ...attribute, value: '' });
      else if (['src', 'href', 'xlink:href'].includes(attribute.name) && attribute.value.startsWith(itemBaseFor(session))) {
        const url = new URL(attribute.value);
        if (url.search) throw new Error('Query in same-book resource dependency');
        const target = resourceHref(url.href.split('#')[0], session);
        const value = (posix.relative(posix.dirname(href), target) || posix.basename(target)) + url.hash;
        edits.push({ ...attribute, value: `${attribute.name}=${attribute.quote}${escapeXml(value).replace(/'/g, '&apos;')}${attribute.quote}` });
      }
    }
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) html = html.slice(0, edit.start) + edit.value + html.slice(edit.end);
  const document = new DOMParser().parseFromString(html, 'text/html');
  const existing = new Set(Array.from(document.querySelectorAll('link[href]'), (node) => new URL(node.getAttribute('href'), itemBaseFor(session) + href).href));
  const candidates = (imageOnly ? CSS_IMG : CSS_TEXT).map((name) => session.manifest.find((item) => item.mediaType === 'text/css' && posix.basename(item.href) === name)).filter(Boolean);
  const css = candidates.filter((item) => imageOnly || !imageStylesheet(`item/${item.href}`, entries));
  const links = css.filter((item) => !existing.has(itemBaseFor(session) + item.href)).map((item) => `<link rel="stylesheet" type="text/css" href="${escapeXml(posix.relative(posix.dirname(href), item.href))}"/>`).join('\n');
  const hasExisting = Array.from(document.querySelectorAll('link[href]')).some((node) => (node.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet'));
  if (!imageOnly && (removed || candidates.length) && !hasExisting && !links) throw new Error(`No safe text stylesheet after removing image-only CSS dependency: ${href}`);
  const cleanedTokens = xmlMarkupTokens(html);
  if (links) {
    const head = cleanedTokens.find((token) => token.type === 'close' && token.name.toLowerCase() === 'head');
    if (!head) throw new Error('XHTML has no head for stylesheets');
    html = html.slice(0, head.start) + links + '\n' + html.slice(head.start);
  }
  if (!tokens.some((token) => token.type === 'pi' && /^xml(?:[ \t\r\n]|$)/.test(token.value))) {
    const declaration = '<?xml version="1.0" encoding="UTF-8"?>\n' + (tokens.some((token) => token.type === 'doctype') ? '' : '<!DOCTYPE html>\n');
    html = html.startsWith('\ufeff') ? '\ufeff' + declaration + html.slice(1) : declaration + html;
  }
  return html;
}

function labelsFor(session, capture) {
  const hrefs = session.spine.map((item) => item.href);
  let divider = hrefs.findIndex((href) => /p-toc/.test(href));
  if (divider < 0) divider = hrefs.findIndex((href) => /p-\d{3}\.xhtml$/.test(href));
  let front = 0, back = 0;
  return hrefs.map((href, index) => {
    if (FIXED_LABELS[href]) return FIXED_LABELS[href];
    if (/p-fmatter-/.test(href)) return divider >= 0 && index < divider ? `彩頁插圖 ${++front}` : `卷末插圖 ${++back}`;
    const html = capture.data[capture.order[index]];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const heading = Array.from(doc.querySelectorAll('p')).find((node) => /gfont/.test(node.outerHTML));
    return normalizeText(heading?.textContent) || inspectXhtml(html).bodyText.slice(0, 24) || href;
  });
}

function navigation(session, capture, navHref) {
  const labels = labelsFor(session, capture);
  const items = session.spine.map((item, index) => `<li><a href="${escapeXml(posix.relative(posix.dirname(navHref), item.href))}">${escapeXml(labels[index])}</a></li>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-TW" xml:lang="zh-TW"><head><meta charset="UTF-8"/><title>${escapeXml(session.title)} — 目次</title></head><body><nav epub:type="toc" id="toc"><h1>目次</h1><ol>${items}</ol></nav></body></html>`;
}

function resolveReference(value, from) {
  const url = new URL(value, `https://epub.invalid/${from}`);
  if (url.origin !== 'https://epub.invalid' || url.search) throw new Error(`Remote or query dependency: ${value}`);
  return { path: safeRelativePath(decodeURIComponent(url.pathname.slice(1))), fragment: decodeURIComponent(url.hash.slice(1)) };
}

function bodyWithImagePositions(html, src) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  function text(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return '';
    if (['img', 'image'].includes(node.localName.toLowerCase())) {
      const href = node.getAttribute('src') ?? node.getAttribute('href') ?? node.getAttribute('xlink:href') ?? '';
      return `[image:${new URL(href, src).href}]`;
    }
    return Array.from(node.childNodes, text).join('');
  }
  return normalizeText(text(doc.querySelector('body')));
}

function inspectDependencies(name, text, entries, issues) {
  const styles = name.endsWith('.css') ? [text] : [];
  const references = new Set();
  const check = (value, hyperlink = false) => {
    if (value) references.add(value);
    if (!value || value.startsWith('data:') || (hyperlink && /^(?:https?:|mailto:|tel:)/i.test(value))) return;
    try {
      const target = resolveReference(value, name);
      if (!entries[target.path]) issues.push(`${name}: missing dependency ${value}`);
      else if (target.fragment && /\.(?:xhtml|html|svg)$/.test(target.path)) {
        const doc = new DOMParser().parseFromString(entries[target.path].toString('utf8'), 'application/xml');
        if (!Array.from(doc.querySelectorAll('[id]')).some((node) => node.getAttribute('id') === target.fragment)) issues.push(`${name}: missing fragment ${value}`);
      }
    } catch (error) { issues.push(`${name}: dependency: ${error.message}`); }
  };
  if (/\.(?:xhtml|html|svg)$/.test(name)) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    for (const node of doc.querySelectorAll('*')) {
      for (const attr of ['src', 'href', 'xlink:href', 'poster', 'data']) {
        if (node.hasAttribute(attr)) check(node.getAttribute(attr), node.localName === 'a' && attr === 'href');
      }
      if (node.hasAttribute('srcset')) for (const source of node.getAttribute('srcset').split(',')) check(source.trim().split(/\s+/)[0]);
      if (node.localName === 'style') styles.push(node.textContent);
      if (node.hasAttribute('style')) styles.push(node.getAttribute('style'));
      let svg = node;
      while (svg && svg.localName?.split(':').at(-1) !== 'svg') svg = svg.parentElement;
      if (svg) for (const attribute of ['fill', 'stroke', 'filter', 'clip-path', 'mask', 'marker', 'marker-start', 'marker-mid', 'marker-end', 'cursor', 'color-profile']) {
        if (node.hasAttribute(attribute)) styles.push(node.getAttribute(attribute));
      }
    }
  }
  for (const style of styles) {
    try { for (const value of cssReferences(style).urls) check(value); }
    catch (error) { issues.push(`${name}: ${error.message}`); }
  }
  return references;
}

function checkTextStyles(html, name, entries, issues) {
  const doc = new DOMParser().parseFromString(html, 'application/xml');
  try {
    const names = Array.from(doc.querySelectorAll('link[href]')).filter((node) => (node.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet')).map((node) => stylesheetTarget(node.getAttribute('href'), name));
    for (const node of doc.querySelectorAll('style')) for (const value of cssReferences(node.textContent).imports) names.push(stylesheetTarget(value, name));
    for (const target of names) if (imageStylesheet(target, entries)) issues.push(`Text page loads image-only CSS dependency: ${name} -> ${target}`);
  } catch (error) { issues.push(`${name}: stylesheet dependency: ${error.message}`); }
}

export function classifyValidatorReferences(entries, brokenLinks, dependencyReferences = new Map()) {
  const inert = new Map(), active = new Set();
  for (const [name, bytes] of Object.entries(entries)) {
    if (!/\.(?:xhtml|html)$/.test(name)) continue;
    const xml = bytes.toString('utf8');
    let tokens;
    try { assertWellFormedXml(xml); tokens = xmlMarkupTokens(xml); }
    catch { continue; }
    const spans = tokens.filter((token) => token.type === 'comment' || token.type === 'cdata');
    for (const match of xml.matchAll(XHTML_ATTR_RE)) {
      const value = match[3], target = posix.normalize(`${posix.dirname(name)}/${value.split('#', 1)[0]}`);
      const report = `${name}: 引用 ${value} → ${target} 不存在`;
      const span = spans.find((span) => match.index >= span.start && match.index + match[0].length <= span.end);
      let hasDependency = false;
      for (const reference of dependencyReferences.get(name) ?? []) {
        if (reference === value) { hasDependency = true; break; }
        try {
          const actual = new URL(reference, `https://epub.invalid/${name}`), candidate = new URL(value, `https://epub.invalid/${name}`);
          actual.hash = ''; candidate.hash = '';
          if (decodeURI(actual.href) === decodeURI(candidate.href)) { hasDependency = true; break; }
        } catch { hasDependency = true; break; }
      }
      if (!span || hasDependency) active.add(report);
      else {
        const records = inert.get(report) ?? [];
        records.push({ file: name, reference: value, regionType: span.type, start: match.index, end: match.index + match[0].length });
        inert.set(report, records);
      }
    }
  }
  const retained = [], ignored = new Map();
  for (const report of brokenLinks) {
    if (!inert.has(report) || active.has(report)) retained.push(report);
    else for (const record of inert.get(report)) ignored.set(`${record.file}\u0000${record.start}`, record);
  }
  return { brokenLinks: retained, ignoredNonElementReferences: [...ignored.values()] };
}

export async function checkBuiltEpub({ config, session, capture, epubPath }) {
  validateSession(session); assertConfig(config, session); validateCapture(capture, session);
  const issues = [], allowedCorrections = [];
  const stats = { spine: session.spine.length, xhtml: 0, resources: 0, textCharacters: 0, ruby: 0, images: 0 };
  let rawTextEqual = true;
  let entries, names, validation;
  try {
    const epub = await readEpub(epubPath); entries = epub.entries; names = epub.names;
    validation = await validateOutput(epubPath);
    issues.push(...validation.issues, ...validation.orphans.map((name) => `Orphan file: ${name}`));
    if (!validation.ok && !validation.issues.length) issues.push('Validator failed');
  } catch (error) { return { ok: false, issues: [`EPUB validation failed: ${error.message}`], allowedCorrections, rawTextEqual: false, stats, ignoredNonElementReferences: [] }; }
  if (new Set(names).size !== names.length) issues.push('Duplicate ZIP entry');
  const dependencyReferences = new Map();
  for (const name of names) {
    try { if (safeRelativePath(name) !== name) issues.push(`Noncanonical ZIP path: ${name}`); }
    catch { issues.push(`Unsafe ZIP path: ${name}`); }
    const bytes = entries[name];
    if (/\.(?:xhtml|html|xml|opf|svg|ncx)$/.test(name)) {
      try { assertWellFormedXml(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch (error) { issues.push(`Invalid XML: ${name}: ${error.message}`); }
    }
    if (/\.(?:xhtml|html|css|svg)$/.test(name)) dependencyReferences.set(name, inspectDependencies(name, bytes.toString('utf8'), entries, issues));
  }
  const references = classifyValidatorReferences(entries, validation.brokenLinks, dependencyReferences);
  stats.ignoredInertBrokenLinks = validation.brokenLinks.length - references.brokenLinks.length;
  issues.push(...references.brokenLinks);
  const opfBytes = entries['item/standard.opf'];
  if (!opfBytes) issues.push('Missing output OPF');
  else {
    try {
      const sourceOpf = await readVerifiedResource(config, session, 'standard.opf');
      if (!opfBytes.equals(Buffer.from(stripHdf(sourceOpf.toString('utf8'))))) issues.push('Output OPF differs beyond hdf removal');
      const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseAttributeValue: false }).parse(opfBytes.toString('utf8')).package;
      const manifest = array(parsed.manifest?.item).map((v) => ({ id: v['@_id'], href: safeRelativePath(v['@_href']), mediaType: v['@_media-type'], properties: String(v['@_properties'] ?? '').split(/\s+/).filter(Boolean) }));
      const spine = array(parsed.spine?.itemref).map((v) => ({ id: v['@_idref'], href: manifest.find((item) => item.id === v['@_idref'])?.href }));
      if (JSON.stringify(manifest) !== JSON.stringify(session.manifest)) issues.push('Output manifest differs from session');
      if (JSON.stringify(spine) !== JSON.stringify(session.spine)) issues.push('Output spine differs from session');
      if (/<meta\b[^>]*\bproperty\s*=\s*(["'])hdf\1/i.test(opfBytes.toString('utf8'))) issues.push('Private hdf metadata remains');
    } catch (error) { issues.push(`Invalid output OPF: ${error.message}`); }
  }
  const navs = session.manifest.filter((item) => item.properties.includes('nav'));
  if (navs.length !== 1) issues.push('Exactly one navigation document is required');
  for (const nav of navs) {
    const bytes = entries[`item/${nav.href}`];
    if (!bytes) { issues.push(`Missing nav: ${nav.href}`); continue; }
    const doc = new DOMParser().parseFromString(bytes.toString('utf8'), 'application/xml');
    const toc = Array.from(doc.querySelectorAll('nav')).find((node) => (node.getAttribute('epub:type') ?? '').split(/\s+/).includes('toc'));
    try {
      const hrefs = Array.from(toc?.querySelectorAll('a[href]') ?? [], (node) => resolveReference(node.getAttribute('href'), `item/${nav.href}`).path);
      if (JSON.stringify(hrefs) !== JSON.stringify(session.spine.map((item) => `item/${item.href}`))) issues.push('Nav targets differ from spine order');
    } catch (error) { issues.push(`Invalid nav targets: ${error.message}`); }
  }
  for (const item of session.manifest) {
    const bytes = entries[`item/${item.href}`];
    if (!bytes) { issues.push(`Missing manifest resource: ${item.href}`); if (session.spine.some((v) => v.href === item.href)) rawTextEqual = false; continue; }
    if (item.mediaType !== 'application/xhtml+xml') {
      const expected = session.resources[item.href];
      if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) issues.push(`Resource bytes differ: ${item.href}`);
      stats.resources++;
      continue;
    }
    stats.xhtml++;
    if (item.properties.includes('nav') && !session.spine.some((v) => v.href === item.href)) continue;
    const src = capture.order.find((value) => resourceHref(value, session) === item.href);
    if (!src) { issues.push(`Uncaptured non-nav XHTML: ${item.href}`); continue; }
    const correction = applyApprovedCorrections(capture.data[src], { ...config, href: item.href });
    allowedCorrections.push(...correction.corrections);
    try {
      const raw = inspectXhtml(capture.data[src]), expected = inspectXhtml(correction.html), actual = inspectXhtml(bytes.toString('utf8'));
      if (raw.bodyText !== actual.bodyText) rawTextEqual = false;
      if (expected.bodyText !== actual.bodyText) issues.push(`Body text differs: ${item.href}`);
      for (const field of ['blocks', 'ruby']) if (JSON.stringify(expected[field]) !== JSON.stringify(actual[field])) issues.push(`${field} differ: ${item.href}`);
      const images = (v) => v.images.map((image) => ({ ...image, src: new URL(image.src, src).href }));
      if (JSON.stringify(images(expected)) !== JSON.stringify(images(actual))) issues.push(`Images differ: ${item.href}`);
      if (bodyWithImagePositions(correction.html, src) !== bodyWithImagePositions(bytes.toString('utf8'), src)) issues.push(`Image/text positions differ: ${item.href}`);
      const links = (v) => v.links.map((anchor) => ({ ...anchor, href: new URL(anchor.href, src).href }));
      if (JSON.stringify(links(expected)) !== JSON.stringify(links(actual))) issues.push(`Body links differ: ${item.href}`);
      if (actual.bodyText) checkTextStyles(bytes.toString('utf8'), `item/${item.href}`, entries, issues);
      stats.textCharacters += actual.bodyText.length; stats.ruby += actual.ruby.length; stats.images += actual.images.length;
    } catch (error) { issues.push(`XHTML inspection failed ${item.href}: ${error.message}`); rawTextEqual = false; }
  }
  return { ok: issues.length === 0, issues, allowedCorrections, rawTextEqual, stats, ignoredNonElementReferences: references.ignoredNonElementReferences };
}

export async function buildHyreadEpub(config, { replace = false } = {}) {
  const loaded = await loadSession(config.sessionPath, { outputPath: config.outputPath });
  assertConfig(config, loaded.session);
  const session = loaded.session;
  config = { ...loaded.config, projectRoot: config.projectRoot, outputPath: config.outputPath };
  const capture = validateCapture(JSON.parse(await readFile(await safeJoin(config.workDir, 'grab_xml.json'), 'utf8')), session);
  try {
    await lstat(config.outputPath);
    if (!replace) throw new Error(`Output already exists: ${config.outputPath}`);
    if ((await lstat(config.outputPath)).isSymbolicLink()) throw new Error('Output is a symbolic link');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const navs = session.manifest.filter((item) => item.properties.includes('nav'));
  if (navs.length !== 1) throw new Error('Exactly one navigation XHTML is required');
  const hrefs = new Set(session.spine.map((item) => item.href));
  for (const item of session.manifest) if (item.mediaType === 'application/xhtml+xml' && !hrefs.has(item.href) && !item.properties.includes('nav')) throw new Error(`Uncaptured non-spine XHTML: ${item.href}`);
  await mkdir(await safeJoin(config.workDir, 'epub_build'), { recursive: true });
  const buildDir = await mkdtemp(join(config.buildDir, 'build-'));
  const files = {
    mimetype: Buffer.from('application/epub+zip'),
    'META-INF/container.xml': Buffer.from('<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="item/standard.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'item/standard.opf': Buffer.from(stripHdf((await readVerifiedResource(config, session, 'standard.opf')).toString('utf8'))),
  };
  for (const item of session.manifest) if (item.mediaType !== 'application/xhtml+xml') files[`item/${item.href}`] = await readVerifiedResource(config, session, item.href);
  for (const item of session.manifest) {
    if (item.mediaType !== 'application/xhtml+xml') continue;
    if (item.properties.includes('nav') && !hrefs.has(item.href)) files[`item/${item.href}`] = Buffer.from(navigation(session, capture, item.href));
    else {
      const src = capture.order.find((value) => resourceHref(value, session) === item.href);
      const { html } = applyApprovedCorrections(capture.data[src], { ...config, href: item.href });
      files[`item/${item.href}`] = Buffer.from(cleanXhtml(html, item.href, session, files));
    }
  }
  for (const [name, bytes] of Object.entries(files)) {
    const destination = await safeJoin(buildDir, name);
    await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes, { flag: 'wx' });
  }
  await mkdir(dirname(config.outputPath), { recursive: true });
  const temporary = join(dirname(config.outputPath), `.${randomUUID()}.hyread.tmp.epub`);
  try {
    await writeEpub(temporary, files);
    const report = await checkBuiltEpub({ config, session, capture, epubPath: temporary });
    if (!report.ok) {
      const error = new Error(`Built EPUB failed validation: ${report.issues.join('; ')}; buildDir=${buildDir}`);
      error.report = report; error.buildDir = buildDir; throw error;
    }
    const digest = sha256(await readFile(temporary));
    if (replace) await rename(temporary, config.outputPath);
    else await link(temporary, config.outputPath);
    return { outputPath: config.outputPath, buildDir, report, sha256: digest };
  } finally { await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
}
