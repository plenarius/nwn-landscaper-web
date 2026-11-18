// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Sky & fog panel: the area's light and fog by day and by night (presets, or its own colours), and the strength of the
// shadows baked into its tiles. The panel opening and closing is app.js's (one panel at a time over the view).

import { PRESETS, copyPreset } from './atmosphere.js';
import { $, el, store } from './dom.js';

/** What app.js gives this file (initSky): `area()`, `view` and `saveSoon()`. */
let ctx = null;

let skyNight = false;

/** The sun's settings by day, the moon's by night. */
const currentSky = () => (skyNight ? ctx.area().atmosphere.moon : ctx.area().atmosphere.sun);

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
    // Whether the view shows the area's light and fog (else a plain working
    // light, no fog), remembered.
    $('skyPreview').checked = store.get('landscaper.skyPreview') !== 'off';
    $('skyPreview').onchange = () => {
        store.set('landscaper.skyPreview', $('skyPreview').checked ? 'on' : 'off');
        showSky();
    };
}
