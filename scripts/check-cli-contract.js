const { execFileSync } = require('child_process');
const path = require('path');

/**
 * Checks the installed Entire CLI against what this extension expects.
 *
 * The extension reads the CLI rather than re-implementing it: it asks the
 * CLI how a command is invoked (`entire agent-help <command>`) and it
 * decodes the JSON the CLI prints. Both are contracts, and a contract
 * that changes without the extension noticing shows up later as a
 * mysterious failure in someone's editor rather than as a failed build.
 *
 * The check needs no account and no network: `agent-help` prints a
 * command's usage from the binary itself, so it answers the same way for
 * anyone. What it cannot check is the shape of the JSON a command
 * prints, because that needs a login and a project. That half is
 * covered by the tests, which decode recorded payloads.
 */

const root = path.resolve(__dirname, '..');

/** The commands the extension invokes, and the flags it passes them. */
const COMMANDS = [
	{ name: 'trail list', flags: ['--project', '--json', '--repo'] },
	{ name: 'trail show', flags: ['--json', '--project', '--repo'] },
	{ name: 'trail approvals', flags: ['--json', '--project', '--repo'] },
	{ name: 'trail approve', flags: ['--message', '--project', '--repo'] },
	{ name: 'trail comment add', flags: ['--trail', '--body', '--title', '--project'] },
	{ name: 'trail comment list', flags: ['--trail', '--json', '--project'] },
	{ name: 'trail finding add', flags: ['--trail', '--body', '--project'] },
	{ name: 'trail finding list', flags: ['--trail', '--json', '--project'] },
	{ name: 'trail merge', flags: ['--dry-run', '--json', '--project', '--repo'] },
	{ name: 'trail checkout', flags: ['--trail', '--project', '--repo'] },
	{ name: 'trail link', flags: ['--branch', '--base', '--json', '--project'] },
	{ name: 'trail unlink', flags: ['--branch', '--project'] },
	{ name: 'repo view', flags: ['--json'] },
];

/**
 * The commands that take the trail as a `--trail` flag rather than as a
 * positional argument.
 *
 * The extension reads this from the CLI at runtime rather than writing
 * it down, so a change here is not a break — but it is worth knowing
 * that it changed, because it means the extension's fallback path is
 * being taken for a command that no longer needs it.
 */
const TRAIL_FLAG_COMMANDS = [
	'trail comment add',
	'trail comment list',
	'trail finding add',
	'trail finding list',
	'trail checkout',
];

/** Runs a command and returns its output, or throws with the reason. */
function run(args) {
	try {
		return execFileSync('entire', args, {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, ENTIRE_CONNECT_TIMEOUT_SECONDS: '15' },
		});
	} catch (error) {
		const stderr = error.stderr ? String(error.stderr) : '';
		throw new Error(stderr.trim() || error.message);
	}
}

/** The flags a command's usage mentions. */
function flagsOf(usage) {
	return new Set(
		[...usage.matchAll(/(^|\s)(--[A-Za-z0-9][A-Za-z0-9-]*)/g)].map(match => match[2]),
	);
}

const problems = [];

try {
	run(['version']);
} catch (error) {
	console.error(
		'The Entire CLI could not be run. This check reads the CLI that is installed, so it needs one.',
	);
	console.error(error.message);
	process.exit(1);
}

for (const command of COMMANDS) {
	const args = command.name.split(' ');

	let usage;

	try {
		usage = run(['agent-help', ...args]);
	} catch (error) {
		problems.push(`${command.name}: the CLI did not describe it — ${error.message.split('\n')[0]}`);
		continue;
	}

	// An unknown command makes the CLI print its own help instead of
	// the command's, so the command's own name is what tells the two
	// apart.
	if (!usage.includes(command.name)) {
		problems.push(`${command.name}: the CLI does not have this command`);
		continue;
	}

	const flags = flagsOf(usage);

	for (const flag of command.flags) {
		if (!flags.has(flag)) {
			problems.push(`${command.name}: the CLI no longer accepts ${flag}`);
		}
	}
}

// The gate reads the approval blocker by its wording, so the merge
// command must still describe approvals as a gate.
try {
	if (!/approval/i.test(run(['agent-help', 'trail', 'merge']))) {
		problems.push('trail merge: the CLI no longer mentions approvals, so the approval-wait wording check is stale');
	}
} catch {
	// Reported above when the command itself could not be described.
}

for (const name of TRAIL_FLAG_COMMANDS) {
	let usage;

	try {
		usage = run(['agent-help', ...name.split(' ')]);
	} catch {
		continue;
	}

	if (!flagsOf(usage).has('--trail')) {
		problems.push(`${name}: the CLI no longer takes --trail, so the extension passes it wrongly`);
	}
}

if (problems.length > 0) {
	console.error('The installed Entire CLI no longer matches what this extension expects:');
	problems.forEach(problem => console.error(`  - ${problem}`));
	console.error('');
	console.error('The extension reads the CLI rather than re-implementing it, so a change');
	console.error("in the CLI is a change in the extension's contract. Update the extension,");
	console.error('and this check, to match.');
	process.exit(1);
}

console.log(`The Entire CLI matches the ${COMMANDS.length} commands this extension uses.`);
