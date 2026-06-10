import { test } from 'node:test';
import assert from 'node:assert';
import { extractCharsets, rewriteCss, applyToFiles, NEW_FONTS } from '../../../src/core/font-subset.js';
import * as opentype from '../../../node_modules/opentype.js/dist/opentype.mjs';

const ALL_ROLES = ['sansRegular', 'serifLight', 'serifMedium', 'serifSemiBold', 'serifBold', 'serifBoldSub'];

test('extractCharsets: 按 6 路字面分桶收字', () => {
  const xhtmlList = [
    { name: 'OEBPS/Text/chapter0001.xhtml', text: '<h3>序幕假日</h3><p>正文甲乙</p><h4>分隔丙</h4><h5>细题丁</h5><li class="duokan-footnote-item"><p>注释壬</p></li>' },
    { name: 'OEBPS/Text/TOC.xhtml', text: '<h3 class="ctt">大题辛</h3><div class="toc"><a href="x">目录条己</a><p class="ctit">目录细庚</p></div>' },
    { name: 'OEBPS/Text/chapter0002.xhtml', text: '<div class="cut">场景戊</div>' },
  ];
  const cs = extractCharsets(xhtmlList);
  // 正文黑 Regular：全文兜底
  for (const c of '序幕假日正文甲乙分隔丙细题丁目录条己目录细庚场景戊大题辛注释壬') assert.ok(cs.sansRegular.has(c), `sansRegular 缺 ${c}`);
  // 宋 Bold（合成加粗链）：h3/.ch2 章节标题 + h4/.cut/.ch1 分隔标题
  for (const c of '序幕假日分隔丙场景戊') assert.ok(cs.serifBold.has(c), `serifBold 缺 ${c}`);
  assert.ok(!cs.serifBold.has('正'), 'serifBold 不应含正文字');
  // 纯宋 Bold（抑制合成）：h5/.ch3 副标题链
  for (const c of '细题丁') assert.ok(cs.serifBoldSub.has(c), `serifBoldSub 缺 ${c}`);
  assert.ok(!cs.serifBoldSub.has('正'), 'serifBoldSub 不应含正文字');
  assert.ok(!cs.serifBoldSub.has('序'), 'serifBoldSub 不应含 h3 章节标题字');
  // 宋 SemiBold：目录条目（TOC 整页）
  for (const c of '目录条己') assert.ok(cs.serifSemiBold.has(c), `serifSemiBold 缺 ${c}`);
  // 宋 Medium：note/.duokan-footnote-item 注释链
  for (const c of '注释壬') assert.ok(cs.serifMedium.has(c), `serifMedium 缺 ${c}`);
  assert.ok(!cs.serifMedium.has('正'), 'serifMedium 不应含正文字');
  // 宋 Light：目录大标题 .ctt/.ctt2/.ctit（TOC 整页兜底）
  for (const c of '大题辛目录细庚') assert.ok(cs.serifLight.has(c), `serifLight 缺 ${c}`);
  assert.ok(!cs.serifLight.has('正'), 'serifLight 不应含正文字');
});

test('extractCharsets: 非汉字符号并入每个输出子集', () => {
  const cs = extractCharsets([{ name: 'OEBPS/Text/chapter0001.xhtml', text: '<p>正文，。！A1</p>' }]);
  for (const c of '，。！A1') {
    for (const role of ALL_ROLES) {
      assert.ok(cs[role].has(c), `${role} 缺符号 ${c}`);
    }
  }
});

test('extractCharsets: style/script 块内容不计入用字', () => {
  const cs = extractCharsets([{
    name: 'OEBPS/Text/TOC.xhtml',
    text: '<head><style>.toc a{font-family:"Q字体W";}</style><script>var Z="X";</script></head><body><p>正文</p></body>',
  }]);
  for (const c of 'QWZX"') assert.ok(!cs.sansRegular.has(c), `style/script 字符 ${c} 不应入集`);
  assert.ok(cs.sansRegular.has('正'), '真实正文字仍应入集');
});

