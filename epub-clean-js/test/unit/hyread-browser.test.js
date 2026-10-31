import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createBrowserFixture, exportFixture } from '../helpers/hyread-browser-fixture.mjs';
import { createBrowserScript } from '../../hyread/lib/browser-script.mjs';

const bookSource = (href) => 'https://service.ebook.hyread.com.tw/ebookservice/epub/09090909090909090909090909090909/item/' + href;
const timing = { timeoutMs: 400, pollMs: 2, stableSamples: 3 };
async function fixture(t, options) { const f = await createBrowserFixture(options); t.after(() => f.cleanup()); await f.install(); return f; }

test('installation waits for explicit start and preserves a running workflow on reinstallation', async (t) => {
  const f = await fixture(t);
  assert.equal(f.api()?.status().state, 'idle');
  assert.deepEqual(f.position(), { chapter: 1, page: 2 });
  const api = f.api(); await f.install(); assert.equal(f.api(), api);
});

test('capture selects the visible frame, preserves XML and restores the exact starting page', async (t) => {
  const f = await fixture(t, { moveDelay: 4, fontTicks: 4 });
  await f.api().start({ session: f.session, ...timing });
  const { value, info, chunks, bytes } = await exportFixture(f.api());
  assert.equal(value.meta.complete, true);
  assert.equal(value.meta.kind, 'capture');
  assert.deepEqual(value.order, [bookSource('xhtml/cover.xhtml'), bookSource('xhtml/body1.xhtml'), bookSource('xhtml/body2.xhtml')]);
  assert.match(value.data[bookSource('xhtml/body1.xhtml')], /<ruby>字<rt>音<\/rt><\/ruby>/);
  assert.match(value.data[bookSource('xhtml/body1.xhtml')], /前😀<img/);
  assert.equal(info.byteLength, bytes.length);
  assert.equal(info.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.ok(chunks.every((chunk, index) => chunk.bytes <= 7 && chunk.offset === index * 7 && chunk.sha256 === info.sha256));
  assert.deepEqual(f.position(), { chapter: 1, page: 2 });
});

test('audit follows duplicate TOC entries and checks every page and directory-free spine', async (t) => {
  const f = await fixture(t);
  await f.api().start({ session: f.session, ...timing, mode: 'audit' });
  const { value } = await exportFixture(f.api());
  assert.deepEqual(value.tocEntries.map((item) => item.label), ['同名', '同名', '同名']);
  assert.deepEqual(value.tocEntries.map((item) => item.src), [bookSource('xhtml/body1.xhtml'), bookSource('xhtml/body2.xhtml'), bookSource('xhtml/body1.xhtml')]);
  assert.equal(value.records.length, 3);
  const first = value.records.find((item) => item.spineId === 'body1');
  assert.deepEqual(first.pageChecks.map((item) => item.page), [1, 2, 3]);
  assert.ok(first.pageChecks.every((item) => item.bodyUnchanged));
  assert.equal(first.paragraphs[0].tag, 'p');
  assert.match(first.paragraphs[0].semantic, /^前😀\[image:.*pixel.png\]後/);
  assert.equal(first.images[0].paragraphIndex, 0);
  assert.ok(first.ruby.every((entry) => typeof entry === 'string'));
  assert.deepEqual(first.ruby, ['字音']);
  assert.deepEqual(first.bodyLinks, [{ text: '回上段', href: '#first' }]);
  assert.ok(first.unseenTextBlocks.includes(2));
  assert.equal(value.imageHashes.length, 1);
  assert.equal(value.imageHashes[0].sha256, f.session.resources['images/pixel.png'].sha256);
});

for (const [name, options] of Object.entries({ 'wrong title': { title: '別本書' }, 'changed OPF': { changedOpf: true }, 'invisible iframe': { invisible: true }, 'changing document': { changing: true }, 'unready document': { loading: true }, 'request timeout': { fetchNever: true }, 'serialization error': { serializationFailure: true }, 'stuck chapter': { stuck: true } })) {
  test(`capture rejects ${name} and withholds the complete export`, async (t) => {
    const f = await fixture(t, options);
    await assert.rejects(f.api().start({ session: f.session, ...timing }));
    assert.equal(f.api().status().state, 'failed');
    await assert.rejects(f.api().exportInfo());
  });
}

for (const [name, options] of Object.entries({ 'unresponsive page': { noPageTurn: true }, 'page skip': { pageJump: true } })) {
  test(`audit rejects ${name} rather than claiming all pages were checked`, async (t) => {
    const f = await fixture(t, options);
    await assert.rejects(f.api().start({ session: f.session, ...timing, mode: 'audit' }));
    await assert.rejects(f.api().exportInfo());
  });
}

test('running work is exclusive, cancellable and cannot be cleared or replaced', async (t) => {
  const f = await fixture(t, { moveDelay: 8 });
  const pending = f.api().start({ session: f.session, ...timing });
  await assert.rejects(f.api().start({ session: f.session, ...timing }), /running|busy/i);
  assert.throws(() => f.api().clear(), /running|busy/i);
  const api = f.api(); await f.install(); assert.equal(api, f.api());
  f.api().cancel(); await pending;
  assert.equal(api.status().state, 'cancelled');
  await assert.rejects(api.exportInfo());
  api.clear(); assert.equal(api.status().state, 'idle');
});

test('restoration failure is reported separately from a successful capture', async (t) => {
  const f = await fixture(t, { restoreFailure: true });
  await f.api().start({ session: f.session, ...timing });
  const { value } = await exportFixture(f.api());
  assert.equal(value.meta.restoration.ok, false);
  assert.match(value.meta.restoration.error, /restoration failed/);
});

test('audit retains body changes as issues without rewriting text', async (t) => {
  const f = await fixture(t, { bodyChanges: true });
  await f.api().start({ session: f.session, ...timing, mode: 'audit' });
  const { value } = await exportFixture(f.api());
  assert.ok(value.records.some((record) => record.bodyChanges.length));
  assert.ok(value.issues.length);
});

test('chunk reads require an explicit export view and reject invalid indexes or chunk sizes', async (t) => {
  const f = await fixture(t);
  await f.api().start({ session: f.session, ...timing });
  assert.throws(() => f.api().readChunk(0));
  await assert.rejects(f.api().exportInfo({ chunkBytes: 0 }));
  const info = await f.api().exportInfo();
  assert.equal(info.chunkBytes, 12000);
  for (const index of [-1, 0.5, NaN, info.chunkCount]) assert.throws(() => f.api().readChunk(index));
  f.api().clear();
  assert.throws(() => f.api().readChunk(0));
});

test('capture rejects image URLs outside the session without exporting a complete book', async (t) => {
  const f = await fixture(t, { foreignImage: true });
  await assert.rejects(f.api().start({ session: f.session, ...timing }), /Image resource/);
  await assert.rejects(f.api().exportInfo());
});

test('capture fails if the user changes books midway and records restoration failure separately', async (t) => {
  const f = await fixture(t, { midwayTitle: true });
  await assert.rejects(f.api().start({ session: f.session, ...timing }), /another book/);
  const status = f.api().status();
  assert.match(status.errors[0], /another book/);
  assert.equal(status.restoration.ok, false);
  assert.match(status.restoration.error, /another book/);
  await assert.rejects(f.api().exportInfo());
});

test('source errors survive a second restoration error', async (t) => {
  const f = await fixture(t, { changing: true });
  await assert.rejects(f.api().start({ session: f.session, ...timing }), /stability timeout/);
  const status = f.api().status();
  assert.match(status.errors[0], /stability timeout/);
  assert.equal(status.restoration.attempted, true);
  assert.match(status.restoration.error, /stability timeout/);
});

test('describe reflects current book and status snapshots cannot mutate the running state', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(JSON.parse(JSON.stringify(f.api().describe())), { schemaVersion: 1, assetId: f.session.assetId, title: f.session.title, current: { spineId: 'body1', src: bookSource('xhtml/body1.xhtml'), page: 2, pageCount: 3 } });
  const pending = f.api().start({ session: f.session, ...timing, restore: false });
  const status = f.api().status(); status.errors.push('injected'); status.state = 'failed';
  const summary = await pending;
  assert.equal(summary.state, 'complete');
  assert.equal(summary.progress.completed, 3);
  assert.equal(summary.errors.length, 0);
  assert.deepEqual(f.position(), { chapter: 2, page: 1 });
  assert.equal(summary.restoration.attempted, false);
});

