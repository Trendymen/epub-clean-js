import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as OpenCC from 'opencc-js';
import { parseHTML } from 'linkedom';

import { readEpub, writeEpub } from '../../../src/core/zip-io.js';
import { applyToFiles } from '../../../src/core/font-subset.js';
import { buildSteraFootnote, selfCloseVoidTags } from '../../../src/core/stages/footnote-fix.js';
import { MESSAGE_DISCLAIMER_LINES } from '../migrate/extras-cleaner.js';
import { anotherDaysFixedFootnotesForChapter } from '../another-days-footnotes.js';

const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });

// 正文里台版译者直接塞进圆括号的内联注释，形如 （注：……）/（註：……）。
// 渲染时把它们升级成 09 ln V8 多端兼容的可点击脚注（与特典同款 duokan-footnote）。
// 注释正文允许一层嵌套圆括号，如 （註：……赫塞（Hermann Karl Hesse）……）。
const INLINE_NOTE_RE = /（[注註][：:]\s*((?:[^（）]|（[^（）]*）)+?)）/g;

const TEXT_MEDIA_TYPE = 'application/xhtml+xml';
const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>';
// 脚注标记统一用 migrate 管线同款青绿「注」图标（books/yimei-seikatsu/assets/note.png），
// 覆盖各卷日翻 styleRef 自带的红/绿版本，保证 09-13 全系列一致。
const FOOTNOTE_ICON_GREEN = fs.readFileSync(path.join(import.meta.dirname, '../assets/note.png'));

const SPECIAL_TEXT_IDS = [
  'specials0001',
  'special0001',
  'special0002',
  'special0003',
  'special0004',
  'special0005',
];
const DEFAULT_CREDIT_OVERRIDES = { 图源: '嘻嘻嘻', 录入: '嘻嘻嘻' };
const DEFAULT_RUBY_ANNOTATIONS_BY_VOLUME = {
  11: [
    { text: '社会数据科学Social Data Science', base: '社会数据科学', ruby: 'Social Data Science' },
    { text: '社会资料科学Social Data Science', base: '社会数据科学', ruby: 'Social Data Science' },
  ],
  // hyread 台繁源的三处 <ruby>，繁转简后正文被摊平成行内串，按摊平形态重建为真 ruby。
  13: [
    { text: '浅村Asamura', base: '浅村', ruby: 'Asamura' },
    { text: '大山千春OoyamaChiharu', base: '大山千春', ruby: 'Ooyama Chiharu' },
    { text: '水星我们学校', base: '水星', ruby: '我们学校' },
  ],
};

function decodeHtmlEntities(input) {
  return String(input)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#34;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&');
}

