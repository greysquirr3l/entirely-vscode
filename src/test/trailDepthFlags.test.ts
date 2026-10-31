import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
	anyStatusValue,
	changedFields,
	choicesOf,
	discussionArguments,
	findingArguments,
	planDiscussionWrite,
	planFindingApply,
	planFindingList,
	planFindingWrite,
	planJsonRead,
	planTrailCreate,
	planTrailUpdate,
	planWatch,
	trailCreateArguments,
	trailUpdateArguments,
	typedFlags,
	watchArguments,
} from '../lib/entire';
import { END_OF_OPTIONS } from '../lib/entire/operand';
import { DEPTH_HELPS } from './support/trailDepthCli';

const ROOT = path.resolve(__dirname, '..', '..');

function flagsOf(picked: { ok: boolean }): Record<string, string | undefined> {
	assert.ok(picked.ok, JSON.stringify(picked));
	return (picked as unknown as { flags: Record<string, string | undefined> }).flags;
}

suite('Trail depth flags are read from the CLI help', () => {
	test('trail create finds the title, body, type, priority and no-branch flags', () => {
		const flags = flagsOf(planTrailCreate(DEPTH_HELPS['trail create'], true));
		assert.deepStrictEqual(flags, {
			title: '--title',
			body: '--body',
			type: '--type',
			priority: '--priority',
			noBranch: '--no-branch',
		});
	});

	test('trail update finds every field and the three assignee flags', () => {
		const flags = flagsOf(planTrailUpdate(DEPTH_HELPS['trail update'], []));
		assert.strictEqual(flags.title, '--title');
		assert.strictEqual(flags.body, '--body');
		assert.strictEqual(flags.status, '--status');
		assert.strictEqual(flags.assignee, '--assignee');
		assert.strictEqual(flags.addAssignee, '--add-assignee');
		assert.strictEqual(flags.removeAssignee, '--remove-assignee');
	});

	test('the discussion writes find the body, title and force flags', () => {
		assert.deepStrictEqual(flagsOf(planDiscussionWrite('trail comment add', DEPTH_HELPS['trail comment add'], { body: true, force: false })), {
			body: '--body',
			title: '--title',
		});
		assert.strictEqual(flagsOf(planDiscussionWrite('trail comment delete', DEPTH_HELPS['trail comment delete'], { body: false, force: true })).force, '--force');
		assert.strictEqual(flagsOf(planJsonRead('trail comment show', DEPTH_HELPS['trail comment show'])).json, '--json');
	});

	test('the finding commands find their flags', () => {
		const list = flagsOf(planFindingList(DEPTH_HELPS['trail finding list']));
		assert.deepStrictEqual(list, { json: '--json', status: '--status', includeDismissed: '--include-dismissed' });
		const update = flagsOf(planFindingWrite('trail finding update', DEPTH_HELPS['trail finding update'], ['body', 'severity', 'confidence']));
		assert.strictEqual(update.body, '--body');
		assert.strictEqual(update.severity, '--severity');
		assert.strictEqual(update.confidence, '--confidence');
		assert.strictEqual(flagsOf(planFindingWrite('trail finding dismiss', DEPTH_HELPS['trail finding dismiss'], ['reason'])).reason, '--message');
		const apply = flagsOf(planFindingApply(DEPTH_HELPS['trail finding apply'], true));
		assert.deepStrictEqual(apply, { check: '--check', resolve: '--resolve' });
	});

	test('the watch finds the JSON flag and names the once flag so it is never confused with it', () => {
		const flags = flagsOf(planWatch(DEPTH_HELPS['trail watch']));
		assert.strictEqual(flags.json, '--json');
		assert.strictEqual(flags.once, '--once');
		assert.deepStrictEqual(watchArguments(flags), ['--json']);
	});

	test('a renamed flag is still found by its help line', () => {
		const renamed = DEPTH_HELPS['trail create'].replace('--title string', '--name string').replace('--no-branch   ', '--idea-only    ');
		const flags = flagsOf(planTrailCreate(renamed, true));
		assert.strictEqual(flags.title, '--name');
		assert.strictEqual(flags.noBranch, '--idea-only');
	});

	test('a required flag the help does not describe says to update the CLI', () => {
		const withoutTitle = DEPTH_HELPS['trail create'].replace(/.*--title string.*\n/, '');
		const picked = planTrailCreate(withoutTitle, false);
		assert.ok(!picked.ok);
		assert.match(picked.detail, /does not describe the title flag of 'trail create'; update the CLI/);

		const withoutCheck = DEPTH_HELPS['trail finding apply'].replace(/.*--check.*\n/, '');
		assert.ok(!planFindingApply(withoutCheck, false).ok);

		const withoutForce = DEPTH_HELPS['trail comment delete'].replace(/.*--force.*\n/, '');
		assert.ok(!planDiscussionWrite('trail comment delete', withoutForce, { body: false, force: true }).ok);
	});

	test('a field the edit changes needs its flag, and the others do not', () => {
		const withoutPriority = DEPTH_HELPS['trail update'].replace(/.*--priority.*\n/, '');
		assert.ok(planTrailUpdate(withoutPriority, ['title']).ok);
		const picked = planTrailUpdate(withoutPriority, ['priority']);
		assert.ok(!picked.ok);
		assert.match(picked.detail, /priority flag/);
	});

	test('intent only needs the no-branch flag', () => {
		const without = DEPTH_HELPS['trail create'].replace(/.*--no-branch.*\n/, '');
		assert.ok(planTrailCreate(without, false).ok);
		assert.ok(!planTrailCreate(without, true).ok);
	});

	test('the choices of a flag come from its help line, whichever way it is written', () => {
		assert.deepStrictEqual(choicesOf('Priority (urgent, high, medium, low, none)'), ['urgent', 'high', 'medium', 'low', 'none']);
		assert.deepStrictEqual(choicesOf('Type (bug, feature, task)'), ['bug', 'feature', 'task']);
		assert.deepStrictEqual(choicesOf('Finding severity: high,medium,low'), ['high', 'medium', 'low']);
		assert.deepStrictEqual(choicesOf('Assignee logins; replaces the complete list (--assignee= clears it)'), []);
		assert.deepStrictEqual(choicesOf(''), []);
	});

	test('the value that lists every finding is read from the status flag help', () => {
		assert.strictEqual(anyStatusValue("Filter by lifecycle status(es): open,resolved,dismissed; use 'any' for all (default \"open\")"), 'any');
		assert.strictEqual(anyStatusValue('Filter by status'), 'open,resolved,dismissed');
	});
});

