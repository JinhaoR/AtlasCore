# Atlas Firefox 0.2.0 signing candidate

Unsigned candidate for **unlisted** Mozilla signing. Identity remains
`atlas-development@atlas.invalid`. Preparation stops before submission, signing,
installation or deployment; all prior signed release artifacts remain unchanged.

## Changes from signed 0.1.19

- Navy/cream/gold presentation with local licensed typography, top navigation
  and a stationary compass. Saved pins keep their explicit order, exact targets,
  variants and secondary controls; additional pins have a labelled overflow area.
- Categories open in the Home workspace without changing saved order, visibility
  or collapse preferences. Back/Forward and reload restore presentation context.
- All destinations uses compact directory rows and an adjacent detail/editor.
  Narrow layouts have focused detail and Back. Filters, list position, unfinished
  fields and acknowledged-save focus are retained.
- A compact draft companion opens a complete before/after review. Save failures,
  conflicts, uncertainty and retry remain visible. Existing display-only saves,
  immediate reviewed Whitelist subtraction, mixed batches and frozen Vault
  submission retain their original boundaries.
- Dedicated Vault separates exact proposal changes from waiting/confirmation
  state and original deadlines. Settings has distinct timing, curated, managed,
  recovery and diagnostic sections with active/edited values and explicit units.
  Diagnostics remains available when the main view query fails.
- The passive Journey indicator adopts the same palette. Its messages, ownership,
  timers and authorization behavior are unchanged.

Core, Firefox authority commands, policy precedence, repository schemas, curated
defaults/migration, dependencies and required permissions are unchanged from signed
0.1.19. There is no new authorization model or new-tab replacement. Existing favicon
lookup continues; fonts and new control/design assets are local.

## Update, rollback and remaining limitations

The isolated compatibility fixture upgrades signed 0.1.19 under the same ID and
returns to that actual signed baseline without uninstalling. It checks custom
Whitelist/Blacklist, protected settings, ordered pins, custom categories/layout,
staged drafts/raw fields and frozen proposal/request/grant deadlines across full
browser restarts. Candidate code is a temporary overlay in this fixture because
this release is unsigned; this is not a permanent signed 0.2.0 installation test.
Back up real data before an eventual in-place update. No private state is packaged.

There is no database migration in 0.2.0. Pending terms are never renewed by upgrade
or rollback. Normal expiry remains effective; background/context-bound Journeys
and Download Intents are not resurrected after restart. Returning to 0.1.19 restores
its older UI while keeping compatible saved state. This does not establish safe
downgrade to older versions that lack 0.1.19 policy scope/removal semantics.

The **historical intermittent INTERNAL_ERROR remains unresolved**. Existing bounded,
sanitized diagnostics and conservative unavailable/recovery behavior remain.
Synthetic checks do not prove its cause or guarantee multi-day reliability.
Large retained histories still add navigation and disk cost; no pruning, authority
cache, clock clamp or speculative runtime optimization is introduced here.

The repeated matched large-history measurements and their limits are recorded in
[release evidence](evidence/firefox-release-0.2.0.json). Small timing samples and
100 ms observation polling cannot establish every latency difference. No speedup
is claimed. Four serial A/B/B/A runs used 15 navigations per history size per run.
For 2,500 ended Journeys, checkpoint medians were 391/422 ms and candidate medians
421/422 ms (pooled medians 413.5/422 ms); all empty-history medians were 125 ms.
The earlier 484 → 547 ms gap was not consistently reproduced. The later checkpoint
matches both candidate runs, and the background runtime remains byte-identical to
signed 0.1.19. No speculative optimization was added.

Non-Windows visual rendering, full screen-reader conformance, Android
and private daily authentication sessions remain unverified. Website favicons may
be unavailable and retain the existing fallback. Long reviews scroll; timing
fields retain seconds/hops. New-tab integration remains outside this release.

The unchanged locked development toolchain has 13 npm audit entries (1 low,
10 moderate, 2 high, including node-forge and undici). The runtime-only audit
reports zero. No dependency upgrade or automatic audit fix is bundled; the
observed audit is retained with the verification evidence.

## Artifacts and validation

Under `extension/release/0.2.0/`:

- `addon/`: staged runtime (23 explicitly allowlisted files).
- `atlas-0.2.0-unsigned.zip`: Mozilla submission runtime.
- `atlas-0.2.0-source.zip`: reviewer source, tests, lockfiles, fonts/licences and
  build instructions. It excludes private data, profiles, caches and dependencies.
- `release.json`: per-file and archive SHA-256 integrity receipt.

Runtime packages exclude maps, test harnesses, synthetic faults, probes and the
development module tree. Intentional bounded production diagnostics remain.
The reviewer source rebuild uses only pinned lockfile installs. Validation checks
identity, source, runtime, archive contents, pinned feed and Mozilla lint. A clean
rebuild must reproduce both archives and the receipt exactly.

[Verification evidence](evidence/firefox-release-0.2.0.json) records final results,
artifact hashes, old-release integrity, clean reproduction and native checks.
[Management report](management-ux-0.2.0.md) maps retained capabilities and screenshots.

## Separate signing command

From the repository root, only when separately authorized:

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
```

Expected downloaded artifact: `extension/release/0.2.0/signed/*.xpi`.
After Mozilla returns it, verify offline with
`npm.cmd --prefix extension run release:verify-signed -- 0.2.0` before a separately
authorized backup/update. Do not retry signing blindly after a timeout or edit a
downloaded signed archive.
