# EPUB 反混淆与精排版对齐 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 来按任务推进本计划。步骤使用 checkbox（`- [ ]`）追踪。

**Goal：** 把多看版义妹生活 11-15 卷 EPUB 的文件名混淆反解出来、对齐第 7 卷的 STERA 精排版基准、补齐元数据，输出到 `unlocked/clean/`。

**Architecture：** 单文件 Python 脚本 `/tmp/epub_clean.py`，逐卷处理：解 zip → 用 OPF item id 建反混淆映射 → 按映射重写 xhtml / ncx / css / opf 引用 + 改文件名 → 写新 zip。仅用标准库。最终用脚本内建 self-check 验证。

**Tech Stack：** Python 3 标准库（`zipfile` / `xml.etree.ElementTree` / `urllib.parse` / `re` / `hashlib` / `posixpath` / `pathlib`）。无外部依赖。

**对应 Spec：** `docs/superpowers/specs/2026-05-22-epub-deobfuscate-clean-design.md`

**Git 备注：** 项目所在目录非 git 仓库（macOS 下载目录），按用户全局规则不引入 git。**`commit` 步骤替代为「保存当前脚本到 `/tmp/snapshots/epub_clean.tNN.py`」**，可随时回滚或对照。

**TDD 适配说明：** Spec §4 明确不写 pytest 单元测试。本计划保留 TDD 的「先约定行为/验证再写实现」节奏，但**用即时集成验证替代单元测试**：每个函数实现后立即在已解包的真实数据（`/tmp/epub15-2/`）上跑一次最小调用，对照预期输出。所有真实数据已经在前置探查阶段就绪。

---

## File Structure

| 文件 | 角色 | 行数估算 |
|---|---|---|
| `/tmp/epub_clean.py` | 一次性处理脚本，所有逻辑都在此文件 | ~350 |
| `/tmp/snapshots/epub_clean.t00.py` ~ `t14.py` | 每个任务结束的脚本快照（替代 git commit） | - |
| `/Users/liuzhuo/Downloads/义妹生活/unlocked/clean/*.clean.epub` | 5 卷最终产物 | - |

**模块内拆分（同一文件内的逻辑分区）：**

| 函数 | 职责 |
|---|---|
| `unquote_recursive(s)` | 循环 unquote 至稳定（防双层编码） |
| `parse_opf(zin)` | 找 OPF 路径、解析、build 反混淆 mapping |
| `remap_path(href, mapping, base)` | 单条路径反混淆，含 fragment 保留 |
| `patch_xhtml(text, mapping)` | 替换 xhtml 中 link/script/img/a/image 引用 |
| `patch_ncx(text, mapping)` | 替换 NCX content src |
| `patch_css(text, mapping)` | 正则替换所有 url() 引用 |
| `patch_opf_manifest(tree, ns, mapping)` | 重写 manifest item href 为干净路径 |
| `patch_opf_metadata(tree, ns, vol_num, src_path)` | 元数据增删 |
| `write_epub(out_path, files)` | 写新 zip（mimetype STORED） |
| `validate_output(epub_path)` | spec §11 自检清单 |
| `process_one(src, dst, vol_num)` | 单卷串联 |
| `main()` | 5 卷主循环 |

---

## Pre-Tasks（前置：环境就绪）

- [ ] **Pre-1：确认前置数据可用**

Run:
```bash
ls /tmp/epub15-2/OEBPS/content.opf && ls /tmp/v15.epub && ls /Users/liuzhuo/Downloads/义妹生活/unlocked/*.unlocked.epub | wc -l
```
Expected: 各路径都列出（前两个文件存在，第三个数为 5）。这些是前阶段探查留下的工件。若缺失，重新解包：
```bash
cp "/Users/liuzhuo/Downloads/义妹生活/unlocked/[三河ごーすと].义妹生活.15.[日翻].unlocked.epub" /tmp/v15.epub
rm -rf /tmp/epub15-2 && mkdir -p /tmp/epub15-2 && unzip -q /tmp/v15.epub -d /tmp/epub15-2
```

- [ ] **Pre-2：创建快照目录 + 输出目录**

Run:
```bash
mkdir -p /tmp/snapshots /Users/liuzhuo/Downloads/义妹生活/unlocked/clean
```

---

### Task 0：脚本骨架 + 常量

**Files:**
- Create: `/tmp/epub_clean.py`
- Snapshot: `/tmp/snapshots/epub_clean.t00.py`

- [ ] **Step 1：写骨架**

```python
#!/usr/bin/env python3
"""EPUB 反混淆与精排版对齐脚本 — 义妹生活 11-15 卷。
对应 spec: docs/superpowers/specs/2026-05-22-epub-deobfuscate-clean-design.md
一次性工具，不为复用设计。
"""
import hashlib
import posixpath
import re
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

SRC_DIR = Path("/Users/liuzhuo/Downloads/义妹生活/unlocked")
DST_DIR = Path("/Users/liuzhuo/Downloads/义妹生活/unlocked/clean")
VOLS = [11, 12, 13, 14, 15]
SRC_TEMPLATE = "[三河ごーすと].义妹生活.{n:02d}.[日翻].unlocked.epub"
DST_TEMPLATE = "[三河ごーすと].义妹生活.{n:02d}.[日翻].clean.epub"

OPF_NS = "http://www.idpf.org/2007/opf"
DC_NS = "http://purl.org/dc/elements/1.1/"
XLINK_NS = "http://www.w3.org/1999/xlink"
XHTML_NS = "http://www.w3.org/1999/xhtml"
NCX_NS = "http://www.daisy.org/z3986/2005/ncx/"
EPUB_NS = "http://www.idpf.org/2007/ops"

ET.register_namespace("", OPF_NS)
ET.register_namespace("dc", DC_NS)
ET.register_namespace("opf", OPF_NS)
ET.register_namespace("xlink", XLINK_NS)
ET.register_namespace("epub", EPUB_NS)

# 占位声明，下游任务依次填充
def unquote_recursive(s: str) -> str: ...
def parse_opf(zin): ...
def remap_path(href, mapping, base=""): ...
def patch_xhtml(text, mapping): ...
def patch_ncx(text, mapping): ...
def patch_css(text, mapping): ...
def patch_opf_manifest(tree, ns, mapping): ...
def patch_opf_metadata(tree, ns, vol_num, src_path): ...
def write_epub(out_path, files): ...
def validate_output(epub_path): ...
def process_one(src, dst, vol_num): ...

def main():
    pass

if __name__ == "__main__":
    main()
```

