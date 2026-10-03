import { curatedWhitelist } from './curated-whitelist.js';
/** Reviewed equivalent entries for services that are not in the Whitelist preset.
 * This metadata supplies an explicit request scope, never permission or policy.
 */
export const greylistAliases = [
    { hostname: 'amazon.se', aliases: ['www.amazon.se'] },
];
/** Only declared equivalents; separate service destinations keep independent scope. */
export function equivalentServiceHostnames(hostname) {
    for (const group of curatedWhitelist)
        for (const service of group.services) {
            const aliases = [service.hostname, ...(service.aliases ?? [])];
            if (aliases.includes(hostname))
                return aliases;
        }
    for (const service of greylistAliases) {
        const aliases = [service.hostname, ...service.aliases];
        if (aliases.includes(hostname))
            return aliases;
    }
    return [hostname];
}
