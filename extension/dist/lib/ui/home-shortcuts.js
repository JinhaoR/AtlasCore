import { icon } from './destination-cards.js';
import { reconcileChildren, setAttribute, setProperty } from './dom.js';
import { defaultCategoryIcon } from './category-icons.js';
/** Local drag evidence only. Ordering still requires acknowledged layout persistence. */
export function initializeHomeShortcuts(primary, select, reorder = () => { }, controls = 'sites-list') {
    const buttons = new Map();
    let keys = [], suppressClick = false, movable = false;
    let ghost = null;
    let settling = false;
    let latest = [[], null, true];
    let drag = null;
    function clearDrag(reset = true) {
        if (!drag)
            return;
        const previous = drag;
        drag = null;
        if (previous?.source.hasPointerCapture?.(previous.id))
            previous.source.releasePointerCapture(previous.id);
        ghost?.remove();
        ghost = null;
        for (const button of buttons.values()) {
            setAttribute(button, 'data-dragging', null);
            if (reset)
                button.style.removeProperty('transform');
        }
    }
    primary.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.id || !movable)
            return;
        if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6)
            return;
        if (!drag.active) {
            drag.active = true;
            suppressClick = true;
            drag.source.setPointerCapture(event.pointerId);
            const rect = drag.source.getBoundingClientRect();
            drag.dx = drag.x - rect.left;
            drag.dy = drag.y - rect.top;
            ghost = drag.source.cloneNode(true);
            ghost.classList.add('category-drag-ghost');
            ghost.removeAttribute('id');
            ghost.setAttribute('aria-hidden', 'true');
            ghost.setAttribute('tabindex', '-1');
            ghost.style.width = `${rect.width}px`;
            ghost.style.height = `${rect.height}px`;
            document.body.append(ghost);
            setAttribute(drag.source, 'data-dragging', 'true');
        }
        event.preventDefault();
        ghost.style.left = `${event.clientX - drag.dx}px`;
        ghost.style.top = `${event.clientY - drag.dy}px`;
        const bounds = primary.getBoundingClientRect();
        if (event.clientY < bounds.top + 28)
            primary.scrollTop -= 12;
        else if (event.clientY > bounds.bottom - 28)
            primary.scrollTop += 12;
        // Slot geometry comes from layout offsets, never animated/transformed cards.
        // The original DOM order and pointer capture stay intact until the save.
        const slots = keys.map(key => { const b = buttons.get(key); return { key, x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight }; });
        const origin = primary.getBoundingClientRect();
        const x = event.clientX - origin.left + primary.scrollLeft, y = event.clientY - origin.top + primary.scrollTop;
        const inside = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
        const closest = inside ? [...slots].sort((a, b) => Math.hypot(x - a.x - a.w / 2, y - a.y - a.h / 2) - Math.hypot(x - b.x - b.w / 2, y - b.y - b.h / 2))[0] : null;
        drag.target = closest?.key ?? null;
        const order = [...keys];
        const from = order.indexOf(drag.key), to = closest ? order.indexOf(closest.key) : from;
        order.splice(from, 1);
        order.splice(to, 0, drag.key);
        for (const [index, key] of order.entries()) {
            const old = slots.find(s => s.key === key), next = slots[index];
            buttons.get(key).style.transform = `translate(${next.x - old.x}px, ${next.y - old.y}px)`;
        }
    });
    primary.addEventListener('pointerup', event => {
        if (!drag || event.pointerId !== drag.id)
            return;
        const { key, target, active } = drag;
        if (!active || !target || target === key || !movable) {
            clearDrag();
            return;
        }
        // Keep the preview until the acknowledged order (or failed original) arrives.
        settling = true;
        clearDrag(false);
        void Promise.resolve(reorder(key, target)).finally(() => {
            settling = false;
            for (const button of buttons.values()) {
                button.style.transition = 'none';
                button.style.removeProperty('transform');
            }
            render(...latest);
            // Commit layout and transform removal together, without animating back to zero.
            void primary.offsetWidth;
            for (const button of buttons.values())
                button.style.removeProperty('transition');
        });
    });
    primary.addEventListener('pointercancel', () => clearDrag());
    primary.addEventListener('lostpointercapture', () => clearDrag());
    primary.addEventListener('keydown', event => { if (event.key === 'Escape')
        clearDrag(); });
    if (typeof window !== 'undefined') {
        window.addEventListener('pagehide', () => clearDrag());
        window.addEventListener('blur', () => clearDrag());
        window.addEventListener('pointerup', () => clearDrag());
        document.addEventListener('visibilitychange', () => { if (document.hidden)
            clearDrag(); });
    }
    function render(groups, selected = null, canMove = true) {
        latest = [groups, selected, canMove];
        if (settling)
            return;
        const nextKeys = groups.map(g => g.dataset.categoryKey);
        if (drag && (keys.length !== nextKeys.length || keys.some((key, i) => key !== nextKeys[i])))
            clearDrag();
        keys = nextKeys;
        movable = canMove;
        if (drag && (!keys.includes(drag.key) || !movable))
            clearDrag();
        const focused = document.activeElement;
        const nodes = groups.map(group => {
            const key = group.dataset.categoryKey, label = group.dataset.category;
            let button = buttons.get(key);
            if (!button) {
                button = document.createElement('button');
                button.type = 'button';
                button.className = 'category-shortcut';
                button.dataset.categoryKey = key;
                button.append(icon('category'), document.createElement('span'));
                button.addEventListener('pointerdown', event => {
                    suppressClick = false;
                    if (settling || !movable || event.button !== 0 || !event.isPrimary)
                        return;
                    clearDrag();
                    drag = { key, source: button, id: event.pointerId, x: event.clientX, y: event.clientY, active: false, target: null, dx: 0, dy: 0 };
                });
                button.addEventListener('click', () => { if (suppressClick) {
                    suppressClick = false;
                    return;
                } select(key); });
                button.addEventListener('dragstart', event => event.preventDefault());
                button.addEventListener('keydown', event => {
                    suppressClick = false;
                    if (settling || !movable || !event.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key))
                        return;
                    event.preventDefault();
                    const offset = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
                    const target = keys[keys.indexOf(key) + offset];
                    if (target)
                        reorder(key, target);
                });
                buttons.set(key, button);
            }
            setAttribute(button.querySelector('use'), 'href', `#icon-${group.dataset.icon ?? defaultCategoryIcon(label)}`);
            setProperty(button.querySelector('span'), 'textContent', label);
            if (group.dataset.count !== undefined) {
                let count = button.querySelector('.category-count');
                if (!count) {
                    count = document.createElement('small');
                    count.className = 'category-count';
                    button.append(count);
                }
                setProperty(count, 'textContent', `${group.dataset.count} ${group.dataset.count === '1' ? 'site' : 'sites'}`);
            }
            setAttribute(button, 'data-reorderable', String(movable));
            setProperty(button, 'title', `${label} · Drag to reorder, or use Alt + arrow keys`);
            setAttribute(button, 'aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight');
            setAttribute(button, 'aria-label', `${key === selected ? 'Close' : 'Explore'} ${label} category`);
            setAttribute(button, 'aria-expanded', String(key === selected));
            setAttribute(button, 'aria-controls', controls);
            setAttribute(button, 'aria-pressed', String(key === selected));
            return button;
        });
        if (!drag?.active)
            reconcileChildren(primary, nodes);
        if (focused?.isConnected && nodes.includes(focused) && document.activeElement === document.body)
            focused.focus({ preventScroll: true });
        for (const [key] of buttons)
            if (!keys.includes(key))
                buttons.delete(key);
    }
    return render;
}
