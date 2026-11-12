# Destination editor reliability and completed-batch performance

Development 0.1.19 follows the user's report against signed 0.1.18: selecting
Inet would not populate its editor, Review draft was disabled, and the interface
felt slow after daily use. Signed release files are preserved. Tests use synthetic
data and disposable profiles, never the user's browser data.

## Reproduced causes

An existing raw Add editor blocked `begin()` for every other destination, even
when it was untouched and blank. It could survive reload in the durable workspace.
Review was also coupled to the absence of any editor, although previewing staged
terms requires no permission change. The screenshot's separate blank editor and
Wikipedia removal are enough to reproduce both interaction failures.

A retained completed batch exposed performance work the earlier 0.1.18 audit had
not measured. Sites rendered during other page refreshes too, and recomputed
`receiptOutcome()` for terminal DONE/KEPT/RESOLVED receipts whose controls did not
use that result. Each input event also queued a complete workspace save, including
the historical receipt. Reconstructing draft baselines repeatedly searched pins
for every destination. This made cost grow with completed batch and pin size.

The Node/fake-IndexedDB fixture with 359 exact hosts and a completed 60-item pinned
batch measured a 140-input FIFO drain of 6.58 seconds before the change; the
matching latest-input lane drained in 45 milliseconds afterwards. A repeated
Sites render fell from 23.47 to 8.59 milliseconds. These synthetic burst results
explain unnecessary work; they are not measurements of the user's installation
or proof of a week-long leak. Native Firefox measurements are recorded separately.

## Small changes and preserved boundaries

- Replace a pristine editor when the user chooses another destination. Compare
  complete raw terms with the editor's original baseline, not only whether its
  name is empty. Meaningful edits, changed options, conflicts and failures remain.
- Review previews staged terms even with an open editor. It explicitly excludes
  unstaged fields. Submit still requires a closed/staged editor, a current valid
  candidate and acknowledged storage. Review never starts or confirms Vault.
- Put Close editor beside its heading so it is reachable without finding the
  bottom of a long form. Re-selecting the same editor retains its exact fields.
- Compute baseline pin membership once. Skip unused terminal receipt assessment
  during rendering; retain full repository decoding and active receipt checks.
- Coalesce only queued raw-editor inputs: one in-flight write and one newest
  pending value. No debounce timer. Stage, close, receipt, retry and submission
  stay ordered barriers. Unsaved remains true until the latest terms are saved.
- Keep latest raw input on failed/conflicting/uncertain writes. A failed earlier
  stage cannot restore its editor over newer work. Page disposal drains pending
  writes through the existing lifecycle. Unknown outcomes are never auto-replayed.
- Retain a read-only curated-coverage summary keyed by complete policy contents.
  Native testing caught a new scope-display regression that re-evaluated every
  preset host on every Settings render. The summary refreshes when terms change;
  ordinary observations reuse it. Proposal preparation and browser authorization
  still perform their own fresh Core checks. Cache tests include in-place policy
  edits, scopes, manual denial and unavailable authority.

No Core authorization result is cached or inferred from these presentation
optimizations. This work does not prune Journey history or weaken complete
snapshot validation. The separate, explicitly approved optional permission
addition is documented in [whitelist-scopes.md](whitelist-scopes.md).

## Verification

`editor-navigation.test.mjs` covers pristine and restored Add-to-Edit, preview with
an open editor, meaningful raw/option retention, conflict/failure preservation and
deferred-stage failure ordering. `editor-persistence.test.mjs` covers burst and
in-flight coalescing, ordered barriers, frozen receipts, failed saves, uncertainty,
concurrent writers and stale editor IDs. Existing batch, draft, policy and
submission regressions remain active.

The native helper `firefox_editor_followup.py` stages 60 pinned changes through
the actual interface, waits and confirms once through Vault, retains the DONE
receipt, then exercises idle rendering, Home/Sites switches, a new control-page
load, the blank-Add/Inet case, Review with unfinished input and 140 raw events.
Its initial draft is fenced to the acknowledged fixture policy revision. The
same explicit Wikipedia fixture is prepared through Vault in both runtimes;
its presence in the test does not restore it to defaults.

Commands (after the normal development build):

```text
node extension/scripts/instrument-ui-performance.mjs <runtime> <disposable-copy>
python extension/scripts/firefox-e2e.py --editor-followup-only --addon-dir <copy>
```

Add `--editor-followup-baseline` only with the preserved signed-0.1.18 runtime
copy. Instrumentation adds numeric counters solely to a disposable copy and never
rewrites release assets. Native profiles and instrumented copies can be deleted
after sanitized evidence is retained. Process samples are not retained JS heaps.

The [development notes](release-0.1.19.md) and final evidence record passing counts,
native results and limits. The earlier recovered idle interruption remains
unattributed; this editor report does not claim to resolve that unknown trigger.

## Final results

**222 Core and 486 extension tests pass**, with both TypeScript checks, the
development build and the actual extension npm test command. Native Firefox
**159.0** reproduces both old interaction failures against preserved 0.1.18 and
passes the corrected workflow. The final input is durable, the completed receipt
retains all 60 items, and preview/edit operations leave policy and Vault counters
unchanged. Scope/Vault, twelve storage failure/recovery checks and two separate
upgrade paths also pass. [Sanitized evidence](evidence/editor-reliability-0.1.19.json)
contains numeric counters and boundaries.

| Synthetic native observation | Signed 0.1.18 copy | Final 0.1.19 copy |
| --- | ---: | ---: |
| Stage 60 pinned changes | 15.797 s | 12.359 s |
| 12 Home/Sites switches | 406 ms | 172 ms |
| New control-page Home readiness | 453 ms | 422 ms |
| Sites readiness in that page | 172 ms | 47 ms |
| 140 raw input events, 12 bursts, final value saved | 14.000 s | 0.953 s |
| Draft write transactions during those bursts | 140 | 12 |
| UI renders during those bursts | 166 | 25 |
| Unused terminal receipt assessments during those bursts | 166 | 0 |
| Idle DOM element creation, 10 seconds with DONE receipt | 0 | 0 |

The intermediate scoped-summary regression was caught before completion and is
excluded from final comparisons: repeated whole-policy evaluation made staging
take 46 seconds. The final policy-keyed summary removes that work. Both paired
fixtures reach the same explicit Wikipedia terms through Vault; current defaults
still omit them. Managed feeds contain 163,850 and 165,862 hosts respectively, so
these are indicative native samples, not a tightly controlled microbenchmark.
Function durations are inclusive and must not be summed as independent CPU cost.
The already-stable idle DOM did not become a newly fixed idle-rendering defect.

All 114 protected files under signed releases 0.1.13-0.1.18 retain their pre-edit
hashes. Read-only offline verification of the existing signed 0.1.18 XPI passes.
No new release package, Mozilla operation, installed-profile write or enterprise
policy change occurred. Native macOS, new real-account flows and daily-profile
long-run heap behavior remain unverified.
