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
import { applyWordingRules, BASE_CONVERSION_ID, conversionFingerprint, simplifyBaseWithRuby, simplifyText, validateWording } from './chinese-conversion.js';

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
function parseTocEntries(xhtml, context) {
  const { document } = parseHTML(xhtml);
  const entries = [];
  const main = document.querySelector('.main');
  const paragraphs = main ? Array.from(main.children).filter((node) => node.localName === 'p') : [];
  const links = Array.from(document.querySelectorAll('a'));
  const paragraphBaselines = new Map();
  for (const [index, a] of links.entries()) {
    const href = a.getAttribute('href') || '';
    const p = a.closest('p');
    const paragraphIndex = paragraphs.indexOf(p) + 1 || null;
    let container = a;
    let outerRuby = a.closest('ruby');
    while (outerRuby?.parentElement?.closest('ruby')) outerRuby = outerRuby.parentElement.closest('ruby');
    if (outerRuby) {
      if (inlinePlainText(outerRuby).replace(/\s+/g, '') !== inlinePlainText(a).replace(/\s+/g, '')) {
        throw new Error(`Cannot preserve ruby around TOC link (${context.volume}:${context.source}:${paragraphIndex ?? `toc-${index + 1}`})`);
      }
      container = outerRuby;
    }
    const rubyRoot = paragraphIndex ? p : container;
    const rubyElements = [
      ...((rubyRoot.localName || '').toLowerCase() === 'ruby' ? [rubyRoot] : []),
      ...rubyRoot.querySelectorAll('ruby'),
    ];
    const block = (container.localName || '').toLowerCase() === 'ruby' || container.querySelector('ruby')
      ? buildCompactedBlock(container, {
        ...context, paragraphIndex, ...(paragraphIndex ? {} : { tocEntryIndex: index + 1 }), rubyElements,
      }, paragraphIndex ? () => {
        if (!paragraphBaselines.has(p)) {
          paragraphBaselines.set(p, buildInlineBlock(p, {
            ...context, paragraphIndex, wording: 'taiwan', onDiagnostic: undefined,
            markerElements: new Set(links.filter((link) => link.closest('p') === p)),
          }));
        }
        const baseline = paragraphBaselines.get(p);
        const marker = baseline.markers.find((item) => item.element === a);
        if (!marker) throw new Error(`Cannot map TOC link position (${context.volume}:${context.source}:${paragraphIndex})`);
        return { text: baseline.text.slice(marker.start, marker.end), offset: marker.start };
      } : null)
      : { text: simplifyText((a.textContent || '').replace(/\s+/g, ''), { wording: context.wording }), rubySpans: [] };
    assertTitleRubyRepresentable(block, { ...context, paragraphIndex });
    const text = block.text;
    if (text && !/^[ＣＯＮＴＥＮＴＳ]$/i.test(text) && !/^CONTENTS$/i.test(text)) {
      const file = href.split('#')[0];  // p-002.xhtml
      entries.push({ href: file, title: text, rubySpans: block.rubySpans });
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

function inlinePlainText(node) {
  if (node.nodeType === 3) return node.textContent || '';
  const tag = (node.localName || '').toLowerCase();
  if (tag === 'rt' || tag === 'rp' || tag === 'br') return '';
  if (tag === 'img') {
    const base = path.posix.basename((node.getAttribute('src') || '').split('?')[0]);
    return RARE_CHAR_IMAGE_MAP[base] || '';
  }
  return Array.from(node.childNodes || []).map(inlinePlainText).join('');
}

function normalizeInlineText(text) {
  return text.replace(/[ \t\r\n\u00a0]+/g, ' ');
}

function buildCompactedBlock(element, context, expandedSource = null) {
  const events = [];
  const block = buildInlineBlock(element, {
    ...context, compact: true, onDiagnostic: context.onDiagnostic ? (event) => events.push(event) : undefined,
  });
  if (events.length === 0) return block;
  const textEvents = events.filter((event) => event.kind === 'text');
  if (textEvents.length === 0) {
    for (const event of events) context.onDiagnostic(event);
    return block;
  }
  const baseOptions = { ...context, wording: 'taiwan', onDiagnostic: undefined };
  const expanded = expandedSource ? expandedSource() : { text: buildInlineBlock(element, baseOptions).text, offset: 0 };
  const compact = buildInlineBlock(element, { ...baseOptions, compact: true }).text;
  const expandedPoints = [];
  let expandedOffset = expanded.offset;
  for (const point of expanded.text) {
    if (!/\s/u.test(point)) expandedPoints.push({ start: expandedOffset, end: expandedOffset + point.length });
    expandedOffset += point.length;
  }
  const compactOffsets = [0];
  for (const point of compact) compactOffsets.push(compactOffsets.at(-1) + point.length);
  if (expandedPoints.length !== compactOffsets.length - 1) {
    throw new Error(`Cannot map compacted text positions (${context.volume}:${context.source}:${context.paragraphIndex})`);
  }
  for (const event of events) {
    if (event.kind === 'rt') { context.onDiagnostic(event); continue; }
    const start = compactOffsets.indexOf(event.start);
    const end = compactOffsets.indexOf(event.end);
    if (start < 0 || end <= start) throw new Error(`Cannot map compacted text positions (${context.volume}:${context.source}:${context.paragraphIndex})`);
    context.onDiagnostic({ ...event, start: expandedPoints[start].start, end: expandedPoints[end - 1].end });
  }
  return block;
}

// rubySpans 使用简化后 text 的 UTF-16 偏移；空数组也表示正文已按源结构解析，不用字符串回退。
function buildInlineBlock(pEl, context) {
  let text = '';
  const rubySpans = [];
  const rubyRanges = [];
  const unpairedReadings = [];
  const markerRanges = [];
  const rubyElements = context.rubyElements || Array.from(pEl.querySelectorAll('ruby'));
  const normalize = (value) => {
    const part = normalizeInlineText(value);
    return context.compact ? part.replace(/\s+/g, '') : part;
  };
  const diagnosticContext = {
    volume: context.volume, source: context.source, paragraphIndex: context.paragraphIndex,
    ...(context.tocEntryIndex ? { tocEntryIndex: context.tocEntryIndex } : {}),
  };
  const append = (value) => {
    let part = normalize(value);
    if (text.endsWith(' ') && part.startsWith(' ')) part = part.slice(1);
    text += part;
  };
  const withMarker = (element, visit) => {
    const start = text.length;
    visit();
    if (context.markerElements?.has(element) && text.length > start) {
      markerRanges.push({ element, start, end: text.length });
    }
  };
  const walkRuby = (ruby) => {
    const pending = [];
    const rubyIndex = rubyElements.indexOf(ruby) + 1;
    const readings = Array.from(ruby.querySelectorAll('rt'));
    const rubyStart = text.length;
    const recordBase = (start, explicit = false) => {
      const part = text.slice(start);
      const previous = pending.at(-1);
      if (!part.trim() && (!previous || previous.explicit)) return;
      if (!explicit && previous && !previous.explicit) previous.end = text.length;
      else pending.push({ start, end: text.length, explicit });
    };
    const appendBase = (value) => {
      const part = normalize(value);
      const previous = pending.at(-1);
      if (!part.trim() && (!previous || previous.explicit)) return;
      const start = text.length;
      append(part);
      recordBase(start);
    };
    const walkBase = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) { append(child.textContent || ''); continue; }
        if (child.nodeType !== 1) continue;
        const tag = (child.localName || '').toLowerCase();
        withMarker(child, () => {
          if (tag === 'ruby') walkRuby(child);
          else if (tag === 'img') append(inlinePlainText(child));
          else if (tag !== 'rt' && tag !== 'rp' && tag !== 'br') walkBase(child);
        });
      }
    };
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) { appendBase(child.textContent || ''); continue; }
        if (child.nodeType !== 1) continue;
        const tag = (child.localName || '').toLowerCase();
        withMarker(child, () => {
          if (tag === 'rp') return;
          if (tag === 'rt') {
            const base = pending.shift();
            const reading = buildInlineBlock(child, {
              ...context, compact: false, rubyElements,
              reading: { rubyIndex, rtIndex: readings.indexOf(child) + 1 },
            });
            if (reading._unpairedReadings) unpairedReadings.push(...reading._unpairedReadings);
            if (!base && reading.text) unpairedReadings.push({
              text: reading.text, rubyIndex, rtIndex: readings.indexOf(child) + 1,
              ...(reading.rubySpans.length ? { rubySpans: reading.rubySpans, sourceReadings: reading._rubySourceReadings } : {}),
            });
            if (base && reading.text) rubySpans.push({
              start: base.start, end: base.end, rt: reading.text, element: ruby,
              _rubyIndex: rubyIndex, _rtIndex: readings.indexOf(child) + 1,
              ...(reading.rubySpans.length ? { rtSpans: reading.rubySpans } : {}),
              ...(reading._rubySourceReadings?.length ? { _rtSourceReadings: reading._rubySourceReadings } : {}),
            });
          } else if (tag === 'rb' || tag === 'ruby') {
            const start = text.length;
            if (tag === 'ruby') walkRuby(child);
            else walkBase(child);
            recordBase(start, tag === 'rb');
          } else if (tag === 'img') appendBase(inlinePlainText(child));
          else if (tag !== 'br') walk(child);
        });
      }
    };
    walk(ruby);
    if (text.length > rubyStart) rubyRanges.push({ start: rubyStart, end: text.length, element: ruby });
  };
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { append(c.textContent || ''); continue; }
      if (c.nodeType !== 1) continue;
      const tag = (c.localName || c.tagName || '').toLowerCase();
      withMarker(c, () => {
        if (tag === 'ruby') walkRuby(c);
        else if (tag === 'img') append(inlinePlainText(c));
        else if (tag !== 'br' && tag !== 'rt' && tag !== 'rp') walk(c);
      });
    }
  };
  if ((pEl.localName || '').toLowerCase() === 'ruby') walkRuby(pEl);
  else walk(pEl);
  const leading = text.length - text.trimStart().length;
  const original = text.trim();
  const sourceSpans = [
    ...rubySpans.map((span) => ({ ...span, protectedOnly: false })),
    ...rubyRanges.map((span) => ({ ...span, protectedOnly: true })),
  ].map((span) => ({
    ...span, start: Math.max(0, span.start - leading), end: Math.min(original.length, span.end - leading),
  })).filter((span) => span.end > span.start);
  const baseline = simplifyBaseWithRuby(original, context.markerElements ? [] : sourceSpans, context);
  let markers;
  if (context.markerElements) {
    const offsets = (value) => {
      const result = [0];
      for (const point of value) result.push(result.at(-1) + point.length);
      return result;
    };
    const sourceOffsets = offsets(original);
    const targetOffsets = offsets(baseline.text);
    if (sourceOffsets.length !== targetOffsets.length) {
      throw new Error(`Cannot map TOC link position (${context.volume}:${context.source}:${context.paragraphIndex})`);
    }
    markers = markerRanges.map(({ element, start, end }) => {
      const startIndex = sourceOffsets.indexOf(Math.max(0, start - leading));
      const endIndex = sourceOffsets.indexOf(Math.min(original.length, end - leading));
      if (startIndex < 0 || endIndex < 0) throw new Error(`Cannot map TOC link position (${context.volume}:${context.source}:${context.paragraphIndex})`);
      return { element, start: targetOffsets[startIndex], end: targetOffsets[endIndex] };
    });
  }
  const result = applyWordingRules(baseline.text, {
    wording: context.wording,
    ranges: context.reading && baseline.text.length
      ? [...baseline.spans, { start: 0, end: baseline.text.length, protectedOnly: true }] : baseline.spans,
  });
  for (const skipped of result.skipped) context.onDiagnostic?.({
    ...diagnosticContext,
    ruleId: skipped.ruleId, kind: context.reading ? 'rt' : 'text',
    ...(context.reading || {}), start: skipped.start, end: skipped.end,
  });
  text = result.text;
  const annotations = result.ranges.filter((span) => !span.protectedOnly)
    .map(({ protectedOnly, element, _rubyIndex, _rtIndex, _rtSourceReadings, ...span }) => ({
      element, span: { ...span, base: text.slice(span.start, span.end) },
      source: { start: span.start, end: span.end, rt: span.rt, rubyIndex: _rubyIndex, rtIndex: _rtIndex,
        ...(_rtSourceReadings ? { rtSpans: _rtSourceReadings } : {}) },
    }))
    .sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end
      || rubyElements.indexOf(a.element) - rubyElements.indexOf(b.element));
  const outputSpans = [];
  const sourceReadings = [];
  for (const item of annotations) {
    let ancestor = item.element.parentElement?.closest('ruby');
    let parent;
    while (ancestor && !parent) {
      parent = annotations.find((candidate) => candidate.element === ancestor
        && candidate.span.start <= item.span.start && candidate.span.end >= item.span.end);
      ancestor = ancestor.parentElement?.closest('ruby');
    }
    if (parent) {
      (parent.span.children ||= []).push(item.span);
      (parent.source.children ||= []).push(item.source);
    } else {
      outputSpans.push(item.span);
      sourceReadings.push(item.source);
    }
  }
  const protectedRanges = result.ranges.filter((span) => span.protectedOnly && span.element)
    .map(({ start, end, element }) => {
      let covered = start;
      const paired = annotations.filter((item) => item.element === element).map((item) => item.span)
        .sort((a, b) => a.start - b.start);
      for (const span of paired) {
        if (span.start > covered) break;
        covered = Math.max(covered, span.end);
      }
      return { start, end, unpaired: covered < end };
    });
  if (!context.reading && !context.markerElements && !text && unpairedReadings.length) {
    const position = [context.volume, context.source, context.paragraphIndex].filter((value) => value != null).join(':');
    throw new Error(`Cannot preserve isolated unpaired ruby reading${position ? ` (${position})` : ''}`);
  }
  return {
    type: 'text', text, bold: false,
    rubySpans: outputSpans,
    _chineseConversion: { base: BASE_CONVERSION_ID, wording: context.wording, fingerprint: conversionFingerprint(text, outputSpans, protectedRanges, {
      unpairedReadings, sourceReadings, sourceLocation: diagnosticContext,
    }) },
    ...(protectedRanges.length ? { _rubyProtectedRanges: protectedRanges } : {}),
    ...(sourceReadings.length ? { _rubySourceReadings: sourceReadings } : {}),
    ...(unpairedReadings.length ? { _unpairedReadings: unpairedReadings } : {}),
    _sourceLocation: diagnosticContext,
    ...(markers ? { markers } : {}),
  };
}

