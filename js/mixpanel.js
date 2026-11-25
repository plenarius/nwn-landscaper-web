// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Paint panel's mix (mix.js paints it): One texture or Mix at its top, and under Mix a strip of the mix's textures, each with
// its weight and a button that takes it out, then the patch size, the soft edge and Reshuffle. The strip sits at the top of the
// panel and stays there as the library scrolls under it, so the mix shows whichever categories are collapsed. The mix is kept in
// this browser (dom.js's store, under MIX_KEY), the same for every area: the area file only holds what was painted.

import { $, el, say, store } from './dom.js';
import {
    MIX_KEY,
    PATCH_MIN,
    PATCH_MAX,
    WEIGHT_MIN,
    WEIGHT_MAX,
    readMix,
    writeMix,
    keptTextures,
    toggledTexture,
    withoutTexture,
    withWeight,
    shiftAdded,
    shares,
    withTexture,
} from './mix.js';

/** What app.js gives this file (initMixPanel): the texture `library`, the `paintTexture()` painted with alone, and
 *  `changed()`, called after the mix or its mode changed (to mark the swatches and the strength's label). */
let ctx = null;

let mix = readMix(store.get(MIX_KEY));

/** The mix as it is now (mix.js's shape). */
export const currentMix = () => mix;
/** Whether the brush paints the mix (Mix is on), not one texture. */
export const mixOn = () => mix.on;

function set(next) {
    mix = next;
    store.set(MIX_KEY, writeMix(mix));
    for (const t of mix.textures) ctx.library.layerPixels(t.id).catch(() => {});
    showMix();
    ctx.changed();
}

/** A click on texture `id`'s swatch: with Mix on, or with Shift, it goes in or out of the mix; false when the click is not the
 *  mix's (One texture, no Shift), and the swatch picks the one texture as before. */
export function mixClick(id, shift) {
    if (!mix.on && !shift) return false;
    set(mix.on ? toggledTexture(mix, id) : shiftAdded(mix, id, ctx.paintTexture()));
    if (!mix.textures.length) say('The mix is empty: click textures to add them.');
    return true;
}

/** Turns Mix off (`on` false: the brush paints one texture again) or on. */
export function setMixOn(on) {
    if (mix.on !== on) set({ ...mix, on });
}

/** The eyedropper with Shift: texture `id`, picked up from the ground, goes into the mix (Mix comes on). */
export function mixPicked(id) {
    set(shiftAdded(mix, id, ctx.paintTexture()));
}

/** The library changed (loaded, a pack came or went): textures it no longer has leave the mix. */
export function mixLibraryChanged() {
    if (!ctx.library.catalog.length) return;
    const kept = keptTextures(mix, id => ctx.library.byId.has(id));
    if (kept !== mix) set(kept);
    else showMix();
}

/** Shows the mode, the strip and the settings as the mix is. */
function showMix() {
    $('paintOne').classList.toggle('active', !mix.on);
    $('paintOne').setAttribute('aria-pressed', String(!mix.on));
    $('paintMix').classList.toggle('active', mix.on);
    $('paintMix').setAttribute('aria-pressed', String(mix.on));
    $('mixPanel').hidden = !mix.on;
    $('mixPatch').value = mix.patch;
    $('mixPatchOut').textContent = `${(+mix.patch).toFixed(1)} m`;
    $('mixSoft').checked = mix.soft;
    const strip = $('mixStrip');
    strip.textContent = '';
    const parts = shares(mix);
    mix.textures.forEach((t, k) => {
        const tex = ctx.library.byId.get(t.id);
        const name = tex?.name ?? t.id;
        const weight = el('input', {
            type: 'range',
            min: String(WEIGHT_MIN),
            max: String(WEIGHT_MAX),
            step: '1',
            value: String(t.weight),
            title: `${name}'s weight`,
            ariaLabel: `${name}'s weight`,
        });
        const share = el('output', { textContent: `${Math.round(parts[k] * 100)}%` });
        weight.oninput = () => {
            mix = withWeight(mix, t.id, +weight.value);
            const now = shares(mix);
            strip.querySelectorAll('output').forEach((o, n) => {
                o.textContent = `${Math.round(now[n] * 100)}%`;
            });
        };
        weight.onchange = () => set(mix);
        strip.append(
            el(
                'div',
                { className: 'mix-row', title: tex ? `${name} (${tex.category})` : name },
                tex ? el('img', { alt: '', src: ctx.library.swatchUrl(t.id) }) : el('span', { className: 'img' }),
                el('span', { className: 'name', textContent: name }),
                weight,
                share,
                el('button', {
                    type: 'button',
                    className: 'remove',
                    textContent: '×',
                    title: `Take ${name} out of the mix`,
                    ariaLabel: `Take ${name} out of the mix`,
                    onclick: () => set(withoutTexture(mix, t.id)),
                }),
            ),
        );
    });
    if (!mix.textures.length) strip.append(el('p', { className: 'note', textContent: 'No textures yet: click them below.' }));
}

/** Sets up the mix's part of the Paint panel. */
export function initMixPanel(c) {
    ctx = c;
    $('paintOne').onclick = () => setMixOn(false);
    // Mix with nothing in it starts with the texture painted with.
    $('paintMix').onclick = () => set({ ...(mix.textures.length ? mix : withTexture(mix, ctx.paintTexture())), on: true });
    $('mixPatch').oninput = () => {
        mix = { ...mix, patch: Math.min(PATCH_MAX, Math.max(PATCH_MIN, +$('mixPatch').value)) };
        $('mixPatchOut').textContent = `${mix.patch.toFixed(1)} m`;
    };
    $('mixPatch').onchange = () => set(mix);
    $('mixSoft').onchange = () => set({ ...mix, soft: $('mixSoft').checked });
    $('mixClear').onclick = () => set({ ...mix, textures: [] });
    $('mixShuffle').onclick = () => {
        set({ ...mix, seed: (mix.seed % 1000000) + 1 + Math.floor(Math.random() * 1000) });
        say('Reshuffled: the next strokes lay the patches out anew. Ground painted before keeps its patches.');
    };
    showMix();
}
