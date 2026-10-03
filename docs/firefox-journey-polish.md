# Journey event ordering and bounded continuations (D22/D25)

Authorized dogfooding work on 2026-10-02. This pass fixes Firefox adapter ordering and recovery and implements the explicitly approved first departure from a loaded Pure Whitelist root. That narrow Core extension supersedes D18's first-departure restriction. Policy classification, grants, fixed deadlines and database schema remain unchanged.

D25 subsequently adds the approved POST continuation described below. D22's historical HTTP-only statements for later unfamiliar steps are narrowed by that explicit exception.

## Bounded POST continuations (D25)

The reported Ladok failure ended Journey 60 as `UNRELATED_NAVIGATION`, with ordinary `GREYLIST / UNLISTED` afterwards. It was not an expiry report. A synthetic unexpired Journey through a SAML host and a login host reproduces that result when the loaded login page submits a new cross-domain POST. Native Firefox's synthetic `H_SAML_POST` also demonstrates the existing form restriction. These reproductions establish the restriction; they do not establish the exact private Ladok request method without its navigation trace.

The user approved this concrete exception before implementation:

- The blocking event is a top-level, frame-zero HTTP(S) POST in the same bound context.
- Its browser-supplied initiator origin exactly matches the currently loaded document origin, including scheme and port. That loaded document has a saved ALLOW assessment and matches the active Journey's current hostname. No request body, form fields or credentials are read.
- Only an existing `IN_TRANSIT` Journey can use `FORM_POST`. It cannot start an attempt, renew one, restore it after reload, or revive an ended record. Core validates the current source hostname, policy revision, deadline and hop budget.
- Checking preserves the authorization cursor; recording a successful adopted step consumes the usual cross-host hop. The request stays held until that candidate is successfully committed. An actual root arrival ends the attempt normally; permission to request the root does not itself mean arrival.
- HTTP redirects and same-host actions continue under their existing rules. Later unfamiliar GET links/scripts, typed destinations and mismatched sources receive ordinary policy. Iframes receive no Journey authority; other tabs never inherit an attempt. Blacklist precedence remains unchanged.

`FORM_POST` is a trusted host fact in the platform-independent continuation contract. Firefox establishes method/document provenance; Core owns whether the fact continues the bounded attempt. The browser still owns authentication. A malicious authorized page can submit a POST to an unrelated hostname within the remaining budget. The accepted exception deliberately does not classify providers or infer purpose.

The ended-Journey warning identifies its saved end reason, separating an uncorrelated navigation from expiry, cancellation and exhausted hops. Diagnostics display that reason alongside the Journey record, plus the coarse request method (GET/POST/OTHER), source hostname and selected continuation kind. Paths, queries, form fields and request bodies remain excluded. These observations explain a decision and never provide authority.

Implementation is extension **0.1.5**. The portable model gains only `FORM_POST`; state shapes, saved records and database schema stay unchanged. Six new Core tests and ten new adapter tests cover the accepted continuation and its failure boundaries; a presentation test distinguishes end reasons. Current totals are **191 Core and 130 extension tests passing**. Builds and both TypeScript checks pass.

Native Firefox 157.0 runs use disposable profiles and synthetic sites. Before the change, `H_SAML_POST` is withheld and ends UNRELATED_NAVIGATION (`.tools/auth-enforcing-cb2vjbp9/result.json`). With D25, the complete 34-case enforcing investigation passes, including SAML POST return, typed-target denial, popup isolation, resource boundaries and Blacklist (`.tools/auth-enforcing-kqxccfhu/result.json`). The Journey polish sequence additionally covers a confirmation POST followed by an immediate cross-domain auto-POST and a root return with one Journey ID, fixed deadline and unchanged policy/grants. No authenticated real-account Ladok return was performed.

