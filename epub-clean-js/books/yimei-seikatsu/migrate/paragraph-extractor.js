/**
 * 从 XHTML 抽取**正文**段落纯文本列表。
 *
 * 规则：
 * - 仅取 <p> 元素，按文档顺序
 * - 跳过 aside 内的 p（注释正文，由 footnote-extractor 单独处理）
 * - 去前后空白
 * - 跳过空段落
 * - ruby/rt/rp 标签：保留基字，丢弃注音与回退括号
 * - 普通 sup 保留文本与安全的上标结构；多看脚注不计入正文坐标
 */
import { readFileSync } from 'node:fs';
import { DOMParser, parseHTML } from 'linkedom';

export function duokanFootnoteAnchors(sup) {
  return [...sup.querySelectorAll('a')].filter(anchor =>
    (anchor.getAttribute('class') || '').split(/\s+/).includes('duokan-footnote'));
}

export function isDuokanFootnoteSup(sup) {
  return duokanFootnoteAnchors(sup).length > 0;
}

function isPureFootnoteSup(sup) {
  const anchors = [...sup.querySelectorAll('a')];
  const candidates = duokanFootnoteAnchors(sup);
  const images = [...sup.querySelectorAll('img')];
  if (anchors.length !== 1 || candidates.length !== 1 || images.length !== 1 || !candidates[0].contains(images[0])) return false;
  const [anchor] = candidates;
  const [img] = images;
  function isPure(node) {
    return [...node.childNodes].every(child => {
      if (child.nodeType === 3) return !child.nodeValue.trim();
      if (child.nodeType !== 1) return false;
      if (child === img) return child.childNodes.length === 0;
      if (child === anchor) return isPure(child);
      return child.tagName === 'SPAN' && [...child.attributes].every(({ name }) => name.toLowerCase() === 'class') && isPure(child);
    });
  }
  return isPure(sup);
}

function removeNonBodyText(p) {
  for (const el of [...p.querySelectorAll('rt,rp,aside')]) el.remove();
  for (const sup of [...p.querySelectorAll('sup')]) if (isDuokanFootnoteSup(sup)) sup.remove();
}

const NATIVE_RUBY_TAGS = new Set(['ruby', 'rb', 'rt', 'rp', 'span', 'a', 'em', 'strong', 'b', 'i', 'u', 's', 'small', 'sub']);
const NATIVE_RUBY_ATTRIBUTES = new Set(['id', 'class', 'lang', 'xml:lang', 'xml:space', 'dir', 'translate', 'hidden', 'role', 'title', 'style', 'href']);
const NATIVE_ANCESTOR_ATTRIBUTES = new Set(['id', 'class', 'lang', 'xml:lang', 'dir', 'xmlns']);
const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

function validateRubyNamespace(ruby, location, requireNamespace) {
  const nodes = [...ruby.querySelectorAll('*')];
  for (let node = ruby; node; node = node.parentElement) {
    nodes.push(node);
  }
  for (const node of nodes) {
    if (node.tagName.includes(':')) throw new Error(`${location}: unsupported-ruby-namespace`);
    let namespace = null;
    for (let scope = node; scope; scope = scope.parentElement) {
      if (scope.hasAttribute('xmlns')) {
        namespace = scope.getAttribute('xmlns');
        break;
      }
    }
    if (namespace === null && requireNamespace) throw new Error(`${location}: missing-ruby-namespace`);
    if (namespace !== null && namespace !== XHTML_NAMESPACE) throw new Error(`${location}: unsupported-ruby-namespace`);
  }
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function comparableChildren(node) {
  const children = [];
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      const previous = children[children.length - 1];
      if (previous?.text !== undefined) previous.text += child.nodeValue ?? '';
      else children.push({ text: child.nodeValue ?? '' });
    } else children.push({ node: child });
  }
  return children;
}

