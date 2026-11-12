# Private Firefox releases (D32)

## 0.3.0 unsigned signing candidate

The user authorizes the Home/All Sites redesign and post-0.2.8 UI repairs as
unsigned 0.3.0. See [release notes](release-candidate-0.3.0.md). Full regressions,
package/lint validation, clean reviewer-source reproduction and isolated signed
0.2.8 upgrade/restart/rollback apply. Core, permissions, identity and storage
formats remain unchanged; the same 27-file runtime inventory applies. Signing,
submission, deployment and everyday-profile changes are separate actions.


## 0.2.7 unsigned signing candidate

The user authorizes packaging the completed Home motion/access overview and
navigation-failure presentation fixes. [Release notes](release-candidate-0.2.7.md)
describe scope and limitations. Signed 0.2.6 and all earlier artifacts remain
frozen. Full regressions, package validation/lint, clean reviewer-source
reproduction and isolated signed-0.2.6 upgrade/restart/rollback are required.
The existing toolbar-sync record is compatible in both versions. Preparation
never signs, submits, deploys or changes the everyday profile.

## 0.2.6 unsigned signing candidate

The latest user request authorizes packaging the completed interaction refinement
and toolbar-only bookmark connection. [Release notes](release-candidate-0.2.6.md)
describe unpin deletion, unchanged authority and the opt-in connection's downgrade
limitation. Signed 0.2.5 and all earlier files remain frozen. Required checks are
full regressions, package validation/lint, clean reviewer-source reproduction and
isolated upgrade/restart/rollback from signed 0.2.5. Rollback of a newly opted-in
toolbar connection is not claimed; the old build cannot read its extended record.
Preparation never signs, submits, deploys or changes the everyday profile.

## 0.2.5 unsigned signing candidate

The user authorizes packaging the completed Home category grid, local category
icons and direct Firefox bookmark connection. See [release notes](release-candidate-0.2.5.md)
and [verification evidence](evidence/firefox-release-0.2.5.json). Signed 0.2.4
and every older artifact remain frozen. The existing 27-file runtime inventory,
permissions, extension identity and Core are unchanged. A separate presentation
record stores category icon choices; existing layout and authority schemas stay
unchanged. Build/validate, clean reviewer reproduction and isolated signed-0.2.4
upgrade/rollback apply. No signing, submission, deployment or everyday-profile
changes occur during preparation.

## 0.2.4 unsigned signing candidate

The user authorizes packaging the completed everyday controls and rendering
polish. See [release notes](release-candidate-0.2.4.md) and
[verification evidence](evidence/firefox-release-0.2.4.json). Signed 0.2.3 and every
older artifact remain frozen. Optional `bookmarks` is requested only on connection;
required permissions, identity and Core semantics are unchanged. The versioned
runtime inventory adds only the popup HTML/CSS/JS and the small startup script.
Build, validation, clean-source reproduction and isolated upgrade/rollback apply.
No signing, Mozilla submission, installed-profile changes or deployment occurs.

## 0.2.2 unsigned signing candidate

The user authorizes packaging the completed rendering/architecture review as
unsigned 0.2.2. It includes content-sized directory rows, stateless batch display
evaluation and stable loading/layout presentation. See the
[release notes](release-candidate-0.2.2.md), [engineering report](ui-engineering-review.md)
and [verification evidence](evidence/firefox-release-0.2.2.json).
Signed 0.2.1 and every prior release remain frozen. The established build,
validation, clean reviewer reproduction and isolated upgrade/rollback checks apply.
Preparation does not authorize Mozilla submission, signing or deployment.

## Preserved 0.2.1 candidate (subsequently signed)

The user authorizes the focused startup/viewport repair and the verified
[Home/new-tab overrides](firefox-home-newtab-poc.md) as an unsigned 0.2.1
candidate. The later signing-preparation request promotes the previously separate
manifest-only experiment; no new permissions or authority behavior are added.
Signed 0.2.0 and all prior release files are frozen. See
[release notes](release-candidate-0.2.1.md), [repair contract](startup-layout-0.2.1.md)
and [package evidence](evidence/firefox-release-0.2.1.json). The existing release
build/validate, clean reviewer reproduction and offline signed verification
processes remain unchanged. Preparation does not authorize signing, submission,
deployment, enterprise-policy changes or access to the everyday Firefox profile.

