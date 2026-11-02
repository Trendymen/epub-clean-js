import { writeEpub } from '../../src/core/zip-io.js';

export const bodyParagraph = (html) => `<p class="__reader-text-indent__">${html}</p>`;
export const chapterPage = (html) => `<html><body><div class="main">${html}</div></body></html>`;

export async function writeHyreadFixture(filePath, {
  pages,
  toc = [['p-002.xhtml', '第一章']],
  tocBody = null,
  spine = Object.keys(pages),
  images = {},
}) {
  await writeEpub(filePath, {
    'item/standard.opf': `<package><manifest>${spine.map((name, i) => `<item id="p${i}" href="xhtml/${name}"/>`).join('')}</manifest><spine>${spine.map((_, i) => `<itemref idref="p${i}"/>`).join('')}</spine></package>`,
    'item/xhtml/p-toc-001.xhtml': `<html><body>${tocBody ?? toc.map(([href, title]) => `<a href="${href}">${title}</a>`).join('')}</body></html>`,
    'item/xhtml/p-cover.xhtml': '<html><body><img src="../image/cover.jpg"/></body></html>',
    'item/xhtml/p-colophon.xhtml': '<html><body><div class="publisher-data"><p>作者：三河ごーすと</p></div></body></html>',
    'item/image/cover.jpg': Buffer.from('cover'),
    ...Object.fromEntries(Object.entries(pages).map(([name, html]) => [`item/xhtml/${name}`, chapterPage(html)])),
    ...Object.fromEntries(Object.entries(images).map(([name, data]) => [`item/image/${name}`, data])),
  });
}
