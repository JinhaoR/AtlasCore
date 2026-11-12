"use strict";
(() => {
  // src/ui/presentation-client.ts
  var current = null;
  var presentationView = () => current;
  async function presentationCommand(command) {
    const r = await browser.runtime.sendMessage(command);
    if (!r || r.error) throw new Error(r?.error ?? "PRESENTATION_UNAVAILABLE");
    if (r.pins && r.bookmarks && r.sync) current = r;
    return r;
  }
  var remoteBookmarks = {
    async load() {
      return (await presentationCommand({ kind: "PRESENTATION_READ" })).bookmarks;
    },
    async save(revision, value) {
      return presentationCommand({ kind: "BOOKMARK_SAVE", revision, value });
    },
    close() {
    }
  };
  async function setPin(id, pinned, hosts = []) {
    try {
      return (await presentationCommand({ kind: "PIN_SET", id, pinned, hosts })).type;
    } catch {
      return "UNCERTAIN";
    }
  }

  // src/ui/dom.ts
  function setProperty(node, key2, value) {
    if (node[key2] !== value) node[key2] = value;
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

  // src/ui/bookmark-sync.ts
  var el = (id) => document.getElementById(id);
  function initializeBookmarkSync(changed) {
    const dialog = el("bookmark-sync-dialog");
    let busy2 = false, comparisonToken = null, trigger = null;
    const labels = { NONE: "Bookmarks are connected.", CONFLICT: "Changes overlap. Compare both copies before continuing.", ROOT_MISSING: "Bookmark connection needs to be reconnected.", PERMISSION: "Firefox bookmark permission is off. Reconnect to resume.", STORAGE: "Bookmark sync could not finish. Your saved access rules are unchanged.", UNSUPPORTED: "Some bookmarks exceed supported limits. Review the folder before retrying.", DUPLICATE: "Two folders identify the same site. Combine them in Firefox, then retry." };
    function render2() {
      const state = presentationView()?.sync;
      const message = state?.enabled ? labels[state.issue] : "Connect your Firefox toolbar and Atlas pins.";
      setProperty(el("bookmark-sync-status"), "textContent", message);
      setProperty(el("bookmark-sync-warning"), "hidden", true);
      for (const id of ["settings-connect-bookmarks"]) {
        const connected = state?.enabled && state.scope === "toolbar";
        setProperty(el(id), "textContent", connected && state.issue !== "NONE" ? "Bookmarks need attention" : connected ? "Firefox bookmarks" : "Connect Firefox bookmarks");
        setProperty(el(id), "title", connected ? "Manage bookmark connection" : "Sync toolbar bookmarks and Atlas pins. Unpinning deletes the synchronized toolbar bookmarks; folders are untouched.");
      }
      setProperty(el("grant-bookmark-permission"), "hidden", !!state?.enabled && state.scope === "toolbar" && state.issue !== "PERMISSION" && state.issue !== "ROOT_MISSING");
      setProperty(el("sync-ongoing-warnings"), "textContent", state?.warnings.join(" ") ?? "");
      setProperty(el("bookmark-sync-warning-text"), "textContent", state?.issue === "NONE" && state.warnings.length ? "Some Firefox entries are not included in Atlas shortcuts." : message);
      setProperty(el("disconnect-bookmark-sync"), "hidden", !state?.enabled);
      setProperty(el("compare-bookmark-sync"), "hidden", state?.issue !== "CONFLICT");
      setProperty(el("retry-bookmark-sync"), "hidden", !state?.enabled || state.issue === "NONE" || state.issue === "CONFLICT" || state.issue === "ROOT_MISSING");
      for (const b of dialog.querySelectorAll("button")) setProperty(b, "disabled", busy2);
      for (const b of dialog.querySelectorAll("[data-sync-side]")) setProperty(b, "disabled", busy2 || !comparisonToken);
    }
    function showGroups(container, groups) {
      container.replaceChildren(...groups.map((g) => {
        const li = document.createElement("li"), title = document.createElement("strong"), list = document.createElement("ul");
        title.textContent = `${g.label}${g.pinned ? "" : " \xB7 unpinned"}`;
        for (const p of g.pages) {
          const item = document.createElement("li");
          item.textContent = `${p.label} \u2014 ${p.url}`;
          list.append(item);
        }
        li.append(title, list);
        return li;
      }));
    }
    async function action(work) {
      if (busy2) return;
      busy2 = true;
      render2();
      el("bookmark-sync-feedback").textContent = "";
      try {
        await work();
        changed();
      } catch {
        open();
        el("bookmark-sync-feedback").textContent = "Could not complete bookmark sync. Your edits and access rules are preserved. Retry, or reconnect if the folder changed.";
      } finally {
        busy2 = false;
        render2();
      }
    }
    function open() {
      trigger = document.activeElement;
      dialog.hidden = false;
      dialog.showModal();
      el("bookmark-sync-heading").focus();
      render2();
    }
    function close() {
      if (busy2) return;
      dialog.close();
      dialog.hidden = true;
      comparisonToken = null;
      el("sync-comparison").hidden = true;
      trigger?.focus({ preventScroll: true });
    }
    function connect() {
      const permission = browser.permissions.request({ permissions: ["bookmarks"] });
      void action(async () => {
        if (!await permission) {
          open();
          el("bookmark-sync-feedback").textContent = "Bookmark permission was not granted. Your Atlas pins are unchanged.";
          return;
        }
        await presentationCommand({ kind: "SYNC_TOOLBAR" });
        if (presentationView()?.sync.issue !== "NONE") open();
      });
    }
    for (const id of ["settings-connect-bookmarks", "open-bookmark-sync"]) el(id).addEventListener("click", () => {
      const state = presentationView()?.sync;
      if (state?.enabled && state.scope === "toolbar") open();
      else connect();
    });
    el("close-bookmark-sync").addEventListener("click", close);
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close();
    });
    el("grant-bookmark-permission").addEventListener("click", connect);
    el("disconnect-bookmark-sync").addEventListener("click", () => void action(async () => {
      await presentationCommand({ kind: "SYNC_DISABLE" });
      el("bookmark-sync-feedback").textContent = "Disconnected. Both copies remain saved.";
    }));
    el("retry-bookmark-sync").addEventListener("click", () => void action(async () => {
      await presentationCommand({ kind: "SYNC_RETRY" });
    }));
    el("compare-bookmark-sync").addEventListener("click", () => void action(async () => {
      const r = await presentationCommand({ kind: "SYNC_COMPARE" });
      comparisonToken = r.comparison.token;
      showGroups(el("sync-local-groups"), r.comparison.local);
      showGroups(el("sync-remote-groups"), r.comparison.remote);
      el("sync-comparison").hidden = false;
    }));
    for (const b of dialog.querySelectorAll("[data-sync-side]")) b.addEventListener("click", () => void action(async () => {
      await presentationCommand({ kind: "SYNC_RESOLVE", side: b.dataset.syncSide, token: comparisonToken });
      comparisonToken = null;
      el("sync-comparison").hidden = true;
    }));
    return { render: render2 };
  }

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
    if (Object.keys(input2).some((key2) => key2 !== "whitelist" && key2 !== "blacklist" && key2 !== "whitelistSubdomains") || !Object.hasOwn(input2, "whitelist") || !Object.hasOwn(input2, "blacklist") || !("whitelist" in input2) || !("blacklist" in input2)) {
      return null;
    }
    const whitelist = normalizeEntries(input2.whitelist);
    const blacklist = normalizeEntries(input2.blacklist);
    if (whitelist === null || blacklist === null)
      return null;
    if (!Object.hasOwn(input2, "whitelistSubdomains"))
      return { whitelist, blacklist };
    const whitelistSubdomains = normalizeEntries(input2.whitelistSubdomains);
    if (whitelistSubdomains === null || whitelistSubdomains.some((hostname2) => hostname2.split(".").length < 2))
      return null;
    return { whitelist, blacklist, whitelistSubdomains };
  }
  function isWhitelistRemoval(currentInput, candidateInput) {
    const current2 = normalizePolicy(currentInput), candidate = normalizePolicy(candidateInput);
    if (current2 === null || candidate === null)
      return false;
    const beforeBlack = new Set(current2.blacklist), afterBlack = new Set(candidate.blacklist);
    if (beforeBlack.size !== afterBlack.size || [...afterBlack].some((host2) => !beforeBlack.has(host2)))
      return false;
    let removed = false;
    for (const field of ["whitelist", "whitelistSubdomains"]) {
      const before = new Set(current2[field] ?? []), after = new Set(candidate[field] ?? []);
      if ([...after].some((host2) => !before.has(host2)))
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
  function hasFields(value, fields2) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === fields2.length && fields2.every((field) => Object.hasOwn(value, field));
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
  function endAccess(requestId, input2) {
    const prepared = prepareContext(input2);
    if (!prepared.ok)
      return reject(prepared.reason, null);
    const { state, now, policyRevision } = prepared.value;
    if (!positiveInteger(requestId))
      return reject("INVALID_REQUEST_ID", state);
    const grant = state.grants.find((entry) => entry.requestId === requestId);
    if (!grant)
      return reject("GRANT_NOT_FOUND", state);
    if (grant.policyRevision !== policyRevision)
      return reject("POLICY_CHANGED", state);
    if (now >= grant.expiresAt)
      return reject("GRANT_EXPIRED", state);
    return {
      ok: true,
      type: "ENDED",
      requestId,
      nextState: { ...state, grants: state.grants.filter((entry) => entry.requestId !== requestId) }
    };
  }

  // ../packages/core/dist/journey-state.js
  function hasJourneyFields(value, fields2) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === fields2.length && fields2.every((field) => Object.hasOwn(value, field));
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
  function hasFields2(value, fields2) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === fields2.length && fields2.every((field) => Object.hasOwn(value, field));
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
    return left.length === right.length && left.every((host2, index) => host2 === right[index]);
  }
  function samePolicy(left, right) {
    return sameEntries(left.whitelist, right.whitelist) && sameEntries(left.blacklist, right.blacklist) && sameEntries(left.whitelistSubdomains ?? [], right.whitelistSubdomains ?? []);
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
        phase: now >= proposal.confirmBy ? "EXPIRED" : now < proposal.readyAt ? "WAITING" : "READY",
        whitelist: listChanges(policy.whitelist, candidate.whitelist),
        ...policy.whitelistSubdomains === void 0 && candidate.whitelistSubdomains === void 0 ? {} : { whitelistSubdomains: listChanges(policy.whitelistSubdomains ?? [], candidate.whitelistSubdomains ?? []) },
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
    const fields2 = ["journeyId", "contextId", "target"];
    if (navigation2 !== null && typeof navigation2 === "object" && Object.hasOwn(navigation2, "continuation"))
      fields2.push("continuation");
    if (!hasJourneyFields(navigation2, fields2)) {
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
        const fields2 = ["contextId", "journeyId"];
        if (input2.context !== null && typeof input2.context === "object" && Object.hasOwn(input2.context, "continuation"))
          fields2.push("continuation");
        if (!hasJourneyFields(input2, ["kind", "target", "context"]) || !hasJourneyFields(input2.context, fields2))
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
      case "END_ACCESS":
        if (!hasJourneyFields(input2, ["kind", "requestId"]))
          return invalid();
        return positiveInteger(input2.requestId) ? valid({ kind, requestId: input2.requestId }) : invalid("INVALID_REQUEST_ID");
      case "PROPOSE_POLICY": {
        if (!hasJourneyFields(input2, ["kind", "candidatePolicy"]))
          return invalid();
        const candidatePolicy = normalizePolicy(input2.candidatePolicy);
        return candidatePolicy === null ? invalid("INVALID_CANDIDATE_POLICY") : valid({ kind, candidatePolicy });
      }
      case "REMOVE_WHITELIST": {
        if (!hasJourneyFields(input2, ["kind", "candidatePolicy", "basePolicyRevision"]))
          return invalid();
        if (!nonnegativeInteger(input2.basePolicyRevision))
          return invalid("INVALID_POLICY_REVISION");
        const candidatePolicy = normalizePolicy(input2.candidatePolicy);
        return candidatePolicy === null ? invalid("INVALID_CANDIDATE_POLICY") : valid({ kind, candidatePolicy, basePolicyRevision: input2.basePolicyRevision });
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
  function isWhitelistDecision(decision) {
    return decision.outcome === "ALLOW" && (decision.reason === "WHITELISTED" || decision.reason === "WHITELISTED_SCOPE");
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
    const current2 = snapshot.journeyState.journeys.find((j) => j.id === operation.context.journeyId);
    const access = evaluateAccess(operation.target, accessContext(snapshot, now));
    const departure = operation.context.continuation?.kind === "ROOT_DEPARTURE" ? operation.context.continuation : void 0;
    if (departure !== void 0) {
      if (access.decision.outcome === "DENY" || managedDenies(snapshot, operation.target.hostname, managed)) {
        return navigationPlan(operation, snapshot, now, managed);
      }
      if (managedDenies(snapshot, departure.sourceHostname, managed))
        return reject4("MANAGED_BLACKLISTED", snapshot);
      if (!isWhitelistDecision(evaluateAccess({ hostname: departure.sourceHostname }, accessContext(snapshot, now)).decision)) {
        return reject4("NOT_WHITELISTED", snapshot);
      }
      if (departure.sourceHostname === operation.target.hostname)
        return reject4("INVALID_NAVIGATION", snapshot);
      if (isWhitelistDecision(access.decision)) {
        return beginNavigation({ ...operation, context: {
          contextId: operation.context.contextId,
          journeyId: operation.context.journeyId
        } }, snapshot, now, managed, configuration);
      }
      if (current2 !== void 0 && current2.phase !== "ENDED") {
        return navigationPlan(operation, snapshot, now, managed);
      }
      const started2 = startJourney({ hostname: departure.sourceHostname }, operation.context.contextId, journeyContext(snapshot, now), configuration.journeyLimits);
      if (!started2.ok || started2.type !== "STARTED")
        return reject4(started2.ok ? "INVALID_JOURNEY_STATE" : started2.reason, snapshot);
      const candidate2 = { ...snapshot, journeyState: started2.nextState };
      const plan2 = navigationPlan({ ...operation, context: { ...operation.context, journeyId: started2.journey.id } }, candidate2, now, managed);
      return makePlan(plan2.result, snapshot, plan2.observationSnapshot ?? candidate2);
    }
    if (!isWhitelistDecision(access.decision) || managedDenies(snapshot, operation.target.hostname, managed)) {
      return navigationPlan(operation, snapshot, now, managed);
    }
    if (current2 !== void 0 && current2.phase !== "ENDED") {
      if (continuesJourney(current2, operation.target.hostname, operation.context.continuation) || current2.phase === "STARTED" && current2.rootHostname === operation.target.hostname) {
        return navigationPlan(operation, snapshot, now, managed);
      }
      snapshot = { ...snapshot, journeyState: replaceJourney(snapshot.journeyState, finishJourney(current2, "UNRELATED_NAVIGATION", now)) };
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
    const fields2 = ["snapshot", "now", "configuration"];
    if (contextInput !== null && typeof contextInput === "object" && Object.hasOwn(contextInput, "managedBlacklist"))
      fields2.push("managedBlacklist");
    if (!hasJourneyFields(contextInput, fields2))
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
    const journeyState = { ...journeys.nextState, journeys: journeys.nextState.journeys.map((journey) => journey.phase !== "ENDED" && managedDenies(snapshot, journey.rootHostname, managedList) ? finishJourney(journey, "ROOT_NOT_WHITELISTED", now) : journey) };
    const observation = {
      ...snapshot,
      accessState: { ...snapshot.accessState, lastObservedAt: now, policyRevision: snapshot.policyRevision },
      vaultState: { ...snapshot.vaultState, lastObservedAt: now, policyRevision: snapshot.policyRevision },
      journeyState
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
        const invalidated = observeJourneys(journeyContext(next, now));
        if (!invalidated.ok)
          return reject4(invalidated.reason, observation);
        return makePlan({ type: "TRANSITION_PREPARED", operation: operation.kind, id: policyRevision }, observation, { ...next, journeyState: invalidated.nextState });
      }
      case "START_ACCESS":
        return accessPlan(operation.kind, startAccess(operation.target, accessContext(observation, now), configuration.accessTiming, operation.scopeHostnames), observation);
      case "CONFIRM_ACCESS":
        return accessPlan(operation.kind, confirmAccess(operation.requestId, accessContext(observation, now)), observation);
      case "END_ACCESS":
        return accessPlan(operation.kind, endAccess(operation.requestId, accessContext(observation, now)), observation);
      case "CANCEL_ACCESS":
        return accessPlan(operation.kind, cancelAccess(operation.requestId, accessContext(observation, now)), observation);
      case "START_JOURNEY":
        if (managedDenies(observation, operation.root.hostname, managedList))
          return reject4("MANAGED_BLACKLISTED", observation);
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
  var curatedUpgradeHosts = Object.freeze(legacyCuratedUpgradeHosts.filter((host2) => !withdrawn.has(host2)));

  // src/presets/curated-scopes.ts
  var curatedScopeId = "curated-subdomains-2026-11-v1";
  var curatedScopeKey = `curated:${curatedScopeId}`;
  var curatedScopeHosts = curatedUpgradeHosts;
  var coveredBy = (host2, root) => host2 === root || host2.endsWith(`.${root}`);
  function curatedScopeRoots(hosts) {
    const unique = [...new Set(hosts)];
    for (const host2 of unique) {
      const p = parse(host2, { allowPrivateDomains: true });
      if (normalizeTarget({ hostname: host2 })?.hostname !== host2 || p.isIp || !p.domain || !(p.isIcann || p.isPrivate) || p.publicSuffix === host2 || host2 === "google.com" || host2 === "www.google.com") throw new TypeError("INVALID_CURATED_SCOPE");
    }
    return unique.filter((host2) => !unique.some((root) => root !== host2 && coveredBy(host2, root))).sort();
  }
  var initialCuratedScopes = Object.freeze(curatedScopeRoots(curatedScopeHosts));
  var lists = ["added", "alreadyPresent", "covered", "skippedBlacklisted", "skippedNotAllowed"];
  var fields = ["id", "kind", "policyRevisionBefore", "policyRevisionAfter", ...lists];

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
    for (const group of curatedServiceCatalog) for (const service of group.services) {
      if (!serviceHostnames(service).includes(entry.hostname)) continue;
      const active = [service.hostname, ...service.destinations ?? []].filter((hostname2) => entry.hostnames.includes(hostname2));
      return active.length > 0 ? active : [entry.hostname];
    }
    return [entry.hostname];
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
  async function validatedWebsiteIcon(response) {
    const bytes = await limitedBytes(response), type = bytes ? imageType(bytes) : null;
    if (!bytes || !type) return null;
    const blob = new Blob([bytes.buffer], { type });
    return await decodesImage(blob) ? blob : null;
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
        return await validatedWebsiteIcon(await fetcher(url, options));
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

  // src/ui/website-icon-cache.ts
  var namespace = "atlas-website-icons-v1";
  var lifetime = 7 * 24 * 60 * 60 * 1e3;
  var maximumEntries = 128;
  var maximumBytes = 64 * 1024;
  var key = (hostname2) => hostname2.length <= 253 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname2) ? `https://atlas-assets.invalid/icons/${hostname2}` : null;
  function createWebsiteIconCache(storage = globalThis.caches, now = () => Date.now()) {
    let opening, writes = Promise.resolve();
    const open = () => opening ??= storage ? storage.open(namespace).catch(() => null) : Promise.resolve(null);
    return {
      async read(hostname2) {
        const url = key(hostname2);
        if (!url) return null;
        try {
          const cache = await open(), response = await cache?.match(url);
          if (!response) return null;
          const created = Number(response.headers.get("x-atlas-created")), size = Number(response.headers.get("content-length"));
          if (created > 0 && created <= now() && now() - created < lifetime && size > 0 && size <= maximumBytes) {
            const blob = await validatedWebsiteIcon(response);
            if (blob && blob.size <= maximumBytes) return blob;
          }
          await cache?.delete(url);
        } catch {
        }
        return null;
      },
      write(hostname2, blob) {
        const url = key(hostname2);
        if (!url || !blob.size || blob.size > maximumBytes) return Promise.resolve();
        writes = writes.then(async () => {
          const cache = await open();
          if (!cache) return;
          await cache.put(url, new Response(blob, { headers: {
            "content-type": blob.type,
            "content-length": String(blob.size),
            "x-atlas-created": String(now())
          } }));
          const keys = await cache.keys();
          for (const oldest of keys.slice(0, Math.max(0, keys.length - maximumEntries))) await cache.delete(oldest);
        }).catch(() => {
        });
        return writes;
      }
    };
  }

  // src/ui/destination-cards.ts
  function icon(name) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    node.classList.add("icon");
    setAttribute(node, "aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    setAttribute(use, "href", `#icon-${name}`);
    node.append(use);
    return node;
  }
  function initializeDestinationCards(options) {
    let disposed2 = false;
    const websiteIcons = /* @__PURE__ */ new Map();
    const observedIcons = /* @__PURE__ */ new Map();
    const assetCache = createWebsiteIconCache(browser.extension?.inIncognitoContext ? null : globalThis.caches);
    const iconSnapshot = browser.tabs.query({}).then((tabs) => {
      if (disposed2) return;
      for (const tab of tabs) if (tab.url && tab.favIconUrl) {
        try {
          const hostname2 = new URL(tab.url).hostname;
          if (!observedIcons.has(hostname2)) observedIcons.set(hostname2, tab.favIconUrl);
        } catch {
        }
      }
    }).catch(() => {
    });
    const iconObserver = new IntersectionObserver((changes) => {
      for (const change of changes) if (change.isIntersecting) {
        iconObserver.unobserve(change.target);
        const image = change.target;
        void displayWebsiteIcon(image, image.dataset.hostname);
      }
    }, { rootMargin: "160px" });
    async function displayWebsiteIcon(image, hostname2, refresh = false) {
      if (disposed2) return;
      setProperty(image.dataset, "hostname", hostname2);
      if (!websiteIcons.has(hostname2)) websiteIcons.set(hostname2, (async () => {
        const cached = refresh ? null : await assetCache.read(hostname2);
        if (cached || disposed2) return cached;
        await iconSnapshot;
        const blob = disposed2 ? null : await loadWebsiteIcon(hostname2, observedIcons.get(hostname2));
        if (blob) void assetCache.write(hostname2, blob);
        return blob;
      })().then((blob) => blob && !disposed2 ? URL.createObjectURL(blob) : null).catch(() => null));
      const loading = websiteIcons.get(hostname2);
      const url = await loading;
      if (!image.isConnected || image.dataset.hostname !== hostname2 || websiteIcons.get(hostname2) !== loading) return;
      if (image.getAttribute("src") !== (url ?? "site.svg")) image.src = url ?? "site.svg";
    }
    function makeSiteMark(hostname2, existing) {
      if (existing) {
        if (existing.dataset.hostname === hostname2) return existing;
        const image2 = existing.querySelector("img");
        setProperty(existing.dataset, "hostname", hostname2);
        setProperty(image2.dataset, "hostname", hostname2);
        image2.src = "site.svg";
        iconObserver.observe(image2);
        return existing;
      }
      const mark = document.createElement("span");
      mark.className = "service-mark";
      setAttribute(mark, "aria-hidden", "true");
      setProperty(mark.dataset, "hostname", hostname2);
      const image = document.createElement("img");
      image.className = "site-icon";
      image.width = 32;
      image.height = 32;
      image.alt = "";
      image.src = "site.svg";
      image.loading = "lazy";
      setProperty(image.dataset, "hostname", hostname2);
      image.addEventListener("error", () => {
        if (!image.src.endsWith("/site.svg")) image.src = "site.svg";
      });
      mark.append(image);
      iconObserver.observe(image);
      return mark;
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
      const mark = makeSiteMark(addresses.value), image = mark.querySelector("img");
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
        void options.open(`https://${addresses.value}/`);
      });
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "pin-button";
      setProperty(pin.dataset, "pinId", destinationId(entry));
      setProperty(pin.dataset, "label", entry.label);
      pin.append(icon("pin"));
      pin.addEventListener("click", () => {
        options.togglePin(destinationId(entry));
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
          void displayWebsiteIcon(image, hostname2, true);
      } catch {
      }
    }
    browser.tabs.onUpdated.addListener(observeWebsiteIcon);
    function dispose() {
      disposed2 = true;
      iconObserver.disconnect();
      browser.tabs.onUpdated.removeListener(observeWebsiteIcon);
      for (const promise of websiteIcons.values()) void promise.then((url) => {
        if (url) URL.revokeObjectURL(url);
      });
      websiteIcons.clear();
      observedIcons.clear();
    }
    return { create: makeDestinationCard, siteMark: makeSiteMark, dispose };
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
      if (Number.isSafeInteger(item.proposalId) && item.proposalId > 0 && Number.isSafeInteger(item.basePolicyRevision) && item.basePolicyRevision >= 0 && (item.destination === null || destination !== null) && (item.removedId === null || validDestinationId(item.removedId)) && typeof item.pin === "boolean" && policy && Array.isArray(policy.whitelist) && Array.isArray(policy.blacklist) && policy.whitelist.length + policy.blacklist.length <= 1e4 && [...policy.whitelist, ...policy.blacklist].every(hostname) && evaluate("metadata-validation.example", policy).reason !== "INVALID_POLICY") {
        pending = {
          proposalId: item.proposalId,
          basePolicyRevision: item.basePolicyRevision,
          candidatePolicy: {
            whitelist: [...policy.whitelist],
            blacklist: [...policy.blacklist],
            ...policy.whitelistSubdomains !== void 0 ? { whitelistSubdomains: [...policy.whitelistSubdomains] } : {}
          },
          destination,
          removedId: item.removedId,
          pin: item.pin
        };
      }
    }
    return { version: 1, destinations, pending };
  }
  var samePolicy2 = (a, b) => ["whitelist", "blacklist", "whitelistSubdomains"].every((key2) => JSON.stringify([...a[key2] ?? []].sort()) === JSON.stringify([...b[key2] ?? []].sort()));
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
      const key2 = categoryKey(label);
      if (key2 && !groups.has(key2)) groups.set(key2, { label: categoryLabel(label), members: /* @__PURE__ */ new Set(), count: 0 });
    }
    for (const entry of all) groups.get(categoryKey(entry.category))?.members.add(destinationId(entry));
    for (const entry of allowed) {
      const group = groups.get(categoryKey(entry.category));
      if (group) group.count++;
    }
    const rank = (key2) => {
      const index = legacyOrder.indexOf(key2);
      return index < 0 ? legacyOrder.length : index;
    };
    return [...groups].map(([key2, group]) => ({ key: key2, label: group.label, count: group.count, members: [...group.members].sort() })).sort((a, b) => Number(b.count > 0) - Number(a.count > 0) || rank(a.key) - rank(b.key));
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
    const current2 = new Map(catalog.map((c) => [c.key, c])), known = new Set(saved.categories.map((c) => c.key));
    const renamed = /* @__PURE__ */ new Map();
    for (const old of saved.categories) if (!current2.has(old.key) && old.members.length) {
      const candidates = catalog.filter((c) => !known.has(c.key) && same(c.members, old.members));
      const competing = saved.categories.filter((c) => !current2.has(c.key) && same(c.members, old.members));
      if (candidates.length === 1 && competing.length === 1) renamed.set(old.key, candidates[0]);
    }
    const categories = saved.categories.map((old) => {
      const c = current2.get(old.key) ?? renamed.get(old.key);
      return c ? { ...old, key: c.key, label: c.label, members: [...c.members] } : { ...old, members: [...old.members] };
    });
    const retained = new Set(categories.map((c) => c.key));
    const added = catalog.filter((c) => !retained.has(c.key)).sort((a, b) => a.key.localeCompare(b.key, "en"));
    categories.push(...added.map((c) => ({ key: c.key, label: c.label, visible: true, collapsed: false, members: [...c.members] })));
    return { version: 1, categories };
  }
  function changeHomeLayout(layout, key2, action, available = layout.categories.map((c) => c.key)) {
    const categories = layout.categories.map((c) => ({ ...c, members: [...c.members] }));
    const index = categories.findIndex((c) => c.key === key2);
    if (index < 0) return { version: 1, categories };
    if (typeof action === "object") {
      const order = categories.filter((c) => available.includes(c.key));
      const from = order.findIndex((c) => c.key === key2), to = order.findIndex((c) => c.key === action.moveTo);
      if (from >= 0 && to >= 0 && from !== to) {
        order.splice(to, 0, order.splice(from, 1)[0]);
        let cursor = 0;
        return { version: 1, categories: categories.map((c) => available.includes(c.key) ? order[cursor++] : c) };
      }
    } else if (action === "VISIBILITY") categories[index].visible = !categories[index].visible;
    else if (action === "COLLAPSE") categories[index].collapsed = !categories[index].collapsed;
    else {
      const order = categories.filter((c) => available.includes(c.key));
      const position = order.findIndex((c) => c.key === key2), neighbor = order[position + (action === "UP" ? -1 : 1)];
      if (neighbor) {
        const other = categories.findIndex((c) => c.key === neighbor.key);
        [categories[index], categories[other]] = [categories[other], categories[index]];
      }
    }
    return { version: 1, categories };
  }

  // src/ui/home-bookmarks.ts
  var emptyBookmarks = () => ({ version: 1, groups: [] });
  function validBookmarkPage(page2) {
    return !!page2 && typeof page2.id === "string" && /^[a-zA-Z0-9:.-]{1,280}$/.test(page2.id) && typeof page2.label === "string" && page2.label.trim().length > 0 && page2.label.length <= 100 && typeof page2.url === "string" && page2.url.length <= 4096 && page2.url.trim() === page2.url && /^https?:\/\//i.test(page2.url) && normalizeTarget(page2.url) !== null;
  }
  function readHomeBookmarks(input2) {
    if (!input2 || typeof input2 !== "object" || Array.isArray(input2)) return null;
    const value = input2;
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
    return destinationEntryPoints(entry).map((host2, i) => ({ id: `entry:${host2}`, label: i === 0 ? `${entry.label} home` : host2, url: `https://${host2}/` }));
  }
  function bookmarkPages(value, parentId, entry) {
    return value?.groups.find((g) => g.parentId === parentId)?.pages ?? defaultBookmarkPages(entry);
  }
  function replaceBookmarkPages(value, parentId, pages) {
    const groups = (value ?? emptyBookmarks()).groups.filter((g) => g.parentId !== parentId);
    if (pages.length) groups.push({ parentId, pages });
    return validDestinationId(parentId) ? readHomeBookmarks({ version: 1, groups }) : null;
  }
  var same2 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var BookmarkSession = class {
    constructor(repository, changed = () => {
    }) {
      this.repository = repository;
      this.changed = changed;
    }
    saved = null;
    parentId = null;
    draft = [];
    dirty = false;
    busy = false;
    conflict = false;
    failure = null;
    reviewed = null;
    baseRevision = 0;
    defaults = [];
    loading = null;
    refresh() {
      if (this.loading || this.busy) return this.loading ?? Promise.resolve();
      this.loading = (async () => {
        try {
          const wasConflict = this.conflict;
          const latest = await this.repository.load();
          if (this.dirty && latest.revision !== this.baseRevision) {
            const expected = this.saved && this.parentId ? replaceBookmarkPages(this.saved.value, this.parentId, this.draft) : null;
            if (expected && same2(expected, latest.value)) {
              this.dirty = false;
              this.failure = null;
              this.conflict = false;
              this.baseRevision = latest.revision;
            } else this.conflict = true;
          }
          if (!this.dirty && this.parentId && latest.revision !== this.baseRevision) {
            this.draft = structuredClone(latest.value?.groups.find((g) => g.parentId === this.parentId)?.pages ?? this.defaults);
            this.baseRevision = latest.revision;
          }
          if (!same2(this.saved, latest) || this.failure === "UNAVAILABLE" || this.conflict !== wasConflict) {
            this.saved = latest;
            if (this.failure === "UNAVAILABLE") this.failure = null;
            this.changed();
          }
        } catch {
          if (this.failure !== "UNAVAILABLE") {
            this.failure = "UNAVAILABLE";
            this.changed();
          }
        }
      })().finally(() => {
        this.loading = null;
      });
      return this.loading;
    }
    async edit(parentId, defaults) {
      if (this.loading) await this.loading;
      if (this.busy || this.dirty || !this.saved || this.failure === "UNAVAILABLE") return false;
      this.parentId = parentId;
      this.baseRevision = this.saved.revision;
      this.defaults = structuredClone(defaults);
      this.draft = structuredClone(this.saved.value?.groups.find((g) => g.parentId === parentId)?.pages ?? defaults);
      this.conflict = false;
      this.reviewed = null;
      this.failure = null;
      this.changed();
      return true;
    }
    update(pages) {
      if (this.busy || !this.parentId) return;
      this.draft = structuredClone(pages);
      this.dirty = true;
      this.failure = null;
      this.changed();
    }
    discard() {
      if (this.busy) return;
      this.parentId = null;
      this.draft = [];
      this.dirty = false;
      this.conflict = false;
      this.failure = null;
      this.reviewed = null;
      this.changed();
    }
    async reviewLatest() {
      if (this.loading) await this.loading;
      if (this.busy) return;
      try {
        this.reviewed = await this.repository.load();
        this.changed();
      } catch {
        this.failure = "UNAVAILABLE";
        this.changed();
      }
    }
    async save(useReviewed = false) {
      if (this.loading) await this.loading;
      if (this.busy || !this.saved || !this.parentId || !this.dirty || this.conflict && !useReviewed) return false;
      const baseline = useReviewed ? this.reviewed : this.saved;
      if (!baseline) return false;
      const value = replaceBookmarkPages(baseline.value, this.parentId, this.draft);
      if (!value) {
        this.failure = "INVALID";
        this.changed();
        return false;
      }
      this.busy = true;
      this.changed();
      try {
        const result = await this.repository.save(useReviewed ? baseline.revision : this.baseRevision, value);
        if (result.type === "SAVED") {
          this.saved = result.envelope;
          this.baseRevision = result.envelope.revision;
          this.dirty = false;
          this.failure = null;
          this.conflict = false;
          this.reviewed = null;
          return true;
        }
        if (result.type === "CONFLICT") {
          this.conflict = true;
          this.reviewed = null;
        } else this.failure = result.type;
      } catch {
        this.failure = "UNCERTAIN";
      } finally {
        this.busy = false;
        this.changed();
      }
      return false;
    }
  };

  // src/ui/home-layout-storage.ts
  var homeLayoutDatabase = "atlas-home-layout-v1";
  async function openHomeLayoutRepository(factory = indexedDB, name = homeLayoutDatabase) {
    return openRecord(factory, name, "current", readHomeLayout);
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
    const decode = (input2) => {
      if (input2 === void 0) return { revision: 0, value: null };
      const record = input2, value = validate(record?.value);
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
        const candidate = validate(value);
        if (!candidate || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
          resolve({ type: "FAILED" });
          return;
        }
        try {
          const tx = db.transaction("layout", "readwrite"), store = tx.objectStore("layout"), request = store.get(key2);
          let result = { type: "FAILED" };
          request.onsuccess = () => {
            let current2;
            try {
              current2 = decode(request.result);
            } catch {
              tx.abort();
              return;
            }
            if (revision !== current2.revision) {
              result = { type: "CONFLICT", envelope: current2 };
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
  var categoryIconNames = { category: "Grid", folder: "Folder", book: "Book", university: "University", feather: "Writing", code: "Code", mail: "Mail", network: "Connections", home: "Home", sites: "Browser", vault: "Archive", search: "Search", pin: "Pin", brain: "Brain", atom: "Atom", calculator: "Calculator", flask: "Science", globe: "World", cloud: "Cloud", tools: "Tools", music: "Music", camera: "Photography", heart: "Health", calendar: "Calendar", chart: "Chart", leaf: "Nature", coffee: "Coffee", game: "Games", film: "Film" };
  function defaultCategoryIcon(label) {
    return /research|scholar|learning/i.test(label) ? "book" : /university|institute/i.test(label) ? "university" : /writing/i.test(label) ? "feather" : /development/i.test(label) ? "code" : /mail|communication/i.test(label) ? "mail" : /^ai$/i.test(label) ? "network" : "category";
  }
  function readCategoryIcons(input2) {
    if (!input2 || typeof input2 !== "object") return null;
    const value = input2, keys = /* @__PURE__ */ new Set();
    if (Object.keys(value).sort().join(",") !== "entries,version" || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 4096) return null;
    for (const entry of value.entries) {
      if (!entry || Object.keys(entry).sort().join(",") !== "icon,key" || typeof entry.key !== "string" || !entry.key || entry.key.length > 64 || categoryKey(entry.key) !== entry.key || keys.has(entry.key) || !categoryIcons.includes(entry.icon)) return null;
      keys.add(entry.key);
    }
    return structuredClone(value);
  }
  var openCategoryIconRepository = (factory = indexedDB, name = homeLayoutDatabase) => openRecord(factory, name, "category-icons-v1", readCategoryIcons);
  var same3 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var CategoryIconSession = class {
    constructor(repository, changed) {
      this.repository = repository;
      this.changed = changed;
    }
    saved = null;
    draft = null;
    busy = false;
    conflict = false;
    failure = null;
    loading = null;
    icon(key2, label) {
      return this.saved?.value?.entries.find((e) => e.key === key2)?.icon ?? defaultCategoryIcon(label);
    }
    refresh() {
      if (this.loading || this.busy) return this.loading ?? Promise.resolve();
      this.loading = (async () => {
        try {
          const latest = await this.repository.load(), before = JSON.stringify([this.saved, this.draft, this.conflict, this.failure]);
          if (this.draft && latest.revision !== this.saved?.revision) {
            if (same3(latest.value, this.draft)) {
              this.draft = null;
              this.conflict = false;
              this.failure = null;
            } else this.conflict = true;
          }
          if (!this.draft) this.saved = latest;
          if (this.failure === "UNAVAILABLE") this.failure = null;
          if (before !== JSON.stringify([this.saved, this.draft, this.conflict, this.failure])) this.changed();
        } catch {
          if (this.failure !== "UNAVAILABLE") {
            this.failure = "UNAVAILABLE";
            this.changed();
          }
        }
      })().finally(() => {
        this.loading = null;
      });
      return this.loading;
    }
    async change(key2, icon2) {
      if (this.loading) await this.loading;
      if (!this.saved || this.busy || this.conflict || this.failure === "UNAVAILABLE") return false;
      const entries2 = [...(this.draft ?? this.saved.value)?.entries ?? []].filter((e) => e.key !== key2);
      if (icon2 !== "") entries2.push({ key: key2, icon: icon2 });
      const draft = readCategoryIcons({ version: 1, entries: entries2 });
      if (!draft) return false;
      this.draft = draft;
      return this.persist();
    }
    async persist() {
      if (!this.saved || !this.draft || this.busy || this.conflict) return false;
      this.busy = true;
      this.changed();
      try {
        const result = await this.repository.save(this.saved.revision, this.draft);
        if (result.type === "SAVED") {
          this.saved = result.envelope;
          this.draft = null;
          this.failure = null;
          return true;
        }
        if (result.type === "CONFLICT") this.conflict = true;
        else this.failure = result.type;
      } catch {
        this.failure = "UNCERTAIN";
      } finally {
        this.busy = false;
        this.changed();
      }
      return false;
    }
    async retry() {
      await this.refresh();
      if (this.failure === "UNAVAILABLE" || this.conflict) return false;
      return this.draft ? this.persist() : !this.failure;
    }
    async useSaved() {
      if (this.loading) await this.loading;
      if (this.busy) return;
      this.busy = true;
      this.changed();
      try {
        this.saved = await this.repository.load();
        this.draft = null;
        this.failure = null;
        this.conflict = false;
      } catch {
        this.failure = "UNAVAILABLE";
      } finally {
        this.busy = false;
        this.changed();
      }
    }
  };

  // src/ui/home-shortcuts.ts
  function initializeHomeShortcuts(primary, select, reorder = () => {
  }, controls = "sites-list") {
    const buttons = /* @__PURE__ */ new Map();
    let keys = [], suppressClick = false, movable = false;
    let ghost = null;
    let settling = false;
    let latest = [[], null, true];
    let drag = null;
    function clearDrag(reset = true) {
      if (!drag) return;
      const previous = drag;
      drag = null;
      if (previous?.source.hasPointerCapture?.(previous.id)) previous.source.releasePointerCapture(previous.id);
      ghost?.remove();
      ghost = null;
      for (const button of buttons.values()) {
        setAttribute(button, "data-dragging", null);
        if (reset) button.style.removeProperty("transform");
      }
    }
    primary.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id || !movable) return;
      if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
      if (!drag.active) {
        drag.active = true;
        suppressClick = true;
        drag.source.setPointerCapture(event.pointerId);
        const rect = drag.source.getBoundingClientRect();
        drag.dx = drag.x - rect.left;
        drag.dy = drag.y - rect.top;
        ghost = drag.source.cloneNode(true);
        ghost.classList.add("category-drag-ghost");
        ghost.removeAttribute("id");
        ghost.setAttribute("aria-hidden", "true");
        ghost.setAttribute("tabindex", "-1");
        ghost.style.width = `${rect.width}px`;
        ghost.style.height = `${rect.height}px`;
        document.body.append(ghost);
        setAttribute(drag.source, "data-dragging", "true");
      }
      event.preventDefault();
      ghost.style.left = `${event.clientX - drag.dx}px`;
      ghost.style.top = `${event.clientY - drag.dy}px`;
      const bounds = primary.getBoundingClientRect();
      if (event.clientY < bounds.top + 28) primary.scrollTop -= 12;
      else if (event.clientY > bounds.bottom - 28) primary.scrollTop += 12;
      const slots = keys.map((key2) => {
        const b = buttons.get(key2);
        return { key: key2, x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight };
      });
      const origin = primary.getBoundingClientRect();
      const x = event.clientX - origin.left + primary.scrollLeft, y = event.clientY - origin.top + primary.scrollTop;
      const inside = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      const closest = inside ? [...slots].sort((a, b) => Math.hypot(x - a.x - a.w / 2, y - a.y - a.h / 2) - Math.hypot(x - b.x - b.w / 2, y - b.y - b.h / 2))[0] : null;
      drag.target = closest?.key ?? null;
      const order = [...keys];
      const from = order.indexOf(drag.key), to = closest ? order.indexOf(closest.key) : from;
      order.splice(from, 1);
      order.splice(to, 0, drag.key);
      for (const [index, key2] of order.entries()) {
        const old = slots.find((s) => s.key === key2), next = slots[index];
        buttons.get(key2).style.transform = `translate(${next.x - old.x}px, ${next.y - old.y}px)`;
      }
    });
    primary.addEventListener("pointerup", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const { key: key2, target, active } = drag;
      if (!active || !target || target === key2 || !movable) {
        clearDrag();
        return;
      }
      settling = true;
      clearDrag(false);
      void Promise.resolve(reorder(key2, target)).finally(() => {
        settling = false;
        for (const button of buttons.values()) {
          button.style.transition = "none";
          button.style.removeProperty("transform");
        }
        render2(...latest);
        void primary.offsetWidth;
        for (const button of buttons.values()) button.style.removeProperty("transition");
      });
    });
    primary.addEventListener("pointercancel", () => clearDrag());
    primary.addEventListener("lostpointercapture", () => clearDrag());
    primary.addEventListener("keydown", (event) => {
      if (event.key === "Escape") clearDrag();
    });
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", () => clearDrag());
      window.addEventListener("blur", () => clearDrag());
      window.addEventListener("pointerup", () => clearDrag());
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) clearDrag();
      });
    }
    function render2(groups, selected2 = null, canMove = true) {
      latest = [groups, selected2, canMove];
      if (settling) return;
      const nextKeys = groups.map((g) => g.dataset.categoryKey);
      if (drag && (keys.length !== nextKeys.length || keys.some((key2, i) => key2 !== nextKeys[i]))) clearDrag();
      keys = nextKeys;
      movable = canMove;
      if (drag && (!keys.includes(drag.key) || !movable)) clearDrag();
      const focused = document.activeElement;
      const nodes = groups.map((group) => {
        const key2 = group.dataset.categoryKey, label = group.dataset.category;
        let button = buttons.get(key2);
        if (!button) {
          button = document.createElement("button");
          button.type = "button";
          button.className = "category-shortcut";
          button.dataset.categoryKey = key2;
          button.append(icon("category"), document.createElement("span"));
          button.addEventListener("pointerdown", (event) => {
            suppressClick = false;
            if (settling || !movable || event.button !== 0 || !event.isPrimary) return;
            clearDrag();
            drag = { key: key2, source: button, id: event.pointerId, x: event.clientX, y: event.clientY, active: false, target: null, dx: 0, dy: 0 };
          });
          button.addEventListener("click", () => {
            if (suppressClick) {
              suppressClick = false;
              return;
            }
            select(key2);
          });
          button.addEventListener("dragstart", (event) => event.preventDefault());
          button.addEventListener("keydown", (event) => {
            suppressClick = false;
            if (settling || !movable || !event.altKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
            event.preventDefault();
            const offset = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
            const target = keys[keys.indexOf(key2) + offset];
            if (target) reorder(key2, target);
          });
          buttons.set(key2, button);
        }
        setAttribute(button.querySelector("use"), "href", `#icon-${group.dataset.icon ?? defaultCategoryIcon(label)}`);
        setProperty(button.querySelector("span"), "textContent", label);
        if (group.dataset.count !== void 0) {
          let count = button.querySelector(".category-count");
          if (!count) {
            count = document.createElement("small");
            count.className = "category-count";
            button.append(count);
          }
          setProperty(count, "textContent", `${group.dataset.count} ${group.dataset.count === "1" ? "site" : "sites"}`);
        }
        setAttribute(button, "data-reorderable", String(movable));
        setProperty(button, "title", `${label} \xB7 Drag to reorder, or use Alt + arrow keys`);
        setAttribute(button, "aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight");
        setAttribute(button, "aria-label", `${key2 === selected2 ? "Close" : "Explore"} ${label} category`);
        setAttribute(button, "aria-expanded", String(key2 === selected2));
        setAttribute(button, "aria-controls", controls);
        setAttribute(button, "aria-pressed", String(key2 === selected2));
        return button;
      });
      if (!drag?.active) reconcileChildren(primary, nodes);
      if (focused?.isConnected && nodes.includes(focused) && document.activeElement === document.body) focused.focus({ preventScroll: true });
      for (const [key2] of buttons) if (!keys.includes(key2)) buttons.delete(key2);
    }
    return render2;
  }

  // src/ui/ui-text.ts
  var uiText = {
    appearance: "Appearance",
    defaultTheme: "Default",
    lightTestTheme: "Light (test)",
    celestialTheme: "Celestial",
    parchmentTheme: "Parchment",
    retryThemeSave: "Retry appearance save",
    "categoryOrder": "Category order",
    "alphabetical": "Alphabetical",
    "mostUsed": "Most used",
    "customOrder": "Custom order",
    "loadSavedOrder": "Load saved order",
    "folderManagedInFirefox": "Manage these pages in Firefox bookmarks.",
    "chooseFolderIcon": "Choose folder icon",
    "moreBookmarks": "More bookmarks",
    "atlasYourSites": "Atlas \u2014 Your sites",
    "skipToContent": "Skip to content",
    "atlas": "Atlas",
    "home": "Home",
    "allSites": "All sites",
    "settings": "Settings",
    "yourInternetWithIntention": "YOUR INTERNET, WITH INTENTION",
    "aPlaceForTheThingsYou": "A place for the things you choose.",
    "welcomeToAtlas": "WELCOME TO ATLAS",
    "chooseYourFirstSites": "Choose your first sites",
    "startWithTheseCuratedSitesYou": "Start with these curated sites. You can add exact hostnames before saving your initial policy.",
    "includeTheCuratedAtlasAllowedSites": "Include the curated Atlas Allowed sites",
    "additionalHostnamesAndManualBlockedSites": "Additional hostnames and manual Blocked sites",
    "additionalAllowedHostnames": "Additional allowed hostnames",
    "blockedSites": "Blocked sites",
    "saveMyInitialPolicy": "Save my initial policy",
    "thisSetupIsAvailableOnceLater": "This setup is available once. Later additions use Vault; Allowed sites removals apply after review without waiting.",
    "loadingVerifiedSites": "Loading verified sites.",
    "retryLoading": "Retry loading",
    "policyRecovery": "Policy & recovery",
    "homeTitle": "Choose your direction.",
    "homeSubtitle": "A quiet way through the web.",
    "searchYourSites": "Search your sites",
    "exploreByCategory": "Explore by category",
    "noMatchingSitesTryAnotherName": "No matching sites. Try another name or hostname.",
    "categories": "\u2190 Categories",
    "pinned": "Pinned",
    "firefoxBookmarks": "Firefox bookmarks",
    "morePinnedSites": "More pinned sites",
    "pinSitesFromACategoryOr": "Pin sites from a category or All sites to keep them close.",
    "pinnedPagesCannotBeVerifiedOther": "Pinned pages cannot be verified. Other sites and policy are unchanged.",
    "retryLoadingPins": "Retry loading pins",
    "greylist": "Greylist",
    "journeys": "Journeys",
    "noTemporaryAccessIsActive": "No requests or temporary access.",
    "currentAccessCannotBeVerifiedRight": "Current access cannot be verified right now.",
    "reviewBookmarkSync": "Review bookmark sync",
    "yourCategoriesAreHiddenChooseWhich": "Your categories are hidden. Choose which to show in Settings \u2192 Home & categories.",
    "yourVerifiedSiteListIsEmpty": "Your verified site list is empty. Add sites through Sites & Access and Vault.",
    "currentDestination": "CURRENT DESTINATION",
    "noTabSelected": "No tab selected",
    "yourNextSite": "Your next site",
    "chooseATab": "Choose a tab",
    "journeyEnded": "Journey ended",
    "restartJourney": "Restart journey",
    "requestTemporaryAccess": "Request temporary access",
    "confirmAndOpen": "Confirm and open",
    "openSiteHome": "Open site home",
    "retrySiteHome": "Try site home again",
    "endTemporaryAccess": "End access",
    "cancelRequest": "Cancel request",
    "startJourneyInThisTab": "Start Journey in this tab",
    "openingStartsAtTheSiteHome": "Opening starts at the site home. Return to your task from there.",
    "journey": "Journey",
    "none": "None",
    "noJourneyInThisTab": "No Journey in this tab.",
    "endJourney": "End Journey",
    "browsingTab": "Browsing tab",
    "noWebsitesYet": "No websites yet",
    "decisionDetails": "Decision details",
    "aFrozenProposalIsWaitingIn": "A frozen proposal is waiting in Vault. Editable drafts and submitted batches remain separate; a new policy batch cannot replace it.",
    "reviewExistingProposal": "Review existing proposal",
    "retryDisplaySave": "Retry display save",
    "retryLocalDraftSave": "Retry local draft save",
    "discardDamagedLocalDraftData": "Discard damaged local draft data",
    "loadNewerSharedDraft": "Load newer shared draft",
    "technicalDetails": "Technical details",
    "sitesTitle": "Your sites",
    "sitesSubtitle": "Find a place. Decide how it belongs.",
    "searchCommittedSites": "Search committed sites",
    "filterAccess": "Filter access",
    "allAccess": "All access",
    "allowed": "Allowed",
    "blocked": "Blocked",
    "mixedRules": "Mixed rules",
    "addSite": "Add site",
    "noMatchingSites": "No matching sites.",
    "backToSites": "\u2190 Back to sites",
    "aPlaceForEverySite": "A place for every site.",
    "selectASiteToInspectIts": "Select a site to inspect its current access or prepare changes.",
    "currentSite": "CURRENT SITE",
    "theseSavedRulesAreActiveReview": "These saved rules are active. Review staged edits before applying: additions wait in Vault; Removing allowed sites have no cooldown.",
    "editSite": "Edit site",
    "stageRemoval": "Stage removal",
    "draftEdit": "DRAFT EDIT",
    "addASite": "Add a site",
    "closeEditor": "Close editor",
    "yourActiveAccessRulesHaveNot": "Your active access rules have not changed.",
    "display": "Display",
    "name": "Name",
    "category": "Category",
    "chooseAnExistingCategoryOrEnter": "Choose an existing category or enter a new one.",
    "pinOnHomeWhenApplied": "Pin on Home when applied",
    "access": "Access",
    "keepCurrentAccessRules": "Keep current access rules",
    "allowedSites": "Allowed sites",
    "primaryHostname": "Primary hostname",
    "includeCommonWwwCounterpart": "Include common www counterpart",
    "alsoAllowAllSubdomainsOfThis": "Also allow all subdomains of this hostname",
    "otherExplicitHostnames": "Other explicit hostnames",
    "additionalHostsSeparatedByCommas": "Additional hosts, separated by commas",
    "theseAreExactRulesTheSeparate": "These are exact rules. The separate subdomain option applies only to the primary hostname; wildcard strings are unsupported.",
    "addingAccessWaitsInVaultAllowed": "Adding access waits in Vault. Allowed sites removals apply after review without waiting; display-only edits save directly.",
    "addToDraft": "Add to draft",
    "saveDisplayDetails": "Save display details",
    "yourDraft": "Your draft",
    "loadingSavedDraft": "Loading saved draft\u2026",
    "loading": "Loading",
    "reviewChanges": "Review changes",
    "reviewStaleDraft": "Review stale draft",
    "reviewYourChanges": "Review your changes",
    "theseEditsArePreparedYourActive": "These edits are prepared. Your active access rules have not changed.",
    "submitToVault": "Submit to Vault",
    "continueEditing": "Continue editing",
    "discardDraft": "Discard draft",
    "returnToEditor": "Return to editor",
    "reconciliationPreview": "Reconciliation preview",
    "currentCommittedValuesYourProposedResult": "Current committed values \u2192 your proposed result. Accepting retains these proposed changes against the current baseline; it does not apply them.",
    "acceptReviewedResultAgainstCurrentState": "Accept reviewed result against current state",
    "submittedBatchAndOutcome": "Previous changes",
    "completeSiteOutcome": "Complete site outcome",
    "checkSavedSubmissionOutcome": "Check saved submission outcome",
    "restoreAsEditableDraft": "Restore as editable draft",
    "keepCurrentDisplayDetails": "Keep current display details",
    "settingsSubtitle": "Make the rules clear, then give them time.",
    "timingFriction": "Timing & friction",
    "homeCategories": "Pins & category icons",
    "vault": "Vault",
    "managedBlocking": "Managed blocking",
    "diagnostics": "Diagnostics",
    "aFrozenChangeIsWaitingIn": "A frozen change is waiting in Vault.",
    "reviewProposal": "Review proposal",
    "text": "\u2192",
    "protected": "Protected",
    "changesWaitUnderYourCurrentVault": "Changes wait under your current Vault protection and need confirmation. Existing waits, grants and Journeys keep their original terms.",
    "temporaryAccess": "Temporary access",
    "waitingPeriod": "Waiting period",
    "seconds": "seconds",
    "confirmationWindow": "Confirmation window",
    "accessDuration": "Access duration",
    "vaultProtection": "Vault protection",
    "journeyBounds": "Journey bounds",
    "lifetime": "Lifetime",
    "maximumHops": "Maximum hops",
    "reviewTimingChange": "Review timing change",
    "connectYourToolbarBookmarksAndAtlas": "Firefox toolbar bookmarks and folders appear on your compass. Folder contents stay managed in Firefox.",
    "connectFirefoxBookmarks": "Connect Firefox bookmarks",
    "advancedPinEditing": "Advanced pin editing",
    "manageIndividualShortcutPagesHere": "Manage individual shortcut pages here.",
    "editAtlasShortcuts": "Edit Atlas shortcuts",
    "categories2": "Categories",
    "noCategoriesAreAvailableYet": "No categories are available yet.",
    "retryCategoryOrder": "Retry category order",
    "loadSavedLayout": "Load saved layout",
    "retryCategoryIcons": "Retry category icons",
    "loadSavedIcons": "Load saved icons",
    "stevenblack": "StevenBlack",
    "loadingTheBundledBlockingList": "Loading the bundled blocking list\u2026",
    "sourceAndUpdateDetails": "Source and update details",
    "temporaryAccessAndJourneyCannotOverride": "Temporary access and Journey cannot override this list. An exact allowed-site entry overrides a managed entry. Additional subdomains remain subject to managed blocking; your own blocked-site rules always win.",
    "noPolicyLoaded": "No policy loaded.",
    "reloadKeepsYourSavedPolicyRecovery": "Reload keeps your saved policy. Recovery retries failed startup or verifies saved state. It does not confirm a change or reset your policy.",
    "reloadAndReconcileState": "Reload and reconcile state",
    "bundledSiteCollection": "Bundled site collection",
    "curatedUpdatesRetainYourSavedSites": "Curated updates retain your saved sites and manual Blocked sites.",
    "addCuratedSites": "Add curated sites",
    "navigationDiagnostics": "Navigation diagnostics",
    "localLast200Events": "Local \xB7 last 200 events",
    "navigationHostnamesClearOnRestartSanitized": "Navigation hostnames clear on restart. Sanitized runtime faults from the latest incident remain available after restart. Exports include visited hostnames; review them before sharing.",
    "scope": "Scope",
    "selectedTab": "Selected tab",
    "allTabs": "All tabs",
    "exportJson": "Export JSON",
    "clearLog": "Clear log",
    "recentNavigationEvents": "Recent navigation events",
    "sequence": "Sequence",
    "event": "Event",
    "tabNavigation": "Tab / navigation",
    "hostname": "Hostname",
    "coreResult": "Core result",
    "noEventsInThisView": "No events in this view.",
    "vaultSubtitle": "A moment to consider.",
    "yourProposedChanges": "Your proposed changes",
    "timingChanges": "Timing changes",
    "setting": "Setting",
    "active": "Active",
    "proposed": "Proposed",
    "namesCategoriesPinsAndExactScope": "Names, categories, pins and exact scope accompany this frozen proposal. Display details apply only after its matching commit.",
    "whatHappensNext": "What happens next",
    "fullProposalDetails": "Full proposal details",
    "confirmChange": "Confirm change",
    "backToSites2": "Back to sites",
    "cancelProposal": "Cancel proposal",
    "thisProposalIsFrozenToChange": "This proposal is frozen. To change it, cancel and prepare a new draft. Cancelling keeps your current rules.",
    "serviceEntryPoints": "Service entry points",
    "editPages": "Edit pages",
    "editPinsAndPages": "Edit pins and pages",
    "site": "Site",
    "pinSite": "Pin site",
    "pinChangesSaveSeparately": "Pin changes save separately.",
    "shortcutName": "Shortcut name",
    "saveShortcutName": "Save shortcut name",
    "movePinEarlier": "Move pin earlier",
    "movePinLater": "Move pin later",
    "openNormalServiceEntryPoints": "Open normal service entry points",
    "noSavedPagesSavingRestoresThis": "No saved pages. Saving restores this site's normal entry points.",
    "addPage": "Add page",
    "reviewNewerSavedVersion": "Review newer saved version",
    "newerSavedPages": "Newer saved pages",
    "yourEditablePagesAboveWillReplace": "Your editable pages above will replace this site's reviewed list. Other sites are preserved.",
    "saveMyPagesOverThisReviewed": "Save my pages over this reviewed version",
    "savePages": "Save pages",
    "cancel": "Cancel",
    "close": "Close",
    "connectAFirefoxBookmarkFolderTo": "Firefox toolbar bookmarks and Atlas pins stay in sync. Folder contents are managed in Firefox.",
    "onlyTheFolderYouChooseIs": "Bookmarks never change site access rules.",
    "onlyBookmarksDirectlyOnTheToolbar": "Unpinning a site deletes its synchronized toolbar bookmarks. Folders are displayed without changing their contents.",
    "chooseTheCopyToKeep": "Choose the copy to keep",
    "bothCopiesAreShownBelowChoosing": "Both copies are shown below. Choosing one replaces the connected copy with these values; access rules are unchanged.",
    "keepTheseAtlasShortcuts": "Keep these Atlas shortcuts",
    "firefox": "Firefox",
    "keepTheseFirefoxBookmarks": "Keep these Firefox bookmarks",
    "compareConflictingChanges": "Compare conflicting changes",
    "retrySync": "Retry sync",
    "disconnectKeepingBothCopies": "Disconnect, keeping both copies",
    "placeholder224": "Your institution's Canvas hostname",
    "placeholder225": "Sites to block",
    "placeholder226": "Search your sites\u2026",
    "placeholder227": "Search names, categories or hosts\u2026",
    "placeholder228": "example.com",
    "placeholder229": "another.exact-host.com"
  };

  // src/ui/category-icon-picker.ts
  function categoryIconPicker(choose, label = "Category icon") {
    const panel = document.createElement("div");
    panel.popover = "auto";
    panel.className = "category-icon-picker";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", label);
    let trigger = null, key2 = "";
    function close(restore = false) {
      if (panel.matches(":popover-open")) panel.hidePopover();
      if (restore && trigger?.isConnected) trigger.focus({ preventScroll: true });
    }
    for (const value of ["", ...categoryIcons]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "icon-option";
      button.dataset.icon = value;
      const name = value ? categoryIconNames[value] : "Automatic";
      button.title = name;
      button.setAttribute("aria-label", name);
      button.append(icon(value || "category"));
      if (!value) {
        const label2 = document.createElement("span");
        label2.textContent = name;
        button.append(label2);
      }
      button.addEventListener("click", () => {
        const selected2 = key2;
        close(true);
        choose(selected2, value);
      });
      panel.append(button);
    }
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        const buttons = [...panel.querySelectorAll("button")], at = buttons.indexOf(document.activeElement);
        const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (at + ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 }[e.key] ?? 0) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    });
    document.body.append(panel);
    return (button, category, current2) => {
      if (trigger === button && panel.matches(":popover-open")) {
        close(true);
        return;
      }
      close();
      trigger = button;
      key2 = category;
      for (const item of panel.querySelectorAll("button")) item.setAttribute("aria-pressed", String(item.dataset.icon === current2));
      panel.showPopover({ source: button });
      const r = button.getBoundingClientRect(), box = panel.getBoundingClientRect();
      panel.style.left = `${Math.max(12, Math.min(innerWidth - box.width - 12, r.left))}px`;
      panel.style.top = `${Math.max(12, Math.min(innerHeight - box.height - 12, r.bottom + 8))}px`;
      panel.querySelector('[aria-pressed="true"]')?.focus();
    };
  }

  // src/ui/bookmark-editor.ts
  var el2 = (id) => document.getElementById(id);
  function initializeBookmarkEditor(session, togglePin2, open) {
    const dialog = el2("bookmark-editor"), parent = el2("bookmark-parent");
    const rows = /* @__PURE__ */ new Map();
    let entries2 = [], pins2 = [], pinEnabled = false;
    let optionsKey = "", trigger = null;
    let labelParent = null, labelBefore = null, labelBusy = false, labelDirty = false;
    const entry = () => entries2.find((e) => destinationId(e) === session.parentId);
    const change = (pages) => session.update(pages);
    function close(discard) {
      if (session.busy || labelBusy || !discard && labelDirty) return;
      if (discard) {
        session.discard();
        labelDirty = false;
        labelParent = null;
      }
      dialog.close();
      setProperty(dialog, "hidden", true);
      if (trigger?.isConnected && !trigger.closest("[hidden]")) trigger.focus({ preventScroll: true });
    }
    function cancel() {
      if (!session.dirty && !labelDirty || window.confirm("Discard your unsaved edits? Saved bookmarks and access rules stay unchanged.")) close(true);
    }
    async function select(id) {
      if (labelBusy || session.busy) return;
      if ((session.dirty || labelDirty) && !window.confirm("Discard these unsaved edits and switch sites?")) {
        parent.value = session.parentId ?? "";
        return;
      }
      session.discard();
      labelDirty = false;
      labelParent = null;
      const e = entries2.find((e2) => destinationId(e2) === id);
      await session.edit(id, e ? defaultBookmarkPages(e) : []);
      render2();
    }
    function render2() {
      if (!dialog.open) return;
      const savedLabel = session.parentId ? presentationView()?.sync.labels[session.parentId] ?? null : null;
      if (labelParent !== session.parentId || !labelBusy && !labelDirty && labelBefore !== savedLabel) {
        labelDirty = false;
        labelParent = session.parentId;
        labelBefore = savedLabel;
        el2("bookmark-label").value = labelBefore ?? entry()?.label ?? "";
        el2("bookmark-label-status").textContent = "";
      }
      setProperty(el2("save-bookmark-label"), "disabled", labelBusy || !entry());
      for (const direction of ["up", "down"]) setProperty(el2(`pin-${direction}`), "disabled", labelBusy || !pins2.includes(session.parentId ?? "") || pins2.indexOf(session.parentId) === (direction === "up" ? 0 : pins2.length - 1));
      const choices = [
        ...entries2.map((e) => ({ id: destinationId(e), label: e.label })),
        ...(session.saved?.value?.groups ?? []).filter((g) => !entries2.some((e) => destinationId(e) === g.parentId)).map((g) => ({ id: g.parentId, label: `${g.parentId.replace(/^(host|service):/, "")} \xB7 unavailable` }))
      ];
      const key2 = JSON.stringify(choices);
      if (key2 !== optionsKey) {
        optionsKey = key2;
        reconcileChildren(parent, choices.map((c) => new Option(c.label, c.id)));
      }
      setProperty(parent, "value", session.parentId ?? "");
      setProperty(parent, "disabled", session.busy || labelBusy);
      const nodes = session.draft.map((page2, index) => {
        let row = rows.get(page2.id);
        if (!row) {
          row = document.createElement("li");
          row.className = "bookmark-edit-row";
          row.dataset.pageId = page2.id;
          const nameLabel = document.createElement("label");
          nameLabel.textContent = "Name";
          const name = document.createElement("input");
          name.maxLength = 100;
          name.autocomplete = "off";
          name.dataset.field = "label";
          nameLabel.append(name);
          const urlLabel = document.createElement("label");
          urlLabel.textContent = "Page URL";
          const url = document.createElement("input");
          url.type = "url";
          url.maxLength = 4096;
          url.autocomplete = "off";
          url.spellcheck = false;
          url.dataset.field = "url";
          urlLabel.append(url);
          for (const [field, input2] of [["label", name], ["url", url]]) input2.addEventListener("input", () => {
            change(session.draft.map((p) => p.id === page2.id ? { ...p, [field]: input2.value } : p));
          });
          const actions = document.createElement("div");
          actions.className = "bookmark-row-actions";
          for (const [action, label] of [["up", "Move up"], ["down", "Move down"], ["remove", "Remove"]]) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "text-button";
            button.dataset.action = action;
            button.textContent = label;
            button.addEventListener("click", () => {
              const list = [...session.draft], i = list.findIndex((p) => p.id === page2.id);
              if (i < 0) return;
              if (action === "remove") list.splice(i, 1);
              else {
                const other = i + (action === "up" ? -1 : 1);
                if (other < 0 || other >= list.length) return;
                [list[i], list[other]] = [list[other], list[i]];
              }
              change(list);
              if (action === "remove") (el2("bookmark-pages").querySelector("input") ?? el2("add-bookmark-page")).focus();
              else button.focus({ preventScroll: true });
            });
            actions.append(button);
          }
          row.append(nameLabel, urlLabel, actions);
          rows.set(page2.id, row);
        }
        setProperty(row.querySelector('[data-field="label"]'), "value", page2.label);
        setProperty(row.querySelector('[data-field="url"]'), "value", page2.url);
        for (const input2 of row.querySelectorAll("input")) setProperty(input2, "disabled", session.busy);
        for (const button of row.querySelectorAll("button")) {
          setProperty(button, "disabled", session.busy || button.dataset.action === "up" && index === 0 || button.dataset.action === "down" && index === session.draft.length - 1);
          setAttribute(button, "aria-label", `${button.textContent} ${page2.label || "page"}`);
        }
        return row;
      });
      const focused = document.activeElement;
      reconcileChildren(el2("bookmark-pages"), nodes);
      if (focused?.isConnected && document.activeElement === document.body) focused.focus({ preventScroll: true });
      for (const [id] of rows) if (!session.draft.some((p) => p.id === id)) rows.delete(id);
      setProperty(el2("bookmark-parent-note"), "textContent", !entry() ? "This site is unavailable. Its saved pages are retained, but no active pin is shown. Remove all pages and save to clear them." : "Pages belong to this site only. Saving pages does not change access rules or pin order.");
      setProperty(el2("bookmark-empty"), "hidden", session.draft.length > 0);
      const message = session.busy ? "Saving pages\u2026" : session.conflict ? "Another Atlas page saved newer bookmarks. Your edits are retained. Review the saved version before overwriting it." : session.failure === "INVALID" ? "Give every page a name and a supported full HTTP(S) URL without embedded credentials. Maximum 100 pages per site." : session.failure ? "Pages are not verified as saved. Your edits remain here; retry before closing this page." : session.dirty ? "Unsaved page edits. Home still uses saved bookmarks." : "Saved pages. Browsing permission is unchanged.";
      setProperty(el2("bookmark-status"), "textContent", message);
      setProperty(el2("save-bookmarks"), "disabled", session.busy || !session.dirty || session.conflict || !session.saved);
      setProperty(el2("save-bookmarks"), "textContent", session.failure && session.failure !== "INVALID" ? "Retry save" : "Save pages");
      setProperty(el2("add-bookmark-page"), "disabled", session.busy || !entry() || session.draft.length >= 100);
      setProperty(el2("cancel-bookmarks"), "disabled", session.busy);
      setProperty(el2("review-bookmark-conflict"), "hidden", !session.conflict);
      setProperty(el2("review-bookmark-conflict"), "disabled", session.busy);
      const review = session.reviewed?.value?.groups.find((g) => g.parentId === session.parentId)?.pages ?? [];
      const reviewText = session.reviewed ? review.length ? review.map((p) => `${p.label}
${p.url}`).join("\n\n") : "No page override is saved for this site." : "";
      setProperty(el2("bookmark-latest"), "textContent", reviewText);
      setProperty(el2("bookmark-conflict-review"), "hidden", !session.reviewed);
      setProperty(el2("save-reviewed-bookmarks"), "disabled", session.busy || !session.reviewed);
      setProperty(el2("pin-bookmark-parent"), "disabled", !entry() || !pinEnabled || session.busy);
      setProperty(el2("pin-bookmark-parent"), "textContent", pins2.includes(session.parentId ?? "") ? "Unpin site" : "Pin site");
      const service = el2("bookmark-service-pages"), defaults = entry() ? defaultBookmarkPages(entry()) : [];
      const serviceKey = JSON.stringify(defaults);
      if (service.dataset.key !== serviceKey) {
        service.dataset.key = serviceKey;
        reconcileChildren(service, defaults.map((p) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "text-button";
          button.textContent = p.label;
          button.addEventListener("click", () => open(p.url));
          return button;
        }));
      }
      setProperty(el2("bookmark-service-entry-points"), "hidden", !entry());
      for (const button of service.querySelectorAll("button")) setProperty(button, "disabled", !pinEnabled || session.failure === "UNAVAILABLE");
    }
    el2("bookmark-label").addEventListener("input", () => {
      labelDirty = true;
    });
    el2("save-bookmark-label").addEventListener("click", () => {
      if (labelBusy || !session.parentId) return;
      labelBusy = true;
      render2();
      void presentationCommand({ kind: "PIN_LABEL", id: session.parentId, label: el2("bookmark-label").value, before: labelBefore }).then(() => {
        labelDirty = false;
        labelBefore = presentationView()?.sync.labels[session.parentId] ?? null;
        el2("bookmark-label-status").textContent = "Shortcut name saved. Site access is unchanged.";
      }).catch(() => {
        el2("bookmark-label-status").textContent = "Name not saved. Your text is retained. If another window changed this shortcut, close and reopen this editor to compare before retrying.";
      }).finally(() => {
        labelBusy = false;
        render2();
      });
    });
    for (const direction of ["up", "down"]) el2(`pin-${direction}`).addEventListener("click", () => {
      if (labelBusy) return;
      const before = [...pins2], next = [...pins2], i = next.indexOf(session.parentId), j = i + (direction === "up" ? -1 : 1);
      if (i < 0 || j < 0 || j >= next.length) return;
      [next[i], next[j]] = [next[j], next[i]];
      labelBusy = true;
      render2();
      void presentationCommand({ kind: "PIN_ORDER", before, pins: next }).then(() => {
        pins2 = next;
        el2("bookmark-label-status").textContent = "Pin order saved.";
      }).catch(() => {
        el2("bookmark-label-status").textContent = "Pin order not saved. Another window may have changed it. Review the current order and retry.";
      }).finally(() => {
        labelBusy = false;
        render2();
      });
    });
    parent.addEventListener("change", () => void select(parent.value));
    el2("add-bookmark-page").addEventListener("click", () => {
      change([...session.draft, { id: crypto.randomUUID(), label: "", url: "" }]);
      el2("bookmark-pages").lastElementChild?.querySelector("input")?.focus();
    });
    el2("cancel-bookmarks").addEventListener("click", cancel);
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      cancel();
    });
    el2("save-bookmarks").addEventListener("click", () => void session.save().then((ok) => {
      if (ok) close(false);
    }));
    el2("review-bookmark-conflict").addEventListener("click", () => void session.reviewLatest());
    el2("save-reviewed-bookmarks").addEventListener("click", () => void session.save(true).then((ok) => {
      if (ok) close(false);
    }));
    el2("pin-bookmark-parent").addEventListener("click", () => {
      if (session.parentId) togglePin2(session.parentId);
    });
    return {
      render(next, order, enabled) {
        entries2 = next;
        pins2 = order;
        pinEnabled = enabled;
        render2();
      },
      async open(id, from) {
        trigger = from ?? document.activeElement;
        if (!session.saved) await session.refresh();
        const retained = session.parentId && (entries2.some((e) => destinationId(e) === session.parentId) || session.saved?.value?.groups.some((g) => g.parentId === session.parentId)) ? session.parentId : void 0;
        const target = id ?? retained ?? pins2.find((p) => entries2.some((e) => destinationId(e) === p)) ?? (entries2[0] ? destinationId(entries2[0]) : session.saved?.value?.groups[0]?.parentId);
        if (!target || !session.saved) return;
        if (!session.dirty) {
          const e = entries2.find((e2) => destinationId(e2) === target);
          await session.edit(target, e ? defaultBookmarkPages(e) : []);
        }
        setProperty(dialog, "hidden", false);
        dialog.showModal();
        render2();
        el2("bookmark-editor-title").focus();
      }
    };
  }

  // src/ui/compass-motion.ts
  function angularMotion() {
    let last = null, position = 0, latest = -Infinity;
    let samples = [];
    return {
      move(x, y, at) {
        if (!Number.isFinite(at) || at < latest) return 0;
        latest = at;
        if (Math.hypot(x, y) < 12) {
          last = null;
          samples = [];
          return 0;
        }
        const next = Math.atan2(y, x);
        let delta = last === null ? 0 : next - last;
        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;
        last = next;
        const degrees = delta * 180 / Math.PI;
        position += degrees;
        samples = samples.filter((s) => s.at >= at - 100 && s.at !== at).slice(-63);
        samples.push({ at, position });
        return degrees;
      },
      velocity(at) {
        if (at < latest || at - latest >= 100 || samples.length < 2) return 0;
        const recent = samples.filter((s) => s.at >= at - 100);
        if (at > latest) recent.push({ at, position });
        if (recent.length < 2 || recent.at(-1).at - recent[0].at < 12) return 0;
        const meanTime = recent.reduce((sum, s) => sum + s.at - at, 0) / recent.length;
        const meanPosition = recent.reduce((sum, s) => sum + s.position, 0) / recent.length;
        let covariance = 0, variance = 0;
        for (const s of recent) {
          const t = s.at - at - meanTime;
          covariance += t * (s.position - meanPosition);
          variance += t * t;
        }
        return variance === 0 ? 0 : Math.max(-1.2, Math.min(1.2, covariance / variance));
      }
    };
  }
  function coastRotation(speed, milliseconds) {
    const decay = Math.exp(-Math.max(0, milliseconds) / 700);
    return { speed: speed * decay, degrees: speed * 700 * (1 - decay) };
  }

  // src/ui/home-pins.ts
  var compassCapacity = 10;
  var el3 = (id) => document.getElementById(id);
  function initializeHomePins(options) {
    const nodes = /* @__PURE__ */ new Map(), chooserRows = /* @__PURE__ */ new Map();
    const chooser = el3("pin-chooser"), primary = el3("pinned-primary");
    const handle = el3("compass-handle");
    let session = null, editor = null;
    let entries2 = [], pins2 = [], active = [];
    let available = false, pinEnabled = false, opening = null, failed = false, disposed2 = false;
    let selected2 = null, keyboardOpened = false;
    let hover, leaving;
    let angle = 0, gesture = null;
    let coast = 0, paint = 0;
    const schedulePaint = () => {
      if (!paint) paint = requestAnimationFrame(() => {
        paint = 0;
        placePins();
      });
    };
    let iconEdit = null;
    async function saveFolderIcon() {
      const edit = iconEdit;
      if (!edit) return;
      setProperty(el3("retry-folder-icon"), "disabled", true);
      try {
        await presentationCommand({ kind: "FOLDER_ICON", ...edit });
        if (iconEdit === edit) iconEdit = null;
        el3("pin-folder-error").textContent = "";
        el3("retry-folder-icon").hidden = true;
        changed();
      } catch (error) {
        openChooser(`folder:${edit.id}`, true);
        const conflict = error instanceof Error && error.message === "CONFLICT";
        el3("pin-folder-error").textContent = conflict ? "This icon changed in another Atlas window. Choose again to replace the current icon." : "Icon not saved. Your choice is kept; retry when storage is available.";
        el3("retry-folder-icon").hidden = conflict;
      } finally {
        setProperty(el3("retry-folder-icon"), "disabled", false);
      }
    }
    const pickFolderIcon = categoryIconPicker((id, value) => {
      iconEdit = { id, icon: value, before: presentationView()?.sync.folderIcons?.[id] ?? "" };
      void saveFolderIcon();
    }, "Folder icon");
    const composition = el3("compass-handle").closest(".compass-composition");
    const moving = (value) => setProperty(composition.dataset, "moving", String(value));
    const stopCoast = () => {
      cancelAnimationFrame(coast);
      coast = 0;
      moving(gesture?.moved ?? false);
    };
    let suppressClick = false;
    const clearHover = () => {
      clearTimeout(hover);
      clearTimeout(leaving);
      hover = leaving = void 0;
    };
    const changed = () => {
      if (!disposed2) {
        render2();
        options.changed();
      }
    };
    function load() {
      if (opening) return opening;
      opening = (async () => {
        try {
          const repository = remoteBookmarks;
          if (disposed2) {
            repository.close();
            return;
          }
          session = new BookmarkSession(repository, changed);
          editor = initializeBookmarkEditor(session, options.togglePin, (url) => launch(url));
          failed = false;
          await session.refresh();
        } catch {
          failed = true;
        } finally {
          opening = null;
          changed();
        }
      })();
      return opening;
    }
    const launch = (url) => {
      if (available && session?.saved && session.failure !== "UNAVAILABLE" && !failed) void options.open(url);
    };
    function closeChooser(restore = false) {
      clearHover();
      const selectedNode = selected2 ? nodes.get(selected2)?.node : null;
      const trigger = selectedNode?.isConnected ? selectedNode : nodes.get("overflow")?.node;
      if (chooser.matches(":popover-open")) chooser.hidePopover();
      if (trigger) setAttribute(trigger, "aria-expanded", "false");
      selected2 = null;
      if (restore) (trigger?.isConnected && !trigger.disabled ? trigger : handle).focus({ preventScroll: true });
    }
    function positionChooser() {
      const selectedNode = selected2 ? nodes.get(selected2)?.node : null;
      const trigger = selectedNode?.isConnected ? selectedNode : nodes.get("overflow")?.node;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect(), box = chooser.getBoundingClientRect();
      chooser.style.left = `${Math.max(12, Math.min(innerWidth - box.width - 12, rect.left + rect.width / 2 - box.width / 2))}px`;
      chooser.style.top = `${Math.max(12, rect.bottom + box.height + 10 < innerHeight ? rect.bottom + 8 : rect.top - box.height - 8)}px`;
    }
    function renderChooser() {
      const pin = selected2 ? nodes.get(selected2) : null;
      if (!pin) {
        closeChooser();
        return;
      }
      setProperty(el3("pin-chooser-title"), "textContent", pin.entry.label);
      setProperty(el3("edit-pin-pages"), "hidden", !!pin.folder || !!pin.children);
      setProperty(el3("edit-folder-icon"), "hidden", !pin.folder);
      setProperty(el3("pin-folder-note"), "hidden", !pin.folder);
      const pages = pin.children ? pin.children.map((id) => ({ id, label: nodes.get(id).entry.label, url: "" })) : pin.pages;
      const wanted = pages.map((page2) => {
        let button = chooserRows.get(page2.id);
        if (!button) {
          button = document.createElement("button");
          button.type = "button";
          button.className = "bookmark-open";
          button.append(document.createElement("strong"), document.createElement("span"));
          button.addEventListener("click", () => {
            if (selected2 && nodes.get(selected2)?.children?.includes(page2.id)) {
              openChooser(page2.id, true);
              return;
            }
            const current2 = selected2 ? nodes.get(selected2)?.pages.find((p) => p.id === page2.id) : null;
            if (current2) launch(current2.url);
          });
          chooserRows.set(page2.id, button);
        }
        setProperty(button.querySelector("strong"), "textContent", page2.label);
        const status = page2.url ? options.status?.(page2.url) : "";
        setProperty(button.querySelector("span"), "textContent", `${page2.url}${status ? ` \xB7 ${status}` : ""}`);
        setProperty(button, "disabled", !available || session?.failure === "UNAVAILABLE");
        return button;
      });
      const focused = document.activeElement;
      reconcileChildren(el3("pin-chooser-pages"), wanted);
      for (const [id] of chooserRows) if (!pages.some((p) => p.id === id)) chooserRows.delete(id);
      if (focused && !focused.isConnected) (wanted.find((b) => !b.disabled) ?? el3("edit-pin-pages")).focus({ preventScroll: true });
      else if (focused?.isConnected && document.activeElement === document.body) focused.focus({ preventScroll: true });
      const defaults = pin.folder || pin.children ? [] : defaultBookmarkPages(pin.entry), key2 = JSON.stringify(defaults);
      const list = el3("pin-service-pages");
      if (list.dataset.key !== key2) {
        list.dataset.key = key2;
        reconcileChildren(list, defaults.map((page2) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "text-button";
          button.textContent = page2.label;
          button.addEventListener("click", () => launch(page2.url));
          return button;
        }));
      }
      for (const button of list.querySelectorAll("button")) setProperty(button, "disabled", !available || session?.failure === "UNAVAILABLE");
      setProperty(el3("pin-service-entry-points"), "hidden", !session?.saved?.value?.groups.some((g) => g.parentId === selected2));
    }
    function openChooser(id, focus) {
      if (gesture?.moved || !available) return;
      stopCoast();
      clearHover();
      if (selected2 !== id) closeChooser();
      selected2 = id;
      keyboardOpened = focus;
      renderChooser();
      const selectedNode = nodes.get(id)?.node;
      const trigger = selectedNode?.isConnected ? selectedNode : nodes.get("overflow")?.node;
      if (!trigger) return;
      setAttribute(trigger, "aria-expanded", "true");
      if (!chooser.matches(":popover-open")) chooser.showPopover({ source: trigger });
      positionChooser();
      if (focus) chooser.querySelector(".bookmark-open:not(:disabled)")?.focus({ preventScroll: true });
    }
    function render2() {
      const sync = presentationView()?.sync;
      const folders = sync?.folders ?? [];
      const ordinary = [...pinnedDestinations(entries2, pins2)];
      const folderEntries = folders.map((f) => ({ id: `folder:${f.id}`, label: f.label, hostname: "", hostnames: [], category: "" }));
      const all = [...ordinary, ...folderEntries];
      const order = sync?.toolbarOrder ?? [];
      active = [...order.flatMap((id) => all.filter((e) => destinationId(e) === id)), ...all.filter((e) => !order.includes(destinationId(e)))];
      const extra = active.length > compassCapacity ? active.slice(compassCapacity - 1).map(destinationId) : [];
      const shown = [...active, ...extra.length ? [{ id: "overflow", label: uiText.moreBookmarks, hostname: "", hostnames: [], category: "" }] : []];
      const enabled = available && !!session?.saved && session.failure !== "UNAVAILABLE" && !failed;
      const buttons = shown.map((entry) => {
        const id = destinationId(entry);
        let pin = nodes.get(id);
        if (!pin) {
          const node = document.createElement("button");
          node.type = "button";
          node.className = "compass-pin";
          node.dataset.destinationId = id;
          const label = document.createElement("span");
          label.className = "pin-label";
          const badge2 = document.createElement("span");
          badge2.className = "pin-count";
          badge2.setAttribute("aria-hidden", "true");
          const mark2 = entry.hostname ? options.siteMark(entry.hostname) : document.createElement("span");
          if (!entry.hostname) {
            mark2.className = "service-mark folder-mark";
            mark2.append(icon("folder"));
          }
          node.append(mark2, label, badge2);
          pin = { node, entry, pages: [] };
          nodes.set(id, pin);
          node.addEventListener("pointerdown", stopCoast);
          node.addEventListener("focus", stopCoast);
          node.addEventListener("click", (e) => {
            stopCoast();
            if (suppressClick) {
              e.preventDefault();
              return;
            }
            const current2 = nodes.get(id);
            if (!current2) return;
            if (!current2.folder && !current2.children && current2.pages.length === 1) launch(current2.pages[0].url);
            else openChooser(id, true);
          });
          node.addEventListener("pointerenter", (e) => {
            clearHover();
            if (!coast && !gesture?.moved && e.pointerType === "mouse" && matchMedia("(hover: hover) and (pointer: fine)").matches && ((nodes.get(id)?.pages.length ?? 0) > 1 || !!nodes.get(id)?.folder || !!nodes.get(id)?.children))
              hover = setTimeout(() => {
                if (!coast && !gesture?.moved) openChooser(id, false);
              }, 300);
          });
          node.addEventListener("pointerleave", () => {
            clearTimeout(hover);
            if (!keyboardOpened) leaving = setTimeout(() => {
              if (!chooser.matches(":hover") && !chooser.contains(document.activeElement)) closeChooser();
            }, 220);
          });
        }
        const folder = folders.find((f) => `folder:${f.id}` === id);
        pin.entry = entry;
        pin.folder = folder?.id;
        pin.children = id === "overflow" ? extra : void 0;
        pin.pages = folder?.pages ?? (id === "overflow" ? [] : bookmarkPages(session?.saved?.value ?? null, id, entry));
        const mark = pin.node.querySelector(".service-mark");
        if (entry.hostname) options.siteMark(entry.hostname, mark);
        else {
          const name = folder ? sync?.folderIcons?.[folder.id] ?? "folder" : "folder";
          if (mark.dataset.icon !== name) {
            mark.dataset.icon = name;
            mark.replaceChildren(icon(name));
          }
        }
        const status = (entry.hostname && options.status?.(pin.pages[0]?.url ?? `https://${entry.hostname}/`)) ?? "";
        setProperty(pin.node.querySelector(".pin-label"), "textContent", `${entry.label}${status && status !== "Allowed" ? ` \xB7 ${status}` : ""}`);
        setProperty(pin.node, "title", `${entry.label}${status ? ` \xB7 ${status}` : ""}`);
        const badge = pin.node.querySelector(".pin-count");
        setProperty(badge, "textContent", String(pin.children?.length ?? pin.pages.length));
        setProperty(badge, "hidden", !pin.children && pin.pages.length < 2);
        setAttribute(pin.node, "aria-label", !pin.folder && !pin.children && pin.pages.length === 1 ? `Open ${pin.pages[0].label}` : `${entry.label}, ${pin.children?.length ?? pin.pages.length} ${pin.children ? "groups" : "pages"}`);
        setAttribute(pin.node, "aria-haspopup", pin.folder || pin.children || pin.pages.length > 1 ? "dialog" : null);
        setAttribute(pin.node, "aria-expanded", pin.folder || pin.children || pin.pages.length > 1 ? String(selected2 === id) : null);
        setProperty(pin.node, "disabled", !enabled);
        return pin.node;
      });
      const focused = document.activeElement;
      reconcileChildren(primary, extra.length ? [...buttons.slice(0, compassCapacity - 1), buttons.at(-1)] : buttons);
      for (const [id] of nodes) if (!shown.some((e) => destinationId(e) === id)) nodes.delete(id);
      if (focused?.isConnected && document.activeElement === document.body) focused.focus({ preventScroll: true });
      setProperty(el3("pinned-section").dataset, "count", entries2.length === 0 && !available ? "loading" : String(Math.min(active.length, compassCapacity)));
      setProperty(el3("pinned-empty"), "hidden", active.length > 0 || !available);
      setProperty(handle, "disabled", !enabled || active.length < 2);
      setProperty(el3("edit-pins"), "disabled", !session?.saved || failed || session.failure === "UNAVAILABLE" || entries2.length === 0 && !session.saved.value?.groups.length);
      const warning = failed || session?.failure === "UNAVAILABLE";
      setProperty(el3("bookmark-warning"), "hidden", !warning);
      setProperty(el3("pinned-list").dataset, "loading", String(!session?.saved && !warning));
      if (selected2) {
        if (!nodes.has(selected2)) closeChooser(true);
        else renderChooser();
      }
      arrangePins();
      placePins();
      editor?.render(entries2, pins2, pinEnabled);
    }
    function placePins() {
      const rotation = `${Math.round(angle * 1e3) / 1e3}deg`;
      if (composition.style.getPropertyValue("--wheel-angle") !== rotation) composition.style.setProperty("--wheel-angle", rotation);
    }
    function arrangePins() {
      const children = [...primary.children];
      children.forEach((node, index) => {
        const radians = (-90 + index * 360 / Math.max(1, children.length)) * Math.PI / 180, style = node.style;
        const x = `${(Math.cos(radians) * 134).toFixed(2)}px`, y = `${(Math.sin(radians) * 134).toFixed(2)}px`;
        if (style.getPropertyValue("--pin-x") !== x) style.setProperty("--pin-x", x);
        if (style.getPropertyValue("--pin-y") !== y) style.setProperty("--pin-y", y);
      });
    }
    function endGesture() {
      stopCoast();
      cancelAnimationFrame(paint);
      paint = 0;
      placePins();
      if (!gesture) return;
      const old = gesture;
      gesture = null;
      moving(false);
      if (handle.hasPointerCapture(old.id)) handle.releasePointerCapture(old.id);
      setProperty(handle.dataset, "dragging", "false");
      if (old.moved) {
        suppressClick = true;
        setTimeout(() => {
          suppressClick = false;
        }, 0);
      }
    }
    function releaseGesture(e) {
      if (!gesture || gesture.id !== e.pointerId) return;
      const old = gesture;
      endGesture();
      if (!old.moved || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      let speed = old.motion.velocity(e.timeStamp), last = performance.now(), elapsed = 0;
      if (Math.abs(speed) <= 8e-3) return;
      const step = (now) => {
        const dt = Math.min(4e3 - elapsed, Math.max(0, now - last));
        last = now;
        elapsed += dt;
        const next = coastRotation(speed, dt);
        speed = next.speed;
        angle = (angle + next.degrees) % 360;
        placePins();
        if (Math.abs(speed) > 8e-3 && elapsed < 4e3 && !disposed2 && available && !document.hidden) coast = requestAnimationFrame(step);
        else {
          coast = 0;
          moving(false);
        }
      };
      moving(true);
      coast = requestAnimationFrame(step);
    }
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !e.isPrimary || handle.disabled) return;
      stopCoast();
      const r = handle.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const motion = angularMotion();
      motion.move(e.clientX - cx, e.clientY - cy, e.timeStamp);
      gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, cx, cy, motion, moved: false };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!gesture || gesture.id !== e.pointerId) return;
      if (!gesture.moved && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) < 6) return;
      if (!gesture.moved) {
        gesture.moved = true;
        moving(true);
        closeChooser();
        setProperty(handle.dataset, "dragging", "true");
      }
      const samples = e.getCoalescedEvents?.() ?? [];
      for (const sample of samples.length ? samples : [e])
        angle = (angle + gesture.motion.move(sample.clientX - gesture.cx, sample.clientY - gesture.cy, sample.timeStamp)) % 360;
      schedulePaint();
    });
    handle.addEventListener("pointerup", releaseGesture);
    for (const event of ["pointercancel", "lostpointercapture"]) handle.addEventListener(event, () => {
      if (gesture) endGesture();
    });
    handle.addEventListener("click", (e) => e.preventDefault());
    handle.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        endGesture();
      }
    });
    chooser.addEventListener("pointerenter", () => clearTimeout(leaving));
    chooser.addEventListener("pointerleave", () => {
      if (!keyboardOpened) leaving = setTimeout(() => {
        if (!chooser.contains(document.activeElement)) closeChooser();
      }, 220);
    });
    chooser.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeChooser(true);
      }
    });
    chooser.addEventListener("toggle", () => {
      if (!chooser.matches(":popover-open") && selected2) closeChooser();
    });
    el3("retry-folder-icon").addEventListener("click", () => void saveFolderIcon());
    el3("edit-folder-icon").addEventListener("click", () => {
      const folder = selected2 ? nodes.get(selected2)?.folder : void 0;
      if (folder) pickFolderIcon(el3("edit-folder-icon"), folder, presentationView()?.sync.folderIcons?.[folder] ?? "");
    });
    el3("edit-pin-pages").addEventListener("click", () => {
      const id = selected2;
      const trigger = id ? nodes.get(id)?.node : void 0;
      closeChooser();
      void editor?.open(id ?? void 0, trigger);
    });
    el3("edit-pins").addEventListener("click", () => {
      closeChooser();
      void editor?.open(void 0, el3("edit-pins"));
    });
    el3("retry-bookmarks").addEventListener("click", () => {
      if (session) void session.refresh();
      else void load();
    });
    const onViewport = () => {
      closeChooser();
      endGesture();
    };
    const onScroll = (event) => {
      if (!(event.target instanceof Node) || !chooser.contains(event.target)) onViewport();
    };
    const onVisibility = () => {
      if (document.hidden) onViewport();
    };
    const onUnload = (event) => {
      if (session?.dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("resize", onViewport);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", endGesture);
    window.addEventListener("beforeunload", onUnload);
    void load();
    return {
      render(next, order, enabled, editable) {
        entries2 = next;
        pins2 = order;
        available = enabled;
        pinEnabled = editable;
        if (!enabled) endGesture();
        render2();
      },
      refresh: () => session?.refresh(),
      leave() {
        closeChooser();
        endGesture();
      },
      dispose() {
        disposed2 = true;
        closeChooser();
        endGesture();
        session?.repository.close();
        window.removeEventListener("resize", onViewport);
        document.removeEventListener("scroll", onScroll, true);
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("blur", endGesture);
        window.removeEventListener("beforeunload", onUnload);
      }
    };
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
      message: `${loading ? "Loading verified sites." : "Sites are temporarily unavailable. Retry or open Policy & recovery."}${hasLastVerified ? " Showing last verified information; it may be out of date. Browsing actions are unavailable." : ""}`
    };
  }

  // src/ui/pin-status.ts
  function pinAccessStatus(view2, url, now) {
    const state = view2?.controller;
    if (!hasCommittedCollection(state) || !state?.snapshot) return "Access unverified";
    const result = evaluate(url, state.snapshot.policy);
    if (result.outcome === "DENY") return "Blocked";
    if (result.outcome === "ALLOW") return result.reason === "WHITELISTED_SCOPE" ? "Domain rule \xB7 safety checks apply" : "Allowed";
    if ("target" in result) {
      const host2 = result.target.hostname;
      if (view2?.temporaryAccess?.some((g) => g.hostnames.includes(host2) && g.expiresAt > now)) return "Temporary access";
      if (view2?.pendingAccess?.some((g) => g.hostnames.includes(host2) && g.confirmBy > now)) return "Access request in progress";
    }
    return "No saved access rule \xB7 checked when opened";
  }

  // src/ui/settings-navigation.ts
  var settingsSections = ["timing-settings", "home-settings", "vault-section", "managed-section", "recovery-section", "diagnostics"];
  function settingsSection(value) {
    return settingsSections.includes(value) ? value : "timing-settings";
  }
  function initializeSettingsNavigation(options) {
    let selected2 = settingsSection(options.initial), active = false, shown = "";
    const panels = settingsSections.map((id) => document.getElementById(id));
    const buttons = [...document.querySelectorAll("[data-settings-panel]")];
    function render2(visible, override) {
      const shownPanel = override ?? selected2;
      active = visible;
      for (const panel of panels) setProperty(panel, "hidden", panel.id !== shownPanel);
      for (const button of buttons) setAttribute(button, "aria-current", button.dataset.settingsPanel === shownPanel ? "page" : "false");
      if (shown !== selected2) {
        shown = selected2;
        setProperty(panels.find((p) => p.id === selected2), "open", true);
      }
    }
    function choose(value, remember = true) {
      selected2 = settingsSection(value);
      shown = "";
      render2(active);
      if (remember) options.remember(selected2);
      panels.find((p) => p.id === selected2)?.querySelector("summary")?.focus({ preventScroll: true });
    }
    for (const button of buttons) button.addEventListener("click", () => choose(button.dataset.settingsPanel));
    for (const panel of panels) panel.addEventListener("toggle", () => {
      if (active && panel.open && panel.hidden) choose(panel.id);
    });
    return { render: render2, choose, value: () => selected2, restore(value) {
      selected2 = settingsSection(value);
      render2(active);
    } };
  }

  // src/ui/viewport-scroll.ts
  function viewportScrollSurface(page2, sitesView) {
    const ids = page2 === "home" ? [] : page2 === "sites" ? sitesView === "review" ? ["destination-draft-items"] : sitesView === "detail" ? ["sites-editor"] : ["sites-categories", "sites-list"] : page2 === "settings" ? ["settings-workspace"] : page2 === "vault" ? ["vault-contents"] : ["pending-access-list"];
    for (const id of [...ids, "main-content"]) {
      const node = document.getElementById(id);
      if (node && !node.closest("[hidden]") && node.clientHeight > 0 && ["auto", "scroll"].includes(getComputedStyle(node).overflowY)) return node;
    }
    return document.scrollingElement ?? document.documentElement;
  }

  // src/ui/presentation.ts
  function authorityInterruptionCopy(issue) {
    if (!issue) return "";
    const fault = issue.internalFault;
    return `Last authority interruption this session: ${issue.reason} \xB7 ${issue.status} (retained across recovery).` + (fault ? ` Core fault ${fault.sequence}: ${fault.operation} \xB7 ${fault.stage} \xB7 ${fault.error}.` + (fault.stateCounts ? ` State counts: ${fault.stateCounts.journeys} Journeys, ${fault.stateCounts.requests} requests, ${fault.stateCounts.grants} grants.` : "") : "");
  }
  function storageFailureCopy(storage) {
    const failure = storage?.lastFailure;
    if (!failure) return "";
    const code = `Last storage issue: ${failure.operation} \xB7 ${failure.stage} \xB7 ${failure.cause}.`;
    if (failure.cause === "QUOTA_EXCEEDED") return `${code} Firefox reported insufficient storage. Free disk space, then reload and reconcile state. Do not clear Atlas data.`;
    return `${code} If access remains paused, reload and reconcile state. Your saved policy is retained.`;
  }
  function storageDiagnosticsCopy(storage) {
    return storage ? `Storage this background session: ${storage.readTransactions} read transactions, ${storage.writeTransactions} write transactions, ${storage.committedWrites} committed snapshots, ${storage.failedCommits} failed commits. ${storageFailureCopy(storage)}` : "";
  }
  function startupCopy(startup) {
    if (startup?.status !== "FAILED") return "";
    if (startup.stage === "MANAGED_BLACKLIST") return "Atlas could not verify its bundled safety list. Retry startup in Settings. If this continues, obtain a verified signed Atlas update; keep the extension installed to preserve saved state.";
    if (startup.stage === "STORAGE") return "Atlas could not open its saved state. Retry startup in Settings. If this continues, check Firefox storage availability.";
    return "Atlas could not finish startup. Retry startup in Settings. Your saved policy is preserved.";
  }
  function canQueueOperation(view2) {
    return view2?.status === "READY" || view2?.snapshot != null && (view2.status === "LOADING" || view2.status === "COMMITTING");
  }
  function accessOutcomeLabel(decision) {
    if (!decision) return "No decision";
    return {
      ALLOW: "Allowed",
      DENY: decision.reason === "BLACKLISTED" || decision.reason === "MANAGED_BLACKLISTED" ? "Blocked" : "Unavailable",
      GREYLIST: "Requires access request",
      WAIT: "Waiting",
      REQUIRE_CONFIRMATION: "Confirm access"
    }[decision.outcome];
  }
  function accessCopy(decision) {
    if (decision === null) return { title: "Choose a tab", description: "Select a website to see its access status.", tone: "neutral" };
    switch (decision.outcome) {
      case "GREYLIST":
        return { title: "Take a moment before continuing", description: "This site is outside your allowed sites. Start a request, then return to confirm temporary access.", tone: "wait" };
      case "WAIT":
        return { title: "Your waiting period is running", description: "You can leave this page and come back. When the wait ends, you still need to confirm.", tone: "wait" };
      case "REQUIRE_CONFIRMATION":
        return { title: "Ready when you are", description: "Confirm to open the site home with temporary access. Your policy stays the same.", tone: "ready" };
      case "DENY":
        return { title: decision.reason === "BLACKLISTED" || decision.reason === "MANAGED_BLACKLISTED" ? "This site is blocked" : "Access is unavailable", description: decision.reason === "BLACKLISTED" ? "Your blocked-site rule prevents access to this site." : decision.reason === "MANAGED_BLACKLISTED" ? "The managed StevenBlack list blocks this site. Temporary access and Journey cannot override it." : "Atlas could not authorize this navigation. Check the decision details below.", tone: decision.reason === "BLACKLISTED" || decision.reason === "MANAGED_BLACKLISTED" ? "blocked" : "unavailable" };
      case "ALLOW":
        return { title: "You can continue", description: decision.reason === "WHITELISTED" ? "This site is in your allowed sites." : decision.reason === "WHITELISTED_SCOPE" ? `This site is covered by your saved domain scope for ${decision.scopeRoot}.` : decision.reason === "ACTIVE_JOURNEY" ? "This navigation is covered by your current Journey. Its original deadline still applies." : "Temporary access is active. After it expires, this site will require another access request.", tone: "ready" };
    }
  }
  function accessContextCopy(context) {
    const result = context?.latest;
    const decision = result?.type === "ASSESSMENT" ? result.decision : null;
    if (!context || decision) return { ...accessCopy(decision), label: accessOutcomeLabel(decision), retryHome: false };
    if (result?.type === "ADAPTER_ERROR" && (result.reason === "NAVIGATION_FAILED" || result.reason === "NAVIGATION_DID_NOT_START")) {
      return {
        title: "The site did not open",
        label: "Navigation failed",
        tone: "unavailable",
        description: "Firefox could not complete this navigation. Try opening the site home again; Atlas will check access as usual.",
        retryHome: context.hostname !== null && context.effect !== "FAILED" && context.effect !== "REMOVING"
      };
    }
    if (result === null) return {
      title: "Checking site access",
      label: "Checking",
      tone: "neutral",
      description: "Atlas has not yet received an access decision for this tab.",
      retryHome: false
    };
    return {
      title: "Access is unavailable",
      label: "Unavailable",
      tone: "unavailable",
      description: "Atlas could not verify access for this tab. Check the decision details below.",
      retryHome: false
    };
  }
  function countdown(deadline, now) {
    const seconds2 = Math.max(0, Math.ceil((deadline - now) / 1e3));
    return `${Math.floor(seconds2 / 60)}:${String(seconds2 % 60).padStart(2, "0")}`;
  }
  function selectedContext(contexts, selected2) {
    return contexts.find((context) => String(context.tabId) === selected2);
  }

  // src/ui/diagnostics-panel.ts
  function initializeDiagnosticsPanel(options) {
    const element3 = (id) => document.getElementById(id);
    let disposed2 = false, diagnosticKey = "", diagnosticEpoch = 0;
    let diagnosticRequest = null;
    const buildVersion = document.createElement("p");
    buildVersion.id = "build-version";
    buildVersion.className = "note";
    setProperty(buildVersion, "textContent", `Atlas extension ${browser.runtime.getManifest().version}`);
    element3("diagnostics").append(buildVersion);
    const storageDiagnostic = document.createElement("p");
    storageDiagnostic.id = "storage-diagnostic";
    storageDiagnostic.className = "note";
    element3("diagnostics").append(storageDiagnostic);
    const runtimeDiagnostic = document.createElement("p");
    runtimeDiagnostic.id = "runtime-diagnostic";
    runtimeDiagnostic.className = "note";
    element3("diagnostics").append(runtimeDiagnostic);
    element3("diagnostics").append(element3("startup-diagnostic"));
    element3("diagnostics").append(element3("action-diagnostic"));
    function refresh() {
      if (disposed2 || document.hidden || !options.visible() || !element3("diagnostics").open) {
        ++diagnosticEpoch;
        diagnosticRequest = null;
        return Promise.resolve();
      }
      const tabId = element3("diagnostic-scope").value === "all" ? null : Number(options.selected() || -1);
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
        if (ticket !== diagnosticEpoch || disposed2 || !options.visible() || !element3("diagnostics").open) return;
        if (!Array.isArray(response?.entries)) throw new Error("DIAGNOSTICS_UNAVAILABLE");
        const runtime = response.runtime;
        const previous = runtime?.previousSession;
        setProperty(runtimeDiagnostic, "textContent", runtime?.retention === "UNAVAILABLE" ? "Runtime diagnostics are available for this session, but could not be retained across restart." : previous?.faults.length ? `Retained incident from Atlas ${previous.version}: ${previous.faults.map((f) => `${f.subsystem} \xB7 ${f.error}${f.controller ? ` \xB7 ${f.controller.stage}` : ""}`).join("; ")}. Export diagnostics for numeric code locations.` : "No retained runtime incident. Diagnostic evidence never changes access permissions.");
        const entries2 = response.entries;
        const key2 = JSON.stringify(entries2);
        if (key2 === diagnosticKey) return;
        diagnosticKey = key2;
        element3("diagnostic-rows").replaceChildren(...[...entries2].reverse().map((entry) => {
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
        setProperty(element3("diagnostic-empty"), "hidden", entries2.length > 0);
      } catch {
        if (ticket === diagnosticEpoch) options.feedback("Diagnostics are temporarily unavailable.", "error");
      }
    }
    element3("diagnostics").addEventListener("toggle", () => {
      void refresh();
    });
    element3("diagnostic-scope").addEventListener("change", () => {
      void refresh();
    });
    element3("clear-diagnostics").addEventListener("click", () => {
      if (disposed2) return;
      ++diagnosticEpoch;
      diagnosticRequest = null;
      void browser.runtime.sendMessage({ kind: "CLEAR_DIAGNOSTICS" }).then(() => refresh()).catch(() => options.feedback("Could not clear diagnostics.", "error"));
    });
    element3("export-diagnostics").addEventListener("click", () => {
      if (disposed2) return;
      const tabId = element3("diagnostic-scope").value === "all" ? null : Number(options.selected() || -1);
      void browser.runtime.sendMessage({ kind: "GET_DIAGNOSTICS", tabId }).then((response) => {
        if (disposed2) return;
        if (!Array.isArray(response?.entries)) throw new Error("Unavailable");
        const url = URL.createObjectURL(new Blob([JSON.stringify({ format: "atlas-diagnostics-v1", extensionVersion: browser.runtime.getManifest().version, entries: response.entries, storage: response.storage ?? null, authorityInterruption: response.authorityInterruption ?? null, curatedUpgrade: response.curatedUpgrade ?? null, runtime: response.runtime ?? null }, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "atlas-diagnostics.json";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1e3);
      }).catch(() => options.feedback("Could not export diagnostics.", "error"));
    });
    return {
      refresh,
      invalidate() {
        ++diagnosticEpoch;
        diagnosticRequest = null;
      },
      dispose() {
        disposed2 = true;
        ++diagnosticEpoch;
        diagnosticRequest = null;
      },
      render(view2) {
        const text3 = [storageDiagnosticsCopy(view2?.storage), authorityInterruptionCopy(view2?.authorityInterruption)].filter(Boolean).join("\n");
        setProperty(storageDiagnostic, "textContent", text3);
      }
    };
  }

  // src/ui/destinations.ts
  function destinationIndex(policy, metadata2 = [], pins2 = []) {
    const hosts = [...policy.whitelist, ...policy.whitelistSubdomains ?? []];
    const decisions = evaluateMany(hosts, policy);
    const active = new Set(hosts.filter((_, index) => decisions[index].outcome === "ALLOW"));
    return groupDestinationHosts(active, metadata2, policy, pins2);
  }
  function groupDestinationHosts(active, metadata2, policy, pins2, mergeSubdomains = true) {
    const entries2 = [];
    const scoped = new Set(mergeSubdomains ? policy.whitelistSubdomains ?? [] : []);
    const initialHosts = new Set(active);
    const pinnedHost = (host2) => pins2.includes(`host:${host2}`) || pins2.includes(`service:${host2}`);
    const catalogHosts = new Set(curatedServiceCatalog.flatMap((group) => group.services.flatMap((service) => serviceHostnames(service))));
    const possibleParent = (host2) => [...scoped].some((root) => catalogHosts.has(root) && initialHosts.has(root) && !policy.blacklist.includes(root) && host2.endsWith(`.${root}`));
    for (const item of metadata2) {
      const hostnames = item.hostnames.filter((host2) => active.has(host2));
      if (hostnames.length === 0) continue;
      if (item.label === item.primaryHostname && item.category === "Your destinations" && !pins2.includes(item.id) && hostnames.every((host2) => !pinnedHost(host2) && !catalogHosts.has(host2) && !scoped.has(host2) && !policy.blacklist.includes(host2) && possibleParent(host2))) continue;
      entries2.push({
        id: item.id,
        label: item.label,
        category: item.category,
        hostname: hostnames.includes(item.primaryHostname) ? item.primaryHostname : hostnames[0],
        hostnames
      });
      hostnames.forEach((host2) => active.delete(host2));
    }
    for (const group of curatedServiceCatalog) for (const service of group.services) {
      const hostnames = serviceHostnames(service).filter((hostname2) => active.has(hostname2));
      if (hostnames.length === 0) continue;
      entries2.push({ id: `service:${service.hostname}`, label: service.label, hostname: hostnames[0], hostnames, category: group.label });
      hostnames.forEach((hostname2) => active.delete(hostname2));
    }
    const parents = entries2.flatMap((entry, index) => entry.hostnames.filter((host2) => catalogHosts.has(host2) && scoped.has(host2) && !policy.blacklist.includes(host2)).map((root) => ({ root, index }))).sort((a, b) => b.root.length - a.root.length);
    for (const host2 of [...active].sort()) {
      if (pinnedHost(host2) || scoped.has(host2) || policy.blacklist.includes(host2)) continue;
      const parent = parents.find(({ root, index }) => host2.endsWith(`.${root}`) && entries2[index].hostnames.length < 100);
      if (!parent) continue;
      const entry = entries2[parent.index];
      entries2[parent.index] = { ...entry, hostnames: [...entry.hostnames, host2] };
      active.delete(host2);
    }
    for (const hostname2 of [...active].sort()) entries2.push({ label: hostname2, hostname: hostname2, hostnames: [hostname2], category: "Your destinations" });
    const curatedIds = curatedServiceCatalog.flatMap((group) => group.services.map((service) => `service:${service.hostname}`));
    const order = (entry) => {
      const index = curatedIds.indexOf(entry.id ?? "");
      return index < 0 ? curatedIds.length : index;
    };
    const categories = categorySuggestions(metadata2.map((item) => item.category));
    return entries2.sort((a, b) => order(a) - order(b)).map((entry) => ({ ...entry, category: canonicalCategory(entry.category, categories) }));
  }
  function policyDestinationIndex(policy, metadata2 = [], pins2 = [], mergeSubdomains = true) {
    if (evaluate("presentation-validation.invalid", policy).reason === "INVALID_POLICY") return [];
    return groupDestinationHosts(/* @__PURE__ */ new Set([...policy.whitelist, ...policy.blacklist, ...policy.whitelistSubdomains ?? []]), metadata2, policy, pins2, mergeSubdomains);
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
      const service = curatedServiceCatalog.flatMap((group) => group.services).find((item) => serviceHostnames(item).includes(entry.hostname));
      const points = [service?.hostname ?? entry.hostname, ...service?.destinations ?? []];
      const hosts = entry.hostnames.filter((host2) => words.every((word) => host2.includes(word)));
      if (!hosts.length) return [{ entry, hostname: entry.hostname, match: "NAME" }];
      return hosts.map((hostname2) => ({ entry, hostname: hostname2, match: points.includes(hostname2) ? "ENTRY_POINT" : service?.aliases?.includes(hostname2) ? "ALIAS" : "HOST" }));
    });
  }

  // src/ui/home-layout-session.ts
  var same4 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
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
    /** Without a catalog, preload saved preferences without initializing or migrating them. */
    refresh(catalog) {
      if (catalog !== void 0) this.catalog = catalog;
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
          if (same4(latest.value, this.draft)) {
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
        if (!same4(this.saved, latest)) {
          this.saved = latest;
          this.failure = null;
          this.changed();
        }
        if (catalog === void 0) return;
        const reconciled = reconcileHomeLayout(latest.value, catalog);
        if (!same4(reconciled, latest.value)) {
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
    async change(key2, action, available) {
      if (this.refreshing) await this.refreshing;
      if (this.busy || !this.saved || this.conflict || this.failure === "UNAVAILABLE") return false;
      this.draft = changeHomeLayout(this.requested(), key2, action, available ?? this.catalog.map((c) => c.key));
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
        GRANT_NOT_FOUND: "That temporary access is no longer active. Check the refreshed access list.",
        GRANT_EXPIRED: "That temporary access has already expired.",
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
      if (kind === "END_ACCESS") return { tone: "success", message: "Temporary access ended." };
      if (kind === "CANCEL_ACCESS") return { tone: "success", message: "Access request cancelled." };
    }
    if (kind === "RECOVER") return response.view?.controller?.status === "READY" ? { tone: "success", message: "Saved state verified. Recovery has not confirmed any proposal or reset your policy." } : { tone: "error", message: "Saved state is still unavailable. Your policy has not been reset. Check the recovery details." };
    return { tone: "status", message: "" };
  }
  function renderFeedback(node, feedback2) {
    if (feedback2.tone === "success") feedback2 = { ...feedback2, message: "" };
    if (node.dataset.tone !== feedback2.tone) node.dataset.tone = feedback2.tone;
    const role = feedback2.tone === "error" || feedback2.tone === "uncertain" ? "alert" : "status";
    if (node.getAttribute("role") !== role) node.setAttribute("role", role);
    if (node.getAttribute("aria-atomic") !== "true") node.setAttribute("aria-atomic", "true");
    if (node.textContent !== feedback2.message) node.textContent = feedback2.message;
    if (node.hidden !== (feedback2.message === "")) node.hidden = feedback2.message === "";
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
  function usageScore(record, now) {
    return record === void 0 ? 0 : record.score * 2 ** (-Math.max(0, now - record.lastOpenedAt) / usageHalfLifeMs);
  }

  // src/ui/category-order.ts
  function readCategoryOrder(input2) {
    if (!input2 || typeof input2 !== "object") return null;
    const v = input2;
    if (!["keys,mode,version", "catalog,keys,mode,version"].includes(Object.keys(v).sort().join(",")) || v.version !== 1 || !["custom", "alphabetic", "usage"].includes(v.mode) || !Array.isArray(v.keys) || v.keys.length > 4096 || new Set(v.keys).size !== v.keys.length || v.keys.some((k) => typeof k !== "string" || !k || k.length > 64 || categoryKey(k) !== k)) return null;
    if (v.catalog !== void 0 && !readHomeLayout(v.catalog)) return null;
    return structuredClone(v);
  }
  function categoryOrderKeys(saved, current2, legacy) {
    const before = saved?.catalog?.categories ?? [], after = reconcileHomeLayout(saved?.catalog ?? legacy, current2).categories;
    const renamed = new Map(before.map((c, i) => [c.key, after[i]?.key ?? c.key]));
    return [.../* @__PURE__ */ new Set([...(saved?.keys ?? legacy.categories.map((c) => c.key)).map((key2) => renamed.get(key2) ?? key2), ...after.map((c) => c.key)])];
  }
  function orderCategories(categories, mode, custom, entries2 = [], usage = {}, now = 0) {
    const scores = /* @__PURE__ */ new Map(), seen = /* @__PURE__ */ new Set();
    for (const entry of entries2) {
      const id = destinationId(entry);
      if (seen.has(id)) continue;
      seen.add(id);
      const key2 = categoryKey(entry.category || "Uncategorized");
      scores.set(key2, (scores.get(key2) ?? 0) + usageScore(usage[id], now));
    }
    const rank = (key2) => {
      const i = custom.indexOf(key2);
      return i < 0 ? custom.length : i;
    };
    return [...categories].sort((a, b) => (mode === "custom" ? rank(a.key) - rank(b.key) : mode === "usage" ? (scores.get(b.key) ?? 0) - (scores.get(a.key) ?? 0) : 0) || a.label.localeCompare(b.label, "en"));
  }
  var openCategoryOrderRepository = (factory = indexedDB, name = homeLayoutDatabase) => openRecord(factory, name, "category-order-v1", readCategoryOrder);
  var same5 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var CategoryOrderSession = class {
    constructor(repository, changed) {
      this.repository = repository;
      this.changed = changed;
    }
    saved = null;
    draft = null;
    busy = false;
    conflict = false;
    failure = null;
    loading = null;
    refresh() {
      if (this.loading || this.busy) return this.loading ?? Promise.resolve();
      this.loading = (async () => {
        try {
          const latest = await this.repository.load(), before = JSON.stringify([this.saved, this.draft, this.conflict, this.failure]);
          if (this.draft && latest.revision !== this.saved?.revision) {
            if (same5(latest.value, this.draft)) {
              this.draft = null;
              this.conflict = false;
              this.failure = null;
            } else this.conflict = true;
          }
          if (!this.draft) this.saved = latest;
          if (this.failure === "UNAVAILABLE") this.failure = null;
          if (before !== JSON.stringify([this.saved, this.draft, this.conflict, this.failure])) this.changed();
        } catch {
          if (this.failure !== "UNAVAILABLE") {
            this.failure = "UNAVAILABLE";
            this.changed();
          }
        }
      })().finally(() => {
        this.loading = null;
      });
      return this.loading;
    }
    async change(value) {
      if (this.loading) await this.loading;
      if (!this.saved || this.busy || this.conflict || this.failure === "UNAVAILABLE") return false;
      const draft = readCategoryOrder(value);
      if (!draft) return false;
      this.draft = draft;
      return this.persist();
    }
    async persist() {
      if (!this.saved || !this.draft || this.busy || this.conflict) return false;
      this.busy = true;
      this.changed();
      try {
        const result = await this.repository.save(this.saved.revision, this.draft);
        if (result.type === "SAVED") {
          this.saved = result.envelope;
          this.draft = null;
          this.failure = null;
          return true;
        }
        if (result.type === "CONFLICT") this.conflict = true;
        else this.failure = result.type;
      } catch {
        this.failure = "UNCERTAIN";
      } finally {
        this.busy = false;
        this.changed();
      }
      return false;
    }
    async retry() {
      await this.refresh();
      if (this.failure === "UNAVAILABLE" || this.conflict) return false;
      return this.draft ? this.persist() : !this.failure;
    }
    async useSaved() {
      if (this.loading) await this.loading;
      if (this.busy) return;
      this.busy = true;
      this.changed();
      try {
        this.saved = await this.repository.load();
        this.draft = null;
        this.failure = null;
        this.conflict = false;
      } catch {
        this.failure = "UNAVAILABLE";
      } finally {
        this.busy = false;
        this.changed();
      }
    }
  };

  // src/ui/home-organization.ts
  var el4 = (id) => document.getElementById(id);
  var same6 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function initializeHomeOrganization(changed, repository = () => openHomeLayoutRepository()) {
    let session = null, catalog = [], verified = false;
    let failed = false, opening = false, disposed2 = false, rowsKey = "";
    let storage = null;
    let ordering = null, orderFailed = false;
    async function openOrder() {
      try {
        const repo = await openCategoryOrderRepository();
        if (disposed2) {
          repo.close();
          return;
        }
        ordering = new CategoryOrderSession(repo, changed);
        orderFailed = false;
        await ordering.refresh();
      } catch {
        orderFailed = true;
      }
      if (!disposed2) changed();
    }
    const orderKeys = () => categoryOrderKeys(ordering?.saved?.value, catalog, layout());
    async function reorder(key2, target, visible) {
      if (!ordering) return;
      const next = [...visible], from = next.indexOf(key2), to = next.indexOf(target);
      if (from < 0 || to < 0 || from === to) return;
      next.splice(to, 0, next.splice(from, 1)[0]);
      await ordering.change({ version: 1, mode: "custom", keys: [...next, ...orderKeys().filter((k) => !next.includes(k))], catalog: layout() });
    }
    let icons = null, iconStorage = null, iconOpenFailed = false, iconsOpening = false;
    const pickIcon = categoryIconPicker((key2, value) => {
      void icons?.change(key2, value);
    });
    async function openIcons() {
      if (iconsOpening || disposed2) return;
      iconsOpening = true;
      try {
        iconStorage = await openCategoryIconRepository();
        if (disposed2) {
          iconStorage.close();
          return;
        }
        icons = new CategoryIconSession(iconStorage, () => {
          if (!disposed2) changed();
        });
        iconOpenFailed = false;
        await icons.refresh();
      } catch {
        iconOpenFailed = true;
      } finally {
        iconsOpening = false;
        if (!disposed2) changed();
      }
    }
    let deferredFocus = null;
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
        await session.refresh();
        if (disposed2) return;
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
      if (!same6(catalog, next)) {
        catalog = next;
        if (available) void session?.refresh(catalog);
      } else if (available && session?.saved === null && !session.busy && !session.failure) void session.refresh(catalog);
    }
    const layout = () => session?.current() ?? reconcileHomeLayout(null, catalog);
    async function change(key2, action, completeDirectory = false) {
      if (!session) return;
      const visible = layout().categories.filter((c) => (completeDirectory || c.visible) && catalog.some((item) => item.key === c.key && (completeDirectory ? item.members.length > 0 : item.count > 0))).map((c) => c.key);
      await session.change(key2, action, typeof action === "object" ? visible : void 0);
      changed();
    }
    function render2() {
      const sort = el4("sites-category-order");
      setProperty(sort, "value", ordering?.saved?.value?.mode ?? "custom");
      setProperty(sort, "disabled", !ordering?.saved || ordering.busy || ordering.conflict || !!ordering.failure || !!ordering.draft);
      const orderIssue = orderFailed || !!ordering?.failure || !!ordering?.conflict;
      setProperty(el4("category-order-error"), "hidden", !orderIssue);
      setProperty(el4("category-order-message"), "textContent", ordering?.conflict ? "Another window saved a newer order. Your change is retained; load the saved order to reconcile." : "Category order could not be saved or verified. Your change is retained; retry.");
      setProperty(el4("retry-category-order"), "hidden", !!ordering?.conflict);
      setProperty(el4("reload-category-order"), "hidden", !ordering?.conflict);
      const focus = document.activeElement;
      const focusCategory = focus?.closest("[data-layout-category]")?.dataset.layoutCategory;
      const focusAction = focus?.dataset.layoutAction;
      const working = session?.requested() ?? layout(), available = new Map(catalog.map((c) => [c.key, c]));
      const categories = working.categories.filter((c) => available.has(c.key));
      const iconChoices = icons?.draft ?? icons?.saved?.value;
      const key2 = JSON.stringify([categories, iconChoices]);
      if (key2 !== rowsKey) {
        rowsKey = key2;
        const list = el4("home-layout-list"), focus2 = document.activeElement;
        const category = focus2?.closest("[data-layout-category]")?.dataset.layoutCategory;
        const action = focus2?.dataset.layoutAction;
        const existing = new Map([...list.children].map((n) => [n.dataset.layoutCategory, n]));
        const rows = categories.map((c) => {
          const row = existing.get(c.key) ?? document.createElement("li");
          setProperty(row.dataset, "layoutCategory", c.key);
          if (!row.children.length) {
            const label = document.createElement("span");
            label.className = "layout-category-name";
            const choice = document.createElement("button");
            choice.type = "button";
            choice.className = "category-icon-choice";
            choice.dataset.layoutAction = "ICON";
            choice.setAttribute("aria-haspopup", "dialog");
            choice.append(icon("category"));
            choice.addEventListener("click", () => pickIcon(choice, row.dataset.layoutCategory, choice.dataset.icon ?? ""));
            row.append(choice, label);
          }
          setProperty(row.querySelector(".layout-category-name"), "textContent", c.label);
          const chosenIcon = iconChoices?.entries.find((e) => e.key === c.key)?.icon;
          setAttribute(row.querySelector("use"), "href", `#icon-${chosenIcon ?? defaultCategoryIcon(c.label)}`);
          const picker = row.querySelector(".category-icon-choice");
          setProperty(picker.dataset, "icon", chosenIcon ?? "");
          setAttribute(picker, "aria-label", `Choose icon for ${c.label}`);
          setProperty(picker, "title", `Choose icon for ${c.label}`);
          return row;
        });
        list.replaceChildren(...rows);
        if (category && action) rows.find((r) => r.dataset.layoutCategory === category)?.querySelector(`[data-layout-action="${action}"]`)?.focus({ preventScroll: true });
      }
      const locked = !session?.saved || session.busy || session.conflict || session.failure === "UNAVAILABLE";
      if (locked && session?.busy || icons?.busy) {
        if (focusCategory && focusAction) deferredFocus = { category: focusCategory, action: focusAction };
      }
      for (const row of el4("home-layout-list").children) {
        const category = available.get(row.dataset.layoutCategory);
        setProperty(row.querySelector(".category-icon-choice"), "disabled", !icons?.saved || icons.busy || icons.conflict || icons.failure === "UNAVAILABLE");
        setProperty(row, "title", `${category?.count ?? 0} allowed sites${category?.count === 0 ? " \xB7 no Home row while empty" : ""}`);
        for (const input2 of row.querySelectorAll("input")) setProperty(input2, "disabled", locked);
      }
      const draft = session?.draft != null;
      const unavailable = failed || session?.failure === "UNAVAILABLE";
      const message = session?.conflict ? "Another Atlas page saved a newer layout. Your arrangement is retained here. Load the saved layout before making further changes." : unavailable ? "Home preferences could not be verified. Saved policy is unaffected. Retry loading preferences." : session?.failure ? "Your arrangement is not verified as saved. It is retained in this page; retry before closing the page. Home still uses the acknowledged layout." : session?.busy ? session.draft ? "Saving Home layout\u2026" : "Loading Home preferences\u2026" : draft ? "Your arrangement is awaiting a verified save. Home still uses the acknowledged layout." : session?.saved ? "Category order saved. Hidden categories remain in All sites and search; pins are unchanged." : "Loading Home preferences\u2026";
      renderFeedback(el4("home-layout-status"), { message: session?.conflict || session?.failure || failed ? message : "", tone: session?.conflict || session?.failure || failed ? "error" : "status" });
      setProperty(el4("home-layout-warning"), "hidden", !unavailable && !session?.failure && !session?.conflict);
      setProperty(el4("home-layout-warning"), "textContent", message);
      setProperty(el4("retry-home-layout"), "hidden", !failed && !session?.failure);
      setProperty(el4("retry-home-layout"), "disabled", opening || session?.busy === true || session?.conflict === true);
      setProperty(el4("load-saved-home-layout"), "hidden", !session?.conflict);
      setProperty(el4("load-saved-home-layout"), "disabled", session?.busy === true);
      setProperty(el4("home-layout-empty"), "hidden", categories.length > 0);
      const iconMessage = icons?.conflict ? "Another Atlas page saved newer icons. Your choices are retained here. Load saved icons to reconcile." : iconOpenFailed || icons?.failure === "UNAVAILABLE" ? "Category icons could not be loaded. Retry; saved order and access rules are unchanged." : icons?.failure ? "Icon changes are not verified as saved. Your choices are retained here; retry before closing." : icons?.busy ? "Saving category icon\u2026" : icons?.saved ? "Icons save automatically. Automatic uses the category name." : "Loading category icons\u2026";
      renderFeedback(el4("category-icon-status"), { message: icons?.conflict || icons?.failure || iconOpenFailed ? iconMessage : "", tone: iconOpenFailed || icons?.failure || icons?.conflict ? "error" : "status" });
      setProperty(el4("retry-category-icons"), "hidden", !iconOpenFailed && !icons?.failure);
      setProperty(el4("retry-category-icons"), "disabled", iconsOpening || icons?.busy === true || icons?.conflict === true);
      setProperty(el4("load-saved-category-icons"), "hidden", !icons?.conflict);
      if (!locked && !icons?.busy) {
        if (document.activeElement === document.body || document.activeElement === el4("home-settings")) {
          if (deferredFocus && !el4("home-settings").closest("[hidden]")) {
            const row = [...el4("home-layout-list").children].find((n) => n.dataset.layoutCategory === deferredFocus.category);
            const target = row?.querySelector(`[data-layout-action="${deferredFocus.action}"]`);
            (target?.disabled ? row?.querySelector("input") : target)?.focus({ preventScroll: true });
          }
        }
        deferredFocus = null;
      }
    }
    el4("retry-home-layout").addEventListener("click", () => {
      void (async () => {
        if (!session) await open();
        else await session.retry(catalog);
        changed();
      })();
    });
    el4("load-saved-home-layout").addEventListener("click", () => {
      if (window.confirm("Load the newer saved Home layout? The unsaved arrangement in this page will be discarded. Policy, sites and pins will remain."))
        void session?.useSaved(catalog).then(changed);
    });
    el4("retry-category-icons").addEventListener("click", () => {
      void (icons ? icons.retry() : openIcons());
    });
    el4("load-saved-category-icons").addEventListener("click", () => {
      if (window.confirm("Discard these unsaved icon choices and load the newer saved icons?")) void icons?.useSaved();
    });
    window.addEventListener("pagehide", () => {
      disposed2 = true;
      storage?.close();
      iconStorage?.close();
    });
    el4("sites-category-order").addEventListener("change", () => {
      const mode = el4("sites-category-order").value;
      void ordering?.change({ version: 1, mode, keys: orderKeys(), catalog: layout() });
    });
    el4("retry-category-order").addEventListener("click", () => {
      void (ordering ? ordering.retry() : openOrder());
    });
    el4("reload-category-order").addEventListener("click", () => {
      void ordering?.useSaved();
    });
    window.addEventListener("pagehide", () => ordering?.repository.close());
    const initialized = Promise.all([open(), openIcons(), openOrder()]);
    return {
      observe,
      layout,
      render: render2,
      change,
      initialized,
      reorder,
      orderKeys,
      orderMode: () => ordering?.saved?.value?.mode ?? "custom",
      icon: (key2, label) => icons?.icon(key2, label) ?? defaultCategoryIcon(label),
      canMove: () => !!session?.saved && !session.busy && !session.conflict && !session.failure && !!ordering?.saved && !ordering.busy && !ordering.conflict && !ordering.draft && ordering.failure === null,
      loading: () => opening || !session?.saved && !failed && !session?.failure,
      refresh: () => Promise.all([verified ? session?.refresh(catalog) : void 0, icons?.refresh(), ordering?.refresh()]),
      session: () => session
    };
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

  // src/ui/home-greylist.ts
  var el5 = (id) => document.getElementById(id);
  function initializeHomeGreylist(options) {
    const rows = /* @__PURE__ */ new Map();
    let current2 = null;
    let selectedTab = "";
    async function cancelAccess2(kind, requestId, hosts) {
      const origin = current2?.contexts.find((c) => String(c.tabId) === selectedTab && c.hostname && hosts.includes(c.hostname));
      const response = await options.send({ kind, requestId });
      if (response?.result?.type === "COMMITTED" && origin) options.dismiss(origin.contextId, origin.navigationId);
    }
    const contextAction = (tabId, contextId, command) => {
      if (current2?.contexts.some((c) => c.tabId === tabId && c.contextId === contextId)) void options.send(command);
    };
    function row(item, disabled) {
      let record = rows.get(item.id);
      if (!record) {
        const node = document.createElement("li");
        node.className = "temporary-row";
        const copy = document.createElement("span");
        copy.className = "temporary-copy";
        const name = document.createElement("strong");
        name.className = "temporary-name";
        const scope2 = document.createElement("span");
        scope2.className = "temporary-scope";
        copy.append(name, scope2);
        const actions = document.createElement("span");
        actions.className = "temporary-actions";
        const cancel2 = document.createElement("button");
        cancel2.type = "button";
        cancel2.className = "access-cancel";
        cancel2.textContent = "Cancel";
        const status2 = document.createElement("button");
        status2.type = "button";
        status2.className = "access-signal";
        record = { node, item };
        const saved = record;
        status2.addEventListener("click", () => saved.item.run?.());
        cancel2.addEventListener("click", () => saved.item.cancel?.());
        actions.append(cancel2, status2);
        node.append(copy, actions);
        rows.set(item.id, record);
      }
      record.item = item;
      setProperty(record.node.querySelector(".temporary-name"), "textContent", item.name);
      const scope = record.node.querySelector(".temporary-scope");
      setProperty(scope, "textContent", item.scope);
      setProperty(scope, "title", item.scope);
      const status = record.node.querySelector(".access-signal");
      setProperty(status, "textContent", item.status);
      setProperty(status.dataset, "tone", item.tone);
      setProperty(status, "disabled", disabled || !item.run);
      const cancel = record.node.querySelector(".access-cancel");
      setProperty(cancel, "hidden", !item.cancel);
      setProperty(cancel, "disabled", disabled);
      return record.node;
    }
    return { render(view2, now, busy2, selected2) {
      current2 = view2;
      selectedTab = selected2;
      const summary = homeAccessSummary(view2, now), items = [], journeys = [];
      const disabled = busy2 || !summary.available || !canQueueOperation(view2?.controller);
      for (const p of summary.pending) {
        const waiting = p.outcome === "WAIT";
        items.push({
          id: `request:${p.requestId}`,
          name: options.label(p.hostnames[0]),
          scope: p.hostnames.join(", "),
          tone: waiting ? "waiting" : "ready",
          status: waiting ? `Waiting ${countdown(p.readyAt, now)}` : `Allow \xB7 ${countdown(p.confirmBy, now)}`,
          cancel: () => void cancelAccess2("CANCEL_ACCESS", p.requestId, p.hostnames),
          ...!waiting ? { run: () => void options.send({ kind: "CONFIRM_ACCESS", requestId: p.requestId }) } : {}
        });
      }
      for (const g of summary.grants) items.push({
        id: `grant:${g.requestId}`,
        name: options.label(g.hostnames[0]),
        scope: g.hostnames.join(", "),
        tone: "active",
        status: `Active ${countdown(g.expiresAt, now)} \xB7 Open`,
        cancel: () => void cancelAccess2("END_ACCESS", g.requestId, g.hostnames),
        run: () => void options.send({ kind: "OPEN_DESTINATION", url: `https://${g.hostnames[0]}/` })
      });
      const context = view2?.contexts.find((c) => String(c.tabId) === selected2);
      if (context?.hostname && !summary.pending.some((p) => p.hostnames.includes(context.hostname)) && !summary.grants.some((g) => g.hostnames.includes(context.hostname))) {
        const decision = context.latest?.type === "ASSESSMENT" ? context.latest.decision : null, scope = context.accessScope;
        const item = { id: `context:${context.contextId}`, name: options.label(context.hostname), scope: context.hostname, status: "Unavailable", tone: "neutral" };
        if (decision?.outcome === "GREYLIST") {
          item.cancel = () => options.dismiss(context.contextId, context.navigationId);
          if (scope?.status === "READY") {
            item.scope = scope.hostnames.join(", ");
            item.status = "Request access";
            item.run = () => contextAction(context.tabId, context.contextId, { kind: "START_ACCESS", tabId: context.tabId, scopeId: scope.id });
          } else {
            item.status = "Checking address\u2026";
            if (!disabled) options.prepare(context);
          }
        } else if (decision?.outcome === "ALLOW") {
          item.status = "Allowed";
        } else {
          const copy = accessContextCopy(context);
          item.status = copy.label;
          item.scope = copy.description;
          if (copy.retryHome) {
            item.status = "Retry site";
            item.run = () => contextAction(context.tabId, context.contextId, { kind: "OPEN_HOME", tabId: context.tabId });
          }
        }
        if (context.effect === "FAILED") item.scope = "Firefox could not remove this page. Close the affected tab.";
        if (decision?.outcome !== "ALLOW") items.unshift(item);
      }
      if (selected2 && !context) items.unshift({ id: "missing-context", name: "Tab unavailable", scope: "The original tab has closed. Open the site again to request access.", status: "Closed", tone: "neutral" });
      for (const c of summary.journeys) journeys.push({
        id: `journey:${c.contextId}:${c.journey.id}`,
        name: options.label(c.journey.rootHostname),
        scope: `Journey \xB7 Tab ${c.tabId}`,
        tone: "active",
        status: `${countdown(c.journey.expiresAt, now)} \xB7 End`,
        run: () => contextAction(c.tabId, c.contextId, { kind: "CANCEL_JOURNEY", tabId: c.tabId })
      });
      if (context?.retry && !summary.journeys.some((c) => c.tabId === context.tabId)) {
        const retry = context.retry;
        journeys.push({
          id: `retry:${context.contextId}`,
          name: retry.destinationLabel,
          scope: "Journey ended",
          tone: "neutral",
          status: "Start again",
          ...context.effect !== "REMOVING" ? { run: () => contextAction(context.tabId, context.contextId, { kind: "RESTART_JOURNEY", tabId: context.tabId, journeyId: retry.journeyId }) } : {}
        });
      }
      const focused = document.activeElement;
      reconcileChildren(el5("pending-access-list"), items.map((i) => row(i, disabled)));
      reconcileChildren(el5("other-journeys"), journeys.map((i) => row(i, disabled)));
      const retained = new Set([...items, ...journeys].map((i) => i.id));
      for (const id of rows.keys()) if (!retained.has(id)) rows.delete(id);
      if (focused && !focused.isConnected) el5("temporary-title").focus({ preventScroll: true });
      setProperty(el5("temporary-count"), "textContent", items.length ? `(${items.length})` : "");
      setProperty(el5("home-journeys-count"), "textContent", journeys.length ? `(${journeys.length})` : "");
      setProperty(el5("home-journeys-section"), "hidden", !journeys.length);
      setProperty(el5("temporary-empty"), "hidden", !summary.available || !!items.length);
      setProperty(el5("temporary-unavailable"), "hidden", summary.available);
      setProperty(el5("temporary-section"), "hidden", summary.available && items.length === 0);
    } };
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
    let current2 = emptyNavigationState();
    try {
      current2 = readNavigationState(JSON.parse(storage.getItem(navigationStorageKey) ?? "null")) ?? current2;
    } catch {
    }
    return {
      value: () => current2,
      save(value) {
        const checked = readNavigationState(value);
        if (!checked) return;
        current2 = checked;
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

  // src/ui/search-prefill.ts
  function siteSearchPrefill(query) {
    const name = query.trim().slice(0, 100);
    const target = /^(https?:\/\/|[^\s/]+\.[^\s/]+)/i.test(query.trim()) ? normalizeTarget(query.trim()) : null;
    return { name, hostname: target?.hostname ?? "" };
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

  // src/ui/presentation-storage.ts
  function savePresentation(source, key2, value) {
    let storage;
    try {
      storage = typeof source === "function" ? source() : source;
    } catch {
      return "UNCERTAIN";
    }
    let before;
    try {
      before = storage.getItem(key2);
    } catch {
    }
    try {
      storage.setItem(key2, value);
      return "SAVED";
    } catch {
      try {
        const after = storage.getItem(key2);
        if (after === value) return "SAVED";
        return before !== void 0 && after === before ? "FAILED" : "UNCERTAIN";
      } catch {
        return "UNCERTAIN";
      }
    }
  }

  // src/ui/subdomain-scope.ts
  function canUseSubdomainScope(hostname2) {
    const target = normalizeTarget({ hostname: hostname2.trim() });
    if (!target) return false;
    const parsed = parse(target.hostname, { allowPrivateDomains: true });
    return !parsed.isIp && (parsed.isIcann === true || parsed.isPrivate === true) && parsed.domain !== null && parsed.publicSuffix !== target.hostname;
  }
  function subdomainScopeDescription(hostname2) {
    const target = normalizeTarget({ hostname: hostname2.trim() });
    if (!target || !canUseSubdomainScope(hostname2)) return "Choose a registered hostname before including all subdomains.";
    return `Includes ${target.hostname} and every current or future subdomain at any depth. This is broad permission; enable it only when you deliberately trust the whole scope. Manual and managed blocking rules still apply to this scope.`;
  }

  // src/ui/destination-draft.ts
  var samePolicy3 = (a, b) => ["whitelist", "blacklist", "whitelistSubdomains"].every((key2) => {
    const left = a[key2] ?? [], right = b[key2] ?? [];
    return Array.isArray(left) && Array.isArray(right) && JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
  });
  var metadataFingerprint = (entries2) => JSON.stringify(entries2);
  var same7 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  var canonicalHosts = (hosts) => Array.isArray(hosts) && hosts.length <= 1e4 && hosts.every((host2) => typeof host2 === "string" && normalizeTarget({ hostname: host2 })?.hostname === host2) && new Set(hosts).size === hosts.length;
  function draftBaseline(snapshot, preferences, pins2) {
    return structuredClone({
      policyRevision: snapshot.policyRevision,
      policy: snapshot.policy,
      metadata: preferences.destinations,
      pins: pins2,
      entries: baselineEntries(snapshot.policy, preferences.destinations, pins2)
    });
  }
  function baselineEntries(policy, metadata2, pins2, mergeSubdomains = true) {
    const entries2 = policyDestinationIndex(policy, metadata2, pins2, mergeSubdomains);
    const pinned = new Set(pinnedDestinations(entries2, pins2).map(destinationId));
    return entries2.map((entry) => ({
      metadata: {
        id: destinationId(entry),
        label: entry.label,
        category: entry.category,
        primaryHostname: entry.hostname,
        hostnames: entry.hostnames
      },
      classification: "PRESERVE",
      pinned: pinned.has(destinationId(entry)),
      ...policy.whitelistSubdomains?.includes(entry.hostname) ? { includeSubdomains: true } : {}
    }));
  }
  function newDestinationDraft(id, baseline) {
    return { version: 1, id, baseline: structuredClone(baseline), changes: [], editor: null };
  }
  function stageDestination(draft, id, after) {
    const before = draft.changes.find((item) => item.id === id)?.before ?? draft.baseline.entries.find((item) => item.metadata.id === id) ?? null;
    const change = { id, before, after: after ? structuredClone(after) : null };
    const changes = draft.changes.filter((item) => item.id !== id);
    if (before !== null || after !== null) {
      if (!same7(before, after)) changes.splice(Math.min(draft.changes.findIndex((item) => item.id === id) < 0 ? changes.length : draft.changes.findIndex((item) => item.id === id), changes.length), 0, change);
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
    if (!same7(draft.baseline.pins, baseline.pins)) stale.push("Saved pins changed");
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
    const scopes = (baseline.policy.whitelistSubdomains ?? []).filter((host2) => !removed.has(host2));
    for (const change of draft.changes) {
      const after = change.after;
      if (!after) continue;
      if (after.classification === "PRESERVE") {
        if (!change.before || !same7([...change.before.metadata.hostnames].sort(), [...after.metadata.hostnames].sort()))
          conflicts.push({ id: change.id, message: "Choose Allowed or Blocked when changing exact addresses." });
        if (!!change.before?.includeSubdomains !== !!after.includeSubdomains)
          conflicts.push({ id: change.id, message: "Choose Allowed to change access for all subdomains; display-only edits cannot change permission." });
        after.metadata.hostnames.forEach((host2) => {
          if (baseline.policy.whitelist.includes(host2)) whitelist.push(host2);
          if (baseline.policy.blacklist.includes(host2)) blacklist.push(host2);
        });
        scopes.push(...(baseline.policy.whitelistSubdomains ?? []).filter((host2) => after.metadata.hostnames.includes(host2)));
      } else {
        (after.classification === "WHITELIST" ? whitelist : blacklist).push(...after.metadata.hostnames);
        if (after.classification === "WHITELIST") {
          scopes.push(...(baseline.policy.whitelistSubdomains ?? []).filter((host2) => host2 !== after.metadata.primaryHostname && after.metadata.hostnames.includes(host2)));
          if (after.includeSubdomains) {
            if (!canUseSubdomainScope(after.metadata.primaryHostname)) conflicts.push({ id: change.id, message: "Choose a registered hostname for all-subdomain access; public and hosting suffixes cannot be trusted as a whole." });
            else scopes.push(after.metadata.primaryHostname);
          }
        } else if (after.includeSubdomains) conflicts.push({ id: change.id, message: "All-subdomain access is available only for allowed-site changes." });
      }
    }
    const candidatePolicy = {
      whitelist: [...new Set(whitelist)].sort(),
      blacklist: [...new Set(blacklist)].sort(),
      ...scopes.length || baseline.policy.whitelistSubdomains !== void 0 ? { whitelistSubdomains: [...new Set(scopes)].sort() } : {}
    };
    if (evaluate("draft-validation.example", candidatePolicy).reason === "INVALID_POLICY") conflicts.push({ id: "", message: "Core rejected the complete candidate policy." });
    for (const item of draft.changes) if (item.after?.pinned && !item.after.metadata.hostnames.some((host2) => evaluate({ hostname: host2 }, candidatePolicy).outcome === "ALLOW"))
      conflicts.push({ id: item.id, message: "This site editor cannot pin a blocked site. Existing bookmark shortcuts do not change access." });
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
    if (!assessment.candidatePolicy || !assessment.policyChanged || assessment.stale.length) return assessment;
    const removal = isWhitelistRemoval(snapshot.policy, assessment.candidatePolicy);
    if (snapshot.vaultState.pendingProposal && !removal) return assessment;
    const now = Math.max(snapshot.accessState.lastObservedAt, snapshot.vaultState.lastObservedAt, snapshot.journeyState.lastObservedAt);
    const operation = removal ? { kind: "REMOVE_WHITELIST", candidatePolicy: assessment.candidatePolicy, basePolicyRevision: baseline.policyRevision } : { kind: "PROPOSE_POLICY", candidatePolicy: assessment.candidatePolicy };
    const plan = planAtlasOperation(operation, { snapshot, now, configuration: snapshot.configuration });
    return plan.candidateSnapshot ? assessment : {
      ...assessment,
      candidatePolicy: null,
      conflicts: [...assessment.conflicts, { id: "", message: "Core cannot prepare this candidate against the current snapshot." }]
    };
  }
  function reconcileDraft(draft, baseline) {
    const conflicts = [];
    const changes = draft.changes.map((change) => {
      const current2 = baseline.entries.find((entry) => entry.metadata.id === change.id) ?? null;
      if (!same7(current2, change.before)) conflicts.push({ id: change.id, message: "Committed destination details changed. Review current and proposed values, then explicitly accept this result, edit the item or remove it." });
      else if (change.before && !samePolicy3(
        {
          whitelist: draft.baseline.policy.whitelist.filter((h) => change.before.metadata.hostnames.includes(h)),
          blacklist: draft.baseline.policy.blacklist.filter((h) => change.before.metadata.hostnames.includes(h)),
          whitelistSubdomains: draft.baseline.policy.whitelistSubdomains?.filter((h) => change.before.metadata.hostnames.includes(h)) ?? []
        },
        { whitelist: baseline.policy.whitelist.filter((h) => change.before.metadata.hostnames.includes(h)), blacklist: baseline.policy.blacklist.filter((h) => change.before.metadata.hostnames.includes(h)), whitelistSubdomains: baseline.policy.whitelistSubdomains?.filter((h) => change.before.metadata.hostnames.includes(h)) ?? [] }
      ))
        conflicts.push({ id: change.id, message: "Committed exact rules changed. Review current and proposed classifications, then explicitly accept this result, edit the item or remove it." });
      return { ...change, before: current2 };
    });
    const next = { ...draft, baseline: structuredClone(baseline), changes };
    return { draft: next, conflicts: [...conflicts, ...assessDraft(next, baseline).conflicts] };
  }
  function destinationChangeSummary(change, beforePolicy, afterPolicy) {
    const before = change.before, after = change.after;
    const remaining = after === null ? before?.metadata.hostnames.filter((host2) => evaluate({ hostname: host2 }, afterPolicy).reason === "WHITELISTED_SCOPE") ?? [] : [];
    const classification2 = (item, policy) => item ? [...new Set(item.metadata.hostnames.map((host2) => evaluate({ hostname: host2 }, policy).outcome === "ALLOW" ? "Whitelist" : evaluate({ hostname: host2 }, policy).outcome === "DENY" ? "Blacklist" : "Greylist"))].join(" / ") : "No explicit rule";
    return [
      after?.metadata.label ?? before?.metadata.label ?? change.id,
      `${before === null ? "Addition" : after === null ? "Removal" : "Modification"} \xB7 ${classification2(before, beforePolicy)} \u2192 ${classification2(after, afterPolicy)}`,
      `Exact hosts: ${before?.metadata.hostnames.join(", ") ?? "(none)"} \u2192 ${after?.metadata.hostnames.join(", ") ?? "(none)"}`,
      ...remaining.length ? [`Still allowed by another saved scope: ${remaining.join(", ")}. Removing these exact entries does not remove the parent scope.`] : [],
      ...(beforePolicy.whitelistSubdomains ?? []).some((host2) => before?.metadata.hostnames.includes(host2)) || (afterPolicy.whitelistSubdomains ?? []).some((host2) => after?.metadata.hostnames.includes(host2)) ? [`Domain + all subdomains: ${(beforePolicy.whitelistSubdomains ?? []).filter((host2) => before?.metadata.hostnames.includes(host2)).join(", ") || "(none)"} \u2192 ${(afterPolicy.whitelistSubdomains ?? []).filter((host2) => after?.metadata.hostnames.includes(host2)).join(", ") || "(none)"}. All current/future descendants; manual and managed blocking still apply to additional subdomains.`] : [],
      ...before && after && before.metadata.label !== after.metadata.label ? [`Name: ${before.metadata.label} \u2192 ${after.metadata.label}`] : [],
      `Category: ${before?.metadata.category ?? "(none)"} \u2192 ${after?.metadata.category ?? "(removed)"} \xB7 Pin: ${before?.pinned ? "Pinned" : "Not pinned"} \u2192 ${after?.pinned ? "Pinned" : "Not pinned"}`
    ];
  }
  function readDestinationDraft(value) {
    if (!value || typeof value !== "object") return null;
    const item = value;
    if (item.version !== 1 || typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(item.id) || !item.baseline || !Number.isSafeInteger(item.baseline.policyRevision) || item.baseline.policyRevision < 0 || !item.baseline.policy || !canonicalHosts(item.baseline.policy.whitelist) || !canonicalHosts(item.baseline.policy.blacklist) || item.baseline.policy.whitelistSubdomains !== void 0 && !canonicalHosts(item.baseline.policy.whitelistSubdomains) || evaluate("draft-validation.example", item.baseline.policy).reason === "INVALID_POLICY" || !Array.isArray(item.baseline.pins) || item.baseline.pins.length > 200 || !item.baseline.pins.every(validDestinationId) || !Array.isArray(item.baseline.metadata) || !Array.isArray(item.baseline.entries) || item.baseline.entries.length > 1e4 || !Array.isArray(item.changes) || item.changes.length > 2e3) return null;
    const validEntry = (entry) => entry !== null && typeof entry === "object" && ["WHITELIST", "BLACKLIST", "PRESERVE"].includes(entry.classification) && typeof entry.pinned === "boolean" && (entry.includeSubdomains === void 0 || typeof entry.includeSubdomains === "boolean") && readDestinationPreferences({ version: 1, destinations: [entry.metadata], pending: null }).destinations.length === 1;
    if (!item.baseline.entries.every(validEntry) || new Set(item.baseline.entries.map((e) => e.metadata.id)).size !== item.baseline.entries.length || readDestinationPreferences({ version: 1, destinations: item.baseline.metadata, pending: null }).destinations.length !== item.baseline.metadata.length || item.changes.some((change) => !change || !validDestinationId(change.id) || change.before === null && change.after === null || change.before !== null && (!validEntry(change.before) || change.before.metadata.id !== change.id) || change.after !== null && (!validEntry(change.after) || change.after.metadata.id !== change.id)) || new Set(item.changes.map((c) => c.id)).size !== item.changes.length) return null;
    const expected = baselineEntries(item.baseline.policy, item.baseline.metadata, item.baseline.pins);
    const legacy = !same7(expected, item.baseline.entries) && same7(baselineEntries(item.baseline.policy, item.baseline.metadata, item.baseline.pins, false), item.baseline.entries);
    if (!same7(expected, item.baseline.entries) && !legacy || item.changes.some((change) => !same7(
      change.before,
      item.baseline.entries.find((entry) => entry.metadata.id === change.id) ?? null
    ))) return null;
    if (item.editor !== null) {
      const e = item.editor;
      if (!e || e.id !== null && !validDestinationId(e.id) || typeof e.name !== "string" || e.name.length > 100 || typeof e.hostname !== "string" || e.hostname.length > 253 || typeof e.category !== "string" || e.category.length > 64 || typeof e.extra !== "string" || e.extra.length > 4e3 || !["WHITELIST", "BLACKLIST", "PRESERVE"].includes(e.access) || typeof e.www !== "boolean" || typeof e.pinned !== "boolean" || e.includeSubdomains !== void 0 && typeof e.includeSubdomains !== "boolean") return null;
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
      if (!d || d.editor !== null || !d.changes.length || !["POLICY", "DISPLAY", "REMOVAL"].includes(r.kind) || !["PREPARED", "PROPOSED", "APPLYING", "DONE", "KEPT", "RESOLVED"].includes(r.phase) || !Number.isSafeInteger(r.expectedProposalId) || r.expectedProposalId < 1 || r.proposalId !== null && (!Number.isSafeInteger(r.proposalId) || r.proposalId < 1) || !Number.isSafeInteger(r.baseConfigurationRevision) || r.baseConfigurationRevision < 0 || r.owner !== null && (typeof r.owner !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(r.owner)) || !r.candidatePolicy || !Array.isArray(r.candidatePolicy.whitelist) || !Array.isArray(r.candidatePolicy.blacklist) || evaluate("receipt-validation.example", r.candidatePolicy).reason === "INVALID_POLICY") return null;
      const candidate = assessDraft(d, d.baseline).candidatePolicy;
      if (!candidate || !samePolicy3(candidate, r.candidatePolicy)) return null;
      if (r.kind === "DISPLAY" && !samePolicy3(d.baseline.policy, r.candidatePolicy)) return null;
      if (r.kind === "REMOVAL" && (r.proposalId !== null || !isWhitelistRemoval(d.baseline.policy, r.candidatePolicy))) return null;
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
            let current2;
            try {
              current2 = decode(request.result);
            } catch {
              result = { type: "CONFLICT", envelope: null };
              return;
            }
            if (current2.revision !== expectedRevision) {
              result = { type: "CONFLICT", envelope: current2 };
              return;
            }
            const envelope = { revision: current2.revision + 1, value: structuredClone(value) };
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
    editorWrite = null;
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
      const next = structuredClone(value);
      this.editorWrite = null;
      this.value = next;
      this.unsaved = true;
      this.changed();
      if (!this.loaded || this.conflict || this.failure && !explicitRetry) return Promise.resolve(false);
      let saved = false;
      const captured = structuredClone(value);
      this.queue = this.queue.then(async () => {
        saved = await this.write(captured, explicitRetry);
      }).catch(() => {
        this.failure = "UNCERTAIN";
        this.changed();
      });
      return this.queue.then(() => saved);
    }
    setDraft(draft) {
      return this.set({ ...this.value, draft });
    }
    /** Raw inputs only. Persist the newest queued editor, never coalesce a stage or receipt. */
    setEditor(editor) {
      const draft = this.value.draft;
      if (!draft?.editor || editor && editor.id !== draft.editor.id) return;
      if (editor === null) {
        void this.setDraft({ ...draft, editor: null });
        return;
      }
      const value = { ...this.value, draft: { ...draft, editor: structuredClone(editor) } };
      this.value = value;
      this.unsaved = true;
      this.changed();
      if (!this.loaded || this.conflict || this.failure) return;
      if (this.editorWrite) {
        this.editorWrite.value = value;
        return;
      }
      const slot = { value };
      this.editorWrite = slot;
      this.queue = this.queue.then(async () => {
        if (this.editorWrite === slot) this.editorWrite = null;
        await this.write(structuredClone(slot.value), false);
      }).catch(() => {
        this.failure = "UNCERTAIN";
        this.changed();
      });
    }
    async write(captured, explicitRetry) {
      if (this.conflict || this.failure && !explicitRetry) return false;
      const result = await this.repository.save(this.revision, captured);
      if (result.type === "SAVED") {
        this.revision = result.envelope.revision;
        this.failure = null;
        this.unsaved = JSON.stringify(this.value) !== JSON.stringify(captured);
      } else if (result.type === "CONFLICT") this.conflict = true;
      else this.failure = result.type;
      this.changed();
      return result.type === "SAVED";
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
    if (receipt.kind === "REMOVAL") {
      if (!isWhitelistRemoval(receipt.draft.baseline.policy, receipt.candidatePolicy)) return "INVALID";
      return snapshot.policyRevision === receipt.draft.baseline.policyRevision + 1 && snapshot.configurationRevision === receipt.baseConfigurationRevision && samePolicy3(snapshot.policy, receipt.candidatePolicy) ? "COMMITTED" : "RESOLVED";
    }
    const id = receipt.proposalId ?? receipt.expectedProposalId;
    const proposal = snapshot.vaultState.pendingProposal;
    if (proposal?.id === id && proposal.basePolicyRevision === receipt.draft.baseline.policyRevision && proposal.baseConfigurationRevision === receipt.baseConfigurationRevision && samePolicy3(proposal.candidatePolicy, receipt.candidatePolicy)) return "WAITING";
    if (snapshot.vaultState.lastApplied?.proposalId === id && snapshot.policyRevision === receipt.draft.baseline.policyRevision + 1 && samePolicy3(snapshot.policy, receipt.candidatePolicy)) return "COMMITTED";
    return receipt.proposalId === null ? "UNKNOWN" : "RESOLVED";
  }

  // src/ui/destination-editor.ts
  function initializeDestinationEditor(options) {
    const element3 = (id) => document.getElementById(id);
    const input2 = (id) => element3(id);
    const text3 = (id, value) => setProperty(element3(id), "textContent", value);
    const json2 = (value) => JSON.stringify(value);
    let editorKey = "";
    function currentEditor() {
      const editor = options.editor();
      if (!editor) return null;
      return {
        id: editor.id,
        name: input2("site-name").value,
        hostname: input2("site-hostname").value,
        category: input2("site-category").value,
        access: element3("site-access").value,
        www: input2("site-www").checked,
        extra: input2("site-extra").value,
        pinned: input2("site-pin").checked,
        ...input2("site-subdomains").checked ? { includeSubdomains: true } : {}
      };
    }
    function restoreEditor() {
      if (!options.live()) return;
      const editor = options.editor();
      if (!editor) {
        setProperty(element3("site-draft"), "hidden", true);
        editorKey = "";
        return;
      }
      if (json2(editor) === editorKey) return;
      clearFieldError();
      editorKey = json2(editor);
      setProperty(element3("site-draft"), "hidden", false);
      text3("site-draft-title", editor.id ? `Edit ${editor.name || "destination"}` : "Add a site");
      setProperty(input2("site-name"), "value", editor.name);
      setProperty(input2("site-hostname"), "value", editor.hostname);
      setProperty(input2("site-category"), "value", editor.category);
      setProperty(element3("site-preserve-rules"), "hidden", editor.id === null);
      setProperty(element3("site-access"), "value", editor.access);
      setProperty(input2("site-www"), "checked", editor.www);
      setProperty(input2("site-extra"), "value", editor.extra);
      setProperty(input2("site-pin"), "checked", editor.pinned);
      setProperty(input2("site-subdomains"), "checked", editor.includeSubdomains === true);
      scope();
    }
    function scope(locked = false) {
      const counterpart = commonWwwCounterpart(input2("site-hostname").value.trim());
      setProperty(input2("site-www"), "disabled", locked || counterpart === null);
      text3("site-www-label", counterpart === null ? "No common www counterpart for this hostname" : `Include ${counterpart}`);
      const hosts = explicitDestinationHosts(input2("site-hostname").value.trim(), counterpart !== null && input2("site-www").checked, input2("site-extra").value);
      text3("site-scope-preview", hosts ? `Proposed exact hosts: ${hosts.join(", ")}` : "Enter valid exact hostnames. Wildcards are unsupported.");
      const access = element3("site-access").value;
      const scopeAvailable = canUseSubdomainScope(input2("site-hostname").value);
      setProperty(input2("site-subdomains"), "disabled", locked || access !== "WHITELIST" || !scopeAvailable);
      text3("site-subdomains-label", `Also allow all subdomains of ${input2("site-hostname").value.trim() || "this hostname"}`);
      text3("site-subdomains-help", subdomainScopeDescription(input2("site-hostname").value) + " Exact listed hostnames keep their existing Allowed sites precedence. Additional subdomains remain subject to the managed list. Adding scope uses Vault; removing it has no cooldown.");
      setProperty(element3("site-subdomains-help"), "hidden", !input2("site-subdomains").checked && scopeAvailable);
      if (input2("site-subdomains").checked && hosts && access !== "BLACKLIST") text3("site-scope-preview", `Exact hosts: ${hosts.join(", ")}. Additional scope: ${hosts[0]} and all current/future subdomains at any depth. Managed blocking applies to additional subdomains.`);
      const meaningfulPin = access !== "BLACKLIST" && (access !== "PRESERVE" || hosts?.some((host2) => evaluate({ hostname: host2 }, options.policy() ?? { whitelist: [], blacklist: [] }).outcome === "ALLOW"));
      setProperty(element3("site-pin-field"), "hidden", !meaningfulPin);
      setProperty(input2("site-pin"), "disabled", locked || !meaningfulPin);
      setProperty(element3("save-site-display"), "hidden", !options.editor()?.id || access !== "PRESERVE");
    }
    function clearFieldError() {
      for (const id of ["site-name", "site-hostname", "site-extra", "site-category"])
        if (input2(id).getAttribute("aria-invalid") === "true") setAttribute(input2(id), "aria-invalid", "false");
      renderFeedback(element3("site-field-error"), { tone: "status", message: "" });
    }
    return {
      read: currentEditor,
      restore: restoreEditor,
      scope,
      clearError: clearFieldError,
      remember(editor) {
        editorKey = json2(editor);
      },
      lock(locked) {
        for (const field of element3("site-form").querySelectorAll("input, select"))
          if (!["site-www", "site-pin", "site-subdomains"].includes(field.id)) setProperty(field, "disabled", locked);
        if (options.editor()) scope(locked);
      }
    };
  }

  // src/ui/destination-change-view.ts
  function destinationChangeView(change, beforePolicy, afterPolicy) {
    const { before, after } = change;
    const classification2 = (item, policy) => item ? [...new Set(item.metadata.hostnames.map((host2) => {
      const decision = evaluate({ hostname: host2 }, policy);
      return decision.outcome === "ALLOW" ? "Allowed" : decision.outcome === "DENY" ? "Blocked" : "Requires access request";
    }))].join(" / ") : "No explicit rule";
    const scope = (item, policy) => (policy.whitelistSubdomains ?? []).filter((h) => item?.metadata.hostnames.includes(h)).join(", ") || "Not included";
    const rows = [
      ["Access", classification2(before, beforePolicy), classification2(after, afterPolicy)],
      ["Exact hosts", before?.metadata.hostnames.join(", ") ?? "(none)", after?.metadata.hostnames.join(", ") ?? "(none)"],
      ["Subdomain bases", scope(before, beforePolicy), scope(after, afterPolicy)],
      ["Name", before?.metadata.label ?? "(none)", after?.metadata.label ?? "(none)"],
      ["Category", before?.metadata.category ?? "(none)", after?.metadata.category ?? "(none)"],
      ["Home pin", before?.pinned ? "Pinned" : "Not pinned", after?.pinned ? "Pinned" : "Not pinned"]
    ].filter((row, i) => i < 2 || row[1] !== row[2]);
    const full = destinationChangeSummary(change, beforePolicy, afterPolicy);
    return {
      name: full[0],
      kind: !before ? "New site" : !after ? "Removal" : "Prepared change",
      rows,
      warnings: full.filter((line) => line.startsWith("Still allowed by another saved scope:") || line.startsWith("Domain + all subdomains:")),
      full
    };
  }
  function renderDestinationChange(container, change, before, after) {
    const view2 = destinationChangeView(change, before, after);
    const heading = document.createElement("h3");
    heading.textContent = view2.name;
    const kind = document.createElement("p");
    kind.className = "change-kind";
    kind.textContent = view2.kind;
    const table = document.createElement("table");
    table.className = "change-comparison";
    const head = document.createElement("thead"), row = document.createElement("tr");
    for (const value of ["Change", "Current", "Proposed"]) {
      const cell = document.createElement("th");
      cell.textContent = value;
      row.append(cell);
    }
    head.append(row);
    table.append(head);
    const body = document.createElement("tbody");
    for (const values of view2.rows) {
      const tr = document.createElement("tr");
      for (const value of values) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body);
    const warnings = view2.warnings.map((message) => {
      const p = document.createElement("p");
      p.className = "scope-note";
      p.textContent = message;
      return p;
    });
    const details = document.createElement("details"), summary = document.createElement("summary"), full = document.createElement("p");
    details.className = "technical-review";
    summary.textContent = "Technical details";
    full.textContent = view2.full.join("\n");
    details.append(summary, full);
    container.replaceChildren(heading, kind, table, ...warnings, details);
  }

  // src/ui/site-directory.ts
  function directoryCategories(entries2, order = []) {
    const groups = /* @__PURE__ */ new Map();
    for (const entry of entries2) {
      const label = categoryLabel(entry.category) || "Uncategorized", key2 = categoryKey(label);
      const group = groups.get(key2) ?? { key: key2, label, count: 0 };
      group.count++;
      groups.set(key2, group);
    }
    const rank = (key2) => {
      const i = order.indexOf(key2);
      return i < 0 ? order.length : i;
    };
    return [...groups.values()].sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label));
  }
  function matchesSite(entry, query) {
    const value = `${entry.label} ${entry.category} ${entry.hostnames.join(" ")}`.toLowerCase();
    return query.trim().toLowerCase().split(/\s+/).filter(Boolean).every((word) => value.includes(word));
  }
  function directoryView(value) {
    return typeof value === "string" && (value === "all" || value.startsWith("category:") && value.length > 9 && value.length <= 265) ? value : null;
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
    let savedOutcomes = /* @__PURE__ */ new Map();
    let lastPresentationSave = "SAVED";
    const position = options.position ?? emptySitesPosition();
    let selection = typeof options.initialSelection === "string" ? options.initialSelection : position.selection, listKey = "", detailKey = "", batchKey = "";
    let detailVisible = options.initialView === void 0 ? !!position.selection : options.initialView === "detail";
    const draftRows = /* @__PURE__ */ new Map();
    const siteRows = /* @__PURE__ */ new Map();
    let restoredList = false;
    let directory = directoryView(options.initialDirectory), searchFocused = false, suggestionKey = "";
    const categoryNodes = /* @__PURE__ */ new Map();
    const dialog = element("sites-editor");
    function chooseDirectory(value, record = true) {
      directory = directoryView(value);
      searchFocused = false;
      element("sites-list").scrollTop = 0;
      if (record) options.directoryChanged?.();
      options.changed();
    }
    function syncDialog() {
      const open = detailVisible && !!(selection || session?.value.draft?.editor) && !reviewOpen && !element("sites-section").hidden;
      if (open && !dialog.open) dialog.showModal?.();
      if (!open && dialog.open) dialog.close();
    }
    function closeDetails() {
      showView("browse");
      syncDialog();
      queueMicrotask(focusSelection);
    }
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
      if (reviewOpen) {
        element("draft-review-title").focus({ preventScroll: true });
        return;
      }
      if (detailVisible && !reviewOpen) {
        (element("site-draft").hidden ? element("site-detail") : input("site-name")).focus({ preventScroll: true });
        return;
      }
      const row = [...element("sites-list").querySelectorAll(".site-row")].find((r) => r.dataset.destinationId === selection);
      (directory !== null && row ? row : input("sites-search")).focus({ preventScroll: true });
    }
    let lastController = null;
    let reconciliation = null, reviewOpen = options.initialView === "review";
    function showView(next, rememberView = true) {
      reviewOpen = next === "review";
      detailVisible = next === "detail";
      if (rememberView) options.viewChanged?.(next, selection);
      options.changed();
    }
    const drafts = options.drafts ?? openDraftRepository();
    const initialized = drafts.then(async (repository) => {
      if (disposed2) {
        repository.close();
        return;
      }
      session = new DestinationWorkspaceSession(repository, options.changed);
      loadFailure = !await session.load();
      if (session.value.draft?.editor && options.initialView === void 0) detailVisible = true;
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
      const key2 = json([policy, preferences.destinations, options.pins()]);
      if (key2 !== entriesKey) {
        entriesKey = key2;
        savedEntries = policy ? policyDestinationIndex(policy, preferences.destinations, options.pins()) : [];
        const hosts = [...new Set(savedEntries.flatMap((entry) => entry.hostnames))];
        const decisions = evaluateMany(hosts, policy);
        savedOutcomes = new Map(hosts.map((host2, index) => [host2, decisions[index].outcome]));
      }
      return savedEntries;
    };
    const classification2 = (entry) => {
      const outcomes = new Set(entry.hostnames.map((hostname2) => savedOutcomes.get(hostname2)));
      return outcomes.size > 1 ? "MIXED" : outcomes.has("DENY") ? "BLACKLIST" : outcomes.has("ALLOW") ? "WHITELIST" : "GREYLIST";
    };
    const editorControls = initializeDestinationEditor({
      editor: () => session?.value.draft?.editor,
      policy: () => session?.value.draft?.baseline.policy,
      live: () => !disposed2
    });
    const { read: currentEditor, restore: restoreEditor, scope, clearError: clearFieldError } = editorControls;
    const activeReceipt = () => session?.value.receipt && !["DONE", "KEPT", "RESOLVED"].includes(session.value.receipt.phase) ? session.value.receipt : null;
    function persistEditor() {
      if (!session?.value.draft || submitting || activeReceipt() || session.conflict) return;
      clearFieldError();
      scope();
      const editor = currentEditor();
      if (!editor) return;
      editorControls.remember(editor);
      session.setEditor(editor);
    }
    function initialEditor(draft, id) {
      const item = id ? draft.changes.find((c) => c.id === id)?.after ?? draft.baseline.entries.find((e) => e.metadata.id === id) : null;
      const counterpart = commonWwwCounterpart(item?.metadata.primaryHostname ?? "");
      return {
        id: item?.metadata.id ?? null,
        name: item?.metadata.label ?? "",
        hostname: item?.metadata.primaryHostname ?? "",
        category: item?.metadata.category ?? "Your destinations",
        access: item?.classification ?? "WHITELIST",
        www: item?.metadata.hostnames.includes(counterpart ?? "") ?? false,
        extra: item?.metadata.hostnames.filter((h) => h !== item.metadata.primaryHostname && h !== counterpart).join(", ") ?? "",
        pinned: item?.pinned ?? false,
        ...item?.includeSubdomains ? { includeSubdomains: true } : {}
      };
    }
    function begin(id) {
      const state = options.controller()?.snapshot;
      if (!state || !options.canEdit() || !session?.loaded || submitting || activeReceipt() || session.conflict) return;
      const draft = session.value.draft ?? newDestinationDraft(newId(), baseline(state));
      if (id && !draft.changes.some((change) => change.id === id) && !draft.baseline.entries.some((entry) => entry.metadata.id === id)) {
        notice("This site was added after your draft baseline. Review and reconcile the stale draft before editing its new terms. Your current work is preserved.");
        element("reconcile-destination-draft").focus();
        return;
      }
      if (draft.editor) {
        if (draft.editor.id === (id ?? null)) {
          revealEditor();
          return;
        }
        const current2 = currentEditor() ?? draft.editor, initial2 = initialEditor(draft, draft.editor.id ?? void 0);
        if (json(current2) !== json(initial2)) {
          notice("Your current editor has unstaged changes. Add them to the batch or use Close editor before editing another site.");
          revealEditor();
          return;
        }
      }
      const initial = initialEditor(draft, id);
      const noMatches = !entries2().some((entry) => matchesSite(entry, input("sites-search").value));
      const editor = !id && noMatches ? { ...initial, ...siteSearchPrefill(element("sites-search").value) } : initial;
      void session.setDraft({ ...draft, editor });
      restoreEditor();
      revealEditor();
      notice("");
    }
    function revealEditor() {
      showView("detail");
      const expectedFocus = document.activeElement;
      queueMicrotask(() => {
        if (!detailVisible || reviewOpen || !session?.value.draft?.editor || document.activeElement !== expectedFocus || !element("site-field-error").hidden) return;
        const panel = element("site-draft"), top = panel.getBoundingClientRect?.().top ?? 0;
        if (top < 0 || top > window.innerHeight - 80) panel.scrollIntoView?.({ block: "start" });
        input("site-name").focus({ preventScroll: true });
      });
    }
    async function stage(immediateDisplay = false) {
      const state = options.controller()?.snapshot ?? lastController?.snapshot, editor = currentEditor(), draft = session?.value.draft;
      if (!state || !editor || !draft || !session || submitting || session.conflict || activeReceipt()) return;
      const hosts = explicitDestinationHosts(editor.hostname.trim(), commonWwwCounterpart(editor.hostname) !== null && editor.www, editor.extra);
      const invalid = !editor.name.trim() || editor.name.trim().length > 100 ? "site-name" : !explicitDestinationHosts(editor.hostname.trim(), false, "") || editor.includeSubdomains && editor.access === "WHITELIST" && !canUseSubdomainScope(editor.hostname) ? "site-hostname" : !hosts ? "site-extra" : !editor.category.trim() || editor.category.trim().length > 64 ? "site-category" : null;
      if (invalid !== null || !hosts) {
        const messages = {
          "site-name": "Enter a site name of 1\u2013100 characters.",
          "site-hostname": "Enter an exact primary hostname, such as example.com. URLs and wildcards are unsupported.",
          "site-extra": "Enter valid additional exact hostnames, separated by commas. URLs and wildcards are unsupported.",
          "site-category": "Enter a category of 1\u201364 characters."
        };
        const field = input(invalid ?? "site-hostname");
        setAttribute(field, "aria-invalid", "true");
        const message = invalid === "site-hostname" && editor.includeSubdomains && editor.access === "WHITELIST" && !canUseSubdomainScope(editor.hostname) ? "For all-subdomain access, enter a registered hostname or one of its subdomains. Public and private suffixes cannot be allowed as a whole." : messages[invalid ?? "site-hostname"];
        renderFeedback(element("site-field-error"), { message, tone: "error" });
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
        pinned: input("site-pin").disabled ? false : editor.pinned,
        ...editor.includeSubdomains && editor.access !== "BLACKLIST" ? { includeSubdomains: true } : {}
      };
      const staged = stageDestination(draft, id, after);
      const saving = session.setDraft(staged), published = session.value;
      if (!await saving) {
        if (session.value === published) {
          session.value = { ...session.value, draft: { ...staged, editor } };
          editorControls.remember(editor);
        }
        notice("Draft could not be verified as saved. Your work is retained in this page; retry saving before closing it or submitting.", session.conflict ? "error" : "uncertain");
        options.changed();
        return;
      }
      restoreEditor();
      showView("browse");
      syncDialog();
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
      notice("Removal staged in local draft. Managed Blocked sites rules are unchanged.");
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
      const removal = isWhitelistRemoval(state.policy, assessment.candidatePolicy);
      if (assessment.policyChanged && !removal && state.vaultState.pendingProposal || preferences.pending) {
        notice("A frozen proposal or display save is already pending. Review the existing Vault proposal first.");
        return;
      }
      submitting = true;
      options.changed();
      const receipt = {
        kind: removal ? "REMOVAL" : assessment.policyChanged ? "POLICY" : "DISPLAY",
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
          response = await options.propose({ kind: removal ? "REMOVE_WHITELIST" : "PROPOSE_POLICY", candidatePolicy: receipt.candidatePolicy, basePolicyRevision: draft.baseline.policyRevision });
        } catch {
        }
        const proposal = response?.view?.controller?.snapshot?.vaultState.pendingProposal;
        const committed = response?.view?.controller;
        if (removal && response?.result?.type === "COMMITTED" && response.result.operation === "REMOVE_WHITELIST" && committed?.status === "READY" && committed.snapshot && receiptOutcome(receipt, committed.snapshot) === "COMMITTED") {
          if (await session.set({ ...session.value, draft: null, receipt: { ...receipt, phase: "PROPOSED" } })) await applyDisplay(false);
        } else if (!removal && response?.result?.type === "COMMITTED" && proposal && samePolicy3(proposal.candidatePolicy, receipt.candidatePolicy)) {
          await session.set({ ...session.value, draft: null, receipt: { ...receipt, phase: "PROPOSED", proposalId: proposal.id } });
          restoreEditor();
          notice("One Vault proposal saved for the complete batch. Active policy is unchanged; wait and explicitly confirm in Vault.", "success");
          options.vault();
        } else if (response?.result?.type === "REJECTED" || !removal && response?.result?.type === "BLOCKED" && response.result.reason !== "COMMIT_UNKNOWN" && response.result.status !== "RECONCILING" || response?.error === "POLICY_DRAFT_STALE") {
          await session.set({ ...session.value, receipt: { ...receipt, phase: "RESOLVED" } });
          notice("The batch was not submitted. Your saved draft is preserved; review current state before retrying.", "error");
        } else notice("Policy submission outcome is uncertain. Frozen intent is saved; check saved authority before another submission. Do not repeat the command.", "uncertain");
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
            receipt: { ...receipt, proposalId: receipt.kind === "REMOVAL" ? null : receipt.proposalId ?? receipt.expectedProposalId, phase: "PROPOSED", owner: null }
          }, true);
          notice(outcome === "WAITING" ? "Existing saved proposal found. Review it in Vault; no second proposal was created." : "Policy committed and is active. Retry only accompanying display details.", "success");
        } else if (receipt.kind === "REMOVAL" || receipt.proposalId !== null || state.vaultState.nextProposalId === receipt.expectedProposalId) {
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
      const prompt = uncertainIntent ? "Discard this uncorrelated local batch and its remaining display terms? Its historical outcome cannot be established. Current saved policy and display details remain. No proposal will be sent, confirmed or cancelled." : "Keep current display details and discard this batch\u2019s remaining display edits? Current access rules will remain active.";
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
      const current2 = readPreferences();
      if (!preferencesAvailable) {
        notice("The display save outcome could not be verified because storage is unavailable. Frozen terms are preserved for retry; saved policy is unaffected.", "uncertain");
        return;
      }
      let destinations = current2.destinations;
      for (const change of receipt.draft.changes) {
        const before = receipt.draft.baseline.metadata.find((item) => item.id === change.id) ?? null;
        const saved = destinations.find((item) => item.id === change.id) ?? null, after = change.after?.metadata ?? null;
        if (json(saved) !== json(before) && json(saved) !== json(after) || after && destinations.some((item) => item.id !== change.id && item.hostnames.some((host2) => after.hostnames.includes(host2)))) {
          notice("Policy is preserved, but another page changed these display details. Retry cannot overwrite them. Review the conflicting site or keep current display details.", "error");
          return;
        }
        destinations = replaceDestinationMetadata(destinations, after, change.id);
      }
      if (!savePreferences({ ...current2, destinations })) {
        notice(receipt.kind !== "DISPLAY" ? "Policy committed and is active. Display details could not be verified as saved. Retry only display details and pins; do not resubmit policy." : "Display details could not be verified as saved. Frozen values are preserved for explicit retry; exact access rules are unchanged.", lastPresentationSave === "FAILED" ? "error" : "uncertain");
        return;
      }
      for (const change of receipt.draft.changes) {
        const after = change.after, hosts = [.../* @__PURE__ */ new Set([...change.before?.metadata.hostnames ?? [], ...after?.metadata.hostnames ?? []])];
        const savedPin = pinnedDestinations([{ id: change.id, label: "", category: "", hostname: hosts[0], hostnames: hosts }], options.pins()).length > 0;
        if (savedPin !== (change.before?.pinned ?? false) && savedPin !== (after?.pinned ?? false)) {
          notice("A pin changed elsewhere. Review it before retrying display details.", "error");
          return;
        }
        const result = await options.pin(change.id, after?.pinned ?? false, hosts);
        if (result !== "SAVED") {
          notice(receipt.kind !== "DISPLAY" ? "Policy committed and is active. Display details saved, but pins could not be verified. Retry only display details and pins." : "Display details saved, but pins could not be verified. Retry the remaining display save; exact access rules are unchanged.", result === "FAILED" ? "error" : "uncertain");
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
      notice(receipt.kind === "REMOVAL" ? "Allowed sites removals applied without a cooldown. Display details and pins are saved." : receipt.kind === "POLICY" ? "Complete batch policy committed. Accompanying display details and pins are saved." : "Display details and pins saved. Exact access rules are unchanged.", "success");
      if (receipt.kind !== "POLICY" && !element("sites-section").hidden && !session.value.draft?.editor) {
        reviewOpen = false;
        options.changed();
        queueMicrotask(focusSelection);
      }
    }
    let legacyApplying = false;
    async function legacyDisplay() {
      const state = snapshot();
      if (!state || !preferences.pending || legacyFailed || activeReceipt() || legacyApplying) return;
      const pending = preferences.pending, result = reconcileDestinationPreferences(preferences, state);
      if (result.preferences === preferences) return;
      const hosts = pending.destination?.hostnames ?? preferences.destinations.find((d) => d.id === pending.removedId)?.hostnames ?? [];
      legacyApplying = true;
      try {
        if (!savePreferences(result.pinChange ? { ...result.preferences, pending } : result.preferences) || result.pinChange && (await options.pin(result.pinChange.id, result.pinChange.pinned, hosts) !== "SAVED" || !savePreferences(result.preferences))) {
          legacyFailed = true;
          notice("Saved legacy policy is preserved. Retry only accompanying display details.", "error");
        } else {
          notice(result.pinChange ? "Policy committed. Accompanying display details and pins saved." : "Resolved pending display terms cleared.", "success");
          options.changed();
        }
      } finally {
        legacyApplying = false;
      }
    }
    function renderFrozenReview() {
      const state = options.controller()?.snapshot, receipt = session?.value.receipt;
      const matched = receipt?.kind === "POLICY" && state?.vaultState.pendingProposal && (receipt.proposalId ?? receipt.expectedProposalId) === state.vaultState.pendingProposal.id && samePolicy3(receipt.candidatePolicy, state.vaultState.pendingProposal.candidatePolicy);
      const panel = element("vault-destination-review");
      setProperty(panel, "hidden", !matched);
      if (matched) setProperty(element("vault-changes"), "hidden", true);
      const key2 = matched ? json(receipt) : "";
      if (panel.dataset.review === key2) return;
      setProperty(panel.dataset, "review", key2);
      element("vault-destination-items").replaceChildren(...(matched ? receipt.draft.changes : []).map((change) => {
        const li = document.createElement("li");
        renderDestinationChange(li, change, receipt.draft.baseline.policy, receipt.candidatePolicy);
        return li;
      }));
    }
    function renderBatch(state) {
      const draft = session?.value.draft, receipt = session?.value.receipt;
      const frozen = activeReceipt();
      text("destination-draft-heading", frozen ? "Submitted batch" : draft?.changes.length ? `${draft.changes.length} ${draft.changes.length === 1 ? "change" : "changes"} prepared` : draft?.editor ? "Editing your draft" : "Your draft");
      text("destination-workspace-kind", !session?.loaded ? loadFailure || session?.loadReason === "INVALID" ? "Local state unavailable" : "Loading local workspace" : frozen ? "Frozen submission" : draft ? "Prepared changes" : receipt?.phase === "DONE" ? "Completed local batch" : receipt ? "Resolved local batch" : "No staged changes");
      const workspace = session?.loaded && !draft && (!receipt || ["DONE", "KEPT"].includes(receipt.phase)) && !session.unsaved && !session.failure && !session.conflict && !loadFailure ? "empty" : "work";
      setProperty(element("destination-draft-panel").dataset, "quiet", String(!!session?.loaded && !draft && !frozen && !session.unsaved && !session.failure && !session.conflict && !loadFailure));
      if (element("destination-draft-panel").dataset.workspace !== workspace) setProperty(element("destination-draft-panel").dataset, "workspace", workspace);
      const current2 = draft ? state ? baseline(state) : draft.baseline : void 0;
      const assessment = draft && current2 ? state ? validateDraftCandidate(draft, current2, state) : assessDraft(draft, current2) : null;
      let status = !session?.loaded ? session?.loadReason === "INVALID" ? "Saved local drafts are damaged or incompatible. Submission disabled. Explicitly discard damaged draft data to recover; policy is preserved." : loadFailure ? "Local draft storage unavailable. Saved drafts cannot be verified; submission disabled." : "Loading saved local draft\u2026" : session.conflict ? "Another Atlas window saved a newer draft. Your local work is retained. Explicitly reload the shared draft before continuing." : session.unsaved || session.failure ? "Unsaved local work. Keep this page open and retry saving; recovery is not guaranteed." : draft?.changes.length || draft?.editor ? `Saved locally \xB7 ${draft.changes.length} staged changes. Your active access rules have not changed.` : "No local changes staged.";
      if (!state && draft) status += " Authoritative state unavailable; draft retained, submission disabled.";
      text("destination-draft-status", status);
      const problem = !!loadFailure || !!session?.failure || !!session?.conflict;
      setProperty(element("draft-problem"), "hidden", !problem);
      text("draft-problem-title", session?.conflict ? "A newer draft exists in another Atlas page" : !session?.loaded ? "Your saved draft could not be loaded" : session.failure === "UNCERTAIN" ? "Your draft save could not be verified" : "Your draft could not be saved");
      text("draft-problem-copy", session?.conflict ? "Your edits remain in this page. Loading the newer shared draft will ask before replacing them." : !session?.loaded ? "Existing saved data has not been replaced. Retry loading before preparing or submitting changes." : session.failure === "UNCERTAIN" ? "Your entered values remain in this page. The saved outcome is uncertain. Keep this page open and retry verification before submitting or closing." : "Your entered values remain in this page. Keep it open and retry saving before submitting or closing.");
      text("draft-problem-detail", session?.conflict ? "DRAFT_CONFLICT" : session?.loadReason ?? session?.failure ?? (loadFailure ? "DRAFT_STORAGE_UNAVAILABLE" : ""));
      if (session?.loaded && reviewOpen && !draft?.changes.length) reviewOpen = false;
      setProperty(element("destination-draft-panel").dataset, "review", String(reviewOpen));
      setProperty(element("sites-section").dataset, "view", reviewOpen ? "review" : detailVisible ? "detail" : "browse");
      syncDialog();
      text("draft-review-count", `${draft?.changes.length ?? 0} ${draft?.changes.length === 1 ? "change" : "changes"} prepared`);
      setProperty(element("resume-destination-editor"), "hidden", !draft?.editor || detailVisible || reviewOpen);
      setProperty(element("discard-destination-summary"), "hidden", !draft || reviewOpen);
      text("destination-draft-stale", assessment?.stale.length ? `Stale draft: ${assessment.stale.join("; ")}. Review reconciliation before submission.` : "");
      setProperty(element("destination-draft-stale"), "hidden", !assessment?.stale.length);
      const conflicts = assessment?.conflicts ?? [], key2 = json([draft?.changes, conflicts, reviewOpen, reconciliation]);
      if (key2 !== batchKey) {
        batchKey = key2;
        const retained = /* @__PURE__ */ new Set();
        const rows = (draft?.changes ?? []).map((change) => {
          retained.add(change.id);
          let row = draftRows.get(change.id);
          if (!row) {
            const node = document.createElement("li");
            node.className = "draft-item";
            node.dataset.destinationId = change.id;
            const content = document.createElement("div"), actions = document.createElement("div");
            actions.className = "actions";
            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "secondary compact";
            edit.dataset.draftAction = "EDIT";
            edit.addEventListener("click", () => begin(change.id));
            const remove = document.createElement("button");
            remove.type = "button";
            remove.textContent = "Remove from draft";
            remove.className = "text-button destructive";
            remove.dataset.draftAction = "REMOVE";
            remove.addEventListener("click", () => {
              if (session?.value.draft) void session.setDraft(unstageDestination(session.value.draft, change.id));
            });
            const removeRule = document.createElement("button");
            removeRule.type = "button";
            removeRule.textContent = "Stage removal";
            removeRule.className = "text-button";
            removeRule.dataset.draftAction = "REMOVE_RULE";
            removeRule.addEventListener("click", () => void stageRemoval(change.id));
            actions.append(edit, remove, removeRule);
            node.append(content, actions);
            row = { node, content, edit, removeRule, key: "" };
            draftRows.set(change.id, row);
          }
          const lines = destinationChangeSummary(change, draft.baseline.policy, assessment?.candidatePolicy ?? draft.baseline.policy);
          const shown = reviewOpen ? lines : lines.filter((line, index) => index < 3 || line.startsWith("Domain + all subdomains:") || line.startsWith("Still allowed by another saved scope:"));
          const errors = conflicts.filter((c) => c.id === change.id), contentKey = json([shown, errors]);
          if (row.key !== contentKey) {
            row.key = contentKey;
            renderDestinationChange(row.content, change, draft.baseline.policy, assessment?.candidatePolicy ?? draft.baseline.policy);
            row.content.append(...errors.map((c) => {
              const p = document.createElement("p");
              p.textContent = c.message;
              p.className = "draft-conflict";
              return p;
            }));
          }
          setProperty(row.edit, "textContent", change.after ? "Edit staged item" : "Restore / edit");
          setProperty(row.removeRule, "hidden", change.after === null);
          return row.node;
        });
        for (const id of draftRows.keys()) if (!retained.has(id)) draftRows.delete(id);
        reconcileChildren(element("destination-draft-items"), rows);
        element("destination-draft-conflicts").replaceChildren(...conflicts.map((c) => {
          const p = document.createElement("p");
          setProperty(p, "textContent", `${c.id ? `${c.id}: ` : ""}${c.message}`);
          return p;
        }));
        const preview = reconciliation;
        const reconciledPolicy = preview ? assessDraft(preview.draft, preview.draft.baseline).candidatePolicy ?? preview.draft.baseline.policy : null;
        element("draft-reconciliation-items").replaceChildren(...(preview?.draft.changes ?? []).map((change) => {
          const li = document.createElement("li");
          setProperty(li, "textContent", destinationChangeSummary(
            change,
            preview.draft.baseline.policy,
            reconciledPolicy
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
      setProperty(element("reconcile-destination-draft"), "hidden", !assessment?.stale.length);
      setProperty(element("accept-draft-reconciliation"), "disabled", locked || !reconciliation || assessDraft(reconciliation.draft, reconciliation.draft.baseline).conflicts.length > 0 || reconciliation.draft.editor !== null);
      setProperty(element("review-destination-draft"), "disabled", !draft?.changes.length);
      setProperty(element("review-destination-draft"), "hidden", !draft?.changes.length);
      setAttribute(element("review-destination-draft"), "aria-expanded", String(reviewOpen));
      setProperty(element("destination-draft-items"), "hidden", !reviewOpen && !conflicts.length);
      text("review-destination-draft", reviewOpen ? "Close review" : `Review ${draft?.changes.length ?? 0} ${draft?.changes.length === 1 ? "change" : "changes"}`);
      const removal = !!state && !!assessment?.candidatePolicy && isWhitelistRemoval(state.policy, assessment.candidatePolicy);
      setProperty(element("submit-destination-draft"), "disabled", locked || !!session?.unsaved || !!session?.failure || !reviewOpen || !assessment?.candidatePolicy || !!assessment.stale.length || !!draft?.editor || !draft?.changes.length || assessment.policyChanged && !removal && state?.vaultState.pendingProposal != null || preferences.pending !== null);
      text("submit-destination-draft", removal ? "Remove allowed sites now" : assessment?.policyChanged ? "Submit to Vault" : "Save display changes");
      text("draft-submit-help", activeReceipt() ? "This batch is frozen. Review or cancel it in Vault; resolve pending display saves before editing again." : state?.vaultState.pendingProposal && !removal ? "A proposal is already in Vault. Prepare local work freely; a new policy batch cannot replace it." : session?.unsaved || session?.failure ? "Review is a preview. Save or retry your local draft before submitting." : draft?.editor ? reviewOpen ? "Showing staged changes. Open editor changes are not included; add or close the editor before submitting." : "Review shows your staged batch. Add or close the editor before submitting." : !reviewOpen && draft?.changes.length ? "Review the complete batch before submitting." : assessment?.stale.length ? "Accept a reviewed reconciliation before submission." : conflicts.length ? "Resolve the conflicts above before submission." : removal ? "This only removes existing allowed-site rules, so no wait is needed. Blocked sites and settings stay unchanged. Any pending Vault proposal will need to be prepared again." : assessment?.policyChanged ? `These changes need ${state.configuration.vaultTiming.waitMs / 1e3} seconds of waiting in Vault, then your confirmation. Existing access rules stay active until you confirm.` : "Names, categories and pins save directly without a Vault cooldown.");
      setProperty(element("retry-destination-draft"), "hidden", !loadFailure && !session?.unsaved && !session?.failure);
      setProperty(element("discard-damaged-draft"), "hidden", session?.loadReason !== "INVALID");
      setProperty(element("reload-shared-draft"), "hidden", !session?.conflict);
      setProperty(element("discard-destination-draft"), "disabled", submitting || !draft || !!activeReceipt());
      setProperty(element("discard-destination-summary"), "disabled", submitting || !draft || !!activeReceipt());
      setProperty(element("destination-receipt"), "hidden", !receipt || ["DONE", "KEPT"].includes(receipt.phase));
      const receiptPanel = element("destination-receipt");
      if (receipt && receiptPanel.dataset.phase !== receipt.phase) {
        setProperty(receiptPanel.dataset, "phase", receipt.phase);
        setProperty(receiptPanel, "open", !["DONE", "KEPT"].includes(receipt.phase));
      }
      const outcome = receipt && state && !["DONE", "KEPT", "RESOLVED"].includes(receipt.phase) ? receiptOutcome(receipt, state) : null;
      text("destination-receipt-status", !receipt ? "" : receipt.phase === "DONE" ? "Applied batch: policy (if changed), display details and pins acknowledged." : receipt.phase === "KEPT" ? "Current saved policy and display details kept; remaining local batch terms were discarded." : receipt.phase === "RESOLVED" ? "Proposal resolved without applying accompanying display details. Restore only as an editable draft." : outcome === "COMMITTED" ? receipt.kind !== "DISPLAY" ? "Policy committed and active. Accompanying display details are pending or need retry." : "Display-only save pending; exact access rules are unchanged." : outcome === "WAITING" ? "Frozen Vault proposal saved. Active policy unchanged; waiting or explicit confirmation still required." : "Frozen submission intent. Check saved authority before retrying; no second policy command will be sent.");
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
        const receipt = activeReceipt(), current2 = snapshot();
        if (receipt && current2 && !session.unsaved && !session.failure && !session.conflict) {
          const outcome = receiptOutcome(receipt, current2);
          if (outcome === "COMMITTED" && receipt.phase === "PROPOSED") await applyDisplay(false);
          else if (outcome === "RESOLVED" && receipt.phase === "PROPOSED") await session.set({ ...session.value, receipt: { ...receipt, phase: "RESOLVED" } });
        }
      }).finally(() => {
        refreshing = null;
      });
      return refreshing;
    }
    function inspect(id) {
      selection = id;
      detailKey = "";
      searchFocused = false;
      remember();
      showView("detail");
      const expectedFocus = document.activeElement;
      queueMicrotask(() => {
        if (detailVisible && !reviewOpen && document.activeElement === expectedFocus && element("site-field-error").hidden) (element("site-draft").hidden ? element("site-detail") : input("site-name")).focus({ preventScroll: true });
      });
    }
    function renderSuggestions(matches2, categories, query, ready) {
      const panel = element("sites-search-results");
      const matchingCategories = query ? categories.filter((c) => query.toLowerCase().split(/\s+/).every((w) => c.label.toLowerCase().includes(w))) : [];
      const key2 = json([query, matches2, matchingCategories, ready]);
      if (key2 !== suggestionKey) {
        suggestionKey = key2;
        const nodes = [];
        const button = (label, action) => {
          const node = document.createElement("button");
          node.type = "button";
          node.textContent = label;
          node.addEventListener("click", action);
          node.disabled = !ready;
          nodes.push(node);
        };
        for (const category of matchingCategories) button(`${category.label} \xB7 ${category.count} sites`, () => {
          input("sites-search").value = "";
          chooseDirectory(`category:${category.key}`);
          remember();
        });
        for (const entry of matches2.slice(0, 12)) button(`${entry.label} \xB7 ${entry.hostname}`, () => inspect(destinationId(entry)));
        if (matches2.length) button(`View all ${matches2.length} results`, () => chooseDirectory("all"));
        else {
          const message = document.createElement("p");
          message.className = "note";
          message.textContent = ready ? "No matching sites. Add a site to prepare new access rules." : "Sites cannot be verified right now.";
          nodes.push(message);
        }
        reconcileChildren(panel, nodes);
      }
      setProperty(panel, "hidden", !searchFocused || !query);
      setAttribute(input("sites-search"), "aria-expanded", String(searchFocused && !!query));
    }
    function render2(ready) {
      if (disposed2) return;
      const controller = options.controller();
      if (controller?.status === "READY" && controller.snapshot) lastController = controller;
      const display = controller?.snapshot ?? lastController?.snapshot;
      const presentationState = hasCommittedCollection(controller) ? controller.snapshot : null;
      legacyDisplay();
      if (element("sites-section").hidden) {
        renderBatch(presentationState ?? null);
        return;
      }
      const all = entries2(), query = input("sites-search").value.trim(), filter = element("sites-filter").value;
      const allowedByFilter = all.filter((entry) => filter === "ALL" || classification2(entry) === filter || filter === "WHITELIST" && entry.hostnames.some((host2) => savedOutcomes.get(host2) === "ALLOW") || filter === "BLACKLIST" && entry.hostnames.some((host2) => savedOutcomes.get(host2) === "DENY"));
      const matches2 = allowedByFilter.filter((entry) => matchesSite(entry, query));
      const visible = directory?.startsWith("category:") ? allowedByFilter.filter((entry) => categoryKey(entry.category || "Uncategorized") === directory.slice(9)) : matches2;
      let usage = {};
      try {
        usage = readDestinationUsage(JSON.parse(localStorage.getItem(usagePreferencesKey) ?? "null"));
      } catch {
      }
      const categories = orderCategories(
        directoryCategories(allowedByFilter),
        options.categoryOrderMode?.() ?? "custom",
        options.categoryOrder?.() ?? [],
        allowedByFilter,
        usage,
        Date.now()
      );
      const groups = categories.map((category) => {
        let node = categoryNodes.get(category.key);
        if (!node) {
          node = document.createElement("section");
          categoryNodes.set(category.key, node);
        }
        setProperty(node.dataset, "categoryKey", category.key);
        setProperty(node.dataset, "category", category.label);
        setProperty(node.dataset, "count", String(category.count));
        setProperty(node.dataset, "icon", options.categoryIcon?.(category.key, category.label) ?? "category");
        return node;
      });
      options.renderCategories?.(groups);
      setProperty(element("sites-categories"), "hidden", directory !== null);
      setProperty(element("sites-category-order-label"), "hidden", directory !== null);
      setProperty(element("sites-list"), "hidden", directory === null);
      setProperty(element("sites-categories-back"), "hidden", directory === null);
      text("sites-directory-title", directory?.startsWith("category:") ? categories.find((c) => c.key === directory.slice(9))?.label ?? "Category" : directory === "all" ? "All sites" : "Categories");
      renderSuggestions(matches2, categories, query, ready);
      const phase = collectionPresentation(controller, all.length, options.attempted?.() === true || controller != null, display != null);
      setProperty(element("sites-section").dataset, "phase", phase.phase);
      setProperty(element("sites-recovery"), "hidden", phase.phase !== "UNAVAILABLE");
      text("sites-status", phase.phase === "READY" || phase.phase === "EMPTY" ? `Current access rules \xB7 ${all.length} sites` : phase.message);
      setProperty(element("sites-pending"), "hidden", controller?.snapshot?.vaultState.pendingProposal == null);
      const marked = new Set(session?.value.draft?.changes.map((change) => change.id));
      const key2 = json([visible, display?.policy, visible.map((entry) => marked.has(destinationId(entry)))]);
      if (key2 !== listKey) {
        listKey = key2;
        const list = element("sites-list"), scroll = list.scrollTop ?? 0;
        const focused = document.activeElement, focusId = focused?.dataset.destinationId;
        const nodes = visible.map((entry) => {
          const id = destinationId(entry);
          let row = siteRows.get(id);
          if (!row) {
            const node = document.createElement("button");
            node.type = "button";
            node.className = "site-row";
            node.dataset.destinationId = id;
            const name = document.createElement("strong"), category = document.createElement("span"), badge = document.createElement("span");
            category.className = "note";
            badge.className = "pill";
            const mark = options.siteMark?.(entry.hostname);
            if (mark) node.append(mark);
            node.append(name, category, badge);
            node.addEventListener("click", () => inspect(id));
            row = { node, name, category, badge, mark };
            siteRows.set(id, row);
          }
          setProperty(row.name, "textContent", entry.label);
          setProperty(row.category, "textContent", `${entry.hostname} \xB7 ${entry.category}`);
          if (row.mark && row.mark.dataset.hostname !== entry.hostname) options.siteMark(entry.hostname, row.mark);
          const kind = classification2(entry);
          setProperty(row.badge, "textContent", `${kind === "WHITELIST" ? "Allowed" : kind === "BLACKLIST" ? "Blocked" : "Mixed rules"}${marked.has(id) ? " \xB7 Draft" : ""}`);
          setProperty(row.node, "title", entry.hostnames.join(", "));
          return row.node;
        });
        const liveIds = new Set(all.map(destinationId));
        for (const id of siteRows.keys()) if (!liveIds.has(id)) siteRows.delete(id);
        reconcileChildren(list, nodes);
        list.scrollTop = scroll;
        if (focusId) [...list.querySelectorAll(".site-row")].find((r) => r.dataset.destinationId === focusId)?.focus({ preventScroll: true });
      }
      if (!restoredList && all.length && !element("sites-section").hidden) {
        element("sites-list").scrollTop = position.scroll;
        restoredList = true;
      }
      setProperty(element("sites-empty"), "hidden", (directory === null ? categories.length : visible.length) !== 0 || phase.phase === "LOADING" || phase.phase === "UNAVAILABLE");
      const selected2 = all.find((entry) => destinationId(entry) === selection);
      setProperty(element("sites-back"), "hidden", !selected2 && !session?.value.draft?.editor);
      setProperty(element("site-selection-empty"), "hidden", !!selected2 || !!session?.value.draft?.editor);
      setProperty(element("site-detail"), "hidden", !selected2 || !!session?.value.draft?.editor);
      const detail = json([selected2, display?.policy, options.pins()]);
      if (selected2 && detail !== detailKey) {
        detailKey = detail;
        text("site-detail-title", selected2.label);
        text("site-detail-category", `${selected2.category} \xB7 ${pinnedDestinations([selected2], options.pins()).length ? "Pinned" : "Not pinned"}`);
        element("site-detail-hosts").replaceChildren(...selected2.hostnames.map((hostname2) => {
          const row = document.createElement("li"), result = evaluate({ hostname: hostname2 }, display.policy);
          const subtree = display.policy.whitelistSubdomains?.includes(hostname2) ? " \xB7 Also all current/future subdomains; manual and managed blocking still apply to additional hosts." : "";
          setProperty(row, "textContent", `${hostname2}${hostname2 === selected2.hostname ? " \xB7 primary" : ""} \xB7 ${result.outcome === "DENY" ? "Blocked" : "Allowed"}${display.policy.blacklist.includes(hostname2) && display.policy.whitelist.includes(hostname2) ? " (Blocked sites overrides Allowed sites)" : ""}${subtree}`);
          return row;
        }));
      }
      const locked = !ready || submitting || !session?.loaded || !!session?.conflict || !!activeReceipt();
      for (const id of ["add-site", "edit-site", "remove-site", "propose-site", "save-site-display"]) setProperty(element(id), "disabled", locked);
      setProperty(element("cancel-site-draft"), "disabled", submitting || !!activeReceipt());
      const editorLocked = submitting || !!activeReceipt() || !!session?.conflict;
      editorControls.lock(editorLocked);
      for (const row of element("sites-list").querySelectorAll(".site-row")) setAttribute(row, "aria-pressed", String(row.dataset.destinationId === selection));
      const suggestions = categorySuggestions([...all.map((e) => e.category), ...preferences.destinations.map((e) => e.category)], session?.value.draft?.changes.flatMap((c) => c.after ? [c.after.metadata.category] : []) ?? []);
      const categoryOptions = element("site-categories"), categoriesKey = json(suggestions);
      if (categoryOptions.dataset.categories !== categoriesKey) {
        setProperty(categoryOptions.dataset, "categories", categoriesKey);
        categoryOptions.replaceChildren(...suggestions.map((label) => {
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
            showView("browse");
            syncDialog();
            notice("Editor closed. Staged changes preserved.");
            queueMicrotask(focusSelection);
          }
        });
      }
    });
    for (const id of ["site-name", "site-hostname", "site-category", "site-access", "site-www", "site-extra", "site-pin", "site-subdomains"]) element(id).addEventListener("input", persistEditor);
    element("review-destination-draft").addEventListener("click", () => {
      showView(reviewOpen ? session?.value.draft?.editor || selection ? "detail" : "browse" : "review");
      notice("");
      queueMicrotask(() => {
        if (reviewOpen) {
          element("draft-review-title").focus({ preventScroll: true });
          element("destination-draft-items").scrollTop = 0;
          element("main-content").scrollTop = 0;
          window.scrollTo?.({ top: 0, behavior: "instant" });
        } else focusSelection();
      });
    });
    element("sites-back").addEventListener("click", closeDetails);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDetails();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDetails();
    });
    element("continue-destination-editing").addEventListener("click", () => {
      showView(session?.value.draft?.editor || selection ? "detail" : "browse");
      queueMicrotask(() => session?.value.draft?.editor ? input("site-name").focus() : focusSelection());
    });
    element("resume-destination-editor").addEventListener("click", () => {
      showView("detail");
      input("site-name").focus();
    });
    element("discard-destination-summary").addEventListener("click", () => element("discard-destination-draft").click());
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
          const repository = await openDraftRepository();
          if (disposed2) {
            repository.close();
            return;
          }
          session = new DestinationWorkspaceSession(repository, options.changed);
        } catch {
          notice("Draft storage still cannot be opened. No policy command was sent.", "error");
          return;
        }
      }
      if (!session.loaded) loadFailure = !await session.load();
      else await session.retry();
      restoreEditor();
      options.changed();
      if (!loadFailure && !session.failure && !session.unsaved && !session.conflict) notice("Local draft saved.", "success");
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
      searchFocused = true;
      render2(options.canEdit());
      remember();
    });
    element("sites-search").addEventListener("focus", () => {
      searchFocused = true;
      render2(options.canEdit());
    });
    element("sites-categories-back").addEventListener("click", () => {
      chooseDirectory(null);
    });
    element("sites-show-all").addEventListener("click", () => {
      chooseDirectory("all");
    });
    const searchKey2 = (event) => {
      const panel = element("sites-search-results");
      if (event.key === "Escape") {
        event.preventDefault();
        searchFocused = false;
        panel.hidden = true;
        input("sites-search").focus();
        searchFocused = false;
        panel.hidden = true;
        setAttribute(input("sites-search"), "aria-expanded", "false");
        return;
      }
      if (panel.hidden || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
      const buttons = [...panel.querySelectorAll("button:not(:disabled)")];
      if (!buttons.length) return;
      if (event.key === "Enter" && document.activeElement === input("sites-search")) {
        event.preventDefault();
        buttons[0].click();
        return;
      }
      if (event.key !== "Enter") {
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement);
        buttons[(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length].focus();
      }
    };
    input("sites-search").addEventListener("keydown", searchKey2);
    element("sites-search-results").addEventListener("keydown", searchKey2);
    window.addEventListener("pointerdown", (event) => {
      const target = event.target;
      if (target !== input("sites-search") && !element("sites-search-results").contains(target)) {
        searchFocused = false;
        element("sites-search-results").hidden = true;
        setAttribute(input("sites-search"), "aria-expanded", "false");
      }
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
      void initialized.then(() => session?.idle()).finally(() => session?.repository.close());
      draftRows.clear();
      siteRows.clear();
    });
    return {
      render: render2,
      refresh,
      metadata: () => preferences.destinations,
      initialized,
      idle: async () => {
        await initialized;
        await refreshing;
        await displaying;
        await session?.idle();
      },
      session: () => session,
      renderFrozenReview,
      navigation: navigation2,
      focusSelection,
      directory: () => directory,
      chooseCategory: (key2) => chooseDirectory(`category:${key2}`),
      restoreDirectory: (value) => {
        directory = directoryView(value);
      },
      leave() {
        searchFocused = false;
        if (dialog.open) dialog.close();
      },
      view: () => reviewOpen ? "review" : detailVisible ? "detail" : "browse",
      restoreView(value, id) {
        if (typeof id === "string") {
          selection = id;
          detailKey = "";
        }
        showView(value === "review" || value === "detail" ? value : "browse", false);
      }
    };
  }

  // src/ui/settings-model.ts
  function createPresetCoverage(hostnames) {
    const terms = Object.freeze([...hostnames]);
    let key2, missing = terms;
    return (policy) => {
      const nextKey = JSON.stringify(policy);
      if (nextKey === key2) return missing;
      key2 = nextKey;
      missing = Object.freeze(terms.filter((hostname2) => !policy || evaluate({ hostname: hostname2 }, policy).outcome !== "ALLOW"));
      return missing;
    };
  }
  function seconds(milliseconds) {
    const digits = String(milliseconds);
    const whole = digits.length > 3 ? digits.slice(0, -3) : "0";
    const fraction = digits.slice(-3).padStart(3, "0").replace(/0+$/, "");
    return fraction === "" ? whole : `${whole}.${fraction}`;
  }
  var timingFields = [
    { id: "access-wait", label: "access request wait", unit: "seconds", value: (config) => seconds(config.accessTiming.waitMs) },
    { id: "access-window", label: "access request confirmation", unit: "seconds", value: (config) => seconds(config.accessTiming.confirmationWindowMs) },
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
  var params = new URL(location.href).searchParams;
  var navigation = navigationMemory({ getItem: (key2) => sessionStorage.getItem(key2), setItem: (key2, value) => sessionStorage.setItem(key2, value) });
  var selected = (!location.hash && params.get("view") === "access" || location.hash === "#access" ? params.get("tab") : null) ?? "";
  var view = null;
  var lastVerifiedPolicy;
  var queryAttempted = false;
  var busy = false;
  var disposed = false;
  var renderQueued = false;
  function requestRender() {
    if (disposed || renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => {
      if (renderQueued && !disposed) {
        renderQueued = false;
        render();
      }
    });
  }
  var epoch = 0;
  var preparingScopes = /* @__PURE__ */ new Set();
  var destinationsKey = "";
  var policyReview = null;
  var policyReviewError = "";
  var page = atlasPage(location.hash.slice(1)) ?? (params.get("view") === "access" ? "access" : "home");
  var section = page === "vault" ? "settings" : page === "access" ? "home" : page;
  if (page === "access") page = "home";
  var settingsKey = "";
  var entries = [];
  var matches = [];
  var searchKey = "";
  var searchInputsKey = "";
  var highlighted = -1;
  var searchOpen = false;
  var searchActions = [];
  var pinsStorageKey = "atlas-home-pins-v1";
  var pins = [];
  var pinsLoaded = false;
  var savingPins = false;
  var reviewKey = "";
  var homeGreylist = initializeHomeGreylist({ send, prepare: prepareScope, label: serviceLabel, dismiss: dismissGreylist });
  var homeCatalog = [];
  var searchInput = element2("destination-search");
  var destinationCards = initializeDestinationCards({ open: (url) => send({ kind: "OPEN_DESTINATION", url }), togglePin });
  var homePins = initializeHomePins({
    siteMark: destinationCards.siteMark,
    open: (url) => send({ kind: "OPEN_DESTINATION", url }),
    togglePin,
    changed: requestRender,
    status: (url) => pinAccessStatus(view, url, Date.now())
  });
  var bookmarkSync = initializeBookmarkSync(requestRender);
  var diagnosticPanel = initializeDiagnosticsPanel({ visible: () => page === "settings" && !element2("diagnostics").hidden, selected: () => selected, feedback });
  var settingsNavigation = initializeSettingsNavigation({
    initial: history.state?.atlasSettings,
    remember: () => {
      if (page === "settings") history.pushState(historyData(), "", "#settings");
      requestRender();
    }
  });
  var presetHostnames = compileCuratedWhitelist().whitelist;
  var presetCoverage = createPresetCoverage(presetHostnames);
  setProperty(document.body.dataset, "mode", "control");
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
  function feedback(message, tone = "status") {
    renderFeedback(element2("feedback"), { message, tone });
    element2("feedback").dataset.source = "";
    syncSiteFeedback();
  }
  function syncSiteFeedback() {
    const local = element2("site-save-feedback"), global = element2("feedback");
    setProperty(local, "hidden", !local.textContent || section !== "sites" || !element2("sites-editor").open && !global.hidden && local.textContent === global.textContent);
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
    const key2 = `${context.contextId}:${context.navigationId}:${view?.controller?.snapshot?.policyRevision}`;
    if (preparingScopes.has(key2)) return;
    preparingScopes.add(key2);
    const ticket = epoch;
    void browser.runtime.sendMessage({ kind: "PREPARE_ACCESS", tabId: context.tabId }).then((response) => {
      const current2 = selectedContext(view?.contexts ?? [], selected);
      if (ticket === epoch && current2?.contextId === context.contextId && current2.navigationId === context.navigationId && response?.view) {
        view = response.view;
        render();
      }
    }).catch(() => {
    }).finally(() => {
      preparingScopes.delete(key2);
    });
  }
  function dismissGreylist(contextId, navigationId) {
    const context = view?.contexts.find((c) => String(c.tabId) === selected);
    if (context?.contextId !== contextId || context.navigationId !== navigationId) return;
    selected = "";
    const url = new URL(location.href);
    url.searchParams.delete("tab");
    url.searchParams.delete("view");
    history.replaceState(history.state, "", url);
    requestRender();
  }
  var sites = initializeSites({
    initialView: history.state?.atlasSitesView,
    initialDirectory: history.state?.atlasSitesDirectory,
    directoryChanged: () => {
      if (page === "sites") history.pushState(historyData(), "", "#sites");
    },
    categoryIcon: (key2, label) => homeOrganization.icon(key2, label),
    categoryOrder: () => homeOrganization.orderKeys(),
    categoryOrderMode: () => homeOrganization.orderMode(),
    renderCategories: (groups) => renderDirectoryCategories(groups, null, homeOrganization.canMove()),
    initialSelection: history.state?.atlasSitesSelection,
    viewChanged: () => {
      if (page === "sites") history.pushState(historyData(), "", "#sites");
    },
    siteMark: destinationCards.siteMark,
    controller: () => view?.controller,
    pins: () => presentationView()?.pins ?? pins,
    propose: send,
    vault: () => navigate2("vault", true),
    feedback: (message, tone = "status") => {
      if (tone === "error" || tone === "uncertain") {
        feedback(message, tone);
        element2("feedback").dataset.source = "sites";
      } else if (element2("feedback").dataset.source === "sites") feedback("");
      else syncSiteFeedback();
    },
    canEdit: () => !busy && canQueueOperation(view?.controller),
    attempted: () => queryAttempted && view?.startup?.status !== "LOADING",
    changed: requestRender,
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
    pin: async (id, pinned, hosts) => {
      const result = await setPin(id, pinned, hosts);
      if (result === "SAVED") pins = presentationView().pins;
      else feedback("Your pin could not be verified as saved. Retry the pin change; access rules are unchanged.", "error");
      return result;
    }
  });
  var homeOrganization = initializeHomeOrganization(requestRender);
  var renderDirectoryCategories = initializeHomeShortcuts(
    element2("sites-categories"),
    (key2) => sites.chooseCategory(key2),
    (key2, target) => homeOrganization.reorder(key2, target, [...element2("sites-categories").children].map((n) => n.dataset.categoryKey)),
    "sites-list"
  );
  var restoredPage = false;
  function render() {
    if (disposed) return;
    renderQueued = false;
    const focused = document.activeElement;
    text2("page-title", page === "vault" ? "Vault" : section === "settings" ? "Settings" : section === "sites" ? "All sites" : "Atlas");
    text2("page-eyebrow", section === "settings" ? "YOUR SAVED COMMITMENTS" : section === "sites" ? "YOUR COMMITTED DESTINATIONS" : "YOUR INTERNET, WITH INTENTION");
    text2("page-description", page === "vault" ? "Review your commitments. Active rules stay in place until a change is confirmed and saved." : section === "settings" ? "Intentional friction and the timing of your commitments." : section === "sites" ? "Your complete collection. Select a site to review or edit its access." : "A place for the things you choose.");
    setProperty(document.body.dataset, "section", section);
    setProperty(document.body.dataset, "page", page);
    text2("vault-section-title", page === "vault" ? "Proposal review" : "Vault");
    setProperty(document.body.dataset, "mode", "control");
    const controller = view?.controller;
    const ready = canQueueOperation(controller);
    const status = controller?.status;
    const startupMessage = startupCopy(view?.startup);
    text2("startup-warning", startupMessage);
    setProperty(element2("startup-warning"), "hidden", startupMessage === "");
    setProperty(element2("setup"), "hidden", status !== "UNINITIALIZED");
    setProperty(element2("workspace"), "hidden", status === "UNINITIALIZED" || section !== "home");
    setProperty(element2("settings"), "hidden", section !== "settings");
    settingsNavigation.render(section === "settings", page === "vault" ? "vault-section" : void 0);
    setAttribute(element2("show-vault"), "aria-current", page === "vault" ? "page" : "false");
    setAttribute(element2("show-vault"), "aria-pressed", String(page === "vault"));
    setProperty(element2("sites-section"), "hidden", section !== "sites");
    setProperty(element2("destinations"), "hidden", false);
    for (const name of ["home", "sites", "settings"]) {
      const button = element2(`show-${name}`);
      setAttribute(button, "aria-pressed", String(section === name));
      if (section === name) setAttribute(button, "aria-current", "page");
      else setAttribute(button, "aria-current", null);
    }
    setProperty(element2("save-setup"), "disabled", busy || status !== "UNINITIALIZED");
    const now = Date.now();
    renderSettings(controller, ready, now);
    renderHome(controller?.snapshot?.policy, ready);
    sites.render(ready && !busy);
    syncSiteFeedback();
    homeGreylist.render(view, now, busy, selected);
    if (!restoredPage && ready && sites.session()?.loaded && homeOrganization.session()?.saved) {
      restoredPage = true;
      const position = navigation.value().pages[page], initialPage = page;
      if (position) requestAnimationFrame(() => {
        if (page !== initialPage) return;
        viewportScrollSurface(page, sites.view()).scrollTop = position.scroll;
        if (page === "sites") sites.focusSelection();
        else document.getElementById(position.focus)?.focus({ preventScroll: true });
      });
    }
    if (focused instanceof HTMLButtonElement && focused.closest("#vault-section") && (focused.disabled || focused.closest("[hidden]")) && section === "settings") element2("vault-heading").focus({ preventScroll: true });
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
    setProperty(element2("vault-empty"), "hidden", proposal != null);
    text2("vault-empty", hasCommittedCollection(controller) ? "No proposal is waiting. Prepare site changes in All sites or timing changes in Settings." : "Vault status cannot currently be verified. Retry or recover saved state before confirmation.");
    const showCoverage = page === "settings" && settingsNavigation.value() === "recovery-section";
    const missingDefaults = showCoverage ? presetCoverage(policy) : null;
    setProperty(element2("preset-update"), "hidden", false);
    if (missingDefaults) text2("preset-update-status", policy ? missingDefaults.length > 0 ? `${missingDefaults.length} curated hostnames are missing from your saved Allowed sites.` : "Your saved Allowed sites includes all current curated hostnames." : "Saved policy is unavailable. Curated coverage cannot be verified.");
    setProperty(element2("propose-defaults"), "hidden", !policy || missingDefaults === null || missingDefaults.length === 0);
    setProperty(element2("propose-defaults"), "disabled", busy || !ready || proposal != null);
    setProperty(element2("vault-panel"), "hidden", proposal == null);
    const vaultReturn = element2("return-to-sites"), vaultActions = element2(proposal ? "vault-protection-actions" : "vault-empty-actions");
    if (vaultReturn.parentElement !== vaultActions) vaultActions.append(vaultReturn);
    setProperty(element2("vault-empty-actions"), "hidden", proposal != null);
    const review = matchingReview(controller, policyReview);
    renderReview(review, proposal != null);
    text2("vault-review", review ? `Proposal ${review.proposalId} \xB7 policy revision ${review.basePolicyRevision}
Allowed sites additions: ${review.whitelist.added.join(", ") || "(none)"}
Allowed sites removals: ${review.whitelist.removed.join(", ") || "(none)"}
Blocked sites additions: ${review.blacklist.added.join(", ") || "(none)"}
Blocked sites removals: ${review.blacklist.removed.join(", ") || "(none)"}${review.whitelistSubdomains ? `
All-subdomain bases added: ${review.whitelistSubdomains.added.join(", ") || "(none)"}
All-subdomain bases removed: ${review.whitelistSubdomains.removed.join(", ") || "(none)"}` : ""}
Classification changes:
${review.classifications.map((change) => `${change.hostname}: ${change.before} \u2192 ${change.after}`).join("\n") || "(none)"}${review.candidateConfiguration ? `
Current settings: ${settingsCopy(review.currentConfiguration)}
Candidate settings: ${settingsCopy(review.candidateConfiguration)}` : ""}` : policyReviewError ? `Core review unavailable: ${policyReviewError}. Cancel or recover before proceeding.` : "Loading the frozen Core review\u2026");
    text2("vault-deadline", review?.phase === "WAITING" ? `Vault wait ${countdown(review.readyAt, now)}` : review?.phase === "READY" ? `Confirm within ${countdown(review.confirmBy, now)}` : review?.phase === "EXPIRED" ? "This proposal expired. Cancel it before starting a new proposal." : "");
    text2("vault-ready-at", review?.phase === "WAITING" ? `Ready at ${new Date(review.readyAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : review?.phase === "READY" ? `Confirm by ${new Date(review.confirmBy).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : review?.phase === "EXPIRED" ? "Confirmation expired" : proposal ? "Review unavailable" : "");
    setProperty(element2("vault-ready-at"), "title", review ? `Ready at ${new Date(review.readyAt).toLocaleString()}. Confirm by ${new Date(review.confirmBy).toLocaleString()}.` : "");
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
    text2("managed-conflicts", managed ? `Allowed sites exceptions in managed data (${managed.conflicts.length}): ${managed.conflicts.join(", ") || "none"}.` : "");
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
      renderTimingEdits();
    }
    setProperty(element2("propose-settings"), "disabled", busy || !ready || proposal != null);
    text2("vault-impact", !review ? "Saved authority remains active. A verified Core review is required before confirmation." : review.invalidatesAccess ? "Policy changes invalidate current requests, grants and Journeys." : "Settings changes preserve existing waits, grants and Journey terms. New activity uses the committed settings.");
    setProperty(element2("recover"), "disabled", busy || ready || status === "UNINITIALIZED" || status === "COMMITTING");
    text2("recover", view?.startup.status === "FAILED" ? "Retry startup" : "Reload and reconcile state");
    text2("startup-diagnostic", view?.startup.status === "FAILED" ? `Startup: ${view.startup.stage} \xB7 ${view.startup.reason}` : "");
    diagnosticPanel.render(view);
    const interruption = authorityInterruptionCopy(view?.authorityInterruption);
    const curated = view?.curatedUpgrade;
    text2("policy", controller?.snapshot ? `Exact Allowed sites hosts: ${policy.whitelist.length}
Manual Blocked sites hosts: ${policy.blacklist.length}
Policy revision: ${controller.snapshot.policyRevision}
State: ${status}${controller.reason ? ` \xB7 ${controller.reason}` : ""}${status === "UNAVAILABLE" && view?.storage?.lastFailure ? `
${storageFailureCopy(view.storage)}` : ""}` + (policy.whitelistSubdomains?.length ? `
Subdomain scope bases: ${policy.whitelistSubdomains.join(", ")}` : "") + (curated ? `
Curated expansion: ${curated.added.length} added, ${curated.alreadyPresent.length} already present, ${curated.skippedBlacklisted.length + curated.skippedManaged.length} skipped. Exact results are in the diagnostics export.` : "") + (interruption ? `
${interruption}` : "") : startupCopy(view?.startup) || "No verified policy loaded.");
  }
  function renderHome(policy, ready) {
    const savedPins = presentationView();
    if (savedPins) {
      pins = savedPins.pins;
      pinsLoaded = true;
    }
    const verified = view?.controller?.status === "READY" && policy !== void 0;
    if (verified) lastVerifiedPolicy = policy;
    const displayPolicy = verified ? policy : lastVerifiedPolicy ?? policy;
    const destinationKey = JSON.stringify([displayPolicy ?? null, sites.metadata(), pins]);
    if (destinationsKey !== destinationKey) {
      destinationsKey = destinationKey;
      entries = displayPolicy ? destinationIndex(displayPolicy, sites.metadata(), pins) : [];
      homeCatalog = homeCategories(entries, displayPolicy ? policyDestinationIndex(displayPolicy, sites.metadata(), pins) : [], sites.metadata().map((d) => d.category));
    }
    const catalog = homeCatalog;
    homeOrganization.observe(catalog, verified);
    renderPins();
    homeOrganization.render();
    renderSearch();
    const state = collectionPresentation(view?.controller, entries.length, queryAttempted && view?.startup?.status !== "LOADING", displayPolicy !== void 0);
    setAttribute(element2("destinations"), "aria-busy", String(state.phase === "LOADING"));
    setProperty(element2("destinations").dataset, "phase", state.phase);
    text2("destination-state-message", state.message);
    setProperty(element2("destination-state"), "hidden", state.phase !== "UNAVAILABLE");
    setProperty(element2("retry-destinations"), "hidden", state.phase !== "UNAVAILABLE");
    setProperty(element2("open-destination-recovery"), "hidden", state.phase !== "UNAVAILABLE");
    setProperty(element2("empty-destinations"), "hidden", state.phase !== "EMPTY");
    setProperty(element2("pinned-empty"), "hidden", state.phase !== "READY" && state.phase !== "EMPTY" || pinnedDestinations(pinEntries(), pins).length > 0);
    for (const button of document.querySelectorAll(".destination-open")) {
      setProperty(button, "disabled", busy || !ready || !hasCommittedCollection(view?.controller));
    }
  }
  function pinEntries() {
    const v = presentationView();
    const combined = entries.map((e) => v?.sync.labels[destinationId(e)] ? { ...e, label: v.sync.labels[destinationId(e)] } : e);
    for (const g of v?.sync.groups ?? []) {
      const index = combined.findIndex((e) => destinationId(e) === g.id);
      const entry = { id: g.id, label: v?.sync.labels[g.id] ?? g.label, hostname: g.hostname, hostnames: [g.hostname], category: "Bookmarks" };
      if (index < 0) combined.push(entry);
      else combined[index] = { ...combined[index], label: entry.label };
    }
    return combined;
  }
  function renderPins() {
    bookmarkSync.render();
    const saved = presentationView();
    if (saved) {
      pins = saved.pins;
      pinsLoaded = true;
    }
    const all = pinEntries();
    const active = pinnedDestinations(all, pins);
    setAttribute(element2("pinned-section"), "data-action-pending", busy && hasCommittedCollection(view?.controller) && canQueueOperation(view?.controller) ? "true" : null);
    homePins.render(all, pins, !busy && hasCommittedCollection(view?.controller) && canQueueOperation(view?.controller), pinsLoaded && !savingPins && canQueueOperation(view?.controller));
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
  async function togglePin(id) {
    if (!pinsLoaded || savingPins) return;
    const focused = document.activeElement;
    const pinnedFocus = focused instanceof HTMLButtonElement && focused.closest("#pinned-list") !== null;
    const entry = pinEntries().find((item) => destinationId(item) === id);
    const pinned = pins.includes(id);
    const next = updateDestinationPin(pins, id, !pinned, entry?.hostnames);
    if (next.length > 200) {
      feedback("Your pinned list is full. Unpin a site first.", "error");
      return;
    }
    savingPins = true;
    renderPins();
    try {
      const saved = await setPin(id, !pinned, entry?.hostnames);
      if (saved === "SAVED") {
        pins = presentationView().pins;
        feedback("");
      } else feedback(saved === "FAILED" ? "Your pin could not be saved. Access and policy are unchanged." : "The pin save outcome could not be verified. Access and policy are unchanged.", saved === "FAILED" ? "error" : "uncertain");
    } finally {
      savingPins = false;
      render();
      if (pinnedFocus && !focused.isConnected) {
        searchInput.focus({ preventScroll: true });
      }
    }
  }
  function renderReview(review, hasProposal) {
    const tone = review?.phase === "WAITING" ? "wait" : review?.phase === "READY" ? "ready" : review?.phase === "EXPIRED" ? "expired" : "unavailable";
    if (element2("vault-phase").dataset.tone !== tone) setProperty(element2("vault-phase").dataset, "tone", tone);
    text2("vault-phase", review?.phase === "WAITING" ? "Waiting" : review?.phase === "READY" ? "Ready to confirm" : review?.phase === "EXPIRED" ? "Expired" : "");
    text2("vault-summary", review ? `${review.phase === "WAITING" ? "Saved proposal; waiting period is running." : review.phase === "READY" ? "Confirmation is available. Review the frozen contents before confirming." : "The confirmation window has expired."} Your active policy and settings stay in place until explicit confirmation and a successful save.` : hasProposal ? "Waiting to verify this proposal. Confirmation is unavailable." : "");
    const key2 = JSON.stringify(review ? [review.proposalId, review.whitelist, review.blacklist, review.whitelistSubdomains, review.currentConfiguration, review.candidateConfiguration] : null);
    if (key2 === reviewKey) return;
    reviewKey = key2;
    const changes = [];
    if (review) for (const [label, diff] of [["Allowed sites", review.whitelist], ["Blocked sites", review.blacklist]]) {
      if (diff.added.length > 0) changes.push(`${label} \xB7 add: ${diff.added.join(", ")}`);
      if (diff.removed.length > 0) changes.push(`${label} \xB7 remove: ${diff.removed.join(", ")}`);
    }
    if (review?.whitelistSubdomains) {
      if (review.whitelistSubdomains.added.length) changes.push(`Also allow all current/future subdomains at any depth \xB7 add bases: ${review.whitelistSubdomains.added.join(", ")}. Managed and manual blocking still apply to these additional descendants.`);
      if (review.whitelistSubdomains.removed.length) changes.push(`All-subdomain access \xB7 remove bases: ${review.whitelistSubdomains.removed.join(", ")}`);
    }
    element2("vault-changes").replaceChildren(...changes.map((value) => {
      const li = document.createElement("li");
      setProperty(li, "textContent", value);
      return li;
    }));
    setProperty(element2("vault-changes"), "hidden", changes.length === 0);
    const rows = review?.currentConfiguration && review.candidateConfiguration ? timingFields.flatMap((field) => {
      const current2 = field.value(review.currentConfiguration);
      const proposed = field.value(review.candidateConfiguration);
      if (current2 === proposed) return [];
      const row = document.createElement("tr");
      for (const cell of [field.label, `${current2} ${field.unit}`, `${proposed} ${field.unit}`]) {
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
    const searching = searchInput.value.trim().length > 0;
    setProperty(element2("home-search-panel"), "hidden", !searching || !searchOpen);
    const inputsKey = `${destinationsKey}
${JSON.stringify(presentationView()?.sync.groups)}
${searchInput.value}`;
    if (inputsKey !== searchInputsKey) {
      searchInputsKey = inputsKey;
      const next = searchDestinationTargets(pinEntries(), searchInput.value);
      const key2 = JSON.stringify([searchInput.value, next, homeCatalog]);
      if (key2 !== searchKey) {
        searchKey = key2;
        matches = next;
        highlighted = next.length === 1 ? 0 : -1;
        searchActions = [];
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
          const action = () => {
            searchOpen = false;
            renderSearch();
            void send({ kind: "OPEN_DESTINATION", url: `https://${hostname2}/` });
          };
          searchActions.push(action);
          button.addEventListener("click", () => {
            if (!button.disabled) action();
          });
          return button;
        }));
        if (searching) for (const category of homeCatalog.filter((c) => c.members.length && searchInput.value.toLowerCase().trim().split(/\s+/).every((w) => c.label.toLowerCase().includes(w)))) {
          const button = document.createElement("button");
          button.type = "button";
          button.id = `search-result-${searchActions.length}`;
          button.tabIndex = -1;
          button.className = "search-category";
          button.setAttribute("role", "option");
          button.textContent = `${category.label} ? Category`;
          const action = () => {
            searchOpen = false;
            sites.chooseCategory(category.key);
            navigate2("sites");
          };
          searchActions.push(action);
          button.addEventListener("mousedown", (e) => e.preventDefault());
          button.addEventListener("click", () => {
            if (!button.disabled) action();
          });
          element2("search-results").append(button);
        }
      }
    }
    setProperty(element2("search-results"), "hidden", searchActions.length === 0);
    setProperty(element2("search-empty"), "hidden", !hasCommittedCollection(view?.controller) || searchInput.value.trim() === "" || searchActions.length > 0);
    setAttribute(searchInput, "aria-expanded", String(searchOpen && searching));
    if (searchOpen && highlighted >= 0) setAttribute(searchInput, "aria-activedescendant", `search-result-${highlighted}`);
    else setAttribute(searchInput, "aria-activedescendant", null);
    for (const [index, button] of [...element2("search-results").children].entries()) {
      setAttribute(button, "aria-selected", String(index === highlighted));
      setProperty(button, "disabled", busy || !hasCommittedCollection(view?.controller));
    }
  }
  searchInput.addEventListener("input", () => {
    searchOpen = true;
    renderSearch();
  });
  searchInput.addEventListener("focus", () => {
    searchOpen = true;
    renderSearch();
  });
  window.addEventListener("pointerdown", (event) => {
    if (!element2("search-form").contains(event.target)) {
      searchOpen = false;
      renderSearch();
    }
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      searchOpen = false;
      renderSearch();
    }
    if (searchActions.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      searchOpen = true;
      highlighted = (highlighted + (event.key === "ArrowDown" ? 1 : highlighted < 0 ? 0 : -1) + searchActions.length) % searchActions.length;
      renderSearch();
      element2(`search-result-${highlighted}`).scrollIntoView({ block: "nearest" });
    }
  });
  element2("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const action = searchActions[highlighted] ?? (searchActions.length === 1 ? searchActions[0] : void 0);
    if (action && searchOpen && !busy && hasCommittedCollection(view?.controller)) action();
  });
  function rememberPage() {
    const focus = document.activeElement;
    navigation.save({
      ...navigation.value(),
      tab: selected,
      sites: sites.navigation(),
      pages: { ...navigation.value().pages, [page]: { scroll: viewportScrollSurface(page, sites.view()).scrollTop, focus: focus?.id ?? "" } }
    });
  }
  function historyData() {
    return { atlasSitesDirectory: sites.directory(), atlasSettings: settingsNavigation.value(), atlasSitesView: sites.view(), atlasSitesSelection: sites.navigation().selection };
  }
  function navigate2(name, preserveFeedback = false, fromHistory = false) {
    const accessLink2 = name === "access";
    if (accessLink2) name = "home";
    else if (name === "home" && !fromHistory) selected = "";
    rememberPage();
    homePins.leave();
    sites.leave();
    searchOpen = false;
    if (!preserveFeedback) feedback("");
    if (!fromHistory && page !== name) history.pushState(historyData(), "", `#${name}`);
    if (fromHistory) {
      sites.restoreDirectory(history.state?.atlasSitesDirectory);
      settingsNavigation.restore(history.state?.atlasSettings);
      sites.restoreView(history.state?.atlasSitesView, history.state?.atlasSitesSelection);
    }
    page = name;
    section = name === "vault" ? "settings" : name === "access" ? "home" : name;
    render();
    const target = name === "vault" ? element2("vault-section") : accessLink2 ? element2("temporary-title") : element2("main-content");
    if (name === "sites") sites.focusSelection();
    else (name === "vault" ? element2("vault-heading") : target.id === "main-content" ? target : target.querySelector("summary, h2") ?? target).focus({ preventScroll: true });
    const initialFocus = document.activeElement;
    const saved = navigation.value().pages[name];
    requestAnimationFrame(() => {
      if (page !== name) return;
      if (saved) viewportScrollSurface(page, sites.view()).scrollTop = saved.scroll;
      else target.scrollIntoView({ block: "start" });
      if (saved?.focus && document.activeElement === initialFocus && fromHistory) {
        const remembered = document.getElementById(saved.focus);
        if (remembered && !remembered.closest("[hidden]")) remembered.focus({ preventScroll: true });
      }
    });
  }
  history.replaceState(historyData(), "", `#${page}`);
  history.scrollRestoration = "manual";
  var controlTabId;
  void browser.tabs.getCurrent().then((tab) => {
    controlTabId = tab?.id;
  }).catch(() => void 0);
  var controlNavigation = (message, sender) => {
    if (sender.id !== browser.runtime.id || sender.tab || sender.url !== browser.runtime.getURL("_generated_background_page.html") || disposed || controlTabId === void 0 || message?.controlTabId !== controlTabId || message.kind !== "CONTROL_NAVIGATE" || !atlasPage(message.page ?? "") || !Number.isSafeInteger(message.tabId)) return false;
    const target = atlasPage(message.page);
    if (target === "access") selected = String(message.tabId);
    navigate2(target);
    void poll();
    return Promise.resolve({ navigated: true });
  };
  browser.runtime.onMessage.addListener(controlNavigation);
  addEventListener("pagehide", () => browser.runtime.onMessage.removeListener(controlNavigation));
  window.addEventListener("popstate", () => {
    navigate2(atlasPage(location.hash.slice(1)) ?? "home", true, true);
  });
  window.addEventListener("pagehide", rememberPage);
  element2("return-to-sites").addEventListener("click", () => navigate2("sites", true));
  for (const name of ["home", "sites", "vault", "settings"]) element2(`show-${name}`).addEventListener("click", () => {
    navigate2(name);
  });
  for (const button of document.querySelectorAll("[data-settings-panel]")) button.addEventListener("click", () => {
    if (page === "vault") navigate2("settings", true);
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
    settingsNavigation.choose("recovery-section");
    element2("recover").focus();
  });
  document.addEventListener("keydown", (event) => {
    if (document.querySelector("dialog[open]")) return;
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLElement && (event.target.closest("input, textarea, select") || event.target.isContentEditable)) return;
    event.preventDefault();
    navigate2("home");
    searchInput.focus();
  });
  function renderTimingEdits() {
    const config = view?.controller?.snapshot?.configuration;
    let count = 0;
    for (const field of timingFields) {
      const input2 = element2(field.id), edited = config != null && input2.value !== field.value(config);
      setProperty(input2.dataset, "edited", String(edited));
      if (edited) count++;
    }
    text2("timing-edited-count", count ? `${count} ${count === 1 ? "edited value" : "edited values"} \xB7 active settings unchanged` : "Active settings remain in effect until confirmation in Vault.");
  }
  element2("settings-form").addEventListener("input", renderTimingEdits);
  element2("settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const draft = Object.fromEntries(timingFields.map((field) => [field.id, element2(field.id).value]));
    const candidateConfiguration = configurationFromDraft(draft);
    if (candidateConfiguration === null) {
      feedback("Use positive values in whole milliseconds and a whole hop limit.", "error");
      return;
    }
    void send({ kind: "PROPOSE_SETTINGS", candidateConfiguration }).then((response) => {
      if (response?.result?.type === "COMMITTED") navigate2("vault", true);
    });
  });
  element2("setup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const hosts = (id) => element2(id).value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const defaults = element2("use-defaults").checked ? compileCuratedWhitelist() : null;
    const blacklist = hosts("blacklist");
    void send({ kind: "SETUP", policy: {
      whitelist: [.../* @__PURE__ */ new Set([...defaults?.whitelist ?? [], ...hosts("whitelist")])],
      blacklist,
      ...defaults ? { whitelistSubdomains: defaults.whitelistSubdomains?.filter((host2) => !blacklist.includes(host2)) } : {}
    } });
  });
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
        if (ticket === epoch) {
          const before = presentationView();
          void Promise.resolve(homePins.refresh()).then(() => {
            const after = presentationView();
            if (before?.sync.revision !== after?.sync.revision || before?.bookmarks.revision !== after?.bookmarks.revision || JSON.stringify(before?.pins) !== JSON.stringify(after?.pins) || JSON.stringify(before?.sync.warnings) !== JSON.stringify(after?.sync.warnings)) requestRender();
          });
        }
        if (ticket === epoch) void sites.refresh();
      }
    } catch {
      if (ticket === epoch) {
        queryAttempted = true;
        view = null;
        policyReview = null;
        render();
      }
    } finally {
      await diagnosticPanel.refresh();
    }
  }
  var refreshLoop = new RefreshLoop(refreshView, { delay: () => view?.controller?.status === "COMMITTING" || view?.controller?.status === "LOADING" ? 100 : 1e3 });
  function poll() {
    return refreshLoop.request();
  }
  document.addEventListener("visibilitychange", () => {
    ++epoch;
    diagnosticPanel.invalidate();
    refreshLoop.setActive(!document.hidden);
    if (!document.hidden) render();
  });
  window.addEventListener("pagehide", () => {
    disposed = true;
    ++epoch;
    diagnosticPanel.dispose();
    refreshLoop.dispose();
    homePins.dispose();
    destinationCards.dispose();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== pinsStorageKey && event.key !== null) return;
    if (event.key === pinsStorageKey || event.key === null) void Promise.resolve(homePins.refresh()).then(requestRender);
    const before = JSON.stringify(pins);
    try {
      if (event.key === pinsStorageKey || event.key === null) pins = readPins(JSON.parse(localStorage.getItem(pinsStorageKey) ?? "null"));
    } catch {
    }
    if (before !== JSON.stringify(pins)) render();
  });
  try {
    pins = readPins(JSON.parse(localStorage.getItem(pinsStorageKey) ?? "null"));
  } catch {
    feedback("Pinned sites are unavailable. Your saved policy is unaffected.", "error");
  }
  pinsLoaded = true;
  render();
  refreshLoop.setActive(!document.hidden);
})();
//# sourceMappingURL=main.js.map
