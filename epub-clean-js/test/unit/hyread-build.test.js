import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHyreadFixture, absoluteHyreadCapture } from '../helpers/hyread-fixtures.mjs';
import { prepareSession } from '../../hyread/lib/session.mjs';
import { buildHyreadEpub, checkBuiltEpub } from '../../hyread/lib/build.mjs';
import { normalizeText, inspectXhtml, applyApprovedCorrections } from '../../hyread/lib/content.mjs';
import { readEpub, writeEpub } from '../../src/core/zip-io.js';

async function fixture(t, options = {}) {
  const f = await createHyreadFixture(options);
  t.after(f.cleanup);
  f.resources['standard.opf'] = Buffer.from(f.opf.toString().replace('<metadata/>', '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>合成書</dc:title><dc:identifier>synthetic</dc:identifier><dc:language>zh-TW</dc:language><meta property="hdf">private</meta></metadata>'));
  const { config, session } = await prepareSession(f.config, { fetchImpl: f.fetchImpl });
  const capture = absoluteHyreadCapture(f.capture, config.itemBase);
  await writeFile(config.capturePath, JSON.stringify(capture));
  return { ...f, config, session, capture };
}

test('inspectXhtml uses leaf blocks and preserves text, ruby, image order and raw links', () => {
  const html = '<html><head><title>排除</title></head><body><div id="outer">外<p id="a"> A　😀 <ruby>字<rt>音</rt></ruby></p><div id="empty"><img src="a.png" alt="圖"/></div></div><svg><image href="b.png"/></svg><a href="#a">連結</a></body></html>';
  assert.equal(normalizeText(' A　\n 😀 '), 'A 😀');
  assert.deepEqual(inspectXhtml(html), { bodyText: '外 A 😀 字音連結', blocks: [{ tag: 'p', id: 'a', text: 'A 😀 字音' }, { tag: 'div', id: 'empty', text: '' }], images: [{ tag: 'img', src: 'a.png', alt: '圖' }, { tag: 'image', src: 'b.png', alt: '' }], ruby: ['字音'], links: [{ text: '連結', href: '#a' }] });
});

test('approved corrections require exact volume, asset and path and report unmatched rules', () => {
  const html = '<p>６月１日（星期五） ６月１日（星期五）</p>';
  const context = { volume: '08', assetId: '8a8a84ca8cf2eb56018d6786f66a472c', href: 'xhtml/p-toc-001.xhtml' };
  const result = applyApprovedCorrections(html, context);
  assert.equal(result.html, '<p>６月１日（星期二） ６月１日（星期二）</p>');
  assert.deepEqual(result.corrections.map(({ occurrences, status }) => ({ occurrences, status })), [{ occurrences: 2, status: 'applied' }, { occurrences: 0, status: 'not-applicable' }]);
  for (const change of [{ volume: '09' }, { assetId: 'other' }, { href: 'xhtml/body.xhtml' }]) assert.equal(applyApprovedCorrections(html, { ...context, ...change }).html, html);
});

test('build publishes validated EPUB, preserves all binary/CSS bytes and mixed SVG text', async (t) => {
  const f = await fixture(t), built = await buildHyreadEpub(f.config);
  const { entries } = await readEpub(built.outputPath);
  assert.equal(built.report.ok, true);
  assert.equal(built.report.rawTextEqual, true);
  assert.equal(built.buildDir.startsWith(f.config.buildDir), true);
  assert.notEqual(built.buildDir, f.config.buildDir);
  assert.deepEqual(entries['item/images/pixel.png'], f.resources['images/pixel.png']);
  assert.deepEqual(entries['item/style.css'], f.resources['style.css']);
  assert.match(entries['item/xhtml/body2.xhtml'].toString(), /圖前。/);
  assert.doesNotMatch(entries['item/xhtml/body2.xhtml'].toString(), /fixed-layout-jp/);
  assert.doesNotMatch(entries['item/standard.opf'].toString(), /property="hdf"/);
  assert.match(entries['item/nav.xhtml'].toString(), /body2.xhtml/);
  await assert.rejects(buildHyreadEpub(f.config));
});

test('missing captured chapter and corrupted session resource preserve previous EPUB on replace', async (t) => {
  const f = await fixture(t), first = await buildHyreadEpub(f.config), old = await readFile(first.outputPath);
  await writeFile(f.config.capturePath, JSON.stringify({ ...f.capture, order: f.capture.order.slice(1) }));
  await assert.rejects(buildHyreadEpub(f.config, { replace: true }));
  assert.deepEqual(await readFile(first.outputPath), old);
  await writeFile(f.config.capturePath, JSON.stringify(f.capture));
  await writeFile(join(f.config.itemDir, 'style.css'), 'corrupt');
  await assert.rejects(buildHyreadEpub(f.config, { replace: true }));
  assert.deepEqual(await readFile(first.outputPath), old);
});

