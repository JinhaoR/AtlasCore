/** Shared by requests and policy entries; unsupported forms return null. */
export function normalizeHostname(input) {
    if (typeof input !== "string")
        return null;
    const value = input.trim();
    // Validate before case folding: some Unicode letters lowercase to ASCII.
    if (!/^[a-z0-9.-]+$/i.test(value))
        return null;
    const hostname = value.toLowerCase().replace(/\.$/, "");
    if (hostname.length === 0 || hostname.length > 253)
        return null;
    const labels = hostname.split(".");
    if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
        return null;
    }
    // IP addresses and URL-parser IP shorthand are outside the initial contract.
    if (/^[0-9.]+$/.test(hostname))
        return null;
    try {
        if (new URL(`https://${hostname}`).hostname !== hostname)
            return null;
    }
    catch {
        return null;
    }
    return hostname;
}
/** Accept a bare hostname, an HTTP(S) URL, or a SiteTarget data object. */
export function normalizeTarget(input) {
    let hostname;
    if (typeof input === "string") {
        const value = input.trim();
        if (/^https?:\/\//i.test(value)) {
            // Keep the supported authority syntax small; never accept userinfo.
            const authority = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1];
            if (authority === undefined ||
                !/^[a-z0-9.-]+(?::[0-9]+)?$/i.test(authority) ||
                /[\u0000-\u0020\u007f\\]/.test(value)) {
                return null;
            }
            try {
                hostname = normalizeHostname(new URL(value).hostname);
            }
            catch {
                return null;
            }
        }
        else {
            hostname = normalizeHostname(value);
        }
    }
    else if (input !== null &&
        typeof input === "object" &&
        !Array.isArray(input) &&
        Object.keys(input).length === 1 &&
        Object.hasOwn(input, "hostname") &&
        "hostname" in input) {
        hostname = normalizeHostname(input.hostname);
    }
    else {
        return null;
    }
    return hostname === null ? null : { hostname };
}
