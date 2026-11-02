import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

import { readEpub, writeEpub } from '../../../src/core/zip-io.js';
import { applyToFiles } from '../../../src/core/font-subset.js';
import { buildSteraFootnote, normalizeFootnoteIds, selfCloseVoidTags } from '../../../src/core/stages/footnote-fix.js';
import { validateOutput } from '../../../src/core/validator.js';
import { MESSAGE_DISCLAIMER_LINES } from '../migrate/extras-cleaner.js';
import { anotherDaysFixedFootnotesForChapter } from '../another-days-footnotes.js';
import { applyWordingRules, BASE_CONVERSION_ID, conversionFingerprint, simplifyBase, simplifyBaseWithRuby, simplifyText, validateWording } from '../chinese-conversion.js';

export { simplifyText } from '../chinese-conversion.js';

// 正文里台版译者直接塞进圆括号的内联注释，形如 （注：……）/（註：……）。
// 渲染时把它们升级成 09 ln V8 多端兼容的可点击脚注（与特典同款 duokan-footnote）。
// 注释正文允许一层嵌套圆括号，如 （註：……赫塞（Hermann Karl Hesse）……）。
const INLINE_NOTE_RE = /（[注註][：:]\s*((?:[^（）]|（[^（）]*）)+?)）/g;

const TEXT_MEDIA_TYPE = 'application/xhtml+xml';
const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>';
// 脚注标记统一用 migrate 管线同款青绿「注」图标（books/yimei-seikatsu/assets/note.png），
// 覆盖各卷日翻 styleRef 自带的红/绿版本，保证 09-13 全系列一致。
const FOOTNOTE_ICON_GREEN = fs.readFileSync(fileURLToPath(new URL('../assets/note.png', import.meta.url)));

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
function rubyAnnotationSignature(annotations) {
  return JSON.stringify(annotations.map((rule) => [rule?.text, rule?.base, rule?.ruby]));
}

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

