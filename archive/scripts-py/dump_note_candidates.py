"""一次性调试脚本：抽 LOW/MEDIUM 注释的 DST host 段 + SRC 候选窗口 + 注释正文，
给人工判断 SRC 中的精确插入位置用。

输出 JSON 到 /tmp/note_candidates.json。每条注释结构：
    {
      "chapter": 3,
      "note_id": "note001",
      "note_text": "注：五月晴れ...",
      "dst_host": "她对我嫣然一笑。那笑容宛若梅雨季中的五月晴<<<HERE>>>一般。...",
      "dst_host_idx": 123,
      "hint_src_idx": 120,
      "src_window": [
        {"idx": 115, "text": "（前 200 字预览）..."},
        ...
      ]
    }
"""
from __future__ import annotations
import json
from pathlib import Path

from scripts.aligner import align_paragraphs
from scripts.footnote_extractor import Footnote, extract_footnotes
from scripts.paragraph_extractor import extract_paragraphs
from scripts.migrate_epub import CHAPTER_MAP, SRC_UNPACKED, DST_UNPACKED


WINDOW = 20
SNIPPET_LEN = 220


def _find_hint_src_idx(dst_idx: int, pairs) -> int:
    for s, d in pairs:
        if d == dst_idx and s is not None:
            return s
    for s, d in pairs:
        if d is not None and d >= dst_idx and s is not None:
            return s
    return 0


def _mark_sup(host_text: str, sup_offset: int) -> str:
    o = max(0, min(sup_offset, len(host_text)))
    return host_text[:o] + "<<<HERE>>>" + host_text[o:]


def main() -> None:
    out = []
    for src_chapter_num, dst_files in CHAPTER_MAP:
        # SRC 段
        src_path = SRC_UNPACKED / f"OEBPS/Text/chapter{src_chapter_num}.xhtml"
        src_paras = extract_paragraphs(src_path)
        # chapter1 引言已并入 pre.xhtml，跳过 SRC 第 1 段（与 migrate_chapters 保持一致）
        if src_chapter_num == 1 and src_paras:
            src_paras = src_paras[1:]

        # DST 段 + 注释（合并多个 split）
        dst_paras: list[str] = []
        all_notes: list[Footnote] = []
        para_offset = 0
        for f in dst_files:
            dst_file = DST_UNPACKED / f
            paras = extract_paragraphs(dst_file)
            notes = extract_footnotes(dst_file)
            # host_para_index 已是单文件局部索引，加上累计 offset
            for n in notes:
                n.host_para_index += para_offset
                all_notes.append(n)
            dst_paras.extend(paras)
            para_offset += len(paras)

        pairs = align_paragraphs(src_paras, dst_paras)

        for local_idx, fn in enumerate(all_notes, start=1):
            hint = _find_hint_src_idx(fn.host_para_index, pairs)
            lo = max(0, hint - WINDOW)
            hi = min(len(src_paras), hint + WINDOW + 1)
            window = [
                {"idx": i, "text": src_paras[i][:SNIPPET_LEN]}
                for i in range(lo, hi)
            ]
            out.append({
                "chapter": src_chapter_num,
                "stera_note_id": f"note{local_idx:03d}",
                "orig_dst_note_id": fn.original_id,
                "note_text": fn.text,
                "dst_host_idx": fn.host_para_index,
                "dst_host": _mark_sup(fn.host_para_text, fn.sup_offset)[:400],
                "hint_src_idx": hint,
                "src_total": len(src_paras),
                "src_window": window,
            })

    out_path = Path("/tmp/note_candidates.json")
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已写入 {out_path}（{len(out)} 条）")


if __name__ == "__main__":
    main()
