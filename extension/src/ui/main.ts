import type { AdapterView } from '../adapter/firefox-adapter.js';
import type { DiagnosticEntry } from '../adapter/diagnostics.js';
import { destinationIndex, searchDestinations, type DestinationEntry } from './destinations.js';
import { destinationEntryPoints, destinationId, pinnedDestinations, readPins } from './home-model.js';
import { loadWebsiteIcon } from './website-icons.js';
import { accessCopy, canQueueOperation, countdown, journeyEndCopy, selectedContext } from './presentation.js';
import { configurationFromDraft, settingsCopy, timingFields, type TimingDraft } from './settings-model.js';
import { initializeSidebar } from './sidebar.js';
import { compileCuratedWhitelist, curatedWhitelist, serviceLabel } from '../presets/curated-whitelist.js';
import { equivalentServiceHostnames } from '../presets/access-aliases.js';
import type { Policy, PolicyReview } from '@atlas/core';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string) => { const node = element(id); if (node.textContent !== value) node.textContent = value; };
initializeSidebar(element<HTMLButtonElement>('sidebar-toggle'));
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
type NavigationTarget = 'home' | 'settings' | 'vault';
let accessFocused = params.get('view') === 'access';
let settingsKey = '';
let policyFormKey = '';
let displayedProposalId: number | null = null;
let entries: readonly DestinationEntry[] = [];
let matches: readonly DestinationEntry[] = [];
let searchKey = '';
let highlighted = -1;
const pinsStorageKey = 'atlas-home-pins-v1';
let pins: readonly string[] = [];
let pinsLoaded = false;
let savingPins = false;
let pinnedKey = '';
let reviewKey = '';
let temporaryKey = '';
const searchInput = element<HTMLInputElement>('destination-search');
const websiteIcons = new Map<string, Promise<string | null>>();
const observedIcons = new Map<string, string>();
const iconSnapshot = browser.tabs.query({}).then((tabs) => {
  for (const tab of tabs) if (tab.url && tab.favIconUrl) {
    try { const hostname = new URL(tab.url).hostname; if (!observedIcons.has(hostname)) observedIcons.set(hostname, tab.favIconUrl); } catch { /* No website metadata. */ }
  }
}).catch(() => { /* Public site lookup remains available without tab metadata. */ });
const iconObserver = new IntersectionObserver((changes) => {
  for (const change of changes) if (change.isIntersecting) {
    iconObserver.unobserve(change.target);
    const image = change.target as HTMLImageElement;
    void displayWebsiteIcon(image, image.dataset.hostname!);
  }
}, { rootMargin: '160px' });

const presetHostnames = compileCuratedWhitelist().whitelist;
const buildVersion = document.createElement('p');
buildVersion.id = 'build-version'; buildVersion.className = 'note';
buildVersion.textContent = `Atlas extension ${browser.runtime.getManifest().version}`;
element('diagnostics').append(buildVersion);
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
    feedback(response?.error === 'CONTENT_REMOVAL_IN_PROGRESS' ? 'Atlas is closing the previous page. Restart will be available in a moment.'
      : response?.error ? `Atlas could not complete that action (${response.error}).`
      : response?.initialized === false ? 'Setup was not saved. Check the hostnames; an existing policy cannot be replaced here.'
        : response?.result?.type === 'REJECTED' ? `That action is not available (${response.result.reason}).`
          : response?.result?.type === 'BLOCKED' ? 'State could not be saved or verified. Open Policy & recovery before trying again.'
            : response?.opened === false ? 'The tab changed before opening. Check the selected tab before continuing.' : '');
  } catch { feedback('Atlas is unavailable. No access has been confirmed.'); }
  finally { busy = false; ++epoch; render(); }
}

