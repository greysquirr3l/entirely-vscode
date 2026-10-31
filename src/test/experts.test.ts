import * as assert from 'assert';
import * as path from 'path';

import {
	EXPERTS_SERVER_NOTICE,
	EXPERTS_WANTS,
	UNREADABLE_EXPERTS,
	classifyExpertsFailure,
	decodeExperts,
	describeEmptyExperts,
	describeExperts,
	describeNotMirrored,
	expertsArguments,
	pickFlags,
	type ExpertsContext,
	type ExpertsFlags,
	type ExpertsRequest,
} from '../lib/entire';
import { expertsAsk, expertsForPath, expertsStaged, showRawReply, type ExpertsUi } from '../commands/experts';
import type { GeneratedKind } from '../providers/generatedDocuments';
import { REDACTED_OPERAND } from '../services/cli/runner';
import { MAX_EXPERTS_LIMIT_SETTING, MIN_EXPERTS_LIMIT_SETTING, clampExpertsLimit, clampExpertsTimeout } from '../services/configuration';
import { ExpertsService } from '../services/experts';
import { ALICE, EXPERTS_JSON, fakeAnalysisCli, type FakeAnalysisCli, type FakeAnalysisOptions } from './support/analysisCli';
import { EXPERTS_HELP } from './support/analysisFixtures';

const FLAGS: ExpertsFlags = { viewer: '--tui', json: '--json', limit: '--limit', branch: '--branch', repo: '--repo', staged: '--staged' };
const CONTEXT: ExpertsContext = { repository: 'gh/acme/widgets', branch: 'main', login: 'alice', limit: 8 };

suite('Experts: arguments come from the help', () => {
	test('picks the flags by what they do and keeps the interactive switch out of the others', () => {
		const picked = pickFlags('experts', EXPERTS_HELP, [], EXPERTS_WANTS);
		assert.ok(picked.ok);
		assert.deepStrictEqual(picked.flags, FLAGS);
	});

	test('a path goes after the end-of-options marker', () => {
		assert.deepStrictEqual(expertsArguments(FLAGS, { kind: 'scope', scope: 'src/payments' }), ['experts', '--json', '--', 'src/payments']);
	});

	test('a question that starts with a dash is one operand, and the viewer flag is never added', () => {
		const args = expertsArguments(FLAGS, { kind: 'query', text: '--tui who owns --staged' }, { limit: 5, branch: 'main' });
		assert.deepStrictEqual(args, ['experts', '--json', '--limit=5', '--branch=main', '--', '--tui who owns --staged']);
		assert.ok(!args?.slice(0, args.indexOf('--')).includes('--tui'));
	});

	test('the staged lookup uses the staged flag and takes no operand', () => {
		assert.deepStrictEqual(expertsArguments(FLAGS, { kind: 'staged' }), ['experts', '--json', '--staged']);
		assert.strictEqual(expertsArguments({ json: '--json' }, { kind: 'staged' }), undefined);
	});

	test('the limit is clamped to the CLI bounds and left out when the help has no limit flag', () => {
		assert.deepStrictEqual(expertsArguments(FLAGS, { kind: 'staged' }, { limit: 99 }), ['experts', '--json', '--limit=20', '--staged']);
		assert.deepStrictEqual(expertsArguments(FLAGS, { kind: 'staged' }, { limit: 0 }), ['experts', '--json', '--limit=1', '--staged']);
		assert.deepStrictEqual(expertsArguments({ json: '--json', staged: '--staged' }, { kind: 'staged' }, { limit: 5 }), ['experts', '--json', '--staged']);
	});

	test('cannot run without the json flag or with an empty operand', () => {
		assert.strictEqual(expertsArguments({}, { kind: 'scope', scope: 'a' }), undefined);
		assert.strictEqual(expertsArguments(FLAGS, { kind: 'scope', scope: '' }), undefined);
		assert.strictEqual(expertsArguments(FLAGS, { kind: 'query', text: '' }), undefined);
	});

	test('the setting is clamped to the CLI bounds', () => {
		assert.strictEqual(clampExpertsLimit(0), MIN_EXPERTS_LIMIT_SETTING);
		assert.strictEqual(clampExpertsLimit(500), MAX_EXPERTS_LIMIT_SETTING);
		assert.strictEqual(clampExpertsLimit(Number.NaN), 8);
		assert.strictEqual(clampExpertsTimeout(1), 5);
		assert.strictEqual(clampExpertsTimeout(Number.NaN), 30);
	});
});

