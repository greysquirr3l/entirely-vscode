import * as assert from 'assert';

import {
	AGENT_SESSION_REFUSAL,
	confirmTrailDepth,
	decodeDiscussion,
	describeApplyRefusal,
	describeDepthFailure,
	describeDepthOutcome,
	describeWatchState,
	discussionMarkdown,
	isAgentSessionRefusal,
	isOperandId,
	isOwnMessage,
	isWatchEnd,
	mayEditMessage,
	parseWatchLine,
	requiresConfirmation,
	validateOperandId,
	type DepthAction,
} from '../lib/entire';

const ACTING = { name: 'ada@us.auth.entire.io', handle: 'ada' };

const ACTIONS: Record<string, DepthAction> = {
	create: { kind: 'create-trail', title: 'Fix', intentOnly: false, repository: 'gh/o/r' },
	close: { kind: 'update-trail', trail: 'trail #40', edit: { status: 'closed' } },
	replace: { kind: 'update-trail', trail: 'trail #40', edit: { assignees: ['a'] } },
	clear: { kind: 'update-trail', trail: 'trail #40', edit: { assignees: [] } },
	delete: { kind: 'delete-message', discussion: 'Naming', change: 'repo/17' },
	dismissHigh: { kind: 'dismiss-finding', finding: 'f', severity: 'high' },
	apply: { kind: 'apply-finding', finding: 'f', folder: 'entirely' },
	dismissLow: { kind: 'dismiss-finding', finding: 'f', severity: 'low' },
	dismissUnknown: { kind: 'dismiss-finding', finding: 'f' },
	title: { kind: 'update-trail', trail: 'trail #40', edit: { title: 'New' } },
	reopenTrail: { kind: 'update-trail', trail: 'trail #40', edit: { status: 'open' } },
	addAssignee: { kind: 'update-trail', trail: 'trail #40', edit: { addAssignees: ['b'] } },
	removeAssignee: { kind: 'update-trail', trail: 'trail #40', edit: { removeAssignees: ['b'] } },
	reply: { kind: 'reply-discussion', target: 'Naming' },
	start: { kind: 'start-discussion', target: 'repo/17' },
	edit: { kind: 'edit-message', target: 'Naming' },
	resolveDiscussion: { kind: 'resolve-discussion', target: 'Naming' },
	reopenDiscussion: { kind: 'reopen-discussion', target: 'Naming' },
	resolveFinding: { kind: 'resolve-finding', target: 'f' },
	reopenFinding: { kind: 'reopen-finding', target: 'f' },
	updateFinding: { kind: 'update-finding', target: 'f' },
	watch: { kind: 'watch-change', target: 'repo/17' },
};

