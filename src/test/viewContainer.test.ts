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

/**
 * The view container command the extension asks VS Code to run.
 *
 * Read from the source rather than assumed, so that the id in the code and
 * the id the manifest declares cannot drift apart. The command that opens
 * the view is the one that regressed, so the test has to look at the code
 * that runs it: a test that only checks VS Code's own registry passes
 * whatever the extension asks for.
 */
function commandAskedFor(extensionPath: string): string | undefined {
	const source = fs.readFileSync(
		path.join(extensionPath, 'src', 'commands', 'index.ts'),
		'utf8',
	);
	const asked = [...source.matchAll(/executeCommand\('(workbench\.view[^']*)'\)/g)].map(
		([, command]) => command,
	);
	assert.strictEqual(
		asked.length,
		1,
		`the commands module asks for ${asked.length} view container commands, expected one`,
	);
	return asked[0];
}

suite('Entirely view container', () => {
	test('asks for the command VS Code registers for the container', async function () {
		this.timeout(15000);

		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `extension '${EXTENSION_ID}' was not loaded by the test host`);
		await extension.activate();

		const manifest = JSON.parse(
			fs.readFileSync(path.join(extension.extensionPath, 'package.json'), 'utf8'),
		) as ExtensionManifest;

		const containers = Object.values(manifest.contributes?.viewsContainers ?? {}).flat();
		assert.ok(containers.length > 0, 'the manifest declares no view container');

		const asked = commandAskedFor(extension.extensionPath);
		assert.ok(asked, 'the commands module asks for no view container command');

		for (const container of containers) {
			assert.strictEqual(
				asked,
				containerCommand(container.id),
				`the extension asks for '${asked}', but VS Code registers '${containerCommand(container.id)}'`,
			);
		}
	});

	test('registers the command the extension asks for', async function () {
		this.timeout(15000);

		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension);
		await extension.activate();

		const asked = commandAskedFor(extension.extensionPath);
		assert.ok(asked);

		const registered = await vscode.commands.getCommands(true);
		assert.ok(registered.includes(asked), `VS Code did not register '${asked}'`);
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
