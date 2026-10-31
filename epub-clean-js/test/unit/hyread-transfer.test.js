import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createHyreadFixture, absoluteHyreadCapture } from '../helpers/hyread-fixtures.mjs';
import { prepareSession, loadSession } from '../../hyread/lib/session.mjs';
import { receiveChunk, finalizeTransfer } from '../../hyread/lib/transfer.mjs';
import { validateCapture, validateAuditEnvelope } from '../../hyread/lib/artifacts.mjs';

const hash = (data) => createHash('sha256').update(data).digest('hex');
async function fixture(t) {
  const f = await createHyreadFixture();
  t.after(f.cleanup);
  const { config, session } = await prepareSession(f.config, { fetchImpl: f.fetchImpl });
  const capture = absoluteHyreadCapture({ ...f.capture, data: Object.fromEntries(Object.entries(f.capture.data).map(([href, html]) => [href, html + '<!--😀-->'])) }, config.itemBase);
  const meta = { schemaVersion: 1, kind: 'capture', assetId: session.assetId, title: session.title, sourceOpfSha256: session.sourceOpfSha256, complete: true, startedAt: '2026-10-31T01:00:00.000Z', completedAt: '2026-10-31T01:01:00.000Z', restoration: { attempted: true, ok: false, error: 'synthetic restoration failure' } };
  return { ...f, config, session, capture, meta };
}
function transfer(f, value = f.capture, overrides = {}) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  const info = { schemaVersion: 1, kind: 'capture', assetId: f.session.assetId, sourceOpfSha256: f.session.sourceOpfSha256, byteLength: bytes.length, sha256: hash(bytes), chunkBytes: 19, chunkCount: Math.ceil(bytes.length / 19), ...overrides };
  const chunks = Array.from({ length: info.chunkCount }, (_, index) => {
    const part = bytes.subarray(index * info.chunkBytes, (index + 1) * info.chunkBytes);
    return { sha256: info.sha256, index, offset: index * info.chunkBytes, bytes: part.length, dataBase64: part.toString('base64') };
  });
  return { bytes, info, chunks };
}

test('out-of-order chunks preserve UTF-8 emoji and allow identical retry after publication', async (t) => {
  const f = await fixture(t), tx = transfer(f);
  for (const chunk of [...tx.chunks].reverse()) await receiveChunk(f.config, tx.info, chunk);
  await receiveChunk(f.config, tx.info, tx.chunks[0]);
  const first = await finalizeTransfer(f.config, tx.info);
  assert.deepEqual(first, { path: f.config.capturePath, bytes: tx.bytes.length, sha256: tx.info.sha256, reused: false });
  assert.deepEqual(await readFile(first.path), tx.bytes);
  assert.equal((await finalizeTransfer(f.config, tx.info)).reused, true);
});

for (const anotherGeneration of [false, true]) test(`B1: receive and finalize keep selected session with default ${anotherGeneration ? 'at another generation' : 'absent'}`, async (t) => {
  const f = await fixture(t), tx = transfer(f);
  const selected = join(f.config.workDir, 'selected-snapshot.json');
  await rename(f.config.sessionPath, selected);
  if (anotherGeneration) {
    f.resources['standard.opf'] = Buffer.from(f.opf.toString().replace('<metadata/>', '<metadata><title>new generation</title></metadata>'));
    const next = await prepareSession(f.config, { fetchImpl: f.fetchImpl });
    assert.notEqual(next.session.sourceOpfSha256, f.session.sourceOpfSha256);
  }
  const { config } = await loadSession(selected);
  for (const chunk of tx.chunks) await receiveChunk(config, tx.info, chunk);
  const result = await finalizeTransfer(config, tx.info);
  assert.deepEqual(await readFile(result.path), tx.bytes);
});

