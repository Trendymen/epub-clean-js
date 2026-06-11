// hyread/scripts/2b-save-downloaded.mjs
// 把浏览器下载的分批 JSON 解码存入 resources/ 目录
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ASSET_ID, RESOURCES } from '../config.mjs';

const OUT = RESOURCES;
const BASE = `ebookservice/epub/${ASSET_ID}`;

async function saveBatch(batchFile) {
  const data = JSON.parse(await readFile(batchFile, 'utf8'));
  let saved = 0;
  for (const [rel, info] of Object.entries(data)) {
    if (info.err) {
      console.log(`ERR  ${rel}  ${info.err}`);
      continue;
    }
    const dest = join(OUT, BASE, 'item', rel);
    await mkdir(dirname(dest), { recursive: true });
    const buf = Buffer.from(info.b64, 'base64');
    await writeFile(dest, buf);
    console.log(`OK  ${String(buf.length).padStart(8)}  ${rel}`);
    saved++;
  }
  return saved;
}

const batches = [
  join(import.meta.dirname, '..', 'work', '13', 'batch1.json'),
  join(import.meta.dirname, '..', 'work', '13', 'batch2.json'),
  join(import.meta.dirname, '..', 'work', '13', 'batch3_images.json'),
];

let total = 0;
for (const b of batches) total += await saveBatch(b);
console.log(`\n保存完成：${total} 个文件 -> ${OUT}`);
