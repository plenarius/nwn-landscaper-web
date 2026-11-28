// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// A canvas's autosave (save.js, canvassave.js): only the changed blocks go, each with the version it started from; a save that
// fails keeps them in this browser, and the next open puts them back while the engine's versions are still those.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { engine, clearStorage } from './browser.js';

const { CanvasArea } = await import('../js/canvas.js');
const { loadCanvas } = await import('../js/canvassave.js');
const save = await import('../js/save.js');

// A flat block file at 5 m, in the engine's format 1 (the canvases here are flat).
function flatBlock(u) {
    const [x, y] = u.searchParams.get('block').slice(1).split('_').map(Number),
        { w, h } = new CanvasArea('cv', 40).blockRect(x, y),
        out = new Uint8Array(12 + w * h * 5 + 8),
        v = new DataView(out.buffer);
    out.set([76, 83, 67, 66]);
    v.setUint16(4, 1, true);
    v.setUint16(8, w, true);
    v.setUint16(10, h, true);
    for (let k = 0; k < w * h; k++) v.setFloat32(12 + k * 4, 5, true);
    return new Response(out);
}

let open = null;
const me = { team: false, user: 'local' };
save.initSave({ area: () => open, me: () => me, readOnly: () => false, open: () => {} });

// The test engine's canvas: its header, version and blocks' versions, and each save it was sent.
let disk = null;
const sent = [];
let failing = false;
beforeEach(async () => {
    engine.reset();
    clearStorage();
    await save.loadCopies();
    sent.length = 0;
    failing = false;
    disk = null;
    engine.routes.set('PUT /api/canvas-save', (_u, opts) => {
        if (failing) return [{ error: 'disk full' }, 500];
        const body = JSON.parse(opts.body);
        sent.push(body);
        for (const b of body.blocks) {
            if ((disk.blocks[b.block] ?? 'none') !== b.base) return [{ error: 'moved', moved: { [b.block]: 'x' } }, 409];
        }
        for (const b of body.blocks) disk.blocks[b.block] = `v${sent.length}`;
        if (body.header) {
            disk.header = body.header;
            disk.version = `h${sent.length}`;
        }
        return [{ saved: 1, version: disk.version, blocks: Object.fromEntries(body.blocks.map(b => [b.block, disk.blocks[b.block]])) }];
    });
    engine.routes.set('GET /api/canvas', () => [disk]);
    engine.routes.set('GET /api/canvas-block', flatBlock);
});

/** A flat 40 by 40 canvas the engine has, open. */
function made() {
    const c = CanvasArea.create('cv', 40, 'flat', 5);
    disk = { header: c.header(), version: 'h0', blocks: {} };
    c.canvas.version = 'h0';
    c.canvas.savedHeader = JSON.stringify(c.header());
    open = c;
    return c;
}

test('an autosave sends the blocks a stroke reached, and nothing when nothing changed', async () => {
    const c = made();
    c.beginStroke();
    for (let j = 250; j <= 260; j++) c.heights[j * c.nx + 400] = 8;
    save.saveSoon();
    await save.flushSave();
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].blocks.map(b => b.block).sort(), ['b01_00', 'b01_01']);
    assert.equal(sent[0].header, undefined);
    save.saveSoon();
    await save.flushSave();
    assert.equal(sent.length, 1, 'nothing changed: nothing sent');
});

test('a failed save keeps the blocks in this browser, and opening the canvas again puts them back', async () => {
    const c = made();
    failing = true;
    c.beginStroke();
    c.heights[300 * c.nx + 300] = 11;
    save.saveSoon();
    await save.flushSave();
    assert.equal(sent.length, 0);
    failing = false;
    const { canvas, restored } = await loadCanvas('cv', me);
    assert.equal(restored, true);
    assert.equal(canvas.heights[300 * canvas.nx + 300], 11);
    open = canvas;
    save.saveSoon();
    await save.flushSave();
    assert.deepEqual(
        sent.at(-1).blocks.map(b => b.block),
        ['b01_01'],
    );
    // (saved: the copy here is dropped)
    assert.equal((await loadCanvas('cv', me)).restored, false);
});

test("changes kept here from before another tab's save are left as they are", async () => {
    const c = made();
    failing = true;
    c.beginStroke();
    c.heights[300 * c.nx + 300] = 11;
    save.saveSoon();
    await save.flushSave();
    disk.blocks.b01_01 = 'elsewhere';
    const { canvas, restored, stale } = await loadCanvas('cv', me);
    assert.equal(restored, false);
    assert.equal(stale, true);
    assert.equal(canvas.heights[300 * canvas.nx + 300], 5);
});
