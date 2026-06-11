import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  relocateFootnote,
  bestInRange,
  partialRatioAlignment,
} from '../../../books/yimei-seikatsu/migrate/footnote-relocator.js';

function makeFn(hostIdx, before, after, hostParaText = null) {
  const text = hostParaText ?? (before + after);
  return {
    originalId: 'note001',
    text: '注：示例',
    imgFilename: 'note.webp',
    hostParaText: text,
    hostParaIndex: hostIdx,
    supOffset: before.length,
    beforeCtx: before,
    afterCtx: after,
  };
}

// --- bestInRange 边界 ---------------------------------------------------------

test('bestInRange: lo < 0 → 自动夹到 0', () => {
  const paras = ['一年级笔记', '阅读教科书', '解答例题'];
  const [idx, score] = bestInRange('阅读教科书', paras, -5, 3);
  assert.equal(idx, 1);
  assert.equal(score, 100);
});

test('bestInRange: hi > len → 自动夹到 len', () => {
  const paras = ['开头', '中段', '结尾'];
  const [idx, score] = bestInRange('结尾', paras, 0, 99);
  assert.equal(idx, 2);
  assert.equal(score, 100);
});

test('bestInRange: 空 paras → 返回 (lo, 0)', () => {
  const [idx, score] = bestInRange('xx', [], 0, 0);
  assert.equal(idx, 0);
  assert.equal(score, 0);
});

test('bestInRange: 命中 5 段中的第 3 段', () => {
  const paras = [
    '今天天气真好',
    '苹果是红色的',
    '一年级时候的笔记本，阅读教科书',
    '香蕉是黄色的',
    '葡萄是紫色的',
  ];
  const [idx, score] = bestInRange('一年级时候的笔记本，阅读教科书', paras, 0, 5);
  assert.equal(idx, 2);
  assert.equal(score, 100);
});

test('bestInRange: skip 空字符串段', () => {
  const paras = ['', '', '中段', '', ''];
  const [idx] = bestInRange('中段', paras, 0, 5);
  assert.equal(idx, 2);
});

// --- partialRatioAlignment ----------------------------------------------------

test('partialRatioAlignment: empty needle/haystack → score=0', () => {
  assert.equal(partialRatioAlignment('', 'abc').score, 0);
  assert.equal(partialRatioAlignment('abc', '').score, 0);
});

test('partialRatioAlignment: 子串精确命中', () => {
  const r = partialRatioAlignment('教科书', '一年级阅读教科书解答例题');
  assert.equal(r.score, 100);
  assert.equal(r.destStart, 5);
});

// --- relocateFootnote ---------------------------------------------------------

test('relocateFootnote: hint 段精准命中 → HIGH @ beforeCtx 末尾', () => {
  const src = ['开头', '一年级时候的笔记本，阅读教科书解答例题', '结尾'];
  const pairs = [[0, 0], [1, 1], [2, 2]];
  const fn = makeFn(
    1,
    '一年级时候的笔记本，阅读教科书',
    '解答例题',
    '一年级时候的笔记本，阅读教科书解答例题',
  );
  const r = relocateFootnote(fn, src, pairs);
  assert.equal(r.srcParaIdx, 1);
  assert.equal(r.confidence, 'HIGH');
  assert.equal(r.srcCharOffset, '一年级时候的笔记本，阅读教科书'.length);
});

test('relocateFootnote: hint 段不匹配，窗口内 +3 段更好 → 选窗口最佳', () => {
  // hint=2，正确段在 idx=5（hint+3，仍在 +-10 窗口内）
  const src = [
    '完全不相关甲',
    '完全不相关乙',
    '差不多但不是的段落',   // hint=2
    '又一段无关',
    '别的话题',
    '一年级时候的笔记本，阅读教科书解答例题', // 真正命中
    '后续段',
  ];
  const pairs = [[2, 1]]; // dstIdx=1 → srcIdx=2 (hint)
  const fn = makeFn(
    1,
    '一年级时候的笔记本，阅读教科书',
    '解答例题',
    '一年级时候的笔记本，阅读教科书解答例题',
  );
  const r = relocateFootnote(fn, src, pairs);
  assert.equal(r.srcParaIdx, 5, `expected idx=5, got ${r.srcParaIdx}`);
  assert.equal(r.confidence, 'HIGH');
});

test('relocateFootnote: 窗口内全不匹配，全章回退命中', () => {
  // hint=0, window=[0, 11)；真正命中在 idx=20 → 触发回退
  const src = [];
  for (let i = 0; i < 25; i++) {
    if (i === 20) {
      src.push('一年级时候的笔记本，阅读教科书解答例题');
    } else {
      src.push(`完全无关段落编号${i}`);
    }
  }
  const pairs = [[0, 0]];
  const fn = makeFn(
    0,
    '一年级时候的笔记本，阅读教科书',
    '解答例题',
    '一年级时候的笔记本，阅读教科书解答例题',
  );
  const r = relocateFootnote(fn, src, pairs);
  assert.equal(r.srcParaIdx, 20);
  assert.ok(r.debugInfo.includes('fallback-full-chapter'), `debug=${r.debugInfo}`);
  assert.equal(r.confidence, 'HIGH');
});

