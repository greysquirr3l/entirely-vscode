import { CheckpointMigrationService } from '../../services/checkpointMigration';
import { DoctorDepthService } from '../../services/doctorDepth';
import { inspectSaveTarget, saveText } from '../../services/bundleFile';
import type { DepthFiles, DepthSettings, DoctorDepthDependencies } from '../../commands/doctorDepth';
import type { FakeDoctorCli } from './doctorCli';
import { ScriptedUi, type DepthScript } from './depthUi';

export interface HarnessOptions {
	logLines?: number;
	readSeconds?: number;
	bundleSeconds?: number;
	applySeconds?: number;
	maxBytes?: number;
	workspaceRoots?: string[];
	settingsFile?: string;
}

/** The services and the scripted editor the doctor flows run over, against a fake CLI. */
export function harness(cli: FakeDoctorCli, script: DepthScript = {}, options: HarnessOptions = {}) {
	const service = new DoctorDepthService({
		runner: cli.runner,
		workspaceRoot: () => cli.repo,
		logLines: () => options.logLines ?? 200,
		readTimeoutSeconds: () => options.readSeconds ?? 20,
		bundleTimeoutSeconds: () => options.bundleSeconds ?? 20,
	});
	const migration = new CheckpointMigrationService({
		runner: cli.runner,
		workspaceRoot: () => cli.repo,
		readTimeoutSeconds: () => options.readSeconds ?? 20,
		applyTimeoutSeconds: () => options.applySeconds ?? 20,
	});
	const ui = new ScriptedUi(script);
	const files: DepthFiles = {
		inspect: file => inspectSaveTarget(file, options.workspaceRoots ?? [cli.repo]),
		saveText,
	};
	const settings = (): DepthSettings => ({ traceCount: 5, traceCountMin: 1, traceCountMax: 200, outputMaxBytes: options.maxBytes ?? 512 * 1024 });
	const depth: DoctorDepthDependencies = { service, files, ui, settings, cliSettingsFile: () => options.settingsFile, running: { active: false } };
	return { service, migration, ui, files, settings, depth };
}
