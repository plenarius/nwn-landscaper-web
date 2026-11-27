// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Ambience tool's panel: the particle pack's kinds (the brush's kind, and the ones Fill and Clear take), the density, the
// wind, and the particles the area keeps alive. The rules and the brush are ambience.js's; the stroke is strokes.js's.

import { AREA_LIVE_HEAVY, WINDS, FILL_KINDS, kindsOf, liveOf, fill, clearKinds, ambienceStamp, isTreeName } from './ambience.js';
import { api, json, engine, NEEDS_ENGINE } from './api.js';
import { $, el } from './dom.js';

/** What app.js gives this file (initAmbienceTool): `area()`, `readOnly()`, `view`, `models()` (the placeables, place.js),
 *  `library` (the textures), `saveSoon()` and `say(text)`. */
let ctx = null;

/** The pack's kinds (ambience.js kindsOf); null until the engine gave them, [] when it has no pack. */
let kinds = null;
/** Why there are none, when the engine has no pack. */
let packError = '';
/** The brush's kind (an id), and the kinds Fill and Clear take. */
let brushKind = null;
const ticked = new Set();

/** The pack's kinds, once loaded (an empty list before). */
export const ambienceKinds = () => kinds ?? [];

/** Asks the engine for the particle pack once it is there; draws the area's placements in their colours. */
export async function loadParticles() {
    if (kinds?.length) return kinds;
    const res = await api('/api/particles');
    if (res.ok) {
        kinds = kindsOf(await json(res));
        packError = kinds.length ? '' : 'The particle pack has no kinds.';
    } else {
        kinds = [];
        packError =
            res.status === 404 && engine.up
                ? ((await json(res)).error ?? '') ||
                  'This engine has no particle pack route: the Ambience tool needs a newer Landscaper engine.'
                : NEEDS_ENGINE;
    }
    brushKind ??= kinds[0]?.id ?? null;
    if (!ticked.size) for (const k of kinds) if (FILL_KINDS.includes(k.id)) ticked.add(k.id);
    ctx.view.setAmbienceKinds(kinds);
    if (open) showAmbienceTool();
    return kinds;
}

// Whether the panel is open: the view then shows the placements out of their hours as dots.
let open = false;

/** Opens or closes the panel (app.js, as tools change). */
export function setAmbienceOpen(on) {
    if (!ctx || (on === open && !on)) return;
    open = on;
    ctx.view.setAmbienceKinds(ambienceKinds(), on);
    if (!on) return;
    if (!kinds?.length) loadParticles();
    showAmbienceTool();
}

const density = () => +$('ambienceDensity').value;
const wind = () => +$('ambienceWind').value;

/** The particles alive by day and at night, and past AREA_LIVE_HEAVY a note that the area may be heavy: information only. */
function showLive(a) {
    const live = liveOf(a.ambience, ambienceKinds()),
        heavy = Math.max(live.day, live.night) > AREA_LIVE_HEAVY,
        n = v => Math.round(v).toLocaleString('en');
    $('ambienceLive').textContent =
        `Particles alive: ${n(live.day)} by day, ${n(live.night)} at night.` +
        (heavy ? ` Over ${n(AREA_LIVE_HEAVY)}, an area may be heavy on slower machines (a guide, not a limit).` : '');
    $('ambienceLive').classList.toggle('heavy', heavy);
    return live;
}

/** Shows the panel for the open area: each kind with how many it has, the brush's kind, and the live count. */
export function showAmbienceTool() {
    const a = ctx?.area();
    if (!a) return;
    const box = $('ambienceKinds');
    box.textContent = '';
    if (!kinds) {
        box.textContent = 'Asking the engine for the particle pack…';
        loadParticles();
        return;
    }
    $('ambienceNote').textContent = packError;
    const count = new Map();
    for (const p of a.ambience) count.set(p.kind, (count.get(p.kind) ?? 0) + 1);
    for (const k of kinds) {
        const tick = el('input', { type: 'checkbox', checked: ticked.has(k.id), title: 'Fill and Clear take this kind' });
        tick.onchange = () => {
            if (tick.checked) ticked.add(k.id);
            else ticked.delete(k.id);
        };
        const dot = el('span', { className: 'amb-dot' });
        dot.style.background = `linear-gradient(90deg, ${k.day} 50%, ${k.night} 50%)`;
        const hours = k.shows === 'night' ? ' (night)' : k.shows === 'day' ? ' (day)' : '';
        const pick = el(
            'button',
            { type: 'button', className: `amb-kind${k.id === brushKind ? ' active' : ''}`, title: `${k.where}. The brush places it.` },
            dot,
            el('span', { className: 'amb-name', textContent: `${k.name}${hours}` }),
            el('small', { textContent: count.get(k.id) ? String(count.get(k.id)) : '' }),
        );
        pick.onclick = () => {
            brushKind = k.id;
            showAmbienceTool();
        };
        box.append(el('div', { className: 'amb-row' }, tick, pick));
    }
    // A kind the pack lacks (another pack, or a renamed kind): the export skips it.
    const unknown = [...count.keys()].filter(id => !kinds.some(k => k.id === id));
    if (unknown.length)
        box.append(
            el('p', {
                className: 'note',
                textContent: `Not in the pack, so not exported: ${unknown.map(id => `${id} (${count.get(id)})`).join(', ')}.`,
            }),
        );
    showLive(a);
}

