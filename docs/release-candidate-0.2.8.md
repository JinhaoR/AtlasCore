# Atlas Firefox 0.2.8 — unsigned signing candidate

Packages the completed work since signed 0.2.7. Preparation does not sign,
submit, deploy or change enterprise policies or an everyday Firefox profile.
The ID remains `atlas-development@atlas.invalid`; all previous releases are frozen.

## Included changes

- Home uses one scrollable category column, approximately five visible choices,
  a larger compass and a compact one-row Greylist strip. Opened categories show
  their full contents. Routine saved banners and redundant Home controls are removed.
- Greylist requests can be cancelled, explicitly confirmed when ready, and opened
  through the normal gate from Home. Active grants can be ended early through a
  committed Core operation. It removes the entire selected grant's exact scope
  and rechecks affected tabs; it never adds permission or renews a deadline.
  Legacy Site access links resolve to Home, retaining their explicit original tab.
- Firefox bookmark permission is now **required**, as explicitly approved. The
  existing additive, journaled toolbar connection starts automatically; explicit
  disconnects and conflicts remain respected. Firefox may request permission on
  update. No new hostname authorization comes from a bookmark.
- Toolbar folders appear as read-only compass groups, with selectable local
  icons. More than ten groups use nine shortcuts plus an overflow folder. Folder
  contents stay managed in Firefox. Direct synchronized bookmark deletion on
  unpin retains its previously approved behavior. Failed icon saves retain Retry.
- The local icon palette has 29 choices. Compass hover interference is prevented
  during motion; one shared transform replaces repeated per-pin position writes.

## Policy migration and saved state

The approved `curated-subdomains-2026-11-v1` migration adds existing Core subdomain
scope terms for still-allowed bundled hosts once, before the controller opens.
Fresh defaults retain 294 exact hosts / 122 services and add 132 minimal scope
roots. The source catalog adds no new exact hosts in this release.

Literal roots are used: `drive.google.com` does not authorize `google.com` or
`www.google.com`. Manual Blacklist wins; broad scopes cannot bypass managed
blocking. All saved exact exceptions remain intact. Custom terms, settings,
pins, metadata, drafts and original workflow timestamps are preserved. Plain
duplicate children are grouped only in presentation; customized/pinned entries
remain separate. The receipt and changed policy commit atomically.

This deliberately trusts current and future descendants, including user-hosted
university content. Removed catalog roots are skipped, but a removed child may
be covered by a retained parent's newly approved scope unless Blacklisted.
Removing a scope after this migration is respected on later startups.

When scopes are added, policy revision advances. Frozen proposals and drafts are
not rewritten; ordinary stale-revision handling applies. Revision-bound temporary
authorization does not gain a new deadline or bypass normal invalidation.
No general developer bypass or automatic promotion of arbitrary sites is added.

Authority schema is unchanged. The folder-icon record is independent of the
unchanged sync/layout/named-page formats. Back up the closed Firefox profile,
including native bookmarks and presentation data, before updating.

## Verification and limitations

[Package evidence](evidence/firefox-release-0.2.8.json) records final full tests,
TypeScript/build, lint, source reproduction, runtime comparison and isolated
signed-0.2.7 upgrade/restart/rollback tests. Development evidence remains in
[Home simplification](evidence/home-simplification/README.md),
[curated scopes](evidence/curated-scopes/README.md) and
[earlier Home/access polish](evidence/home-declutter/README.md).

Rollback does not undo a committed scope migration or restore an ended grant.
Signed 0.2.7 already understands subdomain terms, and ignores the new independent
folder-icon record. It does not recognize the expanded category icon names:
choose Automatic or an original icon before downgrade if those preferences must
remain editable. Keep a pre-update profile backup for exact restoration.

The historical intermittent **INTERNAL_ERROR remains unresolved**. The reported
MyAnimeList reCAPTCHA failure was also observed without Atlas; no login bypass
or provider trust was introduced. Atlas cannot replace Firefox's ordinary address
bar suggestions with its own whitelist-only provider.

Measured compass style writes fell about 92%; headless timing did not establish
a physical-display smoothness improvement. GPU/touch behavior and other operating
systems remain unverified. Native tests use temporary unsigned overlays on a real
signed baseline, not Mozilla's eventual signed-update consent UI. Firefox controls
permission notices. The known Android minimum-version lint warning remains;
desktop Firefox is the tested target. Unsupported or bounded-out folder entries
remain in Firefox. No universal bookmark or authentication coverage is claimed.

## Artifacts and signing

```text
extension/release/0.2.8/
  addon/
  atlas-0.2.8-unsigned.zip
  atlas-0.2.8-source.zip
  release.json
```

After supplying Mozilla credentials securely in your own terminal, run from the
repository root:

```powershell
npm.cmd --prefix extension run release:validate
npm.cmd --prefix extension run release:sign
```

Only the second command submits to Mozilla's **unlisted** channel. The signed
output will be `extension/release/0.2.8/signed/*.xpi`. After approval:

```powershell
npm.cmd --prefix extension run release:verify-signed -- 0.2.8
```

Update in place without uninstalling, after backing up. Deployment is separate.
