// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Export (the area built into the module) and Check paths (the export's planning and route simulation, nothing built): the
// area sent to the engine, its report shown.

import { thingsForExport } from './things.js';
import { api, engine, failure } from './api.js';
import { $ } from './dom.js';
import { showReport, showError } from './report.js';

/** What app.js gives this file (initExport): `area()`, `readOnly()` and `view`. */
let ctx = null;

/** The area as landscaper serve takes it: heights (f32 a sample), each
 *  sample's palette index (u8), then JSON too long for the query (the
 *  objects); the rest in the query. */
function areaRequest() {
    const extra = new TextEncoder().encode(
        JSON.stringify({
            objects: ctx.area().objects,
            things: thingsForExport(ctx.area().things),
            settings: ctx.area().settings,
            originals: ctx.area().originals,
        }),
    );
    const body = new Uint8Array(ctx.area().heights.byteLength + ctx.area().materials.byteLength + extra.byteLength);
    body.set(new Uint8Array(ctx.area().heights.buffer, ctx.area().heights.byteOffset, ctx.area().heights.byteLength));
    body.set(ctx.area().materials, ctx.area().heights.byteLength);
    body.set(extra, ctx.area().heights.byteLength + ctx.area().materials.byteLength);
    const query =
        `name=${encodeURIComponent(ctx.area().name)}&tiles=${ctx.area().tiles}&tilesY=${ctx.area().tilesY}&palette=${encodeURIComponent(ctx.area().palette.join(','))}` +
        `&atmosphere=${encodeURIComponent(JSON.stringify(ctx.area().atmosphere))}` +
        `&water=${encodeURIComponent(JSON.stringify(ctx.area().water))}` +
        `&shadow=${ctx.area().shadow}` +
        `&entrances=${encodeURIComponent(JSON.stringify(ctx.area().entrances))}` +
        (ctx.area().enclosed()
            ? `&kind=${ctx.area().kind}&roof=${ctx.area().roof}${ctx.area().clearance > 0 ? `&clearance=${ctx.area().clearance}` : ''}`
            : '') +
        `&module=${encodeURIComponent(ctx.area().module || ctx.area().name)}`;
    return { query, body };
}

/** Sends the area to `what` (export or check); its report, or throws. */
export async function sendArea(what) {
    const { query, body } = areaRequest();
    const res = await api(`/api/${what}?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body });
    if (res.status === 404 || res.status === 501) throw new Error('This page is not being served by landscaper. Run: landscaper serve');
    if (!res.ok) throw new Error(await failure(res));
    return await res.json();
}

/** Sets up the Export and Check paths buttons. */
export function initExport(c) {
    ctx = c;
    $('btnExport').onclick = async () => {
        if (ctx.readOnly()) return;
        if (!ctx.area()) return;
        const btn = $('btnExport');
        btn.disabled = true;
        $('statusMsg').textContent = `Exporting ${ctx.area().name}…`;
        try {
            const report = await sendArea('export');
            showReport(report);
            ctx.view.setMarkers(report.warnings || []);
            $('statusMsg').textContent = '';
        } catch (err) {
            $('statusMsg').textContent = '';
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
        $('statusMsg').textContent = 'Checking how NWN will path this area…';
        try {
            const report = await sendArea('check');
            showReport(report, true);
            ctx.view.setMarkers(report.warnings || []);
            $('statusMsg').textContent = '';
        } catch (err) {
            $('statusMsg').textContent = '';
            showError(err.message, engine.up ? 'Path check failed' : 'Check paths needs the engine');
        } finally {
            btn.disabled = false;
        }
    };
}
