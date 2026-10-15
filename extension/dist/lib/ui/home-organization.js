import { setAttribute, setProperty } from './dom.js';
import { reconcileHomeLayout } from './home-layout.js';
import { openHomeLayoutRepository } from './home-layout-storage.js';
import { HomeLayoutSession } from './home-layout-session.js';
import { renderFeedback } from './feedback.js';
const el = (id) => document.getElementById(id);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** One presentation surface; successful writes alone change the Home arrangement. */
export function initializeHomeOrganization(changed, repository = () => openHomeLayoutRepository()) {
    let session = null, catalog = [], verified = false;
    let failed = false, opening = false, disposed = false, rowsKey = '';
    let storage = null;
    let deferredFocus = null;
    let deferredHeading = null;
    async function open() {
        if (opening || disposed)
            return;
        opening = true;
        try {
            storage = await repository();
            if (disposed) {
                storage.close();
                return;
            }
            session = new HomeLayoutSession(storage, () => { if (!disposed)
                changed(); });
            failed = false;
            if (verified)
                await session.refresh(catalog);
        }
        catch {
            failed = true;
        }
        finally {
            opening = false;
            changed();
        }
    }
    function observe(next, available) {
        verified = available;
        if (!same(catalog, next)) {
            catalog = next;
            if (available)
                void session?.refresh(catalog);
        }
        else if (available && session?.saved === null && !session.busy && !session.failure)
            void session.refresh(catalog);
    }
    const layout = () => session?.current() ?? reconcileHomeLayout(null, catalog);
    async function change(key, action) {
        if (!session)
            return;
        await session.change(key, action);
        changed();
    }
    function close() {
        setProperty(el('home-customization'), 'hidden', true);
        setAttribute(el('customize-home'), 'aria-expanded', 'false');
        el('customize-home').focus({ preventScroll: true });
    }
    function render() {
        const focus = document.activeElement;
        const focusCategory = focus?.closest('[data-layout-category]')?.dataset.layoutCategory;
        const focusAction = focus?.dataset.layoutAction;
        const headingCategory = focus?.classList.contains('category-heading') ? focus.closest('[data-category-key]')?.dataset.categoryKey : undefined;
        const working = session?.requested() ?? layout(), available = new Map(catalog.map(c => [c.key, c]));
        const categories = working.categories.filter(c => available.has(c.key));
        const key = JSON.stringify(categories);
        if (key !== rowsKey) {
            rowsKey = key;
            const list = el('home-layout-list'), focus = document.activeElement;
            const category = focus?.closest('[data-layout-category]')?.dataset.layoutCategory;
            const action = focus?.dataset.layoutAction;
            const existing = new Map([...list.children].map(n => [n.dataset.layoutCategory, n]));
            const rows = categories.map(c => {
                const row = existing.get(c.key) ?? document.createElement('li');
                setProperty(row.dataset, 'layoutCategory', c.key);
                if (!row.children.length) {
                    const label = document.createElement('label');
                    label.className = 'checkbox-label';
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    setProperty(checkbox.dataset, 'layoutAction', 'VISIBILITY');
                    checkbox.addEventListener('change', () => void change(row.dataset.layoutCategory, 'VISIBILITY'));
                    const name = document.createElement('span');
                    name.className = 'layout-category-name';
                    label.append(checkbox, name);
                    const controls = document.createElement('span');
                    controls.className = 'layout-order-actions';
                    for (const direction of ['UP', 'DOWN']) {
                        const button = document.createElement('button');
                        button.type = 'button';
                        button.className = 'secondary compact';
                        setProperty(button, 'textContent', direction === 'UP' ? '↑' : '↓');
                        setProperty(button.dataset, 'layoutAction', direction);
                        button.addEventListener('click', () => void change(row.dataset.layoutCategory, direction));
                        controls.append(button);
                    }
                    row.append(label, controls);
                }
                setProperty(row.querySelector('input'), 'checked', c.visible);
                setProperty(row.querySelector('.layout-category-name'), 'textContent', c.label);
                for (const button of row.querySelectorAll('button')) {
                    const name = `Move ${c.label} ${button.dataset.layoutAction === 'UP' ? 'up' : 'down'}`;
                    setAttribute(button, 'aria-label', name);
                    setProperty(button, 'title', name);
                }
                return row;
            });
            // Reordering existing nodes retains their identity; restore keyboard focus if
            // the browser blurs a moved node. Timer-only updates never enter this branch.
            list.replaceChildren(...rows);
            if (category && action)
                rows.find(r => r.dataset.layoutCategory === category)
                    ?.querySelector(`[data-layout-action="${action}"]`)?.focus({ preventScroll: true });
        }
        const locked = !session?.saved || session.busy || session.conflict || session.failure === 'UNAVAILABLE';
        if (locked && session?.busy) {
            if (focusCategory && focusAction)
                deferredFocus = { category: focusCategory, action: focusAction };
            if (headingCategory)
                deferredHeading = headingCategory;
        }
        for (const [index, row] of [...el('home-layout-list').children].entries()) {
            const category = available.get(row.dataset.layoutCategory);
            setProperty(row, 'title', `${category?.count ?? 0} allowed destinations${category?.count === 0 ? ' · no Home row while empty' : ''}`);
            for (const input of row.querySelectorAll('input'))
                setProperty(input, 'disabled', locked);
            for (const button of row.querySelectorAll('button'))
                setProperty(button, 'disabled', locked
                    || button.dataset.layoutAction === 'UP' && index === 0 || button.dataset.layoutAction === 'DOWN' && index === categories.length - 1);
        }
        const draft = session?.draft != null;
        setProperty(el('customize-home'), 'textContent', draft && !session?.busy ? 'Customize Home · unsaved' : 'Customize Home');
        const unavailable = failed || session?.failure === 'UNAVAILABLE';
        const message = session?.conflict ? 'Another Atlas page saved a newer layout. Your arrangement is retained here. Load the saved layout before making further changes.'
            : unavailable ? 'Home preferences could not be verified. Saved policy is unaffected. Retry loading preferences.'
                : session?.failure ? 'Your arrangement is not verified as saved. It is retained in this page; retry before closing the page. Home still uses the acknowledged layout.'
                    : session?.busy ? session.draft ? 'Saving Home layout…' : 'Loading Home preferences…'
                        : draft ? 'Your arrangement is awaiting a verified save. Home still uses the acknowledged layout.'
                            : session?.saved ? 'Home layout saved. Hidden categories remain in Sites & Access; pins and search are unchanged.'
                                : 'Loading Home preferences…';
        renderFeedback(el('home-layout-status'), { message, tone: session?.conflict || session?.failure || failed ? 'error' : 'status' });
        setProperty(el('home-layout-warning'), 'hidden', !unavailable && !session?.failure && !session?.conflict);
        setProperty(el('home-layout-warning'), 'textContent', message);
        setProperty(el('retry-home-layout'), 'hidden', !failed && !session?.failure);
        setProperty(el('retry-home-layout'), 'disabled', opening || session?.busy === true || session?.conflict === true);
        setProperty(el('load-saved-home-layout'), 'hidden', !session?.conflict);
        setProperty(el('load-saved-home-layout'), 'disabled', session?.busy === true);
        setProperty(el('home-layout-empty'), 'hidden', categories.length > 0);
        for (const heading of document.querySelectorAll('.category-heading'))
            setProperty(heading, 'disabled', locked);
        if (!locked) {
            // Firefox blurs a button when a save temporarily disables it. Return focus
            // only if it fell to body, so an explicit move or panel close wins.
            if (document.activeElement === document.body) {
                if (deferredFocus && !el('home-customization').closest('[hidden]')) {
                    const row = [...el('home-layout-list').children].find(n => n.dataset.layoutCategory === deferredFocus.category);
                    const target = row?.querySelector(`[data-layout-action="${deferredFocus.action}"]`);
                    (target?.disabled ? row?.querySelector('input') : target)?.focus({ preventScroll: true });
                }
                else if (deferredHeading)
                    [...document.querySelectorAll('.category-heading')]
                        .find(h => h.closest('[data-category-key]')?.dataset.categoryKey === deferredHeading && !h.closest('[hidden]'))?.focus({ preventScroll: true });
            }
            deferredFocus = null;
            deferredHeading = null;
        }
    }
    el('customize-home').addEventListener('click', () => {
        setProperty(el('home-customization'), 'hidden', false);
        setAttribute(el('customize-home'), 'aria-expanded', 'true');
        render();
        el('home-customization').focus({ preventScroll: false });
    });
    el('close-home-customization').addEventListener('click', close);
    el('home-customization').addEventListener('keydown', event => { if (event.key === 'Escape') {
        event.preventDefault();
        close();
    } });
    el('retry-home-layout').addEventListener('click', () => {
        void (async () => {
            if (!session)
                await open();
            else
                await session.retry(catalog);
            changed();
        })();
    });
    el('load-saved-home-layout').addEventListener('click', () => {
        if (window.confirm('Load the newer saved Home layout? The unsaved arrangement in this page will be discarded. Policy, destinations and pins will remain.'))
            void session?.useSaved(catalog).then(changed);
    });
    window.addEventListener('pagehide', () => { disposed = true; storage?.close(); });
    const initialized = open();
    return { observe, layout, render, change, initialized, refresh: () => verified ? session?.refresh(catalog) : undefined, session: () => session };
}
