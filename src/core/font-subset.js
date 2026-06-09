import fs from 'node:fs';
import path from 'node:path';
import subsetFont from 'subset-font';

const BOOKS = path.resolve(import.meta.dirname, '../../books');

export const SOURCE_FONTS = {
  serifRegular: path.join(BOOKS, 'source-han-serif-sc/SourceHanSerifSC-Regular.otf'),
  serifBold:    path.join(BOOKS, 'source-han-serif-sc/SourceHanSerifSC-Bold.otf'),
};

export const NEW_FONTS = [
  { role: 'regular', file: 'SourceHanSerifSC-Regular.subset.otf', family: 'Source Han Serif SC',      weight: null },
  { role: 'bold',    file: 'SourceHanSerifSC-Bold.subset.otf',    family: 'Source Han Serif SC Bold', weight: 700 },
];

const stripTags = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
const addChars = (set, s) => { for (const c of s) if (c.codePointAt(0) >= 0x20) set.add(c); };
const isHan = (c) => /\p{Script=Han}/u.test(c);

export function extractCharsets(xhtmlList) {
  const regular = new Set();
  const bold = new Set();
  for (const { name, text } of xhtmlList) {
    addChars(regular, stripTags(text));
    // h3(章节标题)/h4(=ch1 分隔标题，实为粗宋)/目录/.cut/.ch1 全归 bold
    for (const m of text.matchAll(/<h[34]\b[^>]*>([\s\S]*?)<\/h[34]>/gi)) addChars(bold, stripTags(m[1]));
    for (const m of text.matchAll(/<[^>]*class="[^"]*\b(?:cut|ch1)\b[^"]*"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/gi)) addChars(bold, stripTags(m[1]));
    if (/\/(TOC|navigation-documents)\.xhtml$/i.test(name)) addChars(bold, stripTags(text));
  }
  const symbols = [...regular].filter((c) => !isHan(c));
  for (const c of symbols) bold.add(c);
  return { regular, bold };
}

const FAMILY_OF = {
  main: 'serif', ch3: 'serif', sum: 'serif', mes: 'serif', note: 'serif', cont: 'serif', int: 'serif', title: 'serif',
  ch2: 'serifBold', ctt1: 'serifBold', ctt2: 'serifBold', ch1: 'serifBold',
};
const FAMILY_NAME = {
  serif: '"Source Han Serif SC"',
  serifBold: '"Source Han Serif SC Bold"',
};
const NEW_FONTFACE =
  '@font-face{font-family:"Source Han Serif SC";src:url(../Fonts/SourceHanSerifSC-Regular.subset.otf);}' +
  '@font-face{font-family:"Source Han Serif SC Bold";font-weight:700;src:url(../Fonts/SourceHanSerifSC-Bold.subset.otf);}';

export function rewriteCss(cssText) {
  // 1. 删所有旧 @font-face 块
  let css = cssText.replace(/@font-face\s*\{[^}]*\}/g, '');
  // 2. 重映射 font-family 声明
  css = css.replace(/font-family\s*:\s*([^;}]+)([;}])/g, (m, value, end) => {
    const first = value.split(',')[0].trim().replace(/["']/g, '').split(/\s/)[0];
    if (first === 'initial' || first === 'inherit') return m;
    if (FAMILY_OF[first]) return `font-family:${FAMILY_NAME[FAMILY_OF[first]]}${end}`;
    // 孤儿（illus*/num/emoji/sym/未知）：删除该声明
    return end === ';' ? '' : end;
  });
  // 3. 去掉块内最后声明多余的分号（;}  →  }）以规范化输出
  css = css.replace(/;}/g, '}');
  // 4. 头部插入 2 个新 @font-face
  return NEW_FONTFACE + css;
}
