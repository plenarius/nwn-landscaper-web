// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Get more textures dialog (the Paint panel's button): the texture packs the engine's index offers and the installed ones,
// with Install and Remove. An install runs in the engine; this page asks for its progress until it ends, even with the dialog
// closed, and then reloads the library so the new textures show in their categories (packs.js has the logic).

import { ask } from './ask.js';
import { api, failure, json } from './api.js';
import { $, el, say } from './dom.js';
import { packRows, progressOf, rowFacts } from './packs.js';

/** How often an install's progress is asked for (ms). */
const POLL_MS = 400;

/** What app.js gives this file: `changed()`, called after the library changed (reloads it and the palette). */
let ctx = null;
let polling = false;

function status(text, kind = '') {
    $('packsStatus').textContent = text;
    $('packsStatus').className = `note${kind ? ` ${kind}` : ''}`;
}

function showProgress(job) {
    const p = progressOf(job);
    const bar = $('packsBar');
    bar.hidden = !job?.running;
    if (p.fraction == null) bar.removeAttribute('value');
    else bar.value = p.fraction;
    status(p.text, p.failed ? 'err' : p.done ? 'ok' : '');
}

/** Asks for the job's progress until it ends; then reloads the library and the list. */
async function follow() {
    if (polling) return;
    polling = true;
    try {
        for (;;) {
            const job = await json(await api('/api/textures/packs/job'));
            showProgress(job);
            if (!job.running) {
                if (job.step === 'done') {
                    await ctx.changed();
                    say(progressOf(job).text);
                } else if (job.step === 'failed') {
                    say(progressOf(job).text);
                }
                break;
            }
            await new Promise(r => setTimeout(r, POLL_MS));
        }
    } finally {
        polling = false;
    }
    if ($('packsDialog').open) await list(false);
}

async function install(row) {
    const res = await api(`/api/textures/packs/install?id=${encodeURIComponent(row.id)}`, { method: 'POST' });
    if (!res.ok) {
        status(await failure(res), 'err');
        return;
    }
    showProgress(await json(res));
    await list(false);
    follow();
}

async function remove(row) {
    const ok = await ask({
        title: `Remove ${row.name}`,
        text: `Its ${row.count ?? ''} textures leave the library and the next export's texture hak. An area that still paints with one of them keeps the pack from being removed.`,
        ok: 'Remove',
        danger: true,
    });
    if (!ok) return;
    status(`Removing ${row.name}…`);
    const res = await api(`/api/textures/packs/remove?id=${encodeURIComponent(row.id)}`, { method: 'POST' });
    if (!res.ok) {
        status(await failure(res), 'err');
        return;
    }
    const r = await json(res);
    await ctx.changed();
    status(`Removed ${r.name}: ${r.textures} textures.`, 'ok');
    say(`Removed the texture pack ${r.name}.`);
    await list(false);
}

/** One pack's row: its swatches, name, facts, credits and description, and its buttons. */
function rowOf(row) {
    const swatches = el('div', { className: 'pack-swatches' });
    for (const s of row.swatches) swatches.append(el('img', { src: s, alt: '', width: 48, height: 48 }));
    const buttons = el('div', { className: 'pack-buttons' });
    if (row.install) {
        const b = el('button', { type: 'button', className: 'primary', textContent: row.install });
        b.setAttribute('aria-label', `${row.install} ${row.name}`);
        b.onclick = () => install(row);
        buttons.append(b);
    }
    if (row.remove) {
        const b = el('button', { type: 'button', textContent: 'Remove' });
        b.setAttribute('aria-label', `Remove ${row.name}`);
        b.onclick = () => remove(row);
        buttons.append(b);
    }
    if (row.busy) buttons.append(el('span', { className: 'note', textContent: 'Installing…' }));
    const head = el('h3', {}, row.name, ' ', el('small', { textContent: row.version }));
    const text = el(
        'div',
        { className: 'pack-text' },
        head,
        el('p', { className: 'note', textContent: rowFacts(row) }),
        row.credits && el('p', { className: 'pack-credits', textContent: row.credits }),
        row.description && el('p', { textContent: row.description }),
        row.categories.length > 0 && el('p', { className: 'note', textContent: `Categories: ${row.categories.join(', ')}` }),
    );
    const item = el('li', { className: `pack-row ${row.state}` }, row.swatches.length > 0 && swatches, text, buttons);
    item.dataset.pack = row.id;
    return item;
}

/** Fills the list from the engine; `fresh` reads the index again rather than the engine's kept copy. */
async function list(fresh) {
    const box = $('packsList');
    const res = await api(`/api/textures/packs${fresh ? '?fresh=1' : ''}`);
    if (!res.ok) {
        box.textContent = await failure(res);
        return;
    }
    const answer = await json(res);
    const rows = packRows(answer);
    box.textContent = '';
    if (!rows.length) box.append(el('p', { className: 'note', textContent: 'No texture packs are on offer.' }));
    box.append(el('ul', { className: 'pack-list', ariaLabel: 'Texture packs' }, ...rows.map(rowOf)));
    $('packsIndexError').hidden = !answer.index_error;
    $('packsIndexError').textContent = answer.index_error ? `The list of packs could not be read: ${answer.index_error}` : '';
    $('packsManage').hidden = !!answer.manage;
    if (answer.job?.running) {
        showProgress(answer.job);
        follow();
    }
}

/** Wires the Paint panel's button to the dialog. `changed()` reloads the library and the palette. */
export function initPacks({ changed }) {
    ctx = { changed };
    $('btnPacks').onclick = async () => {
        $('packsList').textContent = 'Loading…';
        status('');
        $('packsBar').hidden = true;
        $('packsDialog').showModal();
        await list(true);
    };
}
