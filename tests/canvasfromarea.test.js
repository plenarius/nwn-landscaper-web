// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Make a canvas from this area (CanvasArea.fromArea): the area becomes the canvas's first piece where it was, with its band,
// layers and lists, and the area is left as it was. With LANDSCAPER_BIN (a built `landscaper`), NWN_ROOT and
// LANDSCAPER_SHOWCASE, a showcase area (lsplains, or those FROMAREA_AREAS lists) is also exported both ways by the engine: as
// itself, and as the canvas's only piece.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// (the engine test talks to a real engine: the fetch from before browser.js swaps it)
// biome-ignore lint/plugin: this request goes to a real engine, not through the page; ask() sends the X-Landscaper header
const realFetch = globalThis.fetch;
await import('./browser.js');
const { Area } = await import('../js/area.js');
const { CanvasArea, BLOCK_STEP } = await import('../js/canvas.js');
const { BAND } = await import('../js/band.js');

/** Area `a`'s state that fromArea must not touch. */
const snapshot = a => JSON.stringify({ ...a.toJSON(), blend: a.blend ? [...a.blend] : null, band: a.band ? [...a.band.heights] : null });

/** A small area with something of everything: a shaped band, chasm, blend, water with bounds, lights, objects, things,
 *  an entrance and ambience. */
function sample() {
    const a = Area.create('fa', 4, 'hills');
    a.palette = ['grass', 'dirt'];
    for (let k = 0; k < a.materials.length; k++) a.materials[k] = k % 3 === 0 ? 1 : 0;
    a.chasm = new Uint8Array(a.nx * a.ny);
    a.chasm[20 * a.nx + 30] = 1;
    a.blend = new Uint16Array(a.nx * a.ny);
    a.blend[10 * a.nx + 11] = (200 << 8) | 1;
    a.band.heights[3] = 42;
    a.band.materials[3] = 1;
    a.water = [{ i: 5, j: 6, level: -50, bounds: [0, 0, 20, 20] }];
    a.lights = Array.from({ length: 16 }, (_, k) => [k, 0]);
    a.objects = [{ id: 1, model: 'tree', x: 5, y: 7, z: 3, bearing: 0, scale: 1, solid: true, baked: true }];
    a.things = [
        {
            id: 1,
            kind: 'trigger',
            x: 10,
            y: 10,
            bearing: 0,
            outline: [
                [8, 8],
                [12, 8],
                [12, 12],
            ],
        },
    ];
    a.entrances = [{ id: 1, x: 20, y: 20, dir: 0, width: 4, depth: 4, floor: 0 }];
    a.ambience = [{ kind: 'fireflies', x: 15, y: 16, z: 2 }];
    a.originals.moved['Placeable List:2'] = { x: 3, y: 4, bearing: 1 };
    a.settings = { tag: 'fa', pvp: 3 };
    a.floodWater();
    return a;
}

