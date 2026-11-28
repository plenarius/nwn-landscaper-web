// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The New area dialog's starts (newarea.js): two groups of five picture cards, each made by New area, each with its picture,
// and the Start height only where it applies.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import './browser.js';

const { START_GROUPS } = await import('../js/newarea.js');
const { TERRAIN_STARTERS } = await import('../js/starters.js');

const root = new URL('../', import.meta.url);
const all = START_GROUPS.flatMap(g => g.starts);

test('the starts are a group of blank grounds and a group of starter landscapes, five each', () => {
    assert.deepEqual(
        START_GROUPS.map(g => [g.title, g.starts.map(s => s.value)]),
        [
            ['Blank', ['flat', 'hills', 'rough', 'cave', 'interior']],
            ['Starter landscapes', ['canyon', 'snowy-pass', 'dunes', 'lake-valley', 'descending-cave']],
        ],
    );
    // (every landscape New area can seed is offered, and nothing else: the descending crypt and dungeon are gone)
    const landscapes = START_GROUPS[1].starts.map(s => s.value);
    assert.deepEqual(landscapes.filter(v => v !== 'descending-cave').sort(), Object.keys(TERRAIN_STARTERS).sort());
    for (const s of all) {
        assert.ok(s.name && s.text, `${s.value} has a name and a line on what it makes`);
        assert.ok(!/[.(]$/.test(s.text) && !s.text.includes('('), `${s.value}: one plain line`);
    }
});

test('the Start height applies to the outdoor blank grounds only', () => {
    assert.deepEqual(
        all.filter(s => s.height).map(s => s.value),
        ['flat', 'hills', 'rough'],
    );
});

test("each card has its picture: a small WebP the dialog's styles name", () => {
    const css = fs.readFileSync(new URL('css/dialogs.css', root), 'utf8');
    for (const s of all) {
        const file = new URL(`css/start/${s.value}.webp`, root);
        const bytes = fs.readFileSync(file);
        assert.equal(bytes.subarray(0, 4).toString(), 'RIFF', s.value);
        assert.equal(bytes.subarray(8, 12).toString(), 'WEBP', s.value);
        assert.ok(bytes.length < 24 * 1024, `${s.value}.webp is ${bytes.length} bytes`);
        assert.ok(
            css.includes(`.start-card[data-start="${s.value}"] .pic {\n    background-image: url("start/${s.value}.webp");`),
            s.value,
        );
    }
    const pictures = fs.readdirSync(new URL('css/start/', root)).sort();
    assert.deepEqual(pictures, all.map(s => `${s.value}.webp`).sort(), 'no picture of a start that is gone');
});

test('the page builds the cards: no start is written into index.html', () => {
    const html = fs.readFileSync(new URL('index.html', root), 'utf8');
    assert.ok(!html.includes('name="start"'));
    for (const id of ['startChoices', 'startNote', 'newBaseRow']) assert.ok(html.includes(`id="${id}"`), id);
});
