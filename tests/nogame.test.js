// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// showNoGame(): with an engine that has none of the game's files, each panel that needs the game says so, once, with the
// link to the desktop app; with the game, the panels are as they were.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './browser.js';

const { showNoGame, NEEDS_GAME, DESKTOP_URL } = await import('../js/nogame.js');

// What nogame.js uses of an element beyond browser.js's: its classes, finding its notice, putting one first, taking it out.
const make = document.createElement;
document.createElement = tag =>
    Object.assign(make(tag), {
        setAttribute(k, v) {
            this[k] = v;
        },
        remove() {
            this.parent.children.splice(this.parent.children.indexOf(this), 1);
        },
    });
function host(id) {
    const h = document.getElementById(id);
    const marks = new Set();
    return Object.assign(h, {
        classList: { toggle: (c, on) => (on ? marks.add(c) : marks.delete(c)), contains: c => marks.has(c) },
        querySelector: sel => (sel.includes('needs-game') ? (h.children.find(k => k.className === 'needs-game') ?? null) : null),
        prepend(k) {
            k.parent = h;
            h.children.unshift(k);
        },
    });
}

test('without the game, each panel that needs it says so once, with the folder button; with it, nothing changes', () => {
    const hosts = NEEDS_GAME.map(([id]) => host(id));
    assert.deepEqual(
        NEEDS_GAME.map(([, name]) => name),
        ['Place', 'Scatter', 'Things', 'Scripts', 'Import'],
    );
    showNoGame(true);
    showNoGame(true);
    for (const h of hosts) {
        assert.ok(h.classList.contains('no-game'), h.id);
        const notes = h.children.filter(k => k.className === 'needs-game');
        assert.equal(notes.length, 1, h.id);
        assert.match(notes[0].children[0].textContent, /needs your copy of Neverwinter Nights/);
        const link = notes[0].children[1];
        assert.equal(link.textContent, 'Get the desktop app');
        assert.equal(link.href, DESKTOP_URL);
    }
    showNoGame(false);
    for (const h of hosts) {
        assert.ok(!h.classList.contains('no-game'), h.id);
        assert.equal(h.children.length, 0, h.id);
    }
});

test("with the page's stock placeables, Place and Scatter need nothing more; the others still say so", () => {
    const hosts = NEEDS_GAME.map(([id]) => document.getElementById(id));
    showNoGame(true, true);
    assert.deepEqual(
        hosts.filter(h => h.classList.contains('no-game')).map(h => h.id),
        ['thingsPanel', 'scriptDialog', 'importDialog'],
    );
    showNoGame(false);
    assert.ok(hosts.every(h => !h.classList.contains('no-game')));
});
