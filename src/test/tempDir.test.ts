import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { makeTempDir, removeDirs, removeTempDir } from './support/tempDir';

suite('Test temporary directories', () => {
	test('makes a directory and removes it on request', () => {
		const directory = makeTempDir('entire-tempdir-');
		fs.writeFileSync(path.join(directory, 'file.txt'), 'x');
		assert.ok(fs.existsSync(directory));

		removeTempDir(directory);
		assert.ok(!fs.existsSync(directory));
	});

	test('removes a list of directories, including ones with contents', () => {
		const first = makeTempDir('entire-tempdir-');
		const second = makeTempDir('entire-tempdir-');
		fs.mkdirSync(path.join(second, 'nested'));

		removeDirs([first, second]);
		assert.ok(!fs.existsSync(first));
		assert.ok(!fs.existsSync(second));
	});
});
