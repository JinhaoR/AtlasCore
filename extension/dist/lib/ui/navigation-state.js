import { validDestinationId } from './destination-metadata.js';
export const navigationStorageKey = 'atlas-page-navigation-v1';
export const emptySitesPosition = () => ({ selection: '', search: '', filter: 'ALL', scroll: 0 });
export const emptyNavigationState = () => ({ version: 1, tab: '', sites: emptySitesPosition(), pages: {} });
export function atlasPage(value) {
    return ['home', 'sites', 'settings', 'vault', 'access'].includes(value) ? value : null;
}
export function readNavigationState(input) {
    if (!input || typeof input !== 'object')
        return null;
    const s = input, p = s.sites;
    if (Object.keys(s).sort().join(',') !== 'pages,sites,tab,version' || s.version !== 1 || typeof s.tab !== 'string' || !/^\d{0,12}$/.test(s.tab) || !p
        || Object.keys(p).sort().join(',') !== 'filter,scroll,search,selection'
        || typeof p.selection !== 'string' || p.selection !== '' && !validDestinationId(p.selection)
        || typeof p.search !== 'string' || p.search.length > 1000 || !['ALL', 'WHITELIST', 'BLACKLIST', 'MIXED'].includes(p.filter)
        || !Number.isFinite(p.scroll) || p.scroll < 0 || !s.pages || typeof s.pages !== 'object' || Array.isArray(s.pages))
        return null;
    for (const [page, position] of Object.entries(s.pages)) {
        if (!atlasPage(page) || !position || Object.keys(position).sort().join(',') !== 'focus,scroll' || !Number.isFinite(position.scroll) || position.scroll < 0
            || typeof position.focus !== 'string' || position.focus.length > 100)
            return null;
    }
    return structuredClone(s);
}
/** Per control page only; editable destination fields remain in Milestone B's shared workspace. */
export function navigationMemory(storage) {
    let current = emptyNavigationState();
    try {
        current = readNavigationState(JSON.parse(storage.getItem(navigationStorageKey) ?? 'null')) ?? current;
    }
    catch { /* Session memory is optional. */ }
    return {
        value: () => current,
        save(value) {
            const checked = readNavigationState(value);
            if (!checked)
                return;
            current = checked;
            try {
                storage.setItem(navigationStorageKey, JSON.stringify(checked));
            }
            catch { /* In-page context remains; no authority or editor work is stored here. */ }
        },
    };
}
