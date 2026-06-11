// hyread/scripts/4-build-epub.mjs
//
// 步骤 4b：用解密正文 + 下载的明文资源组装成规范的 EPUB 3，并打包成 .epub。
//
// 输入：
//   work/<卷>/grab_xml.json                              （步骤 3 解密抓取）
//   work/<卷>/resources/.../item/{standard.opf,style,image}（步骤 2 下载）
// 输出：
//   work/<卷>/epub_build/                                （EPUB 解包目录，便于检查）
//   ../output/hyread/[三河ごーすと].义妹生活.<卷>.[台繁].hyread.epub
//                                                        （成品，epubcheck 0 错误）
//
// 关键处理（踩过的坑都在这）：
//   · 清理阅读器运行时注入物：<base>、blob 样式表、xmlns="" 的注入 <style>、定位 inline style
//   · CSS 分类注入：图片页才用 fixed-layout-jp.css（含 body{font-size:0}）；
//     正文页若注入它会把文字压成 0 号字 → 整本只剩插图。务必分开。
//   · 移除 OPF 里的 HyRead DRM 元数据 <meta property="hdf">（epubcheck OPF-027）
//   · XML 声明 + DOCTYPE；nav 标题取自解密正文的官方目录
//   · mimetype 必须是包内第一个条目且不压缩（stored）
//
// 用法：node hyread/scripts/4-build-epub.mjs

import { readFileSync, createWriteStream } from 'node:fs';
import { mkdir, writeFile, cp, rm, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import yazl from 'yazl';
import { GRAB_JSON, EPUB_ITEM, EPUB_BUILD, OUTPUT_EPUB, OUTPUT_DIR, BOOK_TITLE, VOLUME } from '../config.mjs';

const j = JSON.parse(readFileSync(GRAB_JSON, 'utf8'));

// CSS 分类。fixed-layout-jp.css 含 body{font-size:0}，仅供 svg 图片页，正文页严禁注入。
const mkLinks = (list) => list.map((c) => `<link rel="stylesheet" type="text/css" href="../style/${c}"/>`).join('\n');
const CSS_TEXT = ['style-reset.css', 'style-standard.css', 'style-advance.css', 'book-style.css', 'style-bc-kadokawa.css', 'style-check.css'];
const CSS_IMG = ['style-reset.css', 'fixed-layout-jp.css'];

// 按卷的内容修正：修正出版方原始笔误，仅对指定卷的指定页生效。
// vol08：书内目次 p-toc-001 的两处 6 月星期（６月１日「星期五」、６月７日「星期六」）与正文章节标题
// 及全书日历不一致——年份无关的内部一致性判定它们为唯一离群点，这里把目次页对齐到正文一致的星期。
// 精确字串 replaceAll，不会误伤其它条目。
const CONTENT_FIXES = {
  '08': {
    'xhtml/p-toc-001.xhtml': [
      ['６月１日（星期五）', '６月１日（星期二）'],
      ['６月７日（星期六）', '６月７日（星期一）'],
    ],
  },
};
function applyContentFixes(rel, html) {
  const fixes = (CONTENT_FIXES[VOLUME] || {})[rel];
  if (!fixes) return html;
  let out = html;
  for (const [from, to] of fixes) {
    if (!out.includes(from)) { console.warn(`  [content-fix] 警告：${rel} 未找到待修正字串「${from}」（源可能已变，跳过）`); continue; }
    out = out.split(from).join(to);
    console.log(`  [content-fix] ${rel}: 「${from}」→「${to}」`);
  }
  return out;
}

// 清理阅读器运行时注入物，保留正文与原始结构
function clean(html) {
  html = html.replace(/<base\b[^>]*>/gi, '');
  html = html.replace(/<link\b[^>]*href="blob:[^"]*"[^>]*>/gi, '');
  html = html.replace(/<style\b[^>]*\bxmlns=""[^>]*>[\s\S]*?<\/style>/gi, '');
  html = html.replace(/(<html\b[^>]*?)\s+style="[^"]*"/i, '$1');
  html = html.replace(/(<body\b[^>]*?)\s+style="[^"]*"/i, '$1');
  html = html.replace(/(<div\s+class="main")\s+style="[^"]*"/gi, '$1');
  const isImg = /<svg[\s>]/i.test(html);
  html = html.replace(/<\/head>/i, mkLinks(isImg ? CSS_IMG : CSS_TEXT) + '\n</head>');
  if (!/^<\?xml/.test(html)) html = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n' + html;
  return html;
}

// nav 标题：结构页用固定语义标签（跨卷稳定的文件名），正文页取首个 gfont 段全文，彩页按 spine 位置判断。
const FIXED_LABELS = {
  'xhtml/p-cover.xhtml': '封面',
  'xhtml/p-titlepage.xhtml': '書名頁',
  'xhtml/p-toc-001.xhtml': '目次',
  'xhtml/p-001.xhtml': '引言',
  'xhtml/p-colophon.xhtml': '版權頁',
};
function chapterTitle(html) {
  const gi = html.indexOf('gfont');
  if (gi >= 0) {
    const pStart = html.lastIndexOf('<p', gi);
    const pEnd = html.indexOf('</p>', gi);
    if (pStart >= 0 && pEnd > pStart) {
      const t = html.slice(pStart, pEnd).replace(/<[^>]+>/g, '').replace(/[　\s]+/g, ' ').trim();
      if (t) return t;
    }
  }
  return html.slice(html.indexOf('<body')).replace(/<[^>]+>/g, ' ').replace(/[　\s]+/g, ' ').trim().slice(0, 24);
}
// 彩页(fmatter)在不同卷里数量/前后分布不同（如 12 卷前彩页含 fmatter-006、卷末为 fmatter-007~010），
// 硬编码文件名会串卷。改按 spine 位置归类：目次(p-toc)之前 = 前彩页「彩頁插圖 N」，之后 = 卷末「卷末插圖 N」。
function makeFmatterLabeler(order) {
  const rels = order.map(relOf);
  let divider = rels.findIndex((r) => /p-toc/.test(r));
  if (divider < 0) divider = rels.findIndex((r) => /p-\d{3}\.xhtml$/.test(r));
  let frontN = 0;
  let backN = 0;
  return (i) => (divider >= 0 && i < divider ? `彩頁插圖 ${++frontN}` : `卷末插圖 ${++backN}`);
}

const relOf = (src) => src.split('/item/')[1];

// 递归列出目录下所有文件的相对路径
async function walk(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, base)));
    else out.push(relative(base, p));
  }
  return out;
}

