# epub-clean-js

义妹生活 EPUB 处理工具集，使用 Node ESM，要求 Node >=18。本工程由原 Python `scripts/`、Node `yimei-epub-migrate/` 和 11-15 卷反混淆原型合并而来，后续修改在此维护。

09 卷迁移保留 normalized golden 基线。当前测试结果以本次运行输出为准；完整套件还依赖外部 EPUB、字体和 HyRead 工作数据，历史 97/97 不是当前全套结果。

## 子命令

| 命令 | 作用 | 适用范围 |
|---|---|---|
| `strip`  | 反混淆（多看商店版混淆文件名 → 还原） | 11-15 卷 |
| `heal`   | 反混淆、路径修复、注释修复和 NCX 格式整理 | 卷号 >=11 的日翻源 EPUB |
| `align`  | 排版对齐（剥 calibre + STERA 微调） | 11-15 卷 |
| `all`    | strip + heal + align 串跑 | 11-15 卷 |
| `migrate-translation` | 把台版译文迁移到日翻 epub 容器，套用 07 卷 STERA 排版骨架 | 09 卷（绑义妹生活）|
| `footnote-fix` | 把任意 epub 的注释升级到 09 台简 V8 多端兼容风格 | **通用**（不绑书）|
| `prepare-fonts` | 校验并准备固定版本的 Adobe 思源字体与许可证 | 使用字体子集的转换流程 |
| `build-yimei-simple` | 按指定数字卷批量生成普通版与附特典版 | 义妹生活 HTML / HyRead 源 |
| `hyread-to-simple` | 指定单卷 HyRead EPUB 转台简 | 数字卷自动选素材；短篇合集使用显式路径 |

## 用法

### 字体准备与台简构建

在包目录 `epub-clean-js/` 中执行：

```bash
npm run prepare:fonts
npm run build:yimei-simple -- --volumes 14
npm run build:yimei-simple -- --volumes 14,15 --root /path/to/books --out-dir /path/to/products
```

字体准备从 Adobe 官方仓库的固定 tag 下载思源黑体 `2.004R` 和思源宋体 `2.003R`，逐份校验文件长度与 SHA-256，并把字体和 `LICENSE.txt` 写入 `books/source-han-sans-sc/`、`books/source-han-serif-sc/`。来源、固定 hash 与文件清单见 `src/core/font-resources.js`；许可证为 SIL Open Font License。粗体的两个排版角色共用同一个源文件。字体目录已被 Git 忽略，不提交字体二进制。

有本地缓存时可执行 `npm run prepare:fonts -- --cache-dir /path/to/cache`。缓存文件名采用清单的 `name` 字段（许可证分别为 `source-han-sans-LICENSE.txt` 和 `source-han-serif-LICENSE.txt`）；只有长度和 hash 都符合才复用。已有目标文件校验通过后直接复用，缓存损坏时重新下载。下载超时、HTTP 失败、长度或 hash 不符时命令失败，不替换已有文件，也不会留下本次临时片段。普通转换不会自动联网准备字体；字体缺失会提示先运行准备命令。

批处理无参数仍只处理 `11,12,13`；`--volumes` 覆盖这个默认批次。指定的纯数字卷按以下路径查找，无需增加卷号白名单。相对默认素材以外层仓库根为基准，`--root` 可替换该根目录：

- 图源优先 `output/hyread/[三河ごーすと].义妹生活.NN.[台繁].hyread.epub`，其次 `义妹生活NN[台繁].epub`。12 卷保留例外：优先根目录旧台繁源，缺失时回退到存在的 HyRead 源。08、11、13 保留原有 HyRead 优先级。
- 基础排版参考为根目录文件名包含 `义妹生活.07.` 和 `[台简]` 的 EPUB；同卷特典与排版素材来自 `output/healed/` 下包含 `义妹生活.NN.` 与 `[日翻].healed.epub` 的文件。文件名匹配支持 NFC/NFD Unicode 形式。
- 存在 `NN.html` 时沿用 HTML 入口，否则直接读取 HyRead EPUB。所有卷的必需输入和字体预检通过后才创建输出或备份。

