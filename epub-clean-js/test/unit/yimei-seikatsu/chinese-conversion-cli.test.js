import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildLightNovelEpub } from '../../../books/yimei-seikatsu/lightnovel-html/index.js';
import { buildHyreadToSimple } from '../../../src/entries/hyread-to-simple.js';
import { runBatch } from '../../../src/entries/lightnovel-html-simple-batch.js';
import { readEpub, writeEpub } from '../../../src/core/zip-io.js';
import { writeHyreadFixture, bodyParagraph } from '../../helpers/hyread-fixture.js';

const cli = fileURLToPath(new URL('../../../bin/cli.js', import.meta.url));
const project = fileURLToPath(new URL('../../../', import.meta.url));
const htmlFor = (body = '正文使用智慧型手機') => `<html><body><article>
<p>義妹生活 11[台繁]</p><img src="https://example.test/cover.jpg"/>
<p>CONTENTS</p><p><b>智慧型手機</b></p><p>题记。</p><p><b>智慧型手機</b></p><p>${body}</p>
</article></body></html>`;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'yimei-wording-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'output/hyread'), { recursive: true });
  await mkdir(join(root, 'output/healed'), { recursive: true });
  const ref = join(root, '[三河ごーすと].义妹生活.07.[台简].epub');
  const source = join(root, 'output/hyread/[三河ごーすと].义妹生活.11.[台繁].hyread.epub');
  const style = join(root, 'output/healed/[三河ごーすと].义妹生活.11.[日翻].healed.epub');
  const html = join(root, '11.html');
  await writeEpub(ref, { 'OEBPS/Styles/stylesheet.css': '', 'OEBPS/Misc/script.js': '' });
  await writeEpub(style, {});
  await writeHyreadFixture(source, {
    pages: { 'p-cover.xhtml': '<img src="../image/cover.jpg"/>', 'p-002.xhtml': bodyParagraph('正文使用智慧型手機') },
    toc: [['p-002.xhtml', '智慧型手機']], spine: ['p-cover.xhtml', 'p-002.xhtml'],
  });
  await writeFile(html, htmlFor(), 'utf8');
  return { root, ref, source, style, html };
}

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: project, encoding: 'utf8', timeout: 30000 });
}

async function assertBookWording(file, expected) {
  const epub = await readEpub(file);
  const chapter = epub.entries['OEBPS/Text/chapter0001.xhtml'].toString('utf8');
  const toc = epub.entries['OEBPS/Text/TOC.xhtml'].toString('utf8');
  assert.ok(chapter.includes(`<h3>${expected}</h3>`), chapter);
  assert.ok(chapter.includes(`<p>正文使用${expected}</p>`), chapter);
  assert.ok(toc.includes(expected), toc);
}

test('programmatic builders and batch pass default and mainland wording to body and TOC', async (t) => {
  const f = await fixture(t);
  for (const [wording, expected] of [[undefined, '智慧型手机'], ['taiwan', '智慧型手机'], ['mainland', '智能手机']]) {
    const hyreadOut = join(f.root, `api-hyread-${wording ?? 'default'}.epub`);
    await buildHyreadToSimple({ sourceEpubPath: f.source, refEpubPath: f.ref, outEpubPath: hyreadOut, volume: '14', includeSpecials: false, wording });
    await assertBookWording(hyreadOut, expected);
    const htmlOut = join(f.root, `api-html-${wording ?? 'default'}.epub`);
    await buildLightNovelEpub({ htmlPath: f.html, refEpubPath: f.ref, sourceImageEpubPath: f.source, outEpubPath: htmlOut, volume: '11', includeSpecials: false, wording });
    await assertBookWording(htmlOut, expected);
    const batchOut = join(f.root, `api-batch-${wording ?? 'default'}`);
    const events = [];
    await runBatch({ root: f.root, outDir: batchOut, volumes: ['11'], backup: false, wording, onDiagnostic: (event) => events.push(event) });
    await assertBookWording(join(batchOut, '[三河ごーすと].义妹生活.11.[台简].epub'), expected);
    assert.equal(events.filter((event) => event.kind === 'ruby-annotation-count').length, 0);
  }
});

test('three CLI commands pass default and mainland wording to body and TOC', async (t) => {
  const f = await fixture(t);
  for (const [wording, expected] of [['taiwan', '智慧型手机'], ['mainland', '智能手机']]) {
    const flag = wording === 'taiwan' ? [] : ['--wording', wording];
    const hyreadOut = join(f.root, `cli-hyread-${wording}.epub`);
    const htmlOut = join(f.root, `cli-html-${wording}.epub`);
    const batchOut = join(f.root, `cli-batch-${wording}`);
    const commands = [
      ['hyread-to-simple', '--source', f.source, '--ref', f.ref, '--volume', '14', '--out', hyreadOut, '--no-include-specials', ...flag],
      ['lightnovel-html-to-epub', '--html', f.html, '--ref', f.ref, '--source-images', f.source, '--volume', '11', '--out', htmlOut, '--skip-specials', ...flag],
      ['build-yimei-simple', '--root', f.root, '--out-dir', batchOut, '--volumes', '11', '--skip-backup', ...flag],
    ];
    for (const args of commands) {
      const result = runCli(args);
      assert.equal(result.status, 0, result.stderr);
    }
    for (const output of [hyreadOut, htmlOut, join(batchOut, '[三河ごーすと].义妹生活.11.[台简].epub')]) await assertBookWording(output, expected);
  }
});

