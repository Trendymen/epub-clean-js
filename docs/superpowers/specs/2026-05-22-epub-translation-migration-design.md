# 义妹生活 09 卷 EPUB 译文迁移与注释保留 — 设计文档

**日期**：2026-05-22
**目标产物**：`/Users/liuzhuo/Downloads/义妹生活/[三河ごーすと].义妹生活.09.[台简].epub`
**实施方案**：方案 A（07-STERA 模板拷贝）

---

## 1. 任务定义

### 1.1 用户原始需求

1. 把 SRC（`义妹生活 - 09台简粗糙排版.epub`）的台版译文全部替换并迁移到 DST（`[三河ごーすと].义妹生活.09.[日翻].epub`）的容器
2. 修复其中的注释（SRC 有注释优先用 SRC 的，不冲突的合并；本卷 SRC 无注释，故全部沿用 DST 的 11 条）
3. 输出新文件
4. 顺带对比 DST 与 07 卷的排版差别，选定最终排版

### 1.2 涉及文件

| 代号 | 文件路径 | 在任务中的身份 |
|---|---|---|
| **SRC** | `/Users/liuzhuo/Downloads/义妹生活/义妹生活 - 09台简粗糙排版.epub` | 译文源（台版繁→简译文） |
| **DST** | `/Users/liuzhuo/Downloads/义妹生活/[三河ごーすと].义妹生活.09.[日翻].epub` | 被替换的目的容器（提供 11 条注释、22 张插图、章节标题、附章日翻文本） |
| **REF07** | `/Users/liuzhuo/Downloads/义妹生活/[三河ごーすと].义妹生活.07.[台简].epub` | 排版蓝本（虚空文学旅团 STERA 排版，提供 CSS/Fonts/Misc/章节模板） |
| **OUT** | `/Users/liuzhuo/Downloads/义妹生活/[三河ごーすと].义妹生活.09.[台简].epub` | 最终产物 |

### 1.3 关键事实（已探索）

- SRC：13 章（chapter0 是插图章，chapter1-12 是正文），**无任何注释/脚注**（全文无 sup/aside/footnote/译注/括号注）
- DST：每章拆 split_000/001/002，共 39 个 XHTML，11 条 duokan+zhangyue 私有格式注释（4 条「评：」译者吐槽 + 7 条「注：」译注，其中 1 条在 special0001 章内）
- REF07：每章一个完整 XHTML，13 个章节文件，CSS 仅 162 行（vs DST 860 行），类名高度语义化
- DST 与 REF07 的 `Misc/script.js` 字节相同
- DST 的 Fonts 含 11 个 ttf，比 REF07 多 emoji.ttf/sym.ttf，缺 int.ttf

---

## 2. 用户决策清单（已确认）

| # | 决策点 | 选择 |
|---|---|---|
| 1 | 注释策略 | 保留 DST 全部 11 条，升级为 REF07 STERA 格式 |
| 2 | 文件结构 | 合并 split，每章一个完整 XHTML（跟随 REF07） |
| 3 | 元数据 | 以 DST 为基础，title/description 改用 SRC |
| 4 | 输出名 | `[三河ごーすと].义妹生活.09.[台简].epub` |
| 5 | 译文迁移粒度 | 逐段对齐替换 |
| 6 | 注释定位 | 智能启发式 + 不确定项写入 align_report 让用户确认 |
| 7 | 排版骨架 | 采用 REF07 STERA 排版（10 维度对比 7 胜 2 平 0 负） |
| 8 | 实施方案 | 方案 A（07-STERA 模板拷贝） |

---

## 3. 排版对比结论（独立交付物 #2）

### 3.1 量化对比

