---
title: Security
description: How to report a vulnerability, what is in scope, and what the extension does to protect you.
sidebar:
  order: 5
---

The full policy is [SECURITY.md](https://github.com/greysquirr3l/entirely-vscode/blob/main/SECURITY.md) in the repository. This page summarises it. If the two differ, SECURITY.md wins.

## Supported versions

Entirely is pre-1.0. Only the latest release gets security fixes. At the time of writing that is 0.2.x.

## Reporting a vulnerability

Report privately. Do not open a public issue, pull request or discussion for it.

GitHub's private vulnerability reporting is not enabled on the repository yet, so the Security tab has no report form. SECURITY.md gives the email address to use and the subject line to put on it. If you cannot email, open a public issue that says only that you have a security report and how to reach you, and leave out the details.

A report helps most with the extension and VS Code versions, the steps to reproduce, what you expected and what happened, and any proof-of-concept output. Do not include anything that could harm someone else's machine.

## What to expect

The aim is to acknowledge within three working days and to ship a fix or a mitigation within 30 days. A fix that depends on a dependency can take longer, and the reply will say so. Reporters are credited in the release notes unless they ask not to be. Details stay private until a fix has shipped.

## Scope

In scope: the Entirely extension in this repository.

Out of scope: the Entire CLI and the Entire forge. Report those to Entire under its own policy. If you are unsure where a problem lives, report it to Entirely and it will be routed.

## What the extension does to protect you

- **No secrets.** Tokens stay in the Entire CLI's credential store. The extension never reads that store.
- **Ask first.** Anything that changes Entire or your repository asks before it runs and says what it will touch. See [Commands](/entirely/reference/commands/).
- **Quiet logs.** Transcripts, prompt bodies, checkpoint payloads and search queries stay out of the output channel. Sensitive operands are redacted from logged command lines. See [Privacy and redaction](/entirely/concepts/privacy-and-redaction/).
- **MCP configuration** is written only inside the workspace, only after you agree, and never contains a credential or a path to your CLI. See [Integrations and MCP](/entirely/guides/integrations-and-mcp/).
- **Browser links** open only Entire addresses.
- **Workspace trust.** `entirely.cliPath` and `entirely.cliContext` can be set in user or remote-machine settings, never workspace settings, so a cloned repository cannot point the extension at a different binary or login. See [Settings](/entirely/reference/settings/).
