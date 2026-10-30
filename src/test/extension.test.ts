import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'greysquirr3l.entirely';
const SCAFFOLD_COMMAND = 'greysquirr3l.entirely.helloWorld';

interface ExtensionManifest {
	contributes?: {
		commands?: { command: string }[];
		configuration?: { properties?: Record<string, unknown> };
	};
}

suite('Entirely extension', () => {
	test('activates and registers every contributed command', async function () {
		this.timeout(15000);

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

		// Commands are registered from `index.ts` and from the focused modules
		// that register a family of their own, such as the control plane's.
		const commandDirectory = path.join(extension.extensionPath, 'src', 'commands');
		const commandSource = fs
			.readdirSync(commandDirectory)
			.filter(name => name.endsWith('.ts'))
			.map(name => fs.readFileSync(path.join(commandDirectory, name), 'utf8'))
			.join('\n');
		const handlers = [...commandSource.matchAll(/registerCommand\('([^']+)'/g)]
			.map(([, command]) => command)
			.sort();
		assert.deepStrictEqual(
			handlers,
			contributed.map(({ command }) => command).sort(),
			'every registered command must be contributed by the manifest',
		);

		await vscode.commands.executeCommand('entirely.refresh');
	});

	test('keeps the domain layer free of VS Code imports', () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension);

		const libDirectory = path.join(extension.extensionPath, 'src', 'lib');
		const files = fs.readdirSync(libDirectory, { recursive: true, withFileTypes: true });
		for (const entry of files) {
			if (!entry.isFile() || !entry.name.endsWith('.ts')) {
				continue;
			}

			const file = path.join(entry.parentPath, entry.name);
			const source = fs.readFileSync(file, 'utf8');
			assert.doesNotMatch(
				source,
				/(?:from\s*|require\s*\()\s*['"]vscode['"]/,
				`${path.relative(libDirectory, file)} imports VS Code`,
			);
		}
	});

	test('reads every declared setting and declares every setting it reads', () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension);

		const manifest = JSON.parse(
			fs.readFileSync(path.join(extension.extensionPath, 'package.json'), 'utf8'),
		) as ExtensionManifest;
		const declared = Object.keys(manifest.contributes?.configuration?.properties ?? {})
			.map(key => key.replace(/^entirely\./, ''))
			.sort();
		const settingsSource = fs.readFileSync(
			path.join(extension.extensionPath, 'src', 'services', 'configuration.ts'),
			'utf8',
		);
		const read = [...settingsSource.matchAll(/configuration\s*\.\s*get<[^>]+>\('([^']+)'/g)]
			.map(([, key]) => key)
			.sort();

		assert.deepStrictEqual(read, declared);
	});

	test('adds each activation-owned disposable to the extension context', () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension);

		const activation = fs.readFileSync(
			path.join(extension.extensionPath, 'src', 'extension.ts'),
			'utf8',
		);
		for (const resource of [
			'output',
			'status',
			'statusController',
			'sessions',
			'sessionDetail',
			'checkpoints',
			'checkpointsView',
			'sessionsView',
			'detailView',
			'explorerSessionsView',
		]) {
			assert.match(
				activation,
				new RegExp(`context\\.subscriptions\\.push\\([^)]*\\b${resource}\\b`),
				`${resource} is not disposed with the extension context`,
			);
		}

		assert.match(activation, /registerCommands\(context,/);
	});

	test('has no scaffold command or placeholder markers', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension);

		const manifest = JSON.parse(
			fs.readFileSync(path.join(extension.extensionPath, 'package.json'), 'utf8'),
		) as ExtensionManifest;
		assert.ok(
			!(manifest.contributes?.commands ?? []).some(({ command }) =>
				/helloWorld/i.test(command),
			),
			'the manifest still contributes the generated hello-world command',
		);
		const registered = await vscode.commands.getCommands(true);
		assert.ok(!registered.includes(SCAFFOLD_COMMAND), 'the generated command is registered');

		const sourceDirectory = path.join(extension.extensionPath, 'src');
		const productionFiles = sourceFiles(sourceDirectory).filter(
			file => !path.relative(sourceDirectory, file).startsWith(`test${path.sep}`),
		);
		for (const file of productionFiles) {
			const source = fs.readFileSync(file, 'utf8');
			assert.doesNotMatch(
				source,
				/\b(?:TODO|FIXME|HACK|XXX)\b|placeholder|not implemented|\bstub\b/,
				`${path.relative(sourceDirectory, file)} contains a scaffold marker`,
			);
		}
	});
});

function sourceFiles(directory: string): string[] {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
		const file = path.join(directory, entry.name);
		return entry.isDirectory() ? sourceFiles(file) : [file];
	});
}
