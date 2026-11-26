// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Sample landscapes for the New area dialog: a canyon, a snowy mountain pass, a dune desert and a valley with a lake. Each
// shapes a flat area's ground, paints it by height and slope, and sets its light, sky box and weather, so a builder starts
// from something finished and changes it.

import { DEFAULT_TEXTURE, MAX_RISE, SPACING } from './area.js';
import { copyPreset, PRESETS } from './atmosphere.js';
import { generateHeightMap } from './noise.js';

const smoothstep = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/** fBm noise over the area's samples, 0 to 1. `metres`: the size of its largest features. */
function noise(area, seed, metres, octaves = 4, persistence = 0.5) {
    return generateHeightMap({ seed, width: area.nx, height: area.ny, octaves, persistence, lacunarity: 2.1, scale: metres / SPACING });
}

/** Each sample's distance in metres to the polyline `line` ([[x, y], ...], metres). */
function distanceToLine(area, line) {
    const { nx, ny } = area,
        d = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const x = i * SPACING,
                y = j * SPACING;
            let best = Infinity;
            for (let k = 1; k < line.length; k++) {
                const [ax, ay] = line[k - 1],
                    [bx, by] = line[k];
                const ux = bx - ax,
                    uy = by - ay;
                const t = Math.min(1, Math.max(0, ((x - ax) * ux + (y - ay) * uy) / (ux * ux + uy * uy)));
                best = Math.min(best, Math.hypot(x - ax - t * ux, y - ay - t * uy));
            }
            d[j * nx + i] = best;
        }
    }
    return d;
}

/** A line from the west edge to the east, wandering `swing` metres north and south of the middle, one point every 2 m. */
function westToEast(area, rand, swing, bends) {
    const phase = rand() * Math.PI * 2,
        second = rand() * Math.PI * 2,
        line = [];
    for (let x = 0; x <= area.sizeX; x += 2) {
        const t = x / area.sizeX;
        // Each end stays near the middle of its edge, where a transition goes.
        const ends = Math.sin(Math.PI * t) ** 0.5;
        const y =
            area.sizeY / 2 + swing * ends * (0.75 * Math.sin(phase + bends * Math.PI * t) + 0.25 * Math.sin(second + 3.1 * bends * t));
        line.push([x, y]);
    }
    return line;
}

/** Adds `metres` of the ridged noise `n` (0 to 1) inside ground already too steep to walk, at least 2 m from its edge, so walls
 *  and crags look rough while their edges and walkable ground stay smooth. Fine noise on walkable ground, or on a wall's edge,
 *  leaves small pockets and ragged bays, and NWN's pathfinding struggles with those (the path check's "too winding" tiles and
 *  closed passages). */
function roughen(area, n, metres) {
    const { nx, ny, heights: h } = area,
        far = new Float32Array(nx * ny);
    // How many samples each steep sample is from walkable ground (city-block distance, two passes).
    for (let k = 0; k < nx * ny; k++) far[k] = rise(area, k) > 1.4 * MAX_RISE ? 1e6 : 0;
    for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
            const k = j * nx + i;
            if (i > 0) far[k] = Math.min(far[k], far[k - 1] + 1);
            if (j > 0) far[k] = Math.min(far[k], far[k - nx] + 1);
        }
    for (let j = ny - 1; j >= 0; j--)
        for (let i = nx - 1; i >= 0; i--) {
            const k = j * nx + i;
            if (i < nx - 1) far[k] = Math.min(far[k], far[k + 1] + 1);
            if (j < ny - 1) far[k] = Math.min(far[k], far[k + nx] + 1);
        }
    for (let k = 0; k < nx * ny; k++) h[k] += metres * (1 - Math.abs(2 * n[k] - 1)) * smoothstep(3, 6, far[k]);
}

