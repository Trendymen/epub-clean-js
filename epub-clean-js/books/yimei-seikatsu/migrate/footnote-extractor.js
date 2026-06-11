/**
 * DST 注释抽取（移植自 Python footnote_extractor.py）。
 *
 * 解析 DST 章节 XHTML 中的：
 *   <sup><a class="duokan-footnote" href="#noteXXX">
 *       <img zy-footnote="注释正文" src=".../note.webp"/>
 *   </a></sup>
 *
 * 并为每条注释生成 Footnote 对象，含 host 段落索引、段落纯文本、sup 偏移、前后上下文。
 *
 * Footnote = {
 *   originalId: string,
 *   text: string,
 *   imgFilename: string,
 *   hostParaText: string,
 *   hostParaIndex: number,
 *   supOffset: number,
 *   beforeCtx: string,
 *   afterCtx: string,
 * }
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseHTML } from 'linkedom';

const CTX_RADIUS = 30;

const SKIP_SUBTREE_TAGS = new Set(['RT', 'RP', 'SUP', 'ASIDE']);

/**
 * @param {string} xhtmlPath
 * @returns {Array<{
 *   originalId: string,
 *   text: string,
 *   imgFilename: string,
 *   hostParaText: string,
 *   hostParaIndex: number,
 *   supOffset: number,
 *   beforeCtx: string,
 *   afterCtx: string,
 * }>}
 */
export function extractFootnotes(xhtmlPath) {
  const xml = readFileSync(xhtmlPath, 'utf-8');
  const { document } = parseHTML(xml);

  // 跳过 aside 内的 <p>（与 paragraph-extractor 索引体系一致；注释正文不计入 hostParaIndex）。
  // sup 不会出现在 aside 内（aside 是注释正文容器），所以 host p 必然在正文 p 列表里。
  // 若两端用不一致的 p 序列，hostParaIndex 会比 align_pairs 用的 DST 索引偏大，
  // 导致 fuzzy 反查 SRC 时落到完全错误的段。
  const allParas = [...document.querySelectorAll('p')].filter(p => !p.closest('aside'));
  const paraIndex = new Map();
  allParas.forEach((p, i) => paraIndex.set(p, i));

  const notes = [];
  for (const sup of document.querySelectorAll('sup')) {
    const a = sup.querySelector('a');
    if (!a) continue;
    const cls = a.getAttribute('class') || '';
    if (!cls.split(/\s+/).includes('duokan-footnote')) continue;
    const img = a.querySelector('img');
    if (!img) continue;

    const zy = img.getAttribute('zy-footnote') || '';
    const imgSrc = img.getAttribute('src') || '';
    const imgFilename = basename(imgSrc);

    // 向上找 sup 所在的 <p>
    let hostP = sup.parentNode;
    while (hostP && hostP.tagName !== 'P') {
      hostP = hostP.parentNode;
    }
    if (!hostP || !paraIndex.has(hostP)) continue;

    const { text: hostParaText, supOffset } = textAndSupOffset(hostP, sup);

    const beforeCtx = hostParaText.substring(Math.max(0, supOffset - CTX_RADIUS), supOffset);
    const afterCtx = hostParaText.substring(supOffset, supOffset + CTX_RADIUS);

    const href = a.getAttribute('href') || '';
    const noteId = href.includes('#') ? href.split('#', 2)[1] : '';

    notes.push({
      originalId: noteId,
      text: zy,
      imgFilename,
      hostParaText,
      hostParaIndex: paraIndex.get(hostP),
      supOffset,
      beforeCtx,
      afterCtx,
    });
  }
  return notes;
}

/**
 * 计算 (段落纯文本, sup 在文本中的字符偏移)。
 *
 * 采用 DOM TreeWalker 等价的递归遍历：
 * - 跳过 rt/rp/sup/aside 子树（这些子树内的所有文本都不算）
 * - sup 子树根的 tail（即 sup 之后的文本）要算
 * - p_elem 自身的 tail 不算（不属于段落主文本）
 *
 * linkedom 的 textContent 会拼接所有后代文本，所以这里手写遍历。
 */
function textAndSupOffset(pElem, supElem) {
  const parts = [];
  /** @type {{ value: number }} */
  const offsetRef = { value: -1 };

  walk(pElem, supElem, parts, offsetRef, /*skipDepth*/ 0);

  return {
    text: parts.join(''),
    supOffset: Math.max(offsetRef.value, 0),
  };
}

/**
 * 递归遍历 elem 的所有子节点。
 * skipDepth>0 时表示在跳过子树内（rt/rp/sup/aside），所有 text 都不计。
 */
function walk(elem, supElem, parts, offsetRef, skipDepth) {
  // 节点类型常量：1 = ELEMENT_NODE, 3 = TEXT_NODE
  for (const child of [...elem.childNodes]) {
    if (child.nodeType === 3) {
      // 文本节点
      if (skipDepth === 0) {
        const t = child.nodeValue || '';
        if (t) parts.push(t);
      }
    } else if (child.nodeType === 1) {
      // 元素节点
      const tag = child.tagName;
      const isSkipRoot = SKIP_SUBTREE_TAGS.has(tag);

      // start 事件：在进入子节点前，先检查是否目标 sup
      if (child === supElem && skipDepth === 0) {
        offsetRef.value = parts.reduce((acc, s) => acc + s.length, 0);
      }

      if (isSkipRoot) {
        // 进入跳过子树，递归（skipDepth+1），但 elem.text 不被收（因为下层会跳过）
        walk(child, supElem, parts, offsetRef, skipDepth + 1);
        // end 事件：跳过子树根结束后，它的 tail（在 lxml 里是 child.tail）
        // 在 DOM 模型里对应「child 后面的下一个文本兄弟节点」——
        // 我们的 walk 已经在父循环里处理后续兄弟的文本节点了，所以这里不需要额外加。
      } else {
        // 正常递归
        walk(child, supElem, parts, offsetRef, skipDepth);
      }
    }
    // 其他 nodeType（注释等）忽略
  }
}
