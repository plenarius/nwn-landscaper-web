// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// A canvas's Publish dialog (canvaspub.js): its default ticks, the stale pieces it refuses, its warnings, and the export job's
// piece in its label.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './importmap.js';

const P = await import('../js/canvaspub.js');

const changes = {
    canvas: 'rivl',
    ticked: ['rivl01', 'rivl02', 'rivl03'],
    pieces: [
        {
            name: 'rivl01',
            exported: true,
            stale: false,
            published: 1,
            changed: true,
            why: [{ kind: 'edge', text: "its edge shows rivl02's change", from: ['rivl02'] }],
        },
        { name: 'rivl02', exported: true, stale: true, published: 1, changed: true, why: [{ kind: 'ground', text: 'its ground changed' }] },
        { name: 'rivl03', exported: true, stale: false, published: null, changed: true, why: [{ kind: 'new', text: 'never published' }] },
        { name: 'rivl04', exported: true, stale: false, published: 1, changed: false, why: [] },
        {
            name: 'rivl05',
            exported: false,
            stale: false,
            published: null,
            changed: true,
            why: [{ kind: 'moved', text: 'its corner moved' }],
        },
    ],
    removed: [{ name: 'rivl06', id: 6, renamed: 'ford' }],
};

test("the engine's ticks are the defaults, less the pieces it would refuse", () => {
    const rows = P.publishRows(changes, n => (n === 'rivl01' ? 'Riverford' : n));
    assert.deepEqual(
        rows.map(r => [r.name, r.ticked, !!r.refused]),
        [
            ['rivl01', true, false],
            ['rivl02', false, true],
            ['rivl03', true, false],
            ['rivl04', false, false],
            ['rivl05', false, true],
        ],
    );
    assert.equal(rows[0].label, 'Riverford');
    assert.equal(rows[0].why, "its edge shows rivl02's change");
    assert.equal(rows[2].why, 'new');
    assert.equal(rows[3].why, 'unchanged since the last publish');
    assert.match(rows[1].refused, /export again first/);
    assert.match(rows[4].refused, /never exported/);
    assert.ok(rows[4].moved);
});

test('a stale piece is refused, never sent, even when ticked by hand', () => {
    const rows = P.publishRows(changes);
    assert.deepEqual(P.refusedOf(rows, ['rivl01', 'rivl02']), ['rivl02']);
    assert.deepEqual(P.refusedOf(rows, ['rivl01', 'rivl03']), []);
    assert.deepEqual(P.everyPiece(rows), ['rivl01', 'rivl03', 'rivl04']);
});

test('the warnings read as sentences, each once, and a removed piece is left to the reviewer', () => {
    const lines = P.warningLines([
        { kind: 'send_too', pieces: ['rivl01', 'rivl03'], why: "their crossings with these pieces aren't live yet" },
        { kind: 'moved', piece: 'rivl02', why: 'rivl02: its corner moved' },
        { kind: 'moved', piece: 'rivl02', why: 'rivl02: its corner moved' },
        { kind: 'removed', piece: 'rivl06', why: 'rivl06 is no longer on the canvas' },
        { kind: 'stale', pieces: ['rivl02'], why: 'rivl02: export again first' },
    ]);
    assert.deepEqual(lines, [
        ['warn', "Send rivl01, rivl03 too: their crossings with these pieces aren't live yet"],
        ['warn', 'rivl02: its corner moved'],
        ['warn', 'rivl06 is no longer on the canvas'],
        ['error', 'rivl02: export again first'],
    ]);
    assert.match(P.removedLines(changes.removed)[0], /^rivl06: no longer on the canvas \(now ford\); the reviewer decides/);
    assert.equal(P.sendText(1), 'Send 1 piece for review');
    assert.equal(P.sendText(4), 'Send 4 pieces for review');
});

test("a canvas export job's label gives its piece and the whole canvas's share done", () => {
    assert.deepEqual(P.pieceOf('rivl: rivl02 (piece 2 of 4)', 0.5), { piece: 'rivl02', k: 2, n: 4, overall: 0.375 });
    assert.equal(P.pieceOf('rivl02', 0.5), null);
    assert.equal(P.pieceOf(undefined), null);
});
