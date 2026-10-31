import * as assert from 'assert';

import { createTrail, updateTrail } from '../commands/trailDepth';
import type { CliInvocation, CliInvocationBodies } from '../services/cli';
import { ACTING, changeRow, depthRig } from './support/trailDepthHarness';

const TRAIL_ROW = (): unknown => {
	const row = changeRow() as { trail: unknown };
	return { kind: 'trail', entry: { trail: row.trail } };
};

suite('Trail creation', () => {
	test('runs the CLI once as the confirmed login and reports the trail only when a new one is listed', async () => {
		const rig = depthRig({}, { inputs: ['Shape the new thing', 'Why it matters'], choices: ['branch', '', ''] });
		const result = await createTrail(rig.deps);

		assert.strictEqual(result, 'done');
		const mutations = rig.cli.mutations();
		assert.strictEqual(mutations.length, 1);
		assert.strictEqual(mutations[0].context, ACTING.name, 'run as the confirmed login');
		assert.strictEqual(mutations[0].env, ACTING.name);
		assert.deepStrictEqual(mutations[0].args.slice(0, 4), ['trail', 'create', '--title', 'Shape the new thing']);
		assert.ok(rig.cli.state().trails.some(trail => trail.title === 'Shape the new thing'));
		assert.match(rig.ui.notices[0].message, /created trail #41 "Shape the new thing" as ada/);
		assert.strictEqual(rig.ui.notices[0].level, 'info');
		assert.strictEqual(rig.changedCalls.length, 1, 'the trails are read again');
	});

	test('asks first, naming the title, the login, Entire and the branch that is published', async () => {
		const rig = depthRig({}, { inputs: ['Idea', ''], choices: ['branch', '', ''] });
		await createTrail(rig.deps);

		assert.strictEqual(rig.ui.confirmations.length, 1);
		const [question] = rig.ui.confirmations;
		assert.match(question.message, /"Idea" on Entire/);
		assert.match(question.detail, /Acting as ada/);
		assert.match(question.detail, /publishes your branch shape-probe to the remote/);
		assert.match(question.detail, /does not commit your changes or change your checkout/);
		assert.strictEqual(question.action, 'Create Trail');
	});

	test('runs nothing that changes anything when the question is dismissed', async () => {
		const rig = depthRig({}, { inputs: ['Idea', ''], choices: ['branch', '', ''], confirm: null });
		const result = await createTrail(rig.deps);

		assert.strictEqual(result, 'cancelled');
		assert.deepStrictEqual(rig.cli.mutations(), []);
		assert.strictEqual(rig.cli.state().trails.length, 1);
	});

	test('an intent-only trail passes the no-branch flag and says no branch is published', async () => {
		const rig = depthRig({}, { inputs: ['Idea', ''], choices: ['intent', '', ''] });
		await createTrail(rig.deps);

		assert.ok(rig.cli.mutations()[0].args.includes('--no-branch'));
		assert.match(rig.ui.confirmations[0].detail, /No branch is published/);
	});

	test('reports unconfirmed, not done, when the CLI succeeds but no new trail is listed', async () => {
		const rig = depthRig({ noEffect: ['trail create'] }, { inputs: ['Idea', ''], choices: ['branch', '', ''] });
		const result = await createTrail(rig.deps);

		assert.strictEqual(result, 'unconfirmed');
		assert.match(rig.ui.notices[0].message, /the trail is not in the list\. Check the web UI/);
		assert.strictEqual(rig.ui.notices[0].level, 'warn');
	});

	test('reports unconfirmed when two new trails carry the title, and does not guess', async () => {
		const rig = depthRig({ createTwice: true }, { inputs: ['Twin', ''], choices: ['branch', '', ''] });
		const result = await createTrail(rig.deps);

		assert.strictEqual(result, 'unconfirmed');
		assert.match(rig.ui.notices[0].message, /More than one new trail/);
	});

	test('a failure after the trail exists is partly done and says to link the branch, not to create again', async () => {
		const rig = depthRig({ createFailsAfterAdding: true }, { inputs: ['Half', ''], choices: ['branch', '', ''] });
		const result = await createTrail(rig.deps);

		assert.strictEqual(result, 'unconfirmed');
		assert.strictEqual(rig.cli.mutations().length, 1, 'never retried');
		assert.match(rig.ui.notices[0].message, /do not create it again: link the branch to trail #41 with "Link a Branch to a Trail"/);
	});

	test('a failure with no new trail is a failure in the CLI\'s words, and is not retried', async () => {
		const rig = depthRig({ fails: { 'trail create': 'A Change already exists for this branch' } }, { inputs: ['Dup', ''], choices: ['branch', '', ''] });
		const result = await createTrail(rig.deps);

		assert.strictEqual(result, 'failed');
		assert.strictEqual(rig.cli.mutations().length, 1);
		assert.match(rig.ui.notices[0].message, /A Change already exists for this branch/);
		assert.strictEqual(rig.ui.notices[0].level, 'error');
	});

	test('keeps the title and the body out of the reported command line, the output and the bodies', async () => {
		const rig = depthRig({}, { inputs: ['A very private title', 'A very private body'], choices: ['branch', '', ''] });
		const records: { invocation: CliInvocation; bodies: CliInvocationBodies }[] = [];
		rig.cli.runner.setSink({ report: (invocation, bodies) => records.push({ invocation, bodies }) });
		await createTrail(rig.deps);

		const everything = JSON.stringify(records);
		assert.ok(!everything.includes('private title'), 'the title is not recorded');
		assert.ok(!everything.includes('private body'), 'the body is not recorded');
		const create = records.find(record => record.invocation.args.includes('trail') && record.invocation.args.includes('create') && record.invocation.args.includes('--title'));
		assert.ok(create);
		assert.ok(create.invocation.args.includes('<redacted>'));
		assert.strictEqual(create.bodies.stdout, undefined, 'what the CLI printed is withheld');
		assert.ok(!rig.logged.join('\n').includes('private'));
	});

	test('says a login with no access to the project cannot create there, and runs nothing', async () => {
		const rig = depthRig({ projectNotFound: true }, { inputs: ['Idea', ''], choices: ['branch', '', ''] });
		const result = await createTrail(rig.deps);

		assert.strictEqual(result, 'failed');
		assert.deepStrictEqual(rig.cli.mutations(), []);
		assert.match(rig.ui.notices[0].message, /has no access to the project gh\/greysquirr3l/);
		assert.match(rig.ui.notices[0].message, /web UI/);
		assert.match(rig.ui.notices[0].message, /GitHub organisation/);
	});

	test('says what to update when the CLI has no trail create, and sends nothing', async () => {
		const rig = depthRig({ without: ['trail create'] }, { inputs: ['Idea', ''] });
		const result = await createTrail(rig.deps);

		assert.strictEqual(result, 'unavailable');
		assert.deepStrictEqual(rig.cli.calls(), []);
		assert.match(rig.ui.notices[0].message, /update the CLI/);
	});

	test('offers type and priority only when the help names a list, with a way to let the CLI decide', async () => {
		const rig = depthRig({}, { inputs: ['Typed', ''], choices: ['branch', 'bug', 'urgent'] });
		await createTrail(rig.deps);

		const args = rig.cli.mutations()[0].args;
		assert.deepStrictEqual(args.slice(args.indexOf('--type'), args.indexOf('--type') + 2), ['--type', 'bug']);
		assert.deepStrictEqual(args.slice(args.indexOf('--priority'), args.indexOf('--priority') + 2), ['--priority', 'urgent']);
		const noLists = DEPTH_NO_LISTS();
		const bare = depthRig({ helps: { 'trail create': noLists } }, { inputs: ['Plain', ''], choices: ['branch'] });
		await createTrail(bare.deps);
		assert.deepStrictEqual(
			bare.ui.choiceTitles,
			['Create a trail for'],
			'with no list in the help, neither type nor priority is offered',
		);
	});
});

function DEPTH_NO_LISTS(): string {
	return [
		'entire trail create — Create a trail',
		'',
		'Flags:',
		'      --body string       Trail description',
		'      --no-branch         Create intent scoped to the current or --repo repository',
		'      --priority string   Priority',
		'      --title string      Trail title',
		'      --type string       Type',
		'',
		'Inherited flags:',
		'      --context name   Act as this saved login name for this command only',
		'',
	].join('\n');
}

suite('Trail update', () => {
	test('changes a title without asking, and reports it only when the fresh read shows it', async () => {
		const rig = depthRig({}, { choices: ['title'], inputs: ['A better title'] });
		const result = await updateTrail(rig.deps, TRAIL_ROW());

		assert.strictEqual(result, 'done');
		assert.deepStrictEqual(rig.ui.confirmations, [], 'an ordinary edit does not ask');
		const mutations = rig.cli.mutations();
		assert.strictEqual(mutations.length, 1);
		assert.strictEqual(mutations[0].context, ACTING.name);
		assert.deepStrictEqual(mutations[0].args, ['trail', 'update', '40', '--title', 'A better title']);
		assert.match(rig.ui.notices[0].message, /updated trail #40 .* as ada/);
		assert.strictEqual(rig.ui.asked[0].value, 'Shape the thing', 'the box shows the current value');
	});

	test('closing a trail asks first, naming the trail, the login and Entire, and shows the old and new status', async () => {
		const rig = depthRig({}, { choices: ['status', 'closed'] });
		await updateTrail(rig.deps, TRAIL_ROW());

		assert.strictEqual(rig.ui.confirmations.length, 1);
		const [question] = rig.ui.confirmations;
		assert.match(question.message, /Close trail #40/);
		assert.match(question.detail, /Acting as ada/);
		assert.match(question.detail, /from open to closed on Entire/);
		assert.strictEqual(rig.cli.state().trails[0].status, 'closed');
	});

	test('declining the close changes nothing', async () => {
		const rig = depthRig({}, { choices: ['status', 'closed'], confirm: null });
		const result = await updateTrail(rig.deps, TRAIL_ROW());

		assert.strictEqual(result, 'cancelled');
		assert.deepStrictEqual(rig.cli.mutations(), []);
		assert.strictEqual(rig.cli.state().trails[0].status, 'open');
	});

	test('reopening a trail does not ask', async () => {
		const rig = depthRig({ state: { trails: [{ ...depthTrail(), status: 'closed' }] } }, { choices: ['status', 'open'] });
		const result = await updateTrail(rig.deps, TRAIL_ROW());

		assert.strictEqual(result, 'done');
		assert.deepStrictEqual(rig.ui.confirmations, []);
	});

	test('replacing the assignee list asks, clearing it asks, and adding or removing one does not', async () => {
		const replace = depthRig({}, { choices: ['assignee'], inputs: ['grace, linus'] });
		await updateTrail(replace.deps, TRAIL_ROW());
		assert.strictEqual(replace.ui.confirmations.length, 1);
		assert.match(replace.ui.confirmations[0].detail, /replaced as a whole/);
		assert.deepStrictEqual(replace.cli.state().trails[0].assignees, ['grace', 'linus']);

		const clear = depthRig({ state: { trails: [{ ...depthTrail(), assignees: ['grace'] }] } }, { choices: ['clear'] });
		await updateTrail(clear.deps, TRAIL_ROW());
		assert.match(clear.ui.confirmations[0].detail, /All assignees are cleared/);
		assert.deepStrictEqual(clear.cli.state().trails[0].assignees, []);
		const sent = clear.cli.mutations()[0].args;
		assert.deepStrictEqual(sent.slice(-2), ['--assignee', ''], 'the replace flag is empty only for the clear the person chose');

		const add = depthRig({}, { choices: ['addAssignee'], inputs: ['grace'] });
		await updateTrail(add.deps, TRAIL_ROW());
		assert.deepStrictEqual(add.ui.confirmations, []);
		assert.deepStrictEqual(add.cli.state().trails[0].assignees, ['grace']);

		const remove = depthRig({ state: { trails: [{ ...depthTrail(), assignees: ['grace', 'linus'] }] } }, { choices: ['removeAssignee'], inputs: ['grace'] });
		await updateTrail(remove.deps, TRAIL_ROW());
		assert.deepStrictEqual(remove.ui.confirmations, []);
		assert.deepStrictEqual(remove.cli.state().trails[0].assignees, ['linus']);
	});

	test('reports unconfirmed when the CLI succeeds and the fresh read does not show the change', async () => {
		const rig = depthRig({ noEffect: ['trail update'] }, { choices: ['title'], inputs: ['Never lands'] });
		const result = await updateTrail(rig.deps, TRAIL_ROW());

		assert.strictEqual(result, 'unconfirmed');
		assert.match(rig.ui.notices[0].message, /does not show the new title/);
	});

	test('rejects an edit that changes nothing before the CLI is asked anything', async () => {
		const rig = depthRig();
		const outcome = await rig.authoring.update({ kind: 'trail', number: 40 }, {}, ACTING);

		assert.strictEqual(outcome.kind, 'failed');
		assert.deepStrictEqual(rig.cli.calls(), []);
	});

	test('never retries a failure', async () => {
		const rig = depthRig({ fails: { 'trail update': 'permission denied' } }, { choices: ['title'], inputs: ['Nope'] });
		const result = await updateTrail(rig.deps, TRAIL_ROW());

		assert.strictEqual(result, 'failed');
		assert.strictEqual(rig.cli.mutations().length, 1);
		assert.match(rig.ui.notices[0].message, /permission denied/);
	});

	test('keeps the typed title and description out of the reported command line', async () => {
		const rig = depthRig({}, { choices: ['body'], inputs: ['A secret description'] });
		const records: CliInvocation[] = [];
		rig.cli.runner.setSink({ report: invocation => records.push(invocation) });
		await updateTrail(rig.deps, TRAIL_ROW());

		assert.ok(!JSON.stringify(records).includes('secret description'));
		assert.ok(records.some(record => record.args.includes('<redacted>')));
	});

	test('offers only the fields the help lists, and says what to update when the CLI has no trail update', async () => {
		const missing = depthRig({ without: ['trail update'] }, {});
		assert.strictEqual(await updateTrail(missing.deps, TRAIL_ROW()), 'unavailable');
		assert.deepStrictEqual(missing.cli.calls(), []);

		const help = depthRig().cli;
		void help;
		const reduced = depthRig(
			{ helps: { 'trail update': ['entire trail update — Update', '', 'Flags:', '      --title string   Trail title', '', 'Inherited flags:', '      --context name   Act as', ''].join('\n') } },
			{ choices: ['body'] },
		);
		const result = await updateTrail(reduced.deps, TRAIL_ROW());
		assert.strictEqual(result, 'cancelled', 'the description was not on offer, so the choice was not made');
		assert.deepStrictEqual(reduced.cli.mutations(), []);
	});

	test('a collaborator without project access is told so, naming the web UI and the organisation workaround', async () => {
		const rig = depthRig({ projectNotFound: true }, { choices: ['title'], inputs: ['x'] });
		await updateTrail(rig.deps, TRAIL_ROW());

		assert.deepStrictEqual(rig.cli.mutations(), []);
		assert.match(rig.ui.notices[0].message, /has no access to the project/);
		assert.match(rig.ui.notices[0].message, /web UI/);
		assert.match(rig.ui.notices[0].message, /GitHub organisation/);
	});
});

function depthTrail(): Record<string, unknown> {
	return { ...(depthRig().cli.state().trails[0] as Record<string, unknown>) };
}
