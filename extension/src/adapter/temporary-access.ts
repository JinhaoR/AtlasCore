import { planAtlasOperation, type AtlasControllerView, type ManagedBlacklist } from '@atlas/core';

export interface TemporaryAccess {
  readonly requestId: number;
  readonly hostnames: readonly string[];
  readonly expiresAt: number;
}

export interface PendingTemporaryAccess {
  readonly requestId: number;
  readonly hostnames: readonly string[];
  readonly readyAt: number;
  readonly confirmBy: number;
  readonly outcome: 'WAIT' | 'REQUIRE_CONFIRMATION';
}

/** One read-only summary. Omitting expired history cannot create permission;
 * every displayed record still needs a current Core assessment. No cached ALLOWs. */
export function accessOverview(view: AtlasControllerView | null, now: number,
  managedBlacklist?: ManagedBlacklist): {
    temporaryAccess: readonly TemporaryAccess[] | null;
    pendingAccess: readonly PendingTemporaryAccess[] | null;
  } {
  const unavailable = { temporaryAccess: null, pendingAccess: null };
  if (view?.snapshot == null || !['READY', 'LOADING', 'COMMITTING'].includes(view.status)) return unavailable;
  const snapshot = view.snapshot, input = { snapshot, now, configuration: snapshot.configuration,
    ...(managedBlacklist === undefined ? {} : { managedBlacklist }) };
  // Validate the complete snapshot, including historical records, before filtering.
  // Keep rollback/invalid-state handling even when no access records are live.
  if (planAtlasOperation({ kind: 'OBSERVE_TIME' }, input).result.type !== 'OBSERVED') return unavailable;
  const pendingAccess = snapshot.accessState.pendingRequests.flatMap(request => {
    if (now >= request.confirmBy || request.policyRevision !== snapshot.policyRevision) return [];
    const hostnames = request.scopeHostnames ?? [request.hostname];
    const { result } = planAtlasOperation({ kind: 'CHECK_NAVIGATION', target: { hostname: request.hostname },
      context: { contextId: 'pending-access-display', journeyId: null } }, input);
    return result.type === 'ASSESSMENT' && (result.decision.outcome === 'WAIT' || result.decision.outcome === 'REQUIRE_CONFIRMATION')
      && result.decision.requestId === request.id ? [{ requestId: request.id, hostnames: [...hostnames],
        readyAt: request.readyAt, confirmBy: request.confirmBy, outcome: result.decision.outcome }] : [];
  }).sort((a, b) => a.readyAt - b.readyAt || a.requestId - b.requestId);
  const grants: TemporaryAccess[] = [];
  for (const grant of snapshot.accessState.grants) {
    if (now >= grant.expiresAt || grant.policyRevision !== snapshot.policyRevision) continue;
    const hostnames = (grant.scopeHostnames ?? [grant.hostname]).filter((hostname) => {
      const { result } = planAtlasOperation({ kind: 'CHECK_NAVIGATION', target: { hostname },
        context: { contextId: 'temporary-access-display', journeyId: null } }, input);
      return result.type === 'ASSESSMENT' && result.decision.outcome === 'ALLOW'
        && result.decision.reason === 'ACTIVE_GRANT' && result.decision.requestId === grant.requestId;
    });
    if (hostnames.length > 0) grants.push({ requestId: grant.requestId, hostnames, expiresAt: grant.expiresAt });
  }
  return { pendingAccess, temporaryAccess: grants.sort((a, b) => a.expiresAt - b.expiresAt || a.requestId - b.requestId) };
}
