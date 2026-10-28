# Entirely

<img src="images/hero.png" alt="Entirely" width="128">

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/greysquirr3l/entirely-vscode/badge)](https://scorecard.dev/viewer/?uri=github.com/greysquirr3l/entirely-vscode)

A Visual Studio Code extension for [Entire](https://entire.com) — the Git
forge built for agent-human collaboration.

Entire records what coding agents did as **sessions**, freezes them into
**checkpoints**, and publishes that history so a team can see what every
agent did and why. The CLI does the work. Entirely is the editor-side
surface for it.

```
Entirely (this extension)
   └── entire CLI  (the source of truth — never re-implemented here)
         └── git refs, session state, the Entire API
```

## What it does

| Surface | What it shows |
|---|---|
| **Status bar** | Whether the workspace is tracked by Entire, and whether an agent session is live right now |
| **Entire view** | Every session Entire tracks for the repository — across all worktrees, not just the open folder |
| **Checkpoint history** | Recorded checkpoints, opening straight into the native diff editor |
| **Why this line** | Which agent edit introduced the line under the cursor, and why |
| **Hook bridge** | Reports the editor's own agent activity to Entire, so editor work lands in the same session history |
| **Terminal PATH repair** | Puts the Entire CLI on the integrated terminal's PATH, through the editor's own settings — no shell profile, no shell command |
| **BYOK models** | Works with whatever model Copilot Chat is using — hosted, BYOK, or local — without the extension knowing the model exists |
| **Doctor** | A copyable diagnostic report: CLI version, repository state, effective settings, last error |

The extension never re-implements Entire. It discovers the installed CLI,
reads its JSON output, and shells out for anything mutating. If the CLI is
missing, the extension degrades quietly rather than failing obscurely.

**Model-agnostic by construction.** No model name, provider or context-window
size is hardcoded anywhere. The model is an opaque string, recorded exactly
as the Copilot transcript reports it — so a BYOK model from any provider and
a local Ollama model work the same as a hosted one, and a model the
extension has never seen is not a special case.

## Status

**Version 0.1.0.** The extension talks to the Entire CLI and shows what it
knows: which repository is tracked, which agents are running, what each
session did, and why a line of code is the way it is. It compiles, lints and
passes its extension-host tests.

The command list and the setting names are still provisional. They are the
surface a user actually touches, so they are the most likely thing to change
in a later version.

## Screenshots

The sessions Entire tracks for the repository, with the details of the
selected one beside them:

![The Entirely view, showing the sessions Entire tracks and the details of the selected session](images/sessions.png)

Every CLI invocation the extension made, in the `Entire` output channel:

![The Entire output channel, showing each CLI invocation and what it returned](images/output.png)

## The terminal PATH

The Entire CLI installs to `~/.local/bin`, which the integrated terminal
does not inherit. The extension itself is unaffected — it runs the CLI by
absolute path — but a terminal you open in the editor cannot run `entire`.

Entirely offers to fix that: **Entirely: Add the Entire CLI to the Terminal
PATH**. The repair is the editor's own terminal environment, so the only
thing that changes is a setting the editor already owns. No shell profile is
read or written, and no shell command is run.

You choose the scope, and each one says what it costs before you pick it:

| Scope | What it touches |
|---|---|
| This workspace folder | That folder's own settings file |
| This workspace | The workspace settings file — which may be committed |
| Your user settings | Every window you open; nothing in a repository changes |

The value written is `${env:PATH}` with the CLI's directory on the end. The
inherited PATH is a *reference*, not a copy, so the terminal takes the live
PATH rather than a snapshot of it taken when the setting was written.

Running the command again takes the directory off again.

## When something is not working

Everything the extension does goes to one output channel, named **Entire**.
Every call to the CLI is written there with the exact command line, the
directory it ran in, and the exit code — enough to reproduce a problem by
hand.

```
[info] entire: /usr/local/bin/entire status --json
[info]   cwd: /work/entirely
[info]   exit: 0 (ok, 14ms); stdout 1.2 kB, stderr 0 B, stdin 0 B
```

Prompt bodies and checkpoint payloads are **not** written there. The channel
says how many bytes there were, and the content itself is behind
**Entirely: Doctor: Show the Last Entire CLI Output**, for the times when
you really do want to read it.

**Entirely: Doctor: Copy a Diagnostic Report** answers "why is this not
working?". It reports the CLI's path, version and location; whether the
workspace is a git repository and whether Entire is enabled for it; the
settings in effect; and the last error the CLI gave. The report is one
block of text and one action to copy it, because it is usually on its way
into an issue.

Turn the volume up with `entirely.debug`, or with `entirely.logLevel` for
finer control. There is still only one channel.

## Requirements

* The [Entire CLI](https://docs.entire.com/installation) — `entire version`
  must run. Without it the extension stays dormant.
* VS Code 1.140 or newer.

## Maintaining

Opening a pull request here has two rules that are not obvious, and both
cost a day the first time they were met:

1. **Open the pull request as the author of the commits.** The `main`
   ruleset asks for an approval from an account that is neither the pull
   request's author nor the commit's author when the two differ, and a
   pull request's author cannot approve their own pull request.
2. **Expect the Entire gate to end `neutral`,** which GitHub treats as
   passing. `failure` blocks the merge.

The reasoning, the timeline and everything else that was learned the hard
way is in
[docs/post-mortem-entire-gates.md](docs/post-mortem-entire-gates.md).

## Development

```sh
npm install
npm run compile     # type check, lint, bundle
npm test            # extension-host tests
npm run watch       # rebuild on change
```

### Tests

The extension-host tests live in `src/test/` and run inside a real VS Code
extension host. The runner is [`@vscode/test-cli`](https://github.com/microsoft/vscode-test-cli),
configured by `.vscode-test.mjs`:

```sh
npm run compile-tests   # compile the tests to out/
npm test                # run them in a headless extension host
```

Install the
[VS Code Extension Test Runner](https://marketplace.visualstudio.com/items?itemName=ms-vscode.extension-test-runner)
to run the same suite from inside the editor. It reads the same
`.vscode-test.mjs`, discovers the compiled test files under `out/test/`, and
runs them in a debuggable Extension Development Host — so failures land in the
Testing view with source-mapped stack traces instead of in a terminal.

The runner executes the compiled JavaScript, not the TypeScript sources, so
compile the tests first — `npm run compile-tests`, or keep `npm run watch-tests`
running in the background.

No extra configuration is needed: `sourceMap` is on in `tsconfig.json` and
`.vscodeignore` excludes `**/*.map`, so stack traces point back at the
original TypeScript. On a remote without a display, set
`extension-test-runner.wrapper` to `xvfb-run`.

### Releasing

A release is a tag. Push `v0.1.0` and the `Release` workflow builds the
package, checks what is in it, publishes it to the Visual Studio Marketplace
and to Open VSX, and then makes a GitHub release with the `.vsix` attached.
A tag whose version does not match `package.json` stops the build rather
than publishing the wrong version.

Two repository secrets are needed:

| Secret | What it is |
|---|---|
| `VSCE_PAT` | A personal access token for the Marketplace publisher |
| `OVSX_PAT` | A personal access token for the Open VSX namespace |

The workflow can also be run by hand from the Actions tab. Leave the version
empty to build the version in the manifest, and leave **Publish** off to
build and check the package without publishing it — a dry run.

The `marketplace` and `openvsx` jobs use GitHub environments, so either
one can be made to wait for a review before it publishes.

## Licence

MIT

## Issues

Found something broken, or want to see something built? The repository and
issue tracker live at
[greysquirr3l/entirely-vscode](https://github.com/greysquirr3l/entirely-vscode).
