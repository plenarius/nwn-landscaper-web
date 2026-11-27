// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Textures an area is painted with that the open library hasn't got: an area from another library, or painted with starter
// textures a team's own library never had. The view draws them as a magenta checker (textures.js), never as a grey that passes
// for ground; a notice says which and how much of the ground each covers; its dialog adds starter ones from the game (an engine
// with /api/textures/starter, an admin on a team server) or swaps each for a library texture (one step of undo); and Export
// refuses with the same words, as the engine would refuse the area anyway.

import { api, failure, json } from './api.js';
import { DEFAULT_TEXTURE } from './area.js';
import { categoriesOf } from './palette.js';
import { $, el, say } from './dom.js';

/** The palette id of an imported area's own ground: drawn from the import's picture, never from the library. */
const IMPORT = '@import:';

/** Words in a texture's id and the starter category they point to, for an id whose category nothing else says. */
const CATEGORY_WORDS = [
    ['grass', 'Grass'],
    ['meadow', 'Grass'],
    ['dirt', 'Earth'],
    ['mud', 'Earth'],
    ['earth', 'Earth'],
    ['soil', 'Earth'],
    ['gravel', 'Earth'],
    ['sand', 'Sand'],
    ['dune', 'Sand'],
    ['silt', 'Sand'],
    ['snow', 'Snow'],
    ['ice', 'Snow'],
    ['rock', 'Rock'],
    ['stone', 'Rock'],
    ['cliff', 'Rock'],
    ['floor', 'Floors'],
    ['plank', 'Floors'],
    ['cobble', 'Floors'],
    ['wall', 'Walls'],
];

/**
 * The textures of `palette` the library lacks (`has(id)` false), each once in palette order, with `share`: the part of the
 * area's samples (`materials`, palette indices) painted with it, 0 to 1. An imported area's own ground isn't the library's.
 */
export function missingTextures(palette, materials, has) {
    const counts = new Map();
    for (const k of materials) counts.set(k, (counts.get(k) ?? 0) + 1);
    const out = [];
    palette.forEach((id, k) => {
        if (id.startsWith(IMPORT) || has(id)) return;
        const n = counts.get(k) ?? 0;
        const seen = out.find(m => m.id === id);
        if (seen) seen.samples += n;
        else out.push({ id, samples: n });
    });
    return out.map(({ id, samples }) => ({ id, share: materials.length ? samples / materials.length : 0 }));
}

/** How much of the ground `share` (0 to 1) is, in words. */
export function shareText(share) {
    if (share <= 0) return 'not on the ground';
    if (share < 0.01) return 'under 1%';
    return `${Math.round(share * 100)}%`;
}

/** What the notice, the dialog and a refused export say about `missing` (missingTextures'). */
export function missingMessage(missing) {
    const n = missing.length;
    const list = missing.map((m, k) => `${m.id} (${shareText(m.share)}${k === 0 && m.share > 0 ? ' of the ground' : ''})`).join(', ');
    return (
        `This area is painted with ${n === 1 ? '1 texture' : `${n} textures`} the texture library doesn't have: ${list}. ` +
        `${n === 1 ? 'It shows' : 'They show'} as a magenta checker, and the area won't export until ${n === 1 ? 'it is' : 'they are'} added or swapped for others.`
    );
}

/** The starter category texture `id`'s name points to (`sandFine`: Sand), or null: the word that comes first in it. */
export function guessCategory(id) {
    const low = id.toLowerCase();
    let best = null;
    for (const [word, category] of CATEGORY_WORDS) {
        const at = low.indexOf(word);
        if (at >= 0 && (!best || at < best.at)) best = { at, category };
    }
    return best?.category ?? null;
}

/**
 * The library texture to swap missing texture `id` for, and why: one made from the same game texture (`starters`, the engine's
 * starter list, names its resref; a catalog entry's `original` is `game:<resref>`), else the first of the same category (the
 * starter list's, else guessed from the id), else the editor's default ground, else the library's first.
 */
