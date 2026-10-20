// Sculpting tools. Each stamp applies over a circle of `radius` metres
// with a smooth falloff, scaled by `strength` (0..1) and the frame time,
// so holding the mouse keeps working at a steady rate.

import { SPACING } from './area.js';

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
    dig: { label: 'Dig', key: '0', hint: 'Dig cave passages and chambers out of the rock, down to the floor (or the level where you start). At least 3 m radius: narrower passages defeat NWN\'s pathfinding' },
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
    const n = area.n, h = area.heights;
    const i0 = Math.max(0, Math.floor((x - radius) / SPACING)), i1 = Math.min(n - 1, Math.ceil((x + radius) / SPACING));
    const j0 = Math.max(0, Math.floor((y - radius) / SPACING)), j1 = Math.min(n - 1, Math.ceil((y + radius) / SPACING));
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
                        if (ii >= 0 && ii < n && jj >= 0 && jj < n) { sum += h[jj * n + ii]; count++; }
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
    const n = area.n, h = area.heights, reach = radius * 1.2;
    const i0 = Math.max(0, Math.floor((x - reach) / SPACING)), i1 = Math.min(n - 1, Math.ceil((x + reach) / SPACING));
    const j0 = Math.max(0, Math.floor((y - reach) / SPACING)), j1 = Math.min(n - 1, Math.ceil((y + reach) / SPACING));
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
