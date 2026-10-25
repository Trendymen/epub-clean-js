// tools/epub-clean-js/test/scripts/build-golden-manifest.mjs
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../fixtures/yimei09/golden-py", import.meta.url));
const OUT = fileURLToPath(new URL("../fixtures/yimei09/golden-manifest.json", import.meta.url));

async function walk(dir, base = ROOT) {
  const ents = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

// 公共 normalize：build-golden + e2e 比对必须使用同一份规则
// 否则 golden hash 与候选 hash 在不同 mask 下永远对不上
//
// byte-level 一致化完成后，仅保留 3 条动态字段 mask（每次构建必然不同的字段）；
// 所有结构性 / 缩进 / 标签 / trailing newline 差异都由 builder 端直接对齐 Python golden。
export function normalize(buf, ext) {
  const isText = [".xhtml", ".html", ".xml", ".opf", ".ncx", ".css", ".js"].includes(ext);
  if (!isText) return buf;
  let s = buf.toString("utf8");
  // mask 动态字段（每次构建产出 epub 都不同，必须屏蔽才能稳定 hash）
  // 1. urn:uuid:XXXX 形式（content.opf / toc.ncx 中的 dc:identifier）
  s = s.replace(/urn:uuid:[0-9a-fA-F-]{36}/g, "urn:uuid:00000000-0000-0000-0000-000000000000");
  // 2. 裸 UUID（OPF item id、NCX dtb:uid 等可能不带 urn: 前缀）
  s = s.replace(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX");
  // 3. ISO 8601 时间戳（content.opf 的 dcterms:modified）
  s = s.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z\b/g, "0000-00-00T00:00:00Z");
  return Buffer.from(s, "utf8");
}

const files = (await walk(ROOT)).sort();
const manifest = {
  source: "[三河ごーすと].义妹生活.09.[台简].epub (Python 版, 引言修复后)",
  generated_at: new Date().toISOString(),
  files: {},
};

for (const rel of files) {
  const buf = await readFile(path.join(ROOT, ...rel.split('/')));
  const ext = path.posix.extname(rel);
  const normalized = normalize(buf, ext);
  const hash = createHash("sha256").update(normalized).digest("hex");

  const entry = { sha256_normalized: hash, bytes: buf.length };

  // 章节文件附加 para_count 与 footnote_count
  if (rel.includes("Text/chapter") || rel.includes("Text/special")) {
    const html = buf.toString("utf8");
    const stripped = html.replace(/<aside[\s\S]*?<\/aside>/g, "");
    const paraCount = (stripped.match(/<p[^>]*>/g) ?? []).length;
    const fnCount = (html.match(/<aside epub:type="footnote"/g) ?? []).length;
    entry.para_count = paraCount;
    entry.footnote_count = fnCount;
  }

  manifest.files[rel] = entry;
}

await writeFile(OUT, JSON.stringify(manifest, null, 2));
console.log(`Wrote ${Object.keys(manifest.files).length} entries to ${OUT}`);