export function suggestSwap(id, catalog, starters = []) {
    const spec = starters.find(s => s.id.toLowerCase() === id.toLowerCase());
    if (spec?.resref) {
        const same = catalog.find(t => t.original === `game:${spec.resref}`);
        if (same) return { id: same.id, why: `the same game texture, ${spec.resref}` };
    }
    const category = spec?.category ?? guessCategory(id);
    const near = category && catalog.find(t => t.category === category);
    if (near) return { id: near.id, why: `also ${category}` };
    const fallback = catalog.find(t => t.id === DEFAULT_TEXTURE) ?? catalog[0];
    return fallback ? { id: fallback.id, why: 'nothing closer in this library' } : null;
}

/** `palette` with every `from` made `to` (a new list). Its samples keep their indices, so only the texture they name changes. */
export function swapped(palette, from, to) {
    return palette.map(id => (id === from ? to : id));
}

/** What app.js gives this file (initMissing): `area()`, `readOnly()`, `library`, `refresh()` (redraws after a change, as undo
 *  does, and saves) and `reload()` (reads the library again after it changed). */
let ctx = null;
/** The engine's starter list (`[{ id, name, category, resref }]`) and whether this user may add from it: none and false with an
 *  engine too old to say, so the dialog offers the swap only. */
let starters = { textures: [], add: false, known: false };
/** The notice's words the builder closed, so the same area's same textures don't bring it back until something changes. */
let dismissed = '';

/** The open area's missing textures (none while the library is empty: the Paint panel says why). */
export function currentMissing() {
    const a = ctx?.area(),
        lib = ctx?.library;
    if (!a || !lib?.catalog.length) return [];
    return missingTextures(a.palette, a.materials, id => lib.byId.has(id));
}

/** Why the open area can't be exported now, or null: its missing textures, in the notice's words (the notice shows too). */
export function exportBlocked() {
    const missing = currentMissing();
    if (!missing.length) return null;
    dismissed = '';
    showMissing();
    return missingMessage(missing);
}

/** Shows or hides the notice for the open area: called when an area opens, the library changes, or a change is undone. */
export function showMissing() {
    if (!ctx) return;
    const missing = currentMissing();
    const text = missing.length ? missingMessage(missing) : '';
    const key = `${ctx.area()?.name}\n${text}`;
    $('missingTex').hidden = !text || dismissed === key;
    $('missingTexWhy').textContent = text;
    if ($('missingDialog').open) {
        if (missing.length) fillDialog(missing);
        else $('missingDialog').close();
    }
}

/** Asks the engine for its starter list, once it answers; an engine without the route leaves the swap alone on offer. */
async function loadStarters() {
    if (starters.known) return;
    const res = await api('/api/textures/starter');
    if (!res.ok) return;
    const body = await json(res);
    if (!Array.isArray(body.textures)) return;
    starters = { textures: body.textures, add: !!body.add, known: true };
}

/** Adds the starter textures `ids` from the game's files, then reads the library again (the checker turns into them). */
async function addStarters(ids, button) {
    button.disabled = true;
    $('missingStatus').textContent = `Adding ${ids.join(', ')} from the game's files…`;
    const res = await api(`/api/textures/starter?ids=${encodeURIComponent(ids.join(','))}`, { method: 'POST' });
    if (!res.ok) {
        $('missingStatus').textContent = await failure(res);
        button.disabled = false;
        return;
    }
    const r = await json(res);
    await ctx.reload();
    const problems = r.problems?.length ? ` Not added: ${r.problems.join('; ')}.` : '';
    $('missingStatus').textContent = `${r.added} added to the library.${problems}`;
    say(`${r.added} starter texture${r.added === 1 ? '' : 's'} added to the library.`);
    showMissing();
}

