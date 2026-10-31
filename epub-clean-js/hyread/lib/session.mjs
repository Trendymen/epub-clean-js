import { readFile, mkdir, rm, lstat } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { resolveHyreadConfig } from '../config.mjs';
import { safeRelativePath, safeJoin, writeFileAtomic } from './paths.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const array = (value) => value === undefined ? [] : Array.isArray(value) ? value : [value];
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function checkDeclarations(manifest, spine) {
  if (!Array.isArray(manifest) || !manifest.length || !Array.isArray(spine) || !spine.length) throw new Error('Missing manifest or spine');
  const ids = new Map();
  const hrefs = new Set(['standard.opf']);
  for (const item of manifest) {
    if (!isObject(item) || typeof item.id !== 'string' || !item.id || /[\s\u0000-\u001f]/.test(item.id) || ids.has(item.id)) throw new Error('Invalid or duplicate manifest ID');
    if (safeRelativePath(item.href) !== item.href || hrefs.has(item.href)) throw new Error('Invalid or duplicate manifest href');
    if (typeof item.mediaType !== 'string' || !item.mediaType || !Array.isArray(item.properties) || item.properties.some((property) => typeof property !== 'string' || !property || /\s/.test(property))) throw new Error('Invalid manifest properties or media type');
    ids.set(item.id, item);
    hrefs.add(item.href);
  }
  for (const href of hrefs) {
    const parts = href.split('/');
    for (let depth = 1; depth < parts.length; depth++) {
      if (hrefs.has(parts.slice(0, depth).join('/'))) throw new Error('Resource file and directory collision');
    }
  }
  const seen = new Set();
  for (const item of spine) {
    if (!isObject(item) || seen.has(item.id) || !ids.has(item.id) || ids.get(item.id).href !== item.href) throw new Error('Invalid or duplicate spine reference');
    seen.add(item.id);
  }
}

function parseOpf(bytes) {
  const xml = bytes.toString('utf8');
  if (XMLValidator.validate(xml) !== true) throw new Error('Invalid OPF XML');
  const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseAttributeValue: false }).parse(xml);
  const manifest = array(parsed.package?.manifest?.item).map((item) => ({
    id: item['@_id'], href: safeRelativePath(item['@_href']), mediaType: item['@_media-type'],
    properties: String(item['@_properties'] ?? '').split(/\s+/).filter(Boolean),
  }));
  const spine = array(parsed.package?.spine?.itemref).map((ref) => ({ id: ref['@_idref'], href: manifest.find((item) => item.id === ref['@_idref'])?.href }));
  checkDeclarations(manifest, spine);
  return { manifest, spine };
}

export function validateSession(session) {
  if (!isObject(session) || session.schemaVersion !== 1) throw new Error('Unsupported session schema');
  const config = resolveHyreadConfig({ volume: session.volume, assetId: session.assetId, title: session.title });
  if (config.volume !== session.volume || typeof session.assetId !== 'string' || typeof session.title !== 'string') throw new Error('Invalid session identity');
  if (!/^[a-f0-9]{64}$/.test(session.sourceOpfSha256) || typeof session.resourceRoot !== 'string' || !/^resources\/generations\/[A-Za-z0-9-]+$/.test(session.resourceRoot)) throw new Error('Invalid session hash or resource root');
  checkDeclarations(session.manifest, session.spine);
  const expected = ['standard.opf', ...session.manifest.map((item) => item.href)].sort();
  if (!isObject(session.resources) || JSON.stringify(Object.keys(session.resources).sort()) !== JSON.stringify(expected)) throw new Error('Incomplete session resources');
  for (const record of Object.values(session.resources)) {
    if (!isObject(record) || !Number.isSafeInteger(record.bytes) || record.bytes < 1 || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error('Invalid resource integrity record');
  }
  if (session.resources['standard.opf'].sha256 !== session.sourceOpfSha256) throw new Error('OPF hash mismatch');
  return session;
}

function generationConfig(config, session) {
  const resourcesDir = join(config.workDir, session.resourceRoot);
  return { ...config, resourcesDir, itemDir: join(resourcesDir, 'ebookservice', 'epub', config.assetId, 'item') };
}

async function readOptionalJson(workDir, href) {
  const path = await safeJoin(workDir, href);
  try { await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  return JSON.parse(await readFile(path, 'utf8'));
}

function assertSameBook(identity, config) {
  if (!isObject(identity) || identity.assetId !== config.assetId || identity.volume !== config.volume || identity.title !== config.bookTitle) {
    throw new Error('Work directory belongs to another book');
  }
}

async function checkBookMetadata(config) {
  const binding = await readOptionalJson(config.workDir, 'book-identity.json');
  if (binding !== undefined) assertSameBook(binding, config);
  const previous = await readOptionalJson(config.workDir, 'session.json');
  if (previous !== undefined) assertSameBook(validateSession(previous), config);
}

async function bindBook(config) {
  const path = await safeJoin(config.workDir, 'book-identity.json');
  const bytes = JSON.stringify({ volume: config.volume, assetId: config.assetId, title: config.bookTitle }) + '\n';
  try { await writeFileAtomic(path, bytes); }
  catch (error) {
    const binding = await readOptionalJson(config.workDir, 'book-identity.json');
    if (binding !== undefined) assertSameBook(binding, config);
    throw error;
  }
}

async function fetchResource(url, { fetchImpl, timeoutMs }, itemBase) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error(`Resource request timed out: ${url}`)); }, timeoutMs);
  });
  try {
    return await Promise.race([(async () => {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (response.status !== 200) throw new Error(`Resource HTTP ${response.status}: ${url}`);
      const finalUrl = new URL(response.url);
      const base = new URL(itemBase);
      if (finalUrl.origin !== base.origin || !finalUrl.pathname.startsWith(base.pathname) || finalUrl.search || finalUrl.hash) throw new Error('Resource redirect leaves book URL');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error(`Empty resource: ${url}`);
      return bytes;
    })(), timeout]);
  } finally { clearTimeout(timer); }
}

