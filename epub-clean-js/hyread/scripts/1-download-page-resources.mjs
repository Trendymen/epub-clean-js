// hyread/scripts/1-download-page-resources.mjs
//
// 步骤 1（可选）：下载 HyRead 阅读器页面"已加载的所有静态资源"。
//   - 阅读器运行时（onlineReader.js / fdhw.js / *.wasm 等）
//   - 当时页面加载到的 EPUB 内容片段、背景音频
// 对"重建 EPUB"非必需（EPUB 全量内容由步骤 2 下载）；此脚本用于归档阅读器运行时快照。
//
// 注意：下面的 URL 列表是某次抓取会话的快照——
//   · 阅读器 bundle 的 hash 文件名随阅读器版本变化；
//   · EPUB 内容部分（/epub/<asset_id>/…）随卷的 asset_id 变化。
// 换卷/换版本时，请在阅读器页面的 devtools 重新执行：
//   performance.getEntriesByType('resource').map(r => r.name)
// 取得新列表替换。
//
// 用法：node hyread/scripts/1-download-page-resources.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SERVICE, RESOURCES } from '../config.mjs';

const OUT = RESOURCES;
const BASE = SERVICE;

// 某次会话的静态资源快照（阅读器运行时 + EPUB 内容片段 + 背景音频）
const urls = [
  // —— 阅读器 JS / wasm / svg ——
  '/ebookservice/epubreader/hyread/v3/public/593616de15330c0fb2d55e55410bf994.8db42dd68e8dbaf3a36b.js',
  '/ebookservice/epubreader/hyread/v3/public/baea07f834eab6b867d26e23d3e12d4e.8db42dd68e8dbaf3a36b.js',
  '/ebookservice/epubreader/hyread/v3/public/1343bc84a7167c7a3a27d0c2b2240030.8db42dd68e8dbaf3a36b.js',
  '/ebookservice/epubreader/hyread/v3/public/0eb9b3af2e4a00837a1b1a854c9ea18c.8db42dd68e8dbaf3a36b.js',
  '/ebookservice/epubreader/hyread/v3/public/32bb636196f91ed59d7a49190e26b42c.8db42dd68e8dbaf3a36b.js',
  '/ebookservice/epubreader/hyread/v3/public/df882948ba4467e4ea7b5506adf4dba8.8db42dd68e8dbaf3a36b.js',
  '/ebookservice/epubreader/hyread/v3/public/9f73256d2f31d4225d601e2819639585.8db42dd68e8dbaf3a36b.js',
  '/ebookservice/epubreader/hyread/v3/public/fc424027e5979617e50e306e260bcc79.8db42dd68e8dbaf3a36b.js',
  '/ebookservice/epubreader/hyread/v3/public/418e49d3a1fa71a4edaddf8103f98fda.8db42dd68e8dbaf3a36b.js',
  '/ebookservice/epubreader/hyread/v3/public/228410f5c71f8af2b1266b70fa7824eb.8db42dd68e8dbaf3a36b.js',
  '/ebookservice/epubreader/hyread/v3/public/1b7f68485a9a8b32252cebcffd1fbffd.8db42dd68e8dbaf3a36b.js',
  '/ebookservice/epubreader/hyread/v3/public/7d59463f90d745245bb493c18cdcfae4.8db42dd68e8dbaf3a36b.js',
  '/ebookservice/epubreader/hyread/v3/public/a33737075e6c25260e0f.svg',
  '/ebookservice/epubreader/hyread/v3/public/69596a9f1dbbdd3d649224b5f6b27ac0.8db42dd68e8dbaf3a36b.js',
  '/ebookservice/epubreader/hyread/v3/public/onlineReader.8db42dd68e8dbaf3a36b.js',
  '/ebookservice/epubreader/hyread/v3/public/aafed6b58e0e6054cad7.wasm',
  '/ebookservice/epubreader/hyread/v3/public/fdhw.8db42dd68e8dbaf3a36b.js',
  // —— 背景音频分片 ——
  '/test/mp3:background_music_silent.mp3/playlist.m3u8',
  '/test/mp3:background_music_silent.mp3/chunklist_w1673236448.m3u8',
  '/test/mp3:background_music_silent.mp3/media_w1673236448_0.mp3',
];

const localPath = (p) => join(OUT, p.replace(/^\//, '').replace(/:/g, '_'));

async function dl(p) {
  const res = await fetch(BASE + p);
  const buf = Buffer.from(await res.arrayBuffer());
  const dest = localPath(p);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return { p, status: res.status, bytes: buf.length };
}

const POOL = 6;
const results = [];
let i = 0;
async function worker() {
  while (i < urls.length) {
    const idx = i++;
    try {
      const r = await dl(urls[idx]);
      results[idx] = r;
      console.log(`OK  ${String(r.bytes).padStart(8)}  ${r.status}  ${r.p}`);
    } catch (e) {
      results[idx] = { p: urls[idx], error: String(e) };
      console.log(`ERR  ${urls[idx]}  ${e}`);
    }
  }
}
await Promise.all(Array.from({ length: POOL }, worker));

const ok = results.filter((r) => r && !r.error);
const total = ok.reduce((a, r) => a + r.bytes, 0);
console.log(`\n完成：成功 ${ok.length} / ${urls.length}，总计 ${(total / 1024 / 1024).toFixed(2)} MB`);
console.log(`保存目录：${OUT}`);
