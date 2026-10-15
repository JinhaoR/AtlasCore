# Atlas Firefox interface

Milestone D's [visual polish report](visual-polish.md) owns the shared color/type/
spacing tokens, readable operational text, control sizes, status treatment and
before/after native screenshots. It refines these surfaces without changing the
A/B/C workflows or presentation storage.

Milestone C's [Home organization contract](home-organization.md) now owns category
order, visibility, complete collapse, current access links and Sites navigation.
It preserves the cards, five-column cap, palette and permanent rail described here.

Milestone B changes Sites editing and review through the
[destination batch contract](destination-polish.md#milestone-b-destination-batch-drafts).
It preserves the visual identity and Home layout. Local drafts, frozen proposals
and committed presentation are shown separately; category suggestions derive from
existing metadata and category identity is consistent across display projections.

The original 2026-10-01 pass follows the user's reference as a visual direction: warm parchment and stone, muted olive/bronze accents, restrained serif headings, quiet borders and a left sidebar. D30 (2026-10-04) makes the interface denser and adds Sites & Access; [destination-polish.md](destination-polish.md) owns its model, scope, ranking and timeout rules. Core and repository authority stay separate from presentation.

## Home

The [Milestone A reliability contract](ui-reliability.md) owns save acknowledgment,
display retry, exact search targets, stale/unavailable collections and action feedback.
These repairs preserve the existing visual identity and all authorization rules.

- Atlas identity and search, explicit Pinned order, relevant Access in progress, then chosen categories. Initial layout retains the previous visible ordering; Customize Home controls saved category order and visibility. Clicking a category heading completely collapses its cards. D31's one-row preview still uses one to five cards with Show all / Show fewer inside expanded categories. Expanded and pinned grids also use at most five columns. Resize updates visibility in place and preserves ranking, explicit preview expansion and card nodes.
- Compact launchers show icon and name at a fixed 54px button height. Long names use ellipsis and keep their full accessible label; exact hosts appear in tooltips and Sites details. Services with distinct active entry points retain their selector in a small disclosure; explicit equivalent aliases still belong to one service. Default category rows never grow vertically as the window narrows; Show all is the explicit way to reveal additional rows.
- Pins start empty and retain the user's explicit order. Local usage ranks each category separately; only explicit Atlas launches and typed/bookmark destination arrivals are recorded. No browsing history is imported and intermediates never gain popularity.
- Search keeps its effective-Whitelist index, labels and active aliases, Blacklist exclusion and ordinary navigation gate. Arrow keys, Enter and Escape remain supported. `/` focuses search when the user is outside an editable control. Long result lists scroll to the highlighted result.
- Home shows a compact Journey strip for the selected context when relevant. Current tab access opens the focused access view. Blocked/waiting pages retain clear request, confirmation and cancellation actions, exact scope, countdown and expandable decision details.

D21 adds a passive Journey indicator on web documents and explicit root retry on interrupted access pages. The [Journey recovery document](firefox-journey-recovery.md) owns that focused change; the rest of this interface remains unchanged.

## Settings and navigation

The sidebar has Home, Sites & Access and Settings. Sites shows committed exact policy and an explicit destination draft. Settings shows protected behavior/timing first, including Journey lifetime; Vault, managed lists, recovery and diagnostics remain secondary disclosures. Timing starts open; a new saved proposal opens Vault and explicit review focuses it. Settings retains one pending-change marker. Normal Settings has no raw policy textareas.

The desktop sidebar is permanently a 60-pixel icon rail with accessible names, hover titles and a status indicator. D31 removes the expand control and layout-preference code. Old `atlas-sidebar-v1` values are ignored; no policy or pin migration is needed. At 700 pixels or below a compact horizontal header keeps all navigation labels visible.

Timing fields show active values beside the draft. Permission or timing changes take the user to Vault. Frozen review shows actual exact list changes and changed timing values, Active versus Proposed; the full Core review remains expandable. Name/category/pin-only edits are explicitly saved as display details without changing policy. Existing wait, explicit confirmation, cancellation and persistence behavior remains owned by Core.

The brand returns to Home within the page, preserving drafts. Busy actions show Working/Saving feedback. When a Vault action disappears or disables, focus moves to its summary. Unpinning a focused card returns focus to that destination's visible category pin, with search as a fallback. Home spacing and Settings rhythm are tighter; decorative slogans and duplicate timing summaries are removed. Short hover/layout transitions respect reduced-motion settings.

Diagnostics, source details and recovery remain available. Their technical information is secondary to browsing. Exact policy lives in Sites; recovery displays counts and revision. The sidebar keeps authority availability visible; it creates no permission.

## Presentation storage and stable updates

Pins are stored under `atlas-home-pins-v1` in extension-origin `localStorage`. This is a small presentation preference, separate from the authoritative IndexedDB repository. Only presentation IDs are saved; no URLs, tokens, credentials, visit history or timing settings are stored there. Same-origin storage events synchronize other Atlas pages. Malformed data yields an empty pinned list; failed writes retain the prior pins and report a local error. Unavailable pin storage does not stop controller polling.

Every pinned entry is resolved against the current effective-Whitelist display index. An old pin cannot restore a removed/Blacklisted hostname, create a grant, change policy or start a Journey. Destination openings continue through `OPEN_DESTINATION` and the ordinary held-request gate.

Category/card nodes are retained while policy, metadata and usage are unchanged. Category expansion survives ranking updates. Pin rows change only when active pin contents change; timers update their text without rebuilding the page. Search and settings drafts retain focus during housekeeping. Reduced-motion styles, visible keyboard focus, a skip link and labeled controls are included.

## Visual compromises and limits

D23's [code review](code-review.md) separates Settings/Home rendering and centralizes timing display/draft conversion in `settings-model.ts`. Unsaved drafts survive a temporary failed state query while commands disable. Access headings receive focus when opening the panel or hiding the focused action; search keeps combobox focus. Temporary scope copy appears only for Access flows. Explicit navigation clears stale feedback. The existing visual system and authority boundary remain unchanged.

The reference's palette, hierarchy and spacing guide the implementation. Existing Atlas identity, real categories and system fonts are retained. Scenic photography is outside this pass. There are no mock Edit controls or invented frequent destinations.

Pins and Home layout are local to this Firefox extension profile and are not part
of policy backups. Category order, visibility and complete collapse persist in a
separate revision-checked presentation record. Show all/fewer preview expansion
remains page-local. Cross-page layout and pin synchronization are tested separately
from authority; full assistive-technology coverage remains unverified. Full
authenticated website compatibility remains outside this UI evidence.

## Temporary access overview (D27)

The following records D27's original grant-only view. Milestone C adds separate
pending request and Journey summaries in **Access in progress**, links into the
existing workflow, and hides verified-empty status sections. None of these links
creates or extends permission. [The current contract](home-organization.md) owns
the status/navigation changes.

D28's access panel uses a shared adapter draft to show the exact proposed scope above **Request temporary access**. The button remains disabled while checking the public address. An observed canonical pair explains why both hosts share one wait and deadline. Pending/granted terms come from the current Core decision's request ID, so expired/stale records cannot substitute old scope copy for a new request. [The stabilization contract](firefox-stabilization.md#d28-greylist-request-time-scope-preparation-2026-10-03) owns authorization and discovery limits.

Home includes a **Temporary access** section showing confirmed Greylist grants across all tabs. Each grant appears once with its currently authorized exact hosts and original expiry countdown. Alias scopes stay together; pending waits and Journeys do not appear as grants. Expired, stale, denied or Whitelisted hosts are excluded by Core planning over the latest verified snapshot and managed list. The projection is display information only: it never releases navigation, writes state, renews a grant, or changes classification. Unavailable authority shows an unavailable message. Verified content stays stable through ordinary controller housekeeping; rows are retained while their identity/scope/deadline stay unchanged and only countdown text changes each second.

Native Firefox verifies countdown/focus stability, unavailable presentation, original expiry across reload and page removal on expiry. Inspected previews: [Home](evidence/atlas-temporary-access-d27.png) and [small screen](evidence/atlas-temporary-access-small-d27.png). [Sanitized results](evidence/firefox-friend-prototype-d27.json) use a fresh profile and synthetic local sites. A hostname is shown once when its label and single-host scope are identical.

## Online website icons

Icon discovery uses the destination's exact hostname and works for user-added destinations as well as curated services. The UI first tries Firefox's observed tab favicon, then the website's declared icon links and `/favicon.ico`. A public-host fallback uses Google's online favicon cache (`www.google.com/s2/favicons`), sending only the hostname and requested image size. Single-label names, IP addresses and reserved/internal hostname suffixes do not use that cache. An unavailable or invalid image leaves the bundled globe visible.

Downloads omit credentials and referrers, accept at most one MiB per response and have fixed time limits. Firefox decodes images before display. Website markup is read for link metadata and never inserted into the Atlas document; SVGs are passive images. Icons load as cards become visible, share an ephemeral per-host cache across pinned/category cards, and refresh when Firefox observes new favicon metadata. Changing a service entry point also changes its icon lookup. No favicon URL or image enters the authoritative snapshot or diagnostics.

This is display metadata in the extension UI. It creates no hostname equivalence, Whitelist entries, Access grants or Journey authority. Search matching and authorization remain owned by their existing layers. No dependencies or browser permissions were added.

## Permanent rail and responsive rows (D31)

Extension **0.1.12** removes sidebar expansion and its presentation-storage reader/writer. The old preference key is ignored, preserving all unrelated pins, metadata and authoritative state. No Core changes or dependencies are added.

One column count controls the grid and collapsed category visibility. It uses the actual available content width, a 195px minimum card width and a 9px gap, capped at five. A `ResizeObserver` updates cards in place; hidden controls never keep focus. Explicit Show all retains its expanded state through resize and ranking updates. Pinned and expanded grids may have multiple rows, with at most five cards per row. Launcher buttons remain 54px tall; names cannot wrap and increase the row height.

Validation: extension typecheck/build and **203 extension tests pass**. Native Firefox 157.0 passes `firefox-e2e.py --destination-polish-only` and `--productization-only`. The resize scenario records 2/3/4/5/5 columns at actual 500/800/1000/1440/2100px viewport widths, one default row, stable card nodes, fixed height and no horizontal overflow. The regression retains pin focus, search, site icons, protected settings, migration and restart checks. Expanded/malformed/old sidebar preferences cannot restore expansion. [Sanitized measurements](evidence/firefox-responsive-home-d31.json) and [current Home preview](evidence/atlas-home-responsive-d31.png) record the results. Firefox clamps the narrower requested window to 500px; native evidence does not establish smaller widths.

Commands run from the repository root:

```sh
npm.cmd --prefix extension run typecheck
npm.cmd --prefix extension test
python extension/scripts/firefox-e2e.py --destination-polish-only
python extension/scripts/firefox-e2e.py --productization-only
node extension/scripts/verify-bundle.mjs extension/dist
```

The extension test command runs the real build before tests. Earlier D24/D30 evidence below and in the linked reports describes those historical versions; D31 supersedes their expandable sidebar and four-card preview.

## Files and validation

| Area | Files in this pass |
| --- | --- |
| UI | `extension/src/ui/assets/index.html`, `style.css`, `site.svg`, `extension/src/ui/main.ts`; new `extension/src/ui/home-model.ts` and `website-icons.ts` |
| Tests | New `extension/tests/home-model.test.mjs` and `website-icons.test.mjs`; extended `extension/scripts/firefox_productization.py` and `firefox-e2e.py` |
| Guidance | This document, architecture/foundation/acceptance links, extension README, concise AGENTS link; three sanitized preview screenshots in `docs/evidence/atlas-*-d20.png` |

The original interface pass verified 169/169 Core tests and 73/73 extension tests, builds and typechecks. The online-icon follow-up passes 77/77 extension tests, build and typecheck. Its four added behavior tests cover custom-host metadata, Firefox-observed images, relative/CDN links, credential/referrer omission, invalid/unavailable responses and public-cache fallback with internal-name exclusion. The original three presentation tests cover effective-only pins, distinct active service entry points and malformed preferences. No dependencies, permissions, preset destinations or Core source changes were added in this presentation pass.

Native Firefox 157.0 on Windows passes the final `--productization` run (`.tools/firefox-e2e-1pr3o3nm/result.json`) and `--existing-policy` (`.tools/firefox-e2e-lz4wyu4a/result.json`). The former includes normal stabilization plus real sidebar targets, category expansion/collapse, local pins and restart, simulated pin-save failure, search shortcuts, stable card/focus nodes, a 500-pixel outer window, frozen timing review, the ordinary search gate, per-tab badges, migration, old Vault wait, explicit saved activation and preserved runtime terms. The latter exercises old saved policy, reload, curated additions and actual wait/confirmation controls. Changed selectors/title assertions reflect the new page structure without reducing authorization checks.

The online-icon follow-up also passes native `--productization-only` (`.tools/firefox-e2e-jxdzu9ic/result.json`): a custom fixture host obtains its favicon from Firefox metadata without changing policy, and pinned GitHub, KTH Canvas and KTH Mail display decoded website images. Existing UI, settings and restart checks remain passing. Public icon availability depends on live websites/cache; these checks are separate from the deterministic mocked metadata tests.

An initial native probe caught use of an unavailable `browser.storage` namespace. Pin preferences now use guarded extension-origin localStorage, preserving the manifest's existing permissions and keeping controller polling available after presentation failures. One simultaneous two-process native run timed out at the address-bar probe; the final isolated rerun passed. Native address-bar suites should run serially while that automation interference is investigated; no authorization change was made in response.

Inspected previews: [Home](evidence/atlas-home-d20.png), [small screen](evidence/atlas-small-screen-d20.png), [frozen Vault review](evidence/atlas-vault-d20.png). These use an isolated synthetic profile with explicitly selected pins and fixture timing proposals. They do not alter the user's installed policy/settings.

Next polish should follow daily use: destination ordering/reordering, clearer feedback for large policy reviews, and dedicated screen-reader/zoom checks. Preserve the settled authorization model and use reproducible failures to guide adapter corrections.

## Firefox interface cleanup (D24)

Extension **0.1.4** implements the Settings/sidebar contract above. It removes duplicate sidebar destinations and repetitive decorative/status copy, keeps secondary Settings sections initially closed, and reveals a new saved proposal for review. Curated-update notices appear only when there are actual missing entries. The brand changes views without reloading the page. Focus stays visible after unpinning or completing a Vault action; native disclosure summaries remain in Tab order. Layout transitions respect reduced motion.

`extension/src/ui/sidebar.ts` owns the small presentation preference. `main.ts`, `assets/index.html` and `assets/style.css` own rendering, structure and style. There are no new dependencies, manifest permissions, authorization operations, storage schemas or Core source changes in this pass.

Build and TypeScript checks pass on Node.js 24.12.0 / npm 11.6.4 / TypeScript 6.0.3; **119/119 extension tests pass**. The prior D23 Core result remains **185/185**; this UI pass rebuilds Core and changes no domain behavior.

Native Firefox 157.0 checks use isolated synthetic profiles and real extension controls. `--coherence-only` verifies unavailable authority, preserved drafts, rejected timing precision, focus, internal-document source retirement and Greylist waiting. `--existing-policy` verifies the now-collapsed Vault's curated update, frozen review, old-policy retention, explicit saved confirmation and the ordinary navigation/restart scenario. These are separate from authenticated provider compatibility.

Final runs pass **6 coherence, 11 productization and 14 existing-policy/browsing check groups**. `--productization-only` also verifies the 80-pixel rail, actual Space/Enter activation, reload and extension restart, corrupt preferences, failed saves without lost controller polling, native cross-document storage events, pin focus, visible decoded website icons, secondary disclosure controls and saved timing changes. Evidence: [sanitized results](evidence/firefox-ui-d24.json), from `.tools/firefox-e2e-5cz21w66`, `.tools/firefox-e2e-c_kmvhhx` and `.tools/firefox-e2e-mfxczui_`.

Visually inspected previews: [expanded Home](evidence/atlas-home-expanded-d24.png), [minimized Home](evidence/atlas-home-collapsed-d24.png), [Settings overview](evidence/atlas-settings-d24.png), [compact header](evidence/atlas-small-screen-d24.png), and [frozen Vault review](evidence/atlas-vault-d24.png). The requested 350-pixel outer window is clamped by Firefox to a 500-pixel viewport; native checks establish no horizontal overflow and visible navigation at that actual width, not below it.

Screenshots wait for presentation transitions to finish. Preview pins and policy/settings data belong to disposable fixtures; the tests do not modify the user's installed profile. Dedicated screen-reader and zoom testing remain outstanding.