test('non-spine non-nav XHTML cannot silently enter EPUB', async (t) => {
  const f = await createHyreadFixture(); t.after(f.cleanup);
  f.resources['standard.opf'] = Buffer.from(f.opf.toString().replace('</manifest>', '<item id="extra" href="extra.xhtml" media-type="application/xhtml+xml"/></manifest>'));
  f.resources['extra.xhtml'] = Buffer.from('encrypted');
  const { config } = await prepareSession(f.config, { fetchImpl: f.fetchImpl });
  await writeFile(config.capturePath, JSON.stringify({ order: f.capture.order.map((s) => config.itemBase + s), data: Object.fromEntries(Object.entries(f.capture.data).map(([s, h]) => [config.itemBase + s, h])) }));
  await assert.rejects(buildHyreadEpub(config), /uncaptured|non.spine|XHTML/i);
});

test('checkBuiltEpub fails changed text, ruby, image bytes, invalid XML, nav/spine, remote dependency, broken links and orphan', async (t) => {
  const f = await fixture(t), built = await buildHyreadEpub(f.config);
  const { entries } = await readEpub(built.outputPath);
  const cases = [
    (e) => { e['item/xhtml/body1.xhtml'] = Buffer.from(e['item/xhtml/body1.xhtml'].toString().replace('第一段', '额外改字')); },
    (e) => { e['item/xhtml/body1.xhtml'] = Buffer.from(e['item/xhtml/body1.xhtml'].toString().replace('<ruby>字<rt>音</rt></ruby>', '字音')); },
    (e) => { e['item/images/pixel.png'] = Buffer.from('corrupt'); },
    (e) => { e['item/xhtml/body1.xhtml'] = Buffer.from('<html><body><p></body></html>'); },
    (e) => { e['item/nav.xhtml'] = Buffer.from(e['item/nav.xhtml'].toString().replace('xhtml/body2.xhtml', 'xhtml/missing.xhtml')); },
    (e) => { e['item/standard.opf'] = Buffer.from(e['item/standard.opf'].toString().replace('<itemref idref="body2"/>', '')); },
    (e) => { e['item/xhtml/body1.xhtml'] = Buffer.from(e['item/xhtml/body1.xhtml'].toString().replace('</head>', '<script src="https://evil.invalid/a.js"></script></head>')); },
    (e) => { e['item/xhtml/body1.xhtml'] = Buffer.from(e['item/xhtml/body1.xhtml'].toString().replace('</head>', '<link rel="stylesheet" href="missing.css"/></head>')); },
    (e) => { e['item/orphan.txt'] = Buffer.from('unmanifested'); },
    (e) => { e['item/xhtml/body2.xhtml'] = Buffer.from(e['item/xhtml/body2.xhtml'].toString().replace('<p>圖前。</p>', '').replace('</svg>', '</svg><p>圖前。</p>')); },
    (e) => { e['item/standard.opf'] = Buffer.from(e['item/standard.opf'].toString().replace('合成書', '篡改書名')); },
  ];
  for (const [index, mutate] of cases.entries()) {
    const changed = { ...entries }; mutate(changed);
    const epubPath = join(f.config.workDir, `mutated-${index}.epub`);
    await writeEpub(epubPath, changed);
    const report = await checkBuiltEpub({ config: f.config, session: f.session, capture: f.capture, epubPath });
    assert.equal(report.ok, false, `mutation ${index}: ${JSON.stringify(report)}`);
    assert.ok(report.issues.length > 0);
  }
});

test('failed replacement keeps old EPUB/build and removes only its own temporary ZIP', async (t) => {
  const f = await fixture(t), built = await buildHyreadEpub(f.config), old = await readFile(built.outputPath);
  const src = f.capture.order[1];
  f.capture.data[src] = f.capture.data[src].replace('</head>', '<script src="blob:synthetic"></script></head>');
  await writeFile(f.config.capturePath, JSON.stringify(f.capture));
  await assert.rejects(buildHyreadEpub(f.config, { replace: true }), (error) => {
    assert.equal(error.report.ok, false);
    assert.ok(error.report.issues.some((issue) => /dependency/.test(issue)));
    assert.ok(error.buildDir); return true;
  });
  assert.deepEqual(await readFile(built.outputPath), old);
  assert.ok((await readFile(join(built.buildDir, 'item/xhtml/body1.xhtml'), 'utf8')).includes('第一段'));
  assert.equal((await readdir(join(f.config.projectRoot, 'output/hyread'))).some((name) => name.endsWith('.tmp.epub')), false);
  assert.equal((await readdir(f.config.buildDir)).length, 2);
});

