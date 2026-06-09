import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

import {
  buildLightNovelEpub,
  extractArticleHtml,
  parseLightNovelArticle,
  splitLightNovelBook,
  simplifyText,
} from '../../../books/yimei-seikatsu/lightnovel-html/index.js';
import { readEpub, writeEpub } from '../../../src/core/zip-io.js';

const SAMPLE_HTML = `<!doctype html>
<html><body>
<p class="p1">&lt;article id="article-main-contents"&gt;
&lt;span&gt;义妹生活 11[台/繁]&lt;/span&gt;&lt;br&gt;
&lt;img src="https://example.test/cover.jpg?m=a&amp;amp;t=1" img-width="1248" img-height="1847"&gt;&lt;br&gt;
&lt;span&gt;作者：三河ごーすと&lt;/span&gt;&lt;br&gt;
&lt;img src="https://example.test/kuchie.jpg" img-width="2497" img-height="1847"&gt;&lt;br&gt;
&lt;b&gt;ＣＯＮＴＥＮＴＳ&lt;/b&gt;&lt;br&gt;
&lt;b&gt;序幕　淺村悠太&lt;/b&gt;&lt;br&gt;
&lt;b&gt;尾聲　綾瀨沙季的日記&lt;/b&gt;&lt;br&gt;
&lt;div&gt;　　可貴的愛情與罪惡的快樂。&lt;/div&gt;&lt;br&gt;
&lt;b&gt;序幕　淺村悠太&lt;/b&gt;&lt;br&gt;
&lt;div&gt;　　暑假在昨天告終。&lt;/div&gt;&lt;br&gt;
&lt;b&gt;尾聲　綾瀨沙季的日記&lt;/b&gt;&lt;br&gt;
&lt;div&gt;　　晚安，悠太。&lt;/div&gt;&lt;br&gt;
&lt;b&gt;　　　　後記&lt;/b&gt;&lt;br&gt;
&lt;div&gt;　　感謝您購買小說版《義妹生活》第11集。&lt;/div&gt;&lt;br&gt;
&lt;img src="https://example.test/back-1.jpg" img-width="1248" img-height="1847"&gt;&lt;br&gt;
&lt;img src="https://example.test/back-2.jpg" img-width="1248" img-height="1847"&gt;
&lt;/article&gt;</p>
</body></html>`;

const SOURCE_IMAGE_HTML = `<!doctype html>
<html><body>
<p class="p1">&lt;article id="article-main-contents"&gt;
&lt;span&gt;义妹生活 11[台/繁]&lt;/span&gt;&lt;br&gt;
&lt;img src="https://example.test/html-cover.jpg" img-width="1248" img-height="1847"&gt;&lt;br&gt;
&lt;span&gt;作者：三河ごーすと&lt;/span&gt;&lt;br&gt;
&lt;span&gt;插画：Hiten&lt;/span&gt;&lt;br&gt;
&lt;span&gt;译者：Seeker&lt;/span&gt;&lt;br&gt;
&lt;span&gt;图源：大地&lt;/span&gt;&lt;br&gt;
&lt;span&gt;录入：大地&lt;/span&gt;&lt;br&gt;
&lt;img src="https://example.test/html-front.jpg" img-width="1248" img-height="1847"&gt;&lt;br&gt;
&lt;b&gt;ＣＯＮＴＥＮＴＳ&lt;/b&gt;&lt;br&gt;
&lt;b&gt;第一章　测试&lt;/b&gt;&lt;br&gt;
&lt;div&gt;　　题记。&lt;/div&gt;&lt;br&gt;
&lt;b&gt;第一章　测试&lt;/b&gt;&lt;br&gt;
&lt;div&gt;　　「……该不会是这个？『社会数据科学Social Data Science学部』。」&lt;/div&gt;&lt;br&gt;
&lt;img src="https://example.test/html-body.jpg" img-width="1248" img-height="1847"&gt;&lt;br&gt;
&lt;div&gt;　　正文继续。&lt;/div&gt;&lt;br&gt;
&lt;img src="https://example.test/html-back.jpg" img-width="1248" img-height="1847"&gt;
&lt;/article&gt;</p>
</body></html>`;

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

