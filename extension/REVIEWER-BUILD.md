# Reproduce Atlas for Mozilla review

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

## Current source and compatibility

This checkout prepares unsigned 0.3.2 with a visible compass for fresh profiles,
ordinary site-opening and pin actions in All Sites, and simpler site details.
Both themes, Greylist & Journeys and Settings → Appearance remain. The runtime inventory
contains 39 files, including local theme CSS, compass assets and startup code.
Use the instructions shipped inside a particular release source ZIP to reproduce
that release. The retained 0.2.8/0.3.0 packages and their embedded instructions
are unchanged; do not rebuild over them from this development tree.

Release changes are summarized once in [version history](../docs/version-history.md).
Current contracts cover [policy](../docs/architecture.md),
[curated migrations](../docs/curated-expansion.md),
[subdomain scopes](../docs/whitelist-scopes.md),
[bookmarks](../docs/everyday-controls.md) and
[storage/recovery](../docs/firefox-storage-reliability.md).
Migration code, old receipt validation, explicit confirmation and unknown-outcome
handling remain. Bounded production diagnostics are intentional and packaged;
native-test instrumentation, private profiles and credentials are not.
The intermittent INTERNAL_ERROR cause remains unresolved.

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

Development theme source now lives in the repository-root `themes/` tree.
The source collector includes its live assets and shared fonts; background authoring is separate from the build. Frozen release archives remain self-contained and unchanged.
The existing 0.3.0 runtime inventory predates themes: a future authorized release
must introduce a new version-specific inventory before packaging this development tree.
