import type { AtlasNavigationDecision } from '@atlas/core';

/** Presentation of a Core result, never a substitute for obtaining a fresh result. */
export function accessCopy(decision: AtlasNavigationDecision | null): { title: string; description: string; tone: string } {
  if (decision === null) return { title: 'Choose a tab', description: 'Select a website to see its access status.', tone: 'neutral' };
  switch (decision.outcome) {
    case 'GREYLIST': return { title: 'Take a moment before continuing', description: 'This site is outside your Pure Whitelist. Start a request, then return to confirm temporary access.', tone: 'wait' };
    case 'WAIT': return { title: 'Your waiting period is running', description: 'You can leave this page and come back. When the wait ends, you still need to confirm.', tone: 'wait' };
    case 'REQUIRE_CONFIRMATION': return { title: 'Ready when you are', description: 'Confirm to open the site home with temporary access. Your policy stays the same.', tone: 'ready' };
    case 'DENY': return { title: decision.reason === 'BLACKLISTED' ? 'This site is blocked' : 'Access is unavailable', description: decision.reason === 'BLACKLISTED' ? 'Your Blacklist prevents access to this destination.' : 'Atlas could not authorize this navigation. Check the decision details below.', tone: 'blocked' };
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
