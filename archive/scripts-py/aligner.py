from rapidfuzz import fuzz

GAP_PENALTY = 60.0  # 0-100 量级；越大越倾向不留 gap


def align_paragraphs(src: list[str], dst: list[str]) -> list[tuple[int | None, int | None]]:
    """Needleman-Wunsch 全局对齐。返回 [(src_idx | None, dst_idx | None), ...]。

    相似度用 rapidfuzz.fuzz.ratio（0-100），代价 = 100 - similarity。
    Gap 代价固定为 GAP_PENALTY。
    """
    n, m = len(src), len(dst)
    # dp[i][j] = 对齐 src[:i] 与 dst[:j] 的最小代价
    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    back = [[(0, 0)] * (m + 1) for _ in range(n + 1)]

    for i in range(1, n + 1):
        dp[i][0] = dp[i - 1][0] + GAP_PENALTY
        back[i][0] = (i - 1, 0)
    for j in range(1, m + 1):
        dp[0][j] = dp[0][j - 1] + GAP_PENALTY
        back[0][j] = (0, j - 1)

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            match_cost = dp[i - 1][j - 1] + (100.0 - fuzz.ratio(src[i - 1], dst[j - 1]))
            gap_src = dp[i - 1][j] + GAP_PENALTY
            gap_dst = dp[i][j - 1] + GAP_PENALTY
            best = min(match_cost, gap_src, gap_dst)
            dp[i][j] = best
            if best == match_cost:
                back[i][j] = (i - 1, j - 1)
            elif best == gap_src:
                back[i][j] = (i - 1, j)
            else:
                back[i][j] = (i, j - 1)

    # 回溯
    pairs: list[tuple[int | None, int | None]] = []
    i, j = n, m
    while i > 0 or j > 0:
        pi, pj = back[i][j]
        if pi == i - 1 and pj == j - 1:
            pairs.append((i - 1, j - 1))
        elif pi == i - 1:
            pairs.append((i - 1, None))
        else:
            pairs.append((None, j - 1))
        i, j = pi, pj
    pairs.reverse()
    return pairs
