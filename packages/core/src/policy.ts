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
    Object.keys(input).some((key) => key !== "whitelist" && key !== "blacklist") ||
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

  return { whitelist, blacklist };
}
