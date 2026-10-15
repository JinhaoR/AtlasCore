# Milestone A: UI reliability and correctness

The later [UI stability pass](ui-stability.md) preserves these publication and
failure rules while removing repeated loading cycles for unchanged acknowledged
presentation. Explicit display retries await fresh authority; countdowns never
confirm or extend permission.

Implemented on 2026-10-11 for the next development build. The manifest/package
version remains 0.1.13; the frozen signed 0.1.13 release remains separate and unchanged.
This document records the focused repairs from audit F03, F06, F07 and F09.
Batch drafts, category organization and visual redesign remain outside this milestone.

## Changes and confirmed causes

| Finding | Confirmed cause | Repair and owning files |
| --- | --- | --- |
| F03: failed display save appeared successful | `sites.ts` assigned preferences before `localStorage.setItem`, then closed the editor and applied pins regardless of the result. Commit reconciliation also ignored failed metadata writes. | `sites.ts` publishes persisted values only after acknowledgment; `presentation-storage.ts` distinguishes saved, failed and uncertain outcomes. Failed edits retain fields and an explicit retry. Metadata and pins report their separate outcomes. |
| F06: exact search opened a different host | Search returned service entries, but click and Enter always used `entry.hostname`, losing the matched Office entry point or alias. | `destinations.ts` returns a display result with an explicit target hostname and match kind. `main.ts` uses that host for both click and Enter. An exact known hostname takes precedence over similar names. Ambiguous partial host matches are separate choices with visible addresses. Complete unknown addresses yield no substituted destination. |
| F07: unavailable looked empty | A failed poll set `view = null`; Home derived an empty index and displayed empty/pin guidance. Sites did the same when no snapshot was present. | `data-view.ts`, `main.ts`, `sites.ts` and HTML distinguish loading, ready, verified empty and unavailable. Last-verified data may remain visibly stale; unavailable collections do not show empty messages. Home and Sites link to recovery, and Home also offers a read-only retry. |
| F09: acknowledgments were unclear | One feedback string combined raw reason codes, cleared proposal successes, and used alert semantics for everything. Installed-user startup copy referenced development loading. | `feedback.ts` maps command/results to plain copy and status/error/uncertain tones. Proposal saved is distinct from policy committed. Sites explains the pending Vault lock and links to review. Technical identifiers appear in diagnostics; installed-user guidance recommends recovery or a verified signed update. |

All openings, including search, still send `OPEN_DESTINATION` to the Firefox adapter
and use the ordinary Core gate. Search and cached display data supply no authority.
Exact-host policy semantics and service alias declarations are unchanged.
The existing extension Public Suffix List distinguishes complete public addresses
from partial queries such as `www.github`; it supplies no matching or permission rules to Core.

## Presentation persistence and recovery

Ordinary name/category edits retain the existing `atlas-destinations-v1` schema.
Pins retain `atlas-home-pins-v1`. A synchronous successful write acknowledges saved
presentation. If a write throws, readback distinguishes an already-saved exact
value, unchanged storage (failure), and an unreadable/different outcome (uncertain).
Unverified values are not published as saved. Retry is explicit and idempotent for
presentation; it never invokes a protected confirmation or silently repeats policy.

A mixed edit first receives acknowledgment of the saved Core proposal. Its
associated display envelope retains proposal ID, base revision, candidate policy,
name/category/scope and requested pin. These fields remain presentation metadata.
Only a current verified matching Core commit permits their activation. Existing
cancellation/staleness matching remains in `destination-metadata.ts`.

After a matching commit, save active display metadata while retaining the envelope,
save the pin, then clear the envelope. A failed stage stops automatic attempts for
that page and exposes **Retry display save**. An envelope that was already saved
survives reload and permits recovery with the same proposal. Another page's storage
event cannot strand the local retry or silently replace another saved proposal's
display envelope. Core policy is never rolled back through presentation recovery.