suite('Trail depth confirmation', () => {
	test('asks for creating, closing, replacing the assignees, deleting, dismissing a high finding and applying', () => {
		for (const name of ['create', 'close', 'replace', 'clear', 'delete', 'dismissHigh', 'apply']) {
			assert.strictEqual(requiresConfirmation(ACTIONS[name]), true, name);
			assert.ok(confirmTrailDepth(ACTIONS[name], ACTING), name);
		}
	});

	test('does not ask for the actions the typed text consents to', () => {
		for (const name of ['title', 'reopenTrail', 'addAssignee', 'removeAssignee', 'reply', 'start', 'edit', 'resolveDiscussion', 'reopenDiscussion', 'resolveFinding', 'reopenFinding', 'updateFinding', 'watch', 'dismissLow', 'dismissUnknown']) {
			assert.strictEqual(requiresConfirmation(ACTIONS[name]), false, name);
			assert.strictEqual(confirmTrailDepth(ACTIONS[name], ACTING), undefined, name);
		}
	});

	test('every question names the target, the acting login and says it is on Entire', () => {
		const targets: Record<string, string> = {
			create: 'Fix',
			close: 'trail #40',
			replace: 'trail #40',
			delete: 'Naming',
			dismissHigh: 'f',
		};
		for (const [name, target] of Object.entries(targets)) {
			const question = confirmTrailDepth(ACTIONS[name], ACTING);
			assert.ok(question);
			const text = `${question.message} ${question.detail}`;
			assert.ok(text.includes(target), `${name} names ${target}`);
			assert.ok(text.includes('ada'), `${name} names the login`);
			assert.match(text, /on Entire/, name);
		}
	});

	test('creating says what is published and that nothing is committed or checked out', () => {
		const question = confirmTrailDepth({ ...ACTIONS.create, branch: 'shape-probe' } as DepthAction, ACTING);
		assert.ok(question);
		assert.match(question.detail, /publishes your branch shape-probe to the remote/);
		assert.match(question.detail, /does not commit your changes or change your checkout/);
		const intent = confirmTrailDepth({ kind: 'create-trail', title: 'Idea', intentOnly: true, repository: 'gh/o/r' }, ACTING);
		assert.match(intent?.detail ?? '', /No branch is published/);
	});

	test('closing and replacing show the old and the new value', () => {
		const close = confirmTrailDepth({ kind: 'update-trail', trail: 'trail #40', edit: { status: 'closed' }, before: { status: 'open' } }, ACTING);
		assert.match(close?.detail ?? '', /from open to closed/);
		const replace = confirmTrailDepth({ kind: 'update-trail', trail: 'trail #40', edit: { assignees: ['b', 'c'] }, before: { assignees: ['a'] } }, ACTING);
		assert.match(replace?.detail ?? '', /it is a now and becomes b, c/);
		const clear = confirmTrailDepth({ kind: 'update-trail', trail: 'trail #40', edit: { assignees: [] }, before: { assignees: ['a'] } }, ACTING);
		assert.match(clear?.detail ?? '', /All assignees are cleared/);
	});

	test('a deletion has the strictest wording and its own button', () => {
		const question = confirmTrailDepth(ACTIONS.delete, ACTING);
		assert.ok(question);
		assert.strictEqual(question.message, "Delete this message from the discussion 'Naming' on repo/17?");
		assert.match(question.detail, /removed on Entire for everyone and cannot be recovered from the editor/);
		assert.strictEqual(question.action, 'Delete Message');
	});

	test('an apply offers to resolve too, and says it changes the working tree and not Entire', () => {
		const question = confirmTrailDepth(ACTIONS.apply, ACTING);
		assert.ok(question);
		assert.strictEqual(question.action, 'Apply');
		assert.strictEqual(question.alternative, 'Apply and Resolve');
		assert.match(question.detail, /does not commit/);
		assert.match(question.detail, /Source Control/);
	});

	test('the acting login is named with its login when the two differ', () => {
		const question = confirmTrailDepth(ACTIONS.delete, ACTING);
		assert.match(question?.detail ?? '', /ada \(login ada@us\.auth\.entire\.io\)/);
	});
});

suite('Trail depth ids', () => {
	test('an id that starts with a dash, holds a space or a control character, or is empty or long is refused', () => {
		for (const bad of ['', '-x', '--flag', 'a b', 'a\tb', 'a\u0000b', 'a\nb', 'x'.repeat(129)]) {
			assert.ok(validateOperandId(bad), JSON.stringify(bad));
			assert.strictEqual(isOperandId(bad), false);
		}
	});

	test('an id the CLI wrote is accepted, with dashes inside it', () => {
		for (const good of ['01M62YAQVTG0WN2J6G7149VCK9', '3f2a-4b1c-9d', 'a.b_c:d']) {
			assert.strictEqual(validateOperandId(good), undefined);
		}
	});
});

