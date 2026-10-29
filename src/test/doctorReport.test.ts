import * as assert from 'assert';

import { renderDoctorReport, type DoctorFacts } from '../services/doctorReport';

/**
 * The facts the doctor gathers, with the parts that matter for the
 * report filled in.
 */
function factsWith(overrides: Partial<DoctorFacts> = {}): DoctorFacts {
	return {
		generatedAt: new Date('2026-10-28T12:00:00.000Z'),
		extensionVersion: '0.1.0',
		editorVersion: '1.140.0',
		platform: 'darwin',
		discovery: {
			state: 'available',
			path: '/usr/local/bin/entire',
			location: 'path',
			directory: '/usr/local/bin',
			version: '0.12.2',
		},
		status: undefined,
		statusError: undefined,
		isRepository: true,
		workspaceRoot: '/work/repo',
		settings: [],
		logLevel: 'info',
		debug: false,
		configuredPath: undefined,
		failure: undefined,
		minimumCliVersion: '0.12.2',
		checkpointDestination: undefined,
		accountContext: undefined,
		contextMechanism:
			'--context flag on CLI commands, ENTIRE_CONTEXT environment variable for hooks and plugin commands',
		...overrides,
	};
}

suite('Entirely doctor report', () => {
	test('names the CLI version and the version it expects', () => {
		const report = renderDoctorReport(factsWith());

		assert.match(report, /- Version: 0\.12\.2/);
		assert.match(report, /- Expected by this extension: 0\.12\.2/);
	});

	test('says nothing about the CLI being too old when it is new enough', () => {
		const report = renderDoctorReport(factsWith());

		assert.doesNotMatch(report, /older than this extension expects/);
	});

	test('says so when the CLI is older than the extension expects', () => {
		const report = renderDoctorReport(
			factsWith({
				discovery: {
					state: 'available',
					path: '/usr/local/bin/entire',
					location: 'path',
					directory: '/usr/local/bin',
					version: '0.9.0',
				},
			}),
		);

		assert.match(report, /older than this extension expects/);
	});

	test('does not claim a destination it does not know', () => {
		const report = renderDoctorReport(
			factsWith({
				checkpointDestination: {
					destination: {
						kind: 'unknown',
						reason: 'The Entire CLI did not say where checkpoints are being uploaded.',
					},
					problem: 'The Entire CLI did not say where checkpoints are being uploaded.',
				},
			}),
		);

		assert.doesNotMatch(report, /this machine only/);
		assert.match(report, /- Destination: an unknown destination/);
		assert.match(report, /did not say where checkpoints are being uploaded/);
	});

	test('says the checkpoints stay on the machine when they do', () => {
		const report = renderDoctorReport(
			factsWith({
				checkpointDestination: {
					destination: { kind: 'local-only' },
					problem: 'Checkpoints are kept on this machine only.',
				},
			}),
		);

		assert.match(report, /- Destination: this machine only/);
	});

	test('names the login it is acting as and how many there are', () => {
		const report = renderDoctorReport(
			factsWith({
				accountContext: {
					acting: {
						name: 'us.auth.entire.io',
						handle: 'greysquirr3l',
						server: 'https://us.auth.entire.io',
						active: false,
					},
					pinned: true,
					saved: [
						{
							name: 'us.auth.entire.io',
							handle: 'greysquirr3l',
							server: 'https://us.auth.entire.io',
							active: false,
						},
						{
							name: 'sosh-ncampbell@us.auth.entire.io',
							handle: 'sosh-ncampbell',
							server: 'https://us.auth.entire.io',
							active: true,
						},
					],
					problem: undefined,
				},
			}),
		);

		assert.match(report, /- Login: greysquirr3l \(us\.auth\.entire\.io\)/);
		assert.match(report, /- Chosen by: the entirely\.cliContext setting/);
		assert.match(report, /- Saved logins: 2/);
	});

	test('says which mechanism each command path used', () => {
		const report = renderDoctorReport(factsWith());

		assert.match(report, /--context flag on CLI commands/);
		assert.match(report, /ENTIRE_CONTEXT environment variable for hooks and plugin commands/);
	});

	test('says when the login in the settings is not one the CLI has', () => {
		const report = renderDoctorReport(
			factsWith({
				accountContext: {
					acting: undefined,
					pinned: true,
					saved: [],
					problem: 'The Entire CLI has no saved login called "nobody".',
				},
			}),
		);

		assert.match(report, /- Login: \(none\)/);
		assert.match(report, /no saved login called "nobody"/);
	});
});
