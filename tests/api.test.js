// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// api(): while an admin looks at someone else's workspace, nothing that could change one is sent (the engine would apply it
// to the admin's own).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine } from './browser.js';

const { api, viewing } = await import('../js/api.js');

test("in someone else's workspace, only reads and the requests that change nothing are sent", async () => {
    engine.reset();
    viewing.user = 'bob';
    const refused = await api('/api/script-save?resref=my_spawn', { method: 'POST', body: '// x' });
    assert.equal(refused.status, 503);
    assert.match((await refused.json()).error, /bob's workspace is read-only/);
    await api('/api/new-blueprint-delete?ext=utc&resref=guard01', { method: 'post' });
    await api('/api/areas');
    await api('/api/check?name=aa', { method: 'POST' });
    await api('/api/view-as?user=', { method: 'POST' });
    assert.deepEqual(engine.log, ['GET /api/areas', 'POST /api/check?name=aa', 'POST /api/view-as?user=']);
    viewing.user = null;
    await api('/api/script-save?resref=my_spawn', { method: 'POST', body: '// x' });
    assert.equal(engine.log.at(-1), 'POST /api/script-save?resref=my_spawn');
});
