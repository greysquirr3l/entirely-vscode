import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
	approveChange,
	checkoutChange,
	commentOnChange,
	linkBranch,
	mergeChange,
	unlinkBranch,
	type TrailReviewDependencies,
} from '../commands/trailReview';
import { CliRunner } from '../services/cli/runner';
import { TrailService } from '../services/trailService';
import { MERGE_PLAN, fakeTrailCli, invocations } from './support/trailCli';

/** The answers the editor gives to the prompts of a flow. */
interface Answers {
	/** Which entry of the quick pick is chosen. */
	readonly pick?: number;
	/** The label the confirmation is answered with. */
	readonly confirm?: string;
	/** The text the input box is answered with. */
	readonly input?: string;
}

/**
 * Answers the prompts of a flow and records what the extension said.
 *
 * The messages are recorded so that a test can say that the
 * confirmation named the merge, or that the refusal named the file.
 * The hook is called as each confirmation is shown, so that a test can
 * say what the CLI had been asked at that moment — which is how the
 * order of a confirm and a merge is proved.
 */
async function withPrompts(
	answers: Answers,
	run: () => Promise<void>,
	onConfirm?: () => void,
): Promise<{
	readonly warnings: readonly string[];
	readonly errors: readonly string[];
	readonly infos: readonly string[];
}> {
	const quickPick = vscode.window.showQuickPick;
	const warning = vscode.window.showWarningMessage;
	const information = vscode.window.showInformationMessage;
	const error = vscode.window.showErrorMessage;
	const inputBox = vscode.window.showInputBox;

	const warnings: string[] = [];
	const errors: string[] = [];
	const infos: string[] = [];

	const window = vscode.window as unknown as Record<string, unknown>;

	window.showQuickPick = async (items: unknown) => {
		const list = items as { pick: unknown }[] | undefined;

		if (!list || answers.pick === undefined) {
			return undefined;
		}

		return list[answers.pick];
	};
	window.showWarningMessage = async (message: string) => {
		warnings.push(message);
		onConfirm?.();
		return answers.confirm;
	};
	window.showInformationMessage = async (message: string) => {
		infos.push(message);
		return undefined;
	};
	window.showErrorMessage = async (message: string) => {
		errors.push(message);
		return undefined;
	};
	window.showInputBox = async () => answers.input;

	try {
		await run();
	} finally {
		window.showQuickPick = quickPick;
		window.showWarningMessage = warning;
		window.showInformationMessage = information;
		window.showErrorMessage = error;
		window.showInputBox = inputBox;
	}

	return { warnings, errors, infos };
}

/** The dependencies a flow needs, bound to a fake CLI. */
function dependenciesFor(runner: CliRunner): TrailReviewDependencies {
	return {
		trails: new TrailService({
			runner,
			workspaceRoot: () => undefined,
			actingHandle: () => 'greysquirr3l',
		}),
		actingHandle: () => 'greysquirr3l',
	};
}

