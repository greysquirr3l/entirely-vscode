import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
	BUNDLE_NOTICE,
	RAW_BUNDLE_NOTICE,
	checkBundlePath,
	checkTextPath,
	confirmBundleWrite,
	defaultBundleName,
	describeBundleOutcome,
	isZipSignature,
	type PathFacts,
} from '../lib/entire';
import { writeDiagnosticBundle, type BundleDependencies } from '../commands/doctorBundle';
import { inspectSaveTarget, verifyBundle } from '../services/bundleFile';
import { DoctorDepthService } from '../services/doctorDepth';
import { ALICE } from './support/activityCli';
import { fakeDoctorCli, type FakeDoctorCli, type FakeDoctorOptions } from './support/doctorCli';
import { harness, type HarnessOptions } from './support/depthHarness';
import type { DepthScript } from './support/depthUi';
import { makeTempDir } from './support/tempDir';

const FACTS: PathFacts = { exists: false, isLink: false, isDirectory: false, parentExists: true, parentIsLink: false, workspaceRoots: ['/work/repo'] };

/** Reads a regular file through one handle that refuses to follow a link. */
function readRegularFile(file: string): Buffer {
	const handle = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);

	try {
		if (!fs.fstatSync(handle).isFile()) {
			throw new Error(`${file} is not a regular file`);
		}

		return fs.readFileSync(handle);
	} finally {
		fs.closeSync(handle);
	}
}

suite('Doctor bundle: path checks', () => {
	test('accepts an absolute .zip in an existing folder', () => {
		assert.deepStrictEqual(checkBundlePath('/tmp/out/bundle.zip', FACTS), { ok: true, overwrites: false, insideWorkspace: false });
		assert.deepStrictEqual(checkBundlePath('/tmp/out/BUNDLE.ZIP', { ...FACTS, exists: true }), { ok: true, overwrites: true, insideWorkspace: false });
	});

	test('refuses a relative path, a name that is not .zip, a ".." segment and a NUL, with the reason', () => {
		const reason = (file: string, facts: PathFacts = FACTS): string => {
			const result = checkBundlePath(file, facts);
			assert.ok(!result.ok, `${file} should be refused`);
			return result.reason;
		};
		assert.match(reason('bundle.zip'), /not absolute/);
		assert.match(reason('/tmp/out/bundle.txt'), /must end in \.zip/);
		assert.match(reason('/tmp/a/../b.zip'), /"\.\."/);
		assert.match(reason('/tmp/a\0b.zip'), /NUL/);
		assert.match(reason('/tmp/missing/b.zip', { ...FACTS, parentExists: false }), /does not exist/);
		assert.match(reason('/tmp/link/b.zip', { ...FACTS, parentIsLink: true }), /symbolic link/);
		assert.match(reason('/tmp/out/b.zip', { ...FACTS, exists: true, isLink: true }), /symbolic link/);
		assert.match(reason('/tmp/out/b.zip', { ...FACTS, exists: true, isDirectory: true }), /folder/);
		assert.match(reason('/work/repo/.git/b.zip'), /\.git or \.entire/);
		assert.match(reason('/work/repo/.entire/logs/b.zip'), /\.git or \.entire/);
		assert.match(reason('/work/repo/.ENTIRE/b.zip'), /\.git or \.entire/);
	});

	test('says when the path is inside the workspace, and the confirmation carries the commit warning', () => {
		const inside = checkBundlePath('/work/repo/out/b.zip', FACTS);
		assert.ok(inside.ok && inside.insideWorkspace);
		const question = confirmBundleWrite('/work/repo/out/b.zip', inside, false);
		assert.ok(question);
		assert.match(question.detail, /inside the workspace, so git may offer to commit the archive/);
		const outside = checkBundlePath('/elsewhere/b.zip', FACTS);
		assert.ok(outside.ok && !outside.insideWorkspace);
		assert.strictEqual(confirmBundleWrite('/elsewhere/b.zip', outside, false), undefined);
		assert.ok(checkBundlePath('/work/repository/b.zip', FACTS).ok);
		const sibling = checkBundlePath('/work/repository/b.zip', FACTS);
		assert.ok(sibling.ok && !sibling.insideWorkspace, 'a folder that only shares a prefix is not inside');
	});

	test('names the file in the replace question and offers only Replace', () => {
		const replace = checkBundlePath('/tmp/out/b.zip', { ...FACTS, exists: true });
		assert.ok(replace.ok);
		const question = confirmBundleWrite('/tmp/out/b.zip', replace, false);
		assert.deepStrictEqual([question?.message, question?.action], ['Replace /tmp/out/b.zip?', 'Replace']);
		assert.match(question?.detail ?? '', /current contents will be lost/);
	});

	test('a text path allows .txt and .log and nothing else', () => {
		assert.ok(checkTextPath('/tmp/a.txt', FACTS).ok);
		assert.ok(checkTextPath('/tmp/a.log', FACTS).ok);
		assert.ok(!checkTextPath('/tmp/a.zip', FACTS).ok);
	});

	test('dates the default name in UTC and reads zip signatures', () => {
		assert.strictEqual(defaultBundleName(new Date('2026-10-30T23:59:59Z')), 'entire-diagnostics-2026-10-30.zip');
		assert.ok(isZipSignature(Buffer.from('PK\x03\x04rest', 'latin1')));
		assert.ok(isZipSignature(Buffer.from('PK\x05\x06', 'latin1')));
		assert.ok(!isZipSignature(Buffer.from('PK\x01\x02', 'latin1')));
		assert.ok(!isZipSignature(Buffer.from('PK', 'latin1')));
	});

	test('reads links with lstat so a link is seen as a link', async () => {
		const folder = makeTempDir('entire-links-');
		const real = path.join(folder, 'real');
		fs.mkdirSync(real);
		fs.symlinkSync(real, path.join(folder, 'linked'));
		fs.writeFileSync(path.join(folder, 'target.zip'), 'x');
		fs.symlinkSync(path.join(folder, 'target.zip'), path.join(real, 'alias.zip'));

		const inLink = await inspectSaveTarget(path.join(folder, 'linked', 'b.zip'), []);
		assert.strictEqual(inLink.parentIsLink, true);
		assert.ok(!checkBundlePath(path.join(folder, 'linked', 'b.zip'), inLink).ok);

		const alias = await inspectSaveTarget(path.join(real, 'alias.zip'), []);
		assert.deepStrictEqual([alias.exists, alias.isLink], [true, true]);
		assert.ok(!checkBundlePath(path.join(real, 'alias.zip'), alias).ok);

		const missing = await inspectSaveTarget(path.join(folder, 'nope', 'b.zip'), []);
		assert.strictEqual(missing.parentExists, false);
		const plain = await inspectSaveTarget(path.join(real, 'new.zip'), []);
		assert.deepStrictEqual([plain.exists, plain.parentExists, plain.parentIsLink], [false, true, false]);
	});
});

