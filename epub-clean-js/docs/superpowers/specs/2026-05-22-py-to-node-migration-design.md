---
title: Python 流程迁移到 Node ESM 工程化设计（义妹生活 09 卷迁移管线）
date: 2026-05-22
status: completed (Phase 1-3 全过；正式产物已替换为 Node 版；详见 docs/migration-completion.md)
related_specs:
  - 2026-05-22-epub-translation-migration-design.md
  - 2026-05-22-epub-deobfuscate-clean-design.md
  - 2026-05-22-epub-pipeline-split-design.md
related_artifacts:
  - /Users/liuzhuo/Downloads/义妹生活/scripts/                          # Python 实现（待归档）
  - /Users/liuzhuo/Downloads/义妹生活/yimei-epub-migrate/                # Node 半成品移植（待挂载）
  - /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/               # 统一工程容器（合并目标）
  - /Users/liuzhuo/Downloads/义妹生活/[三河ごーすと].义妹生活.09.[台简].epub  # 当前 Python 产物
  - /Users/liuzhuo/Downloads/义妹生活/align_report.md                   # 注释定位审计
---

# Python 流程迁移到 Node ESM 工程化设计

## 1. 背景与目标

### 1.1 背景

义妹生活 09 卷的「台版译文 → 日翻 epub 容器 + STERA 排版」迁移工作的当前状态：

- **Python 实现**（`scripts/`, 1650 行 / 13 模块 / 11+ pytest）：已生成最终产物 `[三河ごーすと].义妹生活.09.[台简].epub`（4.4MB）。注释风格固化为多看 duokan + 掌阅 zhangyue 双兼容私有扩展，这是用户最终选定的形式。
- **Node 半成品**（`yimei-epub-migrate/`, 1363 行 / 12 模块 / 12 单元测试）：Python 流程的 ES Module 移植。骨架完整、单元测试全过，但与 Python 最新版有约 17% 行数差距，未做端到端验证。
- **独立的统一工程容器**（`epub-clean-js/`）：已完成 11-15 卷反混淆工具，包含 `src/core/`、`src/core/stages/`、`src/entries/` 等 ESM 工程化骨架。该工程的 11-15 卷 healed 产物属于「终极形态」，本次迁移不得破坏。

### 1.2 目标

把 Python 流程**完整迁移**到 Node ESM 实现，并将 `yimei-epub-migrate/` 合并进 `epub-clean-js/`，让该工程成为一个**统一的 epub 处理工具集**，按子命令暴露不同管线。

### 1.3 非目标

- **不**改进/重写 11-15 卷的 healed 产出（11-15 已是终极形态）
- **不**优化注释定位算法（align_report.md 中 LOW 置信度问题靠 `profile.footnoteOverrides` 人工覆盖）
- **不**抽象 `migrate-translation` 为多书通用管线（用户已确认绑死义妹生活，唯一通用化点是 `footnote-fix`）
- **不**引入 TypeScript（保持 ESM 纯 JS）
- **不**重写已有 12 个 yimei-epub-migrate 单元测试（搬入即用，仅修 import 路径）
- **不**改 Python `scripts/` 源码（直接归档，bug 在 Node 侧修源头）

## 2. 设计约束（来自 brainstorming 收敛的用户决策）

| 决策 | 选择 |
|---|---|
| 引言重复 bug 修复策略 | 直接改 epub 产物（P1.2），源头修复并入 Node 迁移（P1.7） |
| 工程化布局 | core+entries+books 三层 |
| 工程位置 | 直接在 `epub-clean-js/` 内上手，`yimei-epub-migrate/` 后期归档 |
| 工程通用化范围 | core 通用、`migrate-translation` 绑死义妹生活、`footnote-fix` 通用 |
| Python 归档时机 | Phase 3，验收全过后归档为 `archive/scripts-py/` |
| 插图取舍机制 | `books/yimei-seikatsu/profile.js` 配置表，不做自动判定 |
| 验收基线 | Node 产物与 Python 产物**文件级内容**一致（normalized hash） + e2e 测试覆盖主管线 |
| 迁移路径 | **方案 C：业务管线端到端优先**（先跑通 09 卷，再抽 footnote-fix 通用子流，最后归档） |

## 3. 整体架构

### 3.1 目录结构（合并后）

