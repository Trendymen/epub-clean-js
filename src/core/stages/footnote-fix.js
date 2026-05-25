// src/core/stages/footnote-fix.js
//
// 通用 footnote 升级阶段：将任意 epub 中的脚注锚点 + aside 升级为
// V8 多端兼容的 STERA 结构（与 books/yimei-seikatsu 同款）。
//
// 三层 API：
//  - 低层 buildSteraFootnote(fn, n, opts?) -> [refHtml, asideHtml]
//      （与 books/yimei-seikatsu/migrate/footnote-cleaner.js 完全兼容；
//        books 模块改为转发到本文件）
//  - stage footnoteFix(buf, ctx?) -> 在内存 EpubBuffer 上做 V8 升级（heal pipeline 用）
//  - 高层 footnoteFixEpub(inEpub, outEpub, opts?) -> 解包/调 stage/重打包（CLI 用）
//
// 兼容输入：calibre-footnote / duokan-footnote / epub3 noteref / 普通 #anchor。
// 输出结构：V8 权威多端兼容（<sub>+width="25"+aside+ol style+li+干净 <p>）。
//
// V8 输出特性：
//  - aside 内 <li><p>正文</p></li>，不含 "注N：" 反向链接前缀（去 V7 风格）
//  - 图标资源自动探测 epub 内实际存在的 note.* / note1.*（webp > png > jpg > gif）
//  - 支持外部 opts 覆盖：iconRegular / iconReview / iconPathPrefix

import { parseHTML } from "linkedom";
import { Buffer } from "node:buffer";
import { readEpub, writeEpub } from "../zip-io.js";

export const DEFAULT_ICON_REGULAR = "note.webp";
export const DEFAULT_ICON_REVIEW = "note1.webp";
export const DEFAULT_ICON_PATH_PREFIX = "../Images/";

/**
 * HTML 转义。等价于 Python html.escape(text, quote=True)。
 * 用于属性值（如 zy-footnote）。
 * @param {string} s
 * @returns {string}
 */
function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * HTML 转义。等价于 Python html.escape(text)（默认 quote=True）。
 * 用于文本节点；与 Python 默认行为一致：默认转义 " 与 '。
 * @param {string} s
 * @returns {string}
 */
function escapeText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * 构建 V8 多端兼容的 STERA 注释结构。
 *
 * - refHtml：插入译文段落内的 `<sub><a><img/></a></sub>` 引用锚点
 * - asideHtml：章节末尾汇总的 `<aside epub:type="footnote">...</aside>` 注释主体
 *   （V8：li 内直接 <p>body</p>，无 "注N：" 前缀反向链接）
 *
 * 兼容入参：
 *  - fn.body 或 fn.text 任一作为正文（body 优先）
 *  - fn.imgFilename 作为兼容回退的图标文件名（legacy；外部已通过 pickIcon 计算）
 *
 * 图标选择优先级：
 *  1. opts.iconRegular / opts.iconReview（外部显式覆盖）
 *  2. fn.imgFilename（legacy 兼容：调用方已自行 pickIcon）
 *  3. 根据 body 是否以 "评：" 开头自动选择 default
 *
 * @param {{ text?: string, body?: string, imgFilename?: string }} fn
 * @param {number} newIdNumber 1-based 编号（每章重置）
 * @param {object} [opts]
 * @param {string} [opts.iconRegular] 显式覆盖普通注图标文件名，如 "note.png"
 * @param {string} [opts.iconReview] 显式覆盖评论注图标文件名
 * @param {string} [opts.iconPathPrefix] 图标 src 前缀，默认 "../Images/"
 * @returns {[string, string]} [refHtml, asideHtml]
 */
