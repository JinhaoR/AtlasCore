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

1. Save an initial policy with exact hostnames, such as `student.ladok.se`. Setup is available only in an empty repository. It cannot replace active policy.
2. Open an ordinary Whitelist URL to exercise the request gate.
3. Select **Open** next to a trusted destination, or use **Open a specific address**. This creates a new tab and an explicit fixed Journey. For an already loaded Whitelist tab, select it and use **Start Journey in this tab**. Typing an ordinary address does not automatically start a Journey.
4. An unknown destination opens the access panel for that tab. Choose **Request temporary access**, wait, then explicitly **Confirm and open**. The saved confirmation is followed by a fresh GET of the homepage. Blocked forms and login URLs are not replayed. Readiness alone never opens a page.
5. Use **End Journey** to stop an attempt. The Journey panel shows its original deadline and consumed hops. After the attempt ends, intermediate domains return to their ordinary Core assessment.

Journey intermediate destinations have one deadline and one context. Ordinary redirects and clicks do not create or renew an attempt. Blacklist still wins. Opening a popup or duplicating a tab does not copy a Journey. Pure Whitelist matching remains exact; a `www` hostname is a different entry.

The UI shows the Core decision/reason, a countdown, Journey phase/hops/deadline, and policy. Toolbar badges show `J`, `WAIT`, `GO` (confirmation available), or `!`. A closed selected tab stays selected as unavailable; actions never switch silently to another tab. Vault editing is deferred. Initial setup is the only direct initialization path; subsequent policy editing must use Core's Vault workflow.

**Navigation diagnostics** shows the latest 200 events, for one tab or all tabs: sequence, context/navigation identity, hostname, Core reason, and Journey summary. Export JSON or clear explicitly. The buffer is memory-only and clears on restart. No paths, queries, fragments, headers, cookies, bodies, or page content enter the log. Exported hostnames still reveal browsing interests; review an export before sharing.

## Structure

```text
extension/
├── manifest.json
├── package.json / package-lock.json / tsconfig.json
├── build.mjs
├── src/
│   ├── background/      # one controller, clock, configuration, startup
│   ├── adapter/         # Firefox events, contexts, messages, effects
│   ├── storage/         # transactional AtlasRepository implementation
│   └── ui/              # control interface, presentation, static assets
├── tests/               # real Core + fake time, Firefox API, IndexedDB
└── scripts/             # local native test and optional public-site investigation
```

`@atlas/core` is a local package dependency, bundled through its public exports. esbuild supplies the browser bundle; TypeScript and Firefox declarations type-check it. `fake-indexeddb` exists only in tests. There is no UI framework or runtime browser library.

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

The native scenario exercises initial setup, root → login → redirect through root → identity → root, the fixed deadline, unchanged policy, absence of grants, later intermediate denial, actual Greylist buttons/countdowns, focus retention, diagnostics, closed-tab selection, and background reload. A local HTTP server checks that the denied post-Journey request never arrived and that confirmation opens only the homepage. Reports, UI screenshots, and the isolated synthetic profile stay under ignored `.tools/firefox-e2e-*` for inspection.

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
