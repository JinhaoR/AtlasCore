# Firefox navigation and authentication investigation

**Decision update (D19, 2026-10-01):** The user accepted the bounded Whitelisted-server HTTP redirect tradeoff. Preserve D18 and require reproducible real-use evidence before revisiting authorization. The open design discussion below is dated investigation history; [productization.md](productization.md) records the settled product decision.

Status: evidence and recommendations for human review, 2026-10-01. **No Core or production adapter authorization was changed in this pass.** D18 remains the implemented contract. This report owns the findings; it does not approve a new Journey rule.

## Conclusion

Destination document arrival and authentication completion are different events. Microsoft account and Outlook demonstrate that distinction before any credentials are entered. Firefox does not expose a general, trustworthy authentication-complete event, or proof that a cross-host navigation is required for authentication.

**Recommendation: retain destination document commit as the current Journey termination boundary. Do not automatically authorize post-arrival scripts, forms, popups, or iframe promotion.** Use ordinary policy and the existing explicit Greylist workflow when the current redirect rule cannot authorize a request. A richer lifecycle can describe activity, but cannot establish its purpose.

This preserves a known compatibility limitation. It also leaves an existing security limitation: a whitelisted server can deliberately send an unrelated HTTP redirect, which D18 permits. Fixture `malicious_HTTP` demonstrates that behavior. If “never temporary open internet access” means even a malicious whitelisted server must be unable to choose arbitrary intermediates, **D18's automatic unfamiliar HTTP redirect exception does not satisfy that stronger requirement**. Human review must decide whether to retain that bounded exception or require explicit authorization of unfamiliar destinations, including HTTP redirects. No change was silently made.

The smallest next design, if improved compatibility is required, uses an explicit, frozen authorization scope through Atlas's control interface and the existing wait/confirmation contract. It does not infer infrastructure from JavaScript, provider names, earlier observations, or a later return. Whether that authorization should become context/root-bound is a separate product decision; existing Access grants are exact-host scopes, not root-bound authentication grants.

## Method and limits

Windows, Firefox **157.0**, fresh headless profiles, real WebExtension events, current Core/controller, and real IndexedDB in enforcing runs. Local fixtures use `*.localhost` instead of `*.test` so no DNS or hosts-file changes are necessary. They exercise the same cross-host relationships. Explicitly whitelisted fixture hosts are `app.localhost`, `www.app.localhost`, and `other.localhost`; `black.localhost` is explicitly denied.

Two modes are deliberately separate:

- **Enforcing:** the current built Atlas background plus a passive observer in a disposable copy. Core decides; Firefox withholds rejected requests. Server-hit assertions independently check withholding.
- **Passive:** observer-only background in a disposable copy, with Atlas enforcement absent. This reveals event sequences past the points Atlas blocks. A completed passive flow is not evidence that Atlas permits it.

The observer is test-only and is not bundled into the normal extension. It buffers a closed projection: hostnames, enumerated event/method/type/transition fields, native tab/frame identity, timestamps, and locally mapped request/document identifiers. It does not retain full URLs, paths, query names/values, fragments, headers, cookies, tokens, POST bodies, page text, or raw automation errors. Synthetic server endpoints are retained only for local fixture assertions. Raw Firefox stdout/stderr are discarded. Disposable profiles and addon copies are removed, so public-site cookies and browser-generated session material do not remain as artifacts. Public sign-in selectors stay in test scripts, outside Core and the adapter.

The checked-in [evidence](evidence/firefox-auth-157.json) contains ordered, sanitized events and Core diagnostics for all fixtures and the public observations. Omitted fields mean null/empty in the projection, not evidence of a negative fact. `relativeMs` is the Firefox timestamp relative to the first timestamp in that case; `sequence` is observer delivery order. Request/document integers are reset per case. Do not merge these namespaces between cases or infer causal ordering solely from callback delivery order.

No authenticated return, tenant-specific discovery, MFA, credential submission, consent, real OAuth token exchange, or real SAML assertion was tested. Synthetic OAuth/SAML cases characterize navigation transports only. A visible email input alone is not proof of a credential page; Overleaf/GitHub homepage inputs were treated as ambiguous and only public sign-in controls were opened.

## 1. Firefox evidence matrix

### Event and field profiles

Every row below uses these complete profiles so field availability is explicit without repeating a dozen columns.

**T: top-level network navigation.** `webRequest.onBeforeRequest` has browser-issued `requestId`, `tabId`, `frameId=0`, `parentFrameId=-1`, HTTP method, and `type=main_frame`. `originUrl` identifies a triggering resource when available; it was absent for typed/bookmark/reload requests and present for fixture document actions. `documentUrl` was absent for these top-level requests. `initiator` was absent in this Firefox run. These fields are browser observations; their target/source hostnames do not attest intention. Firefox's [onBeforeRequest contract](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onBeforeRequest) explains the request and frame fields.

**C: document lifecycle.** `webNavigation.onBeforeNavigate`, `onCommitted`, `onDOMContentLoaded`, `onCompleted`, or `onErrorOccurred`; `tabId`, `frameId`, and parent frame are available. No webRequest `requestId` is present. In Firefox 157, `documentId` was present on committed/DOM/completed/error/history events, but absent on `onBeforeNavigate` and all observed webRequest requests. Some subframe events supplied `parentDocumentId`. Document identity can strengthen bookkeeping after commit; the blocking request has no matching destination document ID in these observations. Transition labels are on commit/history events, after the request gate. See [onCommitted](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webNavigation/onCommitted).

