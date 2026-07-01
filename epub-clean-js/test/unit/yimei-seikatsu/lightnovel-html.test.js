import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

import {
  buildLightNovelEpub,
  buildLightNovelEpubFromBook,
  extractArticleHtml,
  parseLightNovelArticle,
  splitLightNovelBook,
  simplifyText,
} from '../../../books/yimei-seikatsu/lightnovel-html/index.js';
import { rubyAnnotationsForVolume } from '../../../src/entries/lightnovel-html-simple-batch.js';
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
    // illus* 插图页（styleRef 的 illus0007 = 日翻卷尾跨页）不再被收入特典区；
    // 卷尾插图改由 book.backImages（台繁源）提供，紧接特典正文页之后。
    assert.deepEqual(spine.slice(-5), [
      'specials0001.xhtml',
      'special0001.xhtml',
      'special0002.xhtml',
      'illus0002.xhtml',
      'illus0003.xhtml',
    ]);
    assert.ok(!spine.includes('illus0007.xhtml'), '日翻卷尾 illus0007 不应被收入');
    assert.match(epub.entries['OEBPS/Text/title.xhtml'].toString('utf8'), /STYLE TITLE/);
    assert.match(epub.entries['OEBPS/Text/summary.xhtml'].toString('utf8'), /STYLE SUMMARY/);
    assert.match(epub.entries['OEBPS/Text/TOC.xhtml'].toString('utf8'), /特典合集/);
    assert.doesNotMatch(epub.entries['OEBPS/Text/TOC.xhtml'].toString('utf8'), />插图</);
    assert.match(epub.entries['OEBPS/Text/TOC.xhtml'].toString('utf8'), /电子书特典　『卡拉OK女子会』/);
    assert.match(epub.entries['OEBPS/Text/navigation-documents.xhtml'].toString('utf8'), /special0001.xhtml/);
    assert.match(epub.entries['OEBPS/toc.ncx'].toString('utf8'), /虎穴特典　『卡拉OK男子会』/);
    assert.ok(epub.entries['OEBPS/Images/t1.png']);
    // STERA ePub++ logo 已移除：制作信息不再展示，且不打包孤儿图片
    assert.ok(!epub.entries['OEBPS/Images/logo.png']);
    assert.doesNotMatch(epub.entries['OEBPS/Text/message.xhtml'].toString('utf8'), /class="logo"|alt="logo"/);
    assert.ok(epub.entries['OEBPS/Images/bonus.png']);
    // 日翻 illus0007 的卷尾图 bonus-illus.webp 不再被收入或打包
    assert.ok(!epub.entries['OEBPS/Images/bonus-illus.webp']);
    assert.match(epub.entries['OEBPS/Text/illus0002.xhtml'].toString('utf8'), /kuchie-002\.jpg/);
    assert.match(epub.entries['OEBPS/Text/illus0003.xhtml'].toString('utf8'), /kuchie-003\.jpg/);
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

