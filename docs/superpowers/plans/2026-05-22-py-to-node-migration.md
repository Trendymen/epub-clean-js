# Python → Node ESM 迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把义妹生活 09 卷的 Python 迁移管线完整移植到 Node ESM，合并进 `epub-clean-js/` 统一工程，按子命令暴露 `migrate-translation` / `footnote-fix` 等管线，并归档 Python 实现。

**Architecture:** 三 Phase 串行（Phase 1 业务管线挂载 + 端到端跑通 + e2e 黄金基线锁定；Phase 2 通用 footnote-fix 子流抽取；Phase 3 归档清理）。基线策略：以当前 Python 版 `[09.台简].epub` 修复引言重复 bug 后作为 normalized hash golden，所有 Node 输出必须 100% 对齐。

**Tech Stack:** Node.js ≥20 + ESM、`node --test`、Nunjucks、fuzzball、linkedom、adm-zip、yauzl-promise/yazl。**项目非 git 仓库**，commit 步骤替换为「检查点（Checkpoint）+ 手动备份建议」。

**关键路径：**
- 当前 Python 产物：`/Users/liuzhuo/Downloads/义妹生活/[三河ごーすと].义妹生活.09.[台简].epub` (4.4MB)
- 统一工程容器：`/Users/liuzhuo/Downloads/义妹生活/epub-clean-js/`
- 待挂载 Node 半成品：`/Users/liuzhuo/Downloads/义妹生活/yimei-epub-migrate/`
- 待归档 Python：`/Users/liuzhuo/Downloads/义妹生活/scripts/` 与 `/Users/liuzhuo/Downloads/义妹生活/tests/`

---

## File Structure

**新建文件（Phase 1 完成后）：**

```
epub-clean-js/
├── bin/
│   └── cli.js                                                  # 新建 dispatcher
├── books/
│   └── yimei-seikatsu/
│       ├── profile.js                                          # 业务配置
│       ├── migrate/                                            # 11 模块从 yimei-epub-migrate 复制
│       │   ├── aligner.js
│       │   ├── chapter-renderer.js                             # 含引言去重逻辑
│       │   ├── epub-io.js
│       │   ├── extras-cleaner.js                               # 对齐 Python 246 行
│       │   ├── footnote-cleaner.js
│       │   ├── footnote-extractor.js
│       │   ├── footnote-relocator.js
│       │   ├── inline-image-extractor.js
│       │   ├── metadata-builder.js
│       │   ├── migrate-epub.js                                 # 主编排
│       │   ├── paragraph-extractor.js
│       │   └── toc-builder.js
│       └── templates/                                          # Nunjucks 模板从原工程复制
├── src/
│   └── entries/
│       └── migrate-translation.js                              # CLI entry
├── test/
│   ├── unit/yimei-seikatsu/                                    # 11 单测搬入
│   ├── e2e/migrate-translation.e2e.test.js                     # 新增
│   ├── fixtures/yimei09/
│   │   ├── golden-py/                                          # 当前 Python 产物解包目录
│   │   └── golden-manifest.json                                # normalized SHA256 索引
│   └── scripts/
│       └── build-golden-manifest.mjs                           # 工具脚本
└── package.json                                                # 修改：加依赖、加 scripts
```

**Phase 2 新增：**

```
epub-clean-js/
├── src/
│   ├── core/stages/footnote-fix.js                             # 通用注释升级
│   └── entries/footnote-fix.js                                 # CLI entry
└── test/
    └── e2e/footnote-fix.e2e.test.js                            # 新增
```

**Phase 3 归档（mv）：**

```
epub-clean-js/archive/
├── scripts-py/                                                 # 原 /scripts/ 移入
├── scripts-py-tests/                                           # 原 /tests/ 移入
└── yimei-epub-migrate-old/                                     # 原 /yimei-epub-migrate/ 移入
```

**Phase 1 修改文件：**

- `[三河ごーすと].义妹生活.09.[台简].epub`：直接编辑（Task 2 修引言）
- `epub-clean-js/package.json`：加依赖 `nunjucks`、`fuzzball`、`linkedom`、`adm-zip`；加 npm scripts `migrate-translation`、`test:unit`、`test:e2e`
- `epub-clean-js/books/yimei-seikatsu/migrate/chapter-renderer.js`：加引言去重 hash 判定
- `epub-clean-js/books/yimei-seikatsu/migrate/extras-cleaner.js`：对齐 Python `extras_cleaner.py` 行为（70 → ~246 行）

---

# Phase 1：业务管线挂载 + 端到端跑通

## Task 0：准备空目录骨架

**Files:**
- Create: `epub-clean-js/archive/.gitkeep`
- Create: `epub-clean-js/test/.gitkeep`
- Create: `epub-clean-js/books/.gitkeep`
- Create: `epub-clean-js/test/fixtures/yimei09/.gitkeep`
- Create: `epub-clean-js/test/unit/.gitkeep`
- Create: `epub-clean-js/test/e2e/.gitkeep`
- Create: `epub-clean-js/test/scripts/.gitkeep`

- [ ] **Step 1: 创建目录**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
mkdir -p archive test/fixtures/yimei09 test/unit test/e2e test/scripts books
touch archive/.gitkeep test/.gitkeep books/.gitkeep \
      test/fixtures/yimei09/.gitkeep test/unit/.gitkeep \
      test/e2e/.gitkeep test/scripts/.gitkeep
ls archive test books test/fixtures test/unit test/e2e test/scripts
```

Expected：每个新建目录都存在且为空（除 `.gitkeep`）。

- [ ] **Step 2: 检查 Node 版本**

```bash
node --version
```

Expected: `v20.x.x` 或更高（package.json `"engines": { "node": ">=20" }`）。

- [ ] **Step 3: Checkpoint**

输出当前目录树：

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js && ls -la
```

Expected：能看到 `archive/`、`test/`、`books/`、原有的 `src/`、`bin/`(如有)、`package.json`、`node_modules/` 等。

---

## Task 1：黄金基线 — 解包当前 Python 产物

**Files:**
- Create: `epub-clean-js/test/fixtures/yimei09/golden-py/` (目录)

