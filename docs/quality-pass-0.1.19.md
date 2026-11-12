# Final 0.1.19 quality pass

This development pass follows the [runtime investigation](firefox-storage-reliability.md)
and [engineering review](engineering-review-0.1.19.md). It does not establish the
exception behind the user's intermittent INTERNAL_ERROR. It improves measured
work, evidence retention and everyday editing without changing authorization.

## Processing and retained history

A matched synthetic controller benchmark with 2,500 ended Journeys identified
whole-snapshot JSON serialization and repeated deep freezing as avoidable work.
The controller now compares its validated, owned data structurally, preserving
every field and array order. It freezes only newly created envelope/view wrappers
whose nested snapshots have already been copied, validated and deeply frozen.
External repository values still undergo complete validation on every load.
Commit validation, receipt resolution, policy checks, clock observations and
conservative failure handling are unchanged. No decision or permission is cached.

In the local Node benchmark, the median history-heavy operation fell from
37.31 to 30.33 ms. Repeated `getView()` traversal fell from 2,515 object walks to
zero; the returned snapshot remains deeply immutable. These are in-memory
controller timings, not native browser navigation or disk measurements.

Ended Journeys remain in the snapshot and therefore still increase copying,
validation and storage costs. Access records retain their existing expiry and
revision behavior. Commit receipts are separate IndexedDB records, addressed by
commit ID; ordinary commits/resolution do not scan their full history. They still
consume disk and indexing space. The endurance fixture adds 100,000 historical
receipts to exercise this distinction. No records are deleted or compacted.
A future retention policy needs an explicit replay/reconciliation contract;
this pass does not invent one to improve a benchmark. Persisted time observations
remain real commits and can continue producing substantial receipt growth.

The extended native run exposed an `ADAPTER_QUEUE` error during tab churn,
without a controller outage. A controlled replay reproduced a related concrete
race: Firefox rejects an outstanding arrival `tabs.get()` after the tab closes.
The adapter now retires that result only if its captured context/generation was
already invalidated. A failure for a still-live context remains diagnostic and
removes unverified content. Unit tests cover both sides; native Firefox verifies
a real closed-tab rejection. This is not evidence of the user's original Core
INTERNAL_ERROR trigger, and the initial endurance observation alone did not
identify the rejecting browser API.

## Diagnostics across background lifetimes

`runtime-diagnostics.ts` retains at most 20 deduplicated faults and five numeric
locations per fault. `runtime-journal.ts` saves the latest incident session in
the existing extension-local presentation storage under a separate versioned
key. It keeps the producing Atlas version for source-map interpretation. A new
background shows the prior incident separately from current-session faults.
Healthy startup/idle/Recovery does not erase it or write a replacement record.

Only closed error/subsystem/operation/stage names, counts, times and own-bundle
numeric locations persist. Exception messages, function names, URLs, navigation
history, credentials, policy snapshots and pending commit IDs do not. Reads
reconstruct a bounded schema; corrupt records are unavailable display evidence,
never restored authority. Writes coalesce while one save is pending; failure
retains in-memory evidence and explicitly reports unavailable retention. Nothing
in Core waits for this storage, changes permissions or retries confirmation.
The existing navigation log remains session-only. No new permission is required.

## UI ownership and interaction

- `destination-cards.ts` owns launcher DOM, site-icon requests, tab icon listener,
  observer and object-URL cleanup. Parent callbacks still use the ordinary
  navigation gate and saved pins; it owns no policy or independent collection.
- `diagnostics-panel.ts` owns diagnostic refresh coalescing, stale-response
  fencing, table rendering and export. It is disposed with the control page.
- `destination-editor.ts` owns form restoration, scope copy and locking. The
  existing persistent workspace is the sole draft owner; form DOM is not another
  saved model. `sites.ts` retains staging/reconciliation/submission responsibility.
- `main.ts` retains page navigation, the authoritative-view projection and the
  single visible-page refresh loop. Firefox adapter serialization and browser
  lineage remain together: splitting these interdependent safety invariants
  merely to reduce line counts would add coordination risk.

The previous Sites layout displayed a full staged batch, a committed-detail pane
and an editor at once. It also repeated routine local status in a global banner.
Now the active editor replaces committed detail while retaining selection;
staged changes expand through Review, and stale reconciliation appears only when
needed. Completed submission receipts are compact disclosures; unresolved ones
remain expanded. Routine edit/save progress stays near the draft; failures still
use the existing explicit error/retry treatment. Scope explanations expand when
relevant, without hiding the chosen scope or changing its meaning.

