// src/entries/footnote-fix.js
//
// CLI 入口：通用 footnote 升级工具。
// 用法：
//   node bin/cli.js footnote-fix --in <input.epub> --out <output.epub>
//                                 [--icon-regular note.png]
//                                 [--icon-review note1.png]
//                                 [--icon-path-prefix ../Images/]
//
// 不依赖任何 book profile —— 通用于任意符合 OEBPS/Text 结构的 epub。
// 默认会自动探测 epub 内实际存在的 note.* / note1.* 图标资源；
// 用 --icon-* 参数可显式覆盖（跳过探测）。
import { parseArgs } from "node:util";
import path from "node:path";
import { footnoteFixEpub } from "../core/stages/footnote-fix.js";

const { values: opts } = parseArgs({
  options: {
    in:                 { type: "string" },
    out:                { type: "string" },
    "icon-regular":     { type: "string" }, // 显式覆盖，如 "note.png"
    "icon-review":      { type: "string" }, // 同上
    "icon-path-prefix": { type: "string" }, // 如 "../Images/"
  },
  strict: true,
});

if (!opts.in || !opts.out) {
  console.error(
    "Usage: footnote-fix --in <input.epub> --out <output.epub> " +
      "[--icon-regular note.png] [--icon-review note1.png] [--icon-path-prefix ../Images/]",
  );
  process.exit(2);
}

const result = await footnoteFixEpub(path.resolve(opts.in), path.resolve(opts.out), {
  iconRegular: opts["icon-regular"],
  iconReview: opts["icon-review"],
  iconPathPrefix: opts["icon-path-prefix"],
});
console.log(
  `footnote-fix 完成: ${opts.out}（处理 ${result.files} 章节, ${result.changedFiles} 章改动, textDir=${result.textDir}, icons=${result.icons.regular}/${result.icons.review}）`,
);
