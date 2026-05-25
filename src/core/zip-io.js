import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import * as yauzl from "yauzl-promise";
import yazl from "yazl";
import { SKIP_NAMES } from "./constants.js";

function isJunk(name) {
  const base = name.split("/").pop();
  return (
    SKIP_NAMES.has(name) ||
    base === ".DS_Store" ||
    base === "Thumbs.db" ||
    base.startsWith("._")
  );
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// 读 epub：返回 { names: [...保留输入顺序], entries: { name -> Buffer } }
export async function readEpub(srcPath) {
  const zip = await yauzl.open(srcPath);
  const names = [];
  const entries = {};
  try {
    for await (const entry of zip) {
      // 目录条目跳过（filename 以 / 结尾）
      if (entry.filename.endsWith("/")) continue;
      const stream = await entry.openReadStream();
      const buf = await streamToBuffer(stream);
      names.push(entry.filename);
      entries[entry.filename] = buf;
    }
  } finally {
    await zip.close();
  }
  return { names, entries };
}

// 写 epub：mimetype 第一项 STORED，其它 DEFLATED
export function writeEpub(outPath, files) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const zip = new yazl.ZipFile();
    const ws = fs.createWriteStream(outPath);
    zip.outputStream.pipe(ws);
    ws.on("close", resolve);
    ws.on("error", reject);
    zip.outputStream.on("error", reject);

    // mimetype 第一项 + 不压缩
    zip.addBuffer(Buffer.from("application/epub+zip"), "mimetype", {
      compress: false,
    });

    for (const [name, data] of Object.entries(files)) {
      if (name === "mimetype" || isJunk(name)) continue;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      zip.addBuffer(buf, name, { compress: true });
    }
    zip.end();
  });
}
