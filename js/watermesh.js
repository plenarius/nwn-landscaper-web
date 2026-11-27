// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The water's surface as the view draws it, built as landscaper builds the game's (water_surface, the halo's and the edge
// scenery's water): a flat quad at the level over each 0.625 m cell with a corner under the surface, the shallows under
// WET_DEPTH too. Each corner carries its depth over the ground, so the view draws the shallows as a faint film and nothing where
// the ground comes up through the water: the shore is where they meet, not the cells' edges.

import { SPACING } from './area.js';

/** The water's opacity a few centimetres deep, of its full opacity: the film over a ford (the game draws shallows almost
 *  clear). It deepens to the full opacity at SHALLOW, too deep to walk. */
export const WATER_FILM = 0.35;

/** Metres the water is carried out past the edge without a band, as the edge scenery has it. */
const OUT = 50;

/** The higher of two levels, a dry one (NaN) counting as none. */
const top = (a, b) => (Number.isNaN(b) || b < a ? a : b);

/** The water over `area` and its band (or its edge scenery without one), the ground at `heights` (the heights the view draws):
 *  `pos`, three vertices a triangle in three.js's frame, and `depth`, each vertex's metres over the ground under it. Its
 *  triangles split each cell as the ground's do, so a depth between the corners is the depth there. */
export function waterMesh(area, heights = area.heights) {
    const pos = [],
        depth = [],
        size = area.sizeY;
    // A quad at level l from area point (x0, y0) to (x1, y1), with the ground at g00 (x0, y0), g10, g11 and g01 under it.
    const quad = (x0, y0, x1, y1, l, g00, g10, g11, g01) => {
        const z0 = size - y0,
            z1 = size - y1;
        pos.push(x0, l, z0, x1, l, z0, x1, l, z1, x0, l, z0, x1, l, z1, x0, l, z1);
        depth.push(l - g00, l - g10, l - g11, l - g00, l - g11, l - g01);
    };
    // Each cell of a grid of nx samples a row with a corner under its surface S over ground h, `skip` leaving cells out.
    const cells = (S, h, nx, ny, origin, skip) => {
        for (let j = 0; j < ny - 1; j++)
            for (let i = 0; i < nx - 1; i++) {
                if (skip?.(i, j)) continue;
                // (Without a list of the four for each cell: it was most of a water drag's redraw.)
                const k = j * nx + i,
                    level = top(top(top(top(-Infinity, S[k]), S[k + 1]), S[k + nx]), S[k + nx + 1]);
                if (level === -Infinity) continue;
                const x0 = (i - origin) * SPACING,
                    y0 = (j - origin) * SPACING;
                quad(x0, y0, x0 + SPACING, y0 + SPACING, level, h[k], h[k + 1], h[k + nx + 1], h[k + nx]);
            }
    };
    const { nx, ny } = area;
    cells(area.surfaceLevel, heights, nx, ny, 0);
    const band = area.band;
    if (band) {
        const n = band.n;
        cells(band.surfaceLevel, band.heights, band.nx, band.ny, n, (i, j) => i >= n && j >= n && i < n + nx - 1 && j < n + ny - 1);
        return { pos, depth };
    }
    // Without a band: each boundary's water carried out, over its profile carried out (the edge scenery).
    const S = area.surfaceLevel,
        sx = area.sizeX,
        at = (i, j) => S[j * nx + i],
        g = (i, j) => heights[j * nx + i];
    // A strip along the boundary between samples a and b (their ground carried out), when either is under the surface.
    const strip = (a, b, x0, y0, x1, y1, along) => {
        const l = top(top(-Infinity, at(...a)), at(...b));
        if (l === -Infinity) return;
        const [ga, gb] = [g(...a), g(...b)];
        // (west and east strips run along y, south and north along x)
        if (along === 'y') quad(x0, y0, x1, y1, l, ga, ga, gb, gb);
        else quad(x0, y0, x1, y1, l, ga, gb, gb, ga);
    };
    for (let k = 0; k < ny - 1; k++) {
        const t0 = k * SPACING,
            t1 = t0 + SPACING;
        strip([0, k], [0, k + 1], -OUT, t0, 0, t1, 'y');
        strip([nx - 1, k], [nx - 1, k + 1], sx, t0, sx + OUT, t1, 'y');
    }
    for (let k = 0; k < nx - 1; k++) {
        const t0 = k * SPACING,
            t1 = t0 + SPACING;
        strip([k, 0], [k + 1, 0], t0, -OUT, t1, 0, 'x');
        strip([k, ny - 1], [k + 1, ny - 1], t0, size, t1, size + OUT, 'x');
    }
    for (const [i, j, x0, y0, x1, y1] of [
        [0, 0, -OUT, -OUT, 0, 0],
        [0, ny - 1, -OUT, size, 0, size + OUT],
        [nx - 1, 0, sx, -OUT, sx + OUT, 0],
        [nx - 1, ny - 1, sx, size, sx + OUT, size + OUT],
    ]) {
        const l = at(i, j);
        if (!Number.isNaN(l)) quad(x0, y0, x1, y1, l, g(i, j), g(i, j), g(i, j), g(i, j));
    }
    return { pos, depth };
}
