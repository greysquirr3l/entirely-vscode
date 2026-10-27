import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface ExtensionManifest {
	icon?: string;
	license?: string;
	publisher?: string;
	repository?: { type?: string; url?: string };
	extensionKind?: string[];
	galleryBanner?: { color?: string; theme?: string };
	contributes?: {
		commands?: { command: string }[];
		viewsContainers?: Record<string, { id: string }[]>;
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
