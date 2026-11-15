import { reconcileChildren, setAttribute, setProperty } from './dom.js';
import { siteSearchPrefill } from './search-prefill.js';
import { evaluate, evaluateMany, isWhitelistRemoval } from '@atlas/core';
import { policyDestinationIndex } from './destinations.js';
import { destinationId, pinnedDestinations } from './home-model.js';
import { commonWwwCounterpart, explicitDestinationHosts } from './destination-policy.js';
import { destinationPreferencesKey, emptyDestinationPreferences, readDestinationPreferences, reconcileDestinationPreferences, replaceDestinationMetadata } from './destination-metadata.js';
import { savePresentation } from './presentation-storage.js';
import { renderFeedback } from './feedback.js';
import { collectionPresentation, hasCommittedCollection } from './data-view.js';
import { canonicalCategory, categorySuggestions, categoryKey } from './categories.js';
import { assessDraft, destinationChangeSummary, draftBaseline, newDestinationDraft, reconcileDraft, samePolicy, stageDestination, unstageDestination, validateDraftCandidate } from './destination-draft.js';
import { openDraftRepository } from './draft-storage.js';
import { DestinationWorkspaceSession, receiptOutcome } from './destination-workspace.js';
import { emptySitesPosition } from './navigation-state.js';
import { canUseSubdomainScope } from './subdomain-scope.js';
import { initializeDestinationEditor } from './destination-editor.js';
import { renderDestinationChange } from './destination-change-view.js';
import { directoryCategories, directoryView, matchesSite } from './site-directory.js';
import { orderCategories } from './category-order.js';
import { readDestinationUsage, usagePreferencesKey } from './destination-usage.js';
import { uiText } from './ui-text.js';
import { vaultWait } from './vault-presentation.js';
const element = (id) => document.getElementById(id);
const input = (id) => element(id);
const text = (id, value) => { if (element(id).textContent !== value)
    setProperty(element(id), 'textContent', value); };
