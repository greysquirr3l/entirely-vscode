---
title: Status bar
description: The status bar item, every state it can show, its tooltip and what a click does.
sidebar:
  order: 4
---

Entirely adds one item to the left side of the status bar, at priority 100. The item always starts with `$(robot)`, VS Code's own robot icon, then the word `Entire`, then a codicon that names the state. Nothing of Entire's own is drawn there, and the icon is never altered or coloured to show state. See [How Entirely works](/entirely/concepts/how-entirely-works/).

If the CLI is absent, the item is hidden. A workspace that does not use Entire shows nothing, rather than a permanent error.

## States

The text, tooltip and click action come from `src/services/statusBar.ts` and `clickAction` in `src/services/statusController.ts`.

| State | Text | Tooltip | Click |
| --- | --- | --- | --- |
| Session running | `$(robot) Entire $(pulse)` | "Entire is tracking this workspace. *agent* is running." If the agent is not known: "An agent session is running." | Reveals the Sessions view |
| Tracked, no session | `$(robot) Entire` | "Entire is tracking this workspace. No agent session is running." | Reveals the Sessions view |
| Checkpoint problem (tracked or running) | the text above with ` $(warning)` added | The problem is the first line after the opening sentence | Reveals the Sessions view |
| Not set up | `$(robot) Entire $(circle-slash)` | "Entire is not set up for this workspace. Click to set it up." | Offers to set Entire up (see **Entirely: Set Up Entire**) |
| Not a git repository | `$(robot) Entire $(circle-outline)` | "This workspace is not a git repository, so Entire cannot track it." | Shows a message saying the same |
| Login cannot see the workspace | `$(robot) Entire $(eye-closed)` | "Entire is tracking this workspace, but the login it is acting as ("*handle*") cannot see *where its checkpoints are*." When a saved login name is known it adds: Set `entirely.cliContext` to the login that tracks it. | Shows a message telling you to set `entirely.cliContext` |
| Login not known to the CLI | `$(robot) Entire $(error)` | "Entirely is set to use a login the Entire CLI does not have." followed by the CLI's detail | Shows an error with the detail |
| CLI could not be read | `$(robot) Entire $(warning)` | "Entirely could not read the Entire CLI:" followed by the detail | Shows an error with a **Show Logs** button that opens the output channel |

After **Disable Capture** or **Remove Entire**, the repository reads as "Not set up", because that is what `status --json` reports once Entire is off. No separate "capture off" state is added, and the click offers to set Entire up again. The status bar has no menu of its own; the capture-control commands are in the Command Palette (see [Stop, configure and clean capture](/entirely/guides/capture-control/)).

The two error states differ on purpose. `$(error)` is a mistake in your settings: `entirely.cliContext` names a login the CLI does not have. `$(warning)` on its own means the CLI did not answer. A workspace with a checkpoint problem shows `$(warning)` after the state codicon, so you can tell it apart from a healthy one by looking at the bar. The tracked and running tooltips can also carry these lines, in this order:

1. The checkpoint problem, if there is one.
2. "Checkpoints go to *destination*." A checkpoint that stays on the machine is worth saying aloud: it is why a dashboard can be empty while everything else looks fine.
3. "Acting as *handle*." The handle of the login the extension is using. See [Accounts and contexts](/entirely/concepts/accounts-and-contexts/).
4. "Entire's settings here:" followed by the settings that are set, separated by dots. A setting nobody set is not listed.

Every click runs the command `entirely.statusBar` (**Entirely: Entirely Status**), which is hidden from the palette.

The *invisible to login* state is a separate case from not set up. The workspace is set up, but under a login you are not currently acting as. See [Doctor and diagnostics](/entirely/guides/doctor-and-diagnostics/) if the state does not match what you expect.

## The icon

`$(robot)` is VS Code's own codicon, the one it uses for agents, so the status bar carries no mark of Entire's own and the editor gains no font. The Activity Bar uses the same shape as `images/codicon-robot.svg`, which VS Code treats as a mask.

Entire's own symbol is still the marketplace icon (`images/logo.png`) and the detail panel's tab icon (`images/entirely-view.svg`), both unmodified from the small-size icon variant of Entire's official symbol in its brand kit. The only change to it is `width` and `height` set to 24 px on the SVG.

### Brand note

Entire's guidelines say not to compress, distort, skew, stretch or alter the logo. For that reason the extension never redraws, badges or recolours it. State is shown by the codicon beside the word, never drawn into the symbol.

The logo is Entire's trademark. Entirely is an unofficial extension, not affiliated with or endorsed by Entire. The sources are in [docs/icons.md](https://github.com/greysquirr3l/entirely-vscode/blob/main/docs/icons.md).

## Related

- [Views](/entirely/reference/views/)
- [Settings](/entirely/reference/settings/)
