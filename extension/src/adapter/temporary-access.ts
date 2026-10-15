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

/** Current pending terms, assessed by Core, without confirming or committing them. */
export function pendingAccessView(view: AtlasControllerView | null, now: number,
  managedBlacklist?: ManagedBlacklist): readonly PendingTemporaryAccess[] | null {
  if (view?.snapshot == null || !['READY', 'LOADING', 'COMMITTING'].includes(view.status)) return null;
  const snapshot = view.snapshot, input = { snapshot, now, configuration: snapshot.configuration,
    ...(managedBlacklist === undefined ? {} : { managedBlacklist }) };
  if (planAtlasOperation({ kind: 'OBSERVE_TIME' }, input).result.type !== 'OBSERVED') return null;
  return snapshot.accessState.pendingRequests.flatMap(request => {
    const hostnames = request.scopeHostnames ?? [request.hostname];
    const { result } = planAtlasOperation({ kind: 'CHECK_NAVIGATION', target: { hostname: request.hostname },
      context: { contextId: 'pending-access-display', journeyId: null } }, input);
    return result.type === 'ASSESSMENT' && (result.decision.outcome === 'WAIT' || result.decision.outcome === 'REQUIRE_CONFIRMATION')
      && result.decision.requestId === request.id ? [{ requestId: request.id, hostnames: [...hostnames],
        readyAt: request.readyAt, confirmBy: request.confirmBy, outcome: result.decision.outcome }] : [];
  }).sort((a, b) => a.readyAt - b.readyAt || a.requestId - b.requestId);
}

/** Read-only display projection of saved grants. A plan never authorizes browser effects. */
export function temporaryAccessView(
  view: AtlasControllerView | null, now: number, managedBlacklist?: ManagedBlacklist,
): readonly TemporaryAccess[] | null {
  if (view === null || view.snapshot === null || !['READY', 'LOADING', 'COMMITTING'].includes(view.status)) return null;
  const snapshot = view.snapshot;
  const input = { snapshot, now, configuration: snapshot.configuration,
    ...(managedBlacklist === undefined ? {} : { managedBlacklist }) };
  if (planAtlasOperation({ kind: 'OBSERVE_TIME' }, input).result.type !== 'OBSERVED') return null;
  const grants: TemporaryAccess[] = [];
  for (const grant of snapshot.accessState.grants) {
    const hostnames = (grant.scopeHostnames ?? [grant.hostname]).filter((hostname) => {
      const { result } = planAtlasOperation({ kind: 'CHECK_NAVIGATION', target: { hostname },
        context: { contextId: 'temporary-access-display', journeyId: null } }, input);
      return result.type === 'ASSESSMENT' && result.decision.outcome === 'ALLOW'
        && result.decision.reason === 'ACTIVE_GRANT' && result.decision.requestId === grant.requestId;
    });
    if (hostnames.length > 0) grants.push({ requestId: grant.requestId, hostnames, expiresAt: grant.expiresAt });
  }
  return grants.sort((a, b) => a.expiresAt - b.expiresAt || a.requestId - b.requestId);
}
