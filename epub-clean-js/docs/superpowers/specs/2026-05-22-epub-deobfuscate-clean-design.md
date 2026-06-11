# EPUB 反混淆与精排版对齐设计

**日期**：2026-05-22
**目标卷**：义妹生活 11 / 12 / 13 / 14 / 15（日翻版）
**基准卷**：义妹生活 07（台简版，干净 STERA 模板）

---

## 1. 背景

5 本目标 EPUB 来自多看商店，是「虚空文学旅团 STERA ePub++」精排版模板的产物。它们在内部资源命名上被打了一层混淆（zip 里文件名形如 `*:*:|??**|:::.webp`，OPF/xhtml/CSS 引用形如 `Images/%2A%3A...webp`）。多看/掌阅自家阅读器能解，但 Sigil 等编辑器无法正常处理，Apple Books 之外的阅读器渲染封面/插图时也会出问题。

第一阶段（已完成）：删除 `META-INF/encryption.xml` 与 `META-INF/zhangyue-expansion.xml`，去掉「DRM 标识」。产物：`unlocked/[三河ごーすと].义妹生活.NN.[日翻].unlocked.epub`。

本设计覆盖第二阶段：反混淆 + 对齐第 7 卷精排版基准。

## 2. 关键事实（已通过现场探查验证）

- 11-15 卷与第 7 卷使用同一套 STERA ePub++ 模板。`default.css` 与 7 卷只差 1 行（`@font-face` 的 url 部分），其余 60 行字符完全一致。
- 11-15 卷的 OPF `<item id="...">` **是干净的语义名**：`cover.jpg`、`kuchie-001.jpg`、`kuchie-002.png`、`ch1.ttf`、`chapter0000.xhtml`、`illus0001.xhtml`、`default.css`、`TOC.xhtml`。这等于自带反混淆映射表。
- 11-15 卷的图片插图 xhtml 已经具备 `<div class="kuchie duokan-image-single"><img zy-enlarge-src="self"/></div>` 结构。这是多看 / 掌阅 / STERA 三家都识别的「点击放大」标记。所以「图片可单独点击放大」需求**不需要新增代码**，只要反混淆后引用对得上即可。
- 注释结构 `<note><sup>...</sup><aside epub:type="footnote">...</aside></note>` 在 11-15 卷里也已存在，与第 7 卷一致。
- 图片格式混合（部分 jpg、部分 png、部分 webp），item id 的扩展名与真实媒体类型一致，可直接信任。

## 3. 目标

1. 5 本卷全部输出到 `unlocked/clean/`，命名 `[三河ごーすと].义妹生活.NN.[日翻].clean.epub`，原文件保留不动。
2. 输出的 EPUB 在 Sigil 里可以正常打开、能看到完整封面/插图/注释，外观尽量贴近第 7 卷。
3. 多看/掌阅/Apple Books 阅读体验不下降，图片点击放大保留。
4. 不伪造书目元数据。

## 4. 非目标（YAGNI）

- 不集成 epubcheck（非刚需，用户没装就跑不了）
- 不做 GUI / 交互预览 / 详细 HTML 报告
- 不做 Calibre / ebook-convert / lxml / BeautifulSoup 依赖（用标准库即可）
- 不并行处理（5 卷串行 I/O 不是瓶颈）
- 不做错误重试、断点续传
- 不动正文 xhtml 内容（不重写章节结构、不改 STERA 模板的 class 系统）
- 不补真实 ISBN（避免任何虚假书目数据）
- 不动 第 7 卷以外其它卷（01-10）

## 5. 总体架构

单文件 Python 脚本 `epub_clean.py`，**只用标准库**：`zipfile` / `xml.etree.ElementTree` / `urllib.parse` / `re` / `hashlib`。

模块拆分：

| 模块 | 职责 | 输入 | 输出 |
|---|---|---|---|
| `parse_opf(zin)` | 找到 OPF，解析 manifest 建映射 | 输入 ZipFile | `(opf_path, tree, ns, mapping)` |
| `remap_path(href, mapping)` | 单条路径反混淆 + fragment 保留 | href, mapping | 干净路径 |
| `patch_xhtml(text, mapping)` | 替换 xhtml 中 link/script/img/a 引用 | xhtml str, mapping | 新 xhtml str |
| `patch_ncx(text, mapping)` | 替换 NCX 的 content src | ncx str, mapping | 新 ncx str |
| `patch_css(text, mapping)` | 正则替换所有 url() 引用 | css str, mapping | 新 css str |
| `patch_opf_metadata(tree, vol_num, src_path)` | 删 duokan/zy id、补 rights/uuid、更新 modified | tree, 卷号, 源文件 | 修改后的 tree |
| `patch_opf_manifest(tree, mapping)` | 重写 manifest item href | tree, mapping | 修改后的 tree |
| `write_epub(out_path, files)` | 写新 zip：mimetype STORED + 其它 DEFLATE | dst, dict | 文件落盘 |
| `process_one(src, dst, vol_num)` | 串联以上 | 单卷输入/输出 | clean.epub |
| `main()` | 遍历 11-15 | - | 5 个 clean.epub |

