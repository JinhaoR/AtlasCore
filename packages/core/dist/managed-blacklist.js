import { normalizeHostname } from "./target.js";
const contents = new WeakMap();
export function compileManagedBlacklist(input) {
    if (!Array.isArray(input))
        return null;
    const domains = new Set();
    for (const entry of input) {
        const hostname = normalizeHostname(entry);
        if (hostname === null)
            return null;
        domains.add(hostname);
    }
    const compiled = Object.freeze({ size: domains.size });
    contents.set(compiled, domains);
    return compiled;
}
export function isManagedBlacklist(input) {
    return input !== null && typeof input === "object" && contents.has(input);
}
/** Callers normalize a single target. Invalid compiled authority is never an empty list. */
export function managedBlacklistContains(input, hostname) {
    return isManagedBlacklist(input) ? contents.get(input).has(hostname) : null;
}
