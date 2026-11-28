// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The blend layer (blend.js, soft paint stage 2): the view against the bake with weights (tests/fixtures/softpaint-blend.json:
// a soft gravel trail across a staircase edge and a cobble block, cores pinned; written by landscaper's src/generator/soft.rs,
// `SOFTPAINT_FIXTURE=<file> cargo test --lib write_editor_fixture -- --ignored`), the Paint brush's Softness, painting over a
// sample that holds two textures, the Mix brush's soft edge, the starters' weights, and the layer's round trip through the
// area file, the band and the export.

import './browser.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { kernel, soften, softColour } = await import('../js/softpaint.js');
const { Area, SPACING, MAX_RISE } = await import('../js/area.js');
const { Band } = await import('../js/band.js');
const { stamp, paintRim } = await import('../js/tools.js');
const { blendForSave, blendFromSave, blendValue, paintOver, pinned, sampleMix, secondOf, weightOf, StrokePaint } = await import(
    '../js/blend.js'
);
const { TERRAIN_STARTERS, seedTerrain } = await import('../js/starters.js');
const { initExport, areaRequest } = await import('../js/export.js');

const bake = JSON.parse(readFileSync(new URL('fixtures/softpaint-blend.json', import.meta.url), 'utf8'));
const { nx, ny, spacing } = bake;
/** The fixture's layer as the editor holds it. */
const fixtureBlend = () => Uint16Array.from({ length: nx * ny }, (_, k) => blendValue(bake.blend[2 * k], bake.blend[2 * k + 1]));
const grid = () => {
    const out = new Uint8Array(nx * ny * 4);
    soften(Uint8Array.from(bake.materials), nx, ny, 0, nx - 1, 0, ny - 1, out, kernel(spacing), fixtureBlend());
    return { out, nx, ny, origin: 0 };
};
const colourAt = (x, y) => m => {
    const r = 0.12 * Math.sin(x * 5.3 + y * 3.7 + m) * Math.cos(y * 4.1 - x * 2.3);
    return bake.base[m].map(v => v + r);
};

test('with weights, each sample keeps the bake’s two textures and the second’s share', () => {
    const g = grid();
    let layered = 0,
        off = 0;
    for (let k = 0; k < nx * ny; k++) {
        const [a, b, q] = bake.top.slice(k * 3, k * 3 + 3),
            own = bake.blend[2 * k + 1] > 0;
        if (own) layered++;
        assert.equal(g.out[k * 4], a, `sample ${k}`);
        assert.equal(g.out[k * 4 + 1], b, `sample ${k}`);
        // (a layered sample is the bake's to the byte; a smoothed one may round a share one either side)
        if (own) assert.equal(g.out[k * 4 + 2], q, `layered sample ${k}`);
        else assert.ok(Math.abs(g.out[k * 4 + 2] - q) <= 1, `sample ${k}: share ${g.out[k * 4 + 2]} against ${q}`);
        if (g.out[k * 4 + 2] !== q) off++;
    }
    assert.ok(layered > 100, `${layered} layered samples`);
    assert.ok(off <= 3, `${off} shares off by one`);
});

for (const style of ['crisp', 'broken', 'mixed', 'soft']) {
    test(`${style} edges with weights draw the bake’s colours`, () => {
        const g = grid(),
            { edges, points } = bake[style],
            looks = edges.map((edge, m) => ({ edge, seed: bake.seeds[m], mean: bake.means[m] }));
        let off = 0,
            worst = 0;
        for (const [x, y, ...want] of points) {
            const got = softColour(g, spacing, x, y, colourAt(x, y), looks);
            const d = Math.max(...got.map((v, k) => Math.abs(v - want[k])));
            worst = Math.max(worst, d);
            if (d > 0.001) off++;
        }
        assert.ok(off <= 2, `${off} of ${points.length} points differ by more than 0.001 (worst ${worst})`);
    });
}

test('a sample whose second weighs more than half is drawn with it first, and a pinned one alone', () => {
    const src = Uint8Array.from([0, 1, 2, 2]),
        out = new Uint8Array(16);
    const blend = Uint16Array.from([blendValue(1, 200), blendValue(0, 128), pinned(2), 0]);
    soften(src, 4, 1, 0, 3, 0, 0, out, kernel(SPACING), blend);
    assert.deepEqual([...out.subarray(0, 3)], [1, 0, 55]);
    assert.deepEqual([...out.subarray(4, 7)], [1, 0, 128]);
    assert.deepEqual([...out.subarray(8, 11)], [2, 2, 0]);
});

// --- The Paint brush's Softness --------------------------------------------------------------------------------------------