/** What Fill reads of the area beyond its ground: the placeables' names (trees, fires), the trees' crowns and the textures'
 *  categories. The trees' models are read first, for their size. */
async function fillEnv(a) {
    const models = ctx.models();
    await models.load();
    const names = new Map(models.list.map(p => [p.model, `${p.name} ${p.label} ${p.model}`]));
    const nameOf = o => names.get(o.model) ?? o.model ?? '';
    const crowns = new Map();
    await Promise.all(
        [...new Set(a.objects.filter(o => isTreeName(nameOf(o))).map(o => o.model))].map(m =>
            models.flat(m).then(
                f => crowns.set(m, Math.max(f.max[0] - f.min[0], f.max[1] - f.min[1]) / 2),
                () => {},
            ),
        ),
    );
    return {
        nameOf,
        crownOf: o => (crowns.has(o.model) ? crowns.get(o.model) * (o.scale ?? 1) : null),
        categoryOf: id => ctx.library.byId.get(id)?.category ?? '',
    };
}

/** The brush, a frame of a stroke at area point `p` (strokes.js): adds or (Shift) clears the brush kind's placements. Returns
 *  whether anything changed. */
export function ambienceBrush(p, radius, erase) {
    const a = ctx.area(),
        k = ambienceKinds().find(q => q.id === brushKind);
    if (!a || !k) return false;
    const r = ambienceStamp(a, k, p.x, p.y, radius, { erase, density: density(), wind: wind() });
    if (!r.added && !r.removed) return false;
    ctx.view.updateAmbience();
    showAmbienceTool();
    return true;
}

/** What the brush needs before a stroke: a kind from the pack. Says why not, and returns false, when there is none. */
export function ambienceReady() {
    if (ambienceKinds().some(k => k.id === brushKind)) return true;
    ctx.say(packError || 'Pick a kind in the panel first.');
    return false;
}

/** Sets up the panel. `c`: see `ctx`. */
export function initAmbienceTool(c) {
    ctx = c;
    for (const [name, bearing] of WINDS) $('ambienceWind').appendChild(el('option', { value: bearing, textContent: name }));
    const showDensity = () => ($('ambienceDensityOut').textContent = `${Math.round(density() * 100)}%`);
    $('ambienceDensity').oninput = showDensity;
    showDensity();
    $('ambienceFill').onclick = async () => {
        const a = ctx.area();
        if (!a || ctx.readOnly() || !kinds?.length) return;
        const ids = kinds.filter(k => ticked.has(k.id)).map(k => k.id);
        if (!ids.length) return ctx.say('Tick the kinds to fill first.');
        ctx.say('Filling…');
        const env = await fillEnv(a);
        if (ctx.area() !== a) return;
        a.beginStroke();
        const r = fill(a, kinds, ids, { density: density(), wind: wind(), env });
        ctx.view.updateAmbience();
        ctx.saveSoon();
        showAmbienceTool();
        const where = ids
            .filter(id => FILL_KINDS.includes(id))
            .map(id => `${r.byKind.get(id)} ${kinds.find(k => k.id === id).name.toLowerCase()}`)
            .join(', ');
        ctx.say(
            r.placed
                ? `Filled: ${where}. Fill again for others; undo takes them back.`
                : 'Fill found no place for these kinds here (water, trees, grass, crests or hollows: see each kind).',
        );
    };
    $('ambienceClear').onclick = () => {
        const a = ctx.area();
        if (!a || ctx.readOnly()) return;
        a.beginStroke();
        const gone = clearKinds(a, [...ticked]);
        ctx.view.updateAmbience();
        ctx.saveSoon();
        showAmbienceTool();
        ctx.say(gone ? `Cleared ${gone} placements.` : 'None of the ticked kinds are placed.');
    };
}
