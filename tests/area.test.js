// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// An area (area.js): undo and redo, what an undo says changed, its JSON round trip, and its entrances' ids.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './importmap.js';

const { Area } = await import('../js/area.js');

/** Area `a` saved and read back, as the engine and this browser keep it (JSON text). */
const roundTrip = a => Area.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));

test('undo takes a step back and redo forward, and say which samples changed', () => {
    const a = Area.create('aa', 3, 'flat', 5);
    a.beginStroke();
    a.heights[a.nx * 2 + 7] = 9;
    a.beginStroke();
    a.materials[a.nx * 4 + 3] = a.materialIndex('rock');
    assert.equal(a.undo(), true);
    assert.equal(a.materials[a.nx * 4 + 3], 0);
    assert.deepEqual(a.lastChange.rect, { i0: 3, i1: 3, j0: 4, j1: 4 });
    assert.equal(a.undo(), true);
    assert.equal(a.heights[a.nx * 2 + 7], 5);
    assert.deepEqual(a.lastChange.rect, { i0: 7, i1: 7, j0: 2, j1: 2 });
    assert.equal(a.undo(), false);
    assert.equal(a.redo(), true);
    assert.equal(a.heights[a.nx * 2 + 7], 9);
    // A new step forgets what could be redone.
    a.beginStroke();
    assert.equal(a.redo(), false);
});

test('undo keeps the last 40 steps', () => {
    const a = Area.create('aa', 3, 'flat', 5);
    for (let k = 1; k <= 45; k++) {
        a.beginStroke();
        a.heights[0] = 5 + k;
    }
    let steps = 0;
    while (a.undo()) steps++;
    assert.equal(steps, 40);
    assert.equal(a.heights[0], 10);
});

test('the ceiling height comes back with an undo, and the whole area is redrawn', () => {
    const a = Area.create('cc', 3, 'cave');
    a.beginStroke();
    a.clearance = 4;
    a.undo();
    assert.equal(a.clearance, null);
    assert.deepEqual(a.lastChange.rect, { i0: 0, i1: a.nx - 1, j0: 0, j1: a.ny - 1 });
});

test("Sky & fog and the shadows' strength come back with an undo, and a change of strength redraws every shadow", () => {
    const a = Area.create('ss', 3, 'flat');
    const sky = structuredClone(a.atmosphere);
    a.beginStroke();
    a.atmosphere.preset = 'custom';
    a.atmosphere.sun.fog = '#ff0000';
    a.undo();
    assert.deepEqual(a.atmosphere, sky);
    assert.equal(a.lastChange.shadow, false);
    a.beginStroke();
    a.shadow = 0.2;
    a.undo();
    assert.equal(a.shadow, 0.6);
    assert.equal(a.lastChange.shadow, true);
    a.redo();
    assert.equal(a.shadow, 0.2);
});

test('a texture can be painted when the area has it or room for one more', () => {
    const a = Area.create('pp', 3, 'flat');
    a.palette = [a.palette[0], ...Array.from({ length: 254 }, (_, k) => `filler${k}`)];
    assert.equal(a.canPaint('filler3'), true);
    assert.equal(a.canPaint('rock'), false);
    assert.throws(() => a.materialIndex('rock'));
    a.palette.pop();
    assert.equal(a.canPaint('rock'), true);
});

test('an area read back from its JSON is the same area', () => {
    const a = Area.create('aa', 4, 'hills', 5, 3);
    a.materials[17] = a.materialIndex('rock');
    a.entrances.push({ id: a.newEntranceId(), x: 10, y: 10 });
    a.things.push({ id: a.nextThingId++, kind: 'creature', x: 3, y: 4 });
    a.module = 'mod';
    a.settings = { tag: 'aa' };
    const b = roundTrip(a);
    assert.equal(b.tiles, 4);
    assert.equal(b.tilesY, 3);
    assert.deepEqual(b.heights, a.heights);
    assert.deepEqual(b.materials, a.materials);
    assert.deepEqual(b.palette, a.palette);
    assert.deepEqual(b.entrances, a.entrances);
    assert.deepEqual(b.things, a.things);
    assert.equal(b.module, 'mod');
    assert.deepEqual(b.settings, { tag: 'aa' });
    assert.equal(b.entranceNextId, 2);
    assert.equal(b.nextThingId, 2);
    assert.deepEqual(b.toJSON(), a.toJSON());
});

