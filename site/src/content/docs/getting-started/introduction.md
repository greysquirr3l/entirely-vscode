---
title: Introduction
description: What Entirely is, what it shows, and what it needs.
sidebar:
  order: 1
---

Entirely is a Visual Studio Code extension for [Entire](https://entire.com), a Git forge built for agent-human collaboration.

:::caution[Unofficial]
Entirely is a community extension. It is not affiliated with, endorsed by, or supported by Entire. "Entire" and its logo belong to their owners and are used here only to say what the extension works with.
:::

## What Entire does

Entire's command-line tool, the `entire` CLI, records each coding-agent session. It freezes the work into a **checkpoint** and publishes that history, so a team can see what every agent did and why. Work is reviewed on **trails**.

The CLI is a terminal tool. Everything it knows is invisible from the editor unless you go and ask.

## What Entirely adds

Entirely puts that history in the editor:

- A **status bar** item that says whether the current workspace is tracked and whether an agent session is live.
- A **Sessions** view, and a **Session** view with the details and transcript of the one you select.
- **Checkpoint history** that opens straight into the diff editor.
- **Why Does This Line Exist?** and file blame, which name the agent edit behind a line.
- **Trail review**: approve, comment, merge, check out, link and unlink.
- Views for **Activity**, **Search**, the **Control Plane**, **Integrations** and your **Account**.
- An MCP server entry, plugin commands and agent-integration setup.

See [Views](/entirely/reference/views/) and [Commands](/entirely/reference/commands/) for the full list.

## What it never does

Entirely does not re-implement Entire. It finds the installed CLI, reads the JSON the CLI prints, and runs the CLI for anything that changes state. It doesn't keep its own copy of the history, and it doesn't hold your credentials.

Three consequences follow:

- If the CLI is missing, the extension says so and links to the install instructions. It doesn't fail obscurely.
- Changes to shared state or your working tree (merges, checkouts, deletes, installs, sign-out) ask first and say what they will touch. Approving and commenting on a trail run right after you pick or type.
- Flags come from the CLI's own `entire agent-help` text at runtime, not from a list inside the extension.

[How Entirely works](/entirely/concepts/how-entirely-works/) covers this in more detail.

## Who it's for

- Developers who run coding agents in a repository that uses Entire and want the history next to the code.
- Reviewers who approve and merge trails and want the diff and the session in one window.
- Teams with more than one Entire login, remote development hosts, or bring-your-own-key models. The extension treats every model as an opaque string.

## Status

Version 0.2.0. Before 1.0, minor versions may change commands and setting names. [Coverage](/entirely/reference/coverage/) lists, command by command, what the extension supports, what it leaves out on purpose, and what is still a gap.

## Next

1. [Install the CLI and the extension](/entirely/getting-started/installation/).
2. [Follow the quickstart](/entirely/getting-started/quickstart/).
3. [Sign in](/entirely/getting-started/sign-in/) to see trails, search and activity.
