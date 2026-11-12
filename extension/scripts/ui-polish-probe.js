// Disposable native instrumentation only. No message payloads or URLs retained.
window.__polish = { frames: [], costs: {}, calls: {}, resources: 0, forceStatus: null };
const p = window.__polish;
const send = browser.runtime.sendMessage.bind(browser.runtime);
browser.runtime.sendMessage = async function (m, ...args) {
  p.calls[m.kind] = (p.calls[m.kind] || 0) + 1;
  const r = await send(m, ...args);
  if (m.kind === 'GET_VIEW' && p.forceStatus && r?.view?.controller) r.view.controller.status = p.forceStatus;
  if (m.kind === 'GET_VIEW' && p.accessMinutes != null && r?.view) {
    const now = Date.now();
    r.view.pendingAccess = [{ requestId: 12345, hostnames: ['waiting.example'], readyAt: now + p.accessMinutes * 60000, confirmBy: now + 40000000 }];
  }
  return r;
};
const rect = id => {
  const e = document.getElementById(id);
  if (!e || !e.getClientRects().length) return null;
  const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v));
};
let key = '';
function frame() {
  const sample = { search: rect('search-form'), pins: rect('pinned-list'), footer: rect('customize-home'),
    categories: document.querySelectorAll('.category-shortcut').length,
    cards: document.querySelectorAll('#destination-list .destination-card').length,
    pinsCount: document.querySelectorAll('#pinned-primary .compass-pin').length,
    page: document.body?.dataset.page, fonts: document.fonts.status, phase: document.getElementById('destinations')?.dataset.phase };
  const next = JSON.stringify(sample);
  if (next !== key) { p.frames.push({ at: Math.round(performance.now()), ...sample }); key = next; }
  if (performance.now() < 1500) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
