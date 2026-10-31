// Fixtures for the token profile, experts and review commands.
//
// The three help texts are what the real CLI (0.12.2) printed for `--help`.
// TOKEN_PROFILE_JSON and REVIEW_CONFIG_JSON are the JSON the real CLI printed
// for `tokens profile --json` and `review --show-config --json` against a
// repository with checkpoints, with the checkpoint ids, the head commit and the
// commands replaced and the lists shortened. Every other fixture in
// analysisCli.ts is invented, and says so.

export const TOKENS_PROFILE_HELP = `Aggregate token usage and recommendations across committed checkpoint history.

The profile reads committed checkpoint metadata only. It does not inspect
transcripts or source files, so it is deterministic and avoids adding token
cost while diagnosing token usage. By default it scans the latest 50 committed
checkpoints; use --limit or --all to change the scope.

Usage:
  entire tokens profile [flags]

Flags:
      --all         Analyze all committed checkpoints
  -h, --help        help for profile
      --json        Output as JSON
      --limit int   Maximum committed checkpoints to analyze (default 50)

Global Flags:
      --context name   Act as this saved login name for this command only — including the git and agent processes it spawns — instead of the active context (entire auth contexts lists them)
`;

export const EXPERTS_HELP = `Rank which agents, skills, and tools have provenance over a code scope — who
and what has touched the given code.

The argument is either a single scope (a file or directory path) or a
natural-language query. A scope or query is required unless --staged is set,
which uses the staged file paths as scopes instead. Results come from the
entire-api cell keyed on the repo, so the repo must be mirrored.

Usage:
  entire experts [scope-or-query] [flags]

Examples:
  entire experts src/payments --json
  entire experts "who owns token refresh" --json
  entire experts --staged

Flags:
      --branch string   Branch to inspect
  -h, --help            help for experts
      --json            Print JSON
      --limit int       Maximum profiles to return (1–20; values above 20 are clamped) (default 8)
      --repo string     Repository as owner/repo
      --staged          Use staged file paths as scopes
      --tui             Browse provenance in an interactive viewer (TTY only)

Global Flags:
      --context name   Act as this saved login name for this command only — including the git and agent processes it spawns — instead of the active context (entire auth contexts lists them)
`;

