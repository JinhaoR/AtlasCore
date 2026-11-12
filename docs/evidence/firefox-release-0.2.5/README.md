# Atlas 0.2.5 release verification

Validated unsigned candidate, 2026-11-10. See the
[release notes](../../release-candidate-0.2.5.md) and
[complete verification record](../firefox-release-0.2.5.json).

## Checks

- **607 extension tests and 249 Core tests passed**, none skipped or failed.
- Both TypeScript checks, development build and release validation passed.
- Clean reviewer-source extraction and locked offline npm installs reproduced
  all 27 runtime files, both ZIPs and the integrity receipt byte for byte.
- Mozilla lint: zero errors, one existing Firefox Android minimum-version
  warning. Runtime dependency audit: zero findings. The unchanged development
  toolchain has six findings (3 low, 1 moderate, 2 high); no dependency update
  was made during release preparation.
- Existing signed 0.2.4 verified offline. All 278 pre-existing release files
  retain their hashes. Only the version and Home HTML/CSS/JS differ in the
  runtime package; no Core, enforcement, sync-owner or authority-storage changes.

## Native Firefox

All native tests used Windows Firefox 159.0.1, disposable profiles and copied
runtimes. No everyday profile or installed enterprise policy was accessed.

[Upgrade/restart/rollback](upgrade-rollback.json) began on actual signed 0.2.4,
created policy/settings, a native bookmark connection, named pages, pinned and
categorized sites, a staged draft with unfinished fields, a frozen Vault proposal,
a pending request and an active grant. The packaged 0.2.5 overlay preserved them
across restart and rollback. A category icon saved in 0.2.5 survived both restart
and rollback; the older layout record was unchanged.

[Packaged category checks](packaged-category-grid.json) exercised pointer and
keyboard reordering, cancellation, focus/history, icon save failure/retry, two
control pages, restart, thirty categories and small windows at 125–200% zoom.
[Packaged Everyday checks](packaged-everyday.json) exercised Home's direct bookmark
connection, native permission, bidirectional edits, dirty-editor conflict retention,
restart, exact-URL launches, Blacklist denial, Greylist wait/confirmation/expiry
and unavailable-state behavior. The bookmark permission and connection survived
restart with signed 0.2.4 as the baseline.

Screenshots: [Home](home-grid.png), [category settings](category-settings.png),
[small window at 200%](grid-500-2.png), [bookmark connection](bookmark-connection.png),
[active access](active-access.png).

Idle fixture observations found no category mutations, replacement nodes or new
resource requests; one refresh owner remained active. This is not a general
performance or uptime guarantee. Headless toolbar-click/popup-keyboard, physical
touch/trackpad and screen-reader limitations remain. The historical intermittent
INTERNAL_ERROR is unresolved. An unsigned temporary-overlay test is not a test of
the eventual permanent Mozilla-signed update.

## Delivery and cleanup

The unsigned package, reviewer source and receipt are in
`extension/release/0.2.5/`. No signing, submission, deployment or commit occurred.
Checkpoint, hashes and logs remain under `.tools/release-0.2.5`; only this task's
three disposable Firefox profiles/runtimes and clean reviewer copy were removed
after preserving the evidence above.
