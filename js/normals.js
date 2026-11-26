// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The ground's normals, as landscaper gives them to the game (its heightmap.rs, `sample_normal`). On gentle ground, each sample's
// slope between its neighbours. Where a steep face runs across the samples' grid at a slant (a river's bank), that slope swings
// from one sample to the next with how the face crosses them, and the sun draws it as dark blotches along the face. Steep ground
// takes the slope over WIDE samples each way instead, blended in between GENTLE_NZ and STEEP_NZ of that wide slope's tilt.
//
// Area frame here: x east, y north, z up.

/** How many samples each way steep ground's slope is taken over: 1.25 m at 0.625 m a sample (landscaper's WIDE). */
export const WIDE = 2;
/** The tilts (as the wide normal's up part) between which the normal turns from the sample's own slope to the wide one: 15 and
 *  30 degrees (landscaper's GENTLE_NZ and STEEP_NZ). */
export const GENTLE_NZ = 0.966;
export const STEEP_NZ = 0.866;
/** How far (in samples) a changed height reaches the normals. */
export const REACH = WIDE + 1;

const unit = (east, north) => {
    const len = Math.hypot(east, north, 1);
    return [-east / len, -north / len, 1 / len];
};

/**
 * The normals of samples i0..i1, j0..j1 (clamped to the nx by ny samples) of the heights `h(i, j)`, `spacing` metres apart: for
 * each, `put(i, j, normal, near)`, `normal` as above and `near` the sample's own slope's (the steep test's: walkable or not).
 */
export const groundNormals = (h, nx, ny, spacing, i0, i1, j0, j1, put) => {
    i0 = Math.max(0, i0);
    j0 = Math.max(0, j0);
    i1 = Math.min(nx - 1, i1);
    j1 = Math.min(ny - 1, j1);
    if (i0 > i1 || j0 > j1) return;
    // Sums of the heights over rectangles (a summed-area table of the block the means read), so each mean is four reads.
    const a0 = Math.max(0, i0 - REACH),
        a1 = Math.min(nx - 1, i1 + REACH),
        b0 = Math.max(0, j0 - REACH),
        b1 = Math.min(ny - 1, j1 + REACH);
    const w = a1 - a0 + 2,
        sat = new Float64Array(w * (b1 - b0 + 2));
    for (let j = b0; j <= b1; j++) {
        let row = 0;
        for (let i = a0; i <= a1; i++) {
            row += h(i, j);
            sat[(j - b0 + 1) * w + i - a0 + 1] = sat[(j - b0) * w + i - a0 + 1] + row;
        }
    }
    const sum = (x0, x1, y0, y1) =>
        sat[(y1 - b0 + 1) * w + x1 - a0 + 1] -
        sat[(y0 - b0) * w + x1 - a0 + 1] -
        sat[(y1 - b0 + 1) * w + x0 - a0] +
        sat[(y0 - b0) * w + x0 - a0];
    // The heights averaged over `r` samples each way; near the area's edge over fewer, as many on each side, so a plane stays one.
    const mean = (i, j, r) => {
        const ri = Math.min(r, i, nx - 1 - i),
            rj = Math.min(r, j, ny - 1 - j);
        return sum(i - ri, i + ri, j - rj, j + rj) / ((2 * ri + 1) * (2 * rj + 1));
    };
    const slope = (i, j, r) => {
        const we = Math.max(i - 1, 0),
            e = Math.min(i + 1, nx - 1),
            s = Math.max(j - 1, 0),
            n = Math.min(j + 1, ny - 1);
        return unit((mean(e, j, r) - mean(we, j, r)) / ((e - we) * spacing), (mean(i, n, r) - mean(i, s, r)) / ((n - s) * spacing));
    };
    for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
            const near = slope(i, j, 0),
                wide = slope(i, j, WIDE);
            let t = Math.min(1, Math.max(0, (wide[2] - GENTLE_NZ) / (STEEP_NZ - GENTLE_NZ)));
            t = t * t * (3 - 2 * t);
            const n = near.map((c, k) => c + (wide[k] - c) * t),
                len = Math.hypot(n[0], n[1], n[2]);
            put(
                i,
                j,
                n.map(c => c / len),
                near,
            );
        }
    }
};