/** An area of grass (0) with texture 1 in its palette, and no band. */
function plain() {
    const a = Area.create('b', 2, 'flat');
    a.band = null;
    a.materialIndex('gravelGrey');
    return a;
}
/** Texture `m`'s share of sample k. */
const shareOf = (a, k, m) => sampleMix(a.materials[k], a.blend[k]).find(([t]) => t === m)?.[1] ?? 0;

test('Softness writes weights falling off towards the rim, half way where the fade is, the core pinned', () => {
    const a = plain(),
        x = 10.1,
        y = 10.2,
        radius = 6,
        softness = 0.6;
    stamp(a, 'paint', x, y, radius, 1, 1 / 60, null, 1, softness, new StrokePaint(a));
    const { inner, outer } = paintRim(radius, radius, softness);
    let last = 2;
    for (let j = 0; j < a.ny; j++)
        for (let i = 0; i < a.nx; i++) {
            const k = j * a.nx + i,
                d = Math.hypot(i * SPACING - x, j * SPACING - y),
                s = shareOf(a, k, 1);
            if (d <= inner) assert.equal(a.blend[k], pinned(1), `core sample ${i},${j} pinned`);
            if (d >= outer) assert.equal(s, 0, `beyond the rim ${i},${j}`);
            // (the heavier texture is the paint)
            assert.ok(weightOf(a.blend[k]) <= 128 || secondOf(a.blend[k]) === a.materials[k]);
        }
    // Along a line out from the middle: never rising, and half way between the samples either side of the fade's middle.
    const mid = (inner + outer) / 2;
    for (let i = Math.round(x / SPACING); i < a.nx; i++) {
        const k = Math.round(y / SPACING) * a.nx + i,
            s = shareOf(a, k, 1);
        assert.ok(s <= last + 1e-9, `falls off at ${i}`);
        last = s;
    }
    // The half-way line read straight between samples: within 3 cm of the fade's middle all round.
    let worst = 0;
    for (let t = 0; t < 64; t++) {
        const ang = (t / 64) * 2 * Math.PI;
        let lo = inner,
            hi = outer;
        const at = r => {
            const px = x + r * Math.cos(ang),
                py = y + r * Math.sin(ang),
                fx = px / SPACING,
                fy = py / SPACING,
                i = Math.floor(fx),
                j = Math.floor(fy),
                tx = fx - i,
                ty = fy - j,
                v = (di, dj) => shareOf(a, (j + dj) * a.nx + i + di, 1);
            return (v(0, 0) * (1 - tx) + v(1, 0) * tx) * (1 - ty) + (v(0, 1) * (1 - tx) + v(1, 1) * tx) * ty;
        };
        for (let h = 0; h < 30; h++) {
            const m = (lo + hi) / 2;
            if (at(m) > 0.5) lo = m;
            else hi = m;
        }
        worst = Math.max(worst, Math.abs(lo - mid));
    }
    assert.ok(worst < 0.03, `the half-way line strays ${worst.toFixed(3)} m from the brush's`);
});

test('holding a soft brush still does not build up: a sample takes the most the stroke gave it', () => {
    const a = plain(),
        painter = new StrokePaint(a);
    for (let s = 0; s < 20; s++) stamp(a, 'paint', 10, 10, 5, 1, 1 / 60, null, 1, 0.8, painter);
    const once = plain();
    stamp(once, 'paint', 10, 10, 5, 1, 1 / 60, null, 1, 0.8, new StrokePaint(once));
    assert.deepEqual(a.blend, once.blend);
    assert.deepEqual(a.materials, once.materials);
});

test('Softness 0 paints hard, as before: one texture a sample, no weights, and it clears weights under it', () => {
    const a = plain();
    stamp(a, 'paint', 10, 10, 5, 1, 1 / 60, null, 1, 0.8, new StrokePaint(a));
    assert.ok(a.blend.some(v => v));
    stamp(a, 'paint', 10, 10, 6, 1, 1 / 60, null, 0, 0, null);
    assert.ok(a.blend.every(v => v === 0));
    assert.ok(a.materials.every(m => m === 0));
});

