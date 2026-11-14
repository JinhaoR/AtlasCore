# 0.3.2 — compass and everyday site controls

The reported problems were reproduced in the actual signed 0.3.1 in a fresh,
disposable Firefox profile. Its CSS removed the compass with zero or one pin,
and below 1000 CSS pixels. The All Sites dialog had no opening action. The
friend's version is confirmed as 0.3.1; their exact pin count/window size is
unknown. See [baseline observations](baseline.json).

## Changes

- Keep the compass visible when empty or holding one pin. Explain how to add
  pins without silently choosing sites or granting permissions.
- Keep the interactive ring above 600 CSS pixels. Smaller windows show the
  compass above labelled shortcuts, preserving readable, usable controls.
- Add **Open site** and **Pin to Home / Unpin from Home** to site details.
  Opening goes through the existing Firefox adapter and Core gate. Pinning uses
  acknowledged presentation storage; neither action submits a policy draft.
- Replace monospaced rule text with an address, access label and plain scope
  explanation. Put change timing under **How changes work**. Simplify common
  editing labels and feedback. Keep errors and unknown save outcomes visible.
- Wait for draft-discard acknowledgement before reporting success. Pin saves
  retain the existing address rows instead of reconstructing them.

[Site-dialog preview](site-details.png) · [Empty compass](empty-compass.png) ·
[One saved pin](pinned-compass.png)

## Candidate

- [Unsigned 0.3.2 ZIP](../../../extension/release/0.3.2/atlas-0.3.2-unsigned.zip)
- [Reviewer source ZIP](../../../extension/release/0.3.2/atlas-0.3.2-source.zip)
- [Integrity receipt](../../../extension/release/0.3.2/release.json)

The strict runtime inventory remains 39 files. Source reproduction from a clean
extraction with locked, offline dependency installation matches every runtime and
source hash and both archives byte-for-byte: [reproduction](reproduction.json).
Signing, submission and deployment were not performed. Existing signed 0.3.1
passes offline comparison with its original unsigned receipt and remains unchanged.
The friend will need the new signed 0.3.2 XPI after signing.

## Verification

| Check | Result |
| --- | --- |
| Core | 253 tests passed; source unchanged |
| Firefox extension | 693 tests passed, including gated opening for allowed/blocked sites, unavailable authority, failed pin save/retry, retained address nodes and acknowledged draft discard |
| TypeScript, build and diff checks | Passed |
| Lint and release validation | Zero errors/notices; one existing Firefox Android minimum-version warning for the data-collection declaration; desktop Firefox 140+ remains the supported target |
| [Native site controls](native.json) | Fresh/zero/one/six pins; desktop, 980px, narrow and actual 360 CSS-pixel viewport; ordinary pointer launch of ChatGPT, pin save/reload and unchanged policy/settings |
| [Both themes](themes.json) | Theme switching, saved preference after full restart, pin pointer activation, wheel rotation, search/editor/Vault, narrow viewport and zoom |
| [Upgrade/restart/rollback](upgrade.json) | Actual signed 0.3.1 with a temporary 0.3.2 overlay, full restart, then rollback without uninstalling; policy, settings, pins, category order/icons, bookmarks, drafts, proposal/request/grant deadlines and theme preference retained |
| [Protected files](integrity.json) | All 153 snapshotted Core, theme and retained-release files unchanged |

Native tests used Firefox 160.0 on Windows and isolated profiles/runtime copies.
They did not use the everyday Firefox profile. Browser tests are separate from
mocked/unit authorization tests. No new migration, dependency, background artwork
or policy change was introduced. This pass does not claim a fix for the historical
idle INTERNAL_ERROR or repeat the external authentication/download test matrix.

Commands after building:

```powershell
npm.cmd --prefix packages/core run test:built
npm.cmd --prefix extension run test:built
npm.cmd --prefix packages/core run typecheck
extension/node_modules/.bin/tsc.cmd -p extension/tsconfig.json --noEmit
npm.cmd --prefix extension run release:validate
python extension/scripts/firefox_compact_home.py --friendly-sites-only --friendly-sites-baseline --signed-baseline 0.3.1
python extension/scripts/firefox_compact_home.py --friendly-sites-only --signed-baseline 0.3.1 --addon-dir extension/release/0.3.2/addon
python extension/scripts/firefox_compact_home.py --theme-prototypes-only --signed-baseline 0.3.1 --addon-dir extension/release/0.3.2/addon
python extension/scripts/firefox-e2e.py --release-upgrade-only --release-baseline-version 0.3.1 --addon-dir extension/release/0.3.2/addon
```

Sanitized results are retained here. Only this task's identified disposable
profiles, copied runtimes and reviewer build directories were removed afterward.
