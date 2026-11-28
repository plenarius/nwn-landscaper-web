// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Soft paint, drawn as the export bakes it (landscaper's src/generator/soft.rs, which this follows step by step): each texture's
// samples smoothed into a weight field, so a painted edge follows a smooth line instead of the 0.625 m grid's staircase. Where
// textures meet the heaviest wins, eased over a few centimetres: a crisp edge for laid surfaces, a broken one (moved by noise
// and by the textures' own light and dark: gravel poking into snow) for natural ground, or a plain blend for a `soft` one, as
// the texture catalog's `edge` says. A sample a soft brush gave weights (blend.js) keeps them instead of being smoothed.
//
// The view keeps, for each sample of the paint grid, its two heaviest textures and the second's share (SoftGrid, worked out
// again over each change's rectangle and the smoothing's reach); its shader (SOFT_GLSL) reads the four samples round a point
// and draws them. softColour is the same rule on the CPU, for the tests against the bake.

import { SPACING } from './area.js';

/** The bake's soft paint parameters (soft.rs's constants), all in one place: the smoothing's sigma (m), each edge's easing
 *  (tau, in weight), the noise's amount and feature size (m), the brightness rule's amount and the difference in brightness
 *  at which it counts in full, and the weight a texture must pass to show at a point. `pixelTau` is the view's alone: an
 *  edge's least easing for each metre a pixel covers. */
export const SOFT = {
    sigma: 0.6,
    tauCrisp: 0.03,
    tauBroken: 0.04,
    noise: 0.16,
    noiseScale: 1.5,
    lum: 0.6,
    contrast: 0.25,
    minWeight: 0.02,
    pixelTau: 0.65,
};

/** Words in a category's name that make its textures' edge crisp when the catalog doesn't say (soft.rs's paint::edge_for). */
const BUILT = ['floor', 'wall', 'cobble', 'flag', 'paving', 'plank', 'wood', 'brick', 'tile', 'slab', 'carpet', 'rug', 'metal'];

/** A library texture's edge (`t` its catalog entry): its `edge`, else what its category suggests. */
export function edgeOf(t) {
    if (t?.edge === 'crisp' || t?.edge === 'broken' || t?.edge === 'soft') return t.edge;
    const c = String(t?.category ?? '').toLowerCase();
    return BUILT.some(w => c.includes(w)) ? 'crisp' : 'broken';
}

