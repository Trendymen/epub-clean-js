/**
 * 把 DST 注释定位到 SRC 段落里的字符偏移（移植自 Python footnote_relocator.py V3）。
 *
 * Relocation = {
 *   srcParaIdx: number,
 *   srcCharOffset: number,
 *   confidence: 'HIGH'|'MEDIUM'|'LOW',
 *   score: number,
 *   debugInfo: string,
 * }
 *
 * 算法（V3 章内窗口搜索）：
 *   1. 用 alignPairs 反查 DST hostParaIndex 得到 SRC 大致段索引 hint。
 *   2. 仅在 SRC [hint-WINDOW, hint+WINDOW] 窗口内做段级 fuzz.ratio 搜索，
 *      规避全局搜索因相似句式跨段抢断的问题。
 *   3. 若窗口内最佳分 < FALLBACK_MIN，回退至全章搜索（仅当全章分更高时才替换）。
 *   4. 在锚点段中再用 beforeCtx + afterCtx 拼 needle，partialRatioAlignment 找精确字符偏移。
 *   5. 置信度按段级匹配分数：>= 70 HIGH / 50-70 MEDIUM / < 50 LOW（落段末）。
 */
import * as fuzzball from 'fuzzball';

const WINDOW = 10;            // hint 附近 +/-N 段
const FALLBACK_MIN = 40.0;    // 窗口内最佳分低于此值时回退全章

/**
 * 模拟 rapidfuzz 的 partial_ratio_alignment：
 * 在 haystack 里找最相似的 needle.length 长度子串。
 * @param {string} needle
 * @param {string} haystack
 * @returns {{ score: number, destStart: number, destEnd: number }}
 */
export function partialRatioAlignment(needle, haystack) {
  if (!needle || !haystack) {
    return { score: 0, destStart: 0, destEnd: 0 };
  }
  if (needle.length >= haystack.length) {
    return {
      score: fuzzball.ratio(needle, haystack),
      destStart: 0,
      destEnd: haystack.length,
    };
  }
  let bestScore = -1;
  let bestStart = 0;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    const window = haystack.substring(i, i + needle.length);
    const s = fuzzball.ratio(needle, window);
    if (s > bestScore) {
      bestScore = s;
      bestStart = i;
      if (s === 100) break;
    }
  }
  return {
    score: bestScore,
    destStart: bestStart,
    destEnd: bestStart + needle.length,
  };
}

/**
 * 在 paras[lo..hi)（左闭右开）范围内挑与 needleText 段级最相似的段。
 * 与 Python `_best_in_range(needle, paras, lo, hi)` 等价（hi 不含）。
 * @param {string} needleText
 * @param {string[]} paras
 * @param {number} lo
 * @param {number} hi
 * @returns {[number, number]} [bestIdx, bestScore]（bestScore >= 0）
 */
export function bestInRange(needleText, paras, lo, hi) {
  const start = Math.max(0, lo);
  const end = Math.min(paras.length, hi);
  let bestIdx = start;
  let bestScore = -1;
  for (let i = start; i < end; i++) {
    if (!paras[i]) continue;
    const s = fuzzball.ratio(needleText, paras[i]);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }
  return [bestIdx, Math.max(bestScore, 0)];
}

/**
 * 从 alignPairs 反查 DST idx 对应的 SRC idx（移植自 Python _find_src_idx_for_dst）。
 * @param {number} dstIdx
 * @param {Array<[number|null, number|null]>} alignPairs
 * @param {number} srcMax
 * @returns {number|null}
 */
function findSrcIdxForDst(dstIdx, alignPairs, srcMax) {
  for (const [s, d] of alignPairs) {
    if (d === dstIdx && s !== null) return s;
  }
  for (const [s, d] of alignPairs) {
    if (d !== null && d >= dstIdx && s !== null) return s;
  }
  return srcMax > 0 ? srcMax - 1 : null;
}

/**
 * @param {{ hostParaIndex: number, hostParaText: string, beforeCtx: string, afterCtx: string }} fn
 * @param {string[]} srcParagraphs
 * @param {Array<[number|null, number|null]>} alignPairs
 * @returns {{ srcParaIdx: number, srcCharOffset: number, confidence: string, score: number, debugInfo: string }}
 */
export function relocateFootnote(fn, srcParagraphs, alignPairs) {
  if (!srcParagraphs || srcParagraphs.length === 0) {
    return {
      srcParaIdx: 0,
      srcCharOffset: 0,
      confidence: 'LOW',
      score: 0.0,
      debugInfo: 'empty src',
    };
  }

  let hintIdx = findSrcIdxForDst(fn.hostParaIndex, alignPairs, srcParagraphs.length);
  if (hintIdx === null) hintIdx = 0;

  const hostText = fn.hostParaText ?? '';

  // Step 1：窗口内段级搜索
  const lo = Math.max(0, hintIdx - WINDOW);
  const hi = Math.min(srcParagraphs.length, hintIdx + WINDOW + 1);
  let [bestIdx, bestScore] = bestInRange(hostText, srcParagraphs, lo, hi);
  let scope = `window[${lo},${hi})`;

  // Step 2：分太低则回退全章
  if (bestScore < FALLBACK_MIN) {
    const [fIdx, fScore] = bestInRange(hostText, srcParagraphs, 0, srcParagraphs.length);
    if (fScore > bestScore) {
      bestIdx = fIdx;
      bestScore = fScore;
      scope = 'fallback-full-chapter';
    }
  }

  const srcText = srcParagraphs[bestIdx] ?? '';

  // Step 3：段内 partial 找字符偏移
  const needle = (fn.beforeCtx ?? '') + (fn.afterCtx ?? '');
  let insertOffset;
  if (needle) {
    const result = partialRatioAlignment(needle, srcText);
    insertOffset = Math.max(
      0,
      Math.min(result.destStart + (fn.beforeCtx ?? '').length, srcText.length),
    );
  } else {
    insertOffset = srcText.length;
  }

  // Step 4：置信度判定（注意：按段级 bestScore，不是 partial 分数）
  let confidence;
  if (bestScore >= 70) {
    confidence = 'HIGH';
  } else if (bestScore >= 50) {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
    insertOffset = srcText.length;
  }

  return {
    srcParaIdx: bestIdx,
    srcCharOffset: insertOffset,
    confidence,
    score: bestScore,
    debugInfo: `hint=${hintIdx} ${scope} picked=${bestIdx}`,
  };
}