test('painting over a sample with two textures keeps the two heaviest, the third going', () => {
    // Snow (0) 70%, gravel (1) 30%; cobbles (2) at 20%: snow 56, gravel 24, cobbles 20: gravel stays.
    let [m, v] = paintOver(0, blendValue(1, 77), 2, 0.2, true);
    assert.equal(m, 0);
    assert.equal(secondOf(v), 1);
    assert.ok(Math.abs(weightOf(v) / 255 - 24 / 80) < 0.01);
    // Cobbles at 50%: snow 35, gravel 15, cobbles 50: cobbles first, snow second.
    [m, v] = paintOver(0, blendValue(1, 77), 2, 0.5, true);
    assert.equal(m, 2);
    assert.equal(secondOf(v), 0);
    assert.ok(Math.abs(weightOf(v) / 255 - 35 / 85) < 0.01);
    // Wholly the brush's: pinned for a soft brush, plain paint for a hard one.
    assert.deepEqual(paintOver(0, blendValue(1, 77), 2, 1, true), [2, pinned(2)]);
    assert.deepEqual(paintOver(0, blendValue(1, 77), 2, 1, false), [2, 0]);
    // Too little to show: the sample as it was (not pinned to what it had).
    assert.deepEqual(paintOver(0, 0, 2, 0.001, true), [0, 0]);
    // Painting a texture already there raises its share.
    [m, v] = paintOver(0, blendValue(1, 100), 1, 0.5, true);
    assert.equal(m, 1);
    assert.equal(secondOf(v), 0);
    assert.ok(Math.abs(weightOf(v) / 255 - (1 - 100 / 255) * 0.5) < 0.01);
});

// --- Saving and exporting ----------------------------------------------------------------------------------------------------

test('the layer goes through the area file and the band, and nothing is saved when no sample has a weight', () => {
    const a = Area.create('rt', 2, 'flat');
    a.materialIndex('gravelGrey');
    let o = JSON.parse(JSON.stringify(a.toJSON()));
    assert.ok(!('blend' in o) && o.band === null, 'no key at all without weights (and an untouched band not at all)');
    stamp(a, 'paint', 3, 3, 5, 1, 1 / 60, null, 1, 0.7, new StrokePaint(a));
    a.band.sync(a);
    a.band.blend[5] = blendValue(1, 40);
    o = JSON.parse(JSON.stringify(a.toJSON()));
    assert.equal(typeof o.blend, 'string');
    assert.equal(typeof o.band.blend, 'string');
    const back = Area.fromJSON(o);
    assert.deepEqual(back.blend, a.blend);
    // (the band keeps its own samples; the area's middle is the area's)
    const b = a.band,
        own = (_, k) => !b.inArea(k % b.nx, Math.floor(k / b.nx), a);
    assert.deepEqual(back.band.blend.filter(own), b.blend.filter(own));
    assert.equal(back.band.blend[5], blendValue(1, 40));
    // The bytes: interleaved [second, weight], [0, 0] where there is no weight.
    const bytes = Buffer.from(o.blend, 'base64');
    assert.equal(bytes.length, 2 * a.nx * a.ny);
    for (let k = 0; k < a.nx * a.ny; k++) {
        assert.equal(bytes[2 * k], a.blend[k] & 255);
        assert.equal(bytes[2 * k + 1], a.blend[k] >>> 8);
    }
    // A layer of the wrong size, or naming a texture past the palette, is dropped or loses that weight.
    assert.equal(blendFromSave(o.blend, a.nx * a.ny + 1, 2), null);
    const odd = Buffer.from([5, 9, 1, 9]).toString('base64');
    assert.deepEqual([...blendFromSave(odd, 2, 2)], [0, blendValue(1, 9)]);
    // Weightless samples are written as zeros, whatever their index.
    assert.equal(blendForSave(Uint16Array.from([7, 0])), null);
    assert.equal(blendForSave(Uint16Array.from([7, blendValue(1, 3)])), Buffer.from([0, 0, 1, 3]).toString('base64'));
});

test('undo takes a soft stroke back, weights and all', () => {
    const a = plain();
    a.beginStroke();
    const before = a.blend.slice();
    const painter = new StrokePaint(a);
    for (let x = 4; x < 16; x += 0.5) stamp(a, 'paint', x, 9, 4, 1, 1 / 60, null, 1, 0.7, painter);
    const after = a.blend.slice();
    assert.notDeepEqual(after, before);
    a.undo();
    assert.deepEqual(a.blend, before);
    assert.ok(a.materials.every(m => m === 0));
    a.redo();
    assert.deepEqual(a.blend, after);
});

