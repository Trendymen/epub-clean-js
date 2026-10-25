import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import profile from '../../books/yimei-seikatsu/profile.js';

test('CLI dispatcher opens heal help from another working directory without processing EPUBs', () => {
  const cli = fileURLToPath(new URL('../../bin/cli.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'heal', '--help'], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /用法：npm run heal/);
  assert.ok(result.stdout.includes(profile.paths.rawDir));
  assert.equal(result.stderr, '');
});
