# Entire icon assets

This extension ships two forms of Marvin artwork:

- `images/entirely-view.svg` is a monochrome 24×24 Marvin line-art icon for the Entirely Activity Bar view container.
- `assets/entire-icons.woff` is the custom icon font registered in `contributes.icons`. Use these glyphs in VS Code labels, including status-bar text, with `$(icon-id)`.

The font uses Codicon-compatible metrics: 300 units per em, a 300-unit advance width, and a 300/0 ascent/descent. It uses private-use code points, so it cannot collide with Codicons.

| Icon ID | Code point | Intended state |
| --- | --- | --- |
| `entire-logo` | `U+E001` | Marvin / normal tracked state |
| `entire-compact` | `U+E002` | Compact Marvin |
| `entire-large` | `U+E003` | Large Marvin |
| `entire-dot` | `U+E004` | Marvin with notification dot |
| `entire-dot-compact` | `U+E005` | Compact notification dot |
| `entire-in-progress` | `U+E006` | Marvin with progress arrows |
| `entire-success` | `U+E007` | Marvin with check badge |
| `entire-warning` | `U+E008` | Marvin with warning badge |
| `entire-warning-large` | `U+E009` | Large Marvin with warning badge |
| `entire-error` | `U+E00A` | Marvin with error badge |
| `entire-unavailable` | `U+E00B` | Marvin with unavailable slash |
| `entire-not-connected` | `U+E00C` | Marvin with disconnected badge |
| `entire-snooze` | `U+E00D` | Marvin with snooze marks |
| `entire-blocked` | `U+E00E` | Marvin with blocked badge |

## Where each glyph is used

| Icon ID | Where it appears |
| --- | --- |
| `entire-logo` | Status bar: the workspace is tracked and no agent session is running |
| `entire-in-progress` | Status bar: the workspace is tracked and an agent session is running |
| `entire-dot` | Status bar: tracked or running, but there is a checkpoint problem (replaces the base icon; the tooltip says what is wrong) |
| `entire-unavailable` | Status bar: Entire is not set up for the workspace |
| `entire-blocked` | Status bar: the workspace is not a git repository |
| `entire-not-connected` | Status bar: the login in use cannot see the workspace |
| `entire-error` | Status bar: the login the user asked for is not one the CLI has |
| `entire-warning` | Status bar: the CLI could not be read |
| `entire-compact`, `entire-large`, `entire-dot-compact`, `entire-success`, `entire-warning-large`, `entire-snooze` | Declared and available, not used yet |

The Activity Bar uses `images/entirely-view.svg`, not a glyph.

For example:

```ts
statusBarItem.text = '$(entire-logo) Entire';
statusBarItem.text = '$(entire-success) Entire';
```

Do not try to put an SVG or PNG directly in `StatusBarItem.text`; status-bar labels resolve `$(...)` as a product icon glyph. The WOFF is declared in `package.json` under `contributes.icons`, so VS Code creates the required font-face and Codicon CSS automatically.

## Regenerating the font

The generated WOFF is versioned because it is a runtime extension asset. Its source is `scripts/generate-icon-font.py`, which contains the flattened Marvin head used for issue #15 and draws the state badges programmatically.

```sh
python3 -m pip install 'fonttools[woff]'
python3 scripts/generate-icon-font.py
```

The generator should be run only when changing the icon geometry. It writes `assets/entire-icons.woff` with the metrics expected by VS Code product icons.
