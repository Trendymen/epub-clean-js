import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  renderChapter,
  isFirstParaEpigraph,
} from '../../../books/yimei-seikatsu/migrate/chapter-renderer.js';

// ---------------------------------------------------------------------------
// renderChapter 基础渲染
// ---------------------------------------------------------------------------

test('renderChapter: basic chapter', () => {
  const html = renderChapter({
    title: '6月12日（星期六）　浅村悠太',
    blocks: ['第一段', '第二段'],
    footnoteAsides: [],
  });
  assert.ok(html.includes('<title>6月12日'));
  assert.ok(html.includes('<h3>6月12日（星期六）　浅村悠太</h3>'));
  assert.ok(html.includes('<p>第一段</p>'));
  assert.ok(html.includes('<p>第二段</p>'));
  assert.ok(html.includes('../Styles/stylesheet.css'));
  assert.ok(html.includes('../Misc/script.js'));
  assert.ok(!html.includes('<note>'));
});

test('renderChapter: inline sup + asides (legacy footnoteAsides, deprecated)', () => {
  // 旧接口：footnoteAsides 仍可调用但模板不再渲染（asides 不出现在输出里）；
  // 函数会打 deprecation warning（这里只验证签名不报错）。
  const origWarn = console.warn;
  let warned = false;
  console.warn = (...args) => {
    if (String(args[0]).includes('footnoteAsides')) warned = true;
  };
  try {
    const html = renderChapter({
      title: '带注释章节',
      blocks: ['这是含 <sup><a>note</a></sup> 的段落', '后续段落'],
      footnoteAsides: ['<aside id="note001">...</aside>'],
    });
    assert.ok(html.includes('<sup>'));
    assert.ok(warned, '应该输出 footnoteAsides deprecation warning');
  } finally {
    console.warn = origWarn;
  }
});

test('renderChapter: inline illus div not wrapped in <p>', () => {
  const html = renderChapter({
    title: '章',
    blocks: [
      '段一',
      '<div class="illus duokan-image-single"><img src="../Images/p039.webp" zy-enlarge-src="self"/></div>',
      '段二',
    ],
    footnoteAsides: [],
  });
  assert.ok(html.includes('<p>段一</p>'));
  assert.ok(html.includes('<p>段二</p>'));
  assert.ok(!html.includes('<p><div'));
  assert.ok(html.includes('<div class="illus duokan-image-single">'));
});

// ---------------------------------------------------------------------------
// isFirstParaEpigraph
// ---------------------------------------------------------------------------

test('isFirstParaEpigraph: matching string returns true', () => {
  const epi = '这是引言文本。';
  assert.equal(isFirstParaEpigraph('这是引言文本。', epi), true);
});

test('isFirstParaEpigraph: non-matching string returns false', () => {
  assert.equal(isFirstParaEpigraph('完全不同的首段', '这是引言文本。'), false);
});

test('isFirstParaEpigraph: empty epigraph returns false', () => {
  assert.equal(isFirstParaEpigraph('任意首段', ''), false);
  assert.equal(isFirstParaEpigraph('任意首段', null), false);
  assert.equal(isFirstParaEpigraph('任意首段', undefined), false);
});

test('isFirstParaEpigraph: dict firstPara extracts .para correctly', () => {
  const epi = '引言段落';
  assert.equal(
    isFirstParaEpigraph({ para: '引言段落', aside: '<aside>x</aside>' }, epi),
    true,
  );
  assert.equal(
    isFirstParaEpigraph({ para: '别的段落', aside: '<aside>x</aside>' }, epi),
    false,
  );
});

test('isFirstParaEpigraph: trims whitespace before hashing', () => {
  assert.equal(isFirstParaEpigraph('  引言文本  ', '引言文本'), true);
});

// ---------------------------------------------------------------------------
// chapterNumber + epigraph 去重
// ---------------------------------------------------------------------------

test('renderChapter: chapter 1 with matching epigraph drops first para', () => {
  const html = renderChapter({
    title: '第一章',
    blocks: ['引言文本', '正文第一段', '正文第二段'],
    footnoteAsides: [],
    chapterNumber: 1,
    epigraph: '引言文本',
  });
  assert.ok(!html.includes('<p>引言文本</p>'), '匹配的引言段应被去掉');
  assert.ok(html.includes('<p>正文第一段</p>'));
  assert.ok(html.includes('<p>正文第二段</p>'));
});

