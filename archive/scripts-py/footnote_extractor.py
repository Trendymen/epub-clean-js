"""DST 注释抽取。

解析 DST 章节 XHTML 中的注释结构：
    <sup><a class="duokan-footnote" href="#noteXXX">
        <img zy-footnote="注释正文" src=".../note.webp"/>
    </a></sup>
    ...
    <aside epub:type="footnote" id="noteXXX">...</aside>

为每条注释生成 ``Footnote`` 记录，包含足以在译文段落中重新定位 sup 位置的
上下文信息（host 段落索引、段落纯文本、sup 字符偏移、前后 30 字上下文）。
"""

from dataclasses import dataclass
from pathlib import Path

from lxml import etree

NS = "{http://www.w3.org/1999/xhtml}"
P_TAG = f"{NS}p"
SUP_TAG = f"{NS}sup"
A_TAG = f"{NS}a"
IMG_TAG = f"{NS}img"
RT_TAG = f"{NS}rt"
RP_TAG = f"{NS}rp"
ASIDE_TAG = f"{NS}aside"

CTX_RADIUS = 30


@dataclass
class Footnote:
    """单条 DST 注释的定位与正文信息。

    后续 Task 7（footnote_relocator）会用 ``host_para_index`` / ``sup_offset``
    /``before_ctx``/``after_ctx`` 在译文里 fuzzy 匹配回写位置；Task 8
    (footnote_cleaner) 会用 ``text``/``img_filename`` 清洗到 STERA 模板。
    """

    original_id: str           # 原 DST id，如 "note001"
    text: str                  # 注释正文文本
    img_filename: str          # "note.webp" 或 "note1.webp"
    host_para_text: str        # 注释所在段落的纯文本（已去 ruby/sup/aside）
    host_para_index: int       # 在 DST 该章节 <p> 列表中的索引（0-based）
    sup_offset: int            # sup 在 host_para_text 中的字符偏移
    before_ctx: str            # sup 前 ±30 字
    after_ctx: str             # sup 后 ±30 字


def extract_footnotes(xhtml_path: Path) -> list[Footnote]:
    """从 DST XHTML 抽取所有注释，含定位上下文。"""
    tree = etree.parse(str(xhtml_path))
    root = tree.getroot()

    # 编号正文段落（跳过 aside 内的 p，与 paragraph_extractor 索引体系保持一致）。
    # sup 不会出现在 aside 内（aside 是注释正文容器），所以 host_p 必然在正文 p 列表里。
    # 若两端用不一致的 p 序列，host_para_index 会比 align_pairs 用的 DST 索引偏大，
    # 导致 fuzzy 反查 SRC 时落到完全错误的段。
    all_paras: list = []
    for p in root.iter(P_TAG):
        anc = p.getparent()
        in_aside = False
        while anc is not None:
            if anc.tag == ASIDE_TAG:
                in_aside = True
                break
            anc = anc.getparent()
        if not in_aside:
            all_paras.append(p)
    para_index = {p: i for i, p in enumerate(all_paras)}

    notes: list[Footnote] = []
    for sup in root.iter(SUP_TAG):
        a = sup.find(A_TAG)
        if a is None or "duokan-footnote" not in (a.get("class") or ""):
            continue
        img = a.find(IMG_TAG)
        if img is None:
            continue
        zy = img.get("zy-footnote") or ""
        img_src = img.get("src", "")
        img_filename = Path(img_src).name  # "note.webp" / "note1.webp"

        # 向上找 sup 所在的 <p>。
        host_p = sup.getparent()
        while host_p is not None and host_p.tag != P_TAG:
            host_p = host_p.getparent()
        if host_p is None or host_p not in para_index:
            continue

        # 算 sup 在段落纯文本中的偏移（已剥离 ruby/sup/aside 子树）。
        host_para_text, sup_offset = _text_and_sup_offset(host_p, sup)

        before_ctx = host_para_text[max(0, sup_offset - CTX_RADIUS):sup_offset]
        after_ctx = host_para_text[sup_offset:sup_offset + CTX_RADIUS]

        href = a.get("href", "")
        note_id = href.split("#", 1)[1] if "#" in href else ""

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


# 段落纯文本拼接时跳过的子树标签：
#   - rt/rp：ruby 注音（日文振假名），段落主文本不含它们
#   - sup：脚注角标自身（含 img），sup 在文本里只占一个「位置」不贡献字符
#   - aside：DST 把脚注内容 aside 节点放在 host <p>/<note> 内部时，
#     里面是注释正文不属于段落主文本
_SKIP_SUBTREE_TAGS = {RT_TAG, RP_TAG, SUP_TAG, ASIDE_TAG}


def _text_and_sup_offset(p_elem, sup_elem) -> tuple[str, int]:
    """返回 ``(段落纯文本, sup 在文本中的字符偏移)``。

    采用 ``etree.iterwalk`` 在 ``p_elem`` 子树上做 start/end 双事件遍历：

    * start 事件：若是目标 ``sup_elem``，记录当前 ``len(text_so_far)`` 为
      sup_offset，并标记进入跳过子树；否则把 ``elem.text`` 拼到结果里。
    * end 事件：把 ``elem.tail`` 拼到结果里（``p_elem`` 自身的 tail 不算）。
    * 进入 ``_SKIP_SUBTREE_TAGS`` 中的子树后，子树内的 text/tail 都不计；
      子树根 end 时解除跳过标记，**但** sup 等子树根的 tail 仍要拼进来
      （sup 的 tail 是 sup 后紧跟的段落文本）。
    """
    parts: list[str] = []
    offset = -1
    skip_root = None  # 当前正在跳过的子树根；非 None 时所有 text/tail 都忽略

    for event, elem in etree.iterwalk(p_elem, events=("start", "end")):
        if event == "start":
            if elem is sup_elem and skip_root is None:
                offset = sum(len(s) for s in parts)
            if skip_root is not None:
                continue
            if elem.tag in _SKIP_SUBTREE_TAGS and elem is not p_elem:
                skip_root = elem
                continue
            if elem.text:
                parts.append(elem.text)
        else:  # end
            if skip_root is not None:
                if elem is skip_root:
                    skip_root = None
                    # 跳过子树根的 tail 仍属于段落主文本，需要拼进来。
                    if elem is not p_elem and elem.tail:
                        parts.append(elem.tail)
                continue
            # p_elem 自身的 tail 属于段落外，不计入。
            if elem is not p_elem and elem.tail:
                parts.append(elem.tail)

    return "".join(parts), max(offset, 0)