- [ ] **Step 1: 解包 [09.台简].epub 到 fixtures/yimei09/golden-py/**

```bash
cd /Users/liuzhuo/Downloads/义妹生活
rm -rf epub-clean-js/test/fixtures/yimei09/golden-py
mkdir -p epub-clean-js/test/fixtures/yimei09/golden-py
cd epub-clean-js/test/fixtures/yimei09/golden-py
unzip -q "/Users/liuzhuo/Downloads/义妹生活/[三河ごーすと].义妹生活.09.[台简].epub"
ls -la
```

Expected：能看到 `META-INF/`、`OEBPS/`、`mimetype`。

- [ ] **Step 2: 确认章节文件齐全**

```bash
ls /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/test/fixtures/yimei09/golden-py/OEBPS/Text/
```

Expected：13 个主章节（chapter0001-chapter0012 + pre）、3 个 special、5 个 illus、cover/title/message/summary/contents/TOC/navigation-documents（共 28 个 xhtml）。

- [ ] **Step 3: Checkpoint**

文件总数：

```bash
find /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/test/fixtures/yimei09/golden-py -type f | wc -l
```

Expected：≈ 60+ 文件（28 xhtml + CSS + Images + Fonts + Misc + OPF + NCX + META-INF）。

---

## Task 2：修引言重复 bug（直接改 epub 产物）

**Files:**
- Modify: `[三河ごーすと].义妹生活.09.[台简].epub`（原地覆盖）
- Test: 阅读器手工查看

- [ ] **Step 1: 备份当前产物**

```bash
cd /Users/liuzhuo/Downloads/义妹生活
cp "[三河ごーすと].义妹生活.09.[台简].epub" \
   "[三河ごーすと].义妹生活.09.[台简].before-epigraph-fix.epub"
ls -la *.epub | head -5
```

Expected：能看到备份文件。

- [ ] **Step 2: 编辑 chapter0001.xhtml 删除引言重复段**

写一个一次性 Node 脚本 `/tmp/fix-epigraph.mjs`：

```js
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const exec = (cmd, args, opts) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { stdio: "inherit", ...opts });
  p.on("close", code => code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`)));
});

const EPUB = "/Users/liuzhuo/Downloads/义妹生活/[三河ごーすと].义妹生活.09.[台简].epub";
const WORK = "/tmp/fix-epigraph-work";

await rm(WORK, { recursive: true, force: true });
await mkdir(WORK, { recursive: true });
await exec("unzip", ["-q", EPUB, "-d", WORK]);

const ch1Path = path.join(WORK, "OEBPS/Text/chapter0001.xhtml");
let html = await readFile(ch1Path, "utf8");

const EPIGRAPH_RE = /\n\n\n <p>冷静的人生规划不保证会有幸福的人生。幸福藏在刹那间的狂热之中。<\/p>\n/;
if (!EPIGRAPH_RE.test(html)) {
  throw new Error("引言段未找到，请人工检查 chapter0001.xhtml 结构");
}
html = html.replace(EPIGRAPH_RE, "\n");
await writeFile(ch1Path, html);

console.log("chapter0001.xhtml 引言段已删除");

// 重新打包：mimetype 必须无压缩首位
process.chdir(WORK);
await rm(EPUB, { force: true });
await exec("zip", ["-X0", EPUB, "mimetype"]);
await exec("zip", ["-Xr9D", EPUB, ".", "-x", "mimetype"]);

console.log("EPUB 重新打包完成:", EPUB);
```

运行：

```bash
node /tmp/fix-epigraph.mjs
```

Expected：终端输出
```
chapter0001.xhtml 引言段已删除
EPUB 重新打包完成: /Users/liuzhuo/Downloads/义妹生活/[三河ごーすと].义妹生活.09.[台简].epub
```

- [ ] **Step 3: 验证修复**

```bash
cd /tmp && rm -rf verify-fix && mkdir verify-fix && cd verify-fix
unzip -q "/Users/liuzhuo/Downloads/义妹生活/[三河ごーすと].义妹生活.09.[台简].epub"
grep -c "冷静的人生规划" OEBPS/Text/chapter0001.xhtml
grep -c "冷静的人生规划" OEBPS/Text/pre.xhtml
```

Expected：chapter0001 输出 `0`，pre 输出 `1`。

- [ ] **Step 4: 验证 chapter0001 第一段变为「拖着大行李箱…」**

```bash
node --input-type=module -e '
import { readFile } from "node:fs/promises";
const html = await readFile("/tmp/verify-fix/OEBPS/Text/chapter0001.xhtml", "utf8");
const firstP = html.match(/<body>[\s\S]*?<p>([\s\S]*?)<\/p>/)[1];
console.log("chapter0001 第一段:", firstP);
'
```

Expected：输出 `chapter0001 第一段: 拖着大行李箱的老爸和亚季子小姐并肩站在门口。`

- [ ] **Step 5: 同步刷新 golden-py 解包目录**

```bash
cd /Users/liuzhuo/Downloads/义妹生活
rm -rf epub-clean-js/test/fixtures/yimei09/golden-py
mkdir -p epub-clean-js/test/fixtures/yimei09/golden-py
cd epub-clean-js/test/fixtures/yimei09/golden-py
unzip -q "/Users/liuzhuo/Downloads/义妹生活/[三河ごーすと].义妹生活.09.[台简].epub"
grep -c "冷静的人生规划" OEBPS/Text/chapter0001.xhtml
```

Expected：`0`（chapter0001 不再含引言）。

- [ ] **Step 6: Checkpoint**

引言修复完成，golden 目录已同步。

---

## Task 3：生成 golden manifest（normalized SHA256）

**Files:**
- Create: `epub-clean-js/test/scripts/build-golden-manifest.mjs`
- Create: `epub-clean-js/test/fixtures/yimei09/golden-manifest.json`

- [ ] **Step 1: 写工具脚本 build-golden-manifest.mjs**

```js
// epub-clean-js/test/scripts/build-golden-manifest.mjs
import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../fixtures/yimei09/golden-py");
const OUT = path.resolve(import.meta.dirname, "../fixtures/yimei09/golden-manifest.json");

async function walk(dir, base = ROOT) {
  const ents = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

function normalize(buf, ext) {
  const isText = [".xhtml", ".html", ".xml", ".opf", ".ncx", ".css", ".js"].includes(ext);
  if (!isText) return buf;
  let s = buf.toString("utf8");
  // 折叠连续 whitespace 为单个空格
  s = s.replace(/[ \t]+/g, " ");
  // 移除空行
  s = s.replace(/\n[ \t]*\n+/g, "\n");
  // 排除 calibre 注入的版本号
  s = s.replace(/<meta[^>]*name=["']calibre:[^"']*["'][^/]*\/?>/gi, "");
  return Buffer.from(s, "utf8");
}

const files = (await walk(ROOT)).sort();
const manifest = {
  source: "[三河ごーすと].义妹生活.09.[台简].epub (Python 版, 引言修复后)",
  generated_at: new Date().toISOString(),
  files: {},
};

for (const rel of files) {
  const buf = await readFile(path.join(ROOT, rel));
  const ext = path.extname(rel);
  const normalized = normalize(buf, ext);
  const hash = createHash("sha256").update(normalized).digest("hex");

  const entry = { sha256_normalized: hash, bytes: buf.length };

  // 章节文件附加 para_count 与 footnote_count 便于人工速查
  if (rel.includes("Text/chapter") || rel.includes("Text/special")) {
    const html = buf.toString("utf8");
    const stripped = html.replace(/<aside[\s\S]*?<\/aside>/g, "");
    const paraCount = (stripped.match(/<p[^>]*>/g) ?? []).length;
    const fnCount = (html.match(/<aside epub:type="footnote"/g) ?? []).length;
    entry.para_count = paraCount;
    entry.footnote_count = fnCount;
  }

  manifest.files[rel] = entry;
}

await writeFile(OUT, JSON.stringify(manifest, null, 2));
console.log(`Wrote ${Object.keys(manifest.files).length} entries to ${OUT}`);
```

- [ ] **Step 2: 跑生成 manifest**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
node test/scripts/build-golden-manifest.mjs
```

Expected：输出形如 `Wrote 62 entries to .../golden-manifest.json`

- [ ] **Step 3: 验证 manifest**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
node --input-type=module -e '
import { readFile } from "node:fs/promises";
const m = JSON.parse(await readFile("test/fixtures/yimei09/golden-manifest.json", "utf8"));
console.log("文件总数:", Object.keys(m.files).length);
console.log("chapter0001:", m.files["OEBPS/Text/chapter0001.xhtml"]);
console.log("pre.xhtml:", m.files["OEBPS/Text/pre.xhtml"]);
'
```

Expected：
- chapter0001 显示 `para_count: 529`、`footnote_count: 1`
- pre.xhtml 含 hash

- [ ] **Step 4: Checkpoint + 备份**

```bash
cp /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/test/fixtures/yimei09/golden-manifest.json \
   /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/test/fixtures/yimei09/golden-manifest.SAFE.json
```

这份 SAFE 副本是绝对基线，**任何后续重算都不应改它**。

---

## Task 4：模块挂载 — yimei-epub-migrate/src → books/yimei-seikatsu/migrate/

**Files:**
- Create: `epub-clean-js/books/yimei-seikatsu/migrate/aligner.js`
- Create: `epub-clean-js/books/yimei-seikatsu/migrate/chapter-renderer.js`
- Create: `epub-clean-js/books/yimei-seikatsu/migrate/epub-io.js`
- Create: `epub-clean-js/books/yimei-seikatsu/migrate/extras-cleaner.js`
- Create: `epub-clean-js/books/yimei-seikatsu/migrate/footnote-cleaner.js`
- Create: `epub-clean-js/books/yimei-seikatsu/migrate/footnote-extractor.js`
- Create: `epub-clean-js/books/yimei-seikatsu/migrate/footnote-relocator.js`
- Create: `epub-clean-js/books/yimei-seikatsu/migrate/inline-image-extractor.js`
- Create: `epub-clean-js/books/yimei-seikatsu/migrate/metadata-builder.js`
- Create: `epub-clean-js/books/yimei-seikatsu/migrate/migrate-epub.js`
- Create: `epub-clean-js/books/yimei-seikatsu/migrate/paragraph-extractor.js`
- Create: `epub-clean-js/books/yimei-seikatsu/migrate/toc-builder.js`
- Create: `epub-clean-js/books/yimei-seikatsu/templates/` (从原工程复制)

- [ ] **Step 1: 复制 11 模块 + migrateEpub 到新位置（kebab-case 命名）**

```bash
SRC=/Users/liuzhuo/Downloads/义妹生活/yimei-epub-migrate/src
DST=/Users/liuzhuo/Downloads/义妹生活/epub-clean-js/books/yimei-seikatsu/migrate
mkdir -p "$DST"

# 12 个 .js 文件（11 模块 + migrateEpub），camelCase → kebab-case
cp "$SRC/aligner.js"               "$DST/aligner.js"
cp "$SRC/chapterRenderer.js"       "$DST/chapter-renderer.js"
cp "$SRC/epubIo.js"                "$DST/epub-io.js"
cp "$SRC/extrasCleaner.js"         "$DST/extras-cleaner.js"
cp "$SRC/footnoteCleaner.js"       "$DST/footnote-cleaner.js"
cp "$SRC/footnoteExtractor.js"     "$DST/footnote-extractor.js"
cp "$SRC/footnoteRelocator.js"     "$DST/footnote-relocator.js"
cp "$SRC/inlineImageExtractor.js"  "$DST/inline-image-extractor.js"
cp "$SRC/metadataBuilder.js"       "$DST/metadata-builder.js"
cp "$SRC/migrateEpub.js"           "$DST/migrate-epub.js"
cp "$SRC/paragraphExtractor.js"    "$DST/paragraph-extractor.js"
cp "$SRC/tocBuilder.js"            "$DST/toc-builder.js"

ls "$DST"
```

Expected：12 个 .js 文件。

- [ ] **Step 2: 复制 templates 目录**

```bash
SRC=/Users/liuzhuo/Downloads/义妹生活/yimei-epub-migrate/src/templates
DST=/Users/liuzhuo/Downloads/义妹生活/epub-clean-js/books/yimei-seikatsu/templates
cp -r "$SRC" "$DST"
ls "$DST"
```

Expected：能看到 Nunjucks 模板文件（chapter.njk / extras 模板等）。

- [ ] **Step 3: 修正模块间的 import 路径（camelCase → kebab-case）**

写一次性脚本 `/tmp/fix-imports.mjs`：

```js
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DIR = "/Users/liuzhuo/Downloads/义妹生活/epub-clean-js/books/yimei-seikatsu/migrate";
const renames = {
  "./aligner.js": "./aligner.js",
  "./chapterRenderer.js": "./chapter-renderer.js",
  "./epubIo.js": "./epub-io.js",
  "./extrasCleaner.js": "./extras-cleaner.js",
  "./footnoteCleaner.js": "./footnote-cleaner.js",
  "./footnoteExtractor.js": "./footnote-extractor.js",
  "./footnoteRelocator.js": "./footnote-relocator.js",
  "./inlineImageExtractor.js": "./inline-image-extractor.js",
  "./metadataBuilder.js": "./metadata-builder.js",
  "./migrateEpub.js": "./migrate-epub.js",
  "./paragraphExtractor.js": "./paragraph-extractor.js",
  "./tocBuilder.js": "./toc-builder.js",
};

for (const file of await readdir(DIR)) {
  if (!file.endsWith(".js")) continue;
  const full = path.join(DIR, file);
  let src = await readFile(full, "utf8");
  let changed = false;
  for (const [oldP, newP] of Object.entries(renames)) {
    if (oldP === newP) continue;
    const before = src;
    src = src.replaceAll(`"${oldP}"`, `"${newP}"`).replaceAll(`'${oldP}'`, `'${newP}'`);
    if (src !== before) changed = true;
  }
  if (changed) {
    await writeFile(full, src);
    console.log("updated:", file);
  }
}
```

运行：

```bash
node /tmp/fix-imports.mjs
```

Expected：列出每个被修改的文件。

- [ ] **Step 4: 修正 templates 路径引用**

```bash
grep -rn "templates" /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/books/yimei-seikatsu/migrate
```

如果 chapter-renderer.js / extras-cleaner.js / metadata-builder.js / toc-builder.js 引用了 templates 目录（路径形如 `path.join(__dirname, "templates")`），保留即可（templates 与各模块在同一目录的兄弟位置）。

如果路径形如 `"../src/templates"` 这种旧路径，用 Edit 工具改为 `"../templates"`。

- [ ] **Step 5: 语法快查（无 require、无 CommonJS、Node 能 parse）**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
node --input-type=module -e '
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const DIR = "books/yimei-seikatsu/migrate";
const files = (await readdir(DIR)).filter(f => f.endsWith(".js"));
for (const f of files) {
  const src = await readFile(path.join(DIR, f), "utf8");
  if (src.match(/^\s*const\s+\w+\s*=\s*require\(/m)) {
    console.error("CJS require found in", f);
    process.exit(1);
  }
}
console.log("all", files.length, "files are ESM");
'
```

Expected：`all 12 files are ESM`。

- [ ] **Step 6: Checkpoint**

```bash
ls /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/books/yimei-seikatsu/migrate
ls /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/books/yimei-seikatsu/templates
```

Expected：12 模块 + templates 都齐了。

---

## Task 5：单元测试挂载（11 个 test 文件 + fixtures）

**Files:**
- Create: `epub-clean-js/test/unit/yimei-seikatsu/aligner.test.js`
- Create: `epub-clean-js/test/unit/yimei-seikatsu/chapter-renderer.test.js`
- Create: `epub-clean-js/test/unit/yimei-seikatsu/epub-io.test.js`
- Create: `epub-clean-js/test/unit/yimei-seikatsu/extras-cleaner.test.js`
- Create: `epub-clean-js/test/unit/yimei-seikatsu/footnote-cleaner.test.js`
- Create: `epub-clean-js/test/unit/yimei-seikatsu/footnote-extractor.test.js`
- Create: `epub-clean-js/test/unit/yimei-seikatsu/footnote-relocator.test.js`
- Create: `epub-clean-js/test/unit/yimei-seikatsu/inline-image-extractor.test.js`
- Create: `epub-clean-js/test/unit/yimei-seikatsu/metadata-builder.test.js`
- Create: `epub-clean-js/test/unit/yimei-seikatsu/paragraph-extractor.test.js`
- Create: `epub-clean-js/test/unit/yimei-seikatsu/toc-builder.test.js`
- Create: `epub-clean-js/test/unit/yimei-seikatsu/fixtures/` (从原 test/fixtures 复制)

- [ ] **Step 1: 复制 11 个 test 文件并改名**

```bash
SRC=/Users/liuzhuo/Downloads/义妹生活/yimei-epub-migrate/test
DST=/Users/liuzhuo/Downloads/义妹生活/epub-clean-js/test/unit/yimei-seikatsu
mkdir -p "$DST"

cp "$SRC/aligner.test.js"              "$DST/aligner.test.js"
cp "$SRC/chapterRenderer.test.js"      "$DST/chapter-renderer.test.js"
cp "$SRC/epubIo.test.js"               "$DST/epub-io.test.js"
cp "$SRC/extrasCleaner.test.js"        "$DST/extras-cleaner.test.js"
cp "$SRC/footnoteCleaner.test.js"      "$DST/footnote-cleaner.test.js"
cp "$SRC/footnoteExtractor.test.js"    "$DST/footnote-extractor.test.js"
cp "$SRC/footnoteRelocator.test.js"    "$DST/footnote-relocator.test.js"
cp "$SRC/inlineImageExtractor.test.js" "$DST/inline-image-extractor.test.js"
cp "$SRC/metadataBuilder.test.js"      "$DST/metadata-builder.test.js"
cp "$SRC/paragraphExtractor.test.js"   "$DST/paragraph-extractor.test.js"
cp "$SRC/tocBuilder.test.js"           "$DST/toc-builder.test.js"

# fixtures
cp -r "$SRC/fixtures" "$DST/fixtures"
ls "$DST"
```

Expected：11 个 .test.js + fixtures 目录。

- [ ] **Step 2: 修测试文件的 import 路径（指向新模块位置）**

```js
// /tmp/fix-test-imports.mjs
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DIR = "/Users/liuzhuo/Downloads/义妹生活/epub-clean-js/test/unit/yimei-seikatsu";

// 测试原来的 import 形如 "../src/aligner.js"
// 新位置应为 "../../../books/yimei-seikatsu/migrate/aligner.js"
const renames = {
  '../src/aligner.js': '../../../books/yimei-seikatsu/migrate/aligner.js',
  '../src/chapterRenderer.js': '../../../books/yimei-seikatsu/migrate/chapter-renderer.js',
  '../src/epubIo.js': '../../../books/yimei-seikatsu/migrate/epub-io.js',
  '../src/extrasCleaner.js': '../../../books/yimei-seikatsu/migrate/extras-cleaner.js',
  '../src/footnoteCleaner.js': '../../../books/yimei-seikatsu/migrate/footnote-cleaner.js',
  '../src/footnoteExtractor.js': '../../../books/yimei-seikatsu/migrate/footnote-extractor.js',
  '../src/footnoteRelocator.js': '../../../books/yimei-seikatsu/migrate/footnote-relocator.js',
  '../src/inlineImageExtractor.js': '../../../books/yimei-seikatsu/migrate/inline-image-extractor.js',
  '../src/metadataBuilder.js': '../../../books/yimei-seikatsu/migrate/metadata-builder.js',
  '../src/paragraphExtractor.js': '../../../books/yimei-seikatsu/migrate/paragraph-extractor.js',
  '../src/tocBuilder.js': '../../../books/yimei-seikatsu/migrate/toc-builder.js',
  // fixtures 路径
  './fixtures/': './fixtures/', // 同目录下 fixtures，保持不变
};

for (const file of await readdir(DIR)) {
  if (!file.endsWith(".test.js")) continue;
  const full = path.join(DIR, file);
  let src = await readFile(full, "utf8");
  let changed = false;
  for (const [oldP, newP] of Object.entries(renames)) {
    if (oldP === newP) continue;
    const before = src;
    src = src.replaceAll(`"${oldP}"`, `"${newP}"`).replaceAll(`'${oldP}'`, `'${newP}'`);
    if (src !== before) changed = true;
  }
  if (changed) {
    await writeFile(full, src);
    console.log("updated:", file);
  }
}
```

```bash
node /tmp/fix-test-imports.mjs
```

Expected：列出每个被修改的测试文件（11 个）。

- [ ] **Step 3: 跑单测**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
node --test --test-reporter=spec 'test/unit/yimei-seikatsu/*.test.js' 2>&1 | tail -30
```

Expected：所有测试 PASS。如有 FAIL，记下失败点，去到对应模块文件检查（多半是路径未改全）。

- [ ] **Step 4: 处理失败用例（如有）**

针对每个 FAIL：
1. 看错误是 `Cannot find module` → import 路径还有遗漏，回到 Step 2 补
2. 看错误是测试断言失败 → 留到 Task 9 时一起处理（可能是 extras-cleaner 行为差异）
3. 看错误是 fixtures 路径 → 检查 fixtures 是否完整复制

- [ ] **Step 5: Checkpoint**

记录单测 pass/fail 数。Phase 1 验收要求所有单测 pass，但允许 Task 5 这里仍有 1-3 个失败留到 Task 9 处理（特别是 extras-cleaner.test.js）。

---

## Task 5b：全模块 Python↔Node 差异扫描（生成修复清单）

**Files:**
- Create: `epub-clean-js/docs/python-node-diff.md`（修复清单）

> Python `scripts/` 1650 行 vs Node `yimei-epub-migrate/` 1363 行，差距 17%。除了 extras-cleaner（Task 9）的 3.5× 行数差，其他模块也可能有 Python 后期补丁未同步到 Node。本 Task 系统性扫描每个模块。

- [ ] **Step 1: 逐模块对比函数清单**

```bash
cd /Users/liuzhuo/Downloads/义妹生活
mkdir -p epub-clean-js/docs

for py in scripts/*.py; do
  base=$(basename "$py" .py)
  [ "$base" = "__init__" ] && continue
  [ "$base" = "build_test_footnote_epubs" ] && continue
  case "$base" in
    aligner)               js=aligner ;;
    chapter_renderer)      js=chapter-renderer ;;
    epub_io)               js=epub-io ;;
    extras_cleaner)        js=extras-cleaner ;;
    footnote_cleaner)      js=footnote-cleaner ;;
    footnote_extractor)    js=footnote-extractor ;;
    footnote_relocator)    js=footnote-relocator ;;
    inline_image_extractor) js=inline-image-extractor ;;
    metadata_builder)      js=metadata-builder ;;
    migrate_epub)          js=migrate-epub ;;
    paragraph_extractor)   js=paragraph-extractor ;;
    toc_builder)           js=toc-builder ;;
    *) continue ;;
  esac
  py_lines=$(wc -l < "$py" | tr -d ' ')
  js_path="epub-clean-js/books/yimei-seikatsu/migrate/${js}.js"
  js_lines=$(wc -l < "$js_path" 2>/dev/null | tr -d ' ' || echo "?")
  diff_pct=""
  if [ "$js_lines" != "?" ] && [ "$js_lines" != "0" ]; then
    diff_pct=$(node -e "console.log(((${py_lines} - ${js_lines}) / ${py_lines} * 100).toFixed(0))")
  fi
  echo "${base}: Python ${py_lines} 行 / Node ${js_lines} 行 (差 ${diff_pct}%)"
done | tee /tmp/lines-diff.txt
```

- [ ] **Step 2: 重点模块的 docstring/注释差异扫描**

Python 在 docstring 里会写明"修过什么 bug / 跳过什么"，对比 Node 文件头注释：

```bash
for m in paragraph_extractor footnote_extractor footnote_relocator aligner; do
  echo "=== $m ==="
  echo "--- Python docstring ---"
  head -30 "/Users/liuzhuo/Downloads/义妹生活/scripts/${m}.py"
  case "$m" in
    paragraph_extractor) jsm=paragraph-extractor ;;
    footnote_extractor)  jsm=footnote-extractor ;;
    footnote_relocator)  jsm=footnote-relocator ;;
    aligner)             jsm=aligner ;;
  esac
  echo "--- Node 文件头 ---"
  head -20 "/Users/liuzhuo/Downloads/义妹生活/epub-clean-js/books/yimei-seikatsu/migrate/${jsm}.js"
  echo ""
done | tee /tmp/docstring-diff.txt
```

- [ ] **Step 3: 已知差异清单（落盘）**

写 `epub-clean-js/docs/python-node-diff.md`：

```markdown
# Python ↔ Node 行为差异修复清单

来源：scripts/ vs books/yimei-seikatsu/migrate/
扫描日期：（按 Task 执行日期）

## 已知差异（必须修复）

### paragraph-extractor: 缺少 aside 内 <p> 跳过逻辑
- **Python 实现**：scripts/paragraph_extractor.py 显式跳过 aside 祖先内的 <p>（注释正文不算正文段）
- **Node 现状**：yimei-epub-migrate/src/paragraphExtractor.js **没有这个跳过**，仅跳 rt
- **触发场景**：当输入 epub 已含 aside（DST 日翻版 / Node 已生成的成品复跑）时会把注释正文误当正文段抽出
- **修复**：见 Task 9b
- **影响测试**：paragraph-extractor.test.js 需加 aside 跳过用例

### extras-cleaner: 行数差 3.5×
- **Python**：246 行
- **Node**：70 行
- **修复**：见 Task 9（已规划）

## 待 Step 1-2 扫描后追加的差异

（执行 Step 1/2 后把 /tmp/lines-diff.txt 与 /tmp/docstring-diff.txt 内发现的其他差异追加到这里）
```

- [ ] **Step 4: 把扫描结果合并进 python-node-diff.md**

把 Step 1/2 输出里的 ≥10% 行数差或 docstring 含"跳过"/"修复"/"bug"等关键词的模块，作为新 Task 候选追加到 python-node-diff.md。

- [ ] **Step 5: Checkpoint**

差异清单落盘，后续 Task 按清单逐个修复。如 Step 1-2 发现的新差异较多（>3 个模块），在 Task 9b 之后追加 Task 9c/9d 等同类修复 Task。

---

## Task 6：写 `books/yimei-seikatsu/profile.js`

**Files:**
- Create: `epub-clean-js/books/yimei-seikatsu/profile.js`

- [ ] **Step 1: 写 profile.js**

```js
// epub-clean-js/books/yimei-seikatsu/profile.js
export default {
  id: "yimei-seikatsu",
  name: "义妹生活",
  author: "三河ごーすと",

  // 卷首格言：DST 日翻 pre.xhtml 的台译版本
  // 当 SRC chapter1 第一段 hash 等于此句时，从 chapter0001 跳过该段（修引言重复 bug）
  epigraphs: {
    "09": "冷静的人生规划不保证会有幸福的人生。幸福藏在刹那间的狂热之中。",
  },

  // 插图清单（手动决定保留哪些 + 插在哪里）
  // 来自 align_report.md 的 10 张 HIGH 置信度内联插图
  inlineImages: {
    "09": [
      { src: "p039.webp", chapter: 1,  afterParaIdx: 328 },
      { src: "p062.webp", chapter: 2,  afterParaIdx: 69  },
      { src: "p137.webp", chapter: 4,  afterParaIdx: 246 },
      { src: "p177.webp", chapter: 6,  afterParaIdx: 73  },
      { src: "p196.webp", chapter: 7,  afterParaIdx: 168 },
      { src: "p209.webp", chapter: 7,  afterParaIdx: 320 },
      { src: "p242.webp", chapter: 8,  afterParaIdx: 305 },
      { src: "p267.webp", chapter: 10, afterParaIdx: 180 },
      { src: "p304.webp", chapter: 12, afterParaIdx: 8   },
      { src: "p318.webp", chapter: 12, afterParaIdx: 183 },
    ],
  },

  // 特典清单（保留 DST 日翻原文，不做段落对齐）
  specials: {
    "09": [
      { id: "special0001", title: "电子书特典　『棉花糖般甜蜜』",            source: "DST", hasFootnotes: true  },
      { id: "special0002", title: "蜜瓜特典　『倘若有未来博物馆』",          source: "DST", hasFootnotes: false },
      { id: "special0003", title: "Animate特典4P小册子　『适合婚礼的月份』", source: "DST", hasFootnotes: false },
    ],
  },

  // 注释定位人工修正表（覆盖 footnote-relocator 自动定位）
  // Phase 1 留空，由用户后续人工复核后填入
  footnoteOverrides: {
    "09": {
      // 例：'chapter0011/note001': { chapter: 11, afterParaIdx: 12, atSentenceIdx: 0 },
    },
  },

  // 排版参考来源
  refLayout: "07",
};
```

- [ ] **Step 2: 验证 profile.js 能 import**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
node --input-type=module -e '
import profile from "./books/yimei-seikatsu/profile.js";
console.log("id:", profile.id);
console.log("epigraphs.09:", profile.epigraphs["09"]);
console.log("inlineImages.09 count:", profile.inlineImages["09"].length);
console.log("specials.09 count:", profile.specials["09"].length);
'
```

Expected：
```
id: yimei-seikatsu
epigraphs.09: 冷静的人生规划不保证会有幸福的人生。幸福藏在刹那间的狂热之中。
inlineImages.09 count: 10
specials.09 count: 3
```

- [ ] **Step 3: Checkpoint**

profile.js 落盘，能正确加载。

---

## Task 7：写 CLI entries / dispatcher

**Files:**
- Create: `epub-clean-js/bin/cli.js`
- Create: `epub-clean-js/src/entries/migrate-translation.js`
- Modify: `epub-clean-js/package.json`

- [ ] **Step 1: 写 bin/cli.js dispatcher**

```js
#!/usr/bin/env node
// epub-clean-js/bin/cli.js
import { parseArgs } from "node:util";
import path from "node:path";

const cmd = process.argv[2];
const argv = process.argv.slice(3);

const entries = {
  "strip":               "../src/entries/strip.js",                  // 既有（如已存在）
  "heal":                "../src/entries/heal.js",                   // 既有
  "align":               "../src/entries/align.js",                  // 既有
  "all":                 "../src/entries/all.js",                    // 既有
  "migrate-translation": "../src/entries/migrate-translation.js",    // 新增
  "footnote-fix":        "../src/entries/footnote-fix.js",           // Phase 2 新增（先占位）
};

if (!cmd || cmd === "--help" || cmd === "-h") {
  console.log("Usage: cli.js <subcommand> [options]\n\nSubcommands:");
  for (const k of Object.keys(entries)) console.log("  " + k);
  process.exit(0);
}

if (!entries[cmd]) {
  console.error(`Unknown subcommand: ${cmd}`);
  console.error(`Available: ${Object.keys(entries).join(", ")}`);
  process.exit(2);
}

process.argv = ["node", entries[cmd], ...argv];
const mod = path.resolve(import.meta.dirname, entries[cmd]);
await import(mod);
```

- [ ] **Step 2: 写 src/entries/migrate-translation.js**

```js
// epub-clean-js/src/entries/migrate-translation.js
import { parseArgs } from "node:util";
import path from "node:path";

const { values: opts } = parseArgs({
  options: {
    src:     { type: "string" },                       // SRC epub (台版译文源)
    dst:     { type: "string" },                       // DST epub (日翻容器源)
    ref:     { type: "string" },                       // REF epub (排版参考)
    out:     { type: "string" },                       // 输出路径
    volume:  { type: "string", default: "09" },        // 卷号
    book:    { type: "string", default: "yimei-seikatsu" },  // book profile id
  },
  strict: true,
});

for (const k of ["src", "dst", "ref", "out"]) {
  if (!opts[k]) {
    console.error(`Missing required --${k}`);
    process.exit(2);
  }
}

const profileMod = await import(path.resolve("books", opts.book, "profile.js"));
const profile = profileMod.default;
const migrateMod = await import(path.resolve("books", opts.book, "migrate/migrate-epub.js"));

await migrateMod.default({
  srcEpub: path.resolve(opts.src),
  dstEpub: path.resolve(opts.dst),
  refEpub: path.resolve(opts.ref),
  outEpub: path.resolve(opts.out),
  volume: opts.volume,
  profile,
});

console.log("migrate-translation 完成:", opts.out);
```

- [ ] **Step 3: 给 bin/cli.js 加可执行位**

```bash
chmod +x /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/bin/cli.js
ls -la /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/bin/cli.js
```

Expected：开头有 `x` 权限。

- [ ] **Step 4: 修改 package.json**

Edit `epub-clean-js/package.json`，把 scripts 段改为：

```json
{
  "scripts": {
    "heal":  "node src/entries/heal.js",
    "align": "node src/entries/align.js",
    "start": "node src/entries/all.js",
    "migrate-translation": "node bin/cli.js migrate-translation",
    "test":      "node --test --test-reporter=spec 'test/**/*.test.js'",
    "test:unit": "node --test --test-reporter=spec 'test/unit/**/*.test.js'",
    "test:e2e":  "node --test --test-reporter=spec 'test/e2e/**/*.test.js'"
  },
  "dependencies": {
    "fast-xml-parser": "^4.5.0",
    "yauzl-promise":   "^4.0.0",
    "yazl":            "^3.0.0",
    "nunjucks":        "^3.2.4",
    "fuzzball":        "^2.2.2",
    "linkedom":        "^0.18.5",
    "adm-zip":         "^0.5.16",
    "archiver":        "^7.0.1"
  }
}
```

- [ ] **Step 5: 装依赖**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
npm install
```

