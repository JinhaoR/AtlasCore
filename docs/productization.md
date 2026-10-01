# Firefox productization and dogfooding (D19)

The user accepted D18's bounded genuine HTTP redirect exception on 2026-10-01. A deliberately Whitelisted destination is trusted to select those redirects, subject to manual Blacklist and existing context, lifetime, revision and hop bounds. Redirect provenance does not prove authentication necessity. Atlas aims to prevent easy impulsive escape through a Ulysses contract; it does not promise a hostile-web sandbox or resistance to a determined owner. Journey authorization and destination-arrival completion remain unchanged.

> Do not increase Journey or authorization complexity for hypothetical web compatibility or escape cases. Require a reproducible real-world failure or demonstrated practical bypass before changing the authorization model.

When daily use reveals a problem, reproduce it, collect sanitized evidence, identify a bug/configuration issue/model limit, and make the narrowest correction. Per-service graphs, learned infrastructure, AUTH_CONTINUATION and purpose heuristics remain excluded.

## Implemented behavior and boundaries

1. Present each tab's committed active Journey through its existing badge and title: J, service/root label and approximate remaining time. Clear stale, expired, ended or uncertain presentation. No badge grants authority.
2. Build a local index from effective active Whitelist entries and curated display metadata. Search labels, exact active hosts and declared aliases; group equivalent entries once. Browser navigation from a result enters the ordinary held-request BEGIN_NAVIGATION gate, with no precreated UI-specific Journey.
3. Protect the seven existing configuration values through the same frozen Vault proposal, review, wait, confirmation and atomic commit protocol as policy. Core owns validation and transitions; Firefox owns persistence and forms.
4. Make search and categorized service rows primary. Current temporary access stays on its focused page. Timing controls, Vault, managed-list information, raw policy, recovery and diagnostics remain reachable in Settings.
5. Show service labels, with exact host information as secondary text. Add KTH Mail display metadata for the already observed `webmail.kth.se` destination; existing policy is never expanded automatically.

## Existing configuration and protected state

| Value | Initial development value |
| --- | --- |
| Greylist wait | 10 seconds |
| Greylist confirmation window | 60 seconds |
| Temporary grant duration | 60 seconds |
| Vault wait | 30 seconds |
| Vault confirmation window | 60 seconds |
| Journey lifetime | 5 minutes |
| Journey maximum hops | 12 |

All are already positive safe integers; duration units in Core are milliseconds. This pass exposes existing values without adding a new timing mechanism or changing bootstrap defaults. UI duration controls use seconds.

The aggregate snapshot adds required `configuration` and `configurationRevision`. Configuration is active authoritative domain state. Runtime host or UI preferences cannot override it. Settings-only changes advance configurationRevision and consume the single pending Vault proposal, without advancing policyRevision or invalidating existing Access requests, grants or Journeys. Those records already freeze their deadlines, grant duration, lifetime and hop count at creation. New operations use the newly committed configuration.

Vault proposals carry frozen candidate policy and configuration plus both base revisions. Policy and settings share the one proposal slot and existing review/confirmation/cancellation path. Ready/expiry timestamps are computed using the **old active Vault wait and window**, including when the candidate changes those values. Confirmation accepts an ID only, never replacement contents. Review is read-only. A settings commit atomically installs configuration, increments its revision, records consumption, and preserves current policy and runtime records. Policy changes retain the existing policy-revision invalidation behavior. No timer commits anything automatically.

## Compatibility and migration

Repository envelopes advance from schema 1 to schema 2. The IndexedDB database name and receipt stores remain in place. A known valid schema-1 snapshot can be explicitly converted using the existing host bootstrap configuration. The conversion preserves policy, revisions, IDs, request/grant/Journey terms and pending policy-proposal timestamps; the pending proposal freezes the same initial configuration. Migration is saved atomically before Core receives READY state. Invalid legacy data and missing configuration in schema 2 fail closed. Migration neither expands policy nor restarts waits/grants. Existing receipts remain available for reconciliation. Older builds reject schema 2 instead of loading an incomplete state.

The standalone policy Vault APIs retain their legacy policy-only contracts; the aggregate uses the protected configuration extension. No second settings workflow engine or mutable browser.storage timing preferences are added.

## Evidence

Validation on Firefox 157 / Windows, 2026-10-01:

