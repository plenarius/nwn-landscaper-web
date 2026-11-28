// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Scenery on the band past the area's edge: the mix painting it without a seam, its ground for Scatter, where placed objects may
// stand, and "Carry the scenery outward" (carry.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './browser.js';

const { Area, SPACING, MAX_RISE } = await import('../js/area.js');
const { Band } = await import('../js/band.js');
const { mixPlan, mixStamp } = await import('../js/mix.js');
const { keepPlaced } = await import('../js/footing.js');
const { carryOutward, REACH } = await import('../js/carry.js');
const { onBand } = await import('../js/report.js');

/** A flat 4 by 4 area (40 m) with its band. */
function flat() {
    const a = Area.create('bs', 4, 'flat', 5);
    a.heights.fill(0);
    a.band = Band.fill(a);
    return a;
}

/** Numbers in [0, 1) from `seed`, the same each run (mulberry32). */
function seeded(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A model with a 0.6 m trunk. */
const TRUNK = {
    footprint: [
        [
            [-0.3, -0.3],
            [0.3, -0.3],
            [0.3, 0.3],
            [-0.3, 0.3],
        ],
    ],
};

test("the mix paints the band with the area's patches, so they run on across the edge, and undo takes it back", () => {
    const a = flat(),
        b = a.band;
    const plan = mixPlan(
        {
            textures: [
                { id: 'grass', weight: 5 },
                { id: 'dirt', weight: 5 },
                { id: 'rock', weight: 5 },
            ],
            patch: 3,
            soft: false,
            seed: 7,
        },
        ['grass', 'dirt', 'rock'].map(id => a.materialIndex(id)),
    );
    a.beginStroke();
    b.sync(a);
    const o = b.offset;
    // A brush over the west edge: the area stamped, and the band at the same point.
    mixStamp(a, 0, 20, 8, 1, plan);
    mixStamp(b, o, 20 + o, 8, 1, plan, o);
    // Along the edge, the band's middle (the area's samples) took what the area did: the patches are the same ground.
    for (let j = 20; j < 44; j++) assert.equal(b.materials[(j + b.n) * b.nx + b.n], a.materials[j * a.nx], `row ${j}`);
    // And past the edge it painted the band with all three, in patches.
    const past = new Set();
    for (let j = b.n + 20; j < b.n + 44; j++) for (let i = b.n - 10; i < b.n; i++) past.add(b.materials[j * b.nx + i]);
    for (const k of plan.indices) assert.ok(past.has(k), `texture ${k} past the edge`);
    const painted = b.materials.slice();
    a.undo();
    assert.notDeepEqual(b.materials, painted);
    a.redo();
    assert.deepEqual(b.materials, painted);
});

test("past the edge, the ground objects stand on is the band's, and Scatter keeps off its steep ground and water", () => {
    const a = flat(),
        b = a.band;
    assert.ok(a.beyond(-1, 5) && !a.beyond(1, 5) && a.beyond(5, a.sizeY + 1));
    assert.ok(a.onGround(-b.offset + 0.5, 5, 0.5) && !a.onGround(-b.offset + 0.4, 5, 0.5));
    assert.ok(!Area.create('cv', 4, 'cave').onGround(-0.1, 5), 'without a band, only the area');
    // A hill west of the area: its ground is read there, with the area's own edge where they meet.
    for (let j = 0; j < b.ny; j++) for (let i = 0; i < 40; i++) b.heights[j * b.nx + i] = 3;
    assert.equal(a.groundAt(-40, 10), 3);
    assert.equal(a.groundAt(-SPACING / 2, 10), 0, "the band's samples next to the edge are still flat");
    assert.ok(a.firmAt(-30, 10) && a.firmAt(-10, 10));
    // A cliff: steeper than walkable ground.
    for (let j = 0; j < b.ny; j++) b.heights[j * b.nx + 50] = 3 + MAX_RISE * 3;
    assert.ok(!a.firmAt(50 * SPACING - b.offset, 10));
    // Water flooding on into the band.
    b.waterLevel[(b.n + 10) * b.nx + 70] = 1;
    assert.ok(!a.firmAt(70 * SPACING - b.offset, 10 * SPACING));
});

test('baked scenery may stand anywhere on the band, a placeable only inside the area', () => {
    const a = flat();
    assert.deepEqual(keepPlaced(a, { baked: true }, -20, 5), [-20, 5]);
    assert.deepEqual(keepPlaced(a, { baked: true }, -60, a.sizeY + 70), [-50, a.sizeY + 50]);
    assert.deepEqual(keepPlaced(a, { baked: false }, -5, 5), [0, 5]);
    assert.deepEqual(keepPlaced(a, { baked: false }, 12, 50), [12, a.sizeY]);
    // A cave has no band: everything stays inside.
    const cave = Area.create('cv', 4, 'cave');
    assert.deepEqual(keepPlaced(cave, { baked: true }, -5, 5), [0, 5]);
});

test('carrying the scenery outward copies what stands near the edge, there and alike, and only on firm ground', () => {
    const a = flat(),
        b = a.band,
        r = seeded(3);
    // A wood along the west edge (two kinds, about 6 per 100 m²), nothing near the east edge.
    for (let k = 0; k < 60; k++)
        a.objects.push({
            id: k,
            model: k % 3 ? 'oak' : 'pine',
            x: 1 + r() * 9,
            y: 1 + r() * 38,
            z: 0,
            bearing: 0,
            scale: 1.2,
            solid: true,
            baked: true,
        });
    // A lake far out west, and a cliff to the north-west.
    for (let j = b.n; j < b.n + 16; j++) for (let i = 4; i < 24; i++) b.waterLevel[j * b.nx + i] = 2;
    const flats = new Map([
        ['oak', TRUNK],
        ['pine', TRUNK],
    ]);
    const before = a.objects.length;
    const added = carryOutward(a, flats, seeded(11));
    assert.equal(a.objects.length, before, 'it only plans: the caller adds them, in one undo step');
    assert.ok(added.length > 40, `${added.length} added`);
    for (const o of added) {
        assert.ok(a.beyond(o.x, o.y), `(${o.x}, ${o.y}) past the edge`);
        assert.ok(a.onGround(o.x, o.y, 0.5));
        assert.ok(o.baked && ['oak', 'pine'].includes(o.model));
        assert.ok(o.scale >= 1.2 * 0.85 - 1e-6 && o.scale <= 1.2 * 1.15 + 1e-6);
        assert.ok(a.firmAt(o.x, o.y));
        assert.equal(o.z, 0);
    }
    // West of the wood, not east of the bare side; both kinds, in about the wood's proportion.
    const west = added.filter(o => o.x < 0 && o.y > 0 && o.y < a.sizeY).length,
        east = added.filter(o => o.x > a.sizeX).length;
    assert.ok(west > 30 && east === 0, `west ${west}, east ${east}`);
    const pines = added.filter(o => o.model === 'pine').length / added.length;
    assert.ok(pines > 0.15 && pines < 0.55, `pines ${pines}`);
    // Nothing in the lake.
    assert.ok(!added.some(o => o.x > -50 + 4 * SPACING + 0.7 && o.x < -50 + 24 * SPACING - 0.7 && o.y > 0.7 && o.y < 16 * SPACING - 0.7));
    // Thinner towards the rim than by the edge.
    // (over a few tries: a handful of trees either way is chance)
    let near = 0,
        far = 0;
    for (let seed = 20; seed < 30; seed++)
        for (const o of carryOutward(a, flats, seeded(seed))) {
            if (o.y < 12 || o.y > 38) continue;
            if (o.x > -20 && o.x < 0) near++;
            if (o.x < -30) far++;
        }
    assert.ok(far < near, `near ${near}, far ${far}`);
    // Pressing again finds the band already stocked: few more.
    a.objects.push(...added);
    assert.ok(carryOutward(a, flats, seeded(12)).length < added.length / 3);
    assert.equal(onBand(a), added.length);
});

test('carrying does nothing without objects near the edge, or without a band', () => {
    const a = Area.create('wide', 8, 'flat', 5);
    a.band = Band.fill(a);
    assert.deepEqual(carryOutward(a, new Map()), []);
    // One oak in the middle of an 80 m area: further than REACH from every edge.
    a.objects.push({ id: 1, model: 'oak', x: 40, y: 40, z: 0, bearing: 0, scale: 1, baked: true });
    assert.ok(40 > REACH);
    assert.deepEqual(carryOutward(a, new Map([['oak', TRUNK]]), seeded(1)), []);
    const cave = Area.create('cv', 4, 'cave');
    cave.objects.push({ id: 1, model: 'oak', x: 1, y: 1, z: 0, bearing: 0, scale: 1, baked: true });
    assert.deepEqual(carryOutward(cave, new Map([['oak', TRUNK]])), []);
});
