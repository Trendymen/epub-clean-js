// test/e2e/footnote-fix.e2e.test.js
//
// e2e：通用 footnote-fix CLI 在 V3-duokan-minimal.epub 上能把
// 旧多看锚点 + 旧 aside 升级为 V8 多端兼容 STERA 结构。
//
// 不加载 yimei-seikatsu profile，验证 footnote-fix 的通用入口。
import { test } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { PROJECT_ROOT, runCli } from "./_helpers/run-cli.js";

const FIXTURE_IN = path.join(PROJECT_ROOT, "test/fixtures/footnote_epubs/V3-duokan-minimal.epub");

test("e2e: footnote-fix 升级 V3-duokan-minimal epub 到 V8 STERA", { timeout: 60_000 }, async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'footnote-fix-e2e-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const out = path.join(temp, 'output.epub');
  // 1. 运行 CLI
  const { stdout } = await runCli(["footnote-fix", "--in", FIXTURE_IN, "--out", out]);
  assert.match(stdout, /footnote-fix 完成/);

  // 2. 用独立 ZIP 实现检查输出。
  const zip = new AdmZip(out);
  const entries = zip.getEntries();

  // 3. 定位章节目录（V3 fixture 用 OEBPS/Text）
  const candidates = ["OEBPS/Text", "Text", "OPS/Text"];
  const textDir = candidates.find((dir) => entries.some((entry) => entry.entryName.startsWith(`${dir}/`)));
  assert.ok(textDir, `找不到章节目录，ZIP 条目: ${entries.map((entry) => entry.entryName).join(", ")}`);

  // 4. V3 fixture 实际章节文件名是 test.xhtml（不是 chapter1.xhtml）
  const xhtmlFiles = entries.filter((entry) => !entry.isDirectory
    && path.posix.dirname(entry.entryName) === textDir
    && /\.x?html$/.test(entry.entryName));
  assert.ok(xhtmlFiles.length > 0, "升级后章节目录应至少有 1 个 xhtml");

  // 找到含 footnote 升级痕迹的章节（V3 fixture 是 test.xhtml）
  let chapterContent = "";
  let chapterName = "";
  for (const entry of xhtmlFiles) {
    const c = entry.getData().toString("utf8");
    if (c.includes("duokan-footnote") || c.includes("note_ref001")) {
      chapterContent = c;
      chapterName = entry.entryName;
      break;
    }
  }
  assert.ok(chapterContent, `没找到包含升级后 footnote 的章节，候选: ${xhtmlFiles.map((entry) => entry.entryName).join(", ")}`);

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
