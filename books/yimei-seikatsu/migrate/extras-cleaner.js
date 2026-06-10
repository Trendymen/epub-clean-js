/**
 * 附章清洗与 STERA 风格模板生成（移植自 Python extras_cleaner.py）。
 *
 * 模板均与 Python f-string 字面量一一对应，输出与 golden-py（07/09 卷）一致。
 */

const CALIBRE_FULLMATCH_RE = /^(?:p?calibre\d*)$/;

// ---------- helpers ----------

/**
 * 仅在插入用户文本（titles / description / quotes 等）时使用。
 * 模板本身的 HTML 标签 / CSS 不应过这个函数。
 * @param {unknown} s
 * @returns {string}
 */
function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ---------- templates ----------

const COVER_TEMPLATE = (imageFilename) =>
  `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
 <title>封面</title>
 <link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
 <script type="text/javascript" src="../Misc/script.js"></script>
</head>
<body>
 <div class="cover duokan-image-single">
  <img alt="cover" src="../Images/${imageFilename}" zy-enlarge-src="self"/>
 </div>
</body>
</html>
`;

const ILLUS_TEMPLATE = (imageFilename, alt) =>
  `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
 <title>插图</title>
 <link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
 <script type="text/javascript" src="../Misc/script.js"></script>
</head>
<body>
 <div class="kuchie duokan-image-single">
  <img alt="${alt}" src="../Images/${imageFilename}" zy-enlarge-src="self"/>
 </div>
</body>
</html>
`;

const TITLE_TEMPLATE = (t1, t2, t3, t4) =>
  `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<title>标题</title>
<link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
<script type="text/javascript" src="../Misc/script.js"></script>
<style>
 .textbox{font-family:title,main,emoji,sym;}
 .textbox p{margin:0;text-indent:0;duokan-text-indent:0;text-align:center;line-height:1em;font-weight:bold;}
 .textbox .c1{font-size:0.8em;color:#06ae7a;}
 .textbox .c2{font-size:1.1em;padding:0.2em 0 1.5em;}
 .textbox .c3{font-size:0.8em;color:#923c93;}
 .textbox .c4{font-size:1em;padding:0.15em 0 0;}
</style>
</head>
<body>
  <div class="center" style="margin:4em auto 1em;">
   <p class="tilh"><img alt="t1" src="../Images/${t1}" style="width:13em;"/></p>
  </div>
  <div class="center" style="margin:1em auto 2.5em;">
   <p class="tilh"><img alt="t2" src="../Images/${t2}" style="width:2.5em;"/></p>
  </div>
  <div class="textbox">
   <p class="c1">作者</p>
   <p class="c2"><img alt="t3" src="../Images/${t3}" style="width:5em;"/></p>
   <p class="c3">插画</p>
   <p class="c4"><img alt="t4" src="../Images/${t4}" style="width:3em;"/></p>
  </div>
</body>
</html>
`;

const DEFAULT_MESSAGE_URL = 'https://www.lightnovel.fun/';
const DEFAULT_MESSAGE_LOGO = 'logo.webp';

// 制作信息底部免责声明两行文案（09 与 11-13 共用，单点维护）。
// 第一行带下边距，09 两行各包一个可点击 <a>，11-13 用纯文本（见 lightnovel-html）。
export const MESSAGE_DISCLAIMER_LINES = [
  '仅供个人学习交流使用，禁作商业用途',
  '下载后请在24小时内删除，制作组不负担任何责任',
];

const DEFAULT_MESSAGE_GROUP = (url) =>
  `    <a href="${url}">
    <p style="padding:0 0 0.5em;color:#D11A2D;">${MESSAGE_DISCLAIMER_LINES[0]}</p>
    </a>
    <a href="${url}">
    <p style="color:#D11A2D;">${MESSAGE_DISCLAIMER_LINES[1]}</p>
    </a>`;

const MESSAGE_TEMPLATE = (creditRows, groupHtml, logo) =>
  `<?xml version="1.0" encoding="utf-8"?>
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
${creditRows}
   <div class="group">
${groupHtml}
   </div>
   <div class="logo">
    <img alt="logo" src="../Images/${logo}" zy-enlarge-src="none"/>
   </div>
  </div>
 </div>
</body>
</html>
`;

const SUMMARY_TEMPLATE = (paragraphs) =>
  `<?xml version="1.0" encoding="utf-8"?>
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
${paragraphs}
</div>
</body>
</html>
`;

const CONTENTS_TEMPLATE = (imageFilename) =>
  `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
 <title>插图</title>
 <link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
 <script type="text/javascript" src="../Misc/script.js"></script>
</head>
<body>
 <div class="kuchie duokan-image-single">
  <img alt="contents" src="../Images/${imageFilename}" zy-enlarge-src="self"/>
 </div>
</body>
</html>
`;

const PRE_TEMPLATE = (quoteText) =>
  `<?xml version="1.0" encoding="utf-8"?>
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
 <p class="bold center">${quoteText}</p>
</body>
</html>
`;

