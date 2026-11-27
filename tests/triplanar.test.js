// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Triplanar texturing (triplanar.js): the weights and projections landscaper's triplanar.rs has (the same cases as its tests),
// and the view's GLSL drawing them alike.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
    SHARPNESS,
    SKEW,
    TEXTURE_METRES,
    VARY_CELLS,
    VARY_FLOOR,
    cellOffset,
    hexCells,
    metresOf,
    shade,
    triplanarGlsl,
    uv,
    varied,
    variedGlsl,
    varyOf,
    weights,
} = await import('../js/triplanar.js');

const close = (a, b) => Math.abs(a - b) < 1e-6;

/** The texture point (repeats, `cells` a repeat) at skewed-grid point `k`: hexCells' skew undone. */
const unskew = (k, cells) => {
    const sv = k[1] / SKEW[1];
    return [(k[0] + SKEW[0] * sv) / cells, sv / cells];
};

test('flat ground is drawn from above alone', () => {
    assert.deepEqual(weights([0, 0, 1]), [0, 0, 1]);
});

test('the weights sum to one whatever the normal’s length or sign', () => {
    for (const n of [
        [0.3, -0.4, 0.8],
        [-2, 1, 0.5],
        [1, 1, 0],
        [0, -5, 0],
    ]) {
        const w = weights(n);
        assert.ok(close(w[0] + w[1] + w[2], 1), `${n}: ${w}`);
        assert.ok(w.every(c => c >= 0));
    }
});

test('ground facing a diagonal takes both side projections evenly', () => {
    // The case the old projection along x + y smeared into streaks.
    for (const n of [
        [1, 1, 0],
        [-1, -1, 0],
    ]) {
        const w = weights(n);
        assert.ok(close(w[0], 0.5) && close(w[1], 0.5) && close(w[2], 0), `${n}: ${w}`);
    }
});

test('the blend is narrow: 90% from above at 30 degrees, even at 45, 90% from the side at 60', () => {
    const at = deg => weights([Math.sin((deg * Math.PI) / 180), 0, Math.cos((deg * Math.PI) / 180)]);
    assert.ok(close(at(30)[2], 0.9), `${at(30)}`);
    assert.ok(close(at(45)[2], 0.5));
    assert.ok(close(at(60)[0], 0.9));
});

test('each projection keeps one repeat to 4 m of the ground it faces', () => {
    assert.equal(TEXTURE_METRES, 4);
    assert.deepEqual(uv(2, [4, 8, 3]), [1, 2]);
    assert.deepEqual(uv(0, [4, 8, 2]), [2, 0.5]);
    assert.deepEqual(uv(1, [4, 8, 2]), [1, 0.5]);
});

test('a texture whose catalog entry says so covers more metres a repeat: cliff rock 8', () => {
    assert.deepEqual(uv(0, [4, 8, 2], 8), [1, 0.25]);
    assert.equal(metresOf({ metres: 8 }), 8);
    for (const entry of [undefined, {}, { metres: 0 }, { metres: 'x' }, { metres: 100 }]) assert.equal(metresOf(entry), 4);
});

