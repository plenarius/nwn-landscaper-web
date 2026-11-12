// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The area's own settings: name, tag, scripts, PvP and rest, weather, music and ambient sound, load screen,
// listen and spot modifiers, sky box, comments and local variables (what the toolset's Area Properties holds).
// A dialog; OK keeps them in `area.settings`, which landscaper writes into the area on export.
// An area without settings (made before this existed) is shown the standard template, but only what the
// builder changes is kept: the rest stays what the area has.

import { renderVars } from './vars.js';
import { scriptPicker } from './scripts.js';
import { $ } from './dom.js';

const PVP = [
    [0, 'No PvP'],
    [1, 'Party only'],
    [2, 'Full PvP'],
    [3, "The module's setting"],
];
const WIND = [
    [0, 'None'],
    [1, 'Light'],
    [2, 'Strong'],
];

const get = (o, path, d = '') => path.split('.').reduce((v, k) => v?.[k], o) ?? d;
const put = (o, path, v) => {
    const ks = path.split('.');
    let t = o;
    for (const k of ks.slice(0, -1)) t = t[k] ??= {};
    t[ks.at(-1)] = v;
};

const FIELDS = [
    { h: 'The area' },
    { p: 'name', t: 'text', l: 'Name', max: 60, note: "what players see; empty keeps the original's" },
    { p: 'tag', t: 'text', l: 'Tag', max: 32, note: 'what scripts call it' },
    { p: 'comments', t: 'text', l: 'Comments', max: 200 },
    { h: 'Scripts' },
    { p: 'scripts.OnEnter', t: 'text', l: 'On enter', max: 16 },
    { p: 'scripts.OnExit', t: 'text', l: 'On exit', max: 16 },
    { p: 'scripts.OnHeartbeat', t: 'text', l: 'On heartbeat', max: 16 },
    { p: 'scripts.OnUserDefined', t: 'text', l: 'On user defined', max: 16 },
    { h: 'Rules' },
    { p: 'pvp', t: 'select', l: 'Player vs player', o: PVP },
    { p: 'noRest', t: 'check', l: 'No resting' },
    { p: 'spot', t: 'number', l: 'Spot modifier', min: -127, max: 127 },
    { p: 'listen', t: 'number', l: 'Listen modifier', min: -127, max: 127 },
    { h: 'Weather' },
    { p: 'weather.rain', t: 'number', l: 'Chance of rain %', min: 0, max: 100 },
    { p: 'weather.snow', t: 'number', l: 'Chance of snow %', min: 0, max: 100 },
    { p: 'weather.lightning', t: 'number', l: 'Chance of lightning %', min: 0, max: 100 },
    { p: 'weather.wind', t: 'select', l: 'Wind', o: WIND },
    { h: 'Music and sound' },
    { p: 'music.day', list: 'music', t: 'number', l: 'Music, day', min: 0 },
    { p: 'music.night', list: 'music', t: 'number', l: 'Music, night', min: 0 },
    { p: 'music.battle', list: 'music', t: 'number', l: 'Music, battle', min: 0 },
    { p: 'music.delay', t: 'number', l: 'Music delay (ms)', min: 0, max: 1000000 },
    { p: 'ambient.day', list: 'ambient', t: 'number', l: 'Ambient sound, day', min: 0 },
    { p: 'ambient.night', list: 'ambient', t: 'number', l: 'Ambient sound, night', min: 0 },
    { p: 'ambient.dayVol', t: 'number', l: 'Ambient volume, day (0-127)', min: 0, max: 127 },
    { p: 'ambient.nightVol', t: 'number', l: 'Ambient volume, night (0-127)', min: 0, max: 127 },
    { p: 'ambient.env', list: 'env', t: 'number', l: 'Reverb (environment audio)', min: 0 },
    { h: 'Look' },
    { p: 'loadScreen', list: 'loadScreen', t: 'number', l: 'Load screen', min: 0, max: 65535 },
    { p: 'skyBox', list: 'skyBox', t: 'number', l: 'Sky box', min: 0, max: 255 },
];

/** Opens the dialog for `area`. `template`: what a new area starts with; `onSave()` after OK. */
export function openSettings(area, template, lists, onSave) {
    const dlg = $('settingsDialog'),
        body = $('settingsBody');
    const base = structuredClone(area.settings ?? {});
    const current = structuredClone(area.settings ?? template ?? {});
    delete current._note;
    if (!current.tag) current.tag = area.name;
    body.textContent = '';
    const inputs = [];
    let section = null;
    for (const f of FIELDS) {
        if (f.h) {
            const h = document.createElement('h4');
            h.textContent = f.h;
            section = document.createElement('div');
            section.className = 'setgrid';
            body.append(h, section);
            continue;
        }
        const label = document.createElement('label');
        const span = document.createElement('span');
        span.textContent = f.l;
        let input;
        if (f.list && lists?.[f.list]?.length) {
            // A choice from the game's own table, by name (the number it stores is the table's row).
            input = document.createElement('select');
            const rows = lists[f.list];
            const now = Number(get(current, f.p, 0));
            for (const r of rows) input.add(new Option(r.name, r.row));
            if (!rows.some(r => r.row === now)) input.add(new Option(`Row ${now}`, now));
            input.value = String(now);
        } else if (f.t === 'select') {
            input = document.createElement('select');
            for (const [v, n] of f.o) input.add(new Option(n, v));
            input.value = String(get(current, f.p, f.o[0][0]));
        } else {
            input = document.createElement('input');
            input.type = f.t === 'check' ? 'checkbox' : f.t;
            if (f.max && f.t === 'text') input.maxLength = f.max;
            if (f.t === 'number') {
                if (f.min != null) input.min = f.min;
                if (f.max != null) input.max = f.max;
            }
            if (f.t === 'check') input.checked = !!get(current, f.p, false);
            else input.value = get(current, f.p, f.t === 'number' ? 0 : '');
        }
        if (f.p === 'name' && area.settings?.nameText) input.placeholder = area.settings.nameText;
        if (f.note) label.title = f.note;
        label.append(span, input);
        if (f.p.startsWith('scripts.')) label.appendChild(scriptPicker(input, 'action'));
        section.appendChild(label);
        inputs.push([f, input, f.t === 'check' ? input.checked : input.value]);
    }
    // Local variables.
    const vh = document.createElement('h4');
    vh.textContent = 'Local variables';
    const vbox = document.createElement('div');
    vbox.className = 'varbox';
    body.append(vh, vbox);
    const vars = structuredClone(current.vars ?? []);
    let varsChanged = false;
    const drawVars = () => {
        vbox.textContent = '';
        renderVars(vbox, vars, {
            after: () => {
                varsChanged = true;
            },
            redraw: drawVars,
        });
    };
    drawVars();
    const ok = $('settingsOk');
    ok.onclick = () => {
        const out = structuredClone(base);
        for (const [f, input, initial] of inputs) {
            const now = f.t === 'check' ? input.checked : input.value;
            // Changed, or the area already had settings (then all of them are kept together).
            if (now === initial && area.settings === null) continue;
            put(out, f.p, f.t === 'check' ? now : f.t === 'number' || f.t === 'select' ? Number(now) : String(now).trim());
        }
        // An empty name keeps the original's (and a new area's own).
        if (!out.name) delete out.name;
        if (varsChanged || area.settings) out.vars = vars.filter(v => v.name?.trim());
        area.beginStroke();
        area.settings = out;
        onSave?.();
    };
    dlg.showModal();
}
