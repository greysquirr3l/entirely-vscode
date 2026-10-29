import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
	agentAddArguments,
	agentRemoveArguments,
	classifyAgent,
	describeBridging,
	findHookVerbs,
	isAgentName,
	parseAgentList,
	planAgentAddFlags,
	readWrittenFiles,
	type HookBridging,
} from '../lib/entire';
import {
	describeOutcome,
	installConfirmation,
	manageAgents,
	removeConfirmation,
	type AgentAction,
	type AgentConfirmation,
	type AgentDependencies,
	type AgentUi,
} from '../commands/agentIntegrations';
import { AgentIntegrationService, type AgentListing } from '../services/agentIntegrations';
import { CliLocator } from '../services/cli/locator';
import { CliRunner } from '../services/cli/runner';
import type { CliRunner as CliRunnerType } from '../services/cli';
import { HookBridge } from '../services/hookBridge';
import { SCAN_LIMITS, hooksOf, scanHookConfig } from '../services/hookConfigScan';
import { enableArguments } from '../services/setup';
import { makeTempDir } from './support/tempDir';

const REAL_LIST = `Agents:
    antigravity
  ✓ claude-code
  ✓ codex
    copilot-cli

Use 'entire agent add <name>' to install hooks.
`;

const ADD_HELP = `entire agent add — Install hooks for an agent

Flags:
      --agent-help-skill entire agent-help   Install the stable Entire agent-help skill
      --force                                Reinstall hooks even if already present
      --search-skill                         Install the optional Entire search skill
`;

const RENAMED_ADD_HELP = `entire agent add — Install hooks for an agent

Flags:
      --again   Reinstall hooks even if already present
`;

const NO_REINSTALL_HELP = `entire agent add — Install hooks for an agent

Flags:
      --search-skill   Install the optional Entire search skill
`;

const FULL_VERBS = 'session-start session-end user-prompt-submitted agent-stop pre-tool-use post-tool-use';

interface FakeOptions {
	/** The agents the CLI says it supports. Invented names prove nothing is hardcoded. */
	agents?: readonly string[];
	installed?: readonly string[];
	/** Verbs written into an agent's hook file when it is installed. */
	verbs?: Record<string, string>;
	addHelp?: string;
	/** `agent add` refuses with this text. */
	refuse?: string;
	/** `agent add` exits 0 but installs nothing. */
	silentAdd?: boolean;
	listOutput?: string;
	noCli?: boolean;
	/** Files that exist before anything is installed: [relative path, text]. */
	files?: readonly (readonly [string, string])[];
}

interface FakeCli {
	readonly runner: CliRunnerType;
	readonly dir: string;
	invocations(): string[];
	installed(): string[];
	adds(): string[];
}

