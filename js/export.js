// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Export (the area built into the module) and Check paths (the export's planning and route simulation, nothing built): the
// area sent to the engine, its report shown.

import { thingsForExport } from './things.js';
import { ambienceForExport } from './ambience.js';
import { api, engine, failure } from './api.js';
import { $, say } from './dom.js';
import { showReport, showError } from './report.js';
import { web } from './web.js';
import { downloadExport } from './webdemo.js';

/** What app.js gives this file (initExport): `area()`, `readOnly()` and `view`. */
let ctx = null;

/** The area open, as landscaper serve takes it: the query string has its name and simple settings (tiles, shadow, kind, roof,
 *  clearance, module); the body is its heights (f32 a sample), each sample's palette index (u8), then JSON with its lists and
 *  objects (palette, water, chasm, lights, entrances, atmosphere, objects, things, settings, originals, ambience). */
export function areaRequest() {
    const a = ctx.area();
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
        }),
    );
    const heights = new Uint8Array(a.heights.buffer, a.heights.byteOffset, a.heights.byteLength);
    const body = new Uint8Array(heights.byteLength + a.materials.byteLength + extra.byteLength);
    body.set(heights);
    body.set(a.materials, heights.byteLength);
    body.set(extra, heights.byteLength + a.materials.byteLength);
    const query = new URLSearchParams({ name: a.name, tiles: a.tiles, tilesY: a.tilesY, shadow: a.shadow });
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
        const btn = $('btnExport');
        btn.disabled = true;
        const a = ctx.area();
        say(`Exporting ${a.name}…`);
        try {
            const report = await sendArea('export');
            // (In the browser the export is a download: its zip, named in the report.)
            if (web.on) report.download = await downloadExport(report);
            showReport(report);
            showMarkers(a, report);
        } catch (err) {
            say('');
            showError(err.message, engine.up ? 'Export failed' : 'Export needs the engine');
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
            showReport(report, true);
            showMarkers(a, report);
        } catch (err) {
            say('');
            showError(err.message, engine.up ? 'Path check failed' : 'Check paths needs the engine');
        } finally {
            btn.disabled = false;
        }
    };
}
