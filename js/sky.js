// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Sky & fog panel: the area's light and fog by day and by night (presets, or its own colours), its sky, and the strength
// of the shadows baked into its tiles. The panel opening and closing is app.js's (one panel at a time over the view).
//
// The sky: a preset sets it (atmosphere.js), and the Sky row shows it and offers the others, the engine's installed
// Landscaper skies and the module's own skyboxes.2da rows (/api/skies), with a strip of its picture (/api/sky-picture/).

import { PRESETS, copyPreset, installedSkies, setInstalledSkies } from './atmosphere.js';
import { api } from './api.js';
import { $, el, store } from './dom.js';

/** What app.js gives this file (initSky): `area()`, `view` and `saveSoon()`. */
let ctx = null;

let skyNight = false;

/** Whether the Sky & fog panel shows the area's light by night. */
export const skyShowsNight = () => skyNight;

/** The sun's settings by day, the moon's by night. */
const currentSky = () => (skyNight ? ctx.area().atmosphere.moon : ctx.area().atmosphere.sun);

/** The module's own rows of skyboxes.2da, as /api/skies gives them: `{ row, name }`. */
let gameSkies = [];

/** Asks the engine again which skies there are (a sky pack may have been installed meanwhile), then shows them. */
async function loadSkies() {
    const res = await api('/api/skies').catch(() => null);
    if (!res?.ok) return;
    const body = await res.json().catch(() => ({}));
    setInstalledSkies(Array.isArray(body.skies) ? body.skies : []);
    gameSkies = (Array.isArray(body.game) ? body.game : []).filter(r => Number.isInteger(r?.row) && typeof r.name === 'string');
    if (ctx.area()) showSky();
}

/** Area `a`'s sky: `{ sky }` an installed (or wanted) Landscaper sky's id, `{ row }` a row of the game's, or `{ kept }` when its
 *  light and fog pick none, so its settings' row (or, null, its original's) stays. */
export function chosenSky(a) {
    const at = a.atmosphere;
    if (typeof at.sky === 'string' && at.sky) return { sky: at.sky };
    if (Number.isInteger(at.skyRow)) return { row: at.skyRow };
    const r = a.settings?.skyBox;
    return { kept: Number.isInteger(r) ? r : null };
}

/** The engine's picture of sky `c` (chosenSky) by day or `night`: `strip` (the panel's) or `panorama` (the view's); null for none. */
export function skyPicture(c, night, kind) {
    const key = c.sky ?? c.row ?? c.kept ?? null;
    if (key === null) return null;
    const name = typeof key === 'string' ? key : `row-${key}`;
    return `/api/sky-picture/${encodeURIComponent(name)}?time=${night ? 'night' : 'day'}&kind=${kind}`;
}

const gameSkyName = row => gameSkies.find(r => r.row === row)?.name ?? `Row ${row}`;
const presetName = id => PRESETS.find(p => p.id === id)?.name;

/** The Sky row: the area's sky picked in its list, its picture, and what to know about it. Hidden under ground. */
function showSkyRow() {
    const a = ctx.area(),
        box = $('skySky');
    box.hidden = a.enclosed();
    if (box.hidden) {
        ctx.view.setSky?.(null);
        return;
    }
    const c = chosenSky(a);
    const pick = $('skyPick');
    pick.textContent = '';
    const ours = el('optgroup', { label: 'Landscaper skies' }),
        game = el('optgroup', { label: "The game's skies" });
    for (const s of installedSkies) {
        const suits = presetName(s.preset);
        ours.append(new Option(suits && suits !== s.name ? `${s.name} (for ${suits})` : s.name, `sky:${s.id}`));
    }
    if (c.sky && !installedSkies.some(s => s.id === c.sky)) ours.append(new Option(`${c.sky} (not installed)`, `sky:${c.sky}`));
    for (const r of gameSkies) game.append(new Option(r.name, `row:${r.row}`));
    if (c.row != null && !gameSkies.some(r => r.row === c.row)) game.append(new Option(`Row ${c.row}`, `row:${c.row}`));
    if ('kept' in c) pick.append(new Option(c.kept === null ? "The original area's" : `As the area has it: ${gameSkyName(c.kept)}`, ''));
    if (ours.children.length) pick.append(ours);
    if (game.children.length) pick.append(game);
    pick.value = c.sky ? `sky:${c.sky}` : c.row != null ? `row:${c.row}` : '';

    const strip = $('skyStrip'),
        url = skyPicture(c, skyNight, 'strip');
    strip.hidden = !url;
    if (url && strip.getAttribute('src') !== url) strip.src = url;

    const p = PRESETS.find(q => q.id === a.atmosphere.preset);
    let note = '';
    if (c.sky && !installedSkies.some(s => s.id === c.sky))
        note = "This sky isn't installed here, so the area won't export: install its sky pack, or pick another.";
    else if (p?.sky && c.row === p.skyRow && !installedSkies.some(s => s.id === p.sky))
        note = `${p.name}'s own sky comes with the Preset skies pack (made from your Real Skies download): until it is installed, the game's ${gameSkyName(c.row)}.`;
    $('skyNote').textContent = note;
    $('skyNote').hidden = !note;
    ctx.view.setSky?.($('skyPreview').checked ? skyPicture(c, skyNight, 'panorama') : null);
}

