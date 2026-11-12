# Selected-tab navigation failure

Development repair after signed 0.2.6. The reported YouTube launch showed
`NAVIGATION_FAILED`, navigation zero, and a selected hostname, but the page said
“Choose a tab” and offered no action. The user confirmed temporary access was
already active and that manually opening `www.youtube.com` worked.

## Confirmed finding

The access page passed a null decision to its no-selection presenter whenever
the adapter returned a browser error. A rejected `tabs.update` before the request
gate reproduces the exact navigation-zero state. The failure does not remove a
saved grant. The original Firefox rejection reason is unknown; this is a verified
UI recovery fix, not a claim that the underlying intermittent browser failure
has been eliminated or that apex/www permissions should automatically merge.

The page now explains the failed navigation and offers **Try site home again**.
That existing command retries the same context's origin home through the normal
Core gate. It never confirms access, renews a grant, replays a private task URL,
or substitutes another tab. Launch failures also enter the existing bounded,
hostname-only diagnostic log. Raw browser exceptions stay private.

## Verification

- Development TypeScript compilation and bundle passed. The bundler needed the
  existing sandbox workaround for reading parent directories; no dependency or
  build configuration changed.
- Complete built suites: **626 extension tests, 249 Core tests passed**.
- Five focused regression tests cover truthful failure/checking/no-selection
  states, gated retry, exact apex/www behavior, Blacklist, closed tabs, late
  rejection races, unchanged grant deadlines, expiry and diagnostic privacy.
- [Native Firefox 159.0.1 results](native.json), using a disposable runtime/profile
  over signed 0.2.6 and a local server: rejected launch shows the retry; unknown
  and blocked retries never reach the server; an exact Allowed host does; an
  explicitly confirmed existing grant authorizes retry without changing its
  saved terms. Unavailable authority disables the action.
- Native rejection was deliberately injected into that background's Firefox API.
  The retry requests, Core decisions, real waiting period and confirmation used
  production logic. The initial test assertion compared `lastObservedAt` as
  well as saved terms and failed because real time advanced; the final fixture
  checks the unchanged terms and monotonic observation separately.
- All **342 existing release files** retain their task-start hashes. All **24
  Core source files** remain byte-identical to the checkpoint. No version,
  identity, permission, persistence, installed profile or enterprise policy change.

Screenshots: [failure and retry](navigation-failed.png),
[ordinary Greylist after retry](retry-greylist.png).

Run after the development build:

```text
node --test extension/tests/navigation-failure.test.mjs
python extension/scripts/firefox_compact_home.py --navigation-failure-only --signed-baseline 0.2.6
```

The development build is updated; nothing was packaged, signed, submitted or
installed into the everyday profile. The historical `INTERNAL_ERROR` is unrelated
to this confirmed presentation defect and remains unresolved.