function render(): void {
  const focused = document.activeElement;
  text('page-title', section === 'settings' ? 'Settings' : accessFocused ? 'A moment for your next step.' : 'Atlas');
  text('page-eyebrow', section === 'settings' ? 'YOUR SAVED COMMITMENTS' : accessFocused ? 'A DELIBERATE NEXT STEP' : 'YOUR INTERNET, WITH INTENTION');
  text('page-description', section === 'settings' ? 'Your destinations, intentional friction and saved commitments.'
    : accessFocused ? 'Your destination is waiting. You decide whether to continue.' : 'A place for the things you choose.');
  document.body.dataset.section = section;
  document.body.dataset.mode = accessFocused ? 'access' : 'control';
  const controller = view?.controller;
  const ready = canQueueOperation(controller);
  const status = controller?.status;
  text('status', busy ? status === 'COMMITTING' ? 'Saving…' : 'Working…' : ready ? 'Atlas is ready'
    : status === 'UNINITIALIZED' ? 'Setup needed' : status === 'RECONCILING' ? 'Recovery needed'
      : status === 'UNAVAILABLE' ? 'State unavailable' : 'Connecting…');
  element('status').title = element('status').textContent ?? '';
  if (element('status').dataset.ready !== String(ready)) element('status').dataset.ready = String(ready);
  element('setup').hidden = status !== 'UNINITIALIZED';
  element('workspace').hidden = status === 'UNINITIALIZED' || section === 'settings';
  element('settings').hidden = section !== 'settings';
  element('destinations').hidden = accessFocused;
  for (const name of ['home', 'settings'] as const) {
    const button = element(`show-${name}`);
    button.setAttribute('aria-pressed', String(section === name));
    if (section === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }

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
  text('context-detail', context ? `Context: ${context.contextId}\nNavigation: ${context.navigationId}\nContent: ${context.effect}${context.journey?.phase === 'ENDED' ? `\nJourney ${context.journey.id}: ${context.journey.endReason}` : ''}` : '');
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
  const showScope = scope.length > 0 && (decision?.outcome === 'GREYLIST' || decision?.outcome === 'WAIT'
    || decision?.outcome === 'REQUIRE_CONFIRMATION' || decision?.reason === 'ACTIVE_GRANT');
  element('access-scope').hidden = !showScope;
  text('access-scope', showScope ? `Temporary access covers exactly: ${scope.join(', ')}` : '');
  const journey = context?.journey;
  const activeJourney = ready && journey != null && journey.phase !== 'ENDED' && now < journey.expiresAt;
  element('access-panel').hidden = !accessFocused;
  element('home-journey').hidden = section !== 'home' || accessFocused || !activeJourney;
  text('home-journey-label', activeJourney ? `${serviceLabel(journey.rootHostname)} · ${countdown(journey.expiresAt, now)} remaining` : '');
  element('show-access').hidden = section !== 'home' || accessFocused || context === undefined || activeJourney;

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
  const retry = context?.retry;
  const showRetry = retry != null && decision?.outcome !== 'ALLOW' && ready;
  element('ended-journey').hidden = !showRetry;
  text('ended-journey-copy', showRetry ? context?.effect === 'REMOVING'
    ? `Atlas is closing the previous page. You can restart your journey to ${retry.destinationLabel} in a moment.`
    : `${journeyEndCopy(retry.endReason)} Start again from ${retry.rootHostname}.` : '');
  action('restart-journey', showRetry);
  if (context?.effect === 'REMOVING') element<HTMLButtonElement>('restart-journey').disabled = true;
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
  renderSettings(controller, ready, now);
  renderHome(controller?.snapshot?.policy, ready);
  renderTemporaryAccess(now);
  if (focused instanceof HTMLButtonElement && focused.closest('#access-panel') && (focused.disabled || focused.closest('[hidden]'))
    && accessFocused && section === 'home') element('access-title').focus({ preventScroll: true });
  if (focused instanceof HTMLButtonElement && focused.closest('#vault-section') && (focused.disabled || focused.closest('[hidden]'))
    && section === 'settings') element('vault-heading').focus({ preventScroll: true });
}

function renderTemporaryAccess(now: number): void {
  const available = view?.temporaryAccess != null;
  const grants = (view?.temporaryAccess ?? []).filter((grant) => grant.expiresAt > now);
  const key = JSON.stringify(grants);
  const list = element('temporary-list');
  if (temporaryKey !== key) {
    temporaryKey = key;
    list.replaceChildren(...grants.map((grant) => {
      const row = document.createElement('li'); row.className = 'temporary-row';
      const copy = document.createElement('span'); copy.className = 'temporary-copy';
      const name = document.createElement('strong'); name.className = 'temporary-name';
      name.textContent = serviceLabel(grant.hostnames[0]!);
      const scope = document.createElement('span'); scope.className = 'temporary-scope';
      scope.textContent = grant.hostnames.join(', ');
      scope.hidden = grant.hostnames.length === 1 && name.textContent === grant.hostnames[0];
      copy.append(name, scope);
      const time = document.createElement('span'); time.className = 'temporary-time';
      time.dataset.expiresAt = String(grant.expiresAt);
      time.title = `Expires at ${new Date(grant.expiresAt).toLocaleTimeString()}`;
      row.append(copy, time); return row;
    }));
  }
  for (const time of list.querySelectorAll<HTMLElement>('.temporary-time')) {
    const label = `${countdown(Number(time.dataset.expiresAt), now)} remaining`;
    if (time.textContent !== label) time.textContent = label;
  }
  list.hidden = !available || grants.length === 0;
  element('temporary-empty').hidden = !available || grants.length > 0;
  element('temporary-unavailable').hidden = available;
  text('temporary-count', available && grants.length > 0 ? `${grants.length} active` : '');
}

function renderSettings(controller: AdapterView['controller'] | undefined, ready: boolean, now: number): void {
  const status = controller?.status;
  const policy = controller?.snapshot?.policy;
  const proposal = controller?.snapshot?.vaultState.pendingProposal;
  element('settings-pending').hidden = proposal == null;
  element('settings-nav-status').hidden = proposal == null;
  const settingsLabel = proposal == null ? 'Settings' : 'Settings, pending change';
  element('show-settings').setAttribute('aria-label', settingsLabel);
  element('show-settings').title = settingsLabel;
  const proposalId = proposal?.id ?? null;
  if (controller?.snapshot && proposalId !== displayedProposalId) {
    displayedProposalId = proposalId;
    if (proposalId !== null) element<HTMLDetailsElement>('vault-section').open = true;
  }
  element('vault-empty').hidden = proposal != null;
  const missingDefaults = presetHostnames.filter((hostname) => !policy?.whitelist.includes(hostname));
  element('preset-update').hidden = !policy || missingDefaults.length === 0;
  text('preset-update-status', policy ? missingDefaults.length > 0
    ? `${missingDefaults.length} curated hostnames are missing from your saved Whitelist.`
    : 'Your saved Whitelist includes all current curated hostnames.' : '');
  element('propose-defaults').hidden = !policy || missingDefaults.length === 0;
  element<HTMLButtonElement>('propose-defaults').disabled = busy || !ready || proposal != null;
  element('vault-panel').hidden = proposal == null;
  const review = policyReview?.proposalId === proposal?.id && policyReview?.basePolicyRevision === controller?.snapshot?.policyRevision
    && policyReview?.baseConfigurationRevision === controller?.snapshot?.configurationRevision
    ? policyReview : null;
  renderReview(review, proposal != null);
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
      timingFields.forEach((field) => { element<HTMLInputElement>(field.id).value = field.value(activeConfiguration); });
    }
    timingFields.forEach((field) => { text(`active-${field.id}`, `Active: ${field.value(activeConfiguration)} ${field.unit}`); });
  }
  // Temporary loss of authority disables commands; it must not erase an unsaved draft.
  const formKey = policy === undefined ? policyFormKey : JSON.stringify(policy);
  if (policy !== undefined && formKey !== policyFormKey) {
    policyFormKey = formKey;
    element<HTMLTextAreaElement>('policy-whitelist').value = policy.whitelist.join('\n');
    element<HTMLTextAreaElement>('policy-blacklist').value = policy.blacklist.join('\n');
  }
  for (const id of ['propose-settings', 'propose-policy']) element<HTMLButtonElement>(id).disabled = busy || !ready || proposal != null;
  text('vault-impact', review?.invalidatesAccess ? 'Policy changes invalidate current requests, grants and Journeys.'
    : 'Settings changes preserve existing waits, grants and Journey terms. New activity uses the committed settings.');
  element<HTMLButtonElement>('recover').disabled = busy || ready || status === 'UNINITIALIZED' || status === 'COMMITTING';
  text('policy', controller?.snapshot
    ? `Pure Whitelist: ${policy!.whitelist.join(', ') || '(empty)'}\nBlacklist: ${policy!.blacklist.join(', ') || '(empty)'}\nPolicy revision: ${controller.snapshot.policyRevision}\nState: ${status}${controller.reason ? ` · ${controller.reason}` : ''}`
    : 'No verified policy loaded.');
}

