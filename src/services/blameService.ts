import {
	answerNamesFile,
	blameArguments,
	decodeBlameAnswer,
	unwrap,
	workspaceRelative,
	type BlameAnswer,
} from '../lib/entire';
import type { CliRunner } from './cli';

/** The outcome of blaming a file. */
export type BlameResult =
	| { readonly kind: 'answered'; readonly answer: BlameAnswer }
	/** The file is not in the workspace, so the CLI is not asked. */
	| { readonly kind: 'outside-workspace'; readonly file: string }
	/** The Entire CLI is not installed. */
	| { readonly kind: 'cli-missing' }
	| { readonly kind: 'failed'; readonly detail: string };

/** What the service needs to do its job. */
export interface BlameServiceOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
}

/**
 * Asks the CLI to blame a file with `entire blame`.
 *
 * The CLI does the attribution. This passes the file safely, keeps it
 * inside the workspace, and refuses an answer about a different file.
 */
export class BlameService {
	constructor(private readonly options: BlameServiceOptions) {}

	async blameFile(file: string): Promise<BlameResult> {
		const root = this.options.workspaceRoot();
		if (!root) {
			return { kind: 'failed', detail: 'there is no open workspace' };
		}

		const relative = workspaceRelative(root, file);
		if (relative === undefined) {
			return { kind: 'outside-workspace', file };
		}

		const result = await this.options.runner.runJson(
			blameArguments(relative),
			value => unwrap(decodeBlameAnswer(value)),
			{ cwd: root, withholdBodies: true },
		);

		if (!result.ok) {
			if (result.reason === 'absent') {
				return { kind: 'cli-missing' };
			}
			return { kind: 'failed', detail: result.detail };
		}

		if (!answerNamesFile(relative, result.value.file)) {
			return {
				kind: 'failed',
				detail: 'the CLI answered about a different file than the one that was asked about',
			};
		}

		return { kind: 'answered', answer: result.value };
	}
}
