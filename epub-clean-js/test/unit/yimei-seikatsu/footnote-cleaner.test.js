import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSteraFootnote } from '../../../books/yimei-seikatsu/migrate/footnote-cleaner.js';

test('buildSteraFootnote: basic', () => {
  const fn = {
    originalId: 'note005',
    text: '注：测试',
    imgFilename: 'note.webp',
    hostParaText: 'abc',
    hostParaIndex: 0,
    supOffset: 1,
    beforeCtx: 'a',
    afterCtx: 'bc',
  };
  const [refHtml, asideHtml] = buildSteraFootnote(fn, 1);

  assert.ok(refHtml.includes('class="duokan-footnote"'));
  assert.ok(refHtml.includes('epub:type="noteref"'));
  assert.ok(refHtml.includes('href="#note001"'));
  assert.ok(refHtml.includes('id="note_ref001"'));
  assert.ok(refHtml.includes('src="../Images/note.webp"'));
  assert.ok(refHtml.includes('zy-footnote="注：测试"'));

  assert.ok(asideHtml.includes('id="note001"'));
  assert.ok(asideHtml.includes('epub:type="footnote"'));
  // V8：aside 内不再含 "<a href="#note_refNNN">注N</a>：" 前缀
  assert.ok(!asideHtml.includes('href="#note_ref001"'));
  assert.ok(!asideHtml.includes('<a href="#note_ref'));
  assert.ok(asideHtml.includes('class="duokan-footnote-content"'));
  assert.ok(!refHtml.includes('calibre'));
  assert.ok(!asideHtml.includes('pcalibre'));
  assert.ok(!asideHtml.includes('calibre'));
});

test('buildSteraFootnote: preserves note1.webp', () => {
  const fn = {
    originalId: 'note002',
    text: '评：吐槽',
    imgFilename: 'note1.webp',
    hostParaText: 'x',
    hostParaIndex: 0,
    supOffset: 0,
    beforeCtx: '',
    afterCtx: 'x',
  };
  const [refHtml] = buildSteraFootnote(fn, 2);
  assert.ok(refHtml.includes('src="../Images/note1.webp"'));
});

// === V8 多端兼容格式专项校验（与 Python build_stera_footnote 完全一致）===

test('buildSteraFootnote: V8 ref uses <sub> not <sup>', () => {
  const fn = { text: '注：foo', imgFilename: 'note.webp' };
  const [refHtml] = buildSteraFootnote(fn, 1);
  assert.ok(refHtml.startsWith('<sub>'), `ref 应以 <sub> 开头，实际: ${refHtml}`);
  assert.ok(refHtml.endsWith('</sub>'), `ref 应以 </sub> 结尾，实际: ${refHtml}`);
  assert.ok(!refHtml.includes('<sup>'), 'ref 不应包含 <sup>');
  assert.ok(!refHtml.includes('</sup>'), 'ref 不应包含 </sup>');
});

test('buildSteraFootnote: V8 img has width="25"', () => {
  const fn = { text: '注：foo', imgFilename: 'note.webp' };
  const [refHtml] = buildSteraFootnote(fn, 3);
  assert.ok(refHtml.includes('width="25"'), `img 应含 width="25"，实际: ${refHtml}`);
});

test('buildSteraFootnote: V8 ol has style="list-style:none"', () => {
  const fn = { text: '注：foo', imgFilename: 'note.webp' };
  const [, asideHtml] = buildSteraFootnote(fn, 1);
  assert.ok(
    asideHtml.includes('<ol class="duokan-footnote-content" style="list-style:none">'),
    `ol 应含 style="list-style:none"，实际: ${asideHtml}`,
  );
});

test('buildSteraFootnote: V8 aside top-level is <ol>, no empty back-anchor', () => {
  const fn = { text: '注：foo', imgFilename: 'note.webp' };
  const [, asideHtml] = buildSteraFootnote(fn, 7);
  // aside 打开标签后必须直接是 <ol>，不允许出现 <a href="#note_ref007"></a><ol>
  assert.ok(
    asideHtml.startsWith('<aside epub:type="footnote" id="note007"><ol'),
    `aside 顶层应直接是 <ol>，实际: ${asideHtml}`,
  );
  assert.ok(
    !asideHtml.includes('<a href="#note_ref007"></a>'),
    `aside 不应包含空反向锚点，实际: ${asideHtml}`,
  );
});

test('buildSteraFootnote: V8 li uses id="noteNNN" not value="NNN"', () => {
  const fn = { text: '注：foo', imgFilename: 'note.webp' };
  const [, asideHtml] = buildSteraFootnote(fn, 4);
  assert.ok(
    asideHtml.includes('<li class="duokan-footnote-item" id="note004">'),
    `li 应用 id="note004"，实际: ${asideHtml}`,
  );
  assert.ok(!asideHtml.includes('value="004"'), 'li 不应含 value="004"');
  assert.ok(!asideHtml.includes('value="4"'), 'li 不应含 value="4"');
});