export const REVIEW_HELP = `Run a multi-agent review against the current branch or a --target branch:
several reviewer agents review the change in parallel, then a single judge consolidates their
reports into the final verdict in a closing round. Reviews are saved as named
profiles in Entire settings and clone-local preferences. On first run, guided
setup writes a profile and asks before starting agents.

Flags:
  --configure    set up a review profile (shows available agents + profiles).
                 With --set-* flags it writes the profile non-interactively;
                 otherwise it opens the wizard (interactive) without starting agents.
  --set-agents   with --configure: comma-separated reviewer agents for the profile
  --set-judge    with --configure: the consolidating judge as agent[=model]
  --set-output   with --configure: where the verdict goes: local (default) or trail
  --local        with --configure: save to .entire/settings.local.json (just you)
                 instead of .entire/settings.json (shared). Interactive setup asks.
  --set-task     with --configure: the profile's canonical task text
  --set-model    with --configure: per-reviewer model as agent=model (repeatable)
  --set-slot     with --configure: a reviewer slot as agent[=model] (repeatable;
                 the same agent/model may repeat to run it multiple times)
  --set-config   with --configure: a reviewer's own agent config as
                 reviewer=<config.json|isolated|none> (repeatable). It replaces
                 the reviewed checkout's hooks, MCP servers and extensions; the
                 checkout's skills still load. Saved to clone-local preferences.
  --edit         re-open the advanced profile skill picker
  --findings     browse local findings; pass a handle to print one saved run
  --agent NAME   run only one reviewer from the selected profile
  --list         list configured review profiles (their reviewers and judge)
  --agents       list the reviewer agents you can pass to --agent for the profile
  --model NAME   override the model for the --agent reviewer (requires --agent)
  --models       list the models each agent advertises (optionally --agent NAME)
  --profile NAME select a profile (also accepted as positional arg)
  --prompt TEXT  add one-off per-run instructions for this invocation
  --timeout DUR  optional hard cap on each reviewer before it's cancelled and
                 marked failed. No default — reviewers run until they finish,
                 like a directly-invoked skill. A positive value also bounds
                 the consolidating judge, which otherwise keeps its own 20m
                 default (the judge is never unbounded; its timeout or error
                 fails the review with no verdict). A timed-out reviewer's
                 siblings and the judge still proceed.
  --base REF     scope against REF instead of mainline. Useful for stacked
                 PRs where the base is the parent feature branch, not main.
                 Default: first existing of origin/HEAD, origin/main,
                 origin/master, main, master.
  --target REF   check out a branch identified by branch name, trail ID, or
                 Entire trail URL in a worktree and run the review there.
  --cleanup-worktree
                 remove a newly-created target worktree after a successful
                 review. Interactive runs ask when this flag is omitted.
  --show-config  list what the review would run (hooks, MCP servers, settings)
                 and exit without checking anything out. Add --json for
                 structured output.
  --trust-target SHA
                 approve reviewing code by someone else at this commit. Reviews
                 of commits you did not author need approval because the
                 reviewer loads the checkout's hooks, MCP servers, and settings.

To tag an already-finished session as a review, use
'entire session attach --review <id>'.

Usage:
  entire review [flags]

Flags:
      --agent string             run one configured reviewer from the selected profile
      --agents                   list the reviewer agents you can pass to --agent for the selected profile
      --base string              git ref to scope the review against (default: origin/HEAD → origin/main → origin/master → main → master)
      --cleanup-worktree         remove a newly-created target worktree after a successful review (interactive runs ask when omitted)
      --configure                set up a review profile; shows available agents and accepts --set-* flags for non-interactive config
      --edit                     re-open the advanced review profile skill picker
      --findings                 browse local review findings; pass a handle to print one saved run
  -h, --help                     help for review
      --json                     with --show-config: print JSON
      --list                     list configured review profiles (reviewers and judge)
      --local                    with --configure: save the profile to .entire/settings.local.json (per-developer) instead of .entire/settings.json
      --model string             override the model for the --agent reviewer (requires --agent)
      --models                   list the models each review agent advertises (optionally filtered by --agent)
      --profile string           review profile to run (default: review_default_profile or general)
      --prompt string            one-off instructions appended to this review run
      --set-agents strings       with --configure: reviewer agents for the profile (comma-separated)
      --set-config stringArray   with --configure: a reviewer's own agent config as reviewer=<config.json|isolated|none> (repeatable; saved to clone-local preferences)
      --set-judge string         with --configure: the consolidating judge as agent[=model]
      --set-model stringArray    with --configure: per-reviewer model as agent=model (repeatable)
      --set-output string        with --configure: where the verdict is delivered (local or trail)
      --set-slot stringArray     with --configure: a reviewer slot as agent[=model] (repeatable; same agent/model may repeat)
      --set-task string          with --configure: the profile's canonical task text
      --show-config              list what the review would run (hooks, MCP servers, settings) and exit without running it
      --target string            branch, trail ID, or Entire trail URL to check out in a worktree and review
      --timeout duration         optional hard cap per reviewer (default: none — reviewers run until they finish, like a skill invoked directly in a session). When set, it also bounds the consolidating judge; unset, the judge keeps its own 20m default
      --trust-target string      approve reviewing code by someone else at this commit SHA (the review loads the checkout's hooks, MCP servers, and settings)

Global Flags:
      --context name   Act as this saved login name for this command only — including the git and agent processes it spawns — instead of the active context (entire auth contexts lists them)
`;

/** The top-level help, which is what a CLI without the command prints. */
export const ROOT_USAGE = `The command-line interface for Entire

Usage:
  entire [flags]
  entire [command]
`;