function fakeCli(options: FakeOptions = {}): FakeCli {
	const dir = makeTempDir('entire-agents-');
	const bin = path.join(dir, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });
	const log = path.join(dir, 'invocations.log');
	const state = path.join(dir, 'state');
	fs.mkdirSync(state);

	fs.writeFileSync(path.join(state, 'agents'), (options.agents ?? ['alpha-agent', 'beta-agent', 'gamma-agent']).join('\n') + '\n');
	fs.writeFileSync(path.join(state, 'installed'), (options.installed ?? []).join('\n') + '\n');
	fs.writeFileSync(path.join(state, 'add-help.txt'), options.addHelp ?? ADD_HELP);
	for (const [name, verbs] of Object.entries(options.verbs ?? {})) {
		fs.writeFileSync(path.join(state, `verbs-${name}`), verbs);
	}
	for (const [relative, text] of options.files ?? []) {
		fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
		fs.writeFileSync(path.join(dir, relative), text);
	}
	if (options.listOutput !== undefined) {
		fs.writeFileSync(path.join(state, 'list-output'), options.listOutput);
	}

	const script = [
		'#!/bin/sh',
		'if [ "$1" = "--context" ]; then shift 2; fi',
		`echo "$@" >> '${log}'`,
		`S='${state}'`,
		'case "$1 $2" in',
		'\t"version ") echo "entire 0.12.2" ;;',
		'\t"agent list")',
		'\t\tif [ -f "$S/list-output" ]; then cat "$S/list-output"; exit 0; fi',
		'\t\techo "Agents:"; while read a; do [ -z "$a" ] && continue; if grep -qx "$a" "$S/installed"; then echo "  ✓ $a"; else echo "    $a"; fi; done < "$S/agents"',
		'\t\techo; echo "Use entire agent add to install hooks." ;;',
		'\t"agent-help agent") [ "$3" = "add" ] && cat "$S/add-help.txt" || echo "agent" ;;',
		'\t"agent add")',
		`\t\t${options.refuse !== undefined ? `echo '${options.refuse}' >&2; exit 1` : ':'}`,
		'\t\tfor name; do :; done',
		`\t\t${options.silentAdd ? 'exit 0' : ':'}`,
		'\t\techo "$name" >> "$S/installed"',
		'\t\tverbs="' + FULL_VERBS + '"; [ -f "$S/verbs-$name" ] && verbs=$(cat "$S/verbs-$name")',
		'\t\tmkdir -p ".$name"; : > ".$name/hooks.json"',
		'\t\tfor v in $verbs; do echo "sh -c \'exec entire hooks $name $v\'" >> ".$name/hooks.json"; done',
		'\t\techo "  Agent: $name"; echo "Ready."; echo; echo "Make sure to commit these files to your Git repo:"; echo "  .entire/settings.json"; echo "  .$name/hooks.json" ;;',
		'\thooks\\ *) cat > /dev/null; exit 0 ;;',
		'\t"agent remove")',
		'\t\tfor name; do :; done',
		'\t\tgrep -vx "$name" "$S/installed" > "$S/installed.tmp"; mv "$S/installed.tmp" "$S/installed"; rm -rf ".$name"',
		'\t\techo "$name hooks removed." ;;',
		'\t*) echo "unknown command" >&2; exit 2 ;;',
		'esac',
	].join('\n');

	if (!options.noCli) {
		const binary = path.join(bin, 'entire');
		fs.writeFileSync(binary, `${script}\n`, 'utf8');
		fs.chmodSync(binary, 0o755);
	}

	const runner = new CliRunner(new CliLocator({ homeDir: dir, env: { PATH: '' } }));
	const invocations = (): string[] =>
		fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
	return {
		runner,
		dir,
		invocations,
		installed: () => fs.readFileSync(path.join(state, 'installed'), 'utf8').split('\n').filter(Boolean),
		adds: () => invocations().filter(line => line.startsWith('agent add')),
	};
}

function serviceFor(cli: FakeCli, editorAgent = 'alpha-agent'): AgentIntegrationService {
	return new AgentIntegrationService({
		runner: cli.runner,
		workspaceRoot: () => cli.dir,
		timeoutSeconds: () => 20,
		editorAgent: () => editorAgent,
	});
}

/** A runner that records the hooks the bridge sends. */
class RecordingRunner {
	readonly calls: { args: readonly string[]; input?: string }[] = [];

	async run(args: readonly string[], options: { input?: string } = {}): Promise<{ ok: boolean; detail: string }> {
		this.calls.push({ args, input: options.input });
		return { ok: true, detail: '' };
	}

	asRunner(): CliRunnerType {
		return this as unknown as CliRunnerType;
	}
}

function bridgeFor(
	cli: FakeCli,
	recorder: { asRunner(): CliRunnerType },
	log?: (line: string) => void,
	editorAgent = 'alpha-agent',
): HookBridge {
	return new HookBridge({
		runner: recorder.asRunner(),
		agents: serviceFor(cli, editorAgent),
		workspaceRoot: () => cli.dir,
		env: {},
		homeDir: '/home/tester',
		log,
	});
}

interface UiScript {
	agent?: string | null;
	action?: AgentAction;
	confirm?: boolean;
}

function fakeUi(script: UiScript = {}): AgentUi & {
	offered: AgentListing[][];
	confirmations: AgentConfirmation[];
	informed: string[];
	warned: string[];
} {
	const ui = {
		offered: [] as AgentListing[][],
		confirmations: [] as AgentConfirmation[],
		informed: [] as string[],
		warned: [] as string[],
		async chooseAgent(agents: readonly AgentListing[]): Promise<AgentListing | undefined> {
			ui.offered.push([...agents]);
			return script.agent === null ? undefined : agents.find(agent => agent.name === script.agent);
		},
		async chooseAction(): Promise<AgentAction | undefined> {
			return script.action;
		},
		async confirm(prompt: AgentConfirmation): Promise<boolean> {
			ui.confirmations.push(prompt);
			return script.confirm ?? true;
		},
		withProgress<T>(_title: string, work: () => Promise<T>): Promise<T> {
			return work();
		},
		async inform(message: string): Promise<void> {
			ui.informed.push(message);
		},
		async warn(message: string): Promise<void> {
			ui.warned.push(message);
		},
	};
	return ui;
}

