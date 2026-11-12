# Atlas Firefox 0.2.5 — unsigned signing candidate

This candidate packages the completed [Home category grid](home-organization.md)
and direct [Firefox bookmark connection](everyday-controls.md). Signed 0.2.4 and
every older release remain frozen. Preparation does not sign, submit, deploy,
change enterprise policies or touch the everyday Firefox profile.

## Changes since signed 0.2.4

- Home shows every visible, nonempty category in one scrollable grid beside the
  compass. The separate All categories directory, Open a specific address form
  and Customize Home dialog are removed. The centered desktop composition stays
  bounded; narrow and zoomed windows retain normal document scrolling.
- Drag categories to reorder them. Alt + arrow keys and Settings Up/Down controls
  offer alternatives. Changes use the existing acknowledged layout save; failed
  or conflicting writes retain work and offer retry/reconciliation.
- Settings → Home & categories contains visibility/order controls and a choice
  of twelve bundled category icons, including for custom categories. Automatic
  restores the existing name-based icon. No remote icon service or asset is added.
- Home's Firefox bookmarks button opens the existing optional connection. After
  permission, folder selection and merge preview, users can manage the connected
  bookmarks in Firefox. The detailed Atlas editor remains under Settings → Home
  & categories → Advanced pin editing. Existing saved pages are retained.

## Persistence, permissions and compatibility

Core, the Firefox authorization adapter, background, synchronization owner and
authority repository are unchanged. So are required/optional permissions,
dependencies, the relative Home/new-tab overrides and extension identity
`atlas-development@atlas.invalid`. No curated or authority migration is added.

Existing policy, settings, pending requests, grants, Vault proposals, drafts,
pins, named pages, bookmark connections and category preferences are retained.
Category order/visibility/collapse still use the existing layout record.
`category-icons-v1` is an independent, bounded presentation record in the existing
Home database, with atomic revision comparison. Missing records use automatic
icons; no startup write is required. Older builds ignore the new record without
rewriting it. Full-profile backups include it; portable policy backup and Firefox
bookmark synchronization do not. Category choices never authorize navigation.

Hidden/empty category preferences remain saved; hidden sites remain searchable
and manageable, and their pins remain visible. Explicit category browsing does
not change saved collapse/visibility. Legacy directory history resolves to the
grid. A different canonical category identity does not inherit another icon.

## Verification and limitations

[Release evidence](evidence/firefox-release-0.2.5.json) records complete regression
results, packaged native checks, signed-0.2.4 upgrade/restart/rollback, archive
hashes and clean reviewer-source reproduction. Earlier feature evidence is in
[category-grid verification](evidence/home-category-grid/README.md) and
[bookmark entry verification](evidence/bookmark-home-entry/README.md).

The historical intermittent **INTERNAL_ERROR remains unresolved**. This release
does not change its recovery rules or claim a multi-day reliability fix. Idle
checks establish quiet DOM/resource behavior only in their controlled fixtures;
no general performance speedup is claimed.

Native evidence uses Windows Firefox and disposable profiles. Physical touch/
trackpad dragging, screen readers and other operating systems are not independently
verified. Headless Marionette does not establish physical toolbar-click or popup
keyboard behavior. Keyboard category ordering and Settings controls remain
available. Temporary unsigned upgrade/rollback tests do not establish Mozilla's
eventual permanent signed update. Firefox owns optional-permission notices.

The runtime retains the same 27 named assets, without maps, test instrumentation,
profiles or credentials. Dependency audit and Mozilla lint observations are
recorded in the release evidence; the locked toolchain is not upgraded here.

## Artifacts and separate signing step

`extension/release/0.2.5/` contains:

- `atlas-0.2.5-unsigned.zip`
- `atlas-0.2.5-source.zip` — original source, tests, locked toolchain and reviewer instructions
- `release.json` — source/runtime/archive hashes and lint report
- `addon/` — validated runtime staging

After securely supplying `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` in your own
terminal environment, run from the repository root:

```powershell
npm.cmd --prefix extension run release:validate
npm.cmd --prefix extension run release:sign
```

The latter command submits to Mozilla's **unlisted** channel; preparation does
not run it. Signed output will be `extension/release/0.2.5/signed/*.xpi`.
After download, verify offline without credentials:

```powershell
npm.cmd --prefix extension run release:verify-signed -- 0.2.5
```

Deployment remains separate. Back up and update in place under the same extension
ID; do not uninstall Atlas or replace saved policy with curated defaults.
