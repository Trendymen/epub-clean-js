import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { normalizeFootnoteIds, upgradeFootnotes } from '../../../src/core/stages/footnote-fix.js';

import { buildSteraFootnote } from '../../../books/yimei-seikatsu/migrate/footnote-cleaner.js';

for (const withRuby of [false, true]) {
  test(`upgrade shares one note for repeated references ${withRuby ? 'with ruby' : 'without ruby'} and preserves child targets`, () => {
    const text = withRuby ? '<ruby>水星<rt>Mercury</rt></ruby>解释。' : '脚注详情。';
    const input = `<html><body><p>正文<a class="calibre-footnote" href="#old" id="r1">注</a>后文<a class="calibre-footnote" href="#old" id="r2">注</a></p><a href="#detail">解释详情</a><a href="#r2">回引用</a><aside id="old"><p><a href="#r2"><span>注2：</span></a><span id="detail">${text}</span></p></aside></body></html>`;
    const output = upgradeFootnotes(input);
    const { document } = parseHTML(output);
    const refs = [...document.querySelectorAll('body > p a')];
    assert.equal(document.querySelectorAll('aside').length, 1);
    assert.equal(document.querySelectorAll('[id="detail"]').length, 1);
    assert.equal(new Set(refs.map((a) => a.id)).size, 2);
    assert.equal(new Set(refs.map((a) => a.getAttribute('href'))).size, 1);
    assert.equal(document.querySelector('aside').textContent, withRuby ? '水星Mercury解释。' : '脚注详情。');
    assert.deepEqual(refs.map((a) => a.querySelector('img').getAttribute('zy-footnote')), [withRuby ? '水星（Mercury）解释。' : '脚注详情。', withRuby ? '水星（Mercury）解释。' : '脚注详情。']);
    for (const a of document.querySelectorAll('a[href^="#"]')) assert.ok(document.getElementById(a.getAttribute('href').slice(1)));
    assert.doesNotMatch(output, /注2|href="#r2"/);
    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
    assert.equal(ids.length, new Set(ids).size);
    assert.equal(upgradeFootnotes(output), output);
  });
}

for (const paragraphTarget of [false, true]) {
  test(`upgrade keeps each note's content in a shared aside with ${paragraphTarget ? 'paragraph' : 'li'} targets`, () => {
    const firstTarget = paragraphTarget ? 'first_para' : 'first_note';
    const secondTarget = paragraphTarget ? 'second_para' : 'second_note';
    const input = `<html><body><p>正文<sup><a class="calibre-footnote" href="#${firstTarget}" id="first_ref">注</a></sup><sup><a class="calibre-footnote" href="#${secondTarget}" id="second_ref">注</a></sup>结尾</p><aside id="notes"><ol><li id="first_note"><p id="first_para"><ruby>水星<rt>Mercury</rt></ruby>第一条注释。</p><p>第一条后段。</p></li><li id="second_note"><p id="second_para"><ruby>金星<rt>Venus</rt></ruby>第二条注释。</p><p>第二条后段。</p></li><li id="untouched"><p>未引用的第三条仍保留。</p></li></ol></aside></body></html>`;
    const output = upgradeFootnotes(input);
    const { document } = parseHTML(output);
    const refs = [...document.querySelectorAll('body > p a')];
    const targets = refs.map((a) => document.getElementById(a.getAttribute('href').slice(1)));
    assert.deepEqual(targets.map((target) => target.textContent), ['水星Mercury第一条注释。第一条后段。', '金星Venus第二条注释。第二条后段。']);
    assert.deepEqual(targets.map((target) => target.querySelector('ruby').outerHTML), ['<ruby>水星<rt>Mercury</rt></ruby>', '<ruby>金星<rt>Venus</rt></ruby>']);
    assert.deepEqual(refs.map((a) => a.querySelector('img').getAttribute('zy-footnote')), ['水星（Mercury）第一条注释。\n第一条后段。', '金星（Venus）第二条注释。\n第二条后段。']);
    assert.equal(document.getElementById('untouched').textContent, '未引用的第三条仍保留。');
    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
    assert.equal(ids.length, new Set(ids).size);
    for (const a of document.querySelectorAll('a[href^="#"]')) assert.ok(document.getElementById(a.getAttribute('href').slice(1)));
    assert.equal(upgradeFootnotes(output), output);
  });
}

test('upgrade retains referenced child IDs and links in an ordinary single-paragraph note', () => {
  const input = '<html><body><p>正文<sup><a class="calibre-footnote" href="#old_note" id="old_ref">注</a></sup>结尾</p><a href="#detail">查看解释</a><p id="old_note"><span id="detail">脚注详情。</span><a href="#body_detail">正文链接</a></p><p id="body_detail">保留正文。</p></body></html>';
  const output = upgradeFootnotes(input);
  const { document } = parseHTML(output);
  assert.ok(document.getElementById('detail'), '移动普通脚注后应保留子目标 detail');
  assert.equal(document.getElementById('detail').textContent, '脚注详情。');
  assert.equal(document.querySelector('aside a').textContent, '正文链接');
  assert.equal(document.querySelector('aside').textContent, '脚注详情。正文链接');
  assert.equal(document.querySelector('img').getAttribute('zy-footnote'), '脚注详情。正文链接');
  for (const a of document.querySelectorAll('a[href^="#"]')) assert.ok(document.getElementById(a.getAttribute('href').slice(1)));
  const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(upgradeFootnotes(output), output);
});

