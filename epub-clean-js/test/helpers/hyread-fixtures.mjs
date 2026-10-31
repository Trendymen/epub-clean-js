import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveHyreadConfig } from '../../hyread/config.mjs';

export async function createHyreadFixture(options = {}) {
  const temporary = await mkdtemp(join(tmpdir(), 'hyread-session-'));
  const config = resolveHyreadConfig({ volume: '09', assetId: 'fixture-book-09', title: '合成測試書 9', workDir: join(temporary, 'work'), projectRoot: temporary, ...options });
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
