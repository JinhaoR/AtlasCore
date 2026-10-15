# UI stability and rendering

This development pass preserves signed 0.1.15, Core semantics, storage schemas,
identity and installed Firefox configuration. It changes extension presentation.
The interface still uses native DOM controls and the existing A–D workflows.

## Confirmed causes

The native harness freezes the pre-fix `extension/dist` outside release directories,
then runs the same synthetic fixtures against both builds in disposable Firefox
profiles. Five foreground idle windows each last 60 seconds. Mutation traces and
repeated screenshots distinguish countdown changes from structural churn.

| Trigger | State/render path | Effect and correction |
| --- | --- | --- |
| Every accepted `GET_VIEW` poll | `HomeLayoutSession.refresh()` marked every read busy and notified at its start/end. `home-organization.ts` disabled controls and announced loading. | A read of identical acknowledged layout drove two extra page renders and a visible loading/save cycle. Background reads are now coalesced and silent unless validated values or failure state change. Initial load and actual writes still announce progress. Clicks await an in-flight read; CAS, failed drafts and conflict recovery remain intact. |
| Every `render()` | `main.ts`, `sites.ts`, `home-organization.ts` assigned unchanged text, attributes, selection values and reflected properties. | Native setters generated thousands of mutations, including heading text replacement and redundant `disabled`/`hidden` writes. Small DOM helpers skip identical values. Editor scope availability is applied once instead of enabling a checkbox before disabling it again. |
| A poll catches housekeeping `LOADING`/`COMMITTING` | Collection presentation treated the last committed snapshot as a newly loading collection; frozen review was discarded whenever owner status briefly left READY. | Launchers dimmed and the loading banner appeared despite an unchanged acknowledged collection. `hasCommittedCollection()` preserves that collection during transient reads/saves with a snapshot, following the existing adapter contract for queueing intent. Initial loading without a snapshot, failed and uncertain states remain unavailable. Frozen review retains its exact proposal/revision/terms identity. Confirmation remains subject to current Core checks and successful persistence. |
| Every poll while a proposal exists | `REVIEW_POLICY` ran even when the immutable review and its phase were unchanged. Its observation could itself trigger persistence. | Native Vault review was repeatedly cleared/rebuilt. Reviews are requested when missing, changed, or at the next Core deadline. The UI never derives confirmation permission from time. Invalid/unavailable or mismatched reviews remain unavailable. |
| Usage or editor/storage updates | Home index key included all usage; Sites callbacks unconditionally invalidated it. Ranking changes rebuilt every card in an affected grid. | Unrelated cards and chosen entry points could be reset. Policy/metadata owns the destination index and category catalog. Usage affects ranking alone. Existing cards and pins are reconciled by destination identity and content; unchanged controls/listeners survive moves. Search is recomputed only when its query or index changes. |
| Any request/grant/Journey summary change | One key and three `replaceChildren()` calls owned all access lists. | Readiness or one expiry destroyed unrelated rows. Rows now belong to the individual request, grant or owning Journey context. Text/deadlines/links update locally; expired rows are removed individually. |
| Any page render | Sites rendering started a draft repository read and receipt reconciliation. | Three UI passes per poll could repeatedly query storage. Synchronization now has a separate coalesced `sites.refresh()` called from the accepted periodic read. Rendering performs no repository reads; receipt recovery still uses acknowledged Core state. |
| Repeated read-only retry clicks after a failed adapter read | Each `poll()` completion scheduled another recurring timer chain. | Six native clicks accumulated seven active timers and 41 `GET_VIEW` messages in roughly six seconds. `RefreshLoop` replaces the scheduled timer, coalesces an in-flight read and permits one follow-up. Visibility/unload owns disposal. |
| Passive Journey poll catches a housekeeping read | `journeyPresentation()` rejected LOADING despite a saved active Journey. The content script interpreted null as terminal and removed its host. | A held repository read reproduces the false removal. The display helper now accepts the same acknowledged snapshot during LOADING as during COMMITTING, with unchanged context, revision and expiry checks. Failed and uncertain authority still clears the display. |

One recovery regression found an enabled display-only retry button whose handler
could silently return during housekeeping. Explicit retries now await fresh READY
authority and coalesce concurrent clicks. This does not repeat policy submission,
confirmation or a commit. The native batch suite verifies post-commit recovery
after a full process restart. Reconciliation previews also await fresh authority
and reject a changed local draft before acceptance.

