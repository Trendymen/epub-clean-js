import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import * as extractor from '../../../books/yimei-seikatsu/migrate/paragraph-extractor.js';
import {extractFootnotes} from '../../../books/yimei-seikatsu/migrate/footnote-extractor.js';
import {extractInlineImages} from '../../../books/yimei-seikatsu/migrate/inline-image-extractor.js';
import {parseHTML} from 'linkedom';
import {XMLValidator} from 'fast-xml-parser';
import {nativeRubyAnnotations,nativeSupAnnotations,renderAnnotatedParagraph} from '../../../books/yimei-seikatsu/migrate/ruby-migration.js';

async function temporaryDir(t,prefix) {
 const root=await realpath(tmpdir());
 const dir=await mkdtemp(join(root,prefix));
 const created=await realpath(dir);
 t.after(async()=>{
  const resolved=await realpath(dir);
  assert.equal(resolved,created);
  assert.equal(dirname(resolved),root);
  await rm(resolved,{recursive:true,force:true});
 });
 return dir;
}

test('普通上标的 calibre class 不应阻止保留正文与上标',()=>{
 const xml='<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh"><body><p>甲<sup class="calibre">2</sup>乙</p></body></html>';
 const data=extractor.validateRubyDocument(xml,'sup-class.xhtml',true,{preserveNative:true});
 const {html}=renderAnnotatedParagraph(data.paragraphs[0],[],[],nativeSupAnnotations(data.supers,'sup-class.xhtml'));
 assert.equal(html,'甲<sup class="calibre">2</sup>乙');
 const empty=extractor.validateRubyDocument(xml.replace('class="calibre"','class=""'),'sup-class.xhtml',true,{preserveNative:true});
 assert.equal(renderAnnotatedParagraph(empty.paragraphs[0],[],[],nativeSupAnnotations(empty.supers,'sup-class.xhtml')).html,'甲<sup class="">2</sup>乙');
 for (const attr of ['id="note001"','style="display:none"','aria-describedby="n"']) {
  const unsafe=`<html xml:lang="zh"><body><p>甲<sup ${attr}>2</sup>乙</p></body></html>`;
  assert.throws(()=>extractor.validateRubyDocument(unsafe,'sup-unsafe.xhtml',true,{preserveNative:true}),/sup-unsafe\.xhtml.*sup/);
 }
});

test('纯脚注图标的 span 包装可提取原注释和图标',async t=>{
 const dir=await temporaryDir(t,'wrapped-footnote-');
 const file=join(dir,'chapter.xhtml');
 await writeFile(file,'<html xmlns="http://www.w3.org/1999/xhtml"><body><p>甲<sup><a class="duokan-footnote" href="#n"><span class="icon"><img zy-footnote="注释" src="note.webp"/></span></a></sup>乙</p></body></html>');
 const [note]=extractFootnotes(file);
 assert.equal(note.originalId,'n');
 assert.equal(note.text,'注释');
 assert.equal(note.imgFilename,'note.webp');
 assert.equal(note.hostParaText,'甲乙');
 assert.equal(note.supOffset,1);
 for (const inner of [
  '<a class="duokan-footnote"><span>正文<img src="note.webp"/></span></a>',
  '<a class="duokan-footnote"><span><img src="a.webp"/><img src="b.webp"/></span></a>',
  '<a class="duokan-footnote"><span hidden="hidden"><img src="note.webp"/></span></a>',
  '<a class="duokan-footnote">无图标</a>',
 ]) {
  assert.throws(()=>extractor.validateRubyDocument(`<p>甲<sup>${inner}</sup>乙</p>`,'unsafe-footnote.xhtml'),/unsafe-footnote\.xhtml.*sup/);
 }
});

test('普通链接在多看脚注前面时仍须拒绝混合上标',()=>{
 const xml='<html xmlns="http://www.w3.org/1999/xhtml"><body><p>甲<sup><a href="#other">文字</a><a class="duokan-footnote" href="#n"><img zy-footnote="note" src="note.webp"/></a></sup>乙</p></body></html>';
 assert.throws(()=>extractor.validateRubyDocument(xml,'mixed-links.xhtml'),/mixed-links\.xhtml.*sup/);
});

