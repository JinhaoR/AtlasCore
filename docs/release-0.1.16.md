# Atlas Firefox 0.1.16 release candidate

## Included changes

- Stable Home cards, pins, category controls, search and Sites editor DOM across
  unchanged refreshes. Existing selections, focus and entry points are retained.
- Coalesced control-page refreshes and presentation repository reads. Read-only
  retry no longer starts additional recurring polling loops.
- Frozen Vault reviews stay visible across transient housekeeping; Core still
  determines readiness and requires explicit confirmation and successful storage.
- Temporary-access rows update independently. Journey countdowns use the existing
  background observation heartbeat without a second content-script polling loop.
- Display-only recovery waits for verified authority and preserves failed drafts.

The [UI stability report](ui-stability.md) records reproduced causes, native
measurements, new tests and limits. Downloads, Greylist, Journey authentication,
protected timings, Milestones A–D and batch/Vault recovery remain included.

## Compatibility

The extension keeps `atlas-development@atlas.invalid`, Core version 0.1.0,
authority schema 2, permissions and existing storage formats. The manifest's only
semantic change from 0.1.15 is its version. No authority reset, new trust model or
permission migration is introduced. Saved policy, settings, destination metadata,
drafts, pins and Home layout remain compatible. Presentation cannot grant access.

Signed 0.1.13, 0.1.14 and 0.1.15 artifacts remain frozen. No private profile or
saved authority is bundled; the approved first-run preset applies only to genuinely
empty installations. No ordinary Firefox profile or enterprise policy is changed.

## Artifacts

`extension/release/0.1.16/` contains:

- `atlas-0.1.16-unsigned.zip`: runtime package for Mozilla unlisted submission.
- `atlas-0.1.16-source.zip`: exact TypeScript, tests, pinned dependencies, assets,
  build scripts, UI stability report and reviewer instructions.
- `release.json`: every source/runtime hash, both archive hashes and lint report.
- `addon/`: staged runtime for isolated Firefox verification.

[Package evidence](evidence/firefox-release-0.1.16.json) records final digests,
regression checks, source reproduction and staged native verification. Preparation
does not submit, sign, install or deploy. An unsigned ZIP is not a permanent
Firefox installer.

## Verification

- Core **204/204** and extension **374/374** tests pass without skips, including
  23 release/integrity regressions. Both TypeScript checks and the development
  and release builds pass.
- The 14-file runtime and 148-file reviewer archive pass integrity validation.
  A fresh source extraction with locked offline installs reproduces both archive
  SHA-256 hashes exactly.
- Mozilla lint reports zero errors, zero notices and the existing
  `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` warning. Desktop is the target;
  Android remains untested.
- Native Firefox 157.0.1 passes nine interaction groups against the actual staged
  runtime: stable cards/entry points, unchanged storage notifications, delayed
  and failed replies, draft/caret retention, one refresh timer, diagnostics scope,
  acknowledged save recovery, toolbar reuse and a 60-second passive Journey
  indicator with unchanged Core deadline.
- All 57 preserved files across signed 0.1.13–0.1.15 and all 23 Core source files
  retain their pre-preparation hashes. All three older signed XPIs verify offline.

The earlier development report separately records five 60-second idle probes,
14 Home organization/restart groups and nine batch/Vault recovery groups with
three full restarts. These runs establish the completed UI milestone; they are
not presented as repeated 0.1.16 staged-runtime runs.

## Sign, verify and update

Use the credential handling in the [release guide](firefox-private-release.md#obtain-the-signature).
Keep credentials out of Git, files, logs and chat. When ready to submit:

```powershell
npm.cmd --prefix extension run release:validate
npm.cmd --prefix extension run release:sign
# After Mozilla returns the signed XPI:
npm.cmd --prefix extension run release:verify-signed -- 0.1.16
```

If signing times out after upload, check Mozilla's dashboard before retrying.
Never rebuild a signed version to fix a verifier error; use read-only offline
verification against the preserved archives, staged assets and downloaded XPI.

Back up before updating, then replace the verified signed XPI in place using the
same extension ID and existing enterprise deployment path. Do not uninstall Atlas.
The separate [Windows deployment tool](windows-deployment.md) can validate and
replace the managed package after signing; it is not run during preparation.
Verify saved policy/settings, pins/drafts, Home layout and Greylist/Journey flow
after installation and restart. See [backup guidance](firefox-backup.md).

## Remaining limits

Native evidence uses disposable Firefox 157.0.1 profiles and synthetic sites.
Permanent 0.1.16 installation awaits Mozilla's signed XPI. Real account flows,
Android, screen-reader conformance, OS forced colors and physical high-density
displays remain unverified. The existing [download limitations](firefox-downloads.md)
remain in force. Mutation and explicit geometry-call measurements do not establish
CPU, heap or all browser layout costs. Intermittent collapse/caret failures were
not independently reproduced in the baseline; verified interaction regressions
are documented without claiming a universal fix.
