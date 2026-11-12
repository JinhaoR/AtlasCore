# Bundled scope update verification

Development after signed 0.2.7; no version bump, signing or deployment.

- Development build / TypeScript: passed.
- Core: 253 tests passed. Extension: 651 tests passed, including 15 new scope,
  persistence, compatibility and grouping tests.
- Native Firefox 160.0: passed the isolated signed-0.2.7 upgrade and full restart.
  See `native.json`, `sites-merged.png`, `exact-child-search.png` and
  `home-preserved-pins.png`. Browser evidence uses synthetic data only.
- All 374 pre-existing release files retain their SHA-256 hashes. Core source,
  manifest, version and extension identity are unchanged from the task checkpoint.

Commands:

```text
npm --prefix extension run build
npm --prefix packages/core run test:built
npm --prefix extension run test:built
python extension/scripts/firefox_compact_home.py --curated-scopes-only --signed-baseline 0.2.7
```

The native fixture applies policy through the existing Vault on signed 0.2.7,
stages a local draft and a frozen proposal, then overlays the development build.
It checks literal policy preservation, new scope roots, retained presentation
records, grouped child search and real Google Greylist interception. A full restart
checks the same one-time receipt and saved records. Core clock/revision observation
fences may advance normally; frozen workflow contents are not rewritten.

Two initial fixture attempts failed their assertions: the first compared normal
observation fences byte-for-byte, and the second compared presentation state
without retained before/after evidence. The final run retains matching state
comparisons and passes. These are synthetic upgrade checks, not evidence about the
historical intermittent `INTERNAL_ERROR`, which remains unresolved. They do not
claim live authentication success for every newly covered university subdomain.

Task-created disposable profiles/runtime copies are removed after retaining this
evidence. The everyday Firefox profile and installed enterprise policy are untouched.
