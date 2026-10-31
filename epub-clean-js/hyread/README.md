# hyread — HyRead 在线阅读器版抓取 → EPUB

本模块在 `epub-clean-js` 工程内，把用户已能阅读的 HyRead 在线阅读器内容重建为 EPUB。Node 准备资源、接收数据、构建和验证；正文采集与实时复核复用已登录的 Chrome 页面。默认不触发下载或保存对话框，不保存带签名参数的 reader URL、Cookie、JWT 或账号数据。

与主工程来源不同：`strip/heal/align` 处理多看商店版，`migrate-translation` 处理台版译文迁移。本模块处理 HyRead 在线阅读器版；正文明文在浏览器运行时取得，流程不能只靠 CLI 完成。

需要 Node >=18 和主工程现有依赖，无需在本目录单独安装。以下命令从 Node 工程根（含 `package.json` 的 `epub-clean-js/`）运行；也可以使用入口与参数的绝对路径，从其他 cwd 启动。

## 1. 确认当前书籍并 prepare

先用 `chrome-devtools` 列出当前 Chrome 标签页，选择用户已打开且正文已显示的阅读器，核对书名与资源 assetId。不要用过期的带 data 参数链接重开页面。Chrome 重启后应重新列出页面、核对身份；尚未导出的浏览器内存任务已经丢失，本地完整接收的数据仍可用。

换书通过参数或 session 选择，不再编辑全局 `config.mjs`。例如：

```bash
node bin/cli.js hyread prepare --volume 14 --asset-id 2d68797b1326483e9294e44696a80267 --title "義妹生活 14"
# 等价入口：node hyread/cli.mjs prepare ...
# 可用 --work-dir 指定独立工作目录
```

prepare 按 OPF 清单下载资源并逐项检查。全部完成后才发布新的 `session.json`；返回 JSON 含 session 路径、资源目录和 Session。工作目录中的 `book-identity.json` 绑定书籍身份，不是 PID 锁。同书中断后可重试，其他书请用其他工作目录。强制终止可能留下未发布的 generation，它不参与当前 session；当前版本没有自动垃圾回收。

`session.json` 记录卷号、assetId、书名、OPF SHA-256、manifest、spine、资源字节数/哈希，以及相对 `resourceRoot`。prepare/load 成功返回的 `config.resourcesDir` 和 `config.itemDir` 指向该 generation，不要写回旧的平铺 resources 路径。load、build 会重新检查整个资源集合；坏资源不能靠改 session 绕过。同书重新 prepare 可生成新的完整集合。

## 2. 在已有 Chrome 中采集

生成与会话绑定的代码，stdout 只有 JavaScript：

```bash
node hyread/cli.mjs browser-script --session hyread/work/14/session.json --mode capture
```

将输出交给浏览器工具的脚本执行入口。生成的表达式会安装 `window.__hyreadWorkflow` 并调用 `start`，开始逐章采集；返回的是状态摘要，不是整份正文。不要让工具把正文作为一个超大返回值取回。若工具的 sourcePath 因路径边界不可用，可以先读取已授权的脚本文本，再使用该工具支持的内联脚本入口。

若需要本地脚本文件，用 Node 写入 UTF-8，避免 Shell 重定向改变编码：

```js
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const { stdout } = await promisify(execFile)(process.execPath, [
  'hyread/cli.mjs', 'browser-script', '--session', 'hyread/work/14/session.json', '--mode', 'capture',
], { maxBuffer: 4 * 1024 * 1024 });
await writeFile('hyread/work/14/capture-script.js', stdout, 'utf8');
```

也可直接安装 `hyread/browser/capture-decrypted.js`，先调用 `describe()` 核对身份，再把本地 Session 对象传给 `start({mode:'capture',session})`。该文件只安装接口，不自动开始，也不点击下载链接。重复安装复用现有实例，运行中不能 clear 或再次 start。

在浏览器工具中分次执行：

```js
window.__hyreadWorkflow.describe()
window.__hyreadWorkflow.status()
window.__hyreadWorkflow.cancel()
```

status.state 为 `idle/running/complete/cancelled/failed`，并包含阶段、章节/分页进度、错误和 restoration。start 默认为 `timeoutMs=15000,pollMs=150,stableSamples=3,restore=true`。正常完成或取消时 resolve，失败时 reject 并保留 failed 状态。cancel 发出请求后，继续查看状态直到退出；完成、失败和取消后都尽力恢复起始章节与页码，恢复结果必须单独确认，不能将内容采集完成当成位置已恢复。

