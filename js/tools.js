// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Sculpting tools. Each stamp applies over a circle of `radius` metres
// with a smooth falloff, scaled by `strength` (0..1) and the frame time,
// so holding the mouse keeps working at a steady rate.

import { SPACING, TILE, MAX_RISE, CAVE_ROCK } from './area.js';

export const TOOLS = {
    raise: { label: 'Raise', key: '1', hint: 'Build up the ground' },
    lower: { label: 'Lower', key: '2', hint: 'Dig down' },
    smooth: { label: 'Smooth', key: '3', hint: 'Soften bumps and edges' },
    flatten: { label: 'Flatten', key: '4', hint: 'Level to the height where you first click' },
    paint: { label: 'Paint', key: '5', hint: 'Paint the ground with a texture' },
    water: {
        label: 'Water',
        key: '6',
        hint: 'Click in a hollow and drag up to fill it; drag on water to change its level; Shift-click water to drain it',
    },
    entrance: {
        label: 'Entrance',
        key: '7',
        hint: 'Click a slope to carve a cave entrance (a door to link in the toolset); brush size is its width; Shift-click one to remove it',
    },
    place: { label: 'Place', key: '8', hint: 'Place rocks, trees and other placeables, baked into the terrain' },
    scatter: { label: 'Scatter', key: '9', hint: 'Paint rocks, trees and bushes; Shift-drag to erase' },
    things: {
        label: 'Things',
        key: 't',
        hint: 'Place creatures, waypoints, triggers and transitions, sounds, encounters, stores, items, doors and placeables',
    },
    dig: {
        label: 'Dig',
        key: '0',
        hint: "Dig cave passages and chambers out of the rock, down to the floor (or the level where you start). At least 3 m radius: narrower passages defeat NWN's pathfinding",
    },
    ramp: {
        label: 'Ramp',
        key: 'p',
        hint: 'Drag from one level to another to lay a ramp (or stairs) between them; the brush size is half its width. It rises to where you let go, or by the amount you set',
    },
    descent: {
        label: 'Descent',
        key: 'd',
        hint: 'Drag a box in a cave or interior: it is filled with halls, one a floor lower than the last, joined by ramps at alternating ends (a switchback descent)',
    },
    room: {
        label: 'Room',
        key: 'r',
        hint: 'Drag a rectangle to cut out a room (snapped to 1.25 m, at least 5 m a side); overlapping rooms join',
    },
};

// The narrowest Dig brush (radius): passages under about 6 m wide crossing
// tiles were closed by the game's tile pathfinding (4 of them in a test
// cave dug at 2.2 m; none at 3.5 m).
export const DIG_MIN = 3;

// Metres a second at full strength, for raise/lower.
const RATE = 4;

function falloff(d, r) {
    if (d >= r) return 0;
    return 0.5 * (1 + Math.cos((Math.PI * d) / r));
}

/**
 * Applies `tool` at area point (x, y). `flattenTo` is the height captured
 * at the start of a flatten stroke. Returns the changed sample rectangle.
 */
