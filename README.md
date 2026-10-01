# Atlas Core

An independent decision library for intentional web access. Core implements pure domain workflows and a framework-independent controller that coordinates commits through injected interfaces.

Atlas Core is a decision engine for intentional access to the web. The user chooses an ordinary set of accessible destinations, requests temporary access to other destinations through deliberate friction, and changes long-term commitments through a protected workflow.

Atlas Core is not a browser, a firewall, an authentication system, or an ad blocker. Browser interfaces render pages and enforce its decisions. The browser engine and websites continue handling ordinary web security and authentication.

## Requirements

- Preserve the Ulysses contract philosophy: deliberate choices made beforehand should constrain impulsive access later.
- Use Whitelist, Blacklist and default Greylist concepts, scoped temporary Access Grants, cooldowns and explicit confirmation.
- Protect durable policy changes through the Vault concept.
- Keep the decision engine independent of Firefox, Electron and all browser mechanics.
- Support Pure Whitelist accessibility through bounded Journeys, without a global supporting-domain database.
- Start fresh. Do not copy Zenith's implementation or accumulated architecture.

The authoritative description of requirements is [foundation.md](docs/foundation.md).

## Decisions already made

This is a new project. Zenith supplies lessons, not a dependency or a migration source. A first Firefox development adapter now consumes Core; Electron and other interfaces remain future consumers.

Supporting domains are **hidden from the normal site list, but may be displayed during controlled login steps**. They are not required to remain literally invisible during a login redirect or popup.

## Implementation

One TypeScript Core package in `packages/core`, with no runtime dependencies. Policy evaluation returns `ALLOW`, `DENY`, or `GREYLIST`. The access workflow adds pending requests, waits, confirmation windows, explicit confirmation, cancellation, and expiring grants. Vault adds frozen proposals, review, and commit preparation for policy changes. Journeys authorize bounded intermediate navigation toward a Whitelisted root. The controller serializes these operations and coordinates saves through repository/clock interfaces. Core contains no concrete clocks, timers, storage backends, or browser APIs. The separate `extension/` package supplies those Firefox adapters under D15.

The original `SiteTarget`, `Policy`, `Decision`, `normalizeTarget`, and `evaluate` API is unchanged. Invalid input returns `DENY` with `INVALID_TARGET` or `INVALID_POLICY`; invalid normalization returns `null`. `evaluate` examines policy classification only: a temporary grant never makes a Greylist hostname Whitelisted.

```ts
import { evaluate, type Policy } from "@atlas/core";

const policy: Policy = {
  whitelist: ["mail.example"],
  blacklist: ["blocked.example"],
};

evaluate("https://MAIL.EXAMPLE/messages", policy);
// { outcome: "ALLOW", reason: "WHITELISTED", target: { hostname: "mail.example" } }

evaluate("unknown.example", policy);
// { outcome: "GREYLIST", reason: "UNLISTED", target: { hostname: "unknown.example" } }
```