test('generated ordinary script runs real capture and returns only the status summary', async (t) => {
  const f = await createBrowserFixture(); t.after(() => f.cleanup());
  const code = await createBrowserScript(f.session);
  const result = await f.run(code);
  assert.equal(result.state, 'complete');
  assert.equal('data' in result, false);
  const { value } = await exportFixture(f.api());
  assert.deepEqual(value.order, [bookSource('xhtml/cover.xhtml'), bookSource('xhtml/body1.xhtml'), bookSource('xhtml/body2.xhtml')]);
  assert.deepEqual(f.position(), { chapter: 1, page: 2 });
  await assert.rejects(createBrowserScript(f.session, { mode: 'other' }));
});

test('cancellation during export hashing cannot publish a complete result', async (t) => {
  const f = await fixture(t);
  const digest = f.context.crypto.subtle.digest.bind(f.context.crypto.subtle);
  let release, hashing;
  const ready = new Promise((resolve) => { hashing = resolve; });
  f.context.crypto = { subtle: { digest: async (algorithm, bytes) => {
    if (bytes.length > 1000) {
      hashing();
      await new Promise((resolve) => { release = resolve; });
    }
    return digest(algorithm, bytes);
  } } };
  const pending = f.api().start({ session: f.session, ...timing });
  await ready;
  f.api().cancel(); release();
  assert.equal((await pending).state, 'cancelled');
  await assert.rejects(f.api().exportInfo());
});

