import { XMLValidator } from 'fast-xml-parser';

const xmlCharacter = (n) => n === 9 || n === 10 || n === 13 || (n >= 0x20 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff);

const NC_START = '[A-Z_a-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c-\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd\\u{10000}-\\u{effff}]';
const NC_NAME = `${NC_START}(?:${NC_START}|[-.0-9\u00b7\u0300-\u036f\u203f-\u2040])*`;
const QNAME = `${NC_NAME}(?::${NC_NAME})?`;
const nameAtStart = new RegExp(`^${QNAME}`, 'u');
const XML_SPACE = /[ \t\r\n]/;
const XML_URI = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_URI = 'http://www.w3.org/2000/xmlns/';
const XML_DECLARATION = /^xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(?:"1\.0"|'1\.0')(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(?:"[A-Za-z][A-Za-z0-9._-]*"|'[A-Za-z][A-Za-z0-9._-]*'))?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(?:"(?:yes|no)"|'(?:yes|no)'))?[ \t\r\n]*$/;

function decodeXmlReferences(value) {
  return value.replace(/&/g, '\u0000&').split('\u0000').map((part) => {
    if (!part.startsWith('&')) return part;
    const match = part.match(/^&(amp|lt|gt|apos|quot|#\d+|#x[\da-fA-F]+);/);
    if (!match) throw new Error('Undeclared or malformed XML entity');
    let decoded;
    if (match[1].startsWith('#')) {
      const number = match[1].startsWith('#x') ? parseInt(match[1].slice(2), 16) : Number(match[1].slice(1));
      if (!xmlCharacter(number)) throw new Error('Invalid numeric XML entity');
      decoded = String.fromCodePoint(number);
    } else decoded = { amp: '&', lt: '<', gt: '>', apos: "'", quot: '"' }[match[1]];
    return decoded + part.slice(match[0].length);
  }).join('');
}

export function xmlMarkupTokens(xml) {
  for (const c of xml) if (!xmlCharacter(c.codePointAt(0))) throw new Error('Invalid XML character');
  const tokens = [];
  let cursor = 0;
  const space = () => { while (cursor < xml.length && XML_SPACE.test(xml[cursor])) cursor++; };
  const name = () => {
    const found = xml.slice(cursor).match(nameAtStart)?.[0];
    if (!found) throw new Error('Invalid XML qualified name');
    cursor += found.length; return found;
  };
  while (cursor < xml.length) {
    const start = cursor;
    if (xml[cursor] !== '<') {
      cursor = xml.indexOf('<', cursor); if (cursor < 0) cursor = xml.length;
      const value = xml.slice(start, cursor);
      if (value.includes(']]>')) throw new Error('Forbidden ]]> in XML character data');
      decodeXmlReferences(value); tokens.push({ type: 'text', start, end: cursor, value }); continue;
    }
    if (xml.startsWith('<!--', cursor) || xml.startsWith('<![CDATA[', cursor) || xml.startsWith('<?', cursor)) {
      const [type, opening, closing] = xml.startsWith('<!--', cursor) ? ['comment', '<!--', '-->'] : xml.startsWith('<![CDATA[', cursor) ? ['cdata', '<![CDATA[', ']]>'] : ['pi', '<?', '?>'];
      const end = xml.indexOf(closing, cursor + opening.length);
      if (end < 0) throw new Error(`Unclosed XML ${type}`);
      const value = xml.slice(cursor + opening.length, end);
      if (type === 'comment' && (value.includes('--') || value.endsWith('-'))) throw new Error('Invalid -- in XML comment');
      cursor = end + closing.length; tokens.push({ type, start, end: cursor, value }); continue;
    }
    if (xml.startsWith('<!DOCTYPE', cursor)) {
      let quote;
      for (cursor += 9; cursor < xml.length; cursor++) {
        const c = xml[cursor];
        if (quote) { if (c === quote) quote = undefined; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === '[') throw new Error('Internal DTD subsets are unsupported');
        else if (c === '>') break;
      }
      if (cursor === xml.length) throw new Error('Unclosed XML doctype');
      cursor++;
      const raw = xml.slice(start, cursor);
      const literal = '(?:"[^"<>]*"|\'[^\'<>]*\')';
      if (!new RegExp(`^<!DOCTYPE[ \\t\\r\\n]+${QNAME}(?:[ \\t\\r\\n]+(?:SYSTEM[ \\t\\r\\n]+${literal}|PUBLIC[ \\t\\r\\n]+${literal}[ \\t\\r\\n]+${literal}))?[ \\t\\r\\n]*>$`, 'u').test(raw)) throw new Error('Unsupported XML doctype syntax');
      tokens.push({ type: 'doctype', start, end: cursor }); continue;
    }
    cursor++;
    if (xml[cursor] === '/') {
      cursor++; const tag = name(); space();
      if (xml[cursor++] !== '>') throw new Error('Invalid XML closing tag');
      tokens.push({ type: 'close', start, end: cursor, name: tag }); continue;
    }
    const tag = name(), attributes = [], seen = new Set();
    let selfClosing = false;
    while (cursor < xml.length) {
      const beforeSpace = cursor; space();
      if (xml[cursor] === '>' || xml.startsWith('/>', cursor)) {
        selfClosing = xml[cursor] === '/'; cursor += selfClosing ? 2 : 1; break;
      }
      if (cursor === beforeSpace) throw new Error('Missing whitespace before XML attribute');
      const attributeStart = cursor, attributeName = name(); space();
      if (seen.has(attributeName)) throw new Error('Duplicate XML attribute');
      seen.add(attributeName);
      if (xml[cursor++] !== '=') throw new Error('Missing XML attribute equals');
      space(); const quote = xml[cursor++];
      if (quote !== '"' && quote !== "'") throw new Error('Unquoted XML attribute');
      const valueStart = cursor, valueEnd = xml.indexOf(quote, cursor);
      if (valueEnd < 0 || xml.slice(cursor, valueEnd).includes('<')) throw new Error('Invalid XML attribute value');
      cursor = valueEnd + 1;
      attributes.push({ name: attributeName, value: decodeXmlReferences(xml.slice(valueStart, valueEnd).replace(/[\t\r\n]/g, ' ')), quote, start: attributeStart, end: cursor });
    }
    if (xml[cursor - 1] !== '>') throw new Error('Unclosed XML opening tag');
    tokens.push({ type: 'open', start, end: cursor, name: tag, attributes, selfClosing });
  }
  return tokens;
}

export function assertWellFormedXml(xml) {
  const tokens = xmlMarkupTokens(xml), stack = [];
  let roots = 0, doctype = false;
  for (const token of tokens) {
    if (token.type === 'text' && !stack.length && !/^[ \t\r\n]*$/.test(token.start === 0 ? token.value.replace(/^\ufeff/, '') : token.value)) throw new Error('Character data outside XML root');
    if (token.type === 'cdata' && !stack.length) throw new Error('CDATA outside XML root');
    if (token.type === 'doctype') {
      if (doctype || roots || stack.length) throw new Error('Invalid XML doctype placement');
      doctype = true;
    }
    if (token.type === 'pi') {
      const target = token.value.match(nameAtStart)?.[0];
      if (!target || (token.value.length > target.length && !XML_SPACE.test(token.value[target.length]))) throw new Error('Invalid XML processing instruction');
      if (target.toLowerCase() === 'xml' && (target !== 'xml' || token.start !== (xml.startsWith('\ufeff') ? 1 : 0))) throw new Error('Invalid XML declaration placement');
      if (target === 'xml' && !XML_DECLARATION.test(token.value)) throw new Error('Unsupported or invalid XML 1.0 declaration');
    }
    if (token.type === 'open') {
      if (!stack.length && ++roots > 1) throw new Error('XML document must have exactly one root element');
      const namespaces = new Map(stack.at(-1)?.namespaces ?? [['xml', XML_URI]]);
      for (const attribute of token.attributes) if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) {
        const prefix = attribute.name === 'xmlns' ? '' : attribute.name.slice(6), uri = attribute.value;
        if ((prefix && !uri) || prefix === 'xmlns' || uri === XMLNS_URI || (prefix === 'xml' ? uri !== XML_URI : uri === XML_URI)) throw new Error('Invalid XML namespace binding');
        namespaces.set(prefix, uri);
      }
      const expand = (qualified, isAttribute) => {
        const [prefix, local] = qualified.includes(':') ? qualified.split(':') : ['', qualified];
        if (prefix === 'xmlns' || (prefix && !namespaces.get(prefix))) throw new Error('Undeclared XML namespace prefix');
        return `${prefix || !isAttribute ? namespaces.get(prefix) ?? '' : ''}\u0000${local}`;
      };
      expand(token.name, false);
      const expanded = new Set();
      for (const attribute of token.attributes) {
        if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) continue;
        const key = expand(attribute.name, true);
        if (expanded.has(key)) throw new Error('Duplicate expanded XML attribute');
        expanded.add(key);
      }
      if (!token.selfClosing) stack.push({ name: token.name, namespaces });
    }
    if (token.type === 'close' && stack.pop()?.name !== token.name) throw new Error('Mismatched XML closing tag');
  }
  if (roots !== 1 || stack.length) throw new Error('XML document must have one complete root element');
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error(validation.err.msg);
}

