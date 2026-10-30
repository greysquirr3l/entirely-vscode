import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import {
	API_METHODS,
	API_WANTS,
	DELETE_WANTS,
	GRANT_WANTS,
	REPO_LIST_WANTS,
	apiArguments,
	apiConfirmation,
	confirmationFor,
	createRepositoryArguments,
	decodeAccessGrants,
	decodeControlClusters,
	decodeControlRepositories,
	decodeOrganisations,
	decodeProjects,
	deleteArguments,
	describeActingLogin,
	describeControlOutcome,
	editVisibilityArguments,
	grantAddArguments,
	grantHandle,
	grantIsFor,
	grantListArguments,
	grantRemoveArguments,
	isApiPath,
	isControlOperand,
	isGrantee,
	isReadMethod,
	isRepositoryName,
	listArguments,
	pickFlags,
	readChoices,
	repoListArguments,
	repositoryPath,
	unwrap,
	type AccessGrant,
	type ControlAction,
} from '../lib/entire';
import {
	createRepository,
	deleteOrganisation,
	deleteProject,
	deleteRepository,
	formatApiBody,
	grantAccess,
	revokeAccess,
	runApiCall,
	setRepositoryVisibility,
} from '../commands/controlPlane';
import { ControlPlaneProvider, type ControlNode } from '../providers/controlPlaneProvider';
import { clampControlPlaneTimeout } from '../services/configuration';
import {
	ALICE,
	CLUSTERS,
	HELPS,
	ORGS,
	PROJECTS,
	WIDGET_REPOS,
	WIDGET_REPOS_WITHOUT_WEB,
	depsFor,
	fakeControlCli,
	fakeUi,
	serviceFor,
} from './support/controlPlaneCli';

const WEB: ControlNode = {
	kind: 'repository',
	repository: { id: 'R1', name: 'web', project: 'widgets', provider: 'entire', visibility: 'private' },
};
const PROJECT_NODE: ControlNode = { kind: 'project', project: { id: 'PRJ1', name: 'widgets', repositoryCount: 2 } };
const ORG_NODE: ControlNode = { kind: 'organisation', organisation: { id: 'ORG1', name: 'Acme' } };

const READS = {
	org_list: ORGS,
	project_list: PROJECTS,
	repo_list_widgets: WIDGET_REPOS,
	cluster_list: CLUSTERS,
};

suite('Control plane payloads', () => {
	test('reads organisations, projects and clusters as the CLI prints them', () => {
		const orgs = unwrap(decodeOrganisations(JSON.parse(ORGS)));
		assert.deepStrictEqual(orgs.map(org => [org.id, org.name, org.canDelete]), [['ORG1', 'Acme', true]]);
		const projects = unwrap(decodeProjects(JSON.parse(PROJECTS)));
		assert.deepStrictEqual(projects.map(project => [project.name, project.repositoryCount]), [['widgets', 2], ['sandbox', 0]]);
		assert.strictEqual(unwrap(decodeControlClusters(JSON.parse(CLUSTERS)))[0].isDefault, true);
	});

	test('skips a row without a name and keeps the rest', () => {
		const projects = unwrap(decodeProjects([{ id: 'x' }, { id: 'y', name: 'kept' }, 'junk', null]));
		assert.deepStrictEqual(projects.map(project => project.name), ['kept']);
	});

	test('reads a paged envelope as well as a bare array, and refuses anything else', () => {
		assert.strictEqual(unwrap(decodeControlRepositories({ items: JSON.parse(WIDGET_REPOS), nextPageToken: 'x' }, 'widgets')).length, 2);
		assert.throws(() => unwrap(decodeOrganisations({ nothing: true })));
		assert.throws(() => unwrap(decodeAccessGrants('text')));
	});

	test('a repository is addressed by a path only when it is Entire-native', () => {
		const repositories = unwrap(decodeControlRepositories(JSON.parse(WIDGET_REPOS), 'widgets'));
		assert.strictEqual(repositoryPath(repositories[0]), '/et/widgets/web');
		assert.strictEqual(repositoryPath({ project: 'p', name: 'm', provider: 'github' }), undefined);
		assert.strictEqual(repositoryPath({ project: 'p', name: 'n' }), '/et/p/n');
	});

	test('grants are matched by handle with or without the provider, and revoked by a qualified handle', () => {
		const grants = unwrap(decodeAccessGrants([
			{ granteeId: 'U1', granteeName: 'github:alice', role: 'admin', source: 'repo' },
			{ granteeId: 'U2', role: 'reader', source: 'inherited from project' },
			{ role: 'reader' },
		]));
		assert.strictEqual(grants.length, 2);
		assert.ok(grantIsFor(grants[0], 'github:alice'));
		assert.ok(grantIsFor(grants[0], 'alice'));
		assert.ok(!grantIsFor(grants[1], 'github:alice'));
		assert.strictEqual(grantHandle(grants[0]), 'github:alice');
		assert.strictEqual(grantHandle(grants[1]), undefined);
	});

	test('operands, grantees, names and api paths that could be misread are refused', () => {
		assert.ok(isControlOperand('/et/widgets/web'));
		assert.ok(isControlOperand('gh:mirrors:01M612'));
		assert.ok(!isControlOperand('--cascade'));
		assert.ok(!isControlOperand('two words'));
		assert.ok(!isControlOperand(''));
		assert.ok(isGrantee('github:alice'));
		assert.ok(!isGrantee('alice'));
		assert.ok(!isGrantee('github:-x'));
		assert.ok(isRepositoryName('web-2.0'));
		assert.ok(!isRepositoryName('-web'));
		assert.ok(isApiPath('/api/v1/clusters'));
		assert.ok(isApiPath('/api/v1/me/recap?repo={repo_id}'));
		assert.ok(!isApiPath('https://example.com/x'));
		assert.ok(!isApiPath('//example.com/x'));
		assert.ok(!isApiPath('api/v1'));
		assert.ok(!isApiPath('/a b'));
		assert.ok(!isApiPath('/api/../x'));
		assert.ok(!isApiPath('/api/./x'));
		assert.ok(!isApiPath('/api/%2e%2E/x'));
		assert.ok(!isApiPath('/api/%2E/x'));
		assert.ok(!isApiPath('/api/.%2e/x'));
		assert.ok(!isApiPath('/..'));
		assert.ok(!isApiPath('/\\host'));
		assert.ok(!isApiPath('/api\\x'));
		assert.ok(isApiPath('/api/v1/file.name/..x'));
	});
});

