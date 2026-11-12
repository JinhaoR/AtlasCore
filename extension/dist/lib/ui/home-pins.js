import { uiText } from './ui-text.js';
import { destinationId, pinnedDestinations } from './home-model.js';
import { bookmarkPages, BookmarkSession, defaultBookmarkPages } from './home-bookmarks.js';
import { icon } from './destination-cards.js';
import { categoryIconPicker } from './category-icon-picker.js';
import { remoteBookmarks, presentationView, presentationCommand } from './presentation-client.js';
import { initializeBookmarkEditor } from './bookmark-editor.js';
import { reconcileChildren, setAttribute, setProperty } from './dom.js';
import { angularMotion, coastRotation } from './compass-motion.js';
// One ring with fixed targets; capacity is checked in the native compact Home suite.
export const compassCapacity = 10;
const el = (id) => document.getElementById(id);
/** Pin DOM, local chooser/gesture and bookmark editor. No authorization cache. */
export function initializeHomePins(options) {
    const nodes = new Map(), chooserRows = new Map();
    const chooser = el('pin-chooser'), primary = el('pinned-primary');
    const handle = el('compass-handle');
    let session = null, editor = null;
    let entries = [], pins = [], active = [];
    let available = false, pinEnabled = false, opening = null, failed = false, disposed = false;
    let selected = null, keyboardOpened = false;
    let hover, leaving;
    let angle = 0, gesture = null;
    let coast = 0, paint = 0;
    const schedulePaint = () => { if (!paint)
        paint = requestAnimationFrame(() => { paint = 0; placePins(); }); };
    let iconEdit = null;
    async function saveFolderIcon() {
        const edit = iconEdit;
        if (!edit)
            return;
        setProperty(el('retry-folder-icon'), 'disabled', true);
        try {
            await presentationCommand({ kind: 'FOLDER_ICON', ...edit });
            if (iconEdit === edit)
                iconEdit = null;
            el('pin-folder-error').textContent = '';
            el('retry-folder-icon').hidden = true;
            changed();
        }
        catch (error) {
            openChooser(`folder:${edit.id}`, true);
            const conflict = error instanceof Error && error.message === 'CONFLICT';
            el('pin-folder-error').textContent = conflict ? 'This icon changed in another Atlas window. Choose again to replace the current icon.' : 'Icon not saved. Your choice is kept; retry when storage is available.';
            el('retry-folder-icon').hidden = conflict;
        }
        finally {
            setProperty(el('retry-folder-icon'), 'disabled', false);
        }
    }
    const pickFolderIcon = categoryIconPicker((id, value) => {
        iconEdit = { id, icon: value, before: presentationView()?.sync.folderIcons?.[id] ?? '' };
        void saveFolderIcon();
    }, 'Folder icon');
    const composition = el('compass-handle').closest('.compass-composition');
    const moving = (value) => setProperty(composition.dataset, 'moving', String(value));
    const stopCoast = () => { cancelAnimationFrame(coast); coast = 0; moving(gesture?.moved ?? false); };
    let suppressClick = false;
    const clearHover = () => { clearTimeout(hover); clearTimeout(leaving); hover = leaving = undefined; };
    const changed = () => { if (!disposed) {
        render();
        options.changed();
    } };
    function load() {
        if (opening)
            return opening;
        opening = (async () => {
            try {
                const repository = remoteBookmarks;
                if (disposed) {
                    repository.close();
                    return;
                }
                session = new BookmarkSession(repository, changed);
                editor = initializeBookmarkEditor(session, options.togglePin, url => launch(url));
                failed = false;
                await session.refresh();
            }
            catch {
                failed = true;
            }
            finally {
                opening = null;
                changed();
            }
        })();
        return opening;
    }
    const launch = (url) => { if (available && session?.saved && session.failure !== 'UNAVAILABLE' && !failed)
        void options.open(url); };
    function closeChooser(restore = false) {
        clearHover();
        const selectedNode = selected ? nodes.get(selected)?.node : null;
        const trigger = selectedNode?.isConnected ? selectedNode : nodes.get('overflow')?.node;
        if (chooser.matches(':popover-open'))
            chooser.hidePopover();
        if (trigger)
            setAttribute(trigger, 'aria-expanded', 'false');
        selected = null;
        if (restore)
            (trigger?.isConnected && !trigger.disabled ? trigger : handle).focus({ preventScroll: true });
    }
    function positionChooser() {
        const selectedNode = selected ? nodes.get(selected)?.node : null;
        const trigger = selectedNode?.isConnected ? selectedNode : nodes.get('overflow')?.node;
        if (!trigger)
            return;
        const rect = trigger.getBoundingClientRect(), box = chooser.getBoundingClientRect();
        chooser.style.left = `${Math.max(12, Math.min(innerWidth - box.width - 12, rect.left + rect.width / 2 - box.width / 2))}px`;
        chooser.style.top = `${Math.max(12, rect.bottom + box.height + 10 < innerHeight ? rect.bottom + 8 : rect.top - box.height - 8)}px`;
    }
    function renderChooser() {
        const pin = selected ? nodes.get(selected) : null;
        if (!pin) {
            closeChooser();
            return;
        }
        setProperty(el('pin-chooser-title'), 'textContent', pin.entry.label);
        setProperty(el('edit-pin-pages'), 'hidden', !!pin.folder || !!pin.children);
        setProperty(el('edit-folder-icon'), 'hidden', !pin.folder);
        setProperty(el('pin-folder-note'), 'hidden', !pin.folder);
        const pages = pin.children ? pin.children.map(id => ({ id, label: nodes.get(id).entry.label, url: '' })) : pin.pages;
        const wanted = pages.map(page => {
            let button = chooserRows.get(page.id);
            if (!button) {
                button = document.createElement('button');
                button.type = 'button';
                button.className = 'bookmark-open';
                button.append(document.createElement('strong'), document.createElement('span'));
                button.addEventListener('click', () => {
                    if (selected && nodes.get(selected)?.children?.includes(page.id)) {
                        openChooser(page.id, true);
                        return;
                    }
                    const current = selected ? nodes.get(selected)?.pages.find(p => p.id === page.id) : null;
                    if (current)
                        launch(current.url);
                });
                chooserRows.set(page.id, button);
            }
            setProperty(button.querySelector('strong'), 'textContent', page.label);
            // The private URL is displayed only here and in its explicit editor, never in telemetry.
            const status = page.url ? options.status?.(page.url) : '';
            setProperty(button.querySelector('span'), 'textContent', `${page.url}${status ? ` · ${status}` : ''}`);
            setProperty(button, 'disabled', !available || session?.failure === 'UNAVAILABLE');
            return button;
        });
        const focused = document.activeElement;
        reconcileChildren(el('pin-chooser-pages'), wanted);
        for (const [id] of chooserRows)
            if (!pages.some(p => p.id === id))
                chooserRows.delete(id);
        if (focused && !focused.isConnected)
            (wanted.find(b => !b.disabled) ?? el('edit-pin-pages')).focus({ preventScroll: true });
        else if (focused?.isConnected && document.activeElement === document.body)
            focused.focus({ preventScroll: true });
        const defaults = pin.folder || pin.children ? [] : defaultBookmarkPages(pin.entry), key = JSON.stringify(defaults);
        const list = el('pin-service-pages');
        if (list.dataset.key !== key) {
            list.dataset.key = key;
            reconcileChildren(list, defaults.map(page => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'text-button';
                button.textContent = page.label;
                button.addEventListener('click', () => launch(page.url));
                return button;
            }));
        }
        for (const button of list.querySelectorAll('button'))
            setProperty(button, 'disabled', !available || session?.failure === 'UNAVAILABLE');
        setProperty(el('pin-service-entry-points'), 'hidden', !session?.saved?.value?.groups.some(g => g.parentId === selected));
    }
    function openChooser(id, focus) {
        if (gesture?.moved || !available)
            return;
        stopCoast();
        clearHover();
        if (selected !== id)
            closeChooser();
        selected = id;
        keyboardOpened = focus;
        renderChooser();
        const selectedNode = nodes.get(id)?.node;
        const trigger = selectedNode?.isConnected ? selectedNode : nodes.get('overflow')?.node;
        if (!trigger)
            return;
        setAttribute(trigger, 'aria-expanded', 'true');
        if (!chooser.matches(':popover-open'))
            chooser.showPopover({ source: trigger });
        positionChooser();
        if (focus)
            chooser.querySelector('.bookmark-open:not(:disabled)')?.focus({ preventScroll: true });
    }
    function render() {
        const sync = presentationView()?.sync;
        const folders = sync?.folders ?? [];
        const ordinary = [...pinnedDestinations(entries, pins)];
        const folderEntries = folders.map(f => ({ id: `folder:${f.id}`, label: f.label, hostname: '', hostnames: [], category: '' }));
        const all = [...ordinary, ...folderEntries];
        const order = sync?.toolbarOrder ?? [];
        active = [...order.flatMap(id => all.filter(e => destinationId(e) === id)), ...all.filter(e => !order.includes(destinationId(e)))];
        const extra = active.length > compassCapacity ? active.slice(compassCapacity - 1).map(destinationId) : [];
        const shown = [...active, ...(extra.length ? [{ id: 'overflow', label: uiText.moreBookmarks, hostname: '', hostnames: [], category: '' }] : [])];
        const enabled = available && !!session?.saved && session.failure !== 'UNAVAILABLE' && !failed;
        const buttons = shown.map(entry => {
            const id = destinationId(entry);
            let pin = nodes.get(id);
            if (!pin) {
                const node = document.createElement('button');
                node.type = 'button';
                node.className = 'compass-pin';
                node.dataset.destinationId = id;
                const label = document.createElement('span');
                label.className = 'pin-label';
                const badge = document.createElement('span');
                badge.className = 'pin-count';
                badge.setAttribute('aria-hidden', 'true');
                const mark = entry.hostname ? options.siteMark(entry.hostname) : document.createElement('span');
                if (!entry.hostname) {
                    mark.className = 'service-mark folder-mark';
                    mark.append(icon('folder'));
                }
                node.append(mark, label, badge);
                pin = { node, entry, pages: [] };
                nodes.set(id, pin);
                node.addEventListener('pointerdown', stopCoast);
                node.addEventListener('focus', stopCoast);
                node.addEventListener('click', e => {
                    stopCoast();
                    if (suppressClick) {
                        e.preventDefault();
                        return;
                    }
                    const current = nodes.get(id);
                    if (!current)
                        return;
                    if (!current.folder && !current.children && current.pages.length === 1)
                        launch(current.pages[0].url);
                    else
                        openChooser(id, true);
                });
                node.addEventListener('pointerenter', e => {
                    clearHover();
                    if (!coast && !gesture?.moved && e.pointerType === 'mouse' && matchMedia('(hover: hover) and (pointer: fine)').matches && ((nodes.get(id)?.pages.length ?? 0) > 1 || !!nodes.get(id)?.folder || !!nodes.get(id)?.children))
                        hover = setTimeout(() => { if (!coast && !gesture?.moved)
                            openChooser(id, false); }, 300);
                });
                node.addEventListener('pointerleave', () => {
                    clearTimeout(hover);
                    if (!keyboardOpened)
                        leaving = setTimeout(() => {
                            if (!chooser.matches(':hover') && !chooser.contains(document.activeElement))
                                closeChooser();
                        }, 220);
                });
            }
            const folder = folders.find(f => `folder:${f.id}` === id);
            pin.entry = entry;
            pin.folder = folder?.id;
            pin.children = id === 'overflow' ? extra : undefined;
            pin.pages = folder?.pages ?? (id === 'overflow' ? [] : bookmarkPages(session?.saved?.value ?? null, id, entry));
            const mark = pin.node.querySelector('.service-mark');
            if (entry.hostname)
                options.siteMark(entry.hostname, mark);
            else {
                const name = folder ? sync?.folderIcons?.[folder.id] ?? 'folder' : 'folder';
                if (mark.dataset.icon !== name) {
                    mark.dataset.icon = name;
                    mark.replaceChildren(icon(name));
                }
            }
            const status = (entry.hostname && options.status?.(pin.pages[0]?.url ?? `https://${entry.hostname}/`)) ?? '';
            setProperty(pin.node.querySelector('.pin-label'), 'textContent', `${entry.label}${status && status !== 'Allowed' ? ` · ${status}` : ''}`);
            setProperty(pin.node, 'title', `${entry.label}${status ? ` · ${status}` : ''}`);
            const badge = pin.node.querySelector('.pin-count');
            setProperty(badge, 'textContent', String(pin.children?.length ?? pin.pages.length));
            setProperty(badge, 'hidden', !pin.children && pin.pages.length < 2);
            setAttribute(pin.node, 'aria-label', !pin.folder && !pin.children && pin.pages.length === 1 ? `Open ${pin.pages[0].label}` : `${entry.label}, ${pin.children?.length ?? pin.pages.length} ${pin.children ? 'groups' : 'pages'}`);
            setAttribute(pin.node, 'aria-haspopup', pin.folder || pin.children || pin.pages.length > 1 ? 'dialog' : null);
            setAttribute(pin.node, 'aria-expanded', pin.folder || pin.children || pin.pages.length > 1 ? String(selected === id) : null);
            setProperty(pin.node, 'disabled', !enabled);
            return pin.node;
        });
        const focused = document.activeElement;
        reconcileChildren(primary, extra.length ? [...buttons.slice(0, compassCapacity - 1), buttons.at(-1)] : buttons);
        for (const [id] of nodes)
            if (!shown.some(e => destinationId(e) === id))
                nodes.delete(id);
        if (focused?.isConnected && document.activeElement === document.body)
            focused.focus({ preventScroll: true });
        // Unknown membership is not a verified empty group. Keep the decorative
        // shell until the first collection arrives instead of hiding/showing it.
        setProperty(el('pinned-section').dataset, 'count', entries.length === 0 && !available ? 'loading' : String(Math.min(active.length, compassCapacity)));
        setProperty(el('pinned-empty'), 'hidden', active.length > 0 || !available);
        setProperty(handle, 'disabled', !enabled || active.length < 2);
        setProperty(el('edit-pins'), 'disabled', !session?.saved || failed || session.failure === 'UNAVAILABLE' || entries.length === 0 && !session.saved.value?.groups.length);
        const warning = failed || session?.failure === 'UNAVAILABLE';
        setProperty(el('bookmark-warning'), 'hidden', !warning);
        setProperty(el('pinned-list').dataset, 'loading', String(!session?.saved && !warning));
        if (selected) {
            if (!nodes.has(selected))
                closeChooser(true);
            else
                renderChooser();
        }
        arrangePins();
        placePins();
        editor?.render(entries, pins, pinEnabled);
    }
    function placePins() {
        const rotation = `${Math.round(angle * 1000) / 1000}deg`;
        if (composition.style.getPropertyValue('--wheel-angle') !== rotation)
            composition.style.setProperty('--wheel-angle', rotation);
    }
    function arrangePins() {
        const children = [...primary.children];
        children.forEach((node, index) => {
            const radians = (-90 + index * 360 / Math.max(1, children.length)) * Math.PI / 180, style = node.style;
            const x = `${(Math.cos(radians) * 134).toFixed(2)}px`, y = `${(Math.sin(radians) * 134).toFixed(2)}px`;
            if (style.getPropertyValue('--pin-x') !== x)
                style.setProperty('--pin-x', x);
            if (style.getPropertyValue('--pin-y') !== y)
                style.setProperty('--pin-y', y);
        });
    }
    function endGesture() {
        stopCoast();
        cancelAnimationFrame(paint);
        paint = 0;
        placePins();
        if (!gesture)
            return;
        const old = gesture;
        gesture = null;
        moving(false);
        if (handle.hasPointerCapture(old.id))
            handle.releasePointerCapture(old.id);
        setProperty(handle.dataset, 'dragging', 'false');
        if (old.moved) {
            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 0);
        }
    }
    function releaseGesture(e) {
        if (!gesture || gesture.id !== e.pointerId)
            return;
        const old = gesture;
        endGesture();
        if (!old.moved || matchMedia('(prefers-reduced-motion: reduce)').matches)
            return;
        let speed = old.motion.velocity(e.timeStamp), last = performance.now(), elapsed = 0;
        if (Math.abs(speed) <= 0.008)
            return;
        const step = (now) => {
            const dt = Math.min(4000 - elapsed, Math.max(0, now - last));
            last = now;
            elapsed += dt;
            const next = coastRotation(speed, dt);
            speed = next.speed;
            angle = (angle + next.degrees) % 360;
            placePins();
            if (Math.abs(speed) > 0.008 && elapsed < 4000 && !disposed && available && !document.hidden)
                coast = requestAnimationFrame(step);
            else {
                coast = 0;
                moving(false);
            }
        };
        moving(true);
        coast = requestAnimationFrame(step);
    }
    handle.addEventListener('pointerdown', e => {
        if (e.button !== 0 || !e.isPrimary || handle.disabled)
            return;
        stopCoast();
        const r = handle.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const motion = angularMotion();
        motion.move(e.clientX - cx, e.clientY - cy, e.timeStamp);
        gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, cx, cy, motion, moved: false };
        handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', e => {
        if (!gesture || gesture.id !== e.pointerId)
            return;
        if (!gesture.moved && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) < 6)
            return;
        if (!gesture.moved) {
            gesture.moved = true;
            moving(true);
            closeChooser();
            setProperty(handle.dataset, 'dragging', 'true');
        }
        const samples = e.getCoalescedEvents?.() ?? [];
        for (const sample of samples.length ? samples : [e])
            angle = (angle + gesture.motion.move(sample.clientX - gesture.cx, sample.clientY - gesture.cy, sample.timeStamp)) % 360;
        schedulePaint();
    });
    handle.addEventListener('pointerup', releaseGesture);
    for (const event of ['pointercancel', 'lostpointercapture'])
        handle.addEventListener(event, () => { if (gesture)
            endGesture(); });
    handle.addEventListener('click', e => e.preventDefault());
    handle.addEventListener('keydown', e => { if (e.key === 'Escape') {
        e.preventDefault();
        endGesture();
    } });
    chooser.addEventListener('pointerenter', () => clearTimeout(leaving));
    chooser.addEventListener('pointerleave', () => { if (!keyboardOpened)
        leaving = setTimeout(() => { if (!chooser.contains(document.activeElement))
            closeChooser(); }, 220); });
    chooser.addEventListener('keydown', e => { if (e.key === 'Escape') {
        e.preventDefault();
        closeChooser(true);
    } });
    chooser.addEventListener('toggle', () => { if (!chooser.matches(':popover-open') && selected)
        closeChooser(); });
    el('retry-folder-icon').addEventListener('click', () => void saveFolderIcon());
    el('edit-folder-icon').addEventListener('click', () => { const folder = selected ? nodes.get(selected)?.folder : undefined; if (folder)
        pickFolderIcon(el('edit-folder-icon'), folder, presentationView()?.sync.folderIcons?.[folder] ?? ''); });
    el('edit-pin-pages').addEventListener('click', () => { const id = selected; const trigger = id ? nodes.get(id)?.node : undefined; closeChooser(); void editor?.open(id ?? undefined, trigger); });
    el('edit-pins').addEventListener('click', () => { closeChooser(); void editor?.open(undefined, el('edit-pins')); });
    el('retry-bookmarks').addEventListener('click', () => { if (session)
        void session.refresh();
    else
        void load(); });
    const onViewport = () => { closeChooser(); endGesture(); };
    const onScroll = (event) => { if (!(event.target instanceof Node) || !chooser.contains(event.target))
        onViewport(); };
    const onVisibility = () => { if (document.hidden)
        onViewport(); };
    const onUnload = (event) => { if (session?.dirty) {
        event.preventDefault();
        event.returnValue = '';
    } };
    window.addEventListener('resize', onViewport);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', endGesture);
    window.addEventListener('beforeunload', onUnload);
    void load();
    return {
        render(next, order, enabled, editable) {
            entries = next;
            pins = order;
            available = enabled;
            pinEnabled = editable;
            if (!enabled)
                endGesture();
            render();
        },
        refresh: () => session?.refresh(),
        leave() { closeChooser(); endGesture(); },
        dispose() {
            disposed = true;
            closeChooser();
            endGesture();
            session?.repository.close();
            window.removeEventListener('resize', onViewport);
            document.removeEventListener('scroll', onScroll, true);
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('blur', endGesture);
            window.removeEventListener('beforeunload', onUnload);
        },
    };
}
