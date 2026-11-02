import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
	decodeInvitations,
	decodeMirrors,
	decodeProtectionRules,
	decodeRepoVisibility,
	forgeOf,
	isProtectionBranch,
	repositoryReference,
} from '../lib/entire';
import {
	addMirror,
	addProtectionRule,
	addRemote,
	cloneRepository,
	createOrganisation,
	createProject,
	detachMirror,
	inviteToOrganisation,
	listInvitations,
	listMirrors,
	listProtectionRules,
	removeMirror,
	removeProtectionRule,
	resyncMirror,
	revokeInvitation,
	showOrganisation,
	showProject,
	showRepositoryVisibility,
} from '../commands/controlPlaneBreadth';
import type { ControlNode } from '../providers/controlPlaneProvider';
import {
	ALICE,
	CLUSTERS,
	HELPS,
	ORGS,
	PROJECTS,
	WIDGET_REPOS,
	depsFor,
	fakeControlCli,
	fakeUi,
	serviceFor,
	type FakeControlCli,
} from './support/controlPlaneCli';

const WEB: ControlNode = {
	kind: 'repository',
	repository: { id: 'R1', name: 'web', project: 'widgets', projectId: 'PRJ1', provider: 'entire', visibility: 'private' },
};
const MIRROR: ControlNode = {
	kind: 'repository',
	repository: {
		id: 'M1',
		name: 'entirely-vscode',
		project: 'gh:mirrors:01M5X7JD9EAZW0E76M9SWG9FSB',
		projectId: '01M5X7PCQS6NEF5DTEPF1W1P4E',
		provider: 'github',
		fullName: 'greysquirr3l/entirely-vscode',
	},
};
const PROJECT_NODE: ControlNode = { kind: 'project', project: { id: 'PRJ1', name: 'widgets', repositoryCount: 2 } };
const ORG_NODE: ControlNode = { kind: 'organisation', organisation: { id: 'ORG1', name: 'Acme' } };

/** The readings every command needs before it can ask anything. */
const READS = {
	org_list: ORGS,
	project_list: PROJECTS,
	repo_list_PRJ1: WIDGET_REPOS,
	cluster_list: CLUSTERS,
};

/** A fake CLI that answers the reads, and remembers what it was asked. */
function cliWith(extra: Parameters<typeof fakeControlCli>[0] = {}): FakeControlCli {
	return fakeControlCli({ ...extra, out: { ...READS, ...(extra.out ?? {}) } });
}

/**
 * True when the text names the host, and the whole of it.
 *
 * A plain search would match `example.com` inside
 * `example.com.attacker.net` and inside `evil.example.com`, which are
 * other hosts altogether. The text is split on everything that cannot be
 * part of a host name, the dots kept, and the host is then looked for as
 * one whole piece.
 */
function namesHost(text: string, host: string): boolean {
	return text
		.split(/[^\w.-]+/)
		.some(piece => piece.replace(/\.+$/, '') === host);
}

suite('Control plane breadth, the addresses the CLI takes', () => {
	test('a repository is named by the forge its provider names', () => {
		assert.strictEqual(
			repositoryReference({ id: 'R1', name: 'web', project: 'widgets', provider: 'entire' }),
			'/et/widgets/web',
		);
		assert.strictEqual(
			repositoryReference({ id: 'M1', name: 'code', project: 'p', provider: 'github', fullName: 'alice/code' }),
			'/gh/alice/code',
		);
		assert.strictEqual(repositoryReference({ id: 'M1', name: 'code', project: 'p', provider: 'github' }), undefined);
	});

	test('the forge is read from the reference itself', () => {
		assert.strictEqual(forgeOf('/gh/alice/code'), 'gh');
		assert.strictEqual(forgeOf('/et/widgets/web'), 'et');
		assert.strictEqual(forgeOf('gh/alice/code'), 'gh');
		assert.strictEqual(forgeOf('code'), undefined);
		assert.strictEqual(forgeOf('/xx/alice/code'), undefined);
	});

	test('a branch is a name that cannot be read as an option', () => {
		assert.ok(isProtectionBranch('HEAD'));
		assert.ok(isProtectionBranch('release/*'));
		assert.ok(!isProtectionBranch(''));
		assert.ok(!isProtectionBranch('-force'));
		assert.ok(!isProtectionBranch('two words'));
	});

	test('a host inside a longer name is not the host', () => {
		assert.ok(namesHost('the cluster aws-us-east-2.entire.io is ready', 'aws-us-east-2.entire.io'));
		assert.ok(namesHost('it points at https://example.com/et/widgets/web.git', 'example.com'));
		assert.ok(!namesHost('aws-us-east-2.entire.io.attacker.net', 'aws-us-east-2.entire.io'));
		assert.ok(!namesHost('evil-aws-us-east-2.entire.io', 'aws-us-east-2.entire.io'));
	});
});

