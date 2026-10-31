# HyRead 可复用抓取与复核 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. 用户已指定 SDD 并要求后续不再请求流程确认；保留独立文档与代码审查。

**Goal:** 将已登录 Chrome 中的 HyRead 采集、无弹窗数据传输、本地 EPUB 构建和实时内容复核变成可复用的项目流程。

**Architecture:** 浏览器普通 JS 安装一个可观察、可取消、可分块导出的运行时；Node ESM 负责配置、资源会话、可靠接收、构建与报告。资源集合按每次准备独立保存，成功后才发布会话。旧数字入口转接新模块，CLI 负责组合。

**Tech Stack:** Node >=18、node:test、现有 fast-xml-parser/linkedom/ZIP 工具、Chrome 页面现有 HyRead reader API；不新增运行依赖。

**Spec:** epub-clean-js/docs/superpowers/specs/2026-10-31-hyread-reusable-workflow-design.md（相对于 Git 根）

## Global Constraints

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

每个实现者只拥有当前 Task 明列的文件。不得派子代理；主线程统一派 reviewer。所有说明、注释、报告按 shuorenhua minimal 自查。每个任务遵循 TDD，记录真实 RED/GREEN；报告必须包含验证命令与输出。新测试在临时目录使用合成数据。若需要新增辅助文件，先向控制器说明职责和原因，由控制器裁定。

工作目录均以 Node 工程为准，即 Git 根下的 epub-clean-js/。源码外的 SDD briefs/reports/review packages 由控制器安排，不入提交。提交只显式暂存 Task 文件，不能包含先前用户 README 改动或书籍输出（README 由 Task 5 合并处理）。

## Review Focus

- 准备中途失败、源 OPF 不变但图片更新：Task 1 证明旧会话仍指向完整旧资源集合，Task 3 证明构建拒绝被改动的已发布资源。
- 错书、路径别名、编码后的穿越和符号链接：Task 1/3 覆盖源与写入边界；路径安全失败须发生在目标文件变更前。
- 不稳定 iframe、同名目录项、分页漏走、取消后恢复失败：Task 2 的 DOM/reader 驱动测试覆盖；Task 4 不得把不完整证据判为通过。
- UTF-8 代理对字符、乱序块与重复块、同名成品：Task 3 证明传输与发布的完整性和不覆盖规则。
- 卷08允许修正与额外改字：Task 3/4 分别证明精确修正规则和 rawTextEqual/allowedCorrections 报告，Task 5 做 CLI 回归。

## 文件职责

- config.mjs：运行参数与旧常量兼容。
- lib/paths.mjs、lib/session.mjs：安全路径、原子写入、清单与不可变资源会话。
- browser/capture-decrypted.js、lib/browser-script.mjs：浏览器运行时与注入代码生成。
- lib/artifacts.mjs、lib/transfer.mjs：capture/audit 数据约束与分块接收。
- lib/content.mjs、lib/build.mjs：原文检查、允许修正、EPUB 构建。
- lib/verify.mjs、lib/reports.mjs：实时差异检查、JSON/Markdown报告与语义材料。
- cli.mjs、数字脚本、bin/cli.js：入口与兼容转接。
- test/helpers/hyread-fixtures.mjs、test/helpers/hyread-browser-fixture.mjs：仅测试用的合成会话和阅读器。

## 控制器验收与收尾

- 每个 Task 按 L2 分派两个独立 reviewer（SPEC_COMPLIANCE、CODE_QUALITY），使用有界brief/report/真实验证/diff；Important/Critical修复后复用原reviewer复审。
- 全部任务后，生成初始基准7adb0a7fa044360391575128d13ea025787cb602到最终HEAD的完整审查包，执行独立整支审查。
- 不推送、不合并共享分支。用户已要求不再流程确认，完成后保留可用隔离分支并交付具体路径、命令、测试结果和材料。

---

### Task 1: 参数化配置与完整资源会话

**Files:**
- Modify: hyread/config.mjs
- Create: hyread/lib/paths.mjs, hyread/lib/session.mjs
- Create: test/helpers/hyread-fixtures.mjs
- Test: test/unit/hyread-session.test.js

