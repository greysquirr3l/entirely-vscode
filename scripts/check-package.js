const { execFileSync } = require('child_process');
const path = require('path');

/**
 * Checks that the package holds only what belongs in it.
 *
 * The extension is published as a bundle, so a source file or a test
 * that finds its way into the package makes the release larger than it
 * needs to be and puts code in a user's editor that was never meant to
 * run there. The check is done against the file list the packager itself
 * produces, so it sees what the package really holds rather than what
 * the ignore file says it should hold.
 */

const root = path.resolve(__dirname, '..');

/** The files the packager would put in the package. */
function packagedFiles() {
	const output = execFileSync('npx', ['vsce', 'ls'], {
		cwd: root,
		encoding: 'utf8',
	});

	return output
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0);
}

/** What a file path must not look like. */
const forbidden = [
	{ pattern: /(^|\/)src\//, reason: 'source files' },
	{ pattern: /(^|\/)out\//, reason: 'compiled test output' },
	{ pattern: /(^|\/)node_modules\//, reason: 'development dependencies' },
	{ pattern: /\.map$/, reason: 'source maps' },
	{ pattern: /(^|\/)test-workspace\//, reason: 'the test workspace' },
	{ pattern: /(^|\/)PROGRESS\.md$/, reason: 'local planning artefacts' },
	{ pattern: /(^|\/)plan\.toml$/, reason: 'local planning artefacts' },
];

const files = packagedFiles();
const offenders = [];

for (const file of files) {
	for (const rule of forbidden) {
		if (rule.pattern.test(file)) {
			offenders.push(`${file} (${rule.reason})`);
		}
	}
}

console.log(`The package holds ${files.length} files:`);
for (const file of files) {
	console.log(`  ${file}`);
}

if (offenders.length > 0) {
	console.error('\nThe package holds files that do not belong in it:');
	for (const offender of offenders) {
		console.error(`  ${offender}`);
	}
	process.exit(1);
}

console.log('\nThe package holds nothing that does not belong in it.');
