// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Undo and redo of changed rectangles (area.js): every tool's stroke, undone and redone in any order, overlapping, past the
// step limit and with changes made without a step, gives back what the whole snapshots before it gave back, and says the
// same about what changed (lastChange). The whole-snapshot undo is kept here as it was, to hold the new one to it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './importmap.js';

const { Area, UNDO_STEPS } = await import('../js/area.js');
const { stamp, chasmStamp, cutRoom } = await import('../js/tools.js');
const { mixPlan } = await import('../js/mix.js');
const { mixStamp } = await import('../js/mix.js');

// --- The undo before (main 229eeb1): a whole snapshot before each step ---------------------------------------------------

const old = {
    snapshot: a => ({
        h: a.heights.slice(),
        m: a.materials.slice(),
        ch: a.chasm?.slice() ?? null,
        p: a.palette.slice(),
        w: a.water.map(b => ({ ...b })),
        e: a.entrances.map(e => ({ ...e })),
        o: a.objects.map(o => ({ ...o })),
        t: structuredClone(a.things),
        s: structuredClone(a.settings),
        r: structuredClone(a.originals),
        c: a.clearance,
        at: structuredClone(a.atmosphere),
        sh: a.shadow,
    }),
    restore(a, s) {
        a.heights.set(s.h);
        a.materials.set(s.m);
        a.chasm = s.ch ? s.ch.slice() : null;
        a.palette = s.p.slice();
        a.water = s.w.map(b => ({ ...b }));
        a.entrances = s.e.map(e => ({ ...e }));
        a.objects = s.o.map(o => ({ ...o }));
        a.things = structuredClone(s.t);
        a.settings = structuredClone(s.s);
        a.originals = structuredClone(s.r);
        a.clearance = s.c;
        a.atmosphere = structuredClone(s.at);
        a.shadow = s.sh;
        a.floodWater();
    },
    noteChange(a, s) {
        const { nx, heights: h, materials: m } = a;
        const grow = (r, i, j) => {
            if (!r) return { i0: i, i1: i, j0: j, j1: j };
            if (i < r.i0) r.i0 = i;
            if (i > r.i1) r.i1 = i;
            if (j < r.j0) r.j0 = j;
            r.j1 = j;
            return r;
        };
        let rect = null,
            heights = null;
        const c = a.chasm,
            sc = s.ch;
        for (let k = 0; k < h.length; k++) {
            const chasmed = (c?.[k] ?? 0) !== (sc?.[k] ?? 0);
            if (h[k] === s.h[k] && m[k] === s.m[k] && !chasmed) continue;
            const i = k % nx,
                j = (k - i) / nx;
            rect = grow(rect, i, j);
            if (h[k] !== s.h[k] || chasmed) heights = grow(heights, i, j);
        }
        if (s.c !== a.clearance) rect = { i0: 0, i1: nx - 1, j0: 0, j1: a.ny - 1 };
        const key = e => JSON.stringify(e),
            was = new Set(s.e.map(key)),
            now = new Set(a.entrances.map(key));
        const entrances = [...s.e.filter(e => !now.has(key(e))), ...a.entrances.filter(e => !was.has(key(e)))];
        a.lastChange = { rect, heights, entrances, shadow: s.sh !== a.shadow };
        return s;
    },
    begin(a, before = old.snapshot(a)) {
        a.oldUndo.push(before);
        if (a.oldUndo.length > 40) a.oldUndo.shift();
        a.oldRedo = [];
    },
    undo(a) {
        if (!a.oldUndo.length) return false;
        a.oldRedo.push(old.snapshot(a));
        old.restore(a, old.noteChange(a, a.oldUndo.pop()));
        return true;
    },
    redo(a) {
        if (!a.oldRedo.length) return false;
        a.oldUndo.push(old.snapshot(a));
        old.restore(a, old.noteChange(a, a.oldRedo.pop()));
        return true;
    },
};

// --- Each tool's change, made the same on both areas ---------------------------------------------------------------------

