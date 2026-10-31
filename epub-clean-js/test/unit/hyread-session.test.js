import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, rm, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as legacy from '../../hyread/config.mjs';
import { createHyreadFixture, startHyreadPrepareProcess } from '../helpers/hyread-fixtures.mjs';
import * as sessionApi from '../../hyread/lib/session.mjs';
import * as pathsApi from '../../hyread/lib/paths.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const value = await createHyreadFixture();
  t.after(value.cleanup);
  return value;
}

test('book config derives default paths from the module and explicit paths from cwd', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'hyread-config-'));
  const cwd = process.cwd();
  try {
    process.chdir(temporary);
    const config = legacy.resolveHyreadConfig({ volume: '9', assetId: 'book-09', title: '測試書 9' });
    assert.equal(config.volume, '09');
    assert.equal(config.bookTitle, '測試書 9');
    assert.equal(config.workDir, join(dirname(fileURLToPath(new URL('../../hyread/config.mjs', import.meta.url))), 'work', '09'));
    const explicit = legacy.resolveHyreadConfig({ volume: 12, assetId: 'book-12', title: '測試書 12', workDir: 'work', outputPath: 'book.epub', projectRoot: 'project' });
    assert.equal(explicit.workDir, join(temporary, 'work'));
    assert.equal(explicit.outputPath, join(temporary, 'book.epub'));
    assert.equal(explicit.projectRoot, join(temporary, 'project'));
    assert.equal(explicit.capturePath, join(temporary, 'work/grab_xml.json'));
    assert.equal(explicit.auditPath, join(temporary, 'work/audit.json'));
    assert.equal(explicit.buildDir, join(temporary, 'work/epub_build'));
    assert.equal(legacy.resolveHyreadConfig({ projectRoot: temporary }).outputPath, join(temporary, 'output/hyread/[三河ごーすと].义妹生活.08.[台繁].hyread.epub'));
    assert.deepEqual(await readdir(temporary), []);
  } finally {
    process.chdir(cwd);
    await rm(temporary, { recursive: true, force: true });
  }
});

test('prepare publishes the OPF manifest order, spine order and exact resource hashes', async (t) => {
  const f = await fixture(t);
  const { config, session } = await sessionApi.prepareSession(f.config, { fetchImpl: f.fetchImpl });
  assert.equal(config.workDir, f.config.workDir);
  assert.equal(session.schemaVersion, 1);
  assert.deepEqual(session.manifest.map(({ id }) => id), ['body2', 'cover', 'body1', 'nav', 'css', 'image']);
  assert.deepEqual(session.spine, [{ id: 'cover', href: 'xhtml/cover.xhtml' }, { id: 'body1', href: 'xhtml/body1.xhtml' }, { id: 'body2', href: 'xhtml/body2.xhtml' }]);
  assert.deepEqual(session.manifest[3].properties, ['nav']);
  assert.equal(session.sourceOpfSha256, hash(f.opf));
  assert.match(session.resourceRoot, /^resources\/generations\/[a-zA-Z0-9-]+$/);
  assert.equal(config.resourcesDir, join(f.config.workDir, session.resourceRoot));
  assert.equal(config.itemDir, join(config.resourcesDir, 'ebookservice/epub/fixture-book-09/item'));
  assert.deepEqual(Object.keys(session.resources).sort(), Object.keys(f.resources).sort());
  for (const [href, bytes] of Object.entries(f.resources)) {
    assert.deepEqual(session.resources[href], { bytes: bytes.length, sha256: hash(bytes) });
    assert.deepEqual(await readFile(join(config.workDir, session.resourceRoot, 'ebookservice/epub', config.assetId, 'item', href)), bytes);
  }
  assert.equal(sessionApi.validateSession(session), session);
  const loaded = await sessionApi.loadSession(config.sessionPath, { outputPath: join(config.projectRoot, 'custom.epub') });
  assert.deepEqual(loaded.session, session);
  assert.equal(loaded.config.outputPath, join(config.projectRoot, 'custom.epub'));
});

