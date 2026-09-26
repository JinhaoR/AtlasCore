# Atlas Core acceptance scenarios

Status: test design, not implemented or executed. These scenarios carry behavioral lessons into a new implementation; they are not a claim that Atlas Core already passes them.

## Requirements

Tests must prove domain behavior without a browser. Use explicit fixture state, an injectable clock and isolated storage. Do not wait for real cooldowns, use live accounts, export browser profiles or depend on public websites for Core tests.

The requirements and unresolved semantics are defined in [foundation.md](foundation.md). A scenario marked **conditional** depends on a proposed design or open question. Resolve that choice before making the corresponding test authoritative.

## Decisions already made

Test intentional access and protected policy transitions. Do not create a Core test asserting that every connection to a non-Whitelisted host is prevented. That would restore the rejected firewall interpretation.

Historical Zenith test results are evidence about Zenith only. Reimplement useful scenarios against Atlas's public behavior rather than copying tests that assume WPF, WebView2 or old storage formats.

## Proposed architecture for tests

Keep tests beside the package that owns the behavior. Start with table-driven examples and fake dependencies. Add a reusable storage contract suite when there is a real storage implementation; add browser conformance tests only when an adapter exists.

Use fictional destinations such as `mail.example`, `identity.example` and `blocked.example`. For each state-changing test, check the returned outcome, resulting state and persisted state where applicable. Verify rejected operations leave authoritative state unchanged.

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
| G01 | Begin an eligible Greylist request through the required initial confirmation. | A scoped pending request exists with the correct start/deadline; no active grant yet. Repeated submission cannot shorten the wait. |
| G02 | Evaluate just before and at the cooldown deadline. | Before: wait. At readiness: explicit final confirmation is still required. Production duration and confirmation expiry depend on Q6. |
| G03 | Confirm a ready request successfully. | Exactly one valid scoped grant is created. A fresh evaluation allows its intended destination. Unrelated hosts remain Greylisted. |
| G04 | Confirm early, with the wrong request, after consumption, or after applicable expiry. | No new grant. Invalid state has a defined recovery outcome without skipping the wait. Confirmation-expiry details depend on Q6. |
| G05 | Evaluate at a grant's expiry boundary or after a new applicable Blacklist rule. | The expired or Blacklisted grant cannot authorize access. The adapter separately handles already displayed content. |
| G06 | Reload a pending wait after frontend closure or background suspension. | It cannot become a new shorter wait or an automatically confirmed grant. Active-grant behavior across restart is **conditional on Q3**. |
| G07 | Final confirmation cannot be durably committed, is submitted twice, or races with a policy change. | No uncommitted grant is exposed as success; at most one transition is consumed. Revalidate current policy. Retry behavior must follow the chosen storage contract. |

### Vault and protected state

| ID | Scenario | Expected result / status |
| --- | --- | --- |
| V01 | Stage valid changes, preview them and wait. | Preview represents the actual pending contents. Existing policy remains authoritative until required confirmation and successful commit. |
| V02 | Alter a pending proposal after review, confirm a stale proposal, or submit a batch containing invalid entries. | No confirmation is applied to different contents and no unintended partial batch is committed. Exact pending-proposal replacement behavior must be specified. |
| V03 | Confirm a ready valid proposal. | Intended policy changes commit together; unrelated policy remains unchanged. Duplicate confirmation cannot apply a second transition. |
| V04 | Propose shortening protective delays. | The new value cannot bypass the protection governing that very change. Other edit timing, including Blacklist removal, is **conditional on Q6/Q7**. |
| V05 | Policy changes while grants or waits exist. | Blacklist precedence always holds. Other invalidation/revalidation behavior is **conditional on Q8**; do not assume P8 has been adopted. |
| V06 | Use the baseline cooldown-and-confirmation flow. | No invented mandatory password or external authentication dependency. If optional additional friction is later approved, test it separately without disabling the baseline protections. |

### Supporting-domain knowledge

