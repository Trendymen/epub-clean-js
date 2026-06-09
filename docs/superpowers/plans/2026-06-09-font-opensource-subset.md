# 台简产物字体开源化 + 按卷子集化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 09/11/12/13 卷台简产物里搞不清命名的子集字体，统一替换为按卷实际用字子集化的思源开源字体（宋 Regular / 宋 Bold / 黑 Bold），彻底消除标题/目录/简介/正文的缺字。

**Architecture:** 新增纯函数模块 `src/core/font-subset.js`，负责「扫各部位用字 → 用 subset-font 从思源源字体子集化 3 个字体 → 重写 CSS（真实思源命名 + 删旧 @font-face/孤儿引用 + 去 emoji/sym fallback）→ 替换字体文件」。两条产物管线（09 走 migrate-epub.js 目录模型，11/12/13 走 lightnovel-html/index.js 内存 files map）在「xhtml 齐全后、manifest 自动扫描前」各调用一个适配器。

**Tech Stack:** Node ESM、`subset-font`（harfbuzz 内核）、`opentype.js`（验证）、`adm-zip`/`yazl`、`opencc-js`。

设计依据见 spec：[docs/superpowers/specs/2026-06-09-font-opensource-subset-design.md](../specs/2026-06-09-font-opensource-subset-design.md)。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `package.json` | 修改 | 加 `subset-font` 依赖 |
| `books/source-han-sans-sc/` | 新增 | 思源黑体 SC（Regular/Medium/Bold OTF） |
| `src/core/font-subset.js` | 新增 | 字符集提取 + 子集化 + CSS 重写 + 两个 IO 适配器 |
| `test/unit/yimei-seikatsu/font-subset.test.js` | 新增 | 模块单测 |
| `books/yimei-seikatsu/lightnovel-html/index.js` | 修改 | `mediaTypeFor` 加 .otf；集成 `applyToFiles`；`simplifyText` 加 U+223C 规范化 |
| `books/yimei-seikatsu/migrate/migrate-epub.js` | 修改 | `buildManifest` media-type 加 .otf；集成 `applyToDir` |
| `test/fixtures/yimei09/golden-manifest.json` | 修改 | 重新生成（Fonts/Styles hash 变更） |

**关键不变量**：两条管线的字体 manifest 都是「扫目录/扫 files map」自动生成（migrate-epub.js:674、lightnovel-html/index.js:1196），所以删旧字体 + 写新字体后 manifest 自动反映，无需手改 manifest 列表，只需让 media-type 映射识别 `.otf`。

**字符集策略**：
- `regular` 子集 = 全书所有字符（正文用 Regular，覆盖全书）。
- `bold` 子集 = 全书所有 `<h3>` 文本 + 目录页（TOC.xhtml/navigation-documents.xhtml）全文 + 全书非汉字符号。
- `sans` 子集 = 全书所有 `<h4>` 文本 + `class` 含 `cut`/`ch1` 的元素文本 + 全书非汉字符号。

**CSS 字体名映射**（旧 token → 新 family role）：
- `main/ch3/sum/mes/note/cont/int/title` → serif（`"Source Han Serif SC"`）
- `ch2/ctt1/ctt2` → serifBold（`"Source Han Serif SC Bold"`）
- `ch1` → sans（`"Source Han Sans SC Bold"`）
- `illus1-5/num/emoji/sym` 及其它未知 token → 删除该 `font-family` 声明（孤儿）
- `initial/inherit` → 保留不动

---

## Task 1: 依赖与思源黑体资产 + 定 ch1 字重

**Files:**
- Modify: `package.json`
- Create: `books/source-han-sans-sc/SourceHanSansSC-{Regular,Medium,Bold}.otf`
- Create: `books/source-han-sans-sc/.gitignore`（与 serif 目录一致，OTF 不入库则忽略；本项目 serif 已入库，黑体同样入库则不忽略——按 serif 现状决定）

- [ ] **Step 1: 安装 subset-font**

Run:
```bash
cd "/Users/liuzhuo/Downloads/资源/义妹生活/epub-clean-js"
npm install subset-font
```
Expected: `package.json` dependencies 出现 `"subset-font"`，`node_modules/subset-font` 存在。

- [ ] **Step 2: 下载思源黑体 SC（Regular/Medium/Bold）**

