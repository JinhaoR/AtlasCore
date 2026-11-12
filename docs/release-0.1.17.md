# Atlas Firefox 0.1.17 release candidate

Prepared for separate unlisted signing on 2026-10-26. This update packages the
reviewed storage reliability repair while preserving 0.1.16's UI stability,
downloads, Greylist, Vault, Journey and Home organization behavior.

## What went wrong in 0.1.16

A failed saved-state write correctly paused authorization. However, the adapter
continued making ordinary checks against the unavailable controller; those checks
could not restore it. One transient aborted write could therefore leave every
website blocked until **Reload and reconcile state** was selected. The Whitelist
had not disappeared: Atlas could no longer verify permission to use it.

Ordinary state reads also unnecessarily opened strict write transactions, because
the same code supported an older storage migration. Frequent background checks
created avoidable write transactions. The old diagnostics discarded the underlying
storage error, reporting only `WRITE_FAILED`.

The persistent outage was reproduced by aborting a real IndexedDB transaction in
an isolated Firefox profile running preserved 0.1.16. The specific cause of the
user's original write failure remains unknown; disk quota exhaustion was not
established. The [technical report](firefox-storage-reliability.md) and its
[development evidence](evidence/firefox-storage-reliability.json) record the
original investigation separately from this release's checks.

## Implemented solution

- Ordinary loads use readonly transactions. Actual saves and the existing legacy
  migration remain strict and atomic.
- After a confirmed aborted write with an eligible transient cause, the adapter
  makes one recovery attempt through the same Core controller. It reloads and
  validates complete saved state and acknowledges any recovery save before
  retaining authorized pages. A failed attempt cannot become an endless retry loop.
- Greylist and Vault confirmations are never replayed. Requests, grants and
  proposal deadlines are not renewed. Unknown outcomes, corrupt state, quota
  failures and persistent errors remain blocked under the existing recovery rules.
- Local diagnostics expose safe storage cause codes and transaction counters,
  without raw exception messages, private URLs or credentials.

Core recovery ends active Journeys when their bindings are lost; this update does
not revive them. After a genuine storage interruption, an authentication Journey
may still need restarting from its trusted root. Commit receipt history remains
unbounded: compaction requires a separate design preserving reconciliation and
replay guarantees. This is a remaining capacity risk, not the proven incident cause.

## Compatibility and artifacts

The extension ID remains `atlas-development@atlas.invalid`; Core stays at 0.1.0
and authority schema at 2. Permissions and saved-state formats are unchanged.
There is no policy reset, new default list or exceptional Whitelist migration.
Existing destinations, pins, Home layout, settings and batch drafts remain compatible.
Signed 0.1.13-0.1.16 artifacts, installed Firefox and enterprise policies are preserved.

`extension/release/0.1.17/` contains:

- `atlas-0.1.17-unsigned.zip`: the Mozilla submission package.
- `atlas-0.1.17-source.zip`: reviewer source, regression tests, lockfiles, build
  instructions and the storage reliability report.
- `release.json`: source/runtime/archive hashes and lint findings.
- `addon/`: the staged runtime used for isolated native verification.

[Release evidence](evidence/firefox-release-0.1.17.json) records final artifact
hashes, test results, source reproduction and native checks. Archives stay local
under the ignored release directory; source and documentation remain reviewable
in Git. An unsigned ZIP is not a permanent Firefox installer.

## Verification

- **204/204 Core tests and 391/391 extension tests** pass, without skips or
  failures, including 17 storage reliability and 23 release/integrity tests.
  Both TypeScript checks and the development build pass.
- The 14-file staged runtime and 150-file reviewer source archive validate.
  A fresh extraction, with offline lockfile installs from the existing npm cache,
  reproduces both ZIP hashes exactly.
- Mozilla lint reports zero errors, zero notices and the existing
  `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` warning. Desktop Firefox is
  the supported target; Android remains untested.
- Isolated Firefox 158.0.1 passes the seven storage recovery groups and nine
  batch/Vault groups, including three full browser restarts, against the staged
  0.1.17 runtime. Native fixtures use synthetic sites and no real accounts.
- Nine additional staged UI/Journey interaction groups pass, including retained
  exact entry points, out-of-order replies, failed saves, toolbar reuse and the
  60-second passive Journey indicator with its original deadline.
- All 76 preserved files across signed 0.1.13-0.1.16 and all 23 Core source files
  retain their pre-preparation hashes. All four older signed XPIs verify offline.
  The manifest's only semantic change is its version.

This is release-candidate evidence, not a claim of week-long production use or
permanent signed installation. Signing and installation remain separate steps.

## Signing and updating

Use the [release guide](firefox-private-release.md#obtain-the-signature) to provide
credentials locally. Do not put secrets in files, Git or chat.

```powershell
npm.cmd --prefix extension run release:validate
# With credentials set in your terminal, submit once when ready:
npm.cmd --prefix extension run release:sign
# After Mozilla returns the signed XPI:
npm.cmd --prefix extension run release:verify-signed -- 0.1.17
```

If submission times out after upload, check Mozilla's dashboard before retrying.
Do not rebuild or resubmit a signed version to fix a verifier problem.

Back up before updating, then install the verified signed XPI in place under the
same ID and existing enterprise deployment path. **Do not uninstall Atlas.**
The [Windows deployment tool](windows-deployment.md) is a separate post-signing
step; preparation does not run it. See [backup guidance](firefox-backup.md).

After signing, backup and fully closing Firefox, the existing managed installation
can be checked and updated from the repository root:

```powershell
.\scripts\deploy-atlas.ps1 -Version 0.1.17 -WhatIf
.\scripts\deploy-atlas.ps1 -Version 0.1.17
```

After update, check Settings -> Diagnostics for **0.1.17**, verify your existing
policy/pins/drafts, and exercise normal Whitelist and Greylist access. If storage
fails again, record the safe cause in Policy & recovery and Navigation diagnostics;
do not clear Atlas data. Synthetic abort tests cannot establish physical
power-loss durability or guarantee recovery from every Firefox/disk failure.