test('audit cancellation after page two stops traversal and restores the original position', async (t) => {
  const f = await fixture(t);
  const pending = f.api().start({ session: f.session, ...timing, mode: 'audit' });
  const deadline = Date.now() + 3000;
  while (!(f.api().status().phase === 'audit' && f.api().status().progress.page === 2) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(f.api().status().phase, 'audit');
  f.api().cancel();
  assert.equal((await pending).state, 'cancelled');
  assert.deepEqual(f.position(), { chapter: 1, page: 2 });
  assert.equal(f.api().status().restoration.ok, true);
  await assert.rejects(f.api().exportInfo());
});

test('NFKC and whitespace normalization accept the same reader title', async (t) => {
  const f = await fixture(t, { title: ' 合成 測試書 ９ ' });
  assert.equal((await f.api().start({ session: f.session, ...timing })).state, 'complete');
});

test('mismatched asset and source paths fail before a completed export exists', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.api().start({ session: { ...f.session, assetId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, ...timing }), /another book/);
  const session = structuredClone(f.session);
  session.spine[1].id = 'different-id'; session.manifest[1].id = 'different-id';
  await assert.rejects(f.api().start({ session, ...timing }), /differs from session/);
});

test('audit waits for delayed TOC navigation before attributing entries to source paths', async (t) => {
  const f = await fixture(t, { moveDelay: 90 });
  await f.api().start({ session: f.session, ...timing, mode: 'audit' });
  const { value } = await exportFixture(f.api());
  assert.deepEqual(value.tocEntries.map((item) => item.src), [bookSource('xhtml/body1.xhtml'), bookSource('xhtml/body2.xhtml'), bookSource('xhtml/body1.xhtml')]);
});

test('audit reads TOC buttons reused in a hidden panel', async (t) => {
  const f = await fixture(t, { persistentToc: true });
  await f.api().start({ session: f.session, ...timing, mode: 'audit' });
  const { value } = await exportFixture(f.api());
  assert.deepEqual(value.tocEntries.map((item) => item.src), [bookSource('xhtml/body1.xhtml'), bookSource('xhtml/body2.xhtml'), bookSource('xhtml/body1.xhtml')]);
});

test('audit tolerates temporarily invisible frames during a TOC transition', async (t) => {
  const f = await fixture(t, { moveDelay: 90, transitionInvisible: true });
  await f.api().start({ session: f.session, ...timing, mode: 'audit' });
  const { value } = await exportFixture(f.api());
  assert.deepEqual(value.tocEntries.map((item) => item.src), [bookSource('xhtml/body1.xhtml'), bookSource('xhtml/body2.xhtml'), bookSource('xhtml/body1.xhtml')]);
});

