# Atlas Firefox 0.2.4 — unsigned signing candidate

This candidate packages the completed [everyday controls](everyday-controls.md)
and [rendering polish](ui-stability.md). Signed 0.2.3 and every older artifact are
frozen. Preparation does not submit to Mozilla, sign, deploy, change enterprise
policies or access the everyday Firefox profile.

## Changes since signed 0.2.3

- A native toolbar popup shows the current tab's access/Journey status and links
  to Home, Sites, current access, Vault and Settings. Its message surface is limited
  to read-only status and closed control-page navigation; confirmations stay in
  the existing control page.
- Everyday wording uses Sites, Allowed and Blocked. Reviews retain exact addresses,
  scope, timing and consequences while disclosing technical detail separately.
  An unsuccessful search can prefill Add site without inferring permissions.
- Desktop Home keeps search, pins and footer stable across category/search and
  countdown updates. Smaller/zoomed windows retain document scrolling. Reloads
  select the correct page shell before the main interface starts.
- Home prepares category cards when first opened, preserving their existing
  controls thereafter. Saved preferences load early; routine housekeeping does
  not flash unverified pin labels. Actual unavailable authority still fails closed.
- Optional two-way Firefox bookmark synchronization connects an explicitly chosen
  or created folder after permission and merge preview. It synchronizes shortcuts,
  named pages and ordering, never access rules. Conflicts/partial writes have
  explicit recovery, and unpin archives the native group without deleting pages.

## Permissions, persistence and upgrade

Required permissions, extension ID `atlas-development@atlas.invalid`, Firefox
140+ baseline and relative Home/new-tab overrides are unchanged. The only added
permission is **optional `bookmarks`**, requested when the user chooses to connect.
Existing pins/pages work without granting it. No new dependency or Core source
change is part of this release.

Policy, settings, pending requests, grants, Vault proposals, drafts, categories,
pins and `bookmarks-v1` remain compatible. Bookmark sync adds an independent
revisioned `firefox-sync-v1` presentation record in the existing Home database,
with durable operation intent before browser bookmark mutations. It cannot
atomically commit Firefox bookmarks and IndexedDB; failures pause or reconcile
from actual results instead of reporting false success. No authority migration
or curated-policy reset is introduced.

Full bookmark URLs stay in local presentation storage and the connected Firefox
bookmark folder. They are excluded from Atlas diagnostics. Firefox's own Sync,
if enabled by the user, can synchronize that bookmark copy; Atlas policy/settings
are not synchronized. Portable policy backup does not include these presentation
records; use a closed-profile backup for the complete local state. Disconnecting
keeps both copies. Empty/deleted groups do not silently recreate default links.

Upgrade/rollback checks use actual signed 0.2.3, a temporary candidate overlay,
and full restarts in disposable profiles. Older Atlas ignores sync records and
does not synchronize bookmarks. Firefox may revoke an optional permission when
an overlay falls back to an older version without that permission; reconnecting
can require granting it again. These tests do not substitute for verification of
Mozilla's eventual permanent signed update.

## Evidence and remaining limitations

[Release verification](evidence/firefox-release-0.2.4.json) records regression
counts, archive hashes, clean reviewer reproduction and packaged native checks.
The [polish report](evidence/ui-polish/README.md) records stable geometry and
reduced initial card work. Short navigation timings varied; no large general
speedup or multi-day reliability guarantee is claimed.

The historical intermittent **INTERNAL_ERROR remains unresolved**. Existing
diagnostics and fail-closed recovery remain; no speculative recovery was added.
Headless native tests do not establish physical toolbar-click, popup-keyboard,
trackpad or screen-reader conformance. Native evidence is Windows Firefox;
cross-platform UI behavior is not independently verified. Very small windows
scroll normally. Website favicons still arrive asynchronously. Unsupported or
ambiguous native bookmark structures are preserved and excluded with feedback.

The runtime contains only the 27 named assets: the existing inventory plus
`ui/popup.html`, `ui/popup.css`, `ui/popup.js`, and `ui/startup.js`. No test probes,
source maps, development profiles or credentials are packaged. Older signed
runtime allowlists remain unchanged. The existing locked toolchain is retained;
dependency audit and Mozilla lint findings are recorded in verification evidence.

## Artifacts and separate signing step

`extension/release/0.2.4/` contains `addon/`, `atlas-0.2.4-unsigned.zip`,
`atlas-0.2.4-source.zip` and `release.json`. The source archive includes locked
dependencies, original TypeScript, tests, notices and reviewer build instructions.

From the repository root, after securely supplying `WEB_EXT_API_KEY` and
`WEB_EXT_API_SECRET` in your terminal environment:

```powershell
npm.cmd --prefix extension run release:validate
npm.cmd --prefix extension run release:sign
```

The signing command submits to Mozilla's **unlisted** channel; it is not run during
preparation. Signed output will be `extension/release/0.2.4/signed/*.xpi`.
After download, verify without credentials:

```powershell
npm.cmd --prefix extension run release:verify-signed -- 0.2.4
```

Deployment remains separate. Back up and update in place under the same ID; do
not uninstall Atlas or replace saved policy with curated defaults.
