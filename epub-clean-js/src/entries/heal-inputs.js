import fs from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';
import picomatch from 'picomatch';

const rawName = /^\[三河ごーすと\]\.义妹生活\.([0-9]+)\.\[日翻\]\.epub$/;

function volumeOf(src) {
  const match = rawName.exec(path.basename(src).normalize('NFC'));
  const vol = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(vol) && vol >= 11 ? vol : null;
}

async function statIfPresent(src) {
  try {
    return await fs.stat(src, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

function pathKey(src) {
  return process.platform === 'win32' ? src.toLowerCase() : src;
}

async function equivalentDirectories(cwd, base) {
  const resolved = path.resolve(cwd, base);
  const existing = await statIfPresent(resolved);
  if (existing) return existing.isDirectory() ? [resolved] : [];

  const nativeBase = path.normalize(base);
  const absolute = path.isAbsolute(nativeBase);
  const { root } = path.parse(nativeBase);
  let directories = [absolute ? root : cwd];
  const components = absolute ? nativeBase.slice(root.length) : nativeBase;
  for (const part of components.split(path.sep).filter(Boolean)) {
    const next = [];
    for (const dir of directories) {
      const literal = path.resolve(dir, part);
      const stat = await statIfPresent(literal);
      if (stat) {
        if (stat.isDirectory()) next.push(literal);
        continue;
      }
      if (part.normalize('NFC') === part.normalize('NFD')) continue;
      const names = (await fs.readdir(dir)).filter((name) => name.normalize('NFC') === part.normalize('NFC'));
      for (const name of names) {
        const candidate = path.join(dir, name);
        if ((await statIfPresent(candidate))?.isDirectory()) next.push(candidate);
      }
    }
    directories = next;
    if (!directories.length) break;
  }
  return directories;
}

async function globInputs(input, cwd) {
  const pattern = process.platform === 'win32' ? input.replaceAll('\\', '/') : input;
  const options = { cwd, absolute: true, onlyFiles: true, expandDirectories: false };
  const normalized = path.normalize(pattern).split(path.sep).join('/');
  const scanned = picomatch.scan(normalized, { tokens: true, parts: true, scanToEnd: true });
  if (!scanned.isGlob || scanned.negated) return [];
  const base = picomatch.scan(normalized, { unescape: true }).base;
  const directories = await equivalentDirectories(cwd, base);
  const match = picomatch(scanned.glob.normalize('NFC'), { posix: true, windows: false });
  const crossDirectoryExtglob = scanned.tokens.some((token) => token.isExtglob && token.value.includes('/'));
  const deep = scanned.isGlobstar || crossDirectoryExtglob
    ? Infinity : scanned.glob.split('/').length;
  const matches = [];
  for (const dir of directories) {
    const candidates = await glob('**/*', { ...options, cwd: dir, deep, dot: true });
    for (const candidate of candidates) {
      const relative = path.relative(dir, candidate);
      if (match(relative.split(path.sep).join('/').normalize('NFC'))) matches.push(candidate);
    }
  }
  return matches;
}

export async function selectHealInputs(profile, args) {
  const { rawDir, healedDir } = profile.paths;
  const sources = new Map();
  const groups = args.length ? args : [null];

  for (const input of groups) {
    let matches;
    if (input === null) {
      matches = (await fs.readdir(rawDir)).map((name) => path.join(rawDir, name));
    } else {
      const literal = path.resolve(rawDir, input);
      const stat = await statIfPresent(literal);
      matches = stat ? (stat.isFile() ? [literal] : []) : await globInputs(input, rawDir);
    }

    let eligible = 0;
    for (const candidate of matches) {
      const src = path.resolve(candidate);
      const vol = volumeOf(src);
      if (vol === null) continue;
      const stat = await statIfPresent(src);
      if (!stat?.isFile()) continue;
      eligible++;
      const identity = stat.ino !== 0n ? `${stat.dev}:${stat.ino}` : await fs.realpath(src);
      sources.set(`${vol}:${identity}`, { src, vol, dst: path.join(healedDir, profile.filePatterns.healed(vol)) });
    }
    if (!eligible) {
      throw new Error(input === null
        ? `未找到卷号 >=11 的日翻源 EPUB：${rawDir}`
        : `未匹配到卷号 >=11 的日翻源 EPUB：${input}（相对路径基准：${rawDir}）`);
    }
  }

  const selected = [...sources.values()].sort((a, b) => a.vol - b.vol || a.src.localeCompare(b.src));
  const outputs = new Map();
  for (const item of selected) {
    const key = pathKey(path.resolve(item.dst));
    const previous = outputs.get(key);
    if (previous) throw new Error(`输出冲突：${previous.src} 与 ${item.src} 均写入 ${item.dst}`);
    outputs.set(key, item);
  }
  return selected;
}
