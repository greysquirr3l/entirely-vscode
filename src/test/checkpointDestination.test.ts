import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { EntireSettings, WorkspaceStatus } from '../lib/entire';
import {
	inspectCheckpointDestination,
	renderCheckpointDestination,
} from '../services/checkpointDestination';
import { CliLocator } from '../services/cli/locator';
import { CliRunner } from '../services/cli/runner';

/** A tracked workspace whose checkpoints go to a repository of their own. */
const DEDICATED_STATUS = {
	enabled: true,
	agents: ['Copilot CLI'],
	active_sessions: [],
	agent_help: 'entire agent-help',
	checkpoint_sync_remote: 'greysquirr3l/entirely-vscode-checkpoints',
	checkpoint_sync_remote_source: 'dedicated',
};

/** The workspace's own repository, as the CLI names it. */
const MIRROR_REPO = {
	repo: '/gh/greysquirr3l/entirely-vscode',
	private: false,
	status: 'ready',
};

/**
 * A fake CLI that answers the commands the extension uses.
 *
 * The `mirror` case is the one that matters: it answers with the
 * repositories the login can reach, which is what decides whether Entire
 * can read a checkpoint repository.
 */
function cliBody(status: string, visible: string): string {
	return [
		'case "$1" in',
		'\tversion) echo "entire 0.12.2" ;;',
		`\tstatus) echo '${status}' ;;`,
		'\trepo)',
		'\t\tcase "$2" in',
		`\t\t\tview) echo '${JSON.stringify(MIRROR_REPO)}' ;;`,
		`\t\t\tmirror) echo '${visible}' ;;`,
		'\t\t\t*) echo "unknown subcommand" >&2; exit 2 ;;',
		'\t\tesac',
		'\t\t;;',
		'\t*) echo "unknown command" >&2; exit 2 ;;',
		'esac',
	].join('\n');
}

/** A runner bound to a fake CLI. */
function runnerFor(body: string): CliRunner {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'entire-destination-home-'));
	const bin = path.join(home, '.local', 'bin');
	fs.mkdirSync(bin, { recursive: true });

	const file = path.join(bin, 'entire');
	fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, 'utf8');
	fs.chmodSync(file, 0o755);

	const locator = new CliLocator({ homeDir: home, env: { PATH: '' } });
	return new CliRunner(locator);
}

/** A tracked workspace, as the CLI reports it. */
function tracked(extra: Record<string, unknown> = {}): WorkspaceStatus {
	return {
		kind: 'tracked',
		enabled: true,
		agents: ['Copilot CLI'],
		activeSessions: [],
		...extra,
	};
}

