import { createHash } from 'node:crypto';
import * as OpenCC from 'opencc-js';

const TW2S_DIGEST = 'b6b56517a0676e17f6d5ff9b77eaa68397814653dc5b83347d831c9a3c5f3a54';
const converter = OpenCC.Converter({ from: 'tw', to: 'cn' });
const WORDING_RULES = [
  { id: 'network-on', source: '网路上', target: '网络上' },
  { id: 'phone-screen', source: '手机萤幕', target: '手机屏幕' },
  { id: 'smartphone', source: '智慧型手机', target: '智能手机' },
].sort((a, b) => b.source.length - a.source.length);

export function validateWording(value = 'taiwan') {
  if (value !== 'taiwan' && value !== 'mainland') throw new Error(`Invalid wording: ${value}`);
  return value;
}

export function simplifyBase(input) {
  return converter(String(input)).replace(/∼/g, '～');
}

export function applyWordingRules(text, { wording = 'taiwan', ranges = [], includeEdits = false } = {}) {
  validateWording(wording);
  if (wording === 'taiwan') return {
    text, ranges: ranges.map((range) => ({ ...range })), skipped: [], ...(includeEdits ? { edits: [] } : {}),
  };

  const skipped = [];
  const edits = [];
  for (let offset = 0; offset < text.length;) {
    const rule = WORDING_RULES.find((item) => text.startsWith(item.source, offset));
    if (!rule) {
      offset += text.codePointAt(offset) > 0xffff ? 2 : 1;
      continue;
    }
    const end = offset + rule.source.length;
    if (ranges.some((range) => offset < range.end && end > range.start)) {
      skipped.push({ ruleId: rule.id, start: offset, end, ...(includeEdits ? { target: rule.target } : {}) });
    } else {
      edits.push({ start: offset, end, target: rule.target, ...(includeEdits ? { ruleId: rule.id } : {}) });
    }
    offset = end;
  }

  let cursor = 0;
  let result = '';
  for (const edit of edits) {
    result += text.slice(cursor, edit.start) + edit.target;
    cursor = edit.end;
  }
  result += text.slice(cursor);
  const mapOffset = (offset) => offset + edits.reduce(
    (delta, edit) => delta + (edit.end <= offset ? edit.target.length - (edit.end - edit.start) : 0), 0,
  );
  return {
    text: result,
    ranges: ranges.map((range) => ({ ...range, start: mapOffset(range.start), end: mapOffset(range.end) })),
    skipped,
    ...(includeEdits ? { edits } : {}),
  };
}

export function simplifyText(input, { wording = 'taiwan' } = {}) {
  return applyWordingRules(simplifyBase(input), { wording }).text;
}

function location(context) {
  return [context?.volume, context?.source, context?.paragraphIndex].filter((value) => value != null).join(':');
}

function mappingError(context, reason) {
  return new Error(`Cannot map ruby positions after Chinese conversion${location(context) ? ` (${location(context)})` : ''}: ${reason}`);
}