思源黑体 = Noto Sans CJK SC（同字形，SIL OFL）。从 Adobe release 取 region-specific OTF：
```bash
mkdir -p "books/source-han-sans-sc"
cd "books/source-han-sans-sc"
curl -L -o SHSans.zip "https://github.com/adobe-fonts/source-han-sans/releases/download/2.004R/SourceHanSansSC.zip"
unzip -o SHSans.zip
# zip 内字重 OTF 可能在子目录；定位并保留 Regular/Medium/Bold：
find . -name "SourceHanSansSC-Regular.otf" -exec cp {} ./SourceHanSansSC-Regular.otf \;
find . -name "SourceHanSansSC-Medium.otf"  -exec cp {} ./SourceHanSansSC-Medium.otf  \;
find . -name "SourceHanSansSC-Bold.otf"    -exec cp {} ./SourceHanSansSC-Bold.otf    \;
rm -rf SHSans.zip SubsetOTF OTF 2>/dev/null; ls -la *.otf
cd ../..
```
Expected: `books/source-han-sans-sc/` 下有 3 个 OTF。
**备选**（若 release 结构变化/网络失败）：从 Google Noto 下 `NotoSansCJKsc-{Regular,Medium,Bold}.otf`（字形等价），改名为 `SourceHanSansSC-*.otf`。

- [ ] **Step 3: 渲染对比定 ch1 字重**

Run（复用既有渲染手法，对比原 ch1 与思源黑体 Medium/Bold）：
```bash
node -e '
import("/Users/liuzhuo/Downloads/资源/义妹生活/epub-clean-js/node_modules/opentype.js/dist/opentype.mjs").then(async opentype=>{
  const fs=await import("node:fs");
  const AdmZip=(await import("/Users/liuzhuo/Downloads/资源/义妹生活/epub-clean-js/node_modules/adm-zip/adm-zip.js")).default;
  const ROOT="/Users/liuzhuo/Downloads/资源/义妹生活";
  const parse=b=>opentype.parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  const z=new AdmZip(ROOT+"/output/simple/[三河ごーすと].义妹生活.11.[台简].epub");
  const e=z.getEntries().find(x=>x.entryName.endsWith("Fonts/ch1.ttf"));
  const ch1=parse(e.getData());
  const SH=ROOT+"/epub-clean-js/books/source-han-sans-sc";
  const rows=[["ch1原",ch1],["黑Medium",parse(fs.readFileSync(SH+"/SourceHanSansSC-Medium.otf"))],["黑Bold",parse(fs.readFileSync(SH+"/SourceHanSansSC-Bold.otf"))]];
  const pick=f=>{const o=[];const cand="书店特典的章序尾声".split("");for(const c of cand)if(o.length<5&&f.charToGlyphIndex(c))o.push(c);return o.join("");};
  let y=10,body="";for(const [n,f] of rows){y+=120;body+=`<text x=8 y=${y-46} font-size=22>${n}</text>`+f.getPath(pick(f),200,y-18,84).toSVG(2);}
  fs.writeFileSync("/tmp/ch1-weight.svg",`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="${y+30}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`);
});'
qlmanage -t -s 1400 -o /tmp /tmp/ch1-weight.svg
```
查看 `/tmp/ch1-weight.svg.png`，在 Medium/Bold 间选与 ch1 视觉粗细最接近者。**默认 Bold**（与标题宋体重量统一），若 Medium 更接近则改 Task 3 的 `sansBold` 源为 Medium 文件。

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json books/source-han-sans-sc
git commit -m "build: 加 subset-font 依赖 + 思源黑体 SC 资产"
```

---

## Task 2: font-subset.js — 字符集提取

