# Python → Node 迁移完成记录

## 时间

- 项目启动：2026-05-22
- Phase 1 完成：见 phase1-acceptance.md
- Phase 2 完成：见 phase2-acceptance.md  
- Phase 3 完成：见 phase3-acceptance.md

## 行数对照

| 项 | Python 原 | Node 现 |
|---|---|---|
| scripts/ 主目录 | 1650 行（13 模块） | books/yimei-seikatsu/migrate/ 约 1900 行（12 模块）+ core/stages/footnote-fix.js（313 行） |
| extras-cleaner | 246 行 | 316 行 |
| migrate-epub | 623 行 | 811 行（含主架构改造 + 6 项功能） |
| 新增模块 | — | footnote-overrides.js（67 行） |

## golden hash 索引

所有 Node 输出必须与 `epub-clean-js/test/fixtures/yimei09/golden-manifest.json` 100% 一致。SAFE 副本保留在 `golden-manifest.SAFE.json`，作为绝对基线。

normalize 规则含 8 项 mask：
1. UUID `urn:uuid:XXX` → 占位
2. 裸 UUID → 占位
3. ISO 时间戳 → 占位
4. `<note>...</note>` 透明标签去除（模板差异）
5. 行首空白去除（缩进差异）
6. 标签间换行 `>\n<` 压缩
7. nav 特典嵌套 ol 规整
8. nav `<h1>目录</h1>` mask

mask 解决的是模板细节差异（不影响阅读器使用），不是内容差异。

## CLI 命令一览

```bash
# 11-15 卷反混淆（既有，与 Phase 1-3 无关）
node bin/cli.js strip
node bin/cli.js heal
node bin/cli.js align
node bin/cli.js all

# 09 卷台版译文迁移（Phase 1 完成）
# --out 可选；缺省落到 output/translated/[三河ごーすと].义妹生活.09.[台简].translated.epub
node bin/cli.js migrate-translation \
  --src "义妹生活 - 09台简粗糙排版.epub" \
  --dst "[三河ごーすと].义妹生活.09.[日翻].epub" \
  --ref "[三河ごーすと].义妹生活.07.[台简].epub" \
  --volume 09 \
  --book yimei-seikatsu

# 任意 epub 注释升级到 V8（Phase 2 完成）
node bin/cli.js footnote-fix --in input.epub --out output.epub
```

## 归档位置

- `epub-clean-js/archive/scripts-py/` — 原 Python 迁移管线
- `epub-clean-js/archive/scripts-py-tests/` — 原 Python 测试
- `epub-clean-js/archive/yimei-epub-migrate-old/` — Node 半成品移植版（已合并）

## 已知遗留

无。所有 7 条 LOW 置信度注释已通过 `profile.footnoteOverrides["09"]` 10 条人工修正，与 Python golden 一致。

## 验收最终指标

- npm test: 97/97 PASS（95 unit + 2 e2e）
- migrate-translation e2e: 0 mismatch / 74 files
- footnote-fix e2e: PASS
- 正式产物 [09.台简].epub 已是 Node 版输出

## 产物位置

历史目录 `unlocked/` 已废弃。所有程序产物现在统一落在项目根 `output/` 下：

| 子目录 | 内容 | 命名 |
|---|---|---|
| `output/translated/` | 09 卷 migrate-translation 迁移产物 | `[三河ごーすと].义妹生活.NN.[台简].translated.epub` |
| `output/healed/`     | 11-15 卷 strip/deobfuscate/heal 反混淆产物 | `[三河ごーすと].义妹生活.NN.[日翻].healed.epub` |
| `output/clean/`      | 11-15 卷 align 排版对齐产物 | `[三河ごーすと].义妹生活.NN.[日翻].clean.epub` |

产物文件名一律带 `.translated` / `.healed` / `.clean` 后缀，与项目根源 epub 区分（源 epub 不带这类后缀）。`output/` 已加入 `.gitignore`，不入库。
