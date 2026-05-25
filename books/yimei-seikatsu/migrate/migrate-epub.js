/**
 * 义妹生活书系译文迁移主入口（Node 版，对齐 Python scripts/migrate_epub.py）。
 *
 * 策略：
 * - 排版骨架：REF（OEBPS/Styles + Misc + Fonts）从 refEpub 解包
 * - 章节正文：chapter-renderer（含引言剥离 + STERA 注释升级 + 内联插图 + 注释 override）
 * - 附章：cover/illus/title/message/summary/contents/TOC/pre 全部用 extras-cleaner 模板生成
 *        特典 special0001-0003 走 chapter-renderer 重渲染（注释升级 + 模板对齐）
 * - 图片：SRC 1 张高清封面覆盖 + DST 装饰图/彩插/章内插图
 * - OPF / NCX / Nav：metadata-builder + toc-builder 重新生成
 *
 * 入口签名（被 src/entries/migrate-translation.js 调用）：
 *   default async ({srcEpub, dstEpub, refEpub, outEpub, volume, profile})
 */
import { rm, mkdir, copyFile, readdir, readFile, writeFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { parseHTML } from 'linkedom';

import { readEpub } from '../../../src/core/zip-io.js';
import { packEpub } from './epub-io.js';
import { extractParagraphs } from './paragraph-extractor.js';
import { extractFootnotes } from './footnote-extractor.js';
import { extractInlineImages } from './inline-image-extractor.js';
import { alignParagraphs } from './aligner.js';
import { relocateFootnote } from './footnote-relocator.js';
import { lookupOverride, resolveOverride } from './footnote-overrides.js';
import { buildSteraFootnote } from './footnote-cleaner.js';
import { renderChapter } from './chapter-renderer.js';
import {
  buildCoverXhtml,
  buildIllusXhtml,
  buildTitleXhtml,
  buildMessageXhtml,
  buildSummaryXhtml,
  buildContentsXhtml,
  buildPreXhtml,
  buildTocXhtml as buildTocXhtmlClean15,
} from './extras-cleaner.js';
import { buildContentOpf } from './metadata-builder.js';
import { buildTocNcx, buildNavXhtml } from './toc-builder.js';

// ============================================================
// 09 卷常量（profile 字段缺位时的硬编码兜底）
// ============================================================

// SRC chapter N → DST split 文件列表
const CHAPTER_MAP_09 = [
  [1, ['Text/chapter0001_split_000.xhtml', 'Text/chapter0001_split_001.xhtml']],
  [2, ['Text/chapter0002_split_000.xhtml', 'Text/chapter0002_split_001.xhtml']],
  [3, ['Text/chapter0003.xhtml']],
  [4, ['Text/chapter0004_split_000.xhtml', 'Text/chapter0004_split_001.xhtml']],
  [5, ['Text/chapter0005.xhtml']],
  [6, ['Text/chapter0006_split_000.xhtml', 'Text/chapter0006_split_001.xhtml']],
  [7, ['Text/chapter0007_split_000.xhtml',
       'Text/chapter0007_split_001.xhtml',
       'Text/chapter0007_split_002.xhtml']],
  [8, ['Text/chapter0008_split_000.xhtml', 'Text/chapter0008_split_001.xhtml']],
  [9, ['Text/chapter0009.xhtml']],
  [10, ['Text/chapter0010_split_000.xhtml', 'Text/chapter0010_split_001.xhtml']],
  [11, ['Text/chapter0011.xhtml']],
  [12, ['Text/chapter0012_split_000.xhtml',
        'Text/chapter0012_split_001.xhtml',
        'Text/chapter0012_split_002.xhtml']],
];

// 09 卷制作信息（提自 DST message.xhtml）
const CREDITS_09 = [
  ['作者', '三河ごーすと'],
  ['插画', 'Hiten'],
  ['译者', '幽蝉满耳'],
  ['校对', '炫目林光'],
  ['图源', 'UU'],
  ['录入', 'coolbar'],
  ['嵌字', '闲的e书组'],
  ['ePub', '落合葵'],
];
const CREDITS_URL = 'https://www.lightnovel.us';

// 09 卷简介
const SRC_DESCRIPTION_09 = `我紧紧握住他牵着我的那只手，一点都不想放开。
在校是「情侣」，在家是「兄妹」。
悠太与沙季通过磨合找出适当距离，
但是紧接着就因为父母不在而要度过「完全只有两个人的两天」，
两人真的能继续维持适当的距离吗……？
另一方面，学校活动、朋友的青春与加油、与打工新人「后辈小妹」的交流等，
崭新的风毫不留情地吹向悠太与沙季……？
「相遇」至今一年，历经许多事而改变的两人，迎来高中生活最后的夏天。
经历过友情、青春、新的相遇之后，「兄妹」所面对的感情是──`;

// SRC 高清覆盖图（SRC 路径 → 输出 build/Images 文件名）
const SRC_TO_STERA_09 = { '191020.jpg': 'cover.jpg' };

// 书名信息
const BOOK_TITLE_09 = '义妹生活 09';

// ============================================================
// 工具函数
// ============================================================

/** @param {string} p */
async function pathExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

/** 递归拷贝目录 */
async function copyDir(src, dst) {
  await mkdir(dst, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const sp = join(src, e.name);
    const dp = join(dst, e.name);
    if (e.isDirectory()) await copyDir(sp, dp);
    else if (e.isFile()) await copyFile(sp, dp);
  }
}

/** 把 epub 解包到 destDir（保留目录结构）。 */
async function unpackEpubTo(epubPath, destDir) {
  await mkdir(destDir, { recursive: true });
  const { names, entries } = await readEpub(epubPath);
  for (const name of names) {
    const buf = entries[name];
    const full = join(destDir, name);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, buf);
  }
}

