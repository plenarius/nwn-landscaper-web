// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The ground's normals (normals.js), as landscaper's heightmap.rs gives them to the game (the same cases as its tests).

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { groundNormals } = await import('../js/normals.js');

/** Every sample's normal and own slope's of heights `h` (nx by ny, `sp` apart): [normals, near], row by row. */
const all = (h, nx, ny, sp) => {
    const normals = [],
        near = [];
    groundNormals(h, nx, ny, sp, 0, nx - 1, 0, ny - 1, (i, j, n, m) => {
        normals[j * nx + i] = n;
        near[j * nx + i] = m;
    });
    return [normals, near];
};

/** The normal at area point (x, y) between the samples' `normals`, blended bilinearly as the GPU blends the vertices'. */
const at = (normals, nx, sp, x, y) => {
    const fx = x / sp,
        fy = y / sp,
        i = Math.floor(fx),
        j = Math.floor(fy),
        tx = fx - i,
        ty = fy - j;
    const v = [0, 0, 0];
    for (const [a, b, w] of [
        [i, j, (1 - tx) * (1 - ty)],
        [i + 1, j, tx * (1 - ty)],
        [i, j + 1, (1 - tx) * ty],
        [i + 1, j + 1, tx * ty],
    ])
        for (let k = 0; k < 3; k++) v[k] += normals[b * nx + a][k] * w;
    const len = Math.hypot(...v);
    return v.map(c => c / len);
};

test('a plane’s normal is the same everywhere on it, edges and all', () => {
    // Rising 1 m a metre east and 2 m a metre north (samples 1 m apart): steep, so the wide slope's, which is the plane's too.
    const [normals, near] = all((i, j) => i + 2 * j, 4, 4, 1);
    const want = [-1, -2, 1].map(c => c / Math.sqrt(6));
    for (const n of [...normals, ...near])
        assert.ok(
            n.every((c, k) => Math.abs(c - want[k]) < 1e-9),
            `${n}`,
        );
});

test('a bank slanting across the samples is lit evenly, and gentle ground keeps its own slope', () => {
    // Gentle ground (3 degrees, rising east) with a river's bank across it at a slant: 1.6 m in one sample, along y = 0.4 x + 8.
    const n = 49,
        sp = 0.625;
    const h = (i, j) => 0.05 * i * sp + (j * sp > 0.4 * i * sp + 8 ? 1.6 : 0);
    const [normals, near] = all(h, n, n, sp);
    // The sun's light (from the south, 37 degrees up) along the face, every 0.1 m: how far it swings.
    const sun = [0, -0.8, 0.6];
    const swing = ns => {
        const light = [];
        for (let k = 50; k < 200; k++) {
            const x = k / 10,
                v = at(ns, n, sp, x, 0.4 * x + 8);
            light.push(v[0] * sun[0] + v[1] * sun[1] + v[2] * sun[2]);
        }
        return Math.max(...light) - Math.min(...light);
    };
    const before = swing(near),
        now = swing(normals);
    // (landscaper's test of the same bank: 0.203 and 0.009)
    assert.ok(Math.abs(before - 0.203) < 2e-3 && Math.abs(now - 0.009) < 2e-3, `swings ${before} on each sample's slope, ${now} now`);
    // 4 m from the bank, the ground's own slope, as before.
    const len = Math.hypot(0.05, 1);
    for (const x of [8, 12, 16]) {
        const v = at(normals, n, sp, x, 0.4 * x + 4);
        assert.ok(
            v.every((c, k) => Math.abs(c - [-0.05 / len, 0, 1 / len][k]) < 1e-6),
            `(${x}): ${v}`,
        );
    }
});

test('only samples i0..i1, j0..j1 are given, clamped to the area', () => {
    const seen = [];
    groundNormals(
        () => 0,
        5,
        4,
        1,
        -3,
        1,
        2,
        9,
        (i, j) => seen.push(`${i},${j}`),
    );
    assert.deepEqual(seen, ['0,2', '1,2', '0,3', '1,3']);
});
