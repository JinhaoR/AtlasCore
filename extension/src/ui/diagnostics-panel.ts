import type { DiagnosticEntry } from '../adapter/diagnostics.js';
import type { AdapterView } from '../adapter/firefox-adapter.js';
import { authorityInterruptionCopy, storageDiagnosticsCopy } from './presentation.js';
import { setProperty } from './dom.js';
import type { FeedbackTone } from './feedback.js';
import type { RuntimeDiagnostics } from '../adapter/runtime-diagnostics.js';

/** Own diagnostics requests/export and fence late replies independently of UI state. */
export function initializeDiagnosticsPanel(options: { visible(): boolean; selected(): string; feedback(message: string, tone?: FeedbackTone): void }) {
  const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  let disposed = false, diagnosticKey = '', diagnosticEpoch = 0;
  let diagnosticRequest: { scope: number | null; pending: Promise<void> } | null = null;
  const buildVersion = document.createElement('p');
  buildVersion.id = 'build-version'; buildVersion.className = 'note';
  setProperty(buildVersion, 'textContent', `Atlas extension ${browser.runtime.getManifest().version}`);
  element('diagnostics').append(buildVersion);
  const storageDiagnostic = document.createElement('p');
  storageDiagnostic.id = 'storage-diagnostic'; storageDiagnostic.className = 'note';
  element('diagnostics').append(storageDiagnostic);
  const runtimeDiagnostic = document.createElement('p');
  runtimeDiagnostic.id = 'runtime-diagnostic'; runtimeDiagnostic.className = 'note';
  element('diagnostics').append(runtimeDiagnostic);
  element('diagnostics').append(element('startup-diagnostic'));
  element('diagnostics').append(element('action-diagnostic'));
  function refresh(): Promise<void> {
    if (disposed || document.hidden || !options.visible() || !element<HTMLDetailsElement>('diagnostics').open) {
      ++diagnosticEpoch; diagnosticRequest = null; return Promise.resolve();
    }
    const tabId = element<HTMLSelectElement>('diagnostic-scope').value === 'all' ? null : Number(options.selected() || -1);
    if (diagnosticRequest?.scope === tabId) return diagnosticRequest.pending;
    const ticket = ++diagnosticEpoch;
    const pending = loadDiagnostics(tabId, ticket).finally(() => { if (diagnosticRequest?.pending === pending) diagnosticRequest = null; });
    diagnosticRequest = { scope: tabId, pending }; return pending;
  }
  async function loadDiagnostics(tabId: number | null, ticket: number): Promise<void> {
    try {
      const response = await browser.runtime.sendMessage({ kind: 'GET_DIAGNOSTICS', tabId });
      if (ticket !== diagnosticEpoch || disposed || !options.visible() || !element<HTMLDetailsElement>('diagnostics').open) return;
      if (!Array.isArray(response?.entries)) throw new Error('DIAGNOSTICS_UNAVAILABLE');
      const runtime: ReturnType<RuntimeDiagnostics['read']> | undefined = response.runtime;
      const previous = runtime?.previousSession;
      setProperty(runtimeDiagnostic, 'textContent', runtime?.retention === 'UNAVAILABLE'
        ? 'Runtime diagnostics are available for this session, but could not be retained across restart.'
        : previous?.faults.length
          ? `Retained incident from Atlas ${previous.version}: ${previous.faults.map(f => `${f.subsystem} · ${f.error}${f.controller ? ` · ${f.controller.stage}` : ''}`).join('; ')}. Export diagnostics for numeric code locations.`
          : 'No retained runtime incident. Diagnostic evidence never changes access permissions.');
      const entries: DiagnosticEntry[] = response.entries;
      const key = JSON.stringify(entries);
      if (key === diagnosticKey) return;
      diagnosticKey = key;
      element('diagnostic-rows').replaceChildren(...[...entries].reverse().map((entry) => {
        const row = document.createElement('tr');
        const request = entry.method ? `\n${entry.method}${entry.sourceHostname ? ` from ${entry.sourceHostname}` : ' · no source origin'}${entry.continuationKind ? ` · ${entry.continuationKind}` : ''}` : '';
        for (const value of [String(entry.sequence), `${entry.event}${request}`, `${entry.tabId} / ${entry.navigationId}`, entry.hostname ?? '—',
          `${entry.outcome ?? '—'}${entry.reason ? ` · ${entry.reason}` : ''}`,
          entry.journey ? `${entry.journey.id} · ${entry.journey.phase} · ${entry.journey.hopCount}/${entry.journey.maxHops}${entry.journey.endReason ? ` · ${entry.journey.endReason}` : ''}` : '—']) {
          const cell = document.createElement('td'); setProperty(cell, 'textContent', value); row.append(cell);
        }
        return row;
      }));
      setProperty(element('diagnostic-empty'), 'hidden', entries.length > 0);
    } catch { if (ticket === diagnosticEpoch) options.feedback('Diagnostics are temporarily unavailable.', 'error'); }
  }

  element('diagnostics').addEventListener('toggle', () => { void refresh(); });
  element('diagnostic-scope').addEventListener('change', () => { void refresh(); });
  element('clear-diagnostics').addEventListener('click', () => {
    if (disposed) return;
    ++diagnosticEpoch; diagnosticRequest = null;
    void browser.runtime.sendMessage({ kind: 'CLEAR_DIAGNOSTICS' }).then(() => refresh()).catch(() => options.feedback('Could not clear diagnostics.', 'error'));
  });
  element('export-diagnostics').addEventListener('click', () => {
    if (disposed) return;
    const tabId = element<HTMLSelectElement>('diagnostic-scope').value === 'all' ? null : Number(options.selected() || -1);
    void browser.runtime.sendMessage({ kind: 'GET_DIAGNOSTICS', tabId }).then((response) => {
      if (disposed) return;
      if (!Array.isArray(response?.entries)) throw new Error('Unavailable');
      const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'atlas-diagnostics-v1', extensionVersion: browser.runtime.getManifest().version, entries: response.entries, storage: response.storage ?? null, authorityInterruption: response.authorityInterruption ?? null, curatedUpgrade: response.curatedUpgrade ?? null, runtime: response.runtime ?? null }, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'atlas-diagnostics.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }).catch(() => options.feedback('Could not export diagnostics.', 'error'));
  });
  return {
    refresh,
    invalidate() { ++diagnosticEpoch; diagnosticRequest = null; },
    dispose() { disposed = true; ++diagnosticEpoch; diagnosticRequest = null; },
    render(view: AdapterView | null) {
      const text = [storageDiagnosticsCopy(view?.storage), authorityInterruptionCopy(view?.authorityInterruption)].filter(Boolean).join('\n');
      setProperty(storageDiagnostic, 'textContent', text);
    },
  };
}
