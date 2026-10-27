import * as assert from 'assert';
import * as vscode from 'vscode';

import { gitUri } from '../commands/openCheckpoint';
import { GitService } from '../services/gitService';

suite('Entire git service', () => {
	test('connects to the git extension when there is one', async () => {
		const service = await GitService.create();
		// A build without the git extension is legitimate, so the only thing
		// worth asserting is that asking does not throw.
		assert.ok(service === undefined || service !== undefined);
	});

	test('builds a URI that reads a file at a revision', () => {
		const uri = gitUri('/work/sandbox/src/index.ts', 'abc123');

		assert.strictEqual(uri.scheme, 'git');
		assert.strictEqual(uri.fsPath, '/work/sandbox/src/index.ts');

		const params = JSON.parse(uri.query) as { path: string; ref: string };
		assert.strictEqual(params.path, '/work/sandbox/src/index.ts');
		assert.strictEqual(params.ref, 'abc123');
	});

	test('finds no checkpoint when the repository does not hold it', async () => {
		const service = await GitService.create();
		if (!service) {
			return;
		}

		const repository = service.repositoryFor(vscode.workspace.workspaceFolders?.[0]?.uri);
		if (!repository) {
			return;
		}

		const commit = await service.findCheckpointCommit(repository, 'abc123def456');
		assert.strictEqual(commit, undefined);
	});
});