Targets may be bare ASCII hostnames, HTTP(S) URLs, or `SiteTarget` objects. Policy entries are bare hostnames. Matching is exact after normalization; `www` and subdomains remain distinct. The complete initial input contract and deferred forms are owned by [foundation.md](docs/foundation.md#milestone-1-input-contract).

### Greylist access workflow

Each access operation takes an explicit context: `{ policy, policyRevision, state, now }`. `now` is an injected nonnegative safe integer in milliseconds. No function reads a real clock. Start also takes `{ waitMs, confirmationWindowMs, grantDurationMs }`; each duration must be a positive safe integer. There are no production defaults.

| Function | Result |
| --- | --- |
| `createAccessState()` | A fresh empty domain state. Never use it to recover invalid existing state. |
| `startAccess(target, context, timing, scopeHostnames?)` | Creates a pending request, or returns its existing unexpired request with unchanged terms. |
| `evaluateAccess(target, context)` | Returns a decision and observation state. Pending requests yield `WAIT` or `REQUIRE_CONFIRMATION`; time never creates a grant. |
| `confirmAccess(requestId, context)` | Returns one complete candidate state containing the grant and no longer containing the consumed request. |
| `cancelAccess(requestId, context)` | Removes the live pending request. Its ID cannot confirm later. |

Transitions return `{ ok, ... , nextState }`; evaluations return `{ decision, nextState }`. Use the returned `nextState` in subsequent calls whenever it is non-null, including rejected commands. It preserves the latest accepted time and policy revision; rejected commands change no pending request or grant. Invalid context returns `nextState: null`, never fresh permissive state.

Increment the trusted `policyRevision` whenever policy changes, even if a later edit restores earlier rules. A revision change invalidates existing requests and grants. Returning to an older revision or time than the retained snapshot fails closed. These guards rely on retaining the latest state; they cannot detect restoration of an older complete snapshot.

`ok: true` means the pure domain transition succeeded, not that anything was saved. The controller below commits complete candidates through an injected repository before reporting workflow success. Standalone access functions provide no persistence or concurrency guarantees. Serialization tests simulate retaining the complete state across reload, including IDs and timestamps.

D18 adds optional frozen `scopeHostnames` to pending requests and their single grants. Omitted scope means the original exact hostname. Trusted hosts may declare explicit equivalent aliases before waiting; confirmation cannot add hosts. No global `www`, subdomain, provider, or redirect equivalence is inferred. See [stabilization decisions](docs/firefox-stabilization.md).

See [access.test.mjs](packages/core/tests/access.test.mjs) for executable examples and [the workflow contract](docs/architecture.md#greylist-workflow-milestone-2) for boundaries and restart semantics.

### Vault policy changes

Vault operations take `{ policy, policyRevision, state, accessState, now }`, where `state` is `VaultState` and `accessState` is the latest Greylist state. Proposal creation also takes `{ waitMs, confirmationWindowMs }`, both positive safe integers. Times and revisions are explicit; there are no production defaults.

| Function | Result |
| --- | --- |
| `createVaultState()` | A fresh empty Vault state; never a recovery fallback. |
| `createPolicyProposal(candidatePolicy, context, timing)` | Normalizes and freezes one complete candidate policy and its deadlines. Active policy stays unchanged. |
| `reviewPolicyProposal(proposalId, context)` | Reads the frozen proposal and returns list changes, actual classification changes, and its waiting/ready/expired phase. No state transition. |
| `prepareVaultCommit(proposalId, context)` | Explicit confirmation of a ready current proposal prepares a complete commit candidate. It does not activate policy. |
| `cancelPolicyProposal(proposalId, context)` | Consumes the pending proposal, including expired or stale proposals. Editing requires cancellation and a new full wait. |

Returned Vault records and candidates are deeply frozen. Creation copies the caller's policy; confirmation accepts an ID and current context, not replacement contents. Any policy revision change makes a pending proposal stale. Both Whitelist and Blacklist additions/removals use the same protected flow.

`COMMIT_PREPARED` returns two distinct values: observation-only `nextState`, which still contains the pending proposal, and `candidate.nextSnapshot`, which contains the proposed replacement policy, revision increment, consumed proposal, last-applied marker, and latest access state with the new revision. Thread non-null observation state through later commands, including rejections; review returns no `nextState`. Invalid context fails closed.

Standalone Vault functions only prepare changes. The aggregate planner includes latest Journeys, and the controller publishes the complete candidate after repository acknowledgement. A definite failed write leaves policy unchanged and requires fresh explicit confirmation within the original window. Identical preparation against unchanged input is deterministic; after adopting a successful candidate, confirming its proposal again cannot commit twice. Real backend guarantees and website-message isolation remain integration work.

See [the Vault contract](docs/architecture.md#vault-workflow-milestone-3) and [vault.test.mjs](packages/core/tests/vault.test.mjs). Tests model adoption or rejection of a candidate; they do not implement persistence.

See [architecture.md](docs/architecture.md) for current modules and the remaining proposals. The package is private while the API and repository license are still being developed.

### Pure Whitelist Journeys

The [Firefox authentication investigation](docs/firefox-auth-investigation.md) records event evidence, security limits and proposed next decisions. It does not broaden the implemented Journey rules.

Journeys allow unfamiliar intermediate top-level destinations during a bounded attempt to reach a Whitelisted root, subject to Blacklist. They change neither policy nor access grants. Each Journey belongs to one opaque context ID and has one fixed deadline, a hop limit, and a policy revision.

| Function | Role |
| --- | --- |
| `createJourneyState()` | Explicit fresh runtime state. |
| `startJourney(root, contextId, context, { lifetimeMs, maxHops })` | Starts one attempt for a currently Whitelisted root. Both limits are positive safe integers; no defaults. |
| `evaluateJourneyNavigation({ journeyId, contextId, target }, context)` | Checks a proposed step without moving or completing the Journey. |
| `recordJourneyNavigation(navigation, context)` | Rechecks and records an adopted step or actual root arrival. |
| `observeJourneys(context)` | Observes time/revision and ends expired or invalidated attempts without navigation. |
| `cancelJourney(id, contextId, context)` / `closeJourneyContext(id, contextId, context)` | Ends a matching attempt. |

Context is `{ policy, policyRevision, state: journeyState, now }`. Navigation calls accept optional portable continuation evidence and return `{ decision, nextState }`; other commands return `{ ok, ... , nextState }`. Thread all non-null state onward, including denials. D18 requires trusted continuation evidence for unfamiliar hosts. Actual initial root arrival ends REACHED; a recorded return after leaving ends RETURNED. BEGIN_NAVIGATION starts Whitelist attempts regardless of origin; CHECK_NAVIGATION never starts them. Host changes to intermediates consume hops; reloads never extend time; root return requires no extra hop. Repeated Start on an active context rejects without renewal.

An ended Journey permits no intermediate access of its own. Ordinary Whitelist access remains available; an independent Greylist grant is evaluated separately with `evaluateAccess`. Malformed state fails closed. These functions do not combine all authorization state or enforce browser navigation.

The [Journey contract](docs/architecture.md#journey-workflow) defines the bounded exception and owner obligations. The owner must supply trusted context bindings, record accepted navigation steps in order, and enforce expiry on displayed content. Domain tests establish none of those browser guarantees. The Core cannot prove that an intermediate site is necessary or safe, and the deadline bounds one attempt rather than cumulative use across fresh deliberate starts.

## Aggregate planner

`AtlasSnapshot` combines `{ policy, policyRevision, configuration, configurationRevision, accessState, vaultState, journeyState }`. `validateAtlasSnapshot(input)` validates every component and their revision relationships, then returns copied, frozen data. Invalid components block all planning, including otherwise Whitelisted access.

`planAtlasOperation(operation, { snapshot, now, configuration })` combines the existing workflows without storage or a real clock. Committed snapshot configuration supplies `{ accessTiming, vaultTiming, journeyLimits }`; the legacy external argument is validated but cannot override it. There are no runtime defaults. Navigation precedence is full validation and observation, manual Blacklist, Whitelist, optional managed Blacklist, Access Grant, Journey, then GREYLIST/WAIT/REQUIRE_CONFIRMATION.

`compileManagedBlacklist(hostnames)` validates a managed dataset once and returns an opaque immutable set, or null for invalid input. Supply it as `managedBlacklist` in the planner context, or inject `managedBlacklist: () => compiled` into the controller. Invalid supplied authority fails closed; omitting it preserves existing consumers. Managed data stays outside the small `Policy` arrays and persisted snapshot. See the [managed policy contract](docs/managed-policy.md).

```ts
import { planAtlasOperation, type AtlasPlannerContext } from "@atlas/core";

function assessDestination(context: AtlasPlannerContext) {
  return planAtlasOperation({
    kind: "CHECK_NAVIGATION",
    target: { hostname: "mail.example" },
    context: { contextId: "surface_1", journeyId: null },
  }, context);
}
```

A plan returns:

- `result`: an assessment, prepared transition, review, observation, or rejection. An ALLOW assessment does not authorize browser execution.
- `observationSnapshot`: complete conservative time/revision/expiry observations to retain, including on rejected commands. Read-only review and invalid planner context return null.
- `candidateSnapshot`: a complete proposed change after a successful transition, otherwise null. Only a successful atomic commit may publish its permissions.

Vault candidates include the latest access records and invalidated Journeys together with the replacement policy. Navigation records maintain Journey hops/returns even when Whitelist or a grant supplies ALLOW. Ordinary checks never record a hop or complete a return. The full operation contract and trusted-owner obligations are in [architecture.md](docs/architecture.md#aggregate-planner-d13); executable examples are in [atlas.test.mjs](packages/core/tests/atlas.test.mjs).

### Protected settings (D19)

`PROPOSE_SETTINGS` freezes the candidate configuration alongside current policy in the existing single Vault slot. `REVIEW_POLICY`, `CONFIRM_POLICY`, and `CANCEL_POLICY` handle either kind of proposal. Current **old** Vault wait/window govern the change; confirmation accepts an ID only and success follows atomic persistence. Settings-only commits advance `configurationRevision` without changing `policyRevision`. Existing request/grant/Journey terms stay frozen; new operations use committed values. `createSettingsProposal` also exposes this pure transition directly.

The supported envelope is schema 2. `migrateAtlasSnapshotV1(legacy, bootstrapConfiguration)` validates and converts known valid schema-1 data; hosts must persist conversion atomically before publishing it. Firefox implements that boundary in IndexedDB. See [D19](docs/productization.md) for the accepted Journey trust tradeoff, migration, and evidence.

## Atlas controller

`createAtlasController({ repository, clock, configuration, ownerId })` creates one framework-independent owner. The host supplies an `AtlasRepository`, an `AtlasClock`, a validated legacy configuration dependency, and a fresh opaque owner ID for each controller lifetime. Active timing always comes from the loaded snapshot. Core generates no clock or random ID of its own.

| Method | Behavior |
| --- | --- |
| `open()` | Load and validate complete authority, reconcile uncertain writes, and save startup/recovery housekeeping before READY. Missing or corrupt state is never initialized automatically. |
| `handle(operation)` | Serialize a D13 operation, reload current authority, plan it with injected time, commit its complete candidate or required observation checkpoint, then return the result. |
| `getView()` | Immutable last verified snapshot and owner status. It does not expose uncommitted candidates or authorize navigation. |

The repository provides `load`, atomic version-checked `commit`, and `resolveCommit`. `clock.now()` supplies nonnegative integer milliseconds. The [controller contract](docs/architecture.md#atlas-controller-d14) specifies envelope validation, receipts, restart fencing, and identity requirements.

Successful workflow changes return `COMMITTED`; other responses include `ASSESSMENT`, `REVIEW`, `OBSERVED`, and domain `REJECTED`. Infrastructure failures return `BLOCKED`. Navigation responses remain assessments. D15's Firefox adapter binds a fresh saved assessment to one held request, with required Journey recording before release; pure or cached assessments cannot execute actions.

Failed writes require explicit `open()` recovery. Conflicts discard the candidate and reload; unknown outcomes remain blocked until the repository settles them. Recovery never replays confirmation. Initial open and recovery terminate old Journeys for lost bindings while preserving grant, request, and proposal deadlines. Slow saves cannot return an expired grant/Journey ALLOW assessment.

[controller.test.mjs](packages/core/tests/controller.test.mjs) uses a controllable [in-memory repository](packages/core/tests/support/fake-repository.mjs) and fake time. That repository is test support only. No real backend or durability guarantee is supplied by the package.

## Integration boundary design

The [architecture](docs/architecture.md#framework-independent-integration-boundary) now defines a proposed public facade and one trusted state owner, with plain operation/result contracts and injected repository/clock ports. The host owns UI, browser state, event mapping, and concrete persistence. Core owns common authorization and transition semantics. Hostname grants retain their existing scope across contexts; Journeys remain bound to individual contexts.

D13 implements aggregate validation/planning; D14 adds the controller and repository/clock ports. D15 supplies a narrow Firefox request/context protocol; the broader generic runtime ledger remains proposed. Fake repository tests validate the controller protocol; adapter and native evidence is recorded separately.

## Firefox prototype

The [extension guide](extension/README.md) covers build/load instructions, UI controls, repository behavior, and tests. Architecture choices were recorded in [Firefox adapter architecture](docs/firefox-adapter.md) before implementation. D17 adds compiled managed-deny data to Core planning/controller inputs; the two-list Policy and existing workflows remain unchanged.

```sh
npm --prefix packages/core ci
npm --prefix extension ci
npm --prefix extension run build
```

In Firefox, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `extension/dist/manifest.json`. Open Atlas from the toolbar and save the offered curated preset during first setup. Services appear once with explicitly declared aliases; Core continues matching exact hostnames. Every Whitelist request starts the same bounded redirect Journey, whether opened through Atlas, a bookmark, link, or typed URL. Unknown sites offer **Request temporary access**, a wait, and explicit **Confirm and open**. Declared equivalent aliases are listed before confirmation and share one frozen grant; unrelated hosts do not. Prototype durations are shown in the UI.

The managed StevenBlack list is bundled for offline first use, cached separately, and refreshed at most once per day. Core applies manual Blacklist → explicit Whitelist → managed Blacklist → grants/Journey → Greylist. Managed conflicts and update status are visible. Existing installations retain their policy; setup never replaces active policy.

For an existing profile, open **Policy & recovery → Add curated destinations**, review the proposal, wait, then select **Confirm policy update**. This uses Core's existing Vault workflow and preserves current entries and the manual Blacklist. Rebuild before Firefox reload; code reload alone never updates saved policy. See the [upgrade instructions](extension/README.md#updating-an-existing-development-installation).

The extension uses a persistent background page, top-level HTTP(S) request interception, a transactional IndexedDB repository, and a private control interface with Journey visibility and bounded hostname diagnostics. Resource requests are outside its gate. Native tests cover synthetic workflows and real UI actions; separate [public-site checks](docs/firefox-real-sites.md) document sign-in entry points and remaining account-dependent gaps.

## Development

Use Node.js 24 and npm. TypeScript 6.0.3 is Core's only development dependency; tests use Node's built-in runner against compiled JavaScript. From the repository root:

```sh
npm --prefix packages/core ci
npm --prefix packages/core run typecheck
npm --prefix packages/core run build
npm --prefix packages/core test
```

`test` also builds first. Build output and declarations go to `packages/core/dist` and are ignored by Git. Tests use explicit fixture times and need no browser, storage backend, real clock, accounts, or network access.

## Open questions

Language/tooling, initial hostname scope, and the pure Greylist, Vault, and Journey workflows are settled. D15 implements the first Firefox mapping and backend. Production timing, broader event coverage, storage compaction, and recovery/migration questions remain recorded in [foundation.md](docs/foundation.md). Context Whitelist and broader models are deferred.

## Working in this repository

Read `AGENTS.md` and the foundation first. Follow the small milestones in [first-steps.md](docs/first-steps.md) and keep decisions in their owning documents. No access to Zenith or the original conversation is required. Do not import Zenith's code, Git metadata, user data, profiles, credentials, or build outputs.

## Reading guide

| File | Role |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Instructions for future agents working in the new project. |
| [foundation.md](docs/foundation.md) | Requirements, settled decisions, terminology and open questions. |
| [architecture.md](docs/architecture.md) | Implemented modules and contracts, data boundaries, and remaining proposals. |
| [lessons-from-zenith.md](docs/lessons-from-zenith.md) | Historical evidence distilled into transferable lessons. |
| [acceptance-tests.md](docs/acceptance-tests.md) | Behavioral scenarios, with required and conditional expectations separated. |
| [first-steps.md](docs/first-steps.md) | A restrained implementation sequence and prompt for a fresh context. |

## Status and evidence

Verification on Node.js 24.12.0 / npm 11.6.4 / TypeScript 6.0.3: build and type checks pass; all 158 Core tests pass (the previous 152 plus six stabilization regressions). [Acceptance scenarios](docs/acceptance-tests.md) map this evidence to implemented behavior and distinguish the remaining integration work.

D18 brings the extension suite to 56 passing tests, including the follow-up protected preset upgrade for existing profiles. Native Firefox 157.0 checks curated setup, managed denial/cache restart, Journey, confirmation, and existing UI/lifecycle behavior; the upgrade scenario also covers reload and the actual Vault controls. The [managed policy evidence](docs/acceptance-tests.md#curated-defaults-and-managed-blacklist-evidence-d17) and [prototype evidence](docs/acceptance-tests.md#firefox-prototype-evidence-d16) distinguish mocked APIs, emulated storage, native checks, and incomplete authenticated flows. Exhaustive event coverage and physical power-loss durability remain untested. Zenith's historical results are not Atlas validation.
