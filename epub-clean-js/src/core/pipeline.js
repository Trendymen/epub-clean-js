// src/core/pipeline.js
//
// runPipeline(buf, stages, ctx) — async-aware reduce 执行器。
// stage 签名: (EpubBuffer, ctx) => EpubBuffer | Promise<EpubBuffer>

export async function runPipeline(buf, stages, ctx) {
  let cur = buf;
  for (const stage of stages) {
    cur = await stage(cur, ctx);
  }
  return cur;
}
