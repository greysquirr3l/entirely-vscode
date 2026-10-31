import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { applyFinding } from '../commands/trailDepth';
import { registerTrailDepthCommands } from '../commands/trailDepthCommands';
import { unsavedFiles } from '../commands/unsavedWork';
import { CHANGE_SELECTOR, depthRig, threadRow, until } from './support/trailDepthHarness';

const FINDING = { id: '01FIND1', title: 'Unchecked input', state: 'open', severity: 'high' };

suite('Trail depth in the editor', () => {
	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('an untitled buffer does not block an apply, and a dirty workspace file does, naming it', async () => {
		const untitled = await vscode.workspace.openTextDocument({ content: 'scratch' });
		const untitledEditor = await vscode.window.showTextDocument(untitled);
		await untitledEditor.edit(edit => edit.insert(new vscode.Position(0, 0), 'x'));
		assert.deepStrictEqual(unsavedFiles(), [], 'the same rule as a checkout: an untitled buffer is not in the working tree');

		const folder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(folder);
		const file = path.join(folder.uri.fsPath, 'unsaved-apply-guard.txt');
		fs.writeFileSync(file, 'one\n');
		try {
			const document = await vscode.workspace.openTextDocument(file);
			const editor = await vscode.window.showTextDocument(document);
			await editor.edit(edit => edit.insert(new vscode.Position(0, 0), 'x'));

			const rig = depthRig();
			rig.ui.unsavedFiles = () => unsavedFiles();
			assert.strictEqual(await applyFinding(rig.deps, threadRow('finding', FINDING)), 'failed');
			assert.deepStrictEqual(rig.cli.all(), [], 'the CLI was not run');
			assert.match(rig.ui.notices[0].message, /unsaved-apply-guard\.txt has unsaved changes/);
			await vscode.commands.executeCommand('workbench.action.files.revert');
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			fs.rmSync(file, { force: true });
		}
	});

	test('a dirty file outside the workspace does not block an apply', async () => {
		const outside = path.join(path.dirname(fs.mkdtempSync(path.join(os.tmpdir(), 'entire-outside-'))), `outside-${Date.now()}.txt`);
		fs.writeFileSync(outside, 'one\n');
		try {
			const document = await vscode.workspace.openTextDocument(outside);
			const editor = await vscode.window.showTextDocument(document);
			await editor.edit(edit => edit.insert(new vscode.Position(0, 0), 'x'));
			assert.deepStrictEqual(unsavedFiles(), []);
			await vscode.commands.executeCommand('workbench.action.files.revert');
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			fs.rmSync(outside, { force: true });
		}
	});

	test('disposing what was pushed on the extension context at deactivation kills a running watch', async function () {
		this.timeout(20000);
		const rig = depthRig({ watchLines: ['{"event":"ready"}'] });
		const registered: string[] = [];
		const disposed: string[] = [];
		const commands = vscode.commands as { registerCommand: typeof vscode.commands.registerCommand };
		const original = commands.registerCommand;
		commands.registerCommand = ((id: string) => {
			registered.push(id);
			return { dispose: () => disposed.push(id) };
		}) as typeof vscode.commands.registerCommand;
		const context = { subscriptions: [] as { dispose(): unknown }[] } as unknown as vscode.ExtensionContext;
		try {
			registerTrailDepthCommands(context, { ...rig.deps, retryThreads: () => undefined });
		} finally {
			commands.registerCommand = original;
		}

		const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')) as { contributes: { commands: { command: string }[] } };
		const contributed = new Set(manifest.contributes.commands.map(command => command.command));
		assert.strictEqual(registered.length, 19);
		assert.ok(registered.every(id => contributed.has(id)), 'every registered command is contributed');
		assert.ok(context.subscriptions.includes(rig.watch), 'the watch is pushed on the context');
		assert.strictEqual(context.subscriptions.length, 20, 'every command and the watch');

		assert.deepStrictEqual(await rig.watch.start(CHANGE_SELECTOR), { kind: 'started' });
		await until(() => rig.watch.stateOf('entirely-vscode/17')?.kind === 'watching', 'ready');
		await until(() => rig.cli.watchRunning(), 'the process to run');

		for (const subscription of context.subscriptions) {
			subscription.dispose();
		}
		await until(() => !rig.cli.watchRunning(), 'the process to be gone');
		assert.strictEqual(rig.watch.count, 0);
		assert.strictEqual(disposed.length, 19);
		assert.deepStrictEqual(rig.ended, [], 'deactivation is silent');
	});
});
