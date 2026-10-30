import {
	API_WANTS,
	apiArguments,
	describeFlag,
	isApiPath,
	pickFlags,
	readChoices,
	type AccountContext,
} from '../lib/entire';
import type { CliCommandUsage, CliRunner } from './cli';
import { explain, type Read } from './controlPlane';

/** One call to the control plane's API. */
export interface ApiCall {
	/** An HTTP method. */
	readonly method: string;
	/** A path on the API host the CLI picks, such as `/api/v1/clusters`. */
	readonly path: string;
	/** Which backend, when the CLI offers a choice. */
	readonly backend?: string;
}

/** What an API call came back with. */
export type ApiOutcome =
	| { readonly kind: 'ok'; readonly body: string }
	| { readonly kind: 'failed'; readonly detail: string };

/** Where API calls are made. */
export interface ApiSource {
	/** The backends the CLI's help names, or why it names none. */
	backends(): Promise<Read<readonly string[]>>;
	call(call: ApiCall, acting: AccountContext): Promise<ApiOutcome>;
}

export interface ApiOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	/** How long, in seconds, one call may take. */
	readonly timeoutSeconds: () => number;
}

/**
 * Runs `entire api`: one raw call, as the login the person confirmed.
 *
 * The call runs once and is never retried, because a repeated write is a
 * second write. Nothing but the person's own command reaches this class;
 * no view, poller or watcher is given it. The response is returned for
 * the person to read and is kept out of the output channel.
 */
export class ControlApiService implements ApiSource {
	constructor(private readonly options: ApiOptions) {}

	async backends(): Promise<Read<readonly string[]>> {
		const help = await this.help();
		if (!help.ok) {
			return help;
		}
		const picked = pickFlags('api', help.value.raw, help.value.flags, API_WANTS);
		if (!picked.ok) {
			return picked;
		}
		const values = picked.flags.backend ? readChoices(describeFlag(picked.table, picked.flags.backend)) : [];
		return { ok: true, value: values };
	}

	async call(call: ApiCall, acting: AccountContext): Promise<ApiOutcome> {
		if (!isApiPath(call.path)) {
			return { kind: 'failed', detail: 'that is not a path on the API; it starts with a single slash and has no spaces' };
		}
		const help = await this.help();
		if (!help.ok) {
			return { kind: 'failed', detail: help.detail };
		}
		const picked = pickFlags('api', help.value.raw, help.value.flags, API_WANTS);
		if (!picked.ok || !picked.flags.method) {
			return { kind: 'failed', detail: picked.ok ? 'the method flag is missing' : picked.detail };
		}
		if (call.backend !== undefined) {
			if (!picked.flags.backend) {
				return { kind: 'failed', detail: 'this version of the Entire CLI does not describe a flag that chooses the backend; update the CLI' };
			}
			const offered = readChoices(describeFlag(picked.table, picked.flags.backend));
			if (!offered.includes(call.backend)) {
				return { kind: 'failed', detail: `'${call.backend}' is not a backend the CLI offers (${offered.join(', ')})` };
			}
		}

		const result = await this.options.runner.run(
			apiArguments({ method: picked.flags.method, backend: picked.flags.backend }, call),
			{
				cwd: this.options.workspaceRoot(),
				timeoutMs: this.options.timeoutSeconds() * 1000,
				context: acting.name,
				withholdBodies: true,
				redactOperands: true,
			},
		);
		return result.ok ? { kind: 'ok', body: result.stdout } : { kind: 'failed', detail: explain(result) };
	}

	private async help(): Promise<Read<CliCommandUsage>> {
		const usage = await this.options.runner.usage('api', { cwd: this.options.workspaceRoot() });
		if (usage.ok) {
			return { ok: true, value: usage.value };
		}
		if (usage.reason === 'absent') {
			return { ok: false, detail: 'the Entire CLI is not installed; install it to make API calls' };
		}
		return {
			ok: false,
			detail: usage.reason === 'exit-code' ? "this version of the Entire CLI has no 'api' command; update the CLI" : usage.detail,
		};
	}
}
