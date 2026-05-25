# Python ↔ Node 行为差异修复清单

来源：`scripts/` （Python 1650 行 / 13 模块）vs `epub-clean-js/books/yimei-seikatsu/migrate/`（Node 1363 行 / 12 模块）
扫描日期：2026-05-22
扫描人：Task 5b implementer

---

## 行数差异统计表

| 模块 | Python 行 | Node 行 | Δ% | 说明 |
|---|---|---|---|---|
| aligner | 51 | 80 | -57% | Node 多注释/类型声明，逻辑等价 |
| chapter_renderer | 35 | 41 | -17% | Node 多 import 样板，但 **blocks 类型签名不同**（见 4 号差异）|
| epub_io | 19 | 73 | -284% | archiver 库需要 walk + stream，等价 |
| extras_cleaner | 246 | 70 | **+72%** | Task 9 已规划修复 |
| footnote_cleaner | 53 | 69 | -30% | Node 多 escape helper，但 **输出 HTML 结构不一致**（见 1 号差异）|
| footnote_extractor | 160 | 153 | +4% | 行数接近，但 **缺 aside 跳过**（见 2 号差异）|
| footnote_relocator | 118 | 115 | +3% | 行数接近，但 **算法完全不同**（见 3 号差异，最严重）|
| inline_image_extractor | 56 | 73 | -30% | **class 匹配方式不同**（见 6 号差异，小风险）|
| metadata_builder | 42 | 54 | -29% | 等价 |
| migrate_epub | 623 | 557 | +11% | **入口逻辑大量缺失**（见 5 号差异，最严重）|
| paragraph_extractor | 38 | 31 | +18% | Task 9b 已规划修复 |
| toc_builder | 61 | 47 | **+23%** | **缺 normalize_space + flatten**（见 7 号差异）|

---

## 已知差异（Plan 已规划修复）

### 1. extras-cleaner: 3.5× 行数差
- Python 246 行 vs Node 70 行（差 176 行）
- Node 仅实现 `stripCalibreClasses` / `buildCoverXhtml` / `buildIllusXhtml` 3 个函数；
  Python 还有 `buildTitleXhtml` / `buildMessageXhtml` / `buildSummaryXhtml` /
  `buildContentsXhtml` / `buildPreXhtml` / `buildTocXhtml`（共 6 个 builder 缺失，配套有 6 套 STERA 模板字面量）
- 修复：Task 9（已规划）
- 状态：⏸ pending

### 2. paragraph-extractor: 缺 aside 跳过逻辑
- Python 显式跳过 aside 祖先内的 `<p>`（注释正文，不算正文段落）；Node 没有
- 影响：所有 dst 段落计数会比 Python 大，间接影响 `align_pairs` 和 `hostParaIndex`
- 修复：Task 9b（已规划）
- 状态：⏸ pending

---

## 本次扫描新发现的差异（按严重程度排序）

### 1. footnote-cleaner: STERA HTML 输出结构完全不一致 🔴 最严重

**Python 输出**（`scripts/footnote_cleaner.py` line 35-51）：
```html
<sub><a class="duokan-footnote" epub:type="noteref" href="#noteNNN" id="note_refNNN">
  <img width="25" alt="note" class="zhangyue-footnote" src="../Images/note.webp"
       zy-footnote="..."/>
</a></sub>

<aside epub:type="footnote" id="noteNNN">
  <ol class="duokan-footnote-content" style="list-style:none">
    <li class="duokan-footnote-item" id="noteNNN">
      <p><a href="#note_refNNN">注N</a>：注释正文</p>
    </li>
  </ol>
</aside>
```

**Node 输出**（`epub-clean-js/books/yimei-seikatsu/migrate/footnote-cleaner.js` line 50-66）：
```html
<sup><a class="duokan-footnote" epub:type="noteref" href="#noteNNN" id="note_refNNN">
  <img alt="note" class="zhangyue-footnote" src="../Images/note.webp"
       zy-footnote="..."/>
</a></sup>

<aside epub:type="footnote" id="noteNNN">
  <a href="#note_refNNN"></a>
  <ol class="duokan-footnote-content">
    <li class="duokan-footnote-item" value="NNN">
      <p>注释正文</p>
    </li>
  </ol>
</aside>
```

