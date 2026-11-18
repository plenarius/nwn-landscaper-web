// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// An area (area.js): undo and redo, what an undo says changed, its JSON round trip, and its entrances' ids.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Area } from '../js/area.js';

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