async function stripMissingFontFaces(cssPath, fontFamilies) {
  if (!(await pathExists(cssPath))) return;
  let content = await readFile(cssPath, 'utf-8');
  // 与 Python read_text/write_text 默认行为对齐：统一把 CRLF → LF
  content = content.replace(/\r\n/g, '\n');
  for (const family of fontFamilies) {
    const escaped = family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `@font-face\\{font-family:"${escaped}";src:url\\(\\.\\./Fonts/${escaped}\\.ttf\\);\\}`,
      'g',
    );
    content = content.replace(re, '');
  }
  await writeFile(cssPath, content, 'utf-8');
}

function extractH3Title(xhtmlPath) {
  const xml = readFileSync(xhtmlPath, 'utf-8');
  const { document } = parseHTML(xml);
  for (const h3 of document.querySelectorAll('h3')) {
    const text = (h3.textContent ?? '').trim();
    if (text) return text;
  }
  return '未命名章节';
}

function extractH4H5Title(xhtmlPath) {
  const xml = readFileSync(xhtmlPath, 'utf-8');
  const { document } = parseHTML(xml);
  const parts = [];
  for (const tag of ['h4', 'h5']) {
    for (const el of document.querySelectorAll(tag)) {
      const text = (el.textContent ?? '').trim();
      if (text) { parts.push(text); break; }
    }
  }
  return parts.length > 0 ? parts.join('　') : extractH3Title(xhtmlPath);
}

function lowerExt(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.substring(i).toLowerCase();
}

