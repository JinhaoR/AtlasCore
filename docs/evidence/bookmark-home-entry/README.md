# Direct Firefox bookmark connection — 2026-11-10

Home's Pinned heading now offers **Firefox bookmarks**, opening the existing
connection flow. The Atlas-specific pin/page editor remains in **Settings →
Home & categories → Advanced pin editing** and in individual grouped-pin
secondary actions. Existing saved pages remain usable. This changes entry points
and explanatory copy only; the synchronization owner and storage are unchanged.

After optional permission, users choose/create a folder and approve the existing
merge preview. Subsequent supported edits can be made in Firefox. The connection
does not automatically import every bookmark or change site permissions.

## Verification

- Development build and both TypeScript checks passed.
- 88 focused bookmark sync, named-page, Home organization and management
  navigation tests passed, with no skips or failures.
- Native Firefox 159.0.1 in a disposable profile: Home's new action opened the
  connection by keyboard; Escape closed it and restored focus. Permission and
  preview/connection succeeded, native edits reached Atlas, Atlas edits reached
  Firefox, and concurrent native edits retained the dirty advanced-editor draft.
- Full restart preserved the bookmark copies and other saved state. The existing
  temporary-overlay limitation was reproduced: rollback to signed 0.2.3, which
  lacks the optional bookmarks permission, required explicit reconnection.
- Existing exact-URL launch, Blacklist, Greylist wait/confirmation/expiry and
  unavailable-authority checks passed. Native window/zoom checks passed.
- Core, adapter/background, synchronization owner, authority storage, manifest,
  dependencies and all 278 existing release files match the task checkpoint.

[Native result](result.json), [integrity comparison](integrity.json),
[Home](home.png), [connection preview](connection.png).

The existing headless harness cannot verify physical toolbar-click or popup
keyboard activation. Those are separate from the control-page keyboard action
verified here. Idle observations recorded no node replacement or new resource
requests, but this task makes no new performance claim.

The local checkpoint and test logs remain in `.tools/bookmark-entry`. After
preserving these results, the task's single disposable Firefox profile/runtime
directory was removed. No release was packaged, signed, installed or deployed;
the everyday profile and enterprise policies were untouched.
