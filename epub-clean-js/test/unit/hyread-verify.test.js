import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHyreadFixture, absoluteHyreadCapture } from '../helpers/hyread-fixtures.mjs';
import { prepareSession } from '../../hyread/lib/session.mjs';
import { buildHyreadEpub } from '../../hyread/lib/build.mjs';
import { readEpub, writeEpub } from '../../src/core/zip-io.js';
import { verifyHyreadEpub } from '../../hyread/lib/verify.mjs';
import { writeVerificationReports, exportSemanticMaterial } from '../../hyread/lib/reports.mjs';

async function fixture(t, options = {}) {
  const f = await createHyreadFixture(options); t.after(f.cleanup);
  f.resources['standard.opf'] = Buffer.from(f.opf.toString().replace('<metadata/>', '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>合成書</dc:title><dc:identifier>synthetic</dc:identifier><dc:language>zh-TW</dc:language></metadata>'));
  f.resources['standard.opf'] = Buffer.from(f.resources['standard.opf'].toString().replace('xhtml/cover.xhtml', 'xhtml/p-cover.xhtml'));
  f.resources['xhtml/p-cover.xhtml'] = f.resources['xhtml/cover.xhtml'];
  f.capture.order[0] = 'xhtml/p-cover.xhtml';
  f.capture.data['xhtml/p-cover.xhtml'] = f.capture.data['xhtml/cover.xhtml']; delete f.capture.data['xhtml/cover.xhtml'];
  f.capture.data['xhtml/body1.xhtml'] = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body><p class="gfont" id="a">同日</p><p>第一段<ruby>字<rt>音</rt></ruby>。</p><div id="blank">　</div><p><img src="../images/pixel.png" alt="插圖"/>圖尾</p><p><a href="body2.xhtml">下章</a></p></body></html>';
  f.capture.data['xhtml/body2.xhtml'] = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head><body><p class="gfont">同日</p><p>圖前。</p><svg xmlns="http://www.w3.org/2000/svg"><image href="../images/pixel.png"/></svg><p>圖後。</p></body></html>';
  const { config, session } = await prepareSession(f.config, { fetchImpl: f.fetchImpl });
  const capture = absoluteHyreadCapture(f.capture, config.itemBase);
  const image = config.itemBase + 'images/pixel.png';
  const paragraph = (index, tag, id, text, semantic = text) => ({ index, tag, id, text, semantic, display: 'block', visibility: 'visible' });
  const imageRecord = (tag, alt, paragraphIndex) => ({ tag, src: image, alt, paragraphIndex, width: 1, height: 1, complete: tag === 'img' ? true : null, naturalWidth: tag === 'img' ? 1 : null });
  const record = (spineIndex, bodyText, paragraphs, images, ruby = [], bodyLinks = []) => ({ spineIndex, spineId: session.spine[spineIndex].id, src: capture.order[spineIndex], bodyText, paragraphs, images, ruby, bodyLinks, pageCount: 1, pageChecks: [{ page: 1, total: 1, bodyUnchanged: true, visibleBlocks: paragraphs.map((p) => p.index) }], bodyChanges: [], unseenTextBlocks: [], errors: [] });
  const audit = {
    meta: { schemaVersion: 1, kind: 'audit', assetId: session.assetId, title: session.title, sourceOpfSha256: session.sourceOpfSha256, complete: true, startedAt: '2026-10-31T00:00:00Z', completedAt: '2026-10-31T00:01:00Z', restoration: { attempted: true, ok: true, error: null } },
    tocEntries: [{ label: '書封', src: capture.order[0] }, { label: '同日', src: capture.order[1] }, { label: '同日', src: capture.order[2] }],
    records: [
      record(0, '', [], [imageRecord('img', '封面', -1)]),
      record(1, '同日第一段字音。 圖尾下章', [paragraph(0, 'p', 'a', '同日'), paragraph(1, 'p', '', '第一段字音。'), paragraph(2, 'div', 'blank', ''), paragraph(3, 'p', '', '圖尾', `[image:${image}]圖尾`), paragraph(4, 'p', '', '下章')], [imageRecord('img', '插圖', 3)], ['字音'], [{ text: '下章', href: 'body2.xhtml' }]),
      record(2, '同日圖前。圖後。', [paragraph(0, 'p', '', '同日'), paragraph(1, 'p', '', '圖前。'), paragraph(2, 'p', '', '圖後。')], [imageRecord('image', '', -1)]),
    ],
    imageHashes: [{ url: image, ...session.resources['images/pixel.png'] }], issues: [],
  };
  await writeFile(config.capturePath, JSON.stringify(capture));
  const built = await buildHyreadEpub(config);
  return { ...f, config, session, capture, audit, epubPath: built.outputPath };
}

