# Theme boundary verification

Development only, on the preserved Home-balance working tree. No version change,
release packaging, Mozilla submission, deployment or everyday-profile access.
The checkpoint is retained locally at `.tools/themes/checkpoint.zip`.

## Automated checks

- Development build and both TypeScript compilers pass.
- Complete extension suite: **685 passed**. Complete Core suite: **253 passed**.
- New focused coverage: closed IDs, unavailable/invalid reads, failed/uncertain
  saves, acknowledged recovery of thrown writes, explicit retry, cross-page
  updates, unsaved selection retention, clearing the preference and cleanup.
- Theme contract test rejects component rules, remote imports and literal colors
  in the application styles. Existing font-byte hashes and OFL checks remain.
- Both palettes pass the tested 4.5:1 text and 3:1 focus/control-border pairs,
  including waiting, active, cancellation and unavailable-state colors. This is
  a selected contrast check, not complete accessibility conformance.

## Native Firefox 160.0, disposable profiles

`firefox_compact_home.py --theme-baseline-only --signed-baseline 0.2.8`
captures matching 1752 x 1202 windows before and after extraction. `comparison.json`
is empty: sampled rectangles, text/font, background, border and shadow values
are identical for Home, categories, site rows, the site dialog and timing inputs.
Screenshots were also inspected. Provider favicons remain provider-colored;
this is not a whole-image pixel equality or performance claim.

`firefox_compact_home.py --theme-only --signed-baseline 0.2.8` verifies:

- Light palette across Home/compass, categories, site rows, search, editor forms,
  Settings and empty Vault. Popup document reads the same saved theme; this test
  does not claim a new toolbar-popup interaction implementation.
- Sampled switch: **0 replaced DOM nodes, 0 new resources, 0 background commands**;
  same pin and compass node identities. No refresh owner or timer added.
- Search result identity, dirty editor text, selection and focus retained.
- Real native storage events between two control pages.
- Synthetic failed save keeps the local selection and old appearance, then retry
  applies acknowledged state.
- Full browser restart preserves light selection, including the first observed
  frame's root theme/background. Probe is injected only into the disposable copy.
- No policy/settings/revision/request/grant/Vault changes. Routine Core
  `lastObservedAt` progression is excluded from this comparison.
- No horizontal overflow at 540px and real Firefox 200% zoom.

Greylist screenshots use presentation-only examples of waiting, ready and active
classes. They do not create real grants. Native `--home-directory-only` additionally
passes the existing real pin gate, category/history/editor/draft, cancellation,
failed-save, explicit-confirmation, responsive and restart checks; see
`regressions.json`. Its idle interval retains pin nodes and adds no resources.

## Inspection and limits

Screenshots include default/light Home, categories, populated category, search,
editor, Settings, Vault, Greylist states, failed save and narrow/zoomed layouts.
The default appearance is preserved. Popup palette now uses the shared values
instead of near-identical private colors. Light is a minimal architecture proof,
not a polished second visual identity. The fixed Atlas logo retains its navy
background, and website icons retain their original colors. Browser chrome and
the website-injected Journey indicator are deliberately outside this contract.
No physical-monitor/high-refresh benchmark or screen-reader audit was performed.
The historical INTERNAL_ERROR remains unresolved and outside this change.

`integrity.json` records the baseline comparison: all **438** release files and
protected Core/adapter/background/storage/bookmark/manifest/package files are
unchanged. Only this task's disposable profiles/runtime copies are removed after
retaining this evidence. No release files are regenerated.