Expected：`added N packages`，无报错。

- [ ] **Step 6: 验证 CLI 能跑 --help**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
node bin/cli.js --help
```

Expected：列出 7 个子命令。

- [ ] **Step 7: 验证 migrate-translation 参数解析**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
node bin/cli.js migrate-translation 2>&1
```

Expected：报 `Missing required --src` 然后 exit code 2（说明参数解析正常）。

- [ ] **Step 8: Checkpoint**

CLI 骨架完成，参数校验生效。

---

## Task 8：chapter-renderer.js 加引言去重逻辑

**Files:**
- Modify: `epub-clean-js/books/yimei-seikatsu/migrate/chapter-renderer.js`
- Test: `epub-clean-js/test/unit/yimei-seikatsu/chapter-renderer.test.js`

- [ ] **Step 1: 看当前 chapter-renderer.js 结构，定位 renderChapter 入口**

```bash
cat /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/books/yimei-seikatsu/migrate/chapter-renderer.js
```

记下主导出函数（多半叫 `renderChapter(paras, opts)` 或 `default`）的签名。

- [ ] **Step 2: 在文件顶部加 sha256 工具 import**

Edit chapter-renderer.js 顶部，加：

```js
import { createHash } from "node:crypto";

function sha256(s) {
  return createHash("sha256").update(s.trim(), "utf8").digest("hex");
}

/**
 * 判断 SRC 第一段是否为已被 pre.xhtml 收录的卷首格言
 * @param {string} firstPara
 * @param {string|undefined} epigraph 来自 profile.epigraphs[volume]
 * @returns {boolean}
 */
export function isFirstParaEpigraph(firstPara, epigraph) {
  if (!epigraph || !firstPara) return false;
  return sha256(firstPara) === sha256(epigraph);
}
```

