// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The New area dialog: its size, what kind of ground it starts as (hills, a cave, an interior, a sample descent), its module.

import { Area, TILE } from './area.js';
import { descentPlan, cutDescent } from './tools.js';
import { $, el } from './dom.js';

/** What app.js gives this file (initNewArea): `area()`, `setArea(a)`, `saveSoon()` and the Things tool (`thingsTool`). */
let ctx = null;

// Square sizes to pick, or any width and height (3 to 32 tiles each).
const SIZES = [4, 8, 12, 16, 20, 24, 28, 32];
const showSize = () => {
    for (const o of $('sizeChoices').children)
        o.classList.toggle('active', +o.dataset.size === +$('newW').value && +o.dataset.size === +$('newH').value);
};
// Sample starts: a switchback descent already laid, to show what it is and to change. How many floors depends on the size.
const DESCENT_STARTERS = {
    crypt: { from: 'interior', floors: 6, drop: 5, ceiling: 4, floor: 'flagIrregular', size: [12, 12] },
    dungeon: { from: 'interior', floors: 4, drop: 4, ceiling: 4, floor: 'cobbles', size: [12, 8] },
    'descending-cave': { from: 'cave', floors: 5, drop: 5, ceiling: 5, floor: 'pebbles', size: [12, 10] },
};
function seedDescent(created, starter) {
    const floors = Math.min(starter.floors, Math.floor(Math.min(created.tiles, created.tilesY) / 2));
    const plan = descentPlan(created, { x: 0, y: 0 }, { x: created.sizeX, y: created.sizeY }, { floors, drop: starter.drop });
    if (plan.error) {
        $('statusMsg').textContent = `Too small for the sample descent (${plan.error}); started empty.`;
        return;
    }
    cutDescent(created, plan, created.materialIndex(starter.floor));
    created.clearance = starter.ceiling;
}

/** Wires the New area dialog. `c`: { area(), setArea(a), saveSoon(), thingsTool } from app.js. */
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
    $('btnNew').onclick = () => {
        if (ctx.area()) $('newName').value = ctx.area().name;
        $('newDialog').showModal();
    };
    $('newDialog').addEventListener('close', () => {
        if ($('newDialog').returnValue !== 'ok') return;
        const start = new FormData($('newDialog').querySelector('form')).get('start');
        const base = Math.min(100, Math.max(0, Number($('newBase').value) || 0));
        const tiles = v => Math.min(32, Math.max(3, Math.round(+v || 8)));
        const starter = DESCENT_STARTERS[start];
        const created = Area.create(
            $('newName').value.trim().toLowerCase(),
            tiles($('newW').value),
            starter?.from ?? start,
            base,
            tiles($('newH').value),
        );
        if (starter) seedDescent(created, starter);
        created.module = $('newModule').value.trim().toLowerCase() || created.name;
        // A new area starts with the project's template (the standard scripts and so on; the server's, or a plain one).
        ctx.thingsTool.loadMeta().then(meta => {
            created.settings = { ...structuredClone(meta.template ?? {}), tag: created.name };
            delete created.settings._note;
            ctx.saveSoon();
        });
        ctx.setArea(created);
        ctx.saveSoon();
    });
}
