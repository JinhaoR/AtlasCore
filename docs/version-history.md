# Version history

This is the single release-history file. Feature contracts describe the current
rules; these notes explain how we got here. Core's package version remains 0.1.0.
The Firefox identity is always `atlas-development@atlas.invalid`.

## 0.3.3 — signing candidate

- Keeps Add Site, review and Vault together in All Sites; timing changes stay in
  Settings. Saved edits go directly to review.
- Simplifies the review and Vault screens, shows readable waits and dated
  deadlines, and keeps confirmation controls steady. Full details and failed-save
  recovery remain available.
- Includes the steady compass hover/drag treatment, bounded hostname validation
  mitigation and automatic clock catch-up recovery. The original Firefox
  InternalError trigger remains unproven; its explicit Recovery rules remain.
- Prepares a new unsigned candidate while preserving all retained release bytes.

Validation: [0.3.3 evidence](evidence/site-workflow-0.3.3/README.md).

## 0.3.2

- Keeps the compass visible on fresh installations, with one pin, and in narrow
  windows. No sites or permissions are silently added.
- Adds Open site and Pin to Home to All Sites details, using existing browser
  authorization and presentation storage.
- Simplifies site details, editing labels and routine feedback; keeps scope,
  waiting, review and failed-save information truthful.
- Prepared unsigned. Signed 0.3.1 and all retained releases remain unchanged.

Validation: [0.3.2 evidence](evidence/friendly-sites-0.3.2/README.md).

## 0.3.1

- Bundles Celestial and Parchment with their existing compass, fonts and colors;
  backgrounds remain plain. Settings has a dedicated Appearance section.
- Moves Greylist requests, active grants and Journeys beside All Sites. Home
  gains a larger responsive compass and reference-inspired proportions.
- Includes repository/theme cleanup and clearer shared-hosting scope help:
  `github.io` cannot grant access to every tenant; use your own tenant hostname.
- Core contracts, storage formats, migrations and extension identity are unchanged.
- Prepared unsigned for signing; no signing, submission or live installation.

Validation and artifacts are recorded in
[0.3.1 evidence](evidence/access-page-0.3.1/README.md).

## Local release retention

The November 2026 cleanup keeps only signed **0.2.8** and prepared unsigned
**0.3.0** in `extension/release/`. Their existing bytes are unchanged. Older local
archives, staged runtimes and repeated release reports were removed at the
user's request. This supersedes historical instructions to keep every release.
No release was repackaged, signed or deployed by the cleanup.

Native current checks use signed 0.2.8. Reproducing an older release-specific
upgrade requires the actual external baseline and matching receipt; do not
substitute a different version and claim the old scenario passed.

## Development after 0.3.0 preparation

Home balance, category ordering and theme work continued after the frozen
candidate. Core, Firefox and static themes now have explicit source ownership.
Background map experiments and references were later removed, keeping compass
artwork, typography and colors. User-supplied backgrounds belong in
`themes/<theme>/assets/`; see the [handoff guide](../themes/README.md).
The Add Site scope help explains shared hosting suffixes such as `github.io`.
The current development tree is not the already-prepared 0.3.0 archive.

<a id="v0-3-0"></a>
## 0.3.0 — prepared, unsigned

Separates Home's search/compass/access summaries from All Sites' category grid
and native Add/Edit dialog. Adds contextual directory navigation, floating search
and consistent Greylist cancellation; repairs pin pointer activation and wheel
flashing. Policy, permissions, storage formats and existing migrations are
unchanged. Saved category/pin/draft data survives the presentation change.

The candidate passed packaging, lint, source reproduction and isolated signed
0.2.8 upgrade/restart/rollback checks. [Package evidence](evidence/firefox-release-0.3.0.json).
Signing and deployment remain separate actions.

<a id="v0-2-8"></a>
## 0.2.8 — latest retained signed release

Simplifies Home and inline Greylist controls, adds committed early grant
termination, more local icons and read-only native toolbar folder groups.
Bookmarks permission becomes required and the existing journaled connection
starts automatically, respecting explicit disconnects/conflicts.

The one-time curated-subdomain migration adds scopes for still-allowed bundled
hosts. It preserves custom/exact exceptions, settings, drafts and saved display
data. Literal roots do not widen to their parent; manual Blacklist wins and
managed blocking still applies to additional hosts. Removing a scope later is
respected. Existing v2/v3 curated receipts remain valid; migrations are retained.
See [migration details](curated-subdomains.md) and
[package evidence](evidence/firefox-release-0.2.8.json).

