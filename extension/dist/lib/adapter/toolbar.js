export const controlPages = ['home', 'sites', 'access', 'vault', 'settings'];
export function toolbarRequest(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return false;
    const v = input;
    if (!Number.isSafeInteger(v.tabId) || v.tabId < 0)
        return false;
    if (v.kind === 'GET_TOOLBAR_STATUS')
        return Object.keys(v).sort().join(',') === 'kind,tabId';
    return v.kind === 'OPEN_CONTROL_PAGE' && Object.keys(v).sort().join(',') === 'contextId,kind,page,tabId'
        && controlPages.includes(v.page)
        && (v.contextId === null || typeof v.contextId === 'string' && v.contextId.length <= 200);
}
