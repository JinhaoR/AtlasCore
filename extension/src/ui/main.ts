import type { AdapterView } from '../adapter/firefox-adapter.js';
import type { DiagnosticEntry } from '../adapter/diagnostics.js';
import { configuration } from '../background/configuration.js';
import { accessCopy, countdown, selectedContext } from './presentation.js';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const select = element<HTMLSelectElement>('context');
const params = new URL(location.href).searchParams;
let selected = params.get('tab') ?? '';
let view: AdapterView | null = null;
let busy = false;
let polling = false;
let epoch = 0;
let optionsKey = '';
let destinationsKey = '';
let diagnosticKey = '';
document.body.dataset.mode = params.get('view') === 'access' ? 'access' : 'control';
if (document.body.dataset.mode === 'access') {
  element('page-title').textContent = 'A moment for your next step.';
  element('page-description').textContent = 'Your destination is waiting. You decide whether to continue.';
}

function feedback(message: string): void {
  element('feedback').textContent = message;
  element('feedback').hidden = message === '';
}

async function send(command: object): Promise<void> {
  if (busy) return;
  busy = true; ++epoch; render();
  try {
    const response = await browser.runtime.sendMessage(command);
    if (response?.view) view = response.view;
    if (response?.tabId !== undefined && response?.result?.type === 'COMMITTED') selected = String(response.tabId);
    feedback(response?.error ? `Atlas could not complete that action (${response.error}).`
      : response?.initialized === false ? 'Setup was not saved. Check the hostnames; an existing policy cannot be replaced here.'
        : response?.result?.type === 'REJECTED' ? `That action is not available (${response.result.reason}).`
          : response?.result?.type === 'BLOCKED' ? 'State could not be saved or verified. Open Policy & recovery before trying again.'
            : response?.opened === false ? 'The tab changed before opening. Check the selected tab before continuing.' : '');
  } catch { feedback('Atlas is unavailable. No access has been confirmed.'); }
  finally { busy = false; ++epoch; render(); }
}

