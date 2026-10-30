import { describeCliDoctor, describeDestination, describeUnsupportedCli, oneLine, type CliDoctorReading, type WorkspaceStatus } from '../lib/entire';
import type { AccountContextReading } from './accountContext';
import type { CliDiscovery } from './cli/types';
import type { CheckpointDestinationReport } from './checkpointDestination';

/** The last thing that went wrong, as the doctor reports it. */
export interface DoctorFailure {
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
 * Everything the doctor knows.
 *
 * The facts are gathered by the caller and rendered here, so that the
 * report is a piece of text that can be copied into an issue without the
 * editor being involved.
 */
export interface DoctorFacts {
	/** When the report was made. */
	readonly generatedAt: Date;
	/** The version of the extension. */
	readonly extensionVersion: string | undefined;
	/** The version of the editor. */
	readonly editorVersion: string | undefined;
	/** The platform the extension is running on. */
	readonly platform: string;
	/** What discovery found. */
	readonly discovery: CliDiscovery;
	/** The workspace's tracking state, when it could be read. */
	readonly status: WorkspaceStatus | undefined;
	/** Why the workspace's state could not be read. */
	readonly statusError: string | undefined;
	/** Whether the workspace is a git repository. */
	readonly isRepository: boolean;
	/** The folder the workspace is in. */
	readonly workspaceRoot: string | undefined;
	/** The settings Entire has in effect for the workspace. */
	readonly settings: readonly string[];
	/** The verbosity the extension is logging at. */
	readonly logLevel: string;
	/** Whether the debug setting is on. */
	readonly debug: boolean;
	/** The path the user configured for the CLI, when they gave one. */
	readonly configuredPath: string | undefined;
	/** The last CLI failure, when there was one. */
	readonly failure: DoctorFailure | undefined;
	/**
	 * The oldest Entire CLI whose payloads the extension reads in full.
	 */
	readonly minimumCliVersion: string;
	/**
	 * Where the checkpoints of this workspace are going, when that could
	 * be read.
	 */
	readonly checkpointDestination: CheckpointDestinationReport | undefined;
	/**
	 * Which login the extension is acting as, when that could be read.
	 */
	readonly accountContext: AccountContextReading | undefined;
	/**
	 * How the login reaches the CLI.
	 *
	 * The flag is inherited by the CLI's own commands and the
	 * environment variable is what reaches the plugin commands and the
	 * processes the CLI spawns, so both are set and the report says so.
	 */
	readonly contextMechanism: string;
	/** What `entire doctor` said about the capture pipeline, when it was asked. */
	readonly cliDoctor?: CliDoctorReading;
}

/** How the workspace's tracking state is described. */
function describeStatus(status: WorkspaceStatus): string {
	switch (status.kind) {
		case 'tracked':
			return 'yes';
		case 'not-set-up':
			return `no (${status.reason})`;
		case 'not-a-repository':
			return 'no (the workspace is not a git repository)';
	}
}

/** How many sessions the CLI reports as active. */
function activeSessionCount(status: WorkspaceStatus): number | undefined {
	if (status.kind !== 'tracked') {
		return undefined;
	}

	return status.activeSessions.length;
}

/** The agents the CLI reports for the workspace. */
function agentNames(status: WorkspaceStatus): readonly string[] | undefined {
	if (status.kind !== 'tracked') {
		return undefined;
	}

	return status.agents;
}

/**
 * Renders the doctor's report as plain text.
 *
 * The text is meant to be pasted into an issue, so it is written as
 * Markdown: it reads as a list in a browser and still reads as a list in
 * a terminal.
 */
export function renderDoctorReport(facts: DoctorFacts): string {
	const lines: string[] = [];

	lines.push('## Entirely doctor report');
	lines.push('');
	lines.push(`- Generated: ${facts.generatedAt.toISOString()}`);
	lines.push(`- Extension: ${facts.extensionVersion ?? '(unknown)'}`);
	lines.push(`- Editor: ${facts.editorVersion ?? '(unknown)'}`);
	lines.push(`- Platform: ${facts.platform}`);
	lines.push('');

	lines.push('### Entire CLI');
	lines.push('');
	lines.push(`- State: ${oneLine(facts.discovery.state)}`);
	lines.push(
		`- Path: ${facts.discovery.state === 'absent' ? '(not found)' : oneLine(facts.discovery.path)}`,
	);
	lines.push(
		`- Version: ${
			facts.discovery.state === 'available' ? oneLine(facts.discovery.version) : '(unknown)'
		}`,
	);
	lines.push(
		`- Found at: ${
			facts.discovery.state === 'absent'
				? '(none)'
				: `${oneLine(facts.discovery.location)} (${oneLine(facts.discovery.directory)})`
		}`,
	);
	lines.push(`- Configured path: ${facts.configuredPath ? oneLine(facts.configuredPath) : '(not set)'}`);

	if (facts.discovery.state === 'broken') {
		lines.push(`- Problem: ${oneLine(facts.discovery.detail)}`);
	}

	const installed = facts.discovery.state === 'available' ? facts.discovery.version : undefined;
	lines.push(`- Expected by this extension: ${oneLine(facts.minimumCliVersion)}`);

	const unsupported = describeUnsupportedCli(installed, facts.minimumCliVersion);
	if (unsupported) {
		lines.push(`- Problem: ${oneLine(unsupported)}`);
	}

	lines.push('');
	lines.push('### Workspace');
	lines.push('');
	lines.push(`- Folder: ${facts.workspaceRoot ? oneLine(facts.workspaceRoot) : '(no folder is open)'}`);
	lines.push(`- Git repository: ${facts.isRepository ? 'yes' : 'no'}`);
	lines.push(`- Entire enabled: ${facts.status ? describeStatus(facts.status) : '(unknown)'}`);

	const agents = facts.status ? agentNames(facts.status) : undefined;
	if (agents && agents.length > 0) {
		lines.push(`- Agents: ${agents.map(oneLine).join(', ')}`);
	}

	const sessions = facts.status ? activeSessionCount(facts.status) : undefined;
	if (sessions !== undefined) {
		lines.push(`- Active sessions: ${sessions}`);
	}

	if (facts.statusError) {
		lines.push(`- Problem: ${oneLine(facts.statusError)}`);
	}

	lines.push('');
	lines.push('### Account');
	lines.push('');

	const account = facts.accountContext;
	if (!account) {
		lines.push('- Login: (unknown)');
	} else {
		lines.push(
			`- Login: ${account.acting ? oneLine(account.acting.handle) : '(none)'}${
				account.acting ? ` (${oneLine(account.acting.name)})` : ''
			}`,
		);
		lines.push(
			`- Chosen by: ${
				account.pinned ? 'the entirely.cliContext setting' : "the CLI's own active login"
			}`,
		);
		lines.push(`- Saved logins: ${account.saved.length}`);

		if (account.problem) {
			lines.push(`- Problem: ${oneLine(account.problem)}`);
		}
	}

	lines.push(`- Mechanism: ${oneLine(facts.contextMechanism)}`);

	lines.push('');
	lines.push('### Checkpoint destination');
	lines.push('');

	if (!facts.checkpointDestination) {
		lines.push('- (unknown)');
	} else {
		const destination = facts.checkpointDestination;
		lines.push(`- Destination: ${oneLine(describeDestination(destination.destination))}`);

		if (destination.destination.kind === 'dedicated') {
			lines.push(`- Provider: ${destination.destination.provider ?? '(not set)'}`);
		}

		if (destination.workspaceRepo) {
			lines.push(`- This repository: ${oneLine(destination.workspaceRepo.ref.path)}`);
		}

		if (destination.checkpointRepoVisible !== undefined) {
			lines.push(
				`- Entire can reach it: ${destination.checkpointRepoVisible ? 'yes' : 'no'}`,
			);
		}

		if (destination.visible !== undefined && destination.checkpointRepoVisible === undefined) {
			lines.push(`- The acting login can see it: ${destination.visible ? 'yes' : 'no'}`);
		}

		if (destination.problem) {
			lines.push(`- Problem: ${oneLine(destination.problem)}`);
		}

		if (destination.remedy) {
			lines.push(`- Remedy: ${oneLine(destination.remedy)}`);
		}
	}

	lines.push('');
	lines.push("### Capture pipeline (the CLI's own doctor)");
	lines.push('');
	lines.push(...describeCliDoctor(facts.cliDoctor));

	lines.push('');
	lines.push('### Effective settings');
	lines.push('');

	if (facts.settings.length === 0) {
		lines.push('- (none set)');
	}

	for (const setting of facts.settings) {
		lines.push(`- ${oneLine(setting)}`);
	}

	lines.push('');
	lines.push('### Extension settings');
	lines.push('');
	lines.push(`- Log level: ${facts.logLevel}`);
	lines.push(`- Debug: ${facts.debug ? 'yes' : 'no'}`);

	lines.push('');
	lines.push('### Last CLI error');
	lines.push('');

	if (!facts.failure) {
		lines.push('- (none)');
	} else {
		lines.push(`- Command: ${oneLine(facts.failure.commandLine)}`);
		lines.push(`- Directory: ${facts.failure.cwd ? oneLine(facts.failure.cwd) : "(the editor's own directory)"}`);
		lines.push(`- Reason: ${oneLine(facts.failure.reason)}`);
		lines.push(`- Detail: ${oneLine(facts.failure.detail)}`);
	}

	return lines.join('\n');
}
