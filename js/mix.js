// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Paint tool's mix: several textures painted as a blend, the way Scatter mixes models. The ground is cut into patches about
// the patch size across (cells of a jittered grid, the nearest cell's point winning, the cells' edges bent by two layers of noise
// so they are not straight lines), and each patch takes one texture of the mix, picked by a hash of the patch and the mix's seed
// in proportion to the weights. A patch is the same wherever the brush passes, so strokes over the same ground paint it the same
// way: nothing reshuffles until the seed changes (Reshuffle). The brush's strength is how much of the ground the mix covers: each
// patch has a second hash, and it is painted when that is under the strength (tapered to the brush's rim with a soft edge); the
// rest keeps its texture. With a soft edge, the patches towards the rim fade in by weight (blend.js) rather than breaking up
// into specks: each patch is painted where it is covered, at the edge's reach. The panel (mixpanel.js) keeps the mix in this browser under MIX_KEY.

import { SPACING } from './area.js';
import { StrokePaint } from './blend.js';

/** The storage key of the mix (JSON: whether it is on, its textures and weights, the patch size, the soft edge and the seed). */
export const MIX_KEY = 'landscaper.paintMix';

/** A texture's weight: from WEIGHT_MIN to WEIGHT_MAX, WEIGHT_DEFAULT when it joins (so the mix starts equal). */
export const WEIGHT_MIN = 1;
export const WEIGHT_MAX = 10;
export const WEIGHT_DEFAULT = 5;
/** The patch size, metres: from PATCH_MIN (about two samples, already close to noise) to PATCH_MAX (two tiles). */
export const PATCH_MIN = 1;
export const PATCH_MAX = 20;
export const PATCH_DEFAULT = 4;
/** The most textures in a mix: past 8 the patches are too few of each to read as a mix. */
export const MIX_MAX = 8;

/** A mix as the panel holds it: off, no textures, the default patch, a soft edge, seed 1. */
export function newMix() {
    return { on: false, textures: [], patch: PATCH_DEFAULT, soft: true, seed: 1 };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const weightOf = w => clamp(Math.round(Number.isFinite(+w) ? +w : WEIGHT_DEFAULT), WEIGHT_MIN, WEIGHT_MAX);

/** Whether texture `id` is in `mix`. */
export const inMix = (mix, id) => mix.textures.some(t => t.id === id);

/** `mix` with texture `id` added at the default weight (a new mix; the same one when it is there already or the mix is full). */
export function withTexture(mix, id) {
    if (inMix(mix, id) || mix.textures.length >= MIX_MAX) return mix;
    return { ...mix, textures: [...mix.textures, { id, weight: WEIGHT_DEFAULT }] };
}

/** `mix` without texture `id` (a new mix). */
export function withoutTexture(mix, id) {
    return { ...mix, textures: mix.textures.filter(t => t.id !== id) };
}

/** `mix` with texture `id` taken out when it is in, else added: a click on its swatch. */
export function toggledTexture(mix, id) {
    return inMix(mix, id) ? withoutTexture(mix, id) : withTexture(mix, id);
}

/** `mix` with texture `id` weighing `weight` (rounded and kept in WEIGHT_MIN..WEIGHT_MAX). */
export function withWeight(mix, id, weight) {
    return { ...mix, textures: mix.textures.map(t => (t.id === id ? { ...t, weight: weightOf(weight) } : t)) };
}

/** `mix` as Shift (on a swatch, or with the eyedropper) leaves it: on, with texture `id` in. A mix that was off and empty starts
 *  with `current`, the texture painted with until then, so Shift-clicking a second texture mixes the two. */
export function shiftAdded(mix, id, current) {
    let next = mix;
    if (!mix.on && !mix.textures.length && current && current !== id) next = withTexture(next, current);
    return { ...withTexture(next, id), on: true };
}

/** Each texture's share of the mix (0..1), in its order: its weight over the sum. */
export function shares(mix) {
    const total = mix.textures.reduce((s, t) => s + t.weight, 0);
    return mix.textures.map(t => (total ? t.weight / total : 0));
}

/** The mix kept in `stored` (the text under MIX_KEY), its textures limited to those `has(id)` says the library has: a new mix
 *  when it is missing or broken, as when the browser's storage is blocked. */
export function readMix(stored, has = () => true) {
    const mix = newMix();
    let o;
    try {
        o = JSON.parse(stored ?? 'null');
    } catch {
        return mix;
    }
    if (!o || typeof o !== 'object') return mix;
    mix.on = o.on === true;
    mix.soft = o.soft !== false;
    if (Number.isFinite(+o.patch)) mix.patch = clamp(+o.patch, PATCH_MIN, PATCH_MAX);
    if (Number.isInteger(o.seed)) mix.seed = o.seed;
    for (const t of Array.isArray(o.textures) ? o.textures : []) {
        if (typeof t?.id !== 'string' || !has(t.id) || inMix(mix, t.id) || mix.textures.length >= MIX_MAX) continue;
        mix.textures.push({ id: t.id, weight: weightOf(t.weight) });
    }
    return mix;
}

/** The text to keep under MIX_KEY for `mix`. */
export function writeMix(mix) {
    const { on, textures, patch, soft, seed } = mix;
    return JSON.stringify({ on, textures, patch, soft, seed });
}

/** `mix` limited to the textures `has(id)` says the library has (the same mix when none left). */
export function keptTextures(mix, has) {
    const textures = mix.textures.filter(t => has(t.id));
    return textures.length === mix.textures.length ? mix : { ...mix, textures };
}

/** A hash of integers `a`, `b`, `c` and `d`, in [0, 1): murmur3's finaliser after each, so neighbouring cells don't correlate. */
function hash(a, b, c, d) {
    let h = 0x9e3779b9;
    for (const v of [a, b, c, d]) {
        h = Math.imul(h ^ (v | 0), 0xcc9e2d51);
        h ^= h >>> 15;
        h = Math.imul(h, 0x85ebca6b);
        h ^= h >>> 13;
        h = Math.imul(h, 0xc2b2ae35);
        h ^= h >>> 16;
    }
    return (h >>> 0) / 4294967296;
}

/** Smooth value noise at (x, y) (lattice units), in [-1, 1]: a hash at each lattice point, blended with smoothstep. */
function noise(x, y, seed, salt) {
    const i = Math.floor(x),
        j = Math.floor(y);
    const u = x - i,
        v = y - j;
    const su = u * u * (3 - 2 * u),
        sv = v * v * (3 - 2 * v);
    const a = hash(i, j, seed, salt),
        b = hash(i + 1, j, seed, salt),
        c = hash(i, j + 1, seed, salt),
        d = hash(i + 1, j + 1, seed, salt);
    return (a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv) * 2 - 1;
}

/** The patch that area point (x, y) lies in: `{ ci, cj }`, the cell of the jittered grid (`patch` metres a cell) whose point is
 *  nearest once (x, y) is pushed about by two layers of noise (a third and an eighth of a patch), so patches have ragged,
 *  rounded edges rather than a Voronoi diagram's straight ones. */
export function patchAt(x, y, patch, seed) {
    const big = patch * 0.75,
        small = patch * 0.22;
    const wx = x + patch * 0.33 * noise(x / big, y / big, seed, 11) + patch * 0.12 * noise(x / small, y / small, seed, 13);
    const wy = y + patch * 0.33 * noise(x / big, y / big, seed, 12) + patch * 0.12 * noise(x / small, y / small, seed, 14);
    const gx = wx / patch,
        gy = wy / patch;
    const fi = Math.floor(gx),
        fj = Math.floor(gy);
    let best = Infinity,
        ci = fi,
        cj = fj;
    for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
            const i = fi + di,
                j = fj + dj;
            const px = i + hash(i, j, seed, 1),
                py = j + hash(i, j, seed, 2);
            const d = (px - gx) ** 2 + (py - gy) ** 2;
            if (d < best) {
                best = d;
                ci = i;
                cj = j;
            }
        }
    }
    return { ci, cj };
}