**Files:**
- Create: `src/core/font-subset.js`
- Create: `test/unit/yimei-seikatsu/font-subset.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/unit/yimei-seikatsu/font-subset.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { extractCharsets } from '../../../src/core/font-subset.js';

test('extractCharsets: regular 收全字符，bold 收 h3+目录，sans 收 h4/.cut', () => {
  const xhtmlList = [
    { name: 'OEBPS/Text/chapter0001.xhtml', text: '<h3>序幕假日</h3><p>正文甲乙</p><h4>分隔丙</h4>' },
    { name: 'OEBPS/Text/TOC.xhtml', text: '<a href="x">目录条丁</a>' },
    { name: 'OEBPS/Text/chapter0002.xhtml', text: '<div class="cut">场景戊</div>' },
  ];
  const cs = extractCharsets(xhtmlList);
  // regular = 全字符
  for (const c of '序幕假日正文甲乙分隔丙目录条丁场景戊') assert.ok(cs.regular.has(c), `regular 缺 ${c}`);
  // bold = h3(序幕假日) + 目录(目录条丁)
  for (const c of '序幕假日目录条丁') assert.ok(cs.bold.has(c), `bold 缺 ${c}`);
  assert.ok(!cs.bold.has('正'), 'bold 不应含正文字');
  // sans = h4(分隔丙) + .cut(场景戊)
  for (const c of '分隔丙场景戊') assert.ok(cs.sans.has(c), `sans 缺 ${c}`);
  assert.ok(!cs.sans.has('甲'), 'sans 不应含正文字');
});

test('extractCharsets: 非汉字符号并入 bold/sans', () => {
  const cs = extractCharsets([{ name: 'OEBPS/Text/chapter0001.xhtml', text: '<p>正文，。！A1</p>' }]);
  for (const c of '，。！A1') { assert.ok(cs.bold.has(c), `bold 缺符号 ${c}`); assert.ok(cs.sans.has(c), `sans 缺符号 ${c}`); }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --test-reporter=spec 'test/unit/yimei-seikatsu/font-subset.test.js'`
Expected: FAIL（`extractCharsets` 未定义 / 模块不存在）。

- [ ] **Step 3: 实现 extractCharsets（建模块骨架）**

```js
// src/core/font-subset.js
import fs from 'node:fs';
import path from 'node:path';
import subsetFont from 'subset-font';

const BOOKS = path.resolve(import.meta.dirname, '../../books');

export const SOURCE_FONTS = {
  serifRegular: path.join(BOOKS, 'source-han-serif-sc/SourceHanSerifSC-Regular.otf'),
  serifBold:    path.join(BOOKS, 'source-han-serif-sc/SourceHanSerifSC-Bold.otf'),
  sansBold:     path.join(BOOKS, 'source-han-sans-sc/SourceHanSansSC-Bold.otf'),
};

export const NEW_FONTS = [
  { role: 'regular', file: 'SourceHanSerifSC-Regular.subset.otf', family: 'Source Han Serif SC',      weight: null },
  { role: 'bold',    file: 'SourceHanSerifSC-Bold.subset.otf',    family: 'Source Han Serif SC Bold', weight: 700 },
  { role: 'sans',    file: 'SourceHanSansSC-Bold.subset.otf',     family: 'Source Han Sans SC Bold',  weight: 700 },
];

const stripTags = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
const addChars = (set, s) => { for (const c of s) if (c.codePointAt(0) >= 0x20) set.add(c); };
const isHan = (c) => /\p{Script=Han}/u.test(c);

export function extractCharsets(xhtmlList) {
  const regular = new Set();
  const bold = new Set();
  const sans = new Set();
  for (const { name, text } of xhtmlList) {
    addChars(regular, stripTags(text));
    for (const m of text.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)) addChars(bold, stripTags(m[1]));
    if (/\/(TOC|navigation-documents)\.xhtml$/i.test(name)) addChars(bold, stripTags(text));
    for (const m of text.matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi)) addChars(sans, stripTags(m[1]));
    for (const m of text.matchAll(/<[^>]*class="[^"]*\b(?:cut|ch1)\b[^"]*"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/gi)) addChars(sans, stripTags(m[1]));
  }
  const symbols = [...regular].filter((c) => !isHan(c));
  for (const c of symbols) { bold.add(c); sans.add(c); }
  return { regular, bold, sans };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test --test-reporter=spec 'test/unit/yimei-seikatsu/font-subset.test.js'`
Expected: PASS（2 个 extractCharsets 测试）。

- [ ] **Step 5: Commit**

```bash
git add src/core/font-subset.js test/unit/yimei-seikatsu/font-subset.test.js
git commit -m "feat(font-subset): 字符集按部位提取（regular/bold/sans）"
```

---

## Task 3: font-subset.js — CSS 重写

