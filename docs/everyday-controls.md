# Everyday controls, stable Home and bookmark synchronization

## Current toolbar connection (2026-11-10 development)

The latest user-approved UX pass supersedes the folder/initial-preview behavior
below for new connections. **Connect Firefox bookmarks** requests the existing
optional permission and connects direct HTTP(S) bookmarks on Firefox's toolbar.
No preview or folder selection is needed. Folders (including an older Atlas
folder), separators and unsupported bookmarks are not synchronized or mutated.
The user explicitly chose deletion: unpinning deletes the corresponding
synchronized toolbar bookmarks. Saved Atlas pages remain available for repinning.
This consequence is stated next to the Settings connection control and in its
management dialog; it is not hidden behind a technical explanation.

Initial connection performs an additive union: native group order (by first occurrence), titles and IDs
are preserved, existing matching URLs are linked, and additional Atlas pages are
appended. Native duplicate bookmarks are retained. Explicit service identities or
exact-host fallback group multiple pages into one Atlas pin; no organization or
permission is inferred. A single-page group's label follows its bookmark title.
Firefox retains individual pages; Atlas shows their ordered group. Pages from
the same site occupy consecutive participating toolbar slots after a sync. Reordering
groups updates their direct toolbar page slots, without issuing folder mutations.
Moving a bookmark into a folder excludes it from sync; removing the last toolbar
page unpins the group without recreating links. Editing a bound page's URL retains
its stable page/group identity and still goes through the ordinary navigation gate.

The existing serialized owner, CAS envelopes, three-way merge and durable native
operation journal remain. `firefox-sync-v1` accepts an optional `scope: "toolbar"`
with fixed Firefox toolbar root and no archive. Legacy folder records remain
readable and keep their old behavior until the user connects the toolbar; the
conversion leaves their folders and pages untouched. An unresolved operation or
conflict must be reconciled/disconnected first. This is a presentation schema
extension: older builds cannot read a toolbar record. Back up before downgrading;
do not assume an older build can continue this connection. Access-policy schemas
are unchanged. Disconnect preserves both actual copies and stops synchronization.

Ordinary connection status is confined to the connection control. A paused sync
changes that control to **Bookmarks need attention**, opening the existing explicit
retry/conflict view. Authority failures, unsaved edits and destructive consequences
remain visible; no general success/status banner is added to Home. No additional
polling, permission, dependency or Core command is introduced.

Firefox API reference: [bookmark tree and operations](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/bookmarks).
Current [implementation and verification evidence](evidence/ux-toolbar-refinement/README.md).

## Earlier folder connection (retained compatibility behavior)

The following sections retain the earlier folder contract for existing records.

