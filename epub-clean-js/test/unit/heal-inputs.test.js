import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import profile from '../../books/yimei-seikatsu/profile.js';
import { selectHealInputs } from '../../src/entries/heal-inputs.js';

const raw11 = '[三河ごーすと].义妹生活.11.[日翻].epub';
const raw16 = '[三河ごーすと].义妹生活.16.[日翻].epub';
const raw17 = '[三河ごーすと].义妹生活.17.[日翻].epub';
const raw18 = '[三河ごーすと].义妹生活.18.[日翻].epub';

async function fixture(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'heal-inputs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const name of files) {
    const file = path.join(root, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'temporary source');
  }
  return {
    ...profile,
    paths: { rawDir: root, healedDir: path.join(root, 'output', 'healed') },
  };
}

test('default scan selects only top-level numbered raw sources from volume 11, sorted numerically', async (t) => {
  const config = await fixture(t, [
    raw18, raw11, raw17, raw16,
    '[三河ごーすと].义妹生活.100.[日翻].epub',
    '[三河ごーすと].义妹生活.08.[日翻].epub',
    '[三河ごーすと].义妹生活.09.[日翻].epub',
    '[三河ごーすと].义妹生活.another days.[日翻] .epub',
    '[三河ごーすと].义妹生活.16.[日翻].healed.epub',
    '[三河ごーすと].义妹生活.16.[日翻].clean.epub',
    '[三河ごーすと].义妹生活.16extra.[日翻].epub',
    '[三河ごーすと].义妹生活.20.[台简].epub',
    `nested/[三河ごーすと].义妹生活.19.[日翻].epub`,
  ]);
  const selected = await selectHealInputs(config, []);
  assert.deepEqual(selected.map(({ vol }) => vol), [11, 16, 17, 18, 100]);
  assert.equal(selected[1].src, path.join(config.paths.rawDir, raw16));
  assert.equal(selected[1].dst, path.join(config.paths.healedDir, '[三河ごーすと].义妹生活.16.[日翻].healed.epub'));
  await assert.rejects(fs.stat(config.paths.healedDir), { code: 'ENOENT' });
});

test('literal filenames with brackets and overlapping patterns select only requested files once', async (t) => {
  const config = await fixture(t, [raw11, raw16, raw17, raw18]);
  const selected = await selectHealInputs(config, [raw17, '*16*.epub', raw16]);
  assert.deepEqual(selected.map(({ vol }) => vol), [16, 17]);
});

test('relative directory globs resolve from rawDir and support braces and globstar', async (t) => {
  const config = await fixture(t, [`incoming/a/${raw16}`, `incoming/b/deep/${raw17}`, raw18]);
  const selected = await selectHealInputs(config, ['incoming/**/*{16,17}*.epub']);
  assert.deepEqual(selected.map(({ vol }) => vol), [16, 17]);
  assert.equal(selected[0].src, path.join(config.paths.rawDir, 'incoming/a', raw16));
});

test('absolute file paths and absolute globs can select sources outside rawDir', async (t) => {
  const config = await fixture(t, []);
  const other = await fixture(t, [raw16, raw17]);
  const selected = await selectHealInputs(config, [
    path.join(other.paths.rawDir, raw16),
    path.join(other.paths.rawDir, '*17*.epub'),
  ]);
  assert.deepEqual(selected.map(({ vol }) => vol), [16, 17]);
});

test('each explicit pattern must match an eligible source before any output is created', async (t) => {
  const config = await fixture(t, [raw16]);
  await assert.rejects(selectHealInputs(config, [raw16, '*999*.epub']), /999/);
  await assert.rejects(fs.stat(config.paths.healedDir), { code: 'ENOENT' });
});

test('explicit selection rejects excluded volumes, products, nonnumeric names and directories', async (t) => {
  const invalid = [
    '[三河ごーすと].义妹生活.09.[日翻].epub',
    '[三河ごーすと].义妹生活.16.[日翻].healed.epub',
    '[三河ごーすと].义妹生活.another days.[日翻] .epub',
  ];
  const config = await fixture(t, invalid);
  await fs.mkdir(path.join(config.paths.rawDir, raw16));
  for (const input of [...invalid, raw16]) {
    await assert.rejects(selectHealInputs(config, [input]), /未匹配.*源 EPUB/);
  }
});