suite('Experts: reading the answer', () => {
	test('reads a bare array and keeps every field', () => {
		const reading = decodeExperts([{ name: 'agent-one', kind: 'agent', score: 3, seen: 'yesterday', nested: { a: 1 } }]);
		assert.ok(reading.kind === 'entries');
		assert.deepStrictEqual(reading.entries, [
			{ name: 'agent-one', kind: 'agent', score: 3, details: [{ label: 'seen', value: 'yesterday' }, { label: 'nested', value: '{"a":1}' }] },
		]);
	});

	test('reads an object that holds the list under a likely key or any key', () => {
		const underProfiles = decodeExperts(JSON.parse(EXPERTS_JSON));
		assert.ok(underProfiles.kind === 'entries' && underProfiles.entries.length === 2);
		const underOther = decodeExperts({ scope: 'src', ranked: [{ skill: 'fmt', count: 2 }] });
		assert.ok(underOther.kind === 'entries');
		assert.deepStrictEqual(underOther.entries[0], { name: 'fmt', kind: undefined, score: 2, details: [] });
	});

	test('shows an entry it does not recognise rather than dropping it', () => {
		const reading = decodeExperts([{ weight: 'high', who: 'someone' }, 'plain', 7]);
		assert.ok(reading.kind === 'entries');
		assert.strictEqual(reading.entries.length, 3);
		assert.strictEqual(reading.entries[0].name, 'Entry 1');
		assert.deepStrictEqual(reading.entries[0].details.map(detail => detail.label), ['weight', 'who']);
		assert.strictEqual(reading.entries[1].name, 'plain');
		assert.strictEqual(reading.entries[2].name, '7');
	});

	test('an empty list is empty and a payload with no list is unreadable', () => {
		assert.deepStrictEqual(decodeExperts([]), { kind: 'empty' });
		assert.deepStrictEqual(decodeExperts({ profiles: [] }), { kind: 'empty' });
		assert.deepStrictEqual(decodeExperts({ profiles: null }), { kind: 'empty' });
		assert.deepStrictEqual(decodeExperts({ message: 'hello' }), { kind: 'unreadable' });
		assert.deepStrictEqual(decodeExperts('text'), { kind: 'unreadable' });
		assert.deepStrictEqual(decodeExperts(null), { kind: 'unreadable' });
	});

	test('tells a repository that is not mirrored from any other failure', () => {
		assert.strictEqual(classifyExpertsFailure('repository is not mirrored on Entire'), 'not-mirrored');
		assert.strictEqual(classifyExpertsFailure('repo not found'), 'not-mirrored');
		assert.strictEqual(classifyExpertsFailure('please publish the repository first'), 'not-mirrored');
		assert.strictEqual(classifyExpertsFailure('connection reset'), 'other');
	});
});