const whitespace = (c) => c !== undefined && /[\t\n\r\f ]/.test(c);
const nameCharacter = (c) => c !== undefined && /[a-zA-Z0-9_\-\u0080-\uffff]/.test(c);

function escapeAt(css, start) {
  let end = start + 1;
  if (end >= css.length) throw new Error('Unfinished CSS escape');
  if (css[end] === '\n' || css[end] === '\f') return { value: '', end: end + 1, newline: true };
  if (css[end] === '\r') return { value: '', end: end + (css[end + 1] === '\n' ? 2 : 1), newline: true };
  const hex = css.slice(end).match(/^[\da-fA-F]{1,6}/)?.[0];
  if (!hex) return { value: css[end], end: end + 1, newline: false };
  end += hex.length;
  if (whitespace(css[end])) end += css[end] === '\r' && css[end + 1] === '\n' ? 2 : 1;
  const number = parseInt(hex, 16);
  return { value: String.fromCodePoint(!number || number > 0x10ffff || (number >= 0xd800 && number <= 0xdfff) ? 0xfffd : number), end, newline: false };
}

export function cssReferences(css) {
  const urls = [], imports = [], tokens = [], stack = [];
  let cursor = 0;
  const fail = (message) => { throw new Error(`CSS dependency syntax: ${message}`); };
  function trivia() {
    while (cursor < css.length) {
      if (whitespace(css[cursor])) { cursor++; continue; }
      if (css.startsWith('/*', cursor)) {
        const end = css.indexOf('*/', cursor + 2);
        if (end < 0) fail('unclosed comment');
        cursor = end + 2; continue;
      }
      break;
    }
  }
  function escaped(allowNewline) {
    let result;
    try { result = escapeAt(css, cursor); }
    catch (error) { fail(error.message); }
    if (result.newline && !allowNewline) fail('newline in identifier or URL');
    cursor = result.end; return result.value;
  }
  function string() {
    const quote = css[cursor++];
    let value = '';
    while (cursor < css.length) {
      const c = css[cursor];
      if (c === quote) { cursor++; return value; }
      if (c === '\\') value += escaped(true);
      else { if (/[\n\r\f]/.test(c)) fail('newline in string'); value += c; cursor++; }
    }
    fail('unclosed string');
  }
  function identifier() {
    let value = '';
    while (nameCharacter(css[cursor]) || css[cursor] === '\\') value += css[cursor] === '\\' ? escaped(false) : css[cursor++];
    return value;
  }
  function url() {
    cursor++; trivia();
    let value = '';
    if (css[cursor] === '"' || css[cursor] === "'") { value = string(); trivia(); }
    else {
      while (cursor < css.length && css[cursor] !== ')') {
        const c = css[cursor];
        if (whitespace(c)) { trivia(); break; }
        if (c === '\\') value += escaped(false);
        else { if (/["'(\u0000-\u001f\u007f]/.test(c)) fail('invalid unquoted URL'); value += c; cursor++; }
      }
    }
    if (css[cursor] !== ')') fail('unclosed or ambiguous URL');
    cursor++; urls.push(value); tokens.push({ type: 'url', value });
  }
  while (cursor < css.length) {
    trivia(); if (cursor >= css.length) break;
    const c = css[cursor];
    if (c === '"' || c === "'") {
      const value = string(); tokens.push({ type: 'string', value });
      if (['image-set', '-webkit-image-set', 'image'].includes(stack.at(-1)?.name)) urls.push(value);
    } else if (c === '@') { cursor++; tokens.push({ type: 'at', value: identifier().toLowerCase() }); }
    else if (nameCharacter(c) || c === '\\') {
      const value = identifier().toLowerCase();
      if (css[cursor] === '(' && ['url', 'src'].includes(value)) url();
      else if (css[cursor] === '(') {
        if (value === 'var' && ['image-set', '-webkit-image-set', 'image'].includes(stack.at(-1)?.name)) fail('dynamic image resource is unsupported');
        cursor++; stack.push({ close: ')', name: value }); tokens.push({ type: 'function', value });
      } else tokens.push({ type: 'ident', value });
    } else {
      cursor++; tokens.push({ type: 'delimiter', value: c });
      if ('([{'.includes(c)) stack.push({ close: { '(': ')', '[': ']', '{': '}' }[c], name: '' });
      else if (')]}'.includes(c) && stack.pop()?.close !== c) fail('unbalanced group');
    }
  }
  if (stack.length) fail('unclosed group');
  for (let i = 0; i < tokens.length; i++) if (tokens[i].type === 'at' && tokens[i].value === 'import') {
    const target = tokens[i + 1];
    if (!target || !['string', 'url'].includes(target.type)) fail('unsupported @import target');
    imports.push(target.value);
    if (target.type === 'string') urls.push(target.value);
  }
  return { urls, imports };
}
