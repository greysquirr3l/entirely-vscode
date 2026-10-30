import * as assert from 'assert';

import {
	asChangePick,
	asTrailPick,
	buildActivitySessionDetail,
	buildChangeDetail,
	buildCommitDetail,
	buildRepositoryDetail,
	buildSessionDetail,
	buildTrailDetail,
	describeViewerNote,
	detailTitle,
	formatClock,
	initialDetail,
	isFresh,
	isGoneFailure,
	isSelection,
	lifetimeSeconds,
	pickFromTarget,
	pickFromTargetOrShown,
	renderDetailDocument,
	selectionKey,
	touchedKeys,
	unavailableRow,
	viewOfKey,
	withRow,
	type DetailModel,
	type GatedChange,
	type GatedTrail,
	type Selection,
	type Trail,
	type TrailChange,
	type ViewerState,
} from '../lib/entire';

const CHANGE: TrailChange = {
	id: 'c1',
	repository: 'widgets',
	branch: 'fix-parser',
	number: 34,
	title: 'Fix the parser',
	status: 'open',
	hasCodeChanges: true,
	url: 'https://entire.example/changes/34',
};

const OTHER: TrailChange = { id: 'c2', repository: 'tools', branch: 'docs', number: 7, status: 'open' };

const TRAIL: Trail = {
	id: 't1',
	number: 12,
	title: 'Parser rewrite',
	body: 'SECRET-TRAIL-BODY describes the whole plan.',
	status: 'open',
	type: 'feature',
	priority: 'high',
	url: 'https://entire.example/trails/12',
	changes: [CHANGE, OTHER],
	partial: false,
};

const AWAITING: GatedChange = {
	change: CHANGE,
	gate: { kind: 'awaiting-approval', approvals: 0, blockers: ['needs one approval'] },
};

const GATED_TRAIL: GatedTrail = { trail: TRAIL, changes: [AWAITING, { change: OTHER, gate: { kind: 'open', approvals: 2 } }] };

const SESSION: Selection = {
	kind: 'session',
	session: { id: 'sess-1', agent: 'claude-code', status: 'ended', lastPrompt: 'fix the parser\nand its tests' },
};
const CHANGE_SELECTION: Selection = { kind: 'change', trail: TRAIL, entry: AWAITING };
const TRAIL_SELECTION: Selection = { kind: 'trail', entry: GATED_TRAIL };
const COMMIT: Selection = {
	kind: 'commit',
	entry: {
		text: 'a1b2c3d fix the parser  acme/widgets  Copilot  +27 / -1  1 file  1 checkpoint',
		id: 'a1b2c3d',
		title: 'fix the parser',
		repo: 'acme/widgets',
		detail: 'Copilot  +27 / -1  1 file  1 checkpoint',
	},
};
const LINE: Selection = { kind: 'activity-session', entry: { text: 'Fixed the parser with Copilot' } };
const REPOSITORY: Selection = {
	kind: 'repository',
	repository: { name: 'acme/widgets', count: 2 },
	scope: 'Activity for alice: recent commits, 2 checkpoints',
	stats: [{ label: 'STREAK', value: '1 day', caption: '1 current' }],
};

function labels(model: DetailModel): string[] {
	return model.rows.map(row => row.label);
}

