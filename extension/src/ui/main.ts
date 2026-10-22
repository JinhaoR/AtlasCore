import type { AdapterView } from '../adapter/firefox-adapter.js';
import type { DiagnosticEntry } from '../adapter/diagnostics.js';
import { destinationIndex, policyDestinationIndex, searchDestinationTargets, type DestinationEntry, type DestinationSearchResult } from './destinations.js';
import { categoryKey } from './categories.js';
import { displayedHomeCategories, homeCategories } from './home-layout.js';
import { initializeHomeOrganization } from './home-organization.js';
import { homeAccessSummary, type HomeAccessLink } from './home-access.js';
import { atlasPage, navigationMemory, type AtlasPage } from './navigation-state.js';
import { readVerifiedController } from './verified-view.js';
import { collectionPresentation, hasCommittedCollection } from './data-view.js';
import { actionFeedback, renderFeedback, type FeedbackTone } from './feedback.js';
import { savePresentation } from './presentation-storage.js';
import { destinationEntryPoints, destinationId, pinnedDestinations, readPins, updateDestinationPin } from './home-model.js';
import { usagePreferencesKey as destinationUsageKey, readDestinationUsage, rankDestinations, type DestinationUsage } from './destination-usage.js';
import { initializeSites, type SitesCommandResponse } from './sites.js';
import { loadWebsiteIcon } from './website-icons.js';
import { accessCopy, accessOutcomeLabel, canQueueOperation, countdown, journeyEndCopy, selectedAccessRecord, selectedContext, startupCopy, storageDiagnosticsCopy, storageFailureCopy } from './presentation.js';
import { configurationFromDraft, settingsCopy, timingFields, type TimingDraft } from './settings-model.js';
import { compileCuratedWhitelist, curatedWhitelist, serviceLabel } from '../presets/curated-whitelist.js';
import type { Policy, PolicyReview } from '@atlas/core';
import { reconcileChildren, setAttribute, setProperty } from './dom.js';
import { RefreshLoop } from './refresh-loop.js';
import { matchingReview, needsPolicyReview } from './vault-presentation.js';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string) => { const node = element(id); if (node.textContent !== value) setProperty(node, 'textContent', value); };
const select = element<HTMLSelectElement>('context');
const params = new URL(location.href).searchParams;
const navigation = navigationMemory({ getItem: key => sessionStorage.getItem(key), setItem: (key, value) => sessionStorage.setItem(key, value) });
let selected = params.get('tab') ?? navigation.value().tab;
let view: AdapterView | null = null;
let lastVerifiedPolicy: Policy | undefined;
let queryAttempted = false;
let busy = false;
let disposed = false;
let epoch = 0;
const preparingScopes = new Set<string>();
let optionsKey = '';
let destinationsKey = '';
let diagnosticKey = '';
let diagnosticEpoch = 0;
let diagnosticRequest: { scope: number | null; pending: Promise<void> } | null = null;
let policyReview: PolicyReview | null = null;
let policyReviewError = '';
type NavigationTarget = AtlasPage;
let page: AtlasPage = atlasPage(location.hash.slice(1)) ?? (params.get('view') === 'access' ? 'access' : 'home');
let section: 'home' | 'sites' | 'settings' = page === 'vault' ? 'settings' : page === 'access' ? 'home' : page;
let accessFocused = page === 'access';
let settingsKey = '';
let displayedProposalId: number | null = null;
let entries: readonly DestinationEntry[] = [];
let matches: readonly DestinationSearchResult[] = [];
let searchKey = '';
let searchInputsKey = '';
let highlighted = -1;
const pinsStorageKey = 'atlas-home-pins-v1';
let pins: readonly string[] = [];
let pinsLoaded = false;
let savingPins = false;
let pinnedKey = '';
let reviewKey = '';
const temporaryRows = new Map<string, { node: HTMLElement; link: HomeAccessLink }>();
let homeCatalog: ReturnType<typeof homeCategories> = [];
let layoutDirty = true;
let usage: DestinationUsage = {};
const expandedCategories = new Set<string>();
const homeGroups = new Map<string, HTMLElement>();
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
setProperty(buildVersion, 'textContent', `Atlas extension ${browser.runtime.getManifest().version}`);
element('diagnostics').append(buildVersion);
const storageDiagnostic = document.createElement('p');
storageDiagnostic.id = 'storage-diagnostic'; storageDiagnostic.className = 'note';
element('diagnostics').append(storageDiagnostic);
element('diagnostics').append(element('startup-diagnostic'));
element('diagnostics').append(element('action-diagnostic'));
setProperty(document.body.dataset, 'mode', params.get('view') === 'access' ? 'access' : 'control');
element('preset-preview').replaceChildren(...curatedWhitelist.map((group) => {
  const detail = document.createElement('details'); detail.className = 'preset-group';
  const summary = document.createElement('summary'); setProperty(summary, 'textContent', group.label);
  const content = document.createElement('p'); setProperty(content, 'textContent', group.services.map((service) => service.label).join(' · '));
  detail.append(summary, content); return detail;
}));
if (document.body.dataset.mode === 'access') {
  setProperty(element('page-title'), 'textContent', 'A moment for your next step.');
  setProperty(element('page-description'), 'textContent', 'Your destination is waiting. You decide whether to continue.');
}

function feedback(message: string, tone: FeedbackTone = 'status'): void {
  renderFeedback(element('feedback'), { message, tone });
  syncSiteFeedback();
}

function syncSiteFeedback(): void {
  const local = element('site-save-feedback'), global = element('feedback');
  setProperty(local, 'hidden', !local.textContent || section !== 'sites' || !global.hidden && local.textContent === global.textContent);
}

async function send(command: object): Promise<SitesCommandResponse | undefined> {
  if (busy) return;
  busy = true; ++epoch; render();
  try {
    const response = await browser.runtime.sendMessage(command);
    if (response?.view) view = response.view;
    policyReview = matchingReview(view?.controller, policyReview); policyReviewError = '';
    if (response?.tabId !== undefined && (response?.result?.type === 'COMMITTED' || response?.opened === true)) selected = String(response.tabId);
    const result = actionFeedback((command as { kind: string }).kind, response);
    renderFeedback(element('feedback'), result);
    text('action-diagnostic', result.detail ? `Last action: ${result.detail}` : '');
    return response;
  } catch {
    view = null; queryAttempted = true;
    const result = actionFeedback((command as { kind: string }).kind, undefined);
    renderFeedback(element('feedback'), result);
  }
  finally { busy = false; ++epoch; render(); }
}

function prepareScope(context: AdapterView['contexts'][number]): void {
  const key = `${context.contextId}:${context.navigationId}:${view?.controller?.snapshot?.policyRevision}`;
  if (preparingScopes.has(key)) return;
  preparingScopes.add(key);
  const ticket = epoch;
  void browser.runtime.sendMessage({ kind: 'PREPARE_ACCESS', tabId: context.tabId }).then(response => {
    const current = selectedContext(view?.contexts ?? [], selected);
    if (ticket === epoch && current?.contextId === context.contextId
      && current.navigationId === context.navigationId && response?.view) {
      view = response.view;
      render();
    }
  }).catch(() => { /* Polling reports unavailable authority; discovery creates no permission. */ })
    .finally(() => { preparingScopes.delete(key); });
}