test('chunk metadata, strict base64 and conflicting retries cannot overwrite accepted chunks', async (t) => {
  const f = await fixture(t), tx = transfer(f), first = tx.chunks[0];
  for (const change of [{ index: -1 }, { index: tx.info.chunkCount }, { offset: 1 }, { bytes: 1 }, { sha256: '0'.repeat(64) }, { dataBase64: first.dataBase64 + '\n' }, { dataBase64: '!!!!' }]) {
    await assert.rejects(receiveChunk(f.config, tx.info, { ...first, ...change }));
  }
  for (const change of [{ assetId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, { sourceOpfSha256: '0'.repeat(64) }, { chunkCount: 0 }, { byteLength: 0 }, { chunkBytes: 1.5 }, { kind: '../capture' }]) {
    await assert.rejects(receiveChunk(f.config, { ...tx.info, ...change }, first));
  }
  await receiveChunk(f.config, tx.info, first);
  await assert.rejects(receiveChunk(f.config, tx.info, { ...first, dataBase64: Buffer.alloc(first.bytes, 65).toString('base64') }));
  for (const chunk of tx.chunks.slice(1)) await receiveChunk(f.config, tx.info, chunk);
  await finalizeTransfer(f.config, tx.info);
  assert.deepEqual(await readFile(f.config.capturePath), tx.bytes);
});

test('missing chunks, wrong aggregate hash, invalid UTF-8 and invalid JSON preserve old file', async (t) => {
  const f = await fixture(t);
  await writeFile(f.config.capturePath, 'old capture');
  const incomplete = transfer(f);
  await receiveChunk(f.config, incomplete.info, incomplete.chunks[0]);
  await assert.rejects(finalizeTransfer(f.config, incomplete.info, { replace: true }));
  for (const [value, overrides] of [[Buffer.from([0xff]), {}], [Buffer.from('{'), {}], [f.capture, { sha256: '0'.repeat(64) }], [{ ...f.capture, meta: { ...f.meta, complete: false } }, {}]]) {
    const tx = transfer(f, value, overrides);
    for (const chunk of tx.chunks) await receiveChunk(f.config, tx.info, chunk);
    await assert.rejects(finalizeTransfer(f.config, tx.info, { replace: true }));
    assert.equal(await readFile(f.config.capturePath, 'utf8'), 'old capture');
  }
});

test('different valid capture requires replace and never changes bytes on rejection', async (t) => {
  const f = await fixture(t), tx = transfer(f);
  await writeFile(f.config.capturePath, 'original');
  for (const chunk of tx.chunks) await receiveChunk(f.config, tx.info, chunk);
  await assert.rejects(finalizeTransfer(f.config, tx.info));
  assert.equal(await readFile(f.config.capturePath, 'utf8'), 'original');
  assert.equal((await finalizeTransfer(f.config, tx.info, { replace: true })).reused, false);
  assert.deepEqual(await readFile(f.config.capturePath), tx.bytes);
});

test('capture accepts old metadata-free format and reordered mapping keys, rejects wrong spine, identity and metadata', async (t) => {
  const f = await fixture(t);
  assert.doesNotThrow(() => validateCapture(f.capture, f.session));
  assert.doesNotThrow(() => validateCapture({ ...f.capture, meta: f.meta, data: Object.fromEntries(Object.entries(f.capture.data).reverse()) }, f.session));
  for (const capture of [{ ...f.capture, order: [...f.capture.order].reverse() }, { ...f.capture, order: f.capture.order.slice(1) }, { ...f.capture, order: f.capture.order.map((s) => s.replace(f.session.assetId, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')) }, { ...f.capture, meta: { ...f.meta, title: '错书' } }, { ...f.capture, meta: { ...f.meta, restoration: null } }, { ...f.capture, meta: { ...f.meta, sourceOpfSha256: '0'.repeat(64) } }, { ...f.capture, data: { ...f.capture.data, [f.config.itemBase + '../escape.xhtml']: '<html/>' } }]) assert.throws(() => validateCapture(capture, f.session));
});

test('audit envelope checks required observations and spine identity while accepting visit order', async (t) => {
  const f = await fixture(t);
  const records = f.session.spine.map((item, spineIndex) => ({ src: f.config.itemBase + item.href, spineId: item.id, spineIndex, bodyText: '', paragraphs: [], images: [], ruby: [], bodyLinks: [], pageCount: 1, pageChecks: [{ page: 1, total: 1, bodyUnchanged: true, visibleBlocks: [] }], bodyChanges: [], unseenTextBlocks: [], errors: [] }));
  const audit = { meta: { ...f.meta, kind: 'audit' }, records: [...records].reverse(), tocEntries: [{ label: '章', src: records[1].src }], imageHashes: [], issues: [] };
  assert.doesNotThrow(() => validateAuditEnvelope(audit, f.session));
  for (const value of [{ ...audit, records: records.slice(1) }, { ...audit, records: [records[0], records[0], records[2]] }, { ...audit, records: [{ ...records[0], pageChecks: null }, ...records.slice(1)] }, { ...audit, meta: { ...audit.meta, complete: false } }, { ...audit, imageHashes: [{ url: 'https://evil.invalid/x', bytes: 1, sha256: '0'.repeat(64) }] }]) assert.throws(() => validateAuditEnvelope(value, f.session));
  const tx = transfer(f, audit, { kind: 'audit' });
  for (const chunk of tx.chunks) await receiveChunk(f.config, tx.info, chunk);
  assert.equal((await finalizeTransfer(f.config, tx.info)).path, f.config.auditPath);
});

test('noncanonical base64 padding and path aliases are rejected', async (t) => {
  const f = await fixture(t), tx = transfer(f, Buffer.from('a'));
  await assert.rejects(receiveChunk(f.config, tx.info, { ...tx.chunks[0], dataBase64: 'YR==' }));
  for (const suffix of ['xhtml/../xhtml/cover.xhtml', 'xhtml/%63over.xhtml', 'xhtml/cover.xhtml?data=secret', 'xhtml/cover.xhtml#fragment']) {
    const old = f.capture.order[0], key = f.config.itemBase + suffix;
    const data = { ...f.capture.data }; delete data[old]; data[key] = f.capture.data[old];
    assert.throws(() => validateCapture({ order: [key, ...f.capture.order.slice(1)], data }, f.session));
  }
});

test('audit rejects missing image dimensions, non-image resources and reordered page checks', async (t) => {
  const f = await fixture(t);
  const records = f.session.spine.map((item, spineIndex) => ({ src: f.config.itemBase + item.href, spineId: item.id, spineIndex, bodyText: '', paragraphs: [], images: [], ruby: [], bodyLinks: [], pageCount: 1, pageChecks: [{ page: 1, total: 1, bodyUnchanged: true, visibleBlocks: [] }], bodyChanges: [], unseenTextBlocks: [], errors: [] }));
  const image = { tag: 'img', src: f.config.itemBase + 'images/pixel.png', alt: '', paragraphIndex: -1, complete: true, naturalWidth: 1, width: 1, height: 1 };
  records[0].images = [image];
  const audit = { meta: { ...f.meta, kind: 'audit' }, records, tocEntries: [], imageHashes: [], issues: [] };
  assert.doesNotThrow(() => validateAuditEnvelope(audit, f.session));
  for (const badImage of [{ ...image, width: undefined }, { ...image, height: NaN }, { ...image, src: f.config.itemBase + 'style.css' }]) {
    assert.throws(() => validateAuditEnvelope({ ...audit, records: [{ ...records[0], images: [badImage] }, ...records.slice(1)] }, f.session));
  }
  assert.throws(() => validateAuditEnvelope({ ...audit, tocEntries: [{ label: 'Wrong target', src: f.config.itemBase + 'style.css' }] }, f.session));
  assert.throws(() => validateAuditEnvelope({ ...audit, records: [{ ...records[0], pageCount: 2, pageChecks: [{ page: 2, total: 2, bodyUnchanged: true, visibleBlocks: [] }, { page: 1, total: 2, bodyUnchanged: true, visibleBlocks: [] }] }, ...records.slice(1)] }, f.session));
});

test('F4: HTML img requires load observations; SVG null and img false/zero remain observations', async (t) => {
  const f = await fixture(t);
  const records = f.session.spine.map((item, spineIndex) => ({ src: f.config.itemBase + item.href, spineId: item.id, spineIndex, bodyText: '', paragraphs: [], images: [], ruby: [], bodyLinks: [], pageCount: 1, pageChecks: [{ page: 1, total: 1, bodyUnchanged: true, visibleBlocks: [] }], bodyChanges: [], unseenTextBlocks: [], errors: [] }));
  const image = { tag: 'img', src: f.config.itemBase + 'images/pixel.png', alt: '', paragraphIndex: -1, width: 1, height: 1, complete: false, naturalWidth: 0 };
  const makeAudit = (observation) => ({ meta: { ...f.meta, kind: 'audit' }, records: [{ ...records[0], images: [observation] }, ...records.slice(1)], tocEntries: [], imageHashes: [], issues: [] });
  assert.doesNotThrow(() => validateAuditEnvelope(makeAudit(image), f.session));
  assert.doesNotThrow(() => validateAuditEnvelope(makeAudit({ ...image, tag: 'image', complete: null, naturalWidth: null }), f.session));
  for (const invalid of [{ ...image, complete: null }, { ...image, naturalWidth: null }]) assert.throws(() => validateAuditEnvelope(makeAudit(invalid), f.session), /image load observation/i);
  const tx = transfer(f, makeAudit({ ...image, complete: null, naturalWidth: null }), { kind: 'audit', chunkBytes: 12000, chunkCount: 1 });
  for (const chunk of tx.chunks) await receiveChunk(f.config, tx.info, chunk);
  await assert.rejects(finalizeTransfer(f.config, tx.info), /image load observation/i);
});
