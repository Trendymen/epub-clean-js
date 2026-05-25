"""把 DST 注释定位到 SRC 段落里的字符偏移。

输入：单条 ``Footnote`` + SRC 段落列表 + 段落对齐对。
输出：``Relocation`` 记录，含定位到的 SRC 段索引、字符偏移、置信度。

算法（V3 章内窗口搜索）：
    1. 用 ``align_pairs`` 反查 DST ``host_para_index`` 得到 SRC 大致段索引 hint。
    2. 仅在 SRC ``[hint-WINDOW, hint+WINDOW]`` 窗口内做段级 fuzzy.ratio 搜索，
       规避全局搜索因相似句式跨段抢断的问题。
    3. 若窗口内最佳分 < FALLBACK_MIN，回退至全章搜索（防止远偏漏掉）。
    4. 在锚点段中再用 ``before_ctx + after_ctx`` 拼 needle，
       ``rapidfuzz.fuzz.partial_ratio_alignment`` 找精确字符偏移。
    5. 置信度按段级匹配分数：≥ 70 → HIGH，50-70 → MEDIUM，< 50 → LOW（落段末）。
"""

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


WINDOW = 10           # hint 附近 ±N 段
FALLBACK_MIN = 40.0   # 窗口内最佳分低于此值时回退到全章搜索


def relocate_footnote(
    fn: Footnote,
    src_paragraphs: list[str],
    align_pairs: list[tuple[int | None, int | None]],
) -> Relocation:
    if not src_paragraphs:
        return Relocation(0, 0, "LOW", 0.0, "empty src")

    hint_idx = _find_src_idx_for_dst(
        fn.host_para_index, align_pairs, len(src_paragraphs)
    )
    if hint_idx is None:
        hint_idx = 0

    host_text = fn.host_para_text

    # Step 1：窗口内段级搜索
    lo = max(0, hint_idx - WINDOW)
    hi = min(len(src_paragraphs), hint_idx + WINDOW + 1)
    best_idx, best_score = _best_in_range(host_text, src_paragraphs, lo, hi)
    scope = f"window[{lo},{hi})"

    # Step 2：分太低则回退全章
    if best_score < FALLBACK_MIN:
        f_idx, f_score = _best_in_range(host_text, src_paragraphs, 0, len(src_paragraphs))
        if f_score > best_score:
            best_idx, best_score = f_idx, f_score
            scope = "fallback-full-chapter"

    src_text = src_paragraphs[best_idx]

    # Step 3：段内 partial 找字符偏移
    needle = fn.before_ctx + fn.after_ctx
    if needle:
        result = fuzz.partial_ratio_alignment(needle, src_text)
        match_start = result.dest_start
        insert_offset = max(0, min(match_start + len(fn.before_ctx), len(src_text)))
    else:
        insert_offset = len(src_text)

    if best_score >= 70:
        confidence = "HIGH"
    elif best_score >= 50:
        confidence = "MEDIUM"
    else:
        confidence = "LOW"
        insert_offset = len(src_text)

    return Relocation(
        src_para_idx=best_idx,
        src_char_offset=insert_offset,
        confidence=confidence,
        score=best_score,
        debug_info=f"hint={hint_idx} {scope} picked={best_idx}",
    )


def _best_in_range(
    needle_text: str, paras: list[str], lo: int, hi: int,
) -> tuple[int, float]:
    best_idx, best_score = lo, -1.0
    for i in range(lo, hi):
        if not paras[i]:
            continue
        s = fuzz.ratio(needle_text, paras[i])
        if s > best_score:
            best_score = s
            best_idx = i
    return best_idx, max(best_score, 0.0)


def _find_src_idx_for_dst(
    dst_idx: int,
    align_pairs: list[tuple[int | None, int | None]],
    src_max: int,
) -> int | None:
    for s, d in align_pairs:
        if d == dst_idx and s is not None:
            return s
    for s, d in align_pairs:
        if d is not None and d >= dst_idx and s is not None:
            return s
    return src_max - 1 if src_max > 0 else None