test('relocateFootnote: 全章都不匹配 → LOW，落最佳段末', () => {
  const src = ['完全不相关甲', '完全不相关乙', '完全不相关丙'];
  const pairs = [[1, 1]];
  const fn = makeFn(
    1,
    '一年级时候的笔记本',
    '解答例题',
    '一年级时候的笔记本解答例题',
  );
  const r = relocateFootnote(fn, src, pairs);
  assert.equal(r.confidence, 'LOW');
  // LOW 时落 srcParagraphs[bestIdx] 段末
  assert.equal(r.srcCharOffset, src[r.srcParaIdx].length);
});

test('relocateFootnote: empty src → LOW', () => {
  const fn = makeFn(0, 'before', 'after');
  const r = relocateFootnote(fn, [], []);
  assert.equal(r.confidence, 'LOW');
  assert.equal(r.srcParaIdx, 0);
  assert.equal(r.srcCharOffset, 0);
});

test('relocateFootnote: empty needle → 落段末', () => {
  const src = ['开头', '一年级时候的笔记本，阅读教科书解答例题', '结尾'];
  const pairs = [[1, 1]];
  const fn = makeFn(1, '', '', '一年级时候的笔记本，阅读教科书解答例题');
  const r = relocateFootnote(fn, src, pairs);
  // 段级匹配高，confidence HIGH；但 needle 空 → 段末
  assert.equal(r.srcParaIdx, 1);
  assert.equal(r.srcCharOffset, src[1].length);
});

// --- 阈值边界（用控制段相似度精确触发） --------------------------------------

/**
 * 构造让段级 fuzz.ratio(host, src) ≈ targetScore 的两段。
 * fuzz.ratio = 2 * 公共字符数 / 总长度 * 100。
 * 用 host='A'.repeat(K) + 'X'.repeat(K)，src='A'.repeat(K) + 'Y'.repeat(K)
 * 则 ratio ≈ 50。改变比例即可改变分数。
 */
function buildPairOfRatio(commonLen, diffLen) {
  const host = 'A'.repeat(commonLen) + 'X'.repeat(diffLen);
  const src = 'A'.repeat(commonLen) + 'Y'.repeat(diffLen);
  return { host, src };
}

test('阈值: bestScore = 70 → HIGH', () => {
  // commonLen=7, diffLen=3 → ratio=2*7/(10+10)*100=70
  const { host, src } = buildPairOfRatio(7, 3);
  const fn = {
    hostParaIndex: 0,
    hostParaText: host,
    beforeCtx: 'A',
    afterCtx: 'A',
  };
  const r = relocateFootnote(fn, [src], [[0, 0]]);
  assert.equal(r.score, 70);
  assert.equal(r.confidence, 'HIGH');
});

test('阈值: bestScore = 69 → MEDIUM', () => {
  // commonLen=69, diffLen=31 → ratio=2*69/200*100=69
  const { host, src } = buildPairOfRatio(69, 31);
  const fn = {
    hostParaIndex: 0,
    hostParaText: host,
    beforeCtx: 'A',
    afterCtx: 'A',
  };
  const r = relocateFootnote(fn, [src], [[0, 0]]);
  assert.equal(r.score, 69);
  assert.equal(r.confidence, 'MEDIUM');
});

test('阈值: bestScore = 50 → MEDIUM', () => {
  // commonLen=5, diffLen=5 → ratio=2*5/20*100=50
  const { host, src } = buildPairOfRatio(5, 5);
  const fn = {
    hostParaIndex: 0,
    hostParaText: host,
    beforeCtx: 'A',
    afterCtx: 'A',
  };
  const r = relocateFootnote(fn, [src], [[0, 0]]);
  assert.equal(r.score, 50);
  assert.equal(r.confidence, 'MEDIUM');
});

test('阈值: bestScore = 49 → LOW', () => {
  // commonLen=49, diffLen=51 → ratio=2*49/200*100=49
  const { host, src } = buildPairOfRatio(49, 51);
  const fn = {
    hostParaIndex: 0,
    hostParaText: host,
    beforeCtx: 'A',
    afterCtx: 'A',
  };
  const r = relocateFootnote(fn, [src], [[0, 0]]);
  assert.equal(r.score, 49);
  assert.equal(r.confidence, 'LOW');
  assert.equal(r.srcCharOffset, src.length); // 落段末
});
