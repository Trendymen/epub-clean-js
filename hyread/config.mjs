// hyread/config.mjs
//
// HyRead 在线阅读器版抓取 → EPUB 流程的集中配置。
// 换卷只需改这里的 VOLUME / ASSET_ID / BOOK_TITLE，其余脚本自动跟随。
// 所有路径都相对本目录（hyread/）解析，无任何机器绝对路径。

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HYREAD_DIR = dirname(fileURLToPath(import.meta.url)); // .../epub-clean-js/hyread

// ===== 当前处理的卷（换卷改这三项）=====
export const VOLUME = '08';
export const ASSET_ID = '8a8a84ca8cf2eb56018d6786f66a472c'; // 阅读器 URL 里的 asset_id
export const BOOK_TITLE = '義妹生活 8';

// ===== 服务端 =====
export const SERVICE = 'https://service.ebook.hyread.com.tw';
export const EPUB_BASE = `${SERVICE}/ebookservice/epub/${ASSET_ID}/`;
export const ITEM_BASE = `${EPUB_BASE}item/`;

// ===== 目录布局（work/<卷>/… 为中间资源，项目根 output/hyread/ 为成品）=====
export const HYREAD_ROOT = HYREAD_DIR;
export const WORK = join(HYREAD_DIR, 'work', VOLUME);
export const RESOURCES = join(WORK, 'resources'); // 步骤 1/2 下载产物（页面资源 + EPUB 原始内容）
export const EPUB_ITEM = join(RESOURCES, `ebookservice/epub/${ASSET_ID}/item`); // OPF / css / img / 加密 xhtml
export const GRAB_JSON = join(WORK, 'grab_xml.json'); // 步骤 3（浏览器）解密抓取产物
export const DECRYPTED = join(WORK, 'decrypted'); // 步骤 4a 导出的解密正文 xhtml
export const EPUB_BUILD = join(WORK, 'epub_build'); // 步骤 4b EPUB 组装目录
// 成品遵循工程约定：落到项目根 output/ 下（与 healed/ translated/ clean/ 同级），
// 单列 hyread/ 子目录，命名沿用工程风格 [作者].义妹生活.NN.[版本].<来源>.epub
export const PROJECT_ROOT = resolve(HYREAD_DIR, '..', '..'); // = 义妹生活/（epub-clean-js 的上一级）
export const OUTPUT_DIR = join(PROJECT_ROOT, 'output', 'hyread');
export const OUTPUT_EPUB = join(OUTPUT_DIR, `[三河ごーすと].义妹生活.${VOLUME}.[台繁].hyread.epub`);
