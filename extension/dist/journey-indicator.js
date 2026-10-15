"use strict";
(() => {
  // src/ui/presentation.ts
  function countdown(deadline, now) {
    const seconds = Math.max(0, Math.ceil((deadline - now) / 1e3));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  // src/content/journey-indicator.ts
  var host = null;
  var label = null;
  var time = null;
  var lease;
  var epoch = 0;
  var refreshing = null;
  var requested = false;
  function clear() {
    host?.remove();
    host = null;
    label = null;
    time = null;
    clearTimeout(lease);
    lease = void 0;
  }
  function show(input) {
    if (input === null || typeof input !== "object" || !("journeyId" in input) || !Number.isSafeInteger(input.journeyId) || !("destinationLabel" in input) || typeof input.destinationLabel !== "string" || !("expiresAt" in input) || typeof input.expiresAt !== "number" || !Number.isSafeInteger(input.expiresAt) || Date.now() >= input.expiresAt || !document.documentElement) {
      clear();
      return;
    }
    if (!host) {
      host = document.createElement("div");
      host.id = "atlas-journey-indicator";
      host.style.cssText = "all:initial!important;position:fixed!important;right:12px!important;bottom:12px!important;z-index:2147483647!important;pointer-events:none!important;max-width:calc(100vw - 24px)!important;";
      const shadow = host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = ":host{color-scheme:light}div{display:flex;gap:8px;align-items:center;max-width:320px;padding:8px 12px;border:1px solid #d0c8b8;border-radius:6px;background:#faf7f0;color:#505b3e;font:13px/1.5 system-ui,sans-serif}span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}span:last-child{flex-shrink:0;font-variant-numeric:tabular-nums}";
      const pill = document.createElement("div");
      pill.setAttribute("aria-label", "Atlas Journey");
      label = document.createElement("span");
      time = document.createElement("span");
      pill.append(label, time);
      shadow.append(style, pill);
      document.documentElement.append(host);
    }
    if (host.dataset.journeyId !== String(input.journeyId)) host.dataset.journeyId = String(input.journeyId);
    const copy = `Atlas Journey \xB7 ${input.destinationLabel}`;
    if (label.textContent !== copy) label.textContent = copy;
    const remaining = countdown(input.expiresAt, Date.now());
    if (time.textContent !== remaining) time.textContent = remaining;
    clearTimeout(lease);
    lease = setTimeout(() => {
      ++epoch;
      clear();
      if (refreshing) requested = true;
    }, Math.min(2e3, input.expiresAt - Date.now()));
  }
  function refresh() {
    if (refreshing) {
      requested = true;
      return refreshing;
    }
    refreshing = read().finally(() => {
      refreshing = null;
      if (requested) {
        requested = false;
        void refresh();
      }
    });
    return refreshing;
  }
  async function read() {
    const observed = ++epoch;
    try {
      const response = await browser.runtime.sendMessage({ kind: "GET_JOURNEY_DISPLAY" });
      if (observed === epoch) show(response?.presentation ?? null);
    } catch {
      if (observed === epoch) clear();
    }
  }
  browser.runtime.onMessage.addListener((input, sender) => {
    if (sender.id !== browser.runtime.id || input === null || typeof input !== "object" || !("kind" in input) || input.kind !== "ATLAS_JOURNEY_DISPLAY") return;
    ++epoch;
    show("presentation" in input ? input.presentation : null);
  });
  window.addEventListener("pagehide", () => {
    ++epoch;
    requested = false;
    clear();
  });
  window.addEventListener("pageshow", () => {
    void refresh();
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => {
    void refresh();
  }, { once: true });
  else void refresh();
})();
//# sourceMappingURL=journey-indicator.js.map
