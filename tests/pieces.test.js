// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// A canvas's pieces (pieces.js): cut, move a cut, join, grid, rename, the game's 32-tile limit, and what a change moves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './importmap.js';

const P = await import('../js/pieces.js');
const { CanvasArea } = await import('../js/canvas.js');

const S = (pieces, nextId = 1) => ({ canvas: 'rivl', pieces, nextId });
const piece = (id, x, y, w, h, name = `rivl${String(id).padStart(2, '0')}`) => ({ id, name, x, y, w, h });
const rects = r => r.pieces.map(({ name, x, y, w, h }) => [name, x, y, w, h]).sort();

test('a grid shares the canvas out evenly and keeps the 32-tile limit', () => {
    const g = P.grid(S([]), 2, 2, 64, 64);
    assert.deepEqual(rects(g), [
        ['rivl01', 0, 0, 32, 32],
        ['rivl02', 32, 0, 32, 32],
        ['rivl03', 0, 32, 32, 32],
        ['rivl04', 32, 32, 32, 32],
    ]);
    assert.equal(g.nextId, 5);
    // 100 tiles in 3: 34, 33, 33, over the limit.
    assert.match(P.grid(S([]), 3, 3, 100, 100).error, /34 tiles wide; the game takes 32 at most/);
    // A new grid keeps the numbers of the pieces it covers most of.
    const again = P.grid(S(g.pieces, g.nextId), 4, 2, 64, 64);
    assert.deepEqual(
        again.pieces.map(p => p.id),
        [1, 5, 2, 6, 3, 7, 4, 8],
    );
});

test('a cut over a gap is a new piece; across a piece it splits it, the larger part keeping its number', () => {
    const one = P.cut(S([]), { x: 0, y: 0, w: 20, h: 10 }, 64, 64);
    assert.deepEqual(rects(one), [['rivl01', 0, 0, 20, 10]]);
    // A strip across rivl01's east end: rivl01 keeps 0..14, the strip is new.
    const split = P.cut(S(one.pieces, one.nextId), { x: 14, y: 0, w: 6, h: 10 }, 64, 64);
    assert.deepEqual(rects(split), [
        ['rivl01', 0, 0, 14, 10],
        ['rivl02', 14, 0, 6, 10],
    ]);
    assert.equal(split.made.name, 'rivl02');
    // The larger part is the new rectangle: it keeps the number, the rest is new.
    const big = P.cut(S(one.pieces, one.nextId), { x: 0, y: 0, w: 16, h: 10 }, 64, 64);
    assert.equal(big.made.id, 1);
    assert.deepEqual(rects(big), [
        ['rivl01', 0, 0, 16, 10],
        ['rivl02', 16, 0, 4, 10],
    ]);
    // Not right across: refused, with the piece's name.
    assert.match(P.cut(S(one.pieces, 2), { x: 5, y: 2, w: 5, h: 5 }, 64, 64).error, /right across rivl01/);
    // Too big, or leaving a sliver under 3 tiles.
    assert.match(P.cut(S([]), { x: 0, y: 0, w: 40, h: 10 }, 64, 64).error, /40 tiles wide; the game takes 32 at most/);
    assert.match(P.cut(S(one.pieces, 2), { x: 0, y: 0, w: 19, h: 10 }, 64, 64).error, /1 tile wide; a piece is 3 at least/);
});

test('moving a cut moves both sides, and is refused past 32 tiles with the piece named', () => {
    const pieces = [piece(1, 0, 0, 28, 32), piece(2, 28, 0, 32, 16), piece(3, 28, 16, 32, 16), piece(4, 0, 32, 32, 20)];
    pieces[1].settings = { name: 'Riverford' };
    const c = P.cutNear(pieces, 28.1, 5);
    assert.equal(c.axis, 'x');
    assert.equal(c.k, 28);
    // Both pieces east of it join the cut: moving it keeps all three rectangles.
    assert.deepEqual(c.members.map(m => m.p.id).sort(), [1, 2, 3]);
    const moved = P.moveCut(S(pieces, 5), c, 30, 64, 64);
    assert.deepEqual(rects(moved).slice(0, 3), [
        ['rivl01', 0, 0, 30, 32],
        ['rivl02', 30, 0, 30, 16],
        ['rivl03', 30, 16, 30, 16],
    ]);
    const wide = P.moveCut(S(pieces, 5), c, 24, 64, 64);
    assert.equal(wide.error, 'Riverford would be 36 tiles wide; the game takes 32 at most.');
    // An outer edge moves alone, leaving a gap.
    const edge = P.cutNear(pieces, 31.9, 40);
    assert.deepEqual(
        edge.members.map(m => m.p.id),
        [4],
    );
    const gap = P.moveCut(S(pieces, 5), edge, 28, 64, 64);
    assert.deepEqual(gap.pieces[3], { ...pieces[3], w: 28 });
    assert.equal(P.gapTiles(gap.pieces, 64, 64), 64 * 64 - (28 * 32 + 32 * 32 + 28 * 20));
    // Into another piece: refused.
    const north = P.cutNear(pieces, 10, 32.2);
    assert.match(P.moveCut(S(pieces, 5), north, 50, 64, 64).error, /tall/);
});

