# entirely — Implementation Progress

> Orchestrator reads this file at the start of each loop iteration.
> Subagents update this file after completing a task.

## Status Legend

- `[ ]` — Not started
- `[~]` — In progress (claimed by a subagent)
- `[x]` — Completed
- `[!]` — Blocked / needs human input

---


## Phase 1 — Foundations


| Task | Status | Notes |
|---|---|---|
| T01 — Extension manifest, build pipeline, and repository hygiene | `[ ]` | |
| T02 — Entire CLI process runner with discovery | `[ ]` | |

---


## Phase 2 — Data Model

> Depends on: Phase 1 all complete


| Task | Status | Notes |
|---|---|---|
| T03 — Entire data types and the JSON decode layer | `[ ]` | |

---


## Phase 3 — Editor Surface

> Depends on: Phase 2 all complete


| Task | Status | Notes |
|---|---|---|
| T04 — Status bar item showing tracking state | `[ ]` | |
| T05 — Tree view of tracked sessions | `[ ]` | |
| T06 — Checkpoint list and diff viewer | `[ ]` | |

---


## Phase 4 — Agent Integration

> Depends on: Phase 3 all complete


| Task | Status | Notes |
|---|---|---|
| T07 — Copilot CLI hook bridge | `[ ]` | |
| T08 — Why does this line exist | `[ ]` | |

---


## Phase 5 — Polish and Release

> Depends on: Phase 4 all complete


| Task | Status | Notes |
|---|---|---|
| T09 — Configuration surface and settings-driven behaviour | `[ ]` | |
| T10 — Output channel, diagnostics and the doctor command | `[ ]` | |
| T11 — Marketplace packaging, CI and release workflow | `[ ]` | |

---


## Phase 6 — Hardening

> Depends on: Phase 5 all complete


| Task | Status | Notes |
|---|---|---|
| T12 — Security and privacy review of the extension | `[ ]` | |
| T13 — End-to-end wiring audit | `[ ]` | |
| T14 — Remove scaffold leftovers and placeholder code | `[ ]` | |

---


## Accumulated Learnings

> Subagents append discoveries here after each task.
> The orchestrator reads this section at the start of every iteration
> to avoid repeating past mistakes.

_No learnings yet._

## Codebase State

> Subagents update this section after completing each task.
> Describe what now exists, what is wired up, and what key decisions were made.
> A fresh agent should be able to orient from this section alone.

_No state summary yet._
