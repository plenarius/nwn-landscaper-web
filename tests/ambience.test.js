// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Ambience tool (ambience.js, area.js, export.js): Fill's rules on small made-up areas, no cap, the brush, undo, the JSON
// round trip and what an export sends.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './browser.js';

const { Area, SPACING } = await import('../js/area.js');
const { kindsOf, liveOf, propose, fill, clearKinds, ambienceStamp, seeded, surfaceAt, SUN_BEARING, AREA_LIVE_HEAVY } = await import(
    '../js/ambience.js'
);
const { initExport, areaRequest } = await import('../js/export.js');

/** Bytes of heights and paint an export of `a` sends before its JSON: its band's grids, with one (band.js). */
const grids = a => (a.band ? a.band.heights.byteLength + a.band.materials.byteLength : a.heights.byteLength + a.materials.byteLength);

/** The pack as /api/particles gives it, cut down to what the tool reads (#52's live counts and colours). */
const PACK = {
    format: 1,
    kinds: [
        ['mist', 'always', 18, 18],
        ['waterfall', 'always', 34, 34],
        ['rapids', 'always', 6, 6],
        ['fireflies', 'night', 0, 18],
        ['motes', 'day', 30, 0],
        ['leaves', 'always', 4, 4],
        ['snow', 'always', 56, 56],
        ['sand', 'always', 18, 18],
        ['embers', 'always', 15, 15],
        ['shafts', 'day', 24, 0],
        ['groundfog', 'always', 10, 10],
    ].map(([id, shows, day, night]) => ({
        id,
        name: id,
        shows,
        live: { day, night },
        emitters: { e: { day: { colorStart: [1, 0.5, 0] }, night: { colorStart: [0.2, 0.2, 0.4] } } },
    })),
};
const KINDS = kindsOf(PACK);
const kind = id => KINDS.find(k => k.id === id);

/** A flat area `tiles` square at `base` m, its ground shaped by `height(x, y)` (metres) when given, painted `texture`. */
function area(tiles, { base = 5, height = null, texture = null } = {}) {
    const a = Area.create('amb', tiles, 'flat', base);
    if (height) for (let j = 0; j < a.ny; j++) for (let i = 0; i < a.nx; i++) a.heights[j * a.nx + i] = height(i * SPACING, j * SPACING);
    if (texture) a.palette = [texture];
    return a;
}
/** Area `a` with a body of water started at (x, y), its surface at `level`. */
function flood(a, x, y, level) {
    const { i, j } = a.sampleAt(x, y);
    a.water.push({ i, j, level });
    a.floodWater();
    return a;
}
const wet = (a, p) => {
    const { i, j } = a.sampleAt(p.x, p.y);
    return !Number.isNaN(a.waterLevel[j * a.nx + i]);
};
/** A round lake: ground 5 m, falling to 3 m at (30, 30) over 20 m, water at 4.5 m (about 13 m across the surface). */
const lake = () => flood(area(6, { height: (x, y) => 5 - 2 * Math.max(0, 1 - Math.hypot(x - 30, y - 30) / 20) }), 30, 30, 4.5);

test('the pack gives each kind its hours, live counts and day and night colours', () => {
    assert.equal(KINDS.length, 11);
    assert.deepEqual(kind('fireflies').live, { day: 0, night: 18 });
    assert.equal(kind('motes').shows, 'day');
    assert.equal(kind('mist').day, '#ff8000');
    assert.equal(kind('mist').night, '#333366');
    assert.deepEqual(kindsOf({}), []);
});

