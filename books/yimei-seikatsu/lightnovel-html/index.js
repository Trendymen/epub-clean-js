import { randomUUID } from 'node:crypto';
import path from 'node:path';
import * as OpenCC from 'opencc-js';
import { parseHTML } from 'linkedom';

import { readEpub, writeEpub } from '../../../src/core/zip-io.js';
import { buildSteraFootnote, selfCloseVoidTags } from '../../../src/core/stages/footnote-fix.js';

const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });

// 正文里台版译者直接塞进圆括号的内联注释，形如 （注：……）/（註：……）。
// 渲染时把它们升级成 09 ln V8 多端兼容的可点击脚注（与特典同款 duokan-footnote）。
// 注释正文允许一层嵌套圆括号，如 （註：……赫塞（Hermann Karl Hesse）……）。
const INLINE_NOTE_RE = /（[注註][：:]\s*((?:[^（）]|（[^（）]*）)+?)）/g;

const TEXT_MEDIA_TYPE = 'application/xhtml+xml';
const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>';
const SPECIAL_TEXT_IDS = [
  'specials0001',
  'special0001',
  'special0002',
  'special0003',
  'special0004',
  'special0005',
  'illus0007',
];
const DEFAULT_CREDIT_OVERRIDES = { 图源: '嘻嘻嘻', 录入: '嘻嘻嘻' };
const DEFAULT_RUBY_ANNOTATIONS_BY_VOLUME = {
  11: [
    { text: '社会数据科学Social Data Science', base: '社会数据科学', ruby: 'Social Data Science' },
    { text: '社会资料科学Social Data Science', base: '社会数据科学', ruby: 'Social Data Science' },
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

// 把单个段落文本里的内联注释替换成 duokan-footnote 引用锚点，
// 注释正文累积到 state.asides，编号由 state.counter 递增（每章重置）。
function renderParagraphWithNotes(text, state) {
  if (!state) return escapeXml(text);
  const renderText = (segment) => renderRubyAnnotations(segment, state.rubyAnnotations || []);
  let html = '';
  let lastIndex = 0;
  let match;
  INLINE_NOTE_RE.lastIndex = 0;
  while ((match = INLINE_NOTE_RE.exec(text)) !== null) {
    html += renderText(text.slice(lastIndex, match.index));
    const body = normalizeText(match[1]);
    const [refHtml, asideHtml] = buildSteraFootnote({ body }, state.counter, { iconRegular: 'note.png' });
    html += refHtml;
    state.asides.push(asideHtml);
    state.counter += 1;
    lastIndex = match.index + match[0].length;
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
  for (const block of blocks) {
    if (block.type === 'image') {
      lines.push(renderImageDiv(block));
      continue;
    }
    const text = normalizeText(block.text);
    if (!text || isSeparator(text)) continue;
    lines.push(` <p>${renderParagraphWithNotes(text, state)}</p>`);
  }
  return lines.join('\n');
}

function renderChapterXhtml(chapter, { rubyAnnotations = [] } = {}) {
  const [mainTitle, subtitle] = splitHeading(chapter.title);
  // 合并为单行 h3（匹配 healed 日翻版风格），有副标题时用全角空格连接
  const merged = subtitle ? `${mainTitle}　${subtitle}` : mainTitle;
  const heading = ` <h3>${escapeXml(merged)}</h3>`;

  const state = { counter: 1, asides: [], rubyAnnotations };
  const body = renderBlocks(chapter.blocks, state);
  const footnotes = state.asides.length > 0 ? `\n${state.asides.join('')}` : '';
  return xhtml(chapter.title, `${heading}\n${body}${footnotes}`);
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
    <p><a href="https://www.lightnovel.fun">轻之国度</a></p>
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

function renderTocXhtml(tocEntries) {
  const style = 'body{-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;}'
    + '.ctt{font-family:ctt2,emoji,sym;text-align:center;font-size:1.8em;margin:1em 0;font-weight:bold;}'
    + '.toc{margin:1em 0 0.5em;text-align:center;border-left:0;}'
    + '.toc a{display:block;font-family:ctt1,emoji,sym;padding:0.25em;}';
  const rows = tocEntries
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

function renderNavXhtml(entries, { hasSummary = false } = {}) {
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
      <li><a epub:type="bodymatter" href="pre.xhtml">题记</a></li>
    </ol>
  </nav>
</body>
</html>`;
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
const SPECIAL_PAGE_RE = /^(specials\d*|special\d*|illus\d+)(\.xhtml)?$/;

function collectSpecialEntries(styleRef) {
  if (!styleRef) return { pages: [], tocEntries: [], assetNames: [] };

  // 优先按 spine 顺序动态发现：从 specials0001 起到卷末，只取 special*/specials*/illus* 页
  // （天然排除 nav/toc、polo、characters 等非特典页，也不会误收正文前的口绘 illus0001-N）。
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
    const content = selfCloseVoidTags(rawContent);
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

function buildContentOpf({ title, volume, uuid, modifiedIso, manifestItems, spineItems, hasSummary = false }) {
  const manifest = manifestItems
    .map((item) => `    <item id="${escapeXml(item.id)}" href="${escapeXml(item.href)}" media-type="${escapeXml(item.mediaType)}"${item.properties ? ` properties="${escapeXml(item.properties)}"` : ''}/>`)
    .join('\n');
  const spine = spineItems
    .map((item) => `    <itemref idref="${escapeXml(item.idref)}"${item.linear === 'no' ? ' linear="no"' : ' linear="yes"'}${item.properties ? ` properties="${escapeXml(item.properties)}"` : ''}/>`)
    .join('\n');
  const summaryGuide = hasSummary
    ? '    <reference type="introduction" title="简介" href="Text/summary.xhtml"/>\n'
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
${summaryGuide}    <reference type="text" title="题记" href="Text/pre.xhtml"/>
    <reference type="toc" title="目录" href="Text/TOC.xhtml"/>
  </guide>
</package>`;
}

export function simplifyText(input) {
  return toSimplified(String(input));
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

  const styleTitleXhtml = selfCloseVoidTags(styleRef?.entries['OEBPS/Text/title.xhtml']?.toString('utf8') || null);
  const styleSummaryXhtml = selfCloseVoidTags(styleRef?.entries['OEBPS/Text/summary.xhtml']?.toString('utf8') || null);
  const specials = includeSpecials
    ? collectSpecialEntries(styleRef)
    : { pages: [], tocEntries: [], assetNames: [] };
  for (const assetName of specials.assetNames) {
    files[assetName] = styleRef.entries[assetName];
  }
  const logoEntryName = Object.keys(files).find((name) => /^OEBPS\/Images\/logo\./i.test(name));
  const logoFileName = logoEntryName ? path.posix.basename(logoEntryName) : null;

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
  addText('message.xhtml', 'Text/message.xhtml', renderMessageXhtml(book, { logoFileName, creditOverrides }));
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

  const chapterEntries = book.chapters.map((chapter, index) => {
    const id = `chapter${String(index + 1).padStart(4, '0')}.xhtml`;
    const href = `Text/${id}`;
    return { title: chapter.title, href };
  });
  const specialGroup = specials.tocEntries.length > 0
    ? {
        title: specials.tocEntries[0].title,
        href: specials.tocEntries[0].href,
        children: specials.tocEntries.slice(1),
      }
    : null;

  const tocEntries = [
    { title: '封面', href: 'Text/cover.xhtml' },
    { title: '标题', href: 'Text/title.xhtml' },
    { title: '制作信息', href: 'Text/message.xhtml' },
    ...(styleSummaryXhtml ? [{ title: '简介', href: 'Text/summary.xhtml' }] : []),
    { title: '目录', href: 'Text/TOC.xhtml' },
    { title: '题记', href: 'Text/pre.xhtml' },
    ...chapterEntries,
    ...(specialGroup ? [specialGroup] : []),
  ];
  navEntries.push(...tocEntries);

  addText('TOC.xhtml', 'Text/TOC.xhtml', renderTocXhtml([
    ...chapterEntries,
    ...specials.tocEntries,
  ]));

  if (book.preBlocks.length > 0) {
    addText('pre.xhtml', 'Text/pre.xhtml', renderPreXhtml(book));
  }

  book.chapters.forEach((chapter, index) => {
    const id = `chapter${String(index + 1).padStart(4, '0')}.xhtml`;
    const href = `Text/${id}`;
    addText(id, href, renderChapterXhtml(chapter, { rubyAnnotations }));
  });

  for (const page of specials.pages) {
    addText(`${page.id}.xhtml`, page.href, page.content, 'scripted', page.spineProperties);
  }

  const usedIllustrationNumbers = [
    book.frontImages.length,
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

  addText('toc', 'Text/navigation-documents.xhtml', renderNavXhtml(navEntries, { hasSummary: Boolean(styleSummaryXhtml) }), 'nav', false);

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
