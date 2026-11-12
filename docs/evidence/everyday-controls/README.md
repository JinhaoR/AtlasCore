# Everyday controls verification — 2026-11-09

Development work only; version 0.2.3 and extension identity unchanged. The owning
contract is [Everyday controls](../../everyday-controls.md).

## Automated checks

- Core: **249 passed**, no failures. Core source is unchanged.
- Extension: **591 passed**, no failures, including 34 new focused regressions.
- Both TypeScript compilers and the development build passed. The distribution
  verifier checks the new popup assets as well as the existing runtime/feed.
- SHA-256 comparison covers 246 existing release files and 24 Core source files.
  No protected file changed. See `integrity.json`.

New tests cover the popup allowlist, source-context loss, unavailable/unsupported
pages, wait/confirmation/grant deadlines and Journey ownership; search prefill;
bookmark validation, permission denial/revocation, merge/order/label guards,
archive/unpin/repin, empty/deleted groups, unsupported structures, conflicts,
partial writes, lost create acknowledgements and restart. A clean page editor
refreshes after native edits; a dirty editor preserves its draft for comparison.

Native repetition exposed an ID-format defect: Firefox GUIDs sometimes contain
underscores, outside Atlas's existing page-ID alphabet. Stable encoding now maps
them into valid page IDs while retaining the actual native binding. A regression
uses an underscore-containing GUID through import, restart and subsequent edit.

## Native Firefox evidence

Firefox 159.0.1, isolated copied runtime and synthetic profile, with the frozen
signed 0.2.2 baseline and a temporary development overlay. No installed profile
or enterprise policy was edited. `native-final.json` contains the actual outcomes.

The scenario exercises a populated category, all categories, search, Add site,
popup shortcuts retaining an editor, Firefox's optional permission prompt,
explicit merge, native-to-Atlas and Atlas-to-native edits, a native change during
an unsaved page edit, and full browser restart. It checks saved policy/settings,
pins, category layout, named pages and the retained Sites editor.

The controlled local HTTP scenario verifies exact path/query/fragment targeting
through `OPEN_DESTINATION`, a blocked page inside an otherwise allowed bookmark
group, a real wait → confirmation → fixed grant → expiry sequence, and synthetic
unavailable-authority display. This does not diagnose the historical INTERNAL_ERROR.

Screenshots retain resting Home, selected category, directory, search, Add site,
merge preview, connected Home, waiting/active access and unavailable state.
Measured viewports include 1488 pixels at 125%, 150%, 200%; 800 and 500 pixels at
100%; and 500 pixels at 200% (250 CSS pixels). Horizontal overflow is checked.
Category Page Down uses native keyboard input in a genuinely overflowing panel.

## Performance observations

The same Home → Sites → Home measurement has 15 samples per run. The pre-change
checkpoint median was 9 ms; early development runs were 14 and 13 ms. These are
small local UI timings, not website-load benchmarks. The final median is **13 ms**,
with samples retained in `native-final.json`; no performance improvement is claimed.

Five-second idle samples retained pin DOM identity with zero child replacements,
attribute mutations or additional resource requests. Both checkpoint and new UI
used five `GET_VIEW` requests with maximum one concurrent view request. The new
UI additionally reads the bookmark presentation projection through that same
refresh owner; the final measurement counts `PRESENTATION_READ` explicitly.
There is no extra synchronization poller. Native bookmark events/startup drive
the synchronization owner.

## Limitations and unverified behavior

- The native popup opened with Firefox's supported `browserAction.openPopup()`.
  Headless Marionette did not reliably open it by clicking the toolbar widget or
  direct keyboard input into the popup. Shortcuts were exercised in its actual
  popup document, and category keyboard scrolling was verified. Physical toolbar
  clicking, popup Tab/Escape interaction and a screen-reader audit still need
  interactive verification; do not treat them as passed accessibility checks.
- On full restart, a temporary development overlay falls back to signed 0.2.2,
  which does not request bookmark permission. Firefox revokes that permission.
  Both copies survive, Atlas pauses truthfully, and permission restoration resumes
  the connection. This verifies the development-overlay path, not permission
  retention across a future permanently installed signed update.
- Firefox bookmarks and IndexedDB cannot commit atomically. A durable operation
  journal, actual-value comparisons and explicit conflict review handle partial
  completion; neither store offers a cross-store transaction. Concurrent browser
  mutations cannot be given an absolute atomicity guarantee.
- Unsupported URLs/nesting/separators are retained in Firefox and excluded from
  Atlas synchronization. Duplicate site folders need reconciliation. Firefox URL
  canonicalization which changes the requested exact string pauses comparison.
- Firefox account Sync across devices was not tested. This feature connects
  bookmarks in the current profile only and never synchronizes Atlas authority.
- Historical intermittent `INTERNAL_ERROR` remains unresolved.

No signing, packaging, version bump, deployment, enterprise-policy change,
everyday-profile change, commit or push occurred. Only this task's identified
disposable browser profiles/runtime copies are removed after retaining evidence;
the source checkpoint remains available.

## Evidence index

- [Resting Home](home.png), [category](everyday-category.png),
  [category directory](everyday-directory.png), [search](everyday-search.png).
- [Merge preview](everyday-merge-preview.png),
  [search-to-add](everyday-search-add.png),
  [active access](home-access-active.png), [unavailable state](home-unavailable.png).
- [125% zoom](everyday-1488-1.25.png), [200% zoom](everyday-1488-2.png),
  [500-pixel window at 200%](everyday-500-2.png).
- `changed-files.json` lists this task's source/document changes relative to its
  checkpoint, excluding generated development output. `native-final.json` records
  the browser results; `integrity.json` records protected-file verification.
