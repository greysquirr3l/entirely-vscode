# RUN_LOG

Per-iteration audit log for the orchestrator loop. The orchestrator (or a human) appends one row per dispatch. Rows must remain in chronological order — never edit or delete an existing row.

## How to use

After each orchestrator dispatch — successful or not — append a row to the table below. Capture enough detail that the loop can be replayed from this file alone.

- `timestamp` — UTC ISO-8601 (`YYYY-MM-DDTHH:MM:SSZ`).
- `task_id` — `T{NN}-{slug}` from `tasks/`. Use `T00-bootstrap` for the initial setup dispatch.
- `attempt` — attempt count for this task within the current orchestrator run (1-indexed).
- `preflight_result` — `pass` / `fail:{reason}` / `skip`.
- `commit_sha` — short SHA of the commit produced by this iteration, or `-` if no commit.
- `duration_seconds` — wall-clock time spent in the subagent dispatch.
- `notes` — anything else worth recording (retries, gate decisions, eval verdicts).

## Iterations

| timestamp | task_id | attempt | preflight_result | commit_sha | duration_seconds | notes |
|-----------|---------|---------|------------------|------------|------------------|-------|
| YYYY-MM-DDTHH:MM:SSZ | T00-bootstrap | 1 | skip | - | 0 | Initial scaffold; no subagent dispatch. |

