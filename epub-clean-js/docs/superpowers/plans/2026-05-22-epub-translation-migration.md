# 义妹生活 09 卷 EPUB 译文迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 SRC（`义妹生活 - 09台简粗糙排版.epub`）的台版译文 + DST（`[日翻].09.epub`）的 11 条注释/插图/附章，按 REF07（`[台简].07.epub`）的 STERA 排版骨架，重新组装为新文件 `[三河ごーすと].义妹生活.09.[台简].epub`。

**Architecture:** 方案 A（07-STERA 模板拷贝）。Python 脚本流水线：解包 → 抽取段落/注释 → DP 对齐 → 启发式定位注释 → 清洗到 STERA 格式 → Jinja2 渲染 → 装配 EPUB → epubcheck 验证 + 阅读器走查。核心算法（对齐、定位、清洗）写 pytest 单元测试；模板渲染、IO、装配由集成测试（单章试跑）覆盖。

**Tech Stack:** Python 3.14、lxml（XHTML 解析）、Jinja2（模板渲染）、rapidfuzz（相似度计算）、pytest（测试）、stdlib zipfile（EPUB 装包）、epubcheck（合法性校验，已装）。

**Spec 参考：** `docs/superpowers/specs/2026-05-22-epub-translation-migration-design.md`

---

## Phase 0：环境与脚手架

### Task 1: 项目目录与 Python 虚拟环境

**Files:**
- Create: `scripts/` 目录
- Create: `scripts/templates/` 目录
- Create: `tests/` 目录
- Create: `tests/fixtures/` 目录
- Create: `.venv/` 虚拟环境
- Create: `requirements.txt`
- Create: `.gitignore`

- [ ] **Step 1: 创建目录结构**

```bash
cd "/Users/liuzhuo/Downloads/义妹生活"
mkdir -p scripts/templates tests/fixtures
```

- [ ] **Step 2: 写入 requirements.txt**

`requirements.txt`：
```
lxml>=5.0
Jinja2>=3.1
rapidfuzz>=3.0
pytest>=8.0
```

- [ ] **Step 3: 写入 .gitignore**

`.gitignore`：
```
.venv/
__pycache__/
*.pyc
.pytest_cache/
.superpowers/
/tmp_epub/
```

- [ ] **Step 4: 创建虚拟环境并安装依赖**

```bash
cd "/Users/liuzhuo/Downloads/义妹生活"
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Expected: 4 个包成功安装，无 error。

- [ ] **Step 5: 验证依赖可用**

```bash
.venv/bin/python -c "import lxml.etree, jinja2, rapidfuzz, pytest; print('OK')"
```

Expected: 输出 `OK`。

### Task 2: 拷贝 REF07 静态资源到工作区

**Files:**
- Create: `tmp_epub/ref07_unpacked/` （REF07 解包后副本，供脚本读取模板）
- Create: `tmp_epub/dst09_unpacked/` （DST 解包后副本）
- Create: `tmp_epub/src09_unpacked/` （SRC 解包后副本）

- [ ] **Step 1: 创建临时解包目录**

```bash
cd "/Users/liuzhuo/Downloads/义妹生活"
mkdir -p tmp_epub/{ref07_unpacked,dst09_unpacked,src09_unpacked}
```

- [ ] **Step 2: 解包三个 EPUB**

```bash
cd "/Users/liuzhuo/Downloads/义妹生活"
unzip -q -o "[三河ごーすと].义妹生活.07.[台简].epub" -d tmp_epub/ref07_unpacked/
unzip -q -o "[三河ごーすと].义妹生活.09.[日翻].epub" -d tmp_epub/dst09_unpacked/
unzip -q -o "义妹生活 - 09台简粗糙排版.epub" -d tmp_epub/src09_unpacked/
```

Expected: 三个目录里都有内容，no error。

- [ ] **Step 3: 验证关键文件存在**

```bash
test -f tmp_epub/ref07_unpacked/OEBPS/Styles/necessary.css && echo REF07_CSS_OK
test -f tmp_epub/dst09_unpacked/Text/chapter0003.xhtml && echo DST_CH3_OK
test -f tmp_epub/src09_unpacked/OEBPS/Text/chapter3.xhtml && echo SRC_CH3_OK
```

Expected: 输出 `REF07_CSS_OK`、`DST_CH3_OK`、`SRC_CH3_OK` 三行。

---

## Phase 1：IO 与数据抽取

### Task 3: EPUB 打包工具（epub_io.py）

**Files:**
- Create: `scripts/epub_io.py`
- Test: `tests/test_epub_io.py`

EPUB 装包要求：`mimetype` 必须是 zip 第一个 entry、用 STORED（无压缩）；其余文件用 DEFLATED。

- [ ] **Step 1: 写失败测试**

`tests/test_epub_io.py`：
```python
import zipfile
from pathlib import Path
from scripts.epub_io import pack_epub


def test_pack_epub_mimetype_first_and_stored(tmp_path: Path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "mimetype").write_text("application/epub+zip")
    (src / "META-INF").mkdir()
    (src / "META-INF" / "container.xml").write_text("<container/>")

    out = tmp_path / "test.epub"
    pack_epub(src, out)

    with zipfile.ZipFile(out) as zf:
        names = zf.namelist()
        assert names[0] == "mimetype", "mimetype 必须是第一个 entry"
        mimetype_info = zf.getinfo("mimetype")
        assert mimetype_info.compress_type == zipfile.ZIP_STORED, "mimetype 必须无压缩"
        container_info = zf.getinfo("META-INF/container.xml")
        assert container_info.compress_type == zipfile.ZIP_DEFLATED
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd "/Users/liuzhuo/Downloads/义妹生活"
.venv/bin/python -m pytest tests/test_epub_io.py -v
```

Expected: FAIL，`ModuleNotFoundError: No module named 'scripts.epub_io'`。

- [ ] **Step 3: 写实现**

`scripts/epub_io.py`：
```python
import zipfile
from pathlib import Path


def pack_epub(src_dir: Path, out_path: Path) -> None:
    """打包目录为 EPUB。mimetype 必须最先写入且无压缩。"""
    src_dir = Path(src_dir)
    mimetype = src_dir / "mimetype"
    if not mimetype.exists():
        raise FileNotFoundError(f"mimetype not found in {src_dir}")

    with zipfile.ZipFile(out_path, "w") as zf:
        # mimetype 必须最先、STORED 无压缩
        zf.write(mimetype, "mimetype", compress_type=zipfile.ZIP_STORED)
        # 其他文件
        for path in sorted(src_dir.rglob("*")):
            if path.is_file() and path != mimetype:
                rel = path.relative_to(src_dir).as_posix()
                zf.write(path, rel, compress_type=zipfile.ZIP_DEFLATED)
```

Add empty `scripts/__init__.py` and `tests/__init__.py`:
```bash
touch scripts/__init__.py tests/__init__.py
```

- [ ] **Step 4: 运行测试确认通过**

```bash
.venv/bin/python -m pytest tests/test_epub_io.py -v
```

Expected: PASS。

### Task 4: 段落抽取（paragraph_extractor.py）

**Files:**
- Create: `scripts/paragraph_extractor.py`
- Test: `tests/test_paragraph_extractor.py`
- Test fixture: `tests/fixtures/sample_src_chapter.xhtml`
- Test fixture: `tests/fixtures/sample_dst_chapter.xhtml`

抽取规则：返回 `list[str]` —— 每个 `<p>` 的纯文本（去前后空白、去 ruby tag、保留 sup 标识但不展开）。

- [ ] **Step 1: 准备测试 fixture**

`tests/fixtures/sample_src_chapter.xhtml`（SRC 风格，无 ruby、无 sup）：
```xml
<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body><section>
  <h1>6 月 12 日</h1>
  <hr/>
  <p>第一段文字。</p>
  <p>第二段文字。</p>
  <p></p>
  <p>第三段文字。</p>
</section></body></html>
```

`tests/fixtures/sample_dst_chapter.xhtml`（DST 风格，含 ruby + calibre 类）：
```xml
<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" class="calibre">
<body class="calibre1">
  <h3 class="calibre25">6月12日（星期六）</h3>
  <p class="calibre22">含 <ruby class="calibre">小园<rt class="calibre26">こぞの</rt></ruby> 注音的段落。</p>
  <p class="calibre22">第二段。</p>
</body></html>
```

- [ ] **Step 2: 写失败测试**

`tests/test_paragraph_extractor.py`：
```python
from pathlib import Path
from scripts.paragraph_extractor import extract_paragraphs

FIXTURES = Path(__file__).parent / "fixtures"


def test_extract_src_paragraphs():
    paras = extract_paragraphs(FIXTURES / "sample_src_chapter.xhtml")
    assert paras == ["第一段文字。", "第二段文字。", "第三段文字。"]


def test_extract_dst_strips_ruby_and_classes():
    paras = extract_paragraphs(FIXTURES / "sample_dst_chapter.xhtml")
    assert paras == ["含 小园 注音的段落。", "第二段。"]
```

- [ ] **Step 3: 运行测试确认失败**

```bash
.venv/bin/python -m pytest tests/test_paragraph_extractor.py -v
```

Expected: FAIL，模块不存在。

- [ ] **Step 4: 写实现**

`scripts/paragraph_extractor.py`：
```python
from pathlib import Path
from lxml import etree

NSMAP = {"x": "http://www.w3.org/1999/xhtml"}


def extract_paragraphs(xhtml_path: Path) -> list[str]:
    """从 XHTML 抽取段落纯文本列表。

    规则：
    - 仅取 <p> 元素，按文档顺序
    - 去前后空白
    - 跳过空段落
    - ruby/rt 标签：保留 ruby 文本，丢弃 rt 注音
    - sup 标签：暂时一并保留文本（注释定位时再用）
    """
    tree = etree.parse(str(xhtml_path))
    paragraphs: list[str] = []
    for p in tree.iter("{http://www.w3.org/1999/xhtml}p"):
        # 丢掉所有 rt 子节点的文本
        for rt in p.iter("{http://www.w3.org/1999/xhtml}rt"):
            rt.getparent().remove(rt)
        text = "".join(p.itertext()).strip()
        if text:
            paragraphs.append(text)
    return paragraphs
