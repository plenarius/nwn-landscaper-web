// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The app's updates in the version menu (update.js): what the item says for each answer of the app, the question before an
// install, and nothing at all in a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine } from './browser.js';
import { questions } from './stubs/ask.js';

const { describeUpdate, plainNotes, initUpdate, refresh } = await import('../js/update.js');
const $ = id => document.getElementById(id);

test('the item: Update to X.Y.Z when the app installs it, a link to the release when it is a .deb or a bare program', () => {
    assert.equal(describeUpdate(null), null);
    assert.equal(describeUpdate({ state: 'checking' }), null);
    assert.equal(describeUpdate({ state: 'none' }), null);
    const install = describeUpdate({ state: 'available', version: '0.8.0', how: 'install', error: null });
    assert.equal(install.label, 'Update to 0.8.0');
    assert.equal(install.url, undefined);
    const deb = describeUpdate({ state: 'available', version: '0.8.0', how: 'deb' });
    assert.equal(deb.label, "Download 0.8.0's .deb");
    assert.equal(deb.url, 'https://github.com/plenarius/nwn-landscaper/releases/tag/v0.8.0');
    assert.match(deb.title, /installing the new \.deb/);
    assert.equal(describeUpdate({ state: 'available', version: '0.8.0', how: 'download' }).label, 'Download 0.8.0');
    const busy = describeUpdate({ state: 'installing', version: '0.8.0', done: 512, total: 1024 });
    assert.equal(busy.label, 'Updating to 0.8.0… 50%');
    assert.equal(busy.busy, true);
    assert.equal(describeUpdate({ state: 'installing', version: '0.8.0', done: 5, total: null }).label, 'Updating to 0.8.0…');
});

test('release notes read as plain paragraphs in the question', () => {
    const md = '## Engine\n\n- **Updates** come through the app. See [the handbook](https://x/).\n- `latest.json` is new.\n';
    assert.equal(plainNotes(md), 'Engine:\n\nUpdates come through the app. See the handbook.\n\nlatest.json is new.');
    assert.equal(plainNotes(null), '');
});

test('in a browser nothing asks the app', async () => {
    engine.reset();
    initUpdate(false);
    await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(engine.log, []);
});

test('in the app: the item shows, asks with the notes, and only a yes installs', async () => {
    engine.reset();
    let installs = 0;
    let state = { state: 'available', version: '0.8.0', notes: '- Faster.', how: 'install', error: null };
    engine.routes.set('GET /api/app/update', () => [state]);
    engine.routes.set('POST /api/app/update', () => {
        installs++;
        state = { state: 'installing', version: '0.8.0', done: 0, total: 100 };
        return [{}, 202];
    });
    await refresh();
    assert.equal($('appUpdate').hidden, false);
    const item = $('appUpdate').children[0];
    assert.equal(item.textContent, 'Update to 0.8.0');
    questions.answers.push(null);
    await item.onclick();
    assert.deepEqual(questions.asked.slice(-1), ['Update to 0.8.0?']);
    assert.equal(installs, 0);
    questions.answers.push(true);
    await item.onclick();
    // (once started, the menu asks the app again and shows the download)
    await new Promise(r => setTimeout(r, 10));
    assert.equal(installs, 1);
    assert.equal($('appUpdate').children[0].textContent, 'Updating to 0.8.0… 0%');
    assert.equal($('appUpdate').children[0].disabled, true);
    state = { state: 'none' };
    await refresh();
    assert.equal($('appUpdate').hidden, true);
});
