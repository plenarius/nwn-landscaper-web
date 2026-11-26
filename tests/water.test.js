// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Water tool (water.js): its undo steps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './browser.js';

const { Area, WET_DEPTH } = await import('../js/area.js');
const { initWater, waterDown, waterDrag } = await import('../js/water.js');

let open = null;
initWater({ area: () => open, view: { updateWater() {}, markDirty() {}, everything: () => null } });

/** A flat area at 5 m with a body of water started in its middle. */
function pond() {
    const a = Area.create('ww', 3, 'flat', 5);
    a.water = [{ i: 24, j: 24, level: 6 }];
    a.floodWater();
    return a;
}
const middle = { x: 15, y: 15 };

test('a click on water that leaves its level as it was takes no undo step', () => {
    open = pond();
    const w = waterDown({ shiftKey: false, clientY: 100 }, middle);
    waterDrag({ clientY: 100 }, w);
    assert.equal(open.undoStack.length, 0);
    // Its first change of level takes one, and the rest of the drag none.
    waterDrag({ clientY: 90 }, w);
    waterDrag({ clientY: 80 }, w);
    assert.equal(open.undoStack.length, 1);
    assert.ok(open.water[0].level > 6);
    open.undo();
    assert.equal(open.water[0].level, 6);
});

test('a new body of water takes its undo step at once', () => {
    open = Area.create('ww', 3, 'flat', 5);
    waterDown({ shiftKey: false, clientY: 100 }, middle);
    assert.equal(open.water.length, 1);
    assert.equal(open.undoStack.length, 1);
});

test('water shallower than WET_DEPTH is dry ground, as the game shows it', () => {
    const a = Area.create('ww', 3, 'flat', 5);
    // A shelf under a few centimetres of water beside a deeper hollow, both reached by one body.
    for (let j = 20; j <= 28; j++) for (let i = 20; i <= 28; i++) a.heights[j * a.nx + i] = i < 24 ? 5.7 : 6 - WET_DEPTH / 2;
    a.water = [{ i: 21, j: 24, level: 6 }];
    a.floodWater();
    const k = (i, j) => j * a.nx + i;
    assert.ok(!Number.isNaN(a.waterLevel[k(21, 24)]));
    assert.ok(Number.isNaN(a.waterLevel[k(26, 24)]));
    assert.equal(a.depth(26, 24), 0);
    // A click on the dry shelf starts a new body rather than taking the one it is joined to.
    assert.equal(a.bodyAt(26, 24), null);
    assert.equal(a.bodyAt(21, 24), a.water[0]);
});