function depsFor(cli: FakeCli, ui: AgentUi): AgentDependencies {
	return { agents: serviceFor(cli), ui, refresh: async () => undefined, running: { active: false } };
}

suite('Agent list parsing', () => {
	test('reads the agents and which are installed from the CLI output', () => {
		assert.deepStrictEqual(parseAgentList(REAL_LIST), [
			{ name: 'antigravity', installed: false },
			{ name: 'claude-code', installed: true },
			{ name: 'codex', installed: true },
			{ name: 'copilot-cli', installed: false },
		]);
	});

	test('takes whatever names the CLI prints rather than a fixed set', () => {
		const names = parseAgentList('Agents:\n  ✓ zeta-agent\n    omega.9\n')?.map(agent => agent.name);
		assert.deepStrictEqual(names, ['zeta-agent', 'omega.9']);
	});

	test('reports output it does not understand rather than an empty list', () => {
		assert.strictEqual(parseAgentList('something else entirely'), undefined);
		assert.deepStrictEqual(parseAgentList('Agents:\n  --force\n'), []);
	});

	test('reads a list with no tick marks as all not installed', () => {
		assert.deepStrictEqual(parseAgentList('Agents:\n    one\n    two\n'), [
			{ name: 'one', installed: false },
			{ name: 'two', installed: false },
		]);
	});

	test('skips a line it does not recognise and tolerates trailing lines', () => {
		const list = parseAgentList("Agents:\n  ✓ one\n  not an agent line\n    two\n  --odd\nUse 'entire agent add <name>'\nlast-line\n");
		assert.deepStrictEqual(list?.map(agent => [agent.name, agent.installed]), [['one', true], ['two', false], ['last-line', false]]);
		assert.deepStrictEqual(parseAgentList('Agents:\n\n  ✓ one\n\n  ignored\n'), [{ name: 'one', installed: true }]);
	});

	test('accepts only names that cannot be read as a flag', () => {
		assert.ok(isAgentName('claude-code'));
		assert.ok(!isAgentName('--force'));
		assert.ok(!isAgentName('two words'));
		assert.ok(!isAgentName(''));
	});
});

suite('Agent install planning', () => {
	test('finds the reinstall flag by what its help line says', () => {
		const plan = planAgentAddFlags(ADD_HELP);
		assert.ok(plan.ok && plan.reinstall === '--force');
	});

	test('follows a renamed flag', () => {
		const plan = planAgentAddFlags(RENAMED_ADD_HELP);
		assert.ok(plan.ok && plan.reinstall === '--again');
	});

	test('offers no reinstall when the help has none', () => {
		const plan = planAgentAddFlags(NO_REINSTALL_HELP);
		assert.ok(plan.ok && plan.reinstall === undefined);
	});

	test('puts the agent name after the end of options', () => {
		assert.deepStrictEqual(agentAddArguments('codex'), ['agent', 'add', '--', 'codex']);
		assert.deepStrictEqual(agentAddArguments('codex', '--again'), ['agent', 'add', '--again', '--', 'codex']);
		assert.deepStrictEqual(agentRemoveArguments('codex'), ['agent', 'remove', '--', 'codex']);
	});

	test('reads the files the CLI lists to commit', () => {
		const output = 'Ready.\n\nMake sure to commit these files to your Git repo so Entire works:\n  .entire/settings.json\n  .claude/settings.json\n\nDone';
		assert.deepStrictEqual(readWrittenFiles(output), ['.entire/settings.json', '.claude/settings.json']);
		assert.deepStrictEqual(readWrittenFiles('Ready.'), []);
		assert.deepStrictEqual(readWrittenFiles('commit these files:\n  ../escape\n'), []);
	});
});

