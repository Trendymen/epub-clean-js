import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveInputs } from '../../../src/entries/lightnovel-html-simple-batch.js';

async function touch(file) {
  await writeFile(file, '');
}

test('resolveInputs pins 11-13 style refs to healed 日翻 and keeps the 07 台简 layout ref', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ln-simple-batch-'));
  try {
    await mkdir(join(root, 'output/healed'), { recursive: true });
    await mkdir(join(root, 'output/hyread'), { recursive: true });
    await touch(join(root, '[三河ごーすと].义妹生活.07.[台简].epub'));
    await touch(join(root, '[三河ごーすと].义妹生活.11.[日翻].epub'));
    await touch(join(root, '[三河ごーすと].义妹生活.12.[日翻].epub'));
    await touch(join(root, '[三河ごーすと].义妹生活.13.[日翻].epub'));
    await touch(join(root, '义妹生活12[台繁].epub'));

    for (const volume of ['11', '12', '13']) {
      await touch(join(root, 'output/healed', `[三河ごーすと].义妹生活.${volume}.[日翻].healed.epub`));
    }
    await touch(join(root, 'output/hyread', '[三河ごーすと].义妹生活.11.[台繁].hyread.epub'));
    await touch(join(root, 'output/hyread', '[三河ごーすと].义妹生活.13.[台繁].hyread.epub'));

    for (const volume of ['11', '12', '13']) {
      const inputs = resolveInputs(root, volume);
      assert.equal(inputs.refEpubPath, join(root, '[三河ごーすと].义妹生活.07.[台简].epub'));
      assert.equal(inputs.styleRefEpubPath, join(root, 'output/healed', `[三河ごーすと].义妹生活.${volume}.[日翻].healed.epub`));
      assert.notEqual(inputs.styleRefEpubPath, join(root, `[三河ごーすと].义妹生活.${volume}.[日翻].epub`));
    }

    assert.equal(resolveInputs(root, '11').sourceImageEpubPath, join(root, 'output/hyread', '[三河ごーすと].义妹生活.11.[台繁].hyread.epub'));
    assert.equal(resolveInputs(root, '12').sourceImageEpubPath, join(root, '义妹生活12[台繁].epub'));
    assert.equal(resolveInputs(root, '13').sourceImageEpubPath, join(root, 'output/hyread', '[三河ごーすと].义妹生活.13.[台繁].hyread.epub'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