**Interfaces:**
- Produces resolveHyreadConfig(options = {})：options 为 volume/assetId/title/workDir/outputPath/projectRoot；返回 Spec 中 camelCase 配置。保留当前08卷的大写导出，不在 import 时写文件。
- Produces safeRelativePath(href)（规范化并拒绝不安全路径）、safeJoin(root, href)（异步检查实际祖先路径不越界）、writeFileAtomic(destination, bytes, {replace=false} = {})；后续模块复用。
- Produces prepareSession(config, {fetchImpl=globalThis.fetch,timeoutMs=30000} = {})、loadSession(sessionPath, {outputPath} = {}) → {config,session}、validateSession(session) → session（无效抛错）。
- Session 精确字段：schemaVersion:1、volume、assetId、title、sourceOpfSha256、resourceRoot、resources、manifest、spine。resources[href]={bytes,sha256}；含 standard.opf 和全部 manifest。manifest[]={id,href,mediaType,properties:string[]}，spine[]={id,href}。resourceRoot 为 resources/generations/<本次唯一标识>，实际 itemDir 为其下 ebookservice/epub/<assetId>/item。
- Test fixture 产出独立临时 config、合成 OPF、三篇有序正文（含图片页、混合SVG/文本页）、nav、样式和小图片，fetchImpl 返回具有准确 url/status/bytes 的响应。暴露 createHyreadFixture(options = {}) → {config,opf,resources,capture,fetchImpl,cleanup}；capture 为旧 {order,data}。fixture 只用于测试。

- [ ] **Step 1: 写失败测试。** 用临时目录证明 config 路径不受默认 cwd 影响、显式路径按 cwd 解析、volume 标准化、asset/title 验证和旧常量未变；prepare 的 manifest/spine 顺序及逐资源 SHA 可核对。
- [ ] **Step 2: 跑 RED。** Run: node --test test/unit/hyread-session.test.js。记录缺失功能的实际失败，不用语法/import 拼写错误充当 RED。
- [ ] **Step 3: 实现路径与会话。** OPF 用 fast-xml-parser；目录、ID、href 不重复且每个 spine 引用有效；并发4、请求超时、检查200/非空/最终同书URL。每轮写独立资源集合，全部成功再原子发布 session。loadSession 校验 schema、资源全集/长度/hash/OPF，检查路径实际落点。
- [ ] **Step 4: 扩展失败路径测试并变绿。** 非200/空OPF/缺spine/跨域重定向/编码穿越/符号链接越界/同目录不同书；已有有效会话部分资源新版本成功后其他项失败，旧session与全部旧资源仍可读取；修改发布后的单个字节则loadSession失败。Windows无法创建符号链接时记录该项真实 skip，不假称通过。
- [ ] **Step 5: 验证与提交。** 跑本任务测试、npm run test:portability、npm test。全量基线143/158，15项失败已保存在控制器基线日志，必须列出是否新增失败。显式暂存本任务文件并提交 feat(hyread): add verified per-book resource sessions。

### Task 2: 无弹窗浏览器采集与实时分页复核

**Files:**
- Modify: hyread/browser/capture-decrypted.js
- Create: hyread/lib/browser-script.mjs
- Create: test/helpers/hyread-browser-fixture.mjs
- Test: test/unit/hyread-browser.test.js

**Interfaces:**
- Consumes Task 1 Session（只读），不调用 Node 文件 API。
- Produces window.__hyreadWorkflow：describe/start/status/cancel/exportInfo/readChunk/clear，签名和状态按 Spec。
- Produces createBrowserScript(session, {mode='capture'} = {}) → Promise<string>：安装代码与异步 start 调用，适用于普通 script/evaluate_script；结果只返回摘要，完整数据通过分块接口获取。
- Capture 仍有 order/data；meta 包含 schemaVersion:1、kind:'capture'、assetId、title、sourceOpfSha256、complete:true、时间与 restoration。
- Audit 为 {meta,tocEntries,records,imageHashes,issues}，meta.kind='audit'；tocEntries[]={label,src} 保留原始顺序和同名条目。record 字段固定为 src/spineId/spineIndex/bodyText/paragraphs/images/ruby/bodyLinks/pageCount/pageChecks/bodyChanges/unseenTextBlocks/errors。
- paragraphs[]={index,tag,id,text,semantic,display,visibility}：tag 用小写；text 仅压缩空白；semantic 保留图片占位在文字中的位置；images 含 tag/src/alt/paragraphIndex/width/height/complete/naturalWidth；bodyLinks[]={text,href}；pageChecks[]={page,total,bodyUnchanged,visibleBlocks:number[]}；imageHashes[]={url,bytes,sha256}。
- exportInfo 固定 {schemaVersion:1,kind,assetId,sourceOpfSha256,byteLength,sha256,chunkBytes,chunkCount}；readChunk 固定 {sha256,index,offset,bytes,dataBase64}。chunkBytes 默认12000，可正整数配置；UTF-8 字节分块，不按 JS 字符切片。

