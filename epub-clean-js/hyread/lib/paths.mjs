import { mkdir, realpath, lstat, readFile, writeFile, rename, link, unlink } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export function safeRelativePath(href) {
  if (typeof href !== 'string' || !href || /[\\\u0000-\u001f\u007f?#:]/.test(href)) throw new Error('Unsafe resource path');
  let decoded = href;
  for (let round = 0; decoded.includes('%'); round++) {
    if (round > 8 || /%(?:2f|5c)/i.test(decoded)) throw new Error('Encoded path separator');
    const next = decodeURIComponent(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  if (/^[\/]/.test(decoded) || /[\\\u0000-\u001f\u007f?#:%]/.test(decoded)) throw new Error('Unsafe resource path');
  const parts = decoded.split('/');
  if (parts.some((part) => part !== '.' && (part === '..' || part === '' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))) throw new Error('Unsafe resource path component');
  const normalized = parts.filter((part) => part !== '.').join('/');
  if (!normalized) throw new Error('Empty resource path');
  return normalized;
}

function within(root, target) {
  const remainder = relative(root, target);
  return remainder === '' || (!isAbsolute(remainder) && remainder !== '..' && !remainder.startsWith(`..${sep}`));
}

async function realAncestor(target) {
  try { return await realpath(target); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // 并发下载可能刚创建父目录；只有悬空链接应当拒绝。
    try {
      if ((await lstat(target)).isSymbolicLink()) throw new Error('Dangling resource path');
      return await realpath(target);
    }
    catch (statError) { if (statError.code !== 'ENOENT') throw statError; }
    const parent = dirname(target);
    if (parent === target) throw error;
    return resolve(await realAncestor(parent), relative(parent, target));
  }
}

export async function safeJoin(root, href) {
  const target = resolve(root, safeRelativePath(href));
  const rootPath = await realAncestor(resolve(root));
  const targetPath = await realAncestor(target);
  if (!within(rootPath, targetPath)) throw new Error('Resource path escapes root');
  return target;
}

export async function writeFileAtomic(destination, bytes, { replace = false } = {}) {
  const data = Buffer.from(bytes);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: 'wx' });
    if (replace) await rename(temporary, destination);
    else {
      try { await link(temporary, destination); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!(await readFile(destination)).equals(data)) throw new Error(`Existing file differs: ${destination}`);
      }
    }
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}
