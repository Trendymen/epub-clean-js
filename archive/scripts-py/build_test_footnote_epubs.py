"""生成 5 个注释结构测试 EPUB，用于在各阅读器实测兼容性。

每个 EPUB 只有 1 段正文 + 1 个注释，唯一变量是「注释结构 HTML」。
跑：.venv/bin/python -m scripts.build_test_footnote_epubs
"""
import shutil
import zipfile
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[2] / "test/fixtures/footnote_epubs"
OUT_DIR.mkdir(parents=True, exist_ok=True)
NOTE_IMG = OUT_DIR / "note.webp"  # 多看私有 img 图标
SCRIPT_JS = OUT_DIR / "script.js"  # 多看注释弹层逻辑（已拷自 DST）

# ============== 5 个注释结构变体 ==============

# V1：纯 EPUB 3 标准，最严格，零私有扩展
V1 = {
    "name": "V1-strict-epub3-pure",
    "desc": "纯 EPUB 3 标准：<sup><a noteref> + <aside footnote>，零私有扩展",
    "html_body": """<p>这是测试段落。这里是一个标准 EPUB 3 注释 <sup><a epub:type="noteref" href="#note01">[1]</a></sup>，点上面的 [1] 应该弹出或跳转到注释。</p>
<aside epub:type="footnote" id="note01"><p>这是注释正文。如果你在阅读器里看到这段话弹出（或点 [1] 后能看到），说明该阅读器支持 EPUB 3 footnote 标准。</p></aside>""",
    "use_img": False,
}

# V2：EPUB 3 + ARIA DPUB role（最严格、最现代）
V2 = {
    "name": "V2-strict-epub3-aria",
    "desc": "EPUB 3 + ARIA role（doc-noteref / doc-footnote），最严格",
    "html_body": """<p>这是测试段落。这里是一个带 ARIA role 的 EPUB 3 注释 <sup><a epub:type="noteref" role="doc-noteref" href="#note01">[1]</a></sup>，点上面的 [1] 应该弹出或跳转到注释。</p>
<aside epub:type="footnote" role="doc-footnote" id="note01"><p>这是注释正文（带 ARIA role）。如果弹出说明阅读器支持 EPUB 3 + ARIA DPUB。</p></aside>""",
    "use_img": False,
}

# V3：多看最小扩展（无 <note> 容器、无 Duplicate ID、含 duokan-footnote class + img）
V3 = {
    "name": "V3-duokan-minimal",
    "desc": "多看私有扩展最小集：duokan-footnote class + img zy-footnote + aside 同 body 顶层（无 note 容器、无 Duplicate ID）",
    "html_body": """<p>这是测试段落。这里是多看最小扩展注释<sup><a class="duokan-footnote" epub:type="noteref" href="#note01" id="note_ref01"><img alt="note" class="zhangyue-footnote" src="../Images/note.webp" zy-footnote="这是 zy-footnote 内联属性内容"/></a></sup>，点上面的「注」图标应该弹出注释。</p>
<aside epub:type="footnote" id="note01"><a href="#note_ref01"> <ol class="duokan-footnote-content"><li class="duokan-footnote-item" value="01"><p>这是注释正文（多看最小扩展）。如果在多看/掌阅里点「注」图标能弹出这段话，说明扩展生效。</p></li></ol></a></aside>""",
    "use_img": True,
}

# V4：STERA / clean15 完整同款（含 <note> 容器嵌套 + Duplicate ID + a 包 ol）
V4 = {
    "name": "V4-stera-clean15-full",
    "desc": "STERA / 11 卷 clean 完整同款：<note> 包 p+aside、a 包 ol、li 同 id（Duplicate ID 故意）",
    "html_body": """<note>
<p>这是测试段落。这里是 STERA 完整结构注释<sup><a class="duokan-footnote" epub:type="noteref" href="#note01" id="note_ref01"><img alt="note" class="zhangyue-footnote" src="../Images/note.webp" zy-footnote="这是 zy-footnote 内联属性内容"/></a></sup>，点上面的「注」图标应该弹出注释。</p>
<aside epub:type="footnote" id="note01"><a href="#note_ref01"> <ol class="duokan-footnote-content"><li class="duokan-footnote-item" id="note01" value="01"><p>这是注释正文（STERA 完整同款）。这是当前 09 卷使用的结构。</p></li></ol></a></aside>
</note>""",
    "use_img": True,
}

