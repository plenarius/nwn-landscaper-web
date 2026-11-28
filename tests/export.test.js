// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// What Export and Check paths send (export.js): the area's name and simple settings in the query string, its heights, paint and
// lists in the body.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { engine } from './browser.js';

const { Area } = await import('../js/area.js');
const { initExport, sendArea } = await import('../js/export.js');

let open = null;
let asked = 0;
initExport({
    area: () => {
        asked++;
        return open;
    },
    readOnly: () => false,
    view: { setMarkers() {} },
});

beforeEach(() => {
    engine.reset();
    asked = 0;
});

test('an export sends its lists in the body, and only its name and simple settings in the query string', async () => {
    const a = Area.create('ex', 3, 'flat');
    a.entrances.push({ id: 1, x: 10, y: 10, dir: 0, width: 4, depth: 4, floor: 0 });
    a.atmosphere.preset = 'golden';
    open = a;
    asked = 0;
    await sendArea('export');
    assert.equal(asked, 1, 'the area is read once');
    const [sent] = engine.exports;
    assert.equal(sent.path, '/api/export');
    assert.deepEqual([...sent.query.keys()].sort(), ['halo', 'module', 'name', 'shadow', 'tiles', 'tilesY']);
    assert.equal(sent.query.get('name'), 'ex');
    // The band's heights (the area's in their middle), then its paint, then the JSON.
    const b = a.band;
    assert.equal(sent.query.get('halo'), String(b.n));
    const at = b.heights.byteLength + b.materials.byteLength;
    const heights = new Float32Array(sent.body.slice(0, b.heights.byteLength).buffer);
    assert.deepEqual(heights, b.heights);
    assert.equal(heights[b.n * b.nx + b.n], a.heights[0]);
    assert.deepEqual(sent.body.slice(b.heights.byteLength, at), b.materials);
    const json = JSON.parse(new TextDecoder().decode(sent.body.slice(at)));
    assert.deepEqual(json.palette, a.palette);
    assert.deepEqual(json.water, a.water);
    assert.deepEqual(json.entrances, a.entrances);
    assert.equal(json.atmosphere.preset, 'golden');
    for (const key of ['objects', 'things', 'settings']) assert.ok(key in json, key);
});

test("a cave's kind and roof go in the query string", async () => {
    const a = Area.create('cv', 3, 'flat');
    a.kind = 'underground';
    a.roof = 6;
    open = a;
    await sendArea('check');
    const [sent] = engine.exports;
    assert.equal(sent.path, '/api/check');
    assert.equal(sent.query.get('kind'), 'underground');
    assert.equal(sent.query.get('roof'), '6');
    assert.equal(sent.query.has('entrances'), false);
});

/** Clicks Export and waits for it to finish (the button is enabled again). */
async function clickExport() {
    const btn = document.getElementById('btnExport');
    btn.disabled = false;
    await btn.onclick();
}

test('Export runs as a job and follows its progress until the report comes', async () => {
    open = Area.create('ex', 3, 'flat');
    const result = { name: 'ex', routes: { ok: 3, total: 3, long: 0 }, warnings: [] };
    let polls = 0;
    engine.routes.set('POST /api/export/job', () => [{ job: 1, running: true, progress: { step: 'preparing', done: 0, total: 0 } }, 202]);
    engine.routes.set('GET /api/export/job', () => {
        polls++;
        return polls < 2
            ? [{ job: 1, running: true, progress: { step: 'tiles', done: 4, total: 9, cached: 2, elapsed: 3, estimate: 10, left: 7 } }]
            : [{ job: 1, running: false, progress: { step: 'done', done: 9, total: 9, left: 0 }, result }];
    });
    await clickExport();
    assert.equal(polls, 2, 'asked until it ended');
    assert.equal(engine.exports.length, 0, 'not the blocking route');
    assert.ok(
        engine.log.some(l => l.startsWith('POST /api/export/job?name=ex&')),
        engine.log.join('\n'),
    );
    assert.equal(document.getElementById('report').hidden, false);
});

test('Export falls back to the blocking route on an engine without jobs', async () => {
    open = Area.create('ex', 3, 'flat');
    await clickExport();
    assert.equal(engine.exports.length, 1);
    assert.equal(engine.exports[0].path, '/api/export');
});

test('a cancelled export says so, not that it failed', async () => {
    open = Area.create('ex', 3, 'flat');
    engine.routes.set('POST /api/export/job', () => [{ job: 2, running: true, progress: { step: 'tiles', done: 1, total: 9 } }, 202]);
    engine.routes.set('GET /api/export/job', () => [
        { job: 2, running: false, cancelled: true, error: 'the export was cancelled', progress: { step: 'failed' } },
    ]);
    await clickExport();
    const body = document.getElementById('reportBody');
    assert.match(JSON.stringify(body.children.map(c => c.textContent)), /Export cancelled/);
});
