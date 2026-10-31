import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DOMParser } from 'linkedom';
import { readEpub } from '../../src/core/zip-io.js';
import { validateCapture, validateAuditEnvelope, resourceHref } from './artifacts.mjs';
import { inspectXhtml, normalizeText, applyApprovedCorrections } from './content.mjs';
import { checkBuiltEpub } from './build.mjs';
import { sanitizeEvidence } from './reports.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const blockSelector = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,div';
const check = (status = 'not-run') => ({ status, issues: [] });
const labelKey = (value) => {
  const key = value.normalize('NFKC').replace(/\s+/gu, '');
  return ({ 書封: '封面', 目錄: '目次' })[key] ?? key;
};

function observations(html, src) {
  const inspected = inspectXhtml(html);
  const body = new DOMParser().parseFromString(html, 'text/html').querySelector('body');
  const blocks = Array.from(body.querySelectorAll(blockSelector)).filter((node) => !node.querySelector(blockSelector));
  function semantic(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return '';
    if (['img', 'image'].includes(node.localName.toLowerCase())) return `[image:${new URL(node.getAttribute('src') ?? node.getAttribute('href') ?? node.getAttribute('xlink:href'), src).href}]`;
    return Array.from(node.childNodes, semantic).join('');
  }
  return {
    ...inspected,
    blocks: inspected.blocks.map((block, index) => ({ ...block, semantic: normalizeText(semantic(blocks[index])) })),
    images: Array.from(body.querySelectorAll('img,image'), (node, index) => ({ ...inspected.images[index], src: new URL(inspected.images[index].src, src).href, paragraphIndex: blocks.findIndex((block) => block.contains(node)) })),
    links: inspected.links.map((link) => ({ ...link, href: new URL(link.href, src).href })),
  };
}

function compareObservations(expected, actual, add) {
  if (expected.bodyText !== actual.bodyText) add('bodyText differs');
  for (const field of ['blocks', 'images', 'ruby', 'links']) {
    if (expected[field].length !== actual[field].length) add(`${field} count differs: expected ${expected[field].length}, actual ${actual[field].length}`);
    for (let index = 0; index < Math.max(expected[field].length, actual[field].length); index++) {
      if (!equal(expected[field][index], actual[field][index])) add(`${field}[${index}] differs`);
    }
  }
}

function auditObservations(record) {
  return {
    bodyText: record.bodyText,
    blocks: record.paragraphs.map(({ tag, id, text, semantic }) => ({ tag, id, text, semantic })),
    images: record.images.map(({ tag, src, alt, paragraphIndex }) => ({ tag, src, alt, paragraphIndex })),
    ruby: record.ruby,
    links: record.bodyLinks.map((link) => ({ ...link, href: new URL(link.href, record.src).href })),
  };
}

function navigationEntries(entries, session, base) {
  const nav = session.manifest.find((item) => item.properties.includes('nav'));
  if (!nav || !entries[`item/${nav.href}`]) throw new Error('Missing navigation document');
  const doc = new DOMParser().parseFromString(entries[`item/${nav.href}`].toString('utf8'), 'text/html');
  const toc = Array.from(doc.querySelectorAll('nav')).find((node) => (node.getAttribute('epub:type') ?? '').split(/\s+/u).includes('toc'));
  if (!toc) throw new Error('Missing TOC navigation');
  return Array.from(toc.querySelectorAll('a[href]'), (node) => ({ label: normalizeText(node.textContent), src: new URL(node.getAttribute('href'), base + nav.href).href }));
}

function compareToc(audit, entries, session, base, add) {
  const output = navigationEntries(entries, session, base);
  // 官方菜单可省略结构页；正文目标和重名条目仍按出现次序逐项对应。
  let cursor = 0;
  const matched = new Set();
  for (const [index, entry] of audit.tocEntries.entries()) {
    let found = -1;
    for (let i = cursor; i < output.length; i++) {
      if (output[i].src === entry.src && labelKey(output[i].label) === labelKey(entry.label)) { found = i; break; }
    }
    if (found < 0) add(`TOC entry ${index + 1} label/target/order differs: ${resourceHref(entry.src, session)}`);
    else { cursor = found + 1; matched.add(found); }
  }
  for (const [index, entry] of output.entries()) {
    if (matched.has(index)) continue;
    const href = resourceHref(entry.src, session);
    const record = audit.records.find((v) => v.src === entry.src);
    const structural = !record?.bodyText || /(?:^|\/)(?:p-)?(?:cover|titlepage|toc(?:-\d+)?|colophon|fmatter-\d+)\.xhtml$/iu.test(href)
      || href === 'xhtml/p-001.xhtml';
    if (!structural) add(`TOC chapter missing from live menu: ${href}`);
  }
}