test('buildLightNovelEpubFromBook keeps unlisted chapters in spine but out of every TOC', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ln-html-unlisted-chapter-'));
  try {
    const refPath = join(dir, 'ref.epub');
    const outPath = join(dir, 'out.epub');
    await writeEpub(refPath, {
      'META-INF/container.xml': '<container/>',
      'OEBPS/Styles/stylesheet.css': '',
      'OEBPS/Misc/script.js': '',
    });

    await buildLightNovelEpubFromBook({
      title: '义妹生活 another days [台简]',
      volume: 'another-days',
      author: '三河ごーすと',
      illustrator: 'Hiten',
      coverImage: { type: 'image', fileName: 'cover.jpg', src: 'image/cover.jpg', id: 'cover', alt: 'cover' },
      frontImages: [],
      backImages: [],
      preBlocks: [],
      summaryBlocks: [],
      creditBlocks: [],
      chapters: [
        { title: '动画义妹生活第５集随笔（三河ごーすと感想）', blocks: [{ type: 'text', text: '第五集正文。' }] },
        { title: '', includeInToc: false, blocks: [{ type: 'text', text: '不过嘛，她是个擅长撒谎的人，所以也可能只是藏得很好。' }] },
        { title: '动画义妹生活第６集随笔（三河ごーすと感想）', blocks: [{ type: 'text', text: '第六集正文。' }] },
      ],
    }, {
      refEpubPath: refPath,
      outEpubPath: outPath,
      includeSpecials: false,
      sourceImages: {
        cover: { type: 'image', fileName: 'cover.jpg', src: 'image/cover.jpg', id: 'cover', alt: 'cover', mediaType: 'image/jpeg', buffer: Buffer.from([1]) },
        front: [],
        body: [],
        back: [],
      },
      modifiedIso: '2026-07-01T00:00:00.000Z',
    });

    const epub = await readEpub(outPath);
    const toc = epub.entries['OEBPS/Text/TOC.xhtml'].toString('utf8');
    const nav = epub.entries['OEBPS/Text/navigation-documents.xhtml'].toString('utf8');
    const ncx = epub.entries['OEBPS/toc.ncx'].toString('utf8');
    const opf = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
      .parse(epub.entries['OEBPS/content.opf'].toString('utf8')).package;
    const spine = (Array.isArray(opf.spine.itemref) ? opf.spine.itemref : [opf.spine.itemref])
      .map((item) => item['@_idref']);

    assert.ok(spine.includes('chapter0002.xhtml'), 'unlisted chapter should remain in spine');
    assert.match(epub.entries['OEBPS/Text/chapter0002.xhtml'].toString('utf8'), /不过嘛，她是个擅长撒谎的人/);
    assert.doesNotMatch(epub.entries['OEBPS/Text/chapter0002.xhtml'].toString('utf8'), /<h3>\s*<\/h3>/);
    assert.doesNotMatch(toc, /不过嘛，她是个擅长撒谎的人/);
    assert.doesNotMatch(nav, /不过嘛，她是个擅长撒谎的人/);
    assert.doesNotMatch(ncx, /不过嘛，她是个擅长撒谎的人/);
    assert.match(toc, /动画义妹生活第５集随笔/);
    assert.match(toc, /动画义妹生活第６集随笔/);
    assert.doesNotMatch(epub.entries['OEBPS/content.opf'].toString('utf8'), /Text\/pre\.xhtml/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('buildLightNovelEpubFromBook applies another-days fixed 日翻 notes while keeping 台版 inline notes clickable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ln-html-another-days-notes-'));
  try {
    const refPath = join(dir, 'ref.epub');
    const outPath = join(dir, 'out.epub');
    await writeEpub(refPath, {
      'META-INF/container.xml': '<container/>',
      'OEBPS/Styles/stylesheet.css': '',
      'OEBPS/Misc/script.js': '',
    });

    const externalNovelBlocks = Array.from({ length: 26 }, (_, index) => ({
      type: 'text',
      text: `占位段落${index}。`,
    }));
    externalNovelBlocks[25] = {
      type: 'text',
      text: '真要说起来，我的名字就是读卖栞。把书签夹在书里，读完后卖掉。先不论「读完的书到底要不要卖」，我这种人若在推理作品中登场，不是侦探就是尸体吧（註：日文中，「栞」的常用字义之一为书签）。',
    };

    await buildLightNovelEpubFromBook({
      title: '义妹生活 another days [台简]',
      volume: 'another-days',
      author: '三河ごーすと',
      illustrator: 'Hiten',
      coverImage: { type: 'image', fileName: 'cover.jpg', src: 'image/cover.jpg', id: 'cover', alt: 'cover' },
      frontImages: [],
      backImages: [],
      preBlocks: [],
      summaryBlocks: [],
      creditBlocks: [],
      chapters: [
        { title: '前言', blocks: [{ type: 'text', text: '前言正文。' }] },
        {
          title: '动画义妹生活第１集随笔（三河ごーすと感想）',
          blocks: [
            { type: 'text', text: '第一段。' },
            { type: 'text', text: '最后我和责编决定用「恋爱生活小说」这个称呼。' },
          ],
        },
        ...Array.from({ length: 12 }, (_, index) => ({
          title: `占位章${index + 3}`,
          blocks: [{ type: 'text', text: `占位正文${index + 3}。` }],
        })),
        { title: '外传小说《Goodbye》读卖栞', blocks: externalNovelBlocks },
      ],
    }, {
      refEpubPath: refPath,
      outEpubPath: outPath,
      includeSpecials: false,
      sourceImages: {
        cover: { type: 'image', fileName: 'cover.jpg', src: 'image/cover.jpg', id: 'cover', alt: 'cover', mediaType: 'image/jpeg', buffer: Buffer.from([1]) },
        front: [],
        body: [],
        back: [],
      },
      modifiedIso: '2026-07-01T00:00:00.000Z',
    });

    const epub = await readEpub(outPath);
    const episode1 = epub.entries['OEBPS/Text/chapter0002.xhtml'].toString('utf8');
    const goodbye = epub.entries['OEBPS/Text/chapter0015.xhtml'].toString('utf8');

    assert.match(episode1, /重视人物日常、心理活动与人际关系的剧情作品/);
    assert.match(episode1, /恋爱生活小说<\/ruby>|恋爱生活小说/);
    assert.match(episode1, /class="duokan-footnote"/);
    assert.match(goodbye, /日文中，「栞」的常用字义之一为书签/);
    assert.match(goodbye, /class="duokan-footnote"/);
    assert.doesNotMatch(goodbye, /（註：/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('buildLightNovelEpubFromBook uses leading illustration pages as another-days TOC targets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ln-html-another-days-toc-'));
  try {
    const refPath = join(dir, 'ref.epub');
    const styleRefPath = join(dir, 'style-ref.epub');
    const outPath = join(dir, 'out.epub');
    await writeEpub(refPath, {
      'META-INF/container.xml': '<container/>',
      'OEBPS/Styles/stylesheet.css': '',
      'OEBPS/Misc/script.js': '',
    });
    await writeEpub(styleRefPath, {
      'OEBPS/Text/TOC.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:xml="http://www.w3.org/XML/1998/namespace">
<head>
 <title>目录</title>
 <link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
 <script type="text/javascript" src="../Misc/script.js"></script>
 <style>
 body{-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;background-color:#ddd !important;}
 .ctt{font-family:illus1,emoji,sym;text-align:center;font-size:2em;margin:1em 0 0;font-weight:bold;color:#fff;text-shadow:0 0 3px #777;}
 .toc{margin:0.5em 0;text-align:center;border-left:0;border-bottom:1px solid #fff;padding-bottom:0.5em;}
 .toc a{display:block;font-family:ctt1,emoji,sym;padding:0.25em 0 0.1em;color:#000;}
 .toc a p{line-height:1.1em;}
 .toc .ctit{font-family:ctt1,emoji,sym;font-size:0.8em;padding:0.1em 0 0;color:#4f4d4e;}
 .c1{color:#4f4d4e;}
 .dbox,.ebox{background-color:#5b5758;color:#fff;padding:0.06em 0.2em 0;}
 .ebox{background-color:#000;}
 </style>
</head>
<body bgcolor="#ddd"><div style="margin:0 auto 1em;width:fit-content;-webkit-transform:rotate(-2deg);transform:rotate(-2deg);transform-origin:center;"></div></body>
</html>`,
    });

    await buildLightNovelEpubFromBook({
      title: '义妹生活 another days [台简]',
      volume: 'another-days',
      author: '三河ごーすと',
      illustrator: 'Hiten',
      coverImage: { type: 'image', fileName: 'cover.jpg', src: 'image/cover.jpg', id: 'cover', alt: 'cover' },
      frontImages: [],
      backImages: [],
      preBlocks: [],
      summaryBlocks: [],
      creditBlocks: [],
      chapters: [
        { title: '前言', blocks: [{ type: 'text', text: '前言正文。' }] },
        { title: '动画义妹生活第１集随笔（三河ごーすと感想）', blocks: [{ type: 'image', fileName: 'kuchie-006.jpg' }, { type: 'text', text: '第一集正文。' }] },
        { title: '动画义妹生活第２集随笔（三河ごーすと感想）', blocks: [{ type: 'image', fileName: 'kuchie-007.jpg' }, { type: 'text', text: '第二集正文。' }] },
        { title: '动画义妹生活第３集随笔（三河ごーすと感想）', blocks: [{ type: 'image', fileName: 'kuchie-008.jpg' }, { type: 'text', text: '第三集正文。' }] },
        { title: '外传小说《Goodbye》读卖栞', blocks: [{ type: 'text', text: '外传正文。' }] },
      ],
    }, {
      refEpubPath: refPath,
      styleRefEpubPath: styleRefPath,
      outEpubPath: outPath,
      includeSpecials: false,
      sourceImages: {
        cover: { type: 'image', fileName: 'cover.jpg', src: 'image/cover.jpg', id: 'cover', alt: 'cover', mediaType: 'image/jpeg', buffer: Buffer.from([1]) },
        front: [],
        body: [
          { type: 'image', fileName: 'kuchie-006.jpg', src: 'image/kuchie-006.jpg', id: 'kuchie-006', alt: 'kuchie-006', mediaType: 'image/jpeg', buffer: Buffer.from([2]) },
          { type: 'image', fileName: 'kuchie-007.jpg', src: 'image/kuchie-007.jpg', id: 'kuchie-007', alt: 'kuchie-007', mediaType: 'image/jpeg', buffer: Buffer.from([3]) },
          { type: 'image', fileName: 'kuchie-008.jpg', src: 'image/kuchie-008.jpg', id: 'kuchie-008', alt: 'kuchie-008', mediaType: 'image/jpeg', buffer: Buffer.from([4]) },
        ],
        back: [],
      },
      modifiedIso: '2026-07-01T00:00:00.000Z',
    });

    const epub = await readEpub(outPath);
    const toc = epub.entries['OEBPS/Text/TOC.xhtml'].toString('utf8');
    const nav = epub.entries['OEBPS/Text/navigation-documents.xhtml'].toString('utf8');
    const ncx = epub.entries['OEBPS/toc.ncx'].toString('utf8');

    assert.match(toc, /background-color:#ddd/);
    assert.match(toc, /<span class="dbox">动画<\/span>/);
    assert.match(toc, /义<span class="c1">妹<\/span>生活第３集随笔/);
    assert.doesNotMatch(toc, /第３话的感想/);
    assert.match(toc, /\.toc \.ctit\{font-family:"Source Han Serif SC SemiBold";font-size:0\.8em;padding:0\.25em 0 0;line-height:1\.15em;color:#4f4d4e\}/);
    assert.doesNotMatch(toc, /\.toc \.ctit\{[^}]*text-align:left/);
    assert.match(toc, /<p class="ctit">　　（三河ごーすと感想）<\/p>/);
    assert.match(toc, /<span class="ebox">外传小说<\/span>[\s\S]*《Goodbye》读卖栞/);
    assert.doesNotMatch(toc, /「Goodbye」读卖栞/);
    assert.match(toc, /href="illus0003\.xhtml"[\s\S]*第３集随笔/);
    assert.doesNotMatch(toc, /href="chapter0004\.xhtml"[\s\S]*第３集随笔/);
    assert.match(nav, /href="illus0003\.xhtml">动画义妹生活第３集随笔（三河ごーすと感想）<\/a>/);
    assert.doesNotMatch(nav, /href="chapter0004\.xhtml">动画义妹生活第３集随笔（三河ごーすと感想）<\/a>/);
    assert.match(ncx, /<text>动画义妹生活第３集随笔（三河ごーすと感想）<\/text>\s*<\/navLabel>\s*<content src="Text\/illus0003\.xhtml"\/>/);
    assert.doesNotMatch(ncx, /<text>动画义妹生活第３集随笔（三河ごーすと感想）<\/text>\s*<\/navLabel>\s*<content src="Text\/chapter0004\.xhtml"\/>/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('buildLightNovelEpub normalizes flat style-ref title page to 13-style layout with volume 08 colors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ln-html-flat-title-'));
  const originalFetch = globalThis.fetch;
  try {
    const htmlPath = join(dir, '08.html');
    const refPath = join(dir, 'ref.epub');
    const styleRefPath = join(dir, 'style-ref-flat.epub');
    const outPath = join(dir, 'out.epub');
    await writeFile(htmlPath, SAMPLE_HTML, 'utf8');
    await writeEpub(refPath, {
      'META-INF/container.xml': '<container/>',
      'OEBPS/Styles/stylesheet.css': '',
      'OEBPS/Misc/script.js': '',
    });
    await writeEpub(styleRefPath, {
      'Text/title.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml">
<head><link rel="stylesheet" type="text/css" href="../css.css"/></head>
<body class="calibre1">
<div class="title">
<img alt="t1" src="../Images/t1.webp" class="calibre18"/>
<img alt="t2" src="../Images/t2.webp" class="calibre19"/>
<img alt="t3" src="../Images/t3.webp" class="calibre20"/>
<img alt="t4" src="../Images/t4.webp" class="calibre21"/>
</div>
</body></html>`,
      'Images/t1.webp': Buffer.from([11]),
      'Images/t2.webp': Buffer.from([12]),
      'Images/t3.webp': Buffer.from([13]),
      'Images/t4.webp': Buffer.from([14]),
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
      volume: '08',
      modifiedIso: '2026-06-11T00:00:00.000Z',
    });

    const epub = await readEpub(outPath);
    const title = epub.entries['OEBPS/Text/title.xhtml'].toString('utf8');
    assert.match(title, /\.textbox\{font-family:[^}]*\}/);
    assert.match(title, /\.textbox p\{[^}]*text-align:center[^}]*font-weight:bold/);
    assert.match(title, /\.textbox \.c1\{font-size:0\.8em;color:#EB6161/);
    assert.match(title, /\.textbox \.c2\{font-size:1\.1em;padding:0\.2em 0 1\.5em/);
    assert.match(title, /\.textbox \.c3\{font-size:0\.8em;color:#E1C851/);
    assert.match(title, /\.textbox \.c4\{font-size:1em;padding:0\.15em 0 0/);
    assert.match(title, /<div class="center" style="margin:4em auto 1em;">/);
    assert.match(title, /<div class="center" style="margin:1em auto 2.5em;">/);
    assert.match(title, /<div class="textbox">/);
    assert.match(title, /<p class="c1">作者<\/p>/);
    assert.match(title, /<p class="c3">插画<\/p>/);
    assert.match(title, /src="\.\.\/Images\/t1\.webp" style="width:13em;"/);
    assert.match(title, /src="\.\.\/Images\/t2\.webp" style="width:1\.5em;"/);
    assert.match(title, /src="\.\.\/Images\/t3\.webp" style="width:5em;"/);
    assert.match(title, /src="\.\.\/Images\/t4\.webp" style="width:3em;"/);
    assert.doesNotMatch(title, /center1|center2|calibre1[789]|calibre2[01]|css\.css|page_css\.css/);
    assert.deepEqual([...epub.entries['OEBPS/Images/t1.webp']], [11]);
    assert.deepEqual([...epub.entries['OEBPS/Images/t4.webp']], [14]);
    const opf = epub.entries['OEBPS/content.opf'].toString('utf8');
    assert.match(opf, /href="Images\/t1\.webp"/);
    assert.match(opf, /href="Images\/t4\.webp"/);
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

test('rubyAnnotationsForVolume returns the three known ruby rules for volume 13', () => {
  assert.deepEqual(rubyAnnotationsForVolume('13'), [
    { text: '浅村Asamura', base: '浅村', ruby: 'Asamura' },
    { text: '大山千春OoyamaChiharu', base: '大山千春', ruby: 'Ooyama Chiharu' },
    { text: '水星我们学校', base: '水星', ruby: '我们学校' },
  ]);
});

test('buildLightNovelEpub restores the three known ruby annotations in volume 13 body text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ln-html-ruby13-'));
  const originalFetch = globalThis.fetch;
  try {
    const htmlPath = join(dir, '13.html');
    const refPath = join(dir, 'ref.epub');
    const outPath = join(dir, 'out.epub');
    // 注入三处 hyread ruby 摊平后的繁体形态（淺村Asamura / 大山千春OoyamaChiharu / 水星我們學校），
    // 经简化 + 卷13 ruby 规则后应重建为真 ruby。
    const rubyHtml = SAMPLE_HTML.replace(
      '　　暑假在昨天告終。',
      '　　「淺村Asamura」「大山千春OoyamaChiharu」「水星我們學校」',
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
      volume: '13',
      includeSpecials: false,
      modifiedIso: '2026-06-08T00:00:00.000Z',
    });

    const epub = await readEpub(outPath);
    const chapter = epub.entries['OEBPS/Text/chapter0001.xhtml'].toString('utf8');
    assert.match(chapter, /<ruby>浅村<rt>Asamura<\/rt><\/ruby>/);
    assert.match(chapter, /<ruby>大山千春<rt>Ooyama Chiharu<\/rt><\/ruby>/);
    assert.match(chapter, /<ruby>水星<rt>我们学校<\/rt><\/ruby>/);
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

test('buildLightNovelEpubFromBook names an image-only special group as 特典合集', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ln-html-special-group-fallback-'));
  try {
    const refPath = join(dir, 'ref.epub');
    const styleRefPath = join(dir, 'style-ref-special-fallback.epub');
    const outPath = join(dir, 'out.epub');
    await writeEpub(refPath, {
      'META-INF/container.xml': '<container/>',
      'OEBPS/Styles/stylesheet.css': '',
      'OEBPS/Misc/script.js': '',
    });
    await writeEpub(styleRefPath, {
      'OEBPS/content.opf': `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf">
  <manifest>
    <item id="special" href="Text/special.xhtml" media-type="application/xhtml+xml"/>
    <item id="special0001" href="Text/special0001.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="special"/>
    <itemref idref="special0001"/>
  </spine>
</package>`,
      'OEBPS/Text/special.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>插图</title></head><body><img src="../Images/t1.png"/></body></html>',
      'OEBPS/Text/special0001.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>电子书特典</title></head><body><h4>电子书特典</h4></body></html>',
      'OEBPS/Images/t1.png': Buffer.from([1]),
    });

    await buildLightNovelEpubFromBook({
      title: '义妹生活 another days [台简]',
      volume: 'another-days',
      author: '三河ごーすと',
      illustrator: 'Hiten',
      coverImage: { type: 'image', fileName: 'cover.jpg', src: 'image/cover.jpg', id: 'cover', alt: 'cover' },
      frontImages: [],
      backImages: [],
      preBlocks: [],
      summaryBlocks: [],
      creditBlocks: [],
      chapters: [{ title: '前言', blocks: [{ type: 'text', text: '正文。' }] }],
    }, {
      refEpubPath: refPath,
      styleRefEpubPath: styleRefPath,
      outEpubPath: outPath,
      includeSpecials: true,
      sourceImages: {
        cover: { type: 'image', fileName: 'cover.jpg', src: 'image/cover.jpg', id: 'cover', alt: 'cover', mediaType: 'image/jpeg', buffer: Buffer.from([1]) },
        front: [],
        body: [],
        back: [],
      },
      modifiedIso: '2026-07-01T00:00:00.000Z',
    });

    const epub = await readEpub(outPath);
    const toc = epub.entries['OEBPS/Text/TOC.xhtml'].toString('utf8');
    const nav = epub.entries['OEBPS/Text/navigation-documents.xhtml'].toString('utf8');
    const ncx = epub.entries['OEBPS/toc.ncx'].toString('utf8');

    assert.match(toc, /特典合集/);
    assert.doesNotMatch(toc, />插图</);
    assert.match(nav, /special\.xhtml">特典合集<\/a>\s*<ol>/);
    assert.match(ncx, /<text>特典合集<\/text>/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
