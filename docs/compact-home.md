# Compact Home development change

The subsequent [Everyday controls](everyday-controls.md) development pass replaces
the expanding category region with a bounded category/search panel, adds the
optional native bookmark connection and routes named-page/pin writes through
its presentation owner. The history, exact gated launches and saved category
preferences below remain. The following records the original 0.2.3 layout.

This approved presentation change replaces the large hero with a compact launcher.
The development implementation left version 0.2.2, Core, adapter commands,
manifest, installed profiles and every release artifact unchanged. It is now
promoted to the unsigned [0.2.3 candidate](release-candidate-0.2.3.md); signed
0.2.2 remains frozen. The earlier bounded category workspace is superseded.

## Composition and categories

Home uses a centered introduction, full-width search, compact category shortcuts
beside a 320-pixel pin composition, inline category content, current access rows
and the address disclosure. Narrow windows use labelled pin rows. Existing local
fonts, SVG icons, website favicon loading/cache and category cards remain.

The first six visible nonempty categories follow saved order. **All categories**
opens every nonempty category, including those hidden from shortcuts. Selecting
one shows its contents below the launchers; another selection replaces it and
selecting the same category closes it. **Back to categories** and **Close categories**
provide explicit return paths. Back, Forward and reload reuse the existing Home
history owner. Selection scrolls content into view once; refresh never scrolls.

Explicit browsing reveals a saved collapsed category without writing its
`collapsed` preference. The layout schema, ordering/visibility/collapse and empty
definitions remain. The old automatic catalog and heading-collapse navigation
are removed; temporary browsing is not a saved preference update. Existing Show
all/fewer, variants, pin actions, search and Sites management remain. Pin order
is independent of categories.

## Named pages and storage

`home-bookmarks.ts` validates presentation data and owns one edit session.
`home-layout-storage.ts` opens an independent `bookmarks-v1` record in the existing
`atlas-home-layout-v1` database, object store `layout`. Its envelope is
`{revision,value:{version:1,groups:[{parentId,pages:[{id,label,url}]}]}}`.
The category record `current` is unchanged. No authority schema changes,
cross-record transactions or migration writes at first load are introduced.

The ordered pin array stays in `atlas-home-pins-v1`. Without an explicit group,
pins use existing service entry points. Editing seeds those entries in memory;
only acknowledged Save creates an override. Pages have stable IDs and explicit
order. Validation requires names of 1–100 characters, supported full HTTP(S) URLs
of at most 4096 characters without userinfo, at most 100 pages per parent and 2000
pages total. Paths, queries and fragments are retained exactly. Parent IDs must
be valid destination-shaped IDs. No title fetching or full-URL diagnostics.

**Edit pins and pages** provides parent selection, editable name/URL rows, Add,
Move up/down, Remove, Save and Cancel. Unpin/repin uses the independent existing
pin save. Unpinning, renaming a stable parent or losing its availability retains
pages. Unavailable parents remain identifiable in the editor for explicit cleanup.
Changed parent IDs cannot inherit groups; parent changes never rewrite page URLs.
Removing every page and saving deletes only that override, restoring ordinary
entry points. Overridden groups also expose normal service entry points.

Atomic IndexedDB revision comparison prevents stale cross-window overwrites.
Failed or uncertain saves retain local edits and expose Retry; only acknowledged
data drives Home. Reading a complete matching candidate can reconcile an uncertain
write without replay. Conflicts retain the draft and require explicit review of
the newer group before another CAS attempt. Other parents remain intact; another
intervening write causes another conflict. Corrupt/unavailable storage never becomes
an empty reset. Unsaved fields live in the open editor; save before closing or
restarting Firefox. This is not a second persistent batch-workspace system.

Every launch passes the exact URL through the existing `OPEN_DESTINATION`.
A group, pin, saved URL, favicon or presentation revision is never permission.
Core still applies Blacklist, Greylist, grant and Journey rules.

## Chooser and compass

The native popover supports click/Enter/Space, delayed fine-pointer hover and Tab.
Hover never moves focus. Escape returns focus; outside interaction dismisses.
Rows reconcile by stable page ID without closing or replacing a valid focused
item. Lost authority disables launches; disappearing parents close safely.
Long panels scroll internally. Positioning runs when opened; outer scroll/resize
dismisses.

The single ring uses 56-pixel targets; native evidence compares six, eight and ten
groups at unchanged size. **Ten** is the selected capacity, in a 320 by 312-pixel
region with space for badges and focus outlines. Overflow is a labelled list,
never additional rings.
Zero pins show a prompt; one pin uses a compact labelled shortcut. Saved order and
the existing favicon lifecycle remain intact.

