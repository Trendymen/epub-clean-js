import { test } from "node:test";
import assert from "node:assert";
import { rm, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { RAW_ROOT, runCli } from "./_helpers/run-cli.js";

const SRC = path.join(RAW_ROOT, "义妹生活 - 09台简粗糙排版.epub");
const DST = path.join(RAW_ROOT, "[三河ごーすと].义妹生活.09.[日翻].epub");
const REF = path.join(RAW_ROOT, "[三河ごーすと].义妹生活.07.[台简].epub");

test("e2e: migrate-translation 输出只保留 6 个思源 subset 字体并在 OPF 标成 font/otf", { timeout: 180_000 }, async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'yimei09-font-e2e-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const out = path.join(temp, 'output.epub');
  await runCli(
    [
      "migrate-translation",
      "--src",
      SRC,
      "--dst",
      DST,
      "--ref",
      REF,
      "--out",
      out,
      "--volume",
      "09",
      "--book",
      "yimei-seikatsu",
    ],
  );

  const zip = new AdmZip(out);
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
