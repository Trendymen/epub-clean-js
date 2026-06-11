import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

import { buildLightNovelEpub, buildLightNovelEpubFromBook } from '../../books/yimei-seikatsu/lightnovel-html/index.js';
import { parseHyreadEpubToBook } from '../../books/yimei-seikatsu/hyread-parser.js';

const defaultRoot = path.resolve(import.meta.dirname, '../../..');

function normalizeFileName(name) {
  return name.normalize('NFC');
}

function findInDir(dir, predicate, description) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const hit = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .find((name) => predicate(normalizeFileName(name)));
  if (!hit) throw new Error(`Missing ${description} in ${dir}`);
  return path.join(dir, hit);
}

export function rubyAnnotationsForVolume(volume) {
  if (volume === '11') {
    return [
      {
        text: '社会数据科学Social Data Science',
        base: '社会数据科学',
        ruby: 'Social Data Science',
      },
      {
        text: '社会资料科学Social Data Science',
        base: '社会数据科学',
        ruby: 'Social Data Science',
      },
    ];
  }
  if (volume === '13') {
    // hyread 台繁源的三处 <ruby>，繁转简后正文被摊平成行内串，按摊平形态重建为真 ruby。
    return [
      { text: '浅村Asamura', base: '浅村', ruby: 'Asamura' },
      { text: '大山千春OoyamaChiharu', base: '大山千春', ruby: 'Ooyama Chiharu' },
      { text: '水星我们学校', base: '水星', ruby: '我们学校' },
    ];
  }
  return [];
}

function resolveSourceImageEpubPath(root, volume) {
  if (volume === '08' || volume === '11' || volume === '13') {
    const hyreadDir = path.join(root, 'output/hyread');
    if (fs.existsSync(hyreadDir)) {
      const hyreadSource = fs.readdirSync(hyreadDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .find((name) => normalizeFileName(name) === `[三河ごーすと].义妹生活.${volume}.[台繁].hyread.epub`);
      if (hyreadSource) return path.join(hyreadDir, hyreadSource);
    }
  }

  const taiwanSource = path.join(root, `义妹生活${volume}[台繁].epub`);
  if (fs.existsSync(taiwanSource)) return taiwanSource;

  return taiwanSource;
}

export function resolveInputs(root, volume) {
  const htmlPath = path.join(root, `${volume}.html`);
  const hasHtml = fs.existsSync(htmlPath);

  const refEpubPath = findInDir(
    root,
    (name) => name.includes('义妹生活.07.') && name.includes('[台简]') && name.endsWith('.epub'),
    '07 台简 reference EPUB',
  );
  const sourceImageEpubPath = resolveSourceImageEpubPath(root, volume);
  const healedDir = path.join(root, 'output/healed');
  const styleRefEpubPath = findInDir(
    healedDir,
    (name) => name.includes(`义妹生活.${volume}.`) && name.includes('[日翻].healed.epub'),
    `${volume} healed style-ref EPUB`,
  );

  return { htmlPath: hasHtml ? htmlPath : null, refEpubPath, sourceImageEpubPath, styleRefEpubPath };
}

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function backupOutputs(outDir, volumes) {
  const backupDir = path.join(outDir, `backup-before-build-${timestamp()}`);
  let count = 0;
  for (const volume of volumes) {
    const baseName = `[三河ごーすと].义妹生活.${volume}.[台简]`;
    for (const suffix of ['', '[特典]']) {
      const src = path.join(outDir, `${baseName}${suffix}.epub`);
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(src, path.join(backupDir, path.basename(src)));
      count += 1;
    }
  }
  return count > 0 ? backupDir : null;
}

export async function runBatch({ root = defaultRoot, outDir = null, volumes = ['11', '12'], creditName = '嘻嘻嘻', backup = true } = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedOutDir = path.resolve(outDir || path.join(resolvedRoot, 'output/simple'));
  const creditOverrides = {
    图源: creditName,
    录入: creditName,
  };

  fs.mkdirSync(resolvedOutDir, { recursive: true });
  const backupDir = backup ? backupOutputs(resolvedOutDir, volumes) : null;
  if (backupDir) console.log(`已备份当前成品: ${backupDir}`);

  for (const volume of volumes) {
    const inputs = resolveInputs(resolvedRoot, volume);
    const baseName = `[三河ごーすと].义妹生活.${volume}.[台简]`;
    const common = {
      ...inputs,
      volume,
      creditOverrides,
      rubyAnnotations: rubyAnnotationsForVolume(volume),
    };

    // 卷13 没有 HTML 源，使用 hyread EPUB 直转路径
    const isHyreadDirect = !inputs.htmlPath;

    for (const variant of [
      { suffix: '', includeSpecials: false },
      { suffix: '[特典]', includeSpecials: true },
    ]) {
      const outEpubPath = path.join(resolvedOutDir, `${baseName}${variant.suffix}.epub`);

      let result;
      if (isHyreadDirect) {
        const book = await parseHyreadEpubToBook(inputs.sourceImageEpubPath, { volume, creditOverrides });
        const sourceImages = book._sourceImages;
        delete book._sourceImages;
        result = await buildLightNovelEpubFromBook(book, {
          sourceImages,
          ...common,
          outEpubPath,
          includeSpecials: variant.includeSpecials,
        });
      } else {
        result = await buildLightNovelEpub({
          ...common,
          outEpubPath,
          includeSpecials: variant.includeSpecials,
        });
      }

      console.log(`完成: ${result.outEpubPath}`);
      console.log(`卷 ${volume}${variant.suffix || ''}: 章节 ${result.book.chapters.length}, 图片 ${result.images.length}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values: opts } = parseArgs({
    options: {
      root: { type: 'string' },
      'out-dir': { type: 'string' },
      volumes: { type: 'string', default: '11,12' },
      'credit-name': { type: 'string', default: '嘻嘻嘻' },
      'skip-backup': { type: 'boolean', default: false },
    },
    strict: true,
  });

  await runBatch({
    root: opts.root || defaultRoot,
    outDir: opts['out-dir'] || null,
    volumes: opts.volumes.split(',').map((item) => item.trim()).filter(Boolean),
    creditName: opts['credit-name'],
    backup: !opts['skip-backup'],
  });
}