/** A texture's noise seed: FNV-1a (32 bit) of its id's bytes (UTF-8). */
export function seed(id) {
    let h = 0x811c9dc5;
    for (const b of new TextEncoder().encode(id)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
    return h >>> 0;
}

/** The smoothing kernel at sample spacing `spacing` (one side's weights from -reach to reach, summing to 1), and its reach. */
export function kernel(spacing, sigma = SOFT.sigma) {
    const s = sigma / spacing,
        reach = Math.ceil(3 * s) + 1,
        k = [];
    for (let d = -reach; d <= reach; d++) k.push(Math.fround(Math.exp(-(d * d) / (2 * s * s))));
    const total = Math.fround(k.reduce((a, b) => Math.fround(a + b), 0));
    return { weights: Float32Array.from(k, v => v / total), reach };
}

/**
 * Smooths paint `src` (palette indices, `nx` by `ny`, rows from the south) over samples i0..i1, j0..j1 into `out` (RGBA a
 * sample): the heaviest texture, the next, and the next's share of the two times 255 (0, and the second the first, when it has
 * none); ties go to the lower palette index. Beyond the grid the edge's samples carry on, as the bake's fields clamp to its halo.
 * A sample with a weight in `blend` (blend.js; null: none) takes its own two textures instead, as the bake does.
 */
export function soften(src, nx, ny, i0, i1, j0, j1, out, k, blend = null) {
    const { weights: kw, reach } = k;
    const acc = new Float32Array(256),
        seen = new Uint8Array(256),
        used = [];
    const at = (i, j) => src[Math.min(Math.max(j, 0), ny - 1) * nx + Math.min(Math.max(i, 0), nx - 1)];
    // (most samples see one texture all round: `run[k]` is how far the run of sample k's texture reaches either way along its
    // row, capped at reach, so a sample whose rows all run `reach` both ways in its texture needs no sum)
    const w = i1 - i0 + 1 + 2 * reach,
        h = j1 - j0 + 1 + 2 * reach,
        run = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        const j = j0 - reach + y;
        let left = 0;
        for (let x = 0; x < w; x++) {
            left = x > 0 && at(i0 - reach + x - 1, j) === at(i0 - reach + x, j) ? Math.min(left + 1, reach) : 0;
            run[y * w + x] = left;
        }
        let right = 0;
        for (let x = w - 1; x >= 0; x--) {
            right = x < w - 1 && at(i0 - reach + x + 1, j) === at(i0 - reach + x, j) ? Math.min(right + 1, reach) : 0;
            run[y * w + x] = Math.min(run[y * w + x], right);
        }
    }
    for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
            const o = (j * nx + i) * 4,
                m0 = at(i, j),
                x = i - i0 + reach;
            let one = true;
            for (let dy = -reach; dy <= reach && one; dy++) one = run[(j - j0 + reach + dy) * w + x] >= reach && at(i, j + dy) === m0;
            if (one) {
                out[o] = out[o + 1] = m0;
                out[o + 2] = out[o + 3] = 0;
                continue;
            }
            used.length = 0;
            for (let dy = -reach; dy <= reach; dy++) {
                const wy = kw[dy + reach];
                for (let dx = -reach; dx <= reach; dx++) {
                    const m = at(i + dx, j + dy);
                    if (!seen[m]) {
                        seen[m] = 1;
                        acc[m] = 0;
                        used.push(m);
                    }
                    acc[m] += wy * kw[dx + reach];
                }
            }
            // (in palette order, the later only winning when heavier: ties go to the lower index, as the bake's)
            used.sort((p, q) => p - q);
            let a = -1,
                wa = -1,
                b = -1,
                wb = -1;
            for (const m of used) {
                seen[m] = 0;
                if (acc[m] > wa) {
                    [b, wb, a, wa] = [a, wa, m, acc[m]];
                } else if (acc[m] > wb) [b, wb] = [m, acc[m]];
            }
            const q = wb > 0 ? Math.round((255 * wb) / (wa + wb)) : 0;
            out[o] = a;
            out[o + 1] = q === 0 ? a : b;
            out[o + 2] = q;
            out[o + 3] = 0;
        }
    if (blend)
        for (let j = j0; j <= j1; j++)
            for (let i = i0; i <= i1; i++) {
                const s = j * nx + i,
                    v = blend[s];
                if (v < 256) continue;
                const o = s * 4,
                    m = src[s],
                    b = v & 255,
                    w = v >>> 8;
                // (the heavier first: the paint, unless the second weighs more than half)
                const swap = w > 128 && b !== m;
                out[o] = swap ? b : m;
                out[o + 1] = b === m ? m : swap ? m : b;
                out[o + 2] = b === m ? 0 : swap ? 255 - w : w;
                out[o + 3] = 0;
            }
}

/**
 * The soft paint of `area` as the view draws it: over its band's grid when it has one (so the area's edge is smoothed with the
 * band's paint beyond it, as the bake's halo does), else the area's. `origin`: samples from the grid's first to the area's.
 */
export class SoftGrid {
    constructor(area, spacing) {
        const b = area.band;
        this.area = area;
        this.band = b;
        this.origin = b ? b.n : 0;
        this.nx = b ? b.nx : area.nx;
        this.ny = b ? b.ny : area.ny;
        this.k = kernel(spacing);
        this.src = new Uint8Array(this.nx * this.ny);
        this.blend = new Uint16Array(this.nx * this.ny);
        this.out = new Uint8Array(this.nx * this.ny * 4);
        this.read(0, this.nx - 1, 0, this.ny - 1);
        soften(this.src, this.nx, this.ny, 0, this.nx - 1, 0, this.ny - 1, this.out, this.k, this.blend);
    }

    /** Whether this grid still fits `area` (the same area, band and size). */
    fits(area) {
        return area === this.area && area.band === this.band && this.nx === (area.band ? area.band.nx : area.nx);
    }

