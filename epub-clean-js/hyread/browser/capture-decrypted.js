// 安装后由 start 显式启动；正文只通过内存分块接口返回。
(() => {
  'use strict';
  if (window.__hyreadWorkflow?.version === 1) return;
  if (window.__hyreadWorkflow) throw new Error('Unknown HyRead workflow already installed');
  const reader = () => {
    const value = window.__HyRead__?.reader;
    for (const method of ['getBookMetadata', 'turnToPrevChapter', 'turnToNextChapter', 'turnToPrevPage', 'turnToNextPage']) {
      if (typeof value?.[method] !== 'function') throw new Error(`Unsupported reader: ${method}`);
    }
    return value;
  };
  const normalize = (value) => String(value).normalize('NFKC').replace(/\s/g, '');
  const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const digest = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const sourceUrl = (assetId, href) => `https://service.ebook.hyread.com.tw/ebookservice/epub/${encodeURIComponent(assetId)}/item/${href.split('/').map(encodeURIComponent).join('/')}`;
  const emptyStatus = () => ({ state: 'idle', mode: null, phase: 'idle', progress: { completed: 0, total: 0, spineId: null, page: null, pageCount: null }, errors: [], restoration: { attempted: false, ok: false, error: null } });
  let state = emptyStatus(), cancelled = false, restoring = false, output = null, encoded = null, encodedSha = null, chunkView = null, settings, session;
  let pendingNavigation = null, recoveryOrigin = null, settlingRecovery = false;

  function visibleArea(element, width = innerWidth, height = innerHeight) {
    const css = getComputedStyle(element);
    if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || Number(css.opacity || 1) <= 0) return 0;
    const rect = element.getBoundingClientRect();
    return Math.max(0, Math.min(rect.right, width) - Math.max(rect.left, 0)) * Math.max(0, Math.min(rect.bottom, height) - Math.max(rect.top, 0)) * Number(css.opacity || 1);
  }

  function current() {
    let frame, area = 0;
    for (const candidate of document.querySelectorAll('iframe')) {
      const next = visibleArea(candidate);
      if (next > area) { frame = candidate; area = next; }
    }
    if (!frame) throw new Error('No visible reader iframe');
    const key = Object.keys(frame).find((name) => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'));
    let fiber = frame[key], item;
    for (let depth = 0; fiber && depth < 25; depth++, fiber = fiber.return) {
      if (fiber.memoizedProps?.item) { item = fiber.memoizedProps.item; break; }
    }
    if (!item || typeof item.src !== 'string' || typeof item.spineId !== 'string' || !Number.isInteger(item.spineIndex)) throw new Error('Unsupported iframe React item');
    const url = new URL(item.src);
    const match = /^\/ebookservice\/epub\/([^/]+)\/item\/(.+)$/.exec(url.pathname);
    if (url.origin !== 'https://service.ebook.hyread.com.tw' || !match || url.search || url.hash) throw new Error('Unexpected reader resource URL');
    const src = decodeURIComponent(match[2]);
    if (src.split('/').some((part) => !part || part === '.' || part === '..' || /[\\\u0000-\u001f]/.test(part))) throw new Error('Unsafe reader resource path');
    const progress = /本章第\s*(\d+)\s*頁\s*\/\s*(\d+)\s*頁/.exec(document.body.textContent);
    if (!progress || +progress[1] < 1 || +progress[2] < +progress[1] || +progress[2] > 10000) throw new Error('Unsupported reader pagination');
    return { frame, item, assetId: match[1], src, page: +progress[1], pageCount: +progress[2] };
  }

  function describe() {
    const metadata = reader().getBookMetadata();
    if (typeof metadata?.title !== 'string') throw new Error('Missing reader book title');
    const value = current();
    return { schemaVersion: 1, assetId: value.assetId, title: metadata.title, current: { spineId: value.item.spineId, src: sourceUrl(value.assetId, value.src), page: value.page, pageCount: value.pageCount } };
  }

  class WorkflowCancelled extends Error {}
  function checkCancel() { if (cancelled && !restoring) throw new WorkflowCancelled('Workflow cancelled'); }
  function identity(value) {
    const metadata = reader().getBookMetadata();
    if (normalize(metadata?.title) !== normalize(session.title) || value.assetId !== session.assetId) throw new Error('Reader belongs to another book');
    const index = session.spine.findIndex((item) => item.href === value.src);
    if (index < 0 || session.spine[index].id !== value.item.spineId || index !== value.item.spineIndex) throw new Error('Reader spine differs from session');
    return index;
  }

  function documentEvidence(value) {
    const doc = value.doc ?? value.frame.contentDocument;
    return { src: value.src, page: value.page, doc, root: doc?.documentElement, body: doc?.body, html: doc?.body?.innerHTML };
  }

  async function stable(expectedSrc, expectedPage, evidence, requireAssociation = true) {
    const deadline = Date.now() + settings.timeoutMs;
    let previous, count = 0, lastError;
    while (Date.now() < deadline) {
      checkCancel();
      try {
        const value = current();
        identity(value);
        const doc = value.frame.contentDocument;
        const base = doc?.querySelector('base[href]')?.getAttribute('href');
        const baseMatches = base === value.item.src && doc.baseURI === value.item.src;
        const transitioned = !evidence || value.src === evidence.src || doc !== evidence.doc || doc?.documentElement !== evidence.root || doc?.body !== evidence.body || doc?.body?.innerHTML !== evidence.html;
        const associated = !requireAssociation || (baseMatches && transitioned);
        if (associated && (!expectedSrc || value.src === expectedSrc) && (!expectedPage || value.page === expectedPage) && doc?.readyState === 'complete' && doc.fonts?.status === 'loaded' && doc.body && (text(doc.body.textContent) || doc.body.querySelector('img,image'))) {
          const signature = `${value.src}\n${value.page}/${value.pageCount}\n${doc.body.innerHTML}`;
          count = signature === previous ? count + 1 : 1;
          previous = signature;
          if (count >= settings.stableSamples) {
            state.progress.spineId = value.item.spineId; state.progress.page = value.page; state.progress.pageCount = value.pageCount;
            return { ...value, doc };
          }
        } else { count = 0; previous = undefined; }
      } catch (error) {
        if (/another book|differs from session|Unsafe|Unexpected/.test(error.message)) throw error;
        lastError = error; count = 0; previous = undefined;
      }
      await sleep(settings.pollMs);
    }
    throw new Error(`Reader stability timeout${lastError ? `: ${lastError.message}` : ''}`);
  }

  async function bounded(action, label) {
    const controller = new AbortController();
    let timer, stopped = false;
    const guard = new Promise((_, reject) => {
      const deadline = Date.now() + settings.timeoutMs;
      const check = () => {
        if (stopped) return;
        try { checkCancel(); if (Date.now() >= deadline) throw new Error(`${label} timeout`); }
        catch (error) { controller.abort(); reject(error); return; }
        timer = setTimeout(check, settings.pollMs);
      };
      check();
    });
    try { return await Promise.race([Promise.resolve().then(() => action(controller.signal)), guard]); }
    catch (error) { controller.abort(); throw error; }
    finally { stopped = true; clearTimeout(timer); }
  }

  async function navigate(action, target, evidence) {
    checkCancel();
    if (pendingNavigation) throw new Error('Unconfirmed reader navigation is still pending');
    const navigation = { ...target, evidence, actionError: null, completion: null };
    pendingNavigation = navigation;
    try {
      navigation.completion = Promise.resolve(action()).then(() => {}, (error) => { navigation.actionError = error; });
    } catch (error) {
      navigation.actionError = error;
      navigation.completion = Promise.resolve();
      throw error;
    }
    return settleNavigation();
  }

  async function settleNavigation() {
    const navigation = pendingNavigation;
    if (!navigation) return;
    await bounded(() => navigation.completion, 'Reader action');
    if (navigation.actionError) throw new Error(`Unconfirmed reader navigation: ${navigation.actionError.message}`);
    const value = navigation.toc ? await tocDestination(navigation.evidence) : await stable(navigation.src, navigation.page, navigation.evidence);
    if (pendingNavigation === navigation) pendingNavigation = null;
    return value;
  }

  async function fetchBytes(url) {
    return bounded(async (signal) => {
      const deadline = Date.now() + settings.timeoutMs;
      const response = await fetch(url, { signal });
      const stream = response.body?.getReader(), chunks = [];
      let size = 0, finished = false;
      // 流取消失败时，保留原有的超时或取消原因。
      const abortBody = () => { if (stream) void stream.cancel().catch(() => {}); };
      signal.addEventListener('abort', abortBody, { once: true });
      try {
        if (response.status !== 200) throw new Error(`Resource HTTP ${response.status}`);
        if (response.url && response.url !== url) throw new Error('Resource redirect differs from observed URL');
        if (!stream) throw new Error('Empty resource response body');
        if (signal.aborted) { abortBody(); throw new Error('Resource request aborted'); }
        while (true) {
          checkCancel();
          if (Date.now() >= deadline) throw new Error('Resource request timeout');
          const { done, value } = await stream.read();
          if (done) { finished = true; break; }
          chunks.push(value); size += value.byteLength;
        }
        checkCancel();
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return bytes;
      } finally {
        signal.removeEventListener('abort', abortBody);
        if (stream) {
          if (!finished || signal.aborted) await stream.cancel().catch(() => {});
          stream.releaseLock();
        }
      }
    }, 'Resource request');
  }

  async function goTo(index, initialValue) {
    let value = initialValue ?? await stable();
    for (let attempts = 0; value.src !== session.spine[index].href && attempts < session.spine.length; attempts++) {
      const previous = identity(value), next = previous + (previous < index ? 1 : -1);
      const evidence = documentEvidence(value);
      value = await navigate(() => reader()[previous < index ? 'turnToNextChapter' : 'turnToPrevChapter'](), { src: session.spine[next].href }, evidence);
    }
    if (value.src !== session.spine[index].href) throw new Error('Unable to reach expected spine');
    return value;
  }

  async function goToPage(value, target) {
    for (let attempts = 0; value.page !== target && attempts < 10000; attempts++) {
      const next = value.page + (value.page < target ? 1 : -1);
      value = await navigate(() => reader()[value.page < target ? 'turnToNextPage' : 'turnToPrevPage'](), { src: value.src, page: next }, documentEvidence(value));
    }
    if (value.page !== target) throw new Error('Unable to restore expected page');
    return value;
  }

  async function establishDocument() {
    const value = await stable(undefined, undefined, undefined, false);
    if (session.spine.length < 2) throw new Error('Cannot establish document association without a controlled chapter transition');
    const index = identity(value);
    await goTo(index === 0 ? 1 : index - 1, value);
    await goTo(index);
  }

  function resourceUrl(reference, src) {
    const base = `https://service.ebook.hyread.com.tw/ebookservice/epub/${session.assetId}/item/`;
    const url = new URL(reference, new URL(src, base));
    if (!url.href.startsWith(base) || url.search || url.hash) throw new Error('Image resource leaves book');
    const href = decodeURIComponent(url.href.slice(base.length));
    if (!session.manifest.some((item) => item.href === href)) throw new Error('Image resource missing from session');
    return url.href;
  }

  function semantic(node, src) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return '';
    if (['img', 'image'].includes(node.tagName.toLowerCase())) return `[image:${resourceUrl(node.getAttribute('src') || node.getAttribute('href') || node.getAttribute('xlink:href'), src)}]`;
    return Array.from(node.childNodes, (child) => semantic(child, src)).join('');
  }

  const blockSelector = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,div';
  const blocksOf = (doc) => Array.from(doc.body.querySelectorAll(blockSelector)).filter((node) => !node.querySelector(blockSelector));
  function record(value) {
    const blocks = blocksOf(value.doc);
    const paragraphs = blocks.map((node, index) => {
      const css = getComputedStyle(node);
      return { index, tag: node.tagName.toLowerCase(), id: node.id || '', text: text(node.textContent), semantic: text(semantic(node, value.src)), display: css.display, visibility: css.visibility };
    });
    const images = Array.from(value.doc.body.querySelectorAll('img,image'), (node) => {
      const bounds = node.getBoundingClientRect();
      return { tag: node.tagName.toLowerCase(), src: resourceUrl(node.getAttribute('src') || node.getAttribute('href') || node.getAttribute('xlink:href'), value.src), alt: node.getAttribute('alt') || '', paragraphIndex: blocks.findIndex((block) => block.contains(node)), width: Number(node.width?.baseVal?.value ?? node.width ?? bounds.width), height: Number(node.height?.baseVal?.value ?? node.height ?? bounds.height), complete: typeof node.complete === 'boolean' ? node.complete : null, naturalWidth: typeof node.naturalWidth === 'number' ? node.naturalWidth : null };
    });
    return { src: sourceUrl(value.assetId, value.src), spineId: value.item.spineId, spineIndex: value.item.spineIndex, bodyText: text(value.doc.body.textContent), paragraphs, images,
      ruby: Array.from(value.doc.body.querySelectorAll('ruby'), (node) => text(node.textContent)),
      bodyLinks: Array.from(value.doc.body.querySelectorAll('a[href]'), (node) => ({ text: text(node.textContent), href: node.getAttribute('href') })),
      pageCount: value.pageCount, pageChecks: [], bodyChanges: [], unseenTextBlocks: [], errors: [] };
  }

  async function auditSpine(value, issues) {
    value = await goToPage(value, 1);
    const result = record(value), original = value.doc.body.innerHTML, seen = new Set();
    for (let page = 1; page <= result.pageCount; page++) {
      checkCancel();
      if (value.page !== page || value.pageCount !== result.pageCount) throw new Error('Reader pagination changed or skipped a page');
      const bodyUnchanged = value.doc.body.innerHTML === original;
      const blocks = blocksOf(value.doc), bounds = value.frame.getBoundingClientRect();
      const visibleBlocks = result.paragraphs.filter((paragraph) => blocks[paragraph.index] && visibleArea(blocks[paragraph.index], bounds.width, bounds.height) > 0).map((paragraph) => paragraph.index);
      visibleBlocks.forEach((index) => seen.add(index));
      result.pageChecks.push({ page, total: value.pageCount, bodyUnchanged, visibleBlocks });
      if (!bodyUnchanged) { result.bodyChanges.push({ page, bodyText: text(value.doc.body.textContent) }); issues.push({ src: sourceUrl(value.assetId, value.src), page, type: 'bodyChanged' }); }
      if (page < result.pageCount) value = await navigate(() => reader().turnToNextPage(), { src: value.src, page: page + 1 }, documentEvidence(value));
    }
    result.unseenTextBlocks = result.paragraphs.filter((paragraph) => paragraph.text && !seen.has(paragraph.index)).map((paragraph) => paragraph.index);
    if (result.unseenTextBlocks.length) issues.push({ src: sourceUrl(value.assetId, value.src), type: 'unseenTextBlocks', blocks: result.unseenTextBlocks });
    return result;
  }

  function tocButtons() {
    const panels = Array.from(document.querySelectorAll('[role="tabpanel"]')).filter((panel) => {
      for (let node = panel; node?.nodeType === 1; node = node.parentElement) {
        const css = getComputedStyle(node);
        if (node.hidden || node.getAttribute('aria-hidden') === 'true' || css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity || 1) <= 0) return false;
      }
      return visibleArea(panel) > 0 && panel.querySelector('[role="menu"]');
    });
    if (!panels.length) return [];
    if (panels.length !== 1) throw new Error('Ambiguous official table of contents panel');
    const menus = panels[0].querySelectorAll('[role="menu"]');
    if (menus.length !== 1) throw new Error('Unsupported official table of contents menu');
    const buttons = Array.from(menus[0].querySelectorAll('button[role="menuitem"]'));
    if (buttons.some((button) => !button.hasAttribute('aria-label') || !text(button.innerText || button.textContent))) throw new Error('Unsupported official table of contents entry');
    return buttons;
  }
  async function openToc() {
    const toggle = document.querySelector('button[aria-label="目次"]');
    if (!toggle) throw new Error('Missing official table of contents');
    const existing = tocButtons();
    if (existing.length) return existing;
    toggle.click();
    const deadline = Date.now() + settings.timeoutMs;
    while (Date.now() < deadline) {
      checkCancel();
      const buttons = tocButtons();
      if (buttons.length) return buttons;
      await sleep(settings.pollMs);
    }
    throw new Error('Table of contents timeout');
  }

  async function tocDestination(previous) {
    const deadline = Date.now() + settings.timeoutMs;
    while (Date.now() < deadline) {
      checkCancel();
      try {
        const value = current(); identity(value);
        if (value.src !== previous.src || value.page !== previous.page) return stable(value.src, 1, previous);
      } catch (error) {
        if (error.message !== 'No visible reader iframe') throw error;
      }
      await sleep(settings.pollMs);
    }
    throw new Error('TOC navigation timeout: destination is unconfirmed');
  }

  async function capture() {
    const data = {}, order = [];
    for (let index = 0; index < session.spine.length; index++) {
      checkCancel();
      const value = await goTo(index);
      for (const image of value.doc.body.querySelectorAll('img,image')) resourceUrl(image.getAttribute('src') || image.getAttribute('href') || image.getAttribute('xlink:href'), value.src);
      const xml = new XMLSerializer().serializeToString(value.doc);
      if (typeof xml !== 'string' || !xml.includes('<') || !xml.length) throw new Error('Empty serialized XML');
      const src = sourceUrl(value.assetId, value.src);
      order.push(src); data[src] = xml; state.progress.completed++;
    }
    if (JSON.stringify(order) !== JSON.stringify(session.spine.map((item) => sourceUrl(session.assetId, item.href))) || JSON.stringify(Object.keys(data)) !== JSON.stringify(order)) throw new Error('Incomplete capture');
    return { order, data };
  }

  async function audit() {
    const tocEntries = [], records = [], issues = [], visited = new Set();
    let buttons = await openToc();
    const labels = buttons.map((button) => text(button.innerText || button.textContent));
    if (labels.length > 10000) throw new Error('Too many TOC entries');
    for (let index = 0; index < labels.length; index++) {
      checkCancel();
      if (index) buttons = await openToc();
      if (buttons.length !== labels.length || buttons.some((button, i) => text(button.innerText || button.textContent) !== labels[i])) throw new Error('TOC changed during audit');
      const previous = current(); identity(previous);
      const evidence = documentEvidence(previous);
      const active = buttons[index].getAttribute('aria-label').includes('正在閱讀此章節');
      const value = active ? await goToPage(await stable(previous.src), 1) : await navigate(() => buttons[index].click(), { toc: true }, evidence);
      tocEntries.push({ label: labels[index], src: sourceUrl(value.assetId, value.src) });
      if (!visited.has(value.src)) { records.push(await auditSpine(value, issues)); visited.add(value.src); state.progress.completed++; }
    }
    for (let index = 0; index < session.spine.length; index++) {
      if (!visited.has(session.spine[index].href)) { records.push(await auditSpine(await goTo(index), issues)); visited.add(session.spine[index].href); state.progress.completed++; }
    }
    const imageHashes = [];
    for (const url of new Set(records.flatMap((item) => item.images.map((image) => image.src)))) {
      checkCancel();
      const bytes = await fetchBytes(url);
      imageHashes.push({ url, bytes: bytes.length, sha256: await digest(bytes) });
    }
    return { tocEntries, records, imageHashes, issues };
  }

  function validateOptions(options) {
    if (!options || !['capture', 'audit'].includes(options.mode ?? 'capture')) throw new Error('Invalid workflow mode');
    for (const key of ['timeoutMs', 'pollMs', 'stableSamples']) if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key] < 1)) throw new Error(`Invalid ${key}`);
    const candidate = options.session;
    if (candidate?.schemaVersion !== 1 || typeof candidate.assetId !== 'string' || !/^[a-f0-9]{32}$/i.test(candidate.assetId) || typeof candidate.title !== 'string' || !candidate.title || !/^[a-f0-9]{64}$/.test(candidate.sourceOpfSha256) || !Array.isArray(candidate.spine) || !candidate.spine.length || candidate.spine.length > 10000 || !Array.isArray(candidate.manifest)) throw new Error('Invalid session');
    const paths = new Set(), ids = new Set();
    for (const item of candidate.manifest) {
      if (typeof item.href !== 'string' || /[\\%?#\u0000-\u001f]/.test(item.href) || item.href.split('/').some((part) => !part || part === '.' || part === '..') || paths.has(item.href) || typeof item.id !== 'string' || ids.has(item.id)) throw new Error('Invalid session resource paths');
      paths.add(item.href); ids.add(item.id);
    }
    const spineIds = new Set();
    for (const item of candidate.spine) {
      if (spineIds.has(item.id) || !candidate.manifest.some((entry) => entry.id === item.id && entry.href === item.href)) throw new Error('Invalid session spine');
      spineIds.add(item.id);
    }
    if (options.restore !== undefined && typeof options.restore !== 'boolean') throw new Error('Invalid restore option');
  }

  async function start(options) {
    if (state.state === 'running' || settlingRecovery) throw new Error('Workflow already running');
    validateOptions(options);
    if (pendingNavigation) {
      settlingRecovery = true; restoring = true;
      try {
        await settleNavigation();
        if (recoveryOrigin && settings.restore) {
          await goToPage(await goTo(recoveryOrigin.index), recoveryOrigin.page);
          state.restoration.ok = true; state.restoration.error = null;
        }
      } catch (error) { throw new Error(`Unconfirmed reader navigation; re-establish reader context: ${error.message}`); }
      finally { restoring = false; settlingRecovery = false; }
    }
    settings = { timeoutMs: 15000, pollMs: 150, stableSamples: 3, restore: true, ...options };
    session = clone(options.session);
    state = emptyStatus(); state.state = 'running'; state.mode = options.mode ?? 'capture'; state.phase = 'identity'; state.progress.total = session.spine.length;
    output = null; encoded = null; encodedSha = null; chunkView = null; cancelled = false;
    const startedAt = new Date().toISOString();
    let initial, result, failure;
    try {
      const value = current(); identity(value);
      initial = { index: identity(value), page: value.page };
      recoveryOrigin = initial;
      const opf = await fetchBytes(`https://service.ebook.hyread.com.tw/ebookservice/epub/${session.assetId}/item/standard.opf`);
      if (await digest(opf) !== session.sourceOpfSha256) throw new Error('Source OPF hash changed');
      await establishDocument();
      state.phase = state.mode;
      result = await (state.mode === 'capture' ? capture() : audit());
      checkCancel();
    } catch (error) { failure = error; }
    finally {
      if (pendingNavigation || (initial && settings.restore)) {
        state.phase = 'restoring'; restoring = true; state.restoration.attempted = true;
        try {
          await settleNavigation();
          if (initial && settings.restore) { await goToPage(await goTo(initial.index), initial.page); state.restoration.ok = true; }
        }
        catch (error) { state.restoration.error = error.message; }
        finally { restoring = false; }
      }
    }
    if (failure || cancelled) {
      state.state = failure && !(failure instanceof WorkflowCancelled) ? 'failed' : 'cancelled'; state.phase = state.state;
      if (state.state === 'failed') state.errors.push(failure.message);
      if (state.state === 'failed') throw failure;
      return clone(state);
    }
    try {
      output = { ...result, meta: { schemaVersion: 1, kind: state.mode, assetId: session.assetId, title: session.title, sourceOpfSha256: session.sourceOpfSha256, complete: true, startedAt, completedAt: new Date().toISOString(), restoration: clone(state.restoration) } };
      encoded = new TextEncoder().encode(JSON.stringify(output));
      encodedSha = await digest(encoded);
      if (cancelled) {
        output = null; encoded = null; encodedSha = null;
        state.state = 'cancelled'; state.phase = 'cancelled';
        return clone(state);
      }
      state.state = 'complete'; state.phase = 'complete';
      return clone(state);
    } catch (error) { output = null; encoded = null; chunkView = null; state.state = 'failed'; state.phase = 'failed'; state.errors.push(error.message); throw error; }
  }

  async function exportInfo({ chunkBytes = 12000 } = {}) {
    if (state.state !== 'complete' || !encoded) throw new Error('No complete workflow result');
    if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new Error('Invalid chunkBytes');
    chunkView = { sha256: encodedSha, chunkBytes };
    return { schemaVersion: 1, kind: output.meta.kind, assetId: output.meta.assetId, sourceOpfSha256: output.meta.sourceOpfSha256, byteLength: encoded.length, sha256: chunkView.sha256, chunkBytes, chunkCount: Math.ceil(encoded.length / chunkBytes) };
  }

  function readChunk(index) {
    if (state.state !== 'complete' || !chunkView || !encoded) throw new Error('No complete export view');
    const offset = index * chunkView.chunkBytes;
    if (!Number.isSafeInteger(index) || index < 0 || offset >= encoded.length) throw new Error('Invalid chunk index');
    const bytes = encoded.subarray(offset, offset + chunkView.chunkBytes);
    return { sha256: chunkView.sha256, index, offset, bytes: bytes.length, dataBase64: btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')) };
  }

  window.__hyreadWorkflow = Object.freeze({ version: 1, describe, start, status: () => clone(state),
    cancel: () => { if (state.state === 'running') cancelled = true; return clone(state); }, exportInfo, readChunk,
    clear: () => { if (pendingNavigation || settlingRecovery) throw new Error('Unconfirmed reader navigation prevents clear'); if (state.state === 'running') throw new Error('Workflow already running'); output = null; encoded = null; encodedSha = null; chunkView = null; session = null; settings = null; recoveryOrigin = null; state = emptyStatus(); return clone(state); } });
})();
