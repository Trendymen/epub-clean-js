import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FONT_ROOT = fileURLToPath(new URL('../../books/', import.meta.url));

// Adobe 官方 tag 的固定内容；许可证与对应字体一起保存。
export const FONT_RESOURCES = [
  {
    name: 'SourceHanSansSC-Regular.otf', file: 'source-han-sans-sc/SourceHanSansSC-Regular.otf',
    url: 'https://raw.githubusercontent.com/adobe-fonts/source-han-sans/2.004R/OTF/SimplifiedChinese/SourceHanSansSC-Regular.otf',
    bytes: 16437608, sha256: '84bbd4ace91d327b3ad1a581c688196278a4e41308520176f419180064e4af2b',
  },
  {
    name: 'source-han-sans-LICENSE.txt', file: 'source-han-sans-sc/LICENSE.txt',
    url: 'https://raw.githubusercontent.com/adobe-fonts/source-han-sans/2.004R/LICENSE.txt',
    bytes: 4463, sha256: 'f55c2d43dd905011515f5e46ba78d180027e314ef8ccaaf53a9e88fe316767cd',
  },
  {
    name: 'SourceHanSerifSC-Light.otf', file: 'source-han-serif-sc/SourceHanSerifSC-Light.otf',
    url: 'https://raw.githubusercontent.com/adobe-fonts/source-han-serif/2.003R/OTF/SimplifiedChinese/SourceHanSerifSC-Light.otf',
    bytes: 24501300, sha256: 'b1bdb1a3581ae143ba3c7a27fc351ec66d2161b057262936e2c65348b0b058fa',
  },
  {
    name: 'SourceHanSerifSC-Medium.otf', file: 'source-han-serif-sc/SourceHanSerifSC-Medium.otf',
    url: 'https://raw.githubusercontent.com/adobe-fonts/source-han-serif/2.003R/OTF/SimplifiedChinese/SourceHanSerifSC-Medium.otf',
    bytes: 24805580, sha256: '1d4dc4b757c07034e2412d6edf48f54f94ec7172d4deb3b90a3e4fc9dcb94f5d',
  },
  {
    name: 'SourceHanSerifSC-SemiBold.otf', file: 'source-han-serif-sc/SourceHanSerifSC-SemiBold.otf',
    url: 'https://raw.githubusercontent.com/adobe-fonts/source-han-serif/2.003R/OTF/SimplifiedChinese/SourceHanSerifSC-SemiBold.otf',
    bytes: 24700532, sha256: 'faf16caeaf207e1926e01af8d9f1a8e71b0e9d8f51bf3b5d9a78f9f30e7e3e31',
  },
  {
    name: 'SourceHanSerifSC-Bold.otf', file: 'source-han-serif-sc/SourceHanSerifSC-Bold.otf',
    url: 'https://raw.githubusercontent.com/adobe-fonts/source-han-serif/2.003R/OTF/SimplifiedChinese/SourceHanSerifSC-Bold.otf',
    bytes: 25521732, sha256: '706b8c0de2deff6cbc0c87e2cdedfd33a78b7ffd76cebb4549012f197ba611fe',
  },
  {
    name: 'source-han-serif-LICENSE.txt', file: 'source-han-serif-sc/LICENSE.txt',
    url: 'https://raw.githubusercontent.com/adobe-fonts/source-han-serif/2.003R/LICENSE.txt',
    bytes: 4463, sha256: '9ff5bb567e1b92c801fc1069e5fbf992ff8efccacb9db94e5959a5b3ba9bb903',
  },
];

function matches(data, resource) {
  return data.length === resource.bytes
    && createHash('sha256').update(data).digest('hex') === resource.sha256;
}

async function verifiedFile(file, resource) {
  try {
    const data = await readFile(file);
    return matches(data, resource) ? data : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function download(resource, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Font download timed out: ${resource.url}`)), timeoutMs);
  try {
    const response = await fetchImpl(resource.url, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`Font download failed (${response.status}): ${resource.url}`);
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > resource.bytes) throw new Error(`Unexpected font resource size: ${resource.url}`);
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    if (!matches(data, resource)) throw new Error(`SHA-256/size mismatch: ${resource.url}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function prepareFonts({ cacheDir = null, destRoot = FONT_ROOT,
  resources = FONT_RESOURCES, fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {}) {
  const results = [];
  for (const resource of new Map(resources.map(item => [item.file, item])).values()) {
    const destination = path.join(destRoot, resource.file);
    if (await verifiedFile(destination, resource)) {
      results.push({ file: destination, source: 'existing' });
      continue;
    }
    const cached = cacheDir ? await verifiedFile(path.join(cacheDir, resource.name), resource) : null;
    const data = cached || await download(resource, fetchImpl, timeoutMs);
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, data, { flag: 'wx' });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
    results.push({ file: destination, source: cached ? 'cache' : 'download' });
  }
  return results;
}
