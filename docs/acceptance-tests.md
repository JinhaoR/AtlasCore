# Atlas Core acceptance scenarios

Status: Milestones 1 through 3 and D11 Journeys have pure domain evidence; D13/D14 add planner/controller evidence. D15 adds mocked Firefox, emulated IndexedDB, and an isolated native browser scenario. The tables distinguish these levels from remaining coverage and durability questions.

## Requirements

Tests must prove domain behavior without a browser. Use explicit fixture state, adding an injectable clock and isolated storage when the behavior needs them. Do not wait for real cooldowns, use live accounts, export browser profiles or depend on public websites for Core tests.

The requirements and unresolved semantics are defined in [foundation.md](foundation.md). A scenario marked **conditional** depends on a proposed design or open question. Resolve that choice before making the corresponding test authoritative.

## Decisions already made

Test intentional access and protected policy transitions. Do not create a Core test asserting that every connection to a non-Whitelisted host is prevented. That would restore the rejected firewall interpretation.

Historical Zenith test results are evidence about Zenith only. Reimplement useful scenarios against Atlas's public behavior rather than copying tests that assume WPF, WebView2 or old storage formats.

## Proposed architecture for tests

Keep tests beside the package that owns the behavior. Start with table-driven examples and fake dependencies. Add a reusable storage contract suite when there is a real storage implementation; add browser conformance tests only when an adapter exists.

Use fictional destinations such as `mail.example`, `identity.example` and `blocked.example`. For each state-changing test, check the returned outcome, resulting state and persisted state where applicable. Verify rejected operations leave authoritative state unchanged.

## Milestone 1 evidence

Tests run against the compiled public API with Node's built-in test runner. Build/type-check commands and the current result count are recorded in the root README. These Milestone 1 tests do not exercise storage or adapters.

| Scenario | Implemented evidence |
| --- | --- |
| C01 | `evaluate.test.mjs`: `a whitelisted domain returns ALLOW`. |
| C02 (policy lists) | `a blacklisted domain returns DENY`; `blacklist overrides whitelist after normalization`. Grant precedence is covered by Milestone 2 below; supporting cases remain deferred. |
| C03 | `an unknown domain returns GREYLIST`. No access workflow is started. |
| C04 | `evaluation is deterministic for identical requests and policy`; `evaluation does not mutate policy state or the requested target`. |
| C05 | Malformed target/policy tables and whole-policy rejection when a Blacklist entry is invalid. |
| C06 (initial Q2 contract) | `target.test.mjs` normalization/rejection cases plus evaluator tests for normalization symmetry and exact hostname scope. Unsupported forms are rejected, not claimed as implemented compatibility. |

Test files: [evaluate.test.mjs](../packages/core/tests/evaluate.test.mjs), [target.test.mjs](../packages/core/tests/target.test.mjs).

## Milestone 2 evidence

[access.test.mjs](../packages/core/tests/access.test.mjs) adds 25 tests using explicit time and isolated snapshots. These test pure decisions/transitions and serialization round trips, not actual storage or browser behavior.

| Scenario | Implemented evidence |
| --- | --- |
| G01 | Start produces a waiting request without a grant; repeated Start retains its ID, deadlines, and frozen terms. |
| G02 | Before readiness returns WAIT; at readiness returns REQUIRE_CONFIRMATION. Elapsed time never creates permission. |
| G03 | Confirmation returns request removal and one exact-host grant in the same next state. Policy-only evaluation remains GREYLIST. |
| G04 | Early, late, missing, invalid, cancelled, and consumed IDs reject confirmation. New starts after cancellation/expiry require the full wait and a new ID. |
| G05 / C02 | Grant validity is tested at issuance, before expiry, and exactly at expiry. Current Blacklist overrides grants and Whitelist; policy revision changes invalidate overlays. |
| G06 | Reloaded pending/grant/cancelled/consumed state preserves timestamps and ID allocation. Original deadlines apply to supplied elapsed time. |
| G07 (domain only) | A complete candidate transition consumes the request once; confirming against its resulting state cannot renew the grant. Real commit failure, lost acknowledgement, and concurrent-writer guarantees remain untested. |
| C04/C05 / P04 (domain only) | Determinism, immutable inputs, malformed state/configuration, arithmetic overflow, ID exhaustion, and time/revision rollback against retained observation metadata. Actual clock manipulation and durable recovery are untested. |

