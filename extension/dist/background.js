"use strict";
(() => {
  // ../packages/core/dist/target.js
  function normalizeHostname(input) {
    if (typeof input !== "string")
      return null;
    const value = input.trim();
    const length = value.length - (value.endsWith(".") ? 1 : 0);
    if (length === 0 || length > 253)
      return null;
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
      const letter = code >= 65 && code <= 90 || code >= 97 && code <= 122;
      if (!digit && !letter && code !== 45)
        return null;
      if (code === 45 && labelLength === 0)
        return null;
      if (++labelLength > 63)
        return null;
      if (!digit)
        numeric = false;
    }
    if (labelLength === 0 || value[length - 1] === "-" || numeric)
      return null;
    const hostname2 = value.slice(0, length).toLowerCase();
    try {
      if (new URL(`https://${hostname2}`).hostname !== hostname2)
        return null;
    } catch {
      return null;
    }
    return hostname2;
  }
  function normalizeTarget(input) {
    let hostname2;
    if (typeof input === "string") {
      const value = input.trim();
      if (/^https?:\/\//i.test(value)) {
        const authority = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1];
        if (authority === void 0 || !/^[a-z0-9.-]+(?::[0-9]+)?$/i.test(authority) || /[\u0000-\u0020\u007f\\]/.test(value)) {
          return null;
        }
        try {
          hostname2 = normalizeHostname(new URL(value).hostname);
        } catch {
          return null;
        }
      } else {
        hostname2 = normalizeHostname(value);
      }
    } else if (input !== null && typeof input === "object" && !Array.isArray(input) && Object.keys(input).length === 1 && Object.hasOwn(input, "hostname") && "hostname" in input) {
      hostname2 = normalizeHostname(input.hostname);
    } else {
      return null;
    }
    return hostname2 === null ? null : { hostname: hostname2 };
  }

  // ../packages/core/dist/managed-blacklist.js
  var contents = /* @__PURE__ */ new WeakMap();
  function compileManagedBlacklist(input) {
    if (!Array.isArray(input))
      return null;
    const domains = /* @__PURE__ */ new Set();
    for (const entry of input) {
      const hostname2 = normalizeHostname(entry);
      if (hostname2 === null)
        return null;
      domains.add(hostname2);
    }
    const compiled = Object.freeze({ size: domains.size });
    contents.set(compiled, domains);
    return compiled;
  }
  function isManagedBlacklist(input) {
    return input !== null && typeof input === "object" && contents.has(input);
  }
  function managedBlacklistContains(input, hostname2) {
    return isManagedBlacklist(input) ? contents.get(input).has(hostname2) : null;
  }

  // ../packages/core/dist/policy.js
  function normalizeEntries(input) {
    if (!Array.isArray(input))
      return null;
    const entries = [];
    for (const entry of input) {
      const hostname2 = normalizeHostname(entry);
      if (hostname2 === null)
        return null;
      entries.push(hostname2);
    }
    return entries;
  }
  function normalizePolicy(input) {
    if (input === null || typeof input !== "object" || Array.isArray(input))
      return null;
    if (Object.keys(input).some((key2) => key2 !== "whitelist" && key2 !== "blacklist" && key2 !== "whitelistSubdomains") || !Object.hasOwn(input, "whitelist") || !Object.hasOwn(input, "blacklist") || !("whitelist" in input) || !("blacklist" in input)) {
      return null;
    }
    const whitelist = normalizeEntries(input.whitelist);
    const blacklist = normalizeEntries(input.blacklist);
    if (whitelist === null || blacklist === null)
      return null;
    if (!Object.hasOwn(input, "whitelistSubdomains"))
      return { whitelist, blacklist };
    const whitelistSubdomains = normalizeEntries(input.whitelistSubdomains);
    if (whitelistSubdomains === null || whitelistSubdomains.some((hostname2) => hostname2.split(".").length < 2))
      return null;
    return { whitelist, blacklist, whitelistSubdomains };
  }
  function isWhitelistRemoval(currentInput, candidateInput) {
    const current = normalizePolicy(currentInput), candidate = normalizePolicy(candidateInput);
    if (current === null || candidate === null)
      return false;
    const beforeBlack = new Set(current.blacklist), afterBlack = new Set(candidate.blacklist);
    if (beforeBlack.size !== afterBlack.size || [...afterBlack].some((host3) => !beforeBlack.has(host3)))
      return false;
    let removed = false;
    for (const field of ["whitelist", "whitelistSubdomains"]) {
      const before = new Set(current[field] ?? []), after = new Set(candidate[field] ?? []);
      if ([...after].some((host3) => !before.has(host3)))
        return false;
      if (after.size < before.size)
        removed = true;
    }
    return removed;
  }

  // ../packages/core/dist/evaluate.js
  function evaluate(requestedSite, currentPolicy) {
    return evaluateNormalized(requestedSite, normalizePolicy(currentPolicy));
  }
  function evaluateMany(requestedSites, currentPolicy) {
    const policy = normalizePolicy(currentPolicy);
    return requestedSites.map((site2) => evaluateNormalized(site2, policy));
  }
  function evaluateNormalized(requestedSite, policy) {
    if (policy === null)
      return { outcome: "DENY", reason: "INVALID_POLICY" };
    const target = normalizeTarget(requestedSite);
    if (target === null)
      return { outcome: "DENY", reason: "INVALID_TARGET" };
    if (policy.blacklist.includes(target.hostname)) {
      return { outcome: "DENY", reason: "BLACKLISTED", target };
    }
    if (policy.whitelist.includes(target.hostname)) {
      return { outcome: "ALLOW", reason: "WHITELISTED", target };
    }
    let scopeRoot;
    for (const root of policy.whitelistSubdomains ?? []) {
      if ((target.hostname === root || target.hostname.endsWith(`.${root}`)) && (scopeRoot === void 0 || root.length > scopeRoot.length))
        scopeRoot = root;
    }
    if (scopeRoot !== void 0)
      return { outcome: "ALLOW", reason: "WHITELISTED_SCOPE", target, scopeRoot };
    return { outcome: "GREYLIST", reason: "UNLISTED", target };
  }

  // ../packages/core/dist/access-state.js
  function hasFields(value, fields4) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === fields4.length && fields4.every((field) => Object.hasOwn(value, field));
  }
  function nonnegativeInteger(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  }
  function positiveInteger(value) {
    return nonnegativeInteger(value) && value > 0;
  }
  function normalizedHostname(value) {
    return typeof value === "string" && normalizeHostname(value) === value;
  }
  function readAccessScope(value, hostname2) {
    if (!Array.isArray(value) || value.length === 0 || ![...value].every(normalizedHostname) || !value.includes(hostname2) || new Set(value).size !== value.length)
      return null;
    return Object.freeze([...value].sort());
  }
  function accessScope(record) {
    return record.scopeHostnames ?? [record.hostname];
  }
  function scopeFields(value) {
    return value !== null && typeof value === "object" && Object.hasOwn(value, "scopeHostnames") ? ["scopeHostnames"] : [];
  }
  function createAccessState() {
    return {
      pendingRequests: [],
      grants: [],
      nextRequestId: 1,
      lastObservedAt: 0,
      policyRevision: 0
    };
  }
  function readTiming(value) {
    if (!hasFields(value, ["waitMs", "confirmationWindowMs", "grantDurationMs"]))
      return null;
    if (!positiveInteger(value.waitMs) || !positiveInteger(value.confirmationWindowMs) || !positiveInteger(value.grantDurationMs))
      return null;
    return {
      waitMs: value.waitMs,
      confirmationWindowMs: value.confirmationWindowMs,
      grantDurationMs: value.grantDurationMs
    };
  }
  function readPending(value) {
    if (!hasFields(value, [
      "id",
      "hostname",
      "startedAt",
      "readyAt",
      "confirmBy",
      "grantDurationMs",
      "policyRevision",
      ...scopeFields(value)
    ]))
      return null;
    if (!positiveInteger(value.id) || !normalizedHostname(value.hostname) || !nonnegativeInteger(value.startedAt) || !nonnegativeInteger(value.readyAt) || !nonnegativeInteger(value.confirmBy) || !positiveInteger(value.grantDurationMs) || !nonnegativeInteger(value.policyRevision) || value.readyAt <= value.startedAt || value.confirmBy <= value.readyAt)
      return null;
    const scope = Object.hasOwn(value, "scopeHostnames") ? readAccessScope(value.scopeHostnames, value.hostname) : void 0;
    if (scope === null)
      return null;
    return {
      id: value.id,
      hostname: value.hostname,
      startedAt: value.startedAt,
      ...scope === void 0 ? {} : { scopeHostnames: scope },
      readyAt: value.readyAt,
      confirmBy: value.confirmBy,
      grantDurationMs: value.grantDurationMs,
      policyRevision: value.policyRevision
    };
  }
  function readGrant(value) {
    if (!hasFields(value, ["requestId", "hostname", "issuedAt", "expiresAt", "policyRevision", ...scopeFields(value)])) {
      return null;
    }
    if (!positiveInteger(value.requestId) || !normalizedHostname(value.hostname) || !nonnegativeInteger(value.issuedAt) || !nonnegativeInteger(value.expiresAt) || !nonnegativeInteger(value.policyRevision) || value.expiresAt <= value.issuedAt)
      return null;
    const scope = Object.hasOwn(value, "scopeHostnames") ? readAccessScope(value.scopeHostnames, value.hostname) : void 0;
    if (scope === null)
      return null;
    return {
      requestId: value.requestId,
      hostname: value.hostname,
      ...scope === void 0 ? {} : { scopeHostnames: scope },
      issuedAt: value.issuedAt,
      expiresAt: value.expiresAt,
      policyRevision: value.policyRevision
    };
  }
  function readAccessState(value) {
    if (!hasFields(value, [
      "pendingRequests",
      "grants",
      "nextRequestId",
      "lastObservedAt",
      "policyRevision"
    ]))
      return null;
    if (!positiveInteger(value.nextRequestId) || !nonnegativeInteger(value.lastObservedAt) || !nonnegativeInteger(value.policyRevision) || !Array.isArray(value.pendingRequests) || !Array.isArray(value.grants))
      return null;
    const pendingRequests = [];
    const grants = [];
    const ids = /* @__PURE__ */ new Set();
    const hosts = /* @__PURE__ */ new Set();
    for (const entry of value.pendingRequests) {
      const request = readPending(entry);
      if (request === null || request.id >= value.nextRequestId || request.startedAt > value.lastObservedAt || request.policyRevision > value.policyRevision || ids.has(request.id) || accessScope(request).some((host3) => hosts.has(host3)))
        return null;
      ids.add(request.id);
      accessScope(request).forEach((host3) => hosts.add(host3));
      pendingRequests.push(request);
    }
    for (const entry of value.grants) {
      const grant = readGrant(entry);
      if (grant === null || grant.requestId >= value.nextRequestId || grant.issuedAt > value.lastObservedAt || grant.policyRevision > value.policyRevision || ids.has(grant.requestId) || accessScope(grant).some((host3) => hosts.has(host3)))
        return null;
      ids.add(grant.requestId);
      accessScope(grant).forEach((host3) => hosts.add(host3));
      grants.push(grant);
    }
    return {
      pendingRequests,
      grants,
      nextRequestId: value.nextRequestId,
      lastObservedAt: value.lastObservedAt,
      policyRevision: value.policyRevision
    };
  }
  function prepareContext(input) {
    if (!hasFields(input, ["policy", "policyRevision", "state", "now"])) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    const policy = normalizePolicy(input.policy);
    if (policy === null)
      return { ok: false, reason: "INVALID_POLICY" };
    if (!nonnegativeInteger(input.policyRevision)) {
      return { ok: false, reason: "INVALID_POLICY_REVISION" };
    }
    const state = readAccessState(input.state);
    if (state === null)
      return { ok: false, reason: "INVALID_STATE" };
    if (!nonnegativeInteger(input.now))
      return { ok: false, reason: "INVALID_TIME" };
    if (input.now < state.lastObservedAt)
      return { ok: false, reason: "CLOCK_ROLLBACK" };
    if (input.policyRevision < state.policyRevision) {
      return { ok: false, reason: "POLICY_ROLLBACK" };
    }
    return {
      ok: true,
      value: {
        policy,
        policyRevision: input.policyRevision,
        now: input.now,
        state: { ...state, lastObservedAt: input.now, policyRevision: input.policyRevision }
      }
    };
  }

  // ../packages/core/dist/access.js
  function reject(reason, nextState) {
    return { ok: false, reason, nextState };
  }
  function evaluateAccess(requestedSite, input) {
    const prepared = prepareContext(input);
    if (!prepared.ok) {
      return { decision: { outcome: "DENY", reason: prepared.reason }, nextState: null };
    }
    const { policy, policyRevision, now: now2, state } = prepared.value;
    const base = evaluate(requestedSite, policy);
    if (base.outcome !== "GREYLIST")
      return { decision: base, nextState: state };
    const target = base.target;
    const grant = state.grants.find((entry) => accessScope(entry).includes(target.hostname));
    const request = state.pendingRequests.find((entry) => accessScope(entry).includes(target.hostname));
    const record = grant ?? request;
    if (record !== void 0 && record.policyRevision !== policyRevision) {
      return {
        decision: { outcome: "GREYLIST", reason: "POLICY_CHANGED", target },
        nextState: state
      };
    }
    if (grant !== void 0) {
      return {
        decision: now2 < grant.expiresAt ? {
          outcome: "ALLOW",
          reason: "ACTIVE_GRANT",
          target,
          requestId: grant.requestId,
          expiresAt: grant.expiresAt
        } : { outcome: "GREYLIST", reason: "GRANT_EXPIRED", target },
        nextState: state
      };
    }
    if (request !== void 0) {
      if (now2 >= request.confirmBy) {
        return {
          decision: { outcome: "GREYLIST", reason: "REQUEST_EXPIRED", target },
          nextState: state
        };
      }
      const details = {
        target,
        requestId: request.id,
        readyAt: request.readyAt,
        confirmBy: request.confirmBy
      };
      return {
        decision: now2 < request.readyAt ? { outcome: "WAIT", reason: "COOLDOWN", ...details } : { outcome: "REQUIRE_CONFIRMATION", reason: "CONFIRMATION_REQUIRED", ...details },
        nextState: state
      };
    }
    return { decision: base, nextState: state };
  }
  function startAccess(requestedSite, input, timingInput, scopeInput) {
    const prepared = prepareContext(input);
    if (!prepared.ok)
      return reject(prepared.reason, null);
    const { policy, policyRevision, now: now2, state } = prepared.value;
    const decision = evaluate(requestedSite, policy);
    if (decision.outcome === "DENY" && decision.reason === "INVALID_TARGET") {
      return reject("INVALID_TARGET", state);
    }
    if (decision.outcome !== "GREYLIST")
      return reject("NOT_GREYLIST", state);
    const timing = readTiming(timingInput);
    if (timing === null)
      return reject("INVALID_TIMING", state);
    const hostname2 = decision.target.hostname;
    const scope = scopeInput === void 0 ? [hostname2] : readAccessScope(scopeInput, hostname2);
    if (scope === null)
      return reject("INVALID_SCOPE", state);
    if (scope.some((host3) => evaluate(host3, policy).outcome !== "GREYLIST"))
      return reject("NOT_GREYLIST", state);
    const existing = state.pendingRequests.find((entry) => accessScope(entry).includes(hostname2));
    if (existing !== void 0 && existing.policyRevision === policyRevision && now2 < existing.confirmBy) {
      return { ok: true, type: "EXISTING_REQUEST", request: existing, nextState: state };
    }
    const grant = state.grants.find((entry) => accessScope(entry).includes(hostname2));
    if (grant !== void 0 && grant.policyRevision === policyRevision && now2 < grant.expiresAt) {
      return reject("GRANT_ACTIVE", state);
    }
    const overlaps = (entry) => accessScope(entry).some((host3) => scope.includes(host3));
    if (state.pendingRequests.some((entry) => overlaps(entry) && entry.policyRevision === policyRevision && now2 < entry.confirmBy) || state.grants.some((entry) => overlaps(entry) && entry.policyRevision === policyRevision && now2 < entry.expiresAt))
      return reject("SCOPE_CONFLICT", state);
    if (!positiveInteger(state.nextRequestId + 1))
      return reject("ID_EXHAUSTED", state);
    const readyAt = now2 + timing.waitMs;
    const confirmBy = readyAt + timing.confirmationWindowMs;
    if (!nonnegativeInteger(readyAt) || !nonnegativeInteger(confirmBy)) {
      return reject("TIME_OVERFLOW", state);
    }
    const request = {
      id: state.nextRequestId,
      hostname: hostname2,
      startedAt: now2,
      readyAt,
      confirmBy,
      ...scopeInput === void 0 ? {} : { scopeHostnames: scope },
      grantDurationMs: timing.grantDurationMs,
      policyRevision
    };
    return {
      ok: true,
      type: "STARTED",
      request,
      nextState: {
        ...state,
        nextRequestId: state.nextRequestId + 1,
        pendingRequests: [...state.pendingRequests.filter((entry) => !overlaps(entry)), request],
        grants: state.grants.filter((entry) => !overlaps(entry))
      }
    };
  }
  function findRequest(requestId, context) {
    if (!positiveInteger(requestId))
      return "INVALID_REQUEST_ID";
    const request = context.state.pendingRequests.find((entry) => entry.id === requestId);
    if (request === void 0)
      return "REQUEST_NOT_FOUND";
    if (request.policyRevision !== context.policyRevision)
      return "POLICY_CHANGED";
    if (context.now >= request.confirmBy)
      return "REQUEST_EXPIRED";
    return request;
  }
  function confirmAccess(requestId, input) {
    const prepared = prepareContext(input);
    if (!prepared.ok)
      return reject(prepared.reason, null);
    const context = prepared.value;
    const { policy, now: now2, state } = context;
    const request = findRequest(requestId, context);
    if (typeof request === "string")
      return reject(request, state);
    if (accessScope(request).some((host3) => evaluate(host3, policy).outcome !== "GREYLIST")) {
      return reject("NOT_GREYLIST", state);
    }
    if (now2 < request.readyAt)
      return reject("NOT_READY", state);
    const expiresAt = now2 + request.grantDurationMs;
    if (!nonnegativeInteger(expiresAt))
      return reject("TIME_OVERFLOW", state);
    const grant = {
      requestId: request.id,
      hostname: request.hostname,
      issuedAt: now2,
      ...request.scopeHostnames === void 0 ? {} : { scopeHostnames: request.scopeHostnames },
      expiresAt,
      policyRevision: context.policyRevision
    };
    return {
      ok: true,
      type: "CONFIRMED",
      grant,
      nextState: {
        ...state,
        pendingRequests: state.pendingRequests.filter((entry) => entry.id !== request.id),
        grants: [...state.grants, grant]
      }
    };
  }
  function cancelAccess(requestId, input) {
    const prepared = prepareContext(input);
    if (!prepared.ok)
      return reject(prepared.reason, null);
    const context = prepared.value;
    const request = findRequest(requestId, context);
    if (typeof request === "string")
      return reject(request, context.state);
    return {
      ok: true,
      type: "CANCELLED",
      requestId: request.id,
      nextState: {
        ...context.state,
        pendingRequests: context.state.pendingRequests.filter((entry) => entry.id !== request.id)
      }
    };
  }
  function endAccess(requestId, input) {
    const prepared = prepareContext(input);
    if (!prepared.ok)
      return reject(prepared.reason, null);
    const { state, now: now2, policyRevision } = prepared.value;
    if (!positiveInteger(requestId))
      return reject("INVALID_REQUEST_ID", state);
    const grant = state.grants.find((entry) => entry.requestId === requestId);
    if (!grant)
      return reject("GRANT_NOT_FOUND", state);
    if (grant.policyRevision !== policyRevision)
      return reject("POLICY_CHANGED", state);
    if (now2 >= grant.expiresAt)
      return reject("GRANT_EXPIRED", state);
    return {
      ok: true,
      type: "ENDED",
      requestId,
      nextState: { ...state, grants: state.grants.filter((entry) => entry.requestId !== requestId) }
    };
  }

  // ../packages/core/dist/journey-state.js
  function hasJourneyFields(value, fields4) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === fields4.length && fields4.every((field) => Object.hasOwn(value, field));
  }
  function validContextId(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  }
  function freezeJourneyState(state) {
    state.journeys.forEach(Object.freeze);
    Object.freeze(state.journeys);
    return Object.freeze(state);
  }
  function createJourneyState() {
    return freezeJourneyState({ journeys: [], nextJourneyId: 1, lastObservedAt: 0, policyRevision: 0 });
  }
  function readJourneyLimits(value) {
    if (!hasJourneyFields(value, ["lifetimeMs", "maxHops"]) || !positiveInteger(value.lifetimeMs) || !positiveInteger(value.maxHops))
      return null;
    return { lifetimeMs: value.lifetimeMs, maxHops: value.maxHops };
  }
  function canonicalHostname(value) {
    return typeof value === "string" && normalizeHostname(value) === value;
  }
  function isEndReason(value) {
    return value === "RETURNED" || value === "EXPIRED" || value === "CANCELLED" || value === "CONTEXT_CLOSED" || value === "POLICY_CHANGED" || value === "INVALID_POLICY" || value === "ROOT_NOT_WHITELISTED" || value === "HOP_LIMIT" || value === "REACHED" || value === "UNRELATED_NAVIGATION" || value === "DESTINATION_CHANGED";
  }
  function readJourneyContinuation(value) {
    if (!hasJourneyFields(value, ["kind", "sourceHostname"]) || !canonicalHostname(value.sourceHostname) || !["HTTP_REDIRECT", "SAME_HOST", "RETAINED", "ARRIVAL", "ROOT_DEPARTURE", "FORM_POST"].includes(value.kind))
      return null;
    return { kind: value.kind, sourceHostname: value.sourceHostname };
  }
  function continuesJourney(journey, target, evidence) {
    if (journey.phase === "ENDED" || evidence === void 0 || evidence.sourceHostname !== journey.currentHostname)
      return false;
    if (evidence.kind === "ROOT_DEPARTURE") {
      return journey.phase === "STARTED" && journey.currentHostname === journey.rootHostname && target !== journey.rootHostname;
    }
    if (evidence.kind === "FORM_POST")
      return journey.phase === "IN_TRANSIT";
    return evidence.kind === "HTTP_REDIRECT" || target === journey.currentHostname || evidence.kind === "ARRIVAL" && target === journey.rootHostname;
  }
  function readJourney(value) {
    if (!hasJourneyFields(value, [
      "id",
      "contextId",
      "rootHostname",
      "currentHostname",
      "startedAt",
      "expiresAt",
      "hopCount",
      "maxHops",
      "policyRevision",
      "phase",
      "endedAt",
      "endReason"
    ]))
      return null;
    if (!positiveInteger(value.id) || !validContextId(value.contextId) || !canonicalHostname(value.rootHostname) || !canonicalHostname(value.currentHostname) || !nonnegativeInteger(value.startedAt) || !nonnegativeInteger(value.expiresAt) || value.expiresAt <= value.startedAt || !nonnegativeInteger(value.hopCount) || !positiveInteger(value.maxHops) || value.hopCount > value.maxHops || !nonnegativeInteger(value.policyRevision))
      return null;
    const details = {
      id: value.id,
      contextId: value.contextId,
      rootHostname: value.rootHostname,
      currentHostname: value.currentHostname,
      startedAt: value.startedAt,
      expiresAt: value.expiresAt,
      hopCount: value.hopCount,
      maxHops: value.maxHops,
      policyRevision: value.policyRevision
    };
    const atRoot = value.currentHostname === value.rootHostname;
    if (value.phase === "STARTED" || value.phase === "IN_TRANSIT") {
      if (value.endedAt !== null || value.endReason !== null)
        return null;
      if (value.phase === "STARTED" ? !atRoot || value.hopCount !== 0 : atRoot || value.hopCount === 0) {
        return null;
      }
      return { ...details, phase: value.phase, endedAt: null, endReason: null };
    }
    if (value.phase !== "ENDED" || !nonnegativeInteger(value.endedAt) || value.endedAt < value.startedAt || !isEndReason(value.endReason))
      return null;
    if (value.endReason === "RETURNED") {
      if (!atRoot || value.hopCount === 0 || value.endedAt >= value.expiresAt)
        return null;
    } else if (value.endReason === "REACHED") {
      if (!atRoot || value.hopCount !== 0 || value.endedAt >= value.expiresAt)
        return null;
    } else if (atRoot ? value.hopCount !== 0 : value.hopCount === 0)
      return null;
    if (value.endReason === "DESTINATION_CHANGED" && (atRoot || value.endedAt >= value.expiresAt))
      return null;
    if (value.endReason === "EXPIRED" && value.endedAt < value.expiresAt)
      return null;
    if (value.endReason === "HOP_LIMIT" && value.hopCount !== value.maxHops)
      return null;
    return { ...details, phase: "ENDED", endedAt: value.endedAt, endReason: value.endReason };
  }
  function readJourneyState(value) {
    if (!hasJourneyFields(value, ["journeys", "nextJourneyId", "lastObservedAt", "policyRevision"]) || !Array.isArray(value.journeys) || !positiveInteger(value.nextJourneyId) || !nonnegativeInteger(value.lastObservedAt) || !nonnegativeInteger(value.policyRevision))
      return null;
    const journeys = [];
    const ids = /* @__PURE__ */ new Set();
    const contexts = /* @__PURE__ */ new Set();
    for (const entry of value.journeys) {
      const journey = readJourney(entry);
      if (journey === null || ids.has(journey.id) || contexts.has(journey.contextId) || journey.id >= value.nextJourneyId || journey.startedAt > value.lastObservedAt || journey.policyRevision > value.policyRevision)
        return null;
      if (journey.phase === "ENDED") {
        if (journey.endedAt > value.lastObservedAt)
          return null;
      } else if (journey.expiresAt <= value.lastObservedAt || journey.policyRevision !== value.policyRevision) {
        return null;
      }
      ids.add(journey.id);
      contexts.add(journey.contextId);
      journeys.push(journey);
    }
    return {
      journeys,
      nextJourneyId: value.nextJourneyId,
      lastObservedAt: value.lastObservedAt,
      policyRevision: value.policyRevision
    };
  }
  function finishJourney(journey, endReason, now2) {
    return journey.phase === "ENDED" ? journey : { ...journey, phase: "ENDED", endedAt: now2, endReason };
  }
  function replaceJourney(state, journey) {
    return freezeJourneyState({
      ...state,
      journeys: state.journeys.map((entry) => entry.id === journey.id ? journey : entry)
    });
  }
  function prepareJourneyContext(input) {
    const invalid = (reason) => ({ ok: false, reason, nextState: null });
    if (!hasJourneyFields(input, ["policy", "policyRevision", "state", "now"]))
      return invalid("INVALID_STATE");
    const state = readJourneyState(input.state);
    if (state === null)
      return invalid("INVALID_STATE");
    if (!nonnegativeInteger(input.now))
      return invalid("INVALID_TIME");
    if (!nonnegativeInteger(input.policyRevision))
      return invalid("INVALID_POLICY_REVISION");
    if (input.now < state.lastObservedAt)
      return invalid("CLOCK_ROLLBACK");
    if (input.policyRevision < state.policyRevision)
      return invalid("POLICY_ROLLBACK");
    const now2 = input.now;
    const policyRevision = input.policyRevision;
    const policy = normalizePolicy(input.policy);
    const nextState = freezeJourneyState({
      ...state,
      lastObservedAt: now2,
      policyRevision,
      journeys: state.journeys.map((journey) => {
        if (journey.phase === "ENDED")
          return journey;
        if (policy === null)
          return finishJourney(journey, "INVALID_POLICY", now2);
        if (journey.policyRevision !== policyRevision)
          return finishJourney(journey, "POLICY_CHANGED", now2);
        if (evaluate(journey.rootHostname, policy).outcome !== "ALLOW") {
          return finishJourney(journey, "ROOT_NOT_WHITELISTED", now2);
        }
        return now2 >= journey.expiresAt ? finishJourney(journey, "EXPIRED", now2) : journey;
      })
    });
    if (policy === null)
      return { ok: false, reason: "INVALID_POLICY", nextState };
    return { ok: true, value: { policy, policyRevision, state: nextState, now: now2 } };
  }

  // ../packages/core/dist/configuration.js
  function readVaultTiming(input) {
    if (!hasJourneyFields(input, ["waitMs", "confirmationWindowMs"]) || !positiveInteger(input.waitMs) || !positiveInteger(input.confirmationWindowMs))
      return null;
    return { waitMs: input.waitMs, confirmationWindowMs: input.confirmationWindowMs };
  }
  function readConfiguration(input) {
    if (!hasJourneyFields(input, ["accessTiming", "vaultTiming", "journeyLimits"]))
      return null;
    const accessTiming = readTiming(input.accessTiming);
    const vaultTiming = readVaultTiming(input.vaultTiming);
    const journeyLimits = readJourneyLimits(input.journeyLimits);
    return accessTiming && vaultTiming && journeyLimits ? { accessTiming, vaultTiming, journeyLimits } : null;
  }
  function sameConfiguration(left, right) {
    return JSON.stringify(readConfiguration(left)) === JSON.stringify(readConfiguration(right));
  }

  // ../packages/core/dist/vault-state.js
  function hasFields2(value, fields4) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === fields4.length && fields4.every((field) => Object.hasOwn(value, field));
  }
  function freezeVaultData(value) {
    if (value !== null && typeof value === "object") {
      for (const child of Object.values(value))
        freezeVaultData(child);
      Object.freeze(value);
    }
    return value;
  }
  function canonicalPolicy(value) {
    const policy = normalizePolicy(value);
    if (policy === null)
      return null;
    return {
      whitelist: [...new Set(policy.whitelist)].sort(),
      blacklist: [...new Set(policy.blacklist)].sort(),
      ...policy.whitelistSubdomains === void 0 ? {} : { whitelistSubdomains: [...new Set(policy.whitelistSubdomains)].sort() }
    };
  }
  function sameEntries(left, right) {
    return left.length === right.length && left.every((host3, index) => host3 === right[index]);
  }
  function samePolicy(left, right) {
    return sameEntries(left.whitelist, right.whitelist) && sameEntries(left.blacklist, right.blacklist) && sameEntries(left.whitelistSubdomains ?? [], right.whitelistSubdomains ?? []);
  }
  function createVaultState() {
    return freezeVaultData({
      pendingProposal: null,
      nextProposalId: 1,
      lastObservedAt: 0,
      policyRevision: 0,
      lastApplied: null
    });
  }
  function readProposal(value) {
    const protectedFields = value !== null && typeof value === "object" && Object.hasOwn(value, "candidateConfiguration");
    if (!hasFields2(value, [
      "id",
      "basePolicyRevision",
      "candidatePolicy",
      "createdAt",
      "readyAt",
      "confirmBy",
      ...protectedFields ? ["candidateConfiguration", "baseConfigurationRevision"] : []
    ]))
      return null;
    const candidateConfiguration = protectedFields ? readConfiguration(value.candidateConfiguration) : void 0;
    if (candidateConfiguration === null || protectedFields && !nonnegativeInteger(value.baseConfigurationRevision))
      return null;
    if (!positiveInteger(value.id) || !nonnegativeInteger(value.basePolicyRevision) || !nonnegativeInteger(value.createdAt) || !nonnegativeInteger(value.readyAt) || !nonnegativeInteger(value.confirmBy) || value.readyAt <= value.createdAt || value.confirmBy <= value.readyAt)
      return null;
    const candidatePolicy = canonicalPolicy(value.candidatePolicy);
    const scoped = candidatePolicy?.whitelistSubdomains !== void 0;
    if (candidatePolicy === null || !hasFields2(value.candidatePolicy, ["whitelist", "blacklist", ...scoped ? ["whitelistSubdomains"] : []]) || !Array.isArray(value.candidatePolicy.whitelist) || !Array.isArray(value.candidatePolicy.blacklist) || !sameEntries(value.candidatePolicy.whitelist, candidatePolicy.whitelist) || !sameEntries(value.candidatePolicy.blacklist, candidatePolicy.blacklist) || scoped && (!Array.isArray(value.candidatePolicy.whitelistSubdomains) || !sameEntries(value.candidatePolicy.whitelistSubdomains, candidatePolicy.whitelistSubdomains)))
      return null;
    return {
      id: value.id,
      basePolicyRevision: value.basePolicyRevision,
      candidatePolicy,
      ...candidateConfiguration === void 0 ? {} : { candidateConfiguration, baseConfigurationRevision: value.baseConfigurationRevision },
      createdAt: value.createdAt,
      readyAt: value.readyAt,
      confirmBy: value.confirmBy
    };
  }
  function readApplied(value) {
    const protectedFields = value !== null && typeof value === "object" && Object.hasOwn(value, "configurationRevision");
    if (!hasFields2(value, ["proposalId", "policyRevision", ...protectedFields ? ["configurationRevision"] : []]) || !positiveInteger(value.proposalId) || !nonnegativeInteger(value.policyRevision) || (protectedFields ? !nonnegativeInteger(value.configurationRevision) || value.policyRevision === 0 && value.configurationRevision === 0 : value.policyRevision === 0))
      return null;
    return {
      proposalId: value.proposalId,
      policyRevision: value.policyRevision,
      ...protectedFields ? { configurationRevision: value.configurationRevision } : {}
    };
  }
  function readVaultState(value) {
    if (!hasFields2(value, [
      "pendingProposal",
      "nextProposalId",
      "lastObservedAt",
      "policyRevision",
      "lastApplied"
    ]) || !positiveInteger(value.nextProposalId) || !nonnegativeInteger(value.lastObservedAt) || !nonnegativeInteger(value.policyRevision))
      return null;
    const pendingProposal = value.pendingProposal === null ? null : readProposal(value.pendingProposal);
    const lastApplied = value.lastApplied === null ? null : readApplied(value.lastApplied);
    if (value.pendingProposal !== null && pendingProposal === null || value.lastApplied !== null && lastApplied === null)
      return null;
    if (pendingProposal !== null && (pendingProposal.id >= value.nextProposalId || pendingProposal.createdAt > value.lastObservedAt || pendingProposal.basePolicyRevision > value.policyRevision))
      return null;
    if (lastApplied !== null && (lastApplied.proposalId >= value.nextProposalId || lastApplied.policyRevision > value.policyRevision))
      return null;
    if (pendingProposal !== null && lastApplied !== null && (pendingProposal.id <= lastApplied.proposalId || pendingProposal.basePolicyRevision < lastApplied.policyRevision || pendingProposal.baseConfigurationRevision !== void 0 && lastApplied.configurationRevision !== void 0 && pendingProposal.baseConfigurationRevision < lastApplied.configurationRevision))
      return null;
    return {
      pendingProposal,
      nextProposalId: value.nextProposalId,
      lastObservedAt: value.lastObservedAt,
      policyRevision: value.policyRevision,
      lastApplied
    };
  }
  function prepareVaultContext(input) {
    const protectedFields = input !== null && typeof input === "object" && Object.hasOwn(input, "configuration");
    if (!hasFields2(input, [
      "policy",
      "policyRevision",
      "state",
      "accessState",
      "now",
      ...protectedFields ? ["configuration", "configurationRevision"] : []
    ])) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    const configuration2 = protectedFields ? readConfiguration(input.configuration) : void 0;
    if (configuration2 === null || protectedFields && !nonnegativeInteger(input.configurationRevision))
      return { ok: false, reason: "INVALID_CONFIGURATION" };
    const policy = canonicalPolicy(input.policy);
    if (policy === null)
      return { ok: false, reason: "INVALID_POLICY" };
    if (!nonnegativeInteger(input.policyRevision))
      return { ok: false, reason: "INVALID_POLICY_REVISION" };
    const state = readVaultState(input.state);
    if (state === null)
      return { ok: false, reason: "INVALID_STATE" };
    const proposal = state.pendingProposal;
    if (protectedFields) {
      if (proposal !== null && proposal.candidateConfiguration === void 0 || state.lastApplied !== null && state.lastApplied.configurationRevision === void 0)
        return { ok: false, reason: "INVALID_STATE" };
      if ((proposal?.baseConfigurationRevision ?? 0) > input.configurationRevision || (state.lastApplied?.configurationRevision ?? 0) > input.configurationRevision)
        return { ok: false, reason: "CONFIGURATION_ROLLBACK" };
    } else if (proposal?.candidateConfiguration !== void 0 || state.lastApplied?.configurationRevision !== void 0)
      return { ok: false, reason: "INVALID_STATE" };
    if (!nonnegativeInteger(input.now))
      return { ok: false, reason: "INVALID_TIME" };
    if (input.now < state.lastObservedAt)
      return { ok: false, reason: "CLOCK_ROLLBACK" };
    if (input.policyRevision < state.policyRevision)
      return { ok: false, reason: "POLICY_ROLLBACK" };
    const access = prepareContext({
      policy,
      policyRevision: input.policyRevision,
      state: input.accessState,
      now: input.now
    });
    if (!access.ok) {
      return { ok: false, reason: access.reason === "INVALID_STATE" ? "INVALID_ACCESS_STATE" : access.reason };
    }
    if (state.pendingProposal !== null && state.pendingProposal.basePolicyRevision === input.policyRevision && samePolicy(state.pendingProposal.candidatePolicy, policy) && (configuration2 === void 0 || state.pendingProposal.baseConfigurationRevision === input.configurationRevision && sameConfiguration(state.pendingProposal.candidateConfiguration, configuration2))) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    return {
      ok: true,
      value: {
        policy,
        policyRevision: input.policyRevision,
        now: input.now,
        accessState: access.value.state,
        ...configuration2 === void 0 ? {} : { configuration: configuration2, configurationRevision: input.configurationRevision },
        state: { ...state, lastObservedAt: input.now, policyRevision: input.policyRevision }
      }
    };
  }

  // ../packages/core/dist/vault.js
  function reject2(reason, nextState) {
    return freezeVaultData({ ok: false, reason, nextState });
  }
  function createProposal(candidateInput, configurationInput, input, timingInput) {
    const prepared = prepareVaultContext(input);
    if (!prepared.ok)
      return reject2(prepared.reason, null);
    const { policy, policyRevision, state, now: now2, configuration: configuration2, configurationRevision } = prepared.value;
    if (state.pendingProposal !== null)
      return reject2("PROPOSAL_PENDING", state);
    const candidatePolicy = canonicalPolicy(candidateInput);
    if (candidatePolicy === null)
      return reject2("INVALID_CANDIDATE_POLICY", state);
    const candidateConfiguration = configuration2 === void 0 ? void 0 : readConfiguration(configurationInput === void 0 ? configuration2 : configurationInput);
    if (candidateConfiguration === null || configuration2 === void 0 && configurationInput !== void 0)
      return reject2("INVALID_CONFIGURATION", state);
    if (samePolicy(candidatePolicy, policy) && (configuration2 === void 0 || sameConfiguration(candidateConfiguration, configuration2)))
      return reject2("NO_POLICY_CHANGE", state);
    const timing = readVaultTiming(configuration2?.vaultTiming ?? timingInput);
    if (timing === null)
      return reject2("INVALID_TIMING", state);
    if (!positiveInteger(state.nextProposalId + 1))
      return reject2("ID_EXHAUSTED", state);
    const readyAt = now2 + timing.waitMs;
    const confirmBy = readyAt + timing.confirmationWindowMs;
    if (!nonnegativeInteger(readyAt) || !nonnegativeInteger(confirmBy))
      return reject2("TIME_OVERFLOW", state);
    const proposal = {
      id: state.nextProposalId,
      basePolicyRevision: policyRevision,
      candidatePolicy,
      createdAt: now2,
      readyAt,
      confirmBy,
      ...candidateConfiguration === void 0 ? {} : { candidateConfiguration, baseConfigurationRevision: configurationRevision }
    };
    return freezeVaultData({
      ok: true,
      type: "PROPOSED",
      proposal,
      nextState: { ...state, pendingProposal: proposal, nextProposalId: state.nextProposalId + 1 }
    });
  }
  function createPolicyProposal(candidateInput, input, timingInput) {
    return createProposal(candidateInput, void 0, input, timingInput);
  }
  function createSettingsProposal(candidateInput, input) {
    const prepared = prepareVaultContext(input);
    if (!prepared.ok)
      return reject2(prepared.reason, null);
    if (prepared.value.configuration === void 0)
      return reject2("INVALID_CONFIGURATION", prepared.value.state);
    return createProposal(prepared.value.policy, candidateInput, input, void 0);
  }
  function findProposal(proposalId, context) {
    if (!positiveInteger(proposalId))
      return "INVALID_PROPOSAL_ID";
    if (context.state.lastApplied?.proposalId === proposalId)
      return "ALREADY_COMMITTED";
    const proposal = context.state.pendingProposal;
    if (proposal === null || proposal.id !== proposalId)
      return "PROPOSAL_NOT_FOUND";
    return proposal;
  }
  function listChanges(before, after) {
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    return {
      added: after.filter((host3) => !beforeSet.has(host3)),
      removed: before.filter((host3) => !afterSet.has(host3))
    };
  }
  function classification(hostname2, policy) {
    const decision = evaluate(hostname2, policy);
    return decision.outcome === "ALLOW" ? "WHITELIST" : decision.outcome === "DENY" ? "BLACKLIST" : "GREYLIST";
  }
  function reviewPolicyProposal(proposalId, input) {
    const prepared = prepareVaultContext(input);
    if (!prepared.ok)
      return { ok: false, reason: prepared.reason };
    const { policy, policyRevision, now: now2, configuration: configuration2, configurationRevision } = prepared.value;
    const proposal = findProposal(proposalId, prepared.value);
    if (typeof proposal === "string")
      return { ok: false, reason: proposal };
    if (proposal.basePolicyRevision !== policyRevision)
      return { ok: false, reason: "POLICY_CHANGED" };
    if (configuration2 !== void 0 && proposal.baseConfigurationRevision !== configurationRevision)
      return { ok: false, reason: "CONFIGURATION_CHANGED" };
    const candidate = proposal.candidatePolicy;
    const hosts = [.../* @__PURE__ */ new Set([
      ...policy.whitelist,
      ...policy.blacklist,
      ...candidate.whitelist,
      ...candidate.blacklist,
      ...policy.whitelistSubdomains ?? [],
      ...candidate.whitelistSubdomains ?? []
    ])].sort();
    const classifications = [];
    for (const hostname2 of hosts) {
      const before = classification(hostname2, policy);
      const after = classification(hostname2, candidate);
      if (before !== after)
        classifications.push({ hostname: hostname2, before, after });
    }
    return freezeVaultData({
      ok: true,
      review: {
        proposalId: proposal.id,
        basePolicyRevision: proposal.basePolicyRevision,
        candidatePolicy: candidate,
        createdAt: proposal.createdAt,
        readyAt: proposal.readyAt,
        confirmBy: proposal.confirmBy,
        phase: now2 >= proposal.confirmBy ? "EXPIRED" : now2 < proposal.readyAt ? "WAITING" : "READY",
        whitelist: listChanges(policy.whitelist, candidate.whitelist),
        ...policy.whitelistSubdomains === void 0 && candidate.whitelistSubdomains === void 0 ? {} : { whitelistSubdomains: listChanges(policy.whitelistSubdomains ?? [], candidate.whitelistSubdomains ?? []) },
        blacklist: listChanges(policy.blacklist, candidate.blacklist),
        classifications,
        invalidatesAccess: !samePolicy(candidate, policy),
        ...configuration2 === void 0 ? {} : {
          currentConfiguration: configuration2,
          candidateConfiguration: proposal.candidateConfiguration,
          baseConfigurationRevision: proposal.baseConfigurationRevision
        }
      }
    });
  }
  function prepareVaultCommit(proposalId, input) {
    const prepared = prepareVaultContext(input);
    if (!prepared.ok)
      return reject2(prepared.reason, null);
    const { policy, policyRevision, state, accessState, now: now2, configuration: configuration2, configurationRevision } = prepared.value;
    const proposal = findProposal(proposalId, prepared.value);
    if (typeof proposal === "string")
      return reject2(proposal, state);
    if (proposal.basePolicyRevision !== policyRevision)
      return reject2("POLICY_CHANGED", state);
    if (configuration2 !== void 0 && proposal.baseConfigurationRevision !== configurationRevision)
      return reject2("CONFIGURATION_CHANGED", state);
    if (now2 >= proposal.confirmBy)
      return reject2("PROPOSAL_EXPIRED", state);
    if (now2 < proposal.readyAt)
      return reject2("NOT_READY", state);
    const nextRevision = policyRevision + (samePolicy(policy, proposal.candidatePolicy) ? 0 : 1);
    const nextConfigurationRevision = configuration2 === void 0 ? void 0 : configurationRevision + (sameConfiguration(configuration2, proposal.candidateConfiguration) ? 0 : 1);
    if (!nonnegativeInteger(nextRevision) || nextConfigurationRevision !== void 0 && !nonnegativeInteger(nextConfigurationRevision))
      return reject2("REVISION_EXHAUSTED", state);
    return freezeVaultData({
      ok: true,
      type: "COMMIT_PREPARED",
      nextState: state,
      candidate: {
        proposalId: proposal.id,
        expectedPolicyRevision: policyRevision,
        preparedAt: now2,
        nextSnapshot: {
          ...configuration2 === void 0 ? {} : { configuration: proposal.candidateConfiguration, configurationRevision: nextConfigurationRevision },
          policy: proposal.candidatePolicy,
          policyRevision: nextRevision,
          vaultState: {
            ...state,
            pendingProposal: null,
            policyRevision: nextRevision,
            lastApplied: {
              proposalId: proposal.id,
              policyRevision: nextRevision,
              ...configuration2 === void 0 ? {} : { configurationRevision: nextConfigurationRevision }
            }
          },
          accessState: { ...accessState, policyRevision: nextRevision }
        }
      }
    });
  }
  function cancelPolicyProposal(proposalId, input) {
    const prepared = prepareVaultContext(input);
    if (!prepared.ok)
      return reject2(prepared.reason, null);
    const { state } = prepared.value;
    const proposal = findProposal(proposalId, prepared.value);
    if (typeof proposal === "string")
      return reject2(proposal, state);
    return freezeVaultData({
      ok: true,
      type: "CANCELLED",
      proposalId: proposal.id,
      nextState: { ...state, pendingProposal: null }
    });
  }

  // ../packages/core/dist/journey.js
  function reject3(reason, nextState) {
    return { ok: false, reason, nextState };
  }
  function deny(reason, nextState) {
    return { decision: { outcome: "DENY", reason }, nextState };
  }
  function findJourney(id, contextId, state) {
    if (!positiveInteger(id))
      return "INVALID_JOURNEY_ID";
    if (!validContextId(contextId))
      return "INVALID_CONTEXT_ID";
    const journey = state.journeys.find((entry) => entry.id === id);
    if (journey === void 0)
      return "JOURNEY_NOT_FOUND";
    return journey.contextId === contextId ? journey : "CONTEXT_MISMATCH";
  }
  function startJourney(requestedRoot, contextId, input, limitsInput) {
    const prepared = prepareJourneyContext(input);
    if (!prepared.ok)
      return reject3(prepared.reason, prepared.nextState);
    const { policy, policyRevision, state, now: now2 } = prepared.value;
    if (!validContextId(contextId))
      return reject3("INVALID_CONTEXT_ID", state);
    const target = normalizeTarget(requestedRoot);
    if (target === null)
      return reject3("INVALID_TARGET", state);
    if (evaluate(target, policy).outcome !== "ALLOW")
      return reject3("NOT_WHITELISTED", state);
    const limits = readJourneyLimits(limitsInput);
    if (limits === null)
      return reject3("INVALID_LIMITS", state);
    if (state.journeys.some((entry) => entry.contextId === contextId && entry.phase !== "ENDED")) {
      return reject3("JOURNEY_ACTIVE", state);
    }
    if (!positiveInteger(state.nextJourneyId + 1))
      return reject3("ID_EXHAUSTED", state);
    const expiresAt = now2 + limits.lifetimeMs;
    if (!nonnegativeInteger(expiresAt))
      return reject3("TIME_OVERFLOW", state);
    const journey = {
      id: state.nextJourneyId,
      contextId,
      rootHostname: target.hostname,
      currentHostname: target.hostname,
      phase: "STARTED",
      startedAt: now2,
      expiresAt,
      hopCount: 0,
      maxHops: limits.maxHops,
      policyRevision,
      endedAt: null,
      endReason: null
    };
    const nextState = freezeJourneyState({
      ...state,
      nextJourneyId: state.nextJourneyId + 1,
      journeys: [...state.journeys.filter((entry) => entry.contextId !== contextId), journey]
    });
    return { ok: true, type: "STARTED", journey, nextState };
  }
  function navigate(navigation, input, record) {
    const prepared = prepareJourneyContext(input);
    if (!prepared.ok)
      return deny(prepared.reason, prepared.nextState);
    const { policy, now: now2 } = prepared.value;
    let state = prepared.value.state;
    const fields4 = ["journeyId", "contextId", "target"];
    if (navigation !== null && typeof navigation === "object" && Object.hasOwn(navigation, "continuation"))
      fields4.push("continuation");
    if (!hasJourneyFields(navigation, fields4)) {
      return deny("INVALID_NAVIGATION", state);
    }
    const continuation = Object.hasOwn(navigation, "continuation") ? readJourneyContinuation(navigation.continuation) : void 0;
    if (continuation === null)
      return deny("INVALID_NAVIGATION", state);
    let journey = findJourney(navigation.journeyId, navigation.contextId, state);
    if (typeof journey === "string")
      return deny(journey, state);
    const target = normalizeTarget(navigation.target);
    if (target === null)
      return deny("INVALID_TARGET", state);
    const base = evaluate(target, policy);
    if (base.outcome === "DENY")
      return { decision: base, nextState: state };
    const returning = target.hostname === journey.rootHostname;
    if (journey.phase !== "ENDED" && !returning && !continuesJourney(journey, target.hostname, continuation)) {
      journey = finishJourney(journey, "UNRELATED_NAVIGATION", now2);
      state = replaceJourney(state, journey);
    }
    const hop = !returning && target.hostname !== journey.currentHostname;
    if (journey.phase !== "ENDED" && hop && journey.hopCount >= journey.maxHops) {
      journey = finishJourney(journey, "HOP_LIMIT", now2);
      state = replaceJourney(state, journey);
    }
    if (journey.phase === "ENDED") {
      return {
        decision: base.outcome === "ALLOW" ? base : {
          outcome: "GREYLIST",
          reason: "JOURNEY_ENDED",
          target,
          journeyId: journey.id,
          endReason: journey.endReason
        },
        nextState: state
      };
    }
    const decision = base.outcome === "ALLOW" ? base : {
      outcome: "ALLOW",
      reason: "ACTIVE_JOURNEY",
      target,
      journeyId: journey.id,
      expiresAt: journey.expiresAt
    };
    if (record) {
      if (returning) {
        journey = finishJourney({ ...journey, currentHostname: target.hostname }, journey.phase === "STARTED" ? "REACHED" : "RETURNED", now2);
      } else if (hop) {
        journey = {
          ...journey,
          currentHostname: target.hostname,
          phase: "IN_TRANSIT",
          hopCount: journey.hopCount + 1
        };
      }
      if (journey.phase !== "ENDED" && continuation?.kind === "ARRIVAL" && base.outcome === "ALLOW") {
        journey = finishJourney(journey, "DESTINATION_CHANGED", now2);
      }
      state = replaceJourney(state, journey);
    }
    return { decision, nextState: state };
  }
  function evaluateJourneyNavigation(navigation, input) {
    return navigate(navigation, input, false);
  }
  function recordJourneyNavigation(navigation, input) {
    return navigate(navigation, input, true);
  }
  function observeJourneys(input) {
    const prepared = prepareJourneyContext(input);
    return prepared.ok ? { ok: true, type: "OBSERVED", nextState: prepared.value.state } : reject3(prepared.reason, prepared.nextState);
  }
  function endJourney(id, contextId, input, reason) {
    const prepared = prepareJourneyContext(input);
    if (!prepared.ok)
      return reject3(prepared.reason, prepared.nextState);
    const { state, now: now2 } = prepared.value;
    const existing = findJourney(id, contextId, state);
    if (typeof existing === "string")
      return reject3(existing, state);
    if (existing.phase === "ENDED")
      return reject3("JOURNEY_ENDED", state);
    const journey = finishJourney(existing, reason, now2);
    return { ok: true, type: "ENDED", journey, nextState: replaceJourney(state, journey) };
  }
  function cancelJourney(id, contextId, input) {
    return endJourney(id, contextId, input, "CANCELLED");
  }
  function closeJourneyContext(id, contextId, input) {
    return endJourney(id, contextId, input, "CONTEXT_CLOSED");
  }

  // ../packages/core/dist/atlas-state.js
  function validateAtlasSnapshot(input) {
    const invalid = (reason, component) => ({ ok: false, reason, component });
    if (!hasJourneyFields(input, ["policy", "policyRevision", "configuration", "configurationRevision", "accessState", "vaultState", "journeyState"])) {
      return invalid("INVALID_SNAPSHOT", "snapshot");
    }
    const policy = normalizePolicy(input.policy);
    if (policy === null)
      return invalid("INVALID_POLICY", "policy");
    if (!nonnegativeInteger(input.policyRevision))
      return invalid("INVALID_POLICY_REVISION", "policyRevision");
    const configuration2 = readConfiguration(input.configuration);
    if (configuration2 === null || !nonnegativeInteger(input.configurationRevision))
      return invalid("INVALID_CONFIGURATION", "configuration");
    const accessState = readAccessState(input.accessState);
    if (accessState === null)
      return invalid("INVALID_ACCESS_STATE", "accessState");
    const vaultState = readVaultState(input.vaultState);
    if (vaultState === null)
      return invalid("INVALID_VAULT_STATE", "vaultState");
    const journeyState = readJourneyState(input.journeyState);
    if (journeyState === null)
      return invalid("INVALID_JOURNEY_STATE", "journeyState");
    for (const [component, state] of [
      ["accessState", accessState],
      ["vaultState", vaultState],
      ["journeyState", journeyState]
    ]) {
      if (state.policyRevision > input.policyRevision)
        return invalid("POLICY_ROLLBACK", component);
    }
    const proposal = vaultState.pendingProposal;
    if (proposal !== null && proposal.candidateConfiguration === void 0 || vaultState.lastApplied !== null && vaultState.lastApplied.configurationRevision === void 0)
      return invalid("INVALID_VAULT_STATE", "vaultState");
    if ((proposal?.baseConfigurationRevision ?? 0) > input.configurationRevision || (vaultState.lastApplied?.configurationRevision ?? 0) > input.configurationRevision)
      return invalid("CONFIGURATION_ROLLBACK", "configurationRevision");
    const canonical = canonicalPolicy(policy);
    if (proposal !== null && proposal.basePolicyRevision === input.policyRevision && proposal.baseConfigurationRevision === input.configurationRevision && samePolicy(proposal.candidatePolicy, canonical) && sameConfiguration(proposal.candidateConfiguration, configuration2)) {
      return invalid("INVALID_VAULT_STATE", "vaultState");
    }
    return freezeVaultData({
      ok: true,
      snapshot: { policy, policyRevision: input.policyRevision, configuration: configuration2, configurationRevision: input.configurationRevision, accessState, vaultState, journeyState }
    });
  }
  function migrateAtlasSnapshotV1(input, configurationInput) {
    const invalid = () => ({ ok: false, reason: "INVALID_SNAPSHOT", component: "snapshot" });
    const configuration2 = readConfiguration(configurationInput);
    if (configuration2 === null || !hasJourneyFields(input, ["policy", "policyRevision", "accessState", "vaultState", "journeyState"]))
      return invalid();
    const vault = readVaultState(input.vaultState);
    if (vault === null || vault.pendingProposal?.candidateConfiguration !== void 0 || vault.lastApplied?.configurationRevision !== void 0)
      return invalid();
    const policy = canonicalPolicy(input.policy);
    if (policy === null || vault.pendingProposal !== null && vault.pendingProposal.basePolicyRevision === input.policyRevision && samePolicy(vault.pendingProposal.candidatePolicy, policy))
      return invalid();
    return validateAtlasSnapshot({ ...input, configuration: configuration2, configurationRevision: 0, vaultState: {
      ...vault,
      pendingProposal: vault.pendingProposal === null ? null : {
        ...vault.pendingProposal,
        candidateConfiguration: configuration2,
        baseConfigurationRevision: 0
      },
      lastApplied: vault.lastApplied === null ? null : { ...vault.lastApplied, configurationRevision: 0 }
    } });
  }

  // ../packages/core/dist/download.js
  var DOWNLOAD_LIFETIME_MS = 3e4;
  var DOWNLOAD_MAX_REDIRECTS = 5;
  var host = (input) => typeof input === "string" && normalizeTarget({ hostname: input })?.hostname === input;
  var journeyId = (input) => input === null || nonnegativeInteger(input) && input > 0;
  function readDownloadIntent(value) {
    if (!hasJourneyFields(value, [
      "operationId",
      "contextId",
      "sourceContextId",
      "sourceJourneyId",
      "sourceHostname",
      "currentHostname",
      "policyRevision",
      "startedAt",
      "expiresAt",
      "lastObservedAt",
      "redirects",
      "phase"
    ]) || !validContextId(value.operationId) || !validContextId(value.contextId) || !validContextId(value.sourceContextId) || !journeyId(value.sourceJourneyId) || !host(value.sourceHostname) || !host(value.currentHostname) || !nonnegativeInteger(value.policyRevision) || !nonnegativeInteger(value.startedAt) || !nonnegativeInteger(value.expiresAt) || !nonnegativeInteger(value.lastObservedAt) || value.expiresAt <= value.startedAt || value.expiresAt - value.startedAt > DOWNLOAD_LIFETIME_MS || value.lastObservedAt < value.startedAt || value.lastObservedAt >= value.expiresAt || !nonnegativeInteger(value.redirects) || value.redirects > DOWNLOAD_MAX_REDIRECTS || !["PREPARED", "REQUESTING", "FINISHED"].includes(value.phase) || value.phase === "PREPARED" && value.redirects !== 0)
      return null;
    return { ...value };
  }
  function readDownloadOperation(value) {
    if (!hasJourneyFields(value, ["kind", "stage", "source", "target", "binding", "intent"]) || value.kind !== "CHECK_DOWNLOAD" || !["PREPARE", "REQUEST", "REDIRECT", "CHECK", "ATTACHMENT"].includes(value.stage) || !hasJourneyFields(value.source, ["target", "context"]) || !hasJourneyFields(value.source.target, ["hostname"]) || !host(value.source.target.hostname) || !hasJourneyFields(value.source.context, ["contextId", "journeyId"]) || !validContextId(value.source.context.contextId) || !journeyId(value.source.context.journeyId) || !hasJourneyFields(value.target, ["hostname"]) || !host(value.target.hostname) || !hasJourneyFields(value.binding, ["operationId", "contextId"]) || !validContextId(value.binding.operationId) || !validContextId(value.binding.contextId))
      return null;
    const intent = value.intent === null ? null : readDownloadIntent(value.intent);
    if (value.intent !== null && intent === null || value.stage === "PREPARE" !== (intent === null))
      return null;
    return {
      kind: "CHECK_DOWNLOAD",
      stage: value.stage,
      source: {
        target: { hostname: value.source.target.hostname },
        context: { contextId: value.source.context.contextId, journeyId: value.source.context.journeyId }
      },
      target: { hostname: value.target.hostname },
      binding: { operationId: value.binding.operationId, contextId: value.binding.contextId },
      intent
    };
  }
  function evaluateDownload(operation, source, target, revision, now2) {
    const deny2 = (reason) => ({ type: "DOWNLOAD", outcome: "DENY", reason });
    if (target.outcome === "DENY")
      return deny2(target.reason === "BLACKLISTED" || target.reason === "MANAGED_BLACKLISTED" ? target.reason : "INVALID_DOWNLOAD");
    if (source?.outcome !== "ALLOW")
      return deny2("DOWNLOAD_SOURCE_UNAUTHORIZED");
    const prior = operation.intent;
    if (prior === null) {
      const expiresAt = Math.min(now2 + DOWNLOAD_LIFETIME_MS, "expiresAt" in source ? source.expiresAt : Infinity);
      if (!nonnegativeInteger(expiresAt) || expiresAt <= now2)
        return deny2("INVALID_DOWNLOAD");
      return { type: "DOWNLOAD", outcome: "PREPARED", intent: {
        ...operation.binding,
        sourceContextId: operation.source.context.contextId,
        sourceJourneyId: operation.source.context.journeyId,
        sourceHostname: operation.source.target.hostname,
        currentHostname: operation.target.hostname,
        policyRevision: revision,
        startedAt: now2,
        expiresAt,
        lastObservedAt: now2,
        redirects: 0,
        phase: "PREPARED"
      } };
    }
    if (prior.policyRevision !== revision)
      return deny2("DOWNLOAD_POLICY_CHANGED");
    if (now2 < prior.lastObservedAt)
      return deny2("INVALID_DOWNLOAD");
    if (now2 >= prior.expiresAt)
      return deny2("DOWNLOAD_EXPIRED");
    if (prior.operationId !== operation.binding.operationId || prior.contextId !== operation.binding.contextId || prior.sourceContextId !== operation.source.context.contextId || prior.sourceJourneyId !== operation.source.context.journeyId || prior.sourceHostname !== operation.source.target.hostname || operation.stage !== "REDIRECT" && prior.currentHostname !== operation.target.hostname)
      return deny2("DOWNLOAD_SCOPE_MISMATCH");
    if (prior.phase === "FINISHED")
      return deny2("DOWNLOAD_CONSUMED");
    if (operation.stage === "REQUEST" ? prior.phase !== "PREPARED" : prior.phase !== "REQUESTING")
      return deny2("INVALID_DOWNLOAD");
    if (operation.stage === "REDIRECT" && prior.redirects >= DOWNLOAD_MAX_REDIRECTS)
      return deny2("DOWNLOAD_REDIRECT_LIMIT");
    return { type: "DOWNLOAD", outcome: operation.stage === "ATTACHMENT" ? "FILE" : "FETCH", intent: {
      ...prior,
      currentHostname: operation.target.hostname,
      lastObservedAt: now2,
      redirects: prior.redirects + (operation.stage === "REDIRECT" ? 1 : 0),
      phase: operation.stage === "ATTACHMENT" ? "FINISHED" : "REQUESTING"
    } };
  }

  // ../packages/core/dist/atlas-planner.js
  function makePlan(result, observationSnapshot = null, candidateSnapshot = null) {
    return freezeVaultData({ result, observationSnapshot, candidateSnapshot });
  }
  function reject4(reason, observation = null) {
    return makePlan({ type: "REJECTED", reason }, observation);
  }
  function readTarget(input) {
    return hasJourneyFields(input, ["hostname"]) ? normalizeTarget(input) : null;
  }
  function readOperation(value) {
    const invalid = (reason = "INVALID_OPERATION") => ({ ok: false, reason });
    const valid = (operation) => ({ ok: true, operation });
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return invalid();
    const input = value;
    const kind = input.kind;
    switch (kind) {
      case "CHECK_DOWNLOAD": {
        const operation = readDownloadOperation(value);
        return operation === null ? invalid() : valid(operation);
      }
      case "BEGIN_NAVIGATION":
      case "CHECK_NAVIGATION":
      case "RECORD_JOURNEY_NAVIGATION": {
        const fields4 = ["contextId", "journeyId"];
        if (input.context !== null && typeof input.context === "object" && Object.hasOwn(input.context, "continuation"))
          fields4.push("continuation");
        if (!hasJourneyFields(input, ["kind", "target", "context"]) || !hasJourneyFields(input.context, fields4))
          return invalid();
        const target = readTarget(input.target);
        if (target === null)
          return invalid("INVALID_TARGET");
        const { contextId, journeyId: journeyId2 } = input.context;
        if (!validContextId(contextId))
          return invalid("INVALID_CONTEXT_ID");
        if (journeyId2 !== null && !positiveInteger(journeyId2))
          return invalid("INVALID_JOURNEY_ID");
        const continuation = Object.hasOwn(input.context, "continuation") ? readJourneyContinuation(input.context.continuation) : void 0;
        if (continuation === null)
          return invalid("INVALID_NAVIGATION");
        return valid({ kind, target, context: { contextId, journeyId: journeyId2, ...continuation === void 0 ? {} : { continuation } } });
      }
      case "START_ACCESS": {
        const scoped = Object.hasOwn(input, "scopeHostnames");
        if (!hasJourneyFields(input, ["kind", "target", ...scoped ? ["scopeHostnames"] : []]))
          return invalid();
        const target = readTarget(input.target);
        if (target === null)
          return invalid("INVALID_TARGET");
        const scopeHostnames = scoped ? readAccessScope(input.scopeHostnames, target.hostname) : void 0;
        return scopeHostnames === null ? invalid("INVALID_SCOPE") : valid({
          kind,
          target,
          ...scopeHostnames === void 0 ? {} : { scopeHostnames }
        });
      }
      case "CONFIRM_ACCESS":
      case "CANCEL_ACCESS":
      case "END_ACCESS":
        if (!hasJourneyFields(input, ["kind", "requestId"]))
          return invalid();
        return positiveInteger(input.requestId) ? valid({ kind, requestId: input.requestId }) : invalid("INVALID_REQUEST_ID");
      case "PROPOSE_POLICY": {
        if (!hasJourneyFields(input, ["kind", "candidatePolicy"]))
          return invalid();
        const candidatePolicy = normalizePolicy(input.candidatePolicy);
        return candidatePolicy === null ? invalid("INVALID_CANDIDATE_POLICY") : valid({ kind, candidatePolicy });
      }
      case "REMOVE_WHITELIST": {
        if (!hasJourneyFields(input, ["kind", "candidatePolicy", "basePolicyRevision"]))
          return invalid();
        if (!nonnegativeInteger(input.basePolicyRevision))
          return invalid("INVALID_POLICY_REVISION");
        const candidatePolicy = normalizePolicy(input.candidatePolicy);
        return candidatePolicy === null ? invalid("INVALID_CANDIDATE_POLICY") : valid({ kind, candidatePolicy, basePolicyRevision: input.basePolicyRevision });
      }
      case "PROPOSE_SETTINGS": {
        if (!hasJourneyFields(input, ["kind", "candidateConfiguration"]))
          return invalid();
        const candidateConfiguration = readConfiguration(input.candidateConfiguration);
        return candidateConfiguration === null ? invalid("INVALID_CONFIGURATION") : valid({ kind, candidateConfiguration });
      }
      case "REVIEW_POLICY":
      case "CONFIRM_POLICY":
      case "CANCEL_POLICY":
        if (!hasJourneyFields(input, ["kind", "proposalId"]))
          return invalid();
        return positiveInteger(input.proposalId) ? valid({ kind, proposalId: input.proposalId }) : invalid("INVALID_PROPOSAL_ID");
      case "START_JOURNEY": {
        if (!hasJourneyFields(input, ["kind", "root", "contextId"]))
          return invalid();
        if (!validContextId(input.contextId))
          return invalid("INVALID_CONTEXT_ID");
        const root = readTarget(input.root);
        return root === null ? invalid("INVALID_TARGET") : valid({ kind, root, contextId: input.contextId });
      }
      case "CANCEL_JOURNEY":
      case "CLOSE_JOURNEY_CONTEXT":
        if (!hasJourneyFields(input, ["kind", "journeyId", "contextId"]))
          return invalid();
        if (!validContextId(input.contextId))
          return invalid("INVALID_CONTEXT_ID");
        return positiveInteger(input.journeyId) ? valid({ kind, journeyId: input.journeyId, contextId: input.contextId }) : invalid("INVALID_JOURNEY_ID");
      case "OBSERVE_TIME":
        return hasJourneyFields(input, ["kind"]) ? valid({ kind }) : invalid();
      default:
        return invalid();
    }
  }
  function accessContext(snapshot, now2) {
    return { policy: snapshot.policy, policyRevision: snapshot.policyRevision, state: snapshot.accessState, now: now2 };
  }
  function journeyContext(snapshot, now2) {
    return { policy: snapshot.policy, policyRevision: snapshot.policyRevision, state: snapshot.journeyState, now: now2 };
  }
  function isWhitelistDecision(decision) {
    return decision.outcome === "ALLOW" && (decision.reason === "WHITELISTED" || decision.reason === "WHITELISTED_SCOPE");
  }
  function vaultContext(snapshot, now2) {
    return {
      policy: snapshot.policy,
      policyRevision: snapshot.policyRevision,
      state: snapshot.vaultState,
      accessState: snapshot.accessState,
      now: now2,
      configuration: snapshot.configuration,
      configurationRevision: snapshot.configurationRevision
    };
  }
  function accessPlan(operation, transition, snapshot) {
    if (!transition.ok)
      return reject4(transition.reason, snapshot);
    const id = "request" in transition ? transition.request.id : "grant" in transition ? transition.grant.requestId : transition.requestId;
    return makePlan({ type: "TRANSITION_PREPARED", operation, id }, snapshot, { ...snapshot, accessState: transition.nextState });
  }
  function journeyPlan(operation, transition, snapshot) {
    if (!transition.ok)
      return reject4(transition.reason, snapshot);
    if (transition.type === "OBSERVED")
      return makePlan({ type: "OBSERVED" }, snapshot);
    return makePlan({ type: "TRANSITION_PREPARED", operation, id: transition.journey.id }, snapshot, { ...snapshot, journeyState: transition.nextState });
  }
  function checkBinding(context, snapshot) {
    if (context.journeyId === null) {
      return snapshot.journeyState.journeys.some((j) => j.contextId === context.contextId && j.phase !== "ENDED") ? "CONTEXT_MISMATCH" : null;
    }
    const journey = snapshot.journeyState.journeys.find((j) => j.id === context.journeyId);
    if (journey === void 0)
      return "JOURNEY_NOT_FOUND";
    return journey.contextId === context.contextId ? null : "CONTEXT_MISMATCH";
  }
  function navigationPlan(operation, snapshot, now2, managed2) {
    const bindingError = checkBinding(operation.context, snapshot);
    if (bindingError !== null)
      return reject4(bindingError, snapshot);
    const access = evaluateAccess(operation.target, accessContext(snapshot, now2));
    if (access.nextState === null)
      return reject4("INVALID_ACCESS_STATE");
    let observation = { ...snapshot, accessState: access.nextState };
    const decision = access.decision;
    const managedDecision = managedDenies(snapshot, operation.target.hostname, managed2) ? { outcome: "DENY", reason: "MANAGED_BLACKLISTED", target: operation.target } : null;
    const navigation = { ...operation.context, target: operation.target };
    if (operation.context.journeyId !== null) {
      const journey = evaluateJourneyNavigation(navigation, journeyContext(observation, now2));
      if (journey.nextState === null)
        return reject4("INVALID_JOURNEY_STATE");
      observation = { ...observation, journeyState: journey.nextState };
      if (journey.decision.outcome === "DENY" && journey.decision.reason !== "BLACKLISTED") {
        return reject4(journey.decision.reason, observation);
      }
      const combined = managedDecision ?? (access.decision.outcome === "DENY" || access.decision.outcome === "ALLOW" ? access.decision : journey.decision.outcome === "ALLOW" ? journey.decision : access.decision);
      if (operation.kind === "RECORD_JOURNEY_NAVIGATION" && combined.outcome === "ALLOW") {
        const recorded = recordJourneyNavigation(navigation, journeyContext(observation, now2));
        if (recorded.nextState === null)
          return reject4("INVALID_JOURNEY_STATE");
        if (recorded.decision.outcome === "DENY") {
          return makePlan({ type: "ASSESSMENT", decision: recorded.decision }, observation);
        }
        return makePlan({ type: "ASSESSMENT", decision: combined }, observation, { ...observation, journeyState: recorded.nextState });
      }
      return makePlan({ type: "ASSESSMENT", decision: combined }, observation);
    }
    if (operation.kind === "RECORD_JOURNEY_NAVIGATION")
      return reject4("INVALID_JOURNEY_ID", observation);
    return makePlan({ type: "ASSESSMENT", decision: managedDecision ?? decision }, observation);
  }
  function beginNavigation(operation, snapshot, now2, managed2, configuration2) {
    const bindingError = checkBinding(operation.context, snapshot);
    if (bindingError !== null)
      return reject4(bindingError, snapshot);
    const current = snapshot.journeyState.journeys.find((j) => j.id === operation.context.journeyId);
    const access = evaluateAccess(operation.target, accessContext(snapshot, now2));
    const departure = operation.context.continuation?.kind === "ROOT_DEPARTURE" ? operation.context.continuation : void 0;
    if (departure !== void 0) {
      if (access.decision.outcome === "DENY" || managedDenies(snapshot, operation.target.hostname, managed2)) {
        return navigationPlan(operation, snapshot, now2, managed2);
      }
      if (managedDenies(snapshot, departure.sourceHostname, managed2))
        return reject4("MANAGED_BLACKLISTED", snapshot);
      if (!isWhitelistDecision(evaluateAccess({ hostname: departure.sourceHostname }, accessContext(snapshot, now2)).decision)) {
        return reject4("NOT_WHITELISTED", snapshot);
      }
      if (departure.sourceHostname === operation.target.hostname)
        return reject4("INVALID_NAVIGATION", snapshot);
      if (isWhitelistDecision(access.decision)) {
        return beginNavigation({ ...operation, context: {
          contextId: operation.context.contextId,
          journeyId: operation.context.journeyId
        } }, snapshot, now2, managed2, configuration2);
      }
      if (current !== void 0 && current.phase !== "ENDED") {
        return navigationPlan(operation, snapshot, now2, managed2);
      }
      const started2 = startJourney({ hostname: departure.sourceHostname }, operation.context.contextId, journeyContext(snapshot, now2), configuration2.journeyLimits);
      if (!started2.ok || started2.type !== "STARTED")
        return reject4(started2.ok ? "INVALID_JOURNEY_STATE" : started2.reason, snapshot);
      const candidate2 = { ...snapshot, journeyState: started2.nextState };
      const plan2 = navigationPlan({ ...operation, context: { ...operation.context, journeyId: started2.journey.id } }, candidate2, now2, managed2);
      return makePlan(plan2.result, snapshot, plan2.observationSnapshot ?? candidate2);
    }
    if (!isWhitelistDecision(access.decision) || managedDenies(snapshot, operation.target.hostname, managed2)) {
      return navigationPlan(operation, snapshot, now2, managed2);
    }
    if (current !== void 0 && current.phase !== "ENDED") {
      if (continuesJourney(current, operation.target.hostname, operation.context.continuation) || current.phase === "STARTED" && current.rootHostname === operation.target.hostname) {
        return navigationPlan(operation, snapshot, now2, managed2);
      }
      snapshot = { ...snapshot, journeyState: replaceJourney(snapshot.journeyState, finishJourney(current, "UNRELATED_NAVIGATION", now2)) };
    }
    const started = startJourney(operation.target, operation.context.contextId, journeyContext(snapshot, now2), configuration2.journeyLimits);
    if (!started.ok || started.type !== "STARTED")
      return reject4(started.ok ? "INVALID_JOURNEY_STATE" : started.reason, snapshot);
    const candidate = { ...snapshot, journeyState: started.nextState };
    const plan = navigationPlan({ ...operation, context: { contextId: operation.context.contextId, journeyId: started.journey.id } }, candidate, now2, managed2);
    return makePlan(plan.result, snapshot, plan.observationSnapshot ?? candidate);
  }
  function managedDenies(snapshot, hostname2, managed2) {
    return managed2 !== void 0 && !snapshot.policy.blacklist.includes(hostname2) && !snapshot.policy.whitelist.includes(hostname2) && managedBlacklistContains(managed2, hostname2) === true;
  }
  function planAtlasOperation(operationInput, contextInput) {
    const fields4 = ["snapshot", "now", "configuration"];
    if (contextInput !== null && typeof contextInput === "object" && Object.hasOwn(contextInput, "managedBlacklist"))
      fields4.push("managedBlacklist");
    if (!hasJourneyFields(contextInput, fields4))
      return reject4("INVALID_CONTEXT");
    const validated = validateAtlasSnapshot(contextInput.snapshot);
    if (!validated.ok)
      return reject4(validated.reason);
    const managed2 = Object.hasOwn(contextInput, "managedBlacklist") ? contextInput.managedBlacklist : void 0;
    if (Object.hasOwn(contextInput, "managedBlacklist") && !isManagedBlacklist(managed2))
      return reject4("INVALID_MANAGED_BLACKLIST");
    const managedList = managed2;
    const snapshot = validated.snapshot;
    const now2 = contextInput.now;
    if (!nonnegativeInteger(now2))
      return reject4("INVALID_TIME");
    if ([snapshot.accessState, snapshot.vaultState, snapshot.journeyState].some((s) => now2 < s.lastObservedAt)) {
      return reject4("CLOCK_ROLLBACK");
    }
    const configuration2 = snapshot.configuration;
    if (readConfiguration(contextInput.configuration) === null)
      return reject4("INVALID_CONFIGURATION");
    const parsed = readOperation(operationInput);
    const journeys = observeJourneys(journeyContext(snapshot, now2));
    if (!journeys.ok)
      return reject4(journeys.reason);
    const journeyState = { ...journeys.nextState, journeys: journeys.nextState.journeys.map((journey) => journey.phase !== "ENDED" && managedDenies(snapshot, journey.rootHostname, managedList) ? finishJourney(journey, "ROOT_NOT_WHITELISTED", now2) : journey) };
    const observation = {
      ...snapshot,
      accessState: { ...snapshot.accessState, lastObservedAt: now2, policyRevision: snapshot.policyRevision },
      vaultState: { ...snapshot.vaultState, lastObservedAt: now2, policyRevision: snapshot.policyRevision },
      journeyState
    };
    if (!parsed.ok)
      return reject4(parsed.reason, observation);
    const operation = parsed.operation;
    const pending = operation.kind === "CONFIRM_ACCESS" ? observation.accessState.pendingRequests.find((r) => r.id === operation.requestId) : void 0;
    const guardedHosts = operation.kind === "START_ACCESS" ? operation.scopeHostnames ?? [operation.target.hostname] : pending === void 0 ? [] : accessScope(pending);
    if (guardedHosts.some((host3) => managedDenies(observation, host3, managedList)))
      return reject4("MANAGED_BLACKLISTED", observation);
    switch (operation.kind) {
      case "CHECK_DOWNLOAD": {
        const source = navigationPlan({
          kind: "CHECK_NAVIGATION",
          target: operation.source.target,
          context: { ...operation.source.context, ...operation.source.context.journeyId === null ? {} : {
            continuation: { kind: "RETAINED", sourceHostname: operation.source.target.hostname }
          } }
        }, observation, now2, managedList);
        const access = evaluateAccess(operation.target, accessContext(observation, now2)).decision;
        const target = managedDenies(observation, operation.target.hostname, managedList) ? { outcome: "DENY", reason: "MANAGED_BLACKLISTED", target: operation.target } : access;
        return makePlan(evaluateDownload(operation, source.result.type === "ASSESSMENT" ? source.result.decision : null, target, observation.policyRevision, now2), observation);
      }
      case "BEGIN_NAVIGATION":
        return beginNavigation(operation, observation, now2, managedList, configuration2);
      case "CHECK_NAVIGATION":
      case "RECORD_JOURNEY_NAVIGATION":
        return navigationPlan(operation, observation, now2, managedList);
      case "OBSERVE_TIME":
        return makePlan({ type: "OBSERVED" }, observation);
      case "REMOVE_WHITELIST": {
        if (operation.basePolicyRevision !== observation.policyRevision)
          return reject4("POLICY_CHANGED", observation);
        if (!isWhitelistRemoval(observation.policy, operation.candidatePolicy))
          return reject4("NOT_WHITELIST_REMOVAL", observation);
        const policyRevision = observation.policyRevision + 1;
        if (!nonnegativeInteger(policyRevision))
          return reject4("REVISION_EXHAUSTED", observation);
        const next = {
          ...observation,
          policy: { ...operation.candidatePolicy, blacklist: observation.policy.blacklist },
          policyRevision,
          accessState: { ...observation.accessState, policyRevision },
          vaultState: { ...observation.vaultState, policyRevision }
        };
        const invalidated = observeJourneys(journeyContext(next, now2));
        if (!invalidated.ok)
          return reject4(invalidated.reason, observation);
        return makePlan({ type: "TRANSITION_PREPARED", operation: operation.kind, id: policyRevision }, observation, { ...next, journeyState: invalidated.nextState });
      }
      case "START_ACCESS":
        return accessPlan(operation.kind, startAccess(operation.target, accessContext(observation, now2), configuration2.accessTiming, operation.scopeHostnames), observation);
      case "CONFIRM_ACCESS":
        return accessPlan(operation.kind, confirmAccess(operation.requestId, accessContext(observation, now2)), observation);
      case "END_ACCESS":
        return accessPlan(operation.kind, endAccess(operation.requestId, accessContext(observation, now2)), observation);
      case "CANCEL_ACCESS":
        return accessPlan(operation.kind, cancelAccess(operation.requestId, accessContext(observation, now2)), observation);
      case "START_JOURNEY":
        if (managedDenies(observation, operation.root.hostname, managedList))
          return reject4("MANAGED_BLACKLISTED", observation);
        return journeyPlan(operation.kind, startJourney(operation.root, operation.contextId, journeyContext(observation, now2), configuration2.journeyLimits), observation);
      case "CANCEL_JOURNEY":
      case "CLOSE_JOURNEY_CONTEXT": {
        const end = operation.kind === "CANCEL_JOURNEY" ? cancelJourney : closeJourneyContext;
        return journeyPlan(operation.kind, end(operation.journeyId, operation.contextId, journeyContext(observation, now2)), observation);
      }
      case "PROPOSE_SETTINGS":
      case "PROPOSE_POLICY": {
        const proposed = operation.kind === "PROPOSE_SETTINGS" ? createSettingsProposal(operation.candidateConfiguration, vaultContext(observation, now2)) : createPolicyProposal(operation.candidatePolicy, vaultContext(observation, now2), configuration2.vaultTiming);
        return proposed.ok ? makePlan({ type: "TRANSITION_PREPARED", operation: operation.kind, id: proposed.proposal.id }, observation, { ...observation, vaultState: proposed.nextState }) : reject4(proposed.reason, observation);
      }
      case "CANCEL_POLICY": {
        const cancelled = cancelPolicyProposal(operation.proposalId, vaultContext(observation, now2));
        return cancelled.ok ? makePlan({ type: "TRANSITION_PREPARED", operation: operation.kind, id: cancelled.proposalId }, observation, { ...observation, vaultState: cancelled.nextState }) : reject4(cancelled.reason, observation);
      }
      case "CONFIRM_POLICY": {
        const prepared = prepareVaultCommit(operation.proposalId, vaultContext(observation, now2));
        if (!prepared.ok)
          return reject4(prepared.reason, observation);
        const next = {
          ...observation,
          ...prepared.candidate.nextSnapshot,
          policy: prepared.candidate.nextSnapshot.policyRevision === observation.policyRevision ? observation.policy : prepared.candidate.nextSnapshot.policy
        };
        const invalidated = observeJourneys(journeyContext(next, now2));
        if (!invalidated.ok)
          return reject4(invalidated.reason, observation);
        return makePlan({
          type: "POLICY_COMMIT_PREPARED",
          proposalId: operation.proposalId,
          expectedPolicyRevision: prepared.candidate.expectedPolicyRevision
        }, observation, { ...next, journeyState: invalidated.nextState });
      }
      case "REVIEW_POLICY": {
        const reviewed = reviewPolicyProposal(operation.proposalId, vaultContext(snapshot, now2));
        return reviewed.ok ? makePlan({ type: "REVIEW", review: reviewed.review }) : reject4(reviewed.reason);
      }
    }
  }

  // ../packages/core/dist/atlas-equality.js
  function sameAtlasData(left, right) {
    if (left === right)
      return true;
    if (left === null || right === null || typeof left !== "object" || typeof right !== "object")
      return false;
    if (Array.isArray(left)) {
      if (!Array.isArray(right) || left.length !== right.length)
        return false;
      for (let i = 0; i < left.length; i++)
        if (!sameAtlasData(left[i], right[i]))
          return false;
      return true;
    }
    if (Array.isArray(right))
      return false;
    const a = left, b = right;
    const keys2 = Object.keys(a);
    if (keys2.length !== Object.keys(b).length)
      return false;
    for (const key2 of keys2)
      if (!Object.hasOwn(b, key2) || !sameAtlasData(a[key2], b[key2]))
        return false;
    return true;
  }

  // ../packages/core/dist/atlas-controller.js
  function token(value) {
    return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
  }
  function readEnvelope(value) {
    if (!hasJourneyFields(value, ["schemaVersion", "storageVersion", "lastCommitId", "snapshot"]) || value.schemaVersion !== 2 || !token(value.storageVersion) || value.lastCommitId !== null && !token(value.lastCommitId))
      return null;
    const validated = validateAtlasSnapshot(value.snapshot);
    return validated.ok ? Object.freeze({
      schemaVersion: 2,
      storageVersion: value.storageVersion,
      lastCommitId: value.lastCommitId,
      snapshot: validated.snapshot
    }) : null;
  }
  function readReceipt(input, commitId, resolving = false) {
    if (input === null || typeof input !== "object" || Array.isArray(input))
      return null;
    const value = input;
    if (value.type === "COMMITTED") {
      if (!hasJourneyFields(value, ["type", "commitId", "storageVersion"]) || value.commitId !== commitId || !token(value.storageVersion))
        return null;
      return { type: "COMMITTED", commitId, storageVersion: value.storageVersion };
    }
    if (value.type !== "NOT_WRITTEN" && value.type !== "UNKNOWN" && !(value.type === "CONFLICT" && !resolving))
      return null;
    return hasJourneyFields(value, ["type", "commitId"]) && value.commitId === commitId ? { type: value.type, commitId } : null;
  }
  function sameEnvelope(left, right) {
    return left.storageVersion === right.storageVersion && left.lastCommitId === right.lastCommitId && sameAtlasData(left.snapshot, right.snapshot);
  }
  var operationNames = {
    BEGIN_NAVIGATION: true,
    CHECK_NAVIGATION: true,
    RECORD_JOURNEY_NAVIGATION: true,
    START_ACCESS: true,
    CONFIRM_ACCESS: true,
    CANCEL_ACCESS: true,
    END_ACCESS: true,
    START_JOURNEY: true,
    CANCEL_JOURNEY: true,
    CLOSE_JOURNEY_CONTEXT: true,
    PROPOSE_POLICY: true,
    PROPOSE_SETTINGS: true,
    REVIEW_POLICY: true,
    CONFIRM_POLICY: true,
    CANCEL_POLICY: true,
    OBSERVE_TIME: true,
    CHECK_DOWNLOAD: true,
    REMOVE_WHITELIST: true
  };
  function faultOperation(value) {
    try {
      const kind = value !== null && typeof value === "object" ? value.kind : void 0;
      return typeof kind === "string" && Object.hasOwn(operationNames, kind) ? kind : "INVALID_OPERATION";
    } catch {
      return "INVALID_OPERATION";
    }
  }
  function faultClass(value) {
    try {
      const name = value !== null && typeof value === "object" ? value.name : void 0;
      switch (name) {
        case "Error":
          return "ERROR";
        case "TypeError":
          return "TYPE_ERROR";
        case "RangeError":
          return "RANGE_ERROR";
        case "SyntaxError":
          return "SYNTAX_ERROR";
        case "InternalError":
          return "INTERNAL_ERROR";
        case "DataCloneError":
          return "DATA_CLONE_ERROR";
        default:
          return "OTHER";
      }
    } catch {
      return "OTHER";
    }
  }
  function rolledBack(next, prior) {
    return next.configurationRevision < prior.configurationRevision || next.policyRevision < prior.policyRevision || next.accessState.nextRequestId < prior.accessState.nextRequestId || next.vaultState.nextProposalId < prior.vaultState.nextProposalId || next.journeyState.nextJourneyId < prior.journeyState.nextJourneyId || ["accessState", "vaultState", "journeyState"].some((key2) => next[key2].lastObservedAt < prior[key2].lastObservedAt || next[key2].policyRevision < prior[key2].policyRevision);
  }
  function createAtlasController(options) {
    const configuration2 = readConfiguration(options.configuration);
    if (configuration2 === null || !validContextId(options.ownerId) || typeof options.repository?.load !== "function" || typeof options.repository?.commit !== "function" || typeof options.repository?.resolveCommit !== "function" || typeof options.clock?.now !== "function" || options.managedBlacklist !== void 0 && typeof options.managedBlacklist !== "function") {
      throw new TypeError("Invalid Atlas controller dependencies");
    }
    const { repository, clock, ownerId } = options;
    freezeVaultData(configuration2);
    let authority = null;
    let status = "UNINITIALIZED";
    let reason = "NOT_OPEN";
    let timeFloor = 0;
    let sequence = 0;
    let pending = null;
    let resolvedCommit = null;
    let queue = Promise.resolve();
    let internalFault;
    let activeOperation = "OPEN";
    let stage = "START";
    let active = false, queued = 0, completed = 0;
    function setStatus(next, issue = null) {
      status = next;
      reason = issue;
    }
    function getView() {
      return Object.freeze({
        status,
        reason,
        snapshot: authority?.snapshot ?? null,
        storageVersion: authority?.storageVersion ?? null,
        pendingCommitId: pending?.commitId ?? null,
        ...internalFault === void 0 ? {} : { internalFault }
      });
    }
    function blocked(issue = reason ?? "NOT_READY") {
      return Object.freeze({ type: "BLOCKED", reason: issue, status, pendingCommitId: pending?.commitId ?? null });
    }
    function fault(error2) {
      try {
        const snapshot = authority?.snapshot;
        internalFault = Object.freeze({
          sequence: Math.min((internalFault?.sequence ?? 0) + 1, Number.MAX_SAFE_INTEGER),
          operation: activeOperation,
          stage,
          error: faultClass(error2),
          pendingCommitId: pending?.commitId ?? null,
          stateCounts: snapshot ? Object.freeze({
            journeys: snapshot.journeyState.journeys.length,
            requests: snapshot.accessState.pendingRequests.length,
            grants: snapshot.accessState.grants.length
          }) : null
        });
      } catch {
      }
      setStatus(pending ? "RECONCILING" : "UNAVAILABLE", pending ? "COMMIT_UNKNOWN" : "INTERNAL_ERROR");
      try {
        if (internalFault)
          options.onInternalFault?.(error2, internalFault);
      } catch {
      }
    }
    function sampleManaged() {
      stage = "MANAGED_POLICY";
      if (options.managedBlacklist === void 0)
        return void 0;
      try {
        const value = options.managedBlacklist();
        if (isManagedBlacklist(value))
          return value;
      } catch {
      }
      setStatus("UNAVAILABLE", "MANAGED_BLACKLIST_UNAVAILABLE");
      return null;
    }
    function context(snapshot, now2, managed2) {
      return { snapshot, now: now2, configuration: snapshot.configuration, ...managed2 === void 0 ? {} : { managedBlacklist: managed2 } };
    }
    function enqueue(operation, work, failed) {
      queued++;
      const next = queue.then(() => {
        queued--;
        active = true;
        activeOperation = operation;
        stage = "START";
        return work();
      }).catch((error2) => {
        fault(error2);
        return failed();
      }).finally(() => {
        active = false;
        completed++;
      });
      queue = next.then(() => void 0);
      return next;
    }
    function sampleTime() {
      stage = "CLOCK";
      let now2;
      try {
        now2 = clock.now();
      } catch {
        setStatus("UNAVAILABLE", "CLOCK_UNAVAILABLE");
        return null;
      }
      if (!nonnegativeInteger(now2)) {
        setStatus("UNAVAILABLE", "INVALID_TIME");
        return null;
      }
      const snapshot = authority?.snapshot;
      const minimum = Math.max(timeFloor, snapshot?.accessState.lastObservedAt ?? 0, snapshot?.vaultState.lastObservedAt ?? 0, snapshot?.journeyState.lastObservedAt ?? 0);
      if (now2 < minimum) {
        setStatus("UNAVAILABLE", "CLOCK_ROLLBACK");
        return null;
      }
      timeFloor = now2;
      return now2;
    }
    async function loadAuthority(expected) {
      stage = "LOAD";
      let loaded;
      try {
        loaded = await repository.load();
      } catch {
        setStatus("UNAVAILABLE", "STORAGE_UNAVAILABLE");
        return false;
      }
      stage = "VALIDATE_LOAD";
      if (hasJourneyFields(loaded, ["type", "commitId"]) && loaded.type === "UNRESOLVED" && token(loaded.commitId)) {
        pending = { commitId: loaded.commitId, expectedStorageVersion: null, snapshot: null };
        setStatus("RECONCILING", "COMMIT_UNKNOWN");
        return false;
      }
      if (hasJourneyFields(loaded, ["type"]) && loaded.type === "UNINITIALIZED") {
        setStatus(authority === null ? "UNINITIALIZED" : "UNAVAILABLE", authority === null ? "UNINITIALIZED" : "CORRUPT_STATE");
        return false;
      }
      if (hasJourneyFields(loaded, ["type"]) && loaded.type === "UNAVAILABLE") {
        setStatus("UNAVAILABLE", "STORAGE_UNAVAILABLE");
        return false;
      }
      const envelope = hasJourneyFields(loaded, ["type", "envelope"]) && loaded.type === "READY" ? readEnvelope(loaded.envelope) : null;
      if (envelope === null) {
        setStatus("UNAVAILABLE", "CORRUPT_STATE");
        return false;
      }
      stage = "VERIFY_AUTHORITY";
      if (resolvedCommit !== null) {
        const proof = resolvedCommit;
        if (envelope.storageVersion === proof.priorVersion || envelope.storageVersion === proof.storageVersion && (envelope.lastCommitId !== proof.commitId || proof.snapshot !== null && !sameAtlasData(envelope.snapshot, proof.snapshot))) {
          setStatus("UNAVAILABLE", "CORRUPT_STATE");
          return false;
        }
      }
      if (authority !== null) {
        if (rolledBack(envelope.snapshot, authority.snapshot)) {
          setStatus("UNAVAILABLE", "STORAGE_ROLLBACK");
          return false;
        }
        if (envelope.storageVersion === authority.storageVersion && !sameEnvelope(envelope, authority)) {
          setStatus("UNAVAILABLE", "CORRUPT_STATE");
          return false;
        }
      }
      authority = envelope;
      if (expected !== void 0 && !sameEnvelope(envelope, expected)) {
        setStatus("RECONCILING", "AUTHORITY_CHANGED");
        return false;
      }
      resolvedCommit = null;
      return true;
    }
    async function resolvePending() {
      if (pending === null)
        return true;
      const attempt = pending;
      stage = "RESOLVE_COMMIT";
      setStatus("RECONCILING", "COMMIT_UNKNOWN");
      let receipt;
      try {
        receipt = readReceipt(await repository.resolveCommit(attempt.commitId), attempt.commitId, true);
      } catch {
        return false;
      }
      if (receipt === null || receipt.type === "UNKNOWN" || receipt.type === "COMMITTED" && receipt.storageVersion === attempt.expectedStorageVersion)
        return false;
      if (receipt.type === "COMMITTED") {
        resolvedCommit = {
          commitId: attempt.commitId,
          storageVersion: receipt.storageVersion,
          priorVersion: attempt.expectedStorageVersion,
          snapshot: attempt.snapshot
        };
      }
      pending = null;
      return true;
    }
    async function save(snapshot) {
      stage = "VALIDATE_COMMIT";
      if (authority === null) {
        setStatus("UNAVAILABLE", "INTERNAL_ERROR");
        return false;
      }
      if (!positiveInteger(sequence + 1)) {
        setStatus("UNAVAILABLE", "ID_EXHAUSTED");
        return false;
      }
      const validated = validateAtlasSnapshot(snapshot);
      if (!validated.ok) {
        setStatus("UNAVAILABLE", "CORRUPT_STATE");
        return false;
      }
      const expectedStorageVersion = authority.storageVersion;
      const commitId = `${ownerId}:${++sequence}`;
      stage = "PREPARE_COMMIT";
      const next = Object.freeze({ schemaVersion: 2, snapshot: validated.snapshot });
      pending = { commitId, expectedStorageVersion, snapshot: validated.snapshot };
      setStatus("COMMITTING");
      let receipt;
      stage = "COMMIT";
      try {
        receipt = readReceipt(await repository.commit({ expectedStorageVersion, commitId, next }), commitId);
      } catch {
        receipt = null;
      }
      if (receipt === null || receipt.type === "UNKNOWN" || receipt.type === "COMMITTED" && receipt.storageVersion === expectedStorageVersion) {
        setStatus("RECONCILING", "COMMIT_UNKNOWN");
        return false;
      }
      pending = null;
      if (receipt.type === "NOT_WRITTEN") {
        setStatus("UNAVAILABLE", "WRITE_FAILED");
        return false;
      }
      if (receipt.type === "CONFLICT") {
        setStatus("RECONCILING", "STORAGE_CONFLICT");
        await loadAuthority();
        return false;
      }
      const committed = Object.freeze({ ...next, storageVersion: receipt.storageVersion, lastCommitId: commitId });
      authority = committed;
      return loadAuthority(committed);
    }
    async function open() {
      if (status === "READY")
        return getView();
      if (!await resolvePending())
        return getView();
      setStatus("LOADING");
      if (!await loadAuthority() || authority === null)
        return getView();
      const now2 = sampleTime();
      if (now2 === null)
        return getView();
      const managed2 = sampleManaged();
      if (managed2 === null)
        return getView();
      stage = "PLAN_RECOVERY";
      const observed = planAtlasOperation({ kind: "OBSERVE_TIME" }, context(authority.snapshot, now2, managed2));
      let recovery = observed.observationSnapshot;
      if (recovery === null) {
        setStatus("UNAVAILABLE", "CORRUPT_STATE");
        return getView();
      }
      for (const journey of recovery.journeyState.journeys) {
        if (journey.phase === "ENDED")
          continue;
        stage = "PLAN_RECOVERY";
        const closed = planAtlasOperation({
          kind: "CLOSE_JOURNEY_CONTEXT",
          journeyId: journey.id,
          contextId: journey.contextId
        }, context(recovery, now2, managed2));
        if (closed.candidateSnapshot === null) {
          setStatus("UNAVAILABLE", "CORRUPT_STATE");
          return getView();
        }
        recovery = closed.candidateSnapshot;
      }
      stage = "COMPARE_PLAN";
      if (!sameAtlasData(recovery, authority.snapshot) && !await save(recovery))
        return getView();
      if (sampleTime() === null)
        return getView();
      setStatus("READY");
      return getView();
    }
    function publish(result, now2) {
      stage = "PUBLISH";
      if (authority === null)
        return blocked("NOT_READY");
      const version = {
        policyRevision: authority.snapshot.policyRevision,
        storageVersion: authority.storageVersion,
        observedAt: now2
      };
      switch (result.type) {
        case "TRANSITION_PREPARED":
          return freezeVaultData({ type: "COMMITTED", operation: result.operation, referenceId: result.id, ...version });
        case "POLICY_COMMIT_PREPARED":
          return freezeVaultData({ type: "COMMITTED", operation: "CONFIRM_POLICY", referenceId: result.proposalId, ...version });
        default:
          return freezeVaultData({ ...result, ...version });
      }
    }
    async function handle(operation) {
      if (status === "UNAVAILABLE" && reason === "CLOCK_ROLLBACK" && pending === null && hasJourneyFields(operation, ["kind"]) && operation.kind === "OBSERVE_TIME") {
        if (sampleTime() === null)
          return blocked();
        await open();
      }
      if (status !== "READY")
        return blocked();
      setStatus("LOADING");
      if (!await loadAuthority() || authority === null)
        return blocked();
      const now2 = sampleTime();
      if (now2 === null)
        return blocked();
      const managed2 = sampleManaged();
      if (managed2 === null)
        return blocked();
      stage = "PLAN";
      const plan = planAtlasOperation(operation, context(authority.snapshot, now2, managed2));
      const next = plan.candidateSnapshot ?? plan.observationSnapshot;
      stage = "COMPARE_PLAN";
      if (next !== null && (plan.candidateSnapshot !== null || !sameAtlasData(next, authority.snapshot))) {
        if (!await save(next))
          return blocked();
      }
      const finalTime = sampleTime();
      if (finalTime === null)
        return blocked();
      setStatus("READY");
      const currentManaged = sampleManaged();
      if (currentManaged === null)
        return blocked();
      if (currentManaged !== managed2)
        return blocked("REEVALUATION_REQUIRED");
      if (plan.result.type === "ASSESSMENT" && plan.result.decision.outcome === "ALLOW" && "expiresAt" in plan.result.decision && finalTime >= plan.result.decision.expiresAt) {
        return blocked("REEVALUATION_REQUIRED");
      }
      if (plan.result.type === "DOWNLOAD" && plan.result.outcome !== "DENY" && finalTime >= plan.result.intent.expiresAt)
        return blocked("REEVALUATION_REQUIRED");
      return publish(plan.result, now2);
    }
    return Object.freeze({
      open: () => enqueue("OPEN", open, getView),
      handle: (operation) => {
        let captured;
        try {
          captured = structuredClone(operation);
        } catch {
          captured = null;
        }
        return enqueue(faultOperation(captured), () => handle(captured), () => blocked());
      },
      getView,
      getActivity: () => Object.freeze({ operation: activeOperation, stage, active, queued, completed })
    });
  }

  // src/adapter/diagnostics.ts
  var Diagnostics = class {
    sequence = 0;
    entries = [];
    add(entry) {
      this.entries.push(structuredClone({ ...entry, sequence: ++this.sequence }));
      if (this.entries.length > 200) this.entries.shift();
    }
    read(tabId = null) {
      return structuredClone(this.entries.filter((entry) => tabId === null || entry.tabId === tabId));
    }
    clear() {
      this.entries = [];
    }
  };

  // src/adapter/runtime-diagnostics.ts
  var RuntimeDiagnostics = class {
    constructor(backgroundUrl, now2, journal, version = "0.0.0") {
      this.backgroundUrl = backgroundUrl;
      this.now = now2;
      this.journal = journal;
      this.version = version;
      this.startedAt = this.time();
      this.retention = journal ? "LOADING" : "MEMORY_ONLY";
      this.initialized = journal ? journal.load().then(
        (value) => {
          this.previous = value;
          this.retention = "READY";
        },
        () => {
          this.retention = "UNAVAILABLE";
        }
      ) : Promise.resolve();
    }
    entries = [];
    sequence = 0;
    startedAt;
    previous = null;
    retention = "MEMORY_ONLY";
    pendingSave = false;
    saving = null;
    initialized;
    time() {
      try {
        const value = this.now();
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
      } catch {
        return null;
      }
    }
    record(subsystem, value, controller) {
      try {
        let error2 = "OTHER";
        const frames = [];
        if (value !== null && typeof value === "object") {
          const names = {
            Error: "ERROR",
            TypeError: "TYPE_ERROR",
            RangeError: "RANGE_ERROR",
            SyntaxError: "SYNTAX_ERROR",
            InternalError: "INTERNAL_ERROR",
            DataCloneError: "DATA_CLONE_ERROR",
            AbortError: "ABORT_ERROR",
            InvalidStateError: "INVALID_STATE_ERROR",
            QuotaExceededError: "QUOTA_EXCEEDED_ERROR"
          };
          try {
            const name = value.name;
            if (typeof name === "string" && Object.hasOwn(names, name)) error2 = names[name];
          } catch {
          }
          try {
            const stack = value.stack;
            if (typeof stack === "string") for (const line of stack.slice(0, 16384).split("\n").slice(0, 40)) {
              const at2 = line.lastIndexOf("@");
              if (at2 < 0 || !/^[A-Za-z0-9_$./<>]*$/.test(line.slice(0, at2))) continue;
              const location = line.slice(at2 + 1);
              if (!location.startsWith(`${this.backgroundUrl}:`)) continue;
              const match = /^(\d{1,7}):(\d{1,7})$/.exec(location.slice(this.backgroundUrl.length + 1));
              if (match && Number(match[1]) > 0 && Number(match[2]) > 0) frames.push({ asset: "BACKGROUND", line: Number(match[1]), column: Number(match[2]) });
              if (frames.length === 5) break;
            }
          } catch {
          }
        }
        const at = this.time();
        const context = controller ? { operation: controller.operation, stage: controller.stage, sequence: controller.sequence } : null;
        const same2 = this.entries.find((entry) => entry.subsystem === subsystem && entry.error === error2 && entry.controller?.operation === context?.operation && entry.controller?.stage === context?.stage && JSON.stringify(entry.frames) === JSON.stringify(frames));
        if (same2) {
          same2.count = Math.min(same2.count + 1, Number.MAX_SAFE_INTEGER);
          same2.lastAt = at;
          same2.controller = context;
          this.persist();
          return;
        }
        this.entries.push({ sequence: ++this.sequence, subsystem, error: error2, frames, controller: context, count: 1, firstAt: at, lastAt: at });
        if (this.entries.length > 20) this.entries.shift();
        this.persist();
      } catch {
      }
    }
    persist() {
      if (!this.journal) return;
      this.pendingSave = true;
      if (this.saving) return;
      this.saving = this.initialized.then(async () => {
        while (this.pendingSave) {
          this.pendingSave = false;
          try {
            this.retention = await this.journal.save({
              version: this.version,
              startedAt: this.startedAt,
              faults: structuredClone(this.entries)
            }) ? "READY" : "UNAVAILABLE";
          } catch {
            this.retention = "UNAVAILABLE";
          }
        }
      }).finally(() => {
        this.saving = null;
        if (this.pendingSave) this.persist();
      });
    }
    /** Tests/host shutdown may await diagnostics, but authorization never does. */
    async settled() {
      await this.initialized;
      while (this.saving) await this.saving;
    }
    read() {
      return { startedAt: this.startedAt, faults: structuredClone(this.entries), retention: this.retention, previousSession: structuredClone(this.previous) };
    }
  };

  // node_modules/tldts-core/dist/es6/src/domain.js
  function shareSameDomainSuffix(hostname2, vhost) {
    if (hostname2.endsWith(vhost)) {
      return hostname2.length === vhost.length || hostname2[hostname2.length - vhost.length - 1] === ".";
    }
    return false;
  }
  function extractDomainWithSuffix(hostname2, publicSuffix) {
    const publicSuffixIndex = hostname2.length - publicSuffix.length - 2;
    const lastDotBeforeSuffixIndex = hostname2.lastIndexOf(".", publicSuffixIndex);
    if (lastDotBeforeSuffixIndex === -1) {
      return hostname2;
    }
    return hostname2.slice(lastDotBeforeSuffixIndex + 1);
  }
  function getDomain(suffix, hostname2, options) {
    if (options.validHosts !== null) {
      const validHosts = options.validHosts;
      for (const vhost of validHosts) {
        if (
          /*@__INLINE__*/
          shareSameDomainSuffix(hostname2, vhost)
        ) {
          return vhost;
        }
      }
    }
    let numberOfLeadingDots = 0;
    if (hostname2.startsWith(".")) {
      while (numberOfLeadingDots < hostname2.length && hostname2[numberOfLeadingDots] === ".") {
        numberOfLeadingDots += 1;
      }
    }
    if (suffix.length === hostname2.length - numberOfLeadingDots) {
      return null;
    }
    return (
      /*@__INLINE__*/
      extractDomainWithSuffix(hostname2, suffix)
    );
  }

  // node_modules/tldts-core/dist/es6/src/domain-without-suffix.js
  function getDomainWithoutSuffix(domain, suffix) {
    return domain.slice(0, -suffix.length - 1);
  }

  // node_modules/tldts-core/dist/es6/src/extract-hostname.js
  var CONTROL_CHARS = /[\t\n\r]/g;
  var extractedHostnameValidated = false;
  function isValidHostnameChar(code) {
    return code >= 97 && code <= 122 || // a-z
    code >= 48 && code <= 57 || // 0-9
    code > 127 || // non-ASCII (accepted, not punycode-checked)
    code >= 65 && code <= 90 || // A-Z (becomes valid once lowercased)
    code === 45 || // '-'
    code === 95;
  }
  function getSpecialScheme(url, schemeStart, colonIndex) {
    const length = colonIndex - schemeStart;
    const c0 = url.charCodeAt(schemeStart) | 32;
    if (length === 2) {
      return c0 === 119 && (url.charCodeAt(schemeStart + 1) | 32) === 115 ? 1 : 0;
    } else if (length === 3) {
      const c1 = url.charCodeAt(schemeStart + 1) | 32;
      const c2 = url.charCodeAt(schemeStart + 2) | 32;
      if (c0 === 119 && c1 === 115 && c2 === 115)
        return 1;
      if (c0 === 102 && c1 === 116 && c2 === 112)
        return 1;
      return 0;
    } else if (length === 4) {
      const c1 = url.charCodeAt(schemeStart + 1) | 32;
      const c2 = url.charCodeAt(schemeStart + 2) | 32;
      const c3 = url.charCodeAt(schemeStart + 3) | 32;
      if (c0 === 104 && c1 === 116 && c2 === 116 && c3 === 112)
        return 1;
      if (c0 === 102 && c1 === 105 && c2 === 108 && c3 === 101)
        return 2;
      return 0;
    } else if (length === 5) {
      return c0 === 104 && (url.charCodeAt(schemeStart + 1) | 32) === 116 && (url.charCodeAt(schemeStart + 2) | 32) === 116 && (url.charCodeAt(schemeStart + 3) | 32) === 112 && (url.charCodeAt(schemeStart + 4) | 32) === 115 ? 1 : 0;
    }
    return 0;
  }
  function extractHostname(url, urlIsValidHostname, validate = false) {
    let start = 0;
    let end = url.length;
    let hasUpper = false;
    let isSpecial = false;
    extractedHostnameValidated = false;
    if (!urlIsValidHostname) {
      if (url.startsWith("data:")) {
        return null;
      }
      while (start < url.length && url.charCodeAt(start) <= 32) {
        start += 1;
      }
      while (end > start + 1 && url.charCodeAt(end - 1) <= 32) {
        end -= 1;
      }
      if (url.charCodeAt(start) === 47 && url.charCodeAt(start + 1) === 47) {
        start += 2;
      } else {
        const indexOfProtocol = url.indexOf(":/", start);
        if (indexOfProtocol !== -1) {
          const special = getSpecialScheme(url, start, indexOfProtocol);
          if (special === 1) {
            isSpecial = true;
            start = indexOfProtocol + 2;
            while (url.charCodeAt(start) === 47 || url.charCodeAt(start) === 92) {
              start += 1;
            }
          } else if (special === 2) {
            isSpecial = true;
            start = indexOfProtocol + 1;
            let slashes = 0;
            while ((url.charCodeAt(start) === 47 || url.charCodeAt(start) === 92) && slashes < 2) {
              start += 1;
              slashes += 1;
            }
            if (slashes < 2) {
              return null;
            }
          } else {
            for (let i = start; i < indexOfProtocol; i += 1) {
              const code = url.charCodeAt(i) | 32;
              if (!(code >= 97 && code <= 122 || // [a, z]
              code >= 48 && code <= 57 || // [0, 9]
              code === 46 || // '.'
              code === 45 || // '-'
              code === 43)) {
                const raw = url.charCodeAt(i);
                if (raw === 9 || raw === 10 || raw === 13) {
                  return extractHostname(url.replace(CONTROL_CHARS, ""), urlIsValidHostname, validate);
                }
                return null;
              }
            }
            if (url.charCodeAt(indexOfProtocol + 2) === 47) {
              start = indexOfProtocol + 3;
            } else {
              return null;
            }
          }
        } else if (url.charCodeAt(start) !== 91) {
          let indexOfColon = -1;
          for (let i = start; i < end; i += 1) {
            const code = url.charCodeAt(i);
            if (code === 9 || code === 10 || code === 13) {
              return extractHostname(url.replace(CONTROL_CHARS, ""), urlIsValidHostname, validate);
            }
            if (code === 58) {
              indexOfColon = i;
              break;
            }
            if (code === 47 || code === 92 || code === 63 || code === 35) {
              break;
            }
          }
          if (indexOfColon !== -1) {
            let hasIdentifier = false;
            for (let i = indexOfColon + 1; i < end; i += 1) {
              const code = url.charCodeAt(i);
              if (code === 47 || code === 92 || code === 63 || code === 35) {
                break;
              }
              if (code === 64) {
                hasIdentifier = true;
                break;
              }
            }
            if (!hasIdentifier) {
              let allDigits = true;
              let i = indexOfColon + 1;
              for (; i < end; i += 1) {
                const code = url.charCodeAt(i);
                if (code === 47 || code === 92 || code === 63 || code === 35) {
                  break;
                }
                if (code < 48 || code > 57) {
                  allDigits = false;
                  break;
                }
              }
              if (i === indexOfColon + 1) {
                allDigits = false;
              }
              if (!allDigits) {
                const special = getSpecialScheme(url, start, indexOfColon);
                if (special === 0) {
                  let isBareIpv6 = false;
                  for (let j = indexOfColon + 1; j < end; j += 1) {
                    const code = url.charCodeAt(j);
                    if (code === 47 || code === 92 || code === 63 || code === 35) {
                      break;
                    }
                    if (code === 58) {
                      isBareIpv6 = true;
                      break;
                    }
                  }
                  if (!isBareIpv6) {
                    return null;
                  }
                } else {
                  isSpecial = true;
                  start = indexOfColon + 1;
                  if (special === 2) {
                    let slashes = 0;
                    while ((url.charCodeAt(start) === 47 || url.charCodeAt(start) === 92) && slashes < 2) {
                      start += 1;
                      slashes += 1;
                    }
                    if (slashes < 2) {
                      return null;
                    }
                  } else {
                    while (url.charCodeAt(start) === 47 || url.charCodeAt(start) === 92) {
                      start += 1;
                    }
                  }
                }
              }
            }
          }
        }
      }
      let indexOfIdentifier = -1;
      let indexOfClosingBracket = -1;
      let indexOfPort = -1;
      let indexOfFirstColon = -1;
      let hasControl = false;
      let vValid = validate;
      let vLastDot = start - 1;
      let vLastCode = -1;
      if (validate && start < end) {
        const c0 = url.charCodeAt(start);
        if (
          // Keep these parens: they scope /*@__INLINE__*/ for terser.
          // prettier-ignore
          !/*@__INLINE__*/
          (isValidHostnameChar(c0) || c0 === 46 || c0 === 95) || c0 === 45
        ) {
          vValid = false;
        }
      }
      for (let i = start; i < end; i += 1) {
        const code = url.charCodeAt(i);
        if (code < 64) {
          if (code === 47 || code === 35 || code === 63) {
            end = i;
            break;
          } else if (code === 58) {
            if (indexOfFirstColon === -1) {
              indexOfFirstColon = i;
            }
            indexOfPort = i;
          } else if (code === 9 || code === 10 || code === 13) {
            hasControl = true;
          } else if (validate) {
            if (code === 46) {
              if (i - vLastDot > 64 || vLastCode === 46 || vLastCode === 45) {
                vValid = false;
              }
              vLastDot = i;
            } else if (code < 48 || code > 57) {
              if (code !== 45 || vLastCode === 46) {
                vValid = false;
              }
            }
          }
        } else if (isSpecial && code === 92) {
          end = i;
          break;
        } else if (code === 64) {
          indexOfIdentifier = i;
          indexOfFirstColon = -1;
        } else if (code === 93) {
          indexOfClosingBracket = i;
        } else if (code >= 65 && code <= 90) {
          hasUpper = true;
        } else if (validate && !/*@__INLINE__*/
        isValidHostnameChar(code)) {
          vValid = false;
        }
        if (validate) {
          vLastCode = code;
        }
      }
      if (hasControl) {
        return extractHostname(url.replace(CONTROL_CHARS, ""), urlIsValidHostname, validate);
      }
      if (indexOfIdentifier !== -1 && indexOfIdentifier >= start && indexOfIdentifier < end) {
        start = indexOfIdentifier + 1;
      }
      if (url.charCodeAt(start) === 91) {
        if (indexOfClosingBracket !== -1) {
          return url.slice(start + 1, indexOfClosingBracket).toLowerCase();
        }
        return null;
      } else if (indexOfPort !== -1 && indexOfPort > start && indexOfPort < end && // A host:port has exactly one ':' in the host (so its first ':' is its
      // last); a bare, unbracketed IPv6 literal ("2a01:e35::1") has >= 2, so
      // its first ':' precedes the last. Only the former has a ':port' to trim.
      indexOfFirstColon === indexOfPort) {
        end = indexOfPort;
      }
      if (start >= end) {
        return null;
      }
      if (validate && vValid && indexOfIdentifier === -1 && indexOfPort === -1 && indexOfClosingBracket === -1 && url.charCodeAt(end - 1) !== 46 && end - start <= 255 && // total length
      end - vLastDot - 1 <= 63 && // last label length
      vLastCode !== 45) {
        extractedHostnameValidated = true;
      }
    }
    while (end > start + 1 && url.charCodeAt(end - 1) === 46) {
      end -= 1;
    }
    const hostname2 = start !== 0 || end !== url.length ? url.slice(start, end) : url;
    if (hasUpper) {
      return hostname2.toLowerCase();
    }
    return hostname2;
  }

  // node_modules/tldts-core/dist/es6/src/is-ip.js
  function isProbablyIpv4(hostname2) {
    if (hostname2.length < 7) {
      return false;
    }
    if (hostname2.length > 15) {
      return false;
    }
    let numberOfDots = 0;
    for (let i = 0; i < hostname2.length; i += 1) {
      const code = hostname2.charCodeAt(i);
      if (code === 46) {
        numberOfDots += 1;
      } else if (code < 48 || code > 57) {
        return false;
      }
    }
    return numberOfDots === 3 && hostname2.charCodeAt(0) !== 46 && hostname2.charCodeAt(hostname2.length - 1) !== 46;
  }
  function isProbablyIpv6(hostname2) {
    if (hostname2.length < 3) {
      return false;
    }
    let start = hostname2.startsWith("[") ? 1 : 0;
    let end = hostname2.length;
    if (hostname2[end - 1] === "]") {
      end -= 1;
    }
    if (end - start > 39) {
      return false;
    }
    let hasColon = false;
    for (; start < end; start += 1) {
      const code = hostname2.charCodeAt(start);
      if (code === 58) {
        hasColon = true;
      } else if (!(code >= 48 && code <= 57 || // 0-9
      code >= 97 && code <= 102 || // a-f
      code >= 65 && code <= 70)) {
        return false;
      }
    }
    return hasColon;
  }
  function isIp(hostname2) {
    return isProbablyIpv6(hostname2) || isProbablyIpv4(hostname2);
  }

  // node_modules/tldts-core/dist/es6/src/is-special-use.js
  var SPECIAL_USE_DOMAINS = [
    "test",
    // RFC 6761
    "localhost",
    // RFC 6761
    "invalid",
    // RFC 6761
    "example",
    // RFC 6761
    "example.com",
    // RFC 6761
    "example.net",
    // RFC 6761
    "example.org",
    // RFC 6761
    "local",
    // RFC 6762 (mDNS)
    "onion",
    // RFC 7686 (Tor)
    "alt",
    // RFC 9476
    "home.arpa",
    // RFC 8375
    "ipv4only.arpa",
    // RFC 8880
    "resolver.arpa",
    // RFC 9462
    "service.arpa",
    // RFC 9665
    "6tisch.arpa",
    // RFC 9031
    "eap.arpa"
    // RFC 9965
  ];
  function isSpecialUse(hostname2) {
    for (const name of SPECIAL_USE_DOMAINS) {
      if (hostname2.endsWith(name) && (hostname2.length === name.length || hostname2.charCodeAt(hostname2.length - name.length - 1) === 46)) {
        return true;
      }
    }
    return false;
  }

  // node_modules/tldts-core/dist/es6/src/is-valid.js
  function isValidAscii(code) {
    return code >= 97 && code <= 122 || code >= 48 && code <= 57 || code > 127;
  }
  function is_valid_default(hostname2) {
    if (hostname2.length > 255) {
      return false;
    }
    if (hostname2.length === 0) {
      return false;
    }
    if (
      /*@__INLINE__*/
      !isValidAscii(hostname2.charCodeAt(0)) && hostname2.charCodeAt(0) !== 46 && // '.' (dot)
      hostname2.charCodeAt(0) !== 95
    ) {
      return false;
    }
    let lastDotIndex = -1;
    let lastCharCode = -1;
    const len = hostname2.length;
    for (let i = 0; i < len; i += 1) {
      const code = hostname2.charCodeAt(i);
      if (code === 46) {
        if (
          // Check that previous label is < 63 bytes long (64 = 63 + '.')
          i - lastDotIndex > 64 || // Check that previous character was not already a '.'
          lastCharCode === 46 || // Check that the previous label does not end with '-' (RFC 1035 §2.3.1 LDH).
          // '_' is intentionally NOT restricted: DNS allows any octet (RFC 2181 §11) and
          // WHATWG URL does not treat '_' as a forbidden host code point.
          lastCharCode === 45
        ) {
          return false;
        }
        lastDotIndex = i;
      } else if (
        // A forbidden character in the label...
        // Keep these parens: they scope /*@__INLINE__*/ for terser.
        // prettier-ignore
        !/*@__INLINE__*/
        (isValidAscii(code) || code === 45 || code === 95) || // ...or a '-' starting a label (the byte right after a '.'). A label must
        // not begin with a hyphen (RFC 1034 §3.5 / RFC 1035 §2.3.1 LDH, as amended
        // by RFC 1123 §2.1; cf. UTS #46 CheckHyphens). The first label is covered by
        // the leading-character guard above; mirrors the trailing-'-' rule below.
        code === 45 && lastCharCode === 46
      ) {
        return false;
      }
      lastCharCode = code;
    }
    return (
      // Check that last label is shorter than 63 chars
      len - lastDotIndex - 1 <= 63 && // Check that the last character is an allowed trailing label character.
      // Since we already checked that the char is a valid hostname character,
      // we only need to check that it's different from '-'.
      lastCharCode !== 45
    );
  }

  // node_modules/tldts-core/dist/es6/src/options.js
  function setDefaultsImpl({ allowIcannDomains = true, allowPrivateDomains = false, detectIp = true, detectSpecialUse = false, extractHostname: extractHostname2 = true, mixedInputs = true, validHosts = null, validateHostname = true }) {
    return {
      allowIcannDomains,
      allowPrivateDomains,
      detectIp,
      detectSpecialUse,
      extractHostname: extractHostname2,
      mixedInputs,
      validHosts,
      validateHostname
    };
  }
  var DEFAULT_OPTIONS = (
    /*@__INLINE__*/
    setDefaultsImpl({})
  );
  function setDefaults(options) {
    if (options === void 0) {
      return DEFAULT_OPTIONS;
    }
    return (
      /*@__INLINE__*/
      setDefaultsImpl(options)
    );
  }

  // node_modules/tldts-core/dist/es6/src/subdomain.js
  function getSubdomain(hostname2, domain) {
    if (domain.length === hostname2.length) {
      return "";
    }
    return hostname2.slice(0, -domain.length - 1);
  }

  // node_modules/tldts-core/dist/es6/src/factory.js
  function getEmptyResult() {
    return {
      domain: null,
      domainWithoutSuffix: null,
      hostname: null,
      isIcann: null,
      isIp: null,
      isPrivate: null,
      isSpecialUse: null,
      publicSuffix: null,
      subdomain: null
    };
  }
  function parseImpl(url, step, suffixLookup2, partialOptions, result) {
    const options = (
      /*@__INLINE__*/
      setDefaults(partialOptions)
    );
    if (typeof url !== "string") {
      return result;
    }
    let urlIsValid = false;
    if (!options.extractHostname) {
      result.hostname = url;
    } else if (options.mixedInputs) {
      urlIsValid = is_valid_default(url);
      result.hostname = extractHostname(url, urlIsValid, options.validateHostname);
    } else {
      result.hostname = extractHostname(url, false, options.validateHostname);
    }
    if (options.detectIp && result.hostname !== null) {
      result.isIp = isIp(result.hostname);
      if (result.isIp) {
        return result;
      }
    }
    if (options.validateHostname && options.extractHostname && result.hostname !== null && // Skip the re-scan when `url` was already validated and extractHostname
    // returned it unchanged (same reference => identical string, still valid).
    !(urlIsValid && result.hostname === url) && // Skip the re-scan when extractHostname already validated the host inline
    // (a confirmed-valid simple authority — see extract-hostname.ts).
    !extractedHostnameValidated && !is_valid_default(result.hostname)) {
      result.hostname = null;
      return result;
    }
    if (step === 0 || result.hostname === null) {
      return result;
    }
    if (step === 5 && options.detectSpecialUse) {
      result.isSpecialUse = isSpecialUse(result.hostname);
    }
    suffixLookup2(result.hostname, options, result);
    if (step === 2 || result.publicSuffix === null) {
      return result;
    }
    result.domain = getDomain(result.publicSuffix, result.hostname, options);
    if (step === 3 || result.domain === null) {
      return result;
    }
    result.subdomain = getSubdomain(result.hostname, result.domain);
    if (step === 4) {
      return result;
    }
    result.domainWithoutSuffix = getDomainWithoutSuffix(result.domain, result.publicSuffix);
    return result;
  }

  // node_modules/tldts-core/dist/es6/src/lookup/fast-path.js
  function fast_path_default(hostname2, options, out) {
    if (!options.allowPrivateDomains && hostname2.length > 3) {
      const last = hostname2.length - 1;
      const c3 = hostname2.charCodeAt(last);
      const c2 = hostname2.charCodeAt(last - 1);
      const c1 = hostname2.charCodeAt(last - 2);
      const c0 = hostname2.charCodeAt(last - 3);
      if (c3 === 109 && c2 === 111 && c1 === 99 && c0 === 46) {
        out.isIcann = true;
        out.isPrivate = false;
        out.publicSuffix = "com";
        return true;
      } else if (c3 === 103 && c2 === 114 && c1 === 111 && c0 === 46) {
        out.isIcann = true;
        out.isPrivate = false;
        out.publicSuffix = "org";
        return true;
      } else if (c3 === 117 && c2 === 100 && c1 === 101 && c0 === 46) {
        out.isIcann = true;
        out.isPrivate = false;
        out.publicSuffix = "edu";
        return true;
      } else if (c3 === 118 && c2 === 111 && c1 === 103 && c0 === 46) {
        out.isIcann = true;
        out.isPrivate = false;
        out.publicSuffix = "gov";
        return true;
      } else if (c3 === 116 && c2 === 101 && c1 === 110 && c0 === 46) {
        out.isIcann = true;
        out.isPrivate = false;
        out.publicSuffix = "net";
        return true;
      } else if (c3 === 101 && c2 === 100 && c1 === 46) {
        out.isIcann = true;
        out.isPrivate = false;
        out.publicSuffix = "de";
        return true;
      }
    }
    return false;
  }

  // node_modules/tldts/dist/es6/src/data/trie.js
  var nodeFlags = /* @__PURE__ */ new Uint8Array([1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 2, 2, 2, 0, 2, 2, 0, 2, 0, 0, 1, 0, 0, 2, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 2, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 2, 2, 0, 0, 0, 2, 0, 1, 1, 0, 2, 0, 2, 2, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 2, 2, 0, 2, 2, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 2, 2, 0, 2, 2, 2, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 2, 2, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 2, 2, 0, 0, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 2, 2, 1, 2, 1, 1, 1, 2, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 2, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
  var edgeStart = /* @__PURE__ */ new Uint16Array([0, 0, 0, 10, 11, 18, 106, 111, 117, 124, 130, 136, 145, 146, 147, 148, 149, 150, 151, 153, 154, 155, 157, 159, 227, 240, 242, 243, 244, 259, 266, 267, 270, 271, 272, 275, 277, 296, 297, 299, 308, 313, 330, 331, 334, 336, 337, 339, 373, 374, 376, 379, 380, 384, 386, 390, 393, 425, 428, 441, 442, 450, 451, 453, 463, 477, 478, 479, 480, 489, 490, 527, 532, 548, 568, 574, 616, 617, 644, 671, 672, 820, 826, 829, 830, 831, 836, 841, 850, 872, 873, 874, 875, 876, 877, 878, 896, 898, 899, 902, 904, 905, 907, 909, 924, 939, 944, 945, 947, 948, 949, 950, 951, 953, 956, 961, 962, 963, 965, 966, 969, 972, 973, 974, 987, 989, 1001, 1012, 1020, 1022, 1063, 1066, 1070, 1071, 1073, 1076, 1087, 1089, 1099, 1101, 1107, 1109, 1110, 1112, 1115, 1116, 1117, 1170, 1172, 1174, 1194, 1195, 1196, 1197, 1199, 1210, 1241, 1252, 1264, 1273, 1280, 1285, 1298, 1309, 1322, 1323, 1334, 1368, 1369, 1370, 1385, 1400, 1472, 1473, 1475, 1476, 1510, 1511, 1512, 1513, 1516, 1520, 1523, 1525, 1554, 1555, 1563, 1564, 1565, 1566, 1568, 1570, 1571, 1573, 1574, 1575, 1586, 1587, 1588, 1589, 1590, 1591, 1592, 1593, 1594, 1595, 1596, 1597, 1598, 1599, 1601, 1602, 1603, 2057, 2060, 2061, 2063, 2070, 2077, 2087, 2091, 2102, 2103, 2104, 2116, 2117, 2119, 2121, 2122, 2129, 2130, 2132, 2133, 2135, 2136, 2137, 2138, 2139, 2213, 2215, 2236, 2237, 2238, 2240, 2266, 2267, 2318, 2319, 2321, 2328, 2334, 2344, 2354, 2407, 2408, 2409, 2419, 2433, 2434, 2437, 2444, 2445, 2453, 2454, 2455, 2456, 2457, 2468, 2469, 2470, 2472, 2473, 2474, 2483, 2495, 2501, 2533, 2537, 2539, 2540, 2542, 2543, 2554, 2555, 2557, 2565, 2572, 2578, 2583, 2584, 2590, 2593, 2599, 2606, 2607, 2614, 2622, 2623, 2624, 2662, 2668, 2683, 2684, 2689, 2707, 2738, 2756, 2758, 2761, 2769, 2771, 2778, 2830, 2854, 2855, 2856, 2857, 2858, 2859, 2860, 2867, 2868, 2869, 2870, 2871, 2872, 2874, 2875, 2879, 2959, 2972, 2973, 3410, 3414, 3428, 3480, 3508, 3530, 3588, 3610, 3625, 3688, 3739, 3777, 3813, 3838, 3980, 4026, 4077, 4096, 4130, 4145, 4165, 4195, 4226, 4249, 4280, 4310, 4342, 4369, 4444, 4466, 4504, 4514, 4548, 4567, 4593, 4635, 4685, 4711, 4780, 4781, 4783, 4806, 4829, 4865, 4896, 4913, 4970, 4983, 5007, 5036, 5038, 5072, 5088, 5116, 5421, 5430, 5439, 5446, 5463, 5467, 5473, 5512, 5514, 5521, 5528, 5537, 5544, 5545, 5546, 5558, 5561, 5576, 5577, 5586, 5587, 5596, 5605, 5611, 5613, 5614, 5615, 5652, 5653, 5655, 5663, 5670, 5683, 5687, 5689, 5690, 5696, 5703, 5717, 5727, 5732, 5740, 5748, 5754, 5755, 5759, 5761, 5762, 5774, 5846, 5847, 5848, 5849, 5851, 5852, 5855, 5857, 5860, 5864, 5865, 5866, 5872, 5873, 5874, 5876, 5878, 5880, 5881, 5882, 5885, 5887, 5890, 5891, 5893, 6091, 6098, 6099, 6100, 6110, 6115, 6132, 6146, 6155, 6156, 6157, 6161, 6162, 6164, 6166, 6172, 6173, 6176, 6177, 6179, 6180, 6181, 7081, 7084, 7088, 7106, 7115, 7118, 7125, 7126, 7128, 7129, 7130, 7132, 7184, 7185, 7188, 7189, 7306, 7307, 7318, 7329, 7336, 7339, 7348, 7349, 7350, 7365, 7420, 7612, 7614, 7615, 7617, 7622, 7635, 7650, 7657, 7666, 7669, 7672, 7679, 7687, 7691, 7692, 7693, 7707, 7711, 7720, 7721, 7722, 7726, 7761, 7762, 7780, 7787, 7795, 7796, 7801, 7809, 7853, 7854, 7860, 7863, 7875, 7880, 7881, 7884, 7886, 7921, 7922, 7928, 7935, 7936, 7945, 7954, 7969, 7973, 7974, 8026, 8027, 8032, 8034, 8037, 8039, 8040, 8041, 8050, 8064, 8072, 8086, 8098, 8099, 8101, 8103, 8125, 8136, 8142, 8143, 8155, 8167, 8254, 8266, 8274, 8277, 8283, 8308, 8311, 8312, 8313, 8314, 8316, 8319, 8322, 8333, 8335, 8337, 8365, 8440, 8447, 8451, 8452, 8461, 8483, 8484, 8489, 8490, 8569, 8571, 8573, 8582, 8586, 8592, 8598, 8604, 8614, 8619, 8620, 8638, 8649, 8654, 8659, 8669, 8675, 8679, 8685, 8691, 10300, 10301, 10302, 10309, 10311]);
  var edgeLength = /* @__PURE__ */ new Uint8Array([3, 3, 3, 3, 3, 3, 3, 3, 5, 8, 8, 2, 2, 3, 3, 3, 3, 3, 8, 5, 5, 5, 5, 5, 3, 3, 5, 5, 9, 12, 19, 8, 19, 8, 11, 9, 9, 8, 7, 7, 6, 8, 9, 16, 10, 7, 7, 11, 8, 6, 6, 9, 7, 11, 7, 14, 4, 4, 4, 4, 4, 4, 10, 7, 6, 6, 6, 6, 10, 10, 6, 10, 10, 22, 11, 9, 10, 10, 10, 9, 10, 8, 7, 7, 7, 8, 21, 13, 11, 11, 9, 10, 9, 13, 10, 8, 8, 9, 12, 9, 7, 10, 7, 7, 13, 7, 3, 3, 3, 3, 3, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 8, 6, 3, 3, 3, 3, 3, 3, 2, 5, 3, 3, 3, 7, 2, 2, 2, 2, 2, 2, 3, 3, 3, 1, 1, 7, 8, 5, 2, 2, 7, 2, 2, 1, 4, 1, 11, 9, 9, 5, 5, 8, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3, 3, 3, 5, 11, 9, 9, 13, 7, 14, 7, 6, 6, 6, 7, 6, 6, 6, 6, 6, 10, 7, 11, 9, 4, 4, 4, 4, 4, 6, 6, 6, 6, 13, 6, 8, 7, 10, 9, 9, 7, 9, 8, 9, 8, 7, 10, 6, 9, 8, 10, 10, 7, 8, 1, 9, 10, 12, 12, 12, 10, 9, 9, 10, 10, 9, 9, 1, 1, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 6, 6, 6, 4, 3, 3, 3, 7, 4, 4, 4, 3, 3, 6, 7, 3, 4, 1, 2, 2, 2, 6, 1, 2, 2, 2, 2, 2, 12, 5, 3, 8, 9, 13, 4, 4, 13, 9, 9, 11, 7, 3, 12, 9, 2, 2, 2, 3, 3, 3, 3, 3, 8, 2, 2, 3, 3, 3, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 3, 7, 10, 15, 7, 15, 15, 20, 15, 9, 10, 10, 12, 14, 14, 14, 12, 12, 12, 12, 12, 14, 14, 10, 10, 10, 10, 14, 9, 9, 9, 10, 14, 14, 14, 13, 13, 9, 9, 9, 9, 9, 9, 7, 8, 6, 8, 8, 6, 8, 13, 8, 8, 6, 13, 8, 11, 13, 8, 6, 13, 8, 6, 9, 10, 10, 12, 14, 14, 14, 12, 12, 12, 12, 14, 14, 10, 10, 10, 10, 9, 9, 9, 10, 14, 14, 11, 13, 13, 9, 9, 9, 9, 9, 9, 2, 6, 9, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 2, 3, 3, 3, 3, 3, 3, 7, 7, 2, 3, 2, 2, 5, 3, 3, 3, 3, 3, 3, 4, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 5, 7, 4, 2, 2, 12, 8, 10, 8, 10, 7, 18, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 5, 2, 2, 3, 3, 3, 5, 5, 3, 8, 8, 6, 8, 6, 6, 4, 6, 7, 7, 7, 10, 11, 2, 5, 5, 3, 3, 3, 3, 3, 3, 5, 5, 6, 11, 10, 7, 7, 7, 4, 4, 4, 2, 3, 3, 3, 3, 3, 2, 2, 7, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 7, 7, 7, 11, 7, 6, 9, 6, 6, 8, 10, 8, 6, 8, 13, 4, 4, 4, 4, 4, 10, 8, 11, 8, 8, 8, 10, 10, 7, 10, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 7, 10, 13, 7, 8, 7, 11, 8, 8, 6, 9, 8, 8, 6, 6, 6, 8, 8, 6, 6, 6, 6, 6, 9, 7, 6, 4, 4, 4, 4, 4, 4, 4, 6, 6, 6, 9, 7, 8, 10, 8, 8, 2, 3, 3, 3, 3, 3, 2, 8, 9, 9, 2, 2, 2, 3, 3, 3, 2, 3, 3, 3, 9, 2, 2, 3, 3, 3, 3, 3, 3, 5, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 12, 5, 5, 3, 5, 4, 2, 3, 2, 4, 3, 9, 2, 2, 2, 2, 2, 5, 5, 3, 8, 8, 13, 6, 10, 9, 4, 7, 9, 11, 2, 3, 7, 3, 3, 4, 1, 3, 4, 2, 9, 3, 3, 12, 5, 3, 7, 10, 10, 7, 4, 4, 6, 14, 7, 9, 7, 13, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 8, 15, 4, 4, 2, 3, 3, 3, 7, 4, 9, 9, 2, 3, 3, 3, 5, 3, 2, 2, 7, 2, 7, 6, 6, 7, 2, 4, 2, 2, 2, 2, 2, 2, 8, 8, 8, 9, 5, 2, 3, 3, 3, 3, 3, 3, 10, 7, 4, 4, 4, 4, 3, 4, 2, 3, 3, 3, 3, 3, 10, 7, 4, 4, 4, 4, 2, 3, 3, 3, 3, 10, 7, 4, 4, 4, 4, 3, 9, 6, 6, 6, 9, 13, 9, 2, 2, 2, 8, 7, 9, 5, 3, 3, 3, 5, 5, 13, 12, 9, 10, 7, 8, 7, 6, 8, 6, 11, 12, 7, 9, 10, 4, 4, 7, 8, 11, 6, 7, 9, 8, 7, 10, 8, 9, 15, 7, 8, 5, 4, 7, 2, 3, 3, 3, 2, 14, 10, 2, 14, 10, 2, 14, 3, 9, 13, 13, 10, 14, 16, 17, 11, 2, 14, 2, 14, 3, 9, 13, 10, 14, 16, 17, 11, 14, 10, 14, 2, 7, 3, 10, 7, 14, 10, 2, 14, 10, 9, 9, 17, 6, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 10, 10, 10, 12, 9, 4, 10, 10, 11, 8, 8, 8, 7, 9, 5, 3, 3, 3, 3, 3, 3, 3, 3, 5, 8, 4, 4, 4, 4, 4, 4, 6, 16, 3, 3, 14, 3, 14, 2, 14, 9, 13, 10, 10, 14, 16, 17, 11, 6, 9, 10, 10, 12, 14, 14, 14, 12, 12, 12, 12, 14, 14, 10, 10, 10, 10, 14, 9, 9, 9, 10, 14, 14, 14, 9, 9, 9, 9, 9, 9, 2, 14, 9, 13, 10, 10, 14, 16, 17, 11, 6, 2, 14, 9, 17, 13, 10, 10, 14, 16, 17, 11, 6, 2, 14, 9, 13, 10, 14, 16, 17, 11, 2, 14, 9, 13, 10, 16, 11, 2, 14, 10, 19, 7, 2, 14, 9, 13, 10, 19, 10, 7, 14, 16, 17, 11, 6, 2, 14, 9, 13, 10, 19, 7, 14, 16, 17, 11, 2, 14, 9, 13, 17, 13, 10, 10, 14, 16, 17, 11, 6, 3, 2, 14, 9, 13, 10, 10, 14, 16, 17, 11, 6, 9, 10, 12, 14, 14, 14, 12, 12, 12, 12, 12, 14, 14, 14, 10, 10, 10, 14, 9, 9, 9, 9, 14, 14, 14, 13, 13, 14, 9, 9, 9, 9, 9, 9, 4, 11, 2, 14, 9, 13, 17, 13, 10, 19, 10, 7, 14, 16, 17, 11, 6, 2, 14, 9, 13, 17, 13, 10, 19, 10, 7, 14, 16, 17, 11, 6, 2, 9, 10, 10, 7, 17, 3, 3, 12, 12, 16, 15, 15, 12, 14, 14, 14, 20, 20, 13, 12, 12, 12, 12, 12, 12, 20, 25, 14, 14, 12, 12, 10, 10, 10, 10, 9, 9, 9, 25, 4, 9, 17, 10, 7, 14, 16, 21, 13, 13, 14, 20, 14, 13, 17, 24, 9, 12, 13, 25, 13, 21, 20, 17, 9, 9, 9, 9, 9, 9, 12, 17, 4, 4, 9, 9, 9, 10, 10, 12, 14, 14, 14, 12, 12, 12, 12, 12, 14, 14, 10, 10, 10, 10, 14, 9, 9, 9, 10, 14, 14, 14, 13, 13, 9, 9, 9, 9, 9, 9, 1, 5, 8, 7, 11, 11, 1, 3, 3, 3, 5, 3, 3, 4, 8, 9, 10, 14, 14, 12, 12, 12, 12, 14, 14, 10, 10, 10, 10, 14, 9, 9, 9, 10, 14, 14, 14, 13, 13, 9, 9, 9, 9, 9, 7, 4, 4, 4, 4, 4, 4, 4, 4, 4, 7, 4, 9, 12, 6, 14, 4, 12, 7, 2, 2, 1, 2, 7, 6, 4, 4, 4, 6, 8, 8, 7, 4, 5, 6, 3, 3, 3, 3, 4, 16, 8, 5, 4, 3, 3, 3, 5, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 11, 12, 7, 7, 13, 9, 10, 17, 12, 8, 9, 7, 8, 5, 12, 10, 13, 14, 5, 5, 5, 13, 5, 5, 5, 3, 3, 3, 5, 16, 5, 5, 5, 5, 7, 12, 14, 8, 12, 8, 10, 12, 9, 11, 7, 9, 7, 10, 7, 13, 9, 7, 12, 8, 17, 7, 7, 16, 10, 13, 13, 8, 10, 10, 14, 17, 7, 16, 16, 15, 8, 10, 10, 12, 17, 17, 7, 17, 14, 7, 10, 17, 8, 7, 7, 7, 8, 15, 15, 7, 14, 10, 10, 10, 11, 11, 7, 7, 13, 8, 10, 7, 16, 7, 8, 7, 14, 17, 12, 10, 11, 21, 8, 9, 7, 13, 9, 8, 13, 6, 12, 7, 6, 13, 10, 10, 10, 8, 18, 9, 17, 13, 10, 12, 6, 13, 6, 11, 8, 13, 10, 13, 18, 13, 11, 13, 8, 16, 7, 10, 8, 16, 12, 10, 8, 8, 14, 11, 8, 15, 8, 8, 7, 7, 12, 7, 8, 9, 14, 15, 8, 9, 10, 9, 15, 7, 8, 8, 12, 13, 9, 10, 15, 13, 7, 10, 10, 20, 7, 6, 9, 6, 6, 14, 11, 14, 11, 12, 9, 10, 16, 16, 12, 7, 11, 28, 8, 11, 10, 7, 21, 8, 7, 9, 4, 4, 4, 17, 7, 8, 6, 9, 6, 6, 13, 6, 6, 6, 6, 18, 20, 14, 8, 11, 12, 9, 10, 13, 15, 15, 19, 8, 9, 12, 7, 10, 16, 12, 9, 9, 9, 14, 12, 11, 9, 12, 11, 18, 9, 9, 9, 10, 7, 7, 16, 8, 9, 7, 13, 12, 10, 14, 18, 7, 8, 11, 7, 7, 8, 8, 13, 7, 7, 7, 11, 15, 13, 11, 7, 8, 15, 11, 7, 8, 18, 14, 13, 18, 15, 10, 12, 12, 9, 7, 11, 11, 8, 7, 10, 8, 14, 12, 10, 18, 7, 10, 9, 7, 8, 13, 10, 14, 10, 8, 8, 23, 7, 7, 11, 12, 12, 17, 7, 7, 11, 11, 17, 16, 16, 7, 8, 11, 14, 14, 8, 10, 7, 7, 16, 16, 13, 9, 11, 9, 15, 15, 11, 11, 7, 7, 14, 7, 9, 7, 7, 16, 10, 13, 10, 11, 14, 7, 11, 10, 11, 7, 11, 10, 11, 15, 11, 15, 10, 12, 10, 14, 13, 11, 11, 12, 13, 10, 7, 13, 10, 16, 12, 21, 9, 10, 10, 7, 11, 14, 17, 7, 7, 8, 11, 12, 8, 15, 14, 14, 8, 17, 12, 10, 10, 7, 9, 11, 7, 10, 7, 11, 18, 7, 11, 7, 12, 11, 8, 8, 14, 12, 7, 8, 15, 3, 7, 7, 5, 2, 9, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 2, 5, 3, 3, 3, 3, 3, 3, 4, 4, 3, 3, 3, 3, 3, 3, 5, 11, 6, 4, 7, 10, 7, 7, 11, 1, 10, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 5, 7, 3, 5, 6, 3, 3, 5, 2, 2, 5, 3, 4, 13, 11, 3, 3, 6, 3, 5, 14, 2, 2, 3, 8, 2, 2, 12, 5, 18, 5, 3, 3, 3, 16, 5, 5, 5, 10, 7, 13, 12, 13, 9, 12, 14, 19, 9, 9, 21, 9, 9, 10, 6, 9, 6, 15, 10, 6, 12, 8, 6, 10, 15, 4, 4, 6, 6, 9, 9, 12, 16, 14, 23, 7, 7, 7, 14, 9, 7, 7, 11, 14, 10, 7, 10, 10, 10, 12, 6, 11, 10, 13, 11, 15, 11, 7, 12, 10, 3, 7, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 4, 3, 7, 2, 5, 5, 3, 3, 5, 5, 5, 5, 7, 6, 6, 6, 4, 4, 4, 4, 4, 4, 6, 6, 6, 6, 6, 7, 10, 2, 2, 2, 5, 5, 5, 5, 3, 3, 3, 3, 3, 5, 5, 10, 9, 11, 8, 7, 12, 8, 9, 7, 6, 13, 11, 6, 13, 7, 9, 9, 4, 4, 4, 4, 4, 6, 10, 7, 8, 13, 8, 8, 9, 14, 7, 8, 10, 7, 7, 7, 9, 6, 9, 7, 2, 12, 5, 3, 3, 13, 4, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 5, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 8, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 9, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 2, 2, 2, 5, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 1, 7, 6, 4, 12, 3, 3, 3, 3, 3, 8, 7, 3, 3, 3, 3, 3, 3, 4, 4, 11, 14, 2, 8, 3, 5, 5, 8, 10, 8, 6, 4, 7, 17, 7, 4, 5, 2, 6, 3, 2, 2, 12, 5, 5, 3, 15, 13, 8, 11, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 5, 3, 3, 3, 3, 4, 18, 2, 12, 5, 3, 3, 3, 3, 3, 5, 16, 8, 8, 9, 6, 6, 4, 4, 4, 4, 31, 6, 6, 10, 11, 21, 10, 9, 7, 10, 7, 7, 2, 4, 4, 4, 4, 6, 5, 3, 3, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 6, 6, 6, 2, 2, 2, 5, 3, 3, 3, 7, 7, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 3, 3, 3, 3, 8, 2, 3, 3, 3, 3, 3, 5, 9, 11, 3, 3, 3, 3, 4, 4, 3, 3, 3, 3, 3, 5, 10, 9, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 2, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 11, 10, 10, 10, 10, 10, 11, 10, 11, 10, 11, 10, 9, 9, 11, 3, 3, 3, 3, 3, 3, 5, 3, 7, 8, 8, 7, 6, 6, 11, 4, 4, 4, 7, 8, 9, 9, 2, 3, 7, 4, 4, 2, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 2, 2, 5, 5, 5, 5, 5, 3, 3, 5, 5, 5, 7, 7, 6, 6, 6, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 6, 6, 8, 8, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 6, 9, 12, 3, 7, 10, 7, 2, 2, 3, 3, 3, 3, 3, 4, 3, 3, 2, 2, 2, 2, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 5, 8, 8, 6, 6, 8, 6, 7, 4, 4, 4, 4, 4, 4, 6, 7, 5, 5, 20, 19, 8, 10, 9, 7, 10, 6, 8, 11, 6, 6, 6, 6, 13, 12, 8, 6, 7, 14, 11, 9, 2, 5, 3, 6, 2, 3, 2, 2, 2, 2, 2, 2, 2, 5, 4, 3, 7, 6, 4, 7, 4, 3, 6, 4, 7, 2, 7, 7, 7, 5, 5, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 9, 10, 10, 11, 7, 8, 20, 7, 8, 9, 8, 12, 6, 6, 6, 8, 9, 8, 12, 6, 6, 8, 13, 10, 12, 6, 6, 7, 7, 9, 6, 4, 4, 4, 4, 4, 4, 10, 6, 6, 6, 7, 14, 11, 10, 7, 8, 10, 8, 11, 14, 11, 11, 9, 7, 9, 8, 11, 9, 17, 10, 9, 2, 2, 2, 9, 3, 3, 3, 3, 15, 14, 9, 5, 5, 2, 8, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 15, 12, 22, 19, 17, 18, 18, 19, 21, 7, 16, 16, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 7, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 9, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 7, 16, 11, 11, 7, 7, 7, 7, 17, 7, 8, 12, 15, 9, 19, 7, 19, 8, 21, 11, 12, 19, 14, 22, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 16, 16, 19, 24, 12, 7, 14, 7, 12, 7, 8, 10, 10, 13, 7, 12, 12, 7, 7, 10, 18, 15, 12, 16, 7, 14, 12, 17, 10, 16, 17, 12, 17, 25, 7, 7, 7, 13, 6, 9, 6, 9, 18, 6, 6, 11, 20, 10, 6, 6, 6, 6, 6, 6, 17, 6, 6, 6, 15, 6, 6, 6, 6, 6, 8, 14, 11, 12, 11, 15, 13, 19, 17, 21, 7, 18, 8, 13, 13, 8, 12, 8, 6, 6, 13, 6, 15, 15, 16, 6, 6, 16, 6, 6, 6, 14, 6, 18, 6, 6, 6, 17, 18, 9, 13, 15, 8, 19, 8, 15, 15, 18, 14, 16, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 6, 11, 10, 11, 6, 21, 23, 12, 17, 12, 11, 14, 13, 22, 15, 15, 11, 12, 14, 12, 7, 12, 8, 12, 14, 12, 18, 10, 8, 16, 19, 17, 12, 14, 15, 8, 19, 17, 12, 13, 13, 15, 18, 13, 23, 24, 23, 21, 17, 24, 8, 21, 8, 14, 14, 16, 20, 14, 8, 8, 15, 20, 8, 19, 21, 9, 8, 13, 12, 13, 15, 11, 8, 11, 9, 9, 8, 11, 8, 21, 14, 21, 15, 15, 13, 7, 19, 7, 7, 7, 7, 7, 7, 16, 12, 17, 18, 7, 7, 11, 11, 7, 9, 9, 2, 2, 3, 3, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 10, 10, 7, 9, 7, 7, 7, 6, 8, 6, 6, 6, 6, 6, 6, 6, 7, 6, 8, 6, 6, 9, 7, 7, 7, 4, 4, 4, 4, 4, 4, 4, 4, 8, 9, 8, 7, 8, 7, 8, 10, 7, 5, 5, 5, 5, 5, 5, 3, 9, 7, 7, 8, 6, 6, 6, 6, 6, 6, 6, 6, 9, 6, 6, 9, 11, 13, 7, 8, 9, 9, 5, 5, 5, 7, 8, 6, 6, 6, 6, 6, 6, 6, 7, 8, 9, 7, 10, 9, 10, 7, 8, 5, 5, 5, 5, 5, 5, 7, 7, 9, 8, 7, 7, 6, 6, 6, 6, 6, 6, 10, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 9, 10, 4, 4, 4, 4, 8, 7, 7, 10, 10, 9, 8, 8, 15, 9, 8, 8, 8, 8, 8, 9, 10, 9, 10, 7, 8, 13, 5, 5, 5, 5, 5, 3, 3, 7, 7, 8, 6, 6, 6, 4, 4, 11, 9, 7, 8, 9, 10, 7, 5, 5, 5, 5, 5, 3, 3, 7, 6, 6, 13, 7, 9, 8, 7, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3, 3, 7, 8, 7, 8, 13, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 8, 8, 6, 6, 6, 6, 7, 6, 7, 6, 6, 9, 7, 4, 4, 4, 4, 4, 4, 4, 7, 8, 7, 8, 9, 8, 8, 8, 7, 10, 7, 8, 5, 5, 5, 5, 5, 5, 5, 5, 3, 7, 7, 7, 7, 9, 7, 10, 9, 6, 6, 6, 6, 6, 8, 8, 6, 6, 6, 7, 6, 6, 6, 9, 9, 4, 4, 13, 7, 10, 9, 9, 12, 7, 8, 8, 10, 8, 8, 8, 8, 8, 8, 5, 5, 5, 5, 3, 7, 7, 11, 7, 9, 8, 8, 6, 6, 10, 6, 8, 8, 8, 6, 7, 6, 6, 12, 4, 4, 4, 4, 4, 4, 4, 4, 4, 9, 8, 8, 16, 8, 9, 8, 7, 5, 5, 5, 5, 5, 3, 3, 7, 7, 7, 10, 15, 8, 9, 8, 9, 9, 6, 6, 6, 6, 6, 6, 7, 4, 8, 7, 8, 8, 7, 8, 11, 8, 5, 5, 5, 5, 5, 3, 7, 7, 6, 11, 16, 7, 6, 4, 4, 4, 4, 9, 9, 8, 8, 8, 13, 12, 8, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 11, 7, 8, 8, 9, 13, 7, 7, 7, 9, 8, 8, 9, 12, 7, 12, 7, 12, 8, 7, 10, 12, 9, 9, 6, 6, 8, 8, 6, 6, 6, 6, 6, 6, 6, 9, 8, 9, 11, 8, 6, 6, 6, 6, 6, 12, 7, 6, 6, 6, 9, 7, 7, 6, 6, 6, 6, 6, 11, 9, 6, 6, 6, 6, 6, 7, 9, 4, 4, 4, 4, 4, 4, 4, 4, 9, 9, 9, 9, 7, 7, 7, 7, 7, 11, 7, 7, 8, 8, 8, 8, 8, 8, 9, 8, 9, 9, 7, 7, 11, 11, 7, 12, 8, 8, 8, 8, 8, 7, 8, 8, 8, 8, 8, 13, 12, 8, 8, 8, 8, 7, 7, 7, 9, 5, 5, 5, 5, 5, 5, 5, 3, 3, 7, 7, 11, 7, 8, 8, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 10, 11, 6, 7, 9, 4, 4, 4, 4, 4, 4, 9, 9, 8, 9, 8, 8, 8, 7, 7, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 11, 7, 7, 7, 9, 6, 6, 11, 8, 10, 6, 6, 6, 12, 8, 8, 7, 6, 6, 8, 7, 4, 4, 4, 4, 4, 4, 4, 4, 9, 10, 9, 9, 8, 10, 9, 11, 8, 5, 5, 5, 7, 6, 6, 8, 7, 4, 4, 4, 4, 8, 7, 7, 8, 7, 8, 8, 5, 5, 5, 5, 7, 7, 8, 8, 8, 6, 6, 6, 6, 6, 10, 8, 9, 13, 6, 7, 6, 6, 8, 7, 8, 4, 4, 4, 4, 11, 8, 8, 8, 10, 5, 5, 8, 7, 8, 13, 8, 7, 6, 8, 6, 9, 7, 8, 7, 5, 5, 5, 5, 5, 5, 3, 3, 7, 8, 9, 6, 4, 8, 10, 10, 8, 12, 9, 13, 2, 7, 5, 5, 5, 5, 5, 7, 7, 10, 6, 6, 6, 6, 6, 6, 6, 8, 4, 4, 9, 8, 8, 8, 14, 8, 8, 8, 9, 8, 5, 5, 5, 5, 5, 3, 3, 9, 6, 6, 6, 6, 10, 12, 6, 6, 6, 6, 6, 6, 6, 4, 4, 4, 4, 11, 8, 7, 8, 8, 8, 5, 5, 3, 3, 3, 3, 7, 7, 6, 8, 6, 8, 11, 7, 6, 6, 6, 7, 4, 8, 11, 9, 10, 5, 5, 5, 3, 3, 3, 7, 7, 8, 9, 8, 15, 9, 6, 6, 6, 6, 6, 6, 11, 11, 4, 4, 4, 4, 4, 7, 9, 9, 10, 8, 7, 5, 5, 5, 5, 5, 5, 3, 3, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 9, 7, 4, 4, 4, 4, 4, 9, 9, 8, 8, 10, 13, 5, 5, 5, 3, 17, 7, 7, 7, 7, 7, 8, 6, 8, 13, 6, 6, 6, 6, 6, 6, 6, 6, 4, 4, 4, 9, 10, 8, 8, 8, 5, 5, 5, 5, 3, 7, 7, 7, 8, 8, 6, 6, 6, 8, 8, 8, 9, 10, 8, 4, 8, 10, 9, 8, 8, 8, 9, 13, 10, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 7, 8, 9, 9, 7, 7, 7, 10, 9, 9, 8, 9, 8, 8, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 8, 12, 6, 6, 6, 6, 6, 6, 6, 6, 6, 12, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 11, 8, 8, 9, 9, 10, 8, 9, 7, 7, 5, 5, 5, 5, 5, 5, 3, 7, 8, 7, 6, 6, 8, 6, 6, 10, 4, 7, 8, 9, 12, 8, 7, 7, 5, 5, 5, 5, 5, 5, 3, 3, 7, 14, 7, 9, 8, 8, 6, 6, 8, 12, 12, 6, 6, 7, 7, 10, 4, 4, 4, 4, 4, 9, 9, 14, 9, 13, 8, 7, 5, 5, 5, 6, 6, 6, 7, 4, 8, 7, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 7, 7, 7, 8, 6, 6, 6, 6, 6, 6, 12, 6, 6, 6, 6, 4, 4, 9, 9, 8, 8, 11, 7, 7, 7, 5, 5, 5, 3, 9, 8, 6, 6, 7, 4, 4, 4, 4, 4, 4, 8, 8, 11, 5, 5, 5, 7, 7, 7, 9, 6, 6, 6, 6, 6, 6, 9, 8, 4, 4, 4, 4, 7, 12, 9, 8, 8, 8, 7, 10, 10, 5, 5, 5, 5, 5, 5, 5, 3, 11, 14, 8, 7, 8, 8, 6, 6, 6, 6, 6, 8, 7, 6, 6, 6, 7, 6, 8, 9, 4, 4, 4, 7, 8, 9, 7, 9, 7, 7, 9, 8, 5, 5, 5, 5, 5, 5, 5, 5, 5, 11, 3, 9, 7, 7, 12, 14, 8, 6, 6, 12, 11, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 15, 7, 4, 4, 4, 16, 9, 9, 9, 8, 9, 9, 9, 9, 9, 8, 8, 8, 13, 11, 8, 5, 5, 5, 5, 3, 7, 6, 6, 8, 8, 8, 6, 6, 7, 10, 7, 4, 4, 4, 4, 9, 7, 8, 7, 7, 7, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 7, 7, 7, 9, 6, 6, 6, 6, 6, 8, 8, 7, 7, 9, 6, 6, 6, 7, 6, 6, 6, 6, 6, 15, 4, 4, 4, 4, 4, 8, 8, 7, 8, 12, 9, 8, 8, 8, 8, 8, 9, 8, 8, 10, 8, 8, 8, 8, 16, 9, 10, 2, 5, 5, 5, 5, 5, 5, 5, 9, 7, 6, 8, 9, 4, 4, 4, 4, 4, 7, 8, 8, 8, 9, 8, 11, 10, 5, 5, 5, 5, 3, 7, 8, 6, 6, 6, 6, 6, 8, 6, 6, 6, 6, 4, 12, 10, 12, 7, 7, 7, 7, 7, 7, 7, 5, 5, 5, 5, 3, 3, 7, 7, 10, 8, 9, 7, 6, 10, 7, 6, 6, 4, 4, 8, 9, 7, 9, 9, 9, 9, 8, 8, 8, 8, 10, 5, 5, 5, 5, 5, 5, 8, 7, 6, 6, 6, 10, 6, 7, 10, 7, 4, 4, 4, 4, 4, 4, 4, 12, 9, 10, 7, 7, 10, 8, 10, 5, 12, 9, 6, 6, 6, 6, 6, 7, 6, 4, 4, 4, 10, 9, 9, 8, 7, 7, 5, 5, 5, 5, 5, 5, 3, 3, 13, 7, 7, 9, 7, 7, 7, 8, 9, 9, 7, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 13, 9, 15, 15, 4, 4, 4, 4, 4, 10, 10, 9, 8, 9, 8, 8, 9, 7, 8, 7, 8, 5, 5, 7, 6, 6, 6, 4, 4, 4, 7, 8, 11, 8, 5, 5, 5, 5, 5, 5, 5, 7, 6, 6, 6, 6, 6, 6, 9, 11, 10, 7, 4, 4, 4, 9, 8, 8, 5, 5, 5, 5, 5, 9, 9, 6, 6, 6, 6, 6, 6, 6, 9, 9, 4, 4, 4, 4, 8, 8, 8, 9, 9, 8, 8, 8, 13, 2, 4, 2, 7, 5, 5, 5, 5, 5, 5, 9, 9, 6, 6, 6, 6, 10, 8, 8, 8, 6, 6, 6, 4, 4, 9, 8, 10, 8, 9, 8, 8, 8, 9, 8, 8, 5, 3, 3, 3, 11, 6, 6, 6, 7, 6, 6, 6, 4, 4, 9, 8, 5, 5, 5, 5, 5, 3, 11, 8, 6, 6, 6, 6, 6, 9, 7, 4, 4, 14, 10, 9, 8, 12, 8, 8, 8, 11, 15, 8, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 11, 11, 11, 10, 10, 7, 7, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3, 7, 11, 7, 7, 11, 11, 7, 8, 9, 10, 7, 7, 9, 9, 9, 9, 7, 7, 10, 8, 13, 8, 8, 8, 8, 11, 10, 6, 6, 8, 10, 11, 14, 14, 6, 6, 6, 6, 6, 6, 9, 11, 7, 7, 6, 8, 12, 11, 11, 6, 6, 10, 6, 6, 6, 6, 6, 10, 7, 7, 6, 6, 11, 6, 6, 6, 11, 8, 9, 7, 6, 10, 11, 9, 10, 11, 7, 11, 8, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 8, 6, 6, 8, 9, 10, 9, 6, 6, 6, 10, 6, 6, 6, 6, 11, 10, 11, 10, 9, 8, 7, 7, 7, 7, 11, 14, 8, 10, 9, 9, 8, 8, 7, 11, 8, 8, 8, 11, 11, 10, 10, 9, 10, 8, 11, 10, 8, 11, 9, 12, 8, 10, 8, 11, 8, 9, 9, 11, 11, 10, 11, 13, 8, 7, 8, 8, 9, 7, 8, 8, 8, 8, 7, 8, 2, 2, 2, 2, 2, 2, 2, 4, 4, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 2, 3, 3, 3, 3, 3, 3, 3, 3, 8, 6, 4, 4, 4, 11, 7, 11, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 5, 5, 5, 5, 3, 3, 3, 3, 8, 7, 7, 8, 8, 4, 8, 7, 7, 7, 9, 7, 8, 9, 8, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 6, 3, 3, 3, 3, 3, 3, 3, 3, 4, 2, 2, 3, 3, 3, 3, 3, 3, 4, 5, 5, 3, 3, 8, 8, 6, 9, 4, 4, 10, 7, 3, 3, 3, 2, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 3, 2, 2, 2, 3, 3, 3, 3, 3, 4, 10, 2, 3, 3, 3, 3, 3, 3, 3, 4, 2, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 3, 3, 3, 5, 2, 4, 2, 6, 2, 2, 9, 5, 5, 3, 3, 3, 3, 3, 3, 3, 5, 5, 5, 9, 8, 7, 9, 6, 6, 11, 4, 4, 4, 4, 4, 4, 4, 4, 6, 6, 7, 7, 11, 8, 8, 6, 5, 11, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 2, 2, 3, 3, 3, 3, 3, 3, 6, 4, 4, 4, 4, 3, 3, 3, 3, 5, 7, 2, 3, 3, 3, 3, 3, 8, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 6, 4, 4, 4, 4, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 2, 2, 3, 3, 3, 3, 3, 3, 2, 3, 3, 3, 3, 3, 6, 3, 3, 8, 10, 3, 4, 4, 1, 1, 1, 1, 1, 1, 1, 8, 9, 10, 7, 7, 1, 14, 18, 13, 18, 13, 10, 10, 16, 13, 18, 16, 13, 16, 18, 13, 22, 16, 16, 16, 14, 21, 16, 9, 14, 16, 9, 9, 14, 10, 10, 14, 12, 14, 19, 12, 11, 18, 13, 17, 15, 15, 15, 15, 16, 14, 13, 19, 18, 15, 19, 18, 12, 18, 12, 11, 20, 14, 15, 10, 17, 17, 16, 19, 20, 21, 15, 13, 16, 15, 15, 15, 1, 1, 3, 8, 7, 7, 8, 8, 8, 1, 6, 1, 1, 6, 3, 3, 4, 7, 3, 3, 5, 5, 4, 4, 4, 4, 4, 2, 7, 7, 8, 12, 3, 4, 5, 1, 3, 4, 4, 10, 4, 3, 3, 3, 8, 7, 7, 2, 2, 2, 2, 2, 2, 2, 2, 2, 12, 9, 20, 7, 5, 5, 5, 9, 13, 5, 5, 5, 5, 5, 3, 3, 3, 16, 5, 5, 5, 13, 7, 8, 8, 11, 8, 7, 9, 7, 11, 12, 9, 9, 8, 8, 11, 10, 14, 7, 12, 10, 11, 13, 7, 9, 11, 17, 17, 14, 13, 7, 8, 7, 10, 10, 7, 16, 13, 7, 8, 17, 12, 9, 8, 6, 7, 10, 6, 6, 12, 6, 8, 10, 8, 8, 8, 6, 8, 6, 14, 6, 6, 6, 13, 6, 10, 6, 6, 7, 14, 8, 6, 6, 10, 11, 10, 9, 9, 7, 7, 6, 6, 6, 9, 9, 7, 9, 10, 9, 13, 12, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 6, 6, 6, 8, 8, 6, 8, 9, 10, 9, 7, 10, 10, 8, 7, 8, 7, 10, 12, 9, 8, 15, 8, 7, 8, 8, 7, 7, 15, 13, 7, 10, 9, 14, 18, 16, 7, 24, 7, 8, 10, 11, 16, 8, 14, 7, 9, 9, 9, 13, 19, 14, 15, 14, 11, 7, 13, 9, 10, 7, 13, 9, 10, 11, 12, 8, 9, 2, 3, 5, 8, 7, 4, 4, 15, 10, 5, 3, 3, 3, 3, 3, 5, 4, 4, 4, 2, 2, 2, 2, 2, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 2, 12, 5, 3, 8, 10, 15, 6, 7, 2, 3, 2, 5, 5, 12, 2, 5, 5, 5, 5, 2, 2, 5, 5, 12, 9, 5, 2, 2, 9, 5, 5, 12, 12, 5, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 9, 12, 5, 8, 8, 9, 5, 5, 5, 8, 19, 7, 16, 15, 14, 9, 9, 9, 9, 7, 11, 11, 11, 7, 14, 10, 10, 5, 5, 5, 5, 5, 5, 5, 5, 5, 15, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 9, 9, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 14, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 15, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 5, 5, 5, 5, 5, 5, 12, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 9, 9, 12, 9, 9, 12, 12, 12, 15, 7, 11, 7, 14, 11, 18, 13, 8, 18, 15, 18, 12, 14, 12, 8, 8, 8, 8, 9, 9, 9, 12, 7, 10, 10, 8, 8, 12, 12, 12, 7, 12, 12, 9, 7, 7, 7, 7, 7, 8, 15, 12, 9, 10, 10, 7, 10, 10, 13, 11, 10, 9, 22, 11, 9, 8, 8, 8, 8, 8, 13, 18, 13, 9, 15, 19, 9, 7, 7, 10, 7, 7, 7, 11, 8, 13, 17, 7, 7, 10, 10, 10, 7, 20, 16, 7, 7, 7, 7, 7, 7, 11, 21, 12, 12, 13, 11, 14, 16, 8, 8, 13, 11, 7, 7, 13, 7, 7, 14, 15, 15, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 13, 10, 18, 6, 6, 6, 6, 6, 6, 6, 6, 6, 11, 8, 8, 12, 12, 11, 11, 8, 12, 9, 9, 9, 13, 13, 9, 9, 9, 9, 9, 9, 6, 10, 12, 6, 6, 6, 6, 17, 11, 7, 7, 7, 7, 14, 14, 12, 6, 7, 7, 6, 6, 15, 10, 13, 10, 6, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 13, 9, 9, 15, 13, 6, 12, 12, 6, 19, 11, 10, 7, 7, 16, 8, 19, 17, 9, 9, 9, 9, 9, 6, 6, 6, 10, 8, 16, 8, 6, 6, 9, 6, 6, 6, 6, 6, 6, 6, 6, 8, 8, 8, 6, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 14, 6, 6, 6, 6, 20, 6, 9, 6, 14, 9, 9, 9, 6, 9, 8, 8, 12, 9, 8, 8, 8, 8, 7, 8, 12, 7, 8, 8, 8, 6, 8, 6, 6, 6, 6, 6, 6, 6, 9, 8, 8, 6, 6, 13, 9, 12, 13, 12, 14, 13, 12, 11, 11, 6, 8, 8, 8, 6, 13, 12, 11, 11, 12, 6, 11, 12, 11, 13, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 15, 6, 6, 6, 6, 6, 6, 6, 13, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 8, 8, 8, 8, 6, 18, 6, 12, 13, 13, 13, 9, 10, 15, 9, 12, 6, 6, 6, 6, 6, 6, 6, 6, 9, 15, 10, 9, 10, 13, 9, 19, 8, 18, 17, 10, 10, 8, 8, 6, 6, 6, 6, 6, 6, 10, 14, 8, 16, 16, 9, 8, 15, 8, 8, 10, 12, 14, 7, 7, 8, 8, 7, 7, 7, 7, 8, 13, 13, 11, 9, 9, 9, 12, 10, 17, 8, 11, 9, 7, 7, 14, 8, 14, 14, 7, 7, 7, 7, 7, 7, 14, 7, 7, 7, 7, 7, 10, 10, 8, 14, 7, 7, 7, 7, 8, 8, 8, 8, 8, 17, 9, 7, 15, 7, 8, 12, 7, 9, 14, 7, 7, 7, 9, 13, 8, 14, 7, 16, 18, 13, 15, 14, 12, 13, 10, 15, 9, 7, 7, 7, 10, 13, 15, 15, 9, 9, 9, 9, 19, 11, 7, 11, 11, 13, 8, 8, 8, 8, 7, 12, 19, 17, 9, 9, 13, 7, 7, 7, 9, 7, 7, 7, 12, 13, 15, 10, 8, 8, 14, 15, 12, 13, 13, 8, 12, 14, 7, 11, 7, 14, 15, 13, 12, 8, 8, 8, 8, 11, 13, 15, 15, 8, 13, 12, 8, 8, 8, 13, 10, 16, 14, 11, 8, 8, 12, 12, 9, 15, 15, 12, 12, 13, 8, 8, 9, 12, 13, 9, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 11, 12, 11, 7, 14, 7, 13, 13, 13, 12, 18, 16, 7, 12, 11, 10, 10, 15, 9, 9, 9, 21, 7, 7, 7, 11, 16, 8, 8, 11, 11, 7, 7, 7, 7, 7, 19, 7, 7, 7, 7, 7, 7, 7, 7, 7, 12, 8, 9, 12, 14, 11, 9, 9, 9, 22, 12, 3, 3, 4, 8, 8, 15, 4, 2, 2, 5, 5, 3, 3, 3, 3, 3, 3, 6, 6, 4, 4, 4, 12, 7, 10, 2, 3, 3, 3, 3, 3, 3, 3, 6, 7, 3, 7, 5, 14, 4, 4, 7, 8, 10, 4, 1, 3, 3, 6, 2, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 4, 2, 2, 5, 3, 4, 2, 2, 2, 2, 2, 2, 11, 5, 5, 5, 11, 5, 5, 3, 5, 5, 5, 5, 11, 14, 13, 9, 11, 9, 12, 8, 11, 11, 8, 11, 16, 9, 9, 7, 10, 9, 12, 8, 15, 6, 7, 6, 6, 13, 10, 8, 11, 8, 6, 6, 6, 12, 16, 6, 11, 7, 8, 9, 18, 6, 6, 9, 4, 4, 6, 13, 6, 6, 6, 6, 8, 8, 9, 16, 7, 7, 14, 7, 8, 8, 8, 7, 7, 7, 7, 7, 7, 15, 13, 7, 10, 7, 7, 10, 12, 16, 15, 7, 9, 9, 14, 11, 11, 10, 9, 10, 8, 12, 7, 8, 7, 7, 10, 12, 7, 12, 8, 7, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 3, 3, 5, 5, 5, 10, 4, 8, 7, 10, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 1, 3, 3, 3, 3, 3, 3, 3, 7, 4, 5, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 5, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 6, 6, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 9, 8, 2, 2, 2, 8, 12, 7, 7, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 8, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 5, 5, 7, 11, 9, 8, 8, 8, 7, 8, 9, 7, 7, 9, 7, 7, 7, 10, 7, 7, 10, 9, 10, 6, 6, 6, 6, 6, 6, 15, 7, 8, 9, 9, 8, 6, 6, 10, 9, 6, 8, 13, 9, 7, 6, 6, 6, 6, 6, 6, 12, 6, 6, 7, 6, 7, 6, 6, 6, 10, 10, 7, 6, 6, 6, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 6, 14, 6, 6, 7, 7, 9, 6, 6, 6, 6, 9, 9, 8, 9, 10, 9, 8, 9, 12, 7, 7, 7, 8, 7, 10, 12, 11, 9, 10, 7, 7, 7, 9, 10, 10, 8, 12, 9, 7, 7, 9, 8, 8, 8, 10, 7, 7, 8, 9, 9, 7, 7, 7, 8, 2, 4, 6, 3, 4, 2, 3, 3, 3, 3, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 5, 8, 6, 4, 7, 3, 3, 3, 3, 3, 3, 3, 12, 3, 3, 3, 3, 3, 3, 4, 4, 2, 3, 5, 3, 4, 7, 3, 3, 3, 3, 3, 3, 4, 3, 3, 3, 3, 3, 3, 3, 4, 3, 3, 6, 4, 3, 4, 2, 2, 2, 5, 3, 3, 3, 3, 3, 5, 4, 4, 4, 4, 7, 6, 8, 9, 2, 2, 2, 2, 3, 3, 3, 5, 7, 2, 3, 3, 8, 7, 7, 2, 2, 8, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 5, 8, 8, 7, 7, 6, 10, 6, 9, 7, 11, 4, 6, 8, 8, 7, 8, 4, 5, 5, 5, 5, 3, 3, 11, 8, 9, 6, 6, 8, 7, 4, 4, 7, 8, 7, 2, 2, 3, 3, 3, 3, 4, 3, 3, 3, 3, 3, 3, 3, 3, 7, 2, 2, 5, 3, 3, 2, 3, 3, 3, 3, 3, 3, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 12, 5, 5, 3, 3, 3, 5, 10, 12, 6, 15, 4, 6, 6, 7, 14, 9, 3, 3, 3, 3, 3, 8, 2, 2, 3, 5, 5, 3, 3, 3, 3, 3, 3, 8, 8, 8, 7, 5, 8, 4, 6, 11, 2, 2, 6, 7, 3, 3, 2, 9, 8, 5, 5, 3, 3, 3, 5, 5, 7, 7, 6, 6, 10, 6, 8, 6, 8, 9, 7, 4, 4, 4, 4, 7, 6, 6, 7, 7, 10, 9, 8, 11, 8, 3, 3, 3, 3, 3, 4, 4, 2, 3, 3, 3, 3, 3, 7, 6, 2, 5, 6, 7, 6, 4, 8, 9, 11, 2, 2, 3, 3, 3, 3, 3, 3, 3, 2, 2, 5, 3, 3, 3, 3, 3, 9, 9, 6, 4, 8, 7, 7, 5, 9, 8, 6, 2, 8, 7, 8, 5, 5, 5, 5, 5, 3, 3, 3, 16, 8, 7, 7, 7, 8, 7, 7, 7, 7, 9, 6, 9, 6, 10, 7, 7, 7, 6, 10, 8, 9, 11, 11, 8, 4, 4, 10, 8, 8, 6, 9, 6, 11, 8, 8, 8, 15, 7, 8, 9, 5, 3, 3, 3, 3, 3, 5, 11, 2, 2, 3, 8, 9, 10, 3, 2, 2, 2, 2, 2, 2, 3, 6, 4, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 2, 3, 3, 3, 3, 3, 3, 3, 11, 5, 3, 3, 3, 3, 3, 3, 3, 3, 6, 7, 4, 4, 2, 3, 3, 3, 3, 3, 3, 3, 3, 12, 7, 4, 12, 4, 6, 5, 4, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 11, 10, 6, 4, 6, 10, 8, 3, 3, 3, 3, 3, 3, 3, 3, 5, 4, 4, 4, 2, 2, 2, 2, 2, 2, 2, 2, 5, 3, 4, 4, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 10, 5, 5, 5, 5, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 7, 8, 8, 7, 13, 12, 10, 10, 8, 8, 7, 7, 9, 12, 11, 6, 6, 8, 8, 9, 7, 7, 7, 10, 15, 10, 4, 4, 4, 4, 4, 11, 8, 8, 9, 7, 9, 14, 14, 12, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 12, 5, 5, 5, 11, 10, 7, 9, 3, 8, 7, 3, 15, 13, 11, 4, 4, 2, 2, 2, 19, 7, 5, 5, 3, 3, 3, 3, 3, 3, 3, 5, 22, 18, 6, 14, 17, 4, 4, 19, 16, 18, 2, 3, 3, 7, 2, 3, 2, 3, 3, 6, 4, 2, 3, 3, 2, 5, 3, 3, 3, 3, 3, 3, 3, 9, 9, 2, 3, 2, 2, 2, 3, 3, 3, 5, 7, 14, 7, 7, 12, 9, 13, 6, 11, 6, 10, 9, 7, 7, 8, 12, 12, 8, 8, 8, 10, 7, 7, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 5, 8, 10, 7, 8, 11, 8, 12, 9, 4, 14, 7, 7, 9, 13, 2, 3, 3, 3, 3, 3, 3, 2, 3, 3, 3, 1, 2, 2, 3, 3, 3, 3, 3, 3, 5, 2, 2, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 8, 4, 4, 4, 3, 2, 3, 3, 3, 3, 5, 2, 2, 2, 2, 5, 5, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 12, 9, 8, 8, 9, 8, 6, 17, 6, 6, 6, 8, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 4, 4, 8, 8, 9, 9, 9, 7, 7, 7, 7, 7, 7, 7, 9, 9, 9, 7, 8, 8, 8, 10, 7, 13, 10, 8, 9, 3, 3, 5, 13, 3, 3, 3, 3, 3, 7, 7, 6, 6, 10, 13, 11, 11, 8, 8, 9, 8, 9, 9, 10, 10, 10, 11, 10, 10, 13, 13, 16, 15, 11, 12, 9, 9, 10, 9, 11, 10, 9, 9, 14, 7, 8, 3, 10, 7, 7, 3, 2, 2, 2, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 6, 7, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 11, 6, 7, 4, 6, 2, 2, 3, 3, 3, 1, 3, 3, 3, 3, 3, 3, 6, 4, 4, 2, 2, 2, 3, 3, 3, 3, 4, 4, 6, 6, 6, 6, 5, 4, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 9, 11, 6, 10, 9, 12, 7, 7, 11, 14, 9, 7, 12, 3, 3, 7, 12, 11, 12, 7, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 9, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 11, 5, 5, 5, 5, 5, 5, 5, 5, 11, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 10, 3, 3, 3, 11, 3, 5, 9, 11, 8, 12, 14, 9, 7, 8, 7, 7, 11, 11, 7, 7, 10, 9, 8, 10, 9, 7, 7, 7, 7, 7, 7, 8, 8, 7, 11, 8, 8, 8, 7, 7, 10, 8, 7, 13, 12, 7, 17, 10, 8, 8, 11, 7, 11, 11, 14, 7, 11, 7, 8, 6, 9, 20, 8, 7, 9, 16, 7, 10, 6, 11, 10, 8, 9, 7, 16, 11, 11, 9, 8, 9, 8, 8, 8, 11, 8, 15, 8, 8, 9, 7, 8, 8, 11, 10, 7, 5, 7, 10, 10, 15, 7, 7, 7, 8, 7, 8, 8, 10, 11, 10, 10, 10, 11, 11, 7, 8, 6, 8, 8, 8, 10, 6, 8, 6, 6, 7, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 16, 6, 15, 6, 7, 11, 11, 7, 9, 10, 11, 13, 10, 6, 16, 8, 10, 12, 11, 6, 6, 6, 6, 6, 6, 6, 10, 6, 10, 7, 7, 7, 7, 11, 7, 11, 6, 6, 6, 6, 6, 6, 17, 7, 7, 6, 6, 12, 22, 6, 6, 6, 6, 6, 8, 6, 6, 6, 6, 7, 6, 6, 5, 6, 6, 8, 11, 6, 9, 14, 11, 9, 11, 7, 7, 8, 6, 6, 6, 8, 10, 9, 6, 6, 6, 6, 9, 7, 6, 6, 6, 6, 6, 15, 6, 4, 4, 4, 6, 4, 17, 8, 11, 6, 6, 9, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 6, 6, 6, 6, 10, 6, 10, 6, 6, 6, 6, 12, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 9, 6, 6, 6, 6, 18, 6, 6, 6, 8, 9, 10, 7, 8, 9, 10, 11, 7, 13, 6, 8, 8, 6, 6, 14, 7, 7, 7, 7, 10, 7, 14, 9, 6, 6, 9, 15, 9, 7, 14, 6, 11, 14, 13, 7, 12, 8, 7, 7, 7, 7, 7, 12, 7, 10, 9, 16, 6, 8, 6, 5, 17, 6, 8, 10, 4, 6, 4, 10, 15, 17, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 8, 4, 4, 11, 7, 4, 4, 7, 7, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 19, 17, 6, 10, 11, 6, 6, 6, 6, 18, 6, 6, 11, 4, 4, 4, 5, 6, 6, 6, 9, 5, 6, 4, 6, 6, 4, 6, 6, 6, 6, 10, 6, 6, 4, 6, 6, 10, 6, 10, 6, 6, 6, 6, 11, 6, 6, 10, 6, 6, 8, 6, 6, 6, 8, 6, 11, 4, 11, 9, 10, 9, 11, 4, 8, 4, 11, 12, 7, 9, 8, 6, 7, 7, 8, 12, 12, 11, 13, 10, 11, 7, 7, 7, 9, 7, 11, 10, 7, 7, 7, 16, 11, 10, 11, 17, 9, 9, 8, 8, 7, 7, 7, 9, 7, 7, 7, 14, 7, 13, 9, 11, 10, 14, 10, 10, 12, 11, 10, 7, 10, 5, 14, 8, 8, 8, 9, 7, 8, 7, 7, 9, 8, 7, 8, 7, 7, 7, 7, 7, 7, 7, 11, 8, 10, 8, 7, 8, 14, 11, 8, 9, 9, 9, 8, 24, 10, 10, 12, 7, 7, 15, 11, 8, 8, 12, 11, 8, 9, 9, 7, 8, 9, 10, 11, 10, 11, 7, 12, 7, 7, 11, 9, 8, 14, 13, 12, 8, 11, 10, 8, 8, 7, 7, 14, 9, 10, 8, 9, 11, 7, 14, 8, 8, 13, 8, 8, 12, 7, 10, 14, 14, 11, 9, 10, 9, 9, 7, 7, 11, 11, 13, 9, 13, 5, 5, 5, 7, 9, 5, 11, 12, 14, 8, 7, 7, 11, 10, 9, 7, 8, 8, 7, 10, 11, 11, 5, 5, 7, 5, 5, 5, 7, 7, 15, 7, 7, 8, 7, 15, 12, 12, 10, 7, 8, 7, 11, 7, 7, 7, 23, 11, 8, 8, 11, 10, 7, 8, 11, 7, 19, 7, 7, 6, 9, 9, 9, 11, 3, 4, 7, 8, 6, 6, 4, 10, 8, 2, 2]);
  var edgeChild = /* @__PURE__ */ new Uint16Array([0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 12, 1, 1, 1, 1, 1, 17, 1, 1, 1, 12, 1, 12, 1, 12, 13, 1, 1, 1, 1, 12, 1, 12, 1, 1, 1, 1, 1, 14, 21, 1, 1, 1, 1, 1, 1, 1, 19, 12, 1, 1, 1, 1, 1, 1, 1, 20, 1, 1, 1, 16, 18, 1, 1, 15, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 22, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 1, 24, 25, 26, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 12, 12, 12, 12, 1, 32, 0, 0, 0, 1, 1, 1, 1, 35, 34, 1, 1, 1, 1, 1, 33, 1, 1, 1, 1, 37, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 38, 0, 0, 0, 0, 39, 40, 0, 0, 0, 0, 12, 1, 1, 12, 1, 1, 1, 1, 43, 44, 44, 44, 43, 44, 43, 43, 45, 44, 43, 44, 43, 43, 43, 43, 43, 43, 45, 43, 43, 43, 43, 43, 43, 44, 46, 46, 44, 43, 43, 43, 43, 43, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 49, 51, 49, 49, 49, 51, 49, 50, 49, 52, 49, 50, 50, 49, 49, 49, 50, 52, 50, 52, 49, 50, 50, 12, 54, 54, 53, 55, 50, 52, 49, 49, 47, 48, 56, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 59, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 66, 67, 12, 1, 1, 65, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 78, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 76, 79, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 77, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 12, 1, 1, 1, 1, 89, 1, 91, 1, 1, 1, 1, 1, 1, 1, 1, 94, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 97, 97, 1, 1, 12, 1, 100, 1, 1, 1, 1, 1, 1, 1, 98, 1, 99, 1, 101, 1, 1, 1, 1, 1, 102, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 110, 111, 1, 1, 1, 1, 1, 1, 113, 113, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 121, 122, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 122, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 122, 1, 1, 1, 1, 1, 1, 1, 1, 1, 126, 123, 125, 120, 1, 124, 1, 1, 114, 1, 1, 1, 1, 117, 1, 127, 1, 1, 1, 1, 1, 1, 119, 1, 108, 1, 109, 1, 12, 128, 106, 1, 112, 1, 1, 1, 1, 1, 107, 115, 1, 12, 12, 12, 118, 116, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 12, 12, 1, 1, 1, 1, 1, 12, 134, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 136, 1, 1, 1, 1, 1, 1, 1, 1, 137, 138, 12, 12, 135, 133, 44, 44, 140, 49, 49, 139, 142, 141, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 145, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 143, 0, 0, 0, 0, 1, 0, 144, 132, 1, 0, 1, 1, 12, 12, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 148, 147, 20, 1, 1, 12, 12, 1, 20, 12, 12, 1, 1, 1, 1, 1, 134, 1, 1, 152, 1, 1, 1, 1, 153, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 1, 1, 136, 1, 1, 152, 1, 1, 1, 1, 153, 1, 1, 134, 1, 1, 1, 152, 1, 1, 1, 1, 153, 1, 1, 134, 1, 1, 1, 1, 1, 1, 1, 1, 134, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 160, 1, 1, 1, 152, 1, 1, 1, 1, 1, 153, 1, 1, 160, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 134, 1, 1, 1, 1, 152, 1, 1, 1, 1, 153, 1, 1, 1, 134, 1, 1, 152, 1, 1, 1, 1, 164, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 1, 167, 1, 1, 160, 1, 1, 1, 1, 1, 152, 1, 1, 1, 1, 1, 153, 1, 1, 160, 1, 1, 1, 1, 1, 152, 1, 1, 1, 1, 1, 153, 1, 154, 158, 158, 12, 1, 12, 166, 1, 1, 1, 1, 1, 158, 158, 158, 154, 1, 1, 1, 157, 158, 161, 165, 1, 1, 1, 1, 157, 157, 1, 1, 156, 154, 154, 157, 170, 156, 170, 1, 1, 168, 1, 156, 155, 157, 1, 1, 1, 1, 157, 1, 159, 1, 1, 1, 12, 1, 162, 1, 162, 1, 1, 1, 162, 161, 163, 169, 156, 154, 1, 1, 1, 1, 1, 1, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 173, 172, 173, 172, 172, 172, 172, 174, 174, 172, 173, 172, 173, 172, 172, 12, 1, 12, 12, 12, 12, 1, 12, 12, 12, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 196, 1, 1, 1, 1, 12, 202, 203, 204, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 151, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 199, 1, 1, 1, 186, 1, 1, 1, 1, 210, 1, 1, 207, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 177, 193, 1, 1, 1, 189, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 184, 1, 1, 1, 1, 1, 1, 1, 194, 1, 1, 1, 1, 198, 1, 1, 1, 1, 171, 1, 1, 192, 1, 1, 1, 195, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 182, 1, 12, 1, 1, 12, 1, 1, 1, 1, 185, 1, 1, 1, 191, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 211, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 197, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 176, 12, 1, 1, 1, 179, 12, 1, 1, 1, 1, 1, 1, 1, 201, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 178, 1, 1, 1, 1, 1, 1, 1, 206, 1, 1, 1, 183, 1, 1, 1, 190, 1, 12, 1, 187, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 194, 1, 1, 1, 1, 181, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 175, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 188, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 208, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 209, 1, 1, 12, 1, 1, 1, 1, 180, 1, 1, 1, 188, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 200, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 205, 1, 1, 12, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 221, 0, 0, 0, 0, 0, 222, 0, 0, 0, 0, 0, 0, 1, 12, 1, 1, 1, 226, 1, 1, 1, 0, 227, 224, 225, 1, 1, 1, 1, 1, 1, 232, 1, 234, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 230, 1, 1, 1, 1, 1, 236, 1, 1, 12, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 235, 1, 1, 1, 12, 1, 1, 1, 1, 231, 1, 1, 1, 229, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 233, 1, 1, 1, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 242, 13, 1, 1, 1, 12, 12, 239, 240, 1, 1, 1, 1, 241, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 243, 1, 1, 12, 16, 1, 1, 1, 1, 1, 1, 244, 1, 1, 1, 12, 12, 1, 1, 1, 1, 1, 1, 244, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 253, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 257, 257, 1, 0, 0, 0, 0, 0, 1, 12, 0, 0, 0, 0, 0, 0, 0, 0, 172, 262, 263, 1, 12, 1, 1, 1, 1, 12, 265, 1, 1, 264, 1, 1, 267, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 271, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 12, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 12, 0, 282, 0, 0, 283, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 59, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 0, 307, 0, 0, 0, 0, 0, 0, 0, 0, 0, 309, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 325, 325, 326, 325, 0, 188, 1, 1, 13, 321, 1, 319, 0, 0, 0, 0, 0, 0, 0, 322, 1, 1, 327, 1, 207, 1, 1, 1, 1, 320, 1, 317, 1, 323, 1, 315, 1, 324, 1, 316, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 12, 318, 318, 1, 1, 1, 186, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 12, 1, 1, 1, 1, 314, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 330, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 267, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 370, 370, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 362, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 1, 338, 349, 1, 1, 337, 372, 1, 343, 1, 1, 335, 367, 1, 1, 353, 334, 339, 1, 1, 1, 346, 377, 355, 1, 1, 1, 1, 1, 1, 356, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 365, 369, 0, 0, 79, 1, 1, 0, 363, 340, 376, 341, 344, 351, 1, 366, 0, 1, 0, 79, 360, 358, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 379, 1, 1, 350, 1, 79, 1, 0, 1, 1, 1, 382, 1, 0, 0, 79, 357, 0, 1, 336, 1, 1, 1, 0, 1, 1, 359, 1, 0, 1, 1, 1, 0, 1, 384, 347, 1, 1, 0, 1, 0, 0, 375, 0, 1, 1, 1, 79, 368, 1, 1, 364, 361, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 342, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 374, 0, 79, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 378, 1, 1, 1, 0, 0, 381, 0, 0, 0, 1, 354, 1, 0, 79, 380, 1, 0, 0, 0, 0, 383, 1, 1, 0, 0, 1, 0, 1, 0, 352, 0, 348, 0, 1, 1, 1, 0, 1, 1, 0, 371, 345, 373, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 12, 1, 1, 1, 12, 399, 399, 1, 1, 12, 12, 1, 399, 1, 1, 12, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 411, 1, 1, 0, 1, 1, 1, 1, 207, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 429, 429, 1, 1, 0, 0, 315, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 442, 1, 441, 1, 1, 1, 1, 1, 1, 1, 1, 1, 446, 1, 12, 12, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 454, 1, 1, 1, 456, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 453, 1, 448, 1, 1, 1, 1, 435, 1, 1, 1, 1, 1, 1, 1, 1, 449, 12, 1, 1, 1, 1, 455, 1, 1, 1, 450, 444, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 315, 1, 432, 1, 1, 12, 452, 1, 1, 315, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 437, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 455, 1, 1, 1, 1, 315, 1, 451, 1, 1, 1, 445, 439, 1, 1, 1, 1, 1, 440, 1, 457, 443, 1, 1, 1, 1, 1, 438, 1, 1, 1, 1, 1, 1, 1, 1, 1, 433, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 447, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 436, 1, 1, 1, 1, 1, 434, 1, 221, 458, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 12, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 0, 464, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 12, 1, 67, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 468, 0, 468, 468, 468, 468, 468, 468, 468, 0, 468, 468, 468, 468, 468, 1, 468, 468, 468, 0, 468, 468, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 473, 472, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 477, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 470, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 471, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 479, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 468, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 476, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 469, 0, 0, 480, 475, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 474, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 468, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 469, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 468, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 478, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 490, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 201, 201, 1, 494, 1, 1, 1, 493, 1, 1, 1, 1, 489, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 491, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 495, 1, 1, 492, 1, 1, 1, 1, 1, 1, 1, 1, 370, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 496, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 507, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 12, 1, 509, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 12, 12, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 59, 1, 1, 12, 12, 12, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 528, 1, 1, 1, 1, 1, 1, 1, 529, 1, 1, 1, 1, 1, 1, 1, 527, 1, 1, 12, 1, 1, 531, 240, 1, 1, 12, 12, 1, 1, 12, 1, 12, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 535, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 541, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 132, 1, 12, 546, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 107, 1, 1, 12, 1, 1, 1, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 551, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 144, 1, 1, 1, 229, 1, 1, 12, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 576, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 221, 1, 326, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 581, 1, 1, 1, 1, 0, 583, 0, 79, 0, 582, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 12, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 590, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 585, 585, 0, 589, 587, 585, 585, 585, 585, 585, 591, 585, 585, 595, 585, 585, 585, 585, 585, 585, 585, 585, 585, 585, 592, 589, 585, 585, 589, 585, 585, 585, 585, 585, 585, 585, 585, 585, 585, 585, 585, 585, 587, 585, 585, 585, 585, 585, 593, 585, 585, 585, 585, 585, 585, 0, 0, 0, 1, 594, 1, 1, 1, 1, 588, 1, 1, 1, 1, 1, 586, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 12, 599, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 12, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 12, 1, 1, 12, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 96, 64, 279, 305, 410, 537, 0, 4, 68, 237, 255, 281, 306, 332, 386, 412, 0, 501, 521, 538, 601, 9, 0, 60, 88, 396, 408, 428, 579, 0, 499, 520, 534, 616, 0, 30, 6, 0, 463, 502, 606, 564, 70, 0, 7, 284, 256, 387, 465, 415, 540, 79, 602, 0, 580, 308, 417, 467, 9, 105, 287, 508, 6, 30, 0, 310, 79, 389, 79, 485, 10, 6, 131, 249, 274, 0, 617, 511, 0, 567, 0, 63, 6, 6, 252, 95, 2, 431, 397, 409, 600, 0, 6, 0, 6, 285, 103, 6, 565, 503, 542, 0, 466, 388, 272, 286, 8, 71, 104, 603, 545, 390, 311, 299, 418, 146, 74, 289, 549, 512, 605, 568, 333, 328, 481, 6, 75, 149, 11, 0, 250, 524, 550, 569, 516, 554, 574, 615, 36, 6, 261, 294, 331, 303, 219, 30, 530, 557, 219, 41, 217, 266, 295, 304, 405, 422, 483, 273, 0, 73, 566, 0, 402, 416, 298, 79, 248, 79, 0, 584, 548, 506, 291, 420, 79, 391, 385, 0, 0, 0, 9, 559, 575, 218, 0, 423, 406, 533, 518, 577, 619, 85, 219, 42, 296, 394, 424, 573, 0, 513, 292, 275, 79, 216, 80, 28, 388, 30, 6, 392, 329, 302, 608, 596, 526, 553, 515, 0, 259, 81, 30, 404, 421, 0, 30, 425, 0, 220, 597, 519, 9, 407, 426, 219, 249, 86, 223, 598, 578, 561, 484, 427, 395, 251, 228, 87, 58, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 624, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 413, 0, 0, 0, 0, 0, 0, 0, 0, 82, 0, 129, 0, 0, 84, 552, 0, 0, 0, 0, 0, 0, 0, 27, 0, 555, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 413, 0, 0, 0, 0, 505, 0, 258, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 293, 0, 0, 0, 0, 0, 0, 0, 621, 0, 0, 0, 0, 0, 620, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 393, 0, 0, 0, 486, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 69, 0, 0, 0, 0, 0, 0, 497, 0, 0, 0, 0, 0, 0, 403, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 212, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 517, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 498, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 270, 280, 0, 0, 0, 0, 0, 532, 276, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 514, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 459, 0, 0, 0, 313, 0, 0, 0, 0, 0, 0, 254, 0, 0, 0, 0, 0, 0, 23, 0, 0, 0, 0, 572, 0, 0, 0, 0, 604, 523, 0, 0, 0, 0, 245, 0, 0, 0, 0, 0, 0, 461, 0, 0, 482, 0, 0, 0, 0, 0, 61, 0, 0, 0, 268, 57, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 247, 0, 0, 0, 0, 0, 278, 614, 0, 72, 0, 0, 0, 0, 0, 0, 0, 0, 0, 623, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 150, 0, 277, 0, 0, 0, 0, 0, 0, 571, 0, 0, 0, 0, 0, 0, 525, 0, 0, 0, 0, 0, 0, 0, 0, 0, 570, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 62, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 214, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 84, 0, 504, 0, 0, 0, 0, 0, 558, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 84, 83, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 488, 0, 487, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 260, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 288, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 539, 0, 0, 0, 0, 0, 0, 0, 0, 297, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 69, 238, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 84, 0, 610, 0, 0, 556, 0, 0, 0, 0, 0, 0, 0, 0, 0, 246, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 613, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 522, 0, 0, 0, 84, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 500, 0, 618, 0, 0, 430, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 401, 0, 0, 0, 547, 0, 93, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 31, 0, 0, 0, 0, 0, 0, 29, 92, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 290, 0, 0, 0, 215, 0, 0, 0, 0, 0, 0, 562, 0, 0, 0, 0, 130, 0, 0, 0, 0, 0, 563, 0, 0, 0, 0, 0, 0, 0, 413, 419, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 398, 0, 312, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 300, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 536, 0, 0, 0, 414, 0, 0, 400, 0, 0, 0, 0, 0, 0, 607, 0, 0, 0, 543, 0, 0, 90, 0, 544, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 510, 462, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 269, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 413, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 612, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 611, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 622, 0, 0, 0, 0, 0, 560, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 301, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 609, 0, 0, 213, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 627, 627, 627, 627, 627, 627, 627, 626, 628]);
  var labelText = "orgmilcomschnetedugovdrrformsfeedbackofficialaccoorgmilschnetgovmagazinemediaunioncargopilotgroupcaarespressworksaerodromeworkinggroupair-traffic-controlaircraftaccident-preventioneducatormarketplaceambulanceinsurancecateringairportrepbodyenginesoftwaremodellingair-surveillanceconsultingchartertrainermaintenanceservicesdesignflightskydivingfreightassociationstudentgroundhandlingdgcafuelclubtaxicrewshowballooningexpresstraderbrokerauthoragentsairtrafficjournalistsafetyconsultantmicrolightaccident-investigationparachutingequipmentproductionfederationrecreationscientistnavigationengineertradingglidingleasingresearchpassenger-associationentertainmentparaglidinghangglidingaerobaticrotorcraftemergencycertificationgovernmentaeroclubexchangelogisticschampionshiphomebuiltcouncilconferencecontrolairlinecivilaviationjournalorgcomnetedugovcoorgcomnomnetobjofforgcomnetuwukiloappsframerorgmilcomnetedugovcoradioorgcomnetcommuneedogpbcoitgvorgedugov*spreviewfrontendrelayononstagingupid*mtls*privatelinktypedreamdeveloperbravemochawindsurfaivenmirenupsunwnextbegetngrokclerkwale2bwebcsbrunputerflutterflowspawnbaseshiptodaymagicpatternsnetlifyondigitaloceanrailwayhostedclaudehasurabotdashvercelgithubluyanigadgetreplitcloudflaretelebitedgecomputeevervaultexponyatnoopencrpplxzeaburwasmerframerzeropsrocketpreviewconvexmedusajsspritesonherculeseasypanelstreamlitglideossnowflakemesserliloginlinehackclubcodepennorthflankbase44corespeedleapcellngrok-freeclerkstagelovableon-fleek*us-west-3ap-south-2us-central-2us-central-1eu-central-1ap-south-1us-west-2us-east-2eu-north-1ap-north-1us-west-1us-east-1*rcloudintsegorgmilcomgobbetnetintedugovturmusicasenasamutualcoopip6uriurnin-addre164homeirisgovdixdaemoncloudnssthwien*inexexkunden4accogvormymyspreadshop4lima2ixortsinfofuturecmsfuturehosting12hpprivfuturemailinglima-cityfunkfeuer123webseitednshomemelmyspreadshopcloudletswasantqldvicactnswtascatholicwasaqldvictasidwasantozqldorgcomvicasnactnetedugovnswtasconfcomairflowlambda-urltransfer-webappairflowtransfer-webapptransfer-webapptransfer-webapp-fipstransfer-webappeu-west-3ap-south-2eu-south-2eu-central-2ap-southeast-3ap-southeast-4ap-northeast-3eu-central-1mx-central-1me-central-1ca-central-1il-central-1ap-northeast-1ap-southeast-1me-south-1af-south-1eu-south-1ap-south-1ap-southeast-7us-west-2eu-west-2us-east-2eu-north-1ap-southeast-2ap-northeast-2ap-southeast-5us-gov-west-1us-gov-east-1ca-west-1us-west-1eu-west-1us-east-1ap-east-1sa-east-1privatenotebookstudiolabelingnotebookstudionotebooknotebook-fipslabelingnotebookstudionotebook-fipsnotebookstudio-fipsnotebook-fipsnotebookstudionotebook-fipsnotebookstudioeu-west-3ap-south-2eu-south-2eu-central-2ap-southeast-3ap-southeast-4ap-northeast-3eu-central-1me-central-1ca-central-1il-central-1ap-northeast-1ap-southeast-1me-south-1af-south-1eu-south-1ap-south-1us-west-2eu-west-2us-east-2eu-north-1ap-southeast-2ap-northeast-2experimentsus-gov-west-1us-gov-east-1ca-west-1us-west-1eu-west-1us-east-1ap-east-1sa-east-1onrepostsagemakercopporgmilcompronetintedugovbiznameinfoshoprsorgmilcomnetedugovbrendlyresolvenzauscotvstoreorgcomnetedugovbizinfoidacaicoittvorgmilcomschnetedugovinfocloudezproxysiteacmymyspreadshopkuleuvenwebhostingtransurl123websitecloudnsinterhostsolutionsddns5476103298edgfacbmlonihkjutwvqpsryxzbarsycoororgcomedumyftpno-iporxcloud-ipfor-somemmafanfor-morewebhopselfipjozidyndnscloudnsdscloudfor-thefor-betteractivetrailcoeconorestooteorgcomeconeteduassurmoneyafricaarchitectesrestaurantloisirstourismavocatsinfoagrounivcoorgcomnetedugoviatvdeportesaludtksatorgmilcomwebgobnetinteducienciaboliviarevistacooperativaempresanombreindustriamusicapatriamedicinademocraciapoliticapuebloindigenaplurinacionalarteblogwikiinfoagrotransportenoticiasprofesionalacademiaeconomiaecologiamovimientotecnologianaturalsimplesitecepesebamapadfmgalampbacscpirngorotomtrjspaprrprrsesmscepesebamapadfmgalampbacscpirngorotomtrjspaprrprrsesms*biaamfmtcmptvfeirasampajampanatalbelemananiradiog12medindfndbmdtrdthepoaggfjdfdefinfenflegsegongengcngorgzlgslglogppgmillelqslcimcomnomadmjabimbbibbsbabcrectecsjcetcpscpvhudieticriapipsiecnbiorioecogeoteoodoproatoartfstmatvetdetbetnetcntnotfotgrueduajuespappreptmpemparqsrvadvdevgovntrturagrjorfarjusmusdesvixxyzcozfozslzbhzmaringasantamariacampinagrandegoianiasorocabafloripasaobernardocuritibaboavistarecifeaparecidasaogoncasalvadorcuiabamorenamacapalondrinacontagemsocialfortalmaceioleilaoosascoriobranconiteroi9guacutcheblogflogvlogwikitaxicoopmanauspalmascaxiasjoinvillebaruericampinassantoandreribeiraoriopretoweorgcomnetedugovv0windsurfshiptodaycloudsitecoaccoorgnetgovofmilcomgovmediatechzacoorgcomnetedugsjgovmydnspenfnlabnbmbgcbcqconcontnuyksknsmyspreadshopno-ipawdevboxbarsyonidatemfuinabusavinstanceseceuguukussryzespawncsxcloud-ipmyphotosfantasyleaguetwmailcleverappsscrappingccwucloudnsftpaccessgame-serverccgovobjectsrmalpgcust*svcalp1aeappenginermalpgmyspreadshop4lima2ixsquare7cloudscale123websitefirenet12hpflowgotdnslinkyard-cloudcloudnslima-citydnskingobjectstorageedaccogoorusorgcomnetintedua\xE9roportxn--aroport-byaassogouvcomilgobgovcloudnses-1eu-west-1us-east-1euvipit1eurarubait1s3lbwebsites3websiteru-spbru-mskelasticcsrunstnukukcaukusnl-ams-1fr-par-1fr-par-2functionsnodess3ddlwhmrdbfnck8sifrs3-websitecockpitscblmgdbdtwhkafkpubprivs3ddlwhmrdbk8sifrs3-websitecockpitscblmgdbdtwhkafks3ddlrdbk8sifrs3-websitecockpitscblmgdbdtwhkafkk8sscalebookpl-wawfr-parnl-amsbaremetalsmartlabelinginstancesdechk2kuleuvenlaravelvoorloperurownoxazapscwhstgrvaporonline-serverobservablehqelementorantagonistreclaimjoteluluencowaydiademjelasticmatlabmagentositetrendhostingaxarnetperspectajenv-arubajelejoteravendbemergenttrafficplexconvexkeliwebserveboltbegetcdnstaticson-rancherprimetelonstackitunison-servicesdnshomelinkyardbarsyjelecloudnscocomnetgovmycn-northwest-1cn-north-1s3s3-accesspoints3-websites3s3-accesspointrdsdualstacks3-deprecatedemrappui-prods3-websiteemrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apis3s3-accesspoints3s3-accesspointrdsdualstackemrappui-prods3-websiteemrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apicn-northwest-1cn-north-1cn-northwest-1ebcomputeelbcn-north-1airflowcn-northwest-1cn-north-1oncn-northwest-1cn-north-1amazonawssagemakeramazonwebservicesdirectasgdsdhehahljlnmhbacscahqhshhihnlnynsnmofjbjzjxjtjhkcqtwgsjssxnxjxgxxzgz\u7DB2\u7D61\u7F51\u7EDC\u516C\u53F8orgmilcomnetedugovxn--55qx5dcanva-appsxn--io0a7iquickconnectcanvasitekhsjxn--od0algcanva-codemyqnapcloudsrvrlessclustersrealtimestorageleadpagescarrdcrdorgmilcomnomnetedugovhidnssupabaserdpareplmypiumsoxmitotaplpagesfirewalledreplitowodevwebview-assetsvfswebview-assetss3s3-accesspointdualstackemrappui-prods3-websiteaws-cloud9emrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apicloud9eu-west-3ap-south-2eu-south-2eu-central-2ap-southeast-3ap-southeast-4ap-northeast-3eu-central-1me-central-1ca-central-1il-central-1ap-northeast-1ap-southeast-1me-south-1af-south-1eu-south-1ap-south-1ap-southeast-7us-west-2eu-west-2us-east-2eu-north-1ap-southeast-2ap-northeast-2ap-southeast-5ca-west-1us-west-1eu-west-1us-east-1ap-east-1sa-east-1s3s3-accesspointdualstackemrappui-prods3-websiteaws-cloud9emrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apicloud9s3s3-accesspointdualstackanalytics-gatewayemrappui-prods3-websiteaws-cloud9emrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apicloud9s3s3-accesspointdualstackemrappui-prods3-websiteemrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apis3s3-accesspointdualstacks3-deprecateds3-websites3-object-lambdaexecute-apis3s3-accesspoints3-websites3-accesspoint-fipss3-fipss3s3-accesspointdualstackemrappui-prods3-websites3-accesspoint-fipsaws-cloud9s3-fipsemrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apicloud9s3s3-accesspointdualstackemrappui-prods3-websites3-accesspoint-fipss3-fipsemrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apis3s3-accesspointdualstacks3-deprecatedanalytics-gatewayemrappui-prods3-websiteaws-cloud9emrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apicloud9vfss3s3-accesspointdualstackemrappui-prods3-websiteaws-cloud9emrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apicloud9eu-west-3ap-south-2eu-central-2ap-southeast-3ap-southeast-4ap-northeast-3eu-central-1mx-central-1me-central-1ca-central-1il-central-1ap-northeast-1us-northeast-1ap-southeast-1me-south-1af-south-1ap-south-1ap-southeast-7us-west-2eu-west-2ap-east-2us-east-2ap-southeast-2ap-northeast-2ap-southeast-5us-gov-west-1us-gov-east-1ap-southeast-6ca-west-1us-west-1eu-west-1us-east-1ap-east-1sa-east-1mrapaccesspoints3s3-accesspointdualstacks3-deprecatedanalytics-gatewayemrappui-prods3-websites3-accesspoint-fipsaws-cloud9s3-fipsemrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apicloud9s3s3-accesspointdualstacks3-deprecatedanalytics-gatewayemrappui-prods3-websites3-accesspoint-fipsaws-cloud9s3-fipsemrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apicloud9s3eu-west-3ap-south-2eu-south-2computes3-ap-northeast-2elbrdss3-ap-east-1s3-sa-east-1s3-us-gov-west-1s3-eu-central-1s3-ca-central-1eu-central-2ap-southeast-3ap-southeast-4ap-northeast-3s3-website-us-west-2s3-website-eu-west-1s3-external-1eu-central-1me-central-1ca-central-1il-central-1s3-us-west-1s3-eu-west-1s3-website-sa-east-1s3-website-ap-southeast-2ap-northeast-1ap-southeast-1s3-us-west-2s3-eu-west-2me-south-1af-south-1eu-south-1ap-south-1us-west-2eu-west-2us-east-2s3-website-ap-southeast-1s3-1s3-globals3-ap-northeast-3eu-north-1airflowap-southeast-2s3-us-gov-east-1s3-fips-us-gov-east-1s3-me-south-1s3-ap-south-1ap-northeast-2s3-website-us-west-1ap-southeast-5s3-eu-north-1s3-ap-southeast-1s3-website-us-gov-west-1compute-1s3-eu-west-3us-gov-west-1s3-website-ap-northeast-1us-gov-east-1s3-fips-us-gov-west-1s3-website-us-east-1s3-ap-southeast-2ca-west-1us-west-1eu-west-1us-east-1ap-east-1sa-east-1s3-us-east-2s3-ap-northeast-1authauthauth-fipsauth-fipseu-west-3ap-south-2eu-south-2eu-central-2ap-southeast-3ap-southeast-4ap-northeast-3eu-central-1mx-central-1me-central-1ca-central-1il-central-1ap-northeast-1ap-southeast-1me-south-1af-south-1eu-south-1ap-south-1ap-southeast-7us-west-2eu-west-2us-east-2eu-north-1ap-southeast-2ap-northeast-2ap-southeast-5us-gov-west-1us-gov-east-1ca-west-1us-west-1eu-west-1us-east-1ap-east-1sa-east-1rframeservicesbuilderstg-builderdev-builder*ociocpocsazuregcpawsdemoinstanceeu-west-3eu-south-2ap-southeast-3ap-northeast-3eu-central-1me-central-1ca-central-1il-central-1ap-northeast-1ap-southeast-1me-south-1af-south-1eu-south-1ap-south-1ap-southeast-7us-west-2eu-west-2us-east-2eu-north-1ap-southeast-2ap-northeast-2ap-southeast-5us-gov-west-1us-gov-east-1us-west-1eu-west-1us-east-1ap-east-1sa-east-1previeweu-4us-4us-1eu-1us-2eu-2us-3eu-3appscomputepaasrag-cloudrag-cloud-chjcloudjcloud-ver-jpcdemonodebalancermembersipeuxvsoncillaocelotonzayalilynxsphinxfentigercustomercaracalo365cloudstaticxendevapp001testcode-builder-stgplatformmediasiteprojedrydpagesjsx0desazacncoitrueu4uhkukgrbrushatenadiarymyspreadshopfrom-flfrom-wvwebspace-hosttheworkpchatenablogcursorusercontentservesarcasmapplinzisakuratanwixsiteappchizigiizeis-into-carsdnsiskinkyadobeaemcloudis-a-therapistpgfogmyvncdojinis-an-actress1kappfldrvkozowqa2jpnmexprgmrfirewall-gatewaydynnscafjsfbsbxooguyfrom-gawoltlab-demois-a-anarchistwiardwebteaches-yogadattowebtb-hostinglive-websiteservegamegotpantheonfrom-nhsubsc-payfrom-ohvipsinaappfrom-cadyndns-officehomelinuxfrom-mahercules-appservebbsstreakusercontentfrom-okfrom-wyfastly-terrariumis-a-llamaqualyhqportalserveexchangeon-vaporvivenushopciscofreakgrayjayleaguesmetaaiusercontentfrom-iais-a-libertariansaves-the-whalestaveusercontentyolasiteoperaunitepoint2thisis-a-catererclaudeusercontentlinodeusercontentfrom-vagithubusercontentsells-for-lesshosteurcanva-appsplaystation-cloudddnsfreefrom-pafrom-prfrom-waddnskingoutsystemscloudhotelwithflightmydattois-a-nascarfanmydbserverminiserverdamnserverservehumouris-a-playerfrom-nvfrom-nmemergentagentgentappsamplifyappfrom-kyis-an-accountantnfshostserveircfrom-akpythonanywherestackhero-networkpostman-echolikescandydyndns-mailobservableusercontentserveftpfreeboxosfrom-utcdn77-storageamazonawsneat-urldyndns-serverlinodeis-a-teacherfrom-vtgleezemythic-beastsus1-pleniteu1-plenitla1-plenitpaywhirlservecounterstrikejdevcloudhealth-carereformis-into-animegoogleapisis-a-painterafricaisa-hockeynutatmetais-an-actora2hostedis-a-democratdatadetectest-le-patrondigitaloceanspacesis-a-designeris-a-hunterlinodeobjectstemp-dnsissmarterthanyoufrom-arsimplesiteevennodetownnews-stagingis-a-liberalgooglecodejelasticservemp3qualyhqpartnerdyndns-free1cooldnsest-a-la-masiondrayddnsdynuddnsfrom-orfrom-miis-a-bloggerfrom-himydobisscanvacodeis-an-engineerest-a-la-maisonupsunappdevinappswafflecellmyasustorwpenginepoweredfrom-ctservep2psame-appmyshopblocksthingdustdatalikes-piediscordsezis-with-thebandlpusercontentis-leetshopitsite3utilitiesis-a-personaltrainersinaappladeskis-a-cheflogoipselfipbase44-sandboxnospamproxyalibabacloudcsmesswithdnsauthgearappsiamallamawithgooglelutrausercontentmochausercontentframercanvasmytabitdyndns-homew-credentialless-staticblitzcpserverdiscordsaysis-a-nurseappspotatlassian-isolated-3premotewdfrom-mtwixstudiocode0emm180rmyactivedirectoryawsappsmytuleapdnsabrpolyspaceqbuserrenderbuiltwithdarkboutirgotdnsabrdnsdopaascanva-hosted-embedawsglobalacceleratorhomesecuritypcmyiphostditchyouripclever-clouddyndns-ipon-aptibleis-a-musicianhosted-by-filessecuritytacticsappspaceusercontenthomeunixstrapiappsame-previewcf-ipfsmycloudnaselasticbeanstalkis-certifieddontexistkasserverik-serverdrive-platformatlassian-3pfirebaseappherokuappawsapprunnerbarsycenteris-a-cubicle-slaveservehttpmyshopifyis-a-guruquicksytessiiitesorsitesmagicpatternsappis-a-cpameteorappfrom-wiis-a-rockstarbumbleshrimpdattolocaldatabricksappsreadthedocs-hostedfrom-rifamilydsdyndns-picsplesknsbplaceddnsaliasdynaliasdyndns-remotedoomdnsip-ddnsblogdnsis-a-doctorroutingthecloudamazoncognitobarsyonlinedsmynasddnsgurucloudflare-ipfsdeus-canvasfrom-idsmushcdnpagespeedmobilizerdyndns-at-homeunusualpersonhosted-by-previderis-a-republicandyn-o-saurstreamlitappworkisboringonthewificprapidqualifioappis-uberleetis-slickgetmyipwpdevcloudtypeformdyndns-at-workgentlentapismynascloudw-corp-staticblitzfrom-ingeekgalaxyservebeerfrom-mdonrenderspace-to-rentaivencloudappspacehostedwafaicloudcodespotblogspotatlassian-3p-us-gov-modfrom-ndfrom-msis-a-techieis-a-studentcustomer-ociis-a-photographerdurumisfrom-ksmassivegriddyndns-wikiis-an-entertaineris-a-hard-workermysecuritycamerafrom-mnrackmazedyndns-blogis-a-bulls-fanwritesthisblogfreemyipsimple-urlfrom-sdreservdauthgear-stagingest-mon-blogueuris-into-gamesrice-labsxtooldevicesakurawebis-an-anarchistoraclecloudappsdyndns-worksells-for-urhcloudfrom-dcfastvps-serverwpmucdnis-a-geekscrysecfrom-txis-into-cartoonsmodelscapetrycloudflarelocaltonetstreak-linkbalena-devicesfrom-njforgeblocksfreebox-oswebadorsitefrom-ncdoesntexisthobby-sitestreaklinkshomesecuritymacownprovidertuleap-partnersdattorelaywphostedmailservequakeis-a-socialistservehalflifepivohostingdynuhostingquipelementsw-staticblitzdyndns-webfrom-deproject-studyaliases121is-not-certifiedhercules-devis-a-financialadvisorservepicsis-a-greenloseyouripfrom-ilwithyoutubemwcloudnonprodwiredbladehostingdnsdojofrom-tnpixolinomyqnapcloudis-an-artisthostedpiis-a-landscaperauiusercontentoaiusercontenton-forgeis-a-conservativedreamhostersnet-freaksapps-1and1is-goneencoreapifastly-edgefrom-nesalesforcefrom-scdeployagentoraclegovcloudappsfrom-alis-a-lawyercechirevultrobjectsstufftoreadisa-geekddnsgeeklovableprojecttry-snowplowfrom-moblogsyteis-a-bookkeepernogmyforumravendbmyboxdeelementoredsaacficogoorinforgcomgobnatneteduidstoreorgcomnetintedudevnomepublorgcomneteduathgovtestscalculatorspaynowinfoquizzesresearchedcloudnsfunnelsassessmentsjscaleforcetmacltdorgmilcompronetgovbizpresseklogesrsccloudcustomfltusrcloude4corealmgovmunicontentproxy9metacentrumdyndyndyndnsdynpagespages-researchitionoccustomercomymyspreadshopipv64diskussionsbereich4limacomrub2ixfirewall-gatewayddnssspdnsbarsykeymachinesquare7myhome-serverspeedpartnercommunity-proschuldockxenonconnectg\xFCnstigliefernbwcloud-os-instancedyndnssecmy-routerxn--gnstigliefern-wobin-butterl-o-g-i-nisteingeekin-dslin-berlinin-brbfuettertdasnetzleitungsenin-vpnlcube-serverdyn-ip24logoipdyn-berlinruhr-uni-bochum12hpgoipsrvdnsfruskygit-repossvn-reposinternet-dnsg\xFCnstigbestellenhome-webserverxn--gnstigbestellen-zvbbplacedheimdnscosidnswebspaceconfiglima-citydyndns1istmeinvirtualuserschulplattformmy-gatewayddnsseclebtimnetztest-iservmein-iservvirtual-userhome64iservschuletaifun-dnstraeumtgeradeschulserverdynamisches-dns123webseitednshomehs-heilbronndnsupdaterbssgraphicdwadpdwdaepeweaawapaafpfwfabwbpbacwcpcciwebuserapiobjectsidsiskospockkimodorikerbonesteamsparisjanewaypicardglobaltarpitreedpikekiraworfsulukirkarchertuckerhackercanarywesleystagingprereleaset3r2lpbravepanelngrokiservstglclcrmerpflypagesbarsyvivenushoplocalcertlocalplayerbearbloggatewaydeno-stagingis-not-ais-a-goodbotdashvercelmocha-sandboxplatter-appreplitgithubpreviewworkersinbrowserevervaultis-ahrsndenoxmitmodxmyaddrstorageapipayloadgrebedocruncontainersstgstagelclstageloginlineis-a-fullstackcodepenleapcellngrok-freeis-coolstoragewebharemediatechlibp2pdiscourseimaginecomyspreadshopstoreregbiz123hjemmesidefirmcoorgcomnetedugovsldorgmilcomwebgobartnetedugovtmorgpolcomsocartnetedugovassoagrondiscoodontk12medcuegyecpaabgengorgmilgalsaltulcomadmesmgobpubdocmonfindgnriouioproartlatvetnetfotedulojgovntrturibrbarxxxofficialbasechefprofmktgpsictechinfoarqtcontdentrrpppsiqgit-pagesritmedfieorgcomlibprieduaipgovriikmeactvsportorgmilcomscieunnetedugovnameinfopintouchtawktotawkmyspreadshoporgcomnomgobedu123miwebcomputeorgcomnetedugovbiznameinfocognito-idpeusc-de-east-1onjelasticnxaspdnsbarsydirectwpdeuxfleurstransurldogadoprvwcloudnsamazonwebservicesdnshomeuserpartycokoobinmkmfidymyspreadshopalandkapsiikixn--hkkinen-5wacloudplatformh\xE4kkinen123kotisivuidacorgmilcompronetedugovbiznameinforadioorgcomneteduuserexperts-comptablestmmyspreadshopgretaprdcomnomynhccifbxoshuissier-justicenotairesaeroportfreeboxoson-webavocatassoportgouvkdnschirurgiens-dentistes-en-franceavouesfbx-os123sitewebveterinairechirurgiens-dentistespharmacienchambagrimedecinfreebox-osdediboxgoupilemszicpyicpvicppleysheezypagesedugovcnpyorgcomcybllcpvtnetedugovtnxonlineschooldaemond6atcopanelorgnetplybotdashstackitkaasorgmilcomnetedugovbizmodltdorgcomedugovcoorgcomneteduappwriteacorgcomnetedugovcloudtranslateusercontentorgcomnetedumobiassoorgcomnetedugovbarsysimplesitediscourseindorgmilcomgobneteduorgcomwebnetedugovguaminfonxhra\u6559\u80B2\u654E\u80B2\u7DB2\u7D61\u7F51\u7D61\u7EC4\u7E54\u7D44\u7E54\u7F51\u7EDC\u7DB2\u7EDC\u7EC4\u7EC7\u7D44\u7EC7\u516C\u53F8\u653F\u5E9C\u500B\u4EBA\u4E2A\u4EBA\u7B87\u4EBAltdorgcomincneteduidvgovxn--uc0ay4axn--55qx5dxn--mk0axixn--io0a7ixn--uc0atvxn--zf0avxxn--lcvr32dxn--od0algxn--wcvs22dxn--gmqw5axn--od0aq3bxn--mxtq1mxn--ciqpnxn--tn0agxn--gmq050iorgmilcomgobneteduiservwp2tempurlmircloudfreesitewpmudevmyfastgadgetcloudaccessjelehalfboltfastvpsemergenteasypanelopencraftizcombrendlynamefromrtpersoadultmedorgpolrelcomproartnetedufirminfoassoshopcoopgouvtmcomediahotelforumvideosportorgsexagrargameslakaseroticaerotikatozsdereklamcasino2000filmsuliinfoboltshopprivnewsszexcityutazasjogaszkonyveloingatlaneacaicogoormy\u1B29\u1B2E\u1B36milwebschnetkopbizzonedesaponpesxn--9tfkymyspreadshopgovmytabittabitorderravpageaccok12idforgnetgovmuniltdplcaccotttvorgcomnetmeca6g5gpgamubacaicniocoukuptverdruscsdelhiindorgmilcomwebnicfingenpronetintedugovresbizbiharbarsyinternetbusinessschooltravelsupabasealumnigujaratfirminfoaeropostbankcoopindevscloudnsno-ipbarsybarrell-of-knowledgebarrel-of-knowledgensupdategroks-thisdnsupdatefor-ourknowsitalldvrcammittwalddynamic-dnsv-infowebhopselfipdyndnshere-for-moreilovecollegemayfirstforumzcloudnsmittwaldservertypo3servergroks-theeusekd1cdndyndnsidrawsainaueuapjpusstagemocksysdevicesclientcustreservdcustdevdisrecprodtestingcobeebyteutwenteboxfusebravepstmndedynngrokorgmilcomnomnetedugovqcxqzzbarsythingdustmo-siemensrb-hostingfh-muenstergitbookbluebitecloudbeesusercontentnodeartkiloappsforgerockdarklangresinstagingapigeebubbleb-datascryptedhypernodedappnodepantheonsitegitlabgithubkeeneticvirtualservercleverappshostyhostingon-rioedugitticketstelebitwixstudioon-k3sicp0icp12038jeleqotolairbubbleappsmyaddrstolosmyrdbxwebflowdrive-platformbeagleboardhasura-applolipopdefinimavaporcloudmusicianwebflowtestazurecontainerresindevicereadthedocsloginlineeditorxmoonscalesandcatsbasicserverwebthingsbrowsersafetymarkbeebyteappbitbucketidaccovistablogorgschnetgovxn--mgba3a4f16axn--mgba3a4fraarvanedge\u0627\u064A\u0631\u0627\u0646\u0627\u06CC\u0631\u0627\u0646jclaspeziapdudcefegelemeperetevebacanatavaparasabgagfgogrgpgalclblimfmrmcbmbvbfclcmcvcrcpcchlimifibicivipirisimncnbnanenrnpntnnolomobocoaogorosopotoptvtatctbtmtltotpusulunutpspapaqsvpvvvtvavvrtrsrprgrfrcrbrarorkrvstsssbscsmsispzczbzbozen-suedtirolmyspreadshopxn--bulsan-sdtirol-nsbxn--valledaoste-ebbtrentinoaltoadigetrentin-sued-tirolxn--forlcesena-c8axn--forl-cesena-fcbxn--bozen-sdtirol-2obtriestetrentinsuedtiroltrentino-s-tirollecceudineaostesienaparmaluccapaviagenoapaduaaostamonzaabruzzoternirietiturinmilanbozenlaziofermoleccocuneonuoropratola-speziavdataaligfvgpugmolcalcamlomumbsicpmnvenvaoedugovabrsarmaremrbastoslazibxosfirenzetrentinos\xFCdtirolval-d-aostavalle-aostamessinacremonaravennatoscanatrentin-suedtirolbolognacalabriaurbinopesarofriuli-v-giuliaogliastraxn--valle-aoste-ebblaquilaandriatranibarlettasyncloudxn--valle-d-aoste-ehbaostavalleyvalled-aostatrentino-alto-adigevallee-d-aostexn--balsan-sdtirol-nsbpistoiasicilialucaniacataniaiserniaperugiabresciaveneziagorizialiguriaimperiabulsan-suedtirolbalsan-suedtirolbarlettatraniandriaxn--trentino-sdtirol-szbforl\xEC-cesenatuscanyvall\xE9e-d-aostemantovavall\xE9e-aostecasertapiemontevalleaostaval-daostafriulivgiuliatrevisoforli-cesenavall\xE9edaosteferrarapescaravald-aostatrentino-altoadigefriuli-vegiuliavallee-aostecarboniaiglesiastarantomediocampidanovalleedaostetrentinosud-tirolcampobassotrentins\xFCd-tiroltrentinos\xFCd-tirolmonzabrianzatrentino-s\xFCdtirolxn--trentino-sd-tirol-c3bpotenzacosenzavicenzaemiliaromagnavenicefrosinonemarchepordenonetrentinosued-tirolvaresemolisevall\xE9eaostefriuli-veneziagiuliabasilicatalatinaanconasavonaveronamodenabiellabolzano-altoadigepugliafoggiaumbriatrentino-stirolgenovapadovamateranovararagusapiacenzatrentinostirolvalleeaostetempio-olbiasudsardegnatrentinsudtirolmassa-carrarafriuliveneziagiuliatrentinosuedtirolandria-barletta-tranitrapanixn--cesenaforl-i8amaceratacaltanissettaascoli-picenobrindisicarraramassacagliaririmininapolivibo-valentiachietibulsan-sudtirolbalsan-sudtiroltrentino-a-adigebulsanbalsaniglesiascarboniamilanotorinoteramodell-ogliastraarezzotrentinoalto-adigerovigotrentovenetoiglesias-carboniatrentino-sud-tirolaltoadigereggio-emiliareggio-calabriasardegnatranibarlettaandriapiedmontxn--sdtirol-n2amedio-campidanotrentino-s\xFCd-tirolfriuli-vgiuliafriuli-ve-giuliaromeennaromapisa32-b16-b64-blodiastibarineencomonaplesforlicesenailiadboxosalessandriasicilytrani-barletta-andriaxn--trentin-sdtirol-7vbpesarourbinotrentinsued-tirolcesena-forliforl\xECcesenaemilia-romagnamonzaebrianzaxn--trentinsdtirol-nsbtrentinos-tiroltrentins\xFCdtirolvalledaostaolbia-tempiocampidanomediovibovalentiasassarivalle-daostalombardysud-sardegnafriulivegiuliareggioemiliamonzaedellabrianzaalto-adigevercellitrentin-sudtiroltraniandriabarlettatrentino-sudtirolascolipicenobozen-s\xFCdtirolfriulive-giuliaflorencexn--cesena-forl-mcbcarbonia-iglesiasaosta-valleycarrara-massadellogliastratrentinoa-adigexn--valleaoste-e7apesaro-urbinoxn--trentinosdtirol-7vbxn--trentin-sd-tirol-rzbxn--trentinsd-tirol-6vbtrani-andria-barlettatrentin-s\xFCd-tirolxn--trentinosd-tirol-rzbgrossetomonza-e-della-brianzas\xFCdtirolreggiocalabriatrentinoaadigetrentin-s\xFCdtirolverbano-cusio-ossolafriuliv-giuliaverbaniacampaniatrentino-aadigefriulivenezia-giuliasardiniaandriabarlettatranibarletta-trani-andriacatanzarooristanourbino-pesarocesena-forl\xECvalle-d-aostacampidano-medio123homepagesiracusatempioolbiasuedtirollombardiaavellinocesenaforl\xECtrentinofriuli-venezia-giuliabozen-sudtirolandria-trani-barlettabulsan-s\xFCdtirolbalsan-s\xFCdtirolmonza-brianzabolzanotrentino-sued-tirolbellunosalernolivornocrotonesondriodnshometrentinsud-tirolmassacarraratrentin-sud-tiroltrentino-suedtirolviterbobergamocesenaforliolbiatempiopalermobeneventoagrigentoofcoorgnetfmaitvphdengorgmilcomschnetedugovperagrikanieasukehandachitatokaiaisaikonanoharuamaobuhigashiuraowariasahiinuyamatobishimaiwakurashitarainazawatoyonegamagorimihamatoyotataharakariyayatomioguchikomakimiyoshinishiotokonamekiyosuchiryutoyohashiokazakiisshikikasugaikotakiratoeianjotogofusosetohazutsushimashinshirotakahamanisshinshikatsuhekinantoyokawaichinomiyatoyoakeodateogataakitaikawakyowahonjoogayurihonjonoshirokamiokakatagamimitanegojomeyokotekosakadaisenkazunonikahohonjyomoriyoshimisatohappoukamikoanihachirogatahigashinarusesembokufujisatokitaakitaitayanagiowanitakkomutsutsurutahirosakigonoheoirasetowadamisawanohejiaomorishingohiranairokunohehashikamitsugarushichinohehachinohenakadomarisannohekuroishisakaeisumiasahiotakiinzaiabikomatsudoyachiyomutsuzawakujukuriomigawakashiwatoganemihamanaritasakuranagaramobarahanamigawachoshishiroichoseikozakishisuikatorimidorichonankyonanfuttsuonjukufunabashinagareyamanodasosatakochuotohnoshourayasukimitsuyokaichibayotsukaidosodegauratateyamakamagayayokoshibahikariyachimatakatsuuratomisatokisarazukamogawaichikawanarashinoichinomiyashimofusaminamibososhirakoichiharaoamishirasatoikatahonaiainansaijoseiyoiyoozuuwajimaniihamanamikatamasakiuchikokihokutobetoonshikokuchuomatsuyamaimabarikamijimakumakogenyawatahamamatsunosabaeikedaobamasakaifukuiohionotsurugamihamawakasaminamiechizeneiheijikatsuyamatakahamaechizensoedaukihaomutaokawanishiogoribuzenonojosueumiokiotochikugosasagurisaigawamizumakishinyoshitomikurumekurateyamadakasuganakamamiyamanogatatakatahakataiizukakawaratagawakasuyaashiyainatsukimunakataminamitsuikishonaikurogifukuchikeisenhigashimiyakoshinguyukuhashiokagakiyamekogaongausuikahotohochuotoyotsumiyawakadazaifuhisayamatachiaraiyanagawanakagawahirokawachikujochikushinochikuhochikuzennamieotamaokumashowateneiiwakikoorinangoononishigoshimogoomotegomishimafukushimaasakawakagamiishishirakawaiitatefutabahiratayugawahanawakitakatakawamatakunimiyabukibandaihigashihironoyamatomiharuyamatsuriaizubangedatesomaaizuwakamatsuyanaizuaizumisatonishiaizuizumizakikitashiobarataishinkaneyamakoriyamainawashirotanagurafurudonosamegawasukagawaishikawatamakawaikedaogakitaruiginanenahashimahichisonakatsugawaibigawashirakawamizunamiminokamomitakekawauesekigaharatomikasakahogikitagatayamagatatajimianpachimotosuyaotsukakamigaharahidakanisekitokigujominogodoyorogifukasamatsutakayamawanouchihigashishirakawakasaharashimonitatsumagoichiyodakannakanrashowameiwakiryuotaoratomiokafujiokaitakuranaganoharahigashiagatsumatakasakishibukawaminakamikatashinatsukiyonokawabanumataannakaoizumimidorishintoisesakiuenoyoshiokakusatsutakayamanakanojonanmokutamamuratatebayashimaebashiotakekaitadaiwahongofuchukuietajimashobaramiharahatsukaichihigashihiroshimamiyoshikumanokurenakasakaseraseranishiasaminamifukuyamashinichionomichiosakikamijimajinsekikogentakeharaotobenanaeikedatohmaozoraobiraabirakyowaeniwataikibibaisharirebunerimohiroooketootarupippunishiokoppechitosefurubirahakodateshiranukakitahiroshimakushiroobihironanporoiwamizawaniikappukunneppufukushimanakasatsunaitoyourakuromatsunaiakabirakamisunagawashibechaurakawakamifuranonakatombetsuasahikawashimokawakayabeokoppebiratoriabashirisaromaatsumanumatahidakabifukamukawamikasahorokanaitoyotomisarufutsuhigashikawaishikarikitamiyoichiesashiiwanaitomariminamifuranoakkeshifuranotoyakoyakumootoineppushikaoishiraoinemuronayorohaboroashorobihororishirifujiutashinaihokutotakasuebetsuurausuassabukikonaishimamakinaiedatetoyabieinikiesanuryuoumuteshikagarikubetsuashibetsukimobetsuaibetsutobetsusobetsuembetsushimizuchippubetsurishirihokuryuhoronobeshintokutsubetsushibetsuhonbetsumombetsutsukigatakuriyamakoshimizushiriuchikutchanmurorannoboribetsukamishihorowassamushinshinotsukembuchiwakkanaikamoenaikiyosatotakinoueshikabesunagawafukagawanakagawatakikawakamikawahigashikagurahamatonbetsumatsumaemoseushirankoshishakotanimakanemashikeotofuketomakomaisandatambaitamiawajikasaiasagoshisoonoakoyashirotoyookaminamiawajiinagawafukusakitakasagokamigorikasugaharimayokawaashiyahimejiakashitaishiaogakisannantakinosumototakarazukanishinomiyashingugoshikinishiwakiyokatakaaioimikisayoyabukawanishiamagasakisasayamashinonsenkakogawaichikawakamikawatatsunotsukubaiwamaogawaasahisakaitokaioaraiitakobandodaigosuifuinaamikasumigaurakashimaomitamayachiyoshimodatetomobetoridehitachinakainashikisakuragawakasamayawaramoriyahitachiomiyanamegatayamagatahitachikamisuushikutakahagiibarakitonekoganakasowayukimihojosomitoryugasakishimotsumafujishirotsuchiurachikuseihitachiotashirosatotamatsukuriuchiharashikahakuinanaotsubatawajimakahokukawakitatsurugikaganominotosuzuuchinadakomatsuanamizunakanotohakusannonoichikanazawaiwateshiwafudaikawaimoriokaofunatohanamakikuzumakikitakamininohekunoheyamadayahabasumitaichinosekitanohatahiraizumirikuzentakatajobojiotsuchihironomiyakoiwaizumikarumaiichinohenodakujitonooshushizukuishifujisawamizusawakamaishikanegasakimannoutazukotohiraayagawazentsujihigashikagawauchinomikanonjisanukimarugamemitoyotakamatsutadotsunaoshimatonoshoakuneamamiizumihiokiyusuikinkoisasookouyamanakatanekagoshimakanoyaisenkawanabeminamitanemakurazakitarumizunishinoomotematsumotosatsumasendaioimatsudaayaseebinamiurazushinakaiodawaraiseharasagamiharahakoneaikawakaiseiatsugitsukuihadanoyamatoyamakitazamaoisochigasakininomiyayokosukakamakuraminamiashigarafujisawasamukawakiyokawahiratsukayugawaraokawaumajikochitsunootoyoakiinonishitosayasudahidakamiharasakawaniyodogawahigashitsunokagamigeiseisusakiotsukinaharisukumomurototosakamiochitoyotosashimizumotoyamanankokunakamurakitagawayusuharaogunichoyoukiasoutoozugyokutoamakusamifunetakamoriyamagaminamataminamiogunikikuchisumotoyamatonagasumashikiaraokumamotokamiamakusanishiharayatsushiroayabeseikasakyoideineujinakagyokameokakyotangokyotanabekyotambaminamiyamashiroyamashinatanabeyawatawazukaminaminantanmiyazuhigashiyamafukuchiyamakitamukokamojoyokizumaizuruujitawaraoyamazakinagaokakyokumiyamakawagoeinabeshimameiwaasahitaikiudonoisetsukisosakikuwanamihamamiyamasuzukatamakimisuginabarikumanokomonominamiisewataraitobakiwatakikihotadomatsusakayokkaichikameyamaureshinoishinomakishichikashukuohirataiwaosakizaohigashimatsushimashikamaiwanumashibataogawaraonagawakawasakiseminemarumoriminamisanrikukakudamuratawakuyatomiyanatoriwataritagajomisatotomekamirifushiroishimatsushimayamamotoshiogamafurukawahyugaebinotsunosaitoayakushimanobeokakitauramiyazakitakazakigokaseshiibamimatashintomikunitomikitakatakobayashikawaminamitakaharukijotakanabemiyakonojonishimeranichinankitagawakadogawamorotsukakisofukushimaminamimakisakaeobuseikedaogawamiasaokayaasahiotakiotarichinoinaomichikumakomaganechikuhokukaruizawayasuokaooshikaikusakaminamiaikitogakushimatsukawakawakamitateshinatakamorikitaaikishiojirimiyadahakubaiizunaiijimaiiyamamiyotasuzakayasakatoguraookuwanagawaminowahirayayamagataminamiminowafujimiomachisakakitakaginaganonakanosakuhokomoronagisoshinanomachiwadauedaiidaharasuwatomiachiaokianankisosakunozawaonsenagematsutakayamashimosuwamatsumotoyamanouchinakagawamochizukiazuminotatsunoobamaomuraseihiunzenosetofutsuikichijiwanagasakiisahayahasamisaikaikawatanasasebohiradokuchinotsugototogitsutsushimashimabarashinkamigotomatsuurayamazoekashibaikomakawaitenrioyodosangokoryoudaojiikarugayamatokoriyamatenkawakatsuragikurotakikawakamimiyakemitsuetakatorikamikitayamayamatotakadahegurishinjokanmakisakuraitawaramotogoseoudanarasoniandokawanishishimoichihigashiyoshinokashiharashimokitayamanosegawayoshinomintsivorytopazsakuragehirnsumomoaseinetopalmail-boxmokurenyoitamuikaojiyagosensanjoaganomyokoseiroagaomishibataniigatanagaokamurakamiuonumayuzawakariwatagamitainaitsunanminamiuonumatochioyahikojoetsuseiroukamosadoizumozakitokamachiitoigawasekikawakashiwazakitsubamemitsukekokonoesaikiusukibeppuusahimeshimakunisakihasamataketatsukumihitaoitahijikusuyufukujukamitsuebungoonobungotakadaibaraniimibizentsuyamaokayamakasaokahayashimayakagemaniwaakaiwamisakishinjotamanotakahashikibichuowakesojanagishookumenannishiawakurakurashikiasakuchisetouchikagaminosatoshotomigusukunakagusukuyaeseizenaurumaiheyaaguniogiminanjokinminamidaitokitanakagusukuyonaguniokinawaishigakikunigamiurasoekadenataramahiraraginozataketomishimojizamamitonakiitomanhigashimotobuyonabarugushikamionnanahanagohaebarukumejimakitadaitonakijinnishiharayomitanginowantokashikiishikawaikedasuitaminohizuminishisakaikananabenodaitoosakasayamayaokishiwadatadaokakaizukatondabayashichihayaakasakakumatorikadomasayamahigashiosakashijonawatehirakatataishimisakitajirihannansennankatanotoyonominatosettsuhigashiyodogawaibarakinosekitachuohigashisumiyoshifujiiderakashiwaraizumiotsutoyonakamatsubaramoriguchiizumisanoshimamototakatsukineyagawahabikinotakaishikawachinaganoyoshinogarikamiminearitaouchiimarihizenogikashimaariakekiyamafukudomikitagatakitahataomachigenkaikanzakinishiaritakyuragisagataratosutakushiroishikaratsuhamatamakouhokukawagoeyoshidasatteogoseirumaasakaurawaogawaniizaomiyayoriiotakishikihonjooganohannohanyuinasaitamaokegawaarakawayoshikawayokozehasudasayamahidakafukayachichibuiwatsukiryokamiyoshimikamiizumifujimiwarabiranzanmiyoshiminanoyashiosakadosugitomisatohigashichichibutodasokakukiyonokazoshiraokakasukabekounosukawajimatsurugashimamiyashirokitamotohatoyamamoroyamahatogayakumagayakawaguchinagatorokamisatomatsubushinamegawatokigawakamikawafujiminohigashimatsuyamakoshigayatokorozawas3isk01isk02ryuohkoseikonanaishorittotakashimamaibarahikonetorahimenishiazaikokagamokotoyasuotsukusatsunagahamamoriyamatoyosatotakatsukinotogawaomihachimanhigashiomiakagiunnanizumogotsuamayatsukakakinokimatsuehamadamasudahikawahikimiokuizumoyasugiyakumomisatotamayuohdahigashiizumookinoshimanishinoshimatsuwanoshimaneshimadafujiedayoshidashimodagotembaiwataatamikosaiyaizuitoizumishimahaibaramakinoharaomaezakikawanehonkannamisusonohigashiizufukuroinumazukawazufujiaraishizuokahamamatsushimizuizunokunimatsuzakimorimachiminamiizunishiizukikugawakakegawafujikawafujinomiyaujiietsugaoyamayaitaohiranikkoashikagakuroisokanumasakurashioyakarasuyamamotegiichikaikaminokawatochigihagamokanogisanobatonasumibunasushiobaranishikatautsunomiyaiwafunemashikoshimotsukeohtawaratakanezawaitanokomatsushimatokushimaichibaminamiaizumiwajikikainanmiyoshinarutomimamugiananmatsushigesanagochishishikuinakagawamachidachiyodakomaefussainagitaitochofufuchuomeotahigashiyamatotoshimaokutamaaogashimakodairaedogawaarakawahachiojishinagawatachikawashibuyasuginamihinodekiyosesumidaoshimanerimamitakahamuraadachinakanomizuhobunkyomegurominatokoganeihigashikurumekokubunjihigashimurayamamusashimurayamatamakitahinochuokotokatsushikakouzushimaogasawaraakishimakunitachishinjukusetagayamusashinohachijoitabashiakirunohinoharachizunanbukotouramisasawakasayonagokogehinoyazutottorinichinansakaiminatokawaharaoyabetairainamiasahinantoimizufuchutakaokakurobeyamadajohanatoyamatonaminyuzenfunahashinakaniikawanamerikawaunazukitogahimiuozufukumitsutateyamakamiichiiwadearidayuasainamitaijikatsuragiaridagawatanabemihamahidakakainankiminomisatoshingushirahamakamitondayurakozakoyagobokitayamawakayamakudoyamahashimotokushimotokozagawahirogawakinokawanachikatsuurarsuseroeoishidasagaeoguniasahinagaitendonanyoobanazawanishikawasakataohkuratozawamikawamamurogawayamagatafunagatatakahatashonaishinjokahokuiideyuzakawanishitsuruokakaminoyamayamanobeshiratakamurayamanakayamakaneyamahigashineyonezawasakegawamitouubeyuuabushimonosekitabuseoshimatoyotaiwakunihikarishunannagatohagihofukudamatsutokuyamashowadoshitsurunanbukoshukaiminami-alpsnirasakikosugeotsukioshinohokutominobuyamanashifuefukichuokofuichikawamisatoyamanakakonakamichitabayamanishikatsuranarusawafujikawahayakawafujiyoshidafujikawaguchikouenohara\u9577\u91CE\u4EAC\u90FD\u5C90\u961C\u5927\u962A\u4E09\u91CD\u7FA4\u99AC\u5343\u8449\u6ECB\u8CC0\u4F50\u8CC0\u5948\u826Fadednelgaccogogror\u79CB\u7530\u611B\u77E5\u9AD8\u77E5\u57FC\u7389\u6C96\u7E04\u6803\u6728\u718A\u672C\u5CA9\u624B\u9752\u68EE\u5C71\u68A8\u65B0\u6F5F\u5CF6\u6839\u9CE5\u53D6\u9577\u5D0E\u9999\u5DDD\u5BAE\u57CE\u77F3\u5DDD\u5927\u5206\u5BAE\u5D0E\u8328\u57CE\u5C71\u53E3\u5175\u5EAB\u5C71\u5F62\u5FB3\u5CF6\u5E83\u5CF6\u798F\u5CF6\u798F\u5CA1\u5CA1\u5C71\u5BCC\u5C71\u9759\u5CA1\u611B\u5A9B\u798F\u4E95\u6771\u4EACxn--4it168dhatenadiaryxn--vgu402ckawaiishophatenablogcocottenamaste\u5317\u6D77\u9053penneehimeiwateversestabachibashigagonnagunmapermahaccaakitaosakauh-ohblushkochiaichifukuikuroncapooitigohyogotokyokyotopunyuthickcheap0t00g00j0mie2-ddaapyawjg0amfemsubxiiboomoobutchueekpgwrgrherskrboyrdyupperunderflierchipsmydnsheavyangryhippygirlyrulez\u795E\u5948\u5DDD\u9E7F\u5150\u5CF6\u548C\u6B4C\u5C71bambinaxn--nit225kokayamasaitamaxn--k7yn95exn--1lqs03nsapporoparasitelolipopmcxn--efvn9sniigatafukuokatokushimafukushimahiroshimakagoshimafakefurokinawaxn--8pvr4ucoolblogxn--0trq7p7nnkawasakinagasakimiyazakichilloutxn--8ltr62kxn--klty5xpeeweezombiecutegirlxn--rny31hxn--uuwu58axn--ntso0iqx3axn--djrs72d6uytoyamanikitanyantakagawamimozanagoyaboyfriendxn--2m4a15egreaterchowderegoismyamagatafashionstorexn--elqq16hxn--pssu33lsendaimiyagixn--rht27zpecoriaomorisaloonwatsonvivianxn--djty4knobushipigboatnaganopinokoxn--f6qx53asadistvelvetsecretxn--5js045dchicappayamanashiibarakidigickgirlfriendxn--1lqs71dmongolianxn--c3s14mxn--qqqt11mtochigixn--5rtq34kparallelo0o0mondkobesagabonadecaoitanarafoolkilldecimainhiholomosblokilociaoundopupugifutankcrapflopnooroopsmodsholyjeezstripperpepperbittershizuokaxn--rht3dkitakyushureadymadeicurusversusmatrixxn--rht61ehungryfloppygloomycrankyhandcraftedlittlestarxn--klt787dxn--kltx9awhitesnowsunnydaytottorilovepoptheshopbuyshopxn--5rtp49cxn--d5qv7z876cwebaccelxn--kbrq7oxn--4pvxsxn--1ctwolovesickkumamotocatfoodxn--tor131oyokohamawakayamatonkotsuxn--ehqz56nxn--uist22hxn--6btw5axn--kltp7dyamaguchifrenchkisspussycatxn--4it797kxn--uisz3gbabybluexn--zbx025dnetgamersxn--7t0a264ckanagawaxn--6orx2rishikawaxn--ntsq17ghalfmoonschoolbusjellybeanxn--mkru45iusercontentlolitapunkxn--32vp30hsakurastoragehokkaidoshimanecandypopbabymilksupersaleweblikeraindropbackdropwebsozaikikirarahateblodaynightmeneacsccogoormobiinfoaeusxxorgmilcomnetedugovorgcomnetedugovbizinfotmprdorgmilcomnomedugovassnotairespresseassocoopgouvveterinairemedecinpharmaciensorgnetedugovtraorgcomedurepgovmeneperekgacscaiiocogoitoresmshsseoulbusanulsandaeguc01milvkimmvchungnamjeonnamjeonbukeliv-dnsgyeonggijejueliv-cdnincheondaejeongangwongyeongbukgwangjuchungbukgyeongnameliv-apicoeduindorgcomembnetedugovorgmilcomnetedugovjcloudorgcomnetintedugovperbnrinfocooyorgcomnetedugovethipfscanvamypepethw3sstorachakeeneticjoinmcinbrowserdwebcyonnftstoragemyfritzaemewphlxachotelltdorgcomwebsocschngonetintedugrpgovassnomgacsccoorgnetedugovbizinfo123websiteidorgmilcomasnnetedugovconfidmedorgcomplcschnetedugovaccoorgnetgovpresstmassoirseproxaccosoundcasthoptocraftvp4c66orgnetedugovitsmcdirmyboxbarsyedgestacksynologylogintoopencloudnohostwebhopdiskstationi234tcp4hoocgroknoipprivmydsddnsdnsforlohmustransipdscloudfilegear-sgbrasiliafilegearframerbarsybarsyonlinecoprdorgmilcomnomedugovinforgcomnetedugovnameacprorgcomartnetedugovpresseinfoassoinstgouvorgnycedugovbarsydscloudjuorgcomnetedugovminisiteaccoororgcomnetgovorgmilcompronetintedugovbizmuseumnameinfoaerocoopaccoorgcomnetintedugovbizcooporgcomgobneteduorgmilcomnetedugovbiznameaccoorgmilneteduadvgovcoorgcomnetaltgovforgotherhiskeeneticispmanagernomassoprod5476132eastasiacentraluswesteuropewestus2eastus2pnortheurope-01newzealandnorth-01southindia-01southcentralus2-01norwaywest-01eastus2-01westus2-01australiaeast-01italynorth-01israelnorthwest-01swedencentral-01westeurope-01centraluseuap-01taiwannorthwest-01uaecentral-01northcentralusstage-01israelcentral-01mexicocentral-01canadacentral-01austriaeast-01germanywestcentral-01francecentral-01ukwest-01denmarkeast-01polandcentral-01eastus-01westus-01swedensouth-01eastus3-01westus3-01brazilsouth-01centralus-01francesouth-01australiacentral-01westindia-01uaenorth-01jioindiacentral-01canadaeast-01belgiumcentral-01spaincentral-01koreacentral-01chilecentral-01qatarcentral-01westcentralus-01eastus2euap-01norwayeast-01southafricanorth-01brazilsoutheast-01germanynorth-01switzerlandnorth-01switzerlandwest-01japanwest-01southafricawest-01japaneast-01eastasia-01indiasouthcentral-01taiwannorth-01centralindia-01uksouth-01southcentralus-01northcentralus-01eastasiastage-01indonesiacentral-01australiacentral2-01australiasoutheast-01malaysiawest-01koreasouth-01southeastasia-01southeastus5-01northeastus5-01jioindiawest-01rucdnwest1-usfra1-desandboxjls-sto1jls-sto3jls-sto2aglobalabglobalsslmapprodfreetlsmapvpslon-1lon-2ny-1fr-1sg-1ny-2paassnwebpaashostingjelasticnordeste-idcsocuserpagescwebfileblobservicebuscoreatlricnjsjelasticwebsitestoragesezagbinruhuukjptsmyspreadshopmynetnameakamaiorigin-stagingfrom-coipv64dynv6cdn77serveblogadobeaemcloudhicamsprytdnsupno-ipownipde5ovhicpfirewall-gatewaysytesmypsxbarsyusgovcloudapimyamazemyradwebakamaihdsaveincloudfastlylbfrom-lasubsc-paysquare7in-the-bandblackbaudcdnhomelinuxoninfernoctfcloudservebbsdns-dynamiccloudfrontakamai-stagingipifonyham-radio-opsenseeringclickrisingcommunity-profrom-nylocalcertgrafana-devedgesuite-stagingcloudflareanycasteating-organicatlassian-devmydattofeste-iplocaltotorprojectknx-serveredgekeycloudflareglobalcloudyclustercasacamserveftpakamaized-stagingakamaiorigindns-cloudmyeffectboomlabotdashbuyshousestwmailhetemlazure-mobilein-dslthruhereredirectmedynuddnsbouncemesupabaseluyanicloudappakamaicloudfunctionsdebiannhlfanpgafanstatic-accessin-vpnmysynologymafeloappudohomeftptrafficmanagersiteleafseidatmemsetcloudflarecloudaccesskeyword-onazure-apiis-a-chefdoes-itgets-itwebhopselfiphomeipkicks-assedgesuitewindowsserver-ontunnelmolemydissentscrapper-sitecloudflarecnuni5srcfggffiobbzabchrsndenodynuopikddnsvpndnsakadnselastxkinghostvps-hostfastlyhomeunixazureedgeshopselectdontexistmyfritzcloudjiffyalwaysdatasells-itsquaresbroke-itazurefddattolocalat-band-campmeinforumfamilydsazurestaticappsdefinimabplaceddnsaliasdynaliasnow-dnsblogdnsroutingthecloudendofinternetdsmynasakamaiedgemymediapcadobeio-staticakamaiedge-stagingakamaihd-stagingddns-ipprivatizehealthinsurancelive-onkrellianschokokeksmassivegridmysecuritycamerarackmazeserveminecraftfrom-azis-a-geekakamaizedmoonscaleoffice-on-theusgovtrafficmanageradobeioruntimeedgekey-stagingreserve-onlinechannelsdvrdnsdojousgovcloudappcdn77-sslapps-1and1podzoneazurewebsitesdynathomescaleforceyandexcloudvusercontentisa-geekcdn-edgescoaemalcesappwriteazimuthtlonarvobuiltwithrocketnoticeablestorecomwebrecnetperotherfirminfoartslgdloncogoiltdorgmilcolcomplcschgenngonetedugovbiznamefirmmobiacincoorgmilcomnomwebgobnetintedubizinfocomyspreadshopdemongovtransurl123websitehosting-clusterkhplaycistrongsnesosvalerv\xE5lerxn--vler-qoaossandeheroysandeher\xF8yb\xF8boheroyher\xF8yxn--hery-iraxn--b-5gavalerb\xF8boxn--b-5gasandesandexn--hery-iraxn--vler-qoav\xE5lerh\xE5re\xE5laahavaofsfvfhlolnlalrlhmfmtmahcostntbu\xE5strmreigersundmyspreadshopg\xE1ls\xE1eidsvolltingvollgildeskalflor\xF8vads\xF8vard\xF8vanylvenxn--bhccavuotna-k7astrandaxn--kvnangen-k0axn--sknland-fxaxn--mosjen-eyarakkestadhyllestadnannestadvevelstadvaapstenordre-landsondre-lands\xF8ndre-landtjieltexn--vrggt-xqads\xF8r-aurdalsor-aurdalheradstordmoldefordef\xF8rdeseljefedjeryggehemnexn--krehamn-dxasognegranes\xF8gnebrynetjomevallebykletokkegiskedovretj\xF8mehob\xF8lvoldasaudatolgas\xF8mnaviknad\xF8nnasomnadonnatranafrananesnaraumasmolatr\xE6nafr\xE6nalesjasm\xF8la\xF8rstaorstahitrafloraaukraloppafr\xF8yarissasnasahalsagalsaromsaraisar\xE1isafroyasn\xE5sagronghobolfjelltydal\xE5rdalardalaskimharamkraanghkekr\xE5anghkesorumbarumhurumb\xE6rums\xF8rummodums\xE1l\xE1tb\xE1l\xE1tfrognbjugnv\xE5ganvagangulenskienl\xF8tenlotenstrynvefsnxn--merker-kuaskaunsveiob\xF8mlobomloskj\xE5kvardoflorovadsosalatbalats\xE1latkl\xE6buklabuselbubarduulvikskjakkleppris\xF8rxn--nttery-byaefl\xE5eidflahofmilgolholsellomskifetvikdepvgsfhsaskerrisorhamarasnes\xE5snesr\xF8rosrorosxn--slat-5namasoynaroyvaroyluroydyroyaskoyradoyandoyrodoymeloyrad\xF8yand\xF8yr\xF8d\xF8ymel\xF8yask\xF8ylur\xF8ydyr\xF8ym\xE5s\xF8yv\xE6r\xF8yn\xE6r\xF8yhoylandeth\xF8ylandetdivtasvuodnal\xF8renskoglorenskognesoddtangenxn--tjme-hraxn--smla-hraxn--stjrdal-s1aunjargalillehammerunj\xE1rgaxn--hamary-fyadavvenjargaxn--bearalvhki-y4a123hjemmesidegjerdrumxn--brnnysund-m8acxn--tnsberg-q1axn--mlatvuopmi-s4axn--snsa-roaxn--skierv-utaxn--brum-voatysfjordkvafjordeidfjordkv\xE6fjordsongdalenmjondalenmj\xF8ndalenxn--gls-elackragerog\xE1\u014Bgaviikagangaviikas\xF8rreisasorreisas\xF8r-varangersor-varangerxn--risr-iraskiervaxn--frna-woaxn--trna-woakvinesdalleksvikleirvikr\xF8yrvikroyrviksvelvikvenneslaevje-og-hornnessandnessj\xF8enmarnardalvindafjordsandefjordenebakksnillfjordullensvangxn--trany-yuabr\xF8nn\xF8ysundnamsskoganaustevollxn--stjrdalshalsen-sqbnord-aurdalnord-frontr\xF8gstadtrogstadgrimstadflakstadgjerstadxn--sandy-yuaxn--leagaviika-52bnore-og-uvdalvegarsheixn--rlingen-mxaxn--ggaviika-8ya47hveg\xE5rsheikarlsoykvitsoymasfjordenhamaroyinderoyosteroydavvenj\xE1rgasauheradguovdageaidnuxn--vre-eiker-k8abronnoysiellakkr\xF8dsheradkrodsheradkvinnheradbr\xF8nn\xF8yxn--mtta-vrjjat-k7afxn--lrenskog-54akvits\xF8yv\xE1rgg\xE1tkarls\xF8yoster\xF8yinder\xF8yhamar\xF8ybronnoysundxn--aurskog-hland-jnbbahccavuotnab\xE1hccavuotnagiehtavuoatnastor-elvdalmidtre-gauldalxn--gildeskl-g0akarasjokevenassixn--bievt-0qaxn--yer-znalebesbynessebyxn--hbmer-xqamalselvm\xE5lselvxn--unjrga-rtam\xF8re-og-romsdalmore-og-romsdalhareidmeland\xF8rlandorlandstrand\xE5lg\xE5rdsolundalgardafjord\xE5fjorddielddanuorrikautokeinoxn--stre-toten-zcbskodjeaejriestangeliernebamblestokkefauskesn\xE5asesnaasekongsvingerlangevagberlevagxn--flor-jrahattfjelldalostre-toten\xF8stre-totenvestfoldxn--mely-ira\xE1laheadjualaheadjunordreisaxn--troms-zuaxn--lgrd-poacporsangerflatangerstavangerleikangerbremangersamnangergieldakarasjohkaxn--rdy-0nabfrostautsirasnoasatromsaxn--sr-aurdal-l8aflekkefjordj\xF8lsterjolsteraremarkhedmarkn\xE5\xE5mesjevuemienaamesjevuemiexn--vard-jrarollagmer\xE5kermerakerorskog\xF8rskogxn--bdddj-mrabd\xE1k\u014Boluoktaxn--osyro-wuaaknoluoktatrysilskjerv\xF8ymandaljondalbindalrindalmeldalsuldalorkdalsigdalalvdall\xE6rdalhurdalsirdalverdallerdallardaloppdal\xE5seralaseralhadselkrager\xF8divttasvuotnaoverhallasteinkjerxn--hnefoss-q1askedsmokorsettroms\xF8xn--dyry-iravestre-totenmuseumxn--sandnessjen-ogbrahkkeravjufylkesbiblb\xE1jddarbajddarxn--laheadju-7yarennes\xF8yxn--koluokta-7ya57hxn--hgebostad-g3aleirfjordstorfjordbalsfjordb\xE5tsfjordbatsfjordmuos\xE1tbiev\xE1tloab\xE1tk\xE1r\xE1\u0161johkan\xF8tter\xF8yxn--mjndalen-64anordkappl\xE1hppilahppialstahaugsiljanverranr\xF8ykenroykenhaldenlyngenbergenhortenh\xF8nefosshonefosstroandinbeiarnvarggatosoyroos\xF8yrotromsoidrettmuosatbievatruovatloabatvoagattynsetnessetxn--indery-fyask\xE1nitskanitraholtr\xE5holtxn--ystre-slidre-ujbandebusarpsborgbearduxn--karlsy-fyahordalandjorpelandj\xF8rpelanddeatnuringsakers\xF8r-odalsor-odalxn--slt-elabringerikeaudnedalnittedalnissedalhemsedalslattumsurnadalxn--blt-elabelverumstj\xF8rdalnaustdalhjartdalgj\xF8vikfyresdalhasviknarviklarvikgjovikmalvikgamviklenvikporsgrunnstjordalengerdaldrobakdr\xF8bakxn--msy-ula0hvestvagoyxn--vgan-qoaxn--ryken-vuaxn--lten-graxn--stfold-9xaxn--hpmir-xqaxn--lury-iram\xE1latvuopmimalatvuopmitysv\xE6rkirkenesbirkenesmoskenesb\xE1id\xE1rxn--fjord-lraxn--rdal-poabahcavuotnab\xE1hcavuotnaxn--frde-gralind\xE5sbearalvahkixn--hobl-irar\xE1hkker\xE1vjuxn--loabt-0qav\xE5g\xE5\xE1lt\xE1bod\xF8sundlundrader\xE5deetnetimeholeauregrueoddavagavegaranatanaarnasolasulaaltalekafusavangbergkvam\xE5mliamlibokntinnroangranosenoslobodor\xF8stroststat\xE5motamotivgupriv\xF8yeroyerliermossvossxn--nvuotna-hwalusterlunnermarkerh\xE1bmerhabmerhvalerfjalerxn--rholt-mratysvarbaidarfitjargaularh\xE1pmirhapmirmelhusfosnes\xF8ksnesoksnestysneshemnesevenesflesbergeidsbergtonsbergt\xF8nsberglindasxn--sndre-land-0cbnamsosxn--srum-gra\xF8ystre-slidreoystre-slidrevestre-slidretrondheimbalestrandxn--langevg-jxaaustrheimxn--skjk-soavagsoyaveroysandoykarmoyfinnoytranoyvestbytranbysykkylvenxn--hyanger-q1aspjelkavikandasuoloxn--fl-ziaxn--drbak-wuastathellexn--sr-varanger-ggbtelemarkxn--bhcavuotna-s4axn--porsgu-sta26f\u010D\xE1hcesuolocahcesuoloakrehamn\xE5krehamnsand\xF8ykarm\xF8yfinn\xF8ytran\xF8yv\xE5gs\xF8yaver\xF8ynamdalseidxn--lesund-huabadaddjaxn--vegrshei-c0axn--btsfjord-9zagildesk\xE5lporsanguxn--trgstad-r1an\xE1vuotnanavuotnahammerfestxn--sgne-graxn--brnny-wuacibestadharstadnarviikaeven\xE1\u0161\u0161ivestnesgjemnessandnesagdenesrennesoyxn--avery-yuaxn--tysvr-vrabearalv\xE1hkikongsbergspydebergrandabergxn--andy-iradavvesiidaxn--krdsherad-m8apors\xE1\u014Bgufredrikstadbjerkreimringeburennebuaurskog-holandnotteroyxn--vgsy-qoa0jxn--rmskog-byaskierv\xE1ivelandbyglandfrolandaurlandforsandxn--bjddar-ptamidsund\xE5lesundalesundfetsundfarsundovre-eiker\xF8vre-eikerakershusxn--moreke-juas\xF8rfold\xF8stfoldostfoldsorfoldh\xF8yangerhoyangerlevangerorkangertanangerxn--vestvgy-ixa6olillesandulsteinxn--rennesy-v1agranvinskjervoyxn--klbu-woalavagisxn--h-2faxn--ryrvik-byakafjordk\xE5fjordseljordfolkebiblxn--gjvik-wuajevnakerxn--kfjord-iuabudejjuxn--kranghke-b0axn--davvenjrga-y4axn--rland-uuaxn--ldingen-q1axn--mlselv-iuaxn--rady-iraxn--linds-prabrumunddalxn--ygarden-p1amo-i-ranaeidskogr\xF8mskogromskoghjelmelandxn--finny-yuaxn--sr-odal-q1axn--skjervy-v1aballangenkvanangenkv\xE6nangengratangenxn--hmmrfeasta-s4acvossevangensuohkanxn--rde-ulaxn--mli-tlaxn--ksnes-uuanordlandskanlandsk\xE5nlandsortlandfuoiskuxn--rros-graxn--hcesuolo-7ya35bxn--eveni-0qa01gagaivuotnag\xE1ivuotnaxn--seral-lradrammenmodalenmosjoenjan-mayentorskensteigengloppenxn--snes-poamatta-varjjatxn--sr-fron-q1aomasvuotnajessheimb\xE5d\xE5ddj\xE5xn--krager-gyaxn--kvfjord-nxaxn--asky-iraxn--snase-nraxn--bidr-5nacholt\xE5lenxn--vads-jraxn--jlster-byamosj\xF8enxn--rst-0nastavernxn--ostery-fyaxn--oppegrd-ixaxn--sknit-yqaxn--risa-5naoppeg\xE5rdskiptvetrendalenholtalenxn--mot-tlaxn--lhppi-xqaxn--holtlen-hxaxn--srreisa-q1akopervikxn--muost-0qaxn--bmlo-grahokksundkvalsundegersundxn--karmy-yuaullensakerxn--hylandet-54axn--kvitsy-fyaxn--bod-2nalangev\xE5gberlev\xE5gkristiansandxn--rsta-frahornindalstj\xF8rdalshalsenstjordalshalsensandnessjoenh\xE1mm\xE1rfeastaxn--lrdal-sras\xF8r-fronsor-fronnord-odalkristiansundm\xE1tta-v\xE1rjjatvestv\xE5g\xF8ynesoddennotoddenbuskerud\xF8ygardenoygardensalangenlavangenralingenr\xE6lingenlodingenl\xF8dingenlea\u014Bgaviikalaakesvuemieleangaviikauenorgexn--srfold-byaaskvollxn--rskog-uuaxn--nry-yla5gxn--vry-yla5ghammarfeastaxn--rhkkervju-01afxn--givuotna-8yakommunekrokstadelvanedre-eikerhagebostadh\xE6gebostadxn--berlevg-jxakviteseidxn--s-1faxn--l-1faxn--nmesjevuemie-tcbafuosskomo\xE5rekemoarekexn--lt-liacxn--jrpeland-54asvalbardoppegardholmestrandtvedestrandsogndalsokndalarendalsunndalfolldalxn--krjohka-hwab49jlyngdaletnedalnorddalsaltdalgausdalskedsmovaksdalgjesdalstordalxn--frya-hraaarbortedrangedalxn--smna-graaurskog-h\xF8landxn--vg-yiabtjeldsundhaugesundlindesnesxn--mre-og-romsdal-qqbxn--dnna-gradyntmpheremerseineshacknetenterprisecloudmineaccomaorim\u0101oriorgmilcriiwigennetschoolhealthkiwigovtgeekxn--mori-qsacloudnsparliamentcomedorgcompronetedugovmuseumwebsitekinservicebarsywebsitebuildereerobookheimdnsleapcelleero-stagetechcrscsslorigingohomecdbedeeeiemesecabgngilnlalplchfisiincnnoroptatitmtltruauhulumkdkukskjplvtrgrfrkrhrusesismycynzcznetinteduassoososcloudstgbetaaezaeuhkusjshatenadiarycdn77hoptozaptois-a-knightmyftpno-ipjpnddnssdpdnsspdnsbarsysweetpepperis-a-bruinsfanis-very-sweetservegameis-a-soxfanhomelinuxcdn77-secureservebbsmisconfusedwebredirectblogsitefreedesktopcouchpotatofriestoolforgeaccesscamis-lostreadmyblogsmall-webfedorapeopleserveftpis-a-celticsfanmywirepotagertwmailin-dslsellsyourhomeread-booksfreeddnscable-modemis-savednflfanufcfanmlbfanstuff-4-saleendoftheinternetin-vpnmy-firewallhomeftpis-localis-a-chefboldlygoingnowherewebhopselfipkicks-assroxatunkcamdvrfedoraprojectgotdnsdvrdnsdyndnspubtlspimientahomeunixdontexistfedorainfracloudwmflabsfspagesbmoattachmentsteckidsfamilydsdnsaliasdynaliasnow-dnscloudnsdoomdnsduckdnsblogdnshomednsroutingthecloudendofinternetdsmynasip-dynamicpoivronhttpbinmyfirewallis-very-evilmysecuritycamerais-a-linux-userwmcloudis-a-geektuxfamilyis-a-candidatedoesntexistis-very-badhobby-sitegame-hostaltervistais-foundis-a-patsfandnsdojohepforgepodzonedynservcollegefanis-very-goodfrom-meis-very-niceisa-geeknerdpolacmedsldingorgcomnomgobabonetedupleskaemhlxmyboxrockyprvcydeuxfleurspdnscodebergheyflowstatichostorgmilcomnomgobneteduorgcomeduiorgmilcomngonetedugovcloudns1337ngrokacorggogfamcomwebgobnetedugokgopgkpgovgosbizpasaugumicsopozpapuwmwsrprusiskwpspkppspkmpspokeoiawsawifoumsdnskokwpmuppuppsppiwwiwoowuzswkzoschrzpisdnwzmiuwwitdpssewsseumigugimoirmpinbwinbwiihupporzgwgriwupowwskrwioswuozstarostwokonsulattmpccopruszkowmyspreadshopostrodakartuzyopolegminamediaustkazgorajgoraolawailawalomzawloclradombytomjaworznotargilubinkoninzagantorunkutnokepnonakloczestsopotsanokturekplockslasksklepzarowlukowmedaidgdaorgmilrelcomnomatmgsmartneteduelkgovwawsossexbiztgorysejnytychypomorzeboleslawiechomesklepsdscloudunicloudzakopanelegnicarawa-mazbydgoszczswidnikkrasnikwloclawekbielawamragowograjeworealestatebeskidykaszubymalopolskaprzeworskswiebodzinlecznadfirmaszkolawarmiagdyniamiastakazimierz-dolnymalborkswidnicadlugolekaostrolekapodlasieelblagtravelsimplesitezachpomormielecszczecinnieruchomosciwalbrzychlezajsklublinbedzinpoznanwielunmielnooleckostarachowicedkontopowiatwroclawrybniksuwalkileborkslupskgdanskostrowwlkptarnobrzegtourismwegrowkrakowglogowyou2pilanysamailwrocinfoagroautobeepshoppriviqhslapypiszlodzcfolksecommerce-shopmazurypulawyskoczowrzeszowpomorskiezgierzkaliszolkuszlowiczostrowiecsosnowiecmazowszewodzislawbialowiezazgorzeleckatowicepabianicejelenia-gorawolominkarpaczsieradznowarudaczeladzkonskowolaskierniewiceswinoujscieturystykabieszczadycieszynketrzynolsztynbialystokbabia-goraprochowicewarszawastalowa-wolapolkowicegorlicegliwiceponiatowalimanowalubartowaugustowkobierzyceopocznognieznoszczytnokolobrzegshoparenapodhalebielskoklodzkostargardatwithplayitownnamecoorgnetedugovacorgcomproestnetedugovbiznameislaprofinforechtngrokmedaaaacacpaenglawjurbarbarsykeeneticavocatacctcloudnsorgcomsecplonetedugov123paginaweborgcomnetintedugovnomepublidkinbarsygovx443cloudnsorgmilcomnetedugovcooporgmilcomschnetedugovnamecomcannetlibassoaemclantmcontstoreorgcomnomrecwwwbarsyfirminfoshopartsstackitmyddnswebspacelima-cityacincooxorgedugovbarsybrendlyhbvpsvpsspectrumlandinghostingacppmordoviamcprecbgorgmilcomspbnetintedumsknovgovbirrasmcdirmytismircloudvladimirnalchikadygeyamarinepyatigorskmyjinobashkiriaeurodirvladikavkazna4ugroznykustanaikalmykiacldmaildagestaniranbuildcloudcanvaliaravalwixdevelopmentappwritemigrationneedleverceldatabasestackitcodereplravendbonporterlovableaccoorgmilnetgovcoopmedorgcompubschnetedugovservicemecomygovorggovtvmedorgcomnetedugovinfoedgfacbmlonihkutwpsryxzbdtmacfhppmyspreadshopbrandpartiorgcomfhvpress123minsidaitcouldbeworlanbibkommunalforbundfhskiopsyskomvuxkomforbnaturbruksgymnloginlineorgcomnetedugovenscaledeuusentsurgebotdaorgmilcomnetgovnowteleporthashbangplatformlovablebarsyshopwarebasehoplixbarsyonlinemsf5gitappgitpagewawamscofigma-govcaffeinefigmacanvasoltstscwputerbarsysupportchatgptsquareomniweopensocialcpanelplaycodenotionnovecorewpsquaredpreviewjelecyonbyensrhtfastvpspieboxconvexjouwwebheyflowplatformshloginlinemadethissourcecraftclouderaorgorgcomartedugouvunivmeorgcomnetedugovsurveysstatichfheiyuxs4allprojectmyfastubervibehostapp-ionosdeployagentmecoorgcomschnetedugovbizcncostoreorgmilcomneteduembaixadaconsuladokiraranohoprincipesaotomeheliohobarsystorebaseshopwaresellfyaiabkhaziavologdamordoviapenzalenugsochinavoiexnetspbmsknovnorth-kazakhstanashgabadkareliaarmeniageorgiavladimirnalchikivanovobukharaadygeyakhakassiakalugakrasnodarjambylaktyubinsktroitskbryanskobninskkurganazerbaijanpokrovskbashkiriatselinogradvladikavkazmurmansktulatuvamangyshlaktashkentchimkentgroznykaragandatermezarkhangelskkustanaikalmykiabalashoveast-kazakhstankaracoldagestantogliattibarsyredorgcomgobedumirenknightpointaccoorgjelasticdiscoursecleverappsschacmiincogoornetonlineshopcogoorgmilcomwebnicnetintedugovbiznametestcoorgmilcomnomnetedugovorangecloudpersoindorgcomfinnatnetgovensmincomtourismintlinfox0611oyaorgmilcomnetedugovquickconnectvpnplusnettprequalifymeaddrmyaddrntdllwadlnctvavdrk12orgmilpolbeltelcomwebgennetedutskkepgovbbsbiznameinfocoorgmilcompronetedugovbiznameinfobetter-thanworse-thansakurafromdyndnson-the-webmymailerorgmilurlcomneteduidvgovmydnsgameclubebizmeneacsccogotvorhotelmilmobiinfovodteiflgplkmsmsbcckhincndnvncoztltmkckppzpdprvcvkvlvcrkrkscxuzchernovtsyrivneyaltaodesavolynrovnolutskltdinforgcomnetedugovbizvinnicazhitomirternopilpoltavakropyvnytskyizaporizhzhiasevastopolsebastopoluzhgoroduzhhorodkharkovkharkivvinnytsiakhmelnytskyizaporizhzhecrimeaodessazhytomyrnikolaevcherkassydonetskluganskluhanskkirovogradivano-frankivskchernivtsikrymkievkyivlvivsumyzakarpattiamykolaivcherkasychernigovkhersonchernihivdnipropetrovskdnepropetrovskkhmelnitskiyneacsccogoorusorgmilcomedugovmyspreadshopadimono-ipbarsybarsyonlinelayershiftnh-servretrosnubapicampaignservicelugaffinitylotteryweeklylotteryraffleentrygluglugsmeaccoindependent-inquestnimsitecopropymntltdorgplcschnetgovnhsbarsyindependent-commissionindependent-reviewpolicepublic-inquiryindependent-panelconnhospindependent-inquiryroyal-commissionoraclegovcloudappscck12libaws-govccphxcclibpvtparochchtrcck12libcceatonk12coglibtecgendstmusann-arborwashtenawcck12glghcck12sealibforksolympiabainbridge-islkeyporthoquiamyarrow-pointcentraliaport-townsendsequimport-ludlowrentonsilverdalebremertonredmondsheltonbellevueport-orchardport-angeleskingstonchehalisaberdeengig-harborseattlepoulsboidmdndsddemenegacalamaiavawapailalflnmdcncscohnhmihiviwiriinmntnmocoutvtctmtgunjokakwvnvprarorasmskstxwynykyazisadninsnngosrvis-bymircloudservernamepointtoenscaledland-4-salefreeddnsstuff-4-saleazure-apinoipdatabricksappscloudnsgolffanheliohostazurewebsitesgvorgmilcomgubneteducoorgcomnetd0egvorgmilcomnetedugovmydnsiacostoree12orgmilcomnomwebgobbibrectecnetintedugovraremprendefirminfoartseducok12orgcomnethidnsidacaiiosonlahanamhanoicamauhueorgcompronetintedugovbizbacninhtayninhhoabinhnamdinhtravinhhaiphongvinhlonghaiduongquangnamquangtrithuathienhuequangninhbacgianghaugiangquangbinhsoctrangbentrethanhphohochiminhdanangkontumhatinhkhanhhoathanhhoahealthgialailaocaiyenbaibackanngheanlonganphuyenphuthocanthodaklakdongnainameinfovinhphucdongthapkiengiangtiengiangquangngailaichaulangsonlamdongdaknonghagiangangiangcaobangbinhduongninhthuanbinhthuanbaclieuthaibinhninhbinhbinhdinhtuyenquanghungyenbaria-vungtauthainguyendienbienbinhphuocschbizputerimagine-proxyorgcomnetedugovcloud66advisormypetsdyndnsxn--8dbq2axn--4dbgdty6cxn--5dbhl8dxn--hebda8bxn--80auxn--d1atxn--c1avgxn--o1acxn--o1achxn--90azhxn--55qx5dxn--uc0atvxn--od0algxn--wcvs22dxn--gmqw5axn--mxtq1mxn--12c1fe0brxn--h3cuzk1dixn--12co0c3b4evaxn--12cfi8ixb8lxn--o3cyx2axn--m3ch0j3axn--j1adpxn--90amcxn--90a1afxn--h1ahnxn--j1ael8bxn--h1alizxn--c1avgxn--j1aefxn--80aaa0cvacxn--41acaffeineexeopentunnelbotdashtelebitorgtmaccoagricorgmilnomwebnicngonetaltedugovlawnisschoolgrondaraccoorgmilcomschnetedugovbizinfoprg1-zeropstritonstackitlimazeropsaccoorgmilgov\u044F\u0441\u043F\u0431\u043E\u0440\u0433\u043A\u043E\u043C\u043C\u0441\u043A\u0431\u0438\u0437\u043C\u0438\u0440\u0441\u0430\u043C\u0430\u0440\u0430\u043A\u0440\u044B\u043C\u0441\u043E\u0447\u0438\u0430\u043A\u043E\u0434\u043F\u0440\u043E\u0440\u0433\u043E\u0431\u0440\u0443\u043F\u0440\u05E6\u05D4\u05DC\u05DE\u05DE\u05E9\u05DC\u05D9\u05E9\u05D5\u05D1\u05D0\u05E7\u05D3\u05DE\u05D9\u05D4\u0E2D\u0E07\u0E04\u0E4C\u0E01\u0E23\u0E18\u0E38\u0E23\u0E01\u0E34\u0E08\u0E23\u0E31\u0E10\u0E1A\u0E32\u0E25\u0E28\u0E36\u0E01\u0E29\u0E32\u0E17\u0E2B\u0E32\u0E23\u0E40\u0E19\u0E47\u0E15\u6559\u80B2\u7DB2\u7D61\u7D44\u7E54\u516C\u53F8\u653F\u5E9C\u500B\u4EBA\uB2F7\uB137\uD55C\uAD6D\u6FB3\u95E8\u65B0\u95FB\u6FB3\u9580\u8054\u901A\u5BB6\u96FB\u5609\u91CC\u62DB\u8058\u901A\u8CA9\uB2F7\uCEF4\uC0BC\uC131\u30B3\u30E0\u10D2\u10D4\u0431\u0433\u0440\u0444\u0435\u044Eadcdbdgdidmdsdtdaebedeeegeiejekemenepereseveyegabacalamanauavapaqasazacfbfafgfnfpfwftfbgcgagggegkgngmgsgpgvgtgugilmlnlalclglplsltlhmimjmkmmmomambmcmdmfmgmzmpmsmtmgbbblbsbecccacnclcmcvctcscmhkhghchbhthphshlinikifigiaibicivisikninhnmncnbngnsnpnvntnjoionomobocoaofodorosotoptstttytatbtetgtithtmtltrusuvuaucueuguhulumunufjdjbjtjsjlkmkhkfkdkcktkukskpkgpmpnpkpjpgqaqmqiqsvtvcvbvmvlvrwpwtwzwbwcwawgwkwmwtrsrprgrfrercrbrarnrmrlrkrirhrwsusrssspsgsesbsaslsmsissxmxaxcxuypysylymykygybycyuztzsznzmzkzdzczbzaz\u03B5\u03BB\u03B5\u03C5\u4E16\u754C\u53F0\u7063\u8D2D\u7269\u516C\u76CA\u70B9\u770B\u81FA\u7063\u7F51\u7EDC\u66F8\u7C4D\u5728\u7EBF\u7F51\u7AD9\u624B\u673A\u673A\u6784\u5927\u62FF\u6E38\u620F\u4FE1\u606F\u53F0\u6E7E\u8C37\u6B4C\u6148\u5584\u5546\u6807\u9999\u6E2F\u4E2D\u56FD\u9910\u5385\u7F51\u5740\u4E2D\u570B\u5546\u57CE\u98DF\u54C1\u5FAE\u535A\u653F\u52A1\u79FB\u52A8\u96C6\u56E2\u516C\u53F8\u516B\u5366\u5546\u5E97\u5065\u5EB7\u7F51\u5E97\u653F\u5E9C\u65F6\u5C1A\u4F5B\u5C71\u4E2D\u4FE1\u5A31\u4E50\u5E7F\u4E1C\u4F01\u4E1Ahomedepotengineering\u0627\u0645\u0627\u0631\u0627\u062Arepublicankuokgroupversicherungchannelcitadelxn--pgbs0dhxn--b4w605ferdstatebankwebsitexn--mgb9awbf\u4E9A\u9A6C\u900A\u6DE1\u9A6C\u9521alibabaxn--ngbc5azdxn--mgbbh1axn--45br5cyltoshibabuildworldcloudtradeguideplacespacedancemoviephoneprimesmilebiblestyleappleazurestoreskypegripexn--l1accdrivelottehorsehouseleasechasereisestadahondaomegaaetnaamicaninjanokiamediadeltavodkaedekaosakapizzaslingemailgmailtirolshelltmallfinallegaltotalhotelamfamforumrehabmusicciticricohcoachwatchboschearthfaithirishmiamiarchidubaiguccipraxi\u307F\u3093\u306A\u30B9\u30C8\u30A2\u30BB\u30FC\u30EBcanonsalononionnikonepsonkoelngreensevencrownikanoradioaudioweiboglobopromogalloyahoociscorodeovideomangobingotokyovolvolottokyotophotosmartsportquesttrusthyattjetztadultcymrubaidutushuxn--kprw13dubankclickblackmerckgroupsharpcheapnowtvxn--h2brj9c\u05E7\u05D5\u05DD\u0570\u0561\u0575\u043E\u0440\u0433\u0441\u0440\u0431\u043C\u043E\u043D\u043A\u043E\u043C\u0431\u0435\u043B\u043C\u043A\u0434\u049B\u0430\u0437\u0440\u0443\u0441\u0443\u043A\u0440\u0645\u0635\u0631\u0642\u0637\u0631\u0639\u0631\u0628\u0643\u0648\u0645dadcfdmedwedredphdthdbidpidkrdmsdltdiceonewmeglemoerwecfageacbanbambaaaammakianraspacpaaxawtfbcgaegongingaigvigorgdogdhlmilrilonlaolloluoljllcalgalnflafltelsrlfrllplkimibmcamcombommomifmabbjcbscbwebcabnabtabmlbpubabcbbcnecincpncllcstcwtcpwcnyckfhbzhovhmoiskiobisbitcifyituipinvinwinxincbnbcnmanfangdnmenrenkpnmtnyunrunfununobiojioriohbogmofooboooooacoecoceongoproartistottnttbbtcateatlatvetpetbetnethktmitfitintjothotgotdotbotprueduicujnjyouinknhktdkappsapgapmapdnptopgopllpjmpzipvipripesqtrvdtvitvdevmovgovhivnrwlawsewnewbmwwownowhowdvrftrmtrsfrbarcartvscrseusawsupsubssbsadsddsldssasbmsmlsxxxboxfoxgmxtjxsextaxbuyflydiysoyjoyskypaydaygayxyzanzbizwebersenerpokerlameractortatarsolar\u0EA5\u0EB2\u0EA7\u0E04\u0E2D\u0E21\u0E44\u0E17\u0E22tourslocusnexuslexusgiftsbeatsboatspartspressglassswiss\u0915\u0949\u092E\u0928\u0947\u091Ftiresgivescodeshomesgamestunesshoescardswalesloansvegastoolsdealsautosparis\u30D5\u30A1\u30C3\u30B7\u30E7\u30F3workssucksrocksxeroxforexfedexpartylillymoneystudyrugbytoraytoday\u4E2D\u6587\u7F51xn--unup4y\u5929\u4E3B\u6559\u98DE\u5229\u6D66\u65B0\u52A0\u5761enterprises\u6211\u7231\u4F60\u5609\u91CC\u5927\u9152\u5E97christmasxn--fct429kholdingsxn--8y0a063axn--mgbx4cd0ablifestyleabogadoallstatenetbank\u0643\u0627\u062B\u0648\u0644\u064A\u0643xn--s9brj9cxn--gk3at1ebestbuycharityxn--55qx5dmicrosoftpropertybasketballhomegoodscorsicajewelrygallerygrocerysurgerycountrybrusselsverisignferreroxn--czr694bhdfcbankcommbanksoftbank\u067E\u0627\u0643\u0633\u062A\u0627\u0646\u067E\u0627\u06A9\u0633\u062A\u0627\u0646nextdirect\u0627\u0644\u0633\u0639\u0648\u062F\u064A\u0647\u0627\u0644\u0639\u0644\u064A\u0627\u0646xn--h2brj9c8cxn--80adxhksshikshaxn--mgbai9azgqp6jcuisinellabarclayscatholicxn--kpry57dcompanyxn--xhq521bblackfridayxn--mgba3a3ejtsandvikxn--d1acj3bacademydownload\u0645\u0644\u064A\u0633\u064A\u0627xn--j1amhxn--w4r85el8fhu5dnraipirangaathletaxn--fhbeixn--mgbqly7cvafrzuerichxn--c2br7g\u0B87\u0BB2\u0B99\u0BCD\u0B95\u0BC8contractorsxn--io0a7igraphicsinsurancetemasekxn--xkc2al3hye2amotorcyclesphotographydirectoryplumbingxn--vhquvclothingtrainingcleaningwilliamhilllightingxn--mgba3a4f16ashoppingcateringeducationokinawapicturesventuresproductionsxn--9et52uwalmart\u0D2D\u0D3E\u0D30\u0D24\u0D02supportrealestatecapitalonexn--nqv7fs00emaauspostfloristdentistxn--qxamgodaddybradescobargainsmitsubishikerryhotelsxn--9dbq2axn--3pxu8kimmobilienxn--fjq720axn--mgbtx2bholidaymckinseymadridbusinessbuildershelsinkixn--4gbrim\u043C\u043E\u0441\u043A\u0432\u0430\u0627\u0644\u0633\u0639\u0648\u062F\u06CC\u0629coffeedegreelacaixapartnersalsaceofficeabbvievoyageorangegeorgeonlinechromemobilekindlegoogleoraclecircleschulesecureinsurexn--mgba7c0bbn0aestatexn--mgbc0a9azcgcruisehangoutxn--vuq861bxn--42c2d9arexrothfirestoneuniversityxn--nnx388alifeinsuranceextraspace\u043E\u043D\u043B\u0430\u0439\u043Dverm\xF6gensberatersoftwarexn--fiqs8sxn--mgbab2bdxn--w4rs40ltienda\u092D\u093E\u0930\u0924\u092E\u094Dafricatoyotaotsukasakuracameracreditcardnagoyaconsultingnetworkjunipertheatermonsterprogressivepioneerxn--55qw42gracingdatingvotingvikinglivinggivingxn--bck1b9a5dre4cbrotherweatherjoburg\u0641\u0644\u0633\u0637\u064A\u0646lplfinancialxn--clchc0ea0b2g2a9gcdfutbolschoolsocialglobaldentalwoodsidechanelairtelmatteltravelrealtorwebcamstream\u0C2D\u0C3E\u0C30\u0C24\u0C4Dunicomalstomxn--nodexn--6frz82gmuseumfurniturexn--rvc1e0am3exn--mix891faccenturexn--11b4c3dismailineustardiscountquebeccomsecclinicservicesxn--y9a3aqxn--c1avgswatchchurchsearch\u0627\u0644\u0627\u0631\u062F\u0646marketingcontacthealthmonashshoujisanofitaipeiamericanexpresssuzuki\u30A2\u30DE\u30BE\u30F3\u30AF\u30E9\u30A6\u30C9\u30DD\u30A4\u30F3\u30C8bharti\u30B0\u30FC\u30B0\u30EBxn--mgberp4a5d4armemorialxn--1qqw23alondonmormoninstitutevisionbostonnortoncouponmaisonamazonvirginberlindesigndurbanolayannissananquanxihuanhitachikaufengardenreisenbayerntechnologydatsunxn--90a3aclatinocasinostudiophysioxn--ngbe9e0apharmacytattootaobaoaramcoexpertreportabbottdirectselectimamatfairwindspictettargetmarketintuittravelersinsurancecreditdupontryukyusuppliesxn--tckwebnpparibasschmidtmerckmsdyodobashirestaurantbridgestonecricketxn--fpcrj9c3dbostikbroadwayattorneylefrakemerckxn--fiq228c5hscareersfarmerswinnersflowersxn--wgbh1cguitarsxn--54b7fta0ccxn--p1acfmakeupgalluplandroverxn--kcrx77d1x4agoldpointbauhausxn--mgbayh7gpahiphopplaystationxn--mgba3a4fraxn--eckvdtc9dhyundaixn--gckr3f0fistanbulticketsmarketsflightschintaireviewsxn--3e0b707ewindowsxn--fiqz9sfinancialxn--fzys8d69uvgm\u0627\u0628\u0648\u0638\u0628\u064Adiscoverreview\u09AC\u09BE\u0982\u09B2\u09BExn--5su34j936bgsgmoscowobserverapartments\u0434\u0435\u0442\u0438\u0627\u0631\u0627\u0645\u0643\u0648\u0441\u0430\u0439\u0442eurovisionxn--i1b6b1a6a2exn--xkc2dl3a5ee0h\u062A\u0648\u0646\u0633\u0645\u0648\u0642\u0639\u0628\u0627\u0631\u062A\u0680\u0627\u0631\u062A\u0634\u0628\u0643\u0629\u0639\u0645\u0627\u0646\u0628\u064A\u062A\u0643\u0639\u0631\u0627\u0642readkredbondlandbandfundfoodprodgoldfordtubecafesafelifeggeeieeefreefagepagegugezonewinememenamegamesaleablebikenikelikecarecbreherefiresaveloveliveblueartedatesitevotecaseluxebofamodaltdaasdatiaayogasinavanashiaasiajavabbvatevavivadatazaraarpacasavisasncfprofmaifsurfgolfdvagsongbingpingwangkpmggoogblogpohlfailcooldellcalldeallidlsarlfilmteamroomfarmimdbarabclubhdfcicbchsbcgmbhrichtechfishdishcashminiernikddiaudiwikimobitaxicitikiwidesiqponskinloanakdnwienopenporncerntownimmolimoolloinfonicofidolegosaxozeroaerovivoautovotomotofastbestresthostpostnextlgbtchatseatgiftmeetdietreitmintrentgentspotscotguruitausohumenucyoubanklinkpinkdclktalksilkbookseekworkrsvpaarpjeepshopcoophelpcamppccwshowbeerstarruhrflirweirhaircarsparsjprshausplusnewstipstoysjobskidsfanspicsdocsxboxamexsexynavycitysonyarmyallybabyplaydeliverybuzzgbizlamborghiniphilips\u0DBD\u0D82\u0D9A\u0DCF\u0CAD\u0CBE\u0CB0\u0CA4fitnessexpresslanxesspfizercenterwalterlawyersoccercareerkosherbrokerlockerdealerdoctorauthorxn--mgbqly7c0a67fbcverm\xF6gensberatungjaguarxn--pssy2uxn--hxt814eflickrrepairrogersairbusxn--mgbai9a5eva00beventsyachtsxn--t60b56a\u09AD\u09BE\u09F0\u09A4\u09AD\u09BE\u09B0\u09A4\u092D\u093E\u0930\u0924\u092D\u093E\u0930\u094B\u0924viajeshermeshughesxn--j1aef\u0938\u0902\u0917\u0920\u0928villas\u0B2D\u0B3E\u0B30\u0B24claimshotels\u0AAD\u0ABE\u0AB0\u0AA4zapposphotosjuegoscondostatamotorsgratistennis\u0A2D\u0A3E\u0A30\u0A24tkmaxxtjmaxxschaeffleryandexxn--80aswgrealtysafetybeautyluxuryxn--3ds443gsupplyfamilyxn--o3cw4hhockeysydneyxn--90aenissayalipayenergycomputeragencyxn--rovu88b\u96FB\u8A0A\u76C8\u79D1xn--gecrj9cstatefarmaccountantaquarelleolayangroup\u9999\u683C\u91CC\u62C9xn--p1ai\u7EC4\u7EC7\u673A\u6784xn--1ck2e1bxn--mgbt3dhdschwarz\u0645\u0648\u0631\u064A\u062A\u0627\u0646\u064A\u0627abudhabinowruzkomatsufujitsuhospitalxn--80asehdbxn--mgbtf8flxn--j6w193gxn--yfro4i67oprudentialxn--flw351ecruisescoursesrecipesxn--e1a4cferrarixn--ses554gxn--wgbl6awatchesstaplessinglesxn--mgbcpq6gpa1axn--otu796dpropertiescreditunionxn--mgbah1a3hjkrdstockholmhisamitsu\u0627\u0644\u0633\u0639\u0648\u062F\u064A\u0629stcgroupdomainsoriginscouponsbloombergclubmedfroganslimitedxn--80aqecdr1aexposedinternationalequipmentbarclaycardxn--q7ce6axn--mgbi4ecexpprotectionassociatesconstructionxn--cck2b3bxn--45q11candroidfoundation\u05D9\u05E9\u05E8\u05D0\u05DCxn--mgbca7dzdocliniqueboutiqueengineerxn--qxa6asystemsfirmdalefashionauctionxn--nqv7finfinitirentalsreliancetradingweddingfishinghostinggentingbookingcookingxn--3hcrj9cgraingerxn--czrs0tdemocratsamsungyokohamaxn--h2breg3evexn--nyqy26alundbeckmelbournevacationssolutionsfrontierxn--vermgensberatung-pwbmanagementxn--cg4bkixn--mgb2ddeslincolnhamburgsandvikcoromantblockbusterairforcebarefootxn--4dbrk0ceinvestmentsfeedbackcommunityxn--ngbrx\u0627\u0644\u0628\u062D\u0631\u064A\u0646diamondsamsterdamhealthcareredumbrellaxn--mxtq1mxn--2scrj9cagakhanxn--mgbpl2fh\u043A\u0430\u0442\u043E\u043B\u0438\u043Acaravan\u0B9A\u0BBF\u0B99\u0BCD\u0B95\u0BAA\u0BCD\u0BAA\u0BC2\u0BB0\u0BCDrichardlimortgageamericanfamilyxn--fzc2c9e2cscholarshipssaarlandxn--imr513nvlaanderensamsclubgoodyearkitchen\u0B87\u0BA8\u0BCD\u0BA4\u0BBF\u0BAF\u0BBEweatherchannelallfinanzxn--kput3i\u0627\u0644\u0633\u0639\u0648\u062F\u06CC\u06C3xn--90aisxn--efvy88h\u0627\u0644\u062C\u0632\u0627\u0626\u0631xn--mgbaam7a8hexchangejpmorganxn--tiq49xqyjfidelitysecurityxn--mk1bu44cwanggouxn--fiq64bxn--6qq986b3xlxn--mgbbh1a71exn--80ao21amarshallsxn--5tzm5gtravelerspanasoniclatrobeyoutubeaccountantsxn--rhqv96gxn--cckwcxetdanalyticsxn--ygbi2ammx\u0628\u0627\u0632\u0627\u0631\u0628\u06BE\u0627\u0631\u062A\u0633\u0648\u0631\u064A\u0629organicfresenius\u0633\u0648\u0631\u064A\u0627xn--9krt00axn--qcka1pmcxn--jlq480n2rgdeloittesciencefinancexn--jvr189mxn--30rr7yhomesensehotmailbaseballfootballleclercboehringerxn--q9jyb4cxn--mix082f\u0627\u0644\u064A\u0645\u0646\u0647\u0645\u0631\u0627\u0647politie\u0633\u0648\u062F\u0627\u0646\u0627\u064A\u0631\u0627\u0646\u0627\u06CC\u0631\u0627\u0646netflixyamaxunxn--lgbbat1ad8jcollegestoragecapetowncolognekerrypropertiesxn--mgbgu82axn--ogbpf8flxn--czru2dwhoswhociprianilasallexn--g2xx48cforsalebanamexaudiblexn--vermgensberater-ctbxn--zfr164bericssonvanguardxn--45brj9cindustriestheatremarriottxn--3bst00mcomparexn--mgberp4a5d4a87gcapitaldigital\u0627\u0644\u0645\u063A\u0631\u0628barcelonashangrilaxn--d1alfcalvinkleinwwwcitysapporokawasakinagoyasendaikobekitakyushuyokohamackjp";
  var rulesRoot = 625;
  var exceptionsRoot = 629;

  // node_modules/tldts/dist/es6/src/suffix-trie.js
  var numberOfNodes = nodeFlags.length;
  var numberOfEdges = edgeLength.length;
  var edgeOffset = new Uint32Array(numberOfEdges);
  var edgeHash = new Uint32Array(numberOfEdges);
  var wildcardEdge = new Int32Array(numberOfNodes).fill(-1);
  for (let node = 0, offset = 0; node < numberOfNodes; node += 1) {
    for (let edge = edgeStart[node]; edge < edgeStart[node + 1]; edge += 1) {
      edgeOffset[edge] = offset;
      const end = offset + edgeLength[edge];
      let hash = 5381;
      for (let i = end - 1; i >= offset; i -= 1) {
        hash = hash * 33 ^ labelText.charCodeAt(i);
      }
      edgeHash[edge] = hash >>> 0;
      if (edgeLength[edge] === 1 && labelText.charCodeAt(offset) === 42) {
        wildcardEdge[node] = edge;
      }
      offset = end;
    }
  }
  var matchNode = -1;
  var matchStart = 0;
  var matchEnd = 0;
  function labelEquals(edge, hostname2, start, length) {
    if (edgeLength[edge] !== length) {
      return false;
    }
    const offset = edgeOffset[edge];
    for (let i = 0; i < length; i += 1) {
      if (labelText.charCodeAt(offset + i) !== hostname2.charCodeAt(start + i)) {
        return false;
      }
    }
    return true;
  }
  function findEdge(node, hash, hostname2, start, length) {
    let lo = edgeStart[node];
    let hi = edgeStart[node + 1];
    while (lo < hi) {
      const mid = lo + hi >>> 1;
      const value = edgeHash[mid];
      if (value < hash) {
        lo = mid + 1;
      } else if (value > hash) {
        hi = mid;
      } else {
        for (let e = mid; e >= lo && edgeHash[e] === hash; e -= 1) {
          if (labelEquals(e, hostname2, start, length))
            return e;
        }
        for (let e = mid + 1; e < hi && edgeHash[e] === hash; e += 1) {
          if (labelEquals(e, hostname2, start, length))
            return e;
        }
        return -1;
      }
    }
    return -1;
  }
  function walk(hostname2, root, allowedMask) {
    let node = root;
    let end = hostname2.length;
    let hash = 5381;
    matchNode = -1;
    for (let i = hostname2.length - 1; i >= 0; i -= 1) {
      const code = hostname2.charCodeAt(i);
      if (code === 46) {
        const start = i + 1;
        let edge2 = findEdge(node, hash >>> 0, hostname2, start, end - start);
        if (edge2 === -1) {
          edge2 = wildcardEdge[node];
        }
        if (edge2 === -1) {
          return matchNode !== -1;
        }
        node = edgeChild[edge2];
        if ((nodeFlags[node] & allowedMask) !== 0) {
          matchNode = node;
          matchStart = start;
          matchEnd = end;
        }
        end = i;
        hash = 5381;
      } else {
        hash = hash * 33 ^ code;
      }
    }
    let edge = findEdge(node, hash >>> 0, hostname2, 0, end);
    if (edge === -1) {
      edge = wildcardEdge[node];
    }
    if (edge !== -1) {
      node = edgeChild[edge];
      if ((nodeFlags[node] & allowedMask) !== 0) {
        matchNode = node;
        matchStart = 0;
        matchEnd = end;
      }
    }
    return matchNode !== -1;
  }
  function suffixLookup(hostname2, options, out) {
    if (fast_path_default(hostname2, options, out)) {
      return;
    }
    const allowedMask = (options.allowPrivateDomains ? 2 : 0) | (options.allowIcannDomains ? 1 : 0);
    if (walk(hostname2, exceptionsRoot, allowedMask)) {
      out.isIcann = (nodeFlags[matchNode] & 1) !== 0;
      out.isPrivate = (nodeFlags[matchNode] & 2) !== 0;
      out.publicSuffix = hostname2.slice(matchEnd + 1);
      return;
    }
    if (walk(hostname2, rulesRoot, allowedMask)) {
      out.isIcann = (nodeFlags[matchNode] & 1) !== 0;
      out.isPrivate = (nodeFlags[matchNode] & 2) !== 0;
      out.publicSuffix = hostname2.slice(matchStart);
      return;
    }
    out.isIcann = false;
    out.isPrivate = false;
    const lastDot = hostname2.lastIndexOf(".");
    out.publicSuffix = lastDot === -1 ? hostname2 : hostname2.slice(lastDot + 1);
  }

  // node_modules/tldts/dist/es6/index.js
  var RESULT = getEmptyResult();
  function parse(url, options) {
    return parseImpl(url, 5, suffixLookup, options, getEmptyResult());
  }

  // src/presets/curated-upgrade-v2.ts
  var legacyCuratedUpgradeId = "research-infrastructure-2026-10-v2";
  var legacyCuratedUpgradeKey = `curated:${legacyCuratedUpgradeId}`;
  var legacyCuratedUpgradeHosts = Object.freeze([
    "aalto.fi",
    "about.gitlab.com",
    "academic.oup.com",
    "app.box.com",
    "app.slack.com",
    "app.zoom.us",
    "aps.org",
    "arxiv.org",
    "bctp.berkeley.edu",
    "berkeley.edu",
    "bitbucket.org",
    "calendar.google.com",
    "caltech.edu",
    "cam.ac.uk",
    "cambridge.org",
    "canvas.instructure.com",
    "canvas.kth.se",
    "cds.cern.ch",
    "cern.ch",
    "chalmers.se",
    "chatgpt.com",
    "chebfun.org",
    "claude.ai",
    "cornell.edu",
    "coursera.org",
    "courses.maths.ox.ac.uk",
    "crossref.org",
    "dblp.org",
    "deepl.com",
    "desy.de",
    "developer.mozilla.org",
    "dl.acm.org",
    "dlmf.nist.gov",
    "doaj.org",
    "docs.google.com",
    "docs.julialang.org",
    "docs.python.org",
    "docs.scipy.org",
    "doi.org",
    "drive.google.com",
    "dropbox.com",
    "dtu.dk",
    "ed.ac.uk",
    "edu.itp.phys.ethz.ch",
    "edx.org",
    "en.wikipedia.org",
    "epfl.ch",
    "epubs.siam.org",
    "ethz.ch",
    "excel.cloud.microsoft",
    "figma.com",
    "fysik.su.se",
    "github.com",
    "gitlab.com",
    "gu.se",
    "harvard.edu",
    "helsinki.fi",
    "home.cern",
    "home.edx.org",
    "ias.edu",
    "ictp.it",
    "ieeexplore.ieee.org",
    "imperial.ac.uk",
    "indico.cern.ch",
    "indico.desy.de",
    "indico.ictp.it",
    "infoscience.epfl.ch",
    "inspirehep.net",
    "intra.kth.se",
    "iopscience.iop.org",
    "itp.phys.ethz.ch",
    "journals.aps.org",
    "jstor.org",
    "julialang.org",
    "keep.google.com",
    "ki.se",
    "kitp.ucsb.edu",
    "kth.se",
    "ku.dk",
    "learn.canvas.net",
    "learning.edx.org",
    "link.aps.org",
    "link.springer.com",
    "liu.se",
    "ltu.se",
    "lu.se",
    "m365.cloud.microsoft",
    "mail.google.com",
    "math.berkeley.edu",
    "math.cornell.edu",
    "math.mit.edu",
    "math.stanford.edu",
    "mathematics.stanford.edu",
    "maths.ed.ac.uk",
    "meet.google.com",
    "microsoft365.com",
    "mit.edu",
    "nature.com",
    "nbi.ku.dk",
    "nbia.nbi.ku.dk",
    "ncbi.nlm.nih.gov",
    "netlib.org",
    "newton.ac.uk",
    "nodejs.org",
    "nordita.org",
    "notion.com",
    "notion.so",
    "npmjs.com",
    "numpy.org",
    "ocw.mit.edu",
    "office.com",
    "onedrive.cloud.microsoft",
    "onedrive.live.com",
    "online.kitp.ucsb.edu",
    "onlinelibrary.wiley.com",
    "openalex.org",
    "orcid.org",
    "osf.io",
    "outlook.cloud.microsoft",
    "outlook.com",
    "outlook.live.com",
    "outlook.office.com",
    "outlook.office365.com",
    "overleaf.com",
    "ox.ac.uk",
    "pcts.princeton.edu",
    "people.fas.harvard.edu",
    "people.maths.ox.ac.uk",
    "people.phys.ethz.ch",
    "people.sissa.it",
    "perimeterinstitute.ca",
    "phy.princeton.edu",
    "phys.ethz.ch",
    "physics.aalto.fi",
    "physics.aps.org",
    "physics.berkeley.edu",
    "physics.cornell.edu",
    "physics.dtu.dk",
    "physics.harvard.edu",
    "physics.kth.se",
    "physics.mit.edu",
    "physics.stanford.edu",
    "physics.ucsb.edu",
    "physics.uu.se",
    "pirsa.org",
    "pma.caltech.edu",
    "pmc.ncbi.nlm.nih.gov",
    "powerpoint.cloud.microsoft",
    "princeton.edu",
    "pubmed.ncbi.nlm.nih.gov",
    "pubs.acs.org",
    "pubs.aip.org",
    "pypi.org",
    "royalsocietypublishing.org",
    "scholar.google.com",
    "scholar.harvard.edu",
    "science.org",
    "sciencedirect.com",
    "scipost.org",
    "scipy.org",
    "semanticscholar.org",
    "sethna.lassp.cornell.edu",
    "sissa.it",
    "sitp.stanford.edu",
    "slack.com",
    "springer.com",
    "stackoverflow.com",
    "stanford.edu",
    "student.ladok.se",
    "su.se",
    "support.google.com",
    "support.microsoft.com",
    "support.mozilla.org",
    "sv.wikipedia.org",
    "teams.cloud.microsoft",
    "teams.microsoft.com",
    "th-dep.web.cern.ch",
    "theory-hamburg.desy.de",
    "theory.caltech.edu",
    "translate.google.com",
    "trello.com",
    "tum.de",
    "ucsb.edu",
    "uio.no",
    "umu.se",
    "user.it.uu.se",
    "users.aalto.fi",
    "uu.se",
    "video.ias.edu",
    "web.math.princeton.edu",
    "web.mit.edu",
    "web.stanford.edu",
    "webmail.kth.se",
    "wikipedia.org",
    "word.cloud.microsoft",
    "workspace.google.com",
    "www.aalto.fi",
    "www.aps.org",
    "www.berkeley.edu",
    "www.caltech.edu",
    "www.cam.ac.uk",
    "www.cambridge.org",
    "www.cern.ch",
    "www.chalmers.se",
    "www.chebfun.org",
    "www.cornell.edu",
    "www.coursera.org",
    "www.crossref.org",
    "www.damtp.cam.ac.uk",
    "www.deepl.com",
    "www.desy.de",
    "www.doi.org",
    "www.dropbox.com",
    "www.dtu.dk",
    "www.ed.ac.uk",
    "www.edx.org",
    "www.epfl.ch",
    "www.ethz.ch",
    "www.feynmanlectures.caltech.edu",
    "www.figma.com",
    "www.fkf.mpg.de",
    "www.fysik.lu.se",
    "www.fysik.su.se",
    "www.github.com",
    "www.gu.se",
    "www.harvard.edu",
    "www.helsinki.fi",
    "www.ias.edu",
    "www.ictp.it",
    "www.ifm.liu.se",
    "www.imperial.ac.uk",
    "www.it.uu.se",
    "www.itp.phys.ethz.ch",
    "www.jstor.org",
    "www.ki.se",
    "www.kitp.ucsb.edu",
    "www.kth.se",
    "www.ku.dk",
    "www.lassp.cornell.edu",
    "www.liu.se",
    "www.ltu.se",
    "www.lu.se",
    "www.matfys.lu.se",
    "www.math.harvard.edu",
    "www.math.princeton.edu",
    "www.maths.cam.ac.uk",
    "www.maths.ed.ac.uk",
    "www.maths.ox.ac.uk",
    "www.microsoft.com",
    "www.microsoft365.com",
    "www.mit.edu",
    "www.mn.uio.no",
    "www.nat.tum.de",
    "www.nature.com",
    "www.netlib.org",
    "www.newton.ac.uk",
    "www.nordita.org",
    "www.notion.com",
    "www.notion.so",
    "www.npmjs.com",
    "www.office.com",
    "www.outlook.com",
    "www.overleaf.com",
    "www.ox.ac.uk",
    "www.perimeterinstitute.ca",
    "www.ph.ed.ac.uk",
    "www.ph.nat.tum.de",
    "www.phy.cam.ac.uk",
    "www.phys.ethz.ch",
    "www.physics.helsinki.fi",
    "www.physics.kth.se",
    "www.physics.ox.ac.uk",
    "www.physics.ucsb.edu",
    "www.physics.uu.se",
    "www.pks.mpg.de",
    "www.princeton.edu",
    "www.science.org",
    "www.sciencedirect.com",
    "www.semanticscholar.org",
    "www.sissa.it",
    "www.stanford.edu",
    "www.su.se",
    "www.tcm.phy.cam.ac.uk",
    "www.theory.caltech.edu",
    "www.tum.de",
    "www.ucsb.edu",
    "www.uio.no",
    "www.umu.se",
    "www.uu.se",
    "www.wikipedia.org",
    "www.zoom.com",
    "www.zoom.us",
    "www.zotero.org",
    "www2.ph.ed.ac.uk",
    "wwwf.imperial.ac.uk",
    "zenodo.org",
    "zoom.us",
    "zotero.org"
  ]);

  // src/presets/curated-upgrade.ts
  var curatedUpgradeId = "research-infrastructure-2026-10-v3";
  var curatedUpgradeKey = `curated:${curatedUpgradeId}`;
  var withdrawn = /* @__PURE__ */ new Set(["wikipedia.org", "www.wikipedia.org", "en.wikipedia.org", "sv.wikipedia.org"]);
  var curatedUpgradeHosts = Object.freeze(legacyCuratedUpgradeHosts.filter((host3) => !withdrawn.has(host3)));
  var fields = ["id", "kind", "policyRevisionBefore", "policyRevisionAfter", "added", "alreadyPresent", "skippedBlacklisted", "skippedManaged"];
  function readCuratedUpgradeReceipt(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const value = input;
    if (Object.keys(value).length !== fields.length || !fields.every((key2) => Object.hasOwn(value, key2)) || value.id !== curatedUpgradeId && value.id !== legacyCuratedUpgradeId || value.kind !== "INITIALIZED" && value.kind !== "UPGRADED" || !Number.isSafeInteger(value.policyRevisionBefore) || value.policyRevisionBefore < 0 || !Number.isSafeInteger(value.policyRevisionAfter) || value.policyRevisionAfter < 0) return null;
    const lists2 = [value.added, value.alreadyPresent, value.skippedBlacklisted, value.skippedManaged];
    if (!lists2.every((list) => Array.isArray(list) && [...list].every((host3) => typeof host3 === "string"))) return null;
    const hosts = lists2.flat();
    const expected = value.id === curatedUpgradeId ? curatedUpgradeHosts : legacyCuratedUpgradeHosts;
    if (hosts.length !== expected.length || new Set(hosts).size !== hosts.length || [...hosts].sort().some((host3, index) => host3 !== expected[index])) return null;
    const before = value.policyRevisionBefore, after = value.policyRevisionAfter;
    if (value.kind === "INITIALIZED" ? before !== 0 || after !== 0 : after !== before + (value.added.length ? 1 : 0)) return null;
    if (value.kind === "INITIALIZED" && (value.added.length !== expected.length || lists2.slice(1).some((list) => list.length))) return null;
    return Object.freeze({
      id: value.id,
      kind: value.kind,
      policyRevisionBefore: before,
      policyRevisionAfter: after,
      added: Object.freeze([...value.added]),
      alreadyPresent: Object.freeze([...value.alreadyPresent]),
      skippedBlacklisted: Object.freeze([...value.skippedBlacklisted]),
      skippedManaged: Object.freeze([...value.skippedManaged])
    });
  }
  function planCuratedUpgrade(input, managed2) {
    const validated = validateAtlasSnapshot(input);
    if (!validated.ok || managed2 !== void 0 && !isManagedBlacklist(managed2)) return null;
    const snapshot = validated.snapshot;
    const existing = new Set(snapshot.policy.whitelist), denied = new Set(snapshot.policy.blacklist);
    const added = [], alreadyPresent = [], skippedBlacklisted = [], skippedManaged = [];
    for (const host3 of curatedUpgradeHosts) {
      if (denied.has(host3)) skippedBlacklisted.push(host3);
      else if (existing.has(host3) || snapshot.policy.whitelistSubdomains?.length && evaluate({ hostname: host3 }, snapshot.policy).outcome === "ALLOW") alreadyPresent.push(host3);
      else if (managed2 !== void 0 && managedBlacklistContains(managed2, host3)) skippedManaged.push(host3);
      else added.push(host3);
    }
    const policyRevision = snapshot.policyRevision + (added.length ? 1 : 0);
    if (!Number.isSafeInteger(policyRevision)) return null;
    const candidate = validateAtlasSnapshot({
      ...snapshot,
      policyRevision,
      policy: { ...snapshot.policy, whitelist: [...snapshot.policy.whitelist, ...added], blacklist: snapshot.policy.blacklist }
    });
    if (!candidate.ok) return null;
    const receipt = readCuratedUpgradeReceipt({
      id: curatedUpgradeId,
      kind: "UPGRADED",
      policyRevisionBefore: snapshot.policyRevision,
      policyRevisionAfter: policyRevision,
      added,
      alreadyPresent,
      skippedBlacklisted,
      skippedManaged
    });
    return receipt ? { snapshot: candidate.snapshot, receipt } : null;
  }
  function initialCuratedReceipt() {
    return readCuratedUpgradeReceipt({
      id: curatedUpgradeId,
      kind: "INITIALIZED",
      policyRevisionBefore: 0,
      policyRevisionAfter: 0,
      added: curatedUpgradeHosts,
      alreadyPresent: [],
      skippedBlacklisted: [],
      skippedManaged: []
    });
  }

  // src/presets/curated-scopes.ts
  var curatedScopeId = "curated-subdomains-2026-11-v1";
  var curatedScopeKey = `curated:${curatedScopeId}`;
  var curatedScopeHosts = curatedUpgradeHosts;
  var coveredBy = (host3, root) => host3 === root || host3.endsWith(`.${root}`);
  function curatedScopeRoots(hosts) {
    const unique = [...new Set(hosts)];
    for (const host3 of unique) {
      const p = parse(host3, { allowPrivateDomains: true });
      if (normalizeTarget({ hostname: host3 })?.hostname !== host3 || p.isIp || !p.domain || !(p.isIcann || p.isPrivate) || p.publicSuffix === host3 || host3 === "google.com" || host3 === "www.google.com") throw new TypeError("INVALID_CURATED_SCOPE");
    }
    return unique.filter((host3) => !unique.some((root) => root !== host3 && coveredBy(host3, root))).sort();
  }
  var initialCuratedScopes = Object.freeze(curatedScopeRoots(curatedScopeHosts));
  var lists = ["added", "alreadyPresent", "covered", "skippedBlacklisted", "skippedNotAllowed"];
  var fields2 = ["id", "kind", "policyRevisionBefore", "policyRevisionAfter", ...lists];
  function readCuratedScopeReceipt(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const r = input;
    if (Object.keys(r).length !== fields2.length || !fields2.every((key2) => Object.hasOwn(r, key2)) || r.id !== curatedScopeId || !["INITIALIZED", "UPGRADED"].includes(r.kind) || !Number.isSafeInteger(r.policyRevisionBefore) || r.policyRevisionBefore < 0 || !Number.isSafeInteger(r.policyRevisionAfter) || r.policyRevisionAfter < 0 || !lists.every((key2) => Array.isArray(r[key2]) && r[key2].every((host3) => typeof host3 === "string"))) return null;
    const hosts = lists.flatMap((key2) => r[key2]);
    if (hosts.length !== curatedScopeHosts.length || new Set(hosts).size !== hosts.length || hosts.sort().some((host3, i) => host3 !== curatedScopeHosts[i])) return null;
    if (r.kind === "INITIALIZED") {
      if (r.policyRevisionBefore !== 0 || r.policyRevisionAfter !== 0 || r.alreadyPresent.length || r.skippedBlacklisted.length || r.skippedNotAllowed.length || JSON.stringify([...r.added].sort()) !== JSON.stringify(initialCuratedScopes)) return null;
    } else if (r.policyRevisionAfter !== r.policyRevisionBefore + (r.added.length ? 1 : 0)) return null;
    if (r.covered.some((host3) => !r.added.some((root) => root !== host3 && coveredBy(host3, root)))) return null;
    return Object.freeze({ ...r, ...Object.fromEntries(lists.map((key2) => [key2, Object.freeze([...r[key2]])])) });
  }
  function initialCuratedScopeReceipt() {
    return readCuratedScopeReceipt({
      id: curatedScopeId,
      kind: "INITIALIZED",
      policyRevisionBefore: 0,
      policyRevisionAfter: 0,
      added: initialCuratedScopes,
      covered: curatedScopeHosts.filter((host3) => !initialCuratedScopes.includes(host3)),
      alreadyPresent: [],
      skippedBlacklisted: [],
      skippedNotAllowed: []
    });
  }
  function planCuratedScopes(input) {
    const validated = validateAtlasSnapshot(input);
    if (!validated.ok) return null;
    const snapshot = validated.snapshot, policy = snapshot.policy;
    const existing = policy.whitelistSubdomains ?? [];
    const skippedBlacklisted = curatedScopeHosts.filter((host3) => policy.blacklist.includes(host3));
    const eligible = curatedScopeHosts.filter((host3) => !skippedBlacklisted.includes(host3) && (policy.whitelist.includes(host3) || existing.includes(host3)));
    const skippedNotAllowed = curatedScopeHosts.filter((host3) => !skippedBlacklisted.includes(host3) && !eligible.includes(host3));
    const alreadyPresent = eligible.filter((host3) => existing.some((root) => coveredBy(host3, root)));
    const needed = eligible.filter((host3) => !alreadyPresent.includes(host3));
    const added = curatedScopeRoots(needed), covered = needed.filter((host3) => !added.includes(host3));
    const revision = snapshot.policyRevision + (added.length ? 1 : 0);
    const next = validateAtlasSnapshot({
      ...snapshot,
      policyRevision: revision,
      policy: added.length ? { ...policy, whitelistSubdomains: [...existing, ...added] } : policy
    });
    const receipt = readCuratedScopeReceipt({
      id: curatedScopeId,
      kind: "UPGRADED",
      policyRevisionBefore: snapshot.policyRevision,
      policyRevisionAfter: revision,
      added,
      alreadyPresent,
      covered,
      skippedBlacklisted,
      skippedNotAllowed
    });
    return next.ok && receipt ? { snapshot: next.snapshot, receipt } : null;
  }

  // src/presets/curated-expansion.ts
  var site = (label, hostname2, aliases = [], destinations = [], source) => ({
    label,
    hostname: hostname2,
    ...aliases.length ? { aliases } : {},
    ...destinations.length ? { destinations } : {},
    sources: [source ?? `https://${hostname2}/`]
  });
  var expandedServiceDestinations = {
    "journals.aps.org": ["aps.org", "www.aps.org", "physics.aps.org"],
    "outlook.com": ["outlook.cloud.microsoft"],
    "microsoft365.com": ["m365.cloud.microsoft", "office.com", "www.office.com", "www.microsoft.com"],
    "crossref.org": ["www.crossref.org"],
    "doi.org": ["www.doi.org"],
    "ncbi.nlm.nih.gov": ["www.ncbi.nlm.nih.gov"]
  };
  var curatedExpansion = [
    { label: "Scholar / Research", services: [
      site("Zotero", "zotero.org", ["www.zotero.org"]),
      site("Zenodo", "zenodo.org"),
      site("OSF", "osf.io"),
      site("OpenAlex", "openalex.org"),
      site("DOAJ", "doaj.org"),
      site("DBLP", "dblp.org"),
      site("PubMed Central", "pmc.ncbi.nlm.nih.gov"),
      site("ACS Publications", "pubs.acs.org"),
      site("Royal Society Publishing", "royalsocietypublishing.org"),
      site("SIAM Publications", "epubs.siam.org"),
      site("SciPost", "scipost.org")
    ] },
    { label: "University", services: [
      site("KTH", "kth.se", ["www.kth.se"], ["intra.kth.se", "www.physics.kth.se", "physics.kth.se"]),
      site("Stockholm University", "su.se", ["www.su.se"], ["fysik.su.se", "www.fysik.su.se"]),
      site("Karolinska Institutet", "ki.se", ["www.ki.se"]),
      site("Uppsala University", "uu.se", ["www.uu.se"], ["physics.uu.se", "www.physics.uu.se", "www.it.uu.se", "user.it.uu.se"]),
      site("Lund University", "lu.se", ["www.lu.se"], ["www.fysik.lu.se", "www.matfys.lu.se"]),
      site("Chalmers", "chalmers.se", ["www.chalmers.se"]),
      site("University of Gothenburg", "gu.se", ["www.gu.se"]),
      site("Linkoping University", "liu.se", ["www.liu.se"], ["www.ifm.liu.se"]),
      site("Umea University", "umu.se", ["www.umu.se"]),
      site("Lulea University of Technology", "ltu.se", ["www.ltu.se"]),
      site("University of Copenhagen", "ku.dk", ["www.ku.dk"], ["nbi.ku.dk", "nbia.nbi.ku.dk"]),
      site("University of Oslo", "uio.no", ["www.uio.no"], ["www.mn.uio.no"]),
      site("University of Helsinki", "helsinki.fi", ["www.helsinki.fi"], ["www.physics.helsinki.fi"]),
      site("Aalto University", "aalto.fi", ["www.aalto.fi"], ["physics.aalto.fi", "users.aalto.fi"]),
      site("Technical University of Denmark", "dtu.dk", ["www.dtu.dk"], ["physics.dtu.dk"]),
      site("University of Oxford", "ox.ac.uk", ["www.ox.ac.uk"], ["www.physics.ox.ac.uk", "www.maths.ox.ac.uk", "people.maths.ox.ac.uk", "courses.maths.ox.ac.uk"]),
      site("University of Cambridge", "cam.ac.uk", ["www.cam.ac.uk"], ["www.phy.cam.ac.uk", "www.damtp.cam.ac.uk", "www.tcm.phy.cam.ac.uk", "www.maths.cam.ac.uk"]),
      site("ETH Zurich", "ethz.ch", ["www.ethz.ch"], ["phys.ethz.ch", "www.phys.ethz.ch", "itp.phys.ethz.ch", "www.itp.phys.ethz.ch", "edu.itp.phys.ethz.ch", "people.phys.ethz.ch"]),
      site("EPFL", "epfl.ch", ["www.epfl.ch"], ["infoscience.epfl.ch"]),
      site("Imperial College London", "imperial.ac.uk", ["www.imperial.ac.uk"], ["wwwf.imperial.ac.uk"]),
      site("University of Edinburgh", "ed.ac.uk", ["www.ed.ac.uk"], ["www.ph.ed.ac.uk", "www2.ph.ed.ac.uk", "www.maths.ed.ac.uk", "maths.ed.ac.uk"]),
      site("Technical University of Munich", "tum.de", ["www.tum.de"], ["www.ph.nat.tum.de", "www.nat.tum.de"]),
      site("MIT", "mit.edu", ["www.mit.edu"], ["physics.mit.edu", "math.mit.edu", "web.mit.edu"]),
      site("Harvard University", "harvard.edu", ["www.harvard.edu"], ["physics.harvard.edu", "www.math.harvard.edu", "scholar.harvard.edu", "people.fas.harvard.edu"]),
      site("Stanford University", "stanford.edu", ["www.stanford.edu"], ["physics.stanford.edu", "math.stanford.edu", "mathematics.stanford.edu", "sitp.stanford.edu", "web.stanford.edu"]),
      site("Princeton University", "princeton.edu", ["www.princeton.edu"], ["phy.princeton.edu", "www.math.princeton.edu", "web.math.princeton.edu", "pcts.princeton.edu"]),
      site("Cornell University", "cornell.edu", ["www.cornell.edu"], ["physics.cornell.edu", "www.lassp.cornell.edu", "sethna.lassp.cornell.edu", "math.cornell.edu"]),
      site("UC Berkeley", "berkeley.edu", ["www.berkeley.edu"], ["physics.berkeley.edu", "math.berkeley.edu", "bctp.berkeley.edu"]),
      site("Caltech", "caltech.edu", ["www.caltech.edu"], ["pma.caltech.edu", "www.theory.caltech.edu", "theory.caltech.edu"]),
      site("UC Santa Barbara", "ucsb.edu", ["www.ucsb.edu"], ["www.physics.ucsb.edu", "physics.ucsb.edu"])
    ] },
    { label: "Physics institutes", services: [
      site("Nordita", "nordita.org", ["www.nordita.org"]),
      site("Perimeter Institute", "perimeterinstitute.ca", ["www.perimeterinstitute.ca"]),
      site("KITP", "kitp.ucsb.edu", ["www.kitp.ucsb.edu"], ["online.kitp.ucsb.edu"]),
      site("ICTP", "ictp.it", ["www.ictp.it"], ["indico.ictp.it"]),
      site("CERN", "home.cern", [], ["cern.ch", "www.cern.ch", "th-dep.web.cern.ch", "indico.cern.ch", "cds.cern.ch"]),
      site("DESY", "desy.de", ["www.desy.de"], ["theory-hamburg.desy.de", "indico.desy.de"]),
      site("Institute for Advanced Study", "ias.edu", ["www.ias.edu"], ["video.ias.edu"]),
      site("SISSA", "sissa.it", ["www.sissa.it"], ["people.sissa.it"]),
      site("Max Planck Complex Systems", "www.pks.mpg.de"),
      site("Max Planck Solid State Research", "www.fkf.mpg.de"),
      site("Isaac Newton Institute", "newton.ac.uk", ["www.newton.ac.uk"])
    ] },
    { label: "Learning", services: [
      site("MIT OpenCourseWare", "ocw.mit.edu"),
      site("Perimeter lecture archive", "pirsa.org"),
      site("Coursera", "coursera.org", ["www.coursera.org"]),
      site("edX", "edx.org", ["www.edx.org"], ["learning.edx.org", "home.edx.org"]),
      site("Feynman Lectures", "www.feynmanlectures.caltech.edu"),
      site("NumPy", "numpy.org"),
      site("SciPy", "scipy.org", [], ["docs.scipy.org"]),
      site("Julia", "julialang.org", [], ["docs.julialang.org"]),
      site("DLMF", "dlmf.nist.gov"),
      site("Netlib", "netlib.org", ["www.netlib.org"]),
      site("Chebfun", "chebfun.org", ["www.chebfun.org"])
    ] },
    { label: "Cloud storage", services: [
      site("Google Drive", "drive.google.com"),
      site("OneDrive", "onedrive.live.com", [], ["onedrive.cloud.microsoft"]),
      site("Dropbox", "dropbox.com", ["www.dropbox.com"]),
      site("Box", "app.box.com")
    ] },
    { label: "Productivity", services: [
      site("Google Docs, Sheets, Slides and Forms", "docs.google.com"),
      site("Google Calendar", "calendar.google.com"),
      site("Google Keep", "keep.google.com"),
      site("Microsoft web documents", "word.cloud.microsoft", [], ["excel.cloud.microsoft", "powerpoint.cloud.microsoft"]),
      site("Notion", "notion.so", ["www.notion.so"], ["notion.com", "www.notion.com"]),
      site("Trello", "trello.com"),
      site("Figma", "figma.com", ["www.figma.com"])
    ] },
    { label: "Communication", services: [
      site("Google Meet", "meet.google.com", [], ["workspace.google.com"]),
      site("Microsoft Teams", "teams.microsoft.com", [], ["teams.cloud.microsoft"]),
      site("Slack", "slack.com", [], ["app.slack.com"]),
      site("Zoom", "zoom.us", ["www.zoom.us"], ["app.zoom.us", "www.zoom.com"])
    ] },
    { label: "Development", services: [
      site("GitLab", "gitlab.com", [], ["about.gitlab.com"]),
      site("Bitbucket", "bitbucket.org"),
      site("Stack Overflow", "stackoverflow.com"),
      site("MDN", "developer.mozilla.org"),
      site("Python documentation", "docs.python.org"),
      site("PyPI", "pypi.org"),
      site("npm", "npmjs.com", ["www.npmjs.com"]),
      site("Node.js", "nodejs.org")
    ] },
    { label: "Utilities", services: [
      site("Wikipedia", "wikipedia.org", ["www.wikipedia.org"], ["en.wikipedia.org", "sv.wikipedia.org"]),
      site("Google Translate", "translate.google.com"),
      site("DeepL", "deepl.com", ["www.deepl.com"]),
      site("Mozilla Support", "support.mozilla.org"),
      site("Google Support", "support.google.com"),
      site("Microsoft Support", "support.microsoft.com")
    ] }
  ];

  // src/presets/curated-whitelist.ts
  var legacyCuratedWhitelist = [
    { label: "AI", services: [
      { label: "ChatGPT", hostname: "chatgpt.com" },
      { label: "Claude", hostname: "claude.ai" }
    ] },
    { label: "Mail", services: [
      { label: "Gmail", hostname: "mail.google.com" },
      { label: "KTH Mail", hostname: "webmail.kth.se" },
      {
        label: "Outlook",
        hostname: "outlook.com",
        aliases: ["www.outlook.com"],
        destinations: ["outlook.live.com", "outlook.office.com", "outlook.office365.com"]
      },
      { label: "Microsoft 365", hostname: "microsoft365.com", aliases: ["www.microsoft365.com"] }
    ] },
    { label: "Scholar / Research", services: [
      { label: "Google Scholar", hostname: "scholar.google.com" },
      { label: "arXiv", hostname: "arxiv.org" },
      { label: "INSPIRE", hostname: "inspirehep.net" },
      { label: "DOI", hostname: "doi.org" },
      { label: "Crossref", hostname: "crossref.org" },
      { label: "ORCID", hostname: "orcid.org" },
      { label: "Semantic Scholar", hostname: "semanticscholar.org", aliases: ["www.semanticscholar.org"] },
      { label: "APS", hostname: "journals.aps.org", destinations: ["link.aps.org"] },
      { label: "AIP", hostname: "pubs.aip.org" },
      { label: "IOPscience", hostname: "iopscience.iop.org" },
      { label: "Nature", hostname: "nature.com", aliases: ["www.nature.com"] },
      { label: "Science", hostname: "science.org", aliases: ["www.science.org"] },
      { label: "ScienceDirect", hostname: "sciencedirect.com", aliases: ["www.sciencedirect.com"] },
      { label: "Springer", hostname: "springer.com", destinations: ["link.springer.com"] },
      { label: "Wiley Online Library", hostname: "onlinelibrary.wiley.com" },
      { label: "Oxford Academic", hostname: "academic.oup.com" },
      { label: "Cambridge", hostname: "cambridge.org", aliases: ["www.cambridge.org"] },
      { label: "JSTOR", hostname: "jstor.org", aliases: ["www.jstor.org"] },
      { label: "IEEE Xplore", hostname: "ieeexplore.ieee.org" },
      { label: "ACM Digital Library", hostname: "dl.acm.org" },
      { label: "PubMed / NCBI", hostname: "pubmed.ncbi.nlm.nih.gov", destinations: ["ncbi.nlm.nih.gov"] }
    ] },
    { label: "Writing", services: [
      { label: "Overleaf", hostname: "overleaf.com", aliases: ["www.overleaf.com"] }
    ] },
    { label: "University", services: [
      { label: "Ladok", hostname: "student.ladok.se" },
      { label: "Canvas", hostname: "canvas.kth.se", destinations: ["canvas.instructure.com", "learn.canvas.net"] }
    ] },
    { label: "Development", services: [
      { label: "GitHub", hostname: "github.com", aliases: ["www.github.com"] }
    ] }
  ];
  var curatedServiceCatalog = [...legacyCuratedWhitelist, ...curatedExpansion].reduce((groups, group) => {
    const services = group.services.map((service) => expandedServiceDestinations[service.hostname] ? { ...service, destinations: [...service.destinations ?? [], ...expandedServiceDestinations[service.hostname]] } : service);
    const index = groups.findIndex((existing) => existing.label === group.label);
    if (index < 0) groups.push({ ...group, services });
    else groups[index] = { ...groups[index], services: [...groups[index].services, ...services] };
    return groups;
  }, []);
  var curatedWhitelist = curatedServiceCatalog.map((group) => ({ ...group, services: group.services.filter((service) => service.hostname !== "wikipedia.org") })).filter((group) => group.services.length > 0);
  function serviceHostnames(service) {
    return [service.hostname, ...service.aliases ?? [], ...service.destinations ?? []];
  }
  function serviceLabel(hostname2) {
    for (const group of curatedServiceCatalog) for (const service of group.services) {
      if (serviceHostnames(service).includes(hostname2)) return service.label;
    }
    return hostname2;
  }
  function compileCuratedWhitelist(groups = curatedWhitelist) {
    const hostnames = /* @__PURE__ */ new Set();
    for (const group of groups) for (const service of group.services) for (const hostname2 of serviceHostnames(service)) {
      if (normalizeTarget({ hostname: hostname2 })?.hostname !== hostname2) throw new TypeError("Invalid curated hostname");
      hostnames.add(hostname2);
    }
    return { whitelist: [...hostnames], blacklist: [], whitelistSubdomains: curatedScopeRoots([...hostnames]) };
  }

  // src/presets/access-aliases.ts
  var greylistAliases = [
    { hostname: "amazon.se", aliases: ["www.amazon.se"] }
  ];
  function equivalentServiceHostnames(hostname2) {
    for (const group of curatedWhitelist) for (const service of group.services) {
      const aliases = [service.hostname, ...service.aliases ?? []];
      if (aliases.includes(hostname2)) return aliases;
    }
    for (const service of greylistAliases) {
      const aliases = [service.hostname, ...service.aliases];
      if (aliases.includes(hostname2)) return aliases;
    }
    return [hostname2];
  }

  // src/ui/presentation.ts
  function countdown(deadline, now2) {
    const seconds = Math.max(0, Math.ceil((deadline - now2) / 1e3));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  // src/adapter/journey-indicator.ts
  function journeyPresentation(view, journey, now2) {
    journey = view?.snapshot?.journeyState.journeys.find((entry) => entry.id === journey?.id && entry.contextId === journey?.contextId) ?? null;
    if (!view?.snapshot || !["READY", "LOADING", "COMMITTING"].includes(view.status) || journey === null || journey.phase === "ENDED" || journey.policyRevision !== view.snapshot?.policyRevision || !Number.isSafeInteger(now2) || now2 < journey.startedAt || now2 >= journey.expiresAt) return null;
    return { journeyId: journey.id, destinationLabel: serviceLabel(journey.rootHostname), expiresAt: journey.expiresAt };
  }
  function journeyIndicator(view, journey, now2) {
    const display = journeyPresentation(view, journey, now2);
    return display === null ? null : `Atlas \xB7 Journey \u2192 ${display.destinationLabel}
${countdown(display.expiresAt, now2)} remaining`;
  }
  function journeyRetry(view, journey) {
    journey = view?.snapshot?.journeyState.journeys.find((entry) => entry.id === journey?.id && entry.contextId === journey?.contextId) ?? null;
    if (!["READY", "LOADING", "COMMITTING"].includes(view?.status ?? "") || !view?.snapshot || journey === null || journey.phase !== "ENDED" || ["REACHED", "RETURNED", "DESTINATION_CHANGED", "CONTEXT_CLOSED"].includes(journey.endReason) || !["WHITELISTED", "WHITELISTED_SCOPE"].includes(evaluate(journey.rootHostname, view.snapshot.policy).reason)) return null;
    return { journeyId: journey.id, rootHostname: journey.rootHostname, destinationLabel: serviceLabel(journey.rootHostname), endReason: journey.endReason };
  }

  // src/adapter/temporary-access.ts
  function accessOverview(view, now2, managedBlacklist) {
    const unavailable = { temporaryAccess: null, pendingAccess: null };
    if (view?.snapshot == null || !["READY", "LOADING", "COMMITTING"].includes(view.status)) return unavailable;
    const snapshot = view.snapshot, input = {
      snapshot,
      now: now2,
      configuration: snapshot.configuration,
      ...managedBlacklist === void 0 ? {} : { managedBlacklist }
    };
    if (planAtlasOperation({ kind: "OBSERVE_TIME" }, input).result.type !== "OBSERVED") return unavailable;
    const pendingAccess = snapshot.accessState.pendingRequests.flatMap((request) => {
      if (now2 >= request.confirmBy || request.policyRevision !== snapshot.policyRevision) return [];
      const hostnames = request.scopeHostnames ?? [request.hostname];
      const { result } = planAtlasOperation({
        kind: "CHECK_NAVIGATION",
        target: { hostname: request.hostname },
        context: { contextId: "pending-access-display", journeyId: null }
      }, input);
      return result.type === "ASSESSMENT" && (result.decision.outcome === "WAIT" || result.decision.outcome === "REQUIRE_CONFIRMATION") && result.decision.requestId === request.id ? [{
        requestId: request.id,
        hostnames: [...hostnames],
        readyAt: request.readyAt,
        confirmBy: request.confirmBy,
        outcome: result.decision.outcome
      }] : [];
    }).sort((a, b) => a.readyAt - b.readyAt || a.requestId - b.requestId);
    const grants = [];
    for (const grant of snapshot.accessState.grants) {
      if (now2 >= grant.expiresAt || grant.policyRevision !== snapshot.policyRevision) continue;
      const hostnames = (grant.scopeHostnames ?? [grant.hostname]).filter((hostname2) => {
        const { result } = planAtlasOperation({
          kind: "CHECK_NAVIGATION",
          target: { hostname: hostname2 },
          context: { contextId: "temporary-access-display", journeyId: null }
        }, input);
        return result.type === "ASSESSMENT" && result.decision.outcome === "ALLOW" && result.decision.reason === "ACTIVE_GRANT" && result.decision.requestId === grant.requestId;
      });
      if (hostnames.length > 0) grants.push({ requestId: grant.requestId, hostnames, expiresAt: grant.expiresAt });
    }
    return { pendingAccess, temporaryAccess: grants.sort((a, b) => a.expiresAt - b.expiresAt || a.requestId - b.requestId) };
  }

  // src/adapter/canonical-entry.ts
  var redirectStatuses = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);
  var reservedEndings = [
    "localhost",
    "local",
    "localdomain",
    "internal",
    "lan",
    "home",
    "corp",
    "test",
    "invalid",
    "example",
    "onion",
    "alt",
    "home.arpa",
    "example.com",
    "example.net",
    "example.org"
  ];
  function publicHostname(hostname2) {
    const labels = hostname2.split(".");
    return hostname2.length <= 253 && labels.length >= 2 && labels.every((label) => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) && /[a-z]/.test(labels.at(-1) ?? "") && !reservedEndings.some((ending) => hostname2 === ending || hostname2.endsWith(`.${ending}`));
  }
  function publicRoot(origin) {
    try {
      const root = new URL(origin);
      if (root.protocol !== "https:" || root.port !== "" || root.username !== "" || root.password !== "" || root.pathname !== "/" || root.search !== "" || root.hash !== "" || !publicHostname(root.hostname) || origin !== root.origin && origin !== `${root.origin}/`) return null;
      return root;
    } catch {
      return null;
    }
  }
  function canonicalDiscoveryOrigin(requestedOrigin) {
    try {
      const root = new URL(requestedOrigin);
      if (!["http:", "https:"].includes(root.protocol) || root.port !== "" || requestedOrigin !== root.origin && requestedOrigin !== `${root.origin}/`) return null;
      root.protocol = "https:";
      return publicRoot(root.href)?.origin ?? null;
    } catch {
      return null;
    }
  }
  function canonicalEntryCounterpart(origin, location) {
    const root = publicRoot(origin);
    if (root === null || typeof location !== "string" || location.trim() === "") return null;
    try {
      const target = new URL(location, root);
      const partner = root.hostname.startsWith("www.") ? root.hostname.slice(4) : `www.${root.hostname}`;
      if (target.protocol !== root.protocol || target.port !== root.port || target.username !== "" || target.password !== "" || target.hostname !== partner || !publicHostname(target.hostname)) return null;
      return target.hostname;
    } catch {
      return null;
    }
  }
  function createCanonicalEntryDiscovery(api, request = fetch, timeoutMs = 3e3) {
    const inFlight = /* @__PURE__ */ new Map();
    function probe(root) {
      return new Promise((resolve) => {
        const abort = new AbortController();
        let finished = false;
        let requestId = null;
        let timer;
        let extension;
        try {
          extension = new URL(api.runtime.getURL(""));
        } catch {
          resolve(null);
          return;
        }
        const ownRequest = (details) => {
          const sources = [details.originUrl, details.documentUrl].filter((source) => source !== void 0);
          return details.tabId === -1 && details.type === "xmlhttprequest" && details.method === "HEAD" && details.url === root.href && sources.length > 0 && sources.every((source) => {
            try {
              const initiator = new URL(source);
              return initiator.protocol === "moz-extension:" && initiator.host === extension.host && initiator.username === "" && initiator.password === "";
            } catch {
              return false;
            }
          });
        };
        const finish = (hostname2) => {
          if (finished) return;
          finished = true;
          if (timer !== void 0) clearTimeout(timer);
          try {
            api.webRequest.onBeforeRequest.removeListener(before);
          } catch {
          }
          try {
            api.webRequest.onHeadersReceived.removeListener(headers);
          } catch {
          }
          abort.abort();
          resolve(hostname2);
        };
        const before = (details) => {
          if (!finished && requestId === null && ownRequest(details)) requestId = details.requestId;
        };
        const headers = (details) => {
          if (finished || requestId === null || details.requestId !== requestId || !ownRequest(details)) return;
          const locations = details.responseHeaders?.filter((header) => header.name.toLowerCase() === "location") ?? [];
          finish(redirectStatuses.has(details.statusCode) && locations.length === 1 && locations[0]?.value !== void 0 ? canonicalEntryCounterpart(root.origin, locations[0].value) : null);
        };
        try {
          const filter = { urls: [root.href], types: ["xmlhttprequest"] };
          api.webRequest.onBeforeRequest.addListener(before, filter);
          api.webRequest.onHeadersReceived.addListener(headers, filter, ["responseHeaders"]);
          timer = setTimeout(() => finish(null), timeoutMs);
          void request(root.href, {
            method: "HEAD",
            credentials: "omit",
            redirect: "manual",
            cache: "no-store",
            referrerPolicy: "no-referrer",
            signal: abort.signal
          }).catch(() => finish(null));
        } catch {
          finish(null);
        }
      });
    }
    return (origin) => {
      const discoveryOrigin = canonicalDiscoveryOrigin(origin);
      const root = discoveryOrigin === null ? null : publicRoot(discoveryOrigin);
      if (root === null || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) {
        return Promise.resolve(null);
      }
      const existing = inFlight.get(root.href);
      if (existing !== void 0) return existing;
      const pending = probe(root);
      inFlight.set(root.href, pending);
      void pending.then(() => {
        if (inFlight.get(root.href) === pending) inFlight.delete(root.href);
      });
      return pending;
    };
  }

  // src/adapter/startup-status.ts
  var StartupError = class extends Error {
    constructor(stage, reason) {
      super(reason);
      this.stage = stage;
      this.reason = reason;
    }
  };
  function startupFailure(error2) {
    return error2 instanceof StartupError ? { status: "FAILED", stage: error2.stage, reason: error2.reason } : { status: "FAILED", stage: "STARTUP", reason: "STARTUP_FAILED" };
  }

  // src/adapter/download-response.ts
  function isAttachment(status, headers) {
    const values = headers?.filter((header) => header.name.toLowerCase() === "content-disposition");
    return status >= 200 && status < 300 && values?.length === 1 && typeof values[0].value === "string" && !/[\r\n\0]/.test(values[0].value) && /^attachment(?:\s*;|\s*$)/i.test(values[0].value.trim());
  }
  function hasUserActivation(headers) {
    const values = headers?.filter((header) => header.name.toLowerCase() === "sec-fetch-user");
    return values?.length === 1 && values[0].value === "?1";
  }
  var isHttpRedirect = (status) => [301, 302, 303, 307, 308].includes(status);
  function downloadRedirectUrl(url, headers) {
    const values = headers?.filter((header) => header.name.toLowerCase() === "location");
    if (values?.length !== 1 || typeof values[0].value !== "string" || /[\r\n\0]/.test(values[0].value)) return null;
    try {
      const target = new URL(values[0].value, url);
      if (normalizeTarget(target.href) === null) return null;
      target.hash = "";
      return target.href;
    } catch {
      return null;
    }
  }

  // src/adapter/toolbar.ts
  var controlPages = ["home", "sites", "access", "vault", "settings"];
  function toolbarRequest(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return false;
    const v = input;
    if (!Number.isSafeInteger(v.tabId) || v.tabId < 0) return false;
    if (v.kind === "GET_TOOLBAR_STATUS") return Object.keys(v).sort().join(",") === "kind,tabId";
    return v.kind === "OPEN_CONTROL_PAGE" && Object.keys(v).sort().join(",") === "contextId,kind,page,tabId" && controlPages.includes(v.page) && (v.contextId === null || typeof v.contextId === "string" && v.contextId.length <= 200);
  }

  // src/ui/destination-metadata.ts
  var destinationPreferencesKey = "atlas-destinations-v1";
  var emptyDestinationPreferences = () => ({ version: 1, destinations: [], pending: null });
  var validDestinationId = (id) => typeof id === "string" && /^(host|service):[a-z0-9.-]{1,253}$/.test(id);
  var hostname = (value) => typeof value === "string" && normalizeTarget({ hostname: value })?.hostname === value;
  function metadata(value) {
    if (value === null || typeof value !== "object") return null;
    const item = value;
    if (!validDestinationId(item.id) || typeof item.label !== "string" || item.label.trim().length === 0 || item.label.length > 100 || typeof item.category !== "string" || item.category.trim().length === 0 || item.category.length > 64 || !hostname(item.primaryHostname) || !Array.isArray(item.hostnames) || item.hostnames.length === 0 || item.hostnames.length > 100 || !item.hostnames.every(hostname) || new Set(item.hostnames).size !== item.hostnames.length || !item.hostnames.includes(item.primaryHostname)) return null;
    return { id: item.id, label: item.label, category: item.category, primaryHostname: item.primaryHostname, hostnames: [...item.hostnames] };
  }
  function readDestinationPreferences(value) {
    if (value === null || typeof value !== "object") return emptyDestinationPreferences();
    const stored = value;
    if (stored.version !== 1 || !Array.isArray(stored.destinations) || stored.destinations.length > 2e3) return emptyDestinationPreferences();
    const destinations = stored.destinations.map(metadata);
    if (destinations.some((item) => item === null) || new Set(destinations.map((item) => item.id)).size !== destinations.length) return emptyDestinationPreferences();
    const hosts = destinations.flatMap((item) => item.hostnames);
    if (new Set(hosts).size !== hosts.length) return emptyDestinationPreferences();
    let pending = null;
    if (stored.pending != null) {
      const item = stored.pending;
      const destination2 = item.destination === null ? null : metadata(item.destination);
      const policy = item.candidatePolicy;
      if (Number.isSafeInteger(item.proposalId) && item.proposalId > 0 && Number.isSafeInteger(item.basePolicyRevision) && item.basePolicyRevision >= 0 && (item.destination === null || destination2 !== null) && (item.removedId === null || validDestinationId(item.removedId)) && typeof item.pin === "boolean" && policy && Array.isArray(policy.whitelist) && Array.isArray(policy.blacklist) && policy.whitelist.length + policy.blacklist.length <= 1e4 && [...policy.whitelist, ...policy.blacklist].every(hostname) && evaluate("metadata-validation.example", policy).reason !== "INVALID_POLICY") {
        pending = {
          proposalId: item.proposalId,
          basePolicyRevision: item.basePolicyRevision,
          candidatePolicy: {
            whitelist: [...policy.whitelist],
            blacklist: [...policy.blacklist],
            ...policy.whitelistSubdomains !== void 0 ? { whitelistSubdomains: [...policy.whitelistSubdomains] } : {}
          },
          destination: destination2,
          removedId: item.removedId,
          pin: item.pin
        };
      }
    }
    return { version: 1, destinations, pending };
  }

  // src/ui/home-model.ts
  function destinationId(entry) {
    if (entry.id !== void 0) return entry.id;
    for (const group of curatedServiceCatalog) for (const service of group.services) {
      if (serviceHostnames(service).includes(entry.hostname)) return `service:${service.hostname}`;
    }
    return `host:${entry.hostname}`;
  }
  function readPins(value) {
    if (!Array.isArray(value) || value.length > 200 || value.some((id) => typeof id !== "string" || id.length > 260 || !/^(service|host):[a-z0-9.-]+$/.test(id))) return [];
    return [...new Set(value)];
  }
  function updateDestinationPin(pins, id, pinned, hosts = []) {
    const related = /* @__PURE__ */ new Set([id, ...hosts.map((host3) => `host:${host3}`)]);
    const next = [];
    let placed = false;
    for (const pin of pins) {
      if (!related.has(pin)) next.push(pin);
      else if (pinned && !placed) {
        next.push(id);
        placed = true;
      }
    }
    if (pinned && !placed) next.push(id);
    return next;
  }
  function destinationEntryPoints(entry) {
    for (const group of curatedServiceCatalog) for (const service of group.services) {
      if (!serviceHostnames(service).includes(entry.hostname)) continue;
      const active = [service.hostname, ...service.destinations ?? []].filter((hostname2) => entry.hostnames.includes(hostname2));
      return active.length > 0 ? active : [entry.hostname];
    }
    return [entry.hostname];
  }

  // src/ui/home-bookmarks.ts
  function validBookmarkPage(page) {
    return !!page && typeof page.id === "string" && /^[a-zA-Z0-9:.-]{1,280}$/.test(page.id) && typeof page.label === "string" && page.label.trim().length > 0 && page.label.length <= 100 && typeof page.url === "string" && page.url.length <= 4096 && page.url.trim() === page.url && /^https?:\/\//i.test(page.url) && normalizeTarget(page.url) !== null;
  }
  function readHomeBookmarks(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const value = input;
    if (Object.keys(value).sort().join(",") !== "groups,version" || value.version !== 1 || !Array.isArray(value.groups) || value.groups.length > 2e3) return null;
    let count = 0;
    const parents = /* @__PURE__ */ new Set();
    for (const group of value.groups) {
      if (!group || Object.keys(group).sort().join(",") !== "pages,parentId" || !validDestinationId(group.parentId) || parents.has(group.parentId) || !Array.isArray(group.pages) || !group.pages.length || group.pages.length > 100) return null;
      parents.add(group.parentId);
      count += group.pages.length;
      if (count > 2e3 || new Set(group.pages.map((p) => p?.id)).size !== group.pages.length) return null;
      for (const p of group.pages) if (!p || Object.keys(p).sort().join(",") !== "id,label,url" || !validBookmarkPage(p)) return null;
    }
    return structuredClone(value);
  }
  function defaultBookmarkPages(entry) {
    return destinationEntryPoints(entry).map((host3, i) => ({ id: `entry:${host3}`, label: i === 0 ? `${entry.label} home` : host3, url: `https://${host3}/` }));
  }

  // src/bookmarks/model.ts
  var presentationCommands = ["PRESENTATION_READ", "FOLDER_ICON", "BOOKMARK_SAVE", "PIN_SET", "PIN_LABEL", "PIN_ORDER", "SYNC_SETUP", "SYNC_PREVIEW", "SYNC_CONNECT", "SYNC_TOOLBAR", "SYNC_DISABLE", "SYNC_RETRY", "SYNC_COMPARE", "SYNC_RESOLVE"];
  var emptySync = () => ({ version: 1, enabled: false, root: null, archive: null, groups: [], bindings: [], labels: {}, metadataLabels: {}, pending: null, mutation: null, conflictRemote: null, issue: "NONE" });
  function same(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
    const left = Object.keys(a), right = Object.keys(b);
    return left.length === right.length && left.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]));
  }
  var nodeId = (v) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
  var pageId = (v) => typeof v === "string" && /^[a-zA-Z0-9:.-]{1,280}$/.test(v);
  var shape = (v, keys2) => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join(",") === keys2;
  function validGroups(value) {
    if (!Array.isArray(value) || value.length > 200 || new Set(value.map((g) => g?.id)).size !== value.length) return false;
    let pages = 0;
    return value.every((g) => g && Object.keys(g).sort().join(",") === "hostname,id,label,pages,pinned" && validDestinationId(g.id) && normalizeTarget({ hostname: g.hostname })?.hostname === g.hostname && typeof g.label === "string" && g.label.trim().length > 0 && g.label.length <= 100 && typeof g.pinned === "boolean" && Array.isArray(g.pages) && g.pages.length <= 100 && (pages += g.pages.length) <= 2e3 && new Set(g.pages.map((p) => p?.id)).size === g.pages.length && g.pages.every((p) => validBookmarkPage(p) && Object.keys(p).sort().join(",") === "id,label,url"));
  }
  function readSync(input) {
    if (!input || typeof input !== "object") return null;
    const v = input;
    if (Object.keys(v).filter((k) => k !== "scope").sort().join(",") !== "archive,bindings,conflictRemote,enabled,groups,issue,labels,metadataLabels,mutation,pending,root,version" || Object.hasOwn(v, "scope") && (v.scope !== "toolbar" || v.root !== "toolbar_____" || v.archive !== null) || v.version !== 1 || typeof v.enabled !== "boolean" || !["NONE", "CONFLICT", "ROOT_MISSING", "PERMISSION", "STORAGE", "UNSUPPORTED", "DUPLICATE"].includes(v.issue) || v.root !== null && !nodeId(v.root) || v.archive !== null && !nodeId(v.archive) || !validGroups(v.groups) || v.conflictRemote !== null && !validGroups(v.conflictRemote) || !Array.isArray(v.bindings) || v.bindings.length > 200 || new Set(v.bindings.map((b) => b?.id)).size !== v.bindings.length || !v.bindings.every((b) => shape(b, "folder,id,pages") && validDestinationId(b.id) && nodeId(b.folder) && b.pages && !Array.isArray(b.pages) && typeof b.pages === "object" && Object.keys(b.pages).length <= 100 && Object.entries(b.pages).every(([p, n]) => pageId(p) && nodeId(n)))) return null;
    for (const labels of [v.labels, v.metadataLabels]) if (!labels || Array.isArray(labels) || typeof labels !== "object" || Object.keys(labels).length > 200 || !Object.entries(labels).every(([id, l]) => validDestinationId(id) && typeof l === "string" && l.length <= 100)) return null;
    if (v.pending !== null && (!shape(v.pending, "bookmarkRevision,bookmarksCandidate,nativeBefore,pinsBefore,target") || !validGroups(v.pending.target) || !validGroups(v.pending.nativeBefore) || !Array.isArray(v.pending.pinsBefore) || v.pending.pinsBefore.length > 200 || new Set(v.pending.pinsBefore).size !== v.pending.pinsBefore.length || !v.pending.pinsBefore.every(validDestinationId) || !Number.isSafeInteger(v.pending.bookmarkRevision) || v.pending.bookmarkRevision < 0 || !readHomeBookmarks(v.pending.bookmarksCandidate))) return null;
    const m = v.mutation;
    if (m !== null && (!v.pending || !shape(m, "before,children,id,index,kind,parentId,result,title,url") || !["create", "update", "move", "remove"].includes(m.kind) || m.id !== null && !nodeId(m.id) || m.parentId !== null && !nodeId(m.parentId) || m.title !== null && (typeof m.title !== "string" || m.title.length > 100) || m.url !== null && !validBookmarkPage({ id: "check", label: "check", url: m.url }) || m.index !== null && (!Number.isSafeInteger(m.index) || m.index < 0) || !Array.isArray(m.children) || m.children.length > 1e4 || !m.children.every(nodeId) || m.before !== null && (!shape(m.before, "index,parentId,title,url") || !nodeId(m.before.parentId) || typeof m.before.title !== "string" || m.before.title.length > 100 || !Number.isSafeInteger(m.before.index) || m.before.index < 0 || m.before.url !== null && !validBookmarkPage({ id: "check", label: "check", url: m.before.url })) || m.result !== null && m.result !== "root" && m.result !== "archive" && (!shape(m.result, "group,page") || !validDestinationId(m.result.group) || m.result.page !== null && !pageId(m.result.page)) || m.kind === "create" && (m.id !== null || m.parentId === null || m.title === null || m.before !== null || m.result === null) || m.kind !== "create" && (m.id === null || m.before === null || m.result !== null) || m.kind === "move" && m.parentId === null || m.kind === "update" && m.title === null)) return null;
    return structuredClone(v);
  }
  function mergeGroups(base, local2, remote) {
    let conflict = false;
    function field(b, l, r) {
      if (same(l, r) || same(b, r)) return l;
      if (same(b, l)) return r;
      conflict = true;
      return l;
    }
    function order(b, l, r, ids) {
      const common = b.filter((id) => ids.has(id) && l.includes(id) && r.includes(id));
      const oldOrder = field(common, l.filter((id) => common.includes(id)), r.filter((id) => common.includes(id)));
      const chosen = same(l.filter((id) => common.includes(id)), oldOrder) ? l : r;
      return [.../* @__PURE__ */ new Set([...chosen, ...l, ...r])].filter((id) => ids.has(id));
    }
    const groups = /* @__PURE__ */ new Map();
    for (const id of new Set([...base, ...local2, ...remote].map((g) => g.id))) {
      const b = base.find((g) => g.id === id), l = local2.find((g) => g.id === id), r = remote.find((g) => g.id === id);
      if (!b || !l || !r) {
        const g = field(b, l, r);
        if (g) groups.set(id, g);
        continue;
      }
      const pages = /* @__PURE__ */ new Map();
      for (const pid of new Set([...b.pages, ...l.pages, ...r.pages].map((p) => p.id))) {
        const bp = b.pages.find((p) => p.id === pid), lp = l.pages.find((p) => p.id === pid), rp = r.pages.find((p) => p.id === pid);
        if (!bp || !lp || !rp) {
          const p = field(bp, lp, rp);
          if (p) pages.set(pid, p);
        } else pages.set(pid, { id: pid, label: field(bp.label, lp.label, rp.label), url: field(bp.url, lp.url, rp.url) });
      }
      groups.set(id, {
        id,
        hostname: b.hostname,
        label: field(b.label, l.label, r.label),
        pinned: field(b.pinned, l.pinned, r.pinned),
        pages: order(b.pages.map((p) => p.id), l.pages.map((p) => p.id), r.pages.map((p) => p.id), new Set(pages.keys())).map((p) => pages.get(p))
      });
    }
    const result = order(base.map((g) => g.id), local2.map((g) => g.id), remote.map((g) => g.id), new Set(groups.keys())).map((id) => groups.get(id));
    return conflict || !validGroups(result) ? null : structuredClone(result);
  }

  // src/adapter/firefox-adapter.ts
  function destination(url) {
    if (!/^https?:\/\//i.test(url)) return null;
    const target = normalizeTarget(url);
    if (target === null) return null;
    return { target, origin: new URL(url).origin };
  }
  var withoutFragment = (url) => url.split("#", 1)[0];
  var allowed = (result) => result.type === "ASSESSMENT" && result.decision.outcome === "ALLOW";
  var whitelisted = (result) => allowed(result) && ["WHITELISTED", "WHITELISTED_SCOPE"].includes(result.decision.reason);
  var error = (reason) => ({ type: "ADAPTER_ERROR", reason });
  var FirefoxAdapter = class {
    constructor(api, hostSource, newContextId, now2, schedule = (callback, delay) => setTimeout(callback, delay), unschedule = (id) => clearTimeout(id), discoverCanonicalEntry, onDestinationLaunch, runtimeDiagnostics2 = new RuntimeDiagnostics(api.runtime.getURL("background.js"), now2)) {
      this.api = api;
      this.hostSource = hostSource;
      this.newContextId = newContextId;
      this.now = now2;
      this.schedule = schedule;
      this.unschedule = unschedule;
      this.discoverCanonicalEntry = discoverCanonicalEntry;
      this.onDestinationLaunch = onDestinationLaunch;
      this.runtimeDiagnostics = runtimeDiagnostics2;
      this.uiUrl = api.runtime.getURL("ui/index.html");
      api.webRequest.onBeforeRequest.addListener(
        this.beforeRequest,
        { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] },
        ["blocking"]
      );
      api.webRequest.onErrorOccurred.addListener(
        this.requestFailed,
        { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] }
      );
      api.webRequest.onBeforeRedirect.addListener(
        this.redirected,
        { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] }
      );
      api.webRequest.onBeforeSendHeaders.addListener(
        this.downloadSending,
        { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] },
        ["blocking", "requestHeaders"]
      );
      api.webRequest.onHeadersReceived.addListener(
        this.downloadResponse,
        { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] },
        ["blocking", "responseHeaders"]
      );
      api.webRequest.onCompleted.addListener(
        this.downloadFinished,
        { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] }
      );
      api.webNavigation.onCreatedNavigationTarget.addListener(this.downloadTargetCreated);
      api.webNavigation.onCommitted.addListener(this.arrived);
      api.webNavigation.onHistoryStateUpdated.addListener(this.changed);
      api.webNavigation.onReferenceFragmentUpdated.addListener(this.changed);
      api.tabs.onRemoved.addListener(this.closed);
      api.tabs.onUpdated.addListener(this.updated);
      api.runtime.onMessage.addListener(this.message);
      this.ready = this.loadHost();
    }
    contexts = /* @__PURE__ */ new Map();
    queue = Promise.resolve();
    queued = 0;
    activeSince = null;
    completed = 0;
    host = null;
    startup = { status: "LOADING" };
    refreshPending = null;
    storageRecoveryUsed = false;
    authorityInterruption = null;
    interruptionKey = "";
    stopped = false;
    nextNavigation = 0;
    nextAccessScope = 0;
    diagnostics = new Diagnostics();
    downloadTargets = /* @__PURE__ */ new Map();
    ready;
    uiUrl;
    async loadHost() {
      this.startup = { status: "LOADING" };
      let candidate = null;
      try {
        const opened = await Promise.resolve().then(() => typeof this.hostSource === "function" ? this.hostSource() : this.hostSource);
        candidate = opened;
        try {
          await opened.controller.open();
        } catch {
          throw new StartupError("CONTROLLER", "CONTROLLER_UNAVAILABLE");
        }
        if (this.stopped) {
          opened.repository.close();
          return;
        }
        this.host = opened;
        this.startup = { status: "READY" };
      } catch (error2) {
        try {
          candidate?.repository.close();
        } catch {
        }
        this.host = null;
        this.startup = startupFailure(error2);
      }
    }
    startupReason() {
      return this.startup.status === "FAILED" ? this.startup.reason : "STARTUP_FAILED";
    }
    run(work) {
      this.queued++;
      const next = this.queue.then(async () => {
        this.queued--;
        try {
          this.activeSince = this.now();
        } catch {
          this.activeSince = null;
        }
        try {
          await this.ready;
          try {
            return await work();
          } finally {
            const authority = this.host?.controller.getView();
            this.rememberAuthorityInterruption(authority);
            const status = authority?.status;
            if (status === "UNAVAILABLE" || status === "RECONCILING") {
              for (const context of this.contexts.values()) if (context.latest !== null) this.publish(context, context.latest);
            }
          }
        } finally {
          this.activeSince = null;
          this.completed++;
        }
      });
      this.queue = next.catch((error2) => {
        this.runtimeDiagnostics.record("ADAPTER_QUEUE", error2);
      });
      return next;
    }
    /** Wait for queued adapter effects; read-only views deliberately do not wait. */
    whenIdle() {
      return this.queue;
    }
    /** Out-of-band observation remains available while an asynchronous queue is held. */
    runtimeView() {
      const controller = this.host?.controller;
      const view = controller?.getView();
      return {
        ...this.runtimeDiagnostics.read(),
        adapter: {
          queued: this.queued,
          activeSince: this.activeSince,
          completed: this.completed,
          contexts: this.contexts.size,
          refreshPending: this.refreshPending !== null
        },
        controller: {
          status: view?.status ?? null,
          reason: view?.reason ?? null,
          policyRevision: view?.snapshot?.policyRevision ?? null,
          configurationRevision: view?.snapshot?.configurationRevision ?? null,
          pendingCommit: view?.pendingCommitId !== null && view?.pendingCommitId !== void 0,
          activity: controller?.getActivity?.() ?? null
        }
      };
    }
    /** Only schedules publication; managed membership and precedence remain in Core. */
    publishManagedUpdate(work) {
      return this.run(work);
    }
    context(tabId) {
      let context = this.contexts.get(tabId);
      if (context === void 0) {
        context = {
          tabId,
          id: this.newContextId(),
          generation: 0,
          flight: null,
          launching: false,
          requested: null,
          displayed: null,
          displayedDecision: null,
          latest: null,
          effect: "NONE",
          removalTimer: null,
          lastArrival: -1,
          navigationId: 0,
          badge: "",
          pill: "",
          pillSentAt: null,
          rootOrigin: null,
          accessScope: null,
          launchIntent: false,
          timeoutReturn: null
        };
        this.contexts.set(tabId, context);
      }
      return context;
    }
    live(context, generation) {
      return !this.stopped && this.contexts.get(context.tabId) === context && context.generation === generation;
    }
    journey(context) {
      return this.host?.controller.getView().snapshot?.journeyState.journeys.find((journey) => journey.contextId === context.id) ?? null;
    }
    binding(context, continuation) {
      return {
        contextId: context.id,
        journeyId: this.journey(context)?.id ?? null,
        ...continuation === void 0 ? {} : { continuation }
      };
    }
    trace(event, context, result = context.latest, hostname2 = context.requested?.target.hostname ?? null) {
      try {
        const journey = this.journey(context);
        const at = this.now();
        this.diagnostics.add({
          event,
          at: Number.isSafeInteger(at) ? at : null,
          tabId: context.tabId,
          contextId: context.id,
          navigationId: context.navigationId,
          hostname: hostname2,
          outcome: result?.type === "ASSESSMENT" ? result.decision.outcome : result?.type ?? null,
          reason: result?.type === "ASSESSMENT" ? result.decision.reason : result !== null && "reason" in result ? result.reason : null,
          method: context.flight?.method ?? null,
          sourceHostname: context.flight?.sourceHostname ?? null,
          continuationKind: context.flight?.continuationKind ?? null,
          journey: journey === null ? null : {
            id: journey.id,
            phase: journey.phase,
            rootHostname: journey.rootHostname,
            hopCount: journey.hopCount,
            maxHops: journey.maxHops,
            expiresAt: journey.expiresAt,
            endReason: journey.endReason
          }
        });
      } catch {
      }
    }
    publish(context, result) {
      const signature = (response) => response?.type === "ASSESSMENT" ? JSON.stringify(response.decision) : JSON.stringify(response);
      if (signature(context.latest) !== signature(result)) this.trace("DECISION", context, result);
      context.latest = result;
      this.publishJourney(context);
      const authority = this.host?.controller.getView() ?? null;
      const unavailable = authority?.status === "UNAVAILABLE" || authority?.status === "RECONCILING";
      const decision = result.type === "ASSESSMENT" ? result.decision : null;
      const journey = this.journey(context);
      const indicator = decision?.outcome === "ALLOW" ? journeyIndicator(authority, journey, this.now()) : null;
      const text = unavailable ? "!" : decision?.outcome === "ALLOW" ? indicator !== null ? "J" : "" : decision?.outcome === "WAIT" ? "WAIT" : decision?.outcome === "REQUIRE_CONFIRMATION" ? "GO" : "!";
      const title = unavailable ? "Atlas \xB7 Access unavailable" : indicator ?? `Atlas \xB7 ${decision?.outcome ?? result.type} \xB7 ${decision?.reason ?? ("reason" in result ? result.reason : "")}`;
      const badge = `${text}:${title}`;
      if (context.badge === badge) return;
      context.badge = badge;
      void Promise.allSettled([
        this.api.browserAction.setBadgeText({ tabId: context.tabId, text }),
        this.api.browserAction.setTitle({ tabId: context.tabId, title }),
        this.api.browserAction.setBadgeBackgroundColor({
          tabId: context.tabId,
          color: decision?.outcome === "ALLOW" ? "#24675c" : "#895327"
        })
      ]);
    }
    pageJourney(context) {
      const journey = this.journey(context);
      if (context.flight !== null || context.launching || context.displayed === null || context.latest === null || !allowed(context.latest) || !("target" in context.latest.decision) || context.latest.decision.target?.hostname !== context.displayed.target.hostname || journey?.currentHostname !== context.displayed.target.hostname) return null;
      return journeyPresentation(this.host?.controller.getView() ?? null, journey, this.now());
    }
    publishJourney(context) {
      const presentation2 = this.pageJourney(context);
      const key2 = JSON.stringify([context.generation, presentation2]);
      const now2 = this.now();
      if (context.pill === key2 && (presentation2 === null || context.pillSentAt !== null && now2 - context.pillSentAt < 1e3)) return;
      context.pill = key2;
      context.pillSentAt = now2;
      void this.api.tabs.sendMessage(context.tabId, { kind: "ATLAS_JOURNEY_DISPLAY", presentation: presentation2 }, { frameId: 0 }).catch(() => {
        if (context.pill === key2) context.pill = "";
      });
    }
    async check(context, target, record = false, continuation, begin = false) {
      return this.host?.controller.handle({
        kind: record ? "RECORD_JOURNEY_NAVIGATION" : begin ? "BEGIN_NAVIGATION" : "CHECK_NAVIGATION",
        target,
        context: this.binding(context, continuation)
      }) ?? error(this.startupReason());
    }
    async loseJourney(context) {
      const journey = this.journey(context);
      if (journey !== null && journey.phase !== "ENDED") {
        await this.host?.controller.handle({
          kind: "CLOSE_JOURNEY_CONTEXT",
          contextId: context.id,
          journeyId: journey.id
        });
        this.trace("CONTEXT_CLOSED", context);
      }
    }
    async abandonUnreleasedDeparture(context, flight) {
      if (!this.stopped && this.contexts.get(context.tabId) === context && !flight.released && flight.journeyId !== null && this.journey(context)?.id === flight.journeyId) {
        await this.loseJourney(context);
      }
    }
    clearRemoval(context) {
      if (context.removalTimer !== null) this.unschedule(context.removalTimer);
      context.removalTimer = null;
    }
    beforeRequest = (details) => {
      try {
        return this.gate(details).catch(() => ({ cancel: true }));
      } catch {
        return Promise.resolve({ cancel: true });
      }
    };
    gate = (details) => {
      if (details.type !== "main_frame" || details.frameId !== 0 || !/^https?:\/\//i.test(details.url)) {
        return Promise.resolve({});
      }
      if (details.tabId < 0 || this.stopped) return Promise.resolve({ cancel: true });
      const context = this.context(details.tabId);
      const previous = context.flight;
      const correlated = previous !== null && (previous.released || previous.download?.intent?.phase === "REQUESTING") && previous.requestId === details.requestId && previous.redirectUrl === withoutFragment(details.url) && previous.timeStamp <= details.timeStamp;
      const initiator = details.originUrl === void 0 ? null : destination(details.originUrl);
      const targetEvidence = this.downloadTargets.get(details.tabId);
      this.downloadTargets.delete(details.tabId);
      const downloadSource = targetEvidence && targetEvidence.url === withoutFragment(details.url) && targetEvidence.timeStamp <= details.timeStamp && this.now() >= targetEvidence.at && this.now() - targetEvidence.at < 3e3 && targetEvidence.source.document.origin === initiator?.origin ? targetEvidence.source : previous === null && initiator?.origin === context.displayed?.origin ? this.captureDownloadSource(context) : null;
      const sourceDocument = context.displayed;
      const sourceAuthority = context.displayedDecision;
      if (context.flight !== null && (!context.flight.released || context.flight.requestId !== details.requestId))
        this.trace("SUPERSEDED", context);
      const generation = ++context.generation;
      const launchIntent = context.launchIntent;
      context.launchIntent = false;
      context.navigationId = ++this.nextNavigation;
      context.launching = false;
      this.clearRemoval(context);
      context.effect = "NONE";
      const flight = {
        requestId: details.requestId,
        url: withoutFragment(details.url),
        timeStamp: details.timeStamp,
        destination: destination(details.url),
        released: false,
        journeyId: null,
        authority: null,
        redirectUrl: null,
        method: details.method === "GET" || details.method === "POST" ? details.method : "OTHER",
        sourceHostname: initiator?.target.hostname ?? null,
        continuationKind: null,
        launchRecorded: false,
        syntheticReturn: false,
        download: correlated && previous.download !== null && !previous.download.consumed ? previous.download : downloadSource && details.method === "GET" ? {
          source: downloadSource,
          operationId: this.newContextId(),
          intent: null,
          exceptional: false,
          redirectResponse: null,
          consumed: false
        } : null,
        fileResponse: false,
        downloadAuthorityFailed: false
      };
      context.flight = flight;
      if (flight.download) flight.download.redirectResponse = null;
      context.requested = flight.destination;
      this.trace("REQUEST", context, null);
      return this.run(async () => {
        if (!this.live(context, generation)) return { cancel: true };
        const active = this.journey(context);
        const timeout = context.timeoutReturn;
        const syntheticReturn = timeout !== null && timeout.awaitingRequest && flight.destination?.target.hostname === timeout.hostname;
        flight.syntheticReturn = syntheticReturn && !launchIntent;
        if (syntheticReturn) timeout.awaitingRequest = false;
        if (launchIntent) context.timeoutReturn = null;
        const existingContinuation = active !== null && active.phase !== "ENDED" ? correlated && previous.journeyId === active.id ? { kind: "HTTP_REDIRECT", sourceHostname: active.currentHostname } : initiator?.target.hostname === context.displayed?.target.hostname && initiator?.target.hostname === active.currentHostname && flight.destination?.target.hostname === active.currentHostname ? { kind: "SAME_HOST", sourceHostname: active.currentHostname } : active.phase === "IN_TRANSIT" && details.method === "POST" && context.displayed?.target.hostname === active.currentHostname && initiator?.origin === context.displayed?.origin && context.displayedDecision !== null && allowed(context.displayedDecision) ? { kind: "FORM_POST", sourceHostname: active.currentHostname } : void 0 : void 0;
        const rootDeparture = context.timeoutReturn === null && sourceDocument !== null && context.displayed === sourceDocument && sourceAuthority !== null && whitelisted(sourceAuthority) && initiator?.origin === sourceDocument.origin && flight.destination !== null && flight.destination.target.hostname !== sourceDocument.target.hostname && (active === null || active.phase === "ENDED" || active.phase === "STARTED" && active.rootHostname === sourceDocument.target.hostname);
        const continuation = existingContinuation ?? (rootDeparture ? { kind: "ROOT_DEPARTURE", sourceHostname: sourceDocument.target.hostname } : void 0);
        flight.continuationKind = continuation?.kind ?? null;
        let result = flight.destination === null ? error("INVALID_TARGET") : await this.check(context, flight.destination.target, false, continuation, context.timeoutReturn === null);
        const journey = this.journey(context);
        flight.journeyId = journey?.id ?? null;
        if (!this.live(context, generation)) {
          if (rootDeparture) await this.abandonUnreleasedDeparture(context, flight);
          return { cancel: true };
        }
        if (allowed(result) && journey !== null && journey.phase !== "ENDED" && journey.rootHostname === flight.destination?.target.hostname && context.rootOrigin?.journeyId !== journey.id)
          context.rootOrigin = { journeyId: journey.id, origin: flight.destination.origin };
        if (allowed(result) && journey !== null && journey.phase !== "ENDED" && continuation?.kind === "ROOT_DEPARTURE" && journey.rootHostname === sourceDocument?.target.hostname)
          context.rootOrigin = { journeyId: journey.id, origin: sourceDocument.origin };
        if (allowed(result) && journey !== null && journey.phase !== "ENDED" && flight.destination.target.hostname !== journey.rootHostname) {
          result = await this.check(context, flight.destination.target, true, continuation);
        }
        if (!this.live(context, generation)) {
          if (rootDeparture) await this.abandonUnreleasedDeparture(context, flight);
          return { cancel: true };
        }
        if (allowed(result) && "expiresAt" in result.decision && this.now() >= result.decision.expiresAt) {
          result = error("RECHECK_REQUIRED");
        }
        if (result.type === "ASSESSMENT" && result.decision.outcome !== "ALLOW" && result.decision.outcome !== "DENY" && flight.destination !== null && flight.method === "GET" && flight.download !== null) {
          flight.download.exceptional = true;
          const stage = correlated && flight.download.intent?.phase === "REQUESTING" ? "REDIRECT" : "PREPARE";
          if (stage === "PREPARE" && flight.download.intent !== null) flight.download.consumed = true;
          if (await this.advanceDownload(context, flight, stage)) {
            this.trace(stage === "PREPARE" ? "DOWNLOAD_PREPARED" : "DOWNLOAD_FETCH", context, error("DOWNLOAD_RESPONSE_PENDING"));
            return {};
          }
          if (!this.live(context, generation)) return { cancel: true };
        } else if (correlated && flight.download?.intent?.phase === "REQUESTING") {
          if (!await this.advanceDownload(context, flight, "REDIRECT")) flight.download = null;
        }
        if (allowed(result) && (flight.downloadAuthorityFailed || this.host?.controller.getView().status !== "READY" || result.policyRevision !== this.host.controller.getView().snapshot?.policyRevision)) result = error("RECHECK_REQUIRED");
        if (!this.live(context, generation)) return { cancel: true };
        this.publish(context, result);
        if (allowed(result)) {
          flight.released = true;
          flight.authority = result;
          if (launchIntent && whitelisted(result)) {
            this.recordLaunch(flight.destination.target.hostname);
            flight.launchRecorded = true;
          }
          this.trace("RELEASED", context, result);
          return {};
        }
        this.schedule(() => {
          void this.run(() => this.removeContent(context, generation));
        }, 0);
        return { cancel: true };
      }).catch(() => {
        if (this.live(context, generation)) {
          this.publish(context, error("ADAPTER_FAILURE"));
          this.schedule(() => {
            void this.run(() => this.removeContent(context, generation));
          }, 0);
        }
        return { cancel: true };
      });
    };
    captureDownloadSource(context) {
      if (context.displayed === null || context.displayedDecision === null || !allowed(context.displayedDecision) || context.flight !== null || context.effect !== "NONE" || context.launching) return null;
      return {
        context,
        document: context.displayed,
        generation: context.generation,
        arrival: context.lastArrival,
        binding: { target: context.displayed.target, context: { contextId: context.id, journeyId: this.journey(context)?.id ?? null } }
      };
    }
    downloadTargetCreated = (details) => {
      if (this.stopped || details.sourceFrameId !== 0 || details.tabId === details.sourceTabId || destination(details.url) === null || this.contexts.get(details.tabId)?.flight) return;
      const source = this.contexts.get(details.sourceTabId);
      const captured = source === void 0 ? null : this.captureDownloadSource(source);
      if (captured !== null) this.downloadTargets.set(
        details.tabId,
        { source: captured, url: withoutFragment(details.url), at: this.now(), timeStamp: details.timeStamp }
      );
      if (this.downloadTargets.size > 100) this.downloadTargets.delete(this.downloadTargets.keys().next().value);
    };
    downloadLive(context, flight) {
      const download = flight.download;
      if (this.stopped || context.flight !== flight || this.contexts.get(context.tabId) !== context || download === null || download.consumed || flight.destination === null || flight.method !== "GET") return false;
      const source = download.source;
      return this.contexts.get(source.context.tabId) === source.context && (source.context === context || source.context.generation === source.generation && source.context.flight === null) && source.context.lastArrival === source.arrival && source.context.effect === "NONE" && source.context.displayed?.origin === source.document.origin && source.context.displayed.target.hostname === source.document.target.hostname;
    }
    async advanceDownload(context, flight, stage) {
      if (!this.downloadLive(context, flight)) return false;
      const download = flight.download;
      const result = await this.host?.controller.handle({
        kind: "CHECK_DOWNLOAD",
        stage,
        source: download.source.binding,
        binding: { operationId: download.operationId, contextId: context.id },
        target: flight.destination.target,
        intent: download.intent
      });
      const now2 = this.now();
      if (!this.downloadLive(context, flight) || result?.type !== "DOWNLOAD" || result.outcome === "DENY" || this.host?.controller.getView().status !== "READY" || result.intent.policyRevision !== this.host.controller.getView().snapshot?.policyRevision || !Number.isSafeInteger(now2) || now2 < result.observedAt || now2 >= result.intent.expiresAt) {
        if (result?.type !== "DOWNLOAD" || result.outcome === "DENY" && result.reason !== "DOWNLOAD_SOURCE_UNAUTHORIZED")
          flight.downloadAuthorityFailed = true;
        download.consumed = true;
        this.trace("DOWNLOAD_BLOCKED", context, result ?? error(this.startupReason()));
        return false;
      }
      download.intent = result.intent;
      return true;
    }
    matchingFlight(details) {
      const context = this.contexts.get(details.tabId);
      const flight = context?.flight;
      return details.type === "main_frame" && details.frameId === 0 && context !== void 0 && flight != null && flight.requestId === details.requestId && flight.url === withoutFragment(details.url) && details.timeStamp >= flight.timeStamp ? { context, flight } : null;
    }
    blockDownload(context, flight, reason) {
      if (flight.download) flight.download.consumed = true;
      if (context.flight === flight) {
        const generation = context.generation;
        this.trace("DOWNLOAD_BLOCKED", context, error(reason));
        this.schedule(() => {
          void this.run(async () => {
            if (!this.live(context, generation) || context.flight !== flight) return;
            const result = flight.destination === null ? error("INVALID_TARGET") : await this.check(context, flight.destination.target);
            if (!this.live(context, generation) || context.flight !== flight) return;
            this.publish(context, allowed(result) ? error(reason) : result);
            await this.removeContent(context, generation);
          });
        }, 0);
      }
      return { cancel: true };
    }
    downloadSending = (details) => {
      const match = this.matchingFlight(details);
      if (match === null) return Promise.resolve({ cancel: true });
      const { context, flight } = match;
      if (flight.download === null) return Promise.resolve(flight.released ? {} : { cancel: true });
      return this.run(async () => {
        const download = flight.download;
        if (context.flight !== flight) return { cancel: true };
        if (download.intent?.phase === "REQUESTING") {
          if (await this.advanceDownload(context, flight, "CHECK")) return {};
        } else if (hasUserActivation(details.requestHeaders)) {
          const prepared = download.intent !== null || await this.advanceDownload(context, flight, "PREPARE");
          if (prepared && await this.advanceDownload(context, flight, "REQUEST")) {
            this.trace("DOWNLOAD_FETCH", context, error("DOWNLOAD_RESPONSE_PENDING"));
            return {};
          }
        }
        if (!download.exceptional && flight.released && !flight.downloadAuthorityFailed && this.host?.controller.getView().status === "READY" && flight.authority?.policyRevision === this.host.controller.getView().snapshot?.policyRevision) {
          flight.download = null;
          return {};
        }
        return this.blockDownload(context, flight, "DOWNLOAD_ACTIVATION_OR_AUTHORITY_MISSING");
      }).catch(() => this.blockDownload(context, flight, "DOWNLOAD_CHECK_FAILED"));
    };
    downloadResponse = (details) => {
      const match = this.matchingFlight(details);
      if (match === null) return Promise.resolve({ cancel: true });
      const { context, flight } = match;
      return this.run(async () => {
        if (context.flight !== flight || this.stopped) return { cancel: true };
        const file = isAttachment(details.statusCode, details.responseHeaders);
        if (!flight.download?.exceptional) {
          if (!flight.released) return { cancel: true };
          flight.fileResponse = file;
          if (isHttpRedirect(details.statusCode) && flight.download) flight.download.redirectResponse = downloadRedirectUrl(details.url, details.responseHeaders);
          return {};
        }
        if (flight.download.intent?.phase !== "REQUESTING") return this.blockDownload(context, flight, "DOWNLOAD_NOT_STARTED");
        if (isHttpRedirect(details.statusCode)) {
          const redirect = downloadRedirectUrl(details.url, details.responseHeaders);
          if (redirect === null) return this.blockDownload(context, flight, "DOWNLOAD_UNSUPPORTED_REDIRECT");
          if (!await this.advanceDownload(context, flight, "CHECK")) return this.blockDownload(context, flight, "DOWNLOAD_INVALIDATED");
          flight.download.redirectResponse = redirect;
          return {};
        }
        if (file) {
          if (!await this.advanceDownload(context, flight, "ATTACHMENT")) return this.blockDownload(context, flight, "DOWNLOAD_INVALIDATED");
          flight.fileResponse = true;
          flight.download.consumed = true;
          this.trace("DOWNLOAD_FILE", context, error("DOWNLOAD_ATTACHMENT_ACCEPTED"));
          return {};
        }
        flight.download.consumed = true;
        const result = flight.destination === null ? error("INVALID_TARGET") : await this.check(context, flight.destination.target);
        if (context.flight !== flight || this.stopped) return { cancel: true };
        if (!allowed(result)) {
          this.publish(context, result);
          return this.blockDownload(context, flight, "DOWNLOAD_DOCUMENT_REQUIRES_ACCESS");
        }
        flight.download = null;
        flight.released = true;
        flight.authority = result;
        this.publish(context, result);
        return {};
      }).catch(() => this.blockDownload(context, flight, "DOWNLOAD_CHECK_FAILED"));
    };
    downloadFinished = (details) => {
      const match = this.matchingFlight(details);
      if (match === null || !match.flight.fileResponse) return;
      const { context, flight } = match;
      if (flight.download) flight.download.consumed = true;
      context.flight = null;
      context.requested = context.displayed;
      this.trace("DOWNLOAD_FINISHED", context, error("DOWNLOAD_HANDED_TO_FIREFOX"), flight.destination?.target.hostname ?? null);
      void this.refresh();
    };
    async removeContent(context, generation) {
      if (!this.live(context, generation)) return;
      if (await this.returnExpiredJourney(context, generation)) return;
      if (!this.live(context, generation)) return;
      context.flight = null;
      context.launching = false;
      context.effect = "REMOVING";
      this.clearRemoval(context);
      context.removalTimer = this.schedule(() => {
        if (this.live(context, generation) && context.effect === "REMOVING") void this.closeUncontrolled(context);
      }, 3e3);
      try {
        await this.api.tabs.update(context.tabId, { url: `${this.uiUrl}?view=access&tab=${context.tabId}` });
      } catch {
        if (this.live(context, generation)) await this.closeUncontrolled(context);
      }
    }
    /** Browser effect after saved expiry and a fresh Core Whitelist assessment. */
    async returnExpiredJourney(context, generation) {
      const journey = this.journey(context);
      const origin = context.rootOrigin;
      if (context.timeoutReturn !== null || journey?.phase !== "ENDED" || journey.endReason !== "EXPIRED" || origin?.journeyId !== journey.id || this.host?.controller.getView().status !== "READY") return false;
      if (context.requested?.target.hostname !== journey.currentHostname) return false;
      const root = destination(`${origin.origin}/`);
      if (root === null || root.target.hostname !== journey.rootHostname) return false;
      const result = await this.check(context, root.target);
      if (!this.live(context, generation) || !whitelisted(result)) return false;
      context.timeoutReturn = { journeyId: journey.id, hostname: root.target.hostname, awaitingRequest: true };
      context.displayed = null;
      context.displayedDecision = null;
      context.requested = root;
      context.effect = "NONE";
      this.publish(context, result);
      this.navigate(context, `${origin.origin}/`);
      return true;
    }
    recordLaunch(hostname2) {
      try {
        this.onDestinationLaunch?.(hostname2, this.now());
      } catch {
      }
    }
    async closeUncontrolled(context) {
      this.clearRemoval(context);
      try {
        await this.api.tabs.remove(context.tabId);
      } catch {
        context.effect = "FAILED";
        this.publish(context, error("CONTENT_REMOVAL_FAILED"));
      }
    }
    acknowledgeRemoval(context) {
      if (context.effect !== "REMOVED") this.trace("CONTENT_REMOVED", context);
      this.clearRemoval(context);
      context.effect = "REMOVED";
      context.displayed = null;
      context.displayedDecision = null;
      context.flight = null;
      context.launching = false;
    }
    arrived = (details) => {
      if (details.frameId !== 0 || this.stopped) return;
      const context = this.context(details.tabId);
      const generation = context.generation;
      const received = destination(details.url);
      const released = context.flight;
      const receivedJourney = this.journey(context);
      const matchedAtReceipt = received !== null && released !== null && released.released && released.authority !== null && released.url === withoutFragment(details.url) && released.timeStamp <= details.timeStamp && details.timeStamp > context.lastArrival;
      if (matchedAtReceipt) {
        context.displayed = received;
        context.displayedDecision = released.authority;
      } else if (received === null && !/^https?:\/\//i.test(details.url) && details.timeStamp > context.lastArrival) {
        context.displayed = null;
        context.displayedDecision = null;
      }
      void this.run(async () => {
        if (details.timeStamp <= context.lastArrival) return;
        if (!this.live(context, generation)) {
          if (this.stopped || this.contexts.get(context.tabId) !== context || received === null || receivedJourney === null || this.journey(context)?.id !== receivedJourney.id) return;
          if (matchedAtReceipt && released.journeyId === receivedJourney.id && receivedJourney.phase !== "ENDED") {
            await this.host?.controller.handle({
              kind: "RECORD_JOURNEY_NAVIGATION",
              target: received.target,
              context: {
                contextId: context.id,
                journeyId: receivedJourney.id,
                continuation: { kind: "ARRIVAL", sourceHostname: receivedJourney.currentHostname }
              }
            });
            context.lastArrival = details.timeStamp;
          } else if (!matchedAtReceipt && (released === null || details.timeStamp >= released.timeStamp)) {
            await this.loseJourney(context);
            context.lastArrival = details.timeStamp;
          }
          return;
        }
        let tab;
        try {
          tab = await this.api.tabs.get(details.tabId);
        } catch (failure) {
          if (!this.live(context, generation)) return;
          throw failure;
        }
        if (!this.live(context, generation) || tab.url === void 0 || withoutFragment(tab.url) !== withoutFragment(details.url)) return;
        context.badge = "";
        context.pill = "";
        if (withoutFragment(details.url).split("?", 1)[0] === this.uiUrl) {
          if (context.flight !== null || context.launching) return;
          context.lastArrival = details.timeStamp;
          this.acknowledgeRemoval(context);
          if (context.latest !== null) this.publish(context, context.latest);
          return;
        }
        const observed = destination(details.url);
        if (observed === null) {
          if (/^https?:\/\//i.test(details.url)) {
            this.publish(context, error("INVALID_TARGET"));
            await this.removeContent(context, generation);
            return;
          }
          if (!context.launching && context.flight === null) {
            context.lastArrival = details.timeStamp;
            context.displayed = null;
            context.displayedDecision = null;
            await this.loseJourney(context);
          }
          return;
        }
        context.lastArrival = details.timeStamp;
        const flight = context.flight;
        const matched = flight !== null && flight.released && flight.url === withoutFragment(details.url) && flight.timeStamp <= details.timeStamp;
        context.displayed = observed;
        context.displayedDecision = matched ? flight.authority : null;
        if (context.launching) {
          context.launching = false;
          this.clearRemoval(context);
        }
        context.flight = null;
        if (!matched) await this.loseJourney(context);
        const journey = this.journey(context);
        const active = matched && journey !== null && journey.phase !== "ENDED" && journey.id === flight.journeyId;
        const continuation = active ? { kind: "ARRIVAL", sourceHostname: journey.currentHostname } : void 0;
        const result = await this.check(context, observed.target, active, continuation);
        if (!this.live(context, generation)) return;
        this.publish(context, result);
        context.displayedDecision = result.type === "ADAPTER_ERROR" ? null : result;
        context.requested = observed;
        if (allowed(result)) context.effect = "NONE";
        this.publishJourney(context);
        this.trace("ARRIVED", context, result, observed.target.hostname);
        const userArrival = matched && !flight.syntheticReturn && flight.continuationKind !== "HTTP_REDIRECT" && (details.transitionType === "typed" || details.transitionType === "auto_bookmark");
        if (whitelisted(result) && userArrival) context.timeoutReturn = null;
        if (whitelisted(result) && matched && !flight.launchRecorded && context.timeoutReturn === null && userArrival) this.recordLaunch(observed.target.hostname);
        if (!allowed(result)) await this.removeContent(context, generation);
      }).catch(() => {
        if (this.live(context, generation)) {
          this.publish(context, error("ARRIVAL_RECONCILIATION_FAILED"));
          void this.run(() => this.removeContent(context, generation));
        }
      });
    };
    requestFailed = (details) => {
      if (this.matchingFlight(details)?.flight.fileResponse) {
        this.downloadFinished(details);
        return;
      }
      const downloadMatch = this.matchingFlight(details);
      if (downloadMatch?.flight.download?.exceptional) {
        if (!downloadMatch.flight.download.consumed) this.blockDownload(downloadMatch.context, downloadMatch.flight, "DOWNLOAD_NETWORK_FAILED");
        return;
      }
      if (details.type !== "main_frame" || details.frameId !== 0) return;
      const context = this.contexts.get(details.tabId);
      const flight = context?.flight;
      if (context === void 0 || flight === null || flight === void 0 || flight.requestId !== details.requestId || flight.url !== withoutFragment(details.url)) return;
      if (flight.released) {
        context.flight = null;
        this.publish(context, error("NAVIGATION_FAILED"));
        this.trace("FAILED", context);
        void this.refresh();
      }
    };
    redirected = (details) => {
      const context = this.contexts.get(details.tabId);
      if (details.type !== "main_frame" || details.frameId !== 0 || context?.flight === null || context?.flight === void 0 || context.flight.requestId !== details.requestId || !context.flight.released && !(context.flight.download?.redirectResponse && context.flight.download.intent?.phase === "REQUESTING") || context.flight.timeStamp > details.timeStamp || context.flight.url !== withoutFragment(details.url)) return;
      if (context.flight.download?.exceptional && context.flight.download.redirectResponse !== withoutFragment(details.redirectUrl)) return;
      context.flight.redirectUrl = withoutFragment(details.redirectUrl);
      this.trace("REDIRECT", context, null, destination(details.redirectUrl)?.target.hostname ?? null);
    };
    closed = (tabId) => {
      this.downloadTargets.delete(tabId);
      const context = this.contexts.get(tabId);
      if (context === void 0) return;
      this.contexts.delete(tabId);
      this.clearRemoval(context);
      context.generation++;
      this.trace("CONTEXT_CLOSED", context);
      void this.run(() => this.loseJourney(context));
    };
    changed = () => {
      void this.refresh();
    };
    updated = (_tabId, change) => {
      if (change.status === "complete") void this.refresh();
    };
    /** Coalesce timer/lifecycle checks so a slow backend cannot create an unbounded timer queue. */
    refresh() {
      if (this.refreshPending !== null) return this.refreshPending;
      this.refreshPending = this.run(() => this.recheck()).catch(async () => {
        for (const context of this.contexts.values()) {
          this.publish(context, error("BROWSER_STATE_UNAVAILABLE"));
          await this.removeContent(context, context.generation);
        }
      }).finally(() => {
        this.refreshPending = null;
      });
      return this.refreshPending;
    }
    /** Recover transient storage failures, never replay an operation. Unknown
     * writes, damaged data and quota still require explicit recovery. Core alone
     * handles clock catch-up through OBSERVE_TIME, outside this storage path. */
    async recoverTransientStorage() {
      const host3 = this.host;
      const view = host3?.controller.getView();
      this.rememberAuthorityInterruption(view);
      const failure = this.storageDiagnostics()?.lastFailure;
      if (!host3 || this.storageRecoveryUsed || view?.status !== "UNAVAILABLE" || view.pendingCommitId !== null || !(view.reason === "WRITE_FAILED" && failure?.operation === "COMMIT" || view.reason === "STORAGE_UNAVAILABLE" && failure?.operation === "LOAD") || failure?.stage !== "TRANSACTION_ABORT" || failure.cause !== "ABORTED" && failure.cause !== "IO_ERROR") return false;
      this.storageRecoveryUsed = true;
      await host3.controller.open();
      const recovered = host3.controller.getView();
      this.rememberAuthorityInterruption(recovered);
      return recovered.status === "READY";
    }
    rememberAuthorityInterruption(current) {
      try {
        const view = current ?? this.host?.controller.getView();
        if (view?.status === "READY") {
          this.interruptionKey = "";
          return;
        }
        if (!view || view.status !== "UNAVAILABLE" && view.status !== "RECONCILING" || view.reason === null) return;
        const failure = this.storageDiagnostics()?.lastFailure ?? null;
        const fault = view.internalFault;
        const relatedFault = fault && (view.reason === "INTERNAL_ERROR" && fault.pendingCommitId === null || view.reason === "COMMIT_UNKNOWN" && view.pendingCommitId !== null && fault.pendingCommitId === view.pendingCommitId) ? fault : void 0;
        const key2 = JSON.stringify([view.status, view.reason, failure?.sequence, relatedFault?.sequence]);
        if (key2 === this.interruptionKey) return;
        let at = null;
        try {
          const now2 = this.now();
          if (Number.isSafeInteger(now2) && now2 >= 0) at = now2;
        } catch {
        }
        const snapshot = view.snapshot;
        this.authorityInterruption = Object.freeze({
          status: view.status,
          reason: view.reason,
          observedAt: at,
          checkpointAt: snapshot ? Math.max(
            snapshot.accessState.lastObservedAt,
            snapshot.vaultState.lastObservedAt,
            snapshot.journeyState.lastObservedAt
          ) : null,
          latestStorageFailure: failure,
          ...relatedFault === void 0 ? {} : { internalFault: relatedFault }
        });
        this.interruptionKey = key2;
      } catch {
      }
    }
    storageDiagnostics() {
      try {
        const source = this.host?.repository.getDiagnostics?.();
        if (!source) return null;
        const failure = source.lastFailure;
        return Object.freeze({
          readTransactions: source.readTransactions,
          writeTransactions: source.writeTransactions,
          committedWrites: source.committedWrites,
          failedCommits: source.failedCommits,
          lastFailure: failure ? Object.freeze({
            sequence: failure.sequence,
            operation: failure.operation,
            stage: failure.stage,
            cause: failure.cause
          }) : null
        });
      } catch {
        return null;
      }
    }
    curatedUpgrade() {
      try {
        return this.host?.repository.getCuratedUpgrade?.() ?? null;
      } catch {
        return null;
      }
    }
    async checkRetained(context, target) {
      const assess = () => {
        const retained = this.journey(context);
        return this.check(context, target, false, retained !== null && retained.phase !== "ENDED" ? { kind: "RETAINED", sourceHostname: retained.currentHostname } : void 0);
      };
      const result = await assess();
      return result.type === "BLOCKED" && await this.recoverTransientStorage() ? assess() : result;
    }
    async recheck(endedGrant) {
      if (this.host?.controller.getView().status === "READY") this.storageRecoveryUsed = false;
      const generations = new Map([...this.contexts.values()].map((context) => [context.tabId, context.generation]));
      await this.recoverTransientStorage();
      let observation = await this.host?.controller.handle({ kind: "OBSERVE_TIME" });
      if (observation?.type === "BLOCKED" && await this.recoverTransientStorage())
        observation = await this.host?.controller.handle({ kind: "OBSERVE_TIME" });
      for (const [tabId, target] of this.downloadTargets) if (this.now() - target.at >= 3e3 || this.contexts.get(target.source.context.tabId) !== target.source.context)
        this.downloadTargets.delete(tabId);
      for (const context of this.contexts.values()) {
        const flight = context.flight;
        if (endedGrant !== void 0 && flight?.authority?.type === "ASSESSMENT" && flight.authority.decision.reason === "ACTIVE_GRANT" && flight.authority.decision.requestId === endedGrant) {
          ++context.generation;
          context.flight = null;
          this.publish(context, error("RECHECK_REQUIRED"));
          await this.loseJourney(context);
          await this.removeContent(context, context.generation);
          continue;
        }
        const intent = flight?.download?.intent;
        if (flight && intent && flight.download?.exceptional && !flight.fileResponse && (observation?.type !== "OBSERVED" || !this.downloadLive(context, flight) || intent.policyRevision !== this.host?.controller.getView().snapshot?.policyRevision || this.now() >= intent.expiresAt)) {
          this.blockDownload(context, flight, "DOWNLOAD_INVALIDATED");
        }
      }
      const returned = /* @__PURE__ */ new Set();
      if (observation?.type === "OBSERVED") for (const context of this.contexts.values()) {
        const generation = generations.get(context.tabId);
        if (generation !== void 0 && this.live(context, generation) && await this.returnExpiredJourney(context, generation)) returned.add(context.tabId);
      }
      for (const context of this.contexts.values()) {
        if (context.latest !== null) this.publish(context, context.latest);
      }
      const tabs = await this.api.tabs.query({});
      for (const tab of tabs) {
        if (tab.id === void 0 || tab.url === void 0 || tab.incognito) continue;
        if (returned.has(tab.id)) continue;
        const observed = destination(tab.url);
        const previous = this.contexts.get(tab.id);
        if (previous !== void 0 && generations.has(tab.id) && previous.generation !== generations.get(tab.id)) continue;
        if (withoutFragment(tab.url).split("?", 1)[0] === this.uiUrl) {
          if (previous !== void 0 && previous.flight === null && !previous.launching) {
            this.acknowledgeRemoval(previous);
            if (previous.requested !== null) this.publish(previous, await this.checkRetained(previous, previous.requested.target));
          }
          continue;
        }
        if (previous?.effect === "REMOVING") continue;
        if (observed === null) {
          if (/^https?:\/\//i.test(tab.url)) {
            const context2 = previous ?? this.context(tab.id);
            this.publish(context2, error("INVALID_TARGET"));
            await this.removeContent(context2, context2.generation);
          } else if (previous !== void 0 && !previous.launching && previous.flight === null) {
            await this.loseJourney(previous);
            previous.displayed = null;
            previous.displayedDecision = null;
          }
          continue;
        }
        const context = previous ?? this.context(tab.id);
        const generation = context.generation;
        if (context.flight !== null || context.launching) {
          const authorities = [context.displayedDecision, context.flight?.authority];
          const expired = authorities.some((retained) => retained?.type === "ASSESSMENT" && "expiresAt" in retained.decision && this.now() >= retained.decision.expiresAt);
          const revisionChanged = authorities.some((retained) => retained != null && "policyRevision" in retained && retained.policyRevision !== this.host?.controller.getView().snapshot?.policyRevision);
          if (observation?.type === "OBSERVED" && !expired && !revisionChanged) continue;
          ++context.generation;
          context.flight = null;
          this.publish(context, error("RECHECK_REQUIRED"));
          await this.loseJourney(context);
          await this.removeContent(context, context.generation);
          continue;
        }
        const journey = this.journey(context);
        if (context.displayed?.target.hostname !== observed.target.hostname || journey !== null && journey.phase !== "ENDED" && journey.currentHostname !== observed.target.hostname) {
          await this.loseJourney(context);
        }
        const result = await this.checkRetained(context, observed.target);
        if (!this.live(context, generation)) continue;
        context.displayed = observed;
        context.displayedDecision = result.type === "ADAPTER_ERROR" ? null : result;
        this.publish(context, result);
        context.requested = observed;
        if (!allowed(result)) await this.removeContent(context, generation);
      }
    }
    preparedAccessScope(context) {
      const scope = context.accessScope;
      const snapshot = this.host?.controller.getView().snapshot;
      return scope !== null && snapshot !== null && snapshot !== void 0 && this.live(context, scope.generation) && context.requested?.origin === scope.origin && snapshot.policyRevision === scope.policyRevision ? scope : null;
    }
    /** Discovery runs outside the operation queue and can never hold navigation checks. */
    async prepareAccessScope(tabId) {
      if (!Number.isSafeInteger(tabId)) return { error: "INVALID_CONTEXT" };
      const prepared = await this.run(async () => {
        const context = this.contexts.get(tabId);
        const controller = this.host?.controller;
        if (context?.requested === null || context === void 0 || controller === void 0)
          return { error: "CONTEXT_UNAVAILABLE" };
        const generation = context.generation;
        const result = await this.check(context, context.requested.target);
        if (!this.live(context, generation)) return { error: "REQUEST_CONTEXT_CHANGED" };
        this.publish(context, result);
        if (result.type !== "ASSESSMENT" || result.decision.outcome !== "GREYLIST")
          return { error: "NOT_GREYLIST" };
        const snapshot = controller.getView().snapshot;
        if (snapshot == null) return { error: this.host === null ? this.startupReason() : "STORAGE_UNAVAILABLE" };
        const existing = this.preparedAccessScope(context);
        if (existing !== null) return { work: existing.work };
        const aliases = equivalentServiceHostnames(context.requested.target.hostname);
        const hostnames = aliases.filter((host3) => evaluate({ hostname: host3 }, snapshot.policy).outcome !== "ALLOW");
        const discoveryOrigin = canonicalDiscoveryOrigin(context.requested.origin);
        const discover = aliases.length === 1 && discoveryOrigin !== null && this.discoverCanonicalEntry !== void 0;
        const scope = {
          generation,
          origin: context.requested.origin,
          policyRevision: snapshot.policyRevision,
          preview: Object.freeze({
            id: `${context.id}:${++this.nextAccessScope}`,
            status: discover ? "PREPARING" : "READY",
            hostnames: Object.freeze(hostnames),
            source: aliases.length > 1 ? "DECLARED" : "EXACT"
          }),
          work: Promise.resolve()
        };
        context.accessScope = scope;
        if (discover) {
          scope.work = Promise.resolve().then(() => this.discoverCanonicalEntry(discoveryOrigin)).catch(() => null).then((partner) => this.run(() => {
            if (this.preparedAccessScope(context) !== scope) return;
            const current = controller.getView().snapshot;
            const sanitized = typeof partner === "string" ? canonicalEntryCounterpart(discoveryOrigin, `https://${partner}/`) : null;
            const counterpart = sanitized === partner ? sanitized : null;
            const members = counterpart === null ? hostnames : [...hostnames, counterpart].filter((host3) => evaluate({ hostname: host3 }, current.policy).outcome !== "ALLOW");
            scope.preview = Object.freeze({
              ...scope.preview,
              status: "READY",
              hostnames: Object.freeze(members),
              source: counterpart === null ? "EXACT" : "CANONICAL_REDIRECT"
            });
          })).then(() => void 0);
        }
        return { work: scope.work };
      });
      if ("work" in prepared) await prepared.work;
      return { ..."error" in prepared ? { error: prepared.error } : {}, view: this.view() };
    }
    view() {
      const controller = this.host?.controller.getView() ?? null;
      return {
        startup: this.startup,
        controller,
        managed: this.host?.managed?.getView(controller?.snapshot?.policy.whitelist) ?? null,
        storage: this.storageDiagnostics(),
        authorityInterruption: this.authorityInterruption,
        curatedUpgrade: this.curatedUpgrade(),
        ...accessOverview(controller, this.now(), this.host?.managed?.getBlacklist()),
        contexts: [...this.contexts.values()].map((context) => ({
          tabId: context.tabId,
          contextId: context.id,
          navigationId: context.navigationId,
          hostname: context.requested?.target.hostname ?? null,
          displayedHostname: context.displayed?.target.hostname ?? null,
          latest: context.latest,
          journey: this.journey(context),
          effect: context.effect,
          retry: journeyRetry(controller, this.journey(context)),
          accessScope: this.preparedAccessScope(context)?.preview ?? null
        }))
      };
    }
    message = (input, sender) => {
      if (sender.id === this.api.runtime.id && sender.tab?.id !== void 0 && sender.frameId === 0 && input !== null && typeof input === "object" && !Array.isArray(input) && Object.keys(input).length === 1 && Object.hasOwn(input, "kind") && input.kind === "GET_JOURNEY_DISPLAY") {
        const context = this.contexts.get(sender.tab.id);
        const observed = sender.url === void 0 ? null : destination(sender.url);
        return Promise.resolve({ presentation: context && observed?.target.hostname === context.displayed?.target.hostname ? this.pageJourney(context) : null });
      }
      if (sender.id === this.api.runtime.id && sender.url?.split(/[?#]/, 1)[0] === this.api.runtime.getURL("ui/popup.html") && (sender.frameId ?? 0) === 0) {
        if (!toolbarRequest(input)) return Promise.resolve({ error: "INVALID_COMMAND" });
        const context = this.contexts.get(input.tabId);
        if (input.kind === "GET_TOOLBAR_STATUS") {
          const ready = this.host?.controller.getView().status === "READY";
          const journey = ready && context ? this.journey(context) : null;
          const status = {
            ready,
            tabId: input.tabId,
            contextId: context?.id ?? null,
            hostname: context?.requested?.target.hostname ?? null,
            decision: ready && context?.latest?.type === "ASSESSMENT" ? context.latest.decision : null,
            journey: journey && journey.phase !== "ENDED" ? { hostname: journey.rootHostname, expiresAt: journey.expiresAt } : null
          };
          return Promise.resolve({ status });
        }
        return this.run(async () => {
          if (input.page === "access" && (!context || context.id !== input.contextId || this.contexts.get(input.tabId) !== context)) return { error: "CONTEXT_CLOSED" };
          const tabs = await this.api.tabs.query({});
          const source = tabs.find((t) => t.id === input.tabId);
          if (!source && input.page === "access") return { error: "CONTEXT_CLOSED" };
          const existing = tabs.find((t) => t.windowId === source?.windowId && t.url?.split(/[?#]/, 1)[0] === this.uiUrl && new URL(t.url).searchParams.get("view") !== "access");
          if (existing?.id !== void 0) {
            const result = await this.api.runtime.sendMessage({ kind: "CONTROL_NAVIGATE", controlTabId: existing.id, page: input.page, tabId: input.tabId });
            if (!result?.navigated) return { error: "CONTROL_UNAVAILABLE" };
            await this.api.tabs.update(existing.id, { active: true });
          } else await this.api.tabs.create({ url: `${this.uiUrl}?view=control&tab=${input.tabId}#${input.page}`, active: true });
          return { opened: true };
        }).catch(() => ({ error: "CONTROL_UNAVAILABLE" }));
      }
      if (sender.id !== this.api.runtime.id || sender.url === void 0 || sender.url.split(/[?#]/, 1)[0] !== this.uiUrl || (sender.frameId ?? 0) !== 0) return false;
      if (input === null || typeof input !== "object" || Array.isArray(input) || !Object.hasOwn(input, "kind") || !("kind" in input) || typeof input.kind !== "string") return Promise.resolve({ error: "INVALID_COMMAND" });
      const command = input;
      if (presentationCommands.includes(command.kind)) return false;
      const keys2 = {
        GET_VIEW: [],
        RECOVER: [],
        SETUP: ["policy"],
        OPEN_JOURNEY: ["url"],
        OPEN_DESTINATION: ["url"],
        START_JOURNEY: ["tabId"],
        CANCEL_JOURNEY: ["tabId"],
        START_ACCESS: ["tabId"],
        PREPARE_ACCESS: ["tabId"],
        RESTART_JOURNEY: ["tabId", "journeyId"],
        CONFIRM_ACCESS: ["requestId"],
        CANCEL_ACCESS: ["requestId"],
        END_ACCESS: ["requestId"],
        OPEN_HOME: ["tabId"],
        CONFIRM_ACCESS_AND_OPEN: ["tabId", "requestId"],
        GET_DIAGNOSTICS: ["tabId"],
        CLEAR_DIAGNOSTICS: [],
        PROPOSE_CURATED_DEFAULTS: [],
        REVIEW_POLICY: ["proposalId"],
        CONFIRM_POLICY: ["proposalId"],
        CANCEL_POLICY: ["proposalId"],
        PROPOSE_SETTINGS: ["candidateConfiguration"],
        PROPOSE_POLICY: ["candidatePolicy"],
        REMOVE_WHITELIST: ["candidatePolicy", "basePolicyRevision"]
      };
      const fields4 = command.kind === "START_ACCESS" && Object.hasOwn(command, "scopeId") ? ["tabId", "scopeId"] : command.kind === "PROPOSE_POLICY" && Object.hasOwn(command, "basePolicyRevision") ? ["candidatePolicy", "basePolicyRevision"] : Object.hasOwn(keys2, command.kind) ? keys2[command.kind] : void 0;
      if (fields4 === void 0 || Object.keys(command).length !== fields4.length + 1 || fields4.some((field) => !Object.hasOwn(command, field))) return Promise.resolve({ error: "INVALID_COMMAND" });
      if (command.kind === "GET_VIEW") {
        try {
          return Promise.resolve({ view: this.view() });
        } catch (error2) {
          this.runtimeDiagnostics.record("VIEW", error2);
          return Promise.resolve({ error: "ADAPTER_FAILURE" });
        }
      }
      if (command.kind === "GET_DIAGNOSTICS") return Promise.resolve(command.tabId === null || Number.isSafeInteger(command.tabId) ? { entries: this.diagnostics.read(command.tabId), storage: this.storageDiagnostics(), authorityInterruption: this.authorityInterruption, curatedUpgrade: this.curatedUpgrade(), runtime: this.runtimeView() } : { error: "INVALID_CONTEXT" });
      if (command.kind === "CLEAR_DIAGNOSTICS") {
        this.diagnostics.clear();
        return Promise.resolve({ entries: [] });
      }
      if (command.kind === "PREPARE_ACCESS") return this.prepareAccessScope(command.tabId).catch(() => ({ error: "SCOPE_PREPARATION_FAILED", view: this.view() }));
      return this.run(() => this.command(command)).catch(() => ({ error: "ADAPTER_FAILURE" }));
    };
    async command(command) {
      if (command.kind === "RECOVER") {
        this.rememberAuthorityInterruption();
        if (this.host === null) await this.loadHost();
        else await this.host.controller.open();
        if (this.host === null) return { error: this.startupReason(), view: this.view() };
        if (this.host.controller.getView().status === "READY") this.storageRecoveryUsed = false;
        await this.recheck();
        return { view: this.view() };
      }
      const controller = this.host?.controller;
      if (controller === void 0) return { error: this.startupReason(), view: this.view() };
      if (command.kind === "SETUP") {
        const initialized = await this.host.repository.initialize(command.policy);
        if (initialized) await controller.open();
        return { initialized, view: this.view() };
      }
      if (command.kind === "PROPOSE_CURATED_DEFAULTS") {
        const observed = await controller.handle({ kind: "OBSERVE_TIME" });
        const policy = controller.getView().snapshot?.policy;
        if (observed.type !== "OBSERVED" || policy === void 0) return { result: observed, view: this.view() };
        const result2 = await controller.handle({ kind: "PROPOSE_POLICY", candidatePolicy: {
          ...policy,
          whitelist: [.../* @__PURE__ */ new Set([...policy.whitelist, ...compileCuratedWhitelist().whitelist.filter((host3) => evaluate({ hostname: host3 }, policy).outcome !== "ALLOW")])],
          blacklist: policy.blacklist,
          whitelistSubdomains: [.../* @__PURE__ */ new Set([
            ...policy.whitelistSubdomains ?? [],
            ...(compileCuratedWhitelist().whitelistSubdomains ?? []).filter((host3) => !policy.blacklist.includes(host3))
          ])]
        } });
        return { result: result2, view: this.view() };
      }
      if (command.kind === "REVIEW_POLICY" || command.kind === "CONFIRM_POLICY" || command.kind === "CANCEL_POLICY") {
        const result2 = await controller.handle({ kind: command.kind, proposalId: command.proposalId });
        if (command.kind === "CONFIRM_POLICY" && result2.type === "COMMITTED") await this.recheck();
        return { result: result2, view: this.view() };
      }
      if (command.kind === "REMOVE_WHITELIST") {
        const result2 = await controller.handle(command);
        if (result2.type === "COMMITTED") await this.recheck();
        return { result: result2, view: this.view() };
      }
      if (command.kind === "PROPOSE_SETTINGS" || command.kind === "PROPOSE_POLICY") {
        if (command.kind === "PROPOSE_POLICY" && Object.hasOwn(command, "basePolicyRevision")) {
          if (!Number.isSafeInteger(command.basePolicyRevision) || command.basePolicyRevision < 0)
            return { error: "INVALID_COMMAND", view: this.view() };
          const observed = await controller.handle({ kind: "OBSERVE_TIME" });
          if (observed.type !== "OBSERVED") return { result: observed, view: this.view() };
          if (controller.getView().snapshot?.policyRevision !== command.basePolicyRevision)
            return { error: "POLICY_DRAFT_STALE", view: this.view() };
        }
        const result2 = await controller.handle(command.kind === "PROPOSE_POLICY" ? { kind: "PROPOSE_POLICY", candidatePolicy: command.candidatePolicy } : command);
        return { result: result2, view: this.view() };
      }
      let result;
      if (command.kind === "OPEN_DESTINATION") {
        if (typeof command.url !== "string" || command.url.length > 4096) return { error: "INVALID_TARGET" };
        const url = /^https?:\/\//i.test(command.url) ? command.url : `https://${command.url}`;
        const selected = destination(url);
        if (selected === null) return { error: "INVALID_TARGET" };
        const tab = await this.api.tabs.create({ url: "about:blank", active: false });
        if (tab.id === void 0) return { error: "CONTEXT_UNAVAILABLE" };
        const context2 = this.context(tab.id);
        context2.requested = selected;
        context2.launchIntent = true;
        this.navigate(context2, url);
        void this.api.tabs.update(tab.id, { active: true }).catch(() => void 0);
        return { opened: true, tabId: tab.id, view: this.view() };
      }
      if (command.kind === "OPEN_JOURNEY") {
        if (typeof command.url !== "string" || command.url.length > 4096) return { error: "INVALID_TARGET" };
        const url = /^https?:\/\//i.test(command.url) ? command.url : `https://${command.url}`;
        const selected = destination(url);
        if (selected === null) return { error: "INVALID_TARGET" };
        const tab = await this.api.tabs.create({ url: "about:blank", active: false });
        if (tab.id === void 0) return { error: "CONTEXT_UNAVAILABLE" };
        const context2 = this.context(tab.id);
        context2.requested = selected;
        context2.launchIntent = true;
        result = await controller.handle({ kind: "START_JOURNEY", root: selected.target, contextId: context2.id });
        this.trace("COMMAND", context2, result);
        this.publish(context2, result);
        if (result.type === "COMMITTED" && this.contexts.get(tab.id) === context2) {
          this.navigate(context2, url);
          void this.api.tabs.update(tab.id, { active: true }).catch(() => void 0);
        } else await this.api.tabs.remove(tab.id);
        return { result, tabId: tab.id, view: this.view() };
      }
      if (command.kind === "CONFIRM_ACCESS" || command.kind === "CANCEL_ACCESS" || command.kind === "END_ACCESS") {
        result = await controller.handle({ kind: command.kind, requestId: command.requestId });
        if (command.kind === "END_ACCESS" && result.type === "COMMITTED") await this.recheck(command.requestId);
        return { result, view: this.view() };
      }
      if (!Number.isSafeInteger(command.tabId)) return { error: "INVALID_CONTEXT" };
      const context = this.contexts.get(command.tabId);
      if (context === void 0 || context.requested === null) return { error: "CONTEXT_UNAVAILABLE" };
      if (command.kind === "RESTART_JOURNEY") {
        const retry = journeyRetry(controller.getView(), this.journey(context));
        if (retry === null || retry.journeyId !== command.journeyId) return { error: "JOURNEY_RETRY_UNAVAILABLE" };
        if (context.effect === "REMOVING") return { error: "CONTENT_REMOVAL_IN_PROGRESS", opened: false, view: this.view() };
        if (context.launching || context.flight !== null) return { error: "NAVIGATION_IN_PROGRESS" };
        const generation = context.generation;
        result = await this.check(context, { hostname: retry.rootHostname });
        if (!whitelisted(result) || !this.live(context, generation))
          return { result, opened: false, view: this.view() };
        const origin = context.rootOrigin?.journeyId === retry.journeyId ? context.rootOrigin.origin : `https://${retry.rootHostname}`;
        context.requested = destination(`${origin}/`);
        context.launchIntent = true;
        context.timeoutReturn = null;
        this.publish(context, result);
        this.navigate(context, `${origin}/`);
        return { opened: true, view: this.view() };
      }
      if (command.kind === "CONFIRM_ACCESS_AND_OPEN") {
        const pending = controller.getView().snapshot?.accessState.pendingRequests.find((request) => request.id === command.requestId);
        if (pending === void 0 || !(pending.scopeHostnames ?? [pending.hostname]).includes(context.requested.target.hostname)) return { error: "REQUEST_CONTEXT_CHANGED", view: this.view() };
        const generation = context.generation;
        const selected = context.requested;
        result = await controller.handle({ kind: "CONFIRM_ACCESS", requestId: command.requestId });
        this.trace("COMMAND", context, result);
        const opened = result.type === "COMMITTED" && this.live(context, generation) && context.requested === selected;
        if (opened) this.navigate(context, `${selected.origin}/`);
        return { result, opened, view: this.view() };
      }
      if (command.kind === "OPEN_HOME") {
        this.navigate(context, `${context.requested.origin}/`);
        return { view: this.view() };
      }
      if (command.kind === "START_ACCESS") {
        const policy = controller.getView().snapshot?.policy;
        const prepared = this.preparedAccessScope(context);
        let scopeHostnames = prepared?.preview.hostnames ?? equivalentServiceHostnames(context.requested.target.hostname).filter((host3) => !policy || evaluate({ hostname: host3 }, policy).outcome !== "ALLOW");
        if (this.discoverCanonicalEntry !== void 0 || Object.hasOwn(command, "scopeId")) {
          const generation = context.generation;
          const current = await this.check(context, context.requested.target);
          if (!this.live(context, generation)) return { error: "REQUEST_CONTEXT_CHANGED", view: this.view() };
          this.publish(context, current);
          if (current.type === "ASSESSMENT" && (current.decision.outcome === "WAIT" || current.decision.outcome === "REQUIRE_CONFIRMATION")) {
            const requestId = current.decision.requestId;
            const pending = controller.getView().snapshot?.accessState.pendingRequests.find((request) => request.id === requestId);
            if (pending === void 0) return { error: "REQUEST_CONTEXT_CHANGED", view: this.view() };
            scopeHostnames = pending.scopeHostnames ?? [pending.hostname];
          } else if (current.type !== "ASSESSMENT" || current.decision.outcome !== "GREYLIST" || this.preparedAccessScope(context) !== prepared || prepared?.preview.status !== "READY" || command.scopeId !== prepared.preview.id) return { error: "SCOPE_REVIEW_REQUIRED", view: this.view() };
        }
        result = await controller.handle({ kind: "START_ACCESS", target: context.requested.target, scopeHostnames });
        if (result.type === "COMMITTED") context.accessScope = null;
      } else if (command.kind === "START_JOURNEY") {
        if (context.flight !== null) return { error: "NAVIGATION_IN_PROGRESS" };
        result = await controller.handle({ kind: "START_JOURNEY", root: context.requested.target, contextId: context.id });
      } else {
        const journey = this.journey(context);
        if (journey === null) return { error: "JOURNEY_NOT_FOUND" };
        result = await controller.handle({ kind: "CANCEL_JOURNEY", journeyId: journey.id, contextId: context.id });
      }
      this.trace("COMMAND", context, result);
      this.publish(context, result);
      if (command.kind === "CANCEL_JOURNEY") await this.recheck();
      else if (result.type === "COMMITTED" && this.contexts.get(context.tabId) === context && context.requested !== null)
        this.publish(context, await this.check(context, context.requested.target));
      return { result, view: this.view() };
    }
    navigate(context, url) {
      const generation = ++context.generation;
      context.flight = null;
      context.launching = true;
      this.clearRemoval(context);
      context.removalTimer = this.schedule(() => {
        if (this.live(context, generation) && context.launching) {
          void this.run(async () => {
            if (!this.live(context, generation) || !context.launching) return;
            this.publish(context, error("NAVIGATION_DID_NOT_START"));
            this.trace("FAILED", context);
            await this.loseJourney(context);
            await this.removeContent(context, generation);
          });
        }
      }, 1e4);
      void this.api.tabs.update(context.tabId, { url }).catch(() => {
        if (this.live(context, generation)) {
          context.launching = false;
          this.clearRemoval(context);
          this.publish(context, error("NAVIGATION_FAILED"));
          this.trace("FAILED", context);
          void this.run(() => this.loseJourney(context));
        }
      });
    }
    stop() {
      this.stopped = true;
      for (const context of this.contexts.values()) this.clearRemoval(context);
      this.api.webRequest.onBeforeRequest.removeListener(this.beforeRequest);
      this.api.webRequest.onErrorOccurred.removeListener(this.requestFailed);
      this.api.webRequest.onBeforeRedirect.removeListener(this.redirected);
      this.api.webRequest.onBeforeSendHeaders.removeListener(this.downloadSending);
      this.api.webRequest.onHeadersReceived.removeListener(this.downloadResponse);
      this.api.webRequest.onCompleted.removeListener(this.downloadFinished);
      this.api.webNavigation.onCreatedNavigationTarget.removeListener(this.downloadTargetCreated);
      this.downloadTargets.clear();
      this.api.webNavigation.onCommitted.removeListener(this.arrived);
      this.api.webNavigation.onHistoryStateUpdated.removeListener(this.changed);
      this.api.webNavigation.onReferenceFragmentUpdated.removeListener(this.changed);
      this.api.tabs.onRemoved.removeListener(this.closed);
      this.api.tabs.onUpdated.removeListener(this.updated);
      this.api.runtime.onMessage.removeListener(this.message);
    }
  };

  // src/background/configuration.ts
  var configuration = {
    accessTiming: { waitMs: 1e4, confirmationWindowMs: 6e4, grantDurationMs: 6e4 },
    vaultTiming: { waitMs: 3e4, confirmationWindowMs: 6e4 },
    journeyLimits: { lifetimeMs: 3e5, maxHops: 12 }
  };

  // src/storage/indexeddb-repository.ts
  function failureCause(error2, fallback = "OTHER") {
    try {
      switch (error2?.name) {
        case "AbortError":
          return "ABORTED";
        case "UnknownError":
          return "IO_ERROR";
        case "QuotaExceededError":
          return "QUOTA_EXCEEDED";
        case "InvalidStateError":
          return "CONNECTION_CLOSED";
        case "NotSupportedError":
          return "DURABILITY_UNAVAILABLE";
        case "DataError":
        case "DataCloneError":
        case "ConstraintError":
          return "INVALID_DATA";
        default:
          return fallback;
      }
    } catch {
      return "OTHER";
    }
  }
  var stores = ["authority", "receipts"];
  function openRepository(factory, newVersion, name = "atlas-authority-v1", bootstrapInput = configuration) {
    const bootstrap = readConfiguration(bootstrapInput);
    if (bootstrap === null) return Promise.reject(new TypeError("INVALID_CONFIGURATION"));
    return new Promise((resolve, reject5) => {
      const request = factory.open(name, 1);
      let failed = false;
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore("authority").put(false, "initialized");
        database.createObjectStore("receipts");
      };
      request.onerror = request.onblocked = () => {
        failed = true;
        reject5(new Error("STORAGE_UNAVAILABLE"));
      };
      request.onsuccess = () => {
        const database = request.result;
        if (failed) {
          database.close();
          return;
        }
        database.onversionchange = () => database.close();
        resolve(new IndexedDBRepository(database, newVersion, bootstrap));
      };
    });
  }
  var IndexedDBRepository = class {
    constructor(database, newVersion, bootstrap) {
      this.database = database;
      this.newVersion = newVersion;
      this.bootstrap = bootstrap;
    }
    reads = 0;
    writes = 0;
    committed = 0;
    failedCommits = 0;
    failureSequence = 0;
    lastFailure = null;
    curatedReceipt = null;
    close() {
      this.database.close();
    }
    getDiagnostics() {
      return Object.freeze({
        readTransactions: this.reads,
        writeTransactions: this.writes,
        committedWrites: this.committed,
        failedCommits: this.failedCommits,
        lastFailure: this.lastFailure
      });
    }
    failed(operation, stage, cause) {
      if (operation === "COMMIT") this.failedCommits++;
      this.lastFailure = Object.freeze({ sequence: ++this.failureSequence, operation, stage, cause });
    }
    transaction(mode) {
      const transaction = this.database.transaction(stores, mode, mode === "readwrite" ? { durability: "strict" } : void 0);
      if (mode === "readonly") this.reads++;
      else this.writes++;
      if (mode === "readwrite" && transaction.durability !== "strict") {
        transaction.abort();
        throw new DOMException("STRICT_DURABILITY_UNAVAILABLE", "NotSupportedError");
      }
      return transaction;
    }
    load() {
      return this.read("readonly");
    }
    read(mode) {
      return new Promise((resolve) => {
        try {
          const transaction = this.transaction(mode);
          const authority = transaction.objectStore("authority");
          const initialized = authority.get("initialized");
          const envelope = authority.get("envelope");
          let loaded;
          let needsMigration = false;
          let invalidMigration = false;
          envelope.onsuccess = () => {
            loaded = envelope.result;
            if (initialized.result !== true || loaded === null || typeof loaded !== "object" || !("schemaVersion" in loaded) || loaded.schemaVersion !== 1) return;
            if (mode === "readonly") {
              needsMigration = true;
              return;
            }
            try {
              const old = loaded;
              if (Object.keys(old).length !== 4 || !Object.hasOwn(old, "snapshot") || typeof old.storageVersion !== "string" || !/^[a-z0-9_.:-]{1,256}$/i.test(old.storageVersion) || old.lastCommitId !== null && (typeof old.lastCommitId !== "string" || !/^[a-z0-9_.:-]{1,256}$/i.test(old.lastCommitId))) {
                invalidMigration = true;
                transaction.abort();
                return;
              }
              const migrated = migrateAtlasSnapshotV1(old.snapshot, this.bootstrap);
              if (!migrated.ok) {
                invalidMigration = true;
                transaction.abort();
                return;
              }
              const storageVersion = this.version();
              if (storageVersion === old.storageVersion) {
                invalidMigration = true;
                transaction.abort();
                return;
              }
              loaded = { schemaVersion: 2, storageVersion, lastCommitId: old.lastCommitId, snapshot: migrated.snapshot };
              authority.put(loaded, "envelope");
            } catch {
              transaction.abort();
            }
          };
          transaction.oncomplete = () => {
            if (needsMigration) {
              resolve(this.read("readwrite"));
              return;
            }
            if (initialized.result === false && envelope.result === void 0) {
              resolve({ type: "UNINITIALIZED" });
            } else if (initialized.result === true && envelope.result !== void 0) {
              resolve({ type: "READY", envelope: loaded });
            } else {
              this.failed("LOAD", "VALIDATION", "INVALID_DATA");
              resolve({ type: "UNAVAILABLE" });
            }
          };
          transaction.onabort = () => {
            this.failed("LOAD", "TRANSACTION_ABORT", invalidMigration ? "INVALID_DATA" : failureCause(transaction.error, "ABORTED"));
            resolve({ type: "UNAVAILABLE" });
          };
        } catch (error2) {
          this.failed("LOAD", "TRANSACTION_OPEN", failureCause(error2));
          resolve({ type: "UNAVAILABLE" });
        }
      });
    }
    getCuratedUpgrade() {
      return this.curatedReceipt;
    }
    initialize(policy, fromCuratedPreset = false) {
      const validated = validateAtlasSnapshot({
        policy,
        policyRevision: 0,
        configuration: this.bootstrap,
        configurationRevision: 0,
        accessState: createAccessState(),
        vaultState: createVaultState(),
        journeyState: createJourneyState()
      });
      if (!validated.ok) return Promise.resolve(false);
      if (fromCuratedPreset && (validated.snapshot.policy.blacklist.length || JSON.stringify([...validated.snapshot.policy.whitelistSubdomains ?? []].sort()) !== JSON.stringify(initialCuratedScopes) || JSON.stringify([...validated.snapshot.policy.whitelist].sort()) !== JSON.stringify(curatedUpgradeHosts))) return Promise.resolve(false);
      return new Promise((resolve) => {
        try {
          const transaction = this.transaction("readwrite");
          let applied = false;
          const authority = transaction.objectStore("authority");
          const initialized = authority.get("initialized");
          const envelope = authority.get("envelope");
          const curatedMarker = authority.get(curatedUpgradeKey);
          const legacyMarker = authority.get(legacyCuratedUpgradeKey);
          const scopeMarker = authority.get(curatedScopeKey);
          scopeMarker.onsuccess = () => {
            if (initialized.result !== false || envelope.result !== void 0 || curatedMarker.result !== void 0 || legacyMarker.result !== void 0 || scopeMarker.result !== void 0) return;
            try {
              const storageVersion = this.version();
              authority.put({
                schemaVersion: 2,
                storageVersion,
                lastCommitId: null,
                snapshot: validated.snapshot
              }, "envelope");
              authority.put(true, "initialized");
              if (fromCuratedPreset) {
                authority.put(initialCuratedReceipt(), curatedUpgradeKey);
                authority.put(initialCuratedScopeReceipt(), curatedScopeKey);
              }
              applied = true;
            } catch {
              transaction.abort();
            }
          };
          transaction.oncomplete = () => {
            if (applied && fromCuratedPreset) this.curatedReceipt = initialCuratedReceipt();
            resolve(applied);
          };
          transaction.onabort = () => {
            this.failed("INITIALIZE", "TRANSACTION_ABORT", failureCause(transaction.error, "ABORTED"));
            resolve(false);
          };
        } catch (error2) {
          this.failed("INITIALIZE", "TRANSACTION_OPEN", failureCause(error2));
          resolve(false);
        }
      });
    }
    /** Startup only, before a controller owns this connection. Policy and receipt
     * commit together; any older controller is fenced by the new storage version. */
    applyCuratedUpgrade(managed2) {
      this.curatedReceipt = null;
      return this.curatedUpgrade(managed2, "readonly");
    }
    curatedUpgrade(managed2, mode) {
      return new Promise((resolve) => {
        let transaction;
        try {
          transaction = this.transaction(mode);
        } catch (error2) {
          this.failed("CURATED_UPGRADE", "TRANSACTION_OPEN", failureCause(error2));
          resolve({ type: "UNAVAILABLE" });
          return;
        }
        const store = transaction.objectStore("authority");
        const initialized = store.get("initialized"), current = store.get("envelope"), marker = store.get(curatedUpgradeKey);
        const legacyMarker = store.get(legacyCuratedUpgradeKey);
        const scopeMarker = store.get(curatedScopeKey);
        let result = { type: "UNAVAILABLE" };
        let needsWrite = false;
        let caughtFailure = null;
        scopeMarker.onsuccess = () => {
          try {
            if (initialized.result === false && current.result === void 0 && marker.result === void 0 && legacyMarker.result === void 0 && scopeMarker.result === void 0) {
              result = { type: "UNINITIALIZED" };
              return;
            }
            const envelope = current.result;
            if (initialized.result !== true || !envelope || typeof envelope !== "object") return;
            const value = envelope;
            if (Object.keys(value).length !== 4 || value.schemaVersion !== 2 || typeof value.storageVersion !== "string" || !/^[a-z0-9_.:-]{1,256}$/i.test(value.storageVersion) || value.lastCommitId !== null && (typeof value.lastCommitId !== "string" || !/^[a-z0-9_.:-]{1,256}$/i.test(value.lastCommitId)) || !validateAtlasSnapshot(value.snapshot).ok) return;
            let applied = null;
            if (scopeMarker.result !== void 0) {
              const scope = readCuratedScopeReceipt(scopeMarker.result);
              if (!scope || scope.policyRevisionAfter > value.snapshot.policyRevision || marker.result === void 0 && legacyMarker.result === void 0) return;
            }
            for (const [request, id] of [[legacyMarker, legacyCuratedUpgradeId], [marker, curatedUpgradeId]]) {
              if (request.result === void 0) continue;
              const receipt = readCuratedUpgradeReceipt(request.result);
              if (!receipt || receipt.id !== id || receipt.policyRevisionAfter > value.snapshot.policyRevision) return;
              applied = receipt;
            }
            if (applied) {
              result = { type: "ALREADY_APPLIED", receipt: applied };
              return;
            }
            if (mode === "readonly") {
              needsWrite = true;
              return;
            }
            const planned = planCuratedUpgrade(value.snapshot, managed2);
            if (!planned) return;
            const storageVersion = this.version();
            if (storageVersion === value.storageVersion) {
              transaction.abort();
              return;
            }
            store.put({ ...value, storageVersion, snapshot: planned.snapshot }, "envelope");
            store.put(planned.receipt, curatedUpgradeKey);
            result = { type: "APPLIED", receipt: planned.receipt };
          } catch (error2) {
            caughtFailure = failureCause(error2);
            transaction.abort();
          }
        };
        transaction.oncomplete = () => {
          if (needsWrite) {
            resolve(this.curatedUpgrade(managed2, "readwrite"));
            return;
          }
          if ("receipt" in result) this.curatedReceipt = result.receipt;
          else if (result.type === "UNAVAILABLE") this.failed("CURATED_UPGRADE", "VALIDATION", "INVALID_DATA");
          resolve(result);
        };
        transaction.onabort = () => {
          this.failed("CURATED_UPGRADE", "TRANSACTION_ABORT", caughtFailure ?? failureCause(transaction.error, "ABORTED"));
          resolve({ type: "UNAVAILABLE" });
        };
      });
    }
    /** Independent fixed scope migration; never replay a removed scope on later startup. */
    applyCuratedScopes() {
      return this.curatedScopes("readonly");
    }
    curatedScopes(mode) {
      return new Promise((resolve) => {
        let transaction;
        try {
          transaction = this.transaction(mode);
        } catch (error2) {
          this.failed("CURATED_UPGRADE", "TRANSACTION_OPEN", failureCause(error2));
          resolve({ type: "UNAVAILABLE" });
          return;
        }
        const store = transaction.objectStore("authority");
        const initialized = store.get("initialized"), current = store.get("envelope");
        const old = store.get(curatedUpgradeKey), legacy = store.get(legacyCuratedUpgradeKey), marker = store.get(curatedScopeKey);
        let result = { type: "UNAVAILABLE" }, needsWrite = false;
        let caughtFailure = null;
        marker.onsuccess = () => {
          try {
            if (initialized.result === false && current.result === void 0 && marker.result === void 0 && old.result === void 0 && legacy.result === void 0) {
              result = { type: "UNINITIALIZED" };
              return;
            }
            const value = current.result;
            if (initialized.result !== true || !value || typeof value !== "object" || Object.keys(value).length !== 4 || value.schemaVersion !== 2 || typeof value.storageVersion !== "string" || !/^[a-z0-9_.:-]{1,256}$/i.test(value.storageVersion) || value.lastCommitId !== null && (typeof value.lastCommitId !== "string" || !/^[a-z0-9_.:-]{1,256}$/i.test(value.lastCommitId)) || !validateAtlasSnapshot(value.snapshot).ok) return;
            for (const [request, id] of [[old, curatedUpgradeId], [legacy, legacyCuratedUpgradeId]]) {
              if (request.result === void 0) continue;
              const receipt = readCuratedUpgradeReceipt(request.result);
              if (!receipt || receipt.id !== id || receipt.policyRevisionAfter > value.snapshot.policyRevision) return;
            }
            if (marker.result !== void 0) {
              const receipt = readCuratedScopeReceipt(marker.result);
              if (receipt && receipt.policyRevisionAfter <= value.snapshot.policyRevision) result = { type: "ALREADY_APPLIED", receipt };
              return;
            }
            if (mode === "readonly") {
              needsWrite = true;
              return;
            }
            const planned = planCuratedScopes(value.snapshot);
            if (!planned) return;
            const storageVersion = this.version();
            if (storageVersion === value.storageVersion) {
              transaction.abort();
              return;
            }
            store.put({ ...value, storageVersion, snapshot: planned.snapshot }, "envelope");
            store.put(planned.receipt, curatedScopeKey);
            result = { type: "APPLIED", receipt: planned.receipt };
          } catch (error2) {
            caughtFailure = failureCause(error2);
            transaction.abort();
          }
        };
        transaction.oncomplete = () => {
          if (needsWrite) {
            resolve(this.curatedScopes("readwrite"));
            return;
          }
          if (result.type === "UNAVAILABLE") this.failed("CURATED_UPGRADE", "VALIDATION", "INVALID_DATA");
          resolve(result);
        };
        transaction.onabort = () => {
          this.failed("CURATED_UPGRADE", "TRANSACTION_ABORT", caughtFailure ?? failureCause(transaction.error, "ABORTED"));
          resolve({ type: "UNAVAILABLE" });
        };
      });
    }
    version() {
      const version = this.newVersion();
      if (typeof version !== "string" || !/^[a-z0-9_.:-]{1,256}$/i.test(version)) throw new Error("INVALID_VERSION");
      return version;
    }
    commit(request) {
      return new Promise((resolve) => {
        let transaction;
        try {
          transaction = this.transaction("readwrite");
        } catch (error2) {
          this.failed("COMMIT", "TRANSACTION_OPEN", failureCause(error2));
          resolve({ type: "NOT_WRITTEN", commitId: request.commitId });
          return;
        }
        let result = { type: "NOT_WRITTEN", commitId: request.commitId };
        let caughtFailure = null;
        const authority = transaction.objectStore("authority");
        const receipts = transaction.objectStore("receipts");
        const initialized = authority.get("initialized");
        const existing = receipts.get(request.commitId);
        const current = authority.get("envelope");
        current.onsuccess = () => {
          try {
            if (existing.result !== void 0) {
              result = { type: "UNKNOWN", commitId: request.commitId };
              return;
            }
            const envelope = current.result;
            if (initialized.result !== true || envelope === void 0) return;
            if (envelope.storageVersion !== request.expectedStorageVersion) {
              result = { type: "CONFLICT", commitId: request.commitId };
              return;
            }
            const validated = validateAtlasSnapshot(request.next.snapshot);
            if (request.next.schemaVersion !== 2 || !validated.ok) return;
            const storageVersion = this.version();
            if (storageVersion === envelope.storageVersion) {
              caughtFailure = "INVALID_DATA";
              transaction.abort();
              return;
            }
            const receipt = { type: "COMMITTED", commitId: request.commitId, storageVersion };
            authority.put({
              schemaVersion: 2,
              storageVersion,
              lastCommitId: request.commitId,
              snapshot: validated.snapshot
            }, "envelope");
            receipts.add(receipt, request.commitId);
            result = receipt;
          } catch (error2) {
            caughtFailure = failureCause(error2);
            transaction.abort();
          }
        };
        transaction.oncomplete = () => {
          if (result.type === "COMMITTED") this.committed++;
          else if (result.type === "NOT_WRITTEN") this.failed("COMMIT", "VALIDATION", "INVALID_DATA");
          resolve(result);
        };
        transaction.onabort = () => {
          this.failed("COMMIT", "TRANSACTION_ABORT", caughtFailure ?? failureCause(transaction.error, "ABORTED"));
          resolve({ type: "NOT_WRITTEN", commitId: request.commitId });
        };
      });
    }
    resolveCommit(commitId) {
      return new Promise((resolve) => {
        try {
          const transaction = this.transaction("readonly");
          const receipt = transaction.objectStore("receipts").get(commitId);
          const initialized = transaction.objectStore("authority").get("initialized");
          transaction.oncomplete = () => {
            if (initialized.result !== true) {
              resolve({ type: "UNKNOWN", commitId });
              return;
            }
            const stored = receipt.result;
            if (stored === void 0) {
              resolve({ type: "NOT_WRITTEN", commitId });
            } else if (stored !== null && typeof stored === "object" && "type" in stored && stored.type === "COMMITTED" && "commitId" in stored && stored.commitId === commitId && "storageVersion" in stored && typeof stored.storageVersion === "string" && /^[a-z0-9_.:-]{1,256}$/i.test(stored.storageVersion)) {
              resolve({ type: "COMMITTED", commitId, storageVersion: stored.storageVersion });
            } else resolve({ type: "UNKNOWN", commitId });
          };
          transaction.onabort = () => {
            this.failed("RESOLVE", "TRANSACTION_ABORT", failureCause(transaction.error, "ABORTED"));
            resolve({ type: "UNKNOWN", commitId });
          };
        } catch (error2) {
          this.failed("RESOLVE", "TRANSACTION_OPEN", failureCause(error2));
          resolve({ type: "UNKNOWN", commitId });
        }
      });
    }
  };

  // src/background/bootstrap.ts
  async function initializeDevelopmentPolicy(repository) {
    const loaded = await repository.load();
    if (loaded.type === "UNINITIALIZED") await repository.initialize(compileCuratedWhitelist(), true);
  }

  // src/background/startup.ts
  async function createAdapterHost(dependencies) {
    let repository;
    try {
      repository = await dependencies.openRepository();
    } catch {
      throw new StartupError("STORAGE", "STORAGE_UNAVAILABLE");
    }
    try {
      let managed2;
      try {
        managed2 = await dependencies.loadManaged();
      } catch (error2) {
        const code = error2 instanceof Error ? error2.message : "";
        throw new StartupError("MANAGED_BLACKLIST", code === "BUNDLED_BLACKLIST_INVALID" ? code : code === "BUNDLE_UNAVAILABLE" ? code : "MANAGED_BLACKLIST_UNAVAILABLE");
      }
      try {
        await initializeDevelopmentPolicy(repository);
      } catch {
        throw new StartupError("INITIALIZATION", "INITIALIZATION_FAILED");
      }
      try {
        const upgrade = await repository.applyCuratedUpgrade(managed2.getBlacklist());
        if (upgrade.type === "UNAVAILABLE") throw new Error("CURATED_UPGRADE_UNAVAILABLE");
        const scopes = await repository.applyCuratedScopes();
        if (scopes.type === "UNAVAILABLE") throw new Error("CURATED_SCOPE_UPGRADE_UNAVAILABLE");
      } catch {
        throw new StartupError("INITIALIZATION", "INITIALIZATION_FAILED");
      }
      try {
        return { repository, managed: managed2, controller: dependencies.createController(repository, managed2) };
      } catch {
        throw new StartupError("CONTROLLER", "CONTROLLER_UNAVAILABLE");
      }
    } catch (error2) {
      try {
        repository.close();
      } catch {
      }
      throw error2;
    }
  }

  // src/ui/categories.ts
  var categoryKey = (label) => label.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
  var categoryLabel = (label) => label.trim().replace(/\s+/g, " ");
  var predefinedCategories = [...curatedWhitelist.map((group) => group.label), "Your destinations"];
  function categorySuggestions(committed, drafted = []) {
    const labels = /* @__PURE__ */ new Map();
    for (const label of [...predefinedCategories, ...committed, ...drafted]) {
      const normalized = categoryLabel(label);
      if (normalized && normalized.length <= 64 && !labels.has(categoryKey(normalized))) labels.set(categoryKey(normalized), normalized);
    }
    return [...labels.values()];
  }
  function canonicalCategory(label, existing) {
    return existing.find((value) => categoryKey(value) === categoryKey(label)) ?? categoryLabel(label);
  }

  // src/ui/destinations.ts
  function destinationIndex(policy, metadata2 = [], pins = []) {
    const hosts = [...policy.whitelist, ...policy.whitelistSubdomains ?? []];
    const decisions = evaluateMany(hosts, policy);
    const active = new Set(hosts.filter((_, index) => decisions[index].outcome === "ALLOW"));
    return groupDestinationHosts(active, metadata2, policy, pins);
  }
  function groupDestinationHosts(active, metadata2, policy, pins, mergeSubdomains = true) {
    const entries = [];
    const scoped = new Set(mergeSubdomains ? policy.whitelistSubdomains ?? [] : []);
    const initialHosts = new Set(active);
    const pinnedHost = (host3) => pins.includes(`host:${host3}`) || pins.includes(`service:${host3}`);
    const catalogHosts = new Set(curatedServiceCatalog.flatMap((group) => group.services.flatMap((service) => serviceHostnames(service))));
    const possibleParent = (host3) => [...scoped].some((root) => catalogHosts.has(root) && initialHosts.has(root) && !policy.blacklist.includes(root) && host3.endsWith(`.${root}`));
    for (const item of metadata2) {
      const hostnames = item.hostnames.filter((host3) => active.has(host3));
      if (hostnames.length === 0) continue;
      if (item.label === item.primaryHostname && item.category === "Your destinations" && !pins.includes(item.id) && hostnames.every((host3) => !pinnedHost(host3) && !catalogHosts.has(host3) && !scoped.has(host3) && !policy.blacklist.includes(host3) && possibleParent(host3))) continue;
      entries.push({
        id: item.id,
        label: item.label,
        category: item.category,
        hostname: hostnames.includes(item.primaryHostname) ? item.primaryHostname : hostnames[0],
        hostnames
      });
      hostnames.forEach((host3) => active.delete(host3));
    }
    for (const group of curatedServiceCatalog) for (const service of group.services) {
      const hostnames = serviceHostnames(service).filter((hostname2) => active.has(hostname2));
      if (hostnames.length === 0) continue;
      entries.push({ id: `service:${service.hostname}`, label: service.label, hostname: hostnames[0], hostnames, category: group.label });
      hostnames.forEach((hostname2) => active.delete(hostname2));
    }
    const parents = entries.flatMap((entry, index) => entry.hostnames.filter((host3) => catalogHosts.has(host3) && scoped.has(host3) && !policy.blacklist.includes(host3)).map((root) => ({ root, index }))).sort((a, b) => b.root.length - a.root.length);
    for (const host3 of [...active].sort()) {
      if (pinnedHost(host3) || scoped.has(host3) || policy.blacklist.includes(host3)) continue;
      const parent = parents.find(({ root, index }) => host3.endsWith(`.${root}`) && entries[index].hostnames.length < 100);
      if (!parent) continue;
      const entry = entries[parent.index];
      entries[parent.index] = { ...entry, hostnames: [...entry.hostnames, host3] };
      active.delete(host3);
    }
    for (const hostname2 of [...active].sort()) entries.push({ label: hostname2, hostname: hostname2, hostnames: [hostname2], category: "Your destinations" });
    const curatedIds = curatedServiceCatalog.flatMap((group) => group.services.map((service) => `service:${service.hostname}`));
    const order = (entry) => {
      const index = curatedIds.indexOf(entry.id ?? "");
      return index < 0 ? curatedIds.length : index;
    };
    const categories2 = categorySuggestions(metadata2.map((item) => item.category));
    return entries.sort((a, b) => order(a) - order(b)).map((entry) => ({ ...entry, category: canonicalCategory(entry.category, categories2) }));
  }

  // src/ui/destination-usage.ts
  var usagePreferencesKey = "atlas-destination-usage-v1";
  var usageHalfLifeMs = 7 * 24 * 60 * 60 * 1e3;
  function readDestinationUsage(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 2e3) return {};
    const usage = /* @__PURE__ */ Object.create(null);
    for (const [id, record] of Object.entries(value)) {
      if (!validDestinationId(id) || record === null || typeof record !== "object") return {};
      const item = record;
      if (!Number.isSafeInteger(item.count) || item.count < 1 || !Number.isFinite(item.score) || item.score <= 0 || item.score > 1e6 || !Number.isSafeInteger(item.lastOpenedAt) || item.lastOpenedAt < 0) return {};
      usage[id] = { count: item.count, score: item.score, lastOpenedAt: item.lastOpenedAt };
    }
    return usage;
  }
  function usageScore(record, now2) {
    return record === void 0 ? 0 : record.score * 2 ** (-Math.max(0, now2 - record.lastOpenedAt) / usageHalfLifeMs);
  }
  function recordDestinationLaunch(usage, id, now2) {
    if (!validDestinationId(id) || !Number.isSafeInteger(now2) || now2 < 0) return usage;
    const previous = usage[id];
    return { ...usage, [id]: {
      count: Math.min(Number.MAX_SAFE_INTEGER, (previous?.count ?? 0) + 1),
      score: Math.min(1e6, usageScore(previous, now2) + 1),
      lastOpenedAt: now2
    } };
  }

  // src/background/destination-usage.ts
  function saveDestinationLaunch(storage, policy, hostname2, at) {
    try {
      const metadata2 = readDestinationPreferences(JSON.parse(storage.getItem(destinationPreferencesKey) ?? "null"));
      const decision = evaluate({ hostname: hostname2 }, policy);
      if (decision.outcome !== "ALLOW") return;
      const base = decision.reason === "WHITELISTED_SCOPE" ? decision.scopeRoot : hostname2;
      const entries = destinationIndex(policy, metadata2.destinations);
      const destination2 = entries.find((entry) => entry.hostnames.includes(hostname2)) ?? entries.find((entry) => entry.hostnames.includes(base));
      if (destination2 === void 0) return;
      const usage = readDestinationUsage(JSON.parse(storage.getItem(usagePreferencesKey) ?? "null"));
      storage.setItem(usagePreferencesKey, JSON.stringify(recordDestinationLaunch(usage, destinationId(destination2), at)));
    } catch {
    }
  }

  // src/storage/runtime-journal.ts
  var key = "atlas-runtime-diagnostic-v1";
  var errors = /* @__PURE__ */ new Set(["ERROR", "TYPE_ERROR", "RANGE_ERROR", "SYNTAX_ERROR", "INTERNAL_ERROR", "DATA_CLONE_ERROR", "OTHER", "ABORT_ERROR", "INVALID_STATE_ERROR", "QUOTA_EXCEEDED_ERROR"]);
  var subsystems = /* @__PURE__ */ new Set(["CONTROLLER", "ADAPTER_QUEUE", "VIEW", "BACKGROUND_ERROR", "UNHANDLED_REJECTION"]);
  var stages = /* @__PURE__ */ new Set(["START", "LOAD", "VALIDATE_LOAD", "VERIFY_AUTHORITY", "CLOCK", "MANAGED_POLICY", "PLAN", "PLAN_RECOVERY", "COMPARE_PLAN", "VALIDATE_COMMIT", "PREPARE_COMMIT", "COMMIT", "RESOLVE_COMMIT", "PUBLISH"]);
  var operations = /* @__PURE__ */ new Set([
    "OPEN",
    "INVALID_OPERATION",
    "BEGIN_NAVIGATION",
    "CHECK_NAVIGATION",
    "RECORD_JOURNEY_NAVIGATION",
    "START_ACCESS",
    "CONFIRM_ACCESS",
    "CANCEL_ACCESS",
    "END_ACCESS",
    "START_JOURNEY",
    "CANCEL_JOURNEY",
    "CLOSE_JOURNEY_CONTEXT",
    "PROPOSE_POLICY",
    "PROPOSE_SETTINGS",
    "REVIEW_POLICY",
    "CONFIRM_POLICY",
    "CANCEL_POLICY",
    "OBSERVE_TIME",
    "CHECK_DOWNLOAD",
    "REMOVE_WHITELIST"
  ]);
  var integer = (n) => Number.isSafeInteger(n) && n >= 0;
  var time = (n) => n === null || integer(n);
  var object = (n) => n !== null && typeof n === "object" && !Array.isArray(n);
  function readRuntimeSession(value) {
    try {
      if (!object(value) || value.format !== 1 || typeof value.version !== "string" || !/^\d{1,5}(\.\d{1,5}){1,3}$/.test(value.version) || !time(value.startedAt) || !Array.isArray(value.faults) || value.faults.length > 20) return null;
      const faults = [];
      for (const f of value.faults) {
        if (!object(f) || !integer(f.sequence) || !integer(f.count) || f.count < 1 || !time(f.firstAt) || !time(f.lastAt) || typeof f.subsystem !== "string" || !subsystems.has(f.subsystem) || typeof f.error !== "string" || !errors.has(f.error) || !Array.isArray(f.frames) || f.frames.length > 5) return null;
        const frames = [];
        for (const frame of f.frames) {
          if (!object(frame) || frame.asset !== "BACKGROUND" || !integer(frame.line) || frame.line < 1 || frame.line > 9999999 || !integer(frame.column) || frame.column < 1 || frame.column > 9999999) return null;
          frames.push({ asset: "BACKGROUND", line: frame.line, column: frame.column });
        }
        let controller = null;
        if (f.controller !== null) {
          const c = f.controller;
          if (!object(c) || !integer(c.sequence) || typeof c.operation !== "string" || !operations.has(c.operation) || typeof c.stage !== "string" || !stages.has(c.stage)) return null;
          controller = { sequence: c.sequence, operation: c.operation, stage: c.stage };
        }
        faults.push({
          sequence: f.sequence,
          count: f.count,
          firstAt: f.firstAt,
          lastAt: f.lastAt,
          frames,
          controller,
          subsystem: f.subsystem,
          error: f.error
        });
      }
      return { version: value.version, startedAt: value.startedAt, faults };
    } catch {
      return null;
    }
  }
  function runtimeJournal(storage) {
    return {
      async load() {
        const value = storage().getItem(key);
        if (value === null) return null;
        const parsed = readRuntimeSession(JSON.parse(value));
        if (!parsed) throw new Error("DIAGNOSTIC_DATA_INVALID");
        return parsed;
      },
      async save(session) {
        const safe = readRuntimeSession({ format: 1, ...session });
        if (!safe) return false;
        try {
          storage().setItem(key, JSON.stringify({ format: 1, ...safe }));
          return true;
        } catch {
          return false;
        }
      }
    };
  }

  // src/storage/managed-cache.ts
  function openManagedCache(factory, name = "atlas-managed-blacklist-v1") {
    return new Promise((resolve, reject5) => {
      const open = factory.open(name, 1);
      let failed = false;
      open.onupgradeneeded = () => {
        open.result.createObjectStore("cache");
      };
      open.onerror = open.onblocked = () => {
        failed = true;
        reject5(new Error("CACHE_UNAVAILABLE"));
      };
      open.onsuccess = () => {
        const db = open.result;
        if (failed) {
          db.close();
          return;
        }
        db.onversionchange = () => db.close();
        resolve({
          load: () => new Promise((done) => {
            try {
              const tx = db.transaction("cache", "readonly");
              const request = tx.objectStore("cache").get("state");
              tx.oncomplete = () => done(request.result ?? null);
              tx.onabort = () => done(null);
            } catch {
              done(null);
            }
          }),
          save: (state) => new Promise((done) => {
            try {
              const tx = db.transaction("cache", "readwrite", { durability: "strict" });
              if (tx.durability !== "strict") {
                tx.abort();
                done(false);
                return;
              }
              tx.objectStore("cache").put(state, "state");
              tx.oncomplete = () => done(true);
              tx.onabort = () => done(false);
            } catch {
              done(false);
            }
          })
        });
      };
    });
  }

  // src/managed/hosts-feed.ts
  var sourceUrl = "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/fakenews-gambling-porn-social/hosts";
  var categories = ["base", "fakenews", "gambling", "porn", "social"];
  var maxFeedBytes = 2e7;
  var minimumDomains = 5e4;
  var local = (hostname2) => hostname2 === "localhost" || hostname2 === "localhost.localdomain" || hostname2 === "local" || hostname2 === "broadcasthost" || hostname2.startsWith("ip6-") || hostname2.endsWith(".localhost") || hostname2.endsWith(".local");
  function parseHostsFeed(text) {
    const domains = /* @__PURE__ */ new Set();
    const names = /* @__PURE__ */ new Set();
    let malformedLines = 0;
    for (const line of text.split(/\r?\n/)) {
      const record = line.split("#", 1)[0].trim();
      if (record === "") continue;
      const fields4 = record.split(/\s+/);
      const ip = fields4.shift();
      if (ip !== "0.0.0.0" && ip !== "127.0.0.1" && ip !== "::") {
        if (!/^[0-9a-f:.]+(?:%[a-z0-9]+)?$/i.test(ip ?? "")) malformedLines++;
        continue;
      }
      if (fields4.length === 0) {
        malformedLines++;
        continue;
      }
      for (const field of fields4) {
        if (field === "0.0.0.0" || field === "127.0.0.1" || field === "::1" || local(field.toLowerCase())) continue;
        names.add(field.toLowerCase().replace(/\.$/, ""));
        const hostname2 = normalizeTarget({ hostname: field })?.hostname;
        if (hostname2 === void 0 || !hostname2.includes(".")) continue;
        if (!local(hostname2)) domains.add(hostname2);
      }
    }
    const header = text.slice(0, 4e3);
    const count = /^# Number of unique domains:\s*([\d,]+)\s*$/m.exec(header)?.[1];
    const date = /^# Date:\s*(.+)$/m.exec(header)?.[1]?.trim() ?? null;
    const extensionLine = /^# Extensions added to this file:\s*(.+)$/m.exec(header)?.[1];
    const extensions = extensionLine?.split(",").map((part) => part.trim()).sort().join(",");
    return {
      domains: [...domains],
      malformedLines,
      uniqueNames: names.size,
      ignoredNames: names.size - domains.size,
      declaredCount: count === void 0 ? null : Number(count.replaceAll(",", "")),
      upstreamDate: date,
      identityValid: header.startsWith("# Title: StevenBlack/hosts ") && header.includes(`# Project home page: https://github.com/StevenBlack/hosts`) && extensions === "fakenews,gambling,porn,social"
    };
  }
  function validateFeed(text, previousCount = 0) {
    if (text.length === 0 || text.length > maxFeedBytes || text.includes("\0")) return null;
    const parsed = parseHostsFeed(text);
    if (!parsed.identityValid || parsed.upstreamDate === null || parsed.malformedLines !== 0 || parsed.uniqueNames !== parsed.declaredCount || parsed.domains.length < minimumDomains || parsed.ignoredNames > Math.max(20, parsed.uniqueNames * 1e-3) || parsed.domains.length < previousCount * 0.8) return null;
    const compiled = compileManagedBlacklist(parsed.domains);
    return compiled === null ? null : { parsed, compiled };
  }

  // src/managed/manager.ts
  var refreshIntervalMs = 24 * 60 * 60 * 1e3;
  var time2 = (value) => Number.isSafeInteger(value) && value >= 0;
  var validSource = (value) => value === sourceUrl || typeof value === "string" && /^https:\/\/raw\.githubusercontent\.com\/StevenBlack\/hosts\/[a-f0-9]{40}\/alternates\/fakenews-gambling-porn-social\/hosts$/.test(value);
  async function createManagedBlacklist(options) {
    const save = async (state) => {
      try {
        return await options.cache.save(state);
      } catch {
        return false;
      }
    };
    async function readFeed(input) {
      if (input === null || typeof input !== "object") return null;
      const record = input;
      if (typeof record.text !== "string" || !validSource(record.sourceUrl) || !/^[a-f0-9]{64}$/.test(record.sha256) || record.fetchedAt !== null && !time2(record.fetchedAt) || record.upstreamVersion !== null && (typeof record.upstreamVersion !== "string" || record.upstreamVersion.length > 200)) return null;
      const validated = validateFeed(record.text);
      if (validated === null || await options.digest(record.text) !== record.sha256) return null;
      return { record, ...validated };
    }
    let loaded;
    try {
      loaded = await options.cache.load();
    } catch {
      loaded = null;
    }
    const saved = loaded !== null && typeof loaded === "object" ? loaded : null;
    let lastAttemptAt = saved?.schemaVersion === 1 && time2(saved.lastAttemptAt) ? saved.lastAttemptAt : null;
    let active = saved?.schemaVersion === 1 ? await readFeed(saved.feed) : null;
    let origin = "CACHE";
    let status = saved?.lastResult && typeof saved.lastResult === "string" && /^[A-Z_]{1,50}$/.test(saved.lastResult) ? saved.lastResult : "ACTIVE";
    if (status === "UPDATING") status = "INTERRUPTED_UPDATE";
    if (active === null) {
      active = await readFeed(await options.bundle());
      if (active === null) throw new Error("BUNDLED_BLACKLIST_INVALID");
      origin = "BUNDLE";
      status = loaded === null ? "ACTIVE" : "CACHE_INVALID_USING_BUNDLE";
      if (!await save({ schemaVersion: 1, feed: active.record, lastAttemptAt, lastResult: status })) status = "CACHE_UNAVAILABLE_USING_BUNDLE";
    }
    let current = active;
    let inFlight = null;
    const checkpoint = (record = current.record, result = status) => ({
      schemaVersion: 1,
      feed: record,
      lastAttemptAt,
      lastResult: result
    });
    async function update() {
      const now2 = options.now();
      if (!time2(now2)) {
        status = "INVALID_TIME";
        return;
      }
      if (lastAttemptAt !== null && now2 - lastAttemptAt < refreshIntervalMs) return;
      lastAttemptAt = now2;
      status = "UPDATING";
      if (!await save(checkpoint())) {
        status = "CACHE_WRITE_FAILED";
        return;
      }
      try {
        const downloaded = await options.download();
        const next = downloaded.version === null || typeof downloaded.version === "string" && downloaded.version.length <= 200 ? validateFeed(downloaded.text, current.compiled.size) : null;
        if (next === null) {
          status = "INVALID_FEED";
        } else {
          const record = {
            text: downloaded.text,
            sourceUrl,
            sha256: await options.digest(downloaded.text),
            fetchedAt: now2,
            upstreamVersion: downloaded.version
          };
          const publish = async () => {
            if (!await save(checkpoint(record, "UPDATED"))) return false;
            current = { ...next, record };
            origin = "UPDATE";
            status = "UPDATED";
            return true;
          };
          if (!await (options.publish ? options.publish(publish) : publish())) {
            status = "CACHE_WRITE_FAILED";
            return;
          }
          try {
            options.changed?.();
          } catch {
          }
          return;
        }
      } catch {
        status = "NETWORK_UPDATE_FAILED";
      }
      await save(checkpoint());
    }
    return {
      getBlacklist: () => current.compiled,
      getView: (whitelist = []) => ({
        active: true,
        count: current.compiled.size,
        ignoredNames: current.parsed.ignoredNames,
        categories,
        sourceUrl: current.record.sourceUrl,
        origin,
        upstreamDate: current.parsed.upstreamDate,
        upstreamVersion: current.record.upstreamVersion,
        lastUpdatedAt: current.record.fetchedAt,
        lastAttemptAt,
        updateStatus: status,
        conflicts: whitelist.filter((hostname2) => managedBlacklistContains(current.compiled, hostname2) === true)
      }),
      refresh: () => {
        if (inFlight !== null) return inFlight;
        inFlight = update().finally(() => {
          inFlight = null;
        });
        return inFlight;
      }
    };
  }
  async function sha256(text) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  async function downloadStevenBlack() {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 3e4);
    try {
      const response = await fetch(sourceUrl, { credentials: "omit", redirect: "error", cache: "no-store", signal: abort.signal });
      if (!response.ok || response.body === null || Number(response.headers.get("content-length") ?? 0) > maxFeedBytes) throw new Error("DOWNLOAD_FAILED");
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0;
      let text = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.length;
          if (bytes > maxFeedBytes) throw new Error("FEED_TOO_LARGE");
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        await reader.cancel();
      }
      return { text, version: response.headers.get("etag")?.slice(0, 200) ?? null };
    } finally {
      clearTimeout(timeout);
    }
  }

  // src/ui/home-layout.ts
  var legacyOrder = ["University", "Scholar / Research", "Writing", "Development", "Mail", "AI", "Video"].map(categoryKey);

  // src/ui/home-layout-storage.ts
  var homeLayoutDatabase = "atlas-home-layout-v1";
  async function openBookmarkRepository(factory = indexedDB, name = homeLayoutDatabase) {
    return openRecord(factory, name, "bookmarks-v1", readHomeBookmarks);
  }
  async function openRecord(factory, name, key2, validate) {
    const db = await new Promise((resolve, reject5) => {
      const request = factory.open(name, 1);
      let rejected = false;
      request.onupgradeneeded = () => request.result.createObjectStore("layout");
      request.onsuccess = () => {
        if (rejected) request.result.close();
        else resolve(request.result);
      };
      request.onerror = request.onblocked = () => {
        rejected = true;
        reject5(new Error("HOME_LAYOUT_UNAVAILABLE"));
      };
    });
    db.onversionchange = () => db.close();
    const decode = (input) => {
      if (input === void 0) return { revision: 0, value: null };
      const record = input, value = validate(record?.value);
      if (!value || Object.keys(record).sort().join(",") !== "revision,value" || !Number.isSafeInteger(record.revision) || record.revision < 1) throw new Error("HOME_LAYOUT_INVALID");
      return { revision: record.revision, value };
    };
    return {
      load: () => new Promise((resolve, reject5) => {
        try {
          const tx = db.transaction("layout", "readonly"), request = tx.objectStore("layout").get(key2);
          let envelope;
          request.onsuccess = () => {
            try {
              envelope = decode(request.result);
            } catch (error2) {
              reject5(error2);
            }
          };
          tx.oncomplete = () => {
            if (envelope) resolve(envelope);
          };
          tx.onerror = tx.onabort = () => reject5(new Error("HOME_LAYOUT_UNAVAILABLE"));
        } catch {
          reject5(new Error("HOME_LAYOUT_UNAVAILABLE"));
        }
      }),
      save: (revision, value) => new Promise((resolve) => {
        const candidate = validate(value);
        if (!candidate || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
          resolve({ type: "FAILED" });
          return;
        }
        try {
          const tx = db.transaction("layout", "readwrite"), store = tx.objectStore("layout"), request = store.get(key2);
          let result = { type: "FAILED" };
          request.onsuccess = () => {
            let current;
            try {
              current = decode(request.result);
            } catch {
              tx.abort();
              return;
            }
            if (revision !== current.revision) {
              result = { type: "CONFLICT", envelope: current };
              return;
            }
            const envelope = { revision: revision + 1, value: candidate };
            try {
              store.put(envelope, key2);
              result = { type: "SAVED", envelope };
            } catch {
              tx.abort();
            }
          };
          tx.oncomplete = () => resolve(result);
          tx.onabort = () => resolve({ type: "FAILED" });
          tx.onerror = () => {
          };
        } catch {
          resolve({ type: "FAILED" });
        }
      }),
      close: () => db.close()
    };
  }

  // src/ui/category-icons.ts
  var categoryIcons = ["category", "folder", "book", "university", "feather", "code", "mail", "network", "home", "sites", "vault", "search", "pin", "brain", "atom", "calculator", "flask", "globe", "cloud", "tools", "music", "camera", "heart", "calendar", "chart", "leaf", "coffee", "game", "film"];

  // src/bookmarks/toolbar-folders.ts
  function toolbarFolders(root) {
    const folders = [], observed = /* @__PURE__ */ new Set();
    let visited = 0, pages = 0, truncated = false;
    function walk2(node, into, prefix, depth) {
      if (++visited > 1e4 || depth > 16 || pages >= 2e3 || into.length >= 200) {
        truncated = true;
        return;
      }
      observed.add(node.id);
      if (node.type === "separator") return;
      if (node.url) {
        const label = (prefix + (node.title.trim() || normalizeTarget(node.url)?.hostname || "Bookmark")).slice(0, 100);
        const page = { id: `firefox:${node.id.replaceAll("_", ".")}`, label, url: node.url };
        if (validBookmarkPage(page)) {
          into.push(page);
          pages++;
        }
      } else for (const child of node.children ?? []) walk2(child, into, `${prefix}${node.title.trim()} / `, depth + 1);
    }
    for (const node of root.children ?? []) {
      if (node.url || node.type === "separator") continue;
      if (folders.length >= 200) {
        truncated = true;
        break;
      }
      observed.add(node.id);
      const folder = { id: node.id, label: node.title.trim().slice(0, 100) || "Folder", pages: [] };
      for (const child of node.children ?? []) walk2(child, folder.pages, "", 0);
      folders.push(folder);
    }
    return { folders, observed, truncated };
  }
  function readToolbarIcons(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > 200) return null;
    if (!Object.entries(input).every(([id, value]) => /^[a-zA-Z0-9_-]{1,128}$/.test(id) && categoryIcons.includes(value))) return null;
    return structuredClone(input);
  }

  // src/bookmarks/owner.ts
  var pinsKey = "atlas-home-pins-v1";
  var metadataKey = "atlas-destinations-v1";
  function fail(code) {
    throw new Error(code);
  }
  var fields3 = (n) => ({ parentId: n.parentId ?? "", title: n.title, url: n.url ?? null, index: n.index ?? 0 });
  var supported = (n) => !!n.url && /^https?:\/\//i.test(n.url) && n.url.length <= 4096 && normalizeTarget(n.url) !== null && n.title.length <= 100;
  var keys = (v) => Object.keys(v).sort().join(",");
  var nativePageId = (id) => `firefox:${id.replaceAll("_", ".")}`;
  var BookmarkSyncOwner = class {
    constructor(api, storage, factory = indexedDB, id = () => crypto.randomUUID()) {
      this.api = api;
      this.storage = storage;
      this.factory = factory;
      this.id = id;
    }
    chain = Promise.resolve();
    store = null;
    bookmarks = null;
    state = emptySync();
    revision = 0;
    preview = null;
    listening = false;
    disposed = false;
    eventPending = false;
    listeningEvents = [];
    warnings = [];
    folders = [];
    iconStore = null;
    folderIcons = { revision: 0, value: null };
    folderNodes = /* @__PURE__ */ new Set();
    toolbarOrder = [];
    comparison = null;
    run(work) {
      const result = this.chain.then(async () => {
        await this.load();
        return work();
      });
      this.chain = result.catch(() => void 0);
      return result;
    }
    async start() {
      this.api.runtime.onMessage.addListener(this.message);
      this.api.permissions.onAdded.addListener(this.permissionChanged);
      this.api.permissions.onRemoved.addListener(this.permissionChanged);
      await this.run(async () => {
        await this.listeners();
        await this.autoConnect();
        await this.sync();
      }).catch(() => void 0);
    }
    async autoConnect() {
      if (this.api.runtime.getManifest?.().permissions?.includes("bookmarks") && await this.allowed() && !(!this.state.enabled && this.state.root !== null) && !["CONFLICT", "DUPLICATE", "UNSUPPORTED", "STORAGE"].includes(this.state.issue) && !this.state.pending && !this.state.conflictRemote && (!this.state.enabled || this.state.scope !== "toolbar")) {
        await this.connectToolbar().catch((e) => this.issue(e));
      }
    }
    async load() {
      this.store ??= await openRecord(this.factory, homeLayoutDatabase, "firefox-sync-v1", readSync);
      this.bookmarks ??= await openBookmarkRepository(this.factory);
      const e = await this.store.load();
      this.revision = e.revision;
      this.state = e.value ?? emptySync();
      this.iconStore ??= await openRecord(this.factory, homeLayoutDatabase, "toolbar-folder-icons-v1", readToolbarIcons);
      this.folderIcons = await this.iconStore.load();
    }
    async save() {
      const r = await this.store.save(this.revision, this.state);
      if (r.type !== "SAVED") fail(r.type === "CONFLICT" ? "CONFLICT" : "STORAGE");
      this.revision = r.envelope.revision;
    }
    pins() {
      const raw = JSON.parse(this.storage.getItem(pinsKey) ?? "[]");
      const pins = readPins(raw);
      if (!Array.isArray(raw) || !same(raw, pins)) fail("STORAGE");
      return [...pins];
    }
    writePins(pins) {
      if (!same(readPins(pins), pins)) fail("STORAGE");
      this.storage.setItem(pinsKey, JSON.stringify(pins));
      if (!same(this.pins(), pins)) fail("STORAGE");
    }
    metadata() {
      return readDestinationPreferences(JSON.parse(this.storage.getItem(metadataKey) ?? "null")).destinations;
    }
    identify(hostname2) {
      const metadata2 = this.metadata().find((m) => m.hostnames.includes(hostname2));
      if (metadata2) return { id: metadata2.id, label: metadata2.label, hostname: metadata2.primaryHostname };
      for (const category of curatedServiceCatalog) for (const s of category.services) if (serviceHostnames(s).includes(hostname2)) return { id: `service:${s.hostname}`, label: s.label, hostname: s.hostname };
      return { id: `host:${hostname2}`, label: hostname2, hostname: hostname2 };
    }
    descriptor(id) {
      const old = this.state.groups.find((g) => g.id === id), host3 = id.replace(/^(service|host):/, "");
      const known = this.metadata().find((m) => m.id === id);
      const info = known ? { id, label: known.label, hostname: known.primaryHostname } : { ...this.identify(host3), id };
      return { ...info, label: this.state.metadataLabels[id] !== void 0 && this.state.metadataLabels[id] !== info.label ? info.label : this.state.labels[id] ?? old?.label ?? info.label };
    }
    defaults(id) {
      const info = this.descriptor(id), metadata2 = this.metadata().find((m) => m.id === id);
      const service = curatedServiceCatalog.flatMap((c) => c.services).find((s) => `service:${s.hostname}` === id);
      return defaultBookmarkPages({ ...info, hostnames: metadata2?.hostnames ?? (service ? serviceHostnames(service) : [info.hostname]), category: "Bookmarks" });
    }
    async local() {
      const pins = this.pins(), saved = await this.bookmarks.load();
      const ids = [.../* @__PURE__ */ new Set([...pins, ...this.state.groups.map((g) => g.id)])];
      return ids.map((id) => {
        const info = this.descriptor(id), old = this.state.groups.find((g) => g.id === id);
        const override = saved.value?.groups.find((g) => g.parentId === id);
        const pages = override?.pages ?? (old?.pages.length === 0 ? [] : this.defaults(id));
        return { ...info, pinned: pins.includes(id), pages: structuredClone([...pages]) };
      });
    }
    async node(id) {
      try {
        return (await this.api.bookmarks.get(id))[0] ?? null;
      } catch {
        return null;
      }
    }
    async native(root) {
      if (!root) return { groups: [], bindings: [], warnings: [] };
      const tree = (await this.api.bookmarks.getSubTree(root).catch(() => []))[0];
      if (!tree || tree.url) fail("ROOT_MISSING");
      if (this.state.scope === "toolbar") return this.toolbarNative(tree);
      const groups = [], bindings = [], warnings = [];
      const direct = [];
      for (const n of tree.children ?? []) {
        if (n.url) {
          if (supported(n)) direct.push(n);
          else warnings.push("Unsupported bookmark kept in Firefox.");
          continue;
        }
        if (n.type === "separator") {
          warnings.push("Separator kept in Firefox.");
          continue;
        }
        const mapped = this.state.bindings.find((b) => b.folder === n.id), old = this.state.groups.find((g) => g.id === mapped?.id);
        if (n.title.length > 100) {
          if (mapped) fail("UNSUPPORTED");
          warnings.push("Folder name exceeds 100 characters; kept in Firefox only.");
          continue;
        }
        const children = n.children ?? [];
        const pages = children.filter(supported);
        if (children.some((c) => !supported(c))) warnings.push("Nested folders or unsupported bookmarks kept in Firefox.");
        if (!pages.length && !old) {
          warnings.push("Empty folder kept in Firefox.");
          continue;
        }
        const info = old ?? this.identify(normalizeTarget(pages[0].url).hostname);
        if (groups.some((g) => g.id === info.id)) fail("DUPLICATE");
        const pageIds = {};
        const values = pages.map((p) => {
          const pid = Object.keys(mapped?.pages ?? {}).find((k) => mapped.pages[k] === p.id) ?? nativePageId(p.id);
          pageIds[pid] = p.id;
          return { id: pid, label: p.title.trim() || normalizeTarget(p.url).hostname, url: p.url };
        });
        groups.push({ id: info.id, hostname: info.hostname, label: n.title.trim().slice(0, 100) || info.label, pinned: values.length > 0, pages: values });
        bindings.push({ id: info.id, folder: n.id, pages: pageIds });
      }
      for (const n of direct) {
        const info = this.identify(normalizeTarget(n.url).hostname);
        let group = groups.find((g) => g.id === info.id);
        if (!group) {
          const previous = this.state.groups.find((g) => g.id === info.id);
          group = { ...info, pinned: true, pages: structuredClone(previous?.pages ?? []) };
          groups.push(group);
        }
        const oldBinding = this.state.bindings.find((b) => b.id === info.id);
        const pid = Object.keys(oldBinding?.pages ?? {}).find((k) => oldBinding.pages[k] === n.id) ?? nativePageId(n.id);
        group.pages.push({ id: pid, label: n.title.trim() || info.label, url: n.url });
        let binding = bindings.find((b) => b.id === info.id);
        if (!binding) {
          binding = { id: info.id, folder: oldBinding?.folder ?? root, pages: { ...oldBinding?.pages } };
          bindings.push(binding);
        }
        binding.pages[pid] = n.id;
      }
      for (const old of this.state.groups) if (!groups.some((g) => g.id === old.id)) {
        groups.push({ ...structuredClone(old), pinned: false });
        const b = this.state.bindings.find((b2) => b2.id === old.id);
        if (b) bindings.push(structuredClone(b));
      }
      if (!validGroups(groups)) fail("UNSUPPORTED");
      return { groups, bindings, warnings };
    }
    toolbarNative(tree) {
      const groups = [], bindings = [], warnings = [];
      const projected = toolbarFolders(tree);
      this.folders = projected.folders;
      this.folderNodes = projected.observed;
      this.toolbarOrder = [];
      if (projected.truncated) warnings.push("Some folder contents exceed the supported display limit. They remain in Firefox.");
      for (const n of tree.children ?? []) {
        if (!n.url) {
          if (n.type !== "separator") this.toolbarOrder.push(`folder:${n.id}`);
          continue;
        }
        if (!supported(n)) {
          warnings.push("Unsupported toolbar bookmark kept in Firefox.");
          continue;
        }
        const mapped = this.state.bindings.find((b2) => b2.folder === tree.id && Object.values(b2.pages).includes(n.id));
        const old = this.state.groups.find((g2) => g2.id === mapped?.id) ?? this.state.pending?.target.find((g2) => g2.id === mapped?.id);
        const info = old ?? this.identify(normalizeTarget(n.url).hostname);
        if (!this.toolbarOrder.includes(info.id)) this.toolbarOrder.push(info.id);
        let g = groups.find((g2) => g2.id === info.id), b = bindings.find((b2) => b2.id === info.id);
        if (!g) {
          g = { id: info.id, hostname: info.hostname, label: info.label, pinned: true, pages: [] };
          groups.push(g);
          b = { id: info.id, folder: tree.id, pages: {} };
          bindings.push(b);
        }
        const pid = Object.keys(mapped?.pages ?? {}).find((p) => mapped.pages[p] === n.id) ?? nativePageId(n.id);
        g.pages.push({ id: pid, label: n.title.trim() || info.label, url: n.url });
        b.pages[pid] = n.id;
      }
      for (const g of groups) g.label = g.pages.length === 1 ? g.pages[0].label : this.state.pending?.target.find((t) => t.id === g.id)?.label ?? this.state.labels[g.id] ?? g.label;
      for (const old of this.state.groups) if (!groups.some((g) => g.id === old.id)) {
        groups.push({ ...structuredClone(old), pinned: false });
        const b = this.state.bindings.find((b2) => b2.id === old.id && b2.folder === tree.id);
        if (b) bindings.push(structuredClone(b));
      }
      if (!validGroups(groups)) fail("UNSUPPORTED");
      return { groups, bindings, warnings };
    }
    async allowed() {
      return this.api.permissions.contains({ permissions: ["bookmarks"] });
    }
    async listeners() {
      const allow = await this.allowed();
      if (allow === this.listening) return;
      if (allow) {
        if (!this.api.bookmarks) fail("PERMISSION");
        this.listeningEvents = [this.api.bookmarks.onCreated, this.api.bookmarks.onChanged, this.api.bookmarks.onMoved, this.api.bookmarks.onRemoved];
        for (const event of this.listeningEvents) event.addListener(this.changed);
      } else {
        for (const event of this.listeningEvents) event.removeListener(this.changed);
        this.listeningEvents = [];
      }
      this.listening = allow;
    }
    permissionChanged = () => {
      void this.run(async () => {
        await this.listeners();
        await this.autoConnect();
        await this.sync();
      }).catch(() => void 0);
    };
    changed = (id, info) => {
      if (this.disposed || !this.state.enabled) return;
      const m = this.state.mutation, pending = this.state.pending, change = info;
      if (m && pending && m.id === id && !("parentId" in info) && (typeof change.title === "string" && change.title !== m.title || typeof change.url === "string" && change.url !== m.url)) {
        const binding = this.state.bindings.find((b) => b.folder === id || Object.values(b.pages).includes(id));
        if (binding) {
          const remote = structuredClone(this.state.conflictRemote ?? pending.nativeBefore), g = remote.find((g2) => g2.id === binding.id);
          if (g) {
            if (binding.folder === id && change.title !== void 0) g.label = change.title;
            else {
              const page = Object.keys(binding.pages).find((p) => binding.pages[p] === id);
              g.pages = g.pages.map((p) => p.id === page ? { ...p, ...change.title === void 0 ? {} : { label: change.title }, ...change.url === void 0 ? {} : { url: change.url } } : p);
            }
            if (validGroups(remote)) this.state.conflictRemote = remote;
            this.state.issue = "CONFLICT";
          }
        }
      }
      if (this.eventPending) return;
      const i = info;
      const ids = /* @__PURE__ */ new Set([this.state.root, ...this.folderNodes, ...this.state.bindings.flatMap((b) => [b.folder, ...Object.values(b.pages)])]);
      if (!ids.has(id) && !ids.has(i.parentId ?? "") && !ids.has(i.oldParentId ?? "")) return;
      this.eventPending = true;
      void this.run(async () => {
        this.eventPending = false;
        await this.sync();
      }).catch(() => {
        this.eventPending = false;
      });
    };
    async issue(error2) {
      const code = error2 instanceof Error ? error2.message : "STORAGE";
      this.state.issue = ["CONFLICT", "ROOT_MISSING", "PERMISSION", "UNSUPPORTED", "DUPLICATE"].includes(code) ? code : "STORAGE";
      await this.save().catch(() => void 0);
    }
    async mutation(m) {
      this.state.mutation = m;
      await this.save();
      return this.finishMutation();
    }
    async finishMutation() {
      const m = this.state.mutation;
      let result = m.id;
      if (m.kind === "create") {
        const children = await this.api.bookmarks.getChildren(m.parentId);
        const possible = children.filter((n) => !m.children.includes(n.id) && n.title === m.title && (n.url ?? null) === m.url);
        if (possible.length > 1) fail("CONFLICT");
        result = possible[0]?.id ?? (await this.api.bookmarks.create({ parentId: m.parentId, title: m.title, ...m.url ? { url: m.url } : {}, ...m.index !== null ? { index: m.index } : {} })).id;
      } else {
        const n = await this.node(m.id);
        if (m.kind === "remove") {
          if (n) {
            if (!same(fields3(n), m.before)) fail("CONFLICT");
            await this.api.bookmarks.remove(n.id);
          }
        } else {
          if (!n) fail("CONFLICT");
          const done = m.kind === "move" ? n.parentId === m.parentId && (m.index === null || n.index === m.index) : n.title === m.title && (n.url ?? null) === m.url;
          if (!done) {
            if (!same(fields3(n), m.before)) fail("CONFLICT");
            if (m.kind === "move") await this.api.bookmarks.move(n.id, { parentId: m.parentId, ...m.index !== null ? { index: m.index } : {} });
            else await this.api.bookmarks.update(n.id, { title: m.title, ...m.url ? { url: m.url } : {} });
          }
        }
      }
      if (m.result === "root") this.state.root = result;
      else if (m.result === "archive") this.state.archive = result;
      else if (m.result && result) {
        const binding = m.result;
        let b = this.state.bindings.find((b2) => b2.id === binding.group);
        if (!b) {
          b = { id: m.result.group, folder: this.state.root, pages: {} };
          this.state.bindings.push(b);
        }
        if (m.result.page === null) b.folder = result;
        else b.pages[m.result.page] = result;
      }
      this.state.mutation = null;
      await this.save();
      if (this.state.issue === "CONFLICT") fail("CONFLICT");
      return result;
    }
    async create(parentId, title, url, result) {
      return await this.mutation({ kind: "create", id: null, parentId, title, url, index: null, before: null, children: (await this.api.bookmarks.getChildren(parentId)).map((n) => n.id), result });
    }
    async move(n, parentId, index = null) {
      if (n.parentId === parentId && (index === null || n.index === index)) return;
      await this.mutation({ kind: "move", id: n.id, parentId, index, title: null, url: null, before: fields3(n), children: [], result: null });
    }
    async update(n, title, url) {
      if (n.title === title && (n.url ?? null) === url) return;
      await this.mutation({ kind: "update", id: n.id, title, url, parentId: null, index: null, before: fields3(n), children: [], result: null });
    }
    async applyNative(target) {
      if (this.state.mutation) await this.finishMutation();
      if (this.state.scope === "toolbar") {
        await this.applyToolbar(target);
        return;
      }
      if (!this.state.root) await this.create("toolbar_____", "Atlas", null, "root");
      if (!await this.node(this.state.root)) fail("ROOT_MISSING");
      let position = 0;
      for (const g of target) {
        const original = this.state.pending?.nativeBefore.find((item) => item.id === g.id);
        let b = this.state.bindings.find((b2) => b2.id === g.id), folder = b && b.folder !== this.state.root ? await this.node(b.folder) : null;
        if (!g.pinned) {
          if (folder?.parentId === this.state.root) {
            if (!g.pages.length) for (const [pid, nid] of Object.entries(b?.pages ?? {})) {
              const n = await this.node(nid), before = original?.pages.find((p) => p.id === pid);
              if (n) {
                if (n.parentId !== folder.id || !before || n.title !== before.label || n.url !== before.url) fail("CONFLICT");
                await this.mutation({ kind: "remove", id: nid, parentId: null, title: null, url: null, index: null, before: fields3(n), children: [], result: null });
              }
              delete b.pages[pid];
              await this.save();
            }
            if (!this.state.archive || !await this.node(this.state.archive)) await this.create("toolbar_____", "Atlas \u2014 Unpinned", null, "archive");
            await this.move(folder, this.state.archive);
          }
          continue;
        }
        if (!g.pages.length) fail("CONFLICT");
        if (!folder) {
          await this.create(this.state.root, g.label, null, { group: g.id, page: null });
          b = this.state.bindings.find((b2) => b2.id === g.id);
          folder = await this.node(b.folder);
        }
        if (!folder || !b) fail("CONFLICT");
        if (folder.title !== g.label && folder.title !== original?.label) fail("CONFLICT");
        if (original?.pinned && folder.parentId !== this.state.root) fail("CONFLICT");
        await this.move(folder, this.state.root, position++);
        folder = await this.node(folder.id);
        await this.update(folder, g.label, null);
        let index = 0;
        for (const p of g.pages) {
          let n = b.pages[p.id] ? await this.node(b.pages[p.id]) : null;
          if (!n) {
            await this.create(folder.id, p.label, p.url, { group: g.id, page: p.id });
            n = await this.node(b.pages[p.id]);
          }
          if (!n) fail("CONFLICT");
          const before = original?.pages.find((page) => page.id === p.id);
          if (!(n.title === p.label && n.url === p.url) && !(n.title === before?.label && n.url === before?.url)) fail("CONFLICT");
          if (n.parentId !== folder.id && n.parentId !== this.state.root) fail("CONFLICT");
          await this.move(n, folder.id, index++);
          n = await this.node(n.id);
          await this.update(n, p.label, p.url);
        }
        for (const [pid, nid] of Object.entries(b.pages)) if (!g.pages.some((p) => p.id === pid)) {
          const n = await this.node(nid);
          const before = original?.pages.find((page) => page.id === pid);
          if (n && (!before || n.title !== before.label || n.url !== before.url)) fail("CONFLICT");
          if (n && n.parentId === folder.id) await this.mutation({ kind: "remove", id: nid, parentId: null, title: null, url: null, index: null, before: fields3(n), children: [], result: null });
          delete b.pages[pid];
          await this.save();
        }
      }
    }
    async applyToolbar(target) {
      const root = this.state.root;
      if (!await this.node(root)) fail("ROOT_MISSING");
      const wanted = [];
      for (const g of target) {
        let b = this.state.bindings.find((b2) => b2.id === g.id);
        if (!b) {
          b = { id: g.id, folder: root, pages: {} };
          this.state.bindings.push(b);
        }
        const original = this.state.pending?.nativeBefore.find((old) => old.id === g.id);
        const matches = (n, p) => !!p && n.url === p.url && (n.title.trim() === p.label || !n.title.trim() && (p.label === original?.label || p.label === g.label));
        for (const [pid, nid] of Object.entries(b.pages)) if (!g.pinned || !g.pages.some((p) => p.id === pid)) {
          const n = await this.node(nid), before = original?.pages.find((p) => p.id === pid);
          if (n?.parentId === root) {
            if (!matches(n, before)) fail("CONFLICT");
            await this.mutation({ kind: "remove", id: nid, parentId: null, title: null, url: null, index: null, before: fields3(n), children: [], result: null });
          }
          delete b.pages[pid];
          await this.save();
        }
        if (!g.pinned) continue;
        for (const p of g.pages) {
          let n = b.pages[p.id] ? await this.node(b.pages[p.id]) : null;
          if (!n) {
            await this.create(root, p.label, p.url, { group: g.id, page: p.id });
            n = await this.node(b.pages[p.id]);
          }
          if (!n || n.parentId !== root) fail("CONFLICT");
          const before = original?.pages.find((old) => old.id === p.id);
          if (!matches(n, p) && !matches(n, before)) fail("CONFLICT");
          await this.update(n, p.label, p.url);
          wanted.push(n.id);
        }
      }
      const children = await this.api.bookmarks.getChildren(root), ids = new Set(wanted);
      const slots = children.filter((n) => ids.has(n.id)).map((n) => n.index);
      for (const [i, id] of wanted.entries()) {
        const n = await this.node(id);
        if (!n || n.parentId !== root) fail("CONFLICT");
        await this.move(n, root, slots[i]);
      }
    }
    candidateBookmarks(before, target) {
      return { version: 1, groups: [
        ...(before?.groups ?? []).filter((g) => !target.some((t) => t.id === g.parentId)),
        ...target.filter((g) => g.pages.length).map((g) => ({ parentId: g.id, pages: g.pages }))
      ] };
    }
    async complete() {
      const pending = this.state.pending;
      await this.applyNative(pending.target);
      const actual = await this.native(this.state.root);
      const expected = pending.target.filter((g) => g.pinned), observed = actual.groups.filter((g) => g.pinned);
      if (!same(expected, observed)) fail("CONFLICT");
      const current = await this.bookmarks.load(), value = pending.bookmarksCandidate;
      if (!same(current.value, value)) {
        if (current.revision !== pending.bookmarkRevision) fail("CONFLICT");
        const result = await this.bookmarks.save(current.revision, value);
        if (result.type !== "SAVED") fail(result.type === "CONFLICT" ? "CONFLICT" : "STORAGE");
      }
      const pins = pending.target.filter((g) => g.pinned).map((g) => g.id);
      if (!same(this.pins(), pins)) {
        if (!same(this.pins(), pending.pinsBefore)) fail("CONFLICT");
        this.writePins(pins);
      }
      this.state.groups = structuredClone(pending.target);
      for (const g of pending.target) {
        this.state.labels[g.id] = g.label;
        this.state.metadataLabels[g.id] = this.metadata().find((m) => m.id === g.id)?.label ?? this.identify(g.hostname).label;
      }
      this.state.pending = null;
      this.state.issue = "NONE";
      await this.save();
    }
    async synchronize(target, bindings, bookmarksInput) {
      if (this.state.scope === "toolbar") target = target.map((g) => g.pages.length === 1 ? { ...g, label: g.pages[0].label } : g);
      if (!validGroups(target)) fail("UNSUPPORTED");
      const saved = await this.bookmarks.load();
      this.state.bindings = bindings;
      this.state.pending = { target, nativeBefore: (await this.native(this.state.root)).groups, pinsBefore: this.pins(), bookmarkRevision: saved.revision, bookmarksCandidate: this.candidateBookmarks(bookmarksInput ?? saved.value, target) };
      await this.save();
      await this.complete();
    }
    async sync(emptied = []) {
      if (!this.state.enabled) return;
      try {
        if (!await this.allowed()) fail("PERMISSION");
        if (this.state.pending) {
          if (this.state.issue === "CONFLICT") return;
          await this.complete();
          return;
        }
        if (["ROOT_MISSING", "CONFLICT", "DUPLICATE"].includes(this.state.issue)) return;
        const local2 = (await this.local()).map((g) => emptied.includes(g.id) ? { ...g, pages: [], pinned: false } : g), remote = await this.native(this.state.root);
        this.warnings = remote.warnings;
        const merged = mergeGroups(this.state.groups, local2, remote.groups);
        if (!merged) fail("CONFLICT");
        if (same(merged, this.state.groups) && same(remote.bindings, this.state.bindings)) {
          if (this.state.issue !== "NONE") {
            this.state.issue = "NONE";
            await this.save();
          }
          return;
        }
        await this.synchronize(merged, remote.bindings);
      } catch (e) {
        await this.issue(e);
      }
    }
    async response() {
      return { pins: this.pins(), bookmarks: await this.bookmarks.load(), sync: {
        revision: this.revision,
        enabled: this.state.enabled,
        scope: this.state.scope ?? "folder",
        issue: this.state.issue,
        warnings: this.warnings,
        groups: this.state.groups.map(({ id, hostname: hostname2, label, pinned }) => ({ id, hostname: hostname2, label, pinned })),
        labels: this.state.labels,
        pending: !!this.state.pending,
        folders: this.state.enabled && this.state.scope === "toolbar" ? this.folders : [],
        folderIcons: this.folderIcons.value ?? {},
        toolbarOrder: this.toolbarOrder
      } };
    }
    async previewMerge(root) {
      if (!await this.allowed()) fail("PERMISSION");
      const local2 = await this.local(), remote = await this.native(root), target = structuredClone(local2), warnings = [...remote.warnings];
      for (const g of remote.groups) {
        const match = target.find((t) => t.id === g.id);
        if (!match) {
          target.push(g);
          continue;
        }
        match.pinned ||= g.pinned;
        for (const p of g.pages) if (!match.pages.some((x) => x.url === p.url && x.label === p.label)) {
          match.pages.push(match.pages.some((x) => x.id === p.id) ? { ...p, id: `merge:${this.id()}` } : p);
        } else warnings.push("Identical page already present; one copy will be linked.");
      }
      if (!validGroups(target)) fail("UNSUPPORTED");
      this.preview = { token: this.id(), root, local: local2, remote: remote.groups, target, bindings: remote.bindings, warnings };
      return { preview: this.preview };
    }
    async connectToolbar() {
      if (!await this.allowed()) fail("PERMISSION");
      if (this.state.pending || this.state.conflictRemote) return { error: "SYNC_PENDING" };
      if (this.state.enabled && this.state.scope === "toolbar") {
        await this.sync();
        return this.response();
      }
      const local2 = await this.local();
      this.state.scope = "toolbar";
      this.state.root = "toolbar_____";
      this.state.archive = null;
      this.state.bindings = [];
      this.state.groups = [];
      const remote = await this.native(this.state.root), target = structuredClone(remote.groups);
      for (const g of local2) if (g.pinned) {
        const match = target.find((t) => t.id === g.id);
        if (!match) target.push(g);
        else for (const p of g.pages) if (!match.pages.some((x) => x.url === p.url)) match.pages.push(p);
      }
      for (const g of target) if (g.pages.length === 1) g.label = g.pages[0].label;
      this.state.enabled = true;
      this.state.issue = "NONE";
      this.warnings = remote.warnings;
      await this.listeners();
      await this.synchronize(target, remote.bindings);
      return this.response();
    }
    async dispatch(v) {
      if (v.kind === "PRESENTATION_READ" && keys(v) === "kind") return this.response();
      if (v.kind === "SYNC_TOOLBAR" && keys(v) === "kind") {
        return this.connectToolbar();
      }
      if (v.kind === "FOLDER_ICON" && keys(v) === "before,icon,id,kind" && typeof v.id === "string" && typeof v.icon === "string" && (v.icon === "" || categoryIcons.includes(v.icon))) {
        if (!this.folders.some((f) => f.id === v.id)) return { error: "FOLDER_MISSING" };
        if ((this.folderIcons.value?.[v.id] ?? "") === v.icon) return this.response();
        if ((this.folderIcons.value?.[v.id] ?? "") !== v.before) return { error: "CONFLICT" };
        const icons = { ...this.folderIcons.value };
        if (v.icon) icons[v.id] = v.icon;
        else delete icons[v.id];
        if (Object.keys(icons).length > 200) return { error: "LIMIT" };
        const saved = await this.iconStore.save(this.folderIcons.revision, icons);
        if (saved.type !== "SAVED") return { error: saved.type };
        this.folderIcons = saved.envelope;
        return this.response();
      }
      if (v.kind === "BOOKMARK_SAVE" && keys(v) === "kind,revision,value") {
        if (this.state.pending) return { type: "FAILED" };
        const value = readHomeBookmarks(v.value);
        if (!value || !Number.isSafeInteger(v.revision)) return { type: "FAILED" };
        const before = await this.bookmarks.load();
        const emptied = (before.value?.groups ?? []).filter((g) => !value.groups.some((n) => n.parentId === g.parentId)).map((g) => g.parentId);
        if (before.revision !== v.revision) return { type: "CONFLICT", envelope: before };
        if (this.state.enabled && await this.allowed()) {
          if (this.state.issue !== "NONE") return { type: "FAILED" };
          const local2 = await this.local(), remote = await this.native(this.state.root);
          for (const g of local2) {
            const pages = value.groups.find((p) => p.parentId === g.id)?.pages;
            if (emptied.includes(g.id)) {
              g.pages = [];
              g.pinned = false;
            } else if (pages) g.pages = structuredClone([...pages]);
          }
          const merged = mergeGroups(this.state.groups, local2, remote.groups);
          if (!merged) fail("CONFLICT");
          await this.synchronize(merged, remote.bindings, value);
          const synced = await this.bookmarks.load();
          return { type: "SAVED", envelope: synced };
        }
        return this.bookmarks.save(v.revision, value);
      }
      if (v.kind === "PIN_SET" && keys(v) === "hosts,id,kind,pinned" && validDestinationId(v.id) && typeof v.pinned === "boolean" && Array.isArray(v.hosts) && v.hosts.length <= 100 && v.hosts.every((h) => normalizeTarget({ hostname: h })?.hostname === h)) {
        if (this.state.pending) return { type: "FAILED" };
        const pins = updateDestinationPin(this.pins(), v.id, v.pinned, v.hosts);
        if (pins.length > 200) return { type: "FAILED" };
        this.writePins([...pins]);
        await this.sync();
        return { type: "SAVED", ...await this.response() };
      }
      if (v.kind === "SYNC_SETUP" && keys(v) === "kind") {
        if (!await this.allowed()) return { permission: false };
        const roots = await this.api.bookmarks.getTree(), folders = [];
        const walk2 = (n, path) => {
          if (n.url || n.type === "separator" || folders.length >= 1e3) return;
          const label = path ? `${path} / ${n.title}` : n.title;
          if (n.parentId) folders.push({ id: n.id, label });
          for (const c of n.children ?? []) walk2(c, label);
        };
        roots.forEach((n) => walk2(n, ""));
        return { permission: true, folders, ...await this.response() };
      }
      if (v.kind === "SYNC_PREVIEW" && keys(v) === "kind,root" && (v.root === null || typeof v.root === "string")) return this.previewMerge(v.root);
      if (v.kind === "SYNC_CONNECT" && keys(v) === "kind,token" && this.preview?.token === v.token) {
        if (this.state.conflictRemote || this.state.pending && this.state.issue === "CONFLICT") return { error: "COMPARE_REQUIRED" };
        const p = this.preview;
        if (!same(p.local, await this.local()) || !same(p.remote, (await this.native(p.root)).groups)) return { error: "PREVIEW_CHANGED" };
        this.state.enabled = true;
        this.state.root = p.root;
        this.state.issue = "NONE";
        await this.listeners();
        await this.synchronize(p.target, p.bindings);
        this.preview = null;
        return this.response();
      }
      if (v.kind === "SYNC_DISABLE" && keys(v) === "kind") {
        this.state.enabled = false;
        this.state.pending = null;
        this.state.mutation = null;
        this.state.conflictRemote = null;
        this.state.issue = "NONE";
        await this.save();
        return this.response();
      }
      if (v.kind === "PIN_ORDER" && keys(v) === "before,kind,pins" && Array.isArray(v.pins) && same(readPins(v.pins), v.pins)) {
        if (this.state.pending) return { error: "SYNC_PENDING" };
        const current = this.pins();
        if (!same(current, v.before) || !same([...current].sort(), [...v.pins].sort())) return { error: "CONFLICT" };
        this.writePins(v.pins);
        await this.sync();
        return this.response();
      }
      if (v.kind === "PIN_LABEL" && keys(v) === "before,id,kind,label" && validDestinationId(v.id) && typeof v.label === "string" && v.label.trim() && v.label.length <= 100) {
        if (this.state.pending) return { error: "SYNC_PENDING" };
        if ((this.state.labels[v.id] ?? null) !== v.before) return { error: "CONFLICT" };
        this.state.labels[v.id] = v.label.trim();
        await this.save();
        if (this.state.enabled && this.state.scope === "toolbar" && await this.allowed()) {
          const local2 = await this.local(), g = local2.find((g2) => g2.id === v.id), remote = await this.native(this.state.root);
          if (g && g.pages.length === 1) {
            g.pages = [{ ...g.pages[0], label: v.label.trim() }];
            g.label = v.label.trim();
          }
          const merged = mergeGroups(this.state.groups, local2, remote.groups);
          if (!merged) fail("CONFLICT");
          await this.synchronize(merged, remote.bindings);
        } else await this.sync();
        return this.response();
      }
      if (v.kind === "SYNC_RETRY" && keys(v) === "kind") {
        if (this.state.issue === "CONFLICT") return { error: "COMPARE_REQUIRED" };
        this.state.issue = "NONE";
        await this.save();
        await this.sync();
        return this.response();
      }
      if (v.kind === "SYNC_COMPARE" && keys(v) === "kind") {
        const observed = (await this.native(this.state.root)).groups;
        this.comparison = { token: this.id(), local: this.state.pending?.target ?? await this.local(), remote: this.state.conflictRemote ?? observed, observed };
        return { comparison: this.comparison };
      }
      if (v.kind === "SYNC_RESOLVE" && keys(v) === "kind,side,token" && typeof v.token === "string" && ["ATLAS", "FIREFOX"].includes(v.side) && v.token === this.comparison?.token) {
        if (!await this.allowed()) fail("PERMISSION");
        const remote = await this.native(this.state.root), local2 = this.state.pending?.target ?? await this.local();
        if (!same(local2, this.comparison.local) || !same(remote.groups, this.comparison.observed)) return { error: "COMPARISON_CHANGED" };
        const target = v.side === "ATLAS" ? local2 : this.comparison.remote;
        this.state.issue = "NONE";
        this.state.conflictRemote = null;
        if (this.state.mutation) await this.finishMutation();
        await this.synchronize(target, remote.bindings);
        this.comparison = null;
        return this.response();
      }
      return { error: "INVALID_COMMAND" };
    }
    message = (input, sender) => {
      if (sender.id !== this.api.runtime.id || sender.url?.split(/[?#]/, 1)[0] !== this.api.runtime.getURL("ui/index.html") || (sender.frameId ?? 0) !== 0 || !input || typeof input !== "object" || Array.isArray(input) || !presentationCommands.includes(input.kind)) return false;
      return this.run(async () => {
        try {
          return await this.dispatch(input);
        } catch (e) {
          await this.issue(e);
          return { error: "PRESENTATION_UNAVAILABLE" };
        }
      }).catch(() => ({ error: "PRESENTATION_UNAVAILABLE" }));
    };
    dispose() {
      this.disposed = true;
      this.api.runtime.onMessage.removeListener(this.message);
      this.api.permissions.onAdded.removeListener(this.permissionChanged);
      this.api.permissions.onRemoved.removeListener(this.permissionChanged);
      for (const event of this.listeningEvents) event.removeListener(this.changed);
      this.store?.close();
      this.bookmarks?.close();
      this.iconStore?.close();
    }
  };

  // src/background/main.ts
  var presentation = new BookmarkSyncOwner(browser, localStorage);
  void presentation.start();
  addEventListener("pagehide", () => presentation.dispose());
  addEventListener("storage", (event) => {
    if (event.key === "atlas-destinations-v1") void presentation.run(() => presentation.sync()).catch(() => void 0);
  });
  var now = () => Date.now();
  var runtimeDiagnostics = new RuntimeDiagnostics(
    browser.runtime.getURL("background.js"),
    now,
    runtimeJournal(() => localStorage),
    browser.runtime.getManifest().version
  );
  addEventListener("error", (event) => runtimeDiagnostics.record("BACKGROUND_ERROR", event.error));
  addEventListener("unhandledrejection", (event) => runtimeDiagnostics.record("UNHANDLED_REJECTION", event.reason));
  var managed = null;
  var cachePromise = null;
  var host2 = async () => {
    const value = await createAdapterHost({
      openRepository: () => openRepository(indexedDB, () => crypto.randomUUID()),
      loadManaged: async () => {
        cachePromise ??= openManagedCache(indexedDB).catch(() => ({ load: async () => null, save: async () => false }));
        const cache = await cachePromise;
        return createManagedBlacklist({
          cache,
          now,
          digest: sha256,
          download: downloadStevenBlack,
          bundle: async () => {
            const base = browser.runtime.getURL("data/stevenblack/");
            const [data, metadata2] = await Promise.all([
              fetch(`${base}hosts`, { cache: "no-store" }),
              fetch(`${base}metadata.json`, { cache: "no-store" })
            ]);
            if (!data.ok || !metadata2.ok) throw new Error("BUNDLE_UNAVAILABLE");
            const record = await metadata2.json();
            return {
              text: await data.text(),
              sourceUrl: record.sourceUrl,
              sha256: record.sha256,
              fetchedAt: null,
              upstreamVersion: record.revision
            };
          },
          publish: (work) => adapter.publishManagedUpdate(work),
          changed: () => {
            void adapter.refresh();
          }
        });
      },
      createController: (repository, blacklist) => createAtlasController({
        repository,
        clock: { now },
        configuration,
        ownerId: crypto.randomUUID(),
        managedBlacklist: blacklist.getBlacklist,
        onInternalFault: (error2, fault) => runtimeDiagnostics.record("CONTROLLER", error2, fault)
      })
    });
    managed = value.managed;
    return value;
  };
  var adapter = new FirefoxAdapter(
    browser,
    host2,
    () => crypto.randomUUID(),
    now,
    void 0,
    void 0,
    createCanonicalEntryDiscovery(browser),
    (hostname2, at) => {
      const policy = adapter.view().controller?.snapshot?.policy;
      if (policy) saveDestinationLaunch(localStorage, policy, hostname2, at);
    },
    runtimeDiagnostics
  );
  void adapter.ready.then(async () => {
    await adapter.refresh();
    void managed?.refresh().catch(() => void 0);
  }).catch(() => void 0);
  setInterval(() => {
    void adapter.refresh();
  }, 1e3);
  setInterval(() => {
    void managed?.refresh().catch(() => void 0);
  }, 60 * 60 * 1e3);
})();
//# sourceMappingURL=background.js.map
