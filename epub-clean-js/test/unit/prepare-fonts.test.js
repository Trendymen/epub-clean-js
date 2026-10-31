import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ReadableStream } from 'node:stream/web';
import { subsetAll } from '../../src/core/font-subset.js';

const hash = data => createHash('sha256').update(data).digest('hex');
const font = Buffer.from('OTTO controlled font fixture');
const license = Buffer.from('SIL Open Font License fixture');
const resources = [
  { name: 'font.otf', file: 'sans/font.otf', url: 'https://fixture.test/font', bytes: font.length, sha256: hash(font) },
  { name: 'LICENSE.txt', file: 'sans/LICENSE.txt', url: 'https://fixture.test/license', bytes: license.length, sha256: hash(license) },
];

test('font preparation aborts an unfinished HTTP error response and preserves its status', async (t) => {
  const { prepareFonts } = await import('../../src/core/font-resources.js');
  const root = await mkdtemp(join(tmpdir(), 'font-http-open-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let requestSignal;
  let canceled = false;
  const body = new ReadableStream({ cancel() { canceled = true; } });
  t.after(() => body.cancel());
  await assert.rejects(prepareFonts({ destRoot: root, resources: [resources[0]],
    fetchImpl: async (url, { signal }) => {
      requestSignal = signal;
      return new Response(body, { status: 503 });
    } }), /Font download failed \(503\)/);
  assert.ok(requestSignal.aborted || canceled, 'the failed request must be aborted or its body canceled');
  assert.deepEqual(await readdir(root), []);
});

test('font preflight lists missing paths and explicit prepare command', async () => {
  await assert.rejects(subsetAll({ sansRegular: new Set('字') }, { sansRegular: join(tmpdir(), 'absent-font.otf') }), /npm run prepare:fonts/);
});

test('prepare-fonts CLI is explicit and exposes local cache usage', () => {
  const cli = fileURLToPath(new URL('../../bin/cli.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'prepare-fonts', '--help'], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--cache-dir/);
});

test('font preparation verifies local cache, writes licenses and reuses valid destinations without fetch', async (t) => {
  const { prepareFonts } = await import('../../src/core/font-resources.js');
  const root = await mkdtemp(join(tmpdir(), 'font-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cacheDir = join(root, 'cache');
  await mkdir(cacheDir);
  await writeFile(join(cacheDir, 'font.otf'), font);
  await writeFile(join(cacheDir, 'LICENSE.txt'), license);
  const destRoot = join(root, 'books');
  const options = { cacheDir, destRoot, resources, fetchImpl: () => { throw new Error('must stay offline'); } };
  await prepareFonts(options);
  await rm(cacheDir, { recursive: true });
  await prepareFonts(options);
  assert.deepEqual(await readFile(join(destRoot, 'sans/font.otf')), font);
  assert.deepEqual(await readFile(join(destRoot, 'sans/LICENSE.txt')), license);
  assert.deepEqual((await readdir(join(destRoot, 'sans'))).sort(), ['LICENSE.txt', 'font.otf']);
});

test('font preparation downloads a shared resource once and ignores damaged local cache', async (t) => {
  const { prepareFonts } = await import('../../src/core/font-resources.js');
  const root = await mkdtemp(join(tmpdir(), 'font-download-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'font.otf'), 'damaged cache');
  let requests = 0;
  await prepareFonts({ cacheDir: root, destRoot: join(root, 'books'), resources: [resources[0], resources[0]],
    fetchImpl: async (url, { signal }) => {
      assert.equal(url, 'https://fixture.test/font');
      assert.ok(signal);
      requests++;
      return new Response(font);
    } });
  assert.equal(requests, 1);
  assert.deepEqual(await readFile(join(root, 'books/sans/font.otf')), font);
});

for (const mode of ['hash', 'oversize', 'http', 'timeout']) {
  test(`font preparation rejects ${mode}, preserves existing files and leaves no fragments`, async (t) => {
    const { prepareFonts } = await import('../../src/core/font-resources.js');
    const root = await mkdtemp(join(tmpdir(), 'font-reject-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'sans'));
    const previous = Buffer.from('existing file');
    await writeFile(join(root, 'sans/font.otf'), previous);
    await assert.rejects(prepareFonts({ destRoot: root, resources: [resources[0]], timeoutMs: 20,
      fetchImpl: async (url, { signal }) => {
        if (mode === 'timeout') return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        if (mode === 'http') return new Response('failure', { status: 503 });
        return new Response(mode === 'hash' ? Buffer.alloc(font.length) : Buffer.alloc(font.length + 1));
      } }));
    assert.deepEqual(await readFile(join(root, 'sans/font.otf')), previous);
    assert.deepEqual(await readdir(join(root, 'sans')), ['font.otf']);
  });
}

test('a later failed download never replaces a verified font already present', async (t) => {
  const { prepareFonts } = await import('../../src/core/font-resources.js');
  const root = await mkdtemp(join(tmpdir(), 'font-valid-preserved-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'sans'));
  await writeFile(join(root, 'sans/font.otf'), font);
  await assert.rejects(prepareFonts({ destRoot: root, resources, fetchImpl: async url => {
    assert.equal(url, 'https://fixture.test/license');
    return new Response('unexpected data');
  } }), /mismatch|size/);
  assert.deepEqual(await readFile(join(root, 'sans/font.otf')), font);
  assert.deepEqual(await readdir(join(root, 'sans')), ['font.otf']);
});
