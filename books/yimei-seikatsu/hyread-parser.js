/**
 * hyread-parser.js
 *
 * 从 HyRead 在线阅读器版 EPUB（output/hyread/ 下的 .hyread.epub）中提取正文，
 * 产出与 splitLightNovelBook 相同形状的 book object，供 lightnovel-html 渲染管线复用。
 *
 * hyread EPUB 的目录前缀为 item/（非标准 OEBPS/）。
 */

import path from 'node:path';
import { parseHTML } from 'linkedom';

import { readEpub } from '../../src/core/zip-io.js';
import { simplifyText } from './lightnovel-html/index.js';

// hyread EPUB 内部根目录
const R = 'item';

// Hyread 章节 XHTML 的正文段落特征类名。
const BODY_P_CSS_RE = /(?:^|\s)__reader-(?:text-indent|paragraph-spacing)__/;

/**
 * 从 colophon 页面提取版权信息文本块（creditBlocks 格式）。
 */
function parseColophonBlocks(xhtml) {
  const blocks = [];
  const { document } = parseHTML(xhtml);
  const data = document.querySelector('.publisher-data');
  if (!data) return blocks;

  for (const p of data.querySelectorAll('p')) {
    const text = (p.textContent || '').trim();
    if (!text || /^(?:※|©|KADOKAWA|GIMAISEIKATSU|Complex)/.test(text)) continue;

    const match = text.match(/^(.+?)[：:]\s*(.+)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      blocks.push({ type: 'text', text: `${key}：${value}`, bold: false });
    }
  }
  return blocks;
}

/**
 * 从 p-toc-001.xhtml 提取章节标题与对应文件名的映射。
 * 返回 [{ href, title }] 数组，href 形如 "p-002.xhtml"。
 */
function parseTocEntries(xhtml) {
  const { document } = parseHTML(xhtml);
  const entries = [];
  for (const a of document.querySelectorAll('a')) {
    const href = a.getAttribute('href') || '';
    const text = (a.textContent || '').replace(/\s+/g, '');
    if (text && !/^[ＣＯＮＴＥＮＴＳ]$/i.test(text) && !/^CONTENTS$/i.test(text)) {
      const file = href.split('#')[0];  // p-002.xhtml
      entries.push({ href: file, title: text });
    }
  }
  return entries;
}

/**
 * 从 SVG/HTML 中提取图片引用路径。
 */
function extractImageHrefs(xhtml) {
  const hrefs = [];
  for (const tag of String(xhtml).matchAll(/<(?:img|image)\b[^>]*>/gi)) {
    const attrs = tag[0];
    const m = attrs.match(/(?:^|\s)(?:src|href|xlink:href)=["']([^"']+)["']/i);
    if (m) hrefs.push(m[1]);
  }
  return hrefs;
}

/**
 * 从单一章节 XHTML 中提取文本和图片块。
 * 所有图片的 src 存储为 "image/xxx.jpg" 格式（不含 item/ 前缀）。
 */
