# Atlas Firefox 0.1.18 release candidate

Unsigned release preparation is authorized on 2026-10-29. The candidate preserves
the existing ID `atlas-development@atlas.invalid` and is intended for a separately
signed in-place update. No signing, submission, installed-profile change or
deployment is performed during preparation. Signed 0.1.13-0.1.17 remain frozen.

## Curated coverage

The default catalog grows from 51 to **298 exact hostnames across 123 services**.
The [complete list](curated-destinations.md) includes all requested Swedish,
Nordic, European and US universities; physics/mathematics departments; Nordita,
Perimeter, KITP, ICTP, CERN, DESY and other established institutes; and theory,
condensed matter, statistical mechanics, mathematical physics and numerical
teaching resources. David Tong/DAMTP, Sethna/Cornell, Oxford numerical analysis,
ETH statistical physics, KITP, PIRSA and the Feynman Lectures have exact coverage.

Zotero, Zenodo, Google Drive, OneDrive, Dropbox, Box, web documents, calendars,
collaboration, communication, development tools and essential utilities are also
included. Of the original 51 hosts, 49 remain in the catalog. The source change adds 249
catalog hosts; each existing installation can already have some of those hosts.
One service is represented once with explicit aliases/entry points. There is no
wildcard, parent-domain matching or automatic apex/www equivalence.

Before release, `youtube.com` and `www.youtube.com` were removed from the preset
and the same pending migration. All other catalog hosts are unchanged. YouTube
is Greylist by default; an existing saved Whitelist permission is preserved and
must be removed through ordinary Vault review if no longer wanted. No second
migration or forced policy removal is introduced.

## Existing installations

The developer explicitly authorizes one fixed migration for **all installations**,
with no device identifiers. The update uses the union of the current Whitelist
and the approved catalog. **Sites you added yourself remain Whitelisted.** It
never replaces your Whitelist with the bundled list or removes unrelated hosts.
It preserves the manual Blacklist, protected settings, pins, categories, metadata
and saved drafts. New manually or managed-Blacklisted candidates are skipped;
existing explicit Whitelist exceptions to managed data remain untouched.

**Previously removed curated Whitelist entries may return unless Blacklisted.**
This behavior is expressly accepted for this migration because historical
Greylist intent is not stored. A durable receipt prevents repeat application:
if you remove a curated site after this migration, subsequent startups do not
restore it. Failed saves roll back policy and receipt together and cannot publish
new permission. Explicit existing Recovery can retry a failed startup.

The change increments policy revision once if additions are needed. Under the
existing Core rules, older pending access requests, temporary grants, Vault
proposals and Journeys become stale. Their original records/timestamps are kept;
they are not rebased, renewed or confirmed. Pending Vault work may need cancelling
and recreating. Destination drafts remain saved and use existing reconciliation.

Policy & recovery shows added/already-present/skipped counts. The existing
Navigation diagnostics export includes the exact hostname lists in the migration
receipt. Those counts describe the historical migration, not current permission.

## Verification and limits

Development verification passes Core **204/204** and extension **430/430** tests,
including 18 migration regressions, catalog checks, five focused display/lifecycle
regressions and 14 idle-recovery/diagnostics regressions. Both TypeScript checks
and the development build pass. Isolated Firefox 159.0 upgrades signed 0.1.17 with real
Vault waits and two full process restarts, preserving custom hosts, Blacklist,
pins and changed timing. It verifies normal stale-revision rejection and that a
later removal stays removed. [Evidence](evidence/curated-expansion-2026-10.json)
records exact results; [public host evidence](evidence/curated-hosts-2026-10.json)
records anonymous probes and teaching references separately.
The fresh-install native run also verifies all 298 saved hosts, real Greylist
waiting/confirmation, stable countdown/focus, 500px layout, unavailable-state
handling, background reload and expiry at the unchanged grant deadline.

Public checks do not establish successful authenticated account use. Shared
authentication providers continue through existing bounded Journeys. Unlisted
institution-specific OneDrive/SharePoint tenants, Slack workspaces or SSO hosts
do not gain wildcard permission. Some public servers reject automated HEAD
requests or were unreachable/TLS-blocked from the probe environment; these results
remain visible in the evidence. No TLS checks were disabled.

## Draft performance and rendering audit

The [measured audit](performance-audit-0.1.18.md) identifies repeated quadratic
display indexing as the main large-draft bottleneck, amplified by the expanded
preset. Sites/draft indexing now validates the policy once and groups its literal
display terms; actual authorization continues through unchanged Core decisions.
Redundant same-turn render notifications coalesce. Existing draft and Sites rows
are updated in place, and owned draft connections close after queued saves drain.
No persistence debounce, authorization cache or reduced validation at submission.

Matched native medians: additions fall from about 3.7–3.8 seconds to 125–140 ms,
rapid edits from 8.5 seconds to 250 ms. An unchanged 30-second review creates zero
DOM elements before and after; its aggregate Firefox CPU falls from 29.9% to
5.88% of one core in the measured run. This is not a claim that all intermittent
flicker or week-long degradation has been reproduced. See the audit's evidence,
resource measurements and limitations.

The audit additionally passes native batch/restart recovery, fresh Greylist
countdown/expiry, storage-abort recovery, repeated Journey/login cycles and
rendering-race regressions. Its ten disposable Firefox profiles and runtime copies
were removed after preserving evidence (about 1.27 GiB reclaimed). All 118 Core
and signed-release hashes match and 0.1.13–0.1.17 pass offline verification.

No Core source, authorization semantics, permissions or domain snapshot schema
changes. The existing extension ID remains `atlas-development@atlas.invalid`.
Signed 0.1.13-0.1.17 artifacts, normal profiles and enterprise policies remain
unchanged. Native evidence is Windows-only; native macOS behavior is unverified.

## Follow-up: idle authority interruptions

The [storage follow-up](firefox-storage-reliability.md) separately reproduces a
0.1.17 gap: one aborted readonly LOAD latches `STORAGE_UNAVAILABLE` and removes
healthy Whitelist pages. 0.1.18 permits one validated same-owner recovery for that
specific transient failure, preserving confirmations, timestamps and fail-closed
unknown/persistent outcomes. Fourteen additional regressions cover that path and
retained explanations, including a synthetic clock rollback.

Policy & recovery and Diagnostics retain the last authority interruption across
successful Recovery, with safe JSON export. The user's recovered 0.1.17 counters
showed zero failed commits and no visible storage issue; the original incident's
cause remains unknown. Clock checks and manual clock recovery are unchanged.

## Package and update

Unsigned candidate files belong in `extension/release/0.1.18/`:

- `addon/`: staged runtime for lint and isolated browser verification.
- `atlas-0.1.18-unsigned.zip`: runtime archive for Mozilla unlisted signing.
- `atlas-0.1.18-source.zip`: reproducible reviewer source and locked build tools.
- `release.json`: exact source/runtime/archive digests and release identity.

[Package evidence](evidence/firefox-release-0.1.18.json) records validation,
reviewer-source reproduction and staged-runtime results. These package checks
must complete before signing; the development checks above do not claim that an
unsigned archive has already been verified. The [release guide](firefox-private-release.md)
owns the preparation, signing and offline-verification commands.

A separate Mozilla-signed update is needed before the installed extension receives
these changes. After signing, verify the XPI offline, back up and update in place
under the same ID while retaining existing storage. Do not uninstall Atlas or reset
policy to get the new list. Never rebuild or overwrite an already signed version.