All supported timestamps, durations, IDs, and revisions are validated as safe integers. The tests distinguish unchanged workflow records from updated observation metadata on rejected commands. No production duration is inferred from fixture timing.

## Milestone 3 evidence

[vault.test.mjs](../packages/core/tests/vault.test.mjs) adds 22 passing tests for the adopted D10 workflow with explicit fixture times and isolated snapshots. Commit success/failure is simulated by adopting or discarding the complete candidate. There is no storage or coordinator implementation in this milestone; these tests cannot establish durable or concurrent commit behavior.

| Scenario | Domain coverage |
| --- | --- |
| V01 | Proposal creation freezes copied policy and deadlines; repeated review leaves all state unchanged. Creation, review, waiting, and confirmation preparation do not change active policy. |
| V02 | Frozen returned records cannot be edited; another candidate cannot replace a pending proposal; malformed batches and stale revisions fail closed. Cancel consumes the ID; a new proposal requires a new ID and full wait. |
| V03 | Explicit ready confirmation prepares one complete replacement snapshot. Discarding it leaves policy unchanged; adopting it increases the revision once and consumes the proposal. Duplicate confirmation against that resulting state cannot commit again. |
| V04 (current scope) | All user-managed Whitelist/Blacklist additions and removals use the same configured wait. Early and expired confirmation fail; unsupported timing-policy edits are rejected. Actual protective-delay changes remain outside the Policy model. |
| V05 | The candidate preserves the latest access records, counters, and deadlines while advancing the observed policy revision. Existing requests/grants become stale only when the candidate is adopted. Classification summaries respect Blacklist precedence. |
| V06 / C04 / C05 | No password/authentication dependency; deterministic results, no input mutation, copied/frozen outputs, and validation of supplied state/time/revisions. |

Review is read-only and returns no observation state. Other valid-context transitions return a checkpoint even on rejection, without changing proposal contents or permissions. Retry after a simulated definite failed write requires fresh explicit preparation within the frozen window. Real failed/conflicted/unknown commits, malicious website messages, and persistence across process exit still require integration evidence.

### Classification and evaluation

| ID | Scenario | Expected result / status |
| --- | --- | --- |
| C01 | A matching Whitelist rule governs the requested action. | Allow unless an applicable Blacklist rule takes precedence. |
| C02 | A host matches Blacklist and Whitelist, or Blacklist and an active grant. | Deny. Supporting metadata must not override this result. |
| C03 | No applicable rule or grant exists. | Greylist outcome requiring the deliberate access flow; no implicit permission. |
| C04 | Evaluate the same request repeatedly against identical state and time. | Identical decision; no new grants, cooldowns or policy mutations. |
| C05 | Authorization state or request input is malformed or unsupported. | Explicit failure/denial; no permissive fallback or partially accepted policy. |
| C06 | Matching encounters case, trailing dots, IDNs, IP addresses, ports, schemes, lookalike hosts, subdomains and `www`. | **Conditional on Q2.** Encode the chosen normalization and scope once. A similarly named host must never pass because of substring matching. Do not silently assume Apex/`www` equivalence. |

### Greylist and grants

