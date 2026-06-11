// 一次性：对 08 日翻跑与 heal.js 相同的管线，产出 healed 08（08 不在 profile.vols，故单独跑）。
import path from 'node:path';
import fs from 'node:fs';
import profile from './books/yimei-seikatsu/profile.js';
import { readEpub, writeEpub } from './src/core/zip-io.js';
import { runPipeline } from './src/core/pipeline.js';
import { strip, deobfuscate, heal, footnoteFix, ncxFormat } from './src/core/stages/index.js';

const vol = 8;
const src = path.join(profile.paths.rawDir, profile.filePatterns.raw(vol));
const dst = path.join(profile.paths.healedDir, profile.filePatterns.healed(vol));
if (!fs.existsSync(src)) { console.error('缺源:', src); process.exit(1); }

const inBuf = await readEpub(src);
const outBuf = await runPipeline(
  inBuf,
  [strip, deobfuscate, heal, footnoteFix, ncxFormat],
  { profile, volNum: vol, srcPath: src, titleLangSuffix: '[日翻]' },
);
fs.mkdirSync(profile.paths.healedDir, { recursive: true });
await writeEpub(dst, outBuf.entries);
console.log('✅ healed 08:', path.basename(dst), fs.statSync(dst).size.toLocaleString(), 'B');
