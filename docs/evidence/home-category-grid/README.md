# Home category grid verification — 2026-11-10

Development-only simplification of Home. The owning behavior and persistence
contract is [Home organization](../../home-organization.md). The pre-change
checkpoint is retained locally at `.tools/home-category-grid/checkpoint.zip`.

## Results

- Development build and both TypeScript checks passed: [build log](build.log).
- Complete extension regression suite: **607 passed**, none skipped or failed
  ([log](extension-tests.log)).
- Complete Core regression suite: **249 passed**, none skipped or failed
  ([log](core-tests.log)). No Core source changes.
- Native Firefox **159.0.1**, disposable synthetic profiles, signed 0.2.3 baseline
  with a temporary development overlay: category-grid and Everyday scenarios
  passed ([category results](result.json), [Everyday results](everyday.json)).
- All **278** pre-existing release files retain their hashes. Core, adapter,
  background, bookmark synchronization owner, authority repository, manifest,
  version and dependencies match the checkpoint ([integrity](integrity.json)).
  [Changed-file inventory](changes.json) excludes this evidence directory.

The focused native scenario verified pointer drag and keyboard reordering,
Escape/outside-release cancellation, no accidental category opening after drag,
focus, category disclosure, Back/Forward and reload. It also verified an injected
IndexedDB icon-save failure with retained draft and successful retry, propagation
between two control pages, and preservation of order, icons and pins across a
full Firefox restart. Thirty synthetic categories scroll within the panel.

The existing Everyday native scenario additionally checked bookmark connection
and bidirectional edits, preservation of a dirty editor during native events,
restart/reconnection, exact URL launches and Blacklist denial, waiting/ready/
confirmation/grant expiry, and unavailable-authority behavior. There were no
policy or settings changes from category presentation operations.

Unit tests cover malformed/oversized icon records, local-only icon choices,
independent revisions, conflict reconciliation, failed and uncertain writes,
automatic-icon reset, hidden/empty category slots and unchanged refreshes.
Conflicting simultaneous writes were tested at the repository/session boundary;
the native two-page check tested propagation of acknowledged changes.

## Screenshots and responsive checks

- [Resting Home](home-grid.png)
- [Open category](category-open.png)
- [Settings: Home & categories](category-settings.png)
- [Thirty-category fixture](thirty-categories.png)
- [2538-pixel window](grid-2538-1.png)
- [1488-pixel window at 200% zoom](grid-1488-2.png)
- [500-pixel window at 200% zoom](grid-500-2.png)
- [Active temporary access](access-active.png)
- [Unavailable authority](unavailable.png)

Window widths 500, 1200, 1488 and 2538 pixels and Firefox zoom 125%, 150% and
200% were exercised. No horizontal document overflow was observed. At narrow
sizes/high zoom the document scrolls rather than clipping controls. Synthetic
category fixtures replace metadata IDs, so their empty-pin prompt is expected;
the real-category fixture and restart check retain the original pins.

## Interaction and performance observations

Firefox's native HTML drag-and-drop experiment did not reliably deliver its
drop completion in the isolated test. It was replaced with a small pointer-
capture implementation: threshold, hit-tested destination, explicit cancellation
and click suppression. Native pointer checks then passed. Alt + arrow keys and
Settings Up/Down controls provide alternatives; no drag library was added.

A five-second idle category-grid observation produced **zero mutations, zero
additional resource requests and retained button identity**. The Everyday idle
sample likewise found zero node replacements, attribute changes or new resource
requests, with one maximum concurrent view request under the existing refresh
owner. UI navigation samples were 11–27 ms. These observations establish no
visible idle churn in these fixtures; they do not establish a general speedup.

Physical touch/trackpad dragging and screen-reader behavior were not verified.
Headless Firefox could not verify the physical toolbar click or popup keyboard
activation; those are existing harness limitations. Reverting the temporary
overlay to signed 0.2.3 can revoke its newer optional bookmarks permission;
both copies remained intact and explicit reconnection succeeded.

## Boundaries and cleanup

No signing, packaging, installation into the everyday profile, deployment,
enterprise-policy modification, version bump or commit occurred. Existing
release artifacts are unchanged. The historical `INTERNAL_ERROR` remains
unresolved and outside this presentation change.

After preserving these results, only this task's five identified disposable
Firefox profile/runtime directories were removed. The checkpoint and local
test logs remain under `.tools/home-category-grid`.
