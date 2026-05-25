/**
 * 义妹生活专用：注释清洗到 V8 多端兼容 STERA 格式。
 *
 * 当前没有义妹特定预处理，直接转发到通用 core 实现
 * （src/core/stages/footnote-fix.js 的 buildSteraFootnote）。
 * 保留薄包装以便未来加书特定逻辑（如义妹专有正文规范化等）。
 *
 * 签名 / 返回值与原实现 100% 一致：
 *   buildSteraFootnote(fn, newIdNumber, opts?) -> [refHtml, asideHtml]
 *
 * 新增 opts（可选，透传到 core）：
 *   - iconRegular   显式覆盖普通注图标文件名（如 "note.png"）
 *   - iconReview    显式覆盖评论注图标文件名
 *   - iconPathPrefix 图标 src 前缀（默认 "../Images/"）
 */

import { buildSteraFootnote as coreBuildSteraFootnote } from '../../../src/core/stages/footnote-fix.js';

export function buildSteraFootnote(fn, newIdNumber, opts) {
  return coreBuildSteraFootnote(fn, newIdNumber, opts);
}

export default buildSteraFootnote;
