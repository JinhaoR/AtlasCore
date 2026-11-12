import { setAttribute, setProperty } from './dom.js';
export const settingsSections = ['timing-settings', 'home-settings', 'vault-section', 'managed-section', 'recovery-section', 'diagnostics'];
export function settingsSection(value) {
    return settingsSections.includes(value) ? value : 'timing-settings';
}
/** Only selects existing section nodes. No data loads, timers or saved preferences. */
export function initializeSettingsNavigation(options) {
    let selected = settingsSection(options.initial), active = false, shown = '';
    const panels = settingsSections.map(id => document.getElementById(id));
    const buttons = [...document.querySelectorAll('[data-settings-panel]')];
    function render(visible, override) {
        const shownPanel = override ?? selected;
        active = visible;
        for (const panel of panels)
            setProperty(panel, 'hidden', panel.id !== shownPanel);
        for (const button of buttons)
            setAttribute(button, 'aria-current', button.dataset.settingsPanel === shownPanel ? 'page' : 'false');
        if (shown !== selected) {
            shown = selected;
            setProperty(panels.find(p => p.id === selected), 'open', true);
        }
    }
    function choose(value, remember = true) {
        selected = settingsSection(value);
        shown = '';
        render(active);
        if (remember)
            options.remember(selected);
        panels.find(p => p.id === selected)?.querySelector('summary')?.focus({ preventScroll: true });
    }
    for (const button of buttons)
        button.addEventListener('click', () => choose(button.dataset.settingsPanel));
    // Existing recovery/diagnostic links can still reveal their original details node.
    for (const panel of panels)
        panel.addEventListener('toggle', () => { if (active && panel.open && panel.hidden)
            choose(panel.id); });
    return { render, choose, value: () => selected, restore(value) { selected = settingsSection(value); render(active); } };
}
