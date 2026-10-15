# Destination and Firefox polishing (D30)

Authorized on 2026-10-04. Core retains exact-host policy, existing grants, Journey transitions and Vault semantics. This pass changes Firefox effects and presentation.

## Model and ownership

Evolve the existing curated service and `DestinationEntry` display index. Labels, categories, pins and local usage remain presentation preferences. Active hostnames always come from the verified Core snapshot; metadata cannot add permissions. Preserve existing pin identities and authority schema 2. New versioned destination metadata is separate from authority, using the extension's existing local preference mechanism. Pending metadata is tied to a frozen Vault proposal and applied only after its matching committed policy is observed. Lost or malformed metadata falls back to hostname labels, retaining all policy entries.

Sites & Access shows committed destinations and exact host terms, with search and explicit add/edit/removal proposals. Settings contains behavior/timing, including existing protected Journey lifetime. No new settings store or Core schema is required. Permission changes use the existing proposal/review/confirmation commands. Core rejects unchanged-policy proposals; edits limited to name/category/pin use an explicit **Save display details** action, with no authority command. Wildcard scope remains unsupported; additional hosts must be named explicitly.

Existing edits default to **Keep current exact rules**, preserving mixed classifications and Blacklist/Whitelist overlap during display-only changes. A hostname already owned by an active destination must be edited there, preventing duplicate services and lost pin identity. Explicit replacement retires overlapping inactive metadata without changing any other policy term. Selecting a Sites row focuses its read-only details; narrow layouts scroll that panel into view.

For new/edit proposals only, use `tldts`'s Public Suffix List (including private suffixes) to suggest an optional exact apex/`www` pair. This dependency belongs only to the extension. Never infer parent permissions from arbitrary subdomains or broaden saved policy during migration. [Library documentation](https://github.com/remusao/tldts), [public suffix background](https://publicsuffix.org/learn/).

## Home and ranking

Compact launchers show icon and name; exact addresses remain in tooltips and entry-point controls. D31 supersedes the initial four-card limit with one responsive row, up to five destinations, and retains Show all. Pins retain their explicit order. Usage is local, deterministic and attached to service identity, with a seven-day half-life. Record explicit Atlas launches and browser-attested typed/bookmark arrivals, never redirects, resources, denied navigation or intermediate hops. No website-supplied URL or account data is stored in usage.

The sidebar is a permanent 60px icon rail with accessible names and status tooltip. D31 removes expansion and ignores the old presentation-only sidebar preference. Main content receives the freed width.

Ranking does not infer user intent from ordinary page links. Browser visits without an attested destination arrival are omitted; Atlas launches are counted at their saved Whitelist gate, even when authentication later redirects. Scores, counts and timestamps carry no authorization.

## Journey timeout effect

After Core successfully ends a Journey as EXPIRED, return only its owning tab to the recorded root origin's homepage (scheme, hostname and port). Preserve no login query, fragment, POST, or credential-bearing path. Check current Core authorization before the effect; a removed/blocked root or unavailable authority uses ordinary denied behavior. The old Journey ID remains ended.

The adapter marks the automatic return and suppresses Journey creation for that request, correlated redirects and page-originated departures. HTTP redirects, reloads and immediate page actions cannot renew the timer. Explicit Atlas launch/restart may begin a new attempt. A later committed Whitelist document with Firefox's typed/bookmark transition clears the guard for a subsequent normal loaded-root departure; the marked synthetic request cannot clear it even if its arrival reports `typed`. Missing request-origin metadata proves no user intent. After timeout, a root that redirects before document arrival needs explicit Atlas Restart. Generation/context checks retire superseded effects and tab closure removes the marker. The marker only vetoes Journey creation; Core still evaluates every destination.

## Validation results

Extension **0.1.11** passes **191 Core tests and 203 extension tests**, both builds and both TypeScript checks. Core source, public API and authorization semantics are unchanged. Thirteen new extension tests cover timeout effects and destination models; existing expiry expectations now assert the guarded return rather than leaving an intermediate displayed.

`journey-timeout.test.mjs` uses fake time and isolated authority to cover saved expiry, recorded scheme/port, owning-tab isolation, HTTP renewal denial, synthetic arrivals, unattributed reloads, browser-attested fresh arrival, current-policy denial, failed/conflicting/unknown saves, closed or superseded contexts, launch accounting and stale draft revisions. `destination-polish.test.mjs` covers PSL scope, exact policy candidates, unchanged-policy edits, frozen metadata reconciliation, cancellation/staleness, malformed or overlapping metadata, alias/pin identity, deterministic decay and denied/intermediate launch exclusion.

