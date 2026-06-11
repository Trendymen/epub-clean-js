# hyread — HyRead 在线阅读器版抓取 → EPUB

本目录是 `epub-clean-js` 工程内一个**自包含**的子模块，用于把 **HyRead 在线阅读器**（`service.ebook.hyread.com.tw/.../openbook2.jsp`）的书重建成规范 EPUB。

> 与主工程其它命令的来源不同：
> - 主工程 `strip/heal/align` 处理的是**多看商店版**（混淆文件名）；
> - `migrate-translation` 处理**台版译文迁移**；
> - **本模块**处理 **HyRead 在线阅读器版**——正文 xhtml 被 wasm 加密，明文只在浏览器运行时存在，所以流程里有一步**必须在浏览器手动跑**，无法做成纯 CLI。

## 流程总览

```
[2] 下载 EPUB 原始内容  ──┐
                          ├─→ [4] 组装 + 打包 EPUB ─→ <项目根>/output/hyread/*.hyread.epub
[3] 浏览器抓取解密正文 ──┘
[1] 下载阅读器运行时（可选归档）
```

| 步骤 | 脚本 | 环境 | 作用 |
|---|---|---|---|
| 1（可选） | `scripts/1-download-page-resources.mjs` | Node | 归档阅读器运行时（onlineReader.js / wasm 等），做 EPUB 非必需 |
| 2（必需） | `scripts/2-download-epub-content.mjs` | Node | 按 OPF 下载全卷内容：`standard.opf` + 加密 xhtml + css + image |
| 3（必需） | `browser/capture-decrypted.js` | **浏览器 Console** | 驱动阅读器逐章翻页，`XMLSerializer` 抓解密正文，下载 `grab_xml.json` |
| 4a（可选） | `scripts/3-extract-decrypted.mjs` | Node | 把解密正文导出成独立 xhtml 文件夹（查阅用） |
| 4b（必需） | `scripts/4-build-epub.mjs` | Node | 清理 + 分类注入 CSS + 去 DRM + 生成 nav，`yazl` 打包成 `.epub` |

## 使用步骤

### 0. 配置卷

编辑 `config.mjs`，改 `VOLUME` / `ASSET_ID`（阅读器 URL 的 `asset_id`）/ `BOOK_TITLE`。

### 1~2. 下载内容（Node）

```bash
cd epub-clean-js
node hyread/scripts/2-download-epub-content.mjs   # 必需
node hyread/scripts/1-download-page-resources.mjs # 可选
```

### 3. 浏览器抓取解密正文

1. 浏览器打开该卷 HyRead 阅读器（`openbook2.jsp`），确认正文已显示；
2. 打开 devtools Console，把 `browser/capture-decrypted.js` 整段粘贴运行；
3. 自动从头翻到尾抓取，结束后浏览器下载 `grab_xml.json`；
4. 把 `grab_xml.json` 放到 `hyread/work/<卷>/grab_xml.json`。

### 4. 组装 EPUB（Node）

```bash
node hyread/scripts/4-build-epub.mjs              # 产出 output/hyread/*.hyread.epub
node hyread/scripts/3-extract-decrypted.mjs       # 可选：导出解密正文文件夹
```

成品落项目根 `output/hyread/[三河ごーすと].义妹生活.<卷>.[台繁].hyread.epub`，
与主工程的 `output/healed/`、`output/translated/`、`output/clean/` 同级（统一约定），经 `epubcheck` 0 错误验证。

## 目录布局

```
hyread/
├── config.mjs                 # 集中配置（卷号 / asset_id / 路径），零绝对路径
├── scripts/                   # Node 脚本（步骤 1/2/3导出/4）
│   ├── 1-download-page-resources.mjs
│   ├── 2-download-epub-content.mjs
│   ├── 3-extract-decrypted.mjs
│   └── 4-build-epub.mjs
├── browser/
│   └── capture-decrypted.js   # 步骤 3：devtools Console 粘贴运行
├── work/                      # 中间资源（.gitignore）
│   └── <卷>/
│       ├── resources/         # 步骤 2 下载：.../item/{standard.opf,style,image,xhtml(加密)}
│       ├── grab_xml.json      # 步骤 3 解密抓取
│       ├── decrypted/         # 步骤 3导出 解密正文 xhtml
│       └── epub_build/        # 步骤 4 EPUB 解包目录
└── README.md / config.mjs / .gitignore

# 成品不落在 hyread/ 内，而是项目根 output/（与工程其它产物统一）：
<项目根>/output/hyread/[三河ごーすと].义妹生活.NN.[台繁].hyread.epub
```

## 已知坑（都已在脚本里处理）

- **正文消失 / 只剩插图**：`fixed-layout-jp.css` 含 `body{font-size:0}`，只能给 svg 图片页用；正文页注入它会把文字压成 0 号字。`4-build-epub.mjs` 按"含 svg = 图片页"分类注入 CSS。
- **epubcheck RSC-005**：阅读器注入的 `<style xmlns="">` 在空命名空间，违反 XHTML head 内容模型 → 清理时按 `xmlns=""` 整块移除。
- **epubcheck OPF-027**：OPF 里 HyRead 的 `<meta property="hdf">` 是 DRM 元数据、非标准属性 → 移除。
- **良构**：步骤 3 用 `XMLSerializer`（非 `outerHTML`）抓取，空元素自闭合、实体正确，xmllint/epubcheck 通过。
- **nav 不是字节级真本**：`navigation-documents.xhtml` 加密且不在 spine 无法解密，nav 由解密正文的官方目录重建，内容等价。

## 依赖

复用主工程 `node_modules`（`yazl` 打包）。无需单独 `npm install`。
