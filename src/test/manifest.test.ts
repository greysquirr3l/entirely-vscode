import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface ProductIconContribution {
	description?: string;
	default?: { fontPath?: string; fontCharacter?: string };
}

interface ExtensionManifest {
	icon?: string;
	license?: string;
	publisher?: string;
	repository?: { type?: string; url?: string };
	extensionKind?: string[];
	galleryBanner?: { color?: string; theme?: string };
	contributes?: {
		icons?: Record<string, ProductIconContribution>;
		commands?: { command: string }[];
		viewsContainers?: Record<string, { id: string; icon?: string }[]>;
		views?: Record<string, { id: string }[]>;
		configuration?: {
			properties?: Record<
				string,
				{
					type?: string;
					default?: unknown;
					description?: string;
					markdownDescription?: string;
				}
			>;
		};
	};
}

const ROOT = path.resolve(__dirname, '..', '..');

function readManifest(): ExtensionManifest {
	return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as ExtensionManifest;
}

/** Reads the width and height out of a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
	const header = fs.readFileSync(file).subarray(0, 24);
	assert.strictEqual(header.subarray(12, 16).toString('ascii'), 'IHDR', 'not a PNG file');
	return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

/** Reads a `.vscodeignore` file into a list of gitignore-style patterns. */
function ignorePatterns(file: string): string[] {
	return fs
		.readFileSync(file, 'utf8')
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0 && !line.startsWith('#'));
}

/**
 * Mirrors the exclusion rules `vsce` applies when it decides what to package:
 * a pattern excludes a path when it names the path itself, names one of the
 * path's ancestor directories, or matches the path by extension.
 */
function isIgnored(relativePath: string, patterns: string[]): boolean {
	const segments = relativePath.split('/');
	const extension = path.extname(relativePath);

	return patterns.some(pattern => {
		const cleaned = pattern.replace(/^\/+|\/+$/g, '');
		if (cleaned === '') {
			return false;
		}
		if (cleaned === relativePath) {
			return true;
		}
		if (segments.some(segment => segment === cleaned)) {
			return true;
		}
		return cleaned === `*${extension}` || cleaned === `**/*${extension}`;
	});
}