**R: HTTP redirect evidence.** `webRequest.onBeforeRedirect` adds exact `redirectUrl` and status to the same request/tab/frame stream. The adapter compares the expected full target privately, previous release, request ID, timestamp order, and live context. The log retains only the redirect hostname. All five GET status variants retained one request ID across their synthetic chain. This does not turn the destination server's chosen target into trusted infrastructure. See [onBeforeRedirect](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onBeforeRedirect).

**P: new browsing context.** `tabs.onCreated` and `webNavigation.onCreatedNavigationTarget` expose new tab identity and, respectively, optional `openerTabId` or `sourceTabId/sourceFrameId`. The latter has no network request ID. The popup's T/C/R events use its own tab/frame identity. Browser-reported parentage proves a source relationship, not shared permission. See [onCreatedNavigationTarget](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webNavigation/onCreatedNavigationTarget).

**F: subframe.** T's request profile changes to `type=sub_frame`, positive `frameId`, actual parent frame, and often `originUrl`, `documentUrl`, and frame ancestors. Observed single-level iframe parent was frame zero. C uses the child frame. A promotion produces a new **T** request for frame zero, whose `originUrl` can be the child host; it does not make the child a Journey context.

**H: document-local URL change.** `webNavigation.onHistoryStateUpdated` or `onReferenceFragmentUpdated` has context/document identity and sometimes transition labels, with no new request ID or network navigation. Cross-origin `pushState` is not a browser navigation mechanism. SPA routers that actually navigate externally use T/C instead.

### All 21 mechanisms

`Gate` means the production adapter gates T, watches commit and redirect/error events, and reevaluates retained content. It also watches history/fragment events. It does **not** currently use commit transition labels, document IDs, popup creation, or iframe events as continuation authority.