- [ ] **Step 1: 写可执行的浏览器驱动 fixture 与失败测试。** 用 linkedom + node:vm 执行真实脚本，模拟三spine、React item、可见几何、字体就绪和 reader 翻页；测试脚本不创建下载 anchor、不调用 a.click 或改变用户设置，完整采集原始 XML。
- [ ] **Step 2: 跑 RED。** Run: node --test test/unit/hyread-browser.test.js。记录固定等待旧实现无法满足稳定/取消/分块行为的证据。
- [ ] **Step 3: 实现 capture 生命周期和导出。** 幂等安装；任务互斥；源书名/asset/当前OPF hash检查；正确spine、可见面积、document/font和文本多次稳定；失败/取消不得complete或导出“完整”结果；恢复起始spine/page并单独记录恢复失败。默认15000/150/3。入口不自动执行任务。
- [ ] **Step 4: 实现 audit。** 读取并按序号点击官方目次，不按label去重；每个唯一spine回到第1页、依次翻至末页并记录可见块和变化；从章节顺序补齐目录外spine。图片重新fetch同书已观察URL并算SHA，结果保留问题供本地判断。所有循环有数量/时间边界和取消检查。
- [ ] **Step 5: 覆盖异常并验证。** 错书、源OPF变化、iframe不可见、持续变化、超时、序列化失败、无法翻页、重复目录名称、页码跳跃、取消/恢复失败、运行时再次安装和clear、emoji跨块边界；测试必须经过真实脚本 API 与 DOM 数据，而非只断言mock次数。跑focused、portability、full并记录基线差异。
- [ ] **Step 6: 提交。** 显式提交本任务文件，feat(hyread): capture and audit the active reader without downloads。

### Task 3: 可重试接收与受校验的 EPUB 构建

**Files:**
- Create: hyread/lib/artifacts.mjs, hyread/lib/transfer.mjs, hyread/lib/content.mjs, hyread/lib/build.mjs
- Test: test/unit/hyread-transfer.test.js, test/unit/hyread-build.test.js
- Modify only if fixture extension needed: test/helpers/hyread-fixtures.mjs

**Interfaces:**
- Consumes Task 1 config/session/paths helpers and Task 2 payload schemas。
- Produces validateCapture(capture, session)、validateAuditEnvelope(audit, session)：检查身份、类型、完整标记、键/顺序/预期spine与必需字段，无效抛错；旧 capture 无meta允许，存在meta则严格检查。
- Produces receiveChunk(config, info, chunk)、finalizeTransfer(config, info, {replace=false} = {}) → {path,bytes,sha256,reused}。保存专属块文件，允许乱序和相同重试，最终校验完整再发布；失败不改已有最终文件。
- Produces normalizeText(text)、inspectXhtml(html) → {bodyText,blocks:[{tag,id,text}],images:[{tag,src,alt}],ruby:string[],links:[{text,href}]}；tag统一小写。供后续验证复用，不改正文。
- Produces applyApprovedCorrections(html,{volume,assetId,href}) → {html,corrections}；corrections 逐项含 file/from/to/occurrences/status，status 为 applied/not-applicable。
- Produces buildHyreadEpub(config,{replace=false}={}) → {outputPath,buildDir,report,sha256}；内部 loadSession(config.sessionPath) 重新取得受校验的资源集合。
- Produces checkBuiltEpub({config,session,capture,epubPath}) → {ok,issues,allowedCorrections,rawTextEqual,stats}，给 Task 4 复用。
- 本任务不改旧数字脚本或 CLI，转接由 Task 5 负责。