test('mist lies on the water, at its surface, more of it far from the shore', () => {
    const a = lake();
    const mist = propose(a, 'mist', { density: 4, rand: seeded(1) });
    assert.ok(mist.length > 10, `${mist.length}`);
    for (const p of mist) {
        assert.ok(wet(a, p), `${p.x},${p.y} is dry`);
        assert.equal(p.z, 4.5);
    }
    // Per square metre, the open water (over 4 m from the shore) gets more than the edge.
    const out = p => Math.hypot(p.x - 30, p.y - 30);
    const r = Math.max(
        ...[...Array(400).keys()]
            .map(k => ({ x: 30 + k * 0.05, y: 30 }))
            .filter(p => wet(a, p))
            .map(out),
    );
    const inner = mist.filter(p => out(p) < r - 4).length / (r - 4) ** 2,
        edge = mist.filter(p => out(p) >= r - 4).length / (r ** 2 - (r - 4) ** 2);
    assert.ok(inner > edge * 1.3, `open water ${inner.toFixed(3)} against the edge ${edge.toFixed(3)}`);
    // No water, no mist.
    assert.deepEqual(propose(area(3), 'mist', { rand: seeded(1) }), []);
});

test('spray where two bodies of water meet: a waterfall for a drop of 1 m and more, rapids for less', () => {
    // A pool at 8 m to the west and one at 5 m to the east, with a 1 m wide lip between them at x 20.
    const ground = x => (Math.abs(x - 20) < 1 ? 9 : x < 20 ? 7 : 4);
    const a = flood(flood(area(4, { height: ground }), 10, 20, 8), 30, 20, 5);
    const falls = propose(a, 'waterfall', { rand: seeded(2) });
    assert.ok(falls.length >= 4, `${falls.length} along a 40 m lip`);
    for (const p of falls) {
        assert.ok(p.x > 20 && p.x < 24, `${p.x}: at the foot of the drop`);
        assert.equal(p.z, 5);
    }
    // Neighbours at least the waterfall's spacing apart.
    for (const p of falls) for (const q of falls) if (p !== q) assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= 5);
    assert.deepEqual(propose(a, 'rapids', { rand: seeded(2) }), [], 'a 3 m drop is no rapids');
    // Half a metre: rapids, not a fall.
    const lower = x => (Math.abs(x - 20) < 1 ? 9 : 4);
    const b = flood(flood(area(4, { height: lower }), 10, 20, 5.5), 30, 20, 5);
    assert.deepEqual(propose(b, 'waterfall', { rand: seeded(2) }), []);
    assert.ok(propose(b, 'rapids', { rand: seeded(2) }).length >= 4);
});

test('rapids where a narrow river bed falls faster than 1 m in 4 m, not on a gentle lake bed', () => {
    // A channel 6 m wide along y = 20, its bed falling 1.5 m in 4 m eastwards from x 12, under water at 5.6 m.
    const bed = (x, y) => (Math.abs(y - 20) <= 3 ? 5.5 - Math.max(0, Math.min(x, 32) - 12) * 0.375 : 8);
    const a = flood(area(4, { height: bed }), 14, 20, 5.6);
    const rapids = propose(a, 'rapids', { rand: seeded(3) });
    assert.ok(rapids.length >= 3, `${rapids.length}`);
    for (const p of rapids) assert.ok(wet(a, p) && Math.abs(p.y - 20) < 3, `${p.x},${p.y}`);
    // The same channel with a bed falling 1 m in 10 m: none.
    const gentle = (x, y) => (Math.abs(y - 20) <= 3 ? 5.5 - Math.max(0, Math.min(x, 32) - 12) * 0.1 : 8);
    assert.deepEqual(propose(flood(area(4, { height: gentle }), 14, 20, 5.6), 'rapids', { rand: seeded(3) }), []);
    assert.deepEqual(propose(lake(), 'rapids', { rand: seeded(3) }), [], "the lake's bed falls 2 m in 20 m");
});

test('fireflies on walkable grass within 10 m of water, not on sand or far from it', () => {
    const a = lake();
    const flies = propose(a, 'fireflies', { density: 2, rand: seeded(4) });
    assert.ok(flies.length > 5, `${flies.length}`);
    // The water's edge is about 13 m from the middle.
    for (const p of flies) {
        assert.ok(!wet(a, p), `${p.x},${p.y} is on water`);
        assert.ok(Math.hypot(p.x - 30, p.y - 30) < 13 + 10 + 1, `${p.x},${p.y} is over 10 m from the water`);
    }
    const sand = lake();
    sand.palette = ['sandDesert'];
    assert.deepEqual(propose(sand, 'fireflies', { rand: seeded(4) }), []);
    // The library's category wins over the texture's name.
    const env = { categoryOf: id => (id === 'sandDesert' ? 'Grass' : '') };
    assert.ok(propose(sand, 'fireflies', { rand: seeded(4), env }).length > 0);
});