test('audit accepts an explicitly active TOC item even when the first page does not change', async (t) => {
  const f = await fixture(t, { initialChapter: 1, initialPage: 1, pages: [1, 1, 2], toc: [{ label: '同名', index: 1 }, { label: '同名', index: 1 }] });
  await f.api().start({ session: f.session, ...timing, mode: 'audit' });
  const { value } = await exportFixture(f.api());
  assert.deepEqual(value.tocEntries, [{ label: '同名', src: bookSource('xhtml/body1.xhtml') }, { label: '同名', src: bookSource('xhtml/body1.xhtml') }]);
});

test('audit fails when a nonactive TOC item never navigates instead of recording the old spine', async (t) => {
  const f = await fixture(t, { initialPage: 1, tocNoNavigation: true, toc: [{ label: '第二章', index: 2 }] });
  await assert.rejects(f.api().start({ session: f.session, ...timing, mode: 'audit' }), /TOC navigation/);
  await assert.rejects(f.api().exportInfo());
});

test('capture waits for document evidence when React source changes before the old document', async (t) => {
  const f = await fixture(t, { contentDelay: 100 });
  await f.api().start({ session: f.session, ...timing });
  const { value } = await exportFixture(f.api());
  assert.match(value.data[bookSource('xhtml/cover.xhtml')], /alt="封面"/);
  assert.match(value.data[bookSource('xhtml/body1.xhtml')], /前😀/);
  assert.match(value.data[bookSource('xhtml/body2.xhtml')], /圖前/);
});

test('audit waits for the new document before assigning its text to a source path', async (t) => {
  const f = await fixture(t, { contentDelay: 100 });
  await f.api().start({ session: f.session, ...timing, mode: 'audit' });
  const { value } = await exportFixture(f.api());
  assert.equal(value.records.find((item) => item.src === bookSource('xhtml/cover.xhtml')).bodyText, '');
  assert.equal(value.records.find((item) => item.src === bookSource('xhtml/body2.xhtml')).bodyText, '圖前。圖後。');
});

test('a changed React source with permanently stale document fails without an export', async (t) => {
  const f = await fixture(t, { contentNever: true });
  await assert.rejects(f.api().start({ session: f.session, ...timing }), /stability timeout/);
  await assert.rejects(f.api().exportInfo());
});

test('an OPF response body timeout closes its stream and restores the starting position', async (t) => {
  const networkState = {};
  const f = await fixture(t, { bodyHangOn: 'opf', networkState });
  await assert.rejects(f.api().start({ session: f.session, ...timing }), /Resource request timeout/);
  assert.equal(f.api().status().state, 'failed');
  assert.equal(networkState.active, false);
  assert.equal(networkState.closed, true);
  assert.equal(networkState.aborted, true);
  assert.deepEqual(f.position(), { chapter: 1, page: 2 });
  assert.equal(f.api().status().restoration.ok, true);
  await assert.rejects(f.api().exportInfo());
});

