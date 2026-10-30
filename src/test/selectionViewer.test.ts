import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { approveChange, linkBranch, type TrailReviewDependencies } from '../commands/trailReview';
import { copyCommitHash, openDetailInEditor, selectItem, wireSelection, type SelectionWiring } from '../commands/selection';
import { SessionDetailProvider } from '../providers/sessionDetailProvider';
import { DetailPanel } from '../providers/detailPanel';
import { GENERATED_SCHEME, GeneratedDocuments } from '../providers/generatedDocuments';
import { ActivityProvider, buildActivityNodes } from '../providers/activityProvider';
import { SessionsProvider, buildGroups } from '../providers/sessionsProvider';
import { SelectedRows, rowUri } from '../providers/selectedMark';
import { TrailsProvider, buildTrailNodes, type TrailsNode } from '../providers/trailsProvider';
import {
	DETAIL_COMMANDS,
	decodeTrail,
	describeViewerTitle,
	parseActivity,
	renderDetailHtml,
	selectionKey,
	touchedKeys,
	type Selection,
	type Session,
	type ViewerState,
} from '../lib/entire';
import { CliInvocationRecorder } from '../services/cli/recorder';
import { CliInvocationLogger } from '../services/cliLogging';
import { createLogger } from '../services/logger';
import { SelectionService } from '../services/selection';
import { createSelectionLoader, type TrailReader } from '../services/selectionLoader';
import { createTrailListingSource } from '../services/trailListing';
import { TrailChangesService } from '../services/trailChanges';
import { TrailService } from '../services/trailService';
import type { ActivityOutcome } from '../services/activity';
import { COMMITS_OUTPUT, SESSIONS_OUTPUT } from './support/activityCli';
import { fakePanels } from './support/fakePanel';
import { TRAIL_SHOW, fakeTrailCli, invocations, type TrailCliAnswers } from './support/trailCli';

const NOT_USED = {
	info: async () => ({ kind: 'failed' as const, detail: 'no session reads in this test' }),
	transcript: async () => ({ kind: 'failed' as const, detail: 'no session reads in this test' }),
};
const NO_USAGE = {
	session: async () => ({ kind: 'failed' as const, detail: 'no usage reads in this test' }),
	checkpoint: async () => ({ kind: 'failed' as const, detail: 'no usage reads in this test' }),
};

/** Everything the tests need around a fake trail CLI. */
async function trailSetup(answers: TrailCliAnswers = {}, ttl = 30) {
	const cli = fakeTrailCli(answers);
	const trails = new TrailService({ runner: cli.runner, workspaceRoot: () => undefined, actingHandle: () => undefined });
	const listing = await createTrailListingSource(trails)();
	// The list carries no changes, so the rows a click starts from are built
	// from the answer a `trail show` gives, with the gate the Trails view
	// would have read, and without asking the CLI.
	const decoded = decodeTrail(JSON.parse(JSON.stringify(TRAIL_SHOW)), 'trail');
	assert.ok(decoded.ok);
	const entry = { trail: decoded.value, changes: decoded.value.changes.map(change => ({ change, gate: { kind: 'open' as const, approvals: 0 } })) };
	const nodes = buildTrailNodes(listing.trails, number => (number === entry.trail.number ? entry : undefined));
	const listed = invocations(cli.log).length;
	const changes = new TrailChangesService({ trails, ttlSeconds: () => ttl });
	const service = new SelectionService({
		loader: createSelectionLoader({
			detail: NOT_USED,
			usage: NO_USAGE,
			trails: { showCapability: () => trails.showCapability(), read: number => changes.read(number) },
		}),
		ttlSeconds: () => ttl,
	});
	const states: ViewerState[] = [];
	service.onDidChange(state => states.push(state));
	const changeNode = nodes[0].changes?.[0];
	assert.ok(changeNode, 'the fixture trail has a change');
	const change: Selection = { kind: 'change', trail: changeNode.trail, entry: changeNode.entry };
	const trail: Selection = { kind: 'trail', entry: nodes[0].entry };
	return {
		cli,
		trails,
		changes,
		service,
		states,
		change,
		trail,
		nodes,
		/** What the CLI was asked since the listing was read. */
		asked: () => invocations(cli.log).slice(listed),
	};
}

/** Records the popups the extension raises while a test runs. */
async function withoutPopups(run: () => Promise<void>): Promise<string[]> {
	const window = vscode.window as unknown as Record<string, unknown>;
	const names = ['showInformationMessage', 'showWarningMessage', 'showErrorMessage'];
	const originals = names.map(name => window[name]);
	const raised: string[] = [];
	for (const name of names) {
		window[name] = async (message: string) => {
			raised.push(`${name}: ${message}`);
			return undefined;
		};
	}
	try {
		await run();
	} finally {
		names.forEach((name, index) => {
			window[name] = originals[index];
		});
	}
	return raised;
}

const SESSIONS: readonly Session[] = [
	{ id: 'sess-active', agent: 'claude-code', status: 'active', lastPrompt: 'fix the parser' },
	{ id: 'sess-idle', agent: 'codex', status: 'idle' },
	{ id: 'sess-ended', agent: 'copilot-cli', status: 'ended' },
];

function foundActivity(output: string, listing: 'commits' | 'sessions'): ActivityOutcome {
	const reading = parseActivity(output, listing);
	assert.strictEqual(reading.kind, 'overview');
	if (reading.kind !== 'overview') {
		throw new Error('the fixture did not parse');
	}
	return { kind: 'found', overview: reading.overview };
}

