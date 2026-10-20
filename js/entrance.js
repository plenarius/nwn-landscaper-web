// Cave entrances (landscaper src/entrance.rs): a notch carved into the
// slope (a flat floor, rock walls and a rim round it), with a rock hood and
// a dark back that landscaper builds into the tile, and a transition door
// at the back to link in the toolset.
//
// An entrance's frame: u into the slope along `dir` (radians from east,
// anticlockwise), v across it, from the middle of the mouth on the floor.

import { SPACING } from './area.js';

// The rim's height over the floor, the hood's (landscaper's HOOD_*), and
// the outer slope of the rock the walls stand in where the ground is lower:
// steep, so it is one compact obstacle. (A walkable slope round a blocked
// crest made a ring NWN's in-tile search loses itself in.)
export const RIM = 3.6;
export const HOOD_UNDER = 2.7, HOOD_TOP = 3.9, HOOD_OUT = 0.6, HOOD_SIDE = 0.8;
const WALL = 1.5;
const MOUND_SLOPE = 2.5;
// Rise per metre of the ramp up (or down) to the mouth: walkable.
const RAMP = 0.5;
// Open ground before the mouth kept in the notch's tile (fitInTile).
const APPROACH = 3;

export function at(e, u, v) {
    const c = Math.cos(e.dir), s = Math.sin(e.dir);
    return [e.x + c * u - s * v, e.y + s * u + c * v];
}

export function local(e, x, y) {
    const c = Math.cos(e.dir), s = Math.sin(e.dir), dx = x - e.x, dy = y - e.y;
    return [dx * c + dy * s, -dx * s + dy * c];
}

/**
 * Carves entrance `e` into the area's heights (and paints its walls with
 * `rock`, a palette index); returns the changed sample rectangle.
 */
export function carve(area, e, rock) {
    const n = area.n, h = area.heights;
    const half = e.width / 2;
    // The walls' outline: from just inside the mouth to behind the back.
    const r = { u0: -0.5, u1: e.depth + WALL, v: half + WALL };
    const reach = Math.hypot(e.depth + WALL, half + WALL) + RIM / MOUND_SLOPE + 1;
    const i0 = Math.max(0, Math.floor((e.x - reach) / SPACING)), i1 = Math.min(n - 1, Math.ceil((e.x + reach) / SPACING));
    const j0 = Math.max(0, Math.floor((e.y - reach) / SPACING)), j1 = Math.min(n - 1, Math.ceil((e.y + reach) / SPACING));
    for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
            const k = j * n + i;
            const [u, v] = local(e, i * SPACING, j * SPACING);
            if (Math.abs(v) <= half && u >= -1.5 && u <= e.depth) {
                // The floor, and a level apron before the mouth.
                h[k] = e.floor;
            } else if (Math.abs(v) <= half + 1 && u < -1.5) {
                // A ramp to the apron, cut or filled, gentle enough to walk
                // (and blended out at its sides).
                const d = -1.5 - u, side = Math.max(0, Math.abs(v) - half);
                const slack = RAMP * d + 2 * side;
                h[k] = Math.min(Math.max(h[k], e.floor - slack), e.floor + slack);
            } else if (u >= r.u0 && u <= r.u1 && Math.abs(v) <= r.v && !(Math.abs(v) <= half && u < r.u0)) {
                h[k] = Math.max(h[k], e.floor + RIM);
                if (rock !== undefined) area.materials[k] = rock;
            } else if (!(Math.abs(v) <= half && u < r.u0)) {
                // The mound round the walls, sloping down to the ground.
                const du = u < r.u0 ? r.u0 - u : u > r.u1 ? u - r.u1 : 0;
                const dv = Math.max(0, Math.abs(v) - r.v);
                const d = Math.hypot(du, dv);
                const raised = e.floor + RIM - MOUND_SLOPE * d;
                if (raised > h[k] + 0.05) {
                    h[k] = raised;
                    // The rock block's sides are rock too.
                    if (rock !== undefined) area.materials[k] = rock;
                }
            }
        }
    }
    return { i0, i1, j0, j1 };
}

/**
 * Moves entrance `e` (its mouth) so its notch, with ground before it, lies
 * in one 10 m tile: NWN's pathfinding works tile by tile, and a narrow dead
 * end across tile edges costs it millions of steps (the simulator showed
 * routes to the door failing). Returns how far it moved.
 */
export function fitInTile(e, tile = 10, areaSize = Infinity) {
    const margin = 0.4, half = e.width / 2 + 0.3;
    // The notch and 3 m of ground before it: in the same tile, the notch is
    // part of that ground's region and the game routes into it like any
    // recess. (Alone in a tile with the slope above, it gets no crossing:
    // routes from afar found no way in.)
    const corners = [[-APPROACH, -half], [-APPROACH, half], [e.depth + 0.3, -half], [e.depth + 0.3, half]].map(([u, v]) => at(e, u, v));
    const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
    const tiles = Math.max(1, Math.floor(areaSize / tile));
    // The smallest move putting [lo, hi] inside a tile (of those it touches).
    const shift = (lo, hi) => {
        let best = null;
        for (const t of new Set([lo, (lo + hi) / 2, hi].map(p => Math.min(Math.max(Math.floor(p / tile), 0), tiles - 1)))) {
            const a = t * tile + margin, b = (t + 1) * tile - margin;
            const s = hi - lo > b - a ? (a + b) / 2 - (lo + hi) / 2 : lo < a ? a - lo : hi > b ? b - hi : 0;
            if (best === null || Math.abs(s) < Math.abs(best)) best = s;
        }
        return best;
    };
    const dx = shift(Math.min(...xs), Math.max(...xs)), dy = shift(Math.min(...ys), Math.max(...ys));
    e.x += dx;
    e.y += dy;
    return Math.hypot(dx, dy);
}

/** How much darker the shadow map is at (x, y) inside an entrance (landscaper's darkness). */
export function darkness(entrances, x, y) {
    let f = 1;
    for (const e of entrances) {
        const [u, v] = local(e, x, y);
        if (u < -1 || u > e.depth + 1.5 || Math.abs(v) > e.width / 2 + 1.5) continue;
        const s = Math.min(1, Math.max(0, (u + 0.8) / 1.2));
        const inside = 1 - 0.45 * s * s * (3 - 2 * s) - 0.25 * Math.min(1, Math.max(0, u / e.depth));
        f = Math.min(f, inside);
    }
    return f;
}

/** The entrance nearest (x, y) within `within` metres of its mouth, or null. */
export function nearest(entrances, x, y, within = 4) {
    let best = null, bd = within;
    for (const e of entrances) {
        const d = Math.hypot(e.x - x, e.y - y);
        if (d < bd) { best = e; bd = d; }
    }
    return best;
}
