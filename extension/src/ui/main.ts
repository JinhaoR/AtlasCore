import type { AdapterView } from '../adapter/firefox-adapter.js';
import type { DiagnosticEntry } from '../adapter/diagnostics.js';
import { configuration } from '../background/configuration.js';
import { accessCopy, countdown, selectedContext } from './presentation.js';
import { compileCuratedWhitelist, curatedWhitelist, serviceHostnames } from '../presets/curated-whitelist.js';
import type { PolicyReview } from '@atlas/core';

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
let policyReview: PolicyReview | null = null;
let policyReviewError = '';
const presetHostnames = compileCuratedWhitelist().whitelist;
document.body.dataset.mode = params.get('view') === 'access' ? 'access' : 'control';
element('preset-preview').replaceChildren(...curatedWhitelist.map((group) => {
  const detail = document.createElement('details'); detail.className = 'preset-group';
  const summary = document.createElement('summary'); summary.textContent = group.label;
  const content = document.createElement('p'); content.textContent = group.services.map((service) => service.label).join(' · ');
  detail.append(summary, content); return detail;
}));
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
    policyReview = null; policyReviewError = '';
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
  const proposal = controller?.snapshot?.vaultState.pendingProposal;
  const missingDefaults = presetHostnames.filter((hostname) => !policy?.whitelist.includes(hostname));
  element('preset-update-status').textContent = policy ? missingDefaults.length > 0
    ? `${missingDefaults.length} curated hostnames are missing from your saved Whitelist.`
    : 'Your saved Whitelist includes all current curated hostnames.' : '';
  element('propose-defaults').hidden = !policy || missingDefaults.length === 0;
  element<HTMLButtonElement>('propose-defaults').disabled = busy || !ready || proposal != null;
  element('vault-panel').hidden = proposal == null;
  const review = policyReview?.proposalId === proposal?.id && policyReview?.basePolicyRevision === controller?.snapshot?.policyRevision
    ? policyReview : null;
  element('vault-review').textContent = review
    ? `Proposal ${review.proposalId} · policy revision ${review.basePolicyRevision}\nWhitelist additions: ${review.whitelist.added.join(', ') || '(none)'}\nWhitelist removals: ${review.whitelist.removed.join(', ') || '(none)'}\nBlacklist additions: ${review.blacklist.added.join(', ') || '(none)'}\nBlacklist removals: ${review.blacklist.removed.join(', ') || '(none)'}\nClassification changes:\n${review.classifications.map((change) => `${change.hostname}: ${change.before} → ${change.after}`).join('\n') || '(none)'}`
    : policyReviewError ? `Core review unavailable: ${policyReviewError}. Cancel or recover before proceeding.` : 'Loading the frozen Core review…';
  element('vault-deadline').textContent = review?.phase === 'WAITING' ? `Vault wait ${countdown(review.readyAt, now)}`
    : review?.phase === 'READY' ? `Confirm within ${countdown(review.confirmBy, now)}`
      : review?.phase === 'EXPIRED' ? 'This proposal expired. Cancel it before starting a new proposal.' : '';
  element('confirm-policy').hidden = review?.phase !== 'READY';
  element<HTMLButtonElement>('confirm-policy').disabled = busy || !ready;
  element<HTMLButtonElement>('cancel-policy').disabled = busy || !ready;
  const managed = view?.managed;
  element('managed-status').textContent = managed?.active ? `Status: active · ${managed.count.toLocaleString()} domains` : 'Managed data is loading or unavailable.';
  element('managed-details').textContent = managed ? `Categories: ${managed.categories.join(' + ')}. Last updated: ${managed.lastUpdatedAt === null ? 'bundled offline snapshot' : new Date(managed.lastUpdatedAt).toLocaleString()}. Upstream: ${managed.upstreamDate ?? 'unknown'}.` : '';
  element('managed-source').textContent = managed ? `Origin: ${managed.origin}\nUpdate: ${managed.updateStatus}\nLast attempt: ${managed.lastAttemptAt === null ? 'none' : new Date(managed.lastAttemptAt).toLocaleString()}\nSource: ${managed.sourceUrl}\nVersion: ${managed.upstreamVersion ?? 'unknown'}\nUnsupported names skipped: ${managed.ignoredNames}` : '';
  element('managed-conflicts').textContent = managed ? `Whitelist exceptions in managed data (${managed.conflicts.length}): ${managed.conflicts.join(', ') || 'none'}.` : '';
  const destinationKey = JSON.stringify(policy?.whitelist ?? []);
  if (destinationsKey !== destinationKey) {
    destinationsKey = destinationKey;
    const hostnames = policy?.whitelist ?? [];
    const represented = new Set<string>();
    const makeRow = (label: string, available: readonly string[]) => {
      const row = document.createElement('div'); row.className = 'destination-item';
      const name = document.createElement('span'); name.textContent = label;
      const addresses = document.createElement('select'); addresses.className = 'service-addresses';
      addresses.setAttribute('aria-label', `${label} entry point`);
      for (const hostname of available) addresses.append(new Option(hostname, hostname));
      addresses.hidden = available.length < 2;
      const button = document.createElement('button'); button.textContent = 'Open';
      button.setAttribute('aria-label', `Open ${label} with Journey`);
      button.title = available[0]!;
      button.addEventListener('click', () => { void send({ kind: 'OPEN_JOURNEY', url: `https://${addresses.value}/` }); });
      row.append(name, addresses, button); return row;
    };
    const groups: HTMLElement[] = [];
    for (const group of curatedWhitelist) {
      const rows: HTMLElement[] = [];
      for (const service of group.services) {
        const all = serviceHostnames(service).filter((hostname) => hostnames.includes(hostname));
        all.forEach((hostname) => represented.add(hostname));
        if (all.length === 0) continue;
        const entries = [service.hostname, ...(service.destinations ?? [])].filter((hostname) => hostnames.includes(hostname));
        rows.push(makeRow(service.label, entries.length > 0 ? entries : [all[0]!]));
      }
      if (rows.length === 0) continue;
      const detail = document.createElement('details'); detail.className = 'service-group'; detail.open = rows.length <= 3;
      const summary = document.createElement('summary'); summary.textContent = `${group.label} · ${rows.length}`;
      detail.append(summary, ...rows); groups.push(detail);
    }
    for (const hostname of hostnames) if (!represented.has(hostname)) groups.push(makeRow(hostname, [hostname]));
    element('destination-list').replaceChildren(...groups);
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
  const defaults = element<HTMLInputElement>('use-defaults').checked ? compileCuratedWhitelist().whitelist : [];
  void send({ kind: 'SETUP', policy: { whitelist: [...new Set([...defaults, ...hosts('whitelist')])], blacklist: hosts('blacklist') } });
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
element('propose-defaults').addEventListener('click', () => { void send({ kind: 'PROPOSE_CURATED_DEFAULTS' }); });
for (const [id, kind] of Object.entries({ 'confirm-policy': 'CONFIRM_POLICY', 'cancel-policy': 'CANCEL_POLICY' })) {
  element(id).addEventListener('click', () => {
    const proposalId = view?.controller?.snapshot?.vaultState.pendingProposal?.id;
    if (proposalId !== undefined) void send({ kind, proposalId });
  });
}
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
    if (ticket === epoch && response?.view) {
      view = response.view;
      const proposalId = view?.controller?.snapshot?.vaultState.pendingProposal?.id;
      if (view?.controller?.status === 'READY' && proposalId !== undefined && !busy) {
        const reviewed = await browser.runtime.sendMessage({ kind: 'REVIEW_POLICY', proposalId });
        if (ticket === epoch && reviewed?.view) {
          view = reviewed.view;
          policyReview = reviewed.result?.type === 'REVIEW' ? reviewed.result.review : null;
          policyReviewError = reviewed.result?.reason ?? '';
        }
      } else if (proposalId === undefined) { policyReview = null; policyReviewError = ''; }
      if (ticket === epoch) render();
    }
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
