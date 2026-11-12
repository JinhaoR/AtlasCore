# Everyday interaction refinement — development evidence

2026-11-10, Windows, native Firefox 159.0.1 in disposable profiles. This is an
unversioned development change, not a signing candidate. The pre-change working
tree and runtime are retained in `.tools/ux-toolbar-refinement/checkpoint.zip`.

## Implemented

- Category dragging has a cursor-following card and animated insertion preview.
  Only a completed drop saves the order. Cancellation and Alt+arrow ordering remain.
- The compass rings accept dragging. Capped inertia decays with friction and stops
  within 1.6 seconds; reduced motion skips it. Pin activation, focus, cancellation,
  hidden pages and disposal stop motion. No saved order or angle changes.
- Home is larger and centered. The pinned section has no scrollbar; overflow pins
  retain their separate labelled disclosure. Search/drag/status clutter is removed.
- Category icons open a local visual picker. Settings ordering arrows are removed.
- Vault lives inside Settings, retaining existing routes, reviews and confirmation.
  The useful bundled-policy restore action remains under Recovery. Empty/completed
  Sites drafts use a compact receipt disclosure instead of a large summary box.
- Static everyday headings, labels and placeholders live in
  [`ui-text.ts`](../../../extension/src/ui/ui-text.ts). The build escapes and fills
  them into HTML; no runtime fetch or additional render is involved. Dynamic
  authorization consequences and technical codes remain in their presenters.
- One permission action connects direct Firefox toolbar bookmarks and Atlas pins,
  without a folder picker or initial preview. Folders remain outside synchronization.
  Unpinning deletes only synchronized direct toolbar bookmarks, as explicitly
  requested. Saved Atlas pages remain for repinning. Failure and conflict details
  are accessible through the connection control, rather than routine Home banners.

The toolbar connection retains the existing serialized presentation owner,
revision checks, durable external-operation intent, restart reconciliation and
explicit conflict resolution. It does not call the Core controller or grant access.
See [the contract](../../everyday-controls.md#current-toolbar-connection-2026-11-10-development).

## Verification

The final development build passed both TypeScript compilers and bundle checks.
All **621 extension tests** and **249 Core tests** passed. Focused bookmark tests
cover the toolbar union, exact URLs, duplicates, ordering, unpin/repin, native
edits/deletion/folder moves, permission loss, disconnect, conflicts, journal-save
failure, uncertain native creation and restart. Two additional final tests cover
unnamed/whitespace titles and multi-page shortcut labels; the unnamed-title test
reproduced a failure before its fix.

Native evidence is separated by scenario:

| Result | Verified behavior |
| --- | --- |
| [Interactions](interactions.json) | Real outer-ring pointer drag, friction settling, reduced motion, Escape, pre-save drag preview, icon-picker focus, Vault within Settings and a real frozen proposal preserving active policy |
| [Categories](categories.json) | Drop/cancel, keyboard/reload, injected icon-save failure and retry, two control pages, full Firefox restart, 30 categories and quiet idle DOM |
| [Everyday workflows](everyday.json) | Native permission prompt, one-click toolbar connection, bidirectional edits, folders excluded, unpin deletion, dirty-editor conflict retention, restart preservation, exact gated launches, Blacklist, Greylist deadlines and unavailable authority |

The native workflow runs preceded the final narrow fixes for unnamed titles and
disconnected/group label editing; those fixes are covered by the final unit suite.
The final runtime was then measured natively. Fixture instrumentation exists only
in disposable runtime copies, not in `extension/dist`.

Screenshots were inspected at normal size and zoom. Windows from 500 to 2538 pixels
and Firefox 125%, 150% and 200% zoom were exercised, including a 250 CSS-pixel
viewport. No horizontal document overflow was observed. Small windows use the
existing document-scroll/labelled-pin fallback.

| Matched navigation/idle sample | Checkpoint | Final build |
| --- | --- | --- |
| Median of 15 Home/Sites navigation samples | 12 ms | 12 ms |
| Sample range | 11–22 ms | 11–21 ms |
| Node replacements / attribute changes over 5 seconds idle | 0 / 0 | 0 / 0 |
| New resource requests over idle period | 0 | 0 |
| GET_VIEW / presentation reads over idle period | 5 / 5 | 5 / 5 |
| Maximum concurrent view request / retained pin node | 1 / yes | 1 / yes |

[Before](measure-before.json) and [after](measure-after.json) used the same synthetic
fixture and harness. This is one small interaction comparison, not evidence of a
general speed improvement, a long-session benchmark or a heap profile.

## Retained views

- [Home](home-grid.png), [connected toolbar pins](everyday-connected-home.png),
  [expanded category](everyday-category.png), [wide screen](ux-2538-1.png).
- [Drag preview before save](category-drag-preview.png), [icon picker](icon-picker.png).
- [Vault in Settings](vault-in-settings.png), [waiting proposal](vault-waiting.png),
  [quiet Sites draft](sites-quiet-draft.png).
- [Thirty categories](thirty-categories.png), [200% zoom](ux-1488-2.png),
  [narrow 200% zoom](ux-500-2.png), [unavailable authority](home-unavailable.png).

## Compatibility and limits

- [Integrity comparison](verification.json): all 310 existing release files are
  byte-identical to the checkpoint hashes; all 24 Core source files are unchanged.
  Manifest, extension identity, version 0.2.5 and package configuration are unchanged.
  No signing, submission, release packaging, deployment or everyday-profile changes.
- Policies, timing, pins, layout, drafts and named pages survived the native restart
  scenario. Presentation changes do not affect browsing permission. A blocked
  bookmarked URL was denied before an HTTP request despite its trusted parent.
- Existing folder connections are readable until explicitly switched. The old
  folder and its contents stay untouched. The new toolbar record is not readable
  by older builds' strict validator; back up before downgrading. This is not a
  claimed backward-compatible bookmark-connection downgrade.
- Several pages of one explicit site remain one Atlas pin and occupy consecutive
  participating toolbar slots. Firefox shows separate page titles; a multi-page
  Atlas group label has no native folder counterpart. Separators, folders,
  unsupported schemes and over-limit entries remain Firefox-only.
- Native mouse/keyboard checks do not establish touch-device or screen-reader
  conformance. The headless harness could open the popup through Firefox's API,
  but could not verify physical toolbar opening or popup keyboard activation.
- The historical intermittent `INTERNAL_ERROR` remains unresolved and outside
  this change. Synthetic unavailable-state checks are not a reproduction of it.

After retaining these results, only this task's disposable profiles/runtime copies
were removed. The checkpoint and local test logs remain under `.tools`.

Reproduce after a development build with `node --test extension/tests/*.test.mjs`
and `node --test packages/core/tests/*.test.mjs`. Native selectors are
`--interaction-polish-only`, `--category-grid-only`, `--everyday-only` and
`--measure-only` on `extension/scripts/firefox_compact_home.py`, using
`--signed-baseline 0.2.4`. The before measurement additionally uses
`--addon-dir <preserved checkpoint runtime>`.