    /** Copies the paint into src over grid samples i0..i1, j0..j1; the rectangle where it changed, or null. */
    read(i0, i1, j0, j1) {
        const { area, band, origin: n, nx } = this;
        let c0 = Infinity,
            c1 = -1,
            r0 = Infinity,
            r1 = -1;
        for (let j = j0; j <= j1; j++)
            for (let i = i0; i <= i1; i++) {
                const ai = i - n,
                    aj = j - n,
                    own = ai >= 0 && aj >= 0 && ai < area.nx && aj < area.ny,
                    m = own ? area.materials[aj * area.nx + ai] : band.materials[j * nx + i],
                    v = own ? area.blend[aj * area.nx + ai] : band.blend[j * nx + i];
                const k = j * nx + i;
                if (this.src[k] === m && this.blend[k] === v) continue;
                this.src[k] = m;
                this.blend[k] = v;
                if (i < c0) c0 = i;
                if (i > c1) c1 = i;
                if (j < r0) r0 = j;
                if (j > r1) r1 = j;
            }
        return c1 < 0 ? null : { i0: c0, i1: c1, j0: r0, j1: r1 };
    }

    /** The area's samples `r` (i0..i1, j0..j1, area samples) changed, or with null anywhere in the band: smoothed again where it
     *  reaches. The grid samples whose soft paint changed, or null. */
    refresh(r) {
        const { nx, ny, origin: n } = this;
        const changed = r
            ? this.read(Math.max(0, r.i0 + n), Math.min(nx - 1, r.i1 + n), Math.max(0, r.j0 + n), Math.min(ny - 1, r.j1 + n))
            : this.read(0, nx - 1, 0, ny - 1);
        if (!changed) return null;
        const e = this.k.reach,
            s = {
                i0: Math.max(0, changed.i0 - e),
                i1: Math.min(nx - 1, changed.i1 + e),
                j0: Math.max(0, changed.j0 - e),
                j1: Math.min(ny - 1, changed.j1 + e),
            };
        soften(this.src, nx, ny, s.i0, s.i1, s.j0, s.j1, this.out, this.k, this.blend);
        return s;
    }
}

// The bake's noise (soft.rs's hash, value and fbm): two octaves of value noise, in about -1..1, in f32 as the bake has it.
const f32 = Math.fround;

function hash(x, y, s) {
    let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(s, 0xcb1ab31f)) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0x5bd1e995) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
    return f32(f32((h & 0xffff) / 65535) * 2 - 1);
}

function value(x, y, s) {
    const xi = Math.floor(x),
        yi = Math.floor(y);
    let tx = f32(x - xi),
        ty = f32(y - yi);
    tx = f32(tx * tx * f32(3 - 2 * tx));
    ty = f32(ty * ty * f32(3 - 2 * ty));
    const a = f32(hash(xi, yi, s) + f32(f32(hash(xi + 1, yi, s) - hash(xi, yi, s)) * tx));
    const b = f32(hash(xi, yi + 1, s) + f32(f32(hash(xi + 1, yi + 1, s) - hash(xi, yi + 1, s)) * tx));
    return f32(a + f32(f32(b - a) * ty));
}

/** The bake's noise at (x, y) for seed `s`. */
export function fbm(x, y, s) {
    x = f32(x);
    y = f32(y);
    return f32(f32(0.65 * value(x, y, s)) + f32(0.35 * value(f32(f32(x * f32(3.1)) + 17), f32(f32(y * f32(3.1)) - 5), (s + 101) >>> 0)));
}

const luminance = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

/** The textures showing at area point (x, y) of soft grid `g` (its `out`, `nx`, `ny`, `origin`), heaviest first: [index,
 *  weight] pairs weighing more than SOFT.minWeight. */
export function softMix(g, spacing, x, y) {
    const { out, nx, ny, origin } = g;
    const fx = Math.min(Math.max(x / spacing + origin, 0), nx - 1),
        fy = Math.min(Math.max(y / spacing + origin, 0), ny - 1);
    const bi = Math.min(Math.floor(fx), nx - 2),
        bj = Math.min(Math.floor(fy), ny - 2),
        tx = fx - bi,
        ty = fy - bj;
    const w = new Map();
    const add = (m, v) => v > 0 && w.set(m, (w.get(m) ?? 0) + v);
    for (const [i, j, b] of [
        [bi, bj, (1 - tx) * (1 - ty)],
        [bi + 1, bj, tx * (1 - ty)],
        [bi, bj + 1, (1 - tx) * ty],
        [bi + 1, bj + 1, tx * ty],
    ]) {
        const o = (j * nx + i) * 4,
            share = out[o + 2] / 255;
        add(out[o], b * (1 - share));
        add(out[o + 1], b * share);
    }
    return [...w].filter(([, v]) => v > SOFT.minWeight).sort((p, q) => q[1] - p[1] || p[0] - q[0]);
}

