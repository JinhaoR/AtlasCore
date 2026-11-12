import { evaluate, type Policy } from '@atlas/core';
import type { DestinationEditor, DraftClassification } from './destination-draft.js';
import { commonWwwCounterpart, explicitDestinationHosts } from './destination-policy.js';
import { canUseSubdomainScope, subdomainScopeDescription } from './subdomain-scope.js';
import { setAttribute, setProperty } from './dom.js';
import { renderFeedback } from './feedback.js';

/** Own form DOM/caret identity and scope copy. The workspace remains the only
 * draft owner; this component neither saves nor submits permission changes. */
export function initializeDestinationEditor(options: {
  editor(): DestinationEditor | null | undefined; policy(): Policy | null | undefined; live(): boolean;
}) {
  const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const input = (id: string) => element<HTMLInputElement>(id);
  const text = (id: string, value: string) => setProperty(element(id), 'textContent', value);
  const json = (value: unknown) => JSON.stringify(value);
  let editorKey = '';
  function currentEditor(): DestinationEditor | null {
    const editor = options.editor();
    if (!editor) return null;
    return { id: editor.id, name: input('site-name').value, hostname: input('site-hostname').value, category: input('site-category').value,
      access: element<HTMLSelectElement>('site-access').value as DraftClassification, www: input('site-www').checked,
      extra: input('site-extra').value, pinned: input('site-pin').checked,
      ...(input('site-subdomains').checked ? { includeSubdomains: true } : {}) };
  }
  function restoreEditor(): void {
    if (!options.live()) return;
    const editor = options.editor();
    if (!editor) { setProperty(element('site-draft'), 'hidden', true); editorKey = ''; return; }
    if (json(editor) === editorKey) return;
    clearFieldError();
    editorKey = json(editor); setProperty(element('site-draft'), 'hidden', false);
    text('site-draft-title', editor.id ? `Edit ${editor.name || 'destination'}` : 'Add a site');
    setProperty(input('site-name'), 'value', editor.name); setProperty(input('site-hostname'), 'value', editor.hostname); setProperty(input('site-category'), 'value', editor.category);
    setProperty(element<HTMLOptionElement>('site-preserve-rules'), 'hidden', editor.id === null);
    setProperty(element<HTMLSelectElement>('site-access'), 'value', editor.access);
    setProperty(input('site-www'), 'checked', editor.www); setProperty(input('site-extra'), 'value', editor.extra); setProperty(input('site-pin'), 'checked', editor.pinned);
    setProperty(input('site-subdomains'), 'checked', editor.includeSubdomains === true); scope();
  }
  function scope(locked = false): void {
    const counterpart = commonWwwCounterpart(input('site-hostname').value.trim());
    setProperty(input('site-www'), 'disabled', locked || counterpart === null);
    // Partial hostname typing must not reset a deliberate checkbox choice.
    text('site-www-label', counterpart === null ? 'No common www counterpart for this hostname' : `Include ${counterpart}`);
    const hosts = explicitDestinationHosts(input('site-hostname').value.trim(), counterpart !== null && input('site-www').checked, input('site-extra').value);
    text('site-scope-preview', hosts ? `Proposed exact hosts: ${hosts.join(', ')}` : 'Enter valid exact hostnames. Wildcards are unsupported.');
    const access = element<HTMLSelectElement>('site-access').value;
    const scopeAvailable = canUseSubdomainScope(input('site-hostname').value);
    setProperty(input('site-subdomains'), 'disabled', locked || access !== 'WHITELIST' || !scopeAvailable);
    text('site-subdomains-label', `Also allow all subdomains of ${input('site-hostname').value.trim() || 'this hostname'}`);
    text('site-subdomains-help', subdomainScopeDescription(input('site-hostname').value)
      + ' Exact listed hostnames keep their existing Allowed sites precedence. Additional subdomains remain subject to the managed list. Adding scope uses Vault; removing it has no cooldown.');
    setProperty(element('site-subdomains-help'), 'hidden', !input('site-subdomains').checked && scopeAvailable);
    if (input('site-subdomains').checked && hosts && access !== 'BLACKLIST') text('site-scope-preview', `Exact hosts: ${hosts.join(', ')}. Additional scope: ${hosts[0]} and all current/future subdomains at any depth. Managed blocking applies to additional subdomains.`);
    const meaningfulPin = access !== 'BLACKLIST' && (access !== 'PRESERVE'
      || hosts?.some(host => evaluate({ hostname: host }, options.policy() ?? { whitelist: [], blacklist: [] }).outcome === 'ALLOW'));
    setProperty(element('site-pin-field'), 'hidden', !meaningfulPin); setProperty(input('site-pin'), 'disabled', locked || !meaningfulPin);
    setProperty(element('save-site-display'), 'hidden', !options.editor()?.id || access !== 'PRESERVE');
  }
  function clearFieldError(): void {
    for (const id of ['site-name', 'site-hostname', 'site-extra', 'site-category'])
      if (input(id).getAttribute('aria-invalid') === 'true') setAttribute(input(id), 'aria-invalid', 'false');
    renderFeedback(element('site-field-error'), { tone: 'status', message: '' });
  }
  return { read: currentEditor, restore: restoreEditor, scope, clearError: clearFieldError,
    remember(editor: DestinationEditor) { editorKey = json(editor); },
    lock(locked: boolean) {
      for (const field of element('site-form').querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))
        if (!['site-www', 'site-pin', 'site-subdomains'].includes(field.id)) setProperty(field, 'disabled', locked);
      if (options.editor()) scope(locked);
    },
  };
}
