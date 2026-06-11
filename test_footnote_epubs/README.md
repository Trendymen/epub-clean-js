# 注释结构兼容性测试 EPUB

5 个 EPUB 文件，唯一变量是注释结构 HTML。每个文件只有 1 段正文 + 1 个注释。

## 测试矩阵

| 阅读器 | V1 纯 EPUB3 | V2 EPUB3+ARIA | V3 多看最小 | V4 STERA 完整 | V5 STERA 无 DupId |
|---|---|---|---|---|---|
| 多看 Reader |  |  |  |  |  |
| 掌阅 iReader |  |  |  |  |  |
| Apple Books / iBooks |  |  |  |  |  |
| Calibre Viewer |  |  |  |  |  |
| koreader |  |  |  |  |  |
| Kindle Previewer |  |  |  |  |  |
| 其他 |  |  |  |  |  |

填表说明：✅ 弹出注释正文 / ⚠ 跳转到 aside 但无弹层 / ❌ 完全不显示

## 5 个变体说明

### V1-strict-epub3-pure
纯 EPUB 3 标准：<sup><a noteref> + <aside footnote>，零私有扩展

### V2-strict-epub3-aria
EPUB 3 + ARIA role（doc-noteref / doc-footnote），最严格

### V3-duokan-minimal
多看私有扩展最小集：duokan-footnote class + img zy-footnote + aside 同 body 顶层（无 note 容器、无 Duplicate ID）

### V4-stera-clean15-full
STERA / 11 卷 clean 完整同款：<note> 包 p+aside、a 包 ol、li 同 id（Duplicate ID 故意）

### V5-stera-no-dup-id
STERA 折中：含 <note> 容器、a 包 ol，但 li 去掉 id 避免 Duplicate ID（epubcheck 更干净）

### V6-dual-compat
双兼容方案：V3 多看私有扩展 + V2 ARIA role（无 <note> 容器、无 Duplicate ID）

### V7-stera-full-with-aria
V4 完整结构 + ARIA role（<note> 包+li id+a 包 ol+role doc-noteref/footnote），双兼容首选候选

### V8-authoritative-cross-platform
权威多端兼容（多看+掌阅+Kindle+iBooks/AppleBooks）：无 note 容器、aside 顶层、ol 列表反向链接
