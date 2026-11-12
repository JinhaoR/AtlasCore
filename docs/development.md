# Development and verification

Use Node 24, the locked dependencies and the existing two packages. No new test
framework is needed. `extension/dist` and `packages/core/dist` are generated and
tracked; do not edit them by hand. Never use a signed release directory as output.

## Find the change

| Task | Start here | Test families |
| --- | --- | --- |
| Permission or state transition | `packages/core/src/{evaluate,access,vault,journey,download,atlas-planner}.ts` | matching domain tests; `atlas`, `controller`, failure tests |
| Persistence/upgrade/recovery | Core controller; `extension/src/storage/indexeddb-repository.ts`, `background/startup.ts`, `presets/curated-upgrade.ts` | repository, curated-upgrade, startup/storage-reliability; matching native upgrade/recovery |
| Firefox navigation | `extension/src/adapter/firefox-adapter.ts`; Journey/download contracts | adapter, journey*, root-departure, download, authorization failure tests; matching native flows |
| Access summaries | `adapter/temporary-access.ts`, `ui/home-access.ts`, `ui/presentation.ts` | temporary-access, home-organization, productization |
| Destination editing | `ui/sites.ts` coordinates; `destination-editor.ts` owns form DOM/caret/scope copy; `destination-draft.ts` derives candidates; `destination-workspace.ts` owns local save/reconciliation; `draft-storage.ts` owns IndexedDB | destination-batch, editor*, whitelist-removal, subdomain* |
| Home/layout/search | `ui/main.ts`, `home-model.ts`, `home-organization.ts`, `home-layout*.ts`, `destinations.ts`; `destination-cards.ts` owns launcher/icon lifecycle | home*, navigation*, ui-stability, ui-performance, website-icons |
| Diagnostic evidence | `adapter/runtime-diagnostics.ts` owns bounded faults; `storage/runtime-journal.ts` retains sanitized incident data; `ui/diagnostics-panel.ts` owns refresh/export | runtime-diagnostics, runtime-journal, diagnostics-panel, controller-fault; native internal-fault |
| Shared UI appearance | [theme contract](themes.md), `ui/assets/themes/`, `ui/assets/style.css`, `dom.ts`, `feedback.ts` | affected interaction tests and native screenshots/width checks |
| Packaging | `scripts/release.mjs`, release guide | release, distribution; separate authorized release validation |

The [everyday controls](everyday-controls.md) add a small read-only toolbar popup.
It reuses/opens the control page for actions, with a closed navigation contract;
it is not a second policy/editor state system. The content Journey indicator
remains read-only. `bookmarks/owner.ts` serializes optional native bookmark sync
and participating presentation writes; it has no Core controller access.

The page's single `RefreshLoop` owns visible-page scheduling; `main.ts` projects
the authoritative view. Extracted UI owners never start another polling loop.
Cards release icon observers/listeners/object URLs on page disposal. Diagnostics
fence obsolete replies independently; the editor updates existing fields only
when the workspace editor changes. Routine Sites feedback stays local, while
errors keep the existing actionable treatment. See the
[quality pass](quality-pass-0.1.19.md) for the interaction changes and evidence.

Core `atlas-equality.ts` compares only validated, owned domain data. Its identity
shortcut is safe for immutable subtrees, not unvalidated repository values or
cached authorization. Shallow wrapper freezing in the controller relies on the
snapshot validator's deep-copy/deep-freeze guarantee. Preserve those boundaries.

## Verification tiers

**Focused iteration:** build once, then run the affected files directly. Example:

```text
npm --prefix extension run build
node --test extension/tests/temporary-access.test.mjs extension/tests/home-organization.test.mjs
```

The extension build already builds Core and runs both TypeScript compilers before
bundling/asset verification. Do not immediately run three more builds of unchanged
sources. After any source change, rebuild before tests: Node tests import `dist`.
For Core-only work, `npm --prefix packages/core test` is sufficient during iteration.

**Subsystem completion:** add neighboring regression families and relevant failure,
conflict, unknown-write, staleness, restart and managed-precedence cases. Use the
native scenario for browser-dependent effects. A label/style-only change normally
does not need every authenticated navigation/upgrade fixture; an authorization
change does. The task's explicit required checks still take precedence.

**Cross-subsystem pass/release:** run both complete suites and type checks. The
original commands remain self-contained and release validation is unchanged:

```text
npm --prefix packages/core run typecheck
npm --prefix extension run typecheck
npm --prefix packages/core test
npm --prefix extension test
```

When both packages have just been built from the current sources, the optional
`npm --prefix packages/core run test:built` and
`npm --prefix extension run test:built` run full suites without rebuilding. These
are developer conveniences, not substitutes for release source reproduction,
archive/hash checks or required native release tests.

## Native work and measurement