suite('Control plane breadth, the readings', () => {
	test('shows an organisation, as the CLI reports it', async () => {
		const cli = cliWith({ out: { ...READS, org_get_Acme: JSON.stringify({ id: 'ORG1', name: 'Acme', region: 'eu' }) } });
		const ui = fakeUi();
		const result = await showOrganisation(depsFor(cli, ui), ORG_NODE);
		assert.strictEqual(result, 'done');
		assert.strictEqual(ui.shown.length, 1);
		assert.match(ui.shown[0].heading, /Acme/);
		assert.match(ui.shown[0].body, /"region": "eu"/);
		assert.match(cli.callsTo('org get')[0], /-- Acme$/);
	});

	test('shows a project, as the CLI reports it', async () => {
		const cli = cliWith({ out: { ...READS, project_get_PRJ1: JSON.stringify({ id: 'PRJ1', name: 'widgets' }) } });
		const ui = fakeUi();
		assert.strictEqual(await showProject(depsFor(cli, ui), PROJECT_NODE), 'done');
		assert.match(ui.shown[0].body, /"name": "widgets"/);
		assert.match(cli.callsTo('project get')[0], /-- PRJ1$/);
	});

	test('shows the invitations of an organisation', async () => {
		const cli = cliWith({
			out: { ...READS, org_invite_list_Acme: JSON.stringify([{ email: 'dev@example.com', role: 'member', status: 'pending' }]) },
		});
		const ui = fakeUi();
		assert.strictEqual(await listInvitations(depsFor(cli, ui), ORG_NODE), 'done');
		assert.match(ui.shown[0].body, /dev@example\.com/);
		assert.match(cli.callsTo('org invite list')[0], /-- Acme$/);
	});

	test('shows whether a repository is public or private', async () => {
		const cli = cliWith({
			out: { ...READS, repo_visibility_get_R1: JSON.stringify({ repo: '/et/widgets/web', visibility: 'private' }) },
		});
		const ui = fakeUi();
		assert.strictEqual(await showRepositoryVisibility(depsFor(cli, ui), WEB), 'done');
		assert.match(ui.shown[0].body, /"visibility": "private"/);
		// The CLI refuses a `/gh/` reference for this read and asks for the id.
		assert.match(cli.callsTo('repo visibility get')[0], /-- R1$/);
	});

	test('shows the protection rules of a repository', async () => {
		const cli = cliWith({
			out: { ...READS, repo_protection_list_R1: JSON.stringify([{ id: 'rule-1', level: 'server-side-merge-only' }]) },
		});
		const ui = fakeUi();
		assert.strictEqual(await listProtectionRules(depsFor(cli, ui), WEB), 'done');
		assert.match(ui.shown[0].body, /rule-1/);
		assert.match(cli.callsTo('repo protection list')[0], /-- R1$/);
	});

	test('asks the CLI for the forge the reference names, in the word the CLI uses', async () => {
		const cli = cliWith({ out: READS });
		await serviceFor(cli).mirrors('/gh/greysquirr3l/entirely-vscode');
		const call = cli.callsTo('repo mirror list')[0];
		assert.match(call, /--forge=gh/);
		assert.match(call, /--name=\/gh\/greysquirr3l\/entirely-vscode/);

		const native = cliWith({ out: READS });
		await serviceFor(native).mirrors('/et/widgets/web');
		assert.match(native.callsTo('repo mirror list')[0], /--forge=et/);
	});

	test('shows the clusters a repository is mirrored on', async () => {
		const cli = cliWith({
			out: {
				...READS,
				repo_mirror_list: JSON.stringify([
					{ repo: '/et/widgets/web', status: 'ready', placements: [{ cluster: 'aws-us-east-2.entire.io', status: 'ready' }] },
				]),
			},
		});
		const ui = fakeUi();
		assert.strictEqual(await listMirrors(depsFor(cli, ui), WEB), 'done');
		assert.ok(namesHost(ui.shown[0].body, 'aws-us-east-2.entire.io'), 'the cluster is named');
	});

	test('says why a reading failed rather than showing nothing', async () => {
		// The fake CLI refuses a reading it has no answer for.
		const cli = cliWith({ out: READS });
		const ui = fakeUi();
		assert.strictEqual(await showOrganisation(depsFor(cli, ui), ORG_NODE), 'failed');
		assert.match(ui.warned[0], /Cannot read the organisation Acme/);
		assert.strictEqual(ui.shown.length, 0);
	});
});