```
epub-clean-js/
├── package.json                          # 子命令注册
├── bin/
│   └── cli.js                            # 统一 dispatcher
├── src/
│   ├── core/                             # 通用底座
│   │   ├── zip-io.js
│   │   ├── opf.js
│   │   ├── paths.js
│   │   ├── patchers.js
│   │   ├── validator.js
│   │   ├── pipeline.js
│   │   ├── constants.js
│   │   └── stages/
│   │       ├── strip.js                  # 既有（11-15 用）
│   │       ├── heal.js                   # 既有
│   │       ├── align.js                  # 既有
│   │       ├── deobfuscate.js            # 既有
│   │       └── footnote-fix.js           # 新增（Phase 2，通用注释升级）
│   ├── entries/                          # CLI 子命令入口
│   │   ├── all.js                        # 既有：11-15 卷完整管线
│   │   ├── heal.js                       # 既有
│   │   ├── align.js                      # 既有
│   │   ├── migrate-translation.js        # 新增（Phase 1，绑义妹生活 09）
│   │   └── footnote-fix.js               # 新增（Phase 2，通用 epub）
│   └── books/
│       └── yimei-seikatsu/               # 第一个 book profile
│           ├── profile.js                # 配置：格言/插图/特典/注释偏好
│           ├── migrate/                  # 09 卷迁移管线 stages
│           │   ├── epub-io.js
│           │   ├── paragraph-extractor.js
│           │   ├── aligner.js
│           │   ├── footnote-extractor.js
│           │   ├── footnote-relocator.js
│           │   ├── footnote-cleaner.js
│           │   ├── chapter-renderer.js
│           │   ├── extras-cleaner.js
│           │   ├── inline-image-extractor.js
│           │   ├── metadata-builder.js
│           │   ├── toc-builder.js
│           │   └── migrate-epub.js       # 主编排
│           └── templates/                # Nunjucks 模板
├── test/
│   ├── unit/
│   │   └── yimei-seikatsu/               # 12 个已有单测搬入
│   ├── e2e/
│   │   ├── migrate-translation.e2e.test.js
│   │   └── footnote-fix.e2e.test.js
│   └── fixtures/
│       └── yimei09/                      # SRC/DST/REF + golden manifest
└── archive/                              # 最终态（Phase 3）
    ├── scripts-py/                       # 原 Python scripts/ 移入
    └── yimei-epub-migrate-old/           # 原 yimei-epub-migrate/ 移入
```

### 3.2 CLI 子命令一览

| 命令 | 作用 | 输入 | 输出 | 实现 Phase |
|---|---|---|---|---|
| `strip` | 反混淆（11-15 用） | 混淆 epub | clean.epub | 既有 |
| `heal` | 路径修复 | clean.epub | healed.epub | 既有 |
| `align` | 排版对齐 | healed.epub | aligned.epub | 既有 |
| `all` | strip+heal+align 串跑 | 混淆 epub | aligned.epub | 既有 |
| **`migrate-translation`** | 台版译文 → 日翻容器 | SRC + DST + REF | `[卷].台简.epub` | Phase 1 新增 |
| **`footnote-fix`** | 注释升级到 09 台简风格 | 任意 epub | 升级后 epub | Phase 2 新增 |

`migrate-translation` 是义妹生活专用，未来若加其他书需另开 entry。
`footnote-fix` 是通用工具，不依赖 book profile。

## 4. 业务层设计

### 4.1 `books/yimei-seikatsu/profile.js` 数据结构

义妹生活专用的业务决策全部落在此文件，不在代码里硬编码。