具体差异：
1. **wrapper 标签**：Python `<sub>` vs Node `<sup>`
2. **img**：Python 有 `width="25"` 属性，Node 没有
3. **ol 内 inline style**：Python `style="list-style:none"` vs Node 无
4. **aside 顶层**：Node 多了 `<a href="#ref"></a>` 空锚（Python 没有）
5. **li 属性**：Python `id="noteNNN"`（重复 id，但功能必须）vs Node `value="NNN"`
6. **li 内 p 内容**：Python `<a href="#ref">注N</a>：text`（反向链接 + 注 N 前缀）vs Node 仅 `text`（没有反向链接和注 N 前缀）

影响：渲染出来的 EPUB 在多看/掌阅/Kindle 多端兼容性完全不一样，**直接影响最终产物 hash**。Python 注释中明确写「经多看/掌阅/Kindle/Apple Books/Calibre 多端验证（V8 测试 EPUB）」。

修复建议：**追加 Task 9c**（footnote-cleaner 重写为 V8 兼容多端结构），优先级与 Task 9/9b 同等高。
状态：⏸ pending

---

### 2. footnote-extractor: aside 内 p 未跳过（与代码注释矛盾） 🔴 严重

**Python 行为**（`scripts/footnote_extractor.py` line 55-70）：跳过 aside 祖先内的 `<p>`，仅正文段落计入 `para_index`。
**Node 行为**（`epub-clean-js/books/yimei-seikatsu/migrate/footnote-extractor.js` line 47-50）：

```js
// 编号所有 <p>。注意：aside 内的 <p> 也算（与 Python 行为一致）
const allParas = [...document.querySelectorAll('p')];
```

**代码注释自己说「与 Python 行为一致」，实际上恰好相反**。

影响：
- 当章节同时含正文 p 和 aside 内 p 时，Node 的 `hostParaIndex` 会**比 Python 大**（aside 内 p 占了号）
- 进而通过 `align_pairs` 反查的 SRC 段索引偏移，**直接导致定位错位**
- 与 paragraph-extractor 的 aside 跳过缺失（Task 9b）形成**双重不一致**

修复建议：**与 Task 9b 一起修**（同源问题：aside 跳过），或追加 Task 9d。修复后必须把误导性注释更新为「跳过 aside 内的 p（与 paragraph_extractor 索引体系一致）」。
状态：⏸ pending

---

### 3. footnote-relocator: 缺 V3 章内窗口搜索 + 段级 fuzzy 排序 🔴 最严重

**Python 算法**（`scripts/footnote_relocator.py` line 36-90，V3 章内窗口搜索）：
1. 用 `align_pairs` 反查 DST `host_para_index` 得到 SRC hint 段索引
2. 在 SRC `[hint-10, hint+10]` 窗口内做 **段级 `fuzz.ratio` 排序**，挑最相似段
3. 若窗口内最佳分 < 40 → **回退全章搜索**
4. 在锚点段内用 `before_ctx + after_ctx` 拼 needle，用 `partial_ratio_alignment` 找精确字符偏移
5. 段级置信度：≥ 70 HIGH / 50-70 MEDIUM / < 50 LOW

**Node 算法**（`epub-clean-js/books/yimei-seikatsu/migrate/footnote-relocator.js` line 58-98）：
1. 用 `findSrcIdxForDst` 拿到 hint 段直接当作最佳段（**没有窗口搜索，没有段级 fuzzy**）
2. 直接在 hint 段做 `partialRatioAlignment` 找字符偏移
3. **置信度阈值不同**：≥ 80 HIGH / 60-80 MEDIUM / < 60 LOW（Python 是 70/50）

影响：
- 当 `align_pairs` 在 hint 处对齐质量差时，Python 能在 ±10 段内重新挑最匹配段并回退全章；Node 直接落到错的段
- 阈值不同导致同样的 partial 分数会判出不同的 confidence 等级
- **直接影响哪些 note 被标 HIGH/MEDIUM/LOW，影响最终 EPUB 中 sup 出现的位置**

修复建议：**追加 Task 9e**（footnote-relocator 完整重写，引入窗口搜索 + 全章回退 + 段级 fuzzy + 修阈值）。这是行为差异中最影响 e2e 输出的项之一。
状态：⏸ pending

---

### 4. chapter-renderer: blocks 类型签名不一致，缺 `<note>` 包裹 🔴 严重

