import type { ToolbarStatus, ControlPage } from '../adapter/toolbar.js';
import { accessCopy, countdown } from './presentation.js';
import { RefreshLoop } from './refresh-loop.js';
import { setProperty } from './dom.js';
const el = (id: string) => document.getElementById(id)!;
let tabId: number | null = null, status: ToolbarStatus | null = null, disposed = false;
function render() {
  const now = Date.now();
  setProperty(el('popup-status'), 'textContent', status?.ready ? 'Atlas is ready' : 'Access cannot currently be verified');
  setProperty(el('popup-host'), 'textContent', status?.hostname ?? 'No website selected');
  setProperty(el('popup-access'), 'textContent', !status?.ready ? 'Open Settings to check or recover saved state.'
    : !status.hostname ? 'Atlas does not manage this browser page.' : status.decision ? accessCopy(status.decision).title : 'Checking this site…');
  const journey = status?.ready && status.journey && status.journey.expiresAt > now ? status.journey : null;
  setProperty(el('popup-journey'), 'textContent', journey ? `Journey to ${journey.hostname} · ${countdown(journey.expiresAt, now)} remaining · temporary navigation path` : '');
  setProperty(el('popup-journey'), 'hidden', !journey);
  const decision=status?.ready ? status.decision : null;
  const timing=decision?.outcome==='WAIT' ? (now<decision.readyAt ? `Waiting · ${countdown(decision.readyAt,now)} remaining` : now<decision.confirmBy ? `Confirmation available · ${countdown(decision.confirmBy,now)} to confirm` : 'Request expired')
    : decision?.outcome==='REQUIRE_CONFIRMATION' ? (now<decision.confirmBy ? `${countdown(decision.confirmBy,now)} to confirm` : 'Request expired')
      : decision?.outcome==='ALLOW' && decision.reason==='ACTIVE_GRANT' ? (now<decision.expiresAt ? `Temporary access · ${countdown(decision.expiresAt,now)} remaining` : 'Temporary access expired') : '';
  setProperty(el('popup-timing'),'textContent',timing);setProperty(el('popup-timing'),'hidden',!timing);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-page]')) b.disabled = tabId === null || b.dataset.page === 'access' && !status?.contextId;
}
const loop = new RefreshLoop(async () => {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? null;
    const response = tabId === null ? null : await browser.runtime.sendMessage({ kind: 'GET_TOOLBAR_STATUS', tabId });
    if (disposed) return; status = response?.status ?? null;
  } catch { status = null; }
  if (!disposed) render();
}, { delay: () => 1000 });
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-page]')) b.addEventListener('click', async () => {
  if (tabId === null) return;
  try {
    const r = await browser.runtime.sendMessage({ kind: 'OPEN_CONTROL_PAGE', page: b.dataset.page as ControlPage, tabId, contextId: status?.contextId ?? null });
    if (r?.opened) window.close(); else el('popup-error').textContent = 'That tab is no longer available. Reopen Atlas to choose a site.';
  } catch { el('popup-error').textContent = 'Could not open Atlas. Please try again.'; }
});
document.addEventListener('visibilitychange', () => loop.setActive(!document.hidden));
addEventListener('pagehide', () => { disposed = true; loop.dispose(); });
loop.setActive(!document.hidden);
