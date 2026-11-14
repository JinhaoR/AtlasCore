import { initializeBookmarkSync } from './bookmark-sync.js';
import { presentationView, setPin } from './presentation-client.js';
import { initializeHomeShortcuts } from './home-shortcuts.js';
import { initializeHomePins } from './home-pins.js';
import { pinAccessStatus } from './pin-status.js';
import { initializeSettingsNavigation } from './settings-navigation.js';
import { viewportScrollSurface } from './viewport-scroll.js';
import { initializeDiagnosticsPanel } from './diagnostics-panel.js';
import { destinationIndex, policyDestinationIndex, searchDestinationTargets } from './destinations.js';
import { homeCategories } from './home-layout.js';
import { initializeHomeOrganization } from './home-organization.js';
import { initializeHomeGreylist } from './home-greylist.js';
import { atlasPage, navigationMemory } from './navigation-state.js';
import { readVerifiedController } from './verified-view.js';
import { collectionPresentation, hasCommittedCollection } from './data-view.js';
import { actionFeedback, renderFeedback } from './feedback.js';
import { destinationId, pinnedDestinations, readPins, updateDestinationPin } from './home-model.js';
import { initializeSites } from './sites.js';
import { initializeDestinationCards, icon } from './destination-cards.js';
import { authorityInterruptionCopy, canQueueOperation, countdown, selectedContext, startupCopy, storageFailureCopy } from './presentation.js';
import { configurationFromDraft, createPresetCoverage, settingsCopy, timingFields } from './settings-model.js';
import { compileCuratedWhitelist, curatedWhitelist, serviceLabel } from '../presets/curated-whitelist.js';
import {} from '@atlas/core';
import { setAttribute, setProperty } from './dom.js';
import { RefreshLoop } from './refresh-loop.js';
import { matchingReview, needsPolicyReview } from './vault-presentation.js';
const element = (id) => document.getElementById(id);
const text = (id, value) => { const node = element(id); if (node.textContent !== value)
    setProperty(node, 'textContent', value); };
const params = new URL(location.href).searchParams;
const navigation = navigationMemory({ getItem: key => sessionStorage.getItem(key), setItem: (key, value) => sessionStorage.setItem(key, value) });
// Tab identity belongs to explicit access details, never to a Home launcher.
let selected = (((!location.hash && params.get('view') === 'access') || location.hash === '#access') ? params.get('tab') : null) ?? '';
let view = null;
let lastVerifiedPolicy;
let queryAttempted = false;
let busy = false;
let disposed = false;
let renderQueued = false;
/** Several field/session callbacks can describe the same event-loop state. */
function requestRender() {
    if (disposed || renderQueued)
        return;
    renderQueued = true;
    queueMicrotask(() => { if (renderQueued && !disposed) {
        renderQueued = false;
        render();
    } });
}
let epoch = 0;
const preparingScopes = new Set();
let destinationsKey = '';
let policyReview = null;
let policyReviewError = '';
let page = atlasPage(location.hash.slice(1)) ?? (params.get('view') === 'access' ? 'access' : 'home');
let section = page === 'vault' ? 'settings' : page;
let settingsKey = '';
let entries = [];
let matches = [];
let searchKey = '';
let searchInputsKey = '';
let highlighted = -1;
let searchOpen = false;
let searchActions = [];
const pinsStorageKey = 'atlas-home-pins-v1';
let pins = [];
let pinsLoaded = false;
let savingPins = false;
let reviewKey = '';
const homeGreylist = initializeHomeGreylist({ send, prepare: prepareScope, label: serviceLabel, dismiss: dismissGreylist });
let homeCatalog = [];
const searchInput = element('destination-search');
const destinationCards = initializeDestinationCards({ open: url => send({ kind: 'OPEN_DESTINATION', url }), togglePin });
const homePins = initializeHomePins({ siteMark: destinationCards.siteMark, open: url => send({ kind: 'OPEN_DESTINATION', url }), togglePin, changed: requestRender,
    status: url => pinAccessStatus(view, url, Date.now()) });
const bookmarkSync = initializeBookmarkSync(requestRender);
const diagnosticPanel = initializeDiagnosticsPanel({ visible: () => page === 'settings' && !element('diagnostics').hidden, selected: () => selected, feedback });
const settingsNavigation = initializeSettingsNavigation({ initial: history.state?.atlasSettings,
    remember: () => { if (page === 'settings')
        history.pushState(historyData(), '', '#settings'); requestRender(); } });