# V5：STERA 折中（含 <note> 容器，但 li 不加 id 避免 Duplicate ID）
V5 = {
    "name": "V5-stera-no-dup-id",
    "desc": "STERA 折中：含 <note> 容器、a 包 ol，但 li 去掉 id 避免 Duplicate ID（epubcheck 更干净）",
    "html_body": """<note>
<p>这是测试段落。这里是 STERA 折中结构注释<sup><a class="duokan-footnote" epub:type="noteref" href="#note01" id="note_ref01"><img alt="note" class="zhangyue-footnote" src="../Images/note.webp" zy-footnote="这是 zy-footnote 内联属性内容"/></a></sup>，点上面的「注」图标应该弹出注释。</p>
<aside epub:type="footnote" id="note01"><a href="#note_ref01"> <ol class="duokan-footnote-content"><li class="duokan-footnote-item" value="01"><p>这是注释正文（STERA 折中：li 无 id，比 V4 少 1 个 epubcheck 错误）。</p></li></ol></a></aside>
</note>""",
    "use_img": True,
}


# V6：双兼容（V3 扁平多看私有 + V2 ARIA role），目标同时满足多看+AppleBooks
V6 = {
    "name": "V6-dual-compat",
    "desc": "双兼容方案：V3 多看私有扩展 + V2 ARIA role（无 <note> 容器、无 Duplicate ID）",
    "html_body": """<p>这是测试段落。这里是 V6 双兼容注释<sup><a class="duokan-footnote" epub:type="noteref" role="doc-noteref" href="#note01" id="note_ref01"><img alt="note" class="zhangyue-footnote" src="../Images/note.webp" zy-footnote="这是 zy-footnote 内联属性内容"/></a></sup>，点上面的「注」图标应该弹出注释。</p>
<aside epub:type="footnote" role="doc-footnote" id="note01"><a href="#note_ref01"> <ol class="duokan-footnote-content"><li class="duokan-footnote-item" value="01"><p>这是注释正文（V6 双兼容方案）。理论上多看 + 掌阅 + Apple Books 都应该能弹出。</p></li></ol></a></aside>""",
    "use_img": True,
}

# V7：V4 基础上叠加 ARIA role（V4 多看 OK + ARIA Apple Books 友好），最稳双兼容候选
V7 = {
    "name": "V7-stera-full-with-aria",
    "desc": "V4 完整结构 + ARIA role（<note> 包+li id+a 包 ol+role doc-noteref/footnote），双兼容首选候选",
    "html_body": """<note>
<p>这是测试段落。这里是 V7 双兼容注释<sup><a class="duokan-footnote" epub:type="noteref" role="doc-noteref" href="#note01" id="note_ref01"><img alt="note" class="zhangyue-footnote" src="../Images/note.webp" zy-footnote="这是 zy-footnote 内联属性内容"/></a></sup>，点上面的「注」图标应该弹出注释。</p>
<aside epub:type="footnote" role="doc-footnote" id="note01"><a href="#note_ref01"> <ol class="duokan-footnote-content"><li class="duokan-footnote-item" id="note01" value="01"><p>这是注释正文（V7：V4 完整 + ARIA role）。理论上多看 / 掌阅 / Apple Books 都应该能弹出。</p></li></ol></a></aside>
</note>""",
    "use_img": True,
}

# V8：基于 3 个权威源（EpubFootnoteAdapter、xiaowang266、多看官方）综合的真·多端兼容模板
# 关键点：无 <note> 容器、a 不包 ol、ol 含 list-style:none、img 用 width 属性
V8 = {
    "name": "V8-authoritative-cross-platform",
    "desc": "权威多端兼容（多看+掌阅+Kindle+iBooks/AppleBooks）：无 note 容器、aside 顶层、ol 列表反向链接",
    "html_body": """<p>这是测试段落。这里是 V8 权威多端兼容注释<sub><a class="duokan-footnote" epub:type="noteref" href="#note01" id="note_ref01"><img width="25" alt="note" class="zhangyue-footnote" src="../Images/note.webp" zy-footnote="这是 zy-footnote 内联属性内容"/></a></sub>，点上面的「注」图标应该弹出注释。</p>
<aside epub:type="footnote" id="note01">
<ol class="duokan-footnote-content" style="list-style:none">
<li class="duokan-footnote-item" id="note01"><p><a href="#note_ref01">注1</a>：这是注释正文（V8 权威多端兼容方案）。源：EpubFootnoteAdapter + xiaowang266 教程 + 多看官方规范。理论上多看 / 掌阅 / Kindle / Apple Books / Calibre Viewer 都应该弹出。</p></li>
</ol>
</aside>""",
    "use_img": True,
}

VARIANTS = [V1, V2, V3, V4, V5, V6, V7, V8]


