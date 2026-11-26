// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The pointer over the view: a press starts a stroke with the tool that is on (sculpt, paint, dig, a room, a ramp, a descent,
// water, an entrance, placing, scattering), dragging carries it on each frame, and letting go ends it. Also the right-click menu
// on a marker, the status line's position, and ?debug's pointer readout.

import { TILE, DEFAULT_TEXTURE, SHALLOW, CAVE_ROCK } from './area.js';
import { stamp, chasmStamp, chasmEdge, roomRect, cutRoom, rampPlan, cutRamp, descentPlan, cutDescent, DIG_MIN } from './tools.js';
import { ask } from './ask.js';
import { $, say } from './dom.js';
import { models, transformer, selectObject, placeDown, placeDrag } from './place.js';
import { scatterMix, scatterStamp } from './scatter.js';
import { mixPlan, mixStamp } from './mix.js';
import { waterDown, waterDrag, waterChanged } from './water.js';
import { entranceDown } from './entrancetool.js';
import { live } from './live.js';
import { saveSoon } from './save.js';

/** What app.js gives this file (initStrokes): `area()`, `tool()`, `readOnly()`, `view`, the Things tool (`thingsTool`),
 *  `selectTool(id)`, the Paint tool's `paintTexture()`, `mixOn()`, `currentMix()`, `picking()`, `setPicking(on)` and
 *  `pickTexture(p, add)`, the texture
 *  `library`, and the brush's `sizeIn` and `strengthIn` sliders. */
let ctx = null;

// ?debug: show what the pointer is doing (to diagnose input on other machines).
const debug = new URLSearchParams(location.search).has('debug');
const dbg = { last: '-', downs: 0, strokes: 0, stamps: 0, note: '' };
function showDebug() {
    if (!debug) return;
    say(`[debug] last: ${dbg.last} · downs ${dbg.downs} · strokes ${dbg.strokes} · stamps ${dbg.stamps} ${dbg.note}`);
}

let canvas = null;
let stroke = null; // { flattenTo, last }
let mouse = null; // last client position over the canvas
let rmb = null; // where and when a right-click began, to tell a click from a drag that turns the view
let placePointer = null; // the pointer whose Place press is waiting for its model

/** Sends pointer `pointerId`'s moves to the canvas until it is released, even off the canvas. The browser refuses a pointer that
 *  is no longer down; the stroke goes on without the capture, and ?debug shows the refusal. */
function capture(pointerId) {
    try {
        canvas.setPointerCapture(pointerId);
    } catch (err) {
        dbg.note = `(capture failed: ${err.message})`;
        showDebug();
    }
}

/** The stroke under way (null between strokes). */
export const currentStroke = () => stroke;
/** The handles' move or turn under way, the Place tool's or the Things tool's, or null. */
export const moving = () => (transformer.active ? transformer : ctx?.thingsTool.transformer.active ? ctx.thingsTool.transformer : null);

function closeCtx() {
    const m = $('ctxMenu');
    if (m) m.hidden = true;
}
function openCtx(x, y, hit) {
    const items = ctx.thingsTool.menuFor(hit);
    if (!items.length) return;
    const m = $('ctxMenu');
    m.textContent = '';
    for (const it of items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'menu-item';
        b.textContent = it.label;
        b.onclick = () => {
            closeCtx();
            ctx.selectTool('things');
            ctx.thingsTool.pick(hit);
            it.run();
        };
        m.appendChild(b);
    }
    m.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
    m.style.top = `${Math.min(y, window.innerHeight - items.length * 44 - 12)}px`;
    m.hidden = false;
}

