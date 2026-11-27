// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The band round an area (band.js): its first fill, its save, brushes past the edge and their undo, water running into it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './browser.js';

const { Area, SPACING } = await import('../js/area.js');
const { Band, BAND } = await import('../js/band.js');
const { stamp } = await import('../js/tools.js');

/** A 3 by 3 area whose heights rise to the east, one sample's metres a sample. */
function ramp() {
    const a = Area.create('bd', 3, 'flat', 5);
    for (let k = 0; k < a.heights.length; k++) a.heights[k] = k % a.nx;
    a.materials.fill(0);
    a.materials[a.nx - 1] = a.materialIndex('dirt');
    a.band = Band.fill(a);
    return a;
}

test("a new area has a band, a cave doesn't, and the first fill carries the edge straight out", () => {
    assert.ok(Area.create('n1', 3, 'flat').band);
    assert.equal(Area.create('n2', 3, 'cave').band, null);
    const a = ramp(),
        b = a.band;
    assert.equal(b.n, BAND);
    assert.equal(b.nx, a.nx + 2 * BAND);
    // West of the area: its west edge's height; east: its east edge's; the corner: the corner's.
    assert.equal(b.heights[(BAND + 5) * b.nx], 0);
    assert.equal(b.heights[(BAND + 5) * b.nx + b.nx - 1], a.nx - 1);
    assert.equal(b.heights[0], 0);
    assert.equal(b.materials[b.nx - 1], a.materials[a.nx - 1]);
    // Area point (-10, 5) is in the band, at the edge's height.
    assert.equal(b.heightAt(-10, 5), 0);
    assert.equal(b.heightAt(a.sizeX + 10, 5), a.nx - 1);
});

test('an area saved before bands gets its first fill, and a band keeps through a save', () => {
    const a = ramp();
    const old = a.toJSON();
    delete old.band;
    const back = Area.fromJSON(JSON.parse(JSON.stringify(old)));
    assert.ok(back.band, 'an old area gets its band');
    assert.equal(back.band.heights[(BAND + 3) * back.band.nx + back.band.nx - 1], a.nx - 1);
    a.band.heights[0] = 42;
    const kept = Area.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    assert.equal(kept.band.heights[0], 42);
    // A band of another size (the area resized since) is filled again.
    assert.equal(Band.fromJSON({ n: 16, heights: a.toJSON().band.heights }, a), null);
});

test('a brush past the edge shapes the band, and undo takes it back with the area', () => {
    const a = ramp(),
        b = a.band;
    a.beginStroke();
    // Raise 10 m west of the area's south-west corner, as strokes.js stamps the band.
    b.sync(a);
    const r = stamp(b, 'raise', -10 + b.offset, 5 + b.offset, 4, 1, 0.1);
    assert.ok(r);
    const k = Math.round((5 + b.offset) / SPACING) * b.nx + Math.round((-10 + b.offset) / SPACING);
    const raised = b.heights[k];
    assert.ok(raised > 0, `${raised}`);
    // The area itself is untouched.
    assert.equal(a.heights[0], 0);
    assert.ok(a.undo());
    assert.equal(b.heights[k], 0);
    assert.ok(a.redo());
    assert.equal(b.heights[k], raised);
});

test('a lake at the edge runs on into the band as far as its ground is lower', () => {
    const a = Area.create('lk', 3, 'flat', 5);
    a.band = Band.fill(a);
    // A hollow along the west edge, carried out by the first fill; the band rises 20 m out.
    for (let j = 0; j < a.ny; j++) for (let i = 0; i < 8; i++) a.heights[j * a.nx + i] = 3;
    a.band = Band.fill(a);
    const b = a.band;
    for (let j = 0; j < b.ny; j++) for (let i = 0; i < BAND - 32; i++) b.heights[j * b.nx + i] = 9;
    a.water = [{ i: 2, j: 20, level: 4 }];
    a.floodWater();
    assert.equal(b.waterLevel[(BAND + 20) * b.nx + BAND - 10], 4, 'wet 6 m out');
    assert.ok(Number.isNaN(b.waterLevel[(BAND + 20) * b.nx + 10]), "dry on the band's high ground");
});
