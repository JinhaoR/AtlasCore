# Firefox authority storage reliability

## Reported 0.2.2 clock interruption (2026-11-07)

The user's navigation table and diagnostics identify **CLOCK_ROLLBACK / UNAVAILABLE**,
distinct from the earlier unresolved INTERNAL_ERROR. The user is unsure whether
sleep/resume or a time-sync change preceded it. No operating-system trigger or
Firefox process crash is established by this report.

- Events 219–222 show CLOCK_ROLLBACK across four tab contexts; 223–225 record
  removal of content in three previously Whitelisted contexts. Earlier successful
  arrivals and ended REACHED Journeys do not authorize access after authority
  becomes unavailable. The earlier DOWNLOAD_SOURCE_UNAUTHORIZED event is followed
  by a successful arrival; it does not identify the cause of this interruption.
- Session counters are 195,847 read transactions, 97,922 write transactions,
  97,922 committed snapshots and zero failed commits. These show no recorded
  commit failure, not proof of general storage health. Routine time checkpoints
  are writes too; the controller loads before an operation and verifies a load
  after saving. The roughly two-to-one read/write ratio is compatible with that
  path. Without session duration/rate measurements the totals do not establish
  a runaway loop, capacity failure or cause of rollback.
- Production supplies `Date.now()` to the serialized Core controller. Its
  `sampleTime()` rejects any sample below the maximum of its in-memory time floor
  and saved Access/Vault/Journey observation checkpoints. There is no tolerance;
  a one-millisecond decrease can suffice. It also samples after asynchronous
  persistence, so a successful commit and subsequent CLOCK_ROLLBACK can coexist.
  The latched status does not automatically clear when time catches up. Explicit
  Recovery must reload valid authority and pass the same owner's time floor.
- “No retained runtime incident” describes the previous-session exception journal
  in the current UI, not proof that no failure occurred or that current runtime
  faults are empty. CLOCK_ROLLBACK is an explicit guarded status rather than a
  thrown exception and need not create a runtime-fault entry.

The subsequent **All tabs / Export JSON** supplied by the user establishes a
**5,993 ms observed deficit relative to the saved checkpoint**:

| Field | Epoch milliseconds | Stockholm time, 2026-11-07 (CET) |
| --- | --- | --- |
| Background started | 1794049199716 | 11:59:59.716 |
| Saved checkpoint | 1794070567970 | 17:56:07.970 |
| Interruption observed | 1794070561977 | 17:56:01.977 |

The export still reports UNAVAILABLE / CLOCK_ROLLBACK, no pending commit,
empty controller and adapter queues, no active operation, `faults: []`,
`previousSession: null`, diagnostic retention READY and `lastFailure: null`.
Events 219–222 report blocking within four milliseconds of the interruption
observation; removals 223–225 follow within 56 milliseconds. This is evidence of
a responsive background enforcing its latched clock guard, not an export-time
queue stall or recorded runtime exception. It does not prove Firefox never
experienced any separate process failure.

The wall-clock span from session start to saved checkpoint is 5 h 56 min 8.254 s.
The 97,922 committed snapshots average approximately 4.58 per second over that
span. This is an approximate session average using the affected wall clock, not
monotonic elapsed-time measurement, a peak rate, or proof of a storage loop.

A narrow read-only Windows System-log query for Kernel-General event 1 and
Time-Service events within two minutes either side of the observation returned
`NoMatchingEventsFound`. No matching OS clock-change evidence was available from
that query; absence does not disprove an adjustment or identify its source.
The Windows/time-sync/sleep cause remains unresolved. The sanitized numeric
record is [clock evidence](evidence/firefox-clock-rollback-0.2.2.json); the raw
hostname history stays outside the repository.

The export includes `authorityInterruption` with
`observedAt`, `checkpointAt` and `latestStorageFailure`, timestamped navigation
entries, current controller progress, and runtime session/fault data. These can
narrow timing and show whether the adapter observed time below the saved
checkpoint. They do **not** capture the exact rejected Core sample or its
in-memory floor: `observedAt` is sampled later by the adapter. Consequently even
a nonnegative observed/checkpoint difference cannot disprove a short rollback.
The interruption and navigation log survive same-background Recovery, but not
background restart. Do not infer an exact rollback magnitude or time-sync cause
from this evidence: 5,993 ms is the observed checkpoint deficit, not necessarily
the full clock adjustment. Do not reset authority, clamp time, extend deadlines or
add automatic clock recovery on this evidence.