function isWellFormed(text) {
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function boundaries(text) {
  const offsets = [0];
  for (const point of text) offsets.push(offsets.at(-1) + point.length);
  return offsets;
}

function digestConfig(config) {
  const { normalizationChain, segmentation, conversionChain } = config;
  return createHash('sha256').update(JSON.stringify({ normalizationChain, segmentation, conversionChain })).digest('hex');
}

function dictionariesPreserveLength(groups) {
  for (const group of groups) {
    for (const dictionary of group) {
      const entries = typeof dictionary === 'string'
        ? dictionary.split('|').map((line) => line.split(' ')) : dictionary;
      for (const [source, target] of entries) {
        if (typeof source !== 'string' || typeof target !== 'string'
          || Array.from(source).length !== Array.from(target).length) return false;
      }
    }
  }
  return true;
}

function trieFor(group) {
  const trie = new OpenCC.Trie();
  trie.loadDictGroup(group);
  return trie;
}

function traceStage(text, trie, rubyBoundaries, context) {
  let result = '';
  let offset = 0;
  for (const source of trie.segment(text)) {
    const match = trie.matchPrefix(source, 0);
    const target = match?.end === source.length ? match.value : source;
    const end = offset + source.length;
    const sourcePoints = Array.from(source);
    const targetPoints = Array.from(target);
    if (sourcePoints.length !== targetPoints.length) throw mappingError(context, 'dictionary entry changes code point count');

    if (rubyBoundaries.some((boundary) => boundary > offset && boundary < end)) {
      const independent = sourcePoints.map((point) => trie.convert(point)).join('');
      const changed = sourcePoints.reduce((count, point, index) => count + (point !== targetPoints[index] ? 1 : 0), 0);
      if (source !== target && independent !== target && changed !== 1) {
        throw mappingError(context, 'dictionary match crosses a ruby boundary');
      }
    }
    result += target;
    offset = end;
  }
  return result;
}

function mapRanges(source, target, spans, context) {
  const sourceOffsets = boundaries(source);
  const targetOffsets = boundaries(target);
  if (sourceOffsets.length !== targetOffsets.length) throw mappingError(context, 'code point count changed');
  const indices = new Map(sourceOffsets.map((offset, index) => [offset, index]));
  return spans.map((span) => {
    const startIndex = indices.get(span.start);
    const endIndex = indices.get(span.end);
    if (startIndex == null || endIndex == null || startIndex >= endIndex) {
      throw mappingError(context, 'invalid UTF-16 ruby boundary');
    }
    const start = targetOffsets[startIndex];
    const end = targetOffsets[endIndex];
    return { ...span, start, end, base: target.slice(start, end) };
  });
}

export function createBaseRubyConverter({ config, convert, expectedDigest }) {
  let verified = false;
  let normalization;
  let segmentation;
  let stages;

  return (input, spans, context) => {
    const source = String(input);
    const expected = convert(source).replace(/∼/g, '～');
    if (spans.length === 0) return { text: expected, spans: [] };
    if (!isWellFormed(source)) throw mappingError(context, 'input contains an isolated surrogate');

    if (!verified) {
      if (digestConfig(config) !== expectedDigest) throw mappingError(context, 'unexpected OpenCC configuration');
      if (!dictionariesPreserveLength([...config.normalizationChain, ...config.conversionChain])) {
        throw mappingError(context, 'OpenCC dictionary changes code point count');
      }
      normalization = config.normalizationChain.map(trieFor);
      segmentation = config.segmentation.length ? trieFor(config.segmentation) : null;
      stages = config.conversionChain.map(trieFor);
      verified = true;
    }

    let text = source;
    let mapped = mapRanges(source, source, spans, context);
    for (const trie of normalization) {
      const next = traceStage(text, trie, mapped.flatMap((span) => [span.start, span.end]), context);
      mapped = mapRanges(text, next, mapped, context);
      text = next;
    }

    let segments = segmentation ? segmentation.segment(text) : [text];
    for (const trie of stages) {
      let segmentStart = 0;
      segments = segments.map((segment) => {
        const localBoundaries = mapped.flatMap((span) => [span.start, span.end])
          .filter((offset) => offset > segmentStart && offset < segmentStart + segment.length)
          .map((offset) => offset - segmentStart);
        segmentStart += segment.length;
        return traceStage(segment, trie, localBoundaries, context);
      });
      const next = segments.join('');
      mapped = mapRanges(text, next, mapped, context);
      text = next;
    }
    text = text.replace(/∼/g, '～');
    if (text !== expected) throw mappingError(context, 'traced conversion differs from OpenCC output');
    return { text, spans: mapRanges(source, text, spans, context) };
  };
}

export const simplifyBaseWithRuby = createBaseRubyConverter({
  config: OpenCC.Locale.configs.tw2s,
  convert: converter,
  expectedDigest: TW2S_DIGEST,
});
