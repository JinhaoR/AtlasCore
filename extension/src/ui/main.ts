import type { AdapterView } from '../adapter/firefox-adapter.js';
import type { DiagnosticEntry } from '../adapter/diagnostics.js';
import { destinationIndex, searchDestinations, type DestinationEntry } from './destinations.js';
import { accessCopy, canQueueOperation, countdown, selectedContext } from './presentation.js';
import { compileCuratedWhitelist, curatedWhitelist, equivalentServiceHostnames, serviceHostnames, serviceLabel } from '../presets/curated-whitelist.js';
import { readConfiguration, type PolicyReview, type AtlasConfiguration } from '@atlas/core';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string) => { const node = element(id); if (node.textContent !== value) node.textContent = value; };
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
let section: 'home' | 'settings' = 'home';
let accessFocused = params.get('view') === 'access';
let settingsKey = '';
let policyFormKey = '';
let entries: readonly DestinationEntry[] = [];
let matches: readonly DestinationEntry[] = [];
let searchKey = '';
let highlighted = -1;
const searchInput = element<HTMLInputElement>('destination-search');
const timingFields = ['access-wait', 'access-window', 'grant-duration', 'vault-wait', 'vault-window', 'journey-lifetime', 'journey-hops'] as const;
const timingLabels = ['Greylist wait', 'Greylist confirmation', 'Temporary access', 'Vault wait', 'Vault confirmation', 'Journey lifetime', 'Journey limit'];
const configurationValues = (config: AtlasConfiguration) => [config.accessTiming.waitMs / 1000, config.accessTiming.confirmationWindowMs / 1000,
  config.accessTiming.grantDurationMs / 1000, config.vaultTiming.waitMs / 1000, config.vaultTiming.confirmationWindowMs / 1000,
  config.journeyLimits.lifetimeMs / 1000, config.journeyLimits.maxHops];
const settingsCopy = (config: AtlasConfiguration) => configurationValues(config).map((value, i) => `${timingLabels[i]}: ${value}${i === 6 ? ' hops' : 's'}`).join(' · ');

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
  text('feedback', message);
  element('feedback').hidden = message === '';
}

async function send(command: object): Promise<void> {
  if (busy) return;
  busy = true; ++epoch; render();
  try {
    const response = await browser.runtime.sendMessage(command);
    if (response?.view) view = response.view;
    policyReview = null; policyReviewError = '';
    if (response?.tabId !== undefined && (response?.result?.type === 'COMMITTED' || response?.opened === true)) selected = String(response.tabId);
    feedback(response?.error ? `Atlas could not complete that action (${response.error}).`
      : response?.initialized === false ? 'Setup was not saved. Check the hostnames; an existing policy cannot be replaced here.'
        : response?.result?.type === 'REJECTED' ? `That action is not available (${response.result.reason}).`
          : response?.result?.type === 'BLOCKED' ? 'State could not be saved or verified. Open Policy & recovery before trying again.'
            : response?.opened === false ? 'The tab changed before opening. Check the selected tab before continuing.' : '');
  } catch { feedback('Atlas is unavailable. No access has been confirmed.'); }
  finally { busy = false; ++epoch; render(); }
}

