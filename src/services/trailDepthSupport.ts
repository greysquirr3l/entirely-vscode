import {
	describeDepthFailure,
	describeHelpFailure,
	failureDetail,
	isProjectInvisible,
	type ActingLogin,
} from '../lib/entire';
import type { CliResult } from './cli';
import type { CliRunner } from './cli';
import type { TrailService } from './trailService';

/** What the trail depth services need. */
export interface DepthDependencies {
	readonly runner: CliRunner;
	readonly trails: TrailService;
	readonly workspaceRoot: () => string | undefined;
}

/** A command's help, or the sentence that says why it could not be read. */
export type HelpRead = { readonly ok: true; readonly raw: string } | { readonly ok: false; readonly detail: string };

/**
 * Reads the CLI's own help for a command, every time it is asked.
 *
 * `agent-help` is asked first. A CLI that answers it with a failure is
 * asked for the command's own help next, because some commands are
 * described only there. A CLI that knows neither lacks the command, and
 * a missing or broken CLI is said to be missing or broken; nothing is
 * cached, so a CLI installed a moment later is found.
 */
export async function readCommandHelp(runner: CliRunner, command: string, cwd: string | undefined): Promise<HelpRead> {
	const options = { cwd };
	const guide = await runner.usage(command, options);
	if (guide.ok) {
		return { ok: true, raw: guide.value.raw };
	}
	if (guide.reason === 'exit-code') {
		const own = await runner.help(command, options);
		if (own.ok) {
			return { ok: true, raw: own.value.raw };
		}
	}
	return {
		ok: false,
		detail: describeHelpFailure(command, `use '${command}'`, guide.reason, failureDetail(guide.stderr, guide.stdout, guide.detail)),
	};
}

/** The sentence for a failed run: the honest access message when the project cannot be seen, else the CLI's reason. */
export async function failureText(
	deps: DepthDependencies,
	result: Extract<CliResult, { ok: false }>,
	acting: ActingLogin | undefined,
): Promise<string> {
	return depthFailure(deps, result.detail, result.stderr, acting);
}

/** The same sentence for a failure that is already only text, as the trail reads give. */
export async function depthFailure(
	deps: DepthDependencies,
	detail: string,
	stderr: string,
	acting: ActingLogin | undefined,
): Promise<string> {
	let project: string | undefined;
	if (isProjectInvisible(stderr)) {
		const workspace = await deps.trails.workspace();
		project = workspace.kind === 'ok' ? workspace.value.project : undefined;
	}
	return describeDepthFailure(detail, stderr, { project, login: acting?.handle });
}
