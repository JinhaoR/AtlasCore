import { setAttribute, setProperty } from './dom.js';
import { evaluate, type AtlasControllerResponse, type AtlasControllerView, type AtlasSnapshot } from '@atlas/core';
import type { AdapterView } from '../adapter/firefox-adapter.js';
import { policyDestinationIndex, type DestinationEntry } from './destinations.js';
import { destinationId, pinnedDestinations } from './home-model.js';
import { commonWwwCounterpart, explicitDestinationHosts } from './destination-policy.js';
import { destinationPreferencesKey, emptyDestinationPreferences, readDestinationPreferences, reconcileDestinationPreferences, replaceDestinationMetadata, type DestinationPreferences } from './destination-metadata.js';
import { savePresentation, type PresentationSaveResult } from './presentation-storage.js';
import { renderFeedback, type FeedbackTone } from './feedback.js';
import { collectionPresentation, hasCommittedCollection } from './data-view.js';
import { canonicalCategory, categorySuggestions } from './categories.js';
import { assessDraft, destinationChangeSummary, draftBaseline, newDestinationDraft, reconcileDraft, samePolicy, stageDestination,
  unstageDestination, validateDraftCandidate, type DestinationEditor, type DraftClassification, type DraftDestination } from './destination-draft.js';
import { openDraftRepository, type DestinationReceipt, type DraftRepository } from './draft-storage.js';
import { DestinationWorkspaceSession, receiptOutcome } from './destination-workspace.js';
import { emptySitesPosition, type SitesPosition } from './navigation-state.js';

export interface SitesCommandResponse { readonly result?: AtlasControllerResponse; readonly view?: AdapterView; readonly error?: string; readonly opened?: boolean }
interface SitesOptions {
  controller(): AtlasControllerView | null | undefined; canEdit(): boolean; attempted?(): boolean;
  pins(): readonly string[]; pin(id: string, pinned: boolean, hosts: readonly string[]): PresentationSaveResult;
  propose(command: object): Promise<SitesCommandResponse | undefined>; vault(): void; changed(): void;
  feedback(message: string, tone?: FeedbackTone): void;
  drafts?: Promise<DraftRepository>; newId?(): string;
  position?: SitesPosition; positionChanged?(position: SitesPosition): void;
  verify?(): Promise<AtlasControllerView | null>;
}
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const text = (id: string, value: string) => { if (element(id).textContent !== value) setProperty(element(id), 'textContent', value); };
const json = (value: unknown) => JSON.stringify(value);