- [ ] **Step 3: 在 renderChapter 入口加判定**

找到主入口函数（设其原签名为 `function renderChapter(paras, opts)`），在函数开头：

```js
export function renderChapter(paras, opts) {
  // 引言去重：仅对 chapter 1 生效（chapterNumber === 1）
  const { chapterNumber, epigraph } = opts;
  let workingParas = paras;
  if (chapterNumber === 1 && isFirstParaEpigraph(paras[0], epigraph)) {
    workingParas = paras.slice(1);
    if (opts.onEpigraphDeduped) opts.onEpigraphDeduped();
  } else if (chapterNumber === 1 && epigraph) {
    console.warn(`[chapter1/volume ${opts.volume ?? "?"}] epigraph hash mismatch, keeping para[0] verbatim`);
  }
  // ...原本的渲染逻辑使用 workingParas 而非 paras
}
```

如果原代码用 `paras` 直接走渲染，需要把所有 `paras` 引用替换为 `workingParas`（除了首段判定本身）。

- [ ] **Step 4: migrate-epub.js 主编排传入 epigraph + chapterNumber**

在 `books/yimei-seikatsu/migrate/migrate-epub.js` 找到调用 chapter-renderer 的位置，确保传入：

```js
import profile from "../profile.js"; // 或从参数注入
// ...
const epigraph = profile.epigraphs[volume];
for (const [idx, chapter] of chapters.entries()) {
  const chapterNumber = idx + 1; // 或基于章节元数据
  const xhtml = renderChapter(chapter.paras, {
    chapterNumber,
    epigraph,
    volume,
    // ...其他原有参数
  });
}
```

具体修改根据实际文件结构 — 主编排在 migrate-epub.js，使用 Read 工具查看结构后局部修改。

- [ ] **Step 5: 写单测 chapter-renderer.test.js 加引言去重用例**

Edit `epub-clean-js/test/unit/yimei-seikatsu/chapter-renderer.test.js`，追加：