test('upgrading paragraph targets preserves ruby and remaps links across multiple reordered note IDs', () => {
  const input = '<html><body><p>正文<sup><a class="calibre-footnote" href="#note003" id="old_a">注</a></sup><sup><a class="calibre-footnote" href="#note001" id="old_b">注</a></sup><sup><a class="calibre-footnote" href="#note002" id="old_c">注</a></sup>结尾</p><nav><a href="#note003">第一注</a><a href="#note001">第二注</a><a href="#note002">第三注</a></nav><p id="note003"><ruby>水星<rt>Mercury</rt></ruby>第一注。</p><aside id="old_container"><p id="note001"><ruby>金星<rt>Venus</rt></ruby>第二注。</p><p id="retained_detail">后段。</p></aside><p id="note002"><ruby>地球<rt>Earth</rt></ruby>第三注。</p></body></html>';
  const output = upgradeFootnotes(input);
  const { document } = parseHTML(output);
  const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
  assert.equal(ids.length, new Set(ids).size);
  for (const anchor of document.querySelectorAll('a[href^="#"]')) assert.ok(document.getElementById(anchor.getAttribute('href').slice(1)));
  assert.deepEqual([...document.querySelectorAll('nav a')].map((a) => document.getElementById(a.getAttribute('href').slice(1)).textContent), ['水星Mercury第一注。', '金星Venus第二注。后段。', '地球Earth第三注。']);
  assert.equal(document.querySelectorAll('ruby').length, 3);
  assert.equal(document.querySelector('body > p').textContent, '正文结尾');
  assert.deepEqual([...document.querySelectorAll('img')].map((img) => img.getAttribute('zy-footnote')), ['水星（Mercury）第一注。', '金星（Venus）第二注。\n后段。', '地球（Earth）第三注。']);
  assert.equal(upgradeFootnotes(output), output);
});

test('upgrading notes allocates IDs around retained paragraph IDs and keeps every paragraph', () => {
  const input = '<html><body><p>正文<sup><a class="calibre-footnote" href="#old_note" id="old_ref">注</a></sup></p><aside id="old_note"><p id="note001"><ruby>水星<rt>Mercury</rt></ruby>第一段。</p><p id="note_ref002">第二段。</p></aside><a href="#note001">正文链接</a></body></html>';
  const output = upgradeFootnotes(input);
  const { document } = parseHTML(output);
  const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
  assert.equal(ids.length, new Set(ids).size);
  for (const anchor of document.querySelectorAll('a[href^="#"]')) assert.ok(document.getElementById(anchor.getAttribute('href').slice(1)));
  assert.equal(document.querySelector('aside').textContent, '水星Mercury第一段。第二段。');
  assert.equal(document.getElementById('note001').tagName, 'P');
  assert.equal(document.querySelector('img').getAttribute('zy-footnote'), '水星（Mercury）第一段。\n第二段。');
  assert.equal(upgradeFootnotes(output), output);
});

for (const label of ['注12：</a>', '<span>注12：</span></a>', '<span>注12</span></a>：']) {
  test(`upgrade removes only a leading original backlink with label ${label}`, () => {
    const input = `<html><body><p>正文<sup><a class="calibre-footnote" href="#old_note" id="old_ref">注</a></sup></p><aside id="old_note"><p><span><a href="#old_ref">${label}</span><ruby>水星<rt>Mercury</rt></ruby>正文。</p><p>后段<a href="#old_ref">阅读正文</a>。</p></aside><p id="body_target">正文目标。</p></body></html>`;
    const output = upgradeFootnotes(input);
    const { document } = parseHTML(output);
    assert.equal(document.querySelector('aside').textContent, '水星Mercury正文。后段阅读正文。');
    assert.equal(document.querySelector('aside a').textContent, '阅读正文');
    for (const anchor of document.querySelectorAll('a[href^="#"]')) assert.ok(document.getElementById(anchor.getAttribute('href').slice(1)));
    assert.doesNotMatch(output, /old_ref|注12/);
    assert.equal(upgradeFootnotes(output), output);
  });
}

test('upgrade keeps a leading body link that contains more than an old note label', () => {
  const input = '<html><body><p>正文<sup><a class="calibre-footnote" href="#old_note" id="old_ref">注</a></sup></p><aside id="old_note"><p><a href="#old_ref">注12：正文链接</a><ruby>水星<rt>Mercury</rt></ruby>说明。</p><p><a href="#body_target">注13：</a>仍是正文链接。</p></aside><p id="body_target">正文目标。</p></body></html>';
  const output = upgradeFootnotes(input);
  const { document } = parseHTML(output);
  assert.deepEqual([...document.querySelectorAll('aside a')].map((a) => a.textContent), ['注12：正文链接', '注13：']);
  assert.equal(document.querySelector('aside').textContent, '注12：正文链接水星Mercury说明。注13：仍是正文链接。');
  for (const anchor of document.querySelectorAll('a[href^="#"]')) assert.ok(document.getElementById(anchor.getAttribute('href').slice(1)));
  assert.equal(upgradeFootnotes(output), output);
});

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