```

- [ ] **Step 5: 运行测试确认通过**

```bash
.venv/bin/python -m pytest tests/test_paragraph_extractor.py -v
```

Expected: 2 个测试 PASS。

- [ ] **Step 6: 实际跑一遍真实 SRC 段数验证**

```bash
.venv/bin/python -c "
from scripts.paragraph_extractor import extract_paragraphs
from pathlib import Path
paras = extract_paragraphs(Path('tmp_epub/src09_unpacked/OEBPS/Text/chapter3.xhtml'))
print(f'SRC chapter3 段数: {len(paras)}')
print(f'第 1 段: {paras[0][:50]}')
print(f'末 1 段: {paras[-1][:50]}')
"
```

Expected: 输出合理段数（> 100），首末段是中文。

### Task 5: 注释抽取（footnote_extractor.py）

**Files:**
- Create: `scripts/footnote_extractor.py`
- Test: `tests/test_footnote_extractor.py`
- Test fixture: `tests/fixtures/sample_dst_with_footnote.xhtml`

抽取 DST 注释：解析 `<sup><a class="duokan-footnote">` + `<aside epub:type="footnote">` 组合，返回 `list[Footnote]`，每条含定位上下文。

- [ ] **Step 1: 写 Footnote dataclass + 测试 fixture**

`tests/fixtures/sample_dst_with_footnote.xhtml`：
```xml
<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <p class="calibre22">前面文字。</p>
  <note class="calibre27"><p class="calibre22">这是注解前面的话<sup class="calibre28"><a class="duokan-footnote" epub:type="noteref" href="#note001" id="note_ref001"><img alt="note" class="zhangyue-footnote" src="../Images/note.webp" zy-footnote="注：这是注释内容"/></a></sup>注解后面的话。</p>
  <aside epub:type="footnote" id="note001" class="pcalibre1 calibre29">
    <a href="#note_ref001" class="calibre12">
    <ol class="duokan-footnote-content">
      <li class="duokan-footnote-item" value="001"><p class="calibre30">注：这是注释内容</p></li>
    </ol>
    </a>
  </aside></note>
  <p class="calibre22">后面文字。</p>
</body></html>
```

- [ ] **Step 2: 写失败测试**

`tests/test_footnote_extractor.py`：
```python
from pathlib import Path
from scripts.footnote_extractor import extract_footnotes, Footnote

FIXTURES = Path(__file__).parent / "fixtures"


def test_extract_single_footnote():
    notes = extract_footnotes(FIXTURES / "sample_dst_with_footnote.xhtml")
    assert len(notes) == 1
    fn = notes[0]
    assert isinstance(fn, Footnote)
    assert fn.original_id == "note001"
    assert fn.text == "注：这是注释内容"
    assert fn.img_filename == "note.webp"
    assert fn.host_para_text == "这是注解前面的话注解后面的话。"
    assert fn.host_para_index == 1  # 第二个 p（index 1）
    assert fn.sup_offset == len("这是注解前面的话")  # sup 在"前面的话"后
    assert fn.before_ctx.endswith("的话")
    assert fn.after_ctx.startswith("注解后")
```

- [ ] **Step 3: 运行测试确认失败**

```bash
.venv/bin/python -m pytest tests/test_footnote_extractor.py -v
```

Expected: FAIL。

- [ ] **Step 4: 写实现**

`scripts/footnote_extractor.py`：
```python
from dataclasses import dataclass
from pathlib import Path
from lxml import etree

NS = "{http://www.w3.org/1999/xhtml}"


@dataclass
class Footnote:
    original_id: str           # 原 DST id，如 "note001"
    text: str                  # 注释正文文本
    img_filename: str          # "note.webp" 或 "note1.webp"
    host_para_text: str        # 注释所在段落的纯文本（已去 ruby）
    host_para_index: int       # 在 DST 该章节 <p> 列表中的索引（0-based）
    sup_offset: int            # sup 在 host_para_text 中的字符偏移
    before_ctx: str            # sup 前 ±30 字
    after_ctx: str             # sup 后 ±30 字


def extract_footnotes(xhtml_path: Path) -> list[Footnote]:
    """从 DST XHTML 抽取所有注释，含定位上下文。"""
    tree = etree.parse(str(xhtml_path))
    root = tree.getroot()

    # 1. 编号所有段落（用于算 host_para_index）
    all_paras = list(root.iter(f"{NS}p"))
    para_index = {p: i for i, p in enumerate(all_paras)}

    notes: list[Footnote] = []
    for sup in root.iter(f"{NS}sup"):
        a = sup.find(f"{NS}a")
        if a is None or "duokan-footnote" not in (a.get("class") or ""):
            continue
        # img 含 zy-footnote 属性
        img = a.find(f"{NS}img")
        if img is None:
            continue
        zy = img.get("zy-footnote") or ""
        img_src = img.get("src", "")
        img_filename = Path(img_src).name  # "note.webp" / "note1.webp"

        # 找 sup 所在 <p>
        host_p = sup
        while host_p is not None and host_p.tag != f"{NS}p":
            host_p = host_p.getparent()
        if host_p is None or host_p not in para_index:
            continue

        # 算 sup 在段落纯文本中的偏移
        host_para_text, sup_offset = _text_and_sup_offset(host_p, sup)

        before_ctx = host_para_text[max(0, sup_offset - 30):sup_offset]
        after_ctx = host_para_text[sup_offset:sup_offset + 30]

        # 找对应 aside id
        href = a.get("href", "")
        note_id = href.split("#")[-1] if "#" in href else ""

        notes.append(Footnote(
            original_id=note_id,
            text=zy,
            img_filename=img_filename,
            host_para_text=host_para_text,
            host_para_index=para_index[host_p],
            sup_offset=sup_offset,
            before_ctx=before_ctx,
            after_ctx=after_ctx,
        ))
    return notes


def _text_and_sup_offset(p_elem, sup_elem) -> tuple[str, int]:
    """返回 (段落纯文本, sup 在文本中的字符偏移)。"""
    # 用 walk 收集，遇到 sup 时记录当前 offset
    parts: list[str] = []
    offset = -1
    for event, elem in etree.iterwalk(p_elem, events=("start", "end")):
        if event == "start":
            if elem is sup_elem:
                offset = sum(len(s) for s in parts)
            elif elem.tag == f"{NS}rt":
                # 跳过 rt 内容
                pass
            elif elem.text and elem is not p_elem.getparent():
                # 只在 start 时拿 text（仅元素本身的文本）
                if elem.tag != f"{NS}rt":
                    parts.append(elem.text or "")
        elif event == "end":
            if elem.tail and elem.tag != f"{NS}rt":
                parts.append(elem.tail or "")
    return "".join(parts), max(offset, 0)
```

- [ ] **Step 5: 运行测试确认通过**

```bash
.venv/bin/python -m pytest tests/test_footnote_extractor.py -v
```

Expected: PASS。如有偏移计算偏差，调试 `_text_and_sup_offset` 函数。

- [ ] **Step 6: 真实 DST 数据验证**

```bash
.venv/bin/python -c "
from scripts.footnote_extractor import extract_footnotes
from pathlib import Path
notes = extract_footnotes(Path('tmp_epub/dst09_unpacked/Text/chapter0003.xhtml'))
print(f'chapter0003 注释数: {len(notes)}')
for n in notes:
    print(f'  {n.original_id}: {n.text[:30]} | host_para_idx={n.host_para_index} | offset={n.sup_offset}')
"
```

Expected: 输出 3 条注释（chapter0003 是注释最多的章节）。

### Task 5b: 章内插图抽取（inline_image_extractor.py）

**Files:**
- Create: `scripts/inline_image_extractor.py`
- Test: `tests/test_inline_image_extractor.py`

DST 章节正文里有 10 张"内联插图"（p039/p062/p137/p177/p196/p209/p242/p267/p304/p318.webp），HTML 形如：
```html
<p class="calibre22">…前段落…</p>
<div class="illus" id="calibre_pb_0">
  <img alt="p039" src="../Images/p039.webp" zy-enlarge-src="self" class="calibre19"/>
</div>
<p class="calibre22">…后段落…</p>
```

这些图片需要保留并迁移到 SRC 译文的对应段落后，并升级为 STERA 格式 `<div class="illus duokan-image-single">` 以支持点击放大。

- [ ] **Step 1: 写失败测试**

`tests/test_inline_image_extractor.py`：
```python
from pathlib import Path
from scripts.inline_image_extractor import extract_inline_images, InlineImage

FIXTURES = Path(__file__).parent / "fixtures"


def _make_fixture_with_inline_img(tmp_path):
    p = tmp_path / "ch.xhtml"
    p.write_text("""<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body>
  <p class="calibre22">第一段。</p>
  <p class="calibre22">第二段。</p>
  <div class="illus" id="calibre_pb_0">
    <img alt="p039" src="../Images/p039.webp" zy-enlarge-src="self" class="calibre19"/>
  </div>
  <p class="calibre22">第三段。</p>
</body></html>""", encoding="utf-8")
    return p


def test_extract_inline_image_after_para_2(tmp_path):
    p = _make_fixture_with_inline_img(tmp_path)
    images = extract_inline_images(p)
    assert len(images) == 1
    img = images[0]
    assert isinstance(img, InlineImage)
    assert img.alt == "p039"
    assert img.src_filename == "p039.webp"
    # 插图紧跟第 2 段（index 1），所以 after_para_index = 1
    assert img.after_para_index == 1
    # 输出应是 STERA 格式
    assert 'class="illus duokan-image-single"' in img.stera_html
    assert 'zy-enlarge-src="self"' in img.stera_html
    assert 'src="../Images/p039.webp"' in img.stera_html
    assert 'calibre' not in img.stera_html
```

- [ ] **Step 2: 运行测试确认失败**

```bash
.venv/bin/python -m pytest tests/test_inline_image_extractor.py -v
```

Expected: FAIL。

- [ ] **Step 3: 写实现**

`scripts/inline_image_extractor.py`：
```python
from dataclasses import dataclass
from pathlib import Path
from lxml import etree

NS = "{http://www.w3.org/1999/xhtml}"


@dataclass
class InlineImage:
    alt: str
    src_filename: str         # "p039.webp"
    after_para_index: int     # 紧跟哪段（0-based 在合并后的 <p> 列表中的索引）
    stera_html: str           # STERA 格式 <div class="illus duokan-image-single">


def extract_inline_images(xhtml_path: Path) -> list[InlineImage]:
    """从 DST XHTML 抽取章内插图 div（不含 cover/kuchie，只看 div class 含 illus 但非 kuchie）。

    返回每张图的 (alt, src_filename, after_para_index, stera_html)。
    after_para_index 是文档顺序中插图之前最近的 <p> 的索引。
    """
    tree = etree.parse(str(xhtml_path))
    root = tree.getroot()

    images: list[InlineImage] = []
    para_count = 0
    # 顺序遍历整个 body 树（仅顶层子节点）
    body = root.find(f"{NS}body")
    if body is None:
        return images

    for elem in body.iter():
        if elem.tag == f"{NS}p":
            para_count += 1
        elif elem.tag == f"{NS}div" and "illus" in (elem.get("class") or ""):
            img = elem.find(f"{NS}img")
            if img is None:
                continue
            src = img.get("src", "")
            src_filename = Path(src).name
            alt = img.get("alt", "")
            # 跳过 kuchie 类（kuchie 在 illus000N.xhtml 章节，不该在内联章节出现）
            if "kuchie" in src_filename:
                continue
            stera_html = (
                f'<div class="illus duokan-image-single">'
                f'<img alt="{alt}" src="../Images/{src_filename}" '
                f'zy-enlarge-src="self"/>'
                f'</div>'
            )
            images.append(InlineImage(
                alt=alt, src_filename=src_filename,
                after_para_index=para_count - 1,  # 紧跟前面那段
                stera_html=stera_html,
            ))
    return images