export function buildSteraFootnote(fn, newIdNumber, opts = {}) {
  const padded = String(newIdNumber).padStart(3, '0');
  const newId = `note${padded}`;
  const refId = `note_ref${padded}`;

  const body = fn.body ?? fn.text ?? '';
  const isReview = String(body).trim().startsWith('评：');

  const iconPathPrefix = opts.iconPathPrefix ?? DEFAULT_ICON_PATH_PREFIX;
  let icon;
  if (isReview) {
    icon = opts.iconReview ?? (fn.imgFilename && /1(?=\.[^.]+$)/.test(fn.imgFilename) ? fn.imgFilename : null) ?? fn.imgFilename ?? DEFAULT_ICON_REVIEW;
  } else {
    icon = opts.iconRegular ?? fn.imgFilename ?? DEFAULT_ICON_REGULAR;
  }

  const refHtml =
    `<sub><a class="duokan-footnote" epub:type="noteref" ` +
    `href="#${newId}" id="${refId}">` +
    `<img width="25" alt="note" class="zhangyue-footnote" ` +
    `src="${iconPathPrefix}${icon}" ` +
    `zy-footnote="${escapeAttr(body)}"/></a></sub>`;

  // V8：li 内直接 <p>正文</p>，不再含 "<a href="#refId">注N</a>：" 前缀反向链接
  const asideHtml =
    `<aside epub:type="footnote" id="${newId}">` +
    `<ol class="duokan-footnote-content" style="list-style:none">` +
    `<li class="duokan-footnote-item" id="${newId}">` +
    `<p>${escapeText(body)}</p>` +
    `</li>` +
    `</ol>` +
    `</aside>`;

  return [refHtml, asideHtml];
}

/**
 * 判定注释正文应使用 note.webp（解释类“注：”）还是 note1.webp（评论类“评：”）。
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.iconRegular]
 * @param {string} [opts.iconReview]
 * @returns {string} 文件名
 */
function pickIcon(text, opts = {}) {
  const regular = opts.iconRegular ?? DEFAULT_ICON_REGULAR;
  const review = opts.iconReview ?? DEFAULT_ICON_REVIEW;
  return String(text).trim().startsWith('评：') ? review : regular;
}

/**
 * 找出章节内所有 footnote 锚点（兼容 calibre / duokan / epub3）。
 * @param {Document} document
 * @returns {Element[]}
 */
function findAnchors(document) {
  const seen = new Set();
  const out = [];
  const all = document.querySelectorAll('a[href]');
  for (const a of all) {
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('#')) continue;

    // 命名空间冒号属性在 CSS 选择器里不便表达，这里直接读属性判断
    const epubType = a.getAttribute('epub:type') || a.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') || '';
    const cls = a.getAttribute('class') || '';
    const isFootnoteAnchor =
      epubType === 'noteref' ||
      /\bcalibre-footnote\b/.test(cls) ||
      /\bduokan-footnote\b/.test(cls) ||
      // 锚点子节点是 sup/sub + img 也算（兜底：常见旧版结构）
      !!a.querySelector?.('img');

    if (!isFootnoteAnchor) continue;
    if (seen.has(a)) continue;
    seen.add(a);
    out.push(a);
  }
  return out;
}

/**
 * 抽取锚点对应的脚注正文（按 href #id 找配对的 aside / li / section / note 元素）。
 * @param {Element} anchor
 * @param {Document} document
 * @returns {string}
 */
function extractBody(anchor, document) {
  const href = anchor.getAttribute('href') || '';
  if (!href.startsWith('#')) return '';
  const targetId = href.slice(1);
  const target = document.getElementById(targetId);
  if (!target) return '';

  // 优先取 li/p 的文本，回退到整个 target 的 textContent。
  // 这样可以避免把内嵌反向链接（"注1："）也一并吸进去。
  const innerP = target.querySelector?.('li p, li, p');
  const raw = (innerP ? innerP.textContent : target.textContent) || '';
  // 移除可能存在的旧版反向链接前缀（如 "注1：" / "注：" / 数字标号）
  return raw.replace(/^\s*注\d*[:：]\s*/, '').trim();
}

/**
 * 升级单个章节 XHTML。
 *  - 找出所有脚注锚点
 *  - 抽取每个锚点的正文
 *  - 删除原 aside / 旧 note 容器
 *  - 替换锚点为 V8 ref
 *  - 在 body 末尾追加 V8 aside
 *
 * 若章节内没有任何锚点，原样返回（不改动）。
 *
 * @param {string} xhtml
 * @param {object} [opts]
 * @param {string} [opts.iconRegular]
 * @param {string} [opts.iconReview]
 * @param {string} [opts.iconPathPrefix]
 * @returns {string}
 */
