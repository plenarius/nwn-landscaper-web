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
    assert.deepEqual([...sent.query.keys()].sort(), ['module', 'name', 'shadow', 'tiles', 'tilesY']);
    assert.equal(sent.query.get('name'), 'ex');
    // Heights, then paint, then the JSON.
    const at = a.heights.byteLength + a.materials.byteLength;
    assert.deepEqual(new Float32Array(sent.body.slice(0, a.heights.byteLength).buffer), a.heights);
    assert.deepEqual(sent.body.slice(a.heights.byteLength, at), a.materials);
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
