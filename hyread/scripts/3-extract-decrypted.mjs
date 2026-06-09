// hyread/scripts/3-extract-decrypted.mjs
//
// 步骤 4a：把 grab_xml.json 里的解密正文按原文件名导出成独立 xhtml 文件夹。
// 用于查阅"原汁原味"的解密正文（含阅读器渲染态 class，未做 EPUB 清理）。
// 组装最终 EPUB 不依赖本步骤，可跳过。
//
// 输入：work/<卷>/grab_xml.json
// 输出：work/<卷>/decrypted/xhtml/*.xhtml
//
// 用法：node hyread/scripts/3-extract-decrypted.mjs

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { GRAB_JSON, DECRYPTED } from '../config.mjs';

const j = JSON.parse(readFileSync(GRAB_JSON, 'utf8'));
const relOf = (src) => src.split('/item/')[1]; // xhtml/p-xxx.xhtml

let written = 0;
for (const src of j.order) {
  const dest = join(DECRYPTED, relOf(src));
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, j.data[src], 'utf8');
  written++;
}

console.log(`写入解密 XHTML：${written} 个 -> ${DECRYPTED}`);
