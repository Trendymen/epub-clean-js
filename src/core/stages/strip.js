// src/core/stages/strip.js
//
// strip stage：从 EpubBuffer 中删除 DRM/平台标识资源。
// 与 zip-io.writeEpub 的 SKIP_NAMES 行为一致，但显式做在 stage 层，
// 让「strip 已执行」这一事实在 pipeline 中显性化。
import { SKIP_NAMES } from "../constants.js";

export function strip(buf, _ctx) {
  const newNames = [];
  const newEntries = {};
  for (const name of buf.names) {
    if (SKIP_NAMES.has(name)) continue;
    newNames.push(name);
    newEntries[name] = buf.entries[name];
  }
  return { names: newNames, entries: newEntries };
}