function renderHome(policy: Policy | undefined, ready: boolean): void {
  const destinationKey = JSON.stringify(policy ?? null);
  if (destinationsKey !== destinationKey) {
    destinationsKey = destinationKey;
    entries = policy ? destinationIndex(policy) : [];
    const groups: HTMLElement[] = [];
    const categoryOrder = ['University', 'Scholar / Research', 'Writing', 'Development', 'Mail', 'AI', 'Video'];
    const rank = (category: string) => categoryOrder.includes(category) ? categoryOrder.indexOf(category) : categoryOrder.length;
    const categories = [...new Set(entries.map((entry) => entry.category))].sort((a, b) => rank(a) - rank(b));
    for (const category of categories) {
      const available = entries.filter((entry) => entry.category === category);
      const group = document.createElement('section'); group.className = category === 'Your destinations' ? 'destination-section' : 'service-group destination-section';
      group.dataset.category = category;
      const heading = document.createElement('div'); heading.className = 'section-heading';
      const title = document.createElement('h2'); title.textContent = category;
      const count = document.createElement('span'); count.className = 'section-meta'; count.textContent = `${available.length} destination${available.length === 1 ? '' : 's'}`;
      heading.append(title, count);
      const grid = document.createElement('div'); grid.className = 'destination-grid';
      grid.id = `destination-category-${groups.length}`;
      grid.append(...available.map(makeDestinationCard));
      if (available.length > 4) {
        let expanded = false;
        const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'category-toggle text-button';
        toggle.setAttribute('aria-controls', grid.id);
        const update = () => {
          toggle.textContent = expanded ? 'Show fewer' : `Show all ${available.length} →`;
          toggle.setAttribute('aria-expanded', String(expanded));
          toggle.setAttribute('aria-label', `${expanded ? 'Show fewer' : 'Show all'} ${category} destinations`);
          for (const [index, card] of [...grid.children].entries()) (card as HTMLElement).hidden = !expanded && index >= 4;
        };
        toggle.addEventListener('click', () => { expanded = !expanded; update(); }); update();
        heading.replaceChild(toggle, count);
      }
      group.append(heading, grid); groups.push(group);
    }
    element('destination-list').replaceChildren(...groups);
  }
  renderPins();
  renderSearch();
  element('empty-destinations').hidden = entries.length > 0;
  for (const button of document.querySelectorAll<HTMLButtonElement>('.destination-open, #open-journey')) {
    if (button.disabled !== (busy || !ready)) button.disabled = busy || !ready;
  }
}

