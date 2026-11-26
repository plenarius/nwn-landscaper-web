// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Local light: each tile's two main lights, the .are's Tile_MainLight1 and Tile_MainLight2. Their colours are rows of
// lightcolor.2da, 0 to 31 (the game's TILE_MAIN_LIGHT_COLOR_* constants; 0 is black, off). Both lights hang 5 m over the
// tile's middle and reach 14 m (landscaper's ml1 and ml2), so the Light tool paints a broad wash a tile at a time, not a lamp:
// lamps and torches stay placeables.

import { TILE, MAX_LIGHT } from './area.js';

/** lightcolor.2da's rows 0 to 31: the name, the colour the game lights with (RED, GREEN, BLUE: past 1 is brighter than white)
 *  and the one the toolset shows (TOOLSETRED...), as the stock table has them. */
export const LIGHT_COLORS = [
    ['Black (off)', [0, 0, 0], [0, 0, 0]],
    ['Dim white', [0.6, 0.6, 0.6], [0.33, 0.33, 0.33]],
    ['White', [1.2, 1.2, 1.2], [0.66, 0.66, 0.66]],
    ['Bright white', [2, 2, 2], [1, 1, 1]],
    ['Pale dark yellow', [0.94, 0.94, 0.5], [0.59, 0.56, 0.37]],
    ['Dark yellow', [0.96, 0.87, 0.03], [0.42, 0.39, 0]],
    ['Pale yellow', [1.9, 1.9, 1], [0.94, 0.94, 0.77]],
    ['Yellow', [1.9, 1.7, 0.06], [0.96, 0.87, 0.03]],
    ['Pale dark green', [0.72, 0.87, 0.56], [0.38, 0.57, 0.02]],
    ['Dark green', [0.06, 0.93, 0.21], [0.2, 0.41, 0.09]],
    ['Pale green', [1.4, 1.8, 1.4], [0.72, 0.87, 0.56]],
    ['Green', [0.12, 1.85, 0.42], [0.06, 0.93, 0.21]],
    ['Pale dark aqua', [0.65, 0.96, 0.91], [0.41, 0.58, 0.52]],
    ['Dark aqua', [0.18, 0.84, 0.94], [0.08, 0.37, 0.41]],
    ['Pale aqua', [1.3, 1.92, 1.82], [0.82, 0.96, 0.91]],
    ['Aqua', [0.36, 1.68, 1.9], [0.18, 0.84, 0.94]],
    ['Pale dark blue', [0.7, 0.7, 1.2], [0.3, 0.25, 0.59]],
    ['Dark blue', [0.4, 0.4, 0.95], [0, 0.02, 0.42]],
    ['Pale blue', [1.4, 1.4, 2.4], [0.69, 0.65, 0.92]],
    ['Blue', [0.8, 0.8, 1.9], [0, 0.06, 0.95]],
    ['Pale dark purple', [0.92, 0.65, 0.92], [0.59, 0.26, 0.58]],
    ['Dark purple', [0.76, 0.25, 0.95], [0.33, 0, 0.42]],
    ['Pale purple', [1.84, 1.3, 1.84], [0.92, 0.65, 0.92]],
    ['Purple', [1.5, 0.5, 1.9], [0.76, 0, 0.95]],
    ['Pale dark red', [1, 0.5, 0.5], [0.6, 0.36, 0.26]],
    ['Dark red', [1, 0.15, 0.1], [0.42, 0.04, 0]],
    ['Pale red', [2, 1.2, 1.2], [0.92, 0.72, 0.65]],
    ['Red', [2, 0.5, 0.2], [0.95, 0.08, 0]],
    ['Pale dark orange', [1, 0.75, 0.3], [0.59, 0.45, 0.26]],
    ['Dark orange', [1, 0.5, 0], [0.42, 0.15, 0]],
    ['Pale orange', [1.85, 1.2, 0.6], [0.92, 0.8, 0.65]],
    ['Orange', [1.9, 0.7, 0], [0.95, 0.35, 0]],
].map(([name, game, shown], row) => ({ row, name, game, shown }));
// (one a row a tile light may take)
if (LIGHT_COLORS.length !== MAX_LIGHT + 1) throw new Error('lightcolor.2da: 32 rows');

/** Where the game's tile lights sit and how far they reach (landscaper's ml1 and ml2: 5 m over the tile's middle, radius 14). */
export const LIGHT_HEIGHT = 5;
export const LIGHT_RADIUS = 14;