suite('Entire detail panel: trails', function () {
	this.timeout(30_000);

	test('select-each-kind: a change is shown with the one trail show of its trail and no other trail command', async () => {
		const setup = await trailSetup();
		try {
			await setup.service.select(setup.change, 'trails');

			assert.deepStrictEqual(setup.asked().filter(line => line.startsWith('trail ')), ['trail show 40 --json']);
			const last = setup.states[setup.states.length - 1];
			assert.strictEqual(last.kind, 'ready');
			assert.strictEqual(last.kind === 'ready' ? last.model.title : '', 'entirely-vscode/17');
			const rows = last.kind === 'ready' ? Object.fromEntries(last.model.rows.map(row => [row.label, row.value])) : {};
			assert.strictEqual(rows['Type'], 'feature');
			assert.strictEqual(rows['Priority'], 'high');
			assert.strictEqual(rows['Trail page'], TRAIL_SHOW.url);
			assert.strictEqual(rows['Gate'], 'ready to merge · 0 approvals', 'the gate is the listing row\'s');
		} finally {
			setup.service.dispose();
		}
	});

	test('selecting a project trail runs one trail show by its number', async () => {
		const setup = await trailSetup();
		try {
			await setup.service.select(setup.trail, 'trails');
			assert.deepStrictEqual(setup.asked().filter(line => line.startsWith('trail ')), ['trail show 40 --json']);
			assert.strictEqual(setup.service.state.kind, 'ready');
		} finally {
			setup.service.dispose();
		}
	});

	test('same-row-twice: the second selection inside the lifetime reads nothing at all', async () => {
		const setup = await trailSetup();
		try {
			await setup.service.select(setup.change, 'trails');
			const afterFirst = setup.asked().length;
			await setup.service.select(setup.change, 'trails');
			assert.strictEqual(setup.asked().length, afterFirst, 'the CLI was asked again');
		} finally {
			setup.service.dispose();
		}
	});

	test('a click and a selection change in the same turn make one read', async () => {
		const setup = await trailSetup();
		try {
			await Promise.all([setup.service.select(setup.change, 'trails'), setup.service.select(setup.change, 'trails')]);
			assert.strictEqual(setup.asked().filter(line => line.startsWith('trail show')).length, 1);
		} finally {
			setup.service.dispose();
		}
	});

	test('reads nothing but the one trail show: no merge check, approvals, comments or findings', async () => {
		const setup = await trailSetup();
		try {
			await setup.service.select(setup.change, 'trails');
			const commands = setup.asked().filter(line => !line.startsWith('agent-help'));
			assert.deepStrictEqual(commands, ['trail show 40 --json']);
		} finally {
			setup.service.dispose();
		}
	});

	test('failed-read-is-a-row: a failed read is a row for that item and raises no popup', async () => {
		const setup = await trailSetup({ showFails: 'Error: the network is not allowed' });
		try {
			const popups = await withoutPopups(async () => {
				await setup.service.select(setup.change, 'trails');
			});
			assert.deepStrictEqual(popups, []);

			const last = setup.states[setup.states.length - 1];
			assert.strictEqual(last.kind, 'failed');
			assert.match(last.kind === 'failed' ? last.reason : '', /network is not allowed/);

			const html = renderDetailHtml(last);
			assert.match(html, /role="alert"[^>]*>.*Could not load entirely-vscode\/17: .*network is not allowed/s);
			assert.match(html, /href="command:entirely\.retryDetail"[^>]*>Retry</, 'the retry link is there');
			assert.match(html, /<h1>Shape the thing<\/h1>/, 'the item\'s heading is still there');
		} finally {
			setup.service.dispose();
		}
	});

	test('gone-item: a trail the CLI says is not found reads as no longer available, with a refresh', async () => {
		const setup = await trailSetup({ showFails: 'change entirely-vscode/17 not found' });
		try {
			await setup.service.select(setup.change, 'trails');
			const last = setup.states[setup.states.length - 1];
			assert.strictEqual(last.kind, 'gone');

			const html = renderDetailHtml(last);
			assert.match(html, /entirely-vscode\/17 is no longer available\. It may have been merged or deleted\./);
			assert.match(html, /href="command:entirely\.refresh"[^>]*>Refresh</);
		} finally {
			setup.service.dispose();
		}
	});

	test('gone-item: a change the trail no longer lists is gone, from the answer rather than the exit code', async () => {
		const missing = JSON.stringify({ ...TRAIL_SHOW, changes: [{ ...TRAIL_SHOW.changes[0], id: 'other', number: 99 }] });
		const setup = await trailSetup({ show: missing });
		try {
			await setup.service.select(setup.change, 'trails');
			assert.strictEqual(setup.states[setup.states.length - 1].kind, 'gone');
		} finally {
			setup.service.dispose();
		}
	});

	test('an answer that lists no changes is not taken to mean the change is gone', async () => {
		const bare = JSON.stringify({ ...TRAIL_SHOW, changes: [] });
		const setup = await trailSetup({ show: bare });
		try {
			await setup.service.select(setup.change, 'trails');
			assert.strictEqual(setup.states[setup.states.length - 1].kind, 'ready');
		} finally {
			setup.service.dispose();
		}
	});

	test('cli-missing-or-lacks-trail-show: the listing fields stay with one row saying why, and nothing is read', async () => {
		const setup = await trailSetup({ withoutShowHelp: true });
		try {
			await setup.service.select(setup.change, 'trails');
			const last = setup.states[setup.states.length - 1];
			assert.strictEqual(last.kind, 'ready');
			const rows = last.kind === 'ready' ? last.model.rows : [];
			assert.ok(rows.some(row => row.label === 'Branch' && row.value === 'shape-probe'));
			const why = rows.filter(row => row.value === 'Trail details need a newer Entire CLI');
			assert.strictEqual(why.length, 1);
			assert.strictEqual(why[0].command?.command, 'entirely.setUp');
			assert.deepStrictEqual(
				setup.asked().filter(line => line.startsWith('trail ')),
				[],
				'no trail command ran',
			);

			// Asking again asks again: a CLI installed a moment later is found.
			await setup.service.select(setup.change, 'trails');
			assert.strictEqual(setup.asked().filter(line => line.startsWith('agent-help trail show')).length, 2);
		} finally {
			setup.service.dispose();
		}
	});

	test('cli-missing-or-lacks-trail-show: with no CLI at all, sessions and activity still load', async () => {
		const trails: TrailReader = {
			showCapability: async () => ({ kind: 'unavailable', reason: 'absent', detail: 'the Entire CLI is not installed' }),
			read: async () => ({ kind: 'failed', detail: 'unreachable' }),
		};
		const service = new SelectionService({
			loader: createSelectionLoader({ detail: NOT_USED, usage: NO_USAGE, trails }),
			ttlSeconds: () => 30,
		});
		try {
			const setup = await trailSetup();
			await service.select(setup.change, 'trails');
			assert.match(JSON.stringify(service.state), /not available: the Entire CLI is not installed/);

			await service.select({ kind: 'session', session: SESSIONS[0] }, 'sessions');
			assert.strictEqual(service.state.kind, 'ready');
			const overview = foundActivity(COMMITS_OUTPUT, 'commits');
			const entry = overview.kind === 'found' ? overview.overview.groups[0].entries[0] : undefined;
			assert.ok(entry);
			await service.select({ kind: 'commit', entry }, 'activity');
			assert.strictEqual(service.state.kind, 'ready');
			assert.strictEqual(service.state.kind === 'ready' ? service.state.model.kind : '', 'commit');
			setup.service.dispose();
		} finally {
			service.dispose();
		}
	});

	test('keeps the trail body and the CLI output out of the output channel', async () => {
		const setup = await trailSetup();
		try {
			const lines: string[] = [];
			const channel = { appendLine: (line: string) => void lines.push(line) } as unknown as vscode.OutputChannel;
			const recorder = new CliInvocationRecorder();
			setup.cli.runner.setSink(new CliInvocationLogger(createLogger(channel, () => 'trace'), recorder));

			await setup.service.select(setup.change, 'trails');

			assert.ok(lines.some(line => line.includes('trail show')), 'the read was not logged at all');
			assert.ok(!lines.join('\n').includes(String(TRAIL_SHOW.body)), 'the trail body reached the output channel');
			assert.ok(!(recorder.latestBodies()?.stdout ?? '').includes(String(TRAIL_SHOW.body)), 'the body was kept for the dump command');
		} finally {
			setup.service.dispose();
		}
	});

	test('the trail body is in the document and not in the rows', async () => {
		const setup = await trailSetup();
		try {
			await setup.service.select(setup.change, 'trails');
			const documents = new GeneratedDocuments();
			let opened: vscode.Uri | undefined;
			await openDetailInEditor({
				selection: setup.service,
				documents,
				show: async uri => {
					opened = uri;
				},
			});
			assert.ok(opened);
			assert.ok(documents.textOf(opened)?.includes(String(TRAIL_SHOW.body)));
			assert.ok(!renderDetailHtml(setup.service.state).includes(String(TRAIL_SHOW.body)), 'the body is in the panel');
			documents.dispose();
		} finally {
			setup.service.dispose();
		}
	});
});