function icon(name: string): SVGSVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); node.classList.add('icon'); node.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `#icon-${name}`); node.append(use); return node;
}

async function displayWebsiteIcon(image: HTMLImageElement, hostname: string): Promise<void> {
  image.dataset.hostname = hostname;
  if (!websiteIcons.has(hostname)) websiteIcons.set(hostname, iconSnapshot
    .then(() => loadWebsiteIcon(hostname, observedIcons.get(hostname)))
    .then((blob) => blob ? URL.createObjectURL(blob) : null).catch(() => null));
  const loading = websiteIcons.get(hostname)!;
  const url = await loading;
  // Entry point changes and policy redraws can outlive an earlier lookup.
  if (!image.isConnected || image.dataset.hostname !== hostname || websiteIcons.get(hostname) !== loading) return;
  image.src = url ?? 'site.svg';
}

function makeDestinationCard(entry: DestinationEntry): HTMLElement {
  const card = document.createElement('div'); card.className = 'destination-card'; card.dataset.destinationId = destinationId(entry);
  const points = destinationEntryPoints(entry);
  const addresses = document.createElement('select'); addresses.className = 'service-addresses'; addresses.setAttribute('aria-label', `${entry.label} entry point`);
  points.forEach((hostname) => addresses.append(new Option(hostname, hostname))); addresses.hidden = points.length < 2;
  const open = document.createElement('button'); open.className = 'destination-open'; open.type = 'button'; open.setAttribute('aria-label', `Open ${entry.label}`);
  const mark = document.createElement('span'); mark.className = 'service-mark'; mark.setAttribute('aria-hidden', 'true');
  const image = document.createElement('img'); image.className = 'site-icon'; image.width = 32; image.height = 32;
  image.alt = ''; image.src = 'site.svg'; image.loading = 'lazy'; image.dataset.hostname = addresses.value;
  image.addEventListener('error', () => { if (!image.src.endsWith('/site.svg')) image.src = 'site.svg'; });
  mark.append(image); iconObserver.observe(image);
  const copy = document.createElement('span'); copy.className = 'destination-copy';
  const name = document.createElement('span'); name.className = 'destination-name'; name.textContent = entry.label;
  const host = document.createElement('span'); host.className = 'destination-host'; host.textContent = addresses.value;
  addresses.addEventListener('change', () => { host.textContent = addresses.value; void displayWebsiteIcon(image, addresses.value); });
  copy.append(name, host); open.append(mark, copy);
  open.addEventListener('click', () => { void send({ kind: 'OPEN_DESTINATION', url: `https://${addresses.value}/` }); });
  const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'pin-button'; pin.dataset.pinId = destinationId(entry); pin.dataset.label = entry.label; pin.append(icon('pin'));
  pin.addEventListener('click', () => { void togglePin(destinationId(entry)); });
  card.append(open, pin, addresses); return card;
}

