import path from "node:path/posix";
import { XMLParser } from "fast-xml-parser";
import { readEpub } from "./zip-io.js";

const BAD_CHARS = ["*", "|", "?"];

function hasBadChars(name) {
  return BAD_CHARS.some((c) => name.includes(c));
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  preserveOrder: true,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
});

function findFirst(nodes, tag) {
  for (const n of nodes) {
    for (const k of Object.keys(n)) {
      if (k === ":@") continue;
      if (k === tag) return n;
      if (Array.isArray(n[k])) {
        const r = findFirst(n[k], tag);
        if (r) return r;
      }
      break;
    }
  }
  return null;
}

function getAttr(node, name) {
  return node?.[":@"]?.[name];
}

function tagOf(node) {
  for (const k of Object.keys(node || {})) if (k !== ":@") return k;
  return null;
}

function childrenOf(node) {
  const t = tagOf(node);
  return t ? node[t] : [];
}

function findAll(nodes, tag) {
  const out = [];
  for (const n of nodes) {
    const t = tagOf(n);
    if (t === tag) out.push(n);
    if (t && Array.isArray(n[t])) out.push(...findAll(n[t], tag));
  }
  return out;
}

export async function validateOutput(epubPath) {
  const issues = [];
  const orphans = [];
  const brokenLinks = [];
  const { names, entries } = await readEpub(epubPath);

  // 1. mimetype 第一项 + 内容（yazl 已保证 STORED + 顺序，这里只验证内容/位置）
  if (names.length === 0 || names[0] !== "mimetype") {
    issues.push("mimetype 不是第一项");
  } else {
    const mt = entries["mimetype"]?.toString("utf-8");
    if (mt !== "application/epub+zip") issues.push("mimetype 内容错误");
  }

  // 2. container.xml
  let opfPath;
  try {
    const containerXml = entries["META-INF/container.xml"].toString("utf-8");
    const cTree = parser.parse(containerXml);
    const rootfile = findFirst(cTree, "rootfile");
    opfPath = getAttr(rootfile, "full-path");
  } catch (e) {
    issues.push(`container.xml 错误: ${e.message}`);
    return { ok: false, issues, orphans, brokenLinks };
  }

  // 3. OPF metadata 必备
  let opfTree;
  try {
    opfTree = parser.parse(entries[opfPath].toString("utf-8"));
    const metadata = findFirst(opfTree, "metadata");
    const mdChildren = childrenOf(metadata) || [];
    for (const tag of ["dc:title", "dc:identifier", "dc:language"]) {
      if (!mdChildren.some((n) => tagOf(n) === tag)) {
        issues.push(`metadata 缺少 ${tag}`);
      }
    }
  } catch (e) {
    issues.push(`OPF 解析失败: ${e.message}`);
    return { ok: false, issues, orphans, brokenLinks };
  }

  const manifestPaths = new Set();
  const manifest = findFirst(opfTree, "manifest");
  const isExternal = (value) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value);
  const decode = (value) => decodeURIComponent(value);
  const resolveReference = (from, value) => {
    if (!value || isExternal(value)) return null;
    const hash = value.indexOf('#');
    const resource = (hash < 0 ? value : value.slice(0, hash)).split('?')[0];
    const fragment = hash < 0 ? '' : decode(value.slice(hash + 1));
    return {
      target: resource ? path.normalize(path.join(path.dirname(from), decode(resource))) : from,
      fragment,
    };
  };
  for (const item of childrenOf(manifest) || []) {
    if (tagOf(item) !== 'item') continue;
    const href = getAttr(item, 'href');
    try {
      const resolved = resolveReference(opfPath, href);
      if (!resolved) continue;
      manifestPaths.add(resolved.target);
      if (!entries[resolved.target]) issues.push('manifest 项不存在: ' + resolved.target);
    } catch (error) {
      issues.push('manifest 引用错误: ' + href + ': ' + error.message);
    }
  }

  const trees = new Map();
  const idsByFile = new Map();
  const walk = function* (nodes) {
    for (const node of nodes) {
      yield node;
      const children = childrenOf(node);
      if (Array.isArray(children)) yield* walk(children);
    }
  };
  for (const name of names) {
    if (!/\.(?:xhtml|html|ncx)$/i.test(name)) continue;
    try {
      const tree = parser.parse(entries[name].toString('utf8'));
      trees.set(name, tree);
      const ids = new Set();
      for (const node of walk(tree)) {
        const id = getAttr(node, 'id') || getAttr(node, 'xml:id');
        if (!id) continue;
        if (ids.has(id)) issues.push(name + ': 重复 ID ' + id);
        ids.add(id);
      }
      idsByFile.set(name, ids);
    } catch (error) {
      issues.push(name + ': 解析失败: ' + error.message);
    }
  }

  const checkReference = (from, value) => {
    try {
      const resolved = resolveReference(from, value?.trim());
      if (!resolved) return;
      const { target, fragment } = resolved;
      if (!entries[target]) {
        brokenLinks.push(from + ': 引用 ' + value + ' → ' + target + ' 不存在');
      } else if (fragment && idsByFile.has(target) && !idsByFile.get(target).has(fragment)) {
        brokenLinks.push(from + ': 引用 ' + value + ' → ' + target + ' 缺少 fragment #' + fragment);
      }
    } catch (error) {
      brokenLinks.push(from + ': 引用 ' + value + ' 无法解析: ' + error.message);
    }
  };
  const checkCss = (name, css) => {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi)) {
      checkReference(name, match.slice(1).find((value) => value !== undefined));
    }
  };
  for (const [name, tree] of trees) {
    for (const node of walk(tree)) {
      for (const attr of ['href', 'src', 'xlink:href', 'poster']) {
        const value = getAttr(node, attr);
        if (value) checkReference(name, value);
      }
      const style = getAttr(node, 'style');
      if (style) checkCss(name, style);
      if (tagOf(node) === 'style') {
        checkCss(name, childrenOf(node).map((child) => child['#text'] || '').join(''));
      }
    }
  }
  for (const name of names) {
    if (/\.css$/i.test(name)) checkCss(name, entries[name].toString('utf8'));
  }

  const packageNode = findFirst(opfTree, 'package');
  const identifierId = getAttr(packageNode, 'unique-identifier');
  const identifierNode = findAll(opfTree, 'dc:identifier').find((node) => getAttr(node, 'id') === identifierId);
  const identifier = (childrenOf(identifierNode) || []).map((node) => node['#text'] || '').join('').trim();
  if (!identifierId || !identifier) issues.push('OPF unique-identifier 未指向有效标识');
  for (const [name, tree] of trees) {
    if (!/\.ncx$/i.test(name)) continue;
    const uid = findAll(tree, 'meta').find((node) => getAttr(node, 'name') === 'dtb:uid');
    if (!identifier || getAttr(uid, 'content') !== identifier) {
      issues.push(name + ': NCX dtb:uid 与 OPF 标识不一致');
    }
  }

  // 8. 文件名无 *|? 字面字符
  for (const n of names) {
    if (hasBadChars(n)) issues.push(`文件名含混淆字符: ${n}`);
  }

  // 9. 孤儿文件（zip 有 / manifest 无）
  for (const n of names) {
    if (n === "mimetype" || n.startsWith("META-INF/")) continue;
    if (n === opfPath) continue;
    if (!manifestPaths.has(n)) orphans.push(n);
  }

  return { ok: issues.length === 0 && brokenLinks.length === 0, issues, orphans, brokenLinks };
}
