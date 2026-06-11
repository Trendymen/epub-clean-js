# EPUB 流程拆分：通用修复 vs 书特定贴标 设计

**日期**：2026-05-22
**目标项目**：`epub-clean-js/`（Node.js）
**前置 spec**：`2026-05-22-epub-deobfuscate-clean-design.md`（已实现）

---

## 1. 背景与动机

当前 Node 项目实现了「原始 epub → clean.epub」一气呵成流程，但代码层职责混杂：

- `src/opf.js` 的 `patchOpfMetadata` 同时做「通用必要修复」（删 duokan/zhangyue id、补 BookId UUID、补 cover meta、更新 modified）和「书特定贴标」（`dc:rights="voidlord"`、硬编码日期 `2026-05-22`）
- `src/config.js` 同时含 EPUB 规范级常量（命名空间、MIME2EXT）和义妹生活特定路径模板（卷号、文件名）
- 用户最近发现一个 STERA 模板残留：CSS 中孤儿 `@font-face`（声明了 11-15 卷字体集里不存在的字体，url 含混淆字符），既不是 voidlord 私人指纹也不是反盗版，是多看打包遗留 + STERA 模板 dead code

需要重组架构，使得：

1. **核心修复（与本书无关）**与**书特定贴标**分开成独立 stage
2. 4 个 stage 可单独跑、可组合
3. 添加新书时只需新增 `books/<id>/profile.js`，core 零改动
4. 把「孤儿 @font-face 清理」纳入通用 heal stage（与本书无关，是多看共性遗留）

## 2. 目标

1. 重构当前 `src/` 为 `src/core/` + `src/entries/` + `books/<id>/` 三层架构
2. 4 个 npm scripts：`strip` / `heal` / `align` / `start`，每个独立可跑
3. `src/core/` 不依赖 `books/`，可作为通用多看 EPUB 修复工具
4. 当前 5 卷产物（11-15 clean.epub）功能等价，CSS 行数减少（孤儿 @font-face 被清）

## 3. 非目标（YAGNI）

- 不引入测试框架（pytest/vitest/jest）
- 不做 profile schema 校验（Ajv 等）
- 不做 profile 继承/合并 / `--book=<id>` CLI 参数
- 不引入 plugin/hook 注册表
- 不预留「未来可能的 CSS 贴标」`profile.cssRules` 字段
- 不动正文 xhtml 内容（与原 spec §12 一致）
- 不做样式对齐 / xhtml 结构重写 / 字体集对齐（明确归入未来工作，本 spec 范围外）

## 4. 总体架构（方案 X：Pipeline 阶段化）

所有处理是 `EpubBuffer → EpubBuffer` 的纯函数 stage。Stages 在内存里 reduce，仅 entry 顶层落盘。

**EpubBuffer 形态**：

```ts
type EpubBuffer = {
  names: string[];                      // 保持 zip entry 顺序
  entries: { [zipPath: string]: Buffer };
};
```

**Stage 函数签名**：

```ts
type Stage = (buf: EpubBuffer, ctx: Ctx) => Promise<EpubBuffer> | EpubBuffer;
type Ctx = {
  profile: BookProfile;
  volNum: number;
  srcPath: string;
};
```

## 5. 4 个 Stage 职责

| Stage | 输入 | 做什么 | 与本书无关 |
|---|---|---|---|
| `strip` | 原始 epub | 删 `META-INF/encryption.xml` + `META-INF/zhangyue-expansion.xml` | ✅ |
| `deobfuscate` | strip 后 | 从 OPF item id 建反混淆映射 → patchOpfManifest（含 guide）→ patchXhtml/Ncx/Css 重写所有引用 → 实体改名 | ✅ |
| `heal` | deobfuscate 后 | ① nav 文档强制 `nav.xhtml`（macOS APFS 兼容）<br>② 删 `dc:identifier id="duokan-book-id"/"zhangyue-book-id"` 及 `<meta refines>`<br>③ 缺则补 `<dc:identifier id="BookId">urn:uuid:<md5(filename+size)>`<br>④ 缺则补 `<meta name="cover">`<br>⑤ 更新 `dcterms:modified` 为运行时今日 ISO<br>⑥ 清理孤儿 `@font-face`（mapping 未命中且 url 含 `*|?` 字符 → 删整条规则） | ✅ |
| `align` | heal 后 | 应用 `ctx.profile.metadataDefaults`：缺则补 `dc:rights` / `dc:contributor` / `<meta refines property="file-as">` / `dc:publisher`；`profile.metadataDefaults.modified` 存在则覆盖 heal 写入的今日 ISO | ❌ 仅这个 stage 读 book profile |

