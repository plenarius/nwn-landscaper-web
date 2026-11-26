// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Delete area (save.js): the question that names the area, the version sent with the delete, the engine's refusals, the copy in
// this browser, and the area opened afterwards.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { engine, clearStorage, status, otherTab, hide } from './browser.js';
import { questions } from './stubs/ask.js';

const { Area } = await import('../js/area.js');
const save = await import('../js/save.js');
const { viewing } = await import('../js/api.js');
const { initExport, sendArea } = await import('../js/export.js');

// What app.js gives save.js: the area open, who is signed in, read-only or not, Open, and the blank area.
let open = null;
let me = { team: false, user: 'local' };
let readOnly = false;
const opened = [];
let blanks = 0;
/** What app.js gives page `s` (save.js). */
const wiring = s => ({
    area: () => open,
    me: () => me,
    readOnly: () => readOnly,
    open: async name => {
        opened.push(name);
        open = await s.loadArea(name, false);
    },
    blank: () => {
        blanks++;
        open = Area.create('untitled', 3, 'flat');
    },
});
save.initSave(wiring(save));
initExport({ area: () => open, readOnly: () => false, view: { setMarkers() {} } });

/** A new area called `name` on the engine, as New makes it (saved once), and open. */
async function made(name) {
    const a = Area.create(name, 3, 'flat');
    open = a;
    assert.equal(await save.saveNew(a, false), true);
    return a;
}

/** File, Delete area, answering its question with `answer`. */
async function deleteOpen(answer) {
    questions.answers = [answer];
    await document.getElementById('btnDelete').onclick();
}

const deletes = () => engine.log.filter(l => l.startsWith('DELETE'));

beforeEach(async () => {
    engine.reset();
    clearStorage();
    await save.loadCopies();
    questions.asked = [];
    questions.answers = [];
    opened.length = 0;
    blanks = 0;
    me = { team: false, user: 'local' };
    readOnly = false;
    viewing.user = null;
});
afterEach(() => save.flushSave());

test('Delete area asks, naming the area, deletes it with its version, drops its browser copy and opens another', async () => {
    await made('bb');
    const a = await made('aa');
    // A change the engine didn't take: kept in this browser.
    engine.failSaves = true;
    a.atmosphere.preset = 'golden';
    save.saveSoon();
    await save.flushSave();
    assert.notEqual(save.browserCopy('aa'), null);
    engine.failSaves = false;
    const version = engine.version('aa');
    await deleteOpen(true);
    assert.deepEqual(questions.asked, ['Delete aa?']);
    assert.deepEqual(deletes(), [`DELETE /api/area?name=aa&base=${version}`]);
    assert.equal(engine.areas.has('aa'), false);
    assert.equal(save.browserCopy('aa'), null);
    assert.deepEqual(
        Object.keys(localStorage).filter(k => k.includes('.aa')),
        [],
        'nothing of it is left in the browser',
    );
    assert.deepEqual(opened, ['bb']);
    assert.equal(open.name, 'bb');
    assert.notEqual(save.lastOpen(), 'aa');
    assert.match(status(), /Deleted aa; opened bb/);
});

test('the last area deleted leaves a blank one', async () => {
    await made('aa');
    await deleteOpen(true);
    assert.equal(engine.areas.size, 0);
    assert.equal(blanks, 1);
    assert.equal(open.name, 'untitled');
    assert.equal(save.lastOpen(), null);
});

test('a change still waiting for its moment is dropped, not saved after the delete', async () => {
    const a = await made('aa');
    a.atmosphere.preset = 'night';
    save.saveSoon();
    await deleteOpen(true);
    await save.flushSave();
    assert.deepEqual(
        engine.log.filter(l => l.startsWith('PUT')),
        ['PUT /api/save?name=aa&new=1'],
    );
    assert.equal(engine.areas.has('aa'), false);
});

