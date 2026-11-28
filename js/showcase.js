// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// File → Open a showcase: the finished areas of the handbook's showcase, which every package of the editor carries in its
// showcase/ folder (the engine's scripts/pack-showcase.sh copies them from its docs/assets/showcase; `landscaper serve` run
// from the engine's source serves that folder itself). The one picked is copied in as a new area under a name no area has: a
// showcase never replaces a builder's area.

import { api, failure } from './api.js';
import { $, el, say } from './dom.js';
import { showError } from './report.js';
import { saveNew } from './save.js';
import { sizeText } from './packs.js';
import { areaFrom, areaNames, bigAreaOk, freeName } from './webdemo.js';

/** Where the showcase is, beside the page. */
export const SHOWCASE = 'showcase/';

/** The showcase's entries that have an area (its index.json: `title`, `text`, `still` and `area`, paths from the folder; `tiles`,
 *  `hak_bytes` and `baked` for sizeParts). */
export async function showcaseList() {
    const res = await api(`${SHOWCASE}index.json`);
    if (!res.ok) throw new Error(res.status === 404 ? 'this copy of the editor has no showcase' : await failure(res));
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error('its index.json is not a list');
    return list.filter(e => e && typeof e.area === 'string' && e.area);
}

/**
 * What showcase `entry` costs to export, from its index.json (the engine's scripts/measure-showcase.mjs measures it): its tiles
 * and metres, its hak and its baked objects, the hak's largest cost. Its parts; none when it wasn't measured.
 */
export function sizeParts(entry) {
    const [x, y] = Array.isArray(entry.tiles) ? entry.tiles : [];
    if (!(x > 0 && y > 0)) return [];
    const parts = [`${x} × ${y} tiles (${x * 10} × ${y * 10} m)`];
    if (entry.hak_bytes > 0) parts.push(`${sizeText(entry.hak_bytes)} hak`);
    if (Number.isInteger(entry.baked)) parts.push(`${entry.baked.toLocaleString('en-US')} baked objects`);
    return parts;
}

/** sizeParts as one line, as the handbook's showcase page says it. */
export const sizeLine = entry => sizeParts(entry).join(' · ');

/** A new random `created`, as Area.create gives: the copy is an area of its own, not the showcase's. */
const newIdentity = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');

/**
 * Copies showcase `entry` in as a new area, saved, and gives it (null when the builder cancelled a big area in the browser). Its
 * own name when no area has it, else the first free one after (lsforest2...); a name taken meanwhile (another tab, a teammate)
 * is refused by the engine and the next is tried, so nothing is ever replaced. Its module is its own, as New area's is.
 */
export async function copyShowcase(entry) {
    const file = entry.area.split('/').pop();
    const res = await api(SHOWCASE + entry.area);
    if (!res.ok) throw new Error(`${file}: ${await failure(res)}`);
    const a = areaFrom(await res.json(), file);
    if (!(await bigAreaOk(a.tiles, a.tilesY))) return null;
    const taken = await areaNames(),
        own = a.name;
    let name = taken.has(own) ? freeName(own, taken) : own;
    for (let tries = 0; tries < 20; tries++) {
        a.name = name;
        a.created = newIdentity();
        a.module = name;
        if (a.settings?.tag === own) a.settings.tag = name;
        if (await saveNew(a, false)) return a;
        taken.add(name);
        name = freeName(own, taken);
    }
    throw new Error(`no free name for a copy of ${own}: open it again`);
}

/** Wires File → Open a showcase. `ctx`: setArea(a) from app.js. */
export function initShowcase(ctx) {
    const dialog = $('showcaseDialog');
    let busy = false;
    const pick = async entry => {
        if (busy) return;
        busy = true;
        $('showcaseStatus').textContent = `Copying ${entry.title}…`;
        try {
            const a = await copyShowcase(entry);
            if (!a) return;
            dialog.close();
            ctx.setArea(a);
            say(`Opened a copy of the showcase's “${entry.title}” as ${a.name}.`);
        } catch (err) {
            showError(err.message, "Couldn't open the showcase");
        } finally {
            busy = false;
            $('showcaseStatus').textContent = '';
        }
    };
    $('btnShowcase').onclick = async () => {
        $('showcaseStatus').textContent = '';
        $('showcaseList').replaceChildren();
        dialog.showModal();
        let list;
        try {
            list = await showcaseList();
        } catch (err) {
            $('showcaseStatus').textContent = `The showcase isn't here: ${err.message}.`;
            return;
        }
        $('showcaseList').replaceChildren(
            ...list.map(e => {
                const b = el(
                    'button',
                    { type: 'button', title: e.text ?? '' },
                    e.still ? el('img', { src: SHOWCASE + e.still, alt: '', loading: 'lazy' }) : el('span', { className: 'no-still' }),
                    el('strong', { textContent: e.title }),
                    el('small', { textContent: e.text ?? '' }),
                    // (each part kept whole, so the line breaks only between them)
                    el('small', { className: 'showcase-size' }, ...sizeParts(e).map(t => el('span', { textContent: t }))),
                );
                b.onclick = () => pick(e);
                return b;
            }),
        );
    };
}
