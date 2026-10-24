// Cave entrances (landscaper src/entrance.rs): a notch carved into the
// slope (a flat floor, rock walls and a rim round it), with a rock hood and
// a dark back that landscaper builds into the tile, and a transition door
// at the back to link in the toolset.
//
// An entrance's frame: u into the slope along `dir` (radians from east,
// anticlockwise), v across it, from the middle of the mouth on the floor.

import { SPACING } from './area.js';

// The rise a cave needs over its floor: lower ground round it is raised to
// this as a rocky outcrop, its outer slope steep so it is one compact
// obstacle. (A walkable slope round a blocked crest made a ring NWN's
// in-tile search loses itself in.)
export const ROOF = 4.5;
const WALL = 1.2;
const MOUND_SLOPE = 2.5;
// The cut faces beside and behind the floor, painted with the cave's rock.
const FACE = 0.7;
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

/** The outcrop's height over the floor at (u, v): a rounded rectangle
 *  hugging the walls' rectangle `r` (kept compact: a bigger one spilled
 *  into the next tile and made its ground winding for the game's
 *  pathfinding), ROOF high and a little domed, its ragged edge falling
 *  steeply. */
function outcrop(e, r, u, v) {
    const uc = (r.u0 + r.u1) / 2, a = (r.u1 - r.u0) / 2 * 1.1, b = r.v * 1.1;
    const du = Math.abs(u - uc) / a, dv = Math.abs(v) / b;
    const q = Math.pow(du ** 4 + dv ** 4, 0.25);
    const angle = Math.atan2(dv, du), s = e.x * 0.37 + e.y * 0.61;
    const ragged = 0.3 * Math.sin(3 * angle + s) + 0.2 * Math.sin(7 * angle + 2 * s);
    // Inside the walls' rectangle it is at least ROOF (the cave's walls).
    const inWalls = u >= r.u0 && u <= r.u1 && Math.abs(v) <= r.v;
    if (q <= 1 || inWalls) return ROOF + 0.6 * Math.max(0, 1 - q * q);
    const d = (q - 1) * Math.min(a, b) - ragged;
    return d <= 0 ? ROOF : ROOF - MOUND_SLOPE * d;
}

/**
 * Carves entrance `e` into the area's heights (and paints its walls with
 * `rock`, a palette index); returns the changed sample rectangle.
 */
