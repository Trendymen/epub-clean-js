# EPUB Pipeline 拆分 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 来按任务推进本计划。步骤使用 checkbox（`- [ ]`）追踪。

**Goal：** 把 `epub-clean-js/` 当前单层 src/ 重组为 `src/core/ + src/entries/ + books/yimei-seikatsu/` 三层架构，4 个 stage（strip/deobfuscate/heal/align）显式拆分，对应 4 个 npm script，core 0 书特定字符串。

**Architecture：** Pipeline 阶段化。所有处理是 `(EpubBuffer, ctx) => EpubBuffer` 的纯函数 stage，stages 在内存里 reduce，仅 entry 顶层落盘。书特定数据通过 `ctx.profile` 注入到 align stage。

**Tech Stack：** Node 22+ ESM、`yauzl-promise` / `yazl` / `fast-xml-parser`（已装）。无新增依赖。

**对应 Spec：** `docs/superpowers/specs/2026-05-22-epub-pipeline-split-design.md`

**Git 备注：** 项目所在目录非 git 仓库。**"commit" 步骤替代为「跑该 task 的内联验证 + ok 后进下一个 task」**。最终回退点是 T0 备份的 `src.bak/`。

**测试策略适配：** 不引入 pytest/vitest。每个 task 实现后立刻用 `node -e "..."` 或 `node epub-clean-js/src/...` 跑一段集成验证，对照预期输出。最终 T21 端到端跑 4 个 npm script + diff 与现有 `unlocked/clean/` 产物。

---

## File Structure

新结构（参考 spec §6）：

```
epub-clean-js/
├── package.json                       # 4 npm scripts
├── .gitignore                          # 不动
├── books/
│   └── yimei-seikatsu/
│       └── profile.js                  # T14
└── src/
    ├── core/
    │   ├── constants.js                # T2
    │   ├── pipeline.js                 # T8
    │   ├── zip-io.js                   # T5
    │   ├── opf.js                      # T6
    │   ├── patchers.js                 # T4
    │   ├── paths.js                    # T3
    │   ├── validator.js                # T7
    │   └── stages/
    │       ├── index.js                # T13
    │       ├── strip.js                # T9
    │       ├── deobfuscate.js          # T10
    │       ├── heal.js                 # T11
    │       └── align.js                # T12
    └── entries/
        ├── strip.js                    # T15
        ├── heal.js                     # T16
        ├── align.js                    # T17
        └── all.js                      # T18
```

旧文件（T19 重命名为 .bak，T22 验证后删）：
- `src/{config,index,strip,process,opf,patchers,paths,validator,zip-io}.js`

---

## Pre-Tasks（前置）

- [ ] **Pre-1：确认当前能跑通 + 5 卷原始 epub 在位**

Run:
```bash
ls "/Users/liuzhuo/Downloads/义妹生活"/'[三河ごーすと].义妹生活.'{11,12,13,14,15}'.[日翻].epub' 2>&1 | grep -c epub
```
Expected: `5`

- [ ] **Pre-2：当前产物快照备份（diff 基准）**

Run:
```bash
mkdir -p /tmp/epub-baseline && cp -a "/Users/liuzhuo/Downloads/义妹生活/unlocked/clean" /tmp/epub-baseline/
ls /tmp/epub-baseline/clean/
```
Expected: 5 个 `.clean.epub` 文件列出

---

### Task 0：备份当前 src/

**Files:**
- Backup: `epub-clean-js/src/` → `epub-clean-js/src.bak0/`

- [ ] **Step 1: 整目录备份**