The final instrumented build also passes all **16 Journey check groups** (`.tools/firefox-e2e-dnybv90d/result.json`), including exact POST/source/continuation diagnostics for both confirmation hops. [Sanitized D25 evidence](evidence/firefox-post-continuation-d25.json) records the before/after results and limits. Reload `extension/dist/manifest.json`, verify **0.1.5** in Settings → Diagnostics, then start a fresh attempt from `student.ladok.se`. An old blocked POST is never replayed, and restart does not revive the old Journey.

## Reproduced defects

The failures below were reproduced deterministically with the real Core controller, isolated IndexedDB, fake time, and controlled Firefox events. They do not depend on credentials or authentication-specific rules.

### A fast intermediate action lost its actual source document

The adapter released a valid HTTP redirect to an intermediate. Firefox then committed that document and immediately issued a same-host action, such as a form submission. The arrival handler was queued, or its Core checkpoint was still being saved. A newer request incremented the tab generation before the handler finished recording the displayed document.

The next gate compared the action's browser-supplied origin against the previous displayed document. It supplied no SAME_HOST continuation, so Core correctly ended the Journey as UNRELATED_NAVIGATION and returned Greylist. The adapter had lost a real browser fact.

This event ordering is relevant to the previously measured public Canvas flow: an intermediate SAML-host document submits a same-host POST, whose HTTP redirects continue to KTH login. It does not establish the exact cause of the user's particular failure.

### Root arrival could be skipped before the next Login request

A root document arrival could also lose its queued publication when the following root Login request superseded it. The Core still needed that actual arrival to finish the previous attempt. Suppressing the entire handler could therefore leave the old attempt active instead of recording REACHED and starting a fresh attempt for Login.

### A restored root could falsely time out as a failed launch

An explicit retry armed the adapter's ten-second browser-effect watchdog. When a root document arrived without a matching held network request, ordinary policy correctly allowed the Whitelisted root. The adapter nevertheless left its launch flag and watchdog armed. The watchdog later removed the allowed root with NAVIGATION_DID_NOT_START.

### Old visible content could interfere with an early retry

After a Journey ended, replacing its intermediate document with the private Atlas page could still be in progress. Starting a root retry during that removal retained the previous displayed authorization. If its deadline then expired, the retained-content guard correctly removed it but also interrupted the newly requested root attempt.

The expired intermediate must still be removed. Discarding the expiry guard would conceal this ordering problem and weaken enforcement.

### Removal could replace the blocked hostname with the old page

Native Firefox reproduced Google being correctly denied, followed by a lifecycle recheck while the old identity document was still reported by Firefox. The adapter replaced the requested hostname and explanation with that old document before Atlas's replacement arrived. That selected the wrong Greylist destination and could confuse recovery. Deterministic tests reproduce the same result. During REMOVING, rechecks now preserve the blocked request and the original closure watchdog until actual removal is acknowledged. A new held request still enters the ordinary gate.

## Adapter changes

- Capture a matched browser arrival synchronously, before queued work can be superseded. Matching requires a released request with an already saved assessment, exact URL, and valid timestamp. This records physical document identity; it does not publish candidate permission.
- Preserve actual Core arrival bookkeeping when a newer request supersedes UI publication. Record ARRIVAL against the same captured Journey and context before the following queued gate. Leave the newer request intact. Root arrival still ends the old attempt before a subsequent ordinary root Login request can create a new one.
- Unmatched restored arrivals cannot borrow the old Journey. They end its binding before ordinary policy is evaluated. Older callbacks cannot replace a newer document or consume its fresh attempt.
- A failed or uncertain arrival save cannot release the following held request. Core remains responsible for the commit and authority result.
- Clear the launch watchdog after a verified HTTP document arrival. An unmatched Whitelisted root uses ordinary policy; it does not reconstruct redirect evidence or revive an ended Journey.
- Keep Restart disabled while prior content removal is in progress. Explain that Atlas is closing the previous page. After removal is acknowledged, the existing restart operation performs its fresh Core check and ordinary navigation gate.
- Clear the obsolete removal presentation after a successfully assessed document arrives.
- Preserve the denied destination during removal; observing the old page must not change the requested target or repeatedly restart its closure watchdog.
- Supply ROOT_DEPARTURE only when Firefox's origin matches the actual loaded document's origin and its saved Core assessment was WHITELISTED. Core revalidates current policy. Remember that source's sanitized origin for root recovery, including its scheme and port.
- If a newer root departure supersedes a saved first hop before release, close that exact unexecuted Journey through Core before checking the newer request. An adopted cursor is not evidence that its page loaded. This fixes a reproduced double-click denial without rebasing an active intermediate.