脚本核对当前书名、assetId 和重新 fetch 的 OPF 哈希；依照 session.spine 采集，等待正确正文、文档/字体加载和多次文本稳定。不能用固定等待时长代替正文关联证据。当前浏览器适配对单 spine 的初始关联有限制：没有受控往返或独立关联证据时明确失败。这个限制只影响浏览器适配，prepare/load/build 仍接受合法单 spine 数据。

## 3. 分块接收并 finalize

仅在 state=complete 后导出：

```js
await window.__hyreadWorkflow.exportInfo({chunkBytes:12000})
window.__hyreadWorkflow.readChunk(0)
// 按 exportInfo.chunkCount 依次或分批取 readChunk(index)
```

exportInfo 是异步接口，返回 kind、assetId、OPF 哈希、UTF-8 总字节数、整份 SHA-256 和分块信息。readChunk 返回 `{sha256,index,offset,bytes,dataBase64}`，offset 是字节位置。chunkBytes 可按工具单次返回能力调整；12000 是默认值，不是工具能力上限。exportInfo 之后应保持同一分块视图，若要改大小，使用独立接收过程。

把工具返回的纯 JSON 写入本地工作目录，再运行：

```bash
node hyread/cli.mjs receive --session hyread/work/14/session.json --info hyread/work/14/capture-info.json --chunk hyread/work/14/chunk-0000.json
# 对每块重复 receive，完成后：
node hyread/cli.mjs finalize --session hyread/work/14/session.json --info hyread/work/14/capture-info.json
```

工具也可在 Node 模块上下文直接接收，避免为每块启动进程：

```js
import { resolve } from 'node:path';
import { loadSession } from './hyread/lib/session.mjs';
import { receiveChunk, finalizeTransfer } from './hyread/lib/transfer.mjs';
const { config } = await loadSession(resolve('hyread/work/14/session.json'));
// info 和 chunk 是浏览器工具已返回的 JSON 对象；不要用字符串拼接执行它们。
await receiveChunk(config, info, chunk); // 对每块调用，可乱序；同字节重试安全
await finalizeTransfer(config, info);    // 所有块齐全后调用
```

receive/finalize 检查身份、块索引、offset、base64、总长度与总 SHA，finalize 再检查完整 capture/audit 格式。缺块、错书、坏路径或坏哈希都返回非零，不发布最终目标。capture 写 `grab_xml.json`，audit 写 `audit.json`。相同字节可重复导入；不同内容默认受保护，确认需要更新时仅在 finalize 加 `--replace`。完成导出并确认本地接收后，可在浏览器调用 `clear()` 释放内存。

## 4. 构建与验证

```bash
node hyread/cli.mjs build --session hyread/work/14/session.json
# 可加 --out <独立成品路径>；已有成品只有显式 --replace 才允许替换
node hyread/cli.mjs verify --session hyread/work/14/session.json --epub "<成品路径>"
```

默认输出为项目根（Node 工程上一级）下 `output/hyread/[三河ごーすと].义妹生活.<两位卷号>.[台繁].hyread.epub`，与 healed/translated/clean 同级。build 在独立 `epub_build/build-*` 目录组装，检查通过后发布成品。失败时保留原成品与本次诊断目录；不要删除原文件再重试。

verify 默认把 JSON 和 Markdown 报告写到会话 `reports/` 下的唯一文件名，也可用 `--report <路径.json>` 指定；不同内容不能覆盖已有报告。失败检查返回非零。没有 audit 时 live=not-run；`--require-live` 在缺少实时复核时必须失败。报告中的 semantic 始终为 not-run。这里的 XML、资源、正文与引用检查不是官方 EPUBCheck；没有运行官方 EPUBCheck 时，应写“官方 EPUBCheck 未运行”，不能沿用通用“0 错误”保证。

实时复核需要重新从原始阅读器目录进入、逐章翻至末页并读取当次正文与图片哈希，不能把旧 grab 当成 audit：

```bash
node hyread/cli.mjs browser-script --session hyread/work/14/session.json --mode audit
# 在原 Chrome 执行；等 complete，按上一节接收 audit 的 info/块并 finalize
node hyread/cli.mjs verify --session hyread/work/14/session.json --epub "<成品路径>" --audit hyread/work/14/audit.json --require-live
node hyread/cli.mjs semantic-export --session hyread/work/14/session.json --audit hyread/work/14/audit.json --out-dir hyread/work/14/semantic
```

验证按 spine/path 对照正文、叶块、ruby、图像位置、链接、目录目标、分页覆盖和图片 SHA。目录重名、同一天的不同人物视角、短章与跨日期均不能自动合并或删掉。官方菜单可省略已识别的结构页；目录外 `xhtml/p-001.xhtml` 引言豁免只适用于已核实的第 14 卷、assetId `2d68797b1326483e9294e44696a80267` 和该路径，不推广到未知书籍。