| 维度 | DST 09（日翻） | REF07（台简） | 更好 |
|---|---|---|---|
| 生产线 | Calibre 7.21 自动转出 | 虚空文学旅团 STERA 专业排版 | ✅ REF07 |
| 章节文件数 | 39（每章拆 split） | 13（每章一个） | ✅ REF07 |
| CSS 总行数 | 860（776+84） | 162（98+61+3） | ✅ REF07（精简 5×） |
| CSS 类语义 | calibre22/25/27（无语义） | cover/illus/kuchie/dot/em10/red/main | ✅ REF07 |
| 不重复 class 数 | 62 个 | 25 个 | ✅ REF07 |
| 设备自适配 | 无 @media | @media PC/手机/Kindle 三态 | ✅ REF07 |
| 字体系统 | 10 套 .ttf（无 int.ttf） | 10 套 .ttf（含 int.ttf 强调） | ≈ 平手 |
| 注释格式 | 含未闭合 `<a>`、calibre 噪音 | 结构清爽 | ✅ REF07 |
| `script.js` | 与 REF07 完全相同 | 同上 | = 同源 |
| EPUB 体积 | 3.65 MB | 4.30 MB（含插图） | 无关 |

### 3.2 结论

**REF07 排版在 10 个维度中 7 个明显优于 DST，2 个平手，0 个劣势**。决定采用 REF07 排版作为 OUT 文件的骨架。这样 OUT 与已有的 01-07 卷视觉/字体/字号体系完全统一。

---

## 4. 实施设计

### 4.1 文件骨架（OUT 目录结构）

```
mimetype
META-INF/
  container.xml                          ← 拷 REF07
  com.apple.ibooks.display-options.xml   ← 拷 REF07
  zhangyue-expansion.xml                 ← 拷 REF07
OEBPS/
  content.opf                            ← 改写（见 §4.5）
  toc.ncx                                ← 改写
  Misc/script.js                         ← 拷 REF07（与 DST 字节相同）
  Styles/
    necessary.css                        ← 拷 REF07（98 行）
    default.css                          ← 拷 REF07（61 行）
    stylesheet.css                       ← 拷 REF07（3 行）
  Fonts/                                 ← REF07 全集 + DST 的 emoji.ttf、sym.ttf
                                            （ch1/ch2/ch3/ctt1/ctt2/int/main/mes/note/sum/emoji/sym.ttf）
  Images/                                ← 全部来自 DST 09（22 张：cover.jpg、kuchie-001~005、
                                            note.webp、note1.webp、logo.webp、
                                            p039/p062/p137/p177/p196/p209/p242/p267/p304/p318.webp、
                                            t1~t4.webp、toc-001.webp）
  Text/
    cover.xhtml / title.xhtml / message.xhtml / summary.xhtml /
    TOC.xhtml / pre.xhtml / navigation-documents.xhtml    ← 拷 REF07 模板，仅改具体内容
    illus0001.xhtml ~ illus0004.xhtml                     ← 用 DST 的 kuchie-001~005 重排
    chapter0001.xhtml ~ chapter0012.xhtml                 ← 12 章正文（见 §4.2-§4.4）
```

### 4.2 章节模板与命名

**章节映射**（SRC → OUT）：

| SRC 文件 | SRC 标题 | OUT 文件 | 数据来源 |
|---|---|---|---|
| Cover.xhtml | 封面 | cover.xhtml | DST cover.jpg |
| chapter0.xhtml | 插图 | illus0001-0004.xhtml | DST kuchie-001~005.webp |
| chapter1.xhtml | 6/12 浅村悠太 | chapter0001.xhtml | SRC 译文 + DST chapter0001_split_000+001 合并取注释 |
| chapter2.xhtml | 6/12 绫濑沙季 | chapter0002.xhtml | SRC 译文 + DST chapter0002 合并 |
| chapter3.xhtml | 6/13 浅村悠太 | chapter0003.xhtml | SRC 译文 + DST chapter0003（已合并，含 3 条注释） |
| chapter4.xhtml | 6/13 绫濑沙季 | chapter0004.xhtml | SRC 译文 + DST chapter0004 合并（含 1 条注释） |
| chapter5-12 | 同理 | chapter0005-0012.xhtml | SRC 译文 + DST 对应章节合并 |
| Credits.xhtml | 制作人员 | （不引入） | DST message.xhtml 已覆盖此功能 |

**章节标题处理**：使用 DST 的 `<h3>` 全角空格分隔格式（`6月12日（星期六）　浅村悠太`），渲染才与 STERA ch2 字体兼容。

**单章 XHTML 模板**（基于 REF07 chapter0002 反推）：

