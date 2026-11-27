// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Textures an area is painted with that the library hasn't got (missing.js): which, how much ground each covers, what the notice
// and a refused export say, what each is swapped for, that a swap is one step of undo, and the checker they show as (textures.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './importmap.js';

const { missingTextures, shareText, missingMessage, guessCategory, suggestSwap, swapped } = await import('../js/missing.js');
const { Area } = await import('../js/area.js');
const { missingLayer } = await import('../js/textures.js');

const catalog = [
    { id: 'grassMedium', name: 'Medium grass', category: 'Grass', original: 'game:tcm02_grass01' },
    { id: 'sandSoft', name: 'Soft sand', category: 'Sand', original: 'game:tde01_sand01' },
    { id: 'teamSand', name: 'Team sand', category: 'Sand', original: 'game:ttz01_sand01' },
    { id: 'rock', name: 'Rock', category: 'Rock', original: 'game:tdm01_rock01' },
];
const starters = [
    { id: 'sandFine', name: 'Sand', category: 'Sand', resref: 'ttz01_sand01' },
    { id: 'snowPacked', name: 'Packed snow', category: 'Snow', resref: 'tic01_snow02' },
];
const has = id => catalog.some(t => t.id === id);

test('the missing textures are found once each, with the share of the ground each covers', () => {
    // 10 samples: 6 grass, 3 sandFine, 1 sandFine again under a second palette entry; an import's ground and an unpainted entry.
    const palette = ['grassMedium', 'sandFine', '@import:bay', 'sandFine', 'rockRed'];
    const materials = Uint8Array.from([0, 0, 0, 0, 0, 0, 1, 1, 1, 3]);
    assert.deepEqual(missingTextures(palette, materials, has), [
        { id: 'sandFine', share: 0.4 },
        { id: 'rockRed', share: 0 },
    ]);
    assert.deepEqual(missingTextures(['grassMedium'], Uint8Array.from([0, 0]), has), []);
});

test('the notice says which textures are missing, how much ground each covers, and how they show', () => {
    assert.equal(shareText(0), 'not on the ground');
    assert.equal(shareText(0.004), 'under 1%');
    assert.equal(shareText(0.294), '29%');
    assert.equal(
        missingMessage([
            { id: 'sandFine', share: 0.294 },
            { id: 'rockRed', share: 0 },
        ]),
        "This area is painted with 2 textures the texture library doesn't have: sandFine (29% of the ground), rockRed (not on the ground). " +
            "They show as a magenta checker, and the area won't export until they are added or swapped for others.",
    );
    assert.match(
        missingMessage([{ id: 'teamMoss', share: 0.04 }]),
        /with 1 texture .*: teamMoss \(4% of the ground\)\. It shows .* until it is added/,
    );
});

test('a swap suggests the same game texture first, then the same category, then the default ground', () => {
    assert.deepEqual(suggestSwap('sandFine', catalog, starters), { id: 'teamSand', why: 'the same game texture, ttz01_sand01' });
    // (an engine without the starter list: the id's own words)
    assert.deepEqual(suggestSwap('sandFine', catalog), { id: 'sandSoft', why: 'also Sand' });
    assert.deepEqual(suggestSwap('rockRed', catalog), { id: 'rock', why: 'also Rock' });
    assert.deepEqual(suggestSwap('snowPacked', catalog, starters), { id: 'grassMedium', why: 'nothing closer in this library' });
    assert.deepEqual(suggestSwap('teamMoss', [catalog[3]]), { id: 'rock', why: 'nothing closer in this library' });
    assert.equal(suggestSwap('teamMoss', []), null);
    assert.equal(guessCategory('rockFrosted'), 'Rock');
    assert.equal(guessCategory('iceFloor'), 'Snow');
    assert.equal(guessCategory('gravelPebbles'), 'Earth');
    assert.equal(guessCategory('teamMoss'), null);
});

test('a swap renames the texture its samples paint with, and undo takes it back as one step', () => {
    assert.deepEqual(swapped(['a', 'b', 'a'], 'a', 'c'), ['c', 'b', 'c']);
    const a = Area.create('mt', 2, 'flat', 5);
    const k = a.materialIndex('sandFine');
    a.materials.fill(k, 0, 40);
    a.beginStroke();
    a.palette = swapped(a.palette, 'sandFine', 'teamSand');
    assert.equal(a.textureAt(0, 0), 'teamSand');
    assert.ok(a.undo());
    assert.deepEqual(a.palette, ['grassMedium', 'sandFine']);
    assert.equal(a.textureAt(0, 0), 'sandFine');
    assert.ok(a.redo());
    assert.deepEqual(a.palette, ['grassMedium', 'teamSand']);
});

test('a missing texture is a magenta and black checker, never grey', () => {
    const px = missingLayer();
    assert.equal(px.length, 512 * 512 * 4);
    assert.deepEqual([...px.subarray(0, 4)], [255, 0, 255, 255]);
    // (the next square over, 128 px on)
    assert.deepEqual([...px.subarray(128 * 4, 128 * 4 + 4)], [20, 0, 20, 255]);
    assert.ok(!px.every((v, i) => i % 4 === 3 || v === 128));
});