suite('Control plane flags from the CLI help', () => {
	test('picks each flag by what its help line says', () => {
		const del = pickFlags('repo delete', HELPS.repo_delete, [], DELETE_WANTS);
		assert.ok(del.ok);
		assert.strictEqual(del.flags.skipPrompt, '--force');
		assert.strictEqual(del.flags.cascade, '--cascade');

		const list = pickFlags('repo list', HELPS.repo_list, [], REPO_LIST_WANTS);
		assert.ok(list.ok);
		assert.deepStrictEqual([list.flags.json, list.flags.project, list.flags.all], ['--json', '--project', '--all']);
	});

	test('follows a CLI that renames its flags, and never uses a name the help does not list', () => {
		const renamed = `Flags:
      --assume-yes   Skip the confirmation prompt
      --with-mirrors  Also delete the repo's mirrors on other clusters
`;
		const picked = pickFlags('repo delete', renamed, [], DELETE_WANTS);
		assert.ok(picked.ok);
		assert.strictEqual(picked.flags.skipPrompt, '--assume-yes');
		assert.strictEqual(picked.flags.cascade, '--with-mirrors');
		assert.deepStrictEqual(deleteArguments('repo', '--assume-yes', undefined, '/et/p/r'), ['repo', 'delete', '--assume-yes', '--', '/et/p/r']);
	});

	test('a required flag the help does not describe stops the call and names the command', () => {
		const missing = pickFlags('repo delete', 'Flags:\n      --cascade   Also delete the repo\'s mirrors on other clusters\n', [], DELETE_WANTS);
		assert.ok(!missing.ok);
		assert.match(missing.detail, /skipPrompt flag of 'repo delete'/);
		assert.match(missing.detail, /update the CLI/);
	});

	test('reads the values a flag takes from its help line', () => {
		assert.deepStrictEqual(readChoices('Role: one of reader, writer, admin (required; asked for if omitted on a terminal)'), ['reader', 'writer', 'admin']);
		assert.deepStrictEqual(readChoices('Visibility to set: public or private (required)'), ['public', 'private']);
		assert.deepStrictEqual(readChoices('which backend to call: core or cell (default "core")'), ['core', 'cell']);
		assert.deepStrictEqual(readChoices('Role: one of owner, admin, member (default member)'), ['owner', 'admin', 'member']);
		assert.deepStrictEqual(readChoices('Output raw JSON instead of a table'), []);
		assert.deepStrictEqual(readChoices('HTTP method (default GET, or POST when a field/body is given)'), []);
	});

	test('argument builders put flags first, values after =, and operands after the end of options', () => {
		assert.deepStrictEqual(repoListArguments({ json: '--json', project: '--project', all: '--all' }, 'widgets'), ['repo', 'list', '--json', '--all', '--project=widgets']);
		assert.deepStrictEqual(listArguments('org', '--json'), ['org', 'list', '--json']);
		assert.deepStrictEqual(grantListArguments('repo', '--json', '/et/p/r'), ['repo', 'grant', 'list', '--json', '--', '/et/p/r']);
		assert.deepStrictEqual(deleteArguments('repo', '--force', '--cascade', '/et/p/r'), ['repo', 'delete', '--force', '--cascade', '--', '/et/p/r']);
		assert.deepStrictEqual(createRepositoryArguments({ project: '--project', visibility: '--visibility' }, 'p', 'web', 'public'), ['repo', 'create', '--project=p', '--visibility=public', '--', 'web']);
		assert.deepStrictEqual(editVisibilityArguments('--visibility', 'private', '/et/p/r'), ['repo', 'edit', '--visibility=private', '--', '/et/p/r']);
		assert.deepStrictEqual(grantAddArguments('project', '--role', 'reader', 'widgets', 'github:alice'), ['project', 'grant', 'add', '--role=reader', '--', 'widgets', 'github:alice']);
		assert.deepStrictEqual(grantRemoveArguments('org', 'Acme', 'github:alice'), ['org', 'grant', 'remove', '--', 'Acme', 'github:alice']);
	});

	test('the api method flag is passed only for a call that is not a read', () => {
		const flags = { method: '--method', backend: '--to' };
		assert.deepStrictEqual(apiArguments(flags, { method: 'GET', path: '/api/v1/clusters' }), ['api', '--', '/api/v1/clusters']);
		assert.deepStrictEqual(apiArguments(flags, { method: 'delete', path: '/api/v1/x', backend: 'cell' }), ['api', '--method=DELETE', '--to=cell', '--', '/api/v1/x']);
		assert.ok(isReadMethod('get'));
		assert.ok(!isReadMethod('POST'));
		assert.deepStrictEqual([...API_METHODS], ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
		assert.ok(API_WANTS.method.required);
		assert.ok(GRANT_WANTS.role.required);
	});
});

suite('Control plane confirmations', () => {
	const acting = { handle: 'alice', name: 'alice@us.auth.entire.io' };
	const actions: ControlAction[] = [
		{ kind: 'delete-repository', name: 'web', project: 'widgets', path: '/et/widgets/web', cascade: false },
		{ kind: 'delete-repository', name: 'web', project: 'widgets', path: '/et/widgets/web', cascade: true },
		{ kind: 'create-repository', name: 'web', project: 'widgets', visibility: 'public' },
		{ kind: 'set-visibility', name: 'web', project: 'widgets', path: '/et/widgets/web', visibility: 'public', current: 'private' },
		{ kind: 'delete-project', name: 'widgets', id: 'PRJ1', repositoryCount: 2 },
		{ kind: 'delete-organisation', name: 'Acme', id: 'ORG1' },
		{ kind: 'grant', scope: 'repo', target: '/et/widgets/web', grantee: 'github:bob', role: 'writer' },
		{ kind: 'revoke', scope: 'project', target: 'widgets', grantee: 'github:bob' },
	];
	const names = ['/et/widgets/web', '/et/widgets/web', 'widgets', '/et/widgets/web', 'widgets', 'Acme', 'github:bob', 'github:bob'];

	test('every question names what it affects and the login it acts as', () => {
		actions.forEach((action, index) => {
			const prompt = confirmationFor(action, acting);
			assert.ok(`${prompt.message} ${prompt.detail}`.includes(names[index]), `${action.kind} does not name ${names[index]}`);
			assert.ok(prompt.detail.includes('alice (login alice@us.auth.entire.io)'), `${action.kind} does not name the login`);
			assert.ok(prompt.detail.includes('Entire'), `${action.kind} does not say the change is on Entire`);
			assert.ok(prompt.action.length > 0);
		});
	});

	test('a cascading delete says the mirrors go too, and a plain one says the CLI refuses without it', () => {
		assert.match(confirmationFor(actions[1], acting).detail, /mirror of it on other clusters is deleted too/);
		assert.match(confirmationFor(actions[0], acting).detail, /refuses if it has mirrors/);
	});

	test('a project delete says how many repositories it holds', () => {
		assert.match(confirmationFor(actions[4], acting).detail, /holds 2 repositories/);
		assert.match(confirmationFor({ kind: 'delete-project', name: 'p', id: 'x', repositoryCount: 1 }, acting).detail, /holds 1 repository\./);
	});

	test('a login whose name is its handle is named once', () => {
		assert.strictEqual(describeActingLogin({ handle: 'a', name: 'a' }), 'a');
	});

	test('the api question names the method, the path and the login', () => {
		const prompt = apiConfirmation({ method: 'delete', path: '/api/v1/x' }, acting);
		assert.match(prompt.message, /DELETE \/api\/v1\/x/);
		assert.match(prompt.detail, /alice \(login alice@us.auth.entire.io\)/);
	});

	test('each outcome is worded with the login and never claims more than was checked', () => {
		const action = actions[0];
		assert.match(describeControlOutcome(action, { kind: 'done', summary: '' }, acting), /Done: delete the repository \/et\/widgets\/web as alice/);
		assert.match(describeControlOutcome(action, { kind: 'unconfirmed', summary: '', detail: 'no answer' }, acting), /could not be checked: no answer/);
		assert.match(describeControlOutcome(action, { kind: 'failed', detail: 'denied' }, acting), /Could not delete .* as alice .*: denied/);
	});
});

suite('Control plane service', () => {
	test('lists organisations, projects, repositories and clusters from the CLI', async () => {
		const cli = fakeControlCli({ out: READS });
		const service = serviceFor(cli);
		const orgs = await service.organisations();
		const projects = await service.projects();
		const repos = await service.repositories('widgets');
		const clusters = await service.clusters();
		assert.ok(orgs.ok && projects.ok && repos.ok && clusters.ok);
		assert.deepStrictEqual(repos.value.map(repository => repository.name), ['web', 'api']);
		assert.ok(cli.callsTo('repo list').every(line => line.includes('--project=widgets')));
	});

	test('every read passes the help-derived flags and the acting login', async () => {
		const cli = fakeControlCli({ out: READS });
		await serviceFor(cli, 'alice@us.auth.entire.io').repositories('widgets');
		assert.deepStrictEqual(cli.callsTo('repo list'), ['alice@us.auth.entire.io|repo list --json --all --project=widgets']);
	});

	test('a CLI that renames the project flag is followed', async () => {
		const renamed = HELPS.repo_list.replace('--project string      Project to list', '--in-project string   Project to list');
		const cli = fakeControlCli({ helps: { repo_list: renamed }, out: READS });
		const read = await serviceFor(cli).repositories('widgets');
		assert.ok(read.ok);
		assert.ok(cli.callsTo('repo list')[0].includes('--in-project=widgets'));
	});

	test('a missing CLI is said plainly', async () => {
		const read = await serviceFor(fakeControlCli({ noCli: true })).projects();
		assert.ok(!read.ok);
		assert.match(read.detail, /not installed/);
	});

	test('a CLI without the command says so and is not asked to run it', async () => {
		const cli = fakeControlCli({ helps: { project_list: null }, out: READS });
		const read = await serviceFor(cli).projects();
		assert.ok(!read.ok);
		assert.match(read.detail, /no 'project list' command/);
		assert.deepStrictEqual(cli.callsTo('project list'), []);
	});

	test('a refusal from the CLI is reported as the reason, never as an empty list', async () => {
		const cli = fakeControlCli({ out: {} });
		const read = await serviceFor(cli).grants('repo', '/et/widgets/web');
		assert.ok(!read.ok);
		assert.match(read.detail, /permission denied/);
		assert.doesNotMatch(read.detail, /Using context/);
	});

	test('a name that could be read as a flag is not sent', async () => {
		const cli = fakeControlCli({ out: READS });
		const read = await serviceFor(cli).repositories('--all');
		assert.ok(!read.ok);
		assert.deepStrictEqual(cli.calls(), []);
	});

	test('the values for a picker come from the help of the command that takes them', async () => {
		const cli = fakeControlCli();
		const service = serviceFor(cli);
		const roles = await service.choices({ kind: 'role', scope: 'org' });
		assert.ok(roles.ok);
		assert.deepStrictEqual(roles.value, ['owner', 'admin', 'member']);
		const visibility = await service.choices({ kind: 'visibility' });
		assert.ok(visibility.ok);
		assert.deepStrictEqual(visibility.value, ['public', 'private']);
		const none = await serviceFor(fakeControlCli({ helps: { repo_edit: 'Flags:\n      --visibility string   Visibility to set\n' } })).choices({ kind: 'visibility' });
		assert.ok(!none.ok);
		assert.match(none.detail, /does not list the values/);
	});

	test('the timeout setting stays inside its bounds', () => {
		assert.strictEqual(clampControlPlaneTimeout(Number.NaN), 60);
		assert.strictEqual(clampControlPlaneTimeout(1), 5);
		assert.strictEqual(clampControlPlaneTimeout(99999), 900);
		assert.strictEqual(clampControlPlaneTimeout(90.7), 90);
	});
});

suite('Control plane view', () => {
	function providerFor(cli: ReturnType<typeof fakeControlCli>, acting: string | null = 'alice (login alice@us.auth.entire.io)'): ControlPlaneProvider {
		return new ControlPlaneProvider(serviceFor(cli), () => acting ?? undefined);
	}

	test('opening the control plane lists the repositories the acting login can see', async () => {
		const cli = fakeControlCli({ out: { ...READS, repo_list_sandbox: '[]' } });
		const provider = providerFor(cli);
		const root = await provider.getChildren();
		assert.strictEqual(root[0].kind, 'acting');
		assert.match(provider.getTreeItem(root[0]).label as string, /Acting as alice \(login alice@us.auth.entire.io\)/);

		const projectsGroup = root.find(node => node.kind === 'group' && node.group === 'projects');
		assert.ok(projectsGroup);
		const projects = await provider.getChildren(projectsGroup);
		assert.deepStrictEqual(projects.map(node => node.kind === 'project' && node.project.name), ['widgets', 'sandbox']);

		const inWidgets = await provider.getChildren(projects[0]);
		const repositories = inWidgets.filter(node => node.kind === 'repository');
		assert.deepStrictEqual(repositories.map(node => node.kind === 'repository' && node.repository.name), ['web', 'api']);
		assert.ok(inWidgets.some(node => node.kind === 'access'), 'a project offers its access list');
		const item = provider.getTreeItem(repositories[0]);
		assert.strictEqual(item.label, 'web');
		assert.match(String(item.description), /private/);
		assert.strictEqual(item.contextValue, 'entirely.cpRepository');
		provider.dispose();
	});

	test('a project with no repositories says so and a failed read says why, neither as an empty list', async () => {
		const cli = fakeControlCli({ out: { ...READS, repo_list_sandbox: '[]' } });
		const provider = providerFor(cli);
		const empty = await provider.getChildren({ kind: 'project', project: { id: 'PRJ2', name: 'sandbox' } });
		assert.match(provider.getTreeItem(empty[0]).label as string, /No repositories are visible to this login/);

		const failing = providerFor(fakeControlCli({ out: {} }));
		const failed = await failing.getChildren({ kind: 'group', group: 'organisations' });
		assert.match(failed[0].kind === 'message' ? failed[0].text : '', /Could not read the organisations: permission denied/);
		provider.dispose();
		failing.dispose();
	});

	test('with no login the view says to sign in and reads nothing', async () => {
		const cli = fakeControlCli({ out: READS });
		const provider = providerFor(cli, null);
		const root = await provider.getChildren();
		assert.strictEqual(root.length, 1);
		assert.match(root[0].kind === 'message' ? root[0].text : '', /Sign in/);
		assert.deepStrictEqual(cli.calls(), []);
		provider.dispose();
	});

	test('a mirror cannot be managed, and an inherited grant cannot be revoked from the view', async () => {
		const provider = providerFor(fakeControlCli());
		const mirror = provider.getTreeItem({ kind: 'repository', repository: { id: 'M', name: 'm', project: 'p', provider: 'github' } });
		assert.strictEqual(mirror.contextValue, 'entirely.cpRepositoryMirror');
		const grant = (source: string): AccessGrant => ({ granteeName: 'github:a', role: 'reader', source });
		assert.strictEqual(provider.getTreeItem({ kind: 'grant', scope: 'repo', target: 't', grant: grant('inherited from project') }).contextValue, 'entirely.cpGrantInherited');
		assert.strictEqual(provider.getTreeItem({ kind: 'grant', scope: 'repo', target: 't', grant: grant('repo') }).contextValue, 'entirely.cpGrant');
		provider.dispose();
	});

	test('grants of a repository, a project and an organisation are read with their own commands', async () => {
		const cli = fakeControlCli({
			out: {
				repo_grant_list__et_widgets_web: JSON.stringify([{ granteeId: 'U1', granteeName: 'github:bob', role: 'writer', source: 'repo' }]),
				project_grant_list_widgets: '[]',
				org_grant_list_Acme: '[]',
			},
		});
		const provider = providerFor(cli);
		const onRepo = await provider.getChildren(WEB);
		assert.deepStrictEqual(onRepo.map(node => node.kind === 'grant' && node.grant.role), ['writer']);
		await provider.getChildren({ kind: 'access', scope: 'project', target: 'widgets', owner: 'widgets' });
		await provider.getChildren(ORG_NODE);
		assert.strictEqual(cli.callsTo('repo grant list').length, 1);
		assert.strictEqual(cli.callsTo('project grant list').length, 1);
		assert.strictEqual(cli.callsTo('org grant list').length, 1);
		provider.dispose();
	});
});

suite('Deleting a repository', () => {
	const deleteWorld = () =>
		fakeControlCli({ out: READS, after: { 'repo_list_widgets.repo_delete': WIDGET_REPOS_WITHOUT_WEB } });

	test('confirms naming the repository and the login, and deletes only on confirmation', async () => {
		const cli = deleteWorld();
		const ui = fakeUi({ confirms: [true] });
		const result = await deleteRepository(depsFor(cli, ui), WEB);

		assert.strictEqual(result, 'done');
		assert.strictEqual(ui.confirmations.length, 1);
		assert.match(ui.confirmations[0].message, /\/et\/widgets\/web/);
		assert.match(ui.confirmations[0].detail, /alice \(login alice@us.auth.entire.io\)/);
		assert.deepStrictEqual(cli.callsTo('repo delete'), ['alice@us.auth.entire.io|repo delete --force -- /et/widgets/web']);
		assert.match(ui.informed[0], /Done: delete the repository \/et\/widgets\/web as alice/);
	});

	test('a declined confirmation deletes nothing', async () => {
		const cli = deleteWorld();
		const ui = fakeUi({ confirms: [false] });
		const deps = depsFor(cli, ui);
		assert.strictEqual(await deleteRepository(deps, WEB), 'cancelled');
		assert.deepStrictEqual(cli.callsTo('repo delete'), []);
		assert.strictEqual(ui.warned.length + ui.informed.length, 0);
	});

	test('the skip-prompt flag is the one the help describes, not a built-in name', async () => {
		const renamed = HELPS.repo_delete.replace('-f, --force                   Skip the confirmation prompt', '--assume-yes                  Skip the confirmation prompt').replace('-y, --yes ', '--other     ');
		const cli = fakeControlCli({ helps: { repo_delete: renamed }, out: READS, after: { 'repo_list_widgets.repo_delete': WIDGET_REPOS_WITHOUT_WEB } });
		await deleteRepository(depsFor(cli, fakeUi()), WEB);
		assert.deepStrictEqual(cli.callsTo('repo delete'), ['alice@us.auth.entire.io|repo delete --assume-yes -- /et/widgets/web']);
	});

	test('the delete runs as the login that was confirmed even when none is pinned on the runner', async () => {
		const cli = deleteWorld();
		await deleteRepository(depsFor(cli, fakeUi()), WEB);
		assert.ok(cli.callsTo('repo delete')[0].startsWith('alice@us.auth.entire.io|'));
		assert.ok(cli.callsTo('repo list').every(line => line.startsWith('alice@us.auth.entire.io|')), 'the re-check runs as the same login');
	});

	test('success is reported only when a fresh listing no longer has the repository', async () => {
		const cli = fakeControlCli({ out: READS });
		const ui = fakeUi();
		const result = await deleteRepository(depsFor(cli, ui), WEB);
		assert.strictEqual(result, 'failed');
		assert.match(ui.warned[0], /reported success but still lists \/et\/widgets\/web/);
		assert.strictEqual(ui.informed.length, 0);
	});

	test('a change the CLI accepted but whose result cannot be read back is not called done', async () => {
		const cli = fakeControlCli({ out: { project_list: PROJECTS } });
		const ui = fakeUi();
		const result = await deleteRepository(depsFor(cli, ui), WEB);
		assert.strictEqual(result, 'unconfirmed');
		assert.match(ui.warned[0], /could not be checked/);
	});

	test('a failure from the CLI is reported with its own words and changes nothing else', async () => {
		const cli = fakeControlCli({ out: READS, fail: { repo_delete: 'permission denied: you cannot manage this repository' } });
		const ui = fakeUi();
		assert.strictEqual(await deleteRepository(depsFor(cli, ui), WEB), 'failed');
		assert.match(ui.warned[0], /permission denied: you cannot manage this repository/);
		assert.strictEqual(cli.callsTo('repo list').length, 0, 'a refused delete is not re-checked');
	});

	test('a repository with mirrors needs a second, plainer question before the mirrors go', async () => {
		const cli = fakeControlCli({
			out: READS,
			failWithoutCascade: 'repository has mirrors on other clusters; remove them or pass --cascade',
			after: { 'repo_list_widgets.repo_delete': WIDGET_REPOS_WITHOUT_WEB },
		});
		const ui = fakeUi({ confirms: [true, true] });
		const result = await deleteRepository(depsFor(cli, ui), WEB);
		assert.strictEqual(result, 'done');
		assert.strictEqual(ui.confirmations.length, 2);
		assert.match(ui.confirmations[1].detail, /mirror of it on other clusters is deleted too/);
		assert.deepStrictEqual(cli.callsTo('repo delete').map(line => line.includes('--cascade')), [false, true]);
	});

	test('declining the mirrors question leaves the repository and its mirrors alone', async () => {
		const cli = fakeControlCli({ out: READS, failWithoutCascade: 'repository has mirrors on other clusters' });
		const ui = fakeUi({ confirms: [true, false] });
		assert.strictEqual(await deleteRepository(depsFor(cli, ui), WEB), 'cancelled');
		assert.strictEqual(cli.callsTo('repo delete').length, 1);
		assert.match(ui.warned[0], /deleting them was declined/);
	});

	test('a CLI that cannot cascade is not sent a made-up flag', async () => {
		const noCascade = 'Flags:\n  -f, --force   Skip the confirmation prompt\n';
		const cli = fakeControlCli({ helps: { repo_delete: noCascade }, out: READS, fail: { repo_delete: 'repo has mirrors' } });
		const ui = fakeUi();
		assert.strictEqual(await deleteRepository(depsFor(cli, ui), WEB), 'failed');
		assert.strictEqual(cli.callsTo('repo delete').length, 1);
	});

	test('a CLI without a flag that skips its prompt is not run, because its prompt needs a terminal', async () => {
		const cli = fakeControlCli({ helps: { repo_delete: 'Flags:\n      --cascade   Also delete the repo\'s mirrors on other clusters\n' }, out: READS });
		const ui = fakeUi();
		assert.strictEqual(await deleteRepository(depsFor(cli, ui), WEB), 'failed');
		assert.deepStrictEqual(cli.callsTo('repo delete'), []);
		assert.match(ui.warned[0], /update the CLI/);
	});

	test('with no login nothing is asked and nothing runs', async () => {
		const cli = deleteWorld();
		const ui = fakeUi();
		assert.strictEqual(await deleteRepository(depsFor(cli, ui, null), WEB), 'no-login');
		assert.strictEqual(ui.confirmations.length, 0);
		assert.deepStrictEqual(cli.callsTo('repo delete'), []);
		assert.match(ui.warned[0], /Sign in/);
	});

	test('a mirror, or a click that is not on a repository, deletes nothing', async () => {
		const cli = deleteWorld();
		const ui = fakeUi();
		const mirror: ControlNode = { kind: 'repository', repository: { id: 'M', name: 'm', project: 'p', provider: 'github' } };
		assert.strictEqual(await deleteRepository(depsFor(cli, ui), mirror), 'cancelled');
		assert.strictEqual(await deleteRepository(depsFor(cli, ui), undefined), 'cancelled');
		assert.strictEqual(ui.confirmations.length, 0);
		assert.deepStrictEqual(cli.callsTo('repo delete'), []);
	});

	test('a second change is refused while one is running', async () => {
		const cli = deleteWorld();
		const ui = fakeUi();
		const deps = depsFor(cli, ui);
		deps.running.active = true;
		assert.strictEqual(await deleteRepository(deps, WEB), 'busy');
		assert.deepStrictEqual(cli.callsTo('repo delete'), []);
		assert.strictEqual(deps.running.active, true, 'the other change keeps its claim');
	});

	test('the view is refreshed after a change', async () => {
		const deps = depsFor(deleteWorld(), fakeUi());
		await deleteRepository(deps, WEB);
		assert.strictEqual(deps.refreshes, 1);
	});
});

suite('Other control plane changes', () => {
	test('deleting a project confirms with its name and repository count, then checks the project list', async () => {
		const cli = fakeControlCli({ out: READS, after: { 'project_list.project_delete': JSON.stringify([JSON.parse(PROJECTS)[1]]) } });
		const ui = fakeUi();
		assert.strictEqual(await deleteProject(depsFor(cli, ui), PROJECT_NODE), 'done');
		assert.match(ui.confirmations[0].message, /widgets/);
		assert.match(ui.confirmations[0].detail, /holds 2 repositories/);
		assert.deepStrictEqual(cli.callsTo('project delete'), ['alice@us.auth.entire.io|project delete --force -- widgets']);
	});

	test('a project the CLI still lists after a delete is a failure', async () => {
		const cli = fakeControlCli({ out: READS });
		const ui = fakeUi();
		assert.strictEqual(await deleteProject(depsFor(cli, ui), PROJECT_NODE), 'failed');
		assert.match(ui.warned[0], /still lists the project widgets/);
	});

	test('deleting an organisation confirms and re-reads the organisation list', async () => {
		const cli = fakeControlCli({ out: READS, after: { 'org_list.org_delete': '[]' } });
		const ui = fakeUi({ confirms: [false, true] });
		const deps = depsFor(cli, ui);
		assert.strictEqual(await deleteOrganisation(deps, ORG_NODE), 'cancelled');
		assert.deepStrictEqual(cli.callsTo('org delete'), []);
		assert.strictEqual(await deleteOrganisation(deps, ORG_NODE), 'done');
		assert.match(ui.confirmations[1].detail, /Acme/);
		assert.deepStrictEqual(cli.callsTo('org delete'), ['alice@us.auth.entire.io|org delete --force -- Acme']);
	});

	test('creating a repository asks for the name and a visibility the help lists, confirms, and checks the listing', async () => {
		const cli = fakeControlCli({
			out: READS,
			after: { 'repo_list_widgets.repo_create': JSON.stringify([...JSON.parse(WIDGET_REPOS), { id: 'R3', name: 'docs', provider: 'entire', visibility: 'public' }]) },
		});
		const ui = fakeUi({ asks: ['docs'], picks: ['public'] });
		assert.strictEqual(await createRepository(depsFor(cli, ui), PROJECT_NODE), 'done');
		assert.deepStrictEqual(ui.picked[0].values, ['public', 'private']);
		assert.match(ui.confirmations[0].message, /docs.*widgets/);
		assert.deepStrictEqual(cli.callsTo('repo create'), ['alice@us.auth.entire.io|repo create --project=widgets --visibility=public -- docs']);
	});

	test('creating a repository the listing does not then show is a failure', async () => {
		const cli = fakeControlCli({ out: READS });
		const ui = fakeUi({ asks: ['docs'], picks: ['private'] });
		assert.strictEqual(await createRepository(depsFor(cli, ui), PROJECT_NODE), 'failed');
		assert.match(ui.warned[0], /does not list docs in widgets/);
	});

	test('creating from the palette asks which project, and a cancelled prompt creates nothing', async () => {
		const cli = fakeControlCli({ out: READS });
		const ui = fakeUi({ asks: [undefined] });
		assert.strictEqual(await createRepository(depsFor(cli, ui)), 'cancelled');
		assert.deepStrictEqual(cli.callsTo('repo create'), []);
	});

	test('changing visibility offers only the other value, names the current one, and checks the listing', async () => {
		const flipped = JSON.stringify([{ id: 'R1', name: 'web', provider: 'entire', visibility: 'public' }, JSON.parse(WIDGET_REPOS)[1]]);
		const cli = fakeControlCli({ out: READS, after: { 'repo_list_widgets.repo_edit': flipped } });
		const ui = fakeUi({ picks: ['public'] });
		assert.strictEqual(await setRepositoryVisibility(depsFor(cli, ui), WEB), 'done');
		assert.deepStrictEqual(ui.picked[0].values, ['public']);
		assert.match(ui.confirmations[0].detail, /private now/);
		assert.match(ui.confirmations[0].detail, /Every authenticated Entire user/);
		assert.deepStrictEqual(cli.callsTo('repo edit'), ['alice@us.auth.entire.io|repo edit --visibility=public -- /et/widgets/web']);
	});

	test('a visibility the listing still shows as the old one is a failure', async () => {
		const cli = fakeControlCli({ out: READS });
		const ui = fakeUi({ picks: ['public'] });
		assert.strictEqual(await setRepositoryVisibility(depsFor(cli, ui), WEB), 'failed');
		assert.match(ui.warned[0], /lists \/et\/widgets\/web as private/);
	});

	test('granting access validates the grantee, offers the roles the help lists, confirms, and checks the grant list', async () => {
		const granted = JSON.stringify([{ granteeId: 'U9', granteeName: 'github:bob', role: 'writer', source: 'repo' }]);
		const cli = fakeControlCli({ out: { ...READS, repo_grant_list__et_widgets_web: '[]' }, after: { 'repo_grant_list__et_widgets_web.repo_grant_add': granted } });
		const ui = fakeUi({ asks: ['github:bob'], picks: ['writer'] });
		assert.strictEqual(await grantAccess(depsFor(cli, ui), WEB), 'done');
		assert.deepStrictEqual(ui.picked[0].values, ['reader', 'writer', 'admin']);
		assert.match(ui.confirmations[0].message, /github:bob.*writer.*\/et\/widgets\/web/);
		assert.deepStrictEqual(cli.callsTo('repo grant add'), ['alice@us.auth.entire.io|repo grant add --role=writer -- /et/widgets/web github:bob']);
	});

	test('a role the list does not hold, or a grantee not on the list afterwards, is not reported as done', async () => {
		const cli = fakeControlCli({ out: { ...READS, org_grant_list_Acme: '[]' } });
		const ui = fakeUi({ asks: ['github:bob'], picks: ['member'] });
		assert.strictEqual(await grantAccess(depsFor(cli, ui), ORG_NODE), 'failed');
		assert.match(ui.warned[0], /does not list github:bob on Acme/);
	});

	test('a bad grantee never reaches the prompt answer', async () => {
		const ui = fakeUi({ asks: ['bob'] });
		await assert.rejects(() => grantAccess(depsFor(fakeControlCli({ out: READS }), ui), PROJECT_NODE), /fails the prompt's own validation/);
	});

	test('revoking access confirms naming the person and the object, then checks the list', async () => {
		const grant: AccessGrant = { granteeId: 'U9', granteeName: 'github:bob', role: 'writer', source: 'repo' };
		const cli = fakeControlCli({
			out: { repo_grant_list__et_widgets_web: JSON.stringify([grant]) },
			after: { 'repo_grant_list__et_widgets_web.repo_grant_remove': '[]' },
		});
		const ui = fakeUi();
		const node: ControlNode = { kind: 'grant', scope: 'repo', target: '/et/widgets/web', grant };
		assert.strictEqual(await revokeAccess(depsFor(cli, ui), node), 'done');
		assert.match(ui.confirmations[0].message, /github:bob.*\/et\/widgets\/web/);
		assert.match(ui.confirmations[0].detail, /alice \(login alice@us.auth.entire.io\)/);
		assert.deepStrictEqual(cli.callsTo('repo grant remove'), ['alice@us.auth.entire.io|repo grant remove -- /et/widgets/web github:bob']);
	});

	test('an inherited grant that remains does not count as a failed revoke', async () => {
		const direct: AccessGrant = { granteeName: 'github:bob', role: 'writer', source: 'repo' };
		const inherited = { granteeName: 'github:bob', role: 'reader', source: 'inherited from project' };
		const cli = fakeControlCli({
			out: { repo_grant_list__et_widgets_web: JSON.stringify([direct, inherited]) },
			after: { 'repo_grant_list__et_widgets_web.repo_grant_remove': JSON.stringify([inherited]) },
		});
		const node: ControlNode = { kind: 'grant', scope: 'repo', target: '/et/widgets/web', grant: direct };
		assert.strictEqual(await revokeAccess(depsFor(cli, fakeUi()), node), 'done');
	});

	test('a revoke whose person was never matched in the listing is unconfirmed, not done', async () => {
		const grant: AccessGrant = { granteeId: '01HXYZ', role: 'reader', source: 'project' };
		const cli = fakeControlCli({ out: { project_grant_list_widgets: JSON.stringify([grant]) } });
		const ui = fakeUi({ asks: ['github:bob'] });
		const node: ControlNode = { kind: 'grant', scope: 'project', target: 'widgets', grant };
		assert.strictEqual(await revokeAccess(depsFor(cli, ui), node), 'unconfirmed');
		assert.strictEqual(cli.callsTo('project grant remove').length, 1);
		assert.match(ui.warned[0], /could not confirm the access was removed/);
	});

	test('a revoke is done when the direct grant seen before is gone afterwards', async () => {
		const grant: AccessGrant = { granteeName: 'github:bob', role: 'reader', source: 'project' };
		const cli = fakeControlCli({
			out: { project_grant_list_widgets: JSON.stringify([grant]) },
			after: { 'project_grant_list_widgets.project_grant_remove': '[]' },
		});
		const node: ControlNode = { kind: 'grant', scope: 'project', target: 'widgets', grant };
		assert.strictEqual(await revokeAccess(depsFor(cli, fakeUi()), node), 'done');
	});

	test('a revoke is failed when the direct grant seen before is still listed', async () => {
		const grant: AccessGrant = { granteeName: 'github:bob', role: 'reader', source: 'project' };
		const cli = fakeControlCli({ out: { project_grant_list_widgets: JSON.stringify([grant]) } });
		const ui = fakeUi();
		const node: ControlNode = { kind: 'grant', scope: 'project', target: 'widgets', grant };
		assert.strictEqual(await revokeAccess(depsFor(cli, ui), node), 'failed');
		assert.match(ui.warned[0], /still lists github:bob/);
	});

	test('a grant with no qualified handle asks who is meant instead of guessing', async () => {
		const grant: AccessGrant = { granteeId: '01HXYZ', role: 'reader', source: 'repo' };
		const cli = fakeControlCli({ out: { project_grant_list_widgets: '[]' } });
		const ui = fakeUi({ asks: [undefined] });
		const node: ControlNode = { kind: 'grant', scope: 'project', target: 'widgets', grant };
		assert.strictEqual(await revokeAccess(depsFor(cli, ui), node), 'cancelled');
		assert.deepStrictEqual(cli.callsTo('project grant remove'), []);
	});

	test('a CLI without the grant command says so and changes nothing', async () => {
		const cli = fakeControlCli({ helps: { org_grant_remove: null }, out: {} });
		const ui = fakeUi();
		const node: ControlNode = { kind: 'grant', scope: 'org', target: 'Acme', grant: { granteeName: 'github:bob', role: 'member' } };
		assert.strictEqual(await revokeAccess(depsFor(cli, ui), node), 'failed');
		assert.match(ui.warned[0], /no 'org grant remove' command/);
		assert.deepStrictEqual(cli.callsTo('org grant remove'), []);
	});

	test('the roles come from the help of the scope being shared', async () => {
		const cli = fakeControlCli({ out: READS });
		const ui = fakeUi({ asks: ['github:bob'], picks: [undefined] });
		await grantAccess(depsFor(cli, ui), ORG_NODE);
		assert.deepStrictEqual(ui.picked[0].values, ['owner', 'admin', 'member']);
	});

	test('a missing CLI is reported on every change and nothing is attempted', async () => {
		const cli = fakeControlCli({ noCli: true });
		const ui = fakeUi();
		assert.strictEqual(await deleteProject(depsFor(cli, ui), PROJECT_NODE), 'failed');
		assert.match(ui.warned[0], /not installed/);
	});
});

suite('The api escape hatch', () => {
	const apiWorld = () => fakeControlCli({ api: { GET: '{"clusters":[{"slug":"aws"}]}', POST: '{"created":true}', DELETE: '' } });

	test('a read runs exactly one call and shows its result with the login', async () => {
		const cli = apiWorld();
		const ui = fakeUi({ asks: ['/api/v1/clusters'], picks: ['GET', 'core'] });
		assert.strictEqual(await runApiCall(depsFor(cli, ui)), 'done');
		assert.strictEqual(cli.callsTo('api').length, 1, 'exactly one call');
		assert.deepStrictEqual(cli.callsTo('api'), ['alice@us.auth.entire.io|api --to=core -- /api/v1/clusters']);
		assert.strictEqual(ui.shown.length, 1);
		assert.match(ui.shown[0].heading, /GET \/api\/v1\/clusters as alice \(login alice@us.auth.entire.io\)/);
		assert.match(ui.shown[0].body, /"slug": "aws"/);
		assert.strictEqual(ui.confirmations.length, 0, 'a read needs no confirmation');
	});

	test('a call that is not a read confirms with the method, path and login, and runs once', async () => {
		const cli = apiWorld();
		const ui = fakeUi({ asks: ['/api/v1/projects'], picks: ['POST', 'core'] });
		assert.strictEqual(await runApiCall(depsFor(cli, ui)), 'done');
		assert.match(ui.confirmations[0].message, /POST \/api\/v1\/projects/);
		assert.match(ui.confirmations[0].detail, /alice \(login alice@us.auth.entire.io\)/);
		assert.deepStrictEqual(cli.callsTo('api'), ['alice@us.auth.entire.io|api --method=POST --to=core -- /api/v1/projects']);
	});

	test('a declined write runs nothing', async () => {
		const cli = apiWorld();
		const ui = fakeUi({ asks: ['/api/v1/projects'], picks: ['DELETE', 'core'], confirms: [false] });
		assert.strictEqual(await runApiCall(depsFor(cli, ui)), 'cancelled');
		assert.deepStrictEqual(cli.callsTo('api'), []);
		assert.strictEqual(ui.shown.length, 0);
	});

	test('a failed call is reported once with the CLI words and is not retried', async () => {
		const cli = fakeControlCli({});
		const ui = fakeUi({ asks: ['/api/v1/x'], picks: ['GET', 'core'] });
		assert.strictEqual(await runApiCall(depsFor(cli, ui)), 'failed');
		assert.strictEqual(cli.callsTo('api').length, 1);
		assert.match(ui.warned[0], /failed: no response for GET/);
	});

	test('a CLI without the command, or without the backend choice, is handled', async () => {
		const none = fakeControlCli({ helps: { api: null } });
		const ui = fakeUi({ asks: ['/api/v1/x'], picks: ['GET'] });
		assert.strictEqual(await runApiCall(depsFor(none, ui)), 'failed');
		assert.deepStrictEqual(none.callsTo('api'), []);

		const oneBackend = fakeControlCli({ helps: { api: 'Flags:\n  -X, --method string   HTTP method (default GET)\n' }, api: { GET: '{}' } });
		const ui2 = fakeUi({ asks: ['/api/v1/x'], picks: ['GET'] });
		assert.strictEqual(await runApiCall(depsFor(oneBackend, ui2)), 'done');
		assert.deepStrictEqual(oneBackend.callsTo('api'), ['alice@us.auth.entire.io|api -- /api/v1/x']);
	});

	test('a body that is not JSON is shown as it came', () => {
		assert.strictEqual(formatApiBody('plain text'), 'plain text');
		assert.strictEqual(formatApiBody('{"a":1}'), '{\n  "a": 1\n}');
	});

	test('with no login the api is not called', async () => {
		const cli = apiWorld();
		const ui = fakeUi();
		assert.strictEqual(await runApiCall(depsFor(cli, ui, null)), 'no-login');
		assert.deepStrictEqual(cli.callsTo('api'), []);
	});

	test('only the person\'s command can reach the api: no view or poller imports it', () => {
		const extension = vscode.extensions.getExtension('greysquirr3l.entirely');
		assert.ok(extension);
		const root = path.join(extension.extensionPath, 'src');
		const offenders: string[] = [];
		const walk = (dir: string): void => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					if (entry.name !== 'test') {
						walk(full);
					}
				} else if (entry.name.endsWith('.ts') && /ControlApiService|controlApi'|\bapiArguments\b/.test(fs.readFileSync(full, 'utf8'))) {
					offenders.push(path.relative(root, full));
				}
			}
		};
		walk(root);
		assert.deepStrictEqual(offenders.sort(), [
			'commands/controlPlane.ts',
			'extension.ts',
			'lib/entire/controlPlaneFlags.ts',
			'lib/entire/index.ts',
			'services/controlApi.ts',
		]);
		const providers = fs.readdirSync(path.join(root, 'providers')).map(file => fs.readFileSync(path.join(root, 'providers', file), 'utf8'));
		assert.ok(providers.every(source => !/controlApi/.test(source)));
	});
});