- [ ] **Step 2：跑骨架确认无语法错误**

Run:
```bash
python3 /tmp/epub_clean.py
```
Expected: 静默退出，exit code 0。

- [ ] **Step 3：保存快照**

```bash
cp /tmp/epub_clean.py /tmp/snapshots/epub_clean.t00.py
```

---

### Task 1：`unquote_recursive`

**Files:**
- Modify: `/tmp/epub_clean.py`（替换占位函数 `unquote_recursive`）
- Snapshot: `/tmp/snapshots/epub_clean.t01.py`

- [ ] **Step 1：约定行为 + 写验证 snippet**

行为：对入参做 `urllib.parse.unquote`，重复直到结果不再变化。验证 snippet（直接命令行跑）：
```bash
python3 - <<'PY'
import urllib.parse
def unquote_recursive(s):
    prev = None; cur = s
    while prev != cur:
        prev = cur
        cur = urllib.parse.unquote(cur)
    return cur

assert unquote_recursive("Images/%2A%2A%3F.webp") == "Images/**?.webp"
assert unquote_recursive("%252A") == "*"          # 双层
assert unquote_recursive("plain.xhtml") == "plain.xhtml"  # 无编码
print("OK")
PY
```
Expected: 输出 `OK`。

- [ ] **Step 2：实现替换骨架中的占位**

在 `/tmp/epub_clean.py` 中把占位 `def unquote_recursive(s: str) -> str: ...` 替换为：

```python
def unquote_recursive(s: str) -> str:
    prev, cur = None, s
    while prev != cur:
        prev = cur
        cur = urllib.parse.unquote(cur)
    return cur
```

- [ ] **Step 3：跑同样的 3 个 assert 验证（用脚本内函数）**

Run:
```bash
python3 -c "
import sys; sys.path.insert(0, '/tmp')
from epub_clean import unquote_recursive
assert unquote_recursive('Images/%2A%2A%3F.webp') == 'Images/**?.webp'
assert unquote_recursive('%252A') == '*'
assert unquote_recursive('plain.xhtml') == 'plain.xhtml'
print('OK')
"
```
Expected: `OK`。

- [ ] **Step 4：快照**

```bash
cp /tmp/epub_clean.py /tmp/snapshots/epub_clean.t01.py
```

---

### Task 2：`parse_opf`

**Files:**
- Modify: `/tmp/epub_clean.py`
- Snapshot: `/tmp/snapshots/epub_clean.t02.py`

- [ ] **Step 1：约定行为**

输入：`zipfile.ZipFile` 对象。输出 `(opf_path: str, opf_tree: ET.ElementTree, ns_map: dict, mapping: dict)`。
- 从 `META-INF/container.xml` 解析出 OPF 路径（不假设是 `OEBPS/content.opf`）
- mapping 形如 `{ "Text/*:|?...xhtml": "Text/chapter0001.xhtml", "Images/*:|?...jpg": "Images/cover.jpg", ... }`，key 是 OPF dir 相对路径（已 unquote）
- item id 无扩展名时按 media-type 补：`image/jpeg→.jpg`, `image/png→.png`, `image/webp→.webp`, `font/ttf→.ttf`, `text/css→.css`, `application/javascript→.js`, `application/xhtml+xml→.xhtml`, `application/x-dtbncx+xml→.ncx`

- [ ] **Step 2：实现替换占位**

```python
MIME2EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "font/ttf": ".ttf",
    "font/otf": ".otf",
    "application/font-sfnt": ".ttf",
    "application/vnd.ms-opentype": ".otf",
    "text/css": ".css",
    "application/javascript": ".js",
    "text/javascript": ".js",
    "application/xhtml+xml": ".xhtml",
    "application/x-dtbncx+xml": ".ncx",
}

def parse_opf(zin):
    # 1. container.xml 找 OPF 路径
    container_xml = zin.read("META-INF/container.xml").decode("utf-8")
    container = ET.fromstring(container_xml)
    rootfile = container.find(
        ".//{urn:oasis:names:tc:opendocument:xmlns:container}rootfile"
    )
    opf_path = rootfile.get("full-path")  # e.g. "OEBPS/content.opf"
    opf_dir = posixpath.dirname(opf_path)  # e.g. "OEBPS"

    # 2. 解析 OPF
    opf_bytes = zin.read(opf_path)
    opf_tree = ET.ElementTree(ET.fromstring(opf_bytes))
    ns = {"opf": OPF_NS, "dc": DC_NS}

    # 3. build mapping
    mapping = {}
    for item in opf_tree.iterfind(".//opf:manifest/opf:item", ns):
        raw_href = item.get("href")
        decoded = unquote_recursive(raw_href)         # 相对 opf_dir
        item_id = item.get("id")
        mime = item.get("media-type", "")
        # 若 id 无扩展名，按 media-type 补
        if "." not in posixpath.basename(item_id):
            item_id = item_id + MIME2EXT.get(mime, "")
        dir_name = posixpath.dirname(decoded)
        new_href = f"{dir_name}/{item_id}" if dir_name else item_id
        mapping[decoded] = new_href

    return opf_path, opf_tree, ns, mapping
```

- [ ] **Step 3：验证（对 15 卷跑一次，打印 mapping 前 10 项）**

Run:
```bash
python3 -c "
import sys, zipfile
sys.path.insert(0, '/tmp')
from epub_clean import parse_opf
with zipfile.ZipFile('/tmp/v15.epub') as z:
    p, t, ns, m = parse_opf(z)
    print('OPF:', p)
    print('Mapping count:', len(m))
    for i, (k, v) in enumerate(list(m.items())[:10]):
        print(f'  {k!r}\n  → {v!r}')
"
```
Expected: 类似
```
OPF: OEBPS/content.opf
Mapping count: 64
  'Text/**?|:|**|???**|||?.xhtml'
  → 'Text/TOC.xhtml'
  'Fonts/**????*:**:|**:|??.ttf'
  → 'Fonts/ch1.ttf'
  ...
  'Images/*:|?**????*:**:|*:**|:*:***:**:||:**:|?|.jpg'
  → 'Images/cover.jpg'
```