Rotation is local to `home-pins.ts`: center-only handle, native pointer capture,
six-pixel threshold. Positions rotate, logos remain upright, DOM/saved order stay
unchanged. Starting a drag dismisses the chooser. Release outside, cancel, lost
capture, blur, page hiding and disposal stop it. Only the handle intercepts touch
scroll. No inertia, settling/idle animation or writes; reduced motion therefore
has no animation to suppress. All pages work without dragging. Angle exists only
in the current control-page instance.

## Access, refresh and backups

Existing pending, confirmation-ready, grant and context-bound Journey summaries
retain scope, deadlines and existing controller actions. Name, scope, deadline and
action are grouped; empty sections take no space. No confirmation, renewal,
revocation or Journey transfer is created by Home.

The existing visible-page `RefreshLoop` refreshes bookmarks too; no new polling
owner or event bus. Keyed pin/chooser/editor nodes retain focus and icon identity.
Disposal closes repository connections and gesture listeners.

The older portable policy-backup snippet does **not** include bookmarks, category
layout or batch-draft IndexedDB records. A private full Firefox-profile backup
taken with Firefox closed includes them. Saved page URLs can contain private
paths/query values: never share a profile/bookmark dump as diagnostics. No portable
bookmark importer/exporter or authority restoration path is added.

## Verification

`home-bookmarks.test.mjs` covers validation, exact URLs, ordering, parent lifecycle,
independent revisions, reopen, conflicts, failed/uncertain saves, reconciliation
and corrupt storage. `home-workspace.test.mjs` covers disclosure, hidden categories,
history/loading and focus without preference changes. Existing Home/access,
icons, drafts and full regression suites remain.

`python extension/scripts/firefox_compact_home.py` creates a disposable copied
Firefox runtime without distribution policies and a separate profile. The signed
baseline is installed only there to retain the origin across restart; a temporary
development overlay supplies this change. `--baseline` uses the retained pre-change
checkpoint. Companion fixtures exercise trusted keyboard/pointer input, real
conflicting pages, injected save failure and local-server Core-gated launches.
Instrumentation is outside shipped assets. Screenshots and final measurements
are retained under `docs/evidence/compact-home/`.

The historical intermittent `INTERNAL_ERROR` remains unresolved and outside this
change. Synthetic unavailable projection does not reproduce or repair that cause.

## Recorded results — 2026-11-08

- Development build and both TypeScript compilers passed. Full suites: **557
  extension tests, 249 Core tests**, all passing.
- Native Windows Firefox **159.0.1** passed the complete workflow and separate
  stress fixture. Six/eight/ten groups retained 56-pixel targets; ten fit with
  separation and contained focus/badge space. Narrow windows and 125–200% actual
  Firefox zoom used the responsive layout without horizontal overflow.
- Rotation is retained. Native mouse input verified activation after dragging,
  release outside the handle, Escape cancellation and lost capture. Hover transfer,
  Enter/Space, Tab, Escape focus restoration and outside dismissal passed.
- Real independent control pages exercised CAS conflict review. An injected
  IndexedDB failure retained fields and old acknowledged Home until Retry. Twenty
  long named URLs, scrolling choosers, removal of every page, unavailable-parent
  cleanup, thirty categories and duplicate/missing icons were also checked.
- Local-server bookmark launches retained the selected full URL through
  `OPEN_DESTINATION`; a Blacklisted member was blocked before an HTTP request.
  Real Greylist wait/readiness/confirmation and expiry preserved original deadlines.
  Restart retained policy, Blacklist, settings, pins, layout, bookmarks and an
  existing destination draft. No normal Firefox profile was used.
- Matched fifteen-sample Home/Sites transitions measured **11 ms checkpoint median
  and 10 ms final median**. These short frame-bound samples do not establish a
  meaningful performance improvement. Both five-second idle observations had
  **zero replaced nodes, zero attribute changes, zero extra resource requests,
  five view requests, and at most one concurrent view request**.
- **242 protected Core-source/release hashes** matched the checkpoint. Adapter,
  background, identity and package files also remained unchanged. All nine task
  test profiles/runtime copies were removed after retaining evidence (about 4.2 GB).
  The 31 MB pre-change working-tree checkpoint remains in
  `.tools/compact-home/checkpoint.zip`.

Evidence: [verification JSON](evidence/compact-home/verification.json),
[Home](evidence/compact-home/home.png),
[bookmark chooser](evidence/compact-home/bookmark-group.png),
[expanded category](evidence/compact-home/category.png),
[category directory](evidence/compact-home/category-directory.png).

Limits: this is headless Windows Firefox evidence, not physical touch/trackpad,
screen-reader conformance or cross-platform certification. Search retains its
existing destination/entry-point behavior; named pages are reached through their
pin groups/editor. Unsaved bookmark edits remain page-local, with a browser unload
warning where supported. Existing portable policy backup excludes bookmarks;
full-profile backup includes them. No signing, install into the everyday profile,
deployment, version change, enterprise-policy edit, commit or push occurred.

