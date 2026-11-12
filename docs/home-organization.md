# Milestone C — Home organization and navigation

## Home balance and category ordering (development after prepared 0.3.0)

Home moves its Atlas logo/wordmark into the centered content, replacing the slogan.
Desktop content is centered in the space below the navigation header, with an
accessible scrolling fallback on shorter/narrower windows. The verified-empty
Greylist stays hidden; one row grows to two before the region scrolls. On centered
desktop Home, its wrapper always reserves the two-row footprint (146px including
padding/border), with visible boxes aligned to the top. Appearing, growing or
disappearing requests therefore cannot recenter the logo, search or compass.
Narrow/short layouts keep normal document flow and hide the empty wrapper.
Journey and unavailable-state messages keep their existing meanings. See
[Greylist layout measurements](evidence/greylist-layout/README.md).

All Sites offers **Alphabetical**, **Most used**, and **Custom order**. Existing
users begin with their saved custom arrangement. Most used sums the existing
seven-day-decayed site usage scores once per stable site identity; ties are
alphabetical. It changes display order only. Changing modes retains custom order;
dragging or Alt+arrow movement stores the displayed arrangement as Custom in one
acknowledged save. Empty categories remain absent from the directory; new ones
append alphabetically to the saved custom order. Whole-category renames retain
position only when exact membership establishes an unambiguous match.

`category-order-v1` is a separate bounded CAS record in `atlas-home-layout-v1`.
It stores mode, ordered keys and a membership/layout snapshot for safe rename
reconciliation. The old layout/icon/pin/bookmark records remain unchanged and
readable by previous releases. Older releases ignore this new ordering record.
The existing refresh owner observes other pages' acknowledged writes; no new
polling loop or Core authority input is added. Failed/uncertain writes retain the
draft and offer Retry; conflicting writes require explicit Load saved order.

Completed change receipts no longer occupy the Sites footer. They remain stored;
pending, unresolved and failed outcomes retain their existing controls. Category
drop previews stay in place through persistence, then remove transforms and apply
the acknowledged DOM order together without a second reverse animation.

Native checks and limits: [Home balance evidence](evidence/home-balance/README.md).
The already prepared 0.3.0 candidate is unchanged and does not include this work.

## Current Home / All Sites separation (2026-11-11 development)

This section supersedes earlier Home-category composition below. Home is a
launchpad: search, centered responsive compass, and relevant Greylist/Journey
summaries. Empty verified Greylist consumes no space; unavailable authority still
has truthful recovery information. Pins, folder/bookmark synchronization and the
ordinary navigation gate are unchanged.

All Sites opens a complete category grid with icons and site counts, followed by
category contents or the complete directory on request. Existing canonical category
identity and acknowledged saved order are reused. Drag and Alt+arrow ordering now
operate in this grid. Category views never write preferences. The old Home workspace
owner and expanding-category markup are removed.

Legacy visibility/collapse preferences remain stored unchanged, but do not conceal
anything in the complete directory. Their obsolete Home visibility checkbox is no
longer presented. Settings retains icon selection and pin settings. Empty category
definitions remain in presentation storage and Settings; empty directory tiles are
omitted. A missing category uses Uncategorized. New nonempty categories follow the
existing layout reconciliation rules.

Both search fields use anchored, internally scrolling results over existing content.
Home keeps the existing exact-entry-point launcher and adds category navigation.
All Sites searches names, hosts and categories within the access filter; suggestions
show up to twelve sites plus a View all results action. Category matches navigate
without changing access. Escape/outside interaction dismisses results. Directory
selection uses the existing history owner for Back/Forward/reload; list scroll and
selection retain their existing navigation state.

Site inspection, Add and Edit share one native modal dialog containing the existing
editor. Dismissal returns to the directory and retains editable work. Explicit Close
editor retains its existing discard-editor-only meaning; staged changes survive.
Validation focuses the invalid field; delayed initial focus cannot override it.
Only an acknowledged stage/save closes the editor. Failed saves retain fields and
local error/retry feedback in the dialog. Batch review and frozen Vault review keep
their existing transitions and authorization boundaries.