Review is freely reversible and never permission. Submission still requires the
reviewed durable batch, closed/staged editor and current authority. Intentional
Vault waits and explicit confirmation remain. Strict Whitelist removals retain
their already-approved reviewed immediate path. Home, pins, category layout,
search targets and temporary-access/Journey semantics are unchanged.

## Verification and limits

All **247 Core / 519 extension tests**, both TypeScript checks, development build
and `git diff --check` pass. Fourteen focused tests were added in this pass.
[Machine-readable evidence](evidence/quality-pass-0.1.19.json) includes native
results and the initial failed endurance observation, not only successful runs.

| Measurement | Before | After |
| --- | ---: | ---: |
| Controller CHECK_NAVIGATION, 2,500 ended Journeys, median | 37.31 ms | 30.33 ms |
| Native navigation, ordinary state, median of 15 | 125 ms | 125 ms |
| Native navigation, 2,500 ended Journeys, median of 15 | 531 ms | 407 ms |
| Editing page height at 1440px width | 1,815px | 1,303px |
| Active editor top in that page | 1,030px | 538px |

The final native comparison ran sequentially without competing test processes.
The initial native baseline was 469 ms for the same heavy fixture: shared-machine
timings vary, and the harness polls at 100 ms intervals. The earlier 578 ms report
used a different fixture/run and is not this comparison's baseline. The measured
23% native / 19% controller improvement is evidence for these workloads, not a
universal latency guarantee. Full validation/serialization still dominates heavy
history; there is no claim that it is now as cheap as empty state.

The corrected **600.9-second** endurance run retained 2,500 ended Journeys, 300
expired grants, 100 expired/stale requests and 100,000 separate commit receipts.
It completed 18 interleaved Greylist/Journey cycles and 26 control-page lifetimes,
then reloaded the background and rechecked Blacklist/Greylist. It recorded 1,511
additional acknowledged commits, no failed commits/runtime faults, drained
queues, no minidumps and unchanged saved policy/deadlines. Aggregate private
memory endpoints fell from 1,415 to 1,165 MiB (13 to 12 processes); those noisy
endpoints are **not** a retained-heap or leak analysis.

Native fault injection verifies PLAN/VERIFY_AUTHORITY failures, conservative
latching, explicit Recovery, separately classified unhandled rejections and
sanitized evidence retention across restart. The storage suite passes real
abort/unknown/quota/clock failure cases. Native batch tests pass real Vault waits,
frozen review, restart, partial display retry and stale reconciliation. Ordinary
navigation tests pass Journey/redirect/Greylist/confirmation/restart behavior;
17 download scenarios preserve file delivery and browsing-denial boundaries.
The fixtures now wait for enabled prepared controls, foreground the page whose
UI they inspect, and compare actual pre-restart categories instead of an obsolete
preset list. Firefox 159's system-access testing flag is isolated to the harness.

Native UI checks preserve caret/input identity and scroll, exercise actual
keyboard Tab/Enter, failed draft saving and explicit retry, consecutive edits,
section navigation, 1440/820px windows and actual 125%/200% Firefox zoom without
horizontal overflow. Reviewed screenshots: [before editing](evidence/quality-pass-0.1.19-before-sites.png),
[after editing](evidence/quality-pass-0.1.19-after-sites.png),
[small-window review](evidence/quality-pass-0.1.19-review-small.png),
[failed draft save](evidence/quality-pass-0.1.19-draft-save-failure.png).

Native tests use Firefox 159, synthetic loopback sites and disposable profiles.
They do not use the everyday profile, accounts or enterprise policies. Short
endurance evidence cannot establish multi-day stability or prove absence of a
memory leak. No retained-heap analysis, macOS run or live-account authentication
test is claimed. Signed release files and the extension ID remain unchanged;
there is no signing, submission, packaging or deployment in this task.
All **114 frozen release files** match their original SHA-256 hashes. Version
remains 0.1.19 development; ID remains `atlas-development@atlas.invalid`. Existing
dirty development work is preserved. No new package, permission or dependency.
After preserving sanitized results/screenshots, the 17 task-created Firefox
profiles and two temporary baseline copies were removed, reclaiming **1,643.33
MiB**. Other `.tools` content and all normal profiles were left untouched.