test('脚注上标混有正文时在提取前报错',()=>{
 const xml='<html xmlns="http://www.w3.org/1999/xhtml"><body><p>甲<sup>2<a class="duokan-footnote" href="#n"><img zy-footnote="note" src="note.webp"/></a></sup>乙</p></body></html>';
 assert.throws(()=>extractor.validateRubyDocument(xml,'mixed-sup.xhtml'),/mixed-sup\.xhtml.*sup/);
});

test('迁移 ruby 遇到原生上标时保留上标并记录冲突',()=>{
 const ruby={id:'new',start:2,end:4,base:'02',reading:'read'};
 const sup={start:3,end:4,html:'<sup>2</sup>',location:'native.xhtml:p1:sup1'};
 const result=renderAnnotatedParagraph('甲102乙',[ruby],[],[sup]);
 assert.equal(result.html,'甲10<sup>2</sup>乙');
 assert.deepEqual(result.rejected,['new']);
 assert.equal(result.reasons.new,'native-sup-overlap');
 assert.throws(()=>renderAnnotatedParagraph('甲1023乙',[],[{offset:4,html:'<sup>注</sup>'}],[{...sup,end:5,html:'<sup>23</sup>'}]),/native\.xhtml:p1:sup1/);
});

test('普通上标继承的 zh-CN 语言在重排后仍保留',()=>{
 const xml='<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN"><body><p>10<sup>2</sup></p></body></html>';
 const data=extractor.validateRubyDocument(xml,'sup-language.xhtml',true,{preserveNative:true});
 const result=renderAnnotatedParagraph(data.paragraphs[0],[],[],nativeSupAnnotations(data.supers,'sup-language.xhtml'));
 assert.equal(result.html,'10<sup xml:lang="zh-cn">2</sup>');
});

test('普通上标继承隐藏语义时不能静默输出',()=>{
 const xml='<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh"><body><p hidden="hidden">10<sup>2</sup></p></body></html>';
 assert.throws(()=>extractor.validateRubyDocument(xml,'sup-hidden.xhtml',true,{preserveNative:true}),/sup-hidden\.xhtml.*sup/);
});

for (const attribute of ['xml:space="preserve"','translate="no"','aria-hidden="true"','hidden="hidden"']) {
 test(`原生 ruby 的祖先语义 ${attribute} 不能静默丢失`,()=>{
  const xml=`<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh"><body><p ${attribute}><ruby>字<rt>じ</rt></ruby></p></body></html>`;
  assert.throws(()=>extractor.validateRubyDocument(xml,'semantic.xhtml',true,{preserveNative:true}),/semantic\.xhtml.*ruby/);
 });
}

test('原生 ruby 指向源文其他节点的 IDREF 必须拒绝',()=>{
 for(const attribute of [
  'aria-describedby="source-note"','aria-labelledby="source-title"','aria-controls="source-panel"',
  'aria-owns="source-node"','aria-activedescendant="source-node"','aria-details="source-node"',
  'headers="source-header"','for="source-input"','form="source-form"','list="source-list"','itemref="source-item"',
 ]) {
  const xml=`<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh"><body><p><ruby ${attribute}>字<rt>じ</rt></ruby></p></body></html>`;
  assert.throws(()=>extractor.validateRubyDocument(xml,'reference.xhtml',true,{preserveNative:true}),/reference\.xhtml.*ruby/);
 }
});

for (const [name,content] of [
 ['祖先','<p xmlns="urn:foreign"><ruby>字<rt>じ</rt></ruby></p>'],
 ['ruby','<p><ruby xmlns="urn:foreign">字<rt>じ</rt></ruby></p>'],
 ['rt','<p><ruby>字<rt xmlns="urn:foreign">じ</rt></ruby></p>'],
 ['跨命名空间的祖先','<p xmlns="urn:foreign"><ruby xmlns="http://www.w3.org/1999/xhtml">字<rt>じ</rt></ruby></p>'],
]) {
 test(`参考注音的 ${name} 默认命名空间必须为 XHTML`,()=>{
  const xml=`<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh"><body>${content}</body></html>`;
  assert.throws(()=>extractor.validateRubyDocument(xml,'foreign.xhtml'),/foreign\.xhtml.*ruby/);
 });
}

