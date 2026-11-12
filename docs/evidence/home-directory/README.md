# Home and All Sites redesign ? development verification

## Result and boundary

Home now contains search, the centered compass and relevant access summaries.
All Sites starts with a full-width category grid; category contents and the full
site directory replace the grid. Inspection/Add/Edit use one native modal with the
existing editor and workspace. Both searches float above content. There is no
permanently reserved details column and no category navigation on Home.

Existing saved category order and icons are reused. Drag and Alt+arrow ordering
move to All Sites. Legacy hidden/collapsed values are preserved in storage but
never conceal entries in the complete directory. Settings retains icon selection.
Core, adapter, background and storage source are byte-identical to this task's
checkpoint. No authorization, bookmark sync, schema, identity or version change.
All 406 prior release files retain their SHA-256 hashes (`integrity.json`). Nothing
was signed, packaged, deployed or installed into an everyday profile.

## Implementation

- `src/ui/main.ts`: Home composition/search and existing history/refresh integration.
- `src/ui/sites.ts`, new `site-directory.ts`: category projection, directory views,
  floating suggestions, native details/editor dialog, validation/focus protection.
- `home-shortcuts.ts`, `home-organization.ts`: reuse category ordering and icon
  preferences in the complete directory; remove obsolete Home visibility controls.
- `home-greylist.ts`: verified empty Greylist hides; unavailable feedback remains.
- `viewport-scroll.ts`: restore the active directory, modal or review scroll owner.
- `assets/index.html`, `assets/style.css`, `ui-text.ts`: presentation/layout/copy.
- Removed obsolete `home-workspace.ts` and its superseded tests; nine focused
  directory tests replace that navigation coverage. Existing editor/authority
  regression tests remain. Development `dist` regenerated.

## Verification

- TypeScript checks and development build passed (`npm --prefix extension run build`).
- Extension regression suite: **667 passed**, including category identity/order,
  complete/hidden discovery, large collections, dirty work retention, unavailable
  state, failed saves, editor validation, batch/Vault, pin and Greylist coverage.
- Core regression suite: **253 passed**.
- Native Firefox **160.0**, temporary development overlay over signed **0.2.8** in
  task-created disposable profiles; results in `native.json`.
- Native fixture contains 122 sites and a 32-site category. Category directory,
  category contents, floating search with unchanged compass position, keyboard
  suggestion selection, Escape, focus restoration, dirty editor protection,
  search-to-Add, validation focus and reload checked. Browser Back/Forward and
  real pointer dismissal on the modal backdrop passed. Preparing a long-named
  site opened the existing staged review without changing active rules.
- A real pointer click on a compass pin completed the normal `OPEN_DESTINATION`
  gate. Greylist request/wait/explicit confirmation/end/cancel and failed-cancel
  retention passed; pins kept their nodes and opacity through those actions.
- Native windows: 1488?1143, 980?850, 540?850; Firefox page zoom 125% and 200%.
  No horizontal overflow. Screenshots inspected for Home, category, directory,
  search and editor. At narrow/high-zoom widths pins become labelled rows.
- Full browser restart retained policy, settings, saved pins and site metadata.
- A short idle observation retained pin nodes and issued no new resource requests.
  This is a stability observation, not evidence of improved latency or long-term
  reliability. Existing single refresh owner and icon lifecycle remain unchanged.

## Evidence and limitations

Representative screenshots: `home.png`, `directory.png`, `category.png`,
`sites-search.png`, `editor.png`, `draft-review.png`, `home-zoom-2.png`, `directory-540.png`.
Long names and 900 entries across 30 categories have model-test coverage; the
native fixture is smaller. External favicons may use their existing generic
fallback until available. No accessibility conformance or performance gain is
claimed. The historical intermittent INTERNAL_ERROR is outside this change.

The checkpoint is `.tools/home-directory/checkpoint.zip`. Only this task's named
disposable profiles/runtime copies are removed after retaining sanitized evidence.
