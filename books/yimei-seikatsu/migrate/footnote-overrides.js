/**
 * 注释定位人工修正表查询（Node 版，对齐 Python scripts/footnote_overrides.py）。
 *
 * 用途：footnote-relocator V3（窗口搜索 + 全章回退）对译文风格差异较大的注释命中率有限，
 * 人工逐条比对 DST/SRC 确认过的注释通过 profile.footnoteOverrides 直接覆盖 relocator 输出。
 *
 * profile.footnoteOverrides 的格式（按 books/yimei-seikatsu/profile.js 设计）：
 *   {
 *     '09': {
 *       'chapter0011/note001': { chapter: 11, afterParaIdx: 12, atSentenceIdx: 0 },
 *       'chapter0003/note002': { chapter: 3,  afterParaIdx: 308, anchor: '莫非定律' },
 *       ...
 *     }
 *   }
 *
 * 字段语义：
 *   - chapter / afterParaIdx：必填，sup 锚定到 srcParas[afterParaIdx]
 *   - anchor: 可选字符串，在该段中查找子串；sup 插入位置 = 子串末尾
 *   - atSentenceIdx: 可选数字（保留向后兼容字段，目前实现为字符偏移；为 0 表示段首）
 *   - 都不填则 sup 落在段末
 */

/**
 * 查表：根据章节文件名 + 新分配的 note id 找出 override。
 *
 * @param {Record<string, {chapter: number, afterParaIdx: number, anchor?: string, atSentenceIdx?: number}> | undefined} overrides
 *   profile.footnoteOverrides[volume]（单卷的 override 字典）
 * @param {string} chapterKey  形如 'chapter0011'
 * @param {string} noteId      形如 'note001'
 * @returns {{chapter: number, afterParaIdx: number, anchor?: string, atSentenceIdx?: number} | null}
 */
export function lookupOverride(overrides, chapterKey, noteId) {
  if (!overrides) return null;
  const key = `${chapterKey}/${noteId}`;
  return overrides[key] ?? null;
}

/**
 * 把 override + srcParas 解算成 (srcParaIdx, srcCharOffset)，对齐 Python lookup_override 返回值。
 * 若 override 越界或锚定文本找不到，返回段末。
 *
 * @param {{chapter: number, afterParaIdx: number, anchor?: string, atSentenceIdx?: number}} override
 * @param {string[]} srcParas
 * @returns {{srcParaIdx: number, srcCharOffset: number} | null}
 */
export function resolveOverride(override, srcParas) {
  if (!override) return null;
  const srcIdx = override.afterParaIdx;
  if (typeof srcIdx !== 'number' || srcIdx < 0 || srcIdx >= srcParas.length) {
    return null;
  }
  const text = srcParas[srcIdx];
  // anchor 优先：在段内找子串，sup 落在子串末尾
  if (typeof override.anchor === 'string' && override.anchor.length > 0) {
    const pos = text.indexOf(override.anchor);
    if (pos >= 0) {
      return { srcParaIdx: srcIdx, srcCharOffset: pos + override.anchor.length };
    }
    return { srcParaIdx: srcIdx, srcCharOffset: text.length };
  }
  // atSentenceIdx === 0 → 段首；其它数值当成字符偏移
  if (typeof override.atSentenceIdx === 'number') {
    const off = Math.max(0, Math.min(override.atSentenceIdx, text.length));
    return { srcParaIdx: srcIdx, srcCharOffset: off };
  }
  return { srcParaIdx: srcIdx, srcCharOffset: text.length };
}
