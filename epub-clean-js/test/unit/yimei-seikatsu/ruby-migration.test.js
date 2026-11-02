import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as extractor from '../../../books/yimei-seikatsu/migrate/paragraph-extractor.js';

// 去掉 rt/rp 后的偏移必须与对齐使用的正文相同。
test('ruby 抽取保留重复基字的独立位置，支持 rb/rp 并报告多个或空 rt', () => {
  assert.equal(typeof extractor.extractParagraphData, 'function');
  const data = extractor.extractParagraphData('<p> 前<ruby><rb>小园</rb><rp>（</rp><rt>こぞの</rt><rp>）</rp></ruby>和<ruby>小园<rt>別読</rt></ruby>。</p><aside><p><ruby>注<rt>除外</rt></ruby></p></aside><p><ruby>甲<rt>a</rt><rt>b</rt></ruby><ruby>乙<rt> </rt></ruby></p>');
  assert.deepEqual(data.paragraphs, ['前小园和小园。', '甲乙']);
  assert.deepEqual(data.rubies.map(r => [r.paraIndex, r.start, r.base, r.reading, r.issue]), [[0,1,'小园','こぞの',null],[0,4,'小园','別読',null],[1,0,'甲','a／b','multiple-rt'],[1,1,'乙','','empty-reading']]);
});

import * as migration from '../../../books/yimei-seikatsu/migrate/ruby-migration.js';
const source = (base, reading, paraIndex = 0) => ({ paraIndex, start: 0, base, reading, issue: null });
const rule = { id: 'one', sources: [{ anchor: '原小园。', base: '小园', reading: 'こぞの' }], target: { anchor: '小园和小园。', text: '和小园', base: '和小园' } };

test('ruby 迁移按源和目标段落锚定，不能替换同段第一个重复词', () => {
  assert.equal(typeof migration.planRubyMigration, 'function');
  const result = migration.planRubyMigration({ chapter: 'chapter0001', sourceParagraphs: ['原小园。'], rubies: [source('小园','こぞの')], targetParagraphs: ['小园和小园。'], rules: [rule] });
  assert.equal(result.records[0].status, 'applied');
  assert.deepEqual(result.annotations.map(r => [r.paraIndex,r.start,r.end,r.base,r.reading]), [[0,2,5,'和小园','こぞの']]);
});

test('多个来源只能在全数实际匹配时合并，平铺罗马字移入 rt', () => {
  assert.equal(typeof migration.planRubyMigration, 'function');
  const rules = [{ id:'merge', sources:[{anchor:'我与我',base:'我',reading:'おれ'},{anchor:'我与我',base:'我',reading:'わたし'}], target:{anchor:'交给我。',text:'我'} }, {id:'roman',sources:[{anchor:'你',base:'你',reading:'あなた'}],target:{anchor:'你（anata）',text:'你（anata）',base:'你',readingSuffix:'（anata）'}}];
  const result = migration.planRubyMigration({chapter:'chapter0001', sourceParagraphs:['我与我','你'], rubies:[source('我','おれ'),source('我','わたし'),source('你','あなた',1)], targetParagraphs:['交给我。','你（anata）'],rules});
  assert.deepEqual(result.records.map(r=>r.status), ['merged','merged','applied']);
  assert.deepEqual(result.annotations.map(r=>r.reading), ['おれ／わたし','あなた（anata）']);
});

