import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseHyreadEpubToBook, parseAnotherDaysEpubToBook } from '../../../books/yimei-seikatsu/hyread-parser.js';
import { writeHyreadFixture, bodyParagraph as p } from '../../helpers/hyread-fixture.js';

async function withFixture(options, check, parser = parseHyreadEpubToBook) {
  const dir = await mkdtemp(join(tmpdir(), 'hyread-parser-'));
  try {
    const source = join(dir, 'source.epub');
    await writeHyreadFixture(source, options);
    await check(await parser(source, { volume: '13' }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

for (const cls of ['font-1em40', 'gfont40']) {
  test(`HyRead removes a standalone leading ${cls} heading, retaining matching body text and later decoration`, async () => {
    await withFixture({ pages: { 'p-002.xhtml': `<p class="__reader-paragraph-spacing__"><span class="other ${cls}">第一章</span></p>${p('第一章')}${p(`<span class="${cls}">正文大字</span>`)}${p(`前<span class="${cls}">裝飾</span>後`)}` } }, (book) => {
      assert.deepEqual(book.chapters[0].blocks.map((block) => block.text), ['第一章', '正文大字', '前装饰后']);
    });
  });
}

test('HyRead retains a first body paragraph matching the TOC and does not detect partial class names as headings', async () => {
  await withFixture({ pages: { 'p-002.xhtml': p('第一章') + p('<span class="gfont400 font-1em400">普通正文</span>') + p('<span class="font-1em40">段中大字</span>') + p('<span class="gfont40">另一段大字</span>') } }, (book) => {
    assert.deepEqual(book.chapters[0].blocks.map((block) => block.text), ['第一章', '普通正文', '段中大字', '另一段大字']);
  });
});

test('HyRead retains word-separating spaces at ruby boundaries and restores inline glyph images', async () => {
  await withFixture({ pages: { 'p-002.xhtml': p('<ruby><rb>Hello </rb><rt>問候</rt></ruby>world 與<img class="height-1em" src="../image/p000.png"/>') } }, (book) => {
    const block = book.chapters[0].blocks[0];
    assert.equal(block.text, 'Hello world 与﨑');
    assert.deepEqual(block.rubySpans, [{ start: 0, end: 6, base: 'Hello ', rt: '问候' }]);
  });
});

test('HyRead records original ruby positions, simplifies base and rt, and excludes rp', async () => {
  await withFixture({ pages: { 'p-002.xhtml': p('淺村Asamura：<ruby><rb><span>淺村</span></rb><rp>（</rp><rt><span>Asamura &amp; Co</span></rt><rp>）</rp></ruby><ruby>水星<rt>我們學校</rt></ruby><ruby>水星<rt>我們學校</rt></ruby>尾') + p('水星我們學校') } }, (book) => {
    const [first, second] = book.chapters[0].blocks;
    assert.equal(first.text, '浅村Asamura：浅村水星水星尾');
    assert.deepEqual(first.rubySpans, [
      { start: 10, end: 12, base: '浅村', rt: 'Asamura & Co' },
      { start: 12, end: 14, base: '水星', rt: '我们学校' },
      { start: 14, end: 16, base: '水星', rt: '我们学校' },
    ]);
    assert.equal(second.text, '水星我们学校');
    assert.deepEqual(second.rubySpans, []);
  });
});

test('another-days keeps illustration pairing and spine order when sharing inline parsing', async () => {
  await withFixture({
    pages: {
      'p-001.xhtml': '<p>前言正文</p>',
      'p-fmatter-001.xhtml': '<img src="../image/front.jpg"/>',
      'p-002.xhtml': '<p><ruby>淺村<rt>Asamura</rt></ruby>正文</p>',
      'p-fmatter-002.xhtml': '<img src="../image/back.jpg"/>',
    },
    toc: [['p-001.xhtml', '前言'], ['p-fmatter-001.xhtml', '短篇']],
    images: { 'front.jpg': Buffer.from('front'), 'back.jpg': Buffer.from('back') },
  }, (book) => {
    assert.deepEqual(book.chapters.map((chapter) => chapter.title), ['前言', '短篇']);
    assert.equal(book.chapters[1].blocks[0].fileName, 'front.jpg');
    assert.equal(book.backImages[0].fileName, 'back.jpg');
    assert.equal(book.chapters[1].blocks[1].text, '浅村正文');
    assert.equal(book.chapters[1].blocks[1].rubySpans[0].rt, 'Asamura');
  }, parseAnotherDaysEpubToBook);
});
