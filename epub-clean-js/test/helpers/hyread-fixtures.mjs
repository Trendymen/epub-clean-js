import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveHyreadConfig } from '../../hyread/config.mjs';
import { spawn } from 'node:child_process';

export function absoluteHyreadCapture(capture, itemBase) {
  return { ...capture, order: capture.order.map((href) => new URL(href, itemBase).href), data: Object.fromEntries(Object.entries(capture.data).map(([href, html]) => [new URL(href, itemBase).href, html])) };
}

export async function createHyreadFixture(options = {}) {
  const { temporaryParent = tmpdir(), ...configOptions } = options;
  const temporary = await mkdtemp(join(temporaryParent, 'hyread-session-'));
  const config = resolveHyreadConfig({ volume: '09', assetId: 'fixture-book-09', title: '合成測試書 9', workDir: join(temporary, 'work'), projectRoot: temporary, ...configOptions });
  const opf = Buffer.from(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest>
    <item id="body2" href="xhtml/body2.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="xhtml/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="body1" href="xhtml/body1.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="image" href="images/pixel.png" media-type="image/png"/>
  </manifest><spine><itemref idref="cover"/><itemref idref="body1"/><itemref idref="body2"/></spine></package>`);
  const data = {
    'xhtml/cover.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>封面</title></head><body><img src="../images/pixel.png" alt="封面"/></body></html>',
    'xhtml/body1.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body><p>第一段<ruby>字<rt>音</rt></ruby>。</p></body></html>',
    'xhtml/body2.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head><body><p>圖前。</p><svg xmlns="http://www.w3.org/2000/svg"><image href="../images/pixel.png"/></svg><p>圖後。</p></body></html>',
  };
  const resources = {
    'standard.opf': opf,
    ...Object.fromEntries(Object.entries(data).map(([href, xml]) => [href, Buffer.from(xml)])),
    'nav.xhtml': Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><body><nav><ol><li><a href="xhtml/body1.xhtml">第一章</a></li></ol></nav></body></html>'),
    'style.css': Buffer.from('body { line-height: 1.8; }'),
    'images/pixel.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQxkAAAAASUVORK5CYII=', 'base64'),
  };
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (!url.href.startsWith(config.itemBase)) throw new Error(`Unexpected fixture URL: ${url}`);
    const href = decodeURIComponent(url.pathname.slice(new URL(config.itemBase).pathname.length));
    const bytes = resources[href];
    const response = new Response(bytes ?? 'missing', { status: bytes ? 200 : 404 });
    Object.defineProperty(response, 'url', { value: url.href });
    return response;
  };
  return { config, opf, resources, capture: { order: ['xhtml/cover.xhtml', 'xhtml/body1.xhtml', 'xhtml/body2.xhtml'], data }, fetchImpl, cleanup: () => rm(temporary, { recursive: true, force: true }) };
}

export function startHyreadPrepareProcess(options, { pauseAt = 'first' } = {}) {
  const script = `
    import fs from 'node:fs';
    import { dirname } from 'node:path';
    import { syncBuiltinESMExports } from 'node:module';
    import { createHyreadFixture } from ${JSON.stringify(import.meta.url)};
    import { prepareSession } from ${JSON.stringify(new URL('../../hyread/lib/session.mjs', import.meta.url).href)};
    const f = await createHyreadFixture({ ...${JSON.stringify(options)}, temporaryParent: dirname(${JSON.stringify(options.workDir)}) });
    let gated = false;
    for (const method of ['link', 'rename']) {
      const original = fs.promises[method];
      fs.promises[method] = async (...args) => {
        if (!gated && dirname(args[1]) === f.config.workDir && (${JSON.stringify(pauseAt)} !== 'session' || method === 'rename')) {
          gated = true;
          process.send({ type: 'ready' });
          await new Promise((resolve) => process.once('message', resolve));
        }
        return original(...args);
      };
    }
    syncBuiltinESMExports();
    try {
      const result = await prepareSession(f.config, { fetchImpl: f.fetchImpl });
      process.send({ type: 'result', ok: true, session: result.session });
    } catch (error) {
      process.send({ type: 'result', ok: false, error: error.message });
    } finally {
      await f.cleanup();
      process.disconnect();
    }
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let errors = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { errors += chunk; });
  let resolveReady, rejectReady, resolveResult;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const result = new Promise((resolve) => { resolveResult = resolve; });
  child.on('message', (message) => {
    if (message.type === 'ready') resolveReady();
    if (message.type === 'result') {
      resolveResult(message);
      if (!message.ok) rejectReady(new Error(message.error));
    }
  });
  child.on('error', (error) => { rejectReady(error); resolveResult({ ok: false, error: error.message }); });
  child.on('exit', (code) => {
    const error = `Prepare child exited ${code}: ${errors}`;
    rejectReady(new Error(error));
    resolveResult({ ok: false, error });
  });
  return { ready, result, release: () => child.send({ type: 'release' }), kill: () => child.kill() };
}
