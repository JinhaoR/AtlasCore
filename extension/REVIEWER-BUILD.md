# Reproduce Atlas 0.3.0 for Mozilla review

Extract the source ZIP into an empty directory. Use **Node.js 24.12.0, npm 11.6.4**
(the versions used for this release) on Windows, Linux or macOS. Node 24+ is the
project baseline and exceeds web-ext v10's Node 22+ requirement. No global compiler,
browser, account, API key or signing credential is needed to rebuild.

From the extracted root:

```sh
npm --prefix packages/core ci
npm --prefix extension ci
npm --prefix extension run release:build
npm --prefix extension run release:validate
```

The matching manifest/package version selects `extension/release/<version>/addon`.
Compare its files to the unsigned package. After signing, use `release:verify-signed`
to compare actual runtime contents: only known Mozilla `META-INF` files and JSON
whitespace outside strings in the manifest are permitted differences. Ordinary
runtime files remain exact. `release.json` records SHA-256 digests of
every source/runtime file and both archives. ZIP entries use fixed timestamps.
Network access is needed only for `npm ci`; feed assets are pinned and included.
Do not run `release:sign` to reproduce the build.

Optional domain/adapter tests:

```sh
npm --prefix packages/core test
npm --prefix extension test
```

The source ZIP includes TypeScript, tests, lockfiles, compiler/bundler/release
scripts, runtime assets and notices. Python native-browser harnesses are development
tools and are not needed to reproduce the extension. Development `dist` outputs,
node_modules, profiles, local authority, credentials and caches are excluded.

The source ZIP includes the sanitized `auth-evidence-observer.js` fixture because
an optional unit test reads it. It is never imported by production entry points
or included in the unsigned runtime. Package evidence and the integrity receipt
are produced after packaging and are kept alongside the archives, avoiding a
self-referential source-archive hash.

Version 0.3.0 separates Home (search, compass and Greylist) from All Sites
(category directory and contextual native editor). It also includes the post-0.2.8
compass hit-target repair and acknowledged Greylist cancellation feedback. Core,
permissions, storage, synchronization and authority semantics are unchanged from
signed 0.2.8. Saved layout order/icons/pins/drafts remain compatible; obsolete Home
visibility preferences are retained but do not hide entries in the complete
directory. No new schema or migration. See `docs/release-candidate-0.3.0.md`.

The following notes describe earlier releases, not new 0.3.0 changes.

Version 0.2.8 adds the explicitly approved one-time curated subdomain migration:
still-allowed catalog hosts gain literal domain-and-subdomains scopes, preserving
manual Blacklist, custom terms and settings. No registrable-parent inference or
Google search exception is added. Core also adds explicit, persisted termination
of an existing temporary grant, without renewal or reclassification. See
`docs/curated-subdomains.md` and `docs/architecture.md`.

The required `bookmarks` permission replaces the optional one. The existing
journaled toolbar synchronization connects automatically unless explicitly
disconnected or blocked by a conflict. Native toolbar folders are read-only
compass groups; their icon overrides use the independent `toolbar-folder-icons-v1`
presentation record. Every bookmark launch still uses the normal Core gate.
Home has one category column and inline Greylist actions; legacy access links
resolve to Home with their explicit original context. No remote code, new
dependencies or runtime assets are added. See `docs/release-candidate-0.2.8.md`
for migration, permission-consent, backup and downgrade limitations.

Version 0.2.7 refines Home spacing and a two-row Greylist overview, separates
Journey summaries and removes implicit Home access-tab selection. The compass
rotates with its pins using bounded, pointer-timestamp-based friction. A failed
Firefox launch now shows its actual error, an explicit retry through the existing
gate, and a closed diagnostic code. There is no new authorization, permission,
storage format, dependency or runtime asset. Signed 0.2.6 and all older releases
remain frozen. See `docs/release-candidate-0.2.7.md` and the current sections of
`docs/home-organization.md` and `docs/ui-stability.md`.