```js
import { test } from "node:test";
import assert from "node:assert";
import { renderChapter, isFirstParaEpigraph } from "../../../books/yimei-seikatsu/migrate/chapter-renderer.js";

test("isFirstParaEpigraph: hash 匹配返回 true", () => {
  const epigraph = "冷静的人生规划不保证会有幸福的人生。幸福藏在刹那间的狂热之中。";
  assert.strictEqual(isFirstParaEpigraph(epigraph, epigraph), true);
});

test("isFirstParaEpigraph: hash 不匹配返回 false", () => {
  assert.strictEqual(isFirstParaEpigraph("其他段落", "卷首格言"), false);
});

test("isFirstParaEpigraph: 空 epigraph 返回 false", () => {
  assert.strictEqual(isFirstParaEpigraph("段落", undefined), false);
});

test("renderChapter: chapter 1 引言匹配则跳过第一段", () => {
  const epigraph = "冷静的人生规划不保证会有幸福的人生。幸福藏在刹那间的狂热之中。";
  const paras = [epigraph, "拖着大行李箱的老爸和亚季子小姐并肩站在门口。"];
  let deduped = false;
  const xhtml = renderChapter(paras, {
    chapterNumber: 1,
    epigraph,
    volume: "09",
    onEpigraphDeduped: () => { deduped = true; },
    // ...renderChapter 其他必需的 opts
  });
  assert.strictEqual(deduped, true);
  assert.match(xhtml, /拖着大行李箱/);
  assert.doesNotMatch(xhtml, /<p>冷静的人生规划/);
});

test("renderChapter: chapter 2 不做引言判定", () => {
  const epigraph = "冷静的人生规划不保证会有幸福的人生。幸福藏在刹那间的狂热之中。";
  const paras = [epigraph, "正文..."];
  const xhtml = renderChapter(paras, { chapterNumber: 2, epigraph, volume: "09" });
  assert.match(xhtml, /<p>冷静的人生规划/);
});
```

- [ ] **Step 6: 跑单测**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
node --test --test-reporter=spec test/unit/yimei-seikatsu/chapter-renderer.test.js
```

Expected：新增 4 个 case 全 PASS（已有 case 仍然 PASS）。如有失败，根据具体错误调整 renderChapter 接口或修测试参数。

- [ ] **Step 7: Checkpoint**

引言去重逻辑落地 + 单测覆盖。

---

## Task 9：extras-cleaner.js 对齐 Python（重点 Task）

**Files:**
- Modify: `epub-clean-js/books/yimei-seikatsu/migrate/extras-cleaner.js`
- Test: `epub-clean-js/test/unit/yimei-seikatsu/extras-cleaner.test.js`

> 这是 Phase 1 工作量最大的 Task。Python 246 行 vs Node 70 行，3.5× 差距。预计 1-3 小时。
>
> **注**：本 Task 仅处理 extras-cleaner 的差距。**其他模块的 Python↔Node 差异修复在 Task 9b 起单独 Task 进行**（清单来自 Task 5b 的扫描结果）。

- [ ] **Step 1: 对比 Python 与 Node 两份代码**

```bash
cd /Users/liuzhuo/Downloads/义妹生活
diff -u scripts/extras_cleaner.py \
        epub-clean-js/books/yimei-seikatsu/migrate/extras-cleaner.js \
  > /tmp/extras-diff.txt 2>&1 || true
wc -l scripts/extras_cleaner.py epub-clean-js/books/yimei-seikatsu/migrate/extras-cleaner.js
```

Expected：Python 246 行、Node 70 行。

- [ ] **Step 2: 列出 Python 中所有函数清单**

```bash
grep -nE "^def |^    def " /Users/liuzhuo/Downloads/义妹生活/scripts/extras_cleaner.py
```

Expected：列出所有 def，形如：
```
12:def build_cover(...)
24:def build_title(...)
...
```

记下函数清单。

- [ ] **Step 3: 列出 Node 中所有 export 清单**

```bash
grep -nE "^export |^function " /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/books/yimei-seikatsu/migrate/extras-cleaner.js
```

对比 Python 与 Node 的函数清单，标出 Node 缺失的函数。

- [ ] **Step 4: 把 Python 缺失逻辑逐函数移植**

对每个 Node 缺失的函数：

a. 读 Python 源码（offset+limit，避免一次性读全文件）：

```bash
# 假设缺 build_message，先 grep 找到行号
grep -n "def build_message" /Users/liuzhuo/Downloads/义妹生活/scripts/extras_cleaner.py
# 然后用 Read 工具按 offset+limit 读那段
```

b. 用 Edit 工具往 `extras-cleaner.js` 加等价 Node 实现。

c. 加一条 fixture 单测验证。

按函数顺序：cover → title → message → summary → contents → pre → TOC → specials → 其他。

每函数完成后跑一次：

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
node --test test/unit/yimei-seikatsu/extras-cleaner.test.js
```

- [ ] **Step 5: 验证特典渲染（special0001 含注释 + special0002/3 无注释）**

写单测：

```js
test("buildSpecials: special0001 含注释保留 aside 块", async () => {
  // 用 golden-py 里的 special0001.xhtml 做参考
  const goldenPath = "test/fixtures/yimei09/golden-py/OEBPS/Text/special0001.xhtml";
  const golden = await readFile(goldenPath, "utf8");
  // 调用 buildSpecials 传入 DST 解包目录 + profile.specials.09
  const out = await buildSpecials({ ... });
  // 检查输出与 golden 文本一致（normalized）
  assert.strictEqual(normalize(out.special0001), normalize(golden));
});
```

- [ ] **Step 6: 全量跑 extras-cleaner 单测**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
node --test --test-reporter=spec test/unit/yimei-seikatsu/extras-cleaner.test.js
```

Expected：所有 case PASS。

- [ ] **Step 7: 跑全部单测确认无回归**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
npm run test:unit
```

Expected：所有 11 个测试文件全 PASS。

- [ ] **Step 8: Checkpoint**

extras-cleaner 行数应该接近 200-250 行（与 Python 同量级）；所有附章生成函数与 Python 等价。

---

## Task 9b：paragraph-extractor.js 补 aside 跳过逻辑

**Files:**
- Modify: `epub-clean-js/books/yimei-seikatsu/migrate/paragraph-extractor.js`
- Test: `epub-clean-js/test/unit/yimei-seikatsu/paragraph-extractor.test.js`

> **Bug 起源**：Python 已修过 paragraph_extractor 跳过 aside 祖先内的 `<p>`（避免把注释正文段误抽为正文段），但 Node 半成品 `yimei-epub-migrate/src/paragraphExtractor.js` 没同步这个修复。
> **当前成品状态**：Python 跑出的当前 `[09.台简].epub` 没暴露此 bug（因为 chapter_renderer 渲染前 SRC 不含 aside）。但 Node 版直接跑可能在某些场景触发（DST 含 aside、或复跑成品作为输入时）。

- [ ] **Step 1: 看现有 paragraph-extractor.js 当前实现**

```bash
cat /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/books/yimei-seikatsu/migrate/paragraph-extractor.js
```

应该看到只跳过 rt，没有 aside 跳过逻辑。

- [ ] **Step 2: 加 aside 跳过逻辑**

Edit `paragraph-extractor.js`，在 `extractParagraphs` 函数内的 `for (const p of document.querySelectorAll('p'))` 循环顶部加：

```js
  for (const p of document.querySelectorAll('p')) {
    // 跳过 aside 祖先内的 p（注释正文，由 footnote-extractor 单独处理，不算正文段）
    if (p.closest('aside')) continue;

    // 丢掉所有 rt 子节点（ruby 注音）
    for (const rt of [...p.querySelectorAll('rt')]) {
      rt.remove();
    }
    const text = (p.textContent ?? '').trim();
    if (text) paragraphs.push(text);
  }
```

文件头的 docstring 同步更新加上 `- 跳过 aside 内的 p（注释正文，由 footnote-extractor 单独处理）`。

- [ ] **Step 3: 写单测覆盖 aside 跳过场景**

Edit `epub-clean-js/test/unit/yimei-seikatsu/paragraph-extractor.test.js`，追加：

```js
import { test } from "node:test";
import assert from "node:assert";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractParagraphs } from "../../../books/yimei-seikatsu/migrate/paragraph-extractor.js";

test("extractParagraphs: 跳过 aside 内的 <p>（注释正文不算正文段）", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "para-aside-"));
  const file = path.join(tmp, "ch.xhtml");

  await writeFile(file, `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>t</title></head>
<body>
  <p>正文段一</p>
  <p>正文段二<sub><a class="duokan-footnote" epub:type="noteref" href="#n1" id="r1">1</a></sub></p>
  <aside epub:type="footnote" id="n1">
    <ol class="duokan-footnote-content">
      <li class="duokan-footnote-item" id="n1">
        <p><a href="#r1">注1</a>：这段不应被抽出作为正文</p>
      </li>
    </ol>
  </aside>
  <p>正文段三</p>
</body>
</html>`);

  const paras = extractParagraphs(file);
  await rm(tmp, { recursive: true });

  assert.deepStrictEqual(paras, ["正文段一", "正文段二1", "正文段三"]);
  // 关键：注释段 "注1：这段不应被抽出..." 不应出现
  assert.ok(!paras.some(p => p.includes("不应被抽出")), "注释正文段被误抽");
});

test("extractParagraphs: 嵌套 aside > ol > li > p 也跳过", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "para-aside-nested-"));
  const file = path.join(tmp, "ch.xhtml");
  await writeFile(file, `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <p>A</p>
  <aside><div><ol><li><p>注：深嵌套也要跳过</p></li></ol></div></aside>
  <p>B</p>
</body>
</html>`);
  const paras = extractParagraphs(file);
  await rm(tmp, { recursive: true });
  assert.deepStrictEqual(paras, ["A", "B"]);
});
```

- [ ] **Step 4: 跑单测**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
node --test --test-reporter=spec test/unit/yimei-seikatsu/paragraph-extractor.test.js
```

Expected：新增 2 个 case PASS（已有 case 仍然 PASS）。

- [ ] **Step 5: 跑全部单测确认无回归**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
npm run test:unit 2>&1 | tail -10
```

Expected：所有测试 PASS。

- [ ] **Step 6: Checkpoint**

paragraph-extractor 与 Python 对齐。在 `docs/python-node-diff.md` 把这条标记为已修复（划掉或加 ✅）。

---

## Task 10：写 e2e 测试 migrate-translation.e2e.test.js

**Files:**
- Create: `epub-clean-js/test/e2e/migrate-translation.e2e.test.js`
- Create: `epub-clean-js/test/e2e/_helpers/diff.js`

- [ ] **Step 1: 写 normalized hash 助手**

```js
// epub-clean-js/test/e2e/_helpers/diff.js
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export async function walk(dir, base = dir) {
  const ents = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out.sort();
}

export function normalize(buf, ext) {
  const isText = [".xhtml", ".html", ".xml", ".opf", ".ncx", ".css", ".js"].includes(ext);
  if (!isText) return buf;
  let s = buf.toString("utf8");
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n[ \t]*\n+/g, "\n");
  s = s.replace(/<meta[^>]*name=["']calibre:[^"']*["'][^/]*\/?>/gi, "");
  return Buffer.from(s, "utf8");
}

export async function hashFile(filePath) {
  const buf = await readFile(filePath);
  const ext = path.extname(filePath);
  return createHash("sha256").update(normalize(buf, ext)).digest("hex");
}
```

