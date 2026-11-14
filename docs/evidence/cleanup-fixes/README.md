# Cleanup and Add Site checks

Current scope and removal rationale: [cleanup report](../../repository-cleanup.md).
All native runs used Firefox 160.0, isolated profiles and synthetic data.

| Check | Result |
| --- | --- |
| Development build / both TypeScript compilations | PASS |
| Core suite | 253 passed, no skips |
| Extension suite | 687 passed, no skips |
| Deployment suite | 35 passed, no skips; synthetic directories, real signed 0.2.8 source verification |
| [Add Site native scenario](add-site.json) | Shared-suffix explanation and disabled scope; real tenant checkbox click; staged scope survives reload; policy/configuration unchanged |
| [Theme native scenario](themes.json) | Both themes, local compass assets, plain Home/All Sites, pin launches, rotation, warm switches, narrow/zoom layouts and full restart |
| [Integrity](integrity.json) | 93 protected files unchanged: 24 Core sources, five compass SVGs and 64 files in the retained 0.2.8/0.3.0 releases |

Inspected final screenshots:

- [Parchment Home](parchment-home.png)
- [Celestial Home](celestial-home.png)
- [Plain All Sites](parchment-categories.png)
- [GitHub Pages scope explanation](add-site.png)

The initial native reproduction confirmed that `github.io` is intentionally
ineligible while a registered tenant hostname accepts the real pointer click.
The repair improves explanation without changing eligibility, Core or Vault.
The new scenario initially used an outdated readiness marker and omitted the
before/after text in its review expectation; those fixture assertions were
corrected to the actual current UI. The final scenario passes in a fresh profile.

Warm theme selection retains pin/SVG nodes and records zero child-list mutations,
application messages, scripted fetches and image-src assignments within that
transaction. Saved theme selection survives reload/full restart. These are
behavior checks, not cold-cache paint/FPS measurements. Native Greylist screenshots
use presentation samples; they do not replace authorization tests.

```text
npm.cmd --prefix extension run build
npm.cmd --prefix packages/core run test:built
npm.cmd --prefix extension run test:built
node --test scripts/tests/deployment.test.mjs
python extension/scripts/firefox_compact_home.py --site-checkbox-only
python extension/scripts/firefox_compact_home.py --theme-prototypes-only
node extension/scripts/verify-bundle.mjs extension/dist
```

Retained release bytes were compared before and after. No new packaging, signing,
deployment or everyday-profile changes. Upgrade/rollback and provider-login
scenarios were not rerun for this text/asset cleanup; required migrations and
their regression tests remain. Older signed native baselines are now external
prerequisites, as documented in the version history. Task-created Firefox and
deployment fixture directories are removed after retaining these results.
