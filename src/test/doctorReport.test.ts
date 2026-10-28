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
});