suite('Entire detail panel: actions', function () {
	this.timeout(30_000);

	test('the viewer\'s actions reuse the review commands: the change given is acted on without asking which one', async () => {
		const setup = await trailSetup();
		try {
			await setup.service.select(setup.change, 'trails');
			const shown = setup.service.state;
			assert.ok(shown.kind === 'ready' && shown.model.pick && shown.model.pick.kind === 'change');
			const pick = shown.model.pick;

			const changed: string[] = [];
			const deps: TrailReviewDependencies = {
				trails: setup.trails,
				actingHandle: () => undefined,
				changed: pick => changed.push(...touchedKeys(pick)),
			};
			let picker = 0;
			const window = vscode.window as unknown as Record<string, unknown>;
			const original = window.showQuickPick;
			window.showQuickPick = async () => {
				picker += 1;
				return undefined;
			};
			try {
				await withoutPopups(async () => {
					await approveChange(deps, pick);
				});
			} finally {
				window.showQuickPick = original;
			}

			assert.strictEqual(picker, 0, 'the reviewer was asked which change');
			assert.ok(setup.asked().some(line => line.startsWith('trail approve entirely-vscode/17')));
			assert.deepStrictEqual(changed, ['trail:40', 'change:entirely-vscode/17']);
		} finally {
			setup.service.dispose();
		}
	});

	test('link acts on the parent trail of the change shown, after its own confirmation', async () => {
		const setup = await trailSetup();
		try {
			await setup.service.select(setup.change, 'trails');
			const shown = setup.service.state;
			assert.ok(shown.kind === 'ready' && shown.model.pick);
			const pick = shown.model.pick;

			const window = vscode.window as unknown as Record<string, unknown>;
			const inputBox = window.showInputBox;
			const warning = window.showWarningMessage;
			const confirmations: string[] = [];
			window.showInputBox = async () => 'a-branch';
			window.showWarningMessage = async (message: string) => {
				confirmations.push(message);
				return 'Link';
			};
			const information = window.showInformationMessage;
			window.showInformationMessage = async () => undefined;
			try {
				await linkBranch({ trails: setup.trails, actingHandle: () => undefined }, pick);
			} finally {
				window.showInputBox = inputBox;
				window.showWarningMessage = warning;
				window.showInformationMessage = information;
			}
			assert.deepStrictEqual(confirmations, ['Link a-branch to trail #40?']);
			assert.ok(setup.asked().some(line => line.startsWith('trail link 40 --branch a-branch')));
		} finally {
			setup.service.dispose();
		}
	});

	test('the selection service and the loader never call a mutating trail method', () => {
		for (const file of ['services/selection.ts', 'services/selectionLoader.ts', 'providers/detailPanel.ts', 'commands/selection.ts']) {
			const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', file), 'utf8');
			assert.doesNotMatch(source, /\.(approve|merge|mergePlan|link|unlink|comment|checkout|finding)\(/, `${file} calls a trail action`);
		}
		const reader: (keyof TrailReader)[] = ['showCapability', 'read'];
		assert.deepStrictEqual(reader.sort(), ['read', 'showCapability']);
	});
});

suite('Entire detail panel: rows in the views', function () {
	this.timeout(30_000);

	test('rows in Sessions, in every group, carry the select command; groups carry none', () => {
		const provider = new SessionsProvider(async () => ({ sessions: [] }), () => 0);
		try {
			const groups = buildGroups(SESSIONS);
			assert.deepStrictEqual(groups.map(group => group.status), ['active', 'ended', 'idle']);
			for (const group of groups) {
				assert.strictEqual(provider.getTreeItem(group).command, undefined, `the ${group.status} group selects`);
				for (const node of group.items) {
					const command = provider.getTreeItem(node).command;
					assert.strictEqual(command?.command, 'entirely.selectItem');
					const [chosen, source] = command?.arguments ?? [];
					assert.strictEqual(source, 'sessions');
					assert.strictEqual(selectionKey(chosen as Selection), `session:${node.session.id}`);
				}
			}
		} finally {
			provider.dispose();
		}
	});

	test('rows in Trails carry the command for a trail and for a change', async () => {
		const setup = await trailSetup();
		const provider = new TrailsProvider(createTrailListingSource(setup.trails), () => 0, { changes: setup.changes, badgeLimit: () => 10 });
		try {
			await provider.refresh();
			const [trail] = provider.getChildren() as TrailsNode[];
			const [change] = await provider.getChildren(trail);
			for (const [node, key] of [
				[trail, 'trail:40'],
				[change, 'change:entirely-vscode/17'],
			] as const) {
				const command = provider.getTreeItem(node).command;
				assert.strictEqual(command?.command, 'entirely.selectItem');
				assert.strictEqual(selectionKey((command?.arguments ?? [])[0] as Selection), key);
				assert.strictEqual((command?.arguments ?? [])[1], 'trails');
			}
			assert.ok(provider.find('change:entirely-vscode/17'));
			assert.strictEqual(provider.find('change:entirely-vscode/99'), undefined);
		} finally {
			provider.dispose();
			setup.service.dispose();
		}
	});

	test('rows in Activity carry the command for a commit, a session line and a repository; groups and figures carry none', () => {
		for (const [output, listing] of [
			[COMMITS_OUTPUT, 'commits'],
			[SESSIONS_OUTPUT, 'sessions'],
		] as const) {
			const outcome = foundActivity(output, listing);
			assert.strictEqual(outcome.kind, 'found');
			const nodes = outcome.kind === 'found' ? buildActivityNodes(outcome.overview, 'alice') : [];
			const provider = new ActivityProvider({ read: async () => outcome }, () => 'alice');
			try {
				const lines: ActivityLine[] = [];
				const walk = (list: readonly ActivityNodeLike[]): void => {
					for (const node of list) {
						if (node.kind === 'group') {
							assert.strictEqual(provider.getTreeItem(node).command, undefined);
							walk(node.items);
						} else if (node.kind === 'line') {
							lines.push(node);
						} else {
							assert.strictEqual(provider.getTreeItem(node).command, undefined, 'a scope row selects');
						}
					}
				};
				walk(nodes);

				const selectable = lines.filter(line => line.selection);
				assert.ok(selectable.length > 0);
				const kinds = new Set(selectable.map(line => line.selection?.kind));
				if (listing === 'commits') {
					assert.ok(kinds.has('commit'));
				} else {
					assert.ok(kinds.has('activity-session'));
				}
				assert.ok(kinds.has('repository'));
				for (const line of lines) {
					const command = provider.getTreeItem(line).command;
					if (line.selection) {
						assert.strictEqual(command?.command, 'entirely.selectItem');
						assert.strictEqual((command?.arguments ?? [])[1], 'activity');
					} else {
						assert.strictEqual(command, undefined, `${line.label} is a figure and selects nothing`);
					}
				}
			} finally {
				provider.dispose();
			}
		}
	});

	test('the figures of the overview are not selectable', () => {
		const outcome = foundActivity(COMMITS_OUTPUT, 'commits');
		const nodes = outcome.kind === 'found' ? buildActivityNodes(outcome.overview, undefined) : [];
		const overview = nodes.find(node => node.kind === 'group' && node.label === 'Overview');
		assert.ok(overview && overview.kind === 'group');
		assert.ok(overview.items.every(item => item.kind === 'line' && item.selection === undefined));
	});
});

type ActivityNodeLike = ReturnType<typeof buildActivityNodes>[number];
type ActivityLine = Extract<ActivityNodeLike, { kind: 'line' }>;

suite('Entire detail panel: moving between views', function () {
	this.timeout(30_000);

	function fakeView<T>() {
		const emitter = new vscode.EventEmitter<vscode.TreeViewSelectionChangeEvent<T>>();
		return {
			emitter,
			view: { onDidChangeSelection: emitter.event },
			choose(nodes: readonly T[]): void {
				emitter.fire({ selection: nodes });
			},
		};
	}

	test('selection-moves-between-views: a Trails row after a Sessions row moves the mark and the viewer', async () => {
		const setup = await trailSetup();
		const sessions = new SessionsProvider(async () => ({ sessions: SESSIONS }), () => 0);
		const trails = new TrailsProvider(createTrailListingSource(setup.trails), () => 0, { changes: setup.changes, badgeLimit: () => 10 });
		const activity = new ActivityProvider({ read: async () => foundActivity(COMMITS_OUTPUT, 'commits') }, () => 'alice');
		const provider = new SessionDetailProvider();
		const fake = fakePanels();
		const viewer = new DetailPanel({ create: fake.create });
		const subscriptions: vscode.Disposable[] = [];
		const sessionsView = fakeView<ReturnType<SessionsProvider['getChildren']>[number]>();
		const explorerView = fakeView<ReturnType<SessionsProvider['getChildren']>[number]>();
		const trailsView = fakeView<TrailsNode>();
		const activityView = fakeView<ReturnType<ActivityProvider['getChildren']>[number]>();
		const selected = new SelectedRows();
		const wiring: SelectionWiring = {
			selection: setup.service,
			panel: viewer,
			sessionView: provider,
			selected,
			sessions,
			trails,
			activity,
			documents: new GeneratedDocuments(),
			views: { sessions: sessionsView.view, explorerSessions: explorerView.view, trails: trailsView.view, activity: activityView.view },
		};
		try {
			await sessions.refresh();
			await trails.refresh();
			wireSelection({ subscriptions }, wiring);

			const group = sessions.getChildren()[0];
			const [first] = sessions.getChildren(group);
			sessionsView.choose([first]);
			await new Promise(resolve => setImmediate(resolve));
			const markedBy = (key: string): boolean => selected.provideFileDecoration(rowUri(key)) !== undefined;
			const sessionKey = first.kind === 'session' ? `session:${first.session.id}` : '';
			assert.ok(markedBy(sessionKey), 'the session row is marked');

			const [trail] = trails.getChildren() as TrailsNode[];
			const [change] = await trails.getChildren(trail);
			trailsView.choose([change]);
			// Joins the read the selection started; it does not start another.
			await setup.service.select(setup.change, 'trails');

			assert.strictEqual(setup.service.state.kind, 'ready');
			assert.strictEqual(setup.service.state.kind === 'ready' ? setup.service.state.model.kind : '', 'change');
			assert.strictEqual(markedBy(sessionKey), false, 'the Sessions mark was cleared');
			assert.ok(markedBy('change:entirely-vscode/17'), 'the change is marked');
			assert.strictEqual(selected.key, 'change:entirely-vscode/17');

			// A multi-selection and a group select nothing.
			const before = setup.service.currentSelection;
			sessionsView.choose([first, first]);
			sessionsView.choose([group]);
			activityView.choose([]);
			assert.strictEqual(setup.service.currentSelection, before);
		} finally {
			subscriptions.forEach(subscription => subscription.dispose());
			sessionsView.emitter.dispose();
			explorerView.emitter.dispose();
			trailsView.emitter.dispose();
			activityView.emitter.dispose();
			viewer.dispose();
			provider.dispose();
			wiring.documents instanceof GeneratedDocuments && wiring.documents.dispose();
			selected.dispose();
			sessions.dispose();
			trails.dispose();
			activity.dispose();
			setup.service.dispose();
		}
	});

	test('keyboard-selects-once: arrow to a row, then Enter, loads it once', async () => {
		let reads = 0;
		const service = new SelectionService({
			loader: async selection => {
				reads += 1;
				return { kind: 'ready', model: { key: selectionKey(selection), kind: 'session', title: 't', rows: [] } };
			},
			ttlSeconds: () => 30,
		});
		const sessions = new SessionsProvider(async () => ({ sessions: SESSIONS }), () => 0);
		const trails = new TrailsProvider(async () => ({ trails: [] }), () => 0);
		const activity = new ActivityProvider({ read: async () => ({ kind: 'empty' }) }, () => undefined);
		const provider = new SessionDetailProvider();
		const fake = fakePanels();
		const viewer = new DetailPanel({ create: fake.create });
		const sessionsView = fakeView<ReturnType<SessionsProvider['getChildren']>[number]>();
		const subscriptions: vscode.Disposable[] = [];
		try {
			await sessions.refresh();
			wireSelection(
				{ subscriptions },
				{
					selection: service,
					panel: viewer,
					sessionView: provider,
					selected: new SelectedRows(),
					sessions,
					trails,
					activity,
					documents: new GeneratedDocuments(),
					views: { sessions: sessionsView.view, explorerSessions: fakeView<never>().view, trails: fakeView<never>().view, activity: fakeView<never>().view },
				},
			);

			const node = sessions.getChildren().flatMap(group => sessions.getChildren(group))[1];
			// The arrow key fires only the selection event; Enter runs the row's command.
			sessionsView.choose([node]);
			const command = sessions.getTreeItem(node).command;
			await selectItem(service, command?.arguments?.[0], command?.arguments?.[1]);
			await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(reads, 1);

			// Choosing it again inside the lifetime reads nothing.
			sessionsView.choose([node]);
			await selectItem(service, command?.arguments?.[0], command?.arguments?.[1]);
			assert.strictEqual(reads, 1);
		} finally {
			subscriptions.forEach(subscription => subscription.dispose());
			sessionsView.emitter.dispose();
			service.dispose();
			sessions.dispose();
			trails.dispose();
			activity.dispose();
			viewer.dispose();
			provider.dispose();
		}
	});

	test('nothing-selected: a row that disappears when its view is read again empties the viewer', async () => {
		const service = new SelectionService({
			loader: async selection => ({ kind: 'ready', model: { key: selectionKey(selection), kind: 'session', title: 't', rows: [] } }),
			ttlSeconds: () => 30,
		});
		let listing: readonly Session[] = SESSIONS;
		const sessions = new SessionsProvider(async () => ({ sessions: listing }), () => 0);
		const trails = new TrailsProvider(async () => ({ trails: [] }), () => 0);
		const activity = new ActivityProvider({ read: async () => ({ kind: 'empty' }) }, () => undefined);
		const provider = new SessionDetailProvider();
		const fake = fakePanels();
		const viewer = new DetailPanel({ create: fake.create });
		const subscriptions: vscode.Disposable[] = [];
		const sessionsView = fakeView<ReturnType<SessionsProvider['getChildren']>[number]>();
		try {
			await sessions.refresh();
			wireSelection(
				{ subscriptions },
				{
					selection: service,
					panel: viewer,
					sessionView: provider,
					selected: new SelectedRows(),
					sessions,
					trails,
					activity,
					documents: new GeneratedDocuments(),
					views: { sessions: sessionsView.view, explorerSessions: fakeView<never>().view, trails: fakeView<never>().view, activity: fakeView<never>().view },
				},
			);
			const node = sessions.getChildren().flatMap(group => sessions.getChildren(group))[0];
			sessionsView.choose([node]);
			await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(service.state.kind, 'ready');

			const gone = node.kind === 'session' ? node.session.id : '';
			listing = SESSIONS.filter(session => session.id !== gone);
			await sessions.refresh();
			assert.strictEqual(service.state.kind, 'empty');
			assert.deepStrictEqual(provider.getChildren(), []);
		} finally {
			subscriptions.forEach(subscription => subscription.dispose());
			sessionsView.emitter.dispose();
			service.dispose();
			sessions.dispose();
			trails.dispose();
			activity.dispose();
			viewer.dispose();
			provider.dispose();
		}
	});

	test('a new Activity read makes what was held about its rows out of date', async () => {
		let reads = 0;
		const service = new SelectionService({
			loader: async selection => {
				reads += 1;
				return { kind: 'ready', model: { key: selectionKey(selection), kind: 'commit', title: 't', rows: [] } };
			},
			ttlSeconds: () => 30,
		});
		const outcome = foundActivity(COMMITS_OUTPUT, 'commits');
		const activity = new ActivityProvider({ read: async () => outcome }, () => 'alice');
		const sessions = new SessionsProvider(async () => ({ sessions: [] }), () => 0);
		const trails = new TrailsProvider(async () => ({ trails: [] }), () => 0);
		const provider = new SessionDetailProvider();
		const fake = fakePanels();
		const viewer = new DetailPanel({ create: fake.create });
		const subscriptions: vscode.Disposable[] = [];
		try {
			await activity.refresh();
			wireSelection(
				{ subscriptions },
				{
					selection: service,
					panel: viewer,
					sessionView: provider,
					selected: new SelectedRows(),
					sessions,
					trails,
					activity,
					documents: new GeneratedDocuments(),
					views: { sessions: fakeView<never>().view, explorerSessions: fakeView<never>().view, trails: fakeView<never>().view, activity: fakeView<never>().view },
				},
			);
			const commit = buildActivityNodes(outcome.kind === 'found' ? outcome.overview : (undefined as never), 'alice');
			const line = commit.flatMap(node => (node.kind === 'group' ? node.items : [])).find(node => node.kind === 'line' && node.selection?.kind === 'commit');
			assert.ok(line && line.kind === 'line' && line.selection);
			await service.select(line.selection, 'activity');
			await service.select(line.selection, 'activity');
			assert.strictEqual(reads, 1);

			await activity.refresh();
			await service.select(line.selection, 'activity');
			assert.strictEqual(reads, 2);
			assert.strictEqual(service.state.kind, 'ready', 'the same rows are still listed, so the viewer stays');
		} finally {
			subscriptions.forEach(subscription => subscription.dispose());
			service.dispose();
			activity.dispose();
			sessions.dispose();
			trails.dispose();
			viewer.dispose();
			provider.dispose();
		}
	});
});

suite('Entire detail panel: the extension', function () {
	this.timeout(30_000);

	async function activated(): Promise<void> {
		const extension = vscode.extensions.getExtension('greysquirr3l.entirely');
		assert.ok(extension, 'the extension was not loaded by the test host');
		await extension.activate();
	}

	test('registers the viewer commands and ignores an argument that is not a selection', async () => {
		await activated();
		const commands = await vscode.commands.getCommands(true);
		for (const command of ['entirely.selectItem', 'entirely.retryDetail', 'entirely.openDetailInEditor', 'entirely.copyCommitHash', 'entirely.selectSession']) {
			assert.ok(commands.includes(command), `${command} is not registered`);
		}
		await vscode.commands.executeCommand('entirely.selectItem', 'not a selection');
		await vscode.commands.executeCommand('entirely.selectItem', { kind: 'commit' });
		await vscode.commands.executeCommand('entirely.selectItem');
	});

	test('open-in-editor: the viewer\'s detail opens as a read-only generated document', async () => {
		await activated();
		const entry = { text: 'a1b2c3d fix the parser  acme/widgets  Copilot  +27 / -1', id: 'a1b2c3d', title: 'fix the parser', repo: 'acme/widgets', detail: 'Copilot  +27 / -1' };
		await vscode.commands.executeCommand('entirely.selectItem', { kind: 'commit', entry }, 'activity');
		await vscode.commands.executeCommand('entirely.openDetailInEditor');

		const editor = vscode.window.activeTextEditor;
		assert.ok(editor, 'no document opened');
		try {
			assert.strictEqual(editor.document.uri.scheme, GENERATED_SCHEME);
			const text = editor.document.getText();
			assert.ok(text.startsWith('Details — a1b2c3d fix the parser'), text);
			assert.ok(text.includes('Copilot  +27 / -1'));
			assert.ok(path.basename(editor.document.uri.path).startsWith('Details'));
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		}
	});

	test('open-in-editor: with nothing selected it says so instead of opening an empty document', async () => {
		const documents = new GeneratedDocuments();
		const service = new SelectionService({ loader: async () => ({ kind: 'failed', reason: 'unused' }), ttlSeconds: () => 0 });
		const told: string[] = [];
		try {
			await openDetailInEditor({ selection: service, documents, inform: message => told.push(message), show: async () => assert.fail('nothing should open') });
			assert.strictEqual(told.length, 1);
			assert.match(told[0], /Select a session/);
		} finally {
			service.dispose();
			documents.dispose();
		}
	});

	test('keeps the Session view as it was, and declares the cache and badge settings', async () => {
		await activated();
		const extension = vscode.extensions.getExtension('greysquirr3l.entirely');
		assert.ok(extension);
		const manifest = JSON.parse(fs.readFileSync(path.join(extension.extensionPath, 'package.json'), 'utf8')) as {
			contributes: {
				views: Record<string, { id: string; name: string }[]>;
				viewsWelcome: { view: string; contents: string }[];
				configuration: { properties: Record<string, { default?: unknown; minimum?: number; maximum?: number }> };
			};
		};
		const view = manifest.contributes.views.entirely.find(candidate => candidate.id === 'entirely.sessionDetail');
		assert.strictEqual(view?.name, 'Session', 'there is no Details view in the sidebar');
		assert.ok(!manifest.contributes.views.entirely.some(candidate => /details/i.test(candidate.name)));
		const welcome = manifest.contributes.viewsWelcome.find(candidate => candidate.view === 'entirely.sessionDetail');
		assert.strictEqual(welcome?.contents, 'Select a session to see its details.');
		const setting = manifest.contributes.configuration.properties['entirely.selectionCacheSeconds'];
		assert.deepStrictEqual([setting.default, setting.minimum, setting.maximum], [30, 0, 600]);
		const badge = manifest.contributes.configuration.properties['entirely.trailBadgeLimit'];
		assert.deepStrictEqual([badge.default, badge.minimum, badge.maximum], [10, 0, 50]);
	});
});

suite('Entire detail panel: clicking a row', function () {
	this.timeout(30_000);

	const sourceRoot = path.join(__dirname, '..', '..', 'src');
	const read = (file: string): string => fs.readFileSync(path.join(sourceRoot, file), 'utf8');

	/** The `entirely.` command ids a file puts in a `command: '…'` field of a tree row, status or field. */
	function referencedCommands(files: readonly string[]): Map<string, string[]> {
		const found = new Map<string, string[]>();
		for (const file of files) {
			for (const [, id] of read(file).matchAll(/\bcommand:\s*'(entirely\.[A-Za-z.]+)'/g)) {
				found.set(id, [...(found.get(id) ?? []), file]);
			}
		}
		return found;
	}

	function providerAndRowFiles(): string[] {
		const providers = fs
			.readdirSync(path.join(sourceRoot, 'providers'))
			.filter(name => name.endsWith('.ts'))
			.map(name => `providers/${name}`);
		return [...providers, 'lib/entire/sessionDetailRows.ts', 'lib/entire/selection.ts'];
	}

	test('selecting a row redraws none of the three views, so the click\'s own command is still there to run', async () => {
		const setup = await trailSetup();
		const sessions = new SessionsProvider(async () => ({ sessions: SESSIONS }), () => 0);
		const trails = new TrailsProvider(createTrailListingSource(setup.trails), () => 0, { changes: setup.changes, badgeLimit: () => 10 });
		const activity = new ActivityProvider({ read: async () => foundActivity(COMMITS_OUTPUT, 'commits') }, () => 'alice');
		const provider = new SessionDetailProvider();
		const fake = fakePanels();
		const viewer = new DetailPanel({ create: fake.create });
		const selected = new SelectedRows();
		const redrawn: string[] = [];
		const decorated: string[] = [];
		const subscriptions: vscode.Disposable[] = [
			sessions.onDidChangeTreeData(() => redrawn.push('sessions')),
			trails.onDidChangeTreeData(() => redrawn.push('trails')),
			activity.onDidChangeTreeData(() => redrawn.push('activity')),
			selected.onDidChangeFileDecorations(uris => decorated.push(...[uris].flat().map(uri => uri?.path ?? ''))),
		];
		const view = fakeViewOf();
		try {
			await sessions.refresh();
			await trails.refresh();
			await activity.refresh();
			redrawn.length = 0;
			wireSelection(
				{ subscriptions },
				{
					selection: setup.service,
					panel: viewer,
					sessionView: provider,
					selected,
					sessions,
					trails,
					activity,
					documents: new GeneratedDocuments(),
					views: { sessions: view.sessions.view, explorerSessions: view.explorer.view, trails: view.trails.view, activity: view.activity.view },
				},
			);

			const sessionNode = sessions.getChildren().flatMap(group => sessions.getChildren(group))[0];
			const [trailNode] = trails.getChildren() as TrailsNode[];
			const [changeNode] = await trails.getChildren(trailNode);
			// The selection event arrives first, then the row's own command.
			const sessionCommand = sessions.getTreeItem(sessionNode).command;
			view.sessions.choose([sessionNode]);
			await selectItem(setup.service, sessionCommand?.arguments?.[0], sessionCommand?.arguments?.[1]);
			const changeCommand = trails.getTreeItem(changeNode).command;
			view.trails.choose([changeNode]);
			await selectItem(setup.service, changeCommand?.arguments?.[0], changeCommand?.arguments?.[1]);

			assert.deepStrictEqual(redrawn, [], `a view was redrawn by a selection: ${redrawn.join(', ')}`);
			assert.ok(decorated.length > 0, 'the mark did not move');
			assert.strictEqual(selected.key, 'change:entirely-vscode/17');
		} finally {
			subscriptions.forEach(subscription => subscription.dispose());
			view.dispose();
			selected.dispose();
			viewer.dispose();
			provider.dispose();
			sessions.dispose();
			trails.dispose();
			activity.dispose();
			setup.service.dispose();
		}
	});

	test('every command a row can run is registered by the commands directory, and by the running extension', async () => {
		const referenced = referencedCommands(providerAndRowFiles());
		for (const expected of ['entirely.selectItem', 'entirely.openTranscript', 'entirely.explainCheckpoint', 'entirely.setUp']) {
			assert.ok(referenced.has(expected), `${expected} is no longer referenced, so this test no longer covers it`);
		}
		// The panel's links run commands by id too, and each one must exist.
		for (const id of DETAIL_COMMANDS) {
			referenced.set(id, [...(referenced.get(id) ?? []), 'lib/entire/detailActions.ts']);
		}

		const commandsDirectory = path.join(sourceRoot, 'commands');
		const registered = new Set(
			fs
				.readdirSync(commandsDirectory)
				.filter(name => name.endsWith('.ts'))
				.flatMap(name => [...fs.readFileSync(path.join(commandsDirectory, name), 'utf8').matchAll(/registerCommand\('([^']+)'/g)])
				.map(([, id]) => id),
		);
		const missing = [...referenced.keys()].filter(id => !registered.has(id));
		assert.deepStrictEqual(missing, [], `rows run commands nobody registers: ${missing.join(', ')}`);

		const extension = vscode.extensions.getExtension('greysquirr3l.entirely');
		assert.ok(extension);
		await extension.activate();
		const live = new Set(await vscode.commands.getCommands(true));
		const absent = [...referenced.keys()].filter(id => !live.has(id));
		assert.deepStrictEqual(absent, [], `rows run commands the running extension lacks: ${absent.join(', ')}`);
	});

	test('the viewer commands are registered before the first tree view is created', () => {
		const activation = read('extension.ts');
		const registered = activation.indexOf('registerSelectionCommands(');
		const firstView = activation.indexOf('createTreeView(');
		assert.ok(registered > 0, 'the viewer commands are never registered');
		assert.ok(firstView > 0);
		assert.ok(registered < firstView, 'a row could be clicked before its command exists');
		assert.match(read('commands/selection.ts'), /registerCommand\('entirely\.selectItem'/);
	});

	test('a row that arrives with nothing to show is a line in the viewer, never a throw or a popup', async () => {
		const loads: string[] = [];
		const service = new SelectionService({
			loader: async selection => {
				loads.push(selectionKey(selection));
				return { kind: 'ready', model: { key: selectionKey(selection), kind: 'commit', title: 't', rows: [], heading: 'h' } };
			},
			ttlSeconds: () => 30,
		});
		const states: ViewerState[] = [];
		service.onDidChange(state => states.push(state));
		try {
			const popups = await withoutPopups(async () => {
				for (const bad of ['/78', 'entirely.selectItem /78', 78, null, undefined, {}, { kind: 'commit' }, [], { kind: 'change', entry: {} }]) {
					await selectItem(service, bad, 'trails');
					const last = states[states.length - 1];
					assert.strictEqual(last.kind, 'notice');
				}
			});
			assert.deepStrictEqual(popups, []);
			assert.deepStrictEqual(loads, [], 'nothing was read for a value that is not a row');

			const last = states[states.length - 1];
			const html = renderDetailHtml(last);
			assert.match(html, /Could not show that row/);
			assert.ok(!html.includes('/78'), 'the value that arrived is not echoed');
			assert.strictEqual(describeViewerTitle(last), 'Details');

			// The Session view shows sessions only, so a notice leaves it alone.
			const sessionView = new SessionDetailProvider();
			sessionView.render(last);
			assert.deepStrictEqual(sessionView.getChildren(), []);
			sessionView.dispose();

			// A real row afterwards loads as usual.
			await selectItem(service, { kind: 'commit', entry: { text: 'a1b2c3d t  acme/app', id: 'a1b2c3d', title: 't', repo: 'acme/app' } }, 'activity');
			assert.strictEqual(service.state.kind, 'ready');
			assert.deepStrictEqual(loads, ['commit:a1b2c3d@acme/app']);
		} finally {
			service.dispose();
		}
	});

	test('opening the detail while the viewer shows a notice says there is nothing to open', async () => {
		const service = new SelectionService({ loader: async () => ({ kind: 'failed', reason: 'unused' }), ttlSeconds: () => 0 });
		const documents = new GeneratedDocuments();
		const told: string[] = [];
		try {
			service.notify('Could not show that row: it did not carry anything to show.');
			await openDetailInEditor({ selection: service, documents, inform: message => told.push(message), show: async () => assert.fail('nothing should open') });
			assert.strictEqual(told.length, 1);
		} finally {
			service.dispose();
			documents.dispose();
		}
	});
});

/** Four fake tree views whose selection events a test fires by hand. */
function fakeViewOf() {
	const make = <T,>() => {
		const emitter = new vscode.EventEmitter<vscode.TreeViewSelectionChangeEvent<T>>();
		return {
			emitter,
			view: { onDidChangeSelection: emitter.event },
			choose(nodes: readonly T[]): void {
				emitter.fire({ selection: nodes });
			},
		};
	};
	const sessions = make<ReturnType<SessionsProvider['getChildren']>[number]>();
	const explorer = make<ReturnType<SessionsProvider['getChildren']>[number]>();
	const trails = make<TrailsNode>();
	const activity = make<ReturnType<ActivityProvider['getChildren']>[number]>();
	return {
		sessions,
		explorer,
		trails,
		activity,
		dispose(): void {
			for (const view of [sessions, explorer, trails, activity]) {
				view.emitter.dispose();
			}
		},
	};
}

suite('Entire detail panel: closing, copying and the Session view', function () {
	this.timeout(30_000);

	const commitSelection: Extract<Selection, { kind: 'commit' }> = {
		kind: 'commit',
		entry: { text: 'a1b2c3d fix  acme/app', id: 'a1b2c3d', title: 'fix', repo: 'acme/app' },
	};

	function idleService(): SelectionService {
		return new SelectionService({
			loader: async selection => ({
				kind: 'ready',
				model: { key: selectionKey(selection), kind: selection.kind, title: 't', rows: [], heading: 'h' },
			}),
			ttlSeconds: () => 30,
		});
	}

	test('copyCommitHash copies the hash of the commit on show, and ignores any other argument', async () => {
		const service = idleService();
		const copied: string[] = [];
		const said: string[] = [];
		const deps = { selection: service, copy: async (text: string) => void copied.push(text), say: (message: string) => void said.push(message) };
		try {
			await copyCommitHash(deps, 'commit:a1b2c3d@acme/app');
			assert.deepStrictEqual(copied, [], 'nothing is on show yet');

			await service.select(commitSelection, 'activity');
			for (const other of ['commit:ffffff@acme/app', 'a1b2c3d', '', 4, null, undefined, {}, ['commit:a1b2c3d@acme/app'], '--version']) {
				await copyCommitHash(deps, other);
			}
			assert.deepStrictEqual(copied, [], 'something other than the row id of the commit on show was copied');

			await copyCommitHash(deps, 'commit:a1b2c3d@acme/app');
			assert.deepStrictEqual(copied, ['a1b2c3d']);
			assert.deepStrictEqual(said, ['Copied a1b2c3d']);

			// An id that does not look like a hash is not put on the clipboard.
			const odd: Extract<Selection, { kind: 'commit' }> = { kind: 'commit', entry: { text: 'x', id: 'not a hash!' } };
			await service.select(odd, 'activity');
			await copyCommitHash(deps, selectionKey(odd));
			assert.strictEqual(copied.length, 1);
		} finally {
			service.dispose();
		}
	});

	test('closed-panel-reopens: closing the panel clears the mark, and choosing the same row opens it again without a read', async () => {
		let reads = 0;
		const service = new SelectionService({
			loader: async selection => {
				reads += 1;
				return { kind: 'ready', model: { key: selectionKey(selection), kind: 'session', title: 't', rows: [{ label: 'a', value: 'b' }] } };
			},
			ttlSeconds: () => 30,
		});
		const sessions = new SessionsProvider(async () => ({ sessions: SESSIONS }), () => 0);
		const trails = new TrailsProvider(async () => ({ trails: [] }), () => 0);
		const activity = new ActivityProvider({ read: async () => ({ kind: 'empty' }) }, () => undefined);
		const sessionView = new SessionDetailProvider();
		const fake = fakePanels();
		const panel = new DetailPanel({ create: fake.create });
		const selected = new SelectedRows();
		const mark = (): string | undefined => selected.key;
		const views = fakeViewOf();
		const subscriptions: vscode.Disposable[] = [];
		try {
			await sessions.refresh();
			wireSelection(
				{ subscriptions },
				{
					selection: service,
					panel,
					sessionView,
					selected,
					sessions,
					trails,
					activity,
					documents: new GeneratedDocuments(),
					views: { sessions: views.sessions.view, explorerSessions: views.explorer.view, trails: views.trails.view, activity: views.activity.view },
				},
			);
			const node = sessions.getChildren().flatMap(group => sessions.getChildren(group))[0];

			views.sessions.choose([node]);
			await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(fake.made.length, 1);
			assert.ok(mark()?.startsWith('session:'));

			fake.made[0].dispose();
			assert.strictEqual(mark(), undefined, 'nothing is shown, so nothing is marked');
			assert.strictEqual(service.state.kind, 'empty');

			views.sessions.choose([node]);
			await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(fake.made.length, 2, 'the panel did not open again');
			assert.strictEqual(reads, 1, 'the second choice read again instead of using what it had');
			assert.ok(mark()?.startsWith('session:'));
		} finally {
			subscriptions.forEach(subscription => subscription.dispose());
			views.dispose();
			panel.dispose();
			selected.dispose();
			sessionView.dispose();
			service.dispose();
			sessions.dispose();
			trails.dispose();
			activity.dispose();
		}
	});

	test('the Session view shows a session and leaves everything else to the panel', () => {
		const provider = new SessionDetailProvider();
		try {
			const session: Selection = { kind: 'session', session: SESSIONS[0] };
			const model = { key: 'session:sess-active', kind: 'session' as const, title: 'claude-code — fix the parser', rows: [{ label: 'Agent', value: 'claude-code' }, { label: 'Last prompt', value: '', lines: ['a', 'b'] }] };
			provider.render({ kind: 'ready', selection: session, model });
			assert.deepStrictEqual(provider.getChildren().map(node => (node.kind === 'line' ? node.text : node.label)), ['Agent', 'Last prompt']);
			assert.strictEqual(provider.current?.id, 'sess-active');

			// A commit, a trail change, a notice and a loading step of another item leave it alone.
			provider.render({ kind: 'ready', selection: commitSelection, model: { key: 'commit:x', kind: 'commit', title: 'c', rows: [{ label: 'Commit', value: 'x' }] } });
			provider.render({ kind: 'notice', message: 'nope' });
			assert.deepStrictEqual(provider.getChildren().map(node => (node.kind === 'line' ? node.text : node.label)), ['Agent', 'Last prompt']);
			assert.strictEqual(provider.current?.id, 'sess-active');

			// A session that could not be read still shows what the list knew, and says so.
			provider.render({ kind: 'gone', selection: session, model, reason: 'gone' });
			const last = provider.getChildren().at(-1);
			assert.ok(last && last.kind === 'field');
			assert.strictEqual(last.label, 'Detail');
			assert.strictEqual(last.tooltip, 'gone');

			provider.render({ kind: 'empty' });
			assert.deepStrictEqual(provider.getChildren(), []);
			assert.strictEqual(provider.current, undefined);
			assert.deepStrictEqual(provider.getChildren(), [], 'the welcome text shows when the tree is empty');
		} finally {
			provider.dispose();
		}
	});

	test('the Trails view cannot tell a change of an unread trail from a gone one, so the panel stays', async () => {
		const setup = await trailSetup();
		const trails = new TrailsProvider(createTrailListingSource(setup.trails), () => 0, { changes: setup.changes, badgeLimit: () => 0 });
		try {
			await trails.refresh();
			assert.strictEqual(trails.has('trail:40'), true);
			assert.strictEqual(trails.has('change:entirely-vscode/17'), undefined, 'the trail has not been read');
			assert.strictEqual(trails.has('trail:99'), false);

			const [node] = trails.getChildren() as TrailsNode[];
			await trails.getChildren(node);
			assert.strictEqual(trails.has('change:entirely-vscode/17'), true);
			assert.strictEqual(trails.has('change:entirely-vscode/99'), false, 'with every trail read, a missing change is gone');

			// After an action, a listing that cannot find the change yet re-reads the one on show.
			await setup.service.select(setup.change, 'trails');
			const reads = setup.asked().filter(line => line.startsWith('trail show')).length;
			await trails.refresh();
			setup.service.reloadFrom(trails);
			await new Promise(resolve => setImmediate(resolve));
			assert.notStrictEqual(setup.service.state.kind, 'empty', 'the viewer was emptied by a listing that had not read the trail');
			assert.ok(setup.asked().filter(line => line.startsWith('trail show')).length >= reads);
		} finally {
			trails.dispose();
			setup.service.dispose();
		}
	});
});