**Python 接口**（`scripts/chapter_renderer.py` line 17-35）：
```python
blocks 是混合列表，每项可以是：
- 纯字符串：段落文本
- 以 '<div' 开头的字符串：章内插图 HTML
- dict {"para": str, "aside": str}：含注释的段落 → 用 <note> 包裹 p+aside
  (script.js 要求 sup 和 aside 在同一个 note 元素内一一配对)

footnote_asides 参数为兼容旧调用保留，已不再使用
```

**Node 接口**（`epub-clean-js/books/yimei-seikatsu/migrate/chapter-renderer.js` line 34-41）：
```js
export function renderChapter({ title, blocks, footnoteAsides }) {
  // blocks 只接受字符串数组
  // footnoteAsides 当独立参数（已被 Python deprecated 的用法）
}
```

影响：
- Python 渲染出 `<note><p>...sup...</p><aside>...</aside></note>` 结构（script.js 依赖此结构做 sup ↔ aside 配对）
- Node 渲染出 `<p>...sup...</p>` 正文 + 章末汇总 `<aside>...</aside>` 列表（**sup 和 aside 不在同一 note 内**）
- **直接破坏多看 script.js 的注释展开行为**，用户点击 sup 时无法弹出 aside

修复建议：**追加 Task 9f**（chapter-renderer 改用 dict block + 模板内 `<note>` 包裹）。需要同步更新 `templates/chapter.xhtml.njk` 模板支持 dict block。
状态：⏸ pending

---

### 5. migrate-epub: 入口逻辑大量缺失 🔴 最严重

入口文件差异最多（Python 623 行 vs Node 557 行），但更关键的是**功能缺失而非冗余**。逐项列：

