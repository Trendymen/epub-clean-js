# 台简产物字体开源化 + 按卷子集化设计

**日期**: 2026-06-09
**状态**: 已确认
**范围**: `epub-clean-js`（09/11/12/13 卷台简产物）

## 问题

09/11/12/13 卷台简产物的**标题 / 目录 / 简介**在各自指定的子集字体里**缺字形**（显示豆腐块），根因经实证如下：

1. **字体是从源 epub 原样继承的子集字体**，脚本只做文本繁转简、不碰字形。
   - 09 走 `migrate-translation` 管线（`books/yimei-seikatsu/migrate/migrate-epub.js`），字体从 REF 容器复制。
   - 11/12/13 走 `hyread-to-simple` 管线（`books/yimei-seikatsu/lightnovel-html/index.js`），字体从 styleRef（日翻版）复制。
2. **子集字体字形覆盖量极低**（11 卷实测）：`ch2`(章节标题) 27 字、`ctt1`(目录) 29 字、`ctt2`(目录标题) 1 字、`sum`(简介) 143 字、`main`(正文) 2272 字。
3. 台版译文用字 ≠ 源容器用字，**差集即缺字**：
   - 标题/目录缺字（实测）：11 卷「幕、假」，12 卷「幕」，13 卷「幕、在、此、之、前、以」。
   - **正文 `main` 也大量缺字**（每卷 196~219 字，如「寝、瞇、诀、妳、擡、喽」），只是分散在正文不显眼。

### 借用日翻字体不可行（实证）

| 卷 | 部位 | 台简自带缺字 | 同卷日翻缺字 | 结论 |
|---|---|---|---|---|
| 11/12/13 | 标题/目录/正文 | 若干 | **逐字完全相同** | 台简字体就是从同卷日翻拷来的，借用＝维持现状，零改善 |
| 09 | 标题 ch2 | 缺 3 | 缺 0 | 日翻略好 |
| 09 | 目录/简介/正文 | 缺 27/65/323 | 缺 22/41/180 | 仍大量缺 |

所有现成子集字体（台简的、日翻的）都是「按各自译文用字子集化的小字体」，**互相借用补不全**。必须引入**完整覆盖的开源字体**（思源），按卷实际用字重新子集化。

## 字体识别结论（实证）

原字体元数据（name/OS2 panose/usWeightClass）已被子集化抹除，经渲染样张视觉识别：

| 部位（CSS 选择器） | 原字体 | 实测风格 | 字重匹配 |
|---|---|---|---|
| 章节大标题 `h3` / `.ch2` | ch2 | 粗宋 serif | ≈ 思源宋 Bold 700 |
| 目录条目 `.toc a` / `.ctt1` | ctt1 | 粗宋 serif | ≈ 思源宋 Bold 700 |
| 目录大标题 `.ctt` / `.ctt2` / `.toc .ctit` | ctt2 | 粗宋（英文为主） | 思源宋 Bold 700 |
| 副标题 `h5` / `.ch3` | ch3 | 常规宋 serif | 思源宋 Regular 400 |
| 章节内分隔标题 `.cut` / `h4` / `.ch1` | ch1 | **黑体 sans** | 思源黑 Bold（待下载定稿，Medium/Bold 间） |
| 简介 `.summary` / `.sum` | sum | 常规宋 serif | 思源宋 Regular 400 |
| 消息 `.message` / `.mes` | mes | 常规宋 serif | 思源宋 Regular 400 |
| 注释 `.note` / `.duokan-footnote-item` | note | 常规宋 serif | 思源宋 Regular 400 |
| 正文 `body` / `ruby>rt` / `.main` | main | 常规宋 serif | 思源宋 Regular 400 |

唯一 sans 部位为 ch1（黑体分隔标题），其余均为宋体。

## 方案：字体层重构（真实思源命名 + 归并 + 彻底清理）

### ① 归并为 3 个真实命名思源字体（每卷各自子集化）

| 新字体文件 | CSS font-family | 源字重 | 接管部位 |
|---|---|---|---|
| `SourceHanSerifSC-Regular.subset.otf` | `"Source Han Serif SC"` | 思源宋 Regular | 正文 body、ruby、h5/ch3、简介、消息、注释 |
| `SourceHanSerifSC-Bold.subset.otf` | `"Source Han Serif SC Bold"` | 思源宋 Bold | 章节标题 h3/ch2、目录 ctt1/ctt2 |
| `SourceHanSansSC-Bold.subset.otf` | `"Source Han Sans SC Bold"` | 思源黑 Bold | 黑体分隔标题 ch1/.cut/h4 |

用**独立 family 名**（而非同名 + font-weight），规避老阅读器字重匹配不一致。family 名仍同时设 `font-weight` 作双保险。

### ② CSS 完整重映射

- 新增 3 条 @font-face（指向上表 3 个子集字体），**删除旧全部 @font-face**（09 卷 12 条 / 11 卷 9 条）。
- 所有选择器的 `font-family` 改为真实思源 family 名（按上表归属）。
- fallback 链尾的 `,emoji,sym` 去掉（已验证无用）。

### ③ 彻底移除清单

