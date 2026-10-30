---
title: Settings
description: Every setting, its default, scope and range, and what it changes.
sidebar:
  order: 2
---

Entirely declares 25 settings under `entirely.*`. Open them with **Entirely: Open Settings** or search the Settings editor for `@ext:greysquirr3l.entirely`. The defaults and ranges below are read from `contributes.configuration` in `package.json`.

Every value that a person might reasonably change is a setting. Timeouts are in seconds unless a row says otherwise. A value outside the range is clamped by the extension when it reads the setting.

## Scope

A setting with no explicit scope is `window`: user, remote-machine or workspace settings can set it. Three settings are `machine` scoped and one is `resource` scoped.

:::note[Machine-scoped settings]

`entirely.cliPath`, `entirely.cliContext` and `entirely.minimumCliVersion` are **machine** scoped. They can be set in user settings or in remote-machine settings, and never in workspace settings or a `.vscode/settings.json` checked into a repository.

The reason is trust. `cliPath` decides which binary the extension runs, and `cliContext` decides which Entire login it acts as. If a repository could set either, cloning and opening it would let it point the extension at another executable or another account. Keeping them out of workspace settings closes that route. For the same reason the extension never reads the CLI's credential store. See [Privacy and redaction](/entirely/concepts/privacy-and-redaction/) and [Accounts and contexts](/entirely/concepts/accounts-and-contexts/).

In a remote window, the extension runs on the remote host, so set `cliPath` in the remote-machine settings. See [Remote windows](/entirely/concepts/remote-windows/).

:::

`entirely.mcpServerEnabled` is **resource** scoped, so it can differ per workspace folder in a multi-root workspace.

## The CLI and the login

| Setting | Type | Default | Scope | Description |
| --- | --- | --- | --- | --- |
| `entirely.cliPath` | string | `""` | machine | Absolute path to the `entire` binary. Empty means the built-in discovery order: `entire` on `PATH`, then the documented install locations. |
| `entirely.cliContext` | string | `""` | machine | The saved `entire` login to act as. Empty follows the login the CLI uses on its own. Use a name `entire auth contexts` prints, such as `us.auth.entire.io` or `handle@us.auth.entire.io`. It changes what Entirely does only. The CLI keeps the login it would use in your terminal. |
| `entirely.minimumCliVersion` | string | `"0.12.2"` | machine | The oldest CLI version whose payloads the extension reads in full. An older CLI still works, and the doctor report warns about what is missing. |

## Refresh and logging

| Setting | Type | Default | Range | Description |
| --- | --- | --- | --- | --- |
| `entirely.refreshInterval` | number | `30` | 0 to 3600 | Seconds between re-reads of the CLI for workspace and session state. `0` polls only when a command runs. |
| `entirely.logLevel` | string | `"info"` | `error`, `warn`, `info`, `debug`, `trace` | Verbosity of the Entire output channel. It does not change the CLI's own log level. |
| `entirely.debug` | boolean | `false` | | Adds the exact command line, working directory and exit code of every CLI call, plus an output excerpt. Same effect as `logLevel: debug`. Prompt bodies, transcripts and payloads stay out. |

## Views

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `entirely.showSessionsInExplorer` | boolean | `false` | Also show the sessions tree in the Explorer as **Entirely Sessions**. |
| `entirely.searchScope` | string | `"repository"` | `repository` searches this workspace's repository. `all-repositories` searches every repository the acting login can see. The Search view always shows the scope and the login. |
| `entirely.searchDebounce` | number | `400` | Milliseconds to wait after you stop typing in the checkpoint search box (100 to 3000). |
| `entirely.blameMaxDecoratedLines` | number | `5000` | Longest file, in lines, that **Entirely: Blame This File** decorates (100 to 100000). A longer file still shows in the panel. |

## Timeouts

The extension never waits forever on the CLI. Each class of call has its own limit.

| Setting | Default | Range | What it limits |
| --- | --- | --- | --- |
| `entirely.transcriptTimeout` | `60` | 5 to 600 | Opening a session transcript. |
| `entirely.trailActionTimeout` | `60` | 5 to 600 | A trail review action: approve, comment, merge, check out, link, unlink. |
| `entirely.lifecycleActionTimeout` | `60` | 5 to 600 | `session stop`, `attach` or `adopt`, and agent install and removal. |
| `entirely.resumeWatchTimeout` | `60` | 5 to 600 | How long **Resume Session** watches for the session to become active. The resume keeps running in its terminal. |
| `entirely.importTimeout` | `300` | 10 to 3600 | `entire import` and its preview. A timed-out import can be rerun, since imported turns are skipped. |
| `entirely.cliDoctorTimeout` | `30` | 5 to 300 | The CLI's own `entire doctor` inside the report. |
| `entirely.controlPlaneTimeout` | `60` | 5 to 900 | Each Control Plane listing, change or API call. A change that times out is read back before it is reported. |
| `entirely.activityTimeout` | `30` | 5 to 300 | `entire activity` and `entire recap`. |
| `entirely.dispatchTimeout` | `180` | 10 to 1800 | **Generate Dispatch**. It is never restarted after a timeout. |
| `entirely.pluginTimeout` | `120` | 10 to 1800 | **Run Plugin Command** and **Install Plugin**. Never restarted after a timeout. |

## Agent integrations and the hook bridge

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `entirely.editorHookAgent` | string | `"copilot-cli"` | The agent integration whose hook payload layout matches the editor's own agent events (a name `entire agent list` prints). Must match `^[a-z0-9][a-z0-9._-]*$`. Only `copilot-cli` can be bridged today. Other values are reported and not forwarded. |
| `entirely.agentLookupCacheSeconds` | number | `30` | Seconds to reuse the agent list and hook-file scan for editor events (5 to 600). Install and remove refresh it at once. |

## Plugins and MCP

| Setting | Type | Default | Scope | Description |
| --- | --- | --- | --- | --- |
| `entirely.mcpServerEnabled` | boolean | `true` | resource | Offer `entire mcp` to the editor as an MCP server. The editor starts and stops the process. Entirely does not write the editor's own MCP configuration. |
| `entirely.suggestedPlugins` | string array | `["graph", "investigate", "brain"]` | window | Plugins the Integrations view reports on and the picker offers. Each is the part after `entire-` in the executable name. A name that cannot name a plugin is ignored. |
| `entirely.offerIntegrationInstall` | boolean | `true` | window | Offer once per machine to install missing suggested plugins, and once per project to add the MCP server to `.mcp.json`. The Integrations view still shows status when off. |

See [Plugins](/entirely/guides/plugins/) and [Integrations and MCP](/entirely/guides/integrations-and-mcp/).

## Settings the extension writes

Two commands write editor settings, each after you confirm. **Entirely: Add the Entire CLI to the Terminal PATH** lets you choose the scope and writes `terminal.integrated.env.<platform>`. **Entirely: Turn On MCP Server** has no scope choice: it writes `entirely.mcpServerEnabled` in the narrowest scope that takes effect (folder, then workspace, then user).