const sites = initializeSites({
  controller: () => view?.controller, pins: () => pins, propose: send, vault: () => navigate('vault', true), feedback,
  canEdit: () => !busy && canQueueOperation(view?.controller),
  attempted: () => queryAttempted,
  changed: () => queueMicrotask(render),
  position: navigation.value().sites,
  positionChanged: position => navigation.save({ ...navigation.value(), sites: position }),
  verify: () => readVerifiedController(async () => {
    const ticket = ++epoch;
    const response = await browser.runtime.sendMessage({ kind: 'GET_VIEW' });
    if (!response?.view || ticket !== epoch) return null;
    view = response.view; ++epoch; return view!.controller;
  }),
  pin: (id, pinned, hosts) => {
    // Read current pins immediately before the write so another page's unrelated pins survive.
    try { pins = readPins(JSON.parse(localStorage.getItem(pinsStorageKey) ?? 'null')); } catch { return 'UNCERTAIN'; }
    const next = updateDestinationPin(pins, id, pinned, hosts);
    if (next.length > 200) { feedback('You can pin up to 200 destinations.', 'error'); return 'FAILED'; }
    const saved = savePresentation(() => localStorage, pinsStorageKey, JSON.stringify(next));
    if (saved === 'SAVED') { pins = next; return saved; }
    feedback(saved === 'UNCERTAIN' ? 'The pin save outcome could not be verified. Saved policy is unaffected.' : 'Your pin could not be saved. Saved policy is unaffected.', saved === 'UNCERTAIN' ? 'uncertain' : 'error');
    return saved;
  },
});
const homeOrganization = initializeHomeOrganization(() => queueMicrotask(render));
let restoredPage = false;

function render(): void {
  if (disposed) return;
  const focused = document.activeElement;
  text('page-title', section === 'settings' ? 'Settings' : section === 'sites' ? 'Sites & Access' : accessFocused ? 'Destination access' : 'Atlas');
  text('page-eyebrow', section === 'settings' ? 'YOUR SAVED COMMITMENTS' : section === 'sites' ? 'YOUR COMMITTED DESTINATIONS' : accessFocused ? 'A DELIBERATE NEXT STEP' : 'YOUR INTERNET, WITH INTENTION');
  text('page-description', section === 'settings' ? 'Intentional friction and the timing of your commitments.' : section === 'sites' ? 'Prepare destination changes together. Review freely; confirm protected changes in Vault.'
    : accessFocused ? 'Review the selected destination and its current access.' : 'A place for the things you choose.');
  setProperty(document.body.dataset, 'section', section);
  setProperty(document.body.dataset, 'mode', accessFocused ? 'access' : 'control');
  const controller = view?.controller;
  const ready = canQueueOperation(controller);
  const status = controller?.status;
  const startupMessage = startupCopy(view?.startup);
  text('startup-warning', startupMessage);
  setProperty(element('startup-warning'), 'hidden', startupMessage === '');
  text('status', busy ? status === 'COMMITTING' ? 'Saving…' : 'Working…' : ready ? 'Atlas is ready'
    : status === 'UNINITIALIZED' ? 'Setup needed' : status === 'RECONCILING' ? 'Recovery needed'
      : status === 'UNAVAILABLE' ? 'State unavailable' : view?.startup.status === 'FAILED' ? 'Startup failed'
        : queryAttempted && view === null ? 'Atlas is unavailable' : 'Connecting…');
  setProperty(element('status'), 'title', element('status').textContent ?? '');
  if (element('status').dataset.ready !== String(ready)) setProperty(element('status').dataset, 'ready', String(ready));
  setProperty(element('setup'), 'hidden', status !== 'UNINITIALIZED');
  setProperty(element('workspace'), 'hidden', status === 'UNINITIALIZED' || section !== 'home');
  setProperty(element('settings'), 'hidden', section !== 'settings');
  setProperty(element('sites-section'), 'hidden', section !== 'sites');
  setProperty(element('destinations'), 'hidden', accessFocused);
  for (const name of ['home', 'sites', 'settings'] as const) {
    const button = element(`show-${name}`);
    setAttribute(button, 'aria-pressed', String(section === name));
    if (section === name) setAttribute(button, 'aria-current', 'page');
    else setAttribute(button, 'aria-current', null);
  }

  setProperty(element<HTMLButtonElement>('save-setup'), 'disabled', busy || status !== 'UNINITIALIZED');
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
  setProperty(select, 'value', selected);
  const result = context?.latest;
  const decision = result?.type === 'ASSESSMENT' ? result.decision : null;
  const copy = accessCopy(decision);
  const tone = !ready && context !== undefined ? 'unavailable' : copy.tone;
  if (element('access-panel').dataset.tone !== tone) setProperty(element('access-panel').dataset, 'tone', tone);
  text('hostname', context?.hostname ?? (selected === '' ? 'Your next destination' : 'Tab unavailable'));
  text('access-title', !ready && context !== undefined ? 'Waiting for verified state' : copy.title);
  text('access-description', !ready && context !== undefined
    ? 'Access stays paused until Atlas can verify its saved state.' : copy.description);
  text('outcome', !ready && context !== undefined ? 'Unverified' : accessOutcomeLabel(decision));
  text('decision', decision ? `${decision.outcome} · ${decision.reason}`
    : result ? `${result.type}${'reason' in result ? ` · ${result.reason}` : ''}` : 'No current assessment.');
  text('context-detail', context ? `Context: ${context.contextId}\nNavigation: ${context.navigationId}\nContent: ${context.effect}${context.journey?.phase === 'ENDED' ? `\nJourney ${context.journey.id}: ${context.journey.endReason}` : ''}` : '');
  const now = Date.now(); // Display only. Core decides readiness using its injected clock.
  text('deadline', decision?.outcome === 'WAIT' ? `Wait ${countdown(decision.readyAt, now)}`
    : decision?.outcome === 'REQUIRE_CONFIRMATION' ? `Confirm within ${countdown(decision.confirmBy, now)}`
      : decision && 'expiresAt' in decision ? `Access remaining ${countdown(decision.expiresAt, now)}` : '');
  const failedRemoval = context?.effect === 'FAILED';
  setProperty(element('effect-warning'), 'hidden', !failedRemoval);
  text('effect-warning', failedRemoval ? 'Firefox could not remove the document. Close the affected tab.' : '');
  const { pending, grant } = selectedAccessRecord(decision, controller?.snapshot?.accessState, context?.hostname);
  const record = pending ?? grant;
  const preparedScope = context?.accessScope;
  const scope = record === undefined ? (preparedScope?.status === 'READY' ? preparedScope.hostnames : [])
    : record.scopeHostnames ?? [record.hostname];
  const showScope = scope.length > 0 && (decision?.outcome === 'GREYLIST' || decision?.outcome === 'WAIT'
    || decision?.outcome === 'REQUIRE_CONFIRMATION' || decision?.reason === 'ACTIVE_GRANT');
  setProperty(element('access-scope'), 'hidden', !showScope);
  text('access-scope', showScope ? `Temporary access covers exactly: ${scope.join(', ')}` : '');
  const preparing = decision?.outcome === 'GREYLIST' && preparedScope?.status !== 'READY';
  setProperty(element('access-scope-note'), 'hidden', decision?.outcome !== 'GREYLIST');
  text('access-scope-note', preparing ? 'Checking the public site address before preparing your request…'
    : preparedScope?.source === 'CANONICAL_REDIRECT'
      ? 'The site redirects between these addresses. Both will share one wait and one access deadline.'
      : 'Only the exact hostnames shown are covered. Other addresses may need a separate request.');
  if (preparing && ready && context !== undefined && accessFocused && section === 'home') prepareScope(context);
  const journey = context?.journey;
  const activeJourney = ready && journey != null && journey.phase !== 'ENDED' && now < journey.expiresAt;
  setProperty(element('access-panel'), 'hidden', !accessFocused);
  setProperty(element('home-journey'), 'hidden', section !== 'home' || accessFocused || !activeJourney);
  text('home-journey-label', activeJourney ? `${serviceLabel(journey.rootHostname)} · Tab ${context!.tabId} · ${countdown(journey.expiresAt, now)} remaining` : '');
  setProperty(element('show-access'), 'hidden', section !== 'home' || accessFocused || context === undefined || activeJourney);

  const action = (id: string, show: boolean) => {
    setProperty(element(id), 'hidden', !show);
    const button = element<HTMLButtonElement>(id);
    const disabled = busy || !ready || context === undefined;
    if (button.disabled !== disabled) setProperty(button, 'disabled', disabled);
  };
  action('start-access', decision?.outcome === 'GREYLIST');
  if (preparing) setProperty(element<HTMLButtonElement>('start-access'), 'disabled', true);
  text('start-access', preparing ? 'Checking address…' : 'Request temporary access');
  action('confirm-access', decision?.outcome === 'REQUIRE_CONFIRMATION');
  action('cancel-access', pending !== undefined);
  action('open-home', decision?.outcome === 'ALLOW');
  action('start-journey', decision?.reason === 'WHITELISTED' && !activeJourney);
  action('cancel-journey', activeJourney);
  const retry = context?.retry;
  const showRetry = retry != null && decision?.outcome !== 'ALLOW' && ready;
  setProperty(element('ended-journey'), 'hidden', !showRetry);
  text('ended-journey-copy', showRetry ? context?.effect === 'REMOVING'
    ? `Atlas is closing the previous page. You can restart your journey to ${retry.destinationLabel} in a moment.`
    : `${journeyEndCopy(retry.endReason)} Start again from ${retry.rootHostname}.` : '');
  action('restart-journey', showRetry);
  if (context?.effect === 'REMOVING') setProperty(element<HTMLButtonElement>('restart-journey'), 'disabled', true);
  setProperty(element('home-note'), 'hidden', decision?.outcome !== 'REQUIRE_CONFIRMATION' && decision?.outcome !== 'ALLOW');
  setProperty(element('journey-panel'), 'hidden', !activeJourney);
  text('journey-phase', activeJourney ? 'Active' : 'Ended');
  text('journey', journey ? `Journey → ${serviceLabel(journey.rootHostname)}`
    : 'Pure Whitelist navigation automatically starts a bounded redirect Journey.');
  text('journey-time', journey ? activeJourney
    ? `${countdown(journey.expiresAt, now)} left · fixed deadline ${new Date(journey.expiresAt).toLocaleTimeString()}`
    : `Ended · ${journey.endReason?.replaceAll('_', ' ').toLowerCase() ?? 'complete'}` : '');
  const progress = element<HTMLProgressElement>('journey-progress');
  setProperty(progress, 'hidden', !activeJourney);
  if (activeJourney) setProperty(progress, 'value', Math.max(0, (journey.expiresAt - now) / (journey.expiresAt - journey.startedAt)));
  renderSettings(controller, ready, now);
  sites.render(ready && !busy);
  syncSiteFeedback();
  renderHome(controller?.snapshot?.policy, ready);
  renderTemporaryAccess(now);
  if (!restoredPage && ready && sites.session()?.loaded && homeOrganization.session()?.saved) {
    restoredPage = true;
    if (page === 'vault') element<HTMLDetailsElement>('vault-section').open = true;
    const position = navigation.value().pages[page], initialPage = page;
    if (position) requestAnimationFrame(() => {
      if (page !== initialPage) return;
      window.scrollTo({ top: position.scroll, behavior: 'instant' });
      if (page === 'sites') sites.focusSelection();
      else document.getElementById(position.focus)?.focus({ preventScroll: true });
    });
  }
  if (focused instanceof HTMLButtonElement && focused.closest('#access-panel') && (focused.disabled || focused.closest('[hidden]'))
    && accessFocused && section === 'home') element('access-title').focus({ preventScroll: true });
  if (focused instanceof HTMLButtonElement && focused.closest('#vault-section') && (focused.disabled || focused.closest('[hidden]'))
    && section === 'settings') element('vault-heading').focus({ preventScroll: true });
}

