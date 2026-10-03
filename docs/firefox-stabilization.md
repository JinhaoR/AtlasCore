# Firefox behavior stabilization

## D28: Greylist request-time scope preparation (2026-10-03)

**Approved:** the user chose redirect-based scope preparation after reviewing this diagnosis. D28 narrowly supersedes D26's exclusion of live discovery; exact matching and frozen saved terms remain unchanged.

The user reports that Amazon Sweden and Google Drive work after one wait and confirmation, while Goodreads requires two. Public, credential-free HEAD requests observed `amazon.se` → `www.amazon.se` (301), `goodreads.com` → `www.goodreads.com` (301), and logged-out `drive.google.com` → `accounts.google.com` (302). These observations describe homepage responses, not authenticated compatibility.

The real controller and IndexedDB repository, exercised with fake browser events and time, reproduce the distinction: Amazon's declared two-host scope permits its redirect; a single-host Drive grant permits same-host navigation; a Goodreads grant permits the apex but the redirect to `www.goodreads.com` returns `UNLISTED`. Native Firefox 157 with Atlas 0.1.7 reproduces two separate saved grants through the actual UI. After the first denial its confirmation is still saved: the request is consumed and its exact apex grant remains. The second cycle authorizes another hostname. This is a mismatch between service-level intention and the request's prepared exact scope, rather than lost confirmation or a timer reset. Logged-out Drive can encounter the same boundary at its separate login host.

D26 fixed one instance with declared metadata. Adding another catalog entry for every report cannot solve the general problem. Core's exact matching, frozen scope and commit-before-permission behavior are doing their intended jobs. They should remain unchanged.

### Request-time scope preparation