**Files:**
- Modify: `src/core/font-subset.js`
- Modify: `test/unit/yimei-seikatsu/font-subset.test.js`

- [ ] **Step 1: 追加失败测试**

```js
import { rewriteCss } from '../../../src/core/font-subset.js';

test('rewriteCss: 删旧 @font-face、加 3 新、family 重映射、删孤儿、去 emoji/sym fallback', () => {
  const css = [
    '@font-face{font-family:"ch2";src:url(../Fonts/ch2.ttf);}',
    '@font-face{font-family:"main";src:url(../Fonts/main.ttf);}',
    'body{font-family:main,emoji,sym;}',
    'h3{font-family:ch2,emoji,sym;}',
    '.cut{font-family:ch1,emoji,sym;}',
    '.toc a{font-family:ctt1,emoji,sym;}',
    '.illus1{font-family:illus1;}',
    'nav,nav *{font-family:initial !important;}',
  ].join('');
  const out = rewriteCss(css);
  // 旧 @font-face 全删
  assert.ok(!/font-family:"ch2"/.test(out) || /Source Han/.test(out), 'ch2 @font-face 应删');
  assert.ok(!out.includes('Fonts/ch2.ttf') && !out.includes('Fonts/main.ttf'), '旧字体 url 应删');
  // 新 3 @font-face
  assert.ok(out.includes('SourceHanSerifSC-Regular.subset.otf'), '缺新 Regular @font-face');
  assert.ok(out.includes('SourceHanSerifSC-Bold.subset.otf'), '缺新 Bold @font-face');
  assert.ok(out.includes('SourceHanSansSC-Bold.subset.otf'), '缺新 Sans @font-face');
  // family 重映射
  assert.match(out, /body\{font-family:"Source Han Serif SC"\}/);
  assert.match(out, /h3\{font-family:"Source Han Serif SC Bold"\}/);
  assert.match(out, /\.cut\{font-family:"Source Han Sans SC Bold"\}/);
  assert.match(out, /\.toc a\{font-family:"Source Han Serif SC Bold"\}/);
  // 孤儿 .illus1 的 font-family 删除
  assert.ok(!/illus1;|font-family:illus1/.test(out), '.illus1 孤儿 font-family 应删');
  // initial 保留
  assert.match(out, /font-family:initial/);
  // emoji/sym fallback 去除
  assert.ok(!/emoji|sym/.test(out.replace(/Source Han[^"]*/g, '')), 'emoji/sym fallback 应去除');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test --test-reporter=spec 'test/unit/yimei-seikatsu/font-subset.test.js'`
Expected: FAIL（`rewriteCss` 未定义）。

- [ ] **Step 3: 实现 rewriteCss**

```js
const FAMILY_OF = {
  main: 'serif', ch3: 'serif', sum: 'serif', mes: 'serif', note: 'serif', cont: 'serif', int: 'serif', title: 'serif',
  ch2: 'serifBold', ctt1: 'serifBold', ctt2: 'serifBold',
  ch1: 'sans',
};
const FAMILY_NAME = {
  serif: '"Source Han Serif SC"',
  serifBold: '"Source Han Serif SC Bold"',
  sans: '"Source Han Sans SC Bold"',
};
const NEW_FONTFACE =
  '@font-face{font-family:"Source Han Serif SC";src:url(../Fonts/SourceHanSerifSC-Regular.subset.otf);}' +
  '@font-face{font-family:"Source Han Serif SC Bold";font-weight:700;src:url(../Fonts/SourceHanSerifSC-Bold.subset.otf);}' +
  '@font-face{font-family:"Source Han Sans SC Bold";font-weight:700;src:url(../Fonts/SourceHanSansSC-Bold.subset.otf);}';

export function rewriteCss(cssText) {
  // 1. 删所有旧 @font-face 块
  let css = cssText.replace(/@font-face\s*\{[^}]*\}/g, '');
  // 2. 重映射 font-family 声明
  css = css.replace(/font-family\s*:\s*([^;}]+)([;}])/g, (m, value, end) => {
    const first = value.split(',')[0].trim().replace(/["']/g, '');
    if (first === 'initial' || first === 'inherit') return m;
    if (FAMILY_OF[first]) return `font-family:${FAMILY_NAME[FAMILY_OF[first]]}${end}`;
    // 孤儿（illus*/num/emoji/sym/未知）：删除该声明
    return end === ';' ? '' : end;
  });
  // 3. 头部插入 3 个新 @font-face
  return NEW_FONTFACE + css;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test --test-reporter=spec 'test/unit/yimei-seikatsu/font-subset.test.js'`
