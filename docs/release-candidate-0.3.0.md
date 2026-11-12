# Atlas Firefox 0.3.0 ? unsigned signing candidate

Packages the completed UI work since signed 0.2.8. The extension ID remains
`atlas-development@atlas.invalid`. All prior release assets are frozen.

## Included changes

- Home is a focused launchpad: floating search, a larger centered compass and
  compact relevant Greylist information. Empty verified Greylist hides itself.
- All Sites opens a category grid with existing icons, counts and saved ordering.
  Categories open in place; the complete directory remains available. Drag and
  Alt+arrow category ordering move here from Home.
- Site inspection, Add and Edit use a contextual native dialog. Dismissal retains
  unfinished fields; explicit editor cancellation retains staged work. Failed
  saves stay visible. Batch review and frozen Vault confirmation remain unchanged.
- Floating search supports sites/categories, keyboard selection, Escape/outside
  dismissal and all-result access. Search does not shift the compass or directory.
- The compass pin layer receives clicks above the transparent rotation handle;
  empty ring space still drags. Unpin focus no longer references removed Home rows.
- Greylist rows have consistent red cancellation controls. Only acknowledged
  cancellation clears a request/grant prompt; failed outcomes remain recoverable.
  Local actions no longer flash/dim the wheel while authority remains verified.

## Compatibility and update behavior

No new permission, dependency, runtime asset, Core change or storage migration.
Policy, manual Blacklist, subdomain scopes, settings, pending requests/grants,
frozen proposals, drafts, pins, named pages, category icons and bookmark connection
keep their existing storage/authorization semantics. No defaults are reapplied
merely because the version changed. The existing completed 0.2.8 curated-scope
migration receipt is retained. Older installations still follow their existing
approved migrations.

The directory reuses saved category order and identity. Legacy Home visibility and
collapse preferences remain stored, but cannot conceal entries from the complete
All Sites directory. Their obsolete Home checkbox is removed; category icons stay
in Settings. Rolling back to signed 0.2.8 restores its older presentation using
the retained preferences. There is no data-format rollback conversion.

Back up the closed Firefox profile, including native bookmarks and presentation
stores, before updating. Update in place with the same ID; do not uninstall.

## Verification and limitations

[Package evidence](evidence/firefox-release-0.3.0.json) records complete regression
suites, TypeScript/build, lint, source reproduction, runtime integrity and isolated
signed-0.2.8 upgrade/restart/rollback verification. Separate development evidence
is in [Home/directory verification](evidence/home-directory/README.md),
[pin interaction repair](evidence/home-hierarchy/README.md) and
[Greylist controls](evidence/greylist-controls/README.md).

Native checks use disposable Windows Firefox profiles and temporary candidate
overlays, not a signed 0.3.0 installation or the eventual Mozilla update prompt.
At narrow widths/high zoom, pins use the existing labelled-row fallback. External
favicons may retain a generic fallback. No new performance or accessibility
conformance claim is made. Physical GPU/touch and other operating systems are not
reverified by this release. The known Android minimum-version lint warning remains;
desktop Firefox is the tested target.

The historical intermittent **INTERNAL_ERROR remains unresolved**. This release
makes no authentication, reCAPTCHA, address-bar or authorization changes.

## Artifacts and separate signing step

```text
extension/release/0.3.0/
  addon/
  atlas-0.3.0-unsigned.zip
  atlas-0.3.0-source.zip
  release.json
```

After supplying Mozilla credentials securely in your own terminal, run from the
repository root:

```powershell
npm.cmd --prefix extension run release:validate
npm.cmd --prefix extension run release:sign
```

Only `release:sign` submits to Mozilla's **unlisted** channel. The signed result
will be `extension/release/0.3.0/signed/*.xpi`. After approval, verify it offline:

```powershell
npm.cmd --prefix extension run release:verify-signed -- 0.3.0
```

Preparation does not sign, submit, install into an everyday profile, deploy,
change enterprise policy, commit or push. An unsigned ZIP is not a permanent
Firefox installer.
