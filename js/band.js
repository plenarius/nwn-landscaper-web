// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The band round an area (docs/DESIGN-canvas-cut.md, "A single area gets the same edge scenery"): 50 m of ground beyond each
// side, sculpted and painted like the area but never walked or built into tiles. The engine draws it past the area's edge in
// the game (its halo), as a canvas piece draws its neighbours. Its grid is the area's with BAND samples more on each side, the
// area's own samples in its middle (kept a copy of the area's: the area's grids are the ones edited and undone there).

import { SPACING, MAX_RISE, dryShallows, toBase64, fromBase64 } from './area.js';

/** Samples beyond each side: 5 tiles, 50 m, as far as the game's scene reaches past an area. */
export const BAND = 80;
/** Passes of Band.ease's softening across its rings. */
const SOFTEN = 24;
/** How far along the edge the band's heights are averaged (Band.ease), per sample out: 50 m out, 25 m either way. */
export const EASE = 0.5;

export class Band {
    /** The band round `area`, `n` samples a side; its grids given, or empty. */
    constructor(area, n = BAND, heights = null, materials = null) {
        this.n = n;
        this.nx = area.nx + 2 * n;
        this.ny = area.ny + 2 * n;
        this.heights = heights ?? new Float32Array(this.nx * this.ny);
        this.materials = materials ?? new Uint8Array(this.nx * this.ny);
        this.waterLevel = new Float32Array(this.nx * this.ny).fill(NaN);
        // The water's surface, the shallows included (the area's surfaceLevel).
        this.surfaceLevel = new Float32Array(this.nx * this.ny).fill(NaN);
    }

    /** The first fill: the area's edge carried out (extruded), its heights then eased (ease), so the strip by the edge
     *  matches it and the bumps along it spread into slopes instead of running out as 50 m ridges and steps. */
    static fill(area) {
        return Band.extruded(area).ease(area);
    }

    /** Eases the band's heights along the edge: each ring of samples round the area (those as far out as each other) averaged
     *  along itself over more of it the further out (EASE), so steps between neighbouring rows, which grow wherever each row
     *  ran out on its own, become slopes; how the ground rises or falls away from the edge is kept. Returns the band. */
    ease(area) {
        const { n, nx } = this,
            ax = area.nx,
            ay = area.ny,
            h = this.heights;
        // Water running out past the edge keeps its bed: a river's channel is as narrow along the edge as a step, and easing
        // it away would end the river at the edge.
        this.sync(area);
        this.floodWater(area);
        const bed = h.slice(),
            wet = this.surfaceLevel.map(v => (Number.isNaN(v) ? 0 : 1));
        for (let t = 1; t <= n; t++) {
            // Ring t: from its south-west corner east, north, west and south again.
            const i0 = n - t,
                j0 = n - t,
                i1 = n + ax - 1 + t,
                j1 = n + ay - 1 + t;
            const ring = [];
            for (let i = i0; i < i1; i++) ring.push(j0 * nx + i);
            for (let j = j0; j < j1; j++) ring.push(j * nx + i1);
            for (let i = i1; i > i0; i--) ring.push(j1 * nx + i);
            for (let j = j1; j > j0; j--) ring.push(j * nx + i0);
            const len = ring.length,
                r = Math.min(Math.floor((len - 1) / 2), Math.floor(EASE * (t - 0.5)));
            if (r <= 0) continue;
            const was = ring.map(k => h[k]);
            // A tent of weights: smooth, and the same at either end of the loop.
            const weight = (r + 1) * (r + 1);
            for (let s = 0; s < len; s++) {
                let sum = 0;
                for (let k = -r; k <= r; k++) sum += (r + 1 - Math.abs(k)) * was[(((s + k) % len) + len) % len];
                h[ring[s]] = sum / weight;
            }
        }
        // Then across the rings: terraces parallel to the edge soften the same way, more the further out; a steady rise or fall
        // stays, as each sample moves towards its neighbours' average and on a plane that is itself.
        const ny = this.ny,
            ring = (i, j) => Math.max(n - i, i - (n + ax - 1), n - j, j - (n + ay - 1));
        for (let pass = 0; pass < SOFTEN; pass++) {
            const was = h.slice();
            for (let j = 0; j < ny; j++)
                for (let i = 0; i < nx; i++) {
                    const t = ring(i, j);
                    if (t <= 0) continue;
                    let sum = 0;
                    for (let dj = -1; dj <= 1; dj++)
                        for (let di = -1; di <= 1; di++)
                            if (di || dj) sum += was[Math.min(Math.max(j + dj, 0), ny - 1) * nx + Math.min(Math.max(i + di, 0), nx - 1)];
                    const k = j * nx + i;
                    h[k] = was[k] + Math.min(1, Math.max(0, t - 2) / 10) * 0.8 * (sum / 8 - was[k]);
                }
        }
        for (let k = 0; k < h.length; k++) if (wet[k]) h[k] = Math.min(h[k], bed[k]);
        this.floodWater(area);
        return this;
    }

