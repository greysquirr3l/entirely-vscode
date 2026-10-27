import { renderCommandLine, type CliInvocation, type CliInvocationBodies } from './invocation';

/** How many invocations are remembered. */
const MAX_HISTORY = 25;

/** The last thing that went wrong, as the doctor reports it. */
export interface CliFailureRecord {
	/** The command line that failed. */
	readonly commandLine: string;
	/** The directory it ran in. */
	readonly cwd: string | undefined;
	/** Why it failed. */
	readonly reason: string;
	/** What the failure was. */
	readonly detail: string;
}

/**
 * Remembers what the CLI has been asked to do.
 *
 * The recorder exists so that a failure the extension swallowed is still
 * there to be reported: a session tree that came back empty because the
 * command failed has to be able to say why.
 *
 * The bodies of an invocation are kept for the most recent one only. They
 * are held in memory and are never written anywhere until somebody asks
 * for them, and one invocation's worth is enough to answer the question
 * that is being asked.
 */
export class CliInvocationRecorder {
	private readonly history: CliInvocation[] = [];
	private bodies: CliInvocationBodies | undefined;
	private failure: CliFailureRecord | undefined;

	/** Remembers one invocation, and the bodies it produced. */
	record(invocation: CliInvocation, bodies: CliInvocationBodies): void {
		this.history.push(invocation);

		while (this.history.length > MAX_HISTORY) {
			this.history.shift();
		}

		this.bodies = {
			input: bodies.input,
			stdout: bodies.stdout,
			stderr: bodies.stderr,
		};

		if (invocation.outcome === 'ok') {
			return;
		}

		this.failure = {
			commandLine: renderCommandLine(invocation.binary, invocation.args),
			cwd: invocation.cwd,
			reason: invocation.outcome,
			detail: invocation.detail ?? 'the command failed',
		};
	}

	/** The invocations so far, oldest first. */
	recent(): readonly CliInvocation[] {
		return [...this.history];
	}

	/** The bodies of the most recent invocation, when there was one. */
	latestBodies(): CliInvocationBodies | undefined {
		return this.bodies;
	}

	/**
	 * The last failure, when there was one.
	 *
	 * A later success does not clear it: the question being asked is what
	 * went wrong, and the last thing that went wrong is the answer.
	 */
	lastFailure(): CliFailureRecord | undefined {
		return this.failure;
	}
}
