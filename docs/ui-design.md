# Atlas Firefox interface

The original 2026-10-01 pass follows the user's reference as a visual direction: warm parchment and stone, muted olive/bronze/navy accents, restrained serif headings, quiet borders, spacious destination cards and a left sidebar. D24 simplifies this interface on 2026-10-02. It uses the real service data and existing Firefox page. Core and repository authority stay separate from presentation; Journey behavior remains owned by D18/D22.

## Home

- Atlas identity, local destination search, Pinned, then the existing categories. University and Scholar / Research appear first; longer categories initially show four destinations with a functional Show all / Show fewer control.
- Cards emphasize the service name and show its exact hostname second. Website favicons identify destinations, with a simple globe when no usable image is available. Services with distinct active entry points retain their selector; explicit equivalent aliases still belong to one service.
- A pin button adds/removes an active destination from Pinned. There is no inferred visit frequency or browsing-history collection. Pins start empty and require an actual user action.
- Search keeps its effective-Whitelist index, labels and active aliases, Blacklist exclusion and ordinary navigation gate. Arrow keys, Enter and Escape remain supported. `/` focuses search when the user is outside an editable control. Long result lists scroll to the highlighted result.
- Home shows a compact Journey strip for the selected context when relevant. Current tab access opens the focused access view. Blocked/waiting pages retain clear request, confirmation and cancellation actions, exact scope, countdown and expandable decision details.

D21 adds a passive Journey indicator on web documents and explicit root retry on interrupted access pages. The [Journey recovery document](firefox-journey-recovery.md) owns that focused change; the rest of this interface remains unchanged.

## Settings and navigation

The D24 cleanup (2026-10-02) keeps two primary sidebar destinations: Home and Settings. Vault, managed lists, recovery and diagnostics live inside Settings. Timing, an empty Vault and managed data are collapsed initially; a new saved proposal opens Vault, and explicit review focuses it. Settings retains one pending-change marker. Policy fields remain directly available.

The desktop sidebar can minimize to an 80-pixel icon rail with accessible names, hover titles, a status indicator and a visible expand control. Layout preference uses `atlas-sidebar-v1` in extension-origin localStorage, separate from policy. Missing/corrupt/unavailable preference reads use the expanded layout. Failed writes keep the chosen page layout; reload uses the last saved preference. Storage events synchronize open Atlas pages. At 700 pixels or below a compact horizontal header ignores the desktop preference and keeps both destinations visible.

Settings contains destination/policy editing, grouped timing fields, Vault, managed lists, recovery and diagnostics. Timing fields show each active value beside the editable draft. Proposing a change takes the user to Vault. Frozen review shows actual list changes and a table of changed timing values, Active versus Proposed; the full Core review remains expandable. Existing wait, explicit confirmation, cancellation and persistence behavior remains owned by Core.

The brand returns to Home within the page, preserving drafts. Busy actions show Working/Saving feedback. When a Vault action disappears or disables, focus moves to its summary. Unpinning a focused card returns focus to that destination's visible category pin, with search as a fallback. Home spacing and Settings rhythm are tighter; decorative slogans and duplicate timing summaries are removed. Short hover/layout transitions respect reduced-motion settings.

Diagnostics, source details, raw policy and recovery remain available. Their technical information is secondary to browsing. The sidebar keeps authority availability visible; it creates no permission.

## Presentation storage and stable updates

Pins are stored under `atlas-home-pins-v1` in extension-origin `localStorage`. This is a small presentation preference, separate from the authoritative IndexedDB repository. Only presentation IDs are saved; no URLs, tokens, credentials, visit history or timing settings are stored there. Same-origin storage events synchronize other Atlas pages. Malformed data yields an empty pinned list; failed writes retain the prior pins and report a local error. Unavailable pin storage does not stop controller polling.

