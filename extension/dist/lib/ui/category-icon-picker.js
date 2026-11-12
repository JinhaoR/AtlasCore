import { categoryIcons, categoryIconNames } from './category-icons.js';
import { icon } from './destination-cards.js';
/** One local, light-dismiss picker. Choosing an icon still uses the existing CAS session. */
export function categoryIconPicker(choose, label = 'Category icon') {
    const panel = document.createElement('div');
    panel.popover = 'auto';
    panel.className = 'category-icon-picker';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', label);
    let trigger = null, key = '';
    function close(restore = false) { if (panel.matches(':popover-open'))
        panel.hidePopover(); if (restore && trigger?.isConnected)
        trigger.focus({ preventScroll: true }); }
    for (const value of ['', ...categoryIcons]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'icon-option';
        button.dataset.icon = value;
        const name = value ? categoryIconNames[value] : 'Automatic';
        button.title = name;
        button.setAttribute('aria-label', name);
        button.append(icon(value || 'category'));
        if (!value) {
            const label = document.createElement('span');
            label.textContent = name;
            button.append(label);
        }
        button.addEventListener('click', () => { const selected = key; close(true); choose(selected, value); });
        panel.append(button);
    }
    panel.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            e.preventDefault();
            close(true);
        }
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            const buttons = [...panel.querySelectorAll('button')], at = buttons.indexOf(document.activeElement);
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (at + ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 }[e.key] ?? 0) + buttons.length) % buttons.length;
            buttons[next]?.focus();
        }
    });
    document.body.append(panel);
    return (button, category, current) => {
        if (trigger === button && panel.matches(':popover-open')) {
            close(true);
            return;
        }
        close();
        trigger = button;
        key = category;
        for (const item of panel.querySelectorAll('button'))
            item.setAttribute('aria-pressed', String(item.dataset.icon === current));
        panel.showPopover({ source: button });
        const r = button.getBoundingClientRect(), box = panel.getBoundingClientRect();
        panel.style.left = `${Math.max(12, Math.min(innerWidth - box.width - 12, r.left))}px`;
        panel.style.top = `${Math.max(12, Math.min(innerHeight - box.height - 12, r.bottom + 8))}px`;
        panel.querySelector('[aria-pressed="true"]')?.focus();
    };
}
