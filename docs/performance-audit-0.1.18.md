# Atlas 0.1.18 performance and rendering audit

2026-10-29. This is a development audit, not release preparation or installation.
Signed 0.1.13–0.1.17, enterprise policies and everyday Firefox profiles are untouched.
[Numeric evidence](evidence/performance-audit-0.1.18.json) records matched native
workloads, counters, process samples and their limits.

## Reproduction and confirmed causes

The pre-fix runtime was copied before product edits. Firefox 159.0 ran that copy
and the corrected build in separate disposable profiles, with the same synthetic
workload and real IndexedDB. The baseline has 300 preset hosts; the corrected
build has 298, removing only YouTube as separately requested. No live accounts,
tokens or production profiles were used. Local edits use ordinary UI controls;
the fixtures never inject permissive authorization state.

The workload stages 60 mixed Whitelist/Blacklist changes, performs 12 edits with
12 rapid input events each, switches Home/Settings/Sites 30 times, idles in a large
review for 30 seconds, removes eight entries, then closes/reopens the page six
times. It verifies the actual durable 52-entry draft and final text, unchanged
active policy and absence of an implicitly submitted Vault proposal.

| Finding | Evidence | Targeted correction |
| --- | --- | --- |
| Quadratic all-terms display indexing | `policyDestinationIndex()` fabricated a Whitelist containing both policy lists and called `evaluate()` for every hostname. Each call validated the entire policy again. The first five additions caused 73,937 evaluations; 20 more caused 290,415. Draft decoding, baseline construction and rendering repeatedly traversed this path. | Validate the real policy once with Core, then group its literal committed terms for display. This list intentionally includes denied terms. It never decides access or replaces submission validation. |
| Duplicate same-turn render notifications | The first five additions caused 87 full page renders. Each local edit and acknowledged write scheduled its own microtask, alongside explicit renders. | Coalesce pending same-turn notifications. An explicit render consumes the pending notification. Disposal drops queued callbacks. No debounce, timer or delayed durable write is added. |
| Rebuilding unrelated committed and draft rows | The Sites list key included the whole draft. Each staged change recreated the committed collection and every draft row. First five additions created 3,189 elements; later 35 created 31,185. | Key committed rows by displayed membership/metadata and affected draft marks. Reuse keyed Sites and draft controls; replace only changed summaries. Prune removed row references. Exact IDs resolve current editor terms rather than captured stale objects. |
| Missing explicit ownership cleanup | Sites opened a draft repository without closing its connection on page hide; a late successful open could also initialize a closed view. This is a source/lifecycle finding, not a proven week-long leak. | Drain already-queued saves, then close the owned connection. A repository opening after disposal closes immediately; recovery-open uses the same guard. |

Reconciliation also computes its candidate once per preview rather than once for
every item. It still validates the whole draft, current baseline and conflicts.
Fresh authoritative verification before submission and after preparation remains
mandatory. This pass introduces no authorization cache.

## Matched before/after measurements

Times include the real UI action and acknowledgement, not just synchronous render
time. Instrumented native medians are machine-specific and not universal budgets.

| Workload | Before | After |
| --- | ---: | ---: |
| Additions 1–5, median | 3,656 ms | 125 ms |
| Additions 6–25, median | 3,719 ms | 125 ms |
| Additions 26–60, median | 3,781 ms | 140 ms |
| Rapid edits of a 60-item draft, median | 8,476.5 ms | 250 ms |
| Home/Settings/Sites actions, median | 234 ms | 15 ms |
| Eight removals, total | 5,781 ms | 1,125 ms |
| First five additions, page render calls | 87 | 40 |
| First five additions, policy evaluator calls | 73,937 | 301 |
| First five additions, elements created | 3,189 | 59 |
| Rapid edits, elements created | 12,528 | 36 |
| Idle large review, elements created over 30 seconds | 0 | 0 |
| Idle review, page render wall time over 30 seconds | 4,730 ms | 194 ms |
| Idle review, aggregate Firefox CPU | 29.9% | 5.88% |

CPU is summed over the disposable Firefox process tree: **100% is one CPU core**.
Short bursts can exceed 100%; for example the much faster navigation burst uses
several Firefox processes. Do not interpret these percentages as whole-machine
utilization. Inclusive function wall times overlap and cannot be added as CPU
time. AST counters, observers and automation introduce overhead in both copies.

Draft write counts deliberately remain unchanged: six writes per staged addition,
14 per rapid-edit operation, one per removal in this fixture. Each existing edit
and submission receipt still has its acknowledged revision and strict failure
behavior. Periodic reads may be fewer during faster phases simply because the
phase lasts less time; this is not claimed as a new storage optimization.

