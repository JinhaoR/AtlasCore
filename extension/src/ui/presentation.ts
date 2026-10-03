import type {
  AccessGrant, AccessState, AtlasControllerView, AtlasNavigationDecision, JourneyEndReason,
  PendingAccessRequest,
} from '@atlas/core';

/** Explain saved termination; this copy never changes the authorization decision. */
export function journeyEndCopy(reason: JourneyEndReason | null): string {
  switch (reason) {
    case 'UNRELATED_NAVIGATION': return 'The next navigation could not be linked to your active Journey.';
    case 'EXPIRED': return 'Your Journey reached its fixed time limit.';
    case 'HOP_LIMIT': return 'Your Journey reached its navigation limit.';
    case 'CANCELLED': return 'You ended this Journey.';
    case 'POLICY_CHANGED': case 'INVALID_POLICY': case 'ROOT_NOT_WHITELISTED': return 'The policy changed or could no longer authorize this Journey.';
    case 'CONTEXT_CLOSED': return 'The browsing context closed.';
    case 'REACHED': case 'RETURNED': return 'You reached your destination.';
    case 'DESTINATION_CHANGED': return 'You reached another Whitelisted destination.';
    default: return 'Your Journey ended.';
  }
}

/** UI can queue an intent during housekeeping; only a fresh controller result authorizes effects. */
export function canQueueOperation(view: AtlasControllerView | null | undefined): boolean {
  return view?.status === 'READY' || view?.snapshot != null
    && (view.status === 'LOADING' || view.status === 'COMMITTING');
}

/** Presentation of a Core result, never a substitute for obtaining a fresh result. */
export function accessCopy(decision: AtlasNavigationDecision | null): { title: string; description: string; tone: string } {
  if (decision === null) return { title: 'Choose a tab', description: 'Select a website to see its access status.', tone: 'neutral' };
  switch (decision.outcome) {
    case 'GREYLIST': return { title: 'Take a moment before continuing', description: 'This site is outside your Pure Whitelist. Start a request, then return to confirm temporary access.', tone: 'wait' };
    case 'WAIT': return { title: 'Your waiting period is running', description: 'You can leave this page and come back. When the wait ends, you still need to confirm.', tone: 'wait' };
    case 'REQUIRE_CONFIRMATION': return { title: 'Ready when you are', description: 'Confirm to open the site home with temporary access. Your policy stays the same.', tone: 'ready' };
    case 'DENY': return { title: decision.reason === 'BLACKLISTED' || decision.reason === 'MANAGED_BLACKLISTED' ? 'This site is blocked' : 'Access is unavailable', description: decision.reason === 'BLACKLISTED' ? 'Your Blacklist prevents access to this destination.' : decision.reason === 'MANAGED_BLACKLISTED' ? 'The managed StevenBlack list blocks this destination. Temporary access and Journey cannot override it.' : 'Atlas could not authorize this navigation. Check the decision details below.', tone: 'blocked' };
    case 'ALLOW': return { title: 'You can continue', description: decision.reason === 'WHITELISTED' ? 'This destination is in your Pure Whitelist.' : decision.reason === 'ACTIVE_JOURNEY' ? 'This navigation is covered by your current Journey. Its original deadline still applies.' : 'Temporary access is active. This site remains Greylist.', tone: 'ready' };
  }
}

export function countdown(deadline: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function selectedContext<T extends { tabId: number }>(contexts: readonly T[], selected: string): T | undefined {
  // A missing selected tab is missing. Never silently act on a different one.
  return contexts.find((context) => String(context.tabId) === selected);
}

/** Display only the record named by the current decision; Core owns validity and time. */
export function selectedAccessRecord(
  decision: AtlasNavigationDecision | null | undefined,
  state: AccessState | null | undefined,
  hostname: string | null | undefined,
): { pending: PendingAccessRequest | undefined; grant: AccessGrant | undefined } {
  let pending: PendingAccessRequest | undefined;
  let grant: AccessGrant | undefined;
  if (state != null && hostname != null && decision != null) {
    if ((decision.outcome === 'WAIT' || decision.outcome === 'REQUIRE_CONFIRMATION')
      && decision.target.hostname === hostname) {
      pending = state.pendingRequests.find((request) => request.id === decision.requestId
        && (request.scopeHostnames ?? [request.hostname]).includes(hostname));
    } else if (decision.outcome === 'ALLOW' && decision.reason === 'ACTIVE_GRANT'
      && decision.target.hostname === hostname) {
      grant = state.grants.find((entry) => entry.requestId === decision.requestId
        && (entry.scopeHostnames ?? [entry.hostname]).includes(hostname));
    }
  }
  return { pending, grant };
}