test('renderChapter: chapter 1 with mismatched epigraph keeps first para and warns', () => {
  const origWarn = console.warn;
  let warned = false;
  console.warn = (...args) => {
    if (String(args[0]).includes('hash mismatch')) warned = true;
  };
  try {
    const html = renderChapter({
      title: '第一章',
      blocks: ['一个完全不同的首段', '正文'],
      footnoteAsides: [],
      chapterNumber: 1,
      epigraph: '原本的引言文本',
    });
    assert.ok(html.includes('<p>一个完全不同的首段</p>'));
    assert.ok(html.includes('<p>正文</p>'));
    assert.ok(warned, '应当打印 hash mismatch warning');
  } finally {
    console.warn = origWarn;
  }
});

test('renderChapter: chapter 2 never strips first para even if it matches', () => {
  const html = renderChapter({
    title: '第二章',
    blocks: ['引言文本', '正文'],
    footnoteAsides: [],
    chapterNumber: 2,
    epigraph: '引言文本',
  });
  assert.ok(html.includes('<p>引言文本</p>'), 'chapter≠1 时首段必须保留');
  assert.ok(html.includes('<p>正文</p>'));
});

test('renderChapter: chapter 1 without epigraph keeps all blocks', () => {
  const html = renderChapter({
    title: '第一章',
    blocks: ['任意首段', '正文'],
    footnoteAsides: [],
    chapterNumber: 1,
    // epigraph 未提供
  });
  assert.ok(html.includes('<p>任意首段</p>'));
  assert.ok(html.includes('<p>正文</p>'));
});

// ---------------------------------------------------------------------------
// dict block 渲染：<p>...</p><aside>...</aside> 平铺（与 Python golden 对齐）
// ---------------------------------------------------------------------------

test('renderChapter: dict block renders p + aside flat (no <note> wrapper)', () => {
  const html = renderChapter({
    title: '注释章节',
    blocks: [
      {
        para: '这段话有<sup><a href="#n001">[注]</a></sup>注释',
        aside: '<aside id="n001"><p>注释正文</p></aside>',
      },
    ],
  });
  // byte-level 一致化要求不再包 <note>
  assert.ok(!html.includes('<note>'), '不再生成 <note> 容器（与 Python golden 对齐）');
  assert.ok(!html.includes('</note>'), '不应出现 </note>');
  assert.ok(html.includes('<p>这段话有<sup><a href="#n001">[注]</a></sup>注释</p>'));
  assert.ok(html.includes('<aside id="n001"><p>注释正文</p></aside>'));

  // 顺序：<p> 在 <aside> 之前，且 aside 紧跟 p 之后
  const idxP = html.indexOf('<p>这段话');
  const idxAside = html.indexOf('<aside id="n001"');
  assert.ok(idxP >= 0 && idxP < idxAside, '<p> 在 <aside> 之前');
});

test('renderChapter: mixed blocks (string + dict + <div) all render correctly', () => {
  const html = renderChapter({
    title: '混合章节',
    blocks: [
      '普通段落 A',
      {
        para: '含注释段落<sup><a>n1</a></sup>',
        aside: '<aside id="n1">注释 1</aside>',
      },
      '<div class="illus"><img src="x.webp"/></div>',
      '普通段落 B',
    ],
  });
  // 4 个 block 全部出现（不再用 <note> 包）
  assert.ok(html.includes('<p>普通段落 A</p>'));
  assert.ok(!html.includes('<note>'), '不再生成 <note> 容器');
  assert.ok(html.includes('<p>含注释段落<sup><a>n1</a></sup></p>'));
  assert.ok(html.includes('<aside id="n1">注释 1</aside>'));
  assert.ok(html.includes('<div class="illus">'));
  assert.ok(!html.includes('<p><div'), '<div 块不能被 <p> 包裹');
  assert.ok(html.includes('<p>普通段落 B</p>'));

  // 顺序：A → dict.p → dict.aside → div → B
  const idxA = html.indexOf('普通段落 A');
  const idxDictP = html.indexOf('<p>含注释段落');
  const idxDictAside = html.indexOf('<aside id="n1"');
  const idxDiv = html.indexOf('<div class="illus">');
  const idxB = html.indexOf('普通段落 B');
  assert.ok(idxA < idxDictP);
  assert.ok(idxDictP < idxDictAside);
  assert.ok(idxDictAside < idxDiv);
  assert.ok(idxDiv < idxB);
});

test('renderChapter: dict block also works inside chapter 1 epigraph-strip path', () => {
  // chapter 1 第一段是 dict（含引言文本），epigraph 与 dict.para 匹配 → 去掉首段
  const html = renderChapter({
    title: '第一章',
    blocks: [
      { para: '引言段落', aside: '<aside id="zero">x</aside>' },
      '正文',
    ],
    chapterNumber: 1,
    epigraph: '引言段落',
  });
  assert.ok(!html.includes('<aside id="zero"'), '首段是 dict 也应被整体去掉');
  assert.ok(!html.includes('<note>'), '不再生成 <note> 容器');
  assert.ok(html.includes('<p>正文</p>'));
});