## 6. 反混淆映射表

从 OPF `<manifest>` 抽取：

```python
mapping = {}
for item in manifest.findall('opf:item', ns):
    raw_href = item.get('href')                       # 'Text/%2A...xhtml'
    decoded  = unquote_recursive(raw_href)            # 'Text/*:|?...xhtml'
    item_id  = item.get('id')                         # 'chapter0001.xhtml'
    dir_name = posixpath.dirname(decoded)             # 'Text'
    new_href = f"{dir_name}/{item_id}" if dir_name else item_id
    mapping[decoded] = new_href
```

`unquote_recursive`：循环 `urllib.parse.unquote` 直到字符串稳定（防双层编码）。

## 7. 引用替换详细规则

### 7.1 xhtml（含 nav.xhtml）

用 ElementTree 解析，注册命名空间 `xmlns`、`xmlns:epub`、`xmlns:xml`。遍历下列属性，对每个值做 `remap_path`：

| 标签 | 属性 |
|---|---|
| `link` | `href` |
| `script` | `src` |
| `img` | `src` |
| `image` | `xlink:href` |
| `a` | `href` |
| `audio`, `video`, `source` | `src` |

`remap_path` 规则：
1. 切分 `path` 与 `#fragment`
2. 对 `path` 做 `unquote_recursive`
3. 解析相对路径，得到相对 OPF 的标准路径
4. 在 mapping 里查；命中则替换为相对当前 xhtml 的新路径；未命中保留原值
5. 拼回 fragment

**纯 fragment 引用**（`href="#noteN"`）：不动。

### 7.2 CSS

正则替换所有 url() 形态（同时覆盖 @font-face、background-image、@import）：

```python
URL_RE = re.compile(r'url\(\s*["\']?([^)"\'\s]+)["\']?\s*\)')
text = URL_RE.sub(
    lambda m: f'url({remap_path(m.group(1), mapping, base="Styles")})',
    text)
```

`base="Styles"` 用于把 CSS 里的相对路径解析为 OEBPS 全局路径。

### 7.3 NCX

正则替换 `<content src="...">`：

```python
NCX_SRC_RE = re.compile(r'(<content\s+src=)"([^"]+)"')
text = NCX_SRC_RE.sub(
    lambda m: f'{m.group(1)}"{remap_path(m.group(2), mapping, base="")}"',
    text)
```

### 7.4 OPF manifest

ElementTree 遍历每个 `<item>`，把 `href` 改写为映射后的干净路径。`<item id>` 已经是干净的，不动。

## 8. 元数据补齐表

补齐前先用 ElementTree 解析 `<metadata>`，遵守「**已存在则保留，不存在才补**」原则。

| 字段 | 11-15 当前状态 | 处置 |
|---|---|---|
| `<dc:title>` | 有（"义妹生活 NN"） | 保留 |
| `<dc:identifier id="BookId">` | 缺 | 补 `urn:uuid:{md5(filename+size)[:32]}`，不伪造 ISBN |
| `<dc:creator id="create">` | 有 | 保留 |
| `<dc:contributor>` | 部分卷有 | 保留 |
| `<dc:rights>` | 缺 | 补 `voidlord`（沿用第 7 卷） |
| `<dc:subject>` | 有（"轻小说"） | 保留 |
| `<dc:language>` | `zh` | 保留 |
| `<meta property="belongs-to-collection">` | 「义妹生活」 | 保留 |
| `<meta property="group-position">` | 11-15 | 保留 |
| `<meta property="dcterms:modified">` | 有 | 更新为今日 `2026-05-22T00:00:00Z` |
| `<meta name="cover" content="...">` | 部分卷有 | 补全：指向 cover image item id |
| `<dc:identifier id="duokan-book-id">none</dc:identifier>` | 有 | **删除** |
| `<dc:identifier id="zhangyue-book-id">none</dc:identifier>` | 有 | **删除** |
| 二者关联的 `<meta refines>` | 有 | **同步删除** |

## 9. 输出包装

写新 zip 时严格遵守 EPUB 容器规范：

