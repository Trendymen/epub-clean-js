"""义妹生活 09 卷译文迁移主入口（v3：clean15 风格清洗版）。

策略：
- 排版骨架：REF07（OEBPS/Styles/{stylesheet,default,necessary}.css + Misc/script.js + Fonts/）
- 附章：完全重写为 STERA/clean15 风格（扁平 div + inline style + 语义类，零 calibreNN）
  - cover/illus/title/message/summary/contents/TOC/pre 全部用 extras_cleaner 模板生成
- 章节正文：chapter_renderer + STERA 注释升级 + 内联插图保留
- 图片：SRC 17 张台版高清 jpg 覆盖封面/彩插/章内插图；DST 装饰图（t1-t4/logo/note/toc-001）原样保留
- OPF / TOC NCX / Nav：metadata_builder + toc_builder 重新生成
"""
import shutil
import re
import uuid as uuid_module
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

from lxml import etree

from scripts.epub_io import pack_epub
from scripts.paragraph_extractor import extract_paragraphs
from scripts.footnote_extractor import extract_footnotes
from scripts.inline_image_extractor import extract_inline_images
from scripts.aligner import align_paragraphs
from scripts.footnote_relocator import relocate_footnote
from scripts.footnote_overrides import lookup_override
from scripts.footnote_cleaner import build_stera_footnote
from scripts.chapter_renderer import render_chapter
from scripts.extras_cleaner import (
    build_cover_xhtml, build_illus_xhtml, build_title_xhtml,
    build_message_xhtml, build_summary_xhtml, build_contents_xhtml,
    build_pre_xhtml, build_toc_xhtml as build_toc_xhtml_clean15,
)
from scripts.metadata_builder import build_content_opf, ManifestItem, SpineItem
from scripts.toc_builder import build_toc_ncx, build_nav_xhtml, TocEntry

# ===== CONFIG =====
WORK_DIR = Path("/Users/liuzhuo/Downloads/义妹生活")
SRC_UNPACKED = WORK_DIR / "tmp_epub/src09_unpacked"
DST_UNPACKED = WORK_DIR / "tmp_epub/dst09_unpacked"
REF07_UNPACKED = WORK_DIR / "tmp_epub/ref07_unpacked"
BUILD_DIR = WORK_DIR / "tmp_epub/build"
OUT_EPUB = WORK_DIR / "[三河ごーすと].义妹生活.09.[台简].epub"
ALIGN_REPORT = WORK_DIR / "align_report.md"

NS = "{http://www.w3.org/1999/xhtml}"

# 仅封面用 SRC 台版 191020.jpg（1.4MB 高清原扫描，DST 只有 0.3MB）
# 彩插/章内插图全部用 DST 日翻 webp（像素是 SRC 的 ~3 倍，更清晰）
_SRC_TO_STERA = {
    "191020.jpg": "cover.jpg",
}

# SRC chapter N → DST split 文件列表
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

# 09 卷制作信息（提自 DST message.xhtml）
CREDITS_09 = [
    ("作者", "三河ごーすと"),
    ("插画", "Hiten"),
    ("译者", "幽蝉满耳"),
    ("校对", "炫目林光"),
    ("图源", "UU"),
    ("录入", "coolbar"),
    ("嵌字", "闲的e书组"),
    ("ePub", "落合葵"),
]
CREDITS_URL = "https://www.lightnovel.us"

# 09 卷简介（取自 SRC dc:description，台版繁→简译文）
SRC_DESCRIPTION = """我紧紧握住他牵着我的那只手，一点都不想放开。
在校是「情侣」，在家是「兄妹」。
悠太与沙季通过磨合找出适当距离，
但是紧接着就因为父母不在而要度过「完全只有两个人的两天」，
两人真的能继续维持适当的距离吗……？
另一方面，学校活动、朋友的青春与加油、与打工新人「后辈小妹」的交流等，
崭新的风毫不留情地吹向悠太与沙季……？
「相遇」至今一年，历经许多事而改变的两人，迎来高中生活最后的夏天。
经历过友情、青春、新的相遇之后，「兄妹」所面对的感情是──"""