/**
 * The ground's colour (display values, 0..1) at area point (x, y) from soft grid `g`, as the bake and the view's shader draw it:
 * `colour(m)` texture m's colour there, `looks[m]` its { edge, seed, mean } (mean: its picture's mean luminance).
 */
export function softColour(g, spacing, x, y, colour, looks) {
    const mix = softMix(g, spacing, x, y);
    if (!mix.length) return [0, 0, 0];
    if (mix.length === 1) return colour(mix[0][0]);
    // (the softer style wins: soft, then broken, then crisp)
    if (mix.some(([m]) => looks[m].edge === 'soft')) {
        const total = mix.reduce((t, [, w]) => t + w, 0),
            out = [0, 0, 0];
        for (const [m, w] of mix) {
            const c = colour(m);
            for (let k = 0; k < 3; k++) out[k] += (c[k] * w) / total;
        }
        return out;
    }
    const broken = mix.some(([m]) => looks[m].edge === 'broken'),
        tau = broken ? SOFT.tauBroken : SOFT.tauCrisp,
        [first, second] = [mix[0][0], mix[1][0]];
    const read = mix.map(([m, w]) => {
        const c = colour(m);
        if (!broken) return [c, w];
        const partner = m === first ? second : first,
            toward = Math.min(Math.max((looks[partner].mean - looks[m].mean) / SOFT.contrast, -1), 1);
        return [
            c,
            w +
                SOFT.noise * fbm(x / SOFT.noiseScale, y / SOFT.noiseScale, looks[m].seed) +
                SOFT.lum * (luminance(c) - looks[m].mean) * toward,
        ];
    });
    const best = Math.max(...read.map(r => r[1]));
    let total = 0;
    const out = [0, 0, 0];
    for (const [c, s] of read) {
        const e = Math.exp((s - best) / tau);
        total += e;
        for (let k = 0; k < 3; k++) out[k] += c[k] * e;
    }
    return out.map(v => v / total);
}

/**
 * GLSL for the view's fragment shader: `SOFT_SPLAT(area, px, out)` sets vec4 `out` to the ground's colour at area point `area`
 * (vec2) from the soft grid (uSoft, uSoftN samples, uSoftOrigin to the area's first), each texture drawn by the macro
 * `SPLAT(layer)` (linear colour) and described by uLayers (a texel a palette index: r 1 for a broken edge and 2 for a soft one, g its mean
 * luminance, b and a its noise seed's low and high 16 bits). softColour's rule, worked in display values as the bake works,
 * except that an edge eases over at least about a pixel (`px`, metres a pixel there): far off, where the game's mipmaps blur
 * the bake's edge, a sharper one would crawl as the camera moves.
 */