test('未知来源、重复锚点、重复目标词、缺失来源和无安全基字均留下诊断', () => {
  assert.equal(typeof migration.planRubyMigration, 'function');
  for (const targetParagraphs of [['小园和小园。','小园和小园。'],['变了']]) {
    const result = migration.planRubyMigration({chapter:'c',sourceParagraphs:['原小园。'],rubies:[source('小园','こぞの')],targetParagraphs,rules:[rule]});
    assert.equal(result.annotations.length,0);
    assert.equal(result.records[0].status,'unresolved');
  }
  const duplicate = migration.planRubyMigration({chapter:'c',sourceParagraphs:['原小园。'],rubies:[source('小园','こぞの')],targetParagraphs:['小园和小园。'],rules:[{...rule,target:{anchor:'小园和小园。',text:'小园'}}]});
  assert.match(duplicate.records[0].reason,/target-text/);
  const unknown = migration.planRubyMigration({chapter:'c',sourceParagraphs:['原小园。'],rubies:[source('小园','別読')],targetParagraphs:['小园和小园。'],rules:[rule]});
  assert.equal(unknown.records[0].reason,'unmapped-source');
  assert.equal(unknown.diagnostics.length,1);
  const missing = migration.planRubyMigration({chapter:'c',sourceParagraphs:[],rubies:[],targetParagraphs:[],rules:[rule]});
  assert.equal(missing.records.length,0);
  assert.equal(missing.diagnostics.length,1);
  const omitted = migration.planRubyMigration({chapter:'c',sourceParagraphs:['原小园。'],rubies:[source('小园','こぞの')],targetParagraphs:[],rules:[{...rule,target:null,reason:'译文省略基字'}]});
  assert.equal(omitted.records[0].reason,'译文省略基字');
});

test('渲染使用原文偏移处理脚注并转义正文、base 和 rt，跨脚注不误包裹', () => {
  assert.equal(typeof migration.renderAnnotatedParagraph,'function');
  const annotation = {id:'a',start:1,end:4,base:'<&>',reading:'a&<b'};
  const result = migration.renderAnnotatedParagraph('前<&>后',[annotation],[{offset:4,html:'<sup>注</sup>'}]);
  assert.equal(result.html,'前<ruby>&lt;&amp;&gt;<rt>a&amp;&lt;b</rt></ruby><sup>注</sup>后');
  assert.deepEqual(result.rejected,[]);
  const cross = migration.renderAnnotatedParagraph('前<&>后',[annotation],[{offset:2,html:'<sup>注</sup>'}]);
  assert.equal(cross.html,'前&lt;<sup>注</sup>&amp;&gt;后');
  assert.deepEqual(cross.rejected,['a']);
});

test('缺少合并来源或源段落不唯一时，不生成半个合并结果', () => {
  const first = {anchor:'我与我',base:'我',reading:'おれ'};
  const second = {anchor:'我与我',base:'我',reading:'わたし'};
  const merge = {id:'merge',sources:[first,second],target:{anchor:'交给我。',text:'我'}};
  for(const sourceParagraphs of [['我与我'],['我与我','我与我']]) {
    const result=migration.planRubyMigration({chapter:'c',sourceParagraphs,rubies:[source('我','おれ')],targetParagraphs:['交给我。'],rules:[merge]});
    assert.equal(result.annotations.length,0);
    assert.equal(result.records[0].status,'unresolved');
    assert.equal(result.diagnostics.length,1);
  }
});

test('同段多处 ruby 与相邻脚注共享原始坐标，跨内部标记的基字仍可定位', () => {
  const input=extractor.extractParagraphData('<p>前<ruby><rb>小<span>园</span></rb><rt>こぞの</rt></ruby>和<ruby>不伦<rt>ふりん</rt></ruby>。</p>');
  assert.deepEqual(input.rubies.map(r=>[r.start,r.base]),[[1,'小园'],[4,'不伦']]);
  const annotations=[{id:'a',start:1,end:3,base:'小园',reading:'こぞの'},{id:'b',start:4,end:6,base:'不伦',reading:'ふりん'}];
  assert.equal(migration.renderAnnotatedParagraph('前小园和不伦。',annotations,[{offset:1,html:'<sup>1</sup>'},{offset:3,html:'<sup>2</sup>'}]).html,'前<sup>1</sup><ruby>小园<rt>こぞの</rt></ruby><sup>2</sup>和<ruby>不伦<rt>ふりん</rt></ruby>。');
});

test('嵌套 ruby 和空基字必须报告为不支持，不能生成安全映射', () => {
  const data=extractor.extractParagraphData('<p><ruby>外<ruby>内<rt>うち</rt></ruby><rt>そと</rt></ruby><ruby><rt>空</rt></ruby>。</p>');
  assert.deepEqual(data.rubies.map(r=>r.issue),['nested-ruby','nested-ruby','empty-base']);
});