- [ ] **Step 1: 写失败测试并跑 RED。** Run: node --test test/unit/hyread-transfer.test.js test/unit/hyread-build.test.js。覆盖 UTF-8 emoji、乱序/同块重试、损坏base64/hash/offset/长度/缺块/错书/不完整meta、不同内容覆盖拒绝，断言最终文件保持原字节。
- [ ] **Step 2: 实现安全传输。** 使用专属kind/hash目录与受限索引，不接受远端文件名；校验所有元数据和严格Base64、fatal UTF-8、JSON schema。接收过程可重入，不把已有块冲突当成功。finalize 同字节重试可直接返回；不同内容仅显式 replace。
- [ ] **Step 3: 提取已有构建逻辑。** 从现有脚本4迁移清理、导航、前后彩页标号和字节保留逻辑；共用 zip-io 的打包。只在新 build 子目录工作，检查全部非XHTML资源、spine与未捕获非nav XHTML；ZIP使用同目录临时文件，校验完成才发布。
- [ ] **Step 4: 固定允许修正。** 仅 volume=08 且 assetId=8a8a84ca8cf2eb56018d6786f66a472c、文件xhtml/p-toc-001.xhtml可用两条：６月１日（星期五）→６月１日（星期二）；６月７日（星期六）→６月７日（星期一）。旧capture/audit保持原始。报告逐项记录，其他asset同字串不改。正文页混合SVG不加载font-size:0的图片CSS。
- [ ] **Step 5: 实现构建后检查并验证。** 调用既有validator并合并issues/brokenLinks/orphans；额外XML、spine/nav引用、原文与允许修正、ruby、图片/样式字节、远程/blob依赖检查。测试故意缺章、额外改字、缺非spine XHTML、损坏已发布资源、SVG混合文本和构建失败保护旧成品。跑focused、portability、full，列出基线差异。
- [ ] **Step 6: 提交。** 显式提交本任务文件，feat(hyread): verify chunk transfers and publish validated EPUBs。

### Task 4: 实时内容比对与语义材料报告

**Files:**
- Create: hyread/lib/verify.mjs, hyread/lib/reports.mjs
- Test: test/unit/hyread-verify.test.js
- Modify only if helper extension needed: test/helpers/hyread-fixtures.mjs

**Interfaces:**
- Consumes loadSession/validateCapture/validateAuditEnvelope/inspectXhtml/applyApprovedCorrections/checkBuiltEpub。
- Produces verifyHyreadEpub({config,session,capture,audit,epubPath,requireLive=false}) → Promise<report>。
- report 含 schemaVersion:1、ok、artifact（path/sha256）、checks（structure/capture/live/semantic，各有status=passed|failed|not-run和issues）、allowedCorrections、rawTextEqual、stats、perDocument。semantic 始终 not-run，不自动判断文学语义完整。
- Produces writeVerificationReports(report,jsonPath) → {jsonPath,markdownPath}；jsonPath须以.json结尾，Markdown写同名.md，默认不覆盖不同旧报告。
- Produces exportSemanticMaterial(audit,outDir) → {indexPath,files}；按章节导出编号文本/图片占位/标题/ruby/空白块/章首尾和来源位置，附index.json。输出材料是原始浏览器正文，不套卷08修正。

- [ ] **Step 1: 写失败测试并跑 RED。** Run: node --test test/unit/hyread-verify.test.js。用合成 capture/audit/EPUB 验证缺少audit为not-run，requireLive则失败；任何额外缺字、段落顺序/tag/id变化、ruby/图片/链接变化必须失败。
- [ ] **Step 2: 实现完整实时比较。** Audit身份和OPF hash匹配；record全集与spine精确对应；逐文件/逐块比对原始capture与audit，再按允许构建修正核对EPUB。检查分页1..pageCount、bodyChanges、未覆盖文本、加载错误、审计issues，不能接受只有文件数量相同的证据。
- [ ] **Step 3: 核对目录与图片。** 保留同名目录项/同日双视角；规范化NFKC和空白，允许结构标签書封/封面、目錄/目次；实际目标不能错配。目录外结构页不算缺章。live imageHashes 必须覆盖所有实际图像引用且与EPUB字节/哈希一致，缺项不能通过。
- [ ] **Step 4: 生成报告与语义材料。** JSON与Markdown一致暴露passed/failed/not-run、rawTextEqual、允许差异和证据位置；短章、图片占位、章节边界作为审查材料，不自动改文。书籍URL不得带data参数或账号信息。
- [ ] **Step 5: 覆盖回归并提交。** 合成同名目录不同target、漏页、漏图hash、body在翻页中改变、错误meta、卷08允许差异及额外改字；验证语义导出没有丢空白块/图像位置，报告没有伪造语义通过。跑focused、portability、full后提交 feat(hyread): compare live reader evidence and export review reports。