test('an area saved from another tab since this one opened it is not deleted', async () => {
    const a = await made('aa');
    const other = Area.fromJSON(JSON.parse(engine.areas.get('aa')));
    other.atmosphere.preset = 'night';
    await otherTab(other);
    await deleteOpen(true);
    assert.equal(deletes().length, 1);
    assert.equal(engine.areas.has('aa'), true);
    assert.equal(open, a, 'it stays open');
    assert.deepEqual(opened, []);
    assert.match(status(), /aa wasn't deleted: another tab or computer saved it/);
});

test('an area whose import other areas use is not deleted, and the status line says why', async () => {
    await made('aa');
    engine.usedBy.set('aa', ['bb']);
    await deleteOpen(true);
    assert.equal(engine.areas.has('aa'), true);
    assert.match(status(), /Couldn't delete aa: aa is imported and others use it/);
});

test('cancelled, or in a read-only workspace: nothing is sent', async () => {
    await made('aa');
    await deleteOpen(null);
    await deleteOpen(false);
    readOnly = true;
    viewing.user = 'bob';
    await deleteOpen(true);
    assert.deepEqual(questions.asked, ['Delete aa?', 'Delete aa?'], 'not asked while read-only');
    assert.deepEqual(deletes(), []);
    assert.equal(engine.areas.has('aa'), true);
});

test('an area only in this browser (the engine never took it) goes from the browser', async () => {
    engine.failSaves = true;
    open = Area.create('cc', 3, 'flat');
    save.saveSoon();
    await save.flushSave();
    assert.notEqual(save.browserCopy('cc'), null);
    engine.failSaves = false;
    await deleteOpen(true);
    assert.deepEqual(deletes(), ['DELETE /api/area?name=cc&base=none']);
    assert.equal(save.browserCopy('cc'), null);
    assert.equal(blanks, 1);
});

test('an area changed, its tab hidden while its save is on its way and back, is deleted after Check paths and Export', async () => {
    const a = await made('duny');
    engine.saveDelay = 20;
    a.atmosphere.preset = 'golden';
    save.saveSoon();
    hide();
    a.atmosphere.preset = 'night';
    save.saveSoon();
    hide();
    await save.flushSave();
    engine.saveDelay = 0;
    await sendArea('check');
    await sendArea('export');
    const version = engine.version('duny');
    await deleteOpen(true);
    assert.deepEqual(deletes(), [`DELETE /api/area?name=duny&base=${version}`]);
    assert.equal(engine.areas.has('duny'), false);
    assert.equal(save.browserCopy('duny'), null);
});

// The tests below reload the page: each gets a page of its own, so they come last.

let reloads = 0;
/** The page reloads (F5, or the browser reloads a tab it put to sleep): a new page with nothing of this one's but this
 *  browser's storage, which opens the area last open as app.js does. */
async function reload() {
    await save.flushSave();
    const page = await import(`../js/save.js?page=${++reloads}`);
    page.initSave(wiring(page));
    await page.loadCopies();
    await page.moveBrowserAreas();
    const last = page.lastOpen();
    open = await page.openAtStart(last, page.browserCopy(last));
    return page;
}

test('the area the page opens at its start is deleted after Check paths and Export', async () => {
    const a = await made('duny');
    a.atmosphere.preset = 'golden';
    save.saveSoon();
    hide();
    await save.flushSave();
    await reload();
    assert.equal(open.name, 'duny');
    await sendArea('check');
    await sendArea('export');
    const version = engine.version('duny');
    await deleteOpen(true);
    assert.deepEqual(deletes(), [`DELETE /api/area?name=duny&base=${version}`]);
    assert.equal(engine.areas.has('duny'), false);
    assert.match(status(), /Deleted duny/);
});

test('the area the page opens at its start is not deleted when another tab saved it since', async () => {
    await made('duny');
    await reload();
    const other = Area.fromJSON(JSON.parse(engine.areas.get('duny')));
    other.atmosphere.preset = 'night';
    await otherTab(other);
    await deleteOpen(true);
    assert.equal(deletes().length, 1);
    assert.equal(engine.areas.has('duny'), true);
    assert.match(status(), /duny wasn't deleted: another tab or computer saved it/);
});

test('the area the page opens at its start saves over its own version, not unchecked', async () => {
    await made('duny');
    const page = await reload();
    open.atmosphere.preset = 'night';
    page.saveSoon();
    await page.flushSave();
    const [put] = engine.log.filter(l => l.startsWith('PUT')).slice(-1);
    assert.match(put, /&base=/);
    assert.match(JSON.parse(engine.areas.get('duny')).atmosphere.preset, /night/);
});
