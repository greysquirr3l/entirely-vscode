import * as path from 'path';

import { decodeWhyAnswer, unwrap, type WhyAnswer } from '../lib/entire';
import type { CliRunner } from './cli';

/** The outcome of asking why. */
export type WhyResult =
	| {
			/** The CLI answered. */
			readonly kind: 'answered';
			readonly answer: WhyAnswer;
	  }
	| {
			/** The file is not in the workspace, so the CLI cannot be asked. */
			readonly kind: 'outside-workspace';
			readonly file: string;
	  }
	| {
			/** The CLI could not answer. */
			readonly kind: 'failed';
			readonly detail: string;
	  };

/** What the service needs to do its job. */
export interface WhyServiceOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
}

/**
 * Asks the CLI why a line is the way it is.
 *
 * The question is put to the CLI's own `why` command rather than worked
 * out from the Git log, so the answer says the same thing here as it does
 * in the CLI and on the web.
 */
export class WhyService {
	constructor(private readonly options: WhyServiceOptions) {}

	/** Asks about one line of a file. */
	async explainLine(file: string, line: number): Promise<WhyResult> {
		return this.ask(file, line);
	}

	/** Asks about a whole file. */
	async explainFile(file: string): Promise<WhyResult> {
		return this.ask(file, undefined);
	}

	/** Puts the question to the CLI. */
	private async ask(file: string, line: number | undefined): Promise<WhyResult> {
		const root = this.options.workspaceRoot();
		if (!root) {
			return { kind: 'failed', detail: 'there is no open workspace' };
		}

		const relative = path.relative(root, file);
		if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
			return { kind: 'outside-workspace', file };
		}

		const args = ['why', relative];
		if (line !== undefined) {
			args.push('--line', String(line));
		}
		args.push('--json');

		const result = await this.options.runner.runJson(
			args,
			value => unwrap(decodeWhyAnswer(value)),
			{ cwd: root },
		);

		if (!result.ok) {
			return { kind: 'failed', detail: result.detail };
		}

		return { kind: 'answered', answer: result.value };
	}
}