Owning implementation: `ui/main.ts`, `sites.ts`, `site-directory.ts`,
`home-shortcuts.ts`, `home-organization.ts`, `viewport-scroll.ts`, and the existing
HTML/CSS assets. No database migration, new schema, dependency or Core change.
See [native evidence and verification](evidence/home-directory/README.md).

## Category and grant polish (2026-11-11 development)

Opening a category shows all its destinations immediately in the existing scroll
panel. Show all/fewer and the preview limit are removed. Cards remain lazy until
their category is opened; selection still does not rewrite saved visibility,
collapse or order preferences. Search, exact launch URLs and history are unchanged.

The icon picker now has 28 local SVG choices, including brain, atom, calculator,
science, globe, cloud, tools, music, camera, health, calendar, chart, nature, coffee,
games and film. These are Atlas source drawings in `src/ui/assets/index.html`,
selected by `src/ui/category-icons.ts`, not an external icon service or library.
The existing independent CAS icon record is unchanged. Old selections remain valid;
a downgrade to 0.2.7 cannot read newly selected icon names and reports unavailable
icon preferences. Select Automatic/one of the original icons before such a downgrade.
Category layout and permission stores remain independently readable.

While the compass is being dragged or coasting, hover labels and delayed page
choosers are suppressed. A native mouse test reproduced moving shortcuts showing
labels and opening a chooser that abruptly stopped rotation. Explicit click/focus
still stops motion and activates the shortcut; hover works again after settling.
The motion curve, upright logos, pointer capture, reduced motion and saved order
are unchanged. This is a bounded hover fix, not a claim about all graphics issues.

Active Greylist grants expose **End access** on Home and in site access details.
This runs the Core `END_ACCESS` transition through the controller; it ends the full
displayed alias scope. Only a successful committed removal disappears from Home.
Other grants and pending requests keep their deadlines. Failed/uncertain commands
keep truthful recovery feedback; repeat confirmation cannot restore an ended grant.
See [architecture](architecture.md) for the newly authorized domain transition.

## Home motion and global access overview (2026-11-10 development)

Home is a general launcher, not the access view of the last site it opened.
Ordinary launches no longer select an access context, and the Current tab access
button and selected-tab Journey strip are removed. Explicit popup access links,
request links and Journey links still select their actual owning context through
the existing navigation owner; a missing context is never replaced with another.

The **Greylist** box shows pending requests and active temporary grants, with its
count beside the heading. Its scroll region fits two ordinary rows; additional
items scroll inside it without moving search or the compass. It reserves its
space during loading and when empty. Unavailable authority remains visibly
unavailable, and all launch/review actions retain their existing gate. Active
Journeys appear in a separate labelled box, including any previously selected
context. They are not Greylist grants and do not contribute to the Greylist count.

Home starts below the navigation rather than vertically centering the entire
composition. Short desktop windows use tighter introduction spacing; narrow or
zoomed windows retain document scrolling instead of clipping controls.

The compass artwork now rotates with the pin positions; website logos stay
upright. Pointer timestamps and available coalesced samples determine the angular
path. A recent-sample slope estimates release speed, while pausing before release
stops a stale fling. Exponential friction is integrated independently of frame
rate, with a gentler 700 ms decay constant, a capped speed and a four-second
maximum coast. This supersedes the earlier 1.6-second limit below. Reduced motion
disables coasting. Existing cancellation, authority-loss and disposal paths stop
motion; rotation never changes saved order or writes storage. No idle animation
or extra refresh owner was added.

[Focused tests and native screenshots](evidence/home-motion/README.md) distinguish
real Firefox pointer/layout evidence from synthetic UI status fixtures.

## Interaction refinement (2026-11-10 development)

Category dragging shows a cursor-following card and animated insertion space.
The preview transforms existing nodes; only a completed drop calls the existing
revision-checked layout save. Escape, cancellation, hiding, blur or a lost source
cancel the preview. Keyboard Alt+arrow ordering remains on Home. Settings has no
ordering arrows: click an icon to open the local visual picker (Tab/arrows,
Escape, outside dismissal). Visibility remains separate from pins and authority.
Failed saves retain the requested choice and retry controls; routine status copy
is omitted.