```js
export default {
  id: 'yimei-seikatsu',
  name: '义妹生活',
  author: '三河ごーすと',

  // 卷首格言：DST 日翻 pre.xhtml 的译文（用于引言去重 hash 匹配）
  epigraphs: {
    '09': '冷静的人生规划不保证会有幸福的人生。幸福藏在刹那间的狂热之中。',
  },

  // 插图清单（手动决定保留哪些 + 插在哪里）
  inlineImages: {
    '09': [
      { src: 'p039.webp', chapter: 1, afterParaIdx: 328 },
      { src: 'p062.webp', chapter: 2, afterParaIdx: 69 },
      { src: 'p137.webp', chapter: 4, afterParaIdx: 246 },
      { src: 'p177.webp', chapter: 6, afterParaIdx: 73 },
      { src: 'p196.webp', chapter: 7, afterParaIdx: 168 },
      { src: 'p209.webp', chapter: 7, afterParaIdx: 320 },
      { src: 'p242.webp', chapter: 8, afterParaIdx: 305 },
      { src: 'p267.webp', chapter: 10, afterParaIdx: 180 },
      { src: 'p304.webp', chapter: 12, afterParaIdx: 8 },
      { src: 'p318.webp', chapter: 12, afterParaIdx: 183 },
    ],
  },

  // 特典清单：保留 DST 日翻原文（不做台版段落对齐）
  specials: {
    '09': [
      { id: 'special0001', title: '电子书特典　『棉花糖般甜蜜』', source: 'DST', hasFootnotes: true },
      { id: 'special0002', title: '蜜瓜特典　『倘若有未来博物馆』', source: 'DST', hasFootnotes: false },
      { id: 'special0003', title: 'Animate特典4P小册子　『适合婚礼的月份』', source: 'DST', hasFootnotes: false },
    ],
  },

  // 注释定位人工修正表（覆盖 footnote-relocator 自动定位结果）
  footnoteOverrides: {
    '09': {
      // Phase 1 留空，由用户在 align_report 复核后手工填入
    },
  },

  // 排版参考来源（卷 → REF 卷）
  refLayout: '07',
};
```

### 4.2 `migrate-translation` 子流 stage 编排

主编排在 `books/yimei-seikatsu/migrate/migrate-epub.js`，顺序如下：

| Stage | 模块 | 输入 | 输出 | 等价 Python |
|---|---|---|---|---|
| 1. 拆容器 | `epub-io.js` | SRC/DST/REF epub | 3 个解包目录 | `epub_io.py` |
| 2. 抽段落 | `paragraph-extractor.js` | SRC/DST xhtml | 段落字符串数组 | `paragraph_extractor.py` |
| 3. 段落对齐 | `aligner.js` | SRC + DST 段落数组 | 对齐索引映射 | `aligner.py` |
| 4. 抽注释 | `footnote-extractor.js` | DST xhtml | 注释列表 | `footnote_extractor.py` |
| 5. 注释定位 | `footnote-relocator.js` | 注释 + SRC 段落 + `profile.footnoteOverrides` | 注释插入点 | `footnote_relocator.py` |
| 6. 注释升级 | `footnote-cleaner.js` | DST 注释 | 09 台简风格注释块 | `footnote_cleaner.py` |
| 7. 内联插图 | `inline-image-extractor.js` | `profile.inlineImages` | 插图插入点 | `inline_image_extractor.py` |
| 8. 渲染章节 | `chapter-renderer.js` | 段落+注释+插图 + `profile.epigraphs` 判定 | 章节 XHTML | `chapter_renderer.py` |
| 9. 生成附章 | `extras-cleaner.js` | DST + REF + profile | cover/title/message/summary/pre/contents/TOC + specials | `extras_cleaner.py` |
| 10. 元数据 | `metadata-builder.js` | profile + 章节清单 | `content.opf` | `metadata_builder.py` |
| 11. TOC | `toc-builder.js` | profile + 章节清单 | `toc.ncx` + `nav.xhtml` | `toc_builder.py` |
| 12. 打包 | `epub-io.js` | 完整 build/ 目录 | `[卷].台简.epub` | `epub_io.py` |

### 4.3 引言重复 bug 修复逻辑

在 stage 8 `chapter-renderer.js` 渲染 chapter 1 时插入 hash 检查：

```js
import { createHash } from 'node:crypto';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

function renderChapter1(srcParas, profile, volume) {
  const epigraph = profile.epigraphs[volume];
  if (!epigraph) {
    return renderXhtml(srcParas, { ... });
  }
  const firstParaHash = sha256(srcParas[0].trim());
  const epigraphHash = sha256(epigraph.trim());

  if (firstParaHash === epigraphHash) {
    // 引言已在 pre.xhtml，chapter0001 跳过第一段
    return renderXhtml(srcParas.slice(1), { ... });
  } else {
    console.warn(`[chapter1/volume ${volume}] epigraph hash mismatch, keeping para[0] verbatim`);
    return renderXhtml(srcParas, { ... });
  }
}
```