# ============================================================
# Phase 1: 项目骨架（REF07 CSS + Fonts + Misc）+ 图片
# ============================================================

def setup_build_dir() -> None:
    """从零搭 STERA 骨架。"""
    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR)
    BUILD_DIR.mkdir(parents=True)

    # mimetype + META-INF 拷 REF07
    shutil.copy(REF07_UNPACKED / "mimetype", BUILD_DIR / "mimetype")
    shutil.copytree(REF07_UNPACKED / "META-INF", BUILD_DIR / "META-INF")
    # OEBPS 框架
    oebps = BUILD_DIR / "OEBPS"
    oebps.mkdir()
    shutil.copytree(REF07_UNPACKED / "OEBPS/Styles", oebps / "Styles")
    shutil.copytree(REF07_UNPACKED / "OEBPS/Misc", oebps / "Misc")
    shutil.copytree(REF07_UNPACKED / "OEBPS/Fonts", oebps / "Fonts")
    # 从 DST 补 emoji.ttf / sym.ttf
    for ttf in ["emoji.ttf", "sym.ttf"]:
        p = DST_UNPACKED / "Fonts" / ttf
        if p.exists():
            shutil.copy(p, oebps / "Fonts" / ttf)
    (oebps / "Text").mkdir()

    # 图片：SRC 台版 jpg + DST 装饰图
    images_dir = oebps / "Images"
    images_dir.mkdir()
    _copy_src_images(images_dir)
    _copy_dst_decoration_images(images_dir)

    # 修剪 CSS @font-face：REF07 引用了不存在的 title/illus1-5/num/cont 字体
    _strip_missing_font_faces(
        oebps / "Styles" / "default.css",
        ["title", "illus1", "illus2", "illus3", "illus4", "illus5", "num"],
    )
    _strip_missing_font_faces(oebps / "Styles" / "necessary.css", ["cont"])


def _copy_src_images(images_dir: Path) -> None:
    src_dir = SRC_UNPACKED / "OEBPS/Images"
    for src_name, stera_name in _SRC_TO_STERA.items():
        src_path = src_dir / src_name
        if src_path.exists():
            shutil.copy(src_path, images_dir / stera_name)


def _copy_dst_decoration_images(images_dir: Path) -> None:
    """从 DST 拷装饰图 + 彩插 + 章内插图（除封面外全部 DST 高清 webp）。"""
    dst_dir = DST_UNPACKED / "Images"
    # 装饰图（书名/logo/注释/目录）
    names = ["t1.webp", "t2.webp", "t3.webp", "t4.webp",
             "logo.webp", "note.webp", "note1.webp", "toc-001.webp"]
    # 5 张彩插（DST 像素 2048×1474，比 SRC 大 0.6-1.6×）
    names += [f"kuchie-{i:03d}.webp" for i in range(1, 6)]
    # 10 张章内插图（DST 像素 1443×2048，是 SRC 的 ~3 倍）
    names += [f"p{n}.webp" for n in
              ("039", "062", "137", "177", "196", "209", "242", "267", "304", "318")]
    for name in names:
        p = dst_dir / name
        if p.exists():
            shutil.copy(p, images_dir / name)


def _strip_missing_font_faces(css_path: Path, families: list[str]) -> None:
    if not css_path.exists():
        return
    content = css_path.read_text(encoding="utf-8")
    for fam in families:
        pattern = (r'@font-face\{font-family:"' + re.escape(fam)
                   + r'";src:url\(\.\./Fonts/' + re.escape(fam) + r'\.ttf\);\}')
        content = re.sub(pattern, '', content)
    css_path.write_text(content, encoding="utf-8")


# ============================================================
# Phase 2: 12 个章节（chapter_renderer + 段落对齐 + 注释升级 + 内联插图）
# ============================================================

