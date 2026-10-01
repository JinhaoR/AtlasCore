import type {
  AccessContext, AccessContextError, AccessGrant, AccessState, AccessTiming,
  PendingAccessRequest,
} from "./access-models.js";
import { normalizePolicy } from "./policy.js";
import { normalizeHostname } from "./target.js";

function hasFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.hasOwn(value, field));
}

export function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function positiveInteger(value: unknown): value is number {
  return nonnegativeInteger(value) && value > 0;
}

function normalizedHostname(value: unknown): value is string {
  return typeof value === "string" && normalizeHostname(value) === value;
}

export function readAccessScope(value: unknown, hostname: string): readonly string[] | null {
  if (!Array.isArray(value) || value.length === 0 || ![...value].every(normalizedHostname)
    || !value.includes(hostname) || new Set(value).size !== value.length) return null;
  return Object.freeze([...value].sort());
}

export function accessScope(record: { hostname: string; scopeHostnames?: readonly string[] }): readonly string[] {
  return record.scopeHostnames ?? [record.hostname];
}

function scopeFields(value: unknown): string[] {
  return value !== null && typeof value === 'object' && Object.hasOwn(value, 'scopeHostnames') ? ['scopeHostnames'] : [];
}

/** Explicit initialization only. Validation never falls back to an empty state. */
export function createAccessState(): AccessState {
  return {
    pendingRequests: [], grants: [], nextRequestId: 1,
    lastObservedAt: 0, policyRevision: 0,
  };
}

export function readTiming(value: unknown): AccessTiming | null {
  if (!hasFields(value, ["waitMs", "confirmationWindowMs", "grantDurationMs"])) return null;
  if (!positiveInteger(value.waitMs) || !positiveInteger(value.confirmationWindowMs)
    || !positiveInteger(value.grantDurationMs)) return null;
  return {
    waitMs: value.waitMs,
    confirmationWindowMs: value.confirmationWindowMs,
    grantDurationMs: value.grantDurationMs,
  };
}

function readPending(value: unknown): PendingAccessRequest | null {
  if (!hasFields(value, [
    "id", "hostname", "startedAt", "readyAt", "confirmBy", "grantDurationMs", "policyRevision", ...scopeFields(value),
  ])) return null;
  if (!positiveInteger(value.id) || !normalizedHostname(value.hostname)
    || !nonnegativeInteger(value.startedAt) || !nonnegativeInteger(value.readyAt)
    || !nonnegativeInteger(value.confirmBy) || !positiveInteger(value.grantDurationMs)
    || !nonnegativeInteger(value.policyRevision)
    || value.readyAt <= value.startedAt || value.confirmBy <= value.readyAt) return null;
  const scope = Object.hasOwn(value, 'scopeHostnames') ? readAccessScope(value.scopeHostnames, value.hostname) : undefined;
  if (scope === null) return null;
  return {
    id: value.id, hostname: value.hostname, startedAt: value.startedAt,
    ...(scope === undefined ? {} : { scopeHostnames: scope }),
    readyAt: value.readyAt, confirmBy: value.confirmBy,
    grantDurationMs: value.grantDurationMs, policyRevision: value.policyRevision,
  };
}

function readGrant(value: unknown): AccessGrant | null {
  if (!hasFields(value, ["requestId", "hostname", "issuedAt", "expiresAt", "policyRevision", ...scopeFields(value)])) {
    return null;
  }
  if (!positiveInteger(value.requestId) || !normalizedHostname(value.hostname)
    || !nonnegativeInteger(value.issuedAt) || !nonnegativeInteger(value.expiresAt)
    || !nonnegativeInteger(value.policyRevision) || value.expiresAt <= value.issuedAt) return null;
  const scope = Object.hasOwn(value, 'scopeHostnames') ? readAccessScope(value.scopeHostnames, value.hostname) : undefined;
  if (scope === null) return null;
  return {
    requestId: value.requestId, hostname: value.hostname,
    ...(scope === undefined ? {} : { scopeHostnames: scope }),
    issuedAt: value.issuedAt, expiresAt: value.expiresAt, policyRevision: value.policyRevision,
  };
}

export function readAccessState(value: unknown): AccessState | null {
  if (!hasFields(value, [
    "pendingRequests", "grants", "nextRequestId", "lastObservedAt", "policyRevision",
  ])) return null;
  if (!positiveInteger(value.nextRequestId) || !nonnegativeInteger(value.lastObservedAt)
    || !nonnegativeInteger(value.policyRevision)
    || !Array.isArray(value.pendingRequests) || !Array.isArray(value.grants)) return null;

  const pendingRequests: PendingAccessRequest[] = [];
  const grants: AccessGrant[] = [];
  const ids = new Set<number>();
  const hosts = new Set<string>();
  for (const entry of value.pendingRequests) {
    const request = readPending(entry);
    if (request === null || request.id >= value.nextRequestId
      || request.startedAt > value.lastObservedAt || request.policyRevision > value.policyRevision
      || ids.has(request.id) || accessScope(request).some((host) => hosts.has(host))) return null;
    ids.add(request.id);
    accessScope(request).forEach((host) => hosts.add(host));
    pendingRequests.push(request);
  }
  for (const entry of value.grants) {
    const grant = readGrant(entry);
    if (grant === null || grant.requestId >= value.nextRequestId
      || grant.issuedAt > value.lastObservedAt || grant.policyRevision > value.policyRevision
      || ids.has(grant.requestId) || accessScope(grant).some((host) => hosts.has(host))) return null;
    ids.add(grant.requestId);
    accessScope(grant).forEach((host) => hosts.add(host));
    grants.push(grant);
  }
  return {
    pendingRequests, grants, nextRequestId: value.nextRequestId,
    lastObservedAt: value.lastObservedAt, policyRevision: value.policyRevision,
  };
}

type PreparedContext =
  | { readonly ok: true; readonly value: AccessContext }
  | { readonly ok: false; readonly reason: AccessContextError };

/** Validate all data and copy it before deriving permission or a candidate state. */
export function prepareContext(input: unknown): PreparedContext {
  if (!hasFields(input, ["policy", "policyRevision", "state", "now"])) {
    return { ok: false, reason: "INVALID_STATE" };
  }
  const policy = normalizePolicy(input.policy);
  if (policy === null) return { ok: false, reason: "INVALID_POLICY" };
  if (!nonnegativeInteger(input.policyRevision)) {
    return { ok: false, reason: "INVALID_POLICY_REVISION" };
  }
  const state = readAccessState(input.state);
  if (state === null) return { ok: false, reason: "INVALID_STATE" };
  if (!nonnegativeInteger(input.now)) return { ok: false, reason: "INVALID_TIME" };
  if (input.now < state.lastObservedAt) return { ok: false, reason: "CLOCK_ROLLBACK" };
  if (input.policyRevision < state.policyRevision) {
    return { ok: false, reason: "POLICY_ROLLBACK" };
  }
  return {
    ok: true,
    value: {
      policy, policyRevision: input.policyRevision, now: input.now,
      state: { ...state, lastObservedAt: input.now, policyRevision: input.policyRevision },
    },
  };
}
