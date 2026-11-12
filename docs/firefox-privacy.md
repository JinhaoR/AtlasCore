# Atlas Firefox privacy notice

Theme selection stores one bundled ID locally (`atlas-theme-v1`). It does not
contact a theme/font service, synchronize permissions, or send browsing data.
Theme files and fonts ship with the extension. Existing favicon behavior is
unchanged. See [themes](themes.md).


Atlas stores policy, timing settings, pending requests, expiring grants and Vault
records locally in Firefox IndexedDB. Pins, service labels and launch counts are
local presentation preferences. There is no Atlas analytics or telemetry server.
The developer receives no automatic copy of your policy or browsing history.

Editable destination drafts, incomplete editor fields and frozen submission/display
receipts stay in a separate local IndexedDB database. Names, categories and pins
remain presentation preferences. Drafts are not synchronized to other devices or
external services and do not grant access.

Home category ordering, visibility, collapse and stable presentation membership
IDs stay in a separate local IndexedDB record. Selected rows, search/filter and
scroll positions use per-control-page session storage. These contain no policy
authority, authentication data or navigation URLs and are not sent to a server.
Editable fields remain in the existing local draft workspace.

Category icon choices are canonical category names and identifiers from Atlas's
bundled SVG palette, stored in the local `category-icons-v1` presentation record.
Changing an icon makes no network request and is not synchronized to Firefox
bookmarks. It carries no access authority.

Explicitly saved Home page bookmarks are a separate `bookmarks-v1` presentation
record in the Home IndexedDB database. These contain user-entered page names and
full HTTP(S) URLs, including paths, queries and fragments. Atlas rejects embedded
URL credentials, does not fetch titles or put full URLs in diagnostics.
The optional [Firefox bookmark connection](everyday-controls.md) requests
`bookmarks` permission only when enabled, then connects an explicitly selected
or created folder. Native page names, full URLs and ordering are copied to/from
Atlas presentation storage; `firefox-sync-v1` also retains native node IDs,
comparison values and incomplete operations. This can include private page paths,
queries and fragments. Only the connected library is synchronized; unsupported
entries remain in Firefox. Disabling/revoking permission preserves both copies.
Firefox's own Sync may upload its bookmarks if separately enabled; Atlas sends
no policy or settings to that service. Bookmarks retain their data when a site is
unpinned or unavailable until explicitly removed. Opening one uses Firefox's
ordinary navigation and the existing Atlas gate; belonging to a group grants
no access. Unsubmitted bookmark edits stay in the open page's memory.

Successful website icons can also be retained in the separate local
`atlas-website-icons-v1` asset cache: up to 128 images, 64 KiB each, with a fixed
seven-day freshness period. Keys contain the exact destination hostname; values
contain validated image bytes and asset metadata. Reads do not record visits or
renew freshness. No visited URL, credentials, policy or permission data is stored
there. Private contexts retain page-local icon behavior. Clearing or losing this
optional cache only restores the ordinary icon lookup/local fallback.

Atlas makes these online requests:

- Home icons: public site pages and their icon URLs, observed browser favicon URLs,
  and a fallback to Google's favicon service with the destination hostname.
- Greylist scope preparation: a bounded public HTTPS apex/`www` redirect check of
  the requested hostname before a new access request.
- Managed Blacklist updates: the public StevenBlack feed on GitHub.

Icon and scope fetches omit credentials and referrers. Atlas does not read website
passwords, authentication codes or cookie stores, or upload saved policy snapshots.
Providers receive normal network metadata such as your IP address; icon providers
receive the requested destination hostname or icon URL. Website-declared and
browser-observed icon URLs can include paths and queries, forwarded when requested.
The existing icon downloader accepts HTTP and HTTPS icon URLs. Public homepage,
canonical-entry and Google fallback requests use HTTPS. Website navigation itself
uses Firefox's normal security and authentication behavior.

The 0.1.15 download adapter checks browser user-activation metadata, response status,
attachment disposition and redirect targets in memory. A correlated request may
contact an unfamiliar host before its response proves to be a file. Firefox sends
its ordinary website request; Atlas does not copy or log authentication headers,
cookies, filenames, response bodies or download URLs. Intent bindings are discarded
on completion, failure or restart. Diagnostics retain only hostnames, opaque context
and sequence identifiers, and reason codes. See [download limits](firefox-downloads.md).

The required Firefox `browsingActivity` declaration covers these destination-related
requests. Atlas does not export clicks, typing or local usage counts for analytics.
Navigation diagnostics retain bounded hostnames and reason codes locally. Share
diagnostics manually only after checking that they contain no private information.

Unsigned packages and reviewer archives contain source and curated public presets,
never your saved browser profile. Backup files and Firefox profiles are private;
keep them outside the repository and release archives.

## Direct toolbar synchronization (development)

The optional bookmarks permission now connects direct Firefox toolbar bookmarks
and Atlas pins with one user action. No folder is implicitly adopted or changed.
Bookmark names and full supported URLs are local presentation data, never logged
in diagnostics or sent to an external synchronization service by Atlas. Firefox
may independently sync its bookmarks under the user's Firefox account settings.
Unpinning deletes synchronized toolbar bookmarks; disconnect preserves both
copies. Unknown and blocked bookmarks remain subject to the ordinary Core gate.

### Development Home bookmark mirror

The approved development manifest requests `bookmarks` at install/update (Firefox
owns its permission prompt). Atlas automatically connects direct toolbar bookmarks
and projects toolbar folders read-only. It reads supported nested page names and
exact URLs locally; these are not sent to diagnostics. Folder icon preferences are
local presentation data. Every bookmark launch still uses Core's ordinary gate.
Explicit disconnect stops synchronization. Conflict/recovery controls remain in
Settings. No new external services or trackers are used.
