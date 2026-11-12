# Atlas 0.2.0 — management workspaces

## Inventory and design boundary

The user authorizes a presentation/workflow redesign after the compass refinement.
The current uncommitted work is checkpointed in
`.tools/management-0.2.0/checkpoint.zip` (612 files), with per-file hashes. All 134
existing release files are frozen. Core, adapter commands, persisted schemas,
migrations, new-tab behavior and permission semantics are outside this task.

| Existing action/state | Owner and redesigned destination |
| --- | --- |
| Find/filter/inspect committed hosts | Existing Sites index, selection and saved list position; directory plus adjacent detail workspace. Narrow screens use a focused detail view and Back. |
| Name/category/pin edits | Existing editor and acknowledged display-save path; Display field group. No policy command for display-only changes. |
| Exact hosts, www choice, subdomain choice, classification | Existing editor validators and draft candidate; Access field group, with exact scope and precedence explanations. |
| Multiple prepared changes/raw incomplete fields | Existing persistent workspace, coalescing and CAS; compact summary during editing, explicit complete review view. |
| Strict Whitelist subtraction | Existing reviewed immediate-removal operation; review explains no cooldown. Mixed additions, Blacklist and timing changes retain Vault. |
| Draft save failure/conflict/staleness | Visible problem panel outside collapsed review; existing retry, load-newer, damaged-data discard and reconciliation actions. No automatic discard/retry. |
| Frozen submission/unknown outcome | Existing separate receipt and check-outcome action; unresolved receipt stays visible. No resubmission or confirmation replay. |
| Frozen policy/settings review | Dedicated Vault with before/after scope on the left, protection state/deadline and existing actions on the right. |
| Commit followed by display-save failure | Existing display-only retry/keep-current outcome controls; receipt cannot claim success before acknowledgement. |
| Protected timing configuration | Settings section navigation, existing seconds/hops fields and validation, active/proposed distinction; same review/submit handler. |
| Curated/managed/recovery/diagnostics | Dedicated Settings sections; all current controls and independent unavailable-state diagnostics retained. |
| Home pins | Same nodes, explicit order and entry points; balanced complete plaques and labelled additional-pin region. |

Before production wiring, local prototypes were rendered in isolated Firefox for
directory, detail, editing, nonempty review, failed save, waiting, ready and
Settings, plus a narrow editor. They use synthetic data and the existing local
font assets. The composition follows the supplied references while retaining
seconds as the current timing unit, the existing access filter, exact hostnames
and explicit scope warnings. No new category filter or conversion model is added.

Navigation choices are small presentation state, separate from persistent draft
contents and policy. Existing editable work survives switching views; opening a
review does not stage an editor or submit it. Only existing acknowledged commands
apply changes. One refresh owner, keyed rows, quiet setters, lazy favicon assets,
focus/caret and saved list scroll remain required.

## Implemented presentation

`assets/index.html` and `style.css` now compose the directory and selection/editor
side by side. At narrow widths, Back returns from the focused detail/editor to
the same filtered list. Display and Access have separate field groups. Existing
exact-host, explicit www and optional subdomain controls and warnings remain.
The category field still accepts existing suggestions or a new category.

The former leading draft panel is a compact companion below the workspace.
Review opens a dedicated current/proposed view with the existing submission,
display-save or Whitelist-removal action selected by the existing candidate
assessment. `destination-change-view.ts` projects the existing draft/receipt into
read-only tables; it neither constructs candidates nor stores permissions.
Subdomain and remaining-parent-scope warnings stay visible outside technical
disclosures. Receipt reconciliation, display retry and uncorrelated-intent
recovery retain their handlers. Failed/uncertain draft saves and shared-draft
conflicts appear above the workspace, independent of review disclosure.

`sites.ts` retains the persistent workspace and adds only `browse`, `detail` and
`review` presentation selection. Browser history stores that view and the selected
destination, alongside the existing Home category view. Existing session
navigation memory still owns filters/list position; the durable draft still owns
raw editor values and staged changes. Loading a saved workspace must not clear a
history-restored review before the asynchronous read completes. Deferred editor
focus yields to a subsequent field error or another interaction.

Vault is a dedicated page. Frozen changes use the same current/proposed table
renderer, beside the verified Core phase, original readiness/confirmation
deadline and existing confirm/cancel actions. Full raw review stays available.
Back to destinations remains available for empty/completed Vault as well as a
pending proposal. No extra approval step or combined confirmation is introduced.

`settings-navigation.ts` selects the existing Timing, Curated, Managed blocking,
Recovery and Diagnostics nodes. Its selection is browser history, not a saved
preference or authorization input. Unsaved timing values survive section changes;
active values and edited-value count remain explicit. Units remain seconds/hops
and retain their existing validation. Diagnostics uses its existing independent
request even when the main view request fails, within the same refresh owner.

Home keeps its compass/category composition. Complete cream plaques are balanced
about the compass; pins after the first six appear under **More pinned
destinations**. The same keyed launcher nodes, explicit order, variant and pin
actions are retained, including when a node moves between those two groups.
No additional subscriptions, polling loops, remote assets or dependencies were
introduced. Previously bundled local fonts and website favicon behavior remain.

## Verification and limits

The build includes both TypeScript compilers and generated development assets.
Core: 247 passing tests. Extension: 536 passing tests, including seven focused
management regressions for navigation without writes, asynchronous review
restoration, acknowledged-save focus, failed/uncertain save presentation, Settings
selection and exact scope comparison. Existing editor, removal, subdomain, batch, storage, conflict
and unknown-outcome assertions remain. Native fixtures accept the old and new
acknowledged-save wording so preserved baseline runs remain meaningful.