test('image-only SVG uses image CSS and mixed SVG page removes font-size-zero CSS', async (t) => {
  const f = await fixture(t);
  f.resources['standard.opf'] = Buffer.from(f.resources['standard.opf'].toString().replace('</manifest>', '<item id="fixedcss" href="style/fixed-layout-jp.css" media-type="text/css"/><item id="textcss" href="style/style-standard.css" media-type="text/css"/></manifest>'));
  f.resources['style/fixed-layout-jp.css'] = Buffer.from('body{font-size:0}');
  f.resources['style/style-standard.css'] = Buffer.from('body{font-size:1em}');
  const { config, session } = await prepareSession(f.config, { fetchImpl: f.fetchImpl });
  f.capture.data[f.capture.order[0]] = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>圖</title></head><body><svg xmlns="http://www.w3.org/2000/svg"><image href="../images/pixel.png"/></svg></body></html>';
  f.capture.data[f.capture.order[2]] = f.capture.data[f.capture.order[2]].replace('</head>', '<link rel="stylesheet" href="../style/fixed-layout-jp.css"/></head>');
  await writeFile(config.capturePath, JSON.stringify(f.capture));
  const built = await buildHyreadEpub(config), { entries } = await readEpub(built.outputPath);
  assert.match(entries['item/xhtml/cover.xhtml'].toString(), /fixed-layout-jp\.css/);
  assert.doesNotMatch(entries['item/xhtml/body2.xhtml'].toString(), /fixed-layout-jp\.css/);
  assert.match(entries['item/xhtml/body2.xhtml'].toString(), /style-standard\.css/);
  assert.equal((await checkBuiltEpub({ config, session, capture: f.capture, epubPath: built.outputPath })).ok, true);
});

test('volume 08 output reports exact allowed changes and rejects a third change', async (t) => {
  const f = await createHyreadFixture({ volume: '08', assetId: '8a8a84ca8cf2eb56018d6786f66a472c' }); t.after(f.cleanup);
  f.resources['standard.opf'] = Buffer.from(f.opf.toString().replace('xhtml/body1.xhtml', 'xhtml/p-toc-001.xhtml').replace('<metadata/>', '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>測試</dc:title><dc:identifier>test</dc:identifier><dc:language>zh-TW</dc:language></metadata>'));
  f.resources['xhtml/p-toc-001.xhtml'] = f.resources['xhtml/body1.xhtml'];
  const { config, session } = await prepareSession(f.config, { fetchImpl: f.fetchImpl });
  const relative = { order: f.capture.order.map((s) => s.replace('body1', 'p-toc-001')), data: { ...f.capture.data } };
  relative.data['xhtml/p-toc-001.xhtml'] = relative.data['xhtml/body1.xhtml'].replace('第一段', '６月１日（星期五） ６月７日（星期六）'); delete relative.data['xhtml/body1.xhtml'];
  const capture = absoluteHyreadCapture(relative, config.itemBase);
  await writeFile(config.capturePath, JSON.stringify(capture));
  const built = await buildHyreadEpub(config);
  assert.equal(built.report.ok, true); assert.equal(built.report.rawTextEqual, false);
  assert.deepEqual(built.report.allowedCorrections.map((v) => v.status), ['applied', 'applied']);
  assert.deepEqual(JSON.parse(await readFile(config.capturePath, 'utf8')), capture);
  const { entries } = await readEpub(built.outputPath);
  assert.match(entries['item/xhtml/p-toc-001.xhtml'].toString(), /６月１日（星期二）/);
  entries['item/xhtml/p-toc-001.xhtml'] = Buffer.from(entries['item/xhtml/p-toc-001.xhtml'].toString().replace('字', '错'));
  const epubPath = join(config.workDir, 'extra-change.epub'); await writeEpub(epubPath, entries);
  const result = await checkBuiltEpub({ config, session, capture, epubPath });
  assert.equal(result.ok, false); assert.equal(result.allowedCorrections.length, 2);
});

test('dependency checks ignore CSS-like novel text and CSS comments but reject active CSS imports', async (t) => {
  const f = await fixture(t);
  const src = f.capture.order[1];
  f.capture.data[src] = f.capture.data[src].replace('</body>', '<p>文字 url(https://example.invalid/literal) 與 @import "https://example.invalid/literal.css"</p></body>');
  f.resources['style.css'] = Buffer.from('/* url(https://example.invalid/comment) */ body{line-height:1.8}');
  const { config } = await prepareSession(f.config, { fetchImpl: f.fetchImpl });
  await writeFile(config.capturePath, JSON.stringify(f.capture));
  const built = await buildHyreadEpub(config);
  assert.equal(built.report.ok, true);
  f.capture.data[src] = f.capture.data[src].replace('</head>', '<style>@import "https://example.invalid/active.css";</style></head>');
  await writeFile(config.capturePath, JSON.stringify(f.capture));
  await assert.rejects(buildHyreadEpub(config, { replace: true }), /dependency/);
});