test('EPUB 预检不能把未声明命名空间的 ruby 当作 XHTML',()=>{
 const xml='<html><body><p><ruby>字<rt>じ</rt></ruby></p></body></html>';
 assert.throws(()=>extractor.validateRubyDocument(xml,'missing-xmlns.xhtml',true,{requireNamespace:true}),/missing-xmlns\.xhtml.*ruby/);
});

for (const [name,xml] of [
 ['ruby 声明但 html/body/p 未声明','<html><body><p><ruby xmlns="http://www.w3.org/1999/xhtml">字<rt>じ</rt></ruby></p></body></html>'],
 ['body 声明但 html 未声明','<html><body xmlns="http://www.w3.org/1999/xhtml"><p><ruby>字<rt>じ</rt></ruby></p></body></html>'],
 ['p 声明但 html/body 未声明','<html><body><p xmlns="http://www.w3.org/1999/xhtml"><ruby>字<rt>じ</rt></ruby></p></body></html>'],
 ['外部 html 后代改回 XHTML','<html xmlns="urn:foreign"><body xmlns="http://www.w3.org/1999/xhtml"><p><ruby>字<rt>じ</rt></ruby></p></body></html>'],
 ['外部 body 后代改回 XHTML','<html xmlns="http://www.w3.org/1999/xhtml"><body xmlns="urn:foreign"><p xmlns="http://www.w3.org/1999/xhtml"><ruby>字<rt>じ</rt></ruby></p></body></html>'],
 ['外部 p 下的 ruby 改回 XHTML','<html xmlns="http://www.w3.org/1999/xhtml"><body><p xmlns="urn:foreign"><ruby xmlns="http://www.w3.org/1999/xhtml">字<rt>じ</rt></ruby></p></body></html>'],
 ['带前缀的祖先','<html xmlns="http://www.w3.org/1999/xhtml" xmlns:x="urn:foreign"><body><p><x:span><ruby>字<rt>じ</rt></ruby></x:span></p></body></html>'],
]) {
 test(`EPUB 中 ${name} 的祖先命名空间须拒绝`,()=>{
  assert.throws(()=>extractor.validateRubyDocument(xml,'ancestor-xmlns.xhtml',true,{requireNamespace:true}),/ancestor-xmlns\.xhtml.*ruby/);
 });
}

test('完整 XHTML 文档的 ruby 可继承根元素默认命名空间',()=>{
 const xml='<html xmlns="http://www.w3.org/1999/xhtml"><body><p><ruby class="calibre">字<rt>じ</rt></ruby></p></body></html>';
 assert.equal(extractor.validateRubyDocument(xml,'xhtml.xhtml',true,{requireNamespace:true}).rubies.length,1);
});

test('普通上标正文参与段落、脚注偏移和插图位置',async t=>{
 const dir=await temporaryDir(t,'ruby-sup-');
 const file=join(dir,'chapter.xhtml');
 await writeFile(file,'<html><body><p><sup>2</sup></p><p>甲<sup>3</sup>乙<sup><a class="duokan-footnote" href="#n"><img zy-footnote="note" src="note.webp"/></a></sup>丙</p><div class="illus"><img src="p.webp"/></div></body></html>');
 assert.deepEqual(extractor.extractParagraphs(file),['2','甲3乙丙']);
 const [note]=extractFootnotes(file);
 assert.equal(note.hostParaIndex,1);
 assert.equal(note.hostParaText,'甲3乙丙');
 assert.equal(note.supOffset,3);
 assert.equal(extractInlineImages(file)[0].afterParaIndex,1);
});