suite('Entire trail review flow', function () {
	this.timeout(30_000);

	test('the review commands are registered', async () => {
		const extension = vscode.extensions.getExtension('greysquirr3l.entirely');
		assert.ok(extension, 'the extension was not loaded by the test host');
		await extension.activate();

		const commands = await vscode.commands.getCommands(true);

		for (const command of [
			'entirely.trailApprove',
			'entirely.trailComment',
			'entirely.trailMerge',
			'entirely.trailCheckout',
			'entirely.trailLink',
			'entirely.trailUnlink',
		]) {
			assert.ok(commands.includes(command), `the command '${command}' was not registered`);
		}
	});

	test('a merge confirms first and names what is being merged', async () => {
		const { runner, log } = fakeTrailCli();

		// What the CLI had been asked at the moment the reviewer was
		// asked to confirm. The merge must not be among it.
		let askedAtConfirm: readonly string[] = [];

		const { warnings } = await withPrompts(
			{ pick: 0, confirm: 'Merge' },
			() => mergeChange(dependenciesFor(runner)),
			() => {
				askedAtConfirm = invocations(log);
			},
		);

		const mergedAtConfirm = askedAtConfirm.filter(
			line => line.startsWith('trail merge') && !line.includes('--dry-run'),
		);

		assert.strictEqual(mergedAtConfirm.length, 0, 'the merge ran before the reviewer confirmed');

		assert.strictEqual(warnings.length, 1, 'the reviewer was not asked to confirm');
		assert.match(warnings[0], /shape-probe/);
		assert.match(warnings[0], /main/);
		assert.match(warnings[0], /0e8af92/);
		assert.match(warnings[0], /entirely-vscode\/17/);

		const merged = invocations(log).filter(
			line => line.startsWith('trail merge') && !line.includes('--dry-run'),
		);

		assert.strictEqual(merged.length, 1, 'the merge did not happen after the confirmation');
	});

	test('a merge that is not confirmed does not happen', async () => {
		const { runner, log } = fakeTrailCli();

		await withPrompts({ pick: 0 }, () => mergeChange(dependenciesFor(runner)));

		const merged = invocations(log).filter(
			line => line.startsWith('trail merge') && !line.includes('--dry-run'),
		);

		assert.strictEqual(merged.length, 0, 'the merge happened without a confirmation');
	});

	test('a merge that is confirmed does happen', async () => {
		const { runner, log } = fakeTrailCli();

		await withPrompts({ pick: 0, confirm: 'Merge' }, () => mergeChange(dependenciesFor(runner)));

		const merged = invocations(log).filter(
			line => line.startsWith('trail merge') && !line.includes('--dry-run'),
		);

		assert.strictEqual(merged.length, 1, 'the merge did not happen after the confirmation');
	});

	test('a merge the CLI refuses is not attempted', async () => {
		const { runner, log } = fakeTrailCli({
			merge: JSON.stringify({ ...MERGE_PLAN, mergeable: false, reasons: ['a gate failed'] }),
		});

		const { warnings } = await withPrompts({ pick: 0, confirm: 'Merge' }, () =>
			mergeChange(dependenciesFor(runner)),
		);

		const merged = invocations(log).filter(
			line => line.startsWith('trail merge') && !line.includes('--dry-run'),
		);

		assert.strictEqual(merged.length, 0, 'a refused merge was attempted anyway');
		assert.match(warnings.join(' '), /a gate failed/);
	});

	test('a merge that exits non-zero is not reported as merged', async () => {
		const { runner } = fakeTrailCli({
			mergeRunFails: true,
			mergeRun: JSON.stringify({ ...MERGE_PLAN, merged: true, dryRun: false }),
		});

		const { infos, errors } = await withPrompts({ pick: 0, confirm: 'Merge' }, () =>
			mergeChange(dependenciesFor(runner)),
		);

		assert.strictEqual(
			infos.filter(message => /merged/i.test(message)).length,
			0,
			'a refused merge was reported as merged',
		);
		assert.ok(errors.length > 0, 'the failed merge was not reported');
	});

	test('a merge whose zero-exit payload has no merged key is reported as merged', async () => {
		const { merged: _omitted, ...withoutMerged } = MERGE_PLAN;
		const { runner } = fakeTrailCli({
			mergeRun: JSON.stringify({ ...withoutMerged, dryRun: false }),
		});

		const { infos, errors } = await withPrompts({ pick: 0, confirm: 'Merge' }, () =>
			mergeChange(dependenciesFor(runner)),
		);

		assert.strictEqual(errors.length, 0, 'a successful merge was reported as failed');
		assert.strictEqual(
			infos.filter(message => /merged/i.test(message)).length,
			1,
			'a successful merge was not reported',
		);
	});

	test('a merge whose payload says merged:false is not reported as merged', async () => {
		const { runner } = fakeTrailCli({
			mergeRun: JSON.stringify({ ...MERGE_PLAN, merged: false, dryRun: false }),
		});

		const { infos, errors } = await withPrompts({ pick: 0, confirm: 'Merge' }, () =>
			mergeChange(dependenciesFor(runner)),
		);

		assert.strictEqual(
			infos.filter(message => /merged/i.test(message)).length,
			0,
			'an unmerged change was reported as merged',
		);
		assert.ok(errors.length > 0, 'the failed merge was not reported');
	});

	test('an untitled buffer does not block a checkout', async () => {
		const { runner, log } = fakeTrailCli();

		const document = await vscode.workspace.openTextDocument({
			language: 'plaintext',
			content: 'scratch notes',
		});
		await vscode.window.showTextDocument(document);
		assert.strictEqual(document.isDirty, true);

		const { errors } = await withPrompts({ pick: 0, confirm: 'Check Out' }, () =>
			checkoutChange(dependenciesFor(runner)),
		);

		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

		assert.strictEqual(errors.length, 0, 'an untitled buffer blocked the checkout');
		assert.strictEqual(
			invocations(log).filter(line => line.startsWith('trail checkout')).length,
			1,
			'the checkout did not happen',
		);
	});

	test('a checkout refuses, with an explanation, when the editor has unsaved changes', async () => {
		const { runner, log } = fakeTrailCli();

		const folder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(folder, 'the test host has no workspace folder');

		const file = vscode.Uri.joinPath(folder.uri, `unsaved-${Date.now()}.txt`);
		await vscode.workspace.fs.writeFile(file, Buffer.from('saved text'));

		const document = await vscode.workspace.openTextDocument(file);
		const editor = await vscode.window.showTextDocument(document);
		await editor.edit(edit => edit.insert(new vscode.Position(0, 0), 'unsaved '));

		// The document is left dirty on purpose: it stands for the work
		// a reviewer has not saved yet.
		assert.strictEqual(document.isDirty, true, 'the document was not left unsaved');

		const { errors } = await withPrompts({ pick: 0, confirm: 'Check Out' }, () =>
			checkoutChange(dependenciesFor(runner)),
		);

		const checkedOut = invocations(log).filter(line => line.startsWith('trail checkout'));

		assert.strictEqual(checkedOut.length, 0, 'the checkout happened with unsaved work');
		assert.ok(errors.length > 0, 'the refusal was not explained');
		assert.match(errors.join(' '), /unsaved changes/);

		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		await vscode.workspace.fs.delete(file);
	});

	test('a dirty file outside the workspace does not block a checkout', async () => {
		const { runner, log } = fakeTrailCli();

		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'entirely-outside-'));
		const file = vscode.Uri.file(path.join(directory, 'notes.txt'));
		fs.writeFileSync(file.fsPath, 'saved text');

		try {
			const document = await vscode.workspace.openTextDocument(file);
			assert.strictEqual(
				vscode.workspace.getWorkspaceFolder(file),
				undefined,
				'the temporary file is inside a workspace folder',
			);

			const editor = await vscode.window.showTextDocument(document);
			await editor.edit(edit => edit.insert(new vscode.Position(0, 0), 'unsaved '));
			assert.strictEqual(document.isDirty, true, 'the document was not left unsaved');

			const { errors } = await withPrompts({ pick: 0, confirm: 'Check Out' }, () =>
				checkoutChange(dependenciesFor(runner)),
			);

			assert.strictEqual(errors.length, 0, 'a file outside the workspace blocked the checkout');
			assert.strictEqual(
				invocations(log).filter(line => line.startsWith('trail checkout')).length,
				1,
				'the checkout did not happen',
			);
		} finally {
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	test('a checkout with no unsaved work asks before it moves the working tree', async () => {
		const { runner, log } = fakeTrailCli();

		const { warnings } = await withPrompts({ pick: 0, confirm: 'Check Out' }, () =>
			checkoutChange(dependenciesFor(runner)),
		);

		assert.strictEqual(warnings.length, 1, 'the reviewer was not asked to confirm');
		assert.match(warnings[0], /shape-probe/);

		const checkedOut = invocations(log).filter(line => line.startsWith('trail checkout'));

		assert.strictEqual(checkedOut.length, 1, 'the checkout did not happen after the confirmation');
	});

	test('an approval is attributed to the login the extension is acting as', async () => {
		const { runner, log } = fakeTrailCli({
			approvals: JSON.stringify({
				approvals: [{ id: 'a1', author: 'greysquirr3l', event: 'approved' }],
			}),
		});

		const { infos } = await withPrompts({ pick: 0 }, () =>
			approveChange(dependenciesFor(runner)),
		);

		assert.strictEqual(infos.length, 1);
		assert.match(infos[0], /approved/);
		assert.match(infos[0], /as greysquirr3l/, 'the approval was not attributed to the acting login');

		const asked = invocations(log);

		assert.ok(
			asked.some(line => line.startsWith('trail approve')),
			'the CLI was not asked to approve',
		);
	});

	test('a comment is recorded through the CLI', async () => {
		const { runner, log } = fakeTrailCli({
			comments: JSON.stringify({
				items: [
					{
						id: 'c1',
						resolved: false,
						lastMessageAuthor: 'greysquirr3l',
						messageCount: 1,
					},
				],
			}),
		});

		const { infos } = await withPrompts({ pick: 0, input: 'this needs a change' }, () =>
			commentOnChange(dependenciesFor(runner)),
		);

		assert.strictEqual(infos.length, 1);
		assert.match(infos[0], /as greysquirr3l/, 'the comment was not attributed to the acting login');

		const asked = invocations(log);

		assert.ok(
			asked.some(line => line.startsWith('trail comment add')),
			'the CLI was not asked to comment',
		);
		assert.ok(
			asked.some(line => line.includes('this needs a change')),
			'the comment body was not passed to the CLI',
		);
	});

	test('a branch is linked to a trail through the CLI', async () => {
		const { runner, log } = fakeTrailCli();

		await withPrompts({ pick: 0, input: 'shape-probe', confirm: 'Link' }, () =>
			linkBranch(dependenciesFor(runner)),
		);

		const asked = invocations(log);

		assert.ok(
			asked.some(line => line.startsWith('trail link')),
			'the CLI was not asked to link',
		);
		assert.ok(
			asked.some(line => line.includes('shape-probe')),
			'the branch was not passed to the CLI',
		);
	});
	test('an approval the CLI recorded under another login is not claimed', async () => {
		const { runner } = fakeTrailCli({
			approvals: JSON.stringify({
				approvals: [{ id: 'a1', author: 'someone-else', event: 'approved' }],
			}),
		});

		const { infos } = await withPrompts({ pick: 0 }, () =>
			approveChange(dependenciesFor(runner)),
		);

		assert.strictEqual(infos.length, 0, 'someone else\'s approval was reported as the reviewer\'s');
	});

	test('a comment the CLI did not record under the acting login is not reported as landed', async () => {
		const { runner } = fakeTrailCli({
			comments: JSON.stringify({
				items: [{ id: 'c1', resolved: false, lastMessageAuthor: 'someone-else', messageCount: 1 }],
			}),
		});

		const { infos } = await withPrompts({ pick: 0, input: 'looks off' }, () =>
			commentOnChange(dependenciesFor(runner)),
		);

		assert.strictEqual(infos.length, 0);
	});

	test('a branch is unlinked from a trail only after confirmation', async () => {
		const declined = fakeTrailCli();

		await withPrompts({ pick: 0, input: 'shape-probe', confirm: undefined }, () =>
			unlinkBranch(dependenciesFor(declined.runner)),
		);

		assert.ok(
			!invocations(declined.log).some(line => line.startsWith('trail unlink')),
			'the branch was unlinked without a confirmation',
		);

		const accepted = fakeTrailCli();

		await withPrompts({ pick: 0, input: 'shape-probe', confirm: 'Unlink' }, () =>
			unlinkBranch(dependenciesFor(accepted.runner)),
		);

		const asked = invocations(accepted.log).filter(line => line.startsWith('trail unlink'));

		assert.strictEqual(asked.length, 1);
		assert.ok(asked[0].includes('shape-probe'), 'the branch was not passed to the CLI');
	});
});
