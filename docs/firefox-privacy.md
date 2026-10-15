# Atlas Firefox privacy notice

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
