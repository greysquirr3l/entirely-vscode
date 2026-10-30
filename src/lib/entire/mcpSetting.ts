/** Where a value of `entirely.mcpServerEnabled` can live, narrowest first. */
export type McpSettingScope = 'workspace-folder' | 'workspace' | 'user';

/** The scoped values the editor reports for the setting. */
export interface McpSettingValues {
	readonly workspaceFolderValue?: boolean;
	readonly workspaceValue?: boolean;
}

/**
 * The narrowest scope whose change takes effect when the server is turned on.
 *
 * A folder or workspace value of false is what keeps it off there, and it
 * wins over anything set for the user, so that value is the one to change.
 * Without one, the user value is the one that decides.
 */
export function mcpEnableScope(values: McpSettingValues): McpSettingScope {
	if (values.workspaceFolderValue === false) {
		return 'workspace-folder';
	}
	if (values.workspaceValue === false) {
		return 'workspace';
	}
	return 'user';
}

/** Names the setting a change will touch, for the question that asks first. */
export function describeMcpScope(scope: McpSettingScope, folderName?: string): string {
	switch (scope) {
		case 'workspace-folder':
			return folderName ? `the folder setting of "${folderName}"` : 'the folder setting';
		case 'workspace':
			return 'your workspace setting';
		case 'user':
			return 'your user setting';
	}
}
