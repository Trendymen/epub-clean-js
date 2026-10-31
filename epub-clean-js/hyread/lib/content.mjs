import { DOMParser } from 'linkedom';

const BLOCK_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,div';
export const normalizeText = (text) => String(text ?? '').replace(/\s+/gu, ' ').trim();

export function inspectXhtml(html) {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const body = document.querySelector('body');
  if (!body) throw new Error('XHTML has no body');
  const blocks = Array.from(body.querySelectorAll(BLOCK_SELECTOR)).filter((node) => !node.querySelector(BLOCK_SELECTOR));
  return {
    bodyText: normalizeText(body.textContent),
    blocks: blocks.map((node) => ({ tag: node.localName.toLowerCase(), id: node.getAttribute('id') ?? '', text: normalizeText(node.textContent) })),
    images: Array.from(body.querySelectorAll('img,image'), (node) => ({ tag: node.localName.toLowerCase(), src: node.getAttribute('src') ?? node.getAttribute('href') ?? node.getAttribute('xlink:href') ?? '', alt: node.getAttribute('alt') ?? '' })),
    ruby: Array.from(body.querySelectorAll('ruby'), (node) => normalizeText(node.textContent)),
    links: Array.from(body.querySelectorAll('a[href]'), (node) => ({ text: normalizeText(node.textContent), href: node.getAttribute('href') })),
  };
}

export function applyApprovedCorrections(html, { volume, assetId, href }) {
  if (volume !== '08' || assetId !== '8a8a84ca8cf2eb56018d6786f66a472c' || href !== 'xhtml/p-toc-001.xhtml') return { html, corrections: [] };
  const corrections = [];
  for (const [from, to] of [['６月１日（星期五）', '６月１日（星期二）'], ['６月７日（星期六）', '６月７日（星期一）']]) {
    const occurrences = html.split(from).length - 1;
    html = html.split(from).join(to);
    corrections.push({ volume, assetId, file: href, from, to, occurrences, status: occurrences ? 'applied' : 'not-applicable' });
  }
  return { html, corrections };
}