| # | Mechanism / measured fixture | Events and complete field profile | Observed late labels | User intent vs page intent | Redirect continuity | Page-controlled aspect | Current Atlas observation/result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | HTTP 301/302/303/307/308, A variants | T + R + final C | `typed`, `server_redirect`, `from_address_bar` for typed fixture start | Initiation may be typed; server chooses every Location | Same request ID for each chain; a later document action starts a new one | Any server/open redirect can choose an unrelated target | Gate: allowed bounded intermediates; return commit ends RETURNED |
| 2 | `location.href`, `assign`, `replace`, B; timed B_auto_JS | New T + C after root C; origin=root, new request ID | In this build all measured JS variants committed `link`; return adds `server_redirect`. Timed JS did **not** reliably add `client_redirect` | Cannot identify JS subtype or authentication intention from the gate; a trusted button click still invokes page-controlled code | Later HTTP R is correlatable, but does not justify releasing the first unfamiliar T | Page controls script, target, timing and history replacement | Gate: first unfamiliar request is Greylist after REACHED |
| 3 | `window.open`, G | P + new-tab T/R/C; new tab's frame zero; origin=root | `link`, final `server_redirect` in passive run | Popup source and user gesture do not identify purpose | Redirects correlate within popup, never parent request ID | Page chooses popup URL and callback, subject to browser popup rules | Popup T gated; no inheritance; unfamiliar popup withheld |
| 4 | ordinary link click, D | New T/C, same tab, origin=root, new request ID | `link` | Describes transport, not whether link serves original goal | Later R correlates only this new request | Page controls href and labels; click may be unrelated | Gate: unrelated unfamiliar link Greylist |
| 5 | `target=_blank`, blank_link | P + new-tab T/R/C; source tab/frame and opener | `link`, `server_redirect` on passive callback | Cannot distinguish legitimate auth link from an ad link by parentage | Only inside new tab | Page chooses href and target | Gate: no parent Journey transfer |
| 6 | form GET, GET_form | New T(GET)/C; origin=root; new request ID | `form_submit`, plus passive return `server_redirect` | Method alone cannot distinguish form GET from other GET; label is late | R can follow the submitted GET | Page chooses action, controls and fields | Gate: unfamiliar form target Greylist |
| 7 | form POST, C_POST | New T(POST)/C; origin=root; new request ID | `form_submit`, passive HTTP return `server_redirect` | POST is visible before release; not proof of user confirmation or SAML | R correlates response; measured 302 changed return to GET | Page chooses action/body; body need not be inspected | Gate: unfamiliar POST withheld; no body reached auth server |
| 8 | JS `form.submit`, JS_submit and auto_POST | Same T(POST)/C profile as form POST | `form_submit` even for timed programmatic submission | Programmatic and clicked submits are not reliably separable | Same R rules as ordinary form | Page can synthesize submission without an Atlas confirmation | Gate: unfamiliar POST Greylist |
| 9 | meta refresh, meta_refresh | Root C, then new T/R/C; origin=root | Passive final `link`, `client_redirect`, `server_redirect` | Client redirect does not prove auth; also covers some JS | Refresh itself is not R; subsequent HTTP R correlates new ID | Page chooses refresh target/deadline | Gate: refresh target Greylist |
| 10 | `pushState` / `replaceState`, history fixtures | H; same tab/frame/document; no new T | `link` in measured H | Cannot infer task completion or new permission | No redirect chain; no request ID | Page chooses same-origin route/history | Adapter observes H for retained checks; no permission or hops invented |
| 11 | SPA router, SPA fixture | H for History API route; external router navigation uses T/C | H `link` in fixture | No general router/auth signal | H has no R; full navigations use normal R | Page chooses route and external actions | Same-host route retained; external request gated |
| 12 | address bar, F during/after | New T/C; origin absent, new ID, same tab/frame | `typed`, `from_address_bar` on successful/passive navigation | Browser source is distinguishable after commit; unavailable as a release-time label | Redirects inherit this new typed request's ID only | Page cannot fabricate browser event fields, but absence of origin is not universal proof of typing | Gate: unrelated typed target Greylist during active Journey and after arrival |
| 13 | Firefox saved bookmark, bookmark | New T/C; origin absent, new ID | `auto_bookmark` | Browser provenance; does not change policy or identify auth purpose | Any R is the bookmark navigation's chain | Website cannot issue an actual bookmark event directly | Gate: same Whitelist path; measured saved bookmark loaded root |
| 14 | reload, reload | New T/C; origin absent in fixture; new ID | `reload` | Reload provenance is late; source unavailable at gate | R belongs to reload request | Pages can also trigger reload | Gate: Whitelist request uses normal BEGIN path; ended attempt can be replaced, active deadline not extended |
| 15 | back/forward, back_forward | T/C in no-store fixture; caches/BFCache can produce C without T | `link`, `forward_back` | History traversal is not a new auth intention | No-store fixture used new IDs; cache restoration cannot reconstruct old R authority | Page can manipulate history | Adapter watches arrival; uncorrelated restored content cannot borrow an old chain |
| 16 | iframe navigation, iframe | F + child C; parent zero, origin/document=root | `auto_subframe` | Embedded content is not intentional top-level access | R stays in subframe stream | Page chooses iframe URL | Production excludes subframes; observer saw auth iframe load without a Journey hop |
| 17 | iframe promotes top, iframe_promote | F first, then T/C; top frame zero but origin=child host | Top passive callback `link`, `server_redirect` | Native child click can cause this; cannot establish necessity | Promotion has a new top-level request ID | Child chooses top target if browser permits promotion | Gate: unfamiliar top target Greylist; subframe authority not promoted |
| 18 | OAuth-style popup, G | P/T/R/C plus page callback/closure; callback/closure is not auth proof | As window.open | OAuth is not an event type; popup looks like arbitrary popup | Only popup-local R | Popup content and postMessage claims can be malicious | Unknown popup Greylist; parent remains Whitelisted. Passive fixture returned and closed |
| 19 | same-tab OAuth transport, B / A | T/C for post-load JS/form/link; T/R/C for server-led flow | Corresponding transport labels | No generic OAuth-purpose field; query markers would be page-controlled | Only genuine R maintains current request correlation | Page/server can mimic OAuth-looking targets | HTTP-led flow allowed; first unfamiliar post-arrival action Greylist |
| 20 | SAML HTTP-Redirect transport, A | T(GET)/R/C | `server_redirect` | Cannot establish valid SAML or identity from navigation | R evidence correlates browser transport | Server can redirect arbitrary encoded or unrelated content | Gate handles transport without interpreting SAML |
| 21 | SAML HTTP-POST transport, H | Root T/R to selector C; selector POST T/C; auth POST back T/C; new ID for each POST | Both passive submits `form_submit` | Automatically submitted POST is not explicit Atlas consent | POST isn't R; response may separately redirect | Page supplies form action/body; no necessity proof | First unfamiliar selector-to-auth POST Greylist, ending UNRELATED_NAVIGATION; known root return independently Whitelisted |

All rows share the same restart rule: request/event correlation is **not reliably recoverable across extension restart**. Browser IDs may outlive an extension reload or change across a browser restart, but lost predecessor/release/expected-target state cannot be recreated from them. Current startup ends old context-bound Journeys with CONTEXT_CLOSED; persisted policy and explicit grants are independently validated. Reusing a tab ID or source hostname cannot restore the old permission.

Firefox [transition types](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webNavigation/TransitionType) and [qualifiers](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webNavigation/TransitionQualifier) describe navigation categories, not authorization. In particular, the observed timed JS `link` and timed programmatic `form_submit` prevent treating either label as user consent. The [webNavigation lifecycle](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webNavigation) and webRequest are different event streams: these runs included callback delivery where commit appeared before the observer's webRequest callback for the same passive navigation. Preserve actual trace order, but do not make it a universal ordering guarantee. The async blocking gate remains the authorization point; post-commit evidence cannot retroactively authorize an earlier request.

## 2. Synthetic fixture results

All 34 cases were observed in both modes. The final runner asserts current outcomes, server withholding, fixed deadlines, same-ID redirects, popup isolation, history behavior, and terminal reasons. Policy remained unchanged and no grants were created in enforcing cases.

