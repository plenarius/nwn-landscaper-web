// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The page as the desktop app opens it (`/?app`): desktop.js reads the address once, as the page loads, so this file loads the
// modules at that address. desktop.test.js has the rest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine } from './browser.js';

globalThis.location = new URL('http://127.0.0.1:8766/?app');
const { IN_APP, KEEP_BUFFER } = await import('../js/desktop.js');
const { NEEDS_ENGINE, api } = await import('../js/api.js');

test('the app\'s address puts the page in the app, and its messages name the app, not "landscaper serve"', async () => {
    assert.equal(IN_APP, true);
    // (Node's platform is not a Mac's, and the switch is off)
    assert.equal(KEEP_BUFFER, false);
    assert.match(NEEDS_ENGINE, /inside the app.*restart the app/);
    assert.doesNotMatch(NEEDS_ENGINE, /landscaper serve/);
    // (the request gets no answer, as when the engine's thread has stopped)
    engine.routes.set('GET /api/textures', () => {
        throw new TypeError('Failed to fetch');
    });
    const res = await api('/api/textures');
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /engine inside the app did not answer: restart the app/);
});
