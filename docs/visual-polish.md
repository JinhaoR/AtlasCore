# Milestone D: visual consistency and UI polish

## Scope recorded before styling changes (2026-10-12)

The user now authorizes the previously deferred visual milestone. Keep the
parchment surfaces, olive accents, serif headings, compact 54px launchers,
five-column cap and permanent rail. Home information architecture and all A/B/C
storage and authorization contracts remain intact. No version, dependency,
permission, release, normal-profile or enterprise-policy changes are authorized.

Capture a matching native Firefox baseline before changing UI source. The
disposable fixture includes five/fifteen/thirty categories, pins, search, long
lists and labels, a real destination editor, ten mixed staged changes, a frozen
proposal, settings, diagnostics, Greylist wait/confirmation/grant, Journey
continuation/recovery, Blacklist and unavailable authority. All data is synthetic.

Demonstrated source issues to measure in the baseline include 10–11px operational
labels, low-contrast search hints/placeholders and pin glyphs, 22–23px icon targets,
and repeated role/feedback attribute writes. Baseline screenshots will distinguish
actual alignment/overflow defects from subjective density improvements.

Consolidate a modest token set for color roles, type, spacing, surfaces and controls.
Retain the current UI modules. Refine the large Home masthead, form rhythm,
editor/batch hierarchy, Vault review, settings and decision surfaces. Any handler
change must address a concrete focus, announcement or validation defect. Appearance
does not create permissions or alter draft/confirmation behavior.

Use the existing native harness:

```sh
python extension/scripts/firefox-e2e.py --visual-polish-only --visual-baseline
python extension/scripts/firefox-e2e.py --visual-polish-only
```

The baseline flag records known visual weaknesses; it never relaxes authorization
checks. Compare matching desktop/narrow screenshots, then refine and repeat.
Measure 500/768/1080/1440/1800px layouts and actual 125/150/200% Firefox zoom.
Keep contrast/target/focus observations separate from full accessibility conformance.

## Visual assessment

The baseline was captured before UI changes. A frozen copy of that public runtime
was retained for repeatable matching captures; no profile or saved authority was
copied. The final comparison uses synthetic data and actual Firefox rendering.

Demonstrated problems:

- Settings units/current values were 10px; search-result hostnames were 11px.
- The search placeholder measured 3.68:1 contrast. Small supporting text and tiny
  pin glyphs did not consistently have an appropriate readable treatment.
- Pins were 23px targets; text actions were about 19px tall.
- Invalid hostnames produced a distant general message without field association
  or focus. An invalid additional hostname could be retained inside a closed
  disclosure.
- Identical feedback rewrote live-region attributes during polling.
- An allowed destination still had a page-level heading saying it was waiting.
- A frozen batch retained an “Editable” badge. It now reports frozen submission,
  completed local batch, loading or unavailable state from the existing receipt.

The baseline already had no page overflow in the measured layouts. Compact cards,
icons, the permanent rail, category identity/order, keyboard controls and explicit
policy terms were strengths. These were preserved.

Density choices are aesthetic refinements: the smaller Home masthead, opaque warm
surfaces, shorter empty draft panel, related editor fields in two desktop columns,
and quieter access summaries. They are not reported as authorization defects.

## Implementation

`extension/src/ui/assets/style.css` owns a small shared token set for paper/surface/
stone, text/muted/interactive colors, selection, success/warning/error/unavailable,
fonts, spacing, radius, control height and motion. Supporting operational text is
13px; labels/controls are 14px; body text is 15px. Georgia remains the heading
font; exact hostnames and technical detail use the existing monospace family.
Countdowns keep tabular numerals. Decorative eyebrows remain smaller.

Primary controls have a 40px minimum height; compact and text actions use 32px;
pins and entry-point disclosures use 24px without enlarging the 54px launcher
(56px including the card border). Input and secondary-button boundaries have a
separate contrast role. Focus uses a 2px outline. Native checkboxes, selects,
disclosures and browser validation remain. Reduced motion disables transitions;
forced colors retain native control borders and Highlight focus outlines.

- **Home/customization/search:** shorter masthead and consistent heading alignment,
  visible search hint/placeholder, larger icon targets, readable ordering controls
  and compact status rows. C's one-to-five columns and full collapse remain.
- **Sites/editor:** a verified empty local workspace hides inactive batch actions;
  any draft, receipt, loading/failure/conflict keeps the full workspace available.
  Related fields share desktop rows and stack in narrow windows. Inline field
  errors carry `aria-invalid`, an associated alert and focus; hidden invalid
  additional hosts reveal their native disclosure before focus. Values remain.