test('the area becomes piece 1 where it was: its own samples, its band round it, the band carried on past that', () => {
    const a = sample(),
        before = snapshot(a);
    const c = CanvasArea.fromArea(a, 'facv', 6);
    assert.equal(snapshot(a), before, 'the area is left as it was');
    assert.deepEqual([c.tiles, c.tilesY], [16, 16]);
    assert.deepEqual(
        c.canvas.pieces.map(({ id, name, x, y, w, h }) => ({ id, name, x, y, w, h })),
        [{ id: 1, name: 'fa', x: 6, y: 6, w: 4, h: 4 }],
    );
    assert.equal(c.canvas.pieceNextId, 2);
    assert.equal(c.header().tagPrefix, 'fa');
    assert.equal(c.doorTag({ id: 1 }), 'fa_ent1');
    // The piece as the engine cuts it out (its halo, BAND a side) is the band, the area in its middle.
    const off = 6 * 16,
        b = a.band;
    for (let j = 0; j < b.ny; j++)
        for (let i = 0; i < b.nx; i++) {
            const k = (j + off - BAND) * c.nx + i + off - BAND;
            assert.equal(c.heights[k], b.heights[j * b.nx + i]);
            assert.equal(c.materials[k], b.materials[j * b.nx + i]);
        }
    assert.equal(c.heights[off * c.nx + off], a.heights[0]);
    // Past the band, its edge carried outward.
    assert.equal(c.heights[0], b.heights[0]);
    assert.equal(c.heights[c.nx - 1], b.heights[b.nx - 1]);
    // The layers only the area's samples have, moved with it.
    assert.equal(c.chasm[(20 + off) * c.nx + 30 + off], 1);
    assert.equal(
        c.chasm.reduce((s, v) => s + v, 0),
        1,
    );
    assert.equal(c.blend[(10 + off) * c.nx + 11 + off], (200 << 8) | 1);
    // The lists, moved by the room added: 60 m.
    assert.deepEqual([c.objects[0].x, c.objects[0].y], [65, 67]);
    assert.deepEqual(c.things[0].outline, [
        [68, 68],
        [72, 68],
        [72, 72],
    ]);
    assert.deepEqual([c.entrances[0].x, c.ambience[0].x], [80, 75]);
    // An imported area's own objects stay with its piece, in its metres.
    assert.equal(c.canvas.pieces[0].originals.moved['Placeable List:2'].x, 3);
    assert.deepEqual(c.originals.moved, {});
    assert.deepEqual(c.water, [{ i: 101, j: 102, level: -50, bounds: [96, 96, 116, 116] }]);
    assert.deepEqual(c.lights[6 * 16 + 6], [0, 0]);
    assert.deepEqual(c.lights[7 * 16 + 7], [5, 0]);
    // The area's tag stays with its piece; the canvas's own settings, for pieces cut later, have none.
    assert.equal(c.canvas.pieces[0].settings.tag, 'fa');
    assert.equal(c.settings.tag, undefined);
    // Every block goes with the first save.
    assert.equal(c.canvas.dirty.size, 1);
    assert.ok(BLOCK_STEP >= c.nx - 1);
});

test('a canvas made from an area keeps its tag prefix when it is opened again', () => {
    const c = CanvasArea.fromArea(sample(), 'facv', 5);
    const back = CanvasArea.fromHeader({ header: JSON.parse(JSON.stringify(c.header())), version: 'v', blocks: {} }, {});
    assert.equal(back.canvas.tagPrefix, 'fa');
    assert.equal(back.header().tagPrefix, 'fa');
    assert.equal(new CanvasArea('plain', 4).header().tagPrefix, undefined);
});

test('a cave, or a canvas past 128 tiles, is refused', () => {
    assert.throws(() => CanvasArea.fromArea(Area.create('cv', 4, 'cave'), 'x', 5), /cave or an interior/);
    assert.throws(() => CanvasArea.fromArea(Area.create('big', 32, 'flat'), 'x', 49), /at most 128/);
});

const bin = process.env.LANDSCAPER_BIN,
    showcase = process.env.LANDSCAPER_SHOWCASE,
    game = process.env.NWN_ROOT;
const skip = !(bin && showcase && game) && 'LANDSCAPER_BIN, LANDSCAPER_SHOWCASE and NWN_ROOT are not all set';