## Preserved 0.2.0 signing candidate (subsequently signed)

The user authorizes preparation and validation of the unsigned 0.2.0 candidate,
including isolated upgrade from signed 0.1.19 and rollback to that signed baseline.
[Release notes](release-candidate-0.2.0.md) describe changes, compatibility,
remaining limitations and the exact separate signing command.
[Verification evidence](evidence/firefox-release-0.2.0.json) records the package,
reviewer rebuild, repeated navigation measurements and isolated Firefox checks.
All prior release files remain frozen. Preparation never submits, signs, deploys,
changes browser policy or accesses the everyday profile.

0.2.0 adds exactly nine named local typography/notice/provenance files to the
runtime allowlist. Source archives admit only the six named WOFF2 files beyond
the existing source types. Runtime/source hashes still cover every asset; older
signed releases use their original fourteen-file allowlist for offline verification.

## 0.1.19 unsigned release candidate

The user authorizes final unsigned 0.1.19 preparation. See the
[release candidate](release-candidate-0.1.19.md) for changes, upgrade compatibility,
known limitations and exact later signing commands. Package validation evidence
is recorded in [release evidence](evidence/firefox-release-0.1.19.json).
Signed 0.1.13?0.1.18 remain frozen. Preparation does not authorize signing,
submission, installation, deployment, commits, pushes or normal-profile changes.
The intermittent INTERNAL_ERROR is not claimed fixed.

## Preserved signed 0.1.18: historical preparation

The user authorized unsigned **0.1.18** preparation on 2026-10-29. It includes the
[curated expansion](curated-expansion.md): **298 exact hosts across 123 services**,
one additive migration, [draft performance fixes](performance-audit-0.1.18.md),
and the [idle-authority follow-up](firefox-storage-reliability.md). The extension
ID remains `atlas-development@atlas.invalid`; Core, permissions, authority schema
and protected timing settings are unchanged.

The migration unions approved hosts with saved Whitelist entries, preserving
custom hosts, manual Blacklist, configuration, pins, categories and editable drafts.
It skips Blacklisted candidates and records a one-time atomic receipt. Previously
removed curated hosts may return in this explicitly approved expansion; later
removals stay removed. Both YouTube hosts are omitted from the new preset and
migration, without removing existing saved permissions. Adding hosts increments
the policy revision once; normal Core invalidation of old requests, grants,
proposals and Journeys still applies. No workflow is rebased or renewed.

The recovery change covers a reproduced readonly LOAD-abort latch and preserves
the last authority reason across Recovery. It does not establish the trigger of
the user's recovered 0.1.17 incident. Clock rollback checks, explicit confirmation
and conservative unknown-outcome handling remain unchanged.

Candidate artifacts belong in `extension/release/0.1.18/`: staged `addon/`,
`atlas-0.1.18-unsigned.zip`, `atlas-0.1.18-source.zip` and `release.json`.
[Release notes](release-0.1.18.md) describe update behavior and limits.
[Package evidence](evidence/firefox-release-0.1.18.json) records release validation,
artifact digests, reviewer-source reproduction and staged-runtime checks separately
from the already-passing development tests. Complete these package checks before
signing; development evidence alone is not a package verification result.

Signed 0.1.13-0.1.17 remain frozen. Preparation does not sign, submit, install,
deploy or modify enterprise policies. After separate Mozilla signing, verify the
returned XPI offline, back up and update in place under the same ID without
uninstalling. An unsigned ZIP is not a permanent Firefox installer. The existing
0.1.17 archives contain its earlier storage fix, not the new catalog or follow-up.

## 0.1.17 release (preserved)

