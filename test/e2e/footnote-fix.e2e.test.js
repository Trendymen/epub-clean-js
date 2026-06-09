// test/e2e/footnote-fix.e2e.test.js
//
// e2e：通用 footnote-fix CLI 在 V3-duokan-minimal.epub 上能把
// 旧多看锚点 + 旧 aside 升级为 V8 多端兼容 STERA 结构。
//
// 这个测试不依赖 yimei-seikatsu profile —— 验证 footnote-fix 是真·通用工具。
import { test } from "node:test";
import assert from "node:assert";
import { readFile, rm, mkdir, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const OUT = "/tmp/footnote-fix-e2e.epub";
const UNPACK = "/tmp/footnote-fix-e2e-unpacked";
const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
const FIXTURE_IN = path.join(PROJECT_ROOT, "test/fixtures/footnote_epubs/V3-duokan-minimal.epub");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`${cmd} ${args.join(" ")} exit ${code}\nstderr: ${stderr}`)),
    );
  });
}

test("e2e: footnote-fix 升级 V3-duokan-minimal epub 到 V8 STERA", { timeout: 60_000 }, async () => {
  // 1. 运行 CLI
  await rm(OUT, { force: true });
  const { stdout } = await run("node", ["bin/cli.js", "footnote-fix", "--in", FIXTURE_IN, "--out", OUT], {
    cwd: PROJECT_ROOT,
  });
  assert.match(stdout, /footnote-fix 完成/);

  // 2. 解包查看
  await rm(UNPACK, { recursive: true, force: true });
  await mkdir(UNPACK, { recursive: true });
  await run("unzip", ["-q", OUT, "-d", UNPACK]);

  // 3. 定位章节目录（V3 fixture 用 OEBPS/Text）
  const candidates = ["OEBPS/Text", "Text", "OPS/Text"];
  let textDir = null;
  for (const c of candidates) {
    try {
      await readdir(path.join(UNPACK, c));
      textDir = c;
      break;
    } catch {
      // continue
    }
  }
  if (!textDir) {
    const root = await readdir(UNPACK);
    throw new Error(`找不到章节目录，UNPACK 根: ${root.join(", ")}`);
  }

  // 4. V3 fixture 实际章节文件名是 test.xhtml（不是 chapter1.xhtml）
  const xhtmlFiles = (await readdir(path.join(UNPACK, textDir))).filter(
    (f) => f.endsWith(".xhtml") || f.endsWith(".html"),
  );
  assert.ok(xhtmlFiles.length > 0, "升级后章节目录应至少有 1 个 xhtml");

  // 找到含 footnote 升级痕迹的章节（V3 fixture 是 test.xhtml）
  let chapterContent = "";
  let chapterName = "";
  for (const f of xhtmlFiles) {
    const c = await readFile(path.join(UNPACK, textDir, f), "utf8");
    if (c.includes("duokan-footnote") || c.includes("note_ref001")) {
      chapterContent = c;
      chapterName = f;
      break;
    }
  }
  assert.ok(chapterContent, `没找到包含升级后 footnote 的章节，候选: ${xhtmlFiles.join(", ")}`);

  // 5. V8 多端兼容关键标记
  assert.match(
    chapterContent,
    /<sub><a class="duokan-footnote" epub:type="noteref"/,
    `[${chapterName}] 锚点应为 <sub><a class="duokan-footnote" epub:type="noteref">`,
  );
  assert.match(chapterContent, /href="#note001"/, "锚点 href 应指向 #note001");
  assert.match(chapterContent, /id="note_ref001"/, "锚点 id 应为 note_ref001");
  assert.match(chapterContent, /width="25"/, "img 应有 width=\"25\"");
  assert.match(chapterContent, /class="zhangyue-footnote"/, "img 应有 zhangyue-footnote class");
  assert.match(chapterContent, /zy-footnote="/, "img 应有 zy-footnote 属性");

  assert.match(
    chapterContent,
    /<aside epub:type="footnote" id="note001"/,
    "应有 V8 aside，id=note001",
  );
  assert.match(
    chapterContent,
    /<ol class="duokan-footnote-content" style="list-style:none">/,
    "aside 内 ol 应有 style=list-style:none",
  );
  assert.match(
    chapterContent,
    /<li class="duokan-footnote-item" id="note001"/,
    "li id 应为 note001",
  );
  // V8：li 内 <p> 直接含正文，不再有 "<a href="#note_refNNN">注N</a>：" 反向链接前缀
  assert.ok(
    !chapterContent.includes('<a href="#note_ref001">'),
    "V8：p 内不应含反向链接 <a href=\"#note_ref001\">",
  );
  assert.match(
    chapterContent,
    /<li class="duokan-footnote-item" id="note001"><p>[^<]/,
    "V8：li 内 <p> 应直接含正文文本",
  );

  // 6. 不应残留旧版痕迹
  assert.ok(!chapterContent.includes('id="note01"'), "不应残留旧 id=note01");
  assert.ok(!chapterContent.includes('value="01"'), "不应残留旧 li value=01");
});