    /** The band as the first fill made it before it was eased: each sample the height and paint of the area's sample nearest it.
     *  A band saved like this was never touched, so it is filled again (Area.fromJSON). */
    static extruded(area) {
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

    /** Whether this band is the same as `other` round `area` (their samples past its edge). */
    same(other, area) {
        if (other.nx !== this.nx || other.ny !== this.ny) return false;
        for (let j = 0, k = 0; j < this.ny; j++)
            for (let i = 0; i < this.nx; i++, k++)
                if (!this.inArea(i, j, area) && (this.heights[k] !== other.heights[k] || this.materials[k] !== other.materials[k]))
                    return false;
        return true;
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

    /** Band sample (i, j)'s height (clamped to the band), the area's own in the middle: a point by the edge reads the area as it
     *  is now, synced or not. */
    sample(area, i, j) {
        i = Math.min(Math.max(i, 0), this.nx - 1);
        j = Math.min(Math.max(j, 0), this.ny - 1);
        const ai = i - this.n,
            aj = j - this.n;
        return this.inArea(i, j, area) ? area.heights[aj * area.nx + ai] : this.heights[j * this.nx + i];
    }

    /** The ground's height at area point (x, y), bilinear over the band and the area's edge. */
    groundAt(area, x, y) {
        const fx = Math.min(Math.max(x / SPACING + this.n, 0), this.nx - 1),
            fy = Math.min(Math.max(y / SPACING + this.n, 0), this.ny - 1);
        const i = Math.min(Math.floor(fx), this.nx - 2),
            j = Math.min(Math.floor(fy), this.ny - 2),
            tx = fx - i,
            ty = fy - j;
        const h = (di, dj) => this.sample(area, i + di, j + dj);
        const a = h(0, 0) + (h(1, 0) - h(0, 0)) * tx;
        const b = h(0, 1) + (h(1, 1) - h(0, 1)) * tx;
        return a + (b - a) * ty;
    }

    /** Whether the band's ground nearest area point (x, y) is dry and no steeper than walkable ground (the area's rule), as
     *  Scatter wants it: it is never walked, but a tree on a cliff or in a lake looks as wrong there. */
    firm(area, x, y) {
        const i = Math.min(Math.max(Math.round(x / SPACING) + this.n, 0), this.nx - 1),
            j = Math.min(Math.max(Math.round(y / SPACING) + this.n, 0), this.ny - 1);
        if (!this.inArea(i, j, area) && !Number.isNaN(this.waterLevel[j * this.nx + i])) return false;
        const z = this.sample(area, i, j);
        for (const [di, dj] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
        ])
            if (Math.abs(this.sample(area, i + di, j + dj) - z) > MAX_RISE) return false;
        return true;
    }

    /** Each sample's water surface and level (NaN: dry): the area's bodies flooded over the band as the engine floods them over
     *  its halo (a lake at the edge runs on into the band as far as its ground is lower). */
    floodWater(area) {
        const { n, nx, ny, heights: h } = this,
            level = this.surfaceLevel.fill(NaN),
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
        dryShallows(level, h, this.waterLevel);
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
