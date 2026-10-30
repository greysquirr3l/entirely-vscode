---
title: Remote windows
description: Using Entirely in SSH, container and WSL windows.
sidebar:
  order: 4
---

Entirely is a workspace extension (`extensionKind: ["workspace"]`). In a remote window it runs on the remote host, next to your files and your Git repository, and it runs the CLI there.

This applies to Remote-SSH, dev containers, attached containers, WSL, Codespaces and browser-based editors.

## Where things run

| Piece | Where |
|---|---|
| The extension | The remote host |
| The `entire` CLI | The remote host. Install it there, not on your laptop |
| The CLI's logins and credential store | The remote host |
| Your browser | Your own machine |
| The MCP server (`entire mcp`) | The remote host. The editor starts and stops it |
| Plugins | The remote host. Plugin installs run in the folder you chose |

If the remote host doesn't have the CLI, the extension shows the same "not installed" message as anywhere else. See [Installation](/entirely/getting-started/installation/).

## Sign-in

The CLI on the remote can't open your browser, so Entirely uses a device code. It says why ("Entirely is running on a remote host over SSH (ssh-remote), so the sign-in uses a code you enter in your browser", or the equivalent for a container, WSL, a codespace or a browser-based editor), shows the code in a panel, and opens the verification page in your own browser. It opens only `https` addresses on Entire domains.

You sign in once per remote host, because logins are saved on the host that runs the CLI. See [Sign in](/entirely/getting-started/sign-in/).

## Settings

Remote windows have three settings layers: user, remote machine, and workspace.

| Setting | Scope | Notes |
|---|---|---|
| `entirely.cliPath` | machine | Set it in the remote machine's settings if the CLI isn't on that host's `PATH`. Not settable from a workspace |
| `entirely.cliContext` | machine | Same. Names a login saved on the remote host |
| `entirely.minimumCliVersion` | machine | Applies to the remote host's CLI |
| `entirely.mcpServerEnabled` | resource | Can differ per workspace folder. Entirely reads it per folder and, when you turn the server on, changes the setting that is keeping it off, and names which one |

A path from your laptop in `entirely.cliPath` won't exist on the remote, so use the remote machine settings.

## The terminal PATH

**Entirely: Add the Entire CLI to the Terminal PATH** writes the editor's terminal environment setting. In a remote window, pick the scope with care: your user settings apply to every window, including local ones where that directory may not exist.

## MCP and plugins

`entirely.mcpServerEnabled` offers `entire mcp` to the editor's agent. The process runs on the remote host and uses that host's login. The Integrations view reads each folder with the CLI running from that folder, so a per-folder `PATH` or `ENTIRE_PLUGIN_DIR` shows up in that folder's rows. See [Integrations and MCP](/entirely/guides/integrations-and-mcp/) and [Plugins](/entirely/guides/plugins/).

## Troubleshooting

- Status bar shows nothing or a warning: run **Entirely: Doctor: Copy a Diagnostic Report** in the remote window. It reports the path, version and location of the CLI on the remote host.
- Sign-in page didn't open: copy the address from the sign-in panel and open it on any device.
- A setting seems ignored: check that it's set in the remote machine's settings, not only your local user settings.

See [Doctor and diagnostics](/entirely/guides/doctor-and-diagnostics/).
