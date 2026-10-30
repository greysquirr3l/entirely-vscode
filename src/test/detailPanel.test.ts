import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';

import { DETAIL_COMMANDS, buildCommitDetail, type Selection, type ViewerState } from '../lib/entire';
import { DETAIL_VIEW_TYPE, DetailPanel } from '../providers/detailPanel';
import { fakePanels } from './support/fakePanel';

function commit(id: string): Extract<Selection, { kind: 'commit' }> {
	return { kind: 'commit', entry: { text: `${id} title ${id}  acme/app`, id, title: `title ${id}`, repo: 'acme/app' } };
}

function ready(selection: Extract<Selection, { kind: 'commit' }>, extra: Partial<Extract<ViewerState, { kind: 'ready' }>> = {}): ViewerState {
	return { kind: 'ready', selection, model: buildCommitDetail(selection), ...extra };
}

const ICON = vscode.Uri.file('/ext/images/entirely-view.svg');

suite('Entire detail panel', () => {
	test('panel-opens-beside-without-focus: one panel, beside the code, no scripts, only the commands it links to', () => {
		const fake = fakePanels();
		const panel = new DetailPanel({ create: fake.create, iconPath: ICON });
		try {
			panel.apply(ready(commit('aaaaaaa')));

			assert.strictEqual(fake.made.length, 1);
			const made = fake.made[0];
			assert.strictEqual(made.viewType, 'entirely.detail');
			assert.strictEqual(DETAIL_VIEW_TYPE, 'entirely.detail');
			assert.deepStrictEqual(made.showOptions, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
			assert.strictEqual(made.options.enableScripts, false);
			assert.deepStrictEqual(made.options.enableCommandUris, [...DETAIL_COMMANDS]);
			assert.deepStrictEqual(made.options.localResourceRoots, []);
			assert.strictEqual(made.iconPath, ICON);
			assert.strictEqual(made.title, 'aaaaaaa title aaaaaaa');
			assert.ok(made.webview.html.includes('<h1>title aaaaaaa</h1>'));
			assert.deepStrictEqual(made.reveals, [], 'creating it reveals nothing more');
		} finally {
			panel.dispose();
		}
	});

	test('panel-reused-on-every-selection: the same panel takes the next item, its title and its page, and never steals focus', () => {
		const fake = fakePanels();
		const panel = new DetailPanel({ create: fake.create });
		try {
			panel.apply(ready(commit('aaaaaaa')));
			panel.apply(ready(commit('bbbbbbb')));
			panel.apply(ready(commit('ccccccc')));

			assert.strictEqual(fake.made.length, 1, 'a second panel was made');
			const made = fake.made[0];
			assert.strictEqual(made.title, 'ccccccc title ccccccc');
			assert.ok(made.webview.html.includes('ccccccc'));
			// A visible panel is only updated; nothing was revealed.
			assert.deepStrictEqual(made.reveals, []);
		} finally {
			panel.dispose();
		}
	});

	test('a hidden panel is revealed in its own column without focus, once per different item', () => {
		const fake = fakePanels();
		const panel = new DetailPanel({ create: fake.create });
		try {
			panel.apply(ready(commit('aaaaaaa')));
			const made = fake.made[0];

			made.visible = false;
			made.viewColumn = vscode.ViewColumn.Three;
			panel.apply(ready(commit('bbbbbbb')));
			assert.deepStrictEqual(made.reveals, [{ viewColumn: vscode.ViewColumn.Three, preserveFocus: true }]);

			// The same item again, with more read, is an update and not a new reveal.
			made.visible = false;
			panel.apply(ready(commit('bbbbbbb'), { asOf: 1 }));
			assert.strictEqual(made.reveals.length, 1);
			assert.ok(made.reveals.every(reveal => reveal.preserveFocus === true));
		} finally {
			panel.dispose();
		}
	});

	test('the same page is not written again, so a progress update does not throw the scroll position away', () => {
		const fake = fakePanels();
		const panel = new DetailPanel({ create: fake.create });
		try {
			const state = ready(commit('aaaaaaa'));
			panel.apply(state);
			let writes = 0;
			const made = fake.made[0];
			const html = made.webview.html;
			Object.defineProperty(made.webview, 'html', {
				get: () => html,
				set: () => {
					writes += 1;
				},
			});
			panel.apply(state);
			assert.strictEqual(writes, 0);
			panel.apply(ready(commit('aaaaaaa'), { asOf: 5 }));
			assert.strictEqual(writes, 1, 'a changed page is written');
		} finally {
			panel.dispose();
		}
	});

	test('closed-panel-reopens: after the user closes it, the next selection makes a new one', () => {
		const fake = fakePanels();
		const panel = new DetailPanel({ create: fake.create });
		const opened: boolean[] = [];
		panel.onDidChangeOpen(open => opened.push(open));
		try {
			panel.apply(ready(commit('aaaaaaa')));
			assert.strictEqual(panel.isOpen, true);
			fake.made[0].dispose();
			assert.strictEqual(panel.isOpen, false);

			panel.apply(ready(commit('aaaaaaa')));
			assert.strictEqual(fake.made.length, 2);
			assert.notStrictEqual(fake.made[0], fake.made[1]);
			assert.deepStrictEqual(opened, [true, false, true]);
		} finally {
			panel.dispose();
		}
	});

	test('a late close of an old panel does not close the new one', () => {
		const fake = fakePanels();
		const panel = new DetailPanel({ create: fake.create });
		try {
			panel.apply(ready(commit('aaaaaaa')));
			fake.made[0].dispose();
			panel.apply(ready(commit('bbbbbbb')));
			fake.made[0].dispose();
			assert.strictEqual(panel.isOpen, true);
		} finally {
			panel.dispose();
		}
	});

	test('an empty state closes the panel, because nothing is left for it to be about', () => {
		const fake = fakePanels();
		const panel = new DetailPanel({ create: fake.create });
		try {
			panel.apply({ kind: 'empty' });
			assert.strictEqual(fake.made.length, 0, 'an empty state does not make a panel');

			panel.apply(ready(commit('aaaaaaa')));
			panel.apply({ kind: 'empty' });
			assert.strictEqual(fake.made[0].disposed, true);
			assert.strictEqual(panel.isOpen, false);
		} finally {
			panel.dispose();
		}
	});

	test('a notice is shown in the panel as text', () => {
		const fake = fakePanels();
		const panel = new DetailPanel({ create: fake.create });
		try {
			panel.apply({ kind: 'notice', message: 'Could not show that row.' });
			assert.strictEqual(fake.made[0].title, 'Details');
			assert.ok(fake.made[0].webview.html.includes('Could not show that row.'));
		} finally {
			panel.dispose();
		}
	});

	test('disposing the extension closes the panel and nothing is left listening', () => {
		const fake = fakePanels();
		const panel = new DetailPanel({ create: fake.create });
		panel.apply(ready(commit('aaaaaaa')));
		panel.dispose();
		assert.strictEqual(fake.made[0].disposed, true);
	});

	test('the tab icon is the shipped symbol, which is in the extension', () => {
		const extension = vscode.extensions.getExtension('greysquirr3l.entirely');
		assert.ok(extension);
		const icon = vscode.Uri.joinPath(extension.extensionUri, 'images', 'entirely-view.svg');
		assert.ok(icon.fsPath.endsWith('entirely-view.svg'));
		assert.ok(fs.existsSync(icon.fsPath), 'the icon file is missing');
	});
});
