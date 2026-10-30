import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
	attributeApproval,
	cliReason,
	attributeComment,
	changePicks,
	describeChange,
	describeCheckoutRefusal,
	describeMergeBlockers,
	describeMergePlan,
	describeUnseenProject,
	describePick,
	describePickDetail,
	refuseCheckoutForUnsavedWork,
	isProjectInvisible,
	refusesCommentFromAgentSession,
	trailPicks,
	type Trail,
	type TrailApproval,
	type TrailChange,
	type TrailComment,
	type TrailMergePlan,
} from '../lib/entire';
import type { CliRunner } from '../services/cli/runner';
import { TrailService, TrailUsage, hasTrailFlag, readTrailWorkspace } from '../services/trailService';
import { fakeTrailCli, invocations } from './support/trailCli';

/** The trail the tests act on. */
const TRAIL: Trail = {
	id: '01M62YAQVTG0WN2J6G7149VCK9',
	number: 40,
	title: 'Shape the thing',
	status: 'open',
	partial: false,
	changes: [
		{
			id: '01M62YB0HTSHFQ0WE38EHPFX1',
			repository: 'entirely-vscode',
			branch: 'shape-probe',
			number: 17,
			title: 'Shape the thing',
			status: 'open',
		},
	],
};

/** An approval, as the CLI records it. */
function approval(author: string, at = '2026-10-29T07:00:00.000Z'): TrailApproval {
	return { id: `id-${author}`, author, event: 'approved', createdAt: at };
}

/** A comment, as the CLI records it. */
function comment(author: string): TrailComment {
	return {
		id: `id-${author}`,
		resolved: false,
		lastMessageAuthor: author,
		messageCount: 1,
	};
}

/** A merge plan, as the CLI's dry run reports it. */
function mergePlan(overrides: Partial<TrailMergePlan> = {}): TrailMergePlan {
	return {
		change: 'entirely-vscode/17',
		trail: 40,
		project: 'gh/greysquirr3l',
		branch: 'shape-probe',
		base: 'main',
		headSha: '0e8af92c31970d63fa67d85c9ed90e6f58f4ed3d',
		mergeable: true,
		conflictStatus: 'clean',
		blockers: [],
		reasons: [],
		wouldBypass: false,
		merged: false,
		...overrides,
	};
}


suite('Entire CLI failures', () => {
	test('the reason the CLI gave is read from its error stream', () => {
		const reason = cliReason(
			[
				"Using context 'sosh-ncampbell@us.auth.entire.io'.",
				'resolve project: decode response: error: code 404',
			].join('\n'),
		);

		assert.match(reason, /code 404/);
		assert.doesNotMatch(reason, /Using context/);
	});

	test('a project the login cannot see is recognised', () => {
		assert.strictEqual(
			isProjectInvisible(
				'resolve project: decode response: error: code 404: {Detail:{Value:project not found Set:true}}',
			),
			true,
		);
	});

	test('another failure is not mistaken for the project', () => {
		assert.strictEqual(isProjectInvisible('the command exited with code 1'), false);
	});

	test('the message for an invisible project says what to do', () => {
		const message = describeUnseenProject('gh/greysquirr3l');

		assert.match(message, /gh\/greysquirr3l/);
		assert.match(message, /not visible/);
		assert.match(message, /entirely\.cliContext/);
	});
});