test('a new area has its own `created` id, kept in its saves; an area from before ids has none', () => {
    const a = Area.create('aa', 3, 'flat');
    const b = Area.create('aa', 3, 'flat');
    assert.match(a.created, /^[0-9a-f]{16}$/);
    assert.notEqual(a.created, b.created);
    assert.equal(roundTrip(a).created, a.created);
    const old = a.toJSON();
    delete old.created;
    assert.equal(Area.fromJSON(JSON.parse(JSON.stringify(old))).created, null);
});

test('entrances saved before ids get the number their door tag already had', () => {
    const a = Area.create('aa', 3, 'flat');
    const o = a.toJSON();
    o.entrances = [{ x: 1 }, { x: 2 }, { x: 3 }];
    delete o.entranceNextId;
    const b = Area.fromJSON(JSON.parse(JSON.stringify(o)));
    assert.deepEqual(
        b.entrances.map(e => e.id),
        [1, 2, 3],
    );
    assert.equal(b.entranceNextId, 4);
    assert.equal(b.doorTag(b.entrances[1]), 'aa_ent2');
});

test('an entrance without an id among ones with gets its place, or a new id when that is taken; the counter never goes down', () => {
    const a = Area.create('aa', 3, 'flat');
    const o = a.toJSON();
    o.entrances = [{ id: 2 }, { x: 0 }, { x: 1 }];
    o.entranceNextId = 7;
    const b = Area.fromJSON(JSON.parse(JSON.stringify(o)));
    assert.deepEqual(
        b.entrances.map(e => e.id),
        [2, 3, 4],
    );
    assert.equal(b.entranceNextId, 7);
});

test('undo puts an entrance back with its id, and its id is never given again', () => {
    const a = Area.create('aa', 3, 'flat');
    a.beginStroke();
    a.entrances.push({ id: a.newEntranceId(), x: 10, y: 10 });
    a.undo();
    assert.equal(a.entrances.length, 0);
    a.redo();
    assert.equal(a.entrances[0].id, 1);
    a.beginStroke();
    a.entrances.pop();
    a.undo();
    assert.equal(a.entrances[0].id, 1);
    assert.equal(a.newEntranceId(), 2);
});

test('an undo says apart which samples changed height, and which entrances it added or took out', () => {
    const a = Area.create('aa', 3, 'flat', 5);
    a.beginStroke();
    a.materials[a.nx * 4 + 3] = a.materialIndex('rock');
    a.beginStroke();
    a.heights[a.nx * 2 + 7] = 9;
    a.entrances.push({ id: a.newEntranceId(), x: 10, y: 10, width: 4, depth: 4 });
    a.undo();
    assert.deepEqual(a.lastChange.heights, { i0: 7, i1: 7, j0: 2, j1: 2 });
    assert.deepEqual(
        a.lastChange.entrances.map(e => e.id),
        [1],
    );
    // Paint only: nothing for the shadows to follow.
    a.undo();
    assert.deepEqual(a.lastChange.rect, { i0: 3, i1: 3, j0: 4, j1: 4 });
    assert.equal(a.lastChange.heights, null);
    assert.deepEqual(a.lastChange.entrances, []);
});

/** The ceiling fit as it was first written (one breadth-first search with a list of neighbours per sample), to hold the
 *  faster one to the same answer: which open sample gives the rock its ceiling depends on the order of the search. */
function ceilingFitAsWritten(area) {
    const { nx, ny, heights: h, roof } = area,
        n = nx * ny;
    const from = new Int32Array(n).fill(-1),
        queue = new Int32Array(n);
    let head = 0,
        tail = 0;
    for (let k = 0; k < n; k++)
        if (h[k] < roof - 0.3) {
            from[k] = k;
            queue[tail++] = k;
        }
    while (head < tail) {
        const k = queue[head++],
            i = k % nx,
            j = (k - i) / nx;
        for (const [a, b] of [
            [i + 1, j],
            [i - 1, j],
            [i, j + 1],
            [i, j - 1],
        ]) {
            if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
            const m = b * nx + a;
            if (from[m] < 0) {
                from[m] = from[k];
                queue[tail++] = m;
            }
        }
    }
    const ceiling = new Float32Array(n),
        shown = new Float32Array(h);
    for (let k = 0; k < n; k++) {
        ceiling[k] = from[k] < 0 ? roof : h[from[k]] + area.clearance;
        if (h[k] >= roof - 0.3) shown[k] = Math.min(ceiling[k], h[k]);
    }
    return { ceiling, shown };
}