function renderPins(): void {
  const active = pinnedDestinations(entries, pins);
  const key = JSON.stringify(active);
  if (key !== pinnedKey) { pinnedKey = key; element('pinned-list').replaceChildren(...active.map(makeDestinationCard)); }
  element('pinned-empty').hidden = active.length > 0;
  for (const button of document.querySelectorAll<HTMLButtonElement>('.pin-button')) {
    const pinned = pins.includes(button.dataset.pinId!);
    const label = `${pinned ? 'Unpin' : 'Pin'} ${button.dataset.label}`;
    if (button.getAttribute('aria-pressed') !== String(pinned)) button.setAttribute('aria-pressed', String(pinned));
    if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
    if (button.title !== label) button.title = label;
    const disabled = !pinsLoaded || savingPins || !canQueueOperation(view?.controller);
    if (button.disabled !== disabled) button.disabled = disabled;
  }
}

function togglePin(id: string): void {
  if (!pinsLoaded || savingPins) return;
  const focused = document.activeElement;
  const pinnedFocus = focused instanceof HTMLButtonElement && focused.closest('#pinned-list') !== null;
  const next = pins.includes(id) ? pins.filter((pin) => pin !== id) : [...pins, id];
  if (next.length > 200) { feedback('Your pinned list is full. Unpin a destination first.'); return; }
  savingPins = true; renderPins();
  try { localStorage.setItem(pinsStorageKey, JSON.stringify(next)); pins = next; feedback(''); }
  catch { feedback('Your pin could not be saved. Access and policy are unchanged.'); }
  finally {
    savingPins = false; render();
    if (pinnedFocus && !focused.isConnected) {
      const counterpart = [...element('destination-list').querySelectorAll<HTMLButtonElement>('.pin-button')]
        .find((button) => button.dataset.pinId === id && button.closest('[hidden]') === null && !button.disabled);
      (counterpart ?? searchInput).focus();
    }
  }
}

