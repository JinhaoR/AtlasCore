# Repository ownership and cleanup

This report covers the structure cleanup and the subsequent user-requested
artwork/docs/release cleanup. The current request explicitly replaces the old
requirement to keep every release and every background study.

## Ownership

```text
packages/core/             Pure policy, authorization, planning and commit semantics
extension/src/adapter/     Firefox events, correlation and enforcement
extension/src/background/  Startup and concrete configuration
extension/src/storage/     IndexedDB and recovery
extension/src/presets/     Required installation/upgrade migrations
extension/src/bookmarks/   Serialized native bookmark presentation integration
extension/src/ui/          Shared pages, forms, layout, navigation and theme selection
themes/shared/             Default/light colors and licensed local fonts
themes/celestial/          theme.css and compass assets
themes/parchment/          theme.css and compass assets
docs/                     Current contracts, developer guide and version history
extension/release/         Signed 0.2.8, frozen unsigned 0.3.0, unsigned 0.3.1 candidate
```

Firefox depends on Core. Core has no Firefox, DOM, filesystem, network or
real-clock calls. Themes supply CSS values and local images through the existing
small boundary; they contain no application or authorization logic.

The earlier structure pass moved theme sources out of shared UI, preserved runtime
URLs, removed five test-only helper exports and stopped bundling unused reference
assets. Those changes remain. Native [historical validation](evidence/repository-cleanup/README.md)
includes policy/presentation upgrade and rollback checks.

## Themes

Removed all four historical page backgrounds, source/reference scans, three
background-study directories, artwork generators and obsolete theme-design
screenshots. Kept the five compass/orbit/brand SVGs byte-for-byte, both palettes,
fonts/licences, controls and shared layout. All Sites and Settings now have plain
theme-colored backgrounds. Home is also plain, ready for the user's own artwork.

The [short handoff](../themes/README.md) gives one place to put it:
`themes/<theme>/assets/home.webp`, connected through that theme's existing
`--page-home-background` value. No Core/shared component/build machinery changes.
The narrower workspace background stays separate and plain unless explicitly
changed. Only current compass credits remain in `themes/ARTWORK.md`.

## Add Site

The reported hostname was `github.io`. It is a private Public Suffix List entry
shared by unrelated GitHub Pages tenants, so the existing all-subdomains guard
correctly disables that choice. The form now explains why and gives the example
`your-site.github.io`. `github.io` remains valid as an exact hostname; a tenant
hostname can opt into its descendants. Validation and Vault are unchanged.

Regression coverage checks the explanation, eligible tenant selection and saved
draft restoration. Native pointer clicks and reload verify the same behavior;
staging alone never changes active policy. This is a clarity repair, not a new
permission to allow entire hosting providers.

## Docs and release retention

The public README now has plain-language philosophy/logic, a short Firefox setup
section and the requested Codex development credit. Technical navigation moved to
[docs/README.md](README.md). Sixteen release-note documents are consolidated in
[version-history.md](version-history.md); agent, reviewer and release instructions
no longer repeat the full chronology. Links and the release source inventory are
updated. Current policy/migration/recovery contracts and substantive behavior
evidence stay intact.

Removed fifteen local release directories (0.1.13 through 0.2.7), with duplicate
package reports. Signed 0.2.8 and prepared unsigned 0.3.0 remain unchanged.
Deployment tests now verify real signed 0.2.8 and use clearly synthetic installed
package fixtures for backup/version comparisons; no obsolete signed package is
needed. Current native theme/upgrade defaults use 0.2.8. Older migration-specific
native scenarios require their actual externally retained baseline; no scenario
silently substitutes a newer version. Migration code, validation, tests and
versioned signature-verification rules have not been removed.

The audited removal list covers **889 files / 502,847,704 bytes** across artwork,
old notes/reports and older release copies, before small replacement docs/evidence.
This is a local file-size reduction; it does not shrink existing Git history.

## Validation and remaining limits

See [current results](evidence/cleanup-fixes/README.md). Core source, compass SVGs
and both retained releases match their pre-task hashes. Build/type checks and all
Core/extension/deployment regression suites pass. Native checks cover Add Site,
themes, plain working surfaces, compass clicks/rotation, narrow/zoom states and
saved preferences across restart.

No version bump, new package, signing, deployment or everyday-profile change.
Large shared stylesheet/harness structures and the historical INTERNAL_ERROR
investigation are deliberately left intact. This cleanup makes no FPS,
cold-start or long-running reliability claim. Runtime migration code and failure
recovery remain owned by their existing contracts and tests.
