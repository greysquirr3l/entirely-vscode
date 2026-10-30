---
title: Sign in
description: Sign the CLI in to Entire from the editor.
sidebar:
  order: 4
---

Some views need a signed-in CLI: Trails, Search, Activity, the Control Plane, and checkpoint search. Local sessions and checkpoints don't. Entirely signs the CLI in for you. It doesn't handle your credentials.

## Sign in

Run **Entirely: Sign In to Entire**, or use **Sign in to Entire** in the empty Account view.

How the sign-in happens depends on where the CLI runs.

| Where the editor runs | What happens |
|---|---|
| Local desktop window | You pick **Sign in with a browser** or **Sign in with a device code**. |
| Remote window (Remote-SSH, container, WSL, Codespaces) | The CLI can't open your browser, so Entirely uses a device code without asking. |
| Browser-based editor | Same: a device code. |
| Linux or another Unix with no `DISPLAY` or `WAYLAND_DISPLAY` | Same: a device code, to enter in a browser on another machine. |

The device code is offered only when the installed CLI has a `--device` flag. Otherwise Entirely uses the browser flow. It reads this from the CLI's help text.

### Device code

The CLI prints a code and an address, and the command waits until you approve it. Entirely shows the CLI's words in a panel while it waits, so the code is on screen when you need it.

In a remote or browser-based window, Entirely also opens the verification page in your own browser. It opens only an `https` address on an Entire domain (`entire.io` or `entire.com`, with no credentials in the URL). Anything else the CLI prints stays in the panel for you to read.

On a headless machine with no editor window on a desktop, open the address on any other device and enter the code there.

When the sign-in finishes, the panel says so and a notification reads "Signed in to Entire." If it fails, the notification carries the reason the CLI gave.

## The Account view

The **Account** view reads `entire auth status --json`. It shows:

- the handle the CLI is signed in as;
- the jurisdiction of the account, meaning the region whose law applies to it, which isn't always where you are;
- the saved logins, when there is more than one. See [Accounts and contexts](/entirely/concepts/accounts-and-contexts/).

When nobody is signed in, it says "Not signed in." When the CLI couldn't be asked, it says it doesn't know instead of claiming you're signed out.

## Sign out

Run **Entirely: Sign Out of Entire**. A dialog first says what it will do:

- Every login saved on this machine is signed out, not only the one in use.
- Every CLI session on the login server ends too, other machines included.

The CLI doesn't offer a narrower sign-out, and Entirely doesn't pretend it does. Nothing runs until you agree.

## Credentials

Tokens stay in the CLI's own credential store: the operating system keychain, or its file-backed fallback. The extension never reads that store and never asks the CLI for a credential. See [Privacy and redaction](/entirely/concepts/privacy-and-redaction/).

## Related

- [Remote windows](/entirely/concepts/remote-windows/)
- [Trails and review](/entirely/guides/trails-and-review/)
- [Doctor and diagnostics](/entirely/guides/doctor-and-diagnostics/)
