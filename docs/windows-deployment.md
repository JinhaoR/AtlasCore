# Local Windows deployment of signed Atlas

Deployment is separate from building and signing. `scripts/deploy-atlas.ps1`
updates the existing enterprise-managed XPI; it never installs policies, touches
profiles, signs a release, or changes Atlas authority. The permanent ID remains
`atlas-development@atlas.invalid`.

## Design

The read-only preflight calls the existing `verifySignedRelease` implementation
against frozen release artifacts. A small Node bridge returns the verified file,
its SHA-256 and embedded identity/version to PowerShell. Firefox still performs
cryptographic signature verification when it loads the package.

The existing policy must use `force_installed` and a local file URL targeting
`distribution/atlas.xpi` in the selected Firefox installation. The script does
not create or edit policy. Firefox must be fully closed. Versions are compared
as three numeric components; downgrades and different bytes at the same version
are rejected. An exact match is a read-only no-op.

UAC receives a hash-bound plan after preflight. The elevated helper checks the
tool files under held read-only handles, repeats offline verification, and checks
that source, target and
policy still match that plan. It uses encoded data rather than interpolating
paths into executable command text. No permanent elevated process is created.

The writer holds an exclusive deployment lock, preserves a verified versioned
backup, stages on the destination filesystem, verifies the staged bytes and
uses `File.Replace` for an existing package (`File.Move` for a missing package).
There is no direct-overwrite fallback. Success requires the final source hash.
Atomic replacement makes interruption leave either the old or new package;
rerunning verifies that state and reuses only an identical backup. A failed
post-replacement check attempts an atomic restoration from the verified backup
only while the observed target remains unchanged. Restoration concerns the
on-disk package, not Firefox activation or storage rollback.

## Prerequisites and commands

Use Windows PowerShell 5.1 or PowerShell 7, Node 24+, and the repository's existing
extension dependencies (`npm.cmd --prefix extension ci` if not installed). The
requested release must already contain its frozen `addon/`, unsigned ZIP, source
ZIP, `release.json`, and exactly one downloaded lowercase `.xpi` under `signed/`.
No Mozilla credentials are needed. The script never builds or retrieves a release.

Close Firefox completely and back up the live Atlas configuration using
[the existing backup procedure](firefox-backup.md). From the repository root:

```powershell
.\scripts\deploy-atlas.ps1 -Version 0.1.16 -WhatIf
.\scripts\deploy-atlas.ps1 -Version 0.1.16
```

The version is an example: 0.1.16 must first exist as a signed release. You can
optionally run `npm.cmd --prefix extension run release:verify-signed -- 0.1.16`;
deployment independently repeats that same verifier.

Normal invocation requests standard Windows UAC when necessary. The short-lived
helper runs hidden, repeats verification and returns an exit status; the original
terminal checks final hashes and prints the result. Cancelling UAC changes nothing.
The child preserves the caller's effective execution policy; no saved execution
policy or filesystem permissions are changed. If elevation fails, open PowerShell
as Administrator and run the same command for detailed errors.

