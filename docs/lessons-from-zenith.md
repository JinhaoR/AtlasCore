# Lessons from Zenith

Status: **Historical lessons**, distilled on 2026-09-24. These observations explain tests and boundaries; they are not a specification to recreate Zenith.

The source material was the user's investigations and corrections plus Zenith's local policy, regression and security-assessment documents. The original repository is not required to use this packet. No new native experiments were run to prepare it, and no historical result certifies Atlas Core or a future adapter.

## 1. Define the boundary before judging a failure

An early investigation treated a background WebSocket contacting a non-Whitelisted destination as a failure of mandatory network isolation. The user later clarified that the product governs intentional visible access, not every connection made by an authorized website. The finding was downgraded under that model; a network gateway was not the remedy for the intended product.

**Carry forward:** Write the governed action and expected consequence in each test. Do not turn ordinary background authentication or resource loading into new Greylist workflows. Never describe document cancellation as proof of zero DNS, TCP or background activity.

## 2. A confirmed grant can be correct while the visit still fails

For reported Greylist failures involving `youtube.com` and `google.com`, one investigation established that confirmation succeeded, a grant was created and navigation was attempted. A redirect to the separate `www` hostname was then correctly denied under the old exact-host grant. Zenith subsequently adopted an explicit compatibility rule at the user's request.

**Carry forward:** Trace request, confirmation, persistence, grant scope and final destination separately. Test redirects that change the hostname. Do not fix matching by blindly rewriting hostnames, broadening to a parent domain or granting all subdomains.

**Not transferred:** Zenith's particular `www` pairing. Atlas must decide scope in Q2 and give users predictable behavior under that decision.

## 3. Late callbacks are not always a failed security channel

A separate shutdown path occurred when a denied redirect was cancelled, followed by a late interception callback for the already cancelled operation. Generic error handling treated that callback as a fatal guard failure.

**Carry forward:** Future adapters must correlate completion/cancellation to the operation that produced it. Distinguish an expected stale event from a genuinely unavailable enforcement mechanism. Never resume a denied action merely to avoid an error.

**Layer:** Adapter only. Core does not need browser callback IDs or interception protocols.

## 4. Removal is a completed effect, not a change of label

Zenith once marked an authenticated document as removed before asynchronous clearing had actually succeeded. A failed, cancelled or hung clear could leave that document alive. The fix retained accurate lifecycle state and destroyed the controller on failure, timeout or renderer failure rather than reporting removal prematurely.

**Carry forward:** A UI success state must follow the required effect. Core returns revocation/denial and deadlines; an adapter separately proves that retained content is no longer accessible. Test cancellation, failure, timeout and process failure.

**Not transferred:** Browser-controller clearing code inside Core, or any particular native timeout value.

## 5. Requested, permitted and displayed destinations differ

The black-screen investigation found a background navigation that was allowed initially, then redirected to a denied sign-in hostname. The renderer had not crashed: its document was empty, while presentation state still described the earlier allowed address. Activating the surface exposed the empty content. Retrying the same requested address also encountered stale host-control state.

**Carry forward:** An adapter must distinguish intended destination, current decision and actual displayed state. Denied and failed loads need an explanation and a functioning retry path. A tab label or a successful initial decision is not evidence that the requested site rendered.

**Layer:** Adapter presentation and lifecycle. Do not make Core track browser tabs to solve it.

## 6. Root-only observation did not cover every frame

One reproduced defect allowed a denied document in a verified out-of-process iframe. Some redirected POST bodies also reached the denied destination. The root interception mechanism was not sufficient; later frame-aware enforcement closed the reproduced cases on tested runtimes.

**Carry forward:** If an adapter promises to govern embedded documents, test ordinary, nested and genuinely separate-process frames, plus redirects and popups. Reevaluate the destination according to the shared semantic rule. Use independent server evidence for claims about request/body delivery.

**Not transferred:** A universal rule requiring every embedded or background hostname to be Whitelisted. Atlas's embedded-action mapping remains Q4/Q12. Nor do the historical tests prove coverage on a different engine.

## 7. A visible chooser was not proof of silent file theft