```xml
<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh"
      xmlns:epub="http://www.idpf.org/2007/ops">
<head>
 <title>{标题，如 6月12日（星期六）　浅村悠太}</title>
 <link href="../Styles/stylesheet.css" rel="stylesheet" type="text/css"/>
 <script type="text/javascript" src="../Misc/script.js"></script>
</head>
<body>
 <h3>{标题取自 DST h3}</h3>
 <p>{SRC 段落 1}</p>
 <p>{SRC 段落 2，可能含内联 sup 注释锚点}</p>
 ...
 <note>
  <aside epub:type="footnote" id="note001">
   <a href="#note_ref001"></a>
   <ol class="duokan-footnote-content">
    <li class="duokan-footnote-item" id="note001" value="001">
     <p>{DST 原注释文本}</p>
    </li>
   </ol>
  </aside>
 </note>
</body>
</html>
```

**spine 顺序**：
```
cover → title → message → summary → illus0001-0004 → TOC → pre →
chapter0001-0012 → toc(linear=no)
```

### 4.3 段落对齐策略

**输入**：
- SRC 章节：`S = extract_paragraphs(SRC/chapterN.xhtml)`，取 `<section><p>` 文本
- DST 章节：`D = merge_splits(DST/chapter000N_split_*.xhtml)`，剥 calibre 类后取 `<p>` 文本

**对齐算法**：
```
for chapter_idx in 1..12:
    S = extract_src_paragraphs(chapter_idx)
    D = merge_and_extract_dst_paragraphs(chapter_idx)

    if len(S) == len(D):
        # 等长直接位置映射
        for i in range(len(S)): emit_p(S[i], notes_attached_to(D[i]))
    elif abs(len(S) - len(D)) <= 3:
        # 微小偏差，Needleman-Wunsch DP 对齐
        alignment = needleman_wunsch(S, D, similarity_fn=rapidfuzz.fuzz.ratio)
        emit_with_alignment(alignment)
        log_warn(chapter_idx, len(S), len(D))
    else:
        # 大偏差，中断要求人工指定锚点
        emit_align_report(chapter_idx, S, D)
        halt_for_review()
```

**抽取规则**：
- SRC：解析 `<section><p>...</p></section>`，去首尾空白
- DST：合并 split_000/001/002 body 后取 `<p class="calibreNN">`，去 class、剥 calibreNN 噪音
- ruby 注音处理：SRC 全文**无** ruby 标签（台版译文直接用中文表达，不带原词注解）；DST 有 ruby（如 `<ruby>小园<rt>こぞの</rt></ruby>绘里奈`、`<ruby>BATTERS BOX<rt>击球员区</rt></ruby>`）。因译文一律取 SRC（用户决策 5），ruby 一律**丢弃**，保留 SRC 的纯文本表达。如有必要保留特定 ruby（如棒球术语英文原词），列入 align_report.md 让用户人工决定

### 4.4 注释提取、定位与清洗（11 条）

#### 4.4.1 注释清单

| # | DST 章节 | 类型 | zy-footnote 摘要 | 处理方式 |
|---|---|---|---|---|
| 1 | chapter0001_split_001 | 评 | 学习方法不建议学习这位主人公的方式 | 迁移 |
| 2 | chapter0003 | 注 | 五月晴れ＝梅雨季中的晴天 | 迁移 |
| 3 | chapter0003 | 评 | 对错勿论，不敢苟同 | 迁移 |
| 4 | chapter0003 | 注 | 引用的是仙鹤的报恩 | 迁移 |
| 5 | chapter0004_split_000 | 注 | 「押し競饅頭」游戏说明 | 迁移 |
| 6 | chapter0007_split_002 | 评 | 平均值取样？！没学过数学吗 | 迁移 |
| 7 | chapter0010_split_000 | 评 | 佞武多祭等说明 | 迁移 |
| 8 | chapter0011 | 注 | 棒球三振说明 | 迁移 |
| 9 | chapter0012_split_001 | 注 | 日本 2011 年关停模拟电视信号 | 迁移 |
| 10 | chapter0012_split_001 | 注 | 枕词（まくらことば）说明 | 迁移 |
| 11 | special0001 | 注 | 《东京音头》出处 | special0001.xhtml 是 DST 独家番外（SRC 无对应），保留日翻原文 + 注释结构原位升级到 STERA 格式，仅做 calibreNN 类名剥离 |

#### 4.4.2 抽取流程

