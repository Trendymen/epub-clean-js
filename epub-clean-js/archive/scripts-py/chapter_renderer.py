from pathlib import Path
from jinja2 import Environment, FileSystemLoader

TEMPLATES_DIR = Path(__file__).parent / "templates"


def _get_env() -> Environment:
    return Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=False,  # 内容自己控制转义（段落含 sup HTML 不能被转义）
        trim_blocks=False,
        lstrip_blocks=False,
        keep_trailing_newline=True,
    )


def render_chapter(
    title: str,
    blocks: list,
    footnote_asides: list[str] | None = None,
) -> str:
    """渲染单个章节 XHTML。

    blocks 是混合列表，每项可以是：
    - 纯字符串：段落文本（可能含已插入的 <sup>...</sup> 内联 HTML）
    - 以 '<div' 开头的字符串：章内插图 HTML（不被 <p> 包裹）
    - dict {"para": str, "aside": str}：含注释的段落 → 用 <note> 包裹 p+aside
      (script.js 要求 sup 和 aside 在同一个 note 元素内一一配对)

    footnote_asides 参数为兼容旧调用保留，已不再使用（asides 现在通过
    blocks 里的 dict 项与对应段落配对）。
    """
    env = _get_env()
    template = env.get_template("chapter.xhtml.j2")
    return template.render(title=title, blocks=blocks)
