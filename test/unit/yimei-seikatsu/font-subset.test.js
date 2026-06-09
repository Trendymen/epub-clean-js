import { test } from 'node:test';
import assert from 'node:assert';
import { extractCharsets, rewriteCss } from '../../../src/core/font-subset.js';

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

test('rewriteCss: 删旧 @font-face、加 2 新、family 重映射、删孤儿、去 emoji/sym fallback', () => {
  const css = [
    '@font-face{font-family:"ch2";src:url(../Fonts/ch2.ttf);}',
    '@font-face{font-family:"main";src:url(../Fonts/main.ttf);}',
    'body{font-family:main,emoji,sym;}',
    'h3{font-family:ch2,emoji,sym;}',
    '.cut{font-family:ch1,emoji,sym;}',
    '.toc a{font-family:ctt1,emoji,sym;}',
    '.illus1{font-family:illus1;}',
    'nav,nav *{font-family:initial !important;}',
  ].join('');
  const out = rewriteCss(css);
  assert.ok(!out.includes('Fonts/ch2.ttf') && !out.includes('Fonts/main.ttf'), '旧字体 url 应删');
  assert.ok(out.includes('SourceHanSerifSC-Regular.subset.otf'), '缺新 Regular @font-face');
  assert.ok(out.includes('SourceHanSerifSC-Bold.subset.otf'), '缺新 Bold @font-face');
  assert.match(out, /body\{font-family:"Source Han Serif SC"\}/);
  assert.match(out, /h3\{font-family:"Source Han Serif SC Bold"\}/);
  assert.match(out, /\.cut\{font-family:"Source Han Serif SC Bold"\}/);
  assert.match(out, /\.toc a\{font-family:"Source Han Serif SC Bold"\}/);
  assert.ok(!/illus1;|font-family:illus1/.test(out), '.illus1 孤儿 font-family 应删');
  assert.match(out, /font-family:initial/);
  assert.ok(!/emoji|sym/.test(out.replace(/Source Han[^"]*/g, '')), 'emoji/sym fallback 应去除');
});
