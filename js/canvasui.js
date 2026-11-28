// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// New canvas, Open canvas and Make a canvas from this area (File menu), and the view's detail button while a canvas is open. A
// canvas is sculpted and painted with the area tools and cut into pieces in Pieces mode (piecesui.js); Export, Check paths and
// Publish take its pieces.

import { CanvasArea, MAX_TILES, MIN_TILES, canvasNameOk } from './canvas.js';
import { createCanvas, listCanvases, loadCanvas } from './canvassave.js';
import { windowAt } from './canvasview.js';
import { engine, NEEDS_ENGINE } from './api.js';
import { $, el, say } from './dom.js';

/** What app.js gives this file (initCanvas): `area()`, `me()`, `readOnly()`, `setArea(a)`, `flushSave()` and the `view`. */
let ctx = null;

/** The new canvas dialog's note (show() changes it for Make a canvas from this area). */
const NEW_NOTE =
    'A landscape larger than one area, up to 128 by 128 tiles, sculpted and painted as one, then cut into areas in its Pieces mode.';
/** The least room round an area made a canvas: its band, so the piece cut out carries the same halo. */
const MIN_ROOM = 5;

// Buttons that act on one area, off while a canvas is open (Export, Check paths and Publish take the canvas's pieces).
const AREA_ONLY = ['btnDelete', 'btnVersion'];

export function initCanvas(c) {
    ctx = c;
    $('btnNewCanvas').onclick = () => show('new');
    $('btnOpenCanvas').onclick = () => show('open');
    $('btnCanvasFromArea').onclick = () => show('from');
    $('canvasGo').onclick = () => ($('canvasFrom').hidden ? create() : fromArea());
    $('canvasRoom').oninput = roomShown;
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
    // (a canvas grows from an open area's band; a cave or an interior has none)
    $('btnCanvasFromArea').disabled = !!a.canvas || a.enclosed();
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

/** Opens the dialog to make a canvas (`new`), to make one from the area open (`from`), or to pick one to open (`open`). */
async function show(mode) {
    const dlg = $('canvasDialog'),
        open = mode === 'open',
        from = mode === 'from',
        a = ctx.area();
    $('canvasTitle').textContent = open ? 'Open a canvas' : from ? `Make a canvas from ${a.name}` : 'New canvas';
    $('canvasNote').textContent = from
        ? `${a.name} becomes the canvas's first piece, where it is, with its band and everything on it: exported, that piece is ${a.name} as it is now. ${a.name} itself stays as it is. Its tags stay too, so its doors keep theirs.`
        : NEW_NOTE;
    $('canvasNew').hidden = open;
    $('canvasShape').hidden = from;
    $('canvasFrom').hidden = !from;
    if (from) {
        // (a canvas's name can't be an area's: the area's own, shortened, or with cv)
        $('canvasName').value = a.name.length > 7 ? a.name.slice(0, 7) : `${a.name.slice(0, 5)}cv`;
        roomShown();
    }
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

/** The canvas's size the room round the area makes, under the box. */
function roomShown() {
    const a = ctx.area(),
        room = Math.round(+$('canvasRoom').value),
        w = a.tiles + 2 * room,
        h = a.tilesY + 2 * room;
    $('canvasFromSize').textContent =
        w > MAX_TILES || h > MAX_TILES
            ? `${w}×${h} tiles: a canvas is at most ${MAX_TILES} each way.`
            : `The canvas: ${w}×${h} tiles, ${a.name} (${a.tiles}×${a.tilesY}) in its middle.`;
}

/** Makes a canvas from the area open, as the dialog says, on the engine, and opens it. The area is left as it is. */
async function fromArea() {
    const a = ctx.area(),
        name = $('canvasName').value.trim(),
        room = Math.round(+$('canvasRoom').value),
        msg = $('canvasMsg');
    const wrong = !canvasNameOk(name)
        ? 'The name is 1 to 7 lower case letters, digits or _.'
        : !(room >= MIN_ROOM)
          ? `At least ${MIN_ROOM} tiles of room round it: its band is that wide.`
          : !engine.up
            ? NEEDS_ENGINE
            : '';
    if (wrong) {
        msg.textContent = wrong;
        return;
    }
    $('canvasGo').disabled = true;
    msg.textContent = `Making ${name} from ${a.name}…`;
    try {
        await ctx.flushSave();
        const c = CanvasArea.fromArea(a, name, room);
        await createCanvas(c, ctx.me());
        $('canvasDialog').close();
        ctx.setArea(c);
        say(`Made canvas ${name} (${c.tiles}×${c.tilesY} tiles) from ${a.name}, its first piece. ${a.name} is as it was.`);
    } catch (err) {
        msg.textContent = `Couldn't make ${name}: ${err.message}`;
    } finally {
        $('canvasGo').disabled = false;
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
