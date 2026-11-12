import { savePresentation, type PresentationSaveResult } from './presentation-storage.js';
import { themeText } from './ui-text.js';

/** Closed, bundled presentation IDs. A value from storage can never become a URL or CSS. */
export const themeIds = ['default', 'light-test', 'celestial', 'parchment'] as const;
export type ThemeId = typeof themeIds[number];
export const themeKey = 'atlas-theme-v1';
type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function themeId(value: unknown): ThemeId {
  return themeIds.find(id => id === value) ?? 'default';
}
export function readTheme(storage: () => ThemeStorage): { theme: ThemeId; available: boolean } {
  try { return { theme: themeId(storage().getItem(themeKey)), available: true }; }
  catch { return { theme: 'default', available: false }; }
}
export function saveTheme(storage: () => ThemeStorage, value: unknown): PresentationSaveResult {
  if (!themeIds.some(id => id === value)) return 'FAILED';
  return savePresentation(storage, themeKey, value as ThemeId);
}

/** Runs before styles/content. Native storage events are sufficient for this scalar
 * preference; there is no polling, policy request, component render or icon work. */
export function initializeTheme(doc: Document, win: Window, storage = () => win.localStorage): () => void {
  const initial = readTheme(storage);
  let saved = initial.theme;
  let draft: ThemeId | null = null;
  let message = initial.available ? '' : themeText.unavailable;
  function apply() {
    if (doc.documentElement.dataset.theme !== saved) doc.documentElement.dataset.theme = saved;
  }
  function controls() {
    const select = doc.getElementById('atlas-theme') as HTMLSelectElement | null;
    if (select && select.value !== (draft ?? saved)) select.value = draft ?? saved;
    const status = doc.getElementById('theme-save-status');
    if (status && status.textContent !== message) status.textContent = message;
    const retry = doc.getElementById('theme-retry');
    if (retry) retry.hidden = draft === null;
  }
  function save() {
    if (draft === null) return;
    const outcome = saveTheme(storage, draft);
    if (outcome === 'SAVED') { saved = draft; draft = null; message = ''; apply(); }
    else message = outcome === 'FAILED' ? themeText.failed : themeText.uncertain;
    controls();
  }
  function change(event: Event) {
    const target = event.target as HTMLSelectElement | null;
    if (target?.id !== 'atlas-theme') return;
    draft = themeId(target.value);
    save();
  }
  function click(event: Event) {
    if ((event.target as HTMLElement | null)?.id === 'theme-retry') save();
  }
  function external(event: StorageEvent) {
    if (event.key !== themeKey && event.key !== null) return;
    // Ignore other storage areas and reread the current value, not an old queued event.
    try { if (event.storageArea !== storage()) return; } catch { return; }
    const current = readTheme(storage);
    if (!current.available) { message = themeText.readFailed; controls(); return; }
    saved = current.theme;
    if (draft !== null) message = themeText.otherWindow;
    else message = '';
    apply(); controls();
  }
  const ready = () => controls();
  const dispose = () => {
    doc.removeEventListener('DOMContentLoaded', ready);
    doc.removeEventListener('change', change);
    doc.removeEventListener('click', click);
    win.removeEventListener('storage', external);
    win.removeEventListener('pagehide', dispose);
  };
  apply(); controls();
  doc.addEventListener('DOMContentLoaded', ready, { once: true });
  doc.addEventListener('change', change);
  doc.addEventListener('click', click);
  win.addEventListener('storage', external);
  win.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}