suite('Trail depth arguments', () => {
	test('typed text is its own argument after its flag, never joined to it', () => {
		const create = trailCreateArguments(
			{ title: '--title', body: '--body', type: '--type', priority: '--priority', noBranch: '--no-branch' },
			{ title: 'Fix it', body: 'Because', type: 'bug', priority: 'high', intentOnly: true },
		);
		assert.deepStrictEqual(create, ['trail', 'create', '--title', 'Fix it', '--body', 'Because', '--type', 'bug', '--priority', 'high', '--no-branch']);
		assert.ok(create.every(argument => !/^--[a-z-]+=/.test(argument)));

		const reply = discussionArguments({ body: '--body' }, { kind: 'reply', id: '01D', body: '--looks-like-a-flag' });
		assert.deepStrictEqual(reply, ['--body', '--looks-like-a-flag', END_OF_OPTIONS, '01D']);
		assert.deepStrictEqual(
			trailUpdateArguments({ title: '--title', assignee: '--assignee' }, { title: 'New', assignees: [] }),
			['--title', 'New', '--assignee', ''],
		);
	});

	test('ids come after the end of options', () => {
		assert.deepStrictEqual(discussionArguments({}, { kind: 'edit', id: 'D', messageId: 'M', body: 'x' }).slice(-3), [END_OF_OPTIONS, 'D', 'M']);
		assert.deepStrictEqual(discussionArguments({ force: '--force' }, { kind: 'delete', id: 'D', messageId: 'M' }), ['--force', END_OF_OPTIONS, 'D', 'M']);
		assert.deepStrictEqual(discussionArguments({}, { kind: 'resolve', id: 'D' }), [END_OF_OPTIONS, 'D']);
		assert.deepStrictEqual(findingArguments({ reason: '--message' }, { kind: 'dismiss', id: 'F', reason: 'later' }), ['--message', 'later', END_OF_OPTIONS, 'F']);
		assert.deepStrictEqual(findingArguments({ check: '--check', resolve: '--resolve' }, { kind: 'apply', id: 'F', check: true, resolve: true }), ['--check', END_OF_OPTIONS, 'F']);
		assert.deepStrictEqual(findingArguments({ check: '--check', resolve: '--resolve' }, { kind: 'apply', id: 'F', check: false, resolve: true }), ['--resolve', END_OF_OPTIONS, 'F']);
	});

	test('a reason, a body or a title is only sent when one was typed', () => {
		assert.deepStrictEqual(findingArguments({ reason: '--message' }, { kind: 'resolve', id: 'F' }), [END_OF_OPTIONS, 'F']);
		assert.deepStrictEqual(trailCreateArguments({ title: '--title', body: '--body' }, { title: 'T', intentOnly: false }), ['trail', 'create', '--title', 'T']);
	});

	test('the listing of every status passes the status and the dismissed flags', () => {
		assert.deepStrictEqual(
			findingArguments({ json: '--json', status: '--status', includeDismissed: '--include-dismissed' }, { kind: 'list', any: true }, 'any'),
			['--json', '--status', 'any', '--include-dismissed'],
		);
		assert.deepStrictEqual(findingArguments({ json: '--json', status: '--status' }, { kind: 'list', any: false }), ['--json']);
	});

	test('the fields an edit changes are listed in a stable order, and an empty edit lists none', () => {
		assert.deepStrictEqual(changedFields({}), []);
		assert.deepStrictEqual(changedFields({ status: 'closed', title: 'T', assignees: [] }), ['title', 'status', 'assignee']);
		assert.deepStrictEqual(changedFields({ addAssignees: [], removeAssignees: ['x'] }), ['removeAssignee']);
	});

	test('the typed flags are the ones whose values are left out of a reported command line', () => {
		assert.deepStrictEqual(typedFlags({ title: '--title', body: undefined, other: '--x' }, ['title', 'body']), ['--title']);
	});
});