test('batch HyRead builds preserve ruby diagnostics and treat volume rules as built-in', async (t) => {
  const f = await fixture(t);
  await rm(f.html);
  await writeHyreadFixture(f.source, {
    pages: { 'p-002.xhtml': bodyParagraph('<ruby>智慧型<rt>Smart</rt></ruby>手機和智慧型手機') },
    toc: [['p-002.xhtml', '第一章']],
  });
  await writeFile(join(f.root, 'output/hyread/[三河ごーすと].义妹生活.13.[台繁].hyread.epub'), await readFile(f.source));
  await writeEpub(join(f.root, 'output/healed/[三河ごーすと].义妹生活.13.[日翻].healed.epub'), {});
  const outDir = join(f.root, 'hyread-batch');
  const events = [];
  await runBatch({ root: f.root, outDir, volumes: ['11', '13'], backup: false, wording: 'mainland', onDiagnostic: (event) => events.push(event) });
  for (const volume of ['11', '13']) {
    const epub = await readEpub(join(outDir, `[三河ごーすと].义妹生活.${volume}.[台简].epub`));
    const chapter = epub.entries['OEBPS/Text/chapter0001.xhtml'].toString('utf8');
    assert.match(chapter, /<ruby>智慧型<rt>Smart<\/rt><\/ruby>手机和智能手机/);
    assert.ok(events.some((event) => event.volume === volume && event.ruleId === 'smartphone' && event.source === 'item/xhtml/p-002.xhtml'));
  }
  assert.equal(events.filter((event) => event.kind === 'ruby-annotation-count').length, 0);
  const apiEvents = [];
  await buildHyreadToSimple({
    sourceEpubPath: f.source, refEpubPath: f.ref, outEpubPath: join(f.root, 'hyread-api-diag.epub'),
    volume: '14', wording: 'mainland', includeSpecials: false, onDiagnostic: (event) => apiEvents.push(event),
  });
  assert.deepEqual(apiEvents.find((event) => event.kind === 'text'), {
    volume: '14', source: 'item/xhtml/p-002.xhtml', paragraphIndex: 1,
    ruleId: 'smartphone', kind: 'text', start: 0, end: 5,
  });
  const result = runCli(['hyread-to-simple', '--source', f.source, '--ref', f.ref, '--volume', '14', '--out', join(f.root, 'hyread-diag.epub'), '--wording', 'mainland']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /item\/xhtml\/p-002.xhtml/);
  assert.match(result.stdout, /smartphone/);
  assert.match(result.stdout, /\[0,\s*5\)/);
});

test('another-days entry passes mainland wording and diagnostics through its parser', async (t) => {
  const f = await fixture(t);
  await writeHyreadFixture(f.source, {
    pages: { 'p-002.xhtml': bodyParagraph('<ruby>智慧型<rt>Smart</rt></ruby>手機和智慧型手機') },
    toc: [['p-002.xhtml', '第一章']],
  });
  const events = [];
  const out = join(f.root, 'another-days.epub');
  await buildHyreadToSimple({
    sourceEpubPath: f.source, refEpubPath: f.ref, outEpubPath: out, volume: 'another-days',
    wording: 'mainland', includeSpecials: false, onDiagnostic: (event) => events.push(event),
  });
  const epub = await readEpub(out);
  const chapter = epub.entries['OEBPS/Text/chapter0001.xhtml'].toString('utf8');
  assert.match(chapter, /<ruby>智慧型<rt>Smart<\/rt><\/ruby>手机和智能手机/);
  assert.deepEqual(events.find((event) => event.kind === 'text'), {
    volume: 'another-days', source: 'item/xhtml/p-002.xhtml', paragraphIndex: 1,
    ruleId: 'smartphone', kind: 'text', start: 0, end: 5,
  });
});

