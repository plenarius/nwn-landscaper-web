// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Soft paint (softpaint.js) against the bake: tests/fixtures/softpaint-bake.json holds what the engine's soft paint
// (src/generator/soft.rs) gives for a small painted grid (a staircase trail through snow running into a block of a third
// texture, and a line of it one sample wide): each sample's two heaviest textures and the second's share, the noise, and the
// ground's colour at points over it with crisp, broken and mixed edges. The view (softColour, its shader's rule) must draw the
// same.

import './importmap.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { SoftGrid, kernel, soften, fbm, seed, softColour, edgeOf } = await import('../js/softpaint.js');
const { Area } = await import('../js/area.js');

const bake = JSON.parse(readFileSync(new URL('fixtures/softpaint-bake.json', import.meta.url), 'utf8'));
const { nx, ny, spacing } = bake;
const grid = () => {
    const out = new Uint8Array(nx * ny * 4);
    soften(Uint8Array.from(bake.materials), nx, ny, 0, nx - 1, 0, ny - 1, out, kernel(spacing));
    return { out, nx, ny, origin: 0 };
};
// The bake's textures: flat colours with a ripple (the fixture's generator has the same).
const colourAt = (x, y) => m => {
    const r = 0.12 * Math.sin(x * 5.3 + y * 3.7 + m) * Math.cos(y * 4.1 - x * 2.3);
    return bake.base[m].map(v => v + r);
};

test('each sample keeps the bake’s two heaviest textures and the second’s share', () => {
    const g = grid();
    let off = 0;
    for (let k = 0; k < nx * ny; k++) {
        const [a, b, q] = bake.top.slice(k * 3, k * 3 + 3);
        assert.equal(g.out[k * 4], a, `sample ${k}`);
        assert.equal(g.out[k * 4 + 1], b, `sample ${k}`);
        // (sums in another order: a share on a rounding's edge may land one either side)
        assert.ok(Math.abs(g.out[k * 4 + 2] - q) <= 1, `sample ${k}: share ${g.out[k * 4 + 2]} against ${q}`);
        if (g.out[k * 4 + 2] !== q) off++;
    }
    assert.ok(off <= 3, `${off} shares off by one`);
});

test('the noise and its seeds are the bake’s', () => {
    // (the values soft.rs's the_noise_matches_the_editor_s checks)
    assert.equal(seed('grassMedium'), 0xad9f7dfe);
    for (const [x, y, s, v] of [
        [0, 0, 1, 0.21671623],
        [1.37, -2.5, seed('dirt'), 0.26015455],
        [213.3, 97.1, seed('snowFresh'), 0.051045932],
    ])
        assert.ok(Math.abs(fbm(x, y, s) - v) < 1e-6, `fbm(${x}, ${y}, ${s}) ${fbm(x, y, s)} against ${v}`);
    assert.deepEqual(bake.ids.map(seed), bake.seeds);
    for (const [x, y, s, v] of bake.fbm) assert.ok(Math.abs(fbm(x, y, s) - v) < 1e-6, `fbm(${x}, ${y}, ${s}) ${fbm(x, y, s)} against ${v}`);
});

for (const style of ['crisp', 'broken', 'mixed']) {
    test(`${style} edges draw the bake’s colours`, () => {
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
        // (a share off by one moves a crisp edge by a millimetre or two: a point right on it may differ)
        assert.ok(off <= 2, `${off} of ${points.length} points differ by more than 0.001 (worst ${worst})`);
    });
}

test('a texture’s edge is its catalog entry’s, else its category’s', () => {
    assert.equal(edgeOf({ edge: 'crisp', category: 'Earth' }), 'crisp');
    assert.equal(edgeOf({ edge: 'broken', category: 'Walls' }), 'broken');
    assert.equal(edgeOf({ edge: 'soft', category: 'Cobbles' }), 'crisp');
    for (const [c, e] of [
        ['Grass', 'broken'],
        ['Snow', 'broken'],
        ['Rock', 'broken'],
        ['Wooden planks', 'crisp'],
        ['Floors', 'crisp'],
    ])
        assert.equal(edgeOf({ category: c }), e, c);
    assert.equal(edgeOf(undefined), 'broken');
});

test('a stroke smooths again only as far as it reaches, the same as smoothing the whole area', () => {
    const area = Area.create('t', 2, 'flat');
    area.band = null;
    const g = new SoftGrid(area, spacing);
    for (let j = 6; j < 9; j++) for (let i = 10; i < 14; i++) area.materials[j * area.nx + i] = 1;
    const r = g.refresh({ i0: 10, i1: 13, j0: 6, j1: 8 });
    assert.deepEqual(r, { i0: 10 - g.k.reach, i1: 13 + g.k.reach, j0: 6 - g.k.reach, j1: 8 + g.k.reach });
    assert.deepEqual(g.out, new SoftGrid(area, spacing).out);
    assert.equal(g.refresh({ i0: 0, i1: 5, j0: 0, j1: 5 }), null);
});

test('with a band, the area’s edge is smoothed with the band’s paint beyond it', () => {
    const area = Area.create('t', 2, 'flat');
    assert.ok(area.band, 'a new area has a band');
    const g = new SoftGrid(area, spacing),
        n = area.band.n;
    // Paint the band one sample west of the area's south-west corner.
    area.band.materials[n * area.band.nx + n - 1] = 1;
    const r = g.refresh(null);
    assert.ok(r && r.i0 <= n - 1 && r.i1 >= n + 2);
    const o = (n * g.nx + n) * 4;
    assert.equal(g.out[o + 1], 1, 'the area’s corner sample feels the band’s paint');
});
