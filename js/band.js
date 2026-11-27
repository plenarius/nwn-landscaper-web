// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The band round an area (docs/DESIGN-canvas-cut.md, "A single area gets the same edge scenery"): 50 m of ground beyond each
// side, sculpted and painted like the area but never walked or built into tiles. The engine draws it past the area's edge in
// the game (its halo), as a canvas piece draws its neighbours. Its grid is the area's with BAND samples more on each side, the
// area's own samples in its middle (kept a copy of the area's: the area's grids are the ones edited and undone there).

import { SPACING, WET_DEPTH, toBase64, fromBase64 } from './area.js';

/** Samples beyond each side: 5 tiles, 50 m, as far as the game's scene reaches past an area. */
export const BAND = 80;

export class Band {
    /** The band round `area`, `n` samples a side; its grids given, or empty. */
    constructor(area, n = BAND, heights = null, materials = null) {
        this.n = n;
        this.nx = area.nx + 2 * n;
        this.ny = area.ny + 2 * n;
        this.heights = heights ?? new Float32Array(this.nx * this.ny);
        this.materials = materials ?? new Uint8Array(this.nx * this.ny);
        this.waterLevel = new Float32Array(this.nx * this.ny).fill(NaN);
    }

    /** The first fill: each sample takes the height and paint of the area's sample nearest it, so the area's ground carries
     *  straight out (as the edge scenery showed it before bands) until someone shapes it. */
    static fill(area) {
        const b = new Band(area),
            { n, nx, ny } = b;
        for (let j = 0; j < ny; j++) {
            const aj = Math.min(Math.max(j - n, 0), area.ny - 1);
            for (let i = 0; i < nx; i++) {
                const ai = Math.min(Math.max(i - n, 0), area.nx - 1),
                    k = aj * area.nx + ai;
                b.heights[j * nx + i] = area.heights[k];
                b.materials[j * nx + i] = area.materials[k];
            }
        }
        return b;
    }

    /** Metres from the band's first sample to the area's: brushes stamp the band at an area point plus this. */
    get offset() {
        return this.n * SPACING;
    }

    /** Whether band sample (i, j) is the area's (in the middle). */
    inArea(i, j, area) {
        return i >= this.n && j >= this.n && i < this.n + area.nx && j < this.n + area.ny;
    }

    /** Copies the area's grids into the middle, so the band's edge meets the area and a brush across it reads both. */
    sync(area) {
        const { n, nx } = this;
        for (let j = 0; j < area.ny; j++) {
            const to = (j + n) * nx + n;
            this.heights.set(area.heights.subarray(j * area.nx, (j + 1) * area.nx), to);
            this.materials.set(area.materials.subarray(j * area.nx, (j + 1) * area.nx), to);
        }
    }

    /** The ground's height at area point (x, y), bilinear (clamped to the band). */
    heightAt(x, y) {
        const { nx, ny, heights: h } = this;
        const fx = Math.min(Math.max(x / SPACING + this.n, 0), nx - 1),
            fy = Math.min(Math.max(y / SPACING + this.n, 0), ny - 1);
        const i = Math.min(Math.floor(fx), nx - 2),
            j = Math.min(Math.floor(fy), ny - 2),
            tx = fx - i,
            ty = fy - j;
        const a = h[j * nx + i] + (h[j * nx + i + 1] - h[j * nx + i]) * tx;
        const b = h[(j + 1) * nx + i] + (h[(j + 1) * nx + i + 1] - h[(j + 1) * nx + i]) * tx;
        return a + (b - a) * ty;
    }

    /** Each sample's water level (NaN: dry): the area's bodies flooded over the band as the engine floods them over its halo (a
     *  lake at the edge runs on into the band as far as its ground is lower). */
    floodWater(area) {
        const { n, nx, ny, heights: h } = this,
            level = this.waterLevel.fill(NaN),
            wet = new Uint8Array(nx * ny);
        for (const body of area.water) {
            wet.fill(0);
            const [i0, j0, i1, j1] = body.bounds ? body.bounds.map(v => v + n) : [0, 0, nx - 1, ny - 1];
            const stack = [(body.j + n) * nx + body.i + n];
            while (stack.length) {
                const k = stack.pop(),
                    x = k % nx,
                    y = (k / nx) | 0;
                const ai = x - n,
                    aj = y - n;
                const chasm = ai >= 0 && aj >= 0 && ai < area.nx && aj < area.ny && area.chasm?.[aj * area.nx + ai];
                if (wet[k] || h[k] >= body.level || x < i0 || x > i1 || y < j0 || y > j1 || chasm) continue;
                wet[k] = 1;
                if (!(level[k] >= body.level)) level[k] = body.level;
                if (x > 0) stack.push(k - 1);
                if (x + 1 < nx) stack.push(k + 1);
                if (y > 0) stack.push(k - nx);
                if (y + 1 < ny) stack.push(k + nx);
            }
        }
        for (let k = 0; k < level.length; k++) if (level[k] - h[k] < WET_DEPTH) level[k] = NaN;
    }

    toJSON() {
        return { n: this.n, heights: toBase64(new Uint8Array(this.heights.buffer.slice(0))), materials: toBase64(this.materials) };
    }

    /** The band saved as `o` round `area`; null when it doesn't fit the area (another size). */
    static fromJSON(o, area) {
        if (!o || !Number.isInteger(o.n) || o.n <= 0 || typeof o.heights !== 'string') return null;
        const b = new Band(area, o.n);
        const heights = new Float32Array(fromBase64(o.heights).buffer);
        const materials = typeof o.materials === 'string' ? fromBase64(o.materials) : null;
        if (heights.length !== b.nx * b.ny || (materials && materials.length !== b.nx * b.ny)) return null;
        b.heights = heights;
        if (materials) b.materials = materials;
        return b;
    }
}