- **Batch/reconciliation/Vault:** affected names lead each row, full exact scopes,
  classification changes and display terms remain readable. Workspace labels now
  distinguish editable and frozen work without implying current authority. Narrow
  action groups can share a row. Waiting/ready/expired Vault labels have distinct
  state treatment.
  Review, confirmation, cancellation, receipts and conflict handling are unchanged.
- **Settings/diagnostics:** consistent field widths, readable units/current values,
  shared form rhythm and secondary technical disclosures. Table scrolling remains
  contained rather than making the whole page scroll horizontally.
- **Decision/grant/Journey:** plain-language outcome labels, neutral page heading,
  explicit exact scope and original countdowns. Invalid authority is styled as
  unavailable rather than an explicit policy block. “Allowed” describes the Atlas
  decision and does not claim network success. The passive website indicator uses
  the same palette/type/radius; its lease and security checks are unchanged.
- **Stable status rendering:** `feedback.ts` changes live-region attributes/text
  only when values change and uses atomic status/alert semantics. No rendering
  architecture or authorization operations were added.

Source files under `extension/src`: `ui/assets/style.css`, `ui/assets/index.html`,
`ui/main.ts`, `ui/presentation.ts`, `ui/feedback.ts`, `ui/sites.ts`, and
`content/journey-indicator.ts`. Tests use `extension/tests/visual-polish.test.mjs`,
`extension/tests/support/ui-fixture.mjs`, and
`extension/scripts/firefox_visual_polish.py` through the existing `firefox-e2e.py`
runner. The retained `extension/scripts/firefox_destination_polish.py` fixture
also waits for the rendered editor after receipt acknowledgement.
Generated development assets are rebuilt. README, AGENTS, foundation, architecture,
UI-design and acceptance documents link this owning report.

## Before/after screenshots

All paths are relative to the repository root. Each linked desktop screenshot is
1440×915 native pixels. The same names with `-500.png` provide narrow comparisons.

| Surface | Before | After |
| --- | --- | --- |
| Home | [docs/evidence/milestone-d/before/home-1440.png](evidence/milestone-d/before/home-1440.png) | [docs/evidence/milestone-d/after/home-1440.png](evidence/milestone-d/after/home-1440.png) |
| Customize Home | [docs/evidence/milestone-d/before/customize-1440.png](evidence/milestone-d/before/customize-1440.png) | [docs/evidence/milestone-d/after/customize-1440.png](evidence/milestone-d/after/customize-1440.png) |
| Sites & Access | [docs/evidence/milestone-d/before/sites-1440.png](evidence/milestone-d/before/sites-1440.png) | [docs/evidence/milestone-d/after/sites-1440.png](evidence/milestone-d/after/sites-1440.png) |
| Editor | [docs/evidence/milestone-d/before/editor-1440.png](evidence/milestone-d/before/editor-1440.png) | [docs/evidence/milestone-d/after/editor-1440.png](evidence/milestone-d/after/editor-1440.png) |
| Batch review | [docs/evidence/milestone-d/before/batch-review-1440.png](evidence/milestone-d/before/batch-review-1440.png) | [docs/evidence/milestone-d/after/batch-review-1440.png](evidence/milestone-d/after/batch-review-1440.png) |
| Vault | [docs/evidence/milestone-d/before/vault-1440.png](evidence/milestone-d/before/vault-1440.png) | [docs/evidence/milestone-d/after/vault-1440.png](evidence/milestone-d/after/vault-1440.png) |
| Settings | [docs/evidence/milestone-d/before/settings-1440.png](evidence/milestone-d/before/settings-1440.png) | [docs/evidence/milestone-d/after/settings-1440.png](evidence/milestone-d/after/settings-1440.png) |
| Greylist | [docs/evidence/milestone-d/before/greylist-1440.png](evidence/milestone-d/before/greylist-1440.png) | [docs/evidence/milestone-d/after/greylist-1440.png](evidence/milestone-d/after/greylist-1440.png) |

Additional sanitized captures cover search, 15/30 categories, long hostnames, a
failed presentation save and retry, field errors, reconciliation, frozen terms,
diagnostics, confirmation, active grants, Journey/indicator/recovery, Blacklist,
unavailable authority, hover, keyboard focus and zoom. Review used desktop and
narrow screenshots at their intended sizes, then refined cramped narrow batch
actions, neutral access copy, hover specificity and control-boundary contrast.

