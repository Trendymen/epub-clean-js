# Phase 2 验收记录

日期：2026-05-22
执行人：W6 implementer
范围：Task 12-17（footnote-fix 通用化）

## 完成的 Task

- **T12 边界识别**：通用部分（buildSteraFootnote + footnoteFixEpub）下沉到 `src/core/stages/footnote-fix.js`；业务部分（books/yimei-seikatsu/migrate/footnote-cleaner.js）改为薄包装直接转发到 core。义妹特定逻辑暂为空，但保留模块以便未来扩展。
- **T13 core/stages/footnote-fix.js**（313 行）：
  - 低层 `buildSteraFootnote(fn, n) -> [refHtml, asideHtml]`：与原 books 实现 100% 一致（V8 多端兼容：<sub> + width="25" + aside + ol style:none + li id 重复 + 反向链接前缀）
  - 内部辅助 `upgradeFootnotes(xhtml)`：单章升级（兼容 calibre/duokan/epub3 noteref/旧 sup+img 锚点；删除旧 aside/note 容器后追加新 V8 aside；保留 XML 声明）
  - 高层 `footnoteFixEpub(in, out)`：整本流水线（adm-zip 解包 → 找 textDir 候选 OEBPS/Text、Text、OPS/Text → linkedom 升级 → 重打包；mimetype 第一）
  - note.webp / note1.webp 按正文前缀 "评：" 区分
- **T14 footnote-cleaner.js 改薄包装**（18 行）：直接转发 core 的 buildSteraFootnote；签名与返回值与原实现完全一致。原 unit 测试无需改动即 95/95 PASS。
- **T15 entries/footnote-fix.js**（27 行）：CLI 入口；parseArgs 解析 --in / --out；不依赖任何 book profile。
- **T16 footnote-fix e2e 测试**（118 行）：使用 V3-duokan-minimal.epub fixture；spawn CLI → 解包 → 断言 V8 关键标记（sub + duokan-footnote + epub:type=noteref + width=25 + zhangyue-footnote class + zy-footnote 属性 + aside + ol style:none + li id + 反向链接前缀 "注1：" + 不残留旧 id=note01/value=01）
- **T17 全测验收**：97/97 PASS（95 unit + 2 e2e）

## 验收指标

| 指标 | 期望 | 实测 |
|---|---|---|
| npm test 总数 | 97 PASS | 97 PASS（0 fail） |
| unit | 95 PASS | 95 PASS |
| e2e | 2 PASS | 2 PASS |
| migrate-translation e2e | 0 mismatch | 0 mismatch（normalized hash 100% 一致） |
| footnote-fix e2e | PASS | PASS |

## 文件清单

新增：
- `epub-clean-js/src/core/stages/footnote-fix.js`（313 行）
- `epub-clean-js/src/entries/footnote-fix.js`（27 行）
- `epub-clean-js/test/e2e/footnote-fix.e2e.test.js`（118 行）

修改：
- `epub-clean-js/books/yimei-seikatsu/migrate/footnote-cleaner.js`（18 行；薄包装）

未触碰（禁修区域）：其他 books/ 文件、migrate-epub.js、其他 core 模块、profile.js、cli.js、package.json、test/fixtures/、test/scripts/。

## CLI 用法

```bash
node bin/cli.js footnote-fix --in input.epub --out output.epub
```

输出示例：
```
footnote-fix 完成: /tmp/footnote-fix-smoke.epub（处理 2 章节, 1 章改动, textDir=OEBPS/Text）
```

## 关键设计决策

1. **buildSteraFootnote 保持 `(fn, n) -> [refHtml, asideHtml]` 旧签名**：fn 仍是 `{ text, imgFilename }`，回报数组而不是对象。这样 books 转发只需一行，且原 11 个 unit 测试无需改动即可继续生效。
2. **锚点识别不用带冒号的 CSS 选择器**：`a[epub\\:type="noteref"]` 在 linkedom 里有兼容性风险，改为遍历 `a[href^="#"]` 再读 `getAttribute('epub:type')` / class 判断。
3. **sup/sub 父级整体替换**：旧锚点常被 `<sup>` 包裹，替换 anchor 时若父级只有这一个有效子节点，整体替换避免出现嵌套 sub。
4. **保留 XML 声明、删去 prefix 端复刻 DOCTYPE**：linkedom 的 `document.toString()` 已经保留 DOCTYPE，prefix 只补 XML 声明，避免输出双 DOCTYPE。

## Diagnostics 检查

vscode-mcp-server 工具在本会话未注册，已跳过 IDE 级 diagnostics 检查。改为通过 `npm test`（97/97 PASS）+ smoke 测试（CLI 实际跑通 V3-duokan-minimal.epub）验证。

## 下一步

Phase 3 归档清理（Task 18-21）。
