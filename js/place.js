// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Place tool: placeables found by a search and put down one at a time (baked into the tiles or as game objects), and the
// selected one moved, turned, sized or removed (G / R / S, the handles, the numbers in its panel).

import { ModelLibrary } from './models.js';
import { Transformer } from './transform.js';
import { engine, NEEDS_ENGINE } from './api.js';
import { $, el } from './dom.js';
import { saveSoon } from './save.js';

/** What app.js gives this file (initPlace): `area()`, `tool()` and `view`. */
let ctx = null;

/** The placeables the engine found in the game (placeables.2da), and their models. */
export let models = null;
/** Moves, turns and sizes the selected object. */
export let transformer = null;
let placeModel = null;
/** Searches offered as buttons over the Place and Scatter panels' results. */
export const QUICK = ['rock', 'boulder', 'tree', 'bush', 'ruin', 'pillar', 'statue', 'fence'];

/** Search results as big swatches in `box`, each calling `pick(model)`. */
export async function modelResults(box, query, pick) {
    await models.load();
    box.textContent = '';
    if (!models.list.length) box.textContent = engine.up ? 'No placeables: the engine found none in the game.' : NEEDS_ENGINE;
    for (const p of models.search(query)) {
        const b = document.createElement('button');
        b.className = 'swatch';
        b.dataset.model = p.model;
        b.title = `${p.name} (${p.model})`;
        b.append(el('img', { className: 'thumb', alt: '' }), el('span', { textContent: p.name }));
        b.onclick = () => pick(p.model);
        box.appendChild(b);
        models.thumbnail(p.model).then(url => {
            if (url) b.querySelector('img').src = url;
        });
    }
}

let placeShown = null;
/** Fills the Place panel with the placeables matching its search box (rocks when empty), unless they already show. */
export async function showPlaceables() {
    const query = $('placeSearch').value.trim() || 'rock';
    if (query === placeShown) return;
    placeShown = query;
    await modelResults($('placeResults'), query, selectPlaceable);
    selectPlaceable(placeModel);
}
function selectPlaceable(model) {
    placeModel = model;
    for (const b of $('placeResults').children) b.classList.toggle('active', b.dataset.model === model);
}

let searchTimer = null;
/** Runs `fn` (a search) 250 ms after the last call: one timer for the Place and Scatter search boxes. */
export function searchSoon(fn) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(fn, 250);
}
const showScale = () => {
    $('placeScaleOut').textContent = `${Math.round($('placeScale').value * 100)}%`;
};

/** Where object `o` sits: on the ground under it; an imported thing (a
 *  tree, a rock) on the ground at its middle, as the import stood it; an
 *  imported tile's cliffs and blocked ground (heights built in) where it is. */
function settle(o, flat) {
    if (flat.fixed) return o.z;
    return o.model.startsWith('@import:') ? ctx.area().heightAt(o.x, o.y) : groundUnder(o, flat);
}

/** Ground under an object: the lowest point under its outline, so it doesn't float on a slope. */
export function groundUnder(o, flat) {
    const c = Math.cos(o.bearing),
        s = Math.sin(o.bearing);
    const corners = [
        [flat.min[0], flat.min[1]],
        [flat.max[0], flat.min[1]],
        [flat.min[0], flat.max[1]],
        [flat.max[0], flat.max[1]],
        [0, 0],
    ];
    return Math.min(...corners.map(([x, y]) => ctx.area().heightAt(o.x + (c * x - s * y) * o.scale, o.y + (s * x + c * y) * o.scale)));
}

/** Removes placed object `o` from the area (undoable), and deselects it. */
export function removeObject(o) {
    ctx.area().beginStroke();
    ctx.area().objects = ctx.area().objects.filter(x => x !== o);
    if (ctx.view.selected === o) selectObject(null);
    ctx.view.updateObjects();
    saveSoon();
}

/** The place mode the panel shows: baked (true) or object (false). */
const placeBaked = () => $('placeMode').querySelector('.active')?.dataset.baked !== '0';
function showPlaceMode(baked) {
    for (const b of $('placeMode').children) b.classList.toggle('active', (b.dataset.baked === '1') === baked);
}

