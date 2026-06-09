import { test } from 'node:test';
import assert from 'node:assert';
import { extractCharsets } from '../../../src/core/font-subset.js';

test('extractCharsets: regular 收全字符，bold 收 h3/h4/目录/.cut', () => {
  const xhtmlList = [
    { name: 'OEBPS/Text/chapter0001.xhtml', text: '<h3>序幕假日</h3><p>正文甲乙</p><h4>分隔丙</h4>' },
    { name: 'OEBPS/Text/TOC.xhtml', text: '<a href="x">目录条丁</a>' },
    { name: 'OEBPS/Text/chapter0002.xhtml', text: '<div class="cut">场景戊</div>' },
  ];
  const cs = extractCharsets(xhtmlList);
  for (const c of '序幕假日正文甲乙分隔丙目录条丁场景戊') assert.ok(cs.regular.has(c), `regular 缺 ${c}`);
  for (const c of '序幕假日目录条丁') assert.ok(cs.bold.has(c), `bold 缺 ${c}`);
  assert.ok(!cs.bold.has('正'), 'bold 不应含正文字');
  for (const c of '分隔丙场景戊') assert.ok(cs.bold.has(c), `bold 缺 ${c}`);
});

test('extractCharsets: 非汉字符号并入 bold', () => {
  const cs = extractCharsets([{ name: 'OEBPS/Text/chapter0001.xhtml', text: '<p>正文，。！A1</p>' }]);
  for (const c of '，。！A1') assert.ok(cs.bold.has(c), `bold 缺符号 ${c}`);
});