/** `landscaper serve` on a fresh data folder (its starter textures from the game at NWN_ROOT): its address and a stop. */
async function serve(root) {
    const env = {
        PATH: process.env.PATH,
        HOME: path.join(root, 'home'),
        XDG_DATA_HOME: path.join(root, 'data'),
        NWN_ROOT: game,
        NWN_HOME: path.join(root, 'nwn'),
    };
    for (const d of ['home', 'data', 'nwn', 'web']) fs.mkdirSync(path.join(root, d), { recursive: true });
    fs.writeFileSync(path.join(root, 'web/index.html'), '<!doctype html><title>t</title>');
    assert.equal(spawnSync(bin, ['textures', 'init'], { env }).status, 0, 'landscaper textures init');
    const child = spawn(bin, ['serve', '--port', '0', '--web', path.join(root, 'web')], { env, stdio: ['ignore', 'pipe', 'ignore'] });
    const port = await new Promise((ok, fail) => {
        let out = '';
        child.stdout.on('data', d => {
            out += d;
            const m = /127\.0\.0\.1:(\d+)/.exec(out);
            if (m) ok(+m[1]);
        });
        child.on('exit', () => fail(new Error(`landscaper serve stopped: ${out}`)));
    });
    child.stdout.resume();
    return { base: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

/** The engine at `base` asked `method` `target` with `body`: its answer as JSON, or throws. */
async function ask(base, method, target, body, type = 'application/json') {
    const res = await realFetch(base + target, {
        method,
        headers: { 'X-Landscaper': '1', Origin: base, 'Content-Type': type },
        body,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${target}: ${res.status} ${text}`);
    return JSON.parse(text);
}

/** Area `a` as export.js sends it (its areaRequest, the parts a showcase area has). */
function areaBody(a) {
    const extra = new TextEncoder().encode(
        JSON.stringify({
            palette: a.palette,
            water: a.water,
            chasm: a.chasmRuns(),
            lights: a.lightsForExport(),
            entrances: a.entrances,
            atmosphere: a.atmosphere,
            objects: a.objects,
            things: a.things,
            settings: a.settings,
            originals: a.originals,
            ambience: a.ambience,
        }),
    );
    a.band.sync(a);
    const h = new Uint8Array(a.band.heights.buffer),
        body = new Uint8Array(h.length + a.band.materials.length + extra.length);
    body.set(h);
    body.set(a.band.materials, h.length);
    body.set(extra, h.length + a.band.materials.length);
    const q = new URLSearchParams({ name: a.name, tiles: a.tiles, tilesY: a.tilesY, shadow: a.shadow, halo: a.band.n, module: a.module });
    return { query: q.toString(), body };
}

/** What an export wrote of area `name` (its exports folder under `data`): the header and its grids. */
function exported(data, name) {
    const dir = path.join(data, 'landscaper/exports'),
        header = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
    const file = k => (header[k] ? fs.readFileSync(path.join(dir, header[k])) : null);
    return { header, heights: file('data'), materials: file('materials') };
}

/** Asserts `actual` is `expected`, but for places (an `x`, a `y`, an outline's points) within a micrometre: a piece moves what
 *  stands in it in and out of canvas metres, and an older save kept more digits than that. */
function samePlaces(actual, expected, where = '', key = '') {
    if (typeof expected === 'number' && ['x', 'y', 'outline'].includes(key)) {
        assert.ok(Math.abs(actual - expected) <= 1e-6, `${where}: ${actual}, not ${expected}`);
    } else if (expected && typeof expected === 'object') {
        assert.equal(typeof actual, 'object', where);
        assert.deepEqual(Object.keys(actual ?? {}).sort(), Object.keys(expected).sort(), where);
        for (const k of Object.keys(expected)) samePlaces(actual[k], expected[k], `${where}.${k}`, Array.isArray(expected) ? key : k);
    } else assert.equal(actual, expected, where);
}

/** A report's parts that say what was built: the terrain, its paint, water and objects (not the time, module or paths). */
function built(report) {
    const drop = new Set(['module', 'installed_module', 'hak', 'installed_hak', 'seconds', 'elapsed_ms', 'timings', 'took', 'files']);
    return JSON.parse(JSON.stringify(report, (k, v) => (drop.has(k) || /time|_ms$|path/i.test(k) ? undefined : v)));
}

for (const name of (process.env.FROMAREA_AREAS ?? 'lsplains').split(','))
    test(`showcase area ${name} made a canvas exports its only piece as the area itself`, { skip, timeout: 900_000 }, async t => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fromarea-')),
            { base, stop } = await serve(root);
        t.after(() => {
            stop();
            fs.rmSync(root, { recursive: true, force: true });
        });
        await fromShowcase(base, root, name);
    });

/** Exports showcase area `name` as itself and as the only piece of a canvas made from it, on the engine at `base` (its folder
 *  `root`), and compares what the two built. */
async function fromShowcase(base, root, name) {
    const a = Area.fromJSON(JSON.parse(fs.readFileSync(path.join(showcase, `${name}.json`), 'utf8')));
    if (a.enclosed()) {
        assert.throws(() => CanvasArea.fromArea(a, 'cv', 8), /cave or an interior/);
        return;
    }
    // The area exported as itself; its files kept aside, since the piece's export writes the same names.
    const { query, body } = areaBody(a);
    const areaReport = await ask(base, 'POST', `/api/export?${query}`, body, 'application/octet-stream');
    const data = path.join(root, 'data'),
        one = exported(data, a.name);
    // (and taken away, so the piece's export starts as fresh as the area's did)
    const exports = path.join(data, 'landscaper/exports');
    for (const f of fs.readdirSync(exports)) if (f.startsWith(`${a.name}.`)) fs.rmSync(path.join(exports, f));
    // The canvas: made, saved, and its piece exported.
    const cv = name.slice(0, 7),
        c = CanvasArea.fromArea(a, cv, 8);
    await ask(base, 'POST', `/api/canvas-new?name=${cv}`, JSON.stringify(c.header()));
    const made = await ask(base, 'GET', `/api/canvas?name=${cv}`);
    c.canvas.version = made.version;
    c.canvas.savedHeader = JSON.stringify(c.header());
    const sent = c.saveBody();
    c.saved(sent, await ask(base, 'PUT', `/api/canvas-save?name=${cv}`, JSON.stringify(sent.body)));
    const cut = await ask(base, 'POST', `/api/canvas-export?name=${cv}`, '');
    assert.equal(cut.pieces.length, 1);
    assert.equal(cut.pieces[0].name, a.name);
    const two = exported(data, a.name);
    const out = { area: built(areaReport), piece: built(cut.pieces[0].report) };
    if (process.env.FROMAREA_OUT)
        fs.writeFileSync(
            path.join(process.env.FROMAREA_OUT, `${name}.json`),
            JSON.stringify({ ...out, headers: [one.header, two.header] }, null, 1),
        );
    // The same terrain and paint, sample for sample, the band (the halo) included.
    assert.deepEqual(two.heights, one.heights, 'heights');
    assert.deepEqual(two.materials, one.materials, 'paint');
    const f32 = b => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    const [h1, h2] = [f32(one.heights), f32(two.heights)],
        w = one.header.width + 2 * (one.header.halo ?? 0);
    for (const [i, j] of [
        [0, 0],
        [80, 80],
        [200, 133],
        [336, 336],
        [w - 1, w - 1],
        [100, 300],
    ]) {
        assert.equal(h2[j * w + i], h1[j * w + i], `height at (${i}, ${j})`);
        assert.equal(two.materials[j * w + i], one.materials[j * w + i], `paint at (${i}, ${j})`);
    }
    // The same water, objects and the rest of the header (but for the module it goes into and the tag prefix it names).
    // (an empty list sent is none)
    const header = h =>
        Object.fromEntries(
            Object.entries({ ...h, module: null, tagPrefix: null, water: null }).filter(([, v]) => !(Array.isArray(v) && !v.length)),
        );
    // The water: the piece seeds each part of a body inside itself again (one seed a joined part, so fewer where the area had
    // several in one), so its seeds differ; flooded, they cover the same samples.
    const levels = e => [...new Set((e.header.water ?? []).map(w => w.level))].sort();
    assert.deepEqual(levels(two), levels(one), 'water levels');
    const wet = e => {
        const g = new Area('w', (w - 1) / 16, f32(e.heights).slice()),
            out = new Float32Array(w * w).fill(Number.NaN);
        for (const b of e.header.water ?? []) {
            const wet = g.flood(b);
            for (let k = 0; k < wet.length; k++) if (wet[k] && !(out[k] >= b.level)) out[k] = b.level;
        }
        return out;
    };
    const [w1, w2] = [wet(one), wet(two)];
    assert.deepEqual(w2, w1, 'the same samples under water');
    samePlaces(header(two.header), header(one.header), 'the export header');
    assert.equal(two.header.tagPrefix ?? a.name, a.name, 'tags start with the area name');
    // And the same report: tiles, walkmesh, objects, water and routes.
    assert.deepEqual(out.piece, out.area, 'the export reports');
}