The user authorized preparing **0.1.17** on 2026-10-26 after reviewing the
[storage reliability fix](firefox-storage-reliability.md). It replaces ordinary
strict write transactions with readonly loads and adds one verified recovery
after a confirmed transient aborted write, plus safe local failure diagnostics.
The same Core owner validates and saves recovery; no confirmation is replayed.

The candidate lives in `extension/release/0.1.17/`: `addon/`,
`atlas-0.1.17-unsigned.zip`, `atlas-0.1.17-source.zip` and `release.json`.
The reviewer archive includes the storage report and regression tests.
[Release notes](release-0.1.17.md) and [package evidence](evidence/firefox-release-0.1.17.json)
record verification. The extension ID, Core, authority schema, permissions, policy
preset and saved state formats are unchanged. No exceptional Whitelist migration
is included. Signed 0.1.13-0.1.16 artifacts remain frozen.

Preparation does not sign, submit, install or deploy. After separate signing,
verify the returned XPI offline, back up, and update in place without uninstalling.
This candidate was subsequently signed; its existing artifacts remain frozen.

## 0.1.16 release (preserved)

The user authorized preparing **0.1.16** on 2026-10-13. It packages the completed
[UI stability fixes](ui-stability.md), preserving 0.1.15 downloads and Milestones
A–D. Manifest/package/lockfile advance together; the ID remains
`atlas-development@atlas.invalid`. Permissions, Core version 0.1.0, authority
schema 2 and existing storage formats stay unchanged. No saved state is reset
or copied into the package. The signed 0.1.13–0.1.15 release files stay frozen.

The candidate lives in `extension/release/0.1.16/`: `addon/`,
`atlas-0.1.16-unsigned.zip`, `atlas-0.1.16-source.zip` and `release.json`.
The reviewer archive includes the UI stability report and regression tests.
[Release notes](release-0.1.16.md) and [package evidence](evidence/firefox-release-0.1.16.json)
record validation, archive reproduction and isolated staged-runtime checks.

This candidate was subsequently signed and used daily. Preserve its original
artifacts; use `release:verify-signed -- 0.1.16` for offline verification.
An unsigned ZIP cannot serve as a permanent Firefox installer.

## 0.1.15 release (preserved)

The user authorized preparing **0.1.15** for signing and an in-place update on
2026-10-12. Its existing manifest/package/lockfile version is retained. It includes
[bounded downloads](firefox-downloads.md), [Milestone C Home organization](home-organization.md)
and [Milestone D visual polish](visual-polish.md), preserving Milestones A/B.
The ID remains `atlas-development@atlas.invalid`, Core package version 0.1.0,
authority schema 2, required permissions and existing protected timing settings.
There is no authority reset or migration. Home layout uses its separate validated
presentation repository; prior destinations, pins, categories and drafts remain
compatible. Download Intents are ephemeral and are never restored after restart.

Artifacts are prepared in `extension/release/0.1.15/`: staged `addon/`,
`atlas-0.1.15-unsigned.zip`, `atlas-0.1.15-source.zip` and `release.json`.
[Package evidence](evidence/firefox-release-0.1.15.json) records artifact digests,
validation, fresh-source reproduction and native checks against the staged runtime.
This candidate was subsequently signed; its original artifacts remain frozen.
The signed 0.1.14 artifacts, installed profile and enterprise policies were preserved.

After Mozilla approval, run the offline verification against **0.1.15**, back up
before updating, and replace Atlas in place under the same ID. Keep the existing
enterprise deployment filename and location. Do not uninstall Atlas, replace its
saved policy with presets, or rename its deployment path as part of this update.
Signing and installation are not performed by release preparation.

## 0.1.14 release (preserved)

The user authorized packaging an update on 2026-10-11. Version **0.1.14** includes
Milestone A's reliable presentation saves, exact search, unavailable-state handling
and truthful feedback, plus Milestone B's persistent destination batches, one complete
Vault cycle, custom category identity and explicit stale/failed-save recovery.
The existing ID remains `atlas-development@atlas.invalid`. Core stays at 0.1.0;
authorization semantics, authority schema 2, permissions and protected timings
are unchanged. There is no authority migration or copied private browser state.
Existing policy, settings, pins and legacy destination metadata are retained;
new drafts use a separate version-1 presentation database.

