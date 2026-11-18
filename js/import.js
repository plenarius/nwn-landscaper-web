// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Importing an NWN area: the Import dialog (an area of the module, found by a search on the server, or one of the
// builder's own .mod or .erf files uploaded here) and Re-import in the Open dialog. Both open the area when done; while one
// runs, its dialog can't be closed.

import { ask } from './ask.js';
import { api, engine, NEEDS_ENGINE } from './api.js';
import { $, el } from './dom.js';
import { showError } from './report.js';
import { flushSave } from './save.js';

/** What app.js gives this file (initImport): `readOnly()` and `openArea(a, settle)` (see app.js). */
let ctx = null;

// What a list shows for an area: the name the game shows for it (when the server knows it), else its tag.
const areaTitle = s => String(s.name || s.tag || s.area);
/** An area's row in a list: its title in bold, its resref small beside it, then `small` below. */
export const areaRow = (s, small) => [
    el('span', {}, el('b', { textContent: areaTitle(s) }), ' ', el('small', { textContent: s.area })),
    el('small', { textContent: small }),
];

let importChosen = null,
    importing = false,
    importSeq = 0,
    importTimer = null;
/** While an import runs: its button, the list and the fields can't change it. */
function setImporting(on) {
    importing = on;
    $('importGo').textContent = on ? 'Importing…' : 'Import';
    $('importGo').classList.toggle('busy', on);
    for (const id of ['importFind', 'importName', 'importFile']) $(id).disabled = on;
    for (const b of $('importList').querySelectorAll('button')) b.disabled = on;
    $('importName').oninput();
}

async function showImportList() {
    const mine = ++importSeq;
    const box = $('importList');
    let r = { sources: [] };
    try {
        r = await (await api(`/api/import-sources?q=${encodeURIComponent($('importFind').value.trim())}`)).json();
    } catch {
        /* none */
    }
    // Their own uploaded files come first, and stay while they search (filtered by the same words).
    let uploads = [];
    try {
        uploads = (await (await api('/api/uploads')).json()).uploads ?? [];
    } catch {
        /* none */
    }
    if (mine !== importSeq) return; // a newer search is on its way
    box.textContent = '';
    const words = $('importFind').value.toLowerCase().split(/\s+/).filter(Boolean);
    const own = uploads
        .flatMap(u => (u.areas ?? []).map(a => ({ ...a, upload: u.file, from: `your file ${u.file}` })))
        .filter(a => words.every(w => `${a.tag} ${a.area} ${a.tileset} ${a.upload}`.toLowerCase().includes(w)));
    const found = [...own, ...(r.sources ?? [])];
    for (const s of found) {
        const b = document.createElement('button');
        b.type = 'button';
        if (s.upload) {
            b.dataset.upload = s.upload;
            b.dataset.area = s.area;
        }
        // An admin's entries say what they come from; a builder's say whether it is theirs.
        const kind = s.kind ?? (s.flags & 1 ? 'interior' : s.flags & 2 ? 'underground' : 'outdoors');
        const allowed = s.assigned !== false;
        const state = s.assigned === true ? ' · assigned to you' : allowed ? '' : ' · needs an assignment';
        b.append(...areaRow(s, `${s.width}×${s.height} · ${s.tileset} · ${kind}${s.from ? ` · ${s.from}` : ''}${state}`));
        b.disabled = !allowed;
        if (!allowed) b.title = 'Ask an admin to assign this area to you';
        if (importChosen?.area === s.area && importChosen?.upload === s.upload) b.classList.add('selected');
        b.onclick = () => {
            importChosen = s;
            for (const o of box.children) o.classList.toggle('selected', o === b);
            // A name from its tag: lower case, letters, digits and _, 9 at most.
            $('importName').value =
                (s.tag || s.area)
                    .toLowerCase()
                    .replace(/[^a-z0-9_]/g, '')
                    .slice(0, 9) || 'imported';
            $('importName').oninput();
        };
        box.appendChild(b);
    }
    if (!found.length) box.textContent = engine.up ? r.note || 'No area matches.' : NEEDS_ENGINE;
    else if (r.note) box.prepend(el('p', { className: 'note', textContent: r.note }));
    else if (r.total > found.length)
        box.append(el('p', { className: 'note', textContent: `${r.total - found.length} more: narrow the search.` }));
}