The larger centered Home retains its bounded category/search pane. The wheel
has no side scrollbar; extra pins use the labelled overflow disclosure. Its drag
surface covers the rings behind the independently clickable pin buttons. Only an
intentional drag starts a bounded coast: velocity is capped, decays with friction
and stops within 1.6 seconds. Reduced motion disables coasting. Cancellation,
page hiding, navigation, authority loss and disposal stop motion. Logos stay
upright; DOM order, saved order and angle persistence do not change.

Vault is a Settings section. Existing `#vault` links, popup shortcuts, review,
confirmation and Back/Forward still use the same navigation/workflow owner. The
curated restore action is a Recovery disclosure rather than a separate tab.
Empty/completed Sites drafts no longer show a large summary box; saved receipts
remain in a compact disclosure. Active drafts, conflicts and pending saves keep
their existing review actions.

Everyday static interface copy is editable in `extension/src/ui/ui-text.ts`.
HTML placeholders are escaped and resolved during the build, adding no startup
work or flashing. Technical codes and dynamic authorization/review consequences
remain with their presenters. The search-shortcut hint and routine drag/status
helper text are removed. The new toolbar-only bookmark connection is described
in [Everyday controls](everyday-controls.md#current-toolbar-connection-2026-11-10-development).
See the [implementation and native evidence](evidence/ux-toolbar-refinement/README.md).

## Current Home category grid (2026-11-10)

Home shows **every visible, nonempty category** in saved order, in one scrollable
grid beside the pinned compass. The six-shortcut cap, separate All categories
directory, Open a specific address form and Customize Home dialog are removed.
The composition is narrower and centered, with a bounded desktop workspace;
short/narrow or zoomed windows retain document scrolling. Search/category results
replace the same left pane without moving the compass or search field.

Drag a category onto another to move it to that position. A six-pixel threshold
separates drag from opening; release outside, Escape, lost capture, page hide and
pointer cancellation cancel the drag. A completed drag does not open a category.
Alt + arrow keys moves the focused category. The later interaction refinement
removes Settings ordering arrows. No drag library, idle animation or saved drag
coordinates are used. Categories use the existing layout CAS session; only a
successful acknowledgement changes Home's resting order. Failed saves retain the
requested arrangement and show recovery instructions, with retry/reconciliation
under **Settings → Home & categories**. Hidden/empty definitions retain their
preferences. Pins, search, variants and access authority are unchanged.

Settings contains visibility controls and a per-category icon picker.
Twelve bundled SVG symbols are available, plus Automatic
to restore the name-based icon. Custom categories use the same choices. No remote
images, new permission or uploaded markup is involved. Visibility remains saved;
hidden categories are manageable in Settings and their sites remain searchable.
Opening a category does not change saved collapse/visibility. Closing returns to
its grid trigger; history/reload restore selected categories. Old `all` history
routes safely resolve to the grid.

Icon overrides are bounded canonical-category-key/local-symbol pairs in the
independent `category-icons-v1` record of `atlas-home-layout-v1`. The existing
layout record and its version stay unchanged, allowing older builds to keep
reading it. The icon record has its own atomic revision comparison. Only
acknowledged icons drive Home; failed or uncertain writes retain the Settings
selection. Retry reads back uncertain results before writing. Conflicting pages
cannot overwrite newer icons without an explicit reconciliation. Removed
categories retain their icon choices; no icon is inferred for a different
category identity. Automatic remains the fallback for new identities.

The existing visible-page refresh owner reads icons alongside layout; there is
no additional polling owner. Unchanged reads do not replace grid nodes or fetch
icons. Presentation records cannot create or modify Core permission. Full-profile
backup includes the new record; portable policy backup and native bookmark sync
do not. See [verification and screenshots](evidence/home-category-grid/README.md).

This user-requested composition supersedes the directory/modal descriptions below.
No version bump, release rebuild, signing or everyday-profile change is included.

The subsequent pin-control simplification replaces Home's **Edit pins and pages**
button with **Firefox bookmarks**, opening the existing optional connection.
Users can manage the connected folder in Firefox; the Atlas-specific editor is
retained under Settings → Home & categories → Advanced pin editing. Existing
pin/page data, bookmark synchronization and browsing authorization are unchanged.

**Current development:** [Everyday controls](everyday-controls.md) adds optional
native bookmark synchronization and a bounded Home browsing workspace. Category
identity, saved order, visibility and collapse remain governed here; temporary
category/search browsing does not modify those preferences. The connection is
presentation-only and uses the existing pin and named-page stores.

**Earlier presentation:** [Compact Home](compact-home.md) replaces the large
hero with inline browsing and a category directory, and adds independently
revisioned named page bookmarks. Explicit category selection reveals even a saved
collapsed category without changing preferences. Older composition and
heading-collapse descriptions below are historical.

The [0.2.1 repair](startup-layout-0.2.1.md) puts category content in a bounded
desktop scroll pane and Customize Home in a native modal. Heading/Close and
acknowledged save/failure/retry feedback stay visible. Escape/Close restores the
trigger and preserves unsaved arrangement state. Category layout storage/CAS,
pins, search and authority remain unchanged; there is no Apply step.

The user-authorized [0.2.0 refinement](visual-refinement-0.2.0.md) supersedes the
original rail/card composition: category sections occupy a Home workspace instead
of always appearing below the hero. The order/visibility/collapse storage,
conflict, search and pin contracts below are unchanged. Merely browsing a category
does not save preferences or expand a collapsed category.

## Contract recorded before implementation (2026-10-12)

Home orders search, explicit pins, current access summaries, then chosen category
sections. Sites & Access retains the complete collection and Milestone B workspace.
The current palette, cards, icon rail, exact targets and five-column maximum remain.

One compact **Customize Home** panel controls category order and visibility with
checkboxes and Move up/down buttons. Each visible category heading toggles complete
collapse. Show all/fewer remains a separate, less prominent preview control.
Pins and search use the complete active index regardless of category visibility.
Empty categories have no Home row; saved layout records remain for later reuse.

Layout uses Milestone B's canonical category keys, normalized display labels,
visibility, collapse, and stable destination IDs for conservative rename detection.
On first use, seed the existing visible order with nothing hidden or collapsed.
New categories append in deterministic label order and start visible. Case/spacing
normalization retains identity. A different key inherits preferences only when one
disappeared category and one new category have exactly the same complete destination
membership; splits, merges and partial moves keep separate preferences.

An extension-local IndexedDB presentation record uses a schema version and atomic
revision comparison, following the existing draft storage conventions. It does not
share the Core repository or modify destination metadata/pins. Other pages refresh
their saved layout; an unsaved arrangement is preserved as a labelled local draft.
Conflicting writes require explicitly loading the newer layout. Failed or uncertain
writes publish no saved success and expose retry. Unavailable/corrupt layout storage
cannot reset policy or silently replace saved presentation.

Home access links select an existing owning context and open the existing access
panel. Grants can open an exact hostname through `OPEN_DESTINATION`. A saved pending
request without a tab can explicitly open that exact address through the same gate,
which resumes the existing workflow. No new confirmation, renewal or revocation is
introduced. Journeys are shown only with their owning live adapter context.
Unavailable authority offers no actionable permission claim. Empty summaries take
no space; the view is current status, not history.

Sites retains selection, search/filter and list scroll in per-page session state;
Milestone B alone owns editor fields and draft durability. Editor placement keeps it
beside the selected list on wide screens. Close/save returns focus to that row when
available. Small history states support Home/Sites/Settings/Vault/access navigation,
including Back and a return-to-Sites link, without a routing framework. Reusing an
existing control tab activates it without replacing its URL or discarding its work.

Sites submission and post-commit display preparation read the current controller
view at their existing baseline/receipt verification points. A bounded read-only
retry (up to one second) lets transient LOADING/COMMITTING housekeeping settle;
only READY with a saved snapshot is accepted. Unavailable/uncertain authority
stops preparation and preserves the draft or receipt. Actual changed baselines
still conflict. This never retries Propose/Confirm or changes Vault protection.

This user-authorized milestone supersedes the earlier Home-organization deferral.
Core semantics and schemas, protected timing, Vault, grants, Journey and Download
Intent rules are unchanged. Version, extension identity, signed 0.1.14 assets,
enterprise policies and normal Firefox profiles remain untouched. Milestone D is
out of scope.

## Validation

### Implementation map

- `extension/src/ui/home-layout.ts`: canonical category catalog, migration, order,
  visibility and collapse. Schema 1 stores `{version:1,categories:[{key,label,visible,
  collapsed,members}]}`; membership is presentation identity used only for rename
  detection. The envelope's revision is separate from Core's policy revision.
- `home-layout-storage.ts` and `home-layout-session.ts`: the
  `atlas-home-layout-v1` IndexedDB record, atomic revision comparison, acknowledged
  layout, retained local draft, explicit retry and conflict recovery. In-flight
  background reads settle before accepting a layout click. Another page's updates
  are observed through the existing one-second UI polling cycle.
- `home-organization.ts`: one bounded, scrollable customization panel with labelled
  checkboxes and keyboard-accessible Move up/down controls. Busy saves restore
  focus when Firefox disables the active control; closing retains Home context.
- `home-access.ts`, `adapter/temporary-access.ts` and `main.ts`: read-only pending,
  grant and context-bound Journey summaries and links to the existing access panel
  or `OPEN_DESTINATION`. Last acknowledged grant information stays visible during
  housekeeping, with actions disabled until Core is READY.
- `navigation-state.ts`, `verified-view.ts`, `sites.ts` and `main.ts`: per-page
  selection/filter/scroll, small history routes and fresh read-only verification.
  Editor fields and batch receipts remain exclusively in Milestone B's workspace.
  Existing editor markup moves beside the list on wide screens; closed/saved
  editors return focus to the selected row. The toolbar activates the existing
  control page without reloading it.
- `assets/index.html` and scoped `assets/style.css` adjustments: Home hierarchy,
  compact controls and responsive editor placement; palette, rail, icons, serif
  headings and fixed-height launchers retain their previous design.

### Evidence

The focused regressions are in
[`home-organization.test.mjs`](../extension/tests/home-organization.test.mjs), with
native scenarios in
[`firefox_home_organization.py`](../extension/scripts/firefox_home_organization.py).
Native Firefox **157.0.1** completes **14 Milestone C check groups** in a disposable
profile, including a complete process restart over the preserved signed baseline.
The tests check actual committed metadata, not success-like words in an error.

The native run covers five/fifteen/thirty populated categories, reorder/hide/
collapse, pins and exact search, safe whole-category rename, failed presentation
transactions and explicit retry, simultaneous writes from two live control pages,
keyboard activation/focus, repeated usage updates, Sites selection/scroll/editor
reload, browser Back, Vault return, pending/ready request links, explicit grant
confirmation, fixed deadlines, owning Journey tabs and unavailable authority.

Actual viewport widths **500, 800, 1280 and 1800 px** render **2, 3, 5 and 5**
columns respectively, with 56px card frames around existing 54px launcher buttons.
Real Firefox **125%, 150% and 200%** zoom yields widths **1024, 853 and 640 px**;
all tested layouts remain within five columns without horizontal overflow.
Native screenshots were inspected:
[customization](evidence/atlas-home-customization-milestone-c.png),
[Sites context](evidence/atlas-sites-navigation-milestone-c.png), and
[access links](evidence/atlas-home-access-milestone-c.png).

Final automated totals and the retained native regression runs are recorded in
[the acceptance report](acceptance-tests.md#home-organization-evidence-milestone-c)
and [sanitized evidence](evidence/firefox-home-organization-milestone-c.json).

### Compatibility and limits

Core source, snapshot schema and authorization semantics do not change in this
milestone. Category visibility, order and collapse never enter navigation inputs.
Existing destination metadata, canonical categories, pins, drafts and frozen Vault
terms retain their formats. No dependency, permission, extension ID or version
change is made. Signed 0.1.14 and installed/enterprise Firefox configuration remain
untouched; offline release verification retains the original XPI hash. No signing,
submission or publication is performed.

Failed layout drafts survive in the current page; losing the page before a
successful save can lose that arrangement. Show all/fewer is intentionally
page-local; complete collapse is persistent. Ambiguous partial category moves do
not inherit hidden/collapsed preferences. There is no separate empty-category
creation registry in Milestone B; retained metadata and unused layout records are
preserved. Presentation preferences remain profile-local and outside policy
backups. Physical power-loss, other Firefox versions, windows below the tested
500px viewport and complete assistive-technology conformance remain unverified.
Visual consistency was outside Milestone C. The subsequent
[Milestone D report](visual-polish.md) owns its rendered refinements and evidence.

## Home simplification (development, after 0.2.7)

### Current Home hierarchy refinement (after signed 0.2.8)

The centered Home content caps at 1140px. The main panel gives approximately
35% of its width to the category column and 65% to the compass. It uses a quiet
navy surface, a 420–460px desktop height and a centered circular composition.
The search outline retains the strongest frame. Narrow windows/high zoom retain
labelled pin rows and document scrolling instead of compressing the compass.

Categories use 52px rows, 10px gaps and a five-row viewport at rest. This limits
the viewport, not membership: every visible saved category remains reachable by
scroll or keyboard. CSS proximity snapping helps settle scrolls at row boundaries;
rows naturally pass the edge during scrolling. No scroll measurement loop or
new navigation path is introduced. Opened category results use available-width
columns with a 250px minimum where space permits, avoiding unreadable tiny cards.

The Greylist strip sizes to an empty message or one complete status row, then
scrolls for further entries. Existing red cancellation, explicit Allow and gated
Open actions are unchanged. Category browsing does not resize the main panel.

The rotating pin layer has an explicit stacking level above the transparent drag
handle. Only pin descendants receive pointer events on that layer; empty ring
space reaches the handle. Previously the transform created a stacking context
below the handle, so normal pointer clicks hit the handle instead of the pins.
Programmatic `.click()` tests did not exercise this error. The native regression
now uses actual WebDriver pointer and keyboard actions. See
[measurements and screenshots](evidence/home-hierarchy/README.md).

The paragraphs below retain the earlier implementation history.

Home uses a single scrollable category column (about five visible choices), a
larger compass without a visible Pins heading, and a one-row Greylist strip.
Category order/visibility/identity remain unchanged. Native toolbar folders are
read-only compass groups, including nested supported pages with path labels.
Folder icons use the local palette and acknowledged, conflict-checked presentation
saves. More than ten groups use nine shortcuts plus a More bookmarks chooser.

The standalone Site access screen is replaced by Home's Greylist controls. Legacy
access URLs still select their explicit original context on Home; they never pick
another tab. A consistent red Cancel button sits to the left of Request access,
Waiting, Allow and Active. Waiting is status only; ready requests require explicit
Allow. The active green control opens the site through the ordinary gate; its
separate Cancel ends the grant. Exact frozen hostnames remain visible. Confirm
uses the existing CONFIRM_ACCESS command, then a separate gated Open action.
Journeys remain context-bound, with separate End/Start again controls. No Home
read or timer creates permission. Routine success banners are suppressed; errors
and uncertain outcomes remain actionable.

Cancelling an unstarted prompt dismisses its selected route without changing
authority. Cancelling a pending request or active grant clears that route only
after a COMMITTED response, fenced to the original context and navigation.
The URL's intercepted-tab parameters are removed so reload does not recreate the
cancelled prompt. Failed or uncertain saves keep it visible for retry. A later
explicit navigation can request access normally. Existing Journey controls remain
separate. See [native cancellation evidence](evidence/greylist-controls/README.md).