function setup(options: FakeDoctorOptions = {}, script: DepthScript = {}, harnessOptions: HarnessOptions = {}) {
	const cli = fakeDoctorCli(options);
	const folder = makeTempDir('entire-bundle-');
	const built = harness(cli, script, harnessOptions);
	const deps: BundleDependencies = { service: built.service, files: built.files, ui: built.ui, acting: () => Promise.resolve(ALICE) };
	return { cli, folder, deps, ui: built.ui };
}

function bundleCalls(cli: FakeDoctorCli): string[] {
	return cli.callsTo('doctor bundle');
}

suite('Doctor bundle: writing to a chosen path', () => {
	test('shows the notice first, writes where the person chose as the acting login, reads it back, and offers Reveal and Copy Path', async () => {
		const folder = makeTempDir('entire-bundle-');
		const target = path.join(folder, 'diag.zip');
		const { cli, deps, ui } = setup({}, { paths: [target], choose: (_m, actions) => actions[0] });
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'written');

		assert.deepStrictEqual(ui.events, ['confirm:Write a diagnostic bundle?', 'path', 'progress:Writing the bundle…']);
		assert.deepStrictEqual(ui.confirmations[0], BUNDLE_NOTICE);
		assert.match(ui.confirmations[0].detail, /logs, your Entire settings files and a snapshot of git status, history and remotes/);
		assert.match(ui.confirmations[0].detail, /redacted by pattern; prompts, file paths and commit messages/);
		const calls = bundleCalls(cli);
		assert.strictEqual(calls.length, 1);
		assert.match(calls[0], new RegExp(`^${ALICE.name}\\|doctor bundle --out ${path.dirname(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.entirely-[0-9a-f]{16}\\.zip$`));
		assert.deepStrictEqual(fs.readdirSync(path.dirname(target)), ['diag.zip'], 'no temporary file remains');
		assert.ok(fs.readFileSync(target).subarray(0, 4).equals(Buffer.from('PK\x03\x04', 'latin1')));

		const done = ui.notices.at(-1);
		assert.match(done?.message ?? '', /was written to .*diag\.zip \(\d+ B\)\. Secrets are redacted by pattern/);
		assert.deepStrictEqual(done?.actions, ['Reveal in File Explorer', 'Copy Path']);
		assert.deepStrictEqual(ui.revealed, [target]);
		assert.deepStrictEqual(ui.opened, [], 'nothing is opened in the editor');
		assert.deepStrictEqual(ui.documents, []);
	});

	test('Copy Path copies the path', async () => {
		const folder = makeTempDir('entire-bundle-');
		const target = path.join(folder, 'diag.zip');
		const { deps, ui } = setup({}, { paths: [target], choose: (_m, actions) => actions[1] });
		await writeDiagnosticBundle(deps, { raw: false });
		assert.deepStrictEqual(ui.copied, [target]);
		assert.deepStrictEqual(ui.opened, []);
	});

	test('declining the notice runs nothing and asks for no path', async () => {
		const { cli, deps, ui } = setup({}, { confirms: [false] });
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'declined');
		assert.deepStrictEqual(ui.events, ['confirm:Write a diagnostic bundle?']);
		assert.deepStrictEqual(cli.calls(), []);
	});

	test('closing the save dialog runs nothing', async () => {
		const { cli, deps } = setup({}, { paths: [undefined] });
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'declined');
		assert.deepStrictEqual(cli.calls(), []);
	});

	test('keeps the chosen path out of the invocation record and the output out of the bodies', async () => {
		const folder = makeTempDir('entire-bundle-');
		const target = path.join(folder, 'private-name.zip');
		const { cli, deps } = setup({}, { paths: [target] });
		await writeDiagnosticBundle(deps, { raw: false });
		const run = cli.recorded.find(entry => entry.invocation.args.includes('bundle') && !entry.invocation.args.includes('agent-help'));
		assert.ok(run);
		assert.deepStrictEqual(run.invocation.args.slice(-3), ['bundle', '--out', '<redacted>']);
		assert.ok(!JSON.stringify(run.invocation).includes('private-name'));
		assert.ok(!JSON.stringify(run.invocation).includes('.entirely-'), 'the temporary path is hidden too');
		assert.strictEqual(run.bodies.stdout, undefined);
	});

	test('a path inside the workspace is allowed after a confirmation that carries the commit warning', async () => {
		const cli = fakeDoctorCli();
		const target = path.join(cli.repo, 'diag.zip');
		const built = harness(cli, { paths: [target] });
		const deps: BundleDependencies = { service: built.service, files: built.files, ui: built.ui, acting: () => Promise.resolve(ALICE) };
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'written');
		assert.strictEqual(built.ui.confirmations.length, 2);
		assert.match(built.ui.confirmations[1].detail, /git may offer to commit the archive/);
		assert.strictEqual(built.ui.confirmations[1].action, 'Write the bundle');
	});

	test('bundle-overwrite: replacing a file is confirmed by name, and declining leaves it byte for byte', async () => {
		const folder = makeTempDir('entire-bundle-');
		const target = path.join(folder, 'diag.zip');
		fs.writeFileSync(target, 'old contents');
		const { cli, deps, ui } = setup({}, { paths: [target, target], confirms: [true, false, true, true] });
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'declined');
		assert.strictEqual(fs.readFileSync(target, 'utf8'), 'old contents');
		assert.deepStrictEqual(cli.calls(), []);
		assert.strictEqual(ui.confirmations[1].message, `Replace ${target}?`);
		assert.strictEqual(ui.confirmations[1].action, 'Replace');

		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'written');
		assert.ok(fs.readFileSync(target).subarray(0, 2).toString() === 'PK');
		assert.strictEqual(bundleCalls(cli).length, 1);
	});

	test('bundle-bad-path: each refused path is explained and the CLI is not run', async () => {
		const folder = makeTempDir('entire-bundle-');
		const real = path.join(folder, 'real');
		fs.mkdirSync(real);
		fs.symlinkSync(real, path.join(folder, 'linked'));
		fs.writeFileSync(path.join(folder, 'target.zip'), 'x');
		fs.symlinkSync(path.join(folder, 'target.zip'), path.join(real, 'alias.zip'));
		const cli = fakeDoctorCli();
		fs.mkdirSync(path.join(cli.repo, '.entire', 'logs'), { recursive: true });
		const paths = [
			'bundle.zip',
			path.join(folder, 'bundle.txt'),
			`${folder}/a/../b.zip`,
			`${folder}/a\0b.zip`,
			path.join(folder, 'missing', 'b.zip'),
			path.join(folder, 'linked', 'b.zip'),
			path.join(real, 'alias.zip'),
			path.join(cli.repo, '.git', 'x.zip'),
			path.join(cli.repo, '.entire', 'logs', 'x.zip'),
		];
		const built = harness(cli, { paths: [...paths] });
		const deps: BundleDependencies = { service: built.service, files: built.files, ui: built.ui, acting: () => Promise.resolve(ALICE) };
		for (const file of paths) {
			assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'refused', file);
			assert.strictEqual(bundleCalls(cli).length, 0, file);
		}
		const refusals = built.ui.notices.filter(notice => /was not written: /.test(notice.message));
		assert.strictEqual(refusals.length, paths.length);
		assert.ok(refusals.every(notice => /\.$/.test(notice.message)));
		assert.deepStrictEqual(fs.readdirSync(path.join(cli.repo, '.entire', 'logs')), []);
		assert.ok(!fs.existsSync(path.join(cli.repo, '.git', 'x.zip')));
	});
});