test('safe paths reject traversal, URLs, encoded separators and symlink escapes', async (t) => {
  assert.equal(pathsApi.safeRelativePath('./xhtml/body.xhtml'), 'xhtml/body.xhtml');
  for (const href of ['../x', '/x', 'C:/x', 'https://other/x', 'a\\b', '%2e%2e/x', '%252e%252e/x', 'a%2fb', 'a%5cb', 'a?x', 'a#x', 'a\u0000']) assert.throws(() => pathsApi.safeRelativePath(href));
  const f = await fixture(t);
  await mkdir(f.config.workDir, { recursive: true });
  assert.equal(await pathsApi.safeJoin(f.config.workDir, 'a/b'), join(f.config.workDir, 'a/b'));
  const outside = join(f.config.projectRoot, 'outside');
  await mkdir(outside);
  try { await symlink(outside, join(f.config.workDir, 'escape'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip(`symlink unavailable: ${error.code}`); return; } throw error; }
  await assert.rejects(pathsApi.safeJoin(f.config.workDir, 'escape/file'));
});

test('atomic file writes protect existing bytes unless replacement is explicit', async (t) => {
  const f = await fixture(t);
  const destination = join(f.config.workDir, 'capture.json');
  await pathsApi.writeFileAtomic(destination, Buffer.from('first'));
  await pathsApi.writeFileAtomic(destination, Buffer.from('first'));
  await assert.rejects(pathsApi.writeFileAtomic(destination, Buffer.from('second')));
  assert.equal(await readFile(destination, 'utf8'), 'first');
  await pathsApi.writeFileAtomic(destination, Buffer.from('second'), { replace: true });
  assert.equal(await readFile(destination, 'utf8'), 'second');
});

test('prepare rejects invalid HTTP responses, empty resources, redirects and timeouts', async (t) => {
  const f = await fixture(t);
  const response = (body, status = 200, url = `${f.config.itemBase}standard.opf`) => {
    const result = new Response(body, { status });
    Object.defineProperty(result, 'url', { value: url });
    return result;
  };
  for (const fetchImpl of [
    async () => response('failure', 403),
    async () => response(''),
    async () => response(f.opf, 200, 'https://other.example/standard.opf'),
    async () => response(f.opf, 200, f.config.itemBase.replace(f.config.assetId, 'other-book') + 'standard.opf'),
    async () => new Promise(() => {}),
  ]) await assert.rejects(sessionApi.prepareSession(f.config, { fetchImpl, timeoutMs: 15 }));
  assert.equal(existsSync(f.config.sessionPath), false);
});

test('prepare rejects invalid OPF identity, href and spine declarations before publication', async (t) => {
  const f = await fixture(t);
  for (const opf of [
    f.opf.toString().replace(/<spine>.*<\/spine>/s, ''),
    f.opf.toString().replace('idref="cover"', 'idref="missing"'),
    f.opf.toString().replace('id="body1"', 'id="body2"'),
    f.opf.toString().replace('xhtml/body1.xhtml', 'xhtml/body2.xhtml'),
    f.opf.toString().replace('xhtml/body1.xhtml', '%252e%252e/escape.xhtml'),
    f.opf.toString().replace('xhtml/body1.xhtml', 'images'),
  ]) {
    f.resources['standard.opf'] = Buffer.from(opf);
    await assert.rejects(sessionApi.prepareSession(f.config, { fetchImpl: f.fetchImpl }));
    assert.equal(existsSync(f.config.sessionPath), false);
  }
});

test('failed refresh preserves every old byte and prevents using a work directory for another book', async (t) => {
  const f = await fixture(t);
  const first = await sessionApi.prepareSession(f.config, { fetchImpl: f.fetchImpl });
  const sessionBytes = await readFile(f.config.sessionPath);
  f.resources['xhtml/body2.xhtml'] = Buffer.from('a newer resource');
  const failingFetch = async (url, options) => {
    if (url.endsWith('/images/pixel.png')) throw new Error('injected last resource failure');
    return f.fetchImpl(url, options);
  };
  await assert.rejects(sessionApi.prepareSession(f.config, { fetchImpl: failingFetch }));
  assert.deepEqual(await readFile(f.config.sessionPath), sessionBytes);
  assert.deepEqual((await sessionApi.loadSession(f.config.sessionPath)).session, first.session);
  const other = await createHyreadFixture({ workDir: f.config.workDir, assetId: 'different-book', title: '另一測試書' });
  t.after(other.cleanup);
  let requests = 0;
  await assert.rejects(sessionApi.prepareSession(other.config, { fetchImpl: (...args) => { requests++; return other.fetchImpl(...args); } }), /belongs to another book/);
  assert.equal(requests, 0);
  assert.deepEqual(await readFile(f.config.sessionPath), sessionBytes);
});

test('load checks resource bytes, schema, resource set and OPF declarations', async (t) => {
  const f = await fixture(t);
  const { session } = await sessionApi.prepareSession(f.config, { fetchImpl: f.fetchImpl });
  for (const mutate of [
    (s) => { s.schemaVersion = 2; },
    (s) => { delete s.resources['style.css']; },
    (s) => { s.resources.extra = { bytes: 1, sha256: 'a'.repeat(64) }; },
    (s) => { s.manifest[0].mediaType = 'text/plain'; },
    (s) => { s.resourceRoot = '../outside'; },
  ]) {
    const changed = structuredClone(session);
    mutate(changed);
    await writeFile(f.config.sessionPath, JSON.stringify(changed));
    await assert.rejects(sessionApi.loadSession(f.config.sessionPath));
  }
  await writeFile(f.config.sessionPath, JSON.stringify(session));
  const resource = join(f.config.workDir, session.resourceRoot, 'ebookservice/epub', f.config.assetId, 'item/style.css');
  const bytes = await readFile(resource);
  bytes[0] ^= 1;
  await writeFile(resource, bytes);
  await assert.rejects(sessionApi.loadSession(f.config.sessionPath), /integrity|hash/i);
});

test('prepare downloads at most four resources concurrently and refresh uses a new generation', async (t) => {
  const f = await fixture(t);
  let active = 0;
  let maximum = 0;
  const fetchImpl = async (url, options) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((done) => setTimeout(done, 5));
    try { return await f.fetchImpl(url, options); } finally { active--; }
  };
  const first = await sessionApi.prepareSession(f.config, { fetchImpl });
  assert.equal(maximum, 4);
  const second = await sessionApi.prepareSession(f.config, { fetchImpl });
  assert.notEqual(first.session.resourceRoot, second.session.resourceRoot);
  assert.deepEqual((await sessionApi.loadSession(f.config.sessionPath)).session, second.session);
});

