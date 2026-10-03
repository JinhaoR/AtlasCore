const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const reservedEndings = [
    'localhost', 'local', 'localdomain', 'internal', 'lan', 'home', 'corp',
    'test', 'invalid', 'example', 'onion', 'alt', 'home.arpa',
    'example.com', 'example.net', 'example.org',
];
function publicHostname(hostname) {
    const labels = hostname.split('.');
    return hostname.length <= 253 && labels.length >= 2
        && labels.every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
        && /[a-z]/.test(labels.at(-1) ?? '')
        && !reservedEndings.some(ending => hostname === ending || hostname.endsWith(`.${ending}`));
}
/** Discovery contacts only a public HTTPS homepage, without supplied URL contents. */
function publicRoot(origin) {
    try {
        const root = new URL(origin);
        if (root.protocol !== 'https:' || root.port !== '' || root.username !== '' || root.password !== ''
            || root.pathname !== '/' || root.search !== '' || root.hash !== '' || !publicHostname(root.hostname)
            || (origin !== root.origin && origin !== `${root.origin}/`))
            return null;
        return root;
    }
    catch {
        return null;
    }
}
/** Site scope is hostname-based; inspect its HTTPS homepage even for an HTTP entry. */
export function canonicalDiscoveryOrigin(requestedOrigin) {
    try {
        const root = new URL(requestedOrigin);
        if (!['http:', 'https:'].includes(root.protocol) || root.port !== ''
            || (requestedOrigin !== root.origin && requestedOrigin !== `${root.origin}/`))
            return null;
        root.protocol = 'https:';
        return publicRoot(root.href)?.origin ?? null;
    }
    catch {
        return null;
    }
}
/** Sanitize a transient Location header into only the exact observed www partner. */
export function canonicalEntryCounterpart(origin, location) {
    const root = publicRoot(origin);
    if (root === null || typeof location !== 'string' || location.trim() === '')
        return null;
    try {
        const target = new URL(location, root);
        const partner = root.hostname.startsWith('www.') ? root.hostname.slice(4) : `www.${root.hostname}`;
        if (target.protocol !== root.protocol || target.port !== root.port
            || target.username !== '' || target.password !== '' || target.hostname !== partner
            || !publicHostname(target.hostname))
            return null;
        return target.hostname;
    }
    catch {
        return null;
    }
}
/**
 * Firefox exposes redirect headers to webRequest even when manual fetch returns
 * an opaque redirect. Observe only this extension's correlated HEAD request;
 * never follow the Location or retain URLs, headers, or response bodies. Both
 * standard HTTP and HTTPS entries inspect the same HTTPS hostname homepage.
 */
export function createCanonicalEntryDiscovery(api, request = fetch, timeoutMs = 3000) {
    const inFlight = new Map();
    function probe(root) {
        return new Promise(resolve => {
            const abort = new AbortController();
            let finished = false;
            let requestId = null;
            let timer;
            let extension;
            try {
                extension = new URL(api.runtime.getURL(''));
            }
            catch {
                resolve(null);
                return;
            }
            const ownRequest = (details) => {
                const sources = [details.originUrl, details.documentUrl].filter((source) => source !== undefined);
                return details.tabId === -1 && details.type === 'xmlhttprequest' && details.method === 'HEAD'
                    && details.url === root.href && sources.length > 0 && sources.every(source => {
                    try {
                        const initiator = new URL(source);
                        return initiator.protocol === 'moz-extension:' && initiator.host === extension.host
                            && initiator.username === '' && initiator.password === '';
                    }
                    catch {
                        return false;
                    }
                });
            };
            const finish = (hostname) => {
                if (finished)
                    return;
                finished = true;
                if (timer !== undefined)
                    clearTimeout(timer);
                // A failed observer removal must not prevent the other cleanup or abort.
                try {
                    api.webRequest.onBeforeRequest.removeListener(before);
                }
                catch { /* no authority */ }
                try {
                    api.webRequest.onHeadersReceived.removeListener(headers);
                }
                catch { /* no authority */ }
                abort.abort();
                resolve(hostname);
            };
            const before = (details) => {
                if (!finished && requestId === null && ownRequest(details))
                    requestId = details.requestId;
            };
            const headers = (details) => {
                if (finished || requestId === null || details.requestId !== requestId || !ownRequest(details))
                    return;
                const locations = details.responseHeaders?.filter(header => header.name.toLowerCase() === 'location') ?? [];
                finish(redirectStatuses.has(details.statusCode) && locations.length === 1 && locations[0]?.value !== undefined
                    ? canonicalEntryCounterpart(root.origin, locations[0].value) : null);
            };
            try {
                const filter = { urls: [root.href], types: ['xmlhttprequest'] };
                api.webRequest.onBeforeRequest.addListener(before, filter);
                api.webRequest.onHeadersReceived.addListener(headers, filter, ['responseHeaders']);
                timer = setTimeout(() => finish(null), timeoutMs);
                // Headers may arrive after fetch resolves in Firefox. Keep observing until
                // that matched response or the overall deadline, without reading its body.
                void request(root.href, {
                    method: 'HEAD', credentials: 'omit', redirect: 'manual', cache: 'no-store',
                    referrerPolicy: 'no-referrer', signal: abort.signal,
                }).catch(() => finish(null));
            }
            catch {
                finish(null);
            }
        });
    }
    return origin => {
        const discoveryOrigin = canonicalDiscoveryOrigin(origin);
        const root = discoveryOrigin === null ? null : publicRoot(discoveryOrigin);
        if (root === null || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
            return Promise.resolve(null);
        }
        const existing = inFlight.get(root.href);
        if (existing !== undefined)
            return existing;
        const pending = probe(root);
        inFlight.set(root.href, pending);
        void pending.then(() => { if (inFlight.get(root.href) === pending)
            inFlight.delete(root.href); });
        return pending;
    };
}
