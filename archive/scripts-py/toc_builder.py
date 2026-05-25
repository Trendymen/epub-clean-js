from dataclasses import dataclass, field
from pathlib import Path
from jinja2 import Environment, FileSystemLoader

TEMPLATES_DIR = Path(__file__).parent / "templates"


@dataclass
class TocEntry:
    title: str
    href: str
    children: list["TocEntry"] = field(default_factory=list)


def _get_env() -> Environment:
    return Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=False,
        trim_blocks=False,
        lstrip_blocks=False,
    )


def _normalize_space(entries: list[TocEntry]) -> list[TocEntry]:
    # 把全角空格 U+3000 替换为半角，避免多看据宽度自动加大行间距
    out: list[TocEntry] = []
    for e in entries:
        out.append(TocEntry(
            title=e.title.replace("　", " "),
            href=e.href,
            children=_normalize_space(e.children),
        ))
    return out


def _flatten(entries: list[TocEntry]) -> list[TocEntry]:
    # ncx 保持平铺（DST 风格），但仍要走空格规范化
    flat: list[TocEntry] = []
    for e in entries:
        flat.append(TocEntry(title=e.title, href=e.href))
        flat.extend(_flatten(e.children))
    return flat


def build_toc_ncx(title: str, uuid: str, entries: list[TocEntry]) -> str:
    env = _get_env()
    flat = _flatten(_normalize_space(entries))
    return env.get_template("toc.ncx.j2").render(title=title, uuid=uuid, entries=flat)


def build_nav_xhtml(title: str, entries: list[TocEntry]) -> str:
    env = _get_env()
    return env.get_template("nav.xhtml.j2").render(
        title=title, entries=_normalize_space(entries),
    )


def build_toc_xhtml(entries: list[TocEntry]) -> str:
    env = _get_env()
    flat = _flatten(_normalize_space(entries))
    return env.get_template("TOC.xhtml.j2").render(entries=flat)