```
for each <note> in DST:
    sup_anchor = find <sup><a class="duokan-footnote" .../></sup>
    host_para_text = sup 所在 <p> 的纯文本
    sup_offset = sup 在 host_para_text 中的字符偏移
    before_ctx = host_para_text[max(0, sup_offset-30) : sup_offset]
    after_ctx = host_para_text[sup_offset : sup_offset+30]
    note_text = <li class="duokan-footnote-item"><p>内容</p>
    note_img = src 路径（note.webp 或 note1.webp，按原 DST 映射保留）
    保存为 Footnote(dst_chapter, dst_para_idx, before_ctx, after_ctx, text, img)
```

#### 4.4.3 定位流程

仅适用于主线 12 章中的 **10 条注释**（第 11 条在 special0001.xhtml 独立保留，原位清洗即可，无需定位）。每条 Footnote 独立处理：
```
1. 已知 dst_chapter + dst_para_idx
2. SRC 对应 chapter 已加载段落列表 S
3. 候选段落区间 = S[max(0, dst_para_idx-3) : dst_para_idx+4]
4. 关键词提取：tokens = extract_chinese_tokens(before_ctx + after_ctx)
   - 去标点 / 空格
   - 保留 ≥2 字汉字序列
5. 对每个候选段 s_k 计算命中 token 数
6. 命中 ≥ 2:
   - 在 s_k 中找 before_ctx 关键词的位置作为插入点
   - 插入 <sup><a .../></sup>
7. 未命中:
   - 落到 s_k 段末（标点前）
   - 写入 align_report.md
```

#### 4.4.4 清洗到 STERA 格式

**前（DST 噪音格式）**：
```html
<note class="calibre27"><p class="calibre22">...
    <sup class="calibre28"><a class="duokan-footnote"
        href="chapter0007_split_002.xhtml#note005" id="note_ref005">
      <img alt="note" class="zhangyue-footnote"
           src="../Images/note1.webp" zy-footnote="..."/></a></sup>...</p>
  <aside epub:type="footnote" id="note005" class="pcalibre1 calibre29">
    <a href="chapter0007_split_002.xhtml#note_ref005" class="calibre12">
      <ol class="duokan-footnote-content">
        <li class="duokan-footnote-item" value="005">
          <p class="calibre30">...</p>
        </li>
      </ol>
    </a>
  </aside>
</note>
```

**后（STERA 标准）**：
```html
<note><p>...
    <sup><a class="duokan-footnote" epub:type="noteref"
          href="#note001" id="note_ref001">
      <img alt="note" class="zhangyue-footnote"
           src="../Images/note1.webp" zy-footnote="..."/></a></sup>...</p>
  <aside epub:type="footnote" id="note001">
    <a href="#note_ref001"></a>
    <ol class="duokan-footnote-content">
      <li class="duokan-footnote-item" id="note001" value="001">
        <p>...</p>
      </li>
    </ol>
  </aside>
</note>
```

**清洗动作**：
- 删除所有 calibreNN 类
- 删除 pcalibre/pcalibre1 类
- 跨文件 href 改为同文件锚（`chapter000X_split_*.xhtml#noteY` → `#noteY`）
- 给 `<li>` 补 `id="noteNNN"`（07 范本有，DST 无）
- 保留 `note.webp` / `note1.webp` 二元映射（评：用 note1，注：用 note）

#### 4.4.5 ID 重编号

每章内 note 从 001 起连续编号。同时同步更新 `<a href="#noteNNN">` 与 `id="note_refNNN"`，避免 DST 跨章重号问题。

### 4.5 元数据（content.opf）