/** The steepest rise from sample `k` to a neighbour, metres a sample (MAX_RISE and more can't be walked). */
function rise(area, k) {
    const { nx, heights: h } = area,
        i = k % nx,
        j = (k - i) / nx,
        z = h[k];
    let r = 0;
    if (i > 0) r = Math.max(r, Math.abs(h[k - 1] - z));
    if (i < nx - 1) r = Math.max(r, Math.abs(h[k + 1] - z));
    if (j > 0) r = Math.max(r, Math.abs(h[k - nx] - z));
    if (j < area.ny - 1) r = Math.max(r, Math.abs(h[k + nx] - z));
    return r;
}

/** The texture for one of `paint`'s keys: the first of `wanted` the library has. A string is a starter library id; an array is
 *  `[category, ...words]`, the library's first texture of that category whose id or name holds the first word that any holds,
 *  else its first of that category (a team's own library names its textures its own way). None: the area's default. */
function pick(library, wanted) {
    const all = library.catalog ?? [...library.byId.values()];
    for (const w of wanted) {
        if (typeof w === 'string') {
            if (library.byId.has(w)) return w;
            continue;
        }
        const [category, ...words] = w;
        const of = all.filter(t => t?.category === category);
        for (const word of words) {
            const t = of.find(t => `${t.id} ${t.name ?? ''}`.toLowerCase().includes(word));
            if (t) return t.id;
        }
        if (of.length) return of[0].id;
    }
    return DEFAULT_TEXTURE;
}

/** Paints every sample with the texture `role(k, steep)` names (a key of `textures`, each a `pick` list); `steep` is the
 *  sample's rise over MAX_RISE (1 and over: too steep to walk). */
function paint(area, library, textures, role) {
    const chosen = {};
    for (const [key, wanted] of Object.entries(textures)) chosen[key] = pick(library, wanted);
    area.palette = [];
    const index = {};
    for (const [key, id] of Object.entries(chosen)) index[key] = area.materialIndex(id);
    for (let k = 0; k < area.heights.length; k++) area.materials[k] = index[role(k, rise(area, k) / MAX_RISE)];
}

/** A deep winding canyon: a sandy floor between stepped red walls, the plateau above. The floor is `base`; it runs west to
 *  east and falls 2 m along the way. */
function canyon(area, base, rand, library) {
    const { nx, ny, heights: h } = area;
    const line = westToEast(area, rand, area.sizeY * 0.16, 1.3);
    const d = distanceToLine(area, line);
    const width = noise(area, rand() * 1e5, 60, 3),
        rim = noise(area, rand() * 1e5, 40, 3),
        floorMix = noise(area, rand() * 1e5, 12, 3);
    const depth = 16,
        wall = 7,
        steps = 3;
    for (let k = 0; k < nx * ny; k++) {
        // Half the floor's width: 6 to 11 m.
        const out = d[k] - (6 + 5 * width[k]);
        const floor = base + 2 * (1 - (k % nx) / (nx - 1)) + 0.3 * floorMix[k];
        if (out <= 0) {
            h[k] = floor;
            continue;
        }
        // Up the wall in steps, `steps` cliffs with steep slopes between them (still too steep to climb: a flat ledge would be a
        // walkable strip nobody can reach), then the plateau.
        const t = Math.min(1, out / wall) * steps,
            s = Math.floor(Math.min(t, steps - 1e-6));
        const up = 0.65 * (t / steps) + (0.35 * (s + smoothstep(0.15, 0.55, t - s))) / steps;
        h[k] = floor + depth * up + 5 * rim[k] * smoothstep(0, wall, out);
    }
    roughen(area, noise(area, rand() * 1e5, 6, 3), 1.2);
    paint(
        area,
        library,
        {
            sand: ['sandFine', 'sandSoft', ['Sand', 'fine', 'sand'], 'dirt'],
            gravel: ['gravelPebbles', 'gravelGrey', ['Earth', 'gravel', 'pebble'], ['Rock', 'pebble', 'cobble'], 'dirtBrown'],
            wall: ['canyonRock', 'rockRed', ['Rock', 'canyon', 'red'], 'rock'],
            ledge: ['earthCracked', 'dirtBrown', ['Earth', 'crack', 'parched', 'dry'], 'dirt'],
            top: ['grassDry', ['Grass', 'dry'], 'earthCracked', 'dirt'],
        },
        (k, steep) => {
            if (steep > 0.8) return 'wall';
            const above = h[k] - base - 2 * (1 - (k % nx) / (nx - 1));
            if (above < 0.5) return floorMix[k] > 0.62 ? 'gravel' : 'sand';
            return above > 14 ? 'top' : 'ledge';
        },
    );
}