| Scenario | Current enforcement | Passive comparison / important evidence |
| --- | --- | --- |
| A: app HTTP -> auth HTTP -> app | ALLOW; RETURNED after root commit, one deadline | All 301/302/303/307/308 GET variants correlate one request; no initial app document |
| B: root loads -> JS -> auth -> root | GREYLIST before auth server receives navigation; root already REACHED | href/assign/replace/timed assign all complete the transport; no reliable JS subtype/user label |
| C: root loads -> POST auth -> HTTP root | GREYLIST; POST withheld | `method=POST`, origin=root; response 302 returns as GET with same request ID |
| D: loaded root -> unrelated clicked link | GREYLIST; evil server unhit | Page-controlled link has the same origin/context/request shape as many JS actions |
| E: loaded root -> unrelated JS | GREYLIST; evil server unhit | Click-triggered and timed script both commit `link` in passive run |
| F: typed unrelated during/after | GREYLIST in both; during case ends UNRELATED_NAVIGATION | Origin absent; typed late labels; new request ID does not inherit old chain |
| G: popup auth -> callback -> close | Popup first auth request withheld; root remains Whitelisted | Popup gets source/opener facts, separate tab and request; observer-only callback and closure occur |
| H: app HTTP -> selector document -> POST auth -> POST root | GREYLIST at selector-to-auth; active Journey ends UNRELATED_NAVIGATION | Two programmatic/ordinary POST transports have separate IDs; passive root return works |
| I: app HTTP -> intermediate document -> same-host action -> HTTP root | ALLOW; RETURNED on root commit | Intermediate document arrival does **not** end Journey; same-host source action is retained, R continues |
| J: app HTTP -> explicit www.app | ALLOW; DESTINATION_CHANGED on final commit | Both hosts were individually whitelisted; no inferred equivalence |
| Meta refresh | GREYLIST after root arrival | `client_redirect` appears only in later passive commit |
| History push/replace and SPA route | Retained Whitelist access; no new network hop | H carries same document ID; no request ID or auth permission |
| Iframe / iframe promotion | Iframe ungoverned; promoted unfamiliar top request Greylist | Child parent/ancestors observable; promoted T origin can be child |
| Bookmark / reload / back-forward | Normal Whitelist access | Native saved bookmark `auto_bookmark`; reload `reload`; history `forward_back` |
| Deliberate app HTTP -> evil | **ALLOW, ACTIVE_JOURNEY** | Genuine HTTP evidence is constructible by a malicious whitelisted server |
| app HTTP -> blacklisted host | DENY, BLACKLISTED; black server unhit | Passive mode reaches black; illustrates why passive completion is not enforcement evidence |

The exact event sequence is stored per case, including lifecycle/error events and optional field availability, in the evidence file. Event counts are observations, not assertions about future Firefox versions. Initial abandoned about:blank/loading events can appear alongside the successful replacement; an error event by itself does not establish that the final navigation failed.

## 3. Real public flows

All observations below are credential-free **entry** observations on 2026-10-01. Public policy explicitly lists the roots, plus `www.overleaf.com`; it does not whitelist provider hosts. The observer-only comparison includes Microsoft/Outlook's blocked portion. No authenticating account was used. Same-host hops are recorded individually in the trace but collapsed below when explaining host transitions.

| Service | Observed top-level transition and mechanism | Root document before cross-host navigation? | Current result / exact reason | Is the block desirable? |
| --- | --- | --- | --- | --- |
| Canvas | `canvas.kth.se` --302--> `saml-5.sys.kth.se`; intermediate document then **same-host POST**, same-host 302s, --302--> `login.ug.kth.se` | No Canvas document; an intermediate SAML-host document does commit | ACTIVE_JOURNEY reaches KTH credential form. Same-host action preserves current cursor and deadline, HTTP response redirects attest the next cross-host step | No block observed. Authenticated POST/return remains untested |
| KTH webmail | `webmail.kth.se` same-host 302s, then same-host document/navigation; credential controls | Root remains same host | WHITELISTED; root arrival REACHED. **No Microsoft transition was observed** | Cannot diagnose an assumed webmail-to-Microsoft path; account-specific or alternate routes untested |
| Gmail | `mail.google.com` same-host 301s --302--> `accounts.google.com`, further same-host 302, identifier page | No mail root document | ACTIVE_JOURNEY; one correlated request chain | No block. Later account selection/authentication untested |
| Microsoft account | `myaccount.microsoft.com` document, then new GET to `login.microsoftonline.com`, origin=root, no onBeforeRedirect joining them | Yes | Root commit ends REACHED; unfamiliar new request gets GREYLIST/UNLISTED, is withheld and replaced by Atlas | Compatibility false rejection of this public sign-in entry. Necessary fail-closed result without additional authority; same evidence could direct to an unrelated site |
| Outlook | `outlook.office.com` same-host 301 then document. Child-frame `login.microsoftonline.com` --302--> child `outlook.office.com`; later **new top-level GET** `login.microsoftonline.com`, origin=root | Yes | Root ended REACHED. Frame redirects neither continue nor authorize top Journey; unfamiliar T becomes Greylist. Passive top login reaches credential form; `login.live.com` appears only as a child iframe | Same compatibility gap. An earlier iframe chain cannot authorize the later top-level request |
| Overleaf | `overleaf.com` --308--> `www.overleaf.com`; opened visible public sign-in link, same-host GET | Canonical root document loads first; observed login stays same host | WHITELISTED under explicitly listed hosts; canonical arrival DESTINATION_CHANGED. No federation submitted | No block on observed path; federated/provider choices untested |
| GitHub | `github.com` document; visible public sign-in control leads to same-host GET | Yes; no observed cross-host entry | WHITELISTED for both requests. Form presence is observed; the focused trace stops before a later login commit, so authenticated compatibility is not established | No block; external OAuth application/enterprise SSO untested |
| Ladok | `student.ladok.se` same-host 302s and document; public institution-login action makes **new same-host GET**, same-host 302s --302--> `service.seamlessaccess.org` discovery document | Yes | New whitelisted root request starts a fresh Journey; its HTTP redirects authorize discovery. Institution selection/IdP return not completed | No discovery block; no evidence for the later university chain |