test('rewriteCss: 删旧 @font-face、加 6 新、family 按实证字重重映射', () => {
  const css = [
    '@font-face{font-family:"ch2";src:url(../Fonts/ch2.ttf);}',
    '@font-face{font-family:"main";src:url(../Fonts/main.ttf);}',
    'body{font-family:main,emoji,sym;}',
    '.summary{font-family:sum,emoji,sym;}',
    '.message{font-family:mes,emoji,sym;}',
    '.duokan-footnote-item{font-family:note,emoji,sym;}',
    '.title{font-family:title,main,emoji,sym;}',
    'table{font-family:int,emoji,sym;}',
    'h3{font-family:ch2,emoji,sym;}',
    '.cut{font-family:ch1,emoji,sym;}',
    '.toc a{font-family:ctt1,emoji,sym;}',
    'h5{font-family:ch3,emoji,sym;}',
    '.toc .ctit{font-family:ctt2,emoji,sym;}',
    '.ctt{font-family:cont,emoji,sym;}',
    '.illus1{font-family:illus1;}',
    'nav,nav *{font-family:initial !important;}',
  ].join('');
  const out = rewriteCss(css);
  assert.ok(!out.includes('Fonts/ch2.ttf') && !out.includes('Fonts/main.ttf'), '旧字体 url 应删');
  assert.ok(out.includes('SourceHanSansSC-Regular.subset.otf'), '缺新 Sans Regular @font-face');
  assert.ok(out.includes('SourceHanSerifSC-Light.subset.otf'), '缺新 Serif Light @font-face');
  assert.ok(out.includes('SourceHanSerifSC-Medium.subset.otf'), '缺新 Serif Medium @font-face');
  assert.ok(out.includes('SourceHanSerifSC-SemiBold.subset.otf'), '缺新 Serif SemiBold @font-face');
  assert.ok(out.includes('SourceHanSerifSC-Bold.subset.otf'), '缺新 Serif Bold @font-face');
  assert.ok(out.includes('SourceHanSerifSC-BoldSub.subset.otf'), '缺新 Serif Bold Sub @font-face');
  assert.ok(!out.includes('SourceHanSansSC-Bold'), '黑 Bold 面已无角色使用，不应再输出');
  assert.ok(!out.includes('SourceHanSerifSC-Heavy'), '宋 Heavy 面已无角色使用，不应再输出');
  // 仅副标题 Bold Sub 面声明 font-weight:bold 以抑制合成（渲染纯 Bold，落在 SemiBold+合成 与 Bold+合成 之间）；
  // 其余面维持无声明（对齐日翻合成加粗行为）
  assert.match(out, /@font-face\{font-family:"Source Han Serif SC Bold Sub";font-weight:bold;/, 'Bold Sub 面应声明 font-weight:bold 抑制合成加粗');
  const otherFaces = (out.match(/@font-face\{[^}]*\}/g) ?? []).filter((f) => !f.includes('Bold Sub'));
  assert.strictEqual(otherFaces.length, 5, '应有 5 个非 Bold Sub @font-face');
  for (const face of otherFaces) assert.ok(!face.includes('font-weight'), `非 Bold Sub 面不应声明 font-weight: ${face}`);
  assert.match(out, /body\{font-family:"Source Han Sans SC"\}/);
  assert.match(out, /\.summary\{font-family:"Source Han Sans SC"\}/);
  assert.match(out, /\.message\{font-family:"Source Han Sans SC"\}/);
  assert.match(out, /\.duokan-footnote-item\{font-family:"Source Han Serif SC Medium"\}/, 'note 注释链实证为宋 Medium');
  assert.match(out, /\.title\{font-family:"Source Han Sans SC"\}/);
  assert.match(out, /table\{font-family:"Source Han Sans SC"\}/);
  assert.match(out, /h3\{font-family:"Source Han Serif SC Bold"\}/);
  assert.match(out, /\.cut\{font-family:"Source Han Serif SC Bold"\}/, 'ch1 分隔标题链与 h3 同走宋 Bold+合成');
  assert.match(out, /\.toc a\{font-family:"Source Han Serif SC SemiBold"\}/);
  assert.match(out, /h5\{font-family:"Source Han Serif SC Bold Sub"\}/, 'ch3 副标题链走纯宋 Bold（抑制合成）');
  assert.match(out, /\.toc \.ctit\{font-family:"Source Han Serif SC Light"\}/);
  assert.match(out, /\.ctt\{font-family:"Source Han Serif SC Light"\}/, 'cont（13 卷目录标题链）应归宋 Light');
  assert.ok(!/illus1;|font-family:illus1/.test(out), '.illus1 孤儿 font-family 应删');
  assert.match(out, /font-family:initial/);
  assert.ok(!/emoji|sym/.test(out.replace(/Source Han[^"]*/g, '')), 'emoji/sym fallback 应去除');
});

test('rewriteCss: 有 @import 时必须保持 @import 在 @font-face 之前', () => {
  const css = [
    '/*虚空文学旅团STERAePub++*/',
    '@import "default.css";',
    '@import "necessary.css";',
    '/*虚空文学旅团STERAePub++*/',
  ].join('\n');
  const out = rewriteCss(css);
  const importDefault = out.indexOf('@import "default.css";');
  const importNecessary = out.indexOf('@import "necessary.css";');
  const fontFace = out.indexOf('@font-face{font-family:"Source Han Sans SC"');
  assert.notStrictEqual(importDefault, -1, 'default.css import 不应丢失');
  assert.notStrictEqual(importNecessary, -1, 'necessary.css import 不应丢失');
  assert.notStrictEqual(fontFace, -1, '应注入新 @font-face');
  assert.ok(importDefault < fontFace, '@import default.css 必须排在 @font-face 前');
  assert.ok(importNecessary < fontFace, '@import necessary.css 必须排在 @font-face 前');
});

test('rewriteCss: 二次处理已重写 Source Han family 时保持幂等', () => {
  const css = [
    '@font-face{font-family:"Source Han Sans SC";src:url(../Fonts/SourceHanSansSC-Regular.subset.otf);}',
    'body{font-family:"Source Han Sans SC"}',
    'h3{font-family:"Source Han Serif SC Bold"}',
    'h5{font-family:"Source Han Serif SC Bold Sub"}',
    '.duokan-footnote-item{font-family:"Source Han Serif SC Medium"}',
    '.toc .ctit{font-family:"Source Han Serif SC Light"}',
  ].join('');
  const out = rewriteCss(css);
  assert.match(out, /body\{font-family:"Source Han Sans SC"\}/);
  assert.match(out, /h3\{font-family:"Source Han Serif SC Bold"\}/);
  assert.match(out, /h5\{font-family:"Source Han Serif SC Bold Sub"\}/);
  assert.match(out, /\.duokan-footnote-item\{font-family:"Source Han Serif SC Medium"\}/);
  assert.match(out, /\.toc \.ctit\{font-family:"Source Han Serif SC Light"\}/);
  assert.strictEqual((out.match(/@font-face/g) ?? []).length, 6, '二次处理后仍应只有 6 个 @font-face');
});

test('applyToFiles: 删旧字体、写 6 思源子集、重写 CSS 与 xhtml 内联 <style>，且分角色零缺字', async () => {
  const tocInlineStyle = '<style>\n .ctt{font-family:ctt2,emoji,sym;font-weight:bold;}.toc a{display:block;font-family:ctt1,emoji,sym;}\n </style>';
  const files = {
    'OEBPS/Text/chapter0001.xhtml': Buffer.from('<h3>序幕假日</h3><p>正文甲乙丙</p><h4>分隔戊</h4><h5>细题丁</h5><li class="duokan-footnote-item"><p>注释壬</p></li>'),
    'OEBPS/Text/TOC.xhtml': Buffer.from(`<html><head>${tocInlineStyle}</head><body><h3 class="ctt">大题辛</h3><div class="toc"><a href="x">序幕假日</a><p class="ctit">目录细庚</p></div></body></html>`),
    'OEBPS/Fonts/ch2.ttf': Buffer.from('OLD'),
    'OEBPS/Fonts/main.ttf': Buffer.from('OLD'),
    'OEBPS/Styles/necessary.css': Buffer.from('@font-face{font-family:"ch2";src:url(../Fonts/ch2.ttf);}h3{font-family:ch2,emoji,sym;}body{font-family:main,emoji,sym;}h4{font-family:ch1,emoji,sym;}h5{font-family:ch3,emoji,sym;}.toc .ctit{font-family:ctt2,emoji,sym;}.duokan-footnote-item{font-family:note,emoji,sym;}'),
    'OEBPS/content.opf': Buffer.from('<package><manifest><item id="main" href="Fonts/main.ttf" media-type="font/ttf"/><item id="ch2" href="Fonts/ch2.ttf" media-type="font/ttf"/><item id="css" href="Styles/necessary.css" media-type="text/css"/></manifest></package>'),
  };
  await applyToFiles(files);
  assert.ok(!files['OEBPS/Fonts/ch2.ttf'] && !files['OEBPS/Fonts/main.ttf'], '旧字体应删');
  const fileOf = (role) => `OEBPS/Fonts/${NEW_FONTS.find((f) => f.role === role).file}`;
  for (const role of ALL_ROLES) {
    assert.ok(files[fileOf(role)], `应写入 ${role} 思源子集字体`);
  }
  const css = files['OEBPS/Styles/necessary.css'].toString();
  assert.match(css, /h3\{font-family:"Source Han Serif SC Bold"\}/);
  assert.match(css, /h4\{font-family:"Source Han Serif SC Bold"\}/);
  assert.match(css, /h5\{font-family:"Source Han Serif SC Bold Sub"\}/);
  assert.match(css, /\.duokan-footnote-item\{font-family:"Source Han Serif SC Medium"\}/);
  assert.match(css, /\.toc \.ctit\{font-family:"Source Han Serif SC Light"\}/);

  // xhtml 内联 <style> 也必须被重映射（family 重写 + 不注入 @font-face）
  const toc = files['OEBPS/Text/TOC.xhtml'].toString();
  assert.match(toc, /\.toc a\{[^}]*font-family:"Source Han Serif SC SemiBold"/, '内联 .toc a 应映射宋 SemiBold');
  assert.match(toc, /\.ctt\{[^}]*font-family:"Source Han Serif SC Light"/, '内联 .ctt 应映射宋 Light');
  assert.ok(!toc.includes('font-family:ctt1') && !toc.includes('font-family:ctt2'), '内联旧 token 应清零');
  assert.ok(!toc.includes('@font-face'), '内联 <style> 不应注入 @font-face');

  const parseFont = (buf) => opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const serifBold = parseFont(files[fileOf('serifBold')]);
  for (const c of '序幕假日分隔戊') assert.notStrictEqual(serifBold.charToGlyphIndex(c), 0, `serifBold 子集缺字 ${c}`);
  const serifBoldSub = parseFont(files[fileOf('serifBoldSub')]);
  for (const c of '细题丁') assert.notStrictEqual(serifBoldSub.charToGlyphIndex(c), 0, `serifBoldSub 子集缺字 ${c}`);
  const serifMedium = parseFont(files[fileOf('serifMedium')]);
  for (const c of '注释壬') assert.notStrictEqual(serifMedium.charToGlyphIndex(c), 0, `serifMedium 子集缺字 ${c}`);
  const sansRegular = parseFont(files[fileOf('sansRegular')]);
  for (const c of '正文甲乙丙') assert.notStrictEqual(sansRegular.charToGlyphIndex(c), 0, `sansRegular 子集缺字 ${c}`);
  const serifSemiBold = parseFont(files[fileOf('serifSemiBold')]);
  for (const c of '序幕假日') assert.notStrictEqual(serifSemiBold.charToGlyphIndex(c), 0, `serifSemiBold 子集缺字 ${c}`);
  const serifLight = parseFont(files[fileOf('serifLight')]);
  for (const c of '大题辛目录细庚') assert.notStrictEqual(serifLight.charToGlyphIndex(c), 0, `serifLight 子集缺字 ${c}`);

  const opf = files['OEBPS/content.opf'].toString();
  assert.doesNotMatch(opf, /Fonts\/(?:main|ch2)\.ttf/);
  for (const def of NEW_FONTS) assert.match(opf, new RegExp(`Fonts/${def.file.replace(/\./g, '\\.')}`));
  assert.strictEqual((opf.match(/media-type="font\/otf"/g) ?? []).length, 6);
});