Native **Firefox 157.0** passes the new destination-polish scenario and the baseline, productization, Journey-polish and coherence regressions in isolated profiles. The new scenario exercises actual Vault controls, no early settings activation, explicit apex/www terms, duplicate destination protection, display-only saves, Blacklist/removal commits, HTTP/JavaScript/meta-refresh timeout loops, explicit restart, actual address-bar arrival, real IndexedDB restart, failed presentation writes, 54px launchers, the 60px rail and 500px Home/Sites views. Selecting a narrow-screen Sites row brings its named details into focus. [Sanitized results](evidence/firefox-destination-polish-d30.json) contain checks and measurements, without profiles or authentication URLs.

Commands run from the repository root (Windows uses `npm.cmd`):

```sh
npm.cmd --prefix packages/core run build
npm.cmd --prefix packages/core run typecheck
npm.cmd --prefix packages/core test
npm.cmd --prefix extension run build
npm.cmd --prefix extension run typecheck
npm.cmd --prefix extension test
python extension/scripts/firefox-e2e.py
python extension/scripts/firefox-e2e.py --productization-only
python extension/scripts/firefox-e2e.py --journey-polish-only
python extension/scripts/firefox-e2e.py --coherence-only
python extension/scripts/firefox-e2e.py --destination-polish-only
node extension/scripts/verify-bundle.mjs extension/dist
```

Current previews: [compact Home and icon rail](evidence/atlas-home-collapsed-d30.png), [committed Sites details](evidence/atlas-sites-d30.png). The shipped distribution verifies successfully and matches version 0.1.11.

## Compatibility and limits

Existing authority schema 2, exact policy, timing and pins are retained; the schema-1 migration regression also passes. Destination metadata and usage add separate version-1 presentation preferences, not an authority migration. Reload never adds www permissions. If a presentation write fails, committed policy remains authoritative and hostnames remain visible through fallback labels; a metadata edit does not claim success. Metadata and authority are intentionally not one storage transaction, so a permission commit can succeed while its display details need saving again.

The timeout return uses the recorded origin homepage, not a replayed private path or authentication request. The runtime marker is bound to the current tab/context; restart already invalidates old Journey bindings. A root that redirects before a fresh attested document arrives after timeout requires explicit **Restart journey**. Ordinary page links are not inferred as usage launches. Wildcards are unsupported. These native tests use synthetic sites and no accounts; they do not prove a complete real-provider sign-in or physical power-loss durability.

## Milestone B: destination batch drafts

Authorized on 2026-10-11. The extension prepares a complete candidate using the
existing Core planner and submits one `PROPOSE_POLICY`, with the current base
policy revision, through the existing private adapter. Core, authority schema,
Vault timing/confirmation, managed precedence and navigation rules are unchanged.

`destination-draft.ts` describes a desired result per destination ID relative to
its committed baseline, rather than replaying clicks. Add/edit updates that result;
removing an uncommitted addition cancels it. Explicit scopes use Core normalization
and the existing PSL counterpart suggestion. Conflicting hostname ownership blocks
the entire candidate. Existing mixed rules use `PRESERVE`; Blacklist precedence is
shown through Core's evaluator. A removal affects only explicit/manual rules.

The version-1 `atlas-destination-drafts-v1` IndexedDB database is presentation-only.
Its `workspace/current` document contains a monotonically versioned envelope,
editable draft, and a separate frozen submission/display receipt. Draft baselines
record policy revision and complete policy, committed metadata, pins and display
entries. Raw editor fields are also saved, including incomplete text. Validation
and dirty/stale/conflict status are derived, never authorization flags. Read/check/
write takes place in one IndexedDB transaction: a stale writer cannot overwrite
another Atlas window. Local failed edits remain in memory and require explicit
retry; an unreadable store cannot be initialized over its existing document.
If the saved draft document is structurally damaged, a separately confirmed
**Discard damaged local draft data** action deletes only that incompatible local
document. Its transaction refuses to delete a newer valid replacement. This may
lose frozen cosmetic terms, which the prompt discloses; it preserves active policy,
pending Core proposals, committed metadata and pins. Ordinary unavailable storage
must be retried rather than discarded. Delayed shared refreshes ignore observations
that began before this window saved or discarded newer work.

Sites shows all staged changes before **Review draft → Submit complete batch to
Vault**. Fields may be prepared while an unrelated proposal is pending, but cannot
replace it. Stale policy, metadata or pins require a reconciliation preview and
explicit acceptance against current data. A changed affected destination is shown
with current and proposed values; unresolved hostname/scope conflicts still block
acceptance. Restoration, elapsed time and acceptance never submit automatically.

Submission saves frozen intent before sending the policy command. An uncertain
response keeps that intent locked; **Check saved submission outcome** uses existing
Core Recovery and correlates ID, revision and full candidate without repeating
Propose or Confirm. A saved proposal starts the ordinary current-term wait. Its
destination-oriented Vault review includes names, scopes, classification, category
and pins; raw Core review remains available. Only a verified matching committed
policy can activate its accompanying display details. Cancellation/expiry creates
no permission; revised contents require a new full Vault cycle.

