import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'greysquirr3l.entirely';

interface ExtensionManifest {
	contributes?: {
		viewsContainers?: Record<string, { id: string }[]>;
		views?: Record<string, { id: string }[]>;
	};
}

/**
 * The command VS Code registers for a contributed view container.
 *
 * A container declared as `entirely` is reachable as
 * `workbench.view.extension.entirely`. There is no `workbench.view.entirely`,
 * and asking for it fails with "command not found" — the error a user sees
 * when the view refuses to open.
 */
function containerCommand(containerId: string): string {
	return `workbench.view.extension.${containerId}`;
}

suite('Entirely view container', () => {
	test('is registered under the command the extension asks for', async function () {
		this.timeout(15000);

		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `extension '${EXTENSION_ID}' was not loaded by the test host`);
		await extension.activate();

		const manifest = JSON.parse(
			fs.readFileSync(path.join(extension.extensionPath, 'package.json'), 'utf8'),
		) as ExtensionManifest;

		const containers = Object.values(manifest.contributes?.viewsContainers ?? {}).flat();
		assert.ok(containers.length > 0, 'the manifest declares no view container');

		const registered = await vscode.commands.getCommands(true);
		for (const container of containers) {
			assert.ok(
				registered.includes(containerCommand(container.id)),
				`VS Code did not register '${containerCommand(container.id)}'`,
			);
		}
	});

	test('opens the sessions view without asking for a command that does not exist', async function () {
		this.timeout(15000);

		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension);
		await extension.activate();

		// The command under test. It throws if it asks VS Code for a command
		// that is not registered, which is the failure this guards.
		await vscode.commands.executeCommand('entirely.showSessions');
	});
});