Inspection confirmed that the working controller, background clock wiring,
Firefox adapter, runtime diagnostics and IndexedDB repository sources match the
preserved 0.2.2 reviewer-source archive (normalizing checkout line endings).
Nine existing focused tests passed with
`node --test --test-name-pattern='clock|rollback|interruption|failed observation persistence' packages/core/tests/controller.test.mjs extension/tests/storage-reliability.test.mjs`.
These use fake time and mocked browser/IndexedDB behavior; they verify the guard,
retention and recovery semantics, not this user's physical clock event. No native
reproduction or runtime/release change was made for this diagnosis.

## Focused 0.1.19 reliability investigation (2026-10-30)

This follows the [engineering review](engineering-review-0.1.19.md). The original
intermittent exception is still **unidentified**. Do not present an injected
exception, successful Recovery, or a large transaction counter as its cause.

### Failure map

| Mechanism | Origin and visible behavior |
| --- | --- |
| Ordinary denial | Core returns Greylist/WAIT/REQUIRE_CONFIRMATION or DENY. The controller can remain READY. These are decisions, not crashes. |
| INTERNAL_ERROR | The controller queue catches an unexpected thrown exception outside its specific port guards. It records the operation/stage/class, then latches UNAVAILABLE; subsequent commands are BLOCKED until explicit `open()`. The unreachable `save` without authority guard also uses this reason. |
| Uncertain write | An unexpected exception with a pending commit remains RECONCILING/COMMIT_UNKNOWN. A thrown/malformed repository commit result also remains unknown. Never reinterpret it as a failed write or replay confirmation. |
| Expected port failure | Load throws/unavailable => STORAGE_UNAVAILABLE; definite commit failure => WRITE_FAILED; clock, managed data, invalid state, conflicts and rollback have their own codes. These do not normally become INTERNAL_ERROR. |
| Browser/UI exception | An adapter effect, read-only projection or background callback can throw separately. A failed message may make the control page appear unavailable even with healthy Core authority. It is not evidence of the controller latch. |
| Held asynchronous work | A pending repository/browser promise can hold serialized work. Read-only diagnostics bypass that queue. LOADING/COMMITTING without progress differs from a completed BLOCKED/INTERNAL_ERROR result. No timeout abandons an uncertain commit. |
| Terminated/hung extension or Firefox crash | A dead process or blocked JS event loop may provide no message response or catchable exception at all. Process exit/minidump/browser-console evidence is needed. The observed controller error alone proves none of these. |
| Node/web-ext signing assertion | A separate release-time process/toolchain failure. Core/adapter do not run web-ext or Node in Firefox. No common cause or new reproduction is established here; no signing command was run. |

Producers were traced through controller `fault`/`save`, BLOCKED responses,
adapter refresh/content removal, retained interruption, UI unavailable copy and
JSON export. `faultClass` also uses the name INTERNAL_ERROR for Firefox's native
`InternalError` exception class; that is distinct from the generic result code.
The historical screenshot cannot identify which class was thrown. Validation,
planner, comparison and freezing exceptions can reach the outer catch; expected
repository failures have their narrower catches. A synchronous failure of
`getView()` itself is outside the queued controller path.

### Diagnostics, without changing recovery

Core now offers optional readonly `getActivity()` (operation, stage, active,
queued and completed counts) and an optional trusted `onInternalFault` observer.
The observer is never awaited; a synchronous throw cannot alter the closed
outcome. There is no real clock, browser dependency or new permission in Core.

Firefox records up to **20 distinct runtime faults**, deduplicated by subsystem,
class, location and controller operation/stage. Records contain repeat counts,
first/last times and at most five exact own-`background.js` numeric line/column
locations. The parser rejects other origins, query strings and arbitrary stack
locations. It never retains raw exception text, raw stacks, function names,
URLs, website contents or credentials. Hostile getters are contained. Background
`error` and `unhandledrejection` are observed without suppressing browser handling.
Queued adapter errors and failed GET_VIEW projections are separate subsystems;
a projection failure now returns the existing ADAPTER_FAILURE response rather
than escaping the message listener. Healthy Core is not relabelled INTERNAL_ERROR.

