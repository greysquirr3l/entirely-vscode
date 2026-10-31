import * as assert from 'assert';

import {
	deleteMessage,
	editMessage,
	replyToDiscussion,
	setDiscussionResolved,
	showDiscussion,
	startDiscussion,
} from '../commands/trailDepth';
import { AGENT_SESSION_REFUSAL } from '../lib/entire';
import type { CliInvocation, CliInvocationBodies } from '../services/cli';
import { ACTING, CHANGE_SELECTOR, changeRow, depthRig, threadRow } from './support/trailDepthHarness';

const DISCUSSION = { id: '01DISC1', title: 'Naming', resolved: false, lastMessageAuthor: 'ada', messageCount: 2 };

const row = (): unknown => threadRow('discussion', DISCUSSION);

suite('Trail discussion writes', () => {
	test('start sends the text once as the confirmed login and reports it under the acting handle', async () => {
		const rig = depthRig({}, { inputs: ['A new concern', 'Concern title'] });
		const result = await startDiscussion(rig.deps, changeRow());

		assert.strictEqual(result, 'done');
		assert.deepStrictEqual(rig.ui.confirmations, [], 'typing the text is the consent');
		const mutations = rig.cli.mutations();
		assert.strictEqual(mutations.length, 1);
		assert.strictEqual(mutations[0].context, ACTING.name);
		assert.ok(mutations[0].args.includes('A new concern'));
		assert.match(rig.ui.notices[0].message, /started a discussion on .* as ada/);
		assert.ok(rig.cli.state().discussions.some(discussion => discussion.title === 'Concern title'));
		assert.strictEqual(rig.threadsChanged[0], 'entirely-vscode/17');
	});

	test('start reports a discussion the CLI recorded under another handle as that handle\'s', async () => {
		const rig = depthRig({ author: 'grace' }, { inputs: ['Hello', ''] });
		const result = await startDiscussion(rig.deps, changeRow());

		assert.strictEqual(result, 'unconfirmed');
		assert.match(rig.ui.notices[0].message, /recorded it under grace rather than the login Entirely acted as/);
	});

	test('start is unconfirmed when the listing shows no new discussion', async () => {
		const rig = depthRig({ noEffect: ['trail comment add'] }, { inputs: ['Hello', ''] });
		assert.strictEqual(await startDiscussion(rig.deps, changeRow()), 'unconfirmed');
	});

	test('a refusal from an agent session says the CLI allows discussion writes only to people, and posts no finding', async () => {
		const rig = depthRig({ agentRefusal: true }, { inputs: ['Hello', ''] });
		const result = await startDiscussion(rig.deps, changeRow());

		assert.strictEqual(result, 'failed');
		assert.ok(rig.ui.notices[0].message.includes(AGENT_SESSION_REFUSAL));
		assert.strictEqual(rig.cli.mutations().length, 1, 'nothing was retried');
		assert.ok(rig.cli.calls().every(call => !call.line.startsWith('trail finding')), 'nothing was redirected to a finding');
	});

	test('reply is reported when the count grew by one and the last message is the acting handle\'s', async () => {
		const rig = depthRig({}, { inputs: ['Agreed'] });
		const result = await replyToDiscussion(rig.deps, row());

		assert.strictEqual(result, 'done');
		const mutation = rig.cli.mutations()[0];
		assert.deepStrictEqual(mutation.args.slice(-2), ['--', '01DISC1']);
		assert.strictEqual(rig.cli.state().discussions[0].messageCount, 3);
		assert.match(rig.ui.notices[0].message, /replied to the discussion 'Naming' as ada/);
	});

	test('a reply recorded under another handle is reported as that handle\'s', async () => {
		const rig = depthRig({ author: 'grace' }, { inputs: ['Agreed'] });
		const result = await replyToDiscussion(rig.deps, row());

		assert.strictEqual(result, 'unconfirmed');
		assert.match(rig.ui.notices[0].message, /recorded it under grace/);
	});

	test('a reply the listing does not show is unconfirmed', async () => {
		const rig = depthRig({ noEffect: ['trail comment reply'] }, { inputs: ['Agreed'] });
		assert.strictEqual(await replyToDiscussion(rig.deps, row()), 'unconfirmed');
	});

	test('reply text is never logged: not in the reported command line, nor in the bodies', async () => {
		const rig = depthRig({}, { inputs: ['a very private reply'] });
		const records: { invocation: CliInvocation; bodies: CliInvocationBodies }[] = [];
		rig.cli.runner.setSink({ report: (invocation, bodies) => records.push({ invocation, bodies }) });
		await replyToDiscussion(rig.deps, row());

		assert.ok(!JSON.stringify(records).includes('private reply'));
		assert.ok(!rig.logged.join('\n').includes('private reply'));
	});

	test('edit offers only the acting handle\'s messages and the new text replaces the old after input', async () => {
		const rig = depthRig({}, { inputs: ['Yes, done now.'] });
		const result = await editMessage(rig.deps, row());

		assert.strictEqual(result, 'done');
		assert.strictEqual(rig.ui.asked[0].value, 'Yes, I will do it.', 'the box is prefilled with the current text');
		const mutation = rig.cli.mutations()[0];
		assert.deepStrictEqual(mutation.args.slice(-3), ['--', '01DISC1', '01MSG2'], 'the message of grace was not offered');
		assert.strictEqual(rig.cli.state().discussions[0].messages[1].body, 'Yes, done now.');
		assert.deepStrictEqual(rig.ui.confirmations, []);
	});

	test('edit is unconfirmed when the fresh discussion does not show the new text', async () => {
		const rig = depthRig({ noEffect: ['trail comment edit'] }, { inputs: ['Never lands'] });
		assert.strictEqual(await editMessage(rig.deps, row()), 'unconfirmed');
	});

	test('edit with the same text sends nothing', async () => {
		const rig = depthRig({}, { inputs: ['Yes, I will do it.'] });
		assert.strictEqual(await editMessage(rig.deps, row()), 'cancelled');
		assert.deepStrictEqual(rig.cli.mutations(), []);
	});

	test('edit with none of the acting handle\'s messages says so and sends nothing', async () => {
		const rig = depthRig({ author: 'linus' }, { inputs: ['x'] });
		rig.cli.setState(state => {
			state.discussions[0].messages = [state.discussions[0].messages[0]];
		});
		assert.strictEqual(await editMessage(rig.deps, row()), 'cancelled');
		assert.deepStrictEqual(rig.cli.mutations(), []);
		assert.match(rig.ui.notices[0].message, /None of the messages .* is ada's/);
	});

	test('a discussion the CLI answers in a form Entirely does not read gives a message and the command to copy', async () => {
		const rig = depthRig({ showShape: 'unreadable' }, { inputs: ['x'] });
		assert.strictEqual(await editMessage(rig.deps, row()), 'failed');

		assert.deepStrictEqual(rig.cli.mutations(), []);
		assert.match(rig.ui.notices[0].message, /form this version of Entirely does not read/);
		assert.match(rig.ui.notices[0].copy ?? '', /^entire trail comment show .*--json.* -- 01DISC1$/);
	});

	test('delete asks with the strictest wording and passes the force flag only after the answer', async () => {
		const rig = depthRig({}, { pickIndex: 0 });
		let mutationsWhenAsked = -1;
		const confirm = rig.ui.confirm.bind(rig.ui);
		rig.ui.confirm = async prompt => {
			mutationsWhenAsked = rig.cli.mutations().length;
			return confirm(prompt);
		};
		const result = await deleteMessage(rig.deps, row());

		assert.strictEqual(result, 'done');
		assert.strictEqual(mutationsWhenAsked, 0, 'nothing ran before the question');
		const [question] = rig.ui.confirmations;
		assert.strictEqual(question.message, "Delete this message from the discussion 'Naming' on shape-probe (entirely-vscode/17) — Shape the thing?");
		assert.match(question.detail, /Acting as ada/);
		assert.match(question.detail, /The message is by grace: "Should this be renamed\?"\./);
		assert.match(question.detail, /removed on Entire for everyone and cannot be recovered from the editor/);
		assert.strictEqual(question.action, 'Delete Message');
		const mutations = rig.cli.mutations();
		assert.strictEqual(mutations.length, 1);
		assert.ok(mutations[0].args.includes('--force'));
		assert.deepStrictEqual(mutations[0].args.slice(-3), ['--', '01DISC1', '01MSG1']);
		assert.ok(!rig.cli.state().discussions[0].messages.some(message => message.id === '01MSG1'));
	});

	test('a message that is not in the discussion is not deleted, and nothing is sent', async () => {
		const rig = depthRig();
		const outcome = await rig.discussions.write(CHANGE_SELECTOR, { kind: 'delete', id: '01DISC1', messageId: '01NOPE' }, ACTING);
		assert.strictEqual(outcome.kind, 'failed');
		assert.deepStrictEqual(rig.cli.mutations(), []);
	});

	test('resolving a discussion that was already resolved is unconfirmed, not done', async () => {
		const rig = depthRig();
		rig.cli.setState(state => {
			state.discussions[0].resolved = true;
		});
		assert.strictEqual(await setDiscussionResolved(rig.deps, true, row()), 'unconfirmed');
		assert.match(rig.ui.notices[0].message, /already showed as resolved before the request/);
	});

	test('a declined delete deletes nothing', async () => {
		const rig = depthRig({}, { confirm: null });
		assert.strictEqual(await deleteMessage(rig.deps, row()), 'cancelled');
		assert.deepStrictEqual(rig.cli.mutations(), []);
		assert.strictEqual(rig.cli.state().discussions[0].messages.length, 2);
	});

	test('delete is reported only when the fresh discussion no longer holds the message', async () => {
		const rig = depthRig({ noEffect: ['trail comment delete'] });
		assert.strictEqual(await deleteMessage(rig.deps, row()), 'unconfirmed');
		assert.match(rig.ui.notices[0].message, /still in the discussion/);
	});

	test('resolve and reopen are verified against the fresh flag', async () => {
		const rig = depthRig();
		assert.strictEqual(await setDiscussionResolved(rig.deps, true, row()), 'done');
		assert.strictEqual(rig.cli.state().discussions[0].resolved, true);
		assert.deepStrictEqual(rig.ui.confirmations, [], 'a reversible toggle does not ask');
		assert.strictEqual(await setDiscussionResolved(rig.deps, false, row()), 'done');
		assert.strictEqual(rig.cli.state().discussions[0].resolved, false);

		const stuck = depthRig({ noEffect: ['trail comment resolve'] });
		assert.strictEqual(await setDiscussionResolved(stuck.deps, true, row()), 'unconfirmed');
		assert.match(stuck.ui.notices[0].message, /still shows as open/);

		const resolved = depthRig({ noEffect: ['trail comment unresolve'], state: { discussions: [{ id: '01DISC1', title: 'Naming', resolved: true, lastMessageAuthor: 'ada', messageCount: 1, messages: [{ id: '01MSG1', author: 'ada', body: 'x', createdAt: '2026-10-02T10:00:00Z' }] }] } });
		assert.strictEqual(await setDiscussionResolved(resolved.deps, false, row()), 'unconfirmed');
		assert.match(resolved.ui.notices[0].message, /still shows as resolved/);
	});

	test('a refusal from an agent session on reply, edit, delete and resolve is reported with no retry and no finding', async () => {
		for (const flow of [
			(rig: ReturnType<typeof depthRig>) => replyToDiscussion(rig.deps, row()),
			(rig: ReturnType<typeof depthRig>) => editMessage(rig.deps, row()),
			(rig: ReturnType<typeof depthRig>) => deleteMessage(rig.deps, row()),
			(rig: ReturnType<typeof depthRig>) => setDiscussionResolved(rig.deps, true, row()),
		]) {
			const rig = depthRig({ agentRefusal: true }, { inputs: ['changed text'] });
			assert.strictEqual(await flow(rig), 'failed');
			assert.ok(rig.ui.notices.some(notice => notice.message.includes(AGENT_SESSION_REFUSAL)));
			assert.strictEqual(rig.cli.mutations().length, 1);
			assert.ok(rig.cli.calls().every(call => !call.line.startsWith('trail finding')));
		}
	});

	test('a collaborator without project access is told so before anything is sent', async () => {
		const rig = depthRig({ projectNotFound: true }, { inputs: ['Hello'] });
		const result = await replyToDiscussion(rig.deps, row());

		assert.strictEqual(result, 'failed');
		assert.deepStrictEqual(rig.cli.mutations(), []);
		assert.match(rig.ui.notices[0].message, /has no access to the project/);
	});

	test('a CLI without the command says what to update and sends nothing', async () => {
		const rig = depthRig({ without: ['trail comment reply'] }, { inputs: ['Hello'] });
		assert.strictEqual(await replyToDiscussion(rig.deps, row()), 'failed');
		assert.deepStrictEqual(rig.cli.mutations(), []);
		assert.match(rig.ui.notices[0].message, /update the CLI/);
	});

	test('refuses an id that starts with a dash before the CLI sees it', async () => {
		const rig = depthRig();
		const outcome = await rig.discussions.write(CHANGE_SELECTOR, { kind: 'reply', id: '--force', body: 'x' }, ACTING);
		assert.strictEqual(outcome.kind, 'failed');
		assert.deepStrictEqual(rig.cli.calls(), []);
	});

	test('shows a discussion in a document with every CLI value escaped', async () => {
		const rig = depthRig();
		rig.cli.setState(state => {
			state.discussions[0].messages[0].body = '# heading [x](https://evil.invalid) <script>1</script>';
			state.discussions[0].messages[0].author = '*grace*';
		});
		assert.strictEqual(await showDiscussion(rig.deps, row()), 'done');

		const [shown] = rig.ui.shown;
		assert.strictEqual(shown.kind, 'trail-discussion');
		assert.ok(!shown.text.includes('<script>'));
		assert.ok(!/(^|\n)# heading/.test(shown.text));
		assert.ok(!shown.text.includes('[x](https://evil.invalid)'));
		assert.ok(!rig.logged.join('\n').includes('heading'));
	});

	test('from the palette it asks which discussion, and says so when there are none', async () => {
		const rig = depthRig({}, { inputs: ['Agreed'] });
		assert.strictEqual(await replyToDiscussion(rig.deps, changeRow()), 'done', 'picked the first discussion of the change');

		const empty = depthRig({ state: { discussions: [] } }, { inputs: ['Agreed'] });
		assert.strictEqual(await replyToDiscussion(empty.deps, changeRow()), 'cancelled');
		assert.match(empty.ui.notices[0].message, /no discussions/);
	});

	test('a second change while one is running is refused', async () => {
		const rig = depthRig({}, { inputs: ['Agreed', 'Agreed'] });
		const first = replyToDiscussion(rig.deps, row());
		const second = await replyToDiscussion(rig.deps, row());
		assert.strictEqual(second, 'busy');
		await first;
	});
});
