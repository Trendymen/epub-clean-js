import path from "node:path/posix";
import { XMLParser } from "fast-xml-parser";
import { XHTML_ATTR_RE } from "./patchers.js";
import { readEpub } from "./zip-io.js";

const PCT_CODES = ["%2A", "%3A", "%7C", "%3F"];
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
  processEntities: false,
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
  return node[":@"]?.[name];
}

function tagOf(node) {
  for (const k of Object.keys(node)) if (k !== ":@") return k;
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

  // 4. manifest 每项文件存在
  const opfDir = path.dirname(opfPath);
  const manifestPaths = new Set();
  const manifest = findFirst(opfTree, "manifest");
  for (const item of findAll(opfTree, "item")) {
    if (manifest && childrenOf(manifest).some((c) => c === item)) {
      const href = getAttr(item, "href");
      if (!href) continue;
      const full =
        opfDir && opfDir !== "." ? path.normalize(`${opfDir}/${href}`) : href;
      manifestPaths.add(full);
      if (!entries[full]) issues.push(`manifest 项不存在: ${full}`);
    }
  }

  // 5. xhtml 引用解析后存在 → broken-link
  for (const n of names) {
    if (!n.endsWith(".xhtml") && !n.endsWith(".html")) continue;
    const text = entries[n].toString("utf-8");
    const xhDir = path.dirname(n);
    for (const m of text.matchAll(XHTML_ATTR_RE)) {
      const v = m[3];
      if (
        !v ||
        v.startsWith("data:") ||
        v.startsWith("http://") ||
        v.startsWith("https://") ||
        v.startsWith("#") ||
        v.startsWith("mailto:") ||
        v.startsWith("tel:")
      ) {
        continue;
      }
      const p = v.split("#", 1)[0];
      if (!p) continue;
      const target = path.normalize(`${xhDir}/${p}`);
      if (!entries[target]) {
        brokenLinks.push(`${n}: 引用 ${v} → ${target} 不存在`);
      }
    }
  }

  // 6. 文本资源无 percent 残留
  for (const n of names) {
    if (
      !n.endsWith(".xhtml") &&
      !n.endsWith(".html") &&
      !n.endsWith(".css") &&
      !n.endsWith(".opf") &&
      !n.endsWith(".ncx")
    ) {
      continue;
    }
    const text = entries[n].toString("utf-8");
    for (const code of PCT_CODES) {
      if (text.includes(code)) {
        issues.push(`${n}: 含 percent 残留 ${code}`);
        break;
      }
    }
  }

  // 7. CSS url() 引用无字面 *|? 字符（验证孤儿 @font-face 清理彻底）
  // 注：CSS 选择器中的 *|? 是合法通配/属性匹配符，不算混淆残留。
  // 只检查 url(...) 内部引用。
  for (const n of names) {
    if (!n.endsWith(".css")) continue;
    const text = entries[n].toString("utf-8");
    const urlMatches = text.match(/url\([^)]+\)/g) || [];
    for (const u of urlMatches) {
      if (/[*|?]/.test(u)) {
        issues.push(`${n}: CSS url() 含字面混淆字符 (孤儿 @font-face 未清理彻底): ${u}`);
        break;
      }
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

  return { ok: issues.length === 0, issues, orphans, brokenLinks };
}