/** Objects of models named in `names` (model -> name) for `env.nameOf`. */
const named = names => ({ nameOf: o => names[o.model] ?? o.model });
const tree = (x, y, model = 'oak') => ({ id: x * 100 + y, model, x, y, z: 5, bearing: 0, scale: 1, baked: true });
const NAMES = { oak: 'Tree, Oak', stump: 'Tree stump', rock: 'Rock, Large', fire: 'Campfire' };

test('leaves under each tree, one a tree, near its trunk; none under rocks or stumps', () => {
    const a = area(4);
    a.objects = [tree(10, 10), tree(20, 25), tree(30, 12), tree(5, 30, 'rock'), tree(15, 35, 'stump')];
    const leaves = propose(a, 'leaves', { rand: seeded(5), env: { ...named(NAMES), crownOf: () => 4 } });
    assert.equal(leaves.length, 3);
    for (const p of leaves) assert.ok(a.objects.slice(0, 3).some(t => Math.hypot(t.x - p.x, t.y - p.y) <= 1.2 + 1e-6));
    // At half density, about half the trees.
    a.objects = Array.from({ length: 40 }, (_, k) => tree(2 + (k % 8) * 4.5, 2 + Math.floor(k / 8) * 7));
    const half = propose(a, 'leaves', { density: 0.5, rand: seeded(5), env: named(NAMES) }).length;
    assert.ok(half > 10 && half < 30, `${half} of 40`);
});

test('motes and light shafts in a 4 to 12 m gap in the trees, the shafts leaning to the sun; none in the open', () => {
    // A ring of trees (crowns 3 m) 8 m round (25, 25): a clearing 10 m across.
    const ring = r =>
        Array.from({ length: 16 }, (_, k) => tree(25 + r * Math.cos((k * Math.PI) / 8), 25 + r * Math.sin((k * Math.PI) / 8)));
    const env = { ...named(NAMES), crownOf: () => 3 };
    const a = area(5);
    a.objects = ring(8);
    for (const id of ['motes', 'shafts']) {
        const got = propose(a, id, { rand: seeded(6), env });
        assert.equal(got.length, 1, id);
        assert.ok(Math.hypot(got[0].x - 25, got[0].y - 25) < 2, `${id} at ${got[0].x},${got[0].y}`);
    }
    assert.equal(propose(a, 'shafts', { rand: seeded(6), env })[0].bearing, Math.round(SUN_BEARING * 100) / 100);
    // A clearing 30 m across is open ground, not a gap; no trees, no gaps.
    a.objects = ring(18);
    assert.deepEqual(propose(a, 'motes', { rand: seeded(6), env }), []);
    a.objects = [];
    assert.deepEqual(propose(a, 'shafts', { rand: seeded(6), env }), []);
});

test("motes and shafts at a cave's mouth, the shafts just inside it leaning out", () => {
    const a = area(4);
    // A cave entrance at (20, 20) going in northwards.
    a.entrances = [{ id: 1, x: 20, y: 20, dir: Math.PI / 2, width: 4, depth: 3 }];
    const [m] = propose(a, 'motes', { rand: seeded(7) });
    assert.ok(Math.abs(m.x - 20) < 1e-6 && m.y < 20, `motes before the mouth: ${m.x},${m.y}`);
    const [s] = propose(a, 'shafts', { rand: seeded(7) });
    assert.ok(s.y > 20, 'the shaft stands inside');
    assert.equal(s.bearing, Math.round(((3 * Math.PI) / 2) * 100) / 100, 'leaning south, out of the cave');
});

