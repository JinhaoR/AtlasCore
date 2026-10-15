export function accessLink(view, requestId, hostnames) {
    const context = view.contexts.find(c => c.hostname !== null && hostnames.includes(c.hostname)
        && c.latest?.type === 'ASSESSMENT' && 'requestId' in c.latest.decision && c.latest.decision.requestId === requestId);
    return context ? { kind: 'CONTEXT', tabId: context.tabId, contextId: context.contextId }
        : { kind: 'OPEN_DESTINATION', url: `https://${hostnames[0]}/` };
}
export function homeAccessSummary(view, now) {
    const available = view != null && view.controller != null && ['READY', 'LOADING', 'COMMITTING'].includes(view.controller.status)
        && view.temporaryAccess != null && view.pendingAccess != null;
    return {
        available,
        pending: available ? view.pendingAccess.filter(p => p.confirmBy > now).map(p => ({ ...p,
            // Countdown readiness is display only; the existing workflow asks Core again.
            outcome: now < p.readyAt ? 'WAIT' : 'REQUIRE_CONFIRMATION', link: accessLink(view, p.requestId, p.hostnames) })) : [],
        grants: available ? view.temporaryAccess.filter(g => g.expiresAt > now).map(g => ({ ...g, link: accessLink(view, g.requestId, g.hostnames) })) : [],
        journeys: available ? view.contexts.flatMap(context => context.journey && context.journey.phase !== 'ENDED' && context.journey.expiresAt > now
            ? [{ tabId: context.tabId, contextId: context.contextId, journey: context.journey }] : []) : [],
    };
}
