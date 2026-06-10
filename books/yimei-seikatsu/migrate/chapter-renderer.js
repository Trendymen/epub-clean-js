/**
 * 章节 XHTML 渲染（移植自 Python chapter_renderer.py）。
 *
 * blocks 是混合列表，每项可以是：
 *   - 纯字符串：段落文本（可能含已插入的 <sup>...</sup> 内联 HTML）
 *   - 以 '<div' 开头的字符串：章内插图 HTML（不被 <p> 包裹）
 *   - dict {para: string, aside: string}：含注释的段落 → 用 <note> 包裹 p+aside
 *     (script.js 要求 sup 和 aside 在同一个 <note> 元素内一一配对)
 *
 * footnoteAsides 参数为兼容旧调用保留，已弃用；新代码请改在 blocks 里
 * 使用 {para, aside} dict 项与对应段落配对。
 */
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nunjucks from 'nunjucks';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

let envCache = null;

function getEnv() {
  if (envCache) return envCache;
  const env = nunjucks.configure(TEMPLATES_DIR, {
    autoescape: false,
    trimBlocks: false,
    lstripBlocks: false,
    noCache: true,
  });
  env.addFilter('startsWith', (str, prefix) =>
    Boolean(str) && typeof str === 'string' && str.startsWith(prefix),
  );
  envCache = env;
  return env;
}

/**
 * 计算字符串 trim 后的 sha256 hex。
 * @param {string} s
 * @returns {string}
 */
function sha256(s) {
  return createHash('sha256').update(String(s).trim(), 'utf8').digest('hex');
}

/**
 * 判断章节首段是否与全书引言文本一致（用于第 1 章去重）。
 * 接受字符串或 {para, aside} dict 类型的 firstPara。
 *
 * @param {string | {para?: string, aside?: string} | null | undefined} firstPara
 * @param {string | null | undefined} epigraph
 * @returns {boolean}
 */
export function isFirstParaEpigraph(firstPara, epigraph) {
  if (!epigraph || !firstPara) return false;
  const text =
    typeof firstPara === 'string'
      ? firstPara
      : (firstPara && typeof firstPara === 'object' ? (firstPara.para ?? '') : '');
  if (!text) return false;
  return sha256(text) === sha256(epigraph);
}

/**
 * 渲染单个章节 XHTML。
 *
 * @param {{
 *   title: string,
 *   blocks: Array<string | {para: string, aside: string}>,
 *   footnoteAsides?: string[],
 *   chapterNumber?: number,
 *   epigraph?: string,
 *   headingParts?: {h4?: string, h5?: string},
 * }} args
 * headingParts 用于特典两级标题（h4 来源行 + h5 作品名，对齐日翻排版）；缺省时输出单行 h3。
 * @returns {string}
 */
export function renderChapter({
  title,
  blocks,
  footnoteAsides,
  chapterNumber,
  epigraph,
  headingParts,
}) {
  if (footnoteAsides && footnoteAsides.length > 0) {
    console.warn(
      '[chapter-renderer] `footnoteAsides` is deprecated; pass `{para, aside}` dict in blocks instead',
    );
  }

  let workingBlocks = Array.isArray(blocks) ? blocks : [];
  if (chapterNumber === 1 && epigraph) {
    if (workingBlocks.length > 0 && isFirstParaEpigraph(workingBlocks[0], epigraph)) {
      workingBlocks = workingBlocks.slice(1);
    } else {
      console.warn(
        '[chapter1] epigraph hash mismatch, keeping para[0] verbatim',
      );
    }
  }

  const env = getEnv();
  return env.render('chapter.xhtml.njk', {
    title,
    headingParts: (headingParts && (headingParts.h4 || headingParts.h5)) ? headingParts : null,
    blocks: workingBlocks,
    // 仍把 footnoteAsides 传给模板以保持向后兼容，
    // 但模板不再使用它（asides 应通过 dict block 内嵌进 <note>）。
    footnoteAsides: footnoteAsides ?? [],
  });
}
