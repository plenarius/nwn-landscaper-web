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

/** The shadow-map value at (x, y): 1 unshaded; `strength` 0..1. */
export function shade(x, y, strength, height, sun = true) {
    const z = height(x, y);
    // Underground: no sun, only the ambient occlusion.
    const lit = sun ? 1 - 0.6 * castShadow(x, y, z, height) : 1;
    const open = 1 - 0.8 * occlusion(x, y, z, height);
    return Math.min(1, Math.max(0.15, 1 - strength * (1 - lit * open)));
}

// Metres between the preview's samples.
export const SHADE_STEP = 1.25;

/** The area's shadows on a grid SHADE_STEP apart: mx across, my rows
 *  from the south. */
export function shadeArea(area, strength) {
    const mx = Math.round(area.sizeX / SHADE_STEP) + 1,
        my = Math.round(area.sizeY / SHADE_STEP) + 1;
    const out = new Uint8Array(mx * my).fill(255);
    // No shadow maps at 0 (landscaper writes none), so no dark entrances either.
    if (strength <= 0) return { mx, my, data: out };
    const height = (x, y) => area.heightAt(x, y);
    for (let j = 0; j < my; j++) {
        for (let i = 0; i < mx; i++) {
            const x = i * SHADE_STEP,
                y = j * SHADE_STEP;
            const s = shade(x, y, strength, height, !area.enclosed());
            out[j * mx + i] = Math.round(255 * s * darkness(area.entrances, x, y));
        }
    }
    return { mx, my, data: out };
}