test('the view’s GLSL has the same projections, v negated for its texture array, and the same sharpness', () => {
    const glsl = triplanarGlsl('vN', 'vA', 'vU');
    assert.match(glsl, new RegExp(`pow\\(abs\\(triN\\), vec3\\(${SHARPNESS}\\.0\\)\\)`));
    // Blended by the smoothed normal vN, except at a crease, where by the face's own (from vA and vU's derivatives).
    assert.match(glsl, /vec3 triS = normalize\(vN\);/);
    assert.match(glsl, /cross\(dFdx\(vec3\(vA, vU\)\), dFdy\(vec3\(vA, vU\)\)\)/);
    assert.match(glsl, /triN = mix\(triN, triS, smoothstep\(0\.90, 0\.98, abs\(dot\(triN, triS\)\)\)\);/);
    assert.match(glsl, /vec2 triX = vec2\(vA\.y, vU\);/);
    assert.match(glsl, /vec2 triY = vec2\(vA\.x, vU\);/);
    assert.match(glsl, /vec2 triZ = vec2\(vA\.x, vA\.y\);/);
    // Each layer at its own metres a repeat (TRI_METRES, which the view defines from its layer table), 4 m when not defined.
    assert.match(glsl, /#ifndef TRI_METRES\s+#define TRI_METRES\(layer\) 4\.0\s+#endif/);
    assert.match(
        glsl,
        /triVaried\(triX \/ TRI_METRES\(layer\), layer, TRI_VARY\(layer\)\) \* triW\.x \+ .*triVaried\(triY \/ TRI_METRES\(layer\), layer, TRI_VARY\(layer\)\) \* triW\.y \+ .*triVaried\(triZ \/ TRI_METRES\(layer\), layer, TRI_VARY\(layer\)\) \* triW\.z/,
    );
    // The game's v runs up, the texture array's rows down: negated at the fetch, after the cells are found in the game's terms.
    assert.match(variedGlsl, /texture\(uTex, vec3\(uv\.x, -uv\.y, layer\)\)/);
});

test('a varied repeat: three cells share a point, each keeps its slot, and a slot changes cell only where its share is 0', () => {
    for (const p of [
        [0.1, 0.2],
        [3.7, -2.25],
        [10.5, 7.33],
    ]) {
        const cells = hexCells(p, VARY_CELLS);
        assert.ok(
            close(
                cells.reduce((t, c) => t + c[1], 0),
                1,
            ),
            `${p}`,
        );
        for (const [slot, [v]] of cells.entries()) assert.equal((((v[0] + 2 * v[1]) % 3) + 3) % 3, slot);
    }
    for (let x = 0; x < 400; x++) {
        const [a, b] = [hexCells([x * 0.01, 0.37], 2), hexCells([x * 0.01 + 0.0001, 0.37], 2)];
        for (let s = 0; s < 3; s++) if (a[s][0].join() !== b[s][0].join()) assert.ok(a[s][1] < 1e-3 && b[s][1] < 1e-3, `${x}`);
    }
});

test('a varied repeat keeps a flat colour, breaks a grid, and matches landscaper’s numbers', () => {
    const flat = varied([1.3, 2.7], VARY_CELLS, () => [0.4, 0.5, 0.6]);
    assert.ok(
        flat.every((c, k) => close(c, [0.4, 0.5, 0.6][k])),
        `${flat}`,
    );
    const dot = (u, v) => (((u % 1) + 1) % 1 < 0.1 && ((v % 1) + 1) % 1 < 0.1 ? [1, 1, 1] : [0, 0, 0]);
    const lit = [...Array(8).keys()].map(k => varied([k + 0.05, 0.05], VARY_CELLS, dot)[0] > 0.5);
    assert.ok(
        lit.some(l => !l),
        `${lit}`,
    );
    assert.ok(close(cellOffset([3, 5])[0], Math.sin(3 * 1.7 + 5 * 3.1)) && close(cellOffset([3, 5])[1], Math.sin(3 * 2.3 - 5 * 1.3 + 0.7)));
    assert.ok(shade([123, 45, 6]) > 0.9 && shade([123, 45, 6]) < 1.1);
    // On for natural ground and rock, off for laid surfaces, unless the entry says; cells by the picture's own repeats.
    assert.equal(varyOf({}, 'broken'), 1.5);
    assert.equal(varyOf({ repeats: 2 }, 'broken'), 3);
    assert.equal(varyOf({}, 'crisp'), 0);
    assert.equal(varyOf({ vary: false }, 'broken'), 0);
    assert.equal(varyOf({ vary: true }, 'crisp'), 1.5);
});

test('a varied repeat keeps a dark colour in the middle of a cell’s triangle, where the three shares are a third each', () => {
    // A third to the 14th is 2e-7: weighed by the shares as they are, the sum fell under the shader's floor and the middle of
    // every triangle drew dark (dots 1.25 m apart on all natural ground, the /try/ page's lake vale).
    for (const colour of [0.02, 0.2, 0.6]) {
        const p = unskew([2 + 1 / 3, 3 + 1 / 3], VARY_CELLS);
        assert.ok(
            hexCells(p, VARY_CELLS).every(([, w]) => Math.abs(w - 1 / 3) < 1e-4),
            `${p}`,
        );
        const c = varied(p, VARY_CELLS, () => [colour, colour, colour]);
        assert.ok(close(c[0], colour), `${colour}: ${c}`);
    }
    // The shader scales its shares alike, and divides by no less than the same floor.
    assert.match(variedGlsl, /w \/= max\(w\.x, max\(w\.y, w\.z\)\);/);
    assert.ok(variedGlsl.includes(`max(total, ${VARY_FLOOR.toFixed(8)})`));
});
