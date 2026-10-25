import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

test('golden generator writes POSIX ZIP keys and counts chapters from a temporary tree', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'golden-manifest-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const script = path.join(root, 'test/scripts/build-golden-manifest.mjs');
  await fs.mkdir(path.dirname(script), { recursive: true });
  await fs.copyFile(new URL('../scripts/build-golden-manifest.mjs', import.meta.url), script);
  const golden = path.join(root, 'test/fixtures/yimei09/golden-py');
  const files = {
    'OEBPS/Images/cover.png': Buffer.from([1, 2, 3]),
    'OEBPS/Text/chapter0001.xhtml': Buffer.from('<p>甲</p><p>乙</p><aside epub:type="footnote"><p>注</p></aside>'),
    'OEBPS/Text/special0001.xhtml': Buffer.from('<p>特典</p>'),
  };
  const zip = new AdmZip();
  for (const [name, contents] of Object.entries(files)) {
    const hostPath = path.join(golden, ...name.split('/'));
    await fs.mkdir(path.dirname(hostPath), { recursive: true });
    await fs.writeFile(hostPath, contents);
    zip.addFile(name, contents);
  }
  const result = spawnSync(process.execPath, [script], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'test/fixtures/yimei09/golden-manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.files), [
    'OEBPS/Images/cover.png',
    'OEBPS/Text/chapter0001.xhtml',
    'OEBPS/Text/special0001.xhtml',
  ]);
  for (const name of Object.keys(manifest.files)) {
    assert.ok(zip.getEntry(name), `ZIP lookup failed: ${name}`);
  }
  assert.equal(manifest.files['OEBPS/Text/chapter0001.xhtml'].para_count, 2);
  assert.equal(manifest.files['OEBPS/Text/chapter0001.xhtml'].footnote_count, 1);
  assert.equal(manifest.files['OEBPS/Text/special0001.xhtml'].para_count, 1);
  assert.equal(manifest.files['OEBPS/Text/special0001.xhtml'].footnote_count, 0);
});
