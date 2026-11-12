# Home simplification — development evidence

This development refinement follows signed 0.2.7. It does not package, sign,
deploy or change the version. The working-tree checkpoint is retained at
`.tools/home-simplification/checkpoint.zip`.

## Implemented

- Home has one scrollable category column, approximately five visible choices,
  and a larger compass. Saved category preferences are unchanged. Routine success
  banners, the visible Pins heading and Home bookmark connection link are removed.
- The approved required `bookmarks` permission replaces the optional permission.
  Startup uses the existing additive, journaled toolbar connection. Explicitly
  disconnected installations stay disconnected; conflicts remain explicit.
- Native toolbar folders appear as read-only compass groups, including supported
  nested pages. Their icons are selectable from the local palette. Ten groups fit
  on the ring; beyond that, nine shortcuts and a More bookmarks folder provide
  access to the remainder. Firefox owns folder contents and organization.
- Greylist controls live on Home: cancel a waiting request, explicitly allow a
  ready request, open an active grant, or end it. Confirmation never auto-opens
  a page. Exact frozen scope remains visible. Legacy access links retain their
  explicit original tab context; they cannot substitute another tab.
- The standalone Site access presentation is removed. Core/controller commands,
  grant scope and deadlines, Journey ownership and ordinary gated opening remain.

Primary owners: `home-pins.ts`, new `home-greylist.ts`, `main.ts`, startup/popup
presentation, HTML/CSS and shared copy; bookmark `owner.ts` and new
`toolbar-folders.ts`. Folder icons use the independently revisioned
`toolbar-folder-icons-v1` record. The original strict sync record schema is
unchanged. Failed icon saves retain the choice and offer Retry; conflicting
choices require reconciliation. Back up the Home presentation database and
Firefox bookmarks together. Folder GUIDs, rather than labels, identify icons.

## Verification

| Check | Result |
| --- | --- |
| Complete Core suite | 253 passed |
| Complete extension suite | 660 passed |
| TypeScript and development build | Passed |
| web-ext lint | 0 errors; existing Android minimum-version warning |
| Isolated native Firefox | 160.0, passed |
| Existing release files | 374 hashes unchanged |
| Core source versus task checkpoint | Unchanged |

Focused coverage includes automatic connection, folder projection and exact URL
retention, event correlation, independent icon record validation, failed icon
saves/retry, and inline waiting/ready/active/unavailable actions. Existing sync
concurrency, partial failure, Vault and authorization regressions remain passing.

[Native results](native.json) cover automatic connection, nested folder pages,
overflow, keyboard dismissal, icon persistence and failed-save Retry, a folder
launch denied by ordinary policy, actual wait/cancel/confirm/end transitions,
reload and full browser restart. Restart checks preserve policy, settings, pins,
saved pages and folder icons. Screenshots were inspected at 1280, 900 and 640px
window widths and actual Firefox 125%, 150% and 200% zoom. No horizontal overflow
was observed. The compass produced zero DOM mutations and zero resource requests
during the measured 2.2-second idle interval.

Representative captures: [Home](home-resting.png), [folder chooser](folder-open.png),
[save retry](folder-icon-retry.png), [overflow](overflow-folder.png),
[category](category-open.png), [waiting](greylist-waiting.png),
[ready](greylist-ready.png), [active](greylist-active.png),
[narrow](home-640.png), [200% zoom](home-zoom-2.png).

## Motion measurement and limits

The old motion loop rewrote each pin's coordinates while spinning. The new loop
keeps orbital coordinates stable, rotates a common parent and counterrotates the
buttons so icons stay upright. Pointer painting is batched on animation frames.
The existing velocity estimator, bounded coast and cancellation remain.

Three matched synthetic pointer gestures in native headless Firefox measured
2,767–2,769 style mutations before and 212–213 afterwards, about **92% fewer**.
Per-pin style writes fell from 2,554–2,556 to zero. See
[before](motion-before.json), [first after](motion-first-after.json) and
[final after](motion-after.json).

Frame intervals do **not** establish a speed improvement: the first comparison
was approximately 6.06ms median / 6.08ms p95 in both versions; the later run was
6.56–6.70ms median / 6.96ms p95. Headless scheduling varies. This confirms reduced
DOM work, not smoother physical-display output or the cause of the reported
stutter. Hardware/GPU tracing and other Firefox versions remain unverified.

Firefox may show its own permission notice on install/update. The native temporary
addon run verifies availability and automatic connection, not signed-update consent
UI. Folder projection is bounded to 200 root folders, 200 pages per folder, 2,000
pages total, 10,000 visited nodes and depth 16. Unsupported or excess items remain
in Firefox; they are not converted into permissions. Read-only folder projection
does not imply two-way editing of folder contents. The historical INTERNAL_ERROR
is outside this change and remains unresolved.

Only task-created disposable Firefox copies/profiles were removed after retaining
these synthetic results. No everyday profile or enterprise policy was accessed
or changed. The extension ID remains `atlas-development@atlas.invalid`.
