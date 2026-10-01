import { normalizeHostname } from "./target.js";

declare const managedBrand: unique symbol;
/** Opaque runtime data. Only Core compilation creates valid instances. */
export interface ManagedBlacklist {
  readonly size: number;
  readonly [managedBrand]: true;
}
const contents = new WeakMap<object, ReadonlySet<string>>();

export function compileManagedBlacklist(input: unknown): ManagedBlacklist | null {
  if (!Array.isArray(input)) return null;
  const domains = new Set<string>();
  for (const entry of input) {
    const hostname = normalizeHostname(entry);
    if (hostname === null) return null;
    domains.add(hostname);
  }
  const compiled = Object.freeze({ size: domains.size }) as ManagedBlacklist;
  contents.set(compiled, domains);
  return compiled;
}

export function isManagedBlacklist(input: unknown): input is ManagedBlacklist {
  return input !== null && typeof input === "object" && contents.has(input);
}

/** Callers normalize a single target. Invalid compiled authority is never an empty list. */
export function managedBlacklistContains(input: unknown, hostname: string): boolean | null {
  return isManagedBlacklist(input) ? contents.get(input)!.has(hostname) : null;
}
