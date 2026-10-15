# Backup and migration to signed Atlas

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

After both commits, restore presentation only if active terms match:

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
