import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	label: 'Entirely',
	files: 'out/test/**/*.test.js',
	// The folder the host opens. The settings tests write to a workspace
	// scope, so the host needs a workspace of its own to write to. A
	// workspace left over from an earlier run would point at folders that
	// are long gone, and the host would open one of those instead.
	workspaceFolder: 'test-workspace',
	mocha: {
		ui: 'tdd',
	},
});