def migrate_chapters() -> tuple[list[TocEntry], list[dict]]:
    toc_entries: list[TocEntry] = []
    review_items: list[dict] = []

    for src_chapter_num, dst_files in CHAPTER_MAP:
        src_path = SRC_UNPACKED / f"OEBPS/Text/chapter{src_chapter_num}.xhtml"
        src_paras = extract_paragraphs(src_path)

        # chapter1 特例：SRC 第 1 段是引言「冷静的人生规划...」，已作为 pre.xhtml 序言页内容，
        # 此处跳过避免章节正文重复显示（DST 09 把引言放 pre，正文从「拖着大号行李箱」开始）。
        if (src_chapter_num == 1 and src_paras
                and src_paras[0].startswith("冷静的人生规划")):
            src_paras = src_paras[1:]

        # 合并 DST split 抽段落 + 注释 + 内联插图
        dst_paras: list[str] = []
        all_notes = []
        all_inline_imgs = []
        for f in dst_files:
            dst_file_path = DST_UNPACKED / f
            file_paras = extract_paragraphs(dst_file_path)
            file_notes = extract_footnotes(dst_file_path)
            file_imgs = extract_inline_images(dst_file_path)
            offset = len(dst_paras)
            for n in file_notes:
                n.host_para_index += offset
            for img in file_imgs:
                img.after_para_index += offset
            dst_paras.extend(file_paras)
            all_notes.extend(file_notes)
            all_inline_imgs.extend(file_imgs)

        # 段落对齐
        pairs = align_paragraphs(src_paras, dst_paras)

        # 定位注释，每条 sup 与其对应 aside 配对到同一段
        # 关键修复：script.js 在每个 <note> 元素内查 sup/aside 配对，
        # 所以含 sup 的段落 + 对应 aside 必须放进同一个 <note> 容器
        out_paras = list(src_paras)
        para_to_asides: dict[int, list[str]] = {}  # src_para_idx → aside_html 列表
        for new_id_num, fn in enumerate(all_notes, start=1):
            override = lookup_override(src_chapter_num, new_id_num, src_paras)
            if override is not None:
                src_idx, char_off = override
                relocation_confidence = "OVERRIDE"
                relocation_score = 100.0
            else:
                relocation = relocate_footnote(fn, src_paras, pairs)
                src_idx = relocation.src_para_idx
                char_off = relocation.src_char_offset
                relocation_confidence = relocation.confidence
                relocation_score = relocation.score
            sup_html, aside_html = build_stera_footnote(fn, new_id_num)
            p = out_paras[src_idx]
            out_paras[src_idx] = p[:char_off] + sup_html + p[char_off:]
            para_to_asides.setdefault(src_idx, []).append(aside_html)
            review_items.append({
                "chapter": f"chapter{src_chapter_num:04d}",
                "id": f"note{new_id_num:03d}",
                "confidence": relocation_confidence,
                "score": relocation_score,
                "dst_context": fn.before_ctx + "▮" + fn.after_ctx,
                "src_target": out_paras[src_idx][:80],
                "note_text": fn.text,
            })

        # 内联插图：把 webp 引用替换成 jpg
        dst_to_src = {d: s for s, d in pairs if s is not None and d is not None}
        imgs_after_src_idx: dict[int, list[str]] = {}
        for img in all_inline_imgs:
            src_idx = dst_to_src.get(img.after_para_index)
            if src_idx is None:
                for d in sorted(dst_to_src.keys()):
                    if d >= img.after_para_index:
                        src_idx = dst_to_src[d]
                        break
                if src_idx is None:
                    src_idx = len(out_paras) - 1
            # 章内插图保留 DST 原 .webp（DST 像素是 SRC 的 3×，更清晰）
            imgs_after_src_idx.setdefault(src_idx, []).append(img.stera_html)
            review_items.append({
                "chapter": f"chapter{src_chapter_num:04d}",
                "id": f"illus[{img.src_filename}]",
                "confidence": "HIGH" if img.after_para_index in dst_to_src else "MEDIUM",
                "score": 100.0 if img.after_para_index in dst_to_src else 0.0,
                "dst_context": f"after DST para {img.after_para_index}",
                "src_target": f"after SRC para {src_idx}",
                "note_text": f"内联插图: {img.src_filename}",
            })

        # 交织 blocks：含 aside 的段落用 dict block（chapter_renderer 会用 <note> 包）
        blocks: list = []
        for i, p in enumerate(out_paras):
            if i in para_to_asides:
                # script.js 要求 sup 和 aside 在同一 <note> 元素内一一配对
                blocks.append({"para": p, "aside": "\n".join(para_to_asides[i])})
            else:
                blocks.append(p)
            for illus_html in imgs_after_src_idx.get(i, []):
                blocks.append(illus_html)

        # 标题
        title = _extract_h3_title(DST_UNPACKED / dst_files[0])

        # 渲染
        out_html = render_chapter(title=title, blocks=blocks)
        out_file = BUILD_DIR / f"OEBPS/Text/chapter{src_chapter_num:04d}.xhtml"
        out_file.write_text(out_html, encoding="utf-8")

        toc_entries.append(TocEntry(
            title=title, href=f"Text/chapter{src_chapter_num:04d}.xhtml",
        ))

        print(f"  ✓ chapter{src_chapter_num:04d}: "
              f"SRC {len(src_paras)} 段 / DST {len(dst_paras)} 段 / "
              f"{len(all_notes)} 条注释 / {len(all_inline_imgs)} 张插图")

    return toc_entries, review_items