GET_DIAGNOSTICS and the existing JSON export include the extension version,
background start time, queue progress, current controller status/revisions and
pending-write flag, alongside the existing storage counters/interruption and
bounded hostname navigation log. Current revisions are observations at export,
not a claim about a past incident. The final [0.1.19 quality pass](quality-pass-0.1.19.md)
also retains the latest sanitized fault session in separate local presentation
storage. Healthy restarts retain that prior incident without writing a new record;
the export distinguishes its producing version and session from current faults.
Navigation history and Core's detailed interruption remain session-only. A failed
diagnostic save is reported, never an authority failure or automatic recovery.
There are no new timers, permission retries, profile identifiers, permissions or
telemetry. This supersedes the initial investigation's memory-only retention.

### Capture the next real incident

1. Before Recovery or restarting Firefox, open **Settings → Navigation
   diagnostics**, choose **All tabs**, and **Export JSON**. The export includes
   visited hostnames; review those before sharing it.
2. If it appears stuck, export again after about ten seconds. Compare background
   start time, controller stage/completed count, adapter activeSince/queue depth
   and storage counters. A static LOAD/COMMIT needs storage investigation;
   a recorded fault has exact bundle locations resolvable using the matching
   release's source map. Repeated identical faults are counts, not log flooding.
3. Note whether other Firefox tabs and browser controls respond. If Atlas cannot
   export, use Firefox's extension debugging console for Atlas. Review output
   for private URLs before sharing; do not reset/delete saved Atlas authority.
4. Recovery may then be used. Export afterward if needed: same-background faults
   remain. If Firefox actually exits, record the crash identifier/time separately;
   do not infer a crash from the Atlas unavailable page.

Native scenarios: `--long-reliability-only` exercises five minutes of actual idle
timer/IndexedDB work with synthetic history, delayed storage, tab races, repeated
navigation/UI lifetimes and background reload. `--internal-fault-only` verifies
actual caught exception locations and unhandled rejection classification.
`--storage-reliability-only` covers the distinct abort/recovery paths. All use
disposable profiles and local/synthetic destinations. Results and limits are
recorded in `docs/evidence/reliability-investigation-0.1.19.json`.

### Verified results and remaining limits

**241 Core / 511 extension tests pass**, including six new observer/progress,
sanitization/bounding and projection-failure regressions. Both documented type
checks and the development build pass. Native Windows Firefox **159.0** passes
the complete soak, fault and 12-group storage scenarios. The first soak reached
five fault-free idle minutes but its harness incorrectly assumed a controller
already existed during background reload. That readiness predicate was corrected
and the complete scenario rerun; this was a fixture failure, not an Atlas outage.

The final soak seeds 2,500 ended Journeys, 300 expired grants and 100 expired or
stale requests. Thirty repeated exact-Whitelist navigations, eight control-page
open/close cycles, a real four-second IndexedDB barrier and tab closure while
queued all pass. In 301 seconds of idle, roughly 600 controller operations finish,
all 60 queue samples show no queued adapter work, and no unexpected runtime fault,
storage failure, own-extension console error or minidump is observed. Background
reload obtains a new owner, preserves policy and original Access terms, and still
blocks Blacklist/expired access. Injected PLAN/TypeError and
VERIFY_AUTHORITY/RangeError locations map back to the matching source map. Real
unhandled promise rejections are separately recorded/deduplicated; they do not
invent a controller latch. Storage abort, quota, rollback and explicit Recovery
retain the existing security boundaries.

History still costs work: navigation median is about **578 ms** in this large
fixture (30 samples, max 782 ms). Aggregate sampled Firefox CPU grows by 73.3 CPU
seconds during the idle interval; private bytes fall from 1,766 to 1,141 MiB while
the process count falls from 13 to 12. These are observations, not a matched
optimization benchmark or proof about retained heaps. Other isolated fault tests
overlapped setup; no before/after incident-frequency improvement can be claimed
because the original exception was not reproduced. No history/receipt pruning,
permission cache, changed checkpoint contract or automatic internal-fault recovery
was added. Receipt growth remains the separate capacity risk described below.

