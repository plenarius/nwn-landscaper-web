// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// An export's estimate, step and time left as the report box shows them (exportjob.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { durationText, exportProgressOf } = await import('../js/exportjob.js');

test('a wait reads in words a builder plans by', () => {
    assert.equal(durationText(4), 'a few seconds');
    assert.equal(durationText(42), '40 s');
    assert.equal(durationText(150), '2 min 30 s');
    assert.equal(durationText(178), '3 min');
    assert.equal(durationText(720), '12 min');
    assert.equal(durationText(Number.NaN), '');
});

/** `text` with its no-break spaces as plain ones. */
const plain = text => text?.replace(/\u00a0/g, ' ');

test('the estimate says how much of the area is already cached', () => {
    const v = exportProgressOf({ step: 'tiles', done: 0, total: 256, cached: 40, elapsed: 3, estimate: 180, left: 177 });
    assert.equal(plain(v.estimate), 'About 3 min · 40 of 256 tiles already cached');
    assert.equal(plain(v.step), 'Building the tiles: 0 of 256 · about 3 min left');
    assert.ok(v.fraction > 0 && v.fraction < 0.05, v.fraction);
    assert.match(plain(exportProgressOf({ step: 'tiles', total: 9, cached: 0, estimate: 20 }).estimate), /9 tiles, none cached/);
});

test('before the tiles start there is no estimate and the bar has no length', () => {
    const v = exportProgressOf({ step: 'preparing', done: 0, total: 0, elapsed: 1, estimate: null, left: null });
    assert.equal(v.estimate, null);
    assert.equal(v.fraction, null);
    assert.equal(exportProgressOf(undefined).fraction, null);
});

test('the bar is full once it is done, and the steps after the tiles name themselves', () => {
    assert.equal(exportProgressOf({ step: 'done', total: 9, left: 0, elapsed: 30, estimate: 28 }).fraction, 1);
    assert.match(
        plain(exportProgressOf({ step: 'routes', total: 9, done: 9, elapsed: 20, left: 4 }).step),
        /^Checking the routes · about a few seconds left$/,
    );
});
