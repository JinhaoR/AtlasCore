/** Layout preferences are local presentation data, separate from Atlas authority. */
export function initializeSidebar(toggle) {
    const key = 'atlas-sidebar-v1';
    let collapsed = false;
    try {
        collapsed = localStorage.getItem(key) === 'collapsed';
    }
    catch { /* Use the expanded layout. */ }
    const apply = () => {
        document.body.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Minimize sidebar');
        toggle.title = collapsed ? 'Expand sidebar' : 'Minimize sidebar';
    };
    apply();
    toggle.addEventListener('click', () => {
        collapsed = !collapsed;
        apply();
        try {
            localStorage.setItem(key, collapsed ? 'collapsed' : 'expanded');
        }
        catch {
            toggle.title += ' (for this page only)';
        }
    });
    window.addEventListener('storage', (event) => {
        if (event.storageArea !== localStorage || event.key !== key && event.key !== null)
            return;
        collapsed = event.newValue === 'collapsed';
        apply();
    });
    // The compact header hides the desktop toggle; keep its keyboard focus visible.
    window.matchMedia('(max-width: 700px)').addEventListener('change', (event) => {
        if (event.matches && document.activeElement === toggle)
            document.getElementById('show-home')?.focus();
    });
}
