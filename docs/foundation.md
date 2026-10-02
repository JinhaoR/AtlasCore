# Atlas Core foundation

Status: Milestones 1 through 3, D11 Journeys, and D13 aggregate planning implement pure domain logic. D14 adds a controller with repository/clock ports. D15 authorizes the first Firefox adapter and transactional repository; its scope and evidence are tracked in the adapter document. Context Whitelist and broader models remain deferred.

## How to read status labels

**Requirements** describe the user's requested product and its essential correctness properties. **Decisions already made** record explicit direction or clarification. **Proposed architecture** records recommendations that still need adoption. **Open questions** identify behavior that must not be guessed during implementation.

An assistant recommendation is not user approval. Historical Zenith behavior does not resolve an Atlas open question. Later decisions should update this document with their date, rationale and effect on tests.

## Requirements

### R1. Intentional access

The starting point is default-deny visible access. Users deliberately choose their ordinary destinations beforehand. A Ulysses contract introduces time and explicit reconsideration between an impulse and exceptional access or a lasting change to restrictions.

This is not a general-purpose focus toggle that immediately disables the access model.

### R2. Three site classes

- **Whitelist:** durable permission for ordinary access under the rule's defined scope.
- **Blacklist (`Policy.blacklist`):** explicit/manual exclusion that overrides Whitelist membership, temporary grants, and Journey authorization for actions governed by Atlas. D17's separately managed upstream data follows the [managed policy contract](managed-policy.md); it is not inserted into this list.
- **Greylist:** the remainder, including unknown sites. It need not be a stored list.

The scope of a site rule must be explicit and consistent. Hostname matching must not use arbitrary substring comparisons. Blacklist precedence does not imply that every background connection is submitted to Atlas.

### R3. Temporary access is not durable permission

Ordinary intentional Greylist access requires an explicit start, a cooldown and a later explicit confirmation. Time passing alone must not grant access. An Access Grant has a defined scope and expiry, does not reclassify the site, and cannot override the Blacklist. D11, narrowed by D18, separately authorizes bounded Journey access to intermediate destinations while attempting to reach a Pure Whitelist root; it creates no Access Grant.

Closing a prompt or restarting a frontend must not let the user skip the required wait or replay an already consumed confirmation. D9 adopts fixed grant expiry across reload; actual durable restart protection still requires storage integration.

### R4. Vault protects commitments

The **Vault** is the concept governing protected changes to durable access rules. It is not a website-password store. Proposing or previewing a change does not apply it. The previous policy remains active until the required wait, explicit confirmation, and successful atomic commit complete.

Changes must be reviewed as concrete consequences. Changing the proposal must not reuse a confirmation for different contents. A proposed reduction to a protective delay must not take effect early enough to bypass the delay already protecting that change.

### R5. A browser-independent decision engine

Core answers: given a requested action, policy, access state and time, what should happen? Outcomes include allow, deny, wait and require confirmation. These are semantic outcomes; exact API names are proposed separately.

Core must be testable without a graphical application or browser. It knows no tabs, windows, browser events, HTML, JavaScript execution APIs or authentication-provider protocols.

### R6. Normal browsing remains browser functionality

Atlas controls intentional visible access. An authorized website's ordinary background requests are not failures merely because their destinations are absent from the Whitelist.

The browser engine and websites handle JavaScript, cookies, origin isolation, TLS and normal authentication. The interface maintains a safe integration with that engine. Atlas Core does not reproduce those mechanisms.

### R7. Pure Whitelist accessibility

Pure Whitelist destinations must be usable when reaching them requires intermediate domains. D11 replaces the former catalog requirement with a temporary Journey bound to a root destination, one context, a fixed deadline, and a hop limit. A global supporting-domain database is excluded; Atlas does not maintain internet dependency knowledge.

Blacklist still overrides every governed navigation. Under D18, unfamiliar intermediate hosts can receive bounded Journey authorization only with trusted continuation evidence, without becoming trusted or changing policy. This authorizes a limited attempt, not a claim that a host is necessary or safe. Context Whitelist, learned relationships, trust graphs, and link inheritance remain deferred.

