// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The blend layer (soft paint stage 2, landscaper's src/generator/soft.rs): beside its paint, each sample may hold a second
// texture and its weight, so a soft brush's edge lies between samples where the brush put it, not on the 0.625 m grid. In
// memory a Uint16Array beside `materials`: the second's palette index in the low byte, its weight (0 to 255, 0: none) in the
// high one, so its bytes are the file's and the engine's, interleaved [second, weight] a sample.
//
// A sample with weight w shows its second with share w / 255 and its paint with the rest; the paint holds the heavier of the
// two (w <= 127), so an engine or editor that knows no layer still shows the nearest texture. The second may be the paint
// itself (w 255): the sample is pinned, drawn as it is instead of smoothed, which a soft brush's core does so the smoothing
// never rounds the brush's own edge.

import { toBase64, fromBase64 } from './area.js';

/** The second's palette index and its weight (0..255) of blend value `v`. */
export const secondOf = v => v & 255;
export const weightOf = v => v >>> 8;
/** A blend value: second `m` with weight `w` (0..255); none when w is 0. */
export const blendValue = (m, w) => (w > 0 ? m | (w << 8) : 0);
/** A sample pinned to its paint `m`. */
export const pinned = m => m | (255 << 8);

/** The layer as an area file keeps it: base64 of its bytes, or null when no sample has a weight (the file is then as before). */
export function blendForSave(blend) {
    let any = false;
    for (let k = 0; k < blend.length && !any; k++) any = blend[k] >= 256;
    if (!any) return null;
    // (a sample with no weight is written [0, 0], so the same ground always gives the same bytes)
    const out = blend.slice();
    for (let k = 0; k < out.length; k++) if (out[k] < 256) out[k] = 0;
    return toBase64(new Uint8Array(out.buffer));
}

/** The layer saved as `text` for `n` samples of a palette of `palette` entries; null when there is none or it doesn't fit.
 *  A sample naming a texture past the palette loses its weight. */
export function blendFromSave(text, n, palette) {
    if (typeof text !== 'string' || !text) return null;
    const bytes = fromBase64(text);
    if (bytes.length !== 2 * n) return null;
    const blend = new Uint16Array(n);
    for (let k = 0; k < n; k++) {
        const m = bytes[2 * k],
            w = bytes[2 * k + 1];
        blend[k] = m < palette ? blendValue(m, w) : 0;
    }
    return blend;
}

/** Sample `k`'s textures as [[index, share], ...] (one or two, heaviest first) from paint `m` and blend value `v`. */
export function sampleMix(m, v) {
    const w = weightOf(v),
        s = secondOf(v);
    if (!w || s === m) return [[m, 1]];
    const share = w / 255;
    return share > 0.5
        ? [
              [s, share],
              [m, 1 - share],
          ]
        : [
              [m, 1 - share],
              [s, share],
          ];
}

/**
 * Sample (paint `m`, blend `v`) once texture `p` has been painted over it with weight `w` (0..1): its textures keep 1 - w of
 * their shares and `p` gets w; the two heaviest stay, the third goes (it is only where three textures meet, and moves the
 * junction by centimetres). On a tie the texture already there stays, so a weak rim never swaps one for another. `pin`: a
 * sample that comes out wholly `p` is pinned (a soft brush's core), else it is plain paint, smoothed as any. Returns
 * [paint, blend]; the sample as it was when `p` gets too little to show.
 */
export function paintOver(m, v, p, w, pin) {
    if (w <= 0) return [m, v];
    if (w >= 1) return [p, pin ? pinned(p) : 0];
    const shares = new Map();
    for (const [t, s] of sampleMix(m, v)) shares.set(t, s * (1 - w));
    shares.set(p, (shares.get(p) ?? 0) + w);
    // (Map keeps the order of insertion: the textures there first, `p` last, so a stable sort keeps them on a tie)
    const [[a, wa], [b, wb] = [a, 0]] = [...shares].sort((x, y) => y[1] - x[1]);
    const q = Math.round((255 * wb) / (wa + wb));
    if (q === 0) return a === p ? [p, pin ? pinned(p) : 0] : [m, v];
    return [a, blendValue(b, q)];
}

/**
 * A stroke's painting over a grid (an area's or a band's `materials` and `blend`): each sample takes the most any of the
 * stroke's stamps gave it, worked out from the sample as it was before the stroke, so holding a soft brush still doesn't
 * build up to a hard one. `put(k, p, w, pin)` paints sample k.
 */
export class StrokePaint {
    constructor(grid) {
        this.grid = grid;
        this.was = new Map();
    }

    put(k, p, w, pin) {
        const g = this.grid;
        let s = this.was.get(k);
        if (!s) {
            s = { m: g.materials[k], v: g.blend[k], w: 0, p };
            this.was.set(k, s);
        }
        // (another texture in the same stroke: a mix's patches meet; the later one paints over what the stroke left)
        if (s.p !== p) {
            Object.assign(s, { m: g.materials[k], v: g.blend[k], w: 0, p });
        }
        if (w <= s.w) return false;
        s.w = w;
        const [m, v] = paintOver(s.m, s.v, p, w, pin);
        if (m === g.materials[k] && v === g.blend[k]) return false;
        g.materials[k] = m;
        g.blend[k] = v;
        return true;
    }
}