/** A pass between two snowy massifs: a path from the west edge up to a saddle 10 m higher and down to the east, rock where the
 *  mountains are too steep to climb. The path's ends are at `base`. */
/** The width of the snowy pass's cliffs, metres. */
const CLIFF = 16;

function snowyPass(area, base, rand, library) {
    const { nx, ny, heights: h } = area;
    const line = westToEast(area, rand, area.sizeY * 0.1, 1.1);
    const d = distanceToLine(area, line);
    const peaks = noise(area, rand() * 1e5, 55, 2),
        mass = noise(area, rand() * 1e5, 90, 2),
        bay = noise(area, rand() * 1e5, 35, 2),
        drift = noise(area, rand() * 1e5, 18, 3);
    for (let k = 0; k < nx * ny; k++) {
        // (By how far east, not how far along the line: that jumps where two of its bends are equally near.)
        const path = base + 10 * Math.sin((Math.PI * (k % nx)) / (nx - 1));
        // The path is 7 m either side of its line, then a snowy shoulder 4 to 12 m wide, a cliff 30 to 46 m high and far too
        // steep to climb, and the mountains' tops (walkable ground nobody reaches, shaped gently so it doesn't break into pockets).
        const out = Math.max(0, d[k] - 7),
            foot = 4 + 8 * bay[k];
        // Rounded tops: a ridged noise's sharp creases would cut thin steep lines through them.
        const ridged = 1 - (2 * peaks[k] - 1) ** 2;
        // The cliff rises half straight, half eased, over 16 m: too steep to climb from its foot to its top. Over 26 m and eased
        // alone, a 30 m cliff was little steeper than walkable ground but in its middle, and the shoulder's wandering width
        // flattened ledges into it that the game can't path onto (the path check's blocked routes).
        const up = (out - foot) / CLIFF;
        h[k] =
            path +
            1.2 * smoothstep(0, foot, out) +
            (30 + 16 * mass[k]) * (0.5 * Math.min(1, Math.max(0, up)) + 0.5 * smoothstep(0, 1, up)) +
            8 * ridged * smoothstep(foot + CLIFF - 1, foot + CLIFF + 29, out) +
            0.6 * drift[k] * smoothstep(0, 6, out);
    }
    roughen(area, noise(area, rand() * 1e5, 8, 3), 1.5);
    paint(
        area,
        library,
        {
            path: ['snowPacked', 'snowFresh', ['Snow', 'pack', 'rock', 'snow'], 'gravelGrey'],
            snow: ['snowFresh', 'snowDrift', 'snowPacked', ['Snow', 'fresh', 'snow']],
            drift: ['snowDrift', 'snowFresh', 'snowPacked', ['Snow', 'drift', 'patch', 'snow']],
            rock: ['rockFrosted', 'winterRock', ['Snow', 'winter', 'rock'], ['Rock', 'grey', 'rock'], 'rockGrey'],
        },
        (k, steep) => {
            // Snow lies on the cliffs' gentler parts, as it would up to about 60 degrees; the steepest are bare rock.
            if (steep > 1.7) return 'rock';
            if (steep > 0.75) return 'drift';
            if (d[k] < 8) return 'path';
            return drift[k] > 0.6 ? 'drift' : 'snow';
        },
    );
}

