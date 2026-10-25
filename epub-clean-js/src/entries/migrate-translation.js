import { parseArgs } from "node:util";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const { values: opts } = parseArgs({
  options: {
    src:     { type: "string" },
    dst:     { type: "string" },
    ref:     { type: "string" },
    out:     { type: "string" },
    volume:  { type: "string", default: "09" },
    book:    { type: "string", default: "yimei-seikatsu" },
  },
  strict: true,
});

// 必填校验：src / dst / ref 必须显式提供，out 可选（默认走 profile）
for (const k of ["src", "dst", "ref"]) {
  if (!opts[k]) {
    console.error(`Missing required --${k}`);
    process.exit(2);
  }
}

const booksRoot = fileURLToPath(new URL("../../books/", import.meta.url));
const profileMod = await import(pathToFileURL(path.resolve(booksRoot, opts.book, "profile.js")).href);
const profile = profileMod.default;
const migrateMod = await import(pathToFileURL(path.resolve(booksRoot, opts.book, "migrate/migrate-epub.js")).href);

// out 可选：默认 profile.paths.translatedDir + filePatterns.translated(volume)
const outDefault = path.join(
  profile.paths.translatedDir,
  profile.filePatterns.translated(opts.volume),
);
const outPath = opts.out ? path.resolve(opts.out) : outDefault;

// 确保输出目录存在
fs.mkdirSync(path.dirname(outPath), { recursive: true });

await migrateMod.default({
  srcEpub: path.resolve(opts.src),
  dstEpub: path.resolve(opts.dst),
  refEpub: path.resolve(opts.ref),
  outEpub: outPath,
  volume: opts.volume,
  profile,
});

console.log("migrate-translation 完成:", outPath);
