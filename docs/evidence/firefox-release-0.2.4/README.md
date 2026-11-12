# Atlas 0.2.4 candidate verification

Verified on 2026-11-09 with Node 24.12.0 and Windows Firefox 159.0.1.
The [release record](../firefox-release-0.2.4.json) contains hashes, checks and
limitations. No signing, submission, deployment or everyday-profile access occurred.

- `upgrade-rollback.json`: actual signed 0.2.3, temporary packaged 0.2.4 overlay,
  three full Firefox restarts and rollback without uninstalling. Policy, manual
  Blacklist, settings, pins, categories/layout, named pages, staged/unfinished
  drafts, frozen Vault proposal and pending/grant deadlines survived unchanged.
- `packaged-everyday.json`: packaged popup/control-page routing, real optional
  permission prompt, bidirectional native bookmarks, retained dirty editor,
  restart/reconnect, exact-URL and Blacklist gate, pending/ready/expired access,
  unavailable authority, desktop stability, keyboard panel scrolling and
  125–200% zoom. The command used `--signed-baseline 0.2.3`. Its raw
  `temporaryOverlayRestart` sentence incorrectly says 0.2.2 because the fixture
  had an old literal label; the harness loaded the signed version from the
  command argument. That report-only label is now generic and future results
  record `signedBaseline` explicitly. No assertion or product code changed.
- `integrity.json`: all 246 pre-existing release files remain byte-identical;
  all 24 Core source files match signed 0.2.3; all 27 runtime assets match the
  development build after removing only trailing development source-map comments.
  Both ZIPs and the receipt reproduce byte-for-byte after clean locked installs
  from the reviewer source archive.
- Full regression logs record 249 Core tests and 598 extension tests, all passing.
  The development/reviewer builds run both TypeScript compilers. Mozilla lint
  reports zero errors and the existing Android minimum-version warning.
- Audit reports retain zero runtime advisories and six existing development
  toolchain advisories (two high, one moderate, three low). Dependencies were not
  changed during release preparation.

Screenshots are from synthetic disposable profiles: resting Home, selected
category, connected bookmarks, merge preview, 200% zoom and unavailable state.
The five-second idle sample recorded zero Home DOM replacements/attribute changes
and additional resources, five view reads, five presentation reads and at most
one outstanding view. The 15 in-page Sites/Home round trips were 11–24 ms; this
is a local observation, not an external-page load benchmark or speedup claim.

Headless Marionette did not establish physical toolbar-click or popup keyboard
activation. Popup status/routing was checked through native panel APIs; full
keyboard, screen-reader, trackpad and non-Windows behavior remain unverified.
The temporary overlay can lose the new optional permission when Firefox reverts
to the older signed baseline; both bookmark copies survive and reconnect works.
This is not proof of the eventual permanent Mozilla-signed update behavior.
The historical intermittent INTERNAL_ERROR remains unresolved.

Only this task's disposable Firefox profiles/runtime copies and clean reviewer
tree were removed after these results were retained. Release artifacts are kept.
