import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractInlineImages } from '../../../books/yimei-seikatsu/migrate/inline-image-extractor.js';

async function withTmpXhtml(content, fn) {
  const tmp = await mkdtemp(join(tmpdir(), 'yimei-inline-'));
  try {
    const p = join(tmp, 'ch.xhtml');
    await writeFile(p, content, 'utf-8');
    return await fn(p);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

test('extractInlineImages: image after para 2', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'yimei-inline-'));
  try {
    const p = join(tmp, 'ch.xhtml');
    await writeFile(
      p,
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body>
  <p class="calibre22">第一段。</p>
  <p class="calibre22">第二段。</p>
  <div class="illus" id="calibre_pb_0">
    <img alt="p039" src="../Images/p039.webp" zy-enlarge-src="self" class="calibre19"/>
  </div>
  <p class="calibre22">第三段。</p>
</body></html>`,
      'utf-8',
    );
    const images = extractInlineImages(p);
    assert.equal(images.length, 1);
    const img = images[0];
    assert.equal(img.alt, 'p039');
    assert.equal(img.srcFilename, 'p039.webp');
    assert.equal(img.afterParaIndex, 1);
    assert.ok(img.steraHtml.includes('class="illus duokan-image-single"'));
    assert.ok(img.steraHtml.includes('zy-enlarge-src="self"'));
    assert.ok(img.steraHtml.includes('src="../Images/p039.webp"'));
    assert.ok(!img.steraHtml.includes('calibre'));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('extractInlineImages: skip kuchie', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'yimei-inline2-'));
  try {
    const p = join(tmp, 'ch.xhtml');
    await writeFile(
      p,
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body>
  <p>段一</p>
  <div class="illus">
    <img alt="kuchie-001" src="../Images/kuchie-001.webp"/>
  </div>
</body></html>`,
      'utf-8',
    );
    const images = extractInlineImages(p);
    assert.equal(images.length, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---- class 匹配方式：子串匹配（与 Python `"illus" in cls` 等价） ----

test('extractInlineImages: class="illus" 单 token 命中', async () => {
  await withTmpXhtml(
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body>
  <p>段一</p>
  <div class="illus"><img alt="a" src="../Images/a.webp"/></div>
</body></html>`,
    async (p) => {
      const images = extractInlineImages(p);
      assert.equal(images.length, 1);
      assert.equal(images[0].srcFilename, 'a.webp');
    },
  );
});

test('extractInlineImages: class="illus duokan-image-single" 多 token 命中', async () => {
  await withTmpXhtml(
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body>
  <p>段一</p>
  <div class="illus duokan-image-single"><img alt="b" src="../Images/b.webp"/></div>
</body></html>`,
    async (p) => {
      const images = extractInlineImages(p);
      assert.equal(images.length, 1);
      assert.equal(images[0].srcFilename, 'b.webp');
    },
  );
});

test('extractInlineImages: class="illus-large" 子串命中（新增逻辑）', async () => {
  await withTmpXhtml(
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body>
  <p>段一</p>
  <div class="illus-large"><img alt="c" src="../Images/c.webp"/></div>
</body></html>`,
    async (p) => {
      const images = extractInlineImages(p);
      assert.equal(images.length, 1);
      assert.equal(images[0].srcFilename, 'c.webp');
    },
  );
});

test('extractInlineImages: class="my-illus" 子串命中（新增逻辑）', async () => {
  await withTmpXhtml(
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body>
  <p>段一</p>
  <div class="my-illus"><img alt="d" src="../Images/d.webp"/></div>
</body></html>`,
    async (p) => {
      const images = extractInlineImages(p);
      assert.equal(images.length, 1);
      assert.equal(images[0].srcFilename, 'd.webp');
    },
  );
});

test('extractInlineImages: class="illustration" 子串命中（Python 等价行为）', async () => {
  // Python 用 `"illus" in cls`，会命中 illustration（contains "illus"），
  // 所以 Node 也要命中以保持等价。
  await withTmpXhtml(
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body>
  <p>段一</p>
  <div class="illustration"><img alt="e" src="../Images/e.webp"/></div>
</body></html>`,
    async (p) => {
      const images = extractInlineImages(p);
      assert.equal(images.length, 1);
      assert.equal(images[0].srcFilename, 'e.webp');
    },
  );
});
