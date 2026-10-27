import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	label: 'Entirely',
	files: 'out/test/**/*.test.js',
	mocha: {
		ui: 'tdd',
	},
});