test('原生 ruby 保留属性、回退括号、链接及内部样式',()=>{
 const input='<p>前<ruby id="origin" class="annotation" xml:lang="ja"><rb><a href="https://example.test/?a=1&amp;b=2"><em style="font-style:italic">漢</em></a></rb><rp>（</rp><rt lang="ja">かん</rt><rp>）</rp></ruby>后</p>';
 const data=extractor.validateRubyDocument(input,'native.xhtml',true,{preserveNative:true});
 const annotations=nativeRubyAnnotations(data.rubies,'native.xhtml');
 const {html}=renderAnnotatedParagraph(data.paragraphs[0],annotations);
 const ruby=parseHTML(`<p>${html}</p>`).document.querySelector('ruby');
 assert.equal(ruby.getAttribute('id'),'origin');
 assert.equal(ruby.getAttribute('class'),'annotation');
 assert.equal(ruby.getAttribute('xml:lang'),'ja');
 assert.equal(ruby.querySelector('a').getAttribute('href'),'https://example.test/?a=1&b=2');
 assert.equal(ruby.querySelector('em').getAttribute('style'),'font-style:italic');
 assert.equal(ruby.querySelector('rt').getAttribute('lang'),'ja');
 assert.deepEqual([...ruby.querySelectorAll('rp')].map(node=>node.textContent),['（','）']);
 assert.match(html,/href="https:\/\/example\.test\/\?a=1&amp;b=2"/);
 assert.equal(XMLValidator.validate(`<p>${html}</p>`),true);
});

test('分段 rb 和 rt 的原生 ruby 不被合并成另一种结构',()=>{
 const input='<html xml:lang="zh"><body><p>前<ruby><rb>漢</rb><rt>かん</rt><rb>語</rb></ruby>后</p></body></html>';
 const data=extractor.validateRubyDocument(input,'segments.xhtml',true,{preserveNative:true});
 const {html}=renderAnnotatedParagraph(data.paragraphs[0],nativeRubyAnnotations(data.rubies,'segments.xhtml'));
 assert.equal(html,'前<ruby><rb>漢</rb><rt>かん</rt><rb>語</rb></ruby>后');
});

test('原生 ruby 缺少可保留结构时拒绝渲染',()=>{
 assert.throws(()=>renderAnnotatedParagraph('字',[{id:'broken',native:true,start:0,end:1,base:'字',reading:'じ',location:'source.xhtml:p1'}]),/source\.xhtml:p1.*missing-native-ruby-markup/);
});

test('不能保证原生 ruby 的包裹或资源引用时须在预检拒绝',()=>{
 for (const input of [
  '<p><a href="https://example.test/"><ruby>字<rt>じ</rt></ruby></a></p>',
  '<p><ruby><a href="../missing.xhtml">字</a><rt>じ</rt></ruby></p>',
  '<p><ruby>字<img src="missing.png"/><rt>じ</rt></ruby></p>',
 ]) {
  assert.throws(()=>extractor.validateRubyDocument(input,'unsafe.xhtml',true,{preserveNative:true}),/unsafe\.xhtml.*ruby/);
 }
});

test('原生 ruby 继承的语言和行内样式不能无声消失',()=>{
 for (const input of [
  '<html xml:lang="zh-CN"><body><p><ruby xml:lang="ja">字<rt>じ</rt></ruby></p></body></html>',
  '<html xml:lang="ja"><body><p xml:lang="zh"><ruby>字<rt>じ</rt></ruby></p></body></html>',
  '<html xml:lang="zh"><body><p dir="rtl"><ruby dir="ltr">字<rt>じ</rt></ruby></p></body></html>',
  '<html xml:lang="zh"><body><p><ruby lang="en">字<rt>ji</rt></ruby></p></body></html>',
  '<html xml:lang="ja"><body><p><ruby xml:lang="">字<rt>じ</rt></ruby></p></body></html>',
 ]) {
  assert.equal(extractor.validateRubyDocument(input,'inherited.xhtml',true,{preserveNative:true}).rubies.length,1);
 }
 for (const input of [
  '<html xml:lang="zh"><body><p xml:lang="ja"><ruby>字<rt>じ</rt></ruby></p></body></html>',
  '<html xml:lang="zh"><body><p style="font-weight:bold"><ruby>字<rt>じ</rt></ruby></p></body></html>',
  '<html xml:lang="zh"><body><p dir="rtl"><ruby>字<rt>じ</rt></ruby></p></body></html>',
  '<html><body><p><ruby>字<rt>じ</rt></ruby></p></body></html>',
 ]) {
  assert.throws(()=>extractor.validateRubyDocument(input,'inherited.xhtml',true,{preserveNative:true}),/inherited\.xhtml.*ruby/);
 }
});