const presetHostnames = compileCuratedWhitelist().whitelist;
const presetCoverage = createPresetCoverage(presetHostnames);
setProperty(document.body.dataset, 'mode', 'control');
element('preset-preview').replaceChildren(...curatedWhitelist.map((group) => {
    const detail = document.createElement('details');
    detail.className = 'preset-group';
    const summary = document.createElement('summary');
    setProperty(summary, 'textContent', group.label);
    const content = document.createElement('p');
    setProperty(content, 'textContent', group.services.map((service) => service.label).join(' · '));
    detail.append(summary, content);
    return detail;
}));
function feedback(message, tone = 'status') {
    renderFeedback(element('feedback'), { message, tone });
    element('feedback').dataset.source = '';
    syncSiteFeedback();
}
function syncSiteFeedback() {
    const local = element('site-save-feedback'), global = element('feedback');
    setProperty(local, 'hidden', !local.textContent || section !== 'sites' || !element('sites-editor').open && !global.hidden && local.textContent === global.textContent);
}
async function send(command) {
    if (busy)
        return;
    busy = true;
    ++epoch;
    render();
    try {
        const response = await browser.runtime.sendMessage(command);
        if (response?.view)
            view = response.view;
        policyReview = matchingReview(view?.controller, policyReview);
        policyReviewError = '';
        const result = actionFeedback(command.kind, response);
        renderFeedback(element('feedback'), result);
        text('action-diagnostic', result.detail ? `Last action: ${result.detail}` : '');
        return response;
    }
    catch {
        view = null;
        queryAttempted = true;
        const result = actionFeedback(command.kind, undefined);
        renderFeedback(element('feedback'), result);
    }
    finally {
        busy = false;
        ++epoch;
        render();
    }
}
function prepareScope(context) {
    const key = `${context.contextId}:${context.navigationId}:${view?.controller?.snapshot?.policyRevision}`;
    if (preparingScopes.has(key))
        return;
    preparingScopes.add(key);
    const ticket = epoch;
    void browser.runtime.sendMessage({ kind: 'PREPARE_ACCESS', tabId: context.tabId }).then(response => {
        const current = selectedContext(view?.contexts ?? [], selected);
        if (ticket === epoch && current?.contextId === context.contextId
            && current.navigationId === context.navigationId && response?.view) {
            view = response.view;
            render();
        }
    }).catch(() => { })
        .finally(() => { preparingScopes.delete(key); });
}
function dismissGreylist(contextId, navigationId) {
    const context = view?.contexts.find(c => String(c.tabId) === selected);
    if (context?.contextId !== contextId || context.navigationId !== navigationId)
        return;
    selected = '';
    // Clear the intercepted route too, so reloading Home cannot resurrect the
    // cancelled prompt. A new explicit navigation can still request access normally.
    const url = new URL(location.href);
    url.searchParams.delete('tab');
    url.searchParams.delete('view');
    history.replaceState(history.state, '', url);
    requestRender();
}
const sites = initializeSites({
    initialView: history.state?.atlasSitesView,
    initialDirectory: history.state?.atlasSitesDirectory,
    directoryChanged: () => { if (page === 'sites')
        history.pushState(historyData(), '', '#sites'); },
    categoryIcon: (key, label) => homeOrganization.icon(key, label),
    categoryOrder: () => homeOrganization.orderKeys(),
    categoryOrderMode: () => homeOrganization.orderMode(),
    renderCategories: groups => renderDirectoryCategories(groups, null, homeOrganization.canMove()),
    initialSelection: history.state?.atlasSitesSelection,
    viewChanged: () => { if (page === 'sites')
        history.pushState(historyData(), '', '#sites'); },
    siteMark: destinationCards.siteMark,
    controller: () => view?.controller, pins: () => presentationView()?.pins ?? pins, propose: send, vault: () => navigate('vault', true),
    feedback: (message, tone = 'status') => {
        // Routine local draft progress belongs beside the workspace; actionable
        // failures still use the shared error surface and retain retry controls.
        if (tone === 'error' || tone === 'uncertain') {
            feedback(message, tone);
            element('feedback').dataset.source = 'sites';
        }
        else if (element('feedback').dataset.source === 'sites')
            feedback('');
        else
            syncSiteFeedback();
    },
    canEdit: () => !busy && canQueueOperation(view?.controller),
    attempted: () => queryAttempted && view?.startup?.status !== 'LOADING',
    changed: requestRender,
    position: navigation.value().sites,
    positionChanged: position => navigation.save({ ...navigation.value(), sites: position }),
    verify: () => readVerifiedController(async () => {
        const ticket = ++epoch;
        const response = await browser.runtime.sendMessage({ kind: 'GET_VIEW' });
        if (!response?.view || ticket !== epoch)
            return null;
        view = response.view;
        ++epoch;
        return view.controller;
    }),
    pin: async (id, pinned, hosts) => {
        const result = await setPin(id, pinned, hosts);
        if (result === 'SAVED')
            pins = presentationView().pins;
        else
            feedback('Your pin could not be verified as saved. Retry the pin change; access rules are unchanged.', 'error');
        return result;
    },
});
const homeOrganization = initializeHomeOrganization(requestRender);
const renderDirectoryCategories = initializeHomeShortcuts(element('sites-categories'), key => sites.chooseCategory(key), (key, target) => homeOrganization.reorder(key, target, [...element('sites-categories').children].map(n => n.dataset.categoryKey)), 'sites-list');
let restoredPage = false;
function render() {
    if (disposed)
        return;
    renderQueued = false;
    const focused = document.activeElement;
    text('page-title', page === 'vault' ? 'Vault' : section === 'settings' ? 'Settings' : section === 'sites' ? 'All sites' : section === 'access' ? 'Greylist & Journeys' : 'Atlas');
    text('page-eyebrow', section === 'settings' ? 'YOUR SAVED COMMITMENTS' : section === 'sites' ? 'YOUR COMMITTED DESTINATIONS' : 'YOUR INTERNET, WITH INTENTION');
    text('page-description', page === 'vault' ? 'Review your commitments. Active rules stay in place until a change is confirmed and saved.' : section === 'settings' ? 'Intentional friction and the timing of your commitments.' : section === 'sites' ? 'Your complete collection. Select a site to review or edit its access.'
        : 'A place for the things you choose.');
    setProperty(document.body.dataset, 'section', section);
    setProperty(document.body.dataset, 'page', page);
    text('vault-section-title', page === 'vault' ? 'Proposal review' : 'Vault');
    setProperty(document.body.dataset, 'mode', 'control');
    const controller = view?.controller;
    const ready = canQueueOperation(controller);
    const status = controller?.status;
    const startupMessage = startupCopy(view?.startup);
    text('startup-warning', startupMessage);
    setProperty(element('startup-warning'), 'hidden', startupMessage === '');
    setProperty(element('setup'), 'hidden', status !== 'UNINITIALIZED');
    setProperty(element('workspace'), 'hidden', status === 'UNINITIALIZED' || section !== 'home');
    setProperty(element('settings'), 'hidden', section !== 'settings');
    settingsNavigation.render(section === 'settings', page === 'vault' ? 'vault-section' : undefined);
    setAttribute(element('show-vault'), 'aria-current', page === 'vault' ? 'page' : 'false');
    setAttribute(element('show-vault'), 'aria-pressed', String(page === 'vault'));
    setProperty(element('sites-section'), 'hidden', section !== 'sites');
    setProperty(element('access-section'), 'hidden', section !== 'access');
    setProperty(element('destinations'), 'hidden', false);
    for (const name of ['home', 'sites', 'access', 'settings']) {
        const button = element(`show-${name}`);
        setAttribute(button, 'aria-pressed', String(section === name));
        if (section === name)
            setAttribute(button, 'aria-current', 'page');
        else
            setAttribute(button, 'aria-current', null);
    }
    setProperty(element('save-setup'), 'disabled', busy || status !== 'UNINITIALIZED');
    const now = Date.now(); // Display only; controller uses its injected clock.
    renderSettings(controller, ready, now);
    renderHome(controller?.snapshot?.policy, ready);
    sites.render(ready && !busy);
    syncSiteFeedback();
    homeGreylist.render(view, now, busy, selected);
    if (!restoredPage && ready && sites.session()?.loaded && homeOrganization.session()?.saved) {
        restoredPage = true;
        const position = navigation.value().pages[page], initialPage = page;
        if (position)
            requestAnimationFrame(() => {
                if (page !== initialPage)
                    return;
                viewportScrollSurface(page, sites.view()).scrollTop = position.scroll;
                if (page === 'sites')
                    sites.focusSelection();
                else
                    document.getElementById(position.focus)?.focus({ preventScroll: true });
            });
    }
    if (focused instanceof HTMLButtonElement && focused.closest('#vault-section') && (focused.disabled || focused.closest('[hidden]'))
        && section === 'settings')
        element('vault-heading').focus({ preventScroll: true });
}
function renderSettings(controller, ready, now) {
    const status = controller?.status;
    const policy = controller?.snapshot?.policy;
    const proposal = controller?.snapshot?.vaultState.pendingProposal;
    setProperty(element('settings-pending'), 'hidden', proposal == null);
    setProperty(element('settings-nav-status'), 'hidden', proposal == null);
    const settingsLabel = proposal == null ? 'Settings' : 'Settings, pending change';
    setAttribute(element('show-settings'), 'aria-label', settingsLabel);
    setProperty(element('show-settings'), 'title', settingsLabel);
    setProperty(element('vault-empty'), 'hidden', proposal != null);
    text('vault-empty', hasCommittedCollection(controller) ? 'No proposal is waiting. Prepare site changes in All sites or timing changes in Settings.'
        : 'Vault status cannot currently be verified. Retry or recover saved state before confirmation.');
    // This optional 294-host projection measured ~75 ms on first load. Do it only
    // when its Settings section is actually opened, retaining Core evaluation.
    const showCoverage = page === 'settings' && settingsNavigation.value() === 'recovery-section';
    const missingDefaults = showCoverage ? presetCoverage(policy) : null;
    setProperty(element('preset-update'), 'hidden', false);
    if (missingDefaults)
        text('preset-update-status', policy ? missingDefaults.length > 0
            ? `${missingDefaults.length} curated hostnames are missing from your saved Allowed sites.`
            : 'Your saved Allowed sites includes all current curated hostnames.' : 'Saved policy is unavailable. Curated coverage cannot be verified.');
    setProperty(element('propose-defaults'), 'hidden', !policy || missingDefaults === null || missingDefaults.length === 0);
    setProperty(element('propose-defaults'), 'disabled', busy || !ready || proposal != null);
    setProperty(element('vault-panel'), 'hidden', proposal == null);
    const vaultReturn = element('return-to-sites'), vaultActions = element(proposal ? 'vault-protection-actions' : 'vault-empty-actions');
    if (vaultReturn.parentElement !== vaultActions)
        vaultActions.append(vaultReturn);
    setProperty(element('vault-empty-actions'), 'hidden', proposal != null);
    const review = matchingReview(controller, policyReview);
    renderReview(review, proposal != null);
    text('vault-review', review
        ? `Proposal ${review.proposalId} · policy revision ${review.basePolicyRevision}\nAllowed sites additions: ${review.whitelist.added.join(', ') || '(none)'}\nAllowed sites removals: ${review.whitelist.removed.join(', ') || '(none)'}\nBlocked sites additions: ${review.blacklist.added.join(', ') || '(none)'}\nBlocked sites removals: ${review.blacklist.removed.join(', ') || '(none)'}${review.whitelistSubdomains ? `\nAll-subdomain bases added: ${review.whitelistSubdomains.added.join(', ') || '(none)'}\nAll-subdomain bases removed: ${review.whitelistSubdomains.removed.join(', ') || '(none)'}` : ''}\nClassification changes:\n${review.classifications.map((change) => `${change.hostname}: ${change.before} → ${change.after}`).join('\n') || '(none)'}${review.candidateConfiguration ? `\nCurrent settings: ${settingsCopy(review.currentConfiguration)}\nCandidate settings: ${settingsCopy(review.candidateConfiguration)}` : ''}`
        : policyReviewError ? `Core review unavailable: ${policyReviewError}. Cancel or recover before proceeding.` : 'Loading the frozen Core review…');
    text('vault-deadline', review?.phase === 'WAITING' ? `Vault wait ${countdown(review.readyAt, now)}`
        : review?.phase === 'READY' ? `Confirm within ${countdown(review.confirmBy, now)}`
            : review?.phase === 'EXPIRED' ? 'This proposal expired. Cancel it before starting a new proposal.' : '');
    text('vault-ready-at', review?.phase === 'WAITING' ? `Ready at ${new Date(review.readyAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : review?.phase === 'READY' ? `Confirm by ${new Date(review.confirmBy).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : review?.phase === 'EXPIRED' ? 'Confirmation expired' : proposal ? 'Review unavailable' : '');
    setProperty(element('vault-ready-at'), 'title', review
        ? `Ready at ${new Date(review.readyAt).toLocaleString()}. Confirm by ${new Date(review.confirmBy).toLocaleString()}.` : '');
    setProperty(element('confirm-policy'), 'hidden', review?.phase !== 'READY');
    setProperty(element('confirm-policy'), 'disabled', busy || !ready || review?.phase !== 'READY' || now >= review.confirmBy);
    setProperty(element('cancel-policy'), 'disabled', busy || !ready);
    const managed = view?.managed;
    text('managed-status', managed?.active ? `Status: active · ${managed.count.toLocaleString()} domains` : 'Managed data is loading or unavailable.');
    text('managed-details', managed ? `Categories: ${managed.categories.join(' + ')}. Last updated: ${managed.lastUpdatedAt === null ? 'bundled offline snapshot' : new Date(managed.lastUpdatedAt).toLocaleString()}. Upstream: ${managed.upstreamDate ?? 'unknown'}.` : '');
    text('managed-source', managed ? `Origin: ${managed.origin}\nUpdate: ${managed.updateStatus}\nLast attempt: ${managed.lastAttemptAt === null ? 'none' : new Date(managed.lastAttemptAt).toLocaleString()}\nSource: ${managed.sourceUrl}\nVersion: ${managed.upstreamVersion ?? 'unknown'}\nUnsupported names skipped: ${managed.ignoredNames}` : '');
    text('managed-conflicts', managed ? `Allowed sites exceptions in managed data (${managed.conflicts.length}): ${managed.conflicts.join(', ') || 'none'}.` : '');
    const activeConfiguration = controller?.snapshot?.configuration;
    if (activeConfiguration) {
        const configKey = JSON.stringify(activeConfiguration);
        if (configKey !== settingsKey) {
            settingsKey = configKey;
            timingFields.forEach((field) => { setProperty(element(field.id), 'value', field.value(activeConfiguration)); });
        }
        timingFields.forEach((field) => { text(`active-${field.id}`, `Active: ${field.value(activeConfiguration)} ${field.unit}`); });
        renderTimingEdits();
    }
    setProperty(element('propose-settings'), 'disabled', busy || !ready || proposal != null);
    text('vault-impact', !review ? 'Saved authority remains active. A verified Core review is required before confirmation.'
        : review.invalidatesAccess ? 'Policy changes invalidate current requests, grants and Journeys.'
            : 'Settings changes preserve existing waits, grants and Journey terms. New activity uses the committed settings.');
    setProperty(element('recover'), 'disabled', busy || ready || status === 'UNINITIALIZED' || status === 'COMMITTING');
    text('recover', view?.startup.status === 'FAILED' ? 'Retry startup' : 'Reload and reconcile state');
    text('startup-diagnostic', view?.startup.status === 'FAILED' ? `Startup: ${view.startup.stage} · ${view.startup.reason}` : '');
    diagnosticPanel.render(view);
    const interruption = authorityInterruptionCopy(view?.authorityInterruption);
    const curated = view?.curatedUpgrade;
    text('policy', controller?.snapshot
        ? `Exact Allowed sites hosts: ${policy.whitelist.length}\nManual Blocked sites hosts: ${policy.blacklist.length}\nPolicy revision: ${controller.snapshot.policyRevision}\nState: ${status}${controller.reason ? ` · ${controller.reason}` : ''}${status === 'UNAVAILABLE' && view?.storage?.lastFailure ? `\n${storageFailureCopy(view.storage)}` : ''}`
            + (policy.whitelistSubdomains?.length ? `\nSubdomain scope bases: ${policy.whitelistSubdomains.join(', ')}` : '')
            + (curated ? `\nCurated expansion: ${curated.added.length} added, ${curated.alreadyPresent.length} already present, ${curated.skippedBlacklisted.length + curated.skippedManaged.length} skipped. Exact results are in the diagnostics export.` : '')
            + (interruption ? `\n${interruption}` : '')
        : startupCopy(view?.startup) || 'No verified policy loaded.');
}
function renderHome(policy, ready) {
    const savedPins = presentationView();
    if (savedPins) {
        pins = savedPins.pins;
        pinsLoaded = true;
    }
    const verified = view?.controller?.status === 'READY' && policy !== undefined;
    if (verified)
        lastVerifiedPolicy = policy;
    const displayPolicy = verified ? policy : lastVerifiedPolicy ?? policy;
    const destinationKey = JSON.stringify([displayPolicy ?? null, sites.metadata(), pins]);
    if (destinationsKey !== destinationKey) {
        destinationsKey = destinationKey;
        entries = displayPolicy ? destinationIndex(displayPolicy, sites.metadata(), pins) : [];
        homeCatalog = homeCategories(entries, displayPolicy ? policyDestinationIndex(displayPolicy, sites.metadata(), pins) : [], sites.metadata().map(d => d.category));
    }
    const catalog = homeCatalog;
    homeOrganization.observe(catalog, verified);
    renderPins();
    homeOrganization.render();
    renderSearch();
    const state = collectionPresentation(view?.controller, entries.length, queryAttempted && view?.startup?.status !== 'LOADING', displayPolicy !== undefined);
    setAttribute(element('destinations'), 'aria-busy', String(state.phase === 'LOADING'));
    setProperty(element('destinations').dataset, 'phase', state.phase);
    text('destination-state-message', state.message);
    // Keep the reserved startup shell quiet. Recovery is for an unavailable response.
    setProperty(element('destination-state'), 'hidden', state.phase !== 'UNAVAILABLE');
    setProperty(element('retry-destinations'), 'hidden', state.phase !== 'UNAVAILABLE');
    setProperty(element('open-destination-recovery'), 'hidden', state.phase !== 'UNAVAILABLE');
    setProperty(element('empty-destinations'), 'hidden', state.phase !== 'EMPTY');
    setProperty(element('pinned-empty'), 'hidden', state.phase !== 'READY' && state.phase !== 'EMPTY' || pinnedDestinations(pinEntries(), pins).length > 0);
    for (const button of document.querySelectorAll('.destination-open')) {
        setProperty(button, 'disabled', busy || !ready || !hasCommittedCollection(view?.controller));
    }
}
function pinEntries() {
    const v = presentationView();
    const combined = entries.map(e => v?.sync.labels[destinationId(e)] ? { ...e, label: v.sync.labels[destinationId(e)] } : e);
    for (const g of v?.sync.groups ?? []) {
        const index = combined.findIndex(e => destinationId(e) === g.id);
        const entry = { id: g.id, label: v?.sync.labels[g.id] ?? g.label, hostname: g.hostname, hostnames: [g.hostname], category: 'Bookmarks' };
        if (index < 0)
            combined.push(entry);
        else
            combined[index] = { ...combined[index], label: entry.label };
    }
    return combined;
}
function renderPins() {
    bookmarkSync.render();
    const saved = presentationView();
    if (saved) {
        pins = saved.pins;
        pinsLoaded = true;
    }
    const all = pinEntries();
    const active = pinnedDestinations(all, pins);
    // Local command serialization is not authority loss. Keep disabled launchers
    // visually stable while a Greylist action is acknowledged; real unavailability
    // still dims them. Buttons remain disabled and all launches still use Core.
    setAttribute(element('pinned-section'), 'data-action-pending', busy && hasCommittedCollection(view?.controller) && canQueueOperation(view?.controller) ? 'true' : null);
    homePins.render(all, pins, !busy && hasCommittedCollection(view?.controller) && canQueueOperation(view?.controller), pinsLoaded && !savingPins && canQueueOperation(view?.controller));
    for (const button of document.querySelectorAll('.pin-button')) {
        const pinned = active.some(entry => destinationId(entry) === button.dataset.pinId);
        const label = `${pinned ? 'Unpin' : 'Pin'} ${button.dataset.label}`;
        if (button.getAttribute('aria-pressed') !== String(pinned))
            setAttribute(button, 'aria-pressed', String(pinned));
        if (button.getAttribute('aria-label') !== label)
            setAttribute(button, 'aria-label', label);
        if (button.title !== label)
            setProperty(button, 'title', label);
        const disabled = !pinsLoaded || savingPins || !canQueueOperation(view?.controller);
        if (button.disabled !== disabled)
            setProperty(button, 'disabled', disabled);
    }
}
async function togglePin(id) {
    if (!pinsLoaded || savingPins)
        return;
    const focused = document.activeElement;
    const pinnedFocus = focused instanceof HTMLButtonElement && focused.closest('#pinned-list') !== null;
    const entry = pinEntries().find(item => destinationId(item) === id);
    const pinned = pins.includes(id);
    const next = updateDestinationPin(pins, id, !pinned, entry?.hostnames);
    if (next.length > 200) {
        feedback('Your pinned list is full. Unpin a site first.', 'error');
        return;
    }
    savingPins = true;
    renderPins();
    try {
        const saved = await setPin(id, !pinned, entry?.hostnames);
        if (saved === 'SAVED') {
            pins = presentationView().pins;
            feedback('');
        }
        else
            feedback(saved === 'FAILED' ? 'Your pin could not be saved. Access and policy are unchanged.' : 'The pin save outcome could not be verified. Access and policy are unchanged.', saved === 'FAILED' ? 'error' : 'uncertain');
    }
    finally {
        savingPins = false;
        render();
        if (pinnedFocus && !focused.isConnected) {
            searchInput.focus({ preventScroll: true });
        }
    }
}
function renderReview(review, hasProposal) {
    const tone = review?.phase === 'WAITING' ? 'wait' : review?.phase === 'READY' ? 'ready' : review?.phase === 'EXPIRED' ? 'expired' : 'unavailable';
    if (element('vault-phase').dataset.tone !== tone)
        setProperty(element('vault-phase').dataset, 'tone', tone);
    text('vault-phase', review?.phase === 'WAITING' ? 'Waiting' : review?.phase === 'READY' ? 'Ready to confirm' : review?.phase === 'EXPIRED' ? 'Expired' : '');
    text('vault-summary', review ? `${review.phase === 'WAITING' ? 'Saved proposal; waiting period is running.' : review.phase === 'READY' ? 'Confirmation is available. Review the frozen contents before confirming.' : 'The confirmation window has expired.'} Your active policy and settings stay in place until explicit confirmation and a successful save.`
        : hasProposal ? 'Waiting to verify this proposal. Confirmation is unavailable.' : '');
    const key = JSON.stringify(review ? [review.proposalId, review.whitelist, review.blacklist, review.whitelistSubdomains, review.currentConfiguration, review.candidateConfiguration] : null);
    if (key === reviewKey)
        return;
    reviewKey = key;
    const changes = [];
    if (review)
        for (const [label, diff] of [['Allowed sites', review.whitelist], ['Blocked sites', review.blacklist]]) {
            if (diff.added.length > 0)
                changes.push(`${label} · add: ${diff.added.join(', ')}`);
            if (diff.removed.length > 0)
                changes.push(`${label} · remove: ${diff.removed.join(', ')}`);
        }
    if (review?.whitelistSubdomains) {
        if (review.whitelistSubdomains.added.length)
            changes.push(`Also allow all current/future subdomains at any depth · add bases: ${review.whitelistSubdomains.added.join(', ')}. Managed and manual blocking still apply to these additional descendants.`);
        if (review.whitelistSubdomains.removed.length)
            changes.push(`All-subdomain access · remove bases: ${review.whitelistSubdomains.removed.join(', ')}`);
    }
    element('vault-changes').replaceChildren(...changes.map((value) => { const li = document.createElement('li'); setProperty(li, 'textContent', value); return li; }));
    setProperty(element('vault-changes'), 'hidden', changes.length === 0);
    const rows = review?.currentConfiguration && review.candidateConfiguration ? timingFields.flatMap((field) => {
        const current = field.value(review.currentConfiguration);
        const proposed = field.value(review.candidateConfiguration);
        if (current === proposed)
            return [];
        const row = document.createElement('tr');
        for (const cell of [field.label, `${current} ${field.unit}`, `${proposed} ${field.unit}`]) {
            const td = document.createElement('td');
            setProperty(td, 'textContent', cell);
            row.append(td);
        }
        return [row];
    }) : [];
    element('vault-settings-rows').replaceChildren(...rows);
    setProperty(element('vault-settings-comparison'), 'hidden', rows.length === 0);
}
function renderSearch() {
    const searching = searchInput.value.trim().length > 0;
    setProperty(element('home-search-panel'), 'hidden', !searching || !searchOpen);
    const inputsKey = `${destinationsKey}\n${JSON.stringify(presentationView()?.sync.groups)}\n${searchInput.value}`;
    if (inputsKey !== searchInputsKey) {
        searchInputsKey = inputsKey;
        const next = searchDestinationTargets(pinEntries(), searchInput.value);
        const key = JSON.stringify([searchInput.value, next, homeCatalog]);
        if (key !== searchKey) {
            searchKey = key;
            matches = next;
            highlighted = next.length === 1 ? 0 : -1;
            searchActions = [];
            element('search-results').replaceChildren(...matches.map(({ entry, hostname }, index) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.id = `search-result-${index}`;
                setAttribute(button, 'role', 'option');
                // The combobox keeps one keyboard focus; arrows select its active descendant.
                button.tabIndex = -1;
                button.addEventListener('mousedown', (event) => { event.preventDefault(); });
                const copy = document.createElement('span');
                copy.className = 'result-copy';
                const label = document.createElement('strong');
                setProperty(label, 'textContent', entry.label);
                const host = document.createElement('small');
                setProperty(host, 'textContent', hostname);
                copy.append(label, host);
                button.append(copy, icon('arrow'));
                const action = () => { searchOpen = false; renderSearch(); void send({ kind: 'OPEN_DESTINATION', url: `https://${hostname}/` }); };
                searchActions.push(action);
                button.addEventListener('click', () => { if (!button.disabled)
                    action(); });
                return button;
            }));
            if (searching)
                for (const category of homeCatalog.filter(c => c.members.length && searchInput.value.toLowerCase().trim().split(/\s+/).every(w => c.label.toLowerCase().includes(w)))) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.id = `search-result-${searchActions.length}`;
                    button.tabIndex = -1;
                    button.className = "search-category";
                    button.setAttribute("role", "option");
                    button.textContent = `${category.label} ? Category`;
                    const action = () => { searchOpen = false; sites.chooseCategory(category.key); navigate('sites'); };
                    searchActions.push(action);
                    button.addEventListener('mousedown', e => e.preventDefault());
                    button.addEventListener('click', () => { if (!button.disabled)
                        action(); });
                    element('search-results').append(button);
                }
        }
    }
    setProperty(element('search-results'), 'hidden', searchActions.length === 0);
    setProperty(element('search-empty'), 'hidden', !hasCommittedCollection(view?.controller) || searchInput.value.trim() === '' || searchActions.length > 0);
    setAttribute(searchInput, 'aria-expanded', String(searchOpen && searching));
    if (searchOpen && highlighted >= 0)
        setAttribute(searchInput, 'aria-activedescendant', `search-result-${highlighted}`);
    else
        setAttribute(searchInput, 'aria-activedescendant', null);
    for (const [index, button] of [...element('search-results').children].entries()) {
        setAttribute(button, 'aria-selected', String(index === highlighted));
        setProperty(button, 'disabled', busy || !hasCommittedCollection(view?.controller));
    }
}
searchInput.addEventListener('input', () => { searchOpen = true; renderSearch(); });
searchInput.addEventListener('focus', () => { searchOpen = true; renderSearch(); });
window.addEventListener('pointerdown', event => { if (!element('search-form').contains(event.target)) {
    searchOpen = false;
    renderSearch();
} });
searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        searchOpen = false;
        renderSearch();
    }
    if (searchActions.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        searchOpen = true;
        highlighted = (highlighted + (event.key === 'ArrowDown' ? 1 : highlighted < 0 ? 0 : -1) + searchActions.length) % searchActions.length;
        renderSearch();
        element(`search-result-${highlighted}`).scrollIntoView({ block: 'nearest' });
    }
});
element('search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const action = searchActions[highlighted] ?? (searchActions.length === 1 ? searchActions[0] : undefined);
    if (action && searchOpen && !busy && hasCommittedCollection(view?.controller))
        action();
});
function rememberPage() {
    const focus = document.activeElement;
    navigation.save({ ...navigation.value(), tab: selected, sites: sites.navigation(),
        pages: { ...navigation.value().pages, [page]: { scroll: viewportScrollSurface(page, sites.view()).scrollTop, focus: focus?.id ?? '' } } });
}
function historyData() {
    return { atlasSitesDirectory: sites.directory(), atlasSettings: settingsNavigation.value(), atlasSitesView: sites.view(), atlasSitesSelection: sites.navigation().selection };
}
function navigate(name, preserveFeedback = false, fromHistory = false) {
    const accessLink = name === 'access';
    if (name === 'home' && !fromHistory)
        selected = '';
    rememberPage();
    homePins.leave();
    sites.leave();
    searchOpen = false;
    if (!preserveFeedback)
        feedback('');
    if (!fromHistory && page !== name)
        history.pushState(historyData(), '', `#${name}`);
    if (fromHistory) {
        sites.restoreDirectory(history.state?.atlasSitesDirectory);
        settingsNavigation.restore(history.state?.atlasSettings);
        sites.restoreView(history.state?.atlasSitesView, history.state?.atlasSitesSelection);
    }
    page = name;
    section = name === 'vault' ? 'settings' : name;
    render();
    const target = name === 'vault' ? element('vault-section') : accessLink ? element('temporary-title') : element('main-content');
    if (name === 'sites')
        sites.focusSelection();
    else
        (name === 'vault' ? element('vault-heading') : target.id === 'main-content' ? target : target.querySelector('summary, h2') ?? target).focus({ preventScroll: true });
    const initialFocus = document.activeElement;
    const saved = navigation.value().pages[name];
    requestAnimationFrame(() => {
        if (page !== name)
            return;
        if (saved)
            viewportScrollSurface(page, sites.view()).scrollTop = saved.scroll;
        else
            target.scrollIntoView({ block: 'start' });
        if (saved?.focus && document.activeElement === initialFocus && fromHistory) {
            const remembered = document.getElementById(saved.focus);
            if (remembered && !remembered.closest('[hidden]'))
                remembered.focus({ preventScroll: true });
        }
    });
}
history.replaceState(historyData(), '', `#${page}`);
history.scrollRestoration = 'manual';
let controlTabId;
void browser.tabs.getCurrent().then(tab => { controlTabId = tab?.id; }).catch(() => undefined);
const controlNavigation = (message, sender) => {
    if (sender.id !== browser.runtime.id || sender.tab || sender.url !== browser.runtime.getURL('_generated_background_page.html')
        || disposed || controlTabId === undefined || message?.controlTabId !== controlTabId
        || message.kind !== 'CONTROL_NAVIGATE' || !atlasPage(message.page ?? '') || !Number.isSafeInteger(message.tabId))
        return false;
    const target = atlasPage(message.page);
    if (target === 'access')
        selected = String(message.tabId);
    navigate(target);
    void poll();
    return Promise.resolve({ navigated: true });
};
browser.runtime.onMessage.addListener(controlNavigation);
addEventListener('pagehide', () => browser.runtime.onMessage.removeListener(controlNavigation));
window.addEventListener('popstate', () => { navigate(atlasPage(location.hash.slice(1)) ?? 'home', true, true); });
window.addEventListener('pagehide', rememberPage);
element('return-to-sites').addEventListener('click', () => navigate('sites', true));
for (const name of ['home', 'sites', 'access', 'vault', 'settings'])
    element(`show-${name}`).addEventListener('click', () => { navigate(name); });
