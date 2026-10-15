# Reproduce Atlas 0.1.16 for Mozilla review

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

Version 0.1.16 preserves the 0.1.15 destination batch/Vault workflows, bounded
Download Intents, saved Home category organization and visual polish. It adds
stable DOM reconciliation, coalesced read-only presentation refreshes and a
Journey display heartbeat through the existing background observation loop.
`docs/ui-stability.md` describes these presentation fixes and native measurements.
No Core authorization semantics, permissions or storage schemas change.
The included `docs/firefox-downloads.md`, `docs/home-organization.md` and
`docs/visual-polish.md` describe scope, persistence, browser evidence and limits.
Download Intents are operation-bound, expire after 30 seconds, allow at most five
redirects and never create policy entries or ordinary Access Grants. Unfamiliar
HTML requires ordinary navigation authorization. Home layout is presentation only.
The extension identity, required permissions and authoritative snapshot schema
are unchanged; reviewer and runtime archives contain no private browser state.

Build tools are pinned: TypeScript 6.0.3, esbuild 0.25.12, web-ext 10.7.0 and
fflate 0.8.3. web-ext and fflate run only during packaging; they are not bundled
into the extension. The lockfile overrides fx-runner's vulnerable shell-quote with
1.12.0. npm currently reports an unpatched node-forge advisory through web-ext's
Android development dependency; this pipeline does not use Android tooling.

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
