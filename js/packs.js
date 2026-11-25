// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Get more textures dialog's logic (packsdialog.js shows it): what each texture pack's row says and offers, from what the
// engine answers at /api/textures/packs, and how an install's progress reads. No page here, so the tests run it in Node.

/** A size in bytes as people read it: "640 KB", "3.2 MB". Empty when it isn't known. */
export function sizeText(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    const mb = bytes / (1024 * 1024);
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Who made a pack's art, as one line: "By Alice, Bob and Carol". Empty for none. */
export function creditsText(credits) {
    const names = (credits ?? []).filter(c => typeof c === 'string' && c.trim()).map(c => c.trim());
    if (!names.length) return '';
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    return `By ${list}`;
}

/**
 * The dialog's rows, from the engine's answer (`installed`, `available`, `manage`, `job`): every pack the index offers, then
 * the installed ones it doesn't list (installed from a file, or taken off the index). Each row says its `state`:
 * - `available`: not installed; `install` is offered;
 * - `update`: installed at another version than the index's; `install` (to that version) and `remove`;
 * - `installed`: installed at the index's version, or one the index doesn't list; `remove`.
 * Without `manage` (a builder on a team server) nothing is offered; while a job runs nothing is offered but on its own row,
 * which shows it is busy.
 */
export function packRows(answer) {
    const installed = answer?.installed ?? [];
    const available = answer?.available ?? [];
    const manage = !!answer?.manage;
    const busy = answer?.job?.running ? answer.job.pack : null;
    const rows = [];
    for (const p of available) {
        const have = installed.find(i => i.id === p.id);
        const state = !have ? 'available' : have.version === p.version ? 'installed' : 'update';
        rows.push({
            id: p.id,
            name: p.name,
            version: p.version,
            installedVersion: have?.version ?? null,
            state,
            description: p.description ?? '',
            licence: p.licence ?? have?.licence ?? '',
            credits: creditsText(p.credits ?? have?.credits),
            size: sizeText(p.size),
            count: Number.isFinite(p.textures) ? p.textures : (have?.textures?.length ?? null),
            categories: p.categories ?? [],
            swatches: (p.swatches ?? []).filter(s => typeof s === 'string' && s.startsWith('data:image/')),
            install: manage && !busy && state !== 'installed' ? (state === 'update' ? `Update to ${p.version}` : 'Install') : null,
            remove: manage && !busy && !!have,
            busy: busy === p.id,
        });
    }
    for (const have of installed) {
        if (available.some(p => p.id === have.id)) continue;
        rows.push({
            id: have.id,
            name: have.name,
            version: have.version,
            installedVersion: have.version,
            state: 'installed',
            description: have.description ?? '',
            licence: have.licence ?? '',
            credits: creditsText(have.credits),
            size: '',
            count: have.textures?.length ?? null,
            categories: [],
            swatches: [],
            install: null,
            remove: manage && !busy,
            busy: busy === have.id,
        });
    }
    return rows;
}

/** One line under a row: how many textures, how big, the licence. */
export function rowFacts(row) {
    const parts = [];
    if (row.count != null) parts.push(`${row.count} texture${row.count === 1 ? '' : 's'}`);
    if (row.size) parts.push(row.size);
    if (row.licence) parts.push(`Licence: ${row.licence}`);
    if (row.state === 'installed') parts.push(`installed (${row.installedVersion})`);
    if (row.state === 'update') parts.push(`${row.installedVersion} installed`);
    return parts.join(' · ');
}

const STEPS = { downloading: 'Downloading', checking: 'Checking', installing: 'Installing' };

/**
 * An install's progress from the engine's job (`pack` and its `name`, `step`, `done`, `total`, `error`, `result`): `fraction` for the bar (0 to 1, or
 * null when the size isn't known yet), and `text` to show. Download, check and install are a third of the bar each.
 */
export function progressOf(job) {
    if (!job?.step) return { fraction: null, text: '' };
    const name = job.name || job.pack;
    if (job.step === 'failed') return { fraction: null, text: `Could not install ${name}: ${job.error ?? 'it failed'}`, failed: true };
    if (job.step === 'done') {
        const r = job.result ?? {};
        const text = r.unchanged
            ? `${r.name} ${r.version} was installed already.`
            : `Installed ${r.name} ${r.version}: ${r.textures} textures${r.replaced ? ` (replacing ${r.replaced})` : ''}.`;
        return { fraction: 1, text, done: true };
    }
    const k = Object.keys(STEPS).indexOf(job.step);
    const part = job.total > 0 ? Math.min(1, job.done / job.total) : null;
    const fraction = part == null ? (k > 0 ? k / 3 : null) : (k + part) / 3;
    const amount =
        job.step === 'downloading' && job.total > 0
            ? ` ${sizeText(job.done)} of ${sizeText(job.total)}`
            : job.total > 0
              ? ` ${job.done} of ${job.total} files`
              : '';
    return { fraction, text: `${STEPS[job.step] ?? job.step} ${name}…${amount}` };
}

/** Whether the texture painted with (`id`) is still in the library after a change (`catalog`); if not, the editor's default
 *  takes its place. */
export function stillThere(catalog, id) {
    return (catalog ?? []).some(t => t.id === id);
}
