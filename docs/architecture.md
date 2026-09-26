# Proposed Atlas Core architecture

Status: **Proposed architecture**, not an approved implementation plan or existing code. Requirements and settled decisions live in [foundation.md](foundation.md). Implement only an authorized small milestone.

## Language recommendation

Recommend TypeScript (P1). The policy workload is validation, matching, deadline arithmetic and state transitions. Native performance is not an initial requirement.

| Candidate | Fit for these consumers |
| --- | --- |
| TypeScript | Compiles to JavaScript usable in both Firefox background code and Electron main code. One implementation and test corpus, without a separate language service. |
| C# | Strong domain tooling, but browser-extension reuse needs an extra runtime, WebAssembly integration or a process boundary. Do not choose it merely because Zenith used it. |
| Rust | Could run through WebAssembly, with strong language guarantees; adds build and interoperation work for a small policy library. |
| Python | Good general business logic, but browser deployment requires an interpreter or external service rather than an ordinary JavaScript import. |

TypeScript's types disappear at runtime, and `readonly` alone does not prevent mutation. Validate decoded data and incoming commands, keep internal state private, and return safe snapshots. Use strict compiler settings, exhaustive result handling, bounded numeric values and a small public API.

If adopted, publish JavaScript ES modules and type declarations. Keep Core free of `electron`, extension APIs, Node-only APIs, DOM access, React and networking. Standard target parsing can be shared without a browser dependency, but its normalization contract and edge cases must be tested in supported runtimes. No package manager, runtime version, validator library or test framework has been selected.

## Dependency direction

```text
Browser events / application UI
            |
            v
Trusted interface adapter --------> Browser engine
            |                      (execute/present decision)
            v
Atlas Core application coordinator
            |
            +--> Pure policy evaluation and transitions
            |
            +--> Repository / clock / ID-source contracts
                         ^
                         |
                Platform implementations
```

Core depends on contracts it defines, not on the code implementing storage or a browser. The coordinator is ordinary application logic: load, validate, transition, commit and publish. It is not a browser service, scheduler or dependency-injection framework.

## Suggested repository layout

Start with the documentation and one package when Q1 is resolved. Add the other directories only when they acquire a real purpose.

```text
AtlasCore/
  README.md
  AGENTS.md
  docs/                       product contract, architecture, tests, decisions
  packages/
    core/
      src/
        index.ts              deliberately small public API
        policy/               identity, classification, evaluation
        access/               waits, confirmations, grants
        vault/                proposed policy changes and transitions
        support/              reviewed rules and contextual use
        state/                serializable records and validation
        runtime/              commit coordinator and external contracts
      tests/                  unit, transition and repository-contract tests
  catalogs/                   reviewed supporting-domain data, added later
  adapters/
    firefox/                  browser mapping, messaging and storage adapter
    electron/                 browser mapping, messaging and storage adapter
  tests/
    conformance/              shared behavioral scenarios for later adapters
```

The folder names are suggestions, not a mandate to create empty layers or a class per concept. Start smaller and split a module when its responsibilities justify it. Introduce a separate published package only for an actual independent consumer or dependency boundary.

## Two domain operations

**Evaluate:** validated snapshot + requested action + time -> decision.

**Transition:** validated state + explicit command + time/IDs -> proposed next state + result + domain events.

Evaluation must not begin waits, issue grants or mutate policy. A transition computes effects but does not open a browser, schedule a timer or write a file. The coordinator publishes a committed transition only after storage confirms it.

Suggested commands include StartAccess, ConfirmAccess, CancelAccess, ProposePolicyChange, ConfirmPolicyChange and CancelPolicyChange. Names, parameters and additional supporting-interaction commands are not final.

Do not create a general event-sourcing system. A snapshot and a bounded, optional record of significant user actions are sufficient candidates.

## Contract sketches

These describe semantics rather than prescribe TypeScript declarations.

| Contract | Suggested contents | Boundary |
| --- | --- | --- |
| AccessRequest | Target URL and an application-level purpose such as ordinary visit or supporting continuation; a contextual reference if required. | No tab IDs, frame objects, browser event instances, cookies or provider identity. |
| PolicyDecision | Allow, deny, wait or require confirmation; stable reason; relevant request/proposal ID; deadline and policy revision where applicable. | No UI strings as logic, executable scripts or browser commands. |
| AtlasCommand | The explicit requested transition and the exact request/proposal it concerns. | A UI cannot choose its own ready-at time, scope expansion or authenticated flag. |
| AtlasRepository | Load raw data with status; atomically commit a full next snapshot against an expected version. | No classification or permission decisions in the storage implementation. |
| Clock | An explicit wall-clock reading and, where supported, monotonic reading with its lifetime identity. | No hidden global clock reads inside domain functions. |
| IdSource | IDs supplied to transitions through a controlled dependency. | IDs identify records; they are not authentication credentials. |

Use distinguishable result variants rather than loosely related flags. For example, a start-confirmation and a finish-confirmation require different data. A failed evaluation is not an empty Allow result.

The public API should expose validated models and useful operations through `index.ts`. Keep storage encodings and mutable internals private. Exact versioning and error contracts should be chosen with the first consumers rather than overdesigned now.