**约束变更（相对原 spec §12 不变量）**：

- 「CSS 规则集完全不动」**放宽**为「CSS 规则集不动，除孤儿 @font-face 清理外」（heal stage 第 ⑥ 项）
- 「OPF metadata 默认保留」**保持**，但分两阶段处置：heal 做通用增删，align 做书特定补全（默认「已有则保留」，不抹原 epub 自带元数据）

## 6. 目录结构

```
epub-clean-js/
├── package.json                       # 4 个 npm script
├── .gitignore
├── books/
│   └── yimei-seikatsu/
│       └── profile.js                 # BookProfile 对象（id / paths / filePatterns / vols / metadataDefaults）
└── src/
    ├── core/                          # 通用 EPUB 修复内核（与具体书 0 依赖）
    │   ├── constants.js               # 命名空间常量 + MIME2EXT + SKIP_NAMES + TEXT_EXTS
    │   ├── pipeline.js                # runPipeline(buf, stages, ctx) — reduce 执行器
    │   ├── zip-io.js                  # readEpub (yauzl-promise) + writeEpub (yazl)
    │   ├── opf.js                     # parseContainer / parseOpf / patchOpfManifest / serializeOpf
    │   ├── patchers.js                # patchXhtml / patchNcx / patchCss
    │   ├── paths.js                   # unquoteRecursive / remapPath
    │   ├── validator.js               # spec §11 自检 + broken-link 分类
    │   └── stages/
    │       ├── index.js               # re-export 4 个 stage
    │       ├── strip.js
    │       ├── deobfuscate.js
    │       ├── heal.js                # 含「孤儿 @font-face 清理」子步骤
    │       └── align.js               # 唯一读 ctx.profile.metadataDefaults 的 stage
    └── entries/
        ├── strip.js                   # 单 stage: [strip]
        ├── heal.js                    # 三 stage: [strip, deobfuscate, heal]
        ├── align.js                   # 四 stage: [strip, deobfuscate, heal, align]
        └── all.js                     # 等价 align（保留 all 别名为 npm start 习惯）
```

**模块边界**（强约束）：

- `src/core/` 不能 `import` `books/` 或任何项目特定路径
- 所有书相关数据通过 `ctx.profile` 注入到 stage
- `src/entries/` 是粘合层：`import profile from '../../books/yimei-seikatsu/profile.js'`
- `books/<id>/profile.js` 是纯数据（无副作用、无 fs/io 调用）

## 7. BookProfile 内容

`books/yimei-seikatsu/profile.js`：

```js
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
    // 其它字段（contributors / publisher）按需扩展，当前不预填
  },
};
```

## 8. Metadata 职责分工表

| 字段 | heal stage 行为 | align stage 行为 |
|---|---|---|
| `<dc:identifier id="duokan-book-id">` 及 refines | **删** | — |
| `<dc:identifier id="zhangyue-book-id">` 及 refines | **删** | — |
| `<dc:identifier id="BookId">` | 缺则补 `urn:uuid:<md5(filename+size)>` | 不动 |
| `<meta property="dcterms:modified">` | 缺/有都改为运行时今日 ISO（`new Date().toISOString()`） | 若 `profile.metadataDefaults.modified` 存在则覆盖 |
| `<meta name="cover">` | 缺则从 manifest 找 `media-type="image/*"` + id 含 cover 的 item 补 | — |
| `<dc:rights>` | — | 缺则补 `profile.metadataDefaults.rights`；**已有则保留** |
| `<dc:contributor>` | — | 按 `profile.metadataDefaults.contributors[]` 补；**已有则保留** |
| `<meta refines property="file-as">` | — | 按 `profile.metadataDefaults.contributors[].fileAs` 注入 |
| `<dc:publisher>` | — | 若 profile 提供且当前缺则补 |

**关键设计**：默认「已有则保留」，不抹原 epub 自带元数据（避免覆盖出版方填写的真实信息）。

## 9. npm scripts

`package.json`：

```json
"scripts": {
  "strip": "node src/entries/strip.js",
  "heal":  "node src/entries/heal.js",
  "align": "node src/entries/align.js",
  "start": "node src/entries/all.js"
}
```

每个 Entry 的 Stages 数组 + 落盘：

| Entry | Stages | 落盘路径 |
|---|---|---|
| `entries/strip.js` | `[strip]` | `unlockedDir/*.unlocked.epub` |
| `entries/heal.js` | `[strip, deobfuscate, heal]` | `healedDir/*.healed.epub` |
| `entries/align.js` | `[strip, deobfuscate, heal, align]` | `cleanDir/*.clean.epub` |
| `entries/all.js` | `[strip, deobfuscate, heal, align]` | `cleanDir/*.clean.epub` |

