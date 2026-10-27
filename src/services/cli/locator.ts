import * as fs from 'fs';

import { findCandidate, parseVersion, type DiscoveryOptions } from './discovery';
import { execute } from './exec';
import { byteLength, type CliInvocationSink } from './invocation';
import type { CliDiscovery } from './types';

/** How long a discovery result is trusted before it is looked up again. */
const DEFAULT_TTL_MS = 30_000;

/** How long the verification command may run. */
const VERIFY_TIMEOUT_MS = 5_000;

/**
 * Finds the Entire CLI and keeps the answer.
 *
 * Discovery runs a process, so the result is cached. The cache is
 * re-verified cheaply on every read — the binary is still on disk — and
 * expires on its own, so a CLI installed after the extension activated is
 * picked up without a reload.
 */
export class CliLocator {
	private cached: CliDiscovery | undefined;
	private inFlight: Promise<CliDiscovery> | undefined;
	private checkedAt = 0;
	private sink: CliInvocationSink | undefined;

	constructor(
		private options: DiscoveryOptions = {},
		private readonly ttlMs: number = DEFAULT_TTL_MS,
	) {}

	/**
	 * Reports invocations to a sink.
	 *
	 * The probe is a CLI invocation like any other, so it is reported too:
	 * a user watching the channel should be able to see the extension
	 * checking that the CLI is there.
	 */
	setSink(sink: CliInvocationSink | undefined): void {
		this.sink = sink;
	}

	/**
	 * Points discovery at a specific binary, or back at the usual search.
	 *
	 * The path comes from the user's setting, and changing it must take
	 * effect without a reload, so the cached result is dropped.
	 */
	setConfiguredPath(configuredPath: string | undefined): void {
		this.options = { ...this.options, configuredPath };
		this.invalidate();
	}

	/** The current discovery result, running a lookup if the cache is stale. */
	async current(): Promise<CliDiscovery> {
		const cached = this.cached;
		if (cached && this.isFresh(cached)) {
			return cached;
		}
		return this.refresh();
	}

	/** The last discovery result, without running a lookup. */
	peek(): CliDiscovery | undefined {
		return this.cached;
	}

	/** Forgets the cached result, so the next read looks again. */
	invalidate(): void {
		this.cached = undefined;
		this.checkedAt = 0;
	}

	/** Runs discovery now and replaces the cached result. */
	async refresh(): Promise<CliDiscovery> {
		if (this.inFlight) {
			return this.inFlight;
		}

		this.inFlight = this.probe().finally(() => {
			this.inFlight = undefined;
		});
		return this.inFlight;
	}

	/**
	 * Whether the cached result can still be trusted.
	 *
	 * Within the time-to-live the binary only has to still be on disk. After
	 * it, the location is looked up again — the CLI may have been installed,
	 * removed or moved.
	 */
	private isFresh(cached: CliDiscovery): boolean {
		if (Date.now() - this.checkedAt >= this.ttlMs) {
			return false;
		}
		return cached.state === 'absent' || fs.existsSync(cached.path);
	}

	private async probe(): Promise<CliDiscovery> {
		const candidate = findCandidate(this.options);
		this.checkedAt = Date.now();

		if (!candidate) {
			this.cached = { state: 'absent' };
			return this.cached;
		}

		// A binary that cannot report its version cannot be used. This is
		// how "installed but broken" is told apart from "working".
		const outcome = await execute(candidate.path, ['version'], { timeoutMs: VERIFY_TIMEOUT_MS });

		this.sink?.report(
			{
				binary: candidate.path,
				args: ['version'],
				cwd: undefined,
				outcome: outcome.ok ? 'ok' : outcome.reason,
				exitCode: outcome.exitCode,
				durationMs: outcome.durationMs,
				inputBytes: 0,
				stdoutBytes: byteLength(outcome.stdout),
				stderrBytes: byteLength(outcome.stderr),
				detail: outcome.ok ? undefined : outcome.detail,
			},
			{ stdout: outcome.stdout, stderr: outcome.stderr },
		);

		if (!outcome.ok) {
			this.cached = {
				state: 'broken',
				path: candidate.path,
				location: candidate.location,
				directory: candidate.directory,
				detail: outcome.detail,
			};
			return this.cached;
		}

		const version = parseVersion(outcome.stdout);
		if (!version) {
			this.cached = {
				state: 'broken',
				path: candidate.path,
				location: candidate.location,
				directory: candidate.directory,
				detail: 'the CLI did not report a version',
			};
			return this.cached;
		}

		this.cached = {
			state: 'available',
			path: candidate.path,
			location: candidate.location,
			directory: candidate.directory,
			version,
		};
		return this.cached;
	}
}