- [ ] **Step 2: 写 e2e 测试**

```js
// epub-clean-js/test/e2e/migrate-translation.e2e.test.js
import { test } from "node:test";
import assert from "node:assert";
import { readFile, rm, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { walk, hashFile } from "./_helpers/diff.js";

const PROJ = "/Users/liuzhuo/Downloads/义妹生活";
const SRC  = `${PROJ}/义妹生活 - 09台简粗糙排版.epub`;
const DST  = `${PROJ}/[三河ごーすと].义妹生活.09.[日翻].epub`;
const REF  = `${PROJ}/[三河ごーすと].义妹生活.07.[台简].epub`;
const OUT  = "/tmp/yimei09-node-output.epub";
const UNPACK = "/tmp/yimei09-node-unpacked";

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "pipe", ...opts });
    let stdout = "", stderr = "";
    p.stdout.on("data", d => stdout += d);
    p.stderr.on("data", d => stderr += d);
    p.on("close", code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exit ${code}: ${stderr}`)));
  });
}

test("e2e: migrate-translation 输出与 golden manifest 一致", { timeout: 120_000 }, async () => {
  // 1. 跑 CLI
  await rm(OUT, { force: true });
  await run("node", ["bin/cli.js", "migrate-translation",
    "--src", SRC, "--dst", DST, "--ref", REF, "--out", OUT,
    "--volume", "09", "--book", "yimei-seikatsu",
  ], { cwd: path.resolve(import.meta.dirname, "../..") });

  // 2. 解包输出
  await rm(UNPACK, { recursive: true, force: true });
  await mkdir(UNPACK, { recursive: true });
  await run("unzip", ["-q", OUT, "-d", UNPACK]);

  // 3. 读 golden manifest
  const manifest = JSON.parse(await readFile(
    path.resolve(import.meta.dirname, "../fixtures/yimei09/golden-manifest.json"), "utf8"));

  // 4. 逐文件比对 hash
  const mismatches = [];
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const fp = path.join(UNPACK, rel);
    let actual;
    try {
      actual = await hashFile(fp);
    } catch (e) {
      mismatches.push({ rel, reason: "missing", err: e.message });
      continue;
    }
    if (actual !== expected.sha256_normalized) {
      mismatches.push({ rel, reason: "hash", expected: expected.sha256_normalized, actual });
    }
  }

  // 5. 报告差异
  if (mismatches.length > 0) {
    console.error("Mismatches:");
    for (const m of mismatches.slice(0, 10)) {
      console.error(`  ${m.rel}: ${m.reason}`);
    }
    console.error(`Total mismatches: ${mismatches.length} / ${Object.keys(manifest.files).length}`);
  }
  assert.strictEqual(mismatches.length, 0, `${mismatches.length} files differ from golden`);
});
```

- [ ] **Step 3: 第一次跑 e2e（预期失败 — extras 仍未完全对齐 或 chapter renderer 仍有差异）**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
node --test --test-reporter=spec test/e2e/migrate-translation.e2e.test.js 2>&1 | tail -40
```

Expected：可能 FAIL，会列出 mismatches。继续到 Step 4 收敛。

- [ ] **Step 4: 按 mismatch 类型修复**

对每个 mismatch：
- `missing`：Node 没生成这个文件 → 找到对应 stage 检查为什么没输出
- `hash`：内容不同 → 解包 golden + Node 输出对比

调试时用：

```bash
diff -u /tmp/yimei09-node-unpacked/OEBPS/Text/<file> \
        /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/test/fixtures/yimei09/golden-py/OEBPS/Text/<file> \
        | head -40
```

修完一类 mismatch 重跑 e2e，直到全 PASS。

- [ ] **Step 5: e2e PASS 后 Checkpoint**

```bash
ls -la /tmp/yimei09-node-output.epub
```

Expected：能看到 Node 产物 .epub。

---

## Task 11：Phase 1 验收闭环

**Files:**
- (验证现有)

- [ ] **Step 1: 跑全部测试**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
npm test 2>&1 | tail -20
```

Expected：所有 unit + e2e 全 PASS。

- [ ] **Step 2: epubcheck 验证（如本机有 epubcheck）**

```bash
which epubcheck && epubcheck /tmp/yimei09-node-output.epub 2>&1 | tail -10
```

Expected：错误数 ≤ 41（与 Python 版同量级），全部是多看/掌阅私有属性的已知妥协。

如果本机没装 epubcheck，跳过这步（用 spec 中的「epubcheck 错误数 ≤ 41」作为后续手工检查项）。

- [ ] **Step 3: 手工阅读器验证（用户操作）**

提示用户：
> 请用 macOS Books 或多看阅读器打开 `/tmp/yimei09-node-output.epub`，验证：
> 1. 翻到第 8-9 页，确认引言不再重复
> 2. 翻到 chapter0001 开头，确认第一段是「拖着大行李箱…」
> 3. 随机翻几个注释点击看能否弹出
> 4. TOC 章节齐全

如果用户报告问题，回到对应 Task 修复。

- [ ] **Step 4: 替换正式产物**

确认 Node 产物与 golden 一致后：

```bash
cd /Users/liuzhuo/Downloads/义妹生活
cp "[三河ごーすと].义妹生活.09.[台简].epub" "[三河ごーすと].义妹生活.09.[台简].py-baseline.epub"
cp /tmp/yimei09-node-output.epub "[三河ごーすと].义妹生活.09.[台简].epub"
ls -la *.epub | head -5
```

Expected：
- 当前 `[09.台简].epub` 是 Node 版输出
- `[09.台简].py-baseline.epub` 是 Python 版备份

- [ ] **Step 5: Phase 1 验收 Checkpoint**

写一份验收记录：

```bash
cat > /Users/liuzhuo/Downloads/义妹生活/docs/superpowers/phase1-acceptance.md <<EOF
# Phase 1 验收记录

日期：$(date -u +%Y-%m-%dT%H:%M:%SZ)

- npm test 全绿 (unit + e2e)
- e2e 输出与 golden manifest 100% hash 一致
- 阅读器手工验证通过（引言不重复、注释可点）
- 当前正式产物 [09.台简].epub 已替换为 Node 版输出
- Python 版备份：[09.台简].py-baseline.epub

下一步：进入 Phase 2 — 抽取通用 footnote-fix 子流。
EOF
cat /Users/liuzhuo/Downloads/义妹生活/docs/superpowers/phase1-acceptance.md
```

---

# Phase 2：抽取通用 footnote-fix 子流

## Task 12：识别 footnote 处理代码中的通用/业务边界

**Files:** (analysis, no file changes)

- [ ] **Step 1: 读 footnote-cleaner.js 当前实现**

```bash
cat /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/books/yimei-seikatsu/migrate/footnote-cleaner.js
```

- [ ] **Step 2: 标记每段代码是通用 vs 业务**

逐行注释或在草稿里记下：
- **通用**（应抽到 `core/stages/footnote-fix.js`）：
  - 抽取既有 footnote 锚点（无论 calibre / duokan / epub3 标准 / 私有格式）
  - 重新编号 noteNNN/note_refNNN（每章独立）
  - 渲染 09 台简风格 `<sub><a class="duokan-footnote">` + `<aside>`
  - note.webp/note1.webp 区分（如果通用化为「按 zy-footnote 内容前缀『评：』触发 note1.webp」）
- **业务**（保留在 `books/yimei-seikatsu/migrate/footnote-cleaner.js`）：
  - 调用 footnote-relocator 的逻辑（依赖段落对齐）
  - 义妹生活特定的注释偏好

- [ ] **Step 3: 写边界标注文档**

```bash
cat > /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/src/core/stages/footnote-fix.boundary.md <<EOF
# footnote-fix 通用/业务边界

## 通用（core/stages/footnote-fix.js）
- 抽取既有 footnote 锚点
- 重新编号 noteNNN/note_refNNN（每章独立）
- 渲染 09 台简风格 sub+aside
- note.webp/note1.webp 区分规则：zy-footnote 文本以「评：」开头用 note1.webp

## 业务（books/yimei-seikatsu/migrate/footnote-cleaner.js）
- 调用 footnote-relocator 定位插入点
- (后续按需添加)
EOF
```

- [ ] **Step 4: Checkpoint**

边界文档落盘。

---

## Task 13：新建 `src/core/stages/footnote-fix.js`

**Files:**
- Create: `epub-clean-js/src/core/stages/footnote-fix.js`

- [ ] **Step 1: 写 footnote-fix.js（通用版）**

```js
// epub-clean-js/src/core/stages/footnote-fix.js
import { parseHTML } from "linkedom";

const NOTE_ICON_REGULAR = "note.webp";  // 注：（客观注释）
const NOTE_ICON_REVIEW  = "note1.webp"; // 评：（译者评论）

/**
 * 升级章节 XHTML 内的注释为 09 台简风格。
 *
 * 输入：原始 XHTML 文本，可能含 calibre / duokan / epub3 标准 / 私有格式的注释
 * 输出：升级后的 XHTML 文本，全部统一为：
 *   <sub><a class="duokan-footnote" epub:type="noteref" href="#noteNNN" id="note_refNNN">
 *     <img width="25" alt="note" class="zhangyue-footnote" src="../Images/note.webp" zy-footnote="..."/>
 *   </a></sub>
 *   <aside epub:type="footnote" id="noteNNN">
 *     <ol class="duokan-footnote-content" style="list-style:none">
 *       <li class="duokan-footnote-item" id="noteNNN">
 *         <p><a href="#note_refNNN">注N</a>：...</p>
 *       </li>
 *     </ol>
 *   </aside>
 *
 * @param {string} xhtml
 * @param {object} [opts]
 * @param {string} [opts.imagesPathPrefix="../Images/"] 图标资源前缀
 * @returns {string} 升级后 XHTML
 */
export function upgradeFootnotes(xhtml, opts = {}) {
  const { imagesPathPrefix = "../Images/" } = opts;
  const { document } = parseHTML(xhtml);

  // 找出所有现有 footnote 锚点（兼容多种历史格式）
  // ...具体实现：参考 books/yimei-seikatsu/migrate/footnote-cleaner.js 抽取部分

  // 重新编号
  let counter = 0;
  for (const anchor of /* 找到的锚点列表 */ []) {
    counter++;
    const noteId = `note${String(counter).padStart(3, "0")}`;
    const refId  = `note_ref${String(counter).padStart(3, "0")}`;
    const body   = anchor.getAttribute("data-original-body") || "";
    const isReview = body.trim().startsWith("评：");
    const icon = isReview ? NOTE_ICON_REVIEW : NOTE_ICON_REGULAR;

    // 替换锚点
    const newSub = document.createElement("sub");
    newSub.innerHTML = `<a class="duokan-footnote" epub:type="noteref" href="#${noteId}" id="${refId}"><img width="25" alt="note" class="zhangyue-footnote" src="${imagesPathPrefix}${icon}" zy-footnote="${body}"/></a>`;
    anchor.replaceWith(newSub);

    // 在 body 末尾追加 aside
    const aside = document.createElement("aside");
    aside.setAttribute("epub:type", "footnote");
    aside.setAttribute("id", noteId);
    aside.innerHTML = `<ol class="duokan-footnote-content" style="list-style:none"><li class="duokan-footnote-item" id="${noteId}"><p><a href="#${refId}">注${counter}</a>：${body}</p></li></ol>`;
    document.body.appendChild(aside);
  }

  return document.toString();
}