suite('Experts: the words', () => {
	const request: ExpertsRequest = { kind: 'scope', scope: 'src/payments' };

	test('a ranking names the scope, the repository, the branch, the login and the servers', () => {
		const reading = decodeExperts(JSON.parse(EXPERTS_JSON));
		assert.ok(reading.kind === 'entries');
		const text = describeExperts(reading.entries, request, CONTEXT).replace(/\\(.)/g, '$1');
		assert.ok(text.includes(EXPERTS_SERVER_NOTICE));
		assert.match(text, /Scope: src\/payments/);
		assert.match(text, /Repository: gh\/acme\/widgets/);
		assert.match(text, /Branch: main/);
		assert.match(text, /Asked as: alice, on Entire/);
		assert.match(text, /1\. \*\*agent-one\*\* \(agent\) — 12/);
		assert.match(text, /last_seen: 2026-10-01/);
	});

	test('the staged scope is named and a question is not repeated in the document', () => {
		const staged = describeEmptyExperts({ kind: 'staged' }, CONTEXT);
		assert.match(staged, /Scope: the staged files/);
		const question = describeEmptyExperts({ kind: 'query', text: 'SECRET-QUESTION-TEXT' }, CONTEXT);
		assert.ok(!question.includes('SECRET-QUESTION-TEXT'));
		assert.match(question, /Scope: the question you typed/);
	});

	test('an empty result says nothing was found and that a recent push can take a couple of minutes', () => {
		const text = describeEmptyExperts(request, CONTEXT);
		assert.match(text, /Nothing found/);
		assert.match(text, /no recorded provenance for the path src\/payments/);
		assert.match(text, /a couple of minutes/);
	});

	test('a repository that is not mirrored points to creating or mirroring it and keeps the CLI text', () => {
		const text = describeNotMirrored('repo gh/acme/widgets is not mirrored');
		assert.match(text, /Create it on Entire or mirror it there/);
		assert.match(text, /Entirely: Create Repository/);
		assert.match(text, /The CLI said: repo gh\/acme\/widgets is not mirrored/);
		assert.ok(!/nothing was found/i.test(text));
	});

	test('a missing context is said as the CLI resolving it', () => {
		const text = describeEmptyExperts(request, { login: 'alice' });
		assert.match(text, /Repository: the repository of this folder, as the CLI resolves it/);
	});
});

function service(cli: FakeAnalysisCli, branch: string | null = 'main'): ExpertsService {
	return new ExpertsService({ runner: cli.runner, workspaceRoot: () => cli.dir, timeoutSeconds: () => 20, limit: () => 6, branch: () => branch ?? undefined });
}

const QUESTION = 'who owns token refresh UNIQUE-QUESTION-7f3a';

