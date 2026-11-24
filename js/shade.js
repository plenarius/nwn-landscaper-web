// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Baked shadows, as landscaper bakes them into each tile's shadow map
// (landscaper src/shade.rs): cast shadows along the game's fixed sun
// direction, towards (4000, 4500, 7000), and ambient occlusion from the
// horizon in eight directions, darker inside cave entrances. Keep the two
// in step.

import { darkness } from './entrance.js';

const SUN = (() => {
    const l = Math.hypot(4000, 4500, 7000);
    return [4000 / l, 4500 / l, 7000 / l];
})();

function castShadow(x, y, z, height) {
    const horizontal = Math.hypot(SUN[0], SUN[1]);
    const dx = SUN[0] / horizontal,
        dy = SUN[1] / horizontal,
        rise = SUN[2] / horizontal;
    let dark = 0;
    for (let t = 0.3; t < 80; t += t < 4 ? 0.25 : 0.5) {
        const above = height(x + dx * t, y + dy * t) - (z + 0.05 + rise * t);
        if (above > 0) {
            dark = Math.max(dark, Math.min(above / (0.25 + 0.04 * t), 1));
            if (dark >= 1) break;
        }
    }
    return dark;
}

const STEPS = [0.5, 1, 1.75, 2.75, 4, 6, 9, 13];

function occlusion(x, y, z, height) {
    let sum = 0;
    for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4,
            dx = Math.cos(a),
            dy = Math.sin(a);
        let slope = 0;
        for (const t of STEPS) slope = Math.max(slope, (height(x + dx * t, y + dy * t) - z) / t);
        sum += slope / Math.sqrt(1 + slope * slope);
    }
    return sum / 8;
}

/** What the terrain does to (x, y): how much of the sun it hides (0 underground, with `sun` false) and of the sky. */
function terrain(x, y, height, sun) {
    const z = height(x, y);
    return [sun ? castShadow(x, y, z, height) : 0, occlusion(x, y, z, height)];
}

/** The shadow-map value from terrain()'s two: 1 unshaded; `strength` 0..1. */
const combine = (strength, [cast, hidden]) => Math.min(1, Math.max(0.15, 1 - strength * (1 - (1 - 0.6 * cast) * (1 - 0.8 * hidden))));

/** The shadow-map value at (x, y): 1 unshaded; `strength` 0..1. */
export function shade(x, y, strength, height, sun = true) {
    return combine(strength, terrain(x, y, height, sun));
}

// Metres between the preview's samples.
export const SHADE_STEP = 1.25;

/** The area's shadows on a grid SHADE_STEP apart: mx across, my rows from the south, four bytes a point: the shadow-map value
 *  (with the entrances' darkness), and for the view's object shadows the terrain's two (the sun and the sky it hides) and the
 *  entrances' darkness on their own (the view works out the engine's value with the objects again from them). */
export function shadeArea(area, strength) {
    const mx = Math.round(area.sizeX / SHADE_STEP) + 1,
        my = Math.round(area.sizeY / SHADE_STEP) + 1;
    const out = new Uint8Array(mx * my * 4);
    for (let k = 0; k < mx * my; k++) out.set([255, 0, 0, 255], k * 4);
    // No shadow maps at 0 (landscaper writes none), so no dark entrances either.
    if (strength <= 0) return { mx, my, data: out };
    shadeRect(area, strength, out, { x0: 0, y0: 0, x1: area.sizeX, y1: area.sizeY });
    return { mx, my, data: out };
}

// How far a change of the ground reaches into the shadows, in metres: a cast shadow is looked for up to 80 m towards the sun,
// and the ambient occlusion 13 m round (castShadow, STEPS), plus a sample for the interpolation.
const SUN_REACH = 80,
    AROUND = 14;

/**
 * Bakes again, into `data` (shadeArea's grid), the shadows the ground changed in `r` (metres: x0, y0, x1, y1) can reach: the
 * points from which the sun is looked for across `r`, and those near it. The rest of the grid stays as it is: on a 32×32
 * area a whole bake takes 250 to 900 ms, too long after each stroke.
 */
export function shadeChanged(area, strength, data, r) {
    if (strength <= 0) return;
    const horizontal = Math.hypot(SUN[0], SUN[1]);
    const reach = { x: (SUN[0] / horizontal) * SUN_REACH, y: (SUN[1] / horizontal) * SUN_REACH };
    // (the sun is towards +x and +y: the points that look across r lie that far to the south-west of it)
    shadeRect(area, strength, data, { x0: r.x0 - reach.x - AROUND, y0: r.y0 - reach.y - AROUND, x1: r.x1 + AROUND, y1: r.y1 + AROUND });
}

/** Bakes the grid's points inside `r` (metres) into `data`. */
function shadeRect(area, strength, data, r) {
    const mx = Math.round(area.sizeX / SHADE_STEP) + 1,
        my = Math.round(area.sizeY / SHADE_STEP) + 1;
    const height = (x, y) => area.heightAt(x, y);
    const i0 = Math.max(0, Math.floor(r.x0 / SHADE_STEP)),
        i1 = Math.min(mx - 1, Math.ceil(r.x1 / SHADE_STEP)),
        j0 = Math.max(0, Math.floor(r.y0 / SHADE_STEP)),
        j1 = Math.min(my - 1, Math.ceil(r.y1 / SHADE_STEP));
    for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
            const x = i * SHADE_STEP,
                y = j * SHADE_STEP;
            const t = terrain(x, y, height, !area.enclosed()),
                dark = darkness(area.entrances, x, y);
            data.set(
                [Math.round(255 * combine(strength, t) * dark), Math.round(255 * t[0]), Math.round(255 * t[1]), Math.round(255 * dark)],
                (j * mx + i) * 4,
            );
        }
    }
}
