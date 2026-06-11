/**
 * hyread-to-simple.js — HyRead EPUB → 台简 EPUB CLI 入口
 *
 * 用法:
 *   node src/entries/hyread-to-simple.js \
 *     --source output/hyread/...13.[台繁].hyread.epub \
 *     --ref    "[三河ごーすと].义妹生活.13.[日翻].epub" \
 *     --style-ref output/healed/...13.[日翻].healed.epub \
 *     --out output/simple/...13.[台简].epub \
 *     --volume 13 [--include-specials] [--credit-name 嘻嘻嘻]
 */

import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

import { parseHyreadEpubToBook } from '../../books/yimei-seikatsu/hyread-parser.js';
import { buildLightNovelEpubFromBook } from '../../books/yimei-seikatsu/lightnovel-html/index.js';

export async function buildHyreadToSimple({
  sourceEpubPath,
  refEpubPath,
  styleRefEpubPath = null,
  outEpubPath,
  volume = '13',
  includeSpecials = true,
  creditName = '嘻嘻嘻',
  creditSource = null,
  creditInput = null,
}) {
  const creditOverrides = {
    图源: creditSource || creditName,
    录入: creditInput || creditName,
  };

  const book = await parseHyreadEpubToBook(sourceEpubPath, { volume, creditOverrides });
  const sourceImages = book._sourceImages;
  delete book._sourceImages; // 内部字段，不传给渲染管线

  const result = await buildLightNovelEpubFromBook(book, {
    sourceImages,
    refEpubPath,
    styleRefEpubPath,
    outEpubPath,
    volume,
    includeSpecials,
    creditOverrides,
  });

  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values: opts } = parseArgs({
    options: {
      source: { type: 'string' },
      ref: { type: 'string' },
      'style-ref': { type: 'string' },
      out: { type: 'string' },
      volume: { type: 'string', default: '13' },
      'include-specials': { type: 'boolean', default: true },
      'credit-name': { type: 'string', default: '嘻嘻嘻' },
      'credit-source': { type: 'string' },
      'credit-input': { type: 'string' },
    },
    strict: true,
  });

  const result = await buildHyreadToSimple({
    sourceEpubPath: opts.source,
    refEpubPath: opts.ref,
    styleRefEpubPath: opts['style-ref'] || null,
    outEpubPath: opts.out,
    volume: opts.volume,
    includeSpecials: opts['include-specials'],
    creditName: opts['credit-name'],
    creditSource: opts['credit-source'] || null,
    creditInput: opts['credit-input'] || null,
  });

  console.log(`完成: ${result.outEpubPath}`);
  console.log(`卷 ${opts.volume}: 章节 ${result.book.chapters.length}, 图片 ${result.images.length}`);
}