/** Dunes the wind has piled from the west: long gentle backs and short steep faces in the lee, all walkable, troughs of
 *  softer sand between them. The troughs are at `base`. */
function dunes(area, base, rand, library) {
    const { nx, ny, heights: h } = area;
    const warp = noise(area, rand() * 1e5, 70, 3),
        size = noise(area, rand() * 1e5, 90, 3),
        swell = noise(area, rand() * 1e5, 120, 2),
        ripple = noise(area, rand() * 1e5, 9, 2);
    const wave = 55,
        bend = rand() * Math.PI * 2;
    const crest = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const k = j * nx + i,
                x = i * SPACING,
                y = j * SPACING;
            // How far through its dune a sample is, 0 to 1 downwind; the crest lines bend and wander.
            const u = (x + 22 * warp[k]) / wave + 0.35 * Math.sin(bend + y / 45);
            const p = u - Math.floor(u);
            // The back rises over two thirds of the dune, the lee face falls over the last third.
            const shape = p < 0.68 ? smoothstep(0, 0.68, p) : smoothstep(1, 0.68, p);
            crest[k] = shape;
            h[k] = base + (3 + 4 * size[k]) * shape + 3 * swell[k] + 0.25 * ripple[k];
        }
    }
    paint(
        area,
        library,
        {
            dune: ['sandDune', 'sandFine', 'sandSoft', ['Sand', 'dune', 'desert', 'sand']],
            trough: ['sandSoft', 'sandFine', 'sandDune', ['Sand', 'soft', 'sand']],
            face: ['sandFine', 'sandDune', 'sandSoft', ['Sand', 'fine', 'beach', 'sand']],
        },
        (k, steep) => {
            if (crest[k] < 0.18) return 'trough';
            return steep > 0.45 ? 'face' : 'dune';
        },
    );
}

/** A low valley ringed by wooded hills, with a lake in its hollow; the valley floor is `base`. Its body of water is filled
 *  30 cm under the lowest ground round the lake, so it stays in its hollow. The hills are lower in an area under 16 tiles
 *  across: they rise over a share of its width, and at full height an 8 by 8 area's ring was a cliff with gaps the game can't
 *  path through. */
