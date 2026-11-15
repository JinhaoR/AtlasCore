# Bundled themes

Themes are static visual values and assets. Core owns policy and authorization;
Firefox owns shared DOM, layout, components, interaction, navigation and theme
preference application. The root [`themes/`](../themes/README.md) tree makes that
ownership explicit without changing runtime paths or appearance.

## Source and runtime map

| Repository source | Firefox runtime output |
| --- | --- |
| `themes/shared/default.css`, `light-test.css` | `ui/themes/default.css`, `light-test.css` |
| `themes/shared/fonts.css`, `fonts/` | `ui/fonts.css`, `ui/fonts/` (including licences and source hashes) |
| `themes/celestial/theme.css`, `assets/` | `ui/themes/celestial.css`, `ui/themes/celestial/` |
| `themes/parchment/theme.css`, `assets/` | `ui/themes/parchment.css`, `ui/themes/parchment/` |
| `themes/ARTWORK.md` | `ui/themes/ARTWORK.md` |

`extension/build.mjs` uses the existing closed IDs in `ui/theme.ts`. It replaces
only the generated theme asset subtree on build, preventing retired assets from
lingering. HTML still links bundled styles before visual content, with the same
synchronous `theme-startup.js` entry. No runtime discovery, remote code, plugin
registry, component duplication or dependency is introduced.

`extension/src/ui/assets/style.css` owns layout, responsive rules, component
selectors, interactive geometry, overflow, focus and motion. `popup.css` owns
popup layout and consumes the same visual values/fonts. `ui/ui-text.ts` owns
selector labels and save/read failure copy. The six local font faces are shared
across themes and retain their original bytes/licences.

## Contract

`themes/shared/default.css` is the authoritative, readable list of supported values. Main roles:

| Role | Properties |
| --- | --- |
| Page and text | `--page`, `--page-background`, `--ink`, `--muted`, `--link` |
| Surfaces and interaction | `--surface`, `--surface-disabled`, `--surface-quiet` (categories and Home access summary), `--hover`, `--selected`, `--accent`, `--accent-muted`, `--accent-hover`, `--on-accent`, `--focus` |
| Borders | `--border`, `--border-soft`, `--control-border`, `--border-width` |
| Semantic state | `--success*`, `--warning*`, `--error*`, `--unavailable*`; `--access-wait-*`, `--access-active-*`, `--cancel-*` |
| Type | `--font-title`, `--font-body`, `--font-mono`, `--font-search`, `--search-font-style`, `--search-font-weight`, `--text-*`, `--weight-*`, `--heading-*`, `--subtitle-size`, `--wordmark-spacing` |
| Shape/elevation | `--radius`, `--radius-card`, `--radius-dialog`, `--radius-panel`, `--radius-search`, `--backdrop`, `--popover-shadow`, `--floating-shadow`, `--category-shadow`, `--search-shadow`, `--search-surface` |
| Icons and pins | `--icon-surface`, `--icon-border`, `--pin-surface`, `--pin-ink`, `--pin-border`, `--pin-border-width`, `--pin-shadow` |
| Compass | `--compass-ring`, `--compass-ring-width`, `--compass-ring-dash`, `--compass-tick`, `--compass-tick-length`, `--compass-tick-dash`, `--compass-rose`, `--compass-rose-secondary`, `--compass-rose-outline`, `--compass-cardinal`, `--compass-font`, `--compass-weight`, `--compass-text-size`, `--compass-opacity` |
| Decoration | `--page-background` accepts a static background, with `--page-attachment` controlling its scroll treatment. Optional `--page-home-background` and `--page-workspace-background` use the existing body page identity for separate artwork composition. Narrow Home uses the quieter workspace treatment. `--compass-decoration` accepts a local static image/gradient behind the existing compass; `--compass-artwork` paints inside the existing rotating SVG box; `--brand-artwork` optionally replaces the brand image's visual content. None changes hit targets or layout. |

Shared components consume these values. Themes contain variable declarations
under `:root[data-theme="id"]`, not arbitrary component selectors. All definitions
ship with the extension. Stored values are a closed ID, never CSS or a resource URL.
There is no remote theme code, arbitrary user CSS, inheritance graph, event bus,
new dependency, timer or dynamic script loading.

App-owned: DOM, pin count/positions/hit targets, angle/physics, responsive sizes,
scroll regions, ordering/visibility, search/editor/dialog state, deadlines,
confirmation, error wording and disabled controls. Small fonts used in dense
special-purpose controls remain app-sized; the shared family still changes.
Preserve semantic words/icons as well as status colors. Verify contrast after any
palette/font change; the current tests are not accessibility certification.