Version 0.2.6 refines category dragging, compass inertia, icon picking, Home sizing
and navigation. Vault is inside Settings; static UI copy is escaped into HTML at
build time from `extension/src/ui/ui-text.ts`. The optional bookmark connection
now mirrors direct toolbar bookmarks, leaves folders untouched and deletes matched
toolbar bookmarks on unpin. The existing presentation owner journals these changes;
there is no new authorization or permission. An optional `scope: "toolbar"` field
extends the sync record; older builds cannot read that connection after opt-in.
Legacy folder connections remain readable without automatic conversion. See
`docs/release-candidate-0.2.6.md` and `docs/everyday-controls.md`. Core and authority
schemas remain unchanged. All 27 runtime assets use the existing build; signed
0.2.5 and every earlier release are frozen.

Version 0.2.5 replaces Home's six-category shortcut/directory split with a
scrollable grid, direct drag/keyboard ordering and local category icon choices.
The independent `category-icons-v1` record uses existing presentation CAS storage;
the layout record and authority schema do not change. Home now opens the existing
Firefox bookmark connection directly, while the detailed page editor remains in
Settings. There are no new permissions, dependencies, Core changes or runtime
files. All 27 assets reproduce through the same build. Signed 0.2.4 and older
artifacts are frozen. See `docs/release-candidate-0.2.5.md` and
`docs/home-organization.md` for compatibility, backup and interaction details.

Version 0.2.4 adds a read-only native toolbar popup, optional Firefox bookmark
synchronization, clearer control-page wording and stable Home/startup rendering.
The optional `bookmarks` permission is requested only when connecting a folder.
The independent `firefox-sync-v1` presentation record journals external operations;
it carries no Core authority. Full URLs stay out of diagnostics. See
`docs/everyday-controls.md`, `docs/ui-stability.md` and
`docs/release-candidate-0.2.4.md` for privacy, persistence and compatibility.
The runtime allowlist adds exactly popup HTML/CSS/JS and `ui/startup.js`; the
reviewer rebuild produces all 27 assets. Signed 0.2.3 and older assets are frozen.

Version 0.2.3 adds compact Home, inline category browsing and user-named bookmark
pages under existing pinned destinations. Bookmarks use an independently revisioned
`bookmarks-v1` record in the existing Home presentation database; there is no
authority migration. Every exact selected URL uses the existing OPEN_DESTINATION
gate. Pins, categories and authority remain independent. Full bookmark URLs are
stored locally and excluded from diagnostics. Portable policy backup does not
include them; a closed-profile backup does. See `docs/compact-home.md` and
`docs/release-candidate-0.2.3.md`. Core, browser permissions, identity, dependencies
and authorization commands are unchanged. Signed 0.2.2 and older assets are frozen.

Version 0.2.2 fixes content sizing of directory rows, removes repeated full-policy
normalization from destination display through a stateless batch evaluator, and
keeps initial loading separate from unavailable-state recovery. Categories wait
for saved layout preferences before rendering. Core authorization rules,
controller validation, storage schemas, permissions and dependencies are unchanged.
See `docs/release-candidate-0.2.2.md` and `docs/ui-engineering-review.md`.
Signed 0.2.1 and every older release remain frozen.

Version 0.2.1 repaired startup and viewport behavior in the 0.2.0 redesign:
stable shell/reserved geometry, deferred hidden directory/curated projections,
bounded desktop scroll regions and native modal Home customization. Successful
website icons use a separate optional asset cache: 128 entries, 64 KiB each,
seven-day fixed freshness, no usage renewal; private contexts keep page-local
icons. Cached bytes are revalidated. No policy data, URL history or credentials
enter that cache. Asset failure retains the existing network/local fallback.
Authority schemas, commands, required permissions and dependencies are unchanged.
Signed 0.2.0 remains frozen. See `docs/startup-layout-0.2.1.md` for measurements.