function renderReview(review: PolicyReview | null, hasProposal: boolean): void {
  text('vault-phase', review?.phase === 'WAITING' ? 'Waiting' : review?.phase === 'READY' ? 'Ready to confirm' : review?.phase === 'EXPIRED' ? 'Expired' : '');
  text('vault-summary', review ? 'These contents are frozen. Your active policy and settings stay in place until you confirm and Atlas saves the change.'
    : hasProposal ? 'Waiting for a verified Core review. Confirmation is unavailable.' : '');
  const key = JSON.stringify(review ? [review.proposalId, review.whitelist, review.blacklist, review.currentConfiguration, review.candidateConfiguration] : null);
  if (key === reviewKey) return;
  reviewKey = key;
  const changes: string[] = [];
  if (review) for (const [label, diff] of [['Whitelist', review.whitelist], ['Blacklist', review.blacklist]] as const) {
    if (diff.added.length > 0) changes.push(`${label} · add: ${diff.added.join(', ')}`);
    if (diff.removed.length > 0) changes.push(`${label} · remove: ${diff.removed.join(', ')}`);
  }
  element('vault-changes').replaceChildren(...changes.map((value) => { const li = document.createElement('li'); li.textContent = value; return li; }));
  element('vault-changes').hidden = changes.length === 0;
  const rows = review?.currentConfiguration && review.candidateConfiguration ? timingFields.flatMap((field) => {
    const current = field.value(review.currentConfiguration!);
    const proposed = field.value(review.candidateConfiguration!);
    if (current === proposed) return [];
    const row = document.createElement('tr');
    for (const cell of [field.label, `${current} ${field.unit}`, `${proposed} ${field.unit}`]) {
      const td = document.createElement('td'); td.textContent = cell; row.append(td);
    }
    return [row];
  }) : [];
  element('vault-settings-rows').replaceChildren(...rows);
  element('vault-settings-comparison').hidden = rows.length === 0;
}

function renderSearch(): void {
  const next = searchDestinations(entries, searchInput.value);
  const key = JSON.stringify([searchInput.value, next]);
  if (key !== searchKey) {
    searchKey = key; matches = next; highlighted = next.length === 1 ? 0 : -1;
    element('search-results').replaceChildren(...matches.map((entry, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.id = `search-result-${index}`;
      button.setAttribute('role', 'option');
      // The combobox keeps one keyboard focus; arrows select its active descendant.
      button.tabIndex = -1;
      button.addEventListener('mousedown', (event) => { event.preventDefault(); });
      const copy = document.createElement('span'); copy.className = 'result-copy';
      const label = document.createElement('strong'); label.textContent = entry.label;
      const host = document.createElement('small'); host.textContent = entry.hostname;
      copy.append(label, host); button.append(copy, icon('arrow'));
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
    element(`search-result-${highlighted}`).scrollIntoView({ block: 'nearest' });
  }
});
element('search-form').addEventListener('submit', (event) => {
  event.preventDefault(); const entry = matches[highlighted] ?? (matches.length === 1 ? matches[0] : undefined);
  if (entry && canQueueOperation(view?.controller)) void send({ kind: 'OPEN_DESTINATION', url: `https://${entry.hostname}/` });
});
function navigate(name: NavigationTarget): void {
  feedback('');
  section = name === 'home' ? 'home' : 'settings';
  if (name === 'home') accessFocused = false;
  render();
  const target = name === 'vault' ? element<HTMLDetailsElement>('vault-section') : element('main-content');
  if (target instanceof HTMLDetailsElement) target.open = true;
  target.scrollIntoView({ block: 'start' });
  const heading = target.id === 'main-content' ? target : target.querySelector<HTMLElement>('summary, h2') ?? target;
  heading.focus({ preventScroll: true });
}
for (const name of ['home', 'settings'] as const) element(`show-${name}`).addEventListener('click', () => { navigate(name); });
element('brand-home').addEventListener('click', (event) => { event.preventDefault(); navigate('home'); });
element('review-pending').addEventListener('click', () => { navigate('vault'); });
for (const id of ['home-journey', 'show-access']) element(id).addEventListener('click', () => {
  feedback('');
  accessFocused = true; render(); element('access-panel').scrollIntoView({ block: 'start' });
  element('access-title').focus({ preventScroll: true });
});
document.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLElement
    && (event.target.closest('input, textarea, select') || event.target.isContentEditable)) return;
  event.preventDefault(); navigate('home'); searchInput.focus();
});
element('settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const draft = Object.fromEntries(timingFields.map((field) => [field.id, element<HTMLInputElement>(field.id).value])) as TimingDraft;
  const candidateConfiguration = configurationFromDraft(draft);
  if (candidateConfiguration === null) { feedback('Use positive values in whole milliseconds and a whole hop limit.'); return; }
  element('propose-defaults').closest('details')!.open = true;
  void send({ kind: 'PROPOSE_SETTINGS', candidateConfiguration });
  navigate('vault');
});
element('policy-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const hosts = (id: string) => element<HTMLTextAreaElement>(id).value.split(/\r?\n/).map((host) => host.trim()).filter(Boolean);
  element('propose-defaults').closest('details')!.open = true;
  void send({ kind: 'PROPOSE_POLICY', candidatePolicy: { whitelist: hosts('policy-whitelist'), blacklist: hosts('policy-blacklist') } });
  navigate('vault');
});