<a id="v0-2-7"></a>
## 0.2.7

Compass artwork rotates with upright pin logos; motion and reduced-motion
handling improve. Compact Greylist/Journey summaries keep fixed deadlines.
Navigation failures get accurate feedback and a normal gated retry.

<a id="v0-2-6"></a>
## 0.2.6

Animated category dragging, ring dragging with bounded friction, visual icon
selection and Vault inside Settings. Shared UI copy is centralized. Direct
toolbar bookmarks synchronize with pins; unpin removes synchronized toolbar
bookmarks. The extended toolbar record is not readable by older folder-sync
builds; downgrade is not a data conversion.

<a id="v0-2-5"></a>
## 0.2.5

One scrollable Home category grid, drag/keyboard ordering and local category
icons replace earlier separate directory/customization controls. Direct access
to the optional Firefox bookmark connection uses acknowledged presentation saves.

<a id="v0-2-4"></a>
## 0.2.4

Read-only toolbar popup, clearer everyday wording, stable desktop search/pins,
parser-time page startup and optional serialized native bookmark integration.
The runtime inventory grows from 23 to 27 files; authorization stays in Core.

<a id="v0-2-3"></a>
## 0.2.3

Compact Home, rotatable pins, category browsing and named bookmark pages.
Narrow windows use labelled pin rows. Presentation ordering never grants access.

<a id="v0-2-2"></a>
## 0.2.2

Fixes constrained directory row sizing, batches display evaluation through Core,
and avoids default-layout flashes. Saved permissions still use the controller.

<a id="v0-2-1"></a>
## 0.2.1

Firefox Home/new-tab overrides, stable initial shell, local font preloads,
bounded favicon caching and responsive viewport/scroll repairs. Temporary
installation still has Firefox's own lifetime and persistence limitations.

<a id="v0-2-0"></a>
## 0.2.0

Navy/cream/gold interface, local licensed fonts, top navigation, stationary
compass, compact directory/editor and clearer batch review/Vault/Settings.
Adds nine font/licence/source files to the original 14-file runtime inventory.

<a id="v0-1-19"></a>
## 0.1.19

Improves editor reliability, review density and rendering ownership. Adds
reviewed immediate strict Whitelist subtraction and explicit optional subdomain
scopes; additions/mixed changes still use Vault. Older builds that cannot read
scope fields must fail closed, never strip them. Validated structural comparison
and bounded diagnostics preserve commit/unknown-outcome checks. The reported
intermittent INTERNAL_ERROR cause remains unconfirmed.

<a id="v0-1-18"></a>
## 0.1.18

Expands curated services with an explicitly approved one-time additive union.
The final v3 catalog excludes Wikipedia and YouTube; existing v2 receipts remain
valid without reapplying. Custom policy/settings and saved permissions survive.
Storage handling and performance investigations continue without speculative
history pruning or internal-fault auto-recovery.

<a id="v0-1-17"></a>
## 0.1.17

Read-only ordinary storage loads and one same-owner recovery for a confirmed
transient abort. Invalid state and unknown commit outcomes remain fail-closed.

<a id="v0-1-16"></a>
## 0.1.16

Stable Home/editor DOM, coalesced refreshes, retained frozen Vault review and
truthful display-save recovery. No second recurring UI refresh owner.

<a id="v0-1-15"></a>
## 0.1.15

Browser-attested Download Intent, saved Home category organization, navigation
continuity and visual polish. Downloads remain separate ephemeral operations;
they do not add policy, grants or Journey authority.

<a id="v0-1-14"></a>
## 0.1.14

Reliable presentation saves, exact search, persistent destination batch drafts,
one complete Vault proposal and explicit stale/failed-save recovery. Drafts use
a separate presentation database; authoritative schema 2 remains unchanged.

<a id="v0-1-13"></a>
## 0.1.13

Initial private unlisted Firefox distribution with reproducible source, pinned
feed verification, strict runtime hashes, signed installation and backup guidance.

## Compatibility records

Deleting old packages does not remove runtime migration code or tests. The
[curated](curated-expansion.md), [scope](whitelist-scopes.md),
[storage](firefox-storage-reliability.md), [bookmark](everyday-controls.md) and
[backup](firefox-backup.md) contracts remain authoritative. Update in place with
the same ID; do not uninstall to upgrade. Release verification still enforces
the original versioned inventories and limited signing metadata exceptions.
