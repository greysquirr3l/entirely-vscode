import * as assert from 'assert';

import {
	DETAIL_COMMANDS,
	buildChangeDetail,
	buildCommitDetail,
	buildSessionDetail,
	buildTrailDetail,
	detailActions,
	escapeHtml,
	initialDetail,
	isDetailCommand,
	linkFor,
	renderDetailHtml,
	rowLink,
	type DetailModel,
	type GatedChange,
	type GatedTrail,
	type Selection,
	type Trail,
	type TrailChange,
	type ViewerState,
} from '../lib/entire';

const PAYLOAD = `<script>alert("x")</script> & 'quoted' "double" <img src=x onerror=1>`;

const CHANGE: TrailChange = {
	id: 'c1',
	repository: 'widgets',
	branch: `fix-${PAYLOAD}`,
	number: 34,
	title: `Fix ${PAYLOAD}`,
	status: 'open',
	url: 'https://entire.example/changes/34',
};
const TRAIL: Trail = {
	id: 't1',
	number: 12,
	title: `Trail ${PAYLOAD}`,
	body: 'SECRET-BODY',
	status: 'open',
	url: 'javascript:alert(1)',
	changes: [CHANGE],
	partial: false,
};
const GATED: GatedChange = { change: CHANGE, gate: { kind: 'awaiting-approval', approvals: 0, blockers: [`needs ${PAYLOAD}`] } };
const ENTRY: GatedTrail = { trail: TRAIL, changes: [GATED] };

const CHANGE_SELECTION: Extract<Selection, { kind: 'change' }> = { kind: 'change', trail: TRAIL, entry: GATED };
const COMMIT_SELECTION: Extract<Selection, { kind: 'commit' }> = {
	kind: 'commit',
	entry: { text: 'a1b2c3d t  acme/app', id: 'a1b2c3d', title: `fix ${PAYLOAD}`, repo: `acme/${PAYLOAD}`, detail: PAYLOAD },
};

function ready(model: DetailModel, selection: Selection): ViewerState {
	return { kind: 'ready', selection, model };
}

/** Every `href` in the page. */
function hrefs(html: string): string[] {
	return [...html.matchAll(/href="([^"]*)"/g)].map(([, value]) => value);
}

