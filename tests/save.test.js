// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The save queue (save.js): autosave in order, opening an area after its saves, the copies kept in this browser, and the
// engine's refusal of an area made again elsewhere.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { engine, clearStorage, status, otherTab } from './browser.js';
import { questions } from './stubs/ask.js';

const { Area } = await import('../js/area.js');
const save = await import('../js/save.js');
const { viewing } = await import('../js/api.js');

// What app.js gives save.js: the area open, who is signed in, read-only or not, and Open.
let open = null;
let me = { team: false, user: 'local' };
let readOnly = false;
const opened = [];
save.initSave({ area: () => open, me: () => me, readOnly: () => readOnly, open: name => opened.push(name) });

/** A new area called `name` on the engine, as New makes it (saved once), and open. */
async function made(name) {
    const a = Area.create(name, 3, 'flat');
    open = a;
    assert.equal(await save.saveNew(a, false), true);
    return a;
}

/** The sky preset of area `name` as the engine has it. */
const engineSky = name => JSON.parse(engine.areas.get(name)).atmosphere.preset;

beforeEach(() => {
    engine.reset();
    clearStorage();
    questions.asked = [];
    questions.answers = [];
    opened.length = 0;
    me = { team: false, user: 'local' };
    readOnly = false;
    viewing.user = null;
});
afterEach(() => save.flushSave());

test('an area opened again while its change is on its way comes back with that change', async () => {
    const a = await made('aa');
    engine.saveDelay = 30;
    a.atmosphere.preset = 'golden';
    save.saveSoon();
    // (Open, before the autosave's moment, and again while its save is on its way)
    const now = await save.loadArea('aa');
    assert.equal(now.atmosphere.preset, 'golden');
    a.atmosphere.preset = 'night';
    save.saveSoon();
    save.flushSave();
    const again = await save.loadArea('aa');
    assert.equal(again.atmosphere.preset, 'night');
    assert.equal(engineSky('aa'), 'night');
});

test('saves go one at a time, in the order asked, and one waiting is the same save', async () => {
    const a = await made('aa');
    const b = Area.create('bb', 3, 'flat');
    engine.saveDelay = 10;
    a.atmosphere.preset = 'golden';
    save.saveSoon();
    open = b;
    save.saveSoon(); // (aa's goes first)
    b.atmosphere.preset = 'night';
    save.saveSoon();
    await save.flushSave();
    const puts = engine.log.filter(l => l.startsWith('PUT'));
    assert.deepEqual(puts, ['PUT /api/save?name=aa&new=1', 'PUT /api/save?name=aa', 'PUT /api/save?name=bb']);
    assert.equal(engineSky('bb'), 'night');
});

test('an area kept in this browser after a failed save goes to the engine when it is opened again', async () => {
    const a = await made('aa');
    engine.failSaves = true;
    a.atmosphere.preset = 'golden';
    save.saveSoon();
    await save.flushSave();
    assert.match(status(), /kept in this browser/);
    assert.notEqual(save.browserCopy('aa'), null);
    engine.failSaves = false;
    open = Area.create('bb', 3, 'flat');
    const now = await save.loadArea('aa');
    assert.equal(now.atmosphere.preset, 'golden');
    assert.equal(engineSky('aa'), 'golden');
    assert.equal(save.browserCopy('aa'), null);
    assert.deepEqual(questions.asked, []);
});

test("a copy kept in this browser is never dropped by another area's save of that name", async () => {
    const a = await made('aa');
    engine.failSaves = true;
    a.atmosphere.preset = 'golden';
    save.saveSoon();
    await save.flushSave();
    engine.failSaves = false;
    // The engine's older copy, opened without going through loadArea, and saved.
    open = Area.fromJSON(JSON.parse(engine.areas.get('aa')));
    save.saveSoon();
    await save.flushSave();
    assert.equal(JSON.parse(save.browserCopy('aa')).atmosphere.preset, 'golden');
    // A later save of the area the copy was kept from replaces it.
    open = a;
    save.saveSoon();
    await save.flushSave();
    assert.equal(save.browserCopy('aa'), null);
    assert.equal(engineSky('aa'), 'golden');
});

