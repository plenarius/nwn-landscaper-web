// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// What the page shows only when its engine runs in the browser (web.js says when): File, Download area and Open area from a
// file, since the browser's storage is no backup; the export downloaded as a zip; Help with the engine's source (it is GPL-3.0
// and this page hands it out); and the browser's own words where the desktop's would name a server or a folder on disk.

import { api, failure } from './api.js';
import { Area } from './area.js';
import { ask } from './ask.js';
import { $, el, say } from './dom.js';
import { showError } from './report.js';
import { browserCopies, flushSave, loadArea, saveNew } from './save.js';
import { download, web } from './web.js';

/** What the "No engine" line says when the engine couldn't start in this browser. */
export const NO_ENGINE_HERE = reason =>
    `The engine couldn't start in this browser${reason ? ` (${reason})` : ''}, so exporting, the path check and the texture library are off. Sculpting works, and the browser keeps your area. A current Chrome, Edge, Firefox or Safari runs it.`;

/** The largest area, in tiles a side, the page makes without asking first: an export of 16 by 16 needs about 0.4 GB. */
export const BROWSER_TILES = 16;

/** About how many GB an export of a `w` by `h` area needs in the page (measured: 16 by 16 0.39 GB, 32 by 32 1.17 GB). */
export const exportGb = (w, h) => Math.max(0.1, 0.39 + ((w * h - 256) * (1.17 - 0.39)) / (1024 - 256));

/** Whether to make or open a `w` by `h` area: at once up to BROWSER_TILES a side, or outside the browser; else asks first. */
export async function bigAreaOk(w, h) {
    if (!web.on || (w <= BROWSER_TILES && h <= BROWSER_TILES)) return true;
    const answer = await ask({
        title: 'A big area for a browser',
        text: `Exporting a ${w}×${h} area needs about ${exportGb(w, h).toFixed(1)} GB of memory in this page (16×16 needs 0.4 GB). A phone or a small laptop may not have that much, and the export then stops with "too big for this browser". The Landscaper on your computer has no such limit.`,
        ok: 'Make it anyway',
        cancel: 'Cancel',
    });
    return answer === true;
}

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

/** The origins an `?area=` link may load an area from: this site's own, so no other site can make the page fetch a file. A
 *  hosted library of areas would be added here, and to index.html's connect-src; it has to allow this page's origin (CORS). */
export const AREA_ORIGINS = [location.origin];

/** The area file `?area=` names in `search` (a page's query), as a URL from `base` (the page's address), or null when there is
 *  none or it is from an origin `origins` doesn't list. */
export function areaLink(search, base, origins = AREA_ORIGINS) {
    const value = new URLSearchParams(search).get('area');
    if (!value) return null;
    try {
        const url = new URL(value, base);
        return origins.includes(url.origin) ? url : null;
    } catch {
        return null;
    }
}

/** The first name from `name` that `taken` (a Set) hasn't got: `name2`, `name3`... cut to keep 9 characters at most. */
export function freeName(name, taken) {
    for (let n = 2; ; n++) {
        const s = String(n);
        const candidate = name.slice(0, 9 - s.length) + s;
        if (!taken.has(candidate)) return candidate;
    }
}

/** Area JSON `o` read from a file called `file`, as an Area (named from the file when it names none); throws when it isn't one. */
export function areaFrom(o, file) {
    if (typeof o !== 'object' || !o || !o.heights) throw new Error('no heights');
    o.name ||= nameFromFile(file);
    return Area.fromJSON(o);
}

/** The names of the areas in this browser: the engine's, and the copies kept beside it. */
export async function areaNames() {
    const names = new Set(browserCopies());
    const res = await api('/api/areas');
    if (!res.ok) throw new Error(await failure(res));
    for (const a of (await res.json()).areas ?? []) names.add(a.name);
    return names;
}

/**
 * The area an `?area=` link names (the showcase's Open in Landscaper), saved into this browser, to open at the start; null when
 * the page has no such link or the builder cancelled. Throws, saying why, when it couldn't open it (the caller shows that once
 * an area is open, which would hide it). An area of the same name already here stays as it is: the builder opens theirs, or
 * the link's under a free name. The link leaves the address, so a reload doesn't ask again.
 */
export async function linkedArea() {
    const params = new URLSearchParams(location.search);
    if (!web.on || !params.has('area')) return null;
    const url = areaLink(location.search, location.href);
    params.delete('area');
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
    if (!url) throw new Error("The link names an area on another site, which this page doesn't open.");
    const file = url.pathname.split('/').pop();
    let a;
    try {
        // biome-ignore lint/plugin: a file of this site's (AREA_ORIGINS), not an engine request
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim());
        if (!AREA_ORIGINS.includes(new URL(res.url).origin)) throw new Error('it moved to another site');
        a = areaFrom(await res.json(), file);
    } catch (err) {
        throw new Error(`${file} isn't an area this page could open (${err.message}).`);
    }
    if (!(await bigAreaOk(a.tiles, a.tilesY))) return null;
    if (!(await saveNew(a))) {
        const copy = freeName(a.name, await areaNames());
        const answer = await ask({
            title: 'An area of that name',
            text: `This browser already has an area called ${a.name}. Open yours, or the one from the link as ${copy}?`,
            ok: `Open the link's as ${copy}`,
            cancel: `Open ${a.name}`,
        });
        if (answer === null) return null;
        if (answer === false) return await loadArea(a.name);
        a.name = copy;
        if (!(await saveNew(a))) throw new Error(`${copy} was taken meanwhile: open the link again.`);
    }
    say(`Opened ${a.name} from ${file}.`);
    return a;
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
        a = areaFrom(JSON.parse(await file.text()), file.name);
    } catch (err) {
        showError(`${file.name} isn't an area the Landscaper saved (${err.message}).`, "Couldn't open the file");
        return;
    }
    if (!(await bigAreaOk(a.tiles, a.tilesY))) return;
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

/** The handbook's page for installing the app on each system. */
export const DESKTOP_URL = 'https://landscaper.layonara.com/handbook/getting-started/';

/** Sets up the browser's items when the engine runs in this page; does nothing otherwise. `ctx`: area(), setArea(a). */
export function initWebDemo(ctx) {
    if (!web.on) return;
    $('noEngineHow').hidden = true;
    $('noEngineWhy').textContent = NO_ENGINE_HERE(web.failed);
    $('menuHelp').hidden = false;
    for (const id of ['helpData', 'helpLog', 'sepHelp']) $(id).hidden = true;
    $('helpSource').hidden = false;
    // Under the title: where to get the app for the desktop.
    document
        .querySelector('#topbar .brand')
        .append(
            el('a', { className: 'brand-badge', href: DESKTOP_URL, target: '_blank', rel: 'noopener', textContent: 'Download to desktop' }),
        );
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
