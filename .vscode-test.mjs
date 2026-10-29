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
		// Many tests start the fake CLI as a real child process, several times
		// each. On a loaded machine or CI runner that passes mocha's 2000ms
		// default now and then, so the limit is raised for the whole suite.
		timeout: 10000,
	},
});
