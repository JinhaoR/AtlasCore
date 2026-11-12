# Atlas Firefox 0.1.19 development notes

For final packaging, see the [0.1.19 release candidate](release-candidate-0.1.19.md). The following notes retain development history; earlier no-packaging statements describe those earlier passes.

The [final quality pass](quality-pass-0.1.19.md) reduces repeated validated-snapshot
processing, retains bounded sanitized fault evidence across background restarts,
and simplifies Sites editing/review density. Form, launcher/icon and diagnostics
ownership are separated from the page coordinators. Authority validation,
confirmation, persistence and history retention remain intact. The original
intermittent INTERNAL_ERROR trigger is still unconfirmed; no automatic recovery
for unexplained faults is added. These remain development changes, not a release.

The [focused runtime investigation](firefox-storage-reliability.md#focused-0119-reliability-investigation-2026-10-30)
adds bounded, sanitized own-bundle fault locations and independent adapter,
background-error and unhandled-rejection reporting. Export also includes queue
progress and background start time, allowing pending storage to be distinguished
from a caught controller fault. No unexplained INTERNAL_ERROR is automatically
recovered; the real intermittent trigger is still unconfirmed. The investigation
does not change authorization, state schemas or release/deployment boundaries.

The [engineering review](engineering-review-0.1.19.md) additionally removes
redundant expired-history access assessments and unused empty-workspace baseline
construction, corrects unavailable Home copy and documents tiered verification.
Core runtime rules and signed artifacts remain unchanged. This is development
work, not new release preparation or a fix claim for the unknown idle exception.

The user-authorized [Whitelist-removal change](whitelist-removal.md) makes strict
exact-host and scope-root subtractions immediate after batch review. Additions,
mixed batches, Blacklist and settings changes still use Vault. The narrow Core
command revalidates complete policy and base revision, commits atomically and
never fabricates a proposal marker. Pending proposals become stale rather than
restoring removed access. Failure/uncertainty and display recovery remain guarded.
Current verification passes **239 Core / 507 extension tests**, both typechecks
and build, with native immediate/mixed-batch and scope-removal tests. The older
counts below describe their separately recorded earlier development checks.

The 2026-10-30 [idle INTERNAL_ERROR follow-up](firefox-storage-reliability.md)
adds closed controller fault diagnostics (operation, stage, error class and state
counts), retained across explicit Recovery and exported through Diagnostics.
It preserves conservative failure/unknown-outcome handling. The actual reported
exception is still unidentified; this is observability, not a claimed trigger
fix. That diagnostic follow-up verified **229 Core / 490 extension tests** with both
typechecks/build and native paired idle-fault verification. Earlier editor
benchmark counts below describe that separately preserved evidence.

This development update addresses destination editing and review reliability,
continued editor/load slowdown investigation, and the explicitly requested
optional Whitelist subdomain scope. Signed **0.1.18** and earlier releases remain
frozen under the existing ID `atlas-development@atlas.invalid`. This task does not
prepare, sign, submit or deploy a new release or alter the installed Firefox profile.

## Destination editor and performance

An untouched saved Add editor could block editing another destination or reviewing
staged changes, including after reload. Recovery must distinguish an untouched
editor from entered work: preserve changed fields, durable drafts, conflicts and
failed-save feedback. The completed-batch case is part of the performance audit;
the earlier 0.1.18 benchmark covered a large editable batch without a retained
completed receipt. Measured causes and verification belong in the
[editor reliability report](editor-reliability-0.1.19.md). This note does not claim
an unmeasured loading problem or long-term leak is fixed.

## Optional parent and subdomain permission

[The scope contract](whitelist-scopes.md) adds optional
`Policy.whitelistSubdomains` roots. Ordinary exact-host entries remain exact,
the option is off by default, and no existing policy or preset gains it
automatically. A selected root covers itself and every current or future DNS-label
descendant at any depth. The interface discloses that broad consequence and rejects
bare public/hosting suffixes using the existing PSL library.

Scope additions use the normal Vault wait, frozen review, explicit confirmation
and atomic commit; strict scope removals now apply after review without waiting.
Manual Blacklist still wins; broad scope matches do not override
the managed list. Existing explicitly listed exact hostnames retain their normal
managed-list exception. Scope metadata is not a temporary grant or a new Journey
trust model. Legacy policies without the optional field remain compatible.

Home indexes the declared base without inventing child cards. Child navigation,
login Journeys and downloads remain subject to current Core decisions, browser
correlation and their original context/deadline boundaries. Editing, searching,
pinning or previewing never authorizes access by itself.

## Wikipedia and existing installations

The initial preset now contains **294 exact hostnames across 122 services**.
Only the four Wikipedia hosts are removed relative to the signed 0.1.18 preset;
every other host is unchanged. YouTube remains outside the preset. Existing saved
Wikipedia permissions, custom Whitelist entries, manual Blacklist rules, settings,
pins and drafts are preserved. Removing an existing Wikipedia rule still requires
the ordinary protected change.

The signed v2 migration's 298 terms are frozen. Valid v2 receipts are accepted
without rerunning the expansion or reintroducing later removals. Fresh or still
unmigrated installations use the new v3 target set, omitting Wikipedia. No
automatic subdomain scopes or second expansion is applied to an existing v2 user.
Retained Wikipedia presentation metadata keeps old service IDs and frozen draft
receipts readable without supplying permission.

## Verification and boundaries

Focused regressions cover legacy v2 receipts and removals, fresh v3 defaults,
failure/concurrency invariants, saved Wikipedia presentation identity, optional
scope indexing, PSL selection, policy precedence, current-policy Journey checks,
aliases and existing exact exceptions. The complete Core suite passes **222**
tests and the complete extension suite passes **486** tests. Core and extension
TypeScript checks and the development build pass.

Isolated native Firefox **159.0** upgrade checks pass in disposable profiles:

- Signed 0.1.17 to development 0.1.19: v3 adds 244 terms, recognizes 49 existing
  terms and skips manually Blacklisted `figma.com`. Wikipedia is not added.
  Custom hosts, Blacklist, protected settings, pins and pending timestamps remain;
  old confirmations fail under normal revision rules. A later Zotero removal
  survives restart. Two complete Firefox process restarts are tested.
- Signed 0.1.18 to development 0.1.19: the original v2 receipt is retained without
  a new marker, policy change or revision increment. Wikipedia and Zotero removals
  stay removed. Custom policy, settings, UI-saved pins and metadata remain.
  A genuine 0.1.18 saved draft and completed Wikipedia display receipt decode;
  the stale draft cannot submit. Two complete process restarts are tested.
- Optional scopes use two real Vault confirmations and survive a background
  reload; the storage reliability fixture's twelve checks also pass. These are
  synthetic fixtures, not evidence for every external authentication provider.

The owning report records performance measurements, full evidence and remaining
limits. No unsigned release package, signing or deployment is performed by these
checks.

The user's earlier recovered idle interruption remains unidentified. 0.1.18's
bounded storage recovery and retained authority diagnostics remain included.
Clock rollback protection, cooldowns, confirmation, uncertain-outcome handling and
conservative damaged-state behavior are preserved. No new dependencies, wildcard
hostname strings, learned relationships or supporting-domain database are added.
