import { test } from 'node:test';
import assert from 'node:assert/strict';

import { alignParagraphs } from '../../../books/yimei-seikatsu/migrate/aligner.js';

test('alignParagraphs: equal length perfect match', () => {
  const src = ['第一段', '第二段', '第三段'];
  const dst = ['第一段', '第二段', '第三段'];
  const pairs = alignParagraphs(src, dst);
  assert.deepEqual(pairs, [[0, 0], [1, 1], [2, 2]]);
});

test('alignParagraphs: paraphrased translation', () => {
  const src = ['拖着大行李箱的老爸', '亚季子小姐说', '再见'];
  const dst = ['拖着大号行李箱的老爸', '亚纪子阿姨说', '再见'];
  const pairs = alignParagraphs(src, dst);
  assert.deepEqual(pairs, [[0, 0], [1, 1], [2, 2]]);
});

test('alignParagraphs: dst extra paragraph', () => {
  const src = ['一', '二', '三'];
  const dst = ['一', '二A', '二B', '三'];
  const pairs = alignParagraphs(src, dst);
  assert.deepEqual(pairs[0], [0, 0]);
  assert.deepEqual(pairs[pairs.length - 1], [2, 3]);
});

test('alignParagraphs: src extra paragraph', () => {
  const src = ['一', '二', '三', '四'];
  const dst = ['一', '二', '四'];
  const pairs = alignParagraphs(src, dst);
  assert.deepEqual(pairs[0], [0, 0]);
  assert.deepEqual(pairs[pairs.length - 1], [3, 2]);
});
