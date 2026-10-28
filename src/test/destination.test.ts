import * as assert from 'assert';

import {
	canSeeRepo,
	decodeEntireSettings,
	decodeRepoIdentity,
	decodeVisibleRepos,
	describeCheckpointProblem,
	describeDestination,
	parseForgeRef,
	resolveCheckpointDestination,
	unwrap,
	type EntireSettings,
	type WorkspaceStatus,
} from '../lib/entire';

/**
 * The payloads the CLI actually prints, captured from a real CLI.
 *
 * Each fixture is the verbatim shape, including the places where the CLI
 * names a forge with a prefix that is not the provider's name.
 */
const MIRROR_REPO = {
	repo: '/gh/greysquirr3l/entirely-vscode',
	private: false,
	status: 'ready',
	placements: [
		{
			cluster: 'aws-us-east-2.entire.io',
			clusterSlug: 'aws-us-east-2',
			jurisdiction: 'us',
			status: 'ready',
			cloneUrl: 'entire://aws-us-east-2.entire.io/gh/greysquirr3l/entirely-vscode',
		},
	],
	repoId: '01M61360NN0CNTBWPZJFEN1BWB',
	apiUrl: 'https://aws-us-east-2.api.entire.io',
};

const NATIVE_REPO = {
	$schema: 'https://us.auth.entire.io/api/v1/schemas/Repo.json',
	apiUrl: 'https://aws-us-east-2.api.entire.io',
	clusterHost: 'aws-us-east-2.entire.io',
	clusterSlug: 'aws-us-east-2',
	id: '01M61HPFNB5EBRH9QXAJXFD8XA',
	name: 'entirely-forge-probe',
	owningProjectId: '01M61HP7KRZK8RVD0MGMJB1YPA',
	path: '/et/entirely-lab/entirely-forge-probe',
	private: true,
	project: 'entirely-lab',
	provider: 'entire',
	repo: '/et/entirely-lab/entirely-forge-probe',
	state: 'active',
	status: 'ready',
	visibility: 'private',
};

const MIRROR_LIST = [
	MIRROR_REPO,
	{
		repo: '/gh/Smart-Offices-Inc/parlance',
		private: true,
		status: 'available',
		access: 'admin',
	},
];

/** A tracked workspace, as the CLI reports it. */
function tracked(extra: Record<string, unknown> = {}): WorkspaceStatus {
	return {
		kind: 'tracked',
		enabled: true,
		agents: ['Copilot CLI'],
		activeSessions: [],
		...extra,
	};
}

suite('Entire repository references', () => {
	test('reads a GitHub repository the way the CLI writes it', () => {
		const ref = parseForgeRef('/gh/greysquirr3l/entirely-vscode');
		assert.ok(ref, 'the reference was not read');
		assert.strictEqual(ref?.forge, 'github');
		assert.strictEqual(ref?.namespace, 'greysquirr3l');
		assert.strictEqual(ref?.name, 'entirely-vscode');
		assert.strictEqual(ref?.path, '/gh/greysquirr3l/entirely-vscode');
	});

	test('reads an Entire-native repository the way the CLI writes it', () => {
		const ref = parseForgeRef('/et/entirely-lab/entirely-forge-probe');
		assert.ok(ref, 'the reference was not read');
		assert.strictEqual(ref?.forge, 'entire');
		assert.strictEqual(ref?.namespace, 'entirely-lab');
		assert.strictEqual(ref?.name, 'entirely-forge-probe');
	});

	test('reads a reference written without its leading slash', () => {
		const ref = parseForgeRef('gh/greysquirr3l/entirely-vscode');
		assert.strictEqual(ref?.forge, 'github');
		assert.strictEqual(ref?.path, '/gh/greysquirr3l/entirely-vscode');
	});

	test('refuses a reference it does not understand', () => {
		assert.strictEqual(parseForgeRef('entirely-vscode'), undefined);
		assert.strictEqual(parseForgeRef('/gh/only-one-part'), undefined);
		assert.strictEqual(parseForgeRef('/xx/owner/repo'), undefined);
	});
});