function sameXhtmlTree(xmlNode, htmlNode) {
  if (xmlNode.nodeType !== htmlNode.nodeType) return false;
  if (xmlNode.nodeType === 8) return xmlNode.nodeValue === htmlNode.nodeValue;
  if (xmlNode.nodeType !== 1 || xmlNode.tagName !== htmlNode.tagName.toLowerCase()) return false;
  const xmlAttrs = [...xmlNode.attributes];
  const htmlAttrs = new Map([...htmlNode.attributes].map(({ name, value }) => [name, value]));
  if (xmlAttrs.length !== htmlAttrs.size || xmlAttrs.some(({ name, value }) =>
    !htmlAttrs.has(name) || /[\t\r\n]/.test(value) || value !== htmlAttrs.get(name))) return false;
  const xmlChildren = comparableChildren(xmlNode);
  const htmlChildren = comparableChildren(htmlNode);
  return xmlChildren.length === htmlChildren.length && xmlChildren.every((child, index) => {
    const other = htmlChildren[index];
    return child.text !== undefined ? child.text === other.text : Boolean(other.node && sameXhtmlTree(child.node, other.node));
  });
}

function inheritedLanguage(element, xmlOnly) {
  for (let node = element; node; node = node.parentElement) {
    if (node.hasAttribute('xml:lang')) return node.getAttribute('xml:lang').toLowerCase();
    if (!xmlOnly && node.hasAttribute('lang')) return node.getAttribute('lang').toLowerCase();
  }
  return '';
}

function conflictingLanguages(element) {
  return element.hasAttribute('xml:lang') && element.hasAttribute('lang') &&
    element.getAttribute('xml:lang').toLowerCase() !== element.getAttribute('lang').toLowerCase();
}

function hasUnsupportedAncestorContext(host, hasDirection) {
  for (let ancestor = host; ancestor; ancestor = ancestor.parentElement) {
    const unsupported = [...ancestor.attributes].some(({ name }) =>
      !NATIVE_ANCESTOR_ATTRIBUTES.has(name.toLowerCase()) && !name.toLowerCase().startsWith('xmlns:'));
    if (unsupported || conflictingLanguages(ancestor) || (!hasDirection && ancestor.hasAttribute('dir'))) return true;
  }
  return false;
}

function nativeSupMarkup(sup) {
  const host = sup.closest('p');
  if (sup.parentElement !== host || [...sup.attributes].some(({ name }) => name.toLowerCase() !== 'class') ||
      [...sup.childNodes].some(child => child.nodeType !== 3) || !sup.textContent ||
      hasUnsupportedAncestorContext(host, false)) throw new Error('unsupported-native-sup');
  const xmlLang = inheritedLanguage(sup, true);
  const htmlLang = inheritedLanguage(sup, false);
  if (xmlLang !== 'zh' && htmlLang !== xmlLang) throw new Error('unsupported-native-sup-language');
  const attribute = xmlLang !== 'zh' ? ['xml:lang', xmlLang] : htmlLang !== 'zh' ? ['lang', htmlLang] : null;
  const language = attribute ? ` ${attribute[0]}="${escapeXml(attribute[1]).replace(/"/g, '&quot;')}"` : '';
  const classAttr = sup.hasAttribute('class') ? ` class="${escapeXml(sup.getAttribute('class')).replace(/"/g, '&quot;')}"` : '';
  return `<sup${classAttr}${language}>${escapeXml(sup.textContent)}</sup>`;
}