- [ ] **Step 4：快照**

```bash
cp /tmp/epub_clean.py /tmp/snapshots/epub_clean.t02.py
```

---

### Task 3：`remap_path`

**Files:**
- Modify: `/tmp/epub_clean.py`
- Snapshot: `/tmp/snapshots/epub_clean.t03.py`

- [ ] **Step 1：约定行为**

输入：`href`（可能含 `..` 相对、可能含 `#fragment`、可能 percent-encoded）、`mapping`、`base`（当前文件所在 OPF dir 相对路径，如 `"Text"`）。
输出：新的 href，保持「相对于当前文件位置」（即输出仍带 `../` 前缀符合该文件位置）。

规则：
1. 跳过 `data:`、`http://`、`https://`、`mailto:`、`tel:` 与纯 fragment `#xxx`
2. 拆 `path` 与 `#fragment`
3. `path = unquote_recursive(path)`
4. `abs_in_opf = posixpath.normpath(posixpath.join(base, path))`（base 形如 Text/，path 形如 ../Styles/...css → 得到 Styles/...css）
5. mapping 查 `abs_in_opf`，命中则取 `new_abs`，未命中保留原 path（unquote 之后的版本）
6. 计算 `relpath = posixpath.relpath(new_abs, base or ".")`
7. 拼回 fragment：`return relpath + ("#" + frag if frag else "")`

- [ ] **Step 2：实现替换占位**

```python
def remap_path(href, mapping, base=""):
    # 跳过 absolute / data URI / pure fragment
    if href.startswith(("data:", "http://", "https://", "mailto:", "tel:", "#")):
        return href
    if "#" in href:
        path, frag = href.split("#", 1)
        frag = "#" + frag
    else:
        path, frag = href, ""
    if not path:
        return href
    path = unquote_recursive(path)
    abs_in_opf = posixpath.normpath(posixpath.join(base, path))
    new_abs = mapping.get(abs_in_opf, abs_in_opf)
    rel = posixpath.relpath(new_abs, base or ".")
    # posixpath.relpath 在 base 与 new_abs 同目录时返回 'file.ext' 而非 './file.ext'，符合期望
    return rel + frag
```

- [ ] **Step 3：验证（5 组样例）**

Run:
```bash
python3 -c "
import sys; sys.path.insert(0, '/tmp')
from epub_clean import remap_path
mp = {
    'Styles/*:*****.css': 'Styles/default.css',
    'Misc/*:*:|:.js': 'Misc/script.js',
    'Images/*:|?**.webp': 'Images/cover.jpg',
    'Text/**?|.xhtml': 'Text/TOC.xhtml',
}
# 来自 Text/ 下文件，引用 ../Styles/...
assert remap_path('../Styles/%2A%3A%2A%2A%2A%2A%2A.css', mp, 'Text') == '../Styles/default.css'
# 含 fragment
assert remap_path('../Text/%2A%2A%3F%7C.xhtml#note1', mp, 'Text') == 'TOC.xhtml#note1'
# 同目录
assert remap_path('%2A%2A%3F%7C.xhtml', mp, 'Text') == 'TOC.xhtml'
# 未命中保留
assert remap_path('../Images/orphan.gif', mp, 'Text') == '../Images/orphan.gif'
# 纯 fragment 不动
assert remap_path('#note3', mp, 'Text') == '#note3'
print('OK')
"
```
Expected: `OK`。

- [ ] **Step 4：快照**

```bash
cp /tmp/epub_clean.py /tmp/snapshots/epub_clean.t03.py
```

---

### Task 4：`patch_xhtml`

**Files:**
- Modify: `/tmp/epub_clean.py`
- Snapshot: `/tmp/snapshots/epub_clean.t04.py`

- [ ] **Step 1：约定行为**

输入：xhtml 文本 + mapping + base（该 xhtml 所在 OPF dir 相对路径，如 `"Text"`）。输出：替换后文本。
- 用 `ET.fromstring` 解析（已注册 xhtml/epub/xlink 命名空间）
- 遍历下列属性，每个值跑 `remap_path`：
  - `{xhtml}link@href`
  - `{xhtml}script@src`
  - `{xhtml}img@src`
  - `{xhtml}image@{xlink}href`
  - `{xhtml}a@href`
  - `{xhtml}audio@src` / `{xhtml}video@src` / `{xhtml}source@src`
- 解析失败时退化为正则替换 + 报警 print

- [ ] **Step 2：实现替换占位**

```python
XHTML_ATTRS = [
    (f"{{{XHTML_NS}}}link", "href"),
    (f"{{{XHTML_NS}}}script", "src"),
    (f"{{{XHTML_NS}}}img", "src"),
    (f"{{{XHTML_NS}}}image", f"{{{XLINK_NS}}}href"),
    (f"{{{XHTML_NS}}}a", "href"),
    (f"{{{XHTML_NS}}}audio", "src"),
    (f"{{{XHTML_NS}}}video", "src"),
    (f"{{{XHTML_NS}}}source", "src"),
]
DOCTYPE_RE = re.compile(r"<!DOCTYPE[^>]*>", re.IGNORECASE)

def patch_xhtml(text, mapping, base):
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        print(f"  [WARN] xhtml parse failed ({e}); falling back to regex")
        return _patch_xhtml_regex(text, mapping, base)

    for tag, attr in XHTML_ATTRS:
        for el in root.iter(tag):
            v = el.get(attr)
            if v is not None:
                el.set(attr, remap_path(v, mapping, base))

    # 序列化：保留 xml 声明 + DOCTYPE
    body = ET.tostring(root, encoding="unicode")
    head = '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n\n'
    return head + body

def _patch_xhtml_regex(text, mapping, base):
    pat = re.compile(r'(href|src)="([^"]+)"')
    return pat.sub(
        lambda m: f'{m.group(1)}="{remap_path(m.group(2), mapping, base)}"',
        text,
    )
```

- [ ] **Step 3：验证（拿 15 卷 illus xhtml 跑）**

