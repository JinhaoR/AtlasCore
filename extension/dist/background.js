"use strict";
(() => {
  // ../packages/core/dist/target.js
  function normalizeHostname(input) {
    if (typeof input !== "string")
      return null;
    const value = input.trim();
    if (!/^[a-z0-9.-]+$/i.test(value))
      return null;
    const hostname = value.toLowerCase().replace(/\.$/, "");
    if (hostname.length === 0 || hostname.length > 253)
      return null;
    const labels = hostname.split(".");
    if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
      return null;
    }
    if (/^[0-9.]+$/.test(hostname))
      return null;
    try {
      if (new URL(`https://${hostname}`).hostname !== hostname)
        return null;
    } catch {
      return null;
    }
    return hostname;
  }
  function normalizeTarget(input) {
    let hostname;
    if (typeof input === "string") {
      const value = input.trim();
      if (/^https?:\/\//i.test(value)) {
        const authority = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1];
        if (authority === void 0 || !/^[a-z0-9.-]+(?::[0-9]+)?$/i.test(authority) || /[\u0000-\u0020\u007f\\]/.test(value)) {
          return null;
        }
        try {
          hostname = normalizeHostname(new URL(value).hostname);
        } catch {
          return null;
        }
      } else {
        hostname = normalizeHostname(value);
      }
    } else if (input !== null && typeof input === "object" && !Array.isArray(input) && Object.keys(input).length === 1 && Object.hasOwn(input, "hostname") && "hostname" in input) {
      hostname = normalizeHostname(input.hostname);
    } else {
      return null;
    }
    return hostname === null ? null : { hostname };
  }

  // ../packages/core/dist/managed-blacklist.js
  var contents = /* @__PURE__ */ new WeakMap();
  function compileManagedBlacklist(input) {
    if (!Array.isArray(input))
      return null;
    const domains = /* @__PURE__ */ new Set();
    for (const entry of input) {
      const hostname = normalizeHostname(entry);
      if (hostname === null)
        return null;
      domains.add(hostname);
    }
    const compiled = Object.freeze({ size: domains.size });
    contents.set(compiled, domains);
    return compiled;
  }
  function isManagedBlacklist(input) {
    return input !== null && typeof input === "object" && contents.has(input);
  }
  function managedBlacklistContains(input, hostname) {
    return isManagedBlacklist(input) ? contents.get(input).has(hostname) : null;
  }

  // ../packages/core/dist/policy.js
  function normalizeEntries(input) {
    if (!Array.isArray(input))
      return null;
    const entries = [];
    for (const entry of input) {
      const hostname = normalizeHostname(entry);
      if (hostname === null)
        return null;
      entries.push(hostname);
    }
    return entries;
  }
  function normalizePolicy(input) {
    if (input === null || typeof input !== "object" || Array.isArray(input))
      return null;
    if (Object.keys(input).some((key) => key !== "whitelist" && key !== "blacklist") || !Object.hasOwn(input, "whitelist") || !Object.hasOwn(input, "blacklist") || !("whitelist" in input) || !("blacklist" in input)) {
      return null;
    }
    const whitelist = normalizeEntries(input.whitelist);
    const blacklist = normalizeEntries(input.blacklist);
    if (whitelist === null || blacklist === null)
      return null;
    return { whitelist, blacklist };
  }

  // ../packages/core/dist/evaluate.js
  function evaluate(requestedSite, currentPolicy) {
    const policy = normalizePolicy(currentPolicy);
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
    return { outcome: "GREYLIST", reason: "UNLISTED", target };
  }

  // ../packages/core/dist/access-state.js
  function hasFields(value, fields) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
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
  function readAccessScope(value, hostname) {
    if (!Array.isArray(value) || value.length === 0 || ![...value].every(normalizedHostname) || !value.includes(hostname) || new Set(value).size !== value.length)
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
      if (request === null || request.id >= value.nextRequestId || request.startedAt > value.lastObservedAt || request.policyRevision > value.policyRevision || ids.has(request.id) || accessScope(request).some((host2) => hosts.has(host2)))
        return null;
      ids.add(request.id);
      accessScope(request).forEach((host2) => hosts.add(host2));
      pendingRequests.push(request);
    }
    for (const entry of value.grants) {
      const grant = readGrant(entry);
      if (grant === null || grant.requestId >= value.nextRequestId || grant.issuedAt > value.lastObservedAt || grant.policyRevision > value.policyRevision || ids.has(grant.requestId) || accessScope(grant).some((host2) => hosts.has(host2)))
        return null;
      ids.add(grant.requestId);
      accessScope(grant).forEach((host2) => hosts.add(host2));
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
    const hostname = decision.target.hostname;
    const scope = scopeInput === void 0 ? [hostname] : readAccessScope(scopeInput, hostname);
    if (scope === null)
      return reject("INVALID_SCOPE", state);
    if (scope.some((host2) => evaluate(host2, policy).outcome !== "GREYLIST"))
      return reject("NOT_GREYLIST", state);
    const existing = state.pendingRequests.find((entry) => accessScope(entry).includes(hostname));
    if (existing !== void 0 && existing.policyRevision === policyRevision && now2 < existing.confirmBy) {
      return { ok: true, type: "EXISTING_REQUEST", request: existing, nextState: state };
    }
    const grant = state.grants.find((entry) => accessScope(entry).includes(hostname));
    if (grant !== void 0 && grant.policyRevision === policyRevision && now2 < grant.expiresAt) {
      return reject("GRANT_ACTIVE", state);
    }
    const overlaps = (entry) => accessScope(entry).some((host2) => scope.includes(host2));
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
      hostname,
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
    if (accessScope(request).some((host2) => evaluate(host2, policy).outcome !== "GREYLIST")) {
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

  // ../packages/core/dist/journey-state.js
  function hasJourneyFields(value, fields) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
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
    if (!hasJourneyFields(value, ["kind", "sourceHostname"]) || !canonicalHostname(value.sourceHostname) || !["HTTP_REDIRECT", "SAME_HOST", "RETAINED", "ARRIVAL", "ROOT_DEPARTURE"].includes(value.kind))
      return null;
    return { kind: value.kind, sourceHostname: value.sourceHostname };
  }
  function continuesJourney(journey, target, evidence) {
    if (journey.phase === "ENDED" || evidence === void 0 || evidence.sourceHostname !== journey.currentHostname)
      return false;
    if (evidence.kind === "ROOT_DEPARTURE") {
      return journey.phase === "STARTED" && journey.currentHostname === journey.rootHostname && target !== journey.rootHostname;
    }
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
  function hasFields2(value, fields) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
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
      blacklist: [...new Set(policy.blacklist)].sort()
    };
  }
  function sameEntries(left, right) {
    return left.length === right.length && left.every((host2, index) => host2 === right[index]);
  }
  function samePolicy(left, right) {
    return sameEntries(left.whitelist, right.whitelist) && sameEntries(left.blacklist, right.blacklist);
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
    if (candidatePolicy === null || !hasFields2(value.candidatePolicy, ["whitelist", "blacklist"]) || !Array.isArray(value.candidatePolicy.whitelist) || !Array.isArray(value.candidatePolicy.blacklist) || !sameEntries(value.candidatePolicy.whitelist, candidatePolicy.whitelist) || !sameEntries(value.candidatePolicy.blacklist, candidatePolicy.blacklist))
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
      added: after.filter((host2) => !beforeSet.has(host2)),
      removed: before.filter((host2) => !afterSet.has(host2))
    };
  }
  function classification(hostname, policy) {
    const decision = evaluate(hostname, policy);
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
      ...candidate.blacklist
    ])].sort();
    const classifications = [];
    for (const hostname of hosts) {
      const before = classification(hostname, policy);
      const after = classification(hostname, candidate);
      if (before !== after)
        classifications.push({ hostname, before, after });
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
    const fields = ["journeyId", "contextId", "target"];
    if (navigation !== null && typeof navigation === "object" && Object.hasOwn(navigation, "continuation"))
      fields.push("continuation");
    if (!hasJourneyFields(navigation, fields)) {
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
      case "BEGIN_NAVIGATION":
      case "CHECK_NAVIGATION":
      case "RECORD_JOURNEY_NAVIGATION": {
        const fields = ["contextId", "journeyId"];
        if (input.context !== null && typeof input.context === "object" && Object.hasOwn(input.context, "continuation"))
          fields.push("continuation");
        if (!hasJourneyFields(input, ["kind", "target", "context"]) || !hasJourneyFields(input.context, fields))
          return invalid();
        const target = readTarget(input.target);
        if (target === null)
          return invalid("INVALID_TARGET");
        const { contextId, journeyId } = input.context;
        if (!validContextId(contextId))
          return invalid("INVALID_CONTEXT_ID");
        if (journeyId !== null && !positiveInteger(journeyId))
          return invalid("INVALID_JOURNEY_ID");
        const continuation = Object.hasOwn(input.context, "continuation") ? readJourneyContinuation(input.context.continuation) : void 0;
        if (continuation === null)
          return invalid("INVALID_NAVIGATION");
        return valid({ kind, target, context: { contextId, journeyId, ...continuation === void 0 ? {} : { continuation } } });
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
        if (!hasJourneyFields(input, ["kind", "requestId"]))
          return invalid();
        return positiveInteger(input.requestId) ? valid({ kind, requestId: input.requestId }) : invalid("INVALID_REQUEST_ID");
      case "PROPOSE_POLICY": {
        if (!hasJourneyFields(input, ["kind", "candidatePolicy"]))
          return invalid();
        const candidatePolicy = normalizePolicy(input.candidatePolicy);
        return candidatePolicy === null ? invalid("INVALID_CANDIDATE_POLICY") : valid({ kind, candidatePolicy });
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
  function navigationPlan(operation, snapshot, now2, managed) {
    const bindingError = checkBinding(operation.context, snapshot);
    if (bindingError !== null)
      return reject4(bindingError, snapshot);
    const access = evaluateAccess(operation.target, accessContext(snapshot, now2));
    if (access.nextState === null)
      return reject4("INVALID_ACCESS_STATE");
    let observation = { ...snapshot, accessState: access.nextState };
    const decision = access.decision;
    const managedDecision = managedDenies(snapshot, operation.target.hostname, managed) ? { outcome: "DENY", reason: "MANAGED_BLACKLISTED", target: operation.target } : null;
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
  function beginNavigation(operation, snapshot, now2, managed, configuration2) {
    const bindingError = checkBinding(operation.context, snapshot);
    if (bindingError !== null)
      return reject4(bindingError, snapshot);
    const current = snapshot.journeyState.journeys.find((j) => j.id === operation.context.journeyId);
    const access = evaluateAccess(operation.target, accessContext(snapshot, now2));
    const departure = operation.context.continuation?.kind === "ROOT_DEPARTURE" ? operation.context.continuation : void 0;
    if (departure !== void 0) {
      if (access.decision.outcome === "DENY" || managedDenies(snapshot, operation.target.hostname, managed)) {
        return navigationPlan(operation, snapshot, now2, managed);
      }
      if (evaluateAccess({ hostname: departure.sourceHostname }, accessContext(snapshot, now2)).decision.reason !== "WHITELISTED") {
        return reject4("NOT_WHITELISTED", snapshot);
      }
      if (departure.sourceHostname === operation.target.hostname)
        return reject4("INVALID_NAVIGATION", snapshot);
      if (access.decision.outcome === "ALLOW" && access.decision.reason === "WHITELISTED") {
        return beginNavigation({ ...operation, context: {
          contextId: operation.context.contextId,
          journeyId: operation.context.journeyId
        } }, snapshot, now2, managed, configuration2);
      }
      if (current !== void 0 && current.phase !== "ENDED") {
        return navigationPlan(operation, snapshot, now2, managed);
      }
      const started2 = startJourney({ hostname: departure.sourceHostname }, operation.context.contextId, journeyContext(snapshot, now2), configuration2.journeyLimits);
      if (!started2.ok || started2.type !== "STARTED")
        return reject4(started2.ok ? "INVALID_JOURNEY_STATE" : started2.reason, snapshot);
      const candidate2 = { ...snapshot, journeyState: started2.nextState };
      const plan2 = navigationPlan({ ...operation, context: { ...operation.context, journeyId: started2.journey.id } }, candidate2, now2, managed);
      return makePlan(plan2.result, snapshot, plan2.observationSnapshot ?? candidate2);
    }
    if (access.decision.outcome !== "ALLOW" || access.decision.reason !== "WHITELISTED") {
      return navigationPlan(operation, snapshot, now2, managed);
    }
    if (current !== void 0 && current.phase !== "ENDED") {
      if (continuesJourney(current, operation.target.hostname, operation.context.continuation) || current.phase === "STARTED" && current.rootHostname === operation.target.hostname) {
        return navigationPlan(operation, snapshot, now2, managed);
      }
      snapshot = { ...snapshot, journeyState: replaceJourney(snapshot.journeyState, finishJourney(current, "UNRELATED_NAVIGATION", now2)) };
    }
    const started = startJourney(operation.target, operation.context.contextId, journeyContext(snapshot, now2), configuration2.journeyLimits);
    if (!started.ok || started.type !== "STARTED")
      return reject4(started.ok ? "INVALID_JOURNEY_STATE" : started.reason, snapshot);
    const candidate = { ...snapshot, journeyState: started.nextState };
    const plan = navigationPlan({ ...operation, context: { contextId: operation.context.contextId, journeyId: started.journey.id } }, candidate, now2, managed);
    return makePlan(plan.result, snapshot, plan.observationSnapshot ?? candidate);
  }
  function managedDenies(snapshot, hostname, managed) {
    return managed !== void 0 && !snapshot.policy.blacklist.includes(hostname) && !snapshot.policy.whitelist.includes(hostname) && managedBlacklistContains(managed, hostname) === true;
  }
  function planAtlasOperation(operationInput, contextInput) {
    const fields = ["snapshot", "now", "configuration"];
    if (contextInput !== null && typeof contextInput === "object" && Object.hasOwn(contextInput, "managedBlacklist"))
      fields.push("managedBlacklist");
    if (!hasJourneyFields(contextInput, fields))
      return reject4("INVALID_CONTEXT");
    const validated = validateAtlasSnapshot(contextInput.snapshot);
    if (!validated.ok)
      return reject4(validated.reason);
    const managed = Object.hasOwn(contextInput, "managedBlacklist") ? contextInput.managedBlacklist : void 0;
    if (Object.hasOwn(contextInput, "managedBlacklist") && !isManagedBlacklist(managed))
      return reject4("INVALID_MANAGED_BLACKLIST");
    const managedList = managed;
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
    const observation = {
      ...snapshot,
      accessState: { ...snapshot.accessState, lastObservedAt: now2, policyRevision: snapshot.policyRevision },
      vaultState: { ...snapshot.vaultState, lastObservedAt: now2, policyRevision: snapshot.policyRevision },
      journeyState: journeys.nextState
    };
    if (!parsed.ok)
      return reject4(parsed.reason, observation);
    const operation = parsed.operation;
    const pending = operation.kind === "CONFIRM_ACCESS" ? observation.accessState.pendingRequests.find((r) => r.id === operation.requestId) : void 0;
    const guardedHosts = operation.kind === "START_ACCESS" ? operation.scopeHostnames ?? [operation.target.hostname] : pending === void 0 ? [] : accessScope(pending);
    if (guardedHosts.some((host2) => managedDenies(observation, host2, managedList)))
      return reject4("MANAGED_BLACKLISTED", observation);
    switch (operation.kind) {
      case "BEGIN_NAVIGATION":
        return beginNavigation(operation, observation, now2, managedList, configuration2);
      case "CHECK_NAVIGATION":
      case "RECORD_JOURNEY_NAVIGATION":
        return navigationPlan(operation, observation, now2, managedList);
      case "OBSERVE_TIME":
        return makePlan({ type: "OBSERVED" }, observation);
      case "START_ACCESS":
        return accessPlan(operation.kind, startAccess(operation.target, accessContext(observation, now2), configuration2.accessTiming, operation.scopeHostnames), observation);
      case "CONFIRM_ACCESS":
        return accessPlan(operation.kind, confirmAccess(operation.requestId, accessContext(observation, now2)), observation);
      case "CANCEL_ACCESS":
        return accessPlan(operation.kind, cancelAccess(operation.requestId, accessContext(observation, now2)), observation);
      case "START_JOURNEY":
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

  // ../packages/core/dist/atlas-controller.js
  function token(value) {
    return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
  }
  function readEnvelope(value) {
    if (!hasJourneyFields(value, ["schemaVersion", "storageVersion", "lastCommitId", "snapshot"]) || value.schemaVersion !== 2 || !token(value.storageVersion) || value.lastCommitId !== null && !token(value.lastCommitId))
      return null;
    const validated = validateAtlasSnapshot(value.snapshot);
    return validated.ok ? freezeVaultData({
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
  function same(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  function sameEnvelope(left, right) {
    return left.storageVersion === right.storageVersion && left.lastCommitId === right.lastCommitId && same(left.snapshot, right.snapshot);
  }
  function rolledBack(next, prior) {
    return next.configurationRevision < prior.configurationRevision || next.policyRevision < prior.policyRevision || next.accessState.nextRequestId < prior.accessState.nextRequestId || next.vaultState.nextProposalId < prior.vaultState.nextProposalId || next.journeyState.nextJourneyId < prior.journeyState.nextJourneyId || ["accessState", "vaultState", "journeyState"].some((key) => next[key].lastObservedAt < prior[key].lastObservedAt || next[key].policyRevision < prior[key].policyRevision);
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
    function setStatus(next, issue = null) {
      status = next;
      reason = issue;
    }
    function getView() {
      return freezeVaultData({
        status,
        reason,
        snapshot: authority?.snapshot ?? null,
        storageVersion: authority?.storageVersion ?? null,
        pendingCommitId: pending?.commitId ?? null
      });
    }
    function blocked(issue = reason ?? "NOT_READY") {
      return Object.freeze({ type: "BLOCKED", reason: issue, status, pendingCommitId: pending?.commitId ?? null });
    }
    function fault() {
      setStatus(pending ? "RECONCILING" : "UNAVAILABLE", pending ? "COMMIT_UNKNOWN" : "INTERNAL_ERROR");
    }
    function sampleManaged() {
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
    function context(snapshot, now2, managed) {
      return { snapshot, now: now2, configuration: snapshot.configuration, ...managed === void 0 ? {} : { managedBlacklist: managed } };
    }
    function enqueue(work, failed) {
      const next = queue.then(work).catch(() => {
        fault();
        return failed();
      });
      queue = next.then(() => void 0);
      return next;
    }
    function sampleTime() {
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
      let loaded;
      try {
        loaded = await repository.load();
      } catch {
        setStatus("UNAVAILABLE", "STORAGE_UNAVAILABLE");
        return false;
      }
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
      if (resolvedCommit !== null) {
        const proof = resolvedCommit;
        if (envelope.storageVersion === proof.priorVersion || envelope.storageVersion === proof.storageVersion && (envelope.lastCommitId !== proof.commitId || proof.snapshot !== null && !same(envelope.snapshot, proof.snapshot))) {
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
      const next = freezeVaultData({ schemaVersion: 2, snapshot: validated.snapshot });
      pending = { commitId, expectedStorageVersion, snapshot: validated.snapshot };
      setStatus("COMMITTING");
      let receipt;
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
      const committed = freezeVaultData({ ...next, storageVersion: receipt.storageVersion, lastCommitId: commitId });
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
      const managed = sampleManaged();
      if (managed === null)
        return getView();
      const observed = planAtlasOperation({ kind: "OBSERVE_TIME" }, context(authority.snapshot, now2, managed));
      let recovery = observed.observationSnapshot;
      if (recovery === null) {
        setStatus("UNAVAILABLE", "CORRUPT_STATE");
        return getView();
      }
      for (const journey of recovery.journeyState.journeys) {
        if (journey.phase === "ENDED")
          continue;
        const closed = planAtlasOperation({
          kind: "CLOSE_JOURNEY_CONTEXT",
          journeyId: journey.id,
          contextId: journey.contextId
        }, context(recovery, now2, managed));
        if (closed.candidateSnapshot === null) {
          setStatus("UNAVAILABLE", "CORRUPT_STATE");
          return getView();
        }
        recovery = closed.candidateSnapshot;
      }
      if (!same(recovery, authority.snapshot) && !await save(recovery))
        return getView();
      if (sampleTime() === null)
        return getView();
      setStatus("READY");
      return getView();
    }
    function publish(result, now2) {
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
      if (status !== "READY")
        return blocked();
      setStatus("LOADING");
      if (!await loadAuthority() || authority === null)
        return blocked();
      const now2 = sampleTime();
      if (now2 === null)
        return blocked();
      const managed = sampleManaged();
      if (managed === null)
        return blocked();
      const plan = planAtlasOperation(operation, context(authority.snapshot, now2, managed));
      const next = plan.candidateSnapshot ?? plan.observationSnapshot;
      if (next !== null && (plan.candidateSnapshot !== null || !same(next, authority.snapshot))) {
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
      if (currentManaged !== managed)
        return blocked("REEVALUATION_REQUIRED");
      if (plan.result.type === "ASSESSMENT" && plan.result.decision.outcome === "ALLOW" && "expiresAt" in plan.result.decision && finalTime >= plan.result.decision.expiresAt) {
        return blocked("REEVALUATION_REQUIRED");
      }
      return publish(plan.result, now2);
    }
    return Object.freeze({
      open: () => enqueue(open, getView),
      handle: (operation) => {
        let captured;
        try {
          captured = structuredClone(operation);
        } catch {
          captured = null;
        }
        return enqueue(() => handle(captured), () => blocked());
      },
      getView
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

  // src/presets/curated-whitelist.ts
  var curatedWhitelist = [
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
    { label: "Video", services: [
      { label: "YouTube", hostname: "youtube.com", aliases: ["www.youtube.com"] }
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
  function serviceHostnames(service) {
    return [service.hostname, ...service.aliases ?? [], ...service.destinations ?? []];
  }
  function serviceLabel(hostname) {
    for (const group of curatedWhitelist) for (const service of group.services) {
      if (serviceHostnames(service).includes(hostname)) return service.label;
    }
    return hostname;
  }
  function equivalentServiceHostnames(hostname) {
    for (const group of curatedWhitelist) for (const service of group.services) {
      const aliases = [service.hostname, ...service.aliases ?? []];
      if (aliases.includes(hostname)) return aliases;
    }
    return [hostname];
  }
  function compileCuratedWhitelist(groups = curatedWhitelist) {
    const hostnames = /* @__PURE__ */ new Set();
    for (const group of groups) for (const service of group.services) for (const hostname of serviceHostnames(service)) {
      if (normalizeTarget({ hostname })?.hostname !== hostname) throw new TypeError("Invalid curated hostname");
      hostnames.add(hostname);
    }
    return { whitelist: [...hostnames], blacklist: [] };
  }

  // src/ui/presentation.ts
  function countdown(deadline, now2) {
    const seconds = Math.max(0, Math.ceil((deadline - now2) / 1e3));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  // src/adapter/journey-indicator.ts
  function journeyPresentation(view, journey, now2) {
    journey = view?.snapshot?.journeyState.journeys.find((entry) => entry.id === journey?.id && entry.contextId === journey?.contextId) ?? null;
    if (view?.status !== "READY" && view?.status !== "COMMITTING" || journey === null || journey.phase === "ENDED" || journey.policyRevision !== view.snapshot?.policyRevision || !Number.isSafeInteger(now2) || now2 < journey.startedAt || now2 >= journey.expiresAt) return null;
    return { journeyId: journey.id, destinationLabel: serviceLabel(journey.rootHostname), expiresAt: journey.expiresAt };
  }
  function journeyIndicator(view, journey, now2) {
    const display = journeyPresentation(view, journey, now2);
    return display === null ? null : `Atlas \xB7 Journey \u2192 ${display.destinationLabel}
${countdown(display.expiresAt, now2)} remaining`;
  }
  function journeyRetry(view, journey) {
    journey = view?.snapshot?.journeyState.journeys.find((entry) => entry.id === journey?.id && entry.contextId === journey?.contextId) ?? null;
    if (view?.status !== "READY" && view?.status !== "COMMITTING" || !view.snapshot || journey === null || journey.phase !== "ENDED" || ["REACHED", "RETURNED", "DESTINATION_CHANGED", "CONTEXT_CLOSED"].includes(journey.endReason) || evaluate(journey.rootHostname, view.snapshot.policy).reason !== "WHITELISTED") return null;
    return { journeyId: journey.id, rootHostname: journey.rootHostname, destinationLabel: serviceLabel(journey.rootHostname) };
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
  var error = (reason) => ({ type: "ADAPTER_ERROR", reason });
  var FirefoxAdapter = class {
    constructor(api, host2, newContextId, now2, schedule = (callback, delay) => setTimeout(callback, delay), unschedule = (id) => clearTimeout(id)) {
      this.api = api;
      this.newContextId = newContextId;
      this.now = now2;
      this.schedule = schedule;
      this.unschedule = unschedule;
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
      api.webNavigation.onCommitted.addListener(this.arrived);
      api.webNavigation.onHistoryStateUpdated.addListener(this.changed);
      api.webNavigation.onReferenceFragmentUpdated.addListener(this.changed);
      api.tabs.onRemoved.addListener(this.closed);
      api.tabs.onUpdated.addListener(this.updated);
      api.runtime.onMessage.addListener(this.message);
      api.browserAction.onClicked.addListener(this.toolbar);
      this.ready = host2.then(async (value) => {
        this.host = value;
        await value.controller.open();
      }).catch(() => {
        this.host = null;
      });
    }
    contexts = /* @__PURE__ */ new Map();
    queue = Promise.resolve();
    host = null;
    refreshPending = null;
    stopped = false;
    nextNavigation = 0;
    diagnostics = new Diagnostics();
    ready;
    uiUrl;
    run(work) {
      const next = this.queue.then(async () => {
        await this.ready;
        try {
          return await work();
        } finally {
          const status = this.host?.controller.getView().status;
          if (status === "UNAVAILABLE" || status === "RECONCILING") {
            for (const context of this.contexts.values()) if (context.latest !== null) this.publish(context, context.latest);
          }
        }
      });
      this.queue = next.catch(() => void 0);
      return next;
    }
    /** Wait for queued adapter effects; read-only views deliberately do not wait. */
    whenIdle() {
      return this.queue;
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
          rootOrigin: null
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
    trace(event, context, result = context.latest, hostname = context.requested?.target.hostname ?? null) {
      try {
        const journey = this.journey(context);
        const at = this.now();
        this.diagnostics.add({
          event,
          at: Number.isSafeInteger(at) ? at : null,
          tabId: context.tabId,
          contextId: context.id,
          navigationId: context.navigationId,
          hostname,
          outcome: result?.type === "ASSESSMENT" ? result.decision.outcome : result?.type ?? null,
          reason: result?.type === "ASSESSMENT" ? result.decision.reason : result !== null && "reason" in result ? result.reason : null,
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
      const presentation = this.pageJourney(context);
      const key = JSON.stringify([context.generation, presentation]);
      if (context.pill === key) return;
      context.pill = key;
      void this.api.tabs.sendMessage(context.tabId, { kind: "ATLAS_JOURNEY_DISPLAY", presentation }, { frameId: 0 }).catch(() => {
        if (context.pill === key) context.pill = "";
      });
    }
    async check(context, target, record = false, continuation, begin = false) {
      return this.host?.controller.handle({
        kind: record ? "RECORD_JOURNEY_NAVIGATION" : begin ? "BEGIN_NAVIGATION" : "CHECK_NAVIGATION",
        target,
        context: this.binding(context, continuation)
      }) ?? error("STORAGE_UNAVAILABLE");
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
      const correlated = previous !== null && previous.released && previous.requestId === details.requestId && previous.redirectUrl === withoutFragment(details.url) && previous.timeStamp <= details.timeStamp;
      const initiator = details.originUrl === void 0 ? null : destination(details.originUrl);
      const sourceDocument = context.displayed;
      const sourceAuthority = context.displayedDecision;
      if (context.flight !== null && (!context.flight.released || context.flight.requestId !== details.requestId))
        this.trace("SUPERSEDED", context);
      const generation = ++context.generation;
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
        redirectUrl: null
      };
      context.flight = flight;
      context.requested = flight.destination;
      this.trace("REQUEST", context, null);
      return this.run(async () => {
        if (!this.live(context, generation)) return { cancel: true };
        const active = this.journey(context);
        const existingContinuation = active !== null && active.phase !== "ENDED" ? correlated && previous.journeyId === active.id ? { kind: "HTTP_REDIRECT", sourceHostname: active.currentHostname } : initiator?.target.hostname === context.displayed?.target.hostname && initiator?.target.hostname === active.currentHostname && flight.destination?.target.hostname === active.currentHostname ? { kind: "SAME_HOST", sourceHostname: active.currentHostname } : void 0 : void 0;
        const rootDeparture = sourceDocument !== null && context.displayed === sourceDocument && sourceAuthority !== null && allowed(sourceAuthority) && sourceAuthority.decision.reason === "WHITELISTED" && initiator?.origin === sourceDocument.origin && flight.destination !== null && flight.destination.target.hostname !== sourceDocument.target.hostname && (active === null || active.phase === "ENDED" || active.phase === "STARTED" && active.rootHostname === sourceDocument.target.hostname);
        const continuation = existingContinuation ?? (rootDeparture ? { kind: "ROOT_DEPARTURE", sourceHostname: sourceDocument.target.hostname } : void 0);
        let result = flight.destination === null ? error("INVALID_TARGET") : await this.check(context, flight.destination.target, false, continuation, true);
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
        this.publish(context, result);
        if (allowed(result)) {
          flight.released = true;
          flight.authority = result;
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
    async removeContent(context, generation) {
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
        const tab = await this.api.tabs.get(details.tabId);
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
        if (!allowed(result)) await this.removeContent(context, generation);
      }).catch(() => {
        if (this.live(context, generation)) {
          this.publish(context, error("ARRIVAL_RECONCILIATION_FAILED"));
          void this.run(() => this.removeContent(context, generation));
        }
      });
    };
    requestFailed = (details) => {
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
      if (details.type !== "main_frame" || details.frameId !== 0 || context?.flight === null || context?.flight === void 0 || context.flight.requestId !== details.requestId || !context.flight.released || context.flight.timeStamp > details.timeStamp || context.flight.url !== withoutFragment(details.url)) return;
      context.flight.redirectUrl = withoutFragment(details.redirectUrl);
      this.trace("REDIRECT", context, null, destination(details.redirectUrl)?.target.hostname ?? null);
    };
    closed = (tabId) => {
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
    toolbar = (tab) => {
      void this.run(async () => {
        const url = `${this.uiUrl}?view=control${tab.id === void 0 ? "" : `&tab=${tab.id}`}`;
        const existing = (await this.api.tabs.query({})).find((candidate) => candidate.url?.split(/[?#]/, 1)[0] === this.uiUrl && new URL(candidate.url).searchParams.get("view") !== "access");
        if (existing?.id !== void 0) await this.api.tabs.update(existing.id, { url, active: true });
        else await this.api.tabs.create({ url, active: true });
      }).catch(() => void 0);
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
    async recheck() {
      const observation = await this.host?.controller.handle({ kind: "OBSERVE_TIME" });
      for (const context of this.contexts.values()) {
        if (context.latest !== null) this.publish(context, context.latest);
      }
      const tabs = await this.api.tabs.query({});
      for (const tab of tabs) {
        if (tab.id === void 0 || tab.url === void 0 || tab.incognito) continue;
        const observed = destination(tab.url);
        const previous = this.contexts.get(tab.id);
        if (withoutFragment(tab.url).split("?", 1)[0] === this.uiUrl) {
          if (previous !== void 0 && previous.flight === null && !previous.launching) {
            this.acknowledgeRemoval(previous);
            if (previous.requested !== null) this.publish(previous, await this.check(previous, previous.requested.target));
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
          const expired = authorities.some((retained2) => retained2?.type === "ASSESSMENT" && "expiresAt" in retained2.decision && this.now() >= retained2.decision.expiresAt);
          const revisionChanged = authorities.some((retained2) => retained2 != null && "policyRevision" in retained2 && retained2.policyRevision !== this.host?.controller.getView().snapshot?.policyRevision);
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
        const retained = this.journey(context);
        const result = await this.check(
          context,
          observed.target,
          false,
          retained !== null && retained.phase !== "ENDED" ? { kind: "RETAINED", sourceHostname: retained.currentHostname } : void 0
        );
        if (!this.live(context, generation)) continue;
        context.displayed = observed;
        context.displayedDecision = result.type === "ADAPTER_ERROR" ? null : result;
        this.publish(context, result);
        context.requested = observed;
        if (!allowed(result)) await this.removeContent(context, generation);
      }
    }
    view() {
      const controller = this.host?.controller.getView() ?? null;
      return {
        controller,
        managed: this.host?.managed?.getView(controller?.snapshot?.policy.whitelist) ?? null,
        contexts: [...this.contexts.values()].map((context) => ({
          tabId: context.tabId,
          contextId: context.id,
          navigationId: context.navigationId,
          hostname: context.requested?.target.hostname ?? null,
          displayedHostname: context.displayed?.target.hostname ?? null,
          latest: context.latest,
          journey: this.journey(context),
          effect: context.effect,
          retry: journeyRetry(controller, this.journey(context))
        }))
      };
    }
    message = (input, sender) => {
      if (sender.id === this.api.runtime.id && sender.tab?.id !== void 0 && sender.frameId === 0 && input !== null && typeof input === "object" && !Array.isArray(input) && Object.keys(input).length === 1 && Object.hasOwn(input, "kind") && input.kind === "GET_JOURNEY_DISPLAY") {
        const context = this.contexts.get(sender.tab.id);
        const observed = sender.url === void 0 ? null : destination(sender.url);
        return Promise.resolve({ presentation: context && observed?.target.hostname === context.displayed?.target.hostname ? this.pageJourney(context) : null });
      }
      if (sender.id !== this.api.runtime.id || sender.url === void 0 || sender.url.split(/[?#]/, 1)[0] !== this.uiUrl || (sender.frameId ?? 0) !== 0) return false;
      if (input === null || typeof input !== "object" || Array.isArray(input) || !Object.hasOwn(input, "kind") || !("kind" in input) || typeof input.kind !== "string") return Promise.resolve({ error: "INVALID_COMMAND" });
      const command = input;
      const keys = {
        GET_VIEW: [],
        RECOVER: [],
        SETUP: ["policy"],
        OPEN_JOURNEY: ["url"],
        OPEN_DESTINATION: ["url"],
        START_JOURNEY: ["tabId"],
        CANCEL_JOURNEY: ["tabId"],
        START_ACCESS: ["tabId"],
        RESTART_JOURNEY: ["tabId", "journeyId"],
        CONFIRM_ACCESS: ["requestId"],
        CANCEL_ACCESS: ["requestId"],
        OPEN_HOME: ["tabId"],
        CONFIRM_ACCESS_AND_OPEN: ["tabId", "requestId"],
        GET_DIAGNOSTICS: ["tabId"],
        CLEAR_DIAGNOSTICS: [],
        PROPOSE_CURATED_DEFAULTS: [],
        REVIEW_POLICY: ["proposalId"],
        CONFIRM_POLICY: ["proposalId"],
        CANCEL_POLICY: ["proposalId"],
        PROPOSE_SETTINGS: ["candidateConfiguration"],
        PROPOSE_POLICY: ["candidatePolicy"]
      };
      const fields = Object.hasOwn(keys, command.kind) ? keys[command.kind] : void 0;
      if (fields === void 0 || Object.keys(command).length !== fields.length + 1 || fields.some((field) => !Object.hasOwn(command, field))) return Promise.resolve({ error: "INVALID_COMMAND" });
      if (command.kind === "GET_VIEW") return Promise.resolve({ view: this.view() });
      if (command.kind === "GET_DIAGNOSTICS") return Promise.resolve(command.tabId === null || Number.isSafeInteger(command.tabId) ? { entries: this.diagnostics.read(command.tabId) } : { error: "INVALID_CONTEXT" });
      if (command.kind === "CLEAR_DIAGNOSTICS") {
        this.diagnostics.clear();
        return Promise.resolve({ entries: [] });
      }
      return this.run(() => this.command(command)).catch(() => ({ error: "ADAPTER_FAILURE" }));
    };
    async command(command) {
      const controller = this.host?.controller;
      if (controller === void 0) return { error: "STORAGE_UNAVAILABLE", view: this.view() };
      if (command.kind === "SETUP") {
        const initialized = await this.host.repository.initialize(command.policy);
        if (initialized) await controller.open();
        return { initialized, view: this.view() };
      }
      if (command.kind === "RECOVER") {
        await controller.open();
        await this.recheck();
        return { view: this.view() };
      }
      if (command.kind === "PROPOSE_CURATED_DEFAULTS") {
        const observed = await controller.handle({ kind: "OBSERVE_TIME" });
        const policy = controller.getView().snapshot?.policy;
        if (observed.type !== "OBSERVED" || policy === void 0) return { result: observed, view: this.view() };
        const result2 = await controller.handle({ kind: "PROPOSE_POLICY", candidatePolicy: {
          whitelist: [.../* @__PURE__ */ new Set([...policy.whitelist, ...compileCuratedWhitelist().whitelist])],
          blacklist: policy.blacklist
        } });
        return { result: result2, view: this.view() };
      }
      if (command.kind === "REVIEW_POLICY" || command.kind === "CONFIRM_POLICY" || command.kind === "CANCEL_POLICY") {
        const result2 = await controller.handle({ kind: command.kind, proposalId: command.proposalId });
        if (command.kind === "CONFIRM_POLICY" && result2.type === "COMMITTED") await this.recheck();
        return { result: result2, view: this.view() };
      }
      if (command.kind === "PROPOSE_SETTINGS" || command.kind === "PROPOSE_POLICY") {
        const result2 = await controller.handle(command);
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
        result = await controller.handle({ kind: "START_JOURNEY", root: selected.target, contextId: context2.id });
        this.trace("COMMAND", context2, result);
        this.publish(context2, result);
        if (result.type === "COMMITTED" && this.contexts.get(tab.id) === context2) {
          this.navigate(context2, url);
          void this.api.tabs.update(tab.id, { active: true }).catch(() => void 0);
        } else await this.api.tabs.remove(tab.id);
        return { result, tabId: tab.id, view: this.view() };
      }
      if (command.kind === "CONFIRM_ACCESS" || command.kind === "CANCEL_ACCESS") {
        result = await controller.handle({ kind: command.kind, requestId: command.requestId });
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
        if (!allowed(result) || result.decision.reason !== "WHITELISTED" || !this.live(context, generation))
          return { result, opened: false, view: this.view() };
        const origin = context.rootOrigin?.journeyId === retry.journeyId ? context.rootOrigin.origin : `https://${retry.rootHostname}`;
        context.requested = destination(`${origin}/`);
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
        const scopeHostnames = equivalentServiceHostnames(context.requested.target.hostname).filter((host2) => !policy?.whitelist.includes(host2) || policy.blacklist.includes(host2));
        result = await controller.handle({ kind: "START_ACCESS", target: context.requested.target, scopeHostnames });
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
      this.api.webNavigation.onCommitted.removeListener(this.arrived);
      this.api.webNavigation.onHistoryStateUpdated.removeListener(this.changed);
      this.api.webNavigation.onReferenceFragmentUpdated.removeListener(this.changed);
      this.api.tabs.onRemoved.removeListener(this.closed);
      this.api.tabs.onUpdated.removeListener(this.updated);
      this.api.runtime.onMessage.removeListener(this.message);
      this.api.browserAction.onClicked.removeListener(this.toolbar);
    }
  };

  // src/background/configuration.ts
  var configuration = {
    accessTiming: { waitMs: 1e4, confirmationWindowMs: 6e4, grantDurationMs: 6e4 },
    vaultTiming: { waitMs: 3e4, confirmationWindowMs: 6e4 },
    journeyLimits: { lifetimeMs: 3e5, maxHops: 12 }
  };

  // src/storage/indexeddb-repository.ts
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
    close() {
      this.database.close();
    }
    transaction(mode) {
      const transaction = this.database.transaction(stores, mode, { durability: "strict" });
      if (mode === "readwrite" && transaction.durability !== "strict") {
        transaction.abort();
        throw new Error("STRICT_DURABILITY_UNAVAILABLE");
      }
      return transaction;
    }
    load() {
      return new Promise((resolve) => {
        try {
          const transaction = this.transaction("readwrite");
          const authority = transaction.objectStore("authority");
          const initialized = authority.get("initialized");
          const envelope = authority.get("envelope");
          let loaded;
          envelope.onsuccess = () => {
            loaded = envelope.result;
            if (initialized.result !== true || loaded === null || typeof loaded !== "object" || !("schemaVersion" in loaded) || loaded.schemaVersion !== 1) return;
            try {
              const old = loaded;
              if (Object.keys(old).length !== 4 || !Object.hasOwn(old, "snapshot") || typeof old.storageVersion !== "string" || !/^[a-z0-9_.:-]{1,256}$/i.test(old.storageVersion) || old.lastCommitId !== null && (typeof old.lastCommitId !== "string" || !/^[a-z0-9_.:-]{1,256}$/i.test(old.lastCommitId))) {
                transaction.abort();
                return;
              }
              const migrated = migrateAtlasSnapshotV1(old.snapshot, this.bootstrap);
              if (!migrated.ok) {
                transaction.abort();
                return;
              }
              const storageVersion = this.version();
              if (storageVersion === old.storageVersion) {
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
            if (initialized.result === false && envelope.result === void 0) {
              resolve({ type: "UNINITIALIZED" });
            } else if (initialized.result === true && envelope.result !== void 0) {
              resolve({ type: "READY", envelope: loaded });
            } else resolve({ type: "UNAVAILABLE" });
          };
          transaction.onabort = () => resolve({ type: "UNAVAILABLE" });
        } catch {
          resolve({ type: "UNAVAILABLE" });
        }
      });
    }
    initialize(policy) {
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
      return new Promise((resolve) => {
        try {
          const transaction = this.transaction("readwrite");
          let applied = false;
          const authority = transaction.objectStore("authority");
          const initialized = authority.get("initialized");
          const envelope = authority.get("envelope");
          envelope.onsuccess = () => {
            if (initialized.result !== false || envelope.result !== void 0) return;
            try {
              const storageVersion = this.version();
              authority.put({
                schemaVersion: 2,
                storageVersion,
                lastCommitId: null,
                snapshot: validated.snapshot
              }, "envelope");
              authority.put(true, "initialized");
              applied = true;
            } catch {
              transaction.abort();
            }
          };
          transaction.oncomplete = () => resolve(applied);
          transaction.onabort = () => resolve(false);
        } catch {
          resolve(false);
        }
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
        } catch {
          resolve({ type: "NOT_WRITTEN", commitId: request.commitId });
          return;
        }
        let result = { type: "NOT_WRITTEN", commitId: request.commitId };
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
          } catch {
            transaction.abort();
          }
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => resolve({ type: "NOT_WRITTEN", commitId: request.commitId });
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
          transaction.onabort = () => resolve({ type: "UNKNOWN", commitId });
        } catch {
          resolve({ type: "UNKNOWN", commitId });
        }
      });
    }
  };

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
  var local = (hostname) => hostname === "localhost" || hostname === "localhost.localdomain" || hostname === "local" || hostname === "broadcasthost" || hostname.startsWith("ip6-") || hostname.endsWith(".localhost") || hostname.endsWith(".local");
  function parseHostsFeed(text) {
    const domains = /* @__PURE__ */ new Set();
    const names = /* @__PURE__ */ new Set();
    let malformedLines = 0;
    for (const line of text.split(/\r?\n/)) {
      const record = line.split("#", 1)[0].trim();
      if (record === "") continue;
      const fields = record.split(/\s+/);
      const ip = fields.shift();
      if (ip !== "0.0.0.0" && ip !== "127.0.0.1" && ip !== "::") {
        if (!/^[0-9a-f:.]+(?:%[a-z0-9]+)?$/i.test(ip ?? "")) malformedLines++;
        continue;
      }
      if (fields.length === 0) {
        malformedLines++;
        continue;
      }
      for (const field of fields) {
        if (field === "0.0.0.0" || field === "127.0.0.1" || field === "::1" || local(field.toLowerCase())) continue;
        names.add(field.toLowerCase().replace(/\.$/, ""));
        const hostname = normalizeTarget({ hostname: field })?.hostname;
        if (hostname === void 0 || !hostname.includes(".")) continue;
        if (!local(hostname)) domains.add(hostname);
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
  var time = (value) => Number.isSafeInteger(value) && value >= 0;
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
      if (typeof record.text !== "string" || !validSource(record.sourceUrl) || !/^[a-f0-9]{64}$/.test(record.sha256) || record.fetchedAt !== null && !time(record.fetchedAt) || record.upstreamVersion !== null && (typeof record.upstreamVersion !== "string" || record.upstreamVersion.length > 200)) return null;
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
    let lastAttemptAt = saved?.schemaVersion === 1 && time(saved.lastAttemptAt) ? saved.lastAttemptAt : null;
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
      if (!time(now2)) {
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
        conflicts: whitelist.filter((hostname) => managedBlacklistContains(current.compiled, hostname) === true)
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

  // src/background/main.ts
  var now = () => Date.now();
  var managedPromise = openManagedCache(indexedDB).catch(() => ({
    load: async () => null,
    save: async () => false
  })).then((cache) => createManagedBlacklist({
    cache,
    now,
    digest: sha256,
    download: downloadStevenBlack,
    bundle: async () => {
      const base = browser.runtime.getURL("data/stevenblack/");
      const [data, metadata] = await Promise.all([fetch(`${base}hosts`), fetch(`${base}metadata.json`)]);
      if (!data.ok || !metadata.ok) throw new Error("BUNDLE_UNAVAILABLE");
      const record = await metadata.json();
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
  }));
  var host = Promise.all([openRepository(indexedDB, () => crypto.randomUUID()), managedPromise]).then(([repository, managed]) => ({
    repository,
    managed,
    controller: createAtlasController({
      repository,
      clock: { now },
      configuration,
      ownerId: crypto.randomUUID(),
      managedBlacklist: managed.getBlacklist
    })
  }));
  var adapter = new FirefoxAdapter(browser, host, () => crypto.randomUUID(), now);
  void adapter.ready.then(async () => {
    await adapter.refresh();
    const managed = await managedPromise;
    void managed.refresh().catch(() => void 0);
  }).catch(() => void 0);
  setInterval(() => {
    void adapter.refresh();
  }, 1e3);
  setInterval(() => {
    void managedPromise.then((managed) => managed.refresh()).catch(() => void 0);
  }, 60 * 60 * 1e3);
})();
//# sourceMappingURL=background.js.map