suite('Agent hook support', () => {
	const copilotFile = '{"bash":"sh -c \'exec entire hooks copilot-cli session-start\'","x":"entire hooks copilot-cli agent-stop"}';

	test('reads the verbs from the hook commands the CLI wrote', () => {
		assert.deepStrictEqual(findHookVerbs('copilot-cli', copilotFile), ['session-start', 'agent-stop']);
	});

	test('does not mix up one agent with another whose name begins the same way', () => {
		assert.deepStrictEqual(findHookVerbs('codex', 'entire hooks codex-extra stop'), []);
		assert.deepStrictEqual(findHookVerbs('c.dex', 'entire hooks codex stop'), []);
	});

	test('only the editor agent is bridged, whatever verbs another agent names', () => {
		const found = { installed: true, files: ['.a/hooks.json'] };
		const bridged = classifyAgent('copilot-cli', 'copilot-cli', found);
		assert.strictEqual(bridged.kind, 'bridged');
		assert.ok(describeBridging(bridged).startsWith('Bridged:'));

		const other = classifyAgent('claude-code', 'copilot-cli', found);
		assert.strictEqual(other.kind, 'not-bridged');
		assert.ok(other.kind === 'not-bridged' && other.reason.includes('runs its own hooks; Entirely does not forward editor events to it'));
		assert.ok(describeBridging(other).startsWith('Not bridged:'));
		assert.ok(!/captured/i.test(describeBridging(other)));
	});
});

suite('Hook configuration scan', () => {
	test('finds files under dot-directories that call entire hooks, whatever the agent', () => {
		const dir = makeTempDir('entire-scan-');
		fs.mkdirSync(path.join(dir, '.one'), { recursive: true });
		fs.mkdirSync(path.join(dir, '.github', 'hooks'), { recursive: true });
		fs.mkdirSync(path.join(dir, 'src'));
		fs.writeFileSync(path.join(dir, '.one', 'a.json'), 'exec entire hooks one session-start');
		fs.writeFileSync(path.join(dir, '.github', 'hooks', 'entire.json'), 'entire hooks two agent-stop');
		fs.writeFileSync(path.join(dir, '.one', 'unrelated.json'), '{}');
		fs.writeFileSync(path.join(dir, 'src', 'x.json'), 'entire hooks three stop');

		return scanHookConfig(dir).then(files => {
			assert.deepStrictEqual(files.map(file => file.file).sort(), ['.github/hooks/entire.json', '.one/a.json']);
			assert.deepStrictEqual(hooksOf('one', files), { verbs: ['session-start'], files: ['.one/a.json'] });
			assert.deepStrictEqual(hooksOf('three', files), { verbs: [], files: [] });
		});
	});

	test('skips a file larger than the limit and a missing workspace', async () => {
		const dir = makeTempDir('entire-scan-');
		fs.mkdirSync(path.join(dir, '.big'));
		fs.writeFileSync(path.join(dir, '.big', 'a.json'), `entire hooks big stop${' '.repeat(SCAN_LIMITS.bytes)}`);
		assert.deepStrictEqual(await scanHookConfig(dir), []);
		assert.deepStrictEqual(await scanHookConfig(path.join(dir, 'missing')), []);
	});
});

