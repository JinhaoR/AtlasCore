# Home polish and early end of temporary access — 2026-11-11

Development only, after signed 0.2.7. No version change, packaging, signing,
submission, installation into an everyday profile or policy edit occurred.
All 374 pre-existing release files match the checkpoint SHA-256 hashes.

## Implemented

- Opened categories show every site in their existing scroll region. In the
  populated Research fixture, all 32 cards are available immediately, versus 12
  visible and 20 hidden behind Show all before. Saved layout is unchanged.
- 16 new original local SVG drawings expand the category picker to 28 choices.
  It scrolls at high zoom, preserves keyboard selection/Escape focus restoration,
  and saves through the existing revision-checked category-icon record.
- Compass hover previews pause during drag/coasting. Native moving-mouse testing
  recorded 101 moving frames with hover labels and one chooser opening before;
  after the fix, both counts are zero. That chooser could abruptly stop coasting.
  Explicit click/focus remains usable. This does not prove every reported visual
  glitch has the same cause; physical trackpad/GPU behavior remains unverified.
- **End access** on Home and site access details removes the selected grant's
  entire exact-host scope through Core/controller commit. It rechecks open tabs
  and invalidates delayed requests even while their tab still shows about:blank.
  A new request requires a new full wait. Other requests/grants, policy, settings,
  Vault and Journey semantics are unchanged. Nothing extends an expiry.

## Verification

- Development build and both TypeScript compilers pass.
- Core: **253 passed**; extension: **636 passed**.
- Added pure/controller tests cover full alias removal, preserved state, invalid
  input, expiry, revision changes, duplicate commands, consumed confirmation,
  acknowledgement ordering, failed/conflicting/unknown saves and restart.
- Adapter tests cover multiple tabs, released requests with no document yet,
  unrelated allowed pages, website/popup rejection and resource/navigation scope.
- Native Firefox **160.0**, copied runtime and disposable profiles:
  category/scroll behavior, picker/reload, keyboard and 125–200% zoom, 500-pixel
  window, actual pointer motion, cancellation and reduced motion pass.
- Real local HTTP fixture: blocked-host scripts/iframe and fetch resources load;
  top-level navigation to the blocked host never reaches the server. Real waits,
  explicit confirmation and end from both UI surfaces pass. Two granted tabs and
  a delayed file-free HTML response lose authorization. A new request cannot skip
  waiting; restart retains ended state and the existing policy/configuration.
- Existing Home motion fixture passes seven viewport/zoom combinations and
  authority-loss checks. Settled wheel observation: zero DOM mutations and zero
  new resource requests over 2.2 seconds. This is not a page-load speed claim.

`before.json` / `after.json` retain wheel samples and category measurements;
`access.json` records native Core outcomes; `motion-regression.json` covers the
existing interaction fixture. Screenshots include the full category, picker and
active grant with its End access action. Test profiles/runtime copies are removed
after retaining this evidence; the source checkpoint stays under ignored `.tools`.

## Firefox address bar: supported limitation

WebExtensions can provide suggestions after a registered keyword and space through
[Mozilla's omnibox API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/omnibox).
They cannot replace Firefox's ordinary dropdown with a custom whitelist-only
provider. No hidden Firefox preferences, enterprise policy changes or new
permissions were added to approximate this.

To quiet native suggestions, open **Firefox Settings → Search** and disable
search suggestions and the unwanted **Address Bar / Firefox Suggest** sources.
Keep Bookmarks enabled if you want native bookmark results (including synchronized
Atlas pins). Labels/location vary by Firefox version and region; older versions
place address-bar controls under Privacy & Security. Disabling suggestions does
not remove every search-engine action for text that is not an address. See
[Mozilla's settings guide](https://support.mozilla.org/en-US/kb/firefox-suggest)
and [search settings](https://support.mozilla.org/en-US/kb/change-your-default-search-settings-firefox).
Atlas Home search remains the existing allowed-site launcher; bookmark membership
never supplies permission. No keyword mode was added as an unsolicited substitute.

## MyAnimeList reCAPTCHA investigation

The public [MyAnimeList login page](https://myanimelist.net/login.php) loads Google's
reCAPTCHA script. Its public application script emits the reported warning when
`window.grecaptcha` is absent, before executing the challenge. The warning is
site-generated, not an Atlas denial message.

In the disposable public-page comparison, the login page loaded with Atlas on
and off; `window.grecaptcha` was absent in both cases. No account credentials were
entered, form submitted or challenge solved. See `recaptcha.json`. This does not
identify the cause in the user's installed profile: a content blocker, site consent
setting, privacy setting, network failure or failed provider script can produce
the same symptom. Check the site's reCAPTCHA request in Firefox's network panel
and any content blocker's per-site controls. Avoid globally whitelisting Google
as a workaround: Atlas gates top-level navigation and already permits embedded
challenge resources. No provider database, policy exception or security bypass
was added. The historical INTERNAL_ERROR is outside this change and remains
unresolved.

## Compatibility

Grant removal needs no new persisted authority schema; saved data remains readable
by older Core builds. Existing layout, pins, named pages and deadlines are retained.
The icon record stays separate: 0.2.7 does not recognize the new icon names, so
choose Automatic or an original icon before downgrading if icon preferences must
remain editable there. Extension ID remains `atlas-development@atlas.invalid`.
