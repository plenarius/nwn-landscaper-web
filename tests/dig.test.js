// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Dig (tools.js): outdoors its edge is a steep bank, not a saw-tooth of drops straight down; in a cave its walls stay straight.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './browser.js';

const { Area, SPACING } = await import('../js/area.js');
const { stamp } = await import('../js/tools.js');

/** Digs a stroke from (10, 15) to (20, 15), 4 m radius, down to `floor`. */
function stroke(a, floor) {
    for (let x = 10; x <= 20; x += 0.5) stamp(a, 'dig', x, 15, 4, 1, 1 / 60, floor, a.materialIndex('dirt'));
}

/** The biggest height difference between neighbouring samples. */
function steepest(a) {
    const { nx, ny, heights: h } = a;
    let most = 0;
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            if (i + 1 < nx) most = Math.max(most, Math.abs(h[j * nx + i] - h[j * nx + i + 1]));
            if (j + 1 < ny) most = Math.max(most, Math.abs(h[j * nx + i] - h[(j + 1) * nx + i]));
        }
    }
    return most;
}

test('outdoors a dug edge is a bank, no drop steeper than about 63 degrees', () => {
    const a = Area.create('dg', 3, 'flat', 12);
    stroke(a, 4);
    const mid = a.sampleAt(15, 15);
    assert.equal(a.heights[mid.j * a.nx + mid.i], 4, 'the middle is dug to the floor');
    assert.ok(steepest(a) <= 2 * SPACING + 1e-6, `steepest step ${steepest(a).toFixed(2)} m`);
    // The bank climbs back to the ground 4 m (8 m up at 2:1) beyond the edge, and leaves the ground alone further out.
    const far = a.sampleAt(15, 15 + 4 * 1.2 + 4 + 1);
    assert.equal(a.heights[far.j * a.nx + far.i], 12);
    const banked = a.sampleAt(15, 15 + 4 * 1.2 + 1);
    const z = a.heights[banked.j * a.nx + banked.i];
    assert.ok(z > 4 && z < 12, `on the bank: ${z}`);
});

test('a second pass and the stroke backwards cut the same bank', () => {
    const a = Area.create('dg', 3, 'flat', 12);
    stroke(a, 4);
    const once = Float32Array.from(a.heights);
    stroke(a, 4);
    assert.deepEqual(a.heights, once);
    const b = Area.create('dg', 3, 'flat', 12);
    for (let x = 20; x >= 10; x -= 0.5) stamp(b, 'dig', x, 15, 4, 1, 1 / 60, 4, b.materialIndex('dirt'));
    assert.deepEqual(b.heights, once);
});

test('the bank only lowers: ground under it stays, and the bank is left the colour it was', () => {
    const a = Area.create('dg', 3, 'flat', 5);
    const before = Uint8Array.from(a.materials);
    stroke(a, 4);
    for (let k = 0; k < a.heights.length; k++) assert.ok(a.heights[k] <= 5);
    const banked = a.sampleAt(15, 15 + 4 * 1.25 + 0.3);
    const k = banked.j * a.nx + banked.i;
    assert.equal(a.materials[k], before[k]);
});

test("in a cave Dig's walls still go straight down", () => {
    const a = Area.create('cv', 3, 'cave', 5);
    stroke(a, 5);
    assert.ok(steepest(a) >= 5.9, 'a wall drops the whole rock height in one sample');
    const far = a.sampleAt(15, 15 + 4 * 1.2 + 1);
    assert.equal(a.heights[far.j * a.nx + far.i], a.roof);
});