1. **第一项** 必须是 `mimetype`，内容 `application/epub+zip`，**ZIP_STORED**（不压缩）
2. 其它文件用 `ZIP_DEFLATED`
3. 跳过输入中可能残留的 `META-INF/encryption.xml`、`META-INF/zhangyue-expansion.xml`
4. 保留 `META-INF/container.xml`、`META-INF/com.apple.ibooks.display-options.xml`
5. 不保留 macOS `.DS_Store`、Thumbs.db 等垃圾文件

## 10. 边界与异常处理

| 情形 | 处理 |
|---|---|
| 双层 percent-encoding（`%252A`） | `unquote_recursive` 循环至稳定 |
| 孤儿文件（zip 有 / mapping 无） | 保留原混淆名照搬到输出，日志列出 |
| 重复 item id | 信第一个，日志报警 |
| mapping 命中但 zip 里没有该文件 | 日志报警（不应发生） |
| xhtml 解析失败 | 退化为正则替换；日志记录 |
| CSS 中 url 是 data URI | 跳过（`data:` 开头） |
| 纯 fragment 引用 `href="#xxx"` | 不动 |
| OPF 不在标准位置（不是 OEBPS/content.opf） | 从 `META-INF/container.xml` 的 rootfile 取真实路径 |
| `<dc:identifier id="BookId">` 已经存在 | 保留原值，不覆盖 |
| 输入卷有 7 卷模板没定义的 class | 不感知、不处理（CSS 不动） |
| item id 不含扩展名 | 按 media-type 推断扩展名（`image/jpeg`→`.jpg` 等）补齐 |
| ElementTree 取不到 `xlink:href` | 处理 xhtml 前注册命名空间 `xlink=http://www.w3.org/1999/xlink` |

## 11. 验证清单

每卷处理完后，脚本对输出 epub 跑下列检查并打印一行汇总：

1. ✅/❌ `mimetype` 是第一项 + 内容正确 + 未压缩
2. ✅/❌ `META-INF/container.xml` 存在且能解析出 OPF 路径
3. ✅/❌ OPF 能解析、`<metadata>` 必含 `dc:title` / `dc:identifier` / `dc:language`
4. ✅/❌ manifest 所有 item 的 href，在 zip 里能找到对应文件
5. ✅/❌ 所有 xhtml 里的 `link/script/img/a` 引用解析后，目标在 zip 里存在
6. ✅/❌ OPF/CSS/xhtml/ncx 里没有 `%2A` `%3A` `%7C` `%3F` 残留
7. ✅/❌ zip 里没有 `*` `:` `|` `?` 字面字符在文件名中
8. ℹ️ 孤儿文件计数

任一 ❌ 视为该卷失败，但**不阻塞**其它卷继续处理。最终输出汇总表格。

## 12. 不变量

- 输入卷的正文 xhtml 内容**完全不动**（只动 head 里的 link/script 引用、body 里的 img/a href 引用）
- 输入卷的 css 规则集**完全不动**（只动 url() 里的值）
- 输入卷的图片/字体二进制**完全不动**（只改文件名）
- 输入卷的 OPF metadata 默认**保留**，仅按第 8 节表格补齐缺项 + 删除多看/掌阅 ID 字段

## 13. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| OPF item id 与某真实文件名碰撞 | 极低 | 输出 zip 内容覆盖 | 写盘前检查 mapping 值的唯一性 |
| 11-15 卷中 xhtml 内联了 percent-encoded URI 但 OPF 没有对应 item | 低 | 残留乱码引用 | 验证清单第 6 项捕获 |
| `xml.etree` 处理命名空间生成的 OPF 阅读器不识别 | 中 | 元数据丢失 | 测试 1 卷后人工 diff 输入输出 OPF 头部 |
| Sigil 1.9.30 对 EPUB3 + scripted 仍报警 | 中 | 用户体验下降 | 警告级 issue 不阻塞使用 |
| 用户的 unlocked 目录里 epub 已被进一步修改 | 低 | 行为不可预期 | 处理前打印源文件大小 & MD5 |

## 14. 产物清单

- `epub_clean.py` —— 处理脚本（放在 `unlocked/clean/` 同级或临时目录）
- `unlocked/clean/[三河ごーすと].义妹生活.{11..15}.[日翻].clean.epub` —— 输出
- 终端输出：每卷一行验证汇总

## 15. 跑法

脚本写到 `/tmp/epub_clean.py`，执行：

```bash
python3 /tmp/epub_clean.py
```

脚本内硬编码以下路径常量：
- `SRC_DIR = "/Users/liuzhuo/Downloads/义妹生活/unlocked"`
- `DST_DIR = "/Users/liuzhuo/Downloads/义妹生活/unlocked/clean"`
- `VOLS = [11, 12, 13, 14, 15]`

一次性工具，不为复用设计、不接受 CLI 参数。

---

**本设计文档完成；下一步：调用 writing-plans skill 生成实施计划。**
