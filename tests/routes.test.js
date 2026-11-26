// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The path check's routes in words (routes.js): routes too long for one click are not blocked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clickCount, liveState } from '../js/routes.js';

const failed = { kind: 'failed_route', from: [1, 1], to: [9, 9], stops_at: [2, 2] };

test('routes too long for one click are not blocked', () => {
    const [state, text, title] = liveState({ routes: { ok: 332, total: 400, long: 68 }, warnings: [] });
    assert.equal(state, 'ok');
    assert.equal(text, 'Paths OK');
    assert.match(title, /^332 of 400 test routes work in one click\. 68 more are too long for one click .* shorter clicks\.$/);
});

test('blocked routes are counted without the long ones', () => {
    const [state, text, title] = liveState({ routes: { ok: 390, total: 400, long: 8 }, warnings: [failed, failed] });
    assert.deepEqual([state, text], ['bad', '2 blocked']);
    assert.match(title, /^398 of 400 test routes reach their goal; red pillars mark where the 2 blocked ones stop\.$/);
});

test("an older engine's report (no long routes) reads as before", () => {
    assert.deepEqual(liveState({ routes: { ok: 332, total: 400 }, warnings: [failed] }).slice(0, 2), ['bad', '68 blocked']);
    assert.deepEqual(liveState({ routes: { ok: 40, total: 40 }, warnings: [] }), ['ok', 'Paths OK', 'All 40 test routes work.']);
});

test('spots to look at still show, with the long routes in the tooltip', () => {
    const [state, text, title] = liveState({ routes: { ok: 38, total: 40, long: 2 }, warnings: [{ kind: 'closed_passage', at: [5, 5] }] });
    assert.deepEqual([state, text], ['warn', '1 spot']);
    assert.match(title, /2 more are too long for one click/);
});

test('click counts in words', () => {
    assert.equal(clickCount([2, 2, 2]), '2');
    assert.equal(clickCount([2, 3, 2]), '2 or 3');
    assert.equal(clickCount([4, 2]), '2 to 4');
    assert.equal(clickCount([]), 'a few');
});
