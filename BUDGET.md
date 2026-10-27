# BUDGET — entirely

Token estimates for the generated scaffold. Use this file to budget per-iteration prompt sizes before running the orchestrator loop.

## Per-task context size

| # | Task | Tokens | Status |
|---|------|-------:|--------|
| T01 | project-scaffold | 429 | ok |
| T02 | cli-process | 489 | ok |
| T03 | domain-types | 767 | ok |
| T04 | status-bar | 386 | ok |
| T05 | session-tree | 363 | ok |
| T06 | checkpoint-history | 486 | ok |
| T07 | hook-bridge | 1496 | ok |
| T08 | why-this-line | 757 | ok |
| T09 | settings-and-config | 447 | ok |
| T10 | output-and-diagnostics | 409 | ok |
| T11 | packaging-and-release | 454 | ok |
| T12 | security-hardening | 549 | ok |
| T13 | integration-wiring | 496 | ok |
| T14 | stub-cleanup | 414 | ok |

## Summary

| Metric | Tokens |
|--------|-------:|
| Total task contexts | 7942 |
| Plan + progress + orchestrator base overhead | 1178 |
| **Total estimated tokens** | **9120** |
| Largest single task (hook-bridge) | 1496 |

## Thresholds

Tokens are measured against the cl100k_base-style heuristic used by `wiggum check`. Tasks above the WARN threshold risk losing detail to context window churn; tasks above CRITICAL will almost certainly truncate.

| Threshold | Tokens |
|-----------|-------:|
| WARN threshold | 80000 |
| CRITICAL threshold | 150000 |

## Recommended daily cap

**Recommended daily cap: 14960 tokens** (largest task × 10, so the loop can complete roughly 10 iterations before context churn forces a fresh subagent). Adjust downward if your orchestrator model has a smaller context window.

## Cost tiers

Per-iteration cost under three operating modes. Use this to plan session budgets before running the orchestrator.

| Mode | Tokens | % of total |
|------|-------:|-----------:|
| noop   | 500  | 5% |
| report | 3040 | 33% |
| action | 18240 | 200% |

Stable fraction between iterations: **0.4** (estimated reuse of PROGRESS.md + accumulated learnings; tune per model).

Suggested daily cap: **91200 tokens** (= action × 5). Treat as a single-developer upper bound for a dogfood session; reduce if running multiple plans in parallel.