suite('Agent integrations (fake CLI)', () => {
	test('agent-list: the agents are the ones the CLI prints, with what is installed', async () => {
		const cli = fakeCli({ agents: ['one-x', 'two-y'], installed: ['two-y'] });
		const listed = await serviceFor(cli).list();

		assert.ok(listed.ok);
		assert.deepStrictEqual(listed.agents.map(agent => [agent.name, agent.installed]), [['one-x', false], ['two-y', true]]);
		// Nothing in the source decides these names: a different CLI lists different ones.
		const other = await serviceFor(fakeCli({ agents: ['solo'] })).list();
		assert.ok(other.ok && other.agents.length === 1 && other.agents[0].name === 'solo');
	});

	test('agent-list: the setup flow offers the CLI list to the user', async () => {
		const cli = fakeCli({ agents: ['one-x', 'two-y'] });
		const ui = fakeUi({ agent: null });

		assert.strictEqual(await manageAgents(depsFor(cli, ui)), 'cancelled');
		assert.deepStrictEqual(ui.offered[0].map(agent => agent.name), ['one-x', 'two-y']);
	});

	test('agent-list: a CLI that is missing is reported, not shown as no agents', async () => {
		const cli = fakeCli({ noCli: true });
		const ui = fakeUi();

		assert.strictEqual(await manageAgents(depsFor(cli, ui)), 'failed');
		assert.ok(ui.warned[0].includes('not installed'));
		assert.strictEqual(ui.offered.length, 0);
	});

	test('agent-list: output in an unknown format is reported as unreadable', async () => {
		const listed = await serviceFor(fakeCli({ listOutput: 'a new format\n' })).list();
		assert.ok(!listed.ok && listed.detail.includes('not in a form Entirely understands'));
	});

	test('install-agent: runs agent add, then confirms from a fresh list', async () => {
		const cli = fakeCli();
		const outcome = await serviceFor(cli).install('alpha-agent');

		assert.strictEqual(outcome.kind, 'done');
		assert.deepStrictEqual(cli.adds(), ['agent add -- alpha-agent']);
		assert.deepStrictEqual(cli.installed(), ['alpha-agent']);
		if (outcome.kind === 'done') {
			assert.deepStrictEqual(outcome.files, ['.entire/settings.json', '.alpha-agent/hooks.json']);
			assert.strictEqual(outcome.bridging?.kind, 'bridged');
		}
	});

	test('install-agent: the user agrees to what will be touched, then it is installed and reported', async () => {
		const cli = fakeCli({ installed: ['beta-agent'] });
		fs.mkdirSync(path.join(cli.dir, '.beta-agent'));
		const ui = fakeUi({ agent: 'alpha-agent' });

		assert.strictEqual(await manageAgents(depsFor(cli, ui)), 'installed');

		assert.ok(ui.confirmations[0].detail.includes('hook configuration'));
		assert.ok(ui.confirmations[0].detail.includes('beta-agent stay installed'));
		assert.ok(ui.informed[0].includes('alpha-agent is installed'));
		assert.ok(ui.informed[0].includes('.alpha-agent/hooks.json'));
		assert.ok(ui.informed[0].includes("Bridged: Entirely forwards this editor's own agent events to alpha-agent"));
		assert.deepStrictEqual(cli.installed().sort(), ['alpha-agent', 'beta-agent']);
	});

	test('a declined install runs nothing and changes nothing', async () => {
		const cli = fakeCli();
		const ui = fakeUi({ agent: 'alpha-agent', confirm: false });

		assert.strictEqual(await manageAgents(depsFor(cli, ui)), 'cancelled');

		assert.deepStrictEqual(cli.adds(), []);
		assert.deepStrictEqual(cli.installed(), []);
		assert.ok(!fs.existsSync(path.join(cli.dir, '.alpha-agent')));
		assert.deepStrictEqual(ui.informed, []);
	});

	test('a CLI refusal is reported as a failure with its reason', async () => {
		const cli = fakeCli({ refuse: 'agent needs a git repository' });
		const ui = fakeUi({ agent: 'alpha-agent' });

		assert.strictEqual(await manageAgents(depsFor(cli, ui)), 'failed');

		assert.ok(ui.warned[0].includes('Could not install alpha-agent: agent needs a git repository'));
		assert.deepStrictEqual(ui.informed, []);
		assert.deepStrictEqual(cli.installed(), []);
	});

	test('an exit 0 that installed nothing is not reported as an install', async () => {
		const cli = fakeCli({ silentAdd: true });
		const outcome = await serviceFor(cli).install('alpha-agent');

		assert.strictEqual(outcome.kind, 'failed');
		assert.ok(outcome.kind === 'failed' && outcome.detail.includes('does not list alpha-agent as installed'));
	});

	test('a name the CLI did not list is refused before anything runs', async () => {
		const cli = fakeCli();
		const service = serviceFor(cli);

		assert.strictEqual((await service.install('nope-agent')).kind, 'failed');
		assert.strictEqual((await service.install('--force')).kind, 'failed');
		assert.deepStrictEqual(cli.adds(), []);
	});

	test('more than one agent can be installed, and removing one leaves the other', async () => {
		const cli = fakeCli();
		const service = serviceFor(cli);

		assert.strictEqual((await service.install('alpha-agent')).kind, 'done');
		assert.strictEqual((await service.install('beta-agent')).kind, 'done');
		assert.deepStrictEqual(cli.installed(), ['alpha-agent', 'beta-agent']);

		const ui = fakeUi({ agent: 'alpha-agent', action: 'remove' });
		assert.strictEqual(await manageAgents(depsFor(cli, ui)), 'removed');
		assert.ok(ui.confirmations[0].detail.includes('beta-agent stay installed'));
		assert.deepStrictEqual(cli.installed(), ['beta-agent']);
		assert.ok(fs.existsSync(path.join(cli.dir, '.beta-agent', 'hooks.json')));
	});

	test('a declined removal changes nothing, and removing an agent that is not installed is refused', async () => {
		const cli = fakeCli({ installed: ['alpha-agent'] });
		const ui = fakeUi({ agent: 'alpha-agent', action: 'remove', confirm: false });

		assert.strictEqual(await manageAgents(depsFor(cli, ui)), 'cancelled');
		assert.deepStrictEqual(cli.installed(), ['alpha-agent']);
		assert.ok(!cli.invocations().some(line => line.startsWith('agent remove')));

		const outcome = await serviceFor(cli).remove('beta-agent');
		assert.ok(outcome.kind === 'failed' && outcome.detail.includes('not installed'));
	});

	test('reinstall uses the flag named by the help, even when it is renamed', async () => {
		const cli = fakeCli({ installed: ['alpha-agent'], addHelp: RENAMED_ADD_HELP });
		const service = serviceFor(cli);

		assert.strictEqual(await service.canReinstall(), true);
		assert.strictEqual((await service.install('alpha-agent', true)).kind, 'done');
		assert.deepStrictEqual(cli.adds(), ['agent add --again -- alpha-agent']);
	});

	test('reinstall is not offered, and not attempted, when the help has no such flag', async () => {
		const cli = fakeCli({ installed: ['alpha-agent'], addHelp: NO_REINSTALL_HELP });
		const service = serviceFor(cli);

		assert.strictEqual(await service.canReinstall(), false);
		const outcome = await service.install('alpha-agent', true);
		assert.strictEqual(outcome.kind, 'failed');
		assert.deepStrictEqual(cli.adds(), []);
	});

	test('the confirmations name the agent and what stays', () => {
		const agents: AgentListing[] = [
			{ name: 'a', installed: true },
			{ name: 'b', installed: false },
		];
		assert.ok(installConfirmation(agents[1], agents, false).detail.includes('a stay installed'));
		assert.ok(installConfirmation(agents[1], agents, true).message.startsWith('Reinstall'));
		assert.ok(removeConfirmation(agents[0], agents).detail.includes('No other agent is installed'));
		assert.ok(describeOutcome('a', 'remove', { kind: 'done', summary: 'a hooks removed.', files: [] }).startsWith('a was removed'));
	});

	test('the install confirmation says plainly that the files cannot be listed beforehand, and the removal names the files', async () => {
		const agents: AgentListing[] = [{ name: 'a', installed: true, hookFiles: ['.a/hooks.json'] }, { name: 'b', installed: false }];
		const install = installConfirmation(agents[1], agents, false).detail;
		assert.ok(install.includes('cannot say which files in advance'));
		assert.ok(install.includes('lists the files to commit when it finishes'));
		assert.ok(removeConfirmation(agents[0], agents).detail.includes('.a/hooks.json'));
		assert.ok(installConfirmation(agents[0], agents, true).detail.includes('.a/hooks.json'));

		const cli = fakeCli({ installed: ['alpha-agent'], files: [['.alpha-agent/hooks.json', 'entire hooks alpha-agent session-start']] });
		const listed = await serviceFor(cli).list();
		assert.ok(listed.ok);
		assert.deepStrictEqual(listed.agents.find(agent => agent.name === 'alpha-agent')?.hookFiles, ['.alpha-agent/hooks.json']);
	});

	test('a second change is refused while one is running', async () => {
		const cli = fakeCli();
		const ui = fakeUi({ agent: 'alpha-agent' });
		const deps = { ...depsFor(cli, ui), running: { active: true } };

		assert.strictEqual(await manageAgents(deps), 'cancelled');
		assert.ok(ui.informed[0].includes('already running'));
		assert.deepStrictEqual(cli.adds(), []);
	});

	test('setup names the agent it enables rather than defaulting to one', async () => {
		const runner = {
			usage: async () => ({
				ok: true as const,
				value: { command: 'enable', flags: [{ name: '--agent', description: '' }, { name: '--no-init-repo', description: '' }], raw: '' },
			}),
		};
		assert.deepStrictEqual(await enableArguments(runner as never, 'omega-agent'), ['enable', '--agent', 'omega-agent', '--no-init-repo']);
	});
});

