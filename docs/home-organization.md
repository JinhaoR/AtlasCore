# Milestone C — Home organization and navigation

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