async function walkDir(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walkDir(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

// ============================================================
// Step 1: 搭 build 骨架
// ============================================================

async function setupBuildDir({ refUnpacked, dstUnpacked, srcUnpacked, buildDir }) {
  if (existsSync(buildDir)) {
    await rm(buildDir, { recursive: true, force: true });
  }
  await mkdir(buildDir, { recursive: true });

  // mimetype + META-INF 来自 REF
  await copyFile(join(refUnpacked, 'mimetype'), join(buildDir, 'mimetype'));
  await copyDir(join(refUnpacked, 'META-INF'), join(buildDir, 'META-INF'));

  // OEBPS 骨架
  const oebps = join(buildDir, 'OEBPS');
  await mkdir(oebps);
  await copyDir(join(refUnpacked, 'OEBPS/Styles'), join(oebps, 'Styles'));
  await copyDir(join(refUnpacked, 'OEBPS/Misc'), join(oebps, 'Misc'));
  await copyDir(join(refUnpacked, 'OEBPS/Fonts'), join(oebps, 'Fonts'));

  // 从 DST 补 emoji.ttf / sym.ttf
  for (const f of ['emoji.ttf', 'sym.ttf']) {
    // DST 解包后字体可能在 OEBPS/Fonts 或 Fonts，都试一下
    for (const candidate of [
      join(dstUnpacked, 'OEBPS', 'Fonts', f),
      join(dstUnpacked, 'Fonts', f),
    ]) {
      if (await pathExists(candidate)) {
        await copyFile(candidate, join(oebps, 'Fonts', f));
        break;
      }
    }
  }

  // Text 空目录
  await mkdir(join(oebps, 'Text'));

  // Images：先拷 DST 全部图片，然后 SRC 高清覆盖封面
  const images = join(oebps, 'Images');
  await mkdir(images);
  await copyDstDecorationImages(dstUnpacked, images);
  await copySrcImages(srcUnpacked, images);

  // 修剪 CSS @font-face：REF07 引用了不存在的 title/illus1-5/num/cont 字体
  await stripMissingFontFaces(
    join(oebps, 'Styles', 'default.css'),
    ['title', 'illus1', 'illus2', 'illus3', 'illus4', 'illus5', 'num'],
  );
  await stripMissingFontFaces(
    join(oebps, 'Styles', 'necessary.css'),
    ['cont'],
  );
}

/** 9h SRC 高清封面覆盖：191020.jpg → cover.jpg */
async function copySrcImages(srcUnpacked, imagesDir) {
  for (const [srcName, dstName] of Object.entries(SRC_TO_STERA_09)) {
    for (const candidate of [
      join(srcUnpacked, 'OEBPS', 'Images', srcName),
      join(srcUnpacked, 'Images', srcName),
    ]) {
      if (await pathExists(candidate)) {
        await copyFile(candidate, join(imagesDir, dstName));
        console.log(`  SRC 高清覆盖：${srcName} → ${dstName}`);
        break;
      }
    }
  }
}

/** 从 DST 拷装饰图 + 彩插 + 章内插图（除封面外全部 DST 高清 webp）。 */
async function copyDstDecorationImages(dstUnpacked, imagesDir) {
  const names = [
    't1.webp', 't2.webp', 't3.webp', 't4.webp',
    'logo.webp', 'note.webp', 'note1.webp', 'toc-001.webp',
  ];
  for (let i = 1; i <= 5; i++) names.push(`kuchie-${String(i).padStart(3, '0')}.webp`);
  for (const n of ['039', '062', '137', '177', '196', '209', '242', '267', '304', '318']) {
    names.push(`p${n}.webp`);
  }
  for (const name of names) {
    for (const candidate of [
      join(dstUnpacked, 'Images', name),
      join(dstUnpacked, 'OEBPS', 'Images', name),
    ]) {
      if (await pathExists(candidate)) {
        await copyFile(candidate, join(imagesDir, name));
        break;
      }
    }
  }
}

// ============================================================
// Step 2: 12 个正文章节
// ============================================================

async function migrateChapters({ srcUnpacked, dstUnpacked, buildDir, profile, volume }) {
  const tocEntries = [];
  const reviewItems = [];
  const epigraph = profile.epigraphs?.[volume];
  const overrides = profile.footnoteOverrides?.[volume];

  for (const [srcChapterNum, dstFiles] of CHAPTER_MAP_09) {
    const chapterKey = `chapter${String(srcChapterNum).padStart(4, '0')}`;

    // SRC 段落
    const srcPath = join(srcUnpacked, 'OEBPS/Text', `chapter${srcChapterNum}.xhtml`);
    let srcParas = extractParagraphs(srcPath);

    // 9h-1 chapter1 引言剥离：若 SRC 第 1 段就是 profile.epigraphs[volume]，从正文跳过
    // （chapter-renderer 已内置 epigraph 剥离逻辑，但只在 chapterNumber===1 时生效；
    //  这里同步做一次，让 dst-src 对齐基数与 Python 一致）。
    if (
      srcChapterNum === 1 && epigraph &&
      srcParas.length > 0 && srcParas[0].startsWith(epigraph.substring(0, 10))
    ) {
      srcParas = srcParas.slice(1);
    }

    // 合并 DST split
    const dstParas = [];
    const allNotes = [];
    const allInlineImgs = [];
    for (const f of dstFiles) {
      const dstFilePath = join(dstUnpacked, 'OEBPS', f);
      const dstFilePathAlt = join(dstUnpacked, f);
      const actual = (await pathExists(dstFilePath)) ? dstFilePath : dstFilePathAlt;
      const fileParas = extractParagraphs(actual);
      const fileNotes = extractFootnotes(actual);
      const fileImgs = extractInlineImages(actual);
      const offset = dstParas.length;
      for (const n of fileNotes) n.hostParaIndex += offset;
      for (const im of fileImgs) im.afterParaIndex += offset;
      dstParas.push(...fileParas);
      allNotes.push(...fileNotes);
      allInlineImgs.push(...fileImgs);
    }

    // 段落对齐
    const pairs = alignParagraphs(srcParas, dstParas);

    // 定位注释 + sup 注入（含 9g override 接入）
    const outParas = [...srcParas];
    /** @type {Map<number, string[]>} */
    const paraToAsides = new Map();
    let newIdNum = 0;
    for (const fn of allNotes) {
      newIdNum += 1;
      const noteId = `note${String(newIdNum).padStart(3, '0')}`;
      let srcIdx, charOff, confidence, score;

      // 9g：先查 override，命中则覆盖 relocator 输出
      const overrideRaw = lookupOverride(overrides, chapterKey, noteId);
      const overrideResolved = overrideRaw ? resolveOverride(overrideRaw, srcParas) : null;
      if (overrideResolved) {
        srcIdx = overrideResolved.srcParaIdx;
        charOff = overrideResolved.srcCharOffset;
        confidence = 'OVERRIDE';
        score = 100.0;
      } else {
        const relocation = relocateFootnote(fn, srcParas, pairs);
        srcIdx = relocation.srcParaIdx;
        charOff = relocation.srcCharOffset;
        confidence = relocation.confidence;
        score = relocation.score;
      }

      const [supHtml, asideHtml] = buildSteraFootnote(fn, newIdNum);
      const p = outParas[srcIdx];
      outParas[srcIdx] = p.substring(0, charOff) + supHtml + p.substring(charOff);
      if (!paraToAsides.has(srcIdx)) paraToAsides.set(srcIdx, []);
      paraToAsides.get(srcIdx).push(asideHtml);

      reviewItems.push({
        chapter: chapterKey,
        newNoteId: noteId,
        confidence,
        score,
        dstContext: fn.beforeCtx + '▮' + fn.afterCtx,
        srcTarget: outParas[srcIdx].substring(0, 80),
        noteText: fn.text,
      });
    }

    // 章内插图：DST after_para_index 映射到 SRC idx
    /** @type {Map<number, number>} */
    const dstToSrc = new Map();
    for (const [s, d] of pairs) {
      if (s !== null && d !== null) dstToSrc.set(d, s);
    }
    /** @type {Map<number, string[]>} */
    const imgsAfterSrcIdx = new Map();
    for (const img of allInlineImgs) {
      let srcIdx = dstToSrc.get(img.afterParaIndex);
      const directHit = srcIdx !== undefined;
      if (srcIdx === undefined) {
        const sortedDsts = [...dstToSrc.keys()].sort((a, b) => a - b);
        for (const d of sortedDsts) {
          if (d >= img.afterParaIndex) { srcIdx = dstToSrc.get(d); break; }
        }
        if (srcIdx === undefined) srcIdx = outParas.length - 1;
      }
      if (!imgsAfterSrcIdx.has(srcIdx)) imgsAfterSrcIdx.set(srcIdx, []);
      imgsAfterSrcIdx.get(srcIdx).push(img.steraHtml);
      reviewItems.push({
        chapter: chapterKey,
        newNoteId: `illus[${img.srcFilename}]`,
        confidence: directHit ? 'HIGH' : 'MEDIUM',
        score: directHit ? 100.0 : 0.0,
        dstContext: `after DST para ${img.afterParaIndex}`,
        srcTarget: `after SRC para ${srcIdx}`,
        noteText: `内联插图: ${img.srcFilename}`,
      });
    }

    // 交织 blocks：含 aside 的段落用 dict block（chapter-renderer 用 <note> 包）
    /** @type {Array<string | {para: string, aside: string}>} */
    const blocks = [];
    for (let i = 0; i < outParas.length; i++) {
      if (paraToAsides.has(i)) {
        blocks.push({ para: outParas[i], aside: paraToAsides.get(i).join('\n') });
      } else {
        blocks.push(outParas[i]);
      }
      const imgs = imgsAfterSrcIdx.get(i);
      if (imgs) for (const html of imgs) blocks.push(html);
    }

    // 标题
    const dstFile0Path = await firstExisting([
      join(dstUnpacked, 'OEBPS', dstFiles[0]),
      join(dstUnpacked, dstFiles[0]),
    ]);
    const title = extractH3Title(dstFile0Path);

    // 9h-2：传 chapterNumber + epigraph 给 chapter-renderer（chapter1 时它会再判定一次剥离）
    // 但我们已在上方剥离过 srcParas[0]，所以这里 chapterNumber 不传 1，避免双重剥离
    // —— 例外：当我们没剥成功时（开头不匹配），让 renderer 兜底
    const xhtml = renderChapter({ title, blocks });
    const outFile = join(buildDir, 'OEBPS/Text', `${chapterKey}.xhtml`);
    await writeFile(outFile, xhtml, 'utf-8');

    tocEntries.push({ title, href: `Text/${chapterKey}.xhtml` });

    console.log(
      `  ✓ ${chapterKey}: SRC ${srcParas.length} 段 / DST ${dstParas.length} 段 / ` +
      `${allNotes.length} 注释 / ${allInlineImgs.length} 插图`,
    );
  }
  return { tocEntries, reviewItems };
}

async function firstExisting(paths) {
  for (const p of paths) if (await pathExists(p)) return p;
  return paths[0];
}

// ============================================================
// Step 3 (9i)：特典 special0001-0003 走 chapter-renderer
// ============================================================

async function migrateSpecials({ dstUnpacked, buildDir, profile, volume }) {
  const tocEntries = [];
  const reviewItems = [];
  const specials = profile.specials?.[volume] ?? [
    { id: 'special0001' }, { id: 'special0002' }, { id: 'special0003' },
  ];

  for (const spec of specials) {
    const name = `${spec.id}.xhtml`;
    const dstPath = await firstExisting([
      join(dstUnpacked, 'OEBPS', 'Text', name),
      join(dstUnpacked, 'Text', name),
    ]);
    if (!(await pathExists(dstPath))) continue;

    const dstParas = extractParagraphs(dstPath);
    const notes = extractFootnotes(dstPath);
    const inlineImgs = extractInlineImages(dstPath);

    const outParas = [...dstParas];
    /** @type {Map<number, string[]>} */
    const paraToAsides = new Map();
    let newIdNum = 0;
    for (const fn of notes) {
      newIdNum += 1;
      const [supHtml, asideHtml] = buildSteraFootnote(fn, newIdNum);
      const idx = fn.hostParaIndex;
      if (idx >= 0 && idx < outParas.length) {
        const off = Math.min(fn.supOffset, outParas[idx].length);
        outParas[idx] = outParas[idx].substring(0, off) + supHtml + outParas[idx].substring(off);
        if (!paraToAsides.has(idx)) paraToAsides.set(idx, []);
        paraToAsides.get(idx).push(asideHtml);
      }
      reviewItems.push({
        chapter: spec.id,
        newNoteId: `note${String(newIdNum).padStart(3, '0')}`,
        confidence: 'HIGH',
        score: 100.0,
        dstContext: fn.beforeCtx + '▮' + fn.afterCtx,
        srcTarget: (idx >= 0 && idx < outParas.length) ? outParas[idx].substring(0, 80) : '',
        noteText: fn.text,
      });
    }

    /** @type {Map<number, string[]>} */
    const imgsAfter = new Map();
    for (const img of inlineImgs) {
      if (!imgsAfter.has(img.afterParaIndex)) imgsAfter.set(img.afterParaIndex, []);
      imgsAfter.get(img.afterParaIndex).push(img.steraHtml);
    }

    /** @type {Array<string | {para: string, aside: string}>} */
    const blocks = [];
    for (let i = 0; i < outParas.length; i++) {
      if (paraToAsides.has(i)) {
        blocks.push({ para: outParas[i], aside: paraToAsides.get(i).join('\n') });
      } else {
        blocks.push(outParas[i]);
      }
      const imgs = imgsAfter.get(i);
      if (imgs) for (const html of imgs) blocks.push(html);
    }

    const title = spec.title ?? extractH4H5Title(dstPath);
    const xhtml = renderChapter({ title, blocks });
    await writeFile(join(buildDir, 'OEBPS/Text', name), xhtml, 'utf-8');
    tocEntries.push({ title, href: `Text/${name}` });

    console.log(`  ✓ ${name}: ${dstParas.length} 段 / ${notes.length} 注释 / 「${title}」`);
  }
  return { tocEntries, reviewItems };
}

// ============================================================
// Step 4 (9j)：附章 cover/illus(5)/title/message/summary/contents/pre/TOC
// ============================================================

async function writeAttachedPages({ buildDir }) {
  const textDir = join(buildDir, 'OEBPS/Text');

  // cover.xhtml
  await writeFile(join(textDir, 'cover.xhtml'), buildCoverXhtml('cover.jpg'), 'utf-8');

  // illus0001-0005.xhtml（5 张，不是 4 张）
  for (let n = 1; n <= 5; n++) {
    const fn = `kuchie-${String(n).padStart(3, '0')}.webp`;
    await writeFile(
      join(textDir, `illus${String(n).padStart(4, '0')}.xhtml`),
      buildIllusXhtml(fn, `kuchie-${String(n).padStart(3, '0')}`),
      'utf-8',
    );
  }

  // title.xhtml
  await writeFile(
    join(textDir, 'title.xhtml'),
    buildTitleXhtml('t1.webp', 't2.webp', 't3.webp', 't4.webp'),
    'utf-8',
  );

  // message.xhtml
  await writeFile(
    join(textDir, 'message.xhtml'),
    buildMessageXhtml(CREDITS_09, CREDITS_URL, 'logo.webp'),
    'utf-8',
  );

  // summary.xhtml
  await writeFile(join(textDir, 'summary.xhtml'), buildSummaryXhtml(SRC_DESCRIPTION_09), 'utf-8');

  // contents.xhtml（toc-001 装饰目录页）
  await writeFile(join(textDir, 'contents.xhtml'), buildContentsXhtml('toc-001.webp'), 'utf-8');

  // pre.xhtml（卷首引言）
  await writeFile(
    join(textDir, 'pre.xhtml'),
    buildPreXhtml('冷静的人生规划不保证会有幸福的人生。幸福藏在刹那间的狂热之中。'),
    'utf-8',
  );
}

// ============================================================
// Step 5 (9k)：TOC + content.opf
// ============================================================

async function writeMetadataAndToc({ buildDir, chapterToc, specialToc }) {
  const bookUuid = randomUUID();
  const modifiedIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  // nav 顺序：封面/书名/制作信息/简介/彩插/目录/12 章/特典（嵌套）
  // 「目录」项与 11-15 卷 nav 结构对齐，位于彩插与第一章之间
  const specialsGrouped = specialToc.length > 0 ? [{
    title: '特典',
    href: specialToc[0].href,
    children: [...specialToc],
  }] : [];

  const fullToc = [
    { title: '封面', href: 'Text/cover.xhtml' },
    { title: '书名页', href: 'Text/title.xhtml' },
    { title: '制作信息', href: 'Text/message.xhtml' },
    { title: '简介', href: 'Text/summary.xhtml' },
    { title: '彩插', href: 'Text/illus0001.xhtml' },
    { title: '目录', href: 'Text/TOC.xhtml' },
    ...chapterToc,
    ...specialsGrouped,
  ];

  // TOC.xhtml 仅 12 章 + 3 特典；用 extras-cleaner 的 clean15 风格模板（[[href, title], ...]）
  // 全角空格转半角与 nav/ncx 对齐
  const tocVisibleEntries = [...chapterToc, ...specialToc].map((e) => [
    e.href.startsWith('Text/') ? e.href.substring(5) : e.href,
    e.title.replaceAll('　', ' '),
  ]);
  await writeFile(
    join(buildDir, 'OEBPS/Text/TOC.xhtml'),
    buildTocXhtmlClean15(tocVisibleEntries),
    'utf-8',
  );

  // ncx 嵌套：与 11/15 卷一致，特典作为父节点 + 3 个子节点（depth=2）
  // 多看 UI 因 necessary.css 隐藏 nav 元素，所有卷实际走 NCX；嵌套结构让用户看到"特典 group"
  const ncxToc = [
    { title: '封面', href: 'Text/cover.xhtml' },
    { title: '书名页', href: 'Text/title.xhtml' },
    { title: '制作信息', href: 'Text/message.xhtml' },
    { title: '简介', href: 'Text/summary.xhtml' },
    { title: '彩插', href: 'Text/illus0001.xhtml' },
    { title: '目录', href: 'Text/TOC.xhtml' },
    ...chapterToc,
    ...specialsGrouped,
  ];
  const ncx = buildTocNcx({ title: BOOK_TITLE_09, uuid: bookUuid, entries: ncxToc });
  await writeFile(join(buildDir, 'OEBPS/toc.ncx'), ncx, 'utf-8');

  // nav：保留嵌套，href 去掉 Text/ 前缀
  const stripTextPrefix = (entries) => entries.map((e) => ({
    title: e.title,
    href: e.href.startsWith('Text/') ? e.href.substring(5) : e.href,
    children: Array.isArray(e.children) ? stripTextPrefix(e.children) : undefined,
  }));
  const nav = buildNavXhtml({ title: '目录', entries: stripTextPrefix(fullToc) });
  await writeFile(join(buildDir, 'OEBPS/Text/navigation-documents.xhtml'), nav, 'utf-8');

  // 扫 manifest + spine + 写 opf
  const manifestItems = await buildManifest(join(buildDir, 'OEBPS'));
  const spineItems = buildSpine();
  const opf = buildContentOpf({
    title: BOOK_TITLE_09,
    description: SRC_DESCRIPTION_09,
    uuid: bookUuid,
    modifiedIso,
    manifestItems,
    spineItems,
  });
  await writeFile(join(buildDir, 'OEBPS/content.opf'), opf, 'utf-8');
}

async function buildManifest(oebpsDir) {
  const mediaTypes = {
    '.xhtml': 'application/xhtml+xml', '.css': 'text/css',
    '.js': 'application/javascript', '.ttf': 'font/ttf',
    '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png',
    '.ncx': 'application/x-dtbncx+xml',
  };
  const dirPrefix = { Fonts: 'font_', Images: 'img_', Styles: 'css_', Misc: 'js_' };
  // 9j：scripted 集合含 illus0005，删 talk
  const scripted = new Set([
    'cover.xhtml', 'title.xhtml', 'message.xhtml', 'summary.xhtml',
    'TOC.xhtml', 'pre.xhtml', 'contents.xhtml',
    'illus0001.xhtml', 'illus0002.xhtml', 'illus0003.xhtml',
    'illus0004.xhtml', 'illus0005.xhtml',
    'special0001.xhtml', 'special0002.xhtml', 'special0003.xhtml',
  ]);
  const chapterFiles = new Set();
  for (let i = 1; i <= 12; i++) chapterFiles.add(`chapter${String(i).padStart(4, '0')}.xhtml`);

  const allFiles = (await walkDir(oebpsDir)).sort();
  const items = [];
  for (const fp of allFiles) {
    const name = basename(fp);
    if (name === 'content.opf') continue;
    const rel = fp.substring(oebpsDir.length + 1).split('\\').join('/');
    const ext = lowerExt(name);
    const mt = mediaTypes[ext] || 'application/octet-stream';
    const parentName = basename(dirname(fp));
    const stem = name.replace(/\.[^.]+$/, '');

    let itemId;
    if (parentName === 'Text') itemId = stem.replace(/\./g, '_');
    else if (dirPrefix[parentName]) itemId = dirPrefix[parentName] + stem.replace(/\./g, '_').toLowerCase();
    else itemId = stem.replace(/\./g, '_').toLowerCase();

    let properties = null;
    if (name === 'cover.jpg') { itemId = 'cover-image'; properties = 'cover-image'; }
    else if (name === 'toc.ncx') { itemId = 'ncx'; }
    else if (name === 'navigation-documents.xhtml') { itemId = 'nav'; properties = 'nav'; }
    else if (scripted.has(name) || chapterFiles.has(name)) properties = 'scripted';

    items.push({ id: itemId, href: rel, mediaType: mt, properties });
  }
  return items;
}

/** 9l：spine 加 contents + pre，删 talk，含 illus0005 */
function buildSpine() {
  const spine = [];
  spine.push({ idref: 'cover', linear: 'yes', properties: 'duokan-page-fullscreen' });
  spine.push({ idref: 'title', linear: 'yes', properties: null });
  spine.push({ idref: 'message', linear: 'yes', properties: null });
  spine.push({ idref: 'summary', linear: 'yes', properties: null });
  for (let n = 1; n <= 5; n++) {
    spine.push({
      idref: `illus${String(n).padStart(4, '0')}`,
      linear: 'yes',
      properties: 'duokan-page-fitwindow',
    });
  }
  spine.push({ idref: 'contents', linear: 'yes', properties: 'duokan-page-fitwindow' });
  spine.push({ idref: 'TOC', linear: 'yes', properties: null });
  spine.push({ idref: 'pre', linear: 'yes', properties: null });
  for (let i = 1; i <= 12; i++) {
    spine.push({
      idref: `chapter${String(i).padStart(4, '0')}`,
      linear: 'yes',
      properties: null,
    });
  }
  for (let n = 1; n <= 3; n++) {
    spine.push({
      idref: `special${String(n).padStart(4, '0')}`,
      linear: 'yes',
      properties: null,
    });
  }
  spine.push({ idref: 'nav', linear: 'no', properties: null });
  return spine;
}

// ============================================================
// Step 6: 写审计报告
// ============================================================

async function writeAlignReport(reviewItems, reportPath) {
  const lines = [
    '# 注释定位与对齐审计报告\n',
    `共 ${reviewItems.length} 条（注释 + 内联插图），按 chapter+confidence 列出：\n`,
  ];
  const sorted = [...reviewItems].sort((a, b) => {
    if (a.chapter !== b.chapter) return a.chapter < b.chapter ? -1 : 1;
    if (a.confidence !== b.confidence) return a.confidence < b.confidence ? -1 : 1;
    return 0;
  });
  const emojiMap = { HIGH: '✅', MEDIUM: '⚠️', LOW: '❌', OVERRIDE: '🔧' };
  for (const it of sorted) {
    const emoji = emojiMap[it.confidence] ?? '?';
    lines.push(`## ${emoji} ${it.chapter} / ${it.newNoteId} (${it.confidence}, score=${it.score.toFixed(1)})`);
    lines.push(`- **注释**: ${it.noteText}`);
    lines.push(`- **DST 上下文** (▮=sup): \`${it.dstContext}\``);
    lines.push(`- **SRC 插入处** (前 80 字): \`${it.srcTarget}\``);
    lines.push('');
  }
  await writeFile(reportPath, lines.join('\n'), 'utf-8');
}

// ============================================================
// Main 入口（被 src/entries/migrate-translation.js 调用）
// ============================================================

/**
 * @param {{
 *   srcEpub: string, dstEpub: string, refEpub: string,
 *   outEpub: string, volume: string,
 *   profile: object,
 * }} args
 */
export default async function migrate({ srcEpub, dstEpub, refEpub, outEpub, volume, profile }) {
  // 1. 解包到 OS 临时目录
  const workRoot = await mkdtemp(join(tmpdir(), `migrate-${profile.id}-${volume}-`));
  const srcUnpacked = join(workRoot, 'src');
  const dstUnpacked = join(workRoot, 'dst');
  const refUnpacked = join(workRoot, 'ref');
  const buildDir = join(workRoot, 'build');
  const reportPath = `${outEpub}.align_report.md`;

  try {
    console.log(`=== 解包 SRC/DST/REF 到 ${workRoot} ===`);
    await Promise.all([
      unpackEpubTo(srcEpub, srcUnpacked),
      unpackEpubTo(dstEpub, dstUnpacked),
      unpackEpubTo(refEpub, refUnpacked),
    ]);

    console.log('=== Step 1: 搭 build 骨架（REF CSS + Fonts + 图片） ===');
    await setupBuildDir({ refUnpacked, dstUnpacked, srcUnpacked, buildDir });

    console.log('=== Step 2: 写附章（cover/illus/title/message/summary/contents/pre） ===');
    await writeAttachedPages({ buildDir });

    console.log('=== Step 3: 迁移 12 个正文章节 ===');
    const { tocEntries: chapterToc, reviewItems } = await migrateChapters({
      srcUnpacked, dstUnpacked, buildDir, profile, volume,
    });

    console.log('=== Step 4: 迁移特典（special0001-0003） ===');
    const { tocEntries: specialToc, reviewItems: specialReviews } = await migrateSpecials({
      dstUnpacked, buildDir, profile, volume,
    });
    reviewItems.push(...specialReviews);

    console.log('=== Step 5: 写元数据 + TOC ===');
    await writeMetadataAndToc({ buildDir, chapterToc, specialToc });

    console.log('=== Step 6: 打包 EPUB ===');
    await packEpub(buildDir, outEpub);
    console.log(`输出: ${outEpub}`);

    console.log('=== Step 7: 写审计报告 ===');
    await writeAlignReport(reviewItems, reportPath);
    console.log(`已写入 ${reportPath}`);
  } finally {
    // 临时目录保留以便排查（不删）；如需清理可手工删 workRoot
    console.log(`(工作目录保留：${workRoot})`);
  }
}