Run:
```bash
python3 -c "
import sys, zipfile
sys.path.insert(0, '/tmp')
from epub_clean import parse_opf, patch_xhtml
with zipfile.ZipFile('/tmp/v15.epub') as z:
    _, _, _, mp = parse_opf(z)
    # 取一个含 kuchie/duokan-image-single 的 xhtml
    target = next(n for n in z.namelist()
                  if n.endswith('.xhtml') and b'duokan-image-single' in z.read(n))
    text = z.read(target).decode('utf-8')
    new = patch_xhtml(text, mp, 'Text')
    # 不应有 %2A 残留，应有 zy-enlarge-src 保留
    assert '%2A' not in new, '还有 percent-encoded 残留'
    assert 'zy-enlarge-src' in new, 'zy-enlarge-src 丢了'
    assert 'duokan-image-single' in new, 'class 丢了'
    # 干净路径应出现
    assert '../Styles/default.css' in new or 'default.css' in new
    print('OK')
    print(new[:500])
"
```
Expected: `OK` + xhtml 头部预览，能看到干净的 `../Styles/default.css` 和 `../Misc/script.js` 引用。

- [ ] **Step 4：快照**

```bash
cp /tmp/epub_clean.py /tmp/snapshots/epub_clean.t04.py
```

---

### Task 5：`patch_ncx`

**Files:**
- Modify: `/tmp/epub_clean.py`
- Snapshot: `/tmp/snapshots/epub_clean.t05.py`

- [ ] **Step 1：约定行为**

输入：NCX 文本 + mapping + base（通常是 OPF dir 自身）。
对 `<content src="..."/>` 跑 `remap_path`。NCX 比 xhtml 简单，直接正则就够。

- [ ] **Step 2：实现替换占位**

```python
NCX_CONTENT_SRC_RE = re.compile(r'(<content\s+[^>]*\bsrc=)"([^"]+)"')

def patch_ncx(text, mapping, base=""):
    return NCX_CONTENT_SRC_RE.sub(
        lambda m: f'{m.group(1)}"{remap_path(m.group(2), mapping, base)}"',
        text,
    )
```

- [ ] **Step 3：验证（拿 15 卷的 ncx 跑）**

Run:
```bash
python3 -c "
import sys, zipfile
sys.path.insert(0, '/tmp')
from epub_clean import parse_opf, patch_ncx
with zipfile.ZipFile('/tmp/v15.epub') as z:
    _, _, _, mp = parse_opf(z)
    ncx_name = next((n for n in z.namelist() if n.endswith('.ncx')), None)
    if not ncx_name:
        print('SKIP: no NCX (EPUB3 only)')
    else:
        text = z.read(ncx_name).decode('utf-8')
        new = patch_ncx(text, mp, '')
        assert '%2A' not in new, '还有 percent-encoded 残留'
        # 应能看到 chapter0001.xhtml 之类干净名
        assert 'chapter' in new.lower() or 'cover' in new.lower()
        print('OK')
"
```
Expected: `OK` 或 `SKIP: no NCX`。

- [ ] **Step 4：快照**

```bash
cp /tmp/epub_clean.py /tmp/snapshots/epub_clean.t05.py
```

---

### Task 6：`patch_css`

**Files:**
- Modify: `/tmp/epub_clean.py`
- Snapshot: `/tmp/snapshots/epub_clean.t06.py`

- [ ] **Step 1：约定行为**

输入：CSS 文本 + mapping + base（css 文件所在 OPF dir 相对路径，通常 `"Styles"`）。
- 正则匹配 `url(...)` 形态（含 `@font-face` / `background-image` / `@import`）
- 跳过 `data:` URI
- 命中的替换为 `remap_path` 结果

- [ ] **Step 2：实现替换占位**

```python
CSS_URL_RE = re.compile(r"""url\(\s*(['"]?)([^)'"\s]+)\1\s*\)""")

def patch_css(text, mapping, base="Styles"):
    def _sub(m):
        url = m.group(2)
        if url.startswith("data:"):
            return m.group(0)
        new = remap_path(url, mapping, base)
        return f"url({new})"
    return CSS_URL_RE.sub(_sub, text)
```

- [ ] **Step 3：验证（拿 15 卷 default.css 跑，并与 7 卷 default.css diff）**

Run:
```bash
python3 -c "
import sys, zipfile
sys.path.insert(0, '/tmp')
from epub_clean import parse_opf, patch_css
with zipfile.ZipFile('/tmp/v15.epub') as z:
    _, _, _, mp = parse_opf(z)
    # 找 default.css 的当前 href
    default_old = next(k for k, v in mp.items() if v.endswith('default.css'))
    text = z.read('OEBPS/' + default_old).decode('utf-8')
    new = patch_css(text, mp, 'Styles')
    with open('/tmp/default.15.new.css', 'w') as f:
        f.write(new)
    assert '%2A' not in new
    print('OK; wrote /tmp/default.15.new.css')
"
diff /tmp/epub07/OEBPS/Styles/default.css /tmp/default.15.new.css | head -20
```
Expected: `OK`。diff 输出应为空（完全一致）或只有 1-2 行无关紧要的差异（如换行符）。

- [ ] **Step 4：快照**

```bash
cp /tmp/epub_clean.py /tmp/snapshots/epub_clean.t06.py
```

---

### Task 7：`patch_opf_manifest`

**Files:**
- Modify: `/tmp/epub_clean.py`
- Snapshot: `/tmp/snapshots/epub_clean.t07.py`

- [ ] **Step 1：约定行为**

输入：OPF 的 `ElementTree` + `ns` + `mapping`。
- 遍历每个 `<opf:item>`，把 `href` 改写为 `mapping[unquote_recursive(href)]`（mapping 的 value 已是 OPF 相对干净路径）
- 不动 id

- [ ] **Step 2：实现替换占位**

```python
def patch_opf_manifest(tree, ns, mapping):
    for item in tree.iterfind(".//opf:manifest/opf:item", ns):
        raw = item.get("href")
        decoded = unquote_recursive(raw)
        if decoded in mapping:
            item.set("href", mapping[decoded])
```

- [ ] **Step 3：验证（对 15 卷 OPF 跑，打印前 20 项新 href）**

Run:
```bash
python3 -c "
import sys, zipfile
sys.path.insert(0, '/tmp')
from epub_clean import parse_opf, patch_opf_manifest, OPF_NS
import xml.etree.ElementTree as ET
with zipfile.ZipFile('/tmp/v15.epub') as z:
    _, tree, ns, mp = parse_opf(z)
    patch_opf_manifest(tree, ns, mp)
    items = tree.iterfind('.//opf:manifest/opf:item', ns)
    for i, it in zip(range(20), items):
        print(it.get('id'), '→', it.get('href'))
"
```
Expected:
```
TOC.xhtml → Text/TOC.xhtml
ch1.ttf → Fonts/ch1.ttf
ch2.ttf → Fonts/ch2.ttf
...
cover.jpg → Images/cover.jpg
default.css → Styles/default.css
illus0001.xhtml → Text/illus0001.xhtml
...
```

