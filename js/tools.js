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
    water: { label: 'Water', key: '6', hint: 'Click in a hollow and drag up to fill it; drag on water to change its level; Shift-click water to drain it' },
    entrance: { label: 'Entrance', key: '7', hint: 'Click a slope to carve a cave entrance (a door to link in the toolset); brush size is its width; Shift-click one to remove it' },
    place: { label: 'Place', key: '8', hint: 'Place rocks, trees and other placeables, baked into the terrain' },
    scatter: { label: 'Scatter', key: '9', hint: 'Paint rocks, trees and bushes; Shift-drag to erase' },
    things: { label: 'Things', key: 't', hint: 'Place creatures, waypoints, triggers and transitions, sounds, encounters, stores, items, doors and placeables' },
    dig: { label: 'Dig', key: '0', hint: 'Dig cave passages and chambers out of the rock, down to the floor (or the level where you start). At least 3 m radius: narrower passages defeat NWN\'s pathfinding' },
    ramp: { label: 'Ramp', key: 'p', hint: 'Drag from one level to another to lay a ramp (or stairs) between them; the brush size is half its width. It rises to where you let go, or by the amount you set' },
    room: { label: 'Room', key: 'r', hint: 'Drag a rectangle to cut out a room (snapped to 1.25 m, at least 5 m a side); overlapping rooms join' },
};

// The narrowest Dig brush (radius): passages under about 6 m wide crossing
// tiles were closed by the game's tile pathfinding (4 of them in a test
// cave dug at 2.2 m; none at 3.5 m).
export const DIG_MIN = 3;

// Metres a second at full strength, for raise/lower.
const RATE = 4;

function falloff(d, r) {
    if (d >= r) return 0;
    return 0.5 * (1 + Math.cos(Math.PI * d / r));
}

/**
 * Applies `tool` at area point (x, y). `flattenTo` is the height captured
 * at the start of a flatten stroke. Returns the changed sample rectangle.
 */
