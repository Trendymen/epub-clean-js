import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { writeFileAtomic, safeRelativePath } from './paths.mjs';

export function sanitizeEvidence(value) {
  if (typeof value === 'string') return value.replace(/https?:\/\/[^\s<>"\]\)]+/giu, (source) => {
    try {
      const url = new URL(source);
      if (/\.jsp$/iu.test(url.pathname)) return '[已移除阅读器地址]';
      url.username = ''; url.password = ''; url.search = ''; url.hash = '';
      return url.href;
    } catch { return '[无效地址]'; }
  });
  if (Array.isArray(value)) return value.map(sanitizeEvidence);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeEvidence(item)]));
  return value;
}

async function protectExisting(path, bytes) {
  try { if (!(await readFile(path)).equals(Buffer.from(bytes))) throw new Error(`Existing file differs: ${path}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export async function writeVerificationReports(report, jsonPath) {
  if (typeof jsonPath !== 'string' || !jsonPath.endsWith('.json')) throw new Error('Report path must end with .json');
  const clean = sanitizeEvidence(report), markdownPath = jsonPath.slice(0, -5) + '.md';
  const json = JSON.stringify(clean, null, 2) + '\n';
  const lines = ['# HyRead 验证报告', '', `结果：${clean.ok ? 'passed' : 'failed'}`, `EPUB：${clean.artifact.path}`, `SHA-256：${clean.artifact.sha256 ?? '未取得'}`, `rawTextEqual: ${clean.rawTextEqual}`, '', '## 检查状态', ''];
  for (const [name, check] of Object.entries(clean.checks)) {
    lines.push(`- ${name}: ${check.status}`);
    for (const issue of check.issues) lines.push(`  - ${issue}`);
  }
  lines.push('', 'semantic 始终为 not-run；此报告没有判断文学语义是否完整。', '', '## 允许修正', '', '```json', JSON.stringify(clean.allowedCorrections, null, 2), '```', '', '## 逐文件证据', '');
  for (const doc of clean.perDocument) {
    lines.push(`- ${doc.href}（spineIndex=${doc.spineIndex}）：capture=${doc.captureStatus}，live=${doc.liveStatus}，rawTextEqual=${doc.rawTextEqual}`, `  - 来源：${doc.src}`);
    for (const item of doc.issues) lines.push(`  - ${item.check}: ${item.issue}`);
  }
  lines.push('', '## 统计与诊断', '', '```json', JSON.stringify({ stats: clean.stats, restoration: clean.restoration ?? null, ignoredNonElementReferences: clean.ignoredNonElementReferences }, null, 2), '```', '');
  const markdown = lines.join('\n');
  await protectExisting(jsonPath, json); await protectExisting(markdownPath, markdown);
  await writeFileAtomic(jsonPath, json); await writeFileAtomic(markdownPath, markdown);
  return { jsonPath, markdownPath };
}

export async function exportSemanticMaterial(audit, outDir) {
  if (!audit?.meta || !Array.isArray(audit.records) || !audit.records.length) throw new Error('Invalid semantic export records');
  const records = [...audit.records].sort((a, b) => a.spineIndex - b.spineIndex);
  const files = [], documents = [], pending = [];
  for (const [index, record] of records.entries()) {
    if (record.spineIndex !== index || !Array.isArray(record.paragraphs) || !Array.isArray(record.images) || !Array.isArray(record.ruby)) throw new Error('Invalid semantic export records');
    const base = `https://service.ebook.hyread.com.tw/ebookservice/epub/${audit.meta.assetId}/item/`;
    function validateSource(value, kind) {
      const url = new URL(value);
      if (!value.startsWith(base) || url.search || url.hash || url.username || url.password) throw new Error(`Invalid semantic ${kind} URL`);
      safeRelativePath(value.slice(base.length));
    }
    validateSource(record.src, 'source');
    for (const image of record.images) validateSource(image.src, 'image');
    const filename = `${String(index + 1).padStart(4, '0')}.txt`, path = join(resolve(outDir), filename);
    const headings = record.paragraphs.filter((p) => /^h[1-6]$/u.test(p.tag)).map((p) => p.text);
    const title = audit.tocEntries?.find((entry) => entry.src === record.src)?.label ?? headings[0] ?? '';
    const lines = [`章节 ${index + 1}`, `标题：${title}`, `来源：${record.src}`, `spineIndex=${record.spineIndex} spineId=${record.spineId}`, '章首', '', '原始正文（仅浏览器空白规范化）：', record.bodyText, '', '编号块（含图像位置）：'];
    for (const p of record.paragraphs) {
      lines.push(`[${String(p.index + 1).padStart(4, '0')}] tag=${p.tag} id=${p.id} blockIndex=${p.index}${p.text ? '' : ' 空白块'}`, p.semantic, '');
    }
    lines.push('图像观察（按图像出现顺序，paragraphIndex=-1 表示块外图像，与相邻文字块的位置未知）：');
    for (const [imageIndex, image] of record.images.entries()) lines.push(`[image:${image.src}] imageIndex=${imageIndex} paragraphIndex=${image.paragraphIndex} tag=${image.tag} alt=${image.alt}`);
    lines.push('', 'ruby（按正文顺序）：', ...record.ruby.map((ruby, i) => `[${i + 1}] ${ruby}`), '', '章尾', '');
    const bytes = lines.join('\n');
    pending.push({ path, bytes }); files.push(path);
    documents.push({ file: filename, src: record.src, spineIndex: record.spineIndex, title, headings, textCharacters: record.bodyText.length, blocks: record.paragraphs.length, images: record.images.length, firstBlock: record.paragraphs[0]?.semantic ?? '', lastBlock: record.paragraphs.at(-1)?.semantic ?? '' });
  }
  const indexPath = join(resolve(outDir), 'index.json');
  const index = { schemaVersion: 1, semanticStatus: 'not-run', assetId: audit.meta.assetId, sourceOpfSha256: audit.meta.sourceOpfSha256, source: 'raw browser audit; approved output corrections are not applied', documents };
  pending.push({ path: indexPath, bytes: JSON.stringify(index, null, 2) + '\n' });
  for (const item of pending) await protectExisting(item.path, item.bytes);
  for (const item of pending) await writeFileAtomic(item.path, item.bytes);
  return { indexPath, files };
}
