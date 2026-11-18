// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The New area dialog: its size, what kind of ground it starts as (hills, a cave, an interior, a sample descent), its module.

import { Area, TILE } from './area.js';
import { descentPlan, cutDescent } from './tools.js';
import { $, el, say } from './dom.js';
import { api, engine } from './api.js';
import { ask } from './ask.js';
import { browserCopy, saveNew } from './save.js';

/** What app.js gives this file (initNewArea): `setArea(a)`, the Things tool (`thingsTool`) and the texture `library`. */
let ctx = null;

// Square sizes to pick, or any width and height (3 to 32 tiles each).
const SIZES = [4, 8, 12, 16, 20, 24, 28, 32];
const showSize = () => {
    for (const o of $('sizeChoices').children)
        o.classList.toggle('active', +o.dataset.size === +$('newW').value && +o.dataset.size === +$('newH').value);
};
// Sample starts: a switchback descent already laid, to show what it is and to change. How many floors depends on the size.
// `floor` is the halls' texture where the library has it (a team's own library may); otherwise the first of `stock` it has,
// from the engine's starter library (src/starter_textures.json), which every install builds from the game's files.
const DESCENT_STARTERS = {
    crypt: {
        from: 'interior',
        floors: 6,
        drop: 5,
        ceiling: 4,
        floor: 'flagIrregular',
        stock: ['floorFlag', 'floorSlabs', 'floorStone'],
        size: [12, 12],
    },
    dungeon: {
        from: 'interior',
        floors: 4,
        drop: 4,
        ceiling: 4,
        floor: 'cobbles',
        stock: ['floorCobble', 'floorStone', 'floorBrick'],
        size: [12, 8],
    },
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

    for (const radio of document.querySelectorAll('input[name=start]')) {
        radio.addEventListener('change', () => {
            const size = DESCENT_STARTERS[radio.value]?.size;
            if (size && radio.checked) {
                $('newW').value = size[0];
                $('newH').value = size[1];
                showSize();
            }
        });
    }
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
    const base = Math.min(100, Math.max(0, Number($('newBase').value) || 0));
    const tiles = v => Math.min(32, Math.max(3, Math.round(+v || 8)));
    const starter = DESCENT_STARTERS[start];
    const created = Area.create(name, tiles($('newW').value), starter?.from ?? start, base, tiles($('newH').value));
    if (starter) {
        // (the library comes from the engine a moment after the page starts)
        const library = ctx.library;
        if (!library.catalog.length && engine.up) await library.load();
        seedDescent(created, starter, starterFloor(starter, library));
    }
    created.module = $('newModule').value.trim().toLowerCase() || created.name;
    // A new area starts with the project's template (the standard scripts and so on; the server's, or a plain one).
    const meta = await ctx.thingsTool.loadMeta();
    created.settings = { ...structuredClone(meta.template ?? {}), tag: created.name };
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