Microsoft/Outlook classification is **document-initiated GET, subtype unknown**. No automation clicked their login control. Firefox commit labelled the passive provider navigation `link`, with no joining HTTP redirect. That evidence does not distinguish JavaScript, a programmatically activated link, or another client navigation. Outlook's preceding iframe activity is observable, but does not prove that the iframe caused the top-level request. Do not label it iframe promotion without that proof.

Canvas's same-host POST is measured from method/origin events; `form_submit` on the later provider commit supports submission transport. No page body was inspected to assert an exact SAML protocol phase. Ladok's probe can click a root control repeatedly while the response is loading; multiple root attempts appear in that focused trace. Their individual deadlines are fixed. Do not treat those separate IDs as one extended Journey.

### Mechanisms worth supporting

Post-arrival document-initiated GET is a real compatibility issue in two Microsoft public entry points. POST transport is present in KTH's public entry path, and [SAML bindings](https://docs.oasis-open.org/security/saml/v2.0/saml-bindings-2.0-os.pdf) define HTTP-Redirect and HTTP-POST as different transports. OAuth authorization involves browser redirection, but is not intrinsically a popup or script event; see [RFC 6749](https://www.rfc-editor.org/rfc/rfc6749.html).

Prioritize accurate characterization of document actions, forms and context changes. Existing same-host actions followed by HTTP redirects already cover Canvas and Ladok discovery. Cross-host POST, client-driven GET, and popups deserve future compatibility fixtures; they **do not yet have evidence sufficient for automatic unfamiliar-host permission**. This sample does not establish prevalence of meta refresh, iframe promotion or popup authentication on the real sites. Support demand and safe authorization are separate questions.

## 4. Trustworthy evidence and ambiguous evidence

Trustworthy observations from a trusted adapter:

- Browser-issued request/tab/frame IDs and metadata, within a live owner incarnation.
- An observed HTTP response redirect, privately matched to its released predecessor and exact next target.
- HTTP method and the actual context/frame receiving the request.
- Browser-reported source host, document arrival/identity and popup parentage where available.
- Actual history/arrival events, without pretending they are earlier release-time evidence.

These establish **transport provenance**, not the legitimacy of the target. Websites cannot directly manufacture privileged WebExtension event objects, but can make Firefox produce valid-looking events by choosing scripts, forms, links, iframes and HTTP responses.

Ambiguous or attacker-controlled claims:

- “This is login,” button text, URL path/query markers, OAuth/SAML-looking parameters, postMessage callbacks, or a claimed successful sign-in.
- Current authorized hostname as a claim that every outgoing navigation is authorized.
- `link`, `form_submit`, `client_redirect`, source/opener relationship, POST method, or a short delay as proof of Atlas confirmation.
- Returning to root: an unrelated site can redirect back after it has already displayed content; root also hosts unauthenticated bootstrap pages.
- Previously observed targets: observation is not a trust decision, and first observation can poison such a rule.

A release-time decision cannot require a future return without permitting the outward request speculatively. Later failure/cancellation cannot undo that disclosure or access. Holding the outward request until return is a deadlock, since the return depends on releasing it.

## 5. Candidate continuation rules

False ALLOW means unrelated navigation receives Journey authority. False rejection means intended infrastructure falls back to Greylist. Bounds mitigate exposure, not misclassification.

| Rule | What it permits | Abuse / false ALLOW | Compatibility / false rejection | Assessment |
| --- | --- | --- | --- | --- |
| 1. Any current authorized document initiation | Links, scripts, forms, possibly promoted frames/popups | Trusted root/provider becomes an arbitrary navigation launcher; D/E indistinguishable from auth | Can still reject missing origins, context changes | Too broad |
| 2. HTTP only | Observed server redirects from released chain, current D18 plus same-host retention | Malicious server/open redirect to evil is actually allowed | Microsoft/client GET, unfamiliar forms, popups fail | Narrow observable transport; explicit residual risk |
| 3. HTTP + forms | Cross-host GET/POST submissions | Automatic form to unrelated site; submit method is not purpose | Scripts, some redirects/popups still fail; GET form not identifiable at gate | No safe semantic discriminator |
| 4. HTTP + JS | Location navigation, possibly programmatic anchors | Malicious JS navigation satisfies exactly the rule | Cannot reliably classify JS at the blocking gate; meta/forms vary | Unimplementable as a reliable purpose filter |
| 5. Initiator equals current cursor | Outgoing actions from currently authorized host | Authorized compromised provider can navigate anywhere; hostname omits document/port identity | Origin may be absent; child frame or new tab differs | Useful correlation constraint, insufficient permission |
| 6. Short post-arrival auth phase | Early post-load actions before fixed short deadline | Attack script can act immediately; YouTube link within phase would pass under broad rule | Slow users, lazy bootstrap, MFA/discovery fail | Adds timer/state without proving purpose; time must not create permission |
| 7. Until root return | Keeps root load / intermediates active until outbound and return | First root can remain an arbitrary launch context; no guaranteed return | Interrupted auth lasts until timeout; initial unrelated click indistinguishable | Restores D11's broad escape risk if no narrow evidence rule |
| 8. Contingent on later root return | Speculative outward navigation judged afterwards | Evil document can load then bounce back; effect already occurred | Legit auth cancelled/error/no return would be misjudged | Cannot be a pre-release authorization rule |
| 9. Explicit infrastructure/service relationships | Preapproved exact edges/scopes | Overbroad declarations or a dual-purpose provider can still enable unrelated use | Maintenance, changing providers, tenant variants | Stronger authority source; conflicts with no global dependency database; only separately approved local scopes could fit |
| 10. Previously observed / declared auth endpoints | Cached learned endpoints or explicit declarations | Observation poisoning; declaring by the page is attacker authority | First run/new tenant fails; stale records | Observed/website-declared targets unacceptable. Atlas-user-approved declarations are rule 9, not learning |
| 11. Type + initiator + context + hops + deadline | Mechanically bounded causal continuation | Malicious form/script/server still satisfies every causal condition | Missing source, popup/tab transfer, slow flows reject | Appropriate guardrails after an authorization basis exists; conjunction doesn't prove purpose |

