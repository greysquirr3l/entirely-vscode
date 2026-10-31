import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import {
	confirmIndexUpdate,
	confirmPluginRemove,
	confirmPluginUpgrade,
	confirmPluginUpgradeAll,
	describePluginCheck,
	describeUnmanagedPlugin,
	diffVersions,
	neutraliseLinks,
	parseInstalledPlugins,
	parseManagedDirectory,
	parseSearchResults,
	pickRemoveFlags,
	pickUpgradeFlags,
	pluginDoctorArguments,
	pluginIndexUpdateArguments,
	pluginInfoArguments,
	pluginPathOf,
	pluginRemoveArguments,
	pluginSearchArguments,
	pluginUpgradeArguments,
	versionOf,
	type ControlConfirmation,
} from '../lib/entire';
import {
	checkPlugins,
	removePlugin,
	searchPluginIndex,
	showPluginInfo,
	updatePluginIndex,
	upgradeAllPlugins,
	upgradePlugin,
	withSafeNotifications,
	type FollowUp,
	type PluginManagementDependencies,
	type PluginManagementUi,
	type SearchItem,
} from '../commands/pluginManagement';
import { installPluginCommand, type PluginChoice, type PluginUi } from '../commands/plugins';
import { IntegrationDetector } from '../services/integrationDetection';
import type { McpServerSource } from '../services/mcpServer';
import { buildIntegrationNodes, PLUGIN_BUILT_IN, PLUGIN_MANAGED, PLUGIN_MISSING, PLUGIN_ON_PATH } from '../providers/integrationsProvider';
import { renderDoctorReport, type DoctorFacts } from '../services/doctorReport';
import { PluginManagementService, readPluginCheck } from '../services/pluginManagement';
import { PluginService } from '../services/plugins';
import { ALICE } from './support/activityCli';
import { fakePluginManagementCli, type FakePluginManagementCli, type FakePluginManagementOptions } from './support/pluginManagementCli';

// The outputs of search, info, index update, upgrade, remove and a failing
// check are INVENTED in the fake CLI (see support/pluginManagementCli.ts).
const SEARCH = 'NAME         DESCRIPTION\ngraph        Explore the knowledge graph\nbrain        Notes across sessions\nstatus       Collides with a CLI command\n';

suite('Plugin management: arguments and flags', () => {
	test('builders put -- before an operand and the force flag only when given', () => {
		assert.deepStrictEqual(pluginInfoArguments('graph'), ['plugin', 'info', '--', 'graph']);
		assert.deepStrictEqual(pluginSearchArguments(' ai '), ['plugin', 'search', '--', 'ai']);
		assert.deepStrictEqual(pluginSearchArguments(''), ['plugin', 'search']);
		assert.deepStrictEqual(pluginSearchArguments(undefined), ['plugin', 'search']);
		assert.deepStrictEqual(pluginIndexUpdateArguments(), ['plugin', 'index', 'update']);
		assert.deepStrictEqual(pluginDoctorArguments(), ['plugin', 'doctor']);
		assert.deepStrictEqual(pluginRemoveArguments('graph'), ['plugin', 'remove', '--', 'graph']);
		assert.deepStrictEqual(pluginRemoveArguments('graph', '--zap'), ['plugin', 'remove', '--zap', '--', 'graph']);
		assert.deepStrictEqual(pluginUpgradeArguments({ kind: 'one', name: 'graph' }), ['plugin', 'upgrade', '--', 'graph']);
		assert.deepStrictEqual(pluginUpgradeArguments({ kind: 'all', flag: '--everything' }), ['plugin', 'upgrade', '--everything']);
	});

	test('a name starting with a dash cannot become a flag', () => {
		assert.deepStrictEqual(pluginRemoveArguments('-x'), ['plugin', 'remove', '--', '-x']);
	});

	test('picks the all and force flags by what the help says, whatever they are called', () => {
		const upgrade = pickUpgradeFlags('Flags:\n      --everything   Upgrade every remote-installed plugin\n');
		assert.ok(upgrade.ok && upgrade.flags.all === '--everything');
		const remove = pickRemoveFlags('Flags:\n      --zap   Remove even when other plugins depend on it\n');
		assert.ok(remove.ok && remove.flags.force === '--zap');
	});

	test('a help without the all flag fails with an update-the-CLI message; a help without force is allowed', () => {
		const upgrade = pickUpgradeFlags('Flags:\n      --pin   Keep the version\n');
		assert.ok(!upgrade.ok && /update the CLI/.test(upgrade.detail));
		const remove = pickRemoveFlags('No flags here\n');
		assert.ok(remove.ok && remove.flags.force === undefined);
	});
});

