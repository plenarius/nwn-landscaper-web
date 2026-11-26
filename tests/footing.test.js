// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Where an object meets the ground (footing.js), and what Scatter's "Not on steep ground or water" checks (scatter.js): an object
// stands on the ground under its base, not under its whole bounding box.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './browser.js';

const { baseOf, basePoints, groundUnder, BASE_BAND } = await import('../js/footing.js');
const { Area, SPACING } = await import('../js/area.js');
const { groundSuits } = await import('../js/scatter.js');

/** An upright quad from (x0, y) to (x1, y), z0 to z1, as two triangles. */
const quad = (x0, x1, y, z0, z1) => [
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z0],
    [x1, y, z1],
    [x0, y, z1],
];

/** A tree: a trunk 0.6 m wide from the ground to 4 m, and a crown 8 m wide from 3 m to 8 m. */
function tree(footprint = []) {
    const positions = [...quad(-0.3, 0.3, 0, 0, 4), ...quad(-0.3, 0.3, 0.1, 0, 4), ...quad(-4, 4, 0, 3, 8), ...quad(0, 0.1, -4, 3, 8)];
    positions.push([0, 4, 5]);
    return { positions, footprint, min: [-4, -4, 0], max: [4, 4, 8] };
}

/** Ground rising 0.5 m a metre to the east. */
const slope = x => x * 0.5;
const heightAt = x => slope(x);

/** What the editor did before: the lowest ground under the corners of the whole bounding box, and its middle. */
function underBox(o, flat) {
    const corners = [
        [flat.min[0], flat.min[1]],
        [flat.max[0], flat.min[1]],
        [flat.min[0], flat.max[1]],
        [flat.max[0], flat.max[1]],
        [0, 0],
    ];
    return Math.min(...corners.map(([x, y]) => heightAt(o.x + x * o.scale, o.y + y * o.scale)));
}

test('a wide-crowned tree on a slope stands on its trunk, not sunk to its crown', () => {
    const flat = tree();
    const o = { x: 20, y: 20, bearing: 0, scale: 1 };
    const base = baseOf(flat);
    // The trunk's width, and the band's height of the crown's triangles left out.
    assert.deepEqual(base, { min: [-0.3, 0], max: [0.3, 0.1] });
    const z = groundUnder(o, flat, heightAt);
    assert.equal(z, slope(19.7));
    // The whole box put it 2 m below the trunk's ground (4 m out under the crown, at 0.5 m a metre).
    assert.equal(underBox(o, flat), slope(16));
    assert.ok(z - underBox(o, flat) > 1.8);
});

test('a model with a footprint stands on the footprint', () => {
    const flat = tree([
        [
            [-0.5, -0.5],
            [0.5, -0.5],
            [0.5, 0.5],
        ],
        [
            [-0.5, -0.5],
            [0.5, 0.5],
            [-0.5, 0.5],
        ],
    ]);
    assert.deepEqual(baseOf(flat), { min: [-0.5, -0.5], max: [0.5, 0.5] });
    assert.equal(groundUnder({ x: 20, y: 20, bearing: 0, scale: 2 }, flat, heightAt), slope(19));
});

test('without a footprint, a triangle crossing the band counts up to the band', () => {
    // A cone-like bush drawn as one triangle: 2 m wide at the ground, a point at 2 m. Its base is its width at BASE_BAND.
    const flat = {
        positions: [
            [-1, 0, 0],
            [1, 0, 0],
            [0, 0, 2],
        ],
        footprint: [],
        min: [-1, 0, 0],
        max: [1, 0, 2],
    };
    assert.deepEqual(baseOf(flat), { min: [-1, 0], max: [1, 0] });
    // Lifted off the ground by a stalk: only the cross-section at the band counts, not the bottom of the stalk's box.
    const lifted = {
        positions: [
            [0, 0, 0],
            [0, 0.1, 0],
            [-3, 0, 6],
        ],
        footprint: [],
        min: [-3, 0, 0],
        max: [0, 0.1, 6],
    };
    const base = baseOf(lifted);
    assert.ok(Math.abs(base.min[0] + BASE_BAND / 2) < 1e-9, `${base.min[0]}`);
    assert.equal(base.max[0], 0);
});

test('a model with no triangles and no footprint stands on the ground at its origin', () => {
    const flat = { positions: [], footprint: [], min: [0, 0, 0], max: [0, 0, 0] };
    assert.equal(baseOf(flat), null);
    assert.deepEqual(basePoints({ x: 3, y: 4, bearing: 1, scale: 1 }, flat), [[3, 4]]);
    assert.equal(groundUnder({ x: 3, y: 4, bearing: 1, scale: 1 }, flat, heightAt), slope(3));
});

test('the base turns with the bearing and grows with the scale', () => {
    const flat = tree();
    // Turned a quarter: the trunk's 0.6 m runs north, so the ground east of it no longer drops under it.
    const pts = basePoints({ x: 20, y: 20, bearing: Math.PI / 2, scale: 2 }, flat);
    for (const [x, y] of pts) {
        assert.ok(x >= 19.8 - 1e-9 && x <= 20 + 1e-9, `${x}`);
        assert.ok(y >= 19.4 - 1e-9 && y <= 20.6 + 1e-9, `${y}`);
    }
});

test("Scatter's water test looks under the base's corners, not only its middle", () => {
    // Ground rising east from 4 m (0.2 m a metre), water at 6 m: the shore (WET_DEPTH deep) is at x = 9.25.
    const a = Area.create('shore', 3, 'flat', 5);
    for (let j = 0; j < a.ny; j++) for (let i = 0; i < a.nx; i++) a.heights[j * a.nx + i] = 4 + i * SPACING * 0.2;
    a.water = [{ i: 0, j: 24, level: 6 }];
    a.floodWater();
    const rock = {
        positions: quad(-2, 2, 0, 0, 1),
        footprint: [],
        min: [-2, 0, 0],
        max: [2, 0, 1],
    };
    // Its middle on dry ground, 1.5 m from the shore; 2 m to the west, its edge is in the water.
    const o = { x: 10.75, y: 15, bearing: 0, scale: 1 };
    const { i, j } = a.sampleAt(o.x, o.y);
    assert.ok(a.walkable(i, j) && a.depth(i, j) === 0);
    assert.equal(groundSuits(a, o, rock), false);
    // Turned to run north and south along the shore, it stays dry.
    assert.equal(groundSuits(a, { ...o, bearing: Math.PI / 2 }, rock), true);
});