| ID | Scenario | Expected result / status |
| --- | --- | --- |
| G01 | Begin an eligible Greylist request through explicit Start (the initial deliberate action under D9). | A scoped pending request exists with the correct start/deadline; no active grant yet. Repeated submission cannot shorten the wait. |
| G02 | Evaluate just before and at the cooldown deadline. | Before: wait. At readiness: explicit final confirmation is still required. Production duration and confirmation expiry depend on Q6. |
| G03 | Confirm a ready request successfully. | Exactly one valid scoped grant is created. A fresh evaluation allows its intended destination. Unrelated hosts remain Greylisted. |
| G04 | Confirm early, with the wrong request, after consumption, or after applicable expiry. | No new grant. Invalid state has a defined recovery outcome without skipping the wait. Confirmation-expiry details depend on Q6. |
| G05 | Evaluate at a grant's expiry boundary or after a new applicable Blacklist rule. | The expired or Blacklisted grant cannot authorize access. The adapter separately handles already displayed content. |
| G06 | Reload a pending wait after frontend closure or background suspension. | It cannot become a new shorter wait or an automatically confirmed grant. D9/Q3 retains grant expiry across reload; actual process/storage persistence requires later integration tests. |
| G07 | Final confirmation cannot be durably committed, is submitted twice, or races with a policy change. | No uncommitted grant is exposed as success; at most one transition is consumed. Revalidate current policy. Retry behavior must follow the chosen storage contract. |

### Vault and protected state

| ID | Scenario | Expected result / status |
| --- | --- | --- |
| V01 | Stage valid changes, preview them and wait. | Preview represents the actual pending contents. Existing policy remains authoritative until required confirmation and successful commit. |
| V02 | Alter a pending proposal after review, confirm a stale proposal, or submit a batch containing invalid entries. | No confirmation is applied to different contents and no unintended partial batch is committed. D10 requires explicit cancellation and a new full wait to replace contents. |
| V03 | Confirm a ready valid proposal. | Intended policy changes commit together; unrelated policy remains unchanged. Duplicate confirmation cannot apply a second transition. |
| V04 | Propose shortening protective delays. | The new value cannot bypass the protection governing that very change. Timing-policy edits are unsupported in Milestone 3. D10 uses the same protected flow for all current Whitelist/Blacklist edits, including removal and tighter restrictions; production durations remain Q6. |
| V05 | Policy changes while grants or waits exist. | Blacklist precedence always holds. D9/D10/Q8 invalidates pending requests, grants, and proposals on policy revision changes. Pure Vault candidates include that revision change; real atomic commits and future supporting contexts still need implementation/tests. |
| V06 | Use the baseline cooldown-and-confirmation flow. | No invented mandatory password or external authentication dependency. If optional additional friction is later approved, test it separately without disabling the baseline protections. |

### Journey evidence (D11)

The former catalog scenarios S01-S05 are superseded for the current scope. [journey.test.mjs](../packages/core/tests/journey.test.mjs) adds 23 passing domain tests using explicit time and isolated snapshots.

| ID | Scenario | Implemented evidence |
| --- | --- | --- |
| J01 | Start from Pure Whitelist; initial root arrival does not complete. | Root validation, frozen terms, initial arrival/reload, repeat-Start rejection without renewal. |
| J02 | Navigate through unfamiliar intermediates under one deadline. | Intermediate ALLOW, host/path/reload behavior, fixed expiry, repeated crossings, no policy or grant changes. |
| J03 | Return to the root. | Speculative evaluation does not complete; recording exact root arrival after departure ends authorization. Subdomains are distinct. |
| J04 | Expire or exceed the hop limit. | Exclusive deadline, current intermediate loses permission, observation without navigation, allowed root return at the cap, attempted extra hop ends the Journey. |
| J05 | Cancel or close a context. | Terminal state survives serialization; explicit fresh Start allocates a new ID; old commands cannot select it. |
| J06 | Policy changes or becomes invalid. | Stale revision, rollback, removed/Blacklisted root, and whole invalid policy terminate authorization. Repairing policy does not revive a consumed Journey. |
| J07 | Blacklist and context boundaries. | Blacklist overrides Whitelist/Journey authorization; two contexts retain separate terms and cannot use each other's IDs. |
| J08 | Malformed data, replayed observations, or speculative permission. | Invalid state fails closed even for Whitelisted targets; unsafe numbers/identifiers reject; recording rechecks time and policy; deterministic nonmutation and copied/frozen state. |

