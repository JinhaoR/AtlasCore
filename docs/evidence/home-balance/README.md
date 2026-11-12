# Home balance and category ordering — development evidence

Home now uses the Atlas logo/wordmark and centers its content below the navigation
header. Verified-empty Greylist remains absent; one 64px row expands to two
(128px), then scrolls for further rows. Narrow layouts retain accessible document
scrolling and labelled pins. Completed change receipts no longer appear at the
bottom of All Sites; stored receipts and unresolved recovery controls remain.

The All Sites selector offers Alphabetical, Most used (summed existing decayed
site scores), and Custom. The initial custom arrangement comes from legacy layout.
A drag or Alt+arrow move selects Custom in the same CAS write as the new order.
Modes and custom keys live in a separate presentation record; rename membership
evidence reuses legacy layout validation. No Core/adapter/authority change.

## Verification

- Development build including both TypeScript compilers passed.
- All 676 extension tests and 253 Core tests passed.
- Eight new ordering tests cover validation, usage/ties, rename/partial moves,
  reopen, legacy record independence, failures/uncertainty, conflicts and recovery.
- One added drag test holds the preview through a deferred save; the completed
  receipt test now verifies hidden history with retained storage.
- Firefox 160.0, isolated synthetic profiles: alphabetical/usage/custom modes,
  real pointer drop, automatic Custom selection, reload and full restart passed.
- Drop frame tracing observed 0px excursion for the two moved cards after the
  preview settled. The former code cleared transforms before async save; the new
  owner commits the DOM order and transform reset together.
- At 1752×1202, Home workspace gaps within the area below navigation were
  161.68px above and 161.70px below. One/two/three sample rows measured
  64/128/128px viewport height, with content heights 64/128/192px.
- Neighboring native regressions covered real gated pin launch, floating search,
  modal focus/Escape, dirty drafts, invalid fields, Greylist explicit confirmation,
  failed cancellation, active termination, no wheel fade, and restart preservation.
- 1488×1143, 980×850, 540×850 and Firefox 125%/200% zoom passed without horizontal
  overflow. Screenshots were inspected. Idle pin nodes/resources stayed stable.

## Compass investigation and limits

Three matched headless runs before and after recorded median rAF intervals around
6.06ms and p95 around 6.08ms. All runs recorded zero per-pin style writes and 213
total style mutations during the synthetic gesture. No consistent regression or
60 FPS limit was reproduced, so the motion code was left unchanged.

Firefox schedules requestAnimationFrame before repaint, generally matching the
display refresh rate. Atlas uses elapsed time, not a fixed degrees-per-frame
increment. See [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).
Headless sampling does not measure a physical 144 Hz display's compositor/output,
mouse hardware, drivers, or mixed-refresh monitors. Perceived clunkiness on the
user's setup remains unconfirmed; this report does not claim it fixed.

## Evidence and boundaries

- `result.json`: final ordering/layout/frame/restart results.
- `frames-before.json`: preserved pre-change frame measurements.
- `regressions.json`: neighboring native flows and screen sizes.
- `home-empty.png`, `home-two-rows.png`, `directory-custom.png`,
  `directory-most-used.png`, `home-540.png`, `directory-540.png`,
  `home-zoom-2.png`: native screenshots. Two-row geometry uses presentation-only
  sample rows; actual Greylist state transitions are covered separately.
- `integrity.json`: release/source boundaries compared with task checkpoint.

Task checkpoint and logs are in `.tools/home-balance`. No version bump, packaging,
signing, submission, deployment, commit, everyday-profile or policy changes.
All 438 existing release files, including prepared 0.3.0, remain unchanged.
This development build is newer than that frozen candidate. The historical
INTERNAL_ERROR remains outside this presentation change.
