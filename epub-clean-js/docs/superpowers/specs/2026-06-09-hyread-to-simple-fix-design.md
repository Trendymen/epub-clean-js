# hyread-to-simple 卷13转换修复设计

**日期**: 2026-06-09
**状态**: 已确认
**范围**: `epub-clean-js`

## 问题

`hyread-to-simple` 管线处理卷13时有三个bug：

1. **特典group标题乱套** — `special0001`（电子书特典）错误成为group父节点，因为 `collectSpecialEntries` 搜不到 `special.xhtml`（无数字后缀）
2. **繁转简不完整** — `hyread-parser.js` 只对正文文本跑 `simplifyText()`，章节标题（来自 hyread TOC）保持繁体
3. **特典样式来源** — 管线已正确传入 healed EPUB 作为 style-ref，不是根本问题

## 根因分析

### Bug 1: special.xhtml 不被识别

`lightnovel-html/index.js:677` — `SPECIAL_PAGE_RE` 要求 idref 带数字后缀（`specials\d+`），但healed版的group页是 `special`（纯字母）。spine 搜索找不到起始点后退回硬编码 `SPECIAL_TEXT_IDS`（`['specials0001', 'special0001', ...]`），导致 `special0001` 成为父节点。

### Bug 2: 章节标题未转简

`hyread-parser.js:182` — `tocTitles` 直接取 `tocEntries.map(e => e.title)`，hyread TOC 全是台繁。只有 `parseChapterXhtml` 中的正文文本被转了简体。

## 修复方案

### 修改 1: `books/yimei-seikatsu/lightnovel-html/index.js` — `collectSpecialEntries()`

**SPECIAL_PAGE_RE 扩展** (L665):
```
OLD: /^(specials\d+|special\d+|illus\d+)(\.xhtml)?$/
NEW: /^(specials\d*|special\d*|illus\d+)(\.xhtml)?$/
```
允许 `special` 和 `specials` 不带数字后缀。

**spine 搜索起始条件** (L677):
```
OLD: /^specials\d+(\.xhtml)?$/.test(idref)
NEW: /^(specials|special)\d*(\.xhtml)?$/.test(idref)
```
匹配 `special.xhtml` 为特典区起始。

**includeInToc 条件** (L707):
```
OLD: id === 'specials0001' || /^special\d+/.test(id)
NEW: id === 'special' || id === 'specials0001' || /^special\d+/.test(id)
```
`special`（无数字）也标记为 TOC 条目。

### 修改 2: `books/yimei-seikatsu/hyread-parser.js` — 繁转简

**tocTitles** (原 L182):
```
tocTitles = tocEntries.map(e => simplifyText(e.title))
```

**chapters 循环** (原 L250-253):
```js
const tocTitle = tocFileToTitle.get(fileName);
if (tocTitle) {
  chapters.push({ title: simplifyText(tocTitle), blocks });
}
```
对从 TOC 匹配的章节标题调用 `simplifyText()`。

后记章节（L261-268）也需对非TOC章节的 title 做繁转简。

### 修改 3: 测试

**`test/unit/yimei-seikatsu/lightnovel-html.test.js`**:
在「places epigraph page after TOC」测试的 style-ref 中添加 `special.xhtml` 页（带 `<head><title>特典合集</title></head>`），调整 spine 使 `special.xhtml` 在 `special0001` 之前。验证输出 TOC/NAV/NCX 中 `special` 为group父节点，`special0001` 为其子。

**`test/unit/yimei-seikatsu/lightnovel-html-simple-batch.test.js`**:
新增测试，构造 hyread EPUB 调用 `parseHyreadEpubToBook`，验证 `tocTitles` 和 `chapter.title` 已转简体。

## 非目标

- 不涉 11/12 卷管线（已有自己的 specials0001 group页，行为不变）
- 不改 `migrate-translation` 管线
- 不改 footnote-fix 模块

## 验收标准

1. `hyread-to-simple --volume 13` 输出 EPUB 中：
   - TOC/NAV/NCX 特典合集为 `special` 第一级，各特典为其子条目
   - 所有章节标题为简体中文
2. 全量测试 (`npm test`) 全部通过
3. 新测试覆盖 special.xhtml group页和繁转简