There is no supporting-domain database, inferred alias, provider exception, Context Whitelist or privileged page-controlled authorization message. A loaded Whitelisted root can start one fresh departure; later unfamiliar cross-host links/forms without HTTP evidence continue to use normal policy. Merely loading a root does not keep a Journey active indefinitely.

## State sequences

| Event | Retained domain behavior |
| --- | --- |
| Root request, HTTP redirect, intermediate document, immediate same-host action | Same Journey ID, deadline, and hop count; its response may provide the next correlated HTTP redirect. |
| Root document, immediate root Login request, HTTP redirect | Commit REACHED for the old attempt; start a fresh ID through BEGIN_NAVIGATION; authorize the new redirect chain under its own frozen terms. |
| Loaded root, direct cross-host Login link/form/script, HTTP redirects, root return | Start a source-rooted Journey at departure time, consume hop one, preserve one deadline through later correlated redirects, end RETURNED on root arrival. |
| First departure still saving, second request from the still-loaded trusted root | Cancel the unreleased request; commit closure of its saved attempt before assessing a fresh departure. No intermediate is treated as loaded. |
| Intermediate, typed Google, Restart after removal, root | Google remains Greylist; old attempt stays ended; new root request starts a fresh attempt. |
| Unmatched restored intermediate, immediate same-host action | Old binding ends; ordinary Greylist/grant/policy rules apply. |
| Unmatched restored Whitelisted root | Ordinary Whitelist ALLOW; old attempt stays ended; no stale launch timeout. |
| Visible intermediate expires while removal or another request is pending | Expired content is removed; no permission is created from the pending navigation. |

Policy and access grants are unchanged throughout these Journey paths. A tab cannot use another tab's Journey.

## Validation

Core: **185/185 tests passed**, including sixteen new first-departure tests. Extension: **114/114 tests passed**, including sixteen arrival/retry regressions and fourteen first-departure scenarios. Core and extension builds and typechecks passed. No dependencies, permissions or storage migration were added. The portable continuation API gains ROOT_DEPARTURE.

The new tests cover immediate and delayed-save arrival/action ordering, root completion before Login, unmatched restoration, failed/uncertain saves, duplicate and out-of-order callbacks, expiry during pending navigation, removal progress, the restored-root watchdog, superseded departure/denial/removal effects and startup reconciliation. First-departure tests prove exact origin and context scope, current source policy, target denial, unchanged grants and one consumed hop. Independent Whitelisted destinations retain ordinary requested-root behavior. Grants and Greylist sources cannot initiate this exception.

