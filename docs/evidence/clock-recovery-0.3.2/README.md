# Clock catch-up recovery — development evidence

Date: 2026-11-15. Version remains 0.3.2 in the development tree. No new package,
signing, deployment or everyday Firefox profile changes.

## Reproduced defect and bounded fix

The original controller stayed UNAVAILABLE / CLOCK_ROLLBACK after the supplied
clock caught up. The focused regression initially failed with BLOCKED instead of
OBSERVED. In isolated Firefox 160.0, the old runtime also remained unavailable
across later timer ticks after restoring Date.now; explicit Recovery was needed.

The updated Core allows only OBSERVE_TIME to recover that latch, after the actual
clock reaches the same owner's in-memory and saved floors. It runs existing full
recovery and ordinary observation; no command replay, time clamping, deadline
changes or automatic internal-fault retry. See the
[owning contract](../../firefox-storage-reliability.md).

## Results

- [Baseline native](baseline-native.json) and [candidate native](candidate-native.json):
  deficits of 2,538 and 5,993 ms below a saved checkpoint, frozen for multiple real
  background ticks. Both builds deny access while behind. Restoring the real clock
  leaves the old build latched; the candidate reaches READY without RECOVER.
  Removed documents still require a fresh gated launch. Blacklist/Greylist remain
  enforced, policy/configuration are unchanged and diagnosis is retained.
- [Tests](tests.json): build and both TypeScript checks pass; 264 Core and 697
  extension tests pass. Fake-time tests cover same-owner unsaved floors, restart
  checkpoints, a newer checkpoint loaded during recovery, fixed waits/grants/Vault
  terms, ended Journeys, no automatic confirmation, full revalidation, unknown
  outcomes, internal faults and another rollback during the recovery write.
- [Native storage](storage-native.json): real readonly/write abort recovery,
  persistent failure bounds, quota denial, original grant/proposal timestamps,
  explicit Recovery and retained clock diagnostics pass.
- [Native internal faults](fault-native.json): injected PLAN and VERIFY_AUTHORITY
  exceptions stay latched until explicit Recovery. Diagnostic retention and
  existing permission terms remain intact.
- [Native upgrade/restart/rollback](upgrade-native.json): signed 0.3.1 to this
  development build and back, with three full Firefox restarts. Policy, settings,
  pending requests/proposals, grant deadlines, pins, categories, drafts, named
  pages, bookmark connection and theme preference are preserved. One earlier run
  timed out opening the unchanged signed baseline UI before installing the
  candidate; the fresh-profile retry passed. This was not a clock assertion failure.
- [Integrity](integrity.json): all 157 protected release and preceding source
  files retain their SHA-256 values. Relative to the pre-clock development build,
  only background.js, its source map and the compiled adapter comment change.
  Compass/theme assets and UI bundles are unchanged by this clock fix.

These native clock checks patch only Date.now in a disposable background realm.
They reproduce the clock guard and permanent latch, not the user's unknown OS
clock-adjustment trigger. A clock still behind the required floor remains blocked;
the fix does not make an incorrect system clock trustworthy. The separate
hostname/InternalError investigation retains its own limits and recovery rules.

Raw user diagnostics and navigation history are not copied here. Test profiles
and the pre-clock runtime copy are disposable; [cleanup](cleanup.json) records
their removal after retaining these sanitized results.
