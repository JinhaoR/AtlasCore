# Atlas Core foundation

Status: design handover, 2026-09-24. No Atlas implementation exists.

## How to read status labels

**Requirements** describe the user's requested product and its essential correctness properties. **Decisions already made** record explicit direction or clarification. **Proposed architecture** records recommendations that still need adoption. **Open questions** identify behavior that must not be guessed during implementation.

An assistant recommendation is not user approval. Historical Zenith behavior does not resolve an Atlas open question. Later decisions should update this document with their date, rationale and effect on tests.

## Requirements

### R1. Intentional access

The starting point is default-deny visible access. Users deliberately choose their ordinary destinations beforehand. A Ulysses contract introduces time and explicit reconsideration between an impulse and exceptional access or a lasting change to restrictions.

This is not a general-purpose focus toggle that immediately disables the access model.

### R2. Three site classes

- **Whitelist:** durable permission for ordinary access under the rule's defined scope.
- **Blacklist:** exclusion that overrides Whitelist membership, temporary grants and supporting exceptions for actions governed by Atlas.
- **Greylist:** the remainder, including unknown sites. It need not be a stored list.

The scope of a site rule must be explicit and consistent. Hostname matching must not use arbitrary substring comparisons. Blacklist precedence does not imply that every background connection is submitted to Atlas.

### R3. Temporary access is not durable permission

A Greylist exception requires an explicit start, a cooldown and a later explicit confirmation. Time passing alone must not grant access. An Access Grant has a defined scope and expiry, does not reclassify the site, and cannot override the Blacklist.

Closing a prompt or restarting a frontend must not let the user skip the required wait or replay an already consumed confirmation. The exact lifetime of active grants across restart remains Q3.

### R4. Vault protects commitments

The **Vault** is the concept governing protected changes to durable access rules. It is not a website-password store. Proposing or previewing a change does not apply it. The previous policy remains active until the required wait and explicit confirmation complete successfully.

Changes must be reviewed as concrete consequences. Changing the proposal must not reuse a confirmation for different contents. A proposed reduction to a protective delay must not take effect early enough to bypass the delay already protecting that change.

### R5. A browser-independent decision engine

Core answers: given a requested action, policy, access state and time, what should happen? Outcomes include allow, deny, wait and require confirmation. These are semantic outcomes; exact API names are proposed separately.

Core must be testable without a graphical application or browser. It knows no tabs, windows, browser events, HTML, JavaScript execution APIs or authentication-provider protocols.

### R6. Normal browsing remains browser functionality

Atlas controls intentional visible access. An authorized website's ordinary background requests are not failures merely because their destinations are absent from the Whitelist.

The browser engine and websites handle JavaScript, cookies, origin isolation, TLS and normal authentication. The interface maintains a safe integration with that engine. Atlas Core does not reproduce those mechanisms.

### R7. Supporting-domain knowledge

The product includes a reviewed catalog of supporting domains so known web complexity need not be exposed as ordinary destinations. It should help authorized interactions function without requiring a complete network-dependency model.

Supporting access cannot become an automatic way to defeat an explicit Blacklist. Website traffic is evidence, not permission. A request for an unknown host does not prove a legitimate dependency and must not automatically add that host to policy.

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
| D6 | This handover contains documentation only. | Explicit current task. No language/tooling or implementation has been installed. |

D4 settles presentation intent. It does not settle every rule for direct visits, supporting scopes, duration or catalog activation. Those details remain open below. "Trusted supporting endpoint" must never mean trusted page code or native privileges.

## Architectural separation

| Layer | Owns | Does not own |
| --- | --- | --- |
| Browser/interface | Translate platform actions, identify trusted context, present decisions, execute or cancel actions, manage existing displayed content. | Independent Whitelist, grant or Vault decisions. |
| Atlas Core | Classification, protected transitions, scope/expiry checks, policy decisions and state-validation rules. | Rendering, browser interception, provider login, network filtering or platform storage calls. |
| Storage implementation | Load, commit and recover data according to an explicit contract; platform-specific durability and concurrency. | Permission decisions or inventing recovery policy. |
| Browser engine and website | Normal web execution, sessions, transport security, authentication protocols and origin enforcement. | Atlas's Ulysses contract. |

One trusted owner per policy instance should mediate state mutations. This is a proposed implementation arrangement, not a guarantee that a library can defend itself from a malicious caller running with full host privileges.

## Deliberately outside Core

