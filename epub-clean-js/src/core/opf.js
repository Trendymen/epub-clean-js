// src/core/opf.js
import path from "node:path/posix";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { MIME2EXT } from "./constants.js";
import { unquoteRecursive } from "./paths.js";

const PARSER_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: "",
  preserveOrder: true,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: false,
  parseTagValue: false,
};

const parser = new XMLParser(PARSER_OPTS);
const builder = new XMLBuilder({
  ...PARSER_OPTS,
  format: false,
  suppressEmptyNode: false,
});

// ============ 内部工具（被 stages 复用，统一从 opf.js 导出）============

export function tagOf(node) {
  for (const k of Object.keys(node)) if (k !== ":@") return k;
  return null;
}

export function childrenOf(node) {
  const t = tagOf(node);
  return t ? node[t] : [];
}

export function getAttr(node, name) {
  return node[":@"]?.[name];
}

export function setAttr(node, name, value) {
  node[":@"] ??= {};
  node[":@"][name] = value;
}

export function findFirst(nodes, tagName) {
  for (const n of nodes) {
    if (tagOf(n) === tagName) return n;
    const t = tagOf(n);
    if (t && Array.isArray(n[t])) {
      const r = findFirst(n[t], tagName);
      if (r) return r;
    }
  }
  return null;
}

export function findDirectChildren(node, tagName) {
  const kids = childrenOf(node);
  return Array.isArray(kids) ? kids.filter((k) => tagOf(k) === tagName) : [];
}

export function makeNode(tag, attrs = {}, text = null) {
  const node = { [tag]: text === null ? [] : [{ "#text": text }] };
  if (Object.keys(attrs).length) node[":@"] = { ...attrs };
  return node;
}

export function setText(node, text) {
  const t = tagOf(node);
  if (!t) return;
  node[t] = [{ "#text": text }];
}

// ============ 解析 + 序列化 ============

export function parseContainer(xmlText) {
  const doc = parser.parse(xmlText);
  const container = findFirst(doc, "container");
  if (!container) throw new Error("container.xml 缺少 <container>");
  const rootfile = findFirst(childrenOf(container), "rootfile");
  if (!rootfile) throw new Error("container.xml 缺少 <rootfile>");
  return getAttr(rootfile, "full-path");
}

export function parseOpf(opfText) {
  const tree = parser.parse(opfText);
  const pkg = findFirst(tree, "package");
  if (!pkg) throw new Error("OPF 缺少 <package>");
  const manifest = findFirst(childrenOf(pkg), "manifest");
  if (!manifest) throw new Error("OPF 缺少 <manifest>");

  const mapping = {};
  for (const item of findDirectChildren(manifest, "item")) {
    const rawHref = getAttr(item, "href");
    if (!rawHref) continue;
    const decoded = unquoteRecursive(rawHref);
    let itemId = getAttr(item, "id");
    const mime = getAttr(item, "media-type") ?? "";
    const props = (getAttr(item, "properties") ?? "").split(/\s+/);

    if (props.includes("nav")) {
      itemId = "nav.xhtml";
    } else {
      const baseName = path.basename(itemId);
      if (!baseName.includes(".")) {
        itemId = itemId + (MIME2EXT[mime] ?? "");
      }
    }
    const dirName = path.dirname(decoded);
    const newHref = dirName && dirName !== "." ? `${dirName}/${itemId}` : itemId;
    mapping[decoded] = newHref;
  }

  return { tree, pkg, mapping };
}

export function patchOpfManifest(pkg, mapping) {
  const manifest = findFirst(childrenOf(pkg), "manifest");
  if (manifest) {
    for (const item of findDirectChildren(manifest, "item")) {
      const raw = getAttr(item, "href");
      if (!raw) continue;
      const decoded = unquoteRecursive(raw);
      if (mapping[decoded]) setAttr(item, "href", mapping[decoded]);
    }
  }
  const guide = findFirst(childrenOf(pkg), "guide");
  if (guide) {
    for (const ref of findDirectChildren(guide, "reference")) {
      const raw = getAttr(ref, "href");
      if (!raw) continue;
      const decoded = unquoteRecursive(raw);
      const [p, frag] = decoded.split("#");
      if (mapping[p]) {
        const newHref = mapping[p] + (frag !== undefined ? "#" + frag : "");
        setAttr(ref, "href", newHref);
      }
    }
  }
}

export function serializeOpf(tree) {
  const body = builder.build(tree);
  return body.startsWith("<?xml")
    ? body
    : '<?xml version="1.0" encoding="utf-8"?>\n' + body;
}