export async function verifyHyreadEpub({ config, session, capture, audit, epubPath, requireLive = false }) {
  const report = {
    schemaVersion: 1, ok: false, artifact: { path: epubPath, sha256: null },
    checks: { structure: check(), capture: check(), live: check(), semantic: check() },
    allowedCorrections: [], rawTextEqual: false, stats: {}, perDocument: [], ignoredNonElementReferences: [],
  };
  const fail = (name, issue) => { report.checks[name].issues.push(issue); report.checks[name].status = 'failed'; };
  try {
    report.artifact.sha256 = sha256(await readFile(epubPath));
  } catch (error) { fail('structure', `Cannot read EPUB: ${error.message}`); }
  try {
    validateCapture(capture, session);
    if (config.volume !== session.volume || config.assetId !== session.assetId || config.bookTitle !== session.title) throw new Error('Config belongs to another session');
    report.checks.capture.status = 'passed';
  } catch (error) { fail('capture', `Capture validation failed: ${error.message}`); }
  let built, entries;
  if (report.checks.capture.status === 'passed' && report.artifact.sha256 !== null) {
    try {
      built = await checkBuiltEpub({ config, session, capture, epubPath });
      report.checks.structure.status = 'passed';
      report.allowedCorrections = built.allowedCorrections;
      report.rawTextEqual = built.rawTextEqual;
      report.stats = { ...built.stats, liveDocuments: 0, liveBlocks: 0, livePages: 0 };
      report.ignoredNonElementReferences = built.ignoredNonElementReferences;
      for (const issue of built.issues) {
        const contentIssue = /^(?:Body text|blocks|ruby|Images|Image\/text positions|Body links) differ/u.test(issue);
        fail(contentIssue ? 'capture' : 'structure', issue);
      }
      ({ entries } = await readEpub(epubPath));
    } catch (error) { fail('structure', `EPUB verification failed: ${error.message}`); }
  }
  let auditValid = false;
  if (audit !== undefined && audit !== null) {
    try { validateAuditEnvelope(audit, session); auditValid = true; report.checks.live.status = 'passed'; report.restoration = audit.meta.restoration; }
    catch (error) { fail('live', `Audit validation failed: ${error.message}`); }
  } else if (requireLive) report.checks.live.issues.push('Live audit is required but was not provided');
  if (report.checks.capture.status !== 'not-run' && entries) {
    for (const [index, item] of session.spine.entries()) {
      const src = capture.order[index];
      const documentReport = { href: item.href, src, spineIndex: index, captureStatus: 'passed', liveStatus: auditValid ? 'passed' : 'not-run', rawTextEqual: false, issues: [] };
      report.perDocument.push(documentReport);
      const add = (kind, issue) => {
        documentReport[`${kind}Status`] = 'failed';
        documentReport.issues.push({ check: kind, issue, evidence: { src, spineIndex: index } });
        fail(kind, `${item.href}: ${issue}`);
      };
      try {
        const raw = observations(capture.data[src], src);
        const correction = applyApprovedCorrections(capture.data[src], { volume: session.volume, assetId: session.assetId, href: item.href });
        const output = entries[`item/${item.href}`];
        if (!output) add('capture', 'Missing EPUB document');
        else {
          const actual = observations(output.toString('utf8'), src);
          documentReport.rawTextEqual = raw.bodyText === actual.bodyText;
          compareObservations(observations(correction.html, src), actual, (issue) => add('capture', issue));
        }
        if (auditValid) {
          const record = audit.records.find((v) => v.spineIndex === index);
          compareObservations(raw, auditObservations(record), (issue) => add('live', issue));
          report.stats.liveDocuments++; report.stats.liveBlocks += record.paragraphs.length; report.stats.livePages += record.pageCount;
          documentReport.stats = { blocks: record.paragraphs.length, images: record.images.length, pages: record.pageCount, textCharacters: record.bodyText.length };
          if (record.bodyChanges.length || record.pageChecks.some((page) => !page.bodyUnchanged)) add('live', 'Body changed while paging');
          if (record.unseenTextBlocks.length) add('live', `Unseen text blocks: ${record.unseenTextBlocks.join(',')}`);
          const visible = new Set(record.pageChecks.flatMap((page) => page.visibleBlocks));
          const unseen = record.paragraphs.filter((p) => p.text && !visible.has(p.index)).map((p) => p.index);
          if (unseen.length) add('live', `Text blocks lack page coverage: ${unseen.join(',')}`);
          for (const error of record.errors) add('live', `Reader loading error: ${error}`);
          for (const image of record.images) if (image.tag === 'img' && (!image.complete || image.naturalWidth <= 0)) add('live', `Image failed to load: ${resourceHref(image.src, session)}`);
        }
      } catch (error) { add(auditValid ? 'live' : 'capture', `Document inspection failed: ${error.message}`); }
    }
  }
  if (auditValid) {
    for (const issue of audit.issues) fail('live', `Audit issue ${issue.type}: ${resourceHref(issue.src, session)}${issue.page === undefined ? '' : ` page ${issue.page}`}`);
    if (!entries) fail('live', 'EPUB evidence unavailable for live comparison');
    else {
      try { compareToc(audit, entries, session, config.itemBase, (issue) => fail('live', issue)); }
      catch (error) { fail('live', `TOC comparison failed: ${error.message}`); }
      const referenced = new Set([...audit.records.flatMap((record) => record.images.map((image) => image.src)), ...audit.imageHashes.map((image) => image.url)]);
      for (const src of referenced) {
        const href = resourceHref(src, session), hash = audit.imageHashes.find((v) => v.url === src), bytes = entries[`item/${href}`];
        if (!hash) fail('live', `Missing live image hash: ${href}`);
        else if (!bytes || bytes.length !== hash.bytes || sha256(bytes) !== hash.sha256) fail('live', `Live image bytes/hash differ: ${href}`);
      }
    }
  }
  report.ok = !Object.values(report.checks).some((value) => value.status === 'failed') && (!requireLive || report.checks.live.status === 'passed');
  return sanitizeEvidence(report);
}
