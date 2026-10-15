import type { AtlasControllerResponse } from '@atlas/core';

export type FeedbackTone = 'status' | 'success' | 'error' | 'uncertain';
export interface ActionFeedback { readonly message: string; readonly tone: FeedbackTone; readonly detail?: string }
interface ActionResponse {
  readonly result?: AtlasControllerResponse; readonly error?: string;
  readonly opened?: boolean; readonly initialized?: boolean;
  readonly view?: { readonly controller?: { readonly status: string } | null };
}

/** Copy describes acknowledged operations, never grants permission or retries commands. */
export function actionFeedback(kind: string, response: ActionResponse | undefined): ActionFeedback {
  if (!response) return { tone: 'uncertain', message: 'Atlas could not establish the outcome. Check Policy & recovery before repeating this action.' };
  const reason = response.error ?? (response.result?.type === 'BLOCKED' || response.result?.type === 'REJECTED' ? response.result.reason : undefined);
  if (reason) {
    if (reason === 'COMMIT_UNKNOWN') return { tone: 'uncertain', message: 'Atlas could not verify whether the change was saved. Recover saved state before trying again.', detail: reason };
    const known: Record<string, string> = {
      CONTENT_REMOVAL_IN_PROGRESS: 'Atlas is closing the previous page. Restart will be available in a moment.',
      POLICY_DRAFT_STALE: 'Policy changed while this draft was open. Your draft is preserved; review the current policy before proposing it again.',
      PROPOSAL_PENDING: 'A saved proposal is already waiting in Vault. Review or cancel it before proposing another change.',
      NO_POLICY_CHANGE: 'These terms already match active policy and settings. No proposal was created.',
      PROPOSAL_EXPIRED: 'The Vault confirmation window ended. Active policy is unchanged; cancel the expired proposal before preparing a new one.',
      REQUEST_EXPIRED: 'The access confirmation window ended. No grant was created; start a new request if needed.',
      PROPOSAL_NOT_FOUND: 'That proposal is no longer pending. Review the current Vault state before trying again.',
      ALREADY_COMMITTED: 'That proposal has already been committed. Check the current policy; do not confirm it again.',
      POLICY_CHANGED: 'Policy changed since these terms were prepared. Review the current policy before starting a new request.',
      CONFIGURATION_CHANGED: 'Settings changed since this proposal was prepared. Active settings were preserved; review them before proposing again.',
      INVALID_CANDIDATE_POLICY: 'The proposed policy is invalid. Check the exact hostnames; active policy has not changed.',
      NOT_READY: 'Confirmation is not available yet. Keep the current request and wait for its confirmation window.',
      EXPIRED: 'The confirmation window ended. No new permission was created; start a new request if needed.',
      WRITE_FAILED: 'Atlas could not save this action. The requested change was not committed. Your draft is preserved; try again when storage is available.',
      STORAGE_CONFLICT: 'Saved state changed during this action. Reload and reconcile state before trying again.',
      STORAGE_UNAVAILABLE: 'Atlas could not open saved state. Use Policy & recovery to retry; no new access has been confirmed.',
      INVALID_POLICY: 'The proposed policy is invalid. Check the exact hostnames; active policy has not changed.',
    };
    return { tone: reason === 'CONTENT_REMOVAL_IN_PROGRESS' || reason === 'NO_POLICY_CHANGE' ? 'status' : 'error', message: known[reason]
      ?? 'Atlas could not complete this action. Review the current state and Policy & recovery before trying again.', detail: reason };
  }
  if (response.initialized === false) return { tone: 'error', message: 'Initial policy was not saved. Check the hostnames; an existing policy cannot be replaced here.' };
  if (response.opened === false) return { tone: 'error', message: 'The tab changed before opening. Check the selected tab before continuing.' };
  if (response.result?.type === 'COMMITTED') {
    if (['PROPOSE_POLICY', 'PROPOSE_SETTINGS', 'PROPOSE_CURATED_DEFAULTS'].includes(kind))
      return { tone: 'success', message: 'Vault proposal saved. Active policy and settings are unchanged. Wait, review, then explicitly confirm.' };
    if (kind === 'CONFIRM_POLICY') return { tone: 'success', message: 'Vault change committed. Your confirmed policy and settings are now active.' };
    if (kind === 'CANCEL_POLICY') return { tone: 'success', message: 'Vault proposal cancelled. Active policy and settings are unchanged.' };
    if (kind === 'START_ACCESS') return { tone: 'success', message: 'Access request saved. Wait, then return to confirm temporary access.' };
    if (kind === 'CONFIRM_ACCESS') return { tone: 'success', message: 'Temporary access confirmed and saved. Its original expiry applies.' };
    if (kind === 'CANCEL_ACCESS') return { tone: 'success', message: 'Access request cancelled.' };
  }
  if (kind === 'RECOVER') return response.view?.controller?.status === 'READY'
    ? { tone: 'success', message: 'Saved state verified. Recovery has not confirmed any proposal or reset your policy.' }
    : { tone: 'error', message: 'Saved state is still unavailable. Your policy has not been reset. Check the recovery details.' };
  return { tone: 'status', message: '' };
}

export function renderFeedback(node: HTMLElement, feedback: ActionFeedback): void {
  // Polling identical state must not repeatedly mutate a live region.
  if (node.dataset.tone !== feedback.tone) node.dataset.tone = feedback.tone;
  const role = feedback.tone === 'error' || feedback.tone === 'uncertain' ? 'alert' : 'status';
  if (node.getAttribute('role') !== role) node.setAttribute('role', role);
  if (node.getAttribute('aria-atomic') !== 'true') node.setAttribute('aria-atomic', 'true');
  if (node.textContent !== feedback.message) node.textContent = feedback.message;
  if (node.hidden !== (feedback.message === '')) node.hidden = feedback.message === '';
}