test('two pieces sharing a whole side join; the larger keeps its number', () => {
    const pieces = [piece(1, 0, 0, 10, 10), piece(2, 10, 0, 20, 10), piece(3, 0, 10, 12, 10)];
    const j = P.join(S(pieces, 4), 'rivl01', 'rivl02', 64, 64);
    assert.deepEqual(rects(j), [
        ['rivl02', 0, 0, 30, 10],
        ['rivl03', 0, 10, 12, 10],
    ]);
    assert.match(P.join(S(pieces, 4), 'rivl01', 'rivl03', 64, 64).error, /don't make a rectangle/);
    const wide = [piece(1, 0, 0, 20, 10), piece(2, 20, 0, 20, 10)];
    assert.match(P.join(S(wide, 3), 'rivl01', 'rivl02', 64, 64).error, /40 tiles wide/);
});

test('rename keeps names unique and 1 to 9 characters; numbers are never given again', () => {
    const pieces = [piece(1, 0, 0, 10, 10), piece(2, 10, 0, 10, 10)];
    assert.equal(P.rename(S(pieces, 3), 'rivl01', 'ford').pieces[0].name, 'ford');
    assert.match(P.rename(S(pieces, 3), 'rivl01', 'rivl02').error, /Another piece is called rivl02/);
    assert.match(P.rename(S(pieces, 3), 'rivl01', 'Riverford1').error, /1 to 9/);
    // A piece taken out leaves its number used: the next cut takes 3.
    const out = P.remove(S(pieces, 3), 'rivl02');
    assert.equal(P.cut(S(out.pieces, 3), { x: 20, y: 0, w: 10, h: 10 }, 64, 64).made.id, 3);
    // A default name already taken by a rename is skipped.
    const taken = [piece(1, 0, 0, 10, 10, 'rivl02')];
    assert.equal(P.cut(S(taken, 2), { x: 20, y: 0, w: 10, h: 10 }, 64, 64).made.name, 'rivl03');
});

test('what moves: entrances, placeables, creatures, baked objects and water that change piece, with their tags', () => {
    const a = CanvasArea.create('rivl', 64, 'flat', 5, 64);
    a.entrances = [{ id: 2, x: 255, y: 100 }];
    a.objects = [
        { id: 17, x: 262, y: 120, model: 'plc_rock', baked: false },
        { id: 18, x: 265, y: 130, model: 'tree01', baked: true },
        { id: 19, x: 100, y: 100, model: 'tree01', baked: true },
    ];
    a.things = [
        { id: 1, kind: 'creature', x: 250, y: 50, fields: { LocalizedName: 'Wolf' } },
        { id: 2, kind: 'creature', x: 251, y: 60, fields: { LocalizedName: 'Wolf' } },
        {
            id: 3,
            kind: 'trigger',
            x: 270,
            y: 50,
            outline: [
                [275, 40],
                [285, 40],
                [285, 60],
                [275, 60],
            ],
            name: 'TRG',
        },
    ];
    // A lake in the strip x 24..28 tiles.
    const i = 26 * 16,
        j = 10 * 16;
    a.waterLevel[j * a.nx + i] = 6;
    const before = [piece(1, 0, 0, 24, 32), piece(2, 24, 0, 32, 32)],
        after = [piece(1, 0, 0, 28, 32), piece(2, 28, 0, 28, 32)];
    const m = P.whatMoves(a, before, after);
    const by = k => m.filter(x => x.kind === k);
    assert.deepEqual(by('entrance'), [{ kind: 'entrance', label: 'Cave entrance', tag: 'rivl_ent2', from: 'rivl02', to: 'rivl01' }]);
    assert.deepEqual(by('placeable'), [{ kind: 'placeable', label: 'Placeable', tag: 'rivl_p17', from: 'rivl02', to: 'rivl01' }]);
    assert.equal(by('creature')[0].count, 2);
    assert.deepEqual(by('creature')[0].names, ['Wolf', 'Wolf']);
    assert.equal(by('object')[0].count, 1);
    assert.deepEqual(
        by('lake').map(x => [x.from, x.to]),
        [['rivl02', 'rivl01']],
    );
    // The trigger's outline (x 275..285 m) is all rivl02's before; the cut at 280 m runs through it: refused at export.
    assert.deepEqual(
        by('trigger').map(x => [x.from, x.to]),
        [['rivl02', 'across']],
    );
    // Nothing changes piece when the pieces don't.
    assert.deepEqual(
        P.whatMoves(
            a,
            after,
            after.map(p => ({ ...p })),
        ),
        [],
    );
    // Into a gap: `to` null.
    const gap = P.whatMoves(a, after, [piece(1, 0, 0, 20, 32), piece(2, 28, 0, 28, 32)]);
    assert.ok(gap.some(x => x.kind === 'entrance' && x.to === null));
});

test('neighbours give each side and the tiles shared', () => {
    const pieces = [piece(1, 0, 0, 28, 32), piece(2, 28, 0, 32, 32), piece(3, 0, 32, 32, 20), piece(4, 32, 32, 28, 20)];
    const n = P.neighbours(pieces, pieces[1]);
    assert.deepEqual(
        n.map(x => [x.side, x.piece.id, x.tiles]),
        [
            ['north', 3, 4],
            ['north', 4, 28],
            ['west', 1, 32],
        ],
    );
    assert.equal(P.pieceAt(pieces, 280, 10).id, 2);
    assert.equal(P.pieceAt(pieces, 279.9, 10).id, 1);
    assert.equal(P.pieceAt(pieces, 615, 10), null);
});
