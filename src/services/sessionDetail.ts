import {
	MAX_RAW_CHARACTERS,
	decodeSessionInfo,
	isSessionId,
	parseTranscript,
	unwrap,
	type SessionInfo,
	type Transcript,
} from '../lib/entire';
import type { CliRunner } from './cli';

/** The outcome of asking the CLI about one session. */
export type SessionInfoResult =
	| { readonly kind: 'found'; readonly info: SessionInfo }
	| { readonly kind: 'failed'; readonly detail: string };

/** A transcript, read and ready to show. */
export interface LoadedTranscript {
	readonly transcript: Transcript;
	readonly raw: string;
	readonly receivedBytes: number;
	readonly truncated: boolean;
}

/** The outcome of asking the CLI for a transcript. */
export type TranscriptResult =
	| { readonly kind: 'loaded'; readonly loaded: LoadedTranscript }
	| { readonly kind: 'failed'; readonly detail: string };

/** What the service needs to do its job. */
export interface SessionDetailOptions {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	/** How long the CLI may take to hand over a transcript, in seconds. */
	readonly transcriptTimeoutSeconds: () => number;
}

/** The lookups a view of one session is built from. */
export interface SessionDetailSource {
	info(id: string): Promise<SessionInfoResult>;
	transcript(info: SessionInfo): Promise<TranscriptResult>;
}

/**
 * Reads one session in full from the CLI.
 *
 * The detail comes from `session info`, not from the list payload, and it
 * works for a session that has ended. The transcript is a separate request,
 * because it is the user's own conversation and can be very large.
 */
export class SessionDetailService implements SessionDetailSource {
	/** The last transcript read, so that opening it after selecting does not read it twice. */
	private cached: { readonly key: string; readonly loaded: LoadedTranscript } | undefined;

	constructor(private readonly options: SessionDetailOptions) {}

	/** Asks the CLI about a session. */
	async info(id: string): Promise<SessionInfoResult> {
		if (!isSessionId(id)) {
			return { kind: 'failed', detail: 'the session id is not one the CLI could have issued' };
		}

		const result = await this.options.runner.runJson(
			['session', 'info', id, '--json'],
			value => unwrap(decodeSessionInfo(value)),
			{ cwd: this.options.workspaceRoot() },
		);

		return result.ok
			? { kind: 'found', info: result.value }
			: { kind: 'failed', detail: result.detail };
	}

	/**
	 * Reads a session's transcript.
	 *
	 * A session that is still running changes, so the cache is keyed on
	 * the session's last activity as well as its id.
	 */
	async transcript(info: SessionInfo): Promise<TranscriptResult> {
		if (!isSessionId(info.id)) {
			return { kind: 'failed', detail: 'the session id is not one the CLI could have issued' };
		}

		const key = `${info.id}@${info.lastActive?.raw ?? ''}@${info.status}`;
		if (this.cached?.key === key) {
			return { kind: 'loaded', loaded: this.cached.loaded };
		}

		let receivedBytes = 0;
		const result = await this.options.runner.run(['session', 'info', info.id, '--transcript'], {
			cwd: this.options.workspaceRoot(),
			timeoutMs: this.options.transcriptTimeoutSeconds() * 1000,
			withholdBodies: true,
			onStdout: chunk => {
				receivedBytes += Buffer.byteLength(chunk, 'utf8');
			},
		});

		if (!result.ok) {
			return { kind: 'failed', detail: result.detail };
		}

		const transcript = await parseTranscript(result.stdout);
		const loaded: LoadedTranscript = {
			transcript,
			raw: transcript.items.length === 0 ? result.stdout.slice(0, MAX_RAW_CHARACTERS + 1) : '',
			receivedBytes,
			truncated: receivedBytes > Buffer.byteLength(result.stdout, 'utf8'),
		};

		this.cached = { key, loaded };
		return { kind: 'loaded', loaded };
	}
}