function renderTemporaryAccess(now: number): void {
  const summary = homeAccessSummary(view, now);
  const others = summary.journeys.filter(c => String(c.tabId) !== selected);
  const retained = new Set<string>();
  const row = (id: string, name: string, hostnames: readonly string[], label: string, deadline: number, action: string, link: HomeAccessLink) => {
    retained.add(id);
    let record = temporaryRows.get(id);
    if (!record) {
      const node = document.createElement('li'); node.className = 'temporary-row';
      const copy = document.createElement('span'); copy.className = 'temporary-copy';
      const heading = document.createElement('strong'); heading.className = 'temporary-name';
      const scope = document.createElement('span'); scope.className = 'temporary-scope'; copy.append(heading, scope);
      const time = document.createElement('span'); time.className = 'temporary-time';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button';
      record = { node, link }; const current = record;
      button.addEventListener('click', () => void followAccessLink(current.link));
      node.append(copy, time, button); temporaryRows.set(id, record);
    }
    record.link = link;
    setProperty(record.node.querySelector('.temporary-name')!, 'textContent', name);
    setProperty(record.node.querySelector('.temporary-scope')!, 'textContent', `${label} · ${hostnames.join(', ')}`);
    const time = record.node.querySelector<HTMLElement>('.temporary-time')!;
    setProperty(time.dataset, 'expiresAt', String(deadline));
    setProperty(time, 'title', `Deadline ${new Date(deadline).toLocaleTimeString()}`);
    setProperty(record.node.querySelector('button')!, 'textContent', action);
    return record.node;
  };
  reconcileChildren(element('temporary-list'), summary.grants.map(g => row(`grant:${g.requestId}`, serviceLabel(g.hostnames[0]!), g.hostnames,
    'Temporary permission', g.expiresAt, g.link.kind === 'CONTEXT' ? 'Access details' : 'Open site', g.link)));
  reconcileChildren(element('pending-access-list'), summary.pending.map(p => row(`request:${p.requestId}`, serviceLabel(p.hostnames[0]!), p.hostnames,
    p.outcome === 'WAIT' ? 'Waiting' : 'Confirmation available', p.outcome === 'WAIT' ? p.readyAt : p.confirmBy,
    p.link.kind === 'CONTEXT' ? 'Review request' : 'Return to request', p.link)));
  reconcileChildren(element('other-journeys'), others.map(c => row(`journey:${c.contextId}:${c.journey.id}`, serviceLabel(c.journey.rootHostname),
    [c.journey.rootHostname], `Journey active · Tab ${c.tabId}`, c.journey.expiresAt, 'View Journey',
    { kind: 'CONTEXT', tabId: c.tabId, contextId: c.contextId })));
  for (const id of temporaryRows.keys()) if (!retained.has(id)) temporaryRows.delete(id);
  for (const time of element('temporary-section').querySelectorAll<HTMLElement>('.temporary-time')) {
    const label = `${countdown(Number(time.dataset.expiresAt), now)} remaining`;
    if (time.textContent !== label) setProperty(time, 'textContent', label);
  }
  const count = summary.pending.length + summary.grants.length + summary.journeys.length;
  setProperty(element('temporary-section'), 'hidden', summary.available && count === 0);
  setProperty(element('temporary-list'), 'hidden', summary.grants.length === 0);
  setProperty(element('pending-access-list'), 'hidden', summary.pending.length === 0);
  setProperty(element('other-journeys'), 'hidden', others.length === 0);
  setProperty(element('temporary-empty'), 'hidden', true);
  setProperty(element('temporary-unavailable'), 'hidden', summary.available);
  text('temporary-count', summary.available && count > 0 ? `${count} current` : '');
  for (const button of element('temporary-section').querySelectorAll<HTMLButtonElement>('button')) setProperty(button, 'disabled', busy || !summary.available || !canQueueOperation(view?.controller));
}

