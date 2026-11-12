import { savePresentation } from './presentation-storage.js';
import { themeText } from './ui-text.js';
/** Closed, bundled presentation IDs. A value from storage can never become a URL or CSS. */
export const themeIds = ['default', 'light-test', 'celestial', 'parchment'];
export const themeKey = 'atlas-theme-v1';
export function themeId(value) {
    return themeIds.find(id => id === value) ?? 'default';
}
export function readTheme(storage) {
    try {
        return { theme: themeId(storage().getItem(themeKey)), available: true };
    }
    catch {
        return { theme: 'default', available: false };
    }
}
export function saveTheme(storage, value) {
    if (!themeIds.some(id => id === value))
        return 'FAILED';
    return savePresentation(storage, themeKey, value);
}
/** Runs before styles/content. Native storage events are sufficient for this scalar
 * preference; there is no polling, policy request, component render or icon work. */
export function initializeTheme(doc, win, storage = () => win.localStorage) {
    const initial = readTheme(storage);
    let saved = initial.theme;
    let draft = null;
    let message = initial.available ? '' : themeText.unavailable;
    function apply() {
        if (doc.documentElement.dataset.theme !== saved)
            doc.documentElement.dataset.theme = saved;
    }
    function controls() {
        const select = doc.getElementById('atlas-theme');
        if (select && select.value !== (draft ?? saved))
            select.value = draft ?? saved;
        const status = doc.getElementById('theme-save-status');
        if (status && status.textContent !== message)
            status.textContent = message;
        const retry = doc.getElementById('theme-retry');
        if (retry)
            retry.hidden = draft === null;
    }
    function save() {
        if (draft === null)
            return;
        const outcome = saveTheme(storage, draft);
        if (outcome === 'SAVED') {
            saved = draft;
            draft = null;
            message = '';
            apply();
        }
        else
            message = outcome === 'FAILED' ? themeText.failed : themeText.uncertain;
        controls();
    }
    function change(event) {
        const target = event.target;
        if (target?.id !== 'atlas-theme')
            return;
        draft = themeId(target.value);
        save();
    }
    function click(event) {
        if (event.target?.id === 'theme-retry')
            save();
    }
    function external(event) {
        if (event.key !== themeKey && event.key !== null)
            return;
        // Ignore other storage areas and reread the current value, not an old queued event.
        try {
            if (event.storageArea !== storage())
                return;
        }
        catch {
            return;
        }
        const current = readTheme(storage);
        if (!current.available) {
            message = themeText.readFailed;
            controls();
            return;
        }
        saved = current.theme;
        if (draft !== null)
            message = themeText.otherWindow;
        else
            message = '';
        apply();
        controls();
    }
    const ready = () => controls();
    const dispose = () => {
        doc.removeEventListener('DOMContentLoaded', ready);
        doc.removeEventListener('change', change);
        doc.removeEventListener('click', click);
        win.removeEventListener('storage', external);
        win.removeEventListener('pagehide', dispose);
    };
    apply();
    controls();
    doc.addEventListener('DOMContentLoaded', ready, { once: true });
    doc.addEventListener('change', change);
    doc.addEventListener('click', click);
    win.addEventListener('storage', external);
    win.addEventListener('pagehide', dispose, { once: true });
    return dispose;
}