| Evidence | Result |
| --- | --- |
| Deterministic mocked Firefox with real Core and fake time | The identified ordering/watchdog defects fail against the prior adapter and pass with the fixes. These tests supply the before/after defect evidence. |
| Firefox 157.0 Journey polish, `.tools/firefox-e2e-1ecaalbi/result.json` | Loaded root followed by Login and intermediate auto-POST; four same-tab Google interruption/retry cycles; cancellation/restart; isolated tabs; four-second loading interval. All pass. Google remains blocked, deadlines remain fixed, and policy/grants remain unchanged. |
| Prior HEAD adapter against the same native fixture, `.tools/firefox-e2e-nrs2bqoi/result.json` | Also passes under normal native scheduling. This run does not reproduce the previous race and must not be presented as a native before/after failure. |
| Existing D21 native regression, `.tools/firefox-e2e-yt67wzhd/result.json` | Passes; presentation and interruption-recovery assertions remain intact. |
| Public Canvas before this pass, `.tools/auth-enforcing-ckneuijh/result.json` | Reaches the KTH login form and verifies fresh retry without credentials. It is existing public-flow evidence, not proof of D22's exact user failure. |
| Public `app.kth.se`, `.tools/auth-enforcing-trkji01q/result.json` | Root allowed and Journey ended REACHED. The public root did not expose a Login control. The user subsequently clarified that this is the blocked target reached after clicking Login on Canvas, not the originating page. |
| Full native stabilization/productization, `.tools/firefox-e2e-j_yxbmvm/result.json` | Passed: managed denial, ordinary/typed redirect chains, waiting/explicit confirmation/replay, diagnostics, context selection, icons/search/pins, timing protection, migration and restart. |
| Pre-exception authentication regression, `.tools/auth-enforcing-6l718uz7/result.json` and `.tools/auth-passive-23mqwszo/result.json` | All 34 original characterizations pass in both modes. These precede ROOT_DEPARTURE; observer-only completion is not Atlas permission evidence. |
| Prior strict direct Login probe, `.tools/firefox-e2e-zwg1gb8a/result.json` | Actual link from loaded root to an unlisted auth entry gets GREYLIST; no new Journey or server request. This supplies the native reproduction of the reported transition shape. |
| Native removal failure, `.tools/firefox-e2e-dasiqrwe/journey-polish-failure.json` | Google request correctly gets GREYLIST, then the old identity hostname overwrites it during removal. This is a real adapter failure, not a test automation attribution. A first uncaptured run failed at the same condition; the captured run establishes the cause. |
| Final 0.1.2 Journey polish, `.tools/firefox-e2e-3ngir1lb/result.json` | All fifteen grouped checks pass: existing arrival/retry paths plus direct GET/POST/script departures, strict later unfamiliar-link denial with server withholding, fixed terms, typed Google, same-tab recovery and unchanged policy/grants. |
| Final 0.1.2 enforcing characterization, `.tools/auth-enforcing-hqrkbzms/result.json` | All 34 checks pass with explicit D22 expectations. First origin-matched root actions allow; typed targets, popup inheritance, iframe promotion and later unfamiliar SAML POST remain blocked. Manual Blacklist still denies. The accepted malicious-root first-departure/HTTP risk is measured separately. |
| Final 0.1.2 D21 recovery regression, `.tools/firefox-e2e-k5hskona/result.json` | Passes: Home/search/Restart, actual Google denial, root retry, Back/reload denial, per-tab visibility, stable countdown nodes, no form overlap, and owner reload ending old bindings. |
| Final 0.1.2 stabilization/productization, `.tools/firefox-e2e-6e61dgrl/result.json` | Passes: managed denial, ordinary/typed navigation, independent post-Journey denial, Greylist wait/explicit confirmation, diagnostics, selection after closure, icons/pins/search, schema migration, protected timing and restart. |

Native fixtures use synthetic hostnames, ordinary forms without credentials, actual address-bar navigation, and isolated browser profiles. An observer-only run is not enforcement evidence. Authenticated Canvas/KTH completion remains untested.

The previous full fixture used `location.href` from the returned root to simulate an independent visit. D22 deliberately permits that first page-origin departure, so its former Greylist expectation is obsolete. The fixture now uses the real address bar and asserts that the ended Journey ID remains unchanged and the server receives no request. The dedicated departure scenarios separately assert permission for the approved link/form/script cases.

[Portable hostname-only evidence](evidence/firefox-journey-polish-d22.json) retains the strict-build failure, final direct-departure/recovery sequences, native removal-race trace and current enforcing matrix. It contains no private URLs or browser profiles.

## Build identification and reload

The extension version is now **0.1.2** in its package and manifest. Atlas Diagnostics shows the version reported by Firefox's loaded manifest. Reload the built `extension/dist/manifest.json` from `about:debugging`, then check Diagnostics for 0.1.2. This distinguishes the loaded build from a source change that Firefox has not loaded.