| ID | Scenario | Expected result / status |
| --- | --- | --- |
| S01 | Load a reviewed catalog or observe an unknown host requested by a page. | Loading descriptive data or observing traffic does not silently create user policy entries. An unknown request is not evidence sufficient to authorize itself. |
| S02 | A valid supporting interaction uses a catalog endpoint; compare with a direct ordinary visit to that host. | **Conditional on Q4/Q5.** Test the adopted activation and context rules. Do not equate hidden presentation with universal allow or universal deny. |
| S03 | A page claims that a destination is necessary for login, or sends a purported authorization context. | Untrusted claims cannot establish trusted supporting context or invoke privileged policy changes. Adapter message validation is tested separately. |
| S04 | Supporting access encounters a Blacklisted host or an expired/revoked authorizing context. | Blacklist denies. Context lifetime tests apply **if P4 is adopted**, with the precise rules chosen under Q4/Q8. |
| S05 | Catalog validation fails or a future catalog revision adds a host. | No partial candidate becomes active and no silent policy mutation occurs. Permission effects of valid revisions require the Q5 design; do not implement an update subsystem just to test this future case. |

### Time, persistence and privacy

| ID | Scenario | Expected result / status |
| --- | --- | --- |
| P01 | Load an existing state whose schema, entries or relationships are invalid. | Report a recoverable problem without treating corruption as a fresh unrestricted installation. Initialization and recovery behavior are **conditional on Q10**. |
| P02 | Fail a write before commit, interrupt a commit, or lose its acknowledgement. | No partially written policy is published. Reload authoritative storage before reporting an uncertain operation as committed or retrying it. Verify the implementation's documented atomicity and durability limits. |
| P03 | Two callers change the same stored revision. | One writer or an enforced concurrency contract prevents silent lost updates. A fake repository alone does not prove the real backend provides this property. |
| P04 | Move time forward, detect rollback, suspend/restart, or change the local timezone. | Deterministic results follow the selected Q9 rules. Do not mistake local monotonic time for a clock that survives restart, or claim protection against all device-clock tampering. |
| P05 | Clear browser cookies/cache or optional Atlas audit history. | Those operations do not erase grants' constraints, pending cooldowns or Vault protections. Browser-data wiring is a later adapter test. |
| P06 | Record decisions involving a URL with sensitive parameters. | Persist only approved minimal audit data; no passwords, tokens, request bodies, cookies or complete authentication URLs. Audit scope and retention depend on Q11. |

## Later browser conformance tests

These are integration obligations for the selected adapter, not reasons to add browser types to Core or build both frontends now. First resolve Q12: which actions does that frontend actually promise to govern?

1. Exercise each governed entry point: direct opening, redirects, popups, history/restore and applicable embedded documents. Compare decisions with the same Core fixtures. A root-document hook alone is not proof of frame coverage.
2. Test allowed destinations and ordinary login continuation as positive cases. A sign-in page loading is not proof that a complete authenticated session works. Use dedicated test accounts only where necessary.
3. Test a successful Greylist flow through actual opening. Distinguish grant creation, attempted navigation, redirect classification and visible rendering. Keep the original intended destination in adapter state without persisting credential-bearing URLs in Core.
4. Verify expired/revoked access is actually removed from the governed visible context. Failed, cancelled, hung or crashed removal must not be reported as successful while content remains active. Concrete recovery is platform-specific.
5. Where the adapter claims to cancel a denied redirect before submission, independently observe a test server, including method/body-preserving redirects. An error page alone is not evidence that a request body was withheld. Do not turn this into a universal no-network-contact guarantee.
6. Verify process/background suspension does not reset waits or create confirmation. Test the selected grant-session semantics explicitly.
7. Verify page messages cannot mutate policy, supply authoritative time/context, or call privileged host functions. Shared Core code does not itself protect an unsafe adapter bridge.
8. Verify supporting hosts are absent from the ordinary destination list while permitted controlled login steps can still appear, as required by D4.

Browser permission prompts, chooser behavior, storage isolation and safe runtime configuration remain adapter/engine concerns. Review them when integrating a browser; do not import every historical Zenith capability restriction into the initial Core acceptance suite.

## Open questions and evidence

For each adopted conditional scenario, record the resolved foundation question and test name. Report Core unit tests, real-storage tests and native/browser tests separately. List untested adapter behaviors explicitly rather than implying that passing Core tests proves email-account safety.