- Core: **169/169 tests**, build and typecheck pass. Eleven new settings tests cover frozen candidates/old protection, slot sharing, early/expired/stale/duplicate confirmation, current configuration authority, numeric overflow, old/new terms, restart, failed/conflicted/unknown commits and revision/time rollback. Existing policy-only Vault tests remain intact.
- Extension: **70/70 tests**, build and typecheck pass. Seven new productization tests plus three migration tests; existing adapter, managed-list and scope regressions pass. Valid aggregate fixtures now include required configuration and schema 2. The malformed-command test retains rejection coverage using an extra unauthorized field, because policy proposal creation is now a supported private command.
- Native normal stabilization: pass. Native `--existing-policy`: pass, including reload, frozen curated proposal, old Vault wait, explicit saved confirmation and retained manual Blacklist.
- Native `--productization`: pass, combining the normal browsing scenario with real per-tab badges, completion/cancellation/expiry/restart, local keyboard search via the held request gate, Home/Settings controls, real IndexedDB migration, old 30-second settings protection, saved activation, frozen old request/Journey terms and grant duration, and new committed terms.
- Focused final `--productization-only`: pass, also proving Home opens destination search from a blocked-page view and Settings has its own heading. Native screenshots were inspected. Search deliberately uses a local HTTPS attempt without a TLS server to observe the real gate; local HTTP fixtures establish successful rendering and redirect continuation separately.
- Existing enforcing authentication characterizations: **34/34 local scenarios pass**. No provider-specific rule or trust expansion was added. Earlier passive/public observations remain dated evidence, not newly completed authenticated sessions.

Local artifacts: `.tools/firefox-e2e-40ewcwiy/result.json` (combined), `.tools/firefox-e2e-wo2482zs/result.json` (saved policy), `.tools/auth-enforcing-iweq74c4/result.json` (34 characterization cases). Final Home/Settings captures are under `.tools/firefox-e2e-_gudua06/`. These use isolated synthetic profiles, not the user's daily profile.

### Findings corrected during this pass

Firefox resets tab-specific browserAction state on document navigation. Reapply after actual arrival, then deduplicate unchanged countdown/title values; the fake Firefox now reproduces that reset. This follows [Mozilla's badge contract](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/browserAction/setBadgeText). Failed protected commands also clear active Journey presentation on other tabs before returning.

Settings-only aggregate commits preserve exact active policy list order as well as membership, avoiding unnecessary policy presentation changes. The focused access page's Home button now exposes destination search. Native reload tests load the private page with an explicit system principal, use a fresh post-load automation handle, and never assume an old extension tab ID provides a surviving binding. These are harness/presentation corrections, with D18 authorization preserved.

### Files in this pass

| Layer | Files |
| --- | --- |
| Core | New `packages/core/src/configuration.ts`; updated `atlas-models.ts`, `atlas-state.ts`, `atlas-planner.ts`, `atlas-controller.ts`, `atlas-controller-models.ts`, `atlas-ports.ts`, `vault-models.ts`, `vault-state.ts`, `vault.ts`, `index.ts`. |
| Core tests | New `packages/core/tests/settings.test.mjs`; aggregate/schema fixture updates in `atlas.test.mjs`, `controller.test.mjs`, `stabilization.test.mjs`, `managed-blacklist.test.mjs`, `support/fake-repository.mjs`. |
| Firefox / UI | New `extension/src/adapter/journey-indicator.ts`, `extension/src/ui/destinations.ts`; updated `adapter/firefox-adapter.ts`, `storage/indexeddb-repository.ts`, `presets/curated-whitelist.ts`, `ui/main.ts`, `ui/assets/index.html`, `ui/assets/style.css`. |
| Adapter / native tests | New `extension/tests/productization.test.mjs`, `extension/scripts/firefox_productization.py`; updated `tests/repository.test.mjs`, `adapter.test.mjs`, `presets.test.mjs`, `support/fake-firefox.mjs`, `support/fixture.mjs`, `scripts/firefox-e2e.py`. |
| Guidance | `AGENTS.md`, root/extension README, foundation/architecture/acceptance/first-steps/Firefox adapter/managed-policy docs; status updates on the existing stabilization and authentication reports; this report. `.gitignore` excludes generated Python caches. |

Earlier uncommitted stabilization/investigation changes were preserved. No package dependency, manifest permission or browser-specific Core capability was added.

## Remaining limits and next polish

The accepted redirect residual risk and existing provider/form/JS compatibility limits remain. Full authenticated returns, physical crash/power-loss guarantees, trusted clock recovery, private/container/browser-internal coverage and receipt compaction are outside this pass. Older schema-1 builds reject newly migrated schema-2 authority; there is no downgrade conversion. Known corrupt storage still requires conservative recovery, not a permissive reset.

The interface uses the existing service categories and exact-host policy editor. There is no browsing history, external search, inferred alias or automatic saved-policy expansion. New KTH Mail metadata becomes available in existing profiles only after the usual curated Vault update.

Next polish should follow daily use: reduce the length of policy/settings review for small edits, improve destination organization and accessible search feedback, and tune layout for smaller screens. Address reproducible adapter/storage issues narrowly. Preserve the settled authorization model; production duration recommendations and minimums remain a separate product decision.
