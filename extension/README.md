# Atlas Firefox prototype

A Firefox WebExtension consuming `@atlas/core`. Core decides policy, Greylist, Vault, and Journey behavior. The extension holds requests, supplies browser facts, persists snapshots, and executes saved decisions. The [architecture](../docs/firefox-adapter.md) records the choices made before implementation.

## Build and load

Use Node.js 24, npm, and Firefox 140 or newer. Firefox 157.0 on Windows is the native runtime exercised so far.

From the repository root:

```sh
npm --prefix packages/core ci
npm --prefix extension ci
npm --prefix extension run build
```

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `extension/dist/manifest.json`. Click the Atlas toolbar button (or its entry in the Extensions menu) to open the control page. Repeated toolbar clicks reuse that page. Temporary installation is a development workflow; Firefox removes temporary add-ons on exit. This is not a signed distribution.

1. Save the curated Whitelist offered during first setup. It includes AI, Mail, Video, Scholar / Research, Writing, University, and Development groups. Additional exact hostnames can be entered under **Additional hostnames and manual Blacklist**; the preset checkbox can be cleared. Setup is available only in an empty repository and cannot replace active policy.
2. Open an ordinary Whitelist URL to exercise the request gate.
3. Select **Open** next to a trusted destination, or use **Open a specific address**. This creates a new tab and an explicit fixed Journey. For an already loaded Whitelist tab, select it and use **Start Journey in this tab**. Typing an ordinary address does not automatically start a Journey.
4. An unknown destination opens the access panel for that tab. Choose **Request temporary access**, wait, then explicitly **Confirm and open**. The saved confirmation is followed by a fresh GET of the homepage. Blocked forms and login URLs are not replayed. Readiness alone never opens a page.
5. Use **End Journey** to stop an attempt. The Journey panel shows its original deadline and consumed hops. After the attempt ends, intermediate domains return to their ordinary Core assessment.

Journey intermediate destinations have one deadline and one context. Ordinary redirects and clicks do not create or renew an attempt. Manual Blacklist still wins; managed denial cannot be bypassed by a Journey or grant. Opening a popup or duplicating a tab does not copy a Journey. Pure Whitelist matching remains exact. The curated preset represents each service once with explicit equivalent aliases and distinct entry points; it never infers `www` equivalence.

The UI shows the Core decision/reason, a countdown, Journey phase/hops/deadline, and policy. Toolbar badges show `J`, `WAIT`, `GO` (confirmation available), or `!`. A closed selected tab stays selected as unavailable; actions never switch silently to another tab. General Vault editing is deferred; adding the current curated preset to an existing policy uses the narrow protected action below.

**Navigation diagnostics** shows the latest 200 events, for one tab or all tabs: sequence, context/navigation identity, hostname, Core reason, and Journey summary. Export JSON or clear explicitly. The buffer is memory-only and clears on restart. No paths, queries, fragments, headers, cookies, bodies, or page content enter the log. Exported hostnames still reveal browsing interests; review an export before sharing.

## Structure

```text
extension/
├── manifest.json
├── package.json / package-lock.json / tsconfig.json
├── build.mjs
├── data/stevenblack/    # pinned offline hosts, provenance, upstream notices
├── src/
│   ├── background/      # one controller, clock, configuration, startup
│   ├── adapter/         # Firefox events, contexts, messages, effects
│   ├── managed/         # defensive feed parsing, verified cache/refresh lifecycle
│   ├── presets/         # single curated service definition with explicit aliases
│   ├── storage/         # transactional AtlasRepository implementation
│   └── ui/              # control interface, presentation, static assets
├── tests/               # real Core + fake time, Firefox API, IndexedDB
└── scripts/             # local native test and optional public-site investigation
```

`@atlas/core` is a local package dependency, bundled through its public exports. esbuild supplies the browser bundle; TypeScript and Firefox declarations type-check it. `fake-indexeddb` exists only in tests. There is no UI framework or runtime browser library.

## Curated defaults and managed Blacklist

Edit [curated-whitelist.ts](src/presets/curated-whitelist.ts) to change the initial preset. Its 31 services expand to 50 exact hostnames. Google Search and login infrastructure are excluded. Canvas includes only `canvas.kth.se`, `canvas.instructure.com`, and `learn.canvas.net`; other institution roots must be added explicitly. Login continuations use Journey, with no wildcard or authentication database.