This is not multi-day, low-memory, exhausted-disk, real-account, macOS or physical
crash/power-loss verification. The production changes are diagnostic fields and
observer in Core's controller, Firefox `runtime-diagnostics.ts`, adapter queue/view
reporting, background observers and existing UI export. All **114 frozen release
files** retain their hashes; no installed profile, signing, deployment or policy
configuration changed. Earlier uncommitted work is retained.
After retaining sanitized evidence, all four disposable profiles created by this
investigation were removed, reclaiming about 540 MiB. Other `.tools` work remains.

## 0.1.18 idle INTERNAL_ERROR report (2026-10-30)

New user evidence distinguishes this incident from the earlier storage-abort
case. Signed 0.1.18 reports **INTERNAL_ERROR / UNAVAILABLE**, with 36,161 read
transactions, 18,079 committed writes and **zero failed commits**. The user had
left the page on a second monitor without interacting. The screenshot shows an
allowed arrival and later removal, but does not show elapsed times. It neither
identifies the failing operation nor proves arrival caused it.

`DOWNLOAD_FETCH / DOWNLOAD_RESPONSE_PENDING` is the adapter's ordinary trace for
an operation awaiting response handling; it is not proof of a broken download or
the source of Core's failure. These observations do not justify changing
downloads, Journey rules, policy, clock checks or storage recovery eligibility.

The controller's final queue catch discards unexpected exceptions and reports
only INTERNAL_ERROR (or COMMIT_UNKNOWN while a write is unresolved). The
impossible save-without-authority guard uses the same generic reason. Existing
repository diagnostics cannot explain an exception outside their storage error
paths. No retained stack or error class can be recovered retroactively from the
signed 0.1.18 record. **The actual user trigger remains unknown.**

Development 0.1.19 therefore adds a closed, memory-only `internalFault` record to
the controller view: monotonic sequence, known operation name, processing stage,
allowlisted exception class, pending commit identity and counts of last verified
Journeys/requests/grants. No exception message, stack, URL, hostname, credentials,
request payload or snapshot is recorded. This Core record excludes host-specific
stack interpretation and error strings; the later focused investigation above
adds numeric own-bundle locations in the Firefox layer only. Unknown/throwing exception-name
getters become OTHER, and recording failure cannot replace the conservative path.

The last record survives explicit `open()` in the same owner, not background
restart. Firefox attaches it to the retained interruption only when the reason
and pending commit identity match. A historical fault is not attributed to a
later ordinary storage/unknown-outcome incident. Existing Diagnostics text and
JSON export show the record; cached presentation supplies no authority.

This adds diagnosis, **not an unproven fix for the reported trigger**. INTERNAL_ERROR
still blocks and requires explicit Recovery. There is no automatic retry,
confirmation replay, new clock source, state reset, history pruning or changed
permission rule. Existing narrow confirmed-transient storage recovery is unchanged.
Failed/unresolved writes retain the original commit-resolution boundary.

Verification includes pure controller and mocked Firefox regressions for idle
faults with zero failed commits, closed fields and hostile getters, retained
diagnosis, queued confirmations, frozen terms, pending commit recovery, no
automatic retry and no stale-cause attribution. Synthetic fault injection is
separate from reproducing the user's underlying exception. A fake-time Node soak
with 2,500 ended Journeys and 200 operations does not reproduce the outage; it is
not native longevity, heap or actual-profile evidence. Native results and exact
counts are recorded in [the follow-up evidence](evidence/firefox-internal-fault-0.1.19.json).

No everyday profile, enterprise policy or signed release is modified. This remains
development 0.1.19 and does not authorize packaging, signing or deployment.

Verified: **229 Core and 490 extension tests pass**, with both TypeScript checks
and the actual extension npm test/build command. Native Firefox **159.0** runs the
same two injected idle exceptions against preserved 0.1.18 and current 0.1.19:
PLAN/TypeError and VERIFY_AUTHORITY/RangeError. Both reproduce INTERNAL_ERROR with
zero failed commits and replacement of retained documents. Only the new runtime
reports the closed stage/class data, visible in Diagnostics and JSON export, and
retains it after explicit Recovery. One real Greylist grant and one frozen Vault
proposal keep their terms throughout; manual Blacklist remains enforced.