suite('Entire selection keys and titles', () => {
	test('keys are stable and distinct per kind', () => {
		const keys = [SESSION, CHANGE_SELECTION, TRAIL_SELECTION, COMMIT, LINE, REPOSITORY].map(selectionKey);
		assert.deepStrictEqual(keys, [
			'session:sess-1',
			'change:widgets/34',
			'trail:12',
			'commit:a1b2c3d@acme/widgets',
			'activity:Fixed the parser with Copilot',
			'repo:acme/widgets',
		]);
		assert.strictEqual(new Set(keys).size, keys.length);
		assert.strictEqual(selectionKey(SESSION), selectionKey({ ...SESSION }));
	});

	test('a change number and a trail number never share a key', () => {
		const trail: Selection = { kind: 'trail', entry: { trail: { ...TRAIL, number: 34 }, changes: [] } };
		assert.notStrictEqual(selectionKey(trail), selectionKey(CHANGE_SELECTION));
	});

	test('titles name each kind', () => {
		assert.strictEqual(detailTitle(SESSION), 'claude-code — fix the parser');
		assert.strictEqual(detailTitle(CHANGE_SELECTION), 'widgets/34');
		assert.strictEqual(detailTitle(TRAIL_SELECTION), '#12 Parser rewrite');
		assert.strictEqual(detailTitle(COMMIT), 'a1b2c3d fix the parser');
		assert.strictEqual(detailTitle(LINE), 'Fixed the parser with Copilot');
		assert.strictEqual(detailTitle(REPOSITORY), 'acme/widgets');
	});

	test('a key belongs to the view its row is in', () => {
		assert.strictEqual(viewOfKey('session:x'), 'sessions');
		assert.strictEqual(viewOfKey('trail:1'), 'trails');
		assert.strictEqual(viewOfKey('change:r/1'), 'trails');
		assert.strictEqual(viewOfKey('commit:a@b'), 'activity');
		assert.strictEqual(viewOfKey('repo:a/b'), 'activity');
	});

	test('only a value shaped like a selection is accepted', () => {
		for (const good of [SESSION, CHANGE_SELECTION, TRAIL_SELECTION, COMMIT, LINE, REPOSITORY]) {
			assert.strictEqual(isSelection(good), true, good.kind);
			assert.strictEqual(isSelection(JSON.parse(JSON.stringify(good))), true, `${good.kind} survives serialising`);
		}
		for (const bad of [undefined, null, 'session:x', 3, [], {}, { kind: 'session' }, { kind: 'change', entry: {} }, { kind: 'other' }]) {
			assert.strictEqual(isSelection(bad), false);
		}
	});
});

suite('Entire selection cache lifetime', () => {
	test('a detail is fresh for the lifetime and no longer, and zero keeps nothing', () => {
		assert.strictEqual(isFresh(1_000, 1_000 + 29_999, 30), true);
		assert.strictEqual(isFresh(1_000, 1_000 + 30_000, 30), false);
		assert.strictEqual(isFresh(1_000, 1_000, 0), false);
		assert.strictEqual(isFresh(1_000, 1_000, -1), false);
	});

	test('what cannot change lives ten times as long', () => {
		const model = (selection: Selection): DetailModel => initialDetail(selection);
		assert.strictEqual(lifetimeSeconds(model(COMMIT), COMMIT, 30), 300);
		assert.strictEqual(lifetimeSeconds(model(LINE), LINE, 30), 300);
		assert.strictEqual(lifetimeSeconds(model(REPOSITORY), REPOSITORY, 30), 300);
		assert.strictEqual(lifetimeSeconds(model(SESSION), SESSION, 30), 300, 'an ended session');
		assert.strictEqual(lifetimeSeconds(model(CHANGE_SELECTION), CHANGE_SELECTION, 30), 30);
		assert.strictEqual(lifetimeSeconds(model(TRAIL_SELECTION), TRAIL_SELECTION, 30), 30);
		const active: Selection = { kind: 'session', session: { id: 's', agent: 'a', status: 'active' } };
		assert.strictEqual(lifetimeSeconds(model(active), active, 30), 30);
		const idle: Selection = { kind: 'session', session: { id: 's', agent: 'a', status: 'idle' } };
		assert.strictEqual(lifetimeSeconds(model(idle), idle, 30), 30);
		assert.strictEqual(lifetimeSeconds(model(COMMIT), COMMIT, 0), 0, 'zero turns the cache off for every kind');
	});

	test('formats the time of day', () => {
		assert.match(formatClock(new Date(2026, 9, 30, 4, 5, 6).getTime()), /^04:05:06$/);
	});
});