test('the export sends the layer over the band’s grid in its JSON, and none without weights', () => {
    const a = Area.create('ex', 2, 'flat');
    a.materialIndex('gravelGrey');
    initExport({ area: () => a, readOnly: () => false, view: { setMarkers() {} } });
    const json = () => {
        const { body } = areaRequest(),
            grids = a.band.heights.byteLength + a.band.materials.byteLength;
        return JSON.parse(new TextDecoder().decode(body.subarray(grids)));
    };
    assert.ok(!('blend' in json()));
    stamp(a, 'paint', 1, 1, 4, 1, 1 / 60, null, 1, 0.7, new StrokePaint(a));
    const sent = Buffer.from(json().blend, 'base64'),
        b = a.band;
    assert.equal(sent.length, 2 * b.nx * b.ny);
    // (the area's samples in the middle of the band's grid)
    const k = (b.n + 2) * b.nx + b.n + 2,
        ak = 2 * a.nx + 2;
    assert.equal(sent[2 * k + 1], a.blend[ak] >>> 8);
    assert.ok(sent.some((v, i) => i % 2 === 1 && v > 0));
});

test('a band filled from the area carries its weights out', () => {
    const a = Area.create('bf', 2, 'flat');
    a.materialIndex('gravelGrey');
    a.blend[0] = blendValue(1, 60);
    const b = Band.extruded(a);
    assert.equal(b.blend[0], blendValue(1, 60));
});

// --- The starters ------------------------------------------------------------------------------------------------------------

const library = {
    byId: new Map(['snowPacked', 'snowFresh', 'snowDrift', 'rockFrosted', 'sandFine', 'sandSoft', 'sandDune'].map(id => [id, {}])),
};

test('the snowy pass’s rock and snow meet where the slope passes the rule’s, not on the grid', () => {
    const s = TERRAIN_STARTERS['snowy-pass'],
        a = Area.create('sp', s.size[0], 'flat', 5, s.size[1]);
    seedTerrain(a, s, 5, library, 7);
    const rock = a.palette.indexOf('rockFrosted'),
        { nx, ny, heights: h } = a;
    const steep = k => {
        const i = k % nx,
            j = (k - i) / nx;
        let r = 0;
        for (const [di, dj] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
        ])
            if (i + di >= 0 && i + di < nx && j + dj >= 0 && j + dj < ny) r = Math.max(r, Math.abs(h[k + dj * nx + di] - h[k]));
        return r / MAX_RISE;
    };
    // Every pair of neighbours across the rock's edge: rock's share read straight between them passes a half where the slope
    // read straight between them passes 1.7 (the rule), when both samples' nearest edge is that one.
    let pairs = 0,
        close = 0,
        unweighted = 0;
    for (let k = 0; k < nx * ny; k++) {
        const i = k % nx;
        for (const q of [i < nx - 1 ? k + 1 : -1, k + nx < nx * ny ? k + nx : -1]) {
            if (q < 0 || (a.materials[k] === rock) === (a.materials[q] === rock)) continue;
            pairs++;
            if (!a.blend[k] || !a.blend[q]) unweighted++;
            const sk = shareOf(a, k, rock),
                sq = shareOf(a, q, rock),
                byWeight = (0.5 - sk) / (sq - sk),
                bySlope = (1.7 - steep(k)) / (steep(q) - steep(k));
            if (Math.abs(byWeight - bySlope) < 0.05) close++;
        }
    }
    assert.ok(pairs > 500, `${pairs} pairs across the rock's edge`);
    assert.ok(unweighted / pairs < 0.02, `${unweighted} of ${pairs} pairs without weights`);
    assert.ok(close / pairs > 0.7, `${close} of ${pairs} pairs put the edge where the rule does`);
});

test('every starter writes weights only beside another texture, the heavier in the paint', () => {
    for (const [id, s] of Object.entries(TERRAIN_STARTERS)) {
        const a = Area.create('st', s.size[0], 'flat', 5, s.size[1]);
        seedTerrain(a, s, 5, library, 3);
        const { nx } = a;
        let weighted = 0;
        for (let k = 0; k < a.blend.length; k++) {
            if (!a.blend[k]) continue;
            weighted++;
            assert.ok(weightOf(a.blend[k]) <= 128, `${id}: sample ${k} has the lighter texture in its paint`);
            const i = k % nx,
                near = [k - 1, k + 1, k - nx, k + nx].filter(
                    (q, n) => q >= 0 && q < a.blend.length && !(n === 0 && i === 0) && !(n === 1 && i === nx - 1),
                );
            // (beside another texture; the second is the one the rule picks a millimetre past the edge, which may lie between the two)
            assert.ok(
                near.some(q => a.materials[q] !== a.materials[k]),
                `${id}: sample ${k} has a weight but no other texture beside it`,
            );
            assert.ok(secondOf(a.blend[k]) !== a.materials[k] && secondOf(a.blend[k]) < a.palette.length);
        }
        assert.ok(weighted > 0, `${id} writes weights`);
    }
});
