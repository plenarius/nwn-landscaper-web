// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Entrance tool: a click carves an entrance into the ground (entrance.js shapes it), and its panel says where each
// entrance's door leads.

import { TILE, SPACING } from './area.js';
import { carve, fitInTile, rockFor, at as entranceAt, nearest as nearestEntrance } from './entrance.js';
import { api } from './api.js';
import { $, el } from './dom.js';
import { saveSoon } from './save.js';
import { waterChanged } from './water.js';

/** What app.js gives this file (initEntranceTool): `area()`, `view`, the texture `library` and the brush's `sizeIn` slider. */
let ctx = null;

let entranceRender = 0;
/** The Entrance panel: this area's entrances and where each leads. */
export async function showEntrances() {
    // Only the latest of overlapping renders fills the panel.
    const mine = ++entranceRender;
    const box = $('entranceList');
    if (!ctx.area().entrances.length) {
        box.innerHTML = '<p class="note">No entrances yet.</p>';
        return;
    }
    let doors = [];
    try {
        doors = (await (await api(`/api/doors?module=${encodeURIComponent(ctx.area().module || ctx.area().name)}`)).json()).doors ?? [];
    } catch {
        /* none */
    }
    if (mine !== entranceRender) return;
    box.textContent = '';
    ctx.area().entrances.forEach((e, k) => {
        const tag = `${ctx.area().name}_ent${k + 1}`;
        const row = document.createElement('div');
        row.className = 'entrance-row';
        const others = doors.filter(d => !d.tag.startsWith(`${ctx.area().name}_ent`));
        const select = el('select', {}, new Option("(not linked here: the toolset's link stays)", ''));
        for (const d of others) select.add(new Option(`${d.tag} (area ${d.area})`, d.tag, e.link === d.tag, e.link === d.tag));
        if (e.link && !others.some(d => d.tag === e.link)) select.add(new Option(e.link, e.link, true, true));
        row.append(
            el('b', { textContent: `Entrance ${k + 1}` }),
            el('span', {}, 'door ', el('code', { textContent: tag }), ' leads to'),
            select,
        );
        select.onchange = ev => {
            ctx.area().beginStroke();
            e.link = ev.target.value || undefined;
            saveSoon();
        };
        box.appendChild(row);
    });
    if (!doors.length)
        box.append(
            el('p', {
                className: 'note',
                textContent: `No other entrance doors in module ${ctx.area().module} yet: export the other area into it first.`,
            }),
        );
}

// Entrances: a click on a slope carves one facing into it (where it
// rises); on flat ground, facing away from the camera. Shift removes the
// one clicked (its carving stays: Undo takes it back).
/** In a cave, the direction from p to the nearest wall (ground a metre
 *  or more above the floor there) within 5 m, or null. */
function nearestWall(p) {
    const floor = ctx.area().heightAt(p.x, p.y);
    let best = null,
        bestD = Infinity;
    for (let k = 0; k < 32; k++) {
        const a = (k * Math.PI) / 16;
        for (let d = 0.3; d <= 5; d += 0.3) {
            if (ctx.area().heightAt(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d) > floor + 1) {
                if (d < bestD) {
                    bestD = d;
                    best = a;
                }
                break;
            }
        }
    }
    return best;
}

/** The Entrance tool's press on the ground at `p` (metres): adds a cave entrance there, or with Shift removes the nearest.
 *  `e` is the pointer event. */
export function entranceDown(e, p) {
    if (e.shiftKey) {
        const hit = nearestEntrance(ctx.area().entrances, p.x, p.y);
        if (!hit) return;
        ctx.area().beginStroke();
        ctx.area().entrances = ctx.area().entrances.filter(x => x !== hit);
        ctx.view.updateEntrances();
        showEntrances();
        ctx.view.updateShade();
        saveSoon();
        return;
    }
    // In a cave: on the floor beside a wall, not on the rock (the void).
    const ci = Math.min(ctx.area().nx - 1, Math.round(p.x / SPACING)),
        cj = Math.min(ctx.area().ny - 1, Math.round(p.y / SPACING));
    if (ctx.area().void(ci, cj)) {
        $('statusMsg').textContent = 'In a cave, click the floor right beside a wall: the entrance is carved into that wall.';
        return;
    }
    const gx = ctx.area().heightAt(p.x + 1, p.y) - ctx.area().heightAt(p.x - 1, p.y);
    const gy = ctx.area().heightAt(p.x, p.y + 1) - ctx.area().heightAt(p.x, p.y - 1);
    let dir;
    const wall = ctx.area().enclosed() ? nearestWall(p) : null;
    if (wall !== null) {
        dir = wall;
    } else if (Math.hypot(gx, gy) > 0.1) {
        dir = Math.atan2(gy, gx);
    } else {
        const c = ctx.view.camera.position;
        dir = Math.atan2(ctx.area().sizeY - c.z - p.y, c.x - p.x) + Math.PI;
    }
    const ent = { x: p.x, y: p.y, dir, width: Math.min(8, Math.max(2.5, +ctx.sizeIn.value)), depth: 4, floor: 0 };
    // Inside one tile, for the game's pathfinding; the floor where it lands.
    const moved = fitInTile(ent, TILE, ctx.area().sizeX, ctx.area().sizeY);
    ent.floor = ctx.area().heightAt(ent.x, ent.y);
    ctx.area().beginStroke();
    ctx.area().entrances.push(ent);
    // Rock that suits the slope: what's painted right behind the mouth.
    const [bx, by] = entranceAt(ent, ent.depth + 2, 0);
    const bi = Math.min(ctx.area().nx - 1, Math.max(0, Math.round(bx / SPACING))),
        bj = Math.min(ctx.area().ny - 1, Math.max(0, Math.round(by / SPACING)));
    const ground = ctx.area().palette[ctx.area().materials[bj * ctx.area().nx + bi]];
    ent.rock = rockFor(ctx.library.byId.get(ground)?.category, ground, id => ctx.library.byId.has(id));
    const rock = ent.rock ? ctx.area().materialIndex(ent.rock) : undefined;
    ctx.view.markDirty(carve(ctx.area(), ent, rock));
    ctx.view.syncPalette();
    if (ctx.area().water.length) waterChanged();
    ctx.view.updateEntrances();
    ctx.view.updateShade();
    showEntrances();
    $('statusMsg').textContent =
        `Entrance ${ctx.area().entrances.length}: its door will be tagged ${ctx.area().name}_ent${ctx.area().entrances.length}` +
        (moved > 0.05 ? ` (moved ${moved.toFixed(1)} m to sit inside one tile)` : '');
    saveSoon();
}

/** Gives the Entrance tool the editor. */
export function initEntranceTool(c) {
    ctx = c;
}
