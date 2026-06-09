// hyread/browser/capture-decrypted.js
//
// 步骤 3（浏览器手动）：在 HyRead 在线阅读器页面抓取解密后的正文。
//
// 背景：HyRead 的正文 xhtml 是加密的，阅读器靠 wasm 在客户端解密后注入 iframe。
// 明文只存在于运行时，本脚本驱动阅读器逐章翻页，用 XMLSerializer 抓取每个
// spine 解密后的良构 XHTML，最后自动下载为 grab_xml.json。
//
// 用法：
//   1. 在浏览器打开该卷的 HyRead 阅读器（openbook2.jsp，确认正文已显示）；
//   2. 打开 devtools Console，整段粘贴本文件内容并回车；
//   3. 脚本会自动从头翻到尾抓取，结束后浏览器下载 grab_xml.json；
//   4. 把 grab_xml.json 放到 hyread/work/<卷>/grab_xml.json，继续步骤 4。
//
// 说明：纯运行时操作，不修改账号/书籍数据；跑完阅读位置可能停在书末，自行翻回即可。

(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reader = window.__HyRead__ && window.__HyRead__.reader;
  if (!reader || typeof reader.turnToNextChapter !== 'function') {
    console.error('未找到 HyRead 阅读器实例（window.__HyRead__.reader）。请在 openbook2.jsp 阅读器页面运行。');
    return;
  }

  const fiberKey = (el) =>
    Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));

  // 当前页 = 可见且 opacity 最高的 iframe
  const getCurFrame = () => {
    let cur = null, best = -1;
    document.querySelectorAll('iframe').forEach((f) => {
      const cs = getComputedStyle(f);
      const r = f.getBoundingClientRect();
      const score = ((r.x >= -50 && r.x < innerWidth && r.width > 0) ? 1000 : 0) + parseFloat(cs.opacity || '0');
      if (score > best) { best = score; cur = f; }
    });
    return cur;
  };

  // 从 iframe 的 React fiber 取该 spine 的源 URL（用于精确归档文件名）
  const getSrc = (f) => {
    if (!f) return null;
    const k = fiberKey(f);
    if (!k) return null;
    let fib = f[k], d = 0;
    while (fib && d < 25) {
      const it = fib.memoizedProps && fib.memoizedProps.item;
      if (it && typeof it.src === 'string' && /\.xhtml/i.test(it.src)) return it.src;
      fib = fib.return; d++;
    }
    return null;
  };

  // 1. 回到书首
  console.log('回到书首…');
  let prev = getSrc(getCurFrame()), same = 0;
  for (let k = 0; k < 60; k++) {
    reader.turnToPrevChapter();
    await sleep(450);
    const s = getSrc(getCurFrame());
    if (s === prev) { if (++same >= 2) break; } else same = 0;
    prev = s;
  }

  // 2. 逐章往后抓取（XMLSerializer 输出良构 XHTML）
  console.log('开始逐章抓取…');
  const data = {}, order = [];
  let prevSrc = null; same = 0;
  for (let n = 0; n < 600; n++) {
    const f = getCurFrame();
    const src = getSrc(f);
    if (src && !(src in data)) {
      try {
        data[src] = new XMLSerializer().serializeToString(f.contentDocument);
        order.push(src);
        console.log(`  [${order.length}] ${src.split('/item/')[1]}  (${data[src].length} 字符)`);
      } catch (e) {
        console.warn('  序列化失败:', src, e.message);
      }
    }
    if (src === prevSrc) { if (++same >= 2) break; } else same = 0;
    prevSrc = src;
    reader.turnToNextChapter();
    await sleep(650);
  }

  // 3. 下载 grab_xml.json
  const blob = new Blob([JSON.stringify({ order, data })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'grab_xml.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  console.log(`✓ 完成：抓取 ${order.length} 个 spine，已下载 grab_xml.json`);
})();