```

- [ ] **Step 4: 运行测试确认通过**

```bash
.venv/bin/python -m pytest tests/test_inline_image_extractor.py -v
```

Expected: PASS。

- [ ] **Step 5: 真实 DST 数据验证**

```bash
.venv/bin/python -c "
from scripts.inline_image_extractor import extract_inline_images
from pathlib import Path
imgs = extract_inline_images(Path('tmp_epub/dst09_unpacked/Text/chapter0001_split_000.xhtml'))
print(f'chapter0001_split_000 内联插图数: {len(imgs)}')
for img in imgs:
    print(f'  {img.src_filename} after_para_index={img.after_para_index}')
"
```

Expected: 输出 1 张图（p039.webp）。

---

## Phase 2：核心算法

### Task 6: 段落对齐（aligner.py）

**Files:**
- Create: `scripts/aligner.py`
- Test: `tests/test_aligner.py`

算法：Needleman-Wunsch DP，相似度用 rapidfuzz.fuzz.ratio。返回 `Alignment` 含每对 `(src_idx | None, dst_idx | None)`。

- [ ] **Step 1: 写失败测试**

`tests/test_aligner.py`：
```python
from scripts.aligner import align_paragraphs


def test_align_equal_length_perfect_match():
    src = ["第一段", "第二段", "第三段"]
    dst = ["第一段", "第二段", "第三段"]
    pairs = align_paragraphs(src, dst)
    assert pairs == [(0, 0), (1, 1), (2, 2)]


def test_align_equal_length_paraphrased():
    # 同义不同译
    src = ["拖着大行李箱的老爸", "亚季子小姐说", "再见"]
    dst = ["拖着大号行李箱的老爸", "亚纪子阿姨说", "再见"]
    pairs = align_paragraphs(src, dst)
    assert pairs == [(0, 0), (1, 1), (2, 2)]


def test_align_dst_extra_paragraph():
    # DST 多一段（如 split 截断造成）
    src = ["一", "二", "三"]
    dst = ["一", "二A", "二B", "三"]
    pairs = align_paragraphs(src, dst)
    # 期望 dst[1]+dst[2] 都对到 src[1]，或一个对一个对 None
    assert pairs[0] == (0, 0)
    assert pairs[-1] == (2, 3)


def test_align_src_extra_paragraph():
    # SRC 多一段
    src = ["一", "二", "三", "四"]
    dst = ["一", "二", "四"]
    pairs = align_paragraphs(src, dst)
    assert pairs[0] == (0, 0)
    assert pairs[-1] == (3, 2)
```

- [ ] **Step 2: 运行测试确认失败**

```bash
.venv/bin/python -m pytest tests/test_aligner.py -v
```

Expected: FAIL。

- [ ] **Step 3: 写实现**

`scripts/aligner.py`：
```python
from rapidfuzz import fuzz

GAP_PENALTY = 60.0  # 0-100 量级；越大越倾向不留 gap


def align_paragraphs(src: list[str], dst: list[str]) -> list[tuple[int | None, int | None]]:
    """Needleman-Wunsch 全局对齐。返回 [(src_idx | None, dst_idx | None), ...]。

    相似度用 rapidfuzz.fuzz.ratio（0-100），代价 = 100 - similarity。
    Gap 代价固定为 GAP_PENALTY。
    """
    n, m = len(src), len(dst)
    # dp[i][j] = 对齐 src[:i] 与 dst[:j] 的最小代价
    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    back = [[(0, 0)] * (m + 1) for _ in range(n + 1)]

    for i in range(1, n + 1):
        dp[i][0] = dp[i - 1][0] + GAP_PENALTY
        back[i][0] = (i - 1, 0)
    for j in range(1, m + 1):
        dp[0][j] = dp[0][j - 1] + GAP_PENALTY
        back[0][j] = (0, j - 1)

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            match_cost = dp[i - 1][j - 1] + (100.0 - fuzz.ratio(src[i - 1], dst[j - 1]))
            gap_src = dp[i - 1][j] + GAP_PENALTY
            gap_dst = dp[i][j - 1] + GAP_PENALTY
            best = min(match_cost, gap_src, gap_dst)
            dp[i][j] = best
            if best == match_cost:
                back[i][j] = (i - 1, j - 1)
            elif best == gap_src:
                back[i][j] = (i - 1, j)
            else:
                back[i][j] = (i, j - 1)

    # 回溯
    pairs: list[tuple[int | None, int | None]] = []
    i, j = n, m
    while i > 0 or j > 0:
        pi, pj = back[i][j]
        if pi == i - 1 and pj == j - 1:
            pairs.append((i - 1, j - 1))
        elif pi == i - 1:
            pairs.append((i - 1, None))
        else:
            pairs.append((None, j - 1))
        i, j = pi, pj
    pairs.reverse()
    return pairs
```

- [ ] **Step 4: 运行测试确认通过**

```bash
.venv/bin/python -m pytest tests/test_aligner.py -v
```

Expected: 4 个 PASS。如有失败，调 `GAP_PENALTY`。

- [ ] **Step 5: 实际 chapter3 对齐测试**

```bash
.venv/bin/python -c "
from scripts.paragraph_extractor import extract_paragraphs
from scripts.aligner import align_paragraphs
from pathlib import Path

src = extract_paragraphs(Path('tmp_epub/src09_unpacked/OEBPS/Text/chapter3.xhtml'))
dst = extract_paragraphs(Path('tmp_epub/dst09_unpacked/Text/chapter0003.xhtml'))
print(f'SRC 段数: {len(src)}, DST 段数: {len(dst)}')

pairs = align_paragraphs(src, dst)
matched = sum(1 for s, d in pairs if s is not None and d is not None)
print(f'对齐对数: {len(pairs)}, 双方有值: {matched}')

# 打印前 5 对
for s, d in pairs[:5]:
    src_txt = src[s][:30] if s is not None else '<gap>'
    dst_txt = dst[d][:30] if d is not None else '<gap>'
    print(f'  S[{s}]={src_txt!r:35} | D[{d}]={dst_txt!r}')
"
```

Expected: 段数接近、matched ≥ 90% 的 pairs 数量。

### Task 7: 注释定位（footnote_relocator.py）

**Files:**
- Create: `scripts/footnote_relocator.py`
- Test: `tests/test_footnote_relocator.py`

算法：用 DST 的 (host_para_index, before_ctx, after_ctx) 在 SRC 段落里找匹配位置。返回每条注释的 `(src_para_idx, src_char_offset, confidence)`。

- [ ] **Step 1: 写失败测试**

`tests/test_footnote_relocator.py`：
```python
from scripts.footnote_relocator import relocate_footnote
from scripts.footnote_extractor import Footnote


def make_footnote(host_idx, before, after, text="注：示例"):
    return Footnote(
        original_id="note001", text=text, img_filename="note.webp",
        host_para_text=before + after,
        host_para_index=host_idx, sup_offset=len(before),
        before_ctx=before, after_ctx=after,
    )


def test_relocate_perfect_match():
    src = ["开头", "一年级时候的笔记本，阅读教科书", "结尾"]
    align_pairs = [(0, 0), (1, 1), (2, 2)]
    fn = make_footnote(
        host_idx=1,
        before="一年级时候的笔记本，阅读教科书",
        after="解答例题"
    )
    result = relocate_footnote(fn, src, align_pairs)
    assert result.src_para_idx == 1
    assert result.confidence == "HIGH"
    # offset 应当落在"教科书"后
    assert result.src_char_offset == len("一年级时候的笔记本，阅读教科书")


def test_relocate_fuzzy_match():
    # SRC 译文略不同
    src = ["开头", "一年级时的笔记，看教科书", "结尾"]
    align_pairs = [(0, 0), (1, 1), (2, 2)]
    fn = make_footnote(
        host_idx=1,
        before="一年级时候的笔记本，阅读教科书",
        after="解答例题"
    )
    result = relocate_footnote(fn, src, align_pairs)
    assert result.src_para_idx == 1
    assert result.confidence in ("MEDIUM", "HIGH")


def test_relocate_fallback_to_para_end():
    # 完全找不到关键词，落到段末
    src = ["开头", "完全不相关的另一段", "结尾"]
    align_pairs = [(0, 0), (1, 1), (2, 2)]
    fn = make_footnote(
        host_idx=1,
        before="一年级时候的笔记本",
        after="解答例题"
    )
    result = relocate_footnote(fn, src, align_pairs)
    assert result.src_para_idx == 1
    assert result.confidence == "LOW"
    assert result.src_char_offset == len(src[1])  # 段末
```

- [ ] **Step 2: 运行测试确认失败**

```bash
.venv/bin/python -m pytest tests/test_footnote_relocator.py -v
```

Expected: FAIL。

- [ ] **Step 3: 写实现**

`scripts/footnote_relocator.py`：
```python
from dataclasses import dataclass
from rapidfuzz import fuzz
from scripts.footnote_extractor import Footnote


@dataclass
class Relocation:
    src_para_idx: int
    src_char_offset: int
    confidence: str  # "HIGH" / "MEDIUM" / "LOW"
    score: float
    debug_info: str


def relocate_footnote(
    fn: Footnote,
    src_paragraphs: list[str],
    align_pairs: list[tuple[int | None, int | None]],
) -> Relocation:
    """把 DST 注释定位到 SRC 段落里。

    1. 通过 align_pairs 找到 DST host_para_index 对齐到的 SRC 段
    2. 在 SRC 段中用 before_ctx + after_ctx 做 fuzzy 匹配找插入点
    3. 阈值：score ≥ 80 → HIGH，60-80 → MEDIUM，< 60 → LOW（落段末）
    """
    src_idx = _find_src_idx_for_dst(fn.host_para_index, align_pairs, len(src_paragraphs))
    if src_idx is None:
        src_idx = 0  # fallback：第一段

    src_text = src_paragraphs[src_idx]

    # 候选定位字符串：拼接 before + after
    needle = (fn.before_ctx + fn.after_ctx).strip()
    if not needle:
        return Relocation(
            src_para_idx=src_idx, src_char_offset=len(src_text),
            confidence="LOW", score=0.0,
            debug_info="empty needle, fallback to para end",
        )

    # 在 src_text 中找 needle 的最佳匹配位置
    result = fuzz.partial_ratio_alignment(needle, src_text)
    score = result.score
    # alignment.dest_start = needle 在 src_text 中匹配段的起始位置
    match_start = result.dest_start
    # sup 的位置在 needle 中是 len(before_ctx)，加 match_start
    insert_offset = match_start + len(fn.before_ctx.strip())
    insert_offset = max(0, min(insert_offset, len(src_text)))

    if score >= 80:
        confidence = "HIGH"
    elif score >= 60:
        confidence = "MEDIUM"
    else:
        confidence = "LOW"
        insert_offset = len(src_text)  # 落段末

    return Relocation(
        src_para_idx=src_idx, src_char_offset=insert_offset,
        confidence=confidence, score=score,
        debug_info=f"needle={needle[:40]!r}, match_start={match_start}",
    )