- [ ] **Step 4：快照**

```bash
cp /tmp/epub_clean.py /tmp/snapshots/epub_clean.t07.py
```

---

### Task 8：`patch_opf_metadata`

**Files:**
- Modify: `/tmp/epub_clean.py`
- Snapshot: `/tmp/snapshots/epub_clean.t08.py`

- [ ] **Step 1：约定行为**

输入：tree、ns、卷号、源 epub 路径（用于 hash 算 uuid）。
按 spec §8 表执行：
1. 删除 `id="duokan-book-id"` 和 `id="zhangyue-book-id"` 的 `dc:identifier` 节点 + 它们关联的 `<meta refines>` 节点
2. 若无 `<dc:identifier id="BookId">`，按 `urn:uuid:{md5(filename+size)[:32]}` 补
3. 若无 `<dc:rights>`，补 `voidlord`
4. 更新或补 `<meta property="dcterms:modified">` 为 `2026-05-22T00:00:00Z`
5. 若无 `<meta name="cover">`，从 manifest 找 `media-type="image/*"` 且 id 含 `cover` 的 item，补 `<meta name="cover" content="<id>"/>`

- [ ] **Step 2：实现替换占位**

```python
def patch_opf_metadata(tree, ns, vol_num, src_path):
    metadata = tree.find(".//opf:metadata", ns)
    if metadata is None:
        return  # 异常 epub，跳过
    opf_ns = OPF_NS
    dc_ns = DC_NS

    # 1. 删 duokan / zhangyue identifier + refines
    to_remove = []
    refined_ids = set()
    for ident in metadata.iterfind(f"{{{dc_ns}}}identifier"):
        idv = ident.get("id", "")
        if idv in ("duokan-book-id", "zhangyue-book-id"):
            refined_ids.add("#" + idv)
            to_remove.append(ident)
    for m in metadata.iterfind(f"{{{opf_ns}}}meta"):
        if m.get("refines") in refined_ids:
            to_remove.append(m)
    for el in to_remove:
        metadata.remove(el)

    # 2. BookId 用 uuid 占位
    has_book_id = any(
        i.get("id") == "BookId" for i in metadata.iterfind(f"{{{dc_ns}}}identifier")
    )
    if not has_book_id:
        size = Path(src_path).stat().st_size
        seed = f"{Path(src_path).name}:{size}".encode()
        uid = hashlib.md5(seed).hexdigest()
        ident = ET.SubElement(metadata, f"{{{dc_ns}}}identifier")
        ident.set("id", "BookId")
        ident.text = f"urn:uuid:{uid}"

    # 3. dc:rights
    if metadata.find(f"{{{dc_ns}}}rights") is None:
        r = ET.SubElement(metadata, f"{{{dc_ns}}}rights")
        r.text = "voidlord"

    # 4. dcterms:modified
    modified_el = None
    for m in metadata.iterfind(f"{{{opf_ns}}}meta"):
        if m.get("property") == "dcterms:modified":
            modified_el = m
            break
    if modified_el is None:
        modified_el = ET.SubElement(metadata, f"{{{opf_ns}}}meta")
        modified_el.set("property", "dcterms:modified")
    modified_el.text = "2026-05-22T00:00:00Z"

    # 5. <meta name="cover">
    has_cover_meta = any(
        m.get("name") == "cover" for m in metadata.iterfind(f"{{{opf_ns}}}meta")
    )
    if not has_cover_meta:
        # 从 manifest 找 image/* + id 含 cover
        for item in tree.iterfind(".//opf:manifest/opf:item", ns):
            mt = item.get("media-type", "")
            if mt.startswith("image/") and "cover" in item.get("id", "").lower():
                m = ET.SubElement(metadata, f"{{{opf_ns}}}meta")
                m.set("name", "cover")
                m.set("content", item.get("id"))
                break
```

- [ ] **Step 3：验证（15 卷跑一次，打印 metadata 块）**

Run:
```bash
python3 -c "
import sys, zipfile
import xml.etree.ElementTree as ET
sys.path.insert(0, '/tmp')
from epub_clean import parse_opf, patch_opf_metadata, OPF_NS, DC_NS
with zipfile.ZipFile('/tmp/v15.epub') as z:
    _, tree, ns, _ = parse_opf(z)
    patch_opf_metadata(tree, ns, 15, '/tmp/v15.epub')
    md = tree.find('.//opf:metadata', ns)
    print(ET.tostring(md, encoding='unicode')[:1500])
"
```
Expected: 输出 metadata 块。检查：
- 无 `duokan-book-id` / `zhangyue-book-id` 行
- 有 `<dc:identifier id=\"BookId\">urn:uuid:...`
- 有 `<dc:rights>voidlord</dc:rights>`
- `dcterms:modified` = `2026-05-22T00:00:00Z`
- 有 `<meta name="cover" content="cover.jpg"/>`（若原来没有）

- [ ] **Step 4：快照**

```bash
cp /tmp/epub_clean.py /tmp/snapshots/epub_clean.t08.py
```

---

### Task 9：`write_epub`

**Files:**
- Modify: `/tmp/epub_clean.py`
- Snapshot: `/tmp/snapshots/epub_clean.t09.py`

- [ ] **Step 1：约定行为**

输入：输出 epub 路径 + `{zip_path: bytes}` 字典。
- 第一项必须是 `mimetype`，内容 `application/epub+zip`，**ZIP_STORED**
- 其它文件 `ZIP_DEFLATED`
- 跳过：`META-INF/encryption.xml` / `META-INF/zhangyue-expansion.xml` / `.DS_Store` / `Thumbs.db`

- [ ] **Step 2：实现替换占位**

```python
SKIP_NAMES = {
    "META-INF/encryption.xml",
    "META-INF/zhangyue-expansion.xml",
}

def _is_junk(name):
    base = posixpath.basename(name)
    return name in SKIP_NAMES or base in (".DS_Store", "Thumbs.db") or base.startswith("._")

def write_epub(out_path, files: dict):
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_path, "w") as zout:
        # mimetype 必须第一项 + 不压缩
        zout.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        for name, data in files.items():
            if name == "mimetype" or _is_junk(name):
                continue
            zout.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)
```