匹配失败回退（保留 + warning）是为了避免误删非引言段。

## 5. Phase 1 详细实施计划

### 5.1 任务编号与依赖

```
P1.0 创建空目录骨架
     └─ epub-clean-js/ 下新建 archive/、test/、books/

P1.1 黄金基线锁定
     └─ 解包 Python 版 [09.台简].epub 到 test/fixtures/yimei09/golden-py/
        计算每个 XHTML/OPF/NCX 文件的 normalized SHA256
        生成 test/fixtures/yimei09/golden-manifest.json

P1.2 修引言重复 bug（直接改产物）
     └─ 解包 [09.台简].epub → 编辑 chapter0001.xhtml 删第一个 <p>冷静的人生规划...</p>
     → 重新打包 → 覆盖原 [09.台简].epub
     → 重算 golden manifest（这才是真正基线）

P1.3 yimei-epub-migrate 模块挂载
     └─ 复制 src/*.js 到 books/yimei-seikatsu/migrate/，重命名为 kebab-case
        修 import 路径，templates 也搬过来

P1.4 单元测试挂载
     └─ 12 个 *.test.js 搬到 test/unit/yimei-seikatsu/
        修 import 路径
        node --test test/unit/yimei-seikatsu/ 全绿

P1.5 写 books/yimei-seikatsu/profile.js
     └─ 按 §4.1 填充 09 卷 epigraphs/inlineImages/specials
        footnoteOverrides 留空

P1.6 写 entries/migrate-translation.js
     └─ 解析 --src/--dst/--ref/--out/--volume/--book 参数
        调用 books/<book>/migrate/migrate-epub.js

P1.7 chapter-renderer.js 加引言去重逻辑
     └─ 按 §4.3 代码片段

P1.8 extras-cleaner.js 行数差距修复
     └─ 以 Python extras_cleaner.py (246 行) 为基准做逐函数对照清单
        每补一条缺失逻辑：补 Node 实现 + 加 fixture 单测
        目标：附章 hash 与 golden manifest 一致

P1.9 e2e 测试编写
     └─ test/e2e/migrate-translation.e2e.test.js
        - 完整执行 cli.js migrate-translation
        - 解包输出
        - 逐文件比对 normalized hash
        - 失败时打印首个差异位置的 unified diff

P1.10 Phase 1 验收闭环
     └─ npm test 全绿
        手工 epubcheck 错误数 ≤ 41
        手工阅读器打开看引言不重复
```

### 5.2 golden manifest 结构

```json
{
  "source": "[三河ごーすと].义妹生活.09.[台简].epub (Python 版, 引言修复后)",
  "generated_at": "2026-05-22T17:00:00Z",
  "files": {
    "OEBPS/Text/chapter0001.xhtml": {
      "sha256_normalized": "<hex>",
      "para_count": 529,
      "footnote_count": 1
    },
    "OEBPS/Text/pre.xhtml": { "sha256_normalized": "<hex>" },
    "OEBPS/content.opf": { "sha256_normalized": "<hex>" },
    "OEBPS/toc.ncx": { "sha256_normalized": "<hex>" }
  }
}
```

### 5.3 normalized hash 处理规则

为允许 zlib 压缩参数差、whitespace 微差，但要求文本与结构完全一致：

- 折叠连续 whitespace 为单个空格
- 移除空行
- 排除 calibre 注入的版本号（如 `<meta name="calibre:..."/>`）
- 保留所有可见文本与 HTML 标签结构（含属性顺序、引号风格）

### 5.4 Phase 1 验收清单

- [ ] `npm test` 全绿（12 unit + 1 e2e）
- [ ] e2e 输出与 golden manifest 100% hash 一致
- [ ] epubcheck 错误数 ≤ 41（与 Python 版一致）
- [ ] 手工阅读器打开页 8/9，引言不再重复
- [ ] `align_report.md` 生成且与 Python 版一致（注释定位置信度分布相同）

## 6. Phase 2：抽取通用 footnote-fix 子流

### 6.1 通用 vs 业务边界

