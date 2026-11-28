// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// A canvas's Publish dialog (design question 9, mock-up 4): its pieces ticked as the engine says, a dry run and route check
// of the ticked ones, then one review request; or a package, or a trial on dev. A package doesn't count as a publish.

import { api, failure, json } from './api.js';
import { $, el } from './dom.js';
import { pieceLabel } from './pieces.js';
import { everyPiece, publishRows, refusedOf, removedLines, sendText, warningLines } from './canvaspub.js';

/** What publish.js gives this file: `area()`, `me()`. */
let ctx = null;
/** The rows shown, the dry run's pieces once it passed (a send only follows a dry run of the same ticks), the removed lines. */
const st = { rows: [], checked: '', removed: [], busy: false };

const canvasName = () => ctx.area().name;
const ticked = () => st.rows.filter(r => r.ticked).map(r => r.name);
const q = names => `name=${encodeURIComponent(canvasName())}${names.length ? `&pieces=${names.map(encodeURIComponent).join(',')}` : ''}`;

async function call(path, opts) {
    const res = await api(path, opts);
    if (!res.ok) throw new Error(await failure(res));
    return json(res);
}

function show(text, mode = '') {
    $('cpText').textContent = text;
    $('cpText').className = `note ${mode}`.trim();
    $('cpBar').hidden = mode !== 'work';
}

function notes(lines) {
    $('cpNotes').replaceChildren(...lines.map(([level, text]) => el('li', { className: `finding ${level}`, textContent: text })));
    $('cpNotes').hidden = !lines.length;
}

/** The buttons for the ticks now: nothing ticked sends nothing; changed ticks need a new dry run. */
function buttons() {
    const names = ticked(),
        me = ctx.me(),
        pkg = !!me.package;
    const ready = !!names.length && st.checked === names.join(',');
    $('cpGo').hidden = pkg;
    $('cpGo').disabled = st.busy || !names.length || refusedOf(st.rows, names).length > 0;
    $('cpGo').textContent = ready
        ? sendText(names.length)
        : names.length
          ? `Check ${names.length} piece${names.length === 1 ? '' : 's'}`
          : 'Check';
    $('cpPackage').disabled = st.busy || !names.length;
    $('cpTry').hidden = !(me.team && me.publish && !pkg);
    $('cpTry').disabled = st.busy || !ready;
    $('cpExport').hidden = !st.rows.some(r => r.refused);
    $('cpNoteRow').hidden = pkg;
    $('cpEvery').checked = st.rows.length > 0 && everyPiece(st.rows).every(n => names.includes(n));
}

function draw() {
    $('cpRows').replaceChildren(
        ...st.rows.map(r => {
            const box = el('input', { type: 'checkbox', checked: r.ticked, disabled: !!r.refused || st.busy });
            box.setAttribute('aria-label', `Send ${r.label}`);
            box.onchange = () => {
                r.ticked = box.checked;
                changed();
            };
            const name = el(
                'td',
                {},
                el('b', { textContent: r.label }),
                r.label !== r.name ? el('code', { textContent: ` ${r.name}` }) : '',
            );
            const why = el('td', { className: r.refused ? 'bad' : r.moved ? 'warn' : '' }, r.refused ? `${r.refused} (${r.why})` : r.why);
            return el('tr', { className: r.refused ? 'refused' : '' }, el('td', {}, box), name, why);
        }),
    );
    $('cpEveryCount').textContent = `(${everyPiece(st.rows).length})`;
    buttons();
}

/** The ticks changed: what the last dry run said no longer holds. */
function changed() {
    st.checked = '';
    $('cpLinks').replaceChildren();
    notes(st.removed.map(t => ['warn', t]));
    show(ticked().length ? '' : 'Tick the pieces to send.');
    buttons();
}

/** Opens the dialog for the canvas open: the engine says what changed. */
export async function openCanvasPublish(c) {
    ctx = c;
    const label = n => {
        const p = (ctx.area().canvas?.pieces ?? []).find(x => x.name === n);
        return p ? pieceLabel(p) : n;
    };
    st.rows = [];
    st.removed = [];
    st.checked = '';
    st.busy = false;
    $('cpTitle').textContent = ctx.me().package ? `Package ${canvasName()} for your module` : `Send ${canvasName()} for review`;
    $('cpLinks').replaceChildren();
    $('cpNote').disabled = false;
    notes([]);
    draw();
    $('canvasPubDialog').showModal();
    show('Finding what changed since the last publish…', 'work');
    try {
        await ctx.flushSave?.();
        const changes = await call(`/api/canvas-changes?name=${encodeURIComponent(canvasName())}`);
        st.rows = publishRows(changes, label);
        st.removed = removedLines(changes.removed);
        draw();
        changed();
        const refused = st.rows.filter(r => r.refused).length;
        if (refused)
            show(
                `${refused} piece${refused === 1 ? '' : 's'} changed since the last export and can't be sent until exported again: Export again, then open this again.`,
                'err',
            );
    } catch (err) {
        show(`Can't publish yet: ${err.message}`, 'err');
    }
}

