# HyRead 抓取与复核流程复用设计

## 目标与选择

将项目已有的 HyRead 抓取链路固化为可重复运行的浏览器脚本与 Node 工具。用户继续在已登录的 Chrome 打开目标书，由 Codex 的 chrome-devtools 操作该页；Node 负责资源、传输、构建和报告。采集与复核不触发浏览器下载或保存对话框。

采用既有 Node ESM + chrome-devtools 双端流程。独立 CDP 浏览器驱动需要额外连接配置，本次不加入。也不加入本地 HTTP 接收服务、浏览器扩展或新的运行依赖。

支持当前 HyRead v3 阅读器和项目已有 item/standard.opf 资源结构，保留义妹生活的默认文件命名及已有卷号特定修正。不是新增全文翻译、语义改写或通用书店下载框架。

## 绑定约束

- Node >=18；使用现有依赖，不引入新的运行依赖。
- 默认复用用户已登录的 Chrome；不启动新浏览器，不改浏览器设置，不触发下载/保存对话框。
- 不保存 reader URL 的 data 参数、Cookie、JWT 或账号数据；只保存书籍标识、资源路径和校验信息。
- 原始正文、ruby、图片和文字顺序必须保留；仅允许下文明确列出的既有卷08精确修正。语义疑点只记录，不能自动补写、删句或改字。
- 保留现有 {order, data} 抓取格式；新增 metadata 为附加字段，旧数据须经过同等路径和完整性检查。
- 新流程通过明确参数或 session.json 选择书籍；不修改全局 config.mjs 来换卷。
- 书籍身份、资源路径、清单完整性或校验不通过时，进程返回非零；缺少实时复核不能标成实时复核通过。
- 默认保护已有 capture/audit/EPUB 文件；同字节重复导入允许，不同内容须显式 --replace。
- 资源与中间文件留在 Git ignored 的 hyread/work/；不提交真实书籍正文、图片或本次抓取 JSON 作为测试 fixture。
- 保留用户现有 README 措辞调整；不涉及 heal/align/翻译迁移等无关行为。

## 本地配置与会话

新增 resolveHyreadConfig(options = {})，返回 camelCase 配置：volume、assetId、bookTitle、workDir、resourcesDir、itemDir、capturePath、auditPath、buildDir、outputPath、sessionPath、itemBase、projectRoot。config.mjs 原有大写导出继续服务旧脚本。

options 支持 volume、assetId、title、workDir、outputPath、projectRoot。volume 为正整数文本，标准化为至少两位；assetId 为32位十六进制；title 非空。默认路径根据模块位置解析，显式工作目录/输出路径按调用方 cwd 解析。

新 CLI 的 prepare 必须同时指定 --volume、--asset-id、--title；不默默采用08卷。其余命令以 --session 选择会话。默认 session 在 hyread/work/<volume>/session.json，默认成品仍为外层仓库 output/hyread/[三河ごーすと].义妹生活.<volume>.[台繁].hyread.epub。

Session v1 包含 schemaVersion:1、volume、assetId、title、sourceOpfSha256、resourceRoot、resources、manifest 和 spine。manifest 项含 id/href/mediaType/properties（字符串数组），spine 项含 id/href，顺序来自 OPF。resources 以 href 为键记录 bytes/sha256，并包含 standard.opf；resourceRoot 是工作目录内 resources/generations/<runId> 的相对路径。会话不写绝对机器路径，加载时以 session 文件所在目录作为 workDir，并从 resourceRoot 派生 resourcesDir/itemDir，输出可另传 --out。同工作目录已绑定其他书籍时拒绝 prepare。

prepareSession(config, {fetchImpl} = {}) 下载 OPF 及 manifest 资源，并保存会话/下载报告；loadSession(sessionPath, {outputPath} = {}) 返回 {config, session}。OPF 用现有 XML parser 解析，不能仅用 href 正则。资源 href 必须是 item 根内的规范相对路径，拒绝越界、反斜杠、绝对 URL/盘符及编码后的路径穿越。也检查符号链接不能把实际写入带出指定工作目录。

资源下载只接受成功的非空200响应，OPF 须可解析且有 manifest/spine；检查重定向后的资源仍属于同一书籍资源根。请求有超时、并发上限4，错误汇总后失败。每轮使用独立的 resourceRoot，先写该轮目录中的临时文件，再完成逐项文件；不替换旧资源集合。全部资源成功且逐项字节数/hash核对后，才原子更新 session.json，使其引用新集合。失败保持旧 session 及其资源集合不变；失败目录不具备构建资格。loadSession/build 必须核对所引用集合的全部 resources 记录与 OPF hash，缺项或被修改即拒绝。

旧 {order,data} 可以继续使用，但新构建必须先有成功 prepare 的 session；旧步骤2也会生成这些记录。首次迁移旧 work 目录时先运行 prepare，不为旧目录自动伪造下载成功状态。

