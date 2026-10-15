"use strict";
(() => {
  // ../packages/core/dist/target.js
  function normalizeHostname(input2) {
    if (typeof input2 !== "string")
      return null;
    const value = input2.trim();
    if (!/^[a-z0-9.-]+$/i.test(value))
      return null;
    const hostname2 = value.toLowerCase().replace(/\.$/, "");
    if (hostname2.length === 0 || hostname2.length > 253)
      return null;
    const labels = hostname2.split(".");
    if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
      return null;
    }
    if (/^[0-9.]+$/.test(hostname2))
      return null;
    try {
      if (new URL(`https://${hostname2}`).hostname !== hostname2)
        return null;
    } catch {
      return null;
    }
    return hostname2;
  }
  function normalizeTarget(input2) {
    let hostname2;
    if (typeof input2 === "string") {
      const value = input2.trim();
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
    } else if (input2 !== null && typeof input2 === "object" && !Array.isArray(input2) && Object.keys(input2).length === 1 && Object.hasOwn(input2, "hostname") && "hostname" in input2) {
      hostname2 = normalizeHostname(input2.hostname);
    } else {
      return null;
    }
    return hostname2 === null ? null : { hostname: hostname2 };
  }

  // ../packages/core/dist/managed-blacklist.js
  var contents = /* @__PURE__ */ new WeakMap();
  function isManagedBlacklist(input2) {
    return input2 !== null && typeof input2 === "object" && contents.has(input2);
  }
  function managedBlacklistContains(input2, hostname2) {
    return isManagedBlacklist(input2) ? contents.get(input2).has(hostname2) : null;
  }

  // ../packages/core/dist/policy.js
  function normalizeEntries(input2) {
    if (!Array.isArray(input2))
      return null;
    const entries2 = [];
    for (const entry of input2) {
      const hostname2 = normalizeHostname(entry);
      if (hostname2 === null)
        return null;
      entries2.push(hostname2);
    }
    return entries2;
  }
  function normalizePolicy(input2) {
    if (input2 === null || typeof input2 !== "object" || Array.isArray(input2))
      return null;
    if (Object.keys(input2).some((key) => key !== "whitelist" && key !== "blacklist") || !Object.hasOwn(input2, "whitelist") || !Object.hasOwn(input2, "blacklist") || !("whitelist" in input2) || !("blacklist" in input2)) {
      return null;
    }
    const whitelist = normalizeEntries(input2.whitelist);
    const blacklist = normalizeEntries(input2.blacklist);
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
  function prepareContext(input2) {
    if (!hasFields(input2, ["policy", "policyRevision", "state", "now"])) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    const policy = normalizePolicy(input2.policy);
    if (policy === null)
      return { ok: false, reason: "INVALID_POLICY" };
    if (!nonnegativeInteger(input2.policyRevision)) {
      return { ok: false, reason: "INVALID_POLICY_REVISION" };
    }
    const state = readAccessState(input2.state);
    if (state === null)
      return { ok: false, reason: "INVALID_STATE" };
    if (!nonnegativeInteger(input2.now))
      return { ok: false, reason: "INVALID_TIME" };
    if (input2.now < state.lastObservedAt)
      return { ok: false, reason: "CLOCK_ROLLBACK" };
    if (input2.policyRevision < state.policyRevision) {
      return { ok: false, reason: "POLICY_ROLLBACK" };
    }
    return {
      ok: true,
      value: {
        policy,
        policyRevision: input2.policyRevision,
        now: input2.now,
        state: { ...state, lastObservedAt: input2.now, policyRevision: input2.policyRevision }
      }
    };
  }

  // ../packages/core/dist/access.js
  function reject(reason, nextState) {
    return { ok: false, reason, nextState };
  }
  function evaluateAccess(requestedSite, input2) {
    const prepared = prepareContext(input2);
    if (!prepared.ok) {
      return { decision: { outcome: "DENY", reason: prepared.reason }, nextState: null };
    }
    const { policy, policyRevision, now, state } = prepared.value;
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
        decision: now < grant.expiresAt ? {
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
      if (now >= request.confirmBy) {
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
        decision: now < request.readyAt ? { outcome: "WAIT", reason: "COOLDOWN", ...details } : { outcome: "REQUIRE_CONFIRMATION", reason: "CONFIRMATION_REQUIRED", ...details },
        nextState: state
      };
    }
    return { decision: base, nextState: state };
  }
  function startAccess(requestedSite, input2, timingInput, scopeInput) {
    const prepared = prepareContext(input2);
    if (!prepared.ok)
      return reject(prepared.reason, null);
    const { policy, policyRevision, now, state } = prepared.value;
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
    if (scope.some((host2) => evaluate(host2, policy).outcome !== "GREYLIST"))
      return reject("NOT_GREYLIST", state);
    const existing = state.pendingRequests.find((entry) => accessScope(entry).includes(hostname2));
    if (existing !== void 0 && existing.policyRevision === policyRevision && now < existing.confirmBy) {
      return { ok: true, type: "EXISTING_REQUEST", request: existing, nextState: state };
    }
    const grant = state.grants.find((entry) => accessScope(entry).includes(hostname2));
    if (grant !== void 0 && grant.policyRevision === policyRevision && now < grant.expiresAt) {
      return reject("GRANT_ACTIVE", state);
    }
    const overlaps = (entry) => accessScope(entry).some((host2) => scope.includes(host2));
    if (state.pendingRequests.some((entry) => overlaps(entry) && entry.policyRevision === policyRevision && now < entry.confirmBy) || state.grants.some((entry) => overlaps(entry) && entry.policyRevision === policyRevision && now < entry.expiresAt))
      return reject("SCOPE_CONFLICT", state);
    if (!positiveInteger(state.nextRequestId + 1))
      return reject("ID_EXHAUSTED", state);
    const readyAt = now + timing.waitMs;
    const confirmBy = readyAt + timing.confirmationWindowMs;
    if (!nonnegativeInteger(readyAt) || !nonnegativeInteger(confirmBy)) {
      return reject("TIME_OVERFLOW", state);
    }
    const request = {
      id: state.nextRequestId,
      hostname: hostname2,
      startedAt: now,
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
  function confirmAccess(requestId, input2) {
    const prepared = prepareContext(input2);
    if (!prepared.ok)
      return reject(prepared.reason, null);
    const context = prepared.value;
    const { policy, now, state } = context;
    const request = findRequest(requestId, context);
    if (typeof request === "string")
      return reject(request, state);
    if (accessScope(request).some((host2) => evaluate(host2, policy).outcome !== "GREYLIST")) {
      return reject("NOT_GREYLIST", state);
    }
    if (now < request.readyAt)
      return reject("NOT_READY", state);
    const expiresAt = now + request.grantDurationMs;
    if (!nonnegativeInteger(expiresAt))
      return reject("TIME_OVERFLOW", state);
    const grant = {
      requestId: request.id,
      hostname: request.hostname,
      issuedAt: now,
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
  function cancelAccess(requestId, input2) {
    const prepared = prepareContext(input2);
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
  function finishJourney(journey, endReason, now) {
    return journey.phase === "ENDED" ? journey : { ...journey, phase: "ENDED", endedAt: now, endReason };
  }
  function replaceJourney(state, journey) {
    return freezeJourneyState({
      ...state,
      journeys: state.journeys.map((entry) => entry.id === journey.id ? journey : entry)
    });
  }
  function prepareJourneyContext(input2) {
    const invalid = (reason) => ({ ok: false, reason, nextState: null });
    if (!hasJourneyFields(input2, ["policy", "policyRevision", "state", "now"]))
      return invalid("INVALID_STATE");
    const state = readJourneyState(input2.state);
    if (state === null)
      return invalid("INVALID_STATE");
    if (!nonnegativeInteger(input2.now))
      return invalid("INVALID_TIME");
    if (!nonnegativeInteger(input2.policyRevision))
      return invalid("INVALID_POLICY_REVISION");
    if (input2.now < state.lastObservedAt)
      return invalid("CLOCK_ROLLBACK");
    if (input2.policyRevision < state.policyRevision)
      return invalid("POLICY_ROLLBACK");
    const now = input2.now;
    const policyRevision = input2.policyRevision;
    const policy = normalizePolicy(input2.policy);
    const nextState = freezeJourneyState({
      ...state,
      lastObservedAt: now,
      policyRevision,
      journeys: state.journeys.map((journey) => {
        if (journey.phase === "ENDED")
          return journey;
        if (policy === null)
          return finishJourney(journey, "INVALID_POLICY", now);
        if (journey.policyRevision !== policyRevision)
          return finishJourney(journey, "POLICY_CHANGED", now);
        if (evaluate(journey.rootHostname, policy).outcome !== "ALLOW") {
          return finishJourney(journey, "ROOT_NOT_WHITELISTED", now);
        }
        return now >= journey.expiresAt ? finishJourney(journey, "EXPIRED", now) : journey;
      })
    });
    if (policy === null)
      return { ok: false, reason: "INVALID_POLICY", nextState };
    return { ok: true, value: { policy, policyRevision, state: nextState, now } };
  }

  // ../packages/core/dist/configuration.js
  function readVaultTiming(input2) {
    if (!hasJourneyFields(input2, ["waitMs", "confirmationWindowMs"]) || !positiveInteger(input2.waitMs) || !positiveInteger(input2.confirmationWindowMs))
      return null;
    return { waitMs: input2.waitMs, confirmationWindowMs: input2.confirmationWindowMs };
  }
  function readConfiguration(input2) {
    if (!hasJourneyFields(input2, ["accessTiming", "vaultTiming", "journeyLimits"]))
      return null;
    const accessTiming = readTiming(input2.accessTiming);
    const vaultTiming = readVaultTiming(input2.vaultTiming);
    const journeyLimits = readJourneyLimits(input2.journeyLimits);
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
  function prepareVaultContext(input2) {
    const protectedFields = input2 !== null && typeof input2 === "object" && Object.hasOwn(input2, "configuration");
    if (!hasFields2(input2, [
      "policy",
      "policyRevision",
      "state",
      "accessState",
      "now",
      ...protectedFields ? ["configuration", "configurationRevision"] : []
    ])) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    const configuration = protectedFields ? readConfiguration(input2.configuration) : void 0;
    if (configuration === null || protectedFields && !nonnegativeInteger(input2.configurationRevision))
      return { ok: false, reason: "INVALID_CONFIGURATION" };
    const policy = canonicalPolicy(input2.policy);
    if (policy === null)
      return { ok: false, reason: "INVALID_POLICY" };
    if (!nonnegativeInteger(input2.policyRevision))
      return { ok: false, reason: "INVALID_POLICY_REVISION" };
    const state = readVaultState(input2.state);
    if (state === null)
      return { ok: false, reason: "INVALID_STATE" };
    const proposal = state.pendingProposal;
    if (protectedFields) {
      if (proposal !== null && proposal.candidateConfiguration === void 0 || state.lastApplied !== null && state.lastApplied.configurationRevision === void 0)
        return { ok: false, reason: "INVALID_STATE" };
      if ((proposal?.baseConfigurationRevision ?? 0) > input2.configurationRevision || (state.lastApplied?.configurationRevision ?? 0) > input2.configurationRevision)
        return { ok: false, reason: "CONFIGURATION_ROLLBACK" };
    } else if (proposal?.candidateConfiguration !== void 0 || state.lastApplied?.configurationRevision !== void 0)
      return { ok: false, reason: "INVALID_STATE" };
    if (!nonnegativeInteger(input2.now))
      return { ok: false, reason: "INVALID_TIME" };
    if (input2.now < state.lastObservedAt)
      return { ok: false, reason: "CLOCK_ROLLBACK" };
    if (input2.policyRevision < state.policyRevision)
      return { ok: false, reason: "POLICY_ROLLBACK" };
    const access = prepareContext({
      policy,
      policyRevision: input2.policyRevision,
      state: input2.accessState,
      now: input2.now
    });
    if (!access.ok) {
      return { ok: false, reason: access.reason === "INVALID_STATE" ? "INVALID_ACCESS_STATE" : access.reason };
    }
    if (state.pendingProposal !== null && state.pendingProposal.basePolicyRevision === input2.policyRevision && samePolicy(state.pendingProposal.candidatePolicy, policy) && (configuration === void 0 || state.pendingProposal.baseConfigurationRevision === input2.configurationRevision && sameConfiguration(state.pendingProposal.candidateConfiguration, configuration))) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    return {
      ok: true,
      value: {
        policy,
        policyRevision: input2.policyRevision,
        now: input2.now,
        accessState: access.value.state,
        ...configuration === void 0 ? {} : { configuration, configurationRevision: input2.configurationRevision },
        state: { ...state, lastObservedAt: input2.now, policyRevision: input2.policyRevision }
      }
    };
  }

  // ../packages/core/dist/vault.js
  function reject2(reason, nextState) {
    return freezeVaultData({ ok: false, reason, nextState });
  }
  function createProposal(candidateInput, configurationInput, input2, timingInput) {
    const prepared = prepareVaultContext(input2);
    if (!prepared.ok)
      return reject2(prepared.reason, null);
    const { policy, policyRevision, state, now, configuration, configurationRevision } = prepared.value;
    if (state.pendingProposal !== null)
      return reject2("PROPOSAL_PENDING", state);
    const candidatePolicy = canonicalPolicy(candidateInput);
    if (candidatePolicy === null)
      return reject2("INVALID_CANDIDATE_POLICY", state);
    const candidateConfiguration = configuration === void 0 ? void 0 : readConfiguration(configurationInput === void 0 ? configuration : configurationInput);
    if (candidateConfiguration === null || configuration === void 0 && configurationInput !== void 0)
      return reject2("INVALID_CONFIGURATION", state);
    if (samePolicy(candidatePolicy, policy) && (configuration === void 0 || sameConfiguration(candidateConfiguration, configuration)))
      return reject2("NO_POLICY_CHANGE", state);
    const timing = readVaultTiming(configuration?.vaultTiming ?? timingInput);
    if (timing === null)
      return reject2("INVALID_TIMING", state);
    if (!positiveInteger(state.nextProposalId + 1))
      return reject2("ID_EXHAUSTED", state);
    const readyAt = now + timing.waitMs;
    const confirmBy = readyAt + timing.confirmationWindowMs;
    if (!nonnegativeInteger(readyAt) || !nonnegativeInteger(confirmBy))
      return reject2("TIME_OVERFLOW", state);
    const proposal = {
      id: state.nextProposalId,
      basePolicyRevision: policyRevision,
      candidatePolicy,
      createdAt: now,
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
  function createPolicyProposal(candidateInput, input2, timingInput) {
    return createProposal(candidateInput, void 0, input2, timingInput);
  }
  function createSettingsProposal(candidateInput, input2) {
    const prepared = prepareVaultContext(input2);
    if (!prepared.ok)
      return reject2(prepared.reason, null);
    if (prepared.value.configuration === void 0)
      return reject2("INVALID_CONFIGURATION", prepared.value.state);
    return createProposal(prepared.value.policy, candidateInput, input2, void 0);
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
  function classification(hostname2, policy) {
    const decision = evaluate(hostname2, policy);
    return decision.outcome === "ALLOW" ? "WHITELIST" : decision.outcome === "DENY" ? "BLACKLIST" : "GREYLIST";
  }
  function reviewPolicyProposal(proposalId, input2) {
    const prepared = prepareVaultContext(input2);
    if (!prepared.ok)
      return { ok: false, reason: prepared.reason };
    const { policy, policyRevision, now, configuration, configurationRevision } = prepared.value;
    const proposal = findProposal(proposalId, prepared.value);
    if (typeof proposal === "string")
      return { ok: false, reason: proposal };
    if (proposal.basePolicyRevision !== policyRevision)
      return { ok: false, reason: "POLICY_CHANGED" };
    if (configuration !== void 0 && proposal.baseConfigurationRevision !== configurationRevision)
      return { ok: false, reason: "CONFIGURATION_CHANGED" };
    const candidate = proposal.candidatePolicy;
    const hosts = [.../* @__PURE__ */ new Set([
      ...policy.whitelist,
      ...policy.blacklist,
      ...candidate.whitelist,
      ...candidate.blacklist
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
        phase: now >= proposal.confirmBy ? "EXPIRED" : now < proposal.readyAt ? "WAITING" : "READY",
        whitelist: listChanges(policy.whitelist, candidate.whitelist),
        blacklist: listChanges(policy.blacklist, candidate.blacklist),
        classifications,
        invalidatesAccess: !samePolicy(candidate, policy),
        ...configuration === void 0 ? {} : {
          currentConfiguration: configuration,
          candidateConfiguration: proposal.candidateConfiguration,
          baseConfigurationRevision: proposal.baseConfigurationRevision
        }
      }
    });
  }
  function prepareVaultCommit(proposalId, input2) {
    const prepared = prepareVaultContext(input2);
    if (!prepared.ok)
      return reject2(prepared.reason, null);
    const { policy, policyRevision, state, accessState, now, configuration, configurationRevision } = prepared.value;
    const proposal = findProposal(proposalId, prepared.value);
    if (typeof proposal === "string")
      return reject2(proposal, state);
    if (proposal.basePolicyRevision !== policyRevision)
      return reject2("POLICY_CHANGED", state);
    if (configuration !== void 0 && proposal.baseConfigurationRevision !== configurationRevision)
      return reject2("CONFIGURATION_CHANGED", state);
    if (now >= proposal.confirmBy)
      return reject2("PROPOSAL_EXPIRED", state);
    if (now < proposal.readyAt)
      return reject2("NOT_READY", state);
    const nextRevision = policyRevision + (samePolicy(policy, proposal.candidatePolicy) ? 0 : 1);
    const nextConfigurationRevision = configuration === void 0 ? void 0 : configurationRevision + (sameConfiguration(configuration, proposal.candidateConfiguration) ? 0 : 1);
    if (!nonnegativeInteger(nextRevision) || nextConfigurationRevision !== void 0 && !nonnegativeInteger(nextConfigurationRevision))
      return reject2("REVISION_EXHAUSTED", state);
    return freezeVaultData({
      ok: true,
      type: "COMMIT_PREPARED",
      nextState: state,
      candidate: {
        proposalId: proposal.id,
        expectedPolicyRevision: policyRevision,
        preparedAt: now,
        nextSnapshot: {
          ...configuration === void 0 ? {} : { configuration: proposal.candidateConfiguration, configurationRevision: nextConfigurationRevision },
          policy: proposal.candidatePolicy,
          policyRevision: nextRevision,
          vaultState: {
            ...state,
            pendingProposal: null,
            policyRevision: nextRevision,
            lastApplied: {
              proposalId: proposal.id,
              policyRevision: nextRevision,
              ...configuration === void 0 ? {} : { configurationRevision: nextConfigurationRevision }
            }
          },
          accessState: { ...accessState, policyRevision: nextRevision }
        }
      }
    });
  }
  function cancelPolicyProposal(proposalId, input2) {
    const prepared = prepareVaultContext(input2);
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
  function startJourney(requestedRoot, contextId, input2, limitsInput) {
    const prepared = prepareJourneyContext(input2);
    if (!prepared.ok)
      return reject3(prepared.reason, prepared.nextState);
    const { policy, policyRevision, state, now } = prepared.value;
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
    const expiresAt = now + limits.lifetimeMs;
    if (!nonnegativeInteger(expiresAt))
      return reject3("TIME_OVERFLOW", state);
    const journey = {
      id: state.nextJourneyId,
      contextId,
      rootHostname: target.hostname,
      currentHostname: target.hostname,
      phase: "STARTED",
      startedAt: now,
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
  function navigate(navigation2, input2, record) {
    const prepared = prepareJourneyContext(input2);
    if (!prepared.ok)
      return deny(prepared.reason, prepared.nextState);
    const { policy, now } = prepared.value;
    let state = prepared.value.state;
    const fields = ["journeyId", "contextId", "target"];
    if (navigation2 !== null && typeof navigation2 === "object" && Object.hasOwn(navigation2, "continuation"))
      fields.push("continuation");
    if (!hasJourneyFields(navigation2, fields)) {
      return deny("INVALID_NAVIGATION", state);
    }
    const continuation = Object.hasOwn(navigation2, "continuation") ? readJourneyContinuation(navigation2.continuation) : void 0;
    if (continuation === null)
      return deny("INVALID_NAVIGATION", state);
    let journey = findJourney(navigation2.journeyId, navigation2.contextId, state);
    if (typeof journey === "string")
      return deny(journey, state);
    const target = normalizeTarget(navigation2.target);
    if (target === null)
      return deny("INVALID_TARGET", state);
    const base = evaluate(target, policy);
    if (base.outcome === "DENY")
      return { decision: base, nextState: state };
    const returning = target.hostname === journey.rootHostname;
    if (journey.phase !== "ENDED" && !returning && !continuesJourney(journey, target.hostname, continuation)) {
      journey = finishJourney(journey, "UNRELATED_NAVIGATION", now);
      state = replaceJourney(state, journey);
    }
    const hop = !returning && target.hostname !== journey.currentHostname;
    if (journey.phase !== "ENDED" && hop && journey.hopCount >= journey.maxHops) {
      journey = finishJourney(journey, "HOP_LIMIT", now);
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
        journey = finishJourney({ ...journey, currentHostname: target.hostname }, journey.phase === "STARTED" ? "REACHED" : "RETURNED", now);
      } else if (hop) {
        journey = {
          ...journey,
          currentHostname: target.hostname,
          phase: "IN_TRANSIT",
          hopCount: journey.hopCount + 1
        };
      }
      if (journey.phase !== "ENDED" && continuation?.kind === "ARRIVAL" && base.outcome === "ALLOW") {
        journey = finishJourney(journey, "DESTINATION_CHANGED", now);
      }
      state = replaceJourney(state, journey);
    }
    return { decision, nextState: state };
  }
  function evaluateJourneyNavigation(navigation2, input2) {
    return navigate(navigation2, input2, false);
  }
  function recordJourneyNavigation(navigation2, input2) {
    return navigate(navigation2, input2, true);
  }
  function observeJourneys(input2) {
    const prepared = prepareJourneyContext(input2);
    return prepared.ok ? { ok: true, type: "OBSERVED", nextState: prepared.value.state } : reject3(prepared.reason, prepared.nextState);
  }
  function endJourney(id, contextId, input2, reason) {
    const prepared = prepareJourneyContext(input2);
    if (!prepared.ok)
      return reject3(prepared.reason, prepared.nextState);
    const { state, now } = prepared.value;
    const existing = findJourney(id, contextId, state);
    if (typeof existing === "string")
      return reject3(existing, state);
    if (existing.phase === "ENDED")
      return reject3("JOURNEY_ENDED", state);
    const journey = finishJourney(existing, reason, now);
    return { ok: true, type: "ENDED", journey, nextState: replaceJourney(state, journey) };
  }
  function cancelJourney(id, contextId, input2) {
    return endJourney(id, contextId, input2, "CANCELLED");
  }
  function closeJourneyContext(id, contextId, input2) {
    return endJourney(id, contextId, input2, "CONTEXT_CLOSED");
  }

  // ../packages/core/dist/atlas-state.js
  function validateAtlasSnapshot(input2) {
    const invalid = (reason, component) => ({ ok: false, reason, component });
    if (!hasJourneyFields(input2, ["policy", "policyRevision", "configuration", "configurationRevision", "accessState", "vaultState", "journeyState"])) {
      return invalid("INVALID_SNAPSHOT", "snapshot");
    }
    const policy = normalizePolicy(input2.policy);
    if (policy === null)
      return invalid("INVALID_POLICY", "policy");
    if (!nonnegativeInteger(input2.policyRevision))
      return invalid("INVALID_POLICY_REVISION", "policyRevision");
    const configuration = readConfiguration(input2.configuration);
    if (configuration === null || !nonnegativeInteger(input2.configurationRevision))
      return invalid("INVALID_CONFIGURATION", "configuration");
    const accessState = readAccessState(input2.accessState);
    if (accessState === null)
      return invalid("INVALID_ACCESS_STATE", "accessState");
    const vaultState = readVaultState(input2.vaultState);
    if (vaultState === null)
      return invalid("INVALID_VAULT_STATE", "vaultState");
    const journeyState = readJourneyState(input2.journeyState);
    if (journeyState === null)
      return invalid("INVALID_JOURNEY_STATE", "journeyState");
    for (const [component, state] of [
      ["accessState", accessState],
      ["vaultState", vaultState],
      ["journeyState", journeyState]
    ]) {
      if (state.policyRevision > input2.policyRevision)
        return invalid("POLICY_ROLLBACK", component);
    }
    const proposal = vaultState.pendingProposal;
    if (proposal !== null && proposal.candidateConfiguration === void 0 || vaultState.lastApplied !== null && vaultState.lastApplied.configurationRevision === void 0)
      return invalid("INVALID_VAULT_STATE", "vaultState");
    if ((proposal?.baseConfigurationRevision ?? 0) > input2.configurationRevision || (vaultState.lastApplied?.configurationRevision ?? 0) > input2.configurationRevision)
      return invalid("CONFIGURATION_ROLLBACK", "configurationRevision");
    const canonical = canonicalPolicy(policy);
    if (proposal !== null && proposal.basePolicyRevision === input2.policyRevision && proposal.baseConfigurationRevision === input2.configurationRevision && samePolicy(proposal.candidatePolicy, canonical) && sameConfiguration(proposal.candidateConfiguration, configuration)) {
      return invalid("INVALID_VAULT_STATE", "vaultState");
    }
    return freezeVaultData({
      ok: true,
      snapshot: { policy, policyRevision: input2.policyRevision, configuration, configurationRevision: input2.configurationRevision, accessState, vaultState, journeyState }
    });
  }

  // ../packages/core/dist/download.js
  var DOWNLOAD_LIFETIME_MS = 3e4;
  var DOWNLOAD_MAX_REDIRECTS = 5;
  var host = (input2) => typeof input2 === "string" && normalizeTarget({ hostname: input2 })?.hostname === input2;
  var journeyId = (input2) => input2 === null || nonnegativeInteger(input2) && input2 > 0;
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
  function evaluateDownload(operation, source, target, revision, now) {
    const deny2 = (reason) => ({ type: "DOWNLOAD", outcome: "DENY", reason });
    if (target.outcome === "DENY")
      return deny2(target.reason === "BLACKLISTED" || target.reason === "MANAGED_BLACKLISTED" ? target.reason : "INVALID_DOWNLOAD");
    if (source?.outcome !== "ALLOW")
      return deny2("DOWNLOAD_SOURCE_UNAUTHORIZED");
    const prior = operation.intent;
    if (prior === null) {
      const expiresAt = Math.min(now + DOWNLOAD_LIFETIME_MS, "expiresAt" in source ? source.expiresAt : Infinity);
      if (!nonnegativeInteger(expiresAt) || expiresAt <= now)
        return deny2("INVALID_DOWNLOAD");
      return { type: "DOWNLOAD", outcome: "PREPARED", intent: {
        ...operation.binding,
        sourceContextId: operation.source.context.contextId,
        sourceJourneyId: operation.source.context.journeyId,
        sourceHostname: operation.source.target.hostname,
        currentHostname: operation.target.hostname,
        policyRevision: revision,
        startedAt: now,
        expiresAt,
        lastObservedAt: now,
        redirects: 0,
        phase: "PREPARED"
      } };
    }
    if (prior.policyRevision !== revision)
      return deny2("DOWNLOAD_POLICY_CHANGED");
    if (now < prior.lastObservedAt)
      return deny2("INVALID_DOWNLOAD");
    if (now >= prior.expiresAt)
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
      lastObservedAt: now,
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
  function readTarget(input2) {
    return hasJourneyFields(input2, ["hostname"]) ? normalizeTarget(input2) : null;
  }
  function readOperation(value) {
    const invalid = (reason = "INVALID_OPERATION") => ({ ok: false, reason });
    const valid = (operation) => ({ ok: true, operation });
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return invalid();
    const input2 = value;
    const kind = input2.kind;
    switch (kind) {
      case "CHECK_DOWNLOAD": {
        const operation = readDownloadOperation(value);
        return operation === null ? invalid() : valid(operation);
      }
      case "BEGIN_NAVIGATION":
      case "CHECK_NAVIGATION":
      case "RECORD_JOURNEY_NAVIGATION": {
        const fields = ["contextId", "journeyId"];
        if (input2.context !== null && typeof input2.context === "object" && Object.hasOwn(input2.context, "continuation"))
          fields.push("continuation");
        if (!hasJourneyFields(input2, ["kind", "target", "context"]) || !hasJourneyFields(input2.context, fields))
          return invalid();
        const target = readTarget(input2.target);
        if (target === null)
          return invalid("INVALID_TARGET");
        const { contextId, journeyId: journeyId2 } = input2.context;
        if (!validContextId(contextId))
          return invalid("INVALID_CONTEXT_ID");
        if (journeyId2 !== null && !positiveInteger(journeyId2))
          return invalid("INVALID_JOURNEY_ID");
        const continuation = Object.hasOwn(input2.context, "continuation") ? readJourneyContinuation(input2.context.continuation) : void 0;
        if (continuation === null)
          return invalid("INVALID_NAVIGATION");
        return valid({ kind, target, context: { contextId, journeyId: journeyId2, ...continuation === void 0 ? {} : { continuation } } });
      }
      case "START_ACCESS": {
        const scoped = Object.hasOwn(input2, "scopeHostnames");
        if (!hasJourneyFields(input2, ["kind", "target", ...scoped ? ["scopeHostnames"] : []]))
          return invalid();
        const target = readTarget(input2.target);
        if (target === null)
          return invalid("INVALID_TARGET");
        const scopeHostnames = scoped ? readAccessScope(input2.scopeHostnames, target.hostname) : void 0;
        return scopeHostnames === null ? invalid("INVALID_SCOPE") : valid({
          kind,
          target,
          ...scopeHostnames === void 0 ? {} : { scopeHostnames }
        });
      }
      case "CONFIRM_ACCESS":
      case "CANCEL_ACCESS":
        if (!hasJourneyFields(input2, ["kind", "requestId"]))
          return invalid();
        return positiveInteger(input2.requestId) ? valid({ kind, requestId: input2.requestId }) : invalid("INVALID_REQUEST_ID");
      case "PROPOSE_POLICY": {
        if (!hasJourneyFields(input2, ["kind", "candidatePolicy"]))
          return invalid();
        const candidatePolicy = normalizePolicy(input2.candidatePolicy);
        return candidatePolicy === null ? invalid("INVALID_CANDIDATE_POLICY") : valid({ kind, candidatePolicy });
      }
      case "PROPOSE_SETTINGS": {
        if (!hasJourneyFields(input2, ["kind", "candidateConfiguration"]))
          return invalid();
        const candidateConfiguration = readConfiguration(input2.candidateConfiguration);
        return candidateConfiguration === null ? invalid("INVALID_CONFIGURATION") : valid({ kind, candidateConfiguration });
      }
      case "REVIEW_POLICY":
      case "CONFIRM_POLICY":
      case "CANCEL_POLICY":
        if (!hasJourneyFields(input2, ["kind", "proposalId"]))
          return invalid();
        return positiveInteger(input2.proposalId) ? valid({ kind, proposalId: input2.proposalId }) : invalid("INVALID_PROPOSAL_ID");
      case "START_JOURNEY": {
        if (!hasJourneyFields(input2, ["kind", "root", "contextId"]))
          return invalid();
        if (!validContextId(input2.contextId))
          return invalid("INVALID_CONTEXT_ID");
        const root = readTarget(input2.root);
        return root === null ? invalid("INVALID_TARGET") : valid({ kind, root, contextId: input2.contextId });
      }
      case "CANCEL_JOURNEY":
      case "CLOSE_JOURNEY_CONTEXT":
        if (!hasJourneyFields(input2, ["kind", "journeyId", "contextId"]))
          return invalid();
        if (!validContextId(input2.contextId))
          return invalid("INVALID_CONTEXT_ID");
        return positiveInteger(input2.journeyId) ? valid({ kind, journeyId: input2.journeyId, contextId: input2.contextId }) : invalid("INVALID_JOURNEY_ID");
      case "OBSERVE_TIME":
        return hasJourneyFields(input2, ["kind"]) ? valid({ kind }) : invalid();
      default:
        return invalid();
    }
  }
  function accessContext(snapshot, now) {
    return { policy: snapshot.policy, policyRevision: snapshot.policyRevision, state: snapshot.accessState, now };
  }
  function journeyContext(snapshot, now) {
    return { policy: snapshot.policy, policyRevision: snapshot.policyRevision, state: snapshot.journeyState, now };
  }
  function vaultContext(snapshot, now) {
    return {
      policy: snapshot.policy,
      policyRevision: snapshot.policyRevision,
      state: snapshot.vaultState,
      accessState: snapshot.accessState,
      now,
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
  function navigationPlan(operation, snapshot, now, managed) {
    const bindingError = checkBinding(operation.context, snapshot);
    if (bindingError !== null)
      return reject4(bindingError, snapshot);
    const access = evaluateAccess(operation.target, accessContext(snapshot, now));
    if (access.nextState === null)
      return reject4("INVALID_ACCESS_STATE");
    let observation = { ...snapshot, accessState: access.nextState };
    const decision = access.decision;
    const managedDecision = managedDenies(snapshot, operation.target.hostname, managed) ? { outcome: "DENY", reason: "MANAGED_BLACKLISTED", target: operation.target } : null;
    const navigation2 = { ...operation.context, target: operation.target };
    if (operation.context.journeyId !== null) {
      const journey = evaluateJourneyNavigation(navigation2, journeyContext(observation, now));
      if (journey.nextState === null)
        return reject4("INVALID_JOURNEY_STATE");
      observation = { ...observation, journeyState: journey.nextState };
      if (journey.decision.outcome === "DENY" && journey.decision.reason !== "BLACKLISTED") {
        return reject4(journey.decision.reason, observation);
      }
      const combined = managedDecision ?? (access.decision.outcome === "DENY" || access.decision.outcome === "ALLOW" ? access.decision : journey.decision.outcome === "ALLOW" ? journey.decision : access.decision);
      if (operation.kind === "RECORD_JOURNEY_NAVIGATION" && combined.outcome === "ALLOW") {
        const recorded = recordJourneyNavigation(navigation2, journeyContext(observation, now));
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
  function beginNavigation(operation, snapshot, now, managed, configuration) {
    const bindingError = checkBinding(operation.context, snapshot);
    if (bindingError !== null)
      return reject4(bindingError, snapshot);
    const current = snapshot.journeyState.journeys.find((j) => j.id === operation.context.journeyId);
    const access = evaluateAccess(operation.target, accessContext(snapshot, now));
    const departure = operation.context.continuation?.kind === "ROOT_DEPARTURE" ? operation.context.continuation : void 0;
    if (departure !== void 0) {
      if (access.decision.outcome === "DENY" || managedDenies(snapshot, operation.target.hostname, managed)) {
        return navigationPlan(operation, snapshot, now, managed);
      }
      if (evaluateAccess({ hostname: departure.sourceHostname }, accessContext(snapshot, now)).decision.reason !== "WHITELISTED") {
        return reject4("NOT_WHITELISTED", snapshot);
      }
      if (departure.sourceHostname === operation.target.hostname)
        return reject4("INVALID_NAVIGATION", snapshot);
      if (access.decision.outcome === "ALLOW" && access.decision.reason === "WHITELISTED") {
        return beginNavigation({ ...operation, context: {
          contextId: operation.context.contextId,
          journeyId: operation.context.journeyId
        } }, snapshot, now, managed, configuration);
      }
      if (current !== void 0 && current.phase !== "ENDED") {
        return navigationPlan(operation, snapshot, now, managed);
      }
      const started2 = startJourney({ hostname: departure.sourceHostname }, operation.context.contextId, journeyContext(snapshot, now), configuration.journeyLimits);
      if (!started2.ok || started2.type !== "STARTED")
        return reject4(started2.ok ? "INVALID_JOURNEY_STATE" : started2.reason, snapshot);
      const candidate2 = { ...snapshot, journeyState: started2.nextState };
      const plan2 = navigationPlan({ ...operation, context: { ...operation.context, journeyId: started2.journey.id } }, candidate2, now, managed);
      return makePlan(plan2.result, snapshot, plan2.observationSnapshot ?? candidate2);
    }
    if (access.decision.outcome !== "ALLOW" || access.decision.reason !== "WHITELISTED") {
      return navigationPlan(operation, snapshot, now, managed);
    }
    if (current !== void 0 && current.phase !== "ENDED") {
      if (continuesJourney(current, operation.target.hostname, operation.context.continuation) || current.phase === "STARTED" && current.rootHostname === operation.target.hostname) {
        return navigationPlan(operation, snapshot, now, managed);
      }
      snapshot = { ...snapshot, journeyState: replaceJourney(snapshot.journeyState, finishJourney(current, "UNRELATED_NAVIGATION", now)) };
    }
    const started = startJourney(operation.target, operation.context.contextId, journeyContext(snapshot, now), configuration.journeyLimits);
    if (!started.ok || started.type !== "STARTED")
      return reject4(started.ok ? "INVALID_JOURNEY_STATE" : started.reason, snapshot);
    const candidate = { ...snapshot, journeyState: started.nextState };
    const plan = navigationPlan({ ...operation, context: { contextId: operation.context.contextId, journeyId: started.journey.id } }, candidate, now, managed);
    return makePlan(plan.result, snapshot, plan.observationSnapshot ?? candidate);
  }
  function managedDenies(snapshot, hostname2, managed) {
    return managed !== void 0 && !snapshot.policy.blacklist.includes(hostname2) && !snapshot.policy.whitelist.includes(hostname2) && managedBlacklistContains(managed, hostname2) === true;
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
    const now = contextInput.now;
    if (!nonnegativeInteger(now))
      return reject4("INVALID_TIME");
    if ([snapshot.accessState, snapshot.vaultState, snapshot.journeyState].some((s) => now < s.lastObservedAt)) {
      return reject4("CLOCK_ROLLBACK");
    }
    const configuration = snapshot.configuration;
    if (readConfiguration(contextInput.configuration) === null)
      return reject4("INVALID_CONFIGURATION");
    const parsed = readOperation(operationInput);
    const journeys = observeJourneys(journeyContext(snapshot, now));
    if (!journeys.ok)
      return reject4(journeys.reason);
    const observation = {
      ...snapshot,
      accessState: { ...snapshot.accessState, lastObservedAt: now, policyRevision: snapshot.policyRevision },
      vaultState: { ...snapshot.vaultState, lastObservedAt: now, policyRevision: snapshot.policyRevision },
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
      case "CHECK_DOWNLOAD": {
        const source = navigationPlan({
          kind: "CHECK_NAVIGATION",
          target: operation.source.target,
          context: { ...operation.source.context, ...operation.source.context.journeyId === null ? {} : {
            continuation: { kind: "RETAINED", sourceHostname: operation.source.target.hostname }
          } }
        }, observation, now, managedList);
        const access = evaluateAccess(operation.target, accessContext(observation, now)).decision;
        const target = managedDenies(observation, operation.target.hostname, managedList) ? { outcome: "DENY", reason: "MANAGED_BLACKLISTED", target: operation.target } : access;
        return makePlan(evaluateDownload(operation, source.result.type === "ASSESSMENT" ? source.result.decision : null, target, observation.policyRevision, now), observation);
      }
      case "BEGIN_NAVIGATION":
        return beginNavigation(operation, observation, now, managedList, configuration);
      case "CHECK_NAVIGATION":
      case "RECORD_JOURNEY_NAVIGATION":
        return navigationPlan(operation, observation, now, managedList);
      case "OBSERVE_TIME":
        return makePlan({ type: "OBSERVED" }, observation);
      case "START_ACCESS":
        return accessPlan(operation.kind, startAccess(operation.target, accessContext(observation, now), configuration.accessTiming, operation.scopeHostnames), observation);
      case "CONFIRM_ACCESS":
        return accessPlan(operation.kind, confirmAccess(operation.requestId, accessContext(observation, now)), observation);
      case "CANCEL_ACCESS":
        return accessPlan(operation.kind, cancelAccess(operation.requestId, accessContext(observation, now)), observation);
      case "START_JOURNEY":
        return journeyPlan(operation.kind, startJourney(operation.root, operation.contextId, journeyContext(observation, now), configuration.journeyLimits), observation);
      case "CANCEL_JOURNEY":
      case "CLOSE_JOURNEY_CONTEXT": {
        const end = operation.kind === "CANCEL_JOURNEY" ? cancelJourney : closeJourneyContext;
        return journeyPlan(operation.kind, end(operation.journeyId, operation.contextId, journeyContext(observation, now)), observation);
      }
      case "PROPOSE_SETTINGS":
      case "PROPOSE_POLICY": {
        const proposed = operation.kind === "PROPOSE_SETTINGS" ? createSettingsProposal(operation.candidateConfiguration, vaultContext(observation, now)) : createPolicyProposal(operation.candidatePolicy, vaultContext(observation, now), configuration.vaultTiming);
        return proposed.ok ? makePlan({ type: "TRANSITION_PREPARED", operation: operation.kind, id: proposed.proposal.id }, observation, { ...observation, vaultState: proposed.nextState }) : reject4(proposed.reason, observation);
      }
      case "CANCEL_POLICY": {
        const cancelled = cancelPolicyProposal(operation.proposalId, vaultContext(observation, now));
        return cancelled.ok ? makePlan({ type: "TRANSITION_PREPARED", operation: operation.kind, id: cancelled.proposalId }, observation, { ...observation, vaultState: cancelled.nextState }) : reject4(cancelled.reason, observation);
      }
      case "CONFIRM_POLICY": {
        const prepared = prepareVaultCommit(operation.proposalId, vaultContext(observation, now));
        if (!prepared.ok)
          return reject4(prepared.reason, observation);
        const next = {
          ...observation,
          ...prepared.candidate.nextSnapshot,
          policy: prepared.candidate.nextSnapshot.policyRevision === observation.policyRevision ? observation.policy : prepared.candidate.nextSnapshot.policy
        };
        const invalidated = observeJourneys(journeyContext(next, now));
        if (!invalidated.ok)
          return reject4(invalidated.reason, observation);
        return makePlan({
          type: "POLICY_COMMIT_PREPARED",
          proposalId: operation.proposalId,
          expectedPolicyRevision: prepared.candidate.expectedPolicyRevision
        }, observation, { ...next, journeyState: invalidated.nextState });
      }
      case "REVIEW_POLICY": {
        const reviewed = reviewPolicyProposal(operation.proposalId, vaultContext(snapshot, now));
        return reviewed.ok ? makePlan({ type: "REVIEW", review: reviewed.review }) : reject4(reviewed.reason);
      }
    }
  }

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
  function serviceLabel(hostname2) {
    for (const group of curatedWhitelist) for (const service of group.services) {
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
    return { whitelist: [...hostnames], blacklist: [] };
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
  function destinationIndex(policy, metadata2 = []) {
    const active = new Set(policy.whitelist.filter((hostname2) => evaluate({ hostname: hostname2 }, policy).outcome === "ALLOW"));
    const entries2 = [];
    for (const item of metadata2) {
      const hostnames = item.hostnames.filter((host2) => active.has(host2));
      if (hostnames.length === 0) continue;
      entries2.push({
        id: item.id,
        label: item.label,
        category: item.category,
        hostname: hostnames.includes(item.primaryHostname) ? item.primaryHostname : hostnames[0],
        hostnames
      });
      hostnames.forEach((host2) => active.delete(host2));
    }
    for (const group of curatedWhitelist) for (const service of group.services) {
      const hostnames = serviceHostnames(service).filter((hostname2) => active.has(hostname2));
      if (hostnames.length === 0) continue;
      entries2.push({ id: `service:${service.hostname}`, label: service.label, hostname: hostnames[0], hostnames, category: group.label });
      hostnames.forEach((hostname2) => active.delete(hostname2));
    }
    for (const hostname2 of [...active].sort()) entries2.push({ label: hostname2, hostname: hostname2, hostnames: [hostname2], category: "Your destinations" });
    const curatedIds = curatedWhitelist.flatMap((group) => group.services.map((service) => `service:${service.hostname}`));
    const order = (entry) => {
      const index = curatedIds.indexOf(entry.id ?? "");
      return index < 0 ? curatedIds.length : index;
    };
    const categories = categorySuggestions(metadata2.map((item) => item.category));
    return entries2.sort((a, b) => order(a) - order(b)).map((entry) => ({ ...entry, category: canonicalCategory(entry.category, categories) }));
  }
  function policyDestinationIndex(policy, metadata2 = []) {
    return destinationIndex({ whitelist: [.../* @__PURE__ */ new Set([...policy.whitelist, ...policy.blacklist])], blacklist: [] }, metadata2);
  }
  function searchDestinations(entries2, query) {
    const words = query.trim().toLocaleLowerCase("en").split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return entries2.filter((entry) => words.every((word) => `${entry.label} ${entry.hostnames.join(" ")}`.toLocaleLowerCase("en").includes(word)));
  }
  function searchDestinationTargets(entries2, query) {
    const term = query.trim().toLocaleLowerCase("en");
    if (!term) return [];
    const exact = entries2.flatMap((entry) => entry.hostnames.includes(term) ? [{ entry, hostname: term, match: "EXACT_HOST" }] : []);
    if (exact.length) return exact;
    const address = parse(term, { allowPrivateDomains: true });
    if (address.domain !== null && (address.isIcann || address.isPrivate) && !term.endsWith(".")) return [];
    const words = term.split(/\s+/);
    return searchDestinations(entries2, query).flatMap((entry) => {
      if (words.every((word) => entry.label.toLocaleLowerCase("en").includes(word))) return [{ entry, hostname: entry.hostname, match: "NAME" }];
      const service = curatedWhitelist.flatMap((group) => group.services).find((item) => serviceHostnames(item).includes(entry.hostname));
      const points = [service?.hostname ?? entry.hostname, ...service?.destinations ?? []];
      const hosts = entry.hostnames.filter((host2) => words.every((word) => host2.includes(word)));
      if (!hosts.length) return [{ entry, hostname: entry.hostname, match: "NAME" }];
      return hosts.map((hostname2) => ({ entry, hostname: hostname2, match: points.includes(hostname2) ? "ENTRY_POINT" : service?.aliases?.includes(hostname2) ? "ALIAS" : "HOST" }));
    });
  }

  // src/ui/home-model.ts
  function destinationId(entry) {
    if (entry.id !== void 0) return entry.id;
    for (const group of curatedWhitelist) for (const service of group.services) {
      if (serviceHostnames(service).includes(entry.hostname)) return `service:${service.hostname}`;
    }
    return `host:${entry.hostname}`;
  }
  function readPins(value) {
    if (!Array.isArray(value) || value.length > 200 || value.some((id) => typeof id !== "string" || id.length > 260 || !/^(service|host):[a-z0-9.-]+$/.test(id))) return [];
    return [...new Set(value)];
  }
  function pinnedDestinations(entries2, pins2) {
    const active = new Map(entries2.map((entry) => [destinationId(entry), entry]));
    const selected2 = /* @__PURE__ */ new Set();
    return pins2.flatMap((id) => {
      const entry = active.get(id) ?? (id.startsWith("host:") ? entries2.find((item) => item.hostnames.includes(id.slice(5))) : void 0);
      if (entry === void 0 || selected2.has(destinationId(entry))) return [];
      selected2.add(destinationId(entry));
      return [entry];
    });
  }
  function updateDestinationPin(pins2, id, pinned, hosts = []) {
    const related = /* @__PURE__ */ new Set([id, ...hosts.map((host2) => `host:${host2}`)]);
    const next = [];
    let placed = false;
    for (const pin of pins2) {
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
    for (const group of curatedWhitelist) for (const service of group.services) {
      if (!serviceHostnames(service).includes(entry.hostname)) continue;
      const active = [service.hostname, ...service.destinations ?? []].filter((hostname2) => entry.hostnames.includes(hostname2));
      return active.length > 0 ? active : [entry.hostname];
    }
    return [entry.hostname];
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
      const destination = item.destination === null ? null : metadata(item.destination);
      const policy = item.candidatePolicy;
      if (Number.isSafeInteger(item.proposalId) && item.proposalId > 0 && Number.isSafeInteger(item.basePolicyRevision) && item.basePolicyRevision >= 0 && (item.destination === null || destination !== null) && (item.removedId === null || validDestinationId(item.removedId)) && typeof item.pin === "boolean" && policy && Array.isArray(policy.whitelist) && Array.isArray(policy.blacklist) && policy.whitelist.length + policy.blacklist.length <= 1e4 && [...policy.whitelist, ...policy.blacklist].every(hostname)) {
        pending = {
          proposalId: item.proposalId,
          basePolicyRevision: item.basePolicyRevision,
          candidatePolicy: { whitelist: [...policy.whitelist], blacklist: [...policy.blacklist] },
          destination,
          removedId: item.removedId,
          pin: item.pin
        };
      }
    }
    return { version: 1, destinations, pending };
  }
  var samePolicy2 = (a, b) => ["whitelist", "blacklist"].every((key) => JSON.stringify([...a[key]].sort()) === JSON.stringify([...b[key]].sort()));
  function replaceDestinationMetadata(entries2, destination, removedId) {
    const claimed = new Set(destination?.hostnames ?? []);
    const next = entries2.flatMap((item) => {
      if (item.id === removedId || item.id === destination?.id) return [];
      const hostnames = item.hostnames.filter((host2) => !claimed.has(host2));
      if (hostnames.length === 0) return [];
      return [{ ...item, hostnames, primaryHostname: hostnames.includes(item.primaryHostname) ? item.primaryHostname : hostnames[0] }];
    });
    if (destination === null) return next;
    const index = entries2.findIndex((item) => item.id === removedId || item.id === destination.id);
    if (index < 0) return [...next, destination];
    const preceding = entries2.slice(0, index).filter((item) => next.some((entry) => entry.id === item.id)).length;
    return [...next.slice(0, preceding), destination, ...next.slice(preceding)];
  }
  function reconcileDestinationPreferences(preferences, snapshot) {
    const pending = preferences.pending;
    if (pending === null || snapshot.vaultState.pendingProposal?.id === pending.proposalId) return { preferences, pinChange: null };
    const committed = snapshot.vaultState.lastApplied?.proposalId === pending.proposalId && (snapshot.policyRevision === pending.basePolicyRevision || snapshot.policyRevision === pending.basePolicyRevision + 1) && samePolicy2(snapshot.policy, pending.candidatePolicy);
    if (!committed) return { preferences: { ...preferences, pending: null }, pinChange: null };
    const removedId = pending.removedId ?? pending.destination?.id;
    const destinations = replaceDestinationMetadata(preferences.destinations, pending.destination, removedId ?? null);
    return { preferences: { version: 1, destinations, pending: null }, pinChange: removedId == null ? null : { id: removedId, pinned: pending.destination !== null && pending.pin } };
  }

  // src/ui/home-layout.ts
  var legacyOrder = ["University", "Scholar / Research", "Writing", "Development", "Mail", "AI", "Video"].map(categoryKey);
  var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function homeCategories(allowed, all = allowed, definitions = []) {
    const groups = /* @__PURE__ */ new Map();
    for (const label of [...allowed.map((e) => e.category), ...all.map((e) => e.category), ...definitions]) {
      const key = categoryKey(label);
      if (key && !groups.has(key)) groups.set(key, { label: categoryLabel(label), members: /* @__PURE__ */ new Set(), count: 0 });
    }
    for (const entry of all) groups.get(categoryKey(entry.category))?.members.add(destinationId(entry));
    for (const entry of allowed) {
      const group = groups.get(categoryKey(entry.category));
      if (group) group.count++;
    }
    const rank = (key) => {
      const index = legacyOrder.indexOf(key);
      return index < 0 ? legacyOrder.length : index;
    };
    return [...groups].map(([key, group]) => ({ key, label: group.label, count: group.count, members: [...group.members].sort() })).sort((a, b) => Number(b.count > 0) - Number(a.count > 0) || rank(a.key) - rank(b.key));
  }
  function readHomeLayout(input2) {
    if (!input2 || typeof input2 !== "object" || Array.isArray(input2)) return null;
    const value = input2;
    if (Object.keys(value).sort().join(",") !== "categories,version" || value.version !== 1 || !Array.isArray(value.categories) || value.categories.length > 4096) return null;
    const keys = /* @__PURE__ */ new Set();
    for (const c of value.categories) {
      if (!c || typeof c !== "object" || Object.keys(c).sort().join(",") !== "collapsed,key,label,members,visible" || typeof c.label !== "string" || !c.label || c.label.length > 64 || categoryLabel(c.label) !== c.label || c.key !== categoryKey(c.label) || keys.has(c.key) || typeof c.visible !== "boolean" || typeof c.collapsed !== "boolean" || !Array.isArray(c.members) || c.members.length > 1e4 || new Set(c.members).size !== c.members.length || c.members.some((id) => !validDestinationId(id))) return null;
      keys.add(c.key);
    }
    return structuredClone(value);
  }
  function reconcileHomeLayout(saved, catalog) {
    if (saved === null) return { version: 1, categories: catalog.map((c) => ({
      key: c.key,
      label: c.label,
      visible: true,
      collapsed: false,
      members: [...c.members]
    })) };
    const current = new Map(catalog.map((c) => [c.key, c])), known = new Set(saved.categories.map((c) => c.key));
    const renamed = /* @__PURE__ */ new Map();
    for (const old of saved.categories) if (!current.has(old.key) && old.members.length) {
      const candidates = catalog.filter((c) => !known.has(c.key) && same(c.members, old.members));
      const competing = saved.categories.filter((c) => !current.has(c.key) && same(c.members, old.members));
      if (candidates.length === 1 && competing.length === 1) renamed.set(old.key, candidates[0]);
    }
    const categories = saved.categories.map((old) => {
      const c = current.get(old.key) ?? renamed.get(old.key);
      return c ? { ...old, key: c.key, label: c.label, members: [...c.members] } : { ...old, members: [...old.members] };
    });
    const retained = new Set(categories.map((c) => c.key));
    const added = catalog.filter((c) => !retained.has(c.key)).sort((a, b) => a.key.localeCompare(b.key, "en"));
    categories.push(...added.map((c) => ({ key: c.key, label: c.label, visible: true, collapsed: false, members: [...c.members] })));
    return { version: 1, categories };
  }
  function changeHomeLayout(layout, key, action, available = layout.categories.map((c) => c.key)) {
    const categories = layout.categories.map((c) => ({ ...c, members: [...c.members] }));
    const index = categories.findIndex((c) => c.key === key);
    if (index < 0) return { version: 1, categories };
    if (action === "VISIBILITY") categories[index].visible = !categories[index].visible;
    else if (action === "COLLAPSE") categories[index].collapsed = !categories[index].collapsed;
    else {
      const order = categories.filter((c) => available.includes(c.key));
      const position = order.findIndex((c) => c.key === key), neighbor = order[position + (action === "UP" ? -1 : 1)];
      if (neighbor) {
        const other = categories.findIndex((c) => c.key === neighbor.key);
        [categories[index], categories[other]] = [categories[other], categories[index]];
      }
    }
    return { version: 1, categories };
  }
  function displayedHomeCategories(layout, catalog) {
    const current = new Map(catalog.map((c) => [c.key, c]));
    return layout.categories.flatMap((c) => c.visible && (current.get(c.key)?.count ?? 0) > 0 ? [{ ...c, count: current.get(c.key).count }] : []);
  }

  // src/ui/dom.ts
  function setProperty(node, key, value) {
    if (node[key] !== value) node[key] = value;
  }
  function setAttribute(node, name, value) {
    if (node.getAttribute(name) === value) return;
    if (value === null) node.removeAttribute(name);
    else node.setAttribute(name, value);
  }
  function reconcileChildren(parent, children) {
    const keep = new Set(children);
    for (const child of [...parent.children]) if (!keep.has(child)) child.remove();
    children.forEach((child, index) => {
      if (parent.children[index] !== child) parent.insertBefore(child, parent.children[index] ?? null);
    });
  }

  // src/ui/home-layout-storage.ts
  var homeLayoutDatabase = "atlas-home-layout-v1";
  async function openHomeLayoutRepository(factory = indexedDB, name = homeLayoutDatabase) {
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
    const decode = (input2) => {
      if (input2 === void 0) return { revision: 0, value: null };
      const record = input2, value = readHomeLayout(record?.value);
      if (!value || Object.keys(record).sort().join(",") !== "revision,value" || !Number.isSafeInteger(record.revision) || record.revision < 1) throw new Error("HOME_LAYOUT_INVALID");
      return { revision: record.revision, value };
    };
    return {
      load: () => new Promise((resolve, reject5) => {
        try {
          const tx = db.transaction("layout", "readonly"), request = tx.objectStore("layout").get("current");
          let envelope;
          request.onsuccess = () => {
            try {
              envelope = decode(request.result);
            } catch (error) {
              reject5(error);
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
        const candidate = readHomeLayout(value);
        if (!candidate || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
          resolve({ type: "FAILED" });
          return;
        }
        try {
          const tx = db.transaction("layout", "readwrite"), store = tx.objectStore("layout"), request = store.get("current");
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
              store.put(envelope, "current");
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

  // src/ui/home-layout-session.ts
  var same2 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var HomeLayoutSession = class {
    constructor(repository, changed = () => {
    }) {
      this.repository = repository;
      this.changed = changed;
    }
    saved = null;
    draft = null;
    busy = false;
    conflict = false;
    failure = null;
    catalog = [];
    refreshing = null;
    current() {
      return reconcileHomeLayout(this.saved?.value ?? null, this.catalog);
    }
    requested() {
      return reconcileHomeLayout(this.draft ?? this.saved?.value ?? null, this.catalog);
    }
    refresh(catalog) {
      this.catalog = catalog;
      if (this.refreshing) return this.refreshing;
      if (this.busy) return this.refreshing ?? Promise.resolve();
      const pending = this.loadLatest(catalog);
      this.refreshing = pending;
      return pending.finally(() => {
        if (this.refreshing === pending) this.refreshing = null;
      });
    }
    async loadLatest(catalog) {
      const initial = this.saved === null;
      if (initial) {
        this.busy = true;
        this.changed();
      }
      try {
        const latest = await this.repository.load();
        if (this.draft && this.saved && latest.revision !== this.saved.revision) {
          if (same2(latest.value, this.draft)) {
            this.saved = latest;
            this.draft = null;
            this.failure = null;
            this.conflict = false;
            this.changed();
          } else if (!this.conflict) {
            this.conflict = true;
            this.changed();
          }
          return;
        }
        if (this.draft) return;
        if (!same2(this.saved, latest)) {
          this.saved = latest;
          this.failure = null;
          this.changed();
        }
        const reconciled = reconcileHomeLayout(latest.value, catalog);
        if (!same2(reconciled, latest.value)) {
          this.draft = reconciled;
          this.busy = true;
          this.changed();
          await this.persist();
        } else if (this.failure === "UNAVAILABLE") {
          this.failure = null;
          this.changed();
        }
      } catch {
        if (this.failure !== "UNAVAILABLE") {
          this.failure = "UNAVAILABLE";
          this.changed();
        }
      } finally {
        if (this.busy) {
          this.busy = false;
          this.changed();
        }
      }
    }
    async change(key, action) {
      if (this.refreshing) await this.refreshing;
      if (this.busy || !this.saved || this.conflict || this.failure === "UNAVAILABLE") return false;
      this.draft = changeHomeLayout(this.requested(), key, action, this.catalog.map((c) => c.key));
      this.busy = true;
      this.changed();
      try {
        return await this.persist();
      } finally {
        this.busy = false;
        this.changed();
      }
    }
    async persist() {
      if (!this.saved || !this.draft || this.conflict) return false;
      try {
        const result = await this.repository.save(this.saved.revision, this.draft);
        if (result.type === "SAVED") {
          this.saved = result.envelope;
          this.draft = null;
          this.failure = null;
          this.conflict = false;
          this.changed();
          return true;
        }
        if (result.type === "CONFLICT") this.conflict = true;
        else this.failure = result.type;
      } catch {
        this.failure = "UNCERTAIN";
      }
      this.changed();
      return false;
    }
    async retry(catalog) {
      if (this.refreshing) await this.refreshing;
      if (this.busy || this.conflict) return false;
      const draft = this.draft;
      this.failure = null;
      await this.refresh(catalog);
      if (!draft || this.draft === null) return this.failure === null && !this.conflict;
      if (this.conflict || !this.saved || this.failure) return false;
      this.busy = true;
      this.changed();
      try {
        return await this.persist();
      } finally {
        this.busy = false;
        this.changed();
      }
    }
    async useSaved(catalog) {
      if (this.refreshing) await this.refreshing;
      if (this.busy) return false;
      this.busy = true;
      try {
        const value = await this.repository.load();
        this.saved = value;
        this.draft = null;
        this.failure = null;
        this.conflict = false;
        this.catalog = catalog;
        this.changed();
        return true;
      } catch {
        this.failure = "UNAVAILABLE";
        this.changed();
        return false;
      } finally {
        this.busy = false;
        this.changed();
      }
    }
  };

  // src/ui/feedback.ts
  function actionFeedback(kind, response) {
    if (!response) return { tone: "uncertain", message: "Atlas could not establish the outcome. Check Policy & recovery before repeating this action." };
    const reason = response.error ?? (response.result?.type === "BLOCKED" || response.result?.type === "REJECTED" ? response.result.reason : void 0);
    if (reason) {
      if (reason === "COMMIT_UNKNOWN") return { tone: "uncertain", message: "Atlas could not verify whether the change was saved. Recover saved state before trying again.", detail: reason };
      const known = {
        CONTENT_REMOVAL_IN_PROGRESS: "Atlas is closing the previous page. Restart will be available in a moment.",
        POLICY_DRAFT_STALE: "Policy changed while this draft was open. Your draft is preserved; review the current policy before proposing it again.",
        PROPOSAL_PENDING: "A saved proposal is already waiting in Vault. Review or cancel it before proposing another change.",
        NO_POLICY_CHANGE: "These terms already match active policy and settings. No proposal was created.",
        PROPOSAL_EXPIRED: "The Vault confirmation window ended. Active policy is unchanged; cancel the expired proposal before preparing a new one.",
        REQUEST_EXPIRED: "The access confirmation window ended. No grant was created; start a new request if needed.",
        PROPOSAL_NOT_FOUND: "That proposal is no longer pending. Review the current Vault state before trying again.",
        ALREADY_COMMITTED: "That proposal has already been committed. Check the current policy; do not confirm it again.",
        POLICY_CHANGED: "Policy changed since these terms were prepared. Review the current policy before starting a new request.",
        CONFIGURATION_CHANGED: "Settings changed since this proposal was prepared. Active settings were preserved; review them before proposing again.",
        INVALID_CANDIDATE_POLICY: "The proposed policy is invalid. Check the exact hostnames; active policy has not changed.",
        NOT_READY: "Confirmation is not available yet. Keep the current request and wait for its confirmation window.",
        EXPIRED: "The confirmation window ended. No new permission was created; start a new request if needed.",
        WRITE_FAILED: "Atlas could not save this action. The requested change was not committed. Your draft is preserved; try again when storage is available.",
        STORAGE_CONFLICT: "Saved state changed during this action. Reload and reconcile state before trying again.",
        STORAGE_UNAVAILABLE: "Atlas could not open saved state. Use Policy & recovery to retry; no new access has been confirmed.",
        INVALID_POLICY: "The proposed policy is invalid. Check the exact hostnames; active policy has not changed."
      };
      return { tone: reason === "CONTENT_REMOVAL_IN_PROGRESS" || reason === "NO_POLICY_CHANGE" ? "status" : "error", message: known[reason] ?? "Atlas could not complete this action. Review the current state and Policy & recovery before trying again.", detail: reason };
    }
    if (response.initialized === false) return { tone: "error", message: "Initial policy was not saved. Check the hostnames; an existing policy cannot be replaced here." };
    if (response.opened === false) return { tone: "error", message: "The tab changed before opening. Check the selected tab before continuing." };
    if (response.result?.type === "COMMITTED") {
      if (["PROPOSE_POLICY", "PROPOSE_SETTINGS", "PROPOSE_CURATED_DEFAULTS"].includes(kind))
        return { tone: "success", message: "Vault proposal saved. Active policy and settings are unchanged. Wait, review, then explicitly confirm." };
      if (kind === "CONFIRM_POLICY") return { tone: "success", message: "Vault change committed. Your confirmed policy and settings are now active." };
      if (kind === "CANCEL_POLICY") return { tone: "success", message: "Vault proposal cancelled. Active policy and settings are unchanged." };
      if (kind === "START_ACCESS") return { tone: "success", message: "Access request saved. Wait, then return to confirm temporary access." };
      if (kind === "CONFIRM_ACCESS") return { tone: "success", message: "Temporary access confirmed and saved. Its original expiry applies." };
      if (kind === "CANCEL_ACCESS") return { tone: "success", message: "Access request cancelled." };
    }
    if (kind === "RECOVER") return response.view?.controller?.status === "READY" ? { tone: "success", message: "Saved state verified. Recovery has not confirmed any proposal or reset your policy." } : { tone: "error", message: "Saved state is still unavailable. Your policy has not been reset. Check the recovery details." };
    return { tone: "status", message: "" };
  }
  function renderFeedback(node, feedback2) {
    if (node.dataset.tone !== feedback2.tone) node.dataset.tone = feedback2.tone;
    const role = feedback2.tone === "error" || feedback2.tone === "uncertain" ? "alert" : "status";
    if (node.getAttribute("role") !== role) node.setAttribute("role", role);
    if (node.getAttribute("aria-atomic") !== "true") node.setAttribute("aria-atomic", "true");
    if (node.textContent !== feedback2.message) node.textContent = feedback2.message;
    if (node.hidden !== (feedback2.message === "")) node.hidden = feedback2.message === "";
  }

  // src/ui/home-organization.ts
  var el = (id) => document.getElementById(id);
  var same3 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function initializeHomeOrganization(changed, repository = () => openHomeLayoutRepository()) {
    let session = null, catalog = [], verified = false;
    let failed = false, opening = false, disposed2 = false, rowsKey = "";
    let storage = null;
    let deferredFocus = null;
    let deferredHeading = null;
    async function open() {
      if (opening || disposed2) return;
      opening = true;
      try {
        storage = await repository();
        if (disposed2) {
          storage.close();
          return;
        }
        session = new HomeLayoutSession(storage, () => {
          if (!disposed2) changed();
        });
        failed = false;
        if (verified) await session.refresh(catalog);
      } catch {
        failed = true;
      } finally {
        opening = false;
        changed();
      }
    }
    function observe(next, available) {
      verified = available;
      if (!same3(catalog, next)) {
        catalog = next;
        if (available) void session?.refresh(catalog);
      } else if (available && session?.saved === null && !session.busy && !session.failure) void session.refresh(catalog);
    }
    const layout = () => session?.current() ?? reconcileHomeLayout(null, catalog);
    async function change(key, action) {
      if (!session) return;
      await session.change(key, action);
      changed();
    }
    function close() {
      setProperty(el("home-customization"), "hidden", true);
      setAttribute(el("customize-home"), "aria-expanded", "false");
      el("customize-home").focus({ preventScroll: true });
    }
    function render2() {
      const focus = document.activeElement;
      const focusCategory = focus?.closest("[data-layout-category]")?.dataset.layoutCategory;
      const focusAction = focus?.dataset.layoutAction;
      const headingCategory = focus?.classList.contains("category-heading") ? focus.closest("[data-category-key]")?.dataset.categoryKey : void 0;
      const working = session?.requested() ?? layout(), available = new Map(catalog.map((c) => [c.key, c]));
      const categories = working.categories.filter((c) => available.has(c.key));
      const key = JSON.stringify(categories);
      if (key !== rowsKey) {
        rowsKey = key;
        const list = el("home-layout-list"), focus2 = document.activeElement;
        const category = focus2?.closest("[data-layout-category]")?.dataset.layoutCategory;
        const action = focus2?.dataset.layoutAction;
        const existing = new Map([...list.children].map((n) => [n.dataset.layoutCategory, n]));
        const rows = categories.map((c) => {
          const row = existing.get(c.key) ?? document.createElement("li");
          setProperty(row.dataset, "layoutCategory", c.key);
          if (!row.children.length) {
            const label = document.createElement("label");
            label.className = "checkbox-label";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            setProperty(checkbox.dataset, "layoutAction", "VISIBILITY");
            checkbox.addEventListener("change", () => void change(row.dataset.layoutCategory, "VISIBILITY"));
            const name = document.createElement("span");
            name.className = "layout-category-name";
            label.append(checkbox, name);
            const controls = document.createElement("span");
            controls.className = "layout-order-actions";
            for (const direction of ["UP", "DOWN"]) {
              const button = document.createElement("button");
              button.type = "button";
              button.className = "secondary compact";
              setProperty(button, "textContent", direction === "UP" ? "\u2191" : "\u2193");
              setProperty(button.dataset, "layoutAction", direction);
              button.addEventListener("click", () => void change(row.dataset.layoutCategory, direction));
              controls.append(button);
            }
            row.append(label, controls);
          }
          setProperty(row.querySelector("input"), "checked", c.visible);
          setProperty(row.querySelector(".layout-category-name"), "textContent", c.label);
          for (const button of row.querySelectorAll("button")) {
            const name = `Move ${c.label} ${button.dataset.layoutAction === "UP" ? "up" : "down"}`;
            setAttribute(button, "aria-label", name);
            setProperty(button, "title", name);
          }
          return row;
        });
        list.replaceChildren(...rows);
        if (category && action) rows.find((r) => r.dataset.layoutCategory === category)?.querySelector(`[data-layout-action="${action}"]`)?.focus({ preventScroll: true });
      }
      const locked = !session?.saved || session.busy || session.conflict || session.failure === "UNAVAILABLE";
      if (locked && session?.busy) {
        if (focusCategory && focusAction) deferredFocus = { category: focusCategory, action: focusAction };
        if (headingCategory) deferredHeading = headingCategory;
      }
      for (const [index, row] of [...el("home-layout-list").children].entries()) {
        const category = available.get(row.dataset.layoutCategory);
        setProperty(row, "title", `${category?.count ?? 0} allowed destinations${category?.count === 0 ? " \xB7 no Home row while empty" : ""}`);
        for (const input2 of row.querySelectorAll("input")) setProperty(input2, "disabled", locked);
        for (const button of row.querySelectorAll("button")) setProperty(button, "disabled", locked || button.dataset.layoutAction === "UP" && index === 0 || button.dataset.layoutAction === "DOWN" && index === categories.length - 1);
      }
      const draft = session?.draft != null;
      setProperty(el("customize-home"), "textContent", draft && !session?.busy ? "Customize Home \xB7 unsaved" : "Customize Home");
      const unavailable = failed || session?.failure === "UNAVAILABLE";
      const message = session?.conflict ? "Another Atlas page saved a newer layout. Your arrangement is retained here. Load the saved layout before making further changes." : unavailable ? "Home preferences could not be verified. Saved policy is unaffected. Retry loading preferences." : session?.failure ? "Your arrangement is not verified as saved. It is retained in this page; retry before closing the page. Home still uses the acknowledged layout." : session?.busy ? session.draft ? "Saving Home layout\u2026" : "Loading Home preferences\u2026" : draft ? "Your arrangement is awaiting a verified save. Home still uses the acknowledged layout." : session?.saved ? "Home layout saved. Hidden categories remain in Sites & Access; pins and search are unchanged." : "Loading Home preferences\u2026";
      renderFeedback(el("home-layout-status"), { message, tone: session?.conflict || session?.failure || failed ? "error" : "status" });
      setProperty(el("home-layout-warning"), "hidden", !unavailable && !session?.failure && !session?.conflict);
      setProperty(el("home-layout-warning"), "textContent", message);
      setProperty(el("retry-home-layout"), "hidden", !failed && !session?.failure);
      setProperty(el("retry-home-layout"), "disabled", opening || session?.busy === true || session?.conflict === true);
      setProperty(el("load-saved-home-layout"), "hidden", !session?.conflict);
      setProperty(el("load-saved-home-layout"), "disabled", session?.busy === true);
      setProperty(el("home-layout-empty"), "hidden", categories.length > 0);
      for (const heading of document.querySelectorAll(".category-heading")) setProperty(heading, "disabled", locked);
      if (!locked) {
        if (document.activeElement === document.body) {
          if (deferredFocus && !el("home-customization").closest("[hidden]")) {
            const row = [...el("home-layout-list").children].find((n) => n.dataset.layoutCategory === deferredFocus.category);
            const target = row?.querySelector(`[data-layout-action="${deferredFocus.action}"]`);
            (target?.disabled ? row?.querySelector("input") : target)?.focus({ preventScroll: true });
          } else if (deferredHeading) [...document.querySelectorAll(".category-heading")].find((h) => h.closest("[data-category-key]")?.dataset.categoryKey === deferredHeading && !h.closest("[hidden]"))?.focus({ preventScroll: true });
        }
        deferredFocus = null;
        deferredHeading = null;
      }
    }
    el("customize-home").addEventListener("click", () => {
      setProperty(el("home-customization"), "hidden", false);
      setAttribute(el("customize-home"), "aria-expanded", "true");
      render2();
      el("home-customization").focus({ preventScroll: false });
    });
    el("close-home-customization").addEventListener("click", close);
    el("home-customization").addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });
    el("retry-home-layout").addEventListener("click", () => {
      void (async () => {
        if (!session) await open();
        else await session.retry(catalog);
        changed();
      })();
    });
    el("load-saved-home-layout").addEventListener("click", () => {
      if (window.confirm("Load the newer saved Home layout? The unsaved arrangement in this page will be discarded. Policy, destinations and pins will remain."))
        void session?.useSaved(catalog).then(changed);
    });
    window.addEventListener("pagehide", () => {
      disposed2 = true;
      storage?.close();
    });
    const initialized = open();
    return { observe, layout, render: render2, change, initialized, refresh: () => verified ? session?.refresh(catalog) : void 0, session: () => session };
  }

  // src/ui/home-access.ts
  function accessLink(view2, requestId, hostnames) {
    const context = view2.contexts.find((c) => c.hostname !== null && hostnames.includes(c.hostname) && c.latest?.type === "ASSESSMENT" && "requestId" in c.latest.decision && c.latest.decision.requestId === requestId);
    return context ? { kind: "CONTEXT", tabId: context.tabId, contextId: context.contextId } : { kind: "OPEN_DESTINATION", url: `https://${hostnames[0]}/` };
  }
  function homeAccessSummary(view2, now) {
    const available = view2 != null && view2.controller != null && ["READY", "LOADING", "COMMITTING"].includes(view2.controller.status) && view2.temporaryAccess != null && view2.pendingAccess != null;
    return {
      available,
      pending: available ? view2.pendingAccess.filter((p) => p.confirmBy > now).map((p) => ({
        ...p,
        // Countdown readiness is display only; the existing workflow asks Core again.
        outcome: now < p.readyAt ? "WAIT" : "REQUIRE_CONFIRMATION",
        link: accessLink(view2, p.requestId, p.hostnames)
      })) : [],
      grants: available ? view2.temporaryAccess.filter((g) => g.expiresAt > now).map((g) => ({ ...g, link: accessLink(view2, g.requestId, g.hostnames) })) : [],
      journeys: available ? view2.contexts.flatMap((context) => context.journey && context.journey.phase !== "ENDED" && context.journey.expiresAt > now ? [{ tabId: context.tabId, contextId: context.contextId, journey: context.journey }] : []) : []
    };
  }

  // src/ui/navigation-state.ts
  var navigationStorageKey = "atlas-page-navigation-v1";
  var emptySitesPosition = () => ({ selection: "", search: "", filter: "ALL", scroll: 0 });
  var emptyNavigationState = () => ({ version: 1, tab: "", sites: emptySitesPosition(), pages: {} });
  function atlasPage(value) {
    return ["home", "sites", "settings", "vault", "access"].includes(value) ? value : null;
  }
  function readNavigationState(input2) {
    if (!input2 || typeof input2 !== "object") return null;
    const s = input2, p = s.sites;
    if (Object.keys(s).sort().join(",") !== "pages,sites,tab,version" || s.version !== 1 || typeof s.tab !== "string" || !/^\d{0,12}$/.test(s.tab) || !p || Object.keys(p).sort().join(",") !== "filter,scroll,search,selection" || typeof p.selection !== "string" || p.selection !== "" && !validDestinationId(p.selection) || typeof p.search !== "string" || p.search.length > 1e3 || !["ALL", "WHITELIST", "BLACKLIST", "MIXED"].includes(p.filter) || !Number.isFinite(p.scroll) || p.scroll < 0 || !s.pages || typeof s.pages !== "object" || Array.isArray(s.pages)) return null;
    for (const [page2, position] of Object.entries(s.pages)) {
      if (!atlasPage(page2) || !position || Object.keys(position).sort().join(",") !== "focus,scroll" || !Number.isFinite(position.scroll) || position.scroll < 0 || typeof position.focus !== "string" || position.focus.length > 100) return null;
    }
    return structuredClone(s);
  }
  function navigationMemory(storage) {
    let current = emptyNavigationState();
    try {
      current = readNavigationState(JSON.parse(storage.getItem(navigationStorageKey) ?? "null")) ?? current;
    } catch {
    }
    return {
      value: () => current,
      save(value) {
        const checked = readNavigationState(value);
        if (!checked) return;
        current = checked;
        try {
          storage.setItem(navigationStorageKey, JSON.stringify(checked));
        } catch {
        }
      }
    };
  }

  // src/ui/verified-view.ts
  async function readVerifiedController(query, pause = () => new Promise((resolve) => setTimeout(resolve, 50))) {
    for (let attempt = 0; attempt < 21; attempt++) {
      let view2;
      try {
        view2 = await query();
      } catch {
        return null;
      }
      if (view2?.status === "READY" && view2.snapshot != null) return view2;
      if (view2 == null || !["LOADING", "COMMITTING"].includes(view2.status) || attempt === 20) return null;
      await pause();
    }
    return null;
  }

  // src/ui/data-view.ts
  function hasCommittedCollection(controller) {
    return controller?.snapshot != null && ["READY", "LOADING", "COMMITTING"].includes(controller.status);
  }
  function collectionPresentation(controller, count, attempted, hasLastVerified) {
    if (hasCommittedCollection(controller)) return { phase: count === 0 ? "EMPTY" : "READY", stale: false, message: "" };
    const loading = !attempted || controller?.status === "LOADING" || controller?.status === "COMMITTING";
    return {
      phase: loading ? "LOADING" : "UNAVAILABLE",
      stale: hasLastVerified,
      message: `${loading ? "Loading verified destinations." : "Destinations are temporarily unavailable. Retry or open Policy & recovery."}${hasLastVerified ? " Showing last verified information; it may be out of date. Browsing actions are unavailable." : ""}`
    };
  }

  // src/ui/presentation-storage.ts
  function savePresentation(source, key, value) {
    let storage;
    try {
      storage = typeof source === "function" ? source() : source;
    } catch {
      return "UNCERTAIN";
    }
    let before;
    try {
      before = storage.getItem(key);
    } catch {
    }
    try {
      storage.setItem(key, value);
      return "SAVED";
    } catch {
      try {
        const after = storage.getItem(key);
        if (after === value) return "SAVED";
        return before !== void 0 && after === before ? "FAILED" : "UNCERTAIN";
      } catch {
        return "UNCERTAIN";
      }
    }
  }

  // src/ui/destination-usage.ts
  var usagePreferencesKey = "atlas-destination-usage-v1";
  var usageHalfLifeMs = 7 * 24 * 60 * 60 * 1e3;
  function readDestinationUsage(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 2e3) return {};
    const usage2 = /* @__PURE__ */ Object.create(null);
    for (const [id, record] of Object.entries(value)) {
      if (!validDestinationId(id) || record === null || typeof record !== "object") return {};
      const item = record;
      if (!Number.isSafeInteger(item.count) || item.count < 1 || !Number.isFinite(item.score) || item.score <= 0 || item.score > 1e6 || !Number.isSafeInteger(item.lastOpenedAt) || item.lastOpenedAt < 0) return {};
      usage2[id] = { count: item.count, score: item.score, lastOpenedAt: item.lastOpenedAt };
    }
    return usage2;
  }
  function usageScore(record, now) {
    return record === void 0 ? 0 : record.score * 2 ** (-Math.max(0, now - record.lastOpenedAt) / usageHalfLifeMs);
  }
  function rankDestinations(entries2, usage2, now) {
    return entries2.map((entry, index) => ({ entry, index })).sort((a, b) => usageScore(usage2[destinationId(b.entry)], now) - usageScore(usage2[destinationId(a.entry)], now) || a.index - b.index).map((item) => item.entry);
  }

  // src/ui/destination-policy.ts
  function commonWwwCounterpart(input2) {
    const host2 = normalizeTarget({ hostname: input2 })?.hostname;
    if (host2 === void 0) return null;
    const base = host2.startsWith("www.") ? host2.slice(4) : host2;
    const parsed = parse(base, { allowPrivateDomains: true });
    if (parsed.isIp || !parsed.isIcann && !parsed.isPrivate || parsed.domain !== base) return null;
    return host2 === base ? `www.${base}` : base;
  }
  function explicitDestinationHosts(hostname2, includeWww, extra) {
    const input2 = [hostname2, ...extra.split(/[\s,]+/).filter(Boolean)];
    const hosts = input2.map((value) => normalizeTarget({ hostname: value })?.hostname);
    if (hosts.some((value) => value === void 0)) return null;
    const counterpart = commonWwwCounterpart(hostname2);
    if (includeWww && counterpart !== null) hosts.push(counterpart);
    const unique = [...new Set(hosts)];
    return unique.length <= 100 ? unique : null;
  }

  // src/ui/destination-draft.ts
  var samePolicy3 = (a, b) => ["whitelist", "blacklist"].every((key) => JSON.stringify([...new Set(a[key])].sort()) === JSON.stringify([...new Set(b[key])].sort()));
  var metadataFingerprint = (entries2) => JSON.stringify(entries2);
  var same4 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var canonicalHosts = (hosts) => Array.isArray(hosts) && hosts.length <= 1e4 && hosts.every((host2) => typeof host2 === "string" && normalizeTarget({ hostname: host2 })?.hostname === host2) && new Set(hosts).size === hosts.length;
  function draftBaseline(snapshot, preferences, pins2) {
    return structuredClone({
      policyRevision: snapshot.policyRevision,
      policy: snapshot.policy,
      metadata: preferences.destinations,
      pins: pins2,
      entries: policyDestinationIndex(snapshot.policy, preferences.destinations).map((entry) => ({
        metadata: {
          id: destinationId(entry),
          label: entry.label,
          category: entry.category,
          primaryHostname: entry.hostname,
          hostnames: entry.hostnames
        },
        classification: "PRESERVE",
        pinned: pinnedDestinations([entry], pins2).length > 0
      }))
    });
  }
  function newDestinationDraft(id, baseline) {
    return { version: 1, id, baseline: structuredClone(baseline), changes: [], editor: null };
  }
  function stageDestination(draft, id, after) {
    const before = draft.changes.find((item) => item.id === id)?.before ?? draft.baseline.entries.find((item) => item.metadata.id === id) ?? null;
    const change = { id, before, after: after ? structuredClone(after) : null };
    const changes = draft.changes.filter((item) => item.id !== id);
    if (before !== null || after !== null) {
      if (!same4(before, after)) changes.splice(Math.min(draft.changes.findIndex((item) => item.id === id) < 0 ? changes.length : draft.changes.findIndex((item) => item.id === id), changes.length), 0, change);
    }
    return { ...draft, changes, editor: null };
  }
  function unstageDestination(draft, id) {
    return { ...draft, changes: draft.changes.filter((item) => item.id !== id), editor: draft.editor?.id === id ? null : draft.editor };
  }
  function assessDraft(draft, baseline) {
    const stale = [];
    if (draft.baseline.policyRevision !== baseline.policyRevision || !samePolicy3(draft.baseline.policy, baseline.policy)) stale.push("Committed policy changed");
    if (metadataFingerprint(draft.baseline.metadata) !== metadataFingerprint(baseline.metadata)) stale.push("Committed destination details changed");
    if (!same4(draft.baseline.pins, baseline.pins)) stale.push("Saved pins changed");
    const conflicts = [];
    const touched = new Set(draft.changes.map((change) => change.id));
    const desired = [...baseline.entries.filter((entry) => !touched.has(entry.metadata.id)), ...draft.changes.flatMap((item) => item.after ? [item.after] : [])];
    const owners = /* @__PURE__ */ new Map();
    for (const item of desired) for (const host2 of item.metadata.hostnames) {
      const other = owners.get(host2);
      if (other && other !== item.metadata.id) {
        conflicts.push({ id: item.metadata.id, message: `${host2} also belongs to ${other}. Edit or remove the conflicting draft item.` });
        conflicts.push({ id: other, message: `${host2} also belongs to ${item.metadata.id}.` });
      }
      owners.set(host2, item.metadata.id);
    }
    const removed = new Set(draft.changes.flatMap((item) => [...item.before?.metadata.hostnames ?? [], ...item.after?.metadata.hostnames ?? []]));
    const whitelist = baseline.policy.whitelist.filter((host2) => !removed.has(host2));
    const blacklist = baseline.policy.blacklist.filter((host2) => !removed.has(host2));
    for (const change of draft.changes) {
      const after = change.after;
      if (!after) continue;
      if (after.classification === "PRESERVE") {
        if (!change.before || !same4([...change.before.metadata.hostnames].sort(), [...after.metadata.hostnames].sort()))
          conflicts.push({ id: change.id, message: "Choose Whitelist or Blacklist when changing exact hostname scope." });
        after.metadata.hostnames.forEach((host2) => {
          if (baseline.policy.whitelist.includes(host2)) whitelist.push(host2);
          if (baseline.policy.blacklist.includes(host2)) blacklist.push(host2);
        });
      } else (after.classification === "WHITELIST" ? whitelist : blacklist).push(...after.metadata.hostnames);
    }
    const candidatePolicy = { whitelist: [...new Set(whitelist)].sort(), blacklist: [...new Set(blacklist)].sort() };
    if (evaluate("draft-validation.example", candidatePolicy).reason === "INVALID_POLICY") conflicts.push({ id: "", message: "Core rejected the complete candidate policy." });
    for (const item of draft.changes) if (item.after?.pinned && !item.after.metadata.hostnames.some((host2) => evaluate({ hostname: host2 }, candidatePolicy).outcome === "ALLOW"))
      conflicts.push({ id: item.id, message: "A Blacklisted destination cannot be pinned on Home." });
    return {
      dirty: draft.changes.length > 0 || draft.editor !== null,
      stale,
      conflicts,
      candidatePolicy: conflicts.length ? null : candidatePolicy,
      policyChanged: !samePolicy3(candidatePolicy, baseline.policy)
    };
  }
  function validateDraftCandidate(draft, baseline, snapshot) {
    if (!readDestinationDraft(draft)) return { dirty: true, stale: [], conflicts: [{ id: "", message: "Local draft is invalid. It cannot be submitted." }], candidatePolicy: null, policyChanged: false };
    const assessment = assessDraft(draft, baseline);
    if (!assessment.candidatePolicy || !assessment.policyChanged || assessment.stale.length || snapshot.vaultState.pendingProposal) return assessment;
    const now = Math.max(snapshot.accessState.lastObservedAt, snapshot.vaultState.lastObservedAt, snapshot.journeyState.lastObservedAt);
    const plan = planAtlasOperation({ kind: "PROPOSE_POLICY", candidatePolicy: assessment.candidatePolicy }, { snapshot, now, configuration: snapshot.configuration });
    return plan.candidateSnapshot ? assessment : {
      ...assessment,
      candidatePolicy: null,
      conflicts: [...assessment.conflicts, { id: "", message: "Core cannot prepare this candidate against the current snapshot." }]
    };
  }
  function reconcileDraft(draft, baseline) {
    const conflicts = [];
    const changes = draft.changes.map((change) => {
      const current = baseline.entries.find((entry) => entry.metadata.id === change.id) ?? null;
      if (!same4(current, change.before)) conflicts.push({ id: change.id, message: "Committed destination details changed. Review current and proposed values, then explicitly accept this result, edit the item or remove it." });
      else if (change.before && !samePolicy3(
        {
          whitelist: draft.baseline.policy.whitelist.filter((h) => change.before.metadata.hostnames.includes(h)),
          blacklist: draft.baseline.policy.blacklist.filter((h) => change.before.metadata.hostnames.includes(h))
        },
        { whitelist: baseline.policy.whitelist.filter((h) => change.before.metadata.hostnames.includes(h)), blacklist: baseline.policy.blacklist.filter((h) => change.before.metadata.hostnames.includes(h)) }
      ))
        conflicts.push({ id: change.id, message: "Committed exact rules changed. Review current and proposed classifications, then explicitly accept this result, edit the item or remove it." });
      return { ...change, before: current };
    });
    const next = { ...draft, baseline: structuredClone(baseline), changes };
    return { draft: next, conflicts: [...conflicts, ...assessDraft(next, baseline).conflicts] };
  }
  function destinationChangeSummary(change, beforePolicy, afterPolicy) {
    const before = change.before, after = change.after;
    const classification2 = (item, policy) => item ? [...new Set(item.metadata.hostnames.map((host2) => evaluate({ hostname: host2 }, policy).outcome === "ALLOW" ? "Whitelist" : evaluate({ hostname: host2 }, policy).outcome === "DENY" ? "Blacklist" : "Greylist"))].join(" / ") : "No explicit rule";
    return [
      after?.metadata.label ?? before?.metadata.label ?? change.id,
      `${before === null ? "Addition" : after === null ? "Removal" : "Modification"} \xB7 ${classification2(before, beforePolicy)} \u2192 ${classification2(after, afterPolicy)}`,
      `Exact hosts: ${before?.metadata.hostnames.join(", ") ?? "(none)"} \u2192 ${after?.metadata.hostnames.join(", ") ?? "(none)"}`,
      ...before && after && before.metadata.label !== after.metadata.label ? [`Name: ${before.metadata.label} \u2192 ${after.metadata.label}`] : [],
      `Category: ${before?.metadata.category ?? "(none)"} \u2192 ${after?.metadata.category ?? "(removed)"} \xB7 Pin: ${before?.pinned ? "Pinned" : "Not pinned"} \u2192 ${after?.pinned ? "Pinned" : "Not pinned"}`
    ];
  }
  function readDestinationDraft(value) {
    if (!value || typeof value !== "object") return null;
    const item = value;
    if (item.version !== 1 || typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(item.id) || !item.baseline || !Number.isSafeInteger(item.baseline.policyRevision) || item.baseline.policyRevision < 0 || !item.baseline.policy || !canonicalHosts(item.baseline.policy.whitelist) || !canonicalHosts(item.baseline.policy.blacklist) || evaluate("draft-validation.example", item.baseline.policy).reason === "INVALID_POLICY" || !Array.isArray(item.baseline.pins) || item.baseline.pins.length > 200 || !item.baseline.pins.every(validDestinationId) || !Array.isArray(item.baseline.metadata) || !Array.isArray(item.baseline.entries) || item.baseline.entries.length > 1e4 || !Array.isArray(item.changes) || item.changes.length > 2e3) return null;
    const validEntry = (entry) => entry !== null && typeof entry === "object" && ["WHITELIST", "BLACKLIST", "PRESERVE"].includes(entry.classification) && typeof entry.pinned === "boolean" && readDestinationPreferences({ version: 1, destinations: [entry.metadata], pending: null }).destinations.length === 1;
    if (!item.baseline.entries.every(validEntry) || new Set(item.baseline.entries.map((e) => e.metadata.id)).size !== item.baseline.entries.length || readDestinationPreferences({ version: 1, destinations: item.baseline.metadata, pending: null }).destinations.length !== item.baseline.metadata.length || item.changes.some((change) => !change || !validDestinationId(change.id) || change.before === null && change.after === null || change.before !== null && (!validEntry(change.before) || change.before.metadata.id !== change.id) || change.after !== null && (!validEntry(change.after) || change.after.metadata.id !== change.id)) || new Set(item.changes.map((c) => c.id)).size !== item.changes.length) return null;
    const expected = policyDestinationIndex(item.baseline.policy, item.baseline.metadata).map((entry) => ({ metadata: {
      id: destinationId(entry),
      label: entry.label,
      category: entry.category,
      primaryHostname: entry.hostname,
      hostnames: entry.hostnames
    }, classification: "PRESERVE", pinned: pinnedDestinations([entry], item.baseline.pins).length > 0 }));
    if (!same4(expected, item.baseline.entries) || item.changes.some((change) => !same4(
      change.before,
      item.baseline.entries.find((entry) => entry.metadata.id === change.id) ?? null
    ))) return null;
    if (item.editor !== null) {
      const e = item.editor;
      if (!e || e.id !== null && !validDestinationId(e.id) || typeof e.name !== "string" || e.name.length > 100 || typeof e.hostname !== "string" || e.hostname.length > 253 || typeof e.category !== "string" || e.category.length > 64 || typeof e.extra !== "string" || e.extra.length > 4e3 || !["WHITELIST", "BLACKLIST", "PRESERVE"].includes(e.access) || typeof e.www !== "boolean" || typeof e.pinned !== "boolean") return null;
    }
    return structuredClone(item);
  }

  // src/ui/draft-storage.ts
  var emptyDestinationWorkspace = () => ({ version: 1, draft: null, receipt: null });
  var draftDatabaseName = "atlas-destination-drafts-v1";
  function readDestinationWorkspace(input2) {
    if (!input2 || typeof input2 !== "object") return null;
    const value = input2;
    if (value.version !== 1 || value.draft !== null && !readDestinationDraft(value.draft)) return null;
    if (value.receipt !== null) {
      const r = value.receipt;
      if (!r || typeof r !== "object") return null;
      const d = readDestinationDraft(r.draft);
      if (!d || d.editor !== null || !d.changes.length || !["POLICY", "DISPLAY"].includes(r.kind) || !["PREPARED", "PROPOSED", "APPLYING", "DONE", "KEPT", "RESOLVED"].includes(r.phase) || !Number.isSafeInteger(r.expectedProposalId) || r.expectedProposalId < 1 || r.proposalId !== null && (!Number.isSafeInteger(r.proposalId) || r.proposalId < 1) || !Number.isSafeInteger(r.baseConfigurationRevision) || r.baseConfigurationRevision < 0 || r.owner !== null && (typeof r.owner !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(r.owner)) || !r.candidatePolicy || !Array.isArray(r.candidatePolicy.whitelist) || !Array.isArray(r.candidatePolicy.blacklist)) return null;
      const candidate = assessDraft(d, d.baseline).candidatePolicy;
      if (!candidate || !samePolicy3(candidate, r.candidatePolicy)) return null;
      if (r.kind === "DISPLAY" && !samePolicy3(d.baseline.policy, r.candidatePolicy)) return null;
    }
    return structuredClone(value);
  }
  async function openDraftRepository(factory = indexedDB, name = draftDatabaseName) {
    const db = await new Promise((resolve, reject5) => {
      const request = factory.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("workspace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject5(new Error("DRAFT_STORAGE_UNAVAILABLE"));
      request.onblocked = () => reject5(new Error("DRAFT_STORAGE_BLOCKED"));
    });
    db.onversionchange = () => db.close();
    const decode = (value) => {
      if (value === void 0) return { revision: 0, value: emptyDestinationWorkspace() };
      const envelope = value;
      const workspace = readDestinationWorkspace(envelope?.value);
      if (!workspace || !Number.isSafeInteger(envelope.revision) || envelope.revision < 1) throw new Error("DRAFT_STORAGE_INVALID");
      return { revision: envelope.revision, value: workspace };
    };
    return {
      load: () => new Promise((resolve, reject5) => {
        try {
          const transaction = db.transaction("workspace", "readonly");
          const request = transaction.objectStore("workspace").get("current");
          let envelope;
          request.onsuccess = () => {
            try {
              envelope = decode(request.result);
            } catch {
              reject5(new Error("DRAFT_STORAGE_INVALID"));
            }
          };
          transaction.oncomplete = () => {
            if (envelope) resolve(envelope);
          };
          transaction.onabort = transaction.onerror = () => reject5(new Error("DRAFT_STORAGE_UNAVAILABLE"));
        } catch {
          reject5(new Error("DRAFT_STORAGE_UNAVAILABLE"));
        }
      }),
      save: (expectedRevision, value) => new Promise((resolve) => {
        if (!readDestinationWorkspace(value) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) {
          resolve({ type: "FAILED" });
          return;
        }
        try {
          const transaction = db.transaction("workspace", "readwrite");
          const store = transaction.objectStore("workspace");
          const request = store.get("current");
          let result = { type: "FAILED" };
          request.onsuccess = () => {
            let current;
            try {
              current = decode(request.result);
            } catch {
              result = { type: "CONFLICT", envelope: null };
              return;
            }
            if (current.revision !== expectedRevision) {
              result = { type: "CONFLICT", envelope: current };
              return;
            }
            const envelope = { revision: current.revision + 1, value: structuredClone(value) };
            store.put(envelope, "current");
            result = { type: "SAVED", envelope };
          };
          transaction.oncomplete = () => resolve(result);
          transaction.onabort = () => resolve({ type: "FAILED" });
          transaction.onerror = () => {
          };
        } catch {
          resolve({ type: "FAILED" });
        }
      }),
      discardInvalid: () => new Promise((resolve) => {
        try {
          const transaction = db.transaction("workspace", "readwrite");
          const store = transaction.objectStore("workspace");
          const request = store.get("current");
          let discarded = false;
          request.onsuccess = () => {
            try {
              decode(request.result);
            } catch {
              store.delete("current");
              discarded = true;
            }
          };
          transaction.oncomplete = () => resolve(discarded);
          transaction.onabort = () => resolve(false);
        } catch {
          resolve(false);
        }
      }),
      close: () => db.close()
    };
  }

  // src/ui/destination-workspace.ts
  var DestinationWorkspaceSession = class {
    constructor(repository, changed) {
      this.repository = repository;
      this.changed = changed;
    }
    value = emptyDestinationWorkspace();
    revision = 0;
    loaded = false;
    unsaved = false;
    conflict = false;
    failure = null;
    loadReason = null;
    queue = Promise.resolve();
    async load() {
      try {
        const envelope = await this.repository.load();
        this.value = envelope.value;
        this.revision = envelope.revision;
        this.loaded = true;
        this.unsaved = this.conflict = false;
        this.failure = this.loadReason = null;
        this.changed();
        return true;
      } catch (error) {
        this.failure = "FAILED";
        this.loadReason = error instanceof Error && error.message === "DRAFT_STORAGE_INVALID" ? "INVALID" : "UNAVAILABLE";
        this.changed();
        return false;
      }
    }
    set(value, explicitRetry = false) {
      this.value = structuredClone(value);
      this.unsaved = true;
      this.changed();
      if (!this.loaded || this.conflict || this.failure && !explicitRetry) return Promise.resolve(false);
      let saved = false;
      const captured = structuredClone(value);
      this.queue = this.queue.then(async () => {
        if (this.conflict || this.failure && !explicitRetry) return;
        const result = await this.repository.save(this.revision, captured);
        if (result.type === "SAVED") {
          this.revision = result.envelope.revision;
          this.failure = null;
          this.unsaved = JSON.stringify(this.value) !== JSON.stringify(captured);
          saved = true;
        } else if (result.type === "CONFLICT") this.conflict = true;
        else this.failure = result.type;
        this.changed();
      }).catch(() => {
        this.failure = "UNCERTAIN";
        this.changed();
      });
      return this.queue.then(() => saved);
    }
    setDraft(draft) {
      return this.set({ ...this.value, draft });
    }
    idle() {
      return this.queue;
    }
    async refresh() {
      if (!this.loaded || this.unsaved || this.failure || this.conflict) return;
      await this.idle();
      if (this.unsaved || this.failure || this.conflict) return;
      const revision = this.revision, value = this.value;
      try {
        const envelope = await this.repository.load();
        if (this.revision !== revision || this.value !== value || this.unsaved || this.failure || this.conflict) return;
        if (envelope.revision === this.revision) return;
        if (this.value.draft !== null) {
          this.conflict = true;
          this.changed();
          return;
        }
        this.value = envelope.value;
        this.revision = envelope.revision;
        this.changed();
      } catch {
        if (this.revision === revision && this.value === value) {
          this.failure = "FAILED";
          this.changed();
        }
      }
    }
    async retry() {
      await this.idle();
      if (!this.loaded || this.conflict) return false;
      return this.set(this.value, true);
    }
  };
  function receiptOutcome(receipt, snapshot) {
    const assessment = assessDraft(receipt.draft, receipt.draft.baseline);
    if (!assessment.candidatePolicy || !samePolicy3(assessment.candidatePolicy, receipt.candidatePolicy)) return "INVALID";
    if (receipt.kind === "DISPLAY") return snapshot.policyRevision === receipt.draft.baseline.policyRevision && samePolicy3(snapshot.policy, receipt.candidatePolicy) ? "COMMITTED" : "INVALID";
    const id = receipt.proposalId ?? receipt.expectedProposalId;
    const proposal = snapshot.vaultState.pendingProposal;
    if (proposal?.id === id && proposal.basePolicyRevision === receipt.draft.baseline.policyRevision && proposal.baseConfigurationRevision === receipt.baseConfigurationRevision && samePolicy3(proposal.candidatePolicy, receipt.candidatePolicy)) return "WAITING";
    if (snapshot.vaultState.lastApplied?.proposalId === id && snapshot.policyRevision === receipt.draft.baseline.policyRevision + 1 && samePolicy3(snapshot.policy, receipt.candidatePolicy)) return "COMMITTED";
    return receipt.proposalId === null ? "UNKNOWN" : "RESOLVED";
  }

  // src/ui/sites.ts
  var element = (id) => document.getElementById(id);
  var input = (id) => element(id);
  var text = (id, value) => {
    if (element(id).textContent !== value) setProperty(element(id), "textContent", value);
  };
  var json = (value) => JSON.stringify(value);
  function initializeSites(options) {
    const newId = options.newId ?? (() => crypto.randomUUID()), owner = newId();
    let preferences = emptyDestinationPreferences(), preferencesAvailable = true, session = null;
    preferences = readPreferences();
    let loadFailure = false, submitting = false, displayFailed = false, legacyFailed = false, disposed2 = false;
    let refreshing = null;
    let displaying = null;
    let entriesKey = "", savedEntries = [];
    let lastPresentationSave = "SAVED";
    const position = options.position ?? emptySitesPosition();
    let selection = position.selection, listKey = "", detailKey = "", batchKey = "", editorKey = "";
    let restoredList = false;
    setProperty(input("sites-search"), "value", position.search);
    setProperty(element("sites-filter"), "value", position.filter);
    const navigation2 = () => ({
      selection,
      search: input("sites-search").value,
      filter: element("sites-filter").value,
      scroll: element("sites-list").scrollTop ?? 0
    });
    const remember = () => options.positionChanged?.(navigation2());
    function focusSelection() {
      const row = [...element("sites-list").querySelectorAll(".site-row")].find((r) => r.dataset.destinationId === selection);
      (row ?? element("add-site")).focus({ preventScroll: true });
    }
    let lastController = null;
    let reconciliation = null, reviewOpen = false;
    const drafts = options.drafts ?? openDraftRepository();
    const initialized = drafts.then(async (repository) => {
      session = new DestinationWorkspaceSession(repository, options.changed);
      loadFailure = !await session.load();
      restoreEditor();
      options.changed();
    }).catch(() => {
      loadFailure = true;
      options.changed();
    });
    function readPreferences() {
      try {
        const saved = readDestinationPreferences(JSON.parse(localStorage.getItem(destinationPreferencesKey) ?? "null"));
        preferencesAvailable = true;
        return saved;
      } catch {
        preferencesAvailable = false;
        return preferences;
      }
    }
    function notice(message, tone = "status") {
      if (disposed2) return;
      renderFeedback(element("site-save-feedback"), { message, tone });
      options.feedback(message, tone);
    }
    const snapshot = () => options.controller()?.status === "READY" ? options.controller()?.snapshot : null;
    const verifiedSnapshot = async () => {
      if (!options.verify) return snapshot();
      try {
        const latest = await options.verify();
        return latest?.status === "READY" ? latest.snapshot : null;
      } catch {
        return null;
      }
    };
    const baseline = (state) => draftBaseline(state, preferences, options.pins());
    const entries2 = () => {
      const policy = (options.controller()?.snapshot ? options.controller() : lastController)?.snapshot?.policy;
      const key = json([policy, preferences.destinations]);
      if (key !== entriesKey) {
        entriesKey = key;
        savedEntries = policy ? policyDestinationIndex(policy, preferences.destinations) : [];
      }
      return savedEntries;
    };
    const classification2 = (entry, policy) => {
      const outcomes = new Set(entry.hostnames.map((hostname2) => evaluate({ hostname: hostname2 }, policy).outcome));
      return outcomes.size > 1 ? "MIXED" : outcomes.has("DENY") ? "BLACKLIST" : outcomes.has("ALLOW") ? "WHITELIST" : "GREYLIST";
    };
    const activeReceipt = () => session?.value.receipt && !["DONE", "KEPT", "RESOLVED"].includes(session.value.receipt.phase) ? session.value.receipt : null;
    function currentEditor() {
      const editor = session?.value.draft?.editor;
      if (!editor) return null;
      return {
        id: editor.id,
        name: input("site-name").value,
        hostname: input("site-hostname").value,
        category: input("site-category").value,
        access: element("site-access").value,
        www: input("site-www").checked,
        extra: input("site-extra").value,
        pinned: input("site-pin").checked
      };
    }
    function restoreEditor() {
      if (disposed2) return;
      const editor = session?.value.draft?.editor;
      if (!editor) {
        setProperty(element("site-draft"), "hidden", true);
        editorKey = "";
        return;
      }
      if (json(editor) === editorKey) return;
      clearFieldError();
      editorKey = json(editor);
      setProperty(element("site-draft"), "hidden", false);
      text("site-draft-title", editor.id ? "Edit destination in local draft" : "Add a destination to your draft");
      setProperty(input("site-name"), "value", editor.name);
      setProperty(input("site-hostname"), "value", editor.hostname);
      setProperty(input("site-category"), "value", editor.category);
      setProperty(element("site-preserve-rules"), "hidden", editor.id === null);
      setProperty(element("site-access"), "value", editor.access);
      setProperty(input("site-www"), "checked", editor.www);
      setProperty(input("site-extra"), "value", editor.extra);
      setProperty(input("site-pin"), "checked", editor.pinned);
      scope();
    }
    function scope(locked = false) {
      const counterpart = commonWwwCounterpart(input("site-hostname").value.trim());
      setProperty(input("site-www"), "disabled", locked || counterpart === null);
      text("site-www-label", counterpart === null ? "No common www counterpart for this hostname" : `Include ${counterpart}`);
      const hosts = explicitDestinationHosts(input("site-hostname").value.trim(), counterpart !== null && input("site-www").checked, input("site-extra").value);
      text("site-scope-preview", hosts ? `Proposed exact hosts: ${hosts.join(", ")}` : "Enter valid exact hostnames. Wildcards are unsupported.");
      const access = element("site-access").value;
      const meaningfulPin = access !== "BLACKLIST" && (access !== "PRESERVE" || hosts?.some((host2) => evaluate({ hostname: host2 }, session.value.draft.baseline.policy).outcome === "ALLOW"));
      setProperty(element("site-pin-field"), "hidden", !meaningfulPin);
      setProperty(input("site-pin"), "disabled", locked || !meaningfulPin);
      setProperty(element("save-site-display"), "hidden", !session?.value.draft?.editor?.id || access !== "PRESERVE");
    }
    function persistEditor() {
      if (!session?.value.draft || submitting || activeReceipt() || session.conflict) return;
      clearFieldError();
      scope();
      const editor = currentEditor();
      if (!editor) return;
      editorKey = json(editor);
      void session.setDraft({ ...session.value.draft, editor });
    }
    function clearFieldError() {
      for (const id of ["site-name", "site-hostname", "site-extra", "site-category"])
        if (input(id).getAttribute("aria-invalid") === "true") setAttribute(input(id), "aria-invalid", "false");
      renderFeedback(element("site-field-error"), { tone: "status", message: "" });
    }
    function begin(id) {
      const state = options.controller()?.snapshot;
      if (!state || !options.canEdit() || !session?.loaded || submitting || activeReceipt() || session.conflict) return;
      if (session.value.draft?.editor) {
        notice("Add or close the current editor first. Your entered values are preserved.");
        input("site-name").focus();
        return;
      }
      const draft = session.value.draft ?? newDestinationDraft(newId(), baseline(state));
      const item = id ? draft.changes.find((c) => c.id === id)?.after ?? draft.baseline.entries.find((e) => e.metadata.id === id) : null;
      const counterpart = commonWwwCounterpart(item?.metadata.primaryHostname ?? "");
      const editor = {
        id: item?.metadata.id ?? null,
        name: item?.metadata.label ?? "",
        hostname: item?.metadata.primaryHostname ?? "",
        category: item?.metadata.category ?? "Your destinations",
        access: item?.classification ?? "WHITELIST",
        www: item?.metadata.hostnames.includes(counterpart ?? "") ?? false,
        extra: item?.metadata.hostnames.filter((h) => h !== item.metadata.primaryHostname && h !== counterpart).join(", ") ?? "",
        pinned: item?.pinned ?? false
      };
      void session.setDraft({ ...draft, editor });
      restoreEditor();
      reviewOpen = false;
      options.changed();
      notice("Editing local draft. Add this change to the batch when ready; active policy is unchanged.");
      input("site-name").focus();
    }
    async function stage(immediateDisplay = false) {
      const state = options.controller()?.snapshot ?? lastController?.snapshot, editor = currentEditor(), draft = session?.value.draft;
      if (!state || !editor || !draft || !session || submitting || session.conflict || activeReceipt()) return;
      const hosts = explicitDestinationHosts(editor.hostname.trim(), commonWwwCounterpart(editor.hostname) !== null && editor.www, editor.extra);
      const invalid = !editor.name.trim() || editor.name.trim().length > 100 ? "site-name" : !explicitDestinationHosts(editor.hostname.trim(), false, "") ? "site-hostname" : !hosts ? "site-extra" : !editor.category.trim() || editor.category.trim().length > 64 ? "site-category" : null;
      if (invalid !== null || !hosts) {
        const messages = {
          "site-name": "Enter a destination name of 1\u2013100 characters.",
          "site-hostname": "Enter an exact primary hostname, such as example.com. URLs and wildcards are unsupported.",
          "site-extra": "Enter valid additional exact hostnames, separated by commas. URLs and wildcards are unsupported.",
          "site-category": "Enter a category of 1\u201364 characters."
        };
        const field = input(invalid ?? "site-hostname");
        setAttribute(field, "aria-invalid", "true");
        renderFeedback(element("site-field-error"), { message: messages[invalid ?? "site-hostname"], tone: "error" });
        const disclosure = field.closest("details");
        if (disclosure) disclosure.open = true;
        field.focus();
        return;
      }
      const suggestions = categorySuggestions(preferences.destinations.map((d) => d.category), draft.changes.flatMap((c) => c.after ? [c.after.metadata.category] : []));
      const id = editor.id ?? `host:${hosts[0]}`;
      const after = {
        metadata: { id, label: editor.name.trim(), category: canonicalCategory(editor.category, suggestions), primaryHostname: hosts[0], hostnames: hosts },
        classification: editor.access,
        pinned: input("site-pin").disabled ? false : editor.pinned
      };
      const staged = stageDestination(draft, id, after);
      if (!await session.setDraft(staged)) {
        session.value = { ...session.value, draft: { ...staged, editor } };
        editorKey = json(editor);
        notice("Draft could not be verified as saved. Your work is retained in this page; retry saving before closing it or submitting.", session.conflict ? "error" : "uncertain");
        options.changed();
        return;
      }
      restoreEditor();
      options.changed();
      queueMicrotask(focusSelection);
      notice("Change added to saved local draft. No Vault wait has started and active policy is unchanged.", "success");
      if (immediateDisplay) {
        reviewOpen = true;
        await submit();
      }
    }
    async function stageRemoval(id) {
      const state = options.controller()?.snapshot;
      if (!state || !session?.loaded || submitting || activeReceipt() || session.conflict) return;
      if (session.value.draft?.editor) {
        notice("Add or close the current editor before staging a removal.");
        return;
      }
      const draft = session.value.draft ?? newDestinationDraft(newId(), baseline(state));
      await session.setDraft(stageDestination(draft, id, null));
      options.changed();
      notice("Removal staged in local draft. Managed Blacklist rules are unchanged.");
    }
    async function submit() {
      if (submitting || !session?.loaded) return;
      await session.idle();
      const state = await verifiedSnapshot(), draft = session.value.draft;
      preferences = readPreferences();
      if (submitting) return;
      if (!state) {
        notice("Saved state could not be verified during preparation. Your draft remains saved. Recover state, then explicitly retry.", "error");
        return;
      }
      if (!options.canEdit() || !preferencesAvailable || !reviewOpen || !draft || draft.editor || !draft.changes.length || session.unsaved || session.failure || session.conflict || activeReceipt()) {
        notice("Finish editing and save the draft before submitting. Resolve any storage conflict or pending display save.", "error");
        return;
      }
      const assessment = validateDraftCandidate(draft, baseline(state), state);
      if (!assessment.candidatePolicy || assessment.stale.length || assessment.conflicts.length) {
        notice("Review and resolve stale data or draft conflicts before submission.", "error");
        return;
      }
      if (assessment.policyChanged && state.vaultState.pendingProposal || preferences.pending) {
        notice("A frozen proposal or display save is already pending. Review the existing Vault proposal first.");
        return;
      }
      submitting = true;
      options.changed();
      const receipt = {
        kind: assessment.policyChanged ? "POLICY" : "DISPLAY",
        draft: structuredClone(draft),
        candidatePolicy: assessment.candidatePolicy,
        expectedProposalId: state.vaultState.nextProposalId,
        proposalId: null,
        baseConfigurationRevision: state.configurationRevision,
        phase: "PREPARED",
        owner: null
      };
      try {
        if (!await session.set({ ...session.value, receipt })) {
          notice("Frozen submission intent could not be saved. No policy command was sent; retry local storage first.", "error");
          return;
        }
        const latest = await verifiedSnapshot();
        preferences = readPreferences();
        if (!latest || !preferencesAvailable || assessDraft(draft, baseline(latest)).stale.length) {
          await session.set({ ...session.value, receipt: { ...receipt, phase: "RESOLVED" } });
          notice(!latest || !preferencesAvailable ? "Saved state could not be verified during preparation. Your draft remains saved. Recover state, then explicitly retry." : "The baseline changed during submission preparation. No policy command was sent. Review the saved draft against current state.", "error");
          return;
        }
        if (!assessment.policyChanged) {
          if (await session.set({ ...session.value, draft: null, receipt: { ...receipt, phase: "PROPOSED" } })) await applyDisplay(false);
          return;
        }
        let response;
        try {
          response = await options.propose({ kind: "PROPOSE_POLICY", candidatePolicy: receipt.candidatePolicy, basePolicyRevision: draft.baseline.policyRevision });
        } catch {
        }
        const proposal = response?.view?.controller?.snapshot?.vaultState.pendingProposal;
        if (response?.result?.type === "COMMITTED" && proposal && samePolicy3(proposal.candidatePolicy, receipt.candidatePolicy)) {
          await session.set({ ...session.value, draft: null, receipt: { ...receipt, phase: "PROPOSED", proposalId: proposal.id } });
          restoreEditor();
          notice("One Vault proposal saved for the complete batch. Active policy is unchanged; wait and explicitly confirm in Vault.", "success");
          options.vault();
        } else if (response?.result?.type === "REJECTED" || response?.result?.type === "BLOCKED" && response.result.reason !== "COMMIT_UNKNOWN" && response.result.status !== "RECONCILING" || response?.error === "POLICY_DRAFT_STALE") {
          await session.set({ ...session.value, receipt: { ...receipt, phase: "RESOLVED" } });
          notice("The batch was not submitted. Your saved draft is preserved; review current state before retrying.", "error");
        } else notice("Proposal submission outcome is uncertain. Frozen intent is saved; check saved authority before another submission. Do not repeat the proposal.", "uncertain");
      } finally {
        submitting = false;
        options.changed();
      }
    }
    async function checkSubmission() {
      if (!session || submitting) return;
      submitting = true;
      options.changed();
      try {
        const response = await options.propose({ kind: "RECOVER" });
        const state = response?.view?.controller?.status === "READY" ? response.view.controller.snapshot : null, receipt = activeReceipt();
        if (!state || !receipt) {
          notice("Saved authority is still unavailable. Frozen submission intent is preserved.", "uncertain");
          return;
        }
        const outcome = receiptOutcome(receipt, state);
        if (outcome === "WAITING" || outcome === "COMMITTED") {
          await session.set({
            ...session.value,
            draft: session.value.draft?.id === receipt.draft.id ? null : session.value.draft,
            receipt: { ...receipt, proposalId: receipt.proposalId ?? receipt.expectedProposalId, phase: "PROPOSED", owner: null }
          }, true);
          notice(outcome === "WAITING" ? "Existing saved proposal found. Review it in Vault; no second proposal was created." : "Policy committed and is active. Retry only accompanying display details.", "success");
        } else if (receipt.proposalId !== null || state.vaultState.nextProposalId === receipt.expectedProposalId) {
          await session.set({ ...session.value, draft: session.value.draft ?? receipt.draft, receipt: { ...receipt, phase: "RESOLVED", owner: null } }, true);
          notice("No matching active proposal or commit remains. Editable batch restored for explicit review; no permission or new wait was created.");
        } else notice("Submission cannot be correlated with current authority. Keep frozen intent and inspect Vault before proceeding.", "uncertain");
      } finally {
        submitting = false;
        options.changed();
      }
    }
    async function keepCurrentDisplay() {
      const receipt = activeReceipt();
      if (!session || !receipt || submitting || session.unsaved || session.failure || session.conflict) return;
      const uncertainIntent = receipt.phase === "PREPARED";
      const state = await verifiedSnapshot();
      const canDiscardIntent = uncertainIntent && state && receiptOutcome(receipt, state) === "UNKNOWN" && !state.vaultState.pendingProposal && state.vaultState.nextProposalId > receipt.expectedProposalId;
      if (receipt.phase !== "APPLYING" && !canDiscardIntent) return;
      const prompt = uncertainIntent ? "Discard this uncorrelated local batch and its remaining display terms? Its historical outcome cannot be established. Current saved policy and display details remain. No proposal will be sent, confirmed or cancelled." : "Keep current display details and discard this batch\u2019s remaining display edits? Committed policy will remain active.";
      if (!window.confirm(prompt)) return;
      submitting = true;
      options.changed();
      try {
        if (uncertainIntent) {
          const response = await options.propose({ kind: "RECOVER" });
          const verified = response?.view?.controller?.status === "READY" ? response.view.controller.snapshot : null;
          if (!verified || verified.vaultState.pendingProposal || receiptOutcome(receipt, verified) !== "UNKNOWN" || verified.vaultState.nextProposalId <= receipt.expectedProposalId) {
            notice("Saved authority is unsettled or a proposal remains. Frozen local intent is preserved; check its outcome and review Vault.", "uncertain");
            return;
          }
        }
        const saved = await session.set({
          ...session.value,
          receipt: { ...receipt, phase: "KEPT", owner: null },
          draft: uncertainIntent && session.value.draft?.id === receipt.draft.id ? null : session.value.draft
        });
        if (!saved) {
          notice("Local discard could not be verified as saved. Retry local storage; saved authority is unchanged.", "uncertain");
          return;
        }
        displayFailed = false;
        restoreEditor();
        notice(uncertainIntent ? "Uncorrelated local batch discarded. Current saved policy and display details kept; no policy command was repeated." : "Remaining display edits discarded. Current saved policy and display details kept.", "success");
      } finally {
        submitting = false;
        options.changed();
      }
    }
    function savePreferences(value) {
      const outcome = lastPresentationSave = savePresentation(() => localStorage, destinationPreferencesKey, json(value));
      if (outcome === "SAVED") {
        preferences = value;
        return true;
      }
      notice(outcome === "FAILED" ? "The display save failed. Retry only display details; saved policy is preserved." : "The display save outcome could not be verified. Retry only display details; saved policy is preserved.", outcome === "FAILED" ? "error" : "uncertain");
      return false;
    }
    function applyDisplay(explicit) {
      if (displaying) return displaying;
      displaying = applyVerifiedDisplay(explicit).finally(() => {
        displaying = null;
        options.changed();
      });
      options.changed();
      return displaying;
    }
    async function applyVerifiedDisplay(explicit) {
      const state = explicit ? await verifiedSnapshot() : snapshot(), receipt = activeReceipt();
      if (!session || !state || !receipt || session.conflict || session.unsaved || session.failure || displayFailed && !explicit) return;
      if (receiptOutcome(receipt, state) !== "COMMITTED" || receipt.phase === "APPLYING" && !explicit) return;
      const claimed = { ...receipt, phase: "APPLYING", owner };
      if (!await session.set({ ...session.value, receipt: claimed })) return;
      const latest = await verifiedSnapshot();
      if (!latest || receiptOutcome(receipt, latest) !== "COMMITTED") {
        displayFailed = true;
        notice("Authority changed during display preparation. Frozen details are retained; verify saved state before retrying.", "error");
        return;
      }
      displayFailed = true;
      const current = readPreferences();
      if (!preferencesAvailable) {
        notice("The display save outcome could not be verified because storage is unavailable. Frozen terms are preserved for retry; saved policy is unaffected.", "uncertain");
        return;
      }
      let destinations = current.destinations;
      for (const change of receipt.draft.changes) {
        const before = receipt.draft.baseline.metadata.find((item) => item.id === change.id) ?? null;
        const saved = destinations.find((item) => item.id === change.id) ?? null, after = change.after?.metadata ?? null;
        if (json(saved) !== json(before) && json(saved) !== json(after) || after && destinations.some((item) => item.id !== change.id && item.hostnames.some((host2) => after.hostnames.includes(host2)))) {
          notice("Policy is preserved, but another page changed these display details. Retry cannot overwrite them. Review the conflicting destination or keep current display details.", "error");
          return;
        }
        destinations = replaceDestinationMetadata(destinations, after, change.id);
      }
      if (!savePreferences({ ...current, destinations })) {
        notice(receipt.kind === "POLICY" ? "Policy committed and is active. Display details could not be verified as saved. Retry only display details and pins; do not resubmit policy." : "Display details could not be verified as saved. Frozen values are preserved for explicit retry; exact access rules are unchanged.", lastPresentationSave === "FAILED" ? "error" : "uncertain");
        return;
      }
      for (const change of receipt.draft.changes) {
        const after = change.after, hosts = [.../* @__PURE__ */ new Set([...change.before?.metadata.hostnames ?? [], ...after?.metadata.hostnames ?? []])];
        const savedPin = pinnedDestinations([{ id: change.id, label: "", category: "", hostname: hosts[0], hostnames: hosts }], options.pins()).length > 0;
        if (savedPin !== (change.before?.pinned ?? false) && savedPin !== (after?.pinned ?? false)) {
          notice("A pin changed elsewhere. Review it before retrying display details.", "error");
          return;
        }
        const result = options.pin(change.id, after?.pinned ?? false, hosts);
        if (result !== "SAVED") {
          notice(receipt.kind === "POLICY" ? "Policy committed and is active. Display details saved, but pins could not be verified. Retry only display details and pins." : "Display details saved, but pins could not be verified. Retry the remaining display save; exact access rules are unchanged.", result === "FAILED" ? "error" : "uncertain");
          return;
        }
      }
      if (!await session.set({ ...session.value, receipt: { ...claimed, phase: "DONE", owner: null }, draft: session.value.draft?.id === receipt.draft.id ? null : session.value.draft })) {
        notice("Display details and pins saved. Completion receipt could not be verified; retry only display cleanup.", "uncertain");
        return;
      }
      displayFailed = false;
      restoreEditor();
      options.changed();
      notice(receipt.kind === "POLICY" ? "Complete batch policy committed. Accompanying display details and pins are saved." : "Display details and pins saved. Exact access rules are unchanged.", "success");
    }
    function legacyDisplay() {
      const state = snapshot();
      if (!state || !preferences.pending || legacyFailed || activeReceipt()) return;
      const pending = preferences.pending, result = reconcileDestinationPreferences(preferences, state);
      if (result.preferences === preferences) return;
      const hosts = pending.destination?.hostnames ?? preferences.destinations.find((d) => d.id === pending.removedId)?.hostnames ?? [];
      if (!savePreferences(result.pinChange ? { ...result.preferences, pending } : result.preferences) || result.pinChange && (options.pin(result.pinChange.id, result.pinChange.pinned, hosts) !== "SAVED" || !savePreferences(result.preferences))) {
        legacyFailed = true;
        notice("Saved legacy policy is preserved. Retry only accompanying display details.", "error");
      } else {
        notice(result.pinChange ? "Policy committed. Accompanying display details and pins saved." : "Resolved pending display terms cleared.", "success");
        options.changed();
      }
    }
    function renderFrozenReview() {
      const state = options.controller()?.snapshot, receipt = session?.value.receipt;
      const matched = receipt?.kind === "POLICY" && state?.vaultState.pendingProposal && (receipt.proposalId ?? receipt.expectedProposalId) === state.vaultState.pendingProposal.id && samePolicy3(receipt.candidatePolicy, state.vaultState.pendingProposal.candidatePolicy);
      const panel = element("vault-destination-review");
      setProperty(panel, "hidden", !matched);
      if (matched) setProperty(element("vault-changes"), "hidden", true);
      const key = matched ? json(receipt) : "";
      if (panel.dataset.review === key) return;
      setProperty(panel.dataset, "review", key);
      element("vault-destination-items").replaceChildren(...(matched ? receipt.draft.changes : []).map((change) => {
        const li = document.createElement("li");
        setProperty(li, "textContent", destinationChangeSummary(change, receipt.draft.baseline.policy, receipt.candidatePolicy).join("\n"));
        return li;
      }));
    }
    function renderBatch(state) {
      const draft = session?.value.draft, receipt = session?.value.receipt;
      const frozen = activeReceipt();
      text("destination-draft-heading", frozen ? "Frozen destination batch" : "Local destination draft");
      text("destination-workspace-kind", !session?.loaded ? loadFailure || session?.loadReason === "INVALID" ? "Local state unavailable" : "Loading local workspace" : frozen ? "Frozen submission" : draft ? "Editable \xB7 no authority" : receipt?.phase === "DONE" ? "Completed local batch" : receipt ? "Resolved local batch" : "No staged changes");
      const workspace = session?.loaded && !draft && !receipt && !session.unsaved && !session.failure && !session.conflict && !loadFailure ? "empty" : "work";
      if (element("destination-draft-panel").dataset.workspace !== workspace) setProperty(element("destination-draft-panel").dataset, "workspace", workspace);
      const current = state ? baseline(state) : draft?.baseline;
      const assessment = draft && current ? state ? validateDraftCandidate(draft, current, state) : assessDraft(draft, current) : null;
      let status = !session?.loaded ? session?.loadReason === "INVALID" ? "Saved local drafts are damaged or incompatible. Submission disabled. Explicitly discard damaged draft data to recover; policy is preserved." : loadFailure ? "Local draft storage unavailable. Saved drafts cannot be verified; submission disabled." : "Loading saved local draft\u2026" : session.conflict ? "Another Atlas window saved a newer draft. Your local work is retained. Explicitly reload the shared draft before continuing." : session.unsaved || session.failure ? "Unsaved local work. Keep this page open and retry saving; recovery is not guaranteed." : draft?.changes.length || draft?.editor ? `Saved editable draft \xB7 ${draft.changes.length} staged changes. No authority or Vault wait.` : "No local changes staged.";
      if (!state && draft) status += " Authoritative state unavailable; draft retained, submission disabled.";
      text("destination-draft-status", status);
      text("destination-draft-stale", assessment?.stale.length ? `Stale draft: ${assessment.stale.join("; ")}. Review reconciliation before submission.` : "");
      setProperty(element("destination-draft-stale"), "hidden", !assessment?.stale.length);
      const conflicts = assessment?.conflicts ?? [], key = json([draft?.changes, conflicts, reviewOpen, reconciliation]);
      if (key !== batchKey) {
        batchKey = key;
        element("destination-draft-items").replaceChildren(...(draft?.changes ?? []).map((change) => {
          const row = document.createElement("li");
          row.className = "draft-item";
          setProperty(row.dataset, "destinationId", change.id);
          const content = document.createElement("div"), lines = destinationChangeSummary(change, draft.baseline.policy, assessment?.candidatePolicy ?? draft.baseline.policy);
          lines.slice(0, reviewOpen ? lines.length : 3).forEach((line, index) => {
            const p = document.createElement(index === 0 ? "strong" : "p");
            setProperty(p, "textContent", line);
            content.append(p);
          });
          conflicts.filter((c) => c.id === change.id).forEach((c) => {
            const p = document.createElement("p");
            setProperty(p, "textContent", c.message);
            p.className = "draft-conflict";
            content.append(p);
          });
          const actions = document.createElement("div");
          actions.className = "actions";
          const edit = document.createElement("button");
          edit.type = "button";
          setProperty(edit, "textContent", change.after ? "Edit staged item" : "Restore / edit");
          edit.className = "secondary compact";
          edit.dataset.draftAction = "EDIT";
          setProperty(edit, "disabled", !state || !!activeReceipt() || !!session?.conflict);
          edit.addEventListener("click", () => begin(change.id));
          const remove = document.createElement("button");
          remove.type = "button";
          setProperty(remove, "textContent", "Remove from draft");
          remove.className = "text-button";
          remove.dataset.draftAction = "REMOVE";
          remove.className = "text-button destructive";
          setProperty(remove, "disabled", !!activeReceipt() || !!session?.conflict);
          remove.addEventListener("click", () => {
            if (session?.value.draft) void session.setDraft(unstageDestination(session.value.draft, change.id));
          });
          const removeRule = document.createElement("button");
          removeRule.type = "button";
          setProperty(removeRule, "textContent", "Stage removal");
          removeRule.className = "text-button";
          setProperty(removeRule, "hidden", change.after === null);
          removeRule.dataset.draftAction = "REMOVE_RULE";
          setProperty(removeRule, "disabled", !!activeReceipt() || !!session?.conflict);
          removeRule.addEventListener("click", () => void stageRemoval(change.id));
          actions.append(edit, remove, removeRule);
          row.append(content, actions);
          return row;
        }));
        element("destination-draft-conflicts").replaceChildren(...conflicts.map((c) => {
          const p = document.createElement("p");
          setProperty(p, "textContent", `${c.id ? `${c.id}: ` : ""}${c.message}`);
          return p;
        }));
        const preview = reconciliation;
        element("draft-reconciliation-items").replaceChildren(...(preview?.draft.changes ?? []).map((change) => {
          const li = document.createElement("li");
          setProperty(li, "textContent", destinationChangeSummary(
            change,
            preview.draft.baseline.policy,
            assessDraft(preview.draft, preview.draft.baseline).candidatePolicy ?? preview.draft.baseline.policy
          ).join("\n"));
          return li;
        }));
        text("draft-reconciliation-conflicts", preview?.conflicts.map((c) => `${c.id}: ${c.message}`).join("\n") ?? "");
      }
      const locked = submitting || !state || !session?.loaded || !!session?.conflict || !!activeReceipt();
      for (const button of element("destination-draft-items").querySelectorAll("[data-draft-action]")) {
        setProperty(button, "disabled", submitting || !!activeReceipt() || !!session?.conflict || button.dataset.draftAction !== "REMOVE" && !state);
      }
      setProperty(element("draft-reconciliation"), "hidden", reconciliation === null);
      setProperty(element("reconcile-destination-draft"), "disabled", locked || !assessment?.stale.length);
      setProperty(element("accept-draft-reconciliation"), "disabled", locked || !reconciliation || assessDraft(reconciliation.draft, reconciliation.draft.baseline).conflicts.length > 0 || reconciliation.draft.editor !== null);
      setProperty(element("review-destination-draft"), "disabled", !draft?.changes.length || draft.editor !== null);
      setProperty(element("submit-destination-draft"), "disabled", locked || !!session?.unsaved || !!session?.failure || !reviewOpen || !assessment?.candidatePolicy || !!assessment.stale.length || !!draft?.editor || !draft?.changes.length || assessment.policyChanged && state?.vaultState.pendingProposal != null || preferences.pending !== null);
      text("submit-destination-draft", assessment?.policyChanged ? "Submit complete batch to Vault" : "Save display changes");
      text("draft-submit-help", activeReceipt() ? "This batch is frozen. Review or cancel it in Vault; resolve pending display saves before editing again." : state?.vaultState.pendingProposal ? "A proposal is already in Vault. Prepare local work freely; a new policy batch cannot replace it." : draft?.editor ? "Add or close the editor before reviewing the batch." : !reviewOpen && draft?.changes.length ? "Review the complete batch before submitting." : assessment?.stale.length ? "Accept a reviewed reconciliation before submission." : conflicts.length ? "Resolve the conflicts above before submission." : assessment?.policyChanged ? "One Vault wait and explicit confirmation protects the whole batch. Managed Blacklist rules remain unchanged." : "Names, categories and pins save directly without a Vault cooldown.");
      setProperty(element("retry-destination-draft"), "hidden", !loadFailure && !session?.unsaved && !session?.failure);
      setProperty(element("discard-damaged-draft"), "hidden", session?.loadReason !== "INVALID");
      setProperty(element("reload-shared-draft"), "hidden", !session?.conflict);
      setProperty(element("discard-destination-draft"), "disabled", submitting || !draft || !!activeReceipt());
      setProperty(element("destination-receipt"), "hidden", !receipt);
      const outcome = receipt && state ? receiptOutcome(receipt, state) : null;
      text("destination-receipt-status", !receipt ? "" : receipt.phase === "DONE" ? "Applied batch: policy (if changed), display details and pins acknowledged." : receipt.phase === "KEPT" ? "Current saved policy and display details kept; remaining local batch terms were discarded." : receipt.phase === "RESOLVED" ? "Proposal resolved without applying accompanying display details. Restore only as an editable draft." : outcome === "COMMITTED" ? receipt.kind === "POLICY" ? "Policy committed and active. Accompanying display details are pending or need retry." : "Display-only save pending; exact access rules are unchanged." : outcome === "WAITING" ? "Frozen Vault proposal saved. Active policy unchanged; waiting or explicit confirmation still required." : "Frozen submission intent. Check saved authority before retrying; no second policy command will be sent.");
      setProperty(element("check-draft-submission"), "hidden", !receipt || ["DONE", "KEPT", "RESOLVED"].includes(receipt.phase));
      setProperty(element("retry-site-save"), "hidden", !legacyFailed && !(receipt?.phase === "APPLYING" || displayFailed));
      const uncorrelated = receipt?.phase === "PREPARED" && outcome === "UNKNOWN" && state && !state.vaultState.pendingProposal && state.vaultState.nextProposalId > receipt.expectedProposalId;
      setProperty(element("restore-submitted-draft"), "hidden", receipt?.phase !== "RESOLVED");
      setProperty(element("keep-current-display"), "hidden", receipt?.phase !== "APPLYING" && !uncorrelated);
      text("keep-current-display", uncorrelated ? "Discard uncorrelated local batch" : "Keep current display details");
      setProperty(element("keep-current-display"), "disabled", submitting || !!session?.unsaved || !!session?.failure || !!session?.conflict);
      setProperty(element("retry-site-save"), "disabled", submitting || displaying !== null || !state || !!session?.failure || !!session?.conflict);
      setProperty(element("check-draft-submission"), "disabled", submitting || !state || !!session?.conflict);
      renderFrozenReview();
      const receiptList = element("destination-receipt-items"), receiptKey = json(receipt);
      if (receiptList.dataset.receipt !== receiptKey) {
        setProperty(receiptList.dataset, "receipt", receiptKey);
        receiptList.replaceChildren(...(receipt?.draft.changes ?? []).map((change) => {
          const li = document.createElement("li");
          setProperty(li, "textContent", destinationChangeSummary(change, receipt.draft.baseline.policy, receipt.candidatePolicy).join("\n"));
          return li;
        }));
      }
    }
    function refresh() {
      if (refreshing) return refreshing;
      if (disposed2 || !session?.loaded || submitting) return Promise.resolve();
      refreshing = session.refresh().then(async () => {
        if (disposed2) return;
        restoreEditor();
        const receipt = activeReceipt(), current = snapshot();
        if (receipt && current && !session.unsaved && !session.failure && !session.conflict) {
          const outcome = receiptOutcome(receipt, current);
          if (outcome === "COMMITTED" && receipt.phase === "PROPOSED") await applyDisplay(false);
          else if (outcome === "RESOLVED" && receipt.phase === "PROPOSED") await session.set({ ...session.value, receipt: { ...receipt, phase: "RESOLVED" } });
        }
      }).finally(() => {
        refreshing = null;
      });
      return refreshing;
    }
    function render2(ready) {
      if (disposed2) return;
      const controller = options.controller();
      if (controller?.status === "READY" && controller.snapshot) lastController = controller;
      const display = controller?.snapshot ?? lastController?.snapshot;
      const presentationState = hasCommittedCollection(controller) ? controller.snapshot : null;
      legacyDisplay();
      const all = entries2(), words = input("sites-search").value.trim().toLowerCase().split(/\s+/).filter(Boolean), filter = element("sites-filter").value;
      const visible = all.filter((entry) => (filter === "ALL" || classification2(entry, display.policy) === filter || filter === "WHITELIST" && entry.hostnames.some((host2) => evaluate({ hostname: host2 }, display.policy).outcome === "ALLOW") || filter === "BLACKLIST" && entry.hostnames.some((host2) => evaluate({ hostname: host2 }, display.policy).outcome === "DENY")) && words.every((word) => `${entry.label} ${entry.category} ${entry.hostnames.join(" ")}`.toLowerCase().includes(word)));
      const phase = collectionPresentation(controller, all.length, options.attempted?.() === true || controller != null, display != null);
      setProperty(element("sites-section").dataset, "phase", phase.phase);
      setProperty(element("sites-recovery"), "hidden", phase.phase !== "UNAVAILABLE");
      text("sites-status", phase.phase === "READY" || phase.phase === "EMPTY" ? `Committed policy \xB7 ${all.length} destinations \xB7 revision ${display.policyRevision}` : phase.message);
      setProperty(element("sites-pending"), "hidden", controller?.snapshot?.vaultState.pendingProposal == null);
      const key = json([visible, display?.policy, session?.value.draft?.changes]);
      if (key !== listKey) {
        listKey = key;
        const list = element("sites-list"), scroll = list.scrollTop ?? 0;
        const focused = document.activeElement, focusId = focused?.dataset.destinationId;
        list.replaceChildren(...visible.map((entry) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "site-row";
          setProperty(button.dataset, "destinationId", destinationId(entry));
          const name = document.createElement("strong");
          setProperty(name, "textContent", entry.label);
          const category = document.createElement("span");
          setProperty(category, "textContent", entry.category);
          category.className = "note";
          const badge = document.createElement("span");
          setProperty(badge, "textContent", classification2(entry, display.policy) === "WHITELIST" ? "Whitelisted" : classification2(entry, display.policy) === "BLACKLIST" ? "Blacklisted" : "Mixed rules");
          badge.className = "pill";
          if (session?.value.draft?.changes.some((c) => c.id === destinationId(entry))) badge.textContent += " \xB7 Draft";
          button.append(name, category, badge);
          setProperty(button, "title", entry.hostnames.join(", "));
          button.addEventListener("click", () => {
            selection = destinationId(entry);
            detailKey = "";
            remember();
            options.changed();
            queueMicrotask(() => {
              const detail2 = element("site-detail");
              if (detail2.hidden || !element("site-draft").hidden) return;
              if (matchMedia("(max-width: 1050px)").matches) detail2.scrollIntoView({ block: "start" });
              detail2.focus({ preventScroll: true });
            });
          });
          return button;
        }));
        list.scrollTop = scroll;
        if (focusId) [...list.querySelectorAll(".site-row")].find((r) => r.dataset.destinationId === focusId)?.focus({ preventScroll: true });
      }
      if (!restoredList && all.length && !element("sites-section").hidden) {
        element("sites-list").scrollTop = position.scroll;
        restoredList = true;
      }
      setProperty(element("sites-empty"), "hidden", visible.length !== 0 || phase.phase === "LOADING" || phase.phase === "UNAVAILABLE");
      const selected2 = all.find((entry) => destinationId(entry) === selection);
      setProperty(element("site-detail"), "hidden", !selected2);
      const detail = json([selected2, display?.policy, options.pins()]);
      if (selected2 && detail !== detailKey) {
        detailKey = detail;
        text("site-detail-title", selected2.label);
        text("site-detail-category", `${selected2.category} \xB7 ${pinnedDestinations([selected2], options.pins()).length ? "Pinned" : "Not pinned"}`);
        element("site-detail-hosts").replaceChildren(...selected2.hostnames.map((hostname2) => {
          const row = document.createElement("li"), result = evaluate({ hostname: hostname2 }, display.policy);
          setProperty(row, "textContent", `${hostname2}${hostname2 === selected2.hostname ? " \xB7 primary" : ""} \xB7 ${result.outcome === "DENY" ? "Blacklisted" : "Whitelisted"}${display.policy.blacklist.includes(hostname2) && display.policy.whitelist.includes(hostname2) ? " (Blacklist overrides Whitelist)" : ""}`);
          return row;
        }));
      }
      const locked = !ready || submitting || !session?.loaded || !!session?.conflict || !!activeReceipt();
      for (const id of ["add-site", "edit-site", "remove-site", "propose-site", "save-site-display"]) setProperty(element(id), "disabled", locked);
      setProperty(element("cancel-site-draft"), "disabled", submitting || !!activeReceipt());
      const editorLocked = submitting || !!activeReceipt() || !!session?.conflict;
      for (const field of element("site-form").querySelectorAll("input, select"))
        if (field.id !== "site-www" && field.id !== "site-pin") setProperty(field, "disabled", editorLocked);
      if (session?.value.draft?.editor) scope(editorLocked);
      for (const row of element("sites-list").querySelectorAll(".site-row")) setAttribute(row, "aria-pressed", String(row.dataset.destinationId === selection));
      const suggestions = categorySuggestions([...all.map((e) => e.category), ...preferences.destinations.map((e) => e.category)], session?.value.draft?.changes.flatMap((c) => c.after ? [c.after.metadata.category] : []) ?? []);
      const categories = element("site-categories"), categoriesKey = json(suggestions);
      if (categories.dataset.categories !== categoriesKey) {
        setProperty(categories.dataset, "categories", categoriesKey);
        categories.replaceChildren(...suggestions.map((label) => {
          const option = document.createElement("option");
          setProperty(option, "value", label);
          return option;
        }));
      }
      renderBatch(presentationState ?? null);
    }
    element("add-site").addEventListener("click", () => begin());
    element("edit-site").addEventListener("click", () => begin(selection));
    element("remove-site").addEventListener("click", () => void stageRemoval(selection));
    element("site-form").addEventListener("submit", (event) => {
      event.preventDefault();
      void stage();
    });
    element("save-site-display").addEventListener("click", () => void stage(true));
    element("cancel-site-draft").addEventListener("click", () => {
      if (session?.value.draft && !activeReceipt() && !submitting) {
        void session.setDraft({ ...session.value.draft, editor: null }).then((saved) => {
          restoreEditor();
          if (saved) {
            notice("Editor closed. Staged changes preserved.");
            queueMicrotask(focusSelection);
          }
        });
      }
    });
    for (const id of ["site-name", "site-hostname", "site-category", "site-access", "site-www", "site-extra", "site-pin"]) element(id).addEventListener("input", persistEditor);
    element("review-destination-draft").addEventListener("click", () => {
      reviewOpen = true;
      options.changed();
      notice("Review the complete local batch below. Nothing has been submitted.");
    });
    element("submit-destination-draft").addEventListener("click", () => void submit());
    element("discard-destination-draft").addEventListener("click", () => {
      if (!session || activeReceipt() || submitting || !window.confirm("Discard this editable draft and entered values? Saved policy and display details will remain.")) return;
      void session.setDraft(null);
      reconciliation = null;
      reviewOpen = false;
      restoreEditor();
      notice("Local draft discarded. Saved policy and display details unchanged.");
    });
    element("retry-destination-draft").addEventListener("click", () => void (async () => {
      if (!session) {
        try {
          session = new DestinationWorkspaceSession(await openDraftRepository(), options.changed);
        } catch {
          notice("Draft storage still cannot be opened. No policy command was sent.", "error");
          return;
        }
      }
      if (!session.loaded) loadFailure = !await session.load();
      else await session.retry();
      restoreEditor();
      options.changed();
    })());
    element("discard-damaged-draft").addEventListener("click", () => void (async () => {
      if (!session || session.loadReason !== "INVALID" || !window.confirm("Discard damaged local draft and display receipt data? These unsaved cosmetic terms will be lost. Active policy, pending Vault proposals and committed display details will remain.")) return;
      if (!await session.repository.discardInvalid?.()) {
        notice("Draft recovery did not discard data. Retry loading; a newer valid draft may have been saved elsewhere.", "error");
        return;
      }
      loadFailure = !await session.load();
      restoreEditor();
      notice("Damaged local draft data discarded. Active policy and saved display details are unchanged.");
    })());
    element("reload-shared-draft").addEventListener("click", () => void (async () => {
      if (!session || !window.confirm("Load the newer shared draft? Unsaved local edits in this window will be discarded.")) return;
      await session.idle();
      await session.load();
      reconciliation = null;
      restoreEditor();
      notice("Newer saved draft loaded. Review it before submission.");
    })());
    element("reconcile-destination-draft").addEventListener("click", () => {
      void (async () => {
        const draft = session?.value.draft, state = await verifiedSnapshot();
        if (!state || !draft || session?.value.draft !== draft) {
          notice("Saved state or the draft changed while checking. Review the current draft before reconciling.", "error");
          return;
        }
        reconciliation = reconcileDraft(draft, baseline(state));
        options.changed();
        notice("Reconciliation preview only. Review current committed values and proposed results, then explicitly accept; no authority changed.");
      })();
    });
    element("accept-draft-reconciliation").addEventListener("click", () => void (async () => {
      const reviewed = reconciliation, state = await verifiedSnapshot();
      if (!state || !session || !reviewed || reviewed !== reconciliation) return;
      const preview = reviewed.draft;
      if (assessDraft(preview, baseline(state)).stale.length || assessDraft(preview, baseline(state)).conflicts.length || preview.editor) {
        notice("Preview is stale or conflicting. Close the editor, resolve conflicts and review reconciliation again.", "error");
        return;
      }
      if (await session.setDraft(preview)) {
        reconciliation = null;
        reviewOpen = true;
        notice("Reviewed reconciliation saved against current state. Submission still needs ordinary Vault waiting and confirmation.");
      }
    })());
    element("retry-site-save").addEventListener("click", () => void (async () => {
      if (legacyFailed) {
        legacyFailed = false;
        legacyDisplay();
      } else await applyDisplay(true);
      options.changed();
    })());
    element("check-draft-submission").addEventListener("click", () => void checkSubmission());
    element("restore-submitted-draft").addEventListener("click", () => {
      const receipt = session?.value.receipt;
      if (!session || receipt?.phase !== "RESOLVED" || session.value.draft) {
        notice("Finish the current draft before restoring a resolved batch.");
        return;
      }
      void session.setDraft(receipt.draft);
      notice("Resolved batch restored as editable work. Review stale baselines; a revised proposal requires a full new wait.");
    });
    element("keep-current-display").addEventListener("click", () => void keepCurrentDisplay());
    element("sites-review-pending").addEventListener("click", options.vault);
    for (const id of ["sites-search", "sites-filter"]) element(id).addEventListener("input", () => {
      render2(options.canEdit());
      remember();
    });
    element("sites-list").addEventListener("scroll", remember, { passive: true });
    window.addEventListener("storage", (event) => {
      if (event.key !== destinationPreferencesKey && event.key !== null) return;
      const before = json([preferences, preferencesAvailable]);
      preferences = readPreferences();
      if (before !== json([preferences, preferencesAvailable])) options.changed();
    });
    window.addEventListener("pagehide", () => {
      disposed2 = true;
    });
    return { render: render2, refresh, metadata: () => preferences.destinations, initialized, idle: async () => {
      await initialized;
      await refreshing;
      await displaying;
      await session?.idle();
    }, session: () => session, renderFrozenReview, navigation: navigation2, focusSelection };
  }

  // src/ui/website-icons.ts
  var maxBytes = 1024 * 1024;
  function publicImageUrl(value, base) {
    try {
      const url = new URL(value, base);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch {
      return null;
    }
  }
  function declaredIconUrls(html, base) {
    const icons = [];
    const head = html.split(/<\/head\s*>/i)[0];
    for (const tag of head.matchAll(/<link\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
      const attributes = /* @__PURE__ */ new Map();
      for (const attribute of tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g))
        attributes.set(attribute[1].toLowerCase(), (attribute[2] ?? attribute[3] ?? attribute[4] ?? "").replaceAll("&amp;", "&"));
      if (!attributes.get("rel")?.toLowerCase().split(/\s+/).some((rel) => ["icon", "apple-touch-icon"].includes(rel))) continue;
      const href = attributes.get("href");
      const url = href ? publicImageUrl(href, base) : null;
      if (url === null) continue;
      const size = Number.parseInt(attributes.get("sizes") ?? "", 10);
      icons.push({ url, size: Number.isFinite(size) ? Math.min(size, 256) : 48 });
    }
    return [...new Set(icons.sort((a, b) => b.size - a.size).map((icon2) => icon2.url))];
  }
  async function limitedBytes(response) {
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > maxBytes || !response.body) return null;
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > maxBytes) {
          await reader.cancel();
          return null;
        }
        chunks.push(next.value);
      }
    } finally {
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
    const prefix = [...bytes.slice(0, 12)].map((byte) => String.fromCharCode(byte)).join("");
    if (prefix.startsWith("\x89PNG\r\n\n")) return "image/png";
    if (prefix.startsWith("\0\0\0")) return "image/x-icon";
    if (prefix.startsWith("GIF87a") || prefix.startsWith("GIF89a")) return "image/gif";
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
    if (prefix.startsWith("RIFF") && prefix.slice(8) === "WEBP") return "image/webp";
    if (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(new TextDecoder().decode(bytes.slice(0, 512)))) return "image/svg+xml";
    return null;
  }
  async function decodesImage(blob) {
    if (typeof Image === "undefined") return true;
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image.naturalWidth > 0 && image.naturalHeight > 0;
    } catch {
      return false;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function loadWebsiteIcon(hostname2, observedIcon, fetcher = fetch) {
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname2)) return null;
    const root = `https://${hostname2}/`;
    let controller = new AbortController();
    let timer = setTimeout(() => {
      controller.abort();
    }, 5e3);
    const options = { credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal };
    const image = async (url) => {
      try {
        const bytes = await limitedBytes(await fetcher(url, options));
        const type = bytes ? imageType(bytes) : null;
        if (!bytes || !type) return null;
        const blob = new Blob([bytes.buffer], { type });
        return await decodesImage(blob) ? blob : null;
      } catch {
        return null;
      }
    };
    let conventional = null;
    try {
      if (observedIcon) {
        const observed = /^data:image\/(?:png|x-icon|vnd\.microsoft\.icon|gif|jpeg|webp|svg\+xml)[;,]/i.test(observedIcon) ? observedIcon : publicImageUrl(observedIcon, root);
        if (observed) {
          const icon2 = await image(observed);
          if (icon2) return icon2;
        }
      }
      try {
        const page2 = await fetcher(root, options);
        const bytes = await limitedBytes(page2);
        if (bytes) for (const url of declaredIconUrls(new TextDecoder().decode(bytes), page2.url || root).slice(0, 4)) {
          const icon2 = await image(url);
          if (icon2) return icon2;
        }
      } catch {
      }
      conventional = await image(new URL("favicon.ico", root).href);
    } finally {
      clearTimeout(timer);
    }
    if (conventional) return conventional;
    if (!hostname2.includes(".") || /^\d+(?:\.\d+){3}$/.test(hostname2) || /\.(?:localhost|local|internal|lan|home|corp|test|example|invalid)$/.test(hostname2)) return null;
    const cached = new URL("https://www.google.com/s2/favicons");
    cached.searchParams.set("domain", hostname2);
    cached.searchParams.set("sz", "64");
    controller = new AbortController();
    options.signal = controller.signal;
    timer = setTimeout(() => {
      controller.abort();
    }, 4e3);
    try {
      return await image(cached.href);
    } finally {
      clearTimeout(timer);
    }
  }

  // src/ui/presentation.ts
  function startupCopy(startup) {
    if (startup?.status !== "FAILED") return "";
    if (startup.stage === "MANAGED_BLACKLIST") return "Atlas could not verify its bundled safety list. Retry startup in Settings. If this continues, obtain a verified signed Atlas update; keep the extension installed to preserve saved state.";
    if (startup.stage === "STORAGE") return "Atlas could not open its saved state. Retry startup in Settings. If this continues, check Firefox storage availability.";
    return "Atlas could not finish startup. Retry startup in Settings. Your saved policy is preserved.";
  }
  function journeyEndCopy(reason) {
    switch (reason) {
      case "UNRELATED_NAVIGATION":
        return "The next navigation could not be linked to your active Journey.";
      case "EXPIRED":
        return "Your Journey reached its fixed time limit.";
      case "HOP_LIMIT":
        return "Your Journey reached its navigation limit.";
      case "CANCELLED":
        return "You ended this Journey.";
      case "POLICY_CHANGED":
      case "INVALID_POLICY":
      case "ROOT_NOT_WHITELISTED":
        return "The policy changed or could no longer authorize this Journey.";
      case "CONTEXT_CLOSED":
        return "The browsing context closed.";
      case "REACHED":
      case "RETURNED":
        return "You reached your destination.";
      case "DESTINATION_CHANGED":
        return "You reached another Whitelisted destination.";
      default:
        return "Your Journey ended.";
    }
  }
  function canQueueOperation(view2) {
    return view2?.status === "READY" || view2?.snapshot != null && (view2.status === "LOADING" || view2.status === "COMMITTING");
  }
  function accessOutcomeLabel(decision) {
    if (!decision) return "No decision";
    return {
      ALLOW: "Allowed",
      DENY: decision.reason === "BLACKLISTED" || decision.reason === "MANAGED_BLACKLISTED" ? "Blocked" : "Unavailable",
      GREYLIST: "Greylist",
      WAIT: "Waiting",
      REQUIRE_CONFIRMATION: "Confirm access"
    }[decision.outcome];
  }
  function accessCopy(decision) {
    if (decision === null) return { title: "Choose a tab", description: "Select a website to see its access status.", tone: "neutral" };
    switch (decision.outcome) {
      case "GREYLIST":
        return { title: "Take a moment before continuing", description: "This site is outside your Pure Whitelist. Start a request, then return to confirm temporary access.", tone: "wait" };
      case "WAIT":
        return { title: "Your waiting period is running", description: "You can leave this page and come back. When the wait ends, you still need to confirm.", tone: "wait" };
      case "REQUIRE_CONFIRMATION":
        return { title: "Ready when you are", description: "Confirm to open the site home with temporary access. Your policy stays the same.", tone: "ready" };
      case "DENY":
        return { title: decision.reason === "BLACKLISTED" || decision.reason === "MANAGED_BLACKLISTED" ? "This site is blocked" : "Access is unavailable", description: decision.reason === "BLACKLISTED" ? "Your Blacklist prevents access to this destination." : decision.reason === "MANAGED_BLACKLISTED" ? "The managed StevenBlack list blocks this destination. Temporary access and Journey cannot override it." : "Atlas could not authorize this navigation. Check the decision details below.", tone: decision.reason === "BLACKLISTED" || decision.reason === "MANAGED_BLACKLISTED" ? "blocked" : "unavailable" };
      case "ALLOW":
        return { title: "You can continue", description: decision.reason === "WHITELISTED" ? "This destination is in your Pure Whitelist." : decision.reason === "ACTIVE_JOURNEY" ? "This navigation is covered by your current Journey. Its original deadline still applies." : "Temporary access is active. This site remains Greylist.", tone: "ready" };
    }
  }
  function countdown(deadline, now) {
    const seconds2 = Math.max(0, Math.ceil((deadline - now) / 1e3));
    return `${Math.floor(seconds2 / 60)}:${String(seconds2 % 60).padStart(2, "0")}`;
  }
  function selectedContext(contexts, selected2) {
    return contexts.find((context) => String(context.tabId) === selected2);
  }
  function selectedAccessRecord(decision, state, hostname2) {
    let pending;
    let grant;
    if (state != null && hostname2 != null && decision != null) {
      if ((decision.outcome === "WAIT" || decision.outcome === "REQUIRE_CONFIRMATION") && decision.target.hostname === hostname2) {
        pending = state.pendingRequests.find((request) => request.id === decision.requestId && (request.scopeHostnames ?? [request.hostname]).includes(hostname2));
      } else if (decision.outcome === "ALLOW" && decision.reason === "ACTIVE_GRANT" && decision.target.hostname === hostname2) {
        grant = state.grants.find((entry) => entry.requestId === decision.requestId && (entry.scopeHostnames ?? [entry.hostname]).includes(hostname2));
      }
    }
    return { pending, grant };
  }

  // src/ui/settings-model.ts
  function seconds(milliseconds) {
    const digits = String(milliseconds);
    const whole = digits.length > 3 ? digits.slice(0, -3) : "0";
    const fraction = digits.slice(-3).padStart(3, "0").replace(/0+$/, "");
    return fraction === "" ? whole : `${whole}.${fraction}`;
  }
  var timingFields = [
    { id: "access-wait", label: "Greylist wait", unit: "seconds", value: (config) => seconds(config.accessTiming.waitMs) },
    { id: "access-window", label: "Greylist confirmation", unit: "seconds", value: (config) => seconds(config.accessTiming.confirmationWindowMs) },
    { id: "grant-duration", label: "Temporary access", unit: "seconds", value: (config) => seconds(config.accessTiming.grantDurationMs) },
    { id: "vault-wait", label: "Vault wait", unit: "seconds", value: (config) => seconds(config.vaultTiming.waitMs) },
    { id: "vault-window", label: "Vault confirmation", unit: "seconds", value: (config) => seconds(config.vaultTiming.confirmationWindowMs) },
    { id: "journey-lifetime", label: "Journey lifetime", unit: "seconds", value: (config) => seconds(config.journeyLimits.lifetimeMs) },
    { id: "journey-hops", label: "Journey limit", unit: "hops", value: (config) => String(config.journeyLimits.maxHops) }
  ];
  function settingsCopy(config) {
    return timingFields.map((field) => `${field.label}: ${field.value(config)} ${field.unit}`).join(" \xB7 ");
  }
  function decimalInteger(value, decimalShift) {
    const parts = value.trim().match(/^\+?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
    if (parts === null) return NaN;
    const whole = parts[1] ?? "";
    const fraction = parts[2] ?? "";
    if (whole === "" && fraction === "") return NaN;
    const digits = `${whole}${fraction}`.replace(/^0+/, "");
    if (digits === "") return 0;
    const shift = Number(parts[3] ?? "0") + decimalShift - fraction.length;
    if (!Number.isSafeInteger(shift)) return NaN;
    if (shift >= 0) return digits.length + shift > 16 ? NaN : Number(digits) * 10 ** shift;
    const kept = digits.length + shift;
    return kept > 0 && !/[1-9]/.test(digits.slice(kept)) ? Number(digits.slice(0, kept)) : NaN;
  }
  function configurationFromDraft(draft) {
    const milliseconds = (id) => decimalInteger(draft[id], 3);
    return readConfiguration({
      accessTiming: { waitMs: milliseconds("access-wait"), confirmationWindowMs: milliseconds("access-window"), grantDurationMs: milliseconds("grant-duration") },
      vaultTiming: { waitMs: milliseconds("vault-wait"), confirmationWindowMs: milliseconds("vault-window") },
      journeyLimits: { lifetimeMs: milliseconds("journey-lifetime"), maxHops: decimalInteger(draft["journey-hops"], 0) }
    });
  }

  // src/ui/refresh-loop.ts
  var RefreshLoop = class {
    constructor(refresh, options) {
      this.refresh = refresh;
      this.options = options;
    }
    timer = null;
    running = null;
    requested = false;
    active = false;
    disposed = false;
    setActive(active) {
      if (this.disposed || this.active === active) return;
      this.active = active;
      if (active) void this.request();
      else {
        this.clear();
        this.requested = false;
      }
    }
    request() {
      if (!this.active || this.disposed) return Promise.resolve();
      this.clear();
      if (this.running) {
        this.requested = true;
        return this.running;
      }
      const pending = Promise.resolve().then(this.refresh).finally(() => {
        this.running = null;
        if (!this.active || this.disposed) return;
        if (this.requested) {
          this.requested = false;
          void this.request();
        } else this.timer = (this.options.schedule ?? setTimeout)(() => {
          this.timer = null;
          void this.request();
        }, this.options.delay());
      });
      this.running = pending;
      return pending;
    }
    clear() {
      if (this.timer !== null) (this.options.cancel ?? clearTimeout)(this.timer);
      this.timer = null;
    }
    dispose() {
      this.disposed = true;
      this.active = false;
      this.requested = false;
      this.clear();
    }
  };

  // src/ui/vault-presentation.ts
  function matchingReview(controller, review) {
    const state = controller?.snapshot, proposal = state?.vaultState.pendingProposal;
    if (!state || !proposal || !review || !["READY", "COMMITTING", "LOADING"].includes(controller.status)) return null;
    return review.proposalId === proposal.id && review.basePolicyRevision === state.policyRevision && review.baseConfigurationRevision === state.configurationRevision && review.createdAt === proposal.createdAt && review.readyAt === proposal.readyAt && review.confirmBy === proposal.confirmBy && JSON.stringify(review.candidatePolicy) === JSON.stringify(proposal.candidatePolicy) && JSON.stringify(review.candidateConfiguration) === JSON.stringify(proposal.candidateConfiguration) ? review : null;
  }
  function needsPolicyReview(controller, review, now) {
    if (controller?.status !== "READY" || !controller.snapshot?.vaultState.pendingProposal) return false;
    const matched = matchingReview(controller, review);
    return !matched || matched.phase === "WAITING" && now >= matched.readyAt || matched.phase === "READY" && now >= matched.confirmBy;
  }

  // src/ui/main.ts
  var element2 = (id) => document.getElementById(id);
  var text2 = (id, value) => {
    const node = element2(id);
    if (node.textContent !== value) setProperty(node, "textContent", value);
  };
  var select = element2("context");
  var params = new URL(location.href).searchParams;
  var navigation = navigationMemory({ getItem: (key) => sessionStorage.getItem(key), setItem: (key, value) => sessionStorage.setItem(key, value) });
  var selected = params.get("tab") ?? navigation.value().tab;
  var view = null;
  var lastVerifiedPolicy;
  var queryAttempted = false;
  var busy = false;
  var disposed = false;
  var epoch = 0;
  var preparingScopes = /* @__PURE__ */ new Set();
  var optionsKey = "";
  var destinationsKey = "";
  var diagnosticKey = "";
  var diagnosticEpoch = 0;
  var diagnosticRequest = null;
  var policyReview = null;
  var policyReviewError = "";
  var page = atlasPage(location.hash.slice(1)) ?? (params.get("view") === "access" ? "access" : "home");
  var section = page === "vault" ? "settings" : page === "access" ? "home" : page;
  var accessFocused = page === "access";
  var settingsKey = "";
  var displayedProposalId = null;
  var entries = [];
  var matches = [];
  var searchKey = "";
  var searchInputsKey = "";
  var highlighted = -1;
  var pinsStorageKey = "atlas-home-pins-v1";
  var pins = [];
  var pinsLoaded = false;
  var savingPins = false;
  var pinnedKey = "";
  var reviewKey = "";
  var temporaryRows = /* @__PURE__ */ new Map();
  var homeCatalog = [];
  var layoutDirty = true;
  var usage = {};
  var expandedCategories = /* @__PURE__ */ new Set();
  var homeGroups = /* @__PURE__ */ new Map();
  var searchInput = element2("destination-search");
  var websiteIcons = /* @__PURE__ */ new Map();
  var observedIcons = /* @__PURE__ */ new Map();
  var iconSnapshot = browser.tabs.query({}).then((tabs) => {
    for (const tab of tabs) if (tab.url && tab.favIconUrl) {
      try {
        const hostname2 = new URL(tab.url).hostname;
        if (!observedIcons.has(hostname2)) observedIcons.set(hostname2, tab.favIconUrl);
      } catch {
      }
    }
  }).catch(() => {
  });
  var iconObserver = new IntersectionObserver((changes) => {
    for (const change of changes) if (change.isIntersecting) {
      iconObserver.unobserve(change.target);
      const image = change.target;
      void displayWebsiteIcon(image, image.dataset.hostname);
    }
  }, { rootMargin: "160px" });
  var presetHostnames = compileCuratedWhitelist().whitelist;
  var buildVersion = document.createElement("p");
  buildVersion.id = "build-version";
  buildVersion.className = "note";
  setProperty(buildVersion, "textContent", `Atlas extension ${browser.runtime.getManifest().version}`);
  element2("diagnostics").append(buildVersion);
  element2("diagnostics").append(element2("startup-diagnostic"));
  element2("diagnostics").append(element2("action-diagnostic"));
  setProperty(document.body.dataset, "mode", params.get("view") === "access" ? "access" : "control");
  element2("preset-preview").replaceChildren(...curatedWhitelist.map((group) => {
    const detail = document.createElement("details");
    detail.className = "preset-group";
    const summary = document.createElement("summary");
    setProperty(summary, "textContent", group.label);
    const content = document.createElement("p");
    setProperty(content, "textContent", group.services.map((service) => service.label).join(" \xB7 "));
    detail.append(summary, content);
    return detail;
  }));
  if (document.body.dataset.mode === "access") {
    setProperty(element2("page-title"), "textContent", "A moment for your next step.");
    setProperty(element2("page-description"), "textContent", "Your destination is waiting. You decide whether to continue.");
  }
  function feedback(message, tone = "status") {
    renderFeedback(element2("feedback"), { message, tone });
    syncSiteFeedback();
  }
  function syncSiteFeedback() {
    const local = element2("site-save-feedback"), global = element2("feedback");
    setProperty(local, "hidden", !local.textContent || section !== "sites" || !global.hidden && local.textContent === global.textContent);
  }
  async function send(command) {
    if (busy) return;
    busy = true;
    ++epoch;
    render();
    try {
      const response = await browser.runtime.sendMessage(command);
      if (response?.view) view = response.view;
      policyReview = matchingReview(view?.controller, policyReview);
      policyReviewError = "";
      if (response?.tabId !== void 0 && (response?.result?.type === "COMMITTED" || response?.opened === true)) selected = String(response.tabId);
      const result = actionFeedback(command.kind, response);
      renderFeedback(element2("feedback"), result);
      text2("action-diagnostic", result.detail ? `Last action: ${result.detail}` : "");
      return response;
    } catch {
      view = null;
      queryAttempted = true;
      const result = actionFeedback(command.kind, void 0);
      renderFeedback(element2("feedback"), result);
    } finally {
      busy = false;
      ++epoch;
      render();
    }
  }
  function prepareScope(context) {
    const key = `${context.contextId}:${context.navigationId}:${view?.controller?.snapshot?.policyRevision}`;
    if (preparingScopes.has(key)) return;
    preparingScopes.add(key);
    const ticket = epoch;
    void browser.runtime.sendMessage({ kind: "PREPARE_ACCESS", tabId: context.tabId }).then((response) => {
      const current = selectedContext(view?.contexts ?? [], selected);
      if (ticket === epoch && current?.contextId === context.contextId && current.navigationId === context.navigationId && response?.view) {
        view = response.view;
        render();
      }
    }).catch(() => {
    }).finally(() => {
      preparingScopes.delete(key);
    });
  }
  var sites = initializeSites({
    controller: () => view?.controller,
    pins: () => pins,
    propose: send,
    vault: () => navigate2("vault", true),
    feedback,
    canEdit: () => !busy && canQueueOperation(view?.controller),
    attempted: () => queryAttempted,
    changed: () => queueMicrotask(render),
    position: navigation.value().sites,
    positionChanged: (position) => navigation.save({ ...navigation.value(), sites: position }),
    verify: () => readVerifiedController(async () => {
      const ticket = ++epoch;
      const response = await browser.runtime.sendMessage({ kind: "GET_VIEW" });
      if (!response?.view || ticket !== epoch) return null;
      view = response.view;
      ++epoch;
      return view.controller;
    }),
    pin: (id, pinned, hosts) => {
      try {
        pins = readPins(JSON.parse(localStorage.getItem(pinsStorageKey) ?? "null"));
      } catch {
        return "UNCERTAIN";
      }
      const next = updateDestinationPin(pins, id, pinned, hosts);
      if (next.length > 200) {
        feedback("You can pin up to 200 destinations.", "error");
        return "FAILED";
      }
      const saved = savePresentation(() => localStorage, pinsStorageKey, JSON.stringify(next));
      if (saved === "SAVED") {
        pins = next;
        return saved;
      }
      feedback(saved === "UNCERTAIN" ? "The pin save outcome could not be verified. Saved policy is unaffected." : "Your pin could not be saved. Saved policy is unaffected.", saved === "UNCERTAIN" ? "uncertain" : "error");
      return saved;
    }
  });
  var homeOrganization = initializeHomeOrganization(() => queueMicrotask(render));
  var restoredPage = false;
  function render() {
    if (disposed) return;
    const focused = document.activeElement;
    text2("page-title", section === "settings" ? "Settings" : section === "sites" ? "Sites & Access" : accessFocused ? "Destination access" : "Atlas");
    text2("page-eyebrow", section === "settings" ? "YOUR SAVED COMMITMENTS" : section === "sites" ? "YOUR COMMITTED DESTINATIONS" : accessFocused ? "A DELIBERATE NEXT STEP" : "YOUR INTERNET, WITH INTENTION");
    text2("page-description", section === "settings" ? "Intentional friction and the timing of your commitments." : section === "sites" ? "Prepare destination changes together. Review freely; confirm protected changes in Vault." : accessFocused ? "Review the selected destination and its current access." : "A place for the things you choose.");
    setProperty(document.body.dataset, "section", section);
    setProperty(document.body.dataset, "mode", accessFocused ? "access" : "control");
    const controller = view?.controller;
    const ready = canQueueOperation(controller);
    const status = controller?.status;
    const startupMessage = startupCopy(view?.startup);
    text2("startup-warning", startupMessage);
    setProperty(element2("startup-warning"), "hidden", startupMessage === "");
    text2("status", busy ? status === "COMMITTING" ? "Saving\u2026" : "Working\u2026" : ready ? "Atlas is ready" : status === "UNINITIALIZED" ? "Setup needed" : status === "RECONCILING" ? "Recovery needed" : status === "UNAVAILABLE" ? "State unavailable" : view?.startup.status === "FAILED" ? "Startup failed" : queryAttempted && view === null ? "Atlas is unavailable" : "Connecting\u2026");
    setProperty(element2("status"), "title", element2("status").textContent ?? "");
    if (element2("status").dataset.ready !== String(ready)) setProperty(element2("status").dataset, "ready", String(ready));
    setProperty(element2("setup"), "hidden", status !== "UNINITIALIZED");
    setProperty(element2("workspace"), "hidden", status === "UNINITIALIZED" || section !== "home");
    setProperty(element2("settings"), "hidden", section !== "settings");
    setProperty(element2("sites-section"), "hidden", section !== "sites");
    setProperty(element2("destinations"), "hidden", accessFocused);
    for (const name of ["home", "sites", "settings"]) {
      const button = element2(`show-${name}`);
      setAttribute(button, "aria-pressed", String(section === name));
      if (section === name) setAttribute(button, "aria-current", "page");
      else setAttribute(button, "aria-current", null);
    }
    setProperty(element2("save-setup"), "disabled", busy || status !== "UNINITIALIZED");
    const contexts = view?.contexts.filter((context2) => context2.hostname !== null) ?? [];
    if (selected === "" && contexts.length > 0) selected = String(contexts[0].tabId);
    const context = selectedContext(contexts, selected);
    const choices = contexts.map((item) => ({ value: String(item.tabId), text: `Tab ${item.tabId} \xB7 ${item.hostname}` }));
    if (context === void 0) choices.unshift({ value: selected, text: selected === "" ? "No websites yet" : `Tab ${selected} is closed or unavailable` });
    const key = JSON.stringify(choices);
    if (optionsKey !== key) {
      optionsKey = key;
      select.replaceChildren(...choices.map(({ value, text: text3 }) => new Option(text3, value)));
    }
    setProperty(select, "value", selected);
    const result = context?.latest;
    const decision = result?.type === "ASSESSMENT" ? result.decision : null;
    const copy = accessCopy(decision);
    const tone = !ready && context !== void 0 ? "unavailable" : copy.tone;
    if (element2("access-panel").dataset.tone !== tone) setProperty(element2("access-panel").dataset, "tone", tone);
    text2("hostname", context?.hostname ?? (selected === "" ? "Your next destination" : "Tab unavailable"));
    text2("access-title", !ready && context !== void 0 ? "Waiting for verified state" : copy.title);
    text2("access-description", !ready && context !== void 0 ? "Access stays paused until Atlas can verify its saved state." : copy.description);
    text2("outcome", !ready && context !== void 0 ? "Unverified" : accessOutcomeLabel(decision));
    text2("decision", decision ? `${decision.outcome} \xB7 ${decision.reason}` : result ? `${result.type}${"reason" in result ? ` \xB7 ${result.reason}` : ""}` : "No current assessment.");
    text2("context-detail", context ? `Context: ${context.contextId}
Navigation: ${context.navigationId}
Content: ${context.effect}${context.journey?.phase === "ENDED" ? `
Journey ${context.journey.id}: ${context.journey.endReason}` : ""}` : "");
    const now = Date.now();
    text2("deadline", decision?.outcome === "WAIT" ? `Wait ${countdown(decision.readyAt, now)}` : decision?.outcome === "REQUIRE_CONFIRMATION" ? `Confirm within ${countdown(decision.confirmBy, now)}` : decision && "expiresAt" in decision ? `Access remaining ${countdown(decision.expiresAt, now)}` : "");
    const failedRemoval = context?.effect === "FAILED";
    setProperty(element2("effect-warning"), "hidden", !failedRemoval);
    text2("effect-warning", failedRemoval ? "Firefox could not remove the document. Close the affected tab." : "");
    const { pending, grant } = selectedAccessRecord(decision, controller?.snapshot?.accessState, context?.hostname);
    const record = pending ?? grant;
    const preparedScope = context?.accessScope;
    const scope = record === void 0 ? preparedScope?.status === "READY" ? preparedScope.hostnames : [] : record.scopeHostnames ?? [record.hostname];
    const showScope = scope.length > 0 && (decision?.outcome === "GREYLIST" || decision?.outcome === "WAIT" || decision?.outcome === "REQUIRE_CONFIRMATION" || decision?.reason === "ACTIVE_GRANT");
    setProperty(element2("access-scope"), "hidden", !showScope);
    text2("access-scope", showScope ? `Temporary access covers exactly: ${scope.join(", ")}` : "");
    const preparing = decision?.outcome === "GREYLIST" && preparedScope?.status !== "READY";
    setProperty(element2("access-scope-note"), "hidden", decision?.outcome !== "GREYLIST");
    text2("access-scope-note", preparing ? "Checking the public site address before preparing your request\u2026" : preparedScope?.source === "CANONICAL_REDIRECT" ? "The site redirects between these addresses. Both will share one wait and one access deadline." : "Only the exact hostnames shown are covered. Other addresses may need a separate request.");
    if (preparing && ready && context !== void 0 && accessFocused && section === "home") prepareScope(context);
    const journey = context?.journey;
    const activeJourney = ready && journey != null && journey.phase !== "ENDED" && now < journey.expiresAt;
    setProperty(element2("access-panel"), "hidden", !accessFocused);
    setProperty(element2("home-journey"), "hidden", section !== "home" || accessFocused || !activeJourney);
    text2("home-journey-label", activeJourney ? `${serviceLabel(journey.rootHostname)} \xB7 Tab ${context.tabId} \xB7 ${countdown(journey.expiresAt, now)} remaining` : "");
    setProperty(element2("show-access"), "hidden", section !== "home" || accessFocused || context === void 0 || activeJourney);
    const action = (id, show) => {
      setProperty(element2(id), "hidden", !show);
      const button = element2(id);
      const disabled = busy || !ready || context === void 0;
      if (button.disabled !== disabled) setProperty(button, "disabled", disabled);
    };
    action("start-access", decision?.outcome === "GREYLIST");
    if (preparing) setProperty(element2("start-access"), "disabled", true);
    text2("start-access", preparing ? "Checking address\u2026" : "Request temporary access");
    action("confirm-access", decision?.outcome === "REQUIRE_CONFIRMATION");
    action("cancel-access", pending !== void 0);
    action("open-home", decision?.outcome === "ALLOW");
    action("start-journey", decision?.reason === "WHITELISTED" && !activeJourney);
    action("cancel-journey", activeJourney);
    const retry = context?.retry;
    const showRetry = retry != null && decision?.outcome !== "ALLOW" && ready;
    setProperty(element2("ended-journey"), "hidden", !showRetry);
    text2("ended-journey-copy", showRetry ? context?.effect === "REMOVING" ? `Atlas is closing the previous page. You can restart your journey to ${retry.destinationLabel} in a moment.` : `${journeyEndCopy(retry.endReason)} Start again from ${retry.rootHostname}.` : "");
    action("restart-journey", showRetry);
    if (context?.effect === "REMOVING") setProperty(element2("restart-journey"), "disabled", true);
    setProperty(element2("home-note"), "hidden", decision?.outcome !== "REQUIRE_CONFIRMATION" && decision?.outcome !== "ALLOW");
    setProperty(element2("journey-panel"), "hidden", !activeJourney);
    text2("journey-phase", activeJourney ? "Active" : "Ended");
    text2("journey", journey ? `Journey \u2192 ${serviceLabel(journey.rootHostname)}` : "Pure Whitelist navigation automatically starts a bounded redirect Journey.");
    text2("journey-time", journey ? activeJourney ? `${countdown(journey.expiresAt, now)} left \xB7 fixed deadline ${new Date(journey.expiresAt).toLocaleTimeString()}` : `Ended \xB7 ${journey.endReason?.replaceAll("_", " ").toLowerCase() ?? "complete"}` : "");
    const progress = element2("journey-progress");
    setProperty(progress, "hidden", !activeJourney);
    if (activeJourney) setProperty(progress, "value", Math.max(0, (journey.expiresAt - now) / (journey.expiresAt - journey.startedAt)));
    renderSettings(controller, ready, now);
    sites.render(ready && !busy);
    syncSiteFeedback();
    renderHome(controller?.snapshot?.policy, ready);
    renderTemporaryAccess(now);
    if (!restoredPage && ready && sites.session()?.loaded && homeOrganization.session()?.saved) {
      restoredPage = true;
      if (page === "vault") element2("vault-section").open = true;
      const position = navigation.value().pages[page], initialPage = page;
      if (position) requestAnimationFrame(() => {
        if (page !== initialPage) return;
        window.scrollTo({ top: position.scroll, behavior: "instant" });
        if (page === "sites") sites.focusSelection();
        else document.getElementById(position.focus)?.focus({ preventScroll: true });
      });
    }
    if (focused instanceof HTMLButtonElement && focused.closest("#access-panel") && (focused.disabled || focused.closest("[hidden]")) && accessFocused && section === "home") element2("access-title").focus({ preventScroll: true });
    if (focused instanceof HTMLButtonElement && focused.closest("#vault-section") && (focused.disabled || focused.closest("[hidden]")) && section === "settings") element2("vault-heading").focus({ preventScroll: true });
  }
  function renderTemporaryAccess(now) {
    const summary = homeAccessSummary(view, now);
    const others = summary.journeys.filter((c) => String(c.tabId) !== selected);
    const retained = /* @__PURE__ */ new Set();
    const row = (id, name, hostnames, label, deadline, action, link) => {
      retained.add(id);
      let record = temporaryRows.get(id);
      if (!record) {
        const node = document.createElement("li");
        node.className = "temporary-row";
        const copy = document.createElement("span");
        copy.className = "temporary-copy";
        const heading = document.createElement("strong");
        heading.className = "temporary-name";
        const scope = document.createElement("span");
        scope.className = "temporary-scope";
        copy.append(heading, scope);
        const time2 = document.createElement("span");
        time2.className = "temporary-time";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "text-button";
        record = { node, link };
        const current = record;
        button.addEventListener("click", () => void followAccessLink(current.link));
        node.append(copy, time2, button);
        temporaryRows.set(id, record);
      }
      record.link = link;
      setProperty(record.node.querySelector(".temporary-name"), "textContent", name);
      setProperty(record.node.querySelector(".temporary-scope"), "textContent", `${label} \xB7 ${hostnames.join(", ")}`);
      const time = record.node.querySelector(".temporary-time");
      setProperty(time.dataset, "expiresAt", String(deadline));
      setProperty(time, "title", `Deadline ${new Date(deadline).toLocaleTimeString()}`);
      setProperty(record.node.querySelector("button"), "textContent", action);
      return record.node;
    };
    reconcileChildren(element2("temporary-list"), summary.grants.map((g) => row(
      `grant:${g.requestId}`,
      serviceLabel(g.hostnames[0]),
      g.hostnames,
      "Temporary permission",
      g.expiresAt,
      g.link.kind === "CONTEXT" ? "Access details" : "Open site",
      g.link
    )));
    reconcileChildren(element2("pending-access-list"), summary.pending.map((p) => row(
      `request:${p.requestId}`,
      serviceLabel(p.hostnames[0]),
      p.hostnames,
      p.outcome === "WAIT" ? "Waiting" : "Confirmation available",
      p.outcome === "WAIT" ? p.readyAt : p.confirmBy,
      p.link.kind === "CONTEXT" ? "Review request" : "Return to request",
      p.link
    )));
    reconcileChildren(element2("other-journeys"), others.map((c) => row(
      `journey:${c.contextId}:${c.journey.id}`,
      serviceLabel(c.journey.rootHostname),
      [c.journey.rootHostname],
      `Journey active \xB7 Tab ${c.tabId}`,
      c.journey.expiresAt,
      "View Journey",
      { kind: "CONTEXT", tabId: c.tabId, contextId: c.contextId }
    )));
    for (const id of temporaryRows.keys()) if (!retained.has(id)) temporaryRows.delete(id);
    for (const time of element2("temporary-section").querySelectorAll(".temporary-time")) {
      const label = `${countdown(Number(time.dataset.expiresAt), now)} remaining`;
      if (time.textContent !== label) setProperty(time, "textContent", label);
    }
    const count = summary.pending.length + summary.grants.length + summary.journeys.length;
    setProperty(element2("temporary-section"), "hidden", summary.available && count === 0);
    setProperty(element2("temporary-list"), "hidden", summary.grants.length === 0);
    setProperty(element2("pending-access-list"), "hidden", summary.pending.length === 0);
    setProperty(element2("other-journeys"), "hidden", others.length === 0);
    setProperty(element2("temporary-empty"), "hidden", true);
    setProperty(element2("temporary-unavailable"), "hidden", summary.available);
    text2("temporary-count", summary.available && count > 0 ? `${count} current` : "");
    for (const button of element2("temporary-section").querySelectorAll("button")) setProperty(button, "disabled", busy || !summary.available || !canQueueOperation(view?.controller));
  }
  async function followAccessLink(link) {
    if (busy || !canQueueOperation(view?.controller)) return;
    if (link.kind === "CONTEXT") {
      const context = view?.contexts.find((c) => c.tabId === link.tabId && c.contextId === link.contextId);
      if (!context) {
        feedback("The owning tab is no longer available. Refresh the access summary.", "error");
        return;
      }
      selected = String(context.tabId);
      navigate2("access");
    } else {
      const response = await send({ kind: "OPEN_DESTINATION", url: link.url });
      if (response?.opened === true) navigate2("access", true);
    }
  }
  function renderSettings(controller, ready, now) {
    const status = controller?.status;
    const policy = controller?.snapshot?.policy;
    const proposal = controller?.snapshot?.vaultState.pendingProposal;
    setProperty(element2("settings-pending"), "hidden", proposal == null);
    setProperty(element2("settings-nav-status"), "hidden", proposal == null);
    const settingsLabel = proposal == null ? "Settings" : "Settings, pending change";
    setAttribute(element2("show-settings"), "aria-label", settingsLabel);
    setProperty(element2("show-settings"), "title", settingsLabel);
    const proposalId = proposal?.id ?? null;
    if (controller?.snapshot && proposalId !== displayedProposalId) {
      displayedProposalId = proposalId;
      if (proposalId !== null) element2("vault-section").open = true;
    }
    setProperty(element2("vault-empty"), "hidden", proposal != null);
    text2("vault-empty", hasCommittedCollection(controller) ? "No proposal is waiting. Propose timing changes here or destination changes in Sites & Access." : "Vault status cannot currently be verified. Retry or recover saved state before confirmation.");
    const missingDefaults = presetHostnames.filter((hostname2) => !policy?.whitelist.includes(hostname2));
    setProperty(element2("preset-update"), "hidden", !policy || missingDefaults.length === 0);
    text2("preset-update-status", policy ? missingDefaults.length > 0 ? `${missingDefaults.length} curated hostnames are missing from your saved Whitelist.` : "Your saved Whitelist includes all current curated hostnames." : "");
    setProperty(element2("propose-defaults"), "hidden", !policy || missingDefaults.length === 0);
    setProperty(element2("propose-defaults"), "disabled", busy || !ready || proposal != null);
    setProperty(element2("vault-panel"), "hidden", proposal == null);
    const review = matchingReview(controller, policyReview);
    renderReview(review, proposal != null);
    text2("vault-review", review ? `Proposal ${review.proposalId} \xB7 policy revision ${review.basePolicyRevision}
Whitelist additions: ${review.whitelist.added.join(", ") || "(none)"}
Whitelist removals: ${review.whitelist.removed.join(", ") || "(none)"}
Blacklist additions: ${review.blacklist.added.join(", ") || "(none)"}
Blacklist removals: ${review.blacklist.removed.join(", ") || "(none)"}
Classification changes:
${review.classifications.map((change) => `${change.hostname}: ${change.before} \u2192 ${change.after}`).join("\n") || "(none)"}${review.candidateConfiguration ? `
Current settings: ${settingsCopy(review.currentConfiguration)}
Candidate settings: ${settingsCopy(review.candidateConfiguration)}` : ""}` : policyReviewError ? `Core review unavailable: ${policyReviewError}. Cancel or recover before proceeding.` : "Loading the frozen Core review\u2026");
    text2("vault-deadline", review?.phase === "WAITING" ? `Vault wait ${countdown(review.readyAt, now)}` : review?.phase === "READY" ? `Confirm within ${countdown(review.confirmBy, now)}` : review?.phase === "EXPIRED" ? "This proposal expired. Cancel it before starting a new proposal." : "");
    setProperty(element2("confirm-policy"), "hidden", review?.phase !== "READY");
    setProperty(element2("confirm-policy"), "disabled", busy || !ready || review?.phase !== "READY" || now >= review.confirmBy);
    setProperty(element2("cancel-policy"), "disabled", busy || !ready);
    const managed = view?.managed;
    text2("managed-status", managed?.active ? `Status: active \xB7 ${managed.count.toLocaleString()} domains` : "Managed data is loading or unavailable.");
    text2("managed-details", managed ? `Categories: ${managed.categories.join(" + ")}. Last updated: ${managed.lastUpdatedAt === null ? "bundled offline snapshot" : new Date(managed.lastUpdatedAt).toLocaleString()}. Upstream: ${managed.upstreamDate ?? "unknown"}.` : "");
    text2("managed-source", managed ? `Origin: ${managed.origin}
Update: ${managed.updateStatus}
Last attempt: ${managed.lastAttemptAt === null ? "none" : new Date(managed.lastAttemptAt).toLocaleString()}
Source: ${managed.sourceUrl}
Version: ${managed.upstreamVersion ?? "unknown"}
Unsupported names skipped: ${managed.ignoredNames}` : "");
    text2("managed-conflicts", managed ? `Whitelist exceptions in managed data (${managed.conflicts.length}): ${managed.conflicts.join(", ") || "none"}.` : "");
    const activeConfiguration = controller?.snapshot?.configuration;
    if (activeConfiguration) {
      const configKey = JSON.stringify(activeConfiguration);
      if (configKey !== settingsKey) {
        settingsKey = configKey;
        timingFields.forEach((field) => {
          setProperty(element2(field.id), "value", field.value(activeConfiguration));
        });
      }
      timingFields.forEach((field) => {
        text2(`active-${field.id}`, `Active: ${field.value(activeConfiguration)} ${field.unit}`);
      });
    }
    setProperty(element2("propose-settings"), "disabled", busy || !ready || proposal != null);
    text2("vault-impact", !review ? "Saved authority remains active. A verified Core review is required before confirmation." : review.invalidatesAccess ? "Policy changes invalidate current requests, grants and Journeys." : "Settings changes preserve existing waits, grants and Journey terms. New activity uses the committed settings.");
    setProperty(element2("recover"), "disabled", busy || ready || status === "UNINITIALIZED" || status === "COMMITTING");
    text2("recover", view?.startup.status === "FAILED" ? "Retry startup" : "Reload and reconcile state");
    text2("startup-diagnostic", view?.startup.status === "FAILED" ? `Startup: ${view.startup.stage} \xB7 ${view.startup.reason}` : "");
    text2("policy", controller?.snapshot ? `Exact Whitelist hosts: ${policy.whitelist.length}
Manual Blacklist hosts: ${policy.blacklist.length}
Policy revision: ${controller.snapshot.policyRevision}
State: ${status}${controller.reason ? ` \xB7 ${controller.reason}` : ""}` : startupCopy(view?.startup) || "No verified policy loaded.");
  }
  function renderHome(policy, ready) {
    const verified = view?.controller?.status === "READY" && policy !== void 0;
    if (verified) lastVerifiedPolicy = policy;
    const displayPolicy = verified ? policy : lastVerifiedPolicy ?? policy;
    const destinationKey = JSON.stringify([displayPolicy ?? null, sites.metadata()]);
    if (destinationsKey !== destinationKey) {
      destinationsKey = destinationKey;
      entries = displayPolicy ? destinationIndex(displayPolicy, sites.metadata()) : [];
      homeCatalog = homeCategories(entries, displayPolicy ? policyDestinationIndex(displayPolicy, sites.metadata()) : [], sites.metadata().map((d) => d.category));
    }
    const catalog = homeCatalog;
    homeOrganization.observe(catalog, verified);
    const layout = homeOrganization.layout();
    const groups = displayedHomeCategories(layout, catalog).map((category) => {
      let group = homeGroups.get(category.key);
      if (!group) {
        group = document.createElement("section");
        group.className = "service-group destination-section";
        setProperty(group.dataset, "categoryKey", category.key);
        const heading = document.createElement("div");
        heading.className = "section-heading";
        const title = document.createElement("h2");
        const collapse2 = document.createElement("button");
        collapse2.type = "button";
        collapse2.className = "category-heading";
        collapse2.addEventListener("click", () => void homeOrganization.change(category.key, "COLLAPSE"));
        title.append(collapse2);
        const count = document.createElement("span");
        count.className = "section-meta";
        heading.append(title, count);
        const grid2 = document.createElement("div");
        grid2.className = "destination-grid";
        grid2.id = `destination-category-${homeGroups.size}`;
        setAttribute(collapse2, "aria-controls", grid2.id);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "category-toggle text-button";
        setAttribute(toggle, "aria-controls", grid2.id);
        toggle.addEventListener("click", () => {
          if (expandedCategories.has(category.key)) expandedCategories.delete(category.key);
          else expandedCategories.add(category.key);
          updateDestinationLayout();
        });
        heading.append(toggle);
        group.append(heading, grid2);
        homeGroups.set(category.key, group);
      }
      if (group.dataset.category !== category.label || group.dataset.collapsed !== String(category.collapsed)) layoutDirty = true;
      setProperty(group.dataset, "category", category.label);
      setProperty(group.dataset, "collapsed", String(category.collapsed));
      const collapse = group.querySelector(".category-heading");
      setProperty(collapse, "textContent", category.label);
      setAttribute(collapse, "aria-expanded", String(!category.collapsed));
      setAttribute(collapse, "aria-label", `${category.collapsed ? "Expand" : "Collapse"} ${category.label} category`);
      const available = rankDestinations(entries.filter((e) => categoryKey(e.category) === category.key), usage, Date.now());
      const grid = group.querySelector(".destination-grid"), key = JSON.stringify(available);
      if (grid.dataset.entries !== key) {
        const focused = document.activeElement;
        const existing = new Map([...grid.children].map((node) => [node.dataset.destinationId, node]));
        const cards = available.map((entry) => {
          const saved = existing.get(destinationId(entry)), content = JSON.stringify(entry);
          if (saved?.dataset.entry === content) return saved;
          const card = makeDestinationCard(entry);
          setProperty(card.dataset, "entry", content);
          return card;
        });
        setProperty(grid.dataset, "entries", key);
        reconcileChildren(grid, cards);
        layoutDirty = true;
        if (focused?.isConnected && document.activeElement === document.body) focused.focus({ preventScroll: true });
      }
      setProperty(group.querySelector(".section-meta"), "textContent", `${available.length} destination${available.length === 1 ? "" : "s"}`);
      return group;
    });
    const list = element2("destination-list");
    if (JSON.stringify([...list.children].map((c) => c.dataset.categoryKey)) !== JSON.stringify(groups.map((c) => c.dataset.categoryKey))) {
      const focused = document.activeElement, key = focused?.closest("[data-category-key]")?.dataset.categoryKey;
      reconcileChildren(list, groups);
      layoutDirty = true;
      if (focused && !focused.isConnected && key) homeGroups.get(key)?.querySelector(".category-heading")?.focus({ preventScroll: true });
    }
    setProperty(element2("home-categories-empty"), "hidden", entries.length === 0 || groups.length > 0);
    renderPins();
    if (layoutDirty) {
      updateDestinationLayout();
      layoutDirty = false;
    }
    homeOrganization.render();
    renderSearch();
    const state = collectionPresentation(view?.controller, entries.length, queryAttempted, displayPolicy !== void 0);
    setProperty(element2("destinations").dataset, "phase", state.phase);
    text2("destination-state-message", state.message);
    setProperty(element2("destination-state"), "hidden", state.phase === "READY" || state.phase === "EMPTY");
    setProperty(element2("retry-destinations"), "hidden", state.phase !== "UNAVAILABLE");
    setProperty(element2("open-destination-recovery"), "hidden", state.phase !== "UNAVAILABLE");
    setProperty(element2("empty-destinations"), "hidden", state.phase !== "EMPTY");
    setProperty(element2("pinned-empty"), "hidden", state.phase !== "READY" && state.phase !== "EMPTY" || pinnedDestinations(entries, pins).length > 0);
    for (const button of document.querySelectorAll(".destination-open, #open-journey")) {
      setProperty(button, "disabled", busy || !ready || !hasCommittedCollection(view?.controller));
    }
  }
  function updateDestinationLayout() {
    const destinations = element2("destinations");
    const width = destinations.getBoundingClientRect().width;
    if (width <= 0) return;
    const styles = getComputedStyle(destinations);
    const minimum = parseFloat(styles.getPropertyValue("--destination-min-width"));
    const gap = parseFloat(styles.getPropertyValue("--destination-gap"));
    const columns = Math.max(1, Math.min(5, Math.floor((width + gap) / (minimum + gap))));
    if (destinations.dataset.columns !== String(columns)) {
      setProperty(destinations.dataset, "columns", String(columns));
      destinations.style.setProperty("--destination-columns", String(columns));
    }
    for (const group of element2("destination-list").querySelectorAll("[data-category]")) {
      const grid = group.querySelector(".destination-grid");
      const toggle = group.querySelector(".category-toggle");
      const count = group.querySelector(".section-meta");
      const category = group.dataset.category, collapsed = group.dataset.collapsed === "true";
      setProperty(grid, "hidden", collapsed);
      const expanded = expandedCategories.has(group.dataset.categoryKey);
      const overflow = grid.children.length > columns;
      if (toggle.hidden !== (!overflow || collapsed)) setProperty(toggle, "hidden", !overflow || collapsed);
      if (count.hidden !== (overflow && !collapsed)) setProperty(count, "hidden", overflow && !collapsed);
      const label = expanded ? "Show fewer" : `Show all ${grid.children.length} \u2192`;
      if (toggle.textContent !== label) setProperty(toggle, "textContent", label);
      if (toggle.getAttribute("aria-expanded") !== String(expanded)) setAttribute(toggle, "aria-expanded", String(expanded));
      const accessibleLabel = `${expanded ? "Show fewer" : "Show all"} ${category} destinations`;
      if (toggle.getAttribute("aria-label") !== accessibleLabel) setAttribute(toggle, "aria-label", accessibleLabel);
      for (const [index, child] of [...grid.children].entries()) {
        const card = child;
        const hidden = collapsed || !expanded && index >= columns;
        if (hidden && card.contains(document.activeElement)) toggle.focus({ preventScroll: true });
        if (card.hidden !== hidden) setProperty(card, "hidden", hidden);
      }
    }
  }
  var layoutObserver = new ResizeObserver(updateDestinationLayout);
  layoutObserver.observe(element2("destinations"));
  function icon(name) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    node.classList.add("icon");
    setAttribute(node, "aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    setAttribute(use, "href", `#icon-${name}`);
    node.append(use);
    return node;
  }
  async function displayWebsiteIcon(image, hostname2) {
    setProperty(image.dataset, "hostname", hostname2);
    if (!websiteIcons.has(hostname2)) websiteIcons.set(hostname2, iconSnapshot.then(() => loadWebsiteIcon(hostname2, observedIcons.get(hostname2))).then((blob) => blob ? URL.createObjectURL(blob) : null).catch(() => null));
    const loading = websiteIcons.get(hostname2);
    const url = await loading;
    if (!image.isConnected || image.dataset.hostname !== hostname2 || websiteIcons.get(hostname2) !== loading) return;
    image.src = url ?? "site.svg";
  }
  function makeDestinationCard(entry) {
    const card = document.createElement("div");
    card.className = "destination-card";
    setProperty(card.dataset, "destinationId", destinationId(entry));
    const points = destinationEntryPoints(entry);
    const addresses = document.createElement("select");
    addresses.className = "service-addresses";
    setAttribute(addresses, "aria-label", `${entry.label} entry point`);
    points.forEach((hostname2) => addresses.append(new Option(hostname2, hostname2)));
    setProperty(addresses, "hidden", points.length < 2);
    const open = document.createElement("button");
    open.className = "destination-open";
    open.type = "button";
    setAttribute(open, "aria-label", `Open ${entry.label}`);
    setProperty(open.dataset, "destinationId", destinationId(entry));
    setProperty(open, "title", entry.hostnames.join(", "));
    const mark = document.createElement("span");
    mark.className = "service-mark";
    setAttribute(mark, "aria-hidden", "true");
    const image = document.createElement("img");
    image.className = "site-icon";
    image.width = 32;
    image.height = 32;
    image.alt = "";
    image.src = "site.svg";
    image.loading = "lazy";
    setProperty(image.dataset, "hostname", addresses.value);
    image.addEventListener("error", () => {
      if (!image.src.endsWith("/site.svg")) image.src = "site.svg";
    });
    mark.append(image);
    iconObserver.observe(image);
    const copy = document.createElement("span");
    copy.className = "destination-copy";
    const name = document.createElement("span");
    name.className = "destination-name";
    setProperty(name, "textContent", entry.label);
    const host2 = document.createElement("span");
    host2.className = "destination-host";
    setProperty(host2, "textContent", addresses.value);
    addresses.addEventListener("change", () => {
      setProperty(host2, "textContent", addresses.value);
      setProperty(open, "title", addresses.value);
      void displayWebsiteIcon(image, addresses.value);
    });
    copy.append(name, host2);
    open.append(mark, copy);
    open.addEventListener("click", () => {
      void send({ kind: "OPEN_DESTINATION", url: `https://${addresses.value}/` });
    });
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "pin-button";
    setProperty(pin.dataset, "pinId", destinationId(entry));
    setProperty(pin.dataset, "label", entry.label);
    pin.append(icon("pin"));
    pin.addEventListener("click", () => {
      void togglePin(destinationId(entry));
    });
    card.append(open, pin);
    if (points.length > 1) {
      const details = document.createElement("details");
      details.className = "entry-points";
      const summary = document.createElement("summary");
      setProperty(summary, "title", `Choose ${entry.label} entry point`);
      setAttribute(summary, "aria-label", summary.title);
      summary.append(icon("chevron"));
      details.append(summary, addresses);
      card.append(details);
    }
    return card;
  }
  function renderPins() {
    const active = pinnedDestinations(entries, pins);
    const key = JSON.stringify(active);
    if (key !== pinnedKey) {
      pinnedKey = key;
      const list = element2("pinned-list"), focused = document.activeElement;
      const existing = new Map([...list.children].map((node) => [node.dataset.destinationId, node]));
      reconcileChildren(list, active.map((entry) => {
        const saved = existing.get(destinationId(entry)), content = JSON.stringify(entry);
        if (saved?.dataset.entry === content) return saved;
        const card = makeDestinationCard(entry);
        setProperty(card.dataset, "entry", content);
        return card;
      }));
      if (focused?.isConnected && document.activeElement === document.body) focused.focus({ preventScroll: true });
    }
    setProperty(element2("pinned-empty"), "hidden", active.length > 0);
    for (const button of document.querySelectorAll(".pin-button")) {
      const pinned = active.some((entry) => destinationId(entry) === button.dataset.pinId);
      const label = `${pinned ? "Unpin" : "Pin"} ${button.dataset.label}`;
      if (button.getAttribute("aria-pressed") !== String(pinned)) setAttribute(button, "aria-pressed", String(pinned));
      if (button.getAttribute("aria-label") !== label) setAttribute(button, "aria-label", label);
      if (button.title !== label) setProperty(button, "title", label);
      const disabled = !pinsLoaded || savingPins || !canQueueOperation(view?.controller);
      if (button.disabled !== disabled) setProperty(button, "disabled", disabled);
    }
  }
  function togglePin(id) {
    if (!pinsLoaded || savingPins) return;
    const focused = document.activeElement;
    const pinnedFocus = focused instanceof HTMLButtonElement && focused.closest("#pinned-list") !== null;
    const entry = entries.find((item) => destinationId(item) === id);
    const pinned = pinnedDestinations(entries, pins).some((item) => destinationId(item) === id);
    const next = updateDestinationPin(pins, id, !pinned, entry?.hostnames);
    if (next.length > 200) {
      feedback("Your pinned list is full. Unpin a destination first.", "error");
      return;
    }
    savingPins = true;
    renderPins();
    try {
      const saved = savePresentation(() => localStorage, pinsStorageKey, JSON.stringify(next));
      if (saved === "SAVED") {
        pins = next;
        feedback("Pin preference saved. Access and policy are unchanged.", "success");
      } else feedback(saved === "FAILED" ? "Your pin could not be saved. Access and policy are unchanged." : "The pin save outcome could not be verified. Access and policy are unchanged.", saved === "FAILED" ? "error" : "uncertain");
    } finally {
      savingPins = false;
      render();
      if (pinnedFocus && !focused.isConnected) {
        const counterpart = [...element2("destination-list").querySelectorAll(".pin-button")].find((button) => button.dataset.pinId === id && button.closest("[hidden]") === null && !button.disabled);
        (counterpart ?? searchInput).focus();
      }
    }
  }
  function renderReview(review, hasProposal) {
    const tone = review?.phase === "WAITING" ? "wait" : review?.phase === "READY" ? "ready" : review?.phase === "EXPIRED" ? "expired" : "unavailable";
    if (element2("vault-phase").dataset.tone !== tone) setProperty(element2("vault-phase").dataset, "tone", tone);
    text2("vault-phase", review?.phase === "WAITING" ? "Waiting" : review?.phase === "READY" ? "Ready to confirm" : review?.phase === "EXPIRED" ? "Expired" : "");
    text2("vault-summary", review ? `${review.phase === "WAITING" ? "Saved proposal; waiting period is running." : review.phase === "READY" ? "Confirmation is available. Review the frozen contents before confirming." : "The confirmation window has expired."} Your active policy and settings stay in place until explicit confirmation and a successful save.` : hasProposal ? "Waiting for a verified Core review. Confirmation is unavailable." : "");
    const key = JSON.stringify(review ? [review.proposalId, review.whitelist, review.blacklist, review.currentConfiguration, review.candidateConfiguration] : null);
    if (key === reviewKey) return;
    reviewKey = key;
    const changes = [];
    if (review) for (const [label, diff] of [["Whitelist", review.whitelist], ["Blacklist", review.blacklist]]) {
      if (diff.added.length > 0) changes.push(`${label} \xB7 add: ${diff.added.join(", ")}`);
      if (diff.removed.length > 0) changes.push(`${label} \xB7 remove: ${diff.removed.join(", ")}`);
    }
    element2("vault-changes").replaceChildren(...changes.map((value) => {
      const li = document.createElement("li");
      setProperty(li, "textContent", value);
      return li;
    }));
    setProperty(element2("vault-changes"), "hidden", changes.length === 0);
    const rows = review?.currentConfiguration && review.candidateConfiguration ? timingFields.flatMap((field) => {
      const current = field.value(review.currentConfiguration);
      const proposed = field.value(review.candidateConfiguration);
      if (current === proposed) return [];
      const row = document.createElement("tr");
      for (const cell of [field.label, `${current} ${field.unit}`, `${proposed} ${field.unit}`]) {
        const td = document.createElement("td");
        setProperty(td, "textContent", cell);
        row.append(td);
      }
      return [row];
    }) : [];
    element2("vault-settings-rows").replaceChildren(...rows);
    setProperty(element2("vault-settings-comparison"), "hidden", rows.length === 0);
  }
  function renderSearch() {
    const inputsKey = `${destinationsKey}
${searchInput.value}`;
    if (inputsKey !== searchInputsKey) {
      searchInputsKey = inputsKey;
      const next = searchDestinationTargets(entries, searchInput.value);
      const key = JSON.stringify([searchInput.value, next]);
      if (key !== searchKey) {
        searchKey = key;
        matches = next;
        highlighted = next.length === 1 ? 0 : -1;
        element2("search-results").replaceChildren(...matches.map(({ entry, hostname: hostname2 }, index) => {
          const button = document.createElement("button");
          button.type = "button";
          button.id = `search-result-${index}`;
          setAttribute(button, "role", "option");
          button.tabIndex = -1;
          button.addEventListener("mousedown", (event) => {
            event.preventDefault();
          });
          const copy = document.createElement("span");
          copy.className = "result-copy";
          const label = document.createElement("strong");
          setProperty(label, "textContent", entry.label);
          const host2 = document.createElement("small");
          setProperty(host2, "textContent", hostname2);
          copy.append(label, host2);
          button.append(copy, icon("arrow"));
          button.addEventListener("click", () => {
            if (!button.disabled) void send({ kind: "OPEN_DESTINATION", url: `https://${hostname2}/` });
          });
          return button;
        }));
      }
    }
    setProperty(element2("search-results"), "hidden", matches.length === 0);
    setProperty(element2("search-empty"), "hidden", !hasCommittedCollection(view?.controller) || searchInput.value.trim() === "" || matches.length > 0);
    setAttribute(searchInput, "aria-expanded", String(matches.length > 0));
    if (highlighted >= 0) setAttribute(searchInput, "aria-activedescendant", `search-result-${highlighted}`);
    else setAttribute(searchInput, "aria-activedescendant", null);
    for (const [index, button] of [...element2("search-results").children].entries()) {
      setAttribute(button, "aria-selected", String(index === highlighted));
      setProperty(button, "disabled", busy || !hasCommittedCollection(view?.controller));
    }
  }
  searchInput.addEventListener("input", () => {
    renderSearch();
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setProperty(searchInput, "value", "");
      renderSearch();
    }
    if (matches.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      highlighted = (highlighted + (event.key === "ArrowDown" ? 1 : highlighted < 0 ? 0 : -1) + matches.length) % matches.length;
      renderSearch();
      element2(`search-result-${highlighted}`).scrollIntoView({ block: "nearest" });
    }
  });
  element2("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const entry = matches[highlighted] ?? (matches.length === 1 ? matches[0] : void 0);
    if (entry && !busy && hasCommittedCollection(view?.controller)) void send({ kind: "OPEN_DESTINATION", url: `https://${entry.hostname}/` });
  });
  function rememberPage() {
    const focus = document.activeElement;
    navigation.save({
      ...navigation.value(),
      tab: selected,
      sites: sites.navigation(),
      pages: { ...navigation.value().pages, [page]: { scroll: window.scrollY, focus: focus?.id ?? "" } }
    });
  }
  function navigate2(name, preserveFeedback = false, fromHistory = false) {
    rememberPage();
    if (!preserveFeedback) feedback("");
    if (!fromHistory && page !== name) history.pushState(null, "", `#${name}`);
    page = name;
    section = name === "vault" ? "settings" : name === "access" ? "home" : name;
    accessFocused = name === "access";
    render();
    const target = name === "vault" ? element2("vault-section") : name === "access" ? element2("access-panel") : element2("main-content");
    if (target instanceof HTMLDetailsElement) target.open = true;
    if (name === "sites") sites.focusSelection();
    else (target.id === "main-content" ? target : target.querySelector("summary, h2") ?? target).focus({ preventScroll: true });
    const initialFocus = document.activeElement;
    const saved = navigation.value().pages[name];
    requestAnimationFrame(() => {
      if (page !== name) return;
      if (saved) window.scrollTo({ top: saved.scroll, behavior: "instant" });
      else target.scrollIntoView({ block: "start" });
      if (saved?.focus && document.activeElement === initialFocus && fromHistory) {
        const remembered = document.getElementById(saved.focus);
        if (remembered && !remembered.closest("[hidden]")) remembered.focus({ preventScroll: true });
      }
    });
  }
  history.replaceState(null, "", `#${page}`);
  history.scrollRestoration = "manual";
  window.addEventListener("popstate", () => {
    navigate2(atlasPage(location.hash.slice(1)) ?? "home", true, true);
  });
  window.addEventListener("pagehide", rememberPage);
  element2("return-to-sites").addEventListener("click", () => navigate2("sites", true));
  for (const name of ["home", "sites", "settings"]) element2(`show-${name}`).addEventListener("click", () => {
    navigate2(name);
  });
  element2("brand-home").addEventListener("click", (event) => {
    event.preventDefault();
    navigate2("home");
  });
  element2("review-pending").addEventListener("click", () => {
    navigate2("vault");
  });
  element2("retry-destinations").addEventListener("click", () => {
    void poll();
  });
  for (const id of ["open-destination-recovery", "sites-recovery"]) element2(id).addEventListener("click", () => {
    navigate2("settings");
    element2("recovery-section").open = true;
    element2("recover").focus();
  });
  for (const id of ["home-journey", "show-access"]) element2(id).addEventListener("click", () => {
    navigate2("access");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLElement && (event.target.closest("input, textarea, select") || event.target.isContentEditable)) return;
    event.preventDefault();
    navigate2("home");
    searchInput.focus();
  });
  element2("settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const draft = Object.fromEntries(timingFields.map((field) => [field.id, element2(field.id).value]));
    const candidateConfiguration = configurationFromDraft(draft);
    if (candidateConfiguration === null) {
      feedback("Use positive values in whole milliseconds and a whole hop limit.", "error");
      return;
    }
    element2("propose-defaults").closest("details").open = true;
    void send({ kind: "PROPOSE_SETTINGS", candidateConfiguration }).then((response) => {
      if (response?.result?.type === "COMMITTED") navigate2("vault", true);
    });
  });
  function diagnostics() {
    if (disposed || document.hidden || section !== "settings" || !element2("diagnostics").open) {
      ++diagnosticEpoch;
      diagnosticRequest = null;
      return Promise.resolve();
    }
    const tabId = element2("diagnostic-scope").value === "all" ? null : Number(selected || -1);
    if (diagnosticRequest?.scope === tabId) return diagnosticRequest.pending;
    const ticket = ++diagnosticEpoch;
    const pending = loadDiagnostics(tabId, ticket).finally(() => {
      if (diagnosticRequest?.pending === pending) diagnosticRequest = null;
    });
    diagnosticRequest = { scope: tabId, pending };
    return pending;
  }
  async function loadDiagnostics(tabId, ticket) {
    try {
      const response = await browser.runtime.sendMessage({ kind: "GET_DIAGNOSTICS", tabId });
      if (ticket !== diagnosticEpoch || disposed || section !== "settings" || !element2("diagnostics").open) return;
      if (!Array.isArray(response?.entries)) throw new Error("DIAGNOSTICS_UNAVAILABLE");
      const entries2 = response.entries;
      const key = JSON.stringify(entries2);
      if (key === diagnosticKey) return;
      diagnosticKey = key;
      element2("diagnostic-rows").replaceChildren(...[...entries2].reverse().map((entry) => {
        const row = document.createElement("tr");
        const request = entry.method ? `
${entry.method}${entry.sourceHostname ? ` from ${entry.sourceHostname}` : " \xB7 no source origin"}${entry.continuationKind ? ` \xB7 ${entry.continuationKind}` : ""}` : "";
        for (const value of [
          String(entry.sequence),
          `${entry.event}${request}`,
          `${entry.tabId} / ${entry.navigationId}`,
          entry.hostname ?? "\u2014",
          `${entry.outcome ?? "\u2014"}${entry.reason ? ` \xB7 ${entry.reason}` : ""}`,
          entry.journey ? `${entry.journey.id} \xB7 ${entry.journey.phase} \xB7 ${entry.journey.hopCount}/${entry.journey.maxHops}${entry.journey.endReason ? ` \xB7 ${entry.journey.endReason}` : ""}` : "\u2014"
        ]) {
          const cell = document.createElement("td");
          setProperty(cell, "textContent", value);
          row.append(cell);
        }
        return row;
      }));
      setProperty(element2("diagnostic-empty"), "hidden", entries2.length > 0);
    } catch {
      if (ticket === diagnosticEpoch) feedback("Diagnostics are temporarily unavailable.", "error");
    }
  }
  select.addEventListener("change", () => {
    selected = select.value;
    rememberPage();
    render();
    void diagnostics();
  });
  element2("setup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const hosts = (id) => element2(id).value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const defaults = element2("use-defaults").checked ? compileCuratedWhitelist().whitelist : [];
    void send({ kind: "SETUP", policy: { whitelist: [.../* @__PURE__ */ new Set([...defaults, ...hosts("whitelist")])], blacklist: hosts("blacklist") } });
  });
  element2("journey-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void send({ kind: "OPEN_DESTINATION", url: element2("destination").value.trim() });
  });
  element2("start-access").addEventListener("click", () => {
    const context = selectedContext(view?.contexts ?? [], selected);
    if (context?.accessScope?.status === "READY")
      void send({ kind: "START_ACCESS", tabId: context.tabId, scopeId: context.accessScope.id });
  });
  for (const [id, kind] of Object.entries({
    "open-home": "OPEN_HOME",
    "start-journey": "START_JOURNEY",
    "cancel-journey": "CANCEL_JOURNEY"
  }))
    element2(id).addEventListener("click", () => {
      if (selected !== "") void send({ kind, tabId: Number(selected) });
    });
  for (const [id, kind] of Object.entries({ "confirm-access": "CONFIRM_ACCESS_AND_OPEN", "cancel-access": "CANCEL_ACCESS" })) {
    element2(id).addEventListener("click", () => {
      const context = selectedContext(view?.contexts ?? [], selected);
      const decision = context?.latest?.type === "ASSESSMENT" ? context.latest.decision : null;
      const { pending } = selectedAccessRecord(decision, view?.controller?.snapshot?.accessState, context?.hostname);
      if (pending && context) void send({ kind, requestId: pending.id, ...kind === "CONFIRM_ACCESS_AND_OPEN" ? { tabId: context.tabId } : {} });
    });
  }
  element2("recover").addEventListener("click", () => {
    void send({ kind: "RECOVER" });
  });
  element2("propose-defaults").addEventListener("click", () => {
    void send({ kind: "PROPOSE_CURATED_DEFAULTS" });
    navigate2("vault");
  });
  for (const [id, kind] of Object.entries({ "confirm-policy": "CONFIRM_POLICY", "cancel-policy": "CANCEL_POLICY" })) {
    element2(id).addEventListener("click", () => {
      const proposalId = view?.controller?.snapshot?.vaultState.pendingProposal?.id;
      if (proposalId !== void 0) void send({ kind, proposalId });
    });
  }
  element2("diagnostics").addEventListener("toggle", () => {
    void diagnostics();
  });
  element2("diagnostic-scope").addEventListener("change", () => {
    void diagnostics();
  });
  element2("clear-diagnostics").addEventListener("click", () => {
    ++diagnosticEpoch;
    diagnosticRequest = null;
    void browser.runtime.sendMessage({ kind: "CLEAR_DIAGNOSTICS" }).then(() => diagnostics()).catch(() => feedback("Could not clear diagnostics.", "error"));
  });
  element2("export-diagnostics").addEventListener("click", () => {
    const tabId = element2("diagnostic-scope").value === "all" ? null : Number(selected || -1);
    void browser.runtime.sendMessage({ kind: "GET_DIAGNOSTICS", tabId }).then((response) => {
      if (!Array.isArray(response?.entries)) throw new Error("Unavailable");
      const url = URL.createObjectURL(new Blob([JSON.stringify({ format: "atlas-diagnostics-v1", entries: response.entries }, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "atlas-diagnostics.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1e3);
    }).catch(() => feedback("Could not export diagnostics.", "error"));
  });
  async function refreshView() {
    const ticket = epoch;
    try {
      const response = await browser.runtime.sendMessage({ kind: "GET_VIEW" });
      if (!response?.view) throw new Error("VIEW_UNAVAILABLE");
      if (ticket === epoch && response?.view) {
        queryAttempted = true;
        view = response.view;
        const proposalId = view?.controller?.snapshot?.vaultState.pendingProposal?.id;
        if (proposalId !== void 0 && !busy && needsPolicyReview(view?.controller, policyReview, Date.now())) {
          const reviewed = await browser.runtime.sendMessage({ kind: "REVIEW_POLICY", proposalId });
          if (ticket === epoch && reviewed?.view) {
            view = reviewed.view;
            policyReview = reviewed.result?.type === "REVIEW" ? reviewed.result.review : null;
            policyReviewError = reviewed.result?.reason ?? "";
          }
        } else if (proposalId === void 0) {
          policyReview = null;
          policyReviewError = "";
        }
        if (ticket === epoch) render();
        if (ticket === epoch) void homeOrganization.refresh();
        if (ticket === epoch) void sites.refresh();
      }
      await diagnostics();
    } catch {
      if (ticket === epoch) {
        queryAttempted = true;
        view = null;
        policyReview = null;
        render();
      }
    }
  }
  var refreshLoop = new RefreshLoop(refreshView, { delay: () => view?.controller?.status === "COMMITTING" || view?.controller?.status === "LOADING" ? 100 : 1e3 });
  function poll() {
    return refreshLoop.request();
  }
  document.addEventListener("visibilitychange", () => {
    ++epoch;
    ++diagnosticEpoch;
    diagnosticRequest = null;
    refreshLoop.setActive(!document.hidden);
    if (!document.hidden) render();
  });
  window.addEventListener("pagehide", () => {
    disposed = true;
    ++epoch;
    refreshLoop.dispose();
    iconObserver.disconnect();
    layoutObserver.disconnect();
    browser.tabs.onUpdated.removeListener(observeWebsiteIcon);
    for (const promise of websiteIcons.values()) void promise.then((url) => {
      if (url) URL.revokeObjectURL(url);
    });
    websiteIcons.clear();
    observedIcons.clear();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== pinsStorageKey && event.key !== usagePreferencesKey && event.key !== null) return;
    const before = JSON.stringify([pins, usage]);
    try {
      if (event.key === pinsStorageKey || event.key === null) pins = readPins(JSON.parse(localStorage.getItem(pinsStorageKey) ?? "null"));
      if (event.key === usagePreferencesKey || event.key === null) usage = readDestinationUsage(JSON.parse(localStorage.getItem(usagePreferencesKey) ?? "null"));
    } catch {
    }
    if (before !== JSON.stringify([pins, usage])) render();
  });
  element2("restart-journey").addEventListener("click", () => {
    const context = selectedContext(view?.contexts ?? [], selected);
    if (context?.retry) void send({ kind: "RESTART_JOURNEY", tabId: context.tabId, journeyId: context.retry.journeyId });
  });
  function observeWebsiteIcon(_tabId, changes, tab) {
    if (!changes.favIconUrl && !changes.url || !tab.url || !tab.favIconUrl) return;
    try {
      const hostname2 = new URL(tab.url).hostname;
      if (observedIcons.get(hostname2) === tab.favIconUrl) return;
      observedIcons.set(hostname2, tab.favIconUrl);
      const previous = websiteIcons.get(hostname2);
      websiteIcons.delete(hostname2);
      if (previous) void previous.then((url) => {
        if (url) URL.revokeObjectURL(url);
      });
      for (const image of document.querySelectorAll(".site-icon")) if (image.dataset.hostname === hostname2)
        void displayWebsiteIcon(image, hostname2);
    } catch {
    }
  }
  browser.tabs.onUpdated.addListener(observeWebsiteIcon);
  try {
    pins = readPins(JSON.parse(localStorage.getItem(pinsStorageKey) ?? "null"));
  } catch {
    feedback("Pinned destinations are unavailable. Your saved policy is unaffected.", "error");
  }
  pinsLoaded = true;
  try {
    usage = readDestinationUsage(JSON.parse(localStorage.getItem(usagePreferencesKey) ?? "null"));
  } catch {
    usage = {};
  }
  render();
  refreshLoop.setActive(!document.hidden);
})();
//# sourceMappingURL=main.js.map