export function stamp(area, tool, x, y, radius, strength, dt, flattenTo, paintIndex) {
    if (tool === 'dig') return dig(area, x, y, Math.max(radius, DIG_MIN), flattenTo, paintIndex);
    const n = area.nx,
        h = area.heights;
    const i0 = Math.max(0, Math.floor((x - radius) / SPACING)),
        i1 = Math.min(n - 1, Math.ceil((x + radius) / SPACING));
    const j0 = Math.max(0, Math.floor((y - radius) / SPACING)),
        j1 = Math.min(area.ny - 1, Math.ceil((y + radius) / SPACING));
    if (i0 > i1 || j0 > j1) return null;
    const amount = strength * Math.min(dt, 0.1);

    if (tool === 'paint') {
        // Hard-edged inside the brush (the view blends neighbouring textures);
        // a lower strength paints a smaller core of the brush.
        const core = radius * (0.35 + 0.65 * strength);
        const m = area.materials;
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                if (Math.hypot(i * SPACING - x, j * SPACING - y) <= core) m[j * n + i] = paintIndex;
            }
        }
    } else if (tool === 'smooth') {
        // Blend toward the local average (computed from the current heights).
        const w = i1 - i0 + 1;
        const avg = new Float32Array(w * (j1 - j0 + 1));
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                let sum = 0,
                    count = 0;
                for (let dj = -2; dj <= 2; dj++) {
                    for (let di = -2; di <= 2; di++) {
                        const ii = i + di,
                            jj = j + dj;
                        if (ii >= 0 && ii < n && jj >= 0 && jj < area.ny) {
                            sum += h[jj * n + ii];
                            count++;
                        }
                    }
                }
                avg[(j - j0) * w + (i - i0)] = sum / count;
            }
        }
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                const f = falloff(Math.hypot(i * SPACING - x, j * SPACING - y), radius);
                if (f <= 0) continue;
                const k = j * n + i;
                h[k] += (avg[(j - j0) * w + (i - i0)] - h[k]) * Math.min(1, f * amount * 12);
            }
        }
    } else {
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                const f = falloff(Math.hypot(i * SPACING - x, j * SPACING - y), radius);
                if (f <= 0) continue;
                const k = j * n + i;
                if (tool === 'raise') h[k] += RATE * amount * f;
                else if (tool === 'lower') h[k] -= RATE * amount * f;
                else if (tool === 'flatten') h[k] += (flattenTo - h[k]) * Math.min(1, f * amount * 10);
            }
        }
    }
    return { i0, i1, j0, j1 };
}

/**
 * Digs a cave out: ground within the brush (its edge a little ragged, so
 * walls aren't smooth arcs) down to `floor`, painted `paintIndex`.
 */
function dig(area, x, y, radius, floor, paintIndex) {
    const n = area.nx,
        h = area.heights,
        reach = radius * 1.2;
    const i0 = Math.max(0, Math.floor((x - reach) / SPACING)),
        i1 = Math.min(n - 1, Math.ceil((x + reach) / SPACING));
    const j0 = Math.max(0, Math.floor((y - reach) / SPACING)),
        j1 = Math.min(area.ny - 1, Math.ceil((y + reach) / SPACING));
    if (i0 > i1 || j0 > j1) return null;
    for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
            const px = i * SPACING,
                py = j * SPACING;
            const a = Math.atan2(py - y, px - x);
            // The same rough edge wherever the brush passes: noise by place.
            const rough = 1 + 0.12 * Math.sin(3 * a + px * 0.7) + 0.08 * Math.sin(5 * a + py * 1.1);
            if (Math.hypot(px - x, py - y) <= radius * rough) {
                const k = j * n + i;
                if (h[k] > floor) {
                    h[k] = floor;
                    if (paintIndex !== undefined) area.materials[k] = paintIndex;
                }
            }
        }
    }
    return { i0, i1, j0, j1 };
}

// Rooms snap to this grid and are at least this wide: narrower ones were
// hard on NWN's tile pathfinding, as cave passages were.
export const ROOM_GRID = 1.25;
/** Narrowest a room (a corridor) can be. */
export const ROOM_MIN = 2.5;

/** The room a drag from a to b makes: snapped to ROOM_GRID, and fitted to
 *  NWN's tile pathfinding. Routes cross a tile edge only at fixed exit
 *  points, and every layout that joins edges uses the middle one (5 m along),
 *  so a room must cover the middle of each tile edge it crosses: its west and
 *  south walls sit in the first half of their tile (at most 3.75 m in), its
 *  east and north walls in the second half (at least 6.25 m in). */