### R8. Reliable state and explanations

Invalid or unavailable authorization state must not result in an allow fallback. Damaged initialized storage must not silently become an unrestricted fresh installation. An operation must not be reported as committed before its required persistence succeeds.

The interface needs stable decision reasons and the relevant deadlines. Presentation state does not supply authorization. Browser data and Atlas policy data have distinct lifecycles; clearing cookies must not become a cooldown or Vault reset.

### R9. Keep the new project small

Build a fresh application-independent core using Zenith as a source of lessons. Do not migrate its implementation directly. Additional systems must solve an agreed Atlas requirement rather than reproduce historical machinery.

## Decisions already made

| ID | Decision | Basis |
| --- | --- | --- |
| D1 | Atlas Core is a fresh project; Zenith is a lessons source. | Explicit user direction. |
| D2 | The intended consumers include Firefox and Electron, with future interfaces possible. | Explicit user direction; neither adapter is the first Core deliverable. |
| D3 | Visible intentional access is the boundary; universal network egress control is excluded. | Repeated user clarification. |
| D4 | Supporting domains are hidden from the normal site list but may appear during controlled login redirects or popups. | User explicitly selected: "Hidden from the site list; permit controlled login steps (recommended)". |
| D5 | Core must not implement an authentication system. | Explicit new-project exclusion; cooldown and confirmation are the basic friction. |
| D6 | The original handover contained documentation only. | Historical status on 2026-09-24; superseded by D7 for implementation status. |
| D7 | Implement Milestone 1 as one pure TypeScript package: models, normalization, validation, evaluation, and tests. | Explicit user direction on 2026-09-26. No browser or state-changing workflows authorized in this milestone. |
| D8 | Use exact normalized hostname matching, without automatic aliases or parent/subdomain permissions. | User selected hostname-based matching and limited initial URL handling on 2026-09-26. The bounded input contract below records implementation choices within that scope. |
| D9 | Adopt the Greylist workflow for Milestone 2: explicit Start, frozen wait and confirmation window, explicit Confirm, scoped grants with fixed expiry, cancellation, and revision invalidation. Implement pure transitions with explicit time only. | User approved the workflow design and requested implementation on 2026-09-26. One live request or grant per hostname; elapsed supplied time counts across reload. No persistence, browser, Vault, or supporting implementation is authorized in this milestone. |
| D10 | Adopt the Vault workflow for Milestone 3: one frozen pending proposal, review, explicit confirmation preparation, a complete commit candidate, cancellation, expiry, and staleness on any policy revision change. User-managed Whitelist/Blacklist additions and removals use the same positive configured wait and bounded confirmation window. Editing requires cancellation and a new wait; reload preserves deadlines; a definite failed write requires fresh explicit confirmation. | User requested implementation of the approved design on 2026-09-26. Pure TypeScript domain logic only. Candidate generation does not activate policy or acknowledge persistence; production durations, the coordinator, storage, and adapters remain outside this milestone. |
| D11 | Add a pure Journey module for Pure Whitelist accessibility. Allow unfamiliar intermediate top-level destinations inside one active, context-bound attempt, subject to Blacklist, a fixed deadline, hop limit, and current policy revision. No policy entries or grants are created. | User requested documentation followed by Core-only implementation on 2026-09-28, including allowed intermediate navigation tests. This adopts the proposed bounded exception without a supporting-domain database. Browser integration, Context Whitelist, learned relationships, and link inheritance are excluded. |
| D12 | Design the framework-independent integration boundary before any browser adapter: public API, responsibilities, operations/results, state ownership, persistence, and failures. | User requested architecture documentation on 2026-09-28. This is a design task; proposed facade/controller/port contracts are not implemented or automatically adopted as final API. Core must remain independent of platform APIs, browser storage, cookies, and authentication. |
| D13 | Implement the aggregate Atlas snapshot, complete validation, and pure operation planner combining Policy, Access, Vault, and Journey under the documented precedence. | User authorized this Core-only milestone on 2026-09-29. Explicit time and trusted domain context; no storage, real clock, controller, browser events, or adapters. The bounded public contract is recorded in the architecture before coding. |
| D14 | Implement a framework-independent controller over D13 with repository/clock interfaces, serialized operations, commit-before-publication, and recovery tests using fake storage. | User authorized this next milestone on 2026-09-29. Browser integration, UI, real storage backends, and browser-event correlation remain excluded. |

