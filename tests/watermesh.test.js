// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The water's surface (watermesh.js): over the shallows up to the bank, as landscaper's export draws it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './browser.js';

const { Area, SPACING, WET_DEPTH } = await import('../js/area.js');
const { waterMesh } = await import('../js/watermesh.js');
const { Band } = await import('../js/band.js');

/** The area points (x, y) the mesh's quads cover with water over ground, and the levels and depths there. */
function covered(area) {
    const { pos, depth } = waterMesh(area);
    const quads = [];
    for (let q = 0; q < pos.length; q += 18) {
        const xs = [pos[q], pos[q + 3], pos[q + 6]],
            ys = [area.sizeY - pos[q + 2], area.sizeY - pos[q + 8]];
        quads.push({
            x0: Math.min(...xs),
            x1: Math.max(...xs),
            y0: Math.min(...ys),
            y1: Math.max(...ys),
            level: pos[q + 1],
            depth: depth.slice(q / 3, q / 3 + 6),
        });
    }
    return quads;
}

/** 3 by 3 tiles: a lake to 6 m over ground at 5 m west of x = 15 m, a shelf under half of WET_DEPTH to x = 25 m, then a bank. */
function shelf() {
    const a = Area.create('ws', 3, 'flat', 5);
    for (let j = 0; j < a.ny; j++) for (let i = 0; i < a.nx; i++) a.heights[j * a.nx + i] = i < 24 ? 5 : i < 40 ? 6 - WET_DEPTH / 2 : 7;
    a.band = null;
    a.water = [{ i: 2, j: 2, level: 6 }];
    a.floodWater();
    return a;
}

test('the water runs on over the dry shallows up to the bank', () => {
    const a = shelf(),
        k = (i, j) => j * a.nx + i;
    // The shelf is dry to walk and paint...
    assert.ok(!Number.isNaN(a.waterLevel[k(10, 10)]));
    assert.ok(Number.isNaN(a.waterLevel[k(32, 10)]));
    assert.equal(a.depth(32, 10), 0);
    // ...but the surface runs on over it at the lake's level, to the cell where the bank comes up through it.
    assert.equal(a.surfaceLevel[k(32, 10)], 6);
    assert.ok(Number.isNaN(a.surfaceLevel[k(41, 10)]));
    const area = covered(a).filter(q => q.x0 >= 0 && q.x1 <= a.sizeX && q.y0 >= 0 && q.y1 <= a.sizeY);
    const reach = Math.max(...area.map(q => q.x1));
    assert.ok(Math.abs(reach - 40 * SPACING) < 1e-6, `reaches x = ${reach}`);
    assert.ok(area.every(q => q.level === 6));
    // Over the shelf a film; at the bank the ground is over the level, so the view draws nothing there.
    const over = q => area.find(c => c.x0 === q * SPACING && c.y0 === 5);
    assert.ok(over(32).depth.every(d => Math.abs(d - WET_DEPTH / 2) < 1e-6));
    assert.ok(over(39).depth.some(d => d < 0) && over(39).depth.some(d => d > 0));
});

test('the edge scenery and the band carry the surface, shallows too, out past the edge', () => {
    const a = shelf();
    const out = covered(a).filter(q => q.y1 <= 0);
    // Without a band the south boundary's water goes 50 m out wherever the edge is under the surface, the shelf included.
    assert.ok(out.length > 0);
    assert.ok(out.some(q => q.x0 === 32 * SPACING && q.depth.every(d => d > 0 && d < WET_DEPTH)));
    assert.ok(!out.some(q => q.x0 >= 40 * SPACING));
    // With a band, its own cells beyond the edge (filled from the edge, so the shelf carries on out under the surface).
    a.band = Band.fill(a);
    a.floodWater();
    const band = covered(a).filter(q => q.y1 <= 0);
    assert.ok(band.some(q => q.x0 === 32 * SPACING && q.y1 === -10 * SPACING && q.depth.every(d => d > 0 && d < WET_DEPTH)));
    assert.ok(!band.some(q => q.x0 >= 40 * SPACING && q.x1 <= a.sizeX));
});

test('a ford shallower than WET_DEPTH is a film in the river, not a dry gap', () => {
    const a = Area.create('wf', 3, 'flat', 5);
    // A river 2 m deep along x, with a ford 8 cm under its level across it at x = 15 m.
    for (let j = 0; j < a.ny; j++)
        for (let i = 0; i < a.nx; i++) a.heights[j * a.nx + i] = j < 20 || j > 28 ? 7 : i >= 23 && i <= 25 ? 6 - 0.08 : 4;
    a.water = [{ i: 2, j: 24, level: 6 }];
    a.floodWater();
    const k = (i, j) => j * a.nx + i;
    assert.ok(Number.isNaN(a.waterLevel[k(24, 24)]), 'the ford is dry to walk');
    assert.equal(a.surfaceLevel[k(24, 24)], 6);
    const ford = covered(a).find(q => q.x0 === 23 * SPACING && q.y0 === 24 * SPACING);
    assert.ok(ford, 'water over the ford');
    assert.ok(ford.depth.every(d => Math.abs(d - 0.08) < 1e-5));
    // The far side of the ford is the same body, under water as before.
    assert.ok(!Number.isNaN(a.waterLevel[k(40, 24)]));
});