def _find_src_idx_for_dst(
    dst_idx: int,
    align_pairs: list[tuple[int | None, int | None]],
    src_max: int,
) -> int | None:
    """从 align_pairs 反查 DST idx 对应的 SRC idx。"""
    for s, d in align_pairs:
        if d == dst_idx and s is not None:
            return s
    # 没对齐到，找最近的对齐对
    for s, d in align_pairs:
        if d is not None and d >= dst_idx and s is not None:
            return s
    return src_max - 1 if src_max > 0 else None
```

- [ ] **Step 4: 运行测试确认通过**

```bash
.venv/bin/python -m pytest tests/test_footnote_relocator.py -v
```

Expected: 3 个 PASS。如有需要调阈值。

### Task 8: 注释清洗到 STERA 格式（footnote_cleaner.py）

**Files:**
- Create: `scripts/footnote_cleaner.py`
- Test: `tests/test_footnote_cleaner.py`

输入：`Footnote` 对象 + 新编号 + 章节路径上下文。
输出：(sup_inline_html, aside_html) 元组。

- [ ] **Step 1: 写失败测试**

`tests/test_footnote_cleaner.py`：
```python
from scripts.footnote_cleaner import build_stera_footnote
from scripts.footnote_extractor import Footnote


def test_build_stera_footnote_basic():
    fn = Footnote(
        original_id="note005", text="注：测试", img_filename="note.webp",
        host_para_text="abc", host_para_index=0, sup_offset=1,
        before_ctx="a", after_ctx="bc",
    )
    sup_html, aside_html = build_stera_footnote(fn, new_id_number=1)

    assert 'class="duokan-footnote"' in sup_html
    assert 'epub:type="noteref"' in sup_html
    assert 'href="#note001"' in sup_html
    assert 'id="note_ref001"' in sup_html
    assert 'src="../Images/note.webp"' in sup_html
    assert 'zy-footnote="注：测试"' in sup_html

    assert 'id="note001"' in aside_html
    assert 'epub:type="footnote"' in aside_html
    assert 'href="#note_ref001"' in aside_html
    assert 'class="duokan-footnote-content"' in aside_html
    assert '<p>注：测试</p>' in aside_html
    # 必须无 calibre 类名残留
    assert 'calibre' not in sup_html
    assert 'pcalibre' not in aside_html
    assert 'calibre' not in aside_html


def test_build_stera_footnote_preserves_note1_img():
    fn = Footnote(
        original_id="note002", text="评：吐槽", img_filename="note1.webp",
        host_para_text="x", host_para_index=0, sup_offset=0,
        before_ctx="", after_ctx="x",
    )
    sup_html, _ = build_stera_footnote(fn, new_id_number=2)
    assert 'src="../Images/note1.webp"' in sup_html
```

- [ ] **Step 2: 运行测试确认失败**

```bash
.venv/bin/python -m pytest tests/test_footnote_cleaner.py -v
```

Expected: FAIL。

- [ ] **Step 3: 写实现**

`scripts/footnote_cleaner.py`：
```python
from html import escape
from scripts.footnote_extractor import Footnote


def build_stera_footnote(fn: Footnote, new_id_number: int) -> tuple[str, str]:
    """从 Footnote 对象生成 STERA 标准的 (sup_inline, aside_block) 元组。

    new_id_number 是新编号（1-based），生成 note001/note002 等 id。
    """
    new_id = f"note{new_id_number:03d}"
    ref_id = f"note_ref{new_id_number:03d}"

    sup_html = (
        f'<sup><a class="duokan-footnote" epub:type="noteref" '
        f'href="#{new_id}" id="{ref_id}">'
        f'<img alt="note" class="zhangyue-footnote" '
        f'src="../Images/{fn.img_filename}" '
        f'zy-footnote="{escape(fn.text, quote=True)}"/></a></sup>'
    )

    aside_html = (
        f'<aside epub:type="footnote" id="{new_id}">'
        f'<a href="#{ref_id}"></a>'
        f'<ol class="duokan-footnote-content">'
        f'<li class="duokan-footnote-item" id="{new_id}" value="{new_id_number:03d}">'
        f'<p>{escape(fn.text)}</p>'
        f'</li>'
        f'</ol>'
        f'</aside>'
    )

    return sup_html, aside_html
```

- [ ] **Step 4: 运行测试确认通过**

```bash
.venv/bin/python -m pytest tests/test_footnote_cleaner.py -v
```

Expected: PASS。

---

## Phase 3：渲染

### Task 9: 章节渲染（chapter_renderer.py + Jinja2 模板）

**Files:**
- Create: `scripts/templates/chapter.xhtml.j2`
- Create: `scripts/chapter_renderer.py`
- Test: `tests/test_chapter_renderer.py`

- [ ] **Step 1: 写 chapter.xhtml.j2 模板**

`scripts/templates/chapter.xhtml.j2`：模板接收 `blocks` 列表（每项是字符串），如果字符串以 `<div` 开头则不包 `<p>`（用于 inline illus），否则包在 `<p>` 里（正文段落）。

```jinja2
<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh"
      xmlns:epub="http://www.idpf.org/2007/ops">
<head>
 <title>{{ title }}</title>
 <link href="../Styles/stylesheet.css" rel="stylesheet" type="text/css"/>
 <script type="text/javascript" src="../Misc/script.js"></script>
</head>
<body>
 <h3>{{ title }}</h3>
{% for b in blocks %}
{% if b.startswith('<div') %}
 {{ b|safe }}
{% else %}
 <p>{{ b|safe }}</p>
{% endif %}
{% endfor %}
{% if footnote_asides %}
 <note>
{% for aside in footnote_asides %}
 {{ aside|safe }}
{% endfor %}
 </note>
{% endif %}
</body>
</html>
```

- [ ] **Step 2: 写失败测试**

`tests/test_chapter_renderer.py`：
```python
from scripts.chapter_renderer import render_chapter


def test_render_basic_chapter():
    html = render_chapter(
        title="6月12日（星期六）　浅村悠太",
        blocks=["第一段", "第二段"],
        footnote_asides=[],
    )
    assert "<title>6月12日" in html
    assert "<h3>6月12日（星期六）　浅村悠太</h3>" in html
    assert "<p>第一段</p>" in html
    assert "<p>第二段</p>" in html
    assert "../Styles/stylesheet.css" in html
    assert "../Misc/script.js" in html
    # 无注释时不输出 <note>
    assert "<note>" not in html


def test_render_chapter_with_inline_sup_and_asides():
    html = render_chapter(
        title="带注释章节",
        blocks=[
            '这是含 <sup><a>note</a></sup> 的段落',
            '后续段落',
        ],
        footnote_asides=['<aside id="note001">...</aside>'],
    )
    # sup 不能被转义
    assert "<sup>" in html
    # aside 不能被转义
    assert "<aside id=" in html
    # note 容器存在
    assert "<note>" in html


def test_render_chapter_with_inline_illus_div():
    """以 <div 开头的 block 不应被 <p> 包裹（用于章内插图）。"""
    html = render_chapter(
        title="章",
        blocks=[
            "段一",
            '<div class="illus duokan-image-single"><img src="../Images/p039.webp" zy-enlarge-src="self"/></div>',
            "段二",
        ],
        footnote_asides=[],
    )
    assert "<p>段一</p>" in html
    assert "<p>段二</p>" in html
    # illus div 必须不在 <p> 里（避免非法 XHTML）
    assert "<p><div" not in html
    assert '<div class="illus duokan-image-single">' in html
```

- [ ] **Step 3: 运行测试确认失败**

```bash
.venv/bin/python -m pytest tests/test_chapter_renderer.py -v
```

Expected: FAIL。

- [ ] **Step 4: 写实现**

`scripts/chapter_renderer.py`：
```python
from pathlib import Path
from jinja2 import Environment, FileSystemLoader

TEMPLATES_DIR = Path(__file__).parent / "templates"


def _get_env() -> Environment:
    return Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=False,  # 内容自己控制转义（段落含 sup HTML 不能被转义）
        trim_blocks=False,
        lstrip_blocks=False,
        keep_trailing_newline=True,
    )


def render_chapter(
    title: str,
    blocks: list[str],
    footnote_asides: list[str],
) -> str:
    """渲染单个章节 XHTML。

    blocks 是字符串列表，每项是：
    - 正常段落文本（可能含已插入的 <sup>...</sup> 内联 HTML）
    - 或以 '<div' 开头的章内插图 HTML（不应被 <p> 包裹）
    footnote_asides 是 <aside>...</aside> 字符串列表。
    """
    env = _get_env()
    template = env.get_template("chapter.xhtml.j2")
    return template.render(
        title=title,
        blocks=blocks,
        footnote_asides=footnote_asides,
    )
```

- [ ] **Step 5: 运行测试确认通过**

```bash
.venv/bin/python -m pytest tests/test_chapter_renderer.py -v
```

Expected: PASS。

### Task 10: 附章清洗（extras_cleaner.py）

**Files:**
- Create: `scripts/extras_cleaner.py`
- Test: `tests/test_extras_cleaner.py`

处理 special0001-0003.xhtml、message.xhtml、summary.xhtml、talk.xhtml、contents.xhtml、pre.xhtml、title.xhtml、cover.xhtml、TOC.xhtml、navigation-documents.xhtml、illus0001-0004.xhtml。

策略：
- `cover.xhtml` → **完全重建**为 REF07 cover 模板（`<div class="cover duokan-image-single"><img zy-enlarge-src="self"/></div>`），实现点击放大 + 全屏
- `illus0001-0004.xhtml` → **完全重建**为 REF07 illus 模板（`<div class="kuchie duokan-image-single"><img zy-enlarge-src="self"/></div>`），用 DST 的 kuchie-001~005.webp 图片
- `title/TOC/pre/navigation-documents` → 用 REF07 同名模板替换
- `message/summary/talk/contents/special0001-3` → 保留 DST 原日翻文本，仅剥 calibreNN 类，注释结构原位升级
- `summary.xhtml` 特例：内容用 SRC description

- [ ] **Step 1: 写失败测试**

`tests/test_extras_cleaner.py`：
```python
from scripts.extras_cleaner import (
    strip_calibre_classes, build_cover_xhtml, build_illus_xhtml,
)


