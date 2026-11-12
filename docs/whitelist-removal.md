# Immediate Whitelist removals

Authorized on 2026-10-30 for development 0.1.19. Removing an existing permanent
Whitelist term must not require waiting. Adding access remains protected by Vault.
This explicitly narrows the earlier rule that every policy change needs a wait.

## Core boundary

`isWhitelistRemoval(current, candidate)` validates both complete policies and
recognizes only a strict subtraction of existing exact Whitelist terms and/or
existing subdomain roots. Blacklist membership must be identical. No new exact
term, replacement scope root, Blacklist change or timing change qualifies.
Even an exact exception already covered by a broader scope counts as an addition
and keeps Vault, because it could override managed blocking.

The trusted adapter uses `REMOVE_WHITELIST` with the complete candidate policy and
its base policy revision. Core revalidates eligibility against loaded authority;
the UI helper chooses a workflow but grants no permission. Invalid, stale,
expanding, mixed or no-op candidates are rejected. The ordinary controller
serializes and atomically commits the complete snapshot before reporting success.
The reference ID is the new policy revision, not a Vault proposal ID.

Successful removal increments policy revision once, preserves settings/Blacklist,
and observes the existing revision invalidation rules for requests, grants and
Journeys. Records and deadlines are not renewed. Existing pending Vault proposals
remain frozen; their old revision becomes stale rather than silently restoring
removed access. No proposal counter or commit marker is fabricated or consumed.
`PROPOSE_POLICY` keeps its existing frozen-proposal contract for callers using it.

## Firefox workflow

Stage the desired edits and Review the batch as usual. A removal-only batch offers
**Apply Whitelist removals now** and explains that it has no cooldown. Display
changes may accompany it. A batch with additions or Blacklist changes uses the
existing single Vault wait; Atlas never silently splits a reviewed batch.
Removing an exact host does not remove an independent parent scope that still
covers it. Review discloses remaining policy coverage.

The separate durable workspace stores a `REMOVAL` receipt before sending the
command. It uses the complete candidate, base revision and configuration revision
to recognize the desired committed state, not a fabricated proposal ID. It may
acknowledge that those exact terms are now active without claiming which writer
applied them. Unknown outcomes require verified recovery; commands are never
automatically replayed. A different/stale result restores an editable draft for
explicit review. Presentation failures retry display/pins only, never policy.

Legacy drafts and POLICY/DISPLAY receipts remain valid. Already-frozen Vault
proposals keep their original terms; they are not automatically converted into
immediate commits. Existing website-origin privilege restrictions remain.

No package, signing, deployment, enterprise policy or normal-profile change is
authorized. Signed 0.1.13-0.1.18 release artifacts remain frozen.

## Verification

**239 Core and 505 extension tests pass**, with both TypeScript checks and the
actual extension build/test command. Core tests cover strict subset eligibility,
managed exceptions, invalid/stale/mixed input, atomic publication, failed/conflict/
unknown commits, replay/concurrency, pending proposals, original grant/request
terms, Journey invalidation, empty-policy restart and revision exhaustion.
UI tests cover real batch selection, delayed/failed acknowledgement, draft/display
failure and explicit recovery, concurrent changes, remaining scope disclosure,
forged receipts and untrusted website commands.

Native Firefox **159.0** applies a reviewed custom-host/GitHub-alias removal in
406 ms against a configured 30,000 ms Vault wait, removes the retained page, then
survives a full Firefox restart without curated re-addition. A mixed restore/remove
batch rejects early confirmation, waits the real configured cooldown and commits
only after the existing explicit confirmation. A second full restart retains its
normal receipt. The scope fixture also verifies one protected scope addition,
restart and immediate scope removal, preserving manual denial and exact base access.

Commands:

```text
python extension/scripts/firefox-e2e.py --whitelist-removal-only
python extension/scripts/firefox-e2e.py --subdomain-scope-only
```

[Sanitized evidence](evidence/whitelist-removal-0.1.19.json) records the results
and frozen release integrity. These Windows/synthetic fixtures do not claim new
real-account or native macOS coverage. No release preparation or installation is
performed.
