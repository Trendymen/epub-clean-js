import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildContentOpf } from '../../../books/yimei-seikatsu/migrate/metadata-builder.js';

test('buildContentOpf: basic content + scripted + duokan properties', () => {
  const manifestItems = [
    { id: 'cover-image', href: 'Images/cover.jpg', mediaType: 'image/jpeg', properties: null },
    { id: 'cover', href: 'Text/cover.xhtml', mediaType: 'application/xhtml+xml', properties: 'scripted' },
    { id: 'illus0001', href: 'Text/illus0001.xhtml', mediaType: 'application/xhtml+xml', properties: 'scripted' },
    { id: 'chapter0001', href: 'Text/chapter0001.xhtml', mediaType: 'application/xhtml+xml', properties: null },
  ];
  const spineItems = [
    { idref: 'cover', linear: 'yes', properties: 'duokan-page-fullscreen' },
    { idref: 'illus0001', linear: 'yes', properties: 'duokan-page-fitwindow' },
    { idref: 'chapter0001', linear: 'yes', properties: null },
  ];
  const opf = buildContentOpf({
    title: '义妹生活 09',
    description: '测试简介',
    uuid: '12345-test-uuid',
    modifiedIso: '2026-05-22T00:00:00Z',
    manifestItems,
    spineItems,
  });
  assert.ok(opf.includes('<dc:title>义妹生活 09</dc:title>'));
  assert.ok(opf.includes('测试简介'));
  assert.ok(opf.includes('urn:uuid:12345-test-uuid'));
  assert.ok(opf.includes('id="cover-image"'));
  assert.ok(opf.includes('idref="chapter0001"'));
  assert.ok(
    opf.includes(
      'href="Text/cover.xhtml" media-type="application/xhtml+xml" properties="scripted"',
    ),
  );
  assert.ok(opf.includes('idref="cover"'));
  assert.ok(opf.includes('properties="duokan-page-fullscreen"'));
  assert.ok(opf.includes('idref="illus0001"'));
  assert.ok(opf.includes('properties="duokan-page-fitwindow"'));
  assert.ok(opf.includes('三河ごーすと'));
  // EPUB3 prefix 属性
  assert.ok(opf.includes('prefix="duokan-page:'));
  // 用 meta refines 替代 opf:role
  assert.ok(opf.includes('refines="#creator-aut"'));
});
