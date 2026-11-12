# Backup and migration to signed Atlas

Appearance stores only the selected bundled ID in extension-origin
`localStorage` under `atlas-theme-v1`. A closed-profile backup preserves it;
portable policy snippets and Firefox bookmark sync do not. Missing/unknown values
use the default without affecting any policy. See [themes](themes.md).


Category icon choices use `category-icons-v1` in the Home presentation database.
They are included in a closed-Firefox profile backup, not the portable policy
snippet or native bookmark synchronization. Older builds ignore this independent
record and continue reading the unchanged layout preferences.

Compact Home stores named page bookmarks in the independent `bookmarks-v1`
record of the `atlas-home-layout-v1` IndexedDB database. The portable policy
snippet below does **not** include bookmarks, category layout or batch drafts.
A closed-Firefox full-profile backup includes them. Bookmark URLs can contain
private paths and query values; keep backups private, outside Git and diagnostics.

The optional Firefox bookmark connection adds `firefox-sync-v1` to that same
presentation database. A complete backup also needs Firefox's native bookmarks;
a closed-Firefox full-profile copy preserves both. Connection node IDs belong to
that profile. Do not transplant this record into another profile or restore only
one side of an incomplete synchronization operation. On a different profile,
import native bookmarks using Firefox, then explicitly connect the chosen folder
and review the merge. Neither this connection nor Firefox account sync transports
Atlas access rules. See [Everyday controls](everyday-controls.md).

## Preserve storage first

