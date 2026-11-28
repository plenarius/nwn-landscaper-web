// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// An export's progress as the engine reports it (`/api/export/job`, or the browser page's engine's LS_PROGRESS lines): its
// estimate, step and time left as the report box shows them. The engine estimates before the tiles start, from the tiles kept
// from past exports, the objects' triangles, its threads and this machine's speed on its last export.

/** What each step of an export is called while it runs. */
const STEPS = {
    waiting: 'Waiting for the engine: a check or another export is running',
    preparing: 'Reading the area and planning its tiles',
    tiles: 'Building the tiles',
    hak: 'Writing the hak',
    routes: 'Checking the routes',
    installing: 'Installing the module',
    done: 'Done',
    failed: 'Stopped',
};

/** `s` seconds as a builder reads a wait: "a few seconds", "40 s", "2 min 30 s", "12 min". */
export function durationText(s) {
    if (!(s >= 0)) return '';
    if (s < 10) return 'a few seconds';
    if (s < 60) return `${Math.round(s / 5) * 5} s`;
    if (s < 600) {
        const m = Math.floor(s / 60),
            r = Math.round((s - m * 60) / 10) * 10;
        return r === 60 ? `${m + 1} min` : r ? `${m} min ${r} s` : `${m} min`;
    }
    return `${Math.round(s / 60)} min`;
}

/** `text` that wraps as one piece: its spaces don't break. */
const whole = text => text.replace(/ /g, '\u00a0');

/**
 * How export progress `p` reads (the engine's `{ step, done, total, cached, threads, elapsed, estimate, left }`): `estimate`,
 * the line made when the tiles start ("About 3 min · 40 of 256 tiles already cached"), or null before; `step`, what it is
 * doing and the time left; `fraction` (0 to 1) of the time, or null while there is no estimate yet.
 */
export function exportProgressOf(p) {
    if (!p?.step) return { estimate: null, step: STEPS.preparing, fraction: null };
    const cached = p.total
        ? ` · ${whole(p.cached > 0 ? `${p.cached} of ${p.total} tiles already cached` : `${p.total} tiles, none cached`)}`
        : '';
    const estimate = p.estimate != null ? `${whole(`About ${durationText(p.estimate)}`)}${cached}` : null;
    let step = STEPS[p.step] ?? p.step;
    if (p.step === 'tiles' && p.total) step += `: ${p.done} of ${p.total}`;
    if (p.left != null && p.step !== 'done' && p.step !== 'failed') step += ` · ${whole(`about ${durationText(p.left)} left`)}`;
    const fraction =
        p.step === 'done' ? 1 : p.left != null && p.elapsed != null ? Math.min(0.99, p.elapsed / Math.max(p.elapsed + p.left, 1e-9)) : null;
    return { estimate, step, fraction };
}
