# Atlas Firefox 0.1.15 release candidate

## Included changes

- **Downloads:** operation-bound authorization for browser-attested top-level GET
  downloads, correlated new tabs, bounded HTTP redirects and delayed attachment
  responses. The fixed 30-second lifetime and five-redirect budget are never
  renewed. No policy entry, Access Grant or shared Journey is created.
- **Home organization:** saved category order, visibility and complete collapse;
  pins/search remain independent of hidden categories. Layout writes use a
  separate revision-checked presentation repository. Existing access summaries
  lead to their owning Greylist/Journey workflows.
- **Navigation continuity:** retained Sites selection, search/filter, scroll and
  focus through editor, sidebar, reload and Vault navigation.
- **Visual polish:** shared text/color/spacing/control conventions, stronger
  contrast, compact editors, accurate editable/frozen/completed workspace labels,
  associated field errors and stable live-region feedback.

Milestones A/B remain included: truthful unavailable and save-failure states,
persistent batch drafts, explicit reconciliation, one complete Vault proposal,
custom category identity and separate display-only recovery.

## Compatibility

The ID is `atlas-development@atlas.invalid`. The only manifest semantic change
from 0.1.14 is its version. Permissions, authoritative snapshot schema 2, Core
package version 0.1.0 and protected timing values are unchanged. Existing policy,
settings, pins, destination metadata and drafts remain compatible. Home
organization adds its own validated presentation record without rewriting policy.
Restart discards Download Intents and never restores expired runtime permission.

Every preserved 0.1.14 release file remains unchanged. No private browser profile,
saved policy, credential or live grant is copied into the release. The approved
51-host preset applies only to genuinely empty first-run installations.

## Artifacts and verification

The candidate is under `extension/release/0.1.15/`:

- `atlas-0.1.15-unsigned.zip`: Mozilla submission/runtime package.
- `atlas-0.1.15-source.zip`: exact public source, tests, pinned dependencies and
  reviewer rebuild instructions.
- `release.json`: per-file source/runtime hashes, archive hashes and lint results.
- `addon/`: staged runtime used for isolated native verification.

[Verification evidence](evidence/firefox-release-0.1.15.json) records exact digests,
unit/native checks and fresh archive reproduction. The unsigned ZIP is not a
permanent Firefox installer. No signing or submission is performed by preparation.

Validation passes with 204 Core and 352 extension tests, including 23 release
regressions, both TypeScript checks and the development/release builds. A fresh
reviewer extraction with lockfile installs from the offline package cache
reproduces both archive SHA-256 hashes exactly. Staged-runtime Firefox 157.0.1
verification passes 40 groups/scenarios: Home 14, batch/Vault 9 and downloads 17.
The Home fixture includes a full process restart; batch verification includes
three. Lint reports zero errors, zero notices and one existing Android warning.
All 19 preserved 0.1.14 files retain their original hashes; its signed XPI passes
read-only offline verification. Permanent 0.1.15 installation remains untested
until Mozilla supplies a signed XPI.

## Next: sign, verify, update

Use the credential handling in the [release guide](firefox-private-release.md#obtain-the-signature).
Keep credentials out of files, Git, logs and chat. Once you are ready to submit:

```powershell
npm.cmd --prefix extension run release:validate
npm.cmd --prefix extension run release:sign
# After Mozilla returns the signed XPI:
npm.cmd --prefix extension run release:verify-signed -- 0.1.15
```

If signing times out after upload, inspect the Mozilla dashboard before attempting
another submission. Preserve downloaded artifacts and use offline verification;
do not rebuild a signed version to resolve a verification problem.

Back up before updating. Install the verified signed 0.1.15 XPI in place, retaining
the extension ID, existing Firefox profile and enterprise deployment filename/path.
Do not uninstall Atlas. Saved state is local to the profile; copying release files
does not transfer another user's policy. Verify policy/settings, pins/drafts, Home
layout and ordinary Greylist/Journey workflows after installation and restart.
See [backup guidance](firefox-backup.md). No installed profile or enterprise policy
has been changed during preparation.

## Supported scope and remaining limits

Downloads require reliable browser user activation and request lineage, followed
by an unambiguous attachment response. Unfamiliar HTML/interstitial pages are
withheld pending ordinary navigation authorization. Filename extensions, MIME
types, opener tabs and claimed download links alone do not authorize a webpage.
The bounded operation permits network contact before its response type is known;
it does not certify file safety. POST downloads, resumes/range requests, embedded
downloads and missing/ambiguous evidence are outside this exception. Existing
Blob behavior is unchanged. [Download contract](firefox-downloads.md).

Desktop Firefox 140+ is the declared target; native evidence uses 157.0.1. The one
lint warning concerns Android's privacy-declaration support; Android is untested.
Screen-reader, physical high-density display and OS forced-color testing remain
unverified; full accessibility conformance is not claimed. Large reviews scroll
vertically at high zoom, and long launcher names retain accessible truncated labels.