for (const button of document.querySelectorAll('[data-settings-panel]'))
    button.addEventListener('click', () => { if (page === 'vault')
        navigate('settings', true); });
element('brand-home').addEventListener('click', (event) => { event.preventDefault(); navigate('home'); });
element('review-pending').addEventListener('click', () => { navigate('vault'); });
element('retry-destinations').addEventListener('click', () => { void poll(); });
for (const id of ['open-destination-recovery', 'sites-recovery'])
    element(id).addEventListener('click', () => {
        navigate('settings');
        settingsNavigation.choose('recovery-section');
        element('recover').focus();
    });
document.addEventListener('keydown', (event) => {
    if (document.querySelector('dialog[open]'))
        return;
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLElement
        && (event.target.closest('input, textarea, select') || event.target.isContentEditable))
        return;
    event.preventDefault();
    navigate('home');
    searchInput.focus();
});
function renderTimingEdits() {
    const config = view?.controller?.snapshot?.configuration;
    let count = 0;
    for (const field of timingFields) {
        const input = element(field.id), edited = config != null && input.value !== field.value(config);
        setProperty(input.dataset, 'edited', String(edited));
        if (edited)
            count++;
    }
    text('timing-edited-count', count ? `${count} ${count === 1 ? 'edited value' : 'edited values'} · active settings unchanged` : 'Active settings remain in effect until confirmation in Vault.');
}
element('settings-form').addEventListener('input', renderTimingEdits);
element('settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const draft = Object.fromEntries(timingFields.map((field) => [field.id, element(field.id).value]));
    const candidateConfiguration = configurationFromDraft(draft);
    if (candidateConfiguration === null) {
        feedback('Use positive values in whole milliseconds and a whole hop limit.', 'error');
        return;
    }
    void send({ kind: 'PROPOSE_SETTINGS', candidateConfiguration }).then(response => {
        if (response?.result?.type === 'COMMITTED')
            navigate('vault', true);
    });
});
element('setup-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const hosts = (id) => element(id).value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const defaults = element('use-defaults').checked ? compileCuratedWhitelist() : null;
    const blacklist = hosts('blacklist');
    void send({ kind: 'SETUP', policy: { whitelist: [...new Set([...(defaults?.whitelist ?? []), ...hosts('whitelist')])], blacklist,
            ...(defaults ? { whitelistSubdomains: defaults.whitelistSubdomains?.filter(host => !blacklist.includes(host)) } : {}) } });
});
element('recover').addEventListener('click', () => { void send({ kind: 'RECOVER' }); });
element('propose-defaults').addEventListener('click', () => { void send({ kind: 'PROPOSE_CURATED_DEFAULTS' }); navigate('vault'); });
for (const [id, kind] of Object.entries({ 'confirm-policy': 'CONFIRM_POLICY', 'cancel-policy': 'CANCEL_POLICY' })) {
    element(id).addEventListener('click', () => {
        const proposalId = view?.controller?.snapshot?.vaultState.pendingProposal?.id;
        if (proposalId !== undefined)
            void send({ kind, proposalId });
    });
}
async function refreshView() {
    const ticket = epoch;
    try {
        const response = await browser.runtime.sendMessage({ kind: 'GET_VIEW' });
        if (!response?.view)
            throw new Error('VIEW_UNAVAILABLE');
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
            }
            else if (proposalId === undefined) {
                policyReview = null;
                policyReviewError = '';
            }
            if (ticket === epoch)
                render();
            if (ticket === epoch)
                void homeOrganization.refresh();
            if (ticket === epoch) {
                const before = presentationView();
                void Promise.resolve(homePins.refresh()).then(() => {
                    const after = presentationView();
                    if (before?.sync.revision !== after?.sync.revision || before?.bookmarks.revision !== after?.bookmarks.revision || JSON.stringify(before?.pins) !== JSON.stringify(after?.pins)
                        || JSON.stringify(before?.sync.warnings) !== JSON.stringify(after?.sync.warnings))
                        requestRender();
                });
            }
            if (ticket === epoch)
                void sites.refresh();
        }
    }
    catch {
        if (ticket === epoch) {
            queryAttempted = true;
            view = null;
            policyReview = null;
            render();
        }
    }
    finally {
        await diagnosticPanel.refresh();
    }
}
const refreshLoop = new RefreshLoop(refreshView, { delay: () => view?.controller?.status === 'COMMITTING' || view?.controller?.status === 'LOADING' ? 100 : 1000 });
function poll() { return refreshLoop.request(); }
document.addEventListener('visibilitychange', () => {
    ++epoch;
    diagnosticPanel.invalidate();
    refreshLoop.setActive(!document.hidden);
    if (!document.hidden)
        render();
});
window.addEventListener('pagehide', () => {
    disposed = true;
    ++epoch;
    diagnosticPanel.dispose();
    refreshLoop.dispose();
    homePins.dispose();
    destinationCards.dispose();
});
window.addEventListener('storage', (event) => {
    if (event.key !== pinsStorageKey && event.key !== null)
        return;
    if (event.key === pinsStorageKey || event.key === null)
        void Promise.resolve(homePins.refresh()).then(requestRender);
    const before = JSON.stringify(pins);
    try {
        if (event.key === pinsStorageKey || event.key === null)
            pins = readPins(JSON.parse(localStorage.getItem(pinsStorageKey) ?? 'null'));
    }
    catch { /* Invalid presentation data cannot change permissions. */ }
    if (before !== JSON.stringify(pins))
        render();
});
try {
    pins = readPins(JSON.parse(localStorage.getItem(pinsStorageKey) ?? 'null'));
}
catch {
    feedback('Pinned sites are unavailable. Your saved policy is unaffected.', 'error');
}
pinsLoaded = true;
render();
refreshLoop.setActive(!document.hidden);
