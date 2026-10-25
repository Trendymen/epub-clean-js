import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const cli = path.join(projectRoot, 'bin/cli.js');

test('migrate CLI loads its book modules outside the project working directory', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'migrate-cli-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const missing = path.join(root, 'missing-source.epub');
  const out = path.join(root, 'output.epub');
  const result = spawnSync(process.execPath, [cli, 'migrate-translation',
    '--src', missing, '--dst', missing, '--ref', missing,
    '--out', out, '--book', 'yimei-seikatsu'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ENOENT/);
  assert.ok(result.stderr.includes('missing-source.epub'), result.stderr);
  assert.doesNotMatch(result.stderr, /ERR_UNSUPPORTED_ESM_URL_SCHEME|ERR_MODULE_NOT_FOUND/);
  await assert.rejects(stat(out), { code: 'ENOENT' });
});

test('font module derives source paths from its own location on supported Node versions', () => {
  const moduleUrl = new URL('../../src/core/font-subset.js', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { SOURCE_FONTS } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(SOURCE_FONTS.sansRegular));`],
  { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), path.join(projectRoot, 'books/source-han-sans-sc/SourceHanSansSC-Regular.otf'));
});

test('lightnovel parser loads its bundled footnote icon independently of the working directory', () => {
  const moduleUrl = new URL('../../books/yimei-seikatsu/lightnovel-html/index.js', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { parseLightNovelArticle } from ${JSON.stringify(moduleUrl)}; console.log(typeof parseLightNovelArticle);`],
  { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'function');
});

test('simple batch defaults to the outer source directory independently of the working directory', () => {
  const moduleUrl = new URL('../../src/entries/lightnovel-html-simple-batch.js', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { defaultRoot } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(defaultRoot));`],
  { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), path.dirname(projectRoot.replace(/[\\/]$/, '')));
});
