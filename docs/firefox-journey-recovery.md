# Journey visibility and interruption recovery (D21)

Authorized dogfooding fixes on 2026-10-02. Keep D18 authorization and Core unchanged. This document owns the narrow presentation/retry change.

## Before changing production behavior

Native Firefox 157.0, current build, isolated profile: `.tools/firefox-e2e-1cq7s8bq/result.json`.

1. Home's explicit root address starts Journey #1. Its correlated HTTP redirect commits `login.localhost`, IN_TRANSIT, one hop, five-minute fixed deadline.
2. The actual address bar requests `evil.localhost`. The server receives no request. Core ends #1 as UNRELATED_NAVIGATION and ordinary policy returns GREYLIST. The tab is replaced with Atlas.
3. Back revisits the old intermediate. Ordinary policy blocks it; #1 remains ENDED with its original deadline. The access UI selects the intermediate hostname, hides the Journey panel and has no restart action.
4. Explicitly opening the root again through Home succeeds: a new tab/context and Journey #2, fresh deadline/budget, same policy, no grants. A permanently stuck root launch was **not** reproduced. The observed trap is browser history plus missing root recovery; do not claim an unproven Core/correlation defect.

The intermediate's browserAction already has `J` and the correct root/countdown title after document arrival. In the native fresh profile its widget is in `unified-extensions-area`, outside the navigation toolbar and invisible with the menu closed. This explains why API publication tests did not establish visible browser chrome.

A separate credential-free public Canvas probe (`.tools/auth-enforcing-4qp6ko_r/result.json`) observed `canvas.kth.se` → `saml-5.sys.kth.se` → `login.ug.kth.se`, ACTIVE_JOURNEY, and a sign-in form. It did not submit credentials, reproduce an authenticated return or establish the user's exact repeated-retry failure.

## Small implementation

- Retain the existing toolbar badge/title and arrival reset handling. Request navbar placement for new installations. Firefox remembers user placement; existing users may need to pin Atlas manually. An extension cannot relocate itself after installation. [Mozilla browser_action](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_action).
- Add a small passive corner pill on active Journey documents: destination label and remaining time. It does not interact with login controls. Top-level content scripts receive only a read-only presentation projection, never snapshots, URLs, policy commands or credentials. The background verifies the owning context, displayed/current hostname, current saved authority and expiry. Missing/uncertain authority clears the display. Local time only renders/hides; it creates no authorization.
- Recreate the pill for each document; update text without rebuilding its nodes. Background publications and active-only read-only polling reconcile cancellation/failure/reload; pagehide clears it. Preserve the existing toolbar behavior. Normal non-Journey pages have no visible pill. [Mozilla content scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts).
- On a blocked tab with a verified ended Journey, show its original destination and **Restart journey**. The closed command accepts tab/Journey IDs, obtains the root from Core's latest ended record, checks current Core policy, and navigates to the root homepage through the ordinary BEGIN_NAVIGATION gate. Paths, queries and credential-bearing URLs are never replayed. A small per-context record may retain only the root origin and Journey ID for exact scheme/port routing; it carries no permission and disappears on owner restart.
- Stale retry IDs, removed/Blacklisted roots, unknown authority, closed contexts and failed saves cannot restart. A new attempt gets a new Core ID and committed current timing, with old request/redirect evidence discarded by ordinary navigation. Whitelist cards/search continue opening their selected root, independently of the blocked tab's selection.

Known COMMITTING checkpoints retain the controller's last verified saved snapshot for stable presentation. Candidate state is never displayed. Initial loading, unavailable authority and reconciliation show no active Journey. Each page display has a two-second freshness lease, bounded further by the Journey deadline; a missing/hung response clears it and invalidates delayed replies. A privileged retry still needs a new successful current Core checkpoint before its browser effect.

## Validation

On 2026-10-02: 169/169 Core tests and 84/84 extension tests pass, including seven new adapter scenarios. Core and extension builds/typechecks pass; Python compilation and diff whitespace checks pass. No Core source/API, dependency, permission, storage schema or D18 authorization change was made.