test('a ceiling height fits the roof as the first search did, tie for tie', () => {
    const a = Area.create('cc', 4, 'cave', 5, 3);
    // Open floor in patches at different heights, so rock samples have open ground at the same distance on several sides.
    for (let j = 0; j < a.ny; j++)
        for (let i = 0; i < a.nx; i++)
            if ((Math.floor(i / 7) + Math.floor(j / 5)) % 3 === 0) a.heights[j * a.nx + i] = 4 + ((i * 7 + j * 13) % 11) / 10;
    a.clearance = 3;
    for (let k = 0; k < 2; k++) {
        const fit = a.ceilingFit(),
            was = ceilingFitAsWritten(a);
        assert.deepEqual(fit.ceiling, was.ceiling);
        assert.deepEqual(fit.shown, was.shown);
        // (the second time with the work arrays kept from the first)
        a.heights[40] = 2;
    }
    a.clearance = null;
    assert.equal(a.ceilingFit(), null);
});

test('a new hilly area that is not square spans the whole height of its hills, as a square one does', () => {
    for (const [start, amplitude] of [
        ['hills', 6],
        ['rough', 14],
    ]) {
        for (const [w, h] of [
            [8, 8],
            [8, 2],
            [2, 8],
        ]) {
            const a = Area.create('hh', w, start, 5, h);
            const low = a.heights.reduce((m, v) => Math.min(m, v), Infinity),
                high = a.heights.reduce((m, v) => Math.max(m, v), -Infinity);
            assert.ok(Math.abs(low - 5) < 1e-4, `${start} ${w}x${h}: lowest ${low}`);
            assert.ok(Math.abs(high - (5 + amplitude)) < 1e-4, `${start} ${w}x${h}: highest ${high}`);
        }
    }
});

test("an interior's wall tops move onto their foot's line, as the game draws them upright", async () => {
    const { uprightShift, SPACING } = await import('../js/area.js');
    const { roomRect, cutRoom } = await import('../js/tools.js');
    const a = Area.create('up', 4, 'interior');
    cutRoom(a, roomRect({ x: 10, y: 10 }, { x: 30, y: 26.25 }, a.sizeX, a.sizeY), a.roof - 6);
    const at = (x, y) => uprightShift(a.heights, a.nx, a.ny, Math.round(x / SPACING), Math.round(y / SPACING));
    // The west wall's top (a sample out from the floor) goes east onto the room's edge, the east wall's west, the south's north.
    assert.deepEqual(at(10 - SPACING, 18), [SPACING, 0]);
    assert.deepEqual(at(30 + SPACING, 18), [-SPACING, 0]);
    assert.deepEqual(at(20, 10 - SPACING), [0, SPACING]);
    // The floor, the rock behind the top and the rock off a corner stay.
    for (const [x, y] of [
        [10, 18],
        [20, 20],
        [10 - 2 * SPACING, 18],
        [10 - SPACING, 10 - SPACING],
    ])
        assert.deepEqual(at(x, y), [0, 0]);
    // A door pushed into a wall goes onto its foot, and anything there stands on the floor, as the game places them.
    assert.deepEqual(a.wallFoot(9.8, 18), [10, 18]);
    assert.equal(a.floorAt(9.8, 18), a.roof - 6);
    assert.equal(a.floorAt(10 - 1.5 * SPACING, 18), a.roof);
    // A wall one sample thick between two rooms: its top can't go to both feet.
    cutRoom(a, { x0: 0, x1: 10 - 2 * SPACING, y0: 10, y1: 26.25 }, a.roof - 6);
    assert.deepEqual(at(10 - SPACING, 18), [0, 0]);
});
