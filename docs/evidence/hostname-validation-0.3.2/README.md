# 0.3.2 hostname-validation interruption

Investigation and development mitigation, 2026-11-15. No signing, release
packaging, deployment, version bump or everyday-profile changes.

## Observed incident

The supplied export records `CHECK_NAVIGATION / VALIDATE_LOAD / INTERNAL_ERROR`
at 14:45:23.854 UTC (15:45:23.854 CET), about 6.51 hours after background startup.
The exception class is Firefox `InternalError`; the generic controller reason
alone would not have identified that class. There was no pending commit, no
recorded storage failure and no queued/active operation at export. The last
verified state contained 1,596 Journeys, eight requests and 49 grants.

The five own-bundle frames identify this path:

| Generated background location | Source operation |
| --- | --- |
| 8:27 | `normalizeHostname`: `/^[a-z0-9.-]+$/i.test(value)` |
| 537:41 | `canonicalHostname` |
| 573:118 | `readJourney` |
| 620:34 | `readJourneyState` |
| 1247:42 | `validateAtlasSnapshot` |

The retained unsigned 0.3.2 background bundle matched the pre-change development
bundle exactly after removal of its source-map trailer. Its source archive also
matched the hostname validator. [mapping.json](mapping.json) records the release
hash and mapped locations. [incident.json](incident.json) retains only diagnostic
counters, closed fault codes and numeric frames; the raw export and visited
hostname history were not copied into the repository.

This establishes the failing operation, not why Firefox threw there. The export
does not retain the engine error message, rejected input, heap state or Firefox
version. The successful commit count is not proof of general storage health;
collection sizes are not evidence that history retention caused the exception.
The background continued serving diagnostics and recorded content removal after
the fault. No Firefox process crash is established by this export.

## Targeted mitigation

Core hostname normalization now checks at most 253 characters after trimming
and accounting for one optional root dot. It checks ASCII before lowercasing,
retains the 63-character label limit and hyphen rules, rejects numeric/IP
shorthand, and keeps the existing URL-parser canonicalization check. This removes
the failing regexp operation and the other hostname regexps without caching
authority, skipping validation, deleting history or automatically retrying faults.

The original native implementation **did not reproduce the exception** in the
bounded fixture. This is mitigation of the recorded failure point, not proof of
the underlying long-session trigger or a guarantee against every INTERNAL_ERROR.
No other controller, storage, migration, permission or recovery logic changed.
An already latched installed copy still needs explicit **Settings → Policy &
recovery → Reload and reconcile state**. That action reloads and validates saved
authority; it does not reset policy or confirm pending changes.

## Validation

- Build and both TypeScript compilers passed. All **256 Core** and **693 extension**
  tests passed: [tests.json](tests.json). New cases cover exact hostname/label
  boundaries, every UTF-16 code unit, Unicode case-folding traps, oversized inputs
  and IP shorthand rejection.
- **152,106** paired inputs produced identical `normalizeHostname` and
  `normalizeTarget` results against the original 0.3.2 implementation:
  [equivalence.json](equivalence.json). This combines exhaustive code-unit
  positions, deterministic generated inputs and boundary cases; it is not a
  mathematical proof over every possible JavaScript input.
- Native Firefox **160.0**, using separate disposable profiles and wholly
  synthetic 1,596/8/49 collections, completed **2.4 million direct hostname
  checks and 2,400 complete snapshot validations per version**. Ordinary
  background IndexedDB validation/checkpointing also remained available.
  [Baseline](baseline-native.json) and [candidate](candidate-native.json) both
  ended READY with no recorded runtime fault. The sampled runs lasted about
  77 and 74 seconds; this is not a 6.51-hour reproduction or a performance claim.
- Existing [native fault/recovery checks](recovery-native.json) passed injected
  PLAN and VERIFY_AUTHORITY exceptions, conservative latching, explicit recovery,
  manual Blacklist enforcement, fixed grants/frozen proposals and diagnostic
  retention. These injected exceptions are separate from reproducing the user's
  actual trigger.
- [Signed-0.3.1 upgrade/restart/rollback](upgrade-native.json) passed three full
  Firefox restarts, preserving policy, settings, pins, categories, drafts,
  named pages, pending terms/deadlines, bookmark connection and theme preference.
- [Integrity](integrity.json) verifies that retained release files and the
  preceding compass changes remain byte-identical. [Cleanup](cleanup.json)
  records removal of this investigation's disposable profiles/runtime/add-on
  copies after retaining sanitized results.

## Reproduce the candidate checks

```text
npm.cmd --prefix extension run build
npm.cmd --prefix packages/core run test:built
npm.cmd --prefix extension run test:built
python extension/scripts/firefox_compact_home.py --hostname-validation-only --signed-baseline 0.3.1
python extension/scripts/firefox-e2e.py --internal-fault-only --addon-dir extension/dist
python extension/scripts/firefox-e2e.py --release-upgrade-only --release-baseline-version 0.3.1 --addon-dir extension/dist
```

The hostname probe copies compiled Core modules into its disposable add-on only;
none of its instrumentation ships in the development or retained release bundle.