The baseline did **not** reproduce spontaneous category collapse/expansion or lost
search/editor caret at the five-second sampling points. Those states stayed stable
before and after. This report does not claim a separate intermittent collapse bug
was reproduced. Verified layout changes from another Atlas page still apply.

## Ownership and periodic work

- Background `adapter.refresh()` remains on its existing one-second schedule with
  its existing in-flight coalescing. Core still owns expiry and fail-closed checks.
- A control page owns one `RefreshLoop`: one timer, one in-flight request and at most
  one explicit follow-up. Read-only retry cannot multiply recurring poll chains.
- Hidden control pages pause their polling. Becoming visible invalidates stale
  replies and immediately queries current state. Page unload disposes the timer,
  icon/resize observers, tab-icon listener and object URLs.
- Existing command/query epochs prevent an old read from replacing a newer
  explicit operation. Diagnostics also coalesces matching requests and fences
  older scope responses. Missing diagnostic replies produce an error, not false
  empty history.
- Presentation/storage events compare validated semantic values. Identical
  notifications do not invalidate destination state or trigger rendering loops.
- The passive Journey indicator keeps its stable shadow tree, coalesces reads and
  skips unchanged attributes. Active display uses the existing background Core
  recheck's notification as a heartbeat, replacing its second one-second request
  loop. Initial load/pageshow still requests a bound read-only projection. The
  original two-second disconnected-background lease and absolute expiry remain
  enforced. It is still display only.

A first attempt to coalesce the indicator's old polling loop consumed a scheduled
tick when a push overlapped a pending read. Native tracing identified its lease
callback removing the host. That attempt was replaced by the checked heartbeat;
lifecycle reads retain one follow-up, and an old response cannot revive display
after lease expiry. Fake-time tests cover pushes, delayed replies and unload.
The final native interaction run retains the same host/label for 60 seconds.

No read-only message joins the mutating adapter queue. Every navigation still sends
`OPEN_DESTINATION` or another existing command through the adapter/controller.
Keeping an acknowledged collection visible during a save never executes a cached
ALLOW or publishes the candidate policy. Failed authority disables launchers and
retains clearly unavailable/stale presentation and local unfinished drafts.

## Evidence and regression commands

Run after `npm --prefix extension run build`:

```text
python extension/scripts/firefox-e2e.py --ui-stability-only --ui-stability-baseline --addon-dir PATH_TO_PRESERVED_PRE_FIX_DIST
python extension/scripts/firefox-e2e.py --ui-stability-only
python extension/scripts/firefox-e2e.py --ui-stability-interactions-only
python extension/scripts/firefox-e2e.py --ui-stability-indicator-only
python extension/scripts/firefox-e2e.py --home-organization-only
python extension/scripts/firefox-e2e.py --destination-batch-only
```

All profiles, synthetic server fixtures and raw traces stay in ignored `.tools/`.
Instrumentation records counters, fixed synthetic IDs and public fixture labels;
it does not record runtime message payloads, credentials or browsing URLs.

The idle fixture covers five/fifteen categories, pins, saved collapse, open
customization, active grant/Journey countdowns, a pending request, Sites selection
and unfinished editor, a staged batch, Settings, diagnostics, frozen Vault wait and
readiness, and the Greylist access page. Grant/Journey expiry is verified through
Core projections without deleting historical records or changing their timestamps.
768/1080/1440 widths and native 150% zoom are checked. The existing Home suite adds
thirty categories, 125/200% zoom, two-page CAS conflicts and Firefox restart.

Interaction regressions exercise usage reordering with a focused selected entry
point, identical storage notifications, stale failed `GET_VIEW`, stale diagnostic
scope replies, failed adapter reads, failed presentation writes with explicit retry,
native toolbar reuse and a further 60-second passive Journey measurement.

Unit tests cover DOM identity/setter behavior, single-timer ownership, overlapping
and hidden/disposed polling, quiet validated Home reads, delayed-read clicks,
failure/retry and other-page updates, frozen review/deadline/revision fencing,
rendering without storage reads and duplicate notifications. Existing A/B/C/D and
authorization regressions remain required.

### Changed implementation

