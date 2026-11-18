// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Water tool: bodies of water, each filling the hollow around the point it was started at up to its level.

import { SPACING } from './area.js';
import { $ } from './dom.js';
import { saveSoon } from './save.js';

/** What app.js gives this file (initWater): `area()` and `view`. */
let ctx = null;

// How much a body's level moves per pixel the pointer is dragged (m).
const LEVEL_PER_PIXEL = 0.03;

/** The Water tool's press at `p` (metres): starts a body there or takes the one clicked; Shift drains it. Returns what
 *  waterDrag() needs, or null. `e` is the pointer event. */
export function waterDown(e, p) {
    const i = Math.min(Math.max(Math.round(p.x / SPACING), 0), ctx.area().nx - 1);
    const j = Math.min(Math.max(Math.round(p.y / SPACING), 0), ctx.area().ny - 1);
    const body = ctx.area().bodyAt(i, j);
    if (e.shiftKey) {
        if (!body) return null;
        ctx.area().beginStroke();
        ctx.area().water = ctx.area().water.filter(b => b !== body);
        waterChanged();
        saveSoon();
        return null;
    }
    let b = body;
    if (!b) {
        ctx.area().beginStroke();
        b = { i, j, level: ctx.area().heights[j * ctx.area().nx + i] + 0.3 };
        ctx.area().water.push(b);
        waterChanged();
    }
    // A body that was there takes its undo step with its first change of level: a click that only takes it changes nothing,
    // and must not empty Redo.
    return { body: b, startY: e.clientY, startLevel: b.level, ground: ctx.area().heights[b.j * ctx.area().nx + b.i], stepped: !body };
}

/** Dragging up or down sets the body's level. `w` is what waterDown() gave. */
export function waterDrag(e, w) {
    const level = Math.max(w.ground + 0.05, w.startLevel + (w.startY - e.clientY) * LEVEL_PER_PIXEL);
    if (!w.stepped) {
        if (level === w.body.level) return;
        ctx.area().beginStroke();
        w.stepped = true;
    }
    w.body.level = level;
    waterChanged();
    $('statusMsg').textContent =
        `Water level ${w.body.level.toFixed(2)} m (${(w.body.level - w.ground).toFixed(1)} m deep where you clicked)`;
}

/** Floods the water again after a change and redraws it. */
export function waterChanged() {
    ctx.area().floodWater();
    ctx.view.updateWater();
    ctx.view.markDirty(ctx.view.everything());
}

/** Gives the Water tool the editor. */
export function initWater(c) {
    ctx = c;
}