// 用 yazl 打包成 EPUB（mimetype 必须第一个且 stored）
function packEpub(buildDir, outPath) {
  return new Promise(async (resolve, reject) => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from('application/epub+zip'), 'mimetype', { compress: false });
    const files = (await walk(buildDir)).filter((f) => f !== 'mimetype' && !f.endsWith('.DS_Store')).sort();
    for (const rel of files) zip.addFile(join(buildDir, rel), rel.split('\\').join('/'));
    zip.outputStream.pipe(createWriteStream(outPath)).on('close', resolve).on('error', reject);
    zip.end();
  });
}

// ===== 组装 =====
await rm(EPUB_BUILD, { recursive: true, force: true });
await mkdir(join(EPUB_BUILD, 'META-INF'), { recursive: true });
await mkdir(join(EPUB_BUILD, 'item/xhtml'), { recursive: true });
await mkdir(OUTPUT_DIR, { recursive: true });

await writeFile(join(EPUB_BUILD, 'mimetype'), 'application/epub+zip');
await writeFile(join(EPUB_BUILD, 'META-INF/container.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="item/standard.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

// OPF（去掉 HyRead DRM 元数据）+ css + image
let opf = readFileSync(join(EPUB_ITEM, 'standard.opf'), 'utf8');
opf = opf.replace(/[ \t]*<meta\s+property="hdf">[\s\S]*?<\/meta>\s*\n?/gi, '');
await writeFile(join(EPUB_BUILD, 'item/standard.opf'), opf, 'utf8');
await cp(join(EPUB_ITEM, 'style'), join(EPUB_BUILD, 'item/style'), { recursive: true });
await cp(join(EPUB_ITEM, 'image'), join(EPUB_BUILD, 'item/image'), { recursive: true });

// 清理后的解密 xhtml + nav 条目
const navItems = [];
const fmatterLabel = makeFmatterLabeler(j.order);
for (let i = 0; i < j.order.length; i++) {
  const src = j.order[i];
  const rel = relOf(src);
  const raw = applyContentFixes(rel, j.data[src]);
  await writeFile(join(EPUB_BUILD, 'item', rel), clean(raw), 'utf8');
  let title;
  if (FIXED_LABELS[rel]) title = FIXED_LABELS[rel];
  else if (/p-fmatter-/.test(rel)) title = fmatterLabel(i);
  else title = chapterTitle(raw) || rel;
  navItems.push({ href: rel, title });
}

// navigation-documents.xhtml（opf 引用的 nav）
const navOl = navItems.map((it) => `      <li><a href="${it.href}">${it.title.replace(/[<&]/g, '')}</a></li>`).join('\n');
await writeFile(join(EPUB_BUILD, 'item/navigation-documents.xhtml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-TW" xml:lang="zh-TW">
<head><meta charset="UTF-8"/><title>${BOOK_TITLE} — 目次</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目次</h1>
    <ol>
${navOl}
    </ol>
  </nav>
</body>
</html>`);

await packEpub(EPUB_BUILD, OUTPUT_EPUB);

console.log(`EPUB 组装目录：${EPUB_BUILD}`);
console.log(`解密正文 xhtml：${j.order.length} 个 | nav 条目：${navItems.length}`);
console.log(`✓ 成品：${OUTPUT_EPUB}`);