/** Imports area `a` again from its kept original, then opens it. */
export async function reimport(a, button) {
    if (ctx.readOnly()) return;
    const yes = await ask({
        title: `Import ${a.name} again?`,
        text: `Your changes to it here are replaced (the last copy is kept as a backup).\n\nIts next export puts the original's placeables, creatures and lighting into the module again, replacing what was changed there in the toolset.`,
        ok: 'Re-import',
        danger: true,
    });
    if (!yes) return;
    // The whole dialog waits for it: every button off, no closing it.
    reimporting = true;
    for (const b of $('openDialog').querySelectorAll('button')) b.disabled = true;
    button.textContent = 'Importing…';
    button.classList.add('busy');
    try {
        // The area's waiting save goes first: after the import it would write the old area back over the new one.
        await flushSave();
        const res = await api(`/api/reimport?name=${encodeURIComponent(a.name)}`, { method: 'POST' });
        const r = await res.json();
        if (!res.ok) throw new Error(r.error || res.statusText);
        reimporting = false;
        for (const b of $('openDialog').querySelectorAll('button')) b.disabled = false;
        $('openDialog').close();
        // (a copy of it still in this browser stays there: the next start asks about it)
        await ctx.openArea({ name: a.name }, false);
        $('statusMsg').textContent =
            `Imported ${a.name} again: ${r.standing} tiles with trees or buildings, ${r.objects} objects (placed on export).${r.notes.length ? ` Notes: ${r.notes.join('; ')}` : ''}`;
    } catch (err) {
        $('openDialog').close();
        showError(`Couldn't import ${a.name} again: ${err.message}`, 'Import failed');
    } finally {
        reimporting = false;
        for (const b of $('openDialog').querySelectorAll('button')) b.disabled = false;
    }
}
let reimporting = false;

/** Wires the Import dialog and Escape while an import runs. `c`: { readOnly(), openArea(a) } from app.js. */
export function initImport(c) {
    ctx = c;
    $('btnImport').onclick = async () => {
        if (ctx.readOnly()) return;
        $('openDialog').close();
        $('importStatus').textContent = '';
        $('importDialog').showModal();
        $('importFind').value = '';
        importChosen = null;
        showImportList();
        $('importFind').focus();
    };
    // The server searches (a builder can't be sent the whole module's list).
    $('importFind').oninput = () => {
        clearTimeout(importTimer);
        importTimer = setTimeout(showImportList, 250);
    };
    // Not closed (Escape, Cancel) while an import runs: it opens the area when done.
    $('importDialog').addEventListener('cancel', e => {
        if (importing) e.preventDefault();
    });
    $('importDialog')
        .querySelector('button[value=cancel]')
        .addEventListener('click', e => {
            if (importing) e.preventDefault();
        });
    $('importName').oninput = () => {
        $('importGo').disabled = importing || !importChosen || !$('importName').checkValidity() || !$('importName').value;
    };

    // Their own file goes up as it is (the server checks it reads as a module); its areas then show in the list.
    $('importFile').onchange = async () => {
        const file = $('importFile').files[0];
        if (!file || importing) return;
        // The server keeps letters, digits and _ . - (a toolset file is often called "My Cave.erf").
        const kept = file.name.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^\.+/, '_');
        const ext = /\.(mod|erf)$/i.exec(kept)?.[0] ?? '';
        const saveAs = kept.slice(0, kept.length - ext.length).slice(0, 64 - ext.length) + ext;
        $('importStatus').textContent = `Uploading ${file.name}…`;
        try {
            const res = await api(`/api/upload?file=${encodeURIComponent(saveAs)}`, { method: 'POST', body: file });
            const r = await res.json();
            if (!res.ok) throw new Error(r.error || res.statusText);
            $('importFind').value = '';
            importChosen = null;
            await showImportList();
            const only =
                r.areas.length === 1
                    ? [...$('importList').querySelectorAll('button')].find(
                          b => b.dataset.upload === saveAs && b.dataset.area === r.areas[0].area,
                      )
                    : null;
            if (only) {
                only.click();
                $('importStatus').textContent =
                    `${file.name}: its area (${r.areas[0].tag || r.areas[0].area}) is chosen. Change the name if you like, then Import.`;
            } else {
                $('importStatus').textContent =
                    `${file.name}: ${r.areas.length} area${r.areas.length === 1 ? '' : 's'}, at the top of the list. Pick one.`;
            }
        } catch (err) {
            $('importStatus').textContent = `Couldn't use ${file.name}: ${err.message}`;
        }
        $('importFile').value = '';
    };

    $('importGo').onclick = async () => {
        if (!importChosen) return;
        if (importing) return;
        const name = $('importName').value;
        setImporting(true);
        $('importStatus').textContent =
            `Importing ${importChosen.tag || importChosen.area} as ${name}… (reading its tiles and the module's haks takes a little while)`;
        try {
            const res = await api(
                `/api/import?area=${encodeURIComponent(importChosen.area)}&name=${encodeURIComponent(name)}${importChosen.upload ? `&upload=${encodeURIComponent(importChosen.upload)}` : ''}`,
                { method: 'POST' },
            );
            const r = await res.json();
            if (!res.ok) throw new Error(r.error || res.statusText);
            setImporting(false);
            $('importDialog').close();
            await ctx.openArea({ name });
            $('statusMsg').textContent =
                `Imported ${importChosen.tag || importChosen.area} as ${name}: ${r.standing} tiles with trees or buildings, ${r.objects} objects (placed on export).${r.notes.length ? ` Notes: ${r.notes.join('; ')}` : ''}`;
        } catch (err) {
            $('importStatus').textContent = `Couldn't import: ${err.message}`;
            setImporting(false);
        }
    };

    $('openDialog').addEventListener('cancel', e => {
        if (reimporting) e.preventDefault();
    });
    // (Escape itself too, wherever focus is with every button off: browsers let
    // it close a dialog regardless when there was no click since the last time.)
    document.addEventListener(
        'keydown',
        e => {
            if ((reimporting || importing) && e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
            }
        },
        true,
    );
}