function render(): void {
  const controller = view?.controller;
  const ready = controller?.status === 'READY';
  const status = controller?.status;
  element('status').textContent = ready ? '● Atlas is ready' : status === 'COMMITTING' ? 'Saving…'
    : status === 'UNINITIALIZED' ? 'Setup needed' : status === 'RECONCILING' ? 'Recovery needed'
      : status === 'UNAVAILABLE' ? 'State unavailable' : 'Connecting…';
  element('status').dataset.ready = String(ready);
  element('setup').hidden = status !== 'UNINITIALIZED';
  element('workspace').hidden = status === 'UNINITIALIZED';
  element<HTMLButtonElement>('save-setup').disabled = busy || status !== 'UNINITIALIZED';
  const contexts = view?.contexts.filter((context) => context.hostname !== null) ?? [];
  if (selected === '' && contexts.length > 0) selected = String(contexts[0]!.tabId);
  const context = selectedContext(contexts, selected);
  const choices = contexts.map((item) => ({ value: String(item.tabId), text: `Tab ${item.tabId} · ${item.hostname}` }));
  if (context === undefined) choices.unshift({ value: selected, text: selected === '' ? 'No websites yet' : `Tab ${selected} is closed or unavailable` });
  const key = JSON.stringify(choices);
  if (optionsKey !== key) {
    optionsKey = key;
    select.replaceChildren(...choices.map(({ value, text }) => new Option(text, value)));
  }
  select.value = selected;
  const result = context?.latest;
  const decision = result?.type === 'ASSESSMENT' ? result.decision : null;
  const copy = accessCopy(decision);
  element('access-panel').dataset.tone = copy.tone;
  element('hostname').textContent = context?.hostname ?? (selected === '' ? 'Your next destination' : 'Tab unavailable');
  element('access-title').textContent = !ready && context !== undefined ? 'Waiting for verified state' : copy.title;
  element('access-description').textContent = !ready && context !== undefined
    ? 'Access stays paused until Atlas can verify its saved state.' : copy.description;
  element('outcome').textContent = decision?.outcome.replaceAll('_', ' ') ?? 'No decision';
  element('decision').textContent = decision ? `${decision.outcome} · ${decision.reason}`
    : result ? `${result.type}${'reason' in result ? ` · ${result.reason}` : ''}` : 'No current assessment.';
  element('context-detail').textContent = context ? `Context: ${context.contextId}\nNavigation: ${context.navigationId}\nContent: ${context.effect}` : '';
  const now = Date.now(); // Display only. Core decides readiness using its injected clock.
  element('deadline').textContent = decision?.outcome === 'WAIT' ? `Wait ${countdown(decision.readyAt, now)}`
    : decision?.outcome === 'REQUIRE_CONFIRMATION' ? `Confirm within ${countdown(decision.confirmBy, now)}`
      : decision && 'expiresAt' in decision ? `Access remaining ${countdown(decision.expiresAt, now)}` : '';
  const failedRemoval = context?.effect === 'FAILED';
  element('effect-warning').hidden = !failedRemoval;
  element('effect-warning').textContent = failedRemoval ? 'Firefox could not remove the document. Close the affected tab.' : '';
  const pending = controller?.snapshot?.accessState.pendingRequests.find((request) => request.hostname === context?.hostname);
  const journey = context?.journey;
  const activeJourney = journey != null && journey.phase !== 'ENDED';
  const action = (id: string, show: boolean) => {
    element(id).hidden = !show;
    element<HTMLButtonElement>(id).disabled = busy || !ready || context === undefined;
  };
  action('start-access', decision?.outcome === 'GREYLIST');
  action('confirm-access', decision?.outcome === 'REQUIRE_CONFIRMATION');
  action('cancel-access', pending !== undefined);
  action('open-home', decision?.outcome === 'ALLOW');
  action('start-journey', decision?.reason === 'WHITELISTED' && !activeJourney);
  action('cancel-journey', activeJourney);
  element('home-note').hidden = decision?.outcome !== 'REQUIRE_CONFIRMATION' && decision?.outcome !== 'ALLOW';
  element('journey-phase').textContent = journey?.phase.replaceAll('_', ' ') ?? 'None';
  element('journey').textContent = journey ? `${journey.rootHostname} · ${journey.hopCount}/${journey.maxHops} hops`
    : 'Open a Pure Whitelist destination with Journey when you need an intermediate login path.';
  element('journey-time').textContent = journey ? activeJourney
    ? `${countdown(journey.expiresAt, now)} left · fixed deadline ${new Date(journey.expiresAt).toLocaleTimeString()}`
    : `Ended · ${journey.endReason?.replaceAll('_', ' ').toLowerCase() ?? 'complete'}` : '';
  const progress = element<HTMLProgressElement>('journey-progress');
  progress.hidden = !activeJourney;
  if (activeJourney) progress.value = Math.max(0, (journey.expiresAt - now) / (journey.expiresAt - journey.startedAt));
  const policy = controller?.snapshot?.policy;
  const destinationKey = JSON.stringify(policy?.whitelist ?? []);
  if (destinationsKey !== destinationKey) {
    destinationsKey = destinationKey;
    element('destination-list').replaceChildren(...(policy?.whitelist ?? []).map((hostname) => {
      const row = document.createElement('div'); row.className = 'destination-item';
      const name = document.createElement('span'); name.textContent = hostname;
      const button = document.createElement('button'); button.textContent = 'Open';
      button.setAttribute('aria-label', `Open ${hostname} with Journey`);
      button.addEventListener('click', () => { void send({ kind: 'OPEN_JOURNEY', url: `https://${hostname}/` }); });
      row.append(name, button); return row;
    }));
  }
  element('empty-destinations').hidden = (policy?.whitelist.length ?? 0) > 0;
  for (const button of document.querySelectorAll<HTMLButtonElement>('#destination-list button, #open-journey')) button.disabled = busy || !ready;
  element<HTMLButtonElement>('recover').disabled = busy || ready || status === 'UNINITIALIZED' || status === 'COMMITTING';
  element('policy').textContent = controller?.snapshot
    ? `Pure Whitelist: ${policy!.whitelist.join(', ') || '(empty)'}\nBlacklist: ${policy!.blacklist.join(', ') || '(empty)'}\nPolicy revision: ${controller.snapshot.policyRevision}\nState: ${status}${controller.reason ? ` · ${controller.reason}` : ''}`
    : 'No verified policy loaded.';
}