test('missing live audit stays not-run and requireLive prevents success', async (t) => {
  const f = await fixture(t);
  const report = await verifyHyreadEpub({ ...f, audit: undefined });
  assert.equal(report.ok, true); assert.equal(report.checks.live.status, 'not-run');
  assert.equal(report.checks.semantic.status, 'not-run');
  assert.equal((await verifyHyreadEpub({ ...f, audit: undefined, requireLive: true })).ok, false);
});

test('B2: invalid capture body fails capture and leaves dependent live comparison not-run', async (t) => {
  const f = await fixture(t);
  f.capture.data[f.capture.order[1]] = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>No body</title></head></html>';
  const report = await verifyHyreadEpub(f);
  assert.equal(report.ok, false);
  assert.equal(report.checks.capture.status, 'failed');
  assert.equal(report.checks.live.status, 'not-run');
  assert.equal(report.perDocument[1].captureStatus, 'failed');
  assert.equal(report.perDocument[1].liveStatus, 'not-run');
  assert.ok(report.perDocument[1].issues.some(({ check, issue }) => check === 'capture' && /no body/i.test(issue)));
  assert.equal(report.checks.live.issues.length, 0);
});

test('B4: reordering only audit link object keys preserves live success', async (t) => {
  const f = await fixture(t);
  f.audit.records[1].bodyLinks = [{ href: 'body2.xhtml', text: '下章' }];
  const report = await verifyHyreadEpub(f);
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  assert.equal(report.checks.live.status, 'passed');
});

test('live verification matches records by spine index, preserves duplicate labels and accepts equivalent links', async (t) => {
  const f = await fixture(t);
  f.audit.records.reverse();
  f.audit.records.find((v) => v.spineIndex === 1).bodyLinks[0].href = f.capture.order[2];
  f.capture.data = Object.fromEntries(Object.entries(f.capture.data).reverse());
  const report = await verifyHyreadEpub(f);
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  assert.equal(report.rawTextEqual, true); assert.equal(report.checks.live.status, 'passed');
  assert.equal(report.perDocument.length, 3); assert.equal(report.stats.liveBlocks, 8);
  assert.equal(report.artifact.sha256.length, 64);
});

for (const [name, mutate] of [
  ['missing character', (a) => { a.records[1].bodyText = a.records[1].bodyText.replace('段', ''); }],
  ['paragraph order', (a) => { [a.records[1].paragraphs[0].text, a.records[1].paragraphs[1].text] = [a.records[1].paragraphs[1].text, a.records[1].paragraphs[0].text]; }],
  ['paragraph tag', (a) => { a.records[1].paragraphs[0].tag = 'h1'; }],
  ['paragraph id', (a) => { a.records[1].paragraphs[0].id = 'other'; }],
  ['ruby', (a) => { a.records[1].ruby = ['異音']; }],
  ['image alt', (a) => { a.records[1].images[0].alt = '別圖'; }],
  ['image position', (a) => { a.records[1].images[0].paragraphIndex = 1; }],
  ['image semantic position', (a) => { a.records[1].paragraphs[3].semantic = '圖尾'; }],
  ['link', (a) => { a.records[1].bodyLinks[0].href = '#a'; }],
  ['wrong target for same label', (a) => { a.tocEntries[2].src = a.tocEntries[1].src; }],
  ['missing toc entry', (a) => { a.tocEntries.pop(); }],
  ['missing page', (a) => { a.records[1].pageCount = 2; }],
  ['body changed while paging', (a) => { a.records[1].pageChecks[0].bodyUnchanged = false; a.records[1].bodyChanges.push({ page: 1, bodyText: '變動' }); }],
  ['unseen text even if producer omits issue', (a) => { a.records[1].pageChecks[0].visibleBlocks = [0]; }],
  ['reported unseen blocks', (a) => { a.records[1].unseenTextBlocks = [1]; }],
  ['loading error', (a) => { a.records[1].errors = ['load failed']; }],
  ['broken image', (a) => { a.records[1].images[0].complete = false; }],
  ['audit issue', (a) => { a.issues.push({ type: 'bodyChanged', src: a.records[0].src, page: 1 }); }],
  ['missing image hash', (a) => { a.imageHashes = []; }],
  ['wrong image hash', (a) => { a.imageHashes[0].sha256 = '0'.repeat(64); }],
  ['wrong identity', (a) => { a.meta.assetId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; }],
  ['wrong OPF hash', (a) => { a.meta.sourceOpfSha256 = '0'.repeat(64); }],
]) test(`live verification rejects ${name}`, async (t) => {
  const f = await fixture(t); mutate(f.audit);
  const report = await verifyHyreadEpub(f);
  assert.equal(report.ok, false); assert.equal(report.checks.live.status, 'failed');
  assert.ok(report.checks.live.issues.length > 0);
  if (name === 'paragraph id') assert.ok(report.perDocument[1].issues.some((v) => /blocks\[0\]/u.test(v.issue)));
  assert.equal(report.checks.semantic.status, 'not-run');
});