Expected: PASS（含新 rewriteCss 测试）。

- [ ] **Step 5: Commit**

```bash
git add src/core/font-subset.js test/unit/yimei-seikatsu/font-subset.test.js
git commit -m "feat(font-subset): CSS 重写为真实思源命名+删旧字体/孤儿引用"
```

---

## Task 4: font-subset.js — 子集化 + IO 适配器

**Files:**
- Modify: `src/core/font-subset.js`
- Modify: `test/unit/yimei-seikatsu/font-subset.test.js`

- [ ] **Step 1: 追加失败测试（applyToFiles 端到端）**

```js
import { applyToFiles, NEW_FONTS } from '../../../src/core/font-subset.js';
import * as opentype from '../../../node_modules/opentype.js/dist/opentype.mjs';

test('applyToFiles: 删旧字体、写 3 思源子集、重写 CSS，且标题字零缺', async () => {
  const files = {
    'OEBPS/Text/chapter0001.xhtml': Buffer.from('<h3>序幕假日</h3><p>正文甲乙丙</p>'),
    'OEBPS/Text/TOC.xhtml': Buffer.from('<h3 class="ctt">目录</h3><a href="x">序幕假日</a>'),
    'OEBPS/Fonts/ch2.ttf': Buffer.from('OLD'),
    'OEBPS/Fonts/main.ttf': Buffer.from('OLD'),
    'OEBPS/Styles/necessary.css': Buffer.from('@font-face{font-family:"ch2";src:url(../Fonts/ch2.ttf);}h3{font-family:ch2,emoji,sym;}body{font-family:main,emoji,sym;}'),
  };
  await applyToFiles(files);
  // 旧字体删除
  assert.ok(!files['OEBPS/Fonts/ch2.ttf'] && !files['OEBPS/Fonts/main.ttf'], '旧字体应删');
  // 新字体写入
  const boldFile = `OEBPS/Fonts/${NEW_FONTS.find(f=>f.role==='bold').file}`;
  const regFile = `OEBPS/Fonts/${NEW_FONTS.find(f=>f.role==='regular').file}`;
  assert.ok(files[boldFile] && files[regFile], '应写入新思源子集字体');
  // CSS 重写
  assert.match(files['OEBPS/Styles/necessary.css'].toString(), /Source Han Serif SC Bold/);
  // 标题字「幕」在 bold 子集里零缺（关键回归点）
  const b = files[boldFile];
  const f = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset+b.byteLength));
  for (const c of '序幕假日目录') assert.notStrictEqual(f.charToGlyphIndex(c), 0, `bold 子集缺字 ${c}`);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test --test-reporter=spec 'test/unit/yimei-seikatsu/font-subset.test.js'`
Expected: FAIL（`applyToFiles` 未定义）。

- [ ] **Step 3: 实现 subsetAll + applyToFiles + applyToDir**