suite('Entire detail panel page', () => {
	test('escapeHtml turns markup, quotes and ampersands into text', () => {
		assert.strictEqual(escapeHtml('<b>"a" & \'b\'</b>'), '&lt;b&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/b&gt;');
		assert.strictEqual(escapeHtml('&amp;'), '&amp;amp;', 'an entity is escaped, not trusted');
		assert.strictEqual(escapeHtml(''), '');
	});

	test('panel-escapes-cli-text: markup in titles, branches, messages and repositories never reaches the page as markup', () => {
		const states: ViewerState[] = [
			ready(buildChangeDetail(CHANGE_SELECTION), CHANGE_SELECTION),
			ready(buildTrailDetail({ kind: 'trail', entry: ENTRY }), { kind: 'trail', entry: ENTRY }),
			ready(buildCommitDetail(COMMIT_SELECTION), COMMIT_SELECTION),
			{ kind: 'failed', selection: COMMIT_SELECTION, model: buildCommitDetail(COMMIT_SELECTION), reason: PAYLOAD },
			{ kind: 'gone', selection: COMMIT_SELECTION, model: buildCommitDetail(COMMIT_SELECTION), reason: PAYLOAD },
			{ kind: 'notice', message: PAYLOAD },
			{ kind: 'ready', selection: COMMIT_SELECTION, model: buildCommitDetail(COMMIT_SELECTION), refreshFailure: PAYLOAD },
		];
		for (const state of states) {
			const html = renderDetailHtml(state);
			assert.ok(!html.includes('<script>'), `${state.kind}: a script tag got through`);
			assert.ok(!html.includes('<img'), `${state.kind}: an image tag got through`);
			assert.ok(!/alert\("x"\)/.test(html), `${state.kind}: a quote got through unescaped`);
			assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39;'), `${state.kind}: the text is not shown as text`);
			// The only `<script` in the page would be an injected one.
			assert.strictEqual((html.match(/<script/gi) ?? []).length, 0);
		}
	});

	test('the page has no script, a strict policy, and no remote content', () => {
		const html = renderDetailHtml(ready(buildChangeDetail(CHANGE_SELECTION), CHANGE_SELECTION));
		const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html);
		assert.ok(policy, 'no policy');
		assert.strictEqual(policy[1], "default-src 'none'; style-src 'unsafe-inline';");
		assert.ok(!/script-src|img-src|font-src|connect-src/.test(policy[1]));
		assert.ok(!/<script|<iframe|<img|<link|<object|<embed|<form|<input|<button/i.test(html));
		assert.ok(!/<[a-z][^>]*\ssrc=|url\(|@import/i.test(html), 'a remote resource is referenced');
		assert.ok(!/<[a-z][^>]*\son[a-z]+=/i.test(html), 'an event handler attribute');
	});

	test('colours come from the editor theme only, so light, dark and high contrast work', () => {
		const html = renderDetailHtml(ready(buildChangeDetail(CHANGE_SELECTION), CHANGE_SELECTION));
		const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
		assert.ok(style.length > 0);
		assert.ok(!/#[0-9a-f]{3,8}\b/i.test(style), 'a hex colour');
		assert.ok(!/\b(rgb|rgba|hsl|hsla)\(/i.test(style), 'a colour function');
		for (const variable of ['--vscode-foreground', '--vscode-editor-background', '--vscode-textLink-foreground', '--vscode-focusBorder']) {
			assert.ok(style.includes(variable), `${variable} is not used`);
		}
		assert.ok(/a:focus-visible\s*\{[^}]*outline/.test(style), 'links have no focus style');
		assert.ok(/a \{[^}]*text-decoration: underline/.test(style), 'links are told apart by colour alone');
	});

	test('has one h1 with the item name, h2 sections, definition lists and a labelled action list', () => {
		const html = renderDetailHtml(ready(buildChangeDetail(CHANGE_SELECTION), CHANGE_SELECTION));
		assert.strictEqual((html.match(/<h1>/g) ?? []).length, 1);
		assert.ok(html.includes(`<h1>${escapeHtml(`Fix ${PAYLOAD}`)}</h1>`));
		assert.ok((html.match(/<h2>/g) ?? []).length >= 2);
		assert.ok(html.includes('<dl class="fields">') && html.includes('<dt>Branch</dt>'));
		assert.ok(html.includes('<nav aria-label="Actions">'));
		assert.ok(html.includes('<html lang="en">'));
		for (const link of html.matchAll(/<a [^>]*>([^<]*)<\/a>/g)) {
			assert.ok(link[1].trim().length > 0, 'a link has no visible text');
		}
	});

	test('every link is a command from the allowed list, an https address, and carries the row id as its argument', () => {
		for (const [model, selection] of [
			[buildChangeDetail(CHANGE_SELECTION), CHANGE_SELECTION],
			[buildTrailDetail({ kind: 'trail', entry: ENTRY }), { kind: 'trail', entry: ENTRY }],
			[buildCommitDetail(COMMIT_SELECTION), COMMIT_SELECTION],
		] as const) {
			const html = renderDetailHtml(ready(model, selection));
			for (const href of hrefs(html).map(value => value.replace(/&amp;/g, '&'))) {
				if (href.startsWith('command:')) {
					const [id, query] = href.slice('command:'.length).split('?');
					assert.ok(isDetailCommand(id), `${id} is not an allowed command`);
					if (query !== undefined) {
						const args = JSON.parse(decodeURIComponent(query)) as unknown;
						assert.ok(Array.isArray(args) && args.every(arg => typeof arg === 'string'));
					}
				} else {
					assert.match(href, /^https:\/\//, `${href} is neither a command nor https`);
				}
			}
		}
		const html = renderDetailHtml(ready(buildChangeDetail(CHANGE_SELECTION), CHANGE_SELECTION));
		for (const id of ['entirely.trailApprove', 'entirely.trailComment', 'entirely.trailMerge', 'entirely.trailCheckout', 'entirely.trailLink', 'entirely.trailUnlink', 'entirely.retryDetail', 'entirely.openDetailInEditor']) {
			assert.ok(html.includes(`command:${id}`), `${id} is not offered for a change`);
		}
		assert.ok(html.includes(`command:entirely.trailApprove?${encodeURIComponent(JSON.stringify(['change:widgets/34']))}`));
	});

	test('an address that is not https is shown as text and never linked', () => {
		const html = renderDetailHtml(ready(buildTrailDetail({ kind: 'trail', entry: ENTRY }), { kind: 'trail', entry: ENTRY }));
		assert.ok(!hrefs(html).some(href => /^javascript:/i.test(href)));
		assert.ok(html.includes('javascript:alert(1)'), 'the address is still shown, as text');
	});

	test('the trail description is not in the page, only that there is one', () => {
		const html = renderDetailHtml(ready(buildTrailDetail({ kind: 'trail', entry: ENTRY }), { kind: 'trail', entry: ENTRY }));
		assert.ok(!html.includes('SECRET-BODY'));
		assert.ok(html.includes('Has a description'));
	});

	test('failed shows what went wrong with a Retry link, gone offers Refresh, loading says so', () => {
		const model = buildCommitDetail(COMMIT_SELECTION);
		const failed = renderDetailHtml({ kind: 'failed', selection: COMMIT_SELECTION, model, reason: 'timed out' });
		assert.ok(failed.includes('role="alert"') && failed.includes('<strong>Error.</strong>'));
		assert.ok(failed.includes('Could not load') && failed.includes('timed out'));
		assert.ok(failed.includes('>Retry</a>'));

		const gone = renderDetailHtml({ kind: 'gone', selection: COMMIT_SELECTION, model, reason: 'It is gone.' });
		assert.ok(gone.includes('href="command:entirely.refresh"') && gone.includes('<strong>Gone.</strong>'));

		const loading = renderDetailHtml({ kind: 'loading', selection: COMMIT_SELECTION, model });
		assert.ok(loading.includes('<strong>Loading.</strong>') && !loading.includes('>Retry</a>'));

		const fine = renderDetailHtml(ready(model, COMMIT_SELECTION));
		assert.ok(!fine.includes('class="note"'), 'a plain page has no note');
	});

	test('a cached answer says when it was read, and a failed refresh keeps the rows', () => {
		const model = buildCommitDetail(COMMIT_SELECTION);
		const at = new Date(2026, 9, 30, 10, 42, 3).getTime();
		const stale = renderDetailHtml({ kind: 'ready', selection: COMMIT_SELECTION, model, asOf: at, refreshing: true });
		assert.ok(stale.includes('As of 10:42:03, refreshing'));
		const failed = renderDetailHtml({ kind: 'ready', selection: COMMIT_SELECTION, model, asOf: at, refreshFailure: 'network down' });
		assert.ok(failed.includes('Could not refresh: network down') && failed.includes('<dt>Commit</dt>'));
	});

	test('a session shows its rows, links its transcript through a row, and offers no trail action', () => {
		const selection: Selection = { kind: 'session', session: { id: 'sess-1', agent: 'claude-code', status: 'ended', lastPrompt: PAYLOAD } };
		const model = buildSessionDetail(selection as Extract<Selection, { kind: 'session' }>, {
			session: { id: 'sess-1', agent: 'claude-code', status: 'ended', lastPrompt: PAYLOAD },
			info: { id: 'sess-1', agent: 'claude-code', status: 'ended', lastCheckpointId: 'a1b2c3d4e5f6' },
		});
		const html = renderDetailHtml(ready(model, selection));
		assert.ok(html.includes('command:entirely.openTranscript?' + encodeURIComponent(JSON.stringify(['sess-1']))));
		assert.ok(html.includes('command:entirely.explainCheckpoint'));
		assert.ok(!html.includes('entirely.trailApprove'));
		assert.deepStrictEqual(detailActions(model), []);
	});

	test('a commit with a hash can be copied, a session line cannot', () => {
		assert.deepStrictEqual(detailActions(buildCommitDetail(COMMIT_SELECTION)).map(action => action.command), ['entirely.copyCommitHash']);
		const bare = buildCommitDetail({ kind: 'commit', entry: { text: 'no hash here' } });
		assert.deepStrictEqual(detailActions(bare), []);
		assert.deepStrictEqual(detailActions(initialDetail({ kind: 'activity-session', entry: { text: 'x' } })), []);
	});

	test('rowLink follows a row command only when it is allowed and its arguments are text', () => {
		assert.strictEqual(rowLink({ label: 'a', value: 'b', command: { command: 'entirely.setUp', arguments: [] } }), 'command:entirely.setUp');
		assert.strictEqual(rowLink({ label: 'a', value: 'b', command: { command: 'workbench.action.quit', arguments: [] } }), undefined);
		assert.strictEqual(rowLink({ label: 'a', value: 'b', command: { command: 'entirely.openTranscript', arguments: [{ x: 1 }] } }), undefined);
		assert.strictEqual(rowLink({ label: 'a', value: 'b' }), undefined);
		assert.strictEqual(linkFor('entirely.retryDetail', []), 'command:entirely.retryDetail');
	});

	test('the allowed command list is exactly what the page can link to', () => {
		const found = new Set<string>();
		const models = [
			buildChangeDetail(CHANGE_SELECTION),
			buildTrailDetail({ kind: 'trail', entry: ENTRY }),
			buildCommitDetail(COMMIT_SELECTION),
		];
		for (const model of models) {
			for (const action of detailActions(model)) {
				found.add(action.command);
			}
		}
		for (const id of found) {
			assert.ok((DETAIL_COMMANDS as readonly string[]).includes(id));
		}
		assert.strictEqual(new Set(DETAIL_COMMANDS).size, DETAIL_COMMANDS.length);
		assert.ok(DETAIL_COMMANDS.every(id => id.startsWith('entirely.')));
	});
});