**通用部分**（可抽到 `src/core/stages/footnote-fix.js`）：
- 抽取任意 epub 现有 footnote 锚点（兼容 `epub:type=noteref` / calibre / duokan / 私有格式）
- 重新编号为 `noteNNN` / `note_refNNN`（每章独立）
- 渲染为 09 台简风格 `<sub><a class="duokan-footnote">` + `<aside>` 结构
- 注释/评论区分（`note.webp` vs `note1.webp`）

**业务部分**（保留在 `books/yimei-seikatsu/migrate/`）：
- `footnote-relocator.js`（基于 SRC↔DST 段落对齐结果定位插入点）—— 依赖台版/日翻对照工作流，不通用

### 6.2 任务列表

```
P2.1 识别通用/业务边界（按 §6.1）
P2.2 在 src/core/stages/ 下新建 footnote-fix.js
P2.3 把 books/yimei-seikatsu/migrate/footnote-cleaner.js 改为薄包装
     委托 core/stages/footnote-fix.js
P2.4 新建 entries/footnote-fix.js
     node bin/cli.js footnote-fix --in xxx.epub --out yyy.epub
P2.5 写 footnote-fix e2e 测试
P2.6 Phase 2 验收：migrate-translation e2e 仍 100% golden hash 一致
```

### 6.3 Phase 2 验收清单

- [ ] `footnote-fix` CLI 可处理任意 epub
- [ ] `migrate-translation` e2e 仍然 100% golden hash 一致
- [ ] 两条管线共享同一份 core 代码（无重复实现）

## 7. Phase 3：归档清理

```
P3.1 归档 Python scripts/
     └─ mv scripts/ archive/scripts-py/
        mv tests/ archive/scripts-py-tests/
        mv requirements.txt archive/scripts-py/

P3.2 归档原 yimei-epub-migrate/
     └─ mv yimei-epub-migrate/ epub-clean-js/archive/yimei-epub-migrate-old/

P3.3 更新 docs/
     └─ docs/migration-completion.md
        记录归档时间、行数对照、golden hash 索引

P3.4 更新 README
     └─ epub-clean-js/README.md
        加 migrate-translation 与 footnote-fix 用法范例
```

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| **R1** extras_cleaner 70 vs 246 行差距藏多个未移植规则 | Node 产物附章与 Python 版不一致 | 以 Python 为基准做**逐函数清单 + 逐规则对拍**，每补一条加 fixture 测试 |
| **R2** 12 单元测试 import 路径耦合旧目录 | P1.3 挂载后测试断裂 | P1.4 第一步**先迁 import 路径并跑绿**，再开始端到端 |
| **R3** Phase 2 抽取 footnote-fix 破坏 P1 基线 | migrate-translation e2e 回归 | P1.10 末固化 09 卷 normalized hash golden；P2 重构后必须复现同一组 hash |
| **R4** 引言去重误删非引言段 | chapter1 缺段 | SHA256 精确匹配，匹配失败回退保留 + 打 warning |
| **R5** Python scripts/ 过早归档，Node 跑挂时无回退 | 项目卡死 | P3 仅在 Phase 2 验收全过后执行；归档不删除 |
| **R6** 影响 11-15 卷 healed 既有产物 | 现有终极形态被破坏 | 新 stages 走独立命名空间，不复用 11-15 的 strip/heal/align/all 入口 |

## 9. 验收基线（整体）

Node 完整迁移完成的标志：

1. `node bin/cli.js migrate-translation --src "义妹生活 - 09台简粗糙排版.epub" --dst "[09.日翻].epub" --ref "[07.台简].epub" --out "[09.台简].node.epub" --book yimei-seikatsu --volume 09` 能跑通
2. 输出 epub 解包后 normalized hash 与 golden manifest 100% 一致
3. `node bin/cli.js footnote-fix --in any.epub --out any-fixed.epub` 能独立处理任意 epub
4. `npm test` 全绿（unit + e2e）
5. epubcheck 错误数 ≤ 41
6. 阅读器手工验证：12 个正文章节 + 3 个特典 + pre.xhtml 引言不重复
7. Python `scripts/` 与原 `yimei-epub-migrate/` 已归档到 `archive/`

## 10. 后续步骤

1. 用户审阅本 spec
2. 通过后调用 `superpowers:writing-plans` skill 生成详细实施计划
3. 实施计划按 Phase 1 → Phase 2 → Phase 3 串行推进
4. 每 Phase 末有人工验收检查点