suite('Entire repository identity', () => {
	test('decodes a mirrored repository', () => {
		const identity = unwrap(decodeRepoIdentity(MIRROR_REPO));
		assert.strictEqual(identity.ref.forge, 'github');
		assert.strictEqual(identity.ref.path, '/gh/greysquirr3l/entirely-vscode');
		assert.strictEqual(identity.private, false);
	});

	test('decodes an Entire-native repository', () => {
		const identity = unwrap(decodeRepoIdentity(NATIVE_REPO));
		assert.strictEqual(identity.ref.forge, 'entire');
		assert.strictEqual(identity.ref.path, '/et/entirely-lab/entirely-forge-probe');
		assert.strictEqual(identity.private, true);
		assert.strictEqual(identity.visibility, 'private');
	});

	test('reports a repository it cannot name', () => {
		const result = decodeRepoIdentity({ repo: 'not-a-reference' });
		assert.strictEqual(result.ok, false);
	});

	test('reports a payload that is not an object', () => {
		const result = decodeRepoIdentity('a string');
		assert.strictEqual(result.ok, false);
	});
});

suite('Entire visible repositories', () => {
	test('decodes the repositories the CLI lists', () => {
		const repos = unwrap(decodeVisibleRepos(MIRROR_LIST));
		assert.strictEqual(repos.length, 2);
		assert.strictEqual(repos[0].ref.forge, 'github');
		assert.strictEqual(repos[0].status, 'ready');
		assert.strictEqual(repos[1].access, 'admin');
	});

	test('decodes an empty list', () => {
		const repos = unwrap(decodeVisibleRepos([]));
		assert.strictEqual(repos.length, 0);
	});

	test('reports a list that is not an array', () => {
		const result = decodeVisibleRepos({ items: [] });
		assert.strictEqual(result.ok, false);
	});

	test('knows a repository the login can reach', () => {
		const repos = unwrap(decodeVisibleRepos(MIRROR_LIST));
		const ref = parseForgeRef('/gh/greysquirr3l/entirely-vscode');
		assert.ok(ref);
		assert.strictEqual(canSeeRepo(repos, ref), true);
	});

	test('knows a repository the login cannot reach', () => {
		const repos = unwrap(decodeVisibleRepos(MIRROR_LIST));
		const ref = parseForgeRef('/gh/greysquirr3l/entirely-vscode-checkpoints');
		assert.ok(ref);
		assert.strictEqual(canSeeRepo(repos, ref), false);
	});

	test('ignores the case of an owner', () => {
		const repos = unwrap(decodeVisibleRepos(MIRROR_LIST));
		const ref = parseForgeRef('/gh/Greysquirr3l/entirely-vscode');
		assert.ok(ref);
		assert.strictEqual(canSeeRepo(repos, ref), true);
	});
});