export function upgradeFootnotes(xhtml, opts = {}) {
  const { document } = parseHTML(xhtml);

  // 先 unwrap 非标准 <note> 容器（部分旧 epub 把 <p>+anchor+<aside> 全包在 <note> 里）。
  // 把其子节点提升到父级、再删除 <note> 标签本身，这样：
  //  1. 内部 anchor 进入正常文档流，下文 replaceWith 有效
  //  2. 内部 aside 跟随后续 querySelectorAll('aside') 步骤被一并删除
  // 必须在 findAnchors 之前做，否则后续 replaceWith 会作用在已脱离文档的节点上。
  for (const n of [...document.querySelectorAll('note')]) {
    const parent = n.parentNode;
    if (!parent) continue;
    while (n.firstChild) parent.insertBefore(n.firstChild, n);
    parent.removeChild(n);
  }

  const anchors = findAnchors(document);
  if (anchors.length === 0) return xhtml;

  // pre-pass 收集所有 anchor + body（避免遍历过程中 DOM 变化导致 querySelector 失效）
  const items = anchors.map((a) => ({
    anchor: a,
    text: extractBody(a, document),
  }));

  // 删除原 aside 块（避免新旧并存）
  for (const a of [...document.querySelectorAll('aside')]) a.remove();

  const asides = [];
  for (let i = 0; i < items.length; i++) {
    const { anchor, text } = items[i];
    const imgFilename = pickIcon(text, opts);
    const [refHtml, asideHtml] = buildSteraFootnote({ text, imgFilename }, i + 1, opts);

    // 替换锚点（连同外层 sub/sup 一并替换，避免出现嵌套 sub）
    let replaceTarget = anchor;
    const parent = anchor.parentElement;
    if (parent && (parent.tagName === 'SUP' || parent.tagName === 'SUB')) {
      // 父级只有这一个 anchor 子元素时，整体替换
      const otherChildren = [...parent.childNodes].filter(
        (n) => !(n === anchor || (n.nodeType === 3 && !n.textContent?.trim())),
      );
      if (otherChildren.length === 0) replaceTarget = parent;
    }

    const wrapper = document.createElement('span');
    wrapper.innerHTML = refHtml;
    const newRefNode = wrapper.firstElementChild;
    if (newRefNode) replaceTarget.replaceWith(newRefNode);

    asides.push(asideHtml);
  }

  // 追加所有 aside 到 body 末尾
  if (asides.length > 0 && document.body) {
    const asideWrapper = document.createElement('div');
    asideWrapper.innerHTML = asides.join('');
    while (asideWrapper.firstChild) {
      document.body.appendChild(asideWrapper.firstChild);
    }
  }

  // linkedom 的 document.toString() 已经包含原文档的 DOCTYPE。
  // 这里只补 XML 声明（XHTML / epub 规范要求开头有 <?xml ... ?>）。
  let prefix = '';
  const xmlDecl = xhtml.match(/^<\?xml[^?]*\?>\s*/);
  if (xmlDecl) prefix = xmlDecl[0];
  else prefix = '<?xml version="1.0" encoding="utf-8"?>\n';

  return prefix + document.toString();
}

/**
 * 探测 EpubBuffer.entries 里实际存在的图标资源。
 * 按目录优先级（OEBPS/Images > Images > OPS/Images）+ 扩展名优先级
 * （webp > png > jpg > jpeg > gif）查找 note.* / note1.*。
 *
 * @param {object} entries epub entries 对象（{ name -> Buffer }）
 * @returns {{ regular: string|null, review: string|null }}
 */
function detectIconsFromEntries(entries) {
  const dirs = ['OEBPS/Images', 'Images', 'OPS/Images'];
  const exts = ['.webp', '.png', '.jpg', '.jpeg', '.gif'];
  const names = Object.keys(entries);
  for (const dir of dirs) {
    let regular = null;
    let review = null;
    for (const ext of exts) {
      const noteName = `${dir}/note${ext}`;
      const note1Name = `${dir}/note1${ext}`;
      if (!regular && names.includes(noteName)) regular = `note${ext}`;
      if (!review && names.includes(note1Name)) review = `note1${ext}`;
    }
    if (regular || review) return { regular, review };
  }
  return { regular: null, review: null };
}

/**
 * 探测章节文本目录前缀（OEBPS/Text / Text / OPS/Text）。
 * @param {object} entries
 * @returns {string|null} 例如 "OEBPS/Text"，若都没有返回 null
 */
function detectTextDir(entries) {
  const candidates = ['OEBPS/Text', 'Text', 'OPS/Text'];
  const names = Object.keys(entries);
  for (const dir of candidates) {
    if (names.some((n) => n.startsWith(`${dir}/`))) return dir;
  }
  return null;
}

