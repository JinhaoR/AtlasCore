/* Disposable native fixture only. Never copied into source or release assets. */
(() => {
  const late = new URLSearchParams(location.search).get('atlasFixture') === 'late-offline';
  let delayed = false;
  const p = window.__startupProbe = { started: performance.now(), mode: late ? 'offline' : 'slow', requests: [], messages: [], frames: [], assignments: 0, readyAt: null, cardsAt: null, fontsAt: null };
  const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', { ...src, set(value) { if (this.classList.contains('site-icon')) p.assignments++; src.set.call(this, value); } });
  const send = browser.runtime.sendMessage.bind(browser.runtime);
  browser.runtime.sendMessage = m => { const start = performance.now(); return send(m).then(async r => { if(late && m.kind==='GET_VIEW' && !delayed){delayed=true;await new Promise(resolve=>setTimeout(resolve,650));} return r; }).then(r => { p.messages.push({ kind: m.kind, start, end: performance.now(),controller:r?.view?.controller?.status,startup:r?.view?.startup?.status }); return r; }); };
  const fetcher = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (!['http:', 'https:'].includes(u.protocol)) return fetcher(input, options);
    p.requests.push({ hostname: u.hostname, image: u.pathname.endsWith('.png'), at: performance.now(), credentials: options?.credentials });
    await new Promise(resolve => setTimeout(resolve, p.mode === 'slow' ? 450 : 50));
    if (p.mode === 'offline') throw new TypeError('Synthetic unavailable favicon');
    if (u.pathname.endsWith('.png')) {
      const data = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHysAAAAASUVORK5CYII='), c => c.charCodeAt(0));
      return new Response(data, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
    }
    return new Response('<head><link rel="icon" href="/atlas-fixture.png"></head>', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } });
  };
  document.addEventListener('DOMContentLoaded', () => document.fonts.ready.then(() => { p.fontsAt = performance.now(); }));
  const boxes = () => {
    const box = id => { const n = document.getElementById(id); if (!n || n.closest('[hidden]')) return null; const r = n.getBoundingClientRect(); return [r.x,r.y,r.width,r.height].map(v => Math.round(v)); };
    return { at: performance.now(), ready: document.getElementById('status')?.dataset.ready, phase: document.getElementById('destinations')?.dataset.phase,
      recoveryBanner: box('destination-state') !== null, categoryLabels: [...document.querySelectorAll('.category-shortcut span')].map(e=>e.textContent),
      cards: document.querySelectorAll('.destination-card').length, icons: document.querySelectorAll('.site-icon[src^="blob:"]').length, body: document.documentElement.scrollHeight, nav: box('atlas-sidebar'), hero: document.querySelector('.home-hero')?.getBoundingClientRect().height, pins: box('pinned-section'), category: box('category-workspace') };
  };
  const sample = () => { const b = boxes(); p.frames.push(b); if (b.ready === 'true' && p.readyAt === null) p.readyAt = b.at; if (b.cards && p.cardsAt === null) p.cardsAt = b.at; };
  document.addEventListener('DOMContentLoaded', () => { p.domAt = performance.now(); sample(); });
  const timer = setInterval(sample, 50); setTimeout(() => { clearInterval(timer); sample(); }, 4000);
})();
