"use strict";
(() => {
  // src/ui/presentation.ts
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
  function countdown(deadline, now) {
    const seconds = Math.max(0, Math.ceil((deadline - now) / 1e3));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
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

  // src/ui/dom.ts
  function setProperty(node, key, value) {
    if (node[key] !== value) node[key] = value;
  }

  // src/ui/popup.ts
  var el = (id) => document.getElementById(id);
  var tabId = null;
  var status = null;
  var disposed = false;
  function render() {
    const now = Date.now();
    setProperty(el("popup-status"), "textContent", status?.ready ? "Atlas is ready" : "Access cannot currently be verified");
    setProperty(el("popup-host"), "textContent", status?.hostname ?? "No website selected");
    setProperty(el("popup-access"), "textContent", !status?.ready ? "Open Settings to check or recover saved state." : !status.hostname ? "Atlas does not manage this browser page." : status.decision ? accessCopy(status.decision).title : "Checking this site\u2026");
    const journey = status?.ready && status.journey && status.journey.expiresAt > now ? status.journey : null;
    setProperty(el("popup-journey"), "textContent", journey ? `Journey to ${journey.hostname} \xB7 ${countdown(journey.expiresAt, now)} remaining \xB7 temporary navigation path` : "");
    setProperty(el("popup-journey"), "hidden", !journey);
    const decision = status?.ready ? status.decision : null;
    const timing = decision?.outcome === "WAIT" ? now < decision.readyAt ? `Waiting \xB7 ${countdown(decision.readyAt, now)} remaining` : now < decision.confirmBy ? `Confirmation available \xB7 ${countdown(decision.confirmBy, now)} to confirm` : "Request expired" : decision?.outcome === "REQUIRE_CONFIRMATION" ? now < decision.confirmBy ? `${countdown(decision.confirmBy, now)} to confirm` : "Request expired" : decision?.outcome === "ALLOW" && decision.reason === "ACTIVE_GRANT" ? now < decision.expiresAt ? `Temporary access \xB7 ${countdown(decision.expiresAt, now)} remaining` : "Temporary access expired" : "";
    setProperty(el("popup-timing"), "textContent", timing);
    setProperty(el("popup-timing"), "hidden", !timing);
    for (const b of document.querySelectorAll("[data-page]")) b.disabled = tabId === null || b.dataset.page === "access" && !status?.contextId;
  }
  var loop = new RefreshLoop(async () => {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id ?? null;
      const response = tabId === null ? null : await browser.runtime.sendMessage({ kind: "GET_TOOLBAR_STATUS", tabId });
      if (disposed) return;
      status = response?.status ?? null;
    } catch {
      status = null;
    }
    if (!disposed) render();
  }, { delay: () => 1e3 });
  for (const b of document.querySelectorAll("[data-page]")) b.addEventListener("click", async () => {
    if (tabId === null) return;
    try {
      const r = await browser.runtime.sendMessage({ kind: "OPEN_CONTROL_PAGE", page: b.dataset.page, tabId, contextId: status?.contextId ?? null });
      if (r?.opened) window.close();
      else el("popup-error").textContent = "That tab is no longer available. Reopen Atlas to choose a site.";
    } catch {
      el("popup-error").textContent = "Could not open Atlas. Please try again.";
    }
  });
  document.addEventListener("visibilitychange", () => loop.setActive(!document.hidden));
  addEventListener("pagehide", () => {
    disposed = true;
    loop.dispose();
  });
  loop.setActive(!document.hidden);
})();
//# sourceMappingURL=popup.js.map
