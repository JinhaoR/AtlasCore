# Atlas Firefox extension

Firefox integration and UI for [`@atlas/core`](../packages/core/README.md).
The current unsigned signing candidate is **0.3.2**. Signed 0.3.1 and all retained
releases remain frozen; see [version history](../docs/version-history.md).

## Build and load

Use Node 24 and Firefox 140 or newer. From repository root:

```sh
npm --prefix packages/core ci
npm --prefix extension ci
npm --prefix extension run build
```

Load `extension/dist/manifest.json` through **Load Temporary Add-on** at
`about:debugging#/runtime/this-firefox`, using an isolated development profile.
Keep the entire output directory together. Rebuild before reloading changed code.
The toolbar opens a read-only popup with shortcuts to the shared control page.
Home contains search and the compass. **All Sites** owns the category directory
and editor. **Greylist & Journeys** holds temporary access and Journey controls.
**Settings → Appearance** selects the theme; Settings also includes Vault.

Fresh setup and upgrades follow the [curated policy contract](../docs/curated-expansion.md)
and [curated subdomain migration](../docs/curated-subdomains.md). They preserve
custom policy/settings and migration receipts. Presentation data never grants
permission. No development build signs, deploys or updates an everyday profile.

## Runtime ownership

| Source | Runtime entry / responsibility |
| --- | --- |
| `src/background/main.ts` | `background.js`: persistent background wiring, concrete adapters/storage |
| `src/adapter/` | Firefox navigation and download correlation, actual effects, toolbar and bounded diagnostics |
| `src/storage/`, `src/managed/`, `src/presets/` | IndexedDB, pinned feed verification and required existing-install migrations |
| `src/bookmarks/` | One serialized presentation owner for native bookmark integration; no Core controller authority |
| `src/ui/main.ts` | `ui/main.js`: shared control page, one visible-page refresh owner |
| `src/ui/startup.ts` | `ui/startup.js`: early route presentation before main initialization |
| `src/ui/theme-startup.ts`, `src/ui/theme.ts` | `ui/theme-startup.js`: synchronous saved theme selection and acknowledged preference writes |
| `src/ui/popup.ts` | `ui/popup.js`: read-only toolbar popup, closed shortcuts |
| `src/content/journey-indicator.ts` | `journey-indicator.js`: passive website indicator, manifest-loaded |
| `src/ui/assets/` | Shared HTML, component/layout CSS and application icons |
| [`../themes/`](../themes/README.md) | Visual CSS variables, fonts and theme artwork; copied into stable `ui/` runtime paths by `build.mjs` |

The extension imports Core; Core imports no extension modules. UI policy previews
use Core decisions and still require current revisions and acknowledged commits.
Shared DOM, geometry, focus and interaction belong to UI owners, not theme files.
Do not split components by theme or add another refresh loop.

## Storage and recovery

Authority uses transactional IndexedDB through the injected Core repository.
Presentation preferences, draft state and bookmark intent have separate owners.
Theme IDs retain the `atlas-theme-v1` localStorage key. Legacy schemas/receipts,
strict CAS, explicit confirmation and uncertain-write reconciliation stay intact.
Never clear saved data to work around a failed load. See
[storage reliability](../docs/firefox-storage-reliability.md),
[rendering stability](../docs/ui-stability.md) and [backup](../docs/firefox-backup.md).

## Validation

```sh
npm --prefix extension run build
npm --prefix packages/core run test:built
npm --prefix extension run test:built
python extension/scripts/firefox_compact_home.py --theme-prototypes-only --signed-baseline 0.2.8
```

Native scenarios use task-created runtime copies and disposable profiles.
[Development guidance](../docs/development.md) maps changes to tests and native
scenarios. Unit/mocked results are not native-browser or real-provider evidence.
The top-level HTTP(S) gate excludes embedded resources, private browsing and
unsupported browser/internal schemes; see [adapter limits](../docs/firefox-adapter.md)
and [Download Intent](../docs/firefox-downloads.md).

Release tools and retained packages live outside application code. Follow the
[private release contract](../docs/firefox-private-release.md) for a separately
authorized new release; current runtime allowlists intentionally remain frozen.
`build-home-poc.mjs` remains a tested manifest-copy convenience, not a runtime
entry. Historical contracts and browser evidence remain in `docs/`.