def _extract_h3_title(xhtml_path: Path) -> str:
    tree = etree.parse(str(xhtml_path))
    for h3 in tree.iter(f"{NS}h3"):
        text = "".join(h3.itertext()).strip()
        if text:
            return text
    return "未命名章节"


def _extract_h4_h5_title(xhtml_path: Path) -> str:
    """从 h4 + h5 拼接特典标题：'电子书特典　『棉花糖般甜蜜』'。"""
    tree = etree.parse(str(xhtml_path))
    parts = []
    for tag in (f"{NS}h4", f"{NS}h5"):
        for el in tree.iter(tag):
            text = "".join(el.itertext()).strip()
            if text:
                parts.append(text)
                break
    return "　".join(parts) if parts else _extract_h3_title(xhtml_path)


# ============================================================
# Phase 2.5: 特典（talk + special0001-0003）
# ============================================================

def migrate_specials() -> tuple[list[TocEntry], list[dict]]:
    """迁移 DST 4 个特典：talk（单图）+ special0001-0003（章节文本）。

    特典内容只在 DST 有（SRC 无对应），不做段落对齐，直接用 DST 原文。
    渲染走 chapter_renderer 的 STERA 风格（与正文章节统一）。
    """
    text_dir = BUILD_DIR / "OEBPS/Text"
    toc_entries: list[TocEntry] = []
    review_items: list[dict] = []

    # talk.xhtml 不再迁移：内容是 kuchie-005，已在 5 张彩插中展示，重复无意义

    # special0001-0003.xhtml → 用 chapter_renderer 渲染
    for n in range(1, 4):
        name = f"special{n:04d}.xhtml"
        dst_path = DST_UNPACKED / "Text" / name
        if not dst_path.exists():
            continue

        dst_paras = extract_paragraphs(dst_path)
        notes = extract_footnotes(dst_path)
        inline_imgs = extract_inline_images(dst_path)

        # 段落 + sup + aside（用 DST 原 sup_offset，无需 fuzzy 定位）
        out_paras = list(dst_paras)
        para_to_asides: dict[int, list[str]] = {}
        for new_id_num, fn in enumerate(notes, start=1):
            sup_html, aside_html = build_stera_footnote(fn, new_id_num)
            idx = fn.host_para_index
            if 0 <= idx < len(out_paras):
                off = min(fn.sup_offset, len(out_paras[idx]))
                out_paras[idx] = out_paras[idx][:off] + sup_html + out_paras[idx][off:]
                para_to_asides.setdefault(idx, []).append(aside_html)
            review_items.append({
                "chapter": name.replace(".xhtml", ""),
                "id": f"note{new_id_num:03d}",
                "confidence": "HIGH",
                "score": 100.0,
                "dst_context": fn.before_ctx + "▮" + fn.after_ctx,
                "src_target": out_paras[idx][:80] if 0 <= idx < len(out_paras) else "",
                "note_text": fn.text,
            })

        # 内联插图（special 一般没有，但保险起见）
        imgs_after: dict[int, list[str]] = {}
        for img in inline_imgs:
            imgs_after.setdefault(img.after_para_index, []).append(img.stera_html)

        # 交织 blocks
        blocks: list = []
        for i, p in enumerate(out_paras):
            if i in para_to_asides:
                blocks.append({"para": p, "aside": "\n".join(para_to_asides[i])})
            else:
                blocks.append(p)
            for illus in imgs_after.get(i, []):
                blocks.append(illus)

        title = _extract_h4_h5_title(dst_path)
        out_html = render_chapter(title=title, blocks=blocks)
        (text_dir / name).write_text(out_html, encoding="utf-8")
        toc_entries.append(TocEntry(title=title, href=f"Text/{name}"))

        print(f"  ✓ {name}: {len(dst_paras)} 段 / {len(notes)} 条注释 / 标题「{title}」")

    return toc_entries, review_items