export const SOFT_GLSL = `
uint softU(int v) { return v < 0 ? ~uint(-v) + 1u : uint(v); }
float softHash(int x, int y, uint s) {
    uint h = softU(x) * 0x8da6b343u ^ softU(y) * 0xd8163841u ^ s * 0xcb1ab31fu;
    h ^= h >> 13u;
    h *= 0x5bd1e995u;
    h ^= h >> 15u;
    return float(h & 0xffffu) / 65535.0 * 2.0 - 1.0;
}
float softValue(vec2 p, uint s) {
    vec2 i = floor(p), t = p - i;
    t = t * t * (3.0 - 2.0 * t);
    int x = int(i.x), y = int(i.y);
    float a = softHash(x, y, s) + (softHash(x + 1, y, s) - softHash(x, y, s)) * t.x;
    float b = softHash(x, y + 1, s) + (softHash(x + 1, y + 1, s) - softHash(x, y + 1, s)) * t.x;
    return a + (b - a) * t.y;
}
float softFbm(vec2 p, uint s) { return 0.65 * softValue(p, s) + 0.35 * softValue(p * 3.1 + vec2(17.0, -5.0), s + 101u); }
vec3 softDisplay(vec3 c) {
    return mix(pow(max(c, vec3(0.0)), vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}
vec3 softLinear(vec3 c) {
    return mix(pow(c * 0.9478672986 + vec3(0.0521327014), vec3(2.4)), c * 0.0773993808, vec3(lessThanEqual(c, vec3(0.04045))));
}
vec4 softLayer(float m) { return texelFetch(uLayers, ivec2(int(m), 0), 0); }
#define SOFT_SPLAT(area, px, result) { \\
    vec2 sf = clamp(area / ${SPACING.toFixed(4)} + uSoftOrigin, vec2(0.0), uSoftN - 1.0); \\
    vec2 sb = min(floor(sf), uSoftN - 2.0); \\
    vec2 st = sf - sb; \\
    ivec2 si = ivec2(sb); \\
    float em[8], ew[8]; \\
    int en = 0; \\
    for (int k = 0; k < 4; k++) { \\
        ivec2 o = ivec2(k % 2, k / 2); \\
        vec4 c = texelFetch(uSoft, si + o, 0); \\
        float b = (o.x == 1 ? st.x : 1.0 - st.x) * (o.y == 1 ? st.y : 1.0 - st.y); \\
        float share = floor(c.b * 255.0 + 0.5) / 255.0; \\
        for (int h = 0; h < 2; h++) { \\
            float m = floor((h == 0 ? c.r : c.g) * 255.0 + 0.5), v = b * (h == 0 ? 1.0 - share : share); \\
            if (v <= 0.0) continue; \\
            int f = -1; \\
            for (int e = 0; e < 8; e++) if (e < en && em[e] == m) f = e; \\
            if (f >= 0) ew[f] += v; \\
            else { em[en] = m; ew[en] = v; en++; } \\
        } \\
    } \\
    int i1 = -1, i2 = -1; \\
    bool broken = false, soft = false; \\
    for (int e = 0; e < 8; e++) { \\
        if (e >= en || ew[e] <= ${SOFT.minWeight.toFixed(3)}) continue; \\
        float style = softLayer(em[e]).r; \\
        if (style > 1.5) soft = true; \\
        else if (style > 0.5) broken = true; \\
        if (i1 < 0 || ew[e] > ew[i1] || (ew[e] == ew[i1] && em[e] < em[i1])) { i2 = i1; i1 = e; } \\
        else if (i2 < 0 || ew[e] > ew[i2] || (ew[e] == ew[i2] && em[e] < em[i2])) i2 = e; \\
    } \\
    if (i1 < 0) result = vec4(0.0, 0.0, 0.0, 1.0); \\
    else if (i2 < 0) result = SPLAT(em[i1]); \\
    else if (soft) { \\
        vec3 sum = vec3(0.0); \\
        float total = 0.0; \\
        for (int e = 0; e < 8; e++) { \\
            if (e >= en || ew[e] <= ${SOFT.minWeight.toFixed(3)}) continue; \\
            sum += softDisplay(SPLAT(em[e]).rgb) * ew[e]; \\
            total += ew[e]; \\
        } \\
        result = vec4(softLinear(sum / total), 1.0); \\
    } \\
    else { \\
        vec3 sc[8]; \\
        float ss[8], best = -1e9; \\
        for (int e = 0; e < 8; e++) { \\
            if (e >= en || ew[e] <= ${SOFT.minWeight.toFixed(3)}) continue; \\
            vec3 c = softDisplay(SPLAT(em[e]).rgb); \\
            float s = ew[e]; \\
            if (broken) { \\
                vec4 l = softLayer(em[e]), p = softLayer(e == i1 ? em[i2] : em[i1]); \\
                s += ${SOFT.noise.toFixed(3)} * softFbm(area / ${SOFT.noiseScale.toFixed(3)}, uint(l.b) | (uint(l.a) << 16u)) \\
                   + ${SOFT.lum.toFixed(3)} * (dot(c, vec3(0.3, 0.59, 0.11)) - l.g) * clamp((p.g - l.g) / ${SOFT.contrast.toFixed(3)}, -1.0, 1.0); \\
            } \\
            sc[e] = c; \\
            ss[e] = s; \\
            best = max(best, s); \\
        } \\
        float tau = max(broken ? ${SOFT.tauBroken.toFixed(3)} : ${SOFT.tauCrisp.toFixed(3)}, ${SOFT.pixelTau.toFixed(3)} * px); \\
        vec3 sum = vec3(0.0); \\
        float total = 0.0; \\
        for (int e = 0; e < 8; e++) { \\
            if (e >= en || ew[e] <= ${SOFT.minWeight.toFixed(3)}) continue; \\
            float x = exp((ss[e] - best) / tau); \\
            sum += sc[e] * x; \\
            total += x; \\
        } \\
        result = vec4(softLinear(sum / total), 1.0); \\
    } \\
}
`;