`python extension/scripts/firefox_compact_home.py --curated-scopes-only
--signed-baseline 0.2.7` verifies the bundled-scope upgrade in an isolated Firefox
profile, including saved policy/settings/pins/named pages/layout/draft preservation,
plain child grouping, Google Greylist enforcement and a full restart. Unit/storage
coverage is in `curated-scopes.test.mjs`; see [the contract](curated-subdomains.md).

`python extension/scripts/firefox_compact_home.py --polish-only --signed-baseline
0.2.2` checks the current rendering polish in a disposable Firefox profile.
`--polish-baseline` reads `.tools/ui-polish/checkpoint.zip`. It instruments only its
copied runtime: first-frame rectangles, render work, retained DOM, countdown
transitions and reload routes. See [results](evidence/ui-polish/README.md).

`--startup-layout-only --addon-dir <runtime>` exercises the
[0.2.1 repair](startup-layout-0.2.1.md). The harness copies that runtime into its
new disposable directory before adding a head probe: controlled
credential-free icon responses, geometry/timing samples and a separate delayed
first-reply screenshot case. Do not copy probes into production. The baseline
flag records old geometry without asserting the repair. Native wheel, fine-delta,
keyboard, modal/failure/retry and real zoom checks are distinct from physical
trackpad or screen-reader verification. `--release-upgrade-only
--release-baseline-version 0.2.0` uses signed 0.2.0 for 0.2.1 compatibility checks.

`--history-navigation-only` repeats just the 0/2500-history, fifteen-navigation
measurement from the quality fixture. Use fresh profiles, the same Home viewport,
serial A/B/B/A ordering and a preserved runtime for the checkpoint. Its 100 ms
observation polling is not a page-load benchmark. `--release-upgrade-only` seeds
real policy/settings/drafts on signed 0.1.19, overlays the chosen candidate across
full restarts, then omits the temporary overlay to verify rollback to that signed
baseline without uninstalling or changing an everyday profile.

`--management-ux-only` exercises the 0.2.0 directory/detail/editor, acknowledged
display save, multi-change review, draft-save failure/retry, history/reload,
real Vault wait and explicit confirmation, Settings sections and native zoom.
See [the capability inventory and evidence](management-ux-0.2.0.md). Run the
existing destination-batch and Home-organization fixtures for conflicts and full
process restart. Wait for the UI's committed fixture revision before opening an
editor; readiness of the background alone does not establish its UI baseline.

For the 0.2.0 presentation pass, `--visual-redesign-only` records actual Home,
category, directory, Vault, settings and access screenshots, matched navigation
timings, idle mutations/writes, pin overflow/reload, 30-category stress and zoom.
Use `--visual-redesign-baseline --addon-dir <preserved-runtime>` for the before
comparison. Fixture-only fault injection never enters shipped bundles.

The scenario flags in `python extension/scripts/firefox-e2e.py --help` select
isolated profiles; their implementations are `firefox_*.py`. Read the owning
contract for the right flag rather than running every historical scenario.
Some fixtures intentionally wait through real Vault/Greylist windows: those
seconds verify behavior and must not be reported as build time or optimized away.
The harness still has accumulated shared setup assumptions; do not fix those by
loosening assertions about authority.

The final quality pass uses `--quality-pass-only` for consecutive edits,
keyboard/zoom/save-failure checks and matched navigation measurements. Use
`--quality-pass-baseline --addon-dir <preserved-development-runtime>` for its
pre-change run. `--long-reliability-only --extended-reliability` adds ten minutes
of interleaved idle/navigation/Greylist/Journey work with 100,000 synthetic
receipts. `--internal-fault-only` checks injected failures and diagnostic retention
across background restart. Do not run performance comparisons concurrently with
another heavy test. Preserve small results/screenshots, then remove only the
task-created disposable profiles after verifying paths; do not accumulate them
in `.tools` or delete unrelated developer tools.

For matched numeric performance runs:

```text
node extension/scripts/instrument-ui-performance.mjs extension/dist .tools/my-review-before
python extension/scripts/firefox-e2e.py --engineering-review-only --engineering-review-baseline --addon-dir .tools/my-review-before
python extension/scripts/firefox-e2e.py --performance-audit-only --addon-dir .tools/my-review-before
node extension/scripts/benchmark-controller.mjs packages/core/dist .tools/controller-timing.json
```

Preserve that copy before edits; build and instrument a distinct after-copy. Run
the same scenarios with the same fixtures, omit the baseline flag for final
assertions, and record counts as well as timing. Do not run competing benchmarks
at the same time. The instrumenter changes only the supplied disposable copy.
Process CPU/private-byte samples and inclusive function timings are not a sampled
Firefox CPU profile or a retained-heap analysis. Record that limitation.

Keep sanitized evidence under `docs/evidence`; logs and profiles belong in ignored
`.tools`. Verify named cleanup paths are inside `.tools`, reject reparse points,
and remove only task-created profiles/copies after saving evidence. `.tools` is
not extension runtime state and must never be shipped or copied to another app.
