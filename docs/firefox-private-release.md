# Firefox release procedure

Release history lives in [one file](version-history.md). Keep signed 0.2.8 and
prepared unsigned 0.3.0 intact. The development tree contains later changes; do
not rebuild over either retained release. Older local release copies were removed
by the user-authorized cleanup. The current follow-up prepares unsigned 0.3.3 and
isolated upgrade/restart/rollback verification against retained signed baselines.
Preserve signed 0.3.1 and 0.3.2. Signing,
submission and live deployment remain separate actions.

0.3.3 includes the compact site/Vault workflow and the preceding development-only
compass, hostname-validation and clock catch-up work. Preserve 0.3.2 and all other
retained artifacts; packaging this candidate does not modify an existing release.

## Release contract

Atlas keeps Manifest V2, Firefox desktop 140+, and the existing identity
`atlas-development@atlas.invalid`. Despite its historical name, this ID is permanent;
development and signed builds use it. Current behavior lives in the feature contracts; a release packages reviewed work.

The esbuild pipeline has a separate release mode. Development remains in
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
extension/release/<version>/
  addon/                          runtime only, manifest.json at root
  atlas-<version>-unsigned.zip       unsigned submission package
  atlas-<version>-source.zip         reviewer source and rebuild instructions
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
5. Find the signed `.xpi` in `extension/release/<version>/signed/` for this candidate.

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
# Verify the retained signed baseline:
npm --prefix extension run release:verify-signed -- 0.2.8
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
# Select a new, unused increasing version with release:version first.
npm --prefix packages/core test
npm --prefix extension test
npm --prefix extension run release:build
npm --prefix extension run release:validate
# Separate authorized signing step; not part of preparation:
npm --prefix extension run release:sign
```

The version command synchronizes manifest/package/lockfile and preserves identity.
Packaging, signing and installation are separate authorized steps. The retained
0.3.0 candidate is frozen and predates current themes; a new development release
needs a new version and explicit runtime inventory. Never resubmit a signed version.
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

[Version history](version-history.md) links the retained 0.2.8 and 0.3.0 package
reports. Each release's own receipt records its source/runtime/archive hashes,
lint and tool versions; do not reuse old test counts as current results.

Release validation must cover full tests, reproducible reviewer source, strict
archive verification and native isolated upgrade/restart/rollback. The offline
verifier checks content against the recorded signed package; Firefox enforces
the cryptographic signature during installation. Desktop Firefox is the tested
target. Automated synthetic profiles do not establish everyday-profile,
real-provider or long-running reliability results.
