// epub-clean-js/test/e2e/_helpers/diff.js
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

// 注意：normalize 规则必须与 test/scripts/build-golden-manifest.mjs 保持 1:1 同步
// 不直接 import 是因为 build-golden-manifest.mjs 有 top-level 副作用（重写 golden-manifest.json），
// import 会在 e2e 测试启动时意外触发重写。任何对该文件 normalize 的修改请同步到此处。
//
// byte-level 一致化完成后，仅保留 3 条动态字段 mask（每次构建必然不同的字段）；
// 所有结构性 / 缩进 / 标签 / trailing newline 差异都由 builder 端直接对齐 Python golden。
export function normalize(buf, ext) {
  const isText = [".xhtml", ".html", ".xml", ".opf", ".ncx", ".css", ".js"].includes(ext);
  if (!isText) return buf;
  let s = buf.toString("utf8");
  // mask 动态字段
  // 1. urn:uuid:XXXX
  s = s.replace(/urn:uuid:[0-9a-fA-F-]{36}/g, "urn:uuid:00000000-0000-0000-0000-000000000000");
  // 2. 裸 UUID
  s = s.replace(
    /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
    "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
  );
  // 3. ISO 8601 时间戳
  s = s.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z\b/g, "0000-00-00T00:00:00Z");
  return Buffer.from(s, "utf8");
}

export async function walk(dir, base = dir) {
  const ents = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full));
  }
  return out.sort();
}

export async function hashFile(filePath) {
  const buf = await readFile(filePath);
  const ext = path.extname(filePath);
  const normalized = normalize(buf, ext);
  return createHash("sha256").update(normalized).digest("hex");
}
