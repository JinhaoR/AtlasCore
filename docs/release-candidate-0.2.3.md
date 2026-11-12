# Atlas Firefox 0.2.3 signing candidate

Unsigned candidate for unlisted Mozilla signing, promoting the completed
[compact Home](compact-home.md). Identity remains
`atlas-development@atlas.invalid`. Signed 0.2.2 and all older artifacts are frozen.
Preparation does not sign, submit, deploy or modify the everyday Firefox profile.

## Changes from signed 0.2.2

- Compact introduction, full-width search, category shortcuts and a 320-pixel
  compass with up to ten pins. Additional pins use labelled overflow; narrow
  windows use labelled rows. The center handle rotates positions only for the
  current visit; it does not reorder pins or write preferences.
- Inline category browsing and a complete nonempty category directory. Explicit
  browsing can reveal hidden/collapsed categories without changing saved layout.
  Back, Forward, reload restoration, previews and destination actions remain.
- Edit pins and pages: ordered, named HTTP(S) bookmarks under stable destination
  IDs. Single targets open directly; multiple targets use an accessible popover.
  Ordinary service entry points remain available separately.
- Clearer pending, confirmation-ready, temporary grant and Journey summaries,
  using the existing access actions and deadlines.

Bookmarks are presentation only. Every launch sends the exact chosen URL through
the ordinary OPEN_DESTINATION gate. No Core, policy defaults, permissions,
dependencies, protected settings, controller or browser-correlation rules change.
The homepage/new-tab manifest overrides retain relative `ui/index.html` paths.

## Storage and compatibility

The independent `bookmarks-v1` record uses atomic revision comparison in the
existing `atlas-home-layout-v1` database, `layout` object store. The category
`current` record and database version are unchanged. No automatic write or
migration creates bookmark groups. Only acknowledged saved data drives Home.
Failed/uncertain saves retain edits; conflicts require explicit reconciliation.

Unpinning or losing a parent retains saved pages. Renaming a stable parent retains
them; a different ID does not inherit them. Clearing all saved pages restores the
ordinary entry points. Existing pin order, categories, policy and drafts remain.
Full user-entered URLs may contain private paths/query strings: they stay in local
presentation storage and are not included in diagnostics. The existing portable
policy backup excludes bookmarks; a closed Firefox profile backup includes them.
Save editor work before closing Firefox; unsaved bookmark edits are page-local.

Release checks use signed 0.2.2 and a temporary candidate overlay in a disposable
Firefox profile, with full restarts and rollback without uninstalling. This is
stored-data compatibility evidence, not a permanent unsigned install or a
substitute for verifying Mozilla's eventual signed XPI. Older versions ignore
the new presentation record; they cannot edit or display its bookmark pages.

## Verification and limitations

The implementation report retains native capacity, hover/keyboard, pointer
cancellation, concurrent saves, failure/retry, exact URL gating, restart and
125–200% zoom evidence. Matched short navigation samples (11ms before, 10ms after)
do not establish a meaningful performance improvement. Unchanged idle Home
retained its DOM and icon requests and the existing single refresh owner.

Candidate test counts, archive hashes, reproducible reviewer rebuild, isolated
upgrade/rollback and packaged-native results are recorded in
[release evidence](evidence/firefox-release-0.2.3.json). Native coverage is Windows
Firefox; physical touch/trackpads, screen-reader conformance and other platforms
remain unverified. Search remains destination/entry-point search, not a bookmark
page-name index. Firefox owns startup/session restore and override notices.

The locked production dependency audit reports no known vulnerabilities. The
unchanged development/signing toolchain has six reported advisories (two high,
one moderate, three low); these dependencies are not bundled into the extension.
They remain maintenance work, not silently upgraded during release preparation.
Mozilla's local linter reports no errors and its existing Android minimum-version
warning; the tested target remains desktop Firefox 140 or newer.

The historical intermittent INTERNAL_ERROR remains unresolved. This release does
not diagnose it, add speculative recovery or claim multi-day reliability.

## Artifacts and signing

`extension/release/0.2.3/` contains `addon/`, `atlas-0.2.3-unsigned.zip`,
`atlas-0.2.3-source.zip` and `release.json` with source/runtime/archive hashes.
The reviewer source includes locked tools, tests, notices and build instructions.
The allowlisted runtime excludes tests, native probes, source maps and profiles;
bounded production diagnostics remain available.

After separately choosing to sign, with Mozilla credentials securely supplied
through WEB_EXT_API_KEY and WEB_EXT_API_SECRET, run from the repository root:

```powershell
npm.cmd --prefix extension run release:validate
npm.cmd --prefix extension run release:sign
```

The second command submits to Mozilla's unlisted channel. Expected signed output:
`extension/release/0.2.3/signed/*.xpi`. No signing occurs during preparation.
After download, verify without credentials:

```powershell
npm.cmd --prefix extension run release:verify-signed -- 0.2.3
```

Deployment is a separate action. Back up and update in place under the same ID;
do not uninstall or replace the saved policy with curated defaults.
