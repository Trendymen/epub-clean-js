/**
 * 打包 EPUB 容器目录为 .epub 文件。
 *
 * mimetype 必须是 zip 内第一个 entry，且必须 STORED（无压缩）。
 * 其余文件用 DEFLATED 压缩。
 */
import { createWriteStream } from 'node:fs';
import { readFile, stat, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import archiver from 'archiver';

/**
 * @param {string} srcDir
 * @param {string} outPath
 * @returns {Promise<void>}
 */
export async function packEpub(srcDir, outPath) {
  const mimetypePath = join(srcDir, 'mimetype');
  try {
    await stat(mimetypePath);
  } catch {
    throw new Error(`mimetype not found in ${srcDir}`);
  }

  const allFiles = await walk(srcDir);
  // 排序保持稳定顺序
  const otherFiles = allFiles
    .filter((p) => p !== mimetypePath)
    .sort();

  await new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);

    readFile(mimetypePath)
      .then(async (mimetypeBuf) => {
        // mimetype 必须最先 STORED 无压缩
        archive.append(mimetypeBuf, { name: 'mimetype', store: true });
        for (const f of otherFiles) {
          const rel = relative(srcDir, f).split(sep).join('/');
          const buf = await readFile(f);
          archive.append(buf, { name: rel });
        }
        await archive.finalize();
      })
      .catch(reject);
  });
}

/**
 * 递归列出目录下所有文件（绝对路径）。
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function walk(dir) {
  /** @type {string[]} */
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await walk(full);
      out.push(...sub);
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}
