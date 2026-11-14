import { setAttribute, setProperty } from './dom.js';

export const settingsSections = ['timing-settings', 'appearance-settings', 'home-settings', 'vault-section', 'managed-section', 'recovery-section', 'diagnostics'] as const;
export type SettingsSection = typeof settingsSections[number];
export function settingsSection(value: unknown): SettingsSection {
  return settingsSections.includes(value as SettingsSection) ? value as SettingsSection : 'timing-settings';
}

/** Only selects existing section nodes. No data loads, timers or saved preferences. */
export function initializeSettingsNavigation(options: { initial?: unknown; remember(value: SettingsSection): void }) {
  let selected = settingsSection(options.initial), active = false, shown = '';
  const panels = settingsSections.map(id => document.getElementById(id) as HTMLDetailsElement);
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-settings-panel]')];
  function render(visible: boolean, override?: SettingsSection): void {
    const shownPanel = override ?? selected;
    active = visible;
    for (const panel of panels) setProperty(panel, 'hidden', panel.id !== shownPanel);
    for (const button of buttons) setAttribute(button, 'aria-current', button.dataset.settingsPanel === shownPanel ? 'page' : 'false');
    if (shown !== selected) { shown = selected; setProperty(panels.find(p => p.id === selected)!, 'open', true); }
  }
  function choose(value: unknown, remember = true): void {
    selected = settingsSection(value); shown = ''; render(active);
    if (remember) options.remember(selected);
    panels.find(p => p.id === selected)?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
  }
  for (const button of buttons) button.addEventListener('click', () => choose(button.dataset.settingsPanel));
  // Existing recovery/diagnostic links can still reveal their original details node.
  for (const panel of panels) panel.addEventListener('toggle', () => { if (active && panel.open && panel.hidden) choose(panel.id); });
  return { render, choose, value: () => selected, restore(value: unknown) { selected = settingsSection(value); render(active); } };
}
