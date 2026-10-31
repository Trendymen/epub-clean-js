import fs from 'node:fs';
import { parseHyreadEpubToBook } from '../../books/yimei-seikatsu/hyread-parser.js';
import { buildLightNovelEpubFromBook } from '../../books/yimei-seikatsu/lightnovel-html/index.js';

const [mode, source, ref, out] = process.argv.slice(2);
if (mode === 'write') {
  const createWriteStream = fs.createWriteStream;
  fs.createWriteStream = function (name, ...args) {
    const stream = createWriteStream.call(this, name, ...args);
    if (String(name).includes('.epub-build-')) {
      stream._write = (_chunk, _encoding, callback) => callback(new Error('injected staging write failure'));
    }
    return stream;
  };
} else if (mode === 'rename') {
  const rename = fs.promises.rename;
  fs.promises.rename = async function (from, to) {
    if (String(from).includes('.epub-build-')) throw new Error('injected staging rename failure');
    return rename.call(this, from, to);
  };
} else {
  throw new Error(`Unknown fault mode: ${mode}`);
}
const book = await parseHyreadEpubToBook(source, { volume: '14' });
await buildLightNovelEpubFromBook(book, {
  sourceImages: book._sourceImages,
  refEpubPath: ref,
  outEpubPath: out,
  includeSpecials: false,
});