export const TOKEN_PROFILE_JSON = `{
  "source": "committed_checkpoints",
  "usage_scope": "checkpoint_observed",
  "checkpoints_available": 69,
  "checkpoints_analyzed": 50,
  "checkpoints_with_token_data": 48,
  "missing_token_data": 2,
  "tokens": {
    "total": 372774662,
    "input": 910,
    "cache_read": 160535969,
    "cache_write": 2715373,
    "output": 310278,
    "api_calls": 627,
    "subagent_total": 209212132
  },
  "signals": [
    {
      "id": "context-replay-hotspot",
      "label": "Cache/context replay hotspot",
      "count": 35,
      "percent": 70,
      "checkpoint_ids": [
        "01HXA000000000000000000001",
        "01HXA000000000000000000002",
        "01HXA000000000000000000003"
      ]
    },
    {
      "id": "api-call-amplification",
      "label": "API call amplification",
      "count": 5,
      "percent": 10,
      "checkpoint_ids": [
        "01HXA000000000000000000001",
        "01HXA000000000000000000004",
        "01HXA000000000000000000005"
      ]
    },
    {
      "id": "subagent-heavy",
      "label": "Subagent-heavy sessions",
      "count": 41,
      "percent": 82,
      "checkpoint_ids": [
        "01HXA000000000000000000006",
        "01HXA000000000000000000001",
        "01HXA000000000000000000002"
      ]
    },
    {
      "id": "missing-token-data",
      "label": "Missing token data",
      "count": 2,
      "percent": 4,
      "checkpoint_ids": [
        "01HXA000000000000000000007",
        "01HXA000000000000000000008"
      ]
    }
  ],
  "recommendations": [
    {
      "id": "search-before-reinvestigation",
      "severity": "high",
      "message": "Use \`entire search\` for prior decisions/checkpoints before broad re-investigation.",
      "signals": [
        "cache_read_tokens",
        "api_call_count"
      ]
    },
    {
      "id": "batch-diagnostics",
      "severity": "medium",
      "message": "Batch diagnostic reads around one narrowed hypothesis when API call amplification repeats.",
      "signals": [
        "api_call_count"
      ]
    },
    {
      "id": "preserve-then-compact",
      "severity": "medium",
      "message": "Summarize useful findings before continuing large-context work; compact or restart only after preserving relevant context.",
      "signals": [
        "cache_read_tokens"
      ]
    },
    {
      "id": "scope-subagents",
      "severity": "medium",
      "message": "Scope subagent tasks tightly with a narrow objective and expected output.",
      "signals": [
        "subagent_tokens"
      ]
    },
    {
      "id": "improve-token-coverage",
      "severity": "low",
      "message": "Increase token coverage by using agents and checkpoints that report token usage.",
      "signals": [
        "missing_token_usage"
      ]
    }
  ],
  "limitations": [
    "Limited to latest 50 of 69 committed checkpoints; use --limit or --all to change scope.",
    "2 checkpoints did not include token usage.",
    "Token totals are summed from analyzed checkpoints and may include overlapping checkpoint history; treat them as checkpoint-observed volume, not guaranteed unique session spend.",
    "Tool-level search/read spend is not captured yet; this profile infers patterns from token totals, cache/context replay, API call counts, and subagent totals."
  ]
}
`;

export const REVIEW_CONFIG_JSON = `{
  "target": "HEAD",
  "head": "0123456789abcdef0123456789abcdef01234567",
  "commits": 0,
  "yours": true,
  "entries": [
    {
      "agent": "claude-code",
      "kind": "hook",
      "name": "PreCompact",
      "command": "./scripts/check-before-compact.sh",
      "source": ".claude/settings.json",
      "entire": false
    },
    {
      "agent": "claude-code",
      "kind": "mcp",
      "name": "entire",
      "command": "entire mcp",
      "source": ".mcp.json",
      "entire": false
    },
    {
      "agent": "claude-code",
      "kind": "hook",
      "name": "PostToolUse",
      "command": "sh -c 'if ! command -v entire >/dev/null 2>&1; then exit 0; fi; exec entire hooks claude-code post-task'",
      "source": ".claude/settings.json",
      "entire": true
    },
    {
      "agent": "claude-code",
      "kind": "hook",
      "name": "PostToolUse",
      "command": "sh -c 'if ! command -v entire >/dev/null 2>&1; then exit 0; fi; exec entire hooks claude-code post-task'",
      "source": ".claude/settings.json",
      "entire": true
    },
    {
      "agent": "claude-code",
      "kind": "hook",
      "name": "PreToolUse",
      "command": "sh -c 'if ! command -v entire >/dev/null 2>&1; then exit 0; fi; exec entire hooks claude-code pre-task'",
      "source": ".claude/settings.json",
      "entire": true
    },
    {
      "agent": "claude-code",
      "kind": "hook",
      "name": "SessionEnd",
      "command": "sh -c 'if ! command -v entire >/dev/null 2>&1; then exit 0; fi; exec entire hooks claude-code session-end'",
      "source": ".claude/settings.json",
      "entire": true
    }
  ],
  "instructions": [
    "AGENTS.md"
  ],
  "isolated_agents": []
}
`;

/** The checkpoint ids used in TOKEN_PROFILE_JSON. */
export const PROFILE_CHECKPOINT_IDS: readonly string[] = ["01HXA000000000000000000001","01HXA000000000000000000002","01HXA000000000000000000003","01HXA000000000000000000004","01HXA000000000000000000005","01HXA000000000000000000006","01HXA000000000000000000007","01HXA000000000000000000008"];