## Suggested state and lifecycle

An Atlas snapshot may contain active policy, pending access requests, grants, a pending Vault proposal, optional supporting contexts and time checkpoints. Separate:

- **Schema version:** how serialized data is understood.
- **Storage version:** optimistic concurrency/commit ordering.
- **Policy revision:** which set of access rules is active.
- **Catalog revision:** which reviewed supporting data a proposal or active snapshot uses.

Store the minimum data necessary. Full URL queries, headers, request bodies and website credentials do not belong in policy persistence. An adapter may retain an original requested URL briefly to resume a user action; it must reevaluate before acting and must not blindly replay authentication POSTs.

Represent a wait as state and deadlines. Time passing makes confirmation eligible; it does not apply a state change automatically. Define exact boundary behavior in Q6 and test it. Treat duplicate confirmation as a single-consumption problem, including retries after an uncertain save result.

A useful `ALLOW` result can include the policy revision and next recheck deadline. It is not a reusable authorization token. The adapter must reevaluate retained content when rules or time invalidate access. How the adapter removes that content is outside Core.

## Persistence and failure sequence

Recommended coordinator sequence:

1. Load/obtain the current validated snapshot and an explicit time sample.
2. Evaluate the command against that state.
3. Construct and validate the complete proposed next snapshot.
4. Commit against the expected storage version.
5. Publish success, new decisions and change notifications only after commit.

A conflict requires reloading and reevaluation. A failure must not leave an in-memory grant active when its corresponding wait was not durably consumed. Bound retries and return an explicit failure if contention or storage remains unavailable.

Distinguish uninitialized, ready and unavailable/corrupt storage. Initial setup must not be a fallback for a damaged installation. Future migration should validate before replacing state and leave the original intact on failure. No Zenith schema migration is needed or authorized for this fresh project.

Choose concrete storage later. An IndexedDB transaction is a possible Firefox implementation; a transactional store or atomic-file implementation with exclusive writer ownership is a possible Electron implementation. An ordinary asynchronous read followed by write is not automatically compare-and-swap. Test each repository's guarantees, including interruption and quota failures.

"Protected policy" primarily means the protected change workflow. Do not claim local encryption makes state immune to a user or program with full access to the installation.

## Supporting-domain proposal

P4 proposes a contextual exception, distinct from ordinary Whitelist membership. A small context could bind an ID to an authorized anchor, policy revision and bounded lifetime. It would be created only after Core checks the anchor. Temporary access must not generate a longer-lived supporting permission.

The adapter must supply context from trusted observations and stored associations, not a webpage's claim that something is a login. Core must check the relevant state itself rather than accepting `sourceAllowed: true` from a request. The implementation must still define which platform events qualify; that is Q4/Q12.

Keep the catalog flat initially: hostname, explanation, review evidence and revision. Provider names may be human-readable data; there is no provider-specific algorithm. Do not activate a domain because it appeared in traffic or because a service label overlaps a Whitelist entry.

Choose catalog activation and update rules in Q5. Recommended: validate a complete candidate, freeze the exact access consequences in any proposal, and never silently expand existing permissions when data changes. Failed candidate loading must not mutate existing policy. Catalog integrity validation is not proof that an endpoint is safe or that every login will work.

No complete service graph, ownership ledger or perfect removal algorithm is needed for this feature.

## Time, background lifetimes and audit

Prefer persisted deadlines over a continuously running countdown. UI timers and browser alarms may prompt reevaluation, but do not supply authority. A background context being unloaded must not itself count as confirmation or a restart of the user's commitment.

Grant restart behavior (P5/Q3) is unresolved. Do not store important state only in module variables while claiming it survives suspension. If session-only grants are selected, define a true session boundary separately from a background worker/page lifetime.

UTC checkpoints and monotonic comparisons are possible local safeguards, but monotonic values from different runtime lifetimes cannot be compared directly. Offline clock manipulation and full state rollback cannot be perfectly detected without additional trust. Do not introduce a time server to hide that limitation.

Audit should explain user commitments and state changes rather than record browsing traffic. Prefer reason codes, normalized hostnames when necessary, IDs, revisions and bounded retention. A redacted error is enough; raw provider redirects can contain secrets.

## Direct reuse and remaining boundaries

If TypeScript is adopted, the same package can execute directly in Firefox's trusted background owner and Electron's main process. No Core HTTP server, Python process or C# IPC service is necessary.

UI-to-background messages and Electron renderer-to-main IPC still exist. They carry validated commands; importing the same package into multiple UI contexts does not give those contexts independent authority to commit. There should be one authoritative owner per state instance.

Each frontend needs its own storage and browser-event adapter. Sharing code does not synchronize installations, import browser sessions or guarantee equal event coverage. A future adapter must respect synchronous event deadlines; awaiting a library call does not automatically pause a browser action.

## Avoid these additions without a new requirement

Do not add a frontend, cloud service, remote configuration, authentication subsystem, adblocking engine, browser capability framework, plugin system, cryptographic protocol, event-sourced ledger or generic dependency graph as part of the Core foundation. None is necessary to prove the initial classification and deliberate-access behavior.