export function roomRect(a, b, sizeX, sizeY = sizeX) {
    const snap = v => Math.round(v / ROOM_GRID) * ROOM_GRID;
    const low = v => {
        const base = Math.floor(v / TILE) * TILE,
            o = v - base;
        return o <= 3.75 ? v : o >= 7.5 ? base + TILE : base + 3.75;
    };
    const high = v => {
        const base = Math.floor(v / TILE) * TILE,
            o = v - base;
        return o === 0 || o >= 6.25 ? v : o <= 2.5 ? base : base + 6.25;
    };
    const side = (p, q) => {
        let v0 = low(snap(Math.min(p, q))),
            v1 = high(snap(Math.max(p, q)));
        if (v1 - v0 < ROOM_MIN) {
            // Too small to cross a tile middle: the narrowest room around it.
            const base = Math.floor((p + q) / 2 / TILE) * TILE;
            v0 = base + 3.75;
            v1 = base + 6.25;
        }
        return [v0, v1];
    };
    const [x0, x1] = side(a.x, b.x),
        [y0, y1] = side(a.y, b.y);
    const cx = v => Math.min(sizeX, Math.max(0, v)),
        cy = v => Math.min(sizeY, Math.max(0, v));
    return { x0: cx(x0), x1: cx(x1), y0: cy(y0), y1: cy(y1) };
}

/** Cuts room `r` out down to `floor`, its floor painted `paintIndex`. */
export function cutRoom(area, r, floor, paintIndex) {
    const n = area.nx,
        rows = area.ny,
        h = area.heights;
    const i0 = Math.ceil(r.x0 / SPACING),
        i1 = Math.floor(r.x1 / SPACING);
    const j0 = Math.ceil(r.y0 / SPACING),
        j1 = Math.floor(r.y1 / SPACING);
    for (let j = Math.max(0, j0); j <= Math.min(rows - 1, j1); j++) {
        for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i++) {
            const k = j * n + i;
            h[k] = floor;
            if (paintIndex !== undefined) area.materials[k] = paintIndex;
        }
    }
    return { i0: Math.max(0, i0 - 1), i1: Math.min(n - 1, i1 + 1), j0: Math.max(0, j0 - 1), j1: Math.min(rows - 1, j1 + 1) };
}

/** The steepest slope (rise over run) that is walkable: the editor's rule for a sample's neighbours. */
export const MAX_SLOPE = MAX_RISE / SPACING;

/**
 * A ramp from `a` to `b` (area points): where it starts and ends, how long and steep, and whether it had to be eased to stay
 * walkable. The start's height is the ground there; the end's is the ground where it was let go, or `rise` metres above the start.
 * `keepWalkable` limits the slope to what NWN can walk (a little under the limit); a cave's end stays clear of its roof.
 */
export function rampPlan(area, a, b, { rise = null, keepWalkable = true } = {}) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const hA = area.heightAt(a.x, a.y);
    let hB = rise == null || Number.isNaN(rise) ? area.heightAt(b.x, b.y) : hA + rise;
    let eased = false;
    const limit = len * MAX_SLOPE * 0.92;
    if (keepWalkable && Math.abs(hB - hA) > limit) {
        hB = hA + Math.sign(hB - hA) * limit;
        eased = true;
    }
    if (area.enclosed() && area.roof != null && hB > area.roof - 2) {
        hB = area.roof - 2;
        eased = true;
    }
    const dh = hB - hA;
    return { a, b, len, hA, hB, dh, degrees: len > 0 ? (Math.atan2(Math.abs(dh), len) * 180) / Math.PI : 0, eased };
}

/** Lays the ramp `plan` (see rampPlan) `width` metres wide; with `step` (metres) as stairs of that height, else a smooth slope. The
 *  outer metre of its width blends into the ground beside it. In a cave or interior only floor is changed, all of it to the
 *  ramp's level, so make the ramp a little wider than the passage (a ramp is laid in a
 *  passage or room that is already dug: the walls the Room and Dig tools leave are the ones NWN's pathfinding accepts), unless
 *  `carve`. Returns the changed sample rectangle and how many samples changed. */
