// epub-clean-js/books/yimei-seikatsu/profile.js
//
// 义妹生活书系 profile。承载书系特定决策（路径/卷号、卷首格言、插图清单、特典清单、注释偏好）。
// core/ 通用代码 + entries/migrate-translation.js 通过 --book yimei-seikatsu 加载本文件。
// 同时被 entries/heal.js、entries/align.js 复用（paths / vols / filePatterns / metadataDefaults）。
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

export default {
  id: "yimei-seikatsu",
  name: "义妹生活",
  author: "三河ごーすと",

  // --- 现有 heal/align 入口依赖字段 ---
  paths: {
    rawDir:        PROJECT_ROOT,
    healedDir:     path.join(PROJECT_ROOT, "output", "healed"),
    cleanDir:      path.join(PROJECT_ROOT, "output", "clean"),       // 保留兼容 align entry
    translatedDir: path.join(PROJECT_ROOT, "output", "translated"),  // 09 卷 migrate-translation 默认输出
  },
  vols: [11, 12, 13, 14, 15],
  // 文件名规则：
  // - 源 epub（项目根，raw）：[三河ごーすと].义妹生活.NN.[日翻].epub
  // - 产物（output/ 子目录）：在 raw 基础上追加 .healed / .clean / .translated 内部状态尾缀。
  //   尾缀与所在子目录形成「双保险」——即使文件被拷出 output/，仅看文件名也能区分阶段，
  //   避免与源 epub 混淆。
  // - 注意：epub 内部 <dc:title> 卷标题里**不**带这些内部状态尾缀（healed/clean/translated
  //   仅是产物文件物理层面的标识），只带 [台简] / [日翻] 语言版本标识
  //   （见 migrate-epub.js 与 heal pipeline 内的 title 处理）。
  filePatterns: {
    raw:        (n) => `[三河ごーすと].义妹生活.${String(n).padStart(2, "0")}.[日翻].epub`,
    healed:     (n) => `[三河ごーすと].义妹生活.${String(n).padStart(2, "0")}.[日翻].healed.epub`,
    clean:      (n) => `[三河ごーすと].义妹生活.${String(n).padStart(2, "0")}.[日翻].clean.epub`,
    translated: (n) => `[三河ごーすと].义妹生活.${String(n).padStart(2, "0")}.[台简].translated.epub`,
  },
  metadataDefaults: {
    rights: "voidlord",
  },

  // --- 迁移管线（migrate-translation）专用字段 ---

  // 卷首格言：DST 日翻 pre.xhtml 的台译版本
  // 当 SRC chapter1 第一段 hash 等于此句时，从 chapter0001 跳过该段（修引言重复 bug）
  epigraphs: {
    "09": "冷静的人生规划不保证会有幸福的人生。幸福藏在刹那间的狂热之中。",
  },

  // 插图清单（手动决定保留哪些 + 插在哪里）
  // 来自 align_report.md 的 10 张 HIGH 置信度内联插图
  inlineImages: {
    "09": [
      { src: "p039.webp", chapter: 1,  afterParaIdx: 328 },
      { src: "p062.webp", chapter: 2,  afterParaIdx: 69  },
      { src: "p137.webp", chapter: 4,  afterParaIdx: 246 },
      { src: "p177.webp", chapter: 6,  afterParaIdx: 73  },
      { src: "p196.webp", chapter: 7,  afterParaIdx: 168 },
      { src: "p209.webp", chapter: 7,  afterParaIdx: 320 },
      { src: "p242.webp", chapter: 8,  afterParaIdx: 305 },
      { src: "p267.webp", chapter: 10, afterParaIdx: 180 },
      { src: "p304.webp", chapter: 12, afterParaIdx: 8   },
      { src: "p318.webp", chapter: 12, afterParaIdx: 183 },
    ],
  },

  // 特典清单（保留 DST 日翻原文，不做段落对齐）
  specials: {
    "09": [
      { id: "special0001", title: "电子书特典　『棉花糖般甜蜜』",            source: "DST", hasFootnotes: true  },
      { id: "special0002", title: "蜜瓜特典　『倘若有未来博物馆』",          source: "DST", hasFootnotes: false },
      { id: "special0003", title: "Animate特典4P小册子　『适合婚礼的月份』", source: "DST", hasFootnotes: false },
    ],
  },

  // 注释定位人工修正表（覆盖 footnote-relocator 自动定位）
  // 对译文风格差异较大的注释，relocator V3 命中率有限，按人工逐条比对 SRC/DST 填本表。
  // Key:  'chapterNNNN/noteNNN'（与 chapter_renderer 里 new_id_num 对应的 STERA noteNNN 一致）
  // Value: { chapter, afterParaIdx, anchor? }
  //   - afterParaIdx：在 Node paragraph-extractor 输出列表中的索引
  //     （chapter1 已切掉首段引言，与 migrate_chapters 行为一致）
  //   - anchor：在该段中查找的子串；sup 插入位置 = 子串末尾。缺省 → 插段末。
  //
  // 数据于 2026-05-25 重新校准：byte-level 一致化时通过 /tmp/audit-overrides.mjs 自动
  // 比对 Python golden 宿主段 + Node paragraph-extractor 抽段，得到精准 idx + anchor。
  // 每条 anchor = 宿主段尾 8-15 字（Python 视角的真正落点段），sup 插入位置 = anchor 末尾，
  // 与 Python <p>...<sub> 在该段尾出现的位置完全对齐。
  footnoteOverrides: {
    "09": {
      "chapter0001/note001": { chapter: 1,  afterParaIdx: 439, anchor: "解例题。" },              // 评：学习方法 → 「我翻开当时的笔记，阅读教科书并且解例题。」段末
      "chapter0003/note001": { chapter: 3,  afterParaIdx: 207, anchor: "五月晴" },                // 注：五月晴れ → 「宛如梅雨期间偶尔会出现的五月晴」anchor 后（句内）
      "chapter0003/note002": { chapter: 3,  afterParaIdx: 308, anchor: "莫非定律" },              // 评：墨菲定律 → 「这个世界充满了莫非定律」anchor 后（句内）
      "chapter0003/note003": { chapter: 3,  afterParaIdx: 337, anchor: "拔自己的羽毛织布" },      // 注：仙鹤的报恩 → 「拔自己的羽毛织布」anchor 后（句内）
      "chapter0004/note001": { chapter: 4,  afterParaIdx: 209, anchor: "亲密地挤成一团" },        // 注：押し競饅頭 → 「亲密地挤成一团」anchor 后（句内）
      "chapter0007/note001": { chapter: 7,  afterParaIdx: 365, anchor: "机械性地取平均" },        // 评：平均值取样 → 「机械性地取平均」anchor 后（句内）
      "chapter0010/note001": { chapter: 10, afterParaIdx: 55,  anchor: "夜来祭" },                // 评：佞武多祭等 → 「哇，弘前睡魔祭...夜来祭」anchor 末
      "chapter0011/note001": { chapter: 11, afterParaIdx: 183, anchor: "三坏球一好球" },          // 注：棒球满球数 → 「三坏球一好球」anchor 后（句内）
      "chapter0012/note001": { chapter: 12, afterParaIdx: 94,  anchor: "无线电视的类比讯号关闭" },// 注：模拟电视关停 → 「无线电视的类比讯号关闭」anchor 后（句内）
      "chapter0012/note002": { chapter: 12, afterParaIdx: 118, anchor: "会加上「天生的」这个前缀" },// 注：枕词 → 「会加上「天生的」这个前缀」anchor 后（句内）
    },
  },

  // 排版参考来源（卷 → REF 卷）
  refLayout: "07",
};
