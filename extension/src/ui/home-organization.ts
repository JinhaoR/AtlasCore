import { setAttribute, setProperty } from './dom.js';
import { reconcileHomeLayout, type HomeCategory, type HomeLayoutAction } from './home-layout.js';
import { openHomeLayoutRepository, type HomeLayoutRepository } from './home-layout-storage.js';
import { HomeLayoutSession } from './home-layout-session.js';
import { renderFeedback } from './feedback.js';
import { categoryIconPicker } from './category-icon-picker.js';
import { icon } from './destination-cards.js';
import { CategoryIconSession, openCategoryIconRepository, defaultCategoryIcon } from './category-icons.js';
import { CategoryOrderSession, openCategoryOrderRepository, categoryOrderKeys, type CategoryOrderMode } from './category-order.js';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** One presentation surface; successful writes alone change the Home arrangement. */
export function initializeHomeOrganization(changed: () => void, repository = () => openHomeLayoutRepository()) {
  let session: HomeLayoutSession | null = null, catalog: readonly HomeCategory[] = [], verified = false;
  let failed = false, opening = false, disposed = false, rowsKey = '';
  let storage: HomeLayoutRepository | null = null;
  let ordering: CategoryOrderSession | null = null, orderFailed = false;
  async function openOrder(): Promise<void> {
    try {
      const repo = await openCategoryOrderRepository();
      if (disposed) { repo.close(); return; }
      ordering = new CategoryOrderSession(repo, changed); orderFailed = false; await ordering.refresh();
    } catch { orderFailed = true; }
    if (!disposed) changed();
  }
  const orderKeys = () => categoryOrderKeys(ordering?.saved?.value, catalog, layout());
  async function reorder(key: string, target: string, visible: readonly string[]): Promise<void> {
    if (!ordering) return;
    const next = [...visible], from = next.indexOf(key), to = next.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    next.splice(to, 0, next.splice(from, 1)[0]!);
    await ordering.change({ version: 1, mode: 'custom', keys: [...next, ...orderKeys().filter(k => !next.includes(k))], catalog: layout() });
  }
  let icons: CategoryIconSession | null = null, iconStorage: Awaited<ReturnType<typeof openCategoryIconRepository>> | null = null, iconOpenFailed = false, iconsOpening = false;
  const pickIcon = categoryIconPicker((key, value) => { void icons?.change(key, value); });
  async function openIcons(): Promise<void> {
    if (iconsOpening || disposed) return;
    iconsOpening = true;
    try {
      iconStorage = await openCategoryIconRepository();
      if (disposed) { iconStorage.close(); return; }
      icons = new CategoryIconSession(iconStorage, () => { if (!disposed) changed(); }); iconOpenFailed = false; await icons.refresh();
    } catch { iconOpenFailed = true; }
    finally { iconsOpening = false; if (!disposed) changed(); }
  }
  let deferredFocus: { category: string; action: string } | null = null;
  async function open(): Promise<void> {
    if (opening || disposed) return;
    opening = true;
    try {
      storage = await repository();
      if (disposed) { storage.close(); return; }
      session = new HomeLayoutSession(storage, () => { if (!disposed) changed(); }); failed = false;
      await session.refresh();
      if (disposed) return;
      if (verified) await session.refresh(catalog);
    } catch { failed = true; }
    finally { opening = false; changed(); }
  }
  function observe(next: readonly HomeCategory[], available: boolean): void {
    verified = available;
    if (!same(catalog, next)) {
      catalog = next;
      if (available) void session?.refresh(catalog);
    } else if (available && session?.saved === null && !session.busy && !session.failure) void session.refresh(catalog);
  }
  const layout = () => session?.current() ?? reconcileHomeLayout(null, catalog);
  async function change(key: string, action: HomeLayoutAction, completeDirectory = false): Promise<void> {
    if (!session) return;
    const visible = layout().categories.filter(c => (completeDirectory || c.visible) && catalog.some(item => item.key === c.key && (completeDirectory ? item.members.length > 0 : item.count > 0))).map(c => c.key);
    await session.change(key, action, typeof action === 'object' ? visible : undefined); changed();
  }
  function render(): void {
    const sort = el<HTMLSelectElement>('sites-category-order');
    setProperty(sort, 'value', ordering?.saved?.value?.mode ?? 'custom');
    setProperty(sort, 'disabled', !ordering?.saved || ordering.busy || ordering.conflict || !!ordering.failure || !!ordering.draft);
    const orderIssue = orderFailed || !!ordering?.failure || !!ordering?.conflict;
    setProperty(el('category-order-error'), 'hidden', !orderIssue);
    setProperty(el('category-order-message'), 'textContent', ordering?.conflict
      ? 'Another window saved a newer order. Your change is retained; load the saved order to reconcile.'
      : 'Category order could not be saved or verified. Your change is retained; retry.');
    setProperty(el('retry-category-order'), 'hidden', !!ordering?.conflict);
    setProperty(el('reload-category-order'), 'hidden', !ordering?.conflict);
    const focus = document.activeElement as HTMLElement | null;
    const focusCategory = focus?.closest<HTMLElement>('[data-layout-category]')?.dataset.layoutCategory;
    const focusAction = focus?.dataset.layoutAction;
    const working = session?.requested() ?? layout(), available = new Map(catalog.map(c => [c.key, c]));
    const categories = working.categories.filter(c => available.has(c.key));
    const iconChoices = icons?.draft ?? icons?.saved?.value;
    const key = JSON.stringify([categories, iconChoices]);
    if (key !== rowsKey) {
      rowsKey = key;
      const list = el('home-layout-list'), focus = document.activeElement as HTMLElement | null;
      const category = focus?.closest<HTMLElement>('[data-layout-category]')?.dataset.layoutCategory;
      const action = focus?.dataset.layoutAction;
      const existing = new Map([...list.children].map(n => [(n as HTMLElement).dataset.layoutCategory, n as HTMLElement]));
      const rows = categories.map(c => {
        const row = existing.get(c.key) ?? document.createElement('li'); setProperty(row.dataset, 'layoutCategory', c.key);
        if (!row.children.length) {
          const label = document.createElement('span'); label.className = 'layout-category-name';
          const choice = document.createElement('button'); choice.type = 'button'; choice.className = 'category-icon-choice'; choice.dataset.layoutAction = 'ICON';
          choice.setAttribute('aria-haspopup', 'dialog'); choice.append(icon('category'));
          choice.addEventListener('click', () => pickIcon(choice, row.dataset.layoutCategory!, choice.dataset.icon ?? ''));
          row.append(choice, label);
        }
        setProperty(row.querySelector<HTMLElement>('.layout-category-name')!, 'textContent', c.label);
        const chosenIcon = iconChoices?.entries.find(e => e.key === c.key)?.icon;
        setAttribute(row.querySelector('use')!, 'href', `#icon-${chosenIcon ?? defaultCategoryIcon(c.label)}`);
        const picker = row.querySelector<HTMLButtonElement>('.category-icon-choice')!;
        setProperty(picker.dataset, 'icon', chosenIcon ?? '');
        setAttribute(picker, 'aria-label', `Choose icon for ${c.label}`);
        setProperty(picker, 'title', `Choose icon for ${c.label}`);
        return row;
      });
      // Reordering existing nodes retains their identity; restore keyboard focus if
      // the browser blurs a moved node. Timer-only updates never enter this branch.
      list.replaceChildren(...rows);
      if (category && action) rows.find(r => r.dataset.layoutCategory === category)
        ?.querySelector<HTMLElement>(`[data-layout-action="${action}"]`)?.focus({ preventScroll: true });
    }
    const locked = !session?.saved || session.busy || session.conflict || session.failure === 'UNAVAILABLE';
    if (locked && session?.busy || icons?.busy) {
      if (focusCategory && focusAction) deferredFocus = { category: focusCategory, action: focusAction };
    }
    for (const row of el('home-layout-list').children) {
      const category = available.get((row as HTMLElement).dataset.layoutCategory!);
      setProperty(row.querySelector<HTMLButtonElement>('.category-icon-choice')!, 'disabled', !icons?.saved || icons.busy || icons.conflict || icons.failure === 'UNAVAILABLE');
      setProperty((row as HTMLElement), 'title', `${category?.count ?? 0} allowed sites${category?.count === 0 ? ' · no Home row while empty' : ''}`);
      for (const input of row.querySelectorAll<HTMLInputElement>('input')) setProperty(input, 'disabled', locked);

    }
    const draft = session?.draft != null;
    const unavailable = failed || session?.failure === 'UNAVAILABLE';
    const message = session?.conflict ? 'Another Atlas page saved a newer layout. Your arrangement is retained here. Load the saved layout before making further changes.'
      : unavailable ? 'Home preferences could not be verified. Saved policy is unaffected. Retry loading preferences.'
      : session?.failure ? 'Your arrangement is not verified as saved. It is retained in this page; retry before closing the page. Home still uses the acknowledged layout.'
      : session?.busy ? session.draft ? 'Saving Home layout…' : 'Loading Home preferences…'
      : draft ? 'Your arrangement is awaiting a verified save. Home still uses the acknowledged layout.'
      : session?.saved ? 'Category order saved. Hidden categories remain in All sites and search; pins are unchanged.'
      : 'Loading Home preferences…';
    renderFeedback(el('home-layout-status'), { message: session?.conflict || session?.failure || failed ? message : '', tone: session?.conflict || session?.failure || failed ? 'error' : 'status' });
    setProperty(el('home-layout-warning'), 'hidden', !unavailable && !session?.failure && !session?.conflict);
    setProperty(el('home-layout-warning'), 'textContent', message);
    setProperty(el('retry-home-layout'), 'hidden', !failed && !session?.failure);
    setProperty(el<HTMLButtonElement>('retry-home-layout'), 'disabled', opening || session?.busy === true || session?.conflict === true);
    setProperty(el('load-saved-home-layout'), 'hidden', !session?.conflict);
    setProperty(el<HTMLButtonElement>('load-saved-home-layout'), 'disabled', session?.busy === true);
    setProperty(el('home-layout-empty'), 'hidden', categories.length > 0);
    const iconMessage = icons?.conflict ? 'Another Atlas page saved newer icons. Your choices are retained here. Load saved icons to reconcile.'
      : iconOpenFailed || icons?.failure === 'UNAVAILABLE' ? 'Category icons could not be loaded. Retry; saved order and access rules are unchanged.'
      : icons?.failure ? 'Icon changes are not verified as saved. Your choices are retained here; retry before closing.'
      : icons?.busy ? 'Saving category icon…' : icons?.saved ? 'Icons save automatically. Automatic uses the category name.' : 'Loading category icons…';
    renderFeedback(el('category-icon-status'), { message: icons?.conflict || icons?.failure || iconOpenFailed ? iconMessage : '', tone: iconOpenFailed || icons?.failure || icons?.conflict ? 'error' : 'status' });
    setProperty(el('retry-category-icons'), 'hidden', !iconOpenFailed && !icons?.failure);
    setProperty(el<HTMLButtonElement>('retry-category-icons'), 'disabled', iconsOpening || icons?.busy === true || icons?.conflict === true);
    setProperty(el('load-saved-category-icons'), 'hidden', !icons?.conflict);
    if (!locked && !icons?.busy) {
      // Firefox blurs a button when a save temporarily disables it. Return focus
      // only if it fell to body, so an explicit move or panel close wins.
      if (document.activeElement === document.body || document.activeElement === el('home-settings')) {
        if (deferredFocus && !el('home-settings').closest('[hidden]')) {
          const row = [...el('home-layout-list').children].find(n => (n as HTMLElement).dataset.layoutCategory === deferredFocus!.category);
          const target = row?.querySelector<HTMLInputElement | HTMLButtonElement>(`[data-layout-action="${deferredFocus.action}"]`);
          (target?.disabled ? row?.querySelector<HTMLInputElement>('input') : target)?.focus({ preventScroll: true });
        }
      }
      deferredFocus = null;
    }
  }
  el('retry-home-layout').addEventListener('click', () => { void (async () => {
    if (!session) await open(); else await session.retry(catalog); changed();
  })(); });
  el('load-saved-home-layout').addEventListener('click', () => {
    if (window.confirm('Load the newer saved Home layout? The unsaved arrangement in this page will be discarded. Policy, sites and pins will remain.'))
      void session?.useSaved(catalog).then(changed);
  });
  el('retry-category-icons').addEventListener('click', () => { void (icons ? icons.retry() : openIcons()); });
  el('load-saved-category-icons').addEventListener('click', () => {
    if (window.confirm('Discard these unsaved icon choices and load the newer saved icons?')) void icons?.useSaved();
  });
  window.addEventListener('pagehide', () => { disposed = true; storage?.close(); iconStorage?.close(); });
  el('sites-category-order').addEventListener('change', () => {
    const mode = el<HTMLSelectElement>('sites-category-order').value as CategoryOrderMode;
    void ordering?.change({ version: 1, mode, keys: orderKeys(), catalog: layout() });
  });
  el('retry-category-order').addEventListener('click', () => { void (ordering ? ordering.retry() : openOrder()); });
  el('reload-category-order').addEventListener('click', () => { void ordering?.useSaved(); });
  window.addEventListener('pagehide', () => ordering?.repository.close());
  const initialized = Promise.all([open(), openIcons(), openOrder()]);
  return { observe, layout, render, change, initialized,
    reorder, orderKeys, orderMode: () => ordering?.saved?.value?.mode ?? 'custom' as CategoryOrderMode,
    icon: (key: string, label: string) => icons?.icon(key, label) ?? defaultCategoryIcon(label),
    canMove: () => !!session?.saved && !session.busy && !session.conflict && !session.failure && !!ordering?.saved && !ordering.busy && !ordering.conflict && !ordering.draft && ordering.failure === null,
    loading: () => opening || (!session?.saved && !failed && !session?.failure),
    refresh: () => Promise.all([verified ? session?.refresh(catalog) : undefined, icons?.refresh(), ordering?.refresh()]), session: () => session };
}