**每个 entry 都从原始 epub 读起，不读中间产物**（in-memory pipeline 几乎零成本，避免「忘记先跑 heal」的隐式依赖）。

中间产物 `unlocked.epub` / `healed.epub` 是独立调试入口的副产物（强单元化测试），不是 align 的依赖。

## 10. Entry 文件结构

`src/entries/all.js` 示例（其它 entry 唯一差异是 stages 数组 + 落盘路径模板）：

```js
import path from "node:path";
import fs from "node:fs";
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
    if (!fs.existsSync(src)) { console.log(`⚠️ 跳过 ${vol}: ${src} 不存在`); continue; }
    const inBuf = await readEpub(src);
    const outBuf = await runPipeline(inBuf, [strip, deobfuscate, heal, align], {
      profile, volNum: vol, srcPath: src,
    });
    await writeEpub(dst, outBuf);
    const report = await validateOutput(dst);
    console.log(`卷 ${vol}: ${report.ok ? '✅' : '❌'} issues=${report.issues.length} broken=${report.brokenLinks.length}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

## 11. 孤儿 @font-face 清理算法

heal stage 内部子步骤：

```js
import * as posixpath from "node:path/posix";

function sanitizeCssOrphanFontFace(cssText, cssZipPath, zipEntryNames) {
  return cssText.replace(/@font-face\s*\{[^}]*\}/g, (rule) => {
    const m = /url\(\s*([^)\s'"]+)\s*\)/.exec(rule);
    if (!m) return rule;
    const url = m[1];
    // 排除 data: URI / 外部 http(s) URL（保留原规则不动）
    if (/^(data:|https?:|mailto:|tel:)/i.test(url)) return rule;
    // 不含混淆字符 → 保留（合法相对路径，可能命中或不命中 zip，但非孤儿特征）
    if (!/[*|?]/.test(url)) return rule;
    const cssDir = posixpath.dirname(cssZipPath);   // 如 OEBPS/Styles
    const resolved = posixpath.normalize(posixpath.join(cssDir, url));
    // 双条件：含 *|? 字面字符 AND 目标不在 zip → 才删整条规则
    return zipEntryNames.has(resolved) ? rule : "";
  });
}
```

heal stage 主体遍历 `buf.entries` 中所有 `*.css`，对每个调用 `sanitizeCssOrphanFontFace`。

## 12. 现有 src/ 迁移映射

| 现有 | 去向 | 备注 |
|---|---|---|
| `src/zip-io.js` | `src/core/zip-io.js` | `SKIP_NAMES` 引用迁到 `core/constants.js` |
| `src/paths.js` | `src/core/paths.js` | 不动 |
| `src/patchers.js` | `src/core/patchers.js` | 不动 |
| `src/opf.js` | `src/core/opf.js` + `src/core/stages/heal.js` + `src/core/stages/align.js` | **`patchOpfMetadata` 拆分**：通用部分 → `stages/heal.js`，书特定（`voidlord`、`2026-05-22`）→ `stages/align.js` |
| `src/process.js` | `src/core/stages/deobfuscate.js` + `src/core/pipeline.js` | processOne 主循环结构作为 entries 模板 |
| `src/validator.js` | `src/core/validator.js` | 不动，加第 9 项验证（CSS 不再含 `*|?` 字符） |
| `src/config.js` | EPUB 规范常量 → `src/core/constants.js`；项目路径 → 删除（由 `books/yimei-seikatsu/profile.js` 的 `profile.paths` 提供） | config.js 整个删除 |
| `src/index.js` | `src/entries/all.js` | 迁路径，逻辑不动 |
| `src/strip.js` | `src/entries/strip.js` | 迁路径，逻辑不动 |

## 13. 迁移步骤（12 步，按依赖顺序）

1. 建新目录骨架：`src/core/` / `src/core/stages/` / `src/entries/` / `books/yimei-seikatsu/`
2. 抽 `src/core/constants.js`（从 `config.js` 提通用常量）
3. 移 `src/zip-io.js → src/core/zip-io.js`，引用 `constants.js` 替换 `SKIP_NAMES`
4. 移 `src/{paths,patchers,validator}.js → src/core/`
5. 写 `src/core/pipeline.js`（runPipeline 新建）
6. 拆 `src/opf.js`：parse* 系列 → `core/opf.js`；`patchOpfMetadata` 通用部分 → `stages/heal.js`；书特定部分 → `stages/align.js`
7. 拆 `src/process.js`：deobfuscate 主体 → `stages/deobfuscate.js`
8. 写 4 个 stage：`strip.js`、`deobfuscate.js`、`heal.js`（含孤儿 @font-face 清理）、`align.js`
9. 写 4 个 entry：`strip.js` / `heal.js` / `align.js` / `all.js`
10. 写 `books/yimei-seikatsu/profile.js`
11. **暂留**旧文件：`src/{config,index,strip,process}.js` 重命名为 `*.bak`（不删除，保留回退余地）
12. 更新 `package.json` scripts；端到端跑 5 卷验证 + 与现有 `unlocked/clean/` 产物 diff
13. 验证全绿后才正式删除 `*.bak` 旧文件

