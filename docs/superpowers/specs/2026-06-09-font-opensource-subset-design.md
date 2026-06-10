# 台简产物字体开源化 + 按卷子集化设计

**日期**: 2026-06-09
**状态**: 已修正（二次排查后）
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

## 字体识别结论（实证，2026-06-10 四次排查定稿）

原字体元数据（name/OS2 panose/usWeightClass）已被子集化抹除，**任何基于元数据或墨量数值的判断都不可靠**（墨量法在 TTF/CFF 跨格式对比时自相矛盾，曾多次导致误判）。本次以 opentype.js 渲染字形轮廓、与思源黑/宋全字重并排出图肉眼对照为准，并经 Apple Books 实机显示交叉验证。**判定衬线必须 ≥240px 渲染**：72-100px 小图曾把 ch1（太宋/アンチック，横画粗）与 note（宋 Medium）误判为黑体，乌罗科（衬线三角）只有大图可辨。同字墨量跨卷完全一致，证明 09-15 卷角色字体来自同一套母字体，结论适用于全部卷。

另一关键证据：日翻 necessary.css 自带尾随角色注释（错位一格校正后）：ch1/ch2/ch3=正文标题粗/中/细、ctt1/ctt2=目录章节粗/细、cont=目录标题、mes=制作信息、sum=简介、main=正文文本、note=注释——原版本身就是「标题三档+目录两档」的精细字重分级。

| 部位（CSS 选择器） | 原字体 | 实测风格（字面固有） | 渲染匹配（实机校准后） |
|---|---|---|---|
| 章节内分隔标题 `.cut` / `h4` / `.ch1` | ch1 | **太宋 serif（アンチック风格，横画粗，小图易误判黑体；自重介于宋 Bold/Heavy）** | 思源宋 Bold + 合成加粗（纯 Heavy 实机偏重、Heavy+合成糊字） |
| 章节大标题 `h3` / `.ch2` | ch2 | **粗宋 serif** | 思源宋 Bold + 合成加粗 |
| 副标题 `h5` / `.ch3` | ch3 | **半粗宋 serif**（略细于 ctt1） | **纯思源宋 Bold**（Bold Sub 面声明 font-weight:bold 抑制合成；SemiBold+合成实机偏轻） |
| 目录条目 `.toc a` / `.ctt1` | ctt1 | **半粗宋 serif**（略细于 ch2） | 思源宋 SemiBold（无加粗请求，纯字面） |
| 注释 `.note` / `.duokan-footnote-item` | note | **中宋 serif**（横画细于竖画 + 乌罗科） | 思源宋 Medium |
| 目录大标题 `.ctt` / `.ctt2` / `.toc .ctit` | ctt2/cont | **细宋 serif** | 思源宋 Light（+规则层 bolder 合成，与原版同构） |
| 简介 `.summary` / `.sum` | sum | 常规黑 sans（方头） | 思源黑 Regular |
| 消息 `.message` / `.mes` | mes | 圆体 sans（丸ゴシック，类别归黑） | 思源黑 Regular |
| 正文 `body` / `ruby>rt` / `.main` | main | 常规黑 sans（Apple Books 实机确认） | 思源黑 Regular |

> 「实测风格」是字面固有属性（渲染图测得）；「渲染匹配」是 Apple Books 实机校准后的最终选择——日翻标题三档自重（ch1 0.371 > ch2 0.342 > ch3 0.314）全部落在思源 SemiBold~Heavy 一档半的窄区间内，思源无中间档，故用「Bold 字面 × 是否抑制合成」组合逼近：h4=h3=Bold+合成，h5=纯 Bold（介于 SemiBold+合成与 Bold+合成之间）。

TTF 同字直接对比的字重梯队（「的」墨量）：ch1(0.371) > ch2(0.342) > ctt1(0.327) > ch3(0.314) ≫ ctt2(0.236)。

> 历史教训：① 2026-06-09 二次排查曾把 ch2/ctt1 误判为「粗黑 sans」；② 2026-06-10 三次排查在 72-100px 小图下又把 ch1/note 误判为黑体——两次均被更高分辨率字形渲染图与 Apple Books 实机显示推翻。**衬线判定的唯一可靠流程：≥240px 渲染 + 乌罗科/笔画对比肉眼确认 + 实机交叉验证。**

