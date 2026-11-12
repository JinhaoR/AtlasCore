# Atlas Firefox 0.2.1 signing candidate

Unsigned candidate for unlisted Mozilla signing. Identity remains
`atlas-development@atlas.invalid`. Signed 0.2.0 and all prior release artifacts
remain frozen. Preparation does not sign, submit, install or deploy.

## Changes from signed 0.2.0

- Atlas Home is both the Firefox homepage/new-window page and default new-tab
  page, using supported manifest overrides with bare `ui/index.html` paths.
  No hardcoded extension UUID, extra permissions, UI focus code or tab redirects.
  Existing destination launchers still use the ordinary Atlas authorization gate.
- Stable initial navy shell, reserved category/icon geometry and local critical
  font preloads. Expensive hidden directory and curated coverage projections run
  when opened; existing draft/receipt owners continue to synchronize normally.
- Successful website icons reuse a bounded optional local asset cache (128 images,
  64 KiB each, fixed seven-day freshness). Reads do not renew it or record usage.
  Icons retain node identity; failures use existing lookup/local fallback. No
  providers or permissions are added. Private contexts keep page-local behavior.
- A centred desktop viewport frame with internal category, additional-pin,
  directory, editor, review, Vault and Settings scrolling. Short/narrow/zoomed
  views use normal flow. Navigation restores the appropriate scroll surface.
- Native bounded Customize Home dialog with persistent heading/Close and
  save/failure/retry feedback. Native modality and Escape preserve underlying
  navigation, drafts and scroll. Existing acknowledgement/CAS semantics remain;
  no Apply step or new presentation preference schema is introduced.

The [repair report](startup-layout-0.2.1.md) gives before/after measurements and
limits; [package evidence](evidence/firefox-release-0.2.1.json) records verification.
This release preserves the 0.2.0 design and every existing command/capability.

Core, background, adapter correlation/enforcement, policy storage, defaults,
timings, scopes, managed precedence, Vault and migration behavior are unchanged.
There are no new dependencies or required permissions. The icon cache is optional
display storage, never an authorization input. No private state is packaged.

## Compatibility and limitations

Isolated Firefox testing upgrades actual signed 0.2.0 with a temporary 0.2.1
candidate overlay, restarts, and removes that overlay to return to actual signed
0.2.0 without uninstalling. Policy/Blacklist, protected settings, pins, categories,
layout, staged/raw drafts, requests/grants and frozen proposal deadlines must
remain intact. This is not permanent unsigned installation. Rollback ignores the
new optional icon cache; no authority or saved preference schema migration occurs.

The historical intermittent INTERNAL_ERROR remains unresolved. These changes
neither diagnose that incident nor promise multi-day reliability. No speculative
Core optimization, history pruning or permission cache is included. Windows native synthetic evidence does
not establish non-Windows rendering, physical trackpad behavior, screen-reader
conformance or every private authentication flow. Website icons may remain local
fallbacks, and optional storage may be unavailable or evicted.

Firefox can show **Your new tab has changed** and **Your homepage has changed**;
choose **Keep Changes** to acknowledge. The initial notice may take focus.
After acknowledgement, Ctrl+T/+ preserve ordinary immediate address-bar typing.
For Home on normal launch, turn off **Open previous windows and tabs** under
Firefox's Startup settings (homepage mode, `browser.startup.page=1`). If session
restore is enabled, Firefox restores the previous tabs instead. First-time
policy installation/update may finish after the initial startup page was chosen;
new tabs/Home use Atlas immediately afterward and the next homepage-mode restart
opens Atlas. No manual extension-UUID URL is needed.

The [integration report](firefox-home-newtab-poc.md) distinguishes stable Firefox
temporary-overlay tests from persistent unsigned Nightly fresh-install/upgrade
and full-restart tests under a copy of the user's enterprise policy. A future
signed stable upgrade's prompts still need verification after separate signing.
Private-window integration remains disabled by the existing manifest. Other
extensions or policies controlling these pages may take precedence.

The unchanged locked development toolchain has 13 npm audit entries (1 low,
10 moderate, 2 high); runtime-only audit is zero. No automatic dependency upgrade
is bundled. Reassess the toolchain separately rather than weakening package checks.

## Artifacts and separate signing

Under `extension/release/0.2.1/`:

- `addon/`: 23 explicitly allowlisted runtime files.
- `atlas-0.2.1-unsigned.zip`: unsigned Mozilla runtime package.
- `atlas-0.2.1-source.zip`: reviewer source, tests, locked build tools and notices.
- `release.json`: source/runtime/archive SHA-256 receipt.

Validation checks identity, pinned feed, source, runtime, archive contents and
Mozilla lint. A clean reviewer rebuild must reproduce both archives and the receipt.
Runtime excludes probes, maps, native fixtures and the development module tree.
Intentional bounded production diagnostics remain available during unavailability.

Only after separate authorization, from the repository root with signing
credentials supplied securely to the environment:

```powershell
npm.cmd --prefix extension run release:validate
npm.cmd --prefix extension run release:sign
```

The second command submits to Mozilla. Expected signed output:
`extension/release/0.2.1/signed/*.xpi`. It has not been run in this task.
After signing, verify without credentials using:

```powershell
npm.cmd --prefix extension run release:verify-signed -- 0.2.1
```

Back up and update in place under the same ID only in a separately authorized
deployment. Never edit a downloaded XPI or blindly resubmit after a timeout.