suite('Plugin management: reading CLI text', () => {
	test('the real plugin list is read without its first line as a plugin', () => {
		const real =
			'Managed plugin directory: /home/x/.local/share/entire/plugins/bin\n\n  brain                v0.4.0             → /home/x/pkg/brain/entire-brain\n  graph                v0.6.0             → /home/x/pkg/graph/entire-graph\n';
		const rows = parseInstalledPlugins(real);
		assert.deepStrictEqual(rows.map(row => row.name), ['brain', 'graph']);
		assert.strictEqual(versionOf(rows[0].detail), 'v0.4.0');
		assert.strictEqual(pluginPathOf(rows[0].detail), '/home/x/pkg/brain/entire-brain');
		assert.strictEqual(parseManagedDirectory(real), '/home/x/.local/share/entire/plugins/bin');
	});

	test('reads the managed directory of the empty form too, and nothing from other text', () => {
		assert.strictEqual(parseManagedDirectory("No plugins installed in /x/bin.\nInstall one with 'entire plugin install <name>'.\n"), '/x/bin');
		assert.strictEqual(parseManagedDirectory('something else'), undefined);
	});

	test('search rows: names with descriptions, no header, blank, no-match line or bad name', () => {
		const rows = parseSearchResults(`${SEARCH}\nNo plugins match.\n../evil  x\nFound 3 plugins\n`);
		assert.deepStrictEqual(rows, [
			{ name: 'graph', description: 'Explore the knowledge graph' },
			{ name: 'brain', description: 'Notes across sessions' },
			{ name: 'status', description: 'Collides with a CLI command' },
		]);
		assert.deepStrictEqual(parseSearchResults('NAME\ngraph\n'), [{ name: 'graph', description: '' }]);
		assert.deepStrictEqual(parseSearchResults('No plugins found\n'), []);
	});

	test('diffVersions: changed, unchanged, added, removed and a row with no version', () => {
		const changes = diffVersions(
			[
				{ name: 'a', detail: 'v1.0.0 → /a' },
				{ name: 'b', detail: 'v2.0.0' },
				{ name: 'c', detail: 'v3.0.0' },
				{ name: 'd', detail: 'local' },
			],
			[
				{ name: 'a', detail: 'v1.1.0 → /a' },
				{ name: 'b', detail: 'v2.0.0' },
				{ name: 'd', detail: 'local' },
				{ name: 'e', detail: 'v0.1.0' },
			],
		);
		assert.deepStrictEqual(
			changes.map(change => `${change.name}:${change.kind}`),
			['a:changed', 'b:unchanged', 'c:removed', 'd:unknown', 'e:added'],
		);
		assert.deepStrictEqual([changes[0].from, changes[0].to], ['v1.0.0', 'v1.1.0']);
	});
});

suite('Plugin management: confirmations', () => {
	test('upgrade names the plugin, its version, the download, the checksum, the directory and the login', () => {
		const prompt = confirmPluginUpgrade('graph', 'v0.4.0', '/x/bin', ALICE);
		const text = `${prompt.message}\n${prompt.detail}`;
		for (const word of ['graph', 'v0.4.0', 'downloads', 'checksums.txt', '/x/bin', 'alice', 'no dry run']) {
			assert.ok(text.includes(word), word);
		}
	});

	test('upgrade all lists every plugin and says pinned and linked ones are skipped', () => {
		const prompt = confirmPluginUpgradeAll([{ name: 'a', detail: 'v1.0.0' }, { name: 'b', detail: 'v2.0.0' }], '/x/bin', ALICE);
		assert.match(prompt.detail, /a v1\.0\.0\n {2}b v2\.0\.0/);
		assert.match(prompt.detail, /pin/);
		assert.match(prompt.detail, /linked/);
	});

	test('remove names the plugin, the directory, the file and the login; the index refresh says nothing is installed', () => {
		const prompt = confirmPluginRemove('graph', '/x/bin', '/x/pkg/entire-graph', ALICE);
		assert.match(prompt.detail, /\/x\/bin/);
		assert.match(prompt.detail, /\/x\/pkg\/entire-graph/);
		assert.match(prompt.detail, /alice/);
		assert.strictEqual(prompt.action, 'Remove Plugin');
		assert.match(confirmIndexUpdate(ALICE).detail, /alice.*No plugin is installed or changed/s);
	});

	test('the unmanaged text says the CLI cannot remove it and the binary is deleted by hand', () => {
		const text = describeUnmanagedPlugin('x', '/x/bin');
		assert.match(text, /outside the managed directory \/x\/bin/);
		assert.match(text, /delete this binary by hand/);
	});

	test('the doctor report line carries the verdict and not the CLI text', () => {
		assert.deepStrictEqual(describePluginCheck({ kind: 'healthy' }), ['- Result: healthy']);
		assert.match(describePluginCheck({ kind: 'problems' })[0], /Check Plugins/);
		assert.deepStrictEqual(describePluginCheck(undefined), ['- (not run)']);
	});
});

class Ui implements PluginManagementUi {
	prompts: ControlConfirmation[] = [];
	notices: { level: string; message: string; followUp?: FollowUp }[] = [];
	documents: { title: string; text: string }[] = [];
	items: SearchItem[] = [];
	choices: PluginChoice[] = [];
	answers: boolean[] = [];
	constructor(
		private readonly script: { pick?: string; term?: string; result?: string; action?: 'info' | 'install'; confirm?: boolean } = {},
	) {}
	confirm(prompt: ControlConfirmation): Promise<boolean> {
		this.prompts.push(prompt);
		return Promise.resolve(this.answers.length > 0 ? (this.answers.shift() ?? false) : (this.script.confirm ?? true));
	}
	pickPlugin(choices: readonly PluginChoice[]): Promise<string | undefined> {
		this.choices = [...choices];
		return Promise.resolve(this.script.pick);
	}
	askTerm(): Promise<string | undefined> {
		return Promise.resolve(this.script.term);
	}
	pickResult(items: readonly SearchItem[]): Promise<string | undefined> {
		this.items = [...items];
		return Promise.resolve(this.script.result);
	}
	pickResultAction(): Promise<'info' | 'install' | undefined> {
		return Promise.resolve(this.script.action);
	}
	withProgress<T>(_title: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
		return work(new AbortController().signal);
	}
	notify(level: 'info' | 'warn', message: string, followUp?: FollowUp): Promise<void> {
		this.notices.push({ level, message, followUp });
		return Promise.resolve();
	}
	showDocument(title: string, text: string): Promise<void> {
		this.documents.push({ title, text });
		return Promise.resolve();
	}
	get last(): string {
		return this.notices[this.notices.length - 1]?.message ?? '';
	}
}

