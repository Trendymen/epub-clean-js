import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { createHyreadFixture } from './hyread-fixtures.mjs';

const rect = (x = 0, y = 0, width = 800, height = 600) => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height });

export async function createBrowserFixture(options = {}) {
  const f = await createHyreadFixture();
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const spine = [ ['cover', 'xhtml/cover.xhtml'], ['body1', 'xhtml/body1.xhtml'], ['body2', 'xhtml/body2.xhtml'] ].map(([id, href]) => ({ id, href }));
  const session = { schemaVersion: 1, volume: '09', assetId: f.config.assetId, title: f.config.bookTitle, sourceOpfSha256: hash(f.opf), resourceRoot: 'resources/generations/fixture', spine,
    manifest: [...spine.map(({ id, href }) => ({ id, href, mediaType: 'application/xhtml+xml', properties: [] })), { id: 'image', href: 'images/pixel.png', mediaType: 'image/png', properties: [] }, { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: ['nav'] }, { id: 'css', href: 'style.css', mediaType: 'text/css', properties: [] }],
    resources: Object.fromEntries(Object.entries(f.resources).map(([href, bytes]) => [href, { bytes: bytes.length, sha256: hash(bytes) }])) };
  if (options.singleSpine) {
    const opf = Buffer.from(f.opf.toString('utf8').replace(/<spine>.*?<\/spine>/s, '<spine><itemref idref="cover"/></spine>'));
    f.resources['standard.opf'] = opf;
    session.spine = spine.slice(0, 1);
    session.sourceOpfSha256 = hash(opf);
    session.resources['standard.opf'] = { bytes: opf.length, sha256: hash(opf) };
  }
  const { document } = parseHTML('<html><body><button aria-label="目次">目次</button><span id="progress"></span></body></html>');
  let chapter = options.initialChapter ?? 1, page = options.initialPage ?? 2, panel = false, ticks = 0, moving = false;
  const pages = options.pages ?? [1, 3, 2];
  let renderedChapter = options.initialDocumentChapter ?? chapter;
  const timers = new Set();
  const documents = spine.map(({ href }) => parseHTML(f.capture.data[href]).document);
  documents[1].body.innerHTML = '<p id="first">前😀<img src="../images/pixel.png" alt="插圖"/>後 <ruby>字<rt>音</rt></ruby>。</p><p id="second">第二段</p><p id="hidden">未見文字</p><a href="#first">回上段</a>';
  if (options.foreignImage) documents[1].querySelector('img').setAttribute('src', 'https://foreign.test/pixel.png');
  for (const [index, doc] of documents.entries()) {
    const base = doc.createElement('base'); base.setAttribute('href', new URL(spine[index].href, f.config.itemBase).href); doc.head.append(base);
    Object.defineProperty(doc, 'baseURI', { get: () => doc.querySelector('base').getAttribute('href') });
    Object.defineProperty(doc, 'URL', { value: 'https://service.ebook.hyread.com.tw/ebookservice/epubreader/hyread/v3/openbook2.jsp?data=fixture-private-context' });
    Object.defineProperty(doc, 'readyState', { get: () => options.loading ? 'loading' : 'complete' });
    Object.defineProperty(doc, 'fonts', { value: { get status() { return ticks < (options.fontTicks ?? 0) ? 'loading' : 'loaded'; } } });
    doc.documentElement.getBoundingClientRect = () => rect();
    for (const [i, node] of [...doc.querySelectorAll('p,img,image,a')].entries()) {
      node.getBoundingClientRect = () => node.id === 'hidden' || (node.tagName.toLowerCase() === 'p' && (i % pages[chapter]) + 1 !== page) ? rect(2000) : rect(10, 10, 100, 50);
      node.getClientRects = () => [node.getBoundingClientRect()];
      if (node.tagName.toLowerCase() === 'img') Object.defineProperties(node, { complete: { value: true }, naturalWidth: { value: 1 }, width: { value: 100 }, height: { value: 50 } });
    }
  }
  if (options.initialBaseAhead) documents[renderedChapter].querySelector('base').setAttribute('href', new URL(spine[chapter].href, f.config.itemBase).href);
  const decoy = document.createElement('iframe');
  decoy.__reactFiber$fixture = { memoizedProps: { item: { spineId: 'foreign', src: 'https://foreign.test/item/old.xhtml', spineIndex: 0 } } };
  decoy.getBoundingClientRect = () => rect(-3000);
  Object.defineProperty(decoy, 'contentDocument', { value: documents[0] });
  document.body.append(decoy);
  const frame = document.createElement('iframe');
  frame.getBoundingClientRect = () => options.invisible || (options.transitionInvisible && moving) ? rect(3000) : rect();
  Object.defineProperty(frame, 'contentDocument', { get: () => {
    if (options.changing) documents[renderedChapter].body.append(String(++ticks));
    return documents[renderedChapter];
  } });
  document.body.append(frame);
  function update() {
    frame.__reactFiber$fixture = { return: { memoizedProps: { item: { spineId: spine[chapter].id, src: new URL(spine[chapter].href, f.config.itemBase).href, spineIndex: chapter, oriSpineIndex: chapter } } } };
    document.querySelector('#progress').textContent = `本章第 ${page} 頁 / ${pages[chapter]} 頁`;
    for (const button of document.querySelectorAll('#toc button')) button.setAttribute('aria-label', `${button.textContent}${+button.dataset.chapter === chapter ? ' 正在閱讀此章節' : ''}`);
  }
  function move(nextChapter, nextPage) {
    if (options.restoreFailure && nextChapter === (options.initialChapter ?? 1) && chapter === 2) throw new Error('fixture restoration failed');
    if (options.stuck) return;
    const apply = () => {
      const changed = chapter !== nextChapter;
      chapter = nextChapter; page = nextPage; moving = false; update();
      if (!options.contentNever) {
        const render = () => { renderedChapter = nextChapter; documents[nextChapter].querySelector('base').setAttribute('href', new URL(spine[nextChapter].href, f.config.itemBase).href); };
        if (changed && options.contentDelay) { const timer = setTimeout(() => { timers.delete(timer); render(); }, options.contentDelay); timers.add(timer); }
        else render();
      }
    };
    if (options.moveDelay) { moving = true; const timer = setTimeout(() => { timers.delete(timer); apply(); }, options.moveDelay); timers.add(timer); }
    else apply();
  }
  const reader = {
    getBookMetadata: () => ({ title: options.midwayTitle && chapter === 2 ? '別本書' : options.title ?? session.title, creator: '合成作者', cover: { href: `${f.config.itemBase}images/pixel.png` } }),
    turnToPrevChapter: () => move(Math.max(0, chapter - 1), 1),
    turnToNextChapter: () => move(Math.min(2, chapter + 1), 1),
    turnToPrevPage: () => move(chapter, Math.max(1, page - 1)),
    turnToNextPage: () => {
      if (options.noPageTurn) return;
      move(chapter, Math.min(pages[chapter], page + (options.pageJump ? 2 : 1)));
      if (options.bodyChanges) documents[chapter].body.append(`頁${page}`);
    },
  };
  const toc = options.toc ?? [{ label: '同名', index: 1 }, { label: '同名', index: 2 }, { label: '同名', index: 1 }];
  function renderToc() {
    if (!options.persistentToc) document.querySelector('#toc')?.remove();
    if ((panel || options.persistentToc) && !document.querySelector('#toc')) {
      const nav = document.createElement('div'); nav.id = 'toc'; nav.setAttribute('role', 'tabpanel');
      nav.getBoundingClientRect = () => panel ? rect(0, 0, 300, 500) : rect(0, 0, 0, 0);
      const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); nav.append(menu);
      for (const entry of toc) {
        const button = document.createElement('button'); button.setAttribute('role', 'menuitem'); button.dataset.chapter = String(entry.index); button.setAttribute('aria-label', `${entry.label}${entry.index === chapter ? ' 正在閱讀此章節' : ''}`); button.textContent = entry.label;
        button.getBoundingClientRect = () => panel ? rect(0, entry.y ?? 0, 100, 30) : rect(0, 0, 0, 0);
        button.onclick = () => { panel = false; if (!options.persistentToc) nav.remove(); else nav.style.display = 'none'; if (!options.tocNoNavigation) move(entry.index, 1); };
        menu.append(button);
      }
      document.body.append(nav);
    }
    if (document.querySelector('#toc')) document.querySelector('#toc').style.display = panel ? 'block' : 'none';
  }
  document.querySelector('button').getBoundingClientRect = () => rect(0, 0, 100, 30);
  document.querySelector('button').onclick = () => { panel = !panel; renderToc(); };
  renderToc();
  const originalCreate = document.createElement.bind(document);
  document.createElement = (name, ...args) => { if (name.toLowerCase() === 'a') throw new Error('Download anchor forbidden'); return originalCreate(name, ...args); };
  const sandbox = { document, console, URL, TextEncoder, Uint8Array, AbortController, crypto: webcrypto, innerWidth: 800, innerHeight: 600,
    getComputedStyle: (node) => ({ display: node.style?.display || 'block', visibility: node.style?.visibility || 'visible', opacity: node.style?.opacity || '1' }),
    setTimeout: (callback, ms) => setTimeout(() => { ticks++; callback(); }, ms), clearTimeout,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    XMLSerializer: class { serializeToString(doc) { if (options.serializationFailure) throw new Error('fixture serialization failed'); return doc.toString(); } },
    fetch: async (url, init) => {
      if (options.fetchNever) return new Promise(() => {});
      if (options.bodyHangOn && String(url).endsWith(options.bodyHangOn === 'opf' ? 'standard.opf' : 'pixel.png')) {
        init.signal.addEventListener('abort', () => { options.networkState.aborted = true; }, { once: true });
        const response = new Response(new ReadableStream({
          start() { options.networkState.active = true; },
          cancel() { options.networkState.active = false; options.networkState.closed = true; },
        }), { status: options.responseStatus ?? 200 });
        Object.defineProperty(response, 'url', { value: options.responseUrl ?? String(url) });
        return response;
      }
      return options.changedOpf && String(url).endsWith('standard.opf') ? new Response('changed') : f.fetchImpl(url, init);
    },
    __HyRead__: { reader } };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  update();
  const install = async () => {
    const result = vm.runInContext(await readFile(new URL('../../hyread/browser/capture-decrypted.js', import.meta.url), 'utf8'), context);
    if (result?.catch) result.catch(() => {});
  };
  return { session, context, install, run: (code) => vm.runInContext(code, context), position: () => ({ chapter, page }), navigationPending: () => moving, api: () => sandbox.__hyreadWorkflow,
    cleanup: async () => { for (const timer of timers) clearTimeout(timer); await f.cleanup(); } };
}

export async function exportFixture(api) {
  const info = await api.exportInfo({ chunkBytes: 7 });
  const chunks = Array.from({ length: info.chunkCount }, (_, index) => api.readChunk(index));
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.dataBase64, 'base64')));
  return { info, chunks, bytes, value: JSON.parse(bytes.toString('utf8')) };
}