function serializeNativeRuby(node) {
  if (node.nodeType === 3) return escapeXml(node.nodeValue ?? '');
  if (node.nodeType === 8) return `<!--${node.nodeValue ?? ''}-->`;
  if (node.nodeType !== 1) throw new Error('unsupported-native-ruby-node');
  const tag = node.tagName.toLowerCase();
  if (!NATIVE_RUBY_TAGS.has(tag)) throw new Error(`unsupported-native-ruby-element (${tag})`);
  const attributes = [...node.attributes].map(({ name, value }) => {
    const lower = name.toLowerCase();
    if (lower === 'xmlns' || lower.startsWith('xmlns:') || (lower.includes(':') && !lower.startsWith('xml:')) || lower.startsWith('on')) {
      throw new Error(`unsupported-native-ruby-attribute (${name})`);
    }
    if (!NATIVE_RUBY_ATTRIBUTES.has(lower)) throw new Error(`unsupported-native-ruby-attribute (${name})`);
    if (lower === 'href' && (tag !== 'a' || !/^(?:https?:|mailto:|tel:)/i.test(value))) {
      throw new Error('unsupported-native-ruby-link');
    }
    if ((lower === 'style' && /url\s*\(/i.test(value)) || ['src', 'srcset'].includes(lower)) {
      throw new Error(`unsupported-native-ruby-resource (${name})`);
    }
    const escaped = escapeXml(value).replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');
    return ` ${name}="${escaped}"`;
  }).join('');
  const children = [...node.childNodes].map(serializeNativeRuby).join('');
  return `<${tag}${attributes}>${children}</${tag}>`;
}

/**
 * @param {string} xhtmlPath
 * @returns {string[]}
 */
export function extractParagraphs(xhtmlPath) {
  const xml = readFileSync(xhtmlPath, 'utf-8');
  return validateRubyDocument(xml, xhtmlPath).paragraphs;
}

export function validateRubyDocument(xml, location, allowParagraphRuby = true, { preserveNative = false, requireNamespace = false } = {}) {
  const { document } = parseHTML(xml);
  const allSupers = [...document.querySelectorAll('sup')];
  const allRubies = [...document.querySelectorAll('ruby')];
  const hasNativeSup = preserveNative && allSupers.some(sup => !isDuokanFootnoteSup(sup) && sup.closest('p') && !sup.closest('aside'));
  let xmlDocument;
  if (preserveNative && (allRubies.length || hasNativeSup)) {
    try { xmlDocument = new DOMParser().parseFromString(xml, 'application/xml'); }
    catch { throw new Error(`${location}: inline: invalid-xhtml`); }
  }
  const xmlSupers = hasNativeSup ? [...xmlDocument.querySelectorAll('sup')] : [];
  if (hasNativeSup && xmlSupers.length !== allSupers.length) throw new Error(`${location}:sup: inconsistent-native-sup-xhtml`);
  for (const [index, sup] of allSupers.entries()) {
    if (isDuokanFootnoteSup(sup)) {
      if (!isPureFootnoteSup(sup)) throw new Error(`${location}:sup${index + 1}: mixed-footnote-content`);
    } else if (preserveNative && sup.closest('p') && !sup.closest('aside')) {
      if (!sameXhtmlTree(xmlSupers[index], sup)) throw new Error(`${location}:sup${index + 1}: inconsistent-native-sup-xhtml`);
      try { nativeSupMarkup(sup); }
      catch (error) { throw new Error(`${location}:sup${index + 1}: ${error.message}`); }
    }
  }
  for (const [index, element] of [...document.querySelectorAll('*')].entries()) {
    const tag = element.tagName.toLowerCase();
    if (/^.+:(?:ruby|rb|rt|rp)$/.test(tag)) {
      throw new Error(`${location}:${tag}[${index + 1}]: unsupported-prefixed-ruby-tag`);
    }
    if ((tag === 'rt' || tag === 'rp') && !element.closest('ruby')) {
      throw new Error(`${location}:${tag}[${index + 1}]: orphan-ruby-annotation`);
    }
  }
  const rubies = allRubies;
  let xmlRubies = [];
  if (preserveNative && rubies.length) {
    xmlRubies = [...xmlDocument.querySelectorAll('ruby')];
    if (xmlRubies.length !== rubies.length) throw new Error(location + ':ruby: inconsistent-native-ruby-xhtml');
  }
  for (const [index, ruby] of rubies.entries()) {
    validateRubyNamespace(ruby, `${location}:ruby${index + 1}`, requireNamespace);
    const host = ruby.closest('p');
    if (!allowParagraphRuby || !host || ruby.closest('aside')) {
      throw new Error(`${location}:ruby${index + 1}: unsupported-ruby-container (${ruby.parentElement?.tagName})`);
    }
    if (ruby.querySelector('sup')) throw new Error(`${location}:ruby${index + 1}: footnote-inside-native-ruby`);
    if (preserveNative) {
      if (ruby.parentElement !== host) throw new Error(`${location}:ruby${index + 1}: unsupported-native-ruby-wrapper`);
      if (/<!ENTITY\b/i.test(xml)) throw new Error(`${location}:ruby${index + 1}: unsupported-native-ruby-entity`);
      if (!sameXhtmlTree(xmlRubies[index], ruby)) throw new Error(location + ':ruby' + (index + 1) + ': inconsistent-native-ruby-xhtml');
      const ownXmlLang = ruby.getAttribute('xml:lang');
      const ownHtmlLang = ruby.getAttribute('lang');
      const outputXmlLang = (ownXmlLang ?? 'zh').toLowerCase();
      const outputHtmlLang = (ownXmlLang ?? ownHtmlLang ?? 'zh').toLowerCase();
      if (inheritedLanguage(ruby, true) !== outputXmlLang || inheritedLanguage(ruby, false) !== outputHtmlLang ||
          [ruby, ...ruby.querySelectorAll('*')].some(conflictingLanguages)) {
        throw new Error(`${location}:ruby${index + 1}: unsupported-native-ruby-inherited-context`);
      }
      const hasDirection = ruby.hasAttribute('dir');
      if (hasUnsupportedAncestorContext(host, hasDirection)) throw new Error(`${location}:ruby${index + 1}: unsupported-native-ruby-inherited-context`);
      try { serializeNativeRuby(ruby); }
      catch (error) { throw new Error(`${location}:ruby${index + 1}: ${error.message}`); }
    }
  }
  const data = extractParagraphData(xml, { preserveMarkup: preserveNative });
  for (const [index, ruby] of data.rubies.entries()) {
    if (ruby.issue) throw new Error(`${location}:p${ruby.documentParaIndex + 1}:ruby${index + 1}: ${ruby.issue}`);
    if (data.paragraphs[ruby.paraIndex]?.slice(ruby.start, ruby.start + ruby.base.length) !== ruby.base) {
      throw new Error(`${location}:p${ruby.documentParaIndex + 1}:ruby${index + 1}: ruby-range-outside-trimmed-paragraph`);
    }
  }
  for (const [index, sup] of data.supers.entries()) {
    if (data.paragraphs[sup.paraIndex]?.slice(sup.start, sup.start + sup.text.length) !== sup.text) {
      throw new Error(`${location}:p${sup.documentParaIndex + 1}:sup${index + 1}: sup-range-outside-trimmed-paragraph`);
    }
  }
  return data;
}

export function extractParagraphData(xml, { preserveMarkup = false } = {}) {
  const { document } = parseHTML(xml);
  const paragraphs = [];
  const rubies = [];
  const supers = [];
  for (const [documentParaIndex, p] of [...document.querySelectorAll('p')].entries()) {
    // 跳过 aside 祖先内的 p（注释正文，由 footnote-extractor 单独处理）
    if (p.closest('aside')) continue;
    const pending = [...p.querySelectorAll('ruby')].map((ruby) => {
      const readings = [...ruby.querySelectorAll('rt')].map(rt => rt.textContent.trim());
      const nested = ruby.querySelector('ruby') || ruby.parentElement?.closest('ruby');
      return { ruby, html: preserveMarkup ? serializeNativeRuby(ruby) : undefined, reading: readings.join('／'), issue: nested ? 'nested-ruby' : readings.length > 1 ? 'multiple-rt' : (!readings[0] ? 'empty-reading' : null) };
    });
    const pendingSupers = preserveMarkup ? [...p.querySelectorAll('sup')].filter(sup => !sup.closest('aside') && !isDuokanFootnoteSup(sup)) : [];
    removeNonBodyText(p);
    const text = (p.textContent ?? '').trim();
    const leading = p.textContent.length - p.textContent.trimStart().length;
    function offsetOf(target) {
      let offset = 0;
      let found = false;
      function visit(node) {
        if (node === target) { found = true; return; }
        if (node.nodeType === 3) offset += node.textContent.length;
        else for (const child of node.childNodes) { visit(child); if (found) break; }
      }
      visit(p);
      return offset - leading;
    }
    for (const { ruby, html, reading, issue } of pending) {
      rubies.push({ paraIndex: text ? paragraphs.length : null, documentParaIndex, start: offsetOf(ruby), base: ruby.textContent, reading, issue: issue || (!ruby.textContent.trim() ? 'empty-base' : null), ...(preserveMarkup ? { html } : {}) });
    }
    for (const sup of pendingSupers) {
      supers.push({ paraIndex: text ? paragraphs.length : null, documentParaIndex, start: offsetOf(sup), text: sup.textContent, html: nativeSupMarkup(sup) });
    }
    if (text) paragraphs.push(text);
  }
  return { paragraphs, rubies, supers };
}