/** The Light tool's presets: a pair of colours each, and the kinds of area it suits (`kinds`; `night`: an outdoor area at night). */
export const LIGHT_PRESETS = [
    { id: 'none', name: 'None', lights: [0, 0], kinds: ['day'], hint: 'Lights off: outdoors by day the sun is enough' },
    { id: 'village', name: 'Warm pools', lights: [30, 28], kinds: ['night'], hint: 'Lamplight over a village or camp at night' },
    { id: 'torch', name: 'Torchlight', lights: [31, 29], kinds: ['interior', 'underground'], hint: 'Firelight: a hall, a lit cave' },
    { id: 'cave', name: 'Cold blue', lights: [17, 16], kinds: ['underground'], hint: 'A cold glow deep in a cave' },
    { id: 'moon', name: 'Moonlit', lights: [16, 0], kinds: ['night'], hint: 'A faint blue for open ground at night' },
    { id: 'indoors', name: 'Indoors', lights: [1, 4], kinds: ['interior'], hint: 'Plain light in rooms' },
    { id: 'eerie', name: 'Eerie', lights: [9, 8], kinds: ['underground', 'night'], hint: 'A sickly green: a crypt, a swamp' },
    { id: 'arcane', name: 'Arcane', lights: [21, 13], kinds: ['interior', 'underground'], hint: 'Purple and aqua: a mage’s den' },
];

/** The kind of light area `a` is, for the presets: 'interior', 'underground', or outdoors 'night' or 'day' (its light shown at
 *  `night`, or an area that is always night). */
export function lightKind(a, night) {
    if (a.kind === 'interior' || a.kind === 'underground') return a.kind;
    return night || a.atmosphere?.time === 'night' ? 'night' : 'day';
}

/** Row `row` as a CSS colour, as the toolset shows it. */
export function swatch(row) {
    const [r, g, b] = (LIGHT_COLORS[row] ?? LIGHT_COLORS[0]).shown.map(v => Math.round(Math.min(1, v) * 255));
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Gives the tiles under the brush at area point (x, y) the lights `pair` ([light1, light2]; [0, 0] turns them off): the tile
 * under the point, and every tile whose middle is within `radius` metres of it. Returns whether any tile changed.
 */
export function lightStamp(area, x, y, radius, pair) {
    const { tiles, tilesY } = area;
    if (!(x >= 0 && y >= 0 && x <= area.sizeX && y <= area.sizeY)) return false;
    const at = [Math.min(tiles - 1, Math.floor(x / TILE)), Math.min(tilesY - 1, Math.floor(y / TILE))];
    const reach = Math.ceil(radius / TILE);
    let changed = false;
    for (let ty = Math.max(0, at[1] - reach); ty <= Math.min(tilesY - 1, at[1] + reach); ty++) {
        for (let tx = Math.max(0, at[0] - reach); tx <= Math.min(tiles - 1, at[0] + reach); tx++) {
            const under = tx === at[0] && ty === at[1];
            if (!under && Math.hypot((tx + 0.5) * TILE - x, (ty + 0.5) * TILE - y) > radius) continue;
            changed = area.setLight(tx, ty, pair) || changed;
        }
    }
    return changed;
}

/** Gives every tile of `area` the lights `pair`. Returns whether any changed. */
export function lightFill(area, pair) {
    let changed = false;
    for (let ty = 0; ty < area.tilesY; ty++) for (let tx = 0; tx < area.tiles; tx++) changed = area.setLight(tx, ty, pair) || changed;
    return changed;
}

/** How many of `area`'s tiles have a light on. */
export function litTiles(area) {
    return area.lights?.filter(p => p[0] || p[1]).length ?? 0;
}

/**
 * The view's wash: one texel a tile (rows from the south), RGB the tile's two lights' colours added as the game lights with them
 * (lightcolor.2da's RED, GREEN, BLUE), as floats. null when no tile is lit.
 */
export function lightTexels(area) {
    if (!litTiles(area)) return null;
    const out = new Float32Array(area.tiles * area.tilesY * 4);
    area.lights.forEach(([a, b], k) => {
        for (let c = 0; c < 3; c++) out[k * 4 + c] = LIGHT_COLORS[a].game[c] + LIGHT_COLORS[b].game[c];
        out[k * 4 + 3] = 1;
    });
    return out;
}