suite('Control plane breadth, the changes', () => {
	test('creates an organisation, with the jurisdiction it was asked for', async () => {
		const cli = cliWith({ out: { ...READS, org_get_Acme: JSON.stringify({ id: 'ORG1', name: 'Acme' }) } });
		const ui = fakeUi({ asks: ['Acme'], picks: ['us'] });
		const result = await createOrganisation(depsFor(cli, ui));
		assert.strictEqual(result, 'done');
		const call = cli.callsTo('org create')[0];
		assert.match(call, /--region=us/);
		assert.match(call, /-- Acme$/);
	});

	test('a refusal that says the access is GitHub\'s is reported in plain words', async () => {
		const cli = cliWith({
			out: READS,
			fail: {
				project_grant_add:
					'Project access on a GitHub-mirrored project is a read-only projection of GitHub; grants are managed by the source',
			},
		});
		const outcome = await serviceFor(cli).perform(
			{ kind: 'grant', scope: 'project', target: 'PRJ1', label: 'widgets', grantee: 'github:bob', role: 'reader' },
			{ handle: 'alice', name: 'alice@us.auth.entire.io', server: 'us.auth.entire.io', active: true },
		);
		assert.strictEqual(outcome.kind, 'refused-github');
		assert.match(outcome.kind === 'refused-github' ? outcome.detail : '', /read-only projection/);
	});

	test('invites an address, with the role the CLI says the flag takes', async () => {
		const cli = cliWith({
			out: { ...READS, org_invite_list_Acme: '[]' },
			after: { 'org_invite_list_Acme.org_invite_send': JSON.stringify([{ email: 'dev@example.com', role: 'admin' }]) },
		});
		const ui = fakeUi({ asks: ['dev@example.com'], picks: ['admin'] });
		const result = await inviteToOrganisation(depsFor(cli, ui), ORG_NODE);
		assert.strictEqual(result, 'done');
		const call = cli.callsTo('org invite send')[0];
		assert.match(call, /--email=dev@example\.com/);
		assert.match(call, /--role=admin/);
	});

	test('revokes an invitation', async () => {
		const cli = cliWith({ out: { ...READS, org_invite_list_Acme: '[]' } });
		const ui = fakeUi({ asks: ['dev@example.com'] });
		assert.strictEqual(await revokeInvitation(depsFor(cli, ui), ORG_NODE), 'done');
		assert.match(cli.callsTo('org invite revoke')[0], /--email=dev@example\.com/);
	});

	test('creates a project under the owner it was given', async () => {
		const cli = cliWith({ out: { ...READS, project_get_PRJ1: JSON.stringify({ id: 'PRJ1', name: 'widgets' }) } });
		const ui = fakeUi({ asks: ['widgets', 'Acme'], picks: ['org', 'us'] });
		assert.strictEqual(await createProject(depsFor(cli, ui)), 'done');
		const call = cli.callsTo('project create')[0];
		assert.match(call, /--owner=Acme/);
		assert.match(call, /--owner-type=org/);
	});

	test('protects a branch, with the level the person chose', async () => {
		const cli = cliWith({
			out: {
				...READS,
				repo_protection_list_R1: JSON.stringify([{ id: 'rule-1' }]),
				repo_protection_list__et_widgets_web: JSON.stringify([{ id: 'rule-1' }]),
			},
		});
		const ui = fakeUi({ asks: ['main'], picks: ['Refuse every direct push'] });
		assert.strictEqual(await addProtectionRule(depsFor(cli, ui), WEB), 'done');
		const call = cli.callsTo('repo protection add')[0];
		assert.match(call, /--server-side-merge-only=true/);
		assert.match(call, /-- \/et\/widgets\/web main$/);
	});

	test('removes the protection of a branch', async () => {
		const cli = cliWith({
			out: { ...READS, repo_protection_list_R1: '[]', repo_protection_list__et_widgets_web: '[]' },
		});
		const ui = fakeUi({ asks: ['main'] });
		assert.strictEqual(await removeProtectionRule(depsFor(cli, ui), WEB), 'done');
		assert.match(cli.callsTo('repo protection remove')[0], /-- \/et\/widgets\/web main$/);
	});

	test('mirrors a repository onto the clusters that were picked', async () => {
		const cli = cliWith({
			out: {
				...READS,
				repo_mirror_list: JSON.stringify([{ repo: '/et/widgets/web', placements: [{ cluster: 'aws-us-east-2.entire.io' }] }]),
			},
		});
		const ui = fakeUi({ manys: [['aws-us-east-2.entire.io']] });
		assert.strictEqual(await addMirror(depsFor(cli, ui), WEB), 'done');
		const call = cli.callsTo('repo mirror add')[0];
		assert.match(call, /--cluster=aws-us-east-2\.entire\.io/);
		assert.match(call, /--no-wait/);
	});

	test('takes a repository off the clusters it was picked from', async () => {
		const cli = cliWith({
			out: {
				...READS,
				repo_mirror_list: JSON.stringify([{ repo: '/et/widgets/web', placements: [{ cluster: 'aws-us-east-2.entire.io' }] }]),
			},
			after: { 'repo_mirror_list.repo_mirror_remove': '[]' },
		});
		const ui = fakeUi({ manys: [['aws-us-east-2.entire.io']] });
		assert.strictEqual(await removeMirror(depsFor(cli, ui), WEB), 'done');
		assert.match(cli.callsTo('repo mirror remove')[0], /--cluster=aws-us-east-2\.entire\.io/);
	});

	test('detaches a mirror into a repository of Entire own', async () => {
		const cli = cliWith({
			out: {
				...READS,
				repo_mirror_list: JSON.stringify([{ repo: '/gh/greysquirr3l/entirely-vscode' }]),
				repo_mirror_detach: 'the repository will be native in /et/widgets/code',
			},
			after: { 'repo_mirror_list.repo_mirror_detach': '[]' },
		});
		const ui = fakeUi({ asks: ['/et/widgets/code'] });
		assert.strictEqual(await detachMirror(depsFor(cli, ui), MIRROR), 'done');
		const call = cli.callsTo('repo mirror detach')[0];
		assert.match(call, /--into=\/et\/widgets\/code/);
		assert.match(call, /-- \/gh\/greysquirr3l\/entirely-vscode$/);
	});

	test('will not detach a repository that is already Entire own', async () => {
		const cli = cliWith({ out: READS });
		const ui = fakeUi();
		assert.strictEqual(await detachMirror(depsFor(cli, ui), WEB), 'cancelled');
		assert.strictEqual(cli.callsTo('repo mirror detach').length, 0);
		assert.match(ui.informed[0], /already a repository of Entire/);
	});

	test('will not protect a branch on a GitHub mirror, where the protection lives', async () => {
		const cli = cliWith({ out: READS });
		const ui = fakeUi();
		assert.strictEqual(await addProtectionRule(depsFor(cli, ui), MIRROR), 'cancelled');
		assert.strictEqual(cli.callsTo('repo protection add').length, 0);
		assert.match(ui.informed[0], /is the upstream's/);
	});

	test('will not fetch a mirror that is a repository of Entire own, which has no upstream', async () => {
		const cli = cliWith({ out: READS });
		const ui = fakeUi();
		assert.strictEqual(await resyncMirror(depsFor(cli, ui), WEB), 'cancelled');
		assert.strictEqual(cli.callsTo('repo mirror resync').length, 0);
		assert.match(ui.informed[0], /no upstream/);
	});

	test('shows the CLI\'s own plan before a detach, and detaches nothing when the plan does not hold', async () => {
		const cli = cliWith({ out: { ...READS, repo_mirror_list: '[]' }, fail: { repo_mirror_detach: 'more than one placement' } });
		const ui = fakeUi({ asks: ['/et/widgets/code'] });
		assert.strictEqual(await detachMirror(depsFor(cli, ui), MIRROR), 'cancelled');
		assert.strictEqual(cli.callsTo('repo mirror detach').length, 1);
		assert.match(cli.callsTo('repo mirror detach')[0], /--dry-run/);
		assert.match(ui.warned[0], /more than one placement/);
		assert.match(ui.warned[0], /remove them first/);
	});

	test('shows the plan of a detach that holds, before asking', async () => {
		const cli = cliWith({
			out: { ...READS, repo_mirror_detach: 'the repository will be native in /et/widgets/code' },
		});
		const ui = fakeUi({ asks: ['/et/widgets/code'], confirms: [false] });
		assert.strictEqual(await detachMirror(depsFor(cli, ui), MIRROR), 'cancelled');
		assert.ok(ui.informed.some(line => /will be native/.test(line)), 'the plan is shown');
		assert.strictEqual(ui.confirmations.length, 1, 'the detach is confirmed after the plan');
	});

	test('does not write the invitee\'s address to the log', async () => {
		const cli = cliWith({
			out: { ...READS, org_invite_list_Acme: '[]' },
			after: { 'org_invite_list_Acme.org_invite_send': JSON.stringify([{ email: 'dev@example.com' }]) },
		});
		const ui = fakeUi({ asks: ['dev@example.com'], picks: ['member'] });
		await inviteToOrganisation(depsFor(cli, ui), ORG_NODE);
		const invocation = cli.recorded().find(entry => entry.args.includes('invite'));
		assert.ok(invocation);
		assert.ok(!JSON.stringify(invocation).includes('dev@example.com'), 'the address is not recorded');
	});

	test('asks the CLI to fetch a mirror again', async () => {
		const cli = cliWith({
			out: {
				...READS,
				repo_mirror_list: JSON.stringify([{ repo: '/gh/greysquirr3l/entirely-vscode', placements: [{ cluster: 'aws-us-east-2.entire.io' }] }]),
			},
		});
		const ui = fakeUi();
		assert.strictEqual(await resyncMirror(depsFor(cli, ui), MIRROR), 'done');
		assert.match(cli.callsTo('repo mirror resync')[0], /-- \/gh\/greysquirr3l\/entirely-vscode$/);
	});

	test('clones a repository into a folder the person chose, from the cluster it is on', async () => {
		const cli = cliWith({
			out: {
				...READS,
				repo_mirror_list: JSON.stringify([{ repo: '/et/widgets/web', placements: [{ cluster: 'aws-us-east-2.entire.io' }] }]),
			},
			cloneDir: 'copies/web',
		});
		const ui = fakeUi({ asks: ['copies'] });
		assert.strictEqual(await cloneRepository(depsFor(cli, ui), WEB), 'done');
		const call = cli.callsTo('repo clone')[0];
		assert.match(call, /--cluster=aws-us-east-2\.entire\.io/);
		assert.match(call, /-- \/et\/widgets\/web copies\/web$/);
		assert.ok(fs.existsSync(path.join(cli.dir, 'copies', 'web')));
	});

	test('confirms the full path a clone is written to, and the cluster it comes from', async () => {
		const cli = cliWith({
			out: {
				...READS,
				repo_mirror_list: JSON.stringify([{ repo: '/et/widgets/web', placements: [{ cluster: 'aws-us-east-2.entire.io' }] }]),
			},
			cloneDir: 'copies/web',
		});
		const ui = fakeUi({ asks: ['copies'] });
		await cloneRepository(depsFor(cli, ui), WEB);
		const question = ui.confirmations[0];
		assert.match(question.message, /Clone \/et\/widgets\/web/);
		assert.match(question.detail, new RegExp(path.join(cli.dir, 'copies', 'web')));
		assert.ok(namesHost(question.detail, 'aws-us-east-2.entire.io'), 'the cluster is named');
	});

	test('a clone that leaves no work tree behind is not reported as done', async () => {
		const cli = cliWith({ out: READS, cloneWithoutWorkTree: 'copies/web' });
		const ui = fakeUi({ asks: ['copies'] });
		assert.strictEqual(await cloneRepository(depsFor(cli, ui), WEB), 'failed');
	});

	test('refuses to clone into a folder that holds something', async () => {
		const cli = cliWith({ out: READS });
		fs.mkdirSync(path.join(cli.dir, 'copies', 'web'), { recursive: true });
		fs.writeFileSync(path.join(cli.dir, 'copies', 'web', 'file.txt'), 'here');
		const ui = fakeUi({ asks: ['copies'] });
		assert.strictEqual(await cloneRepository(depsFor(cli, ui), WEB), 'cancelled');
		assert.strictEqual(cli.callsTo('repo clone').length, 0);
		assert.match(ui.warned[0], /not empty/);
	});

	test('shows the address a taken remote points at, and repoints it only when the person says so', async () => {
		const cli = cliWith({ out: READS, remoteName: 'entire' });
		fs.mkdirSync(path.join(cli.dir, '.git'), { recursive: true });
		fs.writeFileSync(
			path.join(cli.dir, '.git', 'config'),
			'[remote "entire"]\n\turl = https://alice:secret@example.com/et/widgets/web.git\n',
		);
		const ui = fakeUi({ asks: ['entire'], confirms: [false] });
		assert.strictEqual(await addRemote(depsFor(cli, ui), WEB), 'cancelled');
		assert.ok(
			ui.informed.some(line => namesHost(line, 'example.com')),
			'the address is shown without its credentials',
		);
		assert.ok(!ui.informed.join(' ').includes('secret'), 'the password is not shown');
		assert.strictEqual(cli.callsTo('repo remote add').length, 0);
	});

	test('names the cluster the remote points at', async () => {
		const cli = cliWith({
			out: {
				...READS,
				repo_mirror_list: JSON.stringify([{ repo: '/et/widgets/web', placements: [{ cluster: 'aws-us-east-2.entire.io' }] }]),
			},
		});
		const ui = fakeUi({ asks: ['entire'] });
		await addRemote(depsFor(cli, ui), WEB);
		assert.ok(namesHost(ui.confirmations[0].detail, 'aws-us-east-2.entire.io'), 'the cluster is named');
		assert.match(cli.callsTo('repo remote add')[0], /--cluster=aws-us-east-2\.entire\.io/);
	});

	test('points a remote at this checkout', async () => {
		const cli = cliWith({ out: READS, remoteName: 'entire' });
		const ui = fakeUi({ asks: ['entire'] });
		assert.strictEqual(await addRemote(depsFor(cli, ui), WEB), 'done');
		assert.match(cli.callsTo('repo remote add')[0], /-- entire \/et\/widgets\/web$/);
		assert.match(fs.readFileSync(path.join(cli.dir, '.git', 'config'), 'utf8'), /\[remote "entire"\]/);
	});

	test('asks before it changes anything', async () => {
		const cli = cliWith({ out: READS });
		const ui = fakeUi({ confirms: [false], asks: ['entire'] });
		assert.strictEqual(await addRemote(depsFor(cli, ui), WEB), 'cancelled');
		assert.strictEqual(cli.callsTo('repo remote add').length, 0);
		assert.strictEqual(ui.confirmations.length, 1);
	});

	test('says so when the CLI has no flag for what was asked', async () => {
		const cli = cliWith({ out: READS, helps: { org_invite_send: null } });
		const ui = fakeUi({ asks: ['dev@example.com'] });
		assert.strictEqual(await inviteToOrganisation(depsFor(cli, ui), ORG_NODE), 'failed');
		assert.match(ui.warned[0], /org invite send/);
	});

	test('a reading the CLI cannot do is refused, and nothing is run', async () => {
		const cli = cliWith({ out: READS, helps: { repo_visibility_get: null } });
		const ui = fakeUi();
		assert.strictEqual(await showRepositoryVisibility(depsFor(cli, ui), WEB), 'failed');
		assert.match(ui.warned[0], /repo visibility get/);
	});
});

suite('Control plane breadth, the payloads', () => {
	test('reads an invitation whose shape the CLI has not shown', () => {
		const invitations = decodeInvitations([{ email: 'dev@example.com', role: 'admin', state: 'sent' }]);
		assert.ok(invitations.ok);
		assert.strictEqual(invitations.value[0].email, 'dev@example.com');
		assert.strictEqual(invitations.value[0].status, undefined);
		assert.match(invitations.value[0].raw, /dev@example\.com/);
	});

	test('reads one row per mirror placement', () => {
		const mirrors = decodeMirrors([
			{ repo: '/et/widgets/web', placements: [{ cluster: 'a.entire.io' }, { cluster: 'b.entire.io' }] },
		]);
		assert.ok(mirrors.ok);
		assert.deepStrictEqual(mirrors.value.map(placement => placement.cluster), ['a.entire.io', 'b.entire.io']);
	});

	test('reads a protection rule and a visibility', () => {
		const rules = decodeProtectionRules([{ id: 'rule-1', kind: 'branch' }]);
		assert.ok(rules.ok);
		assert.strictEqual(rules.value[0].id, 'rule-1');
		const visibility = decodeRepoVisibility({ repo: '/et/widgets/web', visibility: 'public' });
		assert.ok(visibility.ok);
		assert.strictEqual(visibility.value.visibility, 'public');
	});
});

suite('Control plane breadth, the help of the CLI', () => {
	test('the help the fake CLI keeps is the help the extension reads', () => {
		assert.ok(HELPS.org_get.includes('--json'));
		assert.ok(HELPS.repo_protection_add.includes('--server-side-merge-only'));
		assert.ok(HELPS.repo_mirror_detach.includes('--into'));
	});
});