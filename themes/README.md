# Themes and backgrounds

Everything visual that belongs to a theme lives here. The compass artwork,
colors and fonts are kept; the previous map backgrounds, scans, experiments
and artwork generators have been removed.

```text
themes/
  celestial/
    theme.css       Colors, typography and background values
    assets/         Compass, orbit and small brand mark
  parchment/
    theme.css       Colors, typography and background values
    assets/         Compass rose and small brand mark
  shared/           Default/light palettes and licensed local fonts
  ARTWORK.md        Credits for the artwork still used
```

## Where to put your background

Put the finished image in **`themes/parchment/assets/home.webp`** or
**`themes/celestial/assets/home.webp`**. PNG/JPEG/SVG also work; use the matching
extension. Tell Codex which theme it belongs to and any crop/position preference.
Nothing needs to change in Core or the shared UI.

To connect it yourself, change the existing value in that theme's `theme.css`:

```css
--page-home-background: url("themes/parchment/home.webp") center / cover no-repeat, var(--page-background);
```

Use `themes/celestial/home.webp` for Celestial. The URL is the built Firefox path;
the build copies the file from `assets/` automatically. Keep filenames simple.
Do not edit `extension/dist` directly.

All Sites, Settings and narrow Home use `--page-workspace-background`, which is
currently the plain theme color. Leave that value alone for a Home-only image.
If you later want a separate quiet background there, supply `assets/workspace.webp`
and update that value explicitly. Images are decorative: keep the center readable.

Then run `npm.cmd --prefix extension run build`, reload the temporary add-on,
and select the theme in Settings. No image processing runs during a build.
Keep any required source credit/licence in `ARTWORK.md`; large working files
and alternate designs don't need to live in the repository.

The [theme contract](../docs/themes.md) covers the few integration points.
