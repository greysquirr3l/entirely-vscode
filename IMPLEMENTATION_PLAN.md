# entirely — Implementation Plan

## Overview

Entirely is a Visual Studio Code extension for Entire, a Git forge built for
agent-human collaboration.

Entire's CLI records each coding-agent session, freezes it into a checkpoint,
and publishes the history so a team can see what every agent did and why. The
CLI is a terminal tool; everything it exposes is invisible from the editor.
Entirely surfaces it: a status bar that always knows whether the current
workspace is tracking, a tree of live sessions, checkpoint history that opens
straight into the diff, the ability to start a tracked agent turn from the
editor, and an inline blame-style "why does this line exist" query.

The extension never re-implements Entire. It discovers the installed CLI,
reads its JSON output, and shells out for anything mutating. If the CLI is
missing, the extension degrades to a clear, actionable message rather than
failing obscurely.


**Architecture**: layered
**Language**: typescript

---

## Phases


### Phase 1 — Foundations

1. **T01 — Extension manifest, build pipeline, and repository hygiene**
   Turn the generated scaffold into the manifest, build, lint and test setup the real extension will live in, with the contributed surface declared but not yet implemented.
2. **T02 — Entire CLI process runner with discovery**
   Implement the one place that knows how to find, run and parse the Entire CLI, so that nothing else in the extension touches the process boundary. It owns every failure path: a missing binary, a broken binary, a timeout and a malformed response are all typed outcomes, never thrown errors.
   _Depends on: project-scaffold_


### Phase 2 — Data Model

1. **T03 — Entire data types and the JSON decode layer**
   Model the Entire CLI's JSON output as precise TypeScript types, with decoding that tolerates the nulls and shape variations the CLI actually emits.
   _Depends on: cli-process_


### Phase 3 — Editor Surface

1. **T04 — Status bar item showing tracking state**
   Give the user an always-visible, always-accurate answer to 'is this workspace tracked by Entire, and is an agent running right now?'.
   _Depends on: domain-types_
2. **T05 — Tree view of tracked sessions**
   Show every session Entire tracks for the repository - across all worktrees, not just the open folder - and let the user inspect one.
   _Depends on: domain-types_
3. **T06 — Checkpoint list and diff viewer**
   Make recorded checkpoints browsable from the editor and openable in the native diff editor.
   _Depends on: domain-types_


### Phase 4 — Agent Integration

1. **T07 — Copilot CLI hook bridge**
   Report the extension's own agent activity to Entire using the same hook protocol the CLI installs for Copilot CLI, so editor work lands in the same session history.
   _Depends on: domain-types_
2. **T08 — Why does this line exist**
   Answer the question a reviewer actually asks - who changed this line, and why - without leaving the editor.
   _Depends on: domain-types_


### Phase 5 — Polish and Release

1. **T09 — Configuration surface and settings-driven behaviour**
   Expose the behaviour a user may reasonably want to change as VS Code settings, and make the extension read Entire's own layered configuration where it matters.
   _Depends on: status-bar, session-tree_
2. **T10 — Output channel, diagnostics and the doctor command**
   Make the extension debuggable: one output channel for everything it does, and a doctor command that answers 'why is this not working?'.
   _Depends on: cli-process, status-bar_
3. **T11 — Marketplace packaging, CI and release workflow**
   Make the extension installable, publishable and continuously verified - the difference between a project and a top-tier extension.
   _Depends on: settings-and-config, output-and-diagnostics_


### Phase 6 — Hardening

1. **T12 — Security and privacy review of the extension**
   Audit the extension for the ways it can leak data, run something it should not, or degrade a user's machine — and fix what the audit finds.
   _Depends on: hook-bridge, settings-and-config_
2. **T13 — End-to-end wiring audit**
   Prove that every command, provider, setting and disposable the manifest advertises is actually connected — and that the extension works as a whole, not just as parts.
   _Depends on: security-hardening, packaging-and-release_
3. **T14 — Remove scaffold leftovers and placeholder code**
   Delete everything the generator left behind — the hello-world command, the sample test, the template description — so nothing in the published extension is scaffolding.
   _Depends on: integration-wiring_


---


## Capabilities

The project must satisfy these behavioural contracts. Each capability has its own
file under `capabilities/`; task files that declare `implements = [...]` referencing the capability slug link
to the relevant capability and inline its scenarios.


### Entire CLI Discovery

- **File**: [`capabilities/cli-discovery.md`](capabilities/cli-discovery.md)
- **Capability slug**: `cli-discovery`
- **Requirements**: 3
- **Scenarios**: 3


Locates the installed Entire CLI, verifies it can run, and reports its version - without ever blocking or crashing when it is absent.

### Workspace Tracking Status

- **File**: [`capabilities/workspace-tracking-status.md`](capabilities/workspace-tracking-status.md)
- **Capability slug**: `workspace-tracking-status`
- **Requirements**: 3
- **Scenarios**: 3


Knows, at all times, whether the current workspace is tracked by Entire, which agents are integrated, and which session is live.

### Session Explorer

- **File**: [`capabilities/session-tree.md`](capabilities/session-tree.md)
- **Capability slug**: `session-tree`
- **Requirements**: 3
- **Scenarios**: 3


Shows every session Entire tracks for the current repository, live and finished, and opens a session's detail on demand.

### Checkpoint History

- **File**: [`capabilities/checkpoint-history.md`](capabilities/checkpoint-history.md)
- **Capability slug**: `checkpoint-history`
- **Requirements**: 3
- **Scenarios**: 3


Lists the checkpoints recorded on the current branch and opens any checkpoint in the diff editor.

### Bring Your Own Key Model Support

- **File**: [`capabilities/byok-model-support.md`](capabilities/byok-model-support.md)
- **Capability slug**: `byok-model-support`
- **Requirements**: 7
- **Scenarios**: 4


Works with whatever model the user has selected in Copilot Chat, including BYOK models from any provider - without the extension knowing or caring which model it is.

### Agent Hook Bridge

- **File**: [`capabilities/agent-hooks.md`](capabilities/agent-hooks.md)
- **Capability slug**: `agent-hooks`
- **Requirements**: 4
- **Scenarios**: 3


Reports editor-side agent activity to Entire so the editor's own work is captured in the same session history as the CLI's.

### Why Does This Line Exist

- **File**: [`capabilities/why-this-line.md`](capabilities/why-this-line.md)
- **Capability slug**: `why-this-line`
- **Requirements**: 2
- **Scenarios**: 2


Answers, for the cursor's line, which agent edit introduced it and why.


---

## Preflight Commands

```bash
npm run compile
npm test
npm run lint
```

---

_Generated by [wiggum](https://github.com/greysquirr3l/wiggum)._