suite('Doctor bundle: reading the file back', () => {
	const target = (): string => path.join(makeTempDir('entire-bundle-'), 'diag.zip');

	test('a CLI that exits 0 without writing is unconfirmed', async () => {
		const file = target();
		const { deps, ui } = setup({ bundle: 'none' }, { paths: [file] });
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'unconfirmed');
		assert.match(ui.notices.at(-1)?.message ?? '', /unconfirmed: the CLI finished but no archive was found where it was asked to write it/);
		assert.deepStrictEqual(ui.notices.at(-1)?.actions, []);
	});

	test('a file that is not a zip archive is unconfirmed, and an empty file too', async () => {
		const junk = setup({ bundle: 'junk' }, { paths: [target()] });
		assert.strictEqual(await writeDiagnosticBundle(junk.deps, { raw: false }), 'unconfirmed');
		assert.match(junk.ui.notices.at(-1)?.message ?? '', /is not a zip archive/);
		const empty = setup({ bundle: 'empty-file' }, { paths: [target()] });
		assert.strictEqual(await writeDiagnosticBundle(empty.deps, { raw: false }), 'unconfirmed');
		assert.match(empty.ui.notices.at(-1)?.message ?? '', /is empty/);
	});

	test('an empty archive is accepted', async () => {
		const { deps } = setup({ bundle: 'empty-zip' }, { paths: [target()] });
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'written');
	});

	test('a link is not a regular file', async () => {
		const folder = makeTempDir('entire-bundle-');
		fs.writeFileSync(path.join(folder, 'real.zip'), 'PK\x03\x04');
		fs.symlinkSync(path.join(folder, 'real.zip'), path.join(folder, 'link.zip'));
		assert.deepStrictEqual(await verifyBundle(path.join(folder, 'link.zip')), { kind: 'not-a-file' });
		assert.deepStrictEqual(await verifyBundle(path.join(folder, 'missing.zip')), { kind: 'missing' });
		assert.deepStrictEqual(await verifyBundle(path.join(folder, 'real.zip')), { kind: 'zip', bytes: 4 });
	});

	test('a CLI that refuses because a redaction rule could not be loaded is a failure with its detail and no Reveal', async () => {
		const { cli, deps, ui } = setup({ fail: { bundle: 'redaction rules could not be loaded; no bundle was written' } }, { paths: [target()] });
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'failed');
		const last = ui.notices.at(-1);
		assert.match(last?.message ?? '', /was not written: redaction rules could not be loaded; no bundle was written\./);
		assert.deepStrictEqual(last?.actions, []);
		assert.strictEqual(bundleCalls(cli).length, 1, 'not retried');
	});

	test('cancelling kills the run and is reported as cancelled', async () => {
		const { cli, deps, ui } = setup({ slow: { bundle: 5 } }, { paths: [target()], cancelAfterMs: 400 });
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'cancelled');
		assert.match(ui.notices.at(-1)?.message ?? '', /was cancelled\. Nothing was written/);
		assert.strictEqual(bundleCalls(cli).length, 1);
	});

	test('a timeout is a failure', async function () {
		this.timeout(15_000);
		const { deps, ui } = setup({ slow: { bundle: 5 } }, { paths: [target()] }, { bundleSeconds: 1 });
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'failed');
		assert.match(ui.notices.at(-1)?.message ?? '', /did not finish/);
	});

	test('describes each outcome', () => {
		assert.match(describeBundleOutcome({ kind: 'written', file: '/a.zip', bytes: 5000, raw: true }), /unredacted bundle was written to \/a\.zip \(5 KB\)/);
		assert.match(describeBundleOutcome({ kind: 'written', file: '/a.zip', bytes: 10, raw: false }), /\(10 B\)/);
	});
});