suite('Entirely manifest', () => {
	test('declares a raster icon that exists and is packaged', () => {
		const manifest = readManifest();
		assert.ok(manifest.icon, 'package.json declares no icon');

		assert.ok(!manifest.icon.toLowerCase().endsWith('.svg'), 'vsce rejects SVG icons');
		assert.ok(!/^https?:/i.test(manifest.icon), 'the icon must be a relative path in the package');

		const iconPath = path.join(ROOT, manifest.icon);
		assert.ok(fs.existsSync(iconPath), `the icon '${manifest.icon}' is not on disk`);

		const size = pngSize(iconPath);
		assert.ok(size.width >= 128 && size.height >= 128, `the icon is ${size.width}x${size.height}, which is below 128x128`);

		const patterns = ignorePatterns(path.join(ROOT, '.vscodeignore'));
		assert.ok(
			!isIgnored(manifest.icon, patterns),
			`the icon '${manifest.icon}' is excluded by .vscodeignore, so it would not be packaged`,
		);
	});

	test('pairs the icon with a gallery banner', () => {
		const banner = readManifest().galleryBanner;
		assert.ok(banner, 'package.json declares no galleryBanner');
		assert.ok(banner.color, 'the gallery banner has no color');
		assert.match(banner.color, /^#[0-9a-fA-F]{6}$/, 'the gallery banner color is not a hex triplet');
		assert.ok(banner.theme === 'dark' || banner.theme === 'light', 'the gallery banner theme is not dark or light');
	});

	test('declares and packages the Entire product icon family', () => {
		const manifest = readManifest();
		const icons = manifest.contributes?.icons;
		assert.ok(icons, 'package.json declares no custom product icons');

		const expected = [
			['entire-logo', '\\e001'],
			['entire-compact', '\\e002'],
			['entire-large', '\\e003'],
			['entire-dot', '\\e004'],
			['entire-dot-compact', '\\e005'],
			['entire-in-progress', '\\e006'],
			['entire-success', '\\e007'],
			['entire-warning', '\\e008'],
			['entire-warning-large', '\\e009'],
			['entire-error', '\\e00a'],
			['entire-unavailable', '\\e00b'],
			['entire-not-connected', '\\e00c'],
			['entire-snooze', '\\e00d'],
			['entire-blocked', '\\e00e'],
		] as const;
		const fontPath = 'assets/entire-icons.woff';

		for (const [id, character] of expected) {
			const productIcon: ProductIconContribution | undefined = icons[id];
			assert.ok(productIcon, `the '${id}' icon is not contributed`);
			assert.ok(productIcon.description, `the '${id}' icon is not described`);
			assert.strictEqual(productIcon.default?.fontPath, fontPath, `the '${id}' icon uses the wrong font`);
			assert.strictEqual(productIcon.default?.fontCharacter, character, `the '${id}' icon uses the wrong code point`);
		}

		const font = path.join(ROOT, fontPath);
		assert.ok(fs.existsSync(font), `the icon font '${fontPath}' is not on disk`);
		assert.strictEqual(fs.readFileSync(font).subarray(0, 4).toString('ascii'), 'wOFF', 'the icon font is not a WOFF file');

		const patterns = ignorePatterns(path.join(ROOT, '.vscodeignore'));
		assert.ok(!isIgnored(fontPath, patterns), `the icon font '${fontPath}' is excluded by .vscodeignore`);
	});

	test('declares every Entire product icon the source uses', () => {
		const declared = new Set(Object.keys(readManifest().contributes?.icons ?? {}));
		const used = new Set<string>();

		const scan = (directory: string): void => {
			for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
				const entryPath = path.join(directory, entry.name);
				if (entry.isDirectory()) {
					if (entry.name !== 'test') {
						scan(entryPath);
					}
				} else if (entry.name.endsWith('.ts')) {
					for (const match of fs.readFileSync(entryPath, 'utf8').matchAll(/\$\((entire-[a-z-]+)\)/g)) {
						used.add(match[1]);
					}
				}
			}
		};
		scan(path.join(ROOT, 'src'));

		assert.ok(used.size > 0, 'the source uses no Entire product icons');
		for (const id of used) {
			assert.ok(declared.has(id), `the source uses $(${id}), which contributes.icons does not declare`);
		}
	});

	test('uses a packaged 24 by 24 Marvin outline for the Activity Bar', () => {
		const container = readManifest().contributes?.viewsContainers?.activitybar?.find(view => view.id === 'entirely');
		assert.ok(container, 'the Entirely Activity Bar container is not declared');
		assert.strictEqual(container.icon, 'images/entirely-view.svg', 'the Activity Bar does not use the Marvin outline');

		const icon = path.join(ROOT, container.icon);
		assert.ok(fs.existsSync(icon), `the Activity Bar icon '${container.icon}' is not on disk`);
		const svg = fs.readFileSync(icon, 'utf8');
		assert.match(svg, /viewBox="0 0 24 24"/, 'the Activity Bar icon is not sized on a 24 by 24 grid');
		assert.match(svg, /currentColor/, 'the Activity Bar icon does not inherit the VS Code theme colour');
		assert.match(svg, /fill="none"/, 'the Activity Bar icon is not line art');
		assert.doesNotMatch(svg, /fill="currentColor"/, 'the Activity Bar icon has a filled shape instead of line art');

		const patterns = ignorePatterns(path.join(ROOT, '.vscodeignore'));
		assert.ok(!isIgnored(container.icon, patterns), `the Activity Bar icon '${container.icon}' is excluded by .vscodeignore`);
	});

	test('declares the marketplace metadata vsce requires', () => {
		const manifest = readManifest();
		assert.ok(manifest.publisher, 'package.json declares no publisher');
		assert.ok(manifest.license, 'package.json declares no license');
		assert.ok(manifest.repository?.url, 'package.json declares no repository URL');
		assert.ok(manifest.extensionKind?.includes('workspace'), 'the extension does not declare the workspace extension kind');
	});

	test('declares the tree view, configuration and commands', () => {
		const contributes = readManifest().contributes;
		assert.ok(contributes, 'package.json contributes nothing');

		const containers = Object.values(contributes.viewsContainers ?? {}).flat();
		assert.ok(containers.some(container => container.id === 'entirely'), 'no Entirely view container is declared');

		const views = Object.values(contributes.views ?? {}).flat();
		assert.ok(views.some(view => view.id.startsWith('entirely.')), 'no Entirely view is declared');

		const properties = contributes.configuration?.properties ?? {};
		assert.ok(Object.keys(properties).length > 0, 'no configuration section is declared');
		for (const [key, schema] of Object.entries(properties)) {
			assert.ok(key.startsWith('entirely.'), `the setting '${key}' is not namespaced to the extension`);
			assert.ok(schema.type, `the setting '${key}' has no type`);
			assert.notStrictEqual(schema.default, undefined, `the setting '${key}' has no default`);
			assert.ok(
				schema.markdownDescription ?? schema.description,
				`the setting '${key}' is not described, and an undescribed setting is a hidden one`,
			);
		}

		const commands = contributes.commands ?? [];
		assert.ok(commands.length > 0, 'no commands are contributed');
		for (const { command } of commands) {
			assert.ok(command.startsWith('entirely.'), `the command '${command}' is not namespaced to the extension`);
		}
	});
});