默认产物为 `output/simple/[三河ごーすと].义妹生活.NN.[台简].epub` 和同名的 `[台简][特典].epub`。普通版不含特典，附特典版导入同卷 healed 源的特典。重建前会把已有同卷两种成品复制到 `backup-before-build-时间戳/`；`--skip-backup` 可关闭备份。

单卷入口保留显式路径参数：

```bash
node bin/cli.js hyread-to-simple --volume 14 --out /path/to/14.epub
node bin/cli.js hyread-to-simple --volume another-days --source /path/to/source.epub --ref /path/to/ref.epub --out /path/to/another-days.epub
```

`--source`、`--ref`、`--style-ref` 分别覆盖自动查找的字段，已提供的输入不依赖默认目录存在。11/12/13 省略 `--style-ref` 时继续查找默认同卷 healed 源；其他数字卷以及 `another-days` 在同时显式提供 `--source` 和 `--ref` 时，允许省略 `--style-ref`，只使用基础布局。数字卷需要自动补齐 source/ref 时，也会要求同卷 healed 源。`another-days`（含 `an`、`AN` 别名）必须显式提供 source/ref。单卷默认附特典，`--no-include-specials` 生成普通版。

三个台简入口 `hyread-to-simple`、`lightnovel-html-to-epub` 和 `build-yimei-simple` 都支持 `--wording taiwan|mainland`。默认 `taiwan` 使用固定版本的 OpenCC `tw2s` 转简体，保留台版措辞；例如“網路”“訊息”变成“网路”“讯息”。`mainland` 只额外替换已核对的三个词组：“网路上 → 网络上”“手机萤幕 → 手机屏幕”“智慧型手机 → 智能手机”，不是完整的大陆用词转换。

```bash
node bin/cli.js hyread-to-simple --volume 14 --out /path/to/14.epub --wording mainland
npm run build:yimei-simple -- --volumes 14 --wording mainland
node bin/cli.js lightnovel-html-to-epub --html /path/to/11.html --ref /path/to/ref.epub --out /path/to/11.epub --wording mainland
```

可选词组与原生 ruby 本体或实际渲染的手工注音匹配范围相交时，该次替换会跳过。命令会报告源文件、段落、规则和 UTF-16 区间；原生读音命中还会报告 ruby 和 rt 序号。程序直接传入注音结构时，若未提供源 `rubyIndex` 或 `rtIndex`，对应序号会标为未知。ruby 与内联脚注的边界无法无损保留、未配对 ruby 出现在目录或章节标题，或整段只有无本体的读音时，构建会停止；HyRead 输入会报告源文件和段落。直接传入的书名或制作信息若带注音，或者目录和章节标题无法保留注音范围，也会报错。已经按 `mainland` 转换的程序输入不能直接再次组装；已转换数据的正文、读音或注音范围被修改后，也不能直接再次转换。这两种情况都需要重新读取源文。批处理诊断标明普通版或特典版；回调记录的 `includeSpecials` 为 `false` 表示普通版，为 `true` 表示特典版。HTML 的每条显式 `--ruby` 规则会报告实际命中次数，零命中时提示检查匹配文本。部分匹配丢失无法仅靠总次数发现，需要对照新旧正文检查。程序接口可通过 `wording` 选择模式，并用 `onDiagnostic(event)` 接收这些记录。

HyRead 入口按源文位置识别章节标题和原生 ruby，本体与读音都繁转简，不会把正文中相同的普通字符串自动改成 ruby。HTML 入口保留已有显式 `--ruby 'text|base|ruby'` 参数，用于为普通文本指定替换串、ruby 本体与读音；它属于文本匹配兼容模式，不能恢复源书中已经丢失的注音位置。生成时统一 OPF/NCX 的 UUID，修复导入脚注的重复 ID，并在发布输出前检查 EPUB 必需元数据、内部资源与片段链接、重复 ID、CSS 引用、manifest 资源存在性和 OPF/NCX 标识一致性；校验失败时保留已有输出。当前运行时不检查 spine 的 itemref/idref 与 manifest 的对应关系。结构检查不能替代阅读器显示验收。

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

`.github/workflows/portability.yml` 配置了 Windows、Linux、macOS × Node 18/22 的六组 CI，运行 `npm ci` 和 `npm run test:portability`。各平台实际结果以对应提交的 CI 记录为准；本地检查只代表本机结果。

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
