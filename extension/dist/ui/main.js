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

  // ../packages/core/dist/policy.js
  function normalizeEntries(input) {
    if (!Array.isArray(input))
      return null;
    const entries2 = [];
    for (const entry of input) {
      const hostname = normalizeHostname(entry);
      if (hostname === null)
        return null;
      entries2.push(hostname);
    }
    return entries2;
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

  // ../packages/core/dist/journey-state.js
  function hasJourneyFields(value, fields) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
  }
  function readJourneyLimits(value) {
    if (!hasJourneyFields(value, ["lifetimeMs", "maxHops"]) || !positiveInteger(value.lifetimeMs) || !positiveInteger(value.maxHops))
      return null;
    return { lifetimeMs: value.lifetimeMs, maxHops: value.maxHops };
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
  function compileCuratedWhitelist(groups = curatedWhitelist) {
    const hostnames = /* @__PURE__ */ new Set();
    for (const group of groups) for (const service of group.services) for (const hostname of serviceHostnames(service)) {
      if (normalizeTarget({ hostname })?.hostname !== hostname) throw new TypeError("Invalid curated hostname");
      hostnames.add(hostname);
    }
    return { whitelist: [...hostnames], blacklist: [] };
  }

  // src/ui/destinations.ts
  function destinationIndex(policy) {
    const active = new Set(policy.whitelist.filter((hostname) => evaluate({ hostname }, policy).outcome === "ALLOW"));
    const entries2 = [];
    for (const group of curatedWhitelist) for (const service of group.services) {
      const hostnames = serviceHostnames(service).filter((hostname) => active.has(hostname));
      if (hostnames.length === 0) continue;
      entries2.push({ label: service.label, hostname: hostnames[0], hostnames, category: group.label });
      hostnames.forEach((hostname) => active.delete(hostname));
    }
    for (const hostname of [...active].sort()) entries2.push({ label: hostname, hostname, hostnames: [hostname], category: "Your destinations" });
    return entries2;
  }
  function searchDestinations(entries2, query) {
    const words = query.trim().toLocaleLowerCase("en").split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return entries2.filter((entry) => words.every((word) => `${entry.label} ${entry.hostnames.join(" ")}`.toLocaleLowerCase("en").includes(word)));
  }

  // src/ui/home-model.ts
  function destinationId(entry) {
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
    return pins2.flatMap((id) => active.has(id) ? [active.get(id)] : []);
  }
  function destinationEntryPoints(entry) {
    for (const group of curatedWhitelist) for (const service of group.services) {
      if (!serviceHostnames(service).includes(entry.hostname)) continue;
      const active = [service.hostname, ...service.destinations ?? []].filter((hostname) => entry.hostnames.includes(hostname));
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
  async function loadWebsiteIcon(hostname, observedIcon, fetcher = fetch) {
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname)) return null;
    const root = `https://${hostname}/`;
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
        const page = await fetcher(root, options);
        const bytes = await limitedBytes(page);
        if (bytes) for (const url of declaredIconUrls(new TextDecoder().decode(bytes), page.url || root).slice(0, 4)) {
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
    if (!hostname.includes(".") || /^\d+(?:\.\d+){3}$/.test(hostname) || /\.(?:localhost|local|internal|lan|home|corp|test|example|invalid)$/.test(hostname)) return null;
    const cached = new URL("https://www.google.com/s2/favicons");
    cached.searchParams.set("domain", hostname);
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
        return { title: decision.reason === "BLACKLISTED" || decision.reason === "MANAGED_BLACKLISTED" ? "This site is blocked" : "Access is unavailable", description: decision.reason === "BLACKLISTED" ? "Your Blacklist prevents access to this destination." : decision.reason === "MANAGED_BLACKLISTED" ? "The managed StevenBlack list blocks this destination. Temporary access and Journey cannot override it." : "Atlas could not authorize this navigation. Check the decision details below.", tone: "blocked" };
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
  function selectedAccessRecord(decision, state, hostname) {
    let pending;
    let grant;
    if (state != null && hostname != null && decision != null) {
      if ((decision.outcome === "WAIT" || decision.outcome === "REQUIRE_CONFIRMATION") && decision.target.hostname === hostname) {
        pending = state.pendingRequests.find((request) => request.id === decision.requestId && (request.scopeHostnames ?? [request.hostname]).includes(hostname));
      } else if (decision.outcome === "ALLOW" && decision.reason === "ACTIVE_GRANT" && decision.target.hostname === hostname) {
        grant = state.grants.find((entry) => entry.requestId === decision.requestId && (entry.scopeHostnames ?? [entry.hostname]).includes(hostname));
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

  // src/ui/sidebar.ts
  function initializeSidebar(toggle) {
    const key = "atlas-sidebar-v1";
    let collapsed = false;
    try {
      collapsed = localStorage.getItem(key) === "collapsed";
    } catch {
    }
    const apply = () => {
      document.body.dataset.sidebar = collapsed ? "collapsed" : "expanded";
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Minimize sidebar");
      toggle.title = collapsed ? "Expand sidebar" : "Minimize sidebar";
    };
    apply();
    toggle.addEventListener("click", () => {
      collapsed = !collapsed;
      apply();
      try {
        localStorage.setItem(key, collapsed ? "collapsed" : "expanded");
      } catch {
        toggle.title += " (for this page only)";
      }
    });
    window.addEventListener("storage", (event) => {
      if (event.storageArea !== localStorage || event.key !== key && event.key !== null) return;
      collapsed = event.newValue === "collapsed";
      apply();
    });
    window.matchMedia("(max-width: 700px)").addEventListener("change", (event) => {
      if (event.matches && document.activeElement === toggle) document.getElementById("show-home")?.focus();
    });
  }

  // src/ui/main.ts
  var element = (id) => document.getElementById(id);
  var text = (id, value) => {
    const node = element(id);
    if (node.textContent !== value) node.textContent = value;
  };
  initializeSidebar(element("sidebar-toggle"));
  var select = element("context");
  var params = new URL(location.href).searchParams;
  var selected = params.get("tab") ?? "";
  var view = null;
  var busy = false;
  var polling = false;
  var epoch = 0;
  var preparingScopes = /* @__PURE__ */ new Set();
  var optionsKey = "";
  var destinationsKey = "";
  var diagnosticKey = "";
  var policyReview = null;
  var policyReviewError = "";
  var section = "home";
  var accessFocused = params.get("view") === "access";
  var settingsKey = "";
  var policyFormKey = "";
  var displayedProposalId = null;
  var entries = [];
  var matches = [];
  var searchKey = "";
  var highlighted = -1;
  var pinsStorageKey = "atlas-home-pins-v1";
  var pins = [];
  var pinsLoaded = false;
  var savingPins = false;
  var pinnedKey = "";
  var reviewKey = "";
  var temporaryKey = "";
  var searchInput = element("destination-search");
  var websiteIcons = /* @__PURE__ */ new Map();
  var observedIcons = /* @__PURE__ */ new Map();
  var iconSnapshot = browser.tabs.query({}).then((tabs) => {
    for (const tab of tabs) if (tab.url && tab.favIconUrl) {
      try {
        const hostname = new URL(tab.url).hostname;
        if (!observedIcons.has(hostname)) observedIcons.set(hostname, tab.favIconUrl);
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
  buildVersion.textContent = `Atlas extension ${browser.runtime.getManifest().version}`;
  element("diagnostics").append(buildVersion);
  document.body.dataset.mode = params.get("view") === "access" ? "access" : "control";
  element("preset-preview").replaceChildren(...curatedWhitelist.map((group) => {
    const detail = document.createElement("details");
    detail.className = "preset-group";
    const summary = document.createElement("summary");
    summary.textContent = group.label;
    const content = document.createElement("p");
    content.textContent = group.services.map((service) => service.label).join(" \xB7 ");
    detail.append(summary, content);
    return detail;
  }));
  if (document.body.dataset.mode === "access") {
    element("page-title").textContent = "A moment for your next step.";
    element("page-description").textContent = "Your destination is waiting. You decide whether to continue.";
  }
  function feedback(message) {
    text("feedback", message);
    element("feedback").hidden = message === "";
  }
  async function send(command) {
    if (busy) return;
    busy = true;
    ++epoch;
    render();
    try {
      const response = await browser.runtime.sendMessage(command);
      if (response?.view) view = response.view;
      policyReview = null;
      policyReviewError = "";
      if (response?.tabId !== void 0 && (response?.result?.type === "COMMITTED" || response?.opened === true)) selected = String(response.tabId);
      feedback(response?.error === "CONTENT_REMOVAL_IN_PROGRESS" ? "Atlas is closing the previous page. Restart will be available in a moment." : response?.error ? `Atlas could not complete that action (${response.error}).` : response?.initialized === false ? "Setup was not saved. Check the hostnames; an existing policy cannot be replaced here." : response?.result?.type === "REJECTED" ? `That action is not available (${response.result.reason}).` : response?.result?.type === "BLOCKED" ? "State could not be saved or verified. Open Policy & recovery before trying again." : response?.opened === false ? "The tab changed before opening. Check the selected tab before continuing." : "");
    } catch {
      feedback("Atlas is unavailable. No access has been confirmed.");
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
  function render() {
    const focused = document.activeElement;
    text("page-title", section === "settings" ? "Settings" : accessFocused ? "A moment for your next step." : "Atlas");
    text("page-eyebrow", section === "settings" ? "YOUR SAVED COMMITMENTS" : accessFocused ? "A DELIBERATE NEXT STEP" : "YOUR INTERNET, WITH INTENTION");
    text("page-description", section === "settings" ? "Your destinations, intentional friction and saved commitments." : accessFocused ? "Your destination is waiting. You decide whether to continue." : "A place for the things you choose.");
    document.body.dataset.section = section;
    document.body.dataset.mode = accessFocused ? "access" : "control";
    const controller = view?.controller;
    const ready = canQueueOperation(controller);
    const status = controller?.status;
    text("status", busy ? status === "COMMITTING" ? "Saving\u2026" : "Working\u2026" : ready ? "Atlas is ready" : status === "UNINITIALIZED" ? "Setup needed" : status === "RECONCILING" ? "Recovery needed" : status === "UNAVAILABLE" ? "State unavailable" : "Connecting\u2026");
    element("status").title = element("status").textContent ?? "";
    if (element("status").dataset.ready !== String(ready)) element("status").dataset.ready = String(ready);
    element("setup").hidden = status !== "UNINITIALIZED";
    element("workspace").hidden = status === "UNINITIALIZED" || section === "settings";
    element("settings").hidden = section !== "settings";
    element("destinations").hidden = accessFocused;
    for (const name of ["home", "settings"]) {
      const button = element(`show-${name}`);
      button.setAttribute("aria-pressed", String(section === name));
      if (section === name) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    element("save-setup").disabled = busy || status !== "UNINITIALIZED";
    const contexts = view?.contexts.filter((context2) => context2.hostname !== null) ?? [];
    if (selected === "" && contexts.length > 0) selected = String(contexts[0].tabId);
    const context = selectedContext(contexts, selected);
    const choices = contexts.map((item) => ({ value: String(item.tabId), text: `Tab ${item.tabId} \xB7 ${item.hostname}` }));
    if (context === void 0) choices.unshift({ value: selected, text: selected === "" ? "No websites yet" : `Tab ${selected} is closed or unavailable` });
    const key = JSON.stringify(choices);
    if (optionsKey !== key) {
      optionsKey = key;
      select.replaceChildren(...choices.map(({ value, text: text2 }) => new Option(text2, value)));
    }
    select.value = selected;
    const result = context?.latest;
    const decision = result?.type === "ASSESSMENT" ? result.decision : null;
    const copy = accessCopy(decision);
    if (element("access-panel").dataset.tone !== copy.tone) element("access-panel").dataset.tone = copy.tone;
    text("hostname", context?.hostname ?? (selected === "" ? "Your next destination" : "Tab unavailable"));
    text("access-title", !ready && context !== void 0 ? "Waiting for verified state" : copy.title);
    text("access-description", !ready && context !== void 0 ? "Access stays paused until Atlas can verify its saved state." : copy.description);
    text("outcome", decision?.outcome.replaceAll("_", " ") ?? "No decision");
    text("decision", decision ? `${decision.outcome} \xB7 ${decision.reason}` : result ? `${result.type}${"reason" in result ? ` \xB7 ${result.reason}` : ""}` : "No current assessment.");
    text("context-detail", context ? `Context: ${context.contextId}
Navigation: ${context.navigationId}
Content: ${context.effect}${context.journey?.phase === "ENDED" ? `
Journey ${context.journey.id}: ${context.journey.endReason}` : ""}` : "");
    const now = Date.now();
    text("deadline", decision?.outcome === "WAIT" ? `Wait ${countdown(decision.readyAt, now)}` : decision?.outcome === "REQUIRE_CONFIRMATION" ? `Confirm within ${countdown(decision.confirmBy, now)}` : decision && "expiresAt" in decision ? `Access remaining ${countdown(decision.expiresAt, now)}` : "");
    const failedRemoval = context?.effect === "FAILED";
    element("effect-warning").hidden = !failedRemoval;
    text("effect-warning", failedRemoval ? "Firefox could not remove the document. Close the affected tab." : "");
    const { pending, grant } = selectedAccessRecord(decision, controller?.snapshot?.accessState, context?.hostname);
    const record = pending ?? grant;
    const preparedScope = context?.accessScope;
    const scope = record === void 0 ? preparedScope?.status === "READY" ? preparedScope.hostnames : [] : record.scopeHostnames ?? [record.hostname];
    const showScope = scope.length > 0 && (decision?.outcome === "GREYLIST" || decision?.outcome === "WAIT" || decision?.outcome === "REQUIRE_CONFIRMATION" || decision?.reason === "ACTIVE_GRANT");
    element("access-scope").hidden = !showScope;
    text("access-scope", showScope ? `Temporary access covers exactly: ${scope.join(", ")}` : "");
    const preparing = decision?.outcome === "GREYLIST" && preparedScope?.status !== "READY";
    element("access-scope-note").hidden = decision?.outcome !== "GREYLIST";
    text("access-scope-note", preparing ? "Checking the public site address before preparing your request\u2026" : preparedScope?.source === "CANONICAL_REDIRECT" ? "The site redirects between these addresses. Both will share one wait and one access deadline." : "Only the exact hostnames shown are covered. Other addresses may need a separate request.");
    if (preparing && ready && context !== void 0 && accessFocused && section === "home") prepareScope(context);
    const journey = context?.journey;
    const activeJourney = ready && journey != null && journey.phase !== "ENDED" && now < journey.expiresAt;
    element("access-panel").hidden = !accessFocused;
    element("home-journey").hidden = section !== "home" || accessFocused || !activeJourney;
    text("home-journey-label", activeJourney ? `${serviceLabel(journey.rootHostname)} \xB7 ${countdown(journey.expiresAt, now)} remaining` : "");
    element("show-access").hidden = section !== "home" || accessFocused || context === void 0 || activeJourney;
    const action = (id, show) => {
      element(id).hidden = !show;
      const button = element(id);
      const disabled = busy || !ready || context === void 0;
      if (button.disabled !== disabled) button.disabled = disabled;
    };
    action("start-access", decision?.outcome === "GREYLIST");
    if (preparing) element("start-access").disabled = true;
    text("start-access", preparing ? "Checking address\u2026" : "Request temporary access");
    action("confirm-access", decision?.outcome === "REQUIRE_CONFIRMATION");
    action("cancel-access", pending !== void 0);
    action("open-home", decision?.outcome === "ALLOW");
    action("start-journey", decision?.reason === "WHITELISTED" && !activeJourney);
    action("cancel-journey", activeJourney);
    const retry = context?.retry;
    const showRetry = retry != null && decision?.outcome !== "ALLOW" && ready;
    element("ended-journey").hidden = !showRetry;
    text("ended-journey-copy", showRetry ? context?.effect === "REMOVING" ? `Atlas is closing the previous page. You can restart your journey to ${retry.destinationLabel} in a moment.` : `${journeyEndCopy(retry.endReason)} Start again from ${retry.rootHostname}.` : "");
    action("restart-journey", showRetry);
    if (context?.effect === "REMOVING") element("restart-journey").disabled = true;
    element("home-note").hidden = decision?.outcome !== "REQUIRE_CONFIRMATION" && decision?.outcome !== "ALLOW";
    element("journey-panel").hidden = !activeJourney;
    text("journey-phase", activeJourney ? "Active" : "Ended");
    text("journey", journey ? `Journey \u2192 ${serviceLabel(journey.rootHostname)}` : "Pure Whitelist navigation automatically starts a bounded redirect Journey.");
    text("journey-time", journey ? activeJourney ? `${countdown(journey.expiresAt, now)} left \xB7 fixed deadline ${new Date(journey.expiresAt).toLocaleTimeString()}` : `Ended \xB7 ${journey.endReason?.replaceAll("_", " ").toLowerCase() ?? "complete"}` : "");
    const progress = element("journey-progress");
    progress.hidden = !activeJourney;
    if (activeJourney) progress.value = Math.max(0, (journey.expiresAt - now) / (journey.expiresAt - journey.startedAt));
    renderSettings(controller, ready, now);
    renderHome(controller?.snapshot?.policy, ready);
    renderTemporaryAccess(now);
    if (focused instanceof HTMLButtonElement && focused.closest("#access-panel") && (focused.disabled || focused.closest("[hidden]")) && accessFocused && section === "home") element("access-title").focus({ preventScroll: true });
    if (focused instanceof HTMLButtonElement && focused.closest("#vault-section") && (focused.disabled || focused.closest("[hidden]")) && section === "settings") element("vault-heading").focus({ preventScroll: true });
  }
  function renderTemporaryAccess(now) {
    const available = view?.temporaryAccess != null;
    const grants = (view?.temporaryAccess ?? []).filter((grant) => grant.expiresAt > now);
    const key = JSON.stringify(grants);
    const list = element("temporary-list");
    if (temporaryKey !== key) {
      temporaryKey = key;
      list.replaceChildren(...grants.map((grant) => {
        const row = document.createElement("li");
        row.className = "temporary-row";
        const copy = document.createElement("span");
        copy.className = "temporary-copy";
        const name = document.createElement("strong");
        name.className = "temporary-name";
        name.textContent = serviceLabel(grant.hostnames[0]);
        const scope = document.createElement("span");
        scope.className = "temporary-scope";
        scope.textContent = grant.hostnames.join(", ");
        scope.hidden = grant.hostnames.length === 1 && name.textContent === grant.hostnames[0];
        copy.append(name, scope);
        const time = document.createElement("span");
        time.className = "temporary-time";
        time.dataset.expiresAt = String(grant.expiresAt);
        time.title = `Expires at ${new Date(grant.expiresAt).toLocaleTimeString()}`;
        row.append(copy, time);
        return row;
      }));
    }
    for (const time of list.querySelectorAll(".temporary-time")) {
      const label = `${countdown(Number(time.dataset.expiresAt), now)} remaining`;
      if (time.textContent !== label) time.textContent = label;
    }
    list.hidden = !available || grants.length === 0;
    element("temporary-empty").hidden = !available || grants.length > 0;
    element("temporary-unavailable").hidden = available;
    text("temporary-count", available && grants.length > 0 ? `${grants.length} active` : "");
  }
  function renderSettings(controller, ready, now) {
    const status = controller?.status;
    const policy = controller?.snapshot?.policy;
    const proposal = controller?.snapshot?.vaultState.pendingProposal;
    element("settings-pending").hidden = proposal == null;
    element("settings-nav-status").hidden = proposal == null;
    const settingsLabel = proposal == null ? "Settings" : "Settings, pending change";
    element("show-settings").setAttribute("aria-label", settingsLabel);
    element("show-settings").title = settingsLabel;
    const proposalId = proposal?.id ?? null;
    if (controller?.snapshot && proposalId !== displayedProposalId) {
      displayedProposalId = proposalId;
      if (proposalId !== null) element("vault-section").open = true;
    }
    element("vault-empty").hidden = proposal != null;
    const missingDefaults = presetHostnames.filter((hostname) => !policy?.whitelist.includes(hostname));
    element("preset-update").hidden = !policy || missingDefaults.length === 0;
    text("preset-update-status", policy ? missingDefaults.length > 0 ? `${missingDefaults.length} curated hostnames are missing from your saved Whitelist.` : "Your saved Whitelist includes all current curated hostnames." : "");
    element("propose-defaults").hidden = !policy || missingDefaults.length === 0;
    element("propose-defaults").disabled = busy || !ready || proposal != null;
    element("vault-panel").hidden = proposal == null;
    const review = policyReview?.proposalId === proposal?.id && policyReview?.basePolicyRevision === controller?.snapshot?.policyRevision && policyReview?.baseConfigurationRevision === controller?.snapshot?.configurationRevision ? policyReview : null;
    renderReview(review, proposal != null);
    text("vault-review", review ? `Proposal ${review.proposalId} \xB7 policy revision ${review.basePolicyRevision}
Whitelist additions: ${review.whitelist.added.join(", ") || "(none)"}
Whitelist removals: ${review.whitelist.removed.join(", ") || "(none)"}
Blacklist additions: ${review.blacklist.added.join(", ") || "(none)"}
Blacklist removals: ${review.blacklist.removed.join(", ") || "(none)"}
Classification changes:
${review.classifications.map((change) => `${change.hostname}: ${change.before} \u2192 ${change.after}`).join("\n") || "(none)"}${review.candidateConfiguration ? `
Current settings: ${settingsCopy(review.currentConfiguration)}
Candidate settings: ${settingsCopy(review.candidateConfiguration)}` : ""}` : policyReviewError ? `Core review unavailable: ${policyReviewError}. Cancel or recover before proceeding.` : "Loading the frozen Core review\u2026");
    text("vault-deadline", review?.phase === "WAITING" ? `Vault wait ${countdown(review.readyAt, now)}` : review?.phase === "READY" ? `Confirm within ${countdown(review.confirmBy, now)}` : review?.phase === "EXPIRED" ? "This proposal expired. Cancel it before starting a new proposal." : "");
    element("confirm-policy").hidden = review?.phase !== "READY";
    element("confirm-policy").disabled = busy || !ready;
    element("cancel-policy").disabled = busy || !ready;
    const managed = view?.managed;
    text("managed-status", managed?.active ? `Status: active \xB7 ${managed.count.toLocaleString()} domains` : "Managed data is loading or unavailable.");
    text("managed-details", managed ? `Categories: ${managed.categories.join(" + ")}. Last updated: ${managed.lastUpdatedAt === null ? "bundled offline snapshot" : new Date(managed.lastUpdatedAt).toLocaleString()}. Upstream: ${managed.upstreamDate ?? "unknown"}.` : "");
    text("managed-source", managed ? `Origin: ${managed.origin}
Update: ${managed.updateStatus}
Last attempt: ${managed.lastAttemptAt === null ? "none" : new Date(managed.lastAttemptAt).toLocaleString()}
Source: ${managed.sourceUrl}
Version: ${managed.upstreamVersion ?? "unknown"}
Unsupported names skipped: ${managed.ignoredNames}` : "");
    text("managed-conflicts", managed ? `Whitelist exceptions in managed data (${managed.conflicts.length}): ${managed.conflicts.join(", ") || "none"}.` : "");
    const activeConfiguration = controller?.snapshot?.configuration;
    if (activeConfiguration) {
      const configKey = JSON.stringify(activeConfiguration);
      if (configKey !== settingsKey) {
        settingsKey = configKey;
        timingFields.forEach((field) => {
          element(field.id).value = field.value(activeConfiguration);
        });
      }
      timingFields.forEach((field) => {
        text(`active-${field.id}`, `Active: ${field.value(activeConfiguration)} ${field.unit}`);
      });
    }
    const formKey = policy === void 0 ? policyFormKey : JSON.stringify(policy);
    if (policy !== void 0 && formKey !== policyFormKey) {
      policyFormKey = formKey;
      element("policy-whitelist").value = policy.whitelist.join("\n");
      element("policy-blacklist").value = policy.blacklist.join("\n");
    }
    for (const id of ["propose-settings", "propose-policy"]) element(id).disabled = busy || !ready || proposal != null;
    text("vault-impact", review?.invalidatesAccess ? "Policy changes invalidate current requests, grants and Journeys." : "Settings changes preserve existing waits, grants and Journey terms. New activity uses the committed settings.");
    element("recover").disabled = busy || ready || status === "UNINITIALIZED" || status === "COMMITTING";
    text("policy", controller?.snapshot ? `Pure Whitelist: ${policy.whitelist.join(", ") || "(empty)"}
Blacklist: ${policy.blacklist.join(", ") || "(empty)"}
Policy revision: ${controller.snapshot.policyRevision}
State: ${status}${controller.reason ? ` \xB7 ${controller.reason}` : ""}` : "No verified policy loaded.");
  }
  function renderHome(policy, ready) {
    const destinationKey = JSON.stringify(policy ?? null);
    if (destinationsKey !== destinationKey) {
      destinationsKey = destinationKey;
      entries = policy ? destinationIndex(policy) : [];
      const groups = [];
      const categoryOrder = ["University", "Scholar / Research", "Writing", "Development", "Mail", "AI", "Video"];
      const rank = (category) => categoryOrder.includes(category) ? categoryOrder.indexOf(category) : categoryOrder.length;
      const categories = [...new Set(entries.map((entry) => entry.category))].sort((a, b) => rank(a) - rank(b));
      for (const category of categories) {
        const available = entries.filter((entry) => entry.category === category);
        const group = document.createElement("section");
        group.className = category === "Your destinations" ? "destination-section" : "service-group destination-section";
        group.dataset.category = category;
        const heading = document.createElement("div");
        heading.className = "section-heading";
        const title = document.createElement("h2");
        title.textContent = category;
        const count = document.createElement("span");
        count.className = "section-meta";
        count.textContent = `${available.length} destination${available.length === 1 ? "" : "s"}`;
        heading.append(title, count);
        const grid = document.createElement("div");
        grid.className = "destination-grid";
        grid.id = `destination-category-${groups.length}`;
        grid.append(...available.map(makeDestinationCard));
        if (available.length > 4) {
          let expanded = false;
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "category-toggle text-button";
          toggle.setAttribute("aria-controls", grid.id);
          const update = () => {
            toggle.textContent = expanded ? "Show fewer" : `Show all ${available.length} \u2192`;
            toggle.setAttribute("aria-expanded", String(expanded));
            toggle.setAttribute("aria-label", `${expanded ? "Show fewer" : "Show all"} ${category} destinations`);
            for (const [index, card] of [...grid.children].entries()) card.hidden = !expanded && index >= 4;
          };
          toggle.addEventListener("click", () => {
            expanded = !expanded;
            update();
          });
          update();
          heading.replaceChild(toggle, count);
        }
        group.append(heading, grid);
        groups.push(group);
      }
      element("destination-list").replaceChildren(...groups);
    }
    renderPins();
    renderSearch();
    element("empty-destinations").hidden = entries.length > 0;
    for (const button of document.querySelectorAll(".destination-open, #open-journey")) {
      if (button.disabled !== (busy || !ready)) button.disabled = busy || !ready;
    }
  }
  function icon(name) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    node.classList.add("icon");
    node.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#icon-${name}`);
    node.append(use);
    return node;
  }
  async function displayWebsiteIcon(image, hostname) {
    image.dataset.hostname = hostname;
    if (!websiteIcons.has(hostname)) websiteIcons.set(hostname, iconSnapshot.then(() => loadWebsiteIcon(hostname, observedIcons.get(hostname))).then((blob) => blob ? URL.createObjectURL(blob) : null).catch(() => null));
    const loading = websiteIcons.get(hostname);
    const url = await loading;
    if (!image.isConnected || image.dataset.hostname !== hostname || websiteIcons.get(hostname) !== loading) return;
    image.src = url ?? "site.svg";
  }
  function makeDestinationCard(entry) {
    const card = document.createElement("div");
    card.className = "destination-card";
    card.dataset.destinationId = destinationId(entry);
    const points = destinationEntryPoints(entry);
    const addresses = document.createElement("select");
    addresses.className = "service-addresses";
    addresses.setAttribute("aria-label", `${entry.label} entry point`);
    points.forEach((hostname) => addresses.append(new Option(hostname, hostname)));
    addresses.hidden = points.length < 2;
    const open = document.createElement("button");
    open.className = "destination-open";
    open.type = "button";
    open.setAttribute("aria-label", `Open ${entry.label}`);
    const mark = document.createElement("span");
    mark.className = "service-mark";
    mark.setAttribute("aria-hidden", "true");
    const image = document.createElement("img");
    image.className = "site-icon";
    image.width = 32;
    image.height = 32;
    image.alt = "";
    image.src = "site.svg";
    image.loading = "lazy";
    image.dataset.hostname = addresses.value;
    image.addEventListener("error", () => {
      if (!image.src.endsWith("/site.svg")) image.src = "site.svg";
    });
    mark.append(image);
    iconObserver.observe(image);
    const copy = document.createElement("span");
    copy.className = "destination-copy";
    const name = document.createElement("span");
    name.className = "destination-name";
    name.textContent = entry.label;
    const host = document.createElement("span");
    host.className = "destination-host";
    host.textContent = addresses.value;
    addresses.addEventListener("change", () => {
      host.textContent = addresses.value;
      void displayWebsiteIcon(image, addresses.value);
    });
    copy.append(name, host);
    open.append(mark, copy);
    open.addEventListener("click", () => {
      void send({ kind: "OPEN_DESTINATION", url: `https://${addresses.value}/` });
    });
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "pin-button";
    pin.dataset.pinId = destinationId(entry);
    pin.dataset.label = entry.label;
    pin.append(icon("pin"));
    pin.addEventListener("click", () => {
      void togglePin(destinationId(entry));
    });
    card.append(open, pin, addresses);
    return card;
  }
  function renderPins() {
    const active = pinnedDestinations(entries, pins);
    const key = JSON.stringify(active);
    if (key !== pinnedKey) {
      pinnedKey = key;
      element("pinned-list").replaceChildren(...active.map(makeDestinationCard));
    }
    element("pinned-empty").hidden = active.length > 0;
    for (const button of document.querySelectorAll(".pin-button")) {
      const pinned = pins.includes(button.dataset.pinId);
      const label = `${pinned ? "Unpin" : "Pin"} ${button.dataset.label}`;
      if (button.getAttribute("aria-pressed") !== String(pinned)) button.setAttribute("aria-pressed", String(pinned));
      if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
      if (button.title !== label) button.title = label;
      const disabled = !pinsLoaded || savingPins || !canQueueOperation(view?.controller);
      if (button.disabled !== disabled) button.disabled = disabled;
    }
  }
  function togglePin(id) {
    if (!pinsLoaded || savingPins) return;
    const focused = document.activeElement;
    const pinnedFocus = focused instanceof HTMLButtonElement && focused.closest("#pinned-list") !== null;
    const next = pins.includes(id) ? pins.filter((pin) => pin !== id) : [...pins, id];
    if (next.length > 200) {
      feedback("Your pinned list is full. Unpin a destination first.");
      return;
    }
    savingPins = true;
    renderPins();
    try {
      localStorage.setItem(pinsStorageKey, JSON.stringify(next));
      pins = next;
      feedback("");
    } catch {
      feedback("Your pin could not be saved. Access and policy are unchanged.");
    } finally {
      savingPins = false;
      render();
      if (pinnedFocus && !focused.isConnected) {
        const counterpart = [...element("destination-list").querySelectorAll(".pin-button")].find((button) => button.dataset.pinId === id && button.closest("[hidden]") === null && !button.disabled);
        (counterpart ?? searchInput).focus();
      }
    }
  }
  function renderReview(review, hasProposal) {
    text("vault-phase", review?.phase === "WAITING" ? "Waiting" : review?.phase === "READY" ? "Ready to confirm" : review?.phase === "EXPIRED" ? "Expired" : "");
    text("vault-summary", review ? "These contents are frozen. Your active policy and settings stay in place until you confirm and Atlas saves the change." : hasProposal ? "Waiting for a verified Core review. Confirmation is unavailable." : "");
    const key = JSON.stringify(review ? [review.proposalId, review.whitelist, review.blacklist, review.currentConfiguration, review.candidateConfiguration] : null);
    if (key === reviewKey) return;
    reviewKey = key;
    const changes = [];
    if (review) for (const [label, diff] of [["Whitelist", review.whitelist], ["Blacklist", review.blacklist]]) {
      if (diff.added.length > 0) changes.push(`${label} \xB7 add: ${diff.added.join(", ")}`);
      if (diff.removed.length > 0) changes.push(`${label} \xB7 remove: ${diff.removed.join(", ")}`);
    }
    element("vault-changes").replaceChildren(...changes.map((value) => {
      const li = document.createElement("li");
      li.textContent = value;
      return li;
    }));
    element("vault-changes").hidden = changes.length === 0;
    const rows = review?.currentConfiguration && review.candidateConfiguration ? timingFields.flatMap((field) => {
      const current = field.value(review.currentConfiguration);
      const proposed = field.value(review.candidateConfiguration);
      if (current === proposed) return [];
      const row = document.createElement("tr");
      for (const cell of [field.label, `${current} ${field.unit}`, `${proposed} ${field.unit}`]) {
        const td = document.createElement("td");
        td.textContent = cell;
        row.append(td);
      }
      return [row];
    }) : [];
    element("vault-settings-rows").replaceChildren(...rows);
    element("vault-settings-comparison").hidden = rows.length === 0;
  }
  function renderSearch() {
    const next = searchDestinations(entries, searchInput.value);
    const key = JSON.stringify([searchInput.value, next]);
    if (key !== searchKey) {
      searchKey = key;
      matches = next;
      highlighted = next.length === 1 ? 0 : -1;
      element("search-results").replaceChildren(...matches.map((entry, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.id = `search-result-${index}`;
        button.setAttribute("role", "option");
        button.tabIndex = -1;
        button.addEventListener("mousedown", (event) => {
          event.preventDefault();
        });
        const copy = document.createElement("span");
        copy.className = "result-copy";
        const label = document.createElement("strong");
        label.textContent = entry.label;
        const host = document.createElement("small");
        host.textContent = entry.hostname;
        copy.append(label, host);
        button.append(copy, icon("arrow"));
        button.addEventListener("click", () => {
          void send({ kind: "OPEN_DESTINATION", url: `https://${entry.hostname}/` });
        });
        return button;
      }));
    }
    element("search-results").hidden = matches.length === 0;
    element("search-empty").hidden = searchInput.value.trim() === "" || matches.length > 0;
    searchInput.setAttribute("aria-expanded", String(matches.length > 0));
    if (highlighted >= 0) searchInput.setAttribute("aria-activedescendant", `search-result-${highlighted}`);
    else searchInput.removeAttribute("aria-activedescendant");
    for (const [index, button] of [...element("search-results").children].entries()) {
      button.setAttribute("aria-selected", String(index === highlighted));
      button.disabled = busy || !canQueueOperation(view?.controller);
    }
  }
  searchInput.addEventListener("input", () => {
    renderSearch();
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      searchInput.value = "";
      renderSearch();
    }
    if (matches.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      highlighted = (highlighted + (event.key === "ArrowDown" ? 1 : highlighted < 0 ? 0 : -1) + matches.length) % matches.length;
      renderSearch();
      element(`search-result-${highlighted}`).scrollIntoView({ block: "nearest" });
    }
  });
  element("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const entry = matches[highlighted] ?? (matches.length === 1 ? matches[0] : void 0);
    if (entry && canQueueOperation(view?.controller)) void send({ kind: "OPEN_DESTINATION", url: `https://${entry.hostname}/` });
  });
  function navigate(name) {
    feedback("");
    section = name === "home" ? "home" : "settings";
    if (name === "home") accessFocused = false;
    render();
    const target = name === "vault" ? element("vault-section") : element("main-content");
    if (target instanceof HTMLDetailsElement) target.open = true;
    target.scrollIntoView({ block: "start" });
    const heading = target.id === "main-content" ? target : target.querySelector("summary, h2") ?? target;
    heading.focus({ preventScroll: true });
  }
  for (const name of ["home", "settings"]) element(`show-${name}`).addEventListener("click", () => {
    navigate(name);
  });
  element("brand-home").addEventListener("click", (event) => {
    event.preventDefault();
    navigate("home");
  });
  element("review-pending").addEventListener("click", () => {
    navigate("vault");
  });
  for (const id of ["home-journey", "show-access"]) element(id).addEventListener("click", () => {
    feedback("");
    accessFocused = true;
    render();
    element("access-panel").scrollIntoView({ block: "start" });
    element("access-title").focus({ preventScroll: true });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLElement && (event.target.closest("input, textarea, select") || event.target.isContentEditable)) return;
    event.preventDefault();
    navigate("home");
    searchInput.focus();
  });
  element("settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const draft = Object.fromEntries(timingFields.map((field) => [field.id, element(field.id).value]));
    const candidateConfiguration = configurationFromDraft(draft);
    if (candidateConfiguration === null) {
      feedback("Use positive values in whole milliseconds and a whole hop limit.");
      return;
    }
    element("propose-defaults").closest("details").open = true;
    void send({ kind: "PROPOSE_SETTINGS", candidateConfiguration });
    navigate("vault");
  });
  element("policy-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const hosts = (id) => element(id).value.split(/\r?\n/).map((host) => host.trim()).filter(Boolean);
    element("propose-defaults").closest("details").open = true;
    void send({ kind: "PROPOSE_POLICY", candidatePolicy: { whitelist: hosts("policy-whitelist"), blacklist: hosts("policy-blacklist") } });
    navigate("vault");
  });
  async function diagnostics() {
    if (section !== "settings" || !element("diagnostics").open) return;
    const tabId = element("diagnostic-scope").value === "all" ? null : Number(selected || -1);
    try {
      const response = await browser.runtime.sendMessage({ kind: "GET_DIAGNOSTICS", tabId });
      const entries2 = response?.entries ?? [];
      const key = JSON.stringify(entries2);
      if (key === diagnosticKey) return;
      diagnosticKey = key;
      element("diagnostic-rows").replaceChildren(...[...entries2].reverse().map((entry) => {
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
          cell.textContent = value;
          row.append(cell);
        }
        return row;
      }));
      element("diagnostic-empty").hidden = entries2.length > 0;
    } catch {
      feedback("Diagnostics are temporarily unavailable.");
    }
  }
  select.addEventListener("change", () => {
    selected = select.value;
    render();
    void diagnostics();
  });
  element("setup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const hosts = (id) => element(id).value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const defaults = element("use-defaults").checked ? compileCuratedWhitelist().whitelist : [];
    void send({ kind: "SETUP", policy: { whitelist: [.../* @__PURE__ */ new Set([...defaults, ...hosts("whitelist")])], blacklist: hosts("blacklist") } });
  });
  element("journey-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void send({ kind: "OPEN_DESTINATION", url: element("destination").value.trim() });
  });
  element("start-access").addEventListener("click", () => {
    const context = selectedContext(view?.contexts ?? [], selected);
    if (context?.accessScope?.status === "READY")
      void send({ kind: "START_ACCESS", tabId: context.tabId, scopeId: context.accessScope.id });
  });
  for (const [id, kind] of Object.entries({
    "open-home": "OPEN_HOME",
    "start-journey": "START_JOURNEY",
    "cancel-journey": "CANCEL_JOURNEY"
  }))
    element(id).addEventListener("click", () => {
      if (selected !== "") void send({ kind, tabId: Number(selected) });
    });
  for (const [id, kind] of Object.entries({ "confirm-access": "CONFIRM_ACCESS_AND_OPEN", "cancel-access": "CANCEL_ACCESS" })) {
    element(id).addEventListener("click", () => {
      const context = selectedContext(view?.contexts ?? [], selected);
      const decision = context?.latest?.type === "ASSESSMENT" ? context.latest.decision : null;
      const { pending } = selectedAccessRecord(decision, view?.controller?.snapshot?.accessState, context?.hostname);
      if (pending && context) void send({ kind, requestId: pending.id, ...kind === "CONFIRM_ACCESS_AND_OPEN" ? { tabId: context.tabId } : {} });
    });
  }
  element("recover").addEventListener("click", () => {
    void send({ kind: "RECOVER" });
  });
  element("propose-defaults").addEventListener("click", () => {
    void send({ kind: "PROPOSE_CURATED_DEFAULTS" });
    navigate("vault");
  });
  for (const [id, kind] of Object.entries({ "confirm-policy": "CONFIRM_POLICY", "cancel-policy": "CANCEL_POLICY" })) {
    element(id).addEventListener("click", () => {
      const proposalId = view?.controller?.snapshot?.vaultState.pendingProposal?.id;
      if (proposalId !== void 0) void send({ kind, proposalId });
    });
  }
  element("diagnostics").addEventListener("toggle", () => {
    void diagnostics();
  });
  element("diagnostic-scope").addEventListener("change", () => {
    void diagnostics();
  });
  element("clear-diagnostics").addEventListener("click", () => {
    void browser.runtime.sendMessage({ kind: "CLEAR_DIAGNOSTICS" }).then(() => diagnostics()).catch(() => feedback("Could not clear diagnostics."));
  });
  element("export-diagnostics").addEventListener("click", () => {
    const tabId = element("diagnostic-scope").value === "all" ? null : Number(selected || -1);
    void browser.runtime.sendMessage({ kind: "GET_DIAGNOSTICS", tabId }).then((response) => {
      if (!Array.isArray(response?.entries)) throw new Error("Unavailable");
      const url = URL.createObjectURL(new Blob([JSON.stringify({ format: "atlas-diagnostics-v1", entries: response.entries }, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "atlas-diagnostics.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1e3);
    }).catch(() => feedback("Could not export diagnostics."));
  });
  async function poll() {
    if (polling) return;
    polling = true;
    const ticket = epoch;
    try {
      const response = await browser.runtime.sendMessage({ kind: "GET_VIEW" });
      if (ticket === epoch && response?.view) {
        view = response.view;
        const proposalId = view?.controller?.snapshot?.vaultState.pendingProposal?.id;
        if (view?.controller?.status === "READY" && proposalId !== void 0 && !busy) {
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
      }
      await diagnostics();
    } catch {
      if (ticket === epoch) {
        view = null;
        render();
        text("status", "Atlas is unavailable");
        element("status").title = "Atlas is unavailable";
      }
    } finally {
      polling = false;
      const pending = view?.controller?.status === "COMMITTING" || view?.controller?.status === "LOADING";
      setTimeout(() => {
        void poll();
      }, pending ? 100 : 1e3);
    }
  }
  window.addEventListener("storage", (event) => {
    if (event.key !== pinsStorageKey && event.key !== null) return;
    try {
      pins = readPins(event.newValue === null ? null : JSON.parse(event.newValue));
    } catch {
      pins = [];
    }
    render();
  });
  element("restart-journey").addEventListener("click", () => {
    const context = selectedContext(view?.contexts ?? [], selected);
    if (context?.retry) void send({ kind: "RESTART_JOURNEY", tabId: context.tabId, journeyId: context.retry.journeyId });
  });
  browser.tabs.onUpdated.addListener((_tabId, changes, tab) => {
    if (!changes.favIconUrl && !changes.url || !tab.url || !tab.favIconUrl) return;
    try {
      const hostname = new URL(tab.url).hostname;
      if (observedIcons.get(hostname) === tab.favIconUrl) return;
      observedIcons.set(hostname, tab.favIconUrl);
      websiteIcons.delete(hostname);
      for (const image of document.querySelectorAll(".site-icon")) if (image.dataset.hostname === hostname)
        void displayWebsiteIcon(image, hostname);
    } catch {
    }
  });
  try {
    pins = readPins(JSON.parse(localStorage.getItem(pinsStorageKey) ?? "null"));
  } catch {
    feedback("Pinned destinations are unavailable. Your saved policy is unaffected.");
  }
  pinsLoaded = true;
  void poll();
})();
//# sourceMappingURL=main.js.map
