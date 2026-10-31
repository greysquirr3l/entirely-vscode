---
title: Privacy and redaction
description: What the extension logs, shows and keeps.
sidebar:
  order: 2
---

Entirely records every CLI call so you can debug problems. It is careful about what goes in that record.

## The output channel

Everything goes to one channel, **Entire**. Each call is logged with its command line, working directory and exit code, plus byte counts for stdout, stderr and stdin.

The channel never holds:

- prompt bodies or transcripts;
- checkpoint payloads;
- search queries or search results;
- the question or path of an experts lookup, the one-off instructions of a review, saved review findings, and the hook and MCP commands a review would load;
- API responses from **Entirely: Call the Entire API**;
- the words you type for a plugin command.

This holds at every log level, including `debug` and `trace`. Turning on `entirely.debug` or raising `entirely.logLevel` (default `info`; `error`, `warn`, `info`, `debug`, `trace`) adds the command line and a short excerpt of output. It doesn't add content that was withheld.

## Withheld output

Commands that carry conversation text are run so that their output can't reach the log record at all, not even through the debug excerpt. Opening a transcript is the explicit route: it goes to a read-only editor, not to the channel.

## Redaction

Some operands are sensitive even though the command isn't, such as a search term, a comment on a trail, or a plugin's arguments. The logged command line replaces them with `<redacted>`. The command itself still receives the real value.

```
[info] entire: /usr/local/bin/entire investigate <redacted>
```

## Explicit "show output" commands

When you do want the content, ask for it:

| Command | Shows |
|---|---|
| **Entirely: Doctor: Show the Last Entire CLI Output** | The output of the most recent CLI call |
| **Entirely: Doctor: Show the CLI's Full Diagnostic Output** | The full text of `entire doctor` |
| **Entirely: Open Session Transcript** | The transcript of the selected session, read-only |

Outputs withheld from the record can't be shown by the last-output command. Use the dedicated route (the transcript, for example).

The diagnostic report (**Entirely: Doctor: Copy a Diagnostic Report**) contains the CLI's path and version, repository state, effective settings and the last error. It doesn't contain prompts or payloads, and from the CLI's doctor output it includes only each finding's headline, reason and fix.

## Credentials

Tokens stay in the CLI's credential store (keychain, secret service, or a file-backed fallback). Entirely never reads the store and never asks the CLI for a credential. It stores no secrets.

## MCP configuration

When you add the Entire MCP server to a project's `.mcp.json`, the entry is `command: "entire"` plus the CLI's own `mcp` arguments. It contains no credential, no absolute path to your CLI, and no login name, because the file is usually committed. It is written only after a dialog names the file. Files with comments or other non-JSON content are never rewritten; you are shown what to add instead. See [Integrations and MCP](/entirely/guides/integrations-and-mcp/).

## Browser links

Entirely opens only `https` addresses on Entire domains in your browser. Anything else stays in the sign-in panel as text.

## Settings that can't come from a workspace

`entirely.cliPath` and `entirely.cliContext` can only be set in user or remote-machine settings. A repository you clone can't change which binary or login the extension uses. See [Accounts and contexts](/entirely/concepts/accounts-and-contexts/).

## Reporting a problem

Read [SECURITY.md](https://github.com/greysquirr3l/entirely-vscode/blob/main/SECURITY.md) to report a vulnerability. For ordinary bugs, paste the diagnostic report. See [Doctor and diagnostics](/entirely/guides/doctor-and-diagnostics/).