test('buildSteraFootnote: V8 li 内 <p> 直接含正文，无 "注N：" 反向链接前缀', () => {
  const fn = { text: '正文内容', imgFilename: 'note.webp' };
  const [, asideHtml] = buildSteraFootnote(fn, 5);
  // V8：li 内 <p> 直接是正文，无 <a href="#note_ref005">注5</a>： 前缀
  assert.ok(
    asideHtml.includes('<p>正文内容</p>'),
    `p 应直接含正文，实际: ${asideHtml}`,
  );
  assert.ok(
    !asideHtml.includes('<a href="#note_ref005">'),
    `p 不应含反向链接，实际: ${asideHtml}`,
  );
  assert.ok(!asideHtml.includes('注5</a>'), 'p 不应含 "注5</a>" 反向链接文本');
});

test('buildSteraFootnote: V8 注：xxx uses note.webp', () => {
  const fn = { text: '注：解释一段术语', imgFilename: 'note.webp' };
  const [refHtml] = buildSteraFootnote(fn, 1);
  assert.ok(refHtml.includes('src="../Images/note.webp"'));
  assert.ok(!refHtml.includes('note1.webp'));
});

test('buildSteraFootnote: V8 评：xxx uses note1.webp', () => {
  const fn = { text: '评：这里是吐槽', imgFilename: 'note1.webp' };
  const [refHtml] = buildSteraFootnote(fn, 1);
  assert.ok(refHtml.includes('src="../Images/note1.webp"'));
});

test('buildSteraFootnote: V8 完整结构 snapshot (注：foo, N=1)', () => {
  const fn = { text: '注：foo', imgFilename: 'note.webp' };
  const [refHtml, asideHtml] = buildSteraFootnote(fn, 1);

  const expectedRef =
    '<sub><a class="duokan-footnote" epub:type="noteref" ' +
    'href="#note001" id="note_ref001">' +
    '<img width="25" alt="note" class="zhangyue-footnote" ' +
    'src="../Images/note.webp" ' +
    'zy-footnote="注：foo"/></a></sub>';
  assert.equal(refHtml, expectedRef);

  // V8：li 内 <p>正文</p>，无反向链接前缀
  const expectedAside =
    '<aside epub:type="footnote" id="note001">' +
    '<ol class="duokan-footnote-content" style="list-style:none">' +
    '<li class="duokan-footnote-item" id="note001">' +
    '<p>注：foo</p>' +
    '</li>' +
    '</ol>' +
    '</aside>';
  assert.equal(asideHtml, expectedAside);
});

test('buildSteraFootnote: V8 完整结构 snapshot (评：bar, N=2)', () => {
  const fn = { text: '评：bar', imgFilename: 'note1.webp' };
  const [refHtml, asideHtml] = buildSteraFootnote(fn, 2);

  const expectedRef =
    '<sub><a class="duokan-footnote" epub:type="noteref" ' +
    'href="#note002" id="note_ref002">' +
    '<img width="25" alt="note" class="zhangyue-footnote" ' +
    'src="../Images/note1.webp" ' +
    'zy-footnote="评：bar"/></a></sub>';
  assert.equal(refHtml, expectedRef);

  const expectedAside =
    '<aside epub:type="footnote" id="note002">' +
    '<ol class="duokan-footnote-content" style="list-style:none">' +
    '<li class="duokan-footnote-item" id="note002">' +
    '<p>评：bar</p>' +
    '</li>' +
    '</ol>' +
    '</aside>';
  assert.equal(asideHtml, expectedAside);
});

// === opts 自定义图标 ===

test('buildSteraFootnote: opts.iconRegular="note.png" 覆盖默认图标', () => {
  const fn = { text: '注：测试', imgFilename: 'note.webp' };
  const [refHtml] = buildSteraFootnote(fn, 1, { iconRegular: 'note.png' });
  assert.ok(
    refHtml.includes('src="../Images/note.png"'),
    `ref 应含 src="../Images/note.png"，实际: ${refHtml}`,
  );
  assert.ok(!refHtml.includes('note.webp'), 'ref 不应含 note.webp（已被 opts 覆盖）');
});

test('buildSteraFootnote: opts.iconReview="note.png" 覆盖评论图标', () => {
  const fn = { text: '评：吐槽', imgFilename: 'note1.webp' };
  const [refHtml] = buildSteraFootnote(fn, 1, { iconReview: 'note.png' });
  assert.ok(
    refHtml.includes('src="../Images/note.png"'),
    `ref 应含 src="../Images/note.png"，实际: ${refHtml}`,
  );
  assert.ok(!refHtml.includes('note1.webp'), 'ref 不应含 note1.webp（已被 opts 覆盖）');
});

test('buildSteraFootnote: opts.iconPathPrefix="../images/" 覆盖路径前缀', () => {
  const fn = { text: '注：测试', imgFilename: 'note.webp' };
  const [refHtml] = buildSteraFootnote(fn, 1, {
    iconRegular: 'note.png',
    iconPathPrefix: '../images/',
  });
  assert.ok(
    refHtml.includes('src="../images/note.png"'),
    `ref 应含 src="../images/note.png"，实际: ${refHtml}`,
  );
});

test('buildSteraFootnote: fn.body 优先于 fn.text', () => {
  const fn = { body: '从 body 来', text: '从 text 来', imgFilename: 'note.webp' };
  const [refHtml, asideHtml] = buildSteraFootnote(fn, 1);
  assert.ok(refHtml.includes('zy-footnote="从 body 来"'));
  assert.ok(asideHtml.includes('<p>从 body 来</p>'));
});