- `main.ts`: separate destination/index, search, access-row and review update keys;
  retained native controls; one refresh owner; query/diagnostic fences; disposal.
- `dom.ts`: skip equal property/attribute writes and reconcile existing children.
- `refresh-loop.ts`: coalesced requests and one scheduled timer per control page.
- `home-layout-session.ts` and `home-organization.ts`: quiet acknowledged reads,
  unchanged values and existing CAS/draft recovery.
- `data-view.ts` and `vault-presentation.ts`: retained committed display during
  housekeeping; exact frozen review/revision/deadline identity.
- `sites.ts`: coalesced workspace synchronization outside rendering, unchanged
  index/control values, fresh-authority reconciliation and display-only retries.
- `adapter/journey-indicator.ts`, the passive publication in `firefox-adapter.ts`,
  and `content/journey-indicator.ts`: checked display heartbeats and guarded native
  updates. Navigation, policy evaluation and authorization paths are unchanged.
- Three focused test files and the existing batch fixture; native idle/interaction
  probes in `firefox_ui_stability*.py`, with the existing runner's isolated flags.

There is no stylesheet change. Existing countdowns already use tabular numerals,
icon/card dimensions are reserved, transitions change colors/borders rather than
heights, and reduced-motion overrides remain intact. The confirmed flicker came
from state publication and DOM setters rather than a new font or animation.

### Matched native results

Firefox 157.0.1, disposable profiles, a 1440 × 1000 foreground window, identical
synthetic fixtures and five 60-second measurements per build. Each trace samples
focus, selection, scroll, pins, disclosures and category state every five seconds.
[Sanitized counters, samples, regression results and immutable-file hashes](evidence/firefox-ui-stability.json)
are retained with repeated Home frames: [before start](evidence/ui-stability/before-home-start.png),
[before end](evidence/ui-stability/before-home-end.png),
[after start](evidence/ui-stability/after-home-start.png),
[after end](evidence/ui-stability/after-home-end.png). Screenshots supplement the
time-series traces; a single image is not evidence of time-dependent stability.

| Surface, 60 seconds | DOM mutations before | After |
| --- | ---: | ---: |
| Home, five categories and customization | 39,100 | 255 |
| Home, fifteen categories | 54,696 | 258 |
| Sites, selected destination and unfinished editor | 38,081 | 214 |
| Settings, Vault waiting and diagnostics | 36,177 | 174 |
| Greylist confirmation page and Vault readiness | 37,253 | 184 |

The remaining mutations mostly update countdown text. The final run creates no
new DOM elements inside any idle interval. Destination, pin and Sites lists are
never fully replaced. Vault review replacements fall from 28/24 to zero in the
two proposal windows. One access-panel replacement at actual expiry remains
appropriate; unrelated cards and editors stay intact. Explicit
`getBoundingClientRect()` calls fall from 154–174 per interval to zero. This
measures application geometry reads, not Firefox's complete layout/paint work.

`GET_VIEW` remains approximately once per second: 56–58 baseline and 58–67 final
requests per interval, with the existing short recheck during housekeeping.
Diagnostics remains scoped to its open panel. The waiting Vault window drops from
49 `REVIEW_POLICY` calls to zero after its initial frozen review; the readiness
window drops from 51 calls to one at the Core deadline. Reducing rendering does
not remove expiry observation or delay confirmation checks.

The separate six-click retry probe falls from seven active recurring timers and
41 reads to one timer and ten reads over roughly six seconds. Idle timer counts
remain bounded at one, or two during an expiry/focus effect, rather than growing.
The passive Journey keeps its original host and label for 60.03 seconds, with
zero attribute mutations and 57 countdown text updates. Its fixed deadline stays
unchanged. The former read/push race is covered separately with fake latency;
a real lost heartbeat still clears the display within the original lease.

### Verification

- **204 Core tests**, **374 extension tests**, both TypeScript checks and the
  development build pass. Twenty-two focused tests were added: sixteen UI
  stability cases, three Journey projection/heartbeat cases and three content
  lifecycle/latency cases.
- Five final native idle windows pass, including actual grant/Journey expiry and
  pending/Vault readiness without automatic permission. Search/editor values,
  caret, scroll, pin order and saved category states stay stable.
- Nine native interaction checks pass: selected entry-point identity, unchanged
  notifications, stale query/diagnostic fences, truthful read failure, explicit
  layout-save recovery, toolbar reuse and passive display.
