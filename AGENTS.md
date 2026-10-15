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

D22 fixes Journey arrival/retry ordering and adds the explicitly approved first browser-attested departure from a loaded Whitelisted root. D25 also approves bounded POST continuation from the loaded current intermediate, with exact browser origin and saved authority. Later unfamiliar steps require HTTP redirect or POST evidence. See `docs/firefox-journey-polish.md`; no provider trust is inferred.

D23's logic/structure/UI review is recorded in `docs/code-review.md`. Timing display and draft conversion belong to `extension/src/ui/settings-model.ts`; they carry no authorization. Preserve drafts across unavailable authority and retire departed browser source evidence promptly.

D26 separates explicit Greylist access aliases from the curated Whitelist, fixing Amazon's canonical redirect without Whitelisting it. `docs/firefox-stabilization.md` owns the scope and evidence. Saved scopes never widen on reload.

D27 shows committed temporary access on Home and seeds the user's approved 51-host Whitelist only in genuinely empty development installations. `docs/ui-design.md` and `docs/managed-policy.md` own presentation and first-run behavior. Existing or damaged authority is never replaced by defaults.

D28 prepares new Greylist scopes from a bounded, credential-free public apex/`www` redirect check before Start. Standard HTTP and HTTPS entries inspect the same hostname over HTTPS while preserving the original navigation. The user approved live request preparation; discovered partners are disclosed exact terms, never permanent aliases. `docs/firefox-stabilization.md` owns the boundaries. Existing requests/grants never widen.

D29 protects pinned managed-feed bytes across Git checkout and verifies source/shipped bundles during build. Startup failures expose safe stage codes; explicit Recovery retries failed construction or reconciles the existing controller without resetting authority. `docs/managed-policy.md` owns the contract; older Windows checkouts may require re-checking out the two public hosts assets after pulling.

D24 simplifies Firefox navigation to Home/Settings with native disclosures and a saved minimized sidebar; `docs/ui-design.md` owns the presentation contract. Sidebar/pin preferences remain separate from authoritative storage.

D30 adds Sites & Access, compact Home launchers, local service usage ranking and a 60px sidebar rail. Exact permission changes still use Vault; display-only edits use local preferences. Optional apex/www pairs use a Public Suffix List in the extension, never fuzzy Core matching or migration broadening. Saved Journey expiry returns the owning tab to its recorded trusted origin, with an automatic-return renewal veto. `docs/destination-polish.md` owns these boundaries and evidence.

D31 removes sidebar expansion and sizes Home preview rows to available width, up to five fixed-height cards. Legacy sidebar preferences are ignored; policy and pins are preserved. `docs/ui-design.md` owns the presentation and evidence.

Development toward 0.1.15 adds a separate ephemeral Download Intent through the
planner/controller; `docs/firefox-downloads.md` owns the scope and evidence. Keep
browser correlation in the adapter, fixed deadlines and deny precedence in Core,
and unfamiliar HTML under normal navigation authorization. Preserve signed 0.1.14
assets; this milestone does not authorize signing or publication.

Milestone C adds saved Home category order, visibility and complete collapse in a
separate revision-checked presentation repository, plus links to existing access
workflows and per-page Sites navigation context. `docs/home-organization.md` owns
the contract and evidence. Pins/search keep their complete index; layout is never
an authorization input. Milestone D's user-authorized visual consistency pass is
owned by `docs/visual-polish.md`; it preserves all A/B/C behavior and release boundaries.

The user subsequently authorizes preparing the 0.1.15 unsigned release candidate.
`docs/firefox-private-release.md` owns packaging, reviewer-source reproduction and
in-place update instructions. Keep signed 0.1.14 frozen; preparation does not
authorize Mozilla signing/submission or changes to installed Firefox.

## Open questions and authority

Milestone A's focused UI reliability repairs are owned by `docs/ui-reliability.md`.
Presentation saves publish only acknowledged values; failed/uncertain saves retain
drafts and explicit display-only retries. Cached collections carry no authority.
Preserve the frozen signed 0.1.13 release. Milestone B adds extension-local,
versioned destination drafts and separate frozen batch/display receipts through
the existing Vault commands. `docs/destination-polish.md` owns draft persistence,
reconciliation, category identity and display-only recovery. Categories remain
presentation; Home organization is owned by Milestone C and visual polish is now
authorized by Milestone D without changing functionality or authority.

D32 adds private Firefox release tooling; `docs/firefox-private-release.md` owns
identity, privacy declarations, source archives and unlisted signing. Preserve
`atlas-development@atlas.invalid`. Build/validation never submit; signing requires
credentials and explicit user authorization. Release tooling stays outside Core.
`docs/firefox-backup.md` owns temporary-to-signed migration instructions.
After signing, use `release:verify-signed` to check preserved artifacts offline;
never rebuild/resubmit a signed version to fix verifier code. D32 permits only
manifest whitespace changes outside strings, known signature files, and local
`.amo-upload-uuid` in post-sign staging. All runtime hashes remain enforced.

Local Windows deployment tooling is separate in `scripts/`; its contract and
isolated tests are in `docs/windows-deployment.md`. It reuses signed-release
verification, validates existing policy without editing it, and atomically replaces
only the managed XPI after UAC and hash checks. Development never authorizes live
deployment, profile changes, or signing.

The development UI stability pass is owned by `docs/ui-stability.md`. Keep one
visible-page refresh loop, silent unchanged presentation reads and stable DOM
identity. Retained UI data only queues intent through the ordinary Core gate;
initial loading, failure and uncertainty remain conservative. Signed 0.1.15 stays
frozen and no release/deployment operation is authorized by this pass.

The user subsequently authorizes unsigned 0.1.16 release preparation containing
the UI stability fixes. `docs/firefox-private-release.md` owns packaging and
verification. Keep signed 0.1.13–0.1.15 frozen; signing, submission and installed
Firefox changes remain separate user operations.

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
