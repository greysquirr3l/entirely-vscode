import * as assert from 'assert';

import { applyFinding } from '../commands/trailDepth';
import { DEPTH_HELPS } from './support/trailDepthCli';
import { ACTING, depthRig, threadRow } from './support/trailDepthHarness';

const row = (): unknown => threadRow('finding', { id: '01FIND1', title: 'Unchecked input', state: 'open', severity: 'high' });

suite('Applying a finding\'s suggestion', () => {
	test('is refused while the editor has unsaved changes, names the files, and does not run the CLI at all', async () => {
		const rig = depthRig({}, { unsaved: [{ path: '/w/src/a.ts', name: 'src/a.ts' }, { path: '/w/b.ts', name: 'b.ts' }] });
		const result = await applyFinding(rig.deps, row());

		assert.strictEqual(result, 'failed');
		assert.deepStrictEqual(rig.cli.all(), [], 'not a single call, help lookups included');
		assert.match(rig.ui.notices[0].message, /src\/a\.ts and b\.ts have unsaved changes\. Save or revert them first\./);
		assert.deepStrictEqual(rig.ui.confirmations, []);
	});

	test('checks first, asks second, and applies once, in that order', async () => {
		const rig = depthRig();
		let callsWhenAsked: string[] = [];
		const confirm = rig.ui.confirm.bind(rig.ui);
		rig.ui.confirm = async prompt => {
			callsWhenAsked = rig.cli.calls().map(call => call.line);
			return confirm(prompt);
		};
		const result = await applyFinding(rig.deps, row());

		assert.strictEqual(result, 'done');
		assert.strictEqual(callsWhenAsked.length, 1, 'only the check had run when the question was asked');
		assert.match(callsWhenAsked[0], /^trail finding apply .*--check -- 01FIND1$/);
		const calls = rig.cli.calls();
		const apply = calls.filter(call => call.line.startsWith('trail finding apply'));
		assert.strictEqual(apply.length, 2);
		assert.ok(apply[0].args.includes('--check'));
		assert.ok(!apply[1].args.includes('--check'));
		assert.ok(!apply[1].args.includes('--resolve'));
		assert.strictEqual(apply[1].context, ACTING.name, 'applied as the confirmed login');
		assert.deepStrictEqual(rig.cli.state().applied, ['01FIND1']);
		assert.match(rig.ui.notices[0].message, /The CLI reported the suggestion applied\. Review it in Source Control\./);
		assert.strictEqual(rig.cli.state().findings[0].status, 'open', 'a plain apply does not resolve');
	});

	test('the question names the finding, the login and the folder, and says nothing is committed', async () => {
		const rig = depthRig();
		await applyFinding(rig.deps, row());
		const [question] = rig.ui.confirmations;

		assert.match(question.message, /Apply the suggestion for 'Unchecked input' to your working tree\?/);
		assert.match(question.detail, /Acting as ada/);
		assert.match(question.detail, /files in entirely-vscode/);
		assert.match(question.detail, /does not commit/);
		assert.strictEqual(question.action, 'Apply');
		assert.strictEqual(question.alternative, 'Apply and Resolve');
	});

	test('a failing check stops before the question and the apply, and shows the CLI\'s reason', async () => {
		const rig = depthRig({ fails: { 'trail finding apply --check': 'patch does not apply: the file has changed' } });
		const result = await applyFinding(rig.deps, row());

		assert.strictEqual(result, 'failed');
		assert.deepStrictEqual(rig.ui.confirmations, []);
		assert.deepStrictEqual(rig.cli.state().applied, []);
		assert.strictEqual(rig.cli.calls().filter(call => !call.args.includes('--check') && call.line.startsWith('trail finding apply')).length, 0);
		assert.match(rig.ui.notices[0].message, /your files are untouched: patch does not apply: the file has changed/);
	});

	test('Apply and Resolve passes the resolve flag and reads the status back', async () => {
		const rig = depthRig({}, { confirm: 'alternative' });
		const result = await applyFinding(rig.deps, row());

		assert.strictEqual(result, 'done');
		const applied = rig.cli.calls().filter(call => call.line.startsWith('trail finding apply') && !call.args.includes('--check'));
		assert.strictEqual(applied.length, 1);
		assert.ok(applied[0].args.includes('--resolve'));
		assert.strictEqual(rig.cli.state().findings[0].status, 'resolved');
		assert.match(rig.ui.notices[0].message, /resolved the finding 'Unchecked input' as ada/);
		assert.ok(rig.cli.calls().some(call => call.line.startsWith('trail finding list')), 'the status was read back');
	});

	test('reports unconfirmed when it was asked to resolve and the listing still shows open', async () => {
		const rig = depthRig({ noEffect: ['trail finding apply'] }, { confirm: 'alternative' });
		const result = await applyFinding(rig.deps, row());

		assert.strictEqual(result, 'unconfirmed');
		assert.match(rig.ui.notices[0].message, /still shows the finding as open/);
	});

	test('a declined question runs nothing but the check', async () => {
		const rig = depthRig({}, { confirm: null });
		assert.strictEqual(await applyFinding(rig.deps, row()), 'cancelled');

		const applies = rig.cli.calls().filter(call => call.line.startsWith('trail finding apply'));
		assert.strictEqual(applies.length, 1);
		assert.ok(applies[0].args.includes('--check'));
		assert.deepStrictEqual(rig.cli.state().applied, []);
	});

	test('is unavailable when the help has no check flag, and nothing is applied', async () => {
		const noCheck = DEPTH_HELPS['trail finding apply'].replace(/.*--check.*\n/, '');
		const rig = depthRig({ helps: { 'trail finding apply': noCheck } });
		const result = await applyFinding(rig.deps, row());

		assert.strictEqual(result, 'failed');
		assert.deepStrictEqual(rig.cli.mutations(), []);
		assert.deepStrictEqual(rig.cli.state().applied, []);
		assert.match(rig.ui.notices[0].message, /does not describe the check flag of 'trail finding apply'; update the CLI/);
	});

	test('a CLI with no trail finding apply says what to update', async () => {
		const rig = depthRig({ without: ['trail finding apply'] });
		assert.strictEqual(await applyFinding(rig.deps, row()), 'failed');
		assert.match(rig.ui.notices[0].message, /no 'trail finding apply' command; update the CLI/);
	});

	test('a failure of the apply itself is reported once and not retried', async () => {
		const rig = depthRig({ fails: { 'trail finding apply': 'the patch is stale' } });
		const result = await applyFinding(rig.deps, row());

		assert.strictEqual(result, 'failed');
		assert.strictEqual(rig.cli.calls().filter(call => call.line.startsWith('trail finding apply') && !call.args.includes('--check')).length, 1, 'the apply ran once');
		assert.match(rig.ui.notices[0].message, /the patch is stale/);
		assert.deepStrictEqual(rig.cli.state().applied, []);
	});
});