test('blowing sand on dune crests and snow gusts on ridges, along the wind', () => {
    // A crest along x = 20: 1.5 m over the ground 6 m to either side.
    const dune = x => 5 + 1.5 * Math.max(0, 1 - Math.abs(x - 20) / 6);
    const a = area(4, { height: dune, texture: 'sandDesert' });
    const sand = propose(a, 'sand', { density: 2, wind: Math.PI, rand: seeded(8) });
    assert.ok(sand.length >= 4, `${sand.length}`);
    for (const p of sand) {
        assert.ok(Math.abs(p.x - 20) < 2.2, `${p.x}: on the crest`);
        assert.equal(p.bearing, Math.round(Math.PI * 100) / 100);
    }
    assert.deepEqual(propose(a, 'snow', { rand: seeded(8) }), [], 'no snow on sand');
    // A ridge 3 m over the ground 8 m away, snowy: snow gusts; none on a crest 0.8 m high.
    const ridge = x => 5 + 3 * Math.max(0, 1 - Math.abs(x - 20) / 8);
    assert.ok(propose(area(4, { height: ridge, texture: 'snowField' }), 'snow', { density: 2, rand: seeded(8) }).length >= 3);
    const low = x => 5 + 0.8 * Math.max(0, 1 - Math.abs(x - 20) / 6);
    assert.deepEqual(propose(area(4, { height: low, texture: 'snowField' }), 'snow', { density: 2, rand: seeded(8) }), []);
});

test('ground fog in a hollow lower than all ground within 15 m, not on the flat or in a valley open at one end', () => {
    const bowl = (x, y) => 5 - 2 * Math.max(0, 1 - Math.hypot(x - 25, y - 25) / 12);
    const fog = propose(area(5, { height: bowl }), 'groundfog', { density: 3, rand: seeded(9) });
    // A bowl's bottom is a spot: fog there, one sprite covering 10 m.
    assert.ok(fog.length >= 1, `${fog.length}`);
    for (const p of fog) assert.ok(Math.hypot(p.x - 25, p.y - 25) < 2, `${p.x},${p.y}`);
    assert.deepEqual(propose(area(5), 'groundfog', { density: 3, rand: seeded(9) }), []);
    // A valley falling to the east all the way across.
    const valley = (x, y) => 8 - x * 0.1 + Math.abs(y - 25) * 0.3;
    assert.deepEqual(propose(area(5, { height: valley }), 'groundfog', { density: 3, rand: seeded(9) }), []);
    // Filled with water, a hollow has mist, not fog.
    assert.deepEqual(propose(flood(area(5, { height: bowl }), 25, 25, 4.5), 'groundfog', { density: 3, rand: seeded(9) }).length, 0);
});

test('embers over each fire', () => {
    const a = area(3);
    a.objects = [tree(10, 10, 'fire'), tree(20, 20)];
    const embers = propose(a, 'embers', { rand: seeded(10), env: named(NAMES) });
    assert.equal(embers.length, 1);
    assert.deepEqual([embers[0].x, embers[0].y], [10, 10]);
});

test("Fill replaces the ticked kinds' placements and keeps the rest, never stopping on a count", () => {
    const a = lake();
    a.ambience = [{ kind: 'leaves', x: 1, y: 1, z: 5, scale: 1, seed: 1 }];
    const r = fill(a, KINDS, ['mist', 'fireflies'], { rand: seeded(11) });
    assert.equal(r.placed, r.byKind.get('mist') + r.byKind.get('fireflies'));
    assert.equal(a.ambience[0].kind, 'leaves');
    assert.equal(a.ambience.length, 1 + r.placed);
    assert.equal(a.ambience.filter(p => p.kind === 'mist').length, r.byKind.get('mist'));
    // Again: the same kinds replaced, not added to.
    const again = fill(a, KINDS, ['mist'], { rand: seeded(12) });
    assert.equal(a.ambience.filter(p => p.kind === 'mist').length, again.placed);
    // Dense, past what the design calls heavy: every proposed place is kept.
    const dense = fill(a, KINDS, ['mist', 'fireflies'], { density: 20, rand: seeded(13) });
    const live = liveOf(a.ambience, KINDS);
    assert.ok(Math.max(live.day, live.night) > AREA_LIVE_HEAVY, JSON.stringify(live));
    assert.ok(dense.byKind.get('mist') > 0 && dense.byKind.get('fireflies') > 0);
    assert.equal(clearKinds(a, ['mist', 'fireflies']), dense.placed);
    assert.deepEqual(
        a.ambience.map(p => p.kind),
        ['leaves'],
    );
});

