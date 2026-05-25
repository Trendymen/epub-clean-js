/**
 * content.opf 渲染（移植自 Python metadata_builder.py）。
 *
 * ManifestItem = { id, href, mediaType, properties|null }
 * SpineItem    = { idref, linear: 'yes'|'no', properties|null }
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nunjucks from 'nunjucks';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

let envCache = null;
function getEnv() {
  if (envCache) return envCache;
  envCache = nunjucks.configure(TEMPLATES_DIR, {
    autoescape: false,
    trimBlocks: false,
    lstripBlocks: false,
    noCache: true,
  });
  return envCache;
}

/**
 * @param {{
 *   title: string,
 *   description: string,
 *   uuid: string,
 *   modifiedIso: string,
 *   manifestItems: Array<{id: string, href: string, mediaType: string, properties: string|null}>,
 *   spineItems: Array<{idref: string, linear: string, properties: string|null}>,
 * }} args
 * @returns {string}
 */
export function buildContentOpf({
  title,
  description,
  uuid,
  modifiedIso,
  manifestItems,
  spineItems,
}) {
  const env = getEnv();
  // content.opf 在 Python golden 末尾**无** newline，byte-level 对齐时显式 trimEnd。
  return env.render('content.opf.njk', {
    title,
    description: description.trim(),
    uuid,
    modifiedIso,
    manifestItems,
    spineItems,
  }).replace(/\n+$/, '');
}
