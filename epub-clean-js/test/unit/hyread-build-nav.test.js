import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { createHyreadFixture, absoluteHyreadCapture } from '../helpers/hyread-fixtures.mjs';
import { prepareSession } from '../../hyread/lib/session.mjs';

test('HyRead nav derives chapter labels from its own synthetic capture and retains one afterword', async (t) => {
  const f = await createHyreadFixture(); t.after(f.cleanup);
  f.resources['standard.opf'] = Buffer.from(f.opf.toString().replace('<metadata/>', '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>合成書</dc:title><dc:identifier id="book-id">synthetic</dc:identifier><dc:language>zh-TW</dc:language></metadata>'));
  f.capture.data['xhtml/body1.xhtml'] = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>旧标签</title></head><body><p class="gfont">同日的另一個視角</p><p>合成正文。</p></body></html>';
  f.capture.data['xhtml/body2.xhtml'] = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>旧标签</title></head><body><p class="gfont">後記</p><p>合成後記。</p></body></html>';
  const { config } = await prepareSession(f.config, { fetchImpl: f.fetchImpl });
  await writeFile(config.capturePath, JSON.stringify(absoluteHyreadCapture(f.capture, config.itemBase)));
  const output = join(config.workDir, 'nav-test.epub');
  execFileSync(process.execPath, [fileURLToPath(new URL('../../hyread/scripts/4-build-epub.mjs', import.meta.url)), '--session', config.sessionPath, '--out', output], { cwd: config.workDir, stdio: 'pipe' });
  const nav = new AdmZip(await readFile(output)).readAsText('item/nav.xhtml');
  assert.match(nav, /<a href="xhtml\/body1\.xhtml">同日的另一個視角<\/a>/);
  assert.equal((nav.match(/>後記<\/a>/g) || []).length, 1);
  assert.doesNotMatch(nav, /旧标签/);
});
