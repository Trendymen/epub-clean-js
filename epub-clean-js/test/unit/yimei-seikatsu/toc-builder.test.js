import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTocNcx,
  buildNavXhtml,
  buildTocXhtml,
  normalizeSpace,
  flatten,
} from '../../../books/yimei-seikatsu/migrate/toc-builder.js';

test('buildTocNcx: basic structure', () => {
  const entries = [
    { title: '6月12日 浅村悠太', href: 'chapter0001.xhtml' },
    { title: '6月12日 绫濑沙季', href: 'chapter0002.xhtml' },
  ];
  const ncx = buildTocNcx({ title: '义妹生活 09', uuid: 'abc-123', entries });
  assert.ok(ncx.includes('<docTitle><text>义妹生活 09</text></docTitle>'));
  assert.ok(ncx.includes('<text>6月12日 浅村悠太</text>'));
  assert.ok(ncx.includes('src="chapter0001.xhtml"'));
});

test('buildNavXhtml: contains epub:type and link', () => {
  const entries = [{ title: '封面', href: 'cover.xhtml' }];
  const nav = buildNavXhtml({ title: '目录', entries });
  assert.ok(nav.includes('epub:type="toc"'));
  assert.ok(nav.includes('<a href="cover.xhtml">封面</a>'));
});

test('buildTocXhtml: title + entry', () => {
  const entries = [{ title: '序章', href: 'chapter0001.xhtml' }];
  const toc = buildTocXhtml({ entries });
  assert.ok(toc.includes('<h3>目录</h3>'));
  assert.ok(toc.includes('<a href="chapter0001.xhtml">序章</a>'));
});

// ---- normalizeSpace ----

test('normalizeSpace: 全角空格 U+3000 → 半角空格', () => {
  const entries = [{ title: '6月12日　浅村悠太', href: 'a.xhtml' }];
  const out = normalizeSpace(entries);
  assert.equal(out[0].title, '6月12日 浅村悠太');
  assert.equal(out[0].href, 'a.xhtml');
});

test('normalizeSpace: 递归处理 children', () => {
  const entries = [
    {
      title: '父　节点',
      href: 'p.xhtml',
      children: [{ title: '子　节点', href: 'c.xhtml' }],
    },
  ];
  const out = normalizeSpace(entries);
  assert.equal(out[0].title, '父 节点');
  assert.equal(out[0].children[0].title, '子 节点');
});

// ---- flatten ----

test('flatten: 单层 entries 直传（无变化）', () => {
  const entries = [
    { title: 'A', href: 'a.xhtml' },
    { title: 'B', href: 'b.xhtml' },
  ];
  const out = flatten(entries);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { title: 'A', href: 'a.xhtml' });
  assert.deepEqual(out[1], { title: 'B', href: 'b.xhtml' });
});

test('flatten: 含 children 嵌套 → 平铺', () => {
  const entries = [
    {
      title: '父',
      href: 'p.xhtml',
      children: [
        { title: '子1', href: 'c1.xhtml' },
        { title: '子2', href: 'c2.xhtml' },
      ],
    },
    { title: '兄', href: 'b.xhtml' },
  ];
  const out = flatten(entries);
  assert.equal(out.length, 4);
  assert.deepEqual(out[0], { title: '父', href: 'p.xhtml' });
  assert.deepEqual(out[1], { title: '子1', href: 'c1.xhtml' });
  assert.deepEqual(out[2], { title: '子2', href: 'c2.xhtml' });
  assert.deepEqual(out[3], { title: '兄', href: 'b.xhtml' });
  // 平铺后不再带 children
  for (const e of out) {
    assert.equal(e.children, undefined);
  }
});

// ---- buildTocNcx: 嵌套 + 全角空格 ----

test('buildTocNcx: 嵌套 entries 保留嵌套结构 + 全角空格转半角', () => {
  const entries = [
    {
      title: '第一卷　开端',
      href: 'v1.xhtml',
      children: [
        { title: '第1章　相遇', href: 'c1.xhtml' },
        { title: '第2章　日常', href: 'c2.xhtml' },
      ],
    },
  ];
  const ncx = buildTocNcx({ title: 'T', uuid: 'u', entries });
  // 嵌套：父 + 子1 + 子2 = 3 个 navPoint
  const navPoints = ncx.match(/<navPoint /g) || [];
  assert.equal(navPoints.length, 3);
  // 全角空格已替换为半角
  assert.ok(ncx.includes('<text>第一卷 开端</text>'));
  assert.ok(ncx.includes('<text>第1章 相遇</text>'));
  assert.ok(ncx.includes('<text>第2章 日常</text>'));
  // 不含全角空格
  assert.ok(!ncx.includes('　'));
  // 嵌套：子 navPoint 在父 navPoint 之内（父 content 之后、父 close 之前）
  // 即父开标签后必须先出现子开标签，再出现父关标签
  const parentOpen = ncx.indexOf('<navPoint id="navPoint-1"');
  const childOpen = ncx.indexOf('<navPoint id="navPoint-2"');
  const parentClose = ncx.indexOf('</navPoint>', childOpen);
  assert.ok(parentOpen >= 0 && childOpen > parentOpen);
  assert.ok(parentClose > childOpen);
  // depth=2（含 children）
  assert.ok(ncx.includes('<meta name="dtb:depth" content="2"/>'));
});

test('buildTocNcx: 平铺 entries 时 depth=1', () => {
  const entries = [
    { title: 'A', href: 'a.xhtml' },
    { title: 'B', href: 'b.xhtml' },
  ];
  const ncx = buildTocNcx({ title: 'T', uuid: 'u', entries });
  assert.ok(ncx.includes('<meta name="dtb:depth" content="1"/>'));
  const navPoints = ncx.match(/<navPoint /g) || [];
  assert.equal(navPoints.length, 2);
});

// ---- buildNavXhtml: 全角空格 ----

test('buildNavXhtml: 全角空格转半角', () => {
  const entries = [{ title: '封面　页', href: 'cover.xhtml' }];
  const nav = buildNavXhtml({ title: '目录', entries });
  assert.ok(nav.includes('<a href="cover.xhtml">封面 页</a>'));
  assert.ok(!nav.includes('　'));
});

// ---- buildTocXhtml: 全角空格 ----

test('buildTocXhtml: 全角空格转半角', () => {
  const entries = [{ title: '序　章', href: 'chapter0001.xhtml' }];
  const toc = buildTocXhtml({ entries });
  assert.ok(toc.includes('<a href="chapter0001.xhtml">序 章</a>'));
  assert.ok(!toc.includes('　'));
});

test('buildTocXhtml: 嵌套 entries 平铺渲染', () => {
  const entries = [
    {
      title: '父',
      href: 'p.xhtml',
      children: [{ title: '子', href: 'c.xhtml' }],
    },
  ];
  const toc = buildTocXhtml({ entries });
  // 父 + 子 两个 li
  assert.ok(toc.includes('<a href="p.xhtml">父</a>'));
  assert.ok(toc.includes('<a href="c.xhtml">子</a>'));
});
