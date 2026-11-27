// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Tile lights (area.js, lights.js, export.js): the brush's reach, turning them off, undo, the JSON round trip, what an export
// sends, the view's wash colours and the presets.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine } from './browser.js';

const { Area, MAX_LIGHT } = await import('../js/area.js');
const { lightStamp, lightFill, litTiles, lightTexels, lightKind, LIGHT_COLORS, LIGHT_PRESETS } = await import('../js/lights.js');
const { initExport, sendArea } = await import('../js/export.js');

/** Bytes of heights and paint an export of `a` sends before its JSON: its band's grids, with one (band.js). */
const grids = a => (a.band ? a.band.heights.byteLength + a.band.materials.byteLength : a.heights.byteLength + a.materials.byteLength);

let open = null;
initExport({ area: () => open, readOnly: () => false, view: { setMarkers() {} } });

const WARM = [30, 28];

test('the brush lights the tile under it, and the tiles whose middles it reaches', () => {
    const a = Area.create('li', 4, 'flat', 5, 3);
    assert.equal(a.lights, null, 'none until painted');
    // A small brush: the tile under it only, even with its middle out of reach.
    assert.equal(lightStamp(a, 11, 12, 1, WARM), true);
    assert.deepEqual(a.lightAt(1, 1), WARM);
    assert.equal(litTiles(a), 1);
    // The same again changes nothing.
    assert.equal(lightStamp(a, 11, 12, 1, WARM), false);
    // 11 m from (20, 20): the four tiles round that corner have their middles 7.1 m off; the next ring's are 15.8 m off.
    lightStamp(a, 20, 20, 11, [17, 16]);
    for (const [tx, ty] of [
        [1, 1],
        [2, 1],
        [1, 2],
        [2, 2],
    ])
        assert.deepEqual(a.lightAt(tx, ty), [17, 16], `${tx},${ty}`);
    assert.deepEqual(a.lightAt(0, 0), [0, 0]);
    assert.deepEqual(a.lightAt(3, 2), [0, 0]);
    // Off the area: nothing.
    assert.equal(lightStamp(a, -3, 5, 2, WARM), false);
    // Shift-drag turns them off.
    lightStamp(a, 20, 20, 11, [0, 0]);
    assert.equal(litTiles(a), 0);
    assert.equal(a.lightsForExport(), null, 'all off: none sent');
});

test('lights are one undo step a stroke', () => {
    const a = Area.create('lu', 3, 'flat');
    a.beginStroke();
    lightFill(a, WARM);
    a.beginStroke();
    lightStamp(a, 15, 15, 1, [0, 0]);
    assert.equal(litTiles(a), 8);
    a.undo();
    assert.equal(litTiles(a), 9);
    a.undo();
    assert.equal(litTiles(a), 0);
    a.redo();
    assert.deepEqual(a.lightAt(2, 2), WARM);
    a.redo();
    assert.deepEqual(a.lightAt(1, 1), [0, 0]);
});

test('lights survive the JSON round trip; a broken list is dropped, not half kept', () => {
    const a = Area.create('lj', 3, 'flat', 5, 4);
    lightStamp(a, 5, 35, 1, [31, 2]);
    const back = Area.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    assert.deepEqual(back.lightAt(0, 3), [31, 2]);
    assert.deepEqual(back.lights, a.lights);
    assert.equal(Area.create('lp', 3, 'flat').toJSON().lights, null);
    for (const bad of [[[1, 2]], Array(12).fill([MAX_LIGHT + 1, 0]), Array(12).fill([1]), Array(12).fill([1.5, 0]), 'orange']) {
        const o = { ...a.toJSON(), lights: bad };
        assert.equal(Area.fromJSON(JSON.parse(JSON.stringify(o))).lights, null, JSON.stringify(bad));
    }
});

test('an export sends a pair a tile, rows from the south, and none when every light is off', async () => {
    const a = Area.create('le', 3, 'flat', 5, 4);
    lightStamp(a, 25, 5, 1, WARM);
    lightStamp(a, 5, 35, 1, [17, 0]);
    open = a;
    engine.reset();
    await sendArea('check');
    const at = grids(a);
    const json = JSON.parse(new TextDecoder().decode(engine.exports[0].body.slice(at)));
    assert.equal(json.lights.length, 12);
    assert.deepEqual(json.lights[2], WARM, 'east tile of the south row');
    assert.deepEqual(json.lights[9], [17, 0], 'west tile of the north row');
    open = Area.create('lo', 3, 'flat');
    engine.reset();
    await sendArea('check');
    const plain = JSON.parse(new TextDecoder().decode(engine.exports[0].body.slice(grids(open))));
    assert.equal(plain.lights, null);
});

test("the view's wash adds a tile's two colours as the game lights with them", () => {
    const a = Area.create('lw', 3, 'flat');
    assert.equal(lightTexels(a), null);
    lightStamp(a, 15, 15, 1, WARM);
    const t = lightTexels(a);
    const k = (1 * 3 + 1) * 4;
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(t[k + c] - (LIGHT_COLORS[30].game[c] + LIGHT_COLORS[28].game[c])) < 1e-6);
    assert.equal(t[0], 0);
});

test('the colours are lightcolor.2da rows 0 to 31, and every preset suits some kind of area', () => {
    assert.equal(LIGHT_COLORS.length, 32);
    assert.equal(LIGHT_COLORS[31].name, 'Orange');
    assert.deepEqual(LIGHT_COLORS[0].game, [0, 0, 0]);
    for (const p of LIGHT_PRESETS) {
        assert.ok(
            p.lights.every(c => c >= 0 && c <= MAX_LIGHT),
            p.id,
        );
        assert.ok(p.kinds.length, p.id);
    }
    // The design's three: none outdoors by day, warm pools at night, cold blue in a cave.
    const kind = (k, night = false, time = 'cycle') => lightKind({ kind: k, atmosphere: { time } }, night);
    const suits = k => LIGHT_PRESETS.filter(p => p.kinds.includes(k)).map(p => p.id);
    assert.ok(suits(kind('surface')).includes('none'));
    assert.ok(suits(kind('surface', true)).includes('village'));
    assert.ok(suits(kind('surface', false, 'night')).includes('village'));
    assert.ok(suits(kind('underground')).includes('cave'));
});

test('lights and particles in one area: each keeps its own undo step, save and export', async () => {
    const a = Area.create('lb', 3, 'flat', 5);
    a.beginStroke();
    lightFill(a, WARM);
    a.beginStroke();
    a.ambience = [{ kind: 'fireflies', x: 12, y: 14, z: 5, scale: 1, seed: 3 }];
    // Undo takes the particles away and leaves the lights; redo brings them back.
    a.undo();
    assert.equal(a.ambience.length, 0);
    assert.equal(litTiles(a), 9);
    a.redo();
    assert.equal(a.ambience.length, 1);
    const back = Area.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    assert.deepEqual([back.lights, back.ambience], [a.lights, a.ambience]);
    open = a;
    engine.reset();
    await sendArea('check');
    const json = JSON.parse(new TextDecoder().decode(engine.exports[0].body.slice(grids(a))));
    assert.equal(json.lights.length, 9);
    assert.deepEqual(
        json.ambience.map(p => p.kind),
        ['fireflies'],
    );
});
