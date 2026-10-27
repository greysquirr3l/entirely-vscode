import * as vscode from 'vscode';

/**
 * Writes a setting, waiting for the editor to be ready to accept it.
 *
 * The editor watches the settings file it keeps, and a write that lands
 * while the editor is still reading that file back is refused with
 * "the content of the file is newer" or "the file has unsaved changes".
 * The refusal is the editor being careful with a file it is watching,
 * not a fault in the setting, so the write is tried again after a wait
 * long enough for the editor to have finished reading the file.
 *
 * A refusal that does not go away is passed on, so a genuine failure is
 * still seen.
 */
export async function writeSetting(
	key: string,
	value: unknown,
	target: vscode.ConfigurationTarget,
): Promise<void> {
	const attempts = 8;

	for (let attempt = 1; ; attempt++) {
		try {
			await vscode.workspace.getConfiguration().update(key, value, target);
			return;
		} catch (error) {
			if (attempt >= attempts) {
				throw error;
			}

			await delay(100 * attempt);
		}
	}
}

/** Waits for a moment. */
function delay(milliseconds: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}