Blacklist precedence, complete-state validation, current policy and successful persistence apply to every candidate. None permits elapsed time, page claims or a failed save to authorize access.

## 6. Journey model review

### Recommended minimal model: retain D18 and explicit fallback

Keep the existing states; no AUTH_CONTINUATION state is justified as permission by this evidence.

| State / transition | Required facts and effect |
| --- | --- |
| No attempt / ENDED -> STARTED | Current validated policy allows root; authoritative BEGIN_NAVIGATION for this bound context. New ID/start/deadline; no reused ended authority |
| STARTED or IN_TRANSIT -> IN_TRANSIT | Unfamiliar cross-host step needs current D18 HTTP evidence matching cursor/context; validate time/revision/blacklist; consume a cross-host hop when adopted |
| Active -> same active phase | Authorized same-host action or retained-content check; no new lifetime, no permission from elapsed time |
| STARTED -> ENDED(REACHED) | Actual root document commit, not speculative request, DOM-ready/auth-success claim or redirect through root |
| IN_TRANSIT -> ENDED(RETURNED) | Actual root document commit after departure; a root redirect without commit does not complete |
| Active -> ENDED(DESTINATION_CHANGED) | Actual arrival at another explicitly whitelisted host through an accepted navigation; no implicit alias or root transfer |
| Active -> ENDED(UNRELATED_NAVIGATION), then new STARTED | Independent BEGIN_NAVIGATION to another Whitelisted destination ends the old attempt and creates its own. This differs from a correlated canonical redirect whose final arrival ends DESTINATION_CHANGED |
| Active -> terminal | Deadline, hop exhaustion, cancel, context loss/restart, policy/revision invalidation or unrelated governed navigation |
| Ended root -> later unfamiliar action | Ordinary policy/grant/Greylist; cannot revive old Journey. A later genuine root request is independently Whitelisted and may start a new D18 attempt |

At ambiguity, use ordinary policy after ending/unbinding the attempt as applicable; malformed/unavailable state fails closed. A new context is independent. Separate tabs have separate records. Deadline/hop limits never reset within the same ID. Existing hop counting counts adopted non-root hostname changes, not each resource, same-host action or root return; an HTTP-only same-host loop may hit browser redirect limits without consuming Core cross-host hops. Deadline still bounds it. Root completion occurs on commit, not on readiness or a future successful sign-in.

### Alternative models needing approval

1. **SEEKING -> AT_ROOT -> AUTH_CHAIN -> COMPLETE.** AT_ROOT could remember an attempt without authorization, but starting AUTH_CHAIN still needs an independent permission basis. If AT_ROOT automatically admits scripts/forms, it creates rule 1/3/4/6's escape. A lifecycle-only AT_ROOT adds state without solving the current block. No universal COMPLETE evidence exists beyond chosen document arrival boundaries.
2. **OUTBOUND -> ROOT_REACHED -> AUTH_CHAIN -> RETURNED.** Distinguishes initial vs return history, but a bootstrap root is already reached. Later outward purpose remains ambiguous; malicious journeys can return too. It requires the same independent authorization basis as alternative 1.
3. **Explicit continuation scope.** User reviews exact hosts through privileged Atlas controls, waits and confirms; only a committed frozen scope authorizes unfamiliar destinations. Existing Access supplies these semantics now. A future root/context-bound variant could reduce grant breadth, with fixed deadline/hops and no popup inheritance. Scope edits must require a new full confirmation, and ambiguous unlisted targets must fall back. **This is a future product choice, not an implemented Journey extension.**

No extra state count turns causal navigation into intention. Prefer the current lifecycle until an independent permission source is chosen.

### Invariants for any next implementation

Keep the existing state/policy/confirmation/commit invariants, and make the following requirements explicit in the reviewed contract:

