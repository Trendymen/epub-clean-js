import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, stat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { resolveInputs, runBatch } from '../../../src/entries/lightnovel-html-simple-batch.js';
import { buildHyreadToSimple } from '../../../src/entries/hyread-to-simple.js';
import { readEpub, writeEpub } from '../../../src/core/zip-io.js';
import { writeHyreadFixture, bodyParagraph } from '../../helpers/hyread-fixture.js';

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

test('numeric volumes resolve NFC/NFD HyRead sources without a whitelist and preserve 12 source priority', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ln-numeric-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'output/healed'), { recursive: true });
  await mkdir(join(root, 'output/hyread'), { recursive: true });
  const ref = join(root, '[三河ごーすと].义妹生活.07.[台简].epub'.normalize('NFD'));
  await touch(ref);
  for (const volume of ['08', '11', '12', '13', '14', '28']) {
    const source = join(root, 'output/hyread', `[三河ごーすと].义妹生活.${volume}.[台繁].hyread.epub`.normalize('NFD'));
    const style = join(root, 'output/healed', `[三河ごーすと].义妹生活.${volume}.[日翻].healed.epub`.normalize('NFD'));
    await touch(source);
    await touch(style);
    const legacy = join(root, `义妹生活${volume}[台繁].epub`);
    await touch(legacy);
    assert.equal(resolveInputs(root, volume).sourceImageEpubPath, volume === '12' ? legacy : source);
    assert.equal(resolveInputs(root, volume).styleRefEpubPath, style);
    assert.equal(resolveInputs(root, volume).refEpubPath, ref);
    await rm(legacy);
    assert.equal(resolveInputs(root, volume).sourceImageEpubPath, source);
  }
});

test('explicit paths bypass unrelated default directories, and missing explicit inputs fail before output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ln-explicit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source.epub');
  const ref = join(root, 'ref.epub');
  const style = join(root, 'style.epub');
  await writeHyreadFixture(source, { pages: { 'p-002.xhtml': bodyParagraph('顯式正文') } });
  await writeEpub(ref, { 'OEBPS/Styles/stylesheet.css': '', 'OEBPS/Misc/script.js': '' });
  await writeEpub(style, {});
  for (const volume of ['11', '14', '28', 'another-days']) {
    const out = join(root, `${volume}.epub`);
    await buildHyreadToSimple({ root: join(root, 'absent'), sourceEpubPath: source,
      refEpubPath: ref, styleRefEpubPath: volume === '11' ? style : null,
      outEpubPath: out, volume, includeSpecials: false });
    const epub = await readEpub(out);
    assert.ok(Object.values(epub.entries).some(data => data.toString().includes('显式正文')));
  }
  const out = join(root, 'missing-output.epub');
  const missing = join(root, 'missing.epub');
  await assert.rejects(buildHyreadToSimple({ root, sourceEpubPath: missing,
    refEpubPath: ref, volume: '28', outEpubPath: out }), error => error.message.includes(missing));
  await assert.rejects(stat(out), { code: 'ENOENT' });
});

test('batch preflights every volume before creating outputs or backups', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ln-preflight-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'output/healed'), { recursive: true });
  await touch(join(root, '[三河ごーすと].义妹生活.07.[台简].epub'));
  await touch(join(root, 'output/healed/[三河ごーすと].义妹生活.14.[日翻].healed.epub'));
  const outDir = join(root, 'products');
  await assert.rejects(runBatch({ root, volumes: ['14'], outDir }), error =>
    error.message.includes(join(root, 'output/hyread')) && error.message.includes('.14.'));
  await assert.rejects(stat(outDir), { code: 'ENOENT' });
});

test('batch CLI keeps 11-13 defaults and explicit volumes replace that batch', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ln-batch-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'output/healed'), { recursive: true });
  await touch(join(root, '[三河ごーすと].义妹生活.07.[台简].epub'));
  const cli = fileURLToPath(new URL('../../../bin/cli.js', import.meta.url));
  for (const [args, expected] of [[[], '11'], [['--volumes', '28'], '28']]) {
    const out = join(root, `out-${expected}`);
    const result = spawnSync(process.execPath, [cli, 'build-yimei-simple', '--root', root, '--out-dir', out, ...args], { cwd: tmpdir(), encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(`.${expected}.`), result.stderr);
    await assert.rejects(stat(out), { code: 'ENOENT' });
  }
});