test('普通 lang 不覆盖 XML 祖先的 xml:lang',()=>{
 const xml='<html xml:lang="ja"><body><p><ruby lang="en">字<rt>ji</rt></ruby></p></body></html>';
 assert.throws(()=>extractor.validateRubyDocument(xml,'xml-language.xhtml',true,{preserveNative:true}),/xml-language\.xhtml.*ruby.*inherited-context/);
});

test('ruby 自身 xml:lang 覆盖祖先 zh-CN',()=>{
 const xml='<html xml:lang="zh-CN"><body><p><ruby xml:lang="ja">字<rt>じ</rt></ruby></p></body></html>';
 assert.equal(extractor.validateRubyDocument(xml,'own-language.xhtml',true,{preserveNative:true}).rubies.length,1);
});

test('祖先 lang 改变 HTML 语言时不能丢失',()=>{
 const xml='<html xml:lang="zh"><body><p lang="ja"><ruby>字<rt>じ</rt></ruby></p></body></html>';
 assert.throws(()=>extractor.validateRubyDocument(xml,'html-language.xhtml',true,{preserveNative:true}),/html-language\.xhtml.*ruby.*inherited-context/);
});

test('近层 lang 与输出一致也不能覆盖不同的 XML 语言',()=>{
 const xml='<html xml:lang="ja"><body><p lang="zh"><ruby>字<rt>じ</rt></ruby></p></body></html>';
 assert.throws(()=>extractor.validateRubyDocument(xml,'mixed-language.xhtml',true,{preserveNative:true}),/mixed-language\.xhtml.*ruby.*inherited-context/);
});

test('仅有普通 lang 时，未知 XML 语言不能变成 zh',()=>{
 const xml='<html lang="zh"><body><p><ruby>字<rt>じ</rt></ruby></p></body></html>';
 assert.throws(()=>extractor.validateRubyDocument(xml,'missing-xml-language.xhtml',true,{preserveNative:true}),/missing-xml-language\.xhtml.*ruby.*inherited-context/);
});

test('同一节点的 lang 和 xml:lang 冲突时拒绝原生 ruby',()=>{
 const xml='<html xml:lang="zh"><body><p><ruby lang="en" xml:lang="ja">字<rt>じ</rt></ruby></p></body></html>';
 assert.throws(()=>extractor.validateRubyDocument(xml,'conflicting-language.xhtml',true,{preserveNative:true}),/conflicting-language\.xhtml.*ruby/);
});

test('HTML 与 XHTML 解析结果不同的原生 ruby 在预检拒绝',()=>{
 for (const input of [
  '<p><ruby><span/>字<rt>じ</rt></ruby></p>',
  '<p><ruby>字<![CDATA[更多]]><rt>じ</rt></ruby></p>',
 ]) {
  assert.throws(()=>extractor.validateRubyDocument(input,'xml-semantics.xhtml',true,{preserveNative:true}),/xml-semantics\.xhtml.*ruby/);
 }
});

test('游离 rt 和 rp 必须指出位置并拒绝处理',()=>{
 for (const tag of ['rt','rp']) {
  for (const input of [`<p>甲<${tag}>乙</${tag}>丙</p>`,`<h3>甲<${tag}>乙</${tag}>丙</h3>`,`<aside><p>甲<${tag}>乙</${tag}>丙</p></aside>`]) {
   assert.throws(()=>extractor.validateRubyDocument(input,'orphan.xhtml'),new RegExp(`orphan\\.xhtml.*${tag}`));
  }
 }
});

test('带命名空间前缀的 ruby 标签在段落、标题和 aside 中均须拒绝',()=>{
 for (const container of ['p','h3','aside']) {
  const input=`<html xmlns:x="http://www.w3.org/1999/xhtml"><body><${container}>甲<x:ruby>字<x:rt>じ</x:rt></x:ruby>乙</${container}></body></html>`;
  assert.throws(()=>extractor.validateRubyDocument(input,'prefix.xhtml'),/prefix\.xhtml.*ruby/);
 }
});

