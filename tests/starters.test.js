// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The sample landscapes (starters.js): each can be walked where a builder expects, paints only textures the library has, and
// the lake's water stays in its hollow.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './importmap.js';

const { Area } = await import('../js/area.js');
const { TERRAIN_STARTERS, seedTerrain, starterSettings } = await import('../js/starters.js');
const { setInstalledSkies } = await import('../js/atmosphere.js');

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

// A team library that names its textures its own way (like the Layonara forge's): no starter library ids for sand or snow.
const TEAM = [
    ['grassMedium', 'Grass', 'Grass'],
    ['grassDry', 'Dry grass', 'Grass'],
    ['grassMossy', 'Mossy grass', 'Grass'],
    ['dirt', 'Dirt', 'Earth'],
    ['forestGround', 'Forest floor', 'Earth'],
    ['mud', 'Swamp mud', 'Earth'],
    ['cracked', 'Cracked earth', 'Earth'],
    ['gravelSandy', 'Sandy gravel', 'Earth'],
    ['rock', 'Rock', 'Rock'],
    ['canyonRock', 'Red canyon rock', 'Rock'],
    ['sand', 'Sand', 'Sand'],
    ['beach', 'Beach', 'Sand'],
    ['desertSand', 'Desert sand', 'Sand'],
    ['snow', 'Snow', 'Snow'],
    ['patchySnow', 'Patchy snow', 'Snow'],
    ['rockSnow', 'Rocks in snow', 'Snow'],
    ['winterRock', 'Winter rock', 'Snow'],
].map(([id, name, category]) => ({ id, name, category }));

test("a team library's own textures stand in by category: snow stays snow, sand stays sand", () => {
    const team = { catalog: TEAM, byId: new Map(TEAM.map(t => [t.id, t])) };
    const category = id => team.byId.get(id)?.category;
    const paletteOf = id => {
        const a = Area.create('aa', 16, 'flat', 5);
        seedTerrain(a, TERRAIN_STARTERS[id], 5, team, 3);
        return a.palette;
    };
    const pass = paletteOf('snowy-pass');
    assert.ok(
        pass.every(t => category(t) === 'Snow'),
        pass.join(),
    );
    assert.ok(pass.includes('snow') && pass.includes('patchySnow'), pass.join());
    assert.ok(paletteOf('dunes').every(t => category(t) === 'Sand'));
    const lake = paletteOf('lake-valley');
    assert.ok(lake.includes('mud') && lake.includes('beach') && lake.includes('forestGround'), lake.join());
    const canyon = paletteOf('canyon');
    assert.ok(canyon.includes('canyonRock') && canyon.includes('gravelSandy') && canyon.includes('sand'), canyon.join());
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

/** The sizes, in samples, of the 4-connected pieces of ground that can be walked (`walk`) or can't. */
function pieces(a, walk) {
    const { nx, ny } = a,
        seen = new Uint8Array(nx * ny),
        out = [];
    const is = k => a.walkable(k % nx, Math.floor(k / nx)) === walk;
    for (let start = 0; start < nx * ny; start++) {
        if (seen[start] || !is(start)) continue;
        let n = 0;
        const stack = [start];
        seen[start] = 1;
        while (stack.length) {
            const k = stack.pop(),
                i = k % nx,
                j = (k - i) / nx;
            n++;
            for (const q of [i > 0 && k - 1, i < nx - 1 && k + 1, j > 0 && k - nx, j < ny - 1 && k + nx])
                if (q !== false && !seen[q] && is(q)) {
                    seen[q] = 1;
                    stack.push(q);
                }
        }
        out.push(n);
    }
    return out;
}

test("the pass's cliffs have no ledges: the game can't path onto one", () => {
    for (const seed of SEEDS) {
        const a = make('snowy-pass', seed);
        // A piece of walkable ground over 40 m² but far smaller than the path or the tops is a ledge in a cliff.
        const ledges = pieces(a, true).filter(n => n >= 100 && n < 1500);
        assert.deepEqual(ledges, [], `pass ${seed}`);
    }
});

test('rough hills have no specks of ground too steep to walk, only steep slopes', () => {
    const random = Math.random;
    for (const seed of SEEDS) {
        // Rough hills take their noise's seed from Math.random: the same each run here.
        Math.random = () => seed / 10;
        const a = Area.create('aa', 8, 'rough', 5);
        Math.random = random;
        const specks = pieces(a, false).filter(n => n < 40);
        assert.ok(specks.length < 5, `rough ${seed}: ${specks.length} specks`);
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

test("the valley's hills can be walked at any size: a small area gets lower hills, not a cliff", () => {
    for (const tiles of [4, 8, 12, 16]) {
        for (const seed of SEEDS) {
            const a = Area.create('aa', tiles, 'flat', 5);
            seedTerrain(a, TERRAIN_STARTERS['lake-valley'], 5, library, seed);
            const dry = share(a, (i, j) => !(a.depth(i, j) > 0)),
                steep = share(a, (i, j) => !(a.depth(i, j) > 0) && !a.walkable(i, j));
            assert.ok(steep / dry < 0.002, `${tiles}x${tiles} lake ${seed}: ${steep / dry}`);
        }
    }
});

test("a sample landscape's settings change only the weather it names", () => {
    const template = { tag: 'aa', skyBox: 0, weather: { rain: 40, snow: 0, lightning: 5, wind: 0 }, music: { day: 3 } };
    const s = starterSettings(template, TERRAIN_STARTERS['snowy-pass']);
    assert.deepEqual(s, { tag: 'aa', skyBox: 0, weather: { rain: 0, snow: 60, lightning: 5, wind: 2 }, music: { day: 3 } });
    assert.equal(template.weather.rain, 40);
});

test("a sample landscape's sky is its preset's: the pack's when installed, else the game's nearest row", () => {
    const skies = (id, seed = 1) => {
        const a = Area.create('aa', 6, 'flat', 5);
        seedTerrain(a, TERRAIN_STARTERS[id], 5, library, seed);
        return [a.atmosphere.sky, a.atmosphere.skyRow];
    };
    setInstalledSkies([]);
    assert.deepEqual(skies('canyon'), [undefined, 3]);
    assert.deepEqual(skies('dunes'), [undefined, 3]);
    assert.deepEqual(skies('lake-valley'), [undefined, 1]);
    // Overcast's own row is the storm's: the pass keeps the winter sky.
    assert.deepEqual(skies('snowy-pass'), [undefined, 4]);
    setInstalledSkies([
        { id: 'golden-haze', name: 'Golden haze', preset: 'golden' },
        { id: 'overcast', name: 'Overcast', preset: 'overcast' },
    ]);
    assert.deepEqual(skies('canyon'), ['golden-haze', undefined]);
    assert.deepEqual(skies('snowy-pass'), ['overcast', undefined]);
    // Clear day's sky is the game's own.
    assert.deepEqual(skies('lake-valley'), [undefined, 1]);
    setInstalledSkies([]);
});
