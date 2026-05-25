/**
 * 从 XHTML 抽取**正文**段落纯文本列表。
 *
 * 规则：
 * - 仅取 <p> 元素，按文档顺序
 * - 跳过 aside 内的 p（注释正文，由 footnote-extractor 单独处理）
 * - 去前后空白
 * - 跳过空段落
 * - ruby/rt 标签：保留 ruby 文本，丢弃 rt 注音
 * - sup 标签：暂时一并保留文本（注释定位时再用）
 */
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

/**
 * @param {string} xhtmlPath
 * @returns {string[]}
 */
export function extractParagraphs(xhtmlPath) {
  const xml = readFileSync(xhtmlPath, 'utf-8');
  const { document } = parseHTML(xml);
  const paragraphs = [];
  for (const p of document.querySelectorAll('p')) {
    // 跳过 aside 祖先内的 p（注释正文，由 footnote-extractor 单独处理）
    if (p.closest('aside')) continue;
    // 丢掉所有 rt 子节点（ruby 注音）
    for (const rt of [...p.querySelectorAll('rt')]) {
      rt.remove();
    }
    const text = (p.textContent ?? '').trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs;
}