/** The ramp tool's settings: the rise you typed (blank: to where the button comes up), and whether to keep it walkable. */
const rampOptions = () => ({ rise: $('rampRise').value === '' ? null : +$('rampRise').value, keepWalkable: $('rampWalkable').checked });
/** A ramp is twice the brush size wide, and at least as wide as the narrowest passage NWN's pathfinding keeps open. */
const rampWidth = () => Math.max(+ctx.sizeIn.value, DIG_MIN) * 2;
/** The descent tool's settings. */
const descentOptions = () => ({
    floors: Math.round(+$('descentFloors').value),
    drop: +$('descentDrop').value,
    flip: $('descentFlip').checked,
});
/** What a room or descent says when its floor can't take its texture. */
const FULL_PALETTE = 'this area has 255 textures, the most it can';
/**
 * The floor texture of a room or a descent (the Paint tool's when it is a floor, else old wood): its palette `index`, or
 * undefined to leave the floor as it is when the library lacks the texture, or when the area has 255 textures without it
 * (`bare`: the builder is told). Paint and Dig refuse to start then; a room or a descent is cut all the same.
 */
function floorPaint() {
    const id = ctx.library.byId.get(ctx.paintTexture())?.category === 'Floors' ? ctx.paintTexture() : 'woodOld';
    if (!ctx.library.byId.has(id)) return { index: undefined, bare: false };
    if (!ctx.area().canPaint(id)) return { index: undefined, bare: true };
    return { index: ctx.area().materialIndex(id), bare: false };
}
/** Ends the stroke under way: a room, ramp or descent is cut, the shadows and water follow the ground, and the area is saved
 *  a moment later. Also before another area opens, so a stroke never carries on into it. */
export const endStroke = () => {
    placePointer = null;
    if (ctx.thingsTool.drag) {
        ctx.thingsTool.up();
        return;
    }
    if (!stroke) return;
    if (stroke.ramp) {
        const plan = rampPlan(ctx.area(), stroke.ramp.from, stroke.ramp.to, rampOptions());
        const rect = cutRamp(ctx.area(), plan, rampWidth(), $('rampStairs').checked ? +$('rampStep').value : null, $('rampCarve').checked);
        if (rect) ctx.view.markDirty(rect);
        ctx.view.setRampPreview(null);
        say(
            ctx.area().enclosed() && rect && rect.changed < 20
                ? 'Nothing to lay it on there: dig or make a room first (or tick "Cut through rock").'
                : '',
        );
    }
    if (stroke.descent) {
        const plan = descentPlan(ctx.area(), stroke.descent.from, stroke.descent.to, descentOptions());
        ctx.view.setDescentPreview(null);
        if (plan.error) {
            say(plan.error);
        } else {
            // The same headroom all the way down, or the walls grow as the floors drop.
            const headroom = +$('descentCeiling').value;
            if (headroom >= 2 && headroom <= 20) ctx.area().clearance = headroom;
            const floor = floorPaint();
            const rect = cutDescent(ctx.area(), plan, floor.index);
            ctx.view.markDirty(rect);
            ctx.view.syncPalette();
            say(
                `A descent of ${plan.floors} floors, down to ${plan.bottom.toFixed(1)} m.` +
                    (floor.bare ? ` Its floors aren't painted: ${FULL_PALETTE}.` : ''),
            );
        }
    }
    if (stroke.room) {
        const r = roomRect(stroke.room.from, stroke.room.to, ctx.area().sizeX, ctx.area().sizeY);
        ctx.view.markDirty(cutRoom(ctx.area(), r, stroke.room.floor, stroke.paintIndex));
        ctx.view.setRoomOutline(null);
        ctx.view.syncPalette();
        say(stroke.bare ? `The room's floor isn't painted: ${FULL_PALETTE}.` : '');
    }
    // The ground moved: its shadows too.
    if (!stroke.water && !stroke.place && !stroke.scatter && stroke.tool !== 'paint') ctx.view.updateShade();
    // Sculpting may have flooded or drained hollows.
    if (!stroke.water && ctx.area().water.length && stroke.tool !== 'paint') waterChanged();
    if (stroke.water) say('');
    stroke = null;
    saveSoon();
};

