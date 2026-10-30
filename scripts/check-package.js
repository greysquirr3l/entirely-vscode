const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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

/**
 * Every file the package is expected to hold. Anything else is a
 * surprise, and a surprise in a package is how a scratch directory or a
 * planning file reaches the marketplace. A file added on purpose is
 * added here too.
 */
const expected = new Set([
	'package.json',
	'README.md',
	'CHANGELOG.md',
	'LICENSE',
	'SECURITY.md',
	'dist/extension.js',
	'assets/entire-icons.woff',
	'images/logo.png',
	'images/entirely-view.svg',
]);

/** What a file path must not look like. */
const forbidden = [
	{ pattern: /(^|\/)src\//, reason: 'source files' },
	{ pattern: /(^|\/)out\//, reason: 'compiled test output' },
	{ pattern: /(^|\/)node_modules\//, reason: 'development dependencies' },
	{ pattern: /\.map$/, reason: 'source maps' },
	{ pattern: /(^|\/)test-workspace\//, reason: 'the test workspace' },
	{ pattern: /\.vsix$/, reason: 'a package built earlier' },
	{ pattern: /(^|\/)docs\//, reason: 'documentation, which the README links to in the repository' },
	{ pattern: /(^|\/)site\//, reason: 'the documentation site' },
	{ pattern: /(^|\/)\.local(\/|$)/, reason: 'local scratch: research, source artwork and the screenshot repository' },
	{ pattern: /(^|\/)(AGENTS|BUDGET|IMPLEMENTATION_PLAN|PROGRESS|RUN_LOG)\.md$/, reason: 'local planning artefacts' },
	{ pattern: /(^|\/)(features\.json|plan\.toml)$/, reason: 'local planning artefacts' },
	{ pattern: /(^|\/)(capabilities|research|tasks)\//, reason: 'local planning artefacts' },
	{ pattern: /(^|\/)vsc-extension-quickstart\.md$/, reason: 'the generator quickstart' },
	// A dot-directory is never part of the extension. One that finds its
	// way in is a scratch directory that was left behind, and it can
	// carry a whole copy of the repository.
	{ pattern: /(^|\/)\.[^/]+\//, reason: 'a local directory' },
];

/**
 * The most the package may weigh once compressed. The bundle and the
 * icon are well under it; a screenshot or a document that slips in is
 * not.
 */
const maxCompressedBytes = 600 * 1024;

/**
 * Strings that must not be in the bundle. They are a person's home
 * directory, account names and the prefixes of access tokens: things a
 * build picks up from the machine it ran on. Only the line number is
 * reported, so the check never prints what it found.
 */
const personal = [
	{ pattern: /\/Users\//, reason: 'a macOS home directory' },
	{ pattern: /ncampbell/, reason: 'a local account name' },
	{ pattern: /sosh/, reason: 'a local name' },
	{ pattern: /s0ma@/, reason: 'a personal address' },
	{ pattern: /ghp_/, reason: 'a GitHub token' },
	{ pattern: /github_pat_/, reason: 'a GitHub token' },
	{ pattern: /npm_[A-Za-z0-9]{8,}/, reason: 'an npm token' },
];

const files = packagedFiles();
const offenders = [];

for (const file of files) {
	for (const rule of forbidden) {
		if (rule.pattern.test(file)) {
			offenders.push(`${file} (${rule.reason})`);
		}
	}
	if (!expected.has(file) && !forbidden.some(rule => rule.pattern.test(file))) {
		offenders.push(`${file} (not in the list of expected files)`);
	}
}

for (const file of expected) {
	if (!files.includes(file)) {
		offenders.push(`${file} (expected but missing${file.startsWith('dist/') ? '; build first with npm run package' : ''})`);
	}
}

let compressed = 0;
for (const file of files) {
	const absolute = path.join(root, file);
	if (fs.existsSync(absolute)) {
		compressed += zlib.deflateSync(fs.readFileSync(absolute)).length;
	}
}

const bundle = path.join(root, 'dist', 'extension.js');
if (fs.existsSync(bundle)) {
	fs.readFileSync(bundle, 'utf8').split('\n').forEach((line, index) => {
		for (const rule of personal) {
			if (rule.pattern.test(line)) {
				offenders.push(`dist/extension.js line ${index + 1} (${rule.reason})`);
			}
		}
	});
}

console.log(`The package holds ${files.length} files:`);
for (const file of files) {
	console.log(`  ${file}`);
}
console.log(`\nCompressed size: ${(compressed / 1024).toFixed(0)} KB (limit ${maxCompressedBytes / 1024} KB).`);

if (compressed > maxCompressedBytes) {
	offenders.push(`the package is ${(compressed / 1024).toFixed(0)} KB compressed, over the ${maxCompressedBytes / 1024} KB limit`);
}

if (offenders.length > 0) {
	console.error('\nThe package is not what it should be:');
	for (const offender of offenders) {
		console.error(`  ${offender}`);
	}
	process.exit(1);
}

console.log('\nThe package holds only what belongs in it.');
