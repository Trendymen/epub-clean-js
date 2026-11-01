import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createHyreadFixture, absoluteHyreadCapture } from '../helpers/hyread-fixtures.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const cli = join(root, 'hyread/cli.mjs');
const dispatcher = join(root, 'bin/cli.js');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const run = (args, options = {}) => exec(process.execPath, [cli, ...args], { cwd: dirname(root), ...options });
const json = async (path, value) => { await writeFile(path, JSON.stringify(value)); return path; };

async function fixture(t) {
  const f = await createHyreadFixture(); t.after(f.cleanup);
  f.resources['standard.opf'] = Buffer.from(f.opf.toString().replace('<metadata/>', '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>合成書</dc:title><dc:identifier id="book-id">synthetic</dc:identifier><dc:language>zh-TW</dc:language></metadata>'));
  const preload = join(dirname(f.config.workDir), 'fetch.mjs');
  const resources = Object.fromEntries(Object.entries(f.resources).map(([key, value]) => [new URL(key, f.config.itemBase).href, value.toString('base64')]));
  await writeFile(preload, `const resources = ${JSON.stringify(resources)}; globalThis.fetch = async (input) => { const url = String(input); if (!(url in resources)) throw new Error('Unexpected fixture URL'); const response = new Response(Buffer.from(resources[url], 'base64')); Object.defineProperty(response, 'url', {value:url}); return response; };`);
  const args = ['prepare', '--volume', '9', '--asset-id', f.config.assetId, '--title', f.config.bookTitle, '--work-dir', f.config.workDir];
  await exec(process.execPath, ['--import', pathToFileURL(preload).href, cli, ...args], { cwd: dirname(root) });
  const session = JSON.parse(await readFile(f.config.sessionPath, 'utf8'));
  const capture = absoluteHyreadCapture(f.capture, f.config.itemBase);
  const image = f.config.itemBase + 'images/pixel.png';
  const paragraph = (index, text) => ({ index, tag: 'p', id: '', text, semantic: text, display: 'block', visibility: 'visible' });
  const imageRecord = (tag, alt) => ({ tag, src: image, alt, paragraphIndex: -1, complete: tag === 'img' ? true : null, naturalWidth: tag === 'img' ? 1 : null, width: 1, height: 1 });
  const record = (index, bodyText, paragraphs, images, ruby = []) => ({ src: capture.order[index], spineIndex: index, spineId: session.spine[index].id, bodyText, paragraphs, images, ruby, bodyLinks: [], pageCount: 1, pageChecks: [{ page: 1, total: 1, bodyUnchanged: true, visibleBlocks: paragraphs.map((p) => p.index) }], bodyChanges: [], unseenTextBlocks: [], errors: [] });
  const audit = {
    meta: { schemaVersion: 1, kind: 'audit', assetId: session.assetId, title: session.title, sourceOpfSha256: session.sourceOpfSha256, complete: true, startedAt: '2026-10-31T00:00:00Z', completedAt: '2026-10-31T00:01:00Z', restoration: { attempted: true, ok: true, error: null } },
    tocEntries: [{ label: '第一段字音。', src: capture.order[1] }, { label: '圖前。圖後。', src: capture.order[2] }],
    records: [record(0, '', [], [imageRecord('img', '封面')]), record(1, '第一段字音。', [paragraph(0, '第一段字音。')], [], ['字音']), record(2, '圖前。圖後。', [paragraph(0, '圖前。'), paragraph(1, '圖後。')], [imageRecord('image', '')])],
    imageHashes: [{ url: image, ...session.resources['images/pixel.png'] }], issues: [],
  };
  return { ...f, preload, session, capture, audit, sessionArgs: ['--session', f.config.sessionPath], out: join(dirname(f.config.workDir), 'result.epub') };
}

async function transfer(f, value, kind) {
  const bytes = Buffer.from(JSON.stringify(value));
  const info = { schemaVersion: 1, kind, assetId: f.session.assetId, sourceOpfSha256: f.session.sourceOpfSha256, byteLength: bytes.length, sha256: sha(bytes), chunkBytes: 1000, chunkCount: Math.ceil(bytes.length / 1000) };
  const infoPath = await json(join(f.config.workDir, `${kind}-info.json`), info);
  const args = [...f.sessionArgs, '--info', infoPath];
  for (let index = info.chunkCount - 1; index >= 0; index--) {
    const part = bytes.subarray(index * 1000, (index + 1) * 1000);
    const path = await json(join(f.config.workDir, 'chunk.json'), { sha256: info.sha256, index, offset: index * 1000, bytes: part.length, dataBase64: part.toString('base64') });
    await run(['receive', ...args, '--chunk', path]);
  }
  await run(['finalize', ...args]);
  return args;
}

test('HyRead CLI exposes help through both entrypoints and rejects invalid arguments before writing', async () => {
  for (const command of ['prepare', 'browser-script', 'receive', 'finalize', 'build', 'verify', 'semantic-export']) {
    assert.match((await run([command, '--help'])).stdout, new RegExp(command));
  }
  assert.match((await exec(process.execPath, [dispatcher, 'hyread', '--help'], { cwd: dirname(root) })).stdout, /semantic-export/);
  for (const args of [['unknown'], ['build'], ['prepare', '--volume', '9'], ['build', '--session', 'missing', '--unknown'], ['verify', '--session', 'missing', '--epub', 'missing', '--replace']]) await assert.rejects(run(args), (error) => error.code !== 0);
  await assert.rejects(exec(process.execPath, [join(root, 'hyread/scripts/2b-save-downloaded.mjs')]), (error) => error.code !== 0 && /prepare/.test(error.stderr));
});

