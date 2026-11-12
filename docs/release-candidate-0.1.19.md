# Atlas Firefox 0.1.19 release candidate

This is the unsigned candidate for private **unlisted** Mozilla signing. Existing
ID: `atlas-development@atlas.invalid`. No signing, installation, deployment,
enterprise-policy changes, commit or push is performed during preparation.

## Changes from signed 0.1.18

- Destination editing no longer gets trapped behind an untouched blank editor.
  Raw input saves coalesce, completed-batch work is reduced, staged review is
  clearer, and editing replaces duplicate committed-detail presentation.
- Explicitly reviewed strict Whitelist removals can commit without a cooldown.
  Additions, mixed batches, Blacklist and settings changes retain Vault.
- Optional domain-and-all-subdomains Whitelist terms are default-off and protected
  by Vault. Manual Blacklist wins; managed blocking still applies to additional
  subdomains unless separately exactly Whitelisted. Existing rules remain exact.
- Validated-state structural comparison and immutable wrapper reuse eliminate
  redundant serialization/freezing. Complete loads, validation, clock checks,
  atomic commits, receipt verification and unknown-outcome handling remain.
- A closed/superseded tab's late arrival read is retired; live-context failures
  remain observable and conservative. Runtime fault evidence stays available
  during unavailability and Recovery, and bounded sanitized incident data survives
  background restart. These are production diagnostics, not test probes.
- Fresh defaults omit Wikipedia as well as YouTube: 294 exact hosts / 122 services.
  A previously applied 0.1.18 v2 expansion receipt remains valid. Upgrading does
  not reapply the preset or remove saved custom/previously bundled permissions.

## Compatibility and unresolved issues

The **intermittent INTERNAL_ERROR is not established as fixed**. Its original
trigger remains unidentified. Synthetic exception tests verify diagnosis and
conservative recovery, not the cause of the real incident. Large retained histories
still cost time and disk; no unsafe pruning or permission cache is introduced.
Ten-minute native endurance evidence is not multi-day reliability certification.

Existing Whitelist, Blacklist, configuration, frozen Vault terms, access scopes and
deadlines, drafts, pins and Home layout must survive the update. Journeys remain
bound to their original background/context lifetime; restart ends old bindings.
There is no restore of ephemeral Download Intent authority. No database reset or
copy of a developer's private browser storage is shipped. New scope rules are
additive opt-in fields; do not downgrade after adopting newer policy semantics.

## Candidate artifacts and verification

Artifacts: `extension/release/0.1.19/addon/`, `atlas-0.1.19-unsigned.zip`,
`atlas-0.1.19-source.zip`, and `release.json` (all under that version directory).
The runtime contains only the 14 allowlisted assets: no source maps, test harness,
instrumentation, test fixtures, development module tree, profiles or credentials.
The separate reviewer ZIP intentionally includes source and regression tests.

[Release evidence](evidence/firefox-release-0.1.19.json) records final test results,
signed-baseline verification, upgrade state checks, fresh reviewer-source rebuild,
runtime/source/archive digests and integrity review. Historical engineering
measurements remain in [the quality report](quality-pass-0.1.19.md).

## Separate signing step

From the repository root, after reviewing the evidence:

```powershell
npm.cmd --prefix extension run release:validate
$env:WEB_EXT_API_KEY = Read-Host 'Mozilla JWT issuer'
$atlasSigningSecret = Read-Host 'Mozilla JWT secret' -AsSecureString
try {
    $env:WEB_EXT_API_SECRET = [System.Net.NetworkCredential]::new('', $atlasSigningSecret).Password
    npm.cmd --prefix extension run release:sign
}
finally {
    Remove-Item Env:\WEB_EXT_API_KEY, Env:\WEB_EXT_API_SECRET -ErrorAction SilentlyContinue
    $atlasSigningSecret.Dispose()
}
npm.cmd --prefix extension run release:verify-signed -- 0.1.19
```

Mozilla's returned XPI will be under `extension/release/0.1.19/signed/`; use the
filename actually returned. Do not rerun signing merely to repair a local verifier.
An unsigned ZIP is not a permanent Firefox installer. After successful offline
verification, back up and update in place under the same ID without uninstalling.
Installing/deploying the signed XPI remains a separate user action.