1. Destination commit proves arrival only; it never proves authentication success.
2. Source identity or transport classification alone cannot create post-arrival unfamiliar-host permission.
3. Any new continuation scope must originate in privileged Atlas authority, be exact/frozen/visible, and remain separate from Whitelist classification.
4. No provisional outward ALLOW based on a possible later return; no retroactive authorization.
5. A short phase/timer is a restriction on already established authority, never its source.
6. Frame, opener, popup callback and cross-tab relations confer no implicit authority transfer.
7. Correlation is tied to live owner/context and the released predecessor. Lost facts, mismatched request IDs, unexpected redirects and stale events cannot be reconstructed as permission from persisted hostnames.
8. Log/diagnostic evidence is observational and can never be submitted as an authorization command by a website.
9. Blacklist and failed/unavailable/uncertain authority override every continuation mode; successful persistence precedes published permission.
10. An independent Whitelisted request replaces the old attempt with a distinct ID; a correlated arrival at another Whitelisted host ends DESTINATION_CHANGED. Neither operation reclassifies intermediate hosts or changes grant scopes.

Human approval is needed before adding a scope model, changing root-arrival completion, admitting new evidence kinds, inheriting popup authorization, or replacing the current automatic unfamiliar HTTP exception. Routine logging/fixture changes in this pass do not make those product decisions.

## 7. Sixteen threat cases: desired vs current

“Should” here means the conservative recommendation under the user's stated boundary. It does not silently approve new behavior. Evidence labels: **N** native fixtures in this pass; **P** public entry observation; **T** existing automated tests; **R** reasoning or untested authenticated branch.

| Case | Atlas should do | Current behavior / evidence |
| --- | --- | --- |
| 1. Canvas -> KTH IdP -> Canvas | Allow established bounded chain; root commit ends; unfamiliar client POST needs explicit scope | P reaches KTH form through same-host POST + R. N exercises synthetic return. Actual credential/return branch R only |
| 2. Webmail -> Microsoft -> Webmail | Apply evidence to the actual route; no special provider trust | P webmail observed only same-host form. P Microsoft/Outlook later cross-host GET Greylisted. Full assumed webmail/Microsoft/return route R only |
| 3. Loaded root -> JS auth | Ordinary Greylist without separately established scope | N blocks clicked/timed variants after REACHED; P Microsoft/Outlook show document-driven GET gap |
| 4. Loaded root -> POST IdP | Ordinary Greylist for unfamiliar host, no silent POST replay | N blocks C/auto_POST. P Canvas same-host POST is allowed; cross-host is subsequent HTTP redirect |
| 5. Loaded root -> clicked YouTube | Normal policy; if explicitly White it may load as its own destination, otherwise Greylist | N unrelated link blocked. Existing preset may explicitly White YouTube; that independent policy ALLOW must not be mistaken for Journey inheritance |
| 6. Loaded root -> malicious JS Google | Normal policy, no Journey permission | N E/E_auto blocked. Same observable source shape as legitimate JS |
| 7. Provider ad/tracker popup | Independent context; Blacklist/normal policy | N popup blocked from unfamiliar auth host; provider/ad variant R follows same no-inheritance boundary |
| 8. Typed unrelated during auth | End unrelated attempt, normal policy | N F_during blocks and ends UNRELATED_NAVIGATION; F_after blocks after REACHED |
| 9. OAuth new window/tab | Independent policy/explicit authorization; opener alone insufficient | N first unfamiliar popup blocked, parent root remains White. Passive callback/closure measured |
| 10. Chain changes tab | No automatic transfer; context must have independent authority | T separate contexts/reused tab IDs; N popup source/target separation. Specific moving authenticated chain R |
| 11. Restart mid-auth | Invalidate live binding; keep original persisted deadlines/grants; no guessed continuation | T/native earlier stabilization reload ends old contexts. This pass didn't restart within each auth mechanism |
| 12. Another Pure Whitelist destination | Normal White access; independent request replaces the old attempt, correlated canonical arrival ends it; no alias assumption | N canonical explicitly White host ends DESTINATION_CHANGED; T independent-root handling |
| 13. Provider links elsewhere | Same-host action can remain; unfamiliar cross-host link/form/script needs normal policy | N I retains same-host action + R; H cross-host POST blocked. Provider-to-unrelated link R/T |
| 14. Malicious valid-looking HTTP chain | Strong no-escape interpretation requires explicit unfamiliar-host authority; accepting automatic R is an explicit product risk | **N current ALLOW to evil**, ACTIVE_JOURNEY. This is an actual residual false ALLOW, not merely hypothetical |
| 15. Long redirect loops | Fixed deadline; cross-host hop bound; no per-hop lifetime renewal | T hop/expiry tests. Native no long-loop case in this pass; browser redirect count also restricts transport. Same-host loop doesn't consume cross-host hops |
| 16. Simultaneous tabs | Independent IDs/cursors/deadlines; no cross-context evidence reuse | T concurrent/context isolation and serialized controller; N popup separation. This suite runs fixture cases sequentially, not simultaneous auth chains |

## 8. What cannot be inferred safely

An unfamiliar document-initiated cross-host GET/POST, popup or iframe promotion cannot be automatically classified as necessary infrastructure using the measured browser facts alone. Neither can a genuinely observed HTTP redirect from a malicious destination. A dual-purpose provider can host both legitimate sign-in and unrelated user-facing content. Knowing its hostname alone does not prove each outgoing action remains part of the user's goal.

