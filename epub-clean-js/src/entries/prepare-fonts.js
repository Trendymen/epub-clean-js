import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { prepareFonts } from '../core/font-resources.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values: opts } = parseArgs({
    options: { 'cache-dir': { type: 'string' }, help: { type: 'boolean', short: 'h' } },
    strict: true,
  });
  if (opts.help) {
    console.log('Usage: npm run prepare:fonts -- [--cache-dir /path/to/verified-cache]\n校验并准备固定版本的 Adobe 思源字体与许可证；转换命令不会自动下载。');
  } else {
    const results = await prepareFonts({ cacheDir: opts['cache-dir'] || null });
    for (const result of results) console.log(`${result.source}: ${result.file}`);
  }
}