suite('Experts: the service', () => {
	test('asks as the acting login with static output, the scope after the marker and the interactive viewer never', async () => {
		const cli = fakeAnalysisCli();
		const outcome = await service(cli).ask({ kind: 'scope', scope: 'src/payments' }, ALICE);
		assert.ok(outcome.kind === 'found');
		assert.strictEqual(outcome.entries.length, 2);
		assert.deepStrictEqual(outcome.context, { repository: 'gh/acme/widgets', branch: 'main', login: 'alice (login alice@us.auth.entire.io)', limit: 6 });
		const run = cli.modes('experts');
		assert.deepStrictEqual(run, [['experts', '--json', '--limit=6', '--branch=main', '--', 'src/payments']]);
		assert.ok(cli.calls().some(line => line.startsWith('alice@us.auth.entire.io|ACCESSIBLE=1|experts')));
		assert.ok(!cli.argvs().flat().includes('--tui'));
	});

	test('sends a question as one operand, redacts it from the record and keeps the body out', async () => {
		const cli = fakeAnalysisCli();
		await service(cli).ask({ kind: 'query', text: QUESTION }, ALICE);
		assert.deepStrictEqual(cli.modes('experts')[0].slice(-2), ['--', QUESTION]);
		for (const entry of cli.recorded) {
			assert.ok(!entry.invocation.args.some(arg => arg.includes('UNIQUE-QUESTION')), 'the question is not in the record');
			if (entry.invocation.args.includes('experts')) {
				assert.strictEqual(entry.bodies.stdout, undefined);
			}
		}
		const run = cli.recorded.find(entry => entry.invocation.args.includes('experts') && entry.invocation.args.includes('--'));
		assert.ok(run);
		assert.strictEqual(run.invocation.args[run.invocation.args.length - 1], REDACTED_OPERAND);
	});

	test('a question that looks like a flag stays an operand', async () => {
		const cli = fakeAnalysisCli();
		await service(cli).ask({ kind: 'query', text: '--staged --json' }, ALICE);
		const args = cli.modes('experts')[0];
		assert.deepStrictEqual(args.slice(args.indexOf('--')), ['--', '--staged --json']);
	});

	test('the staged lookup runs with the staged flag and no operand', async () => {
		const cli = fakeAnalysisCli();
		await service(cli).ask({ kind: 'staged' }, ALICE);
		assert.deepStrictEqual(cli.modes('experts')[0], ['experts', '--json', '--limit=6', '--branch=main', '--staged']);
	});

	test('an empty answer is empty, not a failure', async () => {
		const cli = fakeAnalysisCli({ outputs: { experts: '{"profiles":[]}' } });
		const outcome = await service(cli).ask({ kind: 'scope', scope: 'src' }, ALICE);
		assert.strictEqual(outcome.kind, 'empty');
	});

	test('a repository that is not mirrored is neither empty nor an ordinary failure', async () => {
		const cli = fakeAnalysisCli({ fail: { experts: 'Error: repository gh/acme/widgets is not mirrored on Entire' } });
		const outcome = await service(cli).ask({ kind: 'scope', scope: 'src' }, ALICE);
		assert.ok(outcome.kind === 'notMirrored');
		assert.match(outcome.cliText, /not mirrored/);
		assert.strictEqual(cli.modes('experts').length, 1, 'never asked again');
	});

	test('another failure is a failure and is not asked again', async () => {
		const cli = fakeAnalysisCli({ fail: { experts: 'connection reset by peer' } });
		const outcome = await service(cli).ask({ kind: 'scope', scope: 'src' }, ALICE);
		assert.ok(outcome.kind === 'failed' && /connection reset/.test(outcome.detail));
		assert.strictEqual(cli.modes('experts').length, 1);
	});

	test('an answer in a shape it cannot read is reported, and the raw reply is held for the explicit command only', async () => {
		const cli = fakeAnalysisCli({ outputs: { experts: '{"message":"hello"}' } });
		const source = service(cli);
		assert.strictEqual(source.lastReply(), undefined);
		const outcome = await source.ask({ kind: 'scope', scope: 'src' }, ALICE);
		assert.strictEqual(outcome.kind, 'unreadable');
		assert.strictEqual(source.lastReply(), '{"message":"hello"}');
		const notJson = fakeAnalysisCli({ outputs: { experts: 'plain words' } });
		assert.strictEqual((await service(notJson).ask({ kind: 'scope', scope: 'src' }, ALICE)).kind, 'unreadable');
	});

	test('a CLI whose help is the top-level help is unsupported, names experts and runs nothing', async () => {
		const cli = fakeAnalysisCli({ helps: { experts: null } });
		const outcome = await service(cli).ask({ kind: 'scope', scope: 'src' }, ALICE);
		assert.ok(outcome.kind === 'unsupported');
		assert.match(outcome.detail, /no 'experts' command/);
		assert.match(outcome.detail, /update the CLI/);
		assert.strictEqual(cli.calls().length, 0);
	});

	test('a help lacking the staged flag cannot run the staged lookup', async () => {
		const cli = fakeAnalysisCli({ helps: { experts: 'Usage:\n  entire experts [scope-or-query] [flags]\n\nFlags:\n      --json   Print JSON\n' } });
		assert.strictEqual((await service(cli).ask({ kind: 'staged' }, ALICE)).kind, 'unsupported');
		assert.strictEqual(cli.calls().length, 0);
	});

	test('says so when the CLI is missing', async () => {
		const cli = fakeAnalysisCli({ noCli: true });
		const outcome = await service(cli).ask({ kind: 'staged' }, ALICE);
		assert.ok(outcome.kind === 'noCli' && /not installed/.test(outcome.detail));
	});

	test('a lookup that takes too long is a timeout failure naming the setting', async () => {
		const cli = fakeAnalysisCli({ hang: ['experts'] });
		const source = new ExpertsService({ runner: cli.runner, workspaceRoot: () => cli.dir, timeoutSeconds: () => 1, limit: () => 6, branch: () => undefined });
		const outcome = await source.ask({ kind: 'scope', scope: 'src' }, ALICE);
		assert.ok(outcome.kind === 'failed' && /entirely\.expertsTimeout/.test(outcome.detail));
	});

	test('without a branch the CLI default is used', async () => {
		const cli = fakeAnalysisCli();
		const outcome = await service(cli, null).ask({ kind: 'scope', scope: 'src' }, ALICE);
		assert.ok(outcome.kind === 'found' && outcome.context.branch === undefined);
		assert.ok(!cli.modes('experts')[0].some(arg => arg.startsWith('--branch')));
	});
});