/** Sets up the pointer handlers over the view. */
export function initStrokes(c) {
    ctx = c;
    if (debug) {
        for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'lostpointercapture']) {
            ctx.view.renderer.domElement.addEventListener(
                type,
                e => {
                    dbg.last = `${type} button=${e.button} buttons=${e.buttons} type=${e.pointerType ?? '-'}${e.ctrlKey ? ' ctrl' : ''}${e.altKey ? ' alt' : ''}`;
                    if (type === 'pointerdown') dbg.downs++;
                    showDebug();
                },
                true,
            );
        }
    }

    // ?debug: the editor's state for test scripts.
    if (debug)
        window.landscaper = {
            area: () => ctx.area(),
            view: ctx.view,
            live: () => live,
            select: o => selectObject(o),
            transformer,
            ask,
            things: ctx.thingsTool,
        };

    canvas = ctx.view.renderer.domElement;

    // The Chasm tool's "Along the whole edge": a chasm the brush size wide round the area.
    $('chasmEdge').onclick = () => {
        const a = ctx.area();
        if (!a || ctx.readOnly() || currentStroke()) return;
        if (a.enclosed()) {
            say('Chasms are for outdoor areas.');
            return;
        }
        a.beginStroke();
        ctx.view.markDirty(chasmEdge(a, +ctx.sizeIn.value));
        ctx.view.updateShade();
        if (a.water.length) waterChanged();
        saveSoon();
        say(`A chasm ${ctx.sizeIn.value} m wide round the edge. Shift-drag fills parts of it in.`);
    };

    canvas.addEventListener('pointerdown', e => {
        // Moving, turning or sizing the selected object: a click keeps it, a right click cancels.
        const busy = moving();
        if (busy) {
            e.preventDefault();
            if (e.button === 0) busy.confirm();
            else if (e.button === 2) busy.cancel();
            return;
        }
        // Its handles: the Place tool's selected object, or the Things tool's door or placeable.
        const handles =
            ctx.tool() === 'place' && ctx.view.selected
                ? transformer
                : ctx.tool() === 'things' && !ctx.readOnly()
                  ? ctx.thingsTool.transformer
                  : null;
        if (e.button === 0 && ctx.area() && handles) {
            const h = handles.pickHandle(e.clientX, e.clientY);
            if (h) {
                const p = ctx.view.pick(e.clientX, e.clientY);
                handles.last = { clientX: e.clientX, clientY: e.clientY };
                if (handles.begin(h.kind, h.axis, true, p ? { x: p.x, y: p.y } : null)) {
                    capture(e.pointerId);
                }
                return;
            }
        }
        if (e.button !== 0 || !ctx.area()) {
            dbg.note = `(ignored: button ${e.button})`;
            showDebug();
            return;
        }
        // A click on a marker that shows (the Show menu) selects it, from any tool: its properties open in the Things tool, as the
        // right-click menu does. (The Place tool has its own objects to pick.)
        // (Not when picking a texture up: a marker over the ground is not what is being asked about.)
        if (
            ctx.tool() !== 'things' &&
            ctx.tool() !== 'place' &&
            !ctx.readOnly() &&
            !(ctx.tool() === 'paint' && (ctx.picking() || e.altKey))
        ) {
            const hit = ctx.view.pickThing(e.clientX, e.clientY, true);
            if (hit != null) {
                e.preventDefault();
                ctx.selectTool('things');
                ctx.thingsTool.pick(hit);
                return;
            }
        }
        mouse = { x: e.clientX, y: e.clientY };
        const p = ctx.view.pick(e.clientX, e.clientY);
        if (!p) {
            dbg.note = '(down missed the terrain)';
            showDebug();
            return;
        }
        if (ctx.tool() === 'things') {
            if (!ctx.readOnly() && ctx.thingsTool.down(e, p)) {
                capture(e.pointerId);
            }
            return;
        }
        // Someone else's workspace, read-only: nothing can change (and nothing would be saved). Picking a texture up still works.
        if (ctx.readOnly() && !(ctx.tool() === 'paint' && (ctx.picking() || e.altKey))) {
            say("You are looking at someone else's area, read-only: it can't be changed here.");
            return;
        }
        if (ctx.tool() === 'entrance') {
            entranceDown(e, p);
            return;
        }
        if (ctx.tool() === 'scatter') {
            if (!e.shiftKey && !scatterMix.size) {
                say('Add models to the mix in the panel first.');
                return;
            }
            ctx.area().beginStroke();
            const scatter = { erase: e.shiftKey, flats: null };
            stroke = { scatter, last: 0 };
            Promise.all(
                [...scatterMix].map(m =>
                    models.flat(m).then(
                        f => [m, f],
                        () => null,
                    ),
                ),
            ).then(list => {
                scatter.flats = list.filter(Boolean);
            });
            capture(e.pointerId);
            return;
        }
        if (ctx.tool() === 'place') {
            const pointerId = e.pointerId;
            // Placing waits for the model: a quick click may be released first,
            // and must not leave a drag running (it turned the next object).
            placePointer = pointerId;
            placeDown(e, p).then(s => {
                if (s && placePointer === pointerId) {
                    stroke = { place: s };
                    capture(pointerId);
                }
            });
            return;
        }
        if (ctx.tool() === 'water') {
            const w = waterDown(e, p);
            if (w) {
                stroke = { water: w };
                capture(e.pointerId);
            }
            return;
        }
        if (ctx.tool() === 'chasm') {
            if (ctx.area().enclosed()) {
                say('Chasms are for outdoor areas: in a cave or an interior, dig and leave rock instead.');
                return;
            }
            ctx.area().beginStroke();
            // Shift fills it in. The brush stays at the level where it started (see View.pickLevel).
            stroke = { tool: 'chasm', fill: e.shiftKey, level: p.z, last: performance.now() };
            capture(e.pointerId);
            return;
        }
        // The eyedropper (its button, the I key, or Alt-click): one click picks the texture, no paint goes down. With Shift it goes
        // into the mix, and the eyedropper stays on for the next.
        if (ctx.tool() === 'paint' && (ctx.picking() || e.altKey)) {
            e.preventDefault();
            if (!e.shiftKey) ctx.setPicking(false);
            ctx.pickTexture(p, e.shiftKey);
            return;
        }
        // A mix: all its textures must fit in the area's palette before the stroke starts.
        const mix = ctx.tool() === 'paint' && ctx.mixOn() ? ctx.currentMix() : null;
        if (mix) {
            const ids = mix.textures.map(t => t.id);
            if (!ids.length) {
                say('The mix is empty: click textures in the panel to add them, or choose One texture.');
                return;
            }
            const missing = ids.filter(id => !ctx.area().palette.includes(id)).length;
            if (ctx.area().palette.length + missing > 255) {
                say(`This area has room for ${255 - ctx.area().palette.length} more textures; the mix needs ${missing}.`);
                return;
            }
        }
        // A texture the area has no room for (255 at most) stops the stroke before it starts, not halfway with no paint.
        const texture = {
            paint: mix ? null : ctx.paintTexture(),
            dig: ctx.paintTexture() === DEFAULT_TEXTURE ? 'dirt' : ctx.paintTexture(),
        }[ctx.tool()];
        if (texture && !ctx.area().canPaint(texture)) {
            say('This area has 255 textures, the most it can: paint with one it already has.');
            return;
        }
        ctx.area().beginStroke();
        // The tool is kept with the stroke: it is the one that stamps until the button comes up.
        stroke = { tool: ctx.tool(), flattenTo: ctx.area().heightAt(p.x, p.y), last: performance.now() };
        if (ctx.tool() === 'paint') {
            if (mix)
                stroke.mix = mixPlan(
                    mix,
                    mix.textures.map(t => ctx.area().materialIndex(t.id)),
                );
            else stroke.paintIndex = ctx.area().materialIndex(ctx.paintTexture());
            ctx.view.syncPalette();
        }
        if (ctx.tool() === 'ramp') {
            // From here to where the button comes up; laid then.
            stroke.ramp = { from: p, to: p };
        }
        if (ctx.tool() === 'descent') {
            // The box from here to where the button comes up; filled then.
            stroke.descent = { from: p, to: p };
        }
        if (ctx.tool() === 'room') {
            // From here to where the button comes up; cut out then.
            // Started in a room: its floor (the lowest ground within 2 m, not a
            // point up its wall), else in the rock: the area's floor.
            let start = Infinity;
            for (let dy = -2; dy <= 2; dy += 0.5) {
                for (let dx = -2; dx <= 2; dx += 0.5) {
                    if (dx * dx + dy * dy <= 4)
                        start = Math.min(
                            start,
                            ctx
                                .area()
                                .heightAt(
                                    Math.min(ctx.area().sizeX, Math.max(0, p.x + dx)),
                                    Math.min(ctx.area().sizeY, Math.max(0, p.y + dy)),
                                ),
                        );
                }
            }
            stroke.room = {
                from: p,
                to: p,
                floor: ctx.area().enclosed() && start >= ctx.area().roof - 0.5 ? ctx.area().roof - CAVE_ROCK : start,
            };
            const floor = floorPaint();
            stroke.paintIndex = floor.index;
            stroke.bare = floor.bare;
            ctx.view.setRoomOutline(roomRect(p, p, ctx.area().sizeX, ctx.area().sizeY), stroke.room.floor);
        }
        if (ctx.tool() === 'dig') {
            // Down to the floor, or to the level of dug ground where it starts;
            // the floor painted with the picked texture (dirt unless painted).
            const start = ctx.area().heightAt(p.x, p.y);
            stroke.flattenTo = ctx.area().enclosed() && start >= ctx.area().roof - 0.5 ? ctx.area().roof - CAVE_ROCK : start;
            stroke.paintIndex = ctx.area().materialIndex(texture);
            ctx.view.syncPalette();
        }
        dbg.strokes++;
        dbg.note = '';
        showDebug();
        capture(e.pointerId);
    });
    // A right-click that doesn't move (a drag turns the view) on a marker: its menu, from any tool.
    canvas.addEventListener('pointerdown', e => {
        if (e.button === 2) rmb = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    canvas.addEventListener('pointerup', e => {
        if (e.button !== 2 || !rmb) return;
        const moved = Math.hypot(e.clientX - rmb.x, e.clientY - rmb.y),
            quick = performance.now() - rmb.t < 600;
        rmb = null;
        if (moved > 4 || !quick || !ctx.area() || ctx.readOnly()) return;
        const hit = ctx.view.pickThing(e.clientX, e.clientY, true);
        if (hit == null) {
            closeCtx();
            return;
        }
        openCtx(e.clientX, e.clientY, hit);
    });
    document.addEventListener(
        'pointerdown',
        e => {
            if (!e.target.closest('#ctxMenu')) closeCtx();
        },
        true,
    );
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeCtx();
    });

    canvas.addEventListener('pointermove', e => {
        mouse = { x: e.clientX, y: e.clientY };
        // A marker you can click shows a pointer, whichever tool is on.
        if (ctx.tool() !== 'things' && ctx.tool() !== 'place' && !stroke && !moving() && ctx.area() && !ctx.readOnly() && e.buttons === 0)
            canvas.style.cursor = ctx.view.pickThing(e.clientX, e.clientY, true) != null ? 'pointer' : '';
        transformer.move(e);
        ctx.thingsTool.transformer.move(e);
        if (ctx.thingsTool.drag) {
            const p = ctx.view.pick(e.clientX, e.clientY);
            if (p) ctx.thingsTool.move(p);
        }
        if (stroke?.water) waterDrag(e, stroke.water);
        if (stroke?.place) placeDrag(e, stroke.place);
        if (stroke?.ramp) {
            const p = ctx.view.pick(e.clientX, e.clientY);
            if (p) {
                stroke.ramp.to = p;
                const plan = rampPlan(ctx.area(), stroke.ramp.from, p, rampOptions());
                ctx.view.setRampPreview(plan, rampWidth());
                const dir = plan.dh > 0.05 ? 'up' : plan.dh < -0.05 ? 'down' : 'level';
                say(
                    `Ramp ${plan.len.toFixed(1)} m long, ${dir} ${Math.abs(plan.dh).toFixed(2)} m: ${plan.degrees.toFixed(0)}°${plan.eased ? ' (eased: it was too steep or too high)' : ''}`,
                );
            }
        }
        if (stroke?.descent) {
            const p = ctx.view.pick(e.clientX, e.clientY);
            if (p) {
                stroke.descent.to = p;
                const plan = descentPlan(ctx.area(), stroke.descent.from, p, descentOptions());
                ctx.view.setDescentPreview(plan);
                say(
                    plan.error ??
                        `${plan.floors} floors, ${plan.drop} m apart: ramps of ${plan.pitch.toFixed(0)} m at ${plan.degrees.toFixed(0)}°, the lowest at ${plan.bottom.toFixed(1)} m`,
                );
            }
        }
        if (stroke?.room) {
            const p = ctx.view.pick(e.clientX, e.clientY);
            if (p) {
                stroke.room.to = p;
                const r = roomRect(stroke.room.from, p, ctx.area().sizeX, ctx.area().sizeY);
                ctx.view.setRoomOutline(r, stroke.room.floor);
                say(`Room ${(r.x1 - r.x0).toFixed(2)} × ${(r.y1 - r.y0).toFixed(2)} m`);
            }
        }
    });
    canvas.addEventListener('pointerleave', () => {
        mouse = null;
        ctx.view.setCursor(null);
        $('statusPos').textContent = '';
    });
    canvas.addEventListener('pointerup', () => {
        if (moving()?.held) {
            moving().confirm();
            return;
        }
        endStroke();
    });
    canvas.addEventListener('pointercancel', () => {
        if (moving()?.held) {
            moving().cancel();
            return;
        }
        endStroke();
    });

    ctx.view.onFrame = () => {
        if (ctx.view.selected) transformer.place(ctx.view.selected);
        ctx.thingsTool.frame();
        if (!ctx.area() || !mouse) return;
        const p = stroke?.tool === 'chasm' ? ctx.view.pickLevel(mouse.x, mouse.y, stroke.level) : ctx.view.pick(mouse.x, mouse.y);
        const radius = +ctx.sizeIn.value;
        ctx.view.setCursor(p, radius);
        if (p) {
            const tx = Math.floor(p.x / TILE),
                ty = Math.floor(p.y / TILE);
            const { i, j } = ctx.area().sampleAt(p.x, p.y);
            const walk = ctx.area().walkable(i, j),
                deep = ctx.area().depth(i, j);
            const what = ctx.area().isChasm(i, j)
                ? 'a chasm: nobody walks here'
                : deep > SHALLOW
                  ? `water ${deep.toFixed(1)} m deep: too deep to walk`
                  : deep > 0
                    ? `shallow water ${deep.toFixed(1)} m: wading`
                    : walk
                      ? 'walkable'
                      : 'too steep to walk';
            $('statusPos').textContent =
                `x ${p.x.toFixed(1)} m · y ${p.y.toFixed(1)} m · height ${p.z.toFixed(1)} m · tile ${tx},${ty} · ${what}`;
        }
        if (stroke?.scatter && p) {
            scatterStamp(p, radius, stroke.scatter);
            dbg.stamps++;
            return;
        }
        if (stroke && p && !stroke.water && !stroke.place && !stroke.room && !stroke.ramp && !stroke.descent) {
            const now = performance.now();
            const dt = (now - stroke.last) / 1000;
            stroke.last = now;
            ctx.view.markDirty(
                stroke.tool === 'chasm'
                    ? chasmStamp(ctx.area(), p.x, p.y, radius, stroke.fill)
                    : stroke.mix
                      ? mixStamp(ctx.area(), p.x, p.y, radius, +ctx.strengthIn.value, stroke.mix)
                      : stamp(ctx.area(), stroke.tool, p.x, p.y, radius, +ctx.strengthIn.value, dt, stroke.flattenTo, stroke.paintIndex),
                stroke.tool !== 'paint',
            );
            dbg.stamps++;
            if (dbg.stamps % 10 === 0) showDebug();
        }
    };
}
