import { compileManagedBlacklist, normalizeTarget, type ManagedBlacklist } from '@atlas/core';

export const sourceUrl = 'https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/fakenews-gambling-porn-social/hosts';
export const categories = ['base', 'fakenews', 'gambling', 'porn', 'social'] as const;
export const maxFeedBytes = 20_000_000;
export const minimumDomains = 50_000;
export interface ParsedFeed {
  readonly domains: readonly string[];
  readonly declaredCount: number | null;
  readonly upstreamDate: string | null;
  readonly identityValid: boolean;
  readonly malformedLines: number;
  readonly uniqueNames: number;
  readonly ignoredNames: number;
}

const local = (hostname: string) => hostname === 'localhost' || hostname === 'localhost.localdomain'
  || hostname === 'local' || hostname === 'broadcasthost' || hostname.startsWith('ip6-')
  || hostname.endsWith('.localhost') || hostname.endsWith('.local');

/** Data parsing only. Arbitrary event objects and URLs never reach this module. */
export function parseHostsFeed(text: string): ParsedFeed {
  const domains = new Set<string>();
  const names = new Set<string>();
  let malformedLines = 0;
  for (const line of text.split(/\r?\n/)) {
    const record = line.split('#', 1)[0]!.trim();
    if (record === '') continue;
    const fields = record.split(/\s+/);
    const ip = fields.shift();
    if (ip !== '0.0.0.0' && ip !== '127.0.0.1' && ip !== '::') {
      // Ignore static hosts mappings/IP fields; non-hosts content is malformed.
      if (!/^[0-9a-f:.]+(?:%[a-z0-9]+)?$/i.test(ip ?? '')) malformedLines++;
      continue;
    }
    if (fields.length === 0) { malformedLines++; continue; }
    for (const field of fields) {
      if (field === '0.0.0.0' || field === '127.0.0.1' || field === '::1' || local(field.toLowerCase())) continue;
      names.add(field.toLowerCase().replace(/\.$/, ''));
      const hostname = normalizeTarget({ hostname: field })?.hostname;
      if (hostname === undefined || !hostname.includes('.')) continue;
      if (!local(hostname)) domains.add(hostname);
    }
  }
  const header = text.slice(0, 4000);
  const count = /^# Number of unique domains:\s*([\d,]+)\s*$/m.exec(header)?.[1];
  const date = /^# Date:\s*(.+)$/m.exec(header)?.[1]?.trim() ?? null;
  const extensionLine = /^# Extensions added to this file:\s*(.+)$/m.exec(header)?.[1];
  const extensions = extensionLine?.split(',').map((part) => part.trim()).sort().join(',');
  return { domains: [...domains], malformedLines, uniqueNames: names.size, ignoredNames: names.size - domains.size,
    declaredCount: count === undefined ? null : Number(count.replaceAll(',', '')), upstreamDate: date,
    identityValid: header.startsWith('# Title: StevenBlack/hosts ')
      && header.includes(`# Project home page: https://github.com/StevenBlack/hosts`)
      && extensions === 'fakenews,gambling,porn,social' };
}

export function validateFeed(text: string, previousCount = 0): { parsed: ParsedFeed; compiled: ManagedBlacklist } | null {
  if (text.length === 0 || text.length > maxFeedBytes || text.includes('\0')) return null;
  const parsed = parseHostsFeed(text);
  if (!parsed.identityValid || parsed.upstreamDate === null || parsed.malformedLines !== 0
    || parsed.uniqueNames !== parsed.declaredCount || parsed.domains.length < minimumDomains
    || parsed.ignoredNames > Math.max(20, parsed.uniqueNames * 0.001)
    || parsed.domains.length < previousCount * 0.8) return null;
  const compiled = compileManagedBlacklist(parsed.domains);
  return compiled === null ? null : { parsed, compiled };
}
