import { XMLParser, XMLValidator } from 'fast-xml-parser';

const xmlCharacter = (n) => n === 9 || n === 10 || n === 13 || (n >= 0x20 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff);

export function assertWellFormedXml(xml) {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error(validation.err.msg);
  if (Array.from(xml).some((c) => !xmlCharacter(c.codePointAt(0)))) throw new Error('Invalid XML character');
  const declarations = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, '');
  if (/<!DOCTYPE\b[^>]*\[/i.test(declarations)) throw new Error('Internal DTD subsets are unsupported');
  const doctypes = declarations.match(/<!DOCTYPE\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? [];
  if (doctypes.length > 1) throw new Error('Multiple XML doctypes');
  const entityText = declarations.replace(/<!DOCTYPE\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, '');
  for (const match of entityText.matchAll(/&[^<&\s]*/g)) {
    const entity = match[0].match(/^&(amp|lt|gt|apos|quot|#\d+|#x[\da-fA-F]+);/);
    if (!entity) throw new Error('Undeclared or malformed XML entity');
    if (entity[1].startsWith('#')) {
      const codepoint = entity[1].startsWith('#x') ? parseInt(entity[1].slice(2), 16) : Number(entity[1].slice(1));
      if (!xmlCharacter(codepoint)) throw new Error('Invalid numeric XML entity');
    }
  }
  const tree = new XMLParser({ preserveOrder: true, ignoreAttributes: false, processEntities: false, trimValues: false, cdataPropName: '#cdata' }).parse(xml);
  const elements = tree.filter((node) => Object.keys(node).some((key) => key !== ':@' && !key.startsWith('?') && !key.startsWith('#')));
  if (elements.length !== 1) throw new Error('XML document must have exactly one root element');
  if (tree.some((node) => Object.hasOwn(node, '#cdata') || (Object.hasOwn(node, '#text') && String(node['#text']).trim()))) throw new Error('Character data outside XML root');
  function namespaces(nodes, inherited) {
    for (const node of nodes) {
      const name = Object.keys(node).find((key) => key !== ':@');
      if (!name || name.startsWith('#') || name.startsWith('?')) continue;
      const prefixes = new Set(inherited);
      for (const [attribute, value] of Object.entries(node[':@'] ?? {})) if (attribute.startsWith('@_xmlns:') && value) prefixes.add(attribute.slice(8));
      for (const qualified of [name, ...Object.keys(node[':@'] ?? {}).map((attribute) => attribute.slice(2))]) {
        if (qualified.includes(':') && !prefixes.has(qualified.split(':')[0])) throw new Error('Undeclared XML namespace prefix');
      }
      if (Array.isArray(node[name])) namespaces(node[name], prefixes);
    }
  }
  namespaces(tree, new Set(['xml', 'xmlns']));
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
