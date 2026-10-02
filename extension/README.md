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
3. Select a destination card, a search result, or use **Open a specific address**. The new tab enters the ordinary navigation gate. Whitelist navigation, including bookmarks, typed addresses, links and new tabs, starts the same Core Journey automatically. Actual root arrival ends it; later login starts through a new request to the Whitelisted root.
4. An unknown destination opens the access panel for that tab. Choose **Request temporary access**, wait, then explicitly **Confirm and open**. The saved confirmation is followed by a fresh GET of the homepage. Blocked forms and login URLs are not replayed. Readiness alone never opens a page. The exact request scope is listed before confirmation: primary host plus declared equivalent aliases, with no global www/subdomain rule. Existing requests/grants keep their old scope until consumed, cancelled or expired.
5. Use **End Journey** to stop an attempt. The Journey panel shows its intended service and original deadline; diagnostics retain hop details. After the attempt ends, intermediate domains return to their ordinary Core assessment.

Journey intermediate destinations have one deadline and one context. Correlated HTTP redirects preserve its fixed terms. Unrelated typed targets and cross-host links/forms use normal policy; same-host document actions may continue to an HTTP redirect. Manual Blacklist still wins; managed denial cannot be bypassed by a Journey or grant. Opening a popup or duplicating a tab does not copy a Journey. Pure Whitelist matching remains exact. The curated preset represents each service once with explicit equivalent aliases and distinct entry points; it never infers `www` equivalence.

Home shows local search, explicitly pinned destinations and service categories. `/` focuses search outside editable controls. Pin controls save local presentation preferences; blocked/removed destinations cannot return through pins. Longer categories have Show all / Show fewer. A compact Journey strip opens the selected context's focused access view. Sidebar links lead to Settings, Vault, Managed lists and Diagnostics; recovery remains in Settings. Toolbar badges show `J`, `WAIT`, `GO` (confirmation available), or `!`. A closed selected tab stays selected as unavailable; actions never switch silently to another tab. Policy and timing edits use protected forms in Settings. Adding the current curated preset to an existing policy uses the protected action below. See [the interface refinement](../docs/ui-design.md) for the visual design and presentation boundary.

**Navigation diagnostics** shows the latest 200 events, for one tab or all tabs: sequence, context/navigation identity, hostname, Core reason, and Journey summary. Export JSON or clear explicitly. The buffer is memory-only and clears on restart. No paths, queries, fragments, headers, cookies, bodies, or page content enter the log. Exported hostnames still reveal browsing interests; review an export before sharing.

Destination cards discover website icons online, including custom hosts: Firefox favicon metadata, the site's own icon declarations, then a public-host favicon-cache fallback. Missing images show a globe. These presentation requests omit credentials/referrers and create no authorization or policy changes; details are in [the interface refinement](../docs/ui-design.md#online-website-icons).

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
2. Open Atlas → **Settings** / **Policy & recovery** → **Add curated destinations**. This button appears when the saved Whitelist is missing current preset entries. It proposes additions and keeps existing destinations and the manual Blacklist.
3. Review the frozen changes, wait the configured Vault period (30 seconds in this prototype), then select **Confirm change** within the confirmation window. Only the saved commit updates the active policy. It invalidates existing requests, grants, and Journeys. Cancel instead to keep your policy.

Reload retains pending proposal contents and deadlines; it never automatically applies defaults. The displayed policy revision and proposal review show authoritative Core data. Atlas policy lives in extension-origin **IndexedDB**, not `browser.storage.local`; an empty `storage.local` is not evidence that policy was lost. Managed list data lives in a separate IndexedDB cache and follows its daily refresh schedule.

To refresh the bundled data deliberately, run `python extension/scripts/bundle-stevenblack.py`, review the data/provenance changes, then run the normal extension tests and build. This fetches data and notices only. Preserve [upstream notices](data/stevenblack/NOTICE.md); the aggregated source data has multiple licenses. The complete contract is in [managed-policy.md](../docs/managed-policy.md).

## Storage and timing

The repository uses **IndexedDB in the extension origin**. `storage.local` get/set cannot provide the controller's atomic compare-and-swap contract. Whole snapshots and receipts commit together using strict-durability transactions. Commit success follows transaction completion; reads fence earlier writes. Receipt history supports reconciliation after later commits. It currently grows with writes; compaction and performance work remain future work.

Background reload retains pending requests, grants, and frozen timestamps. Core ends old Journeys because their native bindings are lost. Corrupt or unavailable authority blocks access. **Reload and reconcile state** retries recovery, never a confirmation. Deliberate removal, whole-profile deletion, physical power loss, and temporary add-on removal are not covered by the restart test.

Bootstrap development settings are in `src/background/configuration.ts`: 10-second Access wait, 60-second confirmation window and grant; 30-second Vault wait and 60-second confirmation window; five-minute Journey with 12 hops. These are initial development values, now protected authoritative state. Edit them in Settings, review the frozen Vault candidate, wait under the old active Vault timing and explicitly confirm. Atomic persistence activates the new settings. Existing requests, grants and Journeys retain frozen terms. Changing the source file cannot override saved configuration. Schema-1 snapshots migrate atomically with those original defaults, preserving policy/runtime terms and pending policy wait; damaged state fails closed. The real clock is injected only by the host; Core reads no browser clock.

## Validation

```sh
npm --prefix extension run typecheck
npm --prefix extension test
npm --prefix extension run test:firefox
```

