---
title: How Entirely works
description: The extension reads the CLI and never re-implements it.
sidebar:
  order: 1
---

Entirely is a thin layer over the `entire` CLI. The CLI is the source of truth for what Entire does. The extension asks it, shows the answer, and asks you before it changes anything.

```
Entirely (this extension)
   └── entire CLI  (never re-implemented here)
         └── git refs, session state, the Entire API
```

## Finding the CLI

On start-up, and when a lookup goes stale, the extension looks for `entire` on `PATH`, then in the documented install locations such as `~/.local/bin`. Relative `PATH` entries are ignored, because a later call runs with the workspace as its working directory and a relative entry could resolve to a different program.

`entirely.cliPath` overrides discovery. It is machine-scoped, so a workspace can't set it. See [Installation](/entirely/getting-started/installation/).

Every code path that touches the CLI handles three outcomes: absent, found but unusable, and usable. The first two produce a plain message, not a stack trace.

## Reading JSON

For reads, Entirely calls CLI commands that print JSON (`status --json`, `session list --json`, `checkpoint list --json`, `why --json`, `auth status --json`, and so on) and decodes the result. A field it can't read is reported as unreadable. It is never shown as zero or as "nothing there". For example, a token row says **Not reported**, **Not recognised** or **Not available**, not `0`.

A few commands have only a human-readable form. Activity and recap run with `ACCESSIBLE=1`, which makes the CLI print static text instead of its interactive terminal interface, and Entirely parses that text. If the layout isn't one it knows, the view says it is unreadable.

[CLI commands used](/entirely/reference/cli-commands-used/) lists every invocation. [Coverage](/entirely/reference/coverage/) maps them to Entire's documented commands.

## Flags come from the CLI

Entirely doesn't keep a list of flags. For commands where flags matter (trail merges, session lifecycle, control-plane changes, search, import, sign-in) it reads `entire agent-help <command>`, or `--help` for experimental commands, and picks the flag by what the help says it does. If the CLI doesn't describe a flag the extension needs, the action is reported as unavailable and nothing runs. If it offers a preview flag, such as a dry run, the extension uses it for the confirmation. If it doesn't, the extension won't run that action. A failed help lookup is never cached.

## Confirmations and read-back

Anything that changes Entire, your repository or your settings asks first. The dialog names the target and, where it matters, the login the command will run as. Declining changes nothing.

After a change, Entirely reads the state again and reports success only if the CLI now shows the new state. For example, a repository change is "done" only when the listing reflects it, and an agent install is confirmed by reading `agent list` again. Exit code zero isn't treated as proof by itself.

See [Control plane](/entirely/guides/control-plane/) and [Trails and review](/entirely/guides/trails-and-review/) for the confirmations in each area.

## When it reads

| Surface | When it reads |
|---|---|
| Status bar, Sessions, Checkpoints | On `entirely.refreshInterval` (default 30 seconds, `0` for manual only), on the refresh button, and when the repository's `HEAD` changes |
| Activity, Search, Control Plane, Integrations, Account | When opened, on their refresh button, and after a change. They never poll |
| Transcripts, blame, why, dispatch, recap | Only when you ask |

No CLI call blocks the extension host. Each call is asynchronous and has a timeout setting (`entirely.transcriptTimeout`, `entirely.trailActionTimeout`, `entirely.controlPlaneTimeout`, and others, listed in [Settings](/entirely/reference/settings/)).

## The hook bridge

Agents record their own activity through hooks the CLI installs. The editor's built-in agent works differently, so Entirely forwards its events (session start, prompt submitted, stop, tool use, sub-agents, errors) to the CLI as `entire hooks <agent> <verb>`.

The editor's events use the Copilot CLI payload layout, so only the `copilot-cli` integration can receive them. `entirely.editorHookAgent` defaults to `copilot-cli`. Any other value is reported in the output channel and not forwarded. Every other installed agent is shown as "not bridged" and sent nothing. See [Agent integrations](/entirely/guides/agent-integrations/).

## Models

No model name, provider or context-window size is built in. A model is an opaque string, shown as the transcript reports it. A hosted, bring-your-own-key or local model behaves the same.

## Related

- [Privacy and redaction](/entirely/concepts/privacy-and-redaction/)
- [Accounts and contexts](/entirely/concepts/accounts-and-contexts/)
- [Remote windows](/entirely/concepts/remote-windows/)
