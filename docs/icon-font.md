# Entire icon assets

The extension ships Entire's logo (Marvin) in two forms, both built from Entire's
official symbol without modification:

- `images/entirely-view.svg` is the Activity Bar icon for the Entirely view container.
  VS Code uses Activity Bar SVGs as a mask, so only the shape matters.
- `assets/entire-icons.woff` is a one-glyph icon font registered in `contributes.icons`.
  Use it in VS Code labels, including status-bar text, with `$(entire-logo)`.

| Icon ID | Code point |
| --- | --- |
| `entire-logo` | `U+E001` |

## Source

Both come from the small-size icon variant of the symbol in Entire's brand kit:

- Source: <https://entire.com/downloads/entire-brand-kit.zip>
- File: `entire-brand-kit/symbol/entire-symbol-dark-icon.svg`
- Downloaded: 2026-10-30
- Vendored unchanged at `assets/brand/entire-symbol-icon.svg` (see `assets/brand/README.md`)

Entire's guidelines reserve the icon file for contexts where the logo appears at 32px and
below, which is where both uses sit.

`images/entirely-view.svg` is that file with only `width` and `height` set to 24px. The
`viewBox`, the three `<path>` elements and their path data are untouched, and the box was
already square, so nothing is stretched.

The glyph uses the same three paths. Only a uniform scale (32 to 300 units) and a
translate are applied to fit the font's 300-unit em, with Codicon-compatible metrics: a
300-unit advance and a 300/0 ascent/descent. The eyes are separate filled paths in the
official file, so they stay filled paths. Their contour direction is matched to the head's
so that a font's non-zero fill adds them rather than cutting them out; that does not change
any outline. The font uses a private-use code point, so it cannot collide with Codicons.

## Where it appears

The status bar shows `$(entire-logo) Entire` in every state, followed by a codicon for the
state. The Activity Bar uses `images/entirely-view.svg`.

| State | Status bar text |
| --- | --- |
| Tracked, no session running | `$(entire-logo) Entire` |
| Session running | `$(entire-logo) Entire $(pulse)` |
| Tracked or running, with a checkpoint problem | adds ` $(warning)` after the above |
| Not set up for the workspace | `$(entire-logo) Entire $(circle-slash)` |
| Not a git repository | `$(entire-logo) Entire $(circle-outline)` |
| The login in use cannot see the workspace | `$(entire-logo) Entire $(eye-closed)` |
| The login the user asked for is not one the CLI has | `$(entire-logo) Entire $(error)` |
| The CLI could not be read | `$(entire-logo) Entire $(warning)` |

Do not try to put an SVG or PNG directly in `StatusBarItem.text`; status-bar labels resolve
`$(...)` as a product icon glyph. The WOFF is declared in `package.json` under
`contributes.icons`, so VS Code creates the required font-face and CSS automatically.

## Regenerating the font

The generated WOFF is versioned because it is a runtime extension asset. Its source is
`scripts/generate-icon-font.py`, which reads the official SVG. Run it only when the symbol
changes.

```sh
python3 -m pip install 'fonttools[woff]'
python3 -I scripts/generate-icon-font.py                      # uses assets/brand/entire-symbol-icon.svg
python3 -I scripts/generate-icon-font.py path/to/icon.svg     # or another copy of the official file
```

The `assets/brand` directory is excluded from the VSIX (`.vscodeignore`); the package carries
the built font and `images/entirely-view.svg`.

## Brand use

Entire's brand guidelines (<https://entire.com/brand>) say: "Don't compress, distort, skew,
stretch, or alter the logo in any way." So the logo is never redrawn, badged or recoloured
here. Marvin is shown as Entire supplies it, and the state of the workspace is shown with a
codicon beside it, never drawn into it.

The logo is Entire's trademark. Entirely is an unofficial extension, not affiliated with or
endorsed by Entire.
