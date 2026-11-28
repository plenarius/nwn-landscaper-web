// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// File → Open a showcase (showcase.js): the list beside the page, and a copy of one under a free name that never replaces an
// area of the builder's.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { engine, clearStorage } from './browser.js';

const { Area } = await import('../js/area.js');
const save = await import('../js/save.js');
const { copyShowcase, showcaseList, sizeLine } = await import('../js/showcase.js');

save.initSave({ area: () => null, me: () => ({ team: false, user: 'local' }), readOnly: () => false, open: () => {} });

/** A showcase area as the engine's docs/assets/showcase/areas keeps one. */
function showcaseArea(name) {
    const a = Area.create(name, 3, 'hills');
    a.module = 'lsshow';
    a.settings = { tag: name, name: 'Showcase' };
    return a.toJSON();
}
const LIST = [
    { title: 'A forest stream', text: 'Along a stream.', still: 'forest.webp', clip: 'clips/forest.mp4', area: 'areas/lsforest.json' },
    { title: 'Clip to come', text: 'No area yet.' },
];
const FILE = showcaseArea('lsforest');

beforeEach(async () => {
    engine.reset();
    clearStorage();
    await save.loadCopies();
    engine.routes.set('GET /showcase/index.json', () => [LIST]);
    engine.routes.set('GET /showcase/areas/lsforest.json', () => [FILE]);
});
afterEach(() => save.flushSave());

/** An area of the builder's called `name`, saved on the engine. */
async function mine(name) {
    const a = Area.create(name, 3, 'flat');
    assert.equal(await save.saveNew(a, false), true);
    return engine.areas.get(name);
}

test('the list is the showcase entries that have an area', async () => {
    assert.deepEqual(
        (await showcaseList()).map(e => e.title),
        ['A forest stream'],
    );
});

test('a copy of the editor without the showcase says so', async () => {
    engine.routes.clear();
    await assert.rejects(showcaseList(), /no showcase/);
});

test('a showcase opens under its own name when it is free, as an area of its own', async () => {
    const a = await copyShowcase(LIST[0]);
    assert.equal(a.name, 'lsforest');
    const saved = JSON.parse(engine.areas.get('lsforest'));
    assert.equal(saved.module, 'lsforest', 'its own module, as New area gives');
    assert.equal(saved.settings.tag, 'lsforest');
    assert.notEqual(saved.created, FILE.created, 'a new area, not the showcase file');
    assert.deepEqual(saved.heights, FILE.heights);
});

test('a showcase never replaces an area: it takes the next free name', async () => {
    const before = await mine('lsforest');
    const before2 = await mine('lsforest2');
    const a = await copyShowcase(LIST[0]);
    assert.equal(a.name, 'lsforest3');
    assert.equal(JSON.parse(engine.areas.get('lsforest3')).settings.tag, 'lsforest3');
    assert.equal(engine.areas.get('lsforest'), before);
    assert.equal(engine.areas.get('lsforest2'), before2);
    assert.ok(!engine.log.some(l => l.includes('replace=1')), 'no save asked to replace');
    // And again: another copy beside the first.
    assert.equal((await copyShowcase(LIST[0])).name, 'lsforest4');
});

test('a name taken after the list was read is refused by the engine and skipped, and the area that has it is kept', async () => {
    const theirs = JSON.stringify(Area.create('lsforest', 3, 'flat').toJSON());
    engine.saveDelay = 30;
    const copying = copyShowcase(LIST[0]);
    // (another tab makes lsforest while this page's save of it is on its way)
    while (!engine.log.some(l => l.includes('/api/save'))) await new Promise(r => setTimeout(r, 1));
    engine.areas.set('lsforest', theirs);
    assert.equal((await copying).name, 'lsforest2');
    assert.equal(engine.areas.get('lsforest'), theirs);
});

test("a card's size line: tiles and metres, the hak as the editor counts sizes, and the baked objects; none unmeasured", () => {
    assert.equal(
        sizeLine({ tiles: [16, 12], hak_bytes: 476 * 1024 * 1024, baked: 4896 }),
        '16 × 12 tiles (160 × 120 m) · 476 MB hak · 4,896 baked objects',
    );
    assert.equal(sizeLine({ tiles: [12, 10] }), '12 × 10 tiles (120 × 100 m)');
    assert.equal(sizeLine(LIST[0]), '');
});
