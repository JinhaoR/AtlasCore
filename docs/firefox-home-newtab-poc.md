# Firefox Home and new-tab integration

Status: the 2026-11-03 proof of concept was verified separately, then the user
requested signing preparation. Its two manifest overrides are now included in
the unsigned 0.2.1 candidate. No extension identity, permissions, Core, adapter,
UI handler or persistence changes. The evidence below distinguishes the original
experiment from subsequent [release verification](version-history.md#v0-2-1).

## Implementation

The production manifest now declares:

```json
"chrome_settings_overrides": { "homepage": "ui/index.html" },
"chrome_url_overrides": { "newtab": "ui/index.html" }
```

Ordinary development and release builds both include these overrides. The old
`build:home-poc` command remains an idempotent development-copy convenience;
`build-home-poc.mjs` is not extension runtime code. The integration reuses the
complete existing Home document, its normal
refresh/disposal owners and ordinary gated launchers. Opening a new tab neither
creates a Journey nor grants access. The extension-relative URL is resolved by
Firefox separately in each profile; no installation UUID is embedded.

Use the bare path. Native Firefox 159 appended typed text to the extension URL
when the experiment used `ui/index.html#home`. Removing the fragment restored an
empty address bar and ordinary typing, without changing Atlas's History API or
focus code. Home is already the UI's default route. Test hypotheses that changed
the bundled History API call were discarded; the final UI is byte-identical to
the ordinary development UI.

These are Firefox's supported [homepage override](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/chrome_settings_overrides)
and [new-tab override](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/chrome_url_overrides).
They do not require interception of `about:newtab`, tabs-created redirects,
startup scripts or privileged settings commands in Atlas.

## Trying it

1. From the repository root, run `npm.cmd --prefix extension run build`.
2. Use a separate Firefox test profile, leaving the everyday profile closed or
   untouched. In that profile open `about:debugging#/runtime/this-firefox`, choose
   **Load Temporary Add-on**, and select `extension/dist/manifest.json`.
   Keep the same Atlas ID; don't uninstall an existing Atlas to test an upgrade.
3. Open a new tab. Firefox can show **Your new tab has changed**. Choose
   **Keep Changes**. The notice can take focus on this first use; subsequent
   Ctrl+T and + tabs allow immediate address-bar typing. Firefox can separately
   show **Your homepage has changed**, also with **Keep Changes**.
4. For Atlas on ordinary launch, leave Atlas controlling **Homepage and new
   windows** in Firefox Settings → Home, and turn off **Open previous windows
   and tabs** under Startup (General in the tested layout; some Firefox layouts
   call this Home and startup). The normal homepage startup value is
   `browser.startup.page = 1`. A deliberately configured blank-start value `0`
   must be changed to homepage; Atlas does not change this preference.
5. If session restore is enabled (`browser.startup.page = 3`), Firefox restores
   the previous tabs instead. Atlas does not insert an additional Home tab.
   Ctrl+T, + and the Home button still use the overrides. If the Home button is
   absent, use Firefox's Customize Toolbar to add it.

Temporary add-ons disappear on a complete Firefox restart. This is suitable for
trying the UI, not a permanent installation. Do not deploy `dev-home` or replace
the installed enterprise-policy XPI with it. Permanent normal-Firefox use needs
a separately approved, signed release. No signing is done by this experiment.

Firefox owns the [override notices and settings](https://support.mozilla.org/en-US/kb/extension-changed-my-new-tab-page).
No manual `moz-extension://` homepage URL is needed. Other homepage/new-tab
extensions or a policy locking those settings can prevent an override. Private
windows remain outside Atlas's existing `incognito: not_allowed` scope.
[Session restore](https://firefox-source-docs.mozilla.org/browser/components/sessionstore/docs/events.html)
can also occur for browser updates/crashes independently of ordinary launch.

## Native verification and limits

`extension/scripts/firefox-home-overrides.py` copies a supplied Firefox runtime,
uses a fresh generated profile and copies the user's `policies.json`, changing
only Atlas's `install_url` to a disposable local XPI. Other policy entries are
retained. It observes the actual active force-install policy. It never modifies
the installed browser, policy, everyday profile, or signed release.

The latest signed repository baseline is **0.2.0**. The installed distribution
file still identifies itself as 0.1.16; that is not sufficient to infer which
version is running in the user's profile. This test uses signed repository
0.2.0 as the current signed baseline, rather than reading the everyday profile.

Normal Firefox **159.0** tests a temporary overlay on the policy-installed
signed baseline. Persistent unsigned tests use Mozilla's official portable
Nightly **160.0a1**, with `xpinstall.signatures.required=false` only in disposable
Nightly profiles. That supported testing facility permits genuine policy-driven
fresh installation, upgrade and full process restarts without signing. It does
**not** prove that every prompt will be identical in a future signed stable
upgrade. No signature bypass was applied to normal Firefox.

The harness checks native Ctrl+T typing, the actual + and Home button handlers,
Firefox's New Window command, initial notices, and real session-restore settings.
It uses generated TLS material and a loopback-only port-443 server for pinned
destination loads, manual Blacklist denial and default Greylist. It prepares
test policy through the existing Vault wait and explicit confirmation. Failed
navigation must produce the expected Core result and `REMOVED` effect without
reaching the server. No fixture bypass is included in the runtime.

See `docs/evidence/home-newtab-poc/` for final observations and runtime-integrity
checks. This is Windows/headless native evidence, not a claim about physical
mouse input, macOS shortcuts, every Firefox version, conflicting extensions,
private browsing or all enterprise policies. The historical INTERNAL_ERROR is
unresolved and is unaffected by manifest overrides.

### Results

| Check | Firefox 159 temporary upgrade | Nightly 160 fresh | Nightly 160 upgrade |
| --- | --- | --- | --- |
| Ctrl+T and + open existing Home; typing replaces an empty address bar after notice | Pass | Pass | Pass |
| Home button / New Window command | Pass | Pass | Pass |
| Firefox first-use new-tab and homepage notices | Observed; Keep Changes acknowledged | Observed; Keep Changes acknowledged | Observed; Keep Changes acknowledged |
| Saved baseline policy and pins, same profile origin | Pass | Fresh state | Pass |
| Pinned local HTTPS page loads; Blacklist DENY / Greylist with REMOVED; no server hit for either denial | Pass | Pass | Pass |
| No Access Requests or Grants created by those launches | Pass | Pass | Pass |
| Complete restart, homepage startup | Not persistent for temporary add-ons | Pass | Pass |
| Complete restart, previous-tabs setting; subsequent Ctrl+T and typing | Not persistent for temporary add-ons | Pass | Pass |

Both policy-managed fresh installation and first upgrade startup initially
showed Firefox's existing `about:home`: policy installation/update happened
after the initial startup page had been chosen. New tabs/Home immediately used
Atlas after installation completed, and the following full homepage-mode
restart opened Atlas. No automatic tab redirect was added to hide this browser
timing behavior. No manual homepage URL edit was required in these fixtures.

At the original proof-of-concept checkpoint, the standard development build (including both TypeScript compilers) passed,
as did **545 extension tests**. Mozilla `web-ext lint` reports **0 errors** and
the existing Android minimum-version warning. The experimental runtime differs
from `extension/dist` **only in manifest.json**, and only by the two overrides.
All **188 then-existing release files** matched their pre-task SHA-256 hashes. Core
source and runtime are unchanged; this pass did not rerun the unaffected Core
suite. That checkpoint predates promotion into the 0.2.1 release. Current release
checks are recorded separately; signed artifacts remain frozen.

### Repeating the tests

After building, use `--addon-dir extension/dist` (or the staged release `addon/`).
Without that option, the harness retains its historical `extension/dev-home` default:

```powershell
python extension/scripts/firefox-home-overrides.py `
  --firefox 'C:\Program Files\Mozilla Firefox\firefox.exe' `
  --policies 'C:\Program Files\Mozilla Firefox\distribution\policies.json' --upgrade

# A separately extracted official Nightly, never the user's installed Firefox:
python extension/scripts/firefox-home-overrides.py `
  --firefox '<portable-nightly>\firefox.exe' --policies '<copy-source>\policies.json' `
  --unsigned-persistent
# Add --upgrade for policy-driven signed 0.2.0 -> experimental runtime upgrade.
```

The harness leaves its exact generated directory printed at startup for failure
diagnosis. Retain sanitized results, then remove only those disposable profiles
and runtime copies after their processes have exited. Do not broadly delete
`.tools`.