## 浏览器脚本

browser/capture-decrypted.js 改为幂等安装 window.__hyreadWorkflow 的独立普通 JS 脚本，不自动点击下载链接。运行时聚焦现有 HyRead API、iframe 和 React fiber 适配；遇到不认识的结构明确报错，不猜章节。

接口：

- describe()：返回书名、assetId、当前 spine 和分页信息。
- start(options)：异步运行 capture 或 audit，返回摘要；options 含 mode、session（上述 Session）、timeoutMs、pollMs、stableSamples、restore。
- status()：返回 idle/running/complete/cancelled/failed、当前阶段、章节/分页进度、错误与恢复结果。
- cancel()：请求取消；等待循环和翻页循环都检查取消。
- exportInfo({chunkBytes=12000} = {})：仅对 complete 结果返回 {schemaVersion:1,kind,assetId,sourceOpfSha256,byteLength,sha256,chunkBytes,chunkCount}。
- readChunk(index)：返回 {sha256,index,offset,bytes,dataBase64}；按 UTF-8 字节分块，避免切断代理对字符。
- clear()：仅在非运行状态释放本工具数据。

同一实例一次只允许一个 start；安装或 clear 不得丢弃正在运行的任务。标题按 NFKC 并去空白比较，assetId 与全部资源路径必须相符；开始时在当前页 fetch OPF 并核对 sourceOpfSha256，错书或源已变时停止。

当前 iframe 依据实际视口交叠面积、可见性与透明度选择。读取前等待正确 spine、document.complete、字体 loaded、非空 DOM，以及连续 stableSamples 次文本稳定。默认 timeoutMs=15000、pollMs=150、stableSamples=3；测试可传更短值。图片页允许没有正文文字，但须有图像内容。固定等待仅作为轮询间隔，不能单独代表加载完成。

capture：按 session.spine 回到首章并逐章采集，XMLSerializer 保留良构 XHTML；顺序/数量/URL/data 键必须与预期完整匹配。章节超时、序列化错误、无法前进、错误文件或中途换书都失败，不能跳过后打印成功。结果为 {order,data,meta}；meta 含 schemaVersion:1、kind:'capture'、assetId、title、sourceOpfSha256、complete:true、时间及恢复结果。旧 {order,data} 仍可供本地检查和构建。

audit：从浏览器原始目次读取条目，按序号选择，保留同名项与同日不同视角；记录标签与实际到达的源路径。每个唯一 spine 从第1页翻到末页，记录正文、段落/标题块、tag/id、图片引用与加载状态、ruby、链接、各页可见块及正文变化。对目录未列出的 spine，再按阅读器章节顺序补齐。不能用旧 grab_xml.json 充当实时证据。结果为 Audit v1：meta(kind:'audit',complete:true,assetId,title,sourceOpfSha256)、tocEntries、records、imageHashes、issues；records 至少含 src/spineId/spineIndex/bodyText/paragraphs/images/ruby/bodyLinks/pageCount/pageChecks/bodyChanges/unseenTextBlocks/errors。图片按当前 DOM 已观察到的同书资源 URL 重新 fetch，保存字节数和 SHA-256。

restore 默认 true：记录起始 spine/page，完成、失败或取消后尽力恢复该位置；恢复失败要单独记录，不能覆盖原始失败或假称已恢复。恢复不受已触发的取消标志阻断，但仍有超时与身份检查。

## 无弹窗传输

Node 模块提供 receiveChunk(config, info, chunk) 和 finalizeTransfer(config, info, {replace=false} = {})。

info 与 chunk 的 schema、书籍身份、源 OPF hash、SHA、索引、offset、字节数及严格 Base64 均须检查。每块保存在 workDir 内以 kind/hash/index 标识的专用临时目录；允许乱序到达和完全相同的重试，拒绝同索引不同内容。路径不由 chunk 提供。

finalize 必须有全部块，合并后校验长度、SHA-256、严格 UTF-8、JSON 结构、书籍身份、完整标记与预期 spine。只有全部通过才原子写入 capturePath 或 auditPath。保留接收状态便于中断后重试；清理仅限本次专属临时文件，不能删除其他会话数据。

12000字节只是可调传输默认值。README 说明 Codex 工具的输入大小可能不同，应先读 exportInfo 再逐块传输；不能把某次工具的64KB限制写成通用产品能力。

## 构建与校验

将现有步骤4提取为 buildHyreadEpub(config, {replace=false} = {})；旧入口仍可调用。构建前加载成功准备的 session，核对资源集合逐项字节数/hash，再检查 capture 与 OPF spine 精确一致、所有路径安全。manifest 中未捕获且不是 nav 的 XHTML 必须报错，不能放入加密/缺失内容。

保留已有正文清理、hdf 私有元数据移除、卷08修正、导航标签、前后彩页归类与默认命名。混合文字/SVG 页面使用正文 CSS；只有无实质正文的 SVG 图片页使用 fixed-layout-jp.css。所有非 XHTML manifest 资源都按清单复制，保留原字节。