def test_strip_calibre_classes_simple():
    html = '<p class="calibre22">test</p>'
    cleaned = strip_calibre_classes(html)
    assert cleaned == '<p>test</p>'


def test_strip_calibre_keeps_other_classes():
    html = '<p class="calibre22 message">test</p>'
    cleaned = strip_calibre_classes(html)
    assert 'message' in cleaned
    assert 'calibre22' not in cleaned


def test_strip_pcalibre():
    html = '<aside class="pcalibre1 calibre29" id="n">x</aside>'
    cleaned = strip_calibre_classes(html)
    assert 'pcalibre' not in cleaned
    assert 'calibre29' not in cleaned
    assert 'id="n"' in cleaned


def test_build_cover_xhtml_has_enlarge_attrs():
    html = build_cover_xhtml(image_filename="cover.jpg")
    # 关键放大触发属性
    assert 'class="cover duokan-image-single"' in html
    assert 'zy-enlarge-src="self"' in html
    assert 'src="../Images/cover.jpg"' in html
    # 引用 script.js 让 multi-reader hook 生效
    assert '../Misc/script.js' in html
    assert '../Styles/stylesheet.css' in html
    # 必须有 epub:type ns 才能让 multi-reader 识别
    assert 'xmlns:epub' in html


def test_build_illus_xhtml_has_kuchie_class():
    html = build_illus_xhtml(image_filename="kuchie-001.webp", alt="kuchie-001")
    # 关键：kuchie 类 + duokan-image-single 才能在多看全屏放大
    assert 'class="kuchie duokan-image-single"' in html
    assert 'zy-enlarge-src="self"' in html
    assert 'src="../Images/kuchie-001.webp"' in html
    assert 'alt="kuchie-001"' in html
```

- [ ] **Step 2: 运行测试确认失败**

```bash
.venv/bin/python -m pytest tests/test_extras_cleaner.py -v
```

Expected: FAIL。

- [ ] **Step 3: 写实现**

`scripts/extras_cleaner.py`：
```python
import re

_CALIBRE_CLASS_RE = re.compile(r'\b(?:p?calibre\d*)\b')

_COVER_TEMPLATE = '''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
 <title>封面</title>
 <link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
 <script type="text/javascript" src="../Misc/script.js"></script>
</head>
<body>
 <div class="cover duokan-image-single">
  <img alt="cover" src="../Images/{image_filename}" zy-enlarge-src="self"/>
 </div>
</body>
</html>
'''

_ILLUS_TEMPLATE = '''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
 <title>插图</title>
 <link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
 <script type="text/javascript" src="../Misc/script.js"></script>
</head>
<body>
 <div class="kuchie duokan-image-single">
  <img alt="{alt}" src="../Images/{image_filename}" zy-enlarge-src="self"/>
 </div>
</body>
</html>
'''


def strip_calibre_classes(html: str) -> str:
    """剥离所有 calibreNN / pcalibre / pcalibreN 类名。保留同一 class 属性内的其他类。"""
    def _replace_class(match: re.Match) -> str:
        cls_attr = match.group(1)
        new_classes = [c for c in cls_attr.split() if not _CALIBRE_CLASS_RE.fullmatch(c)]
        if not new_classes:
            return ''  # 删整个 class 属性
        return f' class="{" ".join(new_classes)}"'

    out = re.sub(r'\s+class="([^"]*)"', _replace_class, html)
    return out


def build_cover_xhtml(image_filename: str) -> str:
    """生成封面 XHTML（duokan/zhangyue/iBooks 三端都支持点击放大+全屏）。

    关键：
    - class="cover duokan-image-single" 触发多看全屏渲染
    - zy-enlarge-src="self" 触发掌阅点击放大
    - 在 OPF spine 必须配 properties="duokan-page-fullscreen"
    - 在 OPF manifest 必须配 properties="scripted"
    """
    return _COVER_TEMPLATE.format(image_filename=image_filename)


def build_illus_xhtml(image_filename: str, alt: str = "illus") -> str:
    """生成插图 XHTML（彩页/插图，三端支持放大）。

    关键：
    - class="kuchie duokan-image-single" 触发多看 fitwindow 渲染
    - zy-enlarge-src="self" 触发掌阅点击放大
    - CSS .kuchie { display:flex; height:90vh } 让图占满屏（由 REF07 necessary.css 提供）
    - script.js 末尾对 .kuchie 检测宽高比，横图自动旋转 90°
    - 在 OPF spine 必须配 properties="duokan-page-fitwindow"
    - 在 OPF manifest 必须配 properties="scripted"
    """
    return _ILLUS_TEMPLATE.format(image_filename=image_filename, alt=alt)
```

- [ ] **Step 4: 运行测试确认通过**

```bash
.venv/bin/python -m pytest tests/test_extras_cleaner.py -v
```

Expected: 5 个 PASS。

### Task 11: 元数据生成（metadata_builder.py）

**Files:**
- Create: `scripts/templates/content.opf.j2`
- Create: `scripts/metadata_builder.py`
- Test: `tests/test_metadata_builder.py`

- [ ] **Step 1: 写 content.opf.j2 模板**

`scripts/templates/content.opf.j2`：
```jinja2
<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"
            xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>{{ title }}</dc:title>
    <dc:creator opf:role="aut">三河ごーすと</dc:creator>
    <dc:creator opf:role="ill">hiten</dc:creator>
    <dc:language>zh</dc:language>
    <dc:publisher>MF文库J</dc:publisher>
    <dc:description><![CDATA[
{{ description }}
    ]]></dc:description>
    <dc:identifier id="BookId">urn:uuid:{{ uuid }}</dc:identifier>
    <dc:subject>校园</dc:subject>
    <dc:subject>青春</dc:subject>
    <dc:subject>恋爱</dc:subject>
    <dc:subject>妹妹</dc:subject>
    <meta property="belongs-to-collection">义妹生活</meta>
    <meta property="group-position">9</meta>
    <meta name="cover" content="cover-image"/>
    <meta property="dcterms:modified">{{ modified_iso }}</meta>
  </metadata>
  <manifest>
{% for item in manifest_items %}
    <item id="{{ item.id }}" href="{{ item.href }}" media-type="{{ item.media_type }}"{% if item.properties %} properties="{{ item.properties }}"{% endif %}/>
{% endfor %}
  </manifest>
  <spine toc="ncx" page-progression-direction="ltr">
{% for s in spine_items %}
    <itemref idref="{{ s.idref }}"{% if s.linear == 'no' %} linear="no"{% endif %}{% if s.properties %} properties="{{ s.properties }}"{% endif %}/>
{% endfor %}
  </spine>
</package>
```

**注意：** spine 模板里 itemref 的 `properties` 是关键——`duokan-page-fullscreen` 让封面在多看里全屏渲染、`duokan-page-fitwindow` 让插图占满窗口；两者都配合 manifest 的 `properties="scripted"` 才能让多看/掌阅/iBooks 三端都支持点击放大。

- [ ] **Step 2: 写失败测试**

`tests/test_metadata_builder.py`：
```python
from scripts.metadata_builder import build_content_opf, ManifestItem, SpineItem


def test_build_content_opf_basic():
    items = [
        ManifestItem(id="cover-image", href="Images/cover.jpg",
                     media_type="image/jpeg", properties=None),
        ManifestItem(id="cover", href="Text/cover.xhtml",
                     media_type="application/xhtml+xml", properties="scripted"),
        ManifestItem(id="illus0001", href="Text/illus0001.xhtml",
                     media_type="application/xhtml+xml", properties="scripted"),
        ManifestItem(id="chapter0001", href="Text/chapter0001.xhtml",
                     media_type="application/xhtml+xml", properties=None),
    ]
    spine = [
        SpineItem(idref="cover", linear="yes", properties="duokan-page-fullscreen"),
        SpineItem(idref="illus0001", linear="yes", properties="duokan-page-fitwindow"),
        SpineItem(idref="chapter0001", linear="yes", properties=None),
    ]
    opf = build_content_opf(
        title="义妹生活 09",
        description="测试简介",
        uuid="12345-test-uuid",
        modified_iso="2026-05-22T00:00:00Z",
        manifest_items=items,
        spine_items=spine,
    )
    assert "<dc:title>义妹生活 09</dc:title>" in opf
    assert "测试简介" in opf
    assert "urn:uuid:12345-test-uuid" in opf
    assert 'id="cover-image"' in opf
    assert 'idref="chapter0001"' in opf
    # manifest scripted properties
    assert 'href="Text/cover.xhtml" media-type="application/xhtml+xml" properties="scripted"' in opf
    # spine duokan-page-* properties
    assert 'idref="cover"' in opf and 'properties="duokan-page-fullscreen"' in opf
    assert 'idref="illus0001"' in opf and 'properties="duokan-page-fitwindow"' in opf
    assert "三河ごーすと" in opf
```

- [ ] **Step 3: 运行测试确认失败**

```bash
.venv/bin/python -m pytest tests/test_metadata_builder.py -v
```

Expected: FAIL。

- [ ] **Step 4: 写实现**

`scripts/metadata_builder.py`：
```python
from dataclasses import dataclass
from pathlib import Path
from jinja2 import Environment, FileSystemLoader

TEMPLATES_DIR = Path(__file__).parent / "templates"


@dataclass
class ManifestItem:
    id: str
    href: str
    media_type: str
    properties: str | None  # 如 "nav" / "cover-image" / "scripted"


@dataclass
class SpineItem:
    idref: str
    linear: str          # "yes" / "no"
    properties: str | None  # 如 "duokan-page-fullscreen" / "duokan-page-fitwindow"


def build_content_opf(
    title: str,
    description: str,
    uuid: str,
    modified_iso: str,
    manifest_items: list[ManifestItem],
    spine_items: list[SpineItem],
) -> str:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=False,
        trim_blocks=False,
        lstrip_blocks=False,
    )
    template = env.get_template("content.opf.j2")
    return template.render(
        title=title, description=description.strip(),
        uuid=uuid, modified_iso=modified_iso,
        manifest_items=manifest_items, spine_items=spine_items,
    )
```

- [ ] **Step 5: 运行测试确认通过**

```bash
.venv/bin/python -m pytest tests/test_metadata_builder.py -v
```

Expected: PASS。

### Task 12: 三套 TOC 生成（toc_builder.py）

**Files:**
- Create: `scripts/templates/toc.ncx.j2`
- Create: `scripts/templates/nav.xhtml.j2`
- Create: `scripts/templates/TOC.xhtml.j2`
- Create: `scripts/toc_builder.py`
- Test: `tests/test_toc_builder.py`

- [ ] **Step 1: 写三个 TOC 模板（参考 REF07）**

`scripts/templates/toc.ncx.j2`：
```jinja2
<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="zh">
  <head>
    <meta name="dtb:uid" content="urn:uuid:{{ uuid }}"/>
    <meta name="dtb:depth" content="1"/>
  </head>
  <docTitle><text>{{ title }}</text></docTitle>
  <navMap>
{% for entry in entries %}
    <navPoint id="navPoint-{{ loop.index }}" playOrder="{{ loop.index }}">
      <navLabel><text>{{ entry.title }}</text></navLabel>
      <content src="{{ entry.href }}"/>
    </navPoint>
{% endfor %}
  </navMap>