test('a copy whose area the engine saved since asks, and closing the question keeps both', async () => {
    const a = await made('aa');
    engine.failSaves = true;
    a.atmosphere.preset = 'golden';
    save.saveSoon();
    await save.flushSave();
    engine.failSaves = false;
    // Another tab saves aa meanwhile; the page learns of it from the engine's list (Open shows it).
    const other = Area.fromJSON(JSON.parse(engine.areas.get('aa')));
    other.atmosphere.preset = 'night';
    await otherTab(other);
    save.noteSaved([{ name: 'aa', saved: engine.saved.get('aa') }]);
    open = Area.create('bb', 3, 'flat');
    const now = await save.loadArea('aa');
    assert.deepEqual(questions.asked, ['Two copies of aa']);
    assert.equal(now.atmosphere.preset, 'night');
    assert.equal(JSON.parse(save.browserCopy('aa')).atmosphere.preset, 'golden');
});

test('an area made again in another tab is not saved over: the builder picks', async () => {
    const a = await made('foo');
    // Another tab makes a new foo and agrees to replace this one.
    const b = Area.create('foo', 3, 'hills');
    await otherTab(b, '&new=1&replace=1');
    assert.notEqual(a.created, b.created);
    // This tab's next change: refused, kept in this browser, and the builder chooses to open the other one.
    questions.answers = [false];
    a.atmosphere.preset = 'golden';
    save.saveSoon();
    await save.flushSave();
    assert.deepEqual(questions.asked, ['Another foo']);
    assert.equal(JSON.parse(engine.areas.get('foo')).created, b.created);
    assert.equal(JSON.parse(save.browserCopy('foo')).atmosphere.preset, 'golden');
    assert.deepEqual(opened, ['foo']);
    // Its later changes stay in this browser without asking again.
    a.atmosphere.preset = 'night';
    save.saveSoon();
    await save.flushSave();
    assert.equal(questions.asked.length, 1);
    assert.equal(JSON.parse(save.browserCopy('foo')).atmosphere.preset, 'night');
});

test('an area made again in another tab is replaced when the builder says so', async () => {
    const a = await made('foo');
    const b = Area.create('foo', 3, 'hills');
    await otherTab(b, '&new=1&replace=1');
    questions.answers = [true];
    a.atmosphere.preset = 'golden';
    save.saveSoon();
    await save.flushSave();
    assert.equal(JSON.parse(engine.areas.get('foo')).created, a.created);
    assert.equal(engineSky('foo'), 'golden');
    assert.equal(save.browserCopy('foo'), null);
});

test("a new area's first save over an existing one is refused, and not kept in this browser", async () => {
    await made('foo');
    const b = Area.create('foo', 3, 'hills');
    assert.equal(await save.saveNew(b, false), false);
    assert.equal(save.browserCopy('foo'), null);
    assert.equal(await save.saveNew(b, true), true);
    assert.equal(JSON.parse(engine.areas.get('foo')).created, b.created);
});

test('opening an area saves nothing', async () => {
    await made('aa');
    engine.log = [];
    open = await save.loadArea('aa');
    await save.flushSave();
    assert.deepEqual(
        engine.log.filter(l => !l.startsWith('GET')),
        [],
    );
});

test('the area last open is kept for each user on a team server', () => {
    me = { team: true, user: 'alice' };
    save.noteOpen('aa');
    assert.equal(save.lastOpen(), 'aa');
    me = { team: true, user: 'bob' };
    assert.equal(save.lastOpen(), null);
    assert.equal(save.userKey('testway', 'mod'), 'landscaper.testway.bob:mod');
});

test("someone else's workspace (read-only) is never saved, and its area isn't noted as the last open", async () => {
    readOnly = true;
    open = Area.create('theirs', 3, 'flat');
    save.saveSoon();
    save.noteOpen('theirs');
    await save.flushSave();
    assert.deepEqual(engine.log, []);
    assert.equal(save.lastOpen(), null);
});
