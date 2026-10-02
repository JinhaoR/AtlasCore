# Atlas interface refinement (D20)

This 2026-10-01 pass follows the user's reference as a visual direction: warm parchment and stone, muted olive/bronze/navy accents, restrained serif headings, quiet borders, spacious destination cards and a left sidebar. It uses the real service data and existing Firefox page. Core, authorization, repository authority and D18 Journey semantics are unchanged.

## Home

- Atlas identity, local destination search, Pinned, then the existing categories. University and Scholar / Research appear first; longer categories initially show four destinations with a functional Show all / Show fewer control.
- Cards emphasize the service name and show its exact hostname second. Website favicons identify destinations, with a simple globe when no usable image is available. Services with distinct active entry points retain their selector; explicit equivalent aliases still belong to one service.
- A pin button adds/removes an active destination from Pinned. There is no inferred visit frequency or browsing-history collection. Pins start empty and require an actual user action.
- Search keeps its effective-Whitelist index, labels and active aliases, Blacklist exclusion and ordinary navigation gate. Arrow keys, Enter and Escape remain supported. `/` focuses search when the user is outside an editable control. Long result lists scroll to the highlighted result.
- Home shows a compact Journey strip for the selected context when relevant. Current tab access opens the focused access view. Blocked/waiting pages retain clear request, confirmation and cancellation actions, exact scope, countdown and expandable decision details.

D21 adds a passive Journey indicator on web documents and explicit root retry on interrupted access pages. The [Journey recovery document](firefox-journey-recovery.md) owns that focused change; the rest of this interface remains unchanged.

## Settings and navigation

The sidebar contains Home, Settings, Vault, Managed lists and Diagnostics. The last three open/focus their actual sections within Settings. On small screens it becomes a compact horizontal navigation row.

Settings contains destination/policy editing, grouped timing fields, Vault, managed lists, recovery and diagnostics. Timing fields show each active value beside the editable draft. Proposing a change takes the user to Vault. Frozen review shows actual list changes and a table of changed timing values, Active versus Proposed; the full Core review remains expandable. Pending proposals have a small sidebar marker and a link from Settings. Existing wait, explicit confirmation, cancellation and persistence behavior remains owned by Core.

Diagnostics, source details, raw policy and recovery remain available. Their technical information is secondary to browsing. The sidebar keeps authority availability visible; it creates no permission.

## Presentation storage and stable updates

Pins are stored under `atlas-home-pins-v1` in extension-origin `localStorage`. This is a small presentation preference, separate from the authoritative IndexedDB repository. Only presentation IDs are saved; no URLs, tokens, credentials, visit history or timing settings are stored there. Same-origin storage events synchronize other Atlas pages. Malformed data yields an empty pinned list; failed writes retain the prior pins and report a local error. Unavailable pin storage does not stop controller polling.

Every pinned entry is resolved against the current effective-Whitelist display index. An old pin cannot restore a removed/Blacklisted hostname, create a grant, change policy or start a Journey. Destination openings continue through `OPEN_DESTINATION` and the ordinary held-request gate.

Category/card nodes are retained while policy is unchanged. Pin rows change only when active pin contents change; timers update their text without rebuilding the page. Search and settings drafts retain focus during housekeeping. Reduced-motion styles, visible keyboard focus, a skip link and labeled controls are included.

## Visual compromises and limits

The reference's palette, hierarchy and spacing guide the implementation. Existing Atlas identity, real categories and system fonts are retained. Scenic photography is outside this pass. There are no mock Edit controls or invented frequent destinations.

Pins are local to this Firefox extension profile and can be lost with its presentation storage. They are not part of policy backups. Category expansion is page-local and resets on a policy redraw/reload. Cross-document pin sync is implemented; broader multi-window and assistive-technology coverage remains future validation. Full authenticated website compatibility remains outside this UI evidence.

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