</ncx>
```

`scripts/templates/nav.xhtml.j2`：
```jinja2
<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh">
<head>
  <title>{{ title }}</title>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <ol>
{% for entry in entries %}
      <li><a href="{{ entry.href }}">{{ entry.title }}</a></li>
{% endfor %}
    </ol>
  </nav>
</body>
</html>
```

`scripts/templates/TOC.xhtml.j2`（用户可见目录页，简化版）：
```jinja2
<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh">
<head>
  <title>目录</title>
  <link href="../Styles/stylesheet.css" rel="stylesheet" type="text/css"/>
</head>
<body>
  <div class="toc">
    <h3>目录</h3>
    <ul>
{% for entry in entries %}
      <li><a href="{{ entry.href }}">{{ entry.title }}</a></li>
{% endfor %}
    </ul>
  </div>
</body>
</html>
```

- [ ] **Step 2: 写失败测试**

`tests/test_toc_builder.py`：
```python
from scripts.toc_builder import build_toc_ncx, build_nav_xhtml, build_toc_xhtml, TocEntry


def test_build_toc_ncx():
    entries = [
        TocEntry(title="6月12日　浅村悠太", href="chapter0001.xhtml"),
        TocEntry(title="6月12日　绫濑沙季", href="chapter0002.xhtml"),
    ]
    ncx = build_toc_ncx(title="义妹生活 09", uuid="abc-123", entries=entries)
    assert "<docTitle><text>义妹生活 09</text></docTitle>" in ncx
    assert "<text>6月12日　浅村悠太</text>" in ncx
    assert 'src="chapter0001.xhtml"' in ncx


def test_build_nav_xhtml():
    entries = [TocEntry(title="封面", href="cover.xhtml")]
    nav = build_nav_xhtml(title="目录", entries=entries)
    assert 'epub:type="toc"' in nav
    assert '<a href="cover.xhtml">封面</a>' in nav


def test_build_toc_xhtml():
    entries = [TocEntry(title="序章", href="chapter0001.xhtml")]
    toc = build_toc_xhtml(entries=entries)
    assert "<h3>目录</h3>" in toc
    assert '<a href="chapter0001.xhtml">序章</a>' in toc
```

- [ ] **Step 3: 运行测试确认失败**

```bash
.venv/bin/python -m pytest tests/test_toc_builder.py -v
```

Expected: FAIL。

- [ ] **Step 4: 写实现**

`scripts/toc_builder.py`：
```python
from dataclasses import dataclass
from pathlib import Path
from jinja2 import Environment, FileSystemLoader

TEMPLATES_DIR = Path(__file__).parent / "templates"


@dataclass
class TocEntry:
    title: str
    href: str


def _get_env() -> Environment:
    return Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=False,
        trim_blocks=False,
        lstrip_blocks=False,
    )


def build_toc_ncx(title: str, uuid: str, entries: list[TocEntry]) -> str:
    env = _get_env()
    return env.get_template("toc.ncx.j2").render(title=title, uuid=uuid, entries=entries)


def build_nav_xhtml(title: str, entries: list[TocEntry]) -> str:
    env = _get_env()
    return env.get_template("nav.xhtml.j2").render(title=title, entries=entries)


def build_toc_xhtml(entries: list[TocEntry]) -> str:
    env = _get_env()
    return env.get_template("TOC.xhtml.j2").render(entries=entries)
```

- [ ] **Step 5: 运行测试确认通过**

```bash
.venv/bin/python -m pytest tests/test_toc_builder.py -v
```

Expected: 3 个 PASS。

---

## Phase 4：装配与验证

### Task 13: 主入口脚本（migrate_epub.py）

**Files:**
- Create: `scripts/migrate_epub.py`

把所有模块串起来。CLI 形如：`python -m scripts.migrate_epub`，参数硬编码 09 卷路径。

- [ ] **Step 1: 写主流程脚本**

`scripts/migrate_epub.py`：
```python
"""义妹生活 09 卷译文迁移主入口。

Usage:
    python -m scripts.migrate_epub

参数硬编码（单卷专用）。如要复用其他卷，改 CONFIG 段。
"""
import shutil
import uuid as uuid_module
from datetime import datetime, timezone
from pathlib import Path

from scripts.epub_io import pack_epub
from scripts.paragraph_extractor import extract_paragraphs
from scripts.footnote_extractor import extract_footnotes
from scripts.inline_image_extractor import extract_inline_images
from scripts.aligner import align_paragraphs
from scripts.footnote_relocator import relocate_footnote
from scripts.footnote_cleaner import build_stera_footnote
from scripts.chapter_renderer import render_chapter
from scripts.extras_cleaner import (
    strip_calibre_classes, build_cover_xhtml, build_illus_xhtml,
)
from scripts.metadata_builder import build_content_opf, ManifestItem, SpineItem
from scripts.toc_builder import build_toc_ncx, build_nav_xhtml, build_toc_xhtml, TocEntry

# ===== CONFIG =====
WORK_DIR = Path("/Users/liuzhuo/Downloads/义妹生活")
SRC_UNPACKED = WORK_DIR / "tmp_epub/src09_unpacked"
DST_UNPACKED = WORK_DIR / "tmp_epub/dst09_unpacked"
REF07_UNPACKED = WORK_DIR / "tmp_epub/ref07_unpacked"
BUILD_DIR = WORK_DIR / "tmp_epub/build"
OUT_EPUB = WORK_DIR / "[三河ごーすと].义妹生活.09.[台简].epub"
ALIGN_REPORT = WORK_DIR / "align_report.md"

# SRC chapter N → DST chapter000N split files glob
CHAPTER_MAP = [
    (1, ["Text/chapter0001_split_000.xhtml", "Text/chapter0001_split_001.xhtml"]),
    (2, ["Text/chapter0002_split_000.xhtml", "Text/chapter0002_split_001.xhtml"]),
    (3, ["Text/chapter0003.xhtml"]),
    (4, ["Text/chapter0004_split_000.xhtml", "Text/chapter0004_split_001.xhtml"]),
    (5, ["Text/chapter0005.xhtml"]),
    (6, ["Text/chapter0006_split_000.xhtml", "Text/chapter0006_split_001.xhtml"]),
    (7, ["Text/chapter0007_split_000.xhtml",
         "Text/chapter0007_split_001.xhtml",
         "Text/chapter0007_split_002.xhtml"]),
    (8, ["Text/chapter0008_split_000.xhtml", "Text/chapter0008_split_001.xhtml"]),
    (9, ["Text/chapter0009.xhtml"]),
    (10, ["Text/chapter0010_split_000.xhtml", "Text/chapter0010_split_001.xhtml"]),
    (11, ["Text/chapter0011.xhtml"]),
    (12, ["Text/chapter0012_split_000.xhtml",
          "Text/chapter0012_split_001.xhtml",
          "Text/chapter0012_split_002.xhtml"]),
]

SRC_DESCRIPTION = """我紧紧握住他牵着我的那只手，一点都不想放开。

在校是「情侣」，在家是「兄妹」。
悠太与沙季通过磨合找出适当距离，
但是紧接着就因为父母不在而要度过「完全只有两个人的两天」，
两人真的能继续维持适当的距离吗……？
另一方面，学校活动、朋友的青春与加油、与打工新人「后辈小妹」的交流等，
崭新的风毫不留情地吹向悠太与沙季……？
「相遇」至今一年，历经许多事而改变的两人，迎来高中生活最后的夏天。
经历过友情、青春、新的相遇之后，「兄妹」所面对的感情是──"""


def setup_build_dir() -> None:
    """清空 build 目录，拷贝 REF07 骨架作为基础。"""
    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR)
    BUILD_DIR.mkdir(parents=True)

    # 拷 mimetype
    shutil.copy(REF07_UNPACKED / "mimetype", BUILD_DIR / "mimetype")
    # 拷 META-INF
    shutil.copytree(REF07_UNPACKED / "META-INF", BUILD_DIR / "META-INF")
    # 拷 OEBPS 框架（Styles, Misc, Fonts），不拷 Text 和 Images
    oebps = BUILD_DIR / "OEBPS"
    oebps.mkdir()
    shutil.copytree(REF07_UNPACKED / "OEBPS/Styles", oebps / "Styles")
    shutil.copytree(REF07_UNPACKED / "OEBPS/Misc", oebps / "Misc")
    shutil.copytree(REF07_UNPACKED / "OEBPS/Fonts", oebps / "Fonts")
    # 从 DST 补 emoji.ttf, sym.ttf
    for extra_font in ["emoji.ttf", "sym.ttf"]:
        src_font = DST_UNPACKED / "Fonts" / extra_font
        if src_font.exists():
            shutil.copy(src_font, oebps / "Fonts" / extra_font)
    # 拷 DST 全部图片
    shutil.copytree(DST_UNPACKED / "Images", oebps / "Images")
    # 创建 Text 目录（空，由后续填充）
    (oebps / "Text").mkdir()


