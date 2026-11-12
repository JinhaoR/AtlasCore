# Atlas Firefox 0.2.2 signing candidate

Unsigned candidate for unlisted Mozilla signing. Extension identity remains
`atlas-development@atlas.invalid`. Signed 0.2.1 and all older release artifacts
are frozen. Preparation does not submit, sign, deploy or alter the everyday profile.

## Changes from signed 0.2.1

- Destination directory rows size to their contents in the scrolling pane,
  preventing icons and text from overlapping when Firefox constrains the viewport.
- Home and directory display evaluation normalize the policy once per collection
  through Core's stateless `evaluateMany` API. It shares the individual evaluator's
  decision logic. Directory filters reuse display outcomes only while the existing
  policy/metadata key matches; opening sites still uses the controller.
- Initial reads use existing status and category placeholder feedback. The recovery
  banner appears for actual unavailable results. Saved Home layout loads before
  categories render, preventing a flash of default ordering or visibility.

The [engineering report](ui-engineering-review.md) records repeated native
measurements: directory rendering 96–103ms to 13–14ms, warm Home opening 144ms to
64–72ms. These are controlled development measurements, not universal timing
guarantees. Cold-install startup remained variable. Existing icon nodes/cache
already avoided repeated fetches in the tested workflows and are retained.

There are no new permissions, dependencies, policy defaults or migrations.
Authority schema, protected settings, exact hostname rules, optional scopes,
managed precedence, Greylist, Vault, Journey and Download Intent semantics remain.
The homepage and new-tab manifest overrides retain relative `ui/index.html` paths.
Policy revisions, deadlines and failed/unknown commit handling are unchanged.

## Compatibility and limits

Release verification uses signed 0.2.1 plus the candidate as a temporary overlay
in a disposable Firefox profile, followed by full restart and rollback without
uninstalling the baseline. It checks saved policy/Blacklist, configuration, pins,
categories/layout, staged/raw drafts and pending Vault/request/grant deadlines.
This tests stored-data compatibility; it is not a permanent unsigned install or
a substitute for checking Mozilla's eventual signed output.

The historical intermittent INTERNAL_ERROR remains unresolved. This release does
not claim to diagnose it, add automatic recovery or establish multi-day reliability.
New documents can briefly show fallback icons while cached bytes resolve. Native
Windows evidence does not certify other platforms, physical trackpads,
screen-reader conformance or every live website's favicon behavior.

Firefox owns homepage/new-tab notices and session-restore settings. Choose
**Keep Changes** if Firefox presents an override notice. To open Atlas Home on
normal launch, disable **Open previous windows and tabs**; session restore instead
restores previous tabs. See [the integration report](firefox-home-newtab-poc.md).

Package validation and current dependency-audit results are recorded separately
in [release evidence](evidence/firefox-release-0.2.2.json). No dependency upgrades
are bundled with these focused changes.

## Artifacts and signing

`extension/release/0.2.2/` contains:

- `addon/`: allowlisted production runtime.
- `atlas-0.2.2-unsigned.zip`: package for Mozilla.
- `atlas-0.2.2-source.zip`: reviewer sources, tests, locked tools and notices.
- `release.json`: source/runtime/archive SHA-256 receipt.

The reviewer source must reproduce both ZIPs and the receipt. Development maps,
native fixtures and test instrumentation are excluded from the runtime; bounded
production diagnostics are retained. All prior releases remain unchanged.

After separate signing authorization, from the repository root with Mozilla
credentials securely supplied in `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET`:

```powershell
npm.cmd --prefix extension run release:validate
npm.cmd --prefix extension run release:sign
```

The signing command submits to Mozilla's unlisted channel. Expected signed output:
`extension/release/0.2.2/signed/*.xpi`. No signing command is run during preparation.
After it finishes, verify locally without credentials:

```powershell
npm.cmd --prefix extension run release:verify-signed -- 0.2.2
```

Deployment is separate. Back up and update in place under the same identity; do
not uninstall, edit the downloaded XPI or replace saved policy with the preset.
