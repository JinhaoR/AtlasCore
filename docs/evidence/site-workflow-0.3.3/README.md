# 0.3.3 — simpler site editing and Vault

Adding a site now moves directly from the editor to review, then to Vault within
All Sites. Timing changes keep their Settings context. Back, forward and reload
retain that context. A single shared Vault renders both flows; there is no new
polling owner or recovery timer.

Review and Vault use one compact column. Exact addresses, planned access and
scope warnings remain visible; the full comparison and technical details are
available on demand. Long waits use hours and minutes. The waiting confirmation
button keeps its place, and successful confirmation or cancellation stays in
Vault with a short result message. A saved waiting batch uses one directory link
instead of a duplicate receipt panel. Uncertain saves, conflicts and retry
controls remain visible.

[Before](before-vault.png) · [Parchment Vault](vault-parchment.png) ·
[Site review](review-parchment.png) · [Celestial Vault](vault-celestial.png) ·
[Narrow layout](vault-narrow-parchment.png)

## Signing candidate

- [Unsigned extension ZIP](../../../extension/release/0.3.3/atlas-0.3.3-unsigned.zip)
- [Reviewer source ZIP](../../../extension/release/0.3.3/atlas-0.3.3-source.zip)
- [Full integrity receipt](../../../extension/release/0.3.3/release.json)

The version is **0.3.3**, with the existing extension ID. Both archives reproduce
byte-for-byte from the extracted reviewer source using locked dependency
installation: all 39 runtime files and 281 source files match. See
[source reproduction](source-reproduction.json) and [release checks](release.json).
No signing, submission, deployment or everyday-profile changes were performed.

The candidate includes the preceding [compass feedback](../compass-feedback/README.md),
[bounded hostname validation](../hostname-validation-0.3.2/README.md) and
[clock catch-up](../clock-recovery-0.3.2/README.md) fixes. This UX pass adds no Core,
permission, schema, migration or storage changes. All 197 snapshotted Core,
theme and retained-release files remain byte-for-byte unchanged from the start
of this pass: [integrity](integrity.json).

## Verification

| Check | Result |
| --- | --- |
| [Core and extension tests](tests.json) | 264 Core and 702 extension tests passed; 966 total, no failures |
| TypeScript and builds | Both packages compiled; final release validation passed |
| [Native workflow](candidate-native.json) | Add → review → Vault within All Sites; explicit confirmation after the real deadline; cancellation, Settings context, pending indicators, result wording, both themes, narrow zoomed layout, back/forward and reload |
| [Pre-change workflow](baseline-native.json) | Reproduced editor → directory → manual review → Settings/Vault with a copied pre-UX development runtime |
| Idle rendering | Candidate retained the sampled nodes with zero measured movement over 361 animation frames; baseline also had zero idle movement, so this is stability evidence rather than a speedup claim |
| [Signed 0.3.2 upgrade](upgrade-native.json) | Upgrade, full candidate restart and rollback preserved policy, settings, pins, category order/icons, bookmarks, draft fields, pending proposal/request/grant deadlines and theme preference |
| [Signed 0.2.8 upgrade](upgrade-0.2.8.json) | Retained baseline also passed upgrade, full restart and rollback without uninstalling |
| [Fresh profile and site controls](compass-native.json) | Empty/one-pin compass, desktop/narrow/zoomed layouts, ordinary gated site opening, pin saving and reload |
| [Clock recovery](clock-native.json) | Existing timer stayed closed while behind, recovered only after actual catch-up, and retained policy and fixed terms; no OS clock modification |
| [Internal faults](fault-native.json) | Synthetic faults remained latched until explicit Recovery; policy, deadlines, diagnostic evidence and blocking remained intact |

Native checks used Firefox 160.0 on Windows with disposable profiles and synthetic
state. The signed-baseline tests use a temporary candidate overlay and full
restarts, then restore the actual signed baseline without uninstalling it.
They do not test a newly signed 0.3.3 XPI; that does not exist yet.

Lint reports zero errors, zero notices and the existing Firefox Android
minimum-version warning. The supported target remains desktop Firefox 140+.
[Dependency audit](audit.json) reports zero runtime findings and six development
toolchain findings (three low, one moderate, two high). This pass retains the
existing locked toolchain; no dependency upgrades were mixed into the UX change.

Harness iterations synchronized with acknowledged fixture state and rendered
views, waited for enabled controls, used real zoom for Windows' minimum window
width, and added the signed 0.3.2 controls to the existing baseline branches.
The stale-revision rejection encountered during setup remained enforced. These
test setup corrections do not establish causes of the user's earlier crashes.

The original Firefox hostname-validation exception remains unreproduced; its
earlier mitigation is targeted, not a claim to fix every internal fault. These
checks also do not repeat the full external authentication/download matrix or
prove physical power-loss durability. Saved history and fail-closed validation
remain intact. Only this task's identified disposable profiles, runtime copies
and source-reproduction workspace were removed after retaining results:
[cleanup](cleanup.json).

## Repeating the focused native checks

After building the candidate, use the existing isolated harness:

```powershell
python extension/scripts/firefox-e2e.py --site-workflow-only --addon-dir extension/release/0.3.3/addon
python extension/scripts/firefox-e2e.py --release-upgrade-only --release-baseline-version 0.3.2 --addon-dir extension/release/0.3.3/addon
python extension/scripts/firefox-e2e.py --release-upgrade-only --release-baseline-version 0.2.8 --addon-dir extension/release/0.3.3/addon
python extension/scripts/firefox_compact_home.py --friendly-sites-only --signed-baseline 0.3.2 --addon-dir extension/release/0.3.3/addon
python extension/scripts/firefox-e2e.py --clock-recovery-only --addon-dir extension/release/0.3.3/addon
python extension/scripts/firefox-e2e.py --internal-fault-only --addon-dir extension/release/0.3.3/addon
```
