# epub-clean-js

义妹生活 EPUB 处理工具集。Node ESM 实现。本工程合并自 Python `scripts/` + Node 半成品 `yimei-epub-migrate/` + 11-15 卷反混淆原型，是该项目的**唯一最终工程**。

**状态**：✅ Phase 1-3 全部完成（97/97 全测 PASS，09 卷与 Python 基线 byte-level 一致）。

## 子命令

| 命令 | 作用 | 适用范围 |
|---|---|---|
| `strip`  | 反混淆（多看商店版混淆文件名 → 还原） | 11-15 卷 |
| `heal`   | 路径修复（OPF item id → 反混淆路径映射） | 11-15 卷 |
| `align`  | 排版对齐（剥 calibre + STERA 微调） | 11-15 卷 |
| `all`    | strip + heal + align 串跑 | 11-15 卷 |
| `migrate-translation` | 把台版译文迁移到日翻 epub 容器，套用 07 卷 STERA 排版骨架 | 09 卷（绑义妹生活）|
| `footnote-fix` | 把任意 epub 的注释升级到 09 台简 V8 多端兼容风格 | **通用**（不绑书）|

## 用法

### migrate-translation（09 卷台版译文迁移，绑义妹生活）

```bash
node bin/cli.js migrate-translation \
  --src "/path/to/义妹生活 - 09台简粗糙排版.epub" \
  --dst "/path/to/[三河ごーすと].义妹生活.09.[日翻].epub" \
  --ref "/path/to/[三河ごーすと].义妹生活.07.[台简].epub" \
  --out "/path/to/[三河ごーすと].义妹生活.09.[台简].epub" \
  --volume 09 \
  --book yimei-seikatsu
```

### footnote-fix（通用注释升级）

```bash
node bin/cli.js footnote-fix --in input.epub --out output.epub
```

输出统一为 09 台简 V8 多端兼容结构（多看 + 掌阅 + Kindle Previewer + Apple Books + Calibre 五端测试通过）：
- `<sub><a class="duokan-footnote" epub:type="noteref">` 锚点 + `width="25"` img
- `<aside epub:type="footnote">` + `<ol style="list-style:none">` + `<li id="noteNNN">`
- 反向链接 `<a href="#refNNN">注N</a>：`
- 自动区分图标：`注：xxx` → `note.webp`、`评：xxx` → `note1.webp`
- 每章独立编号（`noteNNN` / `note_refNNN`，三位补零）

**前提**：epub 内需已有 `OEBPS/Images/note.webp` 与 `note1.webp` 资源。

### 11-15 卷反混淆（heal/align）

```bash
npm run heal   # 卷 11-15 → unlocked/healed/*.healed.epub
npm run align  # 卷 11-15 → unlocked/clean/*.clean.epub
```

源 epub 默认从项目根目录读取（`profile.paths.rawDir = PROJECT_ROOT`，4 层上跳）。

## 测试

```bash
npm test          # unit + e2e（97 cases）
npm run test:unit # 只跑单测（95 cases）
npm run test:e2e  # 只跑 e2e（2 cases：migrate-translation + footnote-fix）
```

e2e 验收基线：normalized hash 与 `test/fixtures/yimei09/golden-manifest.json` 100% 一致（74 文件，仅 3 条 normalize mask：UUID×2 + ISO 时间戳）。

## 目录结构

```
epub-clean-js/
├── bin/cli.js                              # 统一 dispatcher
├── src/
│   ├── core/                               # 通用底座
│   │   ├── zip-io.js / opf.js / paths.js / pipeline.js / validator.js / ...
│   │   └── stages/
│   │       ├── strip.js / heal.js / align.js / deobfuscate.js
│   │       └── footnote-fix.js             # 通用注释升级（Phase 2 抽取）
│   └── entries/
│       ├── all.js / heal.js / align.js     # 11-15 卷管线
│       ├── migrate-translation.js          # 09 卷台版译文迁移
│       └── footnote-fix.js                 # 通用注释升级
├── books/
│   └── yimei-seikatsu/                     # 义妹生活 book profile
│       ├── profile.js                      # 卷首格言/插图/特典/注释 overrides + 11-15 paths/vols/filePatterns
│       ├── migrate/                        # 09 卷迁移管线 stages（12 模块）
│       └── templates/                      # Nunjucks 模板（chapter / nav / TOC / opf / ncx）
├── test/
│   ├── unit/yimei-seikatsu/                # 11 个 *.test.js（95 cases）
│   ├── e2e/                                # migrate-translation + footnote-fix
│   ├── fixtures/yimei09/                   # SRC/DST/REF + golden manifest
│   └── scripts/build-golden-manifest.mjs   # golden 重生成工具（normalize 含 3 条 mask）
├── docs/python-node-diff.md                # Python ↔ Node 行为差异审计
├── archive/scripts-py/                     # 原 Python 实现（仅保留 .py 逻辑代码 + README + requirements.txt，供迁移参考）
├── package.json / package-lock.json
├── README.md
└── node_modules/
```

## 外部依赖

工程本身**内部完全自洽**（零硬编码路径、零跨工程相对引用）。仅 1 个**有意的外部耦合**：

`books/yimei-seikatsu/profile.js` 通过 `PROJECT_ROOT = path.resolve(__dirname, "../../../..")` 计算项目根，用于 11-15 卷 `heal/align` 读源 epub + 写 `unlocked/healed/`、`unlocked/clean/`。

把整个 `epub-clean-js/` 拷走后，只要带上源 epub 文件作为输入，所有子命令都能独立工作。

## 设计与历史

- 设计文档：`../../docs/superpowers/specs/2026-05-22-py-to-node-migration-design.md`
- 实施计划：`../../docs/superpowers/plans/2026-05-22-py-to-node-migration.md`
- 验收记录：`../../docs/superpowers/phase{1,2,3}-acceptance.md`
- 迁移完成总记录：`../../docs/migration-completion.md`
- Python ↔ Node 差异审计：`docs/python-node-diff.md`

## 历史归档

- `archive/scripts-py/` — 原 Python `scripts/` 迁移管线的 17 个 `.py` 逻辑文件 + templates/ + README + requirements.txt。**已不再维护**，仅作为查阅旧逻辑、定位迁移源头的参考。Bug 修复请改 Node 版。