Reliable automatic distinction requires an independent authority source: explicit user-approved exact scope/relationship or ordinary policy/grant authority. It is not necessary to build a global database. Existing Greylist confirmation remains available, with the practical limitation that the prototype opens a fresh homepage GET after confirmation; it cannot safely replay a held SAML POST or preserve a credential-bearing authentication URL. Solving transaction resumption would require a separate adapter design with ephemeral data handling, timeout/revalidation and no saved secrets, and is not authorized by this investigation.

## 9. Tests before any broader implementation

1. Paired legitimate/unrelated scripts with identical source/context/timing; neither receives automatic new authority.
2. Paired legitimate/malicious auto-submitted POST; user-click and `form_submit` label do not bypass Atlas wait/confirmation.
3. POST 302/303 method changes vs 307/308 preservation; never store bodies or replay credentials. Current five-status fixture uses GET, so it doesn't prove POST preservation behavior.
4. Microsoft/Outlook bootstrap commit followed by provider GET, with late labels and iframe activity; no guessed purpose or future-return ALLOW.
5. Root -> intermediate document -> same-host GET/POST -> HTTP chain; retain original deadline and count only adopted cross-host hops.
6. If explicit scope is approved: confirmation atomically consumes request and publishes frozen scope only after commit; failure/conflict/unknown outcome cannot release held requests. Unlisted hosts still Greylist.
7. Source document replaced by another document at the same host/port, iframe-origin promotion, late arrival/error and out-of-order streams; hostname equality alone cannot restore old correlation.
8. Popups with shared opener, provider ad popup, closed/reused tab, moving a tab/window and incognito/container boundaries; no transfer without separately reviewed authority.
9. Restart at every hold/release/redirect/commit boundary; preserve stored deadlines, invalidate missing predecessor evidence, never reconstruct pending HTTP chains.
10. Malicious HTTP redirects/open redirects, deliberate White-root reloads, repeated fresh attempts, other-White destinations, alternating loops and same-host loops; explicitly test whichever residual risk the user approves.
11. Native cache/BFCache history restoration without onBeforeRequest, fragment routing, service-worker navigations and redirects, other extension cancellation/redirect interactions. These are gaps in this fixture suite.
12. Multiple simultaneous root/auth chains with swapped request IDs and stale events; policy revision/managed Blacklist changes during every candidate phase.
13. Explicit deadline boundary and fake clock rollback tests in Core; actual browser commit/persistence tests in the adapter. No real-clock-dependent Core tests.
14. Separately authorized test accounts for full KTH/Microsoft/Ladok returns, consent/MFA and cancelled sign-in. Do not present credential-free entry observations as this evidence.

## 10. Files and verification

### Inspected

AGENTS.md, README.md, foundation/first-steps/lessons/acceptance/architecture; Firefox adapter, stabilization and public-site documents; `extension/manifest.json`, package/build configuration; background/controller setup, `extension/src/adapter/firefox-adapter.ts`, portable adapter contracts, diagnostics and repository; Core Journey models/state/transitions, aggregate planner/controller and Access grant scope; existing adapter/stabilization/native/public tests. Official Mozilla event documentation, native Places bookmark implementation, OAuth RFC and SAML bindings were checked where relevant.

### Added in this investigation

- `extension/scripts/auth-evidence-observer.js`: nonblocking, private-channel, sanitized observer; absent from production bundles.
- `extension/scripts/firefox-auth-investigation.py`: fixtures, fresh profiles, enforcing/passive modes, public entry probes, closed metadata and current-behavior assertions.
- `extension/tests/auth-evidence.test.mjs`: four observer tests for sanitization, redirect correlation, sender/command rejection and bounded/reset logs.
- `docs/firefox-auth-investigation.md`: this report.
- `docs/evidence/firefox-auth-157.json`: sanitized measured sequences, decisions and diagnostics.

Documentation links were added to README.md, extension/README.md, docs/architecture.md, docs/firefox-real-sites.md and docs/acceptance-tests.md. docs/foundation.md records the unresolved follow-up as an open question. Existing uncommitted stabilization work was preserved. All 36 production Core/extension source and manifest files are unchanged from this pass's starting hash inventory; no dependencies or permissions were added.

### Verification

- Core: **158/158 tests**; build and typecheck pass.
- Extension: **60/60 tests** (four new observer tests); build and typecheck pass.
- Firefox 157: **34/34 enforcing fixture characterizations and 34/34 passive characterizations**, all A-J plus variants above. These are navigation tests, not 68 completed authentication sessions.
- Public: eight entry services observed; focused Overleaf/GitHub sign-in and Ladok discovery follow-ups. Microsoft/Outlook passive comparison reaches credential controls without credentials. No full authenticated compatibility claim.

Reproduce after building:

```sh
npm --prefix packages/core test
npm --prefix packages/core run typecheck
npm --prefix extension test
npm --prefix extension run typecheck
python extension/scripts/firefox-auth-investigation.py --mode enforcing
python extension/scripts/firefox-auth-investigation.py --mode passive
python extension/scripts/firefox-auth-investigation.py --public --mode enforcing
python extension/scripts/firefox-auth-investigation.py --public --mode passive
```

`--case NAME` restricts a probe, for example `--case "Microsoft account"`, `--case Ladok`, or `--case B_auto_JS`. Public sites/selectors can change; their results are dated observations, not CI assertions about provider availability. Local artifacts are under ignored `.tools/auth-*`; safe retained evidence is checked into the report's evidence file.
