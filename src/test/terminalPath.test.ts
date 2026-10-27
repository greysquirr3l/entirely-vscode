import * as assert from 'assert';

import {
	INHERITED_PATH,
	pathEntries,
	pathHasDirectory,
	pathSeparator,
	pathWithDirectory,
	pathWithoutDirectory,
	platformSegment,
	terminalEnvSetting,
	terminalPathHasDirectory,
	withPath,
} from '../lib/terminalPath';

suite('Entire terminal PATH', () => {
	test('names the terminal environment the way the editor does', () => {
		assert.strictEqual(terminalEnvSetting('osx'), 'terminal.integrated.env.osx');
		assert.strictEqual(terminalEnvSetting('linux'), 'terminal.integrated.env.linux');
		assert.strictEqual(terminalEnvSetting('windows'), 'terminal.integrated.env.windows');
	});

	test('names the platform the way the editor does', () => {
		assert.strictEqual(platformSegment('darwin'), 'osx');
		assert.strictEqual(platformSegment('linux'), 'linux');
		assert.strictEqual(platformSegment('win32'), 'windows');
		assert.strictEqual(platformSegment('freebsd'), undefined);
	});

	test('separates PATH entries the way the platform does', () => {
		assert.strictEqual(pathSeparator('darwin'), ':');
		assert.strictEqual(pathSeparator('linux'), ':');
		assert.strictEqual(pathSeparator('win32'), ';');
	});

	test('splits PATH entries without breaking a variable reference', () => {
		assert.deepStrictEqual(
			pathEntries(`${INHERITED_PATH}:/opt/tools:/usr/bin`, ':'),
			[INHERITED_PATH, '/opt/tools', '/usr/bin'],
		);
	});

	test('adds the directory to the inherited PATH', () => {
		const value = pathWithDirectory(undefined, '/home/dev/.local/bin', ':');

		assert.strictEqual(value, `${INHERITED_PATH}:/home/dev/.local/bin`);
	});

	test('keeps the PATH the user already had', () => {
		const value = pathWithDirectory(
			'/opt/tools:/usr/local/bin',
			'/home/dev/.local/bin',
			':',
		);

		assert.strictEqual(
			value,
			`${INHERITED_PATH}:/opt/tools:/usr/local/bin:/home/dev/.local/bin`,
		);
	});

	test('keeps a PATH that already inherits the live one', () => {
		const value = pathWithDirectory(
			`${INHERITED_PATH}:/opt/tools`,
			'/home/dev/.local/bin',
			':',
		);

		assert.strictEqual(value, `${INHERITED_PATH}:/opt/tools:/home/dev/.local/bin`);
	});

	test('does not add the directory twice', () => {
		const value = pathWithDirectory(
			`${INHERITED_PATH}:/home/dev/.local/bin`,
			'/home/dev/.local/bin',
			':',
		);

		assert.strictEqual(value, `${INHERITED_PATH}:/home/dev/.local/bin`);
	});

	test('separates Windows PATH entries with a semicolon', () => {
		const value = pathWithDirectory(
			'C:\\tools',
			'C:\\Users\\dev\\.local\\bin',
			';',
		);

		assert.strictEqual(value, `${INHERITED_PATH};C:\\tools;C:\\Users\\dev\\.local\\bin`);
	});

	test('takes the directory off the PATH again', () => {
		const value = pathWithoutDirectory(
			`${INHERITED_PATH}:/opt/tools:/home/dev/.local/bin`,
			'/home/dev/.local/bin',
			':',
		);

		assert.strictEqual(value, `${INHERITED_PATH}:/opt/tools`);
	});

	test('falls back to the inherited PATH when the directory was all of it', () => {
		const value = pathWithoutDirectory(
			'/home/dev/.local/bin',
			'/home/dev/.local/bin',
			':',
		);

		assert.strictEqual(value, INHERITED_PATH);
	});

	test('knows when the directory is already on the PATH', () => {
		assert.strictEqual(
			pathHasDirectory({ PATH: `${INHERITED_PATH}:/home/dev/.local/bin` }, '/home/dev/.local/bin', ':'),
			true,
		);
		assert.strictEqual(
			pathHasDirectory({ PATH: `${INHERITED_PATH}:/usr/local/bin` }, '/home/dev/.local/bin', ':'),
			false,
		);
		assert.strictEqual(
			pathHasDirectory(undefined, '/home/dev/.local/bin', ':'),
			false,
		);
	});

	test('leaves the other variables alone', () => {
		const existing = { EDITOR: 'vim', LANG: 'en_GB' };

		const value = withPath(existing, `${INHERITED_PATH}:/home/dev/.local/bin`);

		assert.strictEqual(value.EDITOR, 'vim');
		assert.strictEqual(value.LANG, 'en_GB');
		assert.deepStrictEqual(existing, { EDITOR: 'vim', LANG: 'en_GB' });
	});

	test('finds a directory the terminal can see', () => {
		assert.strictEqual(
			terminalPathHasDirectory(
				{ PATH: `${INHERITED_PATH}:/home/dev/.local/bin` },
				'/home/dev/.local/bin',
				':',
				'/usr/local/bin:/usr/bin',
			),
			true,
		);
	});

	test('finds a directory the terminal inherits from the editor', () => {
		// The setting inherits the PATH the editor's process has, so a
		// directory on that PATH is on the terminal's PATH too.
		assert.strictEqual(
			terminalPathHasDirectory(
				{ PATH: INHERITED_PATH },
				'/usr/local/bin',
				':',
				'/usr/local/bin:/usr/bin',
			),
			true,
		);
	});

	test('finds a directory the terminal inherits when the setting says nothing', () => {
		assert.strictEqual(
			terminalPathHasDirectory(
				undefined,
				'/usr/local/bin',
				':',
				'/usr/local/bin:/usr/bin',
			),
			true,
		);
	});

	test('does not find a directory the setting replaced the PATH with', () => {
		// A setting that names a PATH without inheriting replaces it, so a
		// directory on the editor's own PATH is not on the terminal's.
		assert.strictEqual(
			terminalPathHasDirectory(
				{ PATH: '/opt/tools' },
				'/usr/local/bin',
				':',
				'/usr/local/bin:/usr/bin',
			),
			false,
		);
	});

	test('does not find a directory the terminal cannot see', () => {
		assert.strictEqual(
			terminalPathHasDirectory(
				{ PATH: `${INHERITED_PATH}:/opt/tools` },
				'/home/dev/.local/bin',
				':',
				'/usr/local/bin:/usr/bin',
			),
			false,
		);
	});
});
