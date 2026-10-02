/** Website display metadata only. No icon request is a navigation or authorization. */
const maxBytes = 1024 * 1024;
function publicImageUrl(value, base) {
    try {
        const url = new URL(value, base);
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    }
    catch {
        return null;
    }
}
/** Read just link metadata, never insert website markup into Atlas's document. */
export function declaredIconUrls(html, base) {
    const icons = [];
    const head = html.split(/<\/head\s*>/i)[0];
    for (const tag of head.matchAll(/<link\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
        const attributes = new Map();
        for (const attribute of tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g))
            attributes.set(attribute[1].toLowerCase(), (attribute[2] ?? attribute[3] ?? attribute[4] ?? '').replaceAll('&amp;', '&'));
        if (!attributes.get('rel')?.toLowerCase().split(/\s+/).some((rel) => ['icon', 'apple-touch-icon'].includes(rel)))
            continue;
        const href = attributes.get('href');
        const url = href ? publicImageUrl(href, base) : null;
        if (url === null)
            continue;
        const size = Number.parseInt(attributes.get('sizes') ?? '', 10);
        icons.push({ url, size: Number.isFinite(size) ? Math.min(size, 256) : 48 });
    }
    return [...new Set(icons.sort((a, b) => b.size - a.size).map((icon) => icon.url))];
}
async function limitedBytes(response) {
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > maxBytes || !response.body)
        return null;
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done)
                break;
            length += next.value.length;
            if (length > maxBytes) {
                await reader.cancel();
                return null;
            }
            chunks.push(next.value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    return bytes;
}
function imageType(bytes) {
    const prefix = [...bytes.slice(0, 12)].map((byte) => String.fromCharCode(byte)).join('');
    if (prefix.startsWith('\x89PNG\r\n\x1a\n'))
        return 'image/png';
    if (prefix.startsWith('\x00\x00\x01\x00'))
        return 'image/x-icon';
    if (prefix.startsWith('GIF87a') || prefix.startsWith('GIF89a'))
        return 'image/gif';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return 'image/jpeg';
    if (prefix.startsWith('RIFF') && prefix.slice(8) === 'WEBP')
        return 'image/webp';
    if (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(new TextDecoder().decode(bytes.slice(0, 512))))
        return 'image/svg+xml';
    return null;
}
async function decodesImage(blob) {
    // Node metadata tests have no image decoder; Firefox verifies actual rendering.
    if (typeof Image === 'undefined')
        return true;
    const url = URL.createObjectURL(blob);
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image.naturalWidth > 0 && image.naturalHeight > 0;
    }
    catch {
        return false;
    }
    finally {
        URL.revokeObjectURL(url);
    }
}
/** Uses Firefox's observed icon, then the site's link metadata and conventional favicon.
 * A public-site favicon cache is the final online fallback. All downloads omit
 * cookies/credentials and referrers. URLs stay ephemeral in the UI.
 */
export async function loadWebsiteIcon(hostname, observedIcon, fetcher = fetch) {
    // Callers supply the current effective destination index; this check only makes a safe URL.
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname))
        return null;
    const root = `https://${hostname}/`;
    let controller = new AbortController();
    let timer = setTimeout(() => { controller.abort(); }, 5000);
    const options = { credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal };
    const image = async (url) => {
        try {
            const bytes = await limitedBytes(await fetcher(url, options));
            const type = bytes ? imageType(bytes) : null;
            if (!bytes || !type)
                return null;
            const blob = new Blob([bytes.buffer], { type });
            return await decodesImage(blob) ? blob : null;
        }
        catch {
            return null;
        }
    };
    let conventional = null;
    try {
        if (observedIcon) {
            // Firefox may supply an inline icon. Accept only image data, never page/file URLs.
            const observed = /^data:image\/(?:png|x-icon|vnd\.microsoft\.icon|gif|jpeg|webp|svg\+xml)[;,]/i.test(observedIcon)
                ? observedIcon : publicImageUrl(observedIcon, root);
            if (observed) {
                const icon = await image(observed);
                if (icon)
                    return icon;
            }
        }
        try {
            const page = await fetcher(root, options);
            const bytes = await limitedBytes(page);
            if (bytes)
                for (const url of declaredIconUrls(new TextDecoder().decode(bytes), page.url || root).slice(0, 4)) {
                    const icon = await image(url);
                    if (icon)
                        return icon;
                }
        }
        catch { /* A blocked/unavailable homepage still has the conventional icon fallback. */ }
        conventional = await image(new URL('favicon.ico', root).href);
    }
    finally {
        clearTimeout(timer);
    }
    if (conventional)
        return conventional;
    // Reserved/internal hosts stay on their own metadata; only public DNS names use the cache.
    if (!hostname.includes('.') || /^\d+(?:\.\d+){3}$/.test(hostname)
        || /\.(?:localhost|local|internal|lan|home|corp|test|example|invalid)$/.test(hostname))
        return null;
    const cached = new URL('https://www.google.com/s2/favicons');
    cached.searchParams.set('domain', hostname);
    cached.searchParams.set('sz', '64');
    controller = new AbortController();
    options.signal = controller.signal;
    timer = setTimeout(() => { controller.abort(); }, 4000);
    try {
        return await image(cached.href);
    }
    finally {
        clearTimeout(timer);
    }
}
