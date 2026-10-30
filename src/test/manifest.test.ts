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

	test('declares and packages the single Entire logo glyph', () => {
		const manifest = readManifest();
		const icons = manifest.contributes?.icons;
		assert.ok(icons, 'package.json declares no custom product icons');
		assert.deepStrictEqual(Object.keys(icons), ['entire-logo'], 'the logo is the only product icon');

		const fontPath = 'assets/entire-icons.woff';
		const productIcon: ProductIconContribution | undefined = icons['entire-logo'];
		assert.ok(productIcon?.description, 'the logo icon is not described');
		assert.strictEqual(productIcon.default?.fontPath, fontPath);
		assert.strictEqual(productIcon.default?.fontCharacter, '\\e001');

		const font = path.join(ROOT, fontPath);
		assert.ok(fs.existsSync(font), `the icon font '${fontPath}' is not on disk`);
		assert.strictEqual(fs.readFileSync(font).subarray(0, 4).toString('ascii'), 'wOFF', 'the icon font is not a WOFF file');

		const patterns = ignorePatterns(path.join(ROOT, '.vscodeignore'));
		assert.ok(!isIgnored(fontPath, patterns), `the icon font '${fontPath}' is excluded by .vscodeignore`);
	});

	test('vendors Entire\'s official symbol the font is built from', () => {
		const symbol = path.join(ROOT, 'assets', 'brand', 'entire-symbol-icon.svg');
		assert.ok(fs.existsSync(symbol), 'assets/brand/entire-symbol-icon.svg is missing');
		assert.match(fs.readFileSync(symbol, 'utf8'), /<svg[^>]*viewBox="0 0 32 32"/);
		assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'brand', 'README.md')), 'the symbol has no provenance note');
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

	test('uses Entire\'s official symbol, unaltered, for the Activity Bar', () => {
		const container = readManifest().contributes?.viewsContainers?.activitybar?.find(view => view.id === 'entirely');
		assert.ok(container, 'the Entirely Activity Bar container is not declared');
		assert.strictEqual(container.icon, 'images/entirely-view.svg', 'the Activity Bar does not use the symbol');

		const icon = path.join(ROOT, container.icon);
		assert.ok(fs.existsSync(icon), `the Activity Bar icon '${container.icon}' is not on disk`);
		const svg = fs.readFileSync(icon, 'utf8');
		const official = fs.readFileSync(path.join(ROOT, 'assets', 'brand', 'entire-symbol-icon.svg'), 'utf8');
		// Only the rendered size may differ from the vendored official file.
		const unsized = (source: string): string => source.replace(/ (width|height)="[^"]*"/g, '');
		assert.strictEqual(unsized(svg), unsized(official), 'the Activity Bar icon differs from the official symbol');
		assert.match(svg, /viewBox="0 0 32 32"/, 'the symbol viewBox was changed');

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