export function cutRamp(area, plan, width, step = null, carve = false) {
    const { a, b, len, hA, dh } = plan;
    if (len < 0.5) return null;
    const half = width / 2,
        edge = Math.min(1.25, half / 2);
    const n = area.nx,
        rows = area.ny,
        h = area.heights;
    const ux = (b.x - a.x) / len,
        uy = (b.y - a.y) / len;
    const x0 = Math.min(a.x, b.x) - half,
        x1 = Math.max(a.x, b.x) + half,
        y0 = Math.min(a.y, b.y) - half,
        y1 = Math.max(a.y, b.y) + half;
    const i0 = Math.max(0, Math.floor(x0 / SPACING)),
        i1 = Math.min(n - 1, Math.ceil(x1 / SPACING));
    const j0 = Math.max(0, Math.floor(y0 / SPACING)),
        j1 = Math.min(rows - 1, Math.ceil(y1 / SPACING));
    const steps = step && step > 0 ? Math.max(1, Math.round(Math.abs(dh) / step)) : 0;
    const floorOnly = area.enclosed() && !carve;
    let changed = 0;
    for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
            const px = i * SPACING - a.x,
                py = j * SPACING - a.y;
            const along = px * ux + py * uy,
                across = px * -uy + py * ux;
            const t = Math.min(1, Math.max(0, along / len));
            // beyond either end the ramp is a half-circle of its own width, level with that end
            const d = Math.hypot(Math.abs(across), along < 0 ? along : along > len ? along - len : 0);
            if (d >= half) continue;
            if (floorOnly && area.void(i, j)) continue;
            const m = steps ? Math.min(steps, Math.floor(t * steps) + 1) / steps : t;
            const target = hA + dh * m;
            const u = Math.min(1, (half - d) / edge);
            // (In a dug passage nothing is blended: a taper would leave a half-lowered ledge along each wall.)
            const w = floorOnly ? 1 : u * u * (3 - 2 * u);
            const k = j * n + i;
            h[k] += (target - h[k]) * w;
            changed++;
        }
    }
    return { i0: Math.max(0, i0 - 1), i1: Math.min(n - 1, i1 + 1), j0: Math.max(0, j0 - 1), j1: Math.min(rows - 1, j1 + 1), changed };
}

// A descent: halls side by side across a box, each `drop` metres lower than the one before, joined by a ramp at alternating ends.
// Every length is what the tested layouts used: halls a tile in from the box's ends, ramps along the tile middle lines 15 m in,
// a passage 8 m wide with the ramp 10 m wide over it (so no ledge is left), and two tiles at least for a floor.
const DESCENT_MARGIN = 10,
    DESCENT_RAMP_IN = 15,
    DESCENT_PASSAGE = 4,
    DESCENT_RAMP_WIDTH = 10,
    DESCENT_PITCH_MIN = 20,
    DESCENT_LENGTH_MIN = 40;

/**
 * The descent over the tile box that holds `from` and `to`: `floors` halls, `drop` metres between them. Halls run along the box's
 * longer side and stack across the other; `flip` starts from the other end. `plan.error` says why it can't be made; otherwise
 * `plan.halls` (rooms with their floor), `plan.passages` (rooms with their floor) and `plan.ramps` (area points, for rampPlan).
 */
