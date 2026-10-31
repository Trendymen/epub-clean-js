import { safeRelativePath } from './paths.mjs';
import { validateSession } from './session.mjs';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const integer = (v, min = 0) => Number.isSafeInteger(v) && v >= min;
const titleKey = (v) => v.normalize('NFKC').replace(/\s+/gu, '');
const require = (condition, message) => { if (!condition) throw new Error(message); };
export const itemBaseFor = (session) => `https://service.ebook.hyread.com.tw/ebookservice/epub/${session.assetId}/item/`;

export function resourceHref(src, session) {
  require(typeof src === 'string', 'Invalid resource URL');
  const base = itemBaseFor(session);
  const url = new URL(src);
  require(url.href === src && src.startsWith(base) && !url.search && !url.hash, 'Resource URL is not a canonical same-book URL');
  const href = safeRelativePath(src.slice(base.length));
  require(new URL(href.split('/').map(encodeURIComponent).join('/'), base).href === src, 'Noncanonical resource path');
  require(session.manifest.some((item) => item.href === href), 'Resource is absent from manifest');
  return href;
}

function validateMeta(meta, session, kind) {
  require(object(meta) && meta.schemaVersion === 1 && meta.kind === kind && meta.complete === true, 'Invalid or incomplete artifact metadata');
  require(meta.assetId === session.assetId && typeof meta.title === 'string' && titleKey(meta.title) === titleKey(session.title) && meta.sourceOpfSha256 === session.sourceOpfSha256, 'Artifact identity mismatch');
  require(typeof meta.startedAt === 'string' && typeof meta.completedAt === 'string' && Number.isFinite(Date.parse(meta.startedAt)) && Number.isFinite(Date.parse(meta.completedAt)) && Date.parse(meta.completedAt) >= Date.parse(meta.startedAt), 'Invalid artifact timestamps');
  const restoration = meta.restoration;
  require(object(restoration) && typeof restoration.attempted === 'boolean' && typeof restoration.ok === 'boolean' && (restoration.error === null || typeof restoration.error === 'string'), 'Invalid restoration metadata');
  require(!restoration.ok || restoration.attempted, 'Restoration success without attempt');
}

export function validateCapture(capture, session) {
  validateSession(session);
  require(object(capture) && Array.isArray(capture.order) && object(capture.data), 'Invalid capture envelope');
  require(capture.order.length === session.spine.length && new Set(capture.order).size === capture.order.length, 'Capture spine is incomplete or duplicated');
  require(JSON.stringify(Object.keys(capture.data).sort()) === JSON.stringify([...capture.order].sort()), 'Capture data keys do not match order');
  for (const [index, src] of capture.order.entries()) {
    require(resourceHref(src, session) === session.spine[index].href, 'Capture order differs from expected spine');
    require(typeof capture.data[src] === 'string' && capture.data[src].trim(), 'Capture XHTML is missing');
  }
  if (Object.hasOwn(capture, 'meta')) validateMeta(capture.meta, session, 'capture');
  return capture;
}

function validateIndices(values, count, label) {
  require(Array.isArray(values) && values.every((n) => integer(n) && n < count) && new Set(values).size === values.length, `Invalid ${label}`);
}