async function followAccessLink(link: HomeAccessLink): Promise<void> {
  if (busy || !canQueueOperation(view?.controller)) return;
  if (link.kind === 'CONTEXT') {
    const context = view?.contexts.find(c => c.tabId === link.tabId && c.contextId === link.contextId);
    if (!context) { feedback('The owning tab is no longer available. Refresh the access summary.', 'error'); return; }
    selected = String(context.tabId); navigate('access');
  } else {
    const response = await send({ kind: 'OPEN_DESTINATION', url: link.url });
    if (response?.opened === true) navigate('access', true);
  }
}

function renderSettings(controller: AdapterView['controller'] | undefined, ready: boolean, now: number): void {
  const status = controller?.status;
  const policy = controller?.snapshot?.policy;
  const proposal = controller?.snapshot?.vaultState.pendingProposal;
  setProperty(element('settings-pending'), 'hidden', proposal == null);
  setProperty(element('settings-nav-status'), 'hidden', proposal == null);
  const settingsLabel = proposal == null ? 'Settings' : 'Settings, pending change';
  setAttribute(element('show-settings'), 'aria-label', settingsLabel);
  setProperty(element('show-settings'), 'title', settingsLabel);
  const proposalId = proposal?.id ?? null;
  if (controller?.snapshot && proposalId !== displayedProposalId) {
    displayedProposalId = proposalId;
    if (proposalId !== null) element<HTMLDetailsElement>('vault-section').open = true;
  }
  setProperty(element('vault-empty'), 'hidden', proposal != null);
  text('vault-empty', hasCommittedCollection(controller) ? 'No proposal is waiting. Propose timing changes here or destination changes in Sites & Access.'
    : 'Vault status cannot currently be verified. Retry or recover saved state before confirmation.');
  const missingDefaults = presetHostnames.filter((hostname) => !policy?.whitelist.includes(hostname));
  setProperty(element('preset-update'), 'hidden', !policy || missingDefaults.length === 0);
  text('preset-update-status', policy ? missingDefaults.length > 0
    ? `${missingDefaults.length} curated hostnames are missing from your saved Whitelist.`
    : 'Your saved Whitelist includes all current curated hostnames.' : '');
  setProperty(element('propose-defaults'), 'hidden', !policy || missingDefaults.length === 0);
  setProperty(element<HTMLButtonElement>('propose-defaults'), 'disabled', busy || !ready || proposal != null);
  setProperty(element('vault-panel'), 'hidden', proposal == null);
  const review = matchingReview(controller, policyReview);
  renderReview(review, proposal != null);
  text('vault-review', review
    ? `Proposal ${review.proposalId} · policy revision ${review.basePolicyRevision}\nWhitelist additions: ${review.whitelist.added.join(', ') || '(none)'}\nWhitelist removals: ${review.whitelist.removed.join(', ') || '(none)'}\nBlacklist additions: ${review.blacklist.added.join(', ') || '(none)'}\nBlacklist removals: ${review.blacklist.removed.join(', ') || '(none)'}\nClassification changes:\n${review.classifications.map((change) => `${change.hostname}: ${change.before} → ${change.after}`).join('\n') || '(none)'}${review.candidateConfiguration ? `\nCurrent settings: ${settingsCopy(review.currentConfiguration!)}\nCandidate settings: ${settingsCopy(review.candidateConfiguration)}` : ''}`
    : policyReviewError ? `Core review unavailable: ${policyReviewError}. Cancel or recover before proceeding.` : 'Loading the frozen Core review…');
  text('vault-deadline', review?.phase === 'WAITING' ? `Vault wait ${countdown(review.readyAt, now)}`
    : review?.phase === 'READY' ? `Confirm within ${countdown(review.confirmBy, now)}`
      : review?.phase === 'EXPIRED' ? 'This proposal expired. Cancel it before starting a new proposal.' : '');
  setProperty(element('confirm-policy'), 'hidden', review?.phase !== 'READY');
  setProperty(element<HTMLButtonElement>('confirm-policy'), 'disabled', busy || !ready || review?.phase !== 'READY' || now >= review.confirmBy);
  setProperty(element<HTMLButtonElement>('cancel-policy'), 'disabled', busy || !ready);
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
      timingFields.forEach((field) => { setProperty(element<HTMLInputElement>(field.id), 'value', field.value(activeConfiguration)); });
    }
    timingFields.forEach((field) => { text(`active-${field.id}`, `Active: ${field.value(activeConfiguration)} ${field.unit}`); });
  }
  setProperty(element<HTMLButtonElement>('propose-settings'), 'disabled', busy || !ready || proposal != null);
  text('vault-impact', !review ? 'Saved authority remains active. A verified Core review is required before confirmation.'
    : review.invalidatesAccess ? 'Policy changes invalidate current requests, grants and Journeys.'
    : 'Settings changes preserve existing waits, grants and Journey terms. New activity uses the committed settings.');
  setProperty(element<HTMLButtonElement>('recover'), 'disabled', busy || ready || status === 'UNINITIALIZED' || status === 'COMMITTING');
  text('recover', view?.startup.status === 'FAILED' ? 'Retry startup' : 'Reload and reconcile state');
  text('startup-diagnostic', view?.startup.status === 'FAILED' ? `Startup: ${view.startup.stage} · ${view.startup.reason}` : '');
  text('storage-diagnostic', storageDiagnosticsCopy(view?.storage));
  text('policy', controller?.snapshot
    ? `Exact Whitelist hosts: ${policy!.whitelist.length}\nManual Blacklist hosts: ${policy!.blacklist.length}\nPolicy revision: ${controller.snapshot.policyRevision}\nState: ${status}${controller.reason ? ` · ${controller.reason}` : ''}${status === 'UNAVAILABLE' && view?.storage?.lastFailure ? `\n${storageFailureCopy(view.storage)}` : ''}`
    : startupCopy(view?.startup) || 'No verified policy loaded.');
}