function titleRubyProperties(block) {
  return block?.rubySpans?.length ? { titleRubySpans: block.rubySpans } : {};
}

function assertTitleRubyRepresentable(block, context = block?._sourceLocation) {
  if (!block?._rubyProtectedRanges?.some((range) => range.unpaired)) return;
  const position = [context?.volume, context?.source, context?.paragraphIndex].filter((value) => value != null).join(':');
  throw new Error(`Cannot preserve unpaired ruby in title${position ? ` (${position})` : ''}`);
}

function headingStyleNodes(element) {
  return [element, ...element.querySelectorAll('[class]')].filter((node) =>
    (node.getAttribute('class') || '').split(/\s+/).some((token) => token === 'font-1em40' || token === 'gfont40'));
}

function isStandaloneHeading(element, blocks) {
  if (blocks.some((block) => block.type === 'text')) return false;
  const text = inlinePlainText(element).replace(/\s+/g, '');
  if (!text) return false;
  return headingStyleNodes(element).some((node) => inlinePlainText(node).replace(/\s+/g, '') === text);
}

function parseChapterXhtml(xhtml, context) {
  const blocks = [];
  let headingBlock = null;
  let paragraphIndex = 0;
  const { document } = parseHTML(xhtml);
  const main = document.querySelector('.main');
  if (!main) return { blocks, headingBlock };

  for (const child of main.childNodes) {
    if (child.nodeType !== 1) continue;
    const tag = (child.localName || child.tagName || '').toLowerCase();

    if (tag === 'p') {
      paragraphIndex += 1;
      const html = (child.outerHTML || child.toString?.() || '');

      // 跳过 <p id="mokuji-*">
      if (/^\s*<p\b[^>]*\bid\s*=\s*["']mokuji-/.test(html)) continue;

      const cls = child.getAttribute('class') || '';

      // 跳过仅含 mfont class 的空/标记段
      if (/\bmfont\b/.test(cls) && !BODY_P_CSS_RE.test(cls) && !isStandaloneHeading(child, blocks)) continue;

      // 跳过 spacer
      const text = (child.textContent || '').trim();
      if (/^[　\s]*$/.test(text) && child.querySelector('br')) continue;

      // 只抽出正文开始前、整段由标题样式包裹的节点。
      if (headingBlock === null && isStandaloneHeading(child, blocks)) {
        const block = buildCompactedBlock(child, { ...context, paragraphIndex });
        if (block.text) { headingBlock = block; continue; }
      }

      // 内嵌图片
      const img = child.querySelector('img');
      if (img) {
        const base = path.posix.basename((img.getAttribute('src') || '').split('?')[0]);
        const imgCls = img.getAttribute('class') || '';
        // 行内代用字图（生僻字做成 1em 小图嵌在文字里）：还原整段文字 + 真字符，不抽成块图。
        const isInlineGlyph = /\bheight-1em\b/.test(imgCls) || Object.prototype.hasOwnProperty.call(RARE_CHAR_IMAGE_MAP, base);
        if (isInlineGlyph) {
          const block = buildInlineBlock(child, { ...context, paragraphIndex });
          if (block.text) blocks.push(block);
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
        const block = buildInlineBlock(child, { ...context, paragraphIndex });
        if (block.text) blocks.push(block);
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

  return { blocks, headingBlock };
}

/**
 * parseAnotherDaysChapterXhtml — readmoo another days 正文页解析。
 *
 * readmoo 正文 <p> 的 class 是纯字体度量（moofs16 moolh28），没有 hyread 的
 * __reader-text-indent__/paragraph-spacing 类，通用 parseChapterXhtml 的 BODY_P_CSS_RE
 * 无法识别 → 正文全丢。本函数放宽正文段判定：非 mfont 标记段、非 mokuji 锚点、
 * 非 spacer、有文字内容即视为正文段。标题/图片/SVG 逻辑与 parseChapterXhtml 一致。
 */
function parseAnotherDaysChapterXhtml(xhtml, context) {
  const blocks = [];
  let headingBlock = null;
  let paragraphIndex = 0;
  const { document } = parseHTML(xhtml);
  const main = document.querySelector('.main');
  if (!main) return { blocks, headingBlock };

  for (const child of main.childNodes) {
    if (child.nodeType !== 1) continue;
    const tag = (child.localName || child.tagName || '').toLowerCase();

    if (tag === 'p') {
      paragraphIndex += 1;
      const html = (child.outerHTML || child.toString?.() || '');
      if (/^\s*<p\b[^>]*\bid\s*=\s*["']mokuji-/.test(html)) continue;

      const cls = child.getAttribute('class') || '';
      // mfont 段是标记/空段（如 font-1em10 小字标记），readmoo 正文段是 moofs*/moolh*
      if (/\bmfont\b/.test(cls) && headingStyleNodes(child).length === 0) continue;

      const text = (child.textContent || '').trim();
      if (/^[　\s]*$/.test(text) && child.querySelector('br')) continue;

      if (headingBlock === null && isStandaloneHeading(child, blocks)) {
        const block = buildCompactedBlock(child, { ...context, paragraphIndex });
        if (block.text) { headingBlock = block; continue; }
      }

      // 内嵌图片
      const img = child.querySelector('img');
      if (img) {
        const base = path.posix.basename((img.getAttribute('src') || '').split('?')[0]);
        const imgCls = img.getAttribute('class') || '';
        const isInlineGlyph = /\bheight-1em\b/.test(imgCls)
          || Object.prototype.hasOwnProperty.call(RARE_CHAR_IMAGE_MAP, base);
        if (isInlineGlyph) {
          const block = buildInlineBlock(child, { ...context, paragraphIndex });
          if (block.text) blocks.push(block);
          continue;
        }
        if (base) {
          const id = base.replace(/\.[^.]+$/, '');
          blocks.push({ type: 'image', src: `image/${base}`, width: 0, height: 0, alt: id, id, fileName: base });
        }
        continue;
      }

      // 正文段：有文字即取（readmoo 无 __reader-* 类，靠排除标记段后的有文字 p）
      const block = buildInlineBlock(child, { ...context, paragraphIndex });
      if (block.text) blocks.push(block);
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
  return { blocks, headingBlock };
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

export async function parseHyreadEpubToBook(sourceEpubPath, {
  volume, creditOverrides = {}, wording = 'taiwan', onDiagnostic,
} = {}) {
  validateWording(wording);
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
  const tocSource = `${R}/xhtml/p-toc-001.xhtml`;
  const tocEntries = parseTocEntries(read(tocSource), { volume, source: tocSource, wording, onDiagnostic });
  // 构建文件名 → 标题的映射（如 "p-003.xhtml" → "12月13日（星期一）淺村悠太"）
  const tocFileToTitle = new Map(tocEntries.map((e) => [e.href, e]));
  const tocTitles = tocEntries.map((e) => e.title);

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
    const { blocks, headingBlock } = parseChapterXhtml(read(chPath), { volume, source: chPath, wording, onDiagnostic });
    assertTitleRubyRepresentable(headingBlock);
    fileBlocks.push({ fileName, blocks, headingBlock });
  }

  // == 6) 分类：题记 / 章节 / 后记 ==
  const chapters = [];
  let preBlocks = [];

  for (const { fileName, blocks, headingBlock } of fileBlocks) {
    const tocTitle = tocFileToTitle.get(fileName);

    if (tocTitle) {
      // 在 TOC 中 → 普通章节。大字标题已在 parseChapterXhtml 抽出（不在 blocks 里），
      // h3 用 TOC 标题；台繁 TOC 与正文标题措辞可能不同（如「与」vs「和」），按结构剥除不受影响。
      chapters.push({
        title: tocTitle.title, ...titleRubyProperties(tocTitle),
        ...(headingBlock?.rubySpans.length ? { heading: headingBlock } : {}), blocks,
      });
    } else if (fileName === 'p-001.xhtml') {
      // p-001 不在 TOC 中，内容为卷首语 → preBlocks
      const textBlocks = blocks.filter((b) => b.type === 'text');
      preBlocks = textBlocks.length > 0 && textBlocks[0].text.length < 200 ? textBlocks : [];
    } else {
      // 其他不在 TOC 中的（如 p-015 后记）：用抽出的大字标题作 h3，正文已不含标题。
      const titleBlock = headingBlock || blocks.find((b) => b.type === 'text');
      assertTitleRubyRepresentable(titleBlock);
      const rawTitle = titleBlock?.text?.trim() || '';
      let title = rawTitle;
      // 检测后记
      if (!titleBlock?.rubySpans?.length && /^后记|^後記|^あとがき/.test(rawTitle)) {
        title = '后记';
      }
      chapters.push({ title, ...(title === rawTitle ? titleRubyProperties(titleBlock) : {}), blocks });
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
export async function parseAnotherDaysEpubToBook(sourceEpubPath, {
  volume = 'another-days', creditOverrides = {}, wording = 'taiwan', onDiagnostic,
} = {}) {
  validateWording(wording);
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
  const tocSource = `${R}/xhtml/p-toc-001.xhtml`;
  const tocEntries = parseTocEntries(read(tocSource), { volume, source: tocSource, wording, onDiagnostic });
  const tocHrefToTitle = new Map(tocEntries.map((e) => [path.posix.basename(e.href), e]));

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
    if (fmatterRe.test(base)) fmatterTitleMap.set(base, e);
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
      const source = `${R}/xhtml/${name}`;
      const { blocks, headingBlock } = parseAnotherDaysChapterXhtml(read(source), { volume, source, wording, onDiagnostic });
      assertTitleRubyRepresentable(headingBlock);
      // 头部插入配对彩插
      const allBlocks = [...pendingFmatterBlocks, ...blocks];
      pendingFmatterBlocks = [];

      // 标题优先级：nav href 指向本 p-NNN > nav href 指向配对 p-fmatter > headingText。
      // 没有源目录/标题的中间页（如 p-007）保留正文，但不能用首段伪造目录项。
      let includeInToc = false;
      let titleBlock = tocHrefToTitle.get(name);
      if (titleBlock) {
        includeInToc = true;
      } else {
        // 找前一个紧邻的 p-fmatter（配对彩插）的 nav 标题
        for (let j = i - 1; j >= 0; j--) {
          const prev = spineNames[j];
          if (fmatterRe.test(prev)) {
            titleBlock = fmatterTitleMap.get(prev);
            if (titleBlock) includeInToc = true;
            break;
          }
          if (chapterRe.test(prev)) break; // 遇到上一个正文就停
        }
      }
      if (!titleBlock) titleBlock = headingBlock;
      assertTitleRubyRepresentable(titleBlock);
      const rawTitle = titleBlock?.title || titleBlock?.text || '';
      const title = titleBlock === headingBlock && !titleBlock?.rubySpans?.length
        && /^后记|^後記|^あとがき/.test(rawTitle) ? '后记' : rawTitle;
      if (headingBlock && titleBlock === headingBlock) includeInToc = Boolean(title);

      // p-001 不在 TOC 且无配对彩插标题 → 卷首语 preBlocks（仅取首段且 <200 字）
      const inToc = tocHrefToTitle.has(name);
      if (!inToc && name === 'p-001.xhtml' && !title) {
        const textBlocks = allBlocks.filter((b) => b.type === 'text');
        if (textBlocks.length > 0 && textBlocks[0].text.length < 200) {
          preBlocks = textBlocks;
          continue;
        }
      }

      chapters.push({
        title, ...(title === rawTitle ? titleRubyProperties(titleBlock) : {}),
        ...(headingBlock?.rubySpans.length && titleBlock !== headingBlock ? { heading: headingBlock } : {}),
        blocks: allBlocks, includeInToc,
      });
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
    tocTitles: tocEntries.map((e) => e.title),
    chapters,
    _sourceImages: sourceImages,
  };
}
