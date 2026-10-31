import * as assert from 'assert';

import { setFindingStatus, showFinding, updateFinding } from '../commands/trailDepth';
import type { CliInvocation } from '../services/cli';
import { ACTING, CHANGE_SELECTOR, depthRig, threadRow } from './support/trailDepthHarness';

const OPEN_HIGH = { id: '01FIND1', title: 'Unchecked input', body: 'The input is used before it is checked.', state: 'open', severity: 'high' };
const OPEN_LOW = { id: '01FIND2', title: 'Long line', body: 'A line is too long.', state: 'open', severity: 'low' };
const RESOLVED = { id: '01FIND3', title: 'Old note', state: 'resolved', severity: 'medium' };

const row = (finding: Record<string, unknown>): unknown => threadRow('finding', finding);

suite('Trail finding lifecycle', () => {
	test('resolve is verified through the listing of every status, not the open-only one', async () => {
		const rig = depthRig({}, { inputs: [''] });
		const result = await setFindingStatus(rig.deps, 'resolve', row(OPEN_LOW));

		assert.strictEqual(result, 'done');
		assert.strictEqual(rig.cli.state().findings[1].status, 'resolved');
		const listings = rig.cli.calls().filter(call => call.line.startsWith('trail finding list'));
		assert.ok(listings.length >= 1);
		assert.ok(listings.every(call => call.args.includes('--status') && call.args.includes('any') && call.args.includes('--include-dismissed')));
		const mutations = rig.cli.mutations();
		assert.strictEqual(mutations.length, 1);
		assert.strictEqual(mutations[0].context, ACTING.name);
		assert.deepStrictEqual(mutations[0].args.slice(-2), ['--', '01FIND2']);
		assert.match(rig.ui.notices[0].message, /resolved the finding 'Long line' as ada/);
	});

	test('a resolved finding that drops out of the open-only list is still reported done', async () => {
		const rig = depthRig({}, { inputs: [''] });
		await setFindingStatus(rig.deps, 'resolve', row(OPEN_LOW));
		const openOnly = await rig.depth.runner.runJson(['trail', 'finding', 'list', '--trail', 'entirely-vscode/17', '--json'], value => value, { cwd: rig.cli.dir });
		assert.ok(openOnly.ok);
		assert.ok(!JSON.stringify(openOnly.value).includes('01FIND2'), 'the open-only list no longer holds it');
		assert.strictEqual(rig.ui.notices[0].level, 'info');
	});

	test('dismiss asks only for a high-severity finding', async () => {
		const high = depthRig({}, { inputs: [''] });
		assert.strictEqual(await setFindingStatus(high.deps, 'dismiss', row(OPEN_HIGH)), 'done');
		assert.strictEqual(high.ui.confirmations.length, 1);
		assert.match(high.ui.confirmations[0].message, /Dismiss the high-severity finding 'Unchecked input'/);
		assert.match(high.ui.confirmations[0].detail, /Acting as ada/);
		assert.strictEqual(high.cli.state().findings[0].status, 'dismissed');

		const low = depthRig({}, { inputs: [''] });
		assert.strictEqual(await setFindingStatus(low.deps, 'dismiss', row(OPEN_LOW)), 'done');
		assert.deepStrictEqual(low.ui.confirmations, []);
		assert.strictEqual(low.cli.state().findings[1].status, 'dismissed');
	});

	test('declining the dismissal of a high-severity finding changes nothing', async () => {
		const rig = depthRig({}, { inputs: [''], confirm: null });
		assert.strictEqual(await setFindingStatus(rig.deps, 'dismiss', row(OPEN_HIGH)), 'cancelled');
		assert.deepStrictEqual(rig.cli.mutations(), []);
	});

	test('reopen brings a resolved finding back without asking', async () => {
		const rig = depthRig({}, { inputs: [''] });
		assert.strictEqual(await setFindingStatus(rig.deps, 'reopen', row(RESOLVED)), 'done');
		assert.strictEqual(rig.cli.state().findings[2].status, 'open');
		assert.deepStrictEqual(rig.ui.confirmations, []);
	});

	test('a status the finding already had is unconfirmed, not done', async () => {
		const rig = depthRig({}, { inputs: [''] });
		assert.strictEqual(await setFindingStatus(rig.deps, 'resolve', row(RESOLVED)), 'unconfirmed');
		assert.match(rig.ui.notices[0].message, /already showed as resolved before the request/);
	});

	test('reopen and dismiss the listing does not show are unconfirmed too', async () => {
		const reopen = depthRig({ noEffect: ['trail finding reopen'] }, { inputs: [''] });
		assert.strictEqual(await setFindingStatus(reopen.deps, 'reopen', row(RESOLVED)), 'unconfirmed');
		const dismiss = depthRig({ noEffect: ['trail finding dismiss'] }, { inputs: [''] });
		assert.strictEqual(await setFindingStatus(dismiss.deps, 'dismiss', row(OPEN_LOW)), 'unconfirmed');
	});

	test('a status write the listing does not show is unconfirmed', async () => {
		const rig = depthRig({ noEffect: ['trail finding resolve'] }, { inputs: [''] });
		assert.strictEqual(await setFindingStatus(rig.deps, 'resolve', row(OPEN_LOW)), 'unconfirmed');
		assert.match(rig.ui.notices[0].message, /still shows the finding as open/);
	});

	test('the reason is typed text: sent as its own argument and kept out of the reported command line', async () => {
		const rig = depthRig({}, { inputs: ['a private reason'] });
		const records: CliInvocation[] = [];
		rig.cli.runner.setSink({ report: invocation => records.push(invocation) });
		await setFindingStatus(rig.deps, 'resolve', row(OPEN_LOW));

		const sent = rig.cli.mutations()[0].args;
		assert.deepStrictEqual(sent.slice(sent.indexOf('--message'), sent.indexOf('--message') + 2), ['--message', 'a private reason']);
		assert.ok(!JSON.stringify(records).includes('private reason'));
		assert.ok(!rig.logged.join('\n').includes('private reason'));
	});

	test('no reason is sent when none was typed', async () => {
		const rig = depthRig({}, { inputs: [''] });
		await setFindingStatus(rig.deps, 'resolve', row(OPEN_LOW));
		assert.ok(!rig.cli.mutations()[0].args.includes('--message'));
	});

	test('a finding that is not in the fresh listing is unconfirmed, not done', async () => {
		const rig = depthRig({}, { inputs: [''] });
		const outcome = await rig.findings.setStatus(CHANGE_SELECTOR, '01NOPE', 'resolve', undefined, ACTING);
		assert.strictEqual(outcome.kind, 'failed', 'the CLI does not know the id');
	});

	test('a CLI that lacks the command, or a collaborator with no access, is told so and nothing is sent', async () => {
		const lacking = depthRig({ without: ['trail finding resolve'] }, { inputs: [''] });
		assert.strictEqual(await setFindingStatus(lacking.deps, 'resolve', row(OPEN_LOW)), 'failed');
		assert.deepStrictEqual(lacking.cli.mutations(), []);
		assert.match(lacking.ui.notices[0].message, /update the CLI/);

		const blind = depthRig({ projectNotFound: true }, { inputs: [''] });
		assert.strictEqual(await setFindingStatus(blind.deps, 'resolve', row(OPEN_LOW)), 'failed');
		assert.match(blind.ui.notices[0].message, /has no access to the project/);
		assert.match(blind.ui.notices[0].message, /web UI/);
	});

	test('a failure is reported once and never retried', async () => {
		const rig = depthRig({ fails: { 'trail finding resolve': 'already resolved' } }, { inputs: [''] });
		assert.strictEqual(await setFindingStatus(rig.deps, 'resolve', row(OPEN_LOW)), 'failed');
		assert.strictEqual(rig.cli.mutations().length, 1);
		assert.match(rig.ui.notices[0].message, /already resolved/);
	});
});

