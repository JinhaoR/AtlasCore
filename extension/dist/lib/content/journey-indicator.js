import { countdown } from '../ui/presentation.js';
// Display only, in the isolated content-script world. No page events call Core commands.
let host = null;
let label = null;
let time = null;
let timer;
let lease;
let epoch = 0;
function clear() {
    host?.remove();
    host = null;
    label = null;
    time = null;
    clearTimeout(timer);
    timer = undefined;
    clearTimeout(lease);
    lease = undefined;
}
function show(input) {
    if (input === null || typeof input !== 'object' || !('journeyId' in input)
        || !Number.isSafeInteger(input.journeyId) || !('destinationLabel' in input) || typeof input.destinationLabel !== 'string'
        || !('expiresAt' in input) || typeof input.expiresAt !== 'number' || !Number.isSafeInteger(input.expiresAt)
        || Date.now() >= input.expiresAt || !document.documentElement) {
        clear();
        return;
    }
    if (!host) {
        host = document.createElement('div');
        host.id = 'atlas-journey-indicator';
        host.style.cssText = 'all:initial!important;position:fixed!important;right:12px!important;bottom:12px!important;z-index:2147483647!important;pointer-events:none!important;max-width:calc(100vw - 24px)!important;';
        const shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = ':host{color-scheme:light}div{display:flex;gap:8px;align-items:center;max-width:320px;padding:7px 11px;border:1px solid #d7d0c3;border-radius:20px;background:#faf7f0;color:#405b46;box-shadow:0 1px 5px #0001;font:12px/1.4 system-ui,sans-serif}span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}span:last-child{flex-shrink:0;font-variant-numeric:tabular-nums}';
        const pill = document.createElement('div');
        pill.setAttribute('aria-label', 'Atlas Journey');
        label = document.createElement('span');
        time = document.createElement('span');
        pill.append(label, time);
        shadow.append(style, pill);
        document.documentElement.append(host);
    }
    host.dataset.journeyId = String(input.journeyId);
    const copy = `Atlas Journey · ${input.destinationLabel}`;
    if (label.textContent !== copy)
        label.textContent = copy;
    const remaining = countdown(input.expiresAt, Date.now());
    if (time.textContent !== remaining)
        time.textContent = remaining;
    clearTimeout(timer);
    timer = setTimeout(() => { void refresh(); }, 1000);
    // A hung/disconnected background cannot leave an apparently live Journey behind.
    clearTimeout(lease);
    lease = setTimeout(() => { ++epoch; clear(); }, Math.min(2000, input.expiresAt - Date.now()));
}
async function refresh() {
    const observed = ++epoch;
    try {
        const response = await browser.runtime.sendMessage({ kind: 'GET_JOURNEY_DISPLAY' });
        if (observed === epoch)
            show(response?.presentation ?? null);
    }
    catch {
        if (observed === epoch)
            clear();
    }
}
browser.runtime.onMessage.addListener((input, sender) => {
    if (sender.id !== browser.runtime.id || input === null || typeof input !== 'object'
        || !('kind' in input) || input.kind !== 'ATLAS_JOURNEY_DISPLAY')
        return;
    ++epoch;
    show('presentation' in input ? input.presentation : null);
});
window.addEventListener('pagehide', () => { ++epoch; clear(); });
window.addEventListener('pageshow', () => { void refresh(); });
if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => { void refresh(); }, { once: true });
else
    void refresh();
