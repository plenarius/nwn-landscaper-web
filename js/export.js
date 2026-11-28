// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Export (the area built into the module) and Check paths (the export's planning and route simulation, nothing built): the
// area sent to the engine, its report shown.

import { thingsForExport } from './things.js';
import { ambienceForExport } from './ambience.js';
import { api, engine, failure } from './api.js';
import { $, el, say } from './dom.js';
import { exportProgressOf } from './exportjob.js';
import { showReport, showError } from './report.js';
import { web } from './web.js';
import { downloadExport } from './webdemo.js';
import { shadersForExport } from './gamefolder.js';
import { exportBlocked } from './missing.js';
import { blendForSave } from './blend.js';

/** What app.js gives this file (initExport): `area()`, `readOnly()` and `view`. */
let ctx = null;

/** The area open, as landscaper serve takes it: the query string has its name and simple settings (tiles, shadow, kind, roof,
 *  clearance, module, halo: its band's samples a side); the body is its heights (its band's, with one) (f32 a sample), each sample's palette index (u8), then JSON with its lists and
 *  objects (palette, water, chasm, lights, entrances, atmosphere, objects, things, settings, originals, ambience, and the
 *  blend layer when any sample has a weight). */
export function areaRequest() {
    const a = ctx.area();
    if (a.canvas) throw new Error('A canvas is exported and checked by its pieces, once it is cut into areas.');
    // With a band, its grids (the area's in their middle): the engine's halo, drawn past the edge in the game. The chasm and the
    // water stay in the area's own samples; the engine moves them into the larger grid.
    const band = a.band;
    band?.sync(a);
    const extra = new TextEncoder().encode(
        JSON.stringify({
            palette: a.palette,
            water: a.water,
            chasm: a.chasmRuns(),
            lights: a.lightsForExport(),
            entrances: a.entrances,
            atmosphere: a.atmosphere,
            objects: a.objects,
            things: thingsForExport(a.things),
            settings: a.settings,
            originals: a.originals,
            ambience: ambienceForExport(a),
            // (in the JSON, not after the paint: an engine from before the layer reads all that follows the paint as JSON)
            blend: blendForSave(band ? band.blend : a.blend) ?? undefined,
        }),
    );
    const h = band ? band.heights : a.heights,
        paint = band ? band.materials : a.materials;
    const heights = new Uint8Array(h.buffer, h.byteOffset, h.byteLength);
    const body = new Uint8Array(heights.byteLength + paint.byteLength + extra.byteLength);
    body.set(heights);
    body.set(paint, heights.byteLength);
    body.set(extra, heights.byteLength + paint.byteLength);
    const query = new URLSearchParams({ name: a.name, tiles: a.tiles, tilesY: a.tilesY, shadow: a.shadow });
    if (band) query.set('halo', band.n);
    if (a.enclosed()) {
        query.set('kind', a.kind);
        query.set('roof', a.roof);
        if (a.clearance > 0) query.set('clearance', a.clearance);
    }
    query.set('module', a.module || a.name);
    return { query: query.toString(), body };
}