const TOC_TEMPLATE = (entries) =>
  `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
 <title>目录</title>
 <link href="../Styles/stylesheet.css" type="text/css" rel="stylesheet"/>
 <script type="text/javascript" src="../Misc/script.js"></script>
 <style>
 body{-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;}
 .ctt{font-family:ctt2,emoji,sym;text-align:center;font-size:1.8em;margin:1em 0;font-weight:bold;}
 .toc{margin:1em 0 0.5em;text-align:center;border-left:0;}
 .toc a{display:block;font-family:ctt1,emoji,sym;padding:0.25em;}
 </style>
</head>
<body>
<div style="margin:0 auto;width:fit-content;">
 <h3 class="ctt">CONTENTS</h3>
${entries}
</div>
</body>
</html>
`;

// ---------- public API ----------

/**
 * 剥离 calibre/pcalibre 类名。保留同一 class 属性内的其他类。
 * 若清理后 class 为空，则整个 class 属性被删除。
 * @param {string} html
 * @returns {string}
 */
export function stripCalibreClasses(html) {
  return html.replace(/\s+class="([^"]*)"/g, (_match, clsAttr) => {
    const cleaned = clsAttr.split(/\s+/).filter((c) => c && !CALIBRE_FULLMATCH_RE.test(c));
    if (cleaned.length === 0) return '';
    return ` class="${cleaned.join(' ')}"`;
  });
}

/**
 * @param {string} imageFilename
 * @returns {string}
 */
export function buildCoverXhtml(imageFilename) {
  return COVER_TEMPLATE(imageFilename);
}

/**
 * @param {string} imageFilename
 * @param {string} [alt='illus']
 * @returns {string}
 */
export function buildIllusXhtml(imageFilename, alt = 'illus') {
  return ILLUS_TEMPLATE(imageFilename, alt);
}

/**
 * STERA 风格书名页。t1=书名图，t2=卷号小图，t3=作者图，t4=插画师图。
 * 参数是图片文件名（如 't1.webp'），不是文本。
 * @param {string} t1
 * @param {string} t2
 * @param {string} t3
 * @param {string} t4
 * @returns {string}
 */
export function buildTitleXhtml(t1, t2, t3, t4) {
  return TITLE_TEMPLATE(t1, t2, t3, t4);
}

function resolveMessageOptions(urlOrOptions, logo) {
  if (urlOrOptions && typeof urlOrOptions === 'object') {
    const url = urlOrOptions.url ?? DEFAULT_MESSAGE_URL;
    return {
      groupHtml: urlOrOptions.groupHtml ?? DEFAULT_MESSAGE_GROUP(url),
      logo: urlOrOptions.logo ?? DEFAULT_MESSAGE_LOGO,
    };
  }
  const url = urlOrOptions ?? DEFAULT_MESSAGE_URL;
  return {
    groupHtml: DEFAULT_MESSAGE_GROUP(url),
    logo: logo ?? DEFAULT_MESSAGE_LOGO,
  };
}

/**
 * STERA 风格制作信息页。
 * @param {Array<[string, string]>} credits  [(role, name), ...]
 * @param {string | { url?: string, logo?: string, groupHtml?: string }} [urlOrOptions]
 * @param {string} [logo='logo.webp']
 * @returns {string}
 */
export function buildMessageXhtml(credits, urlOrOptions = DEFAULT_MESSAGE_URL, logo = DEFAULT_MESSAGE_LOGO) {
  const rows = [];
  for (const [role, name] of credits) {
    rows.push(`   <div class="creator">\n    <p>${escapeHtml(role)}</p>\n   </div>`);
    rows.push(`   <div>\n    <p>${escapeHtml(name)}</p>\n   </div>`);
  }
  const options = resolveMessageOptions(urlOrOptions, logo);
  return MESSAGE_TEMPLATE(rows.join('\n'), options.groupHtml, options.logo);
}

/**
 * STERA 风格简介页。description 多行文本，按行切分，每个非空行一段 <p>。
 * @param {string} description
 * @returns {string}
 */
export function buildSummaryXhtml(description) {
  const paras = description
    .trim()
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const htmlParas = paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
  return SUMMARY_TEMPLATE(htmlParas);
}

/**
 * STERA 风格目录装饰页（单图）。
 * @param {string} [imageFilename='toc-001.webp']
 * @returns {string}
 */
export function buildContentsXhtml(imageFilename = 'toc-001.webp') {
  return CONTENTS_TEMPLATE(imageFilename);
}

/**
 * STERA 风格序言页（空白 + 居中引言）。
 * @param {string} [quoteText='']
 * @returns {string}
 */
export function buildPreXhtml(quoteText = '') {
  return PRE_TEMPLATE(escapeHtml(quoteText));
}

/**
 * STERA 风格目录页。entries=[[href, title], ...]，每章一个卡片。
 * 注意：`<a href>` 标签内保留尾随空格，与 Python f-string 行为一致（golden-py 同款）。
 * @param {Array<[string, string]>} entries
 * @returns {string}
 */
export function buildTocXhtml(entries) {
  const blocks = entries.map(([href, title]) =>
    ` <div class="toc">\n  <a href="${href}"> \n  <p>${escapeHtml(title)}</p>\n  </a>\n </div>`,
  );
  return TOC_TEMPLATE(blocks.join('\n'));
}