suite('Entire detail models', () => {
	test('a change shows the listing fields and the parent trail, and nothing the CLI did not give', () => {
		const model = buildChangeDetail({ kind: 'change', trail: TRAIL, entry: AWAITING }, { trail: TRAIL });
		const rows = Object.fromEntries(model.rows.map(row => [row.label, row.value]));

		assert.strictEqual(model.heading, 'Fix the parser');
		assert.strictEqual(rows['Change'], 'widgets/34');
		assert.strictEqual(rows['Branch'], 'fix-parser');
		assert.strictEqual(rows['Change status'], 'open');
		assert.strictEqual(rows['Code changes'], 'Yes');
		assert.strictEqual(rows['Gate'], 'awaiting approval');
		assert.strictEqual(rows['Approvals'], '0 approvals');
		assert.strictEqual(rows['Trail'], '#12 Parser rewrite');
		assert.strictEqual(rows['Type'], 'feature');
		assert.strictEqual(rows['Priority'], 'high');
		assert.strictEqual(rows['Description'], 'Has a description (open in editor to read it)');
		assert.deepStrictEqual(model.rows.find(row => row.label === 'Blockers')?.lines, ['needs one approval']);
		assert.deepStrictEqual(model.rows.find(row => row.label === 'Other changes')?.lines, ['tools/7 · docs · open']);

		for (const absent of [/base/i, /head/i, /linked/i, /comment/i, /finding/i, /approver/i]) {
			assert.ok(!labels(model).some(label => absent.test(label)), `a row matches ${absent}`);
		}
		assert.ok(!JSON.stringify(model.rows).includes('SECRET-TRAIL-BODY'), 'the body is not in a row');
		assert.strictEqual(model.body, TRAIL.body, 'the body travels with the model for the document');
		assert.strictEqual(model.pick?.kind, 'change');
	});

	test('a change whose gate is unknown says why instead of guessing', () => {
		const unknown: GatedChange = { change: CHANGE, gate: { kind: 'unknown', detail: 'the merge check failed' } };
		const model = buildChangeDetail({ kind: 'change', trail: TRAIL, entry: unknown });
		const gate = model.rows.find(row => row.label === 'Gate');
		assert.strictEqual(gate?.value, 'gate unknown');
		assert.strictEqual(gate?.tooltip, 'the merge check failed');
		assert.ok(!labels(model).includes('Approvals'));
	});

	test('a change with fields the listing lacks leaves those rows out', () => {
		const bare: GatedChange = {
			change: { id: 'c9', repository: 'r', branch: 'b', number: 1 },
			gate: { kind: 'open', approvals: 1 },
		};
		const model = buildChangeDetail({ kind: 'change', trail: { ...TRAIL, body: undefined, type: undefined, url: undefined }, entry: bare });
		for (const missing of ['Change status', 'Code changes', 'Change page', 'Type', 'Description', 'Trail page']) {
			assert.ok(!labels(model).includes(missing), `${missing} is shown without data`);
		}
		assert.strictEqual(model.heading, 'b');
	});

	test('a trail shows its fields and its changes with their gates', () => {
		const model = buildTrailDetail(TRAIL_SELECTION);
		assert.strictEqual(model.heading, 'Parser rewrite');
		assert.deepStrictEqual(model.rows.find(row => row.label === 'Changes')?.lines, [
			'widgets/34 · fix-parser · awaiting approval',
			'tools/7 · docs · ready to merge · 2 approvals',
		]);
		assert.strictEqual(model.pick?.kind, 'trail');
		assert.ok(!JSON.stringify(model.rows).includes('SECRET-TRAIL-BODY'));
	});

	test('a commit keeps the CLI detail string whole', () => {
		const model = buildCommitDetail({ kind: 'commit', entry: (COMMIT as Extract<Selection, { kind: 'commit' }>).entry });
		const rows = Object.fromEntries(model.rows.map(row => [row.label, row.value]));
		assert.strictEqual(rows['Commit'], 'a1b2c3d');
		assert.strictEqual(rows['Title'], 'fix the parser');
		assert.strictEqual(rows['Repository'], 'acme/widgets');
		assert.strictEqual(rows['Details'], 'Copilot  +27 / -1  1 file  1 checkpoint');
		assert.match(model.rows.find(row => row.label === 'Title')?.tooltip ?? '', /as the CLI printed it/i);
		assert.ok(!labels(model).some(label => /checkpoint id|open checkpoint/i.test(label)));
	});

	test('a session line in Activity shows its text and says there is no session id', () => {
		const model = buildActivitySessionDetail({ kind: 'activity-session', entry: { text: 'Fixed the parser with Copilot' } });
		assert.strictEqual(model.rows[0].value, 'Fixed the parser with Copilot');
		assert.match(model.rows[1].value, /does not give a session id/);
		assert.strictEqual(model.rows.length, 2);
	});

	test('a repository row shows its name, count and the overview figures', () => {
		const model = buildRepositoryDetail(REPOSITORY as Extract<Selection, { kind: 'repository' }>);
		const rows = Object.fromEntries(model.rows.map(row => [row.label, row.value]));
		assert.strictEqual(rows['Repository'], 'acme/widgets');
		assert.strictEqual(rows['Count'], '2');
		assert.strictEqual(rows['Scope'], 'Activity for alice: recent commits, 2 checkpoints');
		assert.deepStrictEqual(model.rows.find(row => row.label === 'Overview')?.lines, ['Streak: 1 day (1 current)']);

		const noCount = buildRepositoryDetail({ kind: 'repository', repository: { name: 'x/y' }, scope: 's', stats: [] });
		assert.ok(!labels(noCount).includes('Count'));
		assert.ok(!labels(noCount).includes('Overview'));
	});

	test('a session keeps the rows it always had', () => {
		const model = buildSessionDetail(SESSION as Extract<Selection, { kind: 'session' }>);
		assert.deepStrictEqual(
			labels(model),
			['Agent', 'Status', 'Branch', 'Worktree', 'Session', 'Turns', 'Checkpoints', 'Last prompt', 'Transcript'],
		);
		assert.strictEqual(model.heading, undefined, 'a session has no header row');
	});

	test('the row that explains a missing trail read carries the setup command', () => {
		const model = withRow(initialDetail(CHANGE_SELECTION), unavailableRow('no trail show'));
		const row = model.rows[model.rows.length - 1];
		assert.strictEqual(row.value, 'Trail details need a newer Entire CLI');
		assert.strictEqual(row.command?.command, 'entirely.setUp');
	});
});