/**
 * 升级整本 epub 的所有章节注释。
 * @param {string} inEpubPath
 * @param {string} outEpubPath
 * @param {object} [opts]
 */
export async function footnoteFixEpub(inEpubPath, outEpubPath, opts = {}) {
  // 1. 解包 inEpubPath 到临时目录
  // 2. 找出 OEBPS/Text/*.xhtml
  // 3. 对每个章节调用 upgradeFootnotes
  // 4. 重打包到 outEpubPath
  // 实现细节复用 core/zip-io.js
  throw new Error("TODO: implement after Task 13.4");
}
```

> ⚠ 这一步只写骨架与契约，具体抽取逻辑在 Step 2-4 完成。

- [ ] **Step 2: 实现「找出所有现有 footnote 锚点」**

观察 books/yimei-seikatsu/migrate/footnote-cleaner.js 中如何识别既有锚点（搜索 `epub:type="noteref"` 或 `class="footnote"` 或 `<sup>` 等）。把识别逻辑迁移到 `upgradeFootnotes`，写成抽取函数：

```js
function findExistingAnchors(document) {
  // 多种兼容性识别：
  return [
    ...document.querySelectorAll('a[epub\\:type="noteref"]'),
    ...document.querySelectorAll('a.calibre-footnote'),
    ...document.querySelectorAll('a.duokan-footnote'),
    // 其他历史格式
  ];
}
```

- [ ] **Step 3: 实现「抽取注释正文」**

每个锚点需要从原文档中找到配对的 aside / footnote body：

```js
function extractBody(anchor, document) {
  const href = anchor.getAttribute("href");
  if (!href || !href.startsWith("#")) return "";
  const target = document.getElementById(href.slice(1));
  if (!target) return "";
  return target.textContent.trim();
}
```

- [ ] **Step 4: 实现 footnoteFixEpub（整本升级）**

```js
import { unzip, zipMimetype } from "../zip-io.js"; // 复用既有
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

export async function footnoteFixEpub(inEpubPath, outEpubPath, opts = {}) {
  const workDir = `/tmp/footnote-fix-${Date.now()}`;
  await unzip(inEpubPath, workDir);

  const textDir = path.join(workDir, "OEBPS", "Text");
  // 兼容 EPUB 中其他文本位置
  const candidates = [textDir, path.join(workDir, "Text")];
  let actualTextDir = null;
  for (const c of candidates) {
    try { await readdir(c); actualTextDir = c; break; } catch {}
  }
  if (!actualTextDir) throw new Error("找不到章节文本目录");

  const files = (await readdir(actualTextDir)).filter(f => f.endsWith(".xhtml"));
  for (const f of files) {
    const fp = path.join(actualTextDir, f);
    const xhtml = await readFile(fp, "utf8");
    const upgraded = upgradeFootnotes(xhtml, opts);
    await writeFile(fp, upgraded);
  }

  await zipMimetype(workDir, outEpubPath);
}
```

- [ ] **Step 5: Checkpoint**

`footnote-fix.js` 骨架 + 主要函数实现完成。

---

## Task 14：把 `books/.../footnote-cleaner.js` 改为薄包装

**Files:**
- Modify: `epub-clean-js/books/yimei-seikatsu/migrate/footnote-cleaner.js`

- [ ] **Step 1: 改写 footnote-cleaner.js 为薄包装**

```js
// epub-clean-js/books/yimei-seikatsu/migrate/footnote-cleaner.js
// 通用注释升级委托给 core，本文件只保留义妹生活特定的封装
import { upgradeFootnotes as coreUpgrade } from "../../../src/core/stages/footnote-fix.js";

/**
 * 义妹生活专用：调用通用升级 + 卷特定预处理
 */
export function upgradeFootnotes(xhtml, opts = {}) {
  // 当前没有义妹特定预处理，直接转发
  return coreUpgrade(xhtml, opts);
}

export default upgradeFootnotes;
```

- [ ] **Step 2: 跑单测确认无回归**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
node --test test/unit/yimei-seikatsu/footnote-cleaner.test.js
```

Expected：所有 case PASS。

- [ ] **Step 3: 跑 e2e 确认 migrate-translation 仍 100% golden hash 一致**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
node --test test/e2e/migrate-translation.e2e.test.js 2>&1 | tail -10
```

Expected：FAIL = 0。**这是 Phase 2 最关键的检查点：footnote-fix 抽取后不能破坏 Phase 1 黄金基线。**

- [ ] **Step 4: Checkpoint**

footnote-cleaner.js 已委托 core；migrate-translation e2e 仍 PASS。

---

## Task 15：写 `src/entries/footnote-fix.js` (CLI)

**Files:**
- Create: `epub-clean-js/src/entries/footnote-fix.js`

- [ ] **Step 1: 写 entries/footnote-fix.js**

```js
// epub-clean-js/src/entries/footnote-fix.js
import { parseArgs } from "node:util";
import path from "node:path";
import { footnoteFixEpub } from "../core/stages/footnote-fix.js";

const { values: opts } = parseArgs({
  options: {
    in:                  { type: "string" },
    out:                 { type: "string" },
    "images-path-prefix":{ type: "string", default: "../Images/" },
  },
  strict: true,
});

if (!opts.in || !opts.out) {
  console.error("Usage: footnote-fix --in <input.epub> --out <output.epub>");
  process.exit(2);
}

await footnoteFixEpub(path.resolve(opts.in), path.resolve(opts.out), {
  imagesPathPrefix: opts["images-path-prefix"],
});

console.log("footnote-fix 完成:", opts.out);
```

- [ ] **Step 2: 验证 CLI**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
node bin/cli.js footnote-fix 2>&1
```

Expected：报 `Usage:` 然后 exit code 2。

- [ ] **Step 3: Checkpoint**

footnote-fix CLI 接通。

---

## Task 16：写 footnote-fix e2e 测试

**Files:**
- Create: `epub-clean-js/test/e2e/footnote-fix.e2e.test.js`
- Create: `epub-clean-js/test/fixtures/footnote-fix/input.epub` (mini fixture)
- Create: `epub-clean-js/test/fixtures/footnote-fix/expected.epub` (mini fixture)

- [ ] **Step 1: 准备 mini input fixture**

可以用一个简化的 mini EPUB：1 章 + 2 个注释（混合 calibre 与 duokan 格式）。或者用 `[三河ごーすと].义妹生活.10.[台简].epub`（已是台版但可能格式略有差异）作为 input，把它的注释升级看输出。

简便做法：复用现有 `test_footnote_epubs/V3-duokan-minimal.epub` 作为 input fixture。

```bash
ls /Users/liuzhuo/Downloads/义妹生活/test_footnote_epubs/
```

Expected：看到 V1-V8 8 个测试 epub。

- [ ] **Step 2: 写 e2e 测试**

```js
// epub-clean-js/test/e2e/footnote-fix.e2e.test.js
import { test } from "node:test";
import assert from "node:assert";
import { readFile, rm, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const IN  = "/Users/liuzhuo/Downloads/义妹生活/test_footnote_epubs/V3-duokan-minimal.epub";
const OUT = "/tmp/footnote-fix-test.epub";
const UNPACK = "/tmp/footnote-fix-test-unpacked";

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "pipe", ...opts });
    let stderr = "";
    p.stderr.on("data", d => stderr += d);
    p.on("close", code => code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}: ${stderr}`)));
  });
}

test("e2e: footnote-fix 升级任意 epub 注释", { timeout: 60_000 }, async () => {
  await rm(OUT, { force: true });
  await run("node", ["bin/cli.js", "footnote-fix", "--in", IN, "--out", OUT], {
    cwd: path.resolve(import.meta.dirname, "../.."),
  });

  await rm(UNPACK, { recursive: true, force: true });
  await mkdir(UNPACK, { recursive: true });
  await run("unzip", ["-q", OUT, "-d", UNPACK]);

  // 验证：每章应该都有配对的 sub+aside；id 编号每章独立
  // ...
  const xhtml = await readFile(path.join(UNPACK, "OEBPS/Text/chapter1.xhtml"), "utf8");
  assert.match(xhtml, /<sub><a class="duokan-footnote" epub:type="noteref"/);
  assert.match(xhtml, /<aside epub:type="footnote" id="note001"/);
  assert.match(xhtml, /<li class="duokan-footnote-item" id="note001"/);
});
```

- [ ] **Step 3: 跑 e2e**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
node --test --test-reporter=spec test/e2e/footnote-fix.e2e.test.js
```

Expected：PASS。若 FAIL，根据错误调整 upgradeFootnotes 实现（特别是识别历史格式的部分）。

- [ ] **Step 4: Checkpoint**

footnote-fix 通用子流 e2e 测试 PASS。

---

## Task 17：Phase 2 验收

- [ ] **Step 1: 跑全部测试**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
npm test 2>&1 | tail -20
```

Expected：所有 unit + 2 个 e2e (migrate-translation, footnote-fix) 全 PASS。

- [ ] **Step 2: 再次跑 migrate-translation e2e 确认 golden 仍 100% 一致**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
node --test test/e2e/migrate-translation.e2e.test.js 2>&1 | tail -10
```

Expected：mismatch = 0。

- [ ] **Step 3: 写 Phase 2 验收记录**

```bash
cat > /Users/liuzhuo/Downloads/义妹生活/docs/superpowers/phase2-acceptance.md <<EOF
# Phase 2 验收记录

日期：$(date -u +%Y-%m-%dT%H:%M:%SZ)

- footnote-fix 通用子流上线：core/stages/footnote-fix.js
- CLI 接通：node bin/cli.js footnote-fix --in x.epub --out y.epub
- footnote-cleaner.js 改为薄包装委托 core
- migrate-translation e2e 仍 100% golden hash 一致
- footnote-fix e2e 单独 PASS

下一步：进入 Phase 3 — 归档清理。
EOF
cat /Users/liuzhuo/Downloads/义妹生活/docs/superpowers/phase2-acceptance.md
```

---

# Phase 3：归档清理

## Task 18：归档 Python scripts/ + tests/

**Files:**
- Move: `/Users/liuzhuo/Downloads/义妹生活/scripts/` → `epub-clean-js/archive/scripts-py/`
- Move: `/Users/liuzhuo/Downloads/义妹生活/tests/` → `epub-clean-js/archive/scripts-py-tests/`
- Move: `/Users/liuzhuo/Downloads/义妹生活/requirements.txt` → `epub-clean-js/archive/scripts-py/`