function lakeValley(area, base, rand, library) {
    const { nx, ny, heights: h, sizeX, sizeY } = area;
    const hills = noise(area, rand() * 1e5, 55, 3),
        meadow = noise(area, rand() * 1e5, 30, 3),
        shore = noise(area, rand() * 1e5, 25, 3);
    // The lake: an ellipse a little off the middle, its shore wandering.
    const lx = sizeX * (0.42 + 0.16 * rand()),
        ly = sizeY * (0.42 + 0.16 * rand());
    const rx = sizeX * 0.2,
        ry = sizeY * 0.16,
        turn = rand() * Math.PI;
    const lake = new Float32Array(nx * ny);
    // The hills' height for the area's size: as steep as on 16 by 16 tiles, never steeper.
    const tall = Math.min(1, Math.min(sizeX, sizeY) / 160);
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const k = j * nx + i,
                x = i * SPACING,
                y = j * SPACING;
            // 0 in the middle of the area, 1 at the middle of an edge.
            const r = Math.hypot((x - sizeX / 2) / (sizeX / 2), (y - sizeY / 2) / (sizeY / 2)) + 0.12 * (hills[k] - 0.5);
            const ring = tall * (15 * smoothstep(0.5, 1.15, r) ** 1.5 + 5 * hills[k] * smoothstep(0.35, 0.9, r));
            const dx = x - lx,
                dy = y - ly;
            const a = (dx * Math.cos(turn) + dy * Math.sin(turn)) / rx,
                b = (-dx * Math.sin(turn) + dy * Math.cos(turn)) / ry;
            lake[k] = Math.hypot(a, b) / (0.85 + 0.3 * shore[k]);
            const dip = 3.2 * Math.max(0, 1 - lake[k] ** 2) ** 1.2;
            h[k] = base + 0.5 + meadow[k] + ring - dip;
        }
    }
    // The water's level: under the lowest ground in a ring round the lake, so the body never spills into the meadow.
    let rim = Infinity,
        deepest = 0;
    for (let k = 0; k < nx * ny; k++) {
        if (lake[k] >= 1 && lake[k] < 1.15) rim = Math.min(rim, h[k]);
        if (h[k] < h[deepest]) deepest = k;
    }
    const level = rim - 0.3;
    area.water = [{ i: deepest % nx, j: Math.floor(deepest / nx), level }];
    area.floodWater();
    paint(
        area,
        library,
        {
            bed: ['mudSwamp', 'sandSilt', 'dirtDark', ['Earth', 'mud', 'swamp', 'dark']],
            shore: ['sandSilt', 'sandFine', 'gravelMuddy', ['Sand', 'silt', 'beach', 'sand']],
            meadow: ['grassMeadow', 'grassBright', ['Grass', 'lush', 'meadow', 'bright'], 'grassMedium'],
            grass: ['grassMedium', 'grassBright', 'grassMeadow', ['Grass', 'medium', 'grass']],
            wood: ['grassForest', 'dirtForest', 'grassMoss', ['Earth', 'forest'], ['Grass', 'moss', 'dark']],
            rock: ['rockMossy', 'rock', 'rockGrey', ['Rock', 'moss', 'rock']],
        },
        (k, steep) => {
            if (steep > 0.8) return 'rock';
            if (h[k] < level) return 'bed';
            if (h[k] < level + 0.6) return 'shore';
            const up = h[k] - base;
            if (up > 7 * tall) return 'wood';
            return meadow[k] > 0.55 && up < 3 * tall ? 'meadow' : 'grass';
        },
    );
}

/** The sample landscapes, by the New area dialog's `start` value: their size in tiles (across, up), how they are shaped, their
 *  light and sky (a preset of atmosphere.js; `skyRow`, the game's row when the preset's own sky isn't installed, if not the
 *  preset's) and the area settings they change. */
export const TERRAIN_STARTERS = {
    canyon: { size: [16, 12], shape: canyon, light: 'golden', settings: { weather: { rain: 5, snow: 0, wind: 1 } } },
    'snowy-pass': { size: [16, 14], shape: snowyPass, light: 'overcast', skyRow: 4, settings: { weather: { rain: 0, snow: 60, wind: 2 } } },
    dunes: { size: [16, 16], shape: dunes, light: 'golden', settings: { weather: { rain: 0, snow: 0, wind: 1 } } },
    'lake-valley': { size: [16, 16], shape: lakeValley, light: 'clear', settings: { weather: { rain: 20, snow: 0, wind: 1 } } },
};

/** Shapes and paints new flat `area` as the sample landscape `starter` (a value of TERRAIN_STARTERS), from `base` metres up.
 *  `library`: the texture library (its `byId`); `seed` picks the landscape (a random one when not given). */
export function seedTerrain(area, starter, base, library, seed = Math.floor(Math.random() * 2 ** 31)) {
    let s = seed >>> 0;
    // Mulberry32, as noise.js uses: the same seed gives the same landscape.
    const rand = () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    starter.shape(area, base, rand, library);
    area.atmosphere = copyPreset(PRESETS.find(p => p.id === starter.light));
    // (a snowy pass under the game's winter sky, not its storm)
    if (starter.skyRow != null && area.atmosphere.skyRow != null) area.atmosphere.skyRow = starter.skyRow;
}

/** `settings` (an area's, from the project's template) with what `starter` changes in them. */
export function starterSettings(settings, starter) {
    const changes = starter.settings ?? {};
    return { ...settings, ...changes, weather: { ...(settings.weather ?? {}), ...(changes.weather ?? {}) } };
}