# ============================================================
# Phase 3: 附章（cover/illus/title/message/summary/contents/TOC/pre）
# ============================================================

def write_attached_pages() -> None:
    text_dir = BUILD_DIR / "OEBPS/Text"

    # cover.xhtml
    (text_dir / "cover.xhtml").write_text(
        build_cover_xhtml(image_filename="cover.jpg"), encoding="utf-8",
    )

    # illus0001-0005.xhtml（5 张 DST 日翻高清 webp 彩页）
    for n in range(1, 6):
        (text_dir / f"illus{n:04d}.xhtml").write_text(
            build_illus_xhtml(
                image_filename=f"kuchie-{n:03d}.webp",
                alt=f"kuchie-{n:03d}",
            ),
            encoding="utf-8",
        )

    # title.xhtml
    (text_dir / "title.xhtml").write_text(
        build_title_xhtml(t1="t1.webp", t2="t2.webp", t3="t3.webp", t4="t4.webp"),
        encoding="utf-8",
    )

    # message.xhtml（09 卷制作信息）
    (text_dir / "message.xhtml").write_text(
        build_message_xhtml(credits=CREDITS_09, url=CREDITS_URL, logo="logo.webp"),
        encoding="utf-8",
    )

    # summary.xhtml（SRC 简介）
    (text_dir / "summary.xhtml").write_text(
        build_summary_xhtml(description=SRC_DESCRIPTION),
        encoding="utf-8",
    )

    # contents.xhtml（toc-001 装饰目录页）
    (text_dir / "contents.xhtml").write_text(
        build_contents_xhtml(image_filename="toc-001.webp"),
        encoding="utf-8",
    )

    # pre.xhtml（序言页，含本卷开篇引言；台版 SRC 译文，与 chapter0001 第一句呼应）
    (text_dir / "pre.xhtml").write_text(
        build_pre_xhtml(quote_text="冷静的人生规划不保证会有幸福的人生。幸福藏在刹那间的狂热之中。"),
        encoding="utf-8",
    )


# ============================================================
# Phase 4: TOC + content.opf
# ============================================================

