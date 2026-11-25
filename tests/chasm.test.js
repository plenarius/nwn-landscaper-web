// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Chasms (area.js, tools.js, export.js): the drop under the rim as the engine makes it, nobody walking in or beside one, water
// kept out, filling one in, undo, the JSON round trip and what an export sends.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine } from './browser.js';

const { Area, CHASM_DEPTH, chasmFade, CHASM_DARK } = await import('../js/area.js');
const { chasmStamp, chasmEdge } = await import('../js/tools.js');
const { initExport, sendArea } = await import('../js/export.js');

let open = null;
initExport({ area: () => open, readOnly: () => false, view: { setMarkers() {} } });

/** A flat 3 by 3 tile area at 5 m with a chasm of radius 4 m in its middle. */
function withChasm() {
    const a = Area.create('ch', 3, 'flat', 5);
    chasmStamp(a, 15, 15, 4, false);
    return a;
}

test('a chasm drops CHASM_DEPTH under its rim, wherever the rim is', () => {
    const a = withChasm();
    const mid = a.sampleAt(15, 15);
    assert.equal(a.isChasm(mid.i, mid.j), true);
    // Ground east of the chasm is higher: the samples nearest it drop from there.
    for (let j = 0; j < a.ny; j++) for (let i = a.sampleAt(15, 0).i; i < a.nx; i++) a.heights[j * a.nx + i] = 12;
    const fit = a.chasmFit();
    const k = mid.j * a.nx + mid.i;
    assert.equal(fit.deep[k], 1);
    // (the middle's nearest open ground is west of it, the breadth-first order going east first)
    const rims = new Set();
    for (let i = 0; i < a.nx; i++) {
        const s = mid.j * a.nx + i;
        if (a.chasm[s]) rims.add(fit.shown[s] + CHASM_DEPTH);
        else assert.equal(fit.shown[s], a.heights[s], 'open ground is drawn as it is');
    }
    assert.deepEqual(
        [...rims].sort((x, y) => x - y),
        [5, 12],
    );
    // The stored heights are left: filling it in brings the ground back.
    assert.equal(a.heights[k], 12);
});

test('nobody walks in a chasm or on its edge, and water never fills it', () => {
    const a = withChasm();
    const mid = a.sampleAt(15, 15);
    assert.equal(a.walkable(mid.i, mid.j), false);
    // The first open sample west of it: its neighbour drops away.
    let i = mid.i;
    while (a.isChasm(i, mid.j)) i--;
    assert.equal(a.walkable(i, mid.j), false);
    assert.equal(a.walkable(i - 1, mid.j), true);
    // A lake over the whole area stops at the chasm's edge.
    a.heights.fill(0);
    a.water.push({ i: 1, j: 1, level: 2 });
    a.floodWater();
    assert.equal(a.depth(1, 1), 2);
    assert.equal(a.depth(mid.i, mid.j), 0);
});

test('Shift-drag fills a chasm in, and undo opens it again', () => {
    const a = withChasm();
    const mid = a.sampleAt(15, 15);
    a.beginStroke();
    chasmStamp(a, 15, 15, 6, true);
    assert.equal(a.hasChasm(), false);
    assert.equal(a.chasmFit(), null);
    assert.equal(a.undo(), true);
    assert.equal(a.isChasm(mid.i, mid.j), true);
    // What the undo changed: the chasm's samples, their drawn heights too (the shadows follow them).
    assert.ok(a.lastChange.rect && a.lastChange.heights);
    assert.equal(a.redo(), true);
    assert.equal(a.hasChasm(), false);
});

test('a chasm along the edge goes all round the area, the brush size in', () => {
    const a = Area.create('ed', 3, 'flat', 5);
    chasmEdge(a, 4);
    const at = (x, y) => {
        const { i, j } = a.sampleAt(x, y);
        return a.isChasm(i, j);
    };
    for (const [x, y] of [
        [0, 15],
        [30, 15],
        [15, 0],
        [15, 30],
        [1, 1],
        [2, 28],
    ])
        assert.equal(at(x, y), true, `${x}, ${y}`);
    assert.equal(at(15, 15), false);
    assert.equal(at(8, 15), false);
});

test('a chasm survives the JSON round trip; an area without one saves none', () => {
    const a = withChasm();
    const back = Area.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    assert.deepEqual(back.chasm, a.chasm);
    const plain = Area.create('pl', 3, 'flat');
    assert.equal(plain.toJSON().chasm, null);
    assert.equal(Area.fromJSON(JSON.parse(JSON.stringify(plain.toJSON()))).chasm, null);
});

test('an export sends the chasm as runs of samples, and none without one', async () => {
    const a = withChasm();
    open = a;
    engine.reset();
    await sendArea('check');
    const at = a.heights.byteLength + a.materials.byteLength;
    const json = JSON.parse(new TextDecoder().decode(engine.exports[0].body.slice(at)));
    const mask = new Uint8Array(a.nx * a.ny);
    for (const [first, count] of json.chasm) mask.fill(1, first, first + count);
    assert.deepEqual(mask, a.chasm);
    open = Area.create('pl', 3, 'flat');
    engine.reset();
    await sendArea('check');
    const plain = JSON.parse(new TextDecoder().decode(engine.exports[0].body.slice(open.heights.byteLength + open.materials.byteLength)));
    assert.equal(plain.chasm, null);
});

test('the walls fade from lit at the rim to black from CHASM_DARK of the way down', () => {
    assert.equal(chasmFade(0), 1);
    assert.ok(chasmFade(0.3) > 0 && chasmFade(0.3) < 0.5);
    assert.equal(chasmFade(CHASM_DARK), 0);
    assert.equal(chasmFade(1), 0);
});
