import type { AtlasControllerView, PolicyReview } from '@atlas/core';
import { timingFields } from './settings-model.js';

/** A policy-only proposal also freezes settings; their presence is not a change. */
export function hasSettingsChange(controller: AtlasControllerView | null | undefined): boolean {
  const state = controller?.snapshot, candidate = state?.vaultState.pendingProposal?.candidateConfiguration;
  return !!state && !!candidate && timingFields.some(field => field.value(candidate) !== field.value(state.configuration));
}

/** Display only. Round long waits up; Core still owns readiness and confirmation. */
export function vaultWait(deadline: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  if (seconds < 60) return `${seconds}s left`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return `${hours}h${rest ? ` ${rest}m` : ''} left`;
}

/** Frozen review is display data, never permission to commit. Every confirm still calls Core. */
export function matchingReview(controller: AtlasControllerView | null | undefined, review: PolicyReview | null): PolicyReview | null {
  const state = controller?.snapshot, proposal = state?.vaultState.pendingProposal;
  if (!state || !proposal || !review || !['READY', 'COMMITTING', 'LOADING'].includes(controller!.status)) return null;
  return review.proposalId === proposal.id && review.basePolicyRevision === state.policyRevision
    && review.baseConfigurationRevision === state.configurationRevision
    && review.createdAt === proposal.createdAt && review.readyAt === proposal.readyAt && review.confirmBy === proposal.confirmBy
    && JSON.stringify(review.candidatePolicy) === JSON.stringify(proposal.candidatePolicy)
    && JSON.stringify(review.candidateConfiguration) === JSON.stringify(proposal.candidateConfiguration) ? review : null;
}

/** Ask Core for a new phase at its deadline. UI time only requests a read; it cannot confirm. */
export function needsPolicyReview(controller: AtlasControllerView | null | undefined, review: PolicyReview | null, now: number): boolean {
  if (controller?.status !== 'READY' || !controller.snapshot?.vaultState.pendingProposal) return false;
  const matched = matchingReview(controller, review);
  return !matched || matched.phase === 'WAITING' && now >= matched.readyAt || matched.phase === 'READY' && now >= matched.confirmBy;
}
