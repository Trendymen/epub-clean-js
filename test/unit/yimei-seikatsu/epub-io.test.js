import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';

import { packEpub } from '../../../books/yimei-seikatsu/migrate/epub-io.js';

test('packEpub: mimetype is first entry and STORED', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'yimei-epubio-'));
  try {
    const srcDir = join(tmp, 'src');
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, 'mimetype'), 'application/epub+zip', 'utf-8');
    await mkdir(join(srcDir, 'META-INF'), { recursive: true });
    await writeFile(join(srcDir, 'META-INF/container.xml'), '<container/>', 'utf-8');

    const out = join(tmp, 'test.epub');
    await packEpub(srcDir, out);

    const zip = new AdmZip(out);
    const entries = zip.getEntries();
    assert.equal(entries[0].entryName, 'mimetype', 'mimetype 必须是第一个 entry');
    // STORED = method 0, DEFLATED = method 8（zip spec）
    assert.equal(entries[0].header.method, 0, 'mimetype 必须 STORED 无压缩');
    const container = entries.find((e) => e.entryName === 'META-INF/container.xml');
    assert.ok(container, 'container.xml 应该存在');
    assert.equal(container.header.method, 8, '其他文件应 DEFLATED');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