- [ ] **Step 3：验证（写一个最小 epub 并用 unzip -l 看）**

Run:
```bash
python3 -c "
import sys; sys.path.insert(0, '/tmp')
from epub_clean import write_epub
write_epub('/tmp/test_min.epub', {
    'META-INF/container.xml': b'<?xml version=\"1.0\"?><container/>',
    'OEBPS/content.opf': b'<?xml version=\"1.0\"?><package/>',
})
"
unzip -l /tmp/test_min.epub
unzip -p /tmp/test_min.epub mimetype
```
Expected:
```
Length      Date    Time    Name
...
       20  ...      mimetype
```
（mimetype 列表第一项 + size=20 = `application/epub+zip` 长度）
然后 `unzip -p` 应输出 `application/epub+zip`。

- [ ] **Step 4：快照**

```bash
cp /tmp/epub_clean.py /tmp/snapshots/epub_clean.t09.py
```

---

### Task 10：`validate_output`（spec §11 自检）

**Files:**
- Modify: `/tmp/epub_clean.py`
- Snapshot: `/tmp/snapshots/epub_clean.t10.py`

- [ ] **Step 1：约定行为**

输入：输出 epub 路径。返回 `(ok: bool, issues: list[str], orphans: list[str])`。检查 8 项（spec §11），任一失败 ok=False、issues 追加描述。

- [ ] **Step 2：实现替换占位**

```python
PCT_RE = re.compile(r"%[0-9A-Fa-f]{2}")
BAD_CHARS_RE = re.compile(r"[*:|?]")

def validate_output(epub_path):
    issues = []
    orphans = []
    with zipfile.ZipFile(epub_path) as z:
        names = z.namelist()

        # 1. mimetype 第一项 + 内容 + STORED
        if not names or names[0] != "mimetype":
            issues.append("mimetype 不是第一项")
        else:
            info = z.getinfo("mimetype")
            if info.compress_type != zipfile.ZIP_STORED:
                issues.append("mimetype 被压缩")
            if z.read("mimetype") != b"application/epub+zip":
                issues.append("mimetype 内容错误")

        # 2. container.xml + 提取 OPF
        try:
            container = ET.fromstring(z.read("META-INF/container.xml"))
            rf = container.find(".//{urn:oasis:names:tc:opendocument:xmlns:container}rootfile")
            opf_path = rf.get("full-path")
        except Exception as e:
            issues.append(f"container.xml 错误: {e}")
            return False, issues, orphans

        # 3. OPF 解析 + metadata 必备项
        try:
            tree = ET.ElementTree(ET.fromstring(z.read(opf_path)))
            ns = {"opf": OPF_NS, "dc": DC_NS}
            for tag in ("title", "identifier", "language"):
                if tree.find(f".//opf:metadata/dc:{tag}", ns) is None:
                    issues.append(f"metadata 缺少 dc:{tag}")
        except Exception as e:
            issues.append(f"OPF 解析失败: {e}")
            return False, issues, orphans

        # 4. manifest 每项文件存在
        opf_dir = posixpath.dirname(opf_path)
        manifest_paths = set()
        for it in tree.iterfind(".//opf:manifest/opf:item", ns):
            href = it.get("href")
            full = posixpath.normpath(posixpath.join(opf_dir, href)) if opf_dir else href
            manifest_paths.add(full)
            if full not in names:
                issues.append(f"manifest 项不存在于 zip: {full}")

        # 5. xhtml 引用解析后存在
        for n in names:
            if not n.endswith((".xhtml", ".html")):
                continue
            try:
                root = ET.fromstring(z.read(n))
            except ET.ParseError:
                continue
            xh_dir = posixpath.dirname(n)
            for tag, attr in XHTML_ATTRS:
                for el in root.iter(tag):
                    v = el.get(attr)
                    if not v or v.startswith(("data:", "http://", "https://", "#", "mailto:", "tel:")):
                        continue
                    path = v.split("#", 1)[0]
                    target = posixpath.normpath(posixpath.join(xh_dir, path))
                    if target not in names:
                        issues.append(f"{n}: 引用 {v} → {target} 不存在")

        # 6. 无 percent-encoded 残留（在文本资源里）
        for n in names:
            if not n.endswith((".xhtml", ".html", ".css", ".opf", ".ncx")):
                continue
            text = z.read(n).decode("utf-8", errors="ignore")
            # 只检查跟我们关心字符 (*:|?) 相关的 percent encodings
            for code in ("%2A", "%3A", "%7C", "%3F"):
                if code in text:
                    issues.append(f"{n}: 含 percent 残留 {code}")
                    break

        # 7. 文件名无 *:|? 字面字符
        for n in names:
            if BAD_CHARS_RE.search(n):
                issues.append(f"文件名含混淆字符: {n}")

        # 8. 孤儿文件
        for n in names:
            if n in ("mimetype", "META-INF/container.xml", "META-INF/com.apple.ibooks.display-options.xml"):
                continue
            if n.startswith("META-INF/"):
                continue
            if n not in manifest_paths:
                orphans.append(n)

    return len(issues) == 0, issues, orphans
```

- [ ] **Step 3：验证（对 Task 9 写的最小 epub 跑，期待大量 fail，证明检查项有效）**

Run:
```bash
python3 -c "
import sys; sys.path.insert(0, '/tmp')
from epub_clean import validate_output
ok, issues, orphans = validate_output('/tmp/test_min.epub')
print('ok =', ok)
print('issues =', issues)
print('orphans =', orphans)
"
```
Expected: `ok = False`，至少能看到「OPF 解析失败」或「manifest 项不存在」类 issue（最小 epub 不完整）。这证明检查在工作。

- [ ] **Step 4：快照**

```bash
cp /tmp/epub_clean.py /tmp/snapshots/epub_clean.t10.py
```

---

### Task 11：`process_one` 串联

**Files:**
- Modify: `/tmp/epub_clean.py`
- Snapshot: `/tmp/snapshots/epub_clean.t11.py`

- [ ] **Step 1：约定行为**