test('default scan reports an empty source selection', async (t) => {
  const config = await fixture(t, []);
  await assert.rejects(selectHealInputs(config, []), /未找到.*源 EPUB/);
});

test('different directories containing the same volume cannot overwrite one output', async (t) => {
  const config = await fixture(t, [`a/${raw16}`, `b/${raw16}`]);
  await assert.rejects(selectHealInputs(config, ['**/*16*.epub']), /输出冲突/);
});

test('alternate numeric spellings of the same volume cannot overwrite one output', async (t) => {
  const config = await fixture(t, [raw16, '[三河ごーすと].义妹生活.016.[日翻].epub']);
  await assert.rejects(selectHealInputs(config, ['*16*.epub']), /输出冲突/);
});

test('decomposed Japanese filenames remain selectable by default scan and wildcard', async (t) => {
  const decomposed = raw16.normalize('NFD');
  const config = await fixture(t, [decomposed]);
  for (const args of [[], ['*16*.epub']]) {
    const selected = await selectHealInputs(config, args);
    assert.deepEqual(selected.map(({ vol }) => vol), [16]);
    assert.equal(await fs.readFile(selected[0].src, 'utf8'), 'temporary source');
    assert.equal(path.basename(selected[0].src), decomposed);
  }
});

test('Japanese glob literals, classes and bracket escapes match decomposed source names', async (t) => {
  const config = await fixture(t, [raw16.normalize('NFD'), raw17]);
  for (const input of [
    '*三河ごーすと*16*.epub',
    '*三河?ーすと*16*.epub',
    '*三河[ご]ーすと*16*.epub',
    '[[]三河[ご]ーすと[]]*16*.epub',
    '*三河{ご,が}ーすと*16*.epub',
  ]) {
    const selected = await selectHealInputs(config, [input]);
    assert.deepEqual(selected.map(({ vol }) => vol), [16], input);
    assert.equal(await fs.readFile(selected[0].src, 'utf8'), 'temporary source');
  }
});

test('Japanese directory globs preserve their directory boundary for decomposed names', async (t) => {
  const directory = 'incomingご'.normalize('NFD');
  const source = `${directory}/nested/deeper/${raw16.normalize('NFD')}`;
  const config = await fixture(t, [source, `outside/${raw16}`]);
  const expected = path.join(config.paths.rawDir, source);
  const expectedStat = await fs.stat(expected, { bigint: true });
  for (const input of ['incomingご/**/*三河[ご]ーすと*16*.epub', 'incoming[ご]/**/*16*.epub']) {
    const selected = await selectHealInputs(config, [input]);
    assert.deepEqual(selected.map(({ vol }) => vol), [16]);
    assert.equal(selected[0].src.normalize('NFC'), expected.normalize('NFC'));
    const actualStat = await fs.stat(selected[0].src, { bigint: true });
    assert.ok(actualStat.isFile());
    assert.equal(actualStat.dev, expectedStat.dev);
    assert.equal(actualStat.ino, expectedStat.ino);
  }
});

test('canonical spellings of the same file are deduplicated by file identity', async (t) => {
  const config = await fixture(t, [raw16]);
  const source = path.join(config.paths.rawDir, raw16);
  const alias = path.join(config.paths.rawDir, raw16.normalize('NFD'));
  try {
    await fs.stat(alias);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.link(source, alias);
  }
  const originalStat = await fs.stat(source, { bigint: true });
  const aliasStat = await fs.stat(alias, { bigint: true });
  assert.equal(aliasStat.dev, originalStat.dev);
  assert.equal(aliasStat.ino, originalStat.ino);
  const selected = await selectHealInputs(config, [raw16, '*16*.epub']);
  assert.deepEqual(selected.map(({ vol }) => vol), [16]);
});