test('cancelling a hanging audit image response closes its stream and withholds export', async (t) => {
  const networkState = {};
  const f = await fixture(t, { bodyHangOn: 'image', networkState });
  const pending = f.api().start({ session: f.session, ...timing, mode: 'audit' });
  const deadline = Date.now() + 3000;
  while (!networkState.active && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(networkState.active, true);
  f.api().cancel();
  assert.equal((await pending).state, 'cancelled');
  assert.equal(networkState.active, false);
  assert.equal(networkState.closed, true);
  assert.equal(networkState.aborted, true);
  assert.deepEqual(f.position(), { chapter: 1, page: 2 });
  assert.equal(f.api().status().restoration.ok, true);
  await assert.rejects(f.api().exportInfo());
});

test('expanded official TOC includes duplicate entries below the viewport', async (t) => {
  const f = await fixture(t, { initialPage: 1, pages: [1, 1, 2], toc: [{ label: '同名', index: 1, y: 20 }, { label: '同名', index: 1, y: 700 }] });
  await f.api().start({ session: f.session, ...timing, mode: 'audit' });
  const { value } = await exportFixture(f.api());
  assert.deepEqual(value.tocEntries, [{ label: '同名', src: bookSource('xhtml/body1.xhtml') }, { label: '同名', src: bookSource('xhtml/body1.xhtml') }]);
});

for (const initialBaseAhead of [false, true]) {
  test(`startup never captures a stale document under initial React source (base ahead=${initialBaseAhead})`, async (t) => {
    const f = await fixture(t, { initialChapter: 0, initialPage: 1, initialDocumentChapter: 2, initialBaseAhead });
    await f.api().start({ session: f.session, ...timing });
    const { value, bytes } = await exportFixture(f.api());
    assert.match(value.data[bookSource('xhtml/cover.xhtml')], /alt="封面"/);
    assert.doesNotMatch(value.data[bookSource('xhtml/cover.xhtml')], /圖前/);
    assert.doesNotMatch(bytes.toString('utf8'), /fixture-private-context|openbook2\.jsp/);
  });
}

async function waitUntil(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.ok(predicate(), 'Fixture did not reach the requested observable state');
}

test('cancel waits for an issued chapter navigation before restoring and releasing the run', async (t) => {
  const f = await fixture(t, { moveDelay: 100 });
  const pending = f.api().start({ session: f.session, ...timing });
  await waitUntil(() => f.navigationPending());
  assert.deepEqual(f.position(), { chapter: 1, page: 2 });
  f.api().cancel();
  assert.equal((await pending).state, 'cancelled');
  assert.deepEqual(f.position(), { chapter: 1, page: 2 });
  assert.equal(f.api().status().restoration.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.deepEqual(f.position(), { chapter: 1, page: 2 });
  assert.equal(f.navigationPending(), false);
});

test('unconfirmed navigation survives cancellation and blocks clear and the next start', async (t) => {
  const options = { moveDelay: 500 };
  const f = await fixture(t, options);
  const pending = f.api().start({ session: f.session, timeoutMs: 60, pollMs: 2, stableSamples: 1 });
  await waitUntil(() => f.navigationPending());
  f.api().cancel();
  assert.equal((await pending).state, 'cancelled');
  assert.equal(f.api().status().restoration.ok, false);
  assert.throws(() => f.api().clear(), /navigation/i);
  await assert.rejects(f.api().start({ session: f.session, ...timing }), /navigation/i);
  assert.throws(() => f.api().clear(), /navigation/i);
  options.moveDelay = 0;
  await waitUntil(() => !f.navigationPending());
  assert.equal((await f.api().start({ session: f.session, ...timing })).state, 'complete');
});

for (const [name, responseOptions, message] of [
  ['HTTP 503', { responseStatus: 503 }, /Resource HTTP 503/],
  ['unexpected response URL', { responseUrl: 'https://service.ebook.hyread.com.tw/unexpected.opf' }, /Resource redirect/],
]) {
  test(`header rejection aborts and closes a hanging ${name} response body`, async (t) => {
    const networkState = {};
    const f = await fixture(t, { bodyHangOn: 'opf', networkState, ...responseOptions });
    await assert.rejects(f.api().start({ session: f.session, ...timing }), message);
    assert.equal(f.api().status().state, 'failed');
    assert.equal(networkState.active, false);
    assert.equal(networkState.closed, true);
    assert.equal(networkState.aborted, true);
    assert.match(f.api().status().errors[0], message);
    await assert.rejects(f.api().exportInfo());
  });
}

test('cancelling during restoration preserves an earlier independent OPF failure', async (t) => {
  const f = await fixture(t, { changedOpf: true });
  const pending = f.api().start({ session: f.session, ...timing, stableSamples: 10 }).then((value) => ({ value }), (error) => ({ error }));
  await waitUntil(() => f.api().status().phase === 'restoring');
  f.api().cancel();
  const outcome = await pending;
  assert.ok(outcome.error, 'The original independent failure must still reject');
  assert.match(outcome.error.message, /Source OPF hash changed/);
  assert.equal(f.api().status().state, 'failed');
  assert.match(f.api().status().errors[0], /Source OPF hash changed/);
  assert.equal(f.api().status().restoration.ok, true);
});

test('single-spine browser capture fails explicitly when a controlled association cannot be established', async (t) => {
  const f = await fixture(t, { singleSpine: true, initialChapter: 0, initialPage: 1 });
  await assert.rejects(f.api().start({ session: f.session, ...timing }), /Cannot establish document association/);
  assert.equal(f.api().status().state, 'failed');
  await assert.rejects(f.api().exportInfo());
  assert.equal(f.navigationPending(), false);
});

test('cancel also settles an already issued audit page turn before restoring', async (t) => {
  const f = await fixture(t, { moveDelay: 100 });
  const pending = f.api().start({ session: f.session, ...timing, mode: 'audit' });
  await waitUntil(() => f.api().status().phase === 'audit' && f.navigationPending() && f.position().chapter === 1 && f.position().page === 1);
  f.api().cancel();
  assert.equal((await pending).state, 'cancelled');
  assert.equal(f.api().status().restoration.ok, true);
  assert.deepEqual(f.position(), { chapter: 1, page: 2 });
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.deepEqual(f.position(), { chapter: 1, page: 2 });
});

test('cancel settles an already issued nonactive TOC click before restoring', async (t) => {
  const f = await fixture(t, { moveDelay: 100 });
  const pending = f.api().start({ session: f.session, ...timing, mode: 'audit' });
  await waitUntil(() => f.api().status().phase === 'audit' && f.navigationPending() && f.position().chapter === 1 && f.position().page === 3);
  f.api().cancel();
  assert.equal((await pending).state, 'cancelled');
  assert.equal(f.api().status().restoration.ok, true);
  assert.deepEqual(f.position(), { chapter: 1, page: 2 });
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.deepEqual(f.position(), { chapter: 1, page: 2 });
});

test('produced capture keys remain compatible with the legacy item URL mapper', async (t) => {
  const f = await fixture(t);
  await f.api().start({ session: f.session, ...timing });
  const { value } = await exportFixture(f.api());
  const mappedOrder = value.order.map((src) => src.split('/item/')[1]);
  assert.deepEqual(mappedOrder, ['xhtml/cover.xhtml', 'xhtml/body1.xhtml', 'xhtml/body2.xhtml']);
  assert.deepEqual(value.order, [
    'https://service.ebook.hyread.com.tw/ebookservice/epub/09090909090909090909090909090909/item/xhtml/cover.xhtml',
    'https://service.ebook.hyread.com.tw/ebookservice/epub/09090909090909090909090909090909/item/xhtml/body1.xhtml',
    'https://service.ebook.hyread.com.tw/ebookservice/epub/09090909090909090909090909090909/item/xhtml/body2.xhtml',
  ]);
  const legacyData = Object.fromEntries(value.order.map((src) => [src.split('/item/')[1], value.data[src]]));
  assert.match(legacyData['xhtml/cover.xhtml'], /alt="封面"/);
  assert.match(legacyData['xhtml/body1.xhtml'], /<ruby>字<rt>音<\/rt><\/ruby>/);
  assert.match(legacyData['xhtml/body2.xhtml'], /圖前/);
  assert.deepEqual(Object.keys(value.data), value.order);
  assert.deepEqual(f.session.spine.map((item) => item.href), ['xhtml/cover.xhtml', 'xhtml/body1.xhtml', 'xhtml/body2.xhtml']);
});

test('describe before start and all audit public source fields use canonical book URLs', async (t) => {
  const f = await fixture(t);
  assert.equal(f.api().describe().current.src, bookSource('xhtml/body1.xhtml'));
  await f.api().start({ session: f.session, ...timing, mode: 'audit' });
  const { value } = await exportFixture(f.api());
  const publicSources = [...value.records, ...value.tocEntries, ...value.issues.filter((issue) => 'src' in issue)].map((entry) => entry.src);
  assert.ok(publicSources.length >= 7);
  for (const src of publicSources) {
    const url = new URL(src);
    assert.equal(url.origin, 'https://service.ebook.hyread.com.tw');
    assert.match(url.pathname, /^\/ebookservice\/epub\/09090909090909090909090909090909\/item\/xhtml\/[^/]+\.xhtml$/);
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
  }
  assert.deepEqual(value.records.find((entry) => entry.spineId === 'body1').bodyLinks, [{ text: '回上段', href: '#first' }]);
});

for (const assetId of ['a'.repeat(31), 'a'.repeat(33), 'g'.repeat(32), 'synthetic_not_hex']) test('B3: browser rejects non-contract assetId before identity lookup ' + assetId, async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.api().start({ session: { ...f.session, assetId }, ...timing }), /Invalid session/);
  assert.equal(f.api().status().state, 'idle');
});