Native checks use synthetic data and isolated Firefox 159 profiles. The capability
inventory above maps every existing action to the redesigned surface. Screenshots
and native results are retained with this report; prototypes were rendered before
production wiring. Browser evidence is separate from mocked/unit evidence.
The [verification record](evidence/management-ux-0.2.0.json) indexes the results,
checkpoint hash, measurements and protected-file checks.

| Native fixture | Verified behavior |
| --- | --- |
| Management workspace | Adjacent directory/editor, display-only save, two-item review, failed transaction/retry, unfinished editor through Back/Forward/reload, one actual Vault wait and explicit confirmation, original deadline display, Settings edit retention, keyboard order. |
| Destination batch | Mixed seven-change batch, three full Firefox restarts, frozen proposal/replay rejection, post-commit display-only retry, stale reconciliation, two-page CAS conflict and uncertain submission recovery. |
| Home organization | Category migration/order/visibility/collapse, restart, 15/30-category growth, two-page conflict, exact search, retained pins, list scroll and save/close/Vault focus, existing Greylist/Journey links and unavailable states. |
| Productization | Actual site icons, gated search, old-term timing review/confirmation, schema migration, fixed pending terms and restart. |
| Visual and quality | 1586 × 992 reference captures; narrow layouts and real 125/150/200% zoom; 14 ordered pins without overlap; 30 categories and 296 destinations; missing-icon fallback and independent diagnostics while GET_VIEW fails; idle stability and matched timings. |

The runs found and corrected presentation defects: asynchronous draft loading
could clear a history-restored review, completed display saves could leave focus
on a vanished review heading, and the new section navigation needed diagnostics
refresh even when GET_VIEW failed. These corrections do not alter commit or
authorization behavior. The baseline fixture also now explicitly opens a category
before asserting category restoration after reload; current assertions remain.

Screenshots were inspected and iterated in the actual browser at the reference
viewport. The directory/editor is adjacent rather than below a large draft panel;
the review reserves a separate action column; Vault separates changes from its
protection state; Settings shows one section at a time. Narrow views retain Back
and the filtered selection. Focused, error, empty/completed and populated states
are included. The native Firefox window minimum was 500 pixels at 100% zoom;
200% zoom additionally exercised 250 CSS-pixel layouts. This is not a claim of a
360-pixel native outer window.

- [Directory](evidence/management-ux-0.2.0/directory.png),
  [editor](evidence/management-ux-0.2.0/edit.png),
  [narrow editor](evidence/management-ux-0.2.0/narrow-edit.png).
- [Complete review](evidence/management-ux-0.2.0/review.png),
  [visible save failure](evidence/management-ux-0.2.0/save-failure.png).
- [Vault waiting](evidence/management-ux-0.2.0/vault-waiting.png),
  [ready](evidence/management-ux-0.2.0/vault-ready.png),
  [completed](evidence/management-ux-0.2.0/vault-completed.png).
- [Edited Settings](evidence/management-ux-0.2.0/settings-edited.png),
  [unavailable-state diagnostics](evidence/management-ux-0.2.0/visual-diagnostics.png).
- [Home](evidence/management-ux-0.2.0/visual-home.png),
  [category workspace](evidence/management-ux-0.2.0/visual-category.png),
  [additional pins](evidence/management-ux-0.2.0/visual-home-more-pins.png).

For comparison, the preserved checkpoint renders the earlier
[directory](evidence/management-ux-0.2.0/before-directory.png),
[Settings](evidence/management-ux-0.2.0/before-settings.png) and
[Vault](evidence/management-ux-0.2.0/before-vault.png).

The matched six-pin Home → Directory → Home check (12 samples, next animation
frame) recorded a 9 ms median in both the checkpoint and redesigned UI. Both
five-second idle observations recorded zero localStorage writes, zero pin DOM
mutations and stable first-pin node identity. This short UI check is separate
from IndexedDB transaction counters and does not establish long-session behavior.

The ordinary Core-gated navigation comparison used 15 samples per history size.
Median time was 125 → 125 ms with no history, and 484 → 547 ms with 2,500 history
entries. The latter sample is slower; the small runs and broad sample spread do
not establish the cause or a latency improvement. The background bundle is
identical. These are synthetic navigation measurements, not long-running
reliability evidence, and no performance optimization is claimed in this pass.

The reference remains a composition guide: the production UI retains its existing
access filter, seconds-based fields and complete scope warnings. New category
filters, timing-unit conversion and invented sample policy states are not added.
Long reviews scroll; narrow screens stack the review/protection regions. This is
not a complete screen-reader conformance audit. Non-Windows rendering and live
favicon availability were not verified. Historical intermittent INTERNAL_ERROR
remains unresolved and is unrelated to this presentation pass.

Core, adapter commands, storage schemas/migrations, package version, extension
identity and permissions are unchanged relative to the checkpoint. The background
bundle is byte-identical. All 134 protected release files retain their hashes.
No everyday profile, enterprise policy, signing, submission, deployment, commit
or push is involved.

After retaining sanitized evidence, this task's 18 native regression profiles,
prototype profile and redundant comparison copies were removed (about 2.36 GiB).
The recoverable checkpoint ZIP, its manifest, prototypes and logs remain in
`.tools/management-0.2.0`; no unrelated tooling or sessions were deleted.
