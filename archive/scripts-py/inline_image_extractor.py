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
