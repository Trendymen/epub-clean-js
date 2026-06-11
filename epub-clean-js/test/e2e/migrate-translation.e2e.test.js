import { test } from "node:test";
import assert from "node:assert";
import { readFile, rm, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { hashFile } from "./_helpers/diff.js";

const PROJ = "/Users/liuzhuo/Downloads/资源/义妹生活";
const SRC = `${PROJ}/义妹生活 - 09台简粗糙排版.epub`;
const DST = `${PROJ}/[三河ごーすと].义妹生活.09.[日翻].epub`;
const REF = `${PROJ}/[三河ごーすと].义妹生活.07.[台简].epub`;
const OUT = "/tmp/yimei09-node-e2e.epub";
const UNPACK = "/tmp/yimei09-node-e2e-unpacked";

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

test("e2e: migrate-translation 输出与 golden manifest normalized hash 100% 一致", { timeout: 180_000 }, async () => {
  // 1. 跑 CLI
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

  // 2. 解包输出
  await rm(UNPACK, { recursive: true, force: true });
  await mkdir(UNPACK, { recursive: true });
  await run("unzip", ["-q", OUT, "-d", UNPACK]);

  // 3. 读 golden manifest
  const manifest = JSON.parse(
    await readFile(
      path.resolve(import.meta.dirname, "../fixtures/yimei09/golden-manifest.json"),
      "utf8",
    ),
  );

  // 4. 逐文件比对
  const mismatches = [];
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const fp = path.join(UNPACK, rel);
    let actual;
    try {
      actual = await hashFile(fp);
    } catch (e) {
      mismatches.push({ rel, reason: "missing" });
      continue;
    }
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