suite('Doctor bundle: the unredacted bundle', () => {
	test('is refused, with nothing run, when the help does not describe the raw flag', async () => {
		const noRaw = 'Flags:\n  -o, --out string   Path to write the bundle archive\n';
		const { cli, deps, ui } = setup({ helps: { doctor_bundle: noRaw } }, { paths: [path.join(makeTempDir('entire-bundle-'), 'a.zip')] });
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: true }), 'unavailable');
		assert.match(ui.notices[0].message, /does not describe an unredacted bundle/);
		assert.deepStrictEqual(ui.confirmations, []);
		assert.deepStrictEqual(cli.calls(), []);
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'written', 'the redacted bundle is still offered');
	});

	test('has its own strict modal, and the raw flag is passed only after it is accepted', async () => {
		const target = path.join(makeTempDir('entire-bundle-'), 'raw.zip');
		const { cli, deps, ui } = setup({}, { paths: [target] });
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: true }), 'written');
		assert.deepStrictEqual(ui.confirmations[0], RAW_BUNDLE_NOTICE);
		assert.match(ui.confirmations[0].message, /UNREDACTED/);
		assert.match(ui.confirmations[0].detail, /raw log lines, settings and git output, including any API keys, tokens or credentials/);
		assert.strictEqual(ui.confirmations[0].action, 'Write unredacted bundle');
		assert.match(bundleCalls(cli)[0], /doctor bundle --out \S+\.entirely-[0-9a-f]{16}\.zip --raw$/);
		assert.match(ui.notices.at(-1)?.message ?? '', /unredacted bundle was written/);
	});

	test('declining the modal runs nothing', async () => {
		const { cli, deps, ui } = setup({}, { confirms: [false], paths: [path.join(makeTempDir('entire-bundle-'), 'raw.zip')] });
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: true }), 'declined');
		assert.deepStrictEqual(ui.events, ['confirm:Write an UNREDACTED bundle?']);
		assert.deepStrictEqual(cli.calls(), []);
	});

	test('the default command never passes the raw flag', async () => {
		const { cli, deps } = setup({}, { paths: [path.join(makeTempDir('entire-bundle-'), 'a.zip')] });
		await writeDiagnosticBundle(deps, { raw: false });
		assert.ok(!bundleCalls(cli).some(line => line.includes('raw')));
	});
});