- [ ] **Step 1: 确认 Phase 2 全过、e2e 全绿**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
npm test 2>&1 | tail -10
```

Expected：所有测试 PASS。如果有 FAIL，**不能进 Phase 3**，先回到对应 Phase 修复。

- [ ] **Step 2: 备份再 mv**

```bash
cd /Users/liuzhuo/Downloads/义妹生活
mkdir -p epub-clean-js/archive
mv scripts epub-clean-js/archive/scripts-py
mv tests   epub-clean-js/archive/scripts-py-tests
mv requirements.txt epub-clean-js/archive/scripts-py/requirements.txt
ls epub-clean-js/archive/
```

Expected：`scripts-py/`、`scripts-py-tests/` 都存在，原位置已消失。

- [ ] **Step 3: 在 archive/ 内加 README**

```bash
cat > /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/archive/scripts-py/README.md <<EOF
# scripts-py 归档说明

这是义妹生活 09 卷迁移管线的 Python 原始实现，已被 Node ESM 版本替代。

- 归档日期：$(date -u +%Y-%m-%dT%H:%M:%SZ)
- 等价 Node 实现：../../books/yimei-seikatsu/migrate/
- 设计文档：../../../../docs/superpowers/specs/2026-05-22-py-to-node-migration-design.md
- 实施计划：../../../../docs/superpowers/plans/2026-05-22-py-to-node-migration.md

如需运行：
\`\`\`bash
cd scripts-py
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python migrate_epub.py --help
\`\`\`

> ⚠ 仅作历史参考，已不再维护。Bug 修复请改 Node 版。
EOF
```

- [ ] **Step 4: Checkpoint**

```bash
ls /Users/liuzhuo/Downloads/义妹生活/
```

Expected：原 scripts/ 与 tests/ 消失，根目录更干净。

---

## Task 19：归档 yimei-epub-migrate/

**Files:**
- Move: `/Users/liuzhuo/Downloads/义妹生活/yimei-epub-migrate/` → `epub-clean-js/archive/yimei-epub-migrate-old/`

- [ ] **Step 1: 确认 books/yimei-seikatsu/migrate/ 内 12 模块齐全**

```bash
ls /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/books/yimei-seikatsu/migrate/
```

Expected：12 个 .js 文件 + templates/。

- [ ] **Step 2: 确认 test/unit/yimei-seikatsu/ 内 11 单测齐全**

```bash
ls /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/test/unit/yimei-seikatsu/
```

Expected：11 个 .test.js + fixtures/。

- [ ] **Step 3: mv 整个 yimei-epub-migrate/ 目录到 archive/**

```bash
cd /Users/liuzhuo/Downloads/义妹生活
mv yimei-epub-migrate epub-clean-js/archive/yimei-epub-migrate-old
ls epub-clean-js/archive/
```

Expected：archive/ 内有 scripts-py/、scripts-py-tests/、yimei-epub-migrate-old/。

- [ ] **Step 4: 删 yimei-epub-migrate-old/node_modules（节省磁盘）**

```bash
rm -rf /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/archive/yimei-epub-migrate-old/node_modules
du -sh /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/archive/yimei-epub-migrate-old
```

Expected：归档大小 < 1MB（源码 + 测试 + package.json）。

- [ ] **Step 5: 在 archive 加 README**

```bash
cat > /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/archive/yimei-epub-migrate-old/README.md <<EOF
# yimei-epub-migrate-old 归档说明

这是义妹生活 09 卷迁移管线的 Node 半成品移植（Python 流程的初步移植版本），现已并入 epub-clean-js/。

- 归档日期：$(date -u +%Y-%m-%dT%H:%M:%SZ)
- 现位置：
  - 模块：../../books/yimei-seikatsu/migrate/
  - 单测：../../test/unit/yimei-seikatsu/
- 与归档版的差异：合并后 extras-cleaner.js 已对齐 Python 246 行的完整逻辑，加入了引言去重 hash 判定。

> ⚠ 仅作历史参考，已不再维护。
EOF
```

- [ ] **Step 6: 跑 npm test 确认 archive 后无影响**

```bash
cd /Users/liuzhuo/Downloads/义妹生活/epub-clean-js
npm test 2>&1 | tail -10
```

Expected：所有测试 PASS。

- [ ] **Step 7: Checkpoint**

归档完成，工程仍然全绿。

---

## Task 20：更新 docs/

**Files:**
- Create: `docs/migration-completion.md`
- Modify: `docs/superpowers/specs/2026-05-22-py-to-node-migration-design.md` (status → completed)

- [ ] **Step 1: 写 migration-completion.md**

```bash
cat > /Users/liuzhuo/Downloads/义妹生活/docs/migration-completion.md <<'EOF'
# Python → Node 迁移完成记录

## 时间
- Phase 1 完成：（按 Phase 1 验收记录日期）
- Phase 2 完成：（按 Phase 2 验收记录日期）
- Phase 3 完成：（本文件创建日期）

## 行数对照
- Python `scripts/`：1650 行（13 模块）
- Node `epub-clean-js/books/yimei-seikatsu/migrate/`：约 1500-1700 行（12 模块，extras-cleaner 已对齐）
- 新增：`src/core/stages/footnote-fix.js`（通用子流，约 100-150 行）

## golden hash 索引
所有 Node 输出必须与 `test/fixtures/yimei09/golden-manifest.json` 100% 一致。SAFE 副本保留在
`test/fixtures/yimei09/golden-manifest.SAFE.json`，作为绝对基线。

## CLI 命令一览
- `node bin/cli.js strip`               — 反混淆（11-15 用）
- `node bin/cli.js heal`                — 路径修复（11-15 用）
- `node bin/cli.js align`               — 排版对齐（11-15 用）
- `node bin/cli.js all`                 — strip+heal+align（11-15 用）
- `node bin/cli.js migrate-translation` — 台版译文 → 日翻容器（义妹生活专用）
- `node bin/cli.js footnote-fix`        — 注释升级到 09 台简风格（通用）

## 归档位置
- `epub-clean-js/archive/scripts-py/` — 原 Python 实现
- `epub-clean-js/archive/scripts-py-tests/` — 原 Python 测试
- `epub-clean-js/archive/yimei-epub-migrate-old/` — Node 半成品移植版

## 已知遗留
- 09 卷 7 条 LOW + 1 条 MEDIUM 注释定位置信度需要人工复核（见 `align_report.md`）。
  修复入口：编辑 `epub-clean-js/books/yimei-seikatsu/profile.js` 的
  `footnoteOverrides["09"]`，下次重跑 migrate-translation 时自动应用。

EOF
cat /Users/liuzhuo/Downloads/义妹生活/docs/migration-completion.md
```

- [ ] **Step 2: 更新 spec status**

Edit `/Users/liuzhuo/Downloads/义妹生活/docs/superpowers/specs/2026-05-22-py-to-node-migration-design.md`：

把 `status: approved (...)` 改为 `status: completed (Phase 1-3 全过)`。

- [ ] **Step 3: Checkpoint**

文档已更新。

---

## Task 21：更新 README

**Files:**
- Modify: `epub-clean-js/README.md`（若已存在）或 Create

- [ ] **Step 1: 看 README 现状**

```bash
ls /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/README.md 2>/dev/null && \
  cat /Users/liuzhuo/Downloads/义妹生活/epub-clean-js/README.md || \
  echo "README 不存在，需新建"
```

- [ ] **Step 2: 写 / 更新 README**

写入 `epub-clean-js/README.md`：

```markdown
# epub-clean-js

义妹生活 EPUB 处理工具集。Node ESM 实现。

## 子命令

| 命令 | 作用 |
|---|---|
| `strip`  | 反混淆（11-15 卷多看商店版用） |
| `heal`   | 路径修复 |
| `align`  | 排版对齐 |
| `all`    | strip + heal + align 串跑 |
| `migrate-translation` | 把台版译文迁移到日翻 epub 容器，套用 STERA 排版（义妹生活 09 卷专用） |
| `footnote-fix` | 把任意 epub 的注释升级到 09 台简风格（通用） |

## 用法

### migrate-translation（09 卷）

```bash
node bin/cli.js migrate-translation \
  --src "义妹生活 - 09台简粗糙排版.epub" \
  --dst "[三河ごーすと].义妹生活.09.[日翻].epub" \
  --ref "[三河ごーすと].义妹生活.07.[台简].epub" \
  --out "[三河ごーすと].义妹生活.09.[台简].epub" \
  --volume 09 \
  --book yimei-seikatsu
```

### footnote-fix（任意 epub）

```bash
node bin/cli.js footnote-fix --in input.epub --out output.epub
```

## 测试

```bash
npm test          # unit + e2e
npm run test:unit # 只跑单测
npm run test:e2e  # 只跑 e2e
```

## 目录结构

参见 `docs/superpowers/specs/2026-05-22-py-to-node-migration-design.md`。

## 历史归档

- `archive/scripts-py/` — 原 Python 迁移管线
- `archive/yimei-epub-migrate-old/` — Node 半成品移植版（已合并入主工程）
```

- [ ] **Step 3: Checkpoint + Phase 3 完成**

```bash
cat > /Users/liuzhuo/Downloads/义妹生活/docs/superpowers/phase3-acceptance.md <<EOF
# Phase 3 验收记录

日期：$(date -u +%Y-%m-%dT%H:%M:%SZ)

- scripts/、tests/、requirements.txt 已归档到 archive/scripts-py(-tests)/
- yimei-epub-migrate/ 已归档到 archive/yimei-epub-migrate-old/
- docs/migration-completion.md 已写
- README.md 已更新
- npm test 全绿

## 迁移完成。
EOF
cat /Users/liuzhuo/Downloads/义妹生活/docs/superpowers/phase3-acceptance.md
```

---

# 自检清单（Plan 作者用，执行者跳过）

- [x] **Spec coverage**：检查 spec §3-§10 每节是否都被某个 Task 实现
  - §3 目录结构 → Task 0/4/5/7
  - §4 业务层设计 → Task 4/6/8/9
  - §5 Phase 1 详细 → Task 1-11
  - §6 Phase 2 footnote-fix → Task 12-17
  - §7 Phase 3 归档 → Task 18-21
  - §8 风险与缓解 → 散落在各 Task 的 Step 与 Checkpoint
  - §9 验收基线 → Task 11/17/21 验收 Step
- [x] **Placeholder scan**：扫了 TODO，仅 Task 13 Step 1 footnote-fix 骨架里写了 `throw new Error("TODO: implement after Task 13.4")`，是 explicit 待实现标记，Step 4 会替换掉
- [x] **Type consistency**：renderChapter / upgradeFootnotes / footnoteFixEpub 在所有 Task 中签名一致

---

# 执行约定

- **逐 Task 执行**：用 superpowers:subagent-driven-development 或 superpowers:executing-plans
- **非 git 仓库**：commit 步骤已替换为 Checkpoint。建议在每 Phase 末手动 `cp -r epub-clean-js epub-clean-js.bak-phase{N}` 备份
- **遇到 Phase 1 Task 5 / Task 9 单测失败**：不要硬塞过去，先理解 Python vs Node 差异，再决定补 Node 还是改测试期望
- **遇到 Phase 1 e2e (Task 10) golden hash mismatch**：每修一类立即重跑，不要积累多个差异一起调

---

# 下一步

执行此 plan 用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。