export async function loadSession(sessionPath, { outputPath } = {}) {
  const workDir = dirname(sessionPath);
  const safeSessionPath = await safeJoin(workDir, basename(sessionPath));
  const session = validateSession(JSON.parse(await readFile(safeSessionPath, 'utf8')));
  const config = generationConfig({ ...resolveHyreadConfig({ volume: session.volume, assetId: session.assetId, title: session.title, workDir, outputPath }), sessionPath: safeSessionPath }, session);
  await safeJoin(workDir, session.resourceRoot);
  const itemPrefix = `${session.resourceRoot}/ebookservice/epub/${session.assetId}/item/`;
  let opf;
  for (const [href, record] of Object.entries(session.resources)) {
    const bytes = await readFile(await safeJoin(workDir, `${itemPrefix}${href}`));
    if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) throw new Error(`Resource integrity mismatch: ${href}`);
    if (href === 'standard.opf') opf = bytes;
  }
  const parsed = parseOpf(opf);
  if (JSON.stringify(parsed.manifest) !== JSON.stringify(session.manifest) || JSON.stringify(parsed.spine) !== JSON.stringify(session.spine)) throw new Error('Session declarations differ from OPF');
  return { config, session };
}

export async function prepareSession(config, { fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid fetch or timeout');
  config = resolveHyreadConfig({ volume: config.volume, assetId: config.assetId, title: config.bookTitle, workDir: config.workDir, projectRoot: config.projectRoot, outputPath: config.outputPath });
  await checkBookMetadata(config);
  const resourceRoot = `resources/generations/${randomUUID()}`;
  const generation = await safeJoin(config.workDir, resourceRoot);
  const itemPrefix = `${resourceRoot}/ebookservice/epub/${config.assetId}/item/`;
  const resources = {};
  try {
    await mkdir(generation, { recursive: true });
    const opf = await fetchResource(`${config.itemBase}standard.opf`, { fetchImpl, timeoutMs }, config.itemBase);
    const { manifest, spine } = parseOpf(opf);
    const save = async (href, bytes) => {
      await writeFileAtomic(await safeJoin(config.workDir, `${itemPrefix}${href}`), bytes);
      resources[href] = { bytes: bytes.length, sha256: sha256(bytes) };
    };
    await save('standard.opf', opf);
    let cursor = 0;
    let failure;
    await Promise.all(Array.from({ length: Math.min(4, manifest.length) }, async () => {
      while (!failure && cursor < manifest.length) {
        const item = manifest[cursor++];
        try {
          const url = new URL(item.href.split('/').map(encodeURIComponent).join('/'), config.itemBase).href;
          await save(item.href, await fetchResource(url, { fetchImpl, timeoutMs }, config.itemBase));
        } catch (error) { failure ??= error; }
      }
    }));
    if (failure) throw failure;
    const session = validateSession({ schemaVersion: 1, volume: config.volume, assetId: config.assetId, title: config.bookTitle, sourceOpfSha256: sha256(opf), resourceRoot, resources, manifest, spine });
    await bindBook(config);
    await checkBookMetadata(config);
    await writeFileAtomic(await safeJoin(config.workDir, 'session.json'), JSON.stringify(session, null, 2) + '\n', { replace: true });
    return { config: generationConfig(config, session), session };
  } catch (error) {
    await rm(generation, { recursive: true, force: true });
    throw error;
  }
}
