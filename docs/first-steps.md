# Starting the new AtlasCore repository

Status: Pure domain modules, D13 aggregate planning, and D14 commit coordination are implemented. Real storage, runtime event correlation, and browser integration remain future work. Current commands and results are in the root README.

## Requirements

Start outside the Zenith repository. Copy knowledge, not its application, browser profiles, persisted policy, credentials or implementation. Build only the next agreed milestone and keep domain tests independent of a browser.

## Decisions already made

Atlas Core is a fresh decision engine for intentional access. Firefox and Electron are future consumers. The user authorized the pure domain modules, aggregate planner, and framework-independent controller; concrete storage and frontend work remain deferred.

A new Codex context should read the repository files rather than depend on this conversation being available. Keep the files alongside the project as its evolving source of truth.

## Original repository preparation

The repository is already prepared. These handover steps are retained as historical setup guidance.

1. Create a sibling directory, for example `Projects/AtlasCore`, outside Zenith's Git repository.
2. Copy the **contents** of `handover/` into it. The resulting root contains `README.md`, `AGENTS.md` and `docs/`. Do not leave the instructions hidden under another `handover/` directory.
3. Initialize a separate Git repository and commit the documentation as a starting point. Preserve Zenith separately for historical reference.
4. Open the new directory in Codex. Read `README.md` and `docs/foundation.md` before starting implementation.

The packet has no required links back into Zenith. There is no need to copy the complete chat, old security reports or old agent instructions. If a historical detail becomes necessary, inspect it explicitly and record the relevant lesson locally.

## Proposed architecture: build in small milestones

The layout in [architecture.md](architecture.md) is a destination sketch, not an instruction to generate every folder now. Do not create empty adapters, services or abstractions to make the sketch look complete.

### 0. Resolve only the first blocking decisions

Complete for Milestone 1: TypeScript is adopted, and Q1/Q2 have a bounded initial contract in `foundation.md`. Additional target forms and future runtime support remain deferred.

Do not ask the user to resolve all future product questions at once. Routine implementation choices can be made within authorized scope; unresolved product semantics should not be silently invented.

### 1. A small evaluator

Implemented in `packages/core`. See the root README for verification commands and `acceptance-tests.md` for coverage. The paragraphs below retain the milestone's scope and completion criteria.

Create one package with minimal development tooling and tests. Implement the agreed request/state/decision types, normalization and classification. Demonstrate Whitelist access, Blacklist precedence, default Greylist and invalid-input handling without a browser or persistent backend.

Done means a documented command runs those tests and the public evaluator does not mutate its inputs. It does not mean an entire browser or production-ready permission service exists.

### 2. Deliberate temporary access

Implemented: explicit Start, pending requests, cooldowns, bounded confirmation windows, explicit Confirm, scoped expiring grants, cancellation, and validation. Tests use explicit fixture times, including serialized state reload. D9 adopts the workflow; Q6's production values and Q9's actual clock/persistence integration remain open.

Start is G01's initial deliberate action. Confirmation consumes the request and creates its grant in one candidate next state. Valid-context results also return time/revision observations, which must be retained even on command rejection. Until commit semantics and a real backend exist, this remains domain evidence; an in-memory workflow does not establish crash durability or concurrent confirmation consumption.

Keep UI timers and navigation attempts outside Core. Do not infer confirmation from elapsed time or successful login. Use fixture durations; choose production defaults deliberately.

### 3. Protected policy changes and commit preparation

Implemented under D10: one frozen proposal, repeatable review, configured wait and bounded confirmation window, explicit commit preparation, cancellation, and expiry/staleness validation. Whitelist/Blacklist additions and removals use the same protected flow. Review and preparation leave active policy unchanged.

The complete commit candidate includes replacement policy, one revision increment, proposal consumption, a last-applied marker, and the latest access state advanced to that revision. These pure tests simulate adopting or discarding it. D13/D14 subsequently wrap the latest Journeys and coordinate atomic publication through a tested repository contract. A production backend remains unimplemented.

### 4. Pure Whitelist Journeys