复用 src/core/zip-io.js 的 EPUB 打包能力与现有 validator。额外检查 XML 良构、spine/nav 目标、正文前后文本、ruby、资源字节和远程/blob 依赖。validator 的 brokenLinks/orphans 必须参与失败判断，不能只看 ok。

构建在 workDir/epub_build 下的新子目录进行，不预先删除旧 build 目录。ZIP 写入输出文件同目录的临时路径，全部校验通过后才发布；默认已存在目标拒绝覆盖，--replace 仅在新文件校验成功后替换，失败保留旧文件。目录恢复、验证失败及临时输出清理均须有明确结果。

verifyHyreadEpub({config,session,capture,audit,epubPath,requireLive=false}) 返回机器报告。结构/采集/实时比对/语义四种状态分别表示 passed/failed/not-run，不把 not-run 写成 passed。requireLive=true 时缺少完整 audit 或图片 hash 失败。比较 live 的全部文件、目录映射、全文（仅规范化空白）、逐块tag/id/text、ruby、图片引用、链接、分页顺序、可见块覆盖及图片 SHA。先严格比较原始 capture 与原始 audit，再将明确列出的构建修正应用于预期输出进行比较；报告保留 rawTextEqual 与逐项 allowedCorrections，不能把经过修正的一致写成原文逐字一致。

语义材料导出每章带编号文本与图片占位，保留标题、ruby、空白块、章首章尾。自动检查可指出编码异常、括号不平衡等线索，但不能自动给出“语义完整”结论。报告区分来源已有疑点和明确抓取差异。

## 既有卷08修正的例外合同

原始 capture、audit 和语义导出材料保持不变。只有 volume=08 且 assetId=8a8a84ca8cf2eb56018d6786f66a472c 时，构建可在 xhtml/p-toc-001.xhtml 应用下列精确替换：

| 原文 | 构建文本 |
|---|---|
| ６月１日（星期五） | ６月１日（星期二） |
| ６月７日（星期六） | ６月７日（星期一） |

每次替换须记录书籍、文件、from/to、出现次数及 applied/not-applicable。其他 asset、文件或字串不适用。验证器只放行这两项明确变换，额外改字仍失败；报告逐项暴露允许差异，不能省略。未匹配的规则保留为 not-applicable，不凭相似文字修正。

## 命令与文档

统一入口 node bin/cli.js hyread <command>，独立入口 node hyread/cli.mjs <command>；两者行为一致。

命令为 prepare、browser-script、receive、finalize、build、verify、semantic-export。receive 接受 --session/--info/--chunk 三个 JSON 路径；finalize 接受 --session/--info 与可选 --replace；build 接受 --session、可选 --out/--replace；verify 接受 --session、--epub、可选 --audit/--require-live/--report；semantic-export 接受 --session、--audit、--out-dir。browser-script 接受 --session/--mode，stdout 输出可直接内联执行的 JS。

旧数字脚本2/3/4保持入口，接入新的路径、身份及完整性检查，并说明旧目录首次运行 prepare 的迁移步骤。2b 是未列入主流程的历史导入器，保留明确失败的说明入口，指向 prepare；停用其固定13卷批次和直接写资源的行为，避免绕过资源集合校验。runtime 归档为可选历史工具，不把其旧静态 URL 清单纳入常规 prepare。

README 写清从已有 Chrome 页到完整交付的步骤、命令参数、分块传输、失败恢复、实时复核、语义回查及局限。记录第14卷的统计和经验，但不嵌入原文、不写通用“epubcheck 0错误”保证；未运行的官方 EPUBCheck 与阅读器实测如实标为未运行。

## 验收

1. 全部新测试使用临时目录和合成 EPUB/DOM，不依赖 work/13、字体目录、真实书籍或默认卷配置；修正现有导航测试读取旧产物的问题。
2. 覆盖错书、资源路径越界、非200/空响应、缺块/重复块/损坏块/代理对字符、取消/超时/不稳定DOM、错误章节、重复目录标签、未覆盖分页、混合SVG正文、缺失非spine XHTML、失败不覆盖已有文件。
3. 同一合成会话可完成 prepare → capture传输 → build → verify；实时 audit 比对失败会令 CLI 非零，缺失实时证据不能伪装通过。
4. 使用第14卷现有素材作只读兼容验证，输出到隔离的临时位置；真实书籍与工作证据不入提交。
5. 主线程复用原 Chrome 页做新的浏览器脚本实际验证，记录覆盖范围、结果与恢复情况；不得借验证再次触发保存弹窗。
6. 合成测试覆盖卷08允许修正、其他书籍同字串不得修正、额外改字失败，以及已有有效会话在部分资源更新后下载失败时仍只能构建旧的完整资源集合。

