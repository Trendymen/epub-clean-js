// hyread/scripts/2-download-epub-content.mjs
//
// 步骤 2（必需）：按 OPF 清单下载该卷 EPUB 的全部原始内容。
//   standard.opf + 全部 xhtml(加密) + css(明文) + image(明文)
// 这些 HyRead 资源无需登录态即可下载（仅 xhtml 是加密的，正文由步骤 3 在浏览器端解密）。
// 通用脚本——只依赖 config.ASSET_ID，换卷无需改动本文件。
//
// 用法：node hyread/scripts/2-download-epub-content.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ITEM_BASE, RESOURCES, ASSET_ID } from '../config.mjs';

const OUT = RESOURCES;

// 1. 拉取 OPF 清单
const opfText = await (await fetch(ITEM_BASE + 'standard.opf')).text();
const hrefs = [...opfText.matchAll(/<item\b[^>]*\bhref="([^"]+)"[^>]*>/g)].map((m) => m[1]);
const extras = ['standard.opf'];

const localPath = (relFromEpub) =>
  join(OUT, `ebookservice/epub/${ASSET_ID}`, relFromEpub.replace(/:/g, '_'));

async function dl(relFromItem) {
  const res = await fetch(ITEM_BASE + relFromItem);
  const buf = Buffer.from(await res.arrayBuffer());
  const dest = localPath('item/' + relFromItem);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return { rel: relFromItem, status: res.status, bytes: buf.length };
}

const all = [...new Set([...extras, ...hrefs])];
console.log(`OPF 清单解析出 ${hrefs.length} 个文件，开始下载 ${all.length} 项...\n`);

const POOL = 8;
const results = [];
let i = 0;
async function worker() {
  while (i < all.length) {
    const idx = i++;
    try {
      const r = await dl(all[idx]);
      results[idx] = r;
      console.log(`${r.status === 200 ? 'OK ' : `!${r.status}`} ${String(r.bytes).padStart(8)}  ${r.rel}`);
    } catch (e) {
      results[idx] = { rel: all[idx], error: String(e) };
      console.log(`ERR  ${all[idx]}  ${e}`);
    }
  }
}
await Promise.all(Array.from({ length: POOL }, worker));

const ok = results.filter((r) => r && !r.error && r.status === 200);
const bad = results.filter((r) => r && (r.error || r.status !== 200));
const total = ok.reduce((a, r) => a + r.bytes, 0);
console.log(`\n完成：成功 ${ok.length} / ${all.length}，问题 ${bad.length}，总计 ${(total / 1024 / 1024).toFixed(2)} MB`);
console.log(`保存目录：${OUT}`);
if (bad.length) console.log('  问题项:', bad.map((b) => b.rel + (b.error ? `(${b.error})` : `(${b.status})`)).join(', '));
