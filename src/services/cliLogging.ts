import {
	excerptPayload,
	formatBytes,
	renderCommandLine,
	type CliInvocation,
	type CliInvocationBodies,
	type CliInvocationSink,
} from './cli/invocation';
import type { CliInvocationRecorder } from './cli/recorder';
import type { Logger } from './logger';

/**
 * Writes what the CLI was asked to do to the output channel.
 *
 * The channel is the extension's one place for everything it does, so an
 * invocation is written there with the command line, the working
 * directory and the exit code — the three things a user needs to
 * reproduce a problem by hand.
 *
 * A prompt body or a checkpoint payload is not written. The channel says
 * how many bytes there were, and the payload itself is behind an explicit
 * command.
 */
export class CliInvocationLogger implements CliInvocationSink {
	constructor(
		private readonly logger: Logger,
		private readonly recorder: CliInvocationRecorder,
	) {}

	report(invocation: CliInvocation, bodies: CliInvocationBodies): void {
		this.recorder.record(invocation, bodies);

		this.logger.info(`entire: ${renderCommandLine(invocation.binary, invocation.args)}`);
		this.logger.info(`  cwd: ${invocation.cwd ?? "(the editor's own directory)"}`);
		this.logger.info(
			`  exit: ${invocation.exitCode ?? '-'} (${invocation.outcome}, ${invocation.durationMs}ms); stdout ${formatBytes(invocation.stdoutBytes)}, stderr ${formatBytes(invocation.stderrBytes)}, stdin ${formatBytes(invocation.inputBytes)}`,
		);

		if (invocation.outcome !== 'ok') {
			this.logger.warn(`  failed: ${invocation.detail ?? 'the command failed'}`);
		}

		// The bodies are shown only when the user has asked for more detail
		// than the ordinary level carries, and then only in part.
		if (invocation.stdoutBytes > 0) {
			this.logger.debug(`  stdout: ${excerptPayload(bodies.stdout ?? '')}`);
		}

		if (invocation.stderrBytes > 0) {
			this.logger.debug(`  stderr: ${excerptPayload(bodies.stderr ?? '')}`);
		}

		if (invocation.inputBytes > 0) {
			this.logger.debug(`  stdin: ${excerptPayload(bodies.input ?? '')}`);
		}
	}
}
