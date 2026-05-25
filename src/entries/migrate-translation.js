import { parseArgs } from "node:util";
import path from "node:path";

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

for (const k of ["src", "dst", "ref", "out"]) {
  if (!opts[k]) {
    console.error(`Missing required --${k}`);
    process.exit(2);
  }
}

const profileMod = await import(path.resolve("books", opts.book, "profile.js"));
const profile = profileMod.default;
const migrateMod = await import(path.resolve("books", opts.book, "migrate/migrate-epub.js"));

await migrateMod.default({
  srcEpub: path.resolve(opts.src),
  dstEpub: path.resolve(opts.dst),
  refEpub: path.resolve(opts.ref),
  outEpub: path.resolve(opts.out),
  volume: opts.volume,
  profile,
});

console.log("migrate-translation 完成:", opts.out);
