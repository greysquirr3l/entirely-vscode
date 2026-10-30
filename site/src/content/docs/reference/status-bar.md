---
title: Status bar
description: The status bar item, every state it can show, its tooltip and what a click does.
sidebar:
  order: 4
---

Entirely adds one item to the left side of the status bar, at priority 100. The item always starts with Entire's logo, written `$(entire-logo)`, then the word `Entire`, then a codicon that names the state. The logo is never altered or coloured to show state. See [How Entirely works](/entirely/concepts/how-entirely-works/).

If the CLI is absent, the item is hidden. A workspace that does not use Entire shows nothing, rather than a permanent error.

## States

The text, tooltip and click action come from `src/services/statusBar.ts` and `clickAction` in `src/services/statusController.ts`.

| State | Text | Tooltip | Click |
| --- | --- | --- | --- |
| Session running | `$(entire-logo) Entire $(pulse)` | "Entire is tracking this workspace. *agent* is running." If the agent is not known: "An agent session is running." | Reveals the Sessions view |
| Tracked, no session | `$(entire-logo) Entire` | "Entire is tracking this workspace. No agent session is running." | Reveals the Sessions view |
| Checkpoint problem (tracked or running) | the text above with ` $(warning)` added | The problem is the first line after the opening sentence | Reveals the Sessions view |
| Not set up | `$(entire-logo) Entire $(circle-slash)` | "Entire is not set up for this workspace. Click to set it up." | Offers to set Entire up (see **Entirely: Set Up Entire**) |
| Not a git repository | `$(entire-logo) Entire $(circle-outline)` | "This workspace is not a git repository, so Entire cannot track it." | Shows a message saying the same |
| Login cannot see the workspace | `$(entire-logo) Entire $(eye-closed)` | "Entire is tracking this workspace, but the login it is acting as ("*handle*") cannot see *where its checkpoints are*." When a saved login name is known it adds: Set `entirely.cliContext` to the login that tracks it. | Shows a message telling you to set `entirely.cliContext` |
| Login not known to the CLI | `$(entire-logo) Entire $(error)` | "Entirely is set to use a login the Entire CLI does not have." followed by the CLI's detail | Shows an error with the detail |
| CLI could not be read | `$(entire-logo) Entire $(warning)` | "Entirely could not read the Entire CLI:" followed by the detail | Shows an error with a **Show Logs** button that opens the output channel |

After **Disable Capture** or **Remove Entire**, the repository reads as "Not set up", because that is what `status --json` reports once Entire is off. No separate "capture off" state is added, and the click offers to set Entire up again. The status bar has no menu of its own; the capture-control commands are in the Command Palette (see [Stop, configure and clean capture](/entirely/guides/capture-control/)).

The two error states differ on purpose. `$(error)` is a mistake in your settings: `entirely.cliContext` names a login the CLI does not have. `$(warning)` on its own means the CLI did not answer. A workspace with a checkpoint problem shows `$(warning)` after the state codicon, so you can tell it apart from a healthy one by looking at the bar. The tracked and running tooltips can also carry these lines, in this order:

1. The checkpoint problem, if there is one.
2. "Checkpoints go to *destination*." A checkpoint that stays on the machine is worth saying aloud: it is why a dashboard can be empty while everything else looks fine.
3. "Acting as *handle*." The handle of the login the extension is using. See [Accounts and contexts](/entirely/concepts/accounts-and-contexts/).
4. "Entire's settings here:" followed by the settings that are set, separated by dots. A setting nobody set is not listed.

Every click runs the command `entirely.statusBar` (**Entirely: Entirely Status**), which is hidden from the palette.

The *invisible to login* state is a separate case from not set up. The workspace is set up, but under a login you are not currently acting as. See [Doctor and diagnostics](/entirely/guides/doctor-and-diagnostics/) if the state does not match what you expect.

## The Entire symbol

`$(entire-logo)` is a glyph in a one-glyph icon font, `assets/entire-icons.woff`, declared in `contributes.icons` with the code point `U+E001`. It is a private-use code point, so it cannot collide with a codicon. The Activity Bar uses the same symbol as `images/entirely-view.svg`, which VS Code treats as a mask.

Both come unmodified from the small-size icon variant of Entire's official symbol in its brand kit. Entire's guidelines reserve that file for contexts at 32 px and below, which is where both uses sit. The only changes are a uniform scale and a translate to fit the font's 300-unit em, and `width` and `height` set to 24 px on the SVG.

### Brand note

Entire's guidelines say not to compress, distort, skew, stretch or alter the logo. For that reason the extension never redraws, badges or recolours it. State is shown by the codicon beside the symbol, never drawn into it.

The logo is Entire's trademark. Entirely is an unofficial extension, not affiliated with or endorsed by Entire. The source file, the font's generator script and the regeneration steps are in [docs/icon-font.md](https://github.com/greysquirr3l/entirely-vscode/blob/main/docs/icon-font.md).

## Related

- [Views](/entirely/reference/views/)
- [Settings](/entirely/reference/settings/)
