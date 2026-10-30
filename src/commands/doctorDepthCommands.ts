import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { AccountContext } from '../lib/entire';
import type { GeneratedDocuments } from '../providers/generatedDocuments';
import type { CliRunner } from '../services/cli';
import { inspectSaveTarget, saveText } from '../services/bundleFile';
import { CheckpointMigrationService } from '../services/checkpointMigration';
import {
	MAX_DOCTOR_TRACE_COUNT,
	MIN_DOCTOR_TRACE_COUNT,
	readExtensionSettings,
} from '../services/configuration';
import { DoctorDepthService } from '../services/doctorDepth';
import { writeDiagnosticBundle } from './doctorBundle';
import { showCliLog, showHookTraces, type DepthFiles, type DepthSettings } from './doctorDepth';
import { EditorDoctorDepthUi } from './doctorDepthUi';
import { migrateCheckpoints } from './migrateCheckpoints';

export interface DoctorDepthCommandDependencies {
	readonly runner: CliRunner;
	readonly workspaceRoot: () => string | undefined;
	readonly documents: GeneratedDocuments;
	/** Works out, now, which login the CLI will act as. */
	readonly acting: () => Promise<AccountContext | undefined>;
}

/**
 * Registers the doctor's log, trace, bundle and migration commands.
 *
 * One flag is shared by all five, so only one of them runs at a time. None
 * of them runs on its own: each is reached by the person choosing it.
 */
export function registerDoctorDepthCommands(context: vscode.ExtensionContext, deps: DoctorDepthCommandDependencies): void {
	const { workspaceRoot } = deps;
	const service = new DoctorDepthService({
		runner: deps.runner,
		workspaceRoot,
		logLines: () => readExtensionSettings().doctorLogLines,
		readTimeoutSeconds: () => readExtensionSettings().doctorReadTimeout,
		bundleTimeoutSeconds: () => readExtensionSettings().doctorBundleTimeout,
	});
	const migration = new CheckpointMigrationService({
		runner: deps.runner,
		workspaceRoot,
		readTimeoutSeconds: () => readExtensionSettings().doctorReadTimeout,
		applyTimeoutSeconds: () => readExtensionSettings().migrateCheckpointsTimeout,
	});
	const ui = new EditorDoctorDepthUi(deps.documents);
	const running = { active: false };
	const roots = (): string[] => vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [];
	const files: DepthFiles = {
		inspect: file => inspectSaveTarget(file, roots()),
		saveText,
	};
	const settings = (): DepthSettings => ({
		traceCount: readExtensionSettings().doctorTraceCount,
		traceCountMin: MIN_DOCTOR_TRACE_COUNT,
		traceCountMax: MAX_DOCTOR_TRACE_COUNT,
		outputMaxBytes: readExtensionSettings().doctorOutputMaxKilobytes * 1024,
	});
	const cliSettingsFile = (): string | undefined => {
		const root = workspaceRoot();
		const file = root ? path.join(root, '.entire', 'settings.json') : undefined;
		return file && fs.existsSync(file) ? file : undefined;
	};
	const depth = { service, files, ui, settings, cliSettingsFile, running };
	const bundle = { service, files, ui, acting: deps.acting, running };

	context.subscriptions.push(
		vscode.commands.registerCommand('entirely.showCliLog', async () => {
			await showCliLog(depth);
		}),
		vscode.commands.registerCommand('entirely.showHookTraces', async () => {
			await showHookTraces(depth);
		}),
		vscode.commands.registerCommand('entirely.writeDiagnosticBundle', async () => {
			await writeDiagnosticBundle(bundle, { raw: false });
		}),
		vscode.commands.registerCommand('entirely.writeRawDiagnosticBundle', async () => {
			await writeDiagnosticBundle(bundle, { raw: true });
		}),
		vscode.commands.registerCommand('entirely.migrateCheckpoints', async () => {
			await migrateCheckpoints({
				depth: service,
				migration,
				files,
				ui,
				settings,
				acting: deps.acting,
				workspaceName: () => vscode.workspace.workspaceFolders?.[0]?.name,
				running,
			});
		}),
	);
}