Native helper:
`python extension/scripts/firefox-e2e.py --internal-fault-only`.
For the preserved behavior add
`--internal-fault-baseline --addon-dir extension/release/0.1.18/addon`.
Test-only stack matching targets controller execution rather than independent
presentation plans; it is not shipped and records no stack or URLs. These are
synthetic error injections, not proof of the actual user's exception. Real idle
longevity, resource pressure and the original device's runtime cause remain
unverified.

## 0.1.17 recurrence and 0.1.18 development follow-up (2026-10-29)

The user again saw global “Waiting for verified state” while idle, then selected
Recovery before recording the controller reason. Their installed version was
**0.1.17**. Afterwards the same session reported 344,940 read transactions,
172,469 writes/committed snapshots and **zero failed commits**, and the user did
not see a retained storage issue. This does not establish a failed write. A LOAD
abort would normally leave `lastFailure` after Recovery as well. The actual
trigger of this occurrence therefore remains **unidentified**, including whether
a wall-clock rollback or another controller failure occurred. No normal Firefox
profile or saved private authority was inspected. A narrow read of recent local
Windows clock-change events yielded no usable event; it does not rule out a
small clock adjustment or establish the cause.

Two separate mechanisms are reproduced; do not conflate them with attribution:

1. **Uncovered readonly failure latch.** In native Firefox, aborting one actual
   readonly LOAD in preserved 0.1.17 produces `UNAVAILABLE · STORAGE_UNAVAILABLE`,
   zero failed commits and removal of three Whitelisted tabs until explicit
   Recovery. The 0.1.17 write-abort recovery predicate did not cover this path.
2. **Clock failure without a storage error.** A fake-time test reproduces
   `CLOCK_ROLLBACK` with zero failed commits and no storage diagnostic; isolated
   native Firefox separately exercises the same guard without a storage fault.
   Manual Recovery
   can succeed once time catches up, but 0.1.17 loses the previous Core reason.
   This is a supported possibility, not a diagnosis of the user's incident.

### Narrow read recovery and retained explanations

The development adapter extends the existing one-attempt recovery to
`STORAGE_UNAVAILABLE` with a matching `LOAD / TRANSACTION_ABORT / ABORTED` or
`IO_ERROR` diagnostic. It still requires `UNAVAILABLE`, no pending commit, the
same Core owner/time floor, full authoritative reload/validation and acknowledged
recovery persistence. Only a fresh housekeeping/retained-page assessment is made
afterwards. A persistent failure consumes the attempt and remains closed until
explicit Recovery. All prior unknown-outcome, quota, connection, invalid-data,
strict-durability and clock exclusions remain intact.

This extends the older COMMIT-only recovery boundary described below; it does
not change Core, add a permissive cache or replay a command. A failed read before
confirmation cannot confirm. A read failure after a known committed confirmation
recovers the one already-acknowledged grant; it cannot confirm/renew it again.
Existing Access/Vault terms and normal lost-Journey-binding behavior remain.

LOAD initialized/envelope mismatches now record `VALIDATION / INVALID_DATA`, so
an older historical abort cannot cause damaged authority to be classified as a
new transient failure. Optional diagnostic getters are read/copied inside their
error guard and cannot turn a healthy owner unavailable.

The adapter retains **one** `authorityInterruption` per background lifetime:
Core status/reason, observed wall time, persisted checkpoint time and
`latestStorageFailure`. It records failures before automatic or explicit
recovery, survives successful Recovery and is replaced by a later independent
incident. Policy & recovery, Diagnostics and the existing JSON export expose it
as historical information. A full background restart clears it. The latest
storage observation is explicitly **not proof of causation**; a later clock
failure may carry an earlier storage diagnostic as context. No URL, credentials,
exception text, policy contents or permission are added to this record.

Clock sampling, rollback detection, cooldowns and the requirement for explicit
clock recovery are unchanged. No wall-clock clamping, timestamp reset, wait/grant
extension, automatic confirmation or installed-extension change is introduced.
If a future incident shows `CLOCK_ROLLBACK`, use that retained evidence to decide
whether a separate clock/recovery design change is warranted; do not silently
weaken the existing contract.

