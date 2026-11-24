// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The underlay: a picture laid under the ground to trace over (a virtual tabletop battlemat, a map from a book), see-through,
// moved by dragging, scaled by two points a known distance apart, turned. Where it lies is the area's (area.underlay, saved
// with it); the picture itself the engine keeps beside the area (/api/underlay), so it is there on another computer too.

import { api, failure } from './api.js';
import { ask } from './ask.js';
import { $, say } from './dom.js';

/** What app.js gives this file (initUnderlay): `area()`, `readOnly()`, `view` and `saveSoon()`. */
let ctx = null;

// The engine's limit on a picture (its body_max::UNDERLAY).
const MAX_BYTES = 16 << 20;
// A foot, in metres: distances may be given in feet, as battlemats are (5 ft a square).
const FOOT = 0.3048;

/** The picture shown: the area it belongs to (by name), its image (null: none loaded) and whether loading it failed. */
let shown = { name: null, image: null, failed: false };
/** What a press on the ground does while the panel says so: null (the tools have it), 'move' or 'measure'. */
let mode = null;
/** The first point of a measure (area metres), or null; and a drag under way: the pointer's start and the picture's. */
let first = null;
let drag = null;

/** Parses a distance: metres, or feet with `ft`, `feet` or `'` after it (`30`, `30 m`, `100 ft`). NaN when it isn't one. */
export function parseDistance(text) {
    const m = /^\s*(\d+(?:[.,]\d+)?)\s*(m|metres?|meters?|ft|feet|foot|')?\s*$/i.exec(text ?? '');
    if (!m) return Number.NaN;
    const n = Number(m[1].replace(',', '.'));
    return m[2] && /^(ft|feet|foot|')$/i.test(m[2]) ? n * FOOT : n;
}

/** Underlay `u` scaled by `k` about area point `p` (metres): `p` stays where it is on the picture. */
export function scaleAbout(u, p, k) {
    return { ...u, x: p.x + (u.x - p.x) * k, y: p.y + (u.y - p.y) * k, w: u.w * k, h: u.h * k };
}

/** Where a picture `aspect` (width over height) lies at first: the whole of it over area `a`, as large as fits, unturned. */
export function fitToArea(a, aspect) {
    let w = a.sizeX,
        h = w / aspect;
    if (h > a.sizeY) {
        h = a.sizeY;
        w = h * aspect;
    }
    return { x: a.sizeX / 2, y: a.sizeY / 2, w, h, angle: 0, opacity: 0.6, shown: true };
}

/** Shows the area's underlay as it lies now (after a change to area.underlay). */
function place() {
    const u = ctx.area()?.underlay;
    ctx.view.setUnderlayPlace(shown.image && shown.name === ctx.area()?.name ? u : null);
    refreshPanel();
}

/** The panel's fields from the area's underlay. */
function refreshPanel() {
    const a = ctx.area(),
        u = a?.underlay,
        locked = !a || ctx.readOnly();
    $('underlayControls').hidden = !u;
    $('underlayRemove').hidden = !u;
    $('underlayPick').textContent = u ? 'Another picture…' : 'Choose picture…';
    for (const id of ['underlayPick', 'underlayRemove', 'underlayMove', 'underlayMeasure', 'underlayFit', 'underlayWidth', 'underlayAngle'])
        $(id).disabled = locked;
    $('underlayMove').classList.toggle('active', mode === 'move');
    $('underlayMeasure').classList.toggle('active', mode === 'measure');
    if (!u) return;
    $('underlayShown').checked = u.shown;
    $('underlayOpacity').value = u.opacity;
    $('underlayOpacityOut').textContent = `${Math.round(u.opacity * 100)}% solid`;
    if (document.activeElement !== $('underlayWidth')) $('underlayWidth').value = +u.w.toFixed(1);
    if (document.activeElement !== $('underlayAngle')) $('underlayAngle').value = Math.round((u.angle * 180) / Math.PI);
    $('underlayNote').textContent = shown.failed
        ? 'The picture could not be loaded from the engine: choose it again.'
        : `${u.w.toFixed(1)} × ${u.h.toFixed(1)} m.`;
}

/** Loads image `blob` and shows it as the area's picture. */
async function showPicture(name, blob) {
    const url = URL.createObjectURL(blob);
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        shown = { name, image: img, failed: false };
        ctx.view.setUnderlayPicture(img);
        return img;
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** After another area opens (app.js setArea): its picture, if it has one, from the engine. */
export async function underlayAreaChanged() {
    if (!ctx) return;
    setMode(null);
    const a = ctx.area();
    if (shown.name !== a?.name) {
        shown = { name: a?.name ?? null, image: null, failed: false };
        ctx.view.setUnderlayPicture(null);
    }
    place();
    if (!a?.underlay || shown.image) return;
    const name = a.name;
    try {
        const res = await api(`/api/underlay?name=${encodeURIComponent(name)}`);
        if (!res.ok) throw new Error(res.statusText);
        if (ctx.area()?.name === name) await showPicture(name, await res.blob());
    } catch {
        // None shown: the panel says so.
        if (shown.name === name) shown.failed = true;
    }
    if (ctx.area()?.name === name) place();
}

/** Turns the panel's ground mode on or off ('move', 'measure' or null). */
function setMode(m) {
    mode = m;
    first = null;
    drag = null;
    const canvas = ctx.view.renderer.domElement;
    canvas.style.cursor = m === 'move' ? 'move' : m === 'measure' ? 'crosshair' : '';
    refreshPanel();
}

/** Escape: stops a move or measure. True when there was one to stop. */
export function underlayEscape() {
    if (!mode) return false;
    setMode(null);
    say('');
    return true;
}

/** The U key: shows or hides the area's underlay. */
export function toggleUnderlay() {
    const u = ctx.area()?.underlay;
    if (!u) return;
    u.shown = !u.shown;
    place();
    if (!ctx.readOnly()) ctx.saveSoon();
}

/** Keeps `file` as the area's picture: sent to the engine, then shown (where it lay before, its height to the new shape). */
async function pick(file) {
    const a = ctx.area();
    if (!a || ctx.readOnly()) return;
    if (file.size > MAX_BYTES) {
        say(`${file.name} is over ${MAX_BYTES >> 20} MB: make it smaller first (a battlemat needs about 100 pixels a square).`);
        return;
    }
    let img;
    try {
        img = await showPicture(a.name, file);
    } catch {
        say(`${file.name} isn't a picture this browser can show (PNG, JPEG, WebP, GIF or BMP).`);
        place();
        return;
    }
    const res = await api(`/api/underlay?name=${encodeURIComponent(a.name)}`, { method: 'PUT', body: file });
    if (!res.ok) {
        say(`The picture wasn't kept: ${await failure(res)}`);
        shown = { name: a.name, image: null, failed: false };
        ctx.view.setUnderlayPicture(null);
        if (a.underlay) underlayAreaChanged();
        else place();
        return;
    }
    const aspect = img.naturalWidth / img.naturalHeight;
    a.underlay = a.underlay ? { ...a.underlay, h: a.underlay.w / aspect, shown: true } : fitToArea(a, aspect);
    place();
    ctx.saveSoon();
    say(`Underlay: ${file.name}. Move it, scale it by two points a known distance apart, or set its width.`);
}

/** The press of a move or measure at the canvas: taken before the tools see it. */
function down(e) {
    if (!mode || e.button !== 0 || e.target !== ctx.view.renderer.domElement) return;
    const a = ctx.area(),
        p = ctx.view.pick(e.clientX, e.clientY);
    e.stopImmediatePropagation();
    e.preventDefault();
    if (!a?.underlay || !p) return;
    if (mode === 'move') {
        drag = { from: { x: p.x, y: p.y }, start: { x: a.underlay.x, y: a.underlay.y } };
        e.target.setPointerCapture?.(e.pointerId);
        return;
    }
    if (!first) {
        first = { x: p.x, y: p.y };
        say('Now click the second point.');
        return;
    }
    const second = { x: p.x, y: p.y },
        from = first;
    setMode(null);
    measure(from, second);
}

/** Asks how far apart two points of the picture are, and scales it about the first so they are. */
async function measure(from, to) {
    const now = Math.hypot(to.x - from.x, to.y - from.y);
    if (now < 0.05) {
        say('Those two points are the same: click two points apart.');
        return;
    }
    const text = await ask({
        title: 'How far apart?',
        text: `On the ground now those two points are ${now.toFixed(2)} m apart. How far apart should they be? In metres, or feet with "ft" (a battlemat's square is usually 5 ft).`,
        ok: 'Scale',
        input: { label: 'Distance', value: '', placeholder: 'e.g. 1.5 or 5 ft' },
        submit: v => (parseDistance(v) > 0 ? undefined : 'A distance: a number of metres, or of feet with "ft".'),
    });
    const a = ctx.area();
    if (text === null || !a?.underlay) return;
    const k = parseDistance(text) / now;
    a.underlay = scaleAbout(a.underlay, from, k);
    place();
    ctx.saveSoon();
    say(`Scaled by ${k.toFixed(3)}: the picture is ${a.underlay.w.toFixed(1)} × ${a.underlay.h.toFixed(1)} m.`);
}

/** Wires the Underlay panel. `c`: { area(), readOnly(), view, saveSoon() } from app.js. */
export function initUnderlay(c) {
    ctx = c;
    const canvas = ctx.view.renderer.domElement;
    // (on the document, capturing: before the canvas's own listeners, which are the tools')
    document.addEventListener('pointerdown', down, true);
    document.addEventListener(
        'pointermove',
        e => {
            const a = ctx.area();
            if (!drag || !a?.underlay) return;
            const p = ctx.view.pick(e.clientX, e.clientY);
            if (!p) return;
            e.stopImmediatePropagation();
            a.underlay.x = drag.start.x + p.x - drag.from.x;
            a.underlay.y = drag.start.y + p.y - drag.from.y;
            place();
        },
        true,
    );
    document.addEventListener(
        'pointerup',
        e => {
            if (!drag) return;
            e.stopImmediatePropagation();
            drag = null;
            ctx.saveSoon();
        },
        true,
    );
    canvas.addEventListener('contextmenu', e => {
        if (mode) e.preventDefault();
    });
    $('underlayPick').onclick = () => $('underlayFile').click();
    $('underlayFile').onchange = () => {
        const f = $('underlayFile').files[0];
        $('underlayFile').value = '';
        if (f) pick(f);
    };
    $('underlayRemove').onclick = async () => {
        const a = ctx.area();
        if (!a?.underlay || ctx.readOnly()) return;
        const res = await api(`/api/underlay?name=${encodeURIComponent(a.name)}`, { method: 'DELETE' });
        if (!res.ok) {
            say(`The picture wasn't removed: ${await failure(res)}`);
            return;
        }
        a.underlay = null;
        shown = { name: a.name, image: null, failed: false };
        ctx.view.setUnderlayPicture(null);
        setMode(null);
        place();
        ctx.saveSoon();
    };
    $('underlayShown').onchange = () => {
        const u = ctx.area()?.underlay;
        if (u && u.shown !== $('underlayShown').checked) toggleUnderlay();
    };
    $('underlayOpacity').oninput = () => {
        const u = ctx.area()?.underlay;
        if (!u) return;
        u.opacity = Number($('underlayOpacity').value);
        place();
    };
    $('underlayOpacity').onchange = () => ctx.readOnly() || ctx.saveSoon();
    $('underlayMove').onclick = () => {
        setMode(mode === 'move' ? null : 'move');
        if (mode) say('Drag the picture over the ground; Esc or Move again stops.');
    };
    $('underlayMeasure').onclick = () => {
        setMode(mode === 'measure' ? null : 'measure');
        if (mode) say('Click a point of the picture, then a second one a distance you know from it (the corners of a square).');
    };
    $('underlayFit').onclick = () => {
        const a = ctx.area();
        if (!a?.underlay) return;
        a.underlay = { ...fitToArea(a, a.underlay.w / a.underlay.h), opacity: a.underlay.opacity, shown: a.underlay.shown };
        place();
        ctx.saveSoon();
    };
    $('underlayWidth').onchange = () => {
        const a = ctx.area(),
            w = Number($('underlayWidth').value);
        if (!a?.underlay || !(w > 0)) return;
        a.underlay = scaleAbout(a.underlay, a.underlay, w / a.underlay.w);
        place();
        ctx.saveSoon();
    };
    $('underlayAngle').onchange = () => {
        const a = ctx.area(),
            deg = Number($('underlayAngle').value);
        if (!a?.underlay || !Number.isFinite(deg)) return;
        a.underlay.angle = (deg * Math.PI) / 180;
        place();
        ctx.saveSoon();
    };
}

/** The panel was opened: its fields as they are now. */
export function showUnderlay() {
    if (ctx) refreshPanel();
}

/** The panel was closed: a move or measure stops. */
export function hideUnderlay() {
    if (ctx && mode) setMode(null);
}
