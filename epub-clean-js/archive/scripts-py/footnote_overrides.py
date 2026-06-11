"""注释定位人工 override 表。

程序模糊匹配（footnote_relocator V3）对译文风格差异较大的注释命中率有限。
对人工逐条比对 DST/SRC 确认过的注释，用本表直接指定 SRC 段索引 + 锚定文本，
relocator 跳过 fuzzy 直接落到正确位置。

Key 设计：
    (src_chapter_num: int, note_local_idx_1based: int)
    note_local_idx 与 chapter_renderer 里 ``new_id_num``（即 STERA noteNNN 的数字）一致。

Value 设计：
    (src_para_idx: int, anchor_text: str | None)
    - src_para_idx：在 ``paragraph_extractor.extract_paragraphs`` 返回列表中的索引
      （chapter1 已切掉首段引言，与 migrate_chapters 行为一致）。
    - anchor_text：在该段中查找的子串；sup 插入位置 = 子串末尾。
      为 None 时插在段末。

数据于 2026-05-22 人工对照 SRC（义妹生活 09 台版）和 DST（[三河ごーすと] 日翻 09 注释）整理。
"""
from __future__ import annotations

OVERRIDES: dict[tuple[int, int], tuple[int, str | None]] = {
    (1, 1):  (439, None),               # 评：学习方法 → 段末
    (3, 1):  (207, "五月晴"),            # 注：五月晴れ
    (3, 2):  (308, "莫非定律"),          # 评：墨菲定律
    (3, 3):  (337, "织布"),              # 注：仙鹤的报恩
    (4, 1):  (209, "挤成一团"),          # 注：押し競饅頭
    (7, 1):  (365, "取平均"),            # 评：平均值取样
    (10, 1): (55, "夜来祭"),             # 评：佞武多祭等
    (11, 1): (183, "三坏球一好球"),      # 注：棒球满球数
    (12, 1): (94, "类比讯号关闭"),       # 注：模拟电视关停
    (12, 2): (118, "前缀"),              # 注：枕词
}


def lookup_override(
    chapter_num: int, note_local_idx: int, src_paragraphs: list[str],
) -> tuple[int, int] | None:
    """返回 (src_para_idx, src_char_offset)，未命中则返回 None。"""
    key = (chapter_num, note_local_idx)
    if key not in OVERRIDES:
        return None
    src_idx, anchor = OVERRIDES[key]
    if src_idx < 0 or src_idx >= len(src_paragraphs):
        return None
    text = src_paragraphs[src_idx]
    if anchor is None:
        return src_idx, len(text)
    pos = text.find(anchor)
    if pos < 0:
        return src_idx, len(text)
    return src_idx, pos + len(anchor)
