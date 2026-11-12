"use strict";
(() => {
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

  // src/ui/ui-text.ts
  var themeText = {
    unavailable: "Appearance could not be loaded. The default theme is shown.",
    readFailed: "Appearance could not be refreshed. The last verified theme is still shown.",
    failed: "Appearance was not saved. Your selection is kept; retry to apply it.",
    uncertain: "Appearance save could not be verified. Your selection is kept; retry to apply it.",
    otherWindow: "Another window changed the saved appearance. Your unsaved choice is kept; retry to use it."
  };

  // src/ui/theme.ts
  var themeIds = ["default", "light-test", "celestial", "parchment"];
  var themeKey = "atlas-theme-v1";
  function themeId(value) {
    return themeIds.find((id) => id === value) ?? "default";
  }
  function readTheme(storage) {
    try {
      return { theme: themeId(storage().getItem(themeKey)), available: true };
    } catch {
      return { theme: "default", available: false };
    }
  }
  function saveTheme(storage, value) {
    if (!themeIds.some((id) => id === value)) return "FAILED";
    return savePresentation(storage, themeKey, value);
  }
  function initializeTheme(doc, win, storage = () => win.localStorage) {
    const initial = readTheme(storage);
    let saved = initial.theme;
    let draft = null;
    let message = initial.available ? "" : themeText.unavailable;
    function apply() {
      if (doc.documentElement.dataset.theme !== saved) doc.documentElement.dataset.theme = saved;
    }
    function controls() {
      const select = doc.getElementById("atlas-theme");
      if (select && select.value !== (draft ?? saved)) select.value = draft ?? saved;
      const status = doc.getElementById("theme-save-status");
      if (status && status.textContent !== message) status.textContent = message;
      const retry = doc.getElementById("theme-retry");
      if (retry) retry.hidden = draft === null;
    }
    function save() {
      if (draft === null) return;
      const outcome = saveTheme(storage, draft);
      if (outcome === "SAVED") {
        saved = draft;
        draft = null;
        message = "";
        apply();
      } else message = outcome === "FAILED" ? themeText.failed : themeText.uncertain;
      controls();
    }
    function change(event) {
      const target = event.target;
      if (target?.id !== "atlas-theme") return;
      draft = themeId(target.value);
      save();
    }
    function click(event) {
      if (event.target?.id === "theme-retry") save();
    }
    function external(event) {
      if (event.key !== themeKey && event.key !== null) return;
      try {
        if (event.storageArea !== storage()) return;
      } catch {
        return;
      }
      const current = readTheme(storage);
      if (!current.available) {
        message = themeText.readFailed;
        controls();
        return;
      }
      saved = current.theme;
      if (draft !== null) message = themeText.otherWindow;
      else message = "";
      apply();
      controls();
    }
    const ready = () => controls();
    const dispose = () => {
      doc.removeEventListener("DOMContentLoaded", ready);
      doc.removeEventListener("change", change);
      doc.removeEventListener("click", click);
      win.removeEventListener("storage", external);
      win.removeEventListener("pagehide", dispose);
    };
    apply();
    controls();
    doc.addEventListener("DOMContentLoaded", ready, { once: true });
    doc.addEventListener("change", change);
    doc.addEventListener("click", click);
    win.addEventListener("storage", external);
    win.addEventListener("pagehide", dispose, { once: true });
    return dispose;
  }

  // src/ui/theme-startup.ts
  initializeTheme(document, window);
})();
//# sourceMappingURL=theme-startup.js.map
