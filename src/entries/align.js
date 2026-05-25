#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import profile from "../../books/yimei-seikatsu/profile.js";
import { readEpub, writeEpub } from "../core/zip-io.js";
import { runPipeline } from "../core/pipeline.js";
import { strip, deobfuscate, heal, align } from "../core/stages/index.js";
import { validateOutput } from "../core/validator.js";

async function main() {
  fs.mkdirSync(profile.paths.cleanDir, { recursive: true });
  for (const vol of profile.vols) {
    const src = path.join(profile.paths.rawDir, profile.filePatterns.raw(vol));
    const dst = path.join(profile.paths.cleanDir, profile.filePatterns.clean(vol));
    if (!fs.existsSync(src)) {
      console.log(`⚠️  跳过 ${vol}: ${src} 不存在`);
      continue;
    }
    const inBuf = await readEpub(src);
    // 11-15 卷内容是日翻版（用户已确认没有台简译文） → dc:title 末尾打 [日翻] 尾缀（heal stage 内幂等）
    const outBuf = await runPipeline(inBuf, [strip, deobfuscate, heal, align], { profile, volNum: vol, srcPath: src, titleLangSuffix: "[日翻]" });
    await writeEpub(dst, outBuf.entries);
    const r = await validateOutput(dst);
    const flag = r.ok ? "✅" : "❌";
    console.log(`${flag} 卷 ${vol} → ${path.basename(dst)} issues=${r.issues.length} broken=${r.brokenLinks.length}`);
    for (const i of r.issues.slice(0, 3)) console.log(`    - ${i}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
