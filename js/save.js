// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Autosave (each change, a moment later, to the engine's disk, or this browser when that fails), areas left in this browser
// moved to disk at start, and Save a version (into the team's history).

import { api, engine } from './api.js';
import { ask } from './ask.js';
import { $ } from './dom.js';
import { checkSoon } from './live.js';

/** What app.js gives this file (initSave): `area()` and `readOnly()`. */
let ctx = null;

// Autosave: each area to landscaper (areas/<name>.json on disk) a moment
// after each change. If that fails, into this browser until it works again,
// and the status line says so.
let saveTimer = null;
export function saveSoon() {
    // Looking at someone else's workspace: nothing is saved (not into yours either).
    if (ctx.readOnly()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveArea(ctx.area()), 800);
    checkSoon();
}

async function saveArea(a) {
    const json = JSON.stringify(a.toJSON());
    localStorage.setItem('landscaper.current', a.name);
    try {
        await putArea(a.name, json);
        localStorage.removeItem(`landscaper.area.${a.name}`);
        localStorage.removeItem(`landscaper.saved.${a.name}`);
        if ($('statusMsg').dataset.saveFailed) {
            $('statusMsg').textContent = 'Saved.';
            delete $('statusMsg').dataset.saveFailed;
        }
    } catch (err) {
        try {
            localStorage.setItem(`landscaper.area.${a.name}`, json);
            localStorage.setItem(`landscaper.saved.${a.name}`, String(Date.now()));
            $('statusMsg').textContent = engine.up
                ? `Couldn't save ${a.name} to disk (${err.message}): kept in this browser for now.`
                : `Saved ${a.name} in this browser (no engine to save it to disk).`;
        } catch {
            $('statusMsg').textContent =
                `Couldn't save ${a.name} anywhere (${err.message}): export it, or your latest changes may be lost.`;
        }
        $('statusMsg').dataset.saveFailed = '1';
    }
}

async function putArea(name, json) {
    const res = await api(`/api/save?name=${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: json,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
}

/** Areas kept in this browser (before landscaper saved to disk, or when a
 *  save failed) go to landscaper when newer than its copy, then leave the
 *  browser. */
export async function moveBrowserAreas() {
    const names = Object.keys(localStorage)
        .filter(k => k.startsWith('landscaper.area.'))
        .map(k => k.slice(16));
    if (!names.length) return;
    let known = [];
    try {
        const res = await api('/api/areas');
        if (!res.ok) return; // (no engine: they stay in the browser until there is one)
        known = (await res.json()).areas ?? [];
    } catch {
        return;
    }
    let moved = 0;
    for (const name of names) {
        const json = localStorage.getItem(`landscaper.area.${name}`);
        const at = +(localStorage.getItem(`landscaper.saved.${name}`) ?? 0);
        const there = known.find(a => a.name === name);
        const theirs = Math.max(there?.saved ?? 0, there?.exported ?? 0) * 1000;
        try {
            if (!there || at > theirs) {
                await putArea(name, json);
                moved++;
            }
            localStorage.removeItem(`landscaper.area.${name}`);
            localStorage.removeItem(`landscaper.saved.${name}`);
        } catch (err) {
            console.warn(`couldn't move ${name} to disk`, err);
        }
    }
    if (moved) $('statusMsg').textContent = `Moved ${moved} area${moved > 1 ? 's' : ''} from this browser to landscaper's folder.`;
}

/** Sets up the Save a version button. */
export function initSave(c) {
    ctx = c;
    // Keeps this version of the area in the team's history (a commit in the team server's history repository).
    $('btnVersion').onclick = async () => {
        if (ctx.readOnly() || !ctx.area()) return;
        const note = await ask({
            title: `Save a version of ${ctx.area().name}`,
            text: "Keeps this copy in the team's history. Autosave never does.",
            ok: 'Save version',
            input: { label: 'A short note (optional)', placeholder: 'what changed' },
        });
        if (note === null) return;
        const btn = $('btnVersion');
        btn.disabled = true;
        $('statusMsg').textContent = `Saving a version of ${ctx.area().name}…`;
        try {
            clearTimeout(saveTimer);
            await putArea(ctx.area().name, JSON.stringify(ctx.area().toJSON()));
            const res = await api(`/api/version?name=${encodeURIComponent(ctx.area().name)}&note=${encodeURIComponent(note)}`, {
                method: 'POST',
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || res.statusText);
            $('statusMsg').textContent = `Saved a version of ${ctx.area().name} (${String(body.commit).slice(0, 7)}).`;
        } catch (err) {
            $('statusMsg').textContent = `Couldn't save a version: ${err.message}`;
        } finally {
            btn.disabled = ctx.readOnly();
        }
    };
}
