from pathlib import Path
from lxml import etree

NS = "{http://www.w3.org/1999/xhtml}"


def extract_paragraphs(xhtml_path: Path) -> list[str]:
    """从 XHTML 抽取**正文**段落纯文本列表。

    规则：
    - 仅取 <p> 元素，按文档顺序
    - **跳过 aside 内的 p**（注释正文，由 footnote_extractor 单独处理，不算正文段落）
    - 去前后空白
    - 跳过空段落
    - ruby/rt 标签：保留 ruby 文本，丢弃 rt 注音
    - sup 标签：保留文本（注释定位时再用）
    """
    tree = etree.parse(str(xhtml_path))
    paragraphs: list[str] = []
    for p in tree.iter(f"{NS}p"):
        # 跳过 aside 祖先内的 p（注释正文）
        ancestor = p.getparent()
        in_aside = False
        while ancestor is not None:
            if ancestor.tag == f"{NS}aside":
                in_aside = True
                break
            ancestor = ancestor.getparent()
        if in_aside:
            continue

        # 丢掉所有 rt 子节点的文本
        for rt in p.iter(f"{NS}rt"):
            rt.getparent().remove(rt)
        text = "".join(p.itertext()).strip()
        if text:
            paragraphs.append(text)
    return paragraphs