/** placeables.2da's row of a model (placeable mode's appearance). */
export const appearanceOf = model => models.list?.find(p => p.model === model)?.row;

/** Selects placed object `o` (null: none): its handles, its panel and the keys it takes on the status line. */
export function selectObject(o) {
    ctx.view.select(o);
    transformer.show(o);
    showObjectPanel(o);
    if (o) {
        $('placeScale').value = o.scale;
        showScale();
        showPlaceMode(o.baked !== false);
        $('placeSolid').checked = o.solid !== false;
        $('statusMsg').textContent =
            `${o.model} (${o.baked === false ? `placeable, tag ${ctx.area().name}_p${o.id}` : 'baked'}): drag to move · G move · R turn · S size (or the handles) · Q/E turn 15° · Delete removes · Esc deselects`;
    } else {
        $('statusMsg').textContent = '';
    }
}

/** The Place tool's press on the ground at `p` (metres): selects the object under the pointer (Shift: removes it), or places
 *  the chosen model. Resolves to what placeDrag() needs, or null when there is nothing to drag. `e` is the pointer event. */
export async function placeDown(e, p) {
    // On an object: Shift removes it, else select it and drag to move it.
    const hit = ctx.view.pickObject(e.clientX, e.clientY);
    if (hit && e.shiftKey) {
        removeObject(hit);
        return null;
    }
    if (hit) {
        // Its undo step is taken when the drag first moves it: a click that only selects it makes none.
        selectObject(hit);
        return { object: hit, flat: await models.flat(hit.model), from: p, move: { dx: hit.x - p.x, dy: hit.y - p.y } };
    }
    if (e.shiftKey) {
        let best = null,
            bd = 2.5;
        for (const o of ctx.area().objects) {
            const d = Math.hypot(o.x - p.x, o.y - p.y);
            if (d < bd) {
                best = o;
                bd = d;
            }
        }
        if (best) removeObject(best);
        return null;
    }
    if (!placeModel) {
        $('statusMsg').textContent = 'Pick a placeable in the panel first.';
        return null;
    }
    let flat;
    try {
        flat = await models.flat(placeModel);
    } catch {
        $('statusMsg').textContent = `${placeModel} can't be read.`;
        return null;
    }
    const o = {
        id: ctx.area().nextObjectId++,
        model: placeModel,
        appearance: appearanceOf(placeModel),
        x: p.x,
        y: p.y,
        z: 0,
        bearing: $('placeRandom').checked ? Math.random() * Math.PI * 2 : 0,
        scale: +$('placeScale').value,
        solid: $('placeSolid').checked,
        baked: placeBaked(),
    };
    o.z = groundUnder(o, flat);
    ctx.area().beginStroke();
    ctx.area().objects.push(o);
    // Not selected: the panel's settings are for the next one (selecting it
    // made changing them change this one instead). Click it to edit it.
    selectObject(null);
    ctx.view.updateObjects();
    saveSoon();
    return { object: o, flat, from: p };
}

/** Dragging a new object turns it (towards the pointer); dragging a selected one moves it, kept on the ground. `s` is what
 *  placeDown() gave. */
export function placeDrag(e, s) {
    const p = ctx.view.pick(e.clientX, e.clientY);
    if (!p) return;
    if (s.move) {
        if (!s.stepped) {
            if (Math.hypot(p.x - s.from.x, p.y - s.from.y) < 0.05) return;
            ctx.area().beginStroke();
            s.stepped = true;
        }
        s.object.x = Math.min(ctx.area().sizeX, Math.max(0, p.x + s.move.dx));
        s.object.y = Math.min(ctx.area().sizeY, Math.max(0, p.y + s.move.dy));
    } else {
        if (Math.hypot(p.x - s.from.x, p.y - s.from.y) < 0.3) return;
        s.object.bearing = Math.atan2(p.y - s.from.y, p.x - s.from.x);
    }
    s.object.z = settle(s.object, s.flat);
    ctx.view.updateObjects();
}

