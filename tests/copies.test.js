// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The copies kept in this browser after a failed save (copies.js, through save.js): in IndexedDB, moved there once from
// localStorage, in localStorage where IndexedDB can't be opened, and nowhere, without breaking the page, where storage is
// blocked or full.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { engine, clearStorage, status, idb, blockStorage, limitStorage } from './browser.js';
import { questions } from './stubs/ask.js';

const { Area } = await import('../js/area.js');
const save = await import('../js/save.js');

let open = null;
save.initSave({ area: () => open, me: () => ({ team: false, user: 'local' }), readOnly: () => false, open: () => {} });

/** A new area called `name` (`tiles` a side), saved once, and open. */
async function made(name, tiles = 3) {
    const a = Area.create(name, tiles, 'flat');
    open = a;
    assert.equal(await save.saveNew(a, false), true);
    return a;
}

/** A change of `a` whose save fails: kept in this browser. */
async function failedSave(a, preset = 'golden') {
    engine.failSaves = true;
    a.atmosphere.preset = preset;
    save.saveSoon();
    await save.flushSave();
    engine.failSaves = false;
}

/** What IndexedDB holds of the copies, by key. */
const inIdb = () => idb.databases.get('landscaper')?.stores.get('copies') ?? new Map();
/** localStorage's keys of copies, as the page kept them before IndexedDB. */
const inLs = () => Object.keys(localStorage).filter(k => /^landscaper\.(area|base|version)\./.test(k));

beforeEach(async () => {
    engine.reset();
    clearStorage();
    questions.asked = [];
    questions.answers = [];
    await save.loadCopies();
});
afterEach(() => save.flushSave());

test('a failed save keeps the area in IndexedDB, not localStorage, and the next start reads it back', async () => {
    const a = await made('aa');
    await failedSave(a);
    assert.match(status(), /kept in this browser/);
    assert.deepEqual([...inIdb().keys()], ['aa']);
    assert.equal(JSON.parse(inIdb().get('aa').json).atmosphere.preset, 'golden');
    assert.deepEqual(inLs(), []);
    // The next start: read afresh from IndexedDB.
    await save.loadCopies();
    assert.deepEqual(save.browserCopies(), ['aa']);
    assert.equal(save.openCopy('aa').atmosphere.preset, 'golden');
    // A later save that works drops it.
    open = a;
    save.saveSoon();
    await save.flushSave();
    assert.equal(save.browserCopy('aa'), null);
    await new Promise(r => setTimeout(r, 5));
    assert.equal(inIdb().size, 0);
});

test("an area larger than localStorage's limit is kept", async () => {
    // (32×32 tiles: about 2 MB of JSON; localStorage held 1 MB here, a browser's holds 5 to 10)
    limitStorage(1_000_000);
    const a = await made('big', 32);
    await failedSave(a);
    assert.match(status(), /kept in this browser/);
    assert.ok(inIdb().get('big').json.length > 1_000_000);
});

test('a copy localStorage kept before IndexedDB moves into IndexedDB once, with what it started from', async () => {
    const a = await made('aa');
    const version = engine.version('aa');
    a.atmosphere.preset = 'night';
    localStorage.setItem('landscaper.area.aa', JSON.stringify(a.toJSON()));
    localStorage.setItem('landscaper.base.aa', String(engine.saved.get('aa')));
    localStorage.setItem('landscaper.version.aa', version);
    localStorage.setItem('landscaper.live', 'off');
    await save.loadCopies();
    assert.deepEqual(inLs(), []);
    assert.deepEqual(inIdb().get('aa'), { json: JSON.stringify(a.toJSON()), base: engine.saved.get('aa'), version });
    // (the other settings stay where they are)
    assert.equal(localStorage.getItem('landscaper.live'), 'off');
    await save.loadCopies();
    assert.deepEqual(save.browserCopies(), ['aa']);
    // It goes to the engine as any copy does, with the version it started from: no question.
    await save.moveBrowserAreas();
    assert.deepEqual(questions.asked, []);
    assert.equal(JSON.parse(engine.areas.get('aa')).atmosphere.preset, 'night');
    assert.ok(engine.log.some(l => l.startsWith('PUT') && l.includes(`base=${version}`)));
    assert.equal(save.browserCopy('aa'), null);
});

test("a copy in localStorage isn't moved over one IndexedDB already holds, and isn't lost", async () => {
    const a = await made('aa');
    await failedSave(a, 'golden');
    localStorage.setItem('landscaper.area.aa', JSON.stringify({ ...a.toJSON(), atmosphere: { preset: 'old' } }));
    await save.loadCopies();
    assert.equal(JSON.parse(save.browserCopy('aa')).atmosphere.preset, 'golden');
    assert.ok(localStorage.getItem('landscaper.area.aa'));
});

test("where IndexedDB can't be opened the copy goes to localStorage, as before", async () => {
    idb.failOpen = true;
    await save.loadCopies();
    const a = await made('aa');
    await failedSave(a);
    assert.match(status(), /kept in this browser/);
    assert.ok(localStorage.getItem('landscaper.area.aa'));
    assert.equal(inIdb().size, 0);
    await save.loadCopies();
    assert.equal(JSON.parse(save.browserCopy('aa')).atmosphere.preset, 'golden');
});

test('with storage blocked the page goes on and says the change is kept nowhere', async () => {
    blockStorage();
    await save.loadCopies();
    assert.deepEqual(save.browserCopies(), []);
    const a = await made('aa');
    await failedSave(a);
    assert.match(status(), /Couldn't save aa anywhere/);
    assert.equal(save.browserCopy('aa'), null);
    // The next save that works goes as usual.
    open = a;
    save.saveSoon();
    await save.flushSave();
    assert.equal(JSON.parse(engine.areas.get('aa')).atmosphere.preset, 'golden');
});

test('a copy that no longer fits says so, and the copy before it stays', async () => {
    const a = await made('aa');
    await failedSave(a, 'golden');
    idb.quota = inIdb().get('aa').json.length + 1000;
    a.things.push({ id: 1, kind: 'waypoint', x: 1, y: 1, name: 'x'.repeat(5000) });
    await failedSave(a, 'night');
    assert.match(status(), /Couldn't save aa anywhere/);
    assert.equal(JSON.parse(save.browserCopy('aa')).atmosphere.preset, 'golden');
    assert.equal(JSON.parse(inIdb().get('aa').json).atmosphere.preset, 'golden');
});
