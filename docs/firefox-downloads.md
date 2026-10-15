# Download Intent — development toward Firefox 0.1.15

## Contract recorded before implementation (2026-10-12)

The current gate holds top-level HTTP requests before response headers exist.
A new tab has its own context and cannot borrow the opener's Journey. An attachment
also has no ordinary document arrival. These are distinct from an Access Grant
scope defect: adding CDN hosts to a grant or widening Journey inheritance would
authorize browsing that the user did not approve.

The user authorizes one bounded download operation from a currently authorized
loaded page. Core gains a separate ephemeral Download Intent operation through
the existing planner/controller. It validates complete authority, source access,
destination denial, current revision, fixed 30-second deadline and five redirects.
This is a conservative initial engineering limit, not an editable timing setting.
No snapshot schema change, policy entry, grant or cross-context Journey is created.
The controller persists its normal observation checkpoint before publication.
Failed/conflicted/unknown persistence cannot release an exceptional request.

The adapter retains intent state only for one native request chain. Core receives
opaque operation/source/target context IDs, normalized hostnames, explicit time,
portable stages and the previously returned immutable intent. Browser request IDs,
exact transient correlation URLs and native event ordering stay in Firefox.
The adapter must consume stage transitions once; a pure input value is never a
bearer token that websites or another context can submit. Restart drops every
binding. There is no intent restoration or automatic renewal.

Stages: PREPARE validates source/destination and fixes terms but permits no send;
REQUEST requires browser-attested user activation before sending; REDIRECT accepts
one correlated subsequent request and consumes a redirect; CHECK revalidates a
pending response without extending terms; ATTACHMENT consumes the intent for file
delivery. Terminal failure, context/source document loss, policy change, expiry,
unrelated replacement and completion revoke the binding. Completed transfers are
browser-owned; the deadline governs authorization of the response, not transfer
duration after headers have been accepted.

## Firefox evidence and boundary

Initial isolated Firefox probe: real clicked links, target=_blank, clicked
window.open, HTTP redirect, delayed attachment, claimed download link, ordinary
HTML and Blob creation. New-tab target events include source tab/frame and URL;
opener metadata alone supplies neither request identity nor user intention.
Only top-level GET chains are eligible initially. Cross-tab start requires an
unused onCreatedNavigationTarget event, matching exact target, source frame zero,
and the still-loaded source document. Same-tab start requires exact origin
correlation to its loaded authorized source. Neither inherits browsing permission.

The request must carry Firefox's Sec-Fetch-User: ?1 at onBeforeSendHeaders. Missing
or ambiguous evidence fails closed for the exception. JavaScript initiated during
real activation can qualify; arbitrary delayed script initiation cannot be assumed
to qualify. The header is restricted to potentially trustworthy URLs, so ordinary
remote plain HTTP entry is not promised. No content-script command channel is added.

At blocking onHeadersReceived, a successful response with one unambiguous
Content-Disposition attachment header qualifies as a file. MIME types, filename
extensions and download attributes never authorize. HTTP redirect responses have
no display permission. Everything else requires a fresh ordinary Core navigation
decision before display; unfamiliar HTML/JavaScript interstitials cannot execute
to discover their later file. Existing independently authorized HTML/Journey flows
keep their existing rules. No response body, cookie or authentication header is read.

The response's single `Location` must resolve to a supported HTTP(S) target without
userinfo, and the subsequent native redirect event and held request must match it.
Non-HTTP redirects, missing/ambiguous targets, duplicate responses, replayed redirect
evidence and network errors consume the exception. Every redirect, including one
on the same hostname, uses the original budget.

Firefox downloads events report an already-created download and supply no shared
webRequest ID; they are evidence only, not authorization. The shipped extension
does not need the downloads permission. Blob, fetch-to-Blob, browser Save As,
POST downloads, resumes/range requests, embedded downloads and requests without reliable top-level
lineage are not covered by this new exception. Existing resource behavior remains
outside the navigation gate. A downloaded HTML attachment is a file, not permission
to browse its remote origin; opening local files remains a separate browser boundary.

A new-tab file operation can start from a currently authorized Journey intermediate
without sharing its Journey. A later unfamiliar same-tab GET from that intermediate
retains the existing Journey rules: its ordinary navigation check can end the
Journey before download preparation. This case is unsupported by the new exception;
changing that ordering needs separate evidence and a focused design decision.

Receiving headers requires a network request to the unknown host. The exception
therefore permits bounded network contact before the file type is known, while
withholding unauthorized document display. It does not promise zero egress or that
a server's attachment is safe. Browser security and download handling remain Firefox's.

Sources: [created navigation target](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webNavigation/onCreatedNavigationTarget),
[blocking response headers](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onHeadersReceived),
[user activation metadata](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-User),
[download creation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/onCreated).

## Validation

### Native signal investigation

Isolated desktop Firefox **157.0.1** on Windows, synthetic `.localhost` sites:

| Signal | When observed | What it proves |
| --- | --- | --- |
| `tabs.onCreated` opener | Before the target request in the fixture | A tab relationship; no activation, request identity or file type. Never sufficient. |
| `webNavigation.onCreatedNavigationTarget` | Before the held target request in the clicked-link and `window.open` fixtures | Source tab/frame and exact target, including delayed script navigation without activation. Must be combined with the loaded source and later activation evidence. |
| `webRequest.onBeforeRequest` | Before request authorization | Top-level GET, tab, native request ID and source origin; no response type yet. |
| `webRequest.onBeforeSendHeaders` | Before sending the eligible request | Browser `Sec-Fetch-User: ?1` for genuine activation. The six-second script case lacked it. |
| `onHeadersReceived` and `onBeforeRedirect` | Before following the next request | Response status/target, then the observed native redirect; the request ID remained stable in the fixture chain. |
| Blocking `onHeadersReceived` | Before document commit or file handoff | Attachment disposition; cancellation withheld unfamiliar HTML, its script beacon and subsequent file. |
| `downloads.onCreated` | After accepted attachment headers; Blob has no HTTP request | A download already exists. No shared native webRequest ID or tab identity; unsuitable for pre-request authorization. |

The observer-only run demonstrates that a claimed download attribute, HTML
interstitial and delayed unactivated script can all produce files in plain Firefox.
Those facts are not sufficient to authorize their unfamiliar HTML in Atlas. The
production package does not include the observer or its downloads permission.
The fixture now verifies complete observer registration; an earlier observer's
unsupported error-event argument was corrected before recording these signal claims.

### Regression results

**204 Core and 308 extension tests pass**, with both TypeScript checks and the
development build. [Core download tests](../packages/core/tests/download.test.mjs)
add 13 cases; [adapter download tests](../extension/tests/download.test.mjs) add 21.
They cover immutable state, fixed time and grant caps, deny precedence, invalid
snapshots, consumed stages, redirect budgets, missing/foreign/stolen evidence,
policy/source changes, restart, concurrent supersession, failed/conflicted/unknown
checkpoints, unsafe redirect schemes, network failure, and sanitized diagnostics.
Existing Greylist, Vault, Journey and Milestone A/B suites remain passing.

Native probe and regression harness: `python extension/scripts/firefox-downloads.py`.
`--probe` records plain Firefox behavior; `--baseline` copies preserved 0.1.14 staging
to a disposable test folder. It never changes release files. Only fixtures get
the observer's downloads permission. Successful cases check exactly one completed
native download and the new file's synthetic bytes, not just a temporary `.part`.

| Fixture | Preserved 0.1.14 | Development 0.1.15 |
| --- | --- | --- |
| Same-tab direct attachment | Completes under existing navigation authorization | Completes |
| New-tab HTTP redirect to file | Blocked before server contact | Completes one correlated operation |
| New-tab file delayed two seconds | Blocked before server contact | Completes within original deadline |
| Activated JavaScript `window.open` to file | Blocked before server contact | Completes with native activation/lineage |
| New-tab HTML, claimed download link, JS interstitial | Blocked | Response cancelled before external commit or execution |
| New-tab HTML attachment | Blocked | Saved as a file; no remote script execution |
| New-tab MIME-only file response | Blocked | Remains blocked without attachment evidence |
| Blob generated by loaded page | Completes outside HTTP gate | Still completes; no new authorization mechanism |
| Explicit Blacklist file | No server contact | No server contact |
| Redirect loop | Initial request blocked | Six requests maximum: initial plus five redirects; no file |
| Script opening a tab after activation expires | Blocked | Missing activation stops request before server contact |

Four further native cases withhold pending files after the 30-second deadline,
a successful explicit Vault policy revision, source closure, or background restart.
These are synthetic fixtures, not a claim about every authenticated download provider.

Native baseline Greylist/confirmation/restart, Journey polishing (including SAML-style
POSTs), Milestone A UI reliability and Milestone B persistent batch/restart scenarios
also pass. [Sanitized evidence](evidence/firefox-downloads-0.1.15.json) records versions,
commands, per-case outcomes and local artifact identifiers separately.

### Release integrity and remaining decisions

Signed **0.1.14** passes `release:verify-signed -- 0.1.14` against its preserved receipt,
unsigned/source archives and staging: 13 of 14 runtime files have exact hashes;
manifest JSON tokens match despite signing whitespace. The XPI's unchanged SHA-256
is `88b699c0b23542228cee490f3cc046abeebf326ef94e3fe4560bb21cf79f5ff1`.
No signing, publication or release-asset modification occurred.

Unknown HTML interstitial execution, unreliable lineage, MIME-only downloads and
the unsupported mechanisms listed above remain deferred. Supporting them would need
new native evidence and a narrow design decision. The user-authorized exception
necessarily permits limited network contact before file proof; it grants no ordinary
browsing, host trust, download safety guarantee or control over a transfer after
Firefox accepts the file. Deadline/hop tuning and additional platform compatibility
remain future product/testing decisions, not automatic renewal or wider scopes.