输入：源 epub 路径、目标 epub 路径、卷号。流程：
1. 打开源 zip
2. `parse_opf` 得到 (opf_path, tree, ns, mapping)
3. `patch_opf_manifest(tree, ns, mapping)` + `patch_opf_metadata(tree, ns, vol_num, src)`
4. 遍历 zip 所有 entry：
   - 文本（xhtml/html）：解码 → `patch_xhtml` → 重新编码
   - ncx：`patch_ncx`
   - css：`patch_css`
   - opf：先用 `ET.tostring(tree)` 序列化为新内容（已 patch）
   - 其它二进制：原样
5. 计算新文件路径：`mapping.get(opf_relative_path, opf_relative_path)` → 拼回 `opf_dir/` 前缀
6. `write_epub(dst, files)`
7. `validate_output(dst)` 返回结果

- [ ] **Step 2：实现替换占位**

```python
TEXT_EXTS = {".xhtml", ".html", ".ncx", ".css", ".opf"}

def process_one(src, dst, vol_num):
    src = Path(src)
    dst = Path(dst)
    print(f"\n=== 处理第 {vol_num} 卷: {src.name} ===")
    with zipfile.ZipFile(src) as zin:
        opf_path, opf_tree, ns, mapping = parse_opf(zin)
        opf_dir = posixpath.dirname(opf_path)

        # 先 patch OPF
        patch_opf_manifest(opf_tree, ns, mapping)
        patch_opf_metadata(opf_tree, ns, vol_num, src)

        files = {}
        for name in zin.namelist():
            data = zin.read(name)
            ext = posixpath.splitext(name)[1].lower()

            # 计算新名
            if opf_dir and name.startswith(opf_dir + "/"):
                rel = name[len(opf_dir) + 1:]
            else:
                rel = name if not opf_dir else None  # META-INF 等顶层
            new_name = name
            if rel and rel in mapping:
                new_name = (opf_dir + "/" + mapping[rel]) if opf_dir else mapping[rel]

            # 文本类按扩展名分派
            if ext == ".opf":
                # 用已 patch 的 tree 序列化
                new_bytes = b'<?xml version="1.0" encoding="utf-8"?>\n' + ET.tostring(
                    opf_tree.getroot(), encoding="utf-8"
                )
                files[new_name] = new_bytes
                continue
            if ext in (".xhtml", ".html"):
                base = posixpath.dirname(rel or name)
                text = data.decode("utf-8")
                files[new_name] = patch_xhtml(text, mapping, base).encode("utf-8")
                continue
            if ext == ".ncx":
                base = posixpath.dirname(rel or name)
                files[new_name] = patch_ncx(data.decode("utf-8"), mapping, base).encode("utf-8")
                continue
            if ext == ".css":
                base = posixpath.dirname(rel or name)
                files[new_name] = patch_css(data.decode("utf-8"), mapping, base).encode("utf-8")
                continue
            # 二进制
            files[new_name] = data

    write_epub(dst, files)
    ok, issues, orphans = validate_output(dst)
    status = "✅" if ok else "❌"
    print(f"  {status} {dst.name}  size={dst.stat().st_size:,}  issues={len(issues)}  orphans={len(orphans)}")
    for i in issues[:5]:
        print(f"     - {i}")
    if len(issues) > 5:
        print(f"     - ... 还有 {len(issues) - 5} 条")
    return ok, issues, orphans
```

- [ ] **Step 3：验证（对 15 卷做完整端到端 dry run）**

Run:
```bash
python3 -c "
import sys; sys.path.insert(0, '/tmp')
from epub_clean import process_one
process_one(
    '/Users/liuzhuo/Downloads/义妹生活/unlocked/[三河ごーすと].义妹生活.15.[日翻].unlocked.epub',
    '/tmp/v15.clean.epub',
    15,
)
"
unzip -l /tmp/v15.clean.epub | head -10
echo '---'
unzip -l /tmp/v15.clean.epub | tail -5
```
Expected: 打印 `✅` 通过、size 与原 epub 同量级（~3.7MB）、issues=0、orphans=0 或很少。unzip 列出前几项应为 `mimetype`、`META-INF/...`、`OEBPS/content.opf` 等干净名。

- [ ] **Step 4：快照**

```bash
cp /tmp/epub_clean.py /tmp/snapshots/epub_clean.t11.py
```

---

### Task 12：`main` + 首卷集成验证

**Files:**
- Modify: `/tmp/epub_clean.py`
- Snapshot: `/tmp/snapshots/epub_clean.t12.py`

- [ ] **Step 1：约定行为**

`main()` 遍历 `VOLS`，对每卷算 src/dst 路径调 `process_one`，最后打印 5 卷汇总表。

- [ ] **Step 2：实现替换占位**

```python
def main():
    DST_DIR.mkdir(parents=True, exist_ok=True)
    results = []
    for n in VOLS:
        src = SRC_DIR / SRC_TEMPLATE.format(n=n)
        dst = DST_DIR / DST_TEMPLATE.format(n=n)
        if not src.exists():
            print(f"\n⚠️  跳过第 {n} 卷：源文件不存在 {src}")
            results.append((n, False, ["源文件不存在"], []))
            continue
        try:
            ok, issues, orphans = process_one(src, dst, n)
            results.append((n, ok, issues, orphans))
        except Exception as e:
            print(f"\n❌ 第 {n} 卷异常: {e!r}")
            results.append((n, False, [repr(e)], []))

    print("\n=== 5 卷汇总 ===")
    print(f"{'卷':>4} {'状态':>4} {'issues':>8} {'orphans':>8}")
    for n, ok, issues, orphans in results:
        flag = "✅" if ok else "❌"
        print(f"{n:>4} {flag:>4} {len(issues):>8} {len(orphans):>8}")
```

- [ ] **Step 3：先只跑首卷集成测试**

把 `VOLS` 临时改为 `[15]`，跑：
```bash
sed -i.bak 's/^VOLS = \[11, 12, 13, 14, 15\]/VOLS = [15]  # tmp single-volume integration test/' /tmp/epub_clean.py
python3 /tmp/epub_clean.py
```
Expected:
```
=== 处理第 15 卷: ...epub ===
  ✅ ...clean.epub  size=3,...  issues=0  orphans=0

=== 5 卷汇总 ===
  卷  状态   issues  orphans
  15   ✅        0        0
```

如果有 issues，对照打印的具体 issue 修对应的 patch_* 函数，不要硬性继续。

