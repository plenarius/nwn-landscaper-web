// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The sky a preset gives an area (atmosphere.js), what the Sky & fog panel shows of it (sky.js), and what an export sends.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './browser.js';

const { PRESETS, WATER_LOOKS, copyPreset, presetSky, setInstalledSkies, installedSkies, waterLook, waterView } = await import(
    '../js/atmosphere.js'
);
const { chosenSky, skyPicture } = await import('../js/sky.js');
const { Area } = await import('../js/area.js');

/** The Preset skies pack's seven, as /api/skies lists them. */
const PRESET_SKIES = [
    ['golden-haze', 'golden'],
    ['dusk', 'dusk'],
    ['overcast', 'overcast'],
    ['starry-night', 'night'],
    ['dawn-haze', 'dawn'],
    ['thick-mist', 'mist'],
    ['swamp', 'swamp'],
].map(([id, preset]) => ({ id, name: id, preset, pack: 'preset-skies', row: 32 }));

test('every preset outdoors names a sky of the Preset skies pack, or the game row it falls back to', () => {
    const outdoors = PRESETS.filter(p => !['cave', 'torchlit', 'indoors'].includes(p.id));
    for (const p of outdoors) assert.ok(Number.isInteger(p.skyRow) && p.skyRow > 0 && p.skyRow < 7, p.id);
    // Each pack sky's preset exists, and names that sky: Dawn haze's too (the preset made for it).
    for (const s of PRESET_SKIES) assert.equal(PRESETS.find(p => p.id === s.preset)?.sky, s.id, s.id);
    for (const p of PRESETS.filter(q => !outdoors.includes(q))) assert.deepEqual(presetSky(p), {}, p.id);
});

test('a preset gives its own sky when installed, another made for it next, else the game row', () => {
    const dusk = PRESETS.find(p => p.id === 'dusk');
    setInstalledSkies([]);
    assert.deepEqual(presetSky(dusk), { skyRow: 1 });
    assert.equal(copyPreset(dusk).sky, undefined);
    setInstalledSkies([{ id: 'red-evening', name: 'Red evening', preset: 'dusk' }, null, { name: 'no id' }]);
    assert.equal(installedSkies.length, 1, 'entries without an id are left out');
    assert.deepEqual(presetSky(dusk), { sky: 'red-evening' });
    setInstalledSkies(PRESET_SKIES);
    const a = copyPreset(dusk);
    assert.equal(a.sky, 'dusk');
    assert.equal(a.skyRow, undefined);
    // Clear day's sky is the game's own.
    assert.deepEqual(presetSky(PRESETS.find(p => p.id === 'clear')), { skyRow: 1 });
    setInstalledSkies([]);
});

test('the panel shows the Landscaper sky, else the game row, else what the area keeps', () => {
    const a = Area.create('aa', 3, 'flat', 5);
    a.atmosphere = { ...a.atmosphere, sky: 'dusk', skyRow: 4 };
    assert.deepEqual(chosenSky(a), { sky: 'dusk' });
    assert.equal(skyPicture(chosenSky(a), false, 'strip'), '/api/sky-picture/dusk?time=day&kind=strip');
    delete a.atmosphere.sky;
    assert.deepEqual(chosenSky(a), { row: 4 });
    assert.equal(skyPicture(chosenSky(a), true, 'panorama'), '/api/sky-picture/row-4?time=night&kind=panorama');
    // An area from before skies were chosen here: its settings' row, else its original's.
    delete a.atmosphere.skyRow;
    a.settings = { skyBox: 3 };
    assert.deepEqual(chosenSky(a), { kept: 3 });
    assert.equal(skyPicture(chosenSky(a), false, 'strip'), '/api/sky-picture/row-3?time=day&kind=strip');
    a.settings = null;
    assert.deepEqual(chosenSky(a), { kept: null });
    assert.equal(skyPicture(chosenSky(a), false, 'strip'), null);
});

test("the area's sky survives saving and undo", () => {
    const a = Area.create('aa', 3, 'flat', 5);
    assert.equal(a.atmosphere.skyRow, 1, "a new area's: Clear day's");
    a.atmosphere.sky = 'swamp';
    delete a.atmosphere.skyRow;
    const back = Area.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    assert.equal(back.atmosphere.sky, 'swamp');
    a.beginStroke();
    delete a.atmosphere.sky;
    a.atmosphere.skyRow = 2;
    a.undo();
    assert.equal(a.atmosphere.sky, 'swamp');
    assert.equal(a.atmosphere.skyRow, undefined);
});

const { workShare, WORK_FLOOR } = await import('../js/atmosphere.js');

test("the view keeps some working light under an area's light only when it is too dark to work in", () => {
    for (const p of PRESETS) {
        assert.equal(workShare(p.sun), 0, `${p.id} by day`);
        assert.ok(workShare(p.moon) <= 0.15, `${p.id} by night keeps its look`);
    }
    // The showcase's cave by night: its torchlit halls were a black screen.
    const cave = workShare({ ambient: '#120c08', diffuse: '#2a1e14' });
    assert.ok(cave > 0.3 && cave < 0.6, String(cave));
    assert.equal(workShare({ ambient: '#000000', diffuse: '#000000' }), 1);
    assert.equal(workShare({ ambient: '#ffffff', diffuse: '#ffffff' }), 0);
    assert.equal(workShare({ ambient: 'nonsense', diffuse: '#000000' }), 1, 'an unreadable colour counts as black');
    assert.ok(WORK_FLOOR > 0 && WORK_FLOOR < 1);
});

test("the swamp's water is murky, every other preset's clear, and an area saved without a look keeps today's water", () => {
    for (const p of PRESETS) assert.equal(waterLook(copyPreset(p)).id, p.id === 'swamp' ? 'murky' : 'clear', p.id);
    const swamp = copyPreset(PRESETS.find(p => p.id === 'swamp'));
    assert.deepEqual(swamp.water, { texture: 'trm02_water01', tint: '#a09880' });
    // (a copy: changing the area's leaves the look alone)
    swamp.water.tint = '#000000';
    assert.equal(WATER_LOOKS.find(l => l.id === 'murky').water.tint, '#a09880');
    assert.equal(waterLook(swamp), null);
    assert.equal(waterView(swamp), WATER_LOOKS.find(l => l.id === 'murky').view);
    // An area from before looks: no `water`, drawn and exported as before.
    const old = { preset: 'swamp', time: 'cycle', fogClip: 150 };
    assert.equal(waterLook(old).id, 'clear');
    assert.deepEqual(waterView(old), { color: 0x2c6a86, opacity: 0.62 });
});