suite('Doctor bundle: the chosen path is only touched by a finished archive', () => {
	const setupIn = (options: FakeDoctorOptions, name = 'diag.zip', existing?: string) => {
		const folder = makeTempDir('entire-bundle-');
		const target = path.join(folder, name);
		if (existing !== undefined) {
			fs.writeFileSync(target, existing);
		}
		return { ...setup(options, { paths: [target, target], confirms: [true, true] }), folder, target };
	};

	test('a CLI that writes junk and then fails leaves the folder empty and an existing file byte for byte', async () => {
		const fresh = setupIn({ bundle: 'junk-fail' });
		assert.strictEqual(await writeDiagnosticBundle(fresh.deps, { raw: false }), 'failed');
		assert.deepStrictEqual(fs.readdirSync(fresh.folder), []);

		const existing = setupIn({ bundle: 'junk-fail' }, 'diag.zip', 'precious');
		assert.strictEqual(await writeDiagnosticBundle(existing.deps, { raw: false }), 'failed');
		assert.strictEqual(fs.readFileSync(existing.target, 'utf8'), 'precious');
		assert.deepStrictEqual(fs.readdirSync(existing.folder), ['diag.zip']);
	});

	test('cancelling mid-run removes what the CLI had written and leaves the target alone', async () => {
		const folder = makeTempDir('entire-bundle-');
		const target = path.join(folder, 'diag.zip');
		fs.writeFileSync(target, 'precious');
		const cli = fakeDoctorCli({ bundle: 'zip-then-sleep' });
		const built = harness(cli, { paths: [target], cancelAfterMs: 600 });
		const deps: BundleDependencies = { service: built.service, files: built.files, ui: built.ui, acting: () => Promise.resolve(ALICE) };
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'cancelled');
		assert.strictEqual(fs.readFileSync(target, 'utf8'), 'precious');
		assert.deepStrictEqual(fs.readdirSync(folder), ['diag.zip']);
	});

	test('a confirmed replacement swaps the file in one rename', async () => {
		const run = setupIn({}, 'diag.zip', 'old');
		assert.strictEqual(await writeDiagnosticBundle(run.deps, { raw: false }), 'written');
		assert.strictEqual(fs.readFileSync(run.target).subarray(0, 2).toString(), 'PK');
		assert.deepStrictEqual(fs.readdirSync(run.folder), ['diag.zip']);
	});

	test('a file that appears at the target meanwhile is not clobbered when replacing was not confirmed', async () => {
		const folder = makeTempDir('entire-bundle-');
		const target = path.join(folder, 'diag.zip');
		const cli = fakeDoctorCli({ plant: { path: target, kind: 'file' } });
		const built = harness(cli, { paths: [target] });
		const deps: BundleDependencies = { service: built.service, files: built.files, ui: built.ui, acting: () => Promise.resolve(ALICE) };
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'failed');
		assert.strictEqual(fs.readFileSync(target, 'utf8').trim(), 'planted');
		assert.deepStrictEqual(fs.readdirSync(folder), ['diag.zip']);
		assert.match(built.ui.notices.at(-1)?.message ?? '', /a file appeared at .* so it was not replaced/);
	});

	test('a link planted at the target between the check and the move is replaced, not followed', async () => {
		const folder = makeTempDir('entire-bundle-');
		const target = path.join(folder, 'diag.zip');
		fs.writeFileSync(target, 'old');
		const cli = fakeDoctorCli({ plant: { path: target, kind: 'link' } });
		const decoy = path.join(cli.dir, 'state', 'out', 'plantpath');
		const decoyBefore = fs.readFileSync(decoy, 'utf8');
		const built = harness(cli, { paths: [target], confirms: [true, true] });
		const deps: BundleDependencies = { service: built.service, files: built.files, ui: built.ui, acting: () => Promise.resolve(ALICE) };
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'written');
		// Opening without following links throws for a link, so reading from this one
		// handle proves the target is a regular file with no separate check first.
		assert.strictEqual(readRegularFile(target).subarray(0, 2).toString(), 'PK');
		assert.strictEqual(fs.readFileSync(decoy, 'utf8'), decoyBefore, 'what the link pointed at was not written through');
	});

	test('a link at the target with replacing not confirmed is never followed either', async () => {
		const folder = makeTempDir('entire-bundle-');
		const target = path.join(folder, 'diag.zip');
		const cli = fakeDoctorCli({ plant: { path: target, kind: 'link' } });
		const stateFile = path.join(cli.dir, 'state', 'out', 'plantpath');
		const before = fs.readFileSync(stateFile, 'utf8');
		const built = harness(cli, { paths: [target] });
		const deps: BundleDependencies = { service: built.service, files: built.files, ui: built.ui, acting: () => Promise.resolve(ALICE) };
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'failed');
		assert.ok(fs.lstatSync(target).isSymbolicLink());
		assert.strictEqual(fs.readFileSync(stateFile, 'utf8'), before, 'what the link points at was not written through');
	});

	test('an archive that fails the check is removed and the target is untouched', async () => {
		const run = setupIn({ bundle: 'junk' }, 'diag.zip', 'precious');
		assert.strictEqual(await writeDiagnosticBundle(run.deps, { raw: false }), 'unconfirmed');
		assert.strictEqual(fs.readFileSync(run.target, 'utf8'), 'precious');
		assert.deepStrictEqual(fs.readdirSync(run.folder), ['diag.zip']);
		assert.match(run.ui.notices.at(-1)?.message ?? '', /Nothing was written to .*diag\.zip, and nothing there was changed/);
	});

	test('the path is checked again just before the write, and a change aborts it', async () => {
		const cli = fakeDoctorCli();
		const second = makeTempDir('entire-bundle-');
		const target2 = path.join(second, 'diag.zip');
		const built2 = harness(cli, { paths: [target2] });
		let reads = 0;
		const deps2: BundleDependencies = {
			service: built2.service,
			files: built2.files,
			ui: built2.ui,
			// the login lookup is the last await before the re-check, so the file appears there
			acting: () => {
				reads++;
				fs.writeFileSync(target2, 'appeared late');
				return Promise.resolve(ALICE);
			},
		};
		assert.strictEqual(await writeDiagnosticBundle(deps2, { raw: false }), 'refused');
		assert.strictEqual(reads, 1);
		assert.strictEqual(fs.readFileSync(target2, 'utf8'), 'appeared late');
		assert.strictEqual(bundleCalls(cli).length, 0);
		assert.match(built2.ui.notices.at(-1)?.message ?? '', /path changed while you were deciding/);
	});
});