| Native Firefox 157.0 evidence | Result |
| --- | --- |
| Pre-fix `.tools/firefox-e2e-1cq7s8bq` | Hidden Extensions-menu widget, ended #1 on unrelated navigation, stale auth Greylist on Back, successful fresh root #2 with no recovery action. |
| `--journey-retry-only`, `.tools/firefox-e2e-m181z3ep` | Actual Home card/search via a synthetic HTTPS root, real Google address-bar denial, fresh IDs/deadlines/budgets, root retry in the blocked tab, stale auth reload, two intermediate documents, normal root/no inherited pill, completion and extension reload. Stable nodes, countdown 5:00 → 4:58, zero node replacement, no overlap with the synthetic form. New profile's widget is visibly in nav-bar. |
| `--productization`, `.tools/firefox-e2e-mplwymxt` | Existing stabilization plus normal/typed redirect chains, withheld server requests, Access wait/confirmation, preserved timestamps, local search/pins, toolbar badges, migration, protected settings and restart. |
| `--existing-policy`, `.tools/firefox-e2e-90qcgiol` | Reload retains the saved policy; curated preset proposal/review leaves permissions unchanged until protected confirmation. Existing navigation, Access and restart checks pass. |
| Full enforcing characterization, `.tools/auth-enforcing-967ph9tg` | All 34 existing mechanism characterizations pass with original authorization assertions. |
| Full observer-only comparison, `.tools/auth-passive-t0gtbv0p` | All 34 existing mechanism characterizations pass; this copy has no Atlas enforcement and is not permission evidence. |
| Public Canvas retry, `.tools/auth-enforcing-hfnb5bak` | Canvas → SAML → KTH login, actual Google GREYLIST and #1 UNRELATED_NAVIGATION, Back to `login.ug.kth.se` denied, actual Home Canvas creates #2 with a new context/five-minute deadline/12-hop cap and reaches KTH login. Pill/tooltip remain labelled Canvas. No credentials submitted, policy unchanged, no grants. |

[Portable hostname-only evidence](evidence/firefox-journey-recovery-d21.json) preserves the before/after state sequences, public Canvas retry and regression references without credentials or private URLs.

The Back fixture has cache-friendly response headers. This Firefox run emitted a new top-level request for the old auth host, which Atlas cancelled before the server saw a document request; it did **not** establish a BFCache restoration. Mocked unmatched-arrival tests separately cover restoration without a matching held request. Neither path may revive the old Journey.

An initial smoke run exposed a test click immediately after commit, before its fixture control existed. The click helper now waits for that actual control without changing authorization assertions. One initial full characterization failed at B_assign; its isolated case and full rerun passed without authorization changes. Failure traces are now retained only for sanitized synthetic fixtures; the timing failure's exact cause remains unconfirmed.

## Files changed in this focused pass

- Adapter: `extension/src/adapter/firefox-adapter.ts`, `journey-indicator.ts`, `diagnostics.ts`.
- Presentation: new `extension/src/content/journey-indicator.ts`; the ended-Journey panel/action in `extension/src/ui/main.ts` and `extension/src/ui/assets/index.html`.
- Bundle/registration: `extension/build.mjs`, `extension/manifest.json`.
- Tests: new `extension/tests/journey-recovery.test.mjs`, `extension/tests/support/fake-firefox.mjs`; new `extension/scripts/firefox_journey_retry.py`; focused additions to `firefox-e2e.py` and `firefox-auth-investigation.py`.
- Guidance: this report, foundation/architecture/acceptance references, UI-design reference and extension README. [Synthetic indicator preview](evidence/atlas-journey-d21.png), [recovery interface](evidence/atlas-journey-retry-d21.png) and portable evidence above.

Existing dirty D20 UI/icon work was preserved; it is not an additional redesign in D21.

## Remaining limits

The public run reaches KTH's credential form and verifies interruption/retry; a complete authenticated Canvas/KTH return remains untested. The user's permanently stuck explicit root launch was not reproduced, so no speculative correlation/Core fix was made. Remaining document-driven departures without HTTP redirect evidence retain D18's ordinary-policy behavior.

The pill is a passive web-document display, not a security boundary against a page that alters its DOM. It cannot display on Firefox's protected/internal pages, private contexts outside this adapter, or documents where content scripts are unavailable; the browserAction remains the browser-level surface. Firefox's API provides badge/title/popup surfaces, not arbitrary persistent text beside the address bar. Saved toolbar placement remains under user control. These limits do not expand authorization.
