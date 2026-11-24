// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The underlay (underlay.js): distances in metres or feet, scaling about a point, its first fit, and where it lies kept with
// the area through its JSON.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './browser.js';

const { Area } = await import('../js/area.js');
const { parseDistance, scaleAbout, fitToArea } = await import('../js/underlay.js');

test('a distance is metres, or feet with ft', () => {
    assert.equal(parseDistance('30'), 30);
    assert.equal(parseDistance(' 1.5 m '), 1.5);
    assert.equal(parseDistance('2,5'), 2.5);
    assert.ok(Math.abs(parseDistance('5 ft') - 1.524) < 1e-9);
    assert.ok(Math.abs(parseDistance("10'") - 3.048) < 1e-9);
    for (const bad of ['', 'ten', '5 yards', '-3', '1 2']) assert.ok(Number.isNaN(parseDistance(bad)), bad);
});

test('scaling about a point keeps that point where it is on the picture', () => {
    const u = { x: 50, y: 40, w: 100, h: 50, angle: 0.3, opacity: 0.5, shown: true };
    const p = { x: 20, y: 30 };
    const s = scaleAbout(u, p, 2);
    assert.deepEqual([s.w, s.h, s.angle, s.opacity], [200, 100, 0.3, 0.5]);
    // p's offset from the middle, over the size, is the same before and after: the same spot of the picture.
    assert.ok(Math.abs((p.x - u.x) / u.w - (p.x - s.x) / s.w) < 1e-12);
    assert.ok(Math.abs((p.y - u.y) / u.h - (p.y - s.y) / s.h) < 1e-12);
});

test('a picture first lies over the whole area, as large as fits, its shape kept', () => {
    const a = Area.create('aa', 16, 'flat', 0, 8);
    assert.deepEqual(fitToArea(a, 4), { x: 80, y: 40, w: 160, h: 40, angle: 0, opacity: 0.6, shown: true });
    const tall = fitToArea(a, 0.5);
    assert.deepEqual([tall.w, tall.h], [40, 80]);
});

test('where the underlay lies is kept with the area', () => {
    const a = Area.create('aa', 4, 'flat', 0);
    assert.equal(a.underlay, null);
    a.underlay = { x: 1, y: 2, w: 30, h: 20, angle: 0.5, opacity: 0.4, shown: false };
    const back = Area.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    assert.deepEqual(back.underlay, a.underlay);
    assert.equal(Area.fromJSON(JSON.parse(JSON.stringify(Area.create('bb', 3, 'flat', 0).toJSON()))).underlay, null);
});