async function diagnostics(): Promise<void> {
  if (!element<HTMLDetailsElement>('diagnostics').open) return;
  const tabId = element<HTMLSelectElement>('diagnostic-scope').value === 'all' ? null : Number(selected || -1);
  try {
    const response = await browser.runtime.sendMessage({ kind: 'GET_DIAGNOSTICS', tabId });
    const entries: DiagnosticEntry[] = response?.entries ?? [];
    const key = JSON.stringify(entries);
    if (key === diagnosticKey) return;
    diagnosticKey = key;
    element('diagnostic-rows').replaceChildren(...[...entries].reverse().map((entry) => {
      const row = document.createElement('tr');
      for (const value of [String(entry.sequence), entry.event, `${entry.tabId} / ${entry.navigationId}`, entry.hostname ?? '—',
        `${entry.outcome ?? '—'}${entry.reason ? ` · ${entry.reason}` : ''}`,
        entry.journey ? `${entry.journey.id} · ${entry.journey.phase} · ${entry.journey.hopCount}/${entry.journey.maxHops}` : '—']) {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      }
      return row;
    }));
    element('diagnostic-empty').hidden = entries.length > 0;
  } catch { feedback('Diagnostics are temporarily unavailable.'); }
}

select.addEventListener('change', () => { selected = select.value; render(); void diagnostics(); });
element('setup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const hosts = (id: string) => element<HTMLTextAreaElement>(id).value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  void send({ kind: 'SETUP', policy: { whitelist: hosts('whitelist'), blacklist: hosts('blacklist') } });
});
element('journey-form').addEventListener('submit', (event) => {
  event.preventDefault(); void send({ kind: 'OPEN_JOURNEY', url: element<HTMLInputElement>('destination').value.trim() });
});
for (const [id, kind] of Object.entries({ 'start-access': 'START_ACCESS', 'open-home': 'OPEN_HOME',
  'start-journey': 'START_JOURNEY', 'cancel-journey': 'CANCEL_JOURNEY' }))
  element(id).addEventListener('click', () => { if (selected !== '') void send({ kind, tabId: Number(selected) }); });
for (const [id, kind] of Object.entries({ 'confirm-access': 'CONFIRM_ACCESS_AND_OPEN', 'cancel-access': 'CANCEL_ACCESS' })) {
  element(id).addEventListener('click', () => {
    const context = selectedContext(view?.contexts ?? [], selected);
    const pending = view?.controller?.snapshot?.accessState.pendingRequests.find((request) => request.hostname === context?.hostname);
    if (pending && context) void send({ kind, requestId: pending.id, ...(kind === 'CONFIRM_ACCESS_AND_OPEN' ? { tabId: context.tabId } : {}) });
  });
}
element('recover').addEventListener('click', () => { void send({ kind: 'RECOVER' }); });
element('diagnostics').addEventListener('toggle', () => { void diagnostics(); });
element('diagnostic-scope').addEventListener('change', () => { void diagnostics(); });
element('clear-diagnostics').addEventListener('click', () => {
  void browser.runtime.sendMessage({ kind: 'CLEAR_DIAGNOSTICS' }).then(() => diagnostics()).catch(() => feedback('Could not clear diagnostics.'));
});
element('export-diagnostics').addEventListener('click', () => {
  const tabId = element<HTMLSelectElement>('diagnostic-scope').value === 'all' ? null : Number(selected || -1);
  void browser.runtime.sendMessage({ kind: 'GET_DIAGNOSTICS', tabId }).then((response) => {
    if (!Array.isArray(response?.entries)) throw new Error('Unavailable');
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'atlas-diagnostics-v1', entries: response.entries }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'atlas-diagnostics.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }).catch(() => feedback('Could not export diagnostics.'));
});
const timing = configuration.accessTiming;
element('timing').textContent = `Prototype settings: ${timing.waitMs / 1000}s wait · ${timing.confirmationWindowMs / 1000}s to confirm · ${timing.grantDurationMs / 1000}s temporary access · 5min Journey.`;

async function poll(): Promise<void> {
  if (polling) return;
  polling = true;
  const ticket = epoch;
  try {
    const response = await browser.runtime.sendMessage({ kind: 'GET_VIEW' });
    if (ticket === epoch && response?.view) { view = response.view; render(); }
    await diagnostics();
  } catch { if (ticket === epoch) { view = null; render(); element('status').textContent = 'Atlas is unavailable'; } }
  finally {
    polling = false;
    // A one-second UI interval can repeatedly coincide with the background's one-second
    // save. Revisit a pending save promptly so a verified READY result becomes visible.
    const pending = view?.controller?.status === 'COMMITTING' || view?.controller?.status === 'LOADING';
    setTimeout(() => { void poll(); }, pending ? 100 : 1000);
  }
}
void poll();