semantic-export 输出原始浏览器文本、编号块、空白块、ruby、图像观察、章首/章尾和索引。块外图像的 paragraphIndex=-1，图像顺序保留，但与相邻文字块的精确位置未知。材料可供通读和回原页核实疑点，机器不会把语义标为 passed。源页同样存在的疑点只记录，不自动补文、删句或改字；与当前浏览器一致也不等于获得独立出版母本证明。

## 旧入口与旧数据

数字入口 2/3/4 接受 `--session <session.json>`，或完整 `--volume --asset-id --title [--work-dir]`。无参沿用旧配置的 08；步骤 3/4 要求该目录已经 prepare。步骤 2 转接 prepare；步骤 3 将解析后正文导出到 decrypted，步骤 4 转接 build。步骤 3/4 支持 `--replace`，步骤 4 支持 `--out`。步骤 1 运行时归档保持不变，是可选操作。

`2b-save-downloaded.mjs` 已停用，返回非零并提示 prepare/receive/finalize，不能再把任意批次 JSON 直接写到资源目录。`hyread-to-simple` 保持原命令。

旧 capture 的 `{order,data}` 仍支持，但必须来自同书规范绝对资源 URL，完整覆盖 session.spine。先为同书准备独立 workDir，再用以下模块方式导入，保留原旧文件：

```js
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadSession } from './hyread/lib/session.mjs';
import { receiveChunk, finalizeTransfer } from './hyread/lib/transfer.mjs';
const { config, session } = await loadSession(resolve('hyread/work/14/session.json'));
const bytes = await readFile('<旧 grab_xml.json 路径>');
const info = { schemaVersion:1, kind:'capture', assetId:session.assetId,
  sourceOpfSha256:session.sourceOpfSha256, byteLength:bytes.length,
  sha256:createHash('sha256').update(bytes).digest('hex'), chunkBytes:12000,
  chunkCount:Math.ceil(bytes.length / 12000) };
for (let index = 0; index < info.chunkCount; index++) {
  const part = bytes.subarray(index * info.chunkBytes, (index + 1) * info.chunkBytes);
  await receiveChunk(config, info, { sha256:info.sha256, index, offset:index * info.chunkBytes,
    bytes:part.length, dataBase64:part.toString('base64') });
}
await finalizeTransfer(config, info);
```

新 meta 是附加字段；旧数据不会凭迁移获得实时证明。使用独立 --out 构建，再按需重新 audit，不覆盖既有成品。

## 目录与排版经验

```text
hyread/work/<卷>/                 # Git ignored，不提交真实书籍/正文/图片
  book-identity.json
  session.json
  resources/generations/<id>/ebookservice/epub/<assetId>/item/
  transfers/<capture|audit>/<sha256>/
  grab_xml.json / audit.json
  decrypted/                     # 可选：解析后正文导出
  epub_build/build-*/             # 构建与失败诊断
  reports/ / semantic/
```

- 正文消失/只剩插图：`fixed-layout-jp.css` 含 `body{font-size:0}`，用于纯 SVG 图片页。混合文字与 SVG 的页仍按正文处理；仅“含 svg”不足以判作图片页。正文不能引入图片专用 CSS，包括间接 import。
- 历史 EPUBCheck RSC-005：阅读器的 `<style xmlns="">` 处于空命名空间，构建时移除该注入块。历史 OPF-027：`<meta property="hdf">` 是非标准元数据，构建时移除。
- 良构：浏览器用 XMLSerializer 保留 XHTML 空元素、ruby 与实体。当前语法检查不支持内部 DTD 子集和依赖外部声明的命名实体，也不会联网解析 DTD。
- nav 不是字节级真本：非 spine 的加密导航无法作为正文采集，输出 nav 按 spine 与解析后正文标签重建；目录标签/目标仍须与 audit 对照，不能预先宣称完全等价。
- 仅第 08 卷既有精确修正规则在匹配卷号、assetId、路径时应用并列入报告；其他语义疑点不自动改字。

本次第 14 卷运行记录为 32 文档、22 侧栏目录项、135 分页、2896 叶块、13 ruby、22 图/7 CSS；旧人工模型曾记 2882 文本块。数字反映当次窗口、字号和块模型，不是算法常量，也不能作为其他书的验收期望。

`node hyread/cli.mjs --help` 列出全部命令；各命令支持 --help。`npm run test:hyread` 使用合成资源与真实 CLI 子进程，不请求 HyRead，不依赖 work/13 或真实书籍。
