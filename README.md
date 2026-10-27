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

## What it will do

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

**Under construction.** The extension is being built in the open, in small
reviewable pieces, and is not yet published to the Marketplace.

Done so far: the manifest and marketplace metadata, the build and test
pipeline, and the contributed surface — an Entirely view container with a
sessions tree, a status bar item, and the `entirely.*` settings. The
extension compiles, lints and passes its extension-host tests.

Not yet done: the parts that talk to the CLI. Until those land, the status
bar reports that the workspace state is unknown and the sessions tree is
empty. Nothing here is released, so treat the command list and setting
names as provisional.

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

## Requirements

* The [Entire CLI](https://docs.entire.com/installation) — `entire version`
  must run. Without it the extension stays dormant.
* VS Code 1.140 or newer.

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

## Licence

MIT

## Issues

Found something broken, or want to see something built? The repository and
issue tracker live at
[greysquirr3l/entirely-vscode](https://github.com/greysquirr3l/entirely-vscode).
