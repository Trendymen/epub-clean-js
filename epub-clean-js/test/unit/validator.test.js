import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeEpub } from '../../src/core/zip-io.js';
import { validateOutput } from '../../src/core/validator.js';

async function validate(t, overrides = {}, { ncx = true, identifier = 'publication' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'epub-validator-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const files = {
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    'OPS/book.opf': `<package unique-identifier="${identifier}"><metadata><dc:title>书</dc:title><dc:identifier id="${identifier}">urn:book:one</dc:identifier><dc:language>zh</dc:language></metadata><manifest><item href="one.xhtml"/><item href="two%20page.xhtml"/><item href="style.css"/>${ncx ? '<item href="toc.ncx"/>' : ''}</manifest></package>`,
    'OPS/one.xhtml': '<html><body><p id="段落">正文</p><a href="#%E6%AE%B5%E8%90%BD">同页</a><a href="two%20page.xhtml#target">跨页</a></body></html>',
    'OPS/two page.xhtml': '<html><body><p id="target">目标</p></body></html>',
    'OPS/style.css': 'p { color: red; }',
    ...(ncx ? { 'OPS/toc.ncx': '<ncx><head><meta name="dtb:uid" content="urn:book:one"/></head><navMap><navPoint><content src="one.xhtml#段落"/></navPoint></navMap></ncx>' } : {}),
    ...overrides,
  };
  const out = join(dir, 'book.epub');
  await writeEpub(out, files);
  return validateOutput(out);
}

test('validator accepts encoded references and the package-selected identifier with or without NCX', async (t) => {
  for (const ncx of [true, false]) {
    const result = await validate(t, {}, { ncx });
    assert.deepEqual(result, { ok: true, issues: [], orphans: [], brokenLinks: [] });
  }
});

test('validator rejects duplicate XHTML IDs', async (t) => {
  const result = await validate(t, { 'OPS/two page.xhtml': '<html><body><p id="target"/><p id="target"/></body></html>' });
  assert.equal(result.ok, false);
  assert.match(result.issues.join('\n'), /重复.*target/);
});

test('validator rejects mismatched NCX UID', async (t) => {
  const result = await validate(t, { 'OPS/toc.ncx': '<ncx><head><meta name="dtb:uid" content="other"/></head></ncx>' });
  assert.equal(result.ok, false);
  assert.match(result.issues.join('\n'), /NCX.*标识/);
});

test('validator rejects a missing manifest resource and an unresolved unique-identifier', async (t) => {
  const missing = await validate(t, { 'OPS/book.opf': '<package unique-identifier="book"><metadata><dc:title>书</dc:title><dc:identifier id="different">one</dc:identifier><dc:language>zh</dc:language></metadata><manifest><item href="missing.xhtml"/></manifest></package>' }, { ncx: false });
  assert.equal(missing.ok, false);
  assert.match(missing.issues.join('\n'), /manifest 项不存在/);
  assert.match(missing.issues.join('\n'), /unique-identifier/);
});

test('validator resolves CSS encoded resource paths and ignores external CSS queries', async (t) => {
  const result = await validate(t, {
    'OPS/style.css': '@import "extra%20style.css"; p{background:url("image%3Aone.png?cache=1")} @font-face{src:url(HTTPS://example.test/font.woff2?x=1)}',
    'OPS/extra style.css': 'p{color:blue}',
    'OPS/image:one.png': Buffer.from('image'),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.brokenLinks.length, 0);
});

test('validator rejects missing same-page, cross-page, NCX fragments and resources', async (t) => {
  const result = await validate(t, {
    'OPS/one.xhtml': '<html><body><a href="#absent">同页</a><a href="two%20page.xhtml#absent">跨页</a><img src="missing.png"/></body></html>',
    'OPS/toc.ncx': '<ncx><head><meta name="dtb:uid" content="urn:book:one"/></head><navMap><navPoint><content src="two%20page.xhtml#ncx-absent"/></navPoint></navMap></ncx>',
  });
  assert.equal(result.ok, false);
  assert.equal(result.brokenLinks.length, 4);
});

test('validator checks CSS URLs and imports while ignoring external URIs and keeping orphans nonfatal', async (t) => {
  const result = await validate(t, {
    'OPS/one.xhtml': '<html><head><style>p{background:url(missing-inline.png)}</style></head><body id="段落" style="background:url(missing-attr.png)"><a href="HTTPS://example.test/a#b">外链</a><img src="data:image/png;base64,AA"/><a href="//example.test/a">协议相对</a><a href="mailto:x@y">邮件</a></body></html>',
    'OPS/style.css': '@import "missing.css"; p{background:url("missing%20image.png")} @font-face{src:url(https://example.test/font.woff2?x=1)}',
    'OPS/orphan.txt': '历史孤儿',
  });
  assert.equal(result.ok, false);
  assert.equal(result.brokenLinks.length, 4);
  assert.deepEqual(result.orphans, ['OPS/orphan.txt']);
  const orphanOnly = await validate(t, { 'OPS/orphan.txt': '历史孤儿' });
  assert.equal(orphanOnly.ok, true);
});
