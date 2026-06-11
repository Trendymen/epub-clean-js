from dataclasses import dataclass
from pathlib import Path
from jinja2 import Environment, FileSystemLoader

TEMPLATES_DIR = Path(__file__).parent / "templates"


@dataclass
class ManifestItem:
    id: str
    href: str
    media_type: str
    properties: str | None  # 如 "nav" / "cover-image" / "scripted"


@dataclass
class SpineItem:
    idref: str
    linear: str          # "yes" / "no"
    properties: str | None  # 如 "duokan-page-fullscreen" / "duokan-page-fitwindow"


def build_content_opf(
    title: str,
    description: str,
    uuid: str,
    modified_iso: str,
    manifest_items: list[ManifestItem],
    spine_items: list[SpineItem],
) -> str:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=False,
        trim_blocks=False,
        lstrip_blocks=False,
    )
    template = env.get_template("content.opf.j2")
    return template.render(
        title=title, description=description.strip(),
        uuid=uuid, modified_iso=modified_iso,
        manifest_items=manifest_items, spine_items=spine_items,
    )
