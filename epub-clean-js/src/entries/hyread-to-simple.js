/**
 * hyread-to-simple.js — HyRead EPUB → 台简 EPUB CLI 入口
 *
 * 用法:
 *   # 11-13 会从统一 resolver 自动选择:
 *   #   ref       = 根目录 07 台简
 *   #   style-ref = output/healed/同卷 [日翻].healed.epub
 *   #   source    = resolver 指定的台繁/HyRead 图源
 *   node src/entries/hyread-to-simple.js \
 *     --out output/simple/...13.[台简].epub \
 *     --volume 13 [--root /path/to/义妹生活] [--include-specials] [--credit-name 嘻嘻嘻]
 */

import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

import { parseHyreadEpubToBook, parseAnotherDaysEpubToBook } from '../../books/yimei-seikatsu/hyread-parser.js';
import { buildLightNovelEpubFromBook } from '../../books/yimei-seikatsu/lightnovel-html/index.js';
import { defaultRoot, resolveInputs } from './lightnovel-html-simple-batch.js';

// 短篇合集卷走专门 parser（保留 p-fmatter 彩插与配对正文的 spine 穿插位置）
const ANOTHER_DAYS_VOLUMES = new Set(['another-days', 'an', 'AN']);
const PINNED_REFERENCE_VOLUMES = new Set(['11', '12', '13']);

export async function buildHyreadToSimple({
  sourceEpubPath,
  refEpubPath,
  styleRefEpubPath = null,
  outEpubPath,
  volume = '13',
  root = defaultRoot,
  includeSpecials = true,
  creditName = '嘻嘻嘻',
  creditSource = null,
  creditInput = null,
}) {
  const pinnedInputs = PINNED_REFERENCE_VOLUMES.has(volume)
    ? resolveInputs(path.resolve(root), volume)
    : null;
  const resolvedSourceEpubPath = sourceEpubPath || pinnedInputs?.sourceImageEpubPath;
  const resolvedRefEpubPath = refEpubPath || pinnedInputs?.refEpubPath;
  const resolvedStyleRefEpubPath = styleRefEpubPath || pinnedInputs?.styleRefEpubPath || null;
  if (!resolvedSourceEpubPath) throw new Error('Missing --source (or use --volume 11/12/13 with --root for resolver defaults)');
  if (!resolvedRefEpubPath) throw new Error('Missing --ref (or use --volume 11/12/13 with --root for resolver defaults)');
  if (!outEpubPath) throw new Error('Missing --out');

  const creditOverrides = {
    图源: creditSource || creditName,
    录入: creditInput || creditName,
  };

  const book = ANOTHER_DAYS_VOLUMES.has(volume)
    ? await parseAnotherDaysEpubToBook(resolvedSourceEpubPath, { volume, creditOverrides })
    : await parseHyreadEpubToBook(resolvedSourceEpubPath, { volume, creditOverrides });
  const sourceImages = book._sourceImages;
  delete book._sourceImages; // 内部字段，不传给渲染管线

  const result = await buildLightNovelEpubFromBook(book, {
    sourceImages,
    refEpubPath: resolvedRefEpubPath,
    styleRefEpubPath: resolvedStyleRefEpubPath,
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
      root: { type: 'string' },
      'include-specials': { type: 'boolean', default: true },
      'no-include-specials': { type: 'boolean', default: false },
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
    root: opts.root || defaultRoot,
    includeSpecials: opts['include-specials'] && !opts['no-include-specials'],
    creditName: opts['credit-name'],
    creditSource: opts['credit-source'] || null,
    creditInput: opts['credit-input'] || null,
  });

  console.log(`完成: ${result.outEpubPath}`);
  console.log(`卷 ${opts.volume}: 章节 ${result.book.chapters.length}, 图片 ${result.images.length}`);
}