export function carve(area, e, rock) {
    const n = area.nx, h = area.heights;
    const half = e.width / 2;
    // The walls' outline: from just inside the mouth to behind the back.
    const r = { u0: -0.5, u1: e.depth + WALL, v: half + WALL };
    const reach = Math.hypot(e.depth + WALL, half + WALL) + ROOF / MOUND_SLOPE + 1;
    const i0 = Math.max(0, Math.floor((e.x - reach) / SPACING)), i1 = Math.min(n - 1, Math.ceil((e.x + reach) / SPACING));
    const j0 = Math.max(0, Math.floor((e.y - reach) / SPACING)), j1 = Math.min(area.ny - 1, Math.ceil((e.y + reach) / SPACING));
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
            } else if (!(Math.abs(v) <= half && u < r.u0)) {
                // The rock the cave is in, where the ground is lower: an oval
                // round the walls, slightly domed, its edge ragged and
                // steep (one compact obstacle for the game's pathfinding).
                const target = e.floor + outcrop(e, r, u, v);
                if (target > h[k] + 0.05) {
                    h[k] = target;
                    if (rock !== undefined) area.materials[k] = rock;
                }
                // The cut faces beside and behind the floor: rock whatever the hill is painted.
                if (rock !== undefined && Math.abs(v) <= half + FACE && u >= r.u0 && u <= e.depth + FACE) area.materials[k] = rock;
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
export function fitInTile(e, tile = 10, sizeX = Infinity, sizeY = sizeX) {
    const margin = 0.4, half = e.width / 2 + 0.3;
    // The notch and 3 m of ground before it: in the same tile, the notch is
    // part of that ground's region and the game routes into it like any
    // recess. (Alone in a tile with the slope above, it gets no crossing:
    // routes from afar found no way in.)
    const corners = [[-APPROACH, -half], [-APPROACH, half], [e.depth + 0.3, -half], [e.depth + 0.3, half]].map(([u, v]) => at(e, u, v));
    const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
    // The smallest move putting [lo, hi] inside a tile (of those it touches,
    // `tiles` along that axis).
    const shift = (lo, hi, tiles) => {
        let best = null;
        for (const t of new Set([lo, (lo + hi) / 2, hi].map(p => Math.min(Math.max(Math.floor(p / tile), 0), tiles - 1)))) {
            const a = t * tile + margin, b = (t + 1) * tile - margin;
            const s = hi - lo > b - a ? (a + b) / 2 - (lo + hi) / 2 : lo < a ? a - lo : hi > b ? b - hi : 0;
            if (best === null || Math.abs(s) < Math.abs(best)) best = s;
        }
        return best;
    };
    const along = size => Math.max(1, Math.floor(size / tile));
    const dx = shift(Math.min(...xs), Math.max(...xs), along(sizeX)), dy = shift(Math.min(...ys), Math.max(...ys), along(sizeY));
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

// --- The cave mouth's shape (landscaper src/entrance.rs: keep in step) ---

const LIP = -0.6, SIDE = 0.3, THICK = 0.7, READ_OUT = 1.2;

const seed = e => e.x * 0.37 + e.y * 0.61;

/** u of the lip's edge at v: ragged. */
export function lip(e, v) {
    const s = seed(e);
    return LIP + 0.22 * Math.sin(2.3 * v + s) + 0.13 * Math.sin(5.1 * v + 2 * s);
}

/** The arch's underside over the floor at (u, v). */
export function under(e, u, v) {
    const t = Math.min(1, Math.max(-1, v / (e.width / 2)));
    const arch = 1 + 1.9 * Math.sqrt(Math.max(0, 1 - t * t));
    const rough = 0.12 * Math.sin(3.7 * v + 1.3 * u + seed(e));
    const droop = 0.25 * Math.min(1, Math.max(0, (0.4 - u) / 1));
    return arch + rough - droop;
}

/** The roof's top over the floor at (u, v): the hill round the opening blended across it. */
export function top(e, u, v, height) {
    const vr = e.width / 2 + SIDE, u0 = LIP, u1 = e.depth;
    const s = Math.min(1, Math.max(0, (u - u0) / (u1 - u0)));
    const t = Math.min(1, Math.max(0, (v + vr) / (2 * vr)));
    const ground = (u, v) => { const [x, y] = at(e, u, v); return height(x, y) - e.floor; };
    const along = s => u0 + s * (u1 - u0), across = t => -vr + t * 2 * vr;
    const front = t => under(e, u0, across(t)) + THICK;
    const back = t => ground(e.depth + READ_OUT, across(t));
    const left = s => ground(along(s), -(vr + READ_OUT));
    const right = s => ground(along(s), vr + READ_OUT);
    const p00 = (front(0) + left(0)) / 2, p01 = (front(1) + right(0)) / 2;
    const p10 = (back(0) + left(1)) / 2, p11 = (back(1) + right(1)) / 2;
    const coons = (1 - s) * front(t) + s * back(t) + (1 - t) * left(s) + t * right(s)
        - ((1 - s) * (1 - t) * p00 + (1 - s) * t * p01 + s * (1 - t) * p10 + s * t * p11);
    return Math.max(coons, under(e, u, v) + THICK);
}

/** The scenery's triangles in area metres: { top, rock, back }, each a flat
 *  array of x, y, z (three a triangle), as landscaper builds them. */
export function scenery(e, height) {
    const nu = Math.ceil((e.depth - LIP) / 0.5), nv = Math.ceil((e.width + 2 * SIDE) / 0.5);
    const vr = e.width / 2 + SIDE, hw = e.width / 2;
    const world = (u, v, z) => { const [x, y] = at(e, u, v); return [x, y, e.floor + z]; };
    const uvAt = (i, j) => { const v = -vr + j * 2 * vr / nv, l = lip(e, v); return [l + i * (e.depth - l) / nu, v]; };
    const out = { top: [], rock: [], back: [] };
    const quad = (list, q) => list.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
    for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nv; j++) {
            const c = [uvAt(i, j), uvAt(i + 1, j), uvAt(i + 1, j + 1), uvAt(i, j + 1)];
            quad(out.top, c.map(([u, v]) => world(u, v, top(e, u, v, height))));
            quad(out.rock, c.map(([u, v]) => world(u, v, under(e, u, v))));
        }
    }
    for (let j = 0; j < nv; j++) {
        const [u0, v0] = uvAt(0, j), [u1, v1] = uvAt(0, j + 1);
        quad(out.rock, [world(u0, v0, under(e, u0, v0)), world(u1, v1, under(e, u1, v1)), world(u1, v1, top(e, u1, v1, height)), world(u0, v0, top(e, u0, v0, height))]);
    }
    const ub = e.depth - 0.05;
    for (let j = 0; j < nv; j++) {
        const v0 = -hw + j * e.width / nv, v1 = -hw + (j + 1) * e.width / nv;
        quad(out.back, [world(ub, v0, -0.1), world(ub, v1, -0.1), world(ub, v1, under(e, ub, v1)), world(ub, v0, under(e, ub, v0))]);
    }
    return out;
}

/** The rock that suits a slope painted `category` (texture library
 *  categories), if the library has it: its own rock on rock, mossy rock
 *  by grass and flowers, canyon rock by earth and sand, winter rock in snow. */
export function rockFor(category, groundId, has) {
    const pick = { Rock: groundId, Grass: 'swampRock', 'Flowers & leaves': 'swampRock', Earth: 'canyonRock', Sand: 'canyonRock', Snow: 'winterRock' }[category];
    return [pick, 'rockCliff', 'rock'].find(id => id && has(id)) ?? null;
}
