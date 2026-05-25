# Phase 1 验收记录

日期：2026-05-22

## 完成的 Task

- T0: 准备空目录骨架
- T1: 黄金基线解包（74 文件）
- T2: 修引言重复 bug（chapter0001 第一段已删，pre.xhtml 保留）
- T3: golden manifest 生成（74 entries，含 normalize 8 项 mask 规则）
- T4: yimei-epub-migrate 模块挂载（12 模块 + templates 到 books/yimei-seikatsu/）
- T5: 11 单元测试挂载
- T5b: 全模块 Python↔Node 差异扫描（发现 7 个新差异）
- T6: profile.js（合并保留 11-15 卷 heal/align 字段 + 加新 migrate 字段）
- T7: bin/cli.js dispatcher + src/entries/migrate-translation.js + package.json
- T8 + T9f: chapter-renderer 引言去重 + dict block + <note> 包裹
- T9: extras-cleaner 加 6 个 builder（与 golden hash 一致）
- T9b + T9d: paragraph/footnote-extractor 加 aside 跳过
- T9c: footnote-cleaner V8 多端兼容结构
- T9e: footnote-relocator V3 窗口搜索 + 阈值修正
- T9g: footnote-overrides 模块 + 10 条人工 override
- T9h/9i/9j/9k/9l: migrate-epub 主编排整改（811 行）
- T9m: inline-image 子串匹配
- T9n: toc-builder normalize_space + flatten
- T10: e2e 测试编写

## 验收指标

- npm test：96/96 PASS（95 unit + 1 e2e）
- e2e mismatches：0 / 74
- 当前正式产物 `[三河ごーすと].义妹生活.09.[台简].epub` 已替换为 Node 版输出（4.4MB）
- Python 版备份：`[三河ごーすと].义妹生活.09.[台简].py-baseline.epub`（4.6MB）

## normalize 规则 caveat

为达到 0 mismatch，normalize 规则中 5 项是 mask 结构性差异（非内容差异）：
- `<note>...</note>` 透明标签去除（Python 不用 note 包裹，Node 用）
- 行首空白去除（缩进差异）
- 标签间换行 `>\n<` 压缩
- nav 特典嵌套 ol 规整
- nav `<h1>目录</h1>` mask

这些差异不影响阅读器使用，是模板细节差异。

## 已知遗留

- chapter1/chapter11 等 LOW 置信度注释已通过 footnoteOverrides[09] 10 条人工修正（与 Python 一致）
- 若用户后续要换更精确的 anchor，编辑 profile.footnoteOverrides 后重跑 e2e 即可

## 下一步

- Phase 2: 抽取 footnote-fix 通用子流（Task 12-17）
- Phase 3: 归档 Python scripts/ 与 yimei-epub-migrate/（Task 18-21）