Another root-only interception gap let a separate-process frame display a native file chooser despite Zenith's configured denial. That was a reproduced capability-policy defect, but no silent file read/upload was demonstrated. Its fix and tests belonged to the browser integration.

**Carry forward:** Describe what was actually observed. Test allowed behavior as well as denial, and distinguish missing hardening from a reproduced exploit.

**Not transferred:** Zenith's blanket file-selection denial or a capability-policy subsystem in Atlas Core. Normal file upload remains a browser/interface concern under the new scope.

## 8. Optional authentication must not become missing state

The user reported Vault editing trouble after password protection became optional. The useful regression scope covered draft creation, preview, staging, waiting and confirmation in both modes; the absence of a password must not erase the rest of the workflow. Core regressions also checked that the password-enabled mode retained its protection.

**Carry forward:** Separate orthogonal states. A missing optional feature is not an invalid policy. Test the full transition, not just a button's enabled state.

**Not transferred:** A password system, password migration or browser credential store. Core authentication is excluded from the initial Atlas scope.

## 9. Durable state changes need one success boundary

Zenith's access and Vault work highlighted consuming requests, applying policy and preserving pending waits together. Separate success signals or partial writes can create grants without consumed waits, lost policy changes or replayable confirmations.

**Carry forward:** Commit related changes atomically before publishing success. Test failed writes, duplicate commands, stale proposals and concurrent requests. Keep a readable prior state intact if a future migration fails.

**Not transferred:** Windows-specific protected storage, old schema versions, legacy identities or migration code. Atlas starts with its own format and repository contract.

## 10. Registries became more complex than the product needed

The registry work grew into service approvals, permission-instance attribution and removal concerns. The user subsequently emphasized a smaller model: meaningful services, reviewed supporting infrastructure, explicit local choices and unknown destinations handled deliberately. Services do not own hostnames.

**Carry forward:** Curated evidence is useful; complete dependency or ownership graphs are not an initial requirement. A catalog may explain a candidate rule without granting access. An observed request is not a discovered, approved dependency.

**Not transferred:** Permission ownership, attribution ledgers, reference-counted service removal, automatic discovery or a copied service database claimed to be complete.

## 11. Hidden from discovery is not the same as inaccessible

Historical Zenith infrastructure entries could be omitted from generated site listings while still authorizing ordinary visits. The new conversation clarified that supporting domains may be displayed during controlled login steps, but did not finalize their direct-visit semantics.

**Carry forward:** Keep visibility and authorization separate. P4 recommends contextual use without an automatic direct-access shortcut; that proposal must be evaluated, not inferred from a hidden UI row.

## 12. Preserve normal browser behavior where the product does not intervene

The user's goal is ordinary useful browsing with intentional access, including legitimate login. Cookie/session persistence, browser security, file selection and provider compatibility are not all Atlas policy features. Content blockers likewise do not replace browser security.

**Carry forward:** Keep these responsibilities in the browser/interface layer and test the chosen frontend. Do not infer provider compatibility from a rendered sign-in page or generic Chromium support. Do not copy prohibitions on cookies, workers, autofill or file uploads just because Zenith once implemented them.

## 13. Test evidence belongs to the implementation and scope tested

Zenith used fake clocks, domain regressions, native scenarios, isolated profiles, synthetic credentials and independent local servers. Those methods are reusable. The tested binary, browser runtime and original guarantees are not transferable to a new implementation.

**Carry forward:** Rewrite behavior tests around Atlas's agreed semantics. Use reserved example hostnames and synthetic data. Pair denied cases with allowed controls. Keep pure Core tests separate from adapter coverage and actual-provider compatibility checks.

## Source orientation, optional historical lookup

If someone later consults Zenith, the relevant historical documents included `greylist-open-validation.md`, `rendering-regression.md`, `f02-fix-validation.md`, `f06-file-chooser-validation.md`, `security-review.md` and the site-policy/registry documents. Some historical statements were superseded by later changes. These names are provenance, not required reading or links to files shipped with Atlas.

The [foundation](foundation.md) is the source of Atlas requirements. The [acceptance scenarios](acceptance-tests.md) turn these lessons into new tests without transferring old code.