test('只有 rt 或 rp 的空基字 ruby 仍有明确诊断',()=>{
 for(const xml of ['<p><ruby><rt>reading</rt></ruby></p>','<p><ruby><rp>(</rp><rt>reading</rt><rp>)</rp></ruby></p>']) {
  const data=extractor.extractParagraphData(xml);
  assert.equal(data.rubies.length,1);
  assert.equal(data.rubies[0].issue,'empty-base');
  assert.equal(data.rubies[0].paraIndex,null);
 }
});

test('空基字段落在脚注或插图提取前明确拒绝，避免改变既有计数路径',async t=>{
 const dir=await temporaryDir(t,'ruby-indices-');
 const file=join(dir,'chapter.xhtml');
 await writeFile(file,'<html><body><p><ruby><rp>(</rp><rt>reading</rt><rp>)</rp></ruby></p><p>前基<sup><a class="duokan-footnote" href="#n"><img zy-footnote="note" src="note.webp"/></a></sup>后</p><div class="illus"><img src="p.webp"/></div><p>末段</p></body></html>');
 for(const extract of [extractor.extractParagraphs,extractFootnotes,extractInlineImages]) assert.throws(()=>extract(file),/chapter.xhtml:p1:ruby1: empty-base/);
 await writeFile(file,'<html><body><p>  前<ruby><rb>基</rb><rp>(</rp><rt>original</rt><rp>)</rp></ruby><sup><a class="duokan-footnote" href="#n"><img zy-footnote="note" src="note.webp"/></a></sup>后</p><div class="illus"><img src="p.webp"/></div><p>末段</p></body></html>');
 assert.deepEqual(extractor.extractParagraphs(file),['前基后','末段']);
 const [note]=extractFootnotes(file);
 assert.equal(note.hostParaIndex,0);
 assert.equal(note.supOffset,2);
 assert.equal(note.hostParaText,'前基后');
 assert.equal(extractInlineImages(file)[0].afterParaIndex,0);
});

test('原生 ruby 优先于重叠的新注音，重复基字按坐标保留，脚注可相邻',()=>{
 const native={id:'native',native:true,start:1,end:2,base:'基',reading:'original',html:'<ruby>基<rt>original</rt></ruby>',location:'source.xhtml:p1'};
 const extra={id:'new',start:1,end:2,base:'基',reading:'new'};
 const second={id:'second',native:true,start:3,end:4,base:'基',reading:'second',html:'<ruby>基<rt>second</rt></ruby>',location:'source.xhtml:p1'};
 const rendered=renderAnnotatedParagraph('前基和基。',[extra,native,second],[{offset:2,html:'<sup>note</sup>'}]);
 assert.equal(rendered.html,'前<ruby>基<rt>original</rt></ruby><sup>note</sup>和<ruby>基<rt>second</rt></ruby>。');
 assert.deepEqual(rendered.rejected,['new']);
 assert.equal(rendered.reasons.new,'native-ruby-overlap');
 assert.throws(()=>renderAnnotatedParagraph('前基字后',[{...native,end:3,base:'基字'}],[{offset:2,html:'<sup>note</sup>'}]),/source.xhtml:p1.*footnote-inside-native-ruby/);
});

test('验证对标题、aside、其他容器和不支持结构 fail closed 并定位文件',()=>{
 assert.equal(typeof extractor.validateRubyDocument,'function');
 for(const xml of ['<h3><ruby>标题<rt>title</rt></ruby></h3>','<aside><p><ruby>注<rt>note</rt></ruby></p></aside>','<div><ruby>字<rt>read</rt></ruby></div>','<p><ruby><rt>empty</rt></ruby></p>','<p><ruby>字<rt>a</rt><rt>b</rt></ruby></p>','<p><ruby>字<sup>1</sup><rt>a</rt></ruby></p>']) {
  assert.throws(()=>extractor.validateRubyDocument(xml,'fixture.xhtml'),/fixture.xhtml.*ruby/);
 }
 const good=extractor.validateRubyDocument('<p>前<ruby><rb>基</rb><rp>(</rp><rt>original</rt><rp>)</rp></ruby>后</p>','fixture.xhtml');
 assert.equal(good.rubies[0].reading,'original');
});