Website favicons retain their provider colors and existing fetching lifecycle.
Compass pin faces keep the same opaque `--pin-surface` when hovered. Shared CSS
uses a border highlight and excludes backgrounds from pin transitions. Dragging
does not add an outline; keyboard focus indicators remain visible. Disabled
authority and temporary busy-state styling keep their existing meanings.
The Atlas brand defaults to the original local logo; a bundled theme can substitute
local artwork within the same image box and accessible name. Browser chrome/native popup dimensions
and the small indicator injected into websites are outside the control-page
contract. The content indicator remains self-contained so website CSS cannot
alter it. They are not alternate application layouts.

## Add a bundled theme

1. Create `themes/my-theme/theme.css` using the root-selector pattern in
   `themes/shared/light-test.css`. Override visual values from `default.css`;
   omitted values inherit defaults. Place painted local files in `assets/`,
   and document source rights in ARTWORK.md. Keep large working files outside this repository.
2. URLs inside custom properties resolve at the consuming shared stylesheet.
   Use `url("themes/my-theme/asset.svg")`, relative to runtime `ui/style.css`
   and `ui/popup.css`, not relative to the source definition or its assets folder.
3. Register the closed ID in `extension/src/ui/theme.ts`, add its labelled
   option in `assets/index.html`/`ui-text.ts`, and link its stylesheet after the
   default in both `index.html` and `popup.html`. The build copies registered
   theme assets; distribution verification follows the pages' declared resources.
   No Home/Sites, background, Core or storage-schema changes are needed.
4. Run build, theme/font/contrast tests and native switching/screenshots, including
   forms, Greylist states, popup, dirty editor, narrow windows, zoom and restart.
   Fonts/backgrounds must not clip controls or obscure status.
5. Include the new theme's source assets and version-specific runtime inventory
   in `scripts/release.mjs` when preparing an authorized release. Version 0.3.1
   packages both themes with a strict 39-file inventory; 0.2.8 and 0.3.0 retain
   their frozen 27-file inventories.

## Preference and failures

Settings → Appearance is the single theme-selection surface. Celestial and
Parchment are the main choices, with Default and Light retained for compatibility.
The section uses the existing `atlas-theme` select and save/retry feedback.
Home compass proportions and the separate Greylist & Journeys page are shared
application layout, not theme-specific branches.

Settings -> Pins & category icons -> Appearance selects a bundled ID. Only
`atlas-theme-v1` in extension-origin `localStorage` is written. The existing
`savePresentation` helper acknowledges writes or reconciles a thrown write.
Failed/uncertain saves retain the requested selection, keep the last acknowledged
appearance active and show a retry. A native `storage` event rereads the latest
saved scalar across open control pages/popups. Last acknowledged write wins;
unsaved local selection is retained and explicitly retryable after another window
changes the saved value. Unrelated records and authority are never written.

Startup reads the preference once before visual content. Unknown/missing IDs use
the default; an unavailable read uses default and exposes the read failure in
Appearance. Subsequent failed reads retain the last verified appearance. The
module updates only the root attribute and its selector/feedback. No component
re-render, navigation, icon fetch, data command or refresh loop is requested.
Listeners are removed on page hide. Theme selection survives a normal Firefox
restart and is included in a closed-profile backup; portable policy export and
Firefox bookmark sync do not carry it. Removing this key resets appearance only.

## Current visuals and background handoff

Celestial keeps its midnight blue palette, brass compass and orbit. Parchment
keeps its warm ivory palette, Aguiar-derived rose, cream controls and Cormorant
search. Background images, source scans, design studies and generators have
been removed at the user's request. Home, All Sites and Settings currently use
plain theme colors; layout and interactions are unchanged.

The [theme folder guide](../themes/README.md) is the short handoff: place a finished
background in `themes/<theme>/assets/home.webp`, then set that theme's existing
`--page-home-background`. Leave `--page-workspace-background` plain for All Sites,
Settings and narrow Home. No new registry, API, shared component or build step.
The build copies files and removes stale generated theme resources.

[ARTWORK.md](../themes/ARTWORK.md) retains credits only for artwork still used.
The font licences and source hashes stay in `themes/shared/fonts/`.

## Evidence and limits

[Cleanup and validation](repository-cleanup.md) records this simplification.
The existing native theme harness checks switching, saved preferences, compass
interaction, plain working pages, narrow windows and restart. Historical artwork
screenshots were deliberately removed; they are not a current acceptance target.

Contrast tests cover selected pairs, not complete accessibility certification.
Native headless checks are not physical-display/FPS or screen-reader testing.
The historical intermittent INTERNAL_ERROR remains unresolved and outside this pass.