/**
 * footnote-fix 作为 pipeline stage 的形态。
 * 在内存 EpubBuffer 上执行 V8 升级：
 *  1. 从 entries 探测图标资源 + 章节文本目录
 *  2. 对 textDir 下所有 *.xhtml/*.html 调 upgradeFootnotes
 *  3. 返回新的 EpubBuffer（entries 复制 + 替换被改文件）
 *
 * 可选 ctx.footnoteOpts 覆盖：iconRegular / iconReview / iconPathPrefix。
 *
 * @param {{ names: string[], entries: object, meta?: any }} buf
 * @param {object} [ctx]
 * @returns {{ names: string[], entries: object, meta?: any }}
 */
export function footnoteFix(buf, ctx = {}) {
  const opts = ctx.footnoteOpts ?? {};
  const detected = detectIconsFromEntries(buf.entries);
  const effectiveOpts = {
    iconRegular: opts.iconRegular ?? detected.regular ?? DEFAULT_ICON_REGULAR,
    iconReview:
      opts.iconReview ??
      detected.review ??
      opts.iconRegular ??
      detected.regular ??
      DEFAULT_ICON_REVIEW,
    iconPathPrefix: opts.iconPathPrefix ?? DEFAULT_ICON_PATH_PREFIX,
  };

  const textDir = detectTextDir(buf.entries);
  if (!textDir) {
    console.warn('[footnote-fix] 跳过：找不到章节文本目录（OEBPS/Text、Text、OPS/Text）');
    return buf;
  }

  console.log(
    `[footnote-fix] icons: regular=${effectiveOpts.iconRegular}, review=${effectiveOpts.iconReview} textDir=${textDir}`,
  );

  const newEntries = { ...buf.entries };
  let changedFiles = 0;
  for (const name of Object.keys(buf.entries)) {
    if (!name.startsWith(`${textDir}/`)) continue;
    if (!(name.endsWith('.xhtml') || name.endsWith('.html'))) continue;
    const before = buf.entries[name].toString('utf8');
    const after = upgradeFootnotes(before, effectiveOpts);
    if (after !== before) {
      newEntries[name] = Buffer.from(after, 'utf8');
      changedFiles++;
    }
  }
  console.log(`[footnote-fix] changed ${changedFiles} chapter(s)`);

  return { ...buf, entries: newEntries };
}

/**
 * 整本 epub 升级（CLI 入口用）。
 *  1. readEpub 解包到 EpubBuffer
 *  2. 调用 footnoteFix stage
 *  3. writeEpub 输出到 outEpubPath
 *
 * @param {string} inEpubPath
 * @param {string} outEpubPath
 * @param {object} [opts]
 * @param {string} [opts.iconRegular] 显式覆盖（跳过探测）
 * @param {string} [opts.iconReview]
 * @param {string} [opts.iconPathPrefix]
 * @returns {Promise<{ textDir: string, files: number, changedFiles: number, icons: { regular: string, review: string } }>}
 */
export async function footnoteFixEpub(inEpubPath, outEpubPath, opts = {}) {
  const buf = await readEpub(inEpubPath);

  // 探测信息用于返回结构（供 CLI 打印）
  const detected = detectIconsFromEntries(buf.entries);
  const effectiveIcons = {
    regular: opts.iconRegular ?? detected.regular ?? DEFAULT_ICON_REGULAR,
    review:
      opts.iconReview ??
      detected.review ??
      opts.iconRegular ??
      detected.regular ??
      DEFAULT_ICON_REVIEW,
  };
  const textDir = detectTextDir(buf.entries);
  if (!textDir) {
    throw new Error('找不到章节文本目录（试过 OEBPS/Text、Text、OPS/Text）');
  }

  const before = { ...buf.entries };
  const outBuf = footnoteFix(buf, { footnoteOpts: opts });

  // 统计章节文件数（textDir 下 xhtml/html）和被改动文件数
  const chapterNames = Object.keys(outBuf.entries).filter(
    (n) =>
      n.startsWith(`${textDir}/`) && (n.endsWith('.xhtml') || n.endsWith('.html')),
  );
  let changedFiles = 0;
  for (const n of chapterNames) {
    if (before[n] !== outBuf.entries[n]) changedFiles++;
  }

  await writeEpub(outEpubPath, outBuf.entries);

  return {
    textDir,
    files: chapterNames.length,
    changedFiles,
    icons: effectiveIcons,
  };
}