The native command needs Python 3 and an installed Firefox. Set `FIREFOX_BINARY`, or run `python extension/scripts/firefox-e2e.py --firefox <path>` after building. The script uses Python's standard library, Mozilla's Marionette protocol, a fresh headless profile, and local synthetic hosts. It never uses your normal browser profile or real credentials. It enables privileged automation only in that isolated test process to open the private extension page.

After building, `python extension/scripts/firefox-e2e.py --existing-policy` also exercises an older saved policy across real reload, then the preset's Vault review/wait/confirmation UI before running the ordinary browsing/restart scenario.

The native scenario exercises curated setup, native managed denial and blocked Access request, managed cache restart, root → login → redirect through root → identity → root, ordinary/new-tab and actual address-bar Whitelist redirects, unrelated typed navigation denial, the fixed deadline, unchanged policy, absence of grants, later intermediate denial, actual Greylist buttons/countdowns, focus retention, diagnostics, closed-tab selection, and background reload. A local HTTP server checks that the denied post-Journey request never arrived and that confirmation opens only the homepage. Reports, UI screenshots, and the isolated synthetic profile stay under ignored `.tools/firefox-e2e-*` for inspection.

Optional live checks make external requests:

```sh
npm --prefix extension run test:public-sites
```

They visit public Ladok, Gmail, Microsoft, ORCID, and KTH Canvas entry points using a disposable profile. No identifiers, passwords, or consent grants are submitted. Raw browser logs are suppressed and the profile is deleted. Only sanitized diagnostics and form-presence flags remain in `.tools/firefox-public-*/result.json`. This is an investigation script, not a deterministic CI test or proof of authenticated compatibility. See the [real-site report](../docs/firefox-real-sites.md).

Mocked adapter tests and emulated repository tests run independently of Firefox. See [acceptance evidence](../docs/acceptance-tests.md#firefox-adapter-evidence-d15) for results and boundaries.

## Coverage limits

For event-level navigation/authentication evidence, see the [focused investigation](../docs/firefox-auth-investigation.md). After building, run `python extension/scripts/firefox-auth-investigation.py --mode enforcing` or `--mode passive`. Passive mode is an observer-only disposable addon copy; it does not test Atlas enforcement. Add `--public` for credential-free public entry probes. The test observer never enters normal bundles, and disposable browser profiles are removed.

- Pre-request gating covers exposed top-level HTTP(S) requests. Iframes and page resources are left to the browser.
- History/cache restoration and already displayed pages are checked after observation; there may be a visible interval before removal. Initial `about:blank` events cannot discard a newer held root request.
- Firefox internal/protected pages, private browsing, downloads, non-HTTP schemes, and other extensions are outside this slice. Disabling the extension removes its enforcement.
- Public sign-in checks are separate from authenticated compatibility. No complete real-account login or authenticated return has been tested.

Native test success establishes the tested events and backend operations. It does not establish exhaustive browser coverage or power-loss durability.

D18 verification and remaining strict-flow limitations are in [Firefox stabilization](../docs/firefox-stabilization.md). Rebuild and reload the temporary add-on to use the new adapter code; saved policy is retained. Older single-host requests/grants never widen automatically.

## Productization (D19)

Home leads with entirely local destination search and existing service categories. Search includes effective White entries, service labels and active explicit aliases; manual Blacklist removes an entry. Arrows select results and Enter opens a unique/highlighted result through ordinary held-request navigation. There is no external search or precreated homepage Journey. Settings retains policy management, timing controls, Vault, managed lists, recovery and diagnostics. KTH Mail uses the observed `webmail.kth.se`; saved policy gains it only through explicit Vault review/commit.

The toolbar displays **J** per owning tab with a service/root label and approximate remaining time in its tooltip. Firefox resets tab-specific badge text on document navigation, so the adapter reapplies it once after arrival and deduplicates unchanged timer displays. Expiry, completion, cancellation and uncertain authority clear Journey presentation. The badge creates no authority. See [Mozilla's badge API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/browserAction/setBadgeText).

After building, `python extension/scripts/firefox-e2e.py --productization` runs the normal native regression and additional real badge, keyboard search, protected settings, migration and reload checks in an isolated profile. Search uses a local HTTPS attempt without a TLS server to verify the actual held request; HTTP fixtures verify successful navigation/redirect rendering separately. This does not establish authenticated provider compatibility.

## Journey visibility and recovery (D21)

Active Journey documents show a small passive corner pill with the original destination and countdown. The existing `J` toolbar badge and tooltip remain. New installations request toolbar placement; existing Firefox profiles may need **Extensions → Atlas → Pin to toolbar**, because the extension cannot override saved placement. The pill is a read-only display and provides no permissions.

After interruption, the access page offers **Restart journey** when the saved ended record still has a Whitelisted root. It starts from that root's homepage through the ordinary gate, with a new Journey ID/deadline/hop budget. Home cards/search also start their selected roots in fresh tabs. Back/reload of old authentication pages cannot revive the ended Journey.

After building, run `python extension/scripts/firefox-e2e.py --journey-retry-only`. This uses an isolated profile, synthetic HTTP authentication pages and a local HTTPS root on port 443 so actual Home cards/search can run unchanged. It requires an available OpenSSL executable (the Windows Git installation was used), a free loopback port 443, and a profile-local Marionette certificate exception for the generated test certificate. No certificate or browser setting is installed in your normal profile.

Optional public verification: `python extension/scripts/firefox-auth-investigation.py --mode enforcing --public --case Canvas --journey-retry`. It requests public Canvas/KTH entry pages, blocks an actual Google address-bar attempt and retries through Home, without entering credentials. Sanitized evidence and known limits are in [Journey recovery](../docs/firefox-journey-recovery.md).