suite('Entire trail review rules', () => {
	test('an approval under the acting login is attributed to it', () => {
		const attribution = attributeApproval(
			[approval('someone-else'), approval('greysquirr3l')],
			'greysquirr3l',
		);

		assert.strictEqual(attribution.kind, 'attributed');
		assert.strictEqual(
			attribution.kind === 'attributed' ? attribution.approval.author : undefined,
			'greysquirr3l',
		);
	});

	test('an approval under another login is shown as somebody else', () => {
		const attribution = attributeApproval([approval('someone-else')], 'greysquirr3l');

		assert.strictEqual(attribution.kind, 'other-reviewer');
		assert.strictEqual(
			attribution.kind === 'other-reviewer' ? attribution.approval.author : undefined,
			'someone-else',
		);
	});

	test('a change nobody approved is unapproved', () => {
		assert.strictEqual(attributeApproval([], 'greysquirr3l').kind, 'unapproved');
	});

	test('a handle that merely contains the acting handle is somebody else', () => {
		const attribution = attributeApproval([approval('not-greysquirr3l')], 'greysquirr3l');

		assert.strictEqual(attribution.kind, 'other-reviewer');
	});

	test('a comment under the acting login is found', () => {
		const found = attributeComment(
			[comment('someone-else'), comment('greysquirr3l')],
			'greysquirr3l',
		);

		assert.strictEqual(found?.lastMessageAuthor, 'greysquirr3l');
	});

	test('a comment under another login is not claimed', () => {
		const found = attributeComment([comment('someone-else')], 'greysquirr3l');

		assert.strictEqual(found, undefined);
	});

	test('a merge is described by the branch, the base and the commit', () => {
		const described = describeMergePlan(mergePlan());

		assert.match(described, /shape-probe/);
		assert.match(described, /main/);
		assert.match(described, /0e8af92/);
		assert.match(described, /entirely-vscode\/17/);
	});

	test('the reasons the CLI gave are passed on', () => {
		const described = describeMergeBlockers(
			mergePlan({ mergeable: false, reasons: ['a blocking gate failed'] }),
		);

		assert.match(described, /a blocking gate failed/);
	});

	test('a merge with no reason given still says it did not merge', () => {
		const described = describeMergeBlockers(mergePlan({ mergeable: false }));

		assert.match(described, /did not merge/);
	});

	test('a checkout with no unsaved work is not refused', () => {
		assert.strictEqual(refuseCheckoutForUnsavedWork([]), undefined);
	});

	test('a checkout with unsaved work is refused and the files are named', () => {
		const refusal = refuseCheckoutForUnsavedWork([
			{ path: '/repo/src/app.ts', name: 'src/app.ts' },
		]);

		assert.ok(refusal, 'the checkout was not refused');
		assert.strictEqual(refusal.kind, 'unsaved-work');

		const described = describeCheckoutRefusal(refusal);

		assert.match(described, /src\/app\.ts/);
		assert.match(described, /unsaved changes/);
	});

	test('two unsaved files are both named', () => {
		const refusal = refuseCheckoutForUnsavedWork([
			{ path: '/repo/src/app.ts', name: 'src/app.ts' },
			{ path: '/repo/src/main.ts', name: 'src/main.ts' },
		]);

		assert.ok(refusal, 'the checkout was not refused');

		const described = describeCheckoutRefusal(refusal);

		assert.match(described, /src\/app\.ts/);
		assert.match(described, /src\/main\.ts/);
	});

	test('the refusal of a comment from an agent session is recognised', () => {
		assert.strictEqual(
			refusesCommentFromAgentSession(
				'refusing `entire trail comment add` from a Copilot session: trail comments are for people.',
			),
			true,
		);
	});

	test('another failure is not mistaken for the refusal', () => {
		assert.strictEqual(
			refusesCommentFromAgentSession('the command exited with code 1'),
			false,
		);
	});
});