class FakeExpertsUi implements ExpertsUi {
	readonly shown: { kind: GeneratedKind; text: string }[] = [];
	readonly warnings: string[] = [];
	readonly progress: string[] = [];
	constructor(private readonly script: { question?: string | undefined; path?: string | undefined } = {}) {}
	async askQuestion(): Promise<string | undefined> {
		return this.script.question;
	}
	async askPath(): Promise<string | undefined> {
		return this.script.path;
	}
	async show(kind: GeneratedKind, text: string): Promise<void> {
		this.shown.push({ kind, text });
	}
	async warn(message: string): Promise<void> {
		this.warnings.push(message);
	}
	withProgress<T>(title: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
		this.progress.push(title);
		return work(new AbortController().signal);
	}
}

function flow(options: FakeAnalysisOptions, ui: FakeExpertsUi, acting: typeof ALICE | null = ALICE) {
	const cli = fakeAnalysisCli(options);
	const deps = { source: service(cli), ui, acting: async () => acting ?? undefined, workspaceRoot: () => cli.dir };
	return { cli, deps };
}

suite('Experts: the commands', () => {
	test('a file is asked as a workspace-relative path, with the servers named in the progress and the result', async () => {
		const ui = new FakeExpertsUi();
		const { cli, deps } = flow({}, ui);
		assert.strictEqual(await expertsForPath(deps, path.join(cli.dir, 'src', 'payments', 'a.ts')), 'shown');
		assert.deepStrictEqual(cli.modes('experts')[0].slice(-2), ['--', 'src/payments/a.ts']);
		assert.match(ui.progress[0], /Entire's servers/);
		assert.strictEqual(ui.shown[0].kind, 'experts');
		assert.match(ui.shown[0].text.replace(/\\(.)/g, '$1'), /Scope: src\/payments\/a\.ts/);
		assert.match(ui.shown[0].text.replace(/\\(.)/g, '$1'), /Repository: gh\/acme\/widgets/);
		assert.match(ui.shown[0].text.replace(/\\(.)/g, '$1'), /Asked as: alice \(login alice@us\.auth\.entire\.io\), on Entire/);
	});

	test('the workspace folder itself is asked as the dot scope, and a path outside is refused', async () => {
		const ui = new FakeExpertsUi();
		const { cli, deps } = flow({}, ui);
		assert.strictEqual(await expertsForPath(deps, cli.dir), 'shown');
		assert.deepStrictEqual(cli.modes('experts')[0].slice(-2), ['--', '.']);
		assert.strictEqual(await expertsForPath(deps, path.join(path.dirname(cli.dir), 'elsewhere', 'x.ts')), 'failed');
		assert.match(ui.warnings[0], /outside the workspace/);
		assert.strictEqual(cli.modes('experts').length, 1);
	});

	test('with no file given it asks for a path, and cancelling runs nothing', async () => {
		const ui = new FakeExpertsUi({ path: undefined });
		const { cli, deps } = flow({}, ui);
		assert.strictEqual(await expertsForPath(deps), 'cancelled');
		assert.strictEqual(cli.calls().length, 0);
	});

	test('a typed question is one operand and appears in no document', async () => {
		const ui = new FakeExpertsUi({ question: `  ${QUESTION}  ` });
		const { cli, deps } = flow({}, ui);
		assert.strictEqual(await expertsAsk(deps), 'shown');
		assert.deepStrictEqual(cli.modes('experts')[0].slice(-2), ['--', QUESTION]);
		assert.ok(!ui.shown[0].text.includes('UNIQUE-QUESTION'));
		assert.ok(ui.progress.every(title => !title.includes('UNIQUE-QUESTION')));
	});

	test('an empty or dismissed question runs nothing', async () => {
		for (const question of [undefined, '   ']) {
			const { cli, deps } = flow({}, new FakeExpertsUi({ question }));
			assert.strictEqual(await expertsAsk(deps), 'cancelled');
			assert.strictEqual(cli.calls().length, 0);
		}
	});

	test('the staged files are asked with the staged flag and the document names them', async () => {
		const ui = new FakeExpertsUi();
		const { cli, deps } = flow({}, ui);
		assert.strictEqual(await expertsStaged(deps), 'shown');
		assert.ok(cli.modes('experts')[0].includes('--staged'));
		assert.match(ui.shown[0].text, /Scope: the staged files/);
	});

	test('an empty answer opens a document that says nothing was found and mentions the push delay', async () => {
		const ui = new FakeExpertsUi();
		const { deps } = flow({ outputs: { experts: '[]' } }, ui);
		assert.strictEqual(await expertsStaged(deps), 'empty');
		assert.match(ui.shown[0].text, /Nothing found/);
		assert.match(ui.shown[0].text, /a couple of minutes/);
	});

	test('a repository that is not mirrored is a message, not an empty document', async () => {
		const ui = new FakeExpertsUi();
		const { deps } = flow({ fail: { experts: 'this repository is not mirrored' } }, ui);
		assert.strictEqual(await expertsStaged(deps), 'failed');
		assert.deepStrictEqual(ui.shown, []);
		assert.match(ui.warnings[0], /Create it on Entire or mirror it there/);
	});

	test('a failure is named, nothing is shown and it is not asked again', async () => {
		const ui = new FakeExpertsUi();
		const { cli, deps } = flow({ fail: { experts: 'server error 500' } }, ui);
		assert.strictEqual(await expertsStaged(deps), 'failed');
		assert.deepStrictEqual(ui.shown, []);
		assert.match(ui.warnings[0], /server error 500.*not asked again/);
		assert.strictEqual(cli.modes('experts').length, 1);
	});

	test('an unreadable answer says so, and the raw reply opens only through its own command', async () => {
		const ui = new FakeExpertsUi();
		const { deps } = flow({ outputs: { experts: '{"message":"hello"}' } }, ui);
		assert.strictEqual(await showRawReply(deps), false);
		assert.match(ui.warnings[0], /no experts reply/i);
		assert.strictEqual(await expertsStaged(deps), 'failed');
		assert.strictEqual(ui.warnings[1], UNREADABLE_EXPERTS);
		assert.deepStrictEqual(ui.shown, []);
		assert.strictEqual(await showRawReply(deps), true);
		assert.deepStrictEqual(ui.shown, [{ kind: 'expertsRaw', text: '{"message":"hello"}' }]);
	});

	test('refuses without a login and a CLI without experts gets an update message', async () => {
		const noLogin = new FakeExpertsUi();
		const first = flow({}, noLogin, null);
		assert.strictEqual(await expertsStaged(first.deps), 'failed');
		assert.match(noLogin.warnings[0], /Sign in first/);
		assert.strictEqual(first.cli.calls().length, 0);

		const old = new FakeExpertsUi();
		const second = flow({ helps: { experts: null } }, old);
		assert.strictEqual(await expertsStaged(second.deps), 'failed');
		assert.match(old.warnings[0], /'experts'.*update the CLI/);
		assert.strictEqual(second.cli.calls().length, 0);
	});

	test('says so when the CLI is missing and runs nothing', async () => {
		const ui = new FakeExpertsUi();
		const { cli, deps } = flow({ noCli: true }, ui);
		assert.strictEqual(await expertsStaged(deps), 'failed');
		assert.match(ui.warnings[0], /not installed/);
		assert.strictEqual(cli.calls().length, 0);
	});
});