suite('Entire detail document', () => {
	test('puts the trail body in the document and nowhere else', () => {
		const model = buildChangeDetail({ kind: 'change', trail: TRAIL, entry: AWAITING }, { trail: TRAIL });
		const text = renderDetailDocument(model);
		assert.ok(text.includes('SECRET-TRAIL-BODY'));
		assert.ok(text.startsWith('Details — widgets/34'));
		assert.ok(text.includes('Blockers (1 blocker):\n  needs one approval'));
		assert.ok(!JSON.stringify(model.rows).includes('SECRET-TRAIL-BODY'));
	});

	test('covers each kind', () => {
		for (const selection of [SESSION, CHANGE_SELECTION, TRAIL_SELECTION, COMMIT, LINE, REPOSITORY]) {
			const model = initialDetail(selection);
			const text = renderDetailDocument(model);
			assert.ok(text.startsWith(`Details — ${model.title}`), selection.kind);
			for (const row of model.rows) {
				assert.ok(text.includes(row.label), `${selection.kind}: ${row.label}`);
			}
		}
	});

	test('says what the viewer says about a state that is not finished', () => {
		const model = initialDetail(COMMIT);
		const loading: ViewerState = { kind: 'loading', selection: COMMIT, model };
		const failed: ViewerState = { kind: 'failed', selection: COMMIT, model, reason: 'timed out' };
		assert.strictEqual(describeViewerNote(loading), `Loading ${model.title}…`);
		assert.strictEqual(describeViewerNote(failed), `Could not load ${model.title}: timed out`);
		assert.ok(renderDetailDocument(model, describeViewerNote(failed)).includes('Could not load'));
		assert.strictEqual(describeViewerNote({ kind: 'empty' }), undefined);
	});
});