/** The dry run and the route check of the ticked pieces, side by side: what the review service says, and the warnings. */
async function check() {
    const names = ticked();
    st.busy = true;
    draw();
    show(`Checking ${names.join(', ')} with the publishing service…`, 'work');
    try {
        const [dry, routes] = await Promise.all([
            call(`/api/canvas-publish?${q(names)}&dry=1&note=`, { method: 'POST' }),
            call(`/api/canvas-check?${q(names)}`, { method: 'POST' }).catch(() => null),
        ]);
        const findings = dry.findings ?? [];
        const errors = findings.filter(f => f.level === 'error').length;
        const problems = routes?.routes?.problems ?? [];
        notes([
            ...findings.map(f => [f.level === 'error' ? 'error' : 'warn', `${f.what ? `${f.what} ` : ''}${f.msg}`]),
            ...warningLines(dry.warnings),
            ...problems.map(p => ['warn', `${p.piece}: ${p.why} It can still go; the reviewer sees the report.`]),
            ...st.removed.map(t => ['warn', t]),
        ]);
        const plan = dry.plan ?? {};
        if (errors) show(`${errors} problem${errors === 1 ? '' : 's'} to fix before this can be sent (listed below).`, 'err');
        else {
            st.checked = names.join(',');
            show(
                `This sends ${names.length} piece${names.length === 1 ? '' : 's'} as one review request${plan.areas ? ` (${plan.areas.length} area${plan.areas.length === 1 ? '' : 's'})` : ''}: what the last export built. Nothing is merged; ${ctx.me().reviewers || 'your reviewers'} review it.`,
            );
        }
    } catch (err) {
        show(`Can't publish yet: ${err.message}`, 'err');
    }
    st.busy = false;
    draw();
}

async function send() {
    const names = ticked();
    st.busy = true;
    draw();
    $('cpNote').disabled = true;
    show('Opening the pull requests (this can take a minute: it uploads the tile files)…', 'work');
    try {
        const note = encodeURIComponent($('cpNote').value.trim());
        const r = await call(`/api/canvas-publish?${q(names)}&note=${note}`, { method: 'POST' });
        notes(warningLines(r.warnings));
        show('Sent. The review service opened these pull requests:', 'ok');
        for (const [label, url] of Object.entries(r.pr_urls ?? {})) {
            if (!/^https:\/\//.test(url ?? '')) continue;
            $('cpLinks').append(el('p', {}, el('a', { href: url, target: '_blank', rel: 'noopener', textContent: `${label}: ${url}` })));
        }
        $('cpNote').value = '';
        // (What went out is the last publish now: nothing is ticked until the next edit.)
        for (const r of st.rows) r.ticked = false;
        st.checked = '';
    } catch (err) {
        show(`Publishing failed: ${err.message}`, 'err');
        $('cpNote').disabled = false;
    }
    st.busy = false;
    draw();
}

/** The ticked pieces as a zip, fetched so an error shows here. It records no publish. */
async function download() {
    const names = ticked();
    st.busy = true;
    draw();
    show('Building the package…', 'work');
    try {
        const plan = await call(`/api/canvas-package?${q(names)}`, { method: 'POST' });
        const res = await api(`/api/canvas-package-download?${q(names)}`);
        if (!res.ok) throw new Error(await failure(res));
        const file = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `${canvasName()}-package.zip`;
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: file });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
        notes(warningLines(plan.warnings));
        show(
            `Downloaded ${file}: unzip it into your module's repository (MANIFEST.md says where each file goes). It doesn't count as a publish.`,
            'ok',
        );
    } catch (err) {
        show(`Couldn't build the package: ${err.message}`, 'err');
    }
    st.busy = false;
    draw();
}

async function tryOnDev() {
    const names = ticked();
    st.busy = true;
    draw();
    show(`Putting ${names.join(', ')} on dev together (this can take a minute)…`, 'work');
    try {
        const note = encodeURIComponent($('cpNote').value.trim());
        const t = await call(`/api/canvas-trial?${q(names)}&note=${note}`, { method: 'POST' });
        const commands = t.commands ?? Object.fromEntries((t.akeys ?? []).map(a => [a, `;forge ${a}`]));
        notes([
            ...Object.values(commands).map(c => ['warn', `On dev: ${c}`]),
            ...(t.errors ?? []).map(e => ['error', `${e.akey}: not on dev. ${e.detail}`]),
            ...warningLines(t.warnings),
        ]);
        show('On dev. Walk it in the game, then send it when you are happy with it. A new trial replaces this one.', 'ok');
    } catch (err) {
        show(`Couldn't put it on dev: ${err.message}`, 'err');
    }
    st.busy = false;
    draw();
}

/** Wires the dialog's buttons. `exportAll()` runs the canvas's export (Export again). */
export function initCanvasPublish(exportAll) {
    $('cpEvery').onchange = () => {
        const all = $('cpEvery').checked;
        for (const r of st.rows) if (!r.refused) r.ticked = all;
        draw();
        changed();
    };
    $('cpGo').onclick = () => (st.checked === ticked().join(',') && st.checked ? send() : check());
    $('cpPackage').onclick = download;
    $('cpTry').onclick = tryOnDev;
    $('cpExport').onclick = () => {
        $('canvasPubDialog').close();
        exportAll();
    };
}