If the initial envelope write fails, the frozen display terms and entered fields
remain in that page only. Copy explicitly asks the user to keep it open for retry.
The saved Core proposal remains reviewable independently. If it is committed
elsewhere, copy changes to **Policy committed and is active**; retry still saves
only display data. Failed metadata does not erase an acknowledged policy commit.

## Small adjacent fixes

- Starting another editor does not overwrite an open failed draft. Discard remains
  explicit; this is a single page-local draft, with no batch or persistent draft model.
- Duplicate protected submissions are guarded while awaiting the response. Fields
  remain frozen during submission and while retrying a saved proposal's display terms.
- Successful ordinary display save returns focus to destination details. Background
  reconciliation does not close another local draft or steal its focus.
- Automatic navigation to Vault retains the proposal acknowledgment. Explicit manual
  navigation clears stale global feedback. Polls do not erase operation feedback.
- Sites retains its local save context when revisited, while identical global/local
  feedback is shown once. Routine pin saves also receive a polite acknowledgment.
- Failed settings proposals retain the existing fields and do not navigate to an empty
  Vault review. An unavailable Vault shows unverified status rather than claiming no proposal.
- Existing parchment, serif headings, olive accents, compact cards and rail are retained.
  Only status/success feedback gains the existing olive treatment; errors keep their alert tone.

## Validation

Automated regression coverage lives in `extension/tests/ui-reliability.test.mjs`.
It uses the real Sites handlers with a small DOM fixture, fake storage, fake time,
the real Core/controller and the mocked Firefox adapter. Native full DOM coverage
is in `extension/scripts/firefox_ui_reliability.py` through `firefox-e2e.py`.
Final results and sanitized browser evidence are linked from the
[acceptance scenarios](acceptance-tests.md#ui-reliability-evidence-milestone-a).
Final totals: **191 Core / 245 extension tests pass**, including 19 new regressions.
Both typechecks, the development build, bundle verification and offline signed-release
verification pass. All four native suites pass on Firefox 157.0.1 in disposable profiles.

Commands from the repository root:

```powershell
npm.cmd --prefix packages/core run typecheck
npm.cmd --prefix packages/core test
npm.cmd --prefix extension run typecheck
npm.cmd --prefix extension test
python extension/scripts/firefox-e2e.py --ui-reliability-only
python extension/scripts/firefox-e2e.py --coherence-only
python extension/scripts/firefox-e2e.py --destination-polish-only
python extension/scripts/firefox-e2e.py --productization-only
npm.cmd --prefix extension run release:verify-signed -- 0.1.13
```

No Core source, repository schema, migration, timing rule, authorization operation,
dependency, manifest version or identity changes are part of this milestone.
The normal Firefox profile, enterprise policy files and installed XPI are untouched.
Tests use isolated profiles; no Mozilla signing or submission is performed.

## Limits and Milestone B handover

Milestone B now implements the persistent destination draft and batch receipt
design in [destination-polish.md](destination-polish.md#milestone-b-destination-batch-drafts).
The limits below describe Milestone A's original single-edit implementation.
Its acknowledgment, search, unavailable-state and feedback regressions remain
active, adapted to the explicit stage/review/submit workflow.

Unsaved fields survive failure within the page; reload restores saved display data.
Persisting a draft that could not be written is impossible during storage failure.
Milestone B separates editable terms, frozen proposal metadata, acknowledged Core
authority and remaining display writes. Partial-success recovery never proposes
or confirms policy again.

Metadata and pins are separate writes, explicitly reported as such. This milestone
does not make presentation an atomic transaction with IndexedDB policy. Cross-page
storage events synchronize saved presentation. Milestone B adds transactional
version checks for shared editable drafts and explicit stale-baseline reconciliation;
see [its contract](destination-polish.md#milestone-b-destination-batch-drafts).
Physical disk failure, full screen-reader coverage,
and authenticated remote website success are not established by these UI tests.