function parseChapterXhtml(xhtml) {
  const blocks = [];
  const { document } = parseHTML(xhtml);
  const main = document.querySelector('.main');
  if (!main) return { blocks };

  for (const child of main.childNodes) {
    if (child.nodeType !== 1) continue;
    const tag = (child.localName || child.tagName || '').toLowerCase();

    if (tag === 'p') {
      const html = (child.outerHTML || child.toString?.() || '');

      // 跳过 <p id="mokuji-*">
      if (/^\s*<p\b[^>]*\bid\s*=\s*["']mokuji-/.test(html)) continue;

      const cls = child.getAttribute('class') || '';

      // 跳过仅含 mfont class 的空/标记段
      if (/\bmfont\b/.test(cls) && !BODY_P_CSS_RE.test(cls)) continue;

      // 跳过 spacer
      const text = (child.textContent || '').trim();
      if (/^[　\s]*$/.test(text) && child.querySelector('br')) continue;

      // 内嵌图片
      const img = child.querySelector('img');
      if (img) {
        const src = img.getAttribute('src') || '';
        if (src) {
          const base = path.posix.basename(src.split('?')[0]);
          const id = base.replace(/\.[^.]+$/, '');
          blocks.push({
            type: 'image',
            src: `image/${base}`,
            width: 0, height: 0,
            alt: id, id,
            fileName: base,
          });
        }
        continue;
      }

      // 正文段落
      if (BODY_P_CSS_RE.test(cls) || BODY_P_CSS_RE.test(html)) {
        const rawText = (child.textContent || '').replace(/\s+/g, '');
        if (rawText) {
          blocks.push({ type: 'text', text: rawText, bold: false });
        }
        continue;
      }
    }

    // SVG 内嵌图片
    if (tag === 'svg') {
      const svgHtml = (child.outerHTML || child.toString?.() || '');
      for (const ref of extractImageHrefs(svgHtml)) {
        const base = path.posix.basename(ref.split('?')[0]);
        const id = base.replace(/\.[^.]+$/, '');
        blocks.push({
          type: 'image',
          src: `image/${base}`,
          width: 0, height: 0,
          alt: id, id,
          fileName: base,
        });
      }
    }
  }

  return { blocks };
}

/**
 * 从 hyread EPUB 读取并构建 book object。
 */
export async function parseHyreadEpubToBook(sourceEpubPath, { volume, creditOverrides = {} } = {}) {
  const epub = await readEpub(sourceEpubPath);

  // 文件名 → 条目
  const entryMap = new Map();
  for (const name of epub.names) {
    entryMap.set(name, epub.entries[name]);
  }

  function read(name) {
    const entry = entryMap.get(name);
    if (!entry) throw new Error(`Missing entry in hyread EPUB: ${name}`);
    return entry.toString('utf8');
  }

  function imgEntry(fileName) {
    const p = `${R}/image/${fileName}`;
    const entry = entryMap.get(p);
    if (!entry) throw new Error(`Missing image in hyread EPUB: ${p}`);
    return entry;
  }

  // == 1) 解析目录 ==
  const tocEntries = parseTocEntries(read(`${R}/xhtml/p-toc-001.xhtml`));
  // 构建文件名 → 标题的映射（如 "p-003.xhtml" → "12月13日（星期一）淺村悠太"）
  const tocFileToTitle = new Map(tocEntries.map((e) => [e.href, e.title]));
  const tocTitles = tocEntries.map((e) => simplifyText(e.title));

  // == 2) 解析版权信息 ==
  const creditBlocks = parseColophonBlocks(read(`${R}/xhtml/p-colophon.xhtml`));

  if (creditOverrides && Object.keys(creditOverrides).length > 0) {
    for (const [key, value] of Object.entries(creditOverrides)) {
      const idx = creditBlocks.findIndex((b) => {
        const m = b.text.match(/^(.+?)[：:]/);
        return m && m[1].trim() === key;
      });
      if (idx >= 0) creditBlocks.splice(idx, 1);
      creditBlocks.push({ type: 'text', text: `${key}：${value}`, bold: false });
    }
  }

  // == 3) 封面图片 ==
  const coverHrefs = extractImageHrefs(read(`${R}/xhtml/p-cover.xhtml`));
  if (coverHrefs.length === 0) throw new Error('No cover image found in hyread EPUB');
  const coverFileName = path.posix.basename(coverHrefs[0].split('?')[0]);
  const coverImage = {
    type: 'image', src: `image/${coverFileName}`,
    width: 0, height: 0,
    alt: 'cover', id: 'cover',
    fileName: coverFileName,
  };

  // == 4) 卷首彩插 ==
  const fmatterFiles = epub.names
    .filter((n) => new RegExp(`^${R}/xhtml/p-fmatter-\\d+\\.xhtml$`).test(n))
    .sort();

  const frontImages = [];
  for (const fmPath of fmatterFiles) {
    for (const ref of extractImageHrefs(read(fmPath))) {
      const base = path.posix.basename(ref.split('?')[0]);
      const id = base.replace(/\.[^.]+$/, '');
      frontImages.push({
        type: 'image', src: `image/${base}`,
        width: 0, height: 0,
        alt: id, id,
        fileName: base,
      });
    }
  }

  // == 5) 逐章解析正文（按文件名映射到 TOC）==
  const chapterFileRe = new RegExp(`^${R}/xhtml/p-(\\d{3})\\.xhtml$`);
  const chapterFiles = epub.names
    .filter((n) => chapterFileRe.test(n))
    .sort();

  // 按文件名收集原始块，保留文件名信息用于 TOC 匹配
  const fileBlocks = [];
  for (const chPath of chapterFiles) {
    const fileName = chPath.split('/').pop(); // "p-001.xhtml"
    const { blocks } = parseChapterXhtml(read(chPath));
    for (const b of blocks) {
      if (b.type === 'text') b.text = simplifyText(b.text);
    }
    fileBlocks.push({ fileName, blocks });
  }

  // == 6) 分类：题记 / 章节 / 后记 ==
  const chapters = [];
  let preBlocks = [];

  for (const { fileName, blocks } of fileBlocks) {
    const tocTitle = tocFileToTitle.get(fileName);

    if (tocTitle) {
      // 在 TOC 中 → 普通章节
      chapters.push({ title: simplifyText(tocTitle), blocks });
    } else if (fileName === 'p-001.xhtml') {
      // p-001 不在 TOC 中，内容为卷首语 → preBlocks
      const textBlocks = blocks.filter((b) => b.type === 'text');
      preBlocks = textBlocks.length > 0 && textBlocks[0].text.length < 200 ? textBlocks : [];
    } else {
      // 其他不在 TOC 中的（如 p-015 后记），按内容判断标题
      const firstText = blocks.find((b) => b.type === 'text');
      const rawTitle = firstText?.text?.trim() || '';
      let title = rawTitle;
      // 检测后记
      if (/^后记|^後記|^あとがき/.test(rawTitle)) {
        title = '后记';
      }
      chapters.push({ title, blocks });
    }
  }

  // == 7) 卷尾插图 ==
  const backImages = [];
  for (let i = chapters.length - 1; i >= 0; i--) {
    const ch = chapters[i];
    const imgs = [];
    while (ch.blocks.length > 0 && ch.blocks[ch.blocks.length - 1].type === 'image') {
      imgs.unshift(ch.blocks.pop());
    }
    if (imgs.length > 0) {
      backImages.unshift(...imgs);
    } else {
      break;
    }
  }

  // == 8) 构建 sourceImages ==
  function imgObj(base, overrides = {}) {
    const fileName = base;
    return {
      type: 'image', src: `image/${fileName}`,
      width: 0, height: 0,
      alt: fileName.replace(/\.[^.]+$/, ''),
      id: fileName.replace(/\.[^.]+$/, ''),
      fileName,
      mediaType: fileName.endsWith('.png') ? 'image/png'
        : fileName.endsWith('.webp') ? 'image/webp'
        : 'image/jpeg',
      buffer: imgEntry(fileName),
      ...overrides,
    };
  }

  const sourceImages = {
    cover: imgObj(coverFileName, { id: 'cover', fileName: 'cover.jpg', mediaType: 'image/jpeg' }),
    front: frontImages.map((img) => imgObj(img.fileName)),
    body: [],
    back: backImages.map((img) => imgObj(img.fileName)),
  };

  for (const chapter of chapters) {
    for (const block of chapter.blocks) {
      if (block.type === 'image') {
        sourceImages.body.push(imgObj(block.fileName));
      }
    }
  }

  // == 构建 book object ==
  const withPreBlocks = preBlocks.length > 0;
  return {
    title: `义妹生活 ${volume} [台简]`,
    volume,
    author: '三河ごーすと',
    illustrator: 'Hiten',
    coverImage,
    frontImages,
    backImages,
    creditBlocks,
    preBlocks,
    summaryBlocks: preBlocks,
    tocTitles,
    chapters,
    _sourceImages: sourceImages,
  };
}
