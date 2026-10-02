# Firefox public-site checks

## D22 follow-up (2026-10-02)

The user clarified that `app.kth.se` is the blocked target after clicking Login on a loaded Canvas page. This led to explicit approval of one browser-attested departure from a loaded Pure Whitelist root. The [Journey polishing report](firefox-journey-polish.md) owns the current rule and native before/after evidence. Earlier D18 compatibility limits below remain historical measurements.

A fresh-profile public Canvas course entry reached `saml-5.sys.kth.se` and `login.ug.kth.se` with ACTIVE_JOURNEY in `.tools/auth-enforcing-5w01b71h/result.json`. It stopped at the credential form. That profile did not reproduce the user's existing-session Canvas header/Login state. A separate public `app.kth.se` root probe was allowed and exposed no Login control; it tested the target directly and therefore did not diagnose the reported Canvas departure.

The final synthetic Firefox scenario reproduces loaded root → direct unlisted auth entry → HTTP providers → root, with links, POST and script navigation. The previous strict build denied its first departure; 0.1.2 completes it with fixed Journey terms and no policy/grant changes. This verifies the reported navigation shape, not authenticated Canvas/KTH completion. No provider was added to the production whitelist.

The [2026-10-01 navigation/authentication investigation](firefox-auth-investigation.md#3-real-public-flows) adds event-level enforcing/passive comparisons for Canvas, KTH webmail, Gmail, Microsoft/Outlook, Overleaf, GitHub and Ladok. It includes sanitized traces and explains the post-arrival compatibility gap without changing Core rules.

Checked on 2026-09-30 with Firefox 157.0 on Windows, using the Atlas prototype and a fresh disposable profile. These checks exercise public entry pages and navigation authorization. **No account identifiers, passwords, consent grants, MFA, or authenticated return were submitted or tested.**

The [investigation script](../extension/scripts/firefox-public-sites.py) starts an explicit Journey for each configured root. It uses the real extension, controller, and IndexedDB repository. Public selectors in this script are test aids; the adapter contains no provider rules.

## Historical D16 results (2026-09-30)

| Service | Observed top-level path | Evidence and limit |
| --- | --- | --- |
| Ladok | `student.ladok.se` → `service.seamlessaccess.org` | The public login action reached the discovery service with ACTIVE_JOURNEY. The probe did not complete institution selection, including after checking accessible search controls and open shadow roots. University selection from Ladok remains unverified. |
| Google / Gmail | `mail.google.com` → `accounts.google.com` | Google's identifier field was visible; Core returned ACTIVE_JOURNEY for the intermediate. Stopped before entering an account. |
| Microsoft work/school | `myaccount.microsoft.com` → `login.microsoftonline.com` | A credential entry form was visible with ACTIVE_JOURNEY. Tenant discovery and later account-specific redirects remain untested. |
| ORCID | `orcid.org` | The sign-in form was visible and Core returned WHITELISTED. This establishes ordinary destination accessibility; it does not exercise institutional federation or an intermediate hop. |
| KTH Canvas | `canvas.kth.se` → `saml-5.sys.kth.se` → `login.ug.kth.se` | The university credential form was visible after two intermediate hops with ACTIVE_JOURNEY. Stopped before authentication. |

For every case, the saved policy was unchanged, no Access grant was created, and diagnostic observations retained the Journey's original deadline. For all four paths with ACTIVE_JOURNEY intermediates, explicit cancellation ended the Journey, Core returned GREYLIST, and Firefox replaced the intermediate document with Atlas's private page.

These are observed paths in one environment, not a list of domains to trust or a promise about other providers, universities, accounts, or future redirects. No domain exception was added to pass a check.

## Reproduction and artifacts

```sh
npm --prefix extension run test:public-sites
```

For a targeted check after building, use `python extension/scripts/firefox-public-sites.py --case N`: 0 Ladok, 1 Gmail, 2 Microsoft, 3 ORCID, 4 KTH Canvas. Public services change, so this is optional investigation rather than a deterministic CI test.

The combined run is in ignored `.tools/firefox-public-cndyd2wg/result.json`; the final focused Ladok probe is in `.tools/firefox-public-lfnsvrea/result.json`. Only hostname diagnostics, workflow state, and form-presence facts are retained. Raw browser output is suppressed, and disposable profiles are removed after the run. No normal Firefox profile is used.

The separate [local native scenario](../extension/scripts/firefox-e2e.py) tests a complete synthetic return path, Greylist confirmation through real UI buttons, withheld requests, and restart. It supplies repeatable adapter evidence without needing real accounts. A complete synthetic path does not establish an authenticated provider flow.

## Public entry-point references

- KTH documents [Ladok access](https://www.kth.se/en/student/it/studenttjanster/ladok) and links its [Canvas service](https://canvas.kth.se/).
- Google's [Gmail sign-in instructions](https://support.google.com/mail/answer/8494?hl=en-GB) identify the service entry point.
- Microsoft's [account sign-in guidance](https://support.microsoft.com/en-us/accounts-billing/manage/how-to-sign-in-to-a-microsoft-account) distinguishes personal and work/school entry points.
- ORCID provides a public [sign-in page](https://orcid.org/signin).

## Follow-up validation

Use dedicated test accounts for authenticated returns, MFA, popups, cancelled sign-in, and account-specific redirect branches. First complete Ladok institution selection manually to distinguish probe limitations from a provider or adapter issue. Record only sanitized navigation facts; keep credentials, cookies, and full authentication URLs out of reports. Core remains unchanged unless a separately reviewed domain contradiction is found.

## D18 strict Journey checks (2026-10-01)

The current build was checked again in a fresh Firefox 157.0 profile. Sanitized evidence is in `.tools/firefox-public-owwu23pl/result.json`; raw logs were suppressed and the disposable profile was removed. Policy remained unchanged and no Access grants were created. Per-Journey IDs retained one fixed deadline; a new deliberate root request can create a separate attempt after the previous root document arrived.

| Service | Current strict result |
| --- | --- |
| Ladok | Reached `service.seamlessaccess.org` through permitted continuation. Institution selection was not completed; public discovery may include embedded UI outside the governed top-level boundary. |
| Gmail | Reached `accounts.google.com` and observed an identifier form with ACTIVE_JOURNEY. |
| Microsoft work/school | `myaccount.microsoft.com` committed a root document and ended REACHED. A subsequent request to `login.microsoftonline.com` had no accepted active HTTP-chain authority and returned GREYLIST. This is an observed compatibility limit of the approved strict model; no provider exception was added. |
| ORCID | Destination credential form was visible under WHITELISTED; root arrival ended the Journey. |
| KTH Canvas | HTTP continuation reached `saml-5.sys.kth.se` then `login.ug.kth.se`; credential form visible under ACTIVE_JOURNEY. |

Permitted intermediates were also cancelled and removed. These public entry checks establish neither real-account authentication nor post-login compatibility. Microsoft page-driven navigation and Ladok institution selection need a future explicit product decision if broader continuation is desired. Existing native fixtures and adapter tests establish consistent common gating across navigation origins; these public probes use Atlas Open.

A separate credential-free HEAD request to Overleaf's public homepage observed `308 overleaf.com -> www.overleaf.com`, then `200 www.overleaf.com`. D18's explicitly declared alias scope fixes that exact-host Greylist transition for a new request. No global www rule or authentication/provider database is introduced.
