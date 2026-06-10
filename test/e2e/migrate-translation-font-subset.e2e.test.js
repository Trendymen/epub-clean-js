import { test } from "node:test";
import assert from "node:assert";
import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import AdmZip from "adm-zip";

const PROJ = "/Users/liuzhuo/Downloads/资源/义妹生活";
const SRC = `${PROJ}/义妹生活 - 09台简粗糙排版.epub`;
const DST = `${PROJ}/[三河ごーすと].义妹生活.09.[日翻].epub`;
const REF = `${PROJ}/[三河ごーすと].义妹生活.07.[台简].epub`;
const OUT = "/tmp/yimei09-font-subset.e2e.epub";

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "pipe", ...opts });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`${cmd} exit ${code}: ${stderr}`)),
    );
  });
}

test("e2e: migrate-translation 输出只保留 6 个思源 subset 字体并在 OPF 标成 font/otf", { timeout: 180_000 }, async () => {
  await rm(OUT, { force: true });
  await run(
    "node",
    [
      "bin/cli.js",
      "migrate-translation",
      "--src",
      SRC,
      "--dst",
      DST,
      "--ref",
      REF,
      "--out",
      OUT,
      "--volume",
      "09",
      "--book",
      "yimei-seikatsu",
    ],
    { cwd: path.resolve(import.meta.dirname, "../..") },
  );

  const zip = new AdmZip(OUT);
  const fontEntries = zip
    .getEntries()
    .filter((entry) => /^OEBPS\/Fonts\/[^/]+$/i.test(entry.entryName))
    .map((entry) => path.basename(entry.entryName))
    .sort();

  assert.deepStrictEqual(fontEntries, [
    "SourceHanSansSC-Regular.subset.otf",
    "SourceHanSerifSC-Bold.subset.otf",
    "SourceHanSerifSC-BoldSub.subset.otf",
    "SourceHanSerifSC-Light.subset.otf",
    "SourceHanSerifSC-Medium.subset.otf",
    "SourceHanSerifSC-SemiBold.subset.otf",
  ]);

  const opf = zip.getEntry("OEBPS/content.opf")?.getData().toString("utf8") ?? "";
  assert.match(opf, /SourceHanSansSC-Regular\.subset\.otf/);
  assert.match(opf, /SourceHanSerifSC-Light\.subset\.otf/);
  assert.match(opf, /SourceHanSerifSC-Medium\.subset\.otf/);
  assert.match(opf, /SourceHanSerifSC-SemiBold\.subset\.otf/);
  assert.match(opf, /SourceHanSerifSC-Bold\.subset\.otf/);
  assert.match(opf, /SourceHanSerifSC-BoldSub\.subset\.otf/);
  assert.doesNotMatch(opf, /SourceHanSansSC-Bold|SourceHanSerifSC-Heavy/);
  assert.match(opf, /media-type="font\/otf"/);
  assert.doesNotMatch(opf, /Fonts\/(?:ch\d|ctt\d|main|sum|mes|note|emoji|sym|int)\.ttf/);
});
