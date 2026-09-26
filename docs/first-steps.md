# Starting the new AtlasCore repository

Status: proposed implementation sequence. This handover has not scaffolded a package or run Atlas tests.

## Requirements

Start outside the Zenith repository. Copy knowledge, not its application, browser profiles, persisted policy, credentials or implementation. Build only the next agreed milestone and keep domain tests independent of a browser.

## Decisions already made

Atlas Core is a fresh decision engine for intentional access. Firefox and Electron are future consumers. The current task produces documentation only; it does not choose a toolchain or authorize a frontend migration.

A new Codex context should read the repository files rather than depend on this conversation being available. Keep the files alongside the project as its evolving source of truth.

## Prepare the repository

1. Create a sibling directory, for example `Projects/AtlasCore`, outside Zenith's Git repository.
2. Copy the **contents** of `handover/` into it. The resulting root contains `README.md`, `AGENTS.md` and `docs/`. Do not leave the instructions hidden under another `handover/` directory.
3. Initialize a separate Git repository and commit the documentation as a starting point. Preserve Zenith separately for historical reference.
4. Open the new directory in Codex. Read `README.md` and `docs/foundation.md` before starting implementation.

The packet has no required links back into Zenith. There is no need to copy the complete chat, old security reports or old agent instructions. If a historical detail becomes necessary, inspect it explicitly and record the relevant lesson locally.

## Proposed architecture: build in small milestones

The layout in [architecture.md](architecture.md) is a destination sketch, not an instruction to generate every folder now. Do not create empty adapters, services or abstractions to make the sketch look complete.

### 0. Resolve only the first blocking decisions

Evaluate and adopt a language/toolchain under Q1. TypeScript is the recommendation, not a decision already approved. Decide the first site's identity and matching rules under Q2. Record concise decisions in `foundation.md`, including rationale and what remains deferred.

Do not ask the user to resolve all future product questions at once. Routine implementation choices can be made within authorized scope; unresolved product semantics should not be silently invented.

### 1. A small evaluator

Create one package with minimal development tooling and tests. Implement the agreed request/state/decision types, normalization and classification. Demonstrate Whitelist access, Blacklist precedence, default Greylist and invalid-input handling without a browser or persistent backend.

Done means a documented command runs those tests and the public evaluator does not mutate its inputs. It does not mean an entire browser or production-ready permission service exists.

### 2. Deliberate temporary access

Resolve the necessary Q3/Q6/Q9 behavior. Add pending Greylist requests, explicit confirmations, cooldowns and scoped expiring grants using a fake clock. Test readiness, expiry, repeated commands and invalid transitions.

Keep UI timers and navigation attempts outside Core. Do not infer confirmation from elapsed time or successful login. Use fixture durations; choose production defaults deliberately.

### 3. Protected policy changes and commit semantics

Resolve the relevant Q7/Q8 behavior. Add a minimal Vault proposal flow and the storage contract needed to commit complete state transitions. A fake repository should exercise failed writes, stale revisions and duplicate submissions.

Test that staging has no immediate permission effect and final confirmation cannot publish an uncommitted change. Do not add service attribution, ownership graphs or migration of Zenith's persistence.

### 4. Minimal supporting-domain knowledge

Resolve Q4/Q5 before giving catalog entries any permission effect. Begin with a tiny reviewed fixture and one explicit supporting-use scenario. Define direct visits, authorized context, expiry and Blacklist precedence before expanding the catalog.

Keep provider details as data where useful; do not implement OAuth, infer authentication from arbitrary traffic, or build a dependency discovery system. D4 already settles that supporting domains can appear during controlled login steps while remaining hidden from the ordinary site list.

### 5. One durable backend and one browser proof of concept

Choose the first frontend under Q12. Resolve initialization/recovery under Q10 and implement a suitable storage backend with real atomicity/concurrency tests. The earlier fake repository is not evidence of crash durability or restart behavior.

Then connect one narrow browser adapter to the tested Core. Verify its actual interception and lifecycle guarantees, including ordinary allowed browsing. Report any browser limitation honestly instead of moving browser mechanics into Core. Keep the second adapter deferred until the first demonstrates the shared contract is usable.

This is the earliest stage that can validate real persisted workflows and end-to-end browser enforcement. Do not ship an in-memory prototype as if it preserves the user's commitments across exit.

## Suggested first prompt for a new Codex session

After copying this packet, the user can supply the following prompt when ready to begin implementation:

> Read AGENTS.md, README.md, docs/foundation.md, docs/architecture.md and docs/first-steps.md. We are starting a fresh Atlas Core, not migrating Zenith. First summarize the requirements and distinguish them from proposals. Work on milestones 0 and 1 only: settle the necessary language/tooling and site-matching decisions, then implement the small browser-independent evaluator with tests. Ask concise questions for unresolved product semantics before implementing dependent behavior. Do not create Firefox/Electron adapters, UI, authentication handling, network filtering or a large supporting-domain catalog. Update the documentation to distinguish what is implemented, what is tested and what remains proposed.

This prompt authorizes that later implementation when the user sends it; its presence in a documentation file is not an instruction to implement now.

## Record progress without accumulating duplicate specifications

- Keep requirements, decisions and unresolved product questions in `foundation.md`.
- Update `architecture.md` when a proposal is adopted, changed or rejected. Remove obsolete sketches instead of treating them as permanent obligations.
- Add actual install/build/test commands and a short implementation status to the root README once those commands exist.
- Link acceptance scenarios to actual tests as they are implemented; distinguish unit, storage and browser evidence.
- Preserve historical lessons as lessons. New defects and platform findings should state what was reproduced, not inherit conclusions from Zenith.

No implementation commands, dependency versions or license choice are prescribed by this packet. Choose supported tooling when implementation starts, and decide repository licensing before publication.

## Open questions

Use the Q1–Q12 list in [foundation.md](foundation.md). Each milestone above names the questions it depends on. Later questions can remain open without blocking a smaller, useful first increment.

The aim is a compact, tested core with explicit limits. Zenith supplied valuable experience; a new language, storage backend and browser adapter still require their own evidence.