test('the live count: night-only kinds count at night, day-only by day; heavy past 1,500 is a guide', () => {
    const list = [{ kind: 'fireflies' }, { kind: 'motes' }, { kind: 'mist' }, { kind: 'nothing' }];
    assert.deepEqual(liveOf(list, KINDS), { day: 48, night: 36 });
    assert.equal(AREA_LIVE_HEAVY, 1500);
});

test('the brush adds the chosen kind apart from its own, Shift clears only that kind, and it never stops on a count', () => {
    const a = area(4);
    const rand = seeded(14);
    for (let k = 0; k < 60; k++) ambienceStamp(a, kind('fireflies'), 20, 20, 8, { rand });
    const flies = a.ambience.filter(p => p.kind === 'fireflies');
    assert.ok(flies.length >= 4, `${flies.length}`);
    for (const p of flies) {
        assert.ok(Math.hypot(p.x - 20, p.y - 20) <= 8 + 1e-6);
        for (const q of flies) if (p !== q) assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= 6 - 0.02);
    }
    // Snow takes the wind's bearing.
    ambienceStamp(a, kind('snow'), 5, 5, 2, { rand, wind: Math.PI / 2 });
    assert.equal(a.ambience.find(p => p.kind === 'snow').bearing, 1.57);
    const r = ambienceStamp(a, kind('fireflies'), 20, 20, 30, { erase: true });
    assert.equal(r.removed, flies.length);
    assert.deepEqual(
        a.ambience.map(p => p.kind),
        ['snow'],
    );
    // Past what the design calls heavy, the brush still adds.
    for (let k = 0; k < 100; k++) a.ambience.push({ kind: 'mist', x: 1, y: 1, z: 0, scale: 1, seed: k });
    assert.ok(liveOf(a.ambience, KINDS).day > AREA_LIVE_HEAVY);
    let added = 0;
    for (let k = 0; k < 20; k++) added += ambienceStamp(a, kind('fireflies'), 20, 20, 10, { rand }).added;
    assert.ok(added > 0);
});

test('placements are one undo step, keep through a save, and export standing on the ground as it is now', () => {
    const a = lake();
    a.beginStroke();
    fill(a, KINDS, ['mist'], { rand: seeded(15) });
    const n = a.ambience.length;
    a.beginStroke();
    ambienceStamp(a, kind('leaves'), 5, 5, 3, { rand: seeded(16) });
    assert.equal(a.ambience.length, n + 1);
    a.undo();
    assert.equal(a.ambience.length, n);
    a.undo();
    assert.equal(a.ambience.length, 0);
    a.redo();
    assert.equal(a.ambience.length, n);
    // The JSON round trip; a list that isn't one is dropped.
    const back = Area.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    assert.deepEqual(back.ambience, a.ambience);
    assert.deepEqual(Area.fromJSON({ ...a.toJSON(), ambience: [{ kind: 'mist', x: 'a' }] }).ambience, []);
    // The ground raised after the Fill: the export stands the leaves on it, the mist on the water.
    a.ambience.push({ kind: 'leaves', x: 5, y: 5, z: 5, scale: 1, seed: 3 });
    a.heights.fill(7, 0, a.nx * 20);
    a.floodWater();
    initExport({ area: () => a, readOnly: () => false, view: { setMarkers() {} } });
    const { body } = areaRequest();
    const sent = JSON.parse(new TextDecoder().decode(body.subarray(grids(a)))).ambience;
    assert.equal(sent.length, n + 1);
    assert.equal(sent.at(-1).z, 7);
    assert.ok(sent.slice(0, -1).every(p => p.z === 4.5));
    assert.equal(surfaceAt(a, 5, 5), 7);
    // None: none sent.
    a.ambience = [];
    const none = JSON.parse(new TextDecoder().decode(areaRequest().body.subarray(grids(a))));
    assert.equal(none.ambience, null);
});
