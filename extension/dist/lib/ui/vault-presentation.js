/** Frozen review is display data, never permission to commit. Every confirm still calls Core. */
export function matchingReview(controller, review) {
    const state = controller?.snapshot, proposal = state?.vaultState.pendingProposal;
    if (!state || !proposal || !review || !['READY', 'COMMITTING', 'LOADING'].includes(controller.status))
        return null;
    return review.proposalId === proposal.id && review.basePolicyRevision === state.policyRevision
        && review.baseConfigurationRevision === state.configurationRevision
        && review.createdAt === proposal.createdAt && review.readyAt === proposal.readyAt && review.confirmBy === proposal.confirmBy
        && JSON.stringify(review.candidatePolicy) === JSON.stringify(proposal.candidatePolicy)
        && JSON.stringify(review.candidateConfiguration) === JSON.stringify(proposal.candidateConfiguration) ? review : null;
}
/** Ask Core for a new phase at its deadline. UI time only requests a read; it cannot confirm. */
export function needsPolicyReview(controller, review, now) {
    if (controller?.status !== 'READY' || !controller.snapshot?.vaultState.pendingProposal)
        return false;
    const matched = matchingReview(controller, review);
    return !matched || matched.phase === 'WAITING' && now >= matched.readyAt || matched.phase === 'READY' && now >= matched.confirmBy;
}
