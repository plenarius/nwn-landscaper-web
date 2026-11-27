// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Scatter's "Carry the scenery outward": fills the band round the area (band.js) with scenery like what stands near the area's
// edge. Each point of the band looks at the objects within REACH of the nearest point on the edge: its density is theirs (per
// square metre of the area that window covers), thinning a little towards the band's outer rim, and what it gets is a copy of one
// of them, turned at random and sized a little apart. So a forest's edge goes on as forest, a clearing stays bare, and the mix
// changes along the edge as it does inside.

import { basePoints, groundUnder } from './footing.js';

/** Metres round a point on the edge whose objects the band beside it copies. */
export const REACH = 25;
/** The band's density at its outer rim, as a share of the edge's: it thins out gently towards where the game's scene ends. */
export const RIM = 0.65;
/** Metres between the tries: one a square of this side, jittered within it. */
const STEP = 1;
/** Passes over the band. */
const PASSES = 4;
/** Metres round a try in which the objects already there are counted against its density. */
const CROWD = 5;
/** Each copy is sized up to this share smaller or larger than the object it copies. */
const SIZE_JITTER = 0.15;

const smoothstep = (a, b, v) => {
    const t = Math.min(Math.max((v - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
};

/** Objects by the 5 m square they stand in, for the spacing check: each try looks only at its neighbours. */
class Grid {
    constructor() {
        this.cells = new Map();
    }
    key(x, y) {
        return `${Math.floor(x / 5)},${Math.floor(y / 5)}`;
    }
    add(o) {
        const k = this.key(o.x, o.y);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(o);
    }
    /** How many objects stand within `d` metres of (x, y) (d at most 5). */
    count(x, y, d) {
        const i = Math.floor(x / 5),
            j = Math.floor(y / 5);
        let n = 0;
        for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++)
                for (const o of this.cells.get(`${i + di},${j + dj}`) ?? []) if (Math.hypot(o.x - x, o.y - y) < d) n++;
        return n;
    }
}

/** The objects within REACH of each point on the area's edge, and how much of the area that window covers (square metres),
 *  cached by the point rounded to a metre. */
function windows(area, sources) {
    const cache = new Map();
    return (ex, ey) => {
        const x = Math.round(ex),
            y = Math.round(ey),
            k = `${x},${y}`;
        if (cache.has(k)) return cache.get(k);
        const near = sources.filter(o => Math.hypot(o.x - x, o.y - y) <= REACH);
        let cover = 0;
        for (let v = -REACH + 0.5; v < REACH; v++)
            for (let u = -REACH + 0.5; u < REACH; u++)
                if (u * u + v * v <= REACH * REACH && x + u >= 0 && y + v >= 0 && x + u <= area.sizeX && y + v <= area.sizeY) cover++;
        const w = { near, density: cover ? near.length / cover : 0 };
        cache.set(k, w);
        return w;
    };
}

/**
 * The objects that carry `area`'s edge scenery out over its band: new baked objects (no ids yet), each a copy of one of the
 * area's objects within REACH of the edge, on dry ground no steeper than walkable, its base within the band. `flats`: each
 * model's shape (Map, model name to the engine's `/api/model`); models without one are left out. `random`: numbers in [0, 1).
 * Objects already on the band count for the spacing, so pressing it again adds little.
 */
export function carryOutward(area, flats, random = Math.random) {
    const band = area.band;
    if (!band) return [];
    const { sizeX, sizeY } = area,
        r = band.offset;
    const inside = o => o.x >= 0 && o.y >= 0 && o.x <= sizeX && o.y <= sizeY;
    const sources = area.objects.filter(o => inside(o) && !o.model.startsWith('@import:') && flats.has(o.model));
    if (!sources.length) return [];
    const at = windows(area, sources),
        grid = new Grid(),
        out = [];
    for (const o of area.objects) grid.add(o);
    // (A few passes: one leaves it about half as dense as the edge, the tries kept apart losing many; the count keeps it from
    // growing denser.)
    for (let pass = 0; pass < PASSES; pass++)
        for (let y = -r; y < sizeY + r; y += STEP)
            for (let x = -r; x < sizeX + r; x += STEP) {
                const px = x + random() * STEP,
                    py = y + random() * STEP;
                if (!area.beyond(px, py)) continue;
                const ex = Math.min(Math.max(px, 0), sizeX),
                    ey = Math.min(Math.max(py, 0), sizeY),
                    d = Math.hypot(px - ex, py - ey);
                const w = at(ex, ey);
                const density = w.density * (1 - (1 - RIM) * smoothstep(0.3, 1, d / r));
                if (!w.near.length || random() >= density * STEP * STEP) continue;
                // Trunks a little apart (about 0.6 of the spacing the density gives), and no more round here than the density asks
                // for, counting what is there already: pressing it again tops the band up rather than doubling it.
                if (grid.count(px, py, Math.min(5, 0.6 / Math.sqrt(w.density)))) continue;
                if (grid.count(px, py, CROWD) >= density * Math.PI * CROWD * CROWD) continue;
                const like = w.near[Math.floor(random() * w.near.length)],
                    flat = flats.get(like.model);
                const o = {
                    model: like.model,
                    appearance: like.appearance,
                    x: px,
                    y: py,
                    z: 0,
                    bearing: random() * Math.PI * 2,
                    scale: Math.min(5, Math.max(0.1, like.scale * (1 + (random() * 2 - 1) * SIZE_JITTER))),
                    solid: like.solid !== false,
                    baked: true,
                };
                const base = basePoints(o, flat);
                if (!base.every(([bx, by]) => area.onGround(bx, by, 0.5) && area.firmAt(bx, by))) continue;
                o.z = groundUnder(o, flat, (bx, by) => area.groundAt(bx, by));
                grid.add(o);
                out.push(o);
            }
    return out;
}