test('same-book prepare repairs missing or tampered resources using a fresh generation', async (t) => {
  const f = await fixture(t);
  let previous = await sessionApi.prepareSession(f.config, { fetchImpl: f.fetchImpl });
  for (const damage of ['missing', 'tampered']) {
    const oldFile = join(previous.config.itemDir, 'style.css');
    if (damage === 'missing') await rm(oldFile);
    else await writeFile(oldFile, Buffer.from('modified old CSS'));
    await assert.rejects(sessionApi.loadSession(previous.config.sessionPath));
    const repaired = await sessionApi.prepareSession(f.config, { fetchImpl: f.fetchImpl });
    assert.notEqual(repaired.session.resourceRoot, previous.session.resourceRoot);
    assert.deepEqual((await sessionApi.loadSession(repaired.config.sessionPath)).session, repaired.session);
    if (damage === 'missing') assert.equal(existsSync(oldFile), false);
    else assert.equal(await readFile(oldFile, 'utf8'), 'modified old CSS');
    previous = repaired;
  }
});

test('failed same-book repair preserves the invalid old session and resource state', async (t) => {
  const f = await fixture(t);
  const { config } = await sessionApi.prepareSession(f.config, { fetchImpl: f.fetchImpl });
  const before = await readFile(config.sessionPath);
  const oldFile = join(config.itemDir, 'style.css');
  await writeFile(oldFile, 'damaged');
  f.resources['xhtml/body2.xhtml'] = Buffer.from('new version');
  await assert.rejects(sessionApi.prepareSession(f.config, { fetchImpl: async (url, options) => {
    if (url.endsWith('/images/pixel.png')) throw new Error('repair download failed');
    return f.fetchImpl(url, options);
  } }), /repair download failed/);
  assert.deepEqual(await readFile(config.sessionPath), before);
  assert.equal(await readFile(oldFile, 'utf8'), 'damaged');
  await assert.rejects(sessionApi.loadSession(config.sessionPath), /integrity/);
});

