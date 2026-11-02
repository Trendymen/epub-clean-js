import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseHyreadEpubToBook, parseAnotherDaysEpubToBook } from '../../../books/yimei-seikatsu/hyread-parser.js';
import { writeHyreadFixture, bodyParagraph as p } from '../../helpers/hyread-fixture.js';

async function withFixture(options, check, parser = parseHyreadEpubToBook, parserOptions = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hyread-parser-'));
  try {
    const source = join(dir, 'source.epub');
    await writeHyreadFixture(source, options);
    await check(await parser(source, { volume: '13', ...parserOptions }));
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

test('HyRead simplifies continuous Chinese context across span and ruby boundaries while mapping UTF-16 positions', async () => {
  await withFixture({ pages: { 'p-002.xhtml': p('乾<span>坤</span>、著<span>作</span>、乾<ruby>隆<rt>皇帝</rt></ruby>、二<ruby>噁<rt>惡</rt></ruby>英') } }, (book) => {
    const block = book.chapters[0].blocks[0];
    assert.equal(block.text, '乾坤、著作、乾隆、二𫫇英');
    assert.deepEqual(block.rubySpans, [
      { start: 7, end: 8, base: '隆', rt: '皇帝' },
      { start: 10, end: 12, base: '𫫇', rt: '恶' },
    ]);
    for (const span of block.rubySpans) assert.equal(block.text.slice(span.start, span.end), span.base);
  });
});

test('HyRead retains each rb/rt pairing within a ruby and converts their shared Chinese context', async () => {
  await withFixture({ pages: { 'p-002.xhtml': p('<ruby><rb>東</rb><rt>east</rt><rb>京</rb><rt>capital</rt></ruby>與<ruby><rb>乾</rb><rt>qian</rt><rb>隆</rb><rt>long</rt></ruby>') } }, (book) => {
    const block = book.chapters[0].blocks[0];
    assert.equal(block.text, '东京与乾隆');
    assert.deepEqual(block.rubySpans, [
      { start: 0, end: 1, base: '东', rt: 'east' },
      { start: 1, end: 2, base: '京', rt: 'capital' },
      { start: 3, end: 4, base: '乾', rt: 'qian' },
      { start: 4, end: 5, base: '隆', rt: 'long' },
    ]);
  });
});

test('another-days retains mfont large-text decoration after the chapter heading', async () => {
  await withFixture({ pages: { 'p-002.xhtml': '<p class="mfont"><span class="font-1em40">第一章</span></p><p>正文</p><p class="mfont"><span class="font-1em40">告別</span></p><p>後文</p>' } }, (book) => {
    assert.equal(book.chapters[0].title, '第一章');
    assert.deepEqual(book.chapters[0].blocks.map((block) => block.text), ['正文', '告别', '后文']);
  }, parseAnotherDaysEpubToBook);
});

test('HyRead maps ruby around optional length-changing wording', async () => {
  await withFixture({ pages: { 'p-002.xhtml':
    p('智慧型手機和<ruby>淺村<rt>Asamura</rt></ruby>')
    + p('<ruby>淺村<rt>Asamura</rt></ruby>智慧型手機')
    + p('智慧型手機')
    + p('<ruby><rb>淺</rb><rt>qian</rt><rb>村</rb><rt>cun</rt></ruby>智慧型手機'),
  } }, (book) => {
    const [before, after, plain, paired] = book.chapters[0].blocks;
    assert.equal(before.text, '智能手机和浅村');
    assert.deepEqual(before.rubySpans, [{ start: 5, end: 7, base: '浅村', rt: 'Asamura' }]);
    assert.equal(after.text, '浅村智能手机');
    assert.deepEqual(after.rubySpans, [{ start: 0, end: 2, base: '浅村', rt: 'Asamura' }]);
    assert.equal(plain.text, '智能手机');
    assert.deepEqual(plain.rubySpans, []);
    assert.equal(paired.text, '浅村智能手机');
    assert.deepEqual(paired.rubySpans, [
      { start: 0, end: 1, base: '浅', rt: 'qian' },
      { start: 1, end: 2, base: '村', rt: 'cun' },
    ]);
  }, parseHyreadEpubToBook, { wording: 'mainland' });
});

test('HyRead reports each wording match that overlaps ruby after skipped paragraphs', async () => {
  const diagnostics = [];
  await withFixture({ pages: { 'p-002.xhtml':
    '<p id="mokuji-skip">略</p>'
    + '<p class="__reader-paragraph-spacing__"><span class="gfont40">第一章</span></p>'
    + p('<ruby>智慧型<rt>智能</rt></ruby>手機和<ruby>智慧型<rt>智能</rt></ruby>手機'),
  } }, (book) => {
    const block = book.chapters[0].blocks[0];
    assert.equal(block.text, '智慧型手机和智慧型手机');
    assert.deepEqual(block.rubySpans, [
      { start: 0, end: 3, base: '智慧型', rt: '智能' },
      { start: 6, end: 9, base: '智慧型', rt: '智能' },
    ]);
    assert.deepEqual(diagnostics, [
      { volume: '13', source: 'item/xhtml/p-002.xhtml', paragraphIndex: 3, ruleId: 'smartphone', kind: 'text', start: 0, end: 5 },
      { volume: '13', source: 'item/xhtml/p-002.xhtml', paragraphIndex: 3, ruleId: 'smartphone', kind: 'text', start: 6, end: 11 },
    ]);
  }, parseHyreadEpubToBook, { wording: 'mainland', onDiagnostic: (event) => diagnostics.push(event) });
});

test('HyRead keeps reading wording and reports its ruby and rt positions', async () => {
  const diagnostics = [];
  await withFixture({ pages: { 'p-002.xhtml':
    p('<ruby><rt>unused</rt></ruby><ruby><rb>水</rb><rt>water</rt><rb>星</rb><rt>智慧型手機</rt></ruby>'),
  } }, (book) => {
    const block = book.chapters[0].blocks[0];
    assert.equal(block.text, '水星');
    assert.deepEqual(block.rubySpans, [
      { start: 0, end: 1, base: '水', rt: 'water' },
      { start: 1, end: 2, base: '星', rt: '智慧型手机' },
    ]);
    assert.deepEqual(diagnostics, [{
      volume: '13', source: 'item/xhtml/p-002.xhtml', paragraphIndex: 1,
      ruleId: 'smartphone', kind: 'rt', rubyIndex: 2, rtIndex: 2, start: 0, end: 5,
    }]);
  }, parseHyreadEpubToBook, { wording: 'mainland', onDiagnostic: (event) => diagnostics.push(event) });
});

test('both HyRead parsers convert TOC and body with the selected wording', async () => {
  for (const parser of [parseHyreadEpubToBook, parseAnotherDaysEpubToBook]) {
    await withFixture({ pages: { 'p-002.xhtml': p('智慧型手機') }, toc: [['p-002.xhtml', '網路上']] }, (book) => {
      assert.equal(book.tocTitles[0], '网络上');
      assert.equal(book.chapters[0].title, '网络上');
      assert.equal(book.chapters[0].blocks[0].text, '智能手机');
    }, parser, { wording: 'mainland' });
  }
});

test('HyRead rejects invalid wording before opening the source', async () => {
  for (const parser of [parseHyreadEpubToBook, parseAnotherDaysEpubToBook]) {
    await assert.rejects(parser('/missing/source.epub', { volume: '13', wording: 'invalid' }), /wording/i);
  }
});

test('unpaired ruby bases remain protected from optional wording', async () => {
  const diagnostics = [];
  await withFixture({ pages: { 'p-002.xhtml':
    p('<ruby><rb>水</rb><rt>water</rt><rb>智慧型</rb></ruby>手機'),
  } }, (book) => {
    const block = book.chapters[0].blocks[0];
    assert.equal(block.text, '水智慧型手机');
    assert.deepEqual(block.rubySpans, [{ start: 0, end: 1, base: '水', rt: 'water' }]);
    assert.deepEqual(diagnostics, [{
      volume: '13', source: 'item/xhtml/p-002.xhtml', paragraphIndex: 1,
      ruleId: 'smartphone', kind: 'text', start: 1, end: 6,
    }]);
  }, parseHyreadEpubToBook, { wording: 'mainland', onDiagnostic: (event) => diagnostics.push(event) });
});

test('nested ruby preserves both readings and reports the inner ruby in document order', async () => {
  for (const markup of [
    '<ruby>甲<ruby>智慧型<rt>智慧型手機</rt></ruby>手機<rt>outer</rt></ruby>',
    '<ruby><rb>甲<ruby>智慧型<rt>智慧型手機</rt></ruby>手機</rb><rt>outer</rt></ruby>',
  ]) {
    const diagnostics = [];
    await withFixture({ pages: { 'p-002.xhtml': p(markup) } }, (book) => {
      const block = book.chapters[0].blocks[0];
      assert.equal(block.text, '甲智慧型手机');
      assert.deepEqual(block.rubySpans, [{
        start: 0, end: 6, base: '甲智慧型手机', rt: 'outer', children: [
          { start: 1, end: 4, base: '智慧型', rt: '智慧型手机' },
        ],
      }]);
      assert.deepEqual(diagnostics, [
        { volume: '13', source: 'item/xhtml/p-002.xhtml', paragraphIndex: 1, ruleId: 'smartphone', kind: 'rt', rubyIndex: 2, rtIndex: 1, start: 0, end: 5 },
        { volume: '13', source: 'item/xhtml/p-002.xhtml', paragraphIndex: 1, ruleId: 'smartphone', kind: 'text', start: 1, end: 6 },
      ]);
    }, parseHyreadEpubToBook, { wording: 'mainland', onDiagnostic: (event) => diagnostics.push(event) });
  }
});

test('nested ruby maps supplementary characters after a preceding length-changing replacement', async () => {
  await withFixture({ pages: { 'p-002.xhtml':
    p('智慧型手機<ruby>二<ruby>噁<rt>惡</rt></ruby>英<rt>dioxin</rt></ruby>'),
  } }, (book) => {
    const block = book.chapters[0].blocks[0];
    assert.equal(block.text, '智能手机二𫫇英');
    assert.deepEqual(block.rubySpans, [{
      start: 4, end: 8, base: '二𫫇英', rt: 'dioxin', children: [
        { start: 5, end: 7, base: '𫫇', rt: '恶' },
      ],
    }]);
  }, parseHyreadEpubToBook, { wording: 'mainland' });
});

test('nested reading diagnostics count all rt descendants in document order', async () => {
  const diagnostics = [];
  await withFixture({ pages: { 'p-002.xhtml':
    p('<ruby>甲<ruby>乙<rt>智慧型手機</rt></ruby><rt>智慧型手機</rt></ruby>'),
  } }, () => {
    assert.deepEqual(diagnostics.map(({ rubyIndex, rtIndex }) => [rubyIndex, rtIndex]), [[2, 1], [1, 2]]);
  }, parseHyreadEpubToBook, { wording: 'mainland', onDiagnostic: (event) => diagnostics.push(event) });
});

test('nested ruby inside a reading retains structure and identifies the inner reading', async () => {
  const diagnostics = [];
  await withFixture({ pages: { 'p-002.xhtml':
    p('<ruby>甲<rt><ruby>乙<rt>智慧型手機</rt></ruby></rt></ruby>'),
  } }, (book) => {
    assert.deepEqual(book.chapters[0].blocks[0].rubySpans, [{
      start: 0, end: 1, base: '甲', rt: '乙', rtSpans: [
        { start: 0, end: 1, base: '乙', rt: '智慧型手机' },
      ],
    }]);
    assert.deepEqual(diagnostics, [{
      volume: '13', source: 'item/xhtml/p-002.xhtml', paragraphIndex: 1,
      ruleId: 'smartphone', kind: 'rt', rubyIndex: 2, rtIndex: 1, start: 0, end: 5,
    }]);
  }, parseHyreadEpubToBook, { wording: 'mainland', onDiagnostic: (event) => diagnostics.push(event) });
});

test('ruby formatting whitespace does not enter text or prevent protection', async () => {
  const diagnostics = [];
  await withFixture({ pages: { 'p-002.xhtml':
    p('前<ruby>\n  <rb>淺</rb>\n  <rt>qian</rt>\n  <rb>村</rb>\n  <rt>cun</rt>\n</ruby>後')
    + p('<ruby>\n<rb>智慧型</rb>\n<rt>Smart</rt>\n</ruby>手機'),
  } }, (book) => {
    assert.equal(book.chapters[0].blocks[0].text, '前浅村后');
    assert.equal(book.chapters[0].blocks[1].text, '智慧型手机');
    assert.deepEqual(diagnostics, [{
      volume: '13', source: 'item/xhtml/p-002.xhtml', paragraphIndex: 2,
      ruleId: 'smartphone', kind: 'text', start: 0, end: 5,
    }]);
  }, parseHyreadEpubToBook, { wording: 'mainland', onDiagnostic: (event) => diagnostics.push(event) });
});

test('both parsers protect and report native ruby in standalone headings', async () => {
  for (const parser of [parseHyreadEpubToBook, parseAnotherDaysEpubToBook]) {
    const diagnostics = [];
    await withFixture({ pages: { 'p-002.xhtml':
      '<p id="mokuji-skip">略</p>'
      + '<p class="__reader-paragraph-spacing__"><span class="gfont40"><ruby>智慧型<rt>智慧型手機</rt></ruby>手機</span></p>'
      + p('正文'),
    }, toc: [] }, (book) => {
      const chapter = book.chapters[0];
      assert.equal(chapter.title, '智慧型手机');
      assert.deepEqual(chapter.titleRubySpans, [{ start: 0, end: 3, base: '智慧型', rt: '智慧型手机' }]);
      assert.deepEqual(diagnostics, [
        { volume: '13', source: 'item/xhtml/p-002.xhtml', paragraphIndex: 2, ruleId: 'smartphone', kind: 'rt', rubyIndex: 1, rtIndex: 1, start: 0, end: 5 },
        { volume: '13', source: 'item/xhtml/p-002.xhtml', paragraphIndex: 2, ruleId: 'smartphone', kind: 'text', start: 0, end: 5 },
      ]);
    }, parser, { wording: 'mainland', onDiagnostic: (event) => diagnostics.push(event) });
  }
});

test('standalone heading diagnostics use uncompressed paragraph UTF-16 coordinates', async () => {
  for (const parser of [parseHyreadEpubToBook, parseAnotherDaysEpubToBook]) {
    const diagnostics = [];
    await withFixture({ pages: { 'p-002.xhtml':
      '<p><span class="gfont40">𫫇 <ruby>智慧型<rt>Smart</rt></ruby> 手機</span></p>' + p('正文'),
    }, toc: [] }, () => {
      assert.deepEqual(diagnostics, [{
        volume: '13', source: 'item/xhtml/p-002.xhtml', paragraphIndex: 1,
        ruleId: 'smartphone', kind: 'text', start: 3, end: 9,
      }]);
    }, parser, { wording: 'mainland', onDiagnostic: (event) => diagnostics.push(event) });
  }
});

test('both parsers protect and report native ruby in TOC titles', async () => {
  for (const parser of [parseHyreadEpubToBook, parseAnotherDaysEpubToBook]) {
    const diagnostics = [];
    await withFixture({ pages: { 'p-002.xhtml': p('正文') }, toc: [
      ['p-002.xhtml', '<ruby>智慧型<rt>智慧型手機</rt></ruby>手機'],
    ] }, (book) => {
      assert.equal(book.tocTitles[0], '智慧型手机');
      assert.equal(book.chapters[0].title, '智慧型手机');
      assert.deepEqual(book.chapters[0].titleRubySpans, [{ start: 0, end: 3, base: '智慧型', rt: '智慧型手机' }]);
      assert.deepEqual(diagnostics, [
        { volume: '13', source: 'item/xhtml/p-toc-001.xhtml', paragraphIndex: null, tocEntryIndex: 1, ruleId: 'smartphone', kind: 'rt', rubyIndex: 1, rtIndex: 1, start: 0, end: 5 },
        { volume: '13', source: 'item/xhtml/p-toc-001.xhtml', paragraphIndex: null, tocEntryIndex: 1, ruleId: 'smartphone', kind: 'text', start: 0, end: 5 },
      ]);
    }, parser, { wording: 'mainland', onDiagnostic: (event) => diagnostics.push(event) });
  }
});

test('TOC ruby readings retain spaces while the title is compacted', async () => {
  await withFixture({ pages: { 'p-002.xhtml': p('正文') }, toc: [
    ['p-002.xhtml', '<ruby>淺村<rt>Mr Asamura</rt></ruby> 悠太'],
  ] }, (book) => {
    assert.equal(book.chapters[0].title, '浅村悠太');
    assert.equal(book.chapters[0].titleRubySpans[0].rt, 'Mr Asamura');
  });
});

test('another-days reports paragraph and reading positions through its public parser', async () => {
  const diagnostics = [];
  await withFixture({ pages: { 'p-002.xhtml':
    '<p id="mokuji-skip">略</p>' + p('<ruby>智慧型<rt>智慧型手機</rt></ruby>手機'),
  } }, () => {
    assert.deepEqual(diagnostics, [
      { volume: '13', source: 'item/xhtml/p-002.xhtml', paragraphIndex: 2, ruleId: 'smartphone', kind: 'rt', rubyIndex: 1, rtIndex: 1, start: 0, end: 5 },
      { volume: '13', source: 'item/xhtml/p-002.xhtml', paragraphIndex: 2, ruleId: 'smartphone', kind: 'text', start: 0, end: 5 },
    ]);
  }, parseAnotherDaysEpubToBook, { wording: 'mainland', onDiagnostic: (event) => diagnostics.push(event) });
});

test('TOC diagnostics use whole-paragraph UTF-16 positions for multiple links', async () => {
  for (const parser of [parseHyreadEpubToBook, parseAnotherDaysEpubToBook]) {
    const diagnostics = [];
    await withFixture({ pages: { 'p-002.xhtml': p('正文'), 'p-003.xhtml': p('正文') }, tocBody:
      '<div class="main"><p>𫫇二噁英甲<a href="p-002.xhtml"><ruby>智慧型<rt>A</rt></ruby>手機</a>与<a href="p-003.xhtml"><ruby>智慧型<rt>B</rt></ruby>手機</a></p></div>',
    }, () => {
      assert.deepEqual(diagnostics, [
        { volume: '13', source: 'item/xhtml/p-toc-001.xhtml', paragraphIndex: 1, ruleId: 'smartphone', kind: 'text', start: 7, end: 12 },
        { volume: '13', source: 'item/xhtml/p-toc-001.xhtml', paragraphIndex: 1, ruleId: 'smartphone', kind: 'text', start: 13, end: 18 },
      ]);
    }, parser, { wording: 'mainland', onDiagnostic: (event) => diagnostics.push(event) });
  }
});

test('TOC diagnostics include whitespace-compacted links and ruby surrounding a link', async () => {
  for (const parser of [parseHyreadEpubToBook, parseAnotherDaysEpubToBook]) {
    const diagnostics = [];
    await withFixture({ pages: { 'p-002.xhtml': p('正文'), 'p-003.xhtml': p('正文') }, tocBody:
      '<div class="main"><p>𫫇二噁英甲<a href="p-002.xhtml"><ruby>智慧型<rt>Smart</rt></ruby> 手機</a>与<ruby><a href="p-003.xhtml">智慧型手機</a><rt>outer</rt></ruby></p></div>',
    }, (book) => {
      assert.equal(book.chapters[0].title, '智慧型手机');
      assert.equal(book.chapters[1].title, '智慧型手机');
      assert.equal(book.chapters[1].titleRubySpans[0].rt, 'outer');
      assert.deepEqual(diagnostics, [
        { volume: '13', source: 'item/xhtml/p-toc-001.xhtml', paragraphIndex: 1, ruleId: 'smartphone', kind: 'text', start: 7, end: 13 },
        { volume: '13', source: 'item/xhtml/p-toc-001.xhtml', paragraphIndex: 1, ruleId: 'smartphone', kind: 'text', start: 14, end: 19 },
      ]);
    }, parser, { wording: 'mainland', onDiagnostic: (event) => diagnostics.push(event) });
  }
});

test('TOC diagnostics follow individual link matches rather than cross-link phrases', async () => {
  for (const parser of [parseHyreadEpubToBook, parseAnotherDaysEpubToBook]) {
    for (const first of ['<a href="p-002.xhtml">智慧型</a>', '智慧型']) {
      const diagnostics = [];
      await withFixture({ pages: { 'p-002.xhtml': p('正文'), 'p-003.xhtml': p('正文') }, tocBody:
        `<div class="main"><p>${first}<a href="p-003.xhtml"><ruby>手機<rt>Smart</rt></ruby>螢幕</a></p></div>`,
      }, () => {
        assert.deepEqual(diagnostics, [{
          volume: '13', source: 'item/xhtml/p-toc-001.xhtml', paragraphIndex: 1,
          ruleId: 'phone-screen', kind: 'text', start: 3, end: 7,
        }]);
      }, parser, { wording: 'mainland', onDiagnostic: (event) => diagnostics.push(event) });
    }
    const diagnostics = [];
    await withFixture({ pages: { 'p-002.xhtml': p('正文'), 'p-003.xhtml': p('正文') }, tocBody:
      '<div class="main"><p><a href="p-002.xhtml"><ruby>智慧型<rt>Smart</rt></ruby></a><a href="p-003.xhtml">手機</a></p></div>',
    }, () => assert.deepEqual(diagnostics, []), parser, {
      wording: 'mainland', onDiagnostic: (event) => diagnostics.push(event),
    });
  }
});

test('TOC diagnostics do not require mapping unrelated ruby outside the link', async () => {
  for (const parser of [parseHyreadEpubToBook, parseAnotherDaysEpubToBook]) {
    const fixture = { pages: { 'p-002.xhtml': p('正文') }, tocBody:
      '<div class="main"><p>傢<ruby>俱<rt>x</rt></ruby> <a href="p-002.xhtml"><ruby>智慧型<rt>Smart</rt></ruby> 手機</a></p></div>',
    };
    let titleWithoutCallback;
    await withFixture(fixture, (book) => { titleWithoutCallback = book.chapters[0].title; }, parser, { wording: 'mainland' });
    const diagnostics = [];
    await withFixture(fixture, (book) => {
      assert.equal(book.chapters[0].title, titleWithoutCallback);
      assert.equal(titleWithoutCallback, '智慧型手机');
      assert.deepEqual(diagnostics, [{
        volume: '13', source: 'item/xhtml/p-toc-001.xhtml', paragraphIndex: 1,
        ruleId: 'smartphone', kind: 'text', start: 3, end: 9,
      }]);
    }, parser, { wording: 'mainland', onDiagnostic: (event) => diagnostics.push(event) });
  }
});

test('both parsers retain a chapter heading with ruby alongside a separate TOC title', async () => {
  for (const parser of [parseHyreadEpubToBook, parseAnotherDaysEpubToBook]) {
    for (const tocTitle of ['智慧型手機', '不同的目錄標題']) {
      await withFixture({ pages: { 'p-002.xhtml':
        '<p><span class="gfont40"><ruby>智慧型<rt>Smart</rt></ruby>手機</span></p>' + p('正文'),
      }, toc: [['p-002.xhtml', tocTitle]] }, (book) => {
        assert.equal(book.chapters[0].heading.text, '智慧型手机');
        assert.deepEqual(book.chapters[0].heading.rubySpans, [{ start: 0, end: 3, base: '智慧型', rt: 'Smart' }]);
        assert.equal(book.chapters[0].title, tocTitle === '智慧型手機' ? '智能手机' : '不同的目录标题');
      }, parser, { wording: 'mainland' });
    }
  }
});

test('another-days keeps TOC afterword suffixes and ruby instead of applying heading fallback', async () => {
  for (const tocTitle of ['後記：補充', '<ruby>後記<rt>智慧型手機</rt></ruby>：補充']) {
    await withFixture({ pages: { 'p-002.xhtml': p('正文') }, toc: [['p-002.xhtml', tocTitle]] }, (book) => {
      const chapter = book.chapters[0];
      assert.equal(chapter.title, '后记：补充');
      if (tocTitle.includes('<ruby>')) assert.equal(chapter.titleRubySpans[0].rt, '智慧型手机');
    }, parseAnotherDaysEpubToBook, { wording: 'mainland' });
  }
});

test('afterword fallback retains a source heading with ruby and its suffix', async () => {
  for (const parser of [parseHyreadEpubToBook, parseAnotherDaysEpubToBook]) {
    await withFixture({ pages: { 'p-002.xhtml':
      '<p><span class="gfont40"><ruby>後記<rt>あとがき</rt></ruby>：補充</span></p>' + p('正文'),
    }, toc: [] }, (book) => {
      assert.equal(book.chapters[0].title, '后记：补充');
      assert.equal(book.chapters[0].titleRubySpans[0].rt, 'あとがき');
    }, parser);
  }
});