Before a **new** Greylist request starts, the Firefox adapter checks the requested public HTTPS homepage for a canonical HTTP redirect when no reviewed aliases already provide its scope. A credential-free HEAD request inspects only the initial response; it does not render a page, follow an authentication flow, send a saved path/query, or change authority. The probe omits credentials and referrers, has a fixed three-second timeout, and correlates its own request ID and extension origin rather than page/resource traffic. Native Firefox confirms that Fetch hides manual-redirect headers while `webRequest.onHeadersReceived` exposes them. The observer waits for its matching headers or timeout, since headers can arrive after Fetch resolves. See [Mozilla's response-type contract](https://developer.mozilla.org/en-US/docs/Web/API/Response/type) and [response-header events](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onHeadersReceived).

Only a demonstrated redirect to the exact add/remove-`www` counterpart on standard HTTPS proposes the additional hostname. Eligible HTTP and HTTPS entries inspect the same hostname's HTTPS homepage; the original browsing origin remains unchanged. Custom ports, IP addresses and single-label/internal/reserved names use exact scope without probing. Arbitrary login hosts, other subdomains, country domains and unrelated destinations do not qualify. The redirect is an untrusted suggestion, not proof of ownership, equivalence or authentication purpose.

The Atlas interface shows the complete proposed exact scope **before Start**. Starting that disclosed request passes the scope to the existing Core API; the ordinary cooldown, explicit confirmation and atomic save produce one grant with a fixed deadline. `PREPARE_ACCESS` produces one ephemeral draft shared by the preview and Start. `START_ACCESS` references its opaque `scopeId`; production rejects missing, changed, foreign-context or still-preparing drafts. A changed tab/destination or policy revision invalidates the preparation. Discovery runs outside the operation queue so a slow site cannot hold other navigation checks. Core still rechecks all members against current manual and managed policy.

Discovery failure leaves the exact-host scope and explains the limitation. Existing live requests and grants keep their saved terms; discovery cannot expand them, transfer a wait, renew access or create a Journey. No discovered relationship is persisted as an alias or policy rule. Already reviewed explicit aliases remain supported. Sites using JavaScript redirects, credential-dependent redirects or separate login providers remain outside this narrow canonical-entry solution.

This changes request preparation only. Core's API, grant lifecycle, persistence acknowledgement and exact matching are unchanged. Declared aliases are metadata; discovered partners are ephemeral request terms. Neither creates permanent trust or global apex/`www` equivalence.

### Verification needed for implementation

- Undeclared canonical pair: one displayed frozen scope, one wait, one confirmation, one fixed-expiry grant; both navigations still pass through Core.
- Same-host or unrelated redirect, unavailable/malformed discovery, Blacklist member, changed context/policy and late asynchronous result: no undisclosed scope expansion or permission.
- Early/duplicate confirmation and failed/conflicting/unknown persistence: no page release.
- Existing singleton requests/grants and restart: original exact scope and timestamps remain unchanged.
- Expired/stale pending records: scope preview describes the next new request, rather than retained old terms. Display and action lookup select saved terms by the current Core decision's request ID; they do not independently decide validity.
- Real Firefox homepage evidence is separate from authenticated website compatibility; fixtures use fake time and isolated authority.

### D28 results

**HTTP entry follow-up, extension 0.1.9:** A subsequent review reproduced the same failure when the initial entry was `http://goodreads.com`. Version 0.1.8 passed the HTTPS three-site sequence, but its HTTP origin skipped discovery and froze an apex-only grant. Version 0.1.9 derives a standard HTTPS discovery origin from the requested hostname for either standard entry scheme. The draft remains bound to the original browsing origin, context and revision; requests still open that original origin. Only HTTPS response evidence can propose a counterpart. Custom ports are rejected before scheme conversion, and paths/queries never enter the probe. Core already matches hostnames across schemes, so this is a preparation correction with unchanged authorization semantics.

Three additional tests bring the suite to **180 extension tests**: HTTP/HTTPS probe validation and shared in-flight lookup; the exact same-tab Amazon → Drive → HTTP Goodreads sequence with one frozen grant through HTTP → HTTPS → `www`; and manual/managed denial for HTTP preparation. All pass, with builds and both TypeScript checks; **191 Core tests** remain passing. Native Firefox 157 confirms a genuine HTTP initial request, HTTPS-only HEAD discovery, disclosed pair and one wait/confirmation/grant on 0.1.9. Its HTTPS/HSTS test preferences affect only the disposable profile. [Sanitized HTTP evidence](evidence/firefox-greylist-http-d28.json) records protocol observations without URLs or credentials. A reported installed failure still needs its actual version/scope to distinguish this path from timeout, old singleton consent or expiry.

Extension **0.1.8** passes **177 extension and 191 Core tests**, builds and both TypeScript checks. Ten new discovery tests cover exact observed counterparts, request/origin correlation, delayed headers, timeout/cleanup, concurrent probes and malformed/unrelated responses. Thirteen new adapter scenarios cover one-cycle access, read-only preparation, consumed drafts/idempotent Start, denial precedence, foreign/stale contexts, nonblocking discovery, save failures, cancellation/expiry, legacy scopes and restart. Four presentation tests reject stale/mismatched records without inventing decisions.

Native Firefox 157 passes `firefox-greylist-alias.py --hostname goodreads.com` and the Amazon apex case on 0.1.8. The actual UI discloses the complete scope before Start, with no request or grant during discovery. One full wait and one explicit confirmation save one fixed-expiry grant and release the canonical page. Early/replayed confirmation is rejected, policy stays unchanged and no Journey is created. The Goodreads source is `CANONICAL_REDIRECT`; Amazon retains `DECLARED` metadata. [Sanitized evidence](evidence/firefox-greylist-scope-d28.json) includes the 0.1.7 failure and Firefox header feasibility probe alongside the passing checks. These are homepage authorization results, not authenticated compatibility claims.

## D26: Greylist canonical entry aliases (2026-10-03)

The Amazon report reproduces D18's hostname mismatch: a credential-free public HEAD request to `amazon.se` returned HTTP 301 to `www.amazon.se`. The existing alias lookup only describes curated Whitelist services, so Amazon's first grant covered the apex alone. The canonical redirect therefore required another full Greylist cycle. A regression test reproduced the missing second hostname before the fix.

Keep explicit alias metadata separate from classification. `extension/src/presets/access-aliases.ts` owns temporary-access scope lookup, reusing curated equivalent aliases and adding an explicit Amazon Sweden pair. Amazon remains Greylist; neither hostname is added to the preset policy. UI preview and trusted Start use the same lookup. No global apex/`www` inference, live discovery, redirect-based expansion, subdomain scope, or supporting-domain catalog is introduced. This applies the user's existing approval of declared equivalents to a service outside the Whitelist preset.

New requests list both exact hosts before waiting and freeze them into one pending request and one grant. Saved singleton requests and grants retain their old terms. Cancel an old pending request and start again, or let an old grant expire, to use updated scope; reload never silently widens authorization. Undeclared equivalent pairs remain separate until explicitly reviewed.

Native Firefox 157.0 exercised both public entry hostnames through the actual scope preview, Request button, countdown and Confirm button. Each reached `www.amazon.se` with one saved grant and `ACTIVE_GRANT`, no remaining pending request, unchanged policy, and no Journey. Premature and duplicate confirmation were rejected. [Sanitized evidence](evidence/firefox-greylist-alias-d26.json) and [acceptance results](acceptance-tests.md#greylist-canonical-alias-evidence-d26) separate this navigation check from authenticated or shopping compatibility.

**D22 update (2026-10-02):** The user approved one browser-attested departure from a loaded Pure Whitelist root after the Canvas Login report. Subsequent unfamiliar steps retain HTTP redirect requirements. The [Journey polishing report](firefox-journey-polish.md) owns the current contract and tests; the D18 results below describe the previous strict first-departure behavior.

**D19 update:** Protected timing configuration is now implemented in the aggregate snapshot and shared Vault workflow. See [productization.md](productization.md) for current semantics and evidence; the recommendations below describe the earlier stabilization pass.

Investigation began on 2026-10-01 after real first-run reports. This pass targets navigation semantics and presentation stability, without a homepage redesign or settings implementation.

## Findings before implementation

1. `webRequest.onBeforeRequest` asynchronously gates only frame-zero HTTP(S) `main_frame` requests. Resources and iframes are outside this intentional-access boundary.
2. Atlas Open explicitly starts a saved Core Journey. Ordinary bookmarks, typed addresses, links, and tabs receive only a navigation check.
3. Journey records live in `AtlasSnapshot.journeyState`, committed by the controller through the extension's IndexedDB repository. `rootHostname` is immutable target identity; `currentHostname` tracks intermediate navigation.
4. D11 admits any nonblocked intermediate within context, lifetime, and hop bounds. `onBeforeRedirect` currently records diagnostics without restricting admission to the correlated redirect target. An address-bar navigation can therefore borrow an active Journey.
5. Initial root document arrival leaves STARTED active; only a recorded return after leaving ends it. This explains both delayed login support and broad permission after first arrival.
6. The Greylist bridge starts one request, waits, explicitly confirms, saves one grant, then opens a fresh homepage GET. No second request is created automatically. The user identified Overleaf. A public credential-free HEAD check on 2026-10-01 observed HTTP 308 from `overleaf.com` to `www.overleaf.com`, followed by HTTP 200. That exact-host mismatch explains a second Greylist request on an old single-host policy; other reported hosts remain unverified. A grant for an apex does not authorize its `www` hostname.
7. Every-second retained-content checks advance observation time and commit checkpoints. UI polling treats transient LOADING/COMMITTING as whole-interface unavailability, swapping headings and button states. Destination/category nodes are already retained while policy is unchanged, so whole-page recreation is not the main cause.

## Necessary product boundary

The new request supersedes D15's explicit-only Journey initiation and D11's unrestricted bounded intermediate exception. There is no existing infrastructure allow policy: StevenBlack is managed deny data. Firefox can attest redirect correlation and an initiating document, but cannot prove that a hostname is necessary for authentication. A page-controlled link or return URL is not trusted proof of that necessity. No supporting-domain database, learned relationship, trust graph, or global alias will be introduced implicitly.

The user approved strict correlated HTTP redirects, automatic Journey initiation on every Whitelist request, and completion on destination document arrival. They separately approved one frozen Greylist request/grant covering explicitly declared equivalent aliases, displayed before confirmation. These choices are recorded as D18. Independently, presentation now keeps last verified semantic content stable during background housekeeping. Buttons queue intentions only; the controller still checks current state, saves transitions, and rejects failed/uncertain authority. Timer zero never creates permission.

## Deferred requirements

- **Journey visibility:** use the adapter's existing per-tab badge/title publication and deadlines. Add destination/countdown visibility without putting Firefox in Core.
- **Protected timing:** current configuration is host-injected and outside `AtlasSnapshot`. A future schema should freeze active timing alongside policy and propose a complete candidate through Vault. Proposal eligibility must use the old active Vault wait/window; new shorter timings activate only after commit. Existing pending requests/grants/Journeys retain their frozen terms. This needs schema/revision validation and restart tests, not unrelated mutable `browser.storage` settings.
- **Destination search:** search the curated service labels and active exact policy destinations. It is presentation/navigation intent, with every resulting request using the common gate.
- **KTH mail:** `webmail.kth.se` is a possible explicit service destination, distinct from Microsoft entry hosts. Verify it when reviewing the preset; do not add provider trust or aliases from branding.

Native evidence must distinguish HTTP redirects, page-initiated actions, and address-bar navigation. Countdown tests should observe DOM mutations and unchanged focus while timers still advance. Synthetic browser fixtures must contain no real accounts, cookies, tokens, or credential-bearing URLs.

## Implemented behavior

- Core `BEGIN_NAVIGATION` establishes the Whitelist attempt from any navigation origin. Read-only-style `CHECK_NAVIGATION` does not initiate attempts.
- Adapter supplies closed portable continuation facts. It must first correlate a released request, its observed HTTP redirect target, same request ID, timestamp order, and context. An unrelated typed address or cross-host link/form supplies no continuation. Request ID alone is insufficient.
- Same-host document actions can retain the current intermediate; correlated redirects from them can continue. Periodic retention and arrival have separate evidence kinds. Core validates the source against its authorization cursor. A root traversed without document arrival does not reset that cursor or end the attempt.
- Initial root arrival ends with REACHED, return after intermediates with RETURNED. A final different explicitly Whitelisted host ends with DESTINATION_CHANGED; this handles canonical destination arrival without making hosts globally equivalent. Deadline, hops, cancellation, revision and context loss still end attempts.
- Declared aliases are copied into optional `scopeHostnames` on the pending request and its single grant. Existing records without that field remain single-host; repeated Start never widens them. Cancel and start a new full wait, or let an old grant expire, to use changed terms. No automatic scope upgrade occurs on reload. Older builds that cannot validate new fields fail closed.
- Stable UI content uses the last verified snapshot during transient housekeeping, with all actions still queued through current controller validation and commit. Startup, uncertain authority, and failures remain unavailable.

## Evidence

The owning acceptance document records final test totals and native artifacts. Native scenarios use a fresh profile, local HTTP fixture, actual URL-bar commands, real IndexedDB, explicit UI confirmation, replay rejection, fixed-deadline redirect paths, server-hit assertions, background restart, and a MutationObserver verifying idle countdown updates without heading/button/list churn. Public Overleaf evidence establishes its current canonical redirect only. It does not prove authenticated Overleaf compatibility or diagnose every other reported Greylist host.

## Remaining limits

Strict redirect correlation proves a chain, not that a provider is necessary or safe. A destination can deliberately redirect to another nonblocked host; this is still the approved bounded exception. JavaScript/meta redirects and cross-domain links/forms without HTTP evidence use ordinary policy and may need Greylist confirmation. Current public probes reached the Gmail and KTH Canvas credential forms, and Ladok discovery. Microsoft committed its root document first, ending REACHED, then its later provider request became Greylist. Microsoft page-driven login and Ladok institution selection remain compatibility limits to investigate separately. Background resources remain outside intentional-navigation gating; there is no managed infrastructure allow database.

## Changed files

### Core models and transitions

- `packages/core/src/access-models.ts`
- `packages/core/src/access-state.ts`
- `packages/core/src/access.ts`
- `packages/core/src/atlas-models.ts`
- `packages/core/src/atlas-planner.ts`
- `packages/core/src/index.ts`
- `packages/core/src/journey-models.ts`
- `packages/core/src/journey-state.ts`
- `packages/core/src/journey.ts`

### Firefox adapter and presentation

- `extension/src/adapter/firefox-adapter.ts`
- `extension/src/presets/curated-whitelist.ts`
- `extension/src/ui/assets/index.html`
- `extension/src/ui/main.ts`
- `extension/src/ui/presentation.ts`

### Tests and browser probes

- `extension/scripts/firefox-e2e.py`
- `extension/scripts/firefox-public-sites.py`
- `extension/tests/adapter.test.mjs`
- `extension/tests/presentation.test.mjs`
- `extension/tests/prototype.test.mjs`
- `extension/tests/stabilization.test.mjs`
- `extension/tests/support/fake-firefox.mjs`
- `packages/core/tests/atlas.test.mjs`
- `packages/core/tests/controller.test.mjs`
- `packages/core/tests/journey.test.mjs`
- `packages/core/tests/stabilization.test.mjs`

### Documentation

- `README.md`
- `docs/acceptance-tests.md`
- `docs/architecture.md`
- `docs/firefox-adapter.md`
- `docs/firefox-real-sites.md`
- `docs/firefox-stabilization.md`
- `docs/first-steps.md`
- `docs/foundation.md`
- `extension/README.md`

