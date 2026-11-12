# Home refresh polish — 2026-11-09

Removed the main control-page connection/readiness indicator and visible category
loading message. Saved Home preferences now load concurrently with authority;
preloading is readonly, and catalog reconciliation still waits for verified data.
No default categories are flashed ahead of saved visibility/order preferences.
The toolbar popup status and actionable recovery warnings remain.

Verification: development build and both TypeScript checks pass; all 594 extension
tests pass, including three new preference-preload cases (saved preferences,
first-run migration, failed read/recovery). Core source and all release artifacts
match the preceding task's 270-file protected inventory. No release was packaged,
signed or installed in the everyday profile.

Native Firefox 159.0.1, disposable profiles, identical six-category fixture:

| Five reloads | Category appearance after navigation (ms) | Median |
| --- | --- | --- |
| Before | 160, 158, 169, 160, 165 | 160 |
| After | 60, 55, 57, 61, 59 | 59 |

The probe records the first animation frame with rendered category shortcuts.
It exists only in disposable runtime copies. These are small local warm-reload
samples, not a guarantee of instantaneous rendering on every machine. Categories
still wait for authority and acknowledged preferences. Header status was absent
on all five updated reloads; the retained screenshot was visually inspected.

Reproduce with `python extension/scripts/firefox_compact_home.py
--home-refresh-only --signed-baseline 0.2.2`. JSON and screenshot evidence are
retained here. Both task-created native profile/runtime directories were removed
after collecting results; no everyday profile or Firefox policy was accessed.