/** Swaps missing texture `from` for library texture `to` in the open area, as one step of undo. */
function swap(from, to) {
    const a = ctx.area();
    if (!a || ctx.readOnly() || !ctx.library.byId.has(to)) return;
    a.beginStroke();
    a.palette = swapped(a.palette, from, to);
    ctx.refresh();
    say(`${from} is ${ctx.library.byId.get(to).name} now (undo takes it back).`);
    showMissing();
}

/** A list of the library's textures by category, with `selected` chosen. */
function texturePicker(selected) {
    const pick = el('select', { ariaLabel: 'Swap for' });
    const catalog = ctx.library.catalog;
    for (const category of categoriesOf(catalog)) {
        const group = el('optgroup', { label: category });
        for (const t of catalog.filter(t => t.category === category)) group.append(new Option(t.name, t.id, false, t.id === selected));
        pick.append(group);
    }
    return pick;
}

/** The dialog's rows for `missing`: an Add button for the starter ones (when this user may), and a swap for each. */
function fillDialog(missing) {
    $('missingDialogWhy').textContent = missingMessage(missing);
    const startersHere = missing.filter(m => starters.textures.some(s => s.id.toLowerCase() === m.id.toLowerCase()));
    const add = $('missingAdd');
    add.replaceChildren();
    if (startersHere.length && starters.add && !ctx.readOnly()) {
        const ids = startersHere.map(m => m.id);
        const b = el('button', {
            type: 'button',
            className: 'primary',
            textContent: `Add ${ids.length === 1 ? ids[0] : `these ${ids.length}`} from the game`,
            title: `Make ${ids.join(', ')} from your game's files, as the starter library does, and put them in the library`,
        });
        b.onclick = () => addStarters(ids, b);
        add.append(
            el('p', {
                className: 'note',
                textContent: `${ids.join(', ')} ${ids.length === 1 ? 'is a starter texture' : 'are starter textures'}: the game has ${ids.length === 1 ? 'it' : 'them'}.`,
            }),
            b,
        );
    } else if (startersHere.length && starters.known && !ctx.readOnly()) {
        add.append(
            el('p', {
                className: 'note',
                textContent: "Only an admin adds starter textures to the library, as it is the whole team's: ask one, or swap them below.",
            }),
        );
    }
    const rows = missing.map(m => {
        const suggestion = suggestSwap(m.id, ctx.library.catalog, starters.textures);
        const pick = texturePicker(suggestion?.id);
        const go = el('button', { type: 'button', textContent: 'Swap', title: `Paint ${m.id}'s ground with the texture chosen` });
        go.onclick = () => swap(m.id, pick.value);
        go.disabled = ctx.readOnly() || !suggestion;
        pick.disabled = go.disabled;
        return el(
            'div',
            { className: 'missing-row' },
            el('span', { className: 'missing-swatch', title: 'How it shows on the ground' }),
            el('span', {}, el('b', { textContent: m.id }), el('small', { textContent: ` ${shareText(m.share)}` })),
            pick,
            go,
            suggestion && el('small', { className: 'note missing-why', textContent: `Suggested: ${suggestion.why}` }),
        );
    });
    $('missingList').replaceChildren(...rows);
}

/** Opens the dialog for the open area's missing textures. */
async function openDialog() {
    const missing = currentMissing();
    if (!missing.length) return;
    $('missingStatus').textContent = '';
    await loadStarters();
    fillDialog(missing);
    if (!$('missingDialog').open) $('missingDialog').showModal();
}

/** Wires the notice and its dialog. */
export function initMissing(c) {
    ctx = c;
    $('missingTexFix').onclick = openDialog;
    $('missingTexClose').onclick = () => {
        dismissed = `${ctx.area()?.name}\n${$('missingTexWhy').textContent}`;
        $('missingTex').hidden = true;
    };
}

/** Opens the dialog (Export's refusal points to it). */
export { openDialog as openMissing };
