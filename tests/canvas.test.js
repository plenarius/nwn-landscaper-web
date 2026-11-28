// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// A canvas (canvas.js): which blocks a change reaches, saves of those only, undo across a block's edge, and a canvas read back
// from its blocks the same as it was.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './importmap.js';

const { CanvasArea, BLOCK_STEP, blockKey, decodeBlock, fromB64 } = await import('../js/canvas.js');

/** A block file in the engine's format 1 (src/canvas.rs): what `GET /api/canvas-block` answers. */
function encodeBlock(w, h, heights, paint, chasm, blend = null) {
    const n = w * h,
        out = new Uint8Array(12 + n * (5 + (chasm ? 1 : 0) + (blend ? 2 : 0)) + 8),
        v = new DataView(out.buffer);
    out.set([76, 83, 67, 66]);
    v.setUint16(4, 1, true);
    v.setUint16(6, (chasm ? 1 : 0) | (blend ? 2 : 0), true);
    v.setUint16(8, w, true);
    v.setUint16(10, h, true);
    for (let k = 0; k < n; k++) v.setFloat32(12 + k * 4, heights[k], true);
    out.set(paint, 12 + n * 4);
    if (chasm) out.set(chasm, 12 + n * 5);
    if (blend) out.set(blend, 12 + n * (chasm ? 6 : 5));
    return out;
}

/** Canvas `c` as the engine would hand it back after saving every block `bodies` sent (save bodies' blocks, latest last). */
function reopen(c, bodies) {
    const files = {},
        blocks = {};
    for (const body of bodies)
        for (const b of body.blocks) {
            const [x, y] = b.block.slice(1).split('_').map(Number),
                { w, h } = c.blockRect(x, y);
            const bytes = key => b[key] && fromB64(b[key]);
            files[b.block] = encodeBlock(w, h, new Float32Array(fromB64(b.heights).buffer), bytes('paint'), bytes('chasm'), bytes('blend'));
            blocks[b.block] = `v${body.blocks.indexOf(b)}`;
        }
    const header = bodies.findLast(b => b.header)?.header ?? c.header();
    return CanvasArea.fromHeader({ header, version: 'h1', blocks }, files);
}

/** Saves `c` as the engine would answer it; returns the body sent (null when nothing changed). */
function save(c) {
    const sent = c.saveBody();
    if (!sent) return null;
    c.saved(sent, { version: 'h', blocks: Object.fromEntries(sent.body.blocks.map(b => [b.block, `${b.block}-${Math.random()}`])) });
    return sent.body;
}

test('a sample on a row two blocks share is in both', () => {
    const c = new CanvasArea('cv', 40);
    assert.deepEqual(c.blocks(), [3, 3]);
    assert.deepEqual(c.blockRect(2, 0), { i0: 512, j0: 0, w: 129, h: 257 });
    assert.deepEqual(c.blocksOf({ i0: 10, i1: 10, j0: 10, j1: 10 }), ['b00_00']);
    assert.deepEqual(c.blocksOf({ i0: BLOCK_STEP, i1: BLOCK_STEP, j0: 10, j1: 10 }), ['b00_00', 'b01_00']);
    assert.deepEqual(c.blocksOf({ i0: BLOCK_STEP, i1: BLOCK_STEP, j0: BLOCK_STEP, j1: BLOCK_STEP }).sort(), [
        'b00_00',
        'b00_01',
        'b01_00',
        'b01_01',
    ]);
    assert.deepEqual(c.blocksOf({ i0: 0, i1: c.nx - 1, j0: c.ny - 1, j1: c.ny - 1 }), ['b00_02', 'b01_02', 'b02_02']);
});

test('a save sends only the blocks a change reached', () => {
    const c = CanvasArea.create('cv', 64, 'flat', 5);
    // (a flat new canvas: its blocks are the engine's flat ones; only its header goes)
    const first = save(c);
    assert.equal(first.blocks.length, 0);
    assert.ok(first.header);
    assert.equal(c.saveBody(), null);
    c.beginStroke();
    c.heights[300 * c.nx + 300] = 9;
    let body = save(c);
    assert.deepEqual(
        body.blocks.map(b => b.block),
        ['b01_01'],
    );
    assert.equal(body.header, undefined);
    assert.equal(body.blocks[0].base, 'none');
    // Painting the column blocks 1 and 2 share sends both, with the versions the last save gave block 1.
    const was = c.canvas.versions.get('b01_01');
    c.beginStroke();
    c.materials[300 * c.nx + 2 * BLOCK_STEP] = c.materialIndex('rock');
    body = save(c);
    assert.deepEqual(body.blocks.map(b => b.block).sort(), ['b01_01', 'b02_01']);
    assert.equal(body.blocks.find(b => b.block === 'b01_01').base, was);
    assert.ok(body.header, 'a new texture changes the palette, in the header');
    assert.equal(c.saveBody(), null);
});