**D15 (2026-09-30):** The user authorized a minimal Firefox WebExtension consuming the existing Core package, including extension storage, top-level navigation, Journey paths, development UI, and adapter/native testing. The [Firefox adapter contract](firefox-adapter.md) records the architecture before coding. It narrows Q10 to explicit one-time setup, selects the first Q12 frontend/entry points, and documents the request execution protocol adopted over D14. Production timing, comprehensive browser coverage, and general recovery remain open. Earlier milestones' browser exclusions remain historical scope limits.

D4 records presentation intent for intermediate domains. D11/D18 supply their current Journey authorization without a catalog. Permitting an intermediate page never gives its code privileged access to Atlas commands.

**D16 (2026-09-30):** The user authorized improvement of the Firefox prototype interface, normal browsing interactions, bounded diagnostics, and public real-website checks. The [adapter document](firefox-adapter.md#prototype-interface-and-diagnostics-d16) owns these extension-only refinements. Core rules remain unchanged; Context Whitelist and authentication/provider databases remain excluded.

**D17 (2026-10-01):** The user authorized curated service defaults with explicit aliases and a separately managed, efficient StevenBlack deny list. Manual Blacklist still overrides Whitelist; explicit Whitelist overrides only managed deny data. The [managed policy contract](managed-policy.md) owns precedence, compilation, cache/refresh, offline bootstrap, and tests. No global apex/`www` equivalence or wildcard matching is introduced.

#**D18 (2026-10-01):** For first-run stabilization the user approved automatic Whitelist Journey initiation regardless of navigation origin, unfamiliar-host continuation restricted to correlated HTTP redirect chains, and completion on destination document arrival. This narrows D11's broad bounded exception and supersedes D15's explicit-UI-only initiation. Cross-host links/forms without redirect evidence use normal policy. The user also approved one frozen Greylist request/grant for a service's explicitly declared equivalent aliases, listed before confirmation. Core retains exact-host matching, one wait/confirmation/commit and fixed expiry; there is no global `www` pairing. The [Journey/access architecture](architecture.md) owns these semantics; [stabilization findings](firefox-stabilization.md) record causes, evidence and deferred requirements.

**D19 (2026-10-01):** The user accepts D18's genuine correlated HTTP redirect exception and its documented residual risk from a deliberately Whitelisted server. Atlas prevents easy impulsive escape; it does not promise an adversarial boundary against a determined owner or malicious Whitelisted website. Journey remains stable unless actual use produces a reproducible failure or demonstrated practical bypass. Productization adds per-tab Journey presentation, local active-destination search, protected timing configuration through Vault, and a homepage/settings structure. The [productization contract](productization.md) owns the implementation plan and settings/migration semantics. No authentication inference, transit graphs, learned infrastructure or AUTH_CONTINUATION is authorized.

**D20 (2026-10-01):** The reference-guided Firefox interface adds a calm sidebar, destination cards, explicit local pins and clearer Settings/Vault review. Pins organize effective active destinations and carry no authorization. The [interface document](ui-design.md) owns presentation behavior and evidence. D18/D19 domain semantics, exact-host scope and persistence-before-permission remain unchanged.

**D21 (2026-10-02):** Concrete dogfooding authorizes stronger Journey visibility and explicit recovery after interruption. The adapter projects saved Journey state into a passive per-tab indicator and offers root retry from verified ended records. Retry enters the ordinary navigation gate with fresh Core terms; it never resumes an intermediate or revives an ended attempt. The [reproduction and recovery contract](firefox-journey-recovery.md) owns findings, browser limitations and evidence. D18 and Core semantics remain unchanged.

## Milestone 1 input contract

Recorded 2026-09-26 to keep the first evaluator small and explicit:

- `SiteTarget` contains one `hostname` string. `Policy` contains only `whitelist` and `blacklist`, both required arrays of bare hostname strings. An explicitly supplied pair of empty lists makes all valid targets Greylist; missing or malformed lists never become empty defaults.
- Requested targets may be bare ASCII hostnames, absolute HTTP(S) URLs, or `SiteTarget` data objects. A `SiteTarget.hostname` must be a bare hostname. Policy entries cannot be URLs or host-and-port strings.
- Normalize surrounding whitespace, ASCII letter case, and one terminal DNS root dot. Match the resulting complete hostname, with no substring matching, `www` pairing, wildcards, or implicit subdomains. Requests and policy entries use the same hostname normalization.
- A hostname permission applies across accepted HTTP(S) schemes, ports, paths, queries, and fragments. Those URL components do not become policy scope or appear in decisions.
- Reject malformed names, URL userinfo, unsupported schemes, relative URLs, Unicode hostname input, and IP literals/shorthand. Ordinary ASCII DNS labels, including valid ASCII `xn--` representations, are accepted; automatic conversion of Unicode input and additional URL forms are deferred.
- Validate every policy entry before deciding access. Reject an entire malformed policy and unsupported policy fields; do not keep a permissive subset. Return `DENY` with a stable invalid-input reason. A valid Blacklist match overrides Whitelist membership. Otherwise return `ALLOW` for Whitelist and `GREYLIST` for the remainder.
- Both public functions consume plain data. The evaluator copies normalized values and does not mutate inputs, read time, or retain state. A `GREYLIST` decision does not authorize access or start a cooldown.

Development uses npm, TypeScript 6.0.3, and Node.js 24's built-in test runner. The package emits ES2022 JavaScript modules and declarations, uses the standard `URL` parser for accepted URL syntax, and has no runtime dependencies. Only Node.js 24.12.0 has been exercised so far; future frontend/runtime compatibility requires its own tests. These are routine tooling choices under D7, not browser integration decisions.

### Milestone 2 contract and limits

- A Greylist grant overlays authorization without changing `Policy` or the result of policy-only `evaluate`. `evaluateAccess` applies current policy and the temporal overlay through the same core rules.
- Start is the initial deliberate action. No automatic grant occurs at readiness; only Confirm may consume a pending request and create a grant, together in one candidate state. The full [workflow contract](architecture.md#greylist-workflow-milestone-2) owns deadline and transition details.
- Configuration supplies positive integer wait, confirmation-window, and grant durations. Terms are frozen at Start; production values are not selected by this milestone.
- The trusted caller supplies current policy, a nondecreasing policy revision, the latest complete access state, and explicit integer time. Every policy edit must advance its revision. Any mismatch invalidates existing pending requests and grants; newer Whitelist rules can still authorize ordinary access.
- All valid-context results return a fresh `nextState`, including rejected commands. Evaluations and rejections advance only time/revision observation metadata; they never create grants or alter request/grant records. Callers must retain this state to prevent an observed expiry from becoming usable after a backward time input. This is a pure state contract, not a real-clock or persistence implementation.
- IDs come from a monotonic counter inside the state. Reload must preserve that counter, consumed/cancelled request removal, timestamps, and observation metadata. Invalid state never invokes fresh initialization automatically.
- Domain transition success means a complete candidate state was computed. A later coordinator must atomically commit it before durable success or newly granted access is exposed. Real crash/retry/concurrency guarantees, physical clock validation/recovery, and detection of whole-snapshot rollback are outside Milestone 2 evidence.

## Architectural separation

| Layer | Owns | Does not own |
| --- | --- | --- |
| Browser/interface | Translate platform actions, identify trusted context, present decisions, execute or cancel actions, manage existing displayed content. | Independent Whitelist, grant or Vault decisions. |
| Atlas Core | Classification, protected transitions, scope/expiry checks, policy decisions and state-validation rules. | Rendering, browser interception, provider login, network filtering or platform storage calls. |
| Shared Core controller (D14) | One authoritative state owner, serialized planner operations, and commit-before-publication through injected ports. | Platform event mapping, native browser objects, UI, or concrete storage APIs. |
| Storage implementation | Load, commit and recover data according to an explicit contract; platform-specific durability and concurrency. | Permission decisions or inventing recovery policy. |
| Browser engine and website | Normal web execution, sessions, transport security, authentication protocols and origin enforcement. | Atlas's Ulysses contract. |

The proposed [integration boundary](architecture.md#framework-independent-integration-boundary) specifies one trusted owner per policy instance and distinguishes pure plans, committed authority, and browser effects. The host constructs this owner and supplies persistence, time, and trusted event mapping. A library cannot defend itself from a malicious caller running with full host privileges.

## Deliberately outside Core

- Network request filtering, DNS rules, WebSocket filtering, gateways, proxies or OS firewall enforcement.
- TLS/certificate handling, cookie inspection, session-token storage, OAuth/SAML flows or provider-specific login detection.
- Browser capability implementation, file dialogs, adblocking, extension installation or browser profile management.
- UI design, tab/window lifecycles, page scripting, browser event handlers and browser launch configuration.
- Full service dependency graphs, ownership/attribution graphs, reference-counted removal, automatic dependency discovery or remote catalog updates.
- A cloud account system, cross-application synchronization, kiosk enforcement or prevention of deliberate removal by the device owner.

uBlock and similar tools are separate content-filtering components, not substitutes for the browser engine's security or safe host integration. A small Core does not certify a future browser adapter for primary-account use.

## Proposed architecture

P1 (one TypeScript Core package) and P2 (exact normalized host matching) are adopted through D7/D8. P3's pure evaluation/transitions, P5's fixed-expiry lifetime across reload, and P8's grant invalidation are adopted through D9. P6's Vault workflow is adopted through D10. D13/D14 add aggregate planning and commit coordination; D15 adds a narrow Firefox adapter and backend. Broader orchestration proposals remain separate from that implemented scope.

| ID | Remaining proposal or implementation work | Why |
| --- | --- | --- |
| P3 | D13/D14 implement aggregate validation, planning, and shared commit coordination. D15 implements Firefox request correlation; the generic runtime ledger remains proposed. | Keep all adapters on the same decisions and publish authority only after required commits. |
| P4 | Superseded for the current scope by D11's bounded Journey. Broader supporting-context design is deferred. | Solve Pure Whitelist accessibility first. |
| P5 | D15 persists active grants and waits and tests a real background reload without renewing their deadlines. Physical crash/power-loss durability remains untested. | Preserve fixed deadlines and distinguish tested restart behavior from stronger durability claims. |
| P7 | D14 separates schema, storage and policy revisions. D15 supplies transactional IndexedDB and reconciliation receipts with separate backend evidence. | Make compatibility and state races explicit. |
| P8 | Invalidate Journeys on any policy revision change under D11. | Keep runtime authorization tied to current commitments. |
| P9 | Withdrawn by D11. No supporting-domain database is required or authorized. | Avoid maintaining global dependency knowledge. |

Detailed recommendations belong in [architecture.md](architecture.md), not in the requirements above.

The [Milestone 2 Greylist workflow](architecture.md#greylist-workflow-milestone-2) records the adopted domain behavior and the future persistence obligations separately. D9 resolves G01's initial-confirmation wording: explicit Start is that initial action.

The [Milestone 3 Vault workflow](architecture.md#vault-workflow-milestone-3) owns the adopted proposal, review, confirmation-preparation, cancellation, and revision contract. `prepareVaultCommit` returns its candidate while retaining active policy and the pending proposal in ordinary context state. D13 wraps the complete aggregate; D14 coordinates publication after a verified atomic commit. Domain tests model candidate adoption, and controller tests exercise fake repository behavior; neither proves a production backend's durability.

The [Journey contract](architecture.md#journey-workflow) owns the D11 runtime model, navigation boundaries, and implementation choices. Existing policy classification, access grants, and Vault APIs keep their meanings. Pure Whitelist is the existing `Policy.whitelist`, subject to Blacklist precedence.

The [aggregate planner contract](architecture.md#aggregate-planner-d13) owns D13's pure operations and distinction between observations and proposed transitions. The [controller contract](architecture.md#atlas-controller-d14) owns D14's implemented repository/clock ports, serialized handling, and recovery protocol. The broader [integration design](architecture.md#framework-independent-integration-boundary) retains future runtime correlation and adapter obligations. These preserve hostname-wide grants, per-context Journeys, and existing policy semantics. Real durability remains unverified.

## Open questions

| ID | Question | Resolve before |
| --- | --- | --- |
| Q1 | Resolved for Milestone 1 by D7. D15 exercises Firefox 157.0; other frontend/runtime versions need their own validation. | Revisit when selecting another adapter/runtime. |
| Q2 | Resolved for the initial evaluator by D8 and the input contract above. D17/D18 add explicitly declared service aliases while retaining exact-host evaluation. Unicode input, IP targets, inferred aliases, and additional URL forms remain deferred. | Resolve before extending supported target forms or scope. |
| Q3 | Resolved: retain original fixed expiry across reload, with supplied elapsed time counting while closed. D15 tests real background reload; physical crash durability remains untested. | Further backend lifecycle testing. |
| Q4 | D11/D18 authorize unfamiliar intermediates only with trusted continuation evidence in an active Journey bound to one top-level context. D15 uses one fresh context per Firefox tab, without popup inheritance; embedded documents are outside the gate. | Broader mapping requires explicit future scope. |
| Q5 | Catalog activation is superseded by D11. Context Whitelist and other broader models are deferred. | A future explicit request; no catalog work is planned. |
| Q6 | Greylist/Vault timing and Journey lifetime/hop limits are explicit positive configuration frozen at creation. Expiry is exclusive. Which production values and protective minimums should be used? | Production configuration; fixture values are not defaults. |
| Q7 | Resolved by D10 for user-managed policy: Whitelist/Blacklist additions and removals, including tighter changes, use the same protected flow. D17 separately resolves managed StevenBlack data with explicit Whitelist exceptions; other external mandatory-list semantics remain undecided. | Other future mandatory-list features. Historical Zenith rules do not supply authority. |
| Q8 | Any newer policy revision invalidates pending requests, grants, Vault proposals, and Journeys. Proposals are not rebased and Journeys are not restarted. | Validate future integration against this rule. |
| Q9 | D15 injects the host wall clock and persists Core checkpoints. Clock rollback fails closed. Trusted-time recovery and detection of whole-state rollback remain open; there is no time server. | Stronger production clock/recovery requirements. |
| Q10 | D15 adopts explicit one-time setup in an empty repository and blocks corrupt/missing initialized records. D19 explicitly migrates known valid schema-1 snapshots atomically. Broader backup/recovery and future migrations remain open; no destructive reset UI is provided. | Recovery or schema evolution. |
| Q11 | Which audit events are useful, how long are they retained, and how can they be removed without resetting policy? | Persisted history. |
| Q12 | D15 selects Firefox and exposed top-level HTTP(S) navigation, with later observation of retained/restored content. Protected/internal pages, private browsing, downloads, non-HTTP schemes, and embedded content are outside the slice. | Broader browser coverage or another frontend. |
| Q13 | Resolved by D19: retain D18, accept the documented bounded HTTP redirect risk and preserve destination-arrival completion. No broader continuation is authorized. | Revisit only for a reproducible failure or practical bypass during actual use. |

Resolve the questions that block the current small milestone, document the answer and test it. Optional future features remain deferred.

## Terminology and limits

Use Whitelist, Blacklist, Greylist, Access Grant, Policy Change and Vault consistently. Greylist is a default classification; a grant is not a temporary Whitelist entry. "Sphere" was a Zenith presentation term and need not become a Core type or stored state.

Policy state means the user's Atlas commitments, not whether the user is logged into a website. Core cannot infer login success or authentication intent from a hostname or a page message.

Sharing a library does not share storage between Firefox and Electron. A decision engine cannot itself cancel a browser event, erase an authenticated page, establish trustworthy external time or prevent its host from ignoring a decision. These limits are explicit, not reasons to add unrelated infrastructure.
