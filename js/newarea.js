// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The New area dialog: its size, what kind of ground it starts as (a blank ground, or a starter landscape), its module.

import { Area, TILE } from './area.js';
import { descentPlan, cutDescent } from './tools.js';
import { $, el, say } from './dom.js';
import { api, engine } from './api.js';
import { ask } from './ask.js';
import { browserCopy, saveNew } from './save.js';
import { TERRAIN_STARTERS, seedTerrain, starterSettings } from './starters.js';
import { bigAreaOk } from './webdemo.js';

/** What app.js gives this file (initNewArea): `setArea(a)`, the Things tool (`thingsTool`) and the texture `library`. */
let ctx = null;

// Square sizes to pick, or any width and height (3 to 32 tiles each).
const SIZES = [4, 8, 12, 16, 20, 24, 28, 32];
const showSize = () => {
    for (const o of $('sizeChoices').children)
        o.classList.toggle('active', +o.dataset.size === +$('newW').value && +o.dataset.size === +$('newH').value);
};
// The descending cave: a switchback descent already laid, to show what it is and to change. How many floors depends on the size.
// `floor` is the halls' texture where the library has it (a team's own library may); otherwise the first of `stock` it has,
// from the engine's starter library (src/starter_textures.json), which every install builds from the game's files.
const DESCENT_STARTERS = {
    'descending-cave': {
        from: 'cave',
        floors: 5,
        drop: 5,
        ceiling: 5,
        floor: 'pebbles',
        stock: ['gravelPebbles', 'gravelGrey', 'dirtDark'],
        size: [12, 10],
    },
};

/**
 * The dialog's choices, a group of picture cards each: `value` (the form's `start`: a ground Area.create makes, or a key of
 * DESCENT_STARTERS or TERRAIN_STARTERS), its name, one line on what it makes, and whether the Start height applies (the starters
 * and the rock to dig out set their own). Each card's picture is css/start/<value>.webp, drawn from what it makes.
 */
export const START_GROUPS = [
    {
        title: 'Blank',
        starts: [
            { value: 'flat', name: 'Flat', text: 'Level ground at the start height', height: true },
            { value: 'hills', name: 'Gentle hills', text: 'Rolling ground to shape', height: true },
            { value: 'rough', name: 'Rough hills', text: 'Broken, steeper ground', height: true },
            { value: 'cave', name: 'Cave', text: 'Solid rock: dig the cave out of it' },
            { value: 'interior', name: 'Interior', text: 'Solid stone: cut the rooms out of it' },
        ],
    },
    {
        title: 'Starter landscapes',
        starts: [
            { value: 'canyon', name: 'Canyon', text: 'A sandy floor between stepped rock walls' },
            { value: 'snowy-pass', name: 'Snowy mountain pass', text: 'A path over a saddle, snow falling' },
            { value: 'dunes', name: 'Dune desert', text: 'Wind-piled dunes, all walkable' },
            { value: 'lake-valley', name: 'Valley with a lake', text: 'A meadow ringed by hills' },
            { value: 'descending-cave', name: 'Descending cave', text: 'Five floors down through rock' },
        ],
    },
];
const START_DEFAULT = 'flat';
/** The Start height when it doesn't apply (the field's own default). */
const BASE_DEFAULT = 5;
const startOf = value => START_GROUPS.flatMap(g => g.starts).find(s => s.value === value);

/** The cards of START_GROUPS: a radio a card, all in one group, so the arrow keys move through them as through any radios. */
function startCards() {
    const out = [];
    for (const g of START_GROUPS) {
        const cards = el('div', { className: 'start-cards' });
        cards.setAttribute('role', 'radiogroup');
        cards.setAttribute('aria-label', g.title);
        for (const s of g.starts) {
            const radio = el('input', { type: 'radio', name: 'start', value: s.value, checked: s.value === START_DEFAULT });
            const card = el('label', { className: 'start-card', title: s.text });
            card.dataset.start = s.value;
            card.append(radio, el('span', { className: 'pic' }), el('span', { className: 'name', textContent: s.name }));
            cards.appendChild(card);
        }
        out.push(el('h3', { className: 'start-group', textContent: g.title }), cards);
    }
    return out;
}

/** What the chosen start makes, under the cards, and the Start height only where it applies. */
function showStart(value) {
    const s = startOf(value);
    $('startNote').textContent = s ? `${s.name}: ${s.text.charAt(0).toLowerCase()}${s.text.slice(1)}.` : '';
    $('newBaseRow').hidden = !s?.height;
}

/** The texture a starter's halls are painted with: its own when the library has it, else its first stock one the library
 *  has, else none (the halls keep the rock's texture), as the Room and Descent tools choose (strokes.js). An id the library
 *  doesn't have draws grey and fails the export. */
function starterFloor(starter, library) {
    return [starter.floor, ...starter.stock].find(id => library.byId.has(id));
}