suite('Entire checkpoint destination', () => {
	test('reads checkpoints that go to this repository', () => {
		const destination = resolveCheckpointDestination(
			tracked({ checkpointSyncRemote: 'origin', checkpointSyncRemoteSource: 'default' }),
			{},
		);

		assert.deepStrictEqual(destination, {
			kind: 'same-repo',
			remote: 'origin',
			source: 'default',
		});
	});

	test('reads checkpoints that go to a repository of their own', () => {
		const settings: EntireSettings = {
			checkpointRemote: { provider: 'github', repo: 'greysquirr3l/entirely-vscode-checkpoints' },
		};

		const destination = resolveCheckpointDestination(
			tracked({
				checkpointSyncRemote: 'greysquirr3l/entirely-vscode-checkpoints',
				checkpointSyncRemoteSource: 'dedicated',
			}),
			settings,
		);

		assert.deepStrictEqual(destination, {
			kind: 'dedicated',
			repo: 'greysquirr3l/entirely-vscode-checkpoints',
			provider: 'github',
			source: 'dedicated',
		});
	});

	test('reads checkpoints that stay on the machine', () => {
		const destination = resolveCheckpointDestination(
			tracked({ checkpointPushDisabled: true }),
			{},
		);

		assert.deepStrictEqual(destination, { kind: 'local-only' });
	});

	test('says it does not know when the CLI did not name a destination', () => {
		const destination = resolveCheckpointDestination(tracked(), {});

		assert.deepStrictEqual(destination, {
			kind: 'unknown',
			reason: 'The Entire CLI did not say where checkpoints are being uploaded.',
		});
	});

	test('says nothing about a workspace that is not tracked', () => {
		const status: WorkspaceStatus = { kind: 'not-set-up', enabled: false, reason: 'not set up' };
		assert.strictEqual(resolveCheckpointDestination(status, {}), undefined);
	});

	test('says it does not know about a destination it does not recognise', () => {
		const destination = resolveCheckpointDestination(
			tracked({ checkpointSyncRemote: 'origin', checkpointSyncRemoteSource: 'something-new' }),
			{},
		);

		assert.deepStrictEqual(destination, {
			kind: 'unknown',
			reason:
				'The Entire CLI reported a checkpoint destination this extension does not understand: "something-new".',
		});
	});

	test('describes each destination the way the user would', () => {
		assert.strictEqual(describeDestination({ kind: 'local-only' }), 'this machine only');
		assert.strictEqual(
			describeDestination({ kind: 'same-repo', remote: 'origin', source: 'default' }),
			'the `origin` remote of this repository',
		);
		assert.strictEqual(
			describeDestination({
				kind: 'dedicated',
				repo: 'owner/checkpoints',
				provider: 'github',
				source: 'dedicated',
			}),
			'the dedicated checkpoint repository owner/checkpoints',
		);
	});
});

suite('Entire checkpoint remote settings', () => {
	test('reads the repository checkpoints are uploaded to', () => {
		const settings = unwrap(
			decodeEntireSettings({
				enabled: true,
				strategy_options: {
					checkpoint_remote: { provider: 'github', repo: 'owner/checkpoints' },
				},
			}),
		);

		assert.deepStrictEqual(settings.checkpointRemote, {
			provider: 'github',
			repo: 'owner/checkpoints',
		});
	});

	test('leaves out a provider it does not know', () => {
		const settings = unwrap(
			decodeEntireSettings({
				strategy_options: {
					checkpoint_remote: { provider: 'bitbucket', repo: 'owner/checkpoints' },
				},
			}),
		);

		assert.deepStrictEqual(settings.checkpointRemote, { repo: 'owner/checkpoints' });
	});

	test('leaves the repository out when there is none', () => {
		const settings = unwrap(decodeEntireSettings({ enabled: true }));
		assert.strictEqual(settings.checkpointRemote, undefined);
	});
});

suite('Entire checkpoint problem', () => {
	test('says that checkpoints on this machine will not reach Entire', () => {
		assert.strictEqual(
			describeCheckpointProblem({ kind: 'local-only' }),
			'Checkpoints stay on this machine, so they will not appear on Entire.',
		);
	});

	test('says why it could not tell when it could not tell', () => {
		assert.strictEqual(
			describeCheckpointProblem({ kind: 'unknown', reason: 'the CLI said nothing' }),
			'the CLI said nothing',
		);
	});

	test('says nothing about a destination that is known and is somewhere reachable', () => {
		assert.strictEqual(
			describeCheckpointProblem({
				kind: 'dedicated',
				repo: 'owner/checkpoints',
				provider: 'github',
				source: 'dedicated',
			}),
			undefined,
		);
	});
});

suite('Entire checkpoint destination wording', () => {
	test('describes an unknown destination as unknown', () => {
		assert.strictEqual(
			describeDestination({ kind: 'unknown', reason: 'the CLI said nothing' }),
			'an unknown destination',
		);
	});
});