export function descentPlan(area, from, to, { floors = 6, drop = 5, flip = false } = {}) {
    const snap = (v, size) => Math.min(size, Math.max(0, v));
    const x0 = snap(Math.floor(Math.min(from.x, to.x) / TILE) * TILE, area.sizeX),
        x1 = snap(Math.ceil(Math.max(from.x, to.x) / TILE) * TILE, area.sizeX);
    const y0 = snap(Math.floor(Math.min(from.y, to.y) / TILE) * TILE, area.sizeY),
        y1 = snap(Math.ceil(Math.max(from.y, to.y) / TILE) * TILE, area.sizeY);
    const alongX = x1 - x0 >= y1 - y0;
    // u runs along the halls, v across them; `pt` turns them into area points.
    const [u0, u1, v0, v1] = alongX ? [x0, x1, y0, y1] : [y0, y1, x0, x1];
    const pt = (u, v) => (alongX ? { x: u, y: v } : { x: v, y: u });
    const plan = { box: { x0, x1, y0, y1 }, alongX, floors, drop, halls: [], passages: [], ramps: [] };
    if (!area.enclosed()) return { ...plan, error: 'Descents are for a cave or an interior.' };
    if (!(floors >= 2) || !(drop > 0)) return { ...plan, error: 'Two floors at least, and a drop of more than 0.' };
    const pitch = (v1 - v0) / floors;
    if (pitch < DESCENT_PITCH_MIN)
        return { ...plan, error: `Each floor needs two tiles across: make the box ${floors * 2} tiles deep, or use fewer floors.` };
    if (u1 - u0 < DESCENT_LENGTH_MIN) return { ...plan, error: 'The halls need four tiles of length: make the box longer.' };
    if (drop > pitch * MAX_SLOPE * 0.92)
        return { ...plan, error: `${drop} m over ${pitch.toFixed(0)} m is too steep to walk: a smaller drop, or a deeper box.` };
    // The top floor: where the first hall is dug (the area's floor if it is still rock).
    const centre = k => v0 + Math.round((pitch * (k + 0.5)) / 5) * 5;
    const first = pt((u0 + u1) / 2, centre(flip ? floors - 1 : 0));
    const start = area.heightAt(first.x, first.y);
    const top = start >= area.roof - 0.5 ? area.roof - CAVE_ROCK : start;
    const room = (ua, va, ub, vb) => roomRect(pt(ua, va), pt(ub, vb), area.sizeX, area.sizeY);
    for (let n = 0; n < floors; n++) {
        const k = flip ? floors - 1 - n : n,
            v = centre(k),
            floor = top - drop * n;
        plan.halls.push({ rect: room(u0 + DESCENT_MARGIN, v - 5, u1 - DESCENT_MARGIN, v + 5), floor });
        if (n < floors - 1) {
            const k2 = flip ? k - 1 : k + 1,
                v2 = centre(k2);
            const u = n % 2 === 0 ? u1 - DESCENT_RAMP_IN : u0 + DESCENT_RAMP_IN;
            plan.passages.push({ rect: room(u - DESCENT_PASSAGE, Math.min(v, v2), u + DESCENT_PASSAGE, Math.max(v, v2)), floor });
            plan.ramps.push({ a: pt(u, v), b: pt(u, v2), rise: -drop });
        }
    }
    plan.pitch = pitch;
    plan.degrees = (Math.atan2(drop, pitch) * 180) / Math.PI;
    plan.bottom = top - drop * (floors - 1);
    return plan;
}

/** Cuts the descent `plan` (no error): the halls, then the passages between them, then a ramp down each. Returns the box's samples. */
export function cutDescent(area, plan, paintIndex) {
    for (const h of plan.halls) cutRoom(area, h.rect, h.floor, paintIndex);
    for (const p of plan.passages) cutRoom(area, p.rect, p.floor, paintIndex);
    for (const r of plan.ramps) cutRamp(area, rampPlan(area, r.a, r.b, { rise: r.rise }), DESCENT_RAMP_WIDTH, null);
    const { x0, x1, y0, y1 } = plan.box;
    return {
        i0: Math.max(0, Math.floor(x0 / SPACING) - 1),
        i1: Math.min(area.nx - 1, Math.ceil(x1 / SPACING) + 1),
        j0: Math.max(0, Math.floor(y0 / SPACING) - 1),
        j1: Math.min(area.ny - 1, Math.ceil(y1 / SPACING) + 1),
    };
}