| # | Python 有 | Node 缺 | 影响 |
|---|---|---|---|
| a | `from scripts.footnote_overrides import lookup_override` + Python line 220-224 使用 override | 完全没有 override 机制 | 已知错位注释无法手动修正 |
| b | Python line 189-191 跳过 chapter1 第 1 段引言「冷静的人生规划...」（已作为 pre.xhtml） | 没有这段特殊处理 | chapter1 第 1 段会重复出现在正文里 |
| c | `_copy_src_images`：用 SRC 台版 191020.jpg 覆盖 cover.jpg（1.4MB 高清） | Node line 136 直接 `copyDir DST/Images`，封面用 DST 0.3MB 低清 | 封面图片质量降级 |
| d | `migrate_specials` 函数（line 325-390）：用 chapter_renderer 重渲染 special0001-0003 + 注释 + 内联插图 | Node line 311-321 把 special0001-0003 当 keepAsIs 直接拷贝 + stripCalibre | special 章节没有 STERA 注释升级，保留 DST 原始 calibre 结构 |
| e | Python 处理 **5 张** kuchie 彩插（line 154 `range(1, 6)`）+ illus0005.xhtml | Node 仅 4 张（line 463 `n=1 to 4`），没有 illus0005 | 缺一张彩插 |
| f | Python 用 `build_title_xhtml` / `build_message_xhtml` / `build_summary_xhtml` / `build_contents_xhtml` / `build_pre_xhtml` 生成附章 | Node 全部走 keepAsIs（拷 DST 原文 + stripCalibre）| 附章保留 DST calibre 结构，不是 STERA 风格 |
| g | Python TOC 顺序：封面/书名/制作信息/简介/彩插/12 章/**特典（嵌套子项）** | Node TOC 顺序：封面/书名/简介/12 章/制作信息（缺彩插和特典） | nav/ncx 结构与 Python 完全不同 |
| h | Python 删除 talk.xhtml（line 335 注释明确说「与 kuchie-005 彩插重复」） | Node 把 talk 当 keepAsIs 保留 | spine 多一个重复章节 |
| i | Python spine 含 `contents.xhtml`（line 571）和 `pre.xhtml`（line 574） | Node spine 没有 contents，pre 有但生成方式不对 | 装饰目录页缺失 |
| j | Python `_build_spine` 含 3 个 special（line 578-579） | Node 也有 3 个 special（line 479-485） | ✅ 一致 |
| k | Python 出 `[三河ごーすと].义妹生活.09.[台简].epub`（与 Python 同文件名） | Node 出 `.node.epub`（避免冲突） | 故意区分，OK |
| l | Python TOC.xhtml 仅含 12 章 + 3 特典（line 472 注释）| Node TOC.xhtml 含完整 fullToc | 用户可见目录页不一致 |
| m | Python TOC.xhtml 全角空格转半角（line 474 `.replace("　", " ")`） | Node 没有 | TOC 显示行高会被多看自动加大 |

影响：**完全无法产出和 Python 等价的 EPUB**，最终文件 hash 必然不同（甚至章节内容、附章数量、TOC 结构都不一样）。

修复建议：把上述 a-i + l + m 拆成若干个 Task：
- **Task 9g**：补 `footnote_overrides` 模块 + 在 migrate_epub 接入 lookup_override（依赖 9e）
- **Task 9h**：补 chapter1 引言剥离 + `_copy_src_images`（封面用 SRC 高清）
- **Task 9i**：补 `migrateSpecials` 函数（special 走 chapter_renderer）
- **Task 9j**：补附章生成（5 张 illus + title/message/summary/contents/pre 用 extras_cleaner builder，依赖 Task 9 完成）
- **Task 9k**：补 TOC 结构（顺序、嵌套、TOC.xhtml 仅 12 章 + 特典、全角空格转半角，依赖 Task 9 toc_builder 修复）
- **Task 9l**：补 spine（contents + pre 位置）、删 talk

状态：⏸ pending

---

### 6. inline-image-extractor: class 匹配方式不同 🟡 小风险

**Python**（`scripts/inline_image_extractor.py` line 35）：
```python
elif elem.tag == f"{NS}div" and "illus" in (elem.get("class") or ""):
```
子串匹配，会命中 `class="illus-large"`、`class="my-illus"` 等。

**Node**（`epub-clean-js/books/yimei-seikatsu/migrate/inline-image-extractor.js` line 39）：
```js
if (!cls.split(/\s+/).includes('illus')) return;
```
精确 token 匹配，只命中 `class="illus"` 或 `class="illus duokan-image-single"` 等。

影响：
- 当前 DST 数据中 div class 大多是 `class="illus duokan-image-single"`，两边都能命中
- **如果 DST 有 `class="illus1"` / `class="illus-pic"` 这种命名**，Python 命中、Node 不命中，会丢插图
- 需要扫一遍 DST 数据确认是否真的有这类 class 才能定性影响

修复建议：**追加 Task 9m**（统一为 Python 子串匹配；或先扫 DST 确认无此 class，加注释说明保持精确匹配是有意为之）。优先级低。
状态：⏸ pending

---

### 7. toc-builder: 缺 `_normalize_space` + `_flatten` 🟠 中等

**Python 有 2 个 helper**（`scripts/toc_builder.py` line 24-42）：
- `_normalize_space`：把 entry title 内的全角空格 U+3000 替换为半角空格（多看据宽度自动加大行间距）
- `_flatten`：把 nested children 平铺为单层（NCX 风格，DST 风格）

**Node 完全没有这两个函数**（`epub-clean-js/books/yimei-seikatsu/migrate/toc-builder.js`），直接把 entries 传给模板。

影响：
- **NCX 不会平铺**：如果上层传嵌套 entries（含 children），ncx 会渲染嵌套结构（不是 NCX 规范）
- **nav 不会规范化空格**：全角空格会导致多看渲染 nav 时行高异常
- TOC.xhtml 同样问题

修复建议：**追加 Task 9n**（toc-builder 补 normalize_space + flatten）。依赖：上游 migrate_epub 需要先支持 nested TocEntry（特典分组），Task 9k 配套修。
状态：⏸ pending

---

### 8. aligner: fuzzy 库不同（rapidfuzz vs fuzzball）🟢 已知预期

- Python 用 `rapidfuzz.fuzz.ratio`
- Node 用 `fuzzball.ratio`

两库算法基础都是 Levenshtein ratio，理论值域和算法等价，但**实现细节可能有微小差别**（unicode 处理、tie-break 顺序）。

影响：可能在边缘 case 上 align_pairs 不完全一致。无法 100% 保证 bit-for-bit 等价。

修复建议：**不强行修**。在 e2e 测试中允许 align_pairs 在统计意义上接近即可（如 90%+ 段落对齐结果一致）。在 docs 中标注「fuzzy 库差异属预期不等价点」。
状态：✅ 文档化即可

---

## 函数清单对照（high-risk 模块）

### footnote-cleaner

| Python | Node |
|---|---|
| `build_stera_footnote(fn, new_id_number)` | `buildSteraFootnote(fn, newIdNumber)` |
| (内置 `html.escape`) | `escapeAttr(s)` + `escapeText(s)` |

签名一致，但 **输出 HTML 不同**（见 1 号差异）。

### footnote-relocator

| Python | Node |
|---|---|
| `relocate_footnote(fn, src_paragraphs, align_pairs)` | `relocateFootnote(fn, srcParagraphs, alignPairs)` |
| `_best_in_range(needle_text, paras, lo, hi)` | **缺失** |
| `_find_src_idx_for_dst(dst_idx, align_pairs, src_max)` | `findSrcIdxForDst(dstIdx, alignPairs, srcMax)` |
| (用 `fuzz.partial_ratio_alignment`) | `partialRatioAlignment(needle, haystack)` 手写实现 |

**核心算法 `_best_in_range` 完全缺失**（见 3 号差异）。

### extras-cleaner

| Python | Node |
|---|---|
| `strip_calibre_classes(html)` | `stripCalibreClasses(html)` ✅ |
| `build_cover_xhtml(image_filename)` | `buildCoverXhtml(imageFilename)` ✅ |
| `build_illus_xhtml(image_filename, alt)` | `buildIllusXhtml(imageFilename, alt)` ✅ |
| `build_title_xhtml(t1, t2, t3, t4)` | **缺失** |
| `build_message_xhtml(credits, url, logo)` | **缺失** |
| `build_summary_xhtml(description)` | **缺失** |
| `build_contents_xhtml(image_filename)` | **缺失** |
| `build_pre_xhtml(quote_text)` | **缺失** |
| `build_toc_xhtml(entries)` | **缺失** |

6 个 builder 函数 + 配套模板字面量全缺（Task 9 已规划）。

### migrate-epub

| Python | Node | 备注 |
|---|---|---|
| `setup_build_dir` | `setupBuildDir` | Node 缺 _copy_src_images 子步骤 |
| `_copy_src_images` | **缺失** | 见 5c |
| `_copy_dst_decoration_images` | （合并到 setupBuildDir 的 copyDir）| 行为差异 |
| `_strip_missing_font_faces` | `stripMissingFontFaces` ✅ | |
| `migrate_chapters` | `migrateChapters` | 缺 override 和 chapter1 引言剥离 |
| `_extract_h3_title` | `extractH3Title` ✅ | |
| `_extract_h4_h5_title` | **缺失** | 见 5d |
| `migrate_specials` | **缺失** | 见 5d |
| `write_attached_pages` | `copyExtras` | 实现策略完全不同（builder vs keepAsIs） |
| `write_metadata_and_toc` | `writeMetadataAndToc` | TOC 顺序、TOC.xhtml 内容、空格规范化都不同 |
| `_build_manifest` | `buildManifest` ✅ | 基本等价 |
| `_build_spine` | `buildSpine` | 缺 contents/pre 位置 |
| `write_align_report` | `writeAlignReport` ✅ | 等价 |
| `main` | `main` ✅ | 等价（缺 specials step）|

---

## 总览：新发现差异严重度汇总

| 严重度 | 差异 | 修复 Task 建议 |
|---|---|---|
| 🔴 最严重 | 1. footnote-cleaner HTML 结构 | Task 9c |
| 🔴 严重 | 2. footnote-extractor aside 不跳过 | 并入 Task 9b 或单独 Task 9d |
| 🔴 最严重 | 3. footnote-relocator 缺窗口搜索 | Task 9e |
| 🔴 严重 | 4. chapter-renderer blocks dict + `<note>` | Task 9f |
| 🔴 最严重 | 5. migrate-epub 入口大量缺失 | Task 9g/9h/9i/9j/9k/9l |
| 🟡 小风险 | 6. inline-image class 匹配方式 | Task 9m（先扫 DST 数据） |
| 🟠 中等 | 7. toc-builder 缺 helper | Task 9n |
| 🟢 预期 | 8. fuzzy 库差异 rapidfuzz vs fuzzball | 不修，文档化 |

**新发现差异总数**：**7 个需要修复 + 1 个文档化**（不含已规划的 extras-cleaner 和 paragraph-extractor）。

**建议追加的 Task 数量**：8-12 个子 Task（视拆分粒度而定）。

---

## 修复优先级建议

1. **P0（必修，影响 e2e 输出 hash 与 EPUB 可用性）**：
   - Task 9c（footnote-cleaner V8 结构）
   - Task 9e（footnote-relocator V3 算法）
   - Task 9f（chapter-renderer `<note>` 包裹）
   - Task 9g-9l（migrate-epub 缺失逻辑全集）
   - 并入 Task 9b 的 footnote-extractor aside 跳过

2. **P1（影响等价性但非阻断）**：
   - Task 9n（toc-builder helper）

3. **P2（边缘情况，先调研后定）**：
   - Task 9m（inline-image class 匹配方式）

4. **P3（不修，仅文档）**：
   - rapidfuzz vs fuzzball 差异

---

## 附录：原始扫描数据来源

- 行数对比脚本：本 Task Step 1 输出，保存在 `/tmp/lines-diff.txt`
- docstring 扫描：本 Task Step 2 输出（关键词 跳过/skip/修复/bug/注意/边界/TODO）
- 函数清单：本 Task Step 3 输出
- 详细函数级 diff：本 Task Step 4 综合分析（含 Read 各模块完整内容对比）

---

## 2026-05-25 更新：byte-level 一致化达成

义妹生活 09 卷 Node 输出与 Python golden 已实现 **byte-level 一致**（除 3 条动态字段外）。
e2e 比对 normalize 从 8 条 mask 缩减为 3 条：

| 现存 mask | 字段 | 文件 |
|---|---|---|
| 1 | `urn:uuid:XXXX` | content.opf / toc.ncx |
| 2 | 裸 UUID | OPF item id / NCX dtb:uid |
| 3 | ISO 8601 时间戳 `dcterms:modified` | content.opf |

已移除的 5 条「结构性」mask（builder 端直接对齐 Python，不再需要在比对时抹平）：

- ~~`<note>...</note>` 透明包装去除~~  → 改 `chapter.xhtml.njk` 让 dict block 输出 `<p>...</p>\n<aside>...</aside>` 平铺
- ~~行首空白去除~~  → 改模板缩进与 Python 对齐
- ~~`>\n<` 标签间换行压缩~~  → 改模板第一行 `<?xml ...?><html ...>` 同行
- ~~nav 特典嵌套 ol 规整~~  → 改 `nav.xhtml.njk` 实现 children 嵌套 ol 输出
- ~~nav `<h1>目录</h1>` mask~~  → 改 `nav.xhtml.njk` 直接渲染 `<h1>{{ title }}</h1>`

具体 builder 端修复：

1. **`templates/chapter.xhtml.njk`** — 去掉 `<note>` 包裹，dict block 输出 `<p>` 后紧跟 `<aside>`（行首与 Python 一致）。
2. **`templates/nav.xhtml.njk`** — 重写为 Python 等价格式（首行同行、`<h1>目录</h1>` 内嵌、特典嵌套 ol、`{%- -%}` 控制 whitespace、无 trailing newline）。
3. **`migrate/toc-builder.js#buildNavXhtml`** — 渲染后 `.replace(/\n+$/, '')`（navigation-documents.xhtml 末无 newline）。
4. **`migrate/toc-builder.js#buildTocNcx`** — 渲染后 `.replace(/\n+$/, '')`（toc.ncx 末无 newline）。
5. **`migrate/metadata-builder.js#buildContentOpf`** — 渲染后 `.replace(/\n+$/, '')`（content.opf 末无 newline）。
6. **`profile.js#footnoteOverrides["09"]`** — 通过 `/tmp/audit-overrides.mjs` 自动比对 Python 宿主段 + Node paragraph-extractor 抽段，把 10 条 override 的 `afterParaIdx` 校准到 Node 真实 idx，并补全 `anchor`（Python `<sub>` 在宿主段中实际位置的前缀文本）。

校验工具：

- `/tmp/audit-overrides.mjs`：枚举 Python golden 每条 noteNNN 的宿主段全文，自动在 Node 抽段中精确定位 idx。
- `/tmp/audit-sub-position.mjs`：枚举每条 noteNNN 在 Python 宿主段中 `<sub>` 之前的最后 20 字（作 anchor）和之后的尾巴。

测试：97/97 全测 PASS（unit 95 + e2e 2），e2e 0 mismatch。
