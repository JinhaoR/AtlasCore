/** Shared by requests and policy entries; unsupported forms return null. */
export function normalizeHostname(input) {
    if (typeof input !== "string")
        return null;
    const value = input.trim();
    const length = value.length - (value.endsWith(".") ? 1 : 0);
    if (length === 0 || length > 253)
        return null;
    // Keep stored-host validation bounded and independent of the regexp engine.
    // Check ASCII before case folding: some Unicode letters lowercase to ASCII.
    let labelLength = 0, numeric = true;
    for (let i = 0; i < length; i++) {
        const code = value.charCodeAt(i);
        if (code === 46) {
            if (labelLength === 0 || value[i - 1] === "-")
                return null;
            labelLength = 0;
            continue;
        }
        const digit = code >= 48 && code <= 57;
        const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
        if (!digit && !letter && code !== 45)
            return null;
        if (code === 45 && labelLength === 0)
            return null;
        if (++labelLength > 63)
            return null;
        if (!digit)
            numeric = false;
    }
    // IP addresses and URL-parser IP shorthand are outside the initial contract.
    if (labelLength === 0 || value[length - 1] === "-" || numeric)
        return null;
    const hostname = value.slice(0, length).toLowerCase();
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
