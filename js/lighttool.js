// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Light tool's panel: the presets, the two colours the brush paints, and filling or clearing the whole area. The brush itself
// is strokes.js's (lightStamp in lights.js).

import { LIGHT_COLORS, LIGHT_PRESETS, lightKind, swatch, lightFill, litTiles } from './lights.js';
import { $, el } from './dom.js';

/** What app.js gives this file (initLightTool): `area()`, `readOnly()`, `view`, `night()` (whether the view shows the area's
 *  light by night), `saveSoon()` and `say(text)`. */
let ctx = null;

// The colours the brush paints: [light1, light2].
let pair = [30, 28];

/** The colours the brush paints, [light1, light2]. */
export const lightPair = () => pair;

/** Shows the panel for the open area: the colours, which presets suit it, and how many tiles are lit. */
export function showLightTool() {
    const a = ctx?.area();
    if (!a) return;
    $('light1').value = pair[0];
    $('light2').value = pair[1];
    $('light1Swatch').style.background = swatch(pair[0]);
    $('light2Swatch').style.background = swatch(pair[1]);
    const kind = lightKind(a, ctx.night());
    for (const b of $('lightPresets').children) {
        const p = LIGHT_PRESETS.find(q => q.id === b.dataset.preset);
        b.classList.toggle('active', p.lights[0] === pair[0] && p.lights[1] === pair[1]);
        b.classList.toggle('suits', p.kinds.includes(kind));
    }
    const lit = litTiles(a),
        all = a.tiles * a.tilesY;
    $('lightCount').textContent = lit ? `${lit} of ${all} tiles lit.` : 'No tile is lit: their lights are off (black).';
}

/** Sets up the panel. `c`: see `ctx`. */
export function initLightTool(c) {
    ctx = c;
    for (const p of LIGHT_PRESETS) {
        const look = el('span', { className: 'look' });
        look.style.background = `linear-gradient(90deg, ${swatch(p.lights[0])} 50%, ${swatch(p.lights[1])} 50%)`;
        const b = el('button', { type: 'button', className: 'preset', title: p.hint }, look, el('span', { textContent: p.name }));
        b.dataset.preset = p.id;
        b.onclick = () => {
            pair = [...p.lights];
            showLightTool();
        };
        $('lightPresets').appendChild(b);
    }
    for (const [k, id] of ['light1', 'light2'].entries()) {
        for (const l of LIGHT_COLORS) $(id).appendChild(el('option', { value: l.row, textContent: `${l.row} · ${l.name}` }));
        $(id).onchange = () => {
            pair = k === 0 ? [+$(id).value, pair[1]] : [pair[0], +$(id).value];
            showLightTool();
        };
    }
    // The whole area at once: one undo step.
    const fill = (with_, said) => {
        const a = ctx.area();
        if (!a || ctx.readOnly()) return;
        a.beginStroke();
        if (lightFill(a, with_)) {
            ctx.view.updateLights();
            ctx.saveSoon();
        }
        showLightTool();
        ctx.say(said);
    };
    $('lightFill').onclick = () => fill(pair, 'Every tile has these lights now. Shift-drag turns some off again.');
    $('lightClear').onclick = () => fill([0, 0], "Every tile's lights are off.");
}