function seedDescent(created, starter, floor) {
    const floors = Math.min(starter.floors, Math.floor(Math.min(created.tiles, created.tilesY) / 2));
    const plan = descentPlan(created, { x: 0, y: 0 }, { x: created.sizeX, y: created.sizeY }, { floors, drop: starter.drop });
    if (plan.error) {
        say(`Too small for the sample descent (${plan.error}); started empty.`);
        return;
    }
    cutDescent(created, plan, floor === undefined ? undefined : created.materialIndex(floor));
    created.clearance = starter.ceiling;
}

/** Wires the New area dialog. `c`: { setArea(a), thingsTool, library } from app.js. */
export function initNewArea(c) {
    ctx = c;
    for (const s of SIZES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.size = s;
        b.append(`${s}×${s}`, el('small', { textContent: `${s * TILE} m` }));
        b.onclick = () => {
            $('newW').value = $('newH').value = s;
            showSize();
        };
        $('sizeChoices').appendChild(b);
    }
    $('newW').oninput = $('newH').oninput = showSize;
    showSize();

    $('startChoices').replaceChildren(...startCards());
    for (const radio of document.querySelectorAll('input[name=start]')) {
        radio.addEventListener('change', () => {
            if (!radio.checked) return;
            showStart(radio.value);
            const size = (DESCENT_STARTERS[radio.value] ?? TERRAIN_STARTERS[radio.value])?.size;
            if (size) {
                $('newW').value = size[0];
                $('newH').value = size[1];
                showSize();
            }
        });
    }
    showStart(START_DEFAULT);
    // The name box starts empty: with the open area's name in it, Create replaced the open area. The dialog's returnValue is
    // cleared too: Escape closes a dialog keeping its last one, and a stale "ok" used to create an area.
    $('btnNew').onclick = () => {
        $('newName').value = '';
        $('newDialog').returnValue = '';
        $('newDialog').showModal();
    };
    // Create makes the area from its own click, not from the dialog's close (which Escape fires too), and only once the name
    // is free or the builder has said to replace the area that has it.
    $('newCreate').onclick = async e => {
        e.preventDefault();
        const form = $('newDialog').querySelector('form');
        if (!form.reportValidity()) return;
        const name = $('newName').value.trim().toLowerCase();
        const button = $('newCreate');
        button.disabled = true;
        try {
            await create(name, form);
        } finally {
            button.disabled = false;
        }
    };
}

/** Asks whether to replace the area called `name`; true to replace it. */
const replaceIt = name =>
    ask({
        title: `Replace ${name}?`,
        text: `There is already an area called ${name}. A new area with that name replaces it: its ground, things and settings are lost.\n\nPick another name to keep it.`,
        ok: `Replace ${name}`,
        danger: true,
    }).then(answer => answer === true);

/** Makes area `name` from the dialog's `form` and opens it. Asks first when an area of that name exists: the engine's list
 *  and this browser's copies are looked at here, and the engine refuses (409) a new area's first save over one it has
 *  unless `replace=1` says the builder agreed. */
async function create(name, form) {
    let replace = false;
    if (await nameTaken(name)) {
        if (!(await replaceIt(name))) {
            $('newName').focus();
            return;
        }
        replace = true;
    }
    const start = new FormData(form).get('start');
    const base = startOf(start)?.height ? Math.min(100, Math.max(0, Number($('newBase').value) || 0)) : BASE_DEFAULT;
    const tiles = v => Math.min(32, Math.max(3, Math.round(+v || 8)));
    // (In the browser, an area over 16 by 16 asks first: its export may need more memory than the browser has.)
    if (!(await bigAreaOk(tiles($('newW').value), tiles($('newH').value)))) return;
    const starter = DESCENT_STARTERS[start],
        terrain = TERRAIN_STARTERS[start];
    const created = Area.create(name, tiles($('newW').value), starter?.from ?? (terrain ? 'flat' : start), base, tiles($('newH').value));
    if (starter || terrain) {
        // (the library comes from the engine a moment after the page starts)
        const library = ctx.library;
        if (!library.catalog.length && engine.up) await library.load();
        if (starter) seedDescent(created, starter, starterFloor(starter, library));
        else seedTerrain(created, terrain, base, library);
    }
    created.module = $('newModule').value.trim().toLowerCase() || created.name;
    // A new area starts with the project's template (the standard scripts and so on; the server's, or a plain one).
    const meta = await ctx.thingsTool.loadMeta();
    created.settings = { ...structuredClone(meta.template ?? {}), tag: created.name };
    if (terrain) created.settings = starterSettings(created.settings, terrain);
    delete created.settings._note;
    // The engine has the last word: an area made since the list was read (another tab, a teammate) is refused with 409.
    if (!(await saveNew(created, replace))) {
        if (!(await replaceIt(name)) || !(await saveNew(created, true))) {
            $('newName').focus();
            return;
        }
    }
    $('newDialog').close('ok');
    ctx.setArea(created);
}

/** Whether an area called `name` exists: in the engine's list, or kept in this browser. */
async function nameTaken(name) {
    if (browserCopy(name) !== null) return true;
    try {
        const res = await api('/api/areas');
        if (res.ok) return ((await res.json()).areas ?? []).some(a => a.name === name);
    } catch {
        /* no list: the engine's answer to the save decides */
    }
    return false;
}