The user-approved 0.2.1 follow-up includes Firefox homepage/new-window and
new-tab manifest overrides pointing at the existing relative `ui/index.html`.
There is no hardcoded UUID, new permission, tab redirect or focus override.
Firefox owns the change notices and startup/session-restore settings. All Home
launchers retain existing Core gating. See `docs/firefox-home-newtab-poc.md` for
native evidence and the distinction between stable temporary-overlay tests and
persistent unsigned Nightly tests. The source-only `build-home-poc.mjs` helper
is included because the manifest regression test imports it; it is not runtime.

The 0.2.0 design retains static compass pins,
category workspace, directory with adjacent editor, complete batch review,
dedicated Vault and section-based Settings. It bundles Cormorant Garamond and
Source Sans 3 WOFF2 files locally, with original SIL OFL notices and provenance
hashes under `extension/src/ui/assets/fonts`. No runtime font service is used.
Existing website favicon lookup/fallback is retained. No permissions, storage
schemas or authorization semantics are added by the visual redesign. The later
0.2.1 manifest-only Home/new-tab integration is described above.

It preserves the 0.1.19 batch drafts, Home organization, exact legacy rules,
scoped grants, bounded Journeys and Download Intents. It fixes editor/review
interaction, reduces repeated validated-state comparison/freezing and presentation
work, and retires late arrival reads only when their tab context is already gone.
Full authority validation, atomic persistence, receipt checks and conservative
unknown-outcome handling remain. There is no authority cache or write debounce.

The earlier 0.1.19 policy features remain: reviewed strict Whitelist
removals can commit immediately; a default-off domain-and-subdomains Whitelist
scope requires Vault. Manual Blacklist wins, and managed blocking still applies
to additional subdomains unless separately exactly Whitelisted. See
`docs/whitelist-removal.md` and `docs/whitelist-scopes.md`.

Fresh defaults contain 294 exact hosts across 122 services, omitting Wikipedia
and YouTube. Existing v2 expansion receipts remain valid; startup does not reapply
expansion or remove saved user permissions. The v3 receipt is only for previously
unmigrated installations. Custom policy, settings, pins, layouts and drafts remain.
The extension ID and permissions are unchanged. New optional scope fields are
validated; see the release notes before attempting a downgrade.

Bounded, sanitized production fault diagnostics remain accessible during authority
unavailability, after Recovery and across background restart. These are intentional
product diagnostics; test probes and native-test instrumentation are not packaged.
The user's intermittent INTERNAL_ERROR remains unresolved. Controlled race fixes
and stress tests do not establish its original cause or guarantee multi-day uptime.
`docs/release-candidate-0.2.1.md` summarizes the changes and known limitations.
`docs/quality-pass-0.1.19.md` distinguishes measured and historical evidence.
Runtime/source archives contain no private profiles, local state or credentials.

Build tools are pinned: TypeScript 6.0.3, esbuild 0.25.12, web-ext 10.7.0 and
fflate 0.8.3. web-ext and fflate run only during packaging; they are not bundled
into the extension. The lockfile overrides fx-runner's vulnerable shell-quote with
1.12.0. Advisory counts can change independently of the locked packages; the current
release evidence records the observed runtime and development-toolchain audits.
These are the unchanged locked tools, not newly added runtime
packages. No automatic audit fix or lockfile upgrade is applied during preparation.
The release evidence records the observed advisory results; reassess separately
before changing the toolchain. This pipeline does not use Android tooling.

Runtime dependency: tldts/tldts-core 7.4.16 (MIT), bundled locally; its license is
in `extension/THIRD-PARTY-NOTICES.txt`. Managed feed provenance, pinned digest and
licenses are in `extension/data/stevenblack`. No code is fetched for execution.
Atlas code is submitted for private review; this milestone grants no new public
license. Consult the owner for redistribution rights beyond authorized testing.

This is a Manifest V2 persistent Firefox desktop background adapter. Core has no
browser dependencies. Top-level requests use webRequestBlocking; UI messages from
website contexts cannot execute privileged commands. The extension's required
`browsingActivity` declaration covers public icon/scope requests, including Google's
favicon lookup; see `docs/firefox-privacy.md`. Source and unlisted submission are
provided to Mozilla for review, not a public AMO listing.