suite('Entire trail picks', () => {
	test('a change is picked by the branch the reviewer recognises', () => {
		const picks = changePicks([TRAIL]);

		assert.strictEqual(picks.length, 1);
		assert.strictEqual(picks[0].kind, 'change');

		const label = describePick(picks[0]);

		assert.match(label, /shape-probe/);
		assert.match(label, /entirely-vscode\/17/);
	});

	test('a pick names the trail it belongs to', () => {
		const picks = changePicks([TRAIL]);

		assert.match(describePickDetail(picks[0]), /#40/);
	});

	test('a change is picked with the selector the CLI takes', () => {
		const picks = changePicks([TRAIL]);
		const pick = picks[0];

		assert.strictEqual(pick.kind, 'change');
		assert.deepStrictEqual(
			pick.kind === 'change' ? pick.selector : undefined,
			{ kind: 'change', repository: 'entirely-vscode', number: 17 },
		);
	});

	test('a trail is picked with the selector the CLI takes', () => {
		const picks = trailPicks([TRAIL]);
		const pick = picks[0];

		assert.strictEqual(pick.kind, 'trail');
		assert.deepStrictEqual(
			pick.kind === 'trail' ? pick.selector : undefined,
			{ kind: 'trail', number: 40 },
		);
	});

	test('a change is described by its branch and its number', () => {
		const change: TrailChange = TRAIL.changes[0];

		assert.match(describeChange(change), /shape-probe \(entirely-vscode\/17\)/);
	});
});

suite('Entire trail workspace reading', () => {
	test('the project follows the forge the repository is on', async () => {
		const { runner } = fakeTrailCli();

		const workspace = await readTrailWorkspace(runner, undefined);

		assert.strictEqual(workspace.kind, 'ok');
		assert.strictEqual(
			workspace.kind === 'ok' ? workspace.value.project : undefined,
			'gh/greysquirr3l',
		);
		assert.strictEqual(
			workspace.kind === 'ok' ? workspace.value.repository : undefined,
			'gh/greysquirr3l/entirely-vscode',
		);
		assert.strictEqual(
			workspace.kind === 'ok' ? workspace.value.name : undefined,
			'entirely-vscode',
		);
	});

	test('a repository the CLI did not name is reported rather than guessed at', async () => {
		const { runner } = fakeTrailCli({ repo: '{"repo":"not-a-forge-ref"}' });

		const workspace = await readTrailWorkspace(runner, undefined);

		assert.strictEqual(workspace.kind, 'failed');
	});
});

suite('Entire trail selector forms', () => {
	test('a usage that names the --trail flag is read as taking a flag', () => {
		assert.strictEqual(
			hasTrailFlag('      --trail string   Project trail number, ID, or <repo>/<number>'),
			true,
		);
	});

	test('a usage that does not name the flag is read as taking a positional', () => {
		assert.strictEqual(
			hasTrailFlag('      --trail-id string   Something else entirely'),
			false,
		);
	});
});

suite('Entire trail service', () => {
	test('an approval is read back so that the extension can attribute it', async () => {
		const { runner } = fakeTrailCli({
			approvals: JSON.stringify({
				approvals: [
					{ id: 'a1', author: 'greysquirr3l', event: 'approved' },
				],
			}),
		});

		const service = new TrailService({
			runner,
			workspaceRoot: () => undefined,
			actingHandle: () => 'greysquirr3l',
		});

		const result = await service.approve(
			{ kind: 'change', repository: 'entirely-vscode', number: 17 },
			undefined,
		);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(result.kind === 'ok' ? result.value.length : 0, 1);
	});

	test('a comment refused by an agent session becomes a finding', async () => {
		const { runner } = fakeTrailCli({
			commentFails:
				'refusing `entire trail comment add` from a Copilot session: trail comments are for people.',
			findings: JSON.stringify({
				findings: [{ id: 'f1', body: 'the note', status: 'open' }],
			}),
		});

		const service = new TrailService({
			runner,
			workspaceRoot: () => undefined,
			actingHandle: () => 'greysquirr3l',
		});

		const result = await service.comment(
			{ kind: 'change', repository: 'entirely-vscode', number: 17 },
			'the note',
			undefined,
		);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(result.kind === 'ok' ? result.value.kind : undefined, 'finding');
		assert.strictEqual(
			result.kind === 'ok' && result.value.kind === 'finding' ? result.value.findings.length : 0,
			1,
		);
	});

	test('a finding is posted with the flags the CLI takes', async () => {
		// The CLI's `trail finding add` has no `--title`, so a title
		// that was folded into a finding must not be passed as a flag
		// the CLI would reject.
		const { runner, log } = fakeTrailCli({
			commentFails:
				'refusing `entire trail comment add` from a Copilot session: trail comments are for people.',
			findings: JSON.stringify({
				findings: [{ id: 'f1', body: 'the note', status: 'open' }],
			}),
		});

		const service = new TrailService({
			runner,
			workspaceRoot: () => undefined,
			actingHandle: () => 'greysquirr3l',
		});

		await service.comment(
			{ kind: 'change', repository: 'entirely-vscode', number: 17 },
			'the note',
			'A title',
		);

		const posted = invocations(log).filter(line => line.startsWith('trail finding add'));

		assert.strictEqual(posted.length, 1);
		assert.ok(!posted[0].includes('--title'), `the finding was passed a title: ${posted[0]}`);
		assert.ok(posted[0].includes('A title'), `the finding lost its title: ${posted[0]}`);
	});

	test('a comment that fails for another reason is a failure, not a finding', async () => {		const { runner } = fakeTrailCli({ commentFails: 'the command exited with code 1' });

		const service = new TrailService({
			runner,
			workspaceRoot: () => undefined,
			actingHandle: () => 'greysquirr3l',
		});

		const result = await service.comment(
			{ kind: 'change', repository: 'entirely-vscode', number: 17 },
			'the note',
			undefined,
		);

		assert.strictEqual(result.kind, 'failed');
	});

	test('a comment the CLI accepted is read back as a comment', async () => {
		const { runner } = fakeTrailCli({
			comments: JSON.stringify({
				items: [
					{
						id: 'c1',
						resolved: false,
						lastMessageAuthor: 'greysquirr3l',
						messageCount: 1,
					},
				],
			}),
		});

		const service = new TrailService({
			runner,
			workspaceRoot: () => undefined,
			actingHandle: () => 'greysquirr3l',
		});

		const result = await service.comment(
			{ kind: 'change', repository: 'entirely-vscode', number: 17 },
			'the note',
			undefined,
		);

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(result.kind === 'ok' ? result.value.kind : undefined, 'comment');
	});

	test('a merge plan that says the merge cannot happen is still an answer', async () => {
		const { runner } = fakeTrailCli({
			merge: JSON.stringify({
				number: 17,
				change: 'entirely-vscode/17',
				trail: 40,
				branch: 'shape-probe',
				base: 'main',
				headSha: '0e8af92c31970d63fa67d85c9ed90e6f58f4ed3d',
				mergeable: false,
				blockers: [],
				reasons: ['a blocking gate failed'],
			}),
		});

		const service = new TrailService({
			runner,
			workspaceRoot: () => undefined,
			actingHandle: () => 'greysquirr3l',
		});

		const result = await service.mergePlan({
			kind: 'change',
			repository: 'entirely-vscode',
			number: 17,
		});

		assert.strictEqual(result.kind, 'ok');
		assert.strictEqual(result.kind === 'ok' ? result.value.mergeable : undefined, false);
	});
});


suite('Entire trail command plumbing', () => {
	test('a failed usage lookup is not kept', async () => {
		let calls = 0;
		const runner = {
			usage: async () => {
				calls++;

				return calls === 1
					? { ok: false, reason: 'timeout', detail: 'slow', stdout: '', stderr: '', durationMs: 1 }
					: {
							ok: true,
							value: { command: 'trail approve', flags: [], raw: 'entire trail approve\n' },
							stdout: '',
							stderr: '',
							durationMs: 1,
						};
			},
		} as unknown as CliRunner;

		const usage = new TrailUsage(runner);

		assert.strictEqual(await usage.form('trail approve'), 'flag', 'the guess is the flag form');
		assert.strictEqual(
			await usage.form('trail approve'),
			'positional',
			'the failed lookup was kept instead of asked again',
		);
		assert.strictEqual(await usage.form('trail approve'), 'positional');
		assert.strictEqual(calls, 2, 'a successful lookup was not kept');
	});

	test('a comment body and an approval message are not in the reported command line', async () => {
		const { runner, log } = fakeTrailCli();
		const reported: string[] = [];
		runner.setSink({
			report: invocation => {
				reported.push(invocation.args.join(' '));
			},
		});

		const service = new TrailService({
			runner,
			workspaceRoot: () => undefined,
			actingHandle: () => 'greysquirr3l',
		});
		const selector = { kind: 'change' as const, repository: 'entirely-vscode', number: 17 };

		await service.comment(selector, 'secret review text', 'private title');
		await service.approve(selector, 'secret approval note');

		const asked = invocations(log).join('\n');
		assert.match(asked, /secret review text/, 'the CLI did not receive the body');
		assert.match(asked, /secret approval note/, 'the CLI did not receive the message');

		const everything = reported.join('\n');
		assert.doesNotMatch(everything, /secret review text/);
		assert.doesNotMatch(everything, /private title/);
		assert.doesNotMatch(everything, /secret approval note/);
		assert.match(everything, /--body <redacted>/);
	});

	test('what a trail action or read prints is not kept in the invocation record', async () => {
		const { runner } = fakeTrailCli({ list: JSON.stringify({ items: [], note: 'secret-list-body' }) });
		const bodies: { stdout?: string; stderr?: string }[] = [];
		runner.setSink({ report: (_invocation, kept) => void bodies.push(kept) });

		const service = new TrailService({
			runner,
			workspaceRoot: () => undefined,
			actingHandle: () => 'greysquirr3l',
		});
		const selector = { kind: 'change' as const, repository: 'entirely-vscode', number: 17 };

		const checkedOut = await service.checkout(selector, undefined);
		await service.approve(selector, 'a note');
		await service.approvals(selector);
		await service.list('proj');

		assert.deepStrictEqual(checkedOut, { kind: 'ok', value: 'checked out' }, 'the caller still receives the output');
		const kept = JSON.stringify(bodies);
		assert.doesNotMatch(kept, /checked out/);
		assert.doesNotMatch(kept, /approved/);
		assert.doesNotMatch(kept, /secret-list-body/);
		assert.doesNotMatch(kept, /"approvals"/);
	});

	test('a trail action runs with the configured timeout', async () => {
		const seen: (number | undefined)[] = [];
		const runner = {
			usage: async () => ({
				ok: true,
				value: { command: 'x', flags: [], raw: '' },
				stdout: '',
				stderr: '',
				durationMs: 1,
			}),
			run: async (_args: readonly string[], options: { timeoutMs?: number }) => {
				seen.push(options.timeoutMs);
				return { ok: false, reason: 'exit-code', detail: 'no', stdout: '', stderr: '', durationMs: 1 };
			},
		} as unknown as CliRunner;

		const service = new TrailService({
			runner,
			workspaceRoot: () => undefined,
			actingHandle: () => undefined,
			actionTimeoutMs: () => 123_000,
		});

		await service.checkout({ kind: 'change', repository: 'r', number: 1 }, undefined);

		assert.deepStrictEqual(seen, [123_000]);
	});
});
