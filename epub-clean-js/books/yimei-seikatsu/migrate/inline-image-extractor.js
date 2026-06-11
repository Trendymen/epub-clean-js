/**
 * 章内插图抽取（移植自 Python inline_image_extractor.py）。
 *
 * 从 DST XHTML 抽取 <div class="illus ..."> 插图（跳过 kuchie 类）。
 *
 * InlineImage = {
 *   alt: string,
 *   srcFilename: string,
 *   afterParaIndex: number,
 *   steraHtml: string,
 * }
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseHTML } from 'linkedom';

/**
 * @param {string} xhtmlPath
 * @returns {Array<{ alt: string, srcFilename: string, afterParaIndex: number, steraHtml: string }>}
 */
export function extractInlineImages(xhtmlPath) {
  const xml = readFileSync(xhtmlPath, 'utf-8');
  const { document } = parseHTML(xml);

  const images = [];
  const body = document.querySelector('body');
  if (!body) return images;

  let paraCount = 0;

  // 顺序遍历 body 下所有后代节点（深度优先，文档顺序）
  // 用 TreeWalker 风格的栈实现
  walk(body, (elem) => {
    const tag = elem.tagName;
    if (tag === 'P') {
      paraCount += 1;
    } else if (tag === 'DIV') {
      const cls = elem.getAttribute('class') || '';
      // 子串匹配（与 Python `"illus" in cls` 等价）：会命中 "illus"、
      // "illus duokan-image-single"、"illus-large"、"illustration" 等。
      if (!cls.includes('illus')) return;
      const img = elem.querySelector('img');
      if (!img) return;
      const src = img.getAttribute('src') || '';
      const srcFilename = basename(src);
      const alt = img.getAttribute('alt') || '';
      // 跳过 kuchie（kuchie 在专用 illusN.xhtml 章节里）
      if (srcFilename.includes('kuchie')) return;
      const steraHtml =
        `<div class="illus duokan-image-single">` +
        `<img alt="${alt}" src="../Images/${srcFilename}" zy-enlarge-src="self"/>` +
        `</div>`;
      images.push({
        alt,
        srcFilename,
        afterParaIndex: paraCount - 1,
        steraHtml,
      });
    }
  });

  return images;
}

/**
 * 深度优先顺序遍历所有后代元素节点。
 */
function walk(root, visit) {
  for (const child of [...root.childNodes]) {
    if (child.nodeType === 1) {
      visit(child);
      walk(child, visit);
    }
  }
}