### Verification

Core **204/204** and extension **430/430** tests pass, with both TypeScript checks
and the development build. Fourteen new regressions cover read failures before
housekeeping, during retained checks and after committed verification; bounded
persistent failure; no replay; retained clock/read/unknown-outcome explanations;
diagnostic getter isolation and stale diagnostics followed by damaged state.

Native Firefox 159.0 compares preserved signed 0.1.17 with development in isolated
profiles. The former reproduces the read latch; the latter keeps three healthy
Whitelist tabs open, retains grant/proposal timestamps and preserves all existing
write-abort, persistent-failure, quota and Blacklist checks. The final clock
scenario restores only the synthetic background's clock, explicitly recovers and
checks that the old reason remains visible/exportable in READY. Existing native
UI/race/60-second Journey regressions remain separate evidence. Commands:

```powershell
python extension/scripts/firefox-e2e.py --storage-reliability-only --storage-read-baseline --addon-dir extension/release/0.1.17/addon
python extension/scripts/firefox-e2e.py --storage-reliability-only
python extension/scripts/firefox-e2e.py --ui-stability-interactions-only
```

[Follow-up evidence](evidence/firefox-idle-recurrence-0.1.18.json) separates the
user's report, reproduced mechanisms and unproven original trigger. This is
development 0.1.18; it is not present in the installed 0.1.17 merely because the
repository was built. No signing, submission, deployment, enterprise-policy edit
or everyday-profile change is performed. Preserve all signed release assets.

## Report and reproduced failure

On 2026-10-21 the user reported that signed Atlas 0.1.16 began replacing all
website tabs with “Waiting for verified state” during uninterrupted browsing.
Policy & recovery showed `UNAVAILABLE · WRITE_FAILED`, with the saved Whitelist
still present. Explicit Recovery temporarily restored normal browsing.

There are two confirmed implementation problems:

1. `IndexedDBRepository.load()` used a strict **readwrite** transaction for every
   ordinary read, because the same method also supported schema-1 migration.
   Each Core operation loads before planning and after a save, so repeated
   per-tab checks created unnecessary write transactions alongside real checkpoint
   writes. They also retained a receipt for each real commit.
2. One final aborted commit makes Core unavailable, correctly withholding access.
   The adapter kept sending ordinary operations to that unavailable owner. Those
   calls cannot recover it, so one transient failure became a persistent global
   outage until the user selected Recovery. The repository discarded the actual
   IndexedDB error, leaving only the generic `WRITE_FAILED` explanation.

The baseline native fixture injects one real IndexedDB transaction abort into
preserved 0.1.16. It reproduces the unavailable latch and removal of three
Whitelisted pages, followed by successful explicit Recovery. The unit regression
also reproduces it without a browser.

This establishes the outage mechanism. The old build did **not** record whether
the user's original transaction failed from an abort, I/O error, quota, or another
cause. Neither the screenshot nor the synthetic fault identifies that original
Firefox error. A week of use is not proof of quota exhaustion. No everyday browser
profile or private saved authority was inspected.

## Changes and boundaries

### Reads and migration

Ordinary loads now use readonly transactions overlapping the authority and receipt
stores. These still fence earlier writes. Schema-1 detection schedules a separate
strict write transaction, which rereads the current initialized marker/envelope
before migrating. Concurrent migration and CAS behavior remain atomic; corrupt or
missing initialized data is never replaced with defaults. Real writes still use
strict durability and publish only after transaction completion.

### One bounded recovery attempt

The Firefox adapter may call the existing controller `open()` once after a proven
`NOT_WRITTEN` commit that left `UNAVAILABLE · WRITE_FAILED`, with no unresolved
commit, and a repository diagnostic of `TRANSACTION_ABORT · ABORTED` or `IO_ERROR`.
It uses the **same** controller, repository and clock floor. Core reloads and
validates the complete authoritative snapshot and saves recovery housekeeping
before READY. An interrupted housekeeping/check operation is then assessed fresh;
no saved assessment is replayed. Successful recovery precedes replacement of
otherwise-authorized retained pages.

