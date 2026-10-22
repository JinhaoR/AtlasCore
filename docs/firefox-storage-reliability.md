# Firefox authority storage reliability

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
