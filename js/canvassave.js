// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// A canvas to and from the engine (its src/serve/canvases.rs): made, listed, opened (its header, then the blocks that have a
// file), and saved: the header when it changed and only the blocks a change reached, each with the version it started from.
// A save that can't reach the engine keeps what it would have sent in this browser (IndexedDB, copies.js), keyed by canvas,
// and the next open of that canvas puts it back when the engine's versions are still the ones it started from.

import { CanvasArea, LAYERS, dropEmpty, fromB64 } from './canvas.js';
import { api, failure, json } from './api.js';
import { copyOf, dropCopyOf, keepCopy } from './copies.js';

// How many block files are fetched at once when a canvas opens.
const FETCHING = 6;

/** The key of canvas `name`'s copy in this browser (`<user>:canvas:<name>` on a team server, as an area's is). */
const copyKey = (name, me) => `${me?.team ? `${me.user}:` : ''}canvas:${name}`;

/** The workspace's canvases: `[{ name, tiles, tilesY, saved }]` (one that can't be read has `damaged`). */
export async function listCanvases() {
    const res = await api('/api/canvases');
    if (!res.ok) throw new Error(await failure(res));
    return (await json(res)).canvases ?? [];
}

/** Makes canvas `c` (CanvasArea.create's) on the engine, then saves its ground. Throws when the engine refuses (a name taken). */
export async function createCanvas(c, me) {
    const header = c.header();
    const res = await api(`/api/canvas-new?name=${encodeURIComponent(c.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(header),
    });
    if (!res.ok) throw new Error(await failure(res));
    const made = await json(res);
    c.canvas.version = made.version;
    c.canvas.savedHeader = JSON.stringify(header);
    const saved = await saveCanvas(c, me);
    if (!saved.ok) throw new Error(saved.error);
}

/** Canvas `name` from the engine: its header, and each block that has a file (the rest are flat). With a copy of unsaved
 *  changes in this browser that started from the versions there now, those come back, to be saved again; `restored` says so. */
export async function loadCanvas(name, me) {
    const res = await api(`/api/canvas?name=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(await failure(res));
    const answer = await json(res);
    const keys = Object.keys(answer.blocks ?? {}),
        files = {};
    for (let k = 0; k < keys.length; k += FETCHING)
        await Promise.all(
            keys.slice(k, k + FETCHING).map(async key => {
                const r = await api(`/api/canvas-block?name=${encodeURIComponent(name)}&block=${key}`);
                if (!r.ok) throw new Error(`block ${key}: ${await failure(r)}`);
                files[key] = new Uint8Array(await r.arrayBuffer());
            }),
        );
    const copy = unsavedCopy(name, me, answer);
    if (copy?.header) answer.header = copy.header;
    const c = CanvasArea.fromHeader(answer, files);
    if (copy) {
        // (a header kept here goes with the next save)
        if (copy.header) c.canvas.savedHeader = null;
        for (const b of copy.blocks) {
            const [x, y] = b.block.slice(1).split('_').map(Number),
                { w, h } = c.blockRect(x, y),
                heights = new Float32Array(fromB64(b.heights).buffer);
            if (heights.length !== w * h) continue;
            c.setBlock(
                b.block,
                LAYERS.map((l, n) => (n === 0 ? heights : b[l.key] ? fromB64(b[l.key]) : null)),
            );
            c.canvas.dirty.set(b.block, ++c.canvas.stamp);
        }
        dropEmpty(c);
        c.floodWater();
    }
    return { canvas: c, restored: !!copy, stale: copy === false };
}

/** The unsaved changes of canvas `name` kept in this browser (a save body), when every version they started from is the
 *  engine's now (`answer`, its load); false when the engine's has moved on since; null when there are none. */
function unsavedCopy(name, me, answer) {
    const kept = copyOf(copyKey(name, me));
    if (!kept?.json) return null;
    let body;
    try {
        body = JSON.parse(kept.json);
    } catch {
        return null;
    }
    const versions = answer.blocks ?? {};
    const fits = (!body.header || body.base === answer.version) && (body.blocks ?? []).every(b => (versions[b.block] ?? 'none') === b.base);
    return fits ? { header: body.header ?? null, blocks: body.blocks ?? [] } : false;
}

/**
 * Saves canvas `c`'s changes: the header when it changed, the blocks changed since their last save. Resolves `{ ok, error,
 * moved, sent }`: `sent`, how many blocks went, and their bytes. A save that fails keeps the changes in this browser;
 * one the engine refuses because a base moved (409, another tab saved) says what moved.
 */
export async function saveCanvas(c, me) {
    const sent = c.saveBody();
    if (!sent) return { ok: true, sent: 0, bytes: 0 };
    const text = JSON.stringify(sent.body);
    const res = await api(`/api/canvas-save?name=${encodeURIComponent(c.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: text,
    }).catch(err => ({ ok: false, status: 0, err }));
    if (res.ok) {
        c.saved(sent, await json(res));
        if (copyOf(copyKey(c.name, me))) await dropCopyOf(copyKey(c.name, me));
        return { ok: true, sent: sent.body.blocks.length, bytes: text.length };
    }
    const body = res.err ? {} : await json(res.clone());
    const error = res.err ? res.err.message : await failure(res);
    await keepCanvas(c, me, text);
    return { ok: false, error, moved: body.moved ?? null, status: res.status };
}

/** Keeps canvas `c`'s unsaved changes in this browser (`text`: the save body, or the one it would send now). Resolves false
 *  when they don't fit. */
export function keepCanvas(c, me, text = null) {
    text ??= JSON.stringify(c.saveBody()?.body ?? null);
    if (text === 'null') return Promise.resolve(true);
    return keepCopy(copyKey(c.name, me), { json: text, base: 0, version: c.canvas.version });
}

/** Whether canvas `name` has unsaved changes kept in this browser. */
export const hasKeptCanvas = (name, me) => !!copyOf(copyKey(name, me));
