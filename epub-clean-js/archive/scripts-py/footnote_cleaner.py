"""注释清洗到 STERA 格式。

从 ``Footnote`` 对象生成 STERA 标准的注释结构：
    - sup inline：插入译文段落内的 ``<sup><a><img/></a></sup>``
    - aside block：章节末尾汇总的 ``<aside epub:type="footnote">...</aside>``

注意：
- 新 id 采用 ``noteNNN`` / ``note_refNNN`` 三位补零方案（``new_id_number`` 从 1 起）。
- 严格丢弃 DST 原有的 ``calibre`` / ``pcalibre`` 类名残留，只输出 STERA 类名。
- 保留 ``img_filename`` 原值（note.webp / note1.webp），让上层用图区分注释类型。
- ``zy-footnote`` 属性使用 ``html.escape(text, quote=True)`` 转义，避免破坏属性边界。
"""

from html import escape

from scripts.footnote_extractor import Footnote


def build_stera_footnote(fn: Footnote, new_id_number: int) -> tuple[str, str]:
    """V8 权威多端兼容结构。

    综合 EpubFootnoteAdapter + xiaowang266 教程 + 多看官方规范：
    - 锚点用 <sub><a class="duokan-footnote" epub:type="noteref">
    - img 加 width="25" + class="zhangyue-footnote" + zy-footnote 属性（掌阅）
    - aside 在 body 顶层（不包 <note> 容器）
    - aside 内 <ol class="duokan-footnote-content" style="list-style:none">
    - <li class="duokan-footnote-item" id="同 aside id">（Duplicate ID 但功能必须）
    - li 内 <p><a href="#ref">注N</a>：注释正文</p> 反向链接

    经多看 / 掌阅 / Kindle / Apple Books / Calibre 多端验证（V8 测试 EPUB）。
    """
    new_id = f"note{new_id_number:03d}"
    ref_id = f"note_ref{new_id_number:03d}"

    sup_html = (
        f'<sub><a class="duokan-footnote" epub:type="noteref" '
        f'href="#{new_id}" id="{ref_id}">'
        f'<img width="25" alt="note" class="zhangyue-footnote" '
        f'src="../Images/{fn.img_filename}" '
        f'zy-footnote="{escape(fn.text, quote=True)}"/></a></sub>'
    )

    aside_html = (
        f'<aside epub:type="footnote" id="{new_id}">'
        f'<ol class="duokan-footnote-content" style="list-style:none">'
        f'<li class="duokan-footnote-item" id="{new_id}">'
        f'<p><a href="#{ref_id}">注{new_id_number}</a>：{escape(fn.text)}</p>'
        f'</li>'
        f'</ol>'
        f'</aside>'
    )

    return sup_html, aside_html
