// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Where a placed or scattered object meets the ground: its base, not its whole bounding box. A tree's crown can reach metres
// past its trunk; on a slope the lowest ground under the crown's box is far below the trunk, and the tree sank to its crown.

/** How far above a model's lowest point its drawn triangles still count as its base (m). Measured on the game's trees,
 *  bushes, rocks, ferns and flowers: by 0.3 m their stems and trunks are full width (a fern is 1.1 by 0.6 m at 0.2 m, 1.3 by
 *  0.9 m at 0.3 m), and above it drooping limbs start to count (a willow's base grows from 4.7 m at 0.3 m to 6.2 m at 0.4 m). */
export const BASE_BAND = 0.3;

const bases = new WeakMap();

/** The box an object of model `flat` (the engine's `/api/model`) stands on, in model metres: `{ min: [x, y], max: [x, y] }`, or
 *  null when the model has none. Its walkmesh's footprint when it has one (where it blocks walking: a tree's trunk); else its
 *  drawn triangles within BASE_BAND of its lowest point, cut at that height (a bush's stem, a rock's foot). */
export function baseOf(flat) {
    if (bases.has(flat)) return bases.get(flat);
    const box = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
    const add = (x, y) => {
        box.min[0] = Math.min(box.min[0], x);
        box.min[1] = Math.min(box.min[1], y);
        box.max[0] = Math.max(box.max[0], x);
        box.max[1] = Math.max(box.max[1], y);
    };
    if (flat.footprint?.length) {
        for (const t of flat.footprint) for (const [x, y] of t) add(x, y);
    } else {
        const p = flat.positions ?? [];
        const cut = (flat.min?.[2] ?? 0) + BASE_BAND;
        for (let k = 0; k + 2 < p.length; k += 3) {
            const t = [p[k], p[k + 1], p[k + 2]];
            for (let e = 0; e < 3; e++) {
                const a = t[e],
                    b = t[(e + 1) % 3];
                if (a[2] <= cut) add(a[0], a[1]);
                // An edge crossing the cut adds where it crosses: a trunk drawn as one tall triangle still has its width there.
                if (a[2] <= cut !== b[2] <= cut) {
                    const f = (cut - a[2]) / (b[2] - a[2]);
                    add(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f);
                }
            }
        }
    }
    const base = box.min[0] <= box.max[0] ? box : null;
    bases.set(flat, base);
    return base;
}

/** The points (area metres, `[x, y]`) object `o` stands on: its base's four corners and middle, turned by its bearing and
 *  sized by its scale; its origin alone when its model has no base. */
export function basePoints(o, flat) {
    const base = baseOf(flat);
    if (!base) return [[o.x, o.y]];
    const c = Math.cos(o.bearing),
        s = Math.sin(o.bearing);
    const [x0, y0] = base.min,
        [x1, y1] = base.max;
    const local = [
        [x0, y0],
        [x1, y0],
        [x0, y1],
        [x1, y1],
        [(x0 + x1) / 2, (y0 + y1) / 2],
    ];
    return local.map(([x, y]) => [o.x + (c * x - s * y) * o.scale, o.y + (s * x + c * y) * o.scale]);
}

/** The height object `o` stands at: the lowest ground (`heightAt(x, y)`) under its base, so no corner of it floats. */
export function groundUnder(o, flat, heightAt) {
    return Math.min(...basePoints(o, flat).map(([x, y]) => heightAt(x, y)));
}