The native harness waits for the rendered owning-tab option before selecting a
new context: a direct GET_VIEW probe can arrive earlier than the UI poll. The
retained destination-polish fixture likewise waits for enabled editor controls;
a completed receipt can precede the next UI render. These are fixture corrections,
not adapter or authorization changes. All confirmation and proposal commands
continue through the real controller; no authorization assertion was removed.

## Verification

Core: **204/204**; extension: **352/352**, including **ten new regressions**;
no skips. Both TypeScript checks, development build and distribution-integrity
verification pass. Unit regressions cover stable live regions, status roles,
invalid-host focus and retained work, a closed invalid-host disclosure, truthful
empty/failure workspace state, accurate editable/frozen/completed/loading badges,
and plain-language decisions without state mutation.

Native evidence: matching before/after captures, 500/768/1080/1440/1800px windows,
actual 125/150/200% Firefox zoom, 5/15/30 categories, large drafts, exact long hosts,
real Greylist wait/confirmation/grants, Journey ownership/recovery, keyboard focus,
reduced motion and storage failures. All runs use Firefox **157.0.1** and
disposable profiles. The final visual run passes **eight check groups**, retains
**56 after screenshots** and **69 responsive observations**, and reports no page
overflow. The frozen baseline retains **43 before screenshots** and 57 layout
observations. [Before result](evidence/milestone-d/before/result.json),
[final after result](evidence/milestone-d/after/result.json).

Sampled operational text has a minimum size of **13px** and minimum contrast of
**5.18:1**; the search placeholder improves from **3.68:1 to 6.00:1**. Measured
compact targets are at least **24×24px**; primary controls retain their larger
40px height. Sampled enabled input/select/secondary-button boundaries have at
least **3.30:1** contrast against the composited surface. These are computed
browser observations for the named selectors/states, not an audit of every pixel
or disabled/native control. Focus is visibly outlined and reduced-motion testing
observes zero control-transition duration. Cards remain 56px including borders,
with no pin/entry-point overlap and at most five columns.

Retained native regressions pass **99 groups/scenarios** in addition to the eight
visual groups: UI reliability **6**, destination batch **9**, Home organization
**14**, coherence **6**, destination polish **5**, Journey/authentication **16**,
Journey retry **14**, baseline navigation **12**, downloads **17**. Coverage includes
real process restarts, competing control pages, failed presentation saves/retries,
frozen terms, explicit confirmations, current policy checks and request withholding.
Download tests verify native completion and exact synthetic file bytes, plus
HTML withholding, Blacklist, redirect bounds, expiry, policy change, source closure
and background restart. [Regression summary](evidence/milestone-d/regressions.json)
records each suite separately from historical milestone evidence.

Final project checks:

```sh
npm --prefix packages/core run typecheck
npm --prefix extension run typecheck
npm --prefix packages/core test
npm --prefix extension test
node extension/scripts/verify-bundle.mjs extension/dist
node extension/scripts/release.mjs verify-signed 0.1.14
```

`extension test` runs the actual development build before testing. Native suites
use the existing `firefox-e2e.py` scenario flags plus `firefox-downloads.py`; the
visual commands are recorded above. Verification never signs or submits a release.

## Compatibility and remaining limits

Core authorization, adapter gating, download semantics, wait/confirmation/grant/
Journey deadlines, Vault/draft transitions, C organization/navigation and all
storage schemas remain unchanged. There is no data reset or migration, new runtime
dependency, permission, framework, release version or extension-ID change.
`atlas-development@atlas.invalid` remains the identity. Signed 0.1.14 passes
offline verification with SHA-256
`88b699c0b23542228cee490f3cc046abeebf326ef94e3fe4560bb21cf79f5ff1`.
No signing, submission, installation, normal-profile access or enterprise-policy
change occurred.

No major visual defect is known in the measured states. Small imperfections remain:
very long launcher names intentionally truncate while retaining accessible labels;
at high zoom, large exact-scope reviews need vertical scrolling; online site icons
can appear after text, with their reserved slot preventing card-size changes.
Dedicated screen-reader, physical high-density monitor, OS forced-color and
power-loss testing were not performed. Sampled contrast/targets and keyboard/zoom
checks are evidence toward WCAG 2.2 AA, not a full conformance claim. An optional
future enhancement is a user study of editor density; it does not require changing
the batch or authorization architecture.