suite('Trail depth discussions', () => {
	test('reads the messages of a discussion, with their authors', () => {
		const view = decodeDiscussion({
			title: 'Naming',
			messages: [
				{ id: 'm1', author: 'grace', body: 'Rename?', createdAt: '2026-10-02T10:00:00Z' },
				{ id: 'm2', author: { login: 'ada' }, text: 'Yes' },
			],
		});
		assert.strictEqual(view.title, 'Naming');
		assert.deepStrictEqual(view.messages?.map(message => [message.id, message.author, message.body]), [
			['m1', 'grace', 'Rename?'],
			['m2', 'ada', 'Yes'],
		]);
	});

	test('tolerates missing fields and shapes it does not read', () => {
		assert.deepStrictEqual(decodeDiscussion({ messages: [{ id: 'm1' }] }).messages, [{ id: 'm1', author: undefined, body: undefined, createdAt: undefined }]);
		assert.strictEqual(decodeDiscussion({ messages: 'none' }).messages, undefined);
		assert.strictEqual(decodeDiscussion({ messages: [{ no: 'id' }] }).messages, undefined);
		assert.deepStrictEqual(decodeDiscussion({ messages: [] }).messages, []);
		assert.strictEqual(decodeDiscussion(null).messages, undefined);
		assert.strictEqual(decodeDiscussion('text').messages, undefined);
		assert.strictEqual(decodeDiscussion({ discussion: { id: 'd', text: 'x' } }).messages, undefined);
		assert.strictEqual(decodeDiscussion({ discussion: { messages: [{ id: 'a', author: 'x' }] } }).messages?.length, 1);
		assert.strictEqual(decodeDiscussion([{ id: 'a' }]).messages?.length, 1);
	});

	test('a message is the acting handle\'s only when its author is, and is offered for editing when it names none', () => {
		assert.strictEqual(isOwnMessage({ id: 'm', author: 'ada' }, 'ada'), true);
		assert.strictEqual(isOwnMessage({ id: 'm', author: 'ada2' }, 'ada'), false);
		assert.strictEqual(isOwnMessage({ id: 'm' }, 'ada'), false);
		assert.strictEqual(mayEditMessage({ id: 'm' }, 'ada'), true);
		assert.strictEqual(mayEditMessage({ id: 'm', author: 'grace' }, 'ada'), false);
		assert.strictEqual(mayEditMessage({ id: 'm', author: 'ada' }, 'ada'), true);
	});

	test('the document escapes everything that came from the CLI', () => {
		const text = discussionMarkdown('repo/17 <b>', '[click](https://evil.invalid)', {
			messages: [{ id: 'm', author: '*bold*', body: '# heading\n[link](https://evil.invalid) <script>alert(1)</script>', createdAt: '2026-10-02' }],
		});
		assert.ok(!/(^|\n)# heading/.test(text));
		assert.ok(!text.includes('[link](https://evil.invalid)'));
		assert.ok(!text.includes('<script>'));
		assert.ok(!text.includes('<b>'));
		assert.match(text, /\\\[link\\\]/);
		assert.match(discussionMarkdown('c', undefined, { messages: undefined }), /does not read/);
		assert.match(discussionMarkdown('c', undefined, { messages: [] }), /no messages/);
	});
});

suite('Trail depth failures', () => {
	test('the observed refusal and any stderr naming an agent session with a refusal are recognised', () => {
		assert.strictEqual(isAgentSessionRefusal('Error: refusing `entire trail comment add`: use a finding'), true);
		assert.strictEqual(isAgentSessionRefusal('refusing `entire trail comment reply`: agent session'), true);
		assert.strictEqual(isAgentSessionRefusal('this is an agent session; the CLI refuses discussion writes'), true);
		assert.strictEqual(isAgentSessionRefusal('project not found'), false);
		assert.strictEqual(isAgentSessionRefusal('an agent session is running'), false);
	});

	test('project not found is the honest access message: login, project, web UI, organisation, no grant advice', () => {
		const text = describeDepthFailure('exit 1', 'Using context x\nError: project not found', { project: 'gh/someone', login: 'ada' });
		assert.match(text, /ada/);
		assert.match(text, /gh\/someone/);
		assert.match(text, /web UI/);
		assert.match(text, /GitHub organisation/);
		assert.match(text, /how the CLI and the forge behave/);
		assert.match(text, /entirely\.cliContext/);
		assert.doesNotMatch(text, /grant/i);
		assert.match(describeDepthFailure('x', 'project is not accessible', {}), /has no access to the project that holds this trail/);
	});

	test('an agent session refusal says the CLI allows discussion writes only to people', () => {
		assert.strictEqual(describeDepthFailure('x', 'refusing `entire trail comment reply`: agent session'), AGENT_SESSION_REFUSAL);
		assert.match(AGENT_SESSION_REFUSAL, /only lets people write/);
	});

	test('a command or flag the CLI does not know says to update it, and a blocked keyring is not a sign-out', () => {
		assert.match(describeDepthFailure('x', 'unknown flag: --check'), /update the CLI/);
		const sandbox = describeDepthFailure('x', 'the Keychain is not accessible');
		assert.match(sandbox, /sandboxed/);
		assert.doesNotMatch(sandbox, /entire login/);
	});

	test('anything else is the CLI\'s own reason, or the run\'s account when it said nothing', () => {
		assert.strictEqual(describeDepthFailure('exit 1', 'Using context x\nA Change already exists for this branch\n'), 'A Change already exists for this branch');
		assert.strictEqual(describeDepthFailure('the command exited with code 3', ''), 'the command exited with code 3');
	});

	test('an apply refused for unsaved work names every file', () => {
		assert.strictEqual(
			describeApplyRefusal([{ path: '/w/a.ts', name: 'a.ts' }]),
			'Entirely will not apply a suggestion while a.ts has unsaved changes. Save or revert it first.',
		);
		assert.match(describeApplyRefusal([{ path: '/w/a.ts', name: 'a.ts' }, { path: '/w/b.ts', name: 'b.ts' }]), /a\.ts and b\.ts have unsaved/);
	});
});

suite('Trail depth outcomes', () => {
	const subject = { past: "replied to the discussion 'X'", ask: "reply to the discussion 'X'" };

	test('each outcome says what happened and as whom', () => {
		assert.strictEqual(describeDepthOutcome(subject, { kind: 'done' }, ACTING), "Entirely replied to the discussion 'X' as ada (login ada@us.auth.entire.io).");
		assert.match(describeDepthOutcome(subject, { kind: 'other-author', author: 'grace' }, ACTING), /recorded it under grace rather than the login Entirely acted as/);
		assert.match(describeDepthOutcome(subject, { kind: 'unconfirmed', detail: 'Check.' }, ACTING), /a fresh read did not show it\. Check\./);
		assert.match(describeDepthOutcome(subject, { kind: 'partly-done', advice: 'Link it.' }, ACTING), /part of it is there\. Link it\./);
		assert.match(describeDepthOutcome(subject, { kind: 'failed', detail: 'no.' }, ACTING), /could not reply to the discussion 'X' as ada.*: no\./);
	});
});

suite('Trail watch events', () => {
	test('reads the event name from the first of event, type and event_type', () => {
		assert.deepStrictEqual(parseWatchLine('{"event":"ready","trail":"x"}'), { kind: 'ready', name: 'ready' });
		assert.deepStrictEqual(parseWatchLine('{"type":"finding.created"}'), { kind: 'event', name: 'finding.created' });
		assert.deepStrictEqual(parseWatchLine('{"event_type":"forbidden"}'), { kind: 'forbidden', name: 'forbidden' });
		assert.deepStrictEqual(parseWatchLine('{"event":"reconnect","type":"x"}'), { kind: 'reconnect', name: 'reconnect' });
		assert.deepStrictEqual(parseWatchLine('{"event":"error"}'), { kind: 'error', name: 'error' });
		assert.strictEqual(parseWatchLine('{"event":"ping"}')?.kind, 'ping');
	});

	test('a line it cannot read is some event, and a blank line is nothing', () => {
		assert.deepStrictEqual(parseWatchLine('{"unknown":1}'), { kind: 'event' });
		assert.deepStrictEqual(parseWatchLine('{not json'), { kind: 'event' });
		assert.deepStrictEqual(parseWatchLine('[1,2]'), { kind: 'event' });
		assert.deepStrictEqual(parseWatchLine('something happened'), { kind: 'event' });
		assert.strictEqual(parseWatchLine('   '), undefined);
		assert.strictEqual(parseWatchLine(''), undefined);
	});

	test('plain text lines that name a known event are classified', () => {
		assert.strictEqual(parseWatchLine('ready')?.kind, 'ready');
		assert.strictEqual(parseWatchLine('event: forbidden')?.kind, 'forbidden');
	});

	test('only a revoked access ends a watch, and the payload is never kept', () => {
		assert.strictEqual(isWatchEnd({ kind: 'forbidden' }), true);
		for (const kind of ['ready', 'event', 'reconnect', 'error', 'ping'] as const) {
			assert.strictEqual(isWatchEnd({ kind }), false);
		}
		assert.deepStrictEqual(Object.keys(parseWatchLine('{"event":"x","body":"secret review text"}') ?? {}).sort(), ['kind', 'name']);
	});

	test('describes where a watch is', () => {
		assert.strictEqual(describeWatchState(undefined), undefined);
		assert.strictEqual(describeWatchState({ kind: 'starting' }), 'starting to watch');
		assert.strictEqual(describeWatchState({ kind: 'watching', updates: 0 }), 'watching');
		assert.strictEqual(describeWatchState({ kind: 'watching', updates: 1 }), 'watching · 1 update');
		assert.strictEqual(describeWatchState({ kind: 'watching', updates: 3 }), 'watching · 3 updates');
		assert.strictEqual(describeWatchState({ kind: 'ended', reason: 'the stream ended' }), 'watch ended: the stream ended');
	});
});