/** Sends the area to `what` (export or check); its report, or throws. */
export async function sendArea(what) {
    const { query, body } = areaRequest();
    const res = await api(`/api/${what}?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body });
    if (res.status === 404 || res.status === 501) throw new Error('This page is not being served by landscaper. Run: landscaper serve');
    if (!res.ok) throw new Error(await failure(res));
    return await res.json();
}

/** How often a running export's progress is asked for (ms). */
const POLL_MS = 1000;

/** The report box while area `name` exports: its estimate, a bar with the step and time left, and Cancel when `cancel` is
 *  given (the engine stops between tiles; the browser page's engine can't be reached until it is done). `show(p)` updates it
 *  from the engine's progress. */
function progressBox(name, cancel) {
    const estimate = el('p', { className: 'export-eta', textContent: 'Estimating the time…' });
    const bar = el('progress', { className: 'export-bar', max: 1 });
    const step = el('p', { className: 'note export-step' });
    const stop = cancel
        ? el('button', {
              type: 'button',
              className: 'export-cancel',
              textContent: 'Cancel export',
              onclick: () => {
                  stop.disabled = true;
                  stop.textContent = 'Cancelling…';
                  cancel();
              },
          })
        : null;
    $('reportBody').replaceChildren(el('h3', { textContent: `Exporting ${name}` }), estimate, bar, step, ...(stop ? [stop] : []));
    $('report').hidden = false;
    // (The bar never goes back: a slower tile than expected stretches the time left, not the work done.)
    let most = 0;
    return {
        show(p) {
            const v = exportProgressOf(p);
            if (v.estimate) estimate.textContent = v.estimate;
            step.textContent = v.step;
            if (v.fraction == null) bar.removeAttribute('value');
            else bar.value = most = Math.max(most, v.fraction);
        },
    };
}

/** Exports the area open as a job, its progress in the report box: its report, or throws. An engine older than the job route
 *  exports as before, with no progress. */
async function exportWithProgress(name) {
    const { query, body } = areaRequest();
    const res = await api(`/api/export/job?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body,
    });
    if (res.status === 404 || res.status === 501) return sendArea('export');
    if (!res.ok) throw new Error(await failure(res));
    const box = progressBox(name, () => api('/api/export/job/cancel', { method: 'POST' }));
    let job = await res.json();
    for (;;) {
        box.show(job.progress);
        if (!job.running) break;
        await new Promise(r => setTimeout(r, POLL_MS));
        const next = await api('/api/export/job');
        if (!next.ok) throw new Error(await failure(next));
        job = await next.json();
    }
    if (job.cancelled) throw Object.assign(new Error('The export was cancelled: the last export is as it was.'), { cancelled: true });
    if (job.error) throw new Error(job.error);
    return job.result;
}

/** Exports the area open in the browser page, whose engine says how far it is in its log (worker.js): its report. */
async function exportInPage(name) {
    const box = progressBox(name, null);
    web.progress = p => box.show(p);
    try {
        return await sendArea('export');
    } finally {
        web.progress = null;
    }
}

/** The markers of `report` (an export's or a path check's of area `a`) on the ground, when `a` is still the area open: another
 *  area opened meanwhile gets none of them, and the status line says whose the report is. */
function showMarkers(a, report) {
    if (ctx.area() === a) {
        ctx.view.setMarkers(report.warnings || []);
        say('');
    } else say(`The report is ${a.name}'s, which is no longer open: open it again to see where on the ground.`);
}

/** Sets up the Export and Check paths buttons. */
export function initExport(c) {
    ctx = c;
    $('btnExport').onclick = async () => {
        if (ctx.readOnly()) return;
        if (!ctx.area()) return;
        // Textures the library hasn't got: the engine would refuse the area anyway; this says which, and how to fix it.
        const blocked = exportBlocked();
        if (blocked) {
            showError(blocked, 'Export refused');
            return;
        }
        const btn = $('btnExport');
        btn.disabled = true;
        const a = ctx.area();
        try {
            // (In the browser: the game's shaders first, from the visitor's game folder, asked for once a visit.)
            const shaders = web.on && (await shadersForExport());
            say(`Exporting ${a.name}…`);
            const report = web.on ? await exportInPage(a.name) : await exportWithProgress(a.name);
            // (In the browser the export is a download: its zip, named in the report.)
            if (web.on) Object.assign(report, { download: await downloadExport(report), shaders });
            showReport(report, false, a);
            showMarkers(a, report);
        } catch (err) {
            say('');
            showError(err.message, err.cancelled ? 'Export cancelled' : engine.up ? 'Export failed' : 'Export needs the engine');
        } finally {
            btn.disabled = false;
        }
    };

    // Check paths: the export's planning and route simulation, nothing built.
    $('btnCheck').onclick = async () => {
        if (ctx.readOnly()) return;
        if (!ctx.area()) return;
        const btn = $('btnCheck');
        btn.disabled = true;
        const a = ctx.area();
        say('Checking how NWN will path this area…');
        try {
            const report = await sendArea('check');
            showReport(report, true, a);
            showMarkers(a, report);
        } catch (err) {
            say('');
            showError(err.message, engine.up ? 'Path check failed' : 'Check paths needs the engine');
        } finally {
            btn.disabled = false;
        }
    };
}
