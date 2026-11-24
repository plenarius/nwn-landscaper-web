// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The sample landscapes (starters.js): each can be walked where a builder expects, paints only textures the library has, and
// the lake's water stays in its hollow.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './importmap.js';

const { Area } = await import('../js/area.js');
const { TERRAIN_STARTERS, seedTerrain, starterSettings } = await import('../js/starters.js');

// The engine's starter library (its src/starter_textures.json): what every install builds from the game's files.
const STOCK = [
    'grassMedium',
    'grassBright',
    'grassMeadow',
    'grassMoss',
    'grassForest',
    'grassSwamp',
    'grassDry',
    'dirt',
    'dirtDark',
    'dirtBrown',
    'dirtForest',
    'mudSwamp',
    'mudCracked',
    'earthCracked',
    'gravelPebbles',
    'gravelGrey',
    'gravelMuddy',
    'sandFine',
    'sandSoft',
    'sandDune',
    'sandSilt',
    'rock',
    'rockCliff',
    'swampRock',
    'canyonRock',
    'winterRock',
    'rockGrey',
    'rockRed',
    'rockPale',
    'rockMossy',
    'rockCave',
    'rockSlate',
    'rockBrown',
    'rockFrosted',
    'snowFresh',
    'snowPacked',
    'snowDrift',
    'iceFloor',
    'floorBrick',
    'floorFlag',
    'floorStone',
    'floorCobble',
    'floorSlabs',
    'floorPlank',
    'woodOld',
    'wallFieldstone',
    'wallMossy',
    'wallField',
    'wallWeathered',
    'wallDark',
    'wallWood',
];
const library = { byId: new Map(STOCK.map(id => [id, {}])) };

/** Area `id` made as the New area dialog makes it, from seed `seed`. */
function make(id, seed) {
    const starter = TERRAIN_STARTERS[id];
    const a = Area.create('aa', starter.size[0], 'flat', 5, starter.size[1]);
    seedTerrain(a, starter, 5, library, seed);
    return a;
}

/** Whether walkable ground joins the west edge to the east edge (4-connected samples). */
function crossable(a) {
    const { nx, ny } = a,
        seen = new Uint8Array(nx * ny),
        stack = [];
    for (let j = 0; j < ny; j++) if (a.walkable(0, j)) stack.push(j * nx);
    while (stack.length) {
        const k = stack.pop(),
            i = k % nx,
            j = (k - i) / nx;
        if (seen[k] || !a.walkable(i, j)) continue;
        if (i === nx - 1) return true;
        seen[k] = 1;
        if (i > 0) stack.push(k - 1);
        if (i < nx - 1) stack.push(k + 1);
        if (j > 0) stack.push(k - nx);
        if (j < ny - 1) stack.push(k + nx);
    }
    return false;
}

const share = (a, f) => {
    let n = 0;
    for (let j = 0; j < a.ny; j++) for (let i = 0; i < a.nx; i++) if (f(i, j)) n++;
    return n / (a.nx * a.ny);
};

const SEEDS = [1, 2, 3, 4, 5, 6];

test('every sample landscape has finite heights and paints only textures the library has', () => {
    for (const id of Object.keys(TERRAIN_STARTERS)) {
        const a = make(id, 7);
        assert.ok(a.heights.every(Number.isFinite), id);
        assert.ok(
            a.palette.every(t => library.byId.has(t)),
            `${id}: ${a.palette}`,
        );
        assert.ok(
            a.materials.every(m => m < a.palette.length),
            id,
        );
        assert.equal(a.atmosphere.preset, TERRAIN_STARTERS[id].light, id);
    }
});

test('a library without the stock textures falls back to the default texture', () => {
    const a = Area.create('aa', 6, 'flat', 5);
    seedTerrain(a, TERRAIN_STARTERS.canyon, 5, { byId: new Map() }, 1);
    assert.deepEqual(a.palette, ['grassMedium']);
});

test('the same seed makes the same landscape', () => {
    assert.deepEqual(make('dunes', 9).heights, make('dunes', 9).heights);
    assert.notDeepEqual(make('dunes', 9).heights, make('dunes', 10).heights);
});

test('the canyon floor and the mountain pass can be walked from the west edge to the east', () => {
    for (const seed of SEEDS) {
        assert.ok(crossable(make('canyon', seed)), `canyon ${seed}`);
        assert.ok(crossable(make('snowy-pass', seed)), `pass ${seed}`);
    }
});

test('the canyon has walls too steep to climb, and the pass has rock', () => {
    const a = make('canyon', 3);
    assert.ok(share(a, (i, j) => !a.walkable(i, j)) > 0.05);
    const p = make('snowy-pass', 3);
    assert.ok(p.palette.includes('rockFrosted'));
});

test('the dunes can be walked almost everywhere', () => {
    for (const seed of SEEDS) {
        const a = make('dunes', seed);
        assert.ok(share(a, (i, j) => a.walkable(i, j)) > 0.97, `dunes ${seed}`);
    }
});

test("the valley's lake fills its hollow and stays off the area's edges", () => {
    for (const seed of SEEDS) {
        const a = make('lake-valley', seed);
        assert.equal(a.water.length, 1);
        const wet = share(a, (i, j) => a.depth(i, j) > 0);
        assert.ok(wet > 0.03 && wet < 0.25, `lake ${seed}: ${wet}`);
        for (let i = 0; i < a.nx; i++) assert.ok(!(a.depth(i, 0) > 0) && !(a.depth(i, a.ny - 1) > 0), `lake ${seed}`);
        for (let j = 0; j < a.ny; j++) assert.ok(!(a.depth(0, j) > 0) && !(a.depth(a.nx - 1, j) > 0), `lake ${seed}`);
        // Its water level survives the JSON round trip, as the save keeps it.
        const back = Area.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
        assert.deepEqual(back.water, a.water);
    }
});

test("a sample landscape's settings change only the sky box and the weather it names", () => {
    const template = { tag: 'aa', skyBox: 0, weather: { rain: 40, snow: 0, lightning: 5, wind: 0 }, music: { day: 3 } };
    const s = starterSettings(template, TERRAIN_STARTERS['snowy-pass']);
    assert.deepEqual(s, { tag: 'aa', skyBox: 4, weather: { rain: 0, snow: 60, lightning: 5, wind: 2 }, music: { day: 3 } });
    assert.equal(template.skyBox, 0);
});
