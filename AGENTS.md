# Atlas Core agent instructions

These instructions guide work in the independent AtlasCore repository.

## Read first

Read [README.md](README.md), [foundation.md](docs/foundation.md) and [first-steps.md](docs/first-steps.md). Before implementation, also read the relevant [architecture](docs/architecture.md), [lessons](docs/lessons-from-zenith.md) and [acceptance scenarios](docs/acceptance-tests.md).

Do not assume access to the original conversation or that another session remembers it. Keep important decisions in repository documents.

## Requirements

- Atlas Core decides intentional access; it does not render, navigate, filter network traffic, manage website credentials, or implement browser security.
- Keep domain logic independent of browser APIs, UI frameworks, filesystem APIs and networking. Storage implementations belong outside the domain logic.
- Preserve Whitelist/Blacklist/Greylist meaning, Blacklist precedence for governed actions, explicit confirmation, scoped grants and protected policy changes.
- Do not add shortcuts around waiting, confirmation, current-policy checks or successful persistence.
- Treat invalid or unavailable authorization state conservatively. Do not silently create a fresh permissive policy over damaged state.
- All frontends must use the same semantic decisions. They may adapt platform events, not invent independent access rules.
- Keep website-supplied data outside privileged policy commands. Importing a library in an untrusted context does not make that context authoritative.
- Never place credentials, cookies, tokens, private profiles or credential-bearing URLs in fixtures or logs.

## Decisions already made

- This is a fresh project. Do not import Zenith code, migrations, framework restrictions or its historical dependency/attribution graphs.
- Future Firefox and Electron use must be possible without putting those platforms inside Core.
- Supporting domains are hidden from the normal destination list but may appear during controlled login steps. See the foundation before designing their authorization rules.
- Cooldown and confirmation are the product's primary friction. Do not make a password system a prerequisite for this Core.

## Proposed architecture

Milestones 1 through 3 implement TypeScript policy evaluation, pure Greylist access transitions, and frozen Vault proposals with commit preparation. D11 adds bounded Pure Whitelist Journeys; D13/D14 add planning and commit coordination. D15 implements the Firefox adapter in `extension/`; D16 adds its prototype interface and diagnostics. D17 adds curated services with explicit aliases and a separately compiled managed Blacklist; its precedence and lifecycle are in `docs/managed-policy.md`. Boundaries are in `docs/firefox-adapter.md`; public-site evidence and gaps are in `docs/firefox-real-sites.md`. D19 adds protected timing configuration through Vault, local destination search and per-tab Journey presentation; see `docs/productization.md`. Keep D18 Journey authorization stable unless real use reveals a reproducible failure or practical bypass. Core remains platform-independent and time is explicit. Domain success is not a persistence acknowledgement; a Vault candidate is not active policy. Electron and Context Whitelist remain deferred. Do not add a supporting-domain database, learned relationships, trust graphs, or link inheritance.

Keep one small Core package and the separate authorized Firefox adapter package. Prefer pure functions, explicit dependencies and a small public API. Avoid service frameworks, generic workflow engines, plugin systems and unrelated package proliferation.

D20 refines Firefox presentation; `docs/ui-design.md` owns sidebar/search/cards/pins. Presentation preferences carry no policy authority.

## Open questions and authority

Current user instructions take precedence over this packet. Requirements and settled decisions are distinguished from proposals in the foundation. Historical Zenith behavior is not authority for Atlas.

Before implementing behavior affected by an open product question, resolve that question with the user or an explicit later decision. Do not request renewed approval for decisions already made. Routine reversible engineering choices within an authorized milestone can be made and documented without a separate approval ceremony.

If documents conflict, identify the conflict before changing behavior. Do not invent an interpretation and silently turn it into a requirement.

## Working method

1. State the small milestone and observable result.
2. Identify the responsible layer and relevant requirements.
3. Resolve only blocking product questions; continue independent work where possible.
4. Add behavior-oriented tests with fake time and isolated storage.
5. Implement the smallest coherent change, without unrelated refactors.
6. Run the project's actual build, type checks and tests as applicable.
7. Review the diff and report changes, evidence and remaining limitations.

Use the actual npm build, type-check, and test commands in `README.md`. Do not copy Zenith's `dotnet` commands or present future workflow/browser tests as current evidence.

## Evidence and maintenance

- Test required failure cases as well as allowed behavior. Core tests must run without a browser.
- Browser enforcement claims require separate adapter tests; domain tests alone are insufficient.
- Distinguish passing tests, historical evidence, untested assumptions and compatibility limitations.
- Record decisions in the foundation and keep architecture and test expectations consistent.
- Update the owning document instead of repeating specifications across files.
- Keep these instructions concise. The goal is a small decision library, not a reconstruction of Zenith.
