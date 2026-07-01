// readmoo/scripts/4-build-epub.mjs
//
// Readmoo MooReader 抓取产物 → 规范 EPUB。
//
// Readmoo 的 xhtml/css/image 都是明文良构（Readium 只加了 moofs/moolh 字体度量 class，无害），
// OPF/container/nav 现成可用、无 DRM 私有 meta。所以本脚本只需：
//   1. 复用抓取落盘的 work 目录（item/ + META-INF/container.xml）；
//   2. 补一个 mimetype（首条目、stored 不压缩）；
//   3. yazl 打包成 .epub。
//
// 用法：node readmoo/scripts/4-build-epub.mjs [workDir] [outEpub]
//   默认 workDir = readmoo/work/another-days，outEpub = <项目根>/output/readmoo/<书名>.epub

import { readdirSync, readFileSync, createWriteStream, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import yazl from 'yazl';

const __dirname = dirname(fileURLToPath(import.meta.url));
const READMOO_DIR = resolve(__dirname, '..');
const PROJECT_ROOT = resolve(READMOO_DIR, '..', '..');

const workDir = resolve(process.argv[2] || join(READMOO_DIR, 'work', 'another-days'));
const outEpub = resolve(process.argv[3] || join(PROJECT_ROOT, 'output', 'readmoo', '義妹生活 another days.readmoo.epub'));

if (!existsSync(join(workDir, 'META-INF', 'container.xml')) || !existsSync(join(workDir, 'item', 'standard.opf'))) {
  console.error('缺 work 目录核心文件（META-INF/container.xml 或 item/standard.opf）：', workDir);
  process.exit(1);
}

// 递归列出目录下所有文件
function walk(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p));
  }
  return out;
}

mkdirSync(dirname(outEpub), { recursive: true });

const zip = new yazl.ZipFile();
// mimetype 必须是包内第一个条目且不压缩（stored）
zip.addBuffer(Buffer.from('application/epub+zip'), 'mimetype', { compress: false });

const files = walk(workDir)
  .filter((f) => f !== 'mimetype' && !f.endsWith('.DS_Store') && !/^grab/.test(f) && !/^grab_img/.test(basename(f)))
  .sort();
for (const rel of files) {
  const abs = join(workDir, rel);
  // 大文件（图片）用 addFile，小文件也行
  zip.addFile(abs, rel.split('\\').join('/'));
}
zip.outputStream.pipe(createWriteStream(outEpub)).on('close', () => {
  const size = statSync(outEpub).size;
  console.log(`✓ 成品：${outEpub}`);
  console.log(`  ${files.length} 个条目 | ${(size / 1024 / 1024).toFixed(2)} MB`);
}).on('error', (e) => { console.error(e); process.exit(1); });
zip.end();