// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Placeables whose models the engine doesn't have (an area made with other haks, or a model the web demo lacks): drawn as boxes
// (models.js), and said once per area in a line over the view, not once per object.

import { $ } from './dom.js';
import { web } from './web.js';

/** What app.js gives this file (initMissingModels): `area()` and `models` (the model library, place.js). */
let ctx = null;
/** The areas whose notice was closed this visit (by name). */
const closed = new Set();
let timer = null;

/** The notice's text for `count` placeables of `models` (their model names), in the page (`inPage`) or with the engine on
 *  the builder's computer. */
export function missingText(count, models, inPage = web.on) {
    const some = models.slice(0, 3).join(', ') + (models.length > 3 ? ', …' : '');
    const they = count > 1 ? `${count} placeables use models` : 'A placeable uses a model';
    return inPage
        ? `${they} this page doesn't have (${some}). They show as boxes, don't block paths here, and an export leaves the baked ones out. The Landscaper on your computer, with the game and the haks they come from, has them.`
        : `${they} the Landscaper can't find in the game or its haks (${some}). They show as boxes, don't block paths, and an export leaves the baked ones out until the Landscaper reads the hak that has them.`;
}

/** The open area's placeables with a missing model: `{ count, models }` (models in the order first placed). */
export function missingIn(area, missing) {
    const hit = (area?.objects ?? []).filter(o => missing.has(o.model));
    return { count: hit.length, models: [...new Set(hit.map(o => o.model))] };
}

/** Shows or hides the notice for the open area (soon: models found missing arrive one by one as the view draws them). */
export function showMissingModels() {
    clearTimeout(timer);
    timer = setTimeout(() => {
        const area = ctx?.area();
        const { count, models } = missingIn(area, ctx?.models?.missing ?? new Set());
        const box = $('missingModels');
        box.hidden = !count || closed.has(area?.name);
        if (count) $('missingModelsText').textContent = missingText(count, models);
    }, 150);
}

/** Sets up the notice. */
export function initMissingModels(c) {
    ctx = c;
    c.models.onMissing = showMissingModels;
    $('missingModelsClose').onclick = () => {
        closed.add(ctx.area()?.name);
        $('missingModels').hidden = true;
    };
}