function showSky() {
    const a = ctx.area().atmosphere,
        s = currentSky();
    for (const b of $('skyPresets').children) b.classList.toggle('active', b.dataset.preset === a.preset);
    for (const b of $('dayNight').children) b.classList.toggle('active', (b.dataset.night === '1') === skyNight);
    for (const r of document.querySelectorAll('[name=skyTime]')) r.checked = r.value === a.time;
    $('skyWhich').textContent = skyNight ? 'Moon (night)' : 'Sun (day)';
    $('skyAmbient').value = s.ambient;
    $('skyDiffuse').value = s.diffuse;
    $('skyFog').value = s.fog;
    $('skyFogAmount').value = s.fogAmount;
    $('skyFogOut').textContent =
        s.fogAmount === 0
            ? 'light'
            : s.fogAmount < 10
              ? `${s.fogAmount} · some`
              : s.fogAmount < 20
                ? `${s.fogAmount} · heavy`
                : `${s.fogAmount} · thick`;
    $('skyShadows').checked = s.shadows;
    $('shadowStrength').value = ctx.area().shadow;
    $('shadowOut').textContent = ctx.area().shadow > 0 ? `${Math.round(ctx.area().shadow * 100)}%` : 'off';
    $('skyClip').value = a.fogClip;
    $('skyClipOut').textContent = `${a.fogClip} m`;
    ctx.view.setAtmosphere($('skyPreview').checked ? a : null, skyNight);
    showSkyRow();
}

/** Shows area `a`'s light and fog in the panel and the view, by night when its time is night. Called when an area opens. */
export function showAreaSky(a) {
    skyNight = a.atmosphere.time === 'night';
    dragging = null;
    showSky();
}

/** Shows the open area's light and fog again after undo or redo, and its shadows' strength. */
export function refreshSky() {
    dragging = null;
    showSky();
}

// Each change is one undo step. A slider dragged or a colour picked sends many `input` events and one `change` at the end:
// they make one step, as the Place tool's size slider does.
let dragging = null;
/** Takes the undo step for a change made with `field`: once per drag when `drag` is true, else every time. */
function step(field, drag) {
    if (drag && dragging === field) return;
    ctx.area().beginStroke();
    dragging = drag ? field : null;
}

function skyChanged() {
    showSky();
    ctx.saveSoon();
}

// Hand edits make it the area's own look. `e`: the field's event (`input` events are part of a drag).
function editSky(e, change) {
    step(e.target, e.type === 'input');
    change(ctx.area().atmosphere, currentSky());
    ctx.area().atmosphere.preset = 'custom';
    skyChanged();
}
let shadeTimer = null;

/** Builds the presets and wires the panel's fields. `c`: { area(), view, saveSoon() } from app.js. */
export function initSky(c) {
    ctx = c;
    for (const p of PRESETS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'preset';
        b.dataset.preset = p.id;
        const s = p.time === 'night' ? p.moon : p.sun;
        const look = el('span', { className: 'look' });
        look.style.background = `linear-gradient(${s.diffuse}, ${s.fog} 70%, ${s.ambient})`;
        b.append(look, el('span', { textContent: p.name }));
        b.onclick = () => {
            step(b, false);
            ctx.area().atmosphere = copyPreset(p);
            skyNight = p.time === 'night';
            skyChanged();
        };
        $('skyPresets').appendChild(b);
    }

    $('skyPick').onchange = e => {
        step(e.target, false);
        const a = ctx.area().atmosphere,
            v = e.target.value;
        delete a.sky;
        delete a.skyRow;
        if (v.startsWith('sky:')) a.sky = v.slice(4);
        else if (v.startsWith('row:')) a.skyRow = Number(v.slice(4));
        skyChanged();
    };
    // (A picture the engine can't make, such as a game sky whose model isn't there, leaves no broken image.)
    $('skyStrip').onerror = () => {
        $('skyStrip').hidden = true;
    };
    loadSkies();
    // Back from installing a sky pack on the command line: the list is the engine's again.
    window.addEventListener('focus', () => loadSkies());

    $('skyAmbient').oninput = e =>
        editSky(e, (_a, s) => {
            s.ambient = e.target.value;
        });
    $('skyDiffuse').oninput = e =>
        editSky(e, (_a, s) => {
            s.diffuse = e.target.value;
        });
    $('skyFog').oninput = e =>
        editSky(e, (_a, s) => {
            s.fog = e.target.value;
        });
    $('skyFogAmount').oninput = e =>
        editSky(e, (_a, s) => {
            s.fogAmount = +e.target.value;
        });
    $('skyShadows').onchange = e =>
        editSky(e, (_a, s) => {
            s.shadows = e.target.checked;
        });
    $('skyClip').oninput = e =>
        editSky(e, a => {
            a.fogClip = +e.target.value;
        });
    // Not part of the .are's settings: baked into the tiles.
    $('shadowStrength').oninput = e => {
        step(e.target, true);
        ctx.area().shadow = +e.target.value;
        showSky();
        clearTimeout(shadeTimer);
        shadeTimer = setTimeout(() => ctx.view.updateShade(true), 150);
        ctx.saveSoon();
    };
    // The end of a drag: the next change is another step.
    for (const id of ['skyAmbient', 'skyDiffuse', 'skyFog', 'skyFogAmount', 'skyClip', 'shadowStrength'])
        $(id).addEventListener('change', () => {
            if (dragging === $(id)) dragging = null;
        });
    for (const r of document.querySelectorAll('[name=skyTime]')) {
        r.onchange = e =>
            editSky(e, a => {
                a.time = r.value;
                // Show what the game will.
                if (r.value !== 'cycle') skyNight = r.value === 'night';
            });
    }
    for (const b of $('dayNight').children)
        b.onclick = () => {
            skyNight = b.dataset.night === '1';
            showSky();
        };
    // Whether the view shows the area's light and fog (else a plain working light, no fog), remembered. Off until the builder
    // ticks it: an area always opens in light to work in, whatever its own (a cave by night opened black).
    $('skyPreview').checked = store.get('landscaper.skyPreview') === 'on';
    $('skyPreview').onchange = () => {
        store.set('landscaper.skyPreview', $('skyPreview').checked ? 'on' : 'off');
        showSky();
    };
}