Before unloading temporary Atlas, in `about:config` set both
`extensions.webextensions.keepStorageOnUninstall` and
`extensions.webextensions.keepUuidOnUninstall` to `true`. Keep the same ID/profile.
These are [Mozilla's storage-preservation settings](https://extensionworkshop.com/documentation/develop/testing-persistent-and-restart-features/),
not changes to Atlas decisions or signature enforcement.

Also open `about:support`, locate **Profile Folder**, close Firefox completely and
copy that folder to a private backup outside Git. Profiles contain sensitive browser
data; never share or package them. [Mozilla profile backup instructions](https://support.mozilla.org/en-US/kb/back-and-restore-information-firefox-profiles).
Restore a full profile with Firefox closed and the current profile backed up too.
This recovers your own profile, not another user's live permissions.

Stable ID helps but does not guarantee storage survival after temporary removal or
profile cleanup. Check policy/settings after installation. Recovery verifies saved
state; it does not restore your choices or reset damaged authority.

## Portable backup

Before replacement, open **Atlas Home** and press Ctrl+Shift+K for its Web Console
(not a website or Browser Console). Read this snippet before authorizing paste.
It downloads active policy/settings and display preferences only, excluding grants,
requests, proposals, Journeys, credentials and URLs:

```js
const atlasBackupView = await browser.runtime.sendMessage({ kind: 'GET_VIEW' });
if (atlasBackupView.view?.controller?.status !== 'READY') throw Error('No verified Atlas state');
const atlasBackupSnapshot = atlasBackupView.view.controller.snapshot;
const atlasBackupPresentation = JSON.parse(localStorage.getItem('atlas-destinations-v1') || 'null');
if (atlasBackupPresentation) atlasBackupPresentation.pending = null;
const atlasBackupData = {
  format: 'atlas-policy-backup-v1', addonId: browser.runtime.id,
  policy: atlasBackupSnapshot.policy, configuration: atlasBackupSnapshot.configuration,
  pins: JSON.parse(localStorage.getItem('atlas-home-pins-v1') || '[]'),
  destinations: atlasBackupPresentation,
  usage: JSON.parse(localStorage.getItem('atlas-destination-usage-v1') || '{}')
};
const atlasBackupUrl = URL.createObjectURL(new Blob([JSON.stringify(atlasBackupData, null, 2)], { type: 'application/json' }));
const atlasBackupLink = document.createElement('a');
atlasBackupLink.href = atlasBackupUrl;
atlasBackupLink.download = 'atlas-policy-backup.json';
atlasBackupLink.click();
setTimeout(() => URL.revokeObjectURL(atlasBackupUrl), 60000);
```

Keep this JSON private/outside Git and check it contains your expected Whitelist.
Unavailable authority requires investigation, not a fabricated fresh snapshot.

## Restore through Vault

If saved policy/settings survived, no restore is needed. Otherwise paste this in the
signed Atlas Home Web Console, then paste your own backup JSON when prompted:

```js
const atlasRestoreData = JSON.parse(prompt('Paste your own atlas-policy-backup.json contents'));
if (atlasRestoreData.format !== 'atlas-policy-backup-v1' || atlasRestoreData.addonId !== browser.runtime.id) throw Error('Wrong backup');
const atlasRestoreView = await browser.runtime.sendMessage({ kind: 'GET_VIEW' });
if (atlasRestoreView.view?.controller?.status !== 'READY' || atlasRestoreView.view.controller.snapshot.vaultState.pendingProposal) throw Error('Resolve authority or existing proposal first');
await browser.runtime.sendMessage({
  kind: 'PROPOSE_POLICY', candidatePolicy: atlasRestoreData.policy,
  basePolicyRevision: atlasRestoreView.view.controller.snapshot.policyRevision
});
```

Open **Settings → Vault**, review the exact additions/removals, wait normally and
explicitly confirm. Failed/cancelled proposals do not restore policy. After successful
commit, propose timing restoration separately:

```js
await browser.runtime.sendMessage({ kind: 'PROPOSE_SETTINGS', candidateConfiguration: atlasRestoreData.configuration });
```

Review, wait and confirm in Vault again. Both candidates use Core validation and
normal persistence. There are no raw IndexedDB writes or confirmation bypasses.
Access requests/grants/Journeys are not imported; normal invalidation still applies.

After both commits, restore presentation only if active terms match. In the
development build with bookmark synchronization, first **Disconnect** in Home
customization. Keep a backup of both copies. The snippet below is for the older
released builds without synchronization; do not run its direct pin write while
a connection exists. In the new build restore pins through **Edit pins and pages**
and reconnect only after reviewing the merge. This avoids bypassing the serialized
presentation writer or replaying an incomplete bookmark operation.

```js
const atlasRestored = (await browser.runtime.sendMessage({ kind: 'GET_VIEW' })).view?.controller;
const atlasPolicyKey = policy => JSON.stringify({ whitelist: [...policy.whitelist].sort(), blacklist: [...policy.blacklist].sort() });
if (atlasRestored?.status !== 'READY' || atlasRestored.snapshot.vaultState.pendingProposal
  || atlasPolicyKey(atlasRestored.snapshot.policy) !== atlasPolicyKey(atlasRestoreData.policy)
  || JSON.stringify(atlasRestored.snapshot.configuration) !== JSON.stringify(atlasRestoreData.configuration)) throw Error('Restore commits incomplete');
for (const [atlasPreferenceKey, atlasPreferenceValue] of [
  ['atlas-home-pins-v1', atlasRestoreData.pins],
  ['atlas-destinations-v1', atlasRestoreData.destinations],
  ['atlas-destination-usage-v1', atlasRestoreData.usage]
]) localStorage.setItem(atlasPreferenceKey, JSON.stringify(atlasPreferenceValue));
location.reload();
```

These keys carry no policy authority and existing UI readers validate them. Use only
your own backup and clear the console afterward. Never overwrite raw authority or
initialization flags to recover unavailable state. Keep your profile backup.

## Toolbar bookmark connection (development)

Back up Firefox bookmarks as well as the Atlas presentation database before
changing or downgrading a connected installation. The toolbar connection uses
`firefox-sync-v1` with `scope: "toolbar"`; legacy folder records remain readable,
but older builds cannot interpret the new field. Existing policy/settings and
named-page/layout formats are unchanged. Disconnect preserves both actual
copies. Only direct toolbar HTTP(S) bookmarks participate; folders remain
untouched. Unpinning deletes matching toolbar bookmarks as explicitly chosen
by the user; Atlas retains its saved pages for repinning. There is no initial
merge preview. Reconnection adds missing pages without deleting existing ones.

### Home folder icons (development)

Folder icons live in the independently revisioned `toolbar-folder-icons-v1`
record in the existing Home presentation database. The original sync record
schema remains unchanged; older builds ignore the new record. Back up this
database alongside Firefox bookmarks: icons refer to Firefox folder GUIDs.
Recreating a folder with a different GUID does not inherit its icon. No new
Core state or policy migration is involved.

### Category ordering modes (development after 0.3.0 preparation)

The Home presentation database also contains an independent `category-order-v1`
record for Custom, Alphabetical and Most used. Include it in presentation/profile
backups. The original layout record is unchanged: older releases ignore the new
record and display their legacy order. Ordering does not enter policy backups or
authorize sites. Usage mode uses the existing local usage statistics; it creates
no external browsing-history collection.
