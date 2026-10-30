import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { approveChange, linkBranch, type TrailReviewDependencies } from '../commands/trailReview';
import { openDetailInEditor, selectItem, wireSelection, type SelectionWiring } from '../commands/selection';
import {
	buildDetailNodes,
	SessionDetailProvider,
	type DetailNode,
} from '../providers/sessionDetailProvider';
import { DetailViewer, VIEWER_TITLE, describeViewer, type ViewerSurface } from '../providers/detailViewer';
import { GENERATED_SCHEME, GeneratedDocuments } from '../providers/generatedDocuments';
import { ActivityProvider, buildActivityNodes } from '../providers/activityProvider';
import { SessionsProvider, buildGroups } from '../providers/sessionsProvider';
import { SelectedRows, rowUri } from '../providers/selectedMark';
import { TrailsProvider, buildTrailNodes } from '../providers/trailsProvider';
import {
	parseActivity,
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
import { TrailService } from '../services/trailService';
import type { ActivityOutcome } from '../services/activity';
import { COMMITS_OUTPUT, SESSIONS_OUTPUT } from './support/activityCli';
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
	const nodes = buildTrailNodes(listing.trails);
	const listed = invocations(cli.log).length;
	const service = new SelectionService({
		loader: createSelectionLoader({ detail: NOT_USED, usage: NO_USAGE, trails }),
		ttlSeconds: () => ttl,
	});
	const states: ViewerState[] = [];
	service.onDidChange(state => states.push(state));
	const changeNode = nodes[0].changes[0];
	const change: Selection = { kind: 'change', trail: changeNode.trail, entry: changeNode.entry };
	const trail: Selection = { kind: 'trail', entry: nodes[0].entry };
	return {
		cli,
		trails,
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

suite('Entire Details viewer: trails', function () {
	this.timeout(30_000);

	test('select-each-kind: a change is shown with the one trail show and no other trail command', async () => {
		const setup = await trailSetup();
		try {
			await setup.service.select(setup.change, 'trails');

			assert.deepStrictEqual(setup.asked().filter(line => line.startsWith('trail ')), ['trail show entirely-vscode/17 --json']);
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
			assert.deepStrictEqual(commands, ['trail show entirely-vscode/17 --json']);
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

			const nodes = buildDetailNodes(last);
			const status = nodes.find(node => node.kind === 'status');
			assert.ok(status && status.kind === 'status');
			assert.strictEqual(status.role, 'failed');
			assert.match(status.label, /Could not load entirely-vscode\/17: .*network is not allowed/);
			assert.ok(nodes.some(node => node.kind === 'header'), 'the item\'s header row is still there');
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

			const provider = new SessionDetailProvider();
			provider.render(last);
			const status = provider.getChildren().find(node => node.kind === 'status');
			assert.ok(status && status.kind === 'status');
			assert.match(status.label, /entirely-vscode\/17 is no longer available\. It may have been merged or deleted\./);
			assert.strictEqual(provider.getTreeItem(status).command?.command, 'entirely.refresh');
			provider.dispose();
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
			show: async () => ({ kind: 'failed', detail: 'unreachable' }),
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
			const provider = new SessionDetailProvider();
			provider.render(setup.service.state);
			const shown = provider.getChildren().map(node => {
				const item = provider.getTreeItem(node);
				return [item.label, item.description, item.tooltip].map(part => String(part ?? '')).join(' ');
			});
			assert.ok(!shown.join('\n').includes(String(TRAIL_SHOW.body)), 'the body is in a row');
			provider.dispose();
			documents.dispose();
		} finally {
			setup.service.dispose();
		}
	});
});

suite('Entire Details viewer: actions', function () {
	this.timeout(30_000);

	test('the viewer\'s actions reuse the review commands: the change given is acted on without asking which one', async () => {
		const setup = await trailSetup();
		try {
			await setup.service.select(setup.change, 'trails');
			const header = buildDetailNodes(setup.service.state).find(node => node.kind === 'header');
			assert.ok(header && header.kind === 'header');
			assert.ok(header.pick && header.pick.kind === 'change');

			const provider = new SessionDetailProvider();
			provider.render(setup.service.state);
			const item = provider.getTreeItem(provider.getChildren()[0]);
			assert.strictEqual(item.contextValue, 'entirely.detail.change');
			provider.dispose();

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
					await approveChange(deps, header.pick);
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
			const header = buildDetailNodes(setup.service.state).find(node => node.kind === 'header');
			assert.ok(header && header.kind === 'header' && header.pick);

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
				await linkBranch({ trails: setup.trails, actingHandle: () => undefined }, header.pick);
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
		for (const file of ['services/selection.ts', 'services/selectionLoader.ts', 'providers/detailViewer.ts', 'commands/selection.ts']) {
			const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', file), 'utf8');
			assert.doesNotMatch(source, /\.(approve|merge|mergePlan|link|unlink|comment|checkout|finding)\(/, `${file} calls a trail action`);
		}
		const reader: (keyof TrailReader)[] = ['showCapability', 'show'];
		assert.deepStrictEqual(reader.sort(), ['show', 'showCapability']);
	});
});

suite('Entire Details viewer: rows in the views', function () {
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
		const provider = new TrailsProvider(createTrailListingSource(setup.trails), () => 0);
		try {
			await provider.refresh();
			const [trail] = provider.getChildren();
			const [change] = provider.getChildren(trail);
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

suite('Entire Details viewer: the view', function () {
	this.timeout(30_000);

	function surface(): ViewerSurface & { reveals: { options?: { focus?: boolean; select?: boolean } }[]; failReveal: boolean } {
		const recorded = {
			title: undefined as string | undefined,
			description: undefined as string | undefined,
			reveals: [] as { options?: { focus?: boolean; select?: boolean } }[],
			failReveal: false,
			reveal(_element: DetailNode, options?: { focus?: boolean; select?: boolean }): Thenable<void> {
				recorded.reveals.push({ options });
				return recorded.failReveal ? Promise.reject(new Error('the view is not visible')) : Promise.resolve();
			},
		};
		return recorded;
	}

	const commitSelection = (id: string): Selection => ({
		kind: 'commit',
		entry: { text: `${id} title  acme/app`, id, title: `title ${id}`, repo: 'acme/app' },
	});

	test('collapsed-viewer-revealed: reveals without focus once per content change, and not on a cache hit', async () => {
		const provider = new SessionDetailProvider();
		const view = surface();
		const viewer = new DetailViewer(provider, view);
		const service = new SelectionService({
			loader: createSelectionLoader({ detail: NOT_USED, usage: NO_USAGE, trails: { showCapability: async () => ({ kind: 'available' }), show: async () => ({ kind: 'failed', detail: 'x' }) } }),
			ttlSeconds: () => 30,
		});
		service.onDidChange(state => viewer.apply(state));
		try {
			const a = commitSelection('aaaaaaa');
			const b = commitSelection('bbbbbbb');

			await service.select(a, 'activity');
			assert.strictEqual(view.reveals.length, 1);
			assert.deepStrictEqual(view.reveals[0].options, { focus: false, select: false });

			await service.select(a, 'activity');
			assert.strictEqual(view.reveals.length, 1, 'a cache hit with the same key revealed again');

			await service.select(b, 'activity');
			assert.strictEqual(view.reveals.length, 2);
			await service.select(a, 'activity');
			assert.strictEqual(view.reveals.length, 3, 'a different item revealed the viewer');

			service.clear();
			await service.select(a, 'activity');
			assert.strictEqual(view.reveals.length, 4, 'after the viewer was emptied');
		} finally {
			service.dispose();
			viewer.dispose();
			provider.dispose();
		}
	});

	test('a reveal the editor refuses does not escape', async () => {
		const provider = new SessionDetailProvider();
		const view = surface();
		view.failReveal = true;
		const viewer = new DetailViewer(provider, view);
		try {
			const selection = commitSelection('ccccccc');
			viewer.apply({ kind: 'ready', selection, model: { key: selectionKey(selection), kind: 'commit', title: 't', rows: [], heading: 'h' } });
			await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(view.reveals.length, 1);
		} finally {
			viewer.dispose();
			provider.dispose();
		}
	});

	test('names the selected item in the title and description, and clears them when nothing is selected', () => {
		const provider = new SessionDetailProvider();
		const view = surface();
		const viewer = new DetailViewer(provider, view);
		try {
			assert.strictEqual(view.title, VIEWER_TITLE);
			assert.strictEqual(VIEWER_TITLE, 'Details');

			const selection = commitSelection('ddddddd');
			const model = { key: selectionKey(selection), kind: 'commit' as const, title: 'ddddddd title ddddddd', rows: [], heading: 'h' };
			viewer.apply({ kind: 'ready', selection, model });
			assert.strictEqual(view.description, 'ddddddd title ddddddd');
			viewer.apply({ kind: 'ready', selection, model, asOf: new Date(2026, 9, 30, 10, 42, 3).getTime() });
			assert.strictEqual(view.description, 'ddddddd title ddddddd · as of 10:42:03');
			assert.strictEqual(describeViewer({ kind: 'empty' }), undefined);
			viewer.apply({ kind: 'empty' });
			assert.strictEqual(view.description, undefined);
			assert.deepStrictEqual(provider.getChildren(), [], 'the welcome text shows when the tree is empty');
		} finally {
			viewer.dispose();
			provider.dispose();
		}
	});

	test('keeps the same nodes between reads of one state, so the editor can reveal one', () => {
		const provider = new SessionDetailProvider();
		try {
			const selection = commitSelection('eeeeeee');
			provider.render({ kind: 'ready', selection, model: { key: 'k', kind: 'commit', title: 't', rows: [{ label: 'a', value: 'b' }], heading: 'h' } });
			assert.strictEqual(provider.getChildren()[0], provider.getChildren()[0]);
			assert.strictEqual(provider.firstNode, provider.getChildren()[0]);
		} finally {
			provider.dispose();
		}
	});

	test('a note that the refresh failed sits under the item and keeps the old rows', () => {
		const selection = commitSelection('fffffff');
		const nodes = buildDetailNodes({
			kind: 'ready',
			selection,
			model: { key: 'k', kind: 'commit', title: 't', rows: [{ label: 'a', value: 'b' }], heading: 'h' },
			refreshFailure: 'network down',
		});
		assert.deepStrictEqual(nodes.map(node => node.kind), ['header', 'status', 'field']);
		const status = nodes[1];
		assert.ok(status.kind === 'status');
		assert.strictEqual(status.label, 'Could not refresh: network down');
	});
});

suite('Entire Details viewer: moving between views', function () {
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
		const trails = new TrailsProvider(createTrailListingSource(setup.trails), () => 0);
		const activity = new ActivityProvider({ read: async () => foundActivity(COMMITS_OUTPUT, 'commits') }, () => 'alice');
		const provider = new SessionDetailProvider();
		const viewer = new DetailViewer(provider, { reveal: async () => undefined });
		const subscriptions: vscode.Disposable[] = [];
		const sessionsView = fakeView<ReturnType<SessionsProvider['getChildren']>[number]>();
		const explorerView = fakeView<ReturnType<SessionsProvider['getChildren']>[number]>();
		const trailsView = fakeView<ReturnType<TrailsProvider['getChildren']>[number]>();
		const activityView = fakeView<ReturnType<ActivityProvider['getChildren']>[number]>();
		const selected = new SelectedRows();
		const wiring: SelectionWiring = {
			selection: setup.service,
			viewer,
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

			const [trail] = trails.getChildren();
			const [change] = trails.getChildren(trail);
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
		const viewer = new DetailViewer(provider, { reveal: async () => undefined });
		const sessionsView = fakeView<ReturnType<SessionsProvider['getChildren']>[number]>();
		const subscriptions: vscode.Disposable[] = [];
		try {
			await sessions.refresh();
			wireSelection(
				{ subscriptions },
				{
					selection: service,
					viewer,
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
		const viewer = new DetailViewer(provider, { reveal: async () => undefined });
		const subscriptions: vscode.Disposable[] = [];
		const sessionsView = fakeView<ReturnType<SessionsProvider['getChildren']>[number]>();
		try {
			await sessions.refresh();
			wireSelection(
				{ subscriptions },
				{
					selection: service,
					viewer,
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
		const viewer = new DetailViewer(provider, { reveal: async () => undefined });
		const subscriptions: vscode.Disposable[] = [];
		try {
			await activity.refresh();
			wireSelection(
				{ subscriptions },
				{
					selection: service,
					viewer,
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

suite('Entire Details viewer: the extension', function () {
	this.timeout(30_000);

	async function activated(): Promise<void> {
		const extension = vscode.extensions.getExtension('greysquirr3l.entirely');
		assert.ok(extension, 'the extension was not loaded by the test host');
		await extension.activate();
	}

	test('registers the viewer commands and ignores an argument that is not a selection', async () => {
		await activated();
		const commands = await vscode.commands.getCommands(true);
		for (const command of ['entirely.selectItem', 'entirely.retryDetail', 'entirely.openDetailInEditor', 'entirely.selectSession']) {
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

	test('declares the Details view, its welcome text and the cache setting', async () => {
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
		assert.strictEqual(view?.name, 'Details', 'the id stays and the name changes');
		const welcome = manifest.contributes.viewsWelcome.find(candidate => candidate.view === 'entirely.sessionDetail');
		assert.strictEqual(welcome?.contents, 'Select a session, a trail change or an Activity entry to see it here.');
		const setting = manifest.contributes.configuration.properties['entirely.selectionCacheSeconds'];
		assert.deepStrictEqual([setting.default, setting.minimum, setting.maximum], [30, 0, 600]);
	});
});

suite('Entire Details viewer: clicking a row', function () {
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
		const trails = new TrailsProvider(createTrailListingSource(setup.trails), () => 0);
		const activity = new ActivityProvider({ read: async () => foundActivity(COMMITS_OUTPUT, 'commits') }, () => 'alice');
		const provider = new SessionDetailProvider();
		const viewer = new DetailViewer(provider, { reveal: async () => undefined });
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
					viewer,
					selected,
					sessions,
					trails,
					activity,
					documents: new GeneratedDocuments(),
					views: { sessions: view.sessions.view, explorerSessions: view.explorer.view, trails: view.trails.view, activity: view.activity.view },
				},
			);

			const sessionNode = sessions.getChildren().flatMap(group => sessions.getChildren(group))[0];
			const [trailNode] = trails.getChildren();
			const [changeNode] = trails.getChildren(trailNode);
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
		for (const expected of ['entirely.selectItem', 'entirely.openTranscript', 'entirely.explainCheckpoint', 'entirely.refresh', 'entirely.setUp']) {
			assert.ok(referenced.has(expected), `${expected} is no longer referenced, so this test no longer covers it`);
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

			const provider = new SessionDetailProvider();
			provider.render(states[states.length - 1]);
			const [row] = provider.getChildren();
			assert.ok(row && row.kind === 'status');
			assert.match(row.label, /Could not show that row/);
			assert.ok(!row.label.includes('/78'), 'the value that arrived is not echoed');
			assert.strictEqual(provider.getTreeItem(row).contextValue, 'entirely.detail.notice');
			assert.strictEqual(describeViewer(states[states.length - 1]), 'Nothing to show');
			provider.dispose();

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
	const trails = make<ReturnType<TrailsProvider['getChildren']>[number]>();
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