/**
 * What a stroke paints with `mix`: its textures' palette indices (`indices`, in the mix's order, from the area's materialIndex),
 * and the weights, patch size, soft edge and seed of the mix. Made once when the stroke begins; mixStamp reads it.
 */
export function mixPlan(mix, indices) {
    const cumulative = [];
    let sum = 0;
    for (const s of shares(mix)) {
        sum += s;
        cumulative.push(sum);
    }
    return { indices, cumulative, patch: mix.patch, soft: mix.soft, seed: mix.seed };
}

/** Which of the plan's textures (an index into `plan.indices`) patch (ci, cj) takes, and its cover hash (0..1). */
export function patchChoice(plan, ci, cj) {
    const u = hash(ci, cj, plan.seed, 3);
    let k = plan.cumulative.findIndex(c => u < c);
    if (k < 0) k = plan.indices.length - 1;
    return { k, cover: hash(ci, cj, plan.seed, 4) };
}

/** How much of the brush reaches `d` metres from its middle, `radius` its size: all of it, or with a soft edge all of it to
 *  60% of the way out, then less to none at the rim (smoothstep): the patches' weight there. (Out to half way, passes a little
 *  over half a brush apart left about one patch in 25 unpainted between them.) */
function reach(d, radius, soft) {
    if (d > radius) return 0;
    if (!soft) return 1;
    const t = clamp((radius - d) / (radius * 0.4), 0, 1);
    return t * t * (3 - 2 * t);
}

/**
 * Paints `plan` (mixPlan) over the brush at area point (x, y), `radius` metres: each sample takes its patch's texture, where the
 * patch's cover hash is under `strength` (0..1), weighing the edge's reach (blend.js); the others keep theirs. The same ground
 * always comes out the same, so a second pass changes nothing. Returns the changed sample rectangle, as tools.js's stamp.
 * `origin`: metres from the grid's first sample to the area's (the band's offset), so the band's patches are the area's and run
 * on across the edge. `painter`: the stroke's StrokePaint over `area`, so a rim passed over again doesn't build up.
 */
export function mixStamp(area, x, y, radius, strength, plan, origin = 0, painter = null) {
    const n = area.nx;
    painter ??= new StrokePaint(area);
    const i0 = Math.max(0, Math.floor((x - radius) / SPACING)),
        i1 = Math.min(n - 1, Math.ceil((x + radius) / SPACING));
    const j0 = Math.max(0, Math.floor((y - radius) / SPACING)),
        j1 = Math.min(area.ny - 1, Math.ceil((y + radius) / SPACING));
    if (i0 > i1 || j0 > j1 || !plan.indices.length) return null;
    for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
            const px = i * SPACING,
                py = j * SPACING;
            const r = reach(Math.hypot(px - x, py - y), radius, plan.soft);
            if (r <= 0) continue;
            const { ci, cj } = patchAt(px - origin, py - origin, plan.patch, plan.seed);
            const { k, cover } = patchChoice(plan, ci, cj);
            if (cover >= strength) continue;
            // (the core through the painter too, so a rim passing over it later in the stroke can't take it back)
            painter.put(j * n + i, plan.indices[k], r, false);
        }
    }
    return { i0, i1, j0, j1 };
}