function normalizeBookTitle(title, volume = '11', wording = 'taiwan', { baseConverted = false } = {}) {
  const value = title || `义妹生活 ${volume}`;
  const simplified = baseConverted ? applyWordingRules(value, { wording }).text : simplifyText(value, { wording });
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

function buildRenderedFootnote(body, state, renderedBody = null) {
  const [refHtml, asideHtml] = buildSteraFootnote({ body }, state.counter, { iconRegular: 'note.png' });
  state.asides.push(renderedBody === null ? asideHtml
    : asideHtml.replace(/<p>[\s\S]*?<\/p>/, () => `<p>${renderedBody}</p>`));
  state.counter += 1;
  return refHtml;
}

function resolveFixedFootnoteOffset(text, note) {
  if (typeof note.charOffset === 'number') {
    return Math.max(0, Math.min(note.charOffset, text.length));
  }
  if (typeof note.anchor !== 'string' || note.anchor.length === 0) return text.length;

  const anchor = note.anchor.replace(/\s/g, '');
  if (!anchor) return text.length;
  let compact = '';
  const originalEnds = [];
  for (let i = 0; i < text.length; i += 1) {
    if (/\s/.test(text[i])) continue;
    compact += text[i];
    originalEnds.push(i + 1);
  }
  let from = 0;
  const occurrence = Math.max(1, note.occurrence || 1);
  for (let i = 0; i < occurrence; i += 1) {
    const pos = compact.indexOf(anchor, from);
    if (pos < 0) return text.length;
    if (i === occurrence - 1) return originalEnds[pos + anchor.length - 1];
    from = pos + anchor.length;
  }
  return text.length;
}

function collectNoteEvents(text, fixedFootnotes = []) {
  const events = [];
  let order = 0;
  let match;
  INLINE_NOTE_RE.lastIndex = 0;
  while ((match = INLINE_NOTE_RE.exec(text)) !== null) {
    const bodyEnd = match.index + match[0].length - 1;
    events.push({
      type: 'inline',
      start: match.index,
      end: match.index + match[0].length,
      body: normalizeText(match[1]),
      bodyStart: bodyEnd - match[1].length,
      bodyEnd,
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

function renderNativeRuby(text, start, end, spans, { plain = false, renderPlain } = {}) {
  const renderPart = renderPlain || ((from, to) => plain ? text.slice(from, to) : escapeXml(text.slice(from, to)));
  let html = '';
  let cursor = start;
  for (const span of spans) {
    if (span.start < start || span.end > end) continue;
    html += renderPart(cursor, span.start);
    const base = renderNativeRuby(text, span.start, span.end, span.children || [], { plain, renderPlain });
    const reading = renderNativeRuby(span.rt, 0, span.rt.length, span.rtSpans || [], { plain });
    html += plain ? `${base}（${reading}）` : `<ruby>${base}<rt>${reading}</rt></ruby>`;
    cursor = span.end;
  }
  return html + renderPart(cursor, end);
}

function renderNativeParagraphWithNotes(text, spans, state, fixedFootnotes, location) {
  const fail = () => {
    const position = [location?.volume, location?.source, location?.paragraphIndex].filter((value) => value != null).join(':');
    throw new Error(`Cannot preserve ruby across a footnote boundary${position ? ` (${position})` : ''}`);
  };
  const events = [];
  let cursor = 0;
  for (const event of collectNoteEvents(text, fixedFootnotes)) {
    if (event.start < cursor) continue;
    events.push(event);
    cursor = event.end;
  }
  if (events.length === 0) return renderNativeRuby(text, 0, text.length, spans);
  const inside = (items, start, end) => items.flatMap((span) => {
    if (span.start >= start && span.end <= end) return [span];
    if (span.start <= start && span.end >= end) return inside(span.children || [], start, end);
    if (span.start < end && span.end > start) fail();
    return [];
  });
  const references = [];
  const edits = events.map((event, index) => {
    const noteSpans = event.type === 'inline' ? inside(spans, event.bodyStart, event.bodyEnd) : [];
    const body = noteSpans.length
      ? normalizeText(renderNativeRuby(text, event.bodyStart, event.bodyEnd, noteSpans, { plain: true })) : event.body;
    const renderedBody = noteSpans.length ? renderNativeRuby(text, event.bodyStart, event.bodyEnd, noteSpans) : null;
    references.push(buildRenderedFootnote(body, state, renderedBody));
    return { ...event, marker: `\u0000${index}\u0000` };
  });
  let edited = '';
  cursor = 0;
  for (const edit of edits) {
    edited += text.slice(cursor, edit.start) + edit.marker;
    cursor = edit.end;
  }
  edited += text.slice(cursor);

  const mapSpan = (span) => {
    let before = 0;
    let within = 0;
    for (const edit of edits) {
      const delta = edit.marker.length - (edit.end - edit.start);
      if (edit.end <= span.start) before += delta;
      else if (edit.start >= span.end) continue;
      else if (edit.start >= span.start && edit.end <= span.end) {
        if (edit.type === 'inline') fail();
        within += delta;
      }
      else if (edit.start <= span.start && edit.end >= span.end) {
        if (edit.type === 'inline' && span.start >= edit.bodyStart && span.end <= edit.bodyEnd) return null;
        fail();
      }
      else fail();
    }
    const start = span.start + before;
    const end = span.end + before + within;
    return { ...span, start, end, base: edited.slice(start, end),
      ...(span.children ? { children: span.children.map(mapSpan).filter(Boolean) } : {}) };
  };
  const renderPlain = (start, end) => {
    const part = edited.slice(start, end);
    let result = '';
    let last = 0;
    for (const match of part.matchAll(/\u0000(\d+)\u0000/g)) {
      result += escapeXml(part.slice(last, match.index)) + references[Number(match[1])];
      last = match.index + match[0].length;
    }
    return result + escapeXml(part.slice(last));
  };
  return renderNativeRuby(edited, 0, edited.length, spans.map(mapSpan).filter(Boolean), { renderPlain });
}

// 把单个段落文本里的台版内联注释与固定迁移注释替换成 duokan-footnote 引用锚点，
// 注释正文累积到 state.asides，编号由 state.counter 递增（每章重置）。
function renderParagraphWithNotes(text, state, fixedFootnotes = [], rubySpans = null, plannedMatches = null, location = null) {
  if (state && rubySpans) return renderNativeParagraphWithNotes(text, rubySpans, state, fixedFootnotes, location);
  const renderText = (start, end, plain = false) => {
    if (!rubySpans) return plain ? text.slice(start, end)
      : plannedMatches !== null
        ? renderPlannedRuby(text, start, end, plannedMatches, state?.rubyAnnotations || [], state?.onRubyMatch)
        : renderRubyAnnotations(text.slice(start, end), state?.rubyAnnotations || [], state?.onRubyMatch);
    return renderNativeRuby(text, start, end, rubySpans, { plain });
  };
  if (!state) return renderText(0, text.length);
  let html = '';
  let lastIndex = 0;
  for (const event of collectNoteEvents(text, fixedFootnotes)) {
    if (event.start < lastIndex) continue;
    html += renderText(lastIndex, event.start);
    const hasNoteRuby = event.type === 'inline' && rubySpans?.some((span) =>
      span.start >= event.bodyStart && span.end <= event.bodyEnd);
    html += hasNoteRuby
      ? buildRenderedFootnote(normalizeText(renderText(event.bodyStart, event.bodyEnd, true)), state,
        renderText(event.bodyStart, event.bodyEnd))
      : buildRenderedFootnote(event.body, state);
    lastIndex = event.end;
  }
  html += renderText(lastIndex, text.length);
  return html;
}

function findRubyAnnotations(text, annotations = []) {
  const rules = annotations
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule?.text && rule?.base && rule?.ruby)
    .map(({ rule, index }) => ({ ...rule, index, text: String(rule.text), base: String(rule.base), ruby: String(rule.ruby) }));
  const matches = [];
  let cursor = 0;
  while (cursor < text.length) {
    let next = null;
    for (const rule of rules) {
      const index = text.indexOf(rule.text, cursor);
      if (index < 0) continue;
      if (!next || index < next.index) next = { index, rule };
    }
    if (!next) break;
    matches.push({ start: next.index, end: next.index + next.rule.text.length, rule: next.rule });
    cursor = next.index + next.rule.text.length;
  }
  return matches;
}

function renderRubyAnnotations(text, annotations = [], onMatch) {
  let html = '';
  let cursor = 0;
  for (const match of findRubyAnnotations(text, annotations)) {
    html += escapeXml(text.slice(cursor, match.start));
    html += `<ruby>${escapeXml(match.rule.base)}<rt>${escapeXml(match.rule.ruby)}</rt></ruby>`;
    onMatch?.(match.rule.index);
    cursor = match.end;
  }
  return html + escapeXml(text.slice(cursor));
}

function renderPlannedRuby(text, start, end, matches, annotations, onMatch) {
  let html = '';
  let cursor = start;
  for (const match of matches) {
    if (match.start < start || match.end > end) continue;
    html += renderRubyAnnotations(text.slice(cursor, match.start), annotations, onMatch);
    html += `<ruby>${escapeXml(match.rule.base)}<rt>${escapeXml(match.rule.ruby)}</rt></ruby>`;
    onMatch?.(match.rule.index);
    cursor = match.end;
  }
  return html + renderRubyAnnotations(text.slice(cursor, end), annotations, onMatch);
}

function noteBoundarySignature(text, fixedFootnotes) {
  return JSON.stringify(collectNoteEvents(text, fixedFootnotes).map(({ type, start, end }) => [type, start, end]));
}

function resolveRubyPlan(plan, text, annotations, fixedFootnotes, sameRules) {
  if (sameRules && plan.noteBoundaries === noteBoundarySignature(text, fixedFootnotes)) return plan.matches;
  const fail = () => { throw new Error(`Cannot preserve ruby after context change (${plan.source}:${plan.paragraphIndex}); reparse with the current volume and rules`); };
  const matches = annotationRangesForParagraph(plan.sourceText, annotations, fixedFootnotes);
  for (const candidate of [...plan.edits, ...plan.skipped]) {
    const wasSkipped = plan.skipped.some((item) => item.start === candidate.start && item.end === candidate.end);
    const nowSkipped = matches.some((match) => candidate.start < match.end && candidate.end > match.start);
    if (wasSkipped !== nowSkipped) fail();
  }
  const mapOffset = (offset) => {
    let delta = 0;
    for (const edit of plan.edits) {
      if (offset <= edit.start) break;
      if (offset < edit.end) fail();
      delta += edit.target.length - (edit.end - edit.start);
    }
    return offset + delta;
  };
  const sourceNotes = collectNoteEvents(plan.sourceText, fixedFootnotes)
    .map(({ type, start, end }) => [type, mapOffset(start), mapOffset(end)]);
  if (JSON.stringify(sourceNotes) !== noteBoundarySignature(text, fixedFootnotes)) fail();
  return matches.map((match) => ({ ...match, start: mapOffset(match.start), end: mapOffset(match.end) }));
}

function assertRubyPlanMatchesBlock(block) {
  const plan = block._rubyAnnotationPlan;
  if (plan && (block.type !== 'text' || plan.text !== (block.rubySpans ? block.text : normalizeText(block.text)))) {
    throw new Error(`Cannot preserve ruby after text change (${plan.source}:${plan.paragraphIndex}); reparse with the current text`);
  }
  return plan;
}

function renderBlocks(blocks, state = null) {
  const lines = [];
  let paraIdx = 0;
  for (const block of blocks) {
    const plan = assertRubyPlanMatchesBlock(block);
    if (block.type === 'image') {
      lines.push(renderImageDiv(block));
      continue;
    }
    const text = block.rubySpans ? block.text : normalizeText(block.text);
    if (!text || isSeparator(text)) continue;
    const fixedFootnotes = state?.fixedFootnotesByPara?.get(paraIdx) ?? [];
    const matches = plan && plan.text === text && state
      ? resolveRubyPlan(plan, text, state.rubyAnnotations, fixedFootnotes, state.sameAnnotationRules) : null;
    lines.push(` <p>${renderParagraphWithNotes(text, state, fixedFootnotes, block.rubySpans, matches, block._sourceLocation)}</p>`);
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

function renderChapterXhtml(chapter, { rubyAnnotations = [], fixedFootnotes = [], onRubyMatch, sameAnnotationRules = false } = {}) {
  const title = chapter.heading ? { title: chapter.heading.text, titleRubySpans: chapter.heading.rubySpans } : chapter;
  const [mainTitle, subtitle] = splitHeading(title.title);
  // 合并为单行 h3（匹配 healed 日翻版风格），有副标题时用全角空格连接
  const merged = subtitle ? `${mainTitle}　${subtitle}` : mainTitle;
  const insertAt = merged !== title.title && merged === `${mainTitle}　${title.title.slice(mainTitle.length)}`
    ? mainTitle.length : null;
  const shift = (spans) => spans.map((span) => {
    const start = span.start + (insertAt !== null && span.start >= insertAt ? 1 : 0);
    const end = span.end + (insertAt !== null && span.end > insertAt ? 1 : 0);
    return { ...span, start, end, base: merged.slice(start, end), ...(span.children ? { children: shift(span.children) } : {}) };
  });
  const heading = merged ? ` <h3>${title.titleRubySpans?.length
    ? renderTitleRuby({ title: merged, titleRubySpans: shift(title.titleRubySpans) }) : escapeXml(merged)}</h3>` : '';

  const state = {
    counter: 1,
    asides: [],
    rubyAnnotations,
    sameAnnotationRules,
    onRubyMatch,
    fixedFootnotesByPara: groupFixedFootnotesByPara(fixedFootnotes),
  };
  const body = renderBlocks(chapter.blocks, state);
  const footnotes = state.asides.length > 0 ? `\n${state.asides.join('')}` : '';
  return xhtml(chapter.title, [heading, body].filter(Boolean).join('\n') + footnotes);
}

function renderTitleRuby(entry) {
  return entry.titleRubySpans?.length
    ? renderParagraphWithNotes(entry.title, null, [], entry.titleRubySpans)
    : escapeXml(entry.title);
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
  const state = { counter: 1, asides: [], rubyAnnotations: [] };
  const text = book.preBlocks
    .filter((block) => block.type === 'text')
    .map((block) => renderParagraphWithNotes(
      block.rubySpans ? block.text : normalizeText(block.text), state, [], block.rubySpans, null, block._sourceLocation,
    ))
    .filter(Boolean)
    .join('');
  const blankLines = Array.from({ length: 5 }, () => ' <p><br/></p>').join('\n');
  return xhtml('', `${blankLines}\n <p><b>${text}</b></p>\n${state.asides.join('')}`);
}

function flattenTocEntries(entries) {
  return entries.flatMap((entry) => [
    { title: entry.title, titleRubySpans: entry.titleRubySpans, href: entry.href },
    ...flattenTocEntries(entry.children || []),
  ]);
}

function renderAnotherDaysTocTitle(title, rubySpans = []) {
  const normalized = normalizeTitle(title);
  const renderStyled = (start, end, styles = [], inserts = []) => {
    const renderPlain = (from, to) => {
      if (from === to) return '';
      const boundaries = [...new Set([from, to, ...styles.flatMap((style) => [style.start, style.end]),
        ...inserts.map((insert) => insert.offset)].filter((offset) => offset >= from && offset <= to))].sort((a, b) => a - b);
      return boundaries.slice(0, -1).map((offset, index) => {
        const inserted = inserts.filter((item) => item.offset === offset).map((item) => item.html).join('');
        const value = escapeXml(normalized.slice(offset, boundaries[index + 1]));
        const style = styles.find((item) => item.start <= offset && item.end >= boundaries[index + 1]);
        return inserted + (style ? `<span class="${style.className}">${value}</span>` : value);
      }).join('');
    };
    return renderNativeRuby(normalized, start, end, rubySpans, { renderPlain });
  };
  const anime = normalized.match(/^动画义妹生活第(.+?)集随笔（三河ごーすと感想）$/);
  if (anime) {
    if (rubySpans.length) {
      const split = normalized.indexOf('（三河ごーすと感想）');
      const styles = [{ start: 0, end: 2, className: 'dbox' }, { start: 3, end: 4, className: 'c1' }];
      const inserts = [{ offset: 2, html: '<span class="em05"> </span>' }];
      if (rubySpans.some((span) => span.start < split && span.end > split)) {
        return `<p>${renderStyled(0, normalized.length,
          [...styles, { start: split, end: normalized.length, className: 'ctit' }],
          [...inserts, { offset: split, html: '<span class="ctit-spacer"></span>' }])}</p>`;
      }
      return `<p>${renderStyled(0, split, styles, inserts)}</p>
  <p class="ctit"><span class="ctit-spacer"></span>${renderStyled(split, normalized.length)}</p>`;
    }
    return `<p><span class="dbox">动画</span><span class="em05"> </span>义<span class="c1">妹</span>生活第${escapeXml(anime[1])}集随笔</p>
  <p class="ctit"><span class="ctit-spacer"></span>（三河ごーすと感想）</p>`;
  }

  const sideStory = normalized.match(/^外传小说《(.+?)》(.+)$/);
  if (sideStory) {
    if (rubySpans.length) return `<p>${renderStyled(0, normalized.length,
      [{ start: 0, end: 4, className: 'ebox' }], [{ offset: 4, html: '<span class="em05"> </span>' }])}</p>`;
    return `<p><span class="ebox">外传小说</span><span class="em05"> </span>《${escapeXml(sideStory[1])}》${escapeXml(sideStory[2])}</p>`;
  }

  return `<p class="em095">${rubySpans.length ? renderStyled(0, normalized.length) : escapeXml(normalized)}</p>`;
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
  const tunedStyle = style.replace(/\.toc \.ctit\{([^}]*)\}/, (match, declarations) => {
    let tuned = setCssDeclaration(declarations, 'padding', '0.25em 0 0');
    tuned = setCssDeclaration(tuned, 'line-height', '1.15em', { after: 'padding' });
    return `.toc .ctit{${tuned}}`;
  });
  if (/\.ctit-spacer\{/.test(tunedStyle)) return tunedStyle;
  return `${tunedStyle}\n .ctit-spacer{display:inline-block;width:1.2em}`;
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
  ${renderAnotherDaysTocTitle(entry.title, entry.titleRubySpans)}
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
  <p>${renderTitleRuby(entry)}</p>
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
    const link = `${indent}<li><a href="${escapeXml(path.posix.basename(entry.href))}">${renderTitleRuby(entry)}</a>`;
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
    const content = normalizeFootnoteIds(normalizeSpecialRefs(selfCloseVoidTags(rawContent)));
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

function annotationRangesForParagraph(text, annotations, fixedFootnotes) {
  const ranges = [];
  let cursor = 0;
  const addMatches = (start, end) => {
    for (const match of findRubyAnnotations(text.slice(start, end), annotations)) {
      ranges.push({ start: start + match.start, end: start + match.end, rule: match.rule });
    }
  };
  for (const event of collectNoteEvents(text, fixedFootnotes)) {
    if (event.start < cursor) continue;
    addMatches(cursor, event.start);
    cursor = event.end;
  }
  addMatches(cursor, text.length);
  return ranges;
}

function blockConversionFingerprint(block) {
  return conversionFingerprint(block.text, block.rubySpans || [], block._rubyProtectedRanges || [], {
    unpairedReadings: block._unpairedReadings || [], sourceReadings: block._rubySourceReadings || [],
    sourceLocation: block._sourceLocation || null,
  });
}

function attachNativeRubySources(spans, sources) {
  return spans.map((span, index) => {
    const source = sources?.[index];
    const matches = source?.start === span.start && source?.end === span.end && source?.rt === span.rt;
    return {
      ...span,
      ...(matches && !Object.hasOwn(span, 'rubyIndex') ? { rubyIndex: source.rubyIndex } : {}),
      ...(matches && !Object.hasOwn(span, 'rtIndex') ? { rtIndex: source.rtIndex } : {}),
      ...(span.children ? { children: attachNativeRubySources(span.children, matches ? source.children : null) } : {}),
      ...(span.rtSpans ? { rtSpans: attachNativeRubySources(span.rtSpans, matches ? source.rtSpans : null) } : {}),
    };
  });
}

function mapNativeRubyTree(text, spans, convert, context, protectedRanges = []) {
  const ranges = [];
  const fail = () => {
    const position = [context?.volume, context?.source, context?.paragraphIndex].filter((value) => value != null).join(':');
    throw new Error(`Cannot map ruby positions${position ? ` (${position})` : ''}: invalid ruby tree`);
  };
  const collect = (items, lower, upper) => {
    if (!Array.isArray(items)) fail();
    let cursor = lower;
    for (const span of items) {
      if (!Number.isInteger(span.start) || !Number.isInteger(span.end)
        || span.start < cursor || span.start >= span.end || span.end > upper) fail();
      ranges.push({ start: span.start, end: span.end });
      collect(span.children || [], span.start, span.end);
      cursor = span.end;
    }
  };
  if (typeof text !== 'string') fail();
  collect(spans, 0, text.length);
  const spanCount = ranges.length;
  if (!Array.isArray(protectedRanges)) fail();
  for (const range of protectedRanges) {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end)
      || range.start < 0 || range.start >= range.end || range.end > text.length) fail();
    ranges.push({ ...range });
  }
  const result = convert(text, ranges);
  let index = 0;
  const rebuild = (items) => items.map((span) => {
    const { start, end } = result.ranges[index++];
    return {
      ...span, start, end, base: result.text.slice(start, end),
      ...(span.children ? { children: rebuild(span.children) } : {}),
    };
  });
  return { ...result, spans: rebuild(spans), protectedRanges: result.ranges.slice(spanCount) };
}

function simplifyNativeRubyTree(text, spans, context, protectedRanges = [], baseConverted = false) {
  const result = mapNativeRubyTree(text, spans, (value, ranges) => {
    if (baseConverted) return { text: value, ranges };
    const converted = simplifyBaseWithRuby(value, ranges, context);
    return { text: converted.text, ranges: converted.spans };
  }, context, protectedRanges);
  const simplifyReading = (span) => {
    if (typeof span.rt !== 'string') {
      throw new Error(`Cannot map ruby reading (${context.volume}:${context.source}:${context.paragraphIndex})`);
    }
    const reading = simplifyNativeRubyTree(span.rt, span.rtSpans || [], context, [], baseConverted);
    return {
      ...span, rt: reading.text,
      ...(span.children ? { children: span.children.map(simplifyReading) } : {}),
      ...(span.rtSpans ? { rtSpans: reading.spans } : {}),
    };
  };
  return { text: result.text, spans: result.spans.map(simplifyReading), protectedRanges: result.protectedRanges };
}

function reportNativeReadings(spans, { wording, onDiagnostic, ...context }) {
  if (!onDiagnostic) return;
  const visit = (items) => {
    for (const span of items) {
      visit(span.children || []);
      const ranges = span.rt ? [{ start: 0, end: span.rt.length }] : [];
      const { skipped } = applyWordingRules(span.rt, { wording, ranges });
      for (const match of skipped) onDiagnostic({
        ...context, ruleId: match.ruleId, kind: 'rt',
        rubyIndex: Number.isInteger(span.rubyIndex) && span.rubyIndex > 0 ? span.rubyIndex : null,
        rtIndex: Number.isInteger(span.rtIndex) && span.rtIndex > 0 ? span.rtIndex : null,
        start: match.start, end: match.end,
      });
      visit(span.rtSpans || []);
    }
  };
  visit(spans);
}

function reportUnpairedReadings(readings, { wording, onDiagnostic, ...context }) {
  if (!onDiagnostic) return;
  for (const reading of readings) {
    if (reading.rubySpans) {
      reportNativeReadings(attachNativeRubySources(reading.rubySpans, reading.sourceReadings), {
        ...context, wording, onDiagnostic,
      });
    }
    const ranges = reading.text ? [{ start: 0, end: reading.text.length }] : [];
    const { skipped } = applyWordingRules(reading.text, { wording, ranges });
    for (const match of skipped) onDiagnostic({
      ...context, ruleId: match.ruleId, kind: 'rt', rubyIndex: reading.rubyIndex, rtIndex: reading.rtIndex,
      start: match.start, end: match.end,
    });
  }
}

export function splitLightNovelBook(parsed, options = {}) {
  const {
    volume = '11', wording = 'taiwan', rubyAnnotations = DEFAULT_RUBY_ANNOTATIONS_BY_VOLUME[Number(volume)] || [],
    rubyAnnotationSource = options.rubyAnnotations === undefined ? 'built-in' : 'explicit',
    sourcePath = '<inline>', onDiagnostic,
  } = options;
  validateWording(wording);
  const sourceIndices = new Map();
  let textIndex = 0;
  const simplifiedBlocks = parsed.blocks.map((block) => {
    if (block.type !== 'text') return { ...block };
    textIndex += 1;
    const context = { volume, source: sourcePath, paragraphIndex: textIndex, ...block._sourceLocation };
    const prior = block._chineseConversion;
    const position = [context.volume, context.source, context.paragraphIndex].filter((value) => value != null).join(':');
    if (prior && (prior.base !== BASE_CONVERSION_ID || !['taiwan', 'mainland'].includes(prior.wording))) {
      throw new Error(`Cannot reuse unknown Chinese conversion (${position})`);
    }
    if (prior && prior.fingerprint !== blockConversionFingerprint(block)) {
      throw new Error(`Cannot reuse changed Chinese conversion (${position})`);
    }
    if (!prior && block._unpairedReadings?.length) {
      throw new Error(`Cannot reuse unpaired ruby readings without conversion state (${position})`);
    }
    if (prior?.wording === 'mainland' && wording === 'taiwan') {
      throw new Error(`Cannot restore Taiwan wording from converted text (${position})`);
    }
    if (prior?.wording === 'mainland') {
      throw new Error(`Cannot reprocess mainland wording; reparse the source (${position})`);
    }
    const spans = block.rubySpans && block._rubySourceReadings
      ? attachNativeRubySources(block.rubySpans, block._rubySourceReadings) : block.rubySpans;
    const converted = spans
      ? simplifyNativeRubyTree(block.text, spans, context, block._rubyProtectedRanges || [], Boolean(prior)) : null;
    const result = converted
      ? { ...block, text: converted.text, rubySpans: converted.spans, _sourceLocation: context,
        ...(block._rubyProtectedRanges ? { _rubyProtectedRanges: converted.protectedRanges } : {}) }
      : { ...block, text: prior ? normalizeText(block.text) : simplifyBase(normalizeText(block.text)) };
    result._chineseConversion = { base: BASE_CONVERSION_ID, wording };
    sourceIndices.set(result, textIndex);
    return result;
  });

  const contentsIndex = simplifiedBlocks.findIndex((block) => block.type === 'text' && isContentsTitle(block.text));
  if (contentsIndex < 0) throw new Error('No CONTENTS block found');
  const sourcePosition = (block) => {
    const context = block._sourceLocation || { volume, source: sourcePath, paragraphIndex: sourceIndices.get(block) };
    return [context.volume, context.source, context.paragraphIndex].filter((value) => value != null).join(':');
  };
  const titleText = (block) => {
    const text = normalizeTitle(block.text);
    if (block._rubyProtectedRanges?.some((range) => range.unpaired !== false)) {
      throw new Error(`Cannot preserve unpaired ruby in title (${sourcePosition(block)})`);
    }
    if ((block.rubySpans?.length || block._rubyProtectedRanges?.length) && text !== block.text) {
      throw new Error(`Cannot preserve ruby in normalized title (${sourcePosition(block)})`);
    }
    return text;
  };
  for (const block of simplifiedBlocks.slice(0, contentsIndex + 1)) {
    if (block.rubySpans?.length || block._rubyProtectedRanges?.length) {
      throw new Error(`Cannot preserve ruby in book metadata (${sourcePosition(block)})`);
    }
  }
  const originalTitle = parsed.title || simplifiedBlocks.find((block) => block.type === 'text')?.text || '';
  const firstInputText = parsed.blocks.find((block) => block.type === 'text');
  const titleWasConverted = !parsed.title || (firstInputText?._chineseConversion?.base === BASE_CONVERSION_ID
    && parsed.title === firstInputText.text);
  const title = normalizeBookTitle(originalTitle, volume, wording, { baseConverted: titleWasConverted });

  const coverImage = simplifiedBlocks.find((block) => block.type === 'image');
  if (!coverImage) throw new Error('No cover image found');

  const frontImages = simplifiedBlocks
    .slice(0, contentsIndex)
    .filter((block) => block.type === 'image' && block !== coverImage);

  const creditBlocks = simplifiedBlocks
    .slice(0, contentsIndex)
    .filter((block) => block.type === 'text')
    .filter((block, index) => index !== 0);

  const tocRecords = [];
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
    tocRecords.push({ title: titleText(block), block });
    cursor += 1;
  }

  const titleMap = new Map(tocRecords.map((record) => [titleKey(record.title), record]));
  const summaryBlocks = [];
  const chapters = [];
  const chapterTitleSources = new Map();
  let current = null;
  let seenFirstChapter = false;

  const startChapter = (record, headingBlock) => {
    if (current) chapters.push(current);
    current = { title: record.title, blocks: [] };
    chapterTitleSources.set(current, { tocBlock: record.block, headingBlock });
    seenFirstChapter = true;
  };

  for (let i = cursor; i < simplifiedBlocks.length; i += 1) {
    const block = simplifiedBlocks[i];
    if (block.type === 'text') {
      const text = normalizeTitle(block.text);
      const key = titleKey(text);
      if (titleMap.has(key)) {
        titleText(block);
        startChapter(titleMap.get(key), block);
        continue;
      }
      if (isAfterwordTitle(text)) {
        if (!titleMap.has('后记')) {
          const record = { title: '后记', block: null };
          titleMap.set('后记', record);
          tocRecords.push(record);
        }
        titleText(block);
        startChapter(titleMap.get('后记'), block);
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
  const usedTocBlocks = new Set(Array.from(chapterTitleSources.values(), ({ tocBlock }) => tocBlock));
  for (const record of tocRecords) {
    if (record.block && !usedTocBlocks.has(record.block)
      && (record.block.rubySpans?.length || record.block._rubyProtectedRanges?.length)) {
      throw new Error(`Cannot preserve ruby in unmatched TOC title (${sourcePosition(record.block)})`);
    }
  }
  const backImages = extractTrailingImages(chapters);

  const book = {
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
    tocTitles: tocRecords.map((record) => record.title),
    chapters,
    _rubyAnnotationConfig: {
      rules: rubyAnnotations.map((rule) => rule ? { ...rule } : rule), source: rubyAnnotationSource, volume,
    },
  };

  const protectedRanges = new Map();
  for (const plan of planChapterRendering(book).plans) {
    const notes = groupFixedFootnotesByPara(anotherDaysFixedFootnotesForChapter(volume, plan.id.replace(/\.xhtml$/, '')));
    let paraIndex = 0;
    for (const block of plan.bodyBlocks) {
      if (block.type === 'image') continue;
      const text = block.rubySpans ? block.text : normalizeText(block.text);
      if (!text || isSeparator(text)) continue;
      if (!block.rubySpans) {
        const fixedFootnotes = notes.get(paraIndex) || [];
        protectedRanges.set(block, { matches: annotationRangesForParagraph(text, rubyAnnotations, fixedFootnotes), fixedFootnotes });
      }
      paraIndex += 1;
    }
  }
  for (const block of simplifiedBlocks) {
    if (block.type !== 'text') continue;
    const original = block.text;
    const protection = protectedRanges.get(block);
    const result = block.rubySpans
      ? mapNativeRubyTree(block.text, block.rubySpans, (text, ranges) => applyWordingRules(text, { wording, ranges }),
        block._sourceLocation, block._rubyProtectedRanges || [])
      : applyWordingRules(block.text, { wording, ranges: protection?.matches || [], includeEdits: Boolean(protection) });
    const diagnosticContext = block._sourceLocation || { volume, source: sourcePath, paragraphIndex: sourceIndices.get(block) };
    for (const skipped of result.skipped) onDiagnostic?.({
      ...diagnosticContext,
      ruleId: skipped.ruleId, kind: 'text', start: skipped.start, end: skipped.end,
    });
    block.text = result.text;
    if (block.rubySpans) {
      block.rubySpans = result.spans;
      if (block._rubyProtectedRanges) block._rubyProtectedRanges = result.protectedRanges;
      reportNativeReadings(block.rubySpans, {
        ...diagnosticContext, wording, onDiagnostic,
      });
    }
    reportUnpairedReadings(block._unpairedReadings || [], { ...diagnosticContext, wording, onDiagnostic });
    block._chineseConversion.fingerprint = blockConversionFingerprint(block);
    if (protection && (result.edits.length || result.skipped.length)) block._rubyAnnotationPlan = {
      sourceText: original, text: result.text, edits: result.edits, skipped: result.skipped,
      matches: result.ranges, noteBoundaries: noteBoundarySignature(result.text, protection.fixedFootnotes),
      source: sourcePath, paragraphIndex: sourceIndices.get(block),
    };
  }
  book.tocTitles = tocRecords.map((record) => record.block
    ? titleText(record.block) : applyWordingRules(record.title, { wording }).text);
  for (const chapter of chapters) {
    const { tocBlock, headingBlock } = chapterTitleSources.get(chapter);
    chapter.title = tocBlock ? titleText(tocBlock) : applyWordingRules(chapter.title, { wording }).text;
    if (tocBlock?.rubySpans?.length) chapter.titleRubySpans = tocBlock.rubySpans;
    if (tocBlock?.rubySpans?.length || tocBlock?._rubyProtectedRanges?.length
      || headingBlock?.rubySpans?.length || headingBlock?._rubyProtectedRanges?.length) {
      chapter.heading = { text: titleText(headingBlock), rubySpans: headingBlock.rubySpans || [] };
    }
  }
  return book;
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
  rubyAnnotations = null,
  rubyAnnotationSource = null,
  onDiagnostic,
  modifiedIso = new Date().toISOString(),
}) {
  for (const block of [...book.preBlocks, ...book.chapters.flatMap((chapter) => chapter.blocks)]) assertRubyPlanMatchesBlock(block);
  const config = book._rubyAnnotationConfig;
  const sameVolume = config && String(config.volume) === String(volume);
  const inherited = config && (config.source !== 'built-in' || sameVolume) ? config : null;
  const annotations = rubyAnnotations ?? inherited?.rules ?? DEFAULT_RUBY_ANNOTATIONS_BY_VOLUME[Number(volume)] ?? [];
  const annotationSource = rubyAnnotationSource ?? (rubyAnnotations === null ? inherited?.source ?? 'built-in' : 'explicit');
  const sameAnnotationRules = Boolean(config
    && rubyAnnotationSignature(config.rules) === rubyAnnotationSignature(annotations));
  const rubyCounts = annotations.map(() => 0);
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
    return [{ title: plan.chapter.title, titleRubySpans: plan.chapter.titleRubySpans, href: plan.navHref }];
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
          { title: plan.chapter.title, titleRubySpans: plan.chapter.titleRubySpans, heading: plan.chapter.heading, blocks: plan.bodyBlocks },
          {
            rubyAnnotations: annotations,
            onRubyMatch: (index) => { rubyCounts[index] += 1; },
            sameAnnotationRules,
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

  const bookUuid = randomUUID();
  files['OEBPS/toc.ncx'] = renderTocNcx({
    title: book.title,
    uuid: bookUuid,
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
    uuid: bookUuid,
    modifiedIso,
    manifestItems,
    spineItems,
    hasSummary: Boolean(styleSummaryXhtml),
    hasPre,
  });

  await fs.promises.mkdir(path.dirname(outEpubPath), { recursive: true });
  const stagingDir = await fs.promises.mkdtemp(path.join(path.dirname(outEpubPath), '.epub-build-'));
  const stagingPath = path.join(stagingDir, 'book.epub');
  try {
    await writeEpub(stagingPath, files);
    const validation = await validateOutput(stagingPath);
    if (!validation.ok) {
      throw new Error(`EPUB 校验失败：${[...validation.issues, ...validation.brokenLinks].join('；')}`);
    }
    if (annotationSource === 'explicit') {
      rubyCounts.forEach((count, index) => onDiagnostic?.({
        kind: 'ruby-annotation-count', ruleIndex: index + 1, count,
        ...(count === 0 ? { message: '未命中，请检查手工注音匹配文本' } : {}),
      }));
    }
    await fs.promises.rename(stagingPath, outEpubPath);
  } finally {
    await fs.promises.rm(stagingDir, { recursive: true, force: true });
  }
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
  wording = 'taiwan',
  sourcePath = htmlPath,
  onDiagnostic,
  includeSpecials = true,
  creditOverrides = DEFAULT_CREDIT_OVERRIDES,
  rubyAnnotations = null,
  rubyAnnotationSource = rubyAnnotations === null ? 'built-in' : 'explicit',
  modifiedIso = new Date().toISOString(),
}) {
  validateWording(wording);
  const annotations = rubyAnnotations ?? DEFAULT_RUBY_ANNOTATIONS_BY_VOLUME[Number(volume)] ?? [];
  const fs = await import('node:fs/promises');
  const html = await fs.readFile(htmlPath, 'utf8');
  const book = parseLightNovelHtml(html, {
    volume, wording, rubyAnnotations: annotations, rubyAnnotationSource, sourcePath, onDiagnostic,
  });
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
    rubyAnnotations: annotations,
    rubyAnnotationSource,
    onDiagnostic,
    modifiedIso,
  });
}
