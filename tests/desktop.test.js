// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The desktop app against a browser (desktop.js, help.js): how the page knows where it runs, the app's Help menu and its
// requests, the drawing buffer kept on macOS, and a browser's page left as it is. desktop-app.test.js loads the page as the
// app opens it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine } from './browser.js';

const { inApp, onMac, keepBuffer, IN_APP, KEEP_BUFFER, KEEP_BUFFER_ON_MAC } = await import('../js/desktop.js');
const { initDesktop, OPENS } = await import('../js/help.js');
const { NEEDS_ENGINE } = await import('../js/api.js');
const $ = id => document.getElementById(id);

test('the app opens the page at /?app; any other address is a browser', () => {
    assert.equal(inApp('?app'), true);
    assert.equal(inApp('?app=1'), true);
    assert.equal(inApp('?debug&app'), true);
    assert.equal(inApp(''), false);
    assert.equal(inApp('?review=bob/area'), false);
    assert.equal(inApp('?apple'), false);
    // (this test file's page: http://landscaper.test/)
    assert.equal(IN_APP, false);
});

test('the drawing buffer is kept only in the app on macOS, and only once the switch is on', () => {
    assert.equal(onMac('MacIntel'), true);
    assert.equal(onMac('Win32'), false);
    assert.equal(onMac('Linux x86_64'), false);
    assert.equal(onMac(undefined), false);
    // Off until a real Mac needs it (DESIGN-desktop-app.md, "The empty view on macOS").
    assert.equal(KEEP_BUFFER_ON_MAC, false);
    assert.equal(keepBuffer(true, true), false);
    assert.equal(keepBuffer(true, true, true), true);
    assert.equal(keepBuffer(false, true, true), false);
    assert.equal(keepBuffer(true, false, true), false);
    assert.equal(KEEP_BUFFER, false);
});

test("in a browser the page stays as it was: the engine's link, no Help menu, the browser's words", () => {
    $('menuHelp').hidden = true;
    $('btnFolders').hidden = true;
    $('nowebglApp').hidden = true;
    initDesktop();
    assert.equal($('noEngineHow').hidden, false);
    assert.equal($('menuHelp').hidden, true);
    assert.equal($('btnFolders').hidden, true);
    assert.equal($('nowebglBrowser').hidden, false);
    assert.equal($('nowebglApp').hidden, true);
    assert.equal($('helpData').onclick, null);
    assert.match(NEEDS_ENGINE, /landscaper serve/);
});

test('in the app: no "How to start the engine", the Help menu and Game folders, and the app says restart it', () => {
    initDesktop(true);
    assert.equal($('noEngineHow').hidden, true);
    assert.match($('noEngineWhy').textContent, /inside the app.*Restart the app/);
    assert.doesNotMatch($('noEngineWhy').textContent, /landscaper serve/);
    assert.equal($('menuHelp').hidden, false);
    assert.equal($('btnFolders').hidden, false);
    assert.equal($('nowebglBrowser').hidden, true);
    assert.equal($('nowebglApp').hidden, false);
});

test("the app's items ask the engine inside it to open the data folder, the log and the game folders page", async () => {
    engine.reset();
    const asked = [];
    engine.routes.set('POST /api/app/open', (_u, opts) => {
        asked.push(JSON.parse(opts.body).what);
        return [{}];
    });
    initDesktop(true);
    for (const id of Object.keys(OPENS)) assert.equal(await $(id).onclick(), true, id);
    assert.deepEqual(asked, ['data', 'log', 'folders']);
});

test("an engine that can't open it (a browser's, or an older app's) says so in the report box", async () => {
    engine.reset(); // (no /api/app/open: 404 with its error)
    $('report').hidden = true;
    initDesktop(true);
    assert.equal(await $('helpLog').onclick(), false);
    assert.equal($('report').hidden, false);
    assert.equal($('reportBody').children[0].textContent, "Couldn't open the log");
    assert.match($('reportBody').children[1].textContent, /no \/api\/app\/open/);
});