Reload preserves the existing authoritative policy and protected configuration. It does not refresh Whitelist entries by bypassing Vault. A stale build, a different loaded distribution directory, or existing-profile browser state may affect dogfooding; none was established as the user's cause in this pass.

## Files in this pass

- `extension/src/adapter/firefox-adapter.ts`: browser arrival facts, serialized Core arrival bookkeeping, launch completion, and retry/removal ordering.
- `extension/src/ui/main.ts`: removal-progress feedback and loaded-build marker.
- `extension/tests/journey-polish.test.mjs`: sixteen behavior regressions with fake time and isolated storage.
- `extension/tests/root-departure.test.mjs`: approved departure, failed saves, conservative supersession and denial cases.
- `packages/core/src/journey-models.ts`, `journey-state.ts`, `atlas-planner.ts`: portable first-departure parsing and policy/state decisions; sixteen new Core tests in `root-departure.test.mjs`.
- `extension/scripts/firefox_journey_polish.py`: focused native browsing scenarios.
- `extension/scripts/firefox-e2e.py`: native fixture/runner support.
- `extension/scripts/firefox-auth-investigation.py`: public-site investigation support.
- `extension/manifest.json`, `extension/package.json`, `extension/package-lock.json`: 0.1.2 build identification, without dependency changes.
- This report and the foundation/architecture/acceptance references maintained by the owning session.
- Generated `extension/dist/` and `packages/core/dist/` artifacts reflect the build.

The earlier authorized change to tracking `dist/` in Git is separate from this Journey fix.

## Remaining limits

The user clarified that `app.kth.se` is the blocked target after clicking Login on Canvas. The public root probe did not reproduce that originating transition. Do not claim this pass proves authenticated access to that page or a complete Canvas/KTH return.

D22 authorizes only the first browser-attested departure from a loaded trusted root. Later unfamiliar page actions, popups and uncorrelated transports still need ordinary policy authorization. Neither root origin nor a later return proves authentication purpose. A malicious Whitelisted page can choose the first intermediate; this is the explicitly accepted bounded tradeoff.

### Approved decision: one departure from a loaded trusted root

On 2026-10-02 the user explicitly approved one direct cross-domain departure from an actually loaded Pure Whitelist page. This covers a Canvas Login link targeting `app.kth.se`, but also other links or page-driven departures from trusted roots; browser provenance cannot prove authentication purpose. This supersedes D18 only for this first departure. No provider is added to policy or granted permanent trust.

The portable trusted fact is `ROOT_DEPARTURE { sourceHostname }` on `BEGIN_NAVIGATION`. The adapter must match Firefox's initiating origin to the actually displayed document, whose saved Core decision was WHITELISTED. Core revalidates the source against current policy, context binding, complete state and time. With no active attempt, Core starts a fresh Journey rooted at that source under the committed timing configuration. An existing STARTED attempt at the same root may consume this first departure without renewing its deadline. An IN_TRANSIT attempt cannot be rebased or renewed by this fact. The first adopted departure increments its hop count and moves to IN_TRANSIT; subsequent unfamiliar hops still require correlated HTTP redirects. CHECK, retention, arrival and page messages cannot create a Journey.

Manual or managed denial of the target still wins. Missing/mismatched origin, other contexts, untrusted/blacklisted sources, failed persistence, expiry and invalid state fail closed. Address-bar navigation supplies no departure evidence. Return document arrival ends the attempt normally. An independently Whitelisted target retains ordinary requested-root behavior; an explicitly same-host ROOT_DEPARTURE fact is invalid. Policy, grants and storage schema stay unchanged. This recorded decision is implemented in 0.1.2.

Browser history/cache coverage remains distinct from the deterministic unmatched-arrival tests. The isolated native fixture's passing prior adapter demonstrates that ordinary scheduling can hide the race; passing native browsing alone is insufficient to establish its absence.