test('extractArticleHtml decodes escaped article and preserves image query ampersands', () => {
  const articleHtml = extractArticleHtml(SAMPLE_HTML);

  assert.match(articleHtml, /^<article id="article-main-contents">/);
  assert.match(articleHtml, /src="https:\/\/example\.test\/cover\.jpg\?m=a&amp;t=1"/);
});

test('parseLightNovelArticle returns linear text and image blocks', () => {
  const article = parseLightNovelArticle(extractArticleHtml(SAMPLE_HTML));

  assert.equal(article.title, '义妹生活 11[台/繁]');
  assert.equal(article.blocks.filter((b) => b.type === 'image').length, 4);
  assert.deepEqual(
    article.blocks
      .filter((b) => b.type === 'text')
      .slice(0, 4)
      .map((b) => b.text),
    ['义妹生活 11[台/繁]', '作者：三河ごーすと', 'ＣＯＮＴＥＮＴＳ', '序幕　淺村悠太'],
  );
});

test('splitLightNovelBook uses contents titles, separates front images, preface, chapters, and afterword', async () => {
  const parsed = parseLightNovelArticle(extractArticleHtml(SAMPLE_HTML));
  const book = await splitLightNovelBook(parsed);

  assert.equal(book.title, '义妹生活 11[台简]');
  assert.equal(book.coverImage.src, 'https://example.test/cover.jpg?m=a&t=1');
  assert.equal(book.frontImages.length, 1);
  assert.equal(book.backImages.length, 2);
  assert.deepEqual(book.tocTitles, ['序幕　浅村悠太', '尾声　绫濑沙季的日记', '后记']);
  assert.deepEqual(book.preBlocks.map((b) => b.text), ['可贵的爱情与罪恶的快乐。']);
  assert.equal(book.chapters.length, 3);
  assert.equal(book.chapters[0].title, '序幕　浅村悠太');
  assert.deepEqual(book.chapters[0].blocks.map((b) => b.text), ['暑假在昨天告终。']);
  assert.equal(book.chapters[2].title, '后记');
  assert.deepEqual(book.chapters[2].blocks.map((b) => b.text), ['感谢您购买小说版《义妹生活》第11集。']);
});

test('simplifyText converts Taiwan traditional terms to Simplified Chinese', async () => {
  assert.equal(await simplifyText('綾瀨同學買了小說，謝謝。'), '绫濑同学买了小说，谢谢。');
});

