import { planAtlasOperation, type AtlasControllerView, type ManagedBlacklist } from '@atlas/core';

export interface TemporaryAccess {
  readonly requestId: number;
  readonly hostnames: readonly string[];
  readonly expiresAt: number;
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