suite('Trail depth source', () => {
	const FILES = [
		'src/lib/entire/trailDepthFlags.ts',
		'src/lib/entire/trailDepth.ts',
		'src/lib/entire/trailEvents.ts',
		'src/lib/entire/trailDepthDocuments.ts',
		'src/lib/entire/trailThreadRows.ts',
		'src/lib/entire/trailThreadTarget.ts',
		'src/services/trailAuthoring.ts',
		'src/services/trailDiscussions.ts',
		'src/services/trailFindings.ts',
		'src/services/trailWatch.ts',
		'src/services/trailDepthReads.ts',
		'src/services/trailDepthSupport.ts',
		'src/services/trailThreadSource.ts',
		'src/services/cli/stream.ts',
		'src/commands/trailDepth.ts',
		'src/commands/trailDepthCommands.ts',
		'src/commands/trailDepthUi.ts',
		'src/commands/trailDepthWiring.ts',
	];

	test('no flag name is written as a literal where a command is built', () => {
		const offenders: string[] = [];
		for (const file of FILES) {
			const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
			for (const match of source.matchAll(/['"`]--[A-Za-z]/g)) {
				offenders.push(`${file}: ${match[0]}`);
			}
		}
		assert.deepStrictEqual(offenders, []);
	});

	test('the new files keep vscode out of the layers that must not import it', () => {
		for (const file of FILES.filter(entry => entry.startsWith('src/lib/') || entry.startsWith('src/services/cli/'))) {
			assert.ok(!/from 'vscode'/.test(fs.readFileSync(path.join(ROOT, file), 'utf8')), `${file} imports vscode`);
		}
	});
});