test('HyRead CLI prepares outside cwd, receives chunks, builds and verifies three spine documents with a menu-external cover', async (t) => {
  const f = await fixture(t);
  const captureArgs = await transfer(f, f.capture, 'capture');
  await run(['finalize', ...captureArgs]);
  await transfer(f, f.audit, 'audit');
  const generated = (await run(['browser-script', ...f.sessionArgs, '--mode', 'capture'])).stdout;
  assert.doesNotThrow(() => new Function(`return ${generated}`));
  assert.match(generated, /__hyreadWorkflow/);
  await run(['build', ...f.sessionArgs, '--out', f.out]);
  const original = await readFile(f.out);
  await assert.rejects(run(['build', ...f.sessionArgs, '--out', f.out]));
  assert.deepEqual(await readFile(f.out), original);
  const verified = JSON.parse((await run(['verify', ...f.sessionArgs, '--epub', f.out, '--audit', f.config.auditPath, '--require-live'])).stdout);
  assert.equal(verified.report.ok, true);
  assert.equal(verified.report.checks.live.status, 'passed');
  assert.equal(verified.report.checks.semantic.status, 'not-run');
  assert.equal(verified.report.perDocument.length, 3);
  await run(['verify', ...f.sessionArgs, '--epub', f.out]);
  assert.equal((await readdir(join(f.config.workDir, 'reports'))).filter((p) => p.endsWith('.json')).length, 2);
  const semantic = join(f.config.workDir, 'semantic');
  await run(['semantic-export', ...f.sessionArgs, '--audit', f.config.auditPath, '--out-dir', semantic]);
  assert.equal(JSON.parse(await readFile(join(semantic, 'index.json'), 'utf8')).semanticStatus, 'not-run');
  const bad = structuredClone(f.audit); bad.records[1].bodyText = '缺字';
  const badPath = await json(join(f.config.workDir, 'bad-audit.json'), bad);
  const reportPath = join(f.config.workDir, 'bad-report.json');
  await assert.rejects(run(['verify', ...f.sessionArgs, '--epub', f.out, '--audit', badPath, '--require-live', '--report', reportPath]));
  assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).checks.live.status, 'failed');
  await assert.rejects(run(['verify', ...f.sessionArgs, '--epub', f.out, '--require-live']));
  for (const href of ['style.css', 'standard.opf']) {
    const path = join(f.config.workDir, f.session.resourceRoot, 'ebookservice/epub', f.session.assetId, 'item', href);
    const bytes = await readFile(path); await writeFile(path, 'changed');
    await assert.rejects(run(['build', ...f.sessionArgs, '--out', f.out, '--replace']));
    assert.deepEqual(await readFile(f.out), original); await writeFile(path, bytes);
  }
  const invalidInfo = await json(join(f.config.workDir, 'invalid-info.json'), {});
  await assert.rejects(run(['receive', ...f.sessionArgs, '--info', invalidInfo, '--chunk', invalidInfo]));
  await assert.rejects(run(['finalize', ...f.sessionArgs, '--info', invalidInfo]));
  assert.deepEqual(JSON.parse(await readFile(f.config.capturePath, 'utf8')), f.capture);
  const changed = structuredClone(f.capture); changed.data[changed.order[1]] = changed.data[changed.order[1]].replace('第一段', '修改段');
  await assert.rejects(transfer(f, changed, 'capture'));
  assert.deepEqual(JSON.parse(await readFile(f.config.capturePath, 'utf8')), f.capture);
  await run(['finalize', ...captureArgs.slice(0, 2), '--info', join(f.config.workDir, 'capture-info.json'), '--replace']);
  assert.deepEqual(JSON.parse(await readFile(f.config.capturePath, 'utf8')), changed);
});

test('legacy numeric entries accept prepared sessions or explicit identity without touching global configuration', async (t) => {
  const f = await fixture(t);
  const legacy = (name, args, preload = false) => exec(process.execPath, [...(preload ? ['--import', pathToFileURL(f.preload).href] : []), join(root, 'hyread/scripts', name), ...args], { cwd: dirname(root) });
  const identity = ['--volume', '9', '--asset-id', f.config.assetId, '--title', f.config.bookTitle, '--work-dir', f.config.workDir];
  await legacy('2-download-epub-content.mjs', f.sessionArgs, true);
  await legacy('2-download-epub-content.mjs', identity, true);
  await transfer(f, f.capture, 'capture');
  await legacy('3-extract-decrypted.mjs', f.sessionArgs);
  await legacy('3-extract-decrypted.mjs', identity);
  assert.equal(await readFile(join(f.config.workDir, 'decrypted/xhtml/body1.xhtml'), 'utf8'), f.capture.data[f.capture.order[1]]);
  const out = join(f.config.workDir, 'legacy.epub');
  await legacy('4-build-epub.mjs', [...identity, '--out', out]);
  await access(out);
  await assert.rejects(legacy('4-build-epub.mjs', [...f.sessionArgs, '--out', out]));
  await legacy('4-build-epub.mjs', [...f.sessionArgs, '--out', out, '--replace']);
  await assert.rejects(legacy('3-extract-decrypted.mjs', [...f.sessionArgs, '--volume', '9']));
  await assert.rejects(legacy('3-extract-decrypted.mjs', ['--work-dir', f.config.workDir]));
  await assert.rejects(legacy('4-build-epub.mjs', ['--volume', '9', '--work-dir', f.config.workDir]));
});
