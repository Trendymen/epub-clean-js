import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractParagraphs } from '../../../books/yimei-seikatsu/migrate/paragraph-extractor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

test('extractParagraphs: SRC chapter paragraphs', () => {
  const paras = extractParagraphs(join(FIXTURES, 'sample_src_chapter.xhtml'));
  assert.deepEqual(paras, ['第一段文字。', '第二段文字。', '第三段文字。']);
});

test('extractParagraphs: DST strips ruby rt', () => {
  const paras = extractParagraphs(join(FIXTURES, 'sample_dst_chapter.xhtml'));
  assert.deepEqual(paras, ['含 小园 注音的段落。', '第二段。']);
});

test('extractParagraphs: 跳过 aside 内的 <p>（注释正文不算正文段）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pe-aside-'));
  try {
    const fp = join(dir, 'aside.xhtml');
    await writeFile(
      fp,
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <p>正文第一段。</p>
  <aside epub:type="footnote" id="note001"><p>注释正文：不应被抽出。</p></aside>
  <p>正文第二段。</p>
</body></html>`,
      'utf-8',
    );
    const paras = extractParagraphs(fp);
    assert.deepEqual(paras, ['正文第一段。', '正文第二段。']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('extractParagraphs: 嵌套 aside > ol > li > p 也跳过', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pe-aside-nested-'));
  try {
    const fp = join(dir, 'nested.xhtml');
    await writeFile(
      fp,
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <p>正文第一段。</p>
  <aside epub:type="footnote" id="note001">
    <ol class="duokan-footnote-content">
      <li class="duokan-footnote-item"><p>嵌套深层的注释正文：不应被抽出。</p></li>
    </ol>
  </aside>
  <p>正文第二段。</p>
</body></html>`,
      'utf-8',
    );
    const paras = extractParagraphs(fp);
    assert.deepEqual(paras, ['正文第一段。', '正文第二段。']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
