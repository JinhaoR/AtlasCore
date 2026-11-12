import type { Policy } from "./models.js";
import { normalizeHostname } from "./target.js";

function normalizeEntries(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;

  const entries: string[] = [];
  for (const entry of input) {
    const hostname = normalizeHostname(entry);
    if (hostname === null) return null;
    entries.push(hostname);
  }
  return entries;
}

/** Validate the whole policy and copy its lists before making any decision. */
export function normalizePolicy(input: unknown): Policy | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  if (
    Object.keys(input).some((key) => key !== "whitelist" && key !== "blacklist" && key !== "whitelistSubdomains") ||
    !Object.hasOwn(input, "whitelist") ||
    !Object.hasOwn(input, "blacklist") ||
    !("whitelist" in input) ||
    !("blacklist" in input)
  ) {
    return null;
  }

  const whitelist = normalizeEntries(input.whitelist);
  const blacklist = normalizeEntries(input.blacklist);
  if (whitelist === null || blacklist === null) return null;
  if (!Object.hasOwn(input, 'whitelistSubdomains')) return { whitelist, blacklist };
  const whitelistSubdomains = normalizeEntries((input as Record<string, unknown>).whitelistSubdomains);
  // Core has no Public Suffix List. Trusted hosts may further restrict broad
  // policy inputs, but single-label scopes and wildcard strings are never valid.
  if (whitelistSubdomains === null || whitelistSubdomains.some(hostname => hostname.split('.').length < 2)) return null;
  return { whitelist, blacklist, whitelistSubdomains };
}

/** Strict subtraction only. Classification for workflow selection is not a commit. */
export function isWhitelistRemoval(currentInput: unknown, candidateInput: unknown): boolean {
  const current = normalizePolicy(currentInput), candidate = normalizePolicy(candidateInput);
  if (current === null || candidate === null) return false;
  const beforeBlack = new Set(current.blacklist), afterBlack = new Set(candidate.blacklist);
  if (beforeBlack.size !== afterBlack.size || [...afterBlack].some(host => !beforeBlack.has(host))) return false;
  let removed = false;
  for (const field of ['whitelist', 'whitelistSubdomains'] as const) {
    const before = new Set(current[field] ?? []), after = new Set(candidate[field] ?? []);
    if ([...after].some(host => !before.has(host))) return false;
    if (after.size < before.size) removed = true;
  }
  return removed;
}
