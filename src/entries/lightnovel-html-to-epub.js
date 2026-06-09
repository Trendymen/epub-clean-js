import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { buildLightNovelEpub } from '../../books/yimei-seikatsu/lightnovel-html/index.js';

const { values: opts } = parseArgs({
  options: {
    html: { type: 'string' },
    ref: { type: 'string' },
    'style-ref': { type: 'string' },
    'source-images': { type: 'string' },
    'image-ref': { type: 'string' },
    out: { type: 'string' },
    volume: { type: 'string', default: '11' },
    'skip-specials': { type: 'boolean', default: false },
    'credit-source': { type: 'string' },
    'credit-input': { type: 'string' },
    ruby: { type: 'string', multiple: true },
  },
  strict: true,
});

for (const key of ['html', 'ref', 'out']) {
  if (!opts[key]) {
    console.error(`Missing required --${key}`);
    process.exit(2);
  }
}

const htmlPath = path.resolve(opts.html);
const refEpubPath = path.resolve(opts.ref);
const styleRefEpubPath = opts['style-ref'] ? path.resolve(opts['style-ref']) : null;
const sourceImageEpubPath = opts['source-images'] ? path.resolve(opts['source-images']) : null;
const imageRefEpubPath = opts['image-ref'] ? path.resolve(opts['image-ref']) : null;
const outEpubPath = path.resolve(opts.out);
const creditOverrides = {
  图源: opts['credit-source'] || '嘻嘻嘻',
  录入: opts['credit-input'] || '嘻嘻嘻',
};
const rubyAnnotations = opts.ruby?.map((raw) => {
  const [text, base, ruby] = String(raw).split('|');
  if (!text || !base || !ruby) {
    throw new Error(`Invalid --ruby value: ${raw}; expected text|base|ruby`);
  }
  return { text, base, ruby };
});

fs.mkdirSync(path.dirname(outEpubPath), { recursive: true });

const result = await buildLightNovelEpub({
  htmlPath,
  refEpubPath,
  styleRefEpubPath,
  sourceImageEpubPath,
  imageRefEpubPath,
  outEpubPath,
  volume: opts.volume,
  includeSpecials: !opts['skip-specials'],
  creditOverrides,
  ...(rubyAnnotations ? { rubyAnnotations } : {}),
});

console.log(`lightnovel-html-to-epub 完成: ${result.outEpubPath}`);
console.log(`章节: ${result.book.chapters.length}, 图片: ${result.images.length}`);
