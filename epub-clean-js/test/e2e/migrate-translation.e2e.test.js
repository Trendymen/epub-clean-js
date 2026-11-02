import { test } from "node:test";
import assert from "node:assert";
import { readFile, writeFile, rm, mkdtemp, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import opentype from 'opentype.js';
import { parseHTML } from 'linkedom';
import { normalize } from "./_helpers/diff.js";
import { RAW_ROOT, runCli } from "./_helpers/run-cli.js";

const SRC = path.join(RAW_ROOT, "义妹生活 - 09台简粗糙排版.epub");
const DST = path.join(RAW_ROOT, "[三河ごーすと].义妹生活.09.[日翻].epub");
const REF = path.join(RAW_ROOT, "[三河ごーすと].义妹生活.07.[台简].epub");

async function variantEpub(original, output, entryName, mutate) {
  const zip = new AdmZip(original);
  zip.updateFile(entryName, Buffer.from(mutate(zip.getEntry(entryName).getData().toString('utf8'))));
  await writeFile(output, zip.toBuffer());
}

const migrationArgs = (src, dst, out) => ['migrate-translation','--src',src,'--dst',dst,'--ref',REF,'--out',out,'--volume','09','--book','yimei-seikatsu'];

function assertSourceRuby(zip,record) {
  const entry=zip.getEntry(record.source.file);
  assert.ok(entry,`报告路径不是 ZIP 条目: ${record.source.file}`);
  assert.equal(record.source.archive,'DST');
  assert.doesNotMatch(record.source.file,/\\/);
  const {document}=parseHTML(entry.getData().toString('utf8'));
  const paragraphs=[...document.querySelectorAll('p')].filter(p=>{
    if (p.closest('aside')) return false;
    const copy=p.cloneNode(true);
    for (const node of copy.querySelectorAll('rt,rp')) node.remove();
    return copy.textContent.trim();
  });
  const host=paragraphs[record.source.fileParaIndex];
  assert.ok(host,`报告段落不存在: ${record.id}`);
  const copy=host.cloneNode(true);
  for (const node of copy.querySelectorAll('rt,rp')) node.remove();
  assert.equal(copy.textContent.trim(),record.source.paragraph);
  assert.ok([...host.querySelectorAll('ruby')].some(ruby=>{
    const reading=ruby.querySelector('rt').textContent.trim();
    const clone=ruby.cloneNode(true);
    for (const node of clone.querySelectorAll('rt,rp')) node.remove();
    return clone.textContent===record.source.base && reading===record.source.reading;
  }),record.id);
}

function assertNativeRuby(zips,record) {
  const match=/^(SRC|DST)\/(.+):p(\d+):ruby(\d+)$/.exec(record.location);
  assert.ok(match,`原生注音位置格式错误: ${record.location}`);
  const entry=zips[match[1]].getEntry(match[2]);
  assert.ok(entry,`报告路径不是 ZIP 条目: ${record.location}`);
  const {document}=parseHTML(entry.getData().toString('utf8'));
  const host=[...document.querySelectorAll('p')][Number(match[3])-1];
  assert.ok(host,`原生注音段落不存在: ${record.location}`);
  assert.ok([...host.querySelectorAll('ruby')].some(ruby=>{
    const reading=ruby.querySelector('rt').textContent.trim();
    const clone=ruby.cloneNode(true);
    for (const node of clone.querySelectorAll('rt,rp')) node.remove();
    return clone.textContent===record.base && reading===record.reading;
  }),record.location);
}

async function temporaryDir(t,prefix) {
  const root=await realpath(os.tmpdir());
  const dir=await mkdtemp(path.join(root,prefix));
  const created=await realpath(dir);
  t.after(async()=>{
    const resolved=await realpath(dir);
    assert.equal(resolved,created);
    assert.equal(path.dirname(resolved),root);
    await rm(resolved,{recursive:true,force:true});
  });
  return dir;
}

for (const fixture of [
  { label:'SRC .html', source:SRC, opf:'OEBPS/content.opf', href:'Extras/nested%20note.html', entry:'OEBPS/Extras/nested note.html', sourceArg:true },
  { label:'DST .htm', source:DST, opf:'content.opf', href:'Extras/nested/note.htm', entry:'Extras/nested/note.htm', sourceArg:false },
  { label:'SRC .xml', source:SRC, opf:'OEBPS/content.opf', href:'../Extras/note.xml', entry:'Extras/note.xml', sourceArg:true },
]) {
  test(`e2e: manifest 中未使用的 ${fixture.label} 含 ruby 时写入前拒绝`, {timeout:180_000}, async t=>{
    const temp=await temporaryDir(t,'ruby-manifest-');
    const variant=path.join(temp,'variant.epub'), out=path.join(temp,'existing.epub');
    const zip=new AdmZip(fixture.source);
    const opf=zip.readAsText(fixture.opf).replace('</manifest>',`<item id="new-xhtml" href="${fixture.href}" media-type="application/xhtml+xml"/></manifest>`);
    zip.updateFile(fixture.opf,Buffer.from(opf));
    zip.addFile(fixture.entry,Buffer.from(fixture.sourceArg
      ? '<html xmlns="http://www.w3.org/1999/xhtml"><body><h3><ruby>标题<rt>title</rt></ruby></h3></body></html>'
      : '<html xmlns:x="http://www.w3.org/1999/xhtml"><body><aside><x:ruby>注<x:rt>note</x:rt></x:ruby></aside></body></html>'));
    await writeFile(variant,zip.toBuffer());
    await writeFile(out,'previous EPUB');
    await writeFile(`${out}.align_report.md`,'previous report');
    await assert.rejects(runCli(migrationArgs(fixture.sourceArg ? variant : SRC,fixture.sourceArg ? DST : variant,out)),/note\.(?:html?|xml).*ruby/);
    assert.equal(await readFile(out,'utf8'),'previous EPUB');
    assert.equal(await readFile(`${out}.align_report.md`,'utf8'),'previous report');
  });
}

test('e2e: manifest 路径不能越过 EPUB 根目录', {timeout:180_000}, async t=>{
  const temp=await temporaryDir(t,'ruby-manifest-escape-');
  const variant=path.join(temp,'variant.epub'), out=path.join(temp,'existing.epub');
  const zip=new AdmZip(SRC);
  const opf=zip.readAsText('OEBPS/content.opf').replace('</manifest>','<item id="outside" href="../../outside.html" media-type="application/xhtml+xml"/></manifest>');
  zip.updateFile('OEBPS/content.opf',Buffer.from(opf));
  await writeFile(variant,zip.toBuffer());
  await writeFile(out,'previous EPUB');
  await writeFile(`${out}.align_report.md`,'previous report');
  await assert.rejects(runCli(migrationArgs(variant,DST,out)),/escapes archive/);
  assert.equal(await readFile(out,'utf8'),'previous EPUB');
  assert.equal(await readFile(`${out}.align_report.md`,'utf8'),'previous report');
});

test('e2e: 特典普通上标保留 calibre class 和语义标签', {timeout:180_000}, async t=>{
  const temp=await temporaryDir(t,'ruby-plain-sup-');
  const dst=path.join(temp,'dst.epub'), out=path.join(temp,'out.epub');
  const original=new AdmZip(DST);
  const special=original.getEntries().find(entry=>entry.entryName.endsWith('/special0001.xhtml')).entryName;
  await variantEpub(DST,dst,special,html=>html.replace(/(<p\b[^>]*>)/,'$1甲10<sup class="calibre">2</sup>乙'));
  await runCli(migrationArgs(SRC,dst,out));
  const chapter=new AdmZip(out).readAsText('OEBPS/Text/special0001.xhtml');
  assert.match(chapter,/甲10<sup class="calibre">2<\/sup>乙/);
});

test('e2e: 脚注图标外有纯 span 包装时仍保留注释和图标', {timeout:180_000}, async t=>{
  const temp=await temporaryDir(t,'ruby-wrapped-footnote-');
  const dst=path.join(temp,'dst.epub'), out=path.join(temp,'out.epub');
  const original=new AdmZip(DST);
  const special=original.getEntries().find(entry=>entry.entryName.endsWith('/special0001.xhtml')).entryName;
  const input=original.readAsText(special);
  const originalIcon=parseHTML(input).document.querySelector('sup a.duokan-footnote img');
  await variantEpub(DST,dst,special,html=>{
    const wrapped=html.replace(/(<sup\b[^>]*><a\b[^>]*>)(<img\b[^>]*\/>)/,'$1<span class="icon">$2</span>');
    assert.notEqual(wrapped,html);
    return wrapped;
  });
  await runCli(migrationArgs(SRC,dst,out));
  const output=parseHTML(new AdmZip(out).readAsText('OEBPS/Text/special0001.xhtml')).document;
  const icon=output.querySelector('sub a.duokan-footnote img');
  assert.equal(icon.getAttribute('zy-footnote'),originalIcon.getAttribute('zy-footnote'));
  assert.equal(path.posix.basename(icon.getAttribute('src')),path.posix.basename(originalIcon.getAttribute('src')));
  assert.equal(output.querySelectorAll('aside').length,1);
});

test('e2e: 普通链接先于多看脚注时拒绝并保留旧成品', {timeout:180_000}, async t=>{
  const temp=await temporaryDir(t,'ruby-mixed-links-');
  const dst=path.join(temp,'dst.epub'), out=path.join(temp,'existing.epub');
  const entry='Text/chapter0003.xhtml';
  const sample='<p>甲<sup><a href="#other">文字</a><a class="duokan-footnote" href="#n"><img zy-footnote="注" src="note.webp"/></a></sup>乙</p>';
  await variantEpub(DST,dst,entry,html=>html.replace('</body>',`${sample}</body>`));
  await writeFile(out,'previous EPUB');
  await writeFile(`${out}.align_report.md`,'previous report');
  await assert.rejects(runCli(migrationArgs(SRC,dst,out)),/chapter0003\.xhtml.*sup/);
  assert.equal(await readFile(out,'utf8'),'previous EPUB');
  assert.equal(await readFile(`${out}.align_report.md`,'utf8'),'previous report');
});

for (const [name,entry] of [['章节','Text/chapter0003.xhtml'],['特典','Text/special0001.xhtml']]) {
  test(`e2e: ${name}双路径未选中副本有 ruby 时拒绝并保留旧成品`, {timeout:180_000}, async t=>{
    const temp=await temporaryDir(t,'ruby-shadow-copy-');
    const dst=path.join(temp,'dst.epub'), out=path.join(temp,'existing.epub');
    const zip=new AdmZip(DST);
    const source=zip.readAsText(entry);
    zip.addFile(`OEBPS/${entry}`,Buffer.from(source));
    zip.updateFile(entry,Buffer.from(source.replace('</body>','<p><ruby>影<rt>shadow</rt></ruby></p></body>')));
    await writeFile(dst,zip.toBuffer());
    await writeFile(out,'previous EPUB');
    await writeFile(`${out}.align_report.md`,'previous report');
    await assert.rejects(runCli(migrationArgs(SRC,dst,out)),new RegExp(`${entry.replace('.', '\\.')}.*ruby`));
    assert.equal(await readFile(out,'utf8'),'previous EPUB');
    assert.equal(await readFile(`${out}.align_report.md`,'utf8'),'previous report');
  });
}

test('e2e: 双路径时使用优先副本中的章节注音和特典原生注音', {timeout:180_000}, async t=>{
  const temp=await temporaryDir(t,'ruby-preferred-copy-');
  const dst=path.join(temp,'dst.epub'), out=path.join(temp,'out.epub');
  const zip=new AdmZip(DST);
  for (const entry of ['Text/chapter0001_split_000.xhtml','Text/special0001.xhtml']) {
    let selected=zip.readAsText(entry);
    if (entry.includes('special')) selected=selected.replace(/(<p\b[^>]*>)/,'$1<ruby>选<rt>selected</rt></ruby>');
    zip.addFile(`OEBPS/${entry}`,Buffer.from(selected));
    zip.updateFile(entry,Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><body><p>未选中的副本</p></body></html>'));
  }
  await writeFile(dst,zip.toBuffer());
  await runCli(migrationArgs(SRC,dst,out));
  const report=await readFile(`${out}.align_report.md`,'utf8');
  const audit=JSON.parse(report.split('<!-- ruby-audit -->')[1].match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.equal(audit.records.length,15);
  assert.equal(audit.outputCount,13);
  assert.deepEqual(audit.nativeRecords.map(record=>record.reading),['selected']);
  assert.match(audit.nativeRecords[0].location,/^DST\/OEBPS\/Text\/special0001\.xhtml:p1:ruby1$/);
  const selected=audit.records.filter(record=>record.source.file==='OEBPS/Text/chapter0001_split_000.xhtml');
  assert.equal(selected.length,8);
  const inputZip=new AdmZip(dst);
  for (const record of audit.records) assertSourceRuby(inputZip,record);
  assertNativeRuby({SRC:new AdmZip(SRC),DST:inputZip},audit.nativeRecords[0]);
  assert.match(new AdmZip(out).readAsText('OEBPS/Text/special0001.xhtml'),/<ruby>选<rt>selected<\/rt><\/ruby>/);
});

test('e2e: 台简普通上标保留原继承语言', {timeout:180_000}, async t=>{
  const temp=await temporaryDir(t,'ruby-src-sup-');
  const src=path.join(temp,'src.epub'), out=path.join(temp,'out.epub');
  await variantEpub(SRC,src,'OEBPS/Text/chapter1.xhtml',html=>html.replace('庭院','庭院10<sup>2</sup>'));
  await runCli(migrationArgs(src,DST,out));
  const chapter=new AdmZip(out).readAsText('OEBPS/Text/chapter0001.xhtml');
  assert.match(chapter,/庭院10<sup xml:lang="zh-cn">2<\/sup>/);
});

test('e2e: 混合上标、继承语义、IDREF 和外部命名空间在覆盖前拒绝', {timeout:180_000}, async t=>{
  const temp=await temporaryDir(t,'ruby-context-refuse-');
  const out=path.join(temp,'existing.epub');
  const original=new AdmZip(DST);
  const special=original.getEntries().find(entry=>entry.entryName.endsWith('/special0001.xhtml')).entryName;
  const chapter=original.getEntries().find(entry=>entry.entryName.endsWith('/chapter0001_split_000.xhtml')).entryName;
  const cases=[
    {entry:special, html:'<p>甲<sup>2<a class="duokan-footnote" href="#n"><img src="note.webp"/></a></sup>乙</p>', error:/special0001\.xhtml.*sup/},
    {entry:special, html:'<p xml:space="preserve"><ruby>字<rt>じ</rt></ruby></p>', error:/special0001\.xhtml.*ruby/},
    {entry:special, html:'<p><ruby aria-describedby="source-note">字<rt>じ</rt></ruby></p>', error:/special0001\.xhtml.*ruby/},
    {entry:chapter, html:'<p xmlns="urn:foreign"><ruby>字<rt>じ</rt></ruby></p>', error:/chapter0001_split_000\.xhtml.*ruby/},
    {entry:special, html:'<p><ruby xmlns="http://www.w3.org/1999/xhtml">字<rt>じ</rt></ruby></p>', removeRootNamespace:true, error:/special0001\.xhtml.*ruby/},
  ];
  for (const [index,sample] of cases.entries()) {
    const dst=path.join(temp,`dst${index}.epub`);
    await variantEpub(DST,dst,sample.entry,html=>{
      const input=sample.removeRootNamespace ? html.replace(' xmlns="http://www.w3.org/1999/xhtml"','') : html;
      return input.replace('</body>',`${sample.html}</body>`);
    });
    await writeFile(out,'previous EPUB');
    await writeFile(`${out}.align_report.md`,'previous report');
    await assert.rejects(runCli(migrationArgs(SRC,dst,out)),sample.error);
    assert.equal(await readFile(out,'utf8'),'previous EPUB');
    assert.equal(await readFile(`${out}.align_report.md`,'utf8'),'previous report');
  }
});

for (const [name,ruby] of [
  ['本体','<ruby id="note001">字<rt>じ</rt></ruby>'],
  ['后代','<ruby><rb id="note_ref001">字</rb><rt>じ</rt></ruby>'],
]) {
  test(`e2e: 原生 ruby ${name}的 ID 与生成脚注冲突时保留旧成品`, {timeout:180_000}, async t=>{
    const temp=await temporaryDir(t,'ruby-id-conflict-');
    const dst=path.join(temp,'dst.epub'), out=path.join(temp,'existing.epub');
    const original=new AdmZip(DST);
    const special=original.getEntries().find(entry=>entry.entryName.endsWith('/special0001.xhtml')).entryName;
    await variantEpub(DST,dst,special,html=>html.replace(/(<p\b[^>]*>)/,`$1${ruby}`));
    await writeFile(out,'previous EPUB');
    await writeFile(`${out}.align_report.md`,'previous report');
    await assert.rejects(runCli(migrationArgs(SRC,dst,out)),/special0001\.xhtml.*(?:id|ID)/);
    assert.equal(await readFile(out,'utf8'),'previous EPUB');
    assert.equal(await readFile(`${out}.align_report.md`,'utf8'),'previous report');
  });
}

test('e2e: 台简原生 ruby 优先保留且特典 ruby 被保留并审计', {timeout:180_000}, async t => {
  const temp = await temporaryDir(t,'ruby-native-e2e-');
  const src=path.join(temp,'src.epub'), dst=path.join(temp,'dst.epub'), out=path.join(temp,'out.epub');
  await variantEpub(SRC,src,'OEBPS/Text/chapter1.xhtml',html=>html.replace('庭院','<ruby id="native" class="annotation" xml:lang="ja"><rb><a href="https://example.test/?a=1&amp;b=2"><em style="font-style:italic">庭院</em></a></rb><rp>（</rp><rt lang="ja">original</rt><rp>）</rp></ruby>'));
  const originalDst=new AdmZip(DST);
  const special=originalDst.getEntries().find(e=>e.entryName.endsWith('/special0001.xhtml')).entryName;
  await variantEpub(DST,dst,special,html=>html
    .replace(/(<p\b[^>]*>)/,'$1<ruby><rb>特</rb><rp>(</rp><rt>bonus</rt><rp>)</rp></ruby>')
    .replace('<sup', '<sup>2</sup><ruby>邻<rt>adjacent</rt></ruby><sup'));
  await runCli(migrationArgs(src,dst,out));
  const zip=new AdmZip(out);
  const chapter=zip.getEntry('OEBPS/Text/chapter0001.xhtml').getData().toString();
  const original=parseHTML(chapter).document.querySelector('ruby#native');
  assert.equal(original.getAttribute('class'),'annotation');
  assert.equal(original.getAttribute('xml:lang'),'ja');
  assert.equal(original.querySelector('a').getAttribute('href'),'https://example.test/?a=1&b=2');
  assert.equal(original.querySelector('em').getAttribute('style'),'font-style:italic');
  assert.equal(original.querySelector('rt').getAttribute('lang'),'ja');
  assert.deepEqual([...original.querySelectorAll('rp')].map(node=>node.textContent),['（','）']);
  assert.match(chapter,/href="https:\/\/example\.test\/\?a=1&amp;b=2"/);
  assert.doesNotMatch(chapter, /<rt>ていえん<\/rt>/);
  const specialHtml=zip.getEntry('OEBPS/Text/special0001.xhtml').getData().toString();
  assert.match(specialHtml, /<ruby><rb>特<\/rb><rp>\(<\/rp><rt>bonus<\/rt><rp>\)<\/rp><\/ruby>/);
  assert.match(specialHtml, /<sup>2<\/sup><ruby>邻<rt>adjacent<\/rt><\/ruby><sub/);
  const report=await readFile(`${out}.align_report.md`,'utf8');
  const audit=JSON.parse(report.split('<!-- ruby-audit -->')[1].match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.equal(audit.records.find(record=>record.rule==='garden').reason,'native-ruby-overlap');
  assert.deepEqual(audit.nativeRecords.map(record=>record.reading),['original','bonus','adjacent']);
  assert.match(audit.nativeRecords[0].location,/^SRC\/OEBPS\/Text\/chapter1\.xhtml:p\d+:ruby\d+$/);
  for (const record of audit.nativeRecords) assertNativeRuby({SRC:new AdmZip(src),DST:new AdmZip(dst)},record);
  assert.equal(audit.outputCount,14);
});

test('e2e: 不支持的 ruby 在写入前报错且保留旧 EPUB 和审计报告', {timeout:180_000}, async t => {
  const temp=await temporaryDir(t,'ruby-refuse-e2e-');
  const out=path.join(temp,'existing.epub');
  const samples=[
    '<p><ruby><rt>reading</rt></ruby></p>',
    '<p><ruby><rp>(</rp><rt>reading</rt><rp>)</rp></ruby></p><p>后段<sup><a class="duokan-footnote" href="#n"><img zy-footnote="note" src="note.webp"/></a></sup></p><div class="illus"><img src="p.webp"/></div>',
    '<h3><ruby>标题<rt>title</rt></ruby></h3>',
    '<aside><p><ruby>注释<rt>aside</rt></ruby></p></aside>',
    '<div><ruby>非段落<rt>div</rt></ruby></div>',
    '<p><ruby>基<sup><a class="duokan-footnote" href="#n"><img zy-footnote="note" src="note.webp"/></a></sup>字<rt>cross</rt></ruby></p>',
    '<p>甲<rt>乙</rt>丙</p>',
    '<h3><x:ruby xmlns:x="http://www.w3.org/1999/xhtml">标题<x:rt>title</x:rt></x:ruby></h3>',
    '<p><a href="https://example.test/"><ruby>字<rt>じ</rt></ruby></a></p>',
    '<p><ruby><a href="../missing.xhtml">字</a><rt>じ</rt></ruby></p>',
    '<p xml:lang="ja"><ruby>字<rt>じ</rt></ruby></p>',
    '<p><ruby><span/>字<rt>じ</rt></ruby></p>',
    '<p><ruby>字<![CDATA[更多]]><rt>じ</rt></ruby></p>',
  ];
  for (const [index,sample] of samples.entries()) {
    const dst=path.join(temp,`dst${index}.epub`);
    const originalDst=new AdmZip(DST);
    const file=originalDst.getEntries().find(e=>e.entryName.endsWith('/special0001.xhtml')).entryName;
    await variantEpub(DST,dst,file,html=>html.replace('</body>',`${sample}</body>`));
    await writeFile(out,'previous EPUB');
    await writeFile(`${out}.align_report.md`,'previous report');
    await assert.rejects(runCli(migrationArgs(SRC,dst,out)), /special0001.xhtml.*ruby/);
    assert.equal(await readFile(out,'utf8'),'previous EPUB');
    assert.equal(await readFile(`${out}.align_report.md`,'utf8'),'previous report');
  }
});

test("e2e: migrate-translation 恢复 12 处 ruby、审计全部来源并保留其余 golden 内容", { timeout: 180_000 }, async (t) => {
  const temp = await temporaryDir(t,'yimei09-manifest-e2e-');
  const out = path.join(temp, 'output.epub');
  // 1. 跑 CLI
  await runCli(
    [
      "migrate-translation",
      "--src",
      SRC,
      "--dst",
      DST,
      "--ref",
      REF,
      "--out",
      out,
      "--volume",
      "09",
      "--book",
      "yimei-seikatsu",
    ],
  );

  // 2. 用独立 ZIP 实现读取输出。
  const zip = new AdmZip(out);
  const documents = zip.getEntries().filter(entry => /^OEBPS\/Text\/.*\.xhtml$/.test(entry.entryName));
  const bodyParagraphCount = documents.filter(entry => /\/(?:chapter\d+|pre)\.xhtml$/.test(entry.entryName)).reduce((count, entry) => {
    const { document } = parseHTML(entry.getData().toString('utf8'));
    return count + [...document.querySelectorAll('p')].filter(p => !p.closest('aside') && p.textContent.trim()).length;
  }, 0);
  assert.equal(bodyParagraphCount,3850);
  assert.equal(documents.reduce((count, entry) => count + parseHTML(entry.getData().toString('utf8')).document.querySelectorAll('aside').length,0),11);
  const specials=documents.filter(entry => /\/special000[1-3]\.xhtml$/.test(entry.entryName));
  assert.equal(specials.length,3);
  assert.equal(specials.reduce((count,entry) => count + [...parseHTML(entry.getData().toString('utf8')).document.querySelectorAll('p')]
    .filter(p => !p.closest('aside') && p.textContent.trim()).length,0),131);
  const images=zip.getEntries().filter(entry => /^OEBPS\/Images\/[^/]+$/.test(entry.entryName));
  assert.equal(images.length,24);
  assert.equal(images.filter(entry => /\/p\d+\.webp$/.test(entry.entryName)).length,10);
  const expectedRuby = {
    'chapter0001': [['你','あなた（anata）'],['你','あなた（anata）'],['庭院','ていえん'],['小园','こぞの'],['我','おれ／わたし'],['小园','こぞの'],['不伦特辑','劈腿特辑']],
    'chapter0002': [['不伦','ふりん'],['小园','こぞの']],
    'chapter0004': [['耍','捉弄']],
    'chapter0011': [['打击区','BATTERS BOX'],['二垒安打','two-base hit']],
  };
  const targetParagraphs = { chapter0001: [126,127,191,192,198,448,506], chapter0002: [79,106], chapter0004: [224], chapter0011: [244,374] };
  for (const [chapter, expected] of Object.entries(expectedRuby)) {
    const html = zip.getEntry(`OEBPS/Text/${chapter}.xhtml`).getData().toString('utf8');
    assert.deepEqual([...html.matchAll(/<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/g)].map(m => [m[1],m[2]]), expected, chapter);
    const { document } = parseHTML(html);
    const paragraphs = [...document.querySelectorAll('p')].filter(p => !p.closest('aside') && p.textContent.trim());
    assert.deepEqual(paragraphs.flatMap((p,index) => p.querySelector('ruby') ? [index + 1] : []), targetParagraphs[chapter], `${chapter} paragraph anchors`);
  }
  const report = await readFile(`${out}.align_report.md`, 'utf8');
  const rubyAudit = JSON.parse(report.split('<!-- ruby-audit -->')[1].match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.equal(rubyAudit.records.length, 15);
  assert.equal(rubyAudit.outputCount, 12);
  assert.deepEqual(rubyAudit.diagnostics, []);
  assert.deepEqual(rubyAudit.records.filter(r => r.status === 'merged').map(r => [r.rule,r.source.base,r.source.reading]), [
    ['kozono-merged','小园','こぞの'],['kozono-merged','小园','こぞの'],
    ['pronouns-merged','我','おれ'],['pronouns-merged','我','わたし'],
  ]);
  const unresolved = rubyAudit.records.filter(r => r.status === 'unresolved');
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].rule, 'pronoun-omitted');
  assert.match(unresolved[0].reason, /省略/);
  assert.equal(unresolved[0].target, null);
  const sourceZip = new AdmZip(DST);
  assert.equal(sourceZip.getEntries().filter(e => /\.xhtml$/.test(e.entryName)).reduce((total, e) => total + [...parseHTML(e.getData().toString()).document.querySelectorAll('ruby')].length, 0), 15);
  assert.ok(rubyAudit.records.some(record=>record.source.file==='Text/chapter0001_split_000.xhtml'));
  for (const record of rubyAudit.records) assertSourceRuby(sourceZip,record);
  const fontCoverage = {
    'SourceHanSansSC-Regular': { source: 'source-han-sans-sc/SourceHanSansSC-Regular.otf', chars: new Set(), selectors: null },
    'SourceHanSerifSC-Light': { source: 'source-han-serif-sc/SourceHanSerifSC-Light.otf', chars: new Set(), selectors: '.ctt,.ctt2,.ctit' },
    'SourceHanSerifSC-Medium': { source: 'source-han-serif-sc/SourceHanSerifSC-Medium.otf', chars: new Set(), selectors: '.note,.duokan-footnote-item' },
    'SourceHanSerifSC-SemiBold': { source: 'source-han-serif-sc/SourceHanSerifSC-SemiBold.otf', chars: new Set(), selectors: '.ctt1,.toc' },
    'SourceHanSerifSC-Bold': { source: 'source-han-serif-sc/SourceHanSerifSC-Bold.otf', chars: new Set(), selectors: 'h3,h4,.cut,.ch1,.ch2' },
    'SourceHanSerifSC-BoldSub': { source: 'source-han-serif-sc/SourceHanSerifSC-Bold.otf', chars: new Set(), selectors: 'h5,.ch3' },
  };
  for (const entry of zip.getEntries().filter(entry => /^OEBPS\/Text\/.*\.xhtml$/.test(entry.entryName))) {
    const { document } = parseHTML(entry.getData().toString('utf8'));
    for (const node of document.querySelectorAll('style,script')) node.remove();
    const allText = document.documentElement.textContent;
    for (const [name, coverage] of Object.entries(fontCoverage)) {
      let text = coverage.selectors ? [...document.querySelectorAll(coverage.selectors)].map(node => node.textContent).join('') : allText;
      if (/SourceHanSerifSC-(?:Light|SemiBold)$/.test(name) && /\/(?:TOC|navigation-documents)\.xhtml$/.test(entry.entryName)) text += allText;
      for (const char of text) if (char.codePointAt(0) >= 0x20) coverage.chars.add(char);
      for (const char of allText) if (char.codePointAt(0) >= 0x20 && !/\p{Script=Han}/u.test(char)) coverage.chars.add(char);
    }
  }

  // 3. 读 golden manifest
  const manifest = JSON.parse(
    await readFile(
      new URL("../fixtures/yimei09/golden-manifest.json", import.meta.url),
      "utf8",
    ),
  );

  // 4. 逐文件比对
  const mismatches = [];
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const entry = zip.getEntry(rel);
    if (!entry) {
      mismatches.push({ rel, reason: "missing" });
      continue;
    }
    if (/^OEBPS\/Fonts\/SourceHan.*\.subset\.otf$/.test(rel)) {
      const data = entry.getData();
      const font = opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      const coverage = fontCoverage[path.posix.basename(rel).replace('.subset.otf', '')];
      const sourceData = await readFile(new URL(`../../books/${coverage.source}`, import.meta.url));
      const sourceFont = opentype.parse(sourceData.buffer.slice(sourceData.byteOffset, sourceData.byteOffset + sourceData.byteLength));
      for (const char of coverage.chars) {
        if (sourceFont.charToGlyphIndex(char) !== 0) assert.notEqual(font.charToGlyphIndex(char), 0, `${rel}: ${char}`);
      }
      continue;
    }
    let data = entry.getData();
    if (/OEBPS\/Text\/chapter(?:0001|0002|0004|0011)\.xhtml$/.test(rel)) {
      data = Buffer.from(data.toString('utf8').replace(/<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/g,
        (_, base, reading) => reading === 'あなた（anata）' ? `${base}（anata）` : base));
    }
    const actual = createHash("sha256")
      .update(normalize(data, path.posix.extname(rel)))
      .digest("hex");
    if (actual !== expected.sha256_normalized) {
      mismatches.push({
        rel,
        reason: "hash_diff",
        expected: expected.sha256_normalized,
        actual,
      });
    }
  }

  if (mismatches.length > 0) {
    console.error("Mismatches:");
    for (const m of mismatches.slice(0, 15)) console.error(` ${m.rel}: ${m.reason}`);
    console.error(`Total ${mismatches.length} / ${Object.keys(manifest.files).length}`);
  }
  assert.strictEqual(
    mismatches.length,
    0,
    `${mismatches.length} files differ from golden manifest`,
  );
});