suite('Hook bridge across installed agents', () => {
	const editorHook = 'entire hooks alpha-agent session-start; entire hooks alpha-agent agent-stop';

	test('the editor agent is bridged and addressed by its own name', async () => {
		const cli = fakeCli({ installed: ['alpha-agent'], files: [['.alpha-agent/hooks.json', editorHook]] });
		const recorder = new RecordingRunner();

		const results = await bridgeFor(cli, recorder).deliverToAgents('SessionStart', {});

		assert.deepStrictEqual(results, [{ agent: 'alpha-agent', delivered: true }]);
		assert.deepStrictEqual(recorder.calls.map(call => call.args), [['hooks', 'alpha-agent', 'session-start']]);
	});

	test('the editor agent is bridged even before it is installed, as the bridge always was', async () => {
		const cli = fakeCli();
		const recorder = new RecordingRunner();

		assert.strictEqual(await bridgeFor(cli, recorder).deliver('UserPromptSubmit', { prompt: 'p' }), true);
		assert.deepStrictEqual(recorder.calls.map(call => call.args), [['hooks', 'alpha-agent', 'user-prompt-submitted']]);
	});

	test('claude-code, codex and cursor style agents are not bridged and never invoked', async () => {
		const names = ['claude-code', 'codex', 'cursor'];
		const cli = fakeCli({
			agents: ['alpha-agent', ...names],
			installed: names,
			files: names.map(name => [`.${name}/hooks.json`, `entire hooks ${name} session-start; entire hooks ${name} session-end`] as const),
		});
		const recorder = new RecordingRunner();
		const lines: string[] = [];
		const bridge = bridgeFor(cli, recorder, line => lines.push(line));

		const results = await bridge.deliverToAgents('SessionStart', {});
		await bridge.deliverToAgents('Stop', { terminal: true });

		for (const name of names) {
			assert.deepStrictEqual(results.find(result => result.agent === name), { agent: name, delivered: false, skipped: 'not-bridged' });
		}
		assert.ok(recorder.calls.every(call => call.args[1] === 'alpha-agent'));
		assert.ok(recorder.calls.every(call => !names.includes(call.args[1])));
		assert.strictEqual(lines.filter(line => line.startsWith('not bridged claude-code')).length, 1);

		const listed = await serviceFor(cli).list();
		assert.ok(listed.ok);
		for (const name of names) {
			const bridging: HookBridging | undefined = listed.agents.find(agent => agent.name === name)?.bridging;
			assert.strictEqual(bridging?.kind, 'not-bridged');
			assert.ok(bridging && describeBridging(bridging).includes('runs its own hooks'));
		}
	});

	test('a CLI that exits 0 for hooks but records nothing is never reported as captured for another agent', async () => {
		const cli = fakeCli({
			agents: ['claude-code', 'alpha-agent'],
			installed: ['claude-code'],
			files: [['.claude-code/hooks.json', 'entire hooks claude-code session-start; entire hooks claude-code agent-stop']],
		});
		const bridge = bridgeFor(cli, { asRunner: () => cli.runner }, undefined, 'alpha-agent');

		const results = await bridge.deliverToAgents('SessionStart', {});

		assert.strictEqual(results.find(result => result.agent === 'claude-code')?.delivered, false);
		assert.ok(cli.invocations().every(line => !line.startsWith('hooks claude-code')));
	});

	test('with no editor agent in the CLI list nothing is sent, and no agent is assumed', async () => {
		const cli = fakeCli({ agents: ['beta-agent'] });
		const recorder = new RecordingRunner();

		assert.strictEqual(await bridgeFor(cli, recorder).deliver('SessionStart', {}), false);
		assert.strictEqual(recorder.calls.length, 0);
	});

	test('the editor agent is chosen by setting, not by a name in the code', async () => {
		const cli = fakeCli({ agents: ['alpha-agent', 'beta-agent'], installed: ['alpha-agent'] });
		const recorder = new RecordingRunner();

		const results = await bridgeFor(cli, recorder, undefined, 'beta-agent').deliverToAgents('SessionStart', {});

		assert.deepStrictEqual(recorder.calls.map(call => call.args), [['hooks', 'beta-agent', 'session-start']]);
		assert.strictEqual(results.find(result => result.agent === 'alpha-agent')?.skipped, 'not-bridged');
	});

	test('an editor agent whose hook file the editor loads itself is not sent the same events again', async () => {
		const cli = fakeCli({ installed: ['alpha-agent'], files: [['.github/hooks/entire.json', 'entire hooks alpha-agent session-start']] });
		const recorder = new RecordingRunner();

		const results = await bridgeFor(cli, recorder).deliverToAgents('SessionStart', {});

		assert.deepStrictEqual(results, [{ agent: 'alpha-agent', delivered: false, skipped: 'already-reported' }]);
		assert.strictEqual(recorder.calls.length, 0);
	});

	test('a missing CLI delivers nothing and says nothing to the user', async () => {
		const cli = fakeCli({ noCli: true });
		const recorder = new RecordingRunner();

		assert.strictEqual(await bridgeFor(cli, recorder).deliver('SessionStart', {}), false);
	});

	test('the prompt never reaches the log', async () => {
		const cli = fakeCli({ installed: ['alpha-agent'], files: [['.alpha-agent/h.json', 'entire hooks alpha-agent user-prompt-submitted']] });
		const lines: string[] = [];

		await bridgeFor(cli, new RecordingRunner(), line => lines.push(line)).deliver('UserPromptSubmit', { prompt: 'tell nobody this secret' });

		assert.ok(lines.length > 0);
		assert.ok(lines.every(line => !line.includes('secret')));
	});
});

