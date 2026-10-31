import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { normalizeFootnoteIds, upgradeFootnotes } from '../../../src/core/stages/footnote-fix.js';

import { buildSteraFootnote } from '../../../books/yimei-seikatsu/migrate/footnote-cleaner.js';

for (const rubyFirst of [true, false]) {
  test(`upgrade preserves every note paragraph with ruby ${rubyFirst ? 'first' : 'later'} and a full fallback`, () => {
    const ruby = '<ruby>水星<rt>Mercury &amp; &lt;reading&gt;</rt></ruby>';
    const paragraphs = rubyFirst ? `<p>${ruby}第一段。</p><p>第二段不能删除。</p>` : `<p>第一段不能删除。</p><p>${ruby}第二段。</p>`;
    const input = `<html><body><p>正文<sup><a class="calibre-footnote" href="#old_note" id="old_ref">注</a></sup>结尾</p><aside id="old_note"><ol><li>${paragraphs}</li></ol></aside></body></html>`;
    const output = upgradeFootnotes(input);
    const { document } = parseHTML(output);
    const note = document.querySelector('aside');
    assert.equal(note.querySelectorAll('p').length, 2);
    assert.equal(note.querySelector('ruby').outerHTML, ruby);
    assert.equal(note.textContent, rubyFirst ? '水星Mercury & <reading>第一段。第二段不能删除。' : '第一段不能删除。水星Mercury & <reading>第二段。');
    assert.equal(document.querySelector('img').getAttribute('zy-footnote'), rubyFirst ? '水星（Mercury & <reading>）第一段。\n第二段不能删除。' : '第一段不能删除。\n水星（Mercury & <reading>）第二段。');
    assert.equal(document.querySelector('body > p').textContent, '正文结尾');
    assert.equal(upgradeFootnotes(output), output);
  });
}

test('upgrade removes an old backlink and note prefix while preserving ruby and new fragment targets', () => {
  const input = '<html><body><p>正文<sup><a class="calibre-footnote" href="#old_note" id="old_ref">注</a></sup>结尾</p><aside id="old_note"><p><a href="#old_ref">注12</a>：<ruby>水星<rt>Mercury</rt></ruby>正文 &amp; 结尾。</p><p>后段。</p></aside></body></html>';
  const output = upgradeFootnotes(input);
  const { document } = parseHTML(output);
  assert.equal(document.querySelector('aside').textContent, '水星Mercury正文 & 结尾。后段。');
  assert.equal(document.querySelector('img').getAttribute('zy-footnote'), '水星（Mercury）正文 & 结尾。\n后段。');
  assert.doesNotMatch(output, /old_ref|注12|<p>：/);
  for (const anchor of document.querySelectorAll('a[href^="#"]')) assert.ok(document.getElementById(anchor.getAttribute('href').slice(1)));
  assert.equal(upgradeFootnotes(output), output);
});

test('normalizing IDs removes only the real duplicate attribute across quoted id text and greater-than signs', () => {
  for (const [attrs, expectedAttrs] of [
    [String.raw` title=' id="tip"' id="note001"`, String.raw` title=' id="tip"'`],
    [String.raw` title='before > id="tip"' data-other="a > b" id='note001'`, String.raw` title='before > id="tip"' data-other="a > b"`],
  ]) {
    const input = `<html><body><aside epub:type="footnote" title="aside > title" id="note001"><ol><li class="duokan-footnote-item"${attrs}><p>正文 &amp; <ruby>水星<rt>Mercury</rt></ruby></p></li></ol></aside></body></html>`;
    const expected = input.replace(attrs, expectedAttrs);
    assert.equal(normalizeFootnoteIds(input), expected);
    assert.equal(normalizeFootnoteIds(expected), expected);
    assert.equal(parseHTML(expected).document.querySelectorAll('[id="note001"]').length, 1);
  }
});

test('generated footnotes have one target per href', () => {
  const [ref, aside] = buildSteraFootnote({ body: '注释正文' }, 1);
  const { document } = parseHTML(`<html><body>${ref}${aside}</body></html>`);
  const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(document.querySelectorAll('[id="note001"]').length, 1);
});

test('upgrading old STERA duplicate targets preserves ruby, text and repeated execution', () => {
  const input = '<html><body><p>正文<sub><a class="duokan-footnote" epub:type="noteref" href="#note001" id="note_ref001"><img width="25" src="../Images/note.png" zy-footnote="水星（Mercury）"/></a></sub>结尾</p><aside epub:type="footnote" id="note001"><ol class="duokan-footnote-content" style="list-style:none"><li class="duokan-footnote-item" id="note001"><p><ruby>水星<rt>Mercury</rt></ruby></p></li></ol></aside></body></html>';
  const output = upgradeFootnotes(input);
  assert.equal((output.match(/id="note001"/g) || []).length, 1);
  assert.match(output, /<ruby>水星<rt>Mercury<\/rt><\/ruby>/);
  assert.equal(upgradeFootnotes(output), output);
  assert.equal(parseHTML(output).document.body.textContent, parseHTML(input).document.body.textContent);
});

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

test('buildSteraFootnote: V8 li keeps the aside as the sole target', () => {
  const fn = { text: '注：foo', imgFilename: 'note.webp' };
  const [, asideHtml] = buildSteraFootnote(fn, 4);
  assert.ok(
    asideHtml.includes('<li class="duokan-footnote-item">'),
    `li 不重复 aside ID，实际: ${asideHtml}`,
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
    '<li class="duokan-footnote-item">' +
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
    '<li class="duokan-footnote-item">' +
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
