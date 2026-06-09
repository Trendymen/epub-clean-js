import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const projectRoot = join(repoRoot, '..');
const outputEpub = join(projectRoot, 'output/hyread/[三河ごーすと].义妹生活.13.[台繁].hyread.epub');

test('HyRead volume 13 nav derives body chapter titles instead of stale static labels', () => {
  execFileSync(process.execPath, ['hyread/scripts/4-build-epub.mjs'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });

  const zip = new AdmZip(readFileSync(outputEpub));
  const nav = zip.readAsText('item/navigation-documents.xhtml');

  assert.match(nav, /<a href="xhtml\/p-013\.xhtml">丸友和的「在此之前」和「從今以後」<\/a>/);
  assert.equal((nav.match(/>後記<\/a>/g) || []).length, 1);
});