function renderHome(policy: Policy | undefined, ready: boolean): void {
  const verified = view?.controller?.status === 'READY' && policy !== undefined;
  if (verified) lastVerifiedPolicy = policy;
  const displayPolicy = verified ? policy : lastVerifiedPolicy ?? policy;
  const destinationKey = JSON.stringify([displayPolicy ?? null, sites.metadata()]);
  if (destinationsKey !== destinationKey) {
    destinationsKey = destinationKey;
    entries = displayPolicy ? destinationIndex(displayPolicy, sites.metadata()) : [];
    homeCatalog = homeCategories(entries, displayPolicy ? policyDestinationIndex(displayPolicy, sites.metadata()) : [], sites.metadata().map(d => d.category));
  }
  const catalog = homeCatalog;
  homeOrganization.observe(catalog, verified);
  const layout = homeOrganization.layout();
  const groups = displayedHomeCategories(layout, catalog).map(category => {
    let group = homeGroups.get(category.key);
    if (!group) {
      group = document.createElement('section'); group.className = 'service-group destination-section';
      setProperty(group.dataset, 'categoryKey', category.key);
      const heading = document.createElement('div'); heading.className = 'section-heading';
      const title = document.createElement('h2');
      const collapse = document.createElement('button'); collapse.type = 'button'; collapse.className = 'category-heading';
      collapse.addEventListener('click', () => void homeOrganization.change(category.key, 'COLLAPSE')); title.append(collapse);
      const count = document.createElement('span'); count.className = 'section-meta';
      heading.append(title, count);
      const grid = document.createElement('div'); grid.className = 'destination-grid';
      grid.id = `destination-category-${homeGroups.size}`;
      setAttribute(collapse, 'aria-controls', grid.id);
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'category-toggle text-button';
      setAttribute(toggle, 'aria-controls', grid.id);
      toggle.addEventListener('click', () => {
        if (expandedCategories.has(category.key)) expandedCategories.delete(category.key);
        else expandedCategories.add(category.key);
        updateDestinationLayout();
      });
      heading.append(toggle);
      group.append(heading, grid); homeGroups.set(category.key, group);
    }
    if (group.dataset.category !== category.label || group.dataset.collapsed !== String(category.collapsed)) layoutDirty = true;
    setProperty(group.dataset, 'category', category.label);
    setProperty(group.dataset, 'collapsed', String(category.collapsed));
    const collapse = group.querySelector<HTMLButtonElement>('.category-heading')!;
    setProperty(collapse, 'textContent', category.label);
    setAttribute(collapse, 'aria-expanded', String(!category.collapsed));
    setAttribute(collapse, 'aria-label', `${category.collapsed ? 'Expand' : 'Collapse'} ${category.label} category`);
    const available = rankDestinations(entries.filter(e => categoryKey(e.category) === category.key), usage, Date.now());
    const grid = group.querySelector<HTMLElement>('.destination-grid')!, key = JSON.stringify(available);
    if (grid.dataset.entries !== key) {
      const focused = document.activeElement as HTMLElement | null;
      const existing = new Map([...grid.children].map(node => [(node as HTMLElement).dataset.destinationId, node as HTMLElement]));
      const cards = available.map(entry => {
        const saved = existing.get(destinationId(entry)), content = JSON.stringify(entry);
        if (saved?.dataset.entry === content) return saved;
        const card = makeDestinationCard(entry); setProperty(card.dataset, 'entry', content); return card;
      });
      setProperty(grid.dataset, 'entries', key); reconcileChildren(grid, cards); layoutDirty = true;
      if (focused?.isConnected && document.activeElement === document.body) focused.focus({ preventScroll: true });
    }
    setProperty(group.querySelector<HTMLElement>('.section-meta')!, 'textContent', `${available.length} destination${available.length === 1 ? '' : 's'}`);
    return group;
  });
  const list = element('destination-list');
  if (JSON.stringify([...list.children].map(c => (c as HTMLElement).dataset.categoryKey)) !== JSON.stringify(groups.map(c => c.dataset.categoryKey))) {
    const focused = document.activeElement as HTMLElement | null, key = focused?.closest<HTMLElement>('[data-category-key]')?.dataset.categoryKey;
    reconcileChildren(list, groups); layoutDirty = true;
    if (focused && !focused.isConnected && key) homeGroups.get(key)?.querySelector<HTMLButtonElement>('.category-heading')?.focus({ preventScroll: true });
  }
  setProperty(element('home-categories-empty'), 'hidden', entries.length === 0 || groups.length > 0);
  renderPins();
  if (layoutDirty) { updateDestinationLayout(); layoutDirty = false; }
  homeOrganization.render();
  renderSearch();
  const state = collectionPresentation(view?.controller, entries.length, queryAttempted, displayPolicy !== undefined);
  setProperty(element('destinations').dataset, 'phase', state.phase);
  text('destination-state-message', state.message);
  setProperty(element('destination-state'), 'hidden', state.phase === 'READY' || state.phase === 'EMPTY');
  setProperty(element('retry-destinations'), 'hidden', state.phase !== 'UNAVAILABLE');
  setProperty(element('open-destination-recovery'), 'hidden', state.phase !== 'UNAVAILABLE');
  setProperty(element('empty-destinations'), 'hidden', state.phase !== 'EMPTY');
  setProperty(element('pinned-empty'), 'hidden', state.phase !== 'READY' && state.phase !== 'EMPTY' || pinnedDestinations(entries, pins).length > 0);
  for (const button of document.querySelectorAll<HTMLButtonElement>('.destination-open, #open-journey')) {
    setProperty(button, 'disabled', busy || !ready || !hasCommittedCollection(view?.controller));
  }
}

/** One category preview row; the same column count also caps expanded and pinned grids. */
function updateDestinationLayout(): void {
  const destinations = element('destinations');
  const width = destinations.getBoundingClientRect().width;
  if (width <= 0) return;
  const styles = getComputedStyle(destinations);
  const minimum = parseFloat(styles.getPropertyValue('--destination-min-width'));
  const gap = parseFloat(styles.getPropertyValue('--destination-gap'));
  const columns = Math.max(1, Math.min(5, Math.floor((width + gap) / (minimum + gap))));
  if (destinations.dataset.columns !== String(columns)) {
    setProperty(destinations.dataset, 'columns', String(columns));
    destinations.style.setProperty('--destination-columns', String(columns));
  }
  for (const group of element('destination-list').querySelectorAll<HTMLElement>('[data-category]')) {
    const grid = group.querySelector<HTMLElement>('.destination-grid')!;
    const toggle = group.querySelector<HTMLButtonElement>('.category-toggle')!;
    const count = group.querySelector<HTMLElement>('.section-meta')!;
    const category = group.dataset.category!, collapsed = group.dataset.collapsed === 'true';
    setProperty(grid, 'hidden', collapsed);
    const expanded = expandedCategories.has(group.dataset.categoryKey!);
    const overflow = grid.children.length > columns;
    if (toggle.hidden !== (!overflow || collapsed)) setProperty(toggle, 'hidden', !overflow || collapsed);
    if (count.hidden !== (overflow && !collapsed)) setProperty(count, 'hidden', overflow && !collapsed);
    const label = expanded ? 'Show fewer' : `Show all ${grid.children.length} →`;
    if (toggle.textContent !== label) setProperty(toggle, 'textContent', label);
    if (toggle.getAttribute('aria-expanded') !== String(expanded)) setAttribute(toggle, 'aria-expanded', String(expanded));
    const accessibleLabel = `${expanded ? 'Show fewer' : 'Show all'} ${category} destinations`;
    if (toggle.getAttribute('aria-label') !== accessibleLabel) setAttribute(toggle, 'aria-label', accessibleLabel);
    for (const [index, child] of [...grid.children].entries()) {
      const card = child as HTMLElement;
      const hidden = collapsed || !expanded && index >= columns;
      if (hidden && card.contains(document.activeElement)) toggle.focus({ preventScroll: true });
      if (card.hidden !== hidden) setProperty(card, 'hidden', hidden);
    }
  }
}
const layoutObserver = new ResizeObserver(updateDestinationLayout);
layoutObserver.observe(element('destinations'));