These serialization tests demonstrate retained timestamps and terminal state, not actual process restoration. Browser context provenance, event ordering, displayed-content removal, popup/frame handling, real persistence, and login compatibility require separate adapter evidence. D13/D14 now compose Journey and grant decisions with complete-state validation; D15/D16's browser evidence is recorded below.

### Time, persistence and privacy

| ID | Scenario | Expected result / status |
| --- | --- | --- |
| P01 | Load an existing state whose schema, entries or relationships are invalid. | Report a recoverable problem without treating corruption as a fresh unrestricted installation. Initialization and recovery behavior are **conditional on Q10**. |
| P02 | Fail a write before commit, interrupt a commit, or lose its acknowledgement. | No partially written policy is published. Reload authoritative storage before reporting an uncertain operation as committed or retrying it. Verify the implementation's documented atomicity and durability limits. |
| P03 | Two callers change the same stored revision. | One writer or an enforced concurrency contract prevents silent lost updates. A fake repository alone does not prove the real backend provides this property. |
| P04 | Move time forward, detect rollback, suspend/restart, or change the local timezone. | Deterministic results follow the selected Q9 rules. Do not mistake local monotonic time for a clock that survives restart, or claim protection against all device-clock tampering. |
| P05 | Clear browser cookies/cache or optional Atlas audit history. | Those operations do not erase grants' constraints, pending cooldowns or Vault protections. Browser-data wiring is a later adapter test. |
| P06 | Record decisions involving a URL with sensitive parameters. | Persist only approved minimal audit data; no passwords, tokens, request bodies, cookies or complete authentication URLs. Audit scope and retention depend on Q11. |

## Integration boundary test plan

