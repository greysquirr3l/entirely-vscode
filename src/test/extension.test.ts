import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'greysquirr3l.entirely';

interface ExtensionManifest {
	contributes?: {
		commands?: { command: string }[];
	};
}

suite('Entirely extension', () => {
	test('activates and registers every contributed command', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `extension '${EXTENSION_ID}' was not loaded by the test host`);

		await extension.activate();
		assert.strictEqual(extension.isActive, true);

		const manifestPath = path.join(extension.extensionPath, 'package.json');
		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ExtensionManifest;
		const contributed = manifest.contributes?.commands ?? [];
		assert.ok(contributed.length > 0, 'the manifest contributes no commands');

		const registered = await vscode.commands.getCommands(true);
		for (const { command } of contributed) {
			assert.ok(registered.includes(command), `command '${command}' is not registered`);
		}
	});
});
