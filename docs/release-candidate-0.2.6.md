# Atlas Firefox 0.2.6 — unsigned signing candidate

This candidate packages the completed [interaction refinement](evidence/ux-toolbar-refinement/README.md).
Signed 0.2.5 and every older release remain frozen. No submission, signing,
deployment, enterprise-policy change or everyday-profile access occurs in preparation.

## Changes since signed 0.2.5

- Category dragging follows the cursor and previews insertion with animation.
  Successful drops retain existing revision-checked persistence. Alt+arrow ordering
  remains; category Settings uses a visual icon picker instead of selects/arrows.
- Compass dragging covers the rings. Bounded friction follows a deliberate flick;
  reduced motion disables it. The wheel has no side scrollbar. Home is larger and
  centered, with fewer routine hints and quieter empty/completed draft presentation.
- Vault moves into Settings, preserving frozen proposals, exact consequences,
  confirmation and existing links. Bundled-policy restore remains under Recovery.
- Everyday static copy lives in `extension/src/ui/ui-text.ts`, escaped into the
  HTML during build, with no runtime text fetch or extra rendering loop.
- One permission action connects **direct Firefox toolbar bookmarks** and Atlas
  pins, without initial preview. Folders and their contents remain untouched.
  **Unpinning deletes synchronized toolbar bookmarks.** Saved Atlas pages remain
  available for repinning. Moving a bookmark into a folder excludes it from sync.
  An actual synchronization problem remains accessible from its attention control.

## Persistence and permissions

No Core source, navigation authorization, authority repository, policy default,
protected timing or authority schema changes. Extension ID remains
`atlas-development@atlas.invalid`. Required/optional permissions, dependencies,
relative Home/new-tab overrides and the 27-file runtime inventory are unchanged.
The existing optional `bookmarks` permission is requested only on connection.

Existing policy, settings, pending requests/grants/proposals, pins, categories,
named pages and drafts remain. The sync owner keeps CAS, durable operation intent,
restart reconciliation and explicit conflict handling. Unknown/blocked bookmarks
are presentation data; every launch retains ordinary Core gating.

Initial toolbar connection is additive, linking identical URLs and preserving
native duplicates. Explicit service/exact-host identities group multiple pages
into one Atlas pin; those pages occupy consecutive participating toolbar slots.
Individual titles sync; a multi-page Atlas label has no Firefox folder counterpart.
Unsupported schemes, separators and over-limit entries remain Firefox-only.

Existing folder connections continue unchanged until explicit toolbar opt-in.
That opt-in adds `scope: "toolbar"` to the independent sync record. **Older Atlas
builds cannot read that record**, even after disconnect; do not assume a downgrade
can continue presentation synchronization. Use a closed-profile backup made before
opt-in when a downgrade is needed. No automatic reset or downgrade migration is
introduced. Without toolbar conversion, the existing folder record remains readable
by signed 0.2.5. Full-profile backup includes these presentation records; portable
policy backup does not replace it.

## Verification and limits

[Package evidence](evidence/firefox-release-0.2.6.json) records final regressions,
lint, packaged native workflows, signed-0.2.5 upgrade/restart/rollback, hashes and
clean reviewer reproduction. Upgrade/rollback checks preserve the legacy connection;
native toolbar/restart checks separately cover the new opt-in. Test overlays use
disposable Firefox profiles; they do not certify Mozilla's eventual signed update.

The historical intermittent **INTERNAL_ERROR remains unresolved**. No new recovery,
permission bypass or multi-day reliability claim is included. The prior matched
15-navigation samples had a 12 ms median before and after; idle DOM/resources were
unchanged. This is not a general performance-improvement claim. Native Windows
mouse/keyboard and zoom checks do not establish touch-device, screen-reader or
other-OS conformance. Headless popup keyboard activation remains unverified.

## Artifacts and separate signing step

```text
extension/release/0.2.6/
  addon/
  atlas-0.2.6-unsigned.zip
  atlas-0.2.6-source.zip
  release.json
```

After securely supplying Mozilla credentials in your terminal environment, run
from the repository root:

```powershell
npm.cmd --prefix extension run release:validate
npm.cmd --prefix extension run release:sign
```

Only the latter submits to Mozilla's **unlisted** channel. Output will be
`extension/release/0.2.6/signed/*.xpi`. Preparation does not run it. Afterwards:

```powershell
npm.cmd --prefix extension run release:verify-signed -- 0.2.6
```

Back up and update in place under the same extension ID, without uninstalling.
Deployment remains a separate action.
