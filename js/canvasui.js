// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// New canvas and Open canvas (File menu), and the view's detail button while a canvas is open. A canvas is sculpted and painted
// with the area tools; cutting it into areas, and so its export, check and publish, come with the pieces (step 6).

import { CanvasArea, MAX_TILES, MIN_TILES, canvasNameOk } from './canvas.js';
import { createCanvas, listCanvases, loadCanvas } from './canvassave.js';
import { windowAt } from './canvasview.js';
import { engine, NEEDS_ENGINE } from './api.js';
import { $, el, say } from './dom.js';

/** What app.js gives this file (initCanvas): `area()`, `me()`, `readOnly()`, `setArea(a)`, `flushSave()` and the `view`. */
let ctx = null;

// Buttons that act on one area, off while a canvas is open: a canvas is exported, checked and published by its pieces.
const AREA_ONLY = ['btnExport', 'btnCheck', 'btnPublish', 'btnDelete', 'btnVersion'];

export function initCanvas(c) {
    ctx = c;
    $('btnNewCanvas').onclick = () => show('new');
    $('btnOpenCanvas').onclick = () => show('open');
    $('canvasGo').onclick = create;
    $('btnDetail').onclick = () => {
        const on = $('btnDetail').getAttribute('aria-pressed') !== 'true';
        $('btnDetail').setAttribute('aria-pressed', String(on));
        $('btnDetail').classList.toggle('active', on);
        const v = ctx.view,
            a = ctx.area(),
            t = v.controls.target;
        v.setWindow(on ? windowAt(a, t.x, a.sizeY - t.z) : null);
    };
}

/** The open area changed to `a`: the detail button shows for a canvas, and the buttons for one area are off for it. */
export function canvasShown(a) {
    $('btnDetail').hidden = !a.canvas;
    $('btnDetail').setAttribute('aria-pressed', 'true');
    $('btnDetail').classList.toggle('active', !!a.canvas);
    for (const id of AREA_ONLY) {
        const b = $(id);
        if (!b) continue;
        if (a.canvas) {
            b.dataset.canvasOff = '1';
            b.disabled = true;
        } else if (b.dataset.canvasOff) {
            delete b.dataset.canvasOff;
            b.disabled = ctx.readOnly();
        }
    }
}

/** Opens the dialog to make a canvas (`new`) or to pick one to open (`open`). */
async function show(mode) {
    const dlg = $('canvasDialog'),
        open = mode === 'open';
    $('canvasTitle').textContent = open ? 'Open a canvas' : 'New canvas';
    $('canvasNew').hidden = open;
    $('canvasList').hidden = !open;
    $('canvasGo').hidden = open;
    $('canvasGo').disabled = false;
    $('canvasMsg').textContent = engine.up ? '' : NEEDS_ENGINE;
    dlg.showModal();
    if (!open) return;
    const list = $('canvasList');
    list.textContent = 'Loading…';
    try {
        const rows = await listCanvases();
        list.textContent = rows.length ? '' : 'No canvases yet: make one with New canvas.';
        for (const c of rows) {
            const b = el(
                'button',
                { type: 'button' },
                el('span', {}, el('b', { textContent: c.name })),
                el('small', { textContent: c.damaged ? `damaged: ${c.damaged}` : `${c.tiles}×${c.tilesY} tiles` }),
            );
            b.disabled = !!c.damaged;
            b.onclick = () => openCanvas(c.name);
            list.append(el('div', { className: 'open-row' }, b));
        }
    } catch (err) {
        list.textContent = err.message;
    }
}

/** Opens canvas `name` from the engine. */
async function openCanvas(name) {
    $('canvasMsg').textContent = `Opening ${name}…`;
    try {
        await ctx.flushSave();
        const t0 = performance.now();
        const { canvas, restored, stale } = await loadCanvas(name, ctx.me());
        $('canvasDialog').close();
        ctx.setArea(canvas);
        const took = ((performance.now() - t0) / 1000).toFixed(1);
        say(
            restored
                ? `Opened canvas ${name} with the changes this browser kept: they are saved now.`
                : stale
                  ? `Opened canvas ${name}. This browser kept changes to it from before it was saved elsewhere: they stay here, not applied.`
                  : `Opened canvas ${name} (${canvas.tiles}×${canvas.tilesY} tiles, ${took} s).`,
        );
        if (restored) ctx.saveSoon();
    } catch (err) {
        $('canvasMsg').textContent = `Couldn't open ${name}: ${err.message}`;
    }
}

/** Makes the canvas the dialog describes, on the engine, and opens it. */
async function create() {
    const name = $('canvasName').value.trim(),
        w = Math.round(+$('canvasW').value),
        h = Math.round(+$('canvasH').value),
        start = document.querySelector('input[name="canvasStart"]:checked')?.value ?? 'hills';
    const msg = $('canvasMsg');
    const wrong = !canvasNameOk(name)
        ? 'The name is 1 to 7 lower case letters, digits or _.'
        : !(w >= MIN_TILES && w <= MAX_TILES && h >= MIN_TILES && h <= MAX_TILES)
          ? `A canvas is ${MIN_TILES} to ${MAX_TILES} tiles each way.`
          : !engine.up
            ? NEEDS_ENGINE
            : '';
    if (wrong) {
        msg.textContent = wrong;
        return;
    }
    $('canvasGo').disabled = true;
    msg.textContent = `Making ${name}…`;
    try {
        await ctx.flushSave();
        const c = CanvasArea.create(name, w, start, 5, h);
        await createCanvas(c, ctx.me());
        $('canvasDialog').close();
        ctx.setArea(c);
        say(`Made canvas ${name}: ${w}×${h} tiles.`);
    } catch (err) {
        msg.textContent = `Couldn't make ${name}: ${err.message}`;
    } finally {
        $('canvasGo').disabled = false;
    }
}
