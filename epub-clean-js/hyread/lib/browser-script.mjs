import { readFile } from 'node:fs/promises';
import { validateSession } from './session.mjs';

export async function createBrowserScript(session, { mode = 'capture' } = {}) {
  validateSession(session);
  if (!['capture', 'audit'].includes(mode)) throw new Error('Invalid browser workflow mode');
  const source = await readFile(new URL('../browser/capture-decrypted.js', import.meta.url), 'utf8');
  const options = JSON.stringify({ session, mode }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `(async () => {\n${source}\nreturn await window.__hyreadWorkflow.start(${options});\n})()`;
}
