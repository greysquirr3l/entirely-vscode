---
title: Development
description: Clone, build and run Entirely in an Extension Development Host, and the rules the code follows.
sidebar:
  order: 1
---

Entirely is a TypeScript VS Code extension in [greysquirr3l/entirely-vscode](https://github.com/greysquirr3l/entirely-vscode). It targets VS Code 1.140 or newer and is tested with Entire CLI 0.12.2.

## Set up

You need Node 24 (CI uses it) and, to run the extension against real data, the [Entire CLI](https://docs.entire.com/installation).

```sh
git clone https://github.com/greysquirr3l/entirely-vscode.git
cd entirely-vscode
npm ci
npm run compile     # type check, lint, then bundle with esbuild
```

`npm run compile` runs `tsc --noEmit`, then `eslint src`, then `node esbuild.js`. A type error or lint warning fails the step, so a change that does not compile cannot be packaged.

## Run the extension

Open the folder in VS Code and press **F5** (the "Run Extension" launch configuration). It runs the default build task, which watches `tsc` and `esbuild`, then opens an Extension Development Host with the extension loaded. Open a folder that uses Entire in that window to see the views fill. Without the CLI the extension shows how to install it and does nothing else.

Useful commands:

| Command | What it does |
| --- | --- |
| `npm run watch` | Rebuild on change (`tsc` and `esbuild` in parallel). |
| `npm test` | Compile the tests, compile, lint, then run the suite in an extension host. See [Testing](/entirely/contributing/testing/). |
| `npm run lint` | `eslint src`. |
| `npm run package` | A production build. |
| `npm run package:check` | Checks the VSIX file list. See [Testing](/entirely/contributing/testing/). |

## Project layout

```text
src/
  extension.ts        Activation: builds the services, registers everything
  commands/           Command handlers and their editor prompts
  providers/          Tree views, decorations, panels, content providers
  services/           Use cases: status, sessions, trails, control plane
    cli/              The runner, locator, exec, flag discovery
  lib/                Plain TypeScript: decoders, flag builders, types
    entire/
  test/               Mocha tests; test/support holds the fake CLIs
site/                 This documentation site (separate project)
docs/                 coverage.md, icon-font.md and notes
```

## Rules the code follows

These come from `AGENTS.md` in the repository.

- **Layers.** Presentation depends on application, application on domain, domain on infrastructure. Domain types must not reference application or infrastructure types. Layers talk through plain DTOs. See [Architecture](/entirely/contributing/architecture/).
- **`vscode` imports.** `src/lib/` imports nothing from `vscode`, so it is unit-testable without an extension host. The `vscode` module may be imported only from `src/extension.ts`, `src/commands/`, `src/providers/` and `src/services/`.
- **Disposables.** Every command, provider, watcher and listener is pushed onto `context.subscriptions`. A leaked listener is the most common extension bug.
- **Strict types.** TypeScript strict mode stays on. No `any` to silence an error: model the shape. No non-null assertions on values the CLI could omit. No floating promises.
- **The CLI is the source of truth.** Never hardcode a flag list. Read `entire agent-help <command>` at run time. Every path that touches the CLI handles an absent, old or broken CLI explicitly.
- **Do not block the host.** No `entire` call may block the extension host for more than a second without yielding. Every call has a timeout, and the timeouts are settings.
- **Settings over constants.** Anything a user may reasonably want to change gets a `contributes.configuration` entry with a sensible default.
- **No model names.** Never hardcode a model name, model id, provider name or context-window size. Treat every model as an opaque string, since the user may be on a BYOK or local model.
- **Logging.** Never log a full checkpoint payload or a prompt body to the output channel by default. Offer it behind an explicit command. See [Privacy and redaction](/entirely/concepts/privacy-and-redaction/).
- **Tests.** Every new public function needs at least one test. Run `npm test` before committing and fix every failure.
- **Commits.** Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`. Describe user impact, not file or line counts.

## This documentation site

The site lives in `site/`. It is Astro and Starlight with its own `package.json` and `pnpm-lock.yaml`, and it is excluded from the VSIX and from the extension's TypeScript and lint runs.

```sh
cd site
pnpm install
pnpm dev        # local server, base path /entirely
pnpm check      # astro check
pnpm build
```

It needs Node 22.23.4 or newer. pnpm is pinned in `packageManager`. Pages are in `site/src/content/docs/`. Each sidebar section autogenerates from its directory and is ordered by `sidebar.order`, so a new page needs no config change. Because the site is served under `/entirely`, write Markdown links with that prefix, for example `/entirely/guides/search/`. For deployment see [Release](/entirely/contributing/release/#the-documentation-site).
