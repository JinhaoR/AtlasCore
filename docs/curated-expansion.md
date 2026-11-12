# Curated research and everyday infrastructure expansion

**Current subdomain update:** [Bundled site scopes](curated-subdomains.md) now
add descendant coverage through a separate one-time receipt. The fixed exact-host
catalogs and v2/v3 receipts described below remain unchanged. Existing custom rules
are preserved and removed bundled roots are not reintroduced by the scope update.

**0.1.19 compatibility update:** The original 0.1.18 v2 migration below is
frozen at 298 hosts. Current defaults omit four Wikipedia hosts (294/122
services), without removing saved user rules. Valid v2 receipts prevent any
reapplication; only fresh or unmigrated installations use corrected v3 terms.
The [current contract](whitelist-scopes.md#defaults-and-forward-compatibility)
explains receipt compatibility and retained legacy display identities. The
measurements below describe the signed 0.1.18 implementation, not current totals.

Authorized on 2026-10-29. The user explicitly approves a generous static preset
for fresh and existing installations, including previously default-Greylist sites.
Their subsequent clarification applies this release migration to **all** installs,
without installation identifiers. It supersedes the earlier declined exception
and the proposed per-install scope. No new permission system or Greylist model is
introduced. Exact host matching and the existing runtime workflows remain Core-owned.

## Catalog

Each service occurs once, with named exact aliases and distinct destinations.
University physics/mathematics departments and public teaching archives are
explicit destinations, not wildcard permissions or authentication dependencies.
The corrected catalog contains **298 exact hosts across 123 services**: 49 of
the historical 51 defaults plus the same 249 new hosts. Before release, the user
removed `youtube.com` and `www.youtube.com` from the preset and this same pending
migration. Every other catalog hostname is unchanged. Existing saved YouTube
permissions are preserved; making an already-saved host Greylist requires its
ordinary protected removal. No second migration is introduced.
The catalog includes the approved
research, university, cloud, productivity, communication, development and utility
bundle. Host evidence and the complete catalog belong in the accompanying evidence
record; an HTTP response alone is not proof of authenticated browser compatibility.
David Tong's notes, KITP/PIRSA lectures, Oxford numerical analysis and ETH teaching
pages receive explicit coverage. Authentication remains a bounded Journey; shared
identity-provider hosts are not permanent destinations. Tenant-specific work/school
storage and unfamiliar SSO behavior still require their exact destinations or
existing supported continuation evidence.

## One-time migration

The fixed `research-infrastructure-2026-10-v2` migration is compiled into the
adapter. Startup runs it before creating the Core controller. It validates the
complete current envelope/snapshot and atomically writes the **union** of existing
Whitelist entries and approved preset entries, a new storage version, and a
receipt under a separate key in the existing authority store. It never replaces
the Whitelist with the preset. Every existing custom entry survives. Candidates
on the saved manual Blacklist are skipped without modifying either existing list.
Checks remain exact: a blocked hostname does not implicitly block every other
alias, service entry point or subdomain. Each proposed hostname is checked separately.
Managed-denied candidates are also skipped, without creating new managed-list
exceptions. No policy removals, configuration changes or presentation changes occur.

**An entry previously removed from Whitelist can return in this migration unless
it is Blacklisted.** The user expressly accepts this because historical Greylist
intent is not stored. There is no automatic reapplication: a successfully saved
receipt prevents subsequent startups or versions of this same migration from
restoring a later removal. A future expansion needs a different reviewed source
change and migration ID. No web/UI command supplies migration contents.

If additions change policy, advance `policyRevision` once. Keep original access,
Vault and Journey records, IDs, deadlines and configuration intact. Under existing
Core rules, older requests/grants/proposals become stale and Journeys end on
observation. Never rebase, renew, confirm or recreate these workflows. Editable
destination drafts remain saved and use existing explicit reconciliation.

Fresh automatic initialization writes the preset and its receipt atomically at
revision zero. Healthy already-initialized empty policies receive this explicitly
approved one-time expansion. Missing/corrupt authority or invalid receipts never
trigger defaults. Write failure rolls back both policy and receipt and blocks
startup; explicit Recovery can retry construction. Concurrent connections serialize
through one strict transaction and reread current authority. Ordinary Core commits
preserve the independent receipt and retain their existing CAS/receipt protocol.

The receipt records added, already-present and skipped exact hostnames and policy
revisions. Private diagnostics exposes this result through the existing export;
it carries no permission. Actual installed results are known only after update.

## Release boundaries and verification

Keep signed 0.1.13-0.1.17 artifacts frozen. Development advances to 0.1.18; no
signing, submission, deployment, enterprise-policy edit or normal-profile write is
authorized by this task. Use fake time/IndexedDB to exercise migration atomicity,
failure/retry, concurrent connections, restart/idempotence, Blacklist precedence,
retained custom hosts/configuration, no duplicate additions, corrupt state and
existing Core revision invalidation. Use isolated native Firefox for an upgrade
from the preserved runtime and subsequent restart, with synthetic authority.
Final evidence distinguishes these checks from live authenticated account testing.

Verified: **204 Core and 416 extension tests**, both TypeScript checks and the
development build. Isolated Firefox **159.0** passes the real 0.1.17 upgrade and
two full process restarts; the corrected fixture records 248 added, 49 already-present and
one manually Blacklisted skipped hostname, preserving two extra custom hosts,
pins and changed timing. Fresh-install verification saves all 298 hosts and checks
real Greylist waiting/confirmation, fixed grant deadlines, background reload,
failure presentation, small-window layout and expiry without renewal.

[Implementation evidence](evidence/curated-expansion-2026-10.json) records exact
results and preserved release/Core hashes. [The catalog](curated-destinations.md)
lists every hostname. Public probes received HTTP responses from 275 of 298 hosts;
the remaining TLS/network failures and separate official teaching references are
kept in [host evidence](evidence/curated-hosts-2026-10.json). HTTP responses include
automated-request blocks and do not establish login or full-page usability.
Native macOS and authenticated account flows remain unverified.
