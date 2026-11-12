# Greylist cancellation and compass flash repair

Development repair after signed 0.2.8; no version bump or release packaging.

## Changes

- One red Cancel button sits left of Request access, Waiting, Allow and Active.
  Unstarted prompts dismiss locally; pending requests use CANCEL_ACCESS; grants
  use END_ACCESS. Waiting is status only. Allow still requires an explicit click;
  the active green button opens the site through OPEN_DESTINATION.
- Only acknowledged cancellation removes the selected context route. Context and
  navigation checks prevent clearing a newer route. Removing intercepted URL
  parameters prevents the cancelled request prompt from returning on reload.
  Failed or uncertain results preserve the request and retry action.
- The flash was disabled-button opacity during the shared busy state, not pin
  replacement. Pins remain disabled during local actions but retain their normal
  opacity while authority is verified. Actual authority loss still dims them.

## Verification

- Development build and both TypeScript checks passed.
- Complete extension suite: 662 passed, including six Greylist-control tests.
- Disposable native Firefox 160.0 profiles reproduced the old behavior against
  frozen 0.2.8 runtime assets and verified the repair. See before.json/after.json.
  The harness delayed message delivery by 180 ms to observe the busy state; it
  did not change Core clocks. Observed pin opacity changed from `1, 0.6` to `1`,
  retaining the same DOM node. Buttons remained disabled during the operation.
- Native checks covered unstarted dismissal, waiting cancellation, failure/retry,
  real waiting-to-ready transition, explicit confirmation, active grant ending,
  and no recreated rows after refresh/reload. A synthetic WRITE_FAILED response
  verified that failed cancellation retains the original pending request.
- Retained screenshots: waiting, ready, active, failed-cancel and cancelled-clean.
  Waiting and active screenshots were visually inspected at 1488 x 1058.

Core source, all 406 existing release files, extension identity, installed browser
profile and policies remain unchanged. The full Core suite was not rerun for this
presentation-only repair. Native verification uses synthetic local sites; it does
not claim physical-display smoothness across devices or new narrow-screen checks.
The historical INTERNAL_ERROR remains unresolved and outside this repair.

Reproduce with `extension/scripts/firefox_compact_home.py --greylist-controls-only
--signed-baseline 0.2.8`. Add `--greylist-controls-baseline --addon-dir
extension/release/0.2.8/addon` for the old-behavior comparison.