The later [Home category grid](home-organization.md#current-home-category-grid-2026-11-10)
replaces the separate directory and customization dialog. All visible categories
appear in the scrollable grid, with direct reordering. Category visibility/icons
and bookmark connection are available from Settings. The popup, sync and access
contracts below remain unchanged.

Home's **Firefox bookmarks** action opens the connection directly. It replaces
the prominent **Edit pins and pages** action: everyday bookmark management can
happen in Firefox after the one-time permission and merge preview. The optional
Atlas editor remains under **Settings → Home & categories → Advanced pin
editing**, preserving existing saved pages and an alternative for unconnected
pins. This is an entry-point/copy change, not a new synchronization mechanism.

Approved development scope (2026-11-09). This supersedes the old no-popup
guidance and the expanding inline category composition. No version, release
artifact, Core rule or installed Firefox profile changes are authorized.

The toolbar popup is read-only status plus links into the existing control page.
It cannot issue permission-changing commands. Home uses a stationary desktop
shell with a scrollable category/search panel and bounded access information;
small viewports retain a document-scroll accessibility fallback.

Home refresh reads saved category preferences alongside the authority query.
The main page omits connection/readiness chatter and category-loading text;
the reserved category area stays stable until verified data and acknowledged
preferences arrive. Popup status and actionable unavailable/recovery warnings
remain. See the [focused refresh evidence](evidence/home-refresh/README.md).

Everyday labels use Sites, Allowed, Blocked, Requires access request and Review
changes. Vault remains protected changes. Exact addresses, subdomain scope,
deadlines and consequences remain visible; technical diagnostics are disclosed.

Firefox bookmarks are optional presentation data. Opt-in permission and an
explicit initial merge connect only a selected/created Atlas folder. Site folders
contain ordered named pages. Unpin archives the folder outside the connected
root. Unknown/blocked shortcuts remain visible but never grant authority; all
launches pass through the existing adapter/Core gate.

One background synchronization owner serializes participating presentation
writes and records incomplete operations before browser mutations. Bookmark
events and startup reconciliation drive synchronization, not a second poller.
Revision checks protect editor work. Conflicts require a choice; failures retain
work and truthful retry feedback. Deleted roots pause rather than recreate data.
No full URLs enter diagnostics. Firefox-owned bookmark sync does not synchronize
Atlas permissions, timing settings, grants, Journeys or Vault proposals.

## Toolbar and control-page navigation

`manifest.json` supplies the extension-relative `ui/popup.html` as Firefox's
`browser_action.default_popup`. The old click-to-open-tab handler is removed.
The small popup bundle reuses `RefreshLoop`, countdowns and access copy; it has
one visible-document refresh owner and disposes it on pagehide. It does not load
policy history, the editor or the management UI. Unsupported browser pages have
neutral copy. Expired request/grant timing cannot appear as renewed permission.

The exact top-level popup sender may issue only `GET_TOOLBAR_STATUS` and
`OPEN_CONTROL_PAGE`. The latter accepts a closed page enum and explicit source
tab/context. Current-site access rejects a vanished or replaced context. A
same-window control page receives `CONTROL_NAVIGATE`, handled only by its matching
tab and existing navigation owner; there is no URL replacement that could erase
its editor. Otherwise a control page is created with an extension-relative URL.
Popup requests cannot invoke policy, recovery, access or presentation mutations.
This is a message boundary, not a separate extension-origin security principal.

## Stationary Home and editing

Desktop Home (at least 1100 CSS pixels wide and 760 high) reserves space for its
category/search area, compass, access summary and footer. Category selection,
the category directory and search replace the left workspace. Its contents
scroll; selection no longer scrolls the document. Longer access lists scroll in
their own bounded area. Narrow/zoomed windows use normal document flow and
labelled pins, so controls are not clipped to preserve a desktop composition.
Temporary browsing still uses the existing history owner and never changes
category visibility, order or collapse preferences.

Sites search with zero results seeds Add site's name from the trimmed query.
Recognizable HTTP(S) URLs/hostnames also seed a normalized hostname. Ordinary
names never generate a guessed domain. Existing dirty-editor protection runs
first. These fields remain an editable draft, not an access rule.

Reviews prominently retain exact hosts, current/proposed access, subdomain
consequences, wait and action. Internal identifiers and full raw change summaries
remain available in collapsed technical details. Immediate allowed-site removals,
mixed-batch protection and explicit Vault/access confirmation are unchanged.

## Bookmark persistence and reconciliation

`bookmarks/owner.ts` is the single background writer for participating pins,
named pages and sync operations. It contains no controller reference. The
existing category record is unchanged. `firefox-sync-v1` is an independently
revisioned record in `atlas-home-layout-v1` / `layout`, beside `bookmarks-v1`.
It stores explicit connected/archive folder IDs, stable site/page ↔ native node
mappings, shortcut labels, last synchronized groups, an incomplete operation
and any observed conflicting native values. The envelope uses atomic IndexedDB
revision comparison. All records are bounded and validated before use.

Limits are 200 connected site groups, 100 pages per group, 2000 pages total,
100-character names and 4096-character supported credential-free HTTP(S) URLs.
Paths, query strings and fragments are retained. Native folder selection is
explicit: a folder named Atlas is never adopted merely by name. The initial
preview unions supported pages; identical name/URL pairs are disclosed and
linked once. Two Firefox groups with the same site identity pause for manual
reconciliation. Unsupported schemes, separators, deep nesting and oversized
unconnected names remain in Firefox and are disclosed, not flattened/deleted.

Native events and startup drive sync. Changes outside the connected library
are ignored. Pin operations, page saves and label/order changes share the
serialized owner; order and labels have comparison guards and page editors
retain CAS conflicts. Independent page fields merge three ways. Overlapping
changes pause, retain both candidates, and require an explicit reviewed choice.
An intervening change invalidates that comparison. Clean editors refresh after
a native edit; dirty editors retain their input and show the newer-save conflict.

Before external writes, a durable intent records the complete target and local
revisions. Each native create/update/move/remove is journalled with its prior
values. Restart compares actual node IDs and contents; a lost create response
cannot blindly create a second folder. Native writes are checked before and
after applying. Observed overlapping updates are retained for explicit comparison
even if an in-flight Firefox API call completed first. Failed journal persistence
performs no native mutation. Partial completion is shown as a paused connection,
not a fully saved merge. Unknown outcome recovery is presentation-only; it does
not replay any Core confirmation.

Firefox bookmarks have no atomic transaction with IndexedDB and no conditional
update API. This journal is recovery and conflict detection, not a cross-store
atomicity claim. During failure one copy may temporarily be ahead. Native URL
canonicalization that differs from the requested exact value fails comparison
rather than silently changing an Atlas page URL. Resolve conflicts or disconnect
before reorganizing a partially completed library.

## Lifecycle and visibility

Unpin moves the tracked group to a separately tracked **Atlas — Unpinned** folder
outside the synchronized root, preserving saved pages. Repin restores that group.
Moving a group out or deleting it unpins it while retaining Atlas pages. Deleting
the last page in a connected group empties and unpins it; it must not recreate
default links. Without a connection, removing all overrides retains the previous
normal-entry-point behavior. Explicit disconnect stops incomplete work and keeps
both actual copies; reconnect requires a new preview. Permission revocation
pauses sync and removes listeners. Deleting the connected root pauses and never
automatically recreates it.

Unknown and manually blocked bookmarked sites remain in the pin presentation
and its page editor. They are not inserted into the allowed-site index or policy.
Labels distinguish saved rules/temporary access from an unverified state or a
site needing an access check. Safety rules and all authorization are evaluated
again by the ordinary `OPEN_DESTINATION` gate. Group labels affect shortcuts,
not the site's policy identity. Unpinning never revokes a grant or changes policy.

Firefox's own account sync may transport native bookmarks if the user enabled it;
Atlas does not sync policy/settings between profiles or devices. Native node
IDs and connection records are profile-specific. See the privacy and backup
documents before copying a profile or exporting pages.

Historical `INTERNAL_ERROR` remains unresolved and outside this change.

## Trying the development interface

1. Open the Atlas toolbar popup for status and shortcuts. **Current site access**
   refers to that source tab, not an arbitrary recent tab. Confirmations and edits
   still happen in the existing control page.
2. On Home, choose a category or search. On desktop the results scroll inside the
   workspace; Tab can focus the region and Page Down can scroll it. Narrow windows
   and high zoom use the document-scroll fallback.
3. On Home, choose **Firefox bookmarks** (also available from Settings).
   Click **Allow Firefox bookmark connection**, then accept Firefox's
   optional permission prompt. Select a folder or **Create a new Atlas folder**.
4. Preview the merge, including excluded/duplicate entries, before connecting.
   Then manage the connected folder in Firefox's bookmark editor. Supported
   changes appear in Atlas automatically; Atlas pin edits also sync back.
   Each pinned site has a folder containing its pages. Unpinning moves that
   folder into **Atlas — Unpinned**, preserving its bookmarks. The optional Atlas
   editor is under **Settings → Home & categories → Advanced pin editing**.
5. A paused connection offers retry, reconnection or comparison as appropriate.
   Conflicting values require an explicit choice. Disconnect keeps both copies.

The [popup manifest](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_action)
and [Bookmarks API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Work_with_the_Bookmarks_API)
are Firefox interfaces. Their use stays outside Core. Firefox GUID underscores
are encoded as dots in Atlas page IDs (native GUIDs contain no dots); native node
IDs remain separately recorded, preserving identity through restart and renames.

## Verification and development boundary

Evidence and limitations are in
[the verification report](evidence/everyday-controls/README.md). The task checkpoint
is `.tools/everyday/checkpoint.zip`. Existing release assets were compared against
the pre-task SHA-256 inventory, not rebuilt.

Reproduce the checks from the repository root:

```powershell
npm.cmd --prefix extension run build
npm.cmd --prefix extension run test:built
npm.cmd --prefix packages/core test
python extension/scripts/firefox_compact_home.py --everyday-only --signed-baseline 0.2.2
```

The native script uses a copied Firefox runtime without enterprise distribution
files and a disposable synthetic profile. The optional permission prompt is
accepted only inside that fixture. It does not use an everyday profile.

The subsequent signing-preparation request promotes this work into unsigned
[0.2.4](release-candidate-0.2.4.md), preserving signed 0.2.3. Its versioned release
inventory adds `ui/popup.html`, `ui/popup.js`, `ui/popup.css` and the later polish's
`ui/startup.js`. Old release inventories remain unchanged. Packaging does not
sign, submit, deploy or change the everyday Firefox installation.

## Automatic toolbar connection and folder projection (development)

The current user-approved refinement makes `bookmarks` a required permission.
Firefox owns install/update permission consent. Once available, startup connects
the toolbar using the existing additive, journaled synchronization operation;
there is no new preview. Explicitly disconnected installations stay disconnected.
Pending/conflicting external operations are never silently discarded or replayed
as a new connection. Settings retains recovery and disconnect controls.

Toolbar folders now appear on the compass as read-only groups. Atlas never moves,
renames or deletes those folders or their children. Supported HTTP(S) pages are
projected with bounded depth/counts and exact URLs; unsupported items remain in
Firefox. An independently revisioned `toolbar-folder-icons-v1` record is presentation
only. Folder events use the same serialized owner and page refresh loop. Existing
direct-bookmark unpin/deletion semantics remain unchanged. The original sync record schema stays unchanged and readable by older builds;
explicit disconnect is identified by its existing disabled, previously connected
state. Backup the presentation database and Firefox bookmarks
together to preserve folder icon IDs. No permission/policy synchronization occurs.
