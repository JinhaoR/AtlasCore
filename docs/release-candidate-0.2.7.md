# Atlas Firefox 0.2.7 — unsigned signing candidate

Packages the completed Home refinements and failed-navigation presentation fix.
Signed 0.2.6 and every earlier artifact remain frozen. Preparation does not sign,
submit, deploy, change enterprise policies or access the everyday Firefox profile.

## Changes since signed 0.2.6

- Compass artwork rotates with the pin positions; website logos stay upright.
  Recent pointer timestamps determine release velocity. Gentler, frame-rate-
  independent friction stops within four seconds. Reduced motion, cancellation,
  page hiding and authority loss retain their stop behavior. No saved order changes.
- Home starts closer to the navigation. A distinct **Greylist (count)** box fits
  two ordinary rows and scrolls additional requests/grants internally. Journeys
  appear separately, with their original owning contexts and deadlines.
- Home has no Current tab access button and no longer selects the last site it
  opened. Explicit request, Journey and popup access links retain context targeting.
- A Firefox navigation failure no longer misleadingly shows “Choose a tab.” An
  explicit site-home retry uses the existing gate, including current grant scope,
  expiry and Blacklist precedence. Closed failure codes enter bounded diagnostics;
  no browser error text or credential URLs are recorded.

## Integrity and compatibility

The extension ID remains `atlas-development@atlas.invalid`. Core source,
authorization rules, authority storage, protected timings, policy defaults,
permissions, dependencies and relative Home/new-tab overrides are unchanged.
No storage migration or permission expansion occurs. Existing policy, settings,
pending requests/grants/proposals, pins, categories, icon choices, named pages,
bookmark connections and editable drafts remain compatible with signed 0.2.6.

The optional toolbar bookmark connection remains presentation-only. It still
deletes matched synchronized toolbar bookmarks when explicitly unpinned; folders
are untouched. Its existing pre-0.2.6 downgrade limitation is unchanged. Use a
closed-profile backup for full presentation recovery; portable policy backup is
not a replacement for it.

## Verification and remaining limits

[Package evidence](evidence/firefox-release-0.2.7.json) records complete regression
suites, TypeScript/build, runtime inventory/lint, reviewer-source reproduction and
isolated signed-0.2.6 upgrade, restart and rollback. Native packaged Home and
navigation-error fixtures complement [development Home evidence](evidence/home-motion/README.md)
and [navigation-failure evidence](evidence/navigation-failure/README.md).

The historical intermittent **INTERNAL_ERROR remains unresolved**. The original
YouTube Firefox-launch rejection was not reproduced from the user's live session;
controlled failure/retry tests verify handling, not that original trigger. No
automatic retry, scope widening or recovery bypass is introduced.

Native Windows checks use disposable profiles and a temporary unsigned overlay;
they do not certify Mozilla's eventual signed update or touch/trackpad, screen-
reader or other-OS behavior. Home layout-status fixtures inject test replies only
into their control page. The separate navigation fixture uses real Core gates,
waits and confirmation with a controlled browser-effect failure. Idle wheel
observations showed no extra mutations/resources; no load-time improvement is
claimed. Small or highly zoomed windows retain accessible document scrolling.

## Artifacts and separate signing step

```text
extension/release/0.2.7/
  addon/
  atlas-0.2.7-unsigned.zip
  atlas-0.2.7-source.zip
  release.json
```

After securely supplying Mozilla credentials in your terminal environment, run
from the repository root:

```powershell
npm.cmd --prefix extension run release:validate
npm.cmd --prefix extension run release:sign
```

Only `release:sign` submits to Mozilla's **unlisted** channel. Preparation does
not run it. The signed output will be `extension/release/0.2.7/signed/*.xpi`.
After approval, verify without resubmitting:

```powershell
npm.cmd --prefix extension run release:verify-signed -- 0.2.7
```

Back up and update in place under the same ID without uninstalling. Deployment
remains a separate action.
