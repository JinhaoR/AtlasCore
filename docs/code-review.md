# Code coherence and cleanup (D23)

Reviewed on 2026-10-02 at the user's request: domain logic first, package structure next, then Firefox presentation. This pass retains the approved Policy, Access, Vault and Journey contracts.

## Findings and corrections

| Area | Finding | Correction |
| --- | --- | --- |
| Browser provenance | A committed internal page could leave the previous Whitelisted document's source evidence until housekeeping. A following request could borrow that departed root. | Retire displayed source evidence immediately on a newer non-HTTP arrival. Preserve a newer held request or launch while reconciling the browser event. |
| Repository lifecycle | An IndexedDB open rejected by `onblocked` could later succeed and leak its connection. | Close a connection delivered after open failure; never expose it as authority. |
| Unsaved drafts | A failed UI state query cleared policy textareas, and reconnect could overwrite edits. | Retain drafts and the last verified form baseline while authority is unavailable. Commands remain disabled. |
| Timing proposals | Conversion rounded fractional milliseconds; large active durations could also lose precision when displayed and proposed again. | Parse decimal/scientific input exactly and format integer milliseconds without a floating-point round trip. Core still validates the complete configuration. |
| Access presentation | Scope copy appeared for decisions outside temporary Access; hiding the selected action could leave keyboard focus on an invisible control. | Show scope only for Access flows and move focus to the visible Access heading. Search options retain combobox focus. |
| Feedback | A Settings validation error remained visible after opening Home. | Clear stale feedback on explicit section/access navigation; polling retains current feedback. |
| Documentation | A few current architecture paragraphs still described the implemented controller and general policy editing as future work. | Align status and module ownership with D14, D19/D20 and D22. |

The browser-source and repository regressions failed against the previous implementation before their fixes. The source test covers internal-page replacement with no pending work, a pending launch, and a released flight; both immediate and settled follow-up requests remain conservative. Existing late-initial-blank and delayed-private-page tests continue protecting normal Journey initiation.

## Logic and structure review

Core validation, precedence, frozen scopes/deadlines, explicit confirmation, Vault candidate consumption, revision changes, and commit-before-publication remain coherent with their tests. Failed/conflicting/unknown writes withhold permission; slow saves cannot publish expired temporary authorization. This audit found no justified Core source change.

The two-package structure remains appropriate:

- `packages/core`: common models, validation, pure transitions, planner, controller and injected ports.
- `extension/src/adapter`: Firefox event provenance, context lifecycle and execution of saved Core decisions.
- `extension/src/storage`: transactional repository and managed-data cache.
- `extension/src/ui`: presentation and user intents sent through the private adapter boundary.

`settings-model.ts` now owns timing field metadata, display formatting and draft conversion. `renderSettings` and `renderHome` separate those views from selected-context Access rendering. DOM nodes remain stable during ordinary polling. No dependency, manifest permission, schema, curated policy or public Core API change was needed.

## Verification

Core build/typecheck and **185/185 tests** pass. Extension build/typecheck and **119/119 tests** pass. Five added tests cover browser-source retirement, delayed repository connection cleanup, exact timing input, invalid fractional/unsafe values, and unchanged-setting round trips. Core tests remain browser-independent.

The isolated native Firefox 157.0 run of `--coherence-only` verifies unavailable-state draft retention, disabled commands, reconnect, precision rejection, search/access keyboard focus, clearing stale feedback, a 500-pixel window, actual internal-page replacement, and Greylist waiting without a grant. It preserves policy and configuration. Its [portable report](evidence/firefox-coherence-d23.json) and screenshots are separate from mocked adapter/storage evidence.

The same final 0.1.3 build also passes native `--journey-polish-only` (15 grouped checks) and `--productization-only` (eight grouped checks). These preserve direct/same-host login, fixed deadlines, repeated re-entry, cancellation/restart, context isolation, unrelated navigation denial, stable cards/pins, website icons, frozen Vault review, explicit saved settings activation, migration and reload. The portable report includes both regression summaries.

Previews: [Home](evidence/atlas-home-d23.png), [small screen](evidence/atlas-small-screen-d23.png), [waiting Access](evidence/atlas-access-d23.png), [Settings drafts](evidence/atlas-settings-d23.png).

Run these checks from the repository root:

```sh
npm --prefix packages/core run typecheck
npm --prefix packages/core test
npm --prefix extension run typecheck
npm --prefix extension test
python extension/scripts/firefox-e2e.py --coherence-only
python extension/scripts/firefox-e2e.py --journey-polish-only
python extension/scripts/firefox-e2e.py --productization-only
```

Native Firefox scripts use a fresh synthetic profile and should run serially. Screenshots contain fixture hosts and UI drafts. These checks do not establish authenticated Canvas/SSO completion, exhaustive Firefox event coverage, physical power-loss durability or resistance to a whole-snapshot rollback.

## Loading the cleanup

The built extension is **0.1.3**. Reload `extension/dist/manifest.json` through Firefox `about:debugging` and verify **Atlas extension 0.1.3** in Diagnostics. Saved policy, deadlines and settings retain their existing persistence rules.
