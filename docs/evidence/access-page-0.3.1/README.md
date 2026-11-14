# 0.3.1 signing candidate

Unsigned 0.3.1 is ready for signing. No signing, submission, deployment or
everyday-profile access was performed. Signed 0.2.8 and prepared 0.3.0 are intact.

## Result

Home has the larger compass and narrower search composition. Greylist & Journeys
is a separate page beside All Sites. Settings → Appearance selects Celestial or
Parchment; existing Default/Light preferences remain compatible. Theme artwork,
colors, fonts, Core rules, storage formats and migrations are unchanged.

- [Unsigned extension ZIP](../../../extension/release/0.3.1/atlas-0.3.1-unsigned.zip)
- [Reviewer source ZIP](../../../extension/release/0.3.1/atlas-0.3.1-source.zip)
- [Release receipt and hashes](../../../extension/release/0.3.1/release.json)

The package contains exactly 39 allowed runtime files. A clean extraction and
offline `npm ci` rebuilt all runtime/source hashes and both ZIPs byte-for-byte:
[reproduction result](reproduction.json). Release validation passes. web-ext lint
reports zero errors, zero notices, and one Android minimum-version warning for
the data-collection manifest key. The supported target is desktop Firefox 140+;
native tests used Firefox 160.0 on Windows.

## Validation

| Check | Result |
| --- | --- |
| Core tests | 253 passed |
| Extension tests | 690 passed, including Journey context fencing, explicit cancellation/renewal, unavailable/empty lists, startup routing and frozen release inventories |
| Deployment tests | 35 passed; temporary filesystem fixtures only |
| TypeScript / build / diff whitespace | Passed |
| [Packaged themes](themes.json) | Both themes, Appearance section, local assets, search/editor/Vault, pin pointer activation and compass rotation; saved Parchment on first frame after full restart |
| Theme switching | Zero child-list mutations, browser messages, fetches or image-source assignments during the measured warm theme transaction; existing pin/SVG identity retained |
| [Access controls](greylist-controls.json) | Explicit context URL and Back navigation; dismiss unstarted request, wait, confirm, end grant; failed cancellation retains request; cancelled rows stay removed after reload |
| [Layout](layout.json) | Access-state samples cause zero Home position change; page lists have no former two-row limit; responsive and zoom checks include an actual 360 CSS-pixel viewport |
| [Add Site](add-site.json) | `github.io` scope stays blocked with explanatory help; native tenant checkbox selection, draft save and reload pass; authority unchanged |
| [Upgrade/restart/rollback](upgrade.json) | Signed 0.2.8 → temporary 0.3.1 overlay → full candidate restart → signed 0.2.8 rollback; policy, settings, pins, categories, bookmarks, drafts, proposals, request/grant deadlines and theme preference preserved |
| [Protected-file integrity](integrity.json) | All 95 snapshotted Core source, theme CSS/SVG and retained release files unchanged; existing signed 0.2.8 also passes offline verification |

Native runs used copied Firefox runtimes and disposable profiles. Theme/geometry
screenshots use synthetic presentation samples; they do not demonstrate authority
transitions. The separate controls and upgrade runs use real Core operations and
IndexedDB. No claim of a new performance improvement or a fix for the historical
idle INTERNAL_ERROR is made. Journey command controls have focused unit coverage;
this pass did not repeat the full external authentication/download browser matrix.

## Screenshots

- [Parchment Home](parchment-home.png) / [Celestial Home](celestial-home.png)
- [Appearance](parchment-appearance.png)
- [Greylist & Journeys](parchment-greylist.png)
- [Access page at 360 CSS pixels](access-360.png)

## Reproduction commands

```powershell
npm.cmd --prefix packages/core run test:built
npm.cmd --prefix extension run test:built
node --test scripts/tests/*.test.mjs
npm.cmd --prefix packages/core run typecheck
extension/node_modules/.bin/tsc.cmd -p extension/tsconfig.json --noEmit
npm.cmd --prefix extension run release:validate
python extension/scripts/firefox_compact_home.py --theme-prototypes-only --addon-dir extension/release/0.3.1/addon
python extension/scripts/firefox_compact_home.py --greylist-controls-only --addon-dir extension/release/0.3.1/addon
python extension/scripts/firefox_compact_home.py --greylist-layout-only --addon-dir extension/release/0.3.1/addon
python extension/scripts/firefox_compact_home.py --site-checkbox-only --addon-dir extension/release/0.3.1/addon
python extension/scripts/firefox-e2e.py --release-upgrade-only --release-baseline-version 0.2.8 --addon-dir extension/release/0.3.1/addon
```

The source ZIP's `extension/REVIEWER-BUILD.md` documents a clean reviewer rebuild.
Sanitized evidence lives here; this task's disposable runtime/profile and reviewer
build copies were removed after retaining results. No other session was cleaned.