test('buildLightNovelEpub places epigraph page after TOC and before chapter one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ln-html-epub-'));
  const originalFetch = globalThis.fetch;
  try {
    const htmlPath = join(dir, '11.html');
    const refPath = join(dir, 'ref.epub');
    const styleRefPath = join(dir, 'style-ref.epub');
    const outPath = join(dir, 'out.epub');
    await writeFile(htmlPath, SAMPLE_HTML, 'utf8');
    await writeEpub(refPath, {
      'META-INF/container.xml': '<container/>',
      'OEBPS/Styles/stylesheet.css': '',
      'OEBPS/Misc/script.js': '',
    });
    await writeEpub(styleRefPath, {
      'OEBPS/toc.ncx': `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<navMap>
<navPoint id="specials" playOrder="1"><navLabel><text>特典合集</text></navLabel><content src="Text/specials0001.xhtml"/>
<navPoint id="special1" playOrder="2"><navLabel><text>电子书特典　『卡拉OK女子会』</text></navLabel><content src="Text/special0001.xhtml"/></navPoint>
<navPoint id="special2" playOrder="3"><navLabel><text>虎穴特典　『卡拉OK男子会』</text></navLabel><content src="Text/special0002.xhtml"/></navPoint>
</navPoint>
</navMap>
</ncx>`,
      'OEBPS/Text/title.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><div class="title"><img src="../Images/t1.png"/><p>STYLE TITLE</p></div></body></html>',
      'OEBPS/Text/summary.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><div class="summary"><p>STYLE SUMMARY</p></div></body></html>',
      'OEBPS/Text/specials0001.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>插图</title></head><body><img src="../Images/bonus.png"/></body></html>',
      'OEBPS/Text/special0001.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>电子书特典　『卡拉OK女子会』</title></head><body><h4>电子书特典</h4></body></html>',
      'OEBPS/Text/special0002.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>虎穴特典　『卡拉OK男子会』</title></head><body><h4>虎穴特典</h4><img src="../Images/note.png"/></body></html>',
      'OEBPS/Text/illus0007.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>插图</title></head><body><img src="../Images/bonus-illus.webp"/></body></html>',
      'OEBPS/Images/t1.png': Buffer.from([1]),
      'OEBPS/Images/logo.png': Buffer.from([2]),
      'OEBPS/Images/bonus.png': Buffer.from([3]),
      'OEBPS/Images/note.png': Buffer.from([4]),
      'OEBPS/Images/bonus-illus.webp': Buffer.from([5]),
    });

    globalThis.fetch = async () => ({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });

    await buildLightNovelEpub({
      htmlPath,
      refEpubPath: refPath,
      styleRefEpubPath: styleRefPath,
      outEpubPath: outPath,
      volume: '11',
      modifiedIso: '2026-06-08T00:00:00.000Z',
    });

    const epub = await readEpub(outPath);
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const opf = parser.parse(epub.entries['OEBPS/content.opf'].toString('utf8')).package;
    const spine = (Array.isArray(opf.spine.itemref) ? opf.spine.itemref : [opf.spine.itemref])
      .map((item) => item['@_idref']);
    assert.deepEqual(spine.slice(0, 5), [
      'cover.xhtml',
      'title.xhtml',
      'message.xhtml',
      'summary.xhtml',
      'illus0001.xhtml',
    ]);

    const tocIndex = spine.indexOf('TOC.xhtml');
    assert.deepEqual(spine.slice(tocIndex, tocIndex + 3), [
      'TOC.xhtml',
      'pre.xhtml',
      'chapter0001.xhtml',
    ]);
    assert.deepEqual(spine.slice(-6), [
      'specials0001.xhtml',
      'special0001.xhtml',
      'special0002.xhtml',
      'illus0007.xhtml',
      'illus0008.xhtml',
      'illus0009.xhtml',
    ]);
    assert.match(epub.entries['OEBPS/Text/title.xhtml'].toString('utf8'), /STYLE TITLE/);
    assert.match(epub.entries['OEBPS/Text/summary.xhtml'].toString('utf8'), /STYLE SUMMARY/);
    assert.match(epub.entries['OEBPS/Text/TOC.xhtml'].toString('utf8'), /特典合集/);
    assert.doesNotMatch(epub.entries['OEBPS/Text/TOC.xhtml'].toString('utf8'), />插图</);
    assert.match(epub.entries['OEBPS/Text/TOC.xhtml'].toString('utf8'), /电子书特典　『卡拉OK女子会』/);
    assert.match(epub.entries['OEBPS/Text/navigation-documents.xhtml'].toString('utf8'), /special0001.xhtml/);
    assert.match(epub.entries['OEBPS/toc.ncx'].toString('utf8'), /虎穴特典　『卡拉OK男子会』/);
    assert.ok(epub.entries['OEBPS/Images/t1.png']);
    assert.ok(epub.entries['OEBPS/Images/logo.png']);
    assert.ok(epub.entries['OEBPS/Images/bonus.png']);
    assert.ok(epub.entries['OEBPS/Images/bonus-illus.webp']);
    assert.match(epub.entries['OEBPS/Text/illus0008.xhtml'].toString('utf8'), /kuchie-002\.jpg/);
    assert.match(epub.entries['OEBPS/Text/illus0009.xhtml'].toString('utf8'), /kuchie-003\.jpg/);
    assert.doesNotMatch(epub.entries['OEBPS/Text/chapter0003.xhtml'].toString('utf8'), /kuchie-00[23]\.jpg/);
    assert.match(epub.entries['OEBPS/Text/message.xhtml'].toString('utf8'), /<div class="message">/);
    assert.match(epub.entries['OEBPS/Text/message.xhtml'].toString('utf8'), /<p>图源<\/p>[\s\S]*<p>嘻嘻嘻<\/p>/);
    assert.match(epub.entries['OEBPS/Text/message.xhtml'].toString('utf8'), /<p>录入<\/p>[\s\S]*<p>嘻嘻嘻<\/p>/);
    assert.match(epub.entries['OEBPS/Text/pre.xhtml'].toString('utf8'), /<p><br\/><\/p>\s*<p><br\/><\/p>\s*<p><br\/><\/p>\s*<p><br\/><\/p>\s*<p><br\/><\/p>\s*<p><b>可贵的爱情与罪恶的快乐。<\/b><\/p>/);
    assert.doesNotMatch(epub.entries['OEBPS/Text/chapter0001.xhtml'].toString('utf8'), /可贵的爱情与罪恶的快乐。/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('buildLightNovelEpub can replace and supplement novel images from a source epub profile', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ln-html-image-ref-'));
  const originalFetch = globalThis.fetch;
  try {
    const htmlPath = join(dir, '11.html');
    const refPath = join(dir, 'ref.epub');
    const imageRefPath = join(dir, 'image-ref.epub');
    const outPath = join(dir, 'out.epub');
    await writeFile(htmlPath, SAMPLE_HTML, 'utf8');
    await writeEpub(refPath, {
      'META-INF/container.xml': '<container/>',
      'OEBPS/Styles/stylesheet.css': '',
      'OEBPS/Misc/script.js': '',
    });
    await writeEpub(imageRefPath, {
      'src/cover.jpeg': Buffer.from('cover-from-ref'),
      'src/kuchie-001.jpg': Buffer.from('front-one'),
      'src/kuchie-002.jpg': Buffer.from('front-supplemented'),
      'src/kuchie-003.jpg': Buffer.from('back-one'),
      'src/kuchie-004.jpg': Buffer.from('back-two'),
    });

    globalThis.fetch = async () => {
      throw new Error('image ref mode should not download remote images');
    };

    await buildLightNovelEpub({
      htmlPath,
      refEpubPath: refPath,
      imageRefEpubPath: imageRefPath,
      imageRefProfile: {
        cover: { source: 'src/cover.jpeg', fileName: 'cover.jpg' },
        front: [
          { source: 'src/kuchie-001.jpg', fileName: 'kuchie-001.jpg' },
          { source: 'src/kuchie-002.jpg', fileName: 'kuchie-002.jpg' },
        ],
        body: [],
        back: [
          { source: 'src/kuchie-003.jpg', fileName: 'kuchie-003.jpg' },
          { source: 'src/kuchie-004.jpg', fileName: 'kuchie-004.jpg' },
        ],
      },
      outEpubPath: outPath,
      volume: '11',
      includeSpecials: false,
      modifiedIso: '2026-06-08T00:00:00.000Z',
    });

    const epub = await readEpub(outPath);
    assert.equal(epub.entries['OEBPS/Images/cover.jpg'].toString(), 'cover-from-ref');
    assert.equal(epub.entries['OEBPS/Images/kuchie-002.jpg'].toString(), 'front-supplemented');
    assert.match(epub.entries['OEBPS/Text/illus0001.xhtml'].toString('utf8'), /kuchie-001\.jpg/);
    assert.match(epub.entries['OEBPS/Text/illus0002.xhtml'].toString('utf8'), /kuchie-002\.jpg/);
    assert.match(epub.entries['OEBPS/Text/illus0003.xhtml'].toString('utf8'), /kuchie-003\.jpg/);
    assert.match(epub.entries['OEBPS/Text/illus0004.xhtml'].toString('utf8'), /kuchie-004\.jpg/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('buildLightNovelEpub restores known ruby annotation in volume 11 body text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ln-html-ruby-'));
  const originalFetch = globalThis.fetch;
  try {
    const htmlPath = join(dir, '11.html');
    const refPath = join(dir, 'ref.epub');
    const outPath = join(dir, 'out.epub');
    const rubyHtml = SAMPLE_HTML.replace(
      '　　暑假在昨天告終。',
      '　　「……该不会是这个？『社會資料科學Social Data Science學部』。」',
    );
    await writeFile(htmlPath, rubyHtml, 'utf8');
    await writeEpub(refPath, {
      'META-INF/container.xml': '<container/>',
      'OEBPS/Styles/stylesheet.css': '',
      'OEBPS/Misc/script.js': '',
    });

    globalThis.fetch = async () => ({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });

    await buildLightNovelEpub({
      htmlPath,
      refEpubPath: refPath,
      outEpubPath: outPath,
      volume: '11',
      includeSpecials: false,
      modifiedIso: '2026-06-08T00:00:00.000Z',
    });

    const epub = await readEpub(outPath);
    assert.match(
      epub.entries['OEBPS/Text/chapter0001.xhtml'].toString('utf8'),
      /<ruby>社会数据科学<rt>Social Data Science<\/rt><\/ruby>学部/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('buildLightNovelEpub can use source EPUB images, credit overrides, and ruby annotations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ln-html-epub-source-images-'));
  const originalFetch = globalThis.fetch;
  try {
    const htmlPath = join(dir, '11.html');
    const refPath = join(dir, 'ref.epub');
    const styleRefPath = join(dir, 'style-ref.epub');
    const sourceImagePath = join(dir, 'source-images.epub');
    const outPath = join(dir, 'out.epub');
    await writeFile(htmlPath, SOURCE_IMAGE_HTML, 'utf8');
    await writeEpub(refPath, {
      'META-INF/container.xml': '<container/>',
      'OEBPS/Styles/stylesheet.css': '',
      'OEBPS/Misc/script.js': '',
    });
    await writeEpub(styleRefPath, {
      'OEBPS/Text/title.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><div class="title"><p>STYLE TITLE</p></div></body></html>',
      'OEBPS/Text/summary.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><div class="summary"><p>STYLE SUMMARY</p></div></body></html>',
      'OEBPS/Images/logo.png': Buffer.from('logo'),
    });
    await writeEpub(sourceImagePath, {
      'OEBPS/content.opf': `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf">
  <manifest>
    <item id="cover-page" href="Text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="front1" href="Text/front1.xhtml" media-type="application/xhtml+xml"/>
    <item id="front2" href="Text/front2.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter1" href="Text/chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="back1" href="Text/back1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="cover-page"/>
    <itemref idref="front1"/>
    <itemref idref="front2"/>
    <itemref idref="chapter1"/>
    <itemref idref="back1"/>
  </spine>
</package>`,
      'OEBPS/Text/cover.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="../Images/cover.jpeg"/></body></html>',
      'OEBPS/Text/front1.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="../Images/kuchie-001.jpg"/></body></html>',
      'OEBPS/Text/front2.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="../Images/kuchie-002.jpg"/></body></html>',
      'OEBPS/Text/chapter1.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="../Images/p010.jpg"/></body></html>',
      'OEBPS/Text/back1.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="../Images/kuchie-003.jpg"/></body></html>',
      'OEBPS/Images/cover.jpeg': Buffer.from('source-cover'),
      'OEBPS/Images/kuchie-001.jpg': Buffer.from('source-front-1'),
      'OEBPS/Images/kuchie-002.jpg': Buffer.from('source-front-2'),
      'OEBPS/Images/p010.jpg': Buffer.from('source-body'),
      'OEBPS/Images/kuchie-003.jpg': Buffer.from('source-back'),
    });

    globalThis.fetch = async () => {
      throw new Error('source image build should not fetch HTML image URLs');
    };

    await buildLightNovelEpub({
      htmlPath,
      refEpubPath: refPath,
      styleRefEpubPath: styleRefPath,
      sourceImageEpubPath: sourceImagePath,
      outEpubPath: outPath,
      volume: '11',
      includeSpecials: false,
      creditOverrides: { 图源: '嘻嘻嘻', 录入: '嘻嘻嘻' },
      rubyAnnotations: [
        { text: '社会数据科学Social Data Science', base: '社会数据科学', ruby: 'Social Data Science' },
      ],
      modifiedIso: '2026-06-08T00:00:00.000Z',
    });

    const epub = await readEpub(outPath);
    assert.equal(sha256(epub.entries['OEBPS/Images/cover.jpg']), sha256(Buffer.from('source-cover')));
    assert.equal(sha256(epub.entries['OEBPS/Images/kuchie-001.jpg']), sha256(Buffer.from('source-front-1')));
    assert.equal(sha256(epub.entries['OEBPS/Images/kuchie-002.jpg']), sha256(Buffer.from('source-front-2')));
    assert.equal(sha256(epub.entries['OEBPS/Images/p010.jpg']), sha256(Buffer.from('source-body')));
    assert.equal(sha256(epub.entries['OEBPS/Images/kuchie-003.jpg']), sha256(Buffer.from('source-back')));
    assert.match(epub.entries['OEBPS/Text/illus0002.xhtml'].toString('utf8'), /kuchie-002\.jpg/);
    assert.match(epub.entries['OEBPS/Text/chapter0001.xhtml'].toString('utf8'), /p010\.jpg/);
    assert.match(epub.entries['OEBPS/Text/illus0003.xhtml'].toString('utf8'), /kuchie-003\.jpg/);
    const message = epub.entries['OEBPS/Text/message.xhtml'].toString('utf8');
    assert.match(message, /<p>图源<\/p>[\s\S]*?<p>嘻嘻嘻<\/p>/);
    assert.match(message, /<p>录入<\/p>[\s\S]*?<p>嘻嘻嘻<\/p>/);
    assert.doesNotMatch(message, /大地/);
    assert.match(
      epub.entries['OEBPS/Text/chapter0001.xhtml'].toString('utf8'),
      /<ruby>社会数据科学<rt>Social Data Science<\/rt><\/ruby>学部/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('buildLightNovelEpub recognizes special.xhtml (no numeric suffix) as special group page', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ln-html-special-'));
  const originalFetch = globalThis.fetch;
  try {
    const htmlPath = join(dir, '11.html');
    const refPath = join(dir, 'ref.epub');
    const styleRefPath = join(dir, 'style-ref-special.epub');
    const outPath = join(dir, 'out.epub');
    await writeFile(htmlPath, SAMPLE_HTML, 'utf8');
    await writeEpub(refPath, {
      'META-INF/container.xml': '<container/>',
      'OEBPS/Styles/stylesheet.css': '',
      'OEBPS/Misc/script.js': '',
    });
    await writeEpub(styleRefPath, {
      'OEBPS/content.opf': `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf">
  <manifest>
    <item id="cover" href="Text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="special" href="Text/special.xhtml" media-type="application/xhtml+xml"/>
    <item id="special0001" href="Text/special0001.xhtml" media-type="application/xhtml+xml"/>
    <item id="special0002" href="Text/special0002.xhtml" media-type="application/xhtml+xml"/>
    <item id="illus0007" href="Text/illus0007.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="Text/navigation-documents.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="cover"/>
    <itemref idref="special"/>
    <itemref idref="special0001"/>
    <itemref idref="special0002"/>
    <itemref idref="illus0007"/>
  </spine>
</package>`,
      'OEBPS/Text/title.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><div class="title"><p>STYLE TITLE</p></div></body></html>',
      'OEBPS/Text/special.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>特典合集</title></head><body><img src="../Images/t1.png"/></body></html>',
      'OEBPS/Text/special0001.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>电子书特典</title></head><body><h4>电子书特典</h4></body></html>',
      'OEBPS/Text/special0002.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>虎穴特典</title></head><body><h4>虎穴特典</h4></body></html>',
      'OEBPS/Text/illus0007.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>插图</title></head><body><img src="../Images/bonus-illus.webp"/></body></html>',
      'OEBPS/Images/t1.png': Buffer.from([1]),
      'OEBPS/Images/logo.png': Buffer.from([2]),
      'OEBPS/Images/bonus-illus.webp': Buffer.from([5]),
    });

    globalThis.fetch = async () => ({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });

    await buildLightNovelEpub({
      htmlPath,
      refEpubPath: refPath,
      styleRefEpubPath: styleRefPath,
      outEpubPath: outPath,
      volume: '13',
      includeSpecials: true,
      modifiedIso: '2026-06-09T00:00:00.000Z',
    });

    const epub = await readEpub(outPath);
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const opf = parser.parse(epub.entries['OEBPS/content.opf'].toString('utf8')).package;
    const spine = (Array.isArray(opf.spine.itemref) ? opf.spine.itemref : [opf.spine.itemref])
      .map((item) => item['@_idref']);

    const specialIdx = spine.indexOf('special.xhtml');
    assert.ok(specialIdx >= 0, 'spine 应包含 special.xhtml');
    assert.ok(spine.indexOf('special0001.xhtml') > specialIdx, 'special0001 应在 special 之后');

    const navHtml = epub.entries['OEBPS/Text/navigation-documents.xhtml'].toString('utf8');
    assert.match(navHtml, /special\.xhtml">特典合集<\/a>\s*<ol>\s*<li><a href="special0001\.xhtml">/);

    const ncxContent = epub.entries['OEBPS/toc.ncx'].toString('utf8');
    assert.match(ncxContent, /<text>特典合集<\/text>/);
    assert.match(ncxContent, /<content src="Text\/special.xhtml"\/>\s*<navPoint[^>]*>\s*<navLabel><text>电子书特典/);

    const tocHtml = epub.entries['OEBPS/Text/TOC.xhtml'].toString('utf8');
    assert.match(tocHtml, /电子书特典/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});