function icon(name: string): SVGSVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); node.classList.add('icon'); setAttribute(node, 'aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); setAttribute(use, 'href', `#icon-${name}`); node.append(use); return node;
}

async function displayWebsiteIcon(image: HTMLImageElement, hostname: string): Promise<void> {
  setProperty(image.dataset, 'hostname', hostname);
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
  const card = document.createElement('div'); card.className = 'destination-card'; setProperty(card.dataset, 'destinationId', destinationId(entry));
  const points = destinationEntryPoints(entry);
  const addresses = document.createElement('select'); addresses.className = 'service-addresses'; setAttribute(addresses, 'aria-label', `${entry.label} entry point`);
  points.forEach((hostname) => addresses.append(new Option(hostname, hostname))); setProperty(addresses, 'hidden', points.length < 2);
  const open = document.createElement('button'); open.className = 'destination-open'; open.type = 'button'; setAttribute(open, 'aria-label', `Open ${entry.label}`);
  setProperty(open.dataset, 'destinationId', destinationId(entry));
  setProperty(open, 'title', entry.hostnames.join(', '));
  const mark = document.createElement('span'); mark.className = 'service-mark'; setAttribute(mark, 'aria-hidden', 'true');
  const image = document.createElement('img'); image.className = 'site-icon'; image.width = 32; image.height = 32;
  image.alt = ''; image.src = 'site.svg'; image.loading = 'lazy'; setProperty(image.dataset, 'hostname', addresses.value);
  image.addEventListener('error', () => { if (!image.src.endsWith('/site.svg')) image.src = 'site.svg'; });
  mark.append(image); iconObserver.observe(image);
  const copy = document.createElement('span'); copy.className = 'destination-copy';
  const name = document.createElement('span'); name.className = 'destination-name'; setProperty(name, 'textContent', entry.label);
  const host = document.createElement('span'); host.className = 'destination-host'; setProperty(host, 'textContent', addresses.value);
  addresses.addEventListener('change', () => { setProperty(host, 'textContent', addresses.value); setProperty(open, 'title', addresses.value); void displayWebsiteIcon(image, addresses.value); });
  copy.append(name, host); open.append(mark, copy);
  open.addEventListener('click', () => { void send({ kind: 'OPEN_DESTINATION', url: `https://${addresses.value}/` }); });
  const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'pin-button'; setProperty(pin.dataset, 'pinId', destinationId(entry)); setProperty(pin.dataset, 'label', entry.label); pin.append(icon('pin'));
  pin.addEventListener('click', () => { void togglePin(destinationId(entry)); });
  card.append(open, pin);
  if (points.length > 1) {
    const details = document.createElement('details'); details.className = 'entry-points';
    const summary = document.createElement('summary'); setProperty(summary, 'title', `Choose ${entry.label} entry point`);
    setAttribute(summary, 'aria-label', summary.title); summary.append(icon('chevron'));
    details.append(summary, addresses); card.append(details);
  }
  return card;
}

function renderPins(): void {
  const active = pinnedDestinations(entries, pins);
  const key = JSON.stringify(active);
  if (key !== pinnedKey) {
    pinnedKey = key;
    const list = element('pinned-list'), focused = document.activeElement as HTMLElement | null;
    const existing = new Map([...list.children].map(node => [(node as HTMLElement).dataset.destinationId, node as HTMLElement]));
    reconcileChildren(list, active.map(entry => {
      const saved = existing.get(destinationId(entry)), content = JSON.stringify(entry);
      if (saved?.dataset.entry === content) return saved;
      const card = makeDestinationCard(entry); setProperty(card.dataset, 'entry', content); return card;
    }));
    if (focused?.isConnected && document.activeElement === document.body) focused.focus({ preventScroll: true });
  }
  setProperty(element('pinned-empty'), 'hidden', active.length > 0);
  for (const button of document.querySelectorAll<HTMLButtonElement>('.pin-button')) {
    const pinned = active.some(entry => destinationId(entry) === button.dataset.pinId);
    const label = `${pinned ? 'Unpin' : 'Pin'} ${button.dataset.label}`;
    if (button.getAttribute('aria-pressed') !== String(pinned)) setAttribute(button, 'aria-pressed', String(pinned));
    if (button.getAttribute('aria-label') !== label) setAttribute(button, 'aria-label', label);
    if (button.title !== label) setProperty(button, 'title', label);
    const disabled = !pinsLoaded || savingPins || !canQueueOperation(view?.controller);
    if (button.disabled !== disabled) setProperty(button, 'disabled', disabled);
  }
}

function togglePin(id: string): void {
  if (!pinsLoaded || savingPins) return;
  const focused = document.activeElement;
  const pinnedFocus = focused instanceof HTMLButtonElement && focused.closest('#pinned-list') !== null;
  const entry = entries.find(item => destinationId(item) === id);
  const pinned = pinnedDestinations(entries, pins).some(item => destinationId(item) === id);
  const next = updateDestinationPin(pins, id, !pinned, entry?.hostnames);
  if (next.length > 200) { feedback('Your pinned list is full. Unpin a destination first.', 'error'); return; }
  savingPins = true; renderPins();
  try {
    const saved = savePresentation(() => localStorage, pinsStorageKey, JSON.stringify(next));
    if (saved === 'SAVED') { pins = next; feedback('Pin preference saved. Access and policy are unchanged.', 'success'); }
    else feedback(saved === 'FAILED' ? 'Your pin could not be saved. Access and policy are unchanged.' : 'The pin save outcome could not be verified. Access and policy are unchanged.', saved === 'FAILED' ? 'error' : 'uncertain');
  }
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
  const tone = review?.phase === 'WAITING' ? 'wait' : review?.phase === 'READY' ? 'ready' : review?.phase === 'EXPIRED' ? 'expired' : 'unavailable';
  if (element('vault-phase').dataset.tone !== tone) setProperty(element('vault-phase').dataset, 'tone', tone);
  text('vault-phase', review?.phase === 'WAITING' ? 'Waiting' : review?.phase === 'READY' ? 'Ready to confirm' : review?.phase === 'EXPIRED' ? 'Expired' : '');
  text('vault-summary', review ? `${review.phase === 'WAITING' ? 'Saved proposal; waiting period is running.' : review.phase === 'READY' ? 'Confirmation is available. Review the frozen contents before confirming.' : 'The confirmation window has expired.'} Your active policy and settings stay in place until explicit confirmation and a successful save.`
    : hasProposal ? 'Waiting for a verified Core review. Confirmation is unavailable.' : '');
  const key = JSON.stringify(review ? [review.proposalId, review.whitelist, review.blacklist, review.currentConfiguration, review.candidateConfiguration] : null);
  if (key === reviewKey) return;
  reviewKey = key;
  const changes: string[] = [];
  if (review) for (const [label, diff] of [['Whitelist', review.whitelist], ['Blacklist', review.blacklist]] as const) {
    if (diff.added.length > 0) changes.push(`${label} · add: ${diff.added.join(', ')}`);
    if (diff.removed.length > 0) changes.push(`${label} · remove: ${diff.removed.join(', ')}`);
  }
  element('vault-changes').replaceChildren(...changes.map((value) => { const li = document.createElement('li'); setProperty(li, 'textContent', value); return li; }));
  setProperty(element('vault-changes'), 'hidden', changes.length === 0);
  const rows = review?.currentConfiguration && review.candidateConfiguration ? timingFields.flatMap((field) => {
    const current = field.value(review.currentConfiguration!);
    const proposed = field.value(review.candidateConfiguration!);
    if (current === proposed) return [];
    const row = document.createElement('tr');
    for (const cell of [field.label, `${current} ${field.unit}`, `${proposed} ${field.unit}`]) {
      const td = document.createElement('td'); setProperty(td, 'textContent', cell); row.append(td);
    }
    return [row];
  }) : [];
  element('vault-settings-rows').replaceChildren(...rows);
  setProperty(element('vault-settings-comparison'), 'hidden', rows.length === 0);
}

