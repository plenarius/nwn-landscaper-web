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

test("a new area has a band, a cave doesn't, and the first fill carries the edge out", () => {
    assert.ok(Area.create('n1', 3, 'flat').band);
    assert.equal(Area.create('n2', 3, 'cave').band, null);
    const a = ramp(),
        b = a.band;
    assert.equal(b.n, BAND);
    assert.equal(b.nx, a.nx + 2 * BAND);
    // West of the area: its west edge's height; east: its east edge's (where the edge is the same far along it).
    const near = (v, want) => assert.ok(Math.abs(v - want) < 0.01, `${v}, not ${want}`);
    near(b.heights[(BAND + 20) * b.nx + BAND - 10], 0);
    near(b.heights[(BAND + 20) * b.nx + b.nx - BAND + 9], a.nx - 1);
    assert.equal(b.materials[b.nx - 1], a.materials[a.nx - 1]);
    // Area point (-10, 5) is in the band, at the edge's height.
    near(b.heightAt(-10, 5), 0);
    near(b.heightAt(a.sizeX + 10, 5), a.nx - 1);
});

test('an area saved before bands gets its first fill, and a band keeps through a save', () => {
    const a = ramp();
    const old = a.toJSON();
    delete old.band;
    const back = Area.fromJSON(JSON.parse(JSON.stringify(old)));
    assert.ok(back.band, 'an old area gets its band');
    assert.equal(back.band.heights[(BAND + 20) * back.band.nx + back.band.nx - BAND + 19], a.nx - 1);
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
    const raised = b.heights[k],
        was = Band.fill(a).heights[k];
    assert.ok(raised > was, `${raised}`);
    // The area itself is untouched.
    assert.equal(a.heights[0], 0);
    assert.ok(a.undo());
    assert.equal(b.heights[k], was);
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

test('the first fill eases the bumps along the edge into slopes, the strip by the edge matching it', () => {
    const a = Area.create('ez', 4, 'flat', 5);
    a.heights.fill(1);
    // Ridges along the west edge: 2 m up every other pair of samples, as a hilly edge has at the sample's scale.
    for (let j = 0; j < a.ny; j++) a.heights[j * a.nx] = j % 4 < 2 ? 2 : 0;
    const b = Band.fill(a);
    const column = i => Array.from({ length: 30 }, (_, k) => b.heights[(BAND + 20 + k) * b.nx + i]);
    const spread = v => Math.max(...v) - Math.min(...v);
    assert.deepEqual(
        column(BAND - 1),
        Array.from({ length: 30 }, (_, k) => ((20 + k) % 4 < 2 ? 2 : 0)),
        'the strip by the edge is the edge',
    );
    assert.ok(spread(column(BAND - 20)) < 0.3, `20 samples out: ${spread(column(BAND - 20))}`);
    assert.ok(spread(column(10)) < 0.2, `70 samples out: ${spread(column(10))}`);
    // The paint is still the nearest edge sample's.
    assert.deepEqual(b.materials, Band.extruded(a).materials);
});

test('a band saved as the old first fill left it is filled again; one someone shaped is kept', () => {
    const a = Area.create('rf', 4, 'flat', 5);
    for (let j = 0; j < a.ny; j++) a.heights[j * a.nx] = j % 4 < 2 ? 2 : 0;
    a.band = Band.extruded(a);
    const back = Area.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    assert.ok(back.band.same(Band.fill(a), a), 'eased');
    a.band.heights[5] += 1;
    const kept = Area.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    assert.equal(kept.band.heights[5], a.band.heights[5]);
    assert.ok(kept.band.same(a.band, a));
});

test('easing a band whose rows ran out on their own takes the steps out and keeps its rise', () => {
    const a = Area.create('st', 4, 'flat', 5);
    a.heights.fill(0);
    const b = Band.fill(a);
    // West of the area, each row climbing away from the edge at its own slope: steps that grow towards the rim.
    for (let j = BAND; j < BAND + a.ny; j++)
        for (let i = 0; i < BAND; i++) b.heights[j * b.nx + i] = (BAND - i) * SPACING * (j % 2 ? 0.3 : 0.2);
    const step = i =>
        Math.max(
            ...Array.from({ length: 20 }, (_, k) =>
                Math.abs(b.heights[(BAND + 20 + k + 1) * b.nx + i] - b.heights[(BAND + 20 + k) * b.nx + i]),
            ),
        );
    const mean = i => Array.from({ length: 20 }, (_, k) => b.heights[(BAND + 20 + k) * b.nx + i]).reduce((x, y) => x + y) / 20;
    const rise = mean(10);
    assert.ok(step(10) > 4);
    b.ease(a);
    assert.ok(step(10) < 0.2, `steps ${step(10)}`);
    assert.ok(Math.abs(mean(10) - rise) < 0.5, `rise ${rise} now ${mean(10)}`);
});