当前实现只对台简产物替换开源字体；11-15 日翻 healed 保持原日翻子集字体，不进入开源字体替换。

## 方案：字体层重构（真实思源命名 + 归并 + 彻底清理）

### ① 归并为 6 个真实命名思源字体（每卷各自子集化，对齐日翻字重分级）

| 新字体文件 | CSS font-family | 源字重 | 接管部位 |
|---|---|---|---|
| `SourceHanSansSC-Regular.subset.otf` | `"Source Han Sans SC"` | 思源黑 Regular | 正文 body/ruby、简介、消息、title/int fallback |
| `SourceHanSerifSC-Light.subset.otf` | `"Source Han Serif SC Light"` | 思源宋 Light | 目录大标题 ctt2/cont/.ctt/.ctit（13 卷 `.ctt` 实际引用 cont） |
| `SourceHanSerifSC-Medium.subset.otf` | `"Source Han Serif SC Medium"` | 思源宋 Medium | 注释 note/.duokan-footnote-item |
| `SourceHanSerifSC-SemiBold.subset.otf` | `"Source Han Serif SC SemiBold"` | 思源宋 SemiBold | 目录条目 .toc a/ctt1 |
| `SourceHanSerifSC-Bold.subset.otf` | `"Source Han Serif SC Bold"` | 思源宋 Bold | 章节大标题 h3/ch2 + 分隔标题 ch1/.cut/h4（含特典来源行） |
| `SourceHanSerifSC-BoldSub.subset.otf` | `"Source Han Serif SC Bold Sub"`（声明 font-weight:bold） | 思源宋 Bold（同源、独立子集） | 副标题 h5/ch3（含特典名） |

思源黑 Bold 与思源宋 Heavy 面经实机校准后**均不再被任何角色使用**，已从输出移除。

用**独立 family 名**（而非同名 + font-weight），规避老阅读器字重匹配不一致。**@font-face 默认不声明 `font-weight`**：日翻原版即「单面族 + 规则层 font-weight」结构，保留规则层 `font-weight:bold` 并让 @font-face 维持默认 400，可使 Apple Books 等阅读器的合成加粗行为与原版逐项一致（如 h3 在原版即「粗字面 + 合成加粗」叠加）。**唯一例外：Bold Sub 面（h5 副标题）声明 `font-weight:bold`**抑制合成，渲染纯 Bold。校准历程（2026-06-10 实机三轮）：① Heavy+合成 → 「典」糊死；② 纯 Heavy → 实机仍重于日翻；③ 定稿 h4=Bold+合成、h5=纯 Bold。

### ② CSS 完整重映射（含 xhtml 内联 `<style>`）

- 新增 6 条 @font-face（指向上表 6 个子集字体），**删除旧全部 @font-face**（09 卷 12 条 / 11 卷 9 条）。
- 所有选择器的 `font-family` 改为真实思源 family 名（按上表归属）。
- fallback 链尾的 `,emoji,sym` 去掉（已验证无用）。
- **xhtml 内联 `<style>` 同步重映射**（TOC 模板、09 特典页等只做 family 重写、不注入 @font-face）。此前内联样式从未被重写，`font-family:ctt1/ctt2` 成死引用回退系统字体——正是「台简目录变 sans / 特典一半黑一半宋」的根因。

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

- 该字体接管的所有部位的**实际用字并集**（从该卷文本扫描，按已确认的字体绑定；`<style>/<script>` 块内容不计入用字）。
  - 黑 Regular 子集 ≈ 正文全字（约 2000+）＋ 简介/消息用字。
  - 宋 Bold 子集 ≈ h3/.ch2 章节大标题 + h4/.cut/.ch1 分隔标题用字。
  - 宋 Bold Sub 子集 ≈ h5/.ch3 副标题用字（同源 Bold、独立小子集）。
  - 宋 SemiBold 子集 ≈ 目录条目（TOC 整页兜底）用字。
  - 宋 Medium 子集 ≈ note/.duokan-footnote-item 注释用字。
  - 宋 Light 子集 ≈ .ctt/.ctt2/.ctit 目录大标题（TOC 整页兜底）用字。
