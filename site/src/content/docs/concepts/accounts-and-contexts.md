---
title: Accounts and contexts
description: Logins, jurisdictions and CLI contexts.
sidebar:
  order: 3
---

The Entire CLI can hold more than one login on a machine. It calls each saved login a **context**.

## How the CLI handles logins

- Contexts are saved in the CLI's configuration directory. Their tokens live in the operating system's credential store.
- One context is active at a time. A second login on the same host doesn't replace the first. It is added as `HANDLE@HOST`.
- `entire auth contexts` lists them. It's a local command and makes no network request, so Entirely reads it freely.
- `--context NAME` makes one command act as a login. The environment variable `ENTIRE_CONTEXT` does the same, and it is the only form that reaches plugin commands such as `entire investigate`.

A context name looks like `us.auth.entire.io`, or `alice@us.auth.entire.io` for a second identity on a host that already has one.

## Pinning a login: `entirely.cliContext`

| Setting | Default | Scope |
|---|---|---|
| `entirely.cliContext` | empty | machine |

Leave it empty and Entirely follows the login the CLI is using on its own. Set it to a name from `entire auth contexts` and Entirely acts as that login.

The pin applies to every CLI call as `--context <name>` and as `ENTIRE_CONTEXT` in the child's environment. The CLI's own active login, the one your terminal uses, isn't changed.

Like `entirely.cliPath`, this setting can be set only in user or remote-machine settings, never in workspace settings. A login decides what you can see and what you can change. If a repository could set it, opening a cloned project could make the extension act as a different account.

If the name doesn't match a saved login, the status bar shows `$(error)` and says so. Nothing runs as the wrong login.

## Seeing which login is acting

- The status bar tooltip names the login.
- The **Account** view shows the handle, the home jurisdiction (the region whose law governs the account) and the saved logins.
- The doctor report counts the saved logins and names the one in use.
- Every confirmation for a change to Entire (Control Plane changes, trail merges, dispatch, plugin installs) names the login it will run as. The change runs as exactly that login, even if the CLI's active login has moved since.

A workspace the acting login can't see is shown as `$(eye-closed)`, "invisible to that login", not as "not tracked".

## Plugins

Plugin commands get `ENTIRE_CONTEXT` in their environment, because the CLI's `--context` flag doesn't reach them. A pinned context is applied with both.

## Signing out

The CLI signs out of every saved context, not only the active one. Entirely warns about that before it runs. See [Sign in](/entirely/getting-started/sign-in/).

## Trails: project access versus repository access

A trail belongs to a **project**, not only to a repository. A login that can't see the project can't review its trails. In that case the Trails view says the project isn't visible to the acting login and names `entirely.cliContext`, instead of showing an empty list that looks like there is no work.

Who can see a project depends on where it came from:

- A project made in Entire is shared by granting people access. Each person sees it under their own login, so a reviewer approves under their own name.
- A project that mirrors a GitHub owner follows GitHub's membership. A collaborator on `owner/repo` can see the repository without being able to see the personal project that holds its trails.

For example, if `github:alice` owns the project and `github:bob` is a collaborator on the repository, `entire trail` commands run as Bob may not resolve Alice's project. The Entire web UI works for Bob, because it grants access from repository access. This is how the CLI and the forge behave. Entirely reports it as it is.

Granting Bob access through the Control Plane does not fix this. On a GitHub-mirrored project, `entire project grant add` fails with "Project access on a GitHub-mirrored project is a read-only projection of GitHub; grants are managed by the source". A personal GitHub account has no account-wide membership, so a repository collaborator can't be given project access that way. There are two workarounds:

- Review the trails in Entire's web UI, which works from repository access.
- Move the repository to a GitHub organisation that both `github:alice` and `github:bob` belong to. The project then follows organisation membership.

The exact rules are Entire's. If you hit this, run **Entirely: Doctor: Copy a Diagnostic Report** and check which login was acting.

See [Trails and review](/entirely/guides/trails-and-review/).
