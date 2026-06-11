import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractFootnotes } from '../../../books/yimei-seikatsu/migrate/footnote-extractor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

test('extractFootnotes: single footnote', () => {
  const notes = extractFootnotes(join(FIXTURES, 'sample_dst_with_footnote.xhtml'));
  assert.equal(notes.length, 1);
  const fn = notes[0];
  assert.equal(fn.originalId, 'note001');
  assert.equal(fn.text, '注：这是注释内容');
  assert.equal(fn.imgFilename, 'note.webp');
  assert.equal(fn.hostParaText, '这是注解前面的话注解后面的话。');
  assert.equal(fn.hostParaIndex, 1);
  assert.equal(fn.supOffset, '这是注解前面的话'.length);
  assert.ok(fn.beforeCtx.endsWith('的话'), `beforeCtx=${fn.beforeCtx}`);
  assert.ok(fn.afterCtx.startsWith('注解后'), `afterCtx=${fn.afterCtx}`);
});

test('extractFootnotes: hostParaIndex 不被 aside 内的 p 占号', async () => {
  // 结构：正文 p[0]、正文 p[1]（含 sup）、aside（内有 1 p）、正文 p[2]。
  // 修复前：aside 内的 p 会占号，正文最后一段会被记为 index=3；
  // 修复后：跳过 aside 内的 p，host p（含 sup）的 hostParaIndex 应为 1，
  // 且总段数为 3（不是 4）。
  const dir = await mkdtemp(join(tmpdir(), 'fe-aside-'));
  try {
    const fp = join(dir, 'aside.xhtml');
    await writeFile(
      fp,
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <p>正文第一段。</p>
  <p>含注释段落<sup><a class="duokan-footnote" epub:type="noteref" href="#note001" id="note_ref001"><img src="../Images/note.webp" zy-footnote="注释内容"/></a></sup>后续文字。</p>
  <aside epub:type="footnote" id="note001">
    <ol class="duokan-footnote-content">
      <li class="duokan-footnote-item"><p>注释正文：不应占据 hostParaIndex 序号。</p></li>
    </ol>
  </aside>
  <p>正文第三段。</p>
</body></html>`,
      'utf-8',
    );
    const notes = extractFootnotes(fp);
    assert.equal(notes.length, 1);
    // host p（含 sup）是正文第 2 段，0-based index = 1。
    // 修复前会是 1 也巧合相同（sup 在 aside 之前），所以这里关键是验证
    // 「最后一个正文 p 不会被错算到 index=3」的间接证据：hostParaText 干净。
    assert.equal(notes[0].hostParaIndex, 1);
    assert.equal(notes[0].hostParaText, '含注释段落后续文字。');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('extractFootnotes: sup 在 aside 之后时 hostParaIndex 也不被 aside 占号', async () => {
  // 结构：正文 p[0]、aside（内有 1 p）、正文 p[1]（含 sup）。
  // 修复前：aside 内的 p 会占号，host p 的 hostParaIndex 错算为 2；
  // 修复后：跳过 aside 内的 p，host p 的 hostParaIndex 正确为 1。
  // 这个 case 才真正能区分修复前后行为。
  const dir = await mkdtemp(join(tmpdir(), 'fe-aside-after-'));
  try {
    const fp = join(dir, 'aside_after.xhtml');
    await writeFile(
      fp,
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <p>正文第一段。</p>
  <aside epub:type="footnote" id="note001">
    <ol class="duokan-footnote-content">
      <li class="duokan-footnote-item"><p>注释正文不占号。</p></li>
    </ol>
  </aside>
  <p>含 sup 的第二段<sup><a class="duokan-footnote" epub:type="noteref" href="#note001" id="note_ref001"><img src="../Images/note.webp" zy-footnote="注释内容"/></a></sup>。</p>
</body></html>`,
      'utf-8',
    );
    const notes = extractFootnotes(fp);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].hostParaIndex, 1, '修复前 aside 内 p 会让此处变成 2');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
