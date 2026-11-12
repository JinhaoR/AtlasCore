# Atlas 0.2.0 — compass refinement

## Boundary and checkpoint

This is the second presentation pass, authorized after the first implementation
preserved behavior but retained too much of the old catalogue composition. It
changes no Core, adapter command, repository, migration or authorization rule.
The pre-refinement working state is retained in
`.tools/ui-refinement-0.2.0/checkpoint.zip`, with a per-file SHA-256 manifest beside
it (572 files; archive SHA-256
`853c05c645adc251c0841d092d5271e7c6d7649eb74e26741c96fe93bf70f2f2`).
This includes uncommitted work; it is not a Git commit or a signed release.

## Composition

Home's first six pins are compact cream plaques joined to circular cream favicon
medallions. Fine gold outlines separate them from a larger, quieter stationary
compass. The original open button, exact entry-point selector and explicit pin
control remain separate, keyboard-accessible controls. Hostnames remain on the
plaques to distinguish similarly named destinations. More than six pins continue
below the compass; narrow windows use a regular grid in the same saved order.

The first six visible categories are shortcuts. All other visible categories are
reachable through All categories and the workspace selector. Selecting a category
replaces the compass with its existing destination rows, including collapse,
Show all/Show fewer, variants and pin controls. The selected category initially
previews up to twelve rows; all-category previews remain compact. A saved
collapsed category stays collapsed when selected. Hidden categories remain
searchable and manageable through All destinations.

`home-workspace.ts` owns only the currently viewed category. It reuses the existing
category DOM and stores navigation context in browser history, so Back/Forward and
reload can restore the view. Choosing a category or Back to compass never writes
Home layout preferences. Category order, visibility and collapse still belong to
the existing acknowledged presentation repository. Each control page keeps its
own navigation view while sharing the same saved preferences.

All destinations now uses navy rows, thin separators, website icons, cream names
and subdued exact hostnames/category labels. The same Sites selection/editor and
batch-workspace owners remain. Its empty-draft summary is compact; nonempty drafts,
errors and protected reviews retain their existing controls and information.
Directory icons share the existing lazy favicon owner/cache and cleanup, rather
than introducing another observer or tab subscription.

Settings uses separated sections with clear timing labels and aligned inputs.
The Vault route presents the existing proposal panel on its own, including its
frozen diff, protection state, confirmation and cancellation. Settings still
offers the same panel. No protected field, validation rule or confirmation action
was removed. Warnings and unavailable states retain their distinct surfaces.

## Local typography

Cormorant Garamond provides display headings and the italic introduction; Source
Sans 3 supplies controls and secondary text. Latin and Latin Extended WOFF2
subsets are bundled locally (245,430 bytes including licences and provenance).
Both are distributed under the SIL Open Font License. Original notices, immutable
download URLs and SHA-256 hashes are in `extension/src/ui/assets/fonts/`, and
`extension/THIRD-PARTY-NOTICES.txt` identifies the upstream projects. Runtime CSS
loads no remote font service. Other scripts use the configured system fallbacks.
Existing website favicon lookup remains enabled, with the original neutral local
fallback when a site icon cannot be obtained.

## Verification and limits

Verification results are recorded in
[visual-refinement-0.2.0.json](evidence/visual-refinement-0.2.0.json).
Visual inspection uses actual isolated Firefox at
the reference's 1586 × 992 content viewport, including Home, Research, directory,
Settings and a real pending Vault proposal. The native fixtures also cover saved
layout/restart/conflict behavior, editing, failures, exact navigation, zoom and
unavailable diagnostics. No test instrumentation is copied into production UI.

The development build, both TypeScript compilations, **247 Core tests** and
**529 extension tests** pass. Four new workspace tests cover navigation-only
state, ordered access to all categories, history/hide fallback and malformed
navigation data. One new asset test checks the font hashes, OFL notices and local
CSS sources; the three shortcut tests now cover workspace selection and quiet
keyed updates. Existing contrast, editor, storage and authorization checks pass.

Six isolated native scenarios completed: the matched first-pass comparison,
refined visual suite, Home organization, productization, persistent batch/Vault,
and editor quality pass. They include full Firefox restarts, two-page preference
conflicts, explicit draft/layout retries, frozen review, independent unavailable
diagnostics, exact search and existing Greylist/Journey actions. The visual suite
covers fourteen pins and thirty categories with 296 synthetic exact destinations;
the Home suite additionally verifies five/fifteen/thirty category fixtures.
Actual content widths down to 250 CSS pixels at 200% zoom remain within the
viewport. Firefox clamps very small requested outer windows to 500 pixels on
this runner; the result records actual dimensions.

At the matched 1586 × 992 viewport, both checkpoint and refinement measured a
**9 ms median** Sites-to-Home transition over twelve samples. Both retained the
same pin DOM nodes, zero pin mutations and zero presentation writes during the
five-second idle sample. These are local fixture observations, not a general
performance guarantee. The separate history fixture still completes ordinary
gated navigation with 2,500 stored Journey records; this pass does not optimize
that Core path.

Native screenshot review prompted tighter introduction spacing, removal of
duplicate category navigation, a compact empty-draft surface, and a narrow-nav
overflow correction. Lazy-icon fixtures were updated to reveal the category
workspace before testing image decoding; their actual image assertions remain.

- [Before Home](evidence/visual-refinement-0.2.0/home-before.png) and
  [refined Home](evidence/visual-refinement-0.2.0/home.png), at matching dimensions.
- [Research workspace](evidence/visual-refinement-0.2.0/category.png) and
  [directory](evidence/visual-refinement-0.2.0/directory.png).
- [Settings](evidence/visual-refinement-0.2.0/settings.png) and
  [frozen Vault proposal](evidence/visual-refinement-0.2.0/vault.png).
- [Small Home](evidence/visual-refinement-0.2.0/home-small.png),
  [batch review](evidence/visual-refinement-0.2.0/sites-review-small.png), and
  [truthful draft-save failure](evidence/visual-refinement-0.2.0/draft-save-failure.png).

Production edits are limited to `ui/main.ts`, `ui/home-shortcuts.ts`, the new
`ui/home-workspace.ts`, `ui/destination-cards.ts`, `ui/sites.ts`, UI markup/styles,
bundled fonts and third-party notices. Generated development files are rebuilt.
The background bundle remains byte-identical to the checkpoint, and all **134**
inventoried release files retain their hashes. Core source, authority, package
version and extension identity are unchanged by this refinement. The checkpoint
is retained. After preserving screenshots and results, the ten task-created
profiles and two comparison copies were removed (1.43 GB reclaimed). No other
tools or profiles were removed.

The reference's illustrative logos are replaced with actual available website
favicons. Small exact hostnames and persistent pin/variant controls are deliberate
functional differences. There is no invented Frequent feature, remote backdrop,
animation or preference migration. The static compass gives way to a readable
grid at narrow widths. This is not a full screen-reader conformance audit;
non-Windows rendering and live remote favicon availability are not guaranteed.
The intermittent historical `INTERNAL_ERROR` remains unresolved and is unrelated
to this presentation work. Nothing is signed, installed, submitted or deployed.
