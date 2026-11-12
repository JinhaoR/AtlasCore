# Engineering, performance and interaction review

2026-10-30. Compared the existing **development 0.1.19 checkout** with this pass;
earlier 0.1.19 editor/scope/removal fixes are part of the baseline, not new wins.
The task does not package or install a release. Numeric evidence and native
checks are in [the evidence record](evidence/engineering-review-0.1.19.json).

## Assessment and priorities

The Core/Firefox boundary is appropriate. Core's independently testable, explicit
transitions and the controller's persistence boundary are valuable, not redundant
abstractions. Firefox correlation, presentation and concrete storage remain outside
Core. The principal complexity is concentrated in orchestration and repeated work,
not in dependencies or an excessive number of packages.

| Area inspected | Finding / disposition |
| --- | --- |
| Core policy, Access, Vault, Journey, Download, planner, controller | Public functions validate/copy their inputs; the aggregate calls these functions and the controller validates loaded/saved envelopes again. These protect different boundaries but cause repeated full-state scans. A future private prepared-context API might reduce copying; replacing validation or caching decisions during this pass would be disproportionate risk. No Core runtime change. |
| Firefox event coordination | `firefox-adapter.ts` is 1,383 lines with request correlation, response gating, removal effects, recovery and privileged commands. The serial adapter queue and separate controller queue protect different invariants: browser generations/effects versus atomic authority. Do not merge them merely to remove a queue. Download response correlation is a plausible future extraction behind the same queue, with its existing negative tests. |
| UI orchestration | `main.ts` is 972 lines and `sites.ts` 657; both contain dense multi-statement lines. Main updates all surfaces on accepted polls. Sites combines editor input, list rendering, submission and receipt recovery. This is the highest navigation/maintenance cost, although useful helpers already own category, layout, refresh, draft, storage and feedback concerns. Extract one independently tested presentation surface when next changing it, not an application-wide framework. |
| Draft persistence | Typing → `setEditor` → newest queued input → validated CAS save → acknowledged state → coalesced render. Stage/close/receipt writes are barriers. Completed receipts remain for recovery/history. Validation on storage boundaries, stale checks and explicit retry remain necessary. Do not delete terminal receipts or legacy display metadata merely to speed decoding. |
| Access summaries | Reproduced avoidable full planner calls for **every expired grant/request**, on each view request, plus two identical complete-state observations. This makes read-only display work grow much faster than its output. Fixed below. |
| Long-lived state | Access/Journey records and repository receipts accumulate; per-tab retained checks repeatedly load/validate/observe them. Navigation diagnostics are bounded to 200, context maps are removed on tab close, pending download targets are expired, and UI timers/listeners have cleanup. Unbounded authoritative history is a real scaling concern, but no new safe compaction contract was established. No pruning, clock relaxation or reduced enforcement cadence. |
| Presentation persistence | Home layout and drafts have distinct revision-checked repositories because their concurrent edits and recovery differ from authorization. Pins/usage/metadata are separate presentation state. Replacing all of them with a new store would increase scope; retain acknowledged-only publication. |
| Icons and lifecycle | Icons are fetched lazily with bounded individual responses, reused per page and revoked on page close; observed-host/icon maps can grow during a long-lived control page. Native reopen measurements do not establish a retained leak. An eviction policy is a future measurement target, not a new cache layer here. |
| Defaults and compatibility | Frozen v2 expansion receipts, corrected v3 defaults and retired Wikipedia display identity serve real installed data/draft compatibility. They are not dead code. No migration, catalog, settings or saved permission changes. |
| Build/test/release | Two small packages, Node's test runner, TypeScript/esbuild, isolated Firefox scenarios. Native runner setup/flag accumulation and old documentation require more navigation than compilation. Release hashing/source reproduction protects a separate shipping boundary and remains unchanged. |

