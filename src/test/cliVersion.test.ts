import * as assert from 'assert';

import {
	DEFAULT_MINIMUM_CLI_VERSION,
	compareCliVersions,
	describeUnexpectedPayload,
	describeUnsupportedCli,
	isAtLeast,
	parseCliVersion,
} from '../lib/entire';

suite('Entire CLI version', () => {
	test('reads a version out of the CLI\'s own output', () => {
		assert.deepStrictEqual(parseCliVersion('0.12.2'), { major: 0, minor: 12, patch: 2 });
		assert.deepStrictEqual(parseCliVersion('v1.4.9'), { major: 1, minor: 4, patch: 9 });
		assert.deepStrictEqual(parseCliVersion('Entire CLI 0.12.2'), {
			major: 0,
			minor: 12,
			patch: 2,
		});
	});

	test('says a version it cannot read is not a version', () => {
		assert.strictEqual(parseCliVersion(undefined), undefined);
		assert.strictEqual(parseCliVersion(''), undefined);
		assert.strictEqual(parseCliVersion('unknown'), undefined);
		assert.strictEqual(parseCliVersion('0.12'), undefined);
	});

	test('compares versions by their parts', () => {
		const older = parseCliVersion('0.9.1');
		const newer = parseCliVersion('0.10.0');

		assert.ok(older && newer);
		assert.ok(compareCliVersions(older, newer) < 0);
		assert.ok(compareCliVersions(newer, older) > 0);
		assert.strictEqual(compareCliVersions(newer, newer), 0);
	});

	test('knows when a version is new enough', () => {
		const installed = parseCliVersion('0.12.2');
		const minimum = parseCliVersion(DEFAULT_MINIMUM_CLI_VERSION);

		assert.ok(installed && minimum);
		assert.strictEqual(isAtLeast(installed, minimum), true);
		assert.strictEqual(isAtLeast(parseCliVersion('0.9.0')!, minimum), false);
	});
});

suite('Entire CLI compatibility', () => {
	test('says nothing when the CLI is new enough', () => {
		assert.strictEqual(describeUnsupportedCli('0.12.2', '0.12.2'), undefined);
		assert.strictEqual(describeUnsupportedCli('0.13.0', '0.12.2'), undefined);
	});

	test('says so when the CLI is older than the extension expects', () => {
		const message = describeUnsupportedCli('0.9.0', '0.12.2');

		assert.ok(message);
		assert.match(message, /0\.9\.0/);
		assert.match(message, /0\.12\.2/);
	});

	test('says nothing when it cannot tell how old the CLI is', () => {
		assert.strictEqual(describeUnsupportedCli(undefined, '0.12.2'), undefined);
		assert.strictEqual(describeUnsupportedCli('unknown', '0.12.2'), undefined);
	});

	test('names the CLI version when a payload is not understood', () => {
		assert.strictEqual(
			describeUnexpectedPayload('0.12.2'),
			'The Entire CLI (0.12.2) reported something this extension does not understand.',
		);
	});

	test('says the same thing without a version when there is none', () => {
		assert.strictEqual(
			describeUnexpectedPayload(undefined),
			'The Entire CLI reported something this extension does not understand.',
		);
	});
});