The official [StevenBlack combined variant](https://github.com/StevenBlack/hosts) enables base + fakenews + gambling + porn + social. The bundled snapshot supplies 163,850 usable exact domains (six unsupported upstream names are skipped). A separate IndexedDB cache holds the verified last good feed, digest, source/version, and last refresh attempt. Startup checks staleness; at most one attempt occurs per 24 hours, including failures across restart. Empty, malformed, truncated, greatly reduced, or failed updates retain the good dataset. Navigation performs no dataset download or full scan.

Core decides manual Blacklist → explicit Whitelist → managed Blacklist → Access Grant / Journey → Greylist. **Managed Blacklist** shows count, categories, origin, upstream date/version, update time, and status. Diagnostics show exact Whitelist conflicts. Defaults are offered on first setup only; loading this version never overwrites existing user policy.

### Updating an existing development installation

1. Rebuild with `npm --prefix extension run build` from the repository root, then **Reload** Atlas in `about:debugging#/runtime/this-firefox`. Load `extension/dist/manifest.json` if you originally chose another folder. Firefox's [reload workflow](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/) rereads extension files; it is not a policy reset.
2. Open Atlas → **Policy & recovery** → **Add curated destinations**. This button appears when the saved Whitelist is missing current preset entries. It proposes additions and keeps existing destinations and the manual Blacklist.
3. Review the frozen changes, wait the configured Vault period (30 seconds in this prototype), then select **Confirm policy update** within the confirmation window. Only the saved commit updates the active policy. It invalidates existing requests, grants, and Journeys. Cancel instead to keep your policy.

Reload retains pending proposal contents and deadlines; it never automatically applies defaults. The displayed policy revision and proposal review show authoritative Core data. Atlas policy lives in extension-origin **IndexedDB**, not `browser.storage.local`; an empty `storage.local` is not evidence that policy was lost. Managed list data lives in a separate IndexedDB cache and follows its daily refresh schedule.

To refresh the bundled data deliberately, run `python extension/scripts/bundle-stevenblack.py`, review the data/provenance changes, then run the normal extension tests and build. This fetches data and notices only. Preserve [upstream notices](data/stevenblack/NOTICE.md); the aggregated source data has multiple licenses. The complete contract is in [managed-policy.md](../docs/managed-policy.md).

## Storage and timing

The repository uses **IndexedDB in the extension origin**. `storage.local` get/set cannot provide the controller's atomic compare-and-swap contract. Whole snapshots and receipts commit together using strict-durability transactions. Commit success follows transaction completion; reads fence earlier writes. Receipt history supports reconciliation after later commits. It currently grows with writes; compaction and performance work remain future work.

Background reload retains pending requests, grants, and frozen timestamps. Core ends old Journeys because their native bindings are lost. Corrupt or unavailable authority blocks access. **Reload and reconcile state** retries recovery, never a confirmation. Deliberate removal, whole-profile deletion, physical power loss, and temporary add-on removal are not covered by the restart test.

Development settings are in `src/background/configuration.ts`: 10-second Access wait, 60-second confirmation window and grant; 30-second Vault wait and 60-second confirmation window; five-minute Journey with 12 hops. These are development values. The real clock is injected only by the host; Core reads no browser clock.

## Validation

```sh
npm --prefix extension run typecheck
npm --prefix extension test
npm --prefix extension run test:firefox
```

The native command needs Python 3 and an installed Firefox. Set `FIREFOX_BINARY`, or run `python extension/scripts/firefox-e2e.py --firefox <path>` after building. The script uses Python's standard library, Mozilla's Marionette protocol, a fresh headless profile, and local synthetic hosts. It never uses your normal browser profile or real credentials. It enables privileged automation only in that isolated test process to open the private extension page.

After building, `python extension/scripts/firefox-e2e.py --existing-policy` also exercises an older saved policy across real reload, then the preset's Vault review/wait/confirmation UI before running the ordinary browsing/restart scenario.

The native scenario exercises curated setup, native managed denial and blocked Access request, managed cache restart, root → login → redirect through root → identity → root, the fixed deadline, unchanged policy, absence of grants, later intermediate denial, actual Greylist buttons/countdowns, focus retention, diagnostics, closed-tab selection, and background reload. A local HTTP server checks that the denied post-Journey request never arrived and that confirmation opens only the homepage. Reports, UI screenshots, and the isolated synthetic profile stay under ignored `.tools/firefox-e2e-*` for inspection.

Optional live checks make external requests:

```sh
npm --prefix extension run test:public-sites
```

They visit public Ladok, Gmail, Microsoft, ORCID, and KTH Canvas entry points using a disposable profile. No identifiers, passwords, or consent grants are submitted. Raw browser logs are suppressed and the profile is deleted. Only sanitized diagnostics and form-presence flags remain in `.tools/firefox-public-*/result.json`. This is an investigation script, not a deterministic CI test or proof of authenticated compatibility. See the [real-site report](../docs/firefox-real-sites.md).

Mocked adapter tests and emulated repository tests run independently of Firefox. See [acceptance evidence](../docs/acceptance-tests.md#firefox-adapter-evidence-d15) for results and boundaries.

## Coverage limits

- Pre-request gating covers exposed top-level HTTP(S) requests. Iframes and page resources are left to the browser.
- History/cache restoration and already displayed pages are checked after observation; there may be a visible interval before removal. Initial `about:blank` events cannot discard a newer held root request.
- Firefox internal/protected pages, private browsing, downloads, non-HTTP schemes, and other extensions are outside this slice. Disabling the extension removes its enforcement.
- Public sign-in checks are separate from authenticated compatibility. No complete real-account login or authenticated return has been tested.

Native test success establishes the tested events and backend operations. It does not establish exhaustive browser coverage or power-loss durability.
