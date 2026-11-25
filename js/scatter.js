// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Scatter tool: a mix of placeables, picked in its panel, strewn under the brush at a density and a range of sizes (Shift
// clears them). The stroke itself is strokes.js's; this file stamps it.

import { $, say } from './dom.js';
import { QUICK, models, modelResults, fillSources, searchSoon, appearanceOf, groundUnder } from './place.js';
import { GROUPS } from './models.js';
import { basePoints } from './footing.js';

/** What app.js gives this file (initScatter): `area()` and `view`. */
let ctx = null;

/** The models in the mix (their names). */
export const scatterMix = new Set();

let scatterShown = null;
/** Fills the Scatter panel with the models matching its search box (rocks when empty), unless they already show. */
export async function showScatterables() {
    const query = $('scatterSearch').value.trim() || 'rock';
    const source = $('scatterFrom').value;
    if (scatterShown?.query === query && scatterShown.source === source) return;
    scatterShown = { query, source };
    const pick = model => {
        if (scatterMix.has(model)) scatterMix.delete(model);
        else scatterMix.add(model);
        markMix();
    };
    await modelResults($('scatterResults'), query, pick, { source, count: $('scatterCount'), shown: markMix, first: scatterMix });
    fillSources($('scatterFrom'));
    markMix();
}
function markMix() {
    for (const b of $('scatterResults').children) b.classList.toggle('active', scatterMix.has(b.dataset.model));
}

/** Whether the ground under object `o`'s base suits it: walkable and dry at every corner and the middle, not only under its
 *  origin (a bush at a lake's edge stood in the water). */
export function groundSuits(area, o, flat) {
    return basePoints(o, flat).every(([x, y]) => {
        const { i, j } = area.sampleAt(x, y);
        return area.walkable(i, j) && area.depth(i, j) <= 0;
    });
}

/** A few tries a frame at a random point in the brush; a try is kept when
 *  no object is nearer than the density's spacing and the ground suits.
 *  (Synchronous, with the mix's models loaded when the stroke began: each
 *  object is in before the next try checks the spacing.) */
export function scatterStamp(p, radius, s) {
    if (s.erase) {
        const gone = new Set(ctx.area().objects.filter(o => Math.hypot(o.x - p.x, o.y - p.y) <= radius));
        if (gone.size) {
            ctx.area().objects = ctx.area().objects.filter(o => !gone.has(o));
            ctx.view.removeObjects(gone);
        }
        return;
    }
    const mix = s.flats;
    if (!mix?.length) return;
    const spacing = Math.sqrt(100 / +$('scatterDensity').value);
    const lo = Math.min(+$('scatterMin').value, +$('scatterMax').value),
        hi = Math.max(+$('scatterMin').value, +$('scatterMax').value);
    for (let k = 0; k < 4; k++) {
        const a = Math.random() * Math.PI * 2,
            d = radius * Math.sqrt(Math.random());
        const x = p.x + Math.cos(a) * d,
            y = p.y + Math.sin(a) * d;
        if (x < 0.5 || y < 0.5 || x > ctx.area().sizeX - 0.5 || y > ctx.area().sizeY - 0.5) continue;
        if (ctx.area().objects.some(o => Math.hypot(o.x - x, o.y - y) < spacing)) continue;
        const [model, flat] = mix[Math.floor(Math.random() * mix.length)];
        const bearing = Math.random() * Math.PI * 2,
            scale = lo + Math.random() * (hi - lo);
        if ($('scatterSteep').checked && !groundSuits(ctx.area(), { x, y, bearing, scale }, flat)) continue;
        const o = {
            id: ctx.area().nextObjectId++,
            model,
            appearance: appearanceOf(model),
            x,
            y,
            z: 0,
            bearing,
            scale,
            solid: $('scatterSolid').checked,
            baked: true,
        };
        o.z = groundUnder(o, flat);
        ctx.area().objects.push(o);
        ctx.view.addObject(o);
    }
}

/** A group's chip makes the mix: a few of each kind of the group's plants (models.js groupMix), in place of the mix there was; they
 *  lead the results. */
function mixGroup(chip) {
    const mix = models.groupMix(GROUPS[chip], $('scatterFrom').value);
    if (!mix.length) return;
    scatterMix.clear();
    for (const m of mix) scatterMix.add(m);
    say(
        `The mix: ${mix.length} ${chip}, a few of each kind (no cacti or reeds: their own chip or a search finds them). Click one to take it out or add another.`,
    );
}

/** Sets up the Scatter panel. */
export function initScatter(c) {
    ctx = c;
    for (const q of QUICK) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = q;
        b.onclick = async () => {
            $('scatterSearch').value = q;
            if (GROUPS[q]) {
                // The mix first, so its models lead the results.
                await models.load();
                await models.loadGroups();
                mixGroup(q);
                scatterShown = null;
            }
            await showScatterables();
        };
        $('scatterChips').appendChild(b);
    }
    $('scatterSearch').oninput = () => searchSoon(showScatterables);
    $('scatterFrom').onchange = showScatterables;
    const showScatterSliders = () => {
        $('scatterDensityOut').textContent = `${$('scatterDensity').value} per 100 m²`;
        $('scatterMinOut').textContent = `${Math.round($('scatterMin').value * 100)}%`;
        $('scatterMaxOut').textContent = `${Math.round($('scatterMax').value * 100)}%`;
    };
    for (const id of ['scatterDensity', 'scatterMin', 'scatterMax']) $(id).oninput = showScatterSliders;
    showScatterSliders();
}