test('a block changed again while its save is on the way is saved again', () => {
    const c = CanvasArea.create('cv', 32, 'flat', 5);
    save(c);
    c.beginStroke();
    c.heights[10] = 7;
    const sent = c.saveBody();
    c.beginStroke();
    c.heights[11] = 8;
    c.settleChanges();
    c.saved(sent, { version: 'h2', blocks: { b00_00: 'x' } });
    assert.deepEqual(
        c.saveBody().body.blocks.map(b => b.block),
        ['b00_00'],
    );
});

test('undo across a block edge puts both blocks back, and saves both', () => {
    const c = CanvasArea.create('cv', 48, 'flat', 5);
    save(c);
    c.beginStroke();
    for (let j = 100; j <= 110; j++) for (let i = BLOCK_STEP - 5; i <= BLOCK_STEP + 5; i++) c.heights[j * c.nx + i] = 12;
    save(c);
    assert.equal(c.undo(), true);
    for (let j = 100; j <= 110; j++)
        for (let i = BLOCK_STEP - 5; i <= BLOCK_STEP + 5; i++) assert.equal(c.heights[j * c.nx + i], 5, `sample (${i}, ${j})`);
    assert.deepEqual(c.lastChange.rect, { i0: BLOCK_STEP - 5, i1: BLOCK_STEP + 5, j0: 100, j1: 110 });
    const body = save(c);
    assert.deepEqual(body.blocks.map(b => b.block).sort(), ['b00_00', 'b01_00']);
    // (the undo step keeps the changed rectangle only, not the canvas)
    assert.equal(c.redoStack.at(-1).h.length, 11 * 11);
    assert.equal(c.redo(), true);
    assert.equal(c.heights[105 * c.nx + BLOCK_STEP], 12);
    assert.deepEqual(
        save(c)
            .blocks.map(b => b.block)
            .sort(),
        ['b00_00', 'b01_00'],
    );
});

test('a canvas read back from its blocks has the same grids', () => {
    const c = CanvasArea.create('cv', 40, 'hills', 5, 36);
    c.materials[5 * c.nx + 600] = c.materialIndex('rock');
    c.chasm = new Uint8Array(c.nx * c.ny);
    for (let i = 250; i < 270; i++) c.chasm[300 * c.nx + i] = 1;
    c.water = [{ i: 20, j: 20, level: 6 }];
    c.floodWater();
    c.markAll();
    const body = save(c);
    assert.equal(body.blocks.length, 9);
    // (only the blocks the chasm crosses carry a mask)
    assert.deepEqual(
        body.blocks
            .filter(b => b.chasm)
            .map(b => b.block)
            .sort(),
        ['b00_01', 'b01_01'],
    );
    const back = reopen(c, [body]);
    assert.deepEqual(back.heights, c.heights);
    assert.deepEqual(back.materials, c.materials);
    assert.deepEqual(back.chasm, c.chasm);
    assert.deepEqual(back.palette, c.palette);
    assert.deepEqual(back.water, c.water);
    assert.deepEqual(back.waterLevel, c.waterLevel);
    assert.equal(back.tilesY, 36);
    assert.equal(back.created, c.created);
    assert.equal(back.saveBody(), null, 'nothing to save after opening');
});

test('a block file is read as the engine writes it', () => {
    const h = Float32Array.from({ length: 6 }, (_, k) => k / 2),
        p = Uint8Array.from([0, 1, 2, 3, 4, 5]);
    const [hh, pp, cc] = decodeBlock(encodeBlock(3, 2, h, p, null), 3, 2);
    assert.deepEqual(hh, h);
    assert.deepEqual(pp, p);
    assert.equal(cc, null);
    assert.throws(() => decodeBlock(encodeBlock(3, 2, h, p, null), 2, 3), /3 by 2/);
    assert.equal(blockKey(3, 12), 'b03_12');
});

test('a blend layer goes with the blocks that have weights, and comes back', () => {
    const c = CanvasArea.create('cv', 40, 'flat', 5);
    save(c);
    c.blend = new Uint8Array(c.nx * c.ny * 2);
    const k = 300 * c.nx + 300;
    c.blend[2 * k] = c.materialIndex('rock');
    c.blend[2 * k + 1] = 90;
    // (a blend change reaches its blocks as a paint change does, once the undo grids carry it; here by hand)
    c.markChanged({ i0: 300, i1: 300, j0: 300, j1: 300 });
    const body = save(c);
    assert.deepEqual(
        body.blocks.map(b => b.block),
        ['b01_01'],
    );
    assert.equal(fromB64(body.blocks[0].blend).length, 257 * 257 * 2);
    // (a block without a weight sends none, as the format asks)
    c.markChanged({ i0: 10, i1: 10, j0: 10, j1: 10 });
    assert.equal(c.saveBody().body.blocks.find(b => b.block === 'b00_00').blend, undefined);
    const back = reopen(c, [body]);
    assert.deepEqual(back.blend, c.blend);
});