## Flicker, idle work and prolonged use

Interactive reconstruction and long event-loop stalls were reproduced. Keyed
controls now remain connected across unrelated edits, retain identity/focus and
use current exact destinations. Native interaction regressions also cover 120
identical storage notifications, delayed responses, unavailable authority,
preference-save failures, retained entry-point selection and the same Journey
indicator host/label for 60 seconds. Only its countdown text changes; its Core
deadline remains fixed.

**Spontaneous idle flicker was not reproduced:** the baseline already created no
elements in its unchanged review. Approximately one visible-page poll/render per
second remains intentional. The costly validation under that unchanged rendering
path was reduced; the authority read itself was not cached or skipped.

The accelerated workload retains one tab-icon subscription and nine global page
listeners in each reopened view. Idle ends with one UI timeout. Temporary icon
fetch deadlines can legitimately increase the peak while entering Home; they
settle and are not duplicate recurring refresh chains. The existing hidden-page
pause, single-flight refresh/follow-up, request epochs, observer disposal and
object-URL revocation are preserved.

Process private bytes rose during the baseline (about 898→2,056 MiB before page
reopens) and corrected workload (807→942 MiB). Rapid reopening also allocates new
documents before Firefox collects old ones; these raw peaks are not evidence of
retained JS heap. A separate final-build run records four quiescent samples five
seconds apart: private bytes fall from 1,020 to 765 MiB. This Firefox did not expose
the optional test-only memory-minimization helper, so these are natural quiet-time
observations, not forced-GC or retained-heap measurements. No GC hook ships.
This accelerated check does not reproduce weeks of use or prove absence of leaks.

Source review found no growing polling chains, duplicate adapter construction or
whole-store scans on ordinary authority loads. Diagnostic history stays bounded;
tab/download correlations retire on their existing deadlines/context lifecycle.
The page-local observed favicon map can grow with distinct hosts until the page
closes, and durable commit receipts accumulate for reconciliation. Neither was
shown to cause the reported degradation. Receipts were not pruned: changing their
retention requires a separate recovery-protocol decision. No speculative cache
or authority/persistence shortcut was introduced to hide these costs.

## Verification and reproduction

Core **204/204**, extension **416/416**, both TypeScript checks and the development
build pass. Five new tests cover all-terms presentation equivalence/invalid policy,
row identity and current targets, retained labels, draining queued saves before
close and late-open disposal. Catalog/migration tests additionally verify that
YouTube is not seeded or reintroduced and that saved user permissions survive.
All previous failure, synchronization, Vault and storage-recovery tests remain.

Native suites use only isolated profiles: the large-draft workload, persistent
batch/restarts/frozen review/display retry/stale reconciliation, corrected curated
upgrade with two restarts, and UI stability interactions including a 60-second
Journey. The existing Journey-polish suite also passes repeated root re-entry,
bounded GET/POST login continuations, independent tabs and unrelated-navigation
denial without policy/grant creation. The evidence records storage/fresh-install checks and
quiescent results. Windows Firefox 159.0 was tested; macOS and real account flows
were not exercised by this synthetic audit.

After the ordinary development build, freeze each runtime to a separate directory
and instrument copies (never release artifacts) with:

```powershell
node extension/scripts/instrument-ui-performance.mjs <runtime-copy> <instrumented-copy>
python extension/scripts/firefox-e2e.py --performance-audit-only --addon-dir <instrumented-copy>
# For a pre-fix copy, add --performance-baseline to record without post-fix assertions.
python extension/scripts/firefox-e2e.py --destination-batch-only
python extension/scripts/firefox-e2e.py --ui-stability-interactions-only
python extension/scripts/firefox-e2e.py --storage-reliability-only
python extension/scripts/firefox-e2e.py --friend-prototype-only
python extension/scripts/firefox-e2e.py --journey-polish-only
python extension/scripts/firefox-e2e.py --curated-upgrade-only --addon-dir extension/release/0.1.17/addon --upgrade-addon-dir extension/dist
```

Numeric evidence is retained in `docs/evidence`; task-created disposable Firefox
profiles and instrumented runtime copies are cleaned after verification. No test
results are presented as proof of a week-long fix. Core source, authorization
precedence, exact-host matching, clocks, cooldowns, grants, Journeys, Download
Intents, Vault commits, readonly loads and bounded recovery are unchanged.

All ten task-created Firefox profiles and test runtime copies were removed after
retaining sanitized evidence, reclaiming approximately 1.27 GiB. All 118 recorded
Core/signed-release hashes match; all five preserved signed releases pass offline
runtime/archive verification. No signing, submission, packaging or deployment.
