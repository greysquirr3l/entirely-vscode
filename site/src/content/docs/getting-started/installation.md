---
title: Installation
description: Install the extension and the Entire CLI.
sidebar:
  order: 2
---

Entirely needs two things: the extension and the Entire CLI.

## Requirements

| Requirement | Version |
|---|---|
| Visual Studio Code | 1.140 or newer (`engines.vscode` is `^1.140.0`) |
| Entire CLI | `entire version` must run. Tested with 0.12.2 |

An older CLI still works. The extension reads what it can, and the [doctor report](/entirely/guides/doctor-and-diagnostics/) says what is missing. `entirely.minimumCliVersion` (default `0.12.2`) is the oldest version whose output the extension reads in full. Raise it when the extension starts reading a newer field. Lower it if an older CLI turns out to report everything. It is a machine-scoped setting.

## Install the CLI

Follow Entire's own instructions at [docs.entire.com/installation](https://docs.entire.com/installation). Entirely doesn't restate or run the installer for you.

After installing, check it from a terminal:

```sh
entire version
```

The CLI installs to `~/.local/bin`, which many shells and the editor's integrated terminal don't have on `PATH`. That is fine for Entirely: it looks on `PATH` first, then in the documented install locations, and runs the CLI by absolute path. A CLI found off `PATH` is treated as found and usable. Only the integrated terminal can't run `entire`. **Entirely: Add the Entire CLI to the Terminal PATH** fixes that through the editor's own terminal environment setting, with no shell profile edit.

## Install the extension

Entirely is on the Visual Studio Marketplace. Search for **Entirely** in the
Extensions view and install it, or download the `.vsix` from the
[GitHub releases](https://github.com/greysquirr3l/entirely-vscode/releases)
and run **Extensions: Install from VSIX**. Then open a folder that uses
Entire.

## When the CLI isn't on PATH

If discovery doesn't find the CLI, set `entirely.cliPath` to the absolute path of the `entire` binary.

| Setting | Default | Scope |
|---|---|---|
| `entirely.cliPath` | empty | machine |

Empty means "use `PATH`, then the documented install locations". The setting can be set in user settings or remote-machine settings, never in workspace settings. A repository you clone can't point the extension at a different binary. Relative `PATH` entries are ignored during discovery for the same reason.

## Remote windows

The extension runs in the workspace host. In Remote-SSH, a dev container, WSL, Codespaces or a browser-based editor, the CLI must be installed on the remote machine, not on your laptop. Set `entirely.cliPath` in the remote machine's settings if it isn't on that machine's `PATH`. See [Remote windows](/entirely/concepts/remote-windows/).

## When the CLI is missing or old

| Situation | What you see |
|---|---|
| CLI not found | A notification, "Entirely needs the Entire CLI, which is not installed", with **Show Install Instructions**. The Integrations view shows the same link. Nothing else runs. |
| CLI found but can't run | The status bar shows a warning, and its tooltip gives the reason. |
| CLI older than `entirely.minimumCliVersion` | Everything works that the older output allows. The doctor report warns that some information will be missing. |

Hooks the CLI installs into your repository exit quietly when `entire` is missing, so a missing CLI never breaks your Git commands.

Run **Entirely: Doctor: Copy a Diagnostic Report** at any point to see the path, version and location the extension found.

## Next

[Quickstart](/entirely/getting-started/quickstart/).