/** Editable work, frozen receipts and committed presentation have distinct lifecycles. */
export function initializeSites(options: SitesOptions) {
  const newId = options.newId ?? (() => crypto.randomUUID()), owner = newId();
  let preferences = emptyDestinationPreferences(), preferencesAvailable = true, session: DestinationWorkspaceSession | null = null;
  preferences = readPreferences();
  let loadFailure = false, submitting = false, displayFailed = false, legacyFailed = false, disposed = false;
  let refreshing: Promise<void> | null = null;
  let displaying: Promise<void> | null = null;
  let entriesKey = '', savedEntries: readonly DestinationEntry[] = [];
  let lastPresentationSave: PresentationSaveResult = 'SAVED';
  const position = options.position ?? emptySitesPosition();
  let selection = position.selection, listKey = '', detailKey = '', batchKey = '', editorKey = '';
  let restoredList = false;
  setProperty(input('sites-search'), 'value', position.search); setProperty(element<HTMLSelectElement>('sites-filter'), 'value', position.filter);
  const navigation = (): SitesPosition => ({ selection, search: input('sites-search').value,
    filter: element<HTMLSelectElement>('sites-filter').value, scroll: element('sites-list').scrollTop ?? 0 });
  const remember = () => options.positionChanged?.(navigation());
  function focusSelection(): void {
    const row = [...element('sites-list').querySelectorAll<HTMLButtonElement>('.site-row')].find(r => r.dataset.destinationId === selection);
    (row ?? element('add-site')).focus({ preventScroll: true });
  }
  let lastController: AtlasControllerView | null = null;
  let reconciliation: ReturnType<typeof reconcileDraft> | null = null, reviewOpen = false;
  const drafts = options.drafts ?? openDraftRepository();
  const initialized = drafts.then(async repository => {
    session = new DestinationWorkspaceSession(repository, options.changed);
    loadFailure = !await session.load(); restoreEditor(); options.changed();
  }).catch(() => { loadFailure = true; options.changed(); });

  function readPreferences(): DestinationPreferences {
    try { const saved = readDestinationPreferences(JSON.parse(localStorage.getItem(destinationPreferencesKey) ?? 'null')); preferencesAvailable = true; return saved; }
    catch { preferencesAvailable = false; return preferences; }
  }
  function notice(message: string, tone: FeedbackTone = 'status'): void {
    if (disposed) return;
    renderFeedback(element('site-save-feedback'), { message, tone }); options.feedback(message, tone);
  }
  const snapshot = () => options.controller()?.status === 'READY' ? options.controller()?.snapshot : null;
  const verifiedSnapshot = async () => {
    if (!options.verify) return snapshot();
    try { const latest = await options.verify(); return latest?.status === 'READY' ? latest.snapshot : null; }
    catch { return null; }
  };
  const baseline = (state: AtlasSnapshot) => draftBaseline(state, preferences, options.pins());
  const entries = () => {
    const policy = (options.controller()?.snapshot ? options.controller() : lastController)?.snapshot?.policy;
    const key = json([policy, preferences.destinations]);
    if (key !== entriesKey) { entriesKey = key; savedEntries = policy ? policyDestinationIndex(policy, preferences.destinations) : []; }
    return savedEntries;
  };
  const classification = (entry: DestinationEntry, policy: AtlasSnapshot['policy']): string => {
    const outcomes = new Set(entry.hostnames.map(hostname => evaluate({ hostname }, policy).outcome));
    return outcomes.size > 1 ? 'MIXED' : outcomes.has('DENY') ? 'BLACKLIST' : outcomes.has('ALLOW') ? 'WHITELIST' : 'GREYLIST';
  };
  const activeReceipt = () => session?.value.receipt && !['DONE', 'KEPT', 'RESOLVED'].includes(session.value.receipt.phase) ? session.value.receipt : null;
  function currentEditor(): DestinationEditor | null {
    const editor = session?.value.draft?.editor;
    if (!editor) return null;
    return { id: editor.id, name: input('site-name').value, hostname: input('site-hostname').value, category: input('site-category').value,
      access: element<HTMLSelectElement>('site-access').value as DraftClassification, www: input('site-www').checked,
      extra: input('site-extra').value, pinned: input('site-pin').checked };
  }
  function restoreEditor(): void {
    if (disposed) return;
    const editor = session?.value.draft?.editor;
    if (!editor) { setProperty(element('site-draft'), 'hidden', true); editorKey = ''; return; }
    if (json(editor) === editorKey) return;
    clearFieldError();
    editorKey = json(editor); setProperty(element('site-draft'), 'hidden', false);
    text('site-draft-title', editor.id ? 'Edit destination in local draft' : 'Add a destination to your draft');
    setProperty(input('site-name'), 'value', editor.name); setProperty(input('site-hostname'), 'value', editor.hostname); setProperty(input('site-category'), 'value', editor.category);
    setProperty(element<HTMLOptionElement>('site-preserve-rules'), 'hidden', editor.id === null);
    setProperty(element<HTMLSelectElement>('site-access'), 'value', editor.access);
    setProperty(input('site-www'), 'checked', editor.www); setProperty(input('site-extra'), 'value', editor.extra); setProperty(input('site-pin'), 'checked', editor.pinned); scope();
  }
  function scope(locked = false): void {
    const counterpart = commonWwwCounterpart(input('site-hostname').value.trim());
    setProperty(input('site-www'), 'disabled', locked || counterpart === null);
    // Partial hostname typing must not reset a deliberate checkbox choice.
    text('site-www-label', counterpart === null ? 'No common www counterpart for this hostname' : `Include ${counterpart}`);
    const hosts = explicitDestinationHosts(input('site-hostname').value.trim(), counterpart !== null && input('site-www').checked, input('site-extra').value);
    text('site-scope-preview', hosts ? `Proposed exact hosts: ${hosts.join(', ')}` : 'Enter valid exact hostnames. Wildcards are unsupported.');
    const access = element<HTMLSelectElement>('site-access').value;
    const meaningfulPin = access !== 'BLACKLIST' && (access !== 'PRESERVE'
      || hosts?.some(host => evaluate({ hostname: host }, session!.value.draft!.baseline.policy).outcome === 'ALLOW'));
    setProperty(element('site-pin-field'), 'hidden', !meaningfulPin); setProperty(input('site-pin'), 'disabled', locked || !meaningfulPin);
    setProperty(element('save-site-display'), 'hidden', !session?.value.draft?.editor?.id || access !== 'PRESERVE');
  }
  function persistEditor(): void {
    if (!session?.value.draft || submitting || activeReceipt() || session.conflict) return;
    clearFieldError();
    scope(); const editor = currentEditor(); if (!editor) return;
    editorKey = json(editor); void session.setDraft({ ...session.value.draft, editor });
  }
  function clearFieldError(): void {
    for (const id of ['site-name', 'site-hostname', 'site-extra', 'site-category'])
      if (input(id).getAttribute('aria-invalid') === 'true') setAttribute(input(id), 'aria-invalid', 'false');
    renderFeedback(element('site-field-error'), { tone: 'status', message: '' });
  }
  function begin(id?: string): void {
    const state = options.controller()?.snapshot;
    if (!state || !options.canEdit() || !session?.loaded || submitting || activeReceipt() || session.conflict) return;
    if (session.value.draft?.editor) { notice('Add or close the current editor first. Your entered values are preserved.'); input('site-name').focus(); return; }
    const draft = session.value.draft ?? newDestinationDraft(newId(), baseline(state));
    const item = id ? draft.changes.find(c => c.id === id)?.after ?? draft.baseline.entries.find(e => e.metadata.id === id) : null;
    const counterpart = commonWwwCounterpart(item?.metadata.primaryHostname ?? '');
    const editor: DestinationEditor = { id: item?.metadata.id ?? null, name: item?.metadata.label ?? '', hostname: item?.metadata.primaryHostname ?? '',
      category: item?.metadata.category ?? 'Your destinations', access: item?.classification ?? 'WHITELIST',
      www: item?.metadata.hostnames.includes(counterpart ?? '') ?? false,
      extra: item?.metadata.hostnames.filter(h => h !== item.metadata.primaryHostname && h !== counterpart).join(', ') ?? '', pinned: item?.pinned ?? false };
    void session.setDraft({ ...draft, editor }); restoreEditor(); reviewOpen = false; options.changed();
    notice('Editing local draft. Add this change to the batch when ready; active policy is unchanged.'); input('site-name').focus();
  }
  async function stage(immediateDisplay = false): Promise<void> {
    const state = options.controller()?.snapshot ?? lastController?.snapshot, editor = currentEditor(), draft = session?.value.draft;
    if (!state || !editor || !draft || !session || submitting || session.conflict || activeReceipt()) return;
    const hosts = explicitDestinationHosts(editor.hostname.trim(), commonWwwCounterpart(editor.hostname) !== null && editor.www, editor.extra);
    const invalid = !editor.name.trim() || editor.name.trim().length > 100 ? 'site-name'
      : !explicitDestinationHosts(editor.hostname.trim(), false, '') ? 'site-hostname'
        : !hosts ? 'site-extra' : !editor.category.trim() || editor.category.trim().length > 64 ? 'site-category' : null;
    if (invalid !== null || !hosts) {
      const messages: Record<string, string> = {
        'site-name': 'Enter a destination name of 1–100 characters.',
        'site-hostname': 'Enter an exact primary hostname, such as example.com. URLs and wildcards are unsupported.',
        'site-extra': 'Enter valid additional exact hostnames, separated by commas. URLs and wildcards are unsupported.',
        'site-category': 'Enter a category of 1–64 characters.',
      };
      const field = input(invalid ?? 'site-hostname'); setAttribute(field, 'aria-invalid', 'true');
      renderFeedback(element('site-field-error'), { message: messages[invalid ?? 'site-hostname']!, tone: 'error' });
      const disclosure = field.closest('details'); if (disclosure) disclosure.open = true;
      field.focus(); return;
    }
    const suggestions = categorySuggestions(preferences.destinations.map(d => d.category), draft.changes.flatMap(c => c.after ? [c.after.metadata.category] : []));
    const id = editor.id ?? `host:${hosts[0]!}`;
    const after: DraftDestination = { metadata: { id, label: editor.name.trim(), category: canonicalCategory(editor.category, suggestions), primaryHostname: hosts[0]!, hostnames: hosts },
      classification: editor.access, pinned: input('site-pin').disabled ? false : editor.pinned };
    const staged = stageDestination(draft, id, after);
    if (!await session.setDraft(staged)) {
      session.value = { ...session.value, draft: { ...staged, editor } }; editorKey = json(editor);
      notice('Draft could not be verified as saved. Your work is retained in this page; retry saving before closing it or submitting.', session.conflict ? 'error' : 'uncertain'); options.changed(); return;
    }
    restoreEditor(); options.changed(); queueMicrotask(focusSelection);
    notice('Change added to saved local draft. No Vault wait has started and active policy is unchanged.', 'success');
    if (immediateDisplay) { reviewOpen = true; await submit(); }
  }
  async function stageRemoval(id: string): Promise<void> {
    const state = options.controller()?.snapshot; if (!state || !session?.loaded || submitting || activeReceipt() || session.conflict) return;
    if (session.value.draft?.editor) { notice('Add or close the current editor before staging a removal.'); return; }
    const draft = session.value.draft ?? newDestinationDraft(newId(), baseline(state));
    await session.setDraft(stageDestination(draft, id, null)); options.changed(); notice('Removal staged in local draft. Managed Blacklist rules are unchanged.');
  }
  async function submit(): Promise<void> {
    if (submitting || !session?.loaded) return;
    await session.idle(); const state = await verifiedSnapshot(), draft = session.value.draft; preferences = readPreferences();
    if (submitting) return;
    if (!state) { notice('Saved state could not be verified during preparation. Your draft remains saved. Recover state, then explicitly retry.', 'error'); return; }
    if (!options.canEdit() || !preferencesAvailable || !reviewOpen || !draft || draft.editor || !draft.changes.length || session.unsaved || session.failure || session.conflict || activeReceipt()) {
      notice('Finish editing and save the draft before submitting. Resolve any storage conflict or pending display save.', 'error'); return;
    }
    const assessment = validateDraftCandidate(draft, baseline(state), state);
    if (!assessment.candidatePolicy || assessment.stale.length || assessment.conflicts.length) { notice('Review and resolve stale data or draft conflicts before submission.', 'error'); return; }
    if (assessment.policyChanged && state.vaultState.pendingProposal || preferences.pending) { notice('A frozen proposal or display save is already pending. Review the existing Vault proposal first.'); return; }
    submitting = true; options.changed();
    const receipt: DestinationReceipt = { kind: assessment.policyChanged ? 'POLICY' : 'DISPLAY', draft: structuredClone(draft), candidatePolicy: assessment.candidatePolicy,
      expectedProposalId: state.vaultState.nextProposalId, proposalId: null, baseConfigurationRevision: state.configurationRevision, phase: 'PREPARED', owner: null };
    try {
      if (!await session.set({ ...session.value, receipt })) { notice('Frozen submission intent could not be saved. No policy command was sent; retry local storage first.', 'error'); return; }
      const latest = await verifiedSnapshot(); preferences = readPreferences();
      if (!latest || !preferencesAvailable || assessDraft(draft, baseline(latest)).stale.length) {
        await session.set({ ...session.value, receipt: { ...receipt, phase: 'RESOLVED' } });
        notice(!latest || !preferencesAvailable ? 'Saved state could not be verified during preparation. Your draft remains saved. Recover state, then explicitly retry.'
          : 'The baseline changed during submission preparation. No policy command was sent. Review the saved draft against current state.', 'error'); return;
      }
      if (!assessment.policyChanged) {
        if (await session.set({ ...session.value, draft: null, receipt: { ...receipt, phase: 'PROPOSED' } })) await applyDisplay(false); return;
      }
      let response: SitesCommandResponse | undefined;
      try { response = await options.propose({ kind: 'PROPOSE_POLICY', candidatePolicy: receipt.candidatePolicy, basePolicyRevision: draft.baseline.policyRevision }); } catch { /* Preserve uncertain intent. */ }
      const proposal = response?.view?.controller?.snapshot?.vaultState.pendingProposal;
      if (response?.result?.type === 'COMMITTED' && proposal && samePolicy(proposal.candidatePolicy, receipt.candidatePolicy)) {
        await session.set({ ...session.value, draft: null, receipt: { ...receipt, phase: 'PROPOSED', proposalId: proposal.id } }); restoreEditor();
        notice('One Vault proposal saved for the complete batch. Active policy is unchanged; wait and explicitly confirm in Vault.', 'success'); options.vault();
      } else if (response?.result?.type === 'REJECTED' || response?.result?.type === 'BLOCKED' && response.result.reason !== 'COMMIT_UNKNOWN'
        && response.result.status !== 'RECONCILING' || response?.error === 'POLICY_DRAFT_STALE') {
        await session.set({ ...session.value, receipt: { ...receipt, phase: 'RESOLVED' } }); notice('The batch was not submitted. Your saved draft is preserved; review current state before retrying.', 'error');
      } else notice('Proposal submission outcome is uncertain. Frozen intent is saved; check saved authority before another submission. Do not repeat the proposal.', 'uncertain');
    } finally { submitting = false; options.changed(); }
  }
  /** Settle Core first. Never repeat Propose or Confirm to repair presentation. */
  async function checkSubmission(): Promise<void> {
    if (!session || submitting) return; submitting = true; options.changed();
    try {
      const response = await options.propose({ kind: 'RECOVER' });
      const state = response?.view?.controller?.status === 'READY' ? response.view.controller.snapshot : null, receipt = activeReceipt();
      if (!state || !receipt) { notice('Saved authority is still unavailable. Frozen submission intent is preserved.', 'uncertain'); return; }
      const outcome = receiptOutcome(receipt, state);
      if (outcome === 'WAITING' || outcome === 'COMMITTED') {
        await session.set({ ...session.value, draft: session.value.draft?.id === receipt.draft.id ? null : session.value.draft,
          receipt: { ...receipt, proposalId: receipt.proposalId ?? receipt.expectedProposalId, phase: 'PROPOSED', owner: null } }, true);
        notice(outcome === 'WAITING' ? 'Existing saved proposal found. Review it in Vault; no second proposal was created.' : 'Policy committed and is active. Retry only accompanying display details.', 'success');
      } else if (receipt.proposalId !== null || state.vaultState.nextProposalId === receipt.expectedProposalId) {
        await session.set({ ...session.value, draft: session.value.draft ?? receipt.draft, receipt: { ...receipt, phase: 'RESOLVED', owner: null } }, true);
        notice('No matching active proposal or commit remains. Editable batch restored for explicit review; no permission or new wait was created.');
      } else notice('Submission cannot be correlated with current authority. Keep frozen intent and inspect Vault before proceeding.', 'uncertain');
    } finally { submitting = false; options.changed(); }
  }
  async function keepCurrentDisplay(): Promise<void> {
    const receipt = activeReceipt();
    if (!session || !receipt || submitting || session.unsaved || session.failure || session.conflict) return;
    const uncertainIntent = receipt.phase === 'PREPARED';
    const state = await verifiedSnapshot();
    const canDiscardIntent = uncertainIntent && state && receiptOutcome(receipt, state) === 'UNKNOWN'
      && !state.vaultState.pendingProposal && state.vaultState.nextProposalId > receipt.expectedProposalId;
    if (receipt.phase !== 'APPLYING' && !canDiscardIntent) return;
    const prompt = uncertainIntent
      ? 'Discard this uncorrelated local batch and its remaining display terms? Its historical outcome cannot be established. Current saved policy and display details remain. No proposal will be sent, confirmed or cancelled.'
      : 'Keep current display details and discard this batch’s remaining display edits? Committed policy will remain active.';
    if (!window.confirm(prompt)) return;
    submitting = true; options.changed();
    try {
      if (uncertainIntent) {
        // Recovery settles any outstanding Core write before local intent can be
        // abandoned. No pending proposal may be hidden by this action.
        const response = await options.propose({ kind: 'RECOVER' });
        const verified = response?.view?.controller?.status === 'READY' ? response.view.controller.snapshot : null;
        if (!verified || verified.vaultState.pendingProposal || receiptOutcome(receipt, verified) !== 'UNKNOWN'
          || verified.vaultState.nextProposalId <= receipt.expectedProposalId) {
          notice('Saved authority is unsettled or a proposal remains. Frozen local intent is preserved; check its outcome and review Vault.', 'uncertain'); return;
        }
      }
      const saved = await session.set({ ...session.value, receipt: { ...receipt, phase: 'KEPT', owner: null },
        draft: uncertainIntent && session.value.draft?.id === receipt.draft.id ? null : session.value.draft });
      if (!saved) { notice('Local discard could not be verified as saved. Retry local storage; saved authority is unchanged.', 'uncertain'); return; }
      displayFailed = false; restoreEditor();
      notice(uncertainIntent ? 'Uncorrelated local batch discarded. Current saved policy and display details kept; no policy command was repeated.'
        : 'Remaining display edits discarded. Current saved policy and display details kept.', 'success');
    } finally { submitting = false; options.changed(); }
  }
  function savePreferences(value: DestinationPreferences): boolean {
    const outcome = lastPresentationSave = savePresentation(() => localStorage, destinationPreferencesKey, json(value));
    if (outcome === 'SAVED') { preferences = value; return true; }
    notice(outcome === 'FAILED' ? 'The display save failed. Retry only display details; saved policy is preserved.' : 'The display save outcome could not be verified. Retry only display details; saved policy is preserved.', outcome === 'FAILED' ? 'error' : 'uncertain'); return false;
  }
  function applyDisplay(explicit: boolean): Promise<void> {
    if (displaying) return displaying;
    displaying = applyVerifiedDisplay(explicit).finally(() => { displaying = null; options.changed(); });
    options.changed(); return displaying;
  }
  async function applyVerifiedDisplay(explicit: boolean): Promise<void> {
    const state = explicit ? await verifiedSnapshot() : snapshot(), receipt = activeReceipt();
    if (!session || !state || !receipt || session.conflict || session.unsaved || session.failure || displayFailed && !explicit) return;
    if (receiptOutcome(receipt, state) !== 'COMMITTED' || receipt.phase === 'APPLYING' && !explicit) return;
    const claimed = { ...receipt, phase: 'APPLYING' as const, owner };
    if (!await session.set({ ...session.value, receipt: claimed })) return;
    const latest = await verifiedSnapshot();
    if (!latest || receiptOutcome(receipt, latest) !== 'COMMITTED') {
      displayFailed = true; notice('Authority changed during display preparation. Frozen details are retained; verify saved state before retrying.', 'error'); return;
    }
    displayFailed = true; const current = readPreferences();
    if (!preferencesAvailable) { notice('The display save outcome could not be verified because storage is unavailable. Frozen terms are preserved for retry; saved policy is unaffected.', 'uncertain'); return; }
    let destinations = current.destinations;
    for (const change of receipt.draft.changes) {
      const before = receipt.draft.baseline.metadata.find(item => item.id === change.id) ?? null;
      const saved = destinations.find(item => item.id === change.id) ?? null, after = change.after?.metadata ?? null;
      if (json(saved) !== json(before) && json(saved) !== json(after)
        || after && destinations.some(item => item.id !== change.id && item.hostnames.some(host => after.hostnames.includes(host)))) {
        notice('Policy is preserved, but another page changed these display details. Retry cannot overwrite them. Review the conflicting destination or keep current display details.', 'error'); return;
      }
      destinations = replaceDestinationMetadata(destinations, after, change.id);
    }
    if (!savePreferences({ ...current, destinations })) {
      notice(receipt.kind === 'POLICY' ? 'Policy committed and is active. Display details could not be verified as saved. Retry only display details and pins; do not resubmit policy.'
        : 'Display details could not be verified as saved. Frozen values are preserved for explicit retry; exact access rules are unchanged.', lastPresentationSave === 'FAILED' ? 'error' : 'uncertain'); return;
    }
    for (const change of receipt.draft.changes) {
      const after = change.after, hosts = [...new Set([...(change.before?.metadata.hostnames ?? []), ...(after?.metadata.hostnames ?? [])])];
      const savedPin = pinnedDestinations([{ id: change.id, label: '', category: '', hostname: hosts[0]!, hostnames: hosts }], options.pins()).length > 0;
      if (savedPin !== (change.before?.pinned ?? false) && savedPin !== (after?.pinned ?? false)) { notice('A pin changed elsewhere. Review it before retrying display details.', 'error'); return; }
      const result = options.pin(change.id, after?.pinned ?? false, hosts);
      if (result !== 'SAVED') { notice(receipt.kind === 'POLICY' ? 'Policy committed and is active. Display details saved, but pins could not be verified. Retry only display details and pins.'
        : 'Display details saved, but pins could not be verified. Retry the remaining display save; exact access rules are unchanged.', result === 'FAILED' ? 'error' : 'uncertain'); return; }
    }
    if (!await session.set({ ...session.value, receipt: { ...claimed, phase: 'DONE', owner: null }, draft: session.value.draft?.id === receipt.draft.id ? null : session.value.draft })) {
      notice('Display details and pins saved. Completion receipt could not be verified; retry only display cleanup.', 'uncertain'); return;
    }
    displayFailed = false; restoreEditor(); options.changed(); notice(receipt.kind === 'POLICY' ? 'Complete batch policy committed. Accompanying display details and pins are saved.' : 'Display details and pins saved. Exact access rules are unchanged.', 'success');
  }
  function legacyDisplay(): void {
    const state = snapshot(); if (!state || !preferences.pending || legacyFailed || activeReceipt()) return;
    const pending = preferences.pending, result = reconcileDestinationPreferences(preferences, state); if (result.preferences === preferences) return;
    const hosts = pending.destination?.hostnames ?? preferences.destinations.find(d => d.id === pending.removedId)?.hostnames ?? [];
    if (!savePreferences(result.pinChange ? { ...result.preferences, pending } : result.preferences)
      || result.pinChange && (options.pin(result.pinChange.id, result.pinChange.pinned, hosts) !== 'SAVED' || !savePreferences(result.preferences))) {
      legacyFailed = true; notice('Saved legacy policy is preserved. Retry only accompanying display details.', 'error');
    } else { notice(result.pinChange ? 'Policy committed. Accompanying display details and pins saved.' : 'Resolved pending display terms cleared.', 'success'); options.changed(); }
  }
  function renderFrozenReview(): void {
    const state = options.controller()?.snapshot, receipt = session?.value.receipt;
    const matched = receipt?.kind === 'POLICY' && state?.vaultState.pendingProposal && (receipt.proposalId ?? receipt.expectedProposalId) === state.vaultState.pendingProposal.id
      && samePolicy(receipt.candidatePolicy, state.vaultState.pendingProposal.candidatePolicy);
    const panel = element('vault-destination-review'); setProperty(panel, 'hidden', !matched);
    if (matched) setProperty(element('vault-changes'), 'hidden', true); // Full raw scope stays in the Core review disclosure.
    const key = matched ? json(receipt) : ''; if (panel.dataset.review === key) return; setProperty(panel.dataset, 'review', key);
    element('vault-destination-items').replaceChildren(...(matched ? receipt.draft.changes : []).map(change => {
      const li = document.createElement('li'); setProperty(li, 'textContent', destinationChangeSummary(change, receipt!.draft.baseline.policy, receipt!.candidatePolicy).join('\n')); return li;
    }));
  }
  function renderBatch(state: AtlasSnapshot | null): void {
    const draft = session?.value.draft, receipt = session?.value.receipt;
    const frozen = activeReceipt();
    text('destination-draft-heading', frozen ? 'Frozen destination batch' : 'Local destination draft');
    text('destination-workspace-kind', !session?.loaded ? loadFailure || session?.loadReason === 'INVALID' ? 'Local state unavailable' : 'Loading local workspace'
      : frozen ? 'Frozen submission' : draft ? 'Editable · no authority'
      : receipt?.phase === 'DONE' ? 'Completed local batch' : receipt ? 'Resolved local batch' : 'No staged changes');
    // Empty is a verified local presentation state, never a substitute for authority.
    const workspace = session?.loaded && !draft && !receipt
      && !session.unsaved && !session.failure && !session.conflict && !loadFailure ? 'empty' : 'work';
    if (element('destination-draft-panel').dataset.workspace !== workspace) setProperty(element('destination-draft-panel').dataset, 'workspace', workspace);
    const current = state ? baseline(state) : draft?.baseline;
    const assessment = draft && current ? state ? validateDraftCandidate(draft, current, state) : assessDraft(draft, current) : null;
    let status = !session?.loaded ? session?.loadReason === 'INVALID' ? 'Saved local drafts are damaged or incompatible. Submission disabled. Explicitly discard damaged draft data to recover; policy is preserved.'
      : loadFailure ? 'Local draft storage unavailable. Saved drafts cannot be verified; submission disabled.' : 'Loading saved local draft…'
      : session.conflict ? 'Another Atlas window saved a newer draft. Your local work is retained. Explicitly reload the shared draft before continuing.'
        : session.unsaved || session.failure ? 'Unsaved local work. Keep this page open and retry saving; recovery is not guaranteed.'
          : draft?.changes.length || draft?.editor ? `Saved editable draft · ${draft.changes.length} staged changes. No authority or Vault wait.` : 'No local changes staged.';
    if (!state && draft) status += ' Authoritative state unavailable; draft retained, submission disabled.';
    text('destination-draft-status', status);
    text('destination-draft-stale', assessment?.stale.length ? `Stale draft: ${assessment.stale.join('; ')}. Review reconciliation before submission.` : '');
    setProperty(element('destination-draft-stale'), 'hidden', !assessment?.stale.length);
    const conflicts = assessment?.conflicts ?? [], key = json([draft?.changes, conflicts, reviewOpen, reconciliation]);
    if (key !== batchKey) {
      batchKey = key;
      element('destination-draft-items').replaceChildren(...(draft?.changes ?? []).map(change => {
        const row = document.createElement('li'); row.className = 'draft-item'; setProperty(row.dataset, 'destinationId', change.id);
        const content = document.createElement('div'), lines = destinationChangeSummary(change, draft!.baseline.policy, assessment?.candidatePolicy ?? draft!.baseline.policy);
        lines.slice(0, reviewOpen ? lines.length : 3).forEach((line, index) => { const p = document.createElement(index === 0 ? 'strong' : 'p'); setProperty(p, 'textContent', line); content.append(p); });
        conflicts.filter(c => c.id === change.id).forEach(c => { const p = document.createElement('p'); setProperty(p, 'textContent', c.message); p.className = 'draft-conflict'; content.append(p); });
        const actions = document.createElement('div'); actions.className = 'actions';
        const edit = document.createElement('button'); edit.type = 'button'; setProperty(edit, 'textContent', change.after ? 'Edit staged item' : 'Restore / edit'); edit.className = 'secondary compact';
        edit.dataset.draftAction = 'EDIT';
        setProperty(edit, 'disabled', !state || !!activeReceipt() || !!session?.conflict); edit.addEventListener('click', () => begin(change.id));
        const remove = document.createElement('button'); remove.type = 'button'; setProperty(remove, 'textContent', 'Remove from draft'); remove.className = 'text-button';
        remove.dataset.draftAction = 'REMOVE';
        remove.className = 'text-button destructive';
        setProperty(remove, 'disabled', !!activeReceipt() || !!session?.conflict); remove.addEventListener('click', () => { if (session?.value.draft) void session.setDraft(unstageDestination(session.value.draft, change.id)); });
        const removeRule = document.createElement('button'); removeRule.type = 'button'; setProperty(removeRule, 'textContent', 'Stage removal'); removeRule.className = 'text-button'; setProperty(removeRule, 'hidden', change.after === null);
        removeRule.dataset.draftAction = 'REMOVE_RULE';
        setProperty(removeRule, 'disabled', !!activeReceipt() || !!session?.conflict); removeRule.addEventListener('click', () => void stageRemoval(change.id));
        actions.append(edit, remove, removeRule); row.append(content, actions); return row;
      }));
      element('destination-draft-conflicts').replaceChildren(...conflicts.map(c => { const p = document.createElement('p'); setProperty(p, 'textContent', `${c.id ? `${c.id}: ` : ''}${c.message}`); return p; }));
      const preview = reconciliation;
      element('draft-reconciliation-items').replaceChildren(...(preview?.draft.changes ?? []).map(change => {
        const li = document.createElement('li'); setProperty(li, 'textContent', destinationChangeSummary(change, preview!.draft.baseline.policy,
          assessDraft(preview!.draft, preview!.draft.baseline).candidatePolicy ?? preview!.draft.baseline.policy).join('\n')); return li;
      }));
      text('draft-reconciliation-conflicts', preview?.conflicts.map(c => `${c.id}: ${c.message}`).join('\n') ?? '');
    }
    const locked = submitting || !state || !session?.loaded || !!session?.conflict || !!activeReceipt();
    for (const button of element('destination-draft-items').querySelectorAll<HTMLButtonElement>('[data-draft-action]')) {
      setProperty(button, 'disabled', submitting || !!activeReceipt() || !!session?.conflict
        || button.dataset.draftAction !== 'REMOVE' && !state);
    }
    setProperty(element('draft-reconciliation'), 'hidden', reconciliation === null);
    setProperty(element<HTMLButtonElement>('reconcile-destination-draft'), 'disabled', locked || !assessment?.stale.length);
    setProperty(element<HTMLButtonElement>('accept-draft-reconciliation'), 'disabled', locked || !reconciliation
      || assessDraft(reconciliation.draft, reconciliation.draft.baseline).conflicts.length > 0 || reconciliation.draft.editor !== null);
    setProperty(element<HTMLButtonElement>('review-destination-draft'), 'disabled', !draft?.changes.length || draft.editor !== null);
    setProperty(element<HTMLButtonElement>('submit-destination-draft'), 'disabled', locked || !!session?.unsaved || !!session?.failure || !reviewOpen || !assessment?.candidatePolicy
      || !!assessment.stale.length || !!draft?.editor || !draft?.changes.length || assessment.policyChanged && state?.vaultState.pendingProposal != null || preferences.pending !== null);
    text('submit-destination-draft', assessment?.policyChanged ? 'Submit complete batch to Vault' : 'Save display changes');
    text('draft-submit-help', activeReceipt() ? 'This batch is frozen. Review or cancel it in Vault; resolve pending display saves before editing again.'
      : state?.vaultState.pendingProposal ? 'A proposal is already in Vault. Prepare local work freely; a new policy batch cannot replace it.'
      : draft?.editor ? 'Add or close the editor before reviewing the batch.' : !reviewOpen && draft?.changes.length ? 'Review the complete batch before submitting.'
        : assessment?.stale.length ? 'Accept a reviewed reconciliation before submission.' : conflicts.length ? 'Resolve the conflicts above before submission.'
          : assessment?.policyChanged ? 'One Vault wait and explicit confirmation protects the whole batch. Managed Blacklist rules remain unchanged.' : 'Names, categories and pins save directly without a Vault cooldown.');
    setProperty(element('retry-destination-draft'), 'hidden', !loadFailure && !session?.unsaved && !session?.failure);
    setProperty(element('discard-damaged-draft'), 'hidden', session?.loadReason !== 'INVALID');
    setProperty(element('reload-shared-draft'), 'hidden', !session?.conflict);
    setProperty(element<HTMLButtonElement>('discard-destination-draft'), 'disabled', submitting || !draft || !!activeReceipt());
    setProperty(element('destination-receipt'), 'hidden', !receipt);
    const outcome = receipt && state ? receiptOutcome(receipt, state) : null;
    text('destination-receipt-status', !receipt ? '' : receipt.phase === 'DONE' ? 'Applied batch: policy (if changed), display details and pins acknowledged.'
      : receipt.phase === 'KEPT' ? 'Current saved policy and display details kept; remaining local batch terms were discarded.'
      : receipt.phase === 'RESOLVED' ? 'Proposal resolved without applying accompanying display details. Restore only as an editable draft.'
        : outcome === 'COMMITTED' ? receipt.kind === 'POLICY' ? 'Policy committed and active. Accompanying display details are pending or need retry.' : 'Display-only save pending; exact access rules are unchanged.'
          : outcome === 'WAITING' ? 'Frozen Vault proposal saved. Active policy unchanged; waiting or explicit confirmation still required.' : 'Frozen submission intent. Check saved authority before retrying; no second policy command will be sent.');
    setProperty(element('check-draft-submission'), 'hidden', !receipt || ['DONE', 'KEPT', 'RESOLVED'].includes(receipt.phase));
    setProperty(element('retry-site-save'), 'hidden', !legacyFailed && !(receipt?.phase === 'APPLYING' || displayFailed));
    const uncorrelated = receipt?.phase === 'PREPARED' && outcome === 'UNKNOWN' && state && !state.vaultState.pendingProposal
      && state.vaultState.nextProposalId > receipt.expectedProposalId;
    setProperty(element('restore-submitted-draft'), 'hidden', receipt?.phase !== 'RESOLVED'); setProperty(element('keep-current-display'), 'hidden', receipt?.phase !== 'APPLYING' && !uncorrelated);
    text('keep-current-display', uncorrelated ? 'Discard uncorrelated local batch' : 'Keep current display details');
    setProperty(element<HTMLButtonElement>('keep-current-display'), 'disabled', submitting || !!session?.unsaved || !!session?.failure || !!session?.conflict);
    setProperty(element<HTMLButtonElement>('retry-site-save'), 'disabled', submitting || displaying !== null || !state || !!session?.failure || !!session?.conflict);
    setProperty(element<HTMLButtonElement>('check-draft-submission'), 'disabled', submitting || !state || !!session?.conflict); renderFrozenReview();
    const receiptList = element('destination-receipt-items'), receiptKey = json(receipt);
    if (receiptList.dataset.receipt !== receiptKey) {
      setProperty(receiptList.dataset, 'receipt', receiptKey);
      receiptList.replaceChildren(...(receipt?.draft.changes ?? []).map(change => {
        const li = document.createElement('li'); setProperty(li, 'textContent', destinationChangeSummary(change, receipt!.draft.baseline.policy, receipt!.candidatePolicy).join('\n')); return li;
      }));
    }
  }
  function refresh(): Promise<void> {
    if (refreshing) return refreshing;
    if (disposed || !session?.loaded || submitting) return Promise.resolve();
    refreshing = session.refresh().then(async () => {
        if (disposed) return;
        restoreEditor(); const receipt = activeReceipt(), current = snapshot();
        if (receipt && current && !session!.unsaved && !session!.failure && !session!.conflict) {
          const outcome = receiptOutcome(receipt, current);
          if (outcome === 'COMMITTED' && receipt.phase === 'PROPOSED') await applyDisplay(false);
          else if (outcome === 'RESOLVED' && receipt.phase === 'PROPOSED') await session!.set({ ...session!.value, receipt: { ...receipt, phase: 'RESOLVED' } });
        }
      }).finally(() => { refreshing = null; });
    return refreshing;
  }
  function render(ready: boolean): void {
    if (disposed) return;
    const controller = options.controller(); if (controller?.status === 'READY' && controller.snapshot) lastController = controller;
    const display = controller?.snapshot ?? lastController?.snapshot;
    const presentationState = hasCommittedCollection(controller) ? controller!.snapshot : null;
    legacyDisplay();
    const all = entries(), words = input('sites-search').value.trim().toLowerCase().split(/\s+/).filter(Boolean), filter = element<HTMLSelectElement>('sites-filter').value;
    const visible = all.filter(entry => (filter === 'ALL' || classification(entry, display!.policy) === filter
      || filter === 'WHITELIST' && entry.hostnames.some(host => evaluate({ hostname: host }, display!.policy).outcome === 'ALLOW')
      || filter === 'BLACKLIST' && entry.hostnames.some(host => evaluate({ hostname: host }, display!.policy).outcome === 'DENY'))
      && words.every(word => `${entry.label} ${entry.category} ${entry.hostnames.join(' ')}`.toLowerCase().includes(word)));
    const phase = collectionPresentation(controller, all.length, options.attempted?.() === true || controller != null, display != null);
    setProperty(element('sites-section').dataset, 'phase', phase.phase); setProperty(element('sites-recovery'), 'hidden', phase.phase !== 'UNAVAILABLE');
    text('sites-status', phase.phase === 'READY' || phase.phase === 'EMPTY' ? `Committed policy · ${all.length} destinations · revision ${display!.policyRevision}` : phase.message);
    setProperty(element('sites-pending'), 'hidden', controller?.snapshot?.vaultState.pendingProposal == null);
    const key = json([visible, display?.policy, session?.value.draft?.changes]);
    if (key !== listKey) {
      listKey = key;
      const list = element('sites-list'), scroll = list.scrollTop ?? 0;
      const focused = document.activeElement as HTMLElement | null, focusId = focused?.dataset.destinationId;
      list.replaceChildren(...visible.map(entry => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'site-row'; setProperty(button.dataset, 'destinationId', destinationId(entry));
        const name = document.createElement('strong'); setProperty(name, 'textContent', entry.label);
        const category = document.createElement('span'); setProperty(category, 'textContent', entry.category); category.className = 'note';
        const badge = document.createElement('span'); setProperty(badge, 'textContent', classification(entry, display!.policy) === 'WHITELIST' ? 'Whitelisted' : classification(entry, display!.policy) === 'BLACKLIST' ? 'Blacklisted' : 'Mixed rules'); badge.className = 'pill';
        if (session?.value.draft?.changes.some(c => c.id === destinationId(entry))) badge.textContent += ' · Draft';
        button.append(name, category, badge); setProperty(button, 'title', entry.hostnames.join(', '));
        button.addEventListener('click', () => { selection = destinationId(entry); detailKey = ''; remember(); options.changed(); queueMicrotask(() => {
          const detail = element('site-detail'); if (detail.hidden || !element('site-draft').hidden) return;
          if (matchMedia('(max-width: 1050px)').matches) detail.scrollIntoView({ block: 'start' }); detail.focus({ preventScroll: true });
        }); }); return button;
      }));
      list.scrollTop = scroll;
      if (focusId) [...list.querySelectorAll<HTMLButtonElement>('.site-row')].find(r => r.dataset.destinationId === focusId)?.focus({ preventScroll: true });
    }
    if (!restoredList && all.length && !element('sites-section').hidden) {
      element('sites-list').scrollTop = position.scroll; restoredList = true;
    }
    setProperty(element('sites-empty'), 'hidden', visible.length !== 0 || phase.phase === 'LOADING' || phase.phase === 'UNAVAILABLE');
    const selected = all.find(entry => destinationId(entry) === selection); setProperty(element('site-detail'), 'hidden', !selected);
    const detail = json([selected, display?.policy, options.pins()]);
    if (selected && detail !== detailKey) {
      detailKey = detail; text('site-detail-title', selected.label); text('site-detail-category', `${selected.category} · ${pinnedDestinations([selected], options.pins()).length ? 'Pinned' : 'Not pinned'}`);
      element('site-detail-hosts').replaceChildren(...selected.hostnames.map(hostname => {
        const row = document.createElement('li'), result = evaluate({ hostname }, display!.policy);
        setProperty(row, 'textContent', `${hostname}${hostname === selected.hostname ? ' · primary' : ''} · ${result.outcome === 'DENY' ? 'Blacklisted' : 'Whitelisted'}${display!.policy.blacklist.includes(hostname) && display!.policy.whitelist.includes(hostname) ? ' (Blacklist overrides Whitelist)' : ''}`); return row;
      }));
    }
    const locked = !ready || submitting || !session?.loaded || !!session?.conflict || !!activeReceipt();
    for (const id of ['add-site', 'edit-site', 'remove-site', 'propose-site', 'save-site-display']) setProperty(element<HTMLButtonElement>(id), 'disabled', locked);
    setProperty(element<HTMLButtonElement>('cancel-site-draft'), 'disabled', submitting || !!activeReceipt());
    const editorLocked = submitting || !!activeReceipt() || !!session?.conflict;
    for (const field of element('site-form').querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))
      if (field.id !== 'site-www' && field.id !== 'site-pin') setProperty(field, 'disabled', editorLocked);
    if (session?.value.draft?.editor) scope(editorLocked);
    for (const row of element('sites-list').querySelectorAll<HTMLButtonElement>('.site-row')) setAttribute(row, 'aria-pressed', String(row.dataset.destinationId === selection));
    const suggestions = categorySuggestions([...all.map(e => e.category), ...preferences.destinations.map(e => e.category)], session?.value.draft?.changes.flatMap(c => c.after ? [c.after.metadata.category] : []) ?? []);
    const categories = element('site-categories'), categoriesKey = json(suggestions);
    if (categories.dataset.categories !== categoriesKey) { setProperty(categories.dataset, 'categories', categoriesKey); categories.replaceChildren(...suggestions.map(label => { const option = document.createElement('option'); setProperty(option, 'value', label); return option; })); }
    renderBatch(presentationState ?? null);
  }
  element('add-site').addEventListener('click', () => begin()); element('edit-site').addEventListener('click', () => begin(selection));
  element('remove-site').addEventListener('click', () => void stageRemoval(selection));
  element('site-form').addEventListener('submit', event => { event.preventDefault(); void stage(); }); element('save-site-display').addEventListener('click', () => void stage(true));
  element('cancel-site-draft').addEventListener('click', () => { if (session?.value.draft && !activeReceipt() && !submitting) {
    void session.setDraft({ ...session.value.draft, editor: null }).then(saved => {
      restoreEditor(); if (saved) { notice('Editor closed. Staged changes preserved.'); queueMicrotask(focusSelection); }
    });
  } });
  for (const id of ['site-name', 'site-hostname', 'site-category', 'site-access', 'site-www', 'site-extra', 'site-pin']) element(id).addEventListener('input', persistEditor);
  element('review-destination-draft').addEventListener('click', () => { reviewOpen = true; options.changed(); notice('Review the complete local batch below. Nothing has been submitted.'); });
  element('submit-destination-draft').addEventListener('click', () => void submit());
  element('discard-destination-draft').addEventListener('click', () => {
    if (!session || activeReceipt() || submitting || !window.confirm('Discard this editable draft and entered values? Saved policy and display details will remain.')) return;
    void session.setDraft(null); reconciliation = null; reviewOpen = false; restoreEditor(); notice('Local draft discarded. Saved policy and display details unchanged.');
  });
  element('retry-destination-draft').addEventListener('click', () => void (async () => {
    if (!session) {
      try { session = new DestinationWorkspaceSession(await openDraftRepository(), options.changed); }
      catch { notice('Draft storage still cannot be opened. No policy command was sent.', 'error'); return; }
    }
    if (!session.loaded) loadFailure = !await session.load(); else await session.retry(); restoreEditor(); options.changed();
  })());
  element('discard-damaged-draft').addEventListener('click', () => void (async () => {
    if (!session || session.loadReason !== 'INVALID' || !window.confirm('Discard damaged local draft and display receipt data? These unsaved cosmetic terms will be lost. Active policy, pending Vault proposals and committed display details will remain.')) return;
    if (!await session.repository.discardInvalid?.()) { notice('Draft recovery did not discard data. Retry loading; a newer valid draft may have been saved elsewhere.', 'error'); return; }
    loadFailure = !await session.load(); restoreEditor(); notice('Damaged local draft data discarded. Active policy and saved display details are unchanged.');
  })());
  element('reload-shared-draft').addEventListener('click', () => void (async () => {
    if (!session || !window.confirm('Load the newer shared draft? Unsaved local edits in this window will be discarded.')) return;
    await session.idle(); await session.load(); reconciliation = null; restoreEditor(); notice('Newer saved draft loaded. Review it before submission.');
  })());
  element('reconcile-destination-draft').addEventListener('click', () => { void (async () => {
    const draft = session?.value.draft, state = await verifiedSnapshot();
    if (!state || !draft || session?.value.draft !== draft) { notice('Saved state or the draft changed while checking. Review the current draft before reconciling.', 'error'); return; }
    reconciliation = reconcileDraft(draft, baseline(state)); options.changed();
    notice('Reconciliation preview only. Review current committed values and proposed results, then explicitly accept; no authority changed.');
  })(); });
  element('accept-draft-reconciliation').addEventListener('click', () => void (async () => {
    const reviewed = reconciliation, state = await verifiedSnapshot();
    if (!state || !session || !reviewed || reviewed !== reconciliation) return; const preview = reviewed.draft;
    if (assessDraft(preview, baseline(state)).stale.length || assessDraft(preview, baseline(state)).conflicts.length || preview.editor) { notice('Preview is stale or conflicting. Close the editor, resolve conflicts and review reconciliation again.', 'error'); return; }
    if (await session.setDraft(preview)) { reconciliation = null; reviewOpen = true; notice('Reviewed reconciliation saved against current state. Submission still needs ordinary Vault waiting and confirmation.'); }
  })());
  element('retry-site-save').addEventListener('click', () => void (async () => { if (legacyFailed) { legacyFailed = false; legacyDisplay(); } else await applyDisplay(true); options.changed(); })());
  element('check-draft-submission').addEventListener('click', () => void checkSubmission());
  element('restore-submitted-draft').addEventListener('click', () => {
    const receipt = session?.value.receipt; if (!session || receipt?.phase !== 'RESOLVED' || session.value.draft) { notice('Finish the current draft before restoring a resolved batch.'); return; }
    void session.setDraft(receipt.draft); notice('Resolved batch restored as editable work. Review stale baselines; a revised proposal requires a full new wait.');
  });
  element('keep-current-display').addEventListener('click', () => void keepCurrentDisplay());
  element('sites-review-pending').addEventListener('click', options.vault);
  for (const id of ['sites-search', 'sites-filter']) element(id).addEventListener('input', () => { render(options.canEdit()); remember(); });
  element('sites-list').addEventListener('scroll', remember, { passive: true });
  window.addEventListener('storage', event => {
    if (event.key !== destinationPreferencesKey && event.key !== null) return;
    const before = json([preferences, preferencesAvailable]); preferences = readPreferences();
    if (before !== json([preferences, preferencesAvailable])) options.changed();
  });
  window.addEventListener('pagehide', () => { disposed = true; });
  return { render, refresh, metadata: () => preferences.destinations, initialized, idle: async () => { await initialized; await refreshing; await displaying; await session?.idle(); }, session: () => session, renderFrozenReview, navigation, focusSelection };
}