```js
async function subsetOne(srcPath, set) {
  if (!set.size) return null;
  const buf = fs.readFileSync(srcPath);
  return subsetFont(buf, [...set].join(''), { targetFormat: 'sfnt' });
}

export async function subsetAll(charsets, sources = SOURCE_FONTS) {
  return {
    regular: await subsetOne(sources.serifRegular, charsets.regular),
    bold: await subsetOne(sources.serifBold, charsets.bold),
    sans: await subsetOne(sources.sansBold, charsets.sans),
  };
}

const FONTS_RE = /(^|\/)OEBPS\/Fonts\//;
const CSS_RE = /OEBPS\/Styles\/.*\.css$/;
const XHTML_RE = /OEBPS\/Text\/.*\.xhtml$/;

export async function applyToFiles(files, sources = SOURCE_FONTS) {
  const xhtmlList = Object.keys(files)
    .filter((n) => XHTML_RE.test(n))
    .map((n) => ({ name: n, text: files[n].toString('utf8') }));
  const fonts = await subsetAll(extractCharsets(xhtmlList), sources);
  for (const n of Object.keys(files)) if (FONTS_RE.test(n)) delete files[n];
  for (const def of NEW_FONTS) {
    if (fonts[def.role]) files[`OEBPS/Fonts/${def.file}`] = fonts[def.role];
  }
  for (const n of Object.keys(files)) if (CSS_RE.test(n)) files[n] = Buffer.from(rewriteCss(files[n].toString('utf8')));
  return fonts;
}

export async function applyToDir(oebpsDir, sources = SOURCE_FONTS) {
  const textDir = path.join(oebpsDir, 'Text');
  const fontsDir = path.join(oebpsDir, 'Fonts');
  const stylesDir = path.join(oebpsDir, 'Styles');
  const xhtmlList = fs.readdirSync(textDir)
    .filter((f) => f.endsWith('.xhtml'))
    .map((f) => ({ name: `OEBPS/Text/${f}`, text: fs.readFileSync(path.join(textDir, f), 'utf8') }));
  const fonts = await subsetAll(extractCharsets(xhtmlList), sources);
  for (const f of fs.readdirSync(fontsDir)) fs.rmSync(path.join(fontsDir, f));
  for (const def of NEW_FONTS) {
    if (fonts[def.role]) fs.writeFileSync(path.join(fontsDir, def.file), fonts[def.role]);
  }
  for (const f of fs.readdirSync(stylesDir)) {
    if (!f.endsWith('.css')) continue;
    const p = path.join(stylesDir, f);
    fs.writeFileSync(p, rewriteCss(fs.readFileSync(p, 'utf8')), 'utf8');
  }
  return fonts;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test --test-reporter=spec 'test/unit/yimei-seikatsu/font-subset.test.js'`
Expected: PASS（4 个测试全通过，含「bold 子集零缺字」）。

- [ ] **Step 5: Commit**

```bash
git add src/core/font-subset.js test/unit/yimei-seikatsu/font-subset.test.js
git commit -m "feat(font-subset): 子集化 + applyToFiles/applyToDir 适配器"
```

---

## Task 5: 集成 11/12/13 管线（lightnovel-html）+ U+223C 规范化

**Files:**
- Modify: `books/yimei-seikatsu/lightnovel-html/index.js:402`（mediaTypeFor 加 .otf）
- Modify: `books/yimei-seikatsu/lightnovel-html/index.js:810`（simplifyText 加 U+223C→U+FF5E）
- Modify: `books/yimei-seikatsu/lightnovel-html/index.js:~1185`（集成 applyToFiles）

- [ ] **Step 1: mediaTypeFor 加 .otf**

在 `mediaTypeFor`（L402 `.ttf` 分支后）追加：
```js
  if (name.endsWith('.ttf')) return 'font/ttf';
  if (name.endsWith('.otf')) return 'font/otf';
```

- [ ] **Step 2: simplifyText 加 U+223C 规范化**

L810-812 改为：
```js
export function simplifyText(input) {
  return toSimplified(String(input)).replace(/∼/g, '～');
}
```

- [ ] **Step 3: import font-subset**

文件顶部 import 区（L6 `import { readEpub, writeEpub } ...` 附近）加：
```js
import { applyToFiles } from '../../../src/core/font-subset.js';
```

- [ ] **Step 4: 在 manifest 扫描前调用 applyToFiles**