### Task 5: CLI、旧入口、文档与端到端验收

**Files:**
- Create: hyread/cli.mjs
- Modify: bin/cli.js, package.json, hyread/README.md
- Modify: hyread/scripts/2-download-epub-content.mjs, 2b-save-downloaded.mjs, 3-extract-decrypted.mjs, 4-build-epub.mjs
- Test: test/unit/hyread-build-nav.test.js, test/e2e/hyread-workflow.e2e.test.js

**Interfaces:**
- Consumes Task 1–4 的公开接口；不在 CLI 再实现抓取、校验、打包算法。
- Produces node bin/cli.js hyread <command> 和 node hyread/cli.mjs <command>。prepare --volume --asset-id --title [--work-dir]；browser-script --session --mode；receive --session --info --chunk；finalize --session --info [--replace]；build --session [--out] [--replace]；verify --session --epub [--audit] [--require-live] [--report <.json>]；semantic-export --session --audit --out-dir。
- 缺参/未知参数/失败检查返回非零；browser-script stdout只能输出JS。默认verify报告写到本会话 reports/ 下唯一文件名。公开help应覆盖每个子命令。
- 新增 npm run test:hyread，使用显式Node脚本文件列表或现有递归选择器，不能依赖shell glob展开。
- 数字2/3/4接受 --session 或显式书籍配置并转接；无参仍从旧配置选择08，但新构建要求已prepare。2b停用直接资源写入，返回明确替代命令和非零状态。步骤1运行时归档不变。

- [ ] **Step 1: 写 CLI/旧入口失败测试并跑 RED。** 合成临时会话，prepare层网络用受控fixture（不请求HyRead）；CLI实际子进程测试 build/verify/receive/finalize/help，错误输入不写目标。改写旧hyread-build-nav测试，使它只读取自己刚刚构建的合成输出。
- [ ] **Step 2: 连接入口。** dispatcher 注册 hyread；使用node:util parseArgs或等价现有模式，保持旧hyread-to-simple命令不变；文件输入明确解析JSON，调用已实现库接口，不吞异常。数字入口迁移遵循Spec；不把旧README调整覆盖回去。
- [ ] **Step 3: 写复用文档。** 完整流程含从已有Chrome确认身份、prepare、生成注入代码、status/cancel、exportInfo/readChunk与Node模块接收、finalize/build/verify/semantic-export；说明工具sourcePath不可用时可用已读取的内联代码，分块大小可调。写清generation资源路径、旧数据迁移、失败重试/replace、位置恢复、官方EPUBCheck未执行时的表述、语义回查与源文本疑点不改字。保留原有CSS/XML/nav经验，替换过时的“必须手动下载/通用epubcheck0错误”说法。
- [ ] **Step 4: 完成合成端到端验证。** 当前cwd外启动CLI；三个spine和一个目录外结构项；数据分块→最终capture→build→verify；live坏数据必须非零、源OPF或资源变更必须拒绝；默认成品保护。测试不使用work/13和真实书。
- [ ] **Step 5: 兼容验收。** 控制器提供原第14卷旧capture路径，仅作只读输入；用独立临时workDir准备资源并构建，输出独立路径，对比32文件正文和22图/7CSS及允许差异，不覆盖已有EPUB。此条由控制器执行或与实现者明确交接，报告不得先宣称通过。
- [ ] **Step 6: 浏览器实测交接。** 由控制器独占原Chrome标签，使用新脚本执行capture与audit、分块接收和require-live验证，记录实际范围/哈希/结果，恢复阅读位置。实现者不得同时操作浏览器。若私有reader适配有问题，由控制器把具体证据交回 Task 2 实现者，并复用 Task 2 原 reviewer 对适配修复复审；若涉及命令组合或文档，则由 Task 5 实现者处理其所有文件并复审。
- [ ] **Step 7: 全部验证与提交。** 跑 npm run test:hyread、npm run test:portability、npm test；预期旧HyRead数据依赖失败消失，其余外部字体基线失败逐项报告，不改无关字体模块。提交 feat(hyread): expose reusable workflow commands and runbook。
