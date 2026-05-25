/**
 * 三套 TOC 渲染（移植自 Python toc_builder.py）。
 *
 * TocEntry = { title, href, children? }
 *
 * normalizeSpace: 递归把全角空格 U+3000 → 半角，避免多看据宽度自动加大行间距。
 * flatten: 把含 children 的嵌套 entries 平铺为单层（用于 TOC.xhtml 视觉目录）。
 * assignPlayOrder: 给 NCX 嵌套 entries 预计算 playOrder / id（DFS 全局递增），
 *                  让模板只需按结构递归渲染。
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nunjucks from 'nunjucks';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

let envCache = null;
function getEnv() {
  if (envCache) return envCache;
  envCache = nunjucks.configure(TEMPLATES_DIR, {
    autoescape: false,
    trimBlocks: false,
    lstripBlocks: false,
    noCache: true,
  });
  return envCache;
}

/**
 * 递归规范化 entries 的 title 中的全角空格 U+3000 → 半角空格。
 * 保留 children 结构。
 * @param {Array<{title: string, href: string, children?: Array}>} entries
 * @returns {Array<{title: string, href: string, children?: Array}>}
 */
export function normalizeSpace(entries) {
  return entries.map((e) => {
    const out = {
      title: String(e.title).replaceAll('　', ' '),
      href: e.href,
    };
    if (Array.isArray(e.children)) {
      out.children = normalizeSpace(e.children);
    }
    return out;
  });
}

/**
 * 把嵌套 entries（含 children）平铺为单层。
 * @param {Array<{title: string, href: string, children?: Array}>} entries
 * @returns {Array<{title: string, href: string}>}
 */
export function flatten(entries) {
  const out = [];
  for (const e of entries) {
    out.push({ title: e.title, href: e.href });
    if (Array.isArray(e.children)) {
      out.push(...flatten(e.children));
    }
  }
  return out;
}

/**
 * DFS 给嵌套 entries 预计算 playOrder/id，全局递增。
 * 返回新结构 { title, href, id, playOrder, children? }，保持嵌套。
 * @param {Array<{title: string, href: string, children?: Array}>} entries
 * @returns {Array<{title: string, href: string, id: string, playOrder: number, children?: Array}>}
 */
export function assignPlayOrder(entries) {
  let counter = 0;
  const walk = (es) => es.map((e) => {
    counter += 1;
    const idx = counter;
    const node = {
      title: e.title,
      href: e.href,
      id: `navPoint-${idx}`,
      playOrder: idx,
    };
    if (Array.isArray(e.children) && e.children.length > 0) {
      node.children = walk(e.children);
    }
    return node;
  });
  return walk(entries);
}

/**
 * 计算嵌套 entries 的最大深度（无 children 即 1，有 children 则递归 + 1）。
 * @param {Array<{children?: Array}>} entries
 * @returns {number}
 */
function maxDepth(entries) {
  let d = 1;
  for (const e of entries) {
    if (Array.isArray(e.children) && e.children.length > 0) {
      d = Math.max(d, 1 + maxDepth(e.children));
    }
  }
  return d;
}

/**
 * @param {{ title: string, uuid: string, entries: Array<{title: string, href: string, children?: Array}> }} args
 * @returns {string}
 */
export function buildTocNcx({ title, uuid, entries }) {
  const normalized = normalizeSpace(entries);
  const numbered = assignPlayOrder(normalized);
  const depth = maxDepth(numbered);
  // toc.ncx 在 Python golden 末尾**无** newline，byte-level 对齐时显式 trimEnd。
  return getEnv()
    .render('toc.ncx.njk', { title, uuid, entries: numbered, depth })
    .replace(/\n+$/, '');
}

/**
 * @param {{ title: string, entries: Array<{title: string, href: string, children?: Array}> }} args
 * @returns {string}
 */
export function buildNavXhtml({ title, entries }) {
  // navigation-documents.xhtml 是 EPUB 3 nav 文件，Python golden 末尾**无** newline，
  // 与其他 xhtml 文件（chapter / extras）有 trailing \n 的风格不同。byte-level 对齐时
  // 必须显式 trimEnd，避免 nunjucks 渲染尾随 \n 与 golden 不一致。
  return getEnv().render('nav.xhtml.njk', { title, entries: normalizeSpace(entries) }).replace(/\n+$/, '');
}

/**
 * @param {{ entries: Array<{title: string, href: string, children?: Array}> }} args
 * @returns {string}
 */
export function buildTocXhtml({ entries }) {
  const flat = flatten(normalizeSpace(entries));
  return getEnv().render('TOC.xhtml.njk', { entries: flat });
}
