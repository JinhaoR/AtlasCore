/** Presentation scroll ownership follows the active CSS layout. Narrow/short
 * layouts retain document scrolling; no authority or persisted schema changes. */
export function viewportScrollSurface(page, sitesView) {
    const ids = page === 'home' ? []
        : page === 'sites' ? sitesView === 'review' ? ['destination-draft-items'] : sitesView === 'detail' ? ['sites-editor'] : ['sites-categories', 'sites-list']
            : page === 'settings' ? ['settings-workspace'] : page === 'vault' ? ['vault-contents'] : ['pending-access-list'];
    for (const id of [...ids, 'main-content']) {
        const node = document.getElementById(id);
        if (node && !node.closest('[hidden]') && node.clientHeight > 0 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY))
            return node;
    }
    return (document.scrollingElement ?? document.documentElement);
}