定位 `const imageItems = [];`（L1185）之前插入一行（此时所有 Text/*.xhtml 已 addText 进 files，字体仍是 styleRef 旧字体）：
```js
  await applyToFiles(files);

  const imageItems = [];
```

- [ ] **Step 5: 跑现有单测确认管线未破**

Run: `node --test --test-reporter=spec 'test/unit/yimei-seikatsu/lightnovel-html.test.js'`
Expected: PASS（若个别测试断言旧字体名/文件，按新行为更新断言——仅限因字体重命名引起的预期变化）。

- [ ] **Step 6: Commit**

```bash
git add books/yimei-seikatsu/lightnovel-html/index.js
git commit -m "feat(lightnovel): 集成思源子集替换 + .otf media-type + U+223C 规范化"
```

---

## Task 6: 集成 09 管线（migrate-epub）

**Files:**
- Modify: `books/yimei-seikatsu/migrate/migrate-epub.js:658`（buildManifest media-type 加 .otf）
- Modify: `books/yimei-seikatsu/migrate/migrate-epub.js:~641`（buildManifest 调用前集成 applyToDir）

- [ ] **Step 1: buildManifest media-type 加 .otf**

L658 mediaTypes 对象里 `.ttf` 后追加：
```js
    '.js': 'application/javascript', '.ttf': 'font/ttf', '.otf': 'font/otf',
```

- [ ] **Step 2: import font-subset**

文件顶部 import 区加：
```js
import { applyToDir } from '../../../src/core/font-subset.js';
```

- [ ] **Step 3: 在 buildManifest 前调用 applyToDir**

L641（`// 扫 manifest + spine + 写 opf` 之前）插入（此时全部 xhtml 已写入 buildDir/OEBPS/Text）：
```js
  // 字体开源化：删旧子集字体、写思源子集、重写 CSS（manifest 随后自动扫描）
  await applyToDir(join(buildDir, 'OEBPS'));

  // 扫 manifest + spine + 写 opf
  const manifestItems = await buildManifest(join(buildDir, 'OEBPS'));
```

- [ ] **Step 4: Commit**

```bash
git add books/yimei-seikatsu/migrate/migrate-epub.js
git commit -m "feat(migrate): 集成思源子集替换 + .otf media-type"
```

---

## Task 7: 重新生成 09 + 更新 e2e golden

**Files:**
- Modify: `test/fixtures/yimei09/golden-manifest.json`

- [ ] **Step 1: 跑 09 migrate 生成新产物**

Run（参数同 e2e，输出到临时位置不污染 output/）：
```bash
node bin/cli.js migrate-translation \
  --src "/Users/liuzhuo/Downloads/资源/义妹生活/义妹生活 - 09台简粗糙排版.epub" \
  --dst "/Users/liuzhuo/Downloads/资源/义妹生活/[三河ごーすと].义妹生活.09.[日翻].epub" \
  --ref "/Users/liuzhuo/Downloads/资源/义妹生活/[三河ごーすと].义妹生活.07.[台简].epub" \
  --out /tmp/yimei09-newfont.epub
```
Expected: 生成成功，`/tmp/yimei09-newfont.epub` 的 OEBPS/Fonts 只含 3 个思源子集 otf。

- [ ] **Step 2: 校验产物零缺字（标题/目录/正文）**

Run（用项目已有审计手法对新产物检查；缺字应为 0）：
```bash
node /tmp/coverage-audit-newfont.mjs   # 见下方脚本
```
脚本 `/tmp/coverage-audit-newfont.mjs`：解开 `/tmp/yimei09-newfont.epub`，按 h3→bold子集 / body→regular子集 / .cut→sans子集 校验各部位用字在对应思源子集字体里 `charToGlyphIndex !== 0`。Expected: 各部位缺字 0。

- [ ] **Step 3: 重新生成 golden manifest**

Run（用既有脚本，对照其参数）：
```bash
node test/scripts/build-golden-manifest.mjs   # 若需指定输入产物，按脚本现有约定传参
```
确认 `test/fixtures/yimei09/golden-manifest.json` 的 `OEBPS/Fonts/*`、`OEBPS/Styles/*.css`、`OEBPS/content.opf` 条目更新为思源字体与新 CSS。

- [ ] **Step 4: 跑 09 e2e 确认通过**

Run: `node --test --test-reporter=spec 'test/e2e/migrate-translation.e2e.test.js'`
Expected: PASS（normalized hash 100% 一致）。

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/yimei09/golden-manifest.json
git commit -m "test: 更新 09 golden 为思源开源字体产物"
```

---

## Task 8: 全量测试 + 重新生成 11/12/13 成品并审计

**Files:** 无源码改动（生成产物在 `output/`，已 gitignore）

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: 全部 PASS。若有因字体重命名失败的旧断言，定位并更新为新行为（仅限字体相关预期）。

- [ ] **Step 2: 重新生成 11/12/13 台简（正文版 + 特典版）**

11/12 卷走 batch（`runBatch` 默认 `volumes:['11','12']`、`creditName:'嘻嘻嘻'`，自动从 `output/hyread`+`output/healed` 解析输入、输出 `output/simple`、自动备份、一次产出正文版与特典版）：
```bash
node bin/cli.js build-yimei-simple
```
13 卷走单卷 `hyread-to-simple`（特典版 `--include-specials`，正文版加 `--no-include-specials` 且 `--out` 去掉 `[特典]`）：
```bash
# 特典版
node bin/cli.js hyread-to-simple \
  --source "output/hyread/[三河ごーすと].义妹生活.13.[台繁].hyread.epub" \
  --ref    "[三河ごーすと].义妹生活.13.[日翻].epub" \
  --style-ref "output/healed/[三河ごーすと].义妹生活.13.[日翻].healed.epub" \
  --out    "output/simple/[三河ごーすと].义妹生活.13.[台简][特典].epub" \
  --volume 13 --include-specials --credit-name 嘻嘻嘻
# 正文版（同上，--out 去 [特典]，关特典）
node bin/cli.js hyread-to-simple --source "output/hyread/[三河ごーすと].义妹生活.13.[台繁].hyread.epub" \
  --ref "[三河ごーすと].义妹生活.13.[日翻].epub" --style-ref "output/healed/[三河ごーすと].义妹生活.13.[日翻].healed.epub" \
  --out "output/simple/[三河ごーすと].义妹生活.13.[台简].epub" --volume 13 --no-include-specials --credit-name 嘻嘻嘻
```
> 注：以上命令形态取自 `src/entries/hyread-to-simple.js` 头部 usage 与 `lightnovel-html-simple-batch.js:runBatch`；若 13 卷上次是经 batch 产出，可改为给 `runBatch` 传 `volumes:['11','12','13']`。
Expected: 6 个 epub 重新生成到 `output/simple/`，各自 OEBPS/Fonts 只含 3 个思源子集 otf。

- [ ] **Step 3: 覆盖审计 7 个成品（含 09）**

Run:
```bash
node /tmp/coverage-audit-all.mjs   # 遍历 09/11/12/13 成品，按部位→子集字体校验零缺字
```
Expected: 7 个成品全部「标题/目录/简介/正文缺字 = 0」；12 卷无 U+223C 残留。

- [ ] **Step 4: 结构与体积检查**

Run:
```bash
for f in output/simple/*.epub output/translated/*.translated.epub; do
  echo "== $f =="
  unzip -l "$f" | grep -E "Fonts/" 
done
```
Expected: 每本仅 3 个 `SourceHan*.subset.otf`，无 ch/ctt/sum/mes/note/main/emoji/sym/int；每本字体合计 < 2MB。CSS 内无旧字体名/孤儿 @font-face。

- [ ] **Step 5: Commit（仅审计脚本，如纳入仓库）**

```bash
# 成品不入库（output/ 已 gitignore）；若把审计脚本固化到 test/scripts 则提交
git add -A && git commit -m "chore: 字体开源化产物审计脚本" || echo "无需提交"
```

---

## Self-Review

**Spec coverage：**
- 缺字根因/3 字体归并 → Task 2-4（font-subset 模块）✓
- 真实思源命名 + CSS 全重映射 + 删旧字体/孤儿/emoji·sym → Task 3 rewriteCss ✓
- 按卷子集化 → Task 4 subsetAll ✓
- 两条管线集成 → Task 5（lightnovel）、Task 6（migrate）✓
- ch1 黑体字重定稿 → Task 1 Step 3 ✓
- U+223C 规范化 → Task 5 Step 2 ✓
- golden 更新 → Task 7 ✓
- 重新生成 7 成品 + 零缺字验收 → Task 8 ✓
- 体积 < 2MB → Task 8 Step 4 ✓

**Placeholder scan：** Task 8 Step 2 的逐卷生成命令与 Task 7 Step 3 的 golden 脚本传参，需执行者对照上次生成 `output/simple` 的真实命令补全（命令形态已给，仅参数因历史命令而定）。其余步骤含完整代码。

**Type consistency：** `extractCharsets`→`{regular,bold,sans}`、`subsetAll`→`{regular,bold,sans}`、`NEW_FONTS[].role` 三处 role 名一致；`applyToFiles`/`applyToDir` 同签名风格；`FAMILY_OF`/`FAMILY_NAME` token 与 spec 映射表一致。