- [ ] **Step 4：恢复 VOLS、保存快照**

```bash
mv /tmp/epub_clean.py.bak /tmp/epub_clean.py
# 或手动改回 VOLS = [11, 12, 13, 14, 15]
cp /tmp/epub_clean.py /tmp/snapshots/epub_clean.t12.py
```

---

### Task 13：跑全部 5 卷

**Files:**
- Inputs: 5 个 `.unlocked.epub`
- Outputs: 5 个 `.clean.epub`

- [ ] **Step 1：确认 `VOLS = [11, 12, 13, 14, 15]`**

Run:
```bash
grep "^VOLS" /tmp/epub_clean.py
```
Expected: `VOLS = [11, 12, 13, 14, 15]`

- [ ] **Step 2：跑全量**

```bash
python3 /tmp/epub_clean.py
```
Expected: 5 卷各一行 `✅`，最终汇总表 5 行全 `✅`、`issues=0`。

如果有卷 ❌：打印 issue 已经会提示具体问题。常见可能：
- 第 12 卷在前阶段已经发现只有 `zhangyue-expansion.xml` 没有 `encryption.xml`，处理流程不变
- 某卷 `<dc:identifier id="BookId">` 已存在 → 第 8 节逻辑会保留，不影响

不阻塞失败卷，继续处理其它。

- [ ] **Step 3：检查输出目录**

```bash
ls -la /Users/liuzhuo/Downloads/义妹生活/unlocked/clean/
```
Expected: 5 个 `.clean.epub` 文件，size 与对应 `.unlocked.epub` 相近（可能小 1-3 KB，去掉了 encryption.xml）。

- [ ] **Step 4：快照**

```bash
cp /tmp/epub_clean.py /tmp/snapshots/epub_clean.t13.py
```

---

### Task 14：人工 Sigil 抽样验证

**Files:** （只看，不写）

- [ ] **Step 1：让用户用 Sigil 打开 11 和 15 卷抽样**

把以下检查清单交给用户（**用 AskUserQuestion 工具**，按 CLAUDE.md 全局规则）。要他用 Sigil 打开：

- `/Users/liuzhuo/Downloads/义妹生活/unlocked/clean/[三河ごーすと].义妹生活.11.[日翻].clean.epub`
- `/Users/liuzhuo/Downloads/义妹生活/unlocked/clean/[三河ごーすと].义妹生活.15.[日翻].clean.epub`

逐项确认：
1. Sigil 打开时是否还报 DRM？（期望：不报）
2. 资源浏览器里 Text/ Images/ Fonts/ Styles/ Misc/ 下文件名是否都是 `chapter0001.xhtml`、`cover.jpg`、`ch1.ttf`、`default.css`、`script.js` 这种干净语义名？（期望：是）
3. 预览面板能否显示封面图？随便点一张 illus 插图能否显示？（期望：能）
4. 打开 `chapter0001.xhtml` 预览，正文文字是否正常显示？（期望：是）
5. （可选）在多看里加载，封面/插图能否单击放大全屏？（期望：能）

- [ ] **Step 2：收集反馈**

如果有任意一项不达预期，记录现象、修对应的 patch_* 函数，回到 Task 11/12 重跑该卷。

- [ ] **Step 3：清理 /tmp 工件（可选）**

```bash
# 保留 epub_clean.py 与 snapshots 用于后续 reference
rm -rf /tmp/epub07 /tmp/epub11 /tmp/epub15 /tmp/epub15-2 /tmp/v15.epub /tmp/v11.epub /tmp/v07.epub /tmp/v15.clean.epub /tmp/test_min.epub /tmp/default.15.new.css
```

- [ ] **Step 4：任务完成**

向用户汇报 5 卷处理结果与抽样验证结论。

---

## Self-Review（写完计划后回读检查）

**1. Spec 覆盖性**

| Spec 节 | 对应 Task | 覆盖度 |
|---|---|---|
| §5 模块切分 | T0 骨架 + T1-T12 各模块 | ✅ 完整 |
| §6 反混淆映射 | T2 parse_opf | ✅ |
| §7.1 xhtml 引用替换 | T4 patch_xhtml | ✅ |
| §7.2 CSS 替换 | T6 patch_css | ✅ |
| §7.3 NCX | T5 patch_ncx | ✅ |
| §7.4 OPF manifest | T7 patch_opf_manifest | ✅ |
| §8 元数据补齐 | T8 patch_opf_metadata | ✅ |
| §9 输出包装 | T9 write_epub | ✅ |
| §10 边界处理 | 散见 T1/T3/T8（双层 unquote、xlink、id 无扩展名） | ✅ |
| §11 验证清单 | T10 validate_output | ✅ |
| §12 不变量 | 自然遵守（patch_* 只动引用） | ✅ |
| §14 产物清单 | T13 输出 | ✅ |
| §15 跑法 | T12 main + T13 全跑 | ✅ |

**2. Placeholder 扫描**：本计划全部 14 个 task 每步都给了完整代码、完整命令、完整预期输出。无 TBD / TODO / "implement later" 字眼。

**3. 类型一致性**：
- `parse_opf` 返回 `(opf_path, tree, ns, mapping)` — 在 T7/T8/T11 都按这个 4-元组解构
- `patch_xhtml/patch_ncx/patch_css` 三个签名一致：`(text, mapping, base) -> text`
- `validate_output` 返回 `(ok, issues, orphans)` — 在 T11/T12 都按 3-元组解构
- `remap_path(href, mapping, base="")` 默认 base 空串 — 在 T7/T8 不显式传 base 时一致

**4. 修复**：自审无需修补。

---

## Execution Handoff

**Plan complete and saved to** `/Users/liuzhuo/Downloads/义妹生活/docs/superpowers/plans/2026-05-22-epub-deobfuscate-clean.md`

两种执行方式：

**1. Subagent-Driven（推荐）** — 每个 task 派发一个新 subagent 实现，主线程在 task 间 review。适合需要严格隔离上下文、加速迭代的场景。
**REQUIRED SUB-SKILL:** `superpowers:subagent-driven-development`

**2. Inline Execution** — 在当前会话里按 task 顺序执行，每个检查点 review。适合任务规模小、不想切换上下文的场景。
**REQUIRED SUB-SKILL:** `superpowers:executing-plans`

哪个？