function renderSearch(): void {
  const inputsKey = `${destinationsKey}\n${searchInput.value}`;
  if (inputsKey !== searchInputsKey) {
    searchInputsKey = inputsKey;
    const next = searchDestinationTargets(entries, searchInput.value);
    const key = JSON.stringify([searchInput.value, next]);
    if (key !== searchKey) {
      searchKey = key; matches = next; highlighted = next.length === 1 ? 0 : -1;
      element('search-results').replaceChildren(...matches.map(({ entry, hostname }, index) => {
        const button = document.createElement('button'); button.type = 'button'; button.id = `search-result-${index}`;
        setAttribute(button, 'role', 'option');
        // The combobox keeps one keyboard focus; arrows select its active descendant.
        button.tabIndex = -1;
        button.addEventListener('mousedown', (event) => { event.preventDefault(); });
        const copy = document.createElement('span'); copy.className = 'result-copy';
        const label = document.createElement('strong'); setProperty(label, 'textContent', entry.label);
        const host = document.createElement('small'); setProperty(host, 'textContent', hostname);
        copy.append(label, host); button.append(copy, icon('arrow'));
        button.addEventListener('click', () => { if (!button.disabled) void send({ kind: 'OPEN_DESTINATION', url: `https://${hostname}/` }); });
        return button;
      }));
    }
  }
  setProperty(element('search-results'), 'hidden', matches.length === 0);
  setProperty(element('search-empty'), 'hidden', !hasCommittedCollection(view?.controller) || searchInput.value.trim() === '' || matches.length > 0);
  setAttribute(searchInput, 'aria-expanded', String(matches.length > 0));
  if (highlighted >= 0) setAttribute(searchInput, 'aria-activedescendant', `search-result-${highlighted}`);
  else setAttribute(searchInput, 'aria-activedescendant', null);
  for (const [index, button] of [...element('search-results').children].entries()) {
    setAttribute(button, 'aria-selected', String(index === highlighted));
    setProperty((button as HTMLButtonElement), 'disabled', busy || !hasCommittedCollection(view?.controller));
  }
}
searchInput.addEventListener('input', () => { renderSearch(); });
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { setProperty(searchInput, 'value', ''); renderSearch(); }
  if (matches.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault(); highlighted = (highlighted + (event.key === 'ArrowDown' ? 1 : highlighted < 0 ? 0 : -1) + matches.length) % matches.length; renderSearch();
    element(`search-result-${highlighted}`).scrollIntoView({ block: 'nearest' });
  }
});
element('search-form').addEventListener('submit', (event) => {
  event.preventDefault(); const entry = matches[highlighted] ?? (matches.length === 1 ? matches[0] : undefined);
  if (entry && !busy && hasCommittedCollection(view?.controller)) void send({ kind: 'OPEN_DESTINATION', url: `https://${entry.hostname}/` });
});
function rememberPage(): void {
  const focus = document.activeElement as HTMLElement | null;
  navigation.save({ ...navigation.value(), tab: selected, sites: sites.navigation(),
    pages: { ...navigation.value().pages, [page]: { scroll: window.scrollY, focus: focus?.id ?? '' } } });
}
function navigate(name: NavigationTarget, preserveFeedback = false, fromHistory = false): void {
  rememberPage();
  if (!preserveFeedback) feedback('');
  if (!fromHistory && page !== name) history.pushState(null, '', `#${name}`);
  page = name; section = name === 'vault' ? 'settings' : name === 'access' ? 'home' : name;
  accessFocused = name === 'access';
  render();
  const target = name === 'vault' ? element<HTMLDetailsElement>('vault-section') : name === 'access' ? element('access-panel') : element('main-content');
  if (target instanceof HTMLDetailsElement) target.open = true;
  if (name === 'sites') sites.focusSelection();
  else (target.id === 'main-content' ? target : target.querySelector<HTMLElement>('summary, h2') ?? target).focus({ preventScroll: true });
  const initialFocus = document.activeElement;
  const saved = navigation.value().pages[name];
  requestAnimationFrame(() => {
    if (page !== name) return;
    if (saved) window.scrollTo({ top: saved.scroll, behavior: 'instant' }); else target.scrollIntoView({ block: 'start' });
    if (saved?.focus && document.activeElement === initialFocus && fromHistory) {
      const remembered = document.getElementById(saved.focus);
      if (remembered && !remembered.closest('[hidden]')) remembered.focus({ preventScroll: true });
    }
  });
}
history.replaceState(null, '', `#${page}`);
history.scrollRestoration = 'manual';
window.addEventListener('popstate', () => { navigate(atlasPage(location.hash.slice(1)) ?? 'home', true, true); });
window.addEventListener('pagehide', rememberPage);
element('return-to-sites').addEventListener('click', () => navigate('sites', true));
for (const name of ['home', 'sites', 'settings'] as const) element(`show-${name}`).addEventListener('click', () => { navigate(name); });
element('brand-home').addEventListener('click', (event) => { event.preventDefault(); navigate('home'); });
element('review-pending').addEventListener('click', () => { navigate('vault'); });
element('retry-destinations').addEventListener('click', () => { void poll(); });
for (const id of ['open-destination-recovery', 'sites-recovery']) element(id).addEventListener('click', () => {
  navigate('settings'); element<HTMLDetailsElement>('recovery-section').open = true; element('recover').focus();
});
for (const id of ['home-journey', 'show-access']) element(id).addEventListener('click', () => {
  navigate('access');
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
  if (candidateConfiguration === null) { feedback('Use positive values in whole milliseconds and a whole hop limit.', 'error'); return; }
  element('propose-defaults').closest('details')!.open = true;
  void send({ kind: 'PROPOSE_SETTINGS', candidateConfiguration }).then(response => {
    if (response?.result?.type === 'COMMITTED') navigate('vault', true);
  });
});

function diagnostics(): Promise<void> {
  if (disposed || document.hidden || section !== 'settings' || !element<HTMLDetailsElement>('diagnostics').open) {
    ++diagnosticEpoch; diagnosticRequest = null; return Promise.resolve();
  }
  const tabId = element<HTMLSelectElement>('diagnostic-scope').value === 'all' ? null : Number(selected || -1);
  if (diagnosticRequest?.scope === tabId) return diagnosticRequest.pending;
  const ticket = ++diagnosticEpoch;
  const pending = loadDiagnostics(tabId, ticket).finally(() => { if (diagnosticRequest?.pending === pending) diagnosticRequest = null; });
  diagnosticRequest = { scope: tabId, pending }; return pending;
}
async function loadDiagnostics(tabId: number | null, ticket: number): Promise<void> {
  try {
    const response = await browser.runtime.sendMessage({ kind: 'GET_DIAGNOSTICS', tabId });
    if (ticket !== diagnosticEpoch || disposed || section !== 'settings' || !element<HTMLDetailsElement>('diagnostics').open) return;
    if (!Array.isArray(response?.entries)) throw new Error('DIAGNOSTICS_UNAVAILABLE');
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
  } catch { if (ticket === diagnosticEpoch) feedback('Diagnostics are temporarily unavailable.', 'error'); }
}