- **全书用到的标点 / 全角符号 / 拉丁字母 / 数字**全集（确保移除 emoji/sym 后零缺符号）。

### 工具与模块

- 子集化工具：`subset-font`（harfbuzz 内核）。思源为 CFF/OTF outline，子集输出保持 CFF → 文件用 `.otf` 扩展名，OPF `media-type` 用 `font/otf`（或 `application/vnd.ms-opentype`）。
- 新增共享模块 `src/core/font-subset.js`：
  - 输入：epub 各部位用字映射 + 6 个思源源字体路径（黑 Regular + 宋 Light/Medium/SemiBold/Bold/Heavy）。
  - 输出：6 个子集字体 ＋ 重写后的 `necessary.css` / `default.css` ＋ 重写后的 xhtml 内联 `<style>`。
  - 职责：扫用字 → 子集化 → 写新字体 → 重构 CSS（新 @font-face + 选择器重映射 + 删孤儿）→ 重映射 xhtml 内联 `<style>` → 删旧字体文件 → 更新 OPF manifest。

### 集成进两条管线

- **09**（`migrate-epub.js`）：字体复制步骤（setupBuildDir）后，替换为「调用 font-subset 生成思源子集 + 重构 CSS」。
- **11/12/13**（`lightnovel-html/index.js`）：styleRef 字体复制后，调用同一 font-subset 逻辑。

## 影响面

1. ＋依赖 `subset-font`。
2. 思源黑体 Sans 已在 `books/source-han-sans-sc/`（Regular/Bold 即用）；思源宋体 Serif 已在 `books/source-han-serif-sc/`（Light/SemiBold/Bold 即用，另有 ExtraLight/Regular/Medium/Heavy 备选）。
3. ＋共享模块 `src/core/font-subset.js`，＋2 处管线集成。
4. **e2e golden（09）**：`OEBPS/Fonts/*` 与 `OEBPS/Styles/*.css` 的 hash 全变 → 更新 `test/fixtures/yimei09/golden-manifest.json`（预期内变更）。
5. **重新生成成品**：09×1 ＋ 11/12/13 各正文版&特典版×6 ＝ **7 个 epub**。
6. **体积**：每卷字体约 1.3~1.7MB（黑 Regular 正文子集为主，3 个宋体标题子集均极小），原约 0.9MB，略增；远小于全量内嵌（20MB+/卷）。

## 实施顺序（细化交由 writing-plans）

1. 思源黑体 Sans（Regular/Bold）与思源宋体 Serif（Light/SemiBold/Bold）已就位；main/sum/mes/note/ch1 归黑体，ch2/ch3/ctt1/ctt2 归宋体（按实证字重分档）。
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
2. CSS 里只剩 6 个思源 @font-face，无任何旧字体名 / 孤儿引用（含 xhtml 内联 `<style>`）。
3. `OEBPS/Fonts/` 只有 6 个思源子集字体，无 emoji/sym/int 及旧字体。
4. 全量测试（`npm test`）通过（golden 更新后）。
5. 每卷字体体积 < 2MB。

## 非目标

- 不改正文译文内容（除 12 卷 U+223C → U+FF5E 规范化）。
- 不动 14/15 卷（healed 日翻，尚无台简产物）。
- 不改排版结构、图片、footnote/特典 group 逻辑。
- 不替换 emoji/sym/int 的功能（已验证无用，直接移除而非替换）。

## 待确认/风险

- **healed 边界**：开源字体替换只作用于台简产物；11-15 日翻 healed 保留原字体子集。
- **subset-font 对 CFF 的输出**：确认输出 OTF(CFF) 且阅读器（多看/各 epub reader）兼容；必要时回退为转 TrueType glyf。
- **独立 family 名兼容性**：以 family 名区分字重，避免 weight 匹配问题；同时保留 font-weight 声明。