def make_test_xhtml(variant: dict) -> str:
    # inline STERA 关键样式：让注图标在文字行内显示（1.2em 小图标，不撑大）
    # 加 aside 边框便于可视化（实际 STERA 也是这样）
    inline_css = """
.zhangyue-footnote{vertical-align:top;height:1.2em !important;width:auto;border:0;}
.duokan-footnote{height:1.2em !important;width:auto;border:0;}
sup,sup *{cursor:help;}
sup{font-size:0.75em;line-height:1.2;vertical-align:super !important;z-index:1;}
aside{border:3px #333 double;margin:0 2em;border-radius:10px;background-color:#fcfcfc;}
aside ol{margin:0.2em auto;padding:0 0.5em;list-style:none !important;}
aside p{margin-left:2em;text-indent:-2em;}
note{display:block;width:100%;}
"""
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh">
<head>
<title>注释测试 {variant['name']}</title>
<style>{inline_css}</style>
</head>
<body>
<h1>{variant['name']}</h1>
<p style="color:#666;font-size:0.9em;border-left:3px solid #ccc;padding-left:8px;">{variant['desc']}</p>
<hr/>
{variant['html_body']}
</body>
</html>
"""


def make_content_opf(variant: dict) -> str:
    items_extra = ""
    if variant["use_img"]:
        items_extra = '\n    <item id="note-img" href="Images/note.webp" media-type="image/webp"/>'
    return f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId" prefix="duokan-page: http://www.duokan.com/duokan-page/">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>注释测试 {variant['name']}</dc:title>
    <dc:creator>测试</dc:creator>
    <dc:language>zh</dc:language>
    <dc:identifier id="BookId">urn:uuid:test-{variant['name']}</dc:identifier>
    <meta property="dcterms:modified">2026-05-22T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="Text/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="test" href="Text/test.xhtml" media-type="application/xhtml+xml"/>{items_extra}
  </manifest>
  <spine toc="ncx">
    <itemref idref="test"/>
  </spine>
</package>
"""


def make_ncx(variant: dict) -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="urn:uuid:test-{variant['name']}"/></head>
<docTitle><text>注释测试 {variant['name']}</text></docTitle>
<navMap>
<navPoint id="np1" playOrder="1"><navLabel><text>测试页</text></navLabel><content src="Text/test.xhtml"/></navPoint>
</navMap>
</ncx>
"""


NAV_XHTML = """<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh">
<head><title>目录</title></head>
<body><nav epub:type="toc"><ol><li><a href="test.xhtml">测试页</a></li></ol></nav></body>
</html>
"""

CONTAINER_XML = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>
"""


def pack_epub(variant: dict) -> Path:
    out_path = OUT_DIR / f"{variant['name']}.epub"
    with zipfile.ZipFile(out_path, "w") as zf:
        # mimetype 必须最先且 STORED
        zf.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        zf.writestr("META-INF/container.xml", CONTAINER_XML, compress_type=zipfile.ZIP_DEFLATED)
        zf.writestr("OEBPS/content.opf", make_content_opf(variant), compress_type=zipfile.ZIP_DEFLATED)
        zf.writestr("OEBPS/toc.ncx", make_ncx(variant), compress_type=zipfile.ZIP_DEFLATED)
        zf.writestr("OEBPS/Text/test.xhtml", make_test_xhtml(variant), compress_type=zipfile.ZIP_DEFLATED)
        zf.writestr("OEBPS/Text/nav.xhtml", NAV_XHTML, compress_type=zipfile.ZIP_DEFLATED)
        if variant["use_img"]:
            if NOTE_IMG.exists():
                zf.write(NOTE_IMG, "OEBPS/Images/note.webp", compress_type=zipfile.ZIP_DEFLATED)
    return out_path


def main():
    print(f"输出目录：{OUT_DIR}\n")
    for v in VARIANTS:
        path = pack_epub(v)
        size = path.stat().st_size
        print(f"  ✓ {v['name']}.epub  ({size} bytes)")
        print(f"    {v['desc']}\n")

    # 写一份测试说明
    readme = OUT_DIR / "README.md"
    lines = ["# 注释结构兼容性测试 EPUB\n",
             "5 个 EPUB 文件，唯一变量是注释结构 HTML。每个文件只有 1 段正文 + 1 个注释。\n",
             "## 测试矩阵\n",
             "| 阅读器 | V1 纯 EPUB3 | V2 EPUB3+ARIA | V3 多看最小 | V4 STERA 完整 | V5 STERA 无 DupId |",
             "|---|---|---|---|---|---|",
             "| 多看 Reader |  |  |  |  |  |",
             "| 掌阅 iReader |  |  |  |  |  |",
             "| Apple Books / iBooks |  |  |  |  |  |",
             "| Calibre Viewer |  |  |  |  |  |",
             "| koreader |  |  |  |  |  |",
             "| Kindle Previewer |  |  |  |  |  |",
             "| 其他 |  |  |  |  |  |",
             "\n填表说明：✅ 弹出注释正文 / ⚠ 跳转到 aside 但无弹层 / ❌ 完全不显示\n",
             "## 5 个变体说明\n"]
    for v in VARIANTS:
        lines.append(f"### {v['name']}\n{v['desc']}\n")
    readme.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n  📝 测试说明：{readme}")


if __name__ == "__main__":
    main()