test('EPUB mutation fails capture verification with a document evidence location', async (t) => {
  const f = await fixture(t), { entries } = await readEpub(f.epubPath);
  entries['item/xhtml/body1.xhtml'] = Buffer.from(entries['item/xhtml/body1.xhtml'].toString().replace('第一段', '第段'));
  f.epubPath = join(f.config.workDir, 'changed.epub'); await writeEpub(f.epubPath, entries);
  const report = await verifyHyreadEpub(f);
  assert.equal(report.ok, false); assert.equal(report.rawTextEqual, false);
  assert.equal(report.checks.capture.status, 'failed');
  assert.ok(report.perDocument[1].issues.length > 0);
});

test('report writes JSON and readable status evidence without replacing a different old report', async (t) => {
  const f = await fixture(t), report = await verifyHyreadEpub(f);
  const jsonPath = join(f.config.workDir, 'verification.json');
  const paths = await writeVerificationReports(report, jsonPath);
  assert.deepEqual(JSON.parse(await readFile(paths.jsonPath, 'utf8')), report);
  const markdown = await readFile(paths.markdownPath, 'utf8');
  assert.match(markdown, /semantic.*not-run/); assert.match(markdown, /rawTextEqual.*true/);
  assert.match(markdown, /xhtml\/body1.xhtml/);
  await writeVerificationReports(report, jsonPath);
  await assert.rejects(writeVerificationReports({ ...report, ok: false }, jsonPath), /differs/);
  await assert.rejects(writeVerificationReports(report, jsonPath + '.txt'), /\.json/);
});

test('semantic export retains blank blocks, ruby, images outside blocks, boundary and raw text', async (t) => {
  const f = await fixture(t), outDir = join(f.config.workDir, 'semantic');
  const result = await exportSemanticMaterial(f.audit, outDir);
  const index = JSON.parse(await readFile(result.indexPath, 'utf8'));
  assert.equal(index.semanticStatus, 'not-run'); assert.equal(result.files.length, 3);
  const chapter = await readFile(result.files[1], 'utf8');
  assert.match(chapter, /\[0003\].*空白块/); assert.match(chapter, /字音/);
  assert.match(chapter, /\[image:.*pixel.png\]/); assert.match(chapter, /章首/); assert.match(chapter, /章尾/);
  assert.match(chapter, /xhtml\/body1.xhtml/); assert.match(chapter, /标题.*同日/);
  const outside = await readFile(result.files[2], 'utf8'); assert.match(outside, /paragraphIndex=-1/);
  const changed = structuredClone(f.audit); changed.records[1].bodyText += '額外文字';
  await assert.rejects(exportSemanticMaterial(changed, outDir), /differs/);
  await assert.rejects(exportSemanticMaterial({ ...f.audit, records: [] }, outDir), /differs|records/);
});

test('failed restoration is reported as observation and does not erase completed live evidence', async (t) => {
  const f = await fixture(t); f.audit.meta.restoration.ok = false; f.audit.meta.restoration.error = 'restoration failed';
  const report = await verifyHyreadEpub(f);
  assert.equal(report.ok, true); assert.deepEqual(report.restoration, f.audit.meta.restoration);
});