def write_metadata_and_toc(chapter_toc: list[TocEntry],
                           special_toc: list[TocEntry]) -> None:
    book_uuid = str(uuid_module.uuid4())
    modified_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # nav/ncx 顺序：封面/书名/制作信息/简介/彩插/12 章/特典(嵌 3 个 special)
    # nav 里特典做嵌套子列表（DST 风格，多看据此用紧凑行高）；ncx 由 toc_builder 自动平铺
    specials_grouped = (
        [TocEntry(
            title="特典",
            href=special_toc[0].href,
            children=list(special_toc),
        )] if special_toc else []
    )
    full_toc = [
        TocEntry(title="封面", href="Text/cover.xhtml"),
        TocEntry(title="书名页", href="Text/title.xhtml"),
        TocEntry(title="制作信息", href="Text/message.xhtml"),
        TocEntry(title="简介", href="Text/summary.xhtml"),
        TocEntry(title="彩插", href="Text/illus0001.xhtml"),
    ] + chapter_toc + specials_grouped

    # TOC.xhtml 用户可见目录页：仅 12 章 + 3 特典（不显示封面/书名/制作信息/简介/彩插）
    # 全角空格转半角，与 nav/ncx 对齐
    toc_visible_entries = [(e.href.removeprefix("Text/"), e.title.replace("　", " "))
                           for e in chapter_toc + special_toc]
    (BUILD_DIR / "OEBPS/Text/TOC.xhtml").write_text(
        build_toc_xhtml_clean15(entries=toc_visible_entries),
        encoding="utf-8",
    )

    # ncx 直接平铺：跳过 nav 里的"特典"虚拟父项，只列 3 个 special
    ncx_toc = [
        TocEntry(title="封面", href="Text/cover.xhtml"),
        TocEntry(title="书名页", href="Text/title.xhtml"),
        TocEntry(title="制作信息", href="Text/message.xhtml"),
        TocEntry(title="简介", href="Text/summary.xhtml"),
        TocEntry(title="彩插", href="Text/illus0001.xhtml"),
    ] + chapter_toc + special_toc
    ncx = build_toc_ncx(title="义妹生活 09", uuid=book_uuid, entries=ncx_toc)
    (BUILD_DIR / "OEBPS/toc.ncx").write_text(ncx, encoding="utf-8")

    def _strip_text_prefix(entries: list[TocEntry]) -> list[TocEntry]:
        return [TocEntry(
            title=e.title,
            href=e.href.removeprefix("Text/"),
            children=_strip_text_prefix(e.children),
        ) for e in entries]

    nav = build_nav_xhtml(title="目录", entries=_strip_text_prefix(full_toc))
    (BUILD_DIR / "OEBPS/Text/navigation-documents.xhtml").write_text(nav, encoding="utf-8")

    # 扫 manifest 并写 OPF
    manifest_items = _build_manifest(BUILD_DIR / "OEBPS")
    spine_items = _build_spine()
    opf = build_content_opf(
        title="义妹生活 09",
        description=SRC_DESCRIPTION,
        uuid=book_uuid,
        modified_iso=modified_iso,
        manifest_items=manifest_items,
        spine_items=spine_items,
    )
    (BUILD_DIR / "OEBPS/content.opf").write_text(opf, encoding="utf-8")


def _build_manifest(oebps_dir: Path) -> list[ManifestItem]:
    items: list[ManifestItem] = []
    media_types = {
        ".xhtml": "application/xhtml+xml", ".css": "text/css",
        ".js": "application/javascript", ".ttf": "font/ttf",
        ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png",
        ".ncx": "application/x-dtbncx+xml",
    }
    dir_prefix = {"Fonts": "font_", "Images": "img_",
                  "Styles": "css_", "Misc": "js_"}
    scripted = {"cover.xhtml", "title.xhtml", "message.xhtml", "summary.xhtml",
                "TOC.xhtml", "pre.xhtml", "contents.xhtml",
                "illus0001.xhtml", "illus0002.xhtml", "illus0003.xhtml",
                "illus0004.xhtml", "illus0005.xhtml",
                "special0001.xhtml", "special0002.xhtml", "special0003.xhtml"}
    chapter_files = {f"chapter{i:04d}.xhtml" for i in range(1, 13)}

    for p in sorted(oebps_dir.rglob("*")):
        if not p.is_file() or p.name == "content.opf":
            continue
        rel = p.relative_to(oebps_dir).as_posix()
        ext = p.suffix.lower()
        mt = media_types.get(ext, "application/octet-stream")
        parent = p.parent.name
        if parent == "Text":
            item_id = p.stem.replace(".", "_")
        elif parent in dir_prefix:
            item_id = dir_prefix[parent] + p.stem.replace(".", "_").lower()
        else:
            item_id = p.stem.replace(".", "_").lower()
        properties = None
        if p.name == "cover.jpg":
            item_id, properties = "cover-image", "cover-image"
        elif p.name == "toc.ncx":
            item_id = "ncx"
        elif p.name == "navigation-documents.xhtml":
            item_id, properties = "nav", "nav"
        elif p.name in scripted or p.name in chapter_files:
            properties = "scripted"
        items.append(ManifestItem(id=item_id, href=rel,
                                  media_type=mt, properties=properties))
    return items


