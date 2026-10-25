import { test } from "node:test";
import assert from "node:assert";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { normalize } from "./_helpers/diff.js";
import { RAW_ROOT, runCli } from "./_helpers/run-cli.js";

const SRC = path.join(RAW_ROOT, "义妹生活 - 09台简粗糙排版.epub");
const DST = path.join(RAW_ROOT, "[三河ごーすと].义妹生活.09.[日翻].epub");
const REF = path.join(RAW_ROOT, "[三河ごーすと].义妹生活.07.[台简].epub");

test("e2e: migrate-translation 输出与 golden manifest normalized hash 100% 一致", { timeout: 180_000 }, async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'yimei09-manifest-e2e-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const out = path.join(temp, 'output.epub');
  // 1. 跑 CLI
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

  // 2. 用独立 ZIP 实现读取输出。
  const zip = new AdmZip(out);

  // 3. 读 golden manifest
  const manifest = JSON.parse(
    await readFile(
      new URL("../fixtures/yimei09/golden-manifest.json", import.meta.url),
      "utf8",
    ),
  );

  // 4. 逐文件比对
  const mismatches = [];
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const entry = zip.getEntry(rel);
    if (!entry) {
      mismatches.push({ rel, reason: "missing" });
      continue;
    }
    const actual = createHash("sha256")
      .update(normalize(entry.getData(), path.posix.extname(rel)))
      .digest("hex");
    if (actual !== expected.sha256_normalized) {
      mismatches.push({
        rel,
        reason: "hash_diff",
        expected: expected.sha256_normalized,
        actual,
      });
    }
  }

  if (mismatches.length > 0) {
    console.error("Mismatches:");
    for (const m of mismatches.slice(0, 15)) console.error(` ${m.rel}: ${m.reason}`);
    console.error(`Total ${mismatches.length} / ${Object.keys(manifest.files).length}`);
  }
  assert.strictEqual(
    mismatches.length,
    0,
    `${mismatches.length} files differ from golden manifest`,
  );
});