def migrate_chapters() -> tuple[list[TocEntry], list[dict]]:
    """处理 12 个正文章节。返回 TOC entries 列表 + 待审报告项列表。"""
    toc_entries: list[TocEntry] = []
    review_items: list[dict] = []

    for src_chapter_num, dst_files in CHAPTER_MAP:
        src_path = SRC_UNPACKED / f"OEBPS/Text/chapter{src_chapter_num}.xhtml"

        # 1. 抽 SRC 段落
        src_paras = extract_paragraphs(src_path)

        # 2. 合并 DST split 抽段落 + 注释 + 内联插图
        dst_paras: list[str] = []
        all_notes: list = []
        all_inline_imgs: list = []
        for f in dst_files:
            dst_file_path = DST_UNPACKED / f
            file_paras = extract_paragraphs(dst_file_path)
            file_notes = extract_footnotes(dst_file_path)
            file_imgs = extract_inline_images(dst_file_path)
            offset = len(dst_paras)
            for note in file_notes:
                note.host_para_index += offset
            for img in file_imgs:
                img.after_para_index += offset
            dst_paras.extend(file_paras)
            all_notes.extend(file_notes)
            all_inline_imgs.extend(file_imgs)

        # 3. 段落对齐
        pairs = align_paragraphs(src_paras, dst_paras)

        # 4. 定位每条注释 → 把 sup 插到 SRC 段落里
        out_paras = list(src_paras)  # 拷贝
        aside_htmls: list[str] = []
        for new_id_num, fn in enumerate(all_notes, start=1):
            relocation = relocate_footnote(fn, src_paras, pairs)
            sup_html, aside_html = build_stera_footnote(fn, new_id_num)
            p = out_paras[relocation.src_para_idx]
            off = relocation.src_char_offset
            out_paras[relocation.src_para_idx] = p[:off] + sup_html + p[off:]
            aside_htmls.append(aside_html)
            review_items.append({
                "chapter": f"chapter{src_chapter_num:04d}",
                "new_note_id": f"note{new_id_num:03d}",
                "confidence": relocation.confidence,
                "score": relocation.score,
                "dst_context": fn.before_ctx + "▮" + fn.after_ctx,
                "src_target": out_paras[relocation.src_para_idx][:80],
                "note_text": fn.text,
            })

        # 5. 把内联插图插入对应段落后（用 align_pairs 把 DST after_para_index 映射到 SRC idx）
        # blocks 是 paragraphs 与 illus div 交织的列表
        blocks: list[str] = []
        # 构建 dst→src 映射（仅 align 成功的对子）
        dst_to_src = {d: s for s, d in pairs if s is not None and d is not None}
        # 把 inline imgs 按"src 段索引"分组
        imgs_after_src_idx: dict[int, list[str]] = {}
        for img in all_inline_imgs:
            src_idx = dst_to_src.get(img.after_para_index)
            if src_idx is None:
                # 找最近的对齐段
                for d in sorted(dst_to_src.keys()):
                    if d >= img.after_para_index:
                        src_idx = dst_to_src[d]
                        break
                if src_idx is None:
                    src_idx = len(out_paras) - 1
            imgs_after_src_idx.setdefault(src_idx, []).append(img.stera_html)
            review_items.append({
                "chapter": f"chapter{src_chapter_num:04d}",
                "new_note_id": f"illus[{img.src_filename}]",
                "confidence": "HIGH" if img.after_para_index in dst_to_src else "MEDIUM",
                "score": 100.0 if img.after_para_index in dst_to_src else 0.0,
                "dst_context": f"after DST para {img.after_para_index}",
                "src_target": f"after SRC para {src_idx} ({out_paras[src_idx][:40]}...)",
                "note_text": f"内联插图: {img.src_filename}",
            })
        # 交织生成 blocks
        for i, p in enumerate(out_paras):
            blocks.append(p)
            for illus_html in imgs_after_src_idx.get(i, []):
                blocks.append(illus_html)

        # 6. 取标题（从 DST 第一个 split 的 <h3>）
        title = _extract_h3_title(DST_UNPACKED / dst_files[0])

        # 7. 渲染并写入
        out_html = render_chapter(title=title, blocks=blocks,
                                  footnote_asides=aside_htmls)
        out_file = BUILD_DIR / f"OEBPS/Text/chapter{src_chapter_num:04d}.xhtml"
        out_file.write_text(out_html, encoding="utf-8")

        toc_entries.append(TocEntry(
            title=title,
            href=f"Text/chapter{src_chapter_num:04d}.xhtml",
        ))

        print(f"  ✓ chapter{src_chapter_num:04d}: "
              f"SRC {len(src_paras)} 段, DST {len(dst_paras)} 段, "
              f"{len(all_notes)} 条注释, {len(all_inline_imgs)} 张插图")

    return toc_entries, review_items


def _extract_h3_title(xhtml_path: Path) -> str:
    """从 DST XHTML 提取 h3 文本（章节标题）。"""
    from lxml import etree
    tree = etree.parse(str(xhtml_path))
    for h3 in tree.iter("{http://www.w3.org/1999/xhtml}h3"):
        text = "".join(h3.itertext()).strip()
        if text:
            return text
    return "未命名章节"


def copy_extras() -> list[TocEntry]:
    """处理附章。
    - cover/illus 用新构建的 STERA 模板（确保点击放大+全屏生效）
    - 其余附章（message/summary/talk/contents/pre/title/special）保留 DST 原文并剥 calibreNN
    """
    extras_toc: list[TocEntry] = []

    # 1. 重建 cover.xhtml（彻底用 STERA 模板，保证多看全屏+掌阅放大）
    cover_html = build_cover_xhtml(image_filename="cover.jpg")
    (BUILD_DIR / "OEBPS/Text/cover.xhtml").write_text(cover_html, encoding="utf-8")

    # 2. 重建 illus0001-0004.xhtml（用 STERA kuchie 模板）
    for n in range(1, 5):
        illus_html = build_illus_xhtml(
            image_filename=f"kuchie-{n:03d}.webp",
            alt=f"kuchie-{n:03d}",
        )
        (BUILD_DIR / "OEBPS/Text" / f"illus{n:04d}.xhtml").write_text(
            illus_html, encoding="utf-8")

    # 3. 其余附章保留 DST 原日翻文本 + 剥 calibreNN 类
    keep_as_is = [
        "title.xhtml", "message.xhtml", "summary.xhtml",
        "talk.xhtml", "contents.xhtml", "pre.xhtml",
        "special0001.xhtml", "special0002.xhtml", "special0003.xhtml",
    ]
    for fname in keep_as_is:
        src = DST_UNPACKED / "Text" / fname
        if not src.exists():
            continue
        content = src.read_text(encoding="utf-8")
        cleaned = strip_calibre_classes(content)
        # 修正样式与脚本路径（DST 原引用是 ../stylesheet.css，新结构是 ../Styles/stylesheet.css）
        cleaned = cleaned.replace(
            'href="../stylesheet.css"', 'href="../Styles/stylesheet.css"'
        ).replace(
            'href="../page_styles.css"', ''  # page_styles 不要了
        )
        out = BUILD_DIR / "OEBPS/Text" / fname
        out.write_text(cleaned, encoding="utf-8")
    return extras_toc


def write_metadata_and_toc(chapter_toc: list[TocEntry]) -> None:
    book_uuid = str(uuid_module.uuid4())
    modified_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # 列出 manifest items（实际中需扫描 BUILD_DIR/OEBPS/）
    manifest_items = _build_manifest(BUILD_DIR / "OEBPS")
    spine_items = _build_spine(chapter_toc)

    opf = build_content_opf(
        title="义妹生活 09",
        description=SRC_DESCRIPTION,
        uuid=book_uuid,
        modified_iso=modified_iso,
        manifest_items=manifest_items,
        spine_items=spine_items,
    )
    (BUILD_DIR / "OEBPS/content.opf").write_text(opf, encoding="utf-8")

    # 三套 TOC
    full_toc = [
        TocEntry(title="封面", href="Text/cover.xhtml"),
        TocEntry(title="书名页", href="Text/title.xhtml"),
        TocEntry(title="简介", href="Text/summary.xhtml"),
    ] + chapter_toc + [
        TocEntry(title="制作信息", href="Text/message.xhtml"),
    ]

    ncx = build_toc_ncx(title="义妹生活 09", uuid=book_uuid, entries=full_toc)
    (BUILD_DIR / "OEBPS/toc.ncx").write_text(ncx, encoding="utf-8")

    nav = build_nav_xhtml(title="目录", entries=full_toc)
    (BUILD_DIR / "OEBPS/Text/navigation-documents.xhtml").write_text(nav, encoding="utf-8")

    toc_html = build_toc_xhtml(entries=full_toc)
    (BUILD_DIR / "OEBPS/Text/TOC.xhtml").write_text(toc_html, encoding="utf-8")


def _build_manifest(oebps_dir: Path) -> list[ManifestItem]:
    """扫描 OEBPS 生成 manifest items。
    - cover.jpg → properties="cover-image"
    - navigation-documents.xhtml → properties="nav"
    - cover.xhtml / illus*.xhtml → properties="scripted"（让阅读器知道引用了 script.js 触发放大）
    """
    items: list[ManifestItem] = []
    media_types = {
        ".xhtml": "application/xhtml+xml",
        ".css": "text/css",
        ".js": "application/javascript",
        ".ttf": "font/ttf",
        ".webp": "image/webp",
        ".jpg": "image/jpeg",
        ".png": "image/png",
        ".ncx": "application/x-dtbncx+xml",
    }
    scripted_xhtmls = {"cover.xhtml", "title.xhtml", "message.xhtml",
                       "summary.xhtml", "TOC.xhtml", "pre.xhtml",
                       "illus0001.xhtml", "illus0002.xhtml",
                       "illus0003.xhtml", "illus0004.xhtml",
                       "talk.xhtml", "contents.xhtml",
                       "special0001.xhtml", "special0002.xhtml",
                       "special0003.xhtml"}
    chapter_xhtmls = {f"chapter{i:04d}.xhtml" for i in range(1, 13)}

    for path in sorted(oebps_dir.rglob("*")):
        if not path.is_file():
            continue
        if path.name == "content.opf":
            continue
        rel = path.relative_to(oebps_dir).as_posix()
        ext = path.suffix.lower()
        mt = media_types.get(ext, "application/octet-stream")
        item_id = path.stem.replace(".", "_")
        properties = None

        if path.name == "cover.jpg":
            properties = "cover-image"
            item_id = "cover-image"
        elif path.name == "navigation-documents.xhtml":
            properties = "nav"
            item_id = "nav"
        elif path.name in scripted_xhtmls:
            properties = "scripted"
        elif path.name in chapter_xhtmls:
            # 正文章节也引用了 script.js（注释 sup 交互），加 scripted
            properties = "scripted"

        items.append(ManifestItem(id=item_id, href=rel, media_type=mt, properties=properties))
    return items


def _build_spine(chapter_toc: list[TocEntry]) -> list[SpineItem]:
    """拍 spine 顺序，给 cover/illus 加 duokan-page-fullscreen/fitwindow 触发全屏放大。"""
    spine: list[SpineItem] = []
    # 封面：全屏
    spine.append(SpineItem(idref="cover", linear="yes",
                           properties="duokan-page-fullscreen"))
    spine.append(SpineItem(idref="title", linear="yes", properties=None))
    spine.append(SpineItem(idref="message", linear="yes", properties=None))
    spine.append(SpineItem(idref="summary", linear="yes", properties=None))
    # 插图：fitwindow
    for n in range(1, 5):
        spine.append(SpineItem(idref=f"illus{n:04d}", linear="yes",
                               properties="duokan-page-fitwindow"))
    spine.append(SpineItem(idref="TOC", linear="yes", properties=None))
    spine.append(SpineItem(idref="pre", linear="yes", properties=None))
    # 正文 12 章
    for i in range(1, 13):
        spine.append(SpineItem(idref=f"chapter{i:04d}", linear="yes", properties=None))
    # special 番外
    for n in range(1, 4):
        spine.append(SpineItem(idref=f"special{n:04d}", linear="yes", properties=None))
    # 导航文件不在 spine 主流，linear=no
    spine.append(SpineItem(idref="nav", linear="no", properties=None))
    return spine


