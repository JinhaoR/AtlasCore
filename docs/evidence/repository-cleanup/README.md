# Repository cleanup evidence — 14 November 2026

Historical evidence for the earlier structure-only pass. The subsequent
user-authorized artwork/release cleanup is in the [current report](../../repository-cleanup.md).
Development-only organization; no version, release artifact or everyday-profile
change. Firefox scenarios use synthetic state and disposable profiles.

| Evidence | Result |
| --- | --- |
| [Integrity](integrity.json) | Runtime entry bytes and moved visual files preserved; 15 unused output files removed (2,617,831 bytes); 438 release files and 75 protected source/config files unchanged. |
| [Theme comparison](theme-comparison.json) | Before/after native result trees identical; screenshot hashes match existing evidence. |
| [Native theme scenarios](themes-after.json) | Celestial/Parchment assets, styles, geometry, clicks, rotation, warm switches, narrow/zoom states and full restart pass. |
| [Theme preferences](theme-preferences.json) | Real storage events, dirty editor/search, failed save/retry, popup document and startup persistence pass. |
| [Upgrade and rollback](upgrade-rollback.json) | Signed 0.2.8 baseline, development overlay and three full restarts preserve policy, deadlines and saved presentation/drafts; rollback restores signed baseline without uninstalling. |

The earlier Home screenshots matched the before/after tree. Those background
artwork images were later removed at the user's request; only the historical
numeric results and hashes remain here. They do not describe the current plain
backgrounds. The policy/persistence upgrade evidence remains useful.

Commands from repository root (PowerShell uses `npm.cmd` where script execution
policy blocks npm.ps1):

```text
npm.cmd --prefix extension run build
npm.cmd --prefix packages/core run typecheck
node extension/node_modules/typescript/bin/tsc -p extension/tsconfig.json --noEmit
npm.cmd --prefix packages/core run test:built
npm.cmd --prefix extension run test:built
python extension/scripts/firefox_compact_home.py --theme-prototypes-only --signed-baseline 0.2.8 --addon-dir <preserved-before-runtime>
python extension/scripts/firefox_compact_home.py --theme-prototypes-only --signed-baseline 0.2.8
python extension/scripts/firefox_compact_home.py --theme-only --signed-baseline 0.2.8
python extension/scripts/firefox-e2e.py --release-upgrade-only --release-baseline-version 0.2.8 --addon-dir extension/dist
```

Full suites pass **253 Core + 686 extension** tests, no skips. The added
distribution regression rejects missing live theme/font/startup/popup resources
and remote resource links. All 17 existing staged distributions also pass the
resource/feed verifier read-only; frozen release hash inventories remain exact.

These are browser compatibility and byte-preservation checks, not a load-time or
long-running reliability benchmark. The historical INTERNAL_ERROR is unresolved.
Task-created Firefox copies/profiles are removed after saving sanitized results;
existing `.tools` work and every release artifact remain untouched.
