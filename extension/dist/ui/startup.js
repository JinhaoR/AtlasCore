"use strict";
(() => {
  // src/ui/navigation-state.ts
  function atlasPage(value) {
    return ["home", "sites", "settings", "vault", "access"].includes(value) ? value : null;
  }

  // src/ui/startup.ts
  var requested = atlasPage(location.hash.slice(1)) ?? (new URL(location.href).searchParams.get("view") === "access" ? "access" : "home");
  var page = requested === "access" ? "home" : requested;
  document.body.dataset.page = page;
  document.body.dataset.section = page === "vault" ? "settings" : page;
  document.body.dataset.mode = "control";
})();
//# sourceMappingURL=startup.js.map