- Fourteen Home organization checks cover reload, Firefox restart, thirty
  categories, two-page CAS conflicts, navigation context and access links.
- Nine batch checks cover seven mixed destination edits, one Vault commit,
  stale reconciliation, two-page draft conflict, failed storage and three full
  Firefox restarts. Failed post-commit display work remains recoverable through
  the existing explicit display-only action.
- Final widths 768/1080/1440 show three/four/five columns without overflow. Native
  150% zoom passes; the Home regression also covers 125%/200% zoom and crowded
  layouts. This is functional verification, not an accessibility certification.

All 57 archived release files and all 23 Core source files match the pre-task
SHA-256 baseline. Manifest and package hashes also match. Existing A–D storage
schemas, policy, draft/Vault transitions, grants, Journeys and Download Intent
rules are unchanged. Presentation caching cannot authorize a navigation.
Extension identity remains `atlas-development@atlas.invalid`, version 0.1.15.
No installed XPI, normal Firefox profile or enterprise policy was accessed or
changed. No new release was packaged, signed, submitted or deployed.

## Limits and deliberate choices

There is no new UI framework, virtual DOM, storage schema, notification protocol or
Core cache. Existing one-second checks remain; all permission is obtained afresh.
Status changes caused by real failures, explicit saves, deadlines and remote layout
changes remain visible. No opacity tricks, loading delay or CSS animation conceal
updates. Existing tabular countdown numerals and fixed icon dimensions remain.

Continuous OS-level video, a Firefox profiler CPU/memory trace and real-account
browsing were not collected. Native mutation/identity/focus/scroll traces and
repeated screenshots provide the evidence for this pass. Future intermittent
reports can rerun these fixture probes without exporting private browsing data.

### Capturing an intermittent problem in daily use

Open the Atlas control page's Firefox Web Console and run this read-only probe.
It observes for one minute and keeps counts, standard control IDs, caret positions,
scroll and category counts. It does not read input values, text, hostnames, URLs,
policy, credentials or storage, and sends no extension/network messages. Leave the
affected editor or section open. Afterwards, inspect
`atlasStabilityCapture.stop()`; Firefox's console `copy(JSON.stringify(atlasStabilityCapture.stop()))`
copies only this numeric diagnostic record for sharing.

```js
(() => {
  if (!document.getElementById('destination-list')) throw Error('Run on the Atlas control page.');
  window.atlasStabilityCapture?.stop();
  const counts = { childChanges: 0, added: 0, removed: 0, attributes: 0 };
  const samples = [], started = performance.now();
  const safeIds = new Set(['destination-search', 'site-name', 'site-hostname',
    'site-category', 'site-access', 'sites-search', 'context', 'access-wait', 'vault-wait']);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') counts.attributes++;
      if (record.type === 'childList') {
        counts.childChanges++; counts.added += record.addedNodes.length;
        counts.removed += record.removedNodes.length;
      }
    }
  });
  let timer, stopped = false;
  const sample = () => {
    const focus = document.activeElement;
    samples.push({ seconds: Math.round((performance.now() - started) / 1000),
      counts: { ...counts }, focus: safeIds.has(focus?.id) ? focus.id : 'other',
      caret: typeof focus?.selectionStart === 'number' ? [focus.selectionStart, focus.selectionEnd] : null,
      scroll: scrollY, width: innerWidth,
      categories: document.querySelectorAll('.service-group').length,
      collapsed: document.querySelectorAll('.service-group[data-collapsed="true"]').length,
      cards: document.querySelectorAll('.destination-card').length });
  };
  window.atlasStabilityCapture = { stop() {
    if (!stopped) { stopped = true; clearTimeout(timer); observer.disconnect(); }
    return { counts: { ...counts }, samples };
  } };
  observer.observe(document.body, { subtree: true, childList: true, attributes: true });
  sample();
  const tick = () => {
    sample();
    if (performance.now() - started >= 60000) window.atlasStabilityCapture.stop();
    else timer = setTimeout(tick, 5000);
  };
  timer = setTimeout(tick, 5000);
  return 'Collecting Atlas UI counts for one minute.';
})();
```

This optional daily-use probe has no authorization role. The native harness also
records node identity, detailed structural counters and synthetic failure cases.