async function diagnostics(): Promise<void> {
  if (section !== 'settings' || !element<HTMLDetailsElement>('diagnostics').open) return;
  const tabId = element<HTMLSelectElement>('diagnostic-scope').value === 'all' ? null : Number(selected || -1);
  try {
    const response = await browser.runtime.sendMessage({ kind: 'GET_DIAGNOSTICS', tabId });
    const entries: DiagnosticEntry[] = response?.entries ?? [];
    const key = JSON.stringify(entries);
    if (key === diagnosticKey) return;
    diagnosticKey = key;
    element('diagnostic-rows').replaceChildren(...[...entries].reverse().map((entry) => {
      const row = document.createElement('tr');
      const request = entry.method ? `\n${entry.method}${entry.sourceHostname ? ` from ${entry.sourceHostname}` : ' · no source origin'}${entry.continuationKind ? ` · ${entry.continuationKind}` : ''}` : '';
      for (const value of [String(entry.sequence), `${entry.event}${request}`, `${entry.tabId} / ${entry.navigationId}`, entry.hostname ?? '—',
        `${entry.outcome ?? '—'}${entry.reason ? ` · ${entry.reason}` : ''}`,
        entry.journey ? `${entry.journey.id} · ${entry.journey.phase} · ${entry.journey.hopCount}/${entry.journey.maxHops}${entry.journey.endReason ? ` · ${entry.journey.endReason}` : ''}` : '—']) {
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
element('propose-defaults').addEventListener('click', () => { void send({ kind: 'PROPOSE_CURATED_DEFAULTS' }); navigate('vault'); });
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
  } catch { if (ticket === epoch) { view = null; render(); text('status', 'Atlas is unavailable'); element('status').title = 'Atlas is unavailable'; } }
  finally {
    polling = false;
    // A one-second UI interval can repeatedly coincide with the background's one-second
    // save. Revisit a pending save promptly so a verified READY result becomes visible.
    const pending = view?.controller?.status === 'COMMITTING' || view?.controller?.status === 'LOADING';
    setTimeout(() => { void poll(); }, pending ? 100 : 1000);
  }
}
window.addEventListener('storage', (event) => {
  if (event.key !== pinsStorageKey && event.key !== null) return;
  try { pins = readPins(event.newValue === null ? null : JSON.parse(event.newValue)); }
  catch { pins = []; }
  render();
});
element('restart-journey').addEventListener('click', () => {
  const context = selectedContext(view?.contexts ?? [], selected);
  if (context?.retry) void send({ kind: 'RESTART_JOURNEY', tabId: context.tabId, journeyId: context.retry.journeyId });
});
browser.tabs.onUpdated.addListener((_tabId, changes, tab) => {
  if ((!changes.favIconUrl && !changes.url) || !tab.url || !tab.favIconUrl) return;
  try {
    const hostname = new URL(tab.url).hostname;
    if (observedIcons.get(hostname) === tab.favIconUrl) return;
    observedIcons.set(hostname, tab.favIconUrl); websiteIcons.delete(hostname);
    for (const image of document.querySelectorAll<HTMLImageElement>('.site-icon')) if (image.dataset.hostname === hostname)
      void displayWebsiteIcon(image, hostname);
  } catch { /* Missing/unsupported website metadata creates no icon or permission. */ }
});
try { pins = readPins(JSON.parse(localStorage.getItem(pinsStorageKey) ?? 'null')); }
catch { feedback('Pinned destinations are unavailable. Your saved policy is unaffected.'); }
pinsLoaded = true;
void poll();
