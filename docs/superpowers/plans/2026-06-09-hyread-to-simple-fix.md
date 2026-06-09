# hyread-to-simple 卷13转换修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 hyread-to-simple 管线卷13转换的三个bug：特典group标题乱套、章节标题未繁转简。

**Architecture:** 两处最小改动：① `collectSpecialEntries()` 扩展 regex 匹配无数字后缀的 `special.xhtml` ② `parseHyreadEpubToBook()` 对 TOC 标题和章节标题补 `simplifyText()`。外加两个测试用例验证修复。

**Tech Stack:** Node 22 ESM, linkedom, opencc-js, fast-xml-parser, adm-zip

---

## 文件映射

| 文件 | 角色 | 变更 |
|---|---|---|
| `books/yimei-seikatsu/lightnovel-html/index.js:665,677,707` | collectSpecialEntries regex + 条件 | 修改 |
| `books/yimei-seikatsu/hyread-parser.js:182,253,268` | 繁转简标题 | 修改 |
| `test/unit/yimei-seikatsu/lightnovel-html.test.js` | special.xhtml group页测试 | 在现有测试中加验证 |
| `test/unit/yimei-seikatsu/lightnovel-html-simple-batch.test.js` | 繁转简测试 | 新增测试用例 |

---

### Task 1: 修复 collectSpecialEntries — SPECIAL_PAGE_RE + spine 搜索 + includeInToc

**Files:**
- Modify: `books/yimei-seikatsu/lightnovel-html/index.js:665`
- Modify: `books/yimei-seikatsu/lightnovel-html/index.js:677`
- Modify: `books/yimei-seikatsu/lightnovel-html/index.js:707`

- [ ] **Step 1: 修改 SPECIAL_PAGE_RE (L665)**

```js
// OLD
const SPECIAL_PAGE_RE = /^(specials\d+|special\d+|illus\d+)(\.xhtml)?$/;

// NEW — idref 可带数字后缀也可不带（special、specials）
const SPECIAL_PAGE_RE = /^(specials\d*|special\d*|illus\d+)(\.xhtml)?$/;
```

- [ ] **Step 2: 修改 spine 搜索起始条件 (L677)**

```js
// OLD
const startIdx = spineInfo.spine.findIndex((idref) => /^specials\d+(\.xhtml)?$/.test(idref));

// NEW — 匹配 special 或 specials（可选数字后缀）
const startIdx = spineInfo.spine.findIndex((idref) => /^(specials|special)\d*(\.xhtml)?$/.test(idref));
```

- [ ] **Step 3: 修改 includeInToc 条件 (L707)**

```js
// OLD
includeInToc: id === 'specials0001' || /^special\d+/.test(id),

// NEW — 增加 special（无数字）匹配
includeInToc: id === 'special' || id === 'specials0001' || /^special\d+/.test(id),
```

- [ ] **Step 4: 运行现有测试确认无回归**

```bash
cd /Users/liuzhuo/Downloads/资源/义妹生活/epub-clean-js
node --test --test-reporter=spec 'test/unit/yimei-seikatsu/lightnovel-html.test.js'
```
Expected: 5/5 PASS

- [ ] **Step 5: Commit**

```bash
git add books/yimei-seikatsu/lightnovel-html/index.js
git commit -m "fix: collectSpecialEntries 识别无数字后缀的 special.xhtml 为特典group页"
```

---

### Task 2: 添加 special.xhtml group页测试

**Files:**
- Modify: `test/unit/yimei-seikatsu/lightnovel-html.test.js`

在「places epigraph page after TOC and before chapter one」测试末尾增加验证。

- [ ] **Step 1: 在 style-ref 构造中添加 special.xhtml**

在测试文件 L132-L133 之间（「OEBPS/Text/summary.xhtml」之后）插入 `special.xhtml`：

```js
'OEBPS/Text/special.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>特典合集</title></head><body><img src="../Images/t1.png"/></body></html>',
```

同时更新写入的 ncx，在 navMap 末尾增加 special 的 navPoint：

在 `writeEpub(styleRefPath, {...})` 的 ncx 里，`</navMap>` 之前添加：

