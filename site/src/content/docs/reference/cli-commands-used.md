---
title: CLI commands used
description: The entire commands the extension runs, which feature uses each, and which ones change something.
sidebar:
  order: 5
---

Entirely never re-implements Entire. It finds the `entire` binary, reads its JSON output, and shells out for anything that changes state. Every call goes through one runner (`src/services/cli/runner.ts`), so timeouts, output capture and failure handling are decided once. See [Architecture](/entirely/contributing/architecture/).

The list below is section 1 of [docs/coverage.md](https://github.com/greysquirr3l/entirely-vscode/blob/main/docs/coverage.md), grouped by area. A test scans `src/` and fails if a call to a known command has no row there, so the list tracks the code. Derived against Entire CLI 0.12.2.

**Read** means the call does not change Entire, your repository or your login. **Changes** means it does. Commands you start from the editor that change something ask first; the [Commands](/entirely/reference/commands/) page says which confirm. The hook bridge runs on its own when editor agent events occur.

## Flags are read at run time

The extension does not keep a list of CLI flags. Before it builds an invocation that has options, it asks the installed CLI, with `entire agent-help <command>`. Each part of a command path is passed as its own word, for example `agent-help repo mirror add`. The extension parses the flags and descriptions out of the text and builds the call from what it finds. Examples:

- Agent reinstall appears only when `agent add --help` describes a reinstall flag.
- Import picks the agent from the CLI's own help.
- Control Plane calls take their flag names from `agent-help`.

A few commands are runnable but missing from `agent-help`, such as experimental ones. For those the runner reads the command's own `--help`. The `entire mcp` check does this.

If the CLI is missing or too old to describe a command, the feature says so and does nothing else. The CI job "Check the Entire CLI contract" (`npm run check:cli`) installs the pinned CLI version and checks that `agent-help` still lists the flags the extension passes. See [Testing](/entirely/contributing/testing/).

## Workspace and setup

| Command | Feature | Kind |
| --- | --- | --- |
| `entire version` | Locating the CLI and checking its version | Read |
| `entire agent-help` | Reading any command's flags at run time | Read |
| `entire status` | Status bar, doctor report, checkpoint destination | Read |
| `entire enable` | **Set Up Entire**. Non-interactive: the agent comes from `entire agent list`, with `--no-init-repo` | Changes |
| `entire doctor` | **Doctor: Show the CLI's Full Diagnostic Output**. The bare report only | Read |
| `entire doctor logs` | **Doctor: Show the CLI Log**. Always `--tail N` from `entirely.doctorLogLines`; never `--follow` or zero. The flag is read from the CLI's help | Read |
| `entire doctor trace` | **Doctor: Show Hook Traces**. `--last`, `--hook`, `--slow` and `--summary` only when the help describes them; never `--json` | Read |
| `entire doctor bundle` | **Doctor: Write a Diagnostic Bundle**. `--out` with a hidden temporary `.zip` beside the path you chose (moved into place only once it checks out); `--raw` only for the separate unredacted command | Writes a file you choose |
| `entire doctor migrate-checkpoints` | **Doctor: Migrate Checkpoints to Git Refs**. A dry run first, then one run with no flag, so it never names a remote or pushes | Read, then changes (local git refs) |

The four `doctor` subcommands above were tested only against a fake CLI. The real CLI's help for them was read, but none of the four was run against it, and their output formats were not observed.
| `entire hooks` | The hook bridge, which reports editor-side agent events to one configured agent. The CLI marks it internal | Changes (records events) |

## Stopping, configuring and cleaning capture

| Command | Feature | Kind |
| --- | --- | --- |
| `entire disable` | **Disable Capture**. One of two target flags (this checkout or the shared file), read from the help | Changes |
| `entire disable --uninstall` | **Remove Entire from This Repository**. The mode flag and the skip-confirmation flag are read from the help; the second is passed only after you typed the folder name | Changes |
| `entire configure` | **Configure Entire Settings**. Only the ticked settings and one target flag; never run bare | Changes |
| `entire clean` | **Clean Session Data**. The skip-confirmation flag (which also overrides the CLI's live-session guard) only after the modal; the scope is the default, the all flag or the session flag | Changes |
| `entire clean --dry-run` | The preview shown before a clean. Deletes nothing and asks nothing | Read |
| `entire runner setup` | **Set Up Trail Runners**. One of four forms; `runner` is not in `agent-help`, so its flags come from `runner setup --help`. A preview and a tailoring call the configured summary provider | Changes |

These six were tested only against a fake CLI. Their help was read; none of them was run against the real CLI, so their output and exit codes were not observed. See [Stop, configure and clean capture](/entirely/guides/capture-control/).

## Agent integrations

| Command | Feature | Kind |
| --- | --- | --- |
| `entire agent list` | **Set Up Agent Integrations**, the setup agent picker | Read |
| `entire agent add` | Installing an integration | Changes |
| `entire agent remove` | Removing an integration | Changes |

## Sessions

| Command | Feature | Kind |
| --- | --- | --- |
| `entire session list` | Sessions view, imported-session rows | Read |
| `entire session current` | Show Only This Workspace's Session | Read |
| `entire session info` | Session detail, transcript | Read |
| `entire session tokens` | Token usage in session detail | Read |
| `entire session stop` | **Stop Session** | Changes |
| `entire session attach` | **Attach Session to a Commit** | Changes |
| `entire session adopt` | **Adopt Session from Another Worktree** | Changes |
| `entire session resume` | **Resume Session**, in an editor terminal | Changes |
| `entire import` | **Import Past Agent History**: a preview, then the import | Changes |

## Checkpoints, search and provenance

| Command | Feature | Kind |
| --- | --- | --- |
| `entire checkpoint list` | Checkpoints view | Read |
| `entire checkpoint explain` | **Explain Checkpoint** | Read |
| `entire checkpoint tokens` | Token usage | Read |
| `entire checkpoint search` | **Search Checkpoints** | Read |
| `entire search` | **Search Past Work and Code** (work, and `--code`) | Read |
| `entire why` | **Why Does This Line Exist?** | Read |
| `entire blame` | **Blame This File** | Read |

## Identity

| Command | Feature | Kind |
| --- | --- | --- |
| `entire login` | **Sign In to Entire**, including `--device` | Changes (your login) |
| `entire logout` | **Sign Out of Entire** | Changes (your login) |
| `entire auth status` | Whether the login is valid | Read |
| `entire auth contexts` | Naming the acting login | Read |
| `entire repo view` | **Check Where Checkpoints Are Uploaded** | Read |
| `entire repo mirror list` | Whether the CLI can reach the checkpoint repository | Read |

The `--context` flag and the `ENTIRE_CONTEXT` variable are both passed when `entirely.cliContext` is set, because only the variable reaches plugin commands. See [Accounts and contexts](/entirely/concepts/accounts-and-contexts/).

## Trails

| Command | Feature | Kind |
| --- | --- | --- |
| `entire trail list` | Trails view | Read |
| `entire trail show` | One trail and its changes; read when a trail is expanded or selected in Trails, and shared with the detail panel | Read |
| `entire trail approvals` | Who approved a change | Read |
| `entire trail comment list` | A change's comments | Read |
| `entire trail finding list` | A change's findings | Read |
| `entire trail approve` | **Approve a Change on a Trail** | Changes |
| `entire trail comment add` | **Comment on a Change on a Trail** | Changes |
| `entire trail finding add` | Posting a finding from an agent session | Changes |
| `entire trail merge` | **Merge a Change on a Trail**: a `--dry-run` first, then the merge | Changes |
| `entire trail checkout` | **Check Out a Change on a Trail** | Changes (working tree) |
| `entire trail link` | **Link a Branch to a Trail** | Changes |
| `entire trail unlink` | **Unlink a Branch from a Trail** | Changes |
| `entire trail create` | **Create a Trail** | Changes (publishes the branch) |
| `entire trail update` | **Update a Trail** | Changes |
| `entire trail watch` | **Watch a Change on a Trail**: one long-running process per change | Read |
| `entire trail comment show` | **Show a Discussion**, and reading a message before an edit or delete | Read |
| `entire trail comment reply` | **Reply to a Discussion** | Changes |
| `entire trail comment edit` | **Edit a Discussion Message** | Changes |
| `entire trail comment delete` | **Delete a Discussion Message** | Changes |
| `entire trail comment resolve` | **Resolve a Discussion** | Changes |
| `entire trail comment unresolve` | **Reopen a Discussion** | Changes |
| `entire trail finding show` | **Show a Finding** | Read |
| `entire trail finding apply` | **Apply a Finding's Suggestion**: a check first, then the apply | Changes (working tree) |
| `entire trail finding dismiss` | **Dismiss a Finding** | Changes |
| `entire trail finding reopen` | **Reopen a Finding** | Changes |
| `entire trail finding resolve` | **Resolve a Finding** | Changes |
| `entire trail finding update` | **Update a Finding** | Changes |

## Control plane

| Command | Feature | Kind |
| --- | --- | --- |
| `entire org list`, `project list`, `repo list`, `cluster list` | Control Plane tree | Read |
| `entire org grant list`, `project grant list`, `repo grant list` | Who holds access | Read |
| `entire repo create` | **Create Repository** | Changes |
| `entire repo edit` | **Change Repository Visibility** (visibility only) | Changes |
| `entire repo delete`, `project delete`, `org delete` | The delete commands | Changes |
| `entire repo grant add`, `project grant add`, `org grant add` | **Give Access** | Changes |
| `entire repo grant remove`, `project grant remove`, `org grant remove` | **Remove Access** | Changes |
| `entire api` | **Call the Entire API**. One call, path confined to `/api`, no retry | Changes unless GET |

These were exercised against a fake CLI. They are not verified against a live Entire account. A change that times out is read back before it is reported. See [Control plane](/entirely/guides/control-plane/).

## Activity, plugins and MCP

| Command | Feature | Kind |
| --- | --- | --- |
| `entire activity` | Activity view, static non-interactive output | Read |
| `entire recap` | **Show Recap** | Read |
| `entire dispatch` | **Generate Dispatch** | Changes (writes a dispatch) |
| `entire plugin list` | Installed plugins | Read |
| `entire plugin install` | **Install Plugin** | Changes |
| `entire graph`, `investigate`, `brain` | Plugins, run by name through **Run Plugin Command**. The extension does not model their subcommands | Depends on the plugin |
| `entire mcp` | The MCP server offered to the editor's agent | Read (a long-running stdio server) |

Dispatch, plugin install and the live MCP server are tested with fake CLIs. They have not been verified against a live Entire account. Plugin commands run as the login the extension is acting as, and the CLI's built-in names are refused. See [Plugins](/entirely/guides/plugins/) and [Integrations and MCP](/entirely/guides/integrations-and-mcp/).

## Token profile, experts and review

| Command | Feature | Kind |
| --- | --- | --- |
| `entire tokens profile --json` | **Show Token Profile** | Read (checkpoint metadata only, no tokens spent) |
| `entire experts --json` | **Who Has Touched This Path?** and the other experts commands | Read, but the path or question is sent to Entire's servers |
| `entire review --list` | **List Review Profiles**, and the profile picker of a run | Read |
| `entire review --show-config --json` | **Show What a Review Would Run**, and the details in the run's confirmation | Read |
| `entire review --findings` | **Show Saved Review Findings** | Read |
| `entire review --profile=…` | **Run Multi-Agent Review**, in a terminal, after a confirmation | Starts agents that spend tokens |
| `entire review --configure` | **Set Up Review in a Terminal**, in a terminal, after asking | You complete a wizard |

All of these read their flags from `<command> --help`, since `agent-help` does not know them. `tokens profile --json` and `review --show-config --json` were observed against the real CLI 0.12.2; `review --list` with no profile and `--findings` with none saved were too. `experts` and the review run were never run for real, and the rest of the review outputs were not observed, so they are tested against a fake CLI only. The extension never passes `--trust-target`, any `--set-*` flag, `--agents`, `--models`, `--edit` or the experts viewer flag. See [Token profile, experts and review](/entirely/guides/tokens-experts-review/).

## Privacy of the call record

The runner keeps a record of each call for the output channel and **Doctor: Show the Last Entire CLI Output**. Options on the call decide what that record may hold. Transcripts, search queries, comment bodies and plugin arguments are kept out. See [Privacy and redaction](/entirely/concepts/privacy-and-redaction/).