## 14. 验证清单

原 spec §11 的 8 项全保留，加 1 项：

- ① mimetype 第一项 + 内容正确 + 未压缩
- ② `META-INF/container.xml` 存在且能解析出 OPF 路径
- ③ OPF metadata 含 `dc:title` / `dc:identifier` / `dc:language`
- ④ manifest 所有 item 的 href 在 zip 里存在
- ⑤ xhtml 引用解析后存在（broken-link 单独分类，不算 issue）
- ⑥ OPF/CSS/xhtml/ncx 无 percent-encoded 残留
- ⑦ 文件名无 `*|?` 字面字符
- ⑧ 孤儿文件计数（信息性）
- ⑨ **CSS 文本中无 `*|?` 字面字符**（验证孤儿 @font-face 清理彻底）

## 15. 测试策略

- 不引入 pytest/vitest/jest
- 端到端集成验证：5 卷跑 `npm start`，每卷 `validator.validateOutput` 返回 `ok=true`
- 回归对照（与当前 `unlocked/clean/` 产物逐卷 diff）：
  - size 差异允许 ±0.5%（zlib 压缩参数 + 元数据微调）
  - `cover.xhtml` / 章节 xhtml 应字节级相同
  - `default.css` / `necessary.css` 行数应**减少**（孤儿 @font-face 被删）
  - OPF 应仍含 `<meta name="cover">` / `<dc:identifier id="BookId">` / `<dc:rights>voidlord</dc:rights>`

## 16. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| stage 间隐式依赖（align 假设 heal 已跑） | 中 | align 单跑会跳过 heal 必要修复 | entries 强制把 stages 数组写成完整链；align entry 内部包含 `[strip, deobfuscate, heal, align]` 完整 4 段 |
| 孤儿 @font-face 清理误删合法规则 | 低 | CSS 缺字体 → 阅读体验降级 | 严格匹配「url 含 `*|?` 字面字符 AND 目标不在 zip 中」双条件，二者缺一不删 |
| `dcterms:modified` 改为运行时 ISO 导致 EPUB 每次 build 都变化 | 低 | 不影响阅读，可能影响 git diff | 接受；align 可通过 `profile.metadataDefaults.modified` 固定（YAGNI，当前不预设） |
| 迁移过程中 src/ 半破状态 | 中 | 5 卷暂时不能跑 | 12 步按依赖顺序，每步跑一次 syntax 检查；不强求 mid-state 可跑 |
| 第 9 项验证误报（合法的非 `*|?` 字符出现在 css 字符串里） | 低 | 验证报误 issue | 验证规则只看 `*|?` 三种字符，明确属于 STERA 孤儿残留特征 |

## 17. 不变量（更新版）

- **核心 src/core/ 与本书无关**：不引用任何「义妹生活」/「voidlord」字符串、不引用 books/ 路径
- **stage 是纯函数**：(buf, ctx) → buf，不写文件、不读环境（IO 集中在 entries）
- **正文 xhtml 内容完全不动**：只动 head 里的 link/script 引用、body 里的 img/a href 引用
- **CSS 规则集不动，除孤儿 @font-face 清理外**（更新版）
- **图片/字体二进制完全不动**：只改文件名
- **OPF metadata 默认保留**：heal 做规范化增删 + align 按 profile 补缺；都不抹原值

## 18. 产物清单

实现完成后：

- `epub-clean-js/` 重组：1 个 `package.json` + 1 个 `books/yimei-seikatsu/profile.js` + 8 个 `src/core/*.js` + 4 个 `src/core/stages/*.js` + 4 个 `src/entries/*.js`
- `unlocked/*.unlocked.epub` × 5（`npm run strip` 产物）
- `unlocked/healed/*.healed.epub` × 5（`npm run heal` 产物）
- `unlocked/clean/*.clean.epub` × 5（`npm run align` / `npm start` 产物）

---

**本设计文档完成；下一步：调用 writing-plans skill 生成实施计划。**