test('default batch builds only 11-13 and backs up both versions before replacement', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ln-default-products-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'output/healed'), { recursive: true });
  await mkdir(join(root, 'output/hyread'), { recursive: true });
  await writeEpub(join(root, '[三河ごーすと].义妹生活.07.[台简].epub'), {
    'OEBPS/Styles/stylesheet.css': '', 'OEBPS/Misc/script.js': '',
  });
  for (const volume of ['11', '12', '13', '14']) {
    await writeHyreadFixture(join(root, 'output/hyread', `[三河ごーすと].义妹生活.${volume}.[台繁].hyread.epub`), {
      pages: { 'p-002.xhtml': bodyParagraph(`正文${volume}`) },
    });
    await writeEpub(join(root, 'output/healed', `[三河ごーすと].义妹生活.${volume}.[日翻].healed.epub`), {});
  }
  const outDir = join(root, 'products');
  await runBatch({ root, outDir });
  const names = (await readdir(outDir)).sort();
  assert.equal(names.length, 6);
  for (const volume of ['11', '12', '13']) {
    for (const suffix of ['', '[特典]']) assert.ok(names.includes(`[三河ごーすと].义妹生活.${volume}.[台简]${suffix}.epub`));
  }
  const previous = await readFile(join(outDir, names[0]));
  await runBatch({ root, outDir });
  const backup = (await readdir(outDir)).find(name => name.startsWith('backup-before-build-'));
  assert.deepEqual((await readdir(join(outDir, backup))).sort(), names);
  assert.deepEqual(await readFile(join(outDir, backup, names[0])), previous);
  const cli = fileURLToPath(new URL('../../../bin/cli.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'build-yimei-simple', '--root', root,
    '--out-dir', join(root, 'only14'), '--volumes', '14'], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readdir(join(root, 'only14'))).sort(), [
    '[三河ごーすと].义妹生活.14.[台简].epub', '[三河ごーすと].义妹生活.14.[台简][特典].epub',
  ].sort());
});

test('pinned volumes keep default style lookup with explicit source/ref while later missing volumes leave existing outputs intact', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ln-mixed-inputs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'output/healed'), { recursive: true });
  const source = join(root, 'source.epub');
  const ref = join(root, 'ref.epub');
  await writeHyreadFixture(source, { pages: { 'p-002.xhtml': bodyParagraph('正文') } });
  await writeEpub(ref, { 'OEBPS/Styles/stylesheet.css': '', 'OEBPS/Misc/script.js': '' });
  const style = join(root, 'output/healed/[三河ごーすと].义妹生活.11.[日翻].healed.epub');
  await writeEpub(style, {});
  assert.equal(resolveInputs(root, '11', { sourceImageEpubPath: source, refEpubPath: ref }).styleRefEpubPath, style);
  await buildHyreadToSimple({ root, sourceEpubPath: source, refEpubPath: ref, volume: '11', outEpubPath: join(root, '11.epub') });
  await writeEpub(join(root, '[三河ごーすと].义妹生活.07.[台简].epub'), {});
  await mkdir(join(root, 'output/hyread'));
  await writeFile(join(root, 'output/hyread/[三河ごーすと].义妹生活.14.[台繁].hyread.epub'), await readFile(source));
  await writeEpub(join(root, 'output/healed/[三河ごーすと].义妹生活.14.[日翻].healed.epub'), {});
  const outDir = join(root, 'products');
  await mkdir(outDir);
  const existing = '[三河ごーすと].义妹生活.14.[台简].epub';
  await writeFile(join(outDir, existing), 'old output');
  await assert.rejects(runBatch({ root, outDir, volumes: ['14', '28'] }), /\.28\./);
  assert.deepEqual(await readdir(outDir), [existing]);
  assert.equal(await readFile(join(outDir, existing), 'utf8'), 'old output');
});
