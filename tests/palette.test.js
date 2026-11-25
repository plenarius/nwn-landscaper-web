// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Paint panel's categories (palette.js): their order, which are collapsed, how that is kept in the browser, and that a
// collapsed category never hides the texture painted with.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { COLLAPSED_KEY, allCollapsed, categoriesOf, opened, readCollapsed, swatchHidden, toggled, writeCollapsed } = await import(
    '../js/palette.js'
);

test("the categories come in the starter library's order, each once, with any other after them", () => {
    const catalog = [
        { id: 'a', category: 'Tileset' },
        { id: 'b', category: 'Rock' },
        { id: 'c', category: 'Grass' },
        { id: 'd', category: 'Rock' },
        { id: 'e', category: 'Earth' },
    ];
    assert.deepEqual(categoriesOf(catalog), ['Grass', 'Earth', 'Rock', 'Tileset']);
    assert.deepEqual(categoriesOf([]), []);
});

test('a heading collapses its category, and a second click opens it again', () => {
    const none = new Set();
    const one = toggled(none, 'Rock');
    assert.deepEqual([...one], ['Rock']);
    assert.deepEqual([...toggled(one, 'Rock')], []);
    // Each step is a new set: the one before stays as it was.
    assert.equal(none.size, 0);
    assert.deepEqual([...one], ['Rock']);
});

test('Collapse all collapses every category; Expand all is the empty set', () => {
    const all = allCollapsed(new Set(['Rock']), ['Grass', 'Rock', 'Snow']);
    assert.deepEqual([...all].sort(), ['Grass', 'Rock', 'Snow']);
    // A category kept from an earlier library (not in this one) stays collapsed.
    assert.deepEqual([...allCollapsed(new Set(['Old']), ['Grass'])].sort(), ['Grass', 'Old']);
});

test('a texture chosen from outside the panel opens its category, and only that one', () => {
    const was = new Set(['Grass', 'Rock']);
    assert.deepEqual([...opened(was, 'Rock')], ['Grass']);
    assert.deepEqual([...opened(was, 'Snow')].sort(), ['Grass', 'Rock']);
    assert.deepEqual([...opened(was, undefined)].sort(), ['Grass', 'Rock']);
    assert.equal(was.size, 2);
});

test('a collapsed category hides its textures but the one painted with', () => {
    const collapsed = new Set(['Grass']);
    assert.equal(swatchHidden(collapsed, 'Grass', 'grassMedium', 'grassDry'), true);
    assert.equal(swatchHidden(collapsed, 'Grass', 'grassDry', 'grassDry'), false);
    assert.equal(swatchHidden(collapsed, 'Rock', 'rockGrey', 'grassDry'), false);
});

test('the collapsed categories survive the trip through storage, and bad or missing text reads as none', () => {
    const set = new Set(['Snow', 'Grass']);
    const text = writeCollapsed(set);
    assert.equal(text, '["Grass","Snow"]');
    assert.deepEqual([...readCollapsed(text)], ['Grass', 'Snow']);
    // Blocked storage answers null (dom.js's store); an old or hand-edited value may be anything.
    for (const bad of [null, undefined, '', 'not json', '{"Grass":true}', '42', 'null']) assert.equal(readCollapsed(bad).size, 0, bad);
    assert.deepEqual([...readCollapsed('["Rock", 7, null]')], ['Rock']);
    assert.equal(COLLAPSED_KEY, 'landscaper.paletteCollapsed');
});
