# Entire icon assets

The extension shows three marks, and only one of them is Entire's own.

| Where | Asset | What it is |
| --- | --- | --- |
| The marketplace listing and the Extensions view | `images/logo.png` | Entire's logo (Marvin), the official symbol as a raster icon. The marketplace keeps it: a listing with no icon of its own is hard to recognise. |
| The Activity Bar | `images/codicon-robot.svg` | VS Code's own robot codicon, the one it uses for agents. The extension carries no mark of its own there. |
| The detail panel's tab | `images/entirely-view.svg` | Entire's official symbol, unaltered, at 24px. VS Code uses these SVGs as a mask, so only the shape matters. |

The status bar item starts with `$(robot)`, VS Code's own codicon, then the word
`Entire`, then a codicon for the state. Nothing of Entire's own is registered as a
product icon, so the extension adds no font to the editor.

## Sources

- `images/entirely-view.svg` comes from the small-size icon variant of the symbol in
  Entire's brand kit, copied unchanged:
  <https://entire.com/downloads/entire-brand-kit.zip>,
  `entire-brand-kit/symbol/entire-symbol-dark-icon.svg`, downloaded 2026-10-30, and
  vendored at `assets/brand/entire-symbol-icon.svg` (see `assets/brand/README.md`).
  Only `width` and `height` are set to 24px; the `viewBox` and the paths are untouched.
- `images/codicon-robot.svg` is the `robot` icon from VS Code's codicons
  (<https://github.com/microsoft/vscode-codicons>), the shape VS Code itself draws for
  agents. Only the rendered size and the fill differ from that file. The codicons are
  Microsoft's, under the MIT licence, and the file is a plain path with no script in it.

The Entire name and logo are Entire's trademarks. They are used here, unmodified, only to
identify the integration. Entirely is an unofficial extension and is not affiliated with or
endorsed by Entire.
