# epub-clean-js

义妹生活 EPUB 处理工具集。Node ESM 实现。本工程合并自 Python `scripts/` + Node 半成品 `yimei-epub-migrate/` + 11-15 卷反混淆原型，是该项目的**唯一最终工程**。

**状态**：✅ Phase 1-3 全部完成（97/97 全测 PASS，09 卷与 Python 基线 byte-level 一致）。

## 子命令

| 命令 | 作用 | 适用范围 |
|---|---|---|
| `strip`  | 反混淆（多看商店版混淆文件名 → 还原） | 11-15 卷 |
| `heal`   | 反混淆、路径修复、注释修复和 NCX 格式整理 | 卷号 >=11 的日翻源 EPUB |
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
  --volume 09 \
  --book yimei-seikatsu
```

`--out` 可选：缺省时默认输出到 `<PROJECT_ROOT>/output/translated/[三河ごーすと].义妹生活.<volume>.[台简].epub`（由 `profile.paths.translatedDir` + `filePatterns.translated(volume)` 拼出）。需要落到其他位置传 `--out /your/path.epub` 覆盖即可。书名只带 `[台简]` 尾缀，与源文件靠目录区分（源在项目根，产物在 `output/translated/`）。

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

### 日翻源反混淆与路径修复（heal）

```bash
npm run heal
npm run heal -- "[三河ごーすと].义妹生活.16.[日翻].epub" "[三河ごーすと].义妹生活.17.[日翻].epub"
npm run heal -- "*16*.epub" "*17*.epub"
npm run heal -- "incoming/**/*{16,17}*.epub"
npm run heal -- --help
```

无参数时，`heal` 扫描 `profile.paths.rawDir` 顶层文件，选择文件名符合 `[三河ごーすと].义妹生活.NN.[日翻].epub`、卷号为纯数字且 >=11 的全部源 EPUB，按数字卷号排序。新增 16、17、18 等卷无需维护卷号列表；08、09、`another days` 和带 `.healed` / `.clean` 等后缀的产物不会入选。

有参数时，只处理指定路径或 glob 匹配的合规源文件。相对路径和相对 glob 都以 `profile.paths.rawDir` 为基准，不以运行命令的工作目录为基准；当前该目录是外层仓库根，即包含源 EPUB 和 `epub-clean-js/` 工程目录的目录。也支持绝对文件路径、绝对 glob 和带目录的相对 glob。

每个参数先按字面路径查找，因此精确文件名中的方括号无需转义；路径不存在时再作为 glob 解析。glob 支持 `*`、`**`、`{16,17}` 等常规语法，方括号在 glob 中表示字符类。建议将参数放在引号内，避免 shell 提前展开。同一卷号下，同一源文件被路径别名或多个参数匹配时只处理一次；每个参数都必须匹配至少一个合规源，否则报错。

输入选择和输出冲突检查全部通过后才开始写文件；不同源文件若会写入同一个输出路径，则报错。处理顺序保持 `strip → deobfuscate → heal → footnoteFix → ncxFormat`，书名保持 `[日翻]` 尾缀，输出为 `output/healed/[三河ごーすと].义妹生活.NN.[日翻].healed.epub`。

### 11-15 卷排版对齐（align/all）

```bash
npm run align  # 卷 11-15 → output/clean/[三河ごーすと].义妹生活.NN.[日翻].clean.epub
npm run all    # 仍沿用 align 的 11-15 卷流程
```

`align` 和 `all` 仍使用 `profile.vols` 的 11-15 卷列表。

> 历史目录 `unlocked/` 已废弃，所有程序产物现在统一落到项目根 `output/` 下：
> - `output/translated/` = 09 卷迁移产物（`*.[台简].translated.epub`）
> - `output/healed/` = 卷号 >=11 的日翻反混淆产物（`*.[日翻].healed.epub`）
> - `output/clean/` = align 产物（`*.[日翻].clean.epub`）
>
> 产物文件名一律带 `.translated` / `.healed` / `.clean` 后缀，避免与项目根的源 epub 同名混淆。

## 测试

```bash
npm test                 # unit + e2e
npm run test:unit        # 只跑单测
npm run test:e2e         # 只跑 e2e
npm run test:portability # 不依赖外部字体和 HyRead 数据的跨平台专项
```

测试入口用 Node 递归选择 `.test.js` 文件，不依赖 shell 展开 glob，也不会把 fixture 里的浏览器脚本作为测试执行。e2e 使用当前 Node 可执行文件、系统临时目录和 Node ZIP 库，不要求安装 `unzip`。迁移 e2e 从外层仓库根读取 09 卷台简源、09 卷日翻源和 07 卷排版参考；完整套件还需要 `books/source-han-*/` 原始字体和 HyRead 工作数据，缺失时会报错。

e2e 验收基线：normalized hash 与 `test/fixtures/yimei09/golden-manifest.json` 100% 一致（74 文件，仅 3 条 normalize mask：UUID×2 + ISO 时间戳）。

### 跨平台验证范围

运行环境声明为 Node >=18。本次已在 Windows 的 Node 18.20.8 和 Node 22.23.2 上验证 `test:portability`，覆盖 heal 输入选择、Unicode 分解形式的日文源文件名、CLI 模块加载、默认资源路径、通用注释修复和 golden manifest 生成。glob 模式和待匹配路径统一转成 NFC 比较，读文件时保留文件系统返回的原路径。文件去重保留卷号差异，不会把两个独立文件仅凭 NFC 名称相同合并。

`.github/workflows/portability.yml` 配置了 Windows、Linux、macOS × Node 18/22 的六组 CI，运行 `npm ci` 和 `npm run test:portability`。Linux/macOS 的运行结果需等 CI 执行后确认；本地写入 workflow 不代表这些平台已经验证通过。

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
│       ├── heal.js / heal-inputs.js        # 卷号 >=11 的日翻源选择与修复
│       ├── all.js / align.js               # 11-15 卷排版管线
│       ├── migrate-translation.js          # 09 卷台版译文迁移
│       └── footnote-fix.js                 # 通用注释升级
├── books/
│   └── yimei-seikatsu/                     # 义妹生活 book profile
│       ├── profile.js                      # 卷首格言/插图/特典/注释 overrides + 路径/文件名/align 卷号
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

`books/yimei-seikatsu/profile.js` 通过 `PROJECT_ROOT = path.resolve(__dirname, "../../..")` 计算外层仓库根，用于 `heal`（卷号 >=11）和 `align/all`（11-15 卷）读源 epub、写 `output/healed/` 或 `output/clean/`，以及 `migrate-translation` 默认写 `output/translated/`。

把整个 `epub-clean-js/` 拷走后，只要带上源 epub 文件作为输入，所有子命令都能独立工作。

## 设计与历史

- 设计文档：`../../docs/superpowers/specs/2026-05-22-py-to-node-migration-design.md`
- 实施计划：`../../docs/superpowers/plans/2026-05-22-py-to-node-migration.md`
- 验收记录：`../../docs/superpowers/phase{1,2,3}-acceptance.md`
- 迁移完成总记录：`../../docs/migration-completion.md`
- Python ↔ Node 差异审计：`docs/python-node-diff.md`

## 历史归档

- `archive/scripts-py/` — 原 Python `scripts/` 迁移管线的 17 个 `.py` 逻辑文件 + templates/ + README + requirements.txt。**已不再维护**，仅作为查阅旧逻辑、定位迁移源头的参考。Bug 修复请改 Node 版。