suite('Trail finding updates', () => {
	test('a changed severity is verified against the fresh listing', async () => {
		const rig = depthRig({}, { choices: ['severity', 'medium'] });
		const result = await updateFinding(rig.deps, row(OPEN_HIGH));

		assert.strictEqual(result, 'done');
		assert.strictEqual(rig.cli.state().findings[0].severity, 'medium');
		assert.deepStrictEqual(rig.ui.confirmations, [], 'typed fields are reversible');
	});

	test('a changed body is sent as its own argument, prefilled from the finding, and kept out of the log', async () => {
		const rig = depthRig({}, { choices: ['body'], inputs: ['A private rewritten body'] });
		const records: CliInvocation[] = [];
		rig.cli.runner.setSink({ report: invocation => records.push(invocation) });
		const result = await updateFinding(rig.deps, row(OPEN_HIGH));

		assert.strictEqual(result, 'done');
		assert.strictEqual(rig.ui.asked[0].value, OPEN_HIGH.body);
		assert.strictEqual(rig.cli.state().findings[0].body, 'A private rewritten body');
		assert.ok(!JSON.stringify(records).includes('private rewritten'));
	});

	test('a changed confidence is verified and must be between 0 and 1', async () => {
		const rig = depthRig({}, { choices: ['confidence'], inputs: ['0.75'] });
		assert.strictEqual(await updateFinding(rig.deps, row(OPEN_HIGH)), 'done');
		assert.strictEqual(rig.cli.state().findings[0].confidence, 0.75);
	});

	test('an update the listing does not show is unconfirmed', async () => {
		const rig = depthRig({ noEffect: ['trail finding update'] }, { choices: ['severity', 'low'] });
		assert.strictEqual(await updateFinding(rig.deps, row(OPEN_HIGH)), 'unconfirmed');
		assert.match(rig.ui.notices[0].message, /does not show the new severity/);
	});

	test('an update with nothing to change is refused before the CLI is asked', async () => {
		const rig = depthRig();
		const outcome = await rig.findings.update(CHANGE_SELECTOR, '01FIND1', {}, ACTING);
		assert.strictEqual(outcome.kind, 'failed');
		assert.deepStrictEqual(rig.cli.calls(), []);
	});

	test('offers only the fields the help lists', async () => {
		const rig = depthRig({ helps: { 'trail finding update': ['entire trail finding update — Update', '', 'Flags:', '  -m, --body string   Finding body', '', 'Inherited flags:', '      --trail string   The trail', ''].join('\n') } }, { choices: ['severity'] });
		const options = await rig.findings.updateOptions();
		assert.ok(options.ok);
		assert.deepStrictEqual(options.fields, ['body']);
		assert.strictEqual(await updateFinding(rig.deps, row(OPEN_HIGH)), 'cancelled');
	});
});

suite('Trail finding documents', () => {
	test('show opens the CLI\'s own text in a document and logs none of it', async () => {
		const rig = depthRig();
		assert.strictEqual(await showFinding(rig.deps, row(OPEN_HIGH)), 'done');
		const [shown] = rig.ui.shown;
		assert.strictEqual(shown.kind, 'trail-finding');
		assert.match(shown.text, /Finding 01FIND1/);
		assert.ok(!rig.logged.join('\n').includes('Finding 01FIND1'));
	});

	test('a finding the CLI cannot show is reported in its words (trail finding show)', async () => {
		const rig = depthRig({ fails: { 'trail finding show': 'finding not found' } });
		assert.strictEqual(await showFinding(rig.deps, row(OPEN_HIGH)), 'failed');
		assert.match(rig.ui.notices[0].message, /finding not found/);
	});
});