function escapeXml(input) {
  return String(input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function normalizeText(input) {
  return String(input)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim();
}

function normalizeTitle(input) {
  return normalizeText(input).replace(/^[\s　]+|[\s　]+$/g, '');
}

function normalizeImageSrc(src) {
  return decodeHtmlEntities(src).replaceAll('&amp;', '&');
}

function normalizeBookTitle(title, volume = '11') {
  const simplified = simplifyText(title || `义妹生活 ${volume}`);
  if (/\[台\/繁\]/.test(simplified)) return simplified.replace('[台/繁]', '[台简]');
  if (/\[台繁\]/.test(simplified)) return simplified.replace('[台繁]', '[台简]');
  if (/\[台简\]/.test(simplified)) return simplified;
  return `${simplified.replace(/\s+$/, '')} [台简]`;
}

function isSeparator(text) {
  return /^[-—－―─=＝]+$/.test(text);
}

function isContentsTitle(text) {
  return normalizeText(text).replace(/\s/g, '').toUpperCase() === 'ＣＯＮＴＥＮＴＳ'
    || normalizeText(text).replace(/\s/g, '').toUpperCase() === 'CONTENTS';
}

function isAfterwordTitle(text) {
  return normalizeTitle(text).replace(/\s/g, '') === '后记';
}

function isStyleImage(name) {
  return /^OEBPS\/Images\/(?:t[1-4]|logo|note\d*)\.(?:png|jpe?g|webp)$/i.test(name);
}

function titleKey(text) {
  return normalizeTitle(text).replace(/\s/g, '');
}

function hasText(block) {
  return block?.type === 'text' && normalizeText(block.text);
}

function isNoiseText(text) {
  const normalized = normalizeText(text);
  return !normalized || isSeparator(normalized);
}

function splitHeading(title) {
  const trimmed = normalizeTitle(title);
  const explicit = trimmed.match(/^(.+?)　(.+)$/);
  if (explicit) return [explicit[1], explicit[2]];

  const speaker = trimmed.match(/^(.+?)(浅村悠太|绫濑沙季的日记|绫濑沙季)$/);
  if (speaker && speaker[1]) return [speaker[1], speaker[2]];

  return [trimmed, null];
}

function xhtml(title, body) {
  return `${XML_HEADER}
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:xml="http://www.w3.org/XML/1998/namespace">
<head>
 <title>${escapeXml(title)}</title>
 <link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
 <script type="text/javascript" src="../Misc/script.js"></script>
</head>
<body>
${body}
</body>
</html>`;
}

function renderImageDiv(image, className = 'kuchie') {
  return ` <div class="${className} duokan-image-single">
  <img alt="${escapeXml(image.alt || image.id || 'image')}" src="../Images/${escapeXml(image.fileName)}" zy-enlarge-src="self"/>
 </div>`;
}

function buildRenderedFootnote(body, state) {
  const [refHtml, asideHtml] = buildSteraFootnote({ body }, state.counter, { iconRegular: 'note.png' });
  state.asides.push(asideHtml);
  state.counter += 1;
  return refHtml;
}

function resolveFixedFootnoteOffset(text, note) {
  if (typeof note.charOffset === 'number') {
    return Math.max(0, Math.min(note.charOffset, text.length));
  }
  if (typeof note.anchor !== 'string' || note.anchor.length === 0) return text.length;

  let from = 0;
  const occurrence = Math.max(1, note.occurrence || 1);
  for (let i = 0; i < occurrence; i += 1) {
    const pos = text.indexOf(note.anchor, from);
    if (pos < 0) return text.length;
    if (i === occurrence - 1) return pos + note.anchor.length;
    from = pos + note.anchor.length;
  }
  return text.length;
}

function collectNoteEvents(text, fixedFootnotes = []) {
  const events = [];
  let order = 0;
  let match;
  INLINE_NOTE_RE.lastIndex = 0;
  while ((match = INLINE_NOTE_RE.exec(text)) !== null) {
    events.push({
      type: 'inline',
      start: match.index,
      end: match.index + match[0].length,
      body: normalizeText(match[1]),
      order: order += 1,
    });
  }

  for (const note of fixedFootnotes) {
    const start = resolveFixedFootnoteOffset(text, note);
    events.push({
      type: 'fixed',
      start,
      end: start,
      body: normalizeText(note.body),
      order: order += 1,
    });
  }

  return events
    .filter((event) => event.body)
    .sort((a, b) => (a.start - b.start) || (a.end - b.end) || (a.order - b.order));
}

// 把单个段落文本里的台版内联注释与固定迁移注释替换成 duokan-footnote 引用锚点，
// 注释正文累积到 state.asides，编号由 state.counter 递增（每章重置）。
function renderParagraphWithNotes(text, state, fixedFootnotes = []) {
  if (!state) return escapeXml(text);
  const renderText = (segment) => renderRubyAnnotations(segment, state.rubyAnnotations || []);
  let html = '';
  let lastIndex = 0;
  for (const event of collectNoteEvents(text, fixedFootnotes)) {
    if (event.start < lastIndex) continue;
    html += renderText(text.slice(lastIndex, event.start));
    html += buildRenderedFootnote(event.body, state);
    lastIndex = event.end;
  }
  html += renderText(text.slice(lastIndex));
  return html;
}

function renderRubyAnnotations(text, annotations = []) {
  const rules = annotations
    .filter((rule) => rule?.text && rule?.base && rule?.ruby)
    .map((rule) => ({ ...rule, text: String(rule.text), base: String(rule.base), ruby: String(rule.ruby) }));
  if (rules.length === 0) return escapeXml(text);

  let html = '';
  let cursor = 0;
  while (cursor < text.length) {
    let next = null;
    for (const rule of rules) {
      const index = text.indexOf(rule.text, cursor);
      if (index < 0) continue;
      if (!next || index < next.index) next = { index, rule };
    }
    if (!next) {
      html += escapeXml(text.slice(cursor));
      break;
    }
    html += escapeXml(text.slice(cursor, next.index));
    html += `<ruby>${escapeXml(next.rule.base)}<rt>${escapeXml(next.rule.ruby)}</rt></ruby>`;
    cursor = next.index + next.rule.text.length;
  }
  return html;
}

function renderBlocks(blocks, state = null) {
  const lines = [];
  let paraIdx = 0;
  for (const block of blocks) {
    if (block.type === 'image') {
      lines.push(renderImageDiv(block));
      continue;
    }
    const text = normalizeText(block.text);
    if (!text || isSeparator(text)) continue;
    const fixedFootnotes = state?.fixedFootnotesByPara?.get(paraIdx) ?? [];
    lines.push(` <p>${renderParagraphWithNotes(text, state, fixedFootnotes)}</p>`);
    paraIdx += 1;
  }
  return lines.join('\n');
}

function groupFixedFootnotesByPara(fixedFootnotes = []) {
  const grouped = new Map();
  for (const note of fixedFootnotes) {
    if (typeof note?.afterParaIdx !== 'number') continue;
    if (!grouped.has(note.afterParaIdx)) grouped.set(note.afterParaIdx, []);
    grouped.get(note.afterParaIdx).push(note);
  }
  return grouped;
}

function renderChapterXhtml(chapter, { rubyAnnotations = [], fixedFootnotes = [] } = {}) {
  const [mainTitle, subtitle] = splitHeading(chapter.title);
  // 合并为单行 h3（匹配 healed 日翻版风格），有副标题时用全角空格连接
  const merged = subtitle ? `${mainTitle}　${subtitle}` : mainTitle;
  const heading = merged ? ` <h3>${escapeXml(merged)}</h3>` : '';

  const state = {
    counter: 1,
    asides: [],
    rubyAnnotations,
    fixedFootnotesByPara: groupFixedFootnotesByPara(fixedFootnotes),
  };
  const body = renderBlocks(chapter.blocks, state);
  const footnotes = state.asides.length > 0 ? `\n${state.asides.join('')}` : '';
  return xhtml(chapter.title, [heading, body].filter(Boolean).join('\n') + footnotes);
}

function renderCoverXhtml(coverImage) {
  return xhtml('封面', renderImageDiv(coverImage, 'cover'));
}

function renderImagePage(image) {
  return xhtml('插图', renderImageDiv(image));
}

function renderTitleXhtml(book) {
  return xhtml(
    '标题',
    ` <h1>${escapeXml(book.title)}</h1>
 <p>${escapeXml(book.author || '三河ごーすと')}</p>
 <p>${escapeXml(book.illustrator || 'Hiten')}</p>`,
  );
}

function getCreditValue(book, labels, fallback = '', overrides = {}) {
  for (const label of labels) {
    if (Object.hasOwn(overrides, label)) return String(overrides[label]);
  }
  for (const block of book.creditBlocks) {
    if (!hasText(block)) continue;
    const match = normalizeText(block.text).match(/^([^：:]+)[：:]\s*(.+)$/);
    if (!match) continue;
    const key = match[1].trim();
    if (labels.includes(key)) return match[2].trim();
  }
  return fallback;
}

function renderMessageXhtml(book, { logoFileName = null, creditOverrides = {} } = {}) {
  const rows = [
    ['作者', getCreditValue(book, ['作者'], '三河ごーすと', creditOverrides)],
    ['插画', getCreditValue(book, ['插画', '插畫'], 'Hiten', creditOverrides)],
    ['译者', getCreditValue(book, ['译者', '譯者', '翻译', '翻譯'], 'Seeker', creditOverrides)],
    ['图源', getCreditValue(book, ['图源', '圖源'], '', creditOverrides)],
    ['录入', getCreditValue(book, ['录入', '錄入'], '', creditOverrides)],
  ].filter(([, value]) => value);

  const bodyRows = rows.map(([label, value]) => `   <div class="creator">
    <p>${escapeXml(label)}</p>
   </div>
   <div>
    <p>${escapeXml(value)}</p>
   </div>`).join('\n');

  const logo = logoFileName
    ? `   <div class="logo">
    <img alt="logo" src="../Images/${escapeXml(logoFileName)}" zy-enlarge-src="none"/>
   </div>`
    : '';

  return xhtml('制作信息', ` <div class="message">
  <div>
   <div class="meg">
    <p>制 作 信 息</p>
   </div>
   <div class="meghr"></div>
${bodyRows}
   <div class="group">
    <p style="padding:0 0 0.5em;color:#D11A2D;">${MESSAGE_DISCLAIMER_LINES[0]}</p>
    <p style="color:#D11A2D;">${MESSAGE_DISCLAIMER_LINES[1]}</p>
   </div>
${logo}
  </div>
 </div>`);
}

function renderPreXhtml(book) {
  const text = book.preBlocks
    .filter((block) => block.type === 'text')
    .map((block) => normalizeText(block.text))
    .filter(Boolean)
    .join('');
  const blankLines = Array.from({ length: 5 }, () => ' <p><br/></p>').join('\n');
  return xhtml('', `${blankLines}\n <p><b>${escapeXml(text)}</b></p>`);
}

function flattenTocEntries(entries) {
  return entries.flatMap((entry) => [
    { title: entry.title, href: entry.href },
    ...flattenTocEntries(entry.children || []),
  ]);
}

function renderAnotherDaysTocTitle(title) {
  const normalized = normalizeTitle(title);
  const anime = normalized.match(/^动画义妹生活第(.+?)集随笔（三河ごーすと感想）$/);
  if (anime) {
    return `<p><span class="dbox">动画</span><span class="em05"> </span>义<span class="c1">妹</span>生活第${escapeXml(anime[1])}集随笔</p>
  <p class="ctit">　&#160;&#160;&#160;（三河ごーすと感想）</p>`;
  }

  const sideStory = normalized.match(/^外传小说《(.+?)》(.+)$/);
  if (sideStory) {
    return `<p><span class="ebox">外传小说</span><span class="em05"> </span>《${escapeXml(sideStory[1])}》${escapeXml(sideStory[2])}</p>`;
  }

  return `<p class="em095">${escapeXml(normalized)}</p>`;
}

function setCssDeclaration(declarations, name, value, { after } = {}) {
  const props = declarations.split(';').map((prop) => prop.trim()).filter(Boolean);
  const lowerName = name.toLowerCase();
  const index = props.findIndex((prop) => prop.toLowerCase().startsWith(`${lowerName}:`));
  const next = `${name}:${value}`;
  if (index >= 0) {
    props[index] = next;
    return props.join(';');
  }
  const afterIndex = after
    ? props.findIndex((prop) => prop.toLowerCase().startsWith(`${after.toLowerCase()}:`))
    : -1;
  props.splice(afterIndex >= 0 ? afterIndex + 1 : props.length, 0, next);
  return props.join(';');
}

function tuneAnotherDaysTocStyle(style) {
  return style.replace(/\.toc \.ctit\{([^}]*)\}/, (match, declarations) => {
    let tuned = setCssDeclaration(declarations, 'padding', '0.25em 0 0');
    tuned = setCssDeclaration(tuned, 'line-height', '1.15em', { after: 'padding' });
    return `.toc .ctit{${tuned}}`;
  });
}

function renderAnotherDaysTocXhtml(tocEntries, styleRef) {
  const source = styleRef?.entries['OEBPS/Text/TOC.xhtml']?.toString('utf8');
  if (!source) return null;

  const style = tuneAnotherDaysTocStyle(source.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i)?.[1]?.trim() || '');
  if (!style) return null;
  const bodyAttrs = source.match(/<body\b([^>]*)>/i)?.[1] || ' bgcolor="#ddd"';
  const containerAttrs = source.match(/<body\b[^>]*>\s*<div\b([^>]*)>/i)?.[1]
    || ' style="margin:0 auto 1em;width:fit-content;-webkit-transform:rotate(-2deg);transform:rotate(-2deg);transform-origin:center;"';
  const rows = flattenTocEntries(tocEntries)
    .map((entry) => ` <div class="toc">
  <a href="${escapeXml(path.posix.basename(entry.href))}">
  ${renderAnotherDaysTocTitle(entry.title)}
  </a>
 </div>`)
    .join('\n');

  return `${XML_HEADER}
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:xml="http://www.w3.org/XML/1998/namespace">
<head>
 <title>目录</title>
 <link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
 <script type="text/javascript" src="../Misc/script.js"></script>
 <style>
 ${style}
 </style>
</head>
<body${bodyAttrs}>
<div${containerAttrs}>
 <h3 class="ctt">Contents</h3>
${rows}
</div>
</body>
</html>`;
}

function renderTocXhtml(tocEntries, { styleRef = null, volume = null } = {}) {
  if (volume === 'another-days') {
    const styleToc = renderAnotherDaysTocXhtml(tocEntries, styleRef);
    if (styleToc) return styleToc;
  }

  const style = 'body{-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;}'
    + '.ctt{font-family:ctt2,emoji,sym;text-align:center;font-size:1.8em;margin:1em 0;font-weight:bold;}'
    + '.toc{margin:1em 0 0.5em;text-align:center;border-left:0;}'
    + '.toc a{display:block;font-family:ctt1,emoji,sym;padding:0.25em;}';
  const rows = flattenTocEntries(tocEntries)
    .map((entry) => ` <div class="toc">
  <a href="${escapeXml(path.posix.basename(entry.href))}">
  <p>${escapeXml(entry.title)}</p>
  </a>
 </div>`)
    .join('\n');
  return '<?xml version="1.0" encoding="utf-8"?>\n'
    + '<!DOCTYPE html>\n'
    + '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:xml="http://www.w3.org/XML/1998/namespace">\n'
    + '<head>\n <title>目录</title>\n'
    + ' <link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>\n'
    + ' <script type="text/javascript" src="../Misc/script.js"></script>\n'
    + ` <style>\n ${style}\n </style>\n`
    + '</head>\n'
    + '<body>\n'
    + '<div style="margin:0 auto;width:fit-content;">\n'
    + ` <h3 class="ctt">CONTENTS</h3>\n${rows}\n`
    + '</div>\n'
    + '</body>\n'
    + '</html>';
}

function renderNavXhtml(entries, { hasSummary = false, bodyHref = 'pre.xhtml' } = {}) {
  const renderEntry = (entry, indent = '      ') => {
    const link = `${indent}<li><a href="${escapeXml(path.posix.basename(entry.href))}">${escapeXml(entry.title)}</a>`;
    if (!entry.children?.length) return `${link}</li>`;
    const children = entry.children.map((child) => renderEntry(child, `${indent}  `)).join('\n');
    return `${link}\n${indent}  <ol>\n${children}\n${indent}  </ol>\n${indent}</li>`;
  };
  const rows = entries.map((entry) => renderEntry(entry)).join('\n');
  const summaryLandmark = hasSummary
    ? '      <li><a epub:type="introduction" href="summary.xhtml">简介</a></li>\n'
    : '';
  return `${XML_HEADER}
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:xml="http://www.w3.org/XML/1998/namespace">
<head>
 <title>导航</title>
 <link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
 <script type="text/javascript" src="../Misc/script.js"></script>
</head>
<body epub:type="frontmatter" id="nav">
  <nav epub:type="toc" id="toc" role="doc-toc">
    <h1>目录</h1>
    <ol>
${rows}
    </ol>
  </nav>
  <nav epub:type="landmarks" id="landmarks" hidden="">
    <h1>里程碑</h1>
    <ol>
      <li><a epub:type="cover" href="cover.xhtml">封面</a></li>
${summaryLandmark}      <li><a epub:type="toc" href="TOC.xhtml">目录</a></li>
      <li><a epub:type="bodymatter" href="${escapeXml(bodyHref)}">正文</a></li>
    </ol>
  </nav>
</body>
</html>`;
}

function planChapterRendering(book) {
  let nextIllusIndex = (book.frontImages.length || 0) + 1;
  const plans = book.chapters.map((chapter, index) => {
    const id = `chapter${String(index + 1).padStart(4, '0')}.xhtml`;
    const href = `Text/${id}`;
    const leadingImages = [];
    let i = 0;
    while (i < chapter.blocks.length && chapter.blocks[i].type === 'image') {
      leadingImages.push(chapter.blocks[i]);
      i++;
    }
    const bodyBlocks = chapter.blocks.slice(i);
    const leadingImagePages = leadingImages.map((image) => {
      const illusId = `illus${String(nextIllusIndex).padStart(4, '0')}.xhtml`;
      nextIllusIndex += 1;
      return { id: illusId, href: `Text/${illusId}`, image };
    });
    const hasChapterPage = bodyBlocks.length > 0 || chapter.title;
    return {
      chapter,
      id,
      href,
      bodyBlocks,
      leadingImagePages,
      hasChapterPage,
      navHref: leadingImagePages[0]?.href || (hasChapterPage ? href : null),
    };
  });
  return { plans, nextIllusIndex };
}

function renderTocNcx({ title, uuid, entries }) {
  let playOrder = 0;
  const renderEntry = (entry, indent = '') => {
    playOrder += 1;
    const current = playOrder;
    const n = String(current).padStart(3, '0');
    const children = entry.children?.length
      ? `\n${entry.children.map((child) => renderEntry(child, `${indent}  `)).join('\n')}`
      : '';
    return `${indent}<navPoint id="navPoint${n}" playOrder="${current}">
${indent}<navLabel><text>${escapeXml(entry.title)}</text></navLabel>
${indent}<content src="${escapeXml(entry.href)}"/>${children}
${indent}</navPoint>`;
  };
  const navPoints = entries.map((entry) => renderEntry(entry)).join('\n');

  return `${XML_HEADER}
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head>
<meta name="dtb:uid" content="urn:uuid:${escapeXml(uuid)}"/>
<meta name="dtb:depth" content="${entries.some((entry) => entry.children?.length) ? 2 : 1}"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle>
<text>${escapeXml(title)}</text>
</docTitle>
<navMap>
${navPoints}
</navMap>
</ncx>`;
}

function mediaTypeFor(name, contentType = '') {
  const lowerType = contentType.toLowerCase();
  if (lowerType.includes('image/webp')) return 'image/webp';
  if (lowerType.includes('image/png')) return 'image/png';
  if (lowerType.includes('image/jpeg') || lowerType.includes('image/jpg')) return 'image/jpeg';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.css')) return 'text/css';
  if (name.endsWith('.js')) return 'application/javascript';
  if (name.endsWith('.ttf')) return 'font/ttf';
  if (name.endsWith('.otf')) return 'font/otf';
  if (name.endsWith('.ncx')) return 'application/x-dtbncx+xml';
  return 'application/octet-stream';
}

function extensionForUrl(src, contentType = '') {
  const type = contentType.toLowerCase();
  if (type.includes('webp')) return '.webp';
  if (type.includes('png')) return '.png';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  const clean = src.split('?')[0].toLowerCase();
  const ext = path.posix.extname(clean);
  return ext && ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
}

function imageManifestId(fileName) {
  return fileName.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
}

function manifestIdFromPath(name) {
  return path.posix.basename(name).replace(/[^A-Za-z0-9_.-]+/g, '_');
}

function isCopiedAsset(name) {
  return (
    name.startsWith('META-INF/')
    || name.startsWith('OEBPS/Fonts/')
    || name.startsWith('OEBPS/Styles/')
    || name.startsWith('OEBPS/Misc/')
  );
}

function collectTitleImages(styleRef, titlePath, rawContent) {
  const images = new Map();
  for (const imageRef of extractImageRefsFromXhtml(rawContent)) {
    const resolved = resolveEpubRelativePath(titlePath, imageRef);
    const basename = resolved ? path.posix.basename(resolved) : '';
    const match = basename.match(/^(t[1-4])\.(png|jpe?g|webp)$/i);
    if (!match || !styleRef.entries[resolved]) continue;
    const fileName = `${match[1].toLowerCase()}.${match[2].toLowerCase().replace('jpeg', 'jpg')}`;
    images.set(match[1].toLowerCase(), {
      fileName,
      buffer: styleRef.entries[resolved],
    });
  }
  return images;
}

function renderStyleTitleFromImages(images) {
  const imageName = (id) => escapeXml(images.get(id).fileName);
  return `${XML_HEADER}
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:xml="http://www.w3.org/XML/1998/namespace">
<head>
 <title>标题</title>
 <link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
 <script type="text/javascript" src="../Misc/script.js"></script>
 <style>
 .textbox{font-family:title,main,emoji,sym;}
 .textbox p{margin:0;text-indent:0;duokan-text-indent:0;text-align:center;line-height:1em;font-weight:bold;}
 .textbox .c1{font-size:0.8em;color:#EB6161;}
 .textbox .c2{font-size:1.1em;padding:0.2em 0 1.5em;}
 .textbox .c3{font-size:0.8em;color:#E1C851;}
 .textbox .c4{font-size:1em;padding:0.15em 0 0;}
 </style>
</head>
<body>
  <div class="center" style="margin:4em auto 1em;">
   <p class="tilh"><img alt="t1" src="../Images/${imageName('t1')}" style="width:13em;"/></p>
  </div>
  <div class="center" style="margin:1em auto 2.5em;">
   <p class="tilh"><img alt="t2" src="../Images/${imageName('t2')}" style="width:1.5em;"/></p>
  </div>
  <div class="textbox">
   <p class="c1">作者</p>
   <p class="c2"><img alt="t3" src="../Images/${imageName('t3')}" style="width:5em;"/></p>
   <p class="c3">插画</p>
   <p class="c4"><img alt="t4" src="../Images/${imageName('t4')}" style="width:3em;"/></p>
  </div>
</body>
</html>`;
}

function buildStyleTitleXhtml(styleRef, volume, files) {
  if (!styleRef) return null;
  if (volume !== '08') {
    return selfCloseVoidTags(styleRef.entries['OEBPS/Text/title.xhtml']?.toString('utf8') || null);
  }

  const titlePath = styleRef.entries['OEBPS/Text/title.xhtml']
    ? 'OEBPS/Text/title.xhtml'
    : (styleRef.entries['Text/title.xhtml'] ? 'Text/title.xhtml' : null);
  if (!titlePath) return null;

  const rawContent = styleRef.entries[titlePath].toString('utf8');
  const images = collectTitleImages(styleRef, titlePath, rawContent);
  if (!['t1', 't2', 't3', 't4'].every((id) => images.has(id))) {
    return titlePath.startsWith('OEBPS/')
      ? selfCloseVoidTags(rawContent)
      : null;
  }

  for (const { fileName, buffer } of images.values()) {
    files[`OEBPS/Images/${fileName}`] = buffer;
  }
  return renderStyleTitleFromImages(images);
}

// 按卷把 styleRef 自带的「章节标题/目次」样式对齐到指定基准。
// 08 用 healed 08 当 styleRef（为拿其特典+字体），但 08 日翻自带的 .ctt/.toc 是 11 式居中风
// （且 .toc 带无效的 `font-weight:slid` 笔误）；按用户要求对齐到 13 台简的样式（左对齐 2em + 目次左边框）。
// 在 applyToFiles（字体开源化重写 CSS）之后执行，故匹配的是已重映射为思源字体的最终形态。
const VOLUME_STYLE_ALIGN = {
  '08': [
    [/\.ctt\{font-family:"Source Han Serif SC Light";[^}]*\}/,
      '.ctt{font-family:"Source Han Serif SC Light";text-align:left;font-size:2em;margin:1.3em 0.75em 0.5em;font-weight:bold}'],
    [/\.toc\{margin:[^}]*text-align:center[^}]*\}/,
      '.toc{margin:0 0 0.5em 1.75em;text-align:left;border-left:3px rgba(124,124,124,0.5) solid}'],
  ],
};
function applyVolumeStyleAlign(files, volume) {
  const rules = VOLUME_STYLE_ALIGN[volume];
  const key = 'OEBPS/Styles/necessary.css';
  if (!rules || !files[key]) return;
  let css = files[key].toString('utf8');
  for (const [re, repl] of rules) {
    if (!re.test(css)) { console.warn(`  [style-align] 卷${volume}: 未匹配规则（源样式可能已变，跳过）`); continue; }
    css = css.replace(re, repl);
    console.log(`  [style-align] 卷${volume}: ${repl.slice(0, 36)}…`);
  }
  files[key] = Buffer.from(css);
}

// 按卷替换指定插图为另一来源的版本（用户指定）。
// 08：开头插图「未来預想圖」(产物里为 kuchie-004.jpg) 改用 08 日翻的版本；
// 日翻原为 .webp，已 sips 转 JPEG 存于 ../assets/v08-kuchie-future.jpg，台简彩页用 <img> 故尺寸自适应。
const VOLUME_IMAGE_OVERRIDE = {
  '08': [{ target: 'OEBPS/Images/kuchie-004.jpg', asset: '../assets/v08-kuchie-future.jpg' }],
};
function applyVolumeImageOverride(files, volume) {
  const rules = VOLUME_IMAGE_OVERRIDE[volume];
  if (!rules) return;
  for (const { target, asset } of rules) {
    if (!files[target]) { console.warn(`  [image-override] 卷${volume}: 目标 ${target} 不在产物中（位置可能变，跳过）`); continue; }
    const buf = fs.readFileSync(new URL(asset, import.meta.url));
    files[target] = buf;
    console.log(`  [image-override] 卷${volume}: ${target} ← ${asset} (${buf.length}B)`);
  }
}

function resolveEpubRelativePath(baseFile, ref) {
  const clean = String(ref || '').split('#')[0].split('?')[0];
  if (!clean || /^[a-z]+:/i.test(clean)) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(baseFile), clean));
}

function extractImageRefsFromXhtml(xhtml) {
  const refs = [];
  for (const tag of String(xhtml).matchAll(/<(?:img|image)\b[^>]*>/gi)) {
    const attrs = tag[0];
    const match = attrs.match(/(?:^|\s)(?:src|href|xlink:href)=["']([^"']+)["']/i);
    if (match) refs.push(match[1]);
  }
  return refs;
}

function extractXhtmlTitle(xhtml, fallback) {
  const { document } = parseHTML(xhtml);
  return normalizeTitle(document.querySelector('title')?.textContent || fallback);
}

// 从 style-ref 的 content.opf 解析 spine 顺序与 manifest（id→href）。
// 返回 null 表示没有 OPF（如单测里用 writeEpub 拼的合成 style-ref），调用方回退硬编码列表。
function parseStyleSpine(styleRef) {
  const opfName = styleRef.names.find((name) => name.endsWith('.opf'));
  if (!opfName) return null;
  const opf = styleRef.entries[opfName].toString('utf8');
  const opfDir = path.posix.dirname(opfName);

  const idToHref = new Map();
  for (const m of opf.matchAll(/<item\b([^>]*?)\/?>/g)) {
    const attrs = m[1];
    const id = attrs.match(/\bid="([^"]+)"/)?.[1];
    const href = attrs.match(/\bhref="([^"]+)"/)?.[1];
    if (id && href) idToHref.set(id, href);
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*?\bidref="([^"]+)"/g)].map((m) => m[1]);
  return { opfDir, idToHref, spine };
}

function addStyleTitle(titleMap, baseFile, src, title) {
  const cleanTitle = normalizeTitle(title);
  if (!cleanTitle) return;
  const resolved = resolveEpubRelativePath(baseFile, src);
  if (!resolved) return;
  titleMap.set(resolved, cleanTitle);
  titleMap.set(resolved.replace(/^OEBPS\//, ''), cleanTitle);
  titleMap.set(path.posix.basename(resolved), cleanTitle);
}

function collectStyleTocTitles(styleRef) {
  const titleMap = new Map();
  if (!styleRef) return titleMap;

  const ncxName = styleRef.names.find((name) => /(^|\/)toc\.ncx$/i.test(name));
  const ncx = ncxName ? styleRef.entries[ncxName]?.toString('utf8') : '';
  if (ncx) {
    for (const point of ncx.matchAll(/<navPoint\b[\s\S]*?<\/navPoint>/g)) {
      const label = point[0].match(/<navLabel>\s*<text>([\s\S]*?)<\/text>\s*<\/navLabel>/)?.[1];
      const src = point[0].match(/<content\b[^>]*\bsrc=["']([^"']+)["']/)?.[1];
      if (label && src) addStyleTitle(titleMap, ncxName, src, decodeHtmlEntities(label));
    }
  }

  for (const name of styleRef.names.filter((entry) => /\/TOC\.xhtml$/i.test(entry))) {
    const content = styleRef.entries[name]?.toString('utf8');
    if (!content) continue;
    const { document } = parseHTML(content);
    for (const a of document.querySelectorAll('a')) {
      addStyleTitle(titleMap, name, a.getAttribute('href'), a.textContent);
    }
  }

  return titleMap;
}

function getStyleTocTitle(titleMap, epubPath, fallback) {
  return titleMap.get(epubPath)
    || titleMap.get(epubPath.replace(/^OEBPS\//, ''))
    || titleMap.get(path.posix.basename(epubPath))
    || fallback;
}

function normalizeSourceImageFileName(fileName) {
  const base = path.posix.basename(fileName);
  if (/^cover\.jpe?g$/i.test(base)) return 'cover.jpg';
  if (/\.jpeg$/i.test(base)) return base.replace(/\.jpeg$/i, '.jpg');
  return base;
}

function sourceImageKind(fileName) {
  const base = path.posix.basename(fileName);
  if (/^cover\.(?:jpe?g|png|webp)$/i.test(base)) return 'cover';
  if (/^kuchie-\d+\.(?:jpe?g|png|webp)$/i.test(base)) return 'kuchie';
  if (/^p\d+(?:-\d+)?\.(?:jpe?g|png|webp)$/i.test(base)) return 'body';
  return null;
}

function makeSourceImage(ref) {
  const fileName = normalizeSourceImageFileName(ref.path);
  const id = fileName.replace(/\.[^.]+$/, '');
  return {
    type: 'image',
    src: `epub:${ref.path}`,
    width: 0,
    height: 0,
    alt: id,
    id: ref.kind === 'cover' ? 'cover' : id,
    fileName,
    mediaType: mediaTypeFor(fileName),
    buffer: ref.buffer,
  };
}

function makeProfileSourceImage(sourceEpub, entry, kind) {
  const sourcePath = resolveProfileImagePath(sourceEpub, entry.source);
  const fileName = entry.fileName || normalizeSourceImageFileName(sourcePath);
  const id = entry.id || (kind === 'cover' ? 'cover' : fileName.replace(/\.[^.]+$/, ''));
  return {
    type: 'image',
    src: `epub:${sourcePath}`,
    width: 0,
    height: 0,
    alt: id,
    id,
    fileName,
    mediaType: mediaTypeFor(fileName),
    buffer: sourceEpub.entries[sourcePath],
  };
}

function resolveProfileImagePath(sourceEpub, requestedPath) {
  if (sourceEpub.entries[requestedPath]) return requestedPath;
  const found = sourceEpub.names.find((name) => path.posix.basename(name) === path.posix.basename(requestedPath));
  if (found) return found;
  throw new Error(`Image source not found in source EPUB: ${requestedPath}`);
}

async function loadSourceImagesFromProfile(sourceImageEpubPath, profile) {
  const sourceEpub = await readEpub(sourceImageEpubPath);
  const list = (items, kind) => (items || []).map((entry) => makeProfileSourceImage(sourceEpub, entry, kind));
  return {
    cover: makeProfileSourceImage(sourceEpub, profile.cover, 'cover'),
    front: list(profile.front, 'front'),
    body: list(profile.body, 'body'),
    back: list(profile.back, 'back'),
  };
}

function collectSourceImageRefs(sourceEpub) {
  const spineInfo = parseStyleSpine(sourceEpub);
  if (!spineInfo) throw new Error('Source image EPUB has no OPF spine');

  const refs = [];
  const seenCoverHashes = new Set();
  for (const idref of spineInfo.spine) {
    const href = spineInfo.idToHref.get(idref);
    if (!href) continue;
    const epubPath = path.posix.join(spineInfo.opfDir, href);
    const rawContent = sourceEpub.entries[epubPath]?.toString('utf8');
    if (!rawContent) continue;

    for (const imageRef of extractImageRefsFromXhtml(rawContent)) {
      const resolved = resolveEpubRelativePath(epubPath, imageRef);
      if (!resolved || !sourceEpub.entries[resolved]) continue;
      const kind = sourceImageKind(resolved);
      if (!kind) continue;
      if (kind === 'cover') {
        const hashKey = sourceEpub.entries[resolved].toString('base64');
        if (seenCoverHashes.has(hashKey)) continue;
        seenCoverHashes.add(hashKey);
      }
      refs.push({
        path: resolved,
        kind,
        buffer: sourceEpub.entries[resolved],
      });
    }
  }

  return refs;
}

function splitSourceImages(sourceRefs) {
  const coverRef = sourceRefs.find((ref) => ref.kind === 'cover');
  if (!coverRef) throw new Error('Source image EPUB has no cover image');

  const front = [];
  const body = [];
  const back = [];
  let seenBody = false;
  for (const ref of sourceRefs) {
    if (ref === coverRef || ref.kind === 'cover') continue;
    if (ref.kind === 'body') {
      seenBody = true;
      body.push(ref);
      continue;
    }
    if (ref.kind === 'kuchie') {
      (seenBody ? back : front).push(ref);
    }
  }

  return {
    cover: makeSourceImage(coverRef),
    front: front.map(makeSourceImage),
    body: body.map(makeSourceImage),
    back: back.map(makeSourceImage),
  };
}

function getChapterImageBlocks(book) {
  return book.chapters.flatMap((chapter) => chapter.blocks.filter((block) => block.type === 'image'));
}

function getBookImages(book) {
  return [
    book.coverImage,
    ...book.frontImages,
    ...book.preBlocks.filter((block) => block.type === 'image'),
    ...getChapterImageBlocks(book),
    ...(book.backImages || []),
  ];
}

function applySourceImagesToBook(book, sourceImages) {
  book.coverImage = { ...book.coverImage, ...sourceImages.cover };
  book.frontImages = sourceImages.front.map((image) => ({ ...image }));
  book.backImages = sourceImages.back.map((image) => ({ ...image }));

  const bodyBlocks = getChapterImageBlocks(book);
  if (bodyBlocks.length !== sourceImages.body.length) {
    throw new Error(`Source body image count mismatch: HTML has ${bodyBlocks.length}, source EPUB has ${sourceImages.body.length}`);
  }
  bodyBlocks.forEach((block, index) => {
    Object.assign(block, sourceImages.body[index]);
  });

  return getBookImages(book);
}

async function loadSourceImages(sourceImageEpubPath) {
  const sourceEpub = await readEpub(sourceImageEpubPath);
  return splitSourceImages(collectSourceImageRefs(sourceEpub));
}

// 特典/番外页类型：特典合集封面 specials\d+、番外故事 special\d+、赠图 illus\d+。
// 只收日翻的特典正文页（special*/specials*），不收 illus* 插图页：
// 台简自带台繁卷尾彩页（book.backImages），不需要日翻的卷尾跨页图（如 p288-291）。
const SPECIAL_PAGE_RE = /^(specials\d*|special\d*)(\.xhtml)?$/;

// 特典页来自 styleRef(日翻 healed),其 CSS/脚注图引用名随源结构而异:
// 11-15 是 Sigil 式(../Styles/stylesheet.css + note.png),08 是 calibre 扁平式(../css.css、../page_css.css、note.webp)。
// 统一改写到台简产物约定,否则 calibre 式引用会断链(CSS 不加载、脚注图破图)。对已正确的 13 幂等。
function normalizeSpecialRefs(content) {
  return content
    // 连续的 stylesheet <link> 折叠成一条指向台简样式表的规范链接
    .replace(/(?:<link\b[^>]*\.css"[^>]*>\s*)+/gi, '<link rel="stylesheet" type="text/css" href="../Styles/stylesheet.css"/>\n')
    // 脚注图标统一用 note.png（台简图标约定）
    .replace(/note\.webp/gi, 'note.png');
}

function collectSpecialEntries(styleRef) {
  if (!styleRef) return { pages: [], tocEntries: [], assetNames: [] };

  // 优先按 spine 顺序动态发现：从 specials0001 起到卷末，只取 special*/specials* 特典正文页
  // （天然排除 nav/toc、polo、characters 等非特典页；illus* 插图页一律不收——台简卷尾彩页
  // 由 book.backImages 从台繁源提供，避免混入日翻卷尾跨页图如 p288-291.webp）。
  // 没有 OPF（合成 style-ref）时回退到硬编码 SPECIAL_TEXT_IDS。
  const spineInfo = parseStyleSpine(styleRef);
  const tocTitleMap = collectStyleTocTitles(styleRef);
  let specialIdrefs = null;
  if (spineInfo) {
    const startIdx = spineInfo.spine.findIndex((idref) => /^(specials|special)\d*(\.xhtml)?$/.test(idref));
    if (startIdx >= 0) {
      specialIdrefs = spineInfo.spine.slice(startIdx).filter((idref) => SPECIAL_PAGE_RE.test(idref));
    }
  }
  if (!specialIdrefs) specialIdrefs = SPECIAL_TEXT_IDS.map((id) => `${id}.xhtml`);

  const pages = [];
  const assets = new Set();
  for (const idref of specialIdrefs) {
    const href = spineInfo?.idToHref.get(idref);
    const epubPath = href
      ? path.posix.join(spineInfo.opfDir, href)
      : `OEBPS/Text/${idref.replace(/\.xhtml$/, '')}.xhtml`;
    const rawContent = styleRef.entries[epubPath]?.toString('utf8');
    if (!rawContent) continue;
    const content = normalizeSpecialRefs(selfCloseVoidTags(rawContent));
    const id = path.posix.basename(epubPath).replace(/\.xhtml$/, '');

    for (const imageRef of extractImageRefsFromXhtml(content)) {
      const resolved = resolveEpubRelativePath(epubPath, imageRef);
      if (resolved && styleRef.entries[resolved]) assets.add(resolved);
    }

    const title = getStyleTocTitle(tocTitleMap, epubPath, extractXhtmlTitle(content, id));
    pages.push({
      id,
      href: `Text/${id}.xhtml`,
      content,
      title,
      includeInToc: id === 'special' || id === 'specials0001' || /^special\d+/.test(id),
      spineProperties: id.startsWith('illus') ? 'duokan-page-fitwindow' : null,
    });
  }

  return {
    pages,
    tocEntries: pages
      .filter((page) => page.includeInToc)
      .map((page) => ({ title: page.title, href: page.href })),
    assetNames: [...assets],
  };
}

function extractTrailingImages(chapters) {
  const lastChapter = chapters.at(-1);
  if (!lastChapter) return [];

  const images = [];
  while (lastChapter.blocks.at(-1)?.type === 'image') {
    images.unshift(lastChapter.blocks.pop());
  }
  return images;
}

function uniqueManifestItems(items) {
  const out = [];
  const seenHref = new Set();
  const seenId = new Set();
  for (const item of items) {
    if (seenHref.has(item.href)) continue;
    const next = { ...item };
    if (seenId.has(next.id)) {
      let suffix = 2;
      const base = next.id;
      while (seenId.has(`${base}_${suffix}`)) suffix += 1;
      next.id = `${base}_${suffix}`;
    }
    seenHref.add(next.href);
    seenId.add(next.id);
    out.push(next);
  }
  return out;
}

function buildContentOpf({ title, volume, uuid, modifiedIso, manifestItems, spineItems, hasSummary = false, hasPre = false }) {
  const manifest = manifestItems
    .map((item) => `    <item id="${escapeXml(item.id)}" href="${escapeXml(item.href)}" media-type="${escapeXml(item.mediaType)}"${item.properties ? ` properties="${escapeXml(item.properties)}"` : ''}/>`)
    .join('\n');
  const spine = spineItems
    .map((item) => `    <itemref idref="${escapeXml(item.idref)}"${item.linear === 'no' ? ' linear="no"' : ' linear="yes"'}${item.properties ? ` properties="${escapeXml(item.properties)}"` : ''}/>`)
    .join('\n');
  const summaryGuide = hasSummary
    ? '    <reference type="introduction" title="简介" href="Text/summary.xhtml"/>\n'
    : '';
  const preGuide = hasPre
    ? '    <reference type="text" title="题记" href="Text/pre.xhtml"/>\n'
    : '';

  return `${XML_HEADER}
<package version="3.0" unique-identifier="BookId" prefix="rendition: http://www.idpf.org/vocab/rendition/#" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="BookId">urn:uuid:${escapeXml(uuid)}</dc:identifier>
    <dc:title id="title">${escapeXml(title)}</dc:title>
    <meta property="belongs-to-collection" id="num">义妹生活</meta>
    <meta refines="#num" property="collection-type">series</meta>
    <meta refines="#num" property="group-position">${escapeXml(volume)}</meta>
    <dc:creator id="create">三河ごーすと</dc:creator>
    <dc:contributor>Hiten</dc:contributor>
    <dc:subject>lightnovel</dc:subject>
    <dc:language>zh</dc:language>
    <meta property="ibooks:specified-fonts">true</meta>
    <meta property="ibooks:binding">true</meta>
    <meta name="cover" content="cover"/>
    <meta property="dcterms:modified">${escapeXml(modifiedIso)}</meta>
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine page-progression-direction="ltr" toc="toc.ncx">
${spine}
  </spine>
  <guide>
    <reference type="cover" title="封面" href="Text/cover.xhtml"/>
${summaryGuide}${preGuide}
    <reference type="toc" title="目录" href="Text/TOC.xhtml"/>
  </guide>
</package>`;
}

export function simplifyText(input) {
  return toSimplified(String(input)).replace(/∼/g, '～');
}

export function extractArticleHtml(html) {
  const raw = String(html);
  const escaped = raw.match(/&lt;article\b[\s\S]*?&lt;\/article&gt;/);
  if (escaped) return decodeHtmlEntities(escaped[0]);

  const literal = raw.match(/<article\b[\s\S]*?<\/article>/);
  if (literal) return literal[0];

  throw new Error('No <article> block found in HTML');
}

export function parseLightNovelArticle(articleHtml) {
  const { document } = parseHTML(articleHtml);
  const article = document.querySelector('article') || document.body || document;
  const blocks = [];
  let buffer = '';
  let boldChars = 0;
  let totalChars = 0;

  const flush = () => {
    const text = normalizeText(buffer);
    if (text) {
      blocks.push({
        type: 'text',
        text,
        bold: boldChars > 0 && boldChars >= Math.max(1, totalChars - boldChars),
      });
    }
    buffer = '';
    boldChars = 0;
    totalChars = 0;
  };

  const appendText = (text, inBold) => {
    const value = String(text || '');
    if (!value) return;
    buffer += value;
    const count = value.replace(/\s/g, '').length;
    totalChars += count;
    if (inBold) boldChars += count;
  };

  const walk = (node, inBold = false) => {
    if (node.nodeType === 3) {
      appendText(node.nodeValue, inBold);
      return;
    }
    if (node.nodeType !== 1) return;

    const tag = String(node.localName || node.tagName || '').toLowerCase();
    if (tag === 'img') {
      flush();
      blocks.push({
        type: 'image',
        src: normalizeImageSrc(node.getAttribute('src') || ''),
        width: Number(node.getAttribute('img-width') || node.getAttribute('width') || 0),
        height: Number(node.getAttribute('img-height') || node.getAttribute('height') || 0),
      });
      return;
    }
    if (tag === 'br') {
      flush();
      return;
    }

    const childBold = inBold || tag === 'b' || tag === 'strong';
    if (tag === 'div' || tag === 'p' || /^h[1-6]$/.test(tag)) flush();
    for (const child of node.childNodes) walk(child, childBold);
    if (tag === 'div' || tag === 'p' || /^h[1-6]$/.test(tag)) flush();
  };

  walk(article);

  const firstText = blocks.find((block) => block.type === 'text' && normalizeText(block.text));
  return {
    title: firstText?.text || '',
    blocks,
  };
}

export function splitLightNovelBook(parsed, { volume = '11' } = {}) {
  const simplifiedBlocks = parsed.blocks.map((block) => {
    if (block.type !== 'text') return { ...block };
    return { ...block, text: simplifyText(block.text) };
  });

  const originalTitle = parsed.title || simplifiedBlocks.find((block) => block.type === 'text')?.text || '';
  const title = normalizeBookTitle(originalTitle, volume);
  const contentsIndex = simplifiedBlocks.findIndex((block) => block.type === 'text' && isContentsTitle(block.text));
  if (contentsIndex < 0) throw new Error('No CONTENTS block found');

  const coverImage = simplifiedBlocks.find((block) => block.type === 'image');
  if (!coverImage) throw new Error('No cover image found');

  const frontImages = simplifiedBlocks
    .slice(0, contentsIndex)
    .filter((block) => block.type === 'image' && block !== coverImage);

  const creditBlocks = simplifiedBlocks
    .slice(0, contentsIndex)
    .filter((block) => block.type === 'text')
    .filter((block, index) => index !== 0);

  const tocTitles = [];
  let cursor = contentsIndex + 1;
  while (cursor < simplifiedBlocks.length) {
    const block = simplifiedBlocks[cursor];
    if (block.type !== 'text') {
      cursor += 1;
      continue;
    }
    const text = normalizeTitle(block.text);
    if (!text) {
      cursor += 1;
      continue;
    }
    if (!block.bold) break;
    tocTitles.push(text);
    cursor += 1;
  }

  const titleMap = new Map(tocTitles.map((tocTitle) => [titleKey(tocTitle), tocTitle]));
  const summaryBlocks = [];
  const chapters = [];
  let current = null;
  let seenFirstChapter = false;

  const startChapter = (chapterTitle) => {
    if (current) chapters.push(current);
    current = { title: chapterTitle, blocks: [] };
    seenFirstChapter = true;
  };

  for (let i = cursor; i < simplifiedBlocks.length; i += 1) {
    const block = simplifiedBlocks[i];
    if (block.type === 'text') {
      const text = normalizeTitle(block.text);
      const key = titleKey(text);
      if (titleMap.has(key)) {
        startChapter(titleMap.get(key));
        continue;
      }
      if (isAfterwordTitle(text)) {
        if (!titleMap.has('后记')) {
          titleMap.set('后记', '后记');
          tocTitles.push('后记');
        }
        startChapter('后记');
        continue;
      }
    }

    if (!seenFirstChapter) {
      if (!hasText(block) || !isNoiseText(block.text)) summaryBlocks.push(block);
    } else if (current) {
      current.blocks.push(block);
    }
  }
  if (current) chapters.push(current);
  const backImages = extractTrailingImages(chapters);

  return {
    title,
    volume,
    author: '三河ごーすと',
    illustrator: 'Hiten',
    coverImage: { ...coverImage },
    frontImages: frontImages.map((image) => ({ ...image })),
    backImages: backImages.map((image) => ({ ...image })),
    creditBlocks,
    preBlocks: summaryBlocks,
    summaryBlocks,
    tocTitles,
    chapters,
  };
}

export function parseLightNovelHtml(html, opts = {}) {
  return splitLightNovelBook(parseLightNovelArticle(extractArticleHtml(html)), opts);
}

export async function downloadImages(book, fetchImpl = globalThis.fetch) {
  if (!fetchImpl) throw new Error('No fetch implementation available');
  const images = getBookImages(book);

  let kuchieIndex = 0;
  for (const image of images) {
    const response = await fetchImpl(image.src);
    if (!response.ok) {
      throw new Error(`Image download failed ${response.status}: ${image.src}`);
    }
    const contentType = response.headers.get('content-type') || '';
    const ext = extensionForUrl(image.src, contentType);
    if (image === book.coverImage) {
      image.fileName = `cover${ext === '.jpeg' ? '.jpg' : ext}`;
      image.id = 'cover';
    } else {
      kuchieIndex += 1;
      image.fileName = `kuchie-${String(kuchieIndex).padStart(3, '0')}${ext === '.jpeg' ? '.jpg' : ext}`;
      image.id = `kuchie-${String(kuchieIndex).padStart(3, '0')}`;
    }
    image.mediaType = mediaTypeFor(image.fileName, contentType);
    image.buffer = Buffer.from(await response.arrayBuffer());
  }

  return images;
}

/**
 * 接收已构建好的 book object，执行图片加载 + 资源复制 + 渲染 + OPF + 写文件。
 * 适用于任意来源的 book object（HTML 文章 / hyread EPUB / 其他解析器）。
 */
export async function buildLightNovelEpubFromBook(book, {
  sourceImages: providedSourceImages = null,
  sourceImageEpubPath = null,
  imageRefEpubPath = null,
  imageRefProfile = null,
  refEpubPath,
  styleRefEpubPath = null,
  outEpubPath,
  volume = book.volume || '11',
  includeSpecials = true,
  creditOverrides = DEFAULT_CREDIT_OVERRIDES,
  rubyAnnotations = DEFAULT_RUBY_ANNOTATIONS_BY_VOLUME[Number(volume)] || [],
  modifiedIso = new Date().toISOString(),
}) {
  const imageSourcePath = sourceImageEpubPath || imageRefEpubPath;
  const images = providedSourceImages
    ? applySourceImagesToBook(book, providedSourceImages)
    : imageSourcePath
      ? applySourceImagesToBook(
        book,
        imageRefProfile
          ? await loadSourceImagesFromProfile(imageSourcePath, imageRefProfile)
          : await loadSourceImages(imageSourcePath),
      )
      : await downloadImages(book);

  const ref = await readEpub(refEpubPath);
  const styleRef = styleRefEpubPath ? await readEpub(styleRefEpubPath) : null;
  const files = {};

  for (const name of ref.names) {
    // 字体从 styleRef 取（日翻版），不从 ref 复制 — 避免 ref 独有的字体残留
    if (isCopiedAsset(name) && !name.startsWith('OEBPS/Fonts/')) {
      files[name] = ref.entries[name];
    }
  }
  if (styleRef) {
    for (const name of styleRef.names) {
      if (isCopiedAsset(name) || isStyleImage(name)) files[name] = styleRef.entries[name];
    }
  }
  files['mimetype'] = Buffer.from('application/epub+zip');
  // 强制 container.xml 指向构建实际写入的 OPF 位置（OEBPS/content.opf）。
  // 否则会继承 styleRef 的 rootfile 路径——如 08 日翻源是 calibre 式根目录 content.opf，
  // 继承后与 OEBPS/content.opf 不匹配，触发 epubcheck OPF-002 fatal（11-15 styleRef 恰好正确才没暴露）。
  files['META-INF/container.xml'] = Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n'
    + '  <rootfiles>\n'
    + '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n'
    + '  </rootfiles>\n'
    + '</container>\n',
  );

  const styleTitleXhtml = buildStyleTitleXhtml(styleRef, volume, files);
  const styleSummaryXhtml = selfCloseVoidTags(styleRef?.entries['OEBPS/Text/summary.xhtml']?.toString('utf8') || null);
  const specials = includeSpecials
    ? collectSpecialEntries(styleRef)
    : { pages: [], tocEntries: [], assetNames: [] };
  for (const assetName of specials.assetNames) {
    files[assetName] = styleRef.entries[assetName];
  }
  // 11-13 制作信息不再展示 STERA ePub++ logo：删除从 styleRef 继承的 logo 图片，避免孤儿资源
  const logoEntryName = Object.keys(files).find((name) => /^OEBPS\/Images\/logo\./i.test(name));
  if (logoEntryName) delete files[logoEntryName];

  const textEntries = [];
  const navEntries = [];
  const spineItems = [];

  const addText = (id, href, content, properties = 'scripted', spineProperties = null) => {
    const fullPath = `OEBPS/${href}`;
    files[fullPath] = content;
    textEntries.push({
      id,
      href,
      mediaType: TEXT_MEDIA_TYPE,
      properties,
    });
    if (spineProperties !== false) {
      spineItems.push({
        idref: id,
        linear: 'yes',
        properties: spineProperties,
      });
    }
  };

  addText('cover.xhtml', 'Text/cover.xhtml', renderCoverXhtml(book.coverImage), 'scripted', 'duokan-page-fullscreen');
  addText('title.xhtml', 'Text/title.xhtml', styleTitleXhtml || renderTitleXhtml(book), null);
  addText('message.xhtml', 'Text/message.xhtml', renderMessageXhtml(book, { creditOverrides }));
  if (styleSummaryXhtml) {
    addText('summary.xhtml', 'Text/summary.xhtml', styleSummaryXhtml);
  }

  book.frontImages.forEach((image, index) => {
    addText(
      `illus${String(index + 1).padStart(4, '0')}.xhtml`,
      `Text/illus${String(index + 1).padStart(4, '0')}.xhtml`,
      renderImagePage(image),
      'scripted',
      'duokan-page-fitwindow',
    );
  });

  const chapterRendering = planChapterRendering(book);
  const chapterEntries = chapterRendering.plans.flatMap((plan) => {
    if (plan.chapter.includeInToc === false || !plan.navHref) return [];
    return [{ title: plan.chapter.title, href: plan.navHref }];
  });
  const specialGroup = specials.tocEntries.length > 0
    ? {
        title: /^插[图圖]$/.test(specials.tocEntries[0].title || '') && specials.tocEntries.length > 1
          ? '特典合集'
          : specials.tocEntries[0].title,
        href: specials.tocEntries[0].href,
        children: specials.tocEntries.slice(1),
      }
    : null;

  const hasPre = book.preBlocks.length > 0;
  const preEntry = hasPre ? [{ title: '题记', href: 'Text/pre.xhtml' }] : [];
  const tocEntries = [
    { title: '封面', href: 'Text/cover.xhtml' },
    { title: '标题', href: 'Text/title.xhtml' },
    { title: '制作信息', href: 'Text/message.xhtml' },
    ...(styleSummaryXhtml ? [{ title: '简介', href: 'Text/summary.xhtml' }] : []),
    { title: '目录', href: 'Text/TOC.xhtml' },
    ...preEntry,
    ...chapterEntries,
    ...(specialGroup ? [specialGroup] : []),
  ];
  navEntries.push(...tocEntries);

  addText('TOC.xhtml', 'Text/TOC.xhtml', renderTocXhtml([
    ...chapterEntries,
    ...(specialGroup ? [specialGroup] : []),
  ], { styleRef, volume }));

  if (hasPre) {
    addText('pre.xhtml', 'Text/pre.xhtml', renderPreXhtml(book));
  }

  for (const plan of chapterRendering.plans) {
    for (const page of plan.leadingImagePages) {
      addText(page.id, page.href, renderImagePage(page.image), 'scripted', 'duokan-page-fitwindow');
    }
    // 仅当剩余有正文块或标题时输出章节页（纯彩插章不产生空 chapter）
    if (plan.hasChapterPage) {
      addText(
        plan.id,
        plan.href,
        renderChapterXhtml(
          { title: plan.chapter.title, blocks: plan.bodyBlocks },
          {
            rubyAnnotations,
            fixedFootnotes: anotherDaysFixedFootnotesForChapter(volume, plan.id.replace(/\.xhtml$/, '')),
          },
        ),
      );
    }
  }

  for (const page of specials.pages) {
    addText(`${page.id}.xhtml`, page.href, page.content, 'scripted', page.spineProperties);
  }

  const usedIllustrationNumbers = [
    chapterRendering.nextIllusIndex - 1,
    ...specials.pages
      .map((page) => page.id.match(/^illus(\d+)$/)?.[1])
      .filter(Boolean)
      .map(Number),
  ];
  let nextBackImageIndex = Math.max(0, ...usedIllustrationNumbers) + 1;
  for (const image of book.backImages || []) {
    const id = `illus${String(nextBackImageIndex).padStart(4, '0')}.xhtml`;
    addText(id, `Text/${id}`, renderImagePage(image), 'scripted', 'duokan-page-fitwindow');
    nextBackImageIndex += 1;
  }

  const bodyHref = path.posix.basename((hasPre ? 'Text/pre.xhtml' : chapterEntries[0]?.href) || 'Text/TOC.xhtml');
  addText('toc', 'Text/navigation-documents.xhtml', renderNavXhtml(navEntries, {
    hasSummary: Boolean(styleSummaryXhtml),
    bodyHref,
  }), 'nav', false);

  files['OEBPS/toc.ncx'] = renderTocNcx({
    title: book.title,
    uuid: randomUUID(),
    entries: navEntries,
  });

  const imageItems = [];
  for (const image of images) {
    files[`OEBPS/Images/${image.fileName}`] = image.buffer;
    imageItems.push({
      id: image.id === 'cover' ? 'cover' : imageManifestId(image.fileName),
      href: `Images/${image.fileName}`,
      mediaType: image.mediaType,
      properties: image.id === 'cover' ? 'cover-image' : null,
    });
  }

  // 字体开源化：删旧子集字体、写思源子集、重写 CSS（manifest 随后扫描自动反映）
  await applyToFiles(files);
  // vol-08：把章节标题/目次样式对齐到 13 台简（见 VOLUME_STYLE_ALIGN）
  applyVolumeStyleAlign(files, volume);
  // vol-08：开头插图「未来預想圖」改用 08 日翻版本（见 VOLUME_IMAGE_OVERRIDE）
  applyVolumeImageOverride(files, volume);

  // 脚注图标处理：
  // 1. 被引用的 note.png 统一替换为 migrate 同款青绿图标（覆盖日翻红/绿版，全系列一致）；
  // 2. 未被任何正文引用的 note*（hyread 路径如 13 卷无脚注时的孤儿）删除。
  const referencedImages = new Set();
  for (const [name, buf] of Object.entries(files)) {
    if (!/OEBPS\/Text\/.*\.xhtml$/.test(name)) continue;
    for (const m of buf.toString('utf8').matchAll(/Images\/([^"')\s]+)/g)) referencedImages.add(m[1]);
  }
  if (referencedImages.has('note.png')) files['OEBPS/Images/note.png'] = FOOTNOTE_ICON_GREEN;
  for (const name of Object.keys(files)) {
    const m = name.match(/^OEBPS\/Images\/(note\d*\.[a-z0-9]+)$/i);
    if (m && !referencedImages.has(m[1])) delete files[name];
  }

  const copiedItems = Object.keys(files)
    .filter((name) => name.startsWith('OEBPS/Fonts/') || name.startsWith('OEBPS/Styles/') || name.startsWith('OEBPS/Misc/'))
    .sort()
    .map((name) => ({
      id: path.posix.basename(name),
      href: name.replace(/^OEBPS\//, ''),
      mediaType: mediaTypeFor(name),
      properties: null,
    }));
  const styleImageItems = Object.keys(files)
    .filter((name) => isStyleImage(name))
    .sort()
    .map((name) => ({
      id: path.posix.basename(name),
      href: name.replace(/^OEBPS\//, ''),
      mediaType: mediaTypeFor(name),
      properties: null,
    }));
  const specialAssetItems = specials.assetNames
    .sort()
    .map((name) => ({
      id: manifestIdFromPath(name),
      href: name.replace(/^OEBPS\//, ''),
      mediaType: mediaTypeFor(name),
      properties: null,
    }));

  const manifestItems = uniqueManifestItems([
    ...textEntries,
    { id: 'toc.ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml', properties: null },
    ...copiedItems,
    ...styleImageItems,
    ...specialAssetItems,
    ...imageItems,
  ]);

  files['OEBPS/content.opf'] = buildContentOpf({
    title: book.title,
    volume,
    uuid: randomUUID(),
    modifiedIso,
    manifestItems,
    spineItems,
    hasSummary: Boolean(styleSummaryXhtml),
    hasPre,
  });

  await writeEpub(outEpubPath, files);
  return { book, images, outEpubPath };
}

export async function buildLightNovelEpub({
  htmlPath,
  refEpubPath,
  styleRefEpubPath = null,
  sourceImageEpubPath = null,
  imageRefEpubPath = null,
  imageRefProfile = null,
  outEpubPath,
  volume = '11',
  includeSpecials = true,
  creditOverrides = DEFAULT_CREDIT_OVERRIDES,
  rubyAnnotations = DEFAULT_RUBY_ANNOTATIONS_BY_VOLUME[Number(volume)] || [],
  modifiedIso = new Date().toISOString(),
}) {
  const fs = await import('node:fs/promises');
  const html = await fs.readFile(htmlPath, 'utf8');
  const book = parseLightNovelHtml(html, { volume });
  return buildLightNovelEpubFromBook(book, {
    sourceImageEpubPath,
    imageRefEpubPath,
    imageRefProfile,
    refEpubPath,
    styleRefEpubPath,
    outEpubPath,
    volume,
    includeSpecials,
    creditOverrides,
    rubyAnnotations,
    modifiedIso,
  });
}