def write_align_report(review_items: list[dict]) -> None:
    lines = ["# 注释定位与对齐审计报告\n",
             f"共 {len(review_items)} 条注释，按 chapter+confidence 列出：\n"]
    for it in sorted(review_items, key=lambda x: (x["chapter"], x["confidence"])):
        emoji = {"HIGH": "✅", "MEDIUM": "⚠️", "LOW": "❌"}.get(it["confidence"], "?")
        lines.append(f"## {emoji} {it['chapter']} / {it['new_note_id']} "
                     f"({it['confidence']}, score={it['score']:.1f})")
        lines.append(f"- **注释**: {it['note_text']}")
        lines.append(f"- **DST 上下文** (▮=sup): `{it['dst_context']}`")
        lines.append(f"- **SRC 插入处** (前 80 字): `{it['src_target']}`")
        lines.append("")
    ALIGN_REPORT.write_text("\n".join(lines), encoding="utf-8")
    print(f"已写入 {ALIGN_REPORT}")


def main() -> None:
    print("=== Step 1: 准备 build 目录 ===")
    setup_build_dir()

    print("=== Step 2: 迁移 12 个正文章节 ===")
    chapter_toc, review_items = migrate_chapters()

    print("=== Step 3: 清洗附章 ===")
    copy_extras()

    print("=== Step 4: 写元数据 + 三套 TOC ===")
    write_metadata_and_toc(chapter_toc)

    print("=== Step 5: 打包 EPUB ===")
    pack_epub(BUILD_DIR, OUT_EPUB)
    print(f"输出: {OUT_EPUB}")

    print("=== Step 6: 写审计报告 ===")
    write_align_report(review_items)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 单元导入测试**

```bash
cd "/Users/liuzhuo/Downloads/义妹生活"
.venv/bin/python -c "from scripts import migrate_epub; print('import OK')"
```

Expected: 输出 `import OK`，无 ImportError。

### Task 14: 双章试跑（chapter0001 + chapter0003）

测两个有代表性的章节：chapter0001（含 split 合并 + 1 张内联插图 p039 + 1 条注释）和 chapter0003（含 3 条注释、最复杂的注释定位场景）。

**Files:**
- Modify: `scripts/migrate_epub.py`（临时只跑 chapter1, chapter3）

- [ ] **Step 1: 改 CHAPTER_MAP 只留 chapter 1 和 3**

临时把 `migrate_epub.py` 的 `CHAPTER_MAP` 改为：
```python
CHAPTER_MAP = [
    (1, ["Text/chapter0001_split_000.xhtml", "Text/chapter0001_split_001.xhtml"]),
    (3, ["Text/chapter0003.xhtml"]),
]
```

- [ ] **Step 2: 运行**

```bash
cd "/Users/liuzhuo/Downloads/义妹生活"
.venv/bin/python -m scripts.migrate_epub
```

Expected: 输出 6 个 Step 完成，生成 `[三河ごーすと].义妹生活.09.[台简].epub` 和 `align_report.md`。

- [ ] **Step 3: 用 epubcheck 验证**

```bash
epubcheck "[三河ごーすと].义妹生活.09.[台简].epub"
```

Expected: 至多 warning，无 ERROR。如有 ERROR，分类修：
- "duplicate identifier" → 看 ID 重复
- "missing resource" → 看 manifest
- "RSC-005" XHTML 语法错 → 看渲染的章节

- [ ] **Step 4: 阅读器走查**

用 macOS Books.app 打开新 EPUB，肉眼审：
- chapter0001 和 chapter0003 标题正常显示
- chapter0001 含 1 张内联插图（p039.webp）出现在「然后她摘下了束住头发的发卡」附近，**且可点击放大**
- chapter0001 含 1 条注释（评：学习方法不建议），chapter0003 含 3 条注释，sup 图标可见、点击能跳转 aside
- 段落文字是 SRC 译文（含"亚季子小姐"等台版译名）
- **封面/插图能点击放大**（Books.app 双击封面应放大；如打不开放大，检查 cover.xhtml 是否含 `class="cover duokan-image-single"` + `zy-enlarge-src="self"`、manifest 是否含 `properties="scripted"`、spine itemref 是否含 `properties="duokan-page-fullscreen"`）

- [ ] **Step 5: 用户 review 检查点**

⏸ **暂停**：把生成的 EPUB 路径 + align_report.md 给用户检查 chapter0003 的 3 条注释定位是否正确。等用户确认后才进入 Task 15。

- [ ] **Step 6: 恢复 CHAPTER_MAP**

把 `migrate_epub.py` 的 `CHAPTER_MAP` 恢复为完整 12 章版本。

### Task 15: 批跑全部 12 章

- [ ] **Step 1: 运行完整迁移**

```bash
cd "/Users/liuzhuo/Downloads/义妹生活"
.venv/bin/python -m scripts.migrate_epub
```

Expected: 12 个章节全部迁移成功，每个章节输出 `SRC N 段, DST M 段, K 条注释`。

- [ ] **Step 2: 验证产物**

```bash
ls -la "[三河ごーすと].义妹生活.09.[台简].epub"
ls -la align_report.md
```

Expected: 两个文件都存在，EPUB 体积约 3.5-4 MB。

- [ ] **Step 3: epubcheck 完整验证**

```bash
epubcheck "[三河ごーすと].义妹生活.09.[台简].epub" 2>&1 | tee epubcheck.log
```

Expected: 0 ERROR。warning 可以接受（特别是字体缺失）。如有 ERROR，迭代修复。

### Task 16: 生成排版对比报告（layout-comparison-report.md）

**Files:**
- Create: `/Users/liuzhuo/Downloads/义妹生活/layout-comparison-report.md`

- [ ] **Step 1: 写入对比报告**

把 spec §3 的内容（10 维度对比表 + 结论）单独抽出为 markdown 文件。

`layout-comparison-report.md`：
```markdown
# 义妹生活 09 卷排版对比报告

## 背景

对比两个候选排版：
- **DST**：`[三河ごーすと].义妹生活.09.[日翻].epub`（calibre 自动转出）
- **REF07**：`[三河ごーすと].义妹生活.07.[台简].epub`（虚空文学旅团 STERA 专业排版）

## 量化对比

| 维度 | DST 09 | REF07 | 更好 |
|---|---|---|---|
| 生产线 | Calibre 7.21 自动 | 虚空文学旅团 STERA 排版 | ✅ REF07 |
| 章节文件数 | 39（每章拆 split） | 13（每章一个） | ✅ REF07 |
| CSS 总行数 | 860 | 162（精简 5×） | ✅ REF07 |
| CSS 类语义 | calibreNN（无语义） | cover/illus/em10/red/main | ✅ REF07 |
| 不重复 class 数 | 62 | 25 | ✅ REF07 |
| 设备自适配 | 无 @media | @media PC/手机/Kindle | ✅ REF07 |
| 字体系统 | 10 套 ttf | 10 套 ttf + int.ttf | ≈ 平手 |
| 注释格式 | 含 calibre 噪音 | 结构清爽 | ✅ REF07 |
| script.js | 与 REF07 同源 | 同上 | = 同 |

## 结论

REF07 在 10 个维度中 7 个明显优于 DST，2 个平手，0 个劣势。

新 09 卷采用 REF07 STERA 排版作为骨架，与 01-07 卷视觉/字体/字号体系完全统一。
```

### Task 17: 最终交付检查

- [ ] **Step 1: 检查三份交付物**

```bash
cd "/Users/liuzhuo/Downloads/义妹生活"
ls -la "[三河ごーすと].义妹生活.09.[台简].epub" \
       layout-comparison-report.md \
       align_report.md
```

Expected: 三个文件都存在。

- [ ] **Step 2: 跑 epubcheck**

```bash
epubcheck "[三河ごーすと].义妹生活.09.[台简].epub"
```

Expected: 0 ERROR。

- [ ] **Step 3: 让用户用阅读器走查**

⏸ **暂停**：用户用 macOS Books.app 或 calibre 打开 EPUB，检查：
- 封面/目录/简介渲染正常
- **封面可双击放大（全屏）**
- **4 张插图（kuchie-001~004）可点击放大（fitwindow）**，横图自动旋转
- 12 章正文文字是台版译文
- 11 条注释的 sup 图标可点击，aside 内容正确
- 字体与 01-07 卷一致

- [ ] **Step 4: 清理临时文件**

```bash
cd "/Users/liuzhuo/Downloads/义妹生活"
rm -rf tmp_epub/  # 解包+build 临时目录
```

Expected: tmp_epub 已删除，三份交付物仍在。

---

## 自审备注

本计划已自审：
- **Spec 覆盖**：spec §3 排版对比 → Task 16；spec §4.1 骨架 → Task 1+2+13；spec §4.2 章节模板 → Task 9+13；spec §4.3 段落对齐 → Task 6；spec §4.4 注释 → Task 5+7+8；spec §4.5 元数据 → Task 11；spec §4.6 三套 TOC → Task 12；spec §4.7 工具 → Task 1+3+13；spec §5 交付物 → Task 15+16+17。
- **额外覆盖**：用户提问的"插图/封面点击放大"机制 → Task 5b（章内插图抽取）+ Task 10（cover/illus 重建为 STERA 格式）+ Task 11+13（OPF spine itemref 加 duokan-page-fullscreen/fitwindow + manifest 加 scripted properties）+ Task 9（模板支持 inline div 渲染不被 `<p>` 包裹）。
- **占位符扫描**：无 TBD/TODO/略 等占位。
- **类型一致性**：`Footnote.host_para_index`/`Relocation.src_para_idx`/`ManifestItem.id`/`SpineItem.idref`/`InlineImage.after_para_index` 等字段名跨任务一致。`render_chapter(title, blocks, footnote_asides)` 参数命名跨 Task 9 和 Task 13 一致。

## 已知限制

1. **段落对齐失败大场景**：若某章 SRC/DST 段数差异 > 5，DP 对齐可能错位，需人工指定锚点（Task 15 跑完看 review 报告）
2. **注释 fuzzy 定位偏差**：score < 60 的 LOW 项落到段末，需人工核对
3. **字体覆盖率**：REF07 main.ttf 若不覆盖 SRC 罕字，阅读器会 fallback 到系统字体
4. **附章风格不统一**：special/talk/message 等仍是日翻原文，与正文台版风格混搭（用户已接受）
5. **内联插图定位精度**：依赖段落对齐结果反向映射，若该段对齐失败，图片落到"最近对齐段后"（review 报告会标记，可人工挪位）
6. **段落文本含特殊字符（< > &）**：模板用 `|safe` 不转义，SRC 中文译文罕见这些字符；如果某段含 `<3` `&copy;` 等会破坏 XHTML，需手动 escape