Implemented under D11: a minimal pure runtime module for bounded attempts to reach a Whitelisted root through unfamiliar intermediates. The [Journey contract](architecture.md#journey-workflow) was documented before implementation. It specifies fixed expiry, context binding, hop counting, lifecycle, and revision checks. Twenty-three fake-time tests cover normal completion, failure, and isolated contexts.

The supporting-domain database proposal is withdrawn. Do not implement Context Whitelist, learned relationships, trust graphs, link inheritance, provider discovery, browser adapters, or authentication logic. Domain tests must not claim actual login compatibility or browser enforcement.

### 5. Framework-independent integration boundary

D12 documented the [integration boundary](architecture.md#framework-independent-integration-boundary). D13 implements complete aggregate validation and pure operation planning with explicit time. D14 implements shared ownership, repository/clock ports, serialized commit coordination, and explicit recovery. The 28 aggregate and 27 controller tests use fake snapshots, time, and repository behavior. Real backend durability and runtime event correlation remain unimplemented.

The next framework-independent increment can implement the remaining context/correlation protocol before any browser adapter. Preserve existing domain semantics and public module contracts. A real backend separately needs explicit initialization/recovery decisions and durability evidence.

Prove that invalid state cannot be bypassed by another module's ALLOW, a Vault commit preserves latest access/Journey state, contexts cannot share Journey authority, and failed or uncertain writes publish no candidate permissions. Navigation checks, adoption, actual arrival, and retained-content rechecks need distinct contract tests. Fake storage establishes the controller protocol only, not real durability or browser interception.

### 6. One durable backend and one browser proof of concept

Choose the first frontend under Q12. Resolve initialization/recovery under Q10 and implement a backend satisfying the reviewed repository contract with real atomicity/concurrency/reconciliation tests. Pure candidate-adoption and fake-repository tests are not evidence of crash durability or restart behavior.

Then connect one narrow browser adapter to the tested Core. Verify its actual interception and lifecycle guarantees, including ordinary allowed browsing. Report any browser limitation honestly instead of moving browser mechanics into Core. Keep the second adapter deferred until the first demonstrates the shared contract is usable.

This is the earliest stage that can validate real persisted workflows and end-to-end browser enforcement. Do not ship an in-memory prototype as if it preserves the user's commitments across exit.

## Historical Milestone 1 starter prompt

Milestone 1 has now been implemented. This original prompt is retained for context and is not an instruction to repeat the work:

> Read AGENTS.md, README.md, docs/foundation.md, docs/architecture.md and docs/first-steps.md. We are starting a fresh Atlas Core, not migrating Zenith. First summarize the requirements and distinguish them from proposals. Work on milestones 0 and 1 only: settle the necessary language/tooling and site-matching decisions, then implement the small browser-independent evaluator with tests. Ask concise questions for unresolved product semantics before implementing dependent behavior. Do not create Firefox/Electron adapters, UI, authentication handling, network filtering or a large supporting-domain catalog. Update the documentation to distinguish what is implemented, what is tested and what remains proposed.

This prompt authorizes that later implementation when the user sends it; its presence in a documentation file is not an instruction to implement now.

## Record progress without accumulating duplicate specifications

- Keep requirements, decisions and unresolved product questions in `foundation.md`.
- Update `architecture.md` when a proposal is adopted, changed or rejected. Remove obsolete sketches instead of treating them as permanent obligations.
- Add actual install/build/test commands and a short implementation status to the root README once those commands exist.
- Link acceptance scenarios to actual tests as they are implemented; distinguish unit, storage and browser evidence.
- Preserve historical lessons as lessons. New defects and platform findings should state what was reproduced, not inherit conclusions from Zenith.

Implementation commands and dependency versions are now recorded in the README and package lockfile. Decide repository licensing before publication; the package remains private.

## Open questions

Use the Q1–Q12 list in [foundation.md](foundation.md). Each milestone above names the questions it depends on. Later questions can remain open without blocking a smaller, useful first increment.

The aim is a compact, tested core with explicit limits. Zenith supplied valuable experience; a new language, storage backend and browser adapter still require their own evidence.
