// readmoo/scripts/3-grab-images.mjs
//
// Readmoo MooReader 图片抓取脚本（可复用）。
//
// 本脚本分两部分：
//   A. 浏览器端抓图函数（在 chrome-devtools 的 evaluate_script 里执行）：
//      从阅读器 iframe 拿 base，fetch standard.opf 解析 image 列表，分批 fetch 二进制，
//      用 FileReader.readAsDataURL 转成 base64 返回。MCP 会把返回对象存成 json。
//      ⚠️ 不能用 btoa(String.fromCharCode(...new Uint8Array(buf)))——大图会爆栈/损坏，
//         FileReader.readAsDataURL 是踩坑后验证可靠的方案。
//   B. Node 端解码落盘 + 校验：把 grab_img_*.json 里的 b64 解码写回 item/image/，校验字节数。
//
// 用法：
//   node readmoo/scripts/3-grab-images.mjs emit [start] [n]
//     打印浏览器端函数源码（已替换 start/n），复制到 evaluate_script 执行。
//     例：node 3-grab-images.mjs emit 0 6
//
//   node readmoo/scripts/3-grab-images.mjs decode [workDir]
//     把 workDir 下所有 grab_img_*.json 解码落盘到 workDir/item/image/ 并校验。
//     例：node 3-grab-images.mjs decode readmoo/work/another-days
//
// 抓取流程（新书复用）：
//   1. chrome-devtools 打开 readmoo 阅读器页，导航到目标书；
//   2. 跑 `node 3-grab-images.mjs emit 0 6` 拿到浏览器函数，粘进 evaluate_script 执行 → grab_img_0.json；
//   3. 改 start=6/12/18/... 重复，直到 start+n >= total；
//   4. 跑 `node 3-grab-images.mjs decode <workDir>` 落盘校验；
//   5. 跑 `node 4-build-epub.mjs <workDir> <out.epub>` 打包。

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const READMOO_DIR = resolve(__dirname, '..');

// --- A. 浏览器端抓图函数模板 ---
// 参数化 start（批次起始下标）和 n（每批张数）。execute 时把模板里的 __START__ / __N__ 替换掉。
const BROWSER_FN_TEMPLATE = `async () => {
  const start = __START__;
  const n = __N__;
  const f = document.querySelector('iframe');
  const base = f.contentDocument.location.href.replace(/\\/item\\/.*$/, '/');
  const opf = await (await fetch(new URL('item/standard.opf', base).href, {credentials:'include'})).text();
  const images = [...opf.matchAll(/<item\\b[^>]*?\\/?>/g)].map(m=>{
    const a=m[0]; const mt=a.match(/\\bmedia-type="([^"]+)"/)?.[1];
    if (!mt || !mt.startsWith('image/')) return null;
    return { href: a.match(/\\bhref="([^"]+)"/)[1], id: a.match(/\\bid="([^"]+)"/)?.[1], mt };
  }).filter(Boolean);
  const out = { start, total: images.length, images: [] };
  const toB64 = (buf) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => { const d = fr.result; res(d.slice(d.indexOf(',') + 1)); };
    fr.onerror = rej;
    fr.readAsDataURL(new Blob([buf]));
  });
  for (const im of images.slice(start, start+n)) {
    const r = await fetch(new URL('item/'+im.href, base).href, {credentials:'include'});
    if (r.status !== 200) { out.images.push({href:im.href, status:r.status}); continue; }
    const buf = await r.arrayBuffer();
    const b64 = await toB64(buf);
    out.images.push({ href:im.href, id:im.id, mt:im.mt, size:buf.byteLength, b64 });
  }
  console.log('[img] start='+start+' got='+out.images.length+' sizes='+out.images.map(x=>x.size||x.status).join(','));
  return out;
}`;

function emitBrowserFn(start, n) {
  const fn = BROWSER_FN_TEMPLATE.replace('__START__', String(start)).replace('__N__', String(n));
  console.log(fn);
}

// --- B. Node 端解码落盘 + 校验 ---
function decodeAll(workDir) {
  const imageDir = join(workDir, 'item', 'image');
  mkdirSync(imageDir, { recursive: true });
  const batches = readdirSync(workDir)
    .filter(f => /^grab_img_\d+\.json$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  if (!batches.length) { console.error('未找到 grab_img_*.json:', workDir); process.exit(1); }
  let ok = 0, bad = 0;
  const seen = new Set();
  for (const b of batches) {
    const d = JSON.parse(readFileSync(join(workDir, b), 'utf8'));
    for (const im of d.images) {
      if (!im.b64) { bad++; console.log('  无b64:', im.href, im.status || ''); continue; }
      const buf = Buffer.from(im.b64, 'base64');
      if (buf.length !== im.size) {
        bad++;
        if (bad <= 5) console.log(`  ❌ ${im.href}: 解码=${buf.length} 记录=${im.size}`);
        continue;
      }
      if (seen.has(im.href)) continue;
      seen.add(im.href);
      writeFileSync(join(imageDir, im.href), buf);
      ok++;
    }
  }
  const totalBytes = readdirSync(imageDir)
    .filter(f => !f.startsWith('.'))
    .reduce((s, f) => s + readFileSync(join(imageDir, f)).length, 0);
  console.log(`重新落盘: ok=${ok} bad=${bad} 去重=${seen.size}`);
  console.log(`  落盘: {"ok":${ok}} 总字节 ${totalBytes.toLocaleString('en-US')}`);
}

// --- CLI ---
const [mode, ...rest] = process.argv.slice(2);
if (mode === 'emit') {
  const start = parseInt(rest[0] ?? '0');
  const n = parseInt(rest[1] ?? '6');
  emitBrowserFn(start, n);
} else if (mode === 'decode') {
  const workDir = resolve(rest[0] || join(READMOO_DIR, 'work', 'another-days'));
  if (!existsSync(join(workDir, 'META-INF', 'container.xml'))) {
    console.error('不是有效 work 目录:', workDir);
    process.exit(1);
  }
  decodeAll(workDir);
} else {
  console.error('用法:\n  node 3-grab-images.mjs emit [start] [n]\n  node 3-grab-images.mjs decode [workDir]');
  process.exit(1);
}
