/**
 * 段落 Needleman-Wunsch 全局对齐（移植自 Python aligner.py）。
 *
 * 相似度用 fuzzball.ratio（0-100），代价 = 100 - similarity。
 * Gap 代价固定 GAP_PENALTY = 60。
 *
 * 返回 [(srcIdx|null, dstIdx|null), ...]
 */
import * as fuzzball from 'fuzzball';

export const GAP_PENALTY = 60.0;

/**
 * @param {string[]} src
 * @param {string[]} dst
 * @returns {Array<[number|null, number|null]>}
 */
export function alignParagraphs(src, dst) {
  const n = src.length;
  const m = dst.length;

  // dp[i][j] = 对齐 src[:i] 与 dst[:j] 的最小代价
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  // back[i][j] = 上一个 (i,j) 位置（用一维存 i*(m+1)+j 索引便宜）
  const backI = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  const backJ = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));

  for (let i = 1; i <= n; i++) {
    dp[i][0] = dp[i - 1][0] + GAP_PENALTY;
    backI[i][0] = i - 1;
    backJ[i][0] = 0;
  }
  for (let j = 1; j <= m; j++) {
    dp[0][j] = dp[0][j - 1] + GAP_PENALTY;
    backI[0][j] = 0;
    backJ[0][j] = j - 1;
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sim = fuzzball.ratio(src[i - 1], dst[j - 1]);
      const matchCost = dp[i - 1][j - 1] + (100.0 - sim);
      const gapSrc = dp[i - 1][j] + GAP_PENALTY;
      const gapDst = dp[i][j - 1] + GAP_PENALTY;
      const best = Math.min(matchCost, gapSrc, gapDst);
      dp[i][j] = best;
      // 与 Python min 优先级一致：match → gapSrc → gapDst
      if (best === matchCost) {
        backI[i][j] = i - 1;
        backJ[i][j] = j - 1;
      } else if (best === gapSrc) {
        backI[i][j] = i - 1;
        backJ[i][j] = j;
      } else {
        backI[i][j] = i;
        backJ[i][j] = j - 1;
      }
    }
  }

  /** @type {Array<[number|null, number|null]>} */
  const pairs = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const pi = backI[i][j];
    const pj = backJ[i][j];
    if (pi === i - 1 && pj === j - 1) {
      pairs.push([i - 1, j - 1]);
    } else if (pi === i - 1) {
      pairs.push([i - 1, null]);
    } else {
      pairs.push([null, j - 1]);
    }
    i = pi;
    j = pj;
  }
  pairs.reverse();
  return pairs;
}
