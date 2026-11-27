// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// What the page shows only when its engine runs in the browser (web.js says when): File, Download area and Open area from a
// file, since the browser's storage is no backup; the export downloaded as a zip; Help with the engine's source (it is GPL-3.0
// and this page hands it out); and the browser's own words where the desktop's would name a server or a folder on disk.

import { api, failure } from './api.js';
import { Area } from './area.js';
import { ask } from './ask.js';
import { $, say } from './dom.js';
import { showError } from './report.js';
import { flushSave, saveNew } from './save.js';
import { download, web } from './web.js';

/** What the "No engine" line says when the engine couldn't start in this browser. */
export const NO_ENGINE_HERE = reason =>
    `The engine couldn't start in this browser${reason ? ` (${reason})` : ''}, so exporting, the path check and the texture library are off. Sculpting works, and the browser keeps your area. A current Chrome, Edge, Firefox or Safari runs it.`;

/** The engine's source at version `version` (as /api/me gives it): its tag for a release, else the main branch. */
export function sourceUrl(version) {
    const repo = 'https://github.com/plenarius/nwn-landscaper';
    return /^\d+\.\d+\.\d+$/.test(version ?? '') ? `${repo}/tree/v${version}` : repo;
}

/** A name for an area from a file called `file` that names none: its name without `.json`, kept to what an area name takes
 *  (a to z, digits and _, 9 at most, as New area asks). */
export function nameFromFile(file) {
    const name = file
        .replace(/\.json$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .slice(0, 9);
    return name || 'area';
}

/** Downloads the area open, as the engine keeps it. */
async function downloadArea(ctx) {
    const a = ctx.area();
    if (!a) return;
    await flushSave();
    download(`${a.name}.json`, new TextEncoder().encode(JSON.stringify(a.toJSON())), 'application/json');
    say(`Downloaded ${a.name}.json. Keep it somewhere safe: the browser's storage is no backup.`);
}

/** Opens an area from `file` (a File the builder picked): it joins the areas in this browser, replacing one of its name if asked. */
async function openFile(ctx, file) {
    let a;
    try {
        const o = JSON.parse(await file.text());
        if (typeof o !== 'object' || !o || !o.heights) throw new Error('no heights');
        o.name ||= nameFromFile(file.name);
        a = Area.fromJSON(o);
    } catch (err) {
        showError(`${file.name} isn't an area the Landscaper saved (${err.message}).`, "Couldn't open the file");
        return;
    }
    try {
        if (!(await saveNew(a))) {
            const yes = await ask({
                title: 'Replace the area?',
                text: `This browser already has an area called ${a.name}. Replace it with the one in ${file.name}?`,
                ok: 'Replace',
                danger: true,
            });
            if (!yes || !(await saveNew(a, true))) return;
        }
    } catch (err) {
        showError(err.message, "Couldn't open the file");
        return;
    }
    ctx.setArea(a);
    say(`Opened ${a.name} from ${file.name}.`);
}

/** The export of `report` (an export's report) as a zip download: its module, its haks and a note on where they go. */
export async function downloadExport(report) {
    const zip = await web.call('export-zip', report.name, report.installed_module || report.module);
    download(zip.name, zip.blob);
    return zip.name;
}

/** Sets up the browser's items when the engine runs in this page; does nothing otherwise. `ctx`: area(), setArea(a). */
export function initWebDemo(ctx) {
    if (!web.on) return;
    $('noEngineHow').hidden = true;
    $('noEngineWhy').textContent = NO_ENGINE_HERE(web.failed);
    $('menuHelp').hidden = false;
    for (const id of ['helpData', 'helpLog', 'sepHelp']) $(id).hidden = true;
    $('helpSource').hidden = false;
    // (Texture packs come from the Internet, which the engine here can't reach yet.)
    $('btnPacks').hidden = true;
    for (const id of ['sepAreaFile', 'btnDownloadArea', 'btnOpenFile']) $(id).hidden = false;
    $('btnDownloadArea').onclick = () => downloadArea(ctx);
    $('btnOpenFile').onclick = () => $('areaFile').click();
    $('areaFile').onchange = () => {
        const file = $('areaFile').files?.[0];
        $('areaFile').value = '';
        if (file) openFile(ctx, file);
    };
    api('/api/me')
        .then(async res => {
            if (!res.ok) throw new Error(await failure(res));
            $('helpSource').href = sourceUrl((await res.json()).version);
        })
        .catch(() => {});
}