for (const [name, options, expectedOk] of [
  ['verified volume 14 introduction', { volume: '14', assetId: '2d68797b1326483e9294e44696a80267' }, true],
  ['another book using p-001 for body text', {}, false],
  ['same volume with another asset', { volume: '14', assetId: '14141414141414141414141414141414' }, false],
  ['same asset with another volume', { volume: '13', assetId: '2d68797b1326483e9294e44696a80267' }, false],
]) test(`official menu omission: ${name}`, async (t) => {
  const f = await fixture(t, options);
  f.resources['standard.opf'] = Buffer.from(f.resources['standard.opf'].toString().replace('xhtml/body1.xhtml', 'xhtml/p-001.xhtml'));
  f.resources['xhtml/p-001.xhtml'] = f.resources['xhtml/body1.xhtml'];
  const { config, session } = await prepareSession(f.config, { fetchImpl: f.fetchImpl });
  const old = f.capture.order[1], src = config.itemBase + 'xhtml/p-001.xhtml';
  f.capture.order[1] = src; f.capture.data[src] = f.capture.data[old]; delete f.capture.data[old];
  Object.assign(f, { config, session }); f.audit.meta.sourceOpfSha256 = session.sourceOpfSha256;
  f.audit.records[1].src = src; f.audit.tocEntries.splice(1, 1);
  await writeFile(config.capturePath, JSON.stringify(f.capture));
  f.epubPath = (await buildHyreadEpub(config, { replace: true })).outputPath;
  const report = await verifyHyreadEpub(f);
  assert.equal(report.ok, expectedOk, JSON.stringify(report.checks));
  if (!expectedOk) assert.ok(report.checks.live.issues.some((issue) => issue.includes('TOC chapter missing from live menu: xhtml/p-001.xhtml')));
});

test('volume 08 corrections apply only to output, raw audit remains strict and extra edits fail', async (t) => {
  const f = await fixture(t, { volume: '08', assetId: '8a8a84ca8cf2eb56018d6786f66a472c' });
  f.resources['standard.opf'] = Buffer.from(f.resources['standard.opf'].toString().replace('xhtml/body1.xhtml', 'xhtml/p-toc-001.xhtml'));
  f.resources['xhtml/p-toc-001.xhtml'] = f.resources['xhtml/body1.xhtml'];
  const { config, session } = await prepareSession(f.config, { fetchImpl: f.fetchImpl });
  const old = f.capture.order[1], src = config.itemBase + 'xhtml/p-toc-001.xhtml';
  f.capture.order[1] = src;
  f.capture.data[src] = f.capture.data[old].replace('同日', '目次').replace('第一段', '６月１日（星期五） ６月７日（星期六）'); delete f.capture.data[old];
  Object.assign(f, { config, session });
  f.audit.meta.sourceOpfSha256 = session.sourceOpfSha256;
  f.audit.records[1].src = src;
  f.audit.records[1].bodyText = '目次６月１日（星期五） ６月７日（星期六）字音。 圖尾下章';
  Object.assign(f.audit.records[1].paragraphs[0], { text: '目次', semantic: '目次' });
  Object.assign(f.audit.records[1].paragraphs[1], { text: '６月１日（星期五） ６月７日（星期六）字音。', semantic: '６月１日（星期五） ６月７日（星期六）字音。' });
  f.audit.tocEntries[1] = { label: '目錄', src };
  await writeFile(config.capturePath, JSON.stringify(f.capture));
  f.epubPath = (await buildHyreadEpub(config, { replace: true })).outputPath;
  const rawAudit = JSON.stringify(f.audit), report = await verifyHyreadEpub(f);
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  assert.equal(report.rawTextEqual, false); assert.equal(report.allowedCorrections.filter((v) => v.status === 'applied').length, 2);
  assert.equal(JSON.stringify(f.audit), rawAudit);
  const material = await exportSemanticMaterial(f.audit, join(config.workDir, 'semantic-08'));
  assert.match(await readFile(material.files[1], 'utf8'), /６月１日（星期五）/);
  f.audit.records[1].bodyText = f.audit.records[1].bodyText.replace('星期五', '星期二');
  assert.equal((await verifyHyreadEpub(f)).checks.live.status, 'failed');
  f.audit = JSON.parse(rawAudit);
  const { entries } = await readEpub(f.epubPath);
  entries['item/xhtml/p-toc-001.xhtml'] = Buffer.from(entries['item/xhtml/p-toc-001.xhtml'].toString().replace('圖尾', '多字圖尾'));
  f.epubPath = join(config.workDir, 'third-edit.epub'); await writeEpub(f.epubPath, entries);
  assert.equal((await verifyHyreadEpub(f)).ok, false);
});