suite('Agent lookup cache', () => {
	const lists = (cli: FakeCli): number => cli.invocations().filter(line => line === 'agent list').length;

	test('many editor events cost one lookup', async () => {
		const cli = fakeCli({ installed: ['alpha-agent'] });
		const bridge = bridgeFor(cli, new RecordingRunner());

		await Promise.all([1, 2, 3, 4, 5].map(() => bridge.deliver('SessionStart', {})));
		await bridge.deliver('UserPromptSubmit', {});
		await bridge.deliver('PostToolUse', {});

		assert.strictEqual(lists(cli), 1);
	});

	test('an install makes the next event look again', async () => {
		const cli = fakeCli({ agents: ['alpha-agent', 'beta-agent'], installed: ['beta-agent'] });
		const service = serviceFor(cli);
		const bridge = new HookBridge({ runner: new RecordingRunner().asRunner(), agents: service, workspaceRoot: () => cli.dir, env: {} });

		await bridge.deliver('SessionStart', {});
		const before = lists(cli);
		assert.strictEqual(before, 1);

		assert.strictEqual((await service.install('alpha-agent')).kind, 'done');
		const afterInstall = lists(cli);
		await bridge.deliver('SessionStart', {});
		await bridge.deliver('SessionStart', {});

		assert.strictEqual(lists(cli), afterInstall, 'the install already read the fresh list, so events reuse it');
		const targets = await service.targets();
		assert.ok(targets.ok && targets.bridged?.installed === true);
	});

	test('invalidate, a removal and a changed setting each force a fresh lookup, and a failure is not kept', async () => {
		const cli = fakeCli({ installed: ['alpha-agent'] });
		const service = serviceFor(cli);

		await service.targets();
		await service.targets();
		assert.strictEqual(lists(cli), 1);

		service.invalidate();
		await service.targets();
		assert.strictEqual(lists(cli), 2);

		await service.remove('alpha-agent');
		const afterRemove = lists(cli);
		const targets = await service.targets();
		assert.ok(targets.ok && targets.bridged?.installed === false);
		assert.strictEqual(lists(cli), afterRemove, 'the removal re-read the list');

		let editor = 'alpha-agent';
		const switching = new AgentIntegrationService({ runner: cli.runner, workspaceRoot: () => cli.dir, timeoutSeconds: () => 20, editorAgent: () => editor });
		await switching.targets();
		const count = lists(cli);
		editor = 'beta-agent';
		await switching.targets();
		assert.strictEqual(lists(cli), count + 1);

		const absent = fakeCli({ noCli: true });
		const missing = serviceFor(absent);
		assert.strictEqual((await missing.targets()).ok, false);
		assert.strictEqual((await missing.targets()).ok, false);
	});
});