interface Harness {
	cli: FakePluginManagementCli;
	ui: Ui;
	deps: PluginManagementDependencies;
	refreshes: () => number;
	installPrompts: ControlConfirmation[];
}

function harness(options: FakePluginManagementOptions = {}, script: ConstructorParameters<typeof Ui>[0] = {}, acting = true): Harness {
	const cli = fakePluginManagementCli(options);
	const raw = new Ui(script);
	const ui = raw;
	const timeoutSeconds = () => 20;
	const plugins = new PluginService({ runner: cli.runner, workspaceRoot: () => cli.dir, timeoutSeconds });
	const source = new PluginManagementService({ runner: cli.runner, plugins, workspaceRoot: () => cli.dir, timeoutSeconds });
	let refreshed = 0;
	const running = { active: false };
	const installPrompts: ControlConfirmation[] = [];
	const installUi: PluginUi = {
		pickPlugin: () => Promise.resolve(undefined),
		pickSubcommand: () => Promise.resolve(''),
		askArguments: () => Promise.resolve(''),
		confirm: prompt => {
			installPrompts.push(prompt);
			return Promise.resolve(script.confirm ?? true);
		},
		withProgress: (_title, work) => work(new AbortController().signal),
		warn: () => Promise.resolve(),
		offerInstall: () => Promise.resolve(false),
		showOutput: () => Promise.resolve(),
		inform: () => Promise.resolve(),
	};
	const acts = () => Promise.resolve(acting ? ALICE : undefined);
	const deps: PluginManagementDependencies = {
		source,
		acting: acts,
		ui: withSafeNotifications(raw),
		suggested: () => ['graph', 'investigate'],
		install: name => installPluginCommand({ source: plugins, acting: acts, ui: installUi, suggested: () => [], running }, name),
		refresh: () => {
			refreshed += 1;
			return Promise.resolve();
		},
		running,
	};
	return { cli, ui, deps, refreshes: () => refreshed, installPrompts };
}