```xml
<navPoint id="special" playOrder="4"><navLabel><text>特典合集</text></navLabel><content src="Text/special.xhtml"/>
<navPoint id="special1" playOrder="5"><navLabel><text>电子书特典　『卡拉OK女子会』</text></navLabel><content src="Text/special0001.xhtml"/></navPoint>
</navPoint>
```

- [ ] **Step 2: 在测试末尾增加 special.xhtml group页断言**

在测试文件的 spine 验证段之后（现有 `assert.deepEqual(spine.slice(-6), [...])` 之后），添加：

```js
// 验证 special.xhtml 为特典group父节点
const navHtml = epub.entries['OEBPS/Text/navigation-documents.xhtml'].toString('utf8');
const specialGroup = navHtml.match(/special\.xhtml">特典合集<\/a>\s*<ol>\s*<li><a href="special0001\.xhtml"/);
assert.ok(specialGroup, 'NAV 中 special.xhtml 应为特典合集父节点，special0001 为其子条目');

const ncxContent = epub.entries['OEBPS/toc.ncx'].toString('utf8');
assert.match(ncxContent, /<text>特典合集<\/text>/);
assert.match(ncxContent, /<navPoint[^>]*>\s*<navLabel><text>特典合集/);
```

- [ ] **Step 3: 运行测试**

```bash
cd /Users/liuzhuo/Downloads/资源/义妹生活/epub-clean-js
node --test --test-reporter=spec 'test/unit/yimei-seikatsu/lightnovel-html.test.js'
```
Expected: 6/6 PASS (新增 1)

- [ ] **Step 4: Commit**

```bash
git add test/unit/yimei-seikatsu/lightnovel-html.test.js
git commit -m "test: special.xhtml 无数字后缀特典group页测试"
```

---

### Task 3: 修复 hyread-parser 章节标题繁转简

**Files:**
- Modify: `books/yimei-seikatsu/hyread-parser.js:182`
- Modify: `books/yimei-seikatsu/hyread-parser.js:253`
- Modify: `books/yimei-seikatsu/hyread-parser.js:268`

- [ ] **Step 1: tocTitles 繁转简 (L182)**

```js
// OLD
const tocTitles = tocEntries.map((e) => e.title);

// NEW
const tocTitles = tocEntries.map((e) => simplifyText(e.title));
```

- [ ] **Step 2: 章节 title 繁转简 (L253)**

```js
// OLD
chapters.push({ title: tocTitle, blocks });

// NEW
chapters.push({ title: simplifyText(tocTitle), blocks });
```

- [ ] **Step 3: 非 TOC 章节 title 繁转简 (L268)**

```js
// 将 chapters.push({ title, blocks }); 改为：
// 注意：后记分支中 title 已硬编码为 '后记'，无需再转；但其他非 TOC 文件需转
// 实际代码中有 title 变量，在 else 分支末 push。把 push 中的 title 改为 simplifyText(title)
```

在 L268 处：

```js
// OLD
chapters.push({ title, blocks });

// NEW — 非 TOC 章节（包括后记 fallback）统一繁转简
chapters.push({ title: simplifyText(title), blocks });
```

- [ ] **Step 4: 运行单元测试确认无回归**

```bash
cd /Users/liuzhuo/Downloads/资源/义妹生活/epub-clean-js
node --test --test-reporter=spec 'test/unit/**/*.test.js'
```
Expected: 111/111 PASS

- [ ] **Step 5: Commit**

```bash
git add books/yimei-seikatsu/hyread-parser.js
git commit -m "fix: hyread-parser 章节标题繁转简"
```

---

### Task 4: 添加繁转简测试

**Files:**
- Modify: `test/unit/yimei-seikatsu/lightnovel-html-simple-batch.test.js`

- [ ] **Step 1: 添加 parseHyreadEpubToBook 繁转简测试**

在文件末尾（`});` 之前）新增测试：