The unsigned package, reviewer source and integrity receipt live in
`extension/release/0.1.14/`. Build and validation do not contact Mozilla. This
candidate was prepared for the separate unlisted signing step and was subsequently
signed. Its original artifacts remain frozen. The original signed 0.1.13
release and installed Firefox profile remain untouched. After signing, install
the update in place under the same extension ID; do not uninstall the old version
or edit a signed XPI. Preserve the existing enterprise deployment path.

[UI/batch evidence](evidence/firefox-destination-batch-milestone-b.json) records
the completed milestone tests. [0.1.14 package evidence](evidence/firefox-release-0.1.14.json)
records the new artifact hashes, release validation and isolated runtime checks.
The [batch contract](destination-polish.md#milestone-b-destination-batch-drafts)
owns storage compatibility and recovery details. No Milestone C work is included.

## Release contract

Atlas keeps Manifest V2, Firefox desktop 140+, and the existing identity
`atlas-development@atlas.invalid`. Despite its historical name, this ID is permanent;
development and signed builds use it. No Core, navigation, storage schema or Home
behavior changes are part of this milestone.

The existing esbuild pipeline gains a release mode. Development remains in
`extension/dist`; release staging and archives live in `extension/release/<version>`.
Release packaging admits only named runtime assets. Original TypeScript, pinned
dependencies, build scripts and reviewer instructions accompany the unsigned archive.
Validation checks identity, versions, assets, feed bytes and source/build correspondence.
Signing is a separate command fixed to Mozilla's **unlisted** channel. It accepts
credentials only through environment variables and never runs during build or tests.

Atlas's existing online icon lookup sends destination hostnames to websites and
Google's favicon service. Canonical-entry preparation contacts the requested public
hostname; the managed feed downloads public GitHub data. Therefore the manifest
declares required `browsingActivity`, rather than claiming no data transmission.
Firefox 140+ supplies installation consent. There is no Atlas telemetry backend.
See the [privacy notice](firefox-privacy.md) and
[Mozilla's declaration rules](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

Stable identity helps retain storage, but temporary removal can discard the internal
UUID, IndexedDB and local presentation preferences. Before replacing a temporary
installation, make a backup and preserve temporary storage. Restoration of policy or
timing settings must use existing Vault proposals, waits and confirmation. Never
import grants, proposals or live Journey bindings into another installation as new
authority. See the migration instructions below.

## Build and validate

Install Node.js 24 (tested: 24.12.0, npm 11.6.4). From the repository root:

```sh
npm --prefix packages/core ci
npm --prefix extension ci
npm --prefix extension run release:build
npm --prefix extension run release:validate
```

Use `npm.cmd` in PowerShell if execution policy blocks `npm.ps1`. The build compiles
both packages, checks pinned assets, runs Mozilla lint and produces:

```text
extension/release/0.1.19/
  addon/                          runtime only, manifest.json at root
  atlas-0.1.19-unsigned.zip       unsigned submission package
  atlas-0.1.19-source.zip         reviewer source and rebuild instructions
  release.json                   source/runtime/archive hashes and lint report
  signed/                        downloaded XPI after signing
```

Archives are ignored by Git; source, lockfiles and development `dist` remain tracked.
Allowed paths exclude profiles, local authority, credentials, maps and development
output. Validation rejects source/build/archive/version drift. Rebuild after edits
and retain matching archives/receipt together. ZIP timestamps are fixed.

The source ZIP includes Core, adapter, tests, lockfiles, assets, notices and
`extension/REVIEWER-BUILD.md`. Bundled TypeScript needs original source and build
instructions for review. [Mozilla source requirements](https://extensionworkshop.com/documentation/publish/source-code-submission/).

## Obtain the signature

1. Register or log in to the [Developer Hub](https://addons.mozilla.org/developers/).
   Complete Mozilla's account and distribution-agreement steps.
2. Generate credentials on the [API keys page](https://addons.mozilla.org/developers/addon/api/key/).
   JWT issuer is the API key; JWT secret is the API secret.
3. When ready to submit, set `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` in your
   terminal environment. Keep credentials out of Git, files, logs and chat.
4. Run `npm --prefix extension run release:sign`. It validates the release and invokes
   `web-ext sign --channel=unlisted`, attaching the matching source ZIP.
5. Find the signed `.xpi` in `extension/release/0.1.19/signed/` for this candidate.

PowerShell prompts keep the secret out of command history:

```powershell
$env:WEB_EXT_API_KEY = Read-Host 'Mozilla JWT issuer'
$atlasSigningSecret = Read-Host 'Mozilla JWT secret' -AsSecureString
$env:WEB_EXT_API_SECRET = [System.Net.NetworkCredential]::new('', $atlasSigningSecret).Password
try { npm.cmd --prefix extension run release:sign }
finally {
  Remove-Item Env:\WEB_EXT_API_KEY, Env:\WEB_EXT_API_SECRET -ErrorAction SilentlyContinue
  $atlasSigningSecret.Dispose()
}
```

Signing rejects extra options, disables config discovery and removes other `WEB_EXT_*`
overrides. Credentials stay in the child environment. Build/tests never submit.
Downloaded runtime is checked against release hashes, excluding Mozilla signature
metadata. Firefox verifies the actual signature during installation.
[Official signing guidance](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

If review outlasts the command timeout, check the Developer Hub before retrying;
Mozilla may already have accepted that version. Download it when ready. Do not
repeatedly submit a version or change ID to evade rejection. Unlisted releases still
undergo review. Missing credentials, validation and submission failures exit with errors.

## Install, restart and share

### Verify an already downloaded XPI offline

```sh
npm --prefix extension run release:verify-signed
# To check an older preserved release later:
npm --prefix extension run release:verify-signed -- 0.1.13
```

This command reads the existing XPI, unsigned/source ZIPs, staging and receipt. It
does not require credentials, access Mozilla, sign again, rebuild or modify artifacts.
Exactly one XPI must exist in that version's `signed/` directory. The saved receipt
must agree with both original ZIP hashes, every archived source file and every staged
runtime file. Identity/version and pinned feed checks remain enforced.

Post-sign staging may additionally contain `.amo-upload-uuid`, created by web-ext
as local upload bookkeeping. Only that exact staging filename is excluded; it is
still forbidden in unsigned/signed packages and pre-sign validation. Its contents
are not logged or treated as authorization.

This is verification of the preserved release, not the current working-tree source.
Verifier/test/documentation edits after signing must not invalidate an unchanged
download. Pre-sign `release:validate` continues rejecting working-tree source drift.
Never rebuild the already signed version or replace its receipt/source archive.

The 0.1.13 failure was a formatting-only change to `manifest.json` in the returned
XPI: 1,085 bytes became 1,263 bytes, with expanded JSON and normalized line endings.
All JSON values, ID, version and permissions were identical; the other 13 runtime
files had identical uncompressed SHA-256 hashes. The verifier already decompressed
ZIP entries, but incorrectly required identical manifest bytes too.

The narrow exception now permits only JSON whitespace outside strings in the signed
manifest, compared with the receipt-verified unsigned manifest. Changed JSON tokens,
string contents, fields, permissions, ID/version or any other runtime bytes fail.
Signature metadata is limited to `META-INF/manifest.mf`, `mozilla.sf`, `mozilla.rsa`
and the optional paired `cose.manifest`/`cose.sig`, following
[Mozilla's signing format](https://github.com/mozilla-services/autograph/blob/main/signer/xpi/README.md).
Unsafe/duplicate paths and unknown files are rejected. Archive order, compression
and timestamps have no authority. This checks payload integrity; ordinary Firefox
checks the cryptographic signature during installation.

1. Before replacing temporary Atlas, follow [backup and migration](firefox-backup.md).
2. In ordinary Firefox **desktop 140+**, open `about:addons`.
3. Choose gear → **Install Add-on From File**, then the signed XPI.
4. Accept its displayed access/data permissions if you want to use Atlas.
5. Check Home policy/settings; test Whitelist, Greylist wait/confirmation and login Journey.
6. Close all Firefox windows and reopen. Verify Atlas remains enabled and policy/timing
   settings survive. Grants keep their deadlines; old tab Journeys are not revived.
7. Give friends the signed XPI and privacy notice. They use the same menu without
   Node, source or credentials. Fresh installs receive the approved curated Whitelist;
   your private live state is never shipped.

Do not disable signature enforcement. Unsigned archives support submission and
temporary loading, not permanent ordinary-Firefox installation.

## Updates and development

For each new submission choose an unused increasing version:

```sh
# The unsigned 0.2.0 candidate uses its already-selected version.
# For later releases, first select an unused increasing version.
npm --prefix packages/core test
npm --prefix extension test
npm --prefix extension run release:build
npm --prefix extension run release:validate
# Separate authorized signing step; not part of preparation:
npm --prefix extension run release:sign
```

The version command synchronizes manifest/package/lockfile and preserves identity.
Candidate **0.2.0** already has its version; unsigned archive preparation is
authorized separately from signing and installation. Check its package evidence
before signing. Do not rebuild or resubmit signed 0.1.13-0.1.17.
Install the newer signed XPI over the old one; avoid uninstalling first, which may
remove storage. Back up before updates. Never edit signed XPI contents. Build refuses
to overwrite a local version that already contains a downloaded signed XPI.

Development still uses `npm --prefix extension run build` and loads
`extension/dist/manifest.json` via `about:debugging`. Use a separate development
Firefox profile because development and permanent builds share an ID.

No update server or locking is added. Future self-hosted update manifests can use
this ID; future enterprise `ExtensionSettings` can target
`atlas-development@atlas.invalid` with `force_installed`.

## Evidence and limits

- **191 Core and 215 extension tests pass**, with both typechecks and builds.
- Mozilla lint: **zero errors**, one Android warning. Desktop 140+ supports the
  privacy declaration; Android introduced it in 142. Android is untested.
- Native Firefox **157.0.1** temporarily loads the release in an isolated profile:
  first-run policy, saved Greylist grant/countdown, failure handling, background
  reload with original deadlines and real expiry pass. [Sanitized result](evidence/firefox-private-release-d32.json).
- The reviewer ZIP is extracted into a fresh directory and rebuilt with only its
  lockfile installs. Both source and unsigned ZIPs reproduce with identical SHA-256
  hashes. CLI checks also reject modified runtime bytes and an unexpected `.env` file.
- A pinned shell-quote override removes web-ext's critical advisory. npm still reports
  three high-severity dependency entries for one unpatched node-forge issue through
  unused Android adbkit/web-ext tooling, absent from runtime packages. The suggested
  obsolete web-ext downgrade is not applied.
- On 2026-10-10, the user reported Mozilla approval and the downloaded 0.1.13 XPI.
  The corrected offline command verifies that existing XPI, its five signature
  entries, original archives and staging. Only manifest whitespace differs from the
  original runtime. **191 Core and 226 extension tests pass**, including 23 release
  tests. All original artifacts are preserved; no signing operation was rerun.
- Ordinary Firefox **157.0.1** with signature enforcement enabled rejects the unsigned
  package and accepts the signed XPI as a permanent add-on (`signedState: 2`). It
  remains enabled after a full browser restart in a fresh isolated profile. This
  uses automated Addon installation, not the manual `about:addons` menu, and does not
  access the user's normal profile. [Payload comparison](evidence/firefox-signed-verification-d32.json)
  and [signed installation/restart result](evidence/firefox-signed-install-d32.json)
  retain the exact scope. Real-profile migration and daily authenticated browsing
  remain separate user checks.