suite('Entire checkpoint destination inspection', () => {
	/** The settings that name the checkpoint repository. */
	const settings: EntireSettings = {
		checkpointRemote: { provider: 'github', repo: 'greysquirr3l/entirely-vscode-checkpoints' },
	};

	test('says the checkpoint repository is out of reach when it is not visible', async () => {
		const runner = runnerFor(cliBody(JSON.stringify(DEDICATED_STATUS), '[]'));

		const report = await inspectCheckpointDestination(
			runner,
			undefined,
			tracked({
				checkpointSyncRemote: 'greysquirr3l/entirely-vscode-checkpoints',
				checkpointSyncRemoteSource: 'dedicated',
			}),
			settings,
		);

		assert.strictEqual(report.destination.kind, 'dedicated');
		assert.strictEqual(report.checkpointRepoVisible, false);
		assert.match(report.problem ?? '', /Entire cannot reach/);
		assert.match(report.remedy ?? '', /GitHub App/);
		assert.strictEqual(report.workspaceRepo?.ref.path, '/gh/greysquirr3l/entirely-vscode');
	});

	test('says the checkpoint repository is reachable when it is visible', async () => {
		const visible = JSON.stringify([
			{
				repo: '/gh/greysquirr3l/entirely-vscode-checkpoints',
				private: true,
				status: 'ready',
			},
		]);
		const runner = runnerFor(cliBody(JSON.stringify(DEDICATED_STATUS), visible));

		const report = await inspectCheckpointDestination(
			runner,
			undefined,
			tracked({
				checkpointSyncRemote: 'greysquirr3l/entirely-vscode-checkpoints',
				checkpointSyncRemoteSource: 'dedicated',
			}),
			settings,
		);

		assert.strictEqual(report.checkpointRepoVisible, true);
		assert.strictEqual(report.problem, undefined);
	});

	test('says the checkpoints stay on the machine when pushing is off', async () => {
		const runner = runnerFor(cliBody(JSON.stringify(DEDICATED_STATUS), '[]'));

		const report = await inspectCheckpointDestination(
			runner,
			undefined,
			tracked({ checkpointPushDisabled: true }),
			settings,
		);

		assert.strictEqual(report.destination.kind, 'local-only');
		assert.match(report.problem ?? '', /this machine only/);
	});

	test('says the checkpoints are on Entire when the repository is hosted there', async () => {
		const body = [
			'case "$1" in',
			'\tversion) echo "entire 0.12.2" ;;',
			`\tstatus) echo '{"enabled":true,"agents":[],"active_sessions":[],"checkpoint_sync_remote":"origin","checkpoint_sync_remote_source":"default"}' ;;`,
			`\trepo) echo '{"repo":"/et/entirely-lab/entirely-forge-probe","private":true,"visibility":"private"}' ;;`,
			'\t*) echo "unknown command" >&2; exit 2 ;;',
			'esac',
		].join('\n');
		const runner = runnerFor(body);

		const report = await inspectCheckpointDestination(
			runner,
			undefined,
			tracked({ checkpointSyncRemote: 'origin', checkpointSyncRemoteSource: 'default' }),
			{},
		);

		assert.strictEqual(report.workspaceRepo?.ref.forge, 'entire');
		assert.match(report.remedy ?? '', /hosted on Entire/);
	});

	test('says the acting login cannot see the checkpoint repository', async () => {
		const runner = runnerFor(cliBody(JSON.stringify(DEDICATED_STATUS), '[]'));

		const report = await inspectCheckpointDestination(
			runner,
			undefined,
			tracked({
				checkpointSyncRemote: 'greysquirr3l/entirely-vscode-checkpoints',
				checkpointSyncRemoteSource: 'dedicated',
			}),
			settings,
		);

		assert.strictEqual(report.visible, false);
	});

	test('says the acting login can see the checkpoint repository', async () => {
		const visible = JSON.stringify([
			{
				repo: '/gh/greysquirr3l/entirely-vscode-checkpoints',
				private: true,
				status: 'ready',
			},
		]);
		const runner = runnerFor(cliBody(JSON.stringify(DEDICATED_STATUS), visible));

		const report = await inspectCheckpointDestination(
			runner,
			undefined,
			tracked({
				checkpointSyncRemote: 'greysquirr3l/entirely-vscode-checkpoints',
				checkpointSyncRemoteSource: 'dedicated',
			}),
			settings,
		);

		assert.strictEqual(report.visible, true);
	});

	test('says the acting login cannot see the workspace itself', async () => {
		const body = [
			'case "$1" in',
			'\tversion) echo "entire 0.12.2" ;;',
			`\tstatus) echo '{"enabled":true,"agents":[],"active_sessions":[],"checkpoint_sync_remote":"origin","checkpoint_sync_remote_source":"default"}' ;;`,
			'\trepo) echo \'no repo matching "owner/repo" visible from your login\' >&2; exit 1 ;;',
			'\t*) echo "unknown command" >&2; exit 2 ;;',
			'esac',
		].join('\n');
		const runner = runnerFor(body);

		const report = await inspectCheckpointDestination(
			runner,
			undefined,
			tracked({ checkpointSyncRemote: 'origin', checkpointSyncRemoteSource: 'default' }),
			{},
		);

		assert.strictEqual(report.visible, false);
	});

	test('says nothing about visibility when the CLI could not answer', async () => {
		const body = [
			'case "$1" in',
			'\tversion) echo "entire 0.12.2" ;;',
			`\tstatus) echo '{"enabled":true,"agents":[],"active_sessions":[],"checkpoint_sync_remote":"origin","checkpoint_sync_remote_source":"default"}' ;;`,
			'\trepo) echo "the network is down" >&2; exit 1 ;;',
			'\t*) echo "unknown command" >&2; exit 2 ;;',
			'esac',
		].join('\n');
		const runner = runnerFor(body);

		const report = await inspectCheckpointDestination(
			runner,
			undefined,
			tracked({ checkpointSyncRemote: 'origin', checkpointSyncRemoteSource: 'default' }),
			{},
		);

		assert.strictEqual(report.visible, undefined);
	});

	test('reports what it found, in a form a bug report can carry', async () => {
		const runner = runnerFor(cliBody(JSON.stringify(DEDICATED_STATUS), '[]'));

		const report = await inspectCheckpointDestination(
			runner,
			undefined,
			tracked({
				checkpointSyncRemote: 'greysquirr3l/entirely-vscode-checkpoints',
				checkpointSyncRemoteSource: 'dedicated',
			}),
			settings,
		);

		const rendered = renderCheckpointDestination(report);

		assert.match(rendered, /### Checkpoint destination/);
		assert.match(
			rendered,
			/the dedicated checkpoint repository greysquirr3l\/entirely-vscode-checkpoints/,
		);
		assert.match(rendered, /Entire can reach it: no/);
		assert.match(rendered, /This repository: \/gh\/greysquirr3l\/entirely-vscode/);
	});
});