/** Changes the selected object with `change(o)` (undoable), then settles it on the ground and saves. False when nothing is
 *  selected. `step`: false to add to the undo step taken before (a slider being dragged takes one step for the drag). */
export async function changeSelected(change, step = true) {
    const o = ctx.view.selected;
    if (!o) return false;
    if (step) ctx.area().beginStroke();
    change(o);
    o.z = settle(o, await models.flat(o.model));
    ctx.view.updateObjects();
    saveSoon();
    return true;
}

// --- Moving, turning and sizing the selected placeable (G / R / S, handles, numbers) ---------------------------------

/** The selected object's numbers in the Place panel (or hides them). */
function showObjectPanel(o) {
    $('objPanel').hidden = !o;
    if (!o) return;
    $('objX').value = o.x.toFixed(2);
    $('objY').value = o.y.toFixed(2);
    $('objAngle').value = (((((o.bearing * 180) / Math.PI) % 360) + 360) % 360).toFixed(1);
    $('objScale').value = o.scale.toFixed(2);
}

/** Sets up the Place panel. */
export function initPlace(c) {
    ctx = c;
    models = new ModelLibrary();
    transformer = new Transformer({
        view: ctx.view,
        area: () => ctx.area(),
        flat: o => models.flat(o.model),
        settle: (o, flat) => settle(o, flat),
        say: msg => {
            $('statusMsg').textContent = msg;
        },
        changed: (o, final) => {
            showObjectPanel(o);
            if (final) {
                ctx.area().objects.includes(o) && saveSoon();
            }
        },
    });
    ctx.view.models = models;
    for (const q of QUICK) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = q;
        b.onclick = () => {
            $('placeSearch').value = q;
            showPlaceables();
        };
        $('placeChips').appendChild(b);
    }
    $('placeSearch').oninput = () => searchSoon(showPlaceables);
    // The selected object takes the size too: one undo step for a drag of the slider (each input event took one, and 40 of
    // them pushed every earlier step out of the history). `change` ends the drag (or one key press).
    let sizing = false;
    $('placeScale').oninput = () => {
        showScale();
        if (ctx.view.selected && ctx.tool() === 'place') {
            changeSelected(o => {
                o.scale = +$('placeScale').value;
            }, !sizing);
            sizing = true;
        }
    };
    $('placeScale').onchange = () => {
        sizing = false;
    };
    showScale();
    for (const b of $('placeMode').children) {
        b.onclick = () => {
            showPlaceMode(b.dataset.baked === '1');
            // The selected object takes the mode too.
            if (ctx.view.selected)
                changeSelected(o => {
                    o.baked = b.dataset.baked === '1';
                }).then(() => ctx.view.select(ctx.view.selected));
        };
    }

    $('placeSolid').onchange = () => {
        if (ctx.view.selected && ctx.tool() === 'place')
            changeSelected(o => {
                o.solid = $('placeSolid').checked;
            });
    };
    $('objX').onchange = () =>
        changeSelected(o => {
            o.x = Math.min(ctx.area().sizeX, Math.max(0, +$('objX').value));
        }).then(() => showObjectPanel(ctx.view.selected));
    $('objY').onchange = () =>
        changeSelected(o => {
            o.y = Math.min(ctx.area().sizeY, Math.max(0, +$('objY').value));
        }).then(() => showObjectPanel(ctx.view.selected));
    $('objAngle').onchange = () =>
        changeSelected(o => {
            o.bearing = (+$('objAngle').value * Math.PI) / 180;
        }).then(() => showObjectPanel(ctx.view.selected));
    $('objScale').onchange = () =>
        changeSelected(o => {
            o.scale = Math.min(5, Math.max(0.1, +$('objScale').value || 1));
        }).then(() => {
            showObjectPanel(ctx.view.selected);
            if (ctx.view.selected) {
                $('placeScale').value = ctx.view.selected.scale;
                showScale();
            }
        });
}
