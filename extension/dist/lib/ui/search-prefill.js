import { normalizeTarget } from '@atlas/core';
/** Search is an editable suggestion, never a policy decision or guessed domain. */
export function siteSearchPrefill(query) {
    const name = query.trim().slice(0, 100);
    const target = /^(https?:\/\/|[^\s/]+\.[^\s/]+)/i.test(query.trim()) ? normalizeTarget(query.trim()) : null;
    return { name, hostname: target?.hostname ?? '' };
}