- **删旧字体文件**：`ch1/ch2/ch3/ctt1/ctt2/main/mes/note/sum`（09 另含 `emoji/sym/int`）。
- **删旧 @font-face**：全部。
- **清理孤儿 class**（原本就指向不存在的字体）：`.cont/.int/.title/.illus1-5/.num/.emoji/.sym` 及 `table→int` → 重映射到思源 Regular 或删除规则。
- 11/12/13 卷 fallback 里的 `emoji/sym` 本就是死引用（无文件），一并去掉。

### ④ emoji/sym/int 数据结论

- 09 的 `emoji/sym/int.ttf` 是近乎空的字体（各 0~1 字形），正文**零使用**。
- 思源宋体覆盖正文全部非汉字符号：09/11/13 卷 100%，12 卷仅缺 1 个 `∼`(U+223C，数学波浪号、疑似录入噪声) → **文本规范化为全角波浪号 `～`(U+FF5E)**。
- 结论：emoji/sym/int 全部移除，无符号丢失。

## 子集化实现

### 字符集构成（每个思源子集字体包含）

- 该字体接管的所有部位的**实际用字并集**（从该卷文本扫描，按已确认的字体绑定）。
  - 宋 Regular 子集 ≈ 正文全字（约 2000+）＋ 副标题/简介/消息/注释用字。
  - 宋 Bold 子集 ≈ 标题＋目录用字（约几十~上百）。
  - 黑 Bold 子集 ≈ 黑体分隔标题用字（少量）。
- **全书用到的标点 / 全角符号 / 拉丁字母 / 数字**全集（确保移除 emoji/sym 后零缺符号）。

### 工具与模块

- 子集化工具：`subset-font`（harfbuzz 内核）。思源为 CFF/OTF outline，子集输出保持 CFF → 文件用 `.otf` 扩展名，OPF `media-type` 用 `font/otf`（或 `application/vnd.ms-opentype`）。
- 新增共享模块 `src/core/font-subset.js`：
  - 输入：epub 各部位用字映射 + 3 个思源源字体路径。
  - 输出：3 个子集字体 ＋ 重写后的 `necessary.css` / `default.css`。
  - 职责：扫用字 → 子集化 → 写新字体 → 重构 CSS（新 @font-face + 选择器重映射 + 删孤儿）→ 删旧字体文件 → 更新 OPF manifest。

### 集成进两条管线

- **09**（`migrate-epub.js`）：字体复制步骤（setupBuildDir）后，替换为「调用 font-subset 生成思源子集 + 重构 CSS」。
- **11/12/13**（`lightnovel-html/index.js`）：styleRef 字体复制后，调用同一 font-subset 逻辑。

## 影响面

1. ＋依赖 `subset-font`。
2. ＋资产 `books/source-han-sans-sc/`（思源黑体，下载 Regular/Medium/Bold 用于定稿与子集）；Serif 已在 `books/source-han-serif-sc/`。
3. ＋共享模块 `src/core/font-subset.js`，＋2 处管线集成。
4. **e2e golden（09）**：`OEBPS/Fonts/*` 与 `OEBPS/Styles/*.css` 的 hash 全变 → 更新 `test/fixtures/yimei09/golden-manifest.json`（预期内变更）。
5. **重新生成成品**：09×1 ＋ 11/12/13 各正文版&特典版×6 ＝ **7 个 epub**。
6. **体积**：每卷字体约 1.3~1.7MB（宋 Regular 子集为主，标题/黑体子集极小），原约 0.9MB，略增；远小于全量内嵌（20MB+/卷）。

## 实施顺序（细化交由 writing-plans）

1. 下载思源黑体 SC（Regular/Medium/Bold）到 `books/source-han-sans-sc/`，用并排样张在 Medium/Bold 间定稿 ch1 字重。
2. 加依赖 `subset-font`。
3. 写 `src/core/font-subset.js`（扫用字 + 子集化 + CSS 重构 + 删旧字体 + 改 OPF）。
4. 集成进 `migrate-epub.js`（09）。
5. 集成进 `lightnovel-html/index.js`（11/12/13）。
6. 12 卷 U+223C → U+FF5E 文本规范化。
7. 更新 e2e golden（09）。
8. 重新生成 7 个成品，跑覆盖审计验证零缺字。
9. 全量测试。

## 验收标准

1. 7 个成品的标题/目录/简介/正文用字，对应思源子集字体**零缺字**（coverage 脚本验证）。
2. CSS 里只剩 3 个思源 @font-face，无任何旧字体名 / 孤儿引用。
3. `OEBPS/Fonts/` 只有 3 个思源子集字体，无 emoji/sym/int 及旧字体。
4. 全量测试（`npm test`）通过（golden 更新后）。
5. 每卷字体体积 < 2MB。

## 非目标

- 不改正文译文内容（除 12 卷 U+223C → U+FF5E 规范化）。
- 不动 14/15 卷（healed 日翻，尚无台简产物）。
- 不改排版结构、图片、footnote/特典 group 逻辑。
- 不替换 emoji/sym/int 的功能（已验证无用，直接移除而非替换）。

## 待确认/风险

- **ch1 黑体字重**：当前评估 Bold 700，实施第 1 步下载思源黑体后用并排法在 Medium(500)/Bold(700) 间最终定稿。
- **subset-font 对 CFF 的输出**：确认输出 OTF(CFF) 且阅读器（多看/各 epub reader）兼容；必要时回退为转 TrueType glyf。
- **独立 family 名兼容性**：以 family 名区分字重，避免 weight 匹配问题；同时保留 font-weight 声明。