suite('Plugin management: remove', () => {
	test('remove-confirmed: runs once as the confirmed login and succeeds only when the fresh list lacks it', async () => {
		const h = harness();
		assert.strictEqual(await removePlugin(h.deps, 'graph'), 'done');
		assert.match(h.ui.prompts[0].detail, new RegExp(h.cli.managedDir.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
		assert.match(h.ui.prompts[0].detail, /alice/);
		assert.deepStrictEqual(
			h.cli.mutations().map(call => [call.context, call.line]),
			[[ALICE.name, 'plugin remove -- graph']],
		);
		assert.deepStrictEqual(h.cli.state().plugins.map(plugin => plugin.name), ['brain']);
		assert.match(h.ui.last, /graph was removed.*fresh plugin list/);
		assert.strictEqual(h.refreshes(), 1);
	});

	test('exit 0 with the plugin still listed is a failure, not a success', async () => {
		const h = harness({ removeMode: 'noop' });
		assert.strictEqual(await removePlugin(h.deps, 'graph'), 'failed');
		assert.match(h.ui.last, /said it removed graph, but graph is still listed/);
		assert.strictEqual(h.cli.mutations().length, 1);
	});

	test('a list that cannot be read afterwards is unconfirmed, never done', async () => {
		const h = harness({ listFailsAfterMutation: true });
		assert.strictEqual(await removePlugin(h.deps, 'graph'), 'unconfirmed');
		assert.match(h.ui.last, /could not be confirmed/);
	});

	test('remove-declined: nothing runs and the plugin is unchanged', async () => {
		const h = harness({}, { confirm: false });
		assert.strictEqual(await removePlugin(h.deps, 'graph'), 'cancelled');
		assert.deepStrictEqual(h.cli.mutations(), []);
		assert.strictEqual(h.cli.state().plugins.length, 2);
	});

	test('a refusal because of dependents shows its text and offers a second, separate question', async () => {
		const h = harness({ removeMode: 'dependents', forceFlag: '--zap' });
		h.ui.answers = [true, true];
		assert.strictEqual(await removePlugin(h.deps, 'graph'), 'done');
		assert.strictEqual(h.ui.prompts.length, 2);
		assert.match(h.ui.prompts[1].message, /even though other plugins depend on it/);
		assert.match(h.ui.prompts[1].detail, /brain depends on it/);
		assert.deepStrictEqual(
			h.cli.mutations().map(call => call.line),
			['plugin remove -- graph', 'plugin remove --zap -- graph'],
		);
	});

	test('declining the second question runs nothing more and keeps the refusal text', async () => {
		const h = harness({ removeMode: 'dependents' });
		h.ui.answers = [true, false];
		assert.strictEqual(await removePlugin(h.deps, 'graph'), 'cancelled');
		assert.strictEqual(h.cli.mutations().length, 1);
		assert.match(h.ui.last, /graph was not removed: .*depends on it/);
		assert.strictEqual(h.cli.state().plugins.length, 2);
	});

	test('no force flag in the help: the refusal is shown and no second question is asked', async () => {
		const h = harness({ removeMode: 'dependents', helps: { plugin_remove: 'entire plugin remove — Remove\n\nFlags:\n      --other   Something else\n' } });
		assert.strictEqual(await removePlugin(h.deps, 'graph'), 'refused');
		assert.strictEqual(h.ui.prompts.length, 1);
		assert.strictEqual(h.cli.mutations().length, 1);
	});

	test('an ordinary refusal is a failure with the CLI reason, and is not retried', async () => {
		const h = harness({ removeMode: 'fail', removeFail: 'Error: permission denied' });
		assert.strictEqual(await removePlugin(h.deps, 'graph'), 'failed');
		assert.match(h.ui.last, /graph was not removed: .*permission denied.*still in the plugin list/);
		assert.strictEqual(h.cli.mutations().length, 1);
	});

	test('remove-unmanaged: a plugin only on the PATH is explained and nothing runs', async () => {
		const h = harness({ onPath: ['pathy'] });
		assert.strictEqual(await removePlugin(h.deps, 'pathy'), 'refused');
		assert.match(h.ui.last, /outside the managed directory.*delete this binary by hand/);
		assert.deepStrictEqual(h.cli.mutations(), []);
		assert.strictEqual(h.ui.prompts.length, 0);
	});

	test('a name that is also a CLI command is refused and nothing runs', async () => {
		const h = harness({ plugins: [{ name: 'status', version: 'v1.0.0' }] });
		assert.strictEqual(await removePlugin(h.deps, 'status'), 'refused');
		assert.match(h.ui.last, /command of the Entire CLI itself/);
		assert.deepStrictEqual(h.cli.mutations(), []);
	});

	test('a plugin that is not installed anywhere is said so', async () => {
		const h = harness();
		assert.strictEqual(await removePlugin(h.deps, 'nothing'), 'refused');
		assert.match(h.ui.last, /not installed in the managed plugin directory/);
	});

	test('a copy on the PATH after a removal is reported', async () => {
		const h = harness({ onPath: ['graph'] });
		assert.strictEqual(await removePlugin(h.deps, 'graph'), 'done');
		assert.match(h.ui.last, /Another copy of graph is on the PATH/);
	});

	test('no login: nothing runs', async () => {
		const h = harness({}, {}, false);
		assert.strictEqual(await removePlugin(h.deps, 'graph'), 'no-login');
		assert.deepStrictEqual(h.cli.mutations(), []);
	});
});

suite('Plugin management: upgrade', () => {
	test('upgrade-names-download: confirms with the download wording, then reports old and new from a fresh list', async () => {
		const h = harness({ upgrades: { graph: 'v0.7.0' } });
		assert.strictEqual(await upgradePlugin(h.deps, 'graph'), 'done');
		const text = h.ui.prompts[0].message + h.ui.prompts[0].detail;
		for (const word of ['graph', 'v0.6.0', 'downloads', 'checksums.txt', h.cli.managedDir, 'alice']) {
			assert.ok(text.includes(word), word);
		}
		assert.deepStrictEqual(h.cli.mutations().map(call => [call.context, call.line]), [[ALICE.name, 'plugin upgrade -- graph']]);
		assert.match(h.ui.last, /graph upgraded from v0\.6\.0 to v0\.7\.0/);
	});

	test('an unchanged version says still at, with the CLI text, and is not done', async () => {
		const h = harness({ upgradeOut: 'graph is up to date' });
		assert.strictEqual(await upgradePlugin(h.deps, 'graph'), 'unchanged');
		assert.match(h.ui.last, /graph is still at v0\.6\.0.*pinned.*It said: "graph is up to date"/);
	});

	test('a non-zero exit is a failure with the CLI reason and the list state', async () => {
		const h = harness({ upgradeFail: 'Error: checksum mismatch' });
		assert.strictEqual(await upgradePlugin(h.deps, 'graph'), 'failed');
		assert.match(h.ui.last, /checksum mismatch.*graph is still at v0\.6\.0/);
	});

	test('an unreadable fresh list is unconfirmed, not done', async () => {
		const h = harness({ upgrades: { graph: 'v0.7.0' }, listFailsAfterMutation: true });
		assert.strictEqual(await upgradePlugin(h.deps, 'graph'), 'unconfirmed');
	});

	test('a failed before-read runs nothing', async () => {
		const h = harness({ listFails: 'Error: no access' });
		assert.strictEqual(await upgradePlugin(h.deps, 'graph'), 'unavailable');
		assert.deepStrictEqual(h.cli.mutations(), []);
	});

	test('declined: no invocation', async () => {
		const h = harness({ upgrades: { graph: 'v0.7.0' } }, { confirm: false });
		assert.strictEqual(await upgradePlugin(h.deps, 'graph'), 'cancelled');
		assert.deepStrictEqual(h.cli.mutations(), []);
	});

	test('an on-PATH plugin gets no upgrade, only the explanation', async () => {
		const h = harness({ onPath: ['pathy'] });
		assert.strictEqual(await upgradePlugin(h.deps, 'pathy'), 'refused');
		assert.match(h.ui.last, /outside the managed directory/);
		assert.deepStrictEqual(h.cli.mutations(), []);
	});

	test('upgrade-all: one question lists all plugins, one invocation with the picked flag, a mixed read-back', async () => {
		const h = harness({ allFlag: '--everything', upgrades: { brain: 'v0.5.0' } });
		assert.strictEqual(await upgradeAllPlugins(h.deps), 'done');
		assert.strictEqual(h.ui.prompts.length, 1);
		assert.match(h.ui.prompts[0].detail, /brain v0\.4\.0\n {2}graph v0\.6\.0/);
		assert.deepStrictEqual(h.cli.mutations().map(call => call.line), ['plugin upgrade --everything']);
		assert.match(h.ui.last, /brain went from v0\.4\.0 to v0\.5\.0\ngraph is still at v0\.6\.0/);
	});

	test('upgrade-all with nothing installed runs nothing', async () => {
		const h = harness({ plugins: [] });
		assert.strictEqual(await upgradeAllPlugins(h.deps), 'unchanged');
		assert.deepStrictEqual(h.cli.mutations(), []);
		assert.strictEqual(h.ui.prompts.length, 0);
	});

	test('a help without the all flag runs nothing and says update the CLI', async () => {
		const h = harness({ helps: { plugin_upgrade: 'entire plugin upgrade — Upgrade\n\nFlags:\n      --pin   Keep\n' } });
		assert.strictEqual(await upgradeAllPlugins(h.deps), 'failed');
		assert.match(h.ui.last, /update the CLI/);
		assert.deepStrictEqual(h.cli.mutations(), []);
	});

	test('a long read-back goes to a document behind Open Details', async () => {
		const plugins = ['a', 'b', 'c', 'd'].map(name => ({ name, version: 'v1.0.0' }));
		const h = harness({ plugins, upgrades: { a: 'v1.1.0' } });
		assert.strictEqual(await upgradeAllPlugins(h.deps), 'done');
		const notice = h.ui.notices[h.ui.notices.length - 1];
		assert.strictEqual(notice.followUp?.label, 'Open Details');
		await notice.followUp?.run();
		assert.match(h.ui.documents[0].text, /d is still at v1\.0\.0/);
	});
});

suite('Plugin management: index, search, info and check', () => {
	test('index-update-failure: the warning carries the CLI reason and no success is reported', async () => {
		const h = harness({ indexFail: 'Error: could not reach the index host' });
		assert.strictEqual(await updatePluginIndex(h.deps), 'failed');
		assert.match(h.ui.last, /The index was not refreshed: .*could not reach the index host/);
		assert.ok(h.ui.notices.every(notice => !/was refreshed/.test(notice.message)));
	});

	test('a refresh confirms as the login, says no plugin changes, and says nothing can be read back', async () => {
		const h = harness({ indexOut: 'index updated (invented)' });
		assert.strictEqual(await updatePluginIndex(h.deps), 'done');
		assert.match(h.ui.prompts[0].detail, /alice.*No plugin is installed or changed/s);
		assert.deepStrictEqual(h.cli.mutations().map(call => [call.context, call.line]), [[ALICE.name, 'plugin index update']]);
		assert.match(h.ui.last, /was refreshed.*nothing to read back/);
		await h.ui.notices[0].followUp?.run();
		assert.strictEqual(h.ui.documents[0].text, 'index updated (invented)');
	});

	test('a declined refresh runs nothing', async () => {
		const h = harness({}, { confirm: false });
		assert.strictEqual(await updatePluginIndex(h.deps), 'cancelled');
		assert.deepStrictEqual(h.cli.mutations(), []);
	});

	test('search-and-install: lists name, description and the installed marker, then installs through the existing question', async () => {
		const h = harness({ searchOut: SEARCH }, { term: 'graph', result: 'graph', action: 'install' });
		assert.strictEqual(await searchPluginIndex(h.deps), 'installed');
		assert.deepStrictEqual(
			h.ui.items.map(item => [item.name, item.description, item.installed, item.blocked !== undefined]),
			[
				['graph', 'Explore the knowledge graph', true, false],
				['brain', 'Notes across sessions', true, false],
				['status', 'Collides with a CLI command', false, true],
			],
		);
		assert.strictEqual(h.installPrompts.length, 1);
		assert.match(h.installPrompts[0].detail, /Entire downloads the plugin named "graph" from its plugin index/);
		const lines = h.cli.calls().map(call => call.line);
		assert.ok(lines.indexOf('plugin install --yes -- graph') > lines.indexOf('plugin search -- graph'));
		assert.strictEqual(h.refreshes(), 1);
	});

	test('declining the install question installs nothing', async () => {
		const h = harness({ searchOut: SEARCH, plugins: [] }, { term: '', result: 'graph', action: 'install', confirm: false });
		assert.strictEqual(await searchPluginIndex(h.deps), 'cancelled');
		assert.ok(!h.cli.calls().some(call => /plugin install/.test(call.line)));
	});

	test('a result named like a CLI command cannot be installed', async () => {
		const h = harness({ searchOut: SEARCH }, { term: '', result: 'status', action: 'install' });
		assert.strictEqual(await searchPluginIndex(h.deps), 'refused');
		assert.match(h.ui.last, /status cannot be installed: .*command of the Entire CLI itself/);
		assert.ok(!h.cli.calls().some(call => /plugin install/.test(call.line)));
	});

	test('the typed term is absent from the recorded invocation, and an empty term has no operand', async () => {
		const h = harness({ searchOut: SEARCH }, { term: 'secret words' });
		await searchPluginIndex(h.deps);
		const search = h.cli.recorded.find(record => record.invocation.args.includes('search'));
		assert.ok(search);
		assert.ok(!search.invocation.args.join(' ').includes('secret'));
		assert.deepStrictEqual(h.cli.calls().find(call => /plugin search/.test(call.line))?.args, ['plugin', 'search', '--', 'secret words']);
		const empty = harness({ searchOut: SEARCH }, { term: '' });
		await searchPluginIndex(empty.deps);
		assert.ok(empty.cli.calls().some(call => call.line === 'plugin search'));
	});

	test('exit 0 with unreadable text shows the CLI text and not "no results"', async () => {
		const h = harness({ searchOut: 'Found 3 plugins:' }, { term: '' });
		await searchPluginIndex(h.deps);
		assert.deepStrictEqual(h.ui.documents, [{ title: 'Plugin search', text: 'Found 3 plugins:' }]);
		assert.ok(h.ui.notices.every(notice => !/no results/i.test(notice.message)));
	});

	test('a failed search offers Update Plugin Index', async () => {
		const h = harness({ searchFail: 'Error: the index is not present' }, { term: '' });
		assert.strictEqual(await searchPluginIndex(h.deps), 'failed');
		assert.match(h.ui.last, /index is not present/);
		assert.strictEqual(h.ui.notices[0].followUp?.label, 'Update Plugin Index');
	});

	test('Info for an installed, an on-PATH and a not-installed plugin', async () => {
		const h = harness({ onPath: ['pathy'], infoOut: 'NAME is in the index (invented)' });
		assert.strictEqual(await showPluginInfo(h.deps, 'graph'), 'shown');
		assert.deepStrictEqual(h.ui.documents[0], { title: 'Plugin info: graph', text: 'graph is in the index (invented)' });
		assert.strictEqual(await showPluginInfo(h.deps, 'pathy'), 'shown');
		assert.match(h.ui.documents[1].text, /^pathy was found on the PATH, outside the managed directory/);
		assert.match(h.ui.documents[1].text, /pathy is in the index/);
		assert.strictEqual(await showPluginInfo(h.deps, 'investigate'), 'shown');
		assert.strictEqual(h.ui.documents[2].text, 'investigate is in the index (invented)');
		assert.deepStrictEqual(h.cli.mutations(), []);
		assert.strictEqual(h.ui.prompts.length, 0);
	});

	test('Info shows the CLI reason when the index has no such plugin', async () => {
		const h = harness({ infoFail: 'Error: plugin "zzz" not found in the index' });
		assert.strictEqual(await showPluginInfo(h.deps, 'zzz'), 'failed');
		assert.match(h.ui.last, /not found in the index/);
	});

	test('the picker offers installed and suggested plugins', async () => {
		const h = harness({}, {});
		assert.strictEqual(await showPluginInfo(h.deps), 'cancelled');
		assert.deepStrictEqual(h.ui.choices.map(choice => [choice.name, choice.installed]), [['brain', true], ['graph', true], ['investigate', false]]);
	});

	test('plugin-check: exit 0 is healthy', async () => {
		const h = harness();
		assert.strictEqual(await checkPlugins(h.deps), 'done');
		assert.match(h.ui.last, /Plugins: healthy/);
		assert.deepStrictEqual(await readPluginCheck(h.deps.source), { kind: 'healthy' });
	});

	test('plugin-check: a non-zero exit is a finding with the CLI text and Open Details; output stays out of the record', async () => {
		const h = harness({ doctorExit: 1, doctorOut: 'graph: missing dependency brain' });
		assert.strictEqual(await checkPlugins(h.deps), 'failed');
		assert.match(h.ui.last, /Plugin check found problems/);
		await h.ui.notices[h.ui.notices.length - 1].followUp?.run();
		assert.match(h.ui.documents[0].text, /missing dependency brain/);
		for (const record of h.cli.recorded) {
			assert.ok(!/missing dependency/.test(JSON.stringify(record.bodies)), 'no body in the record');
		}
		assert.deepStrictEqual(await readPluginCheck(h.deps.source), { kind: 'problems' });
	});

	test('the doctor report gains a plugin line and tolerates a CLI without plugin doctor', async () => {
		const facts: DoctorFacts = {
			generatedAt: new Date('2026-10-28T12:00:00.000Z'),
			extensionVersion: '0.1.0',
			editorVersion: '1.140.0',
			platform: 'darwin',
			discovery: { state: 'available', path: '/bin/entire', location: 'path', directory: '/bin', version: '0.12.2' },
			status: undefined,
			statusError: undefined,
			isRepository: true,
			workspaceRoot: '/work/repo',
			settings: [],
			logLevel: 'info',
			debug: false,
			configuredPath: undefined,
			failure: undefined,
			minimumCliVersion: '0.12.2',
			checkpointDestination: undefined,
			accountContext: undefined,
			contextMechanism: 'flag and environment',
		};
		const healthy = harness();
		assert.match(renderDoctorReport({ ...facts, pluginCheck: await readPluginCheck(healthy.deps.source) }), /### Plugins[^\n]*\n\n- Result: healthy/);
		const old = harness({ without: ['doctor'] });
		assert.match(renderDoctorReport({ ...facts, pluginCheck: await readPluginCheck(old.deps.source) }), /Result: not available/);
		assert.match(renderDoctorReport(facts), /### Plugins[^\n]*\n\n- \(not run\)/);
	});

	test('a healthy-sounding text with a failing exit is still a finding', async () => {
		const h = harness({ doctorExit: 2, doctorOut: 'All plugins healthy.' });
		assert.strictEqual(await checkPlugins(h.deps), 'failed');
	});

	test('cli-lacks-subcommand: each subcommand gives the too-old message and runs nothing', async () => {
		const flows: [string, (deps: PluginManagementDependencies) => Promise<unknown>][] = [
			['info', deps => showPluginInfo(deps, 'graph')],
			['search', deps => searchPluginIndex(deps)],
			['upgrade', deps => upgradePlugin(deps, 'graph')],
			['remove', deps => removePlugin(deps, 'graph')],
			['index update', deps => updatePluginIndex(deps)],
			['doctor', deps => checkPlugins(deps)],
		];
		for (const [sub, run] of flows) {
			const h = harness({ without: [sub] }, { term: '' });
			await run(h.deps);
			assert.match(h.ui.last, new RegExp(`no "plugin ${sub}".*update the CLI`), sub);
			assert.deepStrictEqual(h.cli.mutations(), [], sub);
			assert.strictEqual(h.ui.prompts.length, 0, sub);
		}
		const h = harness({ without: ['doctor'] });
		assert.strictEqual((await readPluginCheck(h.deps.source)).kind, 'unsupported');
	});

	test('a missing CLI gives the missing-CLI message', async () => {
		const h = harness({ noCli: true });
		assert.strictEqual(await checkPlugins(h.deps), 'unavailable');
		assert.match(h.ui.last, /not installed/);
		assert.strictEqual((await readPluginCheck(h.deps.source)).kind, 'no-cli');
	});

	test('busy guard: a second action while one runs is refused', async () => {
		const h = harness();
		let release: (value: boolean) => void = () => undefined;
		let reached: () => void = () => undefined;
		const asked = new Promise<void>(resolve => (reached = resolve));
		h.ui.confirm = () =>
			new Promise<boolean>(resolve => {
				release = resolve;
				reached();
			});
		const first = removePlugin(h.deps, 'graph');
		await asked;
		assert.strictEqual(await upgradePlugin(h.deps, 'brain'), 'busy');
		assert.match(h.ui.last, /already running/);
		release(false);
		assert.strictEqual(await first, 'cancelled');
	});

	test('CLI text in a notification cannot carry link syntax', async () => {
		const h = harness({ removeMode: 'fail', removeFail: 'Error: [click](command:workbench.action.reloadWindow)' });
		await removePlugin(h.deps, 'graph');
		assert.ok(!/[[\]]/.test(h.ui.last));
	});
});

suite('Plugin management: rows, manifest and wiring', () => {
	const folder = {
		name: 'w',
		path: '/w',
		managedDirectory: '/m/bin',
		mcp: { editor: { kind: 'offered' as const }, config: { kind: 'configured' as const, file: '.mcp.json' as const } },
	};
	const nodes = buildIntegrationNodes({
		kind: 'folders',
		folders: [
			{
				...folder,
				plugins: [
					{ name: 'graph', suggested: true, state: { kind: 'installed', detail: 'v0.6.0' } },
					{ name: 'pathy', suggested: false, state: { kind: 'on-path' } },
					{ name: 'brain', suggested: true, state: { kind: 'missing' } },
				],
			},
		],
	});
	const rowOf = (label: string) => nodes.find(node => node.kind === 'row' && node.label === label);

	test('managed, on-PATH and missing rows have their own context values', () => {
		const contextOf = (label: string) => {
			const row = rowOf(label);
			return row?.kind === 'row' ? row.contextValue : undefined;
		};
		assert.strictEqual(contextOf('graph'), PLUGIN_MANAGED);
		assert.strictEqual(contextOf('pathy'), PLUGIN_ON_PATH);
		assert.strictEqual(contextOf('brain'), PLUGIN_MISSING);
	});

	test('remove-unmanaged: the on-PATH tooltip says why, and the manifest gives it Info only', () => {
		const row = rowOf('pathy');
		assert.ok(row && row.kind === 'row');
		assert.match(row.tooltip, /outside the managed directory \/m\/bin.*delete this binary by hand/);
		const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')) as {
			contributes: { commands: { command: string; title: string }[]; menus: Record<string, { command: string; when?: string }[]> };
		};
		const onPath = manifest.contributes.menus['view/item/context'].filter(item => item.when?.includes(`viewItem == ${PLUGIN_ON_PATH}`));
		assert.deepStrictEqual(onPath.map(item => item.command), ['entirely.pluginInfo']);
		const managed = manifest.contributes.menus['view/item/context'].filter(item => item.when?.includes(`viewItem == ${PLUGIN_MANAGED}`));
		assert.deepStrictEqual(managed.map(item => item.command).sort(), ['entirely.pluginInfo', 'entirely.removePlugin', 'entirely.upgradePlugin']);
		const missing = manifest.contributes.menus['view/item/context'].filter(item => item.when?.includes(`viewItem == ${PLUGIN_MISSING}`));
		assert.ok(missing.some(item => item.command === 'entirely.pluginInfo'));
		assert.ok(!missing.some(item => /upgrade|remove/i.test(item.command)));
	});

	test('all seven commands are contributed and registered, and no browse command exists', async function () {
		this.timeout(15000);
		await vscode.extensions.getExtension('greysquirr3l.entirely')?.activate();
		const ids = ['pluginInfo', 'searchPluginIndex', 'updatePluginIndex', 'upgradePlugin', 'upgradeAllPlugins', 'removePlugin', 'checkPlugins'].map(id => `entirely.${id}`);
		const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')) as { contributes: { commands: { command: string }[] } };
		const registered = await vscode.commands.getCommands(true);
		for (const id of ids) {
			assert.ok(manifest.contributes.commands.some(command => command.command === id), `${id} contributed`);
			assert.ok(registered.includes(id), `${id} registered`);
		}
		assert.ok(!manifest.contributes.commands.some(command => /browse/i.test(command.command)));
	});

	test('the new files create no timer and write no flag literal', () => {
		const files = [
			'commands/pluginManagement.ts',
			'commands/pluginManagementCommands.ts',
			'services/pluginManagement.ts',
			'providers/pluginManagementUi.ts',
		].map(file => fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', file), 'utf8'));
		for (const source of files) {
			assert.ok(!/setTimeout|setInterval/.test(source));
			assert.ok(!/['"]--(all|force)['"]/.test(source));
		}
		const lib = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'lib', 'entire', 'pluginManagement.ts'), 'utf8');
		assert.ok(!/['"]--(all|force)['"]/.test(lib));
	});
});

suite('Plugin management: text from the CLI cannot make a live link', () => {
	const LINK = '[x](command:workbench.action.reloadWindow)';
	const live = (text: string): boolean => /\]\(|[[\]<>`]/.test(text);
	const assertSafe = (h: Harness): void => {
		assert.ok(h.ui.notices.length > 0);
		for (const notice of h.ui.notices) {
			assert.ok(!live(notice.message), notice.message);
			assert.ok(!/command:/i.test(notice.message), notice.message);
		}
	};

	test('neutraliseLinks drops brackets, autolinks, backticks and a live command scheme', () => {
		const text = neutraliseLinks(`${LINK} <command:a> \`b\` command:c COMMAND:d [y](https://e)`);
		assert.ok(!/[[\]<>`]/.test(text) && !/command:/i.test(text) && !/https:/i.test(text), text);
	});

	test('a version that carries a link is cut at the first character a version cannot hold', () => {
		assert.strictEqual(versionOf(`1.0${LINK}`), '1.0');
		assert.strictEqual(versionOf(`v2.3.4-rc.1+build5 → /p`), 'v2.3.4-rc.1+build5');
		assert.ok((versionOf(`1.0${'a'.repeat(200)}`) ?? '').length <= 45);
	});

	test('a version with a link in the list reaches the notification without one', async () => {
		const h = harness({ plugins: [{ name: 'graph', version: `v1.0.0${LINK}` }], upgrades: { graph: `v1.1.0${LINK}` } });
		await upgradePlugin(h.deps, 'graph');
		await upgradeAllPlugins(h.deps);
		assertSafe(h);
	});

	test('a directory with a link in it, from the list, is neutral in the on-PATH explanation', async () => {
		const h = harness({ onPath: ['pathy'], managedDirText: `/m/${LINK}` });
		await removePlugin(h.deps, 'pathy');
		assertSafe(h);
	});

	test('a failure detail with a link (listing and help failures) is neutral', async () => {
		const listing = harness({ listFails: `Error: ${LINK}` });
		await upgradePlugin(listing.deps, 'graph');
		await upgradeAllPlugins(listing.deps);
		assertSafe(listing);
		assert.ok(listing.ui.notices.every(notice => !/has no 'plugin' command/.test(notice.message)), 'a failed list is not a missing subcommand');
		assert.match(listing.ui.notices[0].message, /plugin list failed/);
	});

	test('a link in a preset name is neutral in every refusal', async () => {
		const name = `a${LINK}`;
		const h = harness();
		await showPluginInfo(h.deps, name);
		await upgradePlugin(h.deps, name);
		await removePlugin(h.deps, name);
		assertSafe(h);
		assert.deepStrictEqual(h.cli.mutations(), []);
	});

	test('a search hit description with a link is neutral in the picker items the UI is given', async () => {
		const h = harness({ searchOut: `graph  Nice ${LINK}\n` }, { term: '' });
		await searchPluginIndex(h.deps);
		assert.strictEqual(h.ui.items[0].description, `Nice ${LINK}`, 'the flow keeps the data; the editor adapter neutralises it when drawing');
	});

	test('a CLI text follow-up label cannot be a link either', async () => {
		const h = harness({ indexOut: LINK });
		await updatePluginIndex(h.deps);
		assert.ok(!/[[\]<>`]/.test(h.ui.notices[0].followUp?.label ?? ''));
	});
});

suite('Plugin management: rows for plugins named like CLI commands', () => {
	test('a listed plugin whose name is a CLI command gets no actions and no target', () => {
		const nodes = buildIntegrationNodes({
			kind: 'folders',
			folders: [
				{
					name: 'w',
					path: '/w',
					mcp: { editor: { kind: 'offered' }, config: { kind: 'configured', file: '.mcp.json' } },
					plugins: [{ name: 'status', suggested: false, state: { kind: 'installed', detail: 'v1.0.0' }, builtIn: true }],
				},
			],
		});
		const row = nodes[0];
		assert.ok(row.kind === 'row');
		assert.strictEqual(row.contextValue, PLUGIN_BUILT_IN);
		assert.strictEqual(row.target, undefined);
		assert.match(row.tooltip, /also an Entire CLI command/);
		const manifest = fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8');
		assert.ok(!manifest.includes(PLUGIN_BUILT_IN), 'no menu entry matches the built-in value');
	});

	test('detection marks a listed plugin that shares a CLI command name', async () => {
		const cli = fakePluginManagementCli({ plugins: [{ name: 'status', version: 'v1.0.0' }, { name: 'graph', version: 'v0.6.0' }] });
		const plugins = new PluginService({ runner: cli.runner, workspaceRoot: () => cli.dir, timeoutSeconds: () => 20 });
		const detector = new IntegrationDetector({
			cli: () => Promise.resolve({ kind: 'ready' }),
			folders: () => [{ name: 'w', path: cli.dir }],
			suggested: () => [],
			plugins: () => plugins,
			mcp: () => ({ probe: () => Promise.resolve({ ok: false, reason: 'absent', detail: 'x' }) }) as unknown as McpServerSource,
			mcpEnabled: () => true,
			config: () => Promise.resolve({ kind: 'configured', file: '.mcp.json' }),
		});
		const reading = await detector.detect();
		assert.ok(reading.kind === 'folders');
		assert.deepStrictEqual(reading.folders[0].plugins.map(row => [row.name, row.builtIn === true]), [['status', true], ['graph', false]]);
	});
});
