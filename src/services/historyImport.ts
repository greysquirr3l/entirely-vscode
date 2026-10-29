import {
	describeImportResult,
	failureDetail,
	importArguments,
	isImportAgent,
	isSessionId,
	planImportFlags,
	readImportAgents,
	readImportPreview,
	type ImportOutcome,
	type ImportPlan,
	type ImportPreview,
	type ImportScope,
} from '../lib/entire';
import type { CliFlag, CliRunner } from './cli';

/** What the service needs to do its job. */
export interface HistoryImportOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	/** How long, in seconds, a preview or an import may take. */
	readonly timeoutSeconds: () => number;
}

/** The agents an import can read from, or why none can be offered. */
export type ImportAgents =
	| { readonly ok: true; readonly agents: readonly string[] }
	| { readonly ok: false; readonly detail: string };

/** A preview, or why there is none. */
export type PreviewResult =
	| { readonly ok: true; readonly preview: ImportPreview }
	| { readonly ok: false; readonly detail: string };

/** Where imports go. */
export interface HistoryImportSource {
	agents(): Promise<ImportAgents>;
	/** Asks the CLI what the import would do, with the flag that stops it writing. */
	preview(scope: ImportScope): Promise<PreviewResult>;
	/** Imports, after the user has agreed to the preview. */
	run(scope: ImportScope, signal?: AbortSignal): Promise<ImportOutcome>;
}

/**
 * Runs `entire import <agent>`.
 *
 * `import` is an experimental command, so `agent-help` may not know it; its
 * flags and agents are read from `--help` (after trying `agent-help`) for
 * each call and never cached, so a failed lookup is not remembered. The
 * output is a progress log and a summary, never a transcript, but bodies are
 * withheld from the record anyway. Neither the preview nor the import
 * touches the working tree: the CLI writes checkpoint data to git storage.
 */
export class HistoryImportService implements HistoryImportSource {
	constructor(private readonly options: HistoryImportOptions) {}

	async agents(): Promise<ImportAgents> {
		const usage = await this.readUsage('import');
		if (!usage.ok) {
			return usage;
		}
		const agents = readImportAgents(usage.raw);
		if (agents.length === 0) {
			return { ok: false, detail: "this version of the Entire CLI does not list any agent for 'import'; update the CLI" };
		}
		return { ok: true, agents };
	}

	async preview(scope: ImportScope): Promise<PreviewResult> {
		const checked = await this.check(scope);
		if (!checked.ok) {
			return checked;
		}

		const result = await this.options.runner.run(importArguments(checked.plan, scope, true), {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.timeoutMs(),
			withholdBodies: true,
		});
		if (!result.ok) {
			return { ok: false, detail: whyFailed(result) };
		}
		return { ok: true, preview: readImportPreview(result.stdout, result.stderr) };
	}

	async run(scope: ImportScope, signal?: AbortSignal): Promise<ImportOutcome> {
		const checked = await this.check(scope);
		if (!checked.ok) {
			return { kind: 'failed', detail: checked.detail };
		}

		const result = await this.options.runner.run(importArguments(checked.plan, scope, false), {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.timeoutMs(),
			withholdBodies: true,
			signal,
		});
		if (!result.ok) {
			if (result.reason === 'cancelled') {
				return { kind: 'cancelled' };
			}
			return { kind: 'failed', detail: whyFailed(result) };
		}
		const text = readImportPreview(result.stdout, result.stderr).text;
		return { kind: 'done', text: describeImportResult(scope.agent, text) };
	}

	private timeoutMs(): number {
		return this.options.timeoutSeconds() * 1000;
	}

	/** Checks the scope and reads the agent's flags from its help. */
	private async check(
		scope: ImportScope,
	): Promise<{ readonly ok: true; readonly plan: Extract<ImportPlan, { ok: true }> } | { readonly ok: false; readonly detail: string }> {
		if (!scope.sessionIds.every(isSessionId)) {
			return { ok: false, detail: 'a session id is not one the CLI can be given' };
		}
		const known = await this.agents();
		if (!known.ok) {
			return known;
		}
		if (!isImportAgent(scope.agent, known.agents)) {
			return { ok: false, detail: `'${scope.agent}' is not an agent this version of the Entire CLI can import from` };
		}
		const usage = await this.readUsage(`import ${scope.agent}`);
		if (!usage.ok) {
			return usage;
		}
		const plan = planImportFlags(usage.raw, usage.flags);
		if (!plan.ok) {
			return plan;
		}
		if (scope.sessionIds.length > 0 && plan.session === undefined) {
			return { ok: false, detail: 'this version of the Entire CLI cannot narrow an import to chosen sessions; import all of them or update the CLI' };
		}
		return { ok: true, plan };
	}

	/** Reads a command's usage: `agent-help` first, then `--help` for commands it does not know. */
	private async readUsage(
		command: string,
	): Promise<
		| { readonly ok: true; readonly raw: string; readonly flags: readonly CliFlag[] }
		| { readonly ok: false; readonly detail: string }
	> {
		const options = { cwd: this.options.workspaceRoot() };
		let usage = await this.options.runner.usage(command, options);
		if (!usage.ok && usage.reason === 'exit-code') {
			usage = await this.options.runner.help(command, options);
		}
		if (usage.ok) {
			return { ok: true, raw: usage.value.raw, flags: usage.value.flags };
		}
		switch (usage.reason) {
			case 'absent':
				return { ok: false, detail: 'the Entire CLI is not installed; install it to import history' };
			case 'exit-code':
				return { ok: false, detail: "this version of the Entire CLI has no 'import' command; update the CLI" };
			default:
				return { ok: false, detail: usage.detail };
		}
	}
}

/**
 * Why a command failed, in words.
 *
 * A refusal (non-zero exit) is explained by what the CLI printed. A timeout
 * or a failure to start has no such explanation, and any output the process
 * wrote before it was cut off is progress, not a reason.
 */
function whyFailed(result: { readonly reason: string; readonly detail: string; readonly stdout: string; readonly stderr: string }): string {
	return result.reason === 'exit-code' ? failureDetail(result.stderr, result.stdout, result.detail) : result.detail;
}