The receipt phases are `PREPARED` (durable submission intent), `PROPOSED` (saved
proposal or display-only submission), `APPLYING` (display writes claimed), `DONE`
(all display writes acknowledged), `KEPT` (remaining cosmetics explicitly discarded)
and `RESOLVED` (proposal no longer applicable). A retained `APPLYING` receipt never
retries automatically on restart. If a later unrelated policy commit has superseded
the matching Core commit marker, old display details cannot apply automatically;
keep current details or prepare a new reviewed draft. Receipts do not alter Core's
single-pending-proposal invariant or become a policy history service.

An unknown submission with an advanced proposal counter may have no correlatable
history. After explicit Core Recovery verifies ready authority and no pending
proposal, the user can **Discard uncorrelated local batch** with a separate prompt.
Only its local draft/display terms are retired as `KEPT`; current policy and saved
presentation remain. A pending proposal discovered during Recovery blocks this
discard. The action never proposes, confirms, cancels or reconstructs policy.

Presentation-only batches and **Save display details** use the same acknowledged
display pipeline without Vault. A frozen receipt claims the display application,
saves metadata, then pins, then records completion. Interrupted/failed stages
retain the receipt across reload/restart and expose explicit display-only retry.
Current affected metadata must match its baseline or the already-applied target;
other edits cannot be silently overwritten. Keep-current-display recovery discards
remaining cosmetic terms without rolling back or resubmitting committed policy.
Legacy `atlas-destinations-v1` single-proposal receipts remain supported, as do
`atlas-home-pins-v1` pins. Active metadata is published only after write acknowledgment.

Category suggestions come from curated categories, committed custom metadata and
the current draft. Identity trims/collapses whitespace and compares case without
distinguishing `Books`, `books` and ` BOOKS `. The predefined spelling wins, then
the first existing custom spelling. Home projects equivalent legacy labels into
one group, but never rewrites or drops their stored records automatically. Explicit
edits reuse the preferred spelling. Unused categories have no separate registry.
Milestone C now implements [Home ordering, visibility and collapse](home-organization.md)
without changing this category identity or the batch workspace. General visual
redesign remains Milestone D. Unused metadata/layout identities are retained;
there is still no separate empty-category creation registry.

### Milestone B verification

**191 Core and 287 extension tests pass**, including 42 new batch regressions and
the 19 retained Milestone A UI tests. Both TypeScript checks, the development build,
shipped bundle verification and offline verification of the unchanged signed
0.1.13 XPI pass. No dependency, Core source, authority schema, extension ID or
version change was needed.

`destination-batch.test.mjs` covers desired-state operation sequences, exact scopes,
ownership conflicts, forged/invalid drafts, raw editor restore, serialized/CAS
saves, delayed refresh versus edit/discard, stale policy/metadata/pins, explicit
reconciliation, one mixed Vault commit, early/expired/replayed confirmation,
unknown and uncorrelated submission recovery, a pending-proposal race during local
discard, post-commit display/pin/receipt failures, legacy
receipts, managed-denial precedence and compatible category grouping. The existing
Milestone A handler tests still cover cancelled proposals and display retries.

Native Firefox **157.0.1** verifies nine batch check groups in an isolated profile:
seven mixed changes in one proposal; UI close/reopen and three full Firefox
restarts; complete frozen review and unchanged waiting semantics; whole-policy
commit and replay rejection; interrupted display recovery without resubmission;
explicit stale reconciliation; two-page conflict handling; failed draft writes
and local retry; retained metadata, pins and the next unsubmitted draft; explicit
discard of uncorrelated intent after verified Core recovery with no repeat command. The
Milestone A reliability suite (six groups) and destination-polish suite (five
groups, including narrow layouts and Journey renewal vetoes) also pass with the
batch editor. [Sanitized evidence](evidence/firefox-destination-batch-milestone-b.json)
records these separately. [Sites draft](evidence/atlas-draft-milestone-b.png) and
[frozen review](evidence/atlas-vault-review-milestone-b.png) use synthetic destinations.

Commands run from the repository root:

```sh
npm.cmd --prefix packages/core test
npm.cmd --prefix packages/core run typecheck
npm.cmd --prefix extension test
npm.cmd --prefix extension run typecheck
node extension/scripts/verify-bundle.mjs extension/dist
python extension/scripts/firefox-e2e.py --destination-batch-only
python extension/scripts/firefox-e2e.py --ui-reliability-only
python extension/scripts/firefox-e2e.py --destination-polish-only
npm.cmd --prefix extension run release:verify-signed -- 0.1.13
```

The actual npm test commands rebuild their respective packages. No signing,
submission, installed-profile change or enterprise policy edit occurred. These
tests establish local behavior with synthetic sites and injected failures;
physical disk failure, external device synchronization, full assistive-technology
coverage and authenticated remote-site completion remain outside their evidence.