test('verification preserves proven inert-link diagnostics and removes reader credentials from reports', async (t) => {
  const f = await fixture(t);
  f.capture.data[f.capture.order[1]] = f.capture.data[f.capture.order[1]].replace('</head>', '<!-- <link href="missing.css"/> --></head>');
  await writeFile(f.config.capturePath, JSON.stringify(f.capture));
  f.epubPath = (await buildHyreadEpub(f.config, { replace: true })).outputPath;
  f.audit.meta.restoration.error = 'https://account:secret@example.invalid/reader.jsp?data=private https://account:secret@example.invalid/item/file?token=private';
  const report = await verifyHyreadEpub(f);
  assert.equal(report.ok, true);
  assert.equal(report.ignoredNonElementReferences.length, 1);
  assert.equal(report.ignoredNonElementReferences[0].regionType, 'comment');
  assert.doesNotMatch(JSON.stringify(report), /secret|private|account|data=/);
});

test('invalid capture cannot claim structure validation that was skipped', async (t) => {
  const f = await fixture(t); f.capture.order.pop();
  const report = await verifyHyreadEpub(f);
  assert.equal(report.ok, false); assert.equal(report.checks.capture.status, 'failed');
  assert.equal(report.checks.structure.status, 'not-run');
});

test('semantic export rejects signed image URLs before creating material', async (t) => {
  const f = await fixture(t);
  f.audit.records[0].images[0].src += '?data=private';
  await assert.rejects(exportSemanticMaterial(f.audit, join(f.config.workDir, 'unsafe-semantic')), /image|URL/);
});

for (const [name, url] of [
  ['parenthesis in path', 'https://example.invalid/item/(file)?token=PRIVATE_PATH'],
  ['parenthesis in query', 'https://example.invalid/reader.jsp?data=prefix)PRIVATE_QUERY'],
  ['parenthesis in credentials', 'https://name):PRIVATE_CREDENTIAL@example.invalid/item/file?data=PRIVATE_DATA'],
  ['unparseable URL with sensitive tail', 'https://[invalid)host/item?data=PRIVATE_INVALID'],
]) test(`report URL redaction consumes the complete ${name}`, async (t) => {
  const f = await fixture(t); f.audit.meta.restoration.error = url;
  const report = await verifyHyreadEpub(f);
  assert.equal(report.ok, true);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|token=|data=|name\)/u);
  const paths = await writeVerificationReports(report, join(f.config.workDir, 'url-redaction.json'));
  for (const path of [paths.jsonPath, paths.markdownPath]) assert.doesNotMatch(await readFile(path, 'utf8'), /PRIVATE_|token=|data=|name\)/u);
});

for (const unavailable of ['missing.epub', '.']) test(`unavailable EPUB ${unavailable} leaves capture comparison not-run`, async (t) => {
  const f = await fixture(t); f.epubPath = join(f.config.workDir, unavailable);
  const report = await verifyHyreadEpub(f);
  assert.equal(report.ok, false); assert.equal(report.checks.structure.status, 'failed');
  assert.equal(report.checks.capture.status, 'not-run'); assert.equal(report.perDocument.length, 0);
});

for (const [name, diagnostic] of [
  ['compact JSON', '["https://example.invalid/item/file","https://account:PRIVATE_ADJACENT@example.invalid/item/file"]'],
  ['adjacent angle brackets', '<https://example.invalid/item/file>,<https://account:PRIVATE_ANGLE@example.invalid/item/file>'],
  ['unseparated URL candidates', 'https://example.invalid/item/file,https://account):PRIVATE_JOINED@example.invalid/item/(file)?data=PRIVATE_DATA'],
  ['invalid first URL and a second credential', 'https://[invalid)host/item?data=PRIVATE_INVALID,<https://account:PRIVATE_SECOND@example.invalid/item/file>'],
]) test(`report redaction does not merge credentials from ${name}`, async (t) => {
  const f = await fixture(t); f.audit.meta.restoration.error = diagnostic;
  const auditBefore = JSON.stringify(f.audit), captureBefore = JSON.stringify(f.capture);
  const report = await verifyHyreadEpub(f);
  assert.equal(report.ok, true);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|account|data=/u);
  assert.equal(report.perDocument[1].src, f.capture.order[1]);
  assert.equal(report.perDocument[1].spineIndex, 1);
  const paths = await writeVerificationReports(report, join(f.config.workDir, 'adjacent-url-report.json'));
  const saved = JSON.parse(await readFile(paths.jsonPath, 'utf8'));
  assert.equal(saved.perDocument[1].src, f.capture.order[1]);
  for (const path of [paths.jsonPath, paths.markdownPath]) assert.doesNotMatch(await readFile(path, 'utf8'), /PRIVATE_|account|data=/u);
  assert.equal(JSON.stringify(f.audit), auditBefore); assert.equal(JSON.stringify(f.capture), captureBefore);
});
