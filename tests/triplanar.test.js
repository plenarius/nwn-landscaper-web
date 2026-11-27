// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Triplanar texturing (triplanar.js): the weights and projections landscaper's triplanar.rs has (the same cases as its tests),
// and the view's GLSL drawing them alike.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { SHARPNESS, TEXTURE_METRES, triplanarGlsl, uv, weights } = await import('../js/triplanar.js');

const close = (a, b) => Math.abs(a - b) < 1e-6;

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

test('the view’s GLSL has the same projections, v negated for its texture array, and the same sharpness', () => {
    const glsl = triplanarGlsl('vN', 'vA', 'vU');
    assert.match(glsl, new RegExp(`pow\\(abs\\(triN\\), vec3\\(${SHARPNESS}\\.0\\)\\)`));
    // Blended by the smoothed normal vN, except at a crease, where by the face's own (from vA and vU's derivatives).
    assert.match(glsl, /vec3 triS = normalize\(vN\);/);
    assert.match(glsl, /cross\(dFdx\(vec3\(vA, vU\)\), dFdy\(vec3\(vA, vU\)\)\)/);
    assert.match(glsl, /triN = mix\(triN, triS, smoothstep\(0\.90, 0\.98, abs\(dot\(triN, triS\)\)\)\);/);
    assert.match(glsl, /vec2 triX = vec2\(vA\.y, -vU\) \/ 4\.0;/);
    assert.match(glsl, /vec2 triY = vec2\(vA\.x, -vU\) \/ 4\.0;/);
    assert.match(glsl, /vec2 triZ = vec2\(vA\.x, -vA\.y\) \/ 4\.0;/);
    assert.match(glsl, /vec3\(triX, layer\)\) \* triW\.x \+ .*vec3\(triY, layer\)\) \* triW\.y \+ .*vec3\(triZ, layer\)\) \* triW\.z/);
});