```js
import { parseHyreadEpubToBook } from '../../../books/yimei-seikatsu/hyread-parser.js';
import { readEpub, writeEpub } from '../../../src/core/zip-io.js';

test('parseHyreadEpubToBook converts TOC titles and chapter titles to Simplified Chinese', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hyread-sc-'));
  try {
    const hyreadPath = join(dir, 'hyread.epub');
    // 构造最简 hyread EPUB：含 p-toc-001（繁体标题）+ p-002（简体正文）+ p-colophon
    await writeEpub(hyreadPath, {
      'item/xhtml/p-toc-001.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body>'
        + '<a href="xhtml/p-002.xhtml">序幕　淺村悠太</a>'
        + '<a href="xhtml/p-003.xhtml">後記</a>'
        + '</body></html>',
      'item/xhtml/p-002.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body>'
        + '<div class="main"><p class="__reader-text-indent__">简体正文</p></div>'
        + '</body></html>',
      'item/xhtml/p-003.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body>'
        + '<div class="main"><p class="__reader-text-indent__">简体后记正文</p></div>'
        + '</body></html>',
      'item/xhtml/p-colophon.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body>'
        + '<div class="publisher-data"></div>'
        + '</body></html>',
      'item/xhtml/p-cover.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body>'
        + '<img src="../image/cover.jpg"/>'
        + '</body></html>',
      'item/image/cover.jpg': Buffer.from('cover'),
    });

    const book = await parseHyreadEpubToBook(hyreadPath, { volume: '13' });
    const tocTitle = book.tocTitles.find(t => t.includes('浅村'));
    assert.ok(tocTitle, 'tocTitles 应包含浅村章节');
    assert.equal(tocTitle, '序幕　浅村悠太', 'toc 标题应已转为简体（淺→浅、悠→悠）');
    assert.ok(book.chapters.some(ch => ch.title === '序幕　浅村悠太'), '章节标题应为简体');
    assert.ok(book.chapters.some(ch => ch.title === '后记'), '后记标题不变');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 运行测试**

```bash
cd /Users/liuzhuo/Downloads/资源/义妹生活/epub-clean-js
node --test --test-reporter=spec 'test/unit/yimei-seikatsu/lightnovel-html-simple-batch.test.js'
```
Expected: 2/2 PASS (新增 1)

- [ ] **Step 3: Commit**

```bash
git add test/unit/yimei-seikatsu/lightnovel-html-simple-batch.test.js
git commit -m "test: hyread-parser 繁转简标题测试"
```

---

### Task 5: 全量回归 + 实际卷13验证

- [ ] **Step 1: 运行全量测试**

```bash
cd /Users/liuzhuo/Downloads/资源/义妹生活/epub-clean-js
node --test --test-reporter=spec 'test/**/*.test.js'
```
Expected: 115/115 PASS

- [ ] **Step 2: 实际跑卷13转换**

```bash
cd /Users/liuzhuo/Downloads/资源/义妹生活/epub-clean-js
node bin/cli.js hyread-to-simple \
  --source "/Users/liuzhuo/Downloads/资源/义妹生活/output/hyread/[三河ごーすと].义妹生活.13.[台繁].hyread.epub" \
  --ref "/Users/liuzhuo/Downloads/资源/义妹生活/[三河ごーすと].义妹生活.07.[台简].epub" \
  --style-ref "/Users/liuzhuo/Downloads/资源/义妹生活/output/healed/[三河ごーすと].义妹生活.13.[日翻].healed.epub" \
  --out /tmp/vol13-fixed.epub \
  --volume 13
```

- [ ] **Step 3: 验证输出 EPUB 特典group结构**

```bash
cd /Users/liuzhuo/Downloads/资源/义妹生活/epub-clean-js
node -e "
import { readEpub } from './src/core/zip-io.js';
const epub = await readEpub('/tmp/vol13-fixed.epub');
const nav = epub.entries['OEBPS/Text/navigation-documents.xhtml'].toString('utf8');

// 特典合集为父节点
assert.match(nav, /special\.xhtml">特典合集<\/a>\s*<ol>\s*<li><a href="special0001/);
// 章节标题为简体
assert.match(nav, />序幕　浅村悠太</);
assert.match(nav, />后记</);
// 不残留繁体
assert.ok(!nav.includes('淺村'));
assert.ok(!nav.includes('後記'));
"
```
Expected: 无错误输出

- [ ] **Step 5: Commit 验证结果**

```bash
git log --oneline -5
```
Expected: 4 个新 commit + 1 个旧 commit