select.addEventListener('change', () => { selected = select.value; rememberPage(); render(); void diagnostics(); });
element('setup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const hosts = (id: string) => element<HTMLTextAreaElement>(id).value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const defaults = element<HTMLInputElement>('use-defaults').checked ? compileCuratedWhitelist().whitelist : [];
  void send({ kind: 'SETUP', policy: { whitelist: [...new Set([...defaults, ...hosts('whitelist')])], blacklist: hosts('blacklist') } });
});
element('journey-form').addEventListener('submit', (event) => {
  event.preventDefault(); void send({ kind: 'OPEN_DESTINATION', url: element<HTMLInputElement>('destination').value.trim() });
});
element('start-access').addEventListener('click', () => {
  const context = selectedContext(view?.contexts ?? [], selected);
  if (context?.accessScope?.status === 'READY')
    void send({ kind: 'START_ACCESS', tabId: context.tabId, scopeId: context.accessScope.id });
});
for (const [id, kind] of Object.entries({ 'open-home': 'OPEN_HOME',
  'start-journey': 'START_JOURNEY', 'cancel-journey': 'CANCEL_JOURNEY' }))
  element(id).addEventListener('click', () => { if (selected !== '') void send({ kind, tabId: Number(selected) }); });
for (const [id, kind] of Object.entries({ 'confirm-access': 'CONFIRM_ACCESS_AND_OPEN', 'cancel-access': 'CANCEL_ACCESS' })) {
  element(id).addEventListener('click', () => {
    const context = selectedContext(view?.contexts ?? [], selected);
    const decision = context?.latest?.type === 'ASSESSMENT' ? context.latest.decision : null;
    const { pending } = selectedAccessRecord(decision, view?.controller?.snapshot?.accessState, context?.hostname);
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
  ++diagnosticEpoch; diagnosticRequest = null;
  void browser.runtime.sendMessage({ kind: 'CLEAR_DIAGNOSTICS' }).then(() => diagnostics()).catch(() => feedback('Could not clear diagnostics.', 'error'));
});
element('export-diagnostics').addEventListener('click', () => {
  const tabId = element<HTMLSelectElement>('diagnostic-scope').value === 'all' ? null : Number(selected || -1);
  void browser.runtime.sendMessage({ kind: 'GET_DIAGNOSTICS', tabId }).then((response) => {
    if (!Array.isArray(response?.entries)) throw new Error('Unavailable');
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'atlas-diagnostics-v1', entries: response.entries, storage: response.storage ?? null }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'atlas-diagnostics.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }).catch(() => feedback('Could not export diagnostics.', 'error'));
});
async function refreshView(): Promise<void> {
  const ticket = epoch;
  try {
    const response = await browser.runtime.sendMessage({ kind: 'GET_VIEW' });
    if (!response?.view) throw new Error('VIEW_UNAVAILABLE');
    if (ticket === epoch && response?.view) {
      queryAttempted = true;
      view = response.view;
      const proposalId = view?.controller?.snapshot?.vaultState.pendingProposal?.id;
      if (proposalId !== undefined && !busy && needsPolicyReview(view?.controller, policyReview, Date.now())) {
        const reviewed = await browser.runtime.sendMessage({ kind: 'REVIEW_POLICY', proposalId });
        if (ticket === epoch && reviewed?.view) {
          view = reviewed.view;
          policyReview = reviewed.result?.type === 'REVIEW' ? reviewed.result.review : null;
          policyReviewError = reviewed.result?.reason ?? '';
        }
      } else if (proposalId === undefined) { policyReview = null; policyReviewError = ''; }
      if (ticket === epoch) render();
      if (ticket === epoch) void homeOrganization.refresh();
      if (ticket === epoch) void sites.refresh();
    }
    await diagnostics();
  } catch { if (ticket === epoch) { queryAttempted = true; view = null; policyReview = null; render(); } }
}
const refreshLoop = new RefreshLoop(refreshView, { delay: () =>
  view?.controller?.status === 'COMMITTING' || view?.controller?.status === 'LOADING' ? 100 : 1000 });
function poll(): Promise<void> { return refreshLoop.request(); }
document.addEventListener('visibilitychange', () => {
  ++epoch; ++diagnosticEpoch; diagnosticRequest = null; refreshLoop.setActive(!document.hidden);
  if (!document.hidden) render();
});
window.addEventListener('pagehide', () => {
  disposed = true; ++epoch; refreshLoop.dispose(); iconObserver.disconnect(); layoutObserver.disconnect();
  browser.tabs.onUpdated.removeListener(observeWebsiteIcon);
  for (const promise of websiteIcons.values()) void promise.then(url => { if (url) URL.revokeObjectURL(url); });
  websiteIcons.clear(); observedIcons.clear();
});
window.addEventListener('storage', (event) => {
  if (event.key !== pinsStorageKey && event.key !== destinationUsageKey && event.key !== null) return;
  const before = JSON.stringify([pins, usage]);
  try {
    if (event.key === pinsStorageKey || event.key === null) pins = readPins(JSON.parse(localStorage.getItem(pinsStorageKey) ?? 'null'));
    if (event.key === destinationUsageKey || event.key === null) usage = readDestinationUsage(JSON.parse(localStorage.getItem(destinationUsageKey) ?? 'null'));
  } catch { /* Invalid presentation data cannot change permissions. */ }
  if (before !== JSON.stringify([pins, usage])) render();
});
element('restart-journey').addEventListener('click', () => {
  const context = selectedContext(view?.contexts ?? [], selected);
  if (context?.retry) void send({ kind: 'RESTART_JOURNEY', tabId: context.tabId, journeyId: context.retry.journeyId });
});
function observeWebsiteIcon(_tabId: number, changes: browser.tabs._OnUpdatedChangeInfo, tab: browser.tabs.Tab): void {
  if ((!changes.favIconUrl && !changes.url) || !tab.url || !tab.favIconUrl) return;
  try {
    const hostname = new URL(tab.url).hostname;
    if (observedIcons.get(hostname) === tab.favIconUrl) return;
    observedIcons.set(hostname, tab.favIconUrl);
    const previous = websiteIcons.get(hostname); websiteIcons.delete(hostname);
    if (previous) void previous.then(url => { if (url) URL.revokeObjectURL(url); });
    for (const image of document.querySelectorAll<HTMLImageElement>('.site-icon')) if (image.dataset.hostname === hostname)
      void displayWebsiteIcon(image, hostname);
  } catch { /* Missing/unsupported website metadata creates no icon or permission. */ }
}
browser.tabs.onUpdated.addListener(observeWebsiteIcon);
try { pins = readPins(JSON.parse(localStorage.getItem(pinsStorageKey) ?? 'null')); }
catch { feedback('Pinned destinations are unavailable. Your saved policy is unaffected.', 'error'); }
pinsLoaded = true;
try { usage = readDestinationUsage(JSON.parse(localStorage.getItem(destinationUsageKey) ?? 'null')); }
catch { usage = {}; }
render();
refreshLoop.setActive(!document.hidden);