Every pinned entry is resolved against the current effective-Whitelist display index. An old pin cannot restore a removed/Blacklisted hostname, create a grant, change policy or start a Journey. Destination openings continue through `OPEN_DESTINATION` and the ordinary held-request gate.

Category/card nodes are retained while policy is unchanged. Pin rows change only when active pin contents change; timers update their text without rebuilding the page. Search and settings drafts retain focus during housekeeping. Reduced-motion styles, visible keyboard focus, a skip link and labeled controls are included.

## Visual compromises and limits

D23's [code review](code-review.md) separates Settings/Home rendering and centralizes timing display/draft conversion in `settings-model.ts`. Unsaved drafts survive a temporary failed state query while commands disable. Access headings receive focus when opening the panel or hiding the focused action; search keeps combobox focus. Temporary scope copy appears only for Access flows. Explicit navigation clears stale feedback. The existing visual system and authority boundary remain unchanged.

The reference's palette, hierarchy and spacing guide the implementation. Existing Atlas identity, real categories and system fonts are retained. Scenic photography is outside this pass. There are no mock Edit controls or invented frequent destinations.

Pins are local to this Firefox extension profile and can be lost with its presentation storage. They are not part of policy backups. Category expansion is page-local and resets on a policy redraw/reload. Cross-document pin sync is implemented; broader multi-window and assistive-technology coverage remains future validation. Full authenticated website compatibility remains outside this UI evidence.

## Temporary access overview (D27)

D28's access panel uses a shared adapter draft to show the exact proposed scope above **Request temporary access**. The button remains disabled while checking the public address. An observed canonical pair explains why both hosts share one wait and deadline. Pending/granted terms come from the current Core decision's request ID, so expired/stale records cannot substitute old scope copy for a new request. [The stabilization contract](firefox-stabilization.md#d28-greylist-request-time-scope-preparation-2026-10-03) owns authorization and discovery limits.

Home includes a **Temporary access** section showing confirmed Greylist grants across all tabs. Each grant appears once with its currently authorized exact hosts and original expiry countdown. Alias scopes stay together; pending waits and Journeys do not appear as grants. Expired, stale, denied or Whitelisted hosts are excluded by Core planning over the latest verified snapshot and managed list. The projection is display information only: it never releases navigation, writes state, renews a grant, or changes classification. Unavailable authority shows an unavailable message. Verified content stays stable through ordinary controller housekeeping; rows are retained while their identity/scope/deadline stay unchanged and only countdown text changes each second.

Native Firefox verifies countdown/focus stability, unavailable presentation, original expiry across reload and page removal on expiry. Inspected previews: [Home](evidence/atlas-temporary-access-d27.png) and [small screen](evidence/atlas-temporary-access-small-d27.png). [Sanitized results](evidence/firefox-friend-prototype-d27.json) use a fresh profile and synthetic local sites. A hostname is shown once when its label and single-host scope are identical.

## Online website icons

Icon discovery uses the destination's exact hostname and works for user-added destinations as well as curated services. The UI first tries Firefox's observed tab favicon, then the website's declared icon links and `/favicon.ico`. A public-host fallback uses Google's online favicon cache (`www.google.com/s2/favicons`), sending only the hostname and requested image size. Single-label names, IP addresses and reserved/internal hostname suffixes do not use that cache. An unavailable or invalid image leaves the bundled globe visible.

Downloads omit credentials and referrers, accept at most one MiB per response and have fixed time limits. Firefox decodes images before display. Website markup is read for link metadata and never inserted into the Atlas document; SVGs are passive images. Icons load as cards become visible, share an ephemeral per-host cache across pinned/category cards, and refresh when Firefox observes new favicon metadata. Changing a service entry point also changes its icon lookup. No favicon URL or image enters the authoritative snapshot or diagnostics.

This is display metadata in the extension UI. It creates no hostname equivalence, Whitelist entries, Access grants or Journey authority. Search matching and authorization remain owned by their existing layers. No dependencies or browser permissions were added.

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