test('load rejects escaped resource links while a fresh generation can repair the same book', async (t) => {
  const f = await fixture(t);
  const { config } = await sessionApi.prepareSession(f.config, { fetchImpl: f.fetchImpl });
  const outside = join(f.config.projectRoot, 'external-images');
  await mkdir(outside);
  await writeFile(join(outside, 'pixel.png'), f.resources['images/pixel.png']);
  await rm(join(config.itemDir, 'images'), { recursive: true });
  try { await symlink(outside, join(config.itemDir, 'images'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip(`symlink unavailable: ${error.code}`); return; } throw error; }
  await assert.rejects(sessionApi.loadSession(config.sessionPath), /escapes/);
  const repaired = await sessionApi.prepareSession(f.config, { fetchImpl: f.fetchImpl });
  assert.deepEqual((await sessionApi.loadSession(config.sessionPath)).session, repaired.session);
  assert.deepEqual(await readFile(join(outside, 'pixel.png')), f.resources['images/pixel.png']);
});

test('validateSession rejects file ancestors even when a sibling separates sorted hrefs', async (t) => {
  const f = await fixture(t);
  const { session } = await sessionApi.prepareSession(f.config, { fetchImpl: f.fetchImpl });
  session.manifest = ['a', 'a-b', 'a/b'].map((href, index) => ({ id: `item-${index}`, href, mediaType: 'text/plain', properties: [] }));
  session.spine = [{ id: 'item-0', href: 'a' }];
  session.resources = Object.fromEntries(['standard.opf', 'a', 'a-b', 'a/b'].map((href) => [href, { bytes: 1, sha256: session.sourceOpfSha256 }]));
  assert.throws(() => sessionApi.validateSession(session), /collision/);
});

test('two processes cannot publish different books into one initially empty work directory', { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  const first = startHyreadPrepareProcess({ workDir: f.config.workDir, assetId: 'process-book-a', title: 'Book A' });
  const second = startHyreadPrepareProcess({ workDir: f.config.workDir, assetId: 'process-book-b', title: 'Book B' });
  t.after(first.kill);
  t.after(second.kill);
  await Promise.all([first.ready, second.ready]);
  first.release();
  const winner = await first.result;
  assert.equal(winner.ok, true, winner.error);
  second.release();
  const loser = await second.result;
  assert.equal(loser.ok, false, 'the second book must not replace the first binding');
  assert.match(loser.error, /belongs to another book/);
  assert.deepEqual((await sessionApi.loadSession(f.config.sessionPath)).session, winner.session);
});

test('a hanging response body times out, aborts and preserves the old published resources', async (t) => {
  const f = await fixture(t);
  const previous = await sessionApi.prepareSession(f.config, { fetchImpl: f.fetchImpl });
  const before = await readFile(f.config.sessionPath);
  let bodyStarted = false;
  let bodySignal;
  const fetchImpl = async (url, options) => {
    if (!url.endsWith('/style.css')) return f.fetchImpl(url, options);
    bodySignal = options.signal;
    return {
      url, status: 200,
      arrayBuffer: () => new Promise((_, reject) => {
        bodyStarted = true;
        options.signal.addEventListener('abort', () => reject(new Error('body aborted')), { once: true });
      }),
    };
  };
  await assert.rejects(sessionApi.prepareSession(f.config, { fetchImpl, timeoutMs: 40 }), /timed out|body aborted/);
  assert.equal(bodyStarted, true);
  assert.equal(bodySignal.aborted, true);
  assert.deepEqual(await readFile(f.config.sessionPath), before);
  assert.deepEqual((await sessionApi.loadSession(f.config.sessionPath)).session, previous.session);
});

test('a process interrupted before session publication keeps its book binding and allows same-book retry', { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  const interrupted = startHyreadPrepareProcess({ workDir: f.config.workDir, assetId: f.config.assetId, title: f.config.bookTitle }, { pauseAt: 'session' });
  t.after(interrupted.kill);
  await interrupted.ready;
  assert.equal(existsSync(f.config.sessionPath), false);
  const other = await createHyreadFixture({ workDir: f.config.workDir, assetId: 'different-book', title: 'Other Book' });
  t.after(other.cleanup);
  await assert.rejects(sessionApi.prepareSession(other.config, { fetchImpl: other.fetchImpl }), /belongs to another book/);
  interrupted.kill();
  await interrupted.result;
  const retry = await sessionApi.prepareSession(f.config, { fetchImpl: f.fetchImpl });
  assert.deepEqual((await sessionApi.loadSession(f.config.sessionPath)).session, retry.session);
});

test('prepare rejects invalid persisted metadata without sending a resource request', async (t) => {
  const f = await fixture(t);
  await mkdir(f.config.workDir, { recursive: true });
  for (const filename of ['session.json', 'book-identity.json']) {
    await writeFile(join(f.config.workDir, filename), 'null');
    let requests = 0;
    await assert.rejects(sessionApi.prepareSession(f.config, { fetchImpl: (...args) => { requests++; return f.fetchImpl(...args); } }));
    assert.equal(requests, 0);
    await rm(join(f.config.workDir, filename));
  }
});

test('safeJoin tolerates another resource writer creating the shared parent directory', async (t) => {
  const f = await fixture(t);
  await mkdir(f.config.workDir, { recursive: true });
  await Promise.all(Array.from({ length: 80 }, async (_, index) => {
    const parent = `shared-${index}`;
    const [target] = await Promise.all([
      pathsApi.safeJoin(f.config.workDir, `${parent}/resource`),
      mkdir(join(f.config.workDir, parent)),
    ]);
    assert.equal(target, join(f.config.workDir, parent, 'resource'));
  }));
});

test('book config rejects unsafe identities and keeps legacy volume 08 defaults', () => {
  for (const volume of ['', '0', '-1', '../9', '1.2']) assert.throws(() => legacy.resolveHyreadConfig({ volume, assetId: 'book', title: 'Title' }));
  for (const assetId of ['', '../book', 'book/id', 'book?x', 'book%2fother']) assert.throws(() => legacy.resolveHyreadConfig({ volume: 9, assetId, title: 'Title' }));
  for (const title of ['', '  ', 'Title\u0000']) assert.throws(() => legacy.resolveHyreadConfig({ volume: 9, assetId: 'book', title }));
  assert.equal(legacy.VOLUME, '08');
  assert.equal(legacy.ASSET_ID, '8a8a84ca8cf2eb56018d6786f66a472c');
  assert.equal(legacy.BOOK_TITLE, '義妹生活 8');
  assert.equal(legacy.WORK, resolve(dirname(fileURLToPath(new URL('../../hyread/config.mjs', import.meta.url))), 'work/08'));
});