Status: D13 implements domain composition; D14 implements commit coordination against a fake repository. D15 adds the narrow Firefox protocol. Evidence is separated below; the broader [integration design](architecture.md#framework-independent-integration-boundary) still contains proposed APIs.

| ID | Scenario | Required evidence |
| --- | --- | --- |
| I01 | A Whitelisted target or valid grant is evaluated while another aggregate component is malformed. | Complete-state validation blocks ALLOW; choosing a different module cannot bypass the error. |
| I02 | Several valid authorization bases coexist, including Blacklist, a grant, and a Journey. | Common precedence, stable reasons, unchanged grant scope, and Journey bookkeeping independent of the selected ALLOW basis. |
| I03 | Two contexts share policy and a hostname grant but only one has a Journey. | Grant scope stays hostname-wide; mismatched Journey IDs/context bindings cannot borrow authority. |
| I04 | Access confirmation or Vault confirmation reaches the repository. | No committed result or new permission before successful atomic save; request/proposal consumption and all related state are included together. |
| I05 | Access/Journey activity changes while a Vault proposal waits. | Final aggregate candidate uses latest records, advances policy once, and invalidates Journeys with that revision without losing state. |
| I06 | Definite failure, conflict, or acknowledgement loss. | Distinct results; no optimistic success or automatic confirmation replay; unknown outcomes block until settled. Missing later markers are not proof of failure. |
| I07 | Time passes during a slow commit; an observation checkpoint write fails. | Expired permission is never released, deadlines are not renewed, and required checkpoint failure cannot fall back to ALLOW. |
| I08 | CHECK, ADOPT, and ARRIVED occur separately; execution then fails. | An ALLOW assessment cannot execute; checks do not consume hops or complete returns. Adoption accounts for intermediate budget; only matching actual root arrival completes. Failure does not refund time or silently replay navigation. |
| I09 | Duplicate, superseded, wrong-context, or late reports arrive. | One current action per context; no double counting, revival, or completion of a newer attempt by an old report. |
| I10 | Policy commits or a deadline expires while content remains open. | Semantic recheck requirements identify affected contexts; the controller does not claim a browser effect occurred merely by emitting a notice. |
| I11 | Restart loads valid grants and old Journey records but no proven browser bindings. | Original grants/waits/deadlines survive; old Journeys end for lost bindings before authority is published; no implicit fresh initialization. |
| I12 | UI review or an untrusted-shaped request tries to replace state, timing, or frozen proposal contents. | Read-only review remains read-only; unsupported fields reject. Actual caller isolation still requires separate host/adapter tests. |
| I13 | Retained content is rechecked while an adopted navigation is pending. | Rechecking known displayed content does not invent a navigation or extra hop. Unexplained target changes require reconciliation. |
| I14 | An ALLOW response is queued while policy changes, its deadline passes, or its context closes. | Stale permission cannot execute; the host must obtain a fresh decision or cancel the action. |

### Aggregate planner evidence (D13)

[atlas.test.mjs](../packages/core/tests/atlas.test.mjs) adds 28 passing tests with fake snapshots and explicit time. Combined with prior modules, the suite has 117 passing tests. No repository or browser is used.

| Scope | Evidence |
| --- | --- |
| I01 | Missing/malformed aggregate components block Whitelist/grant assessments and otherwise ready Access/Vault confirmations. Revision, record, and timestamp relationships are checked without initialization or silent repair. |
| I02 | Blacklist wins; Whitelist precedes grants, then Journeys. Waiting/readiness alone never grants access. Expired grants may fall back to independently active Journeys. Journey budget/return bookkeeping still occurs under grant/Whitelist ALLOW. |
| I03 | Contexts cannot borrow or omit a live Journey binding; grants keep hostname-wide scope. Two Journeys retain independent cancellation, hops, and deadlines. Trusted browser binding is not tested. |
| I04/I05 (candidate only) | Access confirmation combines request removal and grant creation. Vault confirmation combines policy/revision/proposal consumption with latest access records and invalidated Journeys. Observation snapshots retain old authority; discarding a candidate models no adoption. No durable commit is tested. |
| I08 (domain primitive only) | Checks do not record hops or complete root returns. Explicit Journey records do, including independent authorization. The future CHECK/ADOPT/ARRIVED correlation protocol remains unimplemented. |
| I12 (data only) | Review returns no state transition. Closed command shapes reject injected time, state, timing, and replacement confirmation contents. Proposal copies remain frozen. Caller isolation remains an adapter obligation. |
| Time and purity | Global rollback checks use all three observation timestamps. Tests cover expiry, stale revisions, cancellation, duplicate confirmation, deterministic nonmutation, frozen detached outputs, and serialized deadline preservation. Serialization is not restart-binding or durability evidence. |

These D13 tests alone do not establish I06-I07, I09-I11, or I13-I14. D14 adds the narrower controller evidence below.

### Controller evidence (D14)

[controller.test.mjs](../packages/core/tests/controller.test.mjs) adds 27 passing tests, bringing the suite to 144. Its [fake repository](../packages/core/tests/support/fake-repository.mjs) models atomic compare-and-swap, delayed acknowledgements, write failures, conflicts, unknown outcomes, and restart fencing. These tests establish the controller protocol, not a production backend's durability.

| Scope | Implemented evidence |
| --- | --- |
| I01 / P01 | Open is required. Missing/corrupt envelopes and invalid aggregate data block operation without fallback initialization, including otherwise Whitelisted targets. |
| I04 / G07 / V03 | Delayed confirmation exposes no uncommitted grant. Access consumption and Vault policy changes are published only after verified saves. Duplicate confirmation cannot renew/reapply changes. |
| I06 / P02 | Definite failures, conflicts, and unknown outcomes are distinct. Recovery never replays confirmation. Applied and not-written unknown attempts remain blocked until resolved; thrown/malformed/mismatched receipts fail closed. Later markers are not proof of failure, and contradictory recovery data is rejected. |
| P03 | Concurrent calls execute in order; queued work after failure remains blocked. Two owners racing one version cannot silently overwrite the winner. Real backend concurrency remains unverified. |
| I07 / P04 | Failed checkpoints block Whitelist assessments. Time floors survive failures in the current owner. Slow saves withhold expired grant/Journey ALLOW; post-save rollback blocks responses without pretending the saved transition was undone. |
| I11 (library restart) | A new controller discovers in-flight/unsettled attempts through load fencing. Settled restart preserves wait/grant/proposal deadlines and consumes lost Journey bindings before READY. Failure to save startup housekeeping blocks readiness. No browser binding restoration is implemented. |
| I12 | Review saves nothing. Configuration, queued operations, views, and responses cannot mutate owner state. Load/clock/resolve failures preserve the queue for explicit recovery. |

D14 alone does not establish I08-I10, I13, or I14's browser obligations. D15 binds fresh controller assessments to held requests after required recording; its evidence follows. Generic DECISION/ADOPT APIs remain proposed. Physical storage crash/power-loss guarantees still require separate evidence.

## Firefox adapter evidence (D15)

Verified on 2026-09-30 with Node.js 24.12.0, TypeScript 6.0.3, and Firefox 157.0 on Windows. Core remains unchanged with 144 passing tests. The extension adds 27 passing tests: 20 adapter scenarios using the real Core with fake Firefox/time, and seven repository scenarios using IndexedDB emulation. Build and type checks pass. [Architecture and limitations](firefox-adapter.md), [commands and loading](../extension/README.md).

| Evidence | What it establishes |
| --- | --- |
| [Adapter tests](../extension/tests/adapter.test.mjs) | Top-level-only gating, Whitelist/Blacklist behavior, Greylist Start/wait/explicit confirmation/expiry, immutable policy, fixed Journey paths and return bookkeeping, isolated/reused tab contexts, cancellation/expiry/hop limits, failed/unknown saves, superseded requests, and rejected website-shaped messages. |
| Adapter lifecycle tests | Unmatched history/arrival loses Journey binding; failed or hung content replacement never reports success; late initial blank-page events cannot end a new Journey; missing arrival callbacks cannot retain expired authorization; pending navigation checks do not invent hops; browser-state and unexpected listener failures fail conservatively. |
| [Repository tests](../extension/tests/repository.test.mjs) | Version-checked writes across connections, read barriers, rollback after a partial transaction attempt, receipts surviving later commits, duplicate attempt rejection, reopening, invalid candidate rejection, unavailable storage, and no setup over missing initialized authority. These use `fake-indexeddb`, not disk-failure simulation. |
| [Native scenario](../extension/scripts/firefox-e2e.py) | Loads the built manifest in an isolated Firefox profile, submits the real setup form, opens synthetic root/provider/identity documents, follows an HTTP redirect through the root without completing early, and completes on actual root arrival. The fixed deadline, unchanged policy, and absence of grants are asserted before testing the separate Access flow. |
| Native denial and Access | After Journey return, an intermediate is Greylist and the UI replaces the denied page. The independent local server sees no denied `/after` request. A real development cooldown, early-confirmation rejection, explicit confirmation, duplicate rejection, and fresh permitted navigation work through the extension bridge. No real authentication or sensitive POST body is used. |
| Native backend/reload | Real extension-origin IndexedDB serves the controller. `runtime.reload()` closes UI pages; a fresh UI observes recovered state. Pending/grant timestamps remain identical, policy remains unchanged, and the old active Journey ends for lost binding. This is a background/add-on reload test, not a physical power-loss or full temporary-add-on uninstall test. |

Native runs exposed an ordering difference absent from the initial mocks: initial `about:blank` arrival can be delivered after the HTTP request is already held. The adapter now preserves the newer request; a regression test covers both pre-request and post-request blank-page arrival. Native tests also exercise the bound timer wrappers used to replace denied content.

No fixture establishes real Ladok/provider compatibility, complete history/BFCache enforcement before display, every popup/download/scheme, private browsing, protected Firefox pages, interactions with other extensions, or crash/power-loss durability. Cookie/cache clearing and receipt compaction remain untested. Development timing values are not production settings. Reports and screenshots stay in ignored `.tools/` and contain only synthetic fixture state.

## Firefox prototype evidence (D16)

On 2026-09-30, Core still has 144 passing tests and no source/API changes. The extension has **34 passing tests**: 25 adapter scenarios, two presentation boundary checks, and seven repository scenarios. Build and type checks pass. No dependencies were added for this iteration.

- [Prototype tests](../extension/tests/prototype.test.mjs) cover read-only inspection during a pending commit without exposing a grant candidate; explicit Confirm and open; failed saves, closed/changed tabs, and duplicate confirmations preventing navigation; rejected Journey cleanup; toolbar reuse; bounded and detached diagnostics; hostname-only redirect observations; and rejection of inherited command keys.
- [Presentation tests](../extension/tests/presentation.test.mjs) verify that a zero countdown cannot turn WAIT into permission and that a closed tab selection never falls back to another context.
- The [native Firefox scenario](../extension/scripts/firefox-e2e.py) passes on Firefox 157.0 with real IndexedDB and actual UI request/confirmation buttons. It checks visible countdowns, focus retention, diagnostic rows, closed-tab selection, the existing Journey path/HTTP redirect, independent server evidence of withholding, and saved timestamps after background reload.
- A native rerun initially found confirmation still disabled while Core had already returned REQUIRE_CONFIRMATION. The UI now revisits COMMITTING/LOADING views after 100 ms, avoiding a fixed polling interval that can coincide with background saves. The updated native scenario passes; pending saves still disable actions. Read-only UI inspection does not request Core transitions or cause writes.
- [Public-site evidence](firefox-real-sites.md) records Google, Microsoft, ORCID, KTH Canvas, and partial Ladok checks. Active intermediates returned to Greylist on cancellation. No policy edits or grants occurred. Full authenticated flows and Ladok institution selection remain unverified.

The latest passing local native run is `.tools/firefox-e2e-ktyjcz_7/`, including the waiting-page screenshot. Synthetic profiles/logs stay local for debugging. Public-site profiles are deleted; their reports contain only sanitized data. Existing D15 coverage and durability limitations still apply.

## Curated defaults and managed Blacklist evidence (D17)

On 2026-10-01, **152 Core tests** and **50 extension tests** pass, together with both packages' type checks and builds. No dependency was added. The [managed policy contract](managed-policy.md) owns source selection, precedence, feed validation, refresh semantics, and the follow-up preset upgrade for existing profiles.

| Evidence | What it establishes |
| --- | --- |
| [Core managed tests](../packages/core/tests/managed-blacklist.test.mjs), 8 cases | Manual Blacklist → Whitelist → managed denial → grants/Journey → Greylist; managed denial prevents Access start/confirmation and Journey recording; invalid compiled authority fails closed; input mutation cannot change a compiled set; controller fences authority changes during saves. |
| Large synthetic dataset in that suite | Compile 200,000 domains once, then run 2,000 complete navigation plans with zero subsequent source-array reads. One local run compiled in 216 ms and planned in 42 ms; these are observations, not portable performance promises. |
| [Preset tests](../extension/tests/presets.test.mjs), 4 cases | All 50 requested exact hosts allow; each of 31 services occurs once; aliases require explicit declaration; distinct entry points stay distinct; Google Search, unspecified Canvas roots, and login infrastructure are excluded. The real bundled list denies representative managed domains while retaining all curated Whitelist exceptions. |
| [Managed feed tests](../extension/tests/managed-feed.test.mjs), 7 cases | Defensive parsing; failed/truncated/malformed updates preserve last good data; daily attempts coalesce and retain throttling across restart; activation follows atomic cache success and host publication; notification failure does not undo activation; corrupt cache uses the verified bundle; emulated IndexedDB retains complete metadata. |
| Additional [adapter case](../extension/tests/adapter.test.mjs) | Real Core/controller decisions cancel a managed Journey intermediate and reject its Access request. Feed publication waits behind a navigation awaiting persistence; subsequent requests use the new set. |
| [Native Firefox scenario](../extension/scripts/firefox-e2e.py), Firefox 157.0 | Curated setup saves 50 defaults plus one synthetic destination; managed data is active; a native managed navigation is denied and cannot start Access; restart loads the cached list and retains the refresh attempt time. Existing Journey/redirect, explicit confirmation, focus, diagnostics, tab closure, and saved workflow timestamps also pass. |

The offline snapshot has 163,850 supported names; six underscore-bearing upstream names are skipped and visible in status. Source/version/digest and upstream notices accompany the snapshot. A native managed denial is observed at the adapter gate; independent server evidence of withholding remains the synthetic post-Journey request check. These tests do not establish complete authenticated service compatibility, every upstream classification, exhaustive browser coverage, or physical power-loss durability.

The user reported that reload retained an older Whitelist. The extension now offers an explicit preset proposal under Policy & recovery. Four [upgrade tests](../extension/tests/preset-upgrade.test.mjs) verify frozen additions and preservation of custom entries/manual Blacklist, no change on review/readiness, cancellation/expiry, failed commits, duplicate confirmation, website rejection, and restart retaining the proposal. Core logic is unchanged. Native Firefox 157.0 also passes `firefox-e2e.py --existing-policy`: initialize an older policy, reload, observe that it remains active, review/wait/confirm through actual Vault controls, then verify saved additions and the ordinary browsing/restart scenario. The local passing artifact is `.tools/firefox-e2e-wipyitxm/`; no normal user profile was read or changed.

## Later browser conformance tests

These are integration obligations for the selected adapter, not reasons to add browser types to Core or build both frontends now. First resolve Q12: which actions does that frontend actually promise to govern?

1. Exercise each governed entry point: direct opening, redirects, popups, history/restore and applicable embedded documents. Compare decisions with the same Core fixtures. A root-document hook alone is not proof of frame coverage.
2. Test allowed destinations and ordinary login continuation as positive cases. A sign-in page loading is not proof that a complete authenticated session works. Use dedicated test accounts only where necessary.
3. Test a successful Greylist flow through actual opening. Distinguish grant creation, attempted navigation, redirect classification and visible rendering. Keep the original intended destination in adapter state without persisting credential-bearing URLs in Core.
4. Verify expired/revoked access is actually removed from the governed visible context. Failed, cancelled, hung or crashed removal must not be reported as successful while content remains active. Concrete recovery is platform-specific.
5. Where the adapter claims to cancel a denied redirect before submission, independently observe a test server, including method/body-preserving redirects. An error page alone is not evidence that a request body was withheld. Do not turn this into a universal no-network-contact guarantee.
6. Verify process/background suspension does not reset waits or create confirmation. Test the selected grant-session semantics explicitly.
7. Verify page messages cannot mutate policy, supply authoritative time/context, or call privileged host functions. Shared Core code does not itself protect an unsafe adapter bridge.
8. Verify Journey intermediates remain temporary and context-bound, can be displayed during the attempt, and never become ordinary policy entries. Test actual removal of their authorization on root return, expiry, cancellation, or context loss.

Browser permission prompts, chooser behavior, storage isolation and safe runtime configuration remain adapter/engine concerns. Review them when integrating a browser; do not import every historical Zenith capability restriction into the initial Core acceptance suite.

## Open questions and evidence

For each adopted conditional scenario, record the resolved foundation question and test name. Report Core unit tests, real-storage tests and native/browser tests separately. List untested adapter behaviors explicitly rather than implying that passing Core tests proves email-account safety.