const json = (value) => JSON.stringify(value);
/** Editable work, frozen receipts and committed presentation have distinct lifecycles. */
export function initializeSites(options) {
    const newId = options.newId ?? (() => crypto.randomUUID()), owner = newId();
    let preferences = emptyDestinationPreferences(), preferencesAvailable = true, session = null;
    preferences = readPreferences();
    let loadFailure = false, submitting = false, displayFailed = false, legacyFailed = false, disposed = false;
    let pinSaving = false;
    let refreshing = null;
    let displaying = null;
    let entriesKey = '', savedEntries = [];
    // Display-only projection, invalidated with the collection's policy/metadata key.
    // Opening or changing a destination still requires the controller.
    let savedOutcomes = new Map();
    let lastPresentationSave = 'SAVED';
    const position = options.position ?? emptySitesPosition();
    let selection = typeof options.initialSelection === 'string' ? options.initialSelection : position.selection, listKey = '', detailKey = '', batchKey = '';
    let detailVisible = options.initialView === undefined ? !!position.selection : options.initialView === 'detail';
    const draftRows = new Map();
    const siteRows = new Map();
    let restoredList = false;
    let directory = directoryView(options.initialDirectory), searchFocused = false, suggestionKey = '';
    const categoryNodes = new Map();
    const dialog = element('sites-editor');
    function chooseDirectory(value, record = true) {
        directory = directoryView(value);
        searchFocused = false;
        element('sites-list').scrollTop = 0;
        if (record)
            options.directoryChanged?.();
        options.changed();
    }
    function syncDialog() {
        const open = detailVisible && !!(selection || session?.value.draft?.editor) && !reviewOpen && !element('sites-section').hidden && !element('sites-workspace').hidden;
        if (open && !dialog.open)
            dialog.showModal?.();
        if (!open && dialog.open)
            dialog.close();
    }
    function closeDetails() { showView('browse'); syncDialog(); queueMicrotask(focusSelection); }
    setProperty(input('sites-search'), 'value', position.search);
    setProperty(element('sites-filter'), 'value', position.filter);
    const navigation = () => ({ selection, search: input('sites-search').value,
        filter: element('sites-filter').value, scroll: element('sites-list').scrollTop ?? 0 });
    const remember = () => options.positionChanged?.(navigation());
    function focusSelection() {
        if (reviewOpen) {
            element('draft-review-title').focus({ preventScroll: true });
            return;
        }
        if (detailVisible && !reviewOpen) {
            (element('site-draft').hidden ? element('site-detail') : input('site-name')).focus({ preventScroll: true });
            return;
        }
        const row = [...element('sites-list').querySelectorAll('.site-row')].find(r => r.dataset.destinationId === selection);
        (directory !== null && row ? row : input('sites-search')).focus({ preventScroll: true });
    }
    let lastController = null;
    let reconciliation = null, reviewOpen = options.initialView === 'review';
    function showView(next, rememberView = true) {
        reviewOpen = next === 'review';
        detailVisible = next === 'detail';
        if (rememberView)
            options.viewChanged?.(next, selection);
        options.changed();
    }
    const drafts = options.drafts ?? openDraftRepository();
    const initialized = drafts.then(async (repository) => {
        if (disposed) {
            repository.close();
            return;
        }
        session = new DestinationWorkspaceSession(repository, options.changed);
        loadFailure = !await session.load();
        if (session.value.draft?.editor && options.initialView === undefined)
            detailVisible = true;
        restoreEditor();
        options.changed();
    }).catch(() => { loadFailure = true; options.changed(); });
    function readPreferences() {
        try {
            const saved = readDestinationPreferences(JSON.parse(localStorage.getItem(destinationPreferencesKey) ?? 'null'));
            preferencesAvailable = true;
            return saved;
        }
        catch {
            preferencesAvailable = false;
            return preferences;
        }
    }
    function notice(message, tone = 'status') {
        if (disposed)
            return;
        renderFeedback(element('site-save-feedback'), { message, tone });
        options.feedback(message, tone);
    }
    const snapshot = () => options.controller()?.status === 'READY' ? options.controller()?.snapshot : null;
    const verifiedSnapshot = async () => {
        if (!options.verify)
            return snapshot();
        try {
            const latest = await options.verify();
            return latest?.status === 'READY' ? latest.snapshot : null;
        }
        catch {
            return null;
        }
    };
    const baseline = (state) => draftBaseline(state, preferences, options.pins());
    const entries = () => {
        const policy = (options.controller()?.snapshot ? options.controller() : lastController)?.snapshot?.policy;
        const key = json([policy, preferences.destinations, options.pins()]);
        if (key !== entriesKey) {
            entriesKey = key;
            savedEntries = policy ? policyDestinationIndex(policy, preferences.destinations, options.pins()) : [];
            const hosts = [...new Set(savedEntries.flatMap(entry => entry.hostnames))];
            const decisions = evaluateMany(hosts, policy);
            savedOutcomes = new Map(hosts.map((host, index) => [host, decisions[index].outcome]));
        }
        return savedEntries;
    };
    const classification = (entry) => {
        const outcomes = new Set(entry.hostnames.map(hostname => savedOutcomes.get(hostname)));
        return outcomes.size > 1 ? 'MIXED' : outcomes.has('DENY') ? 'BLACKLIST' : outcomes.has('ALLOW') ? 'WHITELIST' : 'GREYLIST';
    };
    const editorControls = initializeDestinationEditor({ editor: () => session?.value.draft?.editor,
        policy: () => session?.value.draft?.baseline.policy, live: () => !disposed });
    const { read: currentEditor, restore: restoreEditor, scope, clearError: clearFieldError } = editorControls;
    const activeReceipt = () => session?.value.receipt && !['DONE', 'KEPT', 'RESOLVED'].includes(session.value.receipt.phase) ? session.value.receipt : null;
    function persistEditor() {
        if (!session?.value.draft || submitting || activeReceipt() || session.conflict)
            return;
        clearFieldError();
        scope();
        const editor = currentEditor();
        if (!editor)
            return;
        editorControls.remember(editor);
        session.setEditor(editor);
    }
    function initialEditor(draft, id) {
        const item = id ? draft.changes.find(c => c.id === id)?.after ?? draft.baseline.entries.find(e => e.metadata.id === id) : null;
        const counterpart = commonWwwCounterpart(item?.metadata.primaryHostname ?? '');
        return { id: item?.metadata.id ?? null, name: item?.metadata.label ?? '', hostname: item?.metadata.primaryHostname ?? '',
            category: item?.metadata.category ?? 'Your destinations', access: item?.classification ?? 'WHITELIST',
            www: item?.metadata.hostnames.includes(counterpart ?? '') ?? false,
            extra: item?.metadata.hostnames.filter(h => h !== item.metadata.primaryHostname && h !== counterpart).join(', ') ?? '', pinned: item?.pinned ?? false,
            ...(item?.includeSubdomains ? { includeSubdomains: true } : {}) };
    }
    function begin(id) {
        const state = options.controller()?.snapshot;
        if (!state || !options.canEdit() || !session?.loaded || submitting || activeReceipt() || session.conflict)
            return;
        const draft = session.value.draft ?? newDestinationDraft(newId(), baseline(state));
        if (id && !draft.changes.some(change => change.id === id) && !draft.baseline.entries.some(entry => entry.metadata.id === id)) {
            notice('This site was added after your draft baseline. Review and reconcile the stale draft before editing its new terms. Your current work is preserved.');
            element('reconcile-destination-draft').focus();
            return;
        }
        if (draft.editor) {
            if (draft.editor.id === (id ?? null)) {
                revealEditor();
                return;
            }
            const current = currentEditor() ?? draft.editor, initial = initialEditor(draft, draft.editor.id ?? undefined);
            if (json(current) !== json(initial)) {
                notice('Your current editor has unstaged changes. Add them to the batch or use Close editor before editing another site.');
                revealEditor();
                return;
            }
        }
        const initial = initialEditor(draft, id);
        const noMatches = !entries().some(entry => matchesSite(entry, input('sites-search').value));
        const editor = !id && noMatches ? { ...initial, ...siteSearchPrefill(element('sites-search').value) } : initial;
        void session.setDraft({ ...draft, editor });
        restoreEditor();
        revealEditor();
        notice('');
    }
    function revealEditor() {
        showView('detail');
        const expectedFocus = document.activeElement;
        queueMicrotask(() => {
            if (!detailVisible || reviewOpen || !session?.value.draft?.editor || document.activeElement !== expectedFocus || !element('site-field-error').hidden)
                return;
            const panel = element('site-draft'), top = panel.getBoundingClientRect?.().top ?? 0;
            if (top < 0 || top > window.innerHeight - 80)
                panel.scrollIntoView?.({ block: 'start' });
            input('site-name').focus({ preventScroll: true });
        });
    }
    async function stage(immediateDisplay = false) {
        const state = options.controller()?.snapshot ?? lastController?.snapshot, editor = currentEditor(), draft = session?.value.draft;
        if (!state || !editor || !draft || !session || submitting || session.conflict || activeReceipt())
            return;
        const hosts = explicitDestinationHosts(editor.hostname.trim(), commonWwwCounterpart(editor.hostname) !== null && editor.www, editor.extra);
        const invalid = !editor.name.trim() || editor.name.trim().length > 100 ? 'site-name'
            : !explicitDestinationHosts(editor.hostname.trim(), false, '')
                || editor.includeSubdomains && editor.access === 'WHITELIST' && !canUseSubdomainScope(editor.hostname) ? 'site-hostname'
                : !hosts ? 'site-extra' : !editor.category.trim() || editor.category.trim().length > 64 ? 'site-category' : null;
        if (invalid !== null || !hosts) {
            const messages = {
                'site-name': 'Enter a site name of 1–100 characters.',
                'site-hostname': 'Enter an exact primary hostname, such as example.com. URLs and wildcards are unsupported.',
                'site-extra': 'Enter valid additional exact hostnames, separated by commas. URLs and wildcards are unsupported.',
                'site-category': 'Enter a category of 1–64 characters.',
            };
            const field = input(invalid ?? 'site-hostname');
            setAttribute(field, 'aria-invalid', 'true');
            const message = invalid === 'site-hostname' && editor.includeSubdomains && editor.access === 'WHITELIST'
                && !canUseSubdomainScope(editor.hostname) ? 'For all-subdomain access, enter a registered hostname or one of its subdomains. Public and private suffixes cannot be allowed as a whole.' : messages[invalid ?? 'site-hostname'];
            renderFeedback(element('site-field-error'), { message, tone: 'error' });
            const disclosure = field.closest('details');
            if (disclosure)
                disclosure.open = true;
            field.focus();
            return;
        }
        const suggestions = categorySuggestions(preferences.destinations.map(d => d.category), draft.changes.flatMap(c => c.after ? [c.after.metadata.category] : []));
        const id = editor.id ?? `host:${hosts[0]}`;
        const after = { metadata: { id, label: editor.name.trim(), category: canonicalCategory(editor.category, suggestions), primaryHostname: hosts[0], hostnames: hosts },
            classification: editor.access, pinned: input('site-pin').disabled ? false : editor.pinned,
            ...(editor.includeSubdomains && editor.access !== 'BLACKLIST' ? { includeSubdomains: true } : {}) };
        const staged = stageDestination(draft, id, after);
        const saving = session.setDraft(staged), published = session.value;
        if (!await saving) {
            // A pending save can finish after the user opens/types into another
            // editor. Restore the failed editor only if no newer work replaced it.
            if (session.value === published) {
                session.value = { ...session.value, draft: { ...staged, editor } };
                editorControls.remember(editor);
            }
            notice('Draft could not be verified as saved. Your work is retained in this page; retry saving before closing it or submitting.', session.conflict ? 'error' : 'uncertain');
            options.changed();
            return;
        }
        restoreEditor();
        showView(immediateDisplay ? 'browse' : 'review');
        syncDialog();
        queueMicrotask(() => {
            if (!element('sites-section').hidden && !element('sites-workspace').hidden) {
                if (!immediateDisplay) {
                    element('main-content').scrollTop = 0;
                    window.scrollTo?.({ top: 0, behavior: 'instant' });
                }
                focusSelection();
            }
        });
        notice('Draft saved. Review before applying.', 'success');
        if (immediateDisplay) {
            reviewOpen = true;
            await submit();
        }
    }
    async function stageRemoval(id) {
        const state = options.controller()?.snapshot;
        if (!state || !session?.loaded || submitting || activeReceipt() || session.conflict)
            return;
        if (session.value.draft?.editor) {
            notice('Finish or close your current edit before removing a site.');
            return;
        }
        const draft = session.value.draft ?? newDestinationDraft(newId(), baseline(state));
        await session.setDraft(stageDestination(draft, id, null));
        options.changed();
        notice('Removal added to your draft. Review your changes to finish removing this site.');
    }
    async function submit() {
        if (submitting || !session?.loaded)
            return;
        await session.idle();
        const state = await verifiedSnapshot(), draft = session.value.draft;
        preferences = readPreferences();
        if (submitting)
            return;
        if (!state) {
            notice('Saved state could not be verified during preparation. Your draft remains saved. Recover state, then explicitly retry.', 'error');
            return;
        }
        if (!options.canEdit() || !preferencesAvailable || !reviewOpen || !draft || draft.editor || !draft.changes.length || session.unsaved || session.failure || session.conflict || activeReceipt()) {
            notice('Finish editing and save the draft before submitting. Resolve any storage conflict or pending display save.', 'error');
            return;
        }
        const assessment = validateDraftCandidate(draft, baseline(state), state);
        if (!assessment.candidatePolicy || assessment.stale.length || assessment.conflicts.length) {
            notice('Review and resolve stale data or draft conflicts before submission.', 'error');
            return;
        }
        const removal = isWhitelistRemoval(state.policy, assessment.candidatePolicy);
        if (assessment.policyChanged && !removal && state.vaultState.pendingProposal || preferences.pending) {
            notice('A frozen proposal or display save is already pending. Review the existing Vault proposal first.');
            return;
        }
        submitting = true;
        options.changed();
        const receipt = { kind: removal ? 'REMOVAL' : assessment.policyChanged ? 'POLICY' : 'DISPLAY', draft: structuredClone(draft), candidatePolicy: assessment.candidatePolicy,
            expectedProposalId: state.vaultState.nextProposalId, proposalId: null, baseConfigurationRevision: state.configurationRevision, phase: 'PREPARED', owner: null };
        try {
            if (!await session.set({ ...session.value, receipt })) {
                notice('Frozen submission intent could not be saved. No policy command was sent; retry local storage first.', 'error');
                return;
            }
            const latest = await verifiedSnapshot();
            preferences = readPreferences();
            if (!latest || !preferencesAvailable || assessDraft(draft, baseline(latest)).stale.length) {
                await session.set({ ...session.value, receipt: { ...receipt, phase: 'RESOLVED' } });
                notice(!latest || !preferencesAvailable ? 'Saved state could not be verified during preparation. Your draft remains saved. Recover state, then explicitly retry.'
                    : 'The baseline changed during submission preparation. No policy command was sent. Review the saved draft against current state.', 'error');
                return;
            }
            if (!assessment.policyChanged) {
                if (await session.set({ ...session.value, draft: null, receipt: { ...receipt, phase: 'PROPOSED' } }))
                    await applyDisplay(false);
                return;
            }
            let response;
            try {
                response = await options.propose({ kind: removal ? 'REMOVE_WHITELIST' : 'PROPOSE_POLICY', candidatePolicy: receipt.candidatePolicy, basePolicyRevision: draft.baseline.policyRevision });
            }
            catch { /* Preserve uncertain intent. */ }
            const proposal = response?.view?.controller?.snapshot?.vaultState.pendingProposal;
            const committed = response?.view?.controller;
            if (removal && response?.result?.type === 'COMMITTED' && response.result.operation === 'REMOVE_WHITELIST'
                && committed?.status === 'READY' && committed.snapshot && receiptOutcome(receipt, committed.snapshot) === 'COMMITTED') {
                if (await session.set({ ...session.value, draft: null, receipt: { ...receipt, phase: 'PROPOSED' } }))
                    await applyDisplay(false);
            }
            else if (!removal && response?.result?.type === 'COMMITTED' && proposal && samePolicy(proposal.candidatePolicy, receipt.candidatePolicy)) {
                await session.set({ ...session.value, draft: null, receipt: { ...receipt, phase: 'PROPOSED', proposalId: proposal.id } });
                restoreEditor();
                notice('Saved in Vault. Nothing changes until you confirm.', 'success');
                options.vault();
            }
            else if (response?.result?.type === 'REJECTED' || !removal && response?.result?.type === 'BLOCKED' && response.result.reason !== 'COMMIT_UNKNOWN'
                && response.result.status !== 'RECONCILING' || response?.error === 'POLICY_DRAFT_STALE') {
                await session.set({ ...session.value, receipt: { ...receipt, phase: 'RESOLVED' } });
                notice('The batch was not submitted. Your saved draft is preserved; review current state before retrying.', 'error');
            }
            else
                notice('Policy submission outcome is uncertain. Frozen intent is saved; check saved authority before another submission. Do not repeat the command.', 'uncertain');
        }
        finally {
            submitting = false;
            options.changed();
        }
    }
    /** Settle Core first. Never repeat Propose or Confirm to repair presentation. */
    async function checkSubmission() {
        if (!session || submitting)
            return;
        submitting = true;
        options.changed();
        try {
            const response = await options.propose({ kind: 'RECOVER' });
            const state = response?.view?.controller?.status === 'READY' ? response.view.controller.snapshot : null, receipt = activeReceipt();
            if (!state || !receipt) {
                notice('Saved authority is still unavailable. Frozen submission intent is preserved.', 'uncertain');
                return;
            }
            const outcome = receiptOutcome(receipt, state);
            if (outcome === 'WAITING' || outcome === 'COMMITTED') {
                await session.set({ ...session.value, draft: session.value.draft?.id === receipt.draft.id ? null : session.value.draft,
                    receipt: { ...receipt, proposalId: receipt.kind === 'REMOVAL' ? null : receipt.proposalId ?? receipt.expectedProposalId, phase: 'PROPOSED', owner: null } }, true);
                notice(outcome === 'WAITING' ? 'Existing saved proposal found. Review it in Vault; no second proposal was created.' : 'Policy committed and is active. Retry only accompanying display details.', 'success');
            }
            else if (receipt.kind === 'REMOVAL' || receipt.proposalId !== null || state.vaultState.nextProposalId === receipt.expectedProposalId) {
                await session.set({ ...session.value, draft: session.value.draft ?? receipt.draft, receipt: { ...receipt, phase: 'RESOLVED', owner: null } }, true);
                notice('No matching active proposal or commit remains. Editable batch restored for explicit review; no permission or new wait was created.');
            }
            else
                notice('Submission cannot be correlated with current authority. Keep frozen intent and inspect Vault before proceeding.', 'uncertain');
        }
        finally {
            submitting = false;
            options.changed();
        }
    }
    async function keepCurrentDisplay() {
        const receipt = activeReceipt();
        if (!session || !receipt || submitting || session.unsaved || session.failure || session.conflict)
            return;
        const uncertainIntent = receipt.phase === 'PREPARED';
        const state = await verifiedSnapshot();
        const canDiscardIntent = uncertainIntent && state && receiptOutcome(receipt, state) === 'UNKNOWN'
            && !state.vaultState.pendingProposal && state.vaultState.nextProposalId > receipt.expectedProposalId;
        if (receipt.phase !== 'APPLYING' && !canDiscardIntent)
            return;
        const prompt = uncertainIntent
            ? 'Discard this uncorrelated local batch and its remaining display terms? Its historical outcome cannot be established. Current saved policy and display details remain. No proposal will be sent, confirmed or cancelled.'
            : 'Keep current display details and discard this batch’s remaining display edits? Current access rules will remain active.';
        if (!window.confirm(prompt))
            return;
        submitting = true;
        options.changed();
        try {
            if (uncertainIntent) {
                // Recovery settles any outstanding Core write before local intent can be
                // abandoned. No pending proposal may be hidden by this action.
                const response = await options.propose({ kind: 'RECOVER' });
                const verified = response?.view?.controller?.status === 'READY' ? response.view.controller.snapshot : null;
                if (!verified || verified.vaultState.pendingProposal || receiptOutcome(receipt, verified) !== 'UNKNOWN'
                    || verified.vaultState.nextProposalId <= receipt.expectedProposalId) {
                    notice('Saved authority is unsettled or a proposal remains. Frozen local intent is preserved; check its outcome and review Vault.', 'uncertain');
                    return;
                }
            }
            const saved = await session.set({ ...session.value, receipt: { ...receipt, phase: 'KEPT', owner: null },
                draft: uncertainIntent && session.value.draft?.id === receipt.draft.id ? null : session.value.draft });
            if (!saved) {
                notice('Local discard could not be verified as saved. Retry local storage; saved authority is unchanged.', 'uncertain');
                return;
            }
            displayFailed = false;
            restoreEditor();
            notice(uncertainIntent ? 'Uncorrelated local batch discarded. Current saved policy and display details kept; no policy command was repeated.'
                : 'Remaining display edits discarded. Current saved policy and display details kept.', 'success');
        }
        finally {
            submitting = false;
            options.changed();
        }
    }
    function savePreferences(value) {
        const outcome = lastPresentationSave = savePresentation(() => localStorage, destinationPreferencesKey, json(value));
        if (outcome === 'SAVED') {
            preferences = value;
            return true;
        }
        notice(outcome === 'FAILED' ? 'The display save failed. Retry only display details; saved policy is preserved.' : 'The display save outcome could not be verified. Retry only display details; saved policy is preserved.', outcome === 'FAILED' ? 'error' : 'uncertain');
        return false;
    }
    function applyDisplay(explicit) {
        if (displaying)
            return displaying;
        displaying = applyVerifiedDisplay(explicit).finally(() => { displaying = null; options.changed(); });
        options.changed();
        return displaying;
    }
    async function applyVerifiedDisplay(explicit) {
        const state = explicit ? await verifiedSnapshot() : snapshot(), receipt = activeReceipt();
        if (!session || !state || !receipt || session.conflict || session.unsaved || session.failure || displayFailed && !explicit)
            return;
        if (receiptOutcome(receipt, state) !== 'COMMITTED' || receipt.phase === 'APPLYING' && !explicit)
            return;
        const claimed = { ...receipt, phase: 'APPLYING', owner };
        if (!await session.set({ ...session.value, receipt: claimed }))
            return;
        const latest = await verifiedSnapshot();
        if (!latest || receiptOutcome(receipt, latest) !== 'COMMITTED') {
            displayFailed = true;
            notice('Authority changed during display preparation. Frozen details are retained; verify saved state before retrying.', 'error');
            return;
        }
        displayFailed = true;
        const current = readPreferences();
        if (!preferencesAvailable) {
            notice('The display save outcome could not be verified because storage is unavailable. Frozen terms are preserved for retry; saved policy is unaffected.', 'uncertain');
            return;
        }
        let destinations = current.destinations;
        for (const change of receipt.draft.changes) {
            const before = receipt.draft.baseline.metadata.find(item => item.id === change.id) ?? null;
            const saved = destinations.find(item => item.id === change.id) ?? null, after = change.after?.metadata ?? null;
            if (json(saved) !== json(before) && json(saved) !== json(after)
                || after && destinations.some(item => item.id !== change.id && item.hostnames.some(host => after.hostnames.includes(host)))) {
                notice('Policy is preserved, but another page changed these display details. Retry cannot overwrite them. Review the conflicting site or keep current display details.', 'error');
                return;
            }
            destinations = replaceDestinationMetadata(destinations, after, change.id);
        }
        if (!savePreferences({ ...current, destinations })) {
            notice(receipt.kind !== 'DISPLAY' ? 'Policy committed and is active. Display details could not be verified as saved. Retry only display details and pins; do not resubmit policy.'
                : 'Display details could not be verified as saved. Frozen values are preserved for explicit retry; exact access rules are unchanged.', lastPresentationSave === 'FAILED' ? 'error' : 'uncertain');
            return;
        }
        for (const change of receipt.draft.changes) {
            const after = change.after, hosts = [...new Set([...(change.before?.metadata.hostnames ?? []), ...(after?.metadata.hostnames ?? [])])];
            const savedPin = pinnedDestinations([{ id: change.id, label: '', category: '', hostname: hosts[0], hostnames: hosts }], options.pins()).length > 0;
            if (savedPin !== (change.before?.pinned ?? false) && savedPin !== (after?.pinned ?? false)) {
                notice('A pin changed elsewhere. Review it before retrying display details.', 'error');
                return;
            }
            const result = await options.pin(change.id, after?.pinned ?? false, hosts);
            if (result !== 'SAVED') {
                notice(receipt.kind !== 'DISPLAY' ? 'Policy committed and is active. Display details saved, but pins could not be verified. Retry only display details and pins.'
                    : 'Display details saved, but pins could not be verified. Retry the remaining display save; exact access rules are unchanged.', result === 'FAILED' ? 'error' : 'uncertain');
                return;
            }
        }
        if (!await session.set({ ...session.value, receipt: { ...claimed, phase: 'DONE', owner: null }, draft: session.value.draft?.id === receipt.draft.id ? null : session.value.draft })) {
            notice('Display details and pins saved. Completion receipt could not be verified; retry only display cleanup.', 'uncertain');
            return;
        }
        displayFailed = false;
        restoreEditor();
        options.changed();
        notice(receipt.kind === 'REMOVAL' ? 'Allowed sites removals applied without a cooldown. Display details and pins are saved.' : receipt.kind === 'POLICY' ? 'Complete batch policy committed. Accompanying display details and pins are saved.' : 'Display details and pins saved. Exact access rules are unchanged.', 'success');
        if (receipt.kind !== 'POLICY' && !element('sites-section').hidden && !session.value.draft?.editor) {
            reviewOpen = false;
            options.changed();
            queueMicrotask(focusSelection);
        }
    }
    let legacyApplying = false;
    async function legacyDisplay() {
        const state = snapshot();
        if (!state || !preferences.pending || legacyFailed || activeReceipt() || legacyApplying)
            return;
        const pending = preferences.pending, result = reconcileDestinationPreferences(preferences, state);
        if (result.preferences === preferences)
            return;
        const hosts = pending.destination?.hostnames ?? preferences.destinations.find(d => d.id === pending.removedId)?.hostnames ?? [];
        legacyApplying = true;
        try {
            if (!savePreferences(result.pinChange ? { ...result.preferences, pending } : result.preferences)
                || result.pinChange && (await options.pin(result.pinChange.id, result.pinChange.pinned, hosts) !== 'SAVED' || !savePreferences(result.preferences))) {
                legacyFailed = true;
                notice('Saved legacy policy is preserved. Retry only accompanying display details.', 'error');
            }
            else {
                notice(result.pinChange ? 'Policy committed. Accompanying display details and pins saved.' : 'Resolved pending display terms cleared.', 'success');
                options.changed();
            }
        }
        finally {
            legacyApplying = false;
        }
    }
    function renderFrozenReview() {
        const state = options.controller()?.snapshot, receipt = session?.value.receipt;
        const matched = receipt?.kind === 'POLICY' && state?.vaultState.pendingProposal && (receipt.proposalId ?? receipt.expectedProposalId) === state.vaultState.pendingProposal.id
            && samePolicy(receipt.candidatePolicy, state.vaultState.pendingProposal.candidatePolicy);
        const panel = element('vault-destination-review');
        setProperty(panel, 'hidden', !matched);
        if (matched)
            setProperty(element('vault-changes'), 'hidden', true); // Full raw scope stays in the Core review disclosure.
        const key = matched ? json(receipt) : '';
        if (panel.dataset.review === key)
            return;
        setProperty(panel.dataset, 'review', key);
        element('vault-destination-items').replaceChildren(...(matched ? receipt.draft.changes : []).map(change => {
            const li = document.createElement('li');
            renderDestinationChange(li, change, receipt.draft.baseline.policy, receipt.candidatePolicy);
            return li;
        }));
    }
    function renderBatch(state) {
        const draft = session?.value.draft, receipt = session?.value.receipt;
        const frozen = activeReceipt();
        text('destination-draft-heading', frozen ? 'Submitted batch' : draft?.changes.length ? `${draft.changes.length} ${draft.changes.length === 1 ? 'change' : 'changes'} prepared` : draft?.editor ? 'Editing your draft' : 'Your draft');
        text('destination-workspace-kind', !session?.loaded ? loadFailure || session?.loadReason === 'INVALID' ? 'Local state unavailable' : 'Loading local workspace'
            : frozen ? 'Frozen submission' : draft ? 'Prepared changes'
                : receipt?.phase === 'DONE' ? 'Completed local batch' : receipt ? 'Resolved local batch' : 'No staged changes');
        // Empty is a verified local presentation state, never a substitute for authority.
        const workspace = session?.loaded && !draft && (!receipt || ['DONE', 'KEPT'].includes(receipt.phase))
            && !session.unsaved && !session.failure && !session.conflict && !loadFailure ? 'empty' : 'work';
        setProperty(element('destination-draft-panel').dataset, 'quiet', String(!!session?.loaded && !draft && !frozen && !session.unsaved && !session.failure && !session.conflict && !loadFailure));
        if (element('destination-draft-panel').dataset.workspace !== workspace)
            setProperty(element('destination-draft-panel').dataset, 'workspace', workspace);
        // No draft means no candidate to assess. Do not reconstruct every committed
        // destination on every Home/Settings tick just to discard that baseline.
        const current = draft ? state ? baseline(state) : draft.baseline : undefined;
        const assessment = draft && current ? state ? validateDraftCandidate(draft, current, state) : assessDraft(draft, current) : null;
        let status = !session?.loaded ? session?.loadReason === 'INVALID' ? 'Saved local drafts are damaged or incompatible. Submission disabled. Explicitly discard damaged draft data to recover; policy is preserved.'
            : loadFailure ? 'Local draft storage unavailable. Saved drafts cannot be verified; submission disabled.' : 'Loading saved local draft…'
            : session.conflict ? 'Another Atlas window saved a newer draft. Your local work is retained. Explicitly reload the shared draft before continuing.'
                : session.unsaved || session.failure ? 'Unsaved local work. Keep this page open and retry saving; recovery is not guaranteed.'
                    : draft?.changes.length || draft?.editor ? `Saved locally · ${draft.changes.length} staged changes. Your active access rules have not changed.` : 'No local changes staged.';
        if (!state && draft)
            status += ' Authoritative state unavailable; draft retained, submission disabled.';
        text('destination-draft-status', status);
        const problem = !!loadFailure || !!session?.failure || !!session?.conflict;
        setProperty(element('draft-problem'), 'hidden', !problem);
        text('draft-problem-title', session?.conflict ? 'A newer draft exists in another Atlas page' : !session?.loaded ? 'Your saved draft could not be loaded' : session.failure === 'UNCERTAIN' ? 'Your draft save could not be verified' : 'Your draft could not be saved');
        text('draft-problem-copy', session?.conflict ? 'Your edits remain in this page. Loading the newer shared draft will ask before replacing them.' : !session?.loaded ? 'Existing saved data has not been replaced. Retry loading before preparing or submitting changes.' : session.failure === 'UNCERTAIN' ? 'Your entered values remain in this page. The saved outcome is uncertain. Keep this page open and retry verification before submitting or closing.' : 'Your entered values remain in this page. Keep it open and retry saving before submitting or closing.');
        text('draft-problem-detail', session?.conflict ? 'DRAFT_CONFLICT' : session?.loadReason ?? session?.failure ?? (loadFailure ? 'DRAFT_STORAGE_UNAVAILABLE' : ''));
        if (session?.loaded && reviewOpen && !draft?.changes.length)
            reviewOpen = false;
        setProperty(element('destination-draft-panel').dataset, 'review', String(reviewOpen));
        setProperty(element('sites-section').dataset, 'view', reviewOpen ? 'review' : detailVisible ? 'detail' : 'browse');
        syncDialog();
        text('draft-review-count', `${draft?.changes.length ?? 0} ${draft?.changes.length === 1 ? 'change' : 'changes'} prepared`);
        setProperty(element('resume-destination-editor'), 'hidden', !draft?.editor || detailVisible || reviewOpen);
        setProperty(element('discard-destination-summary'), 'hidden', !draft || reviewOpen);
        text('destination-draft-stale', assessment?.stale.length ? `Stale draft: ${assessment.stale.join('; ')}. Review reconciliation before submission.` : '');
        setProperty(element('destination-draft-stale'), 'hidden', !assessment?.stale.length);
        const conflicts = assessment?.conflicts ?? [], key = json([draft?.changes, conflicts, reviewOpen, reconciliation]);
        if (key !== batchKey) {
            batchKey = key;
            const retained = new Set();
            const rows = (draft?.changes ?? []).map(change => {
                retained.add(change.id);
                let row = draftRows.get(change.id);
                if (!row) {
                    const node = document.createElement('li');
                    node.className = 'draft-item';
                    node.dataset.destinationId = change.id;
                    const content = document.createElement('div'), actions = document.createElement('div');
                    actions.className = 'actions';
                    const edit = document.createElement('button');
                    edit.type = 'button';
                    edit.className = 'secondary compact';
                    edit.dataset.draftAction = 'EDIT';
                    edit.addEventListener('click', () => begin(change.id));
                    const remove = document.createElement('button');
                    remove.type = 'button';
                    remove.textContent = 'Remove from draft';
                    remove.className = 'text-button destructive';
                    remove.dataset.draftAction = 'REMOVE';
                    remove.addEventListener('click', () => { if (session?.value.draft)
                        void session.setDraft(unstageDestination(session.value.draft, change.id)); });
                    const removeRule = document.createElement('button');
                    removeRule.type = 'button';
                    removeRule.textContent = 'Stage removal';
                    removeRule.className = 'text-button';
                    removeRule.dataset.draftAction = 'REMOVE_RULE';
                    removeRule.addEventListener('click', () => void stageRemoval(change.id));
                    actions.append(edit, remove, removeRule);
                    node.append(content, actions);
                    row = { node, content, edit, removeRule, key: '' };
                    draftRows.set(change.id, row);
                }
                const lines = destinationChangeSummary(change, draft.baseline.policy, assessment?.candidatePolicy ?? draft.baseline.policy);
                const shown = reviewOpen ? lines : lines.filter((line, index) => index < 3 || line.startsWith('Domain + all subdomains:') || line.startsWith('Still allowed by another saved scope:'));
                const errors = conflicts.filter(c => c.id === change.id), contentKey = json([shown, errors]);
                if (row.key !== contentKey) {
                    row.key = contentKey;
                    renderDestinationChange(row.content, change, draft.baseline.policy, assessment?.candidatePolicy ?? draft.baseline.policy);
                    row.content.append(...errors.map(c => { const p = document.createElement('p'); p.textContent = c.message; p.className = 'draft-conflict'; return p; }));
                }
                setProperty(row.edit, 'textContent', change.after ? 'Edit' : 'Restore / edit');
                setProperty(row.removeRule, 'hidden', change.after === null || change.before === null);
                return row.node;
            });
            for (const id of draftRows.keys())
                if (!retained.has(id))
                    draftRows.delete(id);
            reconcileChildren(element('destination-draft-items'), rows);
            element('destination-draft-conflicts').replaceChildren(...conflicts.map(c => { const p = document.createElement('p'); setProperty(p, 'textContent', `${c.id ? `${c.id}: ` : ''}${c.message}`); return p; }));
            const preview = reconciliation;
            const reconciledPolicy = preview ? assessDraft(preview.draft, preview.draft.baseline).candidatePolicy ?? preview.draft.baseline.policy : null;
            element('draft-reconciliation-items').replaceChildren(...(preview?.draft.changes ?? []).map(change => {
                const li = document.createElement('li');
                setProperty(li, 'textContent', destinationChangeSummary(change, preview.draft.baseline.policy, reconciledPolicy).join('\n'));
                return li;
            }));
            text('draft-reconciliation-conflicts', preview?.conflicts.map(c => `${c.id}: ${c.message}`).join('\n') ?? '');
        }
        const locked = submitting || !state || !session?.loaded || !!session?.conflict || !!activeReceipt();
        for (const button of element('destination-draft-items').querySelectorAll('[data-draft-action]')) {
            setProperty(button, 'disabled', submitting || !!activeReceipt() || !!session?.conflict
                || button.dataset.draftAction !== 'REMOVE' && !state);
        }
        setProperty(element('draft-reconciliation'), 'hidden', reconciliation === null);
        setProperty(element('reconcile-destination-draft'), 'disabled', locked || !assessment?.stale.length);
        setProperty(element('reconcile-destination-draft'), 'hidden', !assessment?.stale.length);
        setProperty(element('accept-draft-reconciliation'), 'disabled', locked || !reconciliation
            || assessDraft(reconciliation.draft, reconciliation.draft.baseline).conflicts.length > 0 || reconciliation.draft.editor !== null);
        setProperty(element('review-destination-draft'), 'disabled', !draft?.changes.length);
        setProperty(element('review-destination-draft'), 'hidden', !draft?.changes.length);
        setAttribute(element('review-destination-draft'), 'aria-expanded', String(reviewOpen));
        setProperty(element('destination-draft-items'), 'hidden', !reviewOpen && !conflicts.length);
        text('review-destination-draft', reviewOpen ? 'Close review' : `Review ${draft?.changes.length ?? 0} ${draft?.changes.length === 1 ? 'change' : 'changes'}`);
        const removal = !!state && !!assessment?.candidatePolicy && isWhitelistRemoval(state.policy, assessment.candidatePolicy);
        setProperty(element('submit-destination-draft'), 'disabled', locked || !!session?.unsaved || !!session?.failure || !reviewOpen || !assessment?.candidatePolicy
            || !!assessment.stale.length || !!draft?.editor || !draft?.changes.length || assessment.policyChanged && !removal && state?.vaultState.pendingProposal != null || preferences.pending !== null);
        text('submit-destination-draft', removal ? 'Remove allowed sites now' : assessment?.policyChanged ? 'Send to Vault' : 'Save display changes');
        text('draft-submit-help', activeReceipt() ? 'This batch is frozen. Review or cancel it in Vault; resolve pending display saves before editing again.'
            : state?.vaultState.pendingProposal && !removal ? 'A proposal is already in Vault. Prepare local work freely; a new policy batch cannot replace it.'
                : session?.unsaved || session?.failure ? 'Review is a preview. Save or retry your local draft before submitting.'
                    : !state ? 'Your saved rules are unavailable. Your draft is kept; restore access before submitting.'
                        : draft?.editor ? reviewOpen ? 'Showing staged changes. Open editor changes are not included; add or close the editor before submitting.' : 'Review shows your staged batch. Add or close the editor before submitting.' : !reviewOpen && draft?.changes.length ? 'Review the complete batch before submitting.'
                            : assessment?.stale.length ? 'Accept a reviewed reconciliation before submission.' : conflicts.length ? 'Resolve the conflicts above before submission.'
                                : removal ? 'This only removes existing allowed-site rules, so no wait is needed. Blocked sites and settings stay unchanged. Any pending Vault proposal will need to be prepared again.'
                                    : assessment?.policyChanged ? `Wait ${vaultWait(state.configuration.vaultTiming.waitMs, 0).replace(' left', '')} in Vault, then confirm here. Nothing changes until you confirm.` : 'Names, categories and pins save without waiting.');
        setProperty(element('retry-destination-draft'), 'hidden', !loadFailure && !session?.unsaved && !session?.failure);
        setProperty(element('discard-damaged-draft'), 'hidden', session?.loadReason !== 'INVALID');
        setProperty(element('reload-shared-draft'), 'hidden', !session?.conflict);
        setProperty(element('discard-destination-draft'), 'disabled', submitting || !draft || !!activeReceipt());
        setProperty(element('discard-destination-summary'), 'disabled', submitting || !draft || !!activeReceipt());
        setProperty(element('destination-receipt'), 'hidden', !receipt || ['DONE', 'KEPT'].includes(receipt.phase));
        const receiptPanel = element('destination-receipt');
        if (receipt && receiptPanel.dataset.phase !== receipt.phase) {
            setProperty(receiptPanel.dataset, 'phase', receipt.phase);
            setProperty(receiptPanel, 'open', !['DONE', 'KEPT'].includes(receipt.phase));
        }
        // Terminal receipts have no pending action; do not re-assess historical
        // policy on every page tick when its result cannot affect any control.
        const outcome = receipt && state && !['DONE', 'KEPT', 'RESOLVED'].includes(receipt.phase) ? receiptOutcome(receipt, state) : null;
        // A verified waiting proposal already has the Vault link above the directory.
        // Keep uncertain outcomes, unsaved work and display retries in view.
        setProperty(element('destination-draft-panel').dataset, 'pending', String(receipt?.phase === 'PROPOSED' && outcome === 'WAITING'
            && !draft && !session?.unsaved && !session?.failure && !session?.conflict && !loadFailure && !displayFailed && !legacyFailed));
        text('destination-receipt-status', !receipt ? '' : receipt.phase === 'DONE' ? 'Applied batch: policy (if changed), display details and pins acknowledged.'
            : receipt.phase === 'KEPT' ? 'Current saved policy and display details kept; remaining local batch terms were discarded.'
                : receipt.phase === 'RESOLVED' ? 'Proposal resolved without applying accompanying display details. Restore only as an editable draft.'
                    : outcome === 'COMMITTED' ? receipt.kind !== 'DISPLAY' ? 'Policy committed and active. Accompanying display details are pending or need retry.' : 'Display-only save pending; exact access rules are unchanged.'
                        : outcome === 'WAITING' ? 'Frozen Vault proposal saved. Active policy unchanged; waiting or explicit confirmation still required.' : 'Frozen submission intent. Check saved authority before retrying; no second policy command will be sent.');
        setProperty(element('check-draft-submission'), 'hidden', !receipt || ['DONE', 'KEPT', 'RESOLVED'].includes(receipt.phase));
        setProperty(element('retry-site-save'), 'hidden', !legacyFailed && !(receipt?.phase === 'APPLYING' || displayFailed));
        const uncorrelated = receipt?.phase === 'PREPARED' && outcome === 'UNKNOWN' && state && !state.vaultState.pendingProposal
            && state.vaultState.nextProposalId > receipt.expectedProposalId;
        setProperty(element('restore-submitted-draft'), 'hidden', receipt?.phase !== 'RESOLVED');
        setProperty(element('keep-current-display'), 'hidden', receipt?.phase !== 'APPLYING' && !uncorrelated);
        text('keep-current-display', uncorrelated ? 'Discard uncorrelated local batch' : 'Keep current display details');
        setProperty(element('keep-current-display'), 'disabled', submitting || !!session?.unsaved || !!session?.failure || !!session?.conflict);
        setProperty(element('retry-site-save'), 'disabled', submitting || displaying !== null || !state || !!session?.failure || !!session?.conflict);
        setProperty(element('check-draft-submission'), 'disabled', submitting || !state || !!session?.conflict);
        renderFrozenReview();
        const receiptList = element('destination-receipt-items'), receiptKey = json(receipt);
        if (receiptList.dataset.receipt !== receiptKey) {
            setProperty(receiptList.dataset, 'receipt', receiptKey);
            receiptList.replaceChildren(...(receipt?.draft.changes ?? []).map(change => {
                const li = document.createElement('li');
                setProperty(li, 'textContent', destinationChangeSummary(change, receipt.draft.baseline.policy, receipt.candidatePolicy).join('\n'));
                return li;
            }));
        }
    }
    function refresh() {
        if (refreshing)
            return refreshing;
        if (disposed || !session?.loaded || submitting)
            return Promise.resolve();
        refreshing = session.refresh().then(async () => {
            if (disposed)
                return;
            restoreEditor();
            const receipt = activeReceipt(), current = snapshot();
            if (receipt && current && !session.unsaved && !session.failure && !session.conflict) {
                const outcome = receiptOutcome(receipt, current);
                if (outcome === 'COMMITTED' && receipt.phase === 'PROPOSED')
                    await applyDisplay(false);
                else if (outcome === 'RESOLVED' && receipt.phase === 'PROPOSED')
                    await session.set({ ...session.value, receipt: { ...receipt, phase: 'RESOLVED' } });
            }
        }).finally(() => { refreshing = null; });
        return refreshing;
    }
    function inspect(id) {
        const tone = element('site-save-feedback').dataset.tone;
        if (tone !== 'error' && tone !== 'uncertain')
            notice('');
        selection = id;
        detailKey = '';
        searchFocused = false;
        remember();
        showView('detail');
        const expectedFocus = document.activeElement;
        queueMicrotask(() => {
            if (detailVisible && !reviewOpen && document.activeElement === expectedFocus && element('site-field-error').hidden)
                (element('site-draft').hidden ? element('site-detail') : input('site-name')).focus({ preventScroll: true });
        });
    }
    function renderSuggestions(matches, categories, query, ready) {
        const panel = element('sites-search-results');
        const matchingCategories = query ? categories.filter(c => query.toLowerCase().split(/\s+/).every(w => c.label.toLowerCase().includes(w))) : [];
        const key = json([query, matches, matchingCategories, ready]);
        if (key !== suggestionKey) {
            suggestionKey = key;
            const nodes = [];
            const button = (label, action) => {
                const node = document.createElement('button');
                node.type = 'button';
                node.textContent = label;
                node.addEventListener('click', action);
                node.disabled = !ready;
                nodes.push(node);
            };
            for (const category of matchingCategories)
                button(`${category.label} · ${category.count} sites`, () => { input('sites-search').value = ''; chooseDirectory(`category:${category.key}`); remember(); });
            for (const entry of matches.slice(0, 12))
                button(`${entry.label} · ${entry.hostname}`, () => inspect(destinationId(entry)));
            if (matches.length)
                button(`View all ${matches.length} results`, () => chooseDirectory('all'));
            else {
                const message = document.createElement('p');
                message.className = 'note';
                message.textContent = ready ? 'No matching sites. Add a site to prepare new access rules.' : 'Sites cannot be verified right now.';
                nodes.push(message);
            }
            reconcileChildren(panel, nodes);
        }
        setProperty(panel, 'hidden', !searchFocused || !query);
        setAttribute(input('sites-search'), 'aria-expanded', String(searchFocused && !!query));
    }
    function render(ready) {
        if (disposed)
            return;
        const controller = options.controller();
        if (controller?.status === 'READY' && controller.snapshot)
            lastController = controller;
        const display = controller?.snapshot ?? lastController?.snapshot;
        const presentationState = hasCommittedCollection(controller) ? controller.snapshot : null;
        legacyDisplay();
        // Keep receipt/failure presentation alive, but do not construct the entire
        // hidden directory during Home startup. Its keyed rows are built on entry.
        if (element('sites-section').hidden) {
            renderBatch(presentationState ?? null);
            return;
        }
        const all = entries(), query = input('sites-search').value.trim(), filter = element('sites-filter').value;
        const allowedByFilter = all.filter(entry => (filter === 'ALL' || classification(entry) === filter
            || filter === 'WHITELIST' && entry.hostnames.some(host => savedOutcomes.get(host) === 'ALLOW')
            || filter === 'BLACKLIST' && entry.hostnames.some(host => savedOutcomes.get(host) === 'DENY')));
        const matches = allowedByFilter.filter(entry => matchesSite(entry, query));
        const visible = directory?.startsWith('category:') ? allowedByFilter.filter(entry => categoryKey(entry.category || 'Uncategorized') === directory.slice(9)) : matches;
        let usage = {};
        try {
            usage = readDestinationUsage(JSON.parse(localStorage.getItem(usagePreferencesKey) ?? 'null'));
        }
        catch { /* No usage is not missing authority. */ }
        const categories = orderCategories(directoryCategories(allowedByFilter), options.categoryOrderMode?.() ?? 'custom', options.categoryOrder?.() ?? [], allowedByFilter, usage, Date.now());
        const groups = categories.map(category => {
            let node = categoryNodes.get(category.key);
            if (!node) {
                node = document.createElement('section');
                categoryNodes.set(category.key, node);
            }
            setProperty(node.dataset, 'categoryKey', category.key);
            setProperty(node.dataset, 'category', category.label);
            setProperty(node.dataset, 'count', String(category.count));
            setProperty(node.dataset, 'icon', options.categoryIcon?.(category.key, category.label) ?? 'category');
            return node;
        });
        options.renderCategories?.(groups);
        setProperty(element('sites-categories'), 'hidden', directory !== null);
        setProperty(element('sites-category-order-label'), 'hidden', directory !== null);
        setProperty(element('sites-list'), 'hidden', directory === null);
        setProperty(element('sites-categories-back'), 'hidden', directory === null);
        text('sites-directory-title', directory?.startsWith('category:') ? categories.find(c => c.key === directory.slice(9))?.label ?? 'Category' : directory === 'all' ? 'All sites' : 'Categories');
        renderSuggestions(matches, categories, query, ready);
        const phase = collectionPresentation(controller, all.length, options.attempted?.() === true || controller != null, display != null);
        setProperty(element('sites-section').dataset, 'phase', phase.phase);
        setProperty(element('sites-recovery'), 'hidden', phase.phase !== 'UNAVAILABLE');
        text('sites-status', phase.phase === 'READY' || phase.phase === 'EMPTY' ? `Current access rules · ${all.length} sites` : phase.message);
        setProperty(element('sites-pending'), 'hidden', controller?.snapshot?.vaultState.pendingProposal == null);
        const marked = new Set(session?.value.draft?.changes.map(change => change.id));
        const key = json([visible, display?.policy, visible.map(entry => marked.has(destinationId(entry)))]);
        if (key !== listKey) {
            listKey = key;
            const list = element('sites-list'), scroll = list.scrollTop ?? 0;
            const focused = document.activeElement, focusId = focused?.dataset.destinationId;
            const nodes = visible.map(entry => {
                const id = destinationId(entry);
                let row = siteRows.get(id);
                if (!row) {
                    const node = document.createElement('button');
                    node.type = 'button';
                    node.className = 'site-row';
                    node.dataset.destinationId = id;
                    const name = document.createElement('strong'), category = document.createElement('span'), badge = document.createElement('span');
                    category.className = 'note';
                    badge.className = 'pill';
                    const mark = options.siteMark?.(entry.hostname);
                    if (mark)
                        node.append(mark);
                    node.append(name, category, badge);
                    node.addEventListener('click', () => inspect(id));
                    row = { node, name, category, badge, mark };
                    siteRows.set(id, row);
                }
                setProperty(row.name, 'textContent', entry.label);
                setProperty(row.category, 'textContent', `${entry.hostname} · ${entry.category}`);
                if (row.mark && row.mark.dataset.hostname !== entry.hostname)
                    options.siteMark(entry.hostname, row.mark);
                const kind = classification(entry);
                setProperty(row.badge, 'textContent', `${kind === 'WHITELIST' ? 'Allowed' : kind === 'BLACKLIST' ? 'Blocked' : 'Mixed rules'}${marked.has(id) ? ' · Draft' : ''}`);
                setProperty(row.node, 'title', entry.hostnames.join(', '));
                return row.node;
            });
            const liveIds = new Set(all.map(destinationId));
            for (const id of siteRows.keys())
                if (!liveIds.has(id))
                    siteRows.delete(id);
            reconcileChildren(list, nodes);
            list.scrollTop = scroll;
            if (focusId)
                [...list.querySelectorAll('.site-row')].find(r => r.dataset.destinationId === focusId)?.focus({ preventScroll: true });
        }
        if (!restoredList && all.length && !element('sites-section').hidden) {
            element('sites-list').scrollTop = position.scroll;
            restoredList = true;
        }
        setProperty(element('sites-empty'), 'hidden', (directory === null ? categories.length : visible.length) !== 0 || phase.phase === 'LOADING' || phase.phase === 'UNAVAILABLE');
        const selected = all.find(entry => destinationId(entry) === selection);
        setProperty(element('sites-back'), 'hidden', !selected && !session?.value.draft?.editor);
        setProperty(element('site-selection-empty'), 'hidden', !!selected || !!session?.value.draft?.editor);
        setProperty(element('site-detail'), 'hidden', !selected || !!session?.value.draft?.editor);
        const detail = json([selected, display?.policy]);
        if (selected && detail !== detailKey) {
            detailKey = detail;
            text('site-detail-title', selected.label);
            text('site-detail-category', selected.category);
            element('site-detail-hosts').replaceChildren(...selected.hostnames.map(hostname => {
                const row = document.createElement('li'), result = evaluate({ hostname }, display.policy);
                const heading = document.createElement('div');
                heading.className = 'site-host-heading';
                const address = document.createElement('strong'), status = document.createElement('span');
                status.className = 'pill';
                address.textContent = hostname;
                status.textContent = result.outcome === 'DENY' ? uiText.blocked : result.outcome === 'ALLOW' ? uiText.allowed : uiText.greylist;
                heading.append(address, status);
                row.append(heading);
                if (display.policy.whitelistSubdomains?.includes(hostname)) {
                    const scope = document.createElement('p');
                    scope.className = 'note';
                    scope.textContent = uiText.includedSubdomains;
                    row.append(scope);
                }
                return row;
            }));
        }
        text('pin-site', selected && pinnedDestinations([selected], options.pins()).length ? uiText.unpinFromHome : uiText.pinToHome);
        setProperty(element('open-site'), 'disabled', !ready || !selected);
        setProperty(element('pin-site'), 'disabled', !ready || !selected || pinSaving);
        const locked = !ready || submitting || !session?.loaded || !!session?.conflict || !!activeReceipt();
        for (const id of ['add-site', 'edit-site', 'remove-site', 'propose-site', 'save-site-display'])
            setProperty(element(id), 'disabled', locked);
        setProperty(element('cancel-site-draft'), 'disabled', submitting || !!activeReceipt());
        const editorLocked = submitting || !!activeReceipt() || !!session?.conflict;
        editorControls.lock(editorLocked);
        for (const row of element('sites-list').querySelectorAll('.site-row'))
            setAttribute(row, 'aria-pressed', String(row.dataset.destinationId === selection));
        const suggestions = categorySuggestions([...all.map(e => e.category), ...preferences.destinations.map(e => e.category)], session?.value.draft?.changes.flatMap(c => c.after ? [c.after.metadata.category] : []) ?? []);
        const categoryOptions = element('site-categories'), categoriesKey = json(suggestions);
        if (categoryOptions.dataset.categories !== categoriesKey) {
            setProperty(categoryOptions.dataset, 'categories', categoriesKey);
            categoryOptions.replaceChildren(...suggestions.map(label => { const option = document.createElement('option'); setProperty(option, 'value', label); return option; }));
        }
        renderBatch(presentationState ?? null);
    }
    element('add-site').addEventListener('click', () => begin());
    element('edit-site').addEventListener('click', () => begin(selection));
    element('open-site').addEventListener('click', () => {
        if (disposed || !options.canEdit() || !snapshot())
            return;
        const selected = entries().find(entry => destinationId(entry) === selection);
        // A directory entry is a destination, never permission. Use the same
        // command/gate as search and Home, including blocked and temporary sites.
        if (selected)
            void options.propose({ kind: 'OPEN_DESTINATION', url: `https://${selected.hostname}/` });
    });
    element('pin-site').addEventListener('click', () => void (async () => {
        if (disposed || pinSaving || !options.canEdit() || !snapshot())
            return;
        const selected = entries().find(entry => destinationId(entry) === selection);
        if (!selected)
            return;
        pinSaving = true;
        options.changed();
        try {
            const result = await options.pin(destinationId(selected), !pinnedDestinations([selected], options.pins()).length, selected.hostnames);
            notice(result === 'SAVED' ? '' : uiText.pinSaveFailed, result === 'SAVED' ? 'status' : result === 'UNCERTAIN' ? 'uncertain' : 'error');
        }
        catch {
            notice(uiText.pinSaveFailed, 'uncertain');
        }
        finally {
            pinSaving = false;
            options.changed();
        }
    })());
    element('remove-site').addEventListener('click', () => void stageRemoval(selection));
    element('site-form').addEventListener('submit', event => { event.preventDefault(); void stage(); });
    element('save-site-display').addEventListener('click', () => void stage(true));
    element('cancel-site-draft').addEventListener('click', () => {
        if (session?.value.draft && !activeReceipt() && !submitting) {
            void session.setDraft({ ...session.value.draft, editor: null }).then(saved => {
                restoreEditor();
                if (saved) {
                    showView('browse');
                    syncDialog();
                    notice('Editor closed. Your draft is kept.');
                    queueMicrotask(focusSelection);
                }
            });
        }
    });
    for (const id of ['site-name', 'site-hostname', 'site-category', 'site-access', 'site-www', 'site-extra', 'site-pin', 'site-subdomains'])
        element(id).addEventListener('input', persistEditor);
    element('review-destination-draft').addEventListener('click', () => {
        showView(reviewOpen ? session?.value.draft?.editor || selection ? 'detail' : 'browse' : 'review');
        notice('');
        queueMicrotask(() => { if (reviewOpen) {
            element('draft-review-title').focus({ preventScroll: true });
            element('destination-draft-items').scrollTop = 0;
            element('main-content').scrollTop = 0;
            window.scrollTo?.({ top: 0, behavior: 'instant' });
        }
        else
            focusSelection(); });
    });
    element('sites-back').addEventListener('click', closeDetails);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDetails(); });
    dialog.addEventListener('click', event => {
        if (event.target !== dialog)
            return;
        const r = dialog.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)
            closeDetails();
    });
    element('continue-destination-editing').addEventListener('click', () => { showView(session?.value.draft?.editor || selection ? 'detail' : 'browse'); queueMicrotask(() => session?.value.draft?.editor ? input('site-name').focus() : focusSelection()); });
    element('resume-destination-editor').addEventListener('click', () => { showView('detail'); input('site-name').focus(); });
    element('discard-destination-summary').addEventListener('click', () => element('discard-destination-draft').click());
    element('submit-destination-draft').addEventListener('click', () => void submit());
    element('discard-destination-draft').addEventListener('click', () => {
        if (!session || activeReceipt() || submitting || !window.confirm(uiText.discardDraftQuestion))
            return;
        void session.setDraft(null).then(saved => {
            reconciliation = null;
            reviewOpen = false;
            restoreEditor();
            notice(saved ? uiText.draftDiscarded : uiText.draftDiscardUncertain, saved ? 'status' : 'uncertain');
        });
    });
    element('retry-destination-draft').addEventListener('click', () => void (async () => {
        if (!session) {
            try {
                const repository = await openDraftRepository();
                if (disposed) {
                    repository.close();
                    return;
                }
                session = new DestinationWorkspaceSession(repository, options.changed);
            }
            catch {
                notice('Draft storage still cannot be opened. No policy command was sent.', 'error');
                return;
            }
        }
        if (!session.loaded)
            loadFailure = !await session.load();
        else
            await session.retry();
        restoreEditor();
        options.changed();
        if (!loadFailure && !session.failure && !session.unsaved && !session.conflict)
            notice('Local draft saved.', 'success');
    })());
    element('discard-damaged-draft').addEventListener('click', () => void (async () => {
        if (!session || session.loadReason !== 'INVALID' || !window.confirm('Discard damaged local draft and display receipt data? These unsaved cosmetic terms will be lost. Active policy, pending Vault proposals and committed display details will remain.'))
            return;
        if (!await session.repository.discardInvalid?.()) {
            notice('Draft recovery did not discard data. Retry loading; a newer valid draft may have been saved elsewhere.', 'error');
            return;
        }
        loadFailure = !await session.load();
        restoreEditor();
        notice('Damaged local draft data discarded. Active policy and saved display details are unchanged.');
    })());
    element('reload-shared-draft').addEventListener('click', () => void (async () => {
        if (!session || !window.confirm('Load the newer shared draft? Unsaved local edits in this window will be discarded.'))
            return;
        await session.idle();
        await session.load();
        reconciliation = null;
        restoreEditor();
        notice('Newer saved draft loaded. Review it before submission.');
    })());
    element('reconcile-destination-draft').addEventListener('click', () => {
        void (async () => {
            const draft = session?.value.draft, state = await verifiedSnapshot();
            if (!state || !draft || session?.value.draft !== draft) {
                notice('Saved state or the draft changed while checking. Review the current draft before reconciling.', 'error');
                return;
            }
            reconciliation = reconcileDraft(draft, baseline(state));
            options.changed();
            notice('Reconciliation preview only. Review current committed values and proposed results, then explicitly accept; no authority changed.');
        })();
    });
    element('accept-draft-reconciliation').addEventListener('click', () => void (async () => {
        const reviewed = reconciliation, state = await verifiedSnapshot();
        if (!state || !session || !reviewed || reviewed !== reconciliation)
            return;
        const preview = reviewed.draft;
        if (assessDraft(preview, baseline(state)).stale.length || assessDraft(preview, baseline(state)).conflicts.length || preview.editor) {
            notice('Preview is stale or conflicting. Close the editor, resolve conflicts and review reconciliation again.', 'error');
            return;
        }
        if (await session.setDraft(preview)) {
            reconciliation = null;
            reviewOpen = true;
            notice('Reviewed reconciliation saved against current state. Submission still needs ordinary Vault waiting and confirmation.');
        }
    })());
    element('retry-site-save').addEventListener('click', () => void (async () => { if (legacyFailed) {
        legacyFailed = false;
        legacyDisplay();
    }
    else
        await applyDisplay(true); options.changed(); })());
    element('check-draft-submission').addEventListener('click', () => void checkSubmission());
    element('restore-submitted-draft').addEventListener('click', () => {
        const receipt = session?.value.receipt;
        if (!session || receipt?.phase !== 'RESOLVED' || session.value.draft) {
            notice('Finish the current draft before restoring a resolved batch.');
            return;
        }
        void session.setDraft(receipt.draft);
        notice('Resolved batch restored as editable work. Review stale baselines; a revised proposal requires a full new wait.');
    });
    element('keep-current-display').addEventListener('click', () => void keepCurrentDisplay());
    element('sites-review-pending').addEventListener('click', options.vault);
    for (const id of ['sites-search', 'sites-filter'])
        element(id).addEventListener('input', () => { searchFocused = true; render(options.canEdit()); remember(); });
    element('sites-search').addEventListener('focus', () => { searchFocused = true; render(options.canEdit()); });
    element('sites-categories-back').addEventListener('click', () => { chooseDirectory(null); });
    element('sites-show-all').addEventListener('click', () => { chooseDirectory('all'); });
    const searchKey = (event) => {
        const panel = element('sites-search-results');
        if (event.key === 'Escape') {
            event.preventDefault();
            searchFocused = false;
            panel.hidden = true;
            input('sites-search').focus();
            searchFocused = false;
            panel.hidden = true;
            setAttribute(input('sites-search'), 'aria-expanded', 'false');
            return;
        }
        if (panel.hidden || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key))
            return;
        const buttons = [...panel.querySelectorAll('button:not(:disabled)')];
        if (!buttons.length)
            return;
        if (event.key === 'Enter' && document.activeElement === input('sites-search')) {
            event.preventDefault();
            buttons[0].click();
            return;
        }
        if (event.key !== 'Enter') {
            event.preventDefault();
            const index = buttons.indexOf(document.activeElement);
            buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].focus();
        }
    };
    input('sites-search').addEventListener('keydown', searchKey);
    element('sites-search-results').addEventListener('keydown', searchKey);
    window.addEventListener('pointerdown', event => {
        const target = event.target;
        if (target !== input('sites-search') && !element('sites-search-results').contains(target)) {
            searchFocused = false;
            element('sites-search-results').hidden = true;
            setAttribute(input('sites-search'), 'aria-expanded', 'false');
        }
    });
    element('sites-list').addEventListener('scroll', remember, { passive: true });
    window.addEventListener('storage', event => {
        if (event.key !== destinationPreferencesKey && event.key !== null)
            return;
        const before = json([preferences, preferencesAvailable]);
        preferences = readPreferences();
        if (before !== json([preferences, preferencesAvailable]))
            options.changed();
    });
    window.addEventListener('pagehide', () => {
        disposed = true;
        // Complete already queued durable edits before releasing this page's port.
        void initialized.then(() => session?.idle()).finally(() => session?.repository.close());
        draftRows.clear();
        siteRows.clear();
    });
    return { render, refresh, metadata: () => preferences.destinations, initialized, idle: async () => { await initialized; await refreshing; await displaying; await session?.idle(); }, session: () => session, renderFrozenReview, navigation, focusSelection,
        directory: () => directory, chooseCategory: (key) => chooseDirectory(`category:${key}`),
        restoreDirectory: (value) => { directory = directoryView(value); },
        leave() { searchFocused = false; if (dialog.open)
            dialog.close(); },
        view: () => reviewOpen ? 'review' : detailVisible ? 'detail' : 'browse',
        restoreView(value, id) { if (typeof id === 'string') {
            selection = id;
            detailKey = '';
        } showView(value === 'review' || value === 'detail' ? value : 'browse', false); } };
}
