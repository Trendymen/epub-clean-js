// src/core/stages/ncx-format.js
//
// NCX 缩进美化 stage：把 toc.ncx / *.ncx 解析后用统一缩进重新序列化。
// 嵌套结构（特典合集等）保留并美化层级。
//
// 输入 EpubBuffer.entries 结构：{ [name: string]: Buffer }
// 仅对 *.ncx 文件做处理，其它原样保留。

import { Buffer } from "node:buffer";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  trimValues: true,
});

/**
 * XML 属性值转义。
 * @param {string} s
 * @returns {string}
 */
function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * XML 文本节点转义。
 * @param {string} s
 * @returns {string}
 */
function escapeText(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderNavPoint(np, indent) {
  const pad = " ".repeat(indent);
  const id = np["@_id"] ?? "";
  let out = `${pad}<navPoint id="${escapeAttr(id)}"`;
  if (np["@_playOrder"]) out += ` playOrder="${escapeAttr(np["@_playOrder"])}"`;
  out += `>\n`;

  // navLabel.text 可能是字符串或 { "#text": "..." }
  const labelText =
    typeof np.navLabel?.text === "object"
      ? np.navLabel.text["#text"] ?? ""
      : np.navLabel?.text ?? "";
  out += `${pad}  <navLabel><text>${escapeText(labelText)}</text></navLabel>\n`;

  const contentSrc = np.content?.["@_src"] ?? "";
  out += `${pad}  <content src="${escapeAttr(contentSrc)}"/>\n`;

  if (np.navPoint) {
    const children = Array.isArray(np.navPoint) ? np.navPoint : [np.navPoint];
    for (const ch of children) out += renderNavPoint(ch, indent + 2);
  }
  out += `${pad}</navPoint>\n`;
  return out;
}

function maxDepth(nps, cur = 1) {
  let m = cur;
  for (const np of nps) {
    if (np.navPoint) {
      const ch = Array.isArray(np.navPoint) ? np.navPoint : [np.navPoint];
      m = Math.max(m, maxDepth(ch, cur + 1));
    }
  }
  return m;
}

function renderNcx(parsed) {
  const ncx = parsed.ncx;
  if (!ncx?.navMap?.navPoint) {
    throw new Error("ncx 缺少 navMap/navPoint");
  }
  const nps = Array.isArray(ncx.navMap.navPoint) ? ncx.navMap.navPoint : [ncx.navMap.navPoint];
  const depth = maxDepth(nps);

  let out = `<?xml version="1.0" encoding="utf-8"?>\n`;
  out += `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"`;
  if (ncx["@_xml:lang"]) out += ` xml:lang="${escapeAttr(ncx["@_xml:lang"])}"`;
  out += `>\n`;

  out += `  <head>\n`;
  if (ncx.head?.meta) {
    const metas = Array.isArray(ncx.head.meta) ? ncx.head.meta : [ncx.head.meta];
    for (const m of metas) {
      if (m["@_name"] === "dtb:depth") {
        out += `    <meta name="dtb:depth" content="${depth}"/>\n`;
      } else {
        let s = `    <meta`;
        if (m["@_name"]) s += ` name="${escapeAttr(m["@_name"])}"`;
        if (m["@_content"] !== undefined) s += ` content="${escapeAttr(m["@_content"])}"`;
        if (m["@_scheme"] !== undefined) s += ` scheme="${escapeAttr(m["@_scheme"])}"`;
        s += `/>\n`;
        out += s;
      }
    }
  }
  out += `  </head>\n`;

  // docTitle.text 可能是字符串或 { "#text": "..." }
  const docTitleText =
    typeof ncx.docTitle?.text === "object"
      ? ncx.docTitle.text["#text"] ?? ""
      : ncx.docTitle?.text ?? "";
  out += `  <docTitle><text>${escapeText(docTitleText)}</text></docTitle>\n`;

  out += `  <navMap>\n`;
  for (const np of nps) out += renderNavPoint(np, 4);
  out += `  </navMap>\n`;
  out += `</ncx>\n`;
  return out;
}

/**
 * NCX 美化 stage：找出 epub 内所有 *.ncx 文件，重新格式化为缩进结构。
 * 解析失败时跳过该文件（保留原内容）+ 警告。
 *
 * @param {{ names: string[], entries: object, meta?: any }} buf
 * @param {object} [ctx]
 * @returns {{ names: string[], entries: object, meta?: any }}
 */
export function ncxFormat(buf, ctx) {
  const newEntries = { ...buf.entries };
  let formatted = 0;
  for (const name of Object.keys(buf.entries)) {
    if (!name.toLowerCase().endsWith(".ncx")) continue;
    try {
      const raw = buf.entries[name].toString("utf8");
      const parsed = parser.parse(raw);
      if (!parsed.ncx || !parsed.ncx.navMap || !parsed.ncx.navMap.navPoint) continue;
      const out = renderNcx(parsed);
      newEntries[name] = Buffer.from(out, "utf8");
      formatted++;
    } catch (err) {
      console.warn(`[ncx-format] 跳过 ${name}: ${err.message}`);
    }
  }
  if (formatted > 0) console.log(`[ncx-format] 美化 ${formatted} 个 NCX 文件`);
  return { ...buf, entries: newEntries };
}
