# Firefox public-site checks

Checked on 2026-09-30 with Firefox 157.0 on Windows, using the Atlas prototype and a fresh disposable profile. These checks exercise public entry pages and navigation authorization. **No account identifiers, passwords, consent grants, MFA, or authenticated return were submitted or tested.**

The [investigation script](../extension/scripts/firefox-public-sites.py) starts an explicit Journey for each configured root. It uses the real extension, controller, and IndexedDB repository. Public selectors in this script are test aids; the adapter contains no provider rules.

## Observed results

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