This is an explicit use of Core's existing recovery API by its trusted host;
Core's rule that unavailable `handle()` calls are blocked remains unchanged.
After a failed automatic attempt, periodic checks cannot start an endless retry
loop. Explicit Recovery remains available. A later healthy check cycle permits
one attempt for a new independent interruption.

Failed Greylist/Vault confirmations are **never** repeated. Reloading authority
does not confirm, submit, renew, navigate, or change policy. A fresh explicit user
confirmation is required within the original window. Waits, grants, proposals,
revisions, counters and deadlines retain their existing semantics. As with manual
Core recovery, active Journeys end for lost binding; they are never revived or
given another deadline. An unfamiliar intermediate can therefore still require
returning to the trusted root after a real storage interruption.

Quota, connection, validation, strict-durability and clock failures do not receive
this automatic attempt. Unknown outcomes remain RECONCILING and require the
existing explicit resolution path. Persistent failure remains closed. Browser
requests, tab lineage and Core authorization are otherwise unchanged.

### Safe local diagnostics

Repository diagnostics are memory-only: read/write transaction counts, successful
and failed commit counts, and the last failure's sequence, operation, stage and
closed cause code. No raw exception message, URL, hostname, credential, stored
snapshot or browser event is copied into this diagnostic. Diagnostics cannot
authorize access, and diagnostic failures do not disable a healthy controller.
Firefox `UnknownError` is grouped as `IO_ERROR`; this is a storage error class,
not proof of a particular disk fault or an unknown commit outcome.

Settings → Navigation diagnostics shows these counters and exports them alongside
the existing hostname log. Policy & recovery shows a specific storage cause while
unavailable. `QUOTA_EXCEEDED` advises freeing disk space and explicit Recovery;
it never recommends deleting Atlas data. Existing export privacy guidance still
applies to the separate navigation entries. Restart clears the memory-only record.

## Verification

- `extension/tests/storage-reliability.test.mjs`: readonly loads; single and
  persistent aborts; per-tab check failures; safe quota diagnostics; acknowledgement
  ordering; failed explicit confirmations; immutable grant/proposal terms;
  Blacklist and expiry; rollback; lost Journey bindings; superseded requests;
  unknown outcomes; many tabs and repeated interruption cycles; safe copy.
- Existing repository tests cover concurrent CAS/load barriers, old receipts,
  replay, restart, atomic/failed migration and corrupt authority.
- `python extension/scripts/firefox-e2e.py --storage-reliability-only` exercises
  actual IndexedDB in a disposable Firefox profile with synthetic local sites,
  real Greylist waiting/confirmation, frozen Vault terms, one-shot and persistent
  aborts, quota diagnostics, explicit Recovery and current Blacklist enforcement.
- To reproduce the old failure separately, use `--storage-reliability-only
  --storage-baseline --addon-dir extension/release/0.1.16/addon`. Release files are
  read only. Never point this harness at an everyday Firefox profile.

Verified results: **204 Core and 391 extension tests pass**, including 17 new
storage regressions, with both TypeScript checks and the development build.
Disposable Firefox **158.0.1** passes the seven storage groups, nine existing
batch/Vault groups with three full process restarts, and nine existing UI/Journey
interaction groups. The baseline separately reproduces the old outage. In the
three-tab five-second sample, write transactions change from 60 to 16; real
checkpoint commits remain. Counts vary with scheduling and do not measure CPU
or storage capacity. All 76 preserved release files across 0.1.13–0.1.16 keep their
hashes, all four signed XPIs verify offline, and Core source matches the frozen
0.1.16 reviewer source (allowing only checkout line endings).

Exact results and hashes belong in
[the evidence record](evidence/firefox-storage-reliability.json). Native fault
injection does not establish physical crash/power-loss durability or reproduce a
particular device's disk error. No release version, signing, submission, installed
extension, browser policy or everyday profile is changed by this fix.

## Remaining storage limitation

Receipts are still retained for reconciliation. This change reduces unnecessary
write transactions; it does not remove real checkpoint commits or compact receipt
history. Unbounded receipt growth is a known capacity risk, not a confirmed cause
of this user's incident. Compaction needs a separately specified reconciliation
horizon and replay guarantees; deleting receipts opportunistically would break
the existing repository contract. Core checkpoint/rollback guarantees are not
weakened to reduce write volume.
