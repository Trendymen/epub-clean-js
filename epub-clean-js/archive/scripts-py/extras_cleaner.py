"""附章 STERA 风格模板生成（参考 clean15 同款）。"""
import re

_CALIBRE_CLASS_RE = re.compile(r'\b(?:p?calibre\d*)\b')

_COVER_TEMPLATE = '''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
 <title>封面</title>
 <link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
 <script type="text/javascript" src="../Misc/script.js"></script>
</head>
<body>
 <div class="cover duokan-image-single">
  <img alt="cover" src="../Images/{image_filename}" zy-enlarge-src="self"/>
 </div>
</body>
</html>
'''

_ILLUS_TEMPLATE = '''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
 <title>插图</title>
 <link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
 <script type="text/javascript" src="../Misc/script.js"></script>
</head>
<body>
 <div class="kuchie duokan-image-single">
  <img alt="{alt}" src="../Images/{image_filename}" zy-enlarge-src="self"/>
 </div>
</body>
</html>
'''

_TITLE_TEMPLATE = '''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<title>标题</title>
<link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
<script type="text/javascript" src="../Misc/script.js"></script>
<style>
 .textbox{{font-family:title,main,emoji,sym;}}
 .textbox p{{margin:0;text-indent:0;duokan-text-indent:0;text-align:center;line-height:1em;font-weight:bold;}}
 .textbox .c1{{font-size:0.8em;color:#06ae7a;}}
 .textbox .c2{{font-size:1.1em;padding:0.2em 0 1.5em;}}
 .textbox .c3{{font-size:0.8em;color:#923c93;}}
 .textbox .c4{{font-size:1em;padding:0.15em 0 0;}}
</style>
</head>
<body>
  <div class="center" style="margin:4em auto 1em;">
   <p class="tilh"><img alt="t1" src="../Images/{t1}" style="width:13em;"/></p>
  </div>
  <div class="center" style="margin:1em auto 2.5em;">
   <p class="tilh"><img alt="t2" src="../Images/{t2}" style="width:2.5em;"/></p>
  </div>
  <div class="textbox">
   <p class="c1">作者</p>
   <p class="c2"><img alt="t3" src="../Images/{t3}" style="width:5em;"/></p>
   <p class="c3">插画</p>
   <p class="c4"><img alt="t4" src="../Images/{t4}" style="width:3em;"/></p>
  </div>
</body>
</html>
'''

_MESSAGE_TEMPLATE = '''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<title>制作信息</title>
<link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
<script type="text/javascript" src="../Misc/script.js"></script>
</head>
<body>
 <div class="message">
  <div>
   <div class="meg">
    <p>制 作 信 息</p>
   </div>
   <div class="meghr"></div>
{credit_rows}
   <div class="group">
    <a href="{url}">
    <p style="padding:0 0 0.5em;color:#D11A2D;">仅供个人学习交流使用，禁作商业用途</p>
    </a>
    <a href="{url}">
    <p style="color:#D11A2D;">下载后请在24小时内删除，制作组不负担任何责任</p>
    </a>
   </div>
   <div class="logo">
    <img alt="logo" src="../Images/{logo}" zy-enlarge-src="none"/>
   </div>
  </div>
 </div>
</body>
</html>
'''

_SUMMARY_TEMPLATE = '''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<title>简介</title>
<link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
<script type="text/javascript" src="../Misc/script.js"></script>
</head>
<body>
<div class="summary">
<h3>简介</h3>
<hr/>
{paragraphs}
</div>
</body>
</html>
'''

_CONTENTS_TEMPLATE = '''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
 <title>插图</title>
 <link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
 <script type="text/javascript" src="../Misc/script.js"></script>
</head>
<body>
 <div class="kuchie duokan-image-single">
  <img alt="contents" src="../Images/{image_filename}" zy-enlarge-src="self"/>
 </div>
</body>
</html>
'''