For a future label or layout change, start in the relevant UI module and its
interaction tests. A new permission operation necessarily touches the Core model,
planner, controller command classification, privileged bridge and submitting UI;
that cross-layer work is justified. A display-only change should not require
understanding every authorization workflow. The new [task map and verification
tiers](development.md) make this distinction explicit.

## Implemented changes and measurements

### 1. Summarize live access without re-evaluating dead history

`adapter/temporary-access.ts` now exposes one `accessOverview`. It runs a full
Core `OBSERVE_TIME` validation once for both summaries. Only after that validation
does it omit expired or revision-stale entries from consideration. Every remaining
displayed hostname still requires the original `CHECK_NAVIGATION` assessment;
manual/managed denial, overlapping scope, Whitelist and pending readiness remain
Core decisions. Nothing is removed from storage, no ALLOW is cached, and the view
cannot authorize browser effects. Invalid historical data still invalidates the
entire summary. `firefox-adapter.ts` samples one time for both lists.

| Synthetic expired grants | Native Firefox median before | After |
| ---: | ---: | ---: |
| 0 | 2 ms | 1 ms |
| 25 | 41 ms | 1 ms |
| 100 | 187 ms | 1 ms |
| 300 | 777 ms | 2 ms |

The 300-record baseline p95 was 805 ms (seven timed samples, so p95 is the
maximum). A separate Node workload with one live waiting request measured
**562.4 → 3.4 ms median** at 300 expired grants. These are deterministic synthetic
history inputs, not measurements of the user's saved history. They establish a
scaling defect, not the cause of the unexplained daily-use INTERNAL_ERROR.

### 2. Stop constructing a draft baseline when there is no draft

`sites.ts` previously called `draftBaseline` unconditionally on every render,
including Home/Settings and an empty workspace, then discarded the result.
The baseline reconstructed all committed destinations and pins. It is now built
only when a draft needs assessment. No new cache or invalidation scheme is needed.
The 20-cycle Home/Sites/Settings fixture plus ten seconds idle went from **77
unused baseline constructions to zero**. Navigation median remained about 16 ms;
this is a measured work reduction, not a claim that every click is faster.

With a real 60-item staged draft, the existing behavior remains: median staged
additions were about 125–140 ms before and after, and 12 rapid-edit/stage actions
took 1.83 versus 1.75 seconds. This pass does **not** claim a draft-typing speedup
already delivered by the earlier [editor fixes](editor-reliability-0.1.19.md).

### 3. Keep unavailable Home copy truthful

Home no longer shows “Your category sections are hidden” while authoritative data
or acknowledged layout is unavailable. A retained committed collection during
ordinary LOADING/COMMITTING still keeps stable presentation; failed/uncertain
authority does not masquerade as a user customization. Native failure injection
reproduces the old contradictory message for a saved hidden-category layout and
verifies the corrected unavailable state and explicit read retry.

### 4. Make focused changes cheaper to verify and understand

Added `test:built` to each package without changing the original self-building
`test` or any release check. Replaced the long chronological AGENTS packet with
current invariants, a contract map, release boundaries and a scoped working method.
Historical evidence remains in its owning documents. Added `docs/development.md`
with task entry points, fast/subsystem/release checks and test-artifact cleanup.

Measured Windows command wall times (Node 24.12.0, TypeScript 6.0.3):

| Command | Seconds |
| --- | ---: |
| Extension build, including Core build/type compilation/bundle verification | 2.54 |
| Core typecheck | 1.00 |
| Extension typecheck, including Core build | 2.42 |
| Core `npm test`, including build | 1.75 |
| Extension `npm test`, including build | 5.17 |

The focused 49-test process took 0.30 seconds after building. The final full
extension test process itself took about 2.31 seconds. Rebuilding inside every
subcommand wastes seconds, but cannot explain long investigation sessions. Native
fixtures incur process startup, real cooldowns and timed observations; the
performance fixture includes a 30-second idle window and four five-second
quiescence samples. Reading historical overlapping guidance, tracing coupled
callbacks and debugging fixture assumptions are separate costs. Agent reasoning
and editing time were not independently instrumented; do not label them compiler
overhead or invent a percentage reduction in development time.

