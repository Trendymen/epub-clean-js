import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { safeJoin, writeFileAtomic } from './paths.mjs';
import { loadSession } from './session.mjs';
import { validateCapture, validateAuditEnvelope } from './artifacts.mjs';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

async function transferState(config, info) {
  const { session } = await loadSession(config.sessionPath);
  if (config.assetId !== session.assetId || config.volume !== session.volume || config.bookTitle !== session.title) throw new Error('Config belongs to another book');
  if (!object(info) || info.schemaVersion !== 1 || !['capture', 'audit'].includes(info.kind) || info.assetId !== session.assetId || info.sourceOpfSha256 !== session.sourceOpfSha256 || !/^[a-f0-9]{64}$/.test(info.sha256) || !positiveInteger(info.byteLength) || !positiveInteger(info.chunkBytes) || !positiveInteger(info.chunkCount) || Math.ceil(info.byteLength / info.chunkBytes) !== info.chunkCount) throw new Error('Invalid transfer info or book identity');
  const directory = `transfers/${info.kind}/${info.sha256}`;
  const identity = { schemaVersion: 1, kind: info.kind, assetId: info.assetId, sourceOpfSha256: info.sourceOpfSha256, byteLength: info.byteLength, sha256: info.sha256, chunkBytes: info.chunkBytes, chunkCount: info.chunkCount };
  await writeFileAtomic(await safeJoin(config.workDir, `${directory}/info.json`), JSON.stringify(identity));
  return { session, directory };
}

function validateChunk(info, chunk) {
  if (!object(chunk) || chunk.sha256 !== info.sha256 || !Number.isSafeInteger(chunk.index) || chunk.index < 0 || chunk.index >= info.chunkCount || chunk.offset !== chunk.index * info.chunkBytes || chunk.bytes !== Math.min(info.chunkBytes, info.byteLength - chunk.offset) || typeof chunk.dataBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(chunk.dataBase64)) throw new Error('Invalid chunk metadata or base64');
  const bytes = Buffer.from(chunk.dataBase64, 'base64');
  if (bytes.length !== chunk.bytes || bytes.toString('base64') !== chunk.dataBase64) throw new Error('Chunk bytes or noncanonical base64 mismatch');
  return bytes;
}

export async function receiveChunk(config, info, chunk) {
  const bytes = validateChunk(info, chunk);
  const { directory } = await transferState(config, info);
  const path = await safeJoin(config.workDir, `${directory}/${chunk.index}.part`);
  await writeFileAtomic(path, bytes);
  return { path, index: chunk.index, bytes: bytes.length };
}

export async function finalizeTransfer(config, info, { replace = false } = {}) {
  const { session, directory } = await transferState(config, info);
  const blocks = [];
  for (let index = 0; index < info.chunkCount; index++) {
    const part = await readFile(await safeJoin(config.workDir, `${directory}/${index}.part`));
    if (part.length !== Math.min(info.chunkBytes, info.byteLength - index * info.chunkBytes)) throw new Error(`Chunk length mismatch: ${index}`);
    blocks.push(part);
  }
  const bytes = Buffer.concat(blocks);
  if (bytes.length !== info.byteLength || sha256(bytes) !== info.sha256) throw new Error('Transfer byte length or SHA-256 mismatch');
  const artifact = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (info.kind === 'capture') validateCapture(artifact, session);
  else validateAuditEnvelope(artifact, session);
  const path = await safeJoin(config.workDir, info.kind === 'capture' ? 'grab_xml.json' : 'audit.json');
  let reused = false;
  try { reused = (await readFile(path)).equals(bytes); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!reused) await writeFileAtomic(path, bytes, { replace });
  return { path, bytes: bytes.length, sha256: info.sha256, reused };
}