If Windows refuses local scripts with “running scripts is disabled”, explicitly
allow local scripts for this invocation only (unless organizational policy forbids
it):

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\deploy-atlas.ps1 -Version 0.1.16
```

The script does not set this policy automatically. Review downloaded scripts and
resolve any Internet-zone signature warning before proceeding; enterprise script
restrictions still apply.

The default installation is `$env:ProgramFiles\Mozilla Firefox`. For another
existing managed installation, use `-FirefoxDirectory 'D:\Apps\Mozilla Firefox'`.
Use `-NodePath 'C:\Path\To\node.exe'` if Node is not on PATH. Paths with spaces are
supported. Network paths, alternate streams and reparse-point ancestors are
rejected. An alternate directory still requires a genuine verified signed release
and an existing compatible policy; it cannot make an unsigned package acceptable.

`-WhatIf` performs read-only checks and reports proposed backup/replacement actions.
It creates no file or directory and never requests UAC. A running Firefox blocks
replacement even in preflight; an already matching package is a safe no-op.

## Backups, interruption and failure

The previous package is preserved at:

```text
<FirefoxDirectory>/distribution/atlas-backups/atlas-<old-version>-backup.xpi
```

An existing identical backup is reused; a different backup at that name stops the
operation without overwriting it. Keep backups until the updated extension and
your data are verified. First deployment to a missing XPI creates no old-package
backup; it still requires the existing correct policy.

The persistent `.atlas-deploy.lock` file is a synchronization marker. Its open
exclusive handle prevents simultaneous deployments; a leftover closed lock file
does not block recovery. Unique `.atlas-stage-*.xpi`, `.atlas-backup-*.tmp` and
`.atlas-restore-*.xpi` files from an interrupted process are never used as authority.
Rerun the command: an old package resumes using its verified backup, and an exact
new package is recognized without another replacement or backup. Abandoned temp
files may be removed manually with Firefox closed and no deployment in progress;
the script only cleans files belonging to its own invocation.

If copying, backup or atomic replacement fails, the error identifies the stage
and observed on-disk state. The script never falls back to directly overwriting
`atlas.xpi`. On a failed final content check, it attempts verified atomic
restoration only if this invocation replaced the file and the observed target
has not changed again. A failed restoration is reported explicitly. A hidden
elevated helper failure also reports which old/new bytes the parent can verify;
rerun in Administrator PowerShell for the detailed underlying error.

Storage/filesystem errors or an unrecognized current XPI require investigation;
they are not repaired by creating policy or deleting state. This tool coordinates
its own writers and locks source/policy during copying. It cannot prevent Firefox
being launched at precisely the wrong moment or defend against an independent
privileged writer. Keep Firefox closed throughout the update. Atomicity depends
on Windows filesystem support, and simulated process termination is not proof of
physical power-loss durability.

Restoring an older XPI is not a guaranteed Firefox downgrade or a storage rollback,
especially after extension storage migrations. The normal script rejects
downgrades. Preserve a private live-data backup before significant updates and
investigate recovery deliberately; do not uninstall Atlas as a shortcut.

## Recognizing success

“Deployed successfully on disk” means the final XPI SHA-256 equals the release
verified before and after UAC, and `policies.json` is unchanged. It does not mean
Firefox has activated the new version. Restart Firefox and check:

- `about:addons` shows the requested Atlas version, enabled.
- `about:policies` has the intended active policy and no errors.
- Atlas's settings, destinations, pins and drafts are intact.

If Firefox still shows an old version, first verify that all Firefox processes
were closed, that the selected installation is the one you launch, and that its
active enterprise policy points to this exact local XPI. Rerun `-WhatIf` to compare
the managed package. Check Firefox's policy/add-on errors. Do not uninstall,
delete profiles, or change the extension ID to force an update.

Mozilla documents updates by the XPI's internal version under
[ExtensionSettings](https://firefox-admin-docs.mozilla.org/reference/policies/extensionsettings/).
Elevation uses Microsoft's
[Start-Process RunAs](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process),
and same-volume replacement uses
[File.Replace](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.replace).

## Tests

Run from the repository root, with the existing signed 0.1.14/0.1.15 artifacts and
dependencies available:

```powershell
node --test scripts/tests/deployment.test.mjs
node --test extension/tests/release.test.mjs
```

The deployment suite creates fixtures under `.tools/deployment-tests-*`, calls
native PowerShell, verifies real signed releases, and uses mock privilege/process
boundaries for writes and UAC failures. Replacement/copying/hashing use the real
Windows filesystem. Process-interruption tests exit isolated fixture processes
before and after replacement, then retry. No test targets the installed Firefox
directory or a browser profile. Set `ATLAS_TEST_POWERSHELL` to a PowerShell 7
executable to repeat the same suite under that host.

Interactive UAC, the real protected installation and subsequent Firefox activation
are intentionally outside this implementation's test run. PowerShell 7 and physical
power-loss behavior need separate verification where those environments are used.

### Verification recorded for this task

Windows PowerShell **5.1.26100.9444** and Node **24.12.0** pass 35 deployment
regressions: a complete 34-test run plus a focused native bootstrap probe added
afterward. That probe executes the real encoded helper with read-locked tools in
an ordinary child process and a matching-package fixture; it never requests UAC
or replaces a package. The existing **204 Core** and **352 extension** tests also pass,
including all 23 release-verification regressions, without rebuilding runtime or
release assets. Both PowerShell files parse without errors. SHA-256 checks preserve
all **57** existing release files across 0.1.13, 0.1.14 and 0.1.15, all 23 Core
source files, the manifest and original release verifier. The real signed 0.1.15
XPI is verified offline at SHA-256
`393455a5123b908430a83298c7608cfbaa8a8a1417fa2ba1f8835ab5bb595627`.

The live Firefox installation, enterprise policy, profile and Atlas storage were
not modified or used as deployment targets. No Mozilla submission, signing,
version bump, browser launch or restart was performed.