function render(): void {
  text('page-title', section === 'settings' ? 'Settings' : accessFocused ? 'A moment for your next step.' : 'Where do you want to go?');
  text('page-description', section === 'settings' ? 'Your destinations, intentional friction and saved commitments.'
    : accessFocused ? 'Your destination is waiting. You decide whether to continue.' : 'Open a trusted destination. Give unfamiliar ones a moment of thought.');
  const controller = view?.controller;
  const ready = canQueueOperation(controller);
  const status = controller?.status;
  text('status', busy && status === 'COMMITTING' ? 'Saving…' : ready ? '● Atlas is ready'
    : status === 'UNINITIALIZED' ? 'Setup needed' : status === 'RECONCILING' ? 'Recovery needed'
      : status === 'UNAVAILABLE' ? 'State unavailable' : 'Connecting…');
  if (element('status').dataset.ready !== String(ready)) element('status').dataset.ready = String(ready);
  element('setup').hidden = status !== 'UNINITIALIZED';
  element('workspace').hidden = status === 'UNINITIALIZED' || section === 'settings';
  element('settings').hidden = section !== 'settings';
  element('destinations').hidden = accessFocused;
  element('show-home').setAttribute('aria-pressed', String(section === 'home'));
  element('show-settings').setAttribute('aria-pressed', String(section === 'settings'));

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
  if (element('access-panel').dataset.tone !== copy.tone) element('access-panel').dataset.tone = copy.tone;
  text('hostname', context?.hostname ?? (selected === '' ? 'Your next destination' : 'Tab unavailable'));
  text('access-title', !ready && context !== undefined ? 'Waiting for verified state' : copy.title);
  text('access-description', !ready && context !== undefined
    ? 'Access stays paused until Atlas can verify its saved state.' : copy.description);
  text('outcome', decision?.outcome.replaceAll('_', ' ') ?? 'No decision');
  text('decision', decision ? `${decision.outcome} · ${decision.reason}`
    : result ? `${result.type}${'reason' in result ? ` · ${result.reason}` : ''}` : 'No current assessment.');
  text('context-detail', context ? `Context: ${context.contextId}\nNavigation: ${context.navigationId}\nContent: ${context.effect}` : '');
  const now = Date.now(); // Display only. Core decides readiness using its injected clock.
  text('deadline', decision?.outcome === 'WAIT' ? `Wait ${countdown(decision.readyAt, now)}`
    : decision?.outcome === 'REQUIRE_CONFIRMATION' ? `Confirm within ${countdown(decision.confirmBy, now)}`
      : decision && 'expiresAt' in decision ? `Access remaining ${countdown(decision.expiresAt, now)}` : '');
  const failedRemoval = context?.effect === 'FAILED';
  element('effect-warning').hidden = !failedRemoval;
  text('effect-warning', failedRemoval ? 'Firefox could not remove the document. Close the affected tab.' : '');
  const pending = controller?.snapshot?.accessState.pendingRequests.find((request) => (request.scopeHostnames ?? [request.hostname]).includes(context?.hostname ?? ''));
  const grant = controller?.snapshot?.accessState.grants.find((entry) => (entry.scopeHostnames ?? [entry.hostname]).includes(context?.hostname ?? ''));
  const record = pending ?? (decision?.reason === 'ACTIVE_GRANT' ? grant : undefined);
  const scope = record === undefined ? (context?.hostname === null || context?.hostname === undefined ? []
    : equivalentServiceHostnames(context.hostname).filter((host) => !controller?.snapshot?.policy.whitelist.includes(host)
      || controller.snapshot.policy.blacklist.includes(host))) : record.scopeHostnames ?? [record.hostname];
  text('access-scope', scope.length > 0 ? `Temporary access covers exactly: ${scope.join(', ')}` : '');
  const journey = context?.journey;
  const activeJourney = ready && journey != null && journey.phase !== 'ENDED' && now < journey.expiresAt;
  element('access-panel').hidden = !accessFocused
    && !activeJourney && (decision === null || decision.outcome === 'ALLOW');

  const action = (id: string, show: boolean) => {
    element(id).hidden = !show;
    const button = element<HTMLButtonElement>(id);
    const disabled = busy || !ready || context === undefined;
    if (button.disabled !== disabled) button.disabled = disabled;
  };
  action('start-access', decision?.outcome === 'GREYLIST');
  action('confirm-access', decision?.outcome === 'REQUIRE_CONFIRMATION');
  action('cancel-access', pending !== undefined);
  action('open-home', decision?.outcome === 'ALLOW');
  action('start-journey', decision?.reason === 'WHITELISTED' && !activeJourney);
  action('cancel-journey', activeJourney);
  element('home-note').hidden = decision?.outcome !== 'REQUIRE_CONFIRMATION' && decision?.outcome !== 'ALLOW';
  element('journey-panel').hidden = !activeJourney;
  text('journey-phase', activeJourney ? 'Active' : 'Ended');
  text('journey', journey ? `Journey → ${serviceLabel(journey.rootHostname)}`
    : 'Pure Whitelist navigation automatically starts a bounded redirect Journey.');
  text('journey-time', journey ? activeJourney
    ? `${countdown(journey.expiresAt, now)} left · fixed deadline ${new Date(journey.expiresAt).toLocaleTimeString()}`
    : `Ended · ${journey.endReason?.replaceAll('_', ' ').toLowerCase() ?? 'complete'}` : '');
  const progress = element<HTMLProgressElement>('journey-progress');
  progress.hidden = !activeJourney;
  if (activeJourney) progress.value = Math.max(0, (journey.expiresAt - now) / (journey.expiresAt - journey.startedAt));
  const policy = controller?.snapshot?.policy;
  const proposal = controller?.snapshot?.vaultState.pendingProposal;
  const missingDefaults = presetHostnames.filter((hostname) => !policy?.whitelist.includes(hostname));
  text('preset-update-status', policy ? missingDefaults.length > 0
    ? `${missingDefaults.length} curated hostnames are missing from your saved Whitelist.`
    : 'Your saved Whitelist includes all current curated hostnames.' : '');
  element('propose-defaults').hidden = !policy || missingDefaults.length === 0;
  element<HTMLButtonElement>('propose-defaults').disabled = busy || !ready || proposal != null;
  element('vault-panel').hidden = proposal == null;
  const review = policyReview?.proposalId === proposal?.id && policyReview?.basePolicyRevision === controller?.snapshot?.policyRevision
    ? policyReview : null;
  text('vault-review', review
    ? `Proposal ${review.proposalId} · policy revision ${review.basePolicyRevision}\nWhitelist additions: ${review.whitelist.added.join(', ') || '(none)'}\nWhitelist removals: ${review.whitelist.removed.join(', ') || '(none)'}\nBlacklist additions: ${review.blacklist.added.join(', ') || '(none)'}\nBlacklist removals: ${review.blacklist.removed.join(', ') || '(none)'}\nClassification changes:\n${review.classifications.map((change) => `${change.hostname}: ${change.before} → ${change.after}`).join('\n') || '(none)'}${review.candidateConfiguration ? `\nCurrent settings: ${settingsCopy(review.currentConfiguration!)}\nCandidate settings: ${settingsCopy(review.candidateConfiguration)}` : ''}`
    : policyReviewError ? `Core review unavailable: ${policyReviewError}. Cancel or recover before proceeding.` : 'Loading the frozen Core review…');
  text('vault-deadline', review?.phase === 'WAITING' ? `Vault wait ${countdown(review.readyAt, now)}`
    : review?.phase === 'READY' ? `Confirm within ${countdown(review.confirmBy, now)}`
      : review?.phase === 'EXPIRED' ? 'This proposal expired. Cancel it before starting a new proposal.' : '');
  element('confirm-policy').hidden = review?.phase !== 'READY';
  element<HTMLButtonElement>('confirm-policy').disabled = busy || !ready;
  element<HTMLButtonElement>('cancel-policy').disabled = busy || !ready;
  const managed = view?.managed;
  text('managed-status', managed?.active ? `Status: active · ${managed.count.toLocaleString()} domains` : 'Managed data is loading or unavailable.');
  text('managed-details', managed ? `Categories: ${managed.categories.join(' + ')}. Last updated: ${managed.lastUpdatedAt === null ? 'bundled offline snapshot' : new Date(managed.lastUpdatedAt).toLocaleString()}. Upstream: ${managed.upstreamDate ?? 'unknown'}.` : '');
  text('managed-source', managed ? `Origin: ${managed.origin}\nUpdate: ${managed.updateStatus}\nLast attempt: ${managed.lastAttemptAt === null ? 'none' : new Date(managed.lastAttemptAt).toLocaleString()}\nSource: ${managed.sourceUrl}\nVersion: ${managed.upstreamVersion ?? 'unknown'}\nUnsupported names skipped: ${managed.ignoredNames}` : '');
  text('managed-conflicts', managed ? `Whitelist exceptions in managed data (${managed.conflicts.length}): ${managed.conflicts.join(', ') || 'none'}.` : '');
  const activeConfiguration = controller?.snapshot?.configuration;
  if (activeConfiguration) {
    const configKey = JSON.stringify(activeConfiguration);
    if (configKey !== settingsKey) {
      settingsKey = configKey;
      configurationValues(activeConfiguration).forEach((value, i) => { element<HTMLInputElement>(timingFields[i]!).value = String(value); });
    }
    text('timing', `Active settings · ${settingsCopy(activeConfiguration)}`);
  } else text('timing', 'No verified timing settings.');
  const formKey = JSON.stringify(policy);
  if (formKey !== policyFormKey) {
    policyFormKey = formKey;
    element<HTMLTextAreaElement>('policy-whitelist').value = policy?.whitelist.join('\n') ?? '';
    element<HTMLTextAreaElement>('policy-blacklist').value = policy?.blacklist.join('\n') ?? '';
  }
  for (const id of ['propose-settings', 'propose-policy']) element<HTMLButtonElement>(id).disabled = busy || !ready || proposal != null;
  text('vault-impact', review?.invalidatesAccess ? 'Policy changes invalidate current requests, grants and Journeys.'
    : 'Settings changes preserve existing waits, grants and Journey terms. New activity uses the committed settings.');
  const destinationKey = JSON.stringify(policy ?? null);
  if (destinationsKey !== destinationKey) {
    destinationsKey = destinationKey;
    entries = policy ? destinationIndex(policy) : [];
    const hostnames = entries.flatMap((entry) => entry.hostnames);
    const represented = new Set<string>();
    const makeRow = (label: string, available: readonly string[]) => {
      const row = document.createElement('div'); row.className = 'destination-item';
      const name = document.createElement('span'); name.textContent = label;
      const addresses = document.createElement('select'); addresses.className = 'service-addresses';
      addresses.setAttribute('aria-label', `${label} entry point`);
      for (const hostname of available) addresses.append(new Option(hostname, hostname));
      addresses.hidden = available.length < 2;
      const button = document.createElement('button'); button.textContent = 'Open';
      button.setAttribute('aria-label', `Open ${label}`);
      button.title = available[0]!;
      button.addEventListener('click', () => { void send({ kind: 'OPEN_DESTINATION', url: `https://${addresses.value}/` }); });
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
  renderSearch();
  element('empty-destinations').hidden = entries.length > 0;
  for (const button of document.querySelectorAll<HTMLButtonElement>('#destination-list button, #open-journey, #search-results button')) {
    if (button.disabled !== (busy || !ready)) button.disabled = busy || !ready;
  }
  element<HTMLButtonElement>('recover').disabled = busy || ready || status === 'UNINITIALIZED' || status === 'COMMITTING';
  text('policy', controller?.snapshot
    ? `Pure Whitelist: ${policy!.whitelist.join(', ') || '(empty)'}\nBlacklist: ${policy!.blacklist.join(', ') || '(empty)'}\nPolicy revision: ${controller.snapshot.policyRevision}\nState: ${status}${controller.reason ? ` · ${controller.reason}` : ''}`
    : 'No verified policy loaded.');
}


function renderSearch(): void {
  const next = searchDestinations(entries, searchInput.value);
  const key = JSON.stringify([searchInput.value, next]);
  if (key !== searchKey) {
    searchKey = key; matches = next; highlighted = next.length === 1 ? 0 : -1;
    element('search-results').replaceChildren(...matches.map((entry, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.id = `search-result-${index}`;
      button.setAttribute('role', 'option'); button.textContent = `${entry.label} / ${entry.hostname}`;
      button.addEventListener('click', () => { void send({ kind: 'OPEN_DESTINATION', url: `https://${entry.hostname}/` }); });
      return button;
    }));
  }
  element('search-results').hidden = matches.length === 0;
  element('search-empty').hidden = searchInput.value.trim() === '' || matches.length > 0;
  searchInput.setAttribute('aria-expanded', String(matches.length > 0));
  if (highlighted >= 0) searchInput.setAttribute('aria-activedescendant', `search-result-${highlighted}`);
  else searchInput.removeAttribute('aria-activedescendant');
  for (const [index, button] of [...element('search-results').children].entries()) {
    button.setAttribute('aria-selected', String(index === highlighted));
    (button as HTMLButtonElement).disabled = busy || !canQueueOperation(view?.controller);
  }
}
searchInput.addEventListener('input', () => { renderSearch(); });
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { searchInput.value = ''; renderSearch(); }
  if (matches.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault(); highlighted = (highlighted + (event.key === 'ArrowDown' ? 1 : highlighted < 0 ? 0 : -1) + matches.length) % matches.length; renderSearch();
  }
});
element('search-form').addEventListener('submit', (event) => {
  event.preventDefault(); const entry = matches[highlighted] ?? (matches.length === 1 ? matches[0] : undefined);
  if (entry && canQueueOperation(view?.controller)) void send({ kind: 'OPEN_DESTINATION', url: `https://${entry.hostname}/` });
});
for (const name of ['home', 'settings'] as const) element(`show-${name}`).addEventListener('click', () => {
  section = name;
  if (name === 'home') { accessFocused = false; document.body.dataset.mode = 'control'; }
  render();
});
element('settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const values = timingFields.map((id, i) => i === 6 ? Number(element<HTMLInputElement>(id).value) : Math.round(Number(element<HTMLInputElement>(id).value) * 1000));
  const candidateConfiguration = readConfiguration({ accessTiming: { waitMs: values[0], confirmationWindowMs: values[1], grantDurationMs: values[2] },
    vaultTiming: { waitMs: values[3], confirmationWindowMs: values[4] }, journeyLimits: { lifetimeMs: values[5], maxHops: values[6] } });
  if (candidateConfiguration === null) { feedback('Use positive values in whole milliseconds and a whole hop limit.'); return; }
  element('propose-defaults').closest('details')!.open = true;
  void send({ kind: 'PROPOSE_SETTINGS', candidateConfiguration });
});
element('policy-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const hosts = (id: string) => element<HTMLTextAreaElement>(id).value.split(/\r?\n/).map((host) => host.trim()).filter(Boolean);
  element('propose-defaults').closest('details')!.open = true;
  void send({ kind: 'PROPOSE_POLICY', candidatePolicy: { whitelist: hosts('policy-whitelist'), blacklist: hosts('policy-blacklist') } });
});

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
  event.preventDefault(); void send({ kind: 'OPEN_DESTINATION', url: element<HTMLInputElement>('destination').value.trim() });
});
for (const [id, kind] of Object.entries({ 'start-access': 'START_ACCESS', 'open-home': 'OPEN_HOME',
  'start-journey': 'START_JOURNEY', 'cancel-journey': 'CANCEL_JOURNEY' }))
  element(id).addEventListener('click', () => { if (selected !== '') void send({ kind, tabId: Number(selected) }); });
for (const [id, kind] of Object.entries({ 'confirm-access': 'CONFIRM_ACCESS_AND_OPEN', 'cancel-access': 'CANCEL_ACCESS' })) {
  element(id).addEventListener('click', () => {
    const context = selectedContext(view?.contexts ?? [], selected);
    const pending = view?.controller?.snapshot?.accessState.pendingRequests.find((request) => (request.scopeHostnames ?? [request.hostname]).includes(context?.hostname ?? ''));
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
