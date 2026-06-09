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
