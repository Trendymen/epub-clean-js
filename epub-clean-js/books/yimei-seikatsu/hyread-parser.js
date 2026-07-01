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
// 生僻字代用图 → 真字符映射。
// 台繁源把字体可能缺的生僻人名用字做成 1em 行内小图嵌在文字里；台简思源字体有这些字形，
// 直接还原为真字符（可选可搜、无豆腐块）。
const RARE_CHAR_IMAGE_MAP = {
  'p000.png': '﨑', // 﨑：13 卷后记声优「天﨑滉平」名字用字
};

// 重建含行内代用字图的段落文本：文本节点取文，<img> 取映射真字符（无映射则略过），<br> 忽略。
function buildInlineText(pEl) {
  let out = '';
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { out += c.textContent || ''; continue; }
      if (c.nodeType !== 1) continue;
      const tag = (c.localName || c.tagName || '').toLowerCase();
      if (tag === 'img') {
        const base = path.posix.basename((c.getAttribute('src') || '').split('?')[0]);
        out += RARE_CHAR_IMAGE_MAP[base] || '';
      } else if (tag !== 'br') {
        walk(c);
      }
    }
  };
  walk(pEl);
  return out;
}

function parseChapterXhtml(xhtml) {
  const blocks = [];
  let headingText = null;
  const { document } = parseHTML(xhtml);
  const main = document.querySelector('.main');
  if (!main) return { blocks, headingText };

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

      // 章节标题大字（gfont font-1em40）：单独抽出当标题，不进正文 blocks（避免与 h3 重复）。
      // 结构识别比文本匹配可靠——台繁 TOC 标题与正文标题措辞可能不同（如「与」vs「和」）。
      if (headingText === null && /font-1em40/.test(html)) {
        const ht = (child.textContent || '').replace(/\s+/g, '');
        if (ht) { headingText = ht; continue; }
      }

      // 内嵌图片
      const img = child.querySelector('img');
      if (img) {
        const base = path.posix.basename((img.getAttribute('src') || '').split('?')[0]);
        const imgCls = img.getAttribute('class') || '';
        // 行内代用字图（生僻字做成 1em 小图嵌在文字里）：还原整段文字 + 真字符，不抽成块图。
        const isInlineGlyph = /\bheight-1em\b/.test(imgCls) || Object.prototype.hasOwnProperty.call(RARE_CHAR_IMAGE_MAP, base);
        if (isInlineGlyph) {
          const inlineText = buildInlineText(child).replace(/\s+/g, '');
          if (inlineText) blocks.push({ type: 'text', text: inlineText, bold: false });
          continue;
        }
        // 整页插图
        if (base) {
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

  return { blocks, headingText };
}

/**
 * parseAnotherDaysChapterXhtml — readmoo another days 正文页解析。
 *
 * readmoo 正文 <p> 的 class 是纯字体度量（moofs16 moolh28），没有 hyread 的
 * __reader-text-indent__/paragraph-spacing 类，通用 parseChapterXhtml 的 BODY_P_CSS_RE
 * 无法识别 → 正文全丢。本函数放宽正文段判定：非 mfont 标记段、非 mokuji 锚点、
 * 非 spacer、有文字内容即视为正文段。标题/图片/SVG 逻辑与 parseChapterXhtml 一致。
 */
function parseAnotherDaysChapterXhtml(xhtml) {
  const blocks = [];
  let headingText = null;
  const { document } = parseHTML(xhtml);
  const main = document.querySelector('.main');
  if (!main) return { blocks, headingText };

  for (const child of main.childNodes) {
    if (child.nodeType !== 1) continue;
    const tag = (child.localName || child.tagName || '').toLowerCase();

    if (tag === 'p') {
      const html = (child.outerHTML || child.toString?.() || '');
      if (/^\s*<p\b[^>]*\bid\s*=\s*["']mokuji-/.test(html)) continue;

      const cls = child.getAttribute('class') || '';
      // mfont 段是标记/空段（如 font-1em10 小字标记），readmoo 正文段是 moofs*/moolh*
      if (/\bmfont\b/.test(cls) && !/font-1em40/.test(html)) continue;

      const text = (child.textContent || '').trim();
      if (/^[　\s]*$/.test(text) && child.querySelector('br')) continue;

      // 大字标题（gfont font-1em40）抽作 headingText
      if (headingText === null && /font-1em40/.test(html)) {
        const ht = (child.textContent || '').replace(/\s+/g, '');
        if (ht) { headingText = ht; continue; }
      }

      // 内嵌图片
      const img = child.querySelector('img');
      if (img) {
        const base = path.posix.basename((img.getAttribute('src') || '').split('?')[0]);
        const imgCls = img.getAttribute('class') || '';
        const isInlineGlyph = /\bheight-1em\b/.test(imgCls)
          || Object.prototype.hasOwnProperty.call(RARE_CHAR_IMAGE_MAP, base);
        if (isInlineGlyph) {
          const inlineText = buildInlineText(child).replace(/\s+/g, '');
          if (inlineText) blocks.push({ type: 'text', text: inlineText, bold: false });
          continue;
        }
        if (base) {
          const id = base.replace(/\.[^.]+$/, '');
          blocks.push({ type: 'image', src: `image/${base}`, width: 0, height: 0, alt: id, id, fileName: base });
        }
        continue;
      }

      // 正文段：有文字即取（readmoo 无 __reader-* 类，靠排除标记段后的有文字 p）
      const rawText = (child.textContent || '').replace(/\s+/g, '');
      if (rawText) blocks.push({ type: 'text', text: rawText, bold: false });
      continue;
    }

    if (tag === 'svg') {
      const svgHtml = (child.outerHTML || child.toString?.() || '');
      for (const ref of extractImageHrefs(svgHtml)) {
        const base = path.posix.basename(ref.split('?')[0]);
        const id = base.replace(/\.[^.]+$/, '');
        blocks.push({ type: 'image', src: `image/${base}`, width: 0, height: 0, alt: id, id, fileName: base });
      }
    }
  }
  return { blocks, headingText };
}

/**
 * 从 hyread EPUB 读取并构建 book object。
 */
/**
 * 从 OPF 读取 spine 顺序，返回 itemref 对应的文件基名数组（spine 实际阅读顺序）。
 * 用于区分 p-fmatter 彩页在正文之前（卷首）还是之后（卷尾）。
 */
function readSpineBasenames(entryMap) {
  let opfName = null;
  for (const name of entryMap.keys()) {
    if (/\.opf$/i.test(name)) { opfName = name; break; }
  }
  if (!opfName) return [];
  const xml = entryMap.get(opfName).toString('utf8');
  const idToHref = new Map();
  for (const m of xml.matchAll(/<item\b[^>]*\bid="([^"]+)"[^>]*\bhref="([^"]+)"/g)) idToHref.set(m[1], m[2]);
  for (const m of xml.matchAll(/<item\b[^>]*\bhref="([^"]+)"[^>]*\bid="([^"]+)"/g)) {
    if (!idToHref.has(m[2])) idToHref.set(m[2], m[1]);
  }
  const out = [];
  for (const m of xml.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)) {
    const href = idToHref.get(m[1]);
    if (href) out.push(path.posix.basename(href));
  }
  return out;
}

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

  // == 4) 彩插（按源 spine 位置区分卷首/卷尾）==
  // p-fmatter-NNN 文件名连续编号，但部分彩页（下一卷预告、封面展开等）在源 spine 里
  // 排在正文（p-\d{3}）之后，属于卷尾彩页。必须按 OPF spine 顺序判断，不能只看文件名。
  const spineNames = readSpineBasenames(entryMap);
  const spinePos = new Map(spineNames.map((n, i) => [n, i]));
  const chapterSpineIdxs = spineNames
    .map((n, i) => (/^p-\d{3}\.xhtml$/.test(n) ? i : -1))
    .filter((i) => i >= 0);
  const lastChapterIdx = chapterSpineIdxs.length ? Math.max(...chapterSpineIdxs) : -1;

  const fmatterFiles = epub.names
    .filter((n) => new RegExp(`^${R}/xhtml/p-fmatter-\\d+\\.xhtml$`).test(n))
    .sort();

  const toImageObjs = (fmPath) => extractImageHrefs(read(fmPath)).map((ref) => {
    const base = path.posix.basename(ref.split('?')[0]);
    const id = base.replace(/\.[^.]+$/, '');
    return { type: 'image', src: `image/${base}`, width: 0, height: 0, alt: id, id, fileName: base };
  });

  // 无 spine 信息时回退到旧行为：全部归卷首。
  const frontImages = [];
  const backFmatterImages = [];
  for (const fmPath of fmatterFiles) {
    const idx = spinePos.get(path.posix.basename(fmPath));
    const isBack = idx !== undefined && lastChapterIdx >= 0 && idx > lastChapterIdx;
    (isBack ? backFmatterImages : frontImages).push(...toImageObjs(fmPath));
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
    const { blocks, headingText } = parseChapterXhtml(read(chPath));
    for (const b of blocks) {
      if (b.type === 'text') b.text = simplifyText(b.text);
    }
    fileBlocks.push({ fileName, blocks, headingText: headingText ? simplifyText(headingText) : null });
  }

  // == 6) 分类：题记 / 章节 / 后记 ==
  const chapters = [];
  let preBlocks = [];

  for (const { fileName, blocks, headingText } of fileBlocks) {
    const tocTitle = tocFileToTitle.get(fileName);

    if (tocTitle) {
      // 在 TOC 中 → 普通章节。大字标题已在 parseChapterXhtml 抽出（不在 blocks 里），
      // h3 用 TOC 标题；台繁 TOC 与正文标题措辞可能不同（如「与」vs「和」），按结构剥除不受影响。
      chapters.push({ title: simplifyText(tocTitle), blocks });
    } else if (fileName === 'p-001.xhtml') {
      // p-001 不在 TOC 中，内容为卷首语 → preBlocks
      const textBlocks = blocks.filter((b) => b.type === 'text');
      preBlocks = textBlocks.length > 0 && textBlocks[0].text.length < 200 ? textBlocks : [];
    } else {
      // 其他不在 TOC 中的（如 p-015 后记）：用抽出的大字标题作 h3，正文已不含标题。
      const rawTitle = headingText || (blocks.find((b) => b.type === 'text')?.text?.trim() || '');
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
  // 源 spine 中排在正文之后的 p-fmatter 彩页（下一卷预告、封面展开等）接在卷尾。
  backImages.push(...backFmatterImages);

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

/**
 * parseAnotherDaysEpubToBook — 义妹生活 another days 短篇合集专用 parser。
 *
 * another days 是短篇合集（12 篇动画感想 + 外传小说 + 后记 + 5 特典），结构与
 * 11-13 卷长篇模型根本不同：每个短篇在源 spine 里是「p-fmatter-NNN 彩插页（纯 SVG 图）
 * + p-NNN 正文页」紧邻成对，且章节标题只在 nav TOC 里（href 指向 p-fmatter-NNN），
 * 正文页自身没有 font-1em40 大字标题。
 *
 * 通用 parseHyreadEpubToBook 把所有 p-fmatter 当彩插抽进 frontImages/backImages 扁平数组，
 * 丢失与配对正文的 spine 邻接关系，导致构建器把彩插连续堆叠、章节标题全空。
 *
 * 本 parser 按 spine 顺序遍历，把每个 p-fmatter 彩插 prepend 到配对 p-NNN 章节的 blocks
 * 头部，保留穿插位置；卷首彩插（p-001 之前）归 frontImages，卷尾彩插（最后章节之后）
 * 归 backImages。构建器再把章节头部连续 image block 拆成独立 illus 页，还原源排版。
 *
 * 复用 parseHyreadEpubToBook 的全部工具函数与 book 对象契约。
 */
export async function parseAnotherDaysEpubToBook(sourceEpubPath, { volume = 'another-days', creditOverrides = {} } = {}) {
  const epub = await readEpub(sourceEpubPath);
  const entryMap = new Map();
  for (const name of epub.names) entryMap.set(name, epub.entries[name]);

  function read(name) {
    const entry = entryMap.get(name);
    if (!entry) throw new Error(`Missing entry in readmoo EPUB: ${name}`);
    return entry.toString('utf8');
  }
  function imgEntry(fileName) {
    const p = `${R}/image/${fileName}`;
    const entry = entryMap.get(p);
    if (!entry) throw new Error(`Missing image in readmoo EPUB: ${p}`);
    return entry;
  }
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

  // == 1) TOC：href 可能指向 p-fmatter-NNN.xhtml（短篇彩插页）或 p-NNN.xhtml#mokuji（前言/后记）==
  // parseTocEntries 返回的 href 可能带 "xhtml/" 前缀，统一取 basename 与 spine 名匹配。
  const tocEntries = parseTocEntries(read(`${R}/xhtml/p-toc-001.xhtml`));
  const tocHrefToTitle = new Map(tocEntries.map((e) => [path.posix.basename(e.href), e.title]));

  // == 2) 版权信息 ==
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

  // == 3) 封面 ==
  const coverHrefs = extractImageHrefs(read(`${R}/xhtml/p-cover.xhtml`));
  if (coverHrefs.length === 0) throw new Error('No cover image found in readmoo EPUB');
  const coverFileName = path.posix.basename(coverHrefs[0].split('?')[0]);
  const coverImage = {
    type: 'image', src: `image/${coverFileName}`,
    width: 0, height: 0, alt: 'cover', id: 'cover', fileName: coverFileName,
  };

  // == 4) 按 spine 顺序遍历，建立彩插-正文配对 ==
  const spineNames = readSpineBasenames(entryMap);
  const fmatterRe = /^p-fmatter-(\d+)\.xhtml$/;
  const chapterRe = /^p-(\d{3})\.xhtml$/;

  const frontImages = [];      // 卷首彩插（p-001 之前的 p-fmatter）
  const backImages = [];       // 卷尾彩插（最后章节之后的 p-fmatter）
  const chapters = [];         // {title, blocks}
  let preBlocks = [];

  // 短篇正文 p-NNN 的章节标题：nav href 指向配对 p-fmatter-NNN，需建立 fmatter basename→title 映射
  const fmatterTitleMap = new Map();
  for (const e of tocEntries) {
    const base = path.posix.basename(e.href);
    if (fmatterRe.test(base)) fmatterTitleMap.set(base, e.title);
  }

  let pendingFmatterBlocks = [];  // 待配对彩插 image block（prepend 到下一个正文章节）
  let seenAnyChapter = false;     // 是否已遇到首个 p-NNN 正文
  let lastChapterIndex = -1;      // 最后一个 p-NNN 在 spine 中的位置
  for (let i = 0; i < spineNames.length; i++) {
    if (chapterRe.test(spineNames[i])) lastChapterIndex = i;
  }

  for (let i = 0; i < spineNames.length; i++) {
    const name = spineNames[i];

    if (fmatterRe.test(name)) {
      // 彩插页：解析为 image block
      const blocks = extractImageHrefs(read(`${R}/xhtml/${name}`)).map((ref) => {
        const base = path.posix.basename(ref.split('?')[0]);
        const id = base.replace(/\.[^.]+$/, '');
        return { type: 'image', src: `image/${base}`, width: 0, height: 0, alt: id, id, fileName: base };
      });
      if (!seenAnyChapter) {
        // p-001 之前 → 卷首彩插
        frontImages.push(...blocks);
      } else if (i > lastChapterIndex) {
        // 最后章节之后 → 卷尾彩插
        backImages.push(...blocks);
      } else {
        // 短篇配对彩插 → 待 prepend 到下一个正文章节
        pendingFmatterBlocks.push(...blocks);
      }
      continue;
    }

    if (chapterRe.test(name)) {
      seenAnyChapter = true;
      const { blocks, headingText } = parseAnotherDaysChapterXhtml(read(`${R}/xhtml/${name}`));
      for (const b of blocks) {
        if (b.type === 'text') b.text = simplifyText(b.text);
      }
      // 头部插入配对彩插
      const allBlocks = [...pendingFmatterBlocks, ...blocks];
      pendingFmatterBlocks = [];

      // 标题优先级：nav href 指向本 p-NNN > nav href 指向配对 p-fmatter > headingText。
      // 没有源目录/标题的中间页（如 p-007）保留正文，但不能用首段伪造目录项。
      let includeInToc = false;
      let title = tocHrefToTitle.get(name);
      if (title) {
        includeInToc = true;
      } else {
        // 找前一个紧邻的 p-fmatter（配对彩插）的 nav 标题
        for (let j = i - 1; j >= 0; j--) {
          const prev = spineNames[j];
          if (fmatterRe.test(prev)) {
            title = fmatterTitleMap.get(prev);
            if (title) includeInToc = true;
            break;
          }
          if (chapterRe.test(prev)) break; // 遇到上一个正文就停
        }
      }
      if (!title) {
        const rawTitle = headingText ? simplifyText(headingText) : '';
        title = /^后记|^後記|^あとがき/.test(rawTitle) ? '后记' : rawTitle;
        includeInToc = Boolean(title);
      } else {
        title = simplifyText(title);
      }

      // p-001 不在 TOC 且无配对彩插标题 → 卷首语 preBlocks（仅取首段且 <200 字）
      const inToc = tocHrefToTitle.has(name);
      if (!inToc && name === 'p-001.xhtml' && !title) {
        const textBlocks = allBlocks.filter((b) => b.type === 'text');
        if (textBlocks.length > 0 && textBlocks[0].text.length < 200) {
          preBlocks = textBlocks;
          continue;
        }
      }

      chapters.push({ title: title || '', blocks: allBlocks, includeInToc });
      continue;
    }
  }

  // == 5) 构建 sourceImages ==
  const sourceImages = {
    cover: imgObj(coverFileName, { id: 'cover', fileName: 'cover.jpg', mediaType: 'image/jpeg' }),
    front: frontImages.map((img) => imgObj(img.fileName)),
    body: [],
    back: backImages.map((img) => imgObj(img.fileName)),
  };
  for (const chapter of chapters) {
    for (const block of chapter.blocks) {
      if (block.type === 'image') sourceImages.body.push(imgObj(block.fileName));
    }
  }

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
    tocTitles: tocEntries.map((e) => simplifyText(e.title)),
    chapters,
    _sourceImages: sourceImages,
  };
}