export function stamp(area, tool, x, y, radius, strength, dt, flattenTo, paintIndex) {
    if (tool === 'dig') return dig(area, x, y, Math.max(radius, DIG_MIN), flattenTo, paintIndex);
    const n = area.nx, h = area.heights;
    const i0 = Math.max(0, Math.floor((x - radius) / SPACING)), i1 = Math.min(n - 1, Math.ceil((x + radius) / SPACING));
    const j0 = Math.max(0, Math.floor((y - radius) / SPACING)), j1 = Math.min(area.ny - 1, Math.ceil((y + radius) / SPACING));
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
                let sum = 0, count = 0;
                for (let dj = -2; dj <= 2; dj++) {
                    for (let di = -2; di <= 2; di++) {
                        const ii = i + di, jj = j + dj;
                        if (ii >= 0 && ii < n && jj >= 0 && jj < area.ny) { sum += h[jj * n + ii]; count++; }
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
    const n = area.nx, h = area.heights, reach = radius * 1.2;
    const i0 = Math.max(0, Math.floor((x - reach) / SPACING)), i1 = Math.min(n - 1, Math.ceil((x + reach) / SPACING));
    const j0 = Math.max(0, Math.floor((y - reach) / SPACING)), j1 = Math.min(area.ny - 1, Math.ceil((y + reach) / SPACING));
    if (i0 > i1 || j0 > j1) return null;
    for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
            const px = i * SPACING, py = j * SPACING;
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
        const base = Math.floor(v / TILE) * TILE, o = v - base;
        return o <= 3.75 ? v : o >= 7.5 ? base + TILE : base + 3.75;
    };
    const high = v => {
        const base = Math.floor(v / TILE) * TILE, o = v - base;
        return o === 0 || o >= 6.25 ? v : o <= 2.5 ? base : base + 6.25;
    };
    const side = (p, q) => {
        let v0 = low(snap(Math.min(p, q))), v1 = high(snap(Math.max(p, q)));
        if (v1 - v0 < ROOM_MIN) {
            // Too small to cross a tile middle: the narrowest room around it.
            const base = Math.floor((p + q) / 2 / TILE) * TILE;
            v0 = base + 3.75; v1 = base + 6.25;
        }
        return [v0, v1];
    };
    const [x0, x1] = side(a.x, b.x), [y0, y1] = side(a.y, b.y);
    const cx = v => Math.min(sizeX, Math.max(0, v)), cy = v => Math.min(sizeY, Math.max(0, v));
    return { x0: cx(x0), x1: cx(x1), y0: cy(y0), y1: cy(y1) };
}

/** Cuts room `r` out down to `floor`, its floor painted `paintIndex`. */
export function cutRoom(area, r, floor, paintIndex) {
    const n = area.nx, rows = area.ny, h = area.heights;
    const i0 = Math.ceil(r.x0 / SPACING), i1 = Math.floor(r.x1 / SPACING);
    const j0 = Math.ceil(r.y0 / SPACING), j1 = Math.floor(r.y1 / SPACING);
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
    if (keepWalkable && Math.abs(hB - hA) > limit) { hB = hA + Math.sign(hB - hA) * limit; eased = true; }
    if (area.enclosed() && area.roof != null && hB > area.roof - 2) { hB = area.roof - 2; eased = true; }
    const dh = hB - hA;
    return { a, b, len, hA, hB, dh, degrees: len > 0 ? Math.atan2(Math.abs(dh), len) * 180 / Math.PI : 0, eased };
}

/** Lays the ramp `plan` (see rampPlan) `width` metres wide; with `step` (metres) as stairs of that height, else a smooth slope. The
 *  outer metre of its width blends into the ground beside it. In a cave or interior only floor is changed (a ramp is laid in a
 *  passage or room that is already dug: the walls the Room and Dig tools leave are the ones NWN's pathfinding accepts), unless
 *  `carve`. Returns the changed sample rectangle and how many samples changed. */
export function cutRamp(area, plan, width, step = null, carve = false) {
    const { a, b, len, hA, dh } = plan;
    if (len < 0.5) return null;
    const half = width / 2, edge = Math.min(1.25, half / 2);
    const n = area.nx, rows = area.ny, h = area.heights;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const x0 = Math.min(a.x, b.x) - half, x1 = Math.max(a.x, b.x) + half, y0 = Math.min(a.y, b.y) - half, y1 = Math.max(a.y, b.y) + half;
    const i0 = Math.max(0, Math.floor(x0 / SPACING)), i1 = Math.min(n - 1, Math.ceil(x1 / SPACING));
    const j0 = Math.max(0, Math.floor(y0 / SPACING)), j1 = Math.min(rows - 1, Math.ceil(y1 / SPACING));
    const steps = step && step > 0 ? Math.max(1, Math.round(Math.abs(dh) / step)) : 0;
    const floorOnly = area.enclosed() && !carve;
    let changed = 0;
    for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
            const px = i * SPACING - a.x, py = j * SPACING - a.y;
            const along = px * ux + py * uy, across = px * -uy + py * ux;
            const t = Math.min(1, Math.max(0, along / len));
            // beyond either end the ramp is a half-circle of its own width, level with that end
            const d = Math.hypot(Math.abs(across), along < 0 ? along : along > len ? along - len : 0);
            if (d >= half) continue;
            if (floorOnly && area.void(i, j)) continue;
            const m = steps ? Math.min(steps, Math.floor(t * steps) + 1) / steps : t;
            const target = hA + dh * m;
            const u = Math.min(1, (half - d) / edge);
            const w = u * u * (3 - 2 * u);
            const k = j * n + i;
            h[k] += (target - h[k]) * w;
            changed++;
        }
    }
    return { i0: Math.max(0, i0 - 1), i1: Math.min(n - 1, i1 + 1), j0: Math.max(0, j0 - 1), j1: Math.min(rows - 1, j1 + 1), changed };
}