def _build_spine() -> list[SpineItem]:
    s: list[SpineItem] = []
    # 顺序与 nav/ncx 一致：封面 → 书名 → 制作信息 → 简介 → 彩插 → 目录页 → 序 → 正文 → 特典
    s.append(SpineItem(idref="cover", linear="yes",
                       properties="duokan-page-fullscreen"))
    s.append(SpineItem(idref="title", linear="yes", properties=None))
    s.append(SpineItem(idref="message", linear="yes", properties=None))
    s.append(SpineItem(idref="summary", linear="yes", properties=None))
    for n in range(1, 6):
        s.append(SpineItem(idref=f"illus{n:04d}", linear="yes",
                           properties="duokan-page-fitwindow"))
    s.append(SpineItem(idref="contents", linear="yes",
                       properties="duokan-page-fitwindow"))
    s.append(SpineItem(idref="TOC", linear="yes", properties=None))
    s.append(SpineItem(idref="pre", linear="yes", properties=None))
    for i in range(1, 13):
        s.append(SpineItem(idref=f"chapter{i:04d}", linear="yes", properties=None))
    # 3 个 special 特典（talk 已删，与 kuchie-005 彩插重复）
    for n in range(1, 4):
        s.append(SpineItem(idref=f"special{n:04d}", linear="yes", properties=None))
    s.append(SpineItem(idref="nav", linear="no", properties=None))
    return s


# ============================================================
# Phase 5: 审计报告
# ============================================================

def write_align_report(review_items: list[dict]) -> None:
    lines = ["# 注释定位与对齐审计报告\n",
             f"共 {len(review_items)} 项（注释 + 内联插图），按 chapter+confidence 列出：\n"]
    for it in sorted(review_items, key=lambda x: (x["chapter"], x["confidence"])):
        emoji = {"HIGH": "✅", "MEDIUM": "⚠️", "LOW": "❌"}.get(it["confidence"], "?")
        lines.append(f"## {emoji} {it['chapter']} / {it['id']} "
                     f"({it['confidence']}, score={it['score']:.1f})")
        lines.append(f"- **注释**: {it['note_text']}")
        lines.append(f"- **DST 上下文** (▮=sup): `{it['dst_context']}`")
        lines.append(f"- **SRC 插入处** (前 80 字): `{it['src_target']}`")
        lines.append("")
    ALIGN_REPORT.write_text("\n".join(lines), encoding="utf-8")


# ============================================================
# Main
# ============================================================

def main() -> None:
    print("=== Step 1: 搭 STERA 骨架（REF07 CSS + Fonts + SRC 图片 + DST 装饰图） ===")
    setup_build_dir()

    print("=== Step 2: 写附章（cover/illus/title/message/summary/contents/pre） ===")
    write_attached_pages()

    print("=== Step 3: 迁移 12 个正文章节 ===")
    chapter_toc, review_items = migrate_chapters()

    print("=== Step 4: 迁移特典（talk + special0001-0003） ===")
    special_toc, special_reviews = migrate_specials()
    review_items.extend(special_reviews)

    print("=== Step 5: 写元数据 + TOC ===")
    write_metadata_and_toc(chapter_toc, special_toc)

    print("=== Step 6: 打包 EPUB ===")
    pack_epub(BUILD_DIR, OUT_EPUB)
    print(f"输出: {OUT_EPUB}")

    print("=== Step 7: 写审计报告 ===")
    write_align_report(review_items)
    print(f"已写入 {ALIGN_REPORT}")


if __name__ == "__main__":
    main()
