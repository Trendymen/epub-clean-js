#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import profile from "../../books/yimei-seikatsu/profile.js";
import { readEpub, writeEpub } from "../core/zip-io.js";
import { runPipeline } from "../core/pipeline.js";
import { strip, deobfuscate, heal, footnoteFix, ncxFormat } from "../core/stages/index.js";
import { selectHealInputs } from "./heal-inputs.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`用法：npm run heal -- [路径或glob ...]

无参数：扫描源目录顶层，选择卷号 >=11 的 [三河ごーすと].义妹生活.NN.[日翻].epub。
有参数：只处理指定文件或 glob 匹配的合规源文件，每个参数都必须匹配。
相对路径和 glob 的基准：${profile.paths.rawDir}
先按字面路径查找（保留文件名中的方括号），不存在时再按 glob 解析。
glob 请加引号，例如：npm run heal -- "*16*.epub" "*17*.epub"
输出目录：${profile.paths.healedDir}`);
    return;
  }
  const selected = await selectHealInputs(profile, args);
  fs.mkdirSync(profile.paths.healedDir, { recursive: true });
  for (const { src, dst, vol } of selected) {
    const inBuf = await readEpub(src);
    // 所选源为日翻版；heal stage 幂等追加 dc:title 的 [日翻] 尾缀。
    const outBuf = await runPipeline(inBuf, [strip, deobfuscate, heal, footnoteFix, ncxFormat], { profile, volNum: vol, srcPath: src, titleLangSuffix: "[日翻]" });
    await writeEpub(dst, outBuf.entries);
    console.log(`✅ 卷 ${vol} → ${path.basename(dst)} (${fs.statSync(dst).size.toLocaleString()} B)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
