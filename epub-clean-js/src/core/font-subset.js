import fs from 'node:fs';
import path from 'node:path';
import subsetFont from 'subset-font';

const BOOKS = path.resolve(import.meta.dirname, '../../books');

// 角色→字面映射依据 2026-06-10 字形渲染实证（日翻原字体 name 表被剥除，以 ≥240px 轮廓渲染对照思源各字重；
// 72-100px 小图曾两次误判：ch1 实为太宋/アンチック、note 实为宋 Medium）：
// main/sum/mes=黑 Regular；note=宋 Medium；ch1/ch2=宋 Bold；ch3=纯宋 Bold；ctt1=宋 SemiBold；ctt2/cont=宋 Light。
// 日翻标题三档自重（ch1 0.371 > ch2 0.342 > ch3 0.314）全部挤在思源 Bold 一档附近，
// 经 Apple Books 实机校准用「Bold 字面 × 是否抑制合成」逼近：
//   h4/ch1 = Bold+合成（纯 Heavy 实机偏重）、h3/ch2 = Bold+合成、h5/ch3 = 纯 Bold（SemiBold+合成实机偏轻）。
export const SOURCE_FONTS = {
  sansRegular:   path.join(BOOKS, 'source-han-sans-sc/SourceHanSansSC-Regular.otf'),
  serifLight:    path.join(BOOKS, 'source-han-serif-sc/SourceHanSerifSC-Light.otf'),
  serifMedium:   path.join(BOOKS, 'source-han-serif-sc/SourceHanSerifSC-Medium.otf'),
  serifSemiBold: path.join(BOOKS, 'source-han-serif-sc/SourceHanSerifSC-SemiBold.otf'),
  serifBold:     path.join(BOOKS, 'source-han-serif-sc/SourceHanSerifSC-Bold.otf'),
  serifBoldSub:  path.join(BOOKS, 'source-han-serif-sc/SourceHanSerifSC-Bold.otf'),
};

// @font-face 默认不声明 font-weight：日翻原版即单面族+规则层 font-weight，
// 保留规则层声明可让阅读器合成加粗行为与原版一致。
// 唯一例外是副标题 Bold Sub 面（与 serifBold 同源、按 h5/.ch3 用字独立子集化）：
// 声明 font-weight:bold 让 bold 请求精确命中该面、抑制合成，渲染纯 Bold，
// 恰好落在「SemiBold+合成」（实机偏轻）与「Bold+合成」（=h3/h4）之间。
export const NEW_FONTS = [
  { role: 'sansRegular',   file: 'SourceHanSansSC-Regular.subset.otf',   family: 'Source Han Sans SC' },
  { role: 'serifLight',    file: 'SourceHanSerifSC-Light.subset.otf',    family: 'Source Han Serif SC Light' },
  { role: 'serifMedium',   file: 'SourceHanSerifSC-Medium.subset.otf',   family: 'Source Han Serif SC Medium' },
  { role: 'serifSemiBold', file: 'SourceHanSerifSC-SemiBold.subset.otf', family: 'Source Han Serif SC SemiBold' },
  { role: 'serifBold',     file: 'SourceHanSerifSC-Bold.subset.otf',     family: 'Source Han Serif SC Bold' },
  { role: 'serifBoldSub',  file: 'SourceHanSerifSC-BoldSub.subset.otf',  family: 'Source Han Serif SC Bold Sub', weight: 'bold' },
];

// 先剔除 style/script 整块（CSS/JS 文本不是可渲染内容），再剥标签与实体
const stripTags = (html) => html
  .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]+;/g, ' ');
const addChars = (set, s) => { for (const c of s) if (c.codePointAt(0) >= 0x20) set.add(c); };
const isHan = (c) => /\p{Script=Han}/u.test(c);

export function extractCharsets(xhtmlList) {
  const sansRegular = new Set();
  const serifLight = new Set();
  const serifMedium = new Set();
  const serifSemiBold = new Set();
  const serifBold = new Set();
  const serifBoldSub = new Set();
  for (const { name, text } of xhtmlList) {
    addChars(sansRegular, stripTags(text));

    // ch2 章节大标题（h3）与 ch1 分隔标题（h4/.cut）同走宋 Bold+合成链。
    for (const m of text.matchAll(/<h[34]\b[^>]*>([\s\S]*?)<\/h[34]>/gi)) addChars(serifBold, stripTags(m[1]));
    for (const m of text.matchAll(classBlockRe(['cut', 'ch1', 'ch2']))) addChars(serifBold, stripTags(m[2]));

    // ch3 副标题链（h5）走纯宋 Bold（抑制合成）。
    for (const m of text.matchAll(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi)) addChars(serifBoldSub, stripTags(m[1]));
    for (const m of text.matchAll(classBlockRe(['ch3']))) addChars(serifBoldSub, stripTags(m[2]));

    // ctt1 是宋体半粗目录条目链；TOC 文件整页补入，兼容多种目录模板。
    for (const m of text.matchAll(classBlockRe(['ctt1', 'toc']))) addChars(serifSemiBold, stripTags(m[2]));

    // note 是宋体 Medium 注释链。
    for (const m of text.matchAll(classBlockRe(['note', 'duokan-footnote-item']))) addChars(serifMedium, stripTags(m[2]));

    // ctt2 是宋体细目录大标题链；TOC 文件整页补入兜底。
    for (const m of text.matchAll(classBlockRe(['ctt', 'ctt2', 'ctit']))) addChars(serifLight, stripTags(m[2]));
    if (/\/(TOC|navigation-documents)(?:_split_\d+)?\.xhtml$/i.test(name)) {
      addChars(serifSemiBold, stripTags(text));
      addChars(serifLight, stripTags(text));
    }
  }
  const sets = { sansRegular, serifLight, serifMedium, serifSemiBold, serifBold, serifBoldSub };
  const symbols = [...sansRegular].filter((c) => !isHan(c));
  for (const set of Object.values(sets)) {
    for (const c of symbols) set.add(c);
  }
  return sets;
}

