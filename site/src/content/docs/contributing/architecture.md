---
title: Architecture
description: The layers, the one CLI runner, and how a feature flows from a command to a view.
sidebar:
  order: 3
---

Entirely reads the Entire CLI and shells out to it for anything that changes state. It does not re-implement Entire. The code is layered so that this boundary stays in one place. For the user-facing picture, see [How Entirely works](/entirely/concepts/how-entirely-works/).

## Layers

The rule from `AGENTS.md` is that presentation depends on application, application on domain, domain on infrastructure. Each layer depends only on the one below it, domain types do not reference application or infrastructure types, and DTOs cross the boundaries. In the source tree the layers map to folders like this:

| Layer | Folder | Holds | May import `vscode`? |
| --- | --- | --- | --- |
| Presentation | `src/extension.ts`, `src/commands/`, `src/providers/` | Command handlers and their prompts, tree data providers, decorations, panels, the status bar item | Yes |
| Application | `src/services/` | Use cases such as the status controller, session lifecycle, trail service, control plane, dispatch, search | Yes |
| Domain | `src/lib/entire/` | Types for sessions, checkpoints, trails and status, decoders for the CLI's JSON, flag builders, wording for failures | No |
| Infrastructure | `src/services/cli/` | The runner, the CLI locator, process execution, usage parsing, the invocation recorder | Only where it must |

`vscode` may be imported only from `src/extension.ts`, `src/commands/`, `src/providers/` and `src/services/`. Everything under `src/lib/` is plain TypeScript with no `vscode` import, so it is tested without an extension host.

Presentation hands services plain values and gets plain values back. Providers do not decode JSON, and decoders do not know that a tree view exists.

## The runner

`CliRunner` (`src/services/cli/runner.ts`) is the only code that starts the `entire` process. Timeouts, output capture and the failure taxonomy are decided there once.

Nothing in the runner throws. A missing CLI, a broken CLI, a timeout, a non-zero exit and a malformed response are all returned as values. Each one is a state the extension has to survive, and callers handle them explicitly. That is how the extension degrades to a clear message when the CLI is absent.

Beyond a timeout, a working directory, stdin and an abort signal, the runner takes options that decide who the call acts as and what its record may contain.

| Option | Purpose |
| --- | --- |
| `context` | The saved login this one call acts as. A change that was confirmed as a named login runs as exactly that login, even if the CLI's active login has moved since. |
| `ignoreContext` | Leaves the pinned login (`entirely.cliContext`) off this call. The command that lists saved logins needs it, to learn which login the CLI would use on its own. |
| `withholdBodies` | Keeps the output out of the invocation record. A transcript is the user's own conversation. The record keeps only the byte count. |
| `redactOperands` | Replaces everything after the first `--` in the recorded command line. Used for search queries and file operands. |
| `redactFrom` | Replaces every argument from an index on, for free text that cannot follow a `--`, such as plugin arguments. |
| `redactFlags` | Replaces the values after named flags, for comment bodies and approval messages. The command still runs with the real value. |

Redaction affects only the record, which feeds the output channel and **Doctor: Show the Last Entire CLI Output**. See [Privacy and redaction](/entirely/concepts/privacy-and-redaction/).

The runner also reads flags at run time. `runner.usage('trail approve')` runs `entire agent-help trail approve` and parses the flags. Callers build their arguments from that, never from a hardcoded list. `runner.help` reads `--help` for commands that `agent-help` does not list.

## How a feature flows

Take the Sessions view and **Show Only This Workspace's Session**.

1. **Command.** `entirely.showOwnSession` is registered in `src/commands/`. It sets the `entirely.ownSessionOnly` context key and asks the provider to refresh.
2. **Provider.** `SessionsProvider` (`src/providers/`) asks its session source for a listing with the query `ownOnly: true`.
3. **Service.** `createSessionSource` (`src/services/sessionSource.ts`) calls the runner: `session list --json`, and for the own-session filter `session current --json`.
4. **Runner and CLI.** The runner starts `entire` with the right working directory and login, applies the timeout, records the invocation, and returns the output as a value.
5. **Parse.** A decoder in `src/lib/entire/` turns the JSON into typed sessions or reports exactly which field was wrong. A failure carries a human reason.
6. **View.** The provider renders the sessions, or the failure reason as the view's message. The empty-state text comes from `viewsWelcome` in `package.json`.

Anything that changes state follows the same path with one more step at the front: the command asks for confirmation in a modal that names what will change, and the service reads the result back from the CLI before it reports success. An exit code of 0 that did not do the work is reported as a failure.

## Lifecycles

`src/extension.ts` constructs the services, wires them to providers and commands, and pushes every command, provider, tree view, watcher and listener onto `context.subscriptions`. A disposable that is not registered there is a leak. Polling uses `entirely.refreshInterval`, and each `entire` call is bounded by a timeout setting so that none blocks the host.