export function validateAuditEnvelope(audit, session) {
  validateSession(session);
  require(object(audit), 'Invalid audit envelope');
  validateMeta(audit.meta, session, 'audit');
  for (const field of ['tocEntries', 'records', 'imageHashes', 'issues']) require(Array.isArray(audit[field]), `Invalid audit ${field}`);
  for (const entry of audit.tocEntries) {
    require(object(entry) && typeof entry.label === 'string', 'Invalid TOC entry');
    require(session.spine.some((item) => item.href === resourceHref(entry.src, session)), 'TOC target is outside spine');
  }
  require(audit.records.length === session.spine.length, 'Audit spine is incomplete');
  const seen = new Set();
  for (const record of audit.records) {
    require(object(record) && integer(record.spineIndex) && record.spineIndex < session.spine.length && !seen.has(record.spineIndex), 'Invalid or duplicate audit spine index');
    seen.add(record.spineIndex);
    const expected = session.spine[record.spineIndex];
    require(resourceHref(record.src, session) === expected.href && record.spineId === expected.id && typeof record.bodyText === 'string', 'Audit spine identity mismatch');
    for (const field of ['paragraphs', 'images', 'ruby', 'bodyLinks', 'pageChecks', 'bodyChanges', 'unseenTextBlocks', 'errors']) require(Array.isArray(record[field]), `Invalid record ${field}`);
    require(integer(record.pageCount, 1), 'Invalid page count');
    for (const [index, p] of record.paragraphs.entries()) require(object(p) && p.index === index && typeof p.tag === 'string' && /^[a-z][a-z0-9]*$/.test(p.tag) && ['id', 'text', 'semantic', 'display', 'visibility'].every((k) => typeof p[k] === 'string'), 'Invalid paragraph observation');
    for (const image of record.images) {
      require(object(image) && ['img', 'image'].includes(image.tag) && typeof image.alt === 'string' && integer(image.paragraphIndex, -1) && image.paragraphIndex < record.paragraphs.length, 'Invalid image observation');
      const href = resourceHref(image.src, session);
      require(session.manifest.find((item) => item.href === href).mediaType.startsWith('image/'), 'Image reference is not an image resource');
      require(['width', 'height'].every((key) => typeof image[key] === 'number' && Number.isFinite(image[key]) && image[key] >= 0), 'Invalid image dimensions');
      require((image.complete === null || typeof image.complete === 'boolean') && (image.naturalWidth === null || (typeof image.naturalWidth === 'number' && Number.isFinite(image.naturalWidth) && image.naturalWidth >= 0)), 'Invalid image load observation');
    }
    require(record.ruby.every((v) => typeof v === 'string') && record.bodyLinks.every((v) => object(v) && typeof v.text === 'string' && typeof v.href === 'string'), 'Invalid ruby or link observations');
    require(record.pageChecks.length === record.pageCount, 'Incomplete page observations');
    const pages = new Set();
    for (const [index, check] of record.pageChecks.entries()) {
      require(object(check) && check.page === index + 1 && !pages.has(check.page) && check.total === record.pageCount && typeof check.bodyUnchanged === 'boolean', 'Invalid page observation');
      pages.add(check.page);
      validateIndices(check.visibleBlocks, record.paragraphs.length, 'visible blocks');
    }
    validateIndices(record.unseenTextBlocks, record.paragraphs.length, 'unseen blocks');
    require(record.bodyChanges.every((v) => object(v) && integer(v.page, 1) && v.page <= record.pageCount && typeof v.bodyText === 'string'), 'Invalid body change');
    require(record.errors.every((v) => typeof v === 'string'), 'Invalid record error');
  }
  const imageUrls = new Set();
  for (const image of audit.imageHashes) {
    require(object(image) && integer(image.bytes, 1) && hash(image.sha256) && !imageUrls.has(image.url), 'Invalid image integrity record');
    imageUrls.add(image.url);
    const href = resourceHref(image.url, session);
    require(session.manifest.find((item) => item.href === href).mediaType.startsWith('image/'), 'Image hash is not for an image resource');
  }
  for (const issue of audit.issues) {
    require(object(issue) && ['bodyChanged', 'unseenTextBlocks'].includes(issue.type), 'Invalid audit issue');
    resourceHref(issue.src, session);
    if (issue.page !== undefined) require(integer(issue.page, 1), 'Invalid issue page');
    if (issue.blocks !== undefined) require(Array.isArray(issue.blocks) && issue.blocks.every((v) => integer(v)), 'Invalid issue blocks');
  }
  return audit;
}
