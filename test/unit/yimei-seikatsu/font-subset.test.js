import { test } from 'node:test';
import assert from 'node:assert';
import { extractCharsets, rewriteCss, applyToFiles, NEW_FONTS } from '../../../src/core/font-subset.js';
import * as opentype from '../../../node_modules/opentype.js/dist/opentype.mjs';

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

test('applyToFiles: 删旧字体、写 2 思源子集、重写 CSS，且标题字零缺', async () => {
  const files = {
    'OEBPS/Text/chapter0001.xhtml': Buffer.from('<h3>序幕假日</h3><p>正文甲乙丙</p>'),
    'OEBPS/Text/TOC.xhtml': Buffer.from('<h3 class="ctt">目录</h3><a href="x">序幕假日</a>'),
    'OEBPS/Fonts/ch2.ttf': Buffer.from('OLD'),
    'OEBPS/Fonts/main.ttf': Buffer.from('OLD'),
    'OEBPS/Styles/necessary.css': Buffer.from('@font-face{font-family:"ch2";src:url(../Fonts/ch2.ttf);}h3{font-family:ch2,emoji,sym;}body{font-family:main,emoji,sym;}'),
  };
  await applyToFiles(files);
  assert.ok(!files['OEBPS/Fonts/ch2.ttf'] && !files['OEBPS/Fonts/main.ttf'], '旧字体应删');
  const boldFile = `OEBPS/Fonts/${NEW_FONTS.find(f=>f.role==='bold').file}`;
  const regFile = `OEBPS/Fonts/${NEW_FONTS.find(f=>f.role==='regular').file}`;
  assert.ok(files[boldFile] && files[regFile], '应写入新思源子集字体');
  assert.match(files['OEBPS/Styles/necessary.css'].toString(), /Source Han Serif SC Bold/);
  const b = files[boldFile];
  const f = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset+b.byteLength));
  for (const c of '序幕假日目录') assert.notStrictEqual(f.charToGlyphIndex(c), 0, `bold 子集缺字 ${c}`);
});