test('invalid wording fails before outputs or backups for API and CLI, including both batch paths', async (t) => {
  const f = await fixture(t);
  const existingDir = join(f.root, 'existing');
  await mkdir(existingDir);
  const existing = join(existingDir, '[三河ごーすと].义妹生活.11.[台简].epub');
  await writeFile(existing, 'unchanged');
  for (const hasHtml of [true, false]) {
    if (!hasHtml) await rm(f.html);
    await assert.rejects(runBatch({ root: f.root, outDir: existingDir, volumes: ['11'], wording: 'invalid' }), /Invalid wording.*invalid/);
    assert.deepEqual(await readdir(existingDir), ['[三河ごーすと].义妹生活.11.[台简].epub']);
    assert.equal(await readFile(existing, 'utf8'), 'unchanged');
    const cliResult = runCli(['build-yimei-simple', '--root', f.root, '--out-dir', existingDir, '--volumes', '11', '--wording', 'invalid']);
    assert.notEqual(cliResult.status, 0);
    assert.match(cliResult.stderr, /Invalid wording.*invalid/);
    assert.deepEqual(await readdir(existingDir), ['[三河ごーすと].义妹生活.11.[台简].epub']);
    assert.equal(await readFile(existing, 'utf8'), 'unchanged');
    const absentApi = join(f.root, `absent-api-${hasHtml}`);
    await assert.rejects(runBatch({ root: f.root, outDir: absentApi, volumes: ['11'], wording: 'invalid' }), /Invalid wording.*invalid/);
    await assert.rejects(stat(absentApi), { code: 'ENOENT' });
    const absentCli = join(f.root, `absent-cli-${hasHtml}`);
    const absentResult = runCli(['build-yimei-simple', '--root', f.root, '--out-dir', absentCli, '--volumes', '11', '--wording', 'invalid']);
    assert.notEqual(absentResult.status, 0);
    assert.match(absentResult.stderr, /Invalid wording.*invalid/);
    await assert.rejects(stat(absentCli), { code: 'ENOENT' });
  }
  await writeFile(f.html, htmlFor(), 'utf8');
  for (const build of [
    (out) => buildHyreadToSimple({ sourceEpubPath: f.source, refEpubPath: f.ref, outEpubPath: out, volume: '14', wording: 'invalid' }),
    (out) => buildLightNovelEpub({ htmlPath: f.html, refEpubPath: f.ref, sourceImageEpubPath: f.source, outEpubPath: out, wording: 'invalid' }),
  ]) {
    const out = join(f.root, 'api-no-output', 'book.epub');
    await assert.rejects(build(out), /Invalid wording.*invalid/);
    await assert.rejects(stat(join(f.root, 'api-no-output')), { code: 'ENOENT' });
    await assert.rejects(build(existing), /Invalid wording.*invalid/);
    assert.equal(await readFile(existing, 'utf8'), 'unchanged');
  }
  const commands = [
    (out) => ['hyread-to-simple', '--source', f.source, '--ref', f.ref, '--volume', '14', '--out', out, '--wording', 'invalid'],
    (out) => ['lightnovel-html-to-epub', '--html', f.html, '--ref', f.ref, '--source-images', f.source, '--out', out, '--wording', 'invalid'],
    (out) => ['build-yimei-simple', '--root', f.root, '--out-dir', out, '--volumes', '11', '--wording', 'invalid'],
  ];
  for (const [index, command] of commands.entries()) {
    const absent = join(f.root, `cli-absent-${index}`);
    const result = runCli(command(index === 2 ? absent : join(absent, 'book.epub')));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid wording.*invalid/);
    await assert.rejects(stat(absent), { code: 'ENOENT' });
    const existingResult = runCli(command(index === 2 ? existingDir : existing));
    assert.notEqual(existingResult.status, 0);
    assert.match(existingResult.stderr, /Invalid wording.*invalid/);
    assert.equal(await readFile(existing, 'utf8'), 'unchanged');
    assert.deepEqual(await readdir(existingDir), ['[三河ごーすと].义妹生活.11.[台简].epub']);
  }
});

test('HTML CLI and callback report source location and explicit ruby count', async (t) => {
  const f = await fixture(t);
  await writeFile(f.html, htmlFor('智慧型手機Smartphone'), 'utf8');
  const annotation = { text: '智慧型手机Smartphone', base: '智慧型手机', ruby: 'Smartphone' };
  const events = [];
  await buildLightNovelEpub({
    htmlPath: f.html, refEpubPath: f.ref, sourceImageEpubPath: f.source, outEpubPath: join(f.root, 'api-diag.epub'),
    volume: '11', wording: 'mainland', includeSpecials: false, rubyAnnotations: [annotation], onDiagnostic: (event) => events.push(event),
  });
  assert.deepEqual(events.find((event) => event.kind === 'text'), {
    volume: '11', source: f.html, paragraphIndex: 6, ruleId: 'smartphone', kind: 'text', start: 0, end: 5,
  });
  assert.equal(events.find((event) => event.kind === 'ruby-annotation-count').count, 1);
  const result = runCli(['lightnovel-html-to-epub', '--html', f.html, '--ref', f.ref, '--source-images', f.source,
    '--out', join(f.root, 'cli-diag.epub'), '--wording', 'mainland', '--ruby', '智慧型手机Smartphone|智慧型手机|Smartphone',
    '--ruby', '擡头|擡头|tou']);
  assert.equal(result.status, 0, result.stderr);
  const skip = result.stdout.split('\n').find((line) => line.includes('smartphone'));
  assert.ok(skip?.includes(f.html), result.stdout);
  assert.match(skip, /，段落 6，区间 \[0, 5\)/);
  assert.match(result.stdout, /手工注音规则 1：1 次/);
  assert.match(result.stdout, /规则 2：0 次；请检查匹配文本/);
});