## Runtime and UX findings that remain

- The matched 30-second large-draft idle windows created **zero DOM elements**
  both before and after. One page refresh chain remained; six close/reopen cycles
  retained one timer, nine global listeners and one tab-icon listener per page.
  No runaway subscription or text-flicker loop was reproduced in this workload.
  Existing native race tests cover unchanged notifications, stale replies,
  focus/caret retention, failures and toolbar reuse.
- Each idle window still had about 30 authority writes and 60 reads, plus one
  draft/layout read per visible-page poll. This is expected from current persisted
  time observation, not proof of duplicate timers. Aggregate Firefox CPU was
  roughly 5.8% of one logical core in both synthetic windows. This pass does
  not reduce those writes or claim a CPU improvement for ordinary empty history.
- Rapid reopen private-byte peaks were roughly 1.46–1.56 GiB for the disposable
  process trees and fell to roughly 0.68–0.75 GiB after test-only memory minimization. Allocated
  process memory is not retained JS heap. These short runs neither reproduce nor
  exclude a week-long leak; foreground/background lifetime and growing history
  need longer sampled profiles before a retention redesign.
- Draft persistence feedback can legitimately alternate between unsaved/saved
  while typing. Do not conceal a failed write to make the UI look calm. Stable
  status space and less repetitive success announcements are future UX candidates
  only if traces identify them as distracting.
- Sites still presents draft, selected committed item and editor together, and
  raw policy/diagnostic disclosures add density. Keep the current deliberate
  Review/Submit/Confirm distinction; further grouping can be a targeted UX task.
  No typography/palette replacement or visual redesign was performed.
- Authorization requires complete snapshots at every external boundary. A future
  effort should first benchmark **retained checks versus history and tab count**,
  then design either proven internal validation reuse or a versioned compaction
  contract. No permission cache, batch authorization shortcut or automatic
  internal-fault recovery is introduced here.

## Verification and limits

**239 Core and 507 extension tests pass**, as do both type checks and the development
build. The original self-building test commands and final `test:built` commands
both pass. Isolated native checks are recorded in the evidence. New focused cases compare history-heavy
summaries with individual Core decisions and reject malformed expired records,
stale revisions, rollback and invalid managed authority. Existing grant, proposal,
scope, removal, storage/conflict/unknown-outcome and browser-gate suites remain.

Native Windows Firefox 159.0 uses synthetic local pages, test-copy instrumentation
and disposable profiles. The pass checks populated drafts, modification/removal,
reload/reopen, UI races, failure recovery, Greylist and passive Journey behavior.
[Ready Home](evidence/engineering-review-0.1.19-home.png) and
[unavailable Home](evidence/engineering-review-0.1.19-unavailable.png) screenshots
supplement state/mutation traces; they cannot prove flicker absence.
No sampled Firefox profiler trace, retained-heap snapshot, real-account login,
macOS run or multi-day endurance test was collected. CPU/memory samples and
inclusive function wall times must not be described as those missing tests.

Core runtime sources, authorization semantics, identity, installed policies,
normal profiles and signed releases are unchanged. Existing draft/Vault behavior,
immediate reviewed Whitelist subtraction and opt-in scopes remain intact.
No new dependency, schema, permission, release package, submission or deployment.
All **114 frozen release files** match their pre-task SHA-256 hashes. The original
source maps also confirm that all 15 bundled Core runtime modules are unchanged;
the only production source changes in this pass are `temporary-access.ts`, its
adapter call site, `sites.ts` and `main.ts`. Package scripts, focused tests, native
measurement helpers, documentation and regenerated development output accompany
those changes. Earlier uncommitted development work was preserved.
After retaining sanitized evidence, this task's ten disposable Firefox profiles
and four instrumented runtime copies were removed (1,181.86 MiB). No other
`.tools` work or normal profile was removed.