- Network request filtering, DNS rules, WebSocket filtering, gateways, proxies or OS firewall enforcement.
- TLS/certificate handling, cookie inspection, session-token storage, OAuth/SAML flows or provider-specific login detection.
- Browser capability implementation, file dialogs, adblocking, extension installation or browser profile management.
- UI design, tab/window lifecycles, page scripting, browser event handlers and browser launch configuration.
- Full service dependency graphs, ownership/attribution graphs, reference-counted removal, automatic dependency discovery or remote catalog updates.
- A cloud account system, cross-application synchronization, kiosk enforcement or prevention of deliberate removal by the device owner.

uBlock and similar tools are separate content-filtering components, not substitutes for the browser engine's security or safe host integration. A small Core does not certify a future browser adapter for primary-account use.

## Proposed architecture

| ID | Recommendation, not yet adopted | Why |
| --- | --- | --- |
| P1 | One portable TypeScript package. | Direct reuse in the two intended JavaScript runtimes. |
| P2 | Exact normalized host matching initially, with no implicit aliases, wildcards or parent scopes. | A small, explainable first policy surface. |
| P3 | Pure evaluation plus explicit command transitions, with a small commit coordinator. | Prevent UI timing and side effects from determining access. |
| P4 | Supporting use is contextual and does not automatically grant direct ordinary access. | Preserve D4 without creating an unrestricted hidden Whitelist. |
| P5 | Persist active grants until fixed expiry, alongside pending waits. | Frontend/background suspension should not silently redefine a grant. This differs from historical Zenith session-only grants. |
| P6 | One pending Vault proposal initially; bind it to a policy revision and frozen contents. | Reduce concurrency and confirmation ambiguity. |
| P7 | Separate schema, storage and policy revisions; atomically commit complete transitions. | Make compatibility and state races explicit. |
| P8 | Invalidate grants and supporting contexts on any committed policy revision. | A simple conservative starting rule; its UX cost requires review. |
| P9 | Local curated JSON catalog with review evidence and an explicit activation/update rule. | Keep supporting data inspectable without adding online discovery. |

Detailed recommendations belong in [architecture.md](architecture.md), not in the requirements above.

## Open questions

| ID | Question | Resolve before |
| --- | --- | --- |
| Q1 | Adopt TypeScript? Which supported runtime targets, package manager and test tooling? | Scaffolding code. |
| Q2 | What identifies a site: exact host, host plus scope, or origin? How are `www`, IDNs, ports, IPs and explicit subdomains treated? Which input schemes are accepted? | Matching and evaluator implementation. |
| Q3 | Do grants survive application restart until expiry, end at a true browsing-session boundary, or follow another lifecycle? Background suspension is not automatically a new session. | Grant persistence. |
| Q4 | For a supporting host, what authorizes a continuation and what happens on a direct visit? Is support global within an authorized interaction or service-specific? How are embedded documents mapped? | Supporting-rule implementation and adapter mapping. |
| Q5 | How is a bundled supporting catalog activated? Which changes require Vault confirmation? How are user-specific endpoints and corrections handled? | Active catalog permissions. |
| Q6 | What are production wait durations, minimums, grant duration and confirmation-expiry rules? | Temporal workflows. Do not inherit Zenith's short development values. |
| Q7 | Can Blacklist entries be removed through protected changes? Do tighter restrictions use the same delay? Are any external mandatory lists wanted at all? | Vault operations. Historical Zenith rules do not answer these questions. |
| Q8 | What happens to pending waits, grants and proposals when policy changes? Is P8 acceptable, or should unaffected access remain? | Revision/revalidation behavior. |
| Q9 | What clock anomalies can be detected locally, and what recovery is appropriate? Does elapsed time while the app is closed count? | Clock and persistence semantics. |
| Q10 | What are initialization, corrupt-state recovery, backup and future schema-migration rules? | A durable storage adapter. |
| Q11 | Which audit events are useful, how long are they retained, and how can they be removed without resetting policy? | Persisted history. |
| Q12 | Which frontend is implemented first, and exactly which visible/embedded actions does it govern? | Browser adapter work, not basic Core scaffolding. |

Do not answer all twelve questions before doing anything. Resolve the questions that block the current small milestone, document the answer and test it. Optional future features remain deferred.

## Terminology and limits

Use Whitelist, Blacklist, Greylist, Access Grant, Policy Change and Vault consistently. Greylist is a default classification; a grant is not a temporary Whitelist entry. "Sphere" was a Zenith presentation term and need not become a Core type or stored state.

Policy state means the user's Atlas commitments, not whether the user is logged into a website. Core cannot infer login success or authentication intent from a hostname or a page message.

Sharing a library does not share storage between Firefox and Electron. A decision engine cannot itself cancel a browser event, erase an authenticated page, establish trustworthy external time or prevent its host from ignoring a decision. These limits are explicit, not reasons to add unrelated infrastructure.