suite('Entire gone-item wording', () => {
	test('reads the CLI wording for a trail or change that is not there', () => {
		for (const gone of ['trail not found', 'change widgets/34 not found', 'no such trail: 12', 'the change does not exist', 'HTTP 404']) {
			assert.strictEqual(isGoneFailure(gone), true, gone);
		}
	});

	test('does not call an invisible project a gone trail', () => {
		for (const other of ['project not found', 'project is not accessible', 'the Keychain is not accessible', 'exited with code 1']) {
			assert.strictEqual(isGoneFailure(other), false, other);
		}
	});
});

suite('Entire review targets', () => {
	test('reads a change row and a trail row of the Trails view', () => {
		const change = pickFromTarget({ kind: 'change', trail: TRAIL, entry: AWAITING });
		assert.strictEqual(change?.kind, 'change');
		assert.deepStrictEqual(change?.selector, { kind: 'change', repository: 'widgets', number: 34 });

		const trail = pickFromTarget({ kind: 'trail', entry: GATED_TRAIL, changes: [] });
		assert.strictEqual(trail?.kind, 'trail');
		assert.deepStrictEqual(trail?.selector, { kind: 'trail', number: 12 });
	});

	test('ignores a target that is not a row, and an object that only claims to carry a pick', () => {
		const model = buildChangeDetail({ kind: 'change', trail: TRAIL, entry: AWAITING });
		assert.strictEqual(pickFromTarget({ kind: 'header', pick: model.pick }), undefined);
		for (const other of [undefined, null, 'x', 4, [], {}, { kind: 'session', session: {} }, { kind: 'change', entry: {} }]) {
			assert.strictEqual(pickFromTarget(other), undefined);
		}
	});

	test('panel-actions-validate-arguments: a link\'s row id names the item on show and nothing else', () => {
		const model = buildChangeDetail({ kind: 'change', trail: TRAIL, entry: AWAITING });
		assert.strictEqual(pickFromTargetOrShown(model.key, model)?.kind, 'change');
		for (const other of ['change:widgets/99', '', 'trail:12', model.key + ' ', 4, null, undefined, {}, [model.key], { pick: model.pick }]) {
			assert.strictEqual(pickFromTargetOrShown(other, model), undefined, String(JSON.stringify(other)));
		}
		assert.strictEqual(pickFromTargetOrShown(model.key, undefined), undefined, 'nothing is on show');
		assert.strictEqual(
			pickFromTargetOrShown({ kind: 'change', trail: TRAIL, entry: AWAITING }, undefined)?.kind,
			'change',
			'a Trails row is still taken as a row',
		);
	});

	test('a change pick can act on its trail, and a trail pick cannot act on a change', () => {
		const change = pickFromTarget({ kind: 'change', trail: TRAIL, entry: AWAITING });
		assert.ok(change);
		assert.strictEqual(asTrailPick(change).kind, 'trail');
		assert.strictEqual(asChangePick(change)?.kind, 'change');
		const trail = pickFromTarget({ kind: 'trail', entry: GATED_TRAIL });
		assert.strictEqual(asChangePick(trail), undefined);
		assert.strictEqual(asChangePick(undefined), undefined);
	});

	test('names the cached details an action makes out of date', () => {
		const change = pickFromTarget({ kind: 'change', trail: TRAIL, entry: AWAITING });
		const trail = pickFromTarget({ kind: 'trail', entry: GATED_TRAIL });
		assert.ok(change && trail);
		assert.deepStrictEqual(touchedKeys(change), ['trail:12', 'change:widgets/34']);
		assert.deepStrictEqual(touchedKeys(trail), ['trail:12', 'change:widgets/34', 'change:tools/7']);
	});
});