suite('Doctor bundle: the temporary file and the move', () => {
	test('a link at the temporary name is not a file: nothing is placed, the link is removed, the target is untouched', async () => {
		const folder = makeTempDir('entire-bundle-');
		const target = path.join(folder, 'diag.zip');
		fs.writeFileSync(target, 'precious');
		const cli = fakeDoctorCli({ bundle: 'link-at-out' });
		const decoy = path.join(cli.dir, 'state', 'out', 'plantpath');
		const built = harness(cli, { paths: [target], confirms: [true, true] });
		const deps: BundleDependencies = { service: built.service, files: built.files, ui: built.ui, acting: () => Promise.resolve(ALICE) };
		assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'unconfirmed');
		assert.match(built.ui.notices.at(-1)?.message ?? '', /not a regular file/);
		assert.strictEqual(fs.readFileSync(target, 'utf8'), 'precious');
		assert.deepStrictEqual(fs.readdirSync(folder), ['diag.zip']);
		assert.ok(fs.existsSync(decoy), 'what the link pointed at is still there');
	});

	for (const code of ['EPERM', 'ENOTSUP']) {
		test(`a link that fails with ${code} discards the temporary file, leaves the target, and says so`, async () => {
			const folder = makeTempDir('entire-bundle-');
			const target = path.join(folder, 'diag.zip');
			const cli = fakeDoctorCli();
			const built = harness(cli, { paths: [target] });
			const service = new DoctorDepthService({
				runner: cli.runner,
				workspaceRoot: () => cli.repo,
				logLines: () => 200,
				readTimeoutSeconds: () => 20,
				bundleTimeoutSeconds: () => 20,
				link: () => Promise.reject(Object.assign(new Error(`${code}: operation not supported`), { code })),
			});
			const deps: BundleDependencies = { service, files: built.files, ui: built.ui, acting: () => Promise.resolve(ALICE) };
			assert.strictEqual(await writeDiagnosticBundle(deps, { raw: false }), 'failed');
			assert.match(built.ui.notices.at(-1)?.message ?? '', new RegExp(`could not be placed at .*diag\\.zip \\(${code}`));
			assert.deepStrictEqual(fs.readdirSync(folder), []);
			assert.deepStrictEqual(built.ui.notices.at(-1)?.actions, []);
		});
	}
});