```bash
cd "/Users/liuzhuo/Downloads/义妹生活/epub-clean-js"
cp -a src src.bak0
ls src.bak0/
```
Expected: 列出当前 9 个 src/*.js 文件

- [ ] **Step 2: 验证备份完整**

```bash
diff -r src src.bak0 && echo "备份与原 src/ 完全一致"
```
Expected: 输出「备份与原 src/ 完全一致」

---

### Task 1：建新目录骨架

**Files:**
- Create: `epub-clean-js/src/core/`
- Create: `epub-clean-js/src/core/stages/`
- Create: `epub-clean-js/src/entries/`
- Create: `epub-clean-js/books/yimei-seikatsu/`

- [ ] **Step 1: mkdir**

```bash
cd "/Users/liuzhuo/Downloads/义妹生活/epub-clean-js"
mkdir -p src/core/stages src/entries books/yimei-seikatsu
```

- [ ] **Step 2: 验证**

```bash
find src/core src/entries books -type d | sort
```
Expected:
```
books/yimei-seikatsu
src/core
src/core/stages
src/entries
```

---

### Task 2：写 src/core/constants.js

**Files:**
- Create: `epub-clean-js/src/core/constants.js`

- [ ] **Step 1: 创建文件**

```js
// src/core/constants.js
export const OPF_NS = "http://www.idpf.org/2007/opf";
export const DC_NS = "http://purl.org/dc/elements/1.1/";
export const XLINK_NS = "http://www.w3.org/1999/xlink";
export const XHTML_NS = "http://www.w3.org/1999/xhtml";
export const EPUB_NS = "http://www.idpf.org/2007/ops";
export const CONTAINER_NS = "urn:oasis:names:tc:opendocument:xmlns:container";

export const MIME2EXT = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "font/ttf": ".ttf",
  "font/otf": ".otf",
  "application/font-sfnt": ".ttf",
  "application/vnd.ms-opentype": ".otf",
  "text/css": ".css",
  "application/javascript": ".js",
  "text/javascript": ".js",
  "application/xhtml+xml": ".xhtml",
  "application/x-dtbncx+xml": ".ncx",
};

export const SKIP_NAMES = new Set([
  "META-INF/encryption.xml",
  "META-INF/zhangyue-expansion.xml",
]);

export const TEXT_EXTS = new Set([".xhtml", ".html", ".ncx", ".css", ".opf"]);
```

- [ ] **Step 2: 语法验证**

```bash
node --check epub-clean-js/src/core/constants.js && echo OK
```
Expected: `OK`

- [ ] **Step 3: import 验证**

```bash
cd epub-clean-js && node -e "import('./src/core/constants.js').then(m => console.log(Object.keys(m).length, 'exports'))"
```
Expected: `9 exports`（OPF_NS/DC_NS/XLINK_NS/XHTML_NS/EPUB_NS/CONTAINER_NS/MIME2EXT/SKIP_NAMES/TEXT_EXTS）

---

### Task 3：移 src/paths.js → src/core/paths.js

**Files:**
- Create: `epub-clean-js/src/core/paths.js`

- [ ] **Step 1: 复制并改路径**

```bash
cp epub-clean-js/src/paths.js epub-clean-js/src/core/paths.js
```

- [ ] **Step 2: 内容不动（paths.js 无外部依赖），验证**

```bash
cd epub-clean-js && node -e "
import('./src/core/paths.js').then(m => {
  console.log(m.unquoteRecursive('Images/%2A.webp'));
  console.log(m.remapPath('../Styles/foo.css', {}, 'Text'));
});
"
```
Expected:
```
Images/*.webp
../Styles/foo.css
```

---

### Task 4：移 src/patchers.js → src/core/patchers.js

**Files:**
- Create: `epub-clean-js/src/core/patchers.js`

- [ ] **Step 1: 复制（patchers.js import './paths.js' 是相对路径，迁后同目录依然命中）**

```bash
cp epub-clean-js/src/patchers.js epub-clean-js/src/core/patchers.js
```

- [ ] **Step 2: 验证 import 链通**

```bash
cd epub-clean-js && node -e "
import('./src/core/patchers.js').then(m => {
  const out = m.patchXhtml('<a href=\"foo\"/>', {}, '');
  console.log(out);
});
"
```
Expected:
```
<a href="foo"/>
```
（无 mapping 命中，原样输出）

---

### Task 5：移 src/zip-io.js → src/core/zip-io.js

**Files:**
- Create: `epub-clean-js/src/core/zip-io.js`
- Modify: import 路径从 `./config.js` 改为 `./constants.js`

- [ ] **Step 1: 复制 + 改 import**

```bash
cp epub-clean-js/src/zip-io.js epub-clean-js/src/core/zip-io.js
# 把 import { SKIP_NAMES } from "./config.js"; 改成 ./constants.js
sed -i.tmp 's|from "./config.js"|from "./constants.js"|g' epub-clean-js/src/core/zip-io.js
rm epub-clean-js/src/core/zip-io.js.tmp
grep "from " epub-clean-js/src/core/zip-io.js
```
Expected: 显示的所有 import 行不含 `./config.js`，应含 `./constants.js`

- [ ] **Step 2: 跑通验证（读一个真实 epub）**

```bash
cd epub-clean-js && node -e "
import('./src/core/zip-io.js').then(async m => {
  const buf = await m.readEpub('/Users/liuzhuo/Downloads/义妹生活/[三河ごーすと].义妹生活.13.[日翻].epub');
  console.log('entries=', buf.names.length, ', has-mimetype=', !!buf.entries['mimetype']);
});
"
```
Expected: `entries= 数字 , has-mimetype= true`（entries 数 > 50）

---

### Task 6：写 src/core/opf.js（仅 parse* 系列）

**Files:**
- Create: `epub-clean-js/src/core/opf.js`

**说明：** 从 `src/opf.js` 抽 `parseContainer / parseOpf / patchOpfManifest / serializeOpf`。`patchOpfMetadata` **不**搬到这里 — 它将被拆成 heal/align 两个 stage 分别实现。`makeNode/getAttr/findFirst/findDirectChildren/tagOf/childrenOf` 等内部工具函数保留在 opf.js（被 stages 复用）。

- [ ] **Step 1: 创建 opf.js**

```js
// src/core/opf.js
import path from "node:path/posix";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { MIME2EXT } from "./constants.js";
import { unquoteRecursive } from "./paths.js";

const PARSER_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: "",
  preserveOrder: true,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: false,
  parseTagValue: false,
};

const parser = new XMLParser(PARSER_OPTS);
const builder = new XMLBuilder({
  ...PARSER_OPTS,
  format: false,
  suppressEmptyNode: false,
});

// ============ 内部工具（被 stages 复用，统一从 opf.js 导出）============

export function tagOf(node) {
  for (const k of Object.keys(node)) if (k !== ":@") return k;
  return null;
}

export function childrenOf(node) {
  const t = tagOf(node);
  return t ? node[t] : [];
}

export function getAttr(node, name) {
  return node[":@"]?.[name];
}

export function setAttr(node, name, value) {
  node[":@"] ??= {};
  node[":@"][name] = value;
}

export function findFirst(nodes, tagName) {
  for (const n of nodes) {
    if (tagOf(n) === tagName) return n;
    const t = tagOf(n);
    if (t && Array.isArray(n[t])) {
      const r = findFirst(n[t], tagName);
      if (r) return r;
    }
  }
  return null;
}

export function findDirectChildren(node, tagName) {
  const kids = childrenOf(node);
  return Array.isArray(kids) ? kids.filter((k) => tagOf(k) === tagName) : [];
}

export function makeNode(tag, attrs = {}, text = null) {
  const node = { [tag]: text === null ? [] : [{ "#text": text }] };
  if (Object.keys(attrs).length) node[":@"] = { ...attrs };
  return node;
}

export function setText(node, text) {
  const t = tagOf(node);
  if (!t) return;
  node[t] = [{ "#text": text }];
}

// ============ 解析 + 序列化 ============

export function parseContainer(xmlText) {
  const doc = parser.parse(xmlText);
  const container = findFirst(doc, "container");
  if (!container) throw new Error("container.xml 缺少 <container>");
  const rootfile = findFirst(childrenOf(container), "rootfile");
  if (!rootfile) throw new Error("container.xml 缺少 <rootfile>");
  return getAttr(rootfile, "full-path");
}

export function parseOpf(opfText) {
  const tree = parser.parse(opfText);
  const pkg = findFirst(tree, "package");
  if (!pkg) throw new Error("OPF 缺少 <package>");
  const manifest = findFirst(childrenOf(pkg), "manifest");
  if (!manifest) throw new Error("OPF 缺少 <manifest>");

  const mapping = {};
  for (const item of findDirectChildren(manifest, "item")) {
    const rawHref = getAttr(item, "href");
    if (!rawHref) continue;
    const decoded = unquoteRecursive(rawHref);
    let itemId = getAttr(item, "id");
    const mime = getAttr(item, "media-type") ?? "";
    const props = (getAttr(item, "properties") ?? "").split(/\s+/);

    if (props.includes("nav")) {
      itemId = "nav.xhtml";
    } else {
      const baseName = path.basename(itemId);
      if (!baseName.includes(".")) {
        itemId = itemId + (MIME2EXT[mime] ?? "");
      }
    }
    const dirName = path.dirname(decoded);
    const newHref = dirName && dirName !== "." ? `${dirName}/${itemId}` : itemId;
    mapping[decoded] = newHref;
  }

  return { tree, pkg, mapping };
}

export function patchOpfManifest(pkg, mapping) {
  const manifest = findFirst(childrenOf(pkg), "manifest");
  if (manifest) {
    for (const item of findDirectChildren(manifest, "item")) {
      const raw = getAttr(item, "href");
      if (!raw) continue;
      const decoded = unquoteRecursive(raw);
      if (mapping[decoded]) setAttr(item, "href", mapping[decoded]);
    }
  }
  const guide = findFirst(childrenOf(pkg), "guide");
  if (guide) {
    for (const ref of findDirectChildren(guide, "reference")) {
      const raw = getAttr(ref, "href");
      if (!raw) continue;
      const decoded = unquoteRecursive(raw);
      const [p, frag] = decoded.split("#");
      if (mapping[p]) {
        const newHref = mapping[p] + (frag !== undefined ? "#" + frag : "");
        setAttr(ref, "href", newHref);
      }
    }
  }
}

export function serializeOpf(tree) {
  const body = builder.build(tree);
  return body.startsWith("<?xml")
    ? body
    : '<?xml version="1.0" encoding="utf-8"?>\n' + body;
}
```

- [ ] **Step 2: 注册命名空间（在 module 顶层副作用）**

继续在 opf.js 顶部 import 后加：

```js
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import * as ETStub from "node:util"; // 占位避免误删（实际不需要 ET）
```

等等 — 上面 import 已经够用，命名空间注册在 fast-xml-parser preserveOrder 模式下不需要。这是 ET（Python ElementTree）特有的，Node 项目此处不需要这一步。**不要加这行**。

`opf.js` 最终的 import 头只需要：

```js
import path from "node:path/posix";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { MIME2EXT } from "./constants.js";
import { unquoteRecursive } from "./paths.js";
```

- [ ] **Step 3: 跑通验证**

```bash
cd epub-clean-js && node -e "
import('./src/core/opf.js').then(async (m) => {
  const { readEpub } = await import('./src/core/zip-io.js');
  const buf = await readEpub('/Users/liuzhuo/Downloads/义妹生活/[三河ごーすと].义妹生活.13.[日翻].epub');
  const opfPath = m.parseContainer(buf.entries['META-INF/container.xml'].toString('utf-8'));
  const { mapping } = m.parseOpf(buf.entries[opfPath].toString('utf-8'));
  const navTarget = Object.values(mapping).find(v => v.endsWith('nav.xhtml'));
  console.log('opfPath=', opfPath, 'mappingSize=', Object.keys(mapping).length, 'navTarget=', navTarget);
});
"
```
Expected:
```
opfPath= OEBPS/content.opf mappingSize= 数字 navTarget= Text/nav.xhtml
```

---

### Task 7：移 src/validator.js → src/core/validator.js + 加第 9 项验证

**Files:**
- Create: `epub-clean-js/src/core/validator.js`

**说明：** 复制原 validator.js，导入路径改为同目录，加第 9 项检查（CSS 文本无字面 `*|?` 字符）。

- [ ] **Step 1: 复制并改 import**

```bash
cp epub-clean-js/src/validator.js epub-clean-js/src/core/validator.js
sed -i.tmp 's|from "./patchers.js"|from "./patchers.js"|g; s|from "./zip-io.js"|from "./zip-io.js"|g' epub-clean-js/src/core/validator.js
rm epub-clean-js/src/core/validator.js.tmp
```

- [ ] **Step 2: 加第 9 项检查（CSS 文本无字面 *|? 字符）**

在 `src/core/validator.js` 第 7 项「文件名无 *|? 字面字符」**前**插入新的第 7 项（原 7 → 8、原 8 → 9）。

打开 `src/core/validator.js`，找这一段：

```js
        // 7. 文件名无 *|? 字面字符
        for (const n of names) {
          if (hasBadChars(n)) issues.push(`文件名含混淆字符: ${n}`);
        }
```

在它之前插入：

```js
        // 7. CSS 文本无字面 *|? 字符（验证孤儿 @font-face 清理彻底）
        for (const n of names) {
          if (!n.endsWith(".css")) continue;
          const text = entries[n].toString("utf-8");
          if (/[*|?]/.test(text)) {
            issues.push(`${n}: CSS 文本含字面混淆字符 (孤儿 @font-face 未清理彻底)`);
          }
        }
```

然后把后面的注释 `// 7. 文件名无...` 改成 `// 8. 文件名无...`，原 `// 8. 孤儿文件...` 改成 `// 9. 孤儿文件...`。

- [ ] **Step 3: 验证修改后语法正确**

```bash
node --check epub-clean-js/src/core/validator.js && echo OK
```
Expected: `OK`

- [ ] **Step 4: 对一个已知含孤儿 @font-face 的 epub 跑（应触发第 7 项）**

```bash
cd epub-clean-js && node -e "
import('./src/core/validator.js').then(async m => {
  const r = await m.validateOutput('/Users/liuzhuo/Downloads/义妹生活/unlocked/clean/[三河ごーすと].义妹生活.15.[日翻].clean.epub');
  const cssIssue = r.issues.find(i => i.includes('CSS 文本含字面'));
  console.log('cssIssue=', cssIssue || '无');
});
"
```
Expected: 输出 `cssIssue= OEBPS/Styles/default.css: CSS 文本含字面混淆字符 (孤儿 @font-face 未清理彻底)` 或类似（说明检查在工作 — 当前 clean.epub 还没经过 heal 清理）

---

### Task 8：写 src/core/pipeline.js

**Files:**
- Create: `epub-clean-js/src/core/pipeline.js`

- [ ] **Step 1: 创建 pipeline.js**

```js
// src/core/pipeline.js
//
// runPipeline(buf, stages, ctx) — async-aware reduce 执行器。
// stage 签名: (EpubBuffer, ctx) => EpubBuffer | Promise<EpubBuffer>

export async function runPipeline(buf, stages, ctx) {
  let cur = buf;
  for (const stage of stages) {
    cur = await stage(cur, ctx);
  }
  return cur;
}
```

- [ ] **Step 2: 验证**

```bash
cd epub-clean-js && node -e "
import('./src/core/pipeline.js').then(async m => {
  const out = await m.runPipeline(0, [
    (x) => x + 1,
    async (x) => x * 2,
    (x) => x - 3,
  ], {});
  console.log('result=', out);
});
"
```
Expected: `result= -1`（0 → 1 → 2 → -1）

---

### Task 9：写 src/core/stages/strip.js

**Files:**
- Create: `epub-clean-js/src/core/stages/strip.js`

- [ ] **Step 1: 创建 strip.js**

```js
// src/core/stages/strip.js
//
// strip stage：从 EpubBuffer 中删除 DRM/平台标识资源。
// 与 zip-io.writeEpub 的 SKIP_NAMES 行为一致，但显式做在 stage 层，
// 让「strip 已执行」这一事实在 pipeline 中显性化。
import { SKIP_NAMES } from "../constants.js";

export function strip(buf, _ctx) {
  const newNames = [];
  const newEntries = {};
  for (const name of buf.names) {
    if (SKIP_NAMES.has(name)) continue;
    newNames.push(name);
    newEntries[name] = buf.entries[name];
  }
  return { names: newNames, entries: newEntries };
}
```

- [ ] **Step 2: 验证**

```bash
cd epub-clean-js && node -e "
const { readEpub } = await import('./src/core/zip-io.js');
const { strip } = await import('./src/core/stages/strip.js');
const buf = await readEpub('/Users/liuzhuo/Downloads/义妹生活/[三河ごーすと].义妹生活.13.[日翻].epub');
const inHas = buf.names.filter(n => n.startsWith('META-INF/'));
const out = strip(buf, {});
const outHas = out.names.filter(n => n.startsWith('META-INF/'));
console.log('in:', inHas);
console.log('out:', outHas);
"
```
Expected: in 含 encryption.xml + zhangyue-expansion.xml + container.xml + com.apple.ibooks.display-options.xml；out 不含前两个。

---

### Task 10：写 src/core/stages/deobfuscate.js

**Files:**
- Create: `epub-clean-js/src/core/stages/deobfuscate.js`

**说明：** 从 `src/process.js` 抽核心反混淆逻辑，但**不**包含 patchOpfMetadata（那是 heal/align）。stage 内只做：
1. 解析 OPF + 建反混淆 mapping
2. patchOpfManifest（重写 href）
3. 遍历 entries：xhtml/ncx/css/opf 分派 patcher，二进制原样
4. 实体改名（mapping 命中的 entries 改路径）

并在 `buf.meta` 中暂存 `opfPath / opfDir / tree / mapping` 供后续 stage 复用，避免 heal 再次解析 OPF。

- [ ] **Step 1: 创建 deobfuscate.js**

```js
// src/core/stages/deobfuscate.js
import path from "node:path/posix";
import { Buffer } from "node:buffer";
import { parseContainer, parseOpf, patchOpfManifest, serializeOpf } from "../opf.js";
import { patchXhtml, patchNcx, patchCss } from "../patchers.js";

export function deobfuscate(buf, _ctx) {
  const containerXml = buf.entries["META-INF/container.xml"].toString("utf-8");
  const opfPath = parseContainer(containerXml);
  const opfDir = path.dirname(opfPath);
  const opfText = buf.entries[opfPath].toString("utf-8");
  const { tree, pkg, mapping } = parseOpf(opfText);

  patchOpfManifest(pkg, mapping);

  const newNames = [];
  const newEntries = {};
  for (const name of buf.names) {
    const data = buf.entries[name];
    const ext = path.extname(name).toLowerCase();

    let rel = null;
    if (opfDir && opfDir !== "." && name.startsWith(opfDir + "/")) {
      rel = name.slice(opfDir.length + 1);
    } else if (!opfDir || opfDir === ".") {
      rel = name;
    }

    let newName = name;
    if (rel !== null && mapping[rel]) {
      newName = opfDir && opfDir !== "." ? `${opfDir}/${mapping[rel]}` : mapping[rel];
    }

    let newData;
    if (ext === ".opf") {
      // 留给 heal/align 进一步改 metadata；此处先序列化 manifest 改完的状态
      newData = Buffer.from(serializeOpf(tree), "utf-8");
    } else if (ext === ".xhtml" || ext === ".html") {
      const base = rel ? path.dirname(rel) : path.dirname(name);
      newData = Buffer.from(
        patchXhtml(data.toString("utf-8"), mapping, base === "." ? "" : base),
        "utf-8",
      );
    } else if (ext === ".ncx") {
      const base = rel ? path.dirname(rel) : path.dirname(name);
      newData = Buffer.from(
        patchNcx(data.toString("utf-8"), mapping, base === "." ? "" : base),
        "utf-8",
      );
    } else if (ext === ".css") {
      const base = rel ? path.dirname(rel) : path.dirname(name);
      newData = Buffer.from(
        patchCss(data.toString("utf-8"), mapping, base || "Styles"),
        "utf-8",
      );
    } else {
      newData = data;
    }
    newNames.push(newName);
    newEntries[newName] = newData;
  }

  // 在 meta 里挂出 opf 信息，避免 heal/align 重复解析
  return {
    names: newNames,
    entries: newEntries,
    meta: { opfPath, opfDir, opfTree: tree, mapping },
  };
}
```

- [ ] **Step 2: 验证（跑 strip + deobfuscate 后看引用是否反混淆）**

```bash
cd epub-clean-js && node -e "
const { readEpub } = await import('./src/core/zip-io.js');
const { strip } = await import('./src/core/stages/strip.js');
const { deobfuscate } = await import('./src/core/stages/deobfuscate.js');
const buf = await readEpub('/Users/liuzhuo/Downloads/义妹生活/[三河ごーすと].义妹生活.15.[日翻].epub');
const out = deobfuscate(strip(buf, {}), {});
const opfRaw = out.entries[out.meta.opfPath].toString('utf-8');
console.log('hasPercent:', /%2A|%3A|%7C|%3F/.test(opfRaw));
console.log('hasCleanItem:', /href=\"Text\/chapter0001.xhtml\"/.test(opfRaw));
console.log('hasNav:', /href=\"Text\/nav.xhtml\"/.test(opfRaw));
"
```
Expected:
```
hasPercent: false
hasCleanItem: true
hasNav: true
```

---

### Task 11：写 src/core/stages/heal.js

**Files:**
- Create: `epub-clean-js/src/core/stages/heal.js`

**说明：** 从原 `patchOpfMetadata` 抽通用部分 + 实现孤儿 @font-face 清理。stage 复用 `buf.meta.opfTree`，不重新解析。

- [ ] **Step 1: 创建 heal.js**

```js
// src/core/stages/heal.js
import crypto from "node:crypto";
import path from "node:path/posix";
import { statSync } from "node:fs";
import { Buffer } from "node:buffer";
import {
  serializeOpf,
  findFirst,
  childrenOf,
  findDirectChildren,
  getAttr,
  setText,
  makeNode,
} from "../opf.js";
import { OPF_NS, DC_NS } from "../constants.js";

function patchMetadataCommon(pkg, srcPath) {
  const metadata = findFirst(childrenOf(pkg), "metadata");
  if (!metadata) return;
  const kids = childrenOf(metadata);

  // 1. 删 duokan/zhangyue identifier + 关联 refines
  const refinedIds = new Set();
  for (let i = kids.length - 1; i >= 0; i--) {
    const n = kids[i];
    if (Object.keys(n).find((k) => k !== ":@") === "dc:identifier") {
      const idv = getAttr(n, "id");
      if (idv === "duokan-book-id" || idv === "zhangyue-book-id") {
        refinedIds.add("#" + idv);
        kids.splice(i, 1);
      }
    }
  }
  for (let i = kids.length - 1; i >= 0; i--) {
    const n = kids[i];
    if (Object.keys(n).find((k) => k !== ":@") === "meta" && refinedIds.has(getAttr(n, "refines"))) {
      kids.splice(i, 1);
    }
  }

  // 2. BookId UUID
  const hasBookId = kids.some(
    (n) =>
      Object.keys(n).find((k) => k !== ":@") === "dc:identifier" &&
      getAttr(n, "id") === "BookId",
  );
  if (!hasBookId) {
    const stat = statSync(srcPath);
    const seed = `${path.basename(srcPath)}:${stat.size}`;
    const uid = crypto.createHash("md5").update(seed).digest("hex");
    kids.push(makeNode("dc:identifier", { id: "BookId" }, `urn:uuid:${uid}`));
  }

  // 3. dcterms:modified — 运行时今日 ISO
  const isoNow = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  let modifiedNode = kids.find(
    (n) =>
      Object.keys(n).find((k) => k !== ":@") === "meta" &&
      getAttr(n, "property") === "dcterms:modified",
  );
  if (!modifiedNode) {
    modifiedNode = makeNode("meta", { property: "dcterms:modified" }, isoNow);
    kids.push(modifiedNode);
  } else {
    setText(modifiedNode, isoNow);
  }

  // 4. <meta name="cover">（补缺）
  const hasCoverMeta = kids.some(
    (n) =>
      Object.keys(n).find((k) => k !== ":@") === "meta" &&
      getAttr(n, "name") === "cover",
  );
  if (!hasCoverMeta) {
    const manifest = findFirst(childrenOf(pkg), "manifest");
    if (manifest) {
      for (const item of findDirectChildren(manifest, "item")) {
        const mt = getAttr(item, "media-type") ?? "";
        const id = getAttr(item, "id") ?? "";
        if (mt.startsWith("image/") && id.toLowerCase().includes("cover")) {
          kids.push(makeNode("meta", { name: "cover", content: id }));
          break;
        }
      }
    }
  }
}

function sanitizeCssOrphanFontFace(cssText, cssZipPath, zipEntryNames) {
  return cssText.replace(/@font-face\s*\{[^}]*\}/g, (rule) => {
    const m = /url\(\s*([^)\s'"]+)\s*\)/.exec(rule);
    if (!m) return rule;
    const url = m[1];
    if (/^(data:|https?:|mailto:|tel:)/i.test(url)) return rule;
    if (!/[*|?]/.test(url)) return rule;
    const cssDir = path.dirname(cssZipPath);
    const resolved = path.normalize(path.join(cssDir, url));
    return zipEntryNames.has(resolved) ? rule : "";
  });
}

export function heal(buf, ctx) {
  const { opfPath, opfTree } = buf.meta;
  const pkg = findFirst(opfTree, "package");

  patchMetadataCommon(pkg, ctx.srcPath);

  // 序列化 OPF（heal 写入第一次，后续 align 可能再覆盖）
  const newEntries = { ...buf.entries };
  newEntries[opfPath] = Buffer.from(serializeOpf(opfTree), "utf-8");

  // 孤儿 @font-face 清理：遍历所有 *.css
  const zipNames = new Set(buf.names);
  for (const name of buf.names) {
    if (!name.toLowerCase().endsWith(".css")) continue;
    const before = newEntries[name].toString("utf-8");
    const after = sanitizeCssOrphanFontFace(before, name, zipNames);
    if (after !== before) {
      newEntries[name] = Buffer.from(after, "utf-8");
    }
  }

  return { ...buf, entries: newEntries };
}
```

- [ ] **Step 2: 验证孤儿 @font-face 清理（跑到 heal 看 default.css 行数变少）**

```bash
cd epub-clean-js && node -e "
const { readEpub } = await import('./src/core/zip-io.js');
const { runPipeline } = await import('./src/core/pipeline.js');
const { strip } = await import('./src/core/stages/strip.js');
const { deobfuscate } = await import('./src/core/stages/deobfuscate.js');
const { heal } = await import('./src/core/stages/heal.js');
const src = '/Users/liuzhuo/Downloads/义妹生活/[三河ごーすと].义妹生活.15.[日翻].epub';
const inBuf = await readEpub(src);
const out = await runPipeline(inBuf, [strip, deobfuscate, heal], { srcPath: src });
const css = out.entries['OEBPS/Styles/default.css'].toString('utf-8');
console.log('hasOrphanChar:', /[*|?]/.test(css));
console.log('@font-face count:', (css.match(/@font-face/g) || []).length);
"
```
Expected:
```
hasOrphanChar: false
@font-face count: 小于原来的数（原约 14，清理后约 7）
```

---

### Task 12：写 src/core/stages/align.js

**Files:**
- Create: `epub-clean-js/src/core/stages/align.js`

**说明：** 实现书特定贴标。读 `ctx.profile.metadataDefaults` 应用到 metadata。默认「已有则保留」（不覆盖原值）。

- [ ] **Step 1: 创建 align.js**

```js
// src/core/stages/align.js
import { Buffer } from "node:buffer";
import {
  serializeOpf,
  findFirst,
  childrenOf,
  getAttr,
  setText,
  makeNode,
} from "../opf.js";

function tagName(node) {
  for (const k of Object.keys(node)) if (k !== ":@") return k;
  return null;
}

function hasChild(kids, tag) {
  return kids.some((n) => tagName(n) === tag);
}

function applyMetadataDefaults(pkg, profile) {
  if (!profile || !profile.metadataDefaults) return;
  const md = profile.metadataDefaults;
  const metadata = findFirst(childrenOf(pkg), "metadata");
  if (!metadata) return;
  const kids = childrenOf(metadata);

  // dc:rights：缺则补，已有则保留
  if (md.rights && !hasChild(kids, "dc:rights")) {
    kids.push(makeNode("dc:rights", {}, md.rights));
  }
  // dc:publisher
  if (md.publisher && !hasChild(kids, "dc:publisher")) {
    kids.push(makeNode("dc:publisher", {}, md.publisher));
  }
  // dc:language
  if (md.language && !hasChild(kids, "dc:language")) {
    kids.push(makeNode("dc:language", {}, md.language));
  }
  // dc:contributor + file-as refines
  if (Array.isArray(md.contributors)) {
    for (const c of md.contributors) {
      const id = `contributor-${c.name}`.replace(/\s+/g, "-");
      kids.push(makeNode("dc:contributor", { id }, c.name));
      if (c.fileAs) {
        kids.push(makeNode("meta", { refines: "#" + id, property: "file-as" }, c.fileAs));
      }
      if (c.role) {
        kids.push(makeNode("meta", { refines: "#" + id, property: "role", scheme: "marc:relators" }, c.role));
      }
    }
  }
  // dcterms:modified 覆盖（heal 已写入今日 ISO，profile 可覆盖）
  if (md.modified && md.modified !== "auto") {
    const found = kids.find(
      (n) => tagName(n) === "meta" && getAttr(n, "property") === "dcterms:modified",
    );
    if (found) setText(found, md.modified);
  }
}

export function align(buf, ctx) {
  const { opfPath, opfTree } = buf.meta;
  const pkg = findFirst(opfTree, "package");

  applyMetadataDefaults(pkg, ctx.profile);

  const newEntries = { ...buf.entries };
  newEntries[opfPath] = Buffer.from(serializeOpf(opfTree), "utf-8");
  return { ...buf, entries: newEntries };
}
```

- [ ] **Step 2: 验证（注入 profile 后 OPF 含 dc:rights=voidlord）**

```bash
cd epub-clean-js && node -e "
const { readEpub } = await import('./src/core/zip-io.js');
const { runPipeline } = await import('./src/core/pipeline.js');
const { strip } = await import('./src/core/stages/strip.js');
const { deobfuscate } = await import('./src/core/stages/deobfuscate.js');
const { heal } = await import('./src/core/stages/heal.js');
const { align } = await import('./src/core/stages/align.js');
const src = '/Users/liuzhuo/Downloads/义妹生活/[三河ごーすと].义妹生活.15.[日翻].epub';
const inBuf = await readEpub(src);
const out = await runPipeline(inBuf, [strip, deobfuscate, heal, align], {
  srcPath: src,
  profile: { metadataDefaults: { rights: 'voidlord' } },
});
const opf = out.entries['OEBPS/content.opf'].toString('utf-8');
console.log('hasRights:', /<dc:rights>voidlord<\/dc:rights>/.test(opf));
console.log('hasBookId:', /<dc:identifier id=\"BookId\">urn:uuid:/.test(opf));
console.log('hasCover:', /<meta name=\"cover\"/.test(opf));
console.log('noDuokan:', !/duokan-book-id/.test(opf));
console.log('noZhangyue:', !/zhangyue-book-id/.test(opf));
"
```
Expected: 5 行全 `true`

---

### Task 13：写 src/core/stages/index.js

**Files:**
- Create: `epub-clean-js/src/core/stages/index.js`

- [ ] **Step 1: 创建 stages/index.js**

```js
// src/core/stages/index.js
export { strip } from "./strip.js";
export { deobfuscate } from "./deobfuscate.js";
export { heal } from "./heal.js";
export { align } from "./align.js";
```

- [ ] **Step 2: 验证**

```bash
cd epub-clean-js && node -e "
import('./src/core/stages/index.js').then(m =>
  console.log('exports:', Object.keys(m).sort())
);
"
```
Expected: `exports: [ 'align', 'deobfuscate', 'heal', 'strip' ]`

---

### Task 14：写 books/yimei-seikatsu/profile.js

**Files:**
- Create: `epub-clean-js/books/yimei-seikatsu/profile.js`

- [ ] **Step 1: 创建 profile.js**

```js
// books/yimei-seikatsu/profile.js
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

export default {
  id: "yimei-seikatsu",
  paths: {
    rawDir:      PROJECT_ROOT,
    unlockedDir: path.join(PROJECT_ROOT, "unlocked"),
    healedDir:   path.join(PROJECT_ROOT, "unlocked", "healed"),
    cleanDir:    path.join(PROJECT_ROOT, "unlocked", "clean"),
  },
  vols: [11, 12, 13, 14, 15],
  filePatterns: {
    raw:      (n) => `[三河ごーすと].义妹生活.${String(n).padStart(2, "0")}.[日翻].epub`,
    unlocked: (n) => `[三河ごーすと].义妹生活.${String(n).padStart(2, "0")}.[日翻].unlocked.epub`,
    healed:   (n) => `[三河ごーすと].义妹生活.${String(n).padStart(2, "0")}.[日翻].healed.epub`,
    clean:    (n) => `[三河ごーすと].义妹生活.${String(n).padStart(2, "0")}.[日翻].clean.epub`,
  },
  metadataDefaults: {
    rights: "voidlord",
  },
};
```

- [ ] **Step 2: 验证**

```bash
cd epub-clean-js && node -e "
import('./books/yimei-seikatsu/profile.js').then(({ default: p }) => {
  console.log('id=', p.id);
  console.log('rawDir=', p.paths.rawDir);
  console.log('vols=', p.vols);
  console.log('rawFor13=', p.filePatterns.raw(13));
  console.log('rights=', p.metadataDefaults.rights);
});
"
```
Expected:
```
id= yimei-seikatsu
rawDir= /Users/liuzhuo/Downloads/义妹生活
vols= [ 11, 12, 13, 14, 15 ]
rawFor13= [三河ごーすと].义妹生活.13.[日翻].epub
rights= voidlord
```

---

### Task 15：写 src/entries/strip.js

**Files:**
- Create: `epub-clean-js/src/entries/strip.js`

- [ ] **Step 1: 创建 entries/strip.js**

```js
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import profile from "../../books/yimei-seikatsu/profile.js";
import { readEpub, writeEpub } from "../core/zip-io.js";
import { runPipeline } from "../core/pipeline.js";
import { strip } from "../core/stages/strip.js";

async function main() {
  fs.mkdirSync(profile.paths.unlockedDir, { recursive: true });
  for (const vol of profile.vols) {
    const src = path.join(profile.paths.rawDir, profile.filePatterns.raw(vol));
    const dst = path.join(profile.paths.unlockedDir, profile.filePatterns.unlocked(vol));
    if (!fs.existsSync(src)) {
      console.log(`⚠️  跳过 ${vol}: ${src} 不存在`);
      continue;
    }
    const inBuf = await readEpub(src);
    const outBuf = await runPipeline(inBuf, [strip], { profile, volNum: vol, srcPath: src });
    await writeEpub(dst, outBuf.entries);
    console.log(`✅ 卷 ${vol} → ${path.basename(dst)} (${fs.statSync(dst).size.toLocaleString()} B)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

**注意**：现有 `writeEpub(out_path, files)` 接受 `files` 是 `{ name: Buffer }` 字典。这里传 `outBuf.entries`（与 EpubBuffer 的 entries 字段同形）即可。但如果 writeEpub 依赖 `outBuf.names` 顺序，需要传 outBuf 整体并改 writeEpub 签名。**先按现有 writeEpub 接口（entries 字典）跑通**，跑通后再决定是否要保留 names 顺序信息（Object.entries 在现代 JS 中保留插入顺序，通常够用）。

- [ ] **Step 2: 验证**

```bash
cd epub-clean-js && node src/entries/strip.js 2>&1 | tail -10
ls -la /Users/liuzhuo/Downloads/义妹生活/unlocked/[三河ごーすと].义妹生活.{11,12,13,14,15}.[日翻].unlocked.epub 2>&1 | grep -c "unlocked.epub"
```
Expected: 5 行 ✅ 输出 + 最后一个 grep 计数为 5

---

### Task 16：写 src/entries/heal.js

**Files:**
- Create: `epub-clean-js/src/entries/heal.js`

- [ ] **Step 1: 创建 entries/heal.js**

```js
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import profile from "../../books/yimei-seikatsu/profile.js";
import { readEpub, writeEpub } from "../core/zip-io.js";
import { runPipeline } from "../core/pipeline.js";
import { strip, deobfuscate, heal } from "../core/stages/index.js";

async function main() {
  fs.mkdirSync(profile.paths.healedDir, { recursive: true });
  for (const vol of profile.vols) {
    const src = path.join(profile.paths.rawDir, profile.filePatterns.raw(vol));
    const dst = path.join(profile.paths.healedDir, profile.filePatterns.healed(vol));
    if (!fs.existsSync(src)) {
      console.log(`⚠️  跳过 ${vol}: ${src} 不存在`);
      continue;
    }
    const inBuf = await readEpub(src);
    const outBuf = await runPipeline(inBuf, [strip, deobfuscate, heal], { profile, volNum: vol, srcPath: src });
    await writeEpub(dst, outBuf.entries);
    console.log(`✅ 卷 ${vol} → ${path.basename(dst)} (${fs.statSync(dst).size.toLocaleString()} B)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 验证**

```bash
cd epub-clean-js && node src/entries/heal.js 2>&1 | tail -10
ls -la /Users/liuzhuo/Downloads/义妹生活/unlocked/healed/*.healed.epub | wc -l | tr -d ' '
```
Expected: 5 行 ✅ + 计数 `5`

---

### Task 17：写 src/entries/align.js

**Files:**
- Create: `epub-clean-js/src/entries/align.js`

- [ ] **Step 1: 创建 entries/align.js**

```js
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import profile from "../../books/yimei-seikatsu/profile.js";
import { readEpub, writeEpub } from "../core/zip-io.js";
import { runPipeline } from "../core/pipeline.js";
import { strip, deobfuscate, heal, align } from "../core/stages/index.js";
import { validateOutput } from "../core/validator.js";

async function main() {
  fs.mkdirSync(profile.paths.cleanDir, { recursive: true });
  for (const vol of profile.vols) {
    const src = path.join(profile.paths.rawDir, profile.filePatterns.raw(vol));
    const dst = path.join(profile.paths.cleanDir, profile.filePatterns.clean(vol));
    if (!fs.existsSync(src)) {
      console.log(`⚠️  跳过 ${vol}: ${src} 不存在`);
      continue;
    }
    const inBuf = await readEpub(src);
    const outBuf = await runPipeline(inBuf, [strip, deobfuscate, heal, align], { profile, volNum: vol, srcPath: src });
    await writeEpub(dst, outBuf.entries);
    const r = await validateOutput(dst);
    const flag = r.ok ? "✅" : "❌";
    console.log(`${flag} 卷 ${vol} → ${path.basename(dst)} issues=${r.issues.length} broken=${r.brokenLinks.length}`);
    for (const i of r.issues.slice(0, 3)) console.log(`    - ${i}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 验证**

```bash
cd epub-clean-js && node src/entries/align.js 2>&1 | tail -10
```
Expected: 5 行 ✅，issues=0（broken-links 在 11/12 各 1 个，是源 epub 自带）

---

### Task 18：写 src/entries/all.js

**Files:**
- Create: `epub-clean-js/src/entries/all.js`

- [ ] **Step 1: 创建 entries/all.js（与 align 等价，方便 npm start 习惯）**

```js
#!/usr/bin/env node
// all.js — 等价 align entry，保留 all 名是因为 npm start 习惯叫 all。
// 任何对 entries/align.js 的修改请同步过来（或反向：把核心逻辑抽到 helper）。
import "./align.js";
```

- [ ] **Step 2: 验证**

```bash
cd epub-clean-js && node src/entries/all.js 2>&1 | tail -10
```
Expected: 与 align 相同的 5 行 ✅ 输出

---

### Task 19：旧文件重命名为 .bak

**Files:**
- Rename: `epub-clean-js/src/{config,index,strip,process,opf,patchers,paths,validator,zip-io}.js` → `*.bak`

- [ ] **Step 1: 批量重命名**

```bash
cd "/Users/liuzhuo/Downloads/义妹生活/epub-clean-js"
for f in config index strip process opf patchers paths validator zip-io; do
  if [ -f "src/$f.js" ]; then
    mv "src/$f.js" "src/$f.js.bak"
  fi
done
ls src/*.bak | wc -l | tr -d ' '
```
Expected: `9`

- [ ] **Step 2: 验证新 entries 不再依赖旧文件**

```bash
cd "/Users/liuzhuo/Downloads/义妹生活/epub-clean-js"
grep -RnE "from \"\.\./[a-z-]+\.js\"" src/entries/ || echo "无残留旧 import"
```
Expected: `无残留旧 import`（所有 import 都是 `../core/...` 或 `../../books/...`）

---

### Task 20：更新 package.json scripts

**Files:**
- Modify: `epub-clean-js/package.json`

- [ ] **Step 1: 改 scripts**

打开 `epub-clean-js/package.json`，把 `scripts` 块替换为：

```json
"scripts": {
  "strip": "node src/entries/strip.js",
  "heal":  "node src/entries/heal.js",
  "align": "node src/entries/align.js",
  "start": "node src/entries/all.js"
}
```

- [ ] **Step 2: 验证 package.json JSON 合法**

```bash
cd epub-clean-js && jq -e '.scripts | keys' package.json
```
Expected: `[ "align", "heal", "start", "strip" ]`

---

### Task 21：跑 4 个 npm script 端到端验证 + diff

**Files:** （仅跑，不写）

- [ ] **Step 1: 跑全 4 个 npm script**

```bash
cd "/Users/liuzhuo/Downloads/义妹生活/epub-clean-js"
echo "=== npm run strip ===" && npm run strip 2>&1 | tail -6
echo "=== npm run heal ===" && npm run heal 2>&1 | tail -6
echo "=== npm run align ===" && npm run align 2>&1 | tail -6
echo "=== npm start ===" && npm start 2>&1 | tail -6
```
Expected: 4 个段落每个都有 5 行 ✅ 输出

- [ ] **Step 2: 与 baseline (/tmp/epub-baseline/clean) 对比**

```bash
echo "=== size 对比 ==="
for n in 11 12 13 14 15; do
  baseline=$(stat -f%z "/tmp/epub-baseline/clean/[三河ごーすと].义妹生活.${n}.[日翻].clean.epub" 2>/dev/null || echo 0)
  current=$(stat -f%z "/Users/liuzhuo/Downloads/义妹生活/unlocked/clean/[三河ごーすと].义妹生活.${n}.[日翻].clean.epub" 2>/dev/null || echo 0)
  diff=$(( current - baseline ))
  echo "卷 $n: baseline=$baseline current=$current diff=$diff"
done
```
Expected: 每卷 diff 绝对值 < 5% 的 baseline（CSS 减少 + 元数据微调）

- [ ] **Step 3: 与 baseline 对比 default.css 行数（应减少）**

```bash
for n in 11 12 13 14 15; do
  blines=$(unzip -p "/tmp/epub-baseline/clean/[三河ごーすと].义妹生活.${n}.[日翻].clean.epub" OEBPS/Styles/default.css 2>/dev/null | grep -c "@font-face")
  clines=$(unzip -p "/Users/liuzhuo/Downloads/义妹生活/unlocked/clean/[三河ごーすと].义妹生活.${n}.[日翻].clean.epub" OEBPS/Styles/default.css 2>/dev/null | grep -c "@font-face")
  echo "卷 $n: @font-face baseline=$blines current=$clines"
done
```
Expected: 每卷 current < baseline（孤儿规则被清）

- [ ] **Step 4: 与 baseline 对比 OPF 关键字段**

```bash
for n in 11 12 13 14 15; do
  echo "=== 卷 $n ==="
  unzip -p "/Users/liuzhuo/Downloads/义妹生活/unlocked/clean/[三河ごーすと].义妹生活.${n}.[日翻].clean.epub" OEBPS/content.opf | grep -E "dc:rights|BookId|meta name=\"cover\"" | head -3
done
```
Expected: 每卷都含 `<dc:rights>voidlord</dc:rights>`、`<dc:identifier id="BookId">urn:uuid:...`、`<meta name="cover"`

---

### Task 22：验证全绿后删 .bak 旧文件

**Files:** （仅删，不写）

- [ ] **Step 1: 确认 21 步全绿后才执行（这一步不可逆）**

```bash
cd "/Users/liuzhuo/Downloads/义妹生活/epub-clean-js"
ls src/*.bak | wc -l | tr -d ' '
```
Expected: `9`（确认 .bak 还在）

- [ ] **Step 2: 删 .bak**

```bash
rm src/*.bak
ls src/ | head
```
Expected: src/ 下不再有 *.bak，仅剩 core/ 和 entries/ 两个目录

- [ ] **Step 3: 最终 npm start 再跑一次验证清理后仍能跑**

```bash
npm start 2>&1 | tail -10
```
Expected: 5 行 ✅

---

## Self-Review

**1. Spec 覆盖性**

| Spec 节 | 对应 Task | 覆盖 |
|---|---|---|
| §5 4 个 stage 职责 | T9 strip / T10 deobfuscate / T11 heal / T12 align | ✅ |
| §6 目录结构 | T1 mkdir + T2-T18 各文件创建 | ✅ |
| §7 BookProfile | T14 | ✅ |
| §8 Metadata 职责分工 | T11 通用 + T12 书特定 | ✅ |
| §9 npm scripts + §10 entry 结构 | T15-T18 + T20 | ✅ |
| §11 孤儿 @font-face 算法 | T11 sanitizeCssOrphanFontFace | ✅ |
| §12 现有 src/ 迁移映射 | T2-T7 各文件迁移 + T11/T12 拆 patchOpfMetadata | ✅ |
| §13 13 步迁移序列（暂留 .bak + 验证后删） | T19 暂留 + T22 删 | ✅ |
| §14 验证清单 9 项 | T7 加第 7 项 CSS 检查 + T21 端到端验证 | ✅ |
| §15 测试策略 | 每 task 内联验证 + T21 端到端 + 与 baseline diff | ✅ |
| §17 不变量 | core 0 书特定字符串通过 T11/T12 拆分实现 | ✅ |

**2. Placeholder 扫描**：全部 23 个 task 每步都给了完整代码、命令、预期输出。无 TBD/TODO 字眼。

**3. 类型一致性**：
- `EpubBuffer = { names, entries, meta? }` — T5 readEpub 返回 { names, entries }，T10 deobfuscate 返回时加 meta，T11/T12 复用 meta，T15-T18 entries 写出时只用 entries 字段
- stage 签名 `(buf, ctx) => buf` — T9/T10/T11/T12 一致
- ctx 形态 `{ profile, volNum, srcPath }` — T15-T18 entries 创建 ctx 一致

**4. 修复**：自审无需修补。

---

## Execution Handoff

**Plan complete and saved to** `/Users/liuzhuo/Downloads/义妹生活/docs/superpowers/plans/2026-05-22-epub-pipeline-split.md`

执行方式（由用户已预选）：**Subagent-Driven + Dispatching Parallel Agents**

- **REQUIRED SUB-SKILL:** `superpowers:subagent-driven-development` 主导
- **PARALLEL DISPATCH:** `superpowers:dispatching-parallel-agents` 对无依赖 task 横向并行

可并行批次（按依赖图）：
- **批次 A**（无依赖，可全并行）：T2 constants / T3 paths / T8 pipeline / T13 stages-index / T14 profile / T20 package.json
- **批次 B**（依赖 A）：T4 patchers / T5 zip-io / T6 opf / T7 validator
- **批次 C**（依赖 B）：T9 strip / T10 deobfuscate
- **批次 D**（依赖 C）：T11 heal / T12 align
- **批次 E**（依赖 D）：T15 strip-entry / T16 heal-entry / T17 align-entry / T18 all-entry
- **批次 F**（串行）：T0 → T1（前置）；T19 → T21 → T22（收尾）
