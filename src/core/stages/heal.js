// src/core/stages/heal.js
import crypto from "node:crypto";
import path from "node:path/posix";
import { statSync } from "node:fs";
import { Buffer } from "node:buffer";
import {
  serializeOpf,
  findFirst,
  childrenOf,
  findDirectChildren,
  getAttr,
  setText,
  makeNode,
} from "../opf.js";

function tagName(node) {
  for (const k of Object.keys(node)) if (k !== ":@") return k;
  return null;
}

// dc:title 末尾追加语言版本尾缀（如 ` [台简]`），用于在阅读器书架上区分。
// 不重复追加：已存在形如 [台简] / [日翻] / [台繁] 等 [...]/【...】 尾缀时跳过。
// 也保证不把内部状态尾缀（.healed/.translated/.clean，那是物理文件名的事）写进卷标题。
function patchDcTitleLangSuffix(metadata, suffix) {
  if (!suffix) return;
  for (const node of childrenOf(metadata)) {
    if (tagName(node) !== "dc:title") continue;
    const arr = node["dc:title"];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    // 取首个 #text 子节点
    const txtNode = arr.find((c) => "#text" in c);
    if (!txtNode) continue;
    const cur = String(txtNode["#text"] ?? "").trim();
    if (!cur) continue;
    // 已带 [xxx] 或【xxx】尾缀则不动
    if (/[\[【][^\]】]+[\]】]\s*$/.test(cur)) continue;
    txtNode["#text"] = `${cur} ${suffix}`;
  }
}

function patchMetadataCommon(pkg, srcPath, titleLangSuffix) {
  const metadata = findFirst(childrenOf(pkg), "metadata");
  if (!metadata) return;
  const kids = childrenOf(metadata);

  // 0. dc:title 语言版本尾缀（如 [台简]） — 11-15 卷反混淆后内容是台简
  patchDcTitleLangSuffix(metadata, titleLangSuffix);

  // 1. 删 duokan/zhangyue identifier + 关联 refines
  const refinedIds = new Set();
  for (let i = kids.length - 1; i >= 0; i--) {
    const n = kids[i];
    if (tagName(n) === "dc:identifier") {
      const idv = getAttr(n, "id");
      if (idv === "duokan-book-id" || idv === "zhangyue-book-id") {
        refinedIds.add("#" + idv);
        kids.splice(i, 1);
      }
    }
  }
  for (let i = kids.length - 1; i >= 0; i--) {
    const n = kids[i];
    if (tagName(n) === "meta" && refinedIds.has(getAttr(n, "refines"))) {
      kids.splice(i, 1);
    }
  }

  // 2. BookId UUID
  const hasBookId = kids.some(
    (n) => tagName(n) === "dc:identifier" && getAttr(n, "id") === "BookId",
  );
  if (!hasBookId) {
    const stat = statSync(srcPath);
    const seed = `${path.basename(srcPath)}:${stat.size}`;
    const uid = crypto.createHash("md5").update(seed).digest("hex");
    kids.push(makeNode("dc:identifier", { id: "BookId" }, `urn:uuid:${uid}`));
  }

  // 3. dcterms:modified — 运行时今日 ISO
  const isoNow = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  let modifiedNode = kids.find(
    (n) => tagName(n) === "meta" && getAttr(n, "property") === "dcterms:modified",
  );
  if (!modifiedNode) {
    modifiedNode = makeNode("meta", { property: "dcterms:modified" }, isoNow);
    kids.push(modifiedNode);
  } else {
    setText(modifiedNode, isoNow);
  }

  // 4. <meta name="cover">（补缺）
  const hasCoverMeta = kids.some(
    (n) => tagName(n) === "meta" && getAttr(n, "name") === "cover",
  );
  if (!hasCoverMeta) {
    const manifest = findFirst(childrenOf(pkg), "manifest");
    if (manifest) {
      for (const item of findDirectChildren(manifest, "item")) {
        const mt = getAttr(item, "media-type") ?? "";
        const id = getAttr(item, "id") ?? "";
        if (mt.startsWith("image/") && id.toLowerCase().includes("cover")) {
          kids.push(makeNode("meta", { name: "cover", content: id }));
          break;
        }
      }
    }
  }
}

function sanitizeCssOrphanFontFace(cssText, cssZipPath, zipEntryNames) {
  return cssText.replace(/@font-face\s*\{[^}]*\}/g, (rule) => {
    const m = /url\(\s*([^)\s'"]+)\s*\)/.exec(rule);
    if (!m) return rule;
    const url = m[1];
    if (/^(data:|https?:|mailto:|tel:)/i.test(url)) return rule;
    if (!/[*|?]/.test(url)) return rule;
    const cssDir = path.dirname(cssZipPath);
    const resolved = path.normalize(path.join(cssDir, url));
    return zipEntryNames.has(resolved) ? rule : "";
  });
}

export function heal(buf, ctx) {
  const { opfPath, opfTree } = buf.meta;
  const pkg = findFirst(opfTree, "package");

  // ctx.titleLangSuffix 由调用方注入（如 entries/heal.js 传 "[台简]"）；缺省不动 title
  patchMetadataCommon(pkg, ctx.srcPath, ctx.titleLangSuffix);

  // 序列化 OPF（heal 写入第一次，后续 align 可能再覆盖）
  const newEntries = { ...buf.entries };
  newEntries[opfPath] = Buffer.from(serializeOpf(opfTree), "utf-8");

  // 孤儿 @font-face 清理：遍历所有 *.css
  const zipNames = new Set(buf.names);
  for (const name of buf.names) {
    if (!name.toLowerCase().endsWith(".css")) continue;
    const before = newEntries[name].toString("utf-8");
    const after = sanitizeCssOrphanFontFace(before, name, zipNames);
    if (after !== before) {
      newEntries[name] = Buffer.from(after, "utf-8");
    }
  }

  return { ...buf, entries: newEntries };
}