```xml
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"
          xmlns:opf="http://www.idpf.org/2007/opf">
  <dc:title>义妹生活 09</dc:title>
  <dc:creator opf:role="aut">三河ごーすと</dc:creator>
  <dc:creator opf:role="ill">hiten</dc:creator>
  <dc:language>zh</dc:language>
  <dc:publisher>MF文库J</dc:publisher>
  <dc:description><![CDATA[
我紧紧握住他牵着我的那只手，一点都不想放开。

在校是「情侣」，在家是「兄妹」。
悠太与沙季通过磨合找出适当距离，
但是紧接着就因为父母不在而要度过「完全只有两个人的两天」，
两人真的能继续维持适当的距离吗……？
另一方面，学校活动、朋友的青春与加油、与打工新人「后辈小妹」的交流等，
崭新的风毫不留情地吹向悠太与沙季……？
「相遇」至今一年，历经许多事而改变的两人，迎来高中生活最后的夏天。
经历过友情、青春、新的相遇之后，「兄妹」所面对的感情是──
  ]]></dc:description>
  <dc:identifier id="BookId">urn:uuid:{Python uuid.uuid4() 生成的新 UUID v4}</dc:identifier>
  <dc:subject>校园</dc:subject>
  <dc:subject>青春</dc:subject>
  <dc:subject>恋爱</dc:subject>
  <dc:subject>妹妹</dc:subject>
  <meta property="belongs-to-collection">义妹生活</meta>
  <meta property="group-position">9</meta>
  <meta name="cover" content="cover"/>
  <meta property="dcterms:modified">2026-05-22T00:00:00Z</meta>
</metadata>
```

**manifest**：列出所有 chapter/illus/cover/title/message/summary/TOC/navigation-documents/pre/start.xhtml + 所有 fonts + 所有 images + 3 个 css + 1 个 js + toc.ncx。

**spine**：照 REF07 顺序，省略 illus0005-0006（09 卷只 5 张 kuchie，对应 4 个 illus 槽位）。

### 4.6 三套 TOC

- `navigation-documents.xhtml`（EPUB3 nav）
- `toc.ncx`（EPUB2 兼容）
- `TOC.xhtml`（用户可见目录页）

三者章节列表统一为 12 章 + 4 illus，标题取自 DST h3 文本。

### 4.7 实施工具

**纯 Python**（stdlib zipfile + lxml）：

| 模块 | 职责 |
|---|---|
| `extract_paragraphs(xhtml)` | 解析 XHTML，返回 `[(text, inline_html_runs)]` |
| `align_notes(src_paras, dst_notes)` | 启发式定位，返回 `[(para_idx, char_offset, note_html)]` |
| `render_chapter(template, title, paras, notes)` | Jinja2 渲染单章 XHTML |
| `pack_epub(out_path, files_dict)` | 装配 EPUB（mimetype 在 zip 首位、无压缩） |

预估 350-500 行脚本。

---

## 5. 交付物清单

| # | 文件 | 用途 |
|---|---|---|
| 1 | `/Users/liuzhuo/Downloads/义妹生活/[三河ごーすと].义妹生活.09.[台简].epub` | 主交付物 EPUB |
| 2 | `/Users/liuzhuo/Downloads/义妹生活/layout-comparison-report.md` | 排版对比报告 |
| 3 | `/Users/liuzhuo/Downloads/义妹生活/align_report.md` | 注释定位与对齐审计报告 |

---

## 6. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| REF07 main.ttf 是台版字符子集，可能不覆盖 SRC 罕字 | 中 | CSS fallback 链 main→emoji→sym 兜底；阅读器系统字体二次兜底 |
| 注释启发式定位可能 1-2 条偏位 | 中 | align_report 列出全部 11 条位置 + 置信度，人工核对 |
| DST 与 SRC 章节段落数差异 > 3 | 低（已预测段数相近） | DP 对齐 + N:M 大偏差中断要求人工锚点 |
| REF07 字体声明引用了不存在的 illus1-5.ttf/cont.ttf/num.ttf/title.ttf | 低 | epubcheck warning 但不阻碍阅读，浏览器自动 fallback |
| DST note id 跨章重复 | 低 | 每章重新连续编号 + 同步更新 href/id |
| 注释 host_para 内含 ruby 标签会破坏 char_offset 计算 | 中 | 用纯文本（剥 ruby tag）算 offset，再映射回结构化 HTML |

---

## 7. 后续步骤

设计批准后，进入 writing-plans skill 生成实施计划（按文件/模块拆分具体步骤）。然后按计划执行：

1. 准备脚本与模板
2. 单章试跑（chapter0001 + chapter0003 含最多注释）
3. 用户 review chapter0001 / chapter0003 产出
4. 批跑余下 10 章
5. epubcheck 校验 + 阅读器走查
6. 生成 layout-comparison-report.md 与 align_report.md
7. 交付
