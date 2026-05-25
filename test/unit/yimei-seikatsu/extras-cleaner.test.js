import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  stripCalibreClasses,
  buildCoverXhtml,
  buildIllusXhtml,
  buildTitleXhtml,
  buildMessageXhtml,
  buildSummaryXhtml,
  buildContentsXhtml,
  buildPreXhtml,
  buildTocXhtml,
} from '../../../books/yimei-seikatsu/migrate/extras-cleaner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(
  __dirname,
  '../../fixtures/yimei09/golden-py/OEBPS/Text',
);

function hash(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

// ---------- stripCalibreClasses ----------

test('stripCalibreClasses: simple', () => {
  const cleaned = stripCalibreClasses('<p class="calibre22">test</p>');
  assert.equal(cleaned, '<p>test</p>');
});

test('stripCalibreClasses: keep other classes', () => {
  const cleaned = stripCalibreClasses('<p class="calibre22 message">test</p>');
  assert.ok(cleaned.includes('message'));
  assert.ok(!cleaned.includes('calibre22'));
});

test('stripCalibreClasses: pcalibre + multiple', () => {
  const cleaned = stripCalibreClasses(
    '<aside class="pcalibre1 calibre29" id="n">x</aside>',
  );
  assert.ok(!cleaned.includes('pcalibre'));
  assert.ok(!cleaned.includes('calibre29'));
  assert.ok(cleaned.includes('id="n"'));
});

// ---------- cover / illus ----------

test('buildCoverXhtml: enlarge attributes', () => {
  const html = buildCoverXhtml('cover.jpg');
  assert.ok(html.includes('class="cover duokan-image-single"'));
  assert.ok(html.includes('zy-enlarge-src="self"'));
  assert.ok(html.includes('src="../Images/cover.jpg"'));
  assert.ok(html.includes('../Misc/script.js'));
  assert.ok(html.includes('../Styles/stylesheet.css'));
  assert.ok(html.includes('xmlns:epub'));
});

test('buildIllusXhtml: kuchie class', () => {
  const html = buildIllusXhtml('kuchie-001.webp', 'kuchie-001');
  assert.ok(html.includes('class="kuchie duokan-image-single"'));
  assert.ok(html.includes('zy-enlarge-src="self"'));
  assert.ok(html.includes('src="../Images/kuchie-001.webp"'));
  assert.ok(html.includes('alt="kuchie-001"'));
});

// ---------- title ----------

test('buildTitleXhtml: 4 个图片引用 + textbox 样式', () => {
  const html = buildTitleXhtml('t1.webp', 't2.webp', 't3.webp', 't4.webp');
  assert.ok(html.includes('src="../Images/t1.webp"'));
  assert.ok(html.includes('src="../Images/t2.webp"'));
  assert.ok(html.includes('src="../Images/t3.webp"'));
  assert.ok(html.includes('src="../Images/t4.webp"'));
  assert.ok(html.includes('class="textbox"'));
  assert.ok(html.includes('<p class="c1">作者</p>'));
  assert.ok(html.includes('<p class="c3">插画</p>'));
  assert.ok(html.includes('<title>标题</title>'));
});

test('buildTitleXhtml: 与 golden-py 一致', async () => {
  const golden = await readFile(resolve(FIXTURES, 'title.xhtml'), 'utf8');
  const generated = buildTitleXhtml('t1.webp', 't2.webp', 't3.webp', 't4.webp');
  assert.equal(hash(generated), hash(golden));
});

// ---------- message ----------

test('buildMessageXhtml: 含 credit + url + logo', () => {
  const html = buildMessageXhtml(
    [
      ['作者', '三河ごーすと'],
      ['插画', 'Hiten'],
    ],
    'https://example.com',
    'logo.png',
  );
  assert.ok(html.includes('制 作 信 息'));
  assert.ok(html.includes('<p>作者</p>'));
  assert.ok(html.includes('<p>三河ごーすと</p>'));
  assert.ok(html.includes('<p>插画</p>'));
  assert.ok(html.includes('<p>Hiten</p>'));
  assert.ok(html.includes('href="https://example.com"'));
  assert.ok(html.includes('src="../Images/logo.png"'));
  assert.ok(html.includes('zy-enlarge-src="none"'));
});

test('buildMessageXhtml: 与 golden-py 一致', async () => {
  const golden = await readFile(resolve(FIXTURES, 'message.xhtml'), 'utf8');
  const credits = [
    ['作者', '三河ごーすと'],
    ['插画', 'Hiten'],
    ['译者', '幽蝉满耳'],
    ['校对', '炫目林光'],
    ['图源', 'UU'],
    ['录入', 'coolbar'],
    ['嵌字', '闲的e书组'],
    ['ePub', '落合葵'],
  ];
  const generated = buildMessageXhtml(credits);
  assert.equal(hash(generated), hash(golden));
});

// ---------- summary ----------

test('buildSummaryXhtml: 按行分段 + 跳过空行', () => {
  const html = buildSummaryXhtml('第一段\n\n第二段\n   \n第三段');
  assert.ok(html.includes('<h3>简介</h3>'));
  assert.ok(html.includes('<p>第一段</p>'));
  assert.ok(html.includes('<p>第二段</p>'));
  assert.ok(html.includes('<p>第三段</p>'));
});

test('buildSummaryXhtml: HTML 转义', () => {
  const html = buildSummaryXhtml('<script>alert(1)</script> & 一些文本');
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp;'));
});

test('buildSummaryXhtml: 与 golden-py 一致', async () => {
  const golden = await readFile(resolve(FIXTURES, 'summary.xhtml'), 'utf8');
  const description = [
    '我紧紧握住他牵着我的那只手，一点都不想放开。',
    '在校是「情侣」，在家是「兄妹」。',
    '悠太与沙季通过磨合找出适当距离，',
    '但是紧接着就因为父母不在而要度过「完全只有两个人的两天」，',
    '两人真的能继续维持适当的距离吗……？',
    '另一方面，学校活动、朋友的青春与加油、与打工新人「后辈小妹」的交流等，',
    '崭新的风毫不留情地吹向悠太与沙季……？',
    '「相遇」至今一年，历经许多事而改变的两人，迎来高中生活最后的夏天。',
    '经历过友情、青春、新的相遇之后，「兄妹」所面对的感情是──',
  ].join('\n');
  const generated = buildSummaryXhtml(description);
  assert.equal(hash(generated), hash(golden));
});

// ---------- contents ----------

test('buildContentsXhtml: 含 image_filename', () => {
  const html = buildContentsXhtml('toc-002.jpg');
  assert.ok(html.includes('src="../Images/toc-002.jpg"'));
  assert.ok(html.includes('alt="contents"'));
  assert.ok(html.includes('class="kuchie duokan-image-single"'));
});

test('buildContentsXhtml: 默认参数', () => {
  const html = buildContentsXhtml();
  assert.ok(html.includes('src="../Images/toc-001.webp"'));
});

test('buildContentsXhtml: 与 golden-py 一致', async () => {
  const golden = await readFile(resolve(FIXTURES, 'contents.xhtml'), 'utf8');
  const generated = buildContentsXhtml('toc-001.webp');
  assert.equal(hash(generated), hash(golden));
});

// ---------- pre ----------

test('buildPreXhtml: 含 quote 居中 + bold', () => {
  const html = buildPreXhtml('一句引言');
  assert.ok(html.includes('<p class="bold center">一句引言</p>'));
  assert.ok(html.includes('<title>序</title>'));
  // 5 个空 <p><br/></p>
  assert.equal((html.match(/<p><br\/><\/p>/g) || []).length, 5);
});

test('buildPreXhtml: 默认空 quote', () => {
  const html = buildPreXhtml();
  assert.ok(html.includes('<p class="bold center"></p>'));
});

test('buildPreXhtml: 与 golden-py 一致', async () => {
  const golden = await readFile(resolve(FIXTURES, 'pre.xhtml'), 'utf8');
  const generated = buildPreXhtml('冷静的人生规划不保证会有幸福的人生。幸福藏在刹那间的狂热之中。');
  assert.equal(hash(generated), hash(golden));
});

// ---------- toc ----------

test('buildTocXhtml: 每个 entry 含 href + title', () => {
  const html = buildTocXhtml([
    ['chapter0001.xhtml', '第一章'],
    ['chapter0002.xhtml', '第二章'],
  ]);
  assert.ok(html.includes('href="chapter0001.xhtml"'));
  assert.ok(html.includes('href="chapter0002.xhtml"'));
  assert.ok(html.includes('<p>第一章</p>'));
  assert.ok(html.includes('<p>第二章</p>'));
  assert.ok(html.includes('<h3 class="ctt">CONTENTS</h3>'));
  // 应有两个 .toc div
  assert.equal((html.match(/class="toc"/g) || []).length, 2);
});

test('buildTocXhtml: 与 golden-py 一致', async () => {
  const golden = await readFile(resolve(FIXTURES, 'TOC.xhtml'), 'utf8');
  const entries = [
    ['chapter0001.xhtml', '6月12日（星期六） 浅村悠太'],
    ['chapter0002.xhtml', '6月12日（星期六） 绫濑沙季'],
    ['chapter0003.xhtml', '6月13日（星期日） 浅村悠太'],
    ['chapter0004.xhtml', '6月13日（星期日） 绫濑沙季'],
    ['chapter0005.xhtml', '6月14日（星期一） 浅村悠太'],
    ['chapter0006.xhtml', '6月14日（星期一） 绫濑沙季'],
    ['chapter0007.xhtml', '6月15日（星期二） 浅村悠太'],
    ['chapter0008.xhtml', '6月15日（星期二） 绫濑沙季'],
    ['chapter0009.xhtml', '7月20日（星期二） 浅村悠太'],
    ['chapter0010.xhtml', '7月20日（星期二） 绫濑沙季'],
    ['chapter0011.xhtml', '7月22日（星期四） 浅村悠太'],
    ['chapter0012.xhtml', '7月22日（星期四） 绫濑沙季'],
    ['special0001.xhtml', '电子书特典 『棉花糖般甜蜜』'],
    ['special0002.xhtml', '蜜瓜特典 『倘若有未来博物馆』'],
    ['special0003.xhtml', 'Animate特典4P小册子 『适合婚礼的月份』'],
  ];
  const generated = buildTocXhtml(entries);
  assert.equal(hash(generated), hash(golden));
});