/** A seeded random number generator (mulberry32): the same strokes on both areas, and the same each run. */
function random(seed) {
    let a = seed;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * The tools' changes: each `(a, r, u)` changes area `a` as that tool does, with `r` (random numbers, the same sequence for
 * both areas) and `u` (`begin(before)`, the area's beginStroke, and `snapshot()`, for a change confirmed later).
 */
const TOOLS = {
    sculpt(a, r, u) {
        u.begin();
        const tool = ['raise', 'lower', 'smooth', 'flatten'][Math.floor(r() * 4)],
            x = r() * a.sizeX,
            y = r() * a.sizeY,
            radius = 2 + r() * 8,
            to = r() * 10;
        for (let k = 0; k < 6; k++) stamp(a, tool, x + k * 1.5, y + k * 0.7, radius, 4, 1 / 60, to);
    },
    paint(a, r, u) {
        u.begin();
        const index = a.materialIndex(['rock', 'sand', 'snow', 'grassLong'][Math.floor(r() * 4)]),
            x = r() * a.sizeX,
            y = r() * a.sizeY;
        for (let k = 0; k < 5; k++) stamp(a, 'paint', x + k * 2, y, 3 + r() * 4, 1, 1 / 60, null, index);
    },
    mix(a, r, u) {
        u.begin();
        const plan = mixPlan(
            { textures: ['sand', 'snow'].map(id => ({ id, weight: 5 })), patch: 2, soft: true, seed: 7 },
            ['sand', 'snow'].map(id => a.materialIndex(id)),
        );
        const x = r() * a.sizeX,
            y = r() * a.sizeY;
        for (let k = 0; k < 6; k++) mixStamp(a, x + k * 1.5, y, 5, 1, plan);
    },
    chasm(a, r, u) {
        u.begin();
        const fill = r() < 0.35,
            x = r() * a.sizeX,
            y = r() * a.sizeY;
        for (let k = 0; k < 4; k++) chasmStamp(a, x + k, y, 3 + r() * 3, fill);
    },
    water(a, r, u) {
        u.begin();
        const what = r();
        if (what < 0.5 || !a.water.length) {
            const i = Math.floor(r() * a.nx),
                j = Math.floor(r() * a.ny);
            a.water.push({ i, j, level: a.heights[j * a.nx + i] + 0.3 + r() });
        } else if (what < 0.8) a.water.at(-1).level += r() - 0.3;
        else a.water.pop();
        a.floodWater();
    },
    entrance(a, r, u) {
        u.begin();
        if (a.entrances.length && r() < 0.3) {
            a.entrances.splice(Math.floor(r() * a.entrances.length), 1);
            return;
        }
        const x = 5 + r() * (a.sizeX - 10),
            y = 5 + r() * (a.sizeY - 10);
        a.entrances.push({ id: a.newEntranceId(), x, y, dir: r() * 6, width: 4, depth: 4, floor: a.heightAt(x, y) });
        stamp(a, 'lower', x, y, 3, 4, 1 / 60);
    },
    place(a, r, u) {
        u.begin();
        a.objects.push({
            id: a.nextObjectId++,
            model: 'tree',
            x: r() * a.sizeX,
            y: r() * a.sizeY,
            z: 0,
            bearing: 0,
            scale: 1,
            baked: true,
        });
    },
    scatter(a, r, u) {
        u.begin();
        for (let k = 0; k < 8; k++)
            if (r() < 0.2 && a.objects.length) a.objects.splice(Math.floor(r() * a.objects.length), 1);
            else a.objects.push({ id: a.nextObjectId++, model: 'rock', x: r() * a.sizeX, y: r() * a.sizeY, z: 0, bearing: r(), scale: 1 });
    },
    transform(a, r, u) {
        if (!a.objects.length) return;
        // (Move: the snapshot at the start of the drag, the step when it is confirmed)
        const before = u.snapshot(),
            o = a.objects[Math.floor(r() * a.objects.length)];
        o.x += r() * 4 - 2;
        o.bearing += r();
        u.begin(before);
    },
    things(a, r, u) {
        u.begin();
        if (a.things.length && r() < 0.5) a.things[Math.floor(r() * a.things.length)].tag = `t${Math.floor(r() * 100)}`;
        else
            a.things.push({ id: a.nextThingId++, kind: 'waypoint', x: r() * a.sizeX, y: r() * a.sizeY, vars: [{ name: 'v', value: r() }] });
    },
    settings(a, r, u) {
        u.begin();
        a.settings = { ...(a.settings ?? {}), name: `area ${Math.floor(r() * 10)}`, scripts: { OnEnter: 'x' } };
        a.originals.removed.push(`Creature List:${Math.floor(r() * 9)}`);
    },
    sky(a, r, u) {
        u.begin();
        if (r() < 0.5) a.atmosphere.preset = ['golden', 'night', 'custom'][Math.floor(r() * 3)];
        else a.shadow = Math.round(r() * 10) / 10;
    },
    heightmap(a, r, u) {
        u.begin();
        const base = r() * 8;
        for (let k = 0; k < a.heights.length; k++) a.heights[k] = base + Math.sin(k * 0.01);
    },
    nothing(_a, _r, u) {
        // (a click that changes nothing still takes its step, as before)
        u.begin();
    },
    // A change made without a step (the Ceiling button sets the ceiling height so): undo takes it back with the last step.
    untracked(a, r) {
        if (r() < 0.5) a.heights[Math.floor(r() * a.heights.length)] += 1;
        else a.palette.push(`untracked${Math.floor(r() * 1000)}`);
    },
};

/** The parts of area `a` undo brings back, to compare. */
function state(a) {
    return {
        heights: Buffer.from(a.heights.buffer, a.heights.byteOffset, a.heights.byteLength).toString('base64'),
        materials: Buffer.from(a.materials).toString('base64'),
        chasm: a.chasm && Buffer.from(a.chasm).toString('base64'),
        waterLevel: Buffer.from(a.waterLevel.buffer).toString('base64'),
        palette: a.palette,
        water: a.water,
        entrances: a.entrances,
        objects: a.objects,
        things: a.things,
        settings: a.settings,
        originals: a.originals,
        clearance: a.clearance,
        atmosphere: a.atmosphere,
        shadow: a.shadow,
    };
}

/** Two copies of `make()`: one with today's undo, one with the whole snapshots'. */
function pair(make) {
    const a = make();
    const b = Area.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    b.oldUndo = [];
    b.oldRedo = [];
    return [a, b];
}

/**
 * Runs `steps` random actions (`tools`: the names of the TOOLS to pick from) on both copies of `make()`'s area, with undo and
 * redo among them, checking after each that the two hold the same and that an undo or redo says the same changed.
 */
function race(make, tools, steps, seed) {
    const [a, b] = pair(make);
    const pick = random(seed);
    const nowU = { begin: before => a.beginStroke(before), snapshot: () => a.snapshot() };
    const oldU = { begin: before => old.begin(b, before), snapshot: () => old.snapshot(b) };
    let undone = 0;
    for (let s = 0; s < steps; s++) {
        const roll = pick();
        if (roll < 0.22) {
            assert.equal(a.undo(), old.undo(b), `undo ${s}`);
            undone++;
        } else if (roll < 0.36) assert.equal(a.redo(), old.redo(b), `redo ${s}`);
        else {
            const name = tools[Math.floor(pick() * tools.length)],
                seedOf = Math.floor(pick() * 1e9);
            TOOLS[name](a, random(seedOf), nowU);
            TOOLS[name](b, random(seedOf), oldU);
        }
        if (roll < 0.36) assert.deepEqual(a.lastChange, b.lastChange, `what changed, step ${s}`);
        assert.deepEqual(state(a), state(b), `step ${s}`);
        assert.equal(a.undoStack.length, b.oldUndo.length, `undo steps, step ${s}`);
        assert.equal(a.redoStack.length, b.oldRedo.length, `redo steps, step ${s}`);
    }
    // And all the way back, then forward again.
    while (old.undo(b)) {
        assert.equal(a.undo(), true);
        assert.deepEqual(state(a), state(b));
        assert.deepEqual(a.lastChange, b.lastChange);
    }
    assert.equal(a.undo(), false);
    while (old.redo(b)) {
        assert.equal(a.redo(), true);
        assert.deepEqual(state(a), state(b));
    }
    assert.equal(a.redo(), false);
    return undone;
}

const SURFACE = ['sculpt', 'paint', 'mix', 'chasm', 'water', 'entrance', 'place', 'scatter', 'transform', 'things'];
const MORE = ['settings', 'sky', 'heightmap', 'nothing', 'untracked'];

test('every surface tool undoes and redoes as the whole snapshots did, strokes overlapping', () => {
    for (const seed of [1, 2, 3]) race(() => Area.create('ss', 3, 'rolling', 5), SURFACE, 220, seed);
});

test('settings, sky, shadows, a heightmap, empty steps and changes made without a step undo as before', () => {
    for (const seed of [4, 5]) race(() => Area.create('ss', 3, 'flat', 5), [...SURFACE, ...MORE], 220, seed);
});

test("a cave's dig, rooms and ceiling height undo as before", () => {
    const CAVE = {
        dig(a, r, u) {
            u.begin();
            const x = r() * a.sizeX,
                y = r() * a.sizeY;
            for (let k = 0; k < 5; k++) stamp(a, 'dig', x + k, y, 3, 4, 1 / 60, 5, a.materialIndex('rock'));
        },
        room(a, r, u) {
            u.begin();
            const x0 = r() * (a.sizeX - 8),
                y0 = r() * (a.sizeY - 8);
            cutRoom(a, { x0, y0, x1: x0 + 6, y1: y0 + 5 }, 5, a.materialIndex('wallFieldstone'));
        },
        ceiling(a, r, u) {
            u.begin();
            a.clearance = r() < 0.3 ? null : 2 + Math.floor(r() * 6);
        },
    };
    Object.assign(TOOLS, CAVE);
    for (const seed of [6, 7]) race(() => Area.create('cv', 3, 'cave', 5), ['dig', 'room', 'ceiling', 'entrance', 'untracked'], 200, seed);
});

test(`undo keeps the last ${UNDO_STEPS} steps, overlapping or not`, () => {
    const a = Area.create('aa', 3, 'flat', 5);
    for (let k = 1; k <= UNDO_STEPS + 15; k++) {
        a.beginStroke();
        stamp(a, 'raise', (k % 5) * 6, 10, 4, 4, 1 / 60);
        a.heights[0] = 5 + k;
    }
    let steps = 0;
    while (a.undo()) steps++;
    assert.equal(steps, UNDO_STEPS);
    assert.equal(a.heights[0], 5 + 15);
    while (a.redo()) steps--;
    assert.equal(steps, 0);
    assert.equal(a.heights[0], 5 + UNDO_STEPS + 15);
});

test('a step keeps only the rectangle it changed and the fields it changed', () => {
    const a = Area.create('aa', 32, 'flat', 5);
    for (let k = 0; k < 200; k++) a.objects.push({ id: k, model: 'tree', x: k, y: k });
    a.beginStroke();
    stamp(a, 'raise', 100, 100, 5, 4, 1 / 60);
    a.beginStroke();
    a.objects[3].x = 50;
    a.beginStroke();
    const [sculpt, move] = a.undoStack;
    // An 8 m brush's square, not the area's 263,169 samples; no lists copied.
    assert.ok(sculpt.h.length < 20 * 20, `${sculpt.h.length} samples`);
    assert.deepEqual(Object.keys(sculpt.meta), []);
    assert.equal(move.rect, null);
    assert.deepEqual(Object.keys(move.meta), ['objects']);
    // Undone, the way back holds the same rectangle.
    a.undo();
    a.undo();
    a.undo();
    assert.deepEqual(a.redoStack[2].rect, sculpt.rect);
});

test('a chasm opened on an area with none is gone again after undo, and comes back with redo', () => {
    const a = Area.create('aa', 3, 'flat', 5);
    a.beginStroke();
    chasmStamp(a, 15, 15, 4, false);
    assert.equal(a.hasChasm(), true);
    a.undo();
    assert.equal(a.chasm, null);
    a.redo();
    assert.equal(a.hasChasm(), true);
    assert.ok(a.lastChange.heights);
});