test('different files with canonically equivalent names still conflict on one output', async (t) => {
  const config = await fixture(t, [raw16]);
  let other = path.join(config.paths.rawDir, raw16.normalize('NFD'));
  try {
    await fs.stat(other);
    other = path.join(config.paths.rawDir, 'other', raw16.normalize('NFD'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.mkdir(path.dirname(other), { recursive: true });
  await fs.writeFile(other, 'different source');
  const firstStat = await fs.stat(path.join(config.paths.rawDir, raw16), { bigint: true });
  const otherStat = await fs.stat(other, { bigint: true });
  assert.notEqual(`${firstStat.dev}:${firstStat.ino}`, `${otherStat.dev}:${otherStat.ino}`);
  await assert.rejects(selectHealInputs(config, [raw16, other]), /输出冲突/);
});

test('one file linked under two volume numbers preserves both requested volumes', async (t) => {
  const config = await fixture(t, [raw16]);
  await fs.link(path.join(config.paths.rawDir, raw16), path.join(config.paths.rawDir, raw17));
  const selected = await selectHealInputs(config, ['*1[67]*.epub']);
  assert.deepEqual(selected.map(({ vol }) => vol), [16, 17]);
});

for (const kind of ['relative', 'absolute', 'dynamic-parent', 'missing-static-parent']) {
  test(`${kind} globs normalize parent directory segments before matching`, async (t) => {
    const config = await fixture(t, [raw16, raw17]);
    const root = config.paths.rawDir;
    const input = {
      relative: `../${path.basename(root)}/*16*.epub`,
      absolute: `${root}${path.sep}..${path.sep}${path.basename(root)}${path.sep}*16*.epub`,
      'dynamic-parent': '*/../*16*.epub',
      'missing-static-parent': 'missing/../*16*.epub',
    }[kind];
    const selected = await selectHealInputs(config, [input]);
    assert.deepEqual(selected.map(({ vol }) => vol), [16], input);
    assert.equal(selected[0].src, path.join(root, raw16));
  });
}

for (const scope of ['rawDir', 'ancestor']) {
  test(`glob cwd stays anchored when its ${scope} has a distinct Unicode-equivalent sibling`, async (t) => {
    const config = await fixture(t, []);
    const firstParent = path.join(config.paths.rawDir, 'review-rootご');
    const otherParent = path.join(config.paths.rawDir, 'review-rootご'.normalize('NFD'));
    await fs.mkdir(firstParent);
    try {
      await fs.mkdir(otherParent);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const firstStat = await fs.stat(firstParent, { bigint: true });
    const otherStat = await fs.stat(otherParent, { bigint: true });
    const distinct = `${firstStat.dev}:${firstStat.ino}` !== `${otherStat.dev}:${otherStat.ino}`;
    if (!distinct) {
      assert.equal(otherStat.dev, firstStat.dev);
      assert.equal(otherStat.ino, firstStat.ino);
    }
    const first = scope === 'ancestor' ? path.join(firstParent, 'raw') : firstParent;
    const other = scope === 'ancestor' ? path.join(otherParent, 'raw') : otherParent;
    await fs.mkdir(first, { recursive: true });
    await fs.writeFile(path.join(first, raw16), 'source sixteen');
    if (distinct) {
      await fs.mkdir(other, { recursive: true });
      await fs.writeFile(path.join(other, raw17), 'source seventeen');
    }
    config.paths.rawDir = first;
    for (const args of [[], ['*1[67]*.epub'], [path.join(first, '*1[67]*.epub')]]) {
      const selected = await selectHealInputs(config, args);
      assert.deepEqual(selected.map(({ vol }) => vol), [16]);
      assert.equal(path.relative(first, selected[0].src).startsWith('..'), false);
    }
    for (const siblingPattern of [
      path.join(path.relative(first, other), '*1[67]*.epub'),
      path.join(other, '*1[67]*.epub'),
    ]) {
      const explicit = await selectHealInputs(config, [siblingPattern]);
      assert.deepEqual(explicit.map(({ vol }) => vol), distinct ? [17] : [16]);
    }
  });
}