_PRE_TEMPLATE = '''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
 <title>序</title>
 <link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
 <script type="text/javascript" src="../Misc/script.js"></script>
</head>
<body>
 <p><br/></p>
 <p><br/></p>
 <p><br/></p>
 <p><br/></p>
 <p><br/></p>
 <p class="bold center">{quote_text}</p>
</body>
</html>
'''

_TOC_TEMPLATE = '''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
 <title>目录</title>
 <link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
 <script type="text/javascript" src="../Misc/script.js"></script>
 <style>
 body{{-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;}}
 .ctt{{font-family:ctt2,emoji,sym;text-align:center;font-size:1.8em;margin:1em 0;font-weight:bold;}}
 .toc{{margin:1em 0 0.5em;text-align:center;border-left:0;}}
 .toc a{{display:block;font-family:ctt1,emoji,sym;padding:0.25em;}}
 </style>
</head>
<body>
<div style="margin:0 auto;width:fit-content;">
 <h3 class="ctt">CONTENTS</h3>
{entries}
</div>
</body>
</html>
'''


def strip_calibre_classes(html: str) -> str:
    """剥离所有 calibreNN / pcalibre / pcalibreN 类名。保留同一 class 属性内的其他类。"""
    def _replace_class(match: re.Match) -> str:
        cls_attr = match.group(1)
        new_classes = [c for c in cls_attr.split() if not _CALIBRE_CLASS_RE.fullmatch(c)]
        if not new_classes:
            return ''
        return f' class="{" ".join(new_classes)}"'

    out = re.sub(r'\s+class="([^"]*)"', _replace_class, html)
    return out


def build_cover_xhtml(image_filename: str) -> str:
    return _COVER_TEMPLATE.format(image_filename=image_filename)


def build_illus_xhtml(image_filename: str, alt: str = "illus") -> str:
    return _ILLUS_TEMPLATE.format(image_filename=image_filename, alt=alt)


def build_title_xhtml(t1: str, t2: str, t3: str, t4: str) -> str:
    """STERA 风格书名页。t1=书名图，t2=卷号小图，t3=作者图，t4=插画师图。"""
    return _TITLE_TEMPLATE.format(t1=t1, t2=t2, t3=t3, t4=t4)


def build_message_xhtml(credits: list[tuple[str, str]], url: str = "https://www.lightnovel.us",
                        logo: str = "logo.webp") -> str:
    """STERA 风格制作信息页。
    credits: [(role, name), ...] 如 [("作者", "三河ごーすと"), ("插画", "Hiten"), ...]
    """
    rows = []
    for role, name in credits:
        rows.append(f'   <div class="creator">\n    <p>{role}</p>\n   </div>')
        rows.append(f'   <div>\n    <p>{name}</p>\n   </div>')
    return _MESSAGE_TEMPLATE.format(
        credit_rows="\n".join(rows), url=url, logo=logo,
    )


def build_summary_xhtml(description: str) -> str:
    """STERA 风格简介页。description 是多行文本，按 \\n\\n 分段。"""
    paras = [p.strip() for p in description.strip().split("\n") if p.strip()]
    html_paras = "\n".join(f"<p>{p}</p>" for p in paras)
    return _SUMMARY_TEMPLATE.format(paragraphs=html_paras)


def build_contents_xhtml(image_filename: str = "toc-001.webp") -> str:
    """STERA 风格目录装饰页（单图）。"""
    return _CONTENTS_TEMPLATE.format(image_filename=image_filename)


def build_pre_xhtml(quote_text: str = "") -> str:
    """STERA 风格序言页（空白 + 居中引言）。"""
    return _PRE_TEMPLATE.format(quote_text=quote_text)


def build_toc_xhtml(entries: list[tuple[str, str]]) -> str:
    """STERA 风格目录页。entries=[(href, title), ...]，每章一个卡片。"""
    blocks = []
    for href, title in entries:
        blocks.append(
            f' <div class="toc">\n  <a href="{href}"> \n'
            f'  <p>{title}</p>\n  </a>\n </div>'
        )
    return _TOC_TEMPLATE.format(entries="\n".join(blocks))