const FAMILY_OF = {
  main: 'sansRegular', sum: 'sansRegular', mes: 'sansRegular',
  int: 'sansRegular', title: 'sansRegular',
  note: 'serifMedium',
  ch1: 'serifBold', ch2: 'serifBold',
  ch3: 'serifBoldSub',
  ctt1: 'serifSemiBold',
  // cont 即「目录标题」链（13 卷 .ctt 实际引用 cont），与 ctt2 同归宋 Light
  ctt2: 'serifLight', cont: 'serifLight',
};
const FAMILY_NAME = Object.fromEntries(NEW_FONTS.map((font) => [font.role, `"${font.family}"`]));
const NEW_FAMILY_BY_NAME = Object.fromEntries(NEW_FONTS.map((font) => [font.family, `"${font.family}"`]));
const NEW_FONTFACE = NEW_FONTS
  .map((font) => `@font-face{font-family:"${font.family}";${font.weight ? `font-weight:${font.weight};` : ''}src:url(../Fonts/${font.file});}`)
  .join('');

function classBlockRe(classNames) {
  return new RegExp(`<([a-z0-9]+)\\b[^>]*class=["'][^"']*\\b(?:${classNames.join('|')})\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi');
}

function firstFamily(value) {
  const v = value.trim().replace(/\s*!important\s*$/i, '');
  const quoted = v.match(/^(['"])(.*?)\1/);
  if (quoted) return quoted[2];
  return v.split(',')[0].trim().split(/\s+/)[0];
}

function injectFontFace(css) {
  const wsOrComment = /(?:\s|\/\*[\s\S]*?\*\/)*/y;
  const importRule = /@import\b[^;]+;\s*/y;
  let cursor = 0;
  let afterLastImport = -1;
  while (true) {
    wsOrComment.lastIndex = cursor;
    const skipped = wsOrComment.exec(css);
    cursor = skipped ? wsOrComment.lastIndex : cursor;
    importRule.lastIndex = cursor;
    const imported = importRule.exec(css);
    if (!imported) break;
    cursor = importRule.lastIndex;
    afterLastImport = cursor;
  }
  if (afterLastImport >= 0) return css.slice(0, afterLastImport) + NEW_FONTFACE + css.slice(afterLastImport);
  return NEW_FONTFACE + css;
}

async function subsetOne(srcPath, set) {
  if (!set.size) return null;
  const buf = fs.readFileSync(srcPath);
  return subsetFont(buf, [...set].join(''), { targetFormat: 'sfnt' });
}

export async function subsetAll(charsets, sources = SOURCE_FONTS) {
  const out = {};
  for (const def of NEW_FONTS) {
    out[def.role] = await subsetOne(sources[def.role], charsets[def.role] ?? new Set());
  }
  return out;
}

const FONTS_RE = /(^|\/)OEBPS\/Fonts\//;
const CSS_RE = /OEBPS\/Styles\/.*\.css$/;
const XHTML_RE = /OEBPS\/Text\/.*\.xhtml$/;
const OPF_RE = /OEBPS\/content\.opf$/;

export async function applyToFiles(files, sources = SOURCE_FONTS) {
  const xhtmlList = Object.keys(files)
    .filter((n) => XHTML_RE.test(n))
    .map((n) => ({ name: n, text: files[n].toString('utf8') }));
  const fonts = await subsetAll(extractCharsets(xhtmlList), sources);
  for (const n of Object.keys(files)) if (FONTS_RE.test(n)) delete files[n];
  for (const def of NEW_FONTS) {
    if (fonts[def.role]) files[`OEBPS/Fonts/${def.file}`] = fonts[def.role];
  }
  for (const n of Object.keys(files)) if (CSS_RE.test(n)) files[n] = Buffer.from(rewriteCss(files[n].toString('utf8')));
  for (const { name, text } of xhtmlList) {
    const rewritten = rewriteInlineStyles(text);
    if (rewritten !== text) files[name] = Buffer.from(rewritten);
  }
  for (const n of Object.keys(files)) if (OPF_RE.test(n)) files[n] = Buffer.from(rewriteOpf(files[n].toString('utf8')));
  return fonts;
}

export async function applyToDir(oebpsDir, sources = SOURCE_FONTS) {
  const textDir = path.join(oebpsDir, 'Text');
  const fontsDir = path.join(oebpsDir, 'Fonts');
  const stylesDir = path.join(oebpsDir, 'Styles');
  const xhtmlList = fs.readdirSync(textDir)
    .filter((f) => f.endsWith('.xhtml'))
    .map((f) => ({ name: `OEBPS/Text/${f}`, text: fs.readFileSync(path.join(textDir, f), 'utf8') }));
  const fonts = await subsetAll(extractCharsets(xhtmlList), sources);
  for (const f of fs.readdirSync(fontsDir)) fs.rmSync(path.join(fontsDir, f));
  for (const def of NEW_FONTS) {
    if (fonts[def.role]) fs.writeFileSync(path.join(fontsDir, def.file), fonts[def.role]);
  }
  for (const f of fs.readdirSync(stylesDir)) {
    if (!f.endsWith('.css')) continue;
    const p = path.join(stylesDir, f);
    fs.writeFileSync(p, rewriteCss(fs.readFileSync(p, 'utf8')), 'utf8');
  }
  for (const { name, text } of xhtmlList) {
    const rewritten = rewriteInlineStyles(text);
    if (rewritten !== text) fs.writeFileSync(path.join(oebpsDir, name.replace(/^OEBPS\//, '')), rewritten, 'utf8');
  }
  const opfPath = path.join(oebpsDir, 'content.opf');
  if (fs.existsSync(opfPath)) fs.writeFileSync(opfPath, rewriteOpf(fs.readFileSync(opfPath, 'utf8')), 'utf8');
  return fonts;
}

export function rewriteOpf(opfText) {
  return opfText.replace(/<manifest\b([^>]*)>([\s\S]*?)<\/manifest>/i, (m, attrs, body) => {
    const multiline = body.includes('\n');
    const itemIndent = body.match(/\n([ \t]*)<item\b/)?.[1] ?? (multiline ? '    ' : '');
    const sep = multiline ? '\n' : '';
    const oldFontItem = /[ \t]*<item\b(?=[^>]*\bhref=["']Fonts\/[^"']+\.(?:ttf|otf)["'])(?=[^>]*(?:\bmedia-type=["'](?:font\/(?:ttf|otf)|application\/vnd\.ms-opentype)["']|\.ttf["']|\.otf["']))[^>]*\/?>[ \t]*(?:\r?\n)?/gi;
    const cleaned = body.replace(oldFontItem, '');
    const fontItems = NEW_FONTS
      .map((font) => `${itemIndent}<item id="${fontManifestId(font.file)}" href="Fonts/${font.file}" media-type="font/otf"/>`)
      .join(sep);
    const needsLeadingSep = multiline && cleaned.trimEnd().length > 0 && !cleaned.trimEnd().endsWith('\n');
    return `<manifest${attrs}>${cleaned.trimEnd()}${needsLeadingSep ? '\n' : ''}${fontItems}${multiline ? '\n' : ''}</manifest>`;
  });
}

function fontManifestId(file) {
  return `font_${file.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')}`;
}

function remapCss(cssText) {
  // 1. 删所有旧 @font-face 块
  let css = cssText.replace(/@font-face\s*\{[^}]*\}/g, '');
  // 2. 重映射 font-family 声明
  css = css.replace(/font-family\s*:\s*([^;}]+)([;}])/g, (m, value, end) => {
    const first = firstFamily(value);
    if (first === 'initial' || first === 'inherit') return m;
    if (FAMILY_OF[first]) return `font-family:${FAMILY_NAME[FAMILY_OF[first]]}${end}`;
    if (NEW_FAMILY_BY_NAME[first]) return `font-family:${NEW_FAMILY_BY_NAME[first]}${end}`;
    // 孤儿（illus*/num/emoji/sym/未知）：删除该声明
    return end === ';' ? '' : end;
  });
  // 3. 去掉块内最后声明多余的分号（;}  →  }）以规范化输出
  return css.replace(/;}/g, '}');
}

export function rewriteCss(cssText) {
  // 重映射后插入新 @font-face；若文件用 @import 聚合样式，则必须排在 import 之后
  return injectFontFace(remapCss(cssText));
}

// xhtml 内联 <style>（如 TOC 模板）只做 family 重映射，不注入 @font-face——
// 字体声明由页面链接的 Styles/*.css 提供，避免每页重复声明。
export function rewriteInlineStyles(xhtmlText) {
  return xhtmlText.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, open, body, close) => {
    if (!/font-family/i.test(body)) return m;
    return open + remapCss(body) + close;
  });
}
