// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Try on dev, in the Publish dialog: puts what Publish would send on the team's dev server with no restart, says how to walk in
// (`;forge <area>`), and keeps or releases the trial. One trial per builder; a new one replaces the last.

import { api, failure, json } from './api.js';
import { $, el } from './dom.js';

/** What publish.js gives this file (initTrial): `area()`, `me()`, `whole()` (the module, not only the area), `show(text, mode)`. */
let ctx = null;

/** Whether the service takes trials, the last check allows one, a call is running; when the trial ends (ms); how to join dev. */
const state = { enabled: false, checked: false, busy: false, ends: 0, join: null };
let clock = null;

const RECONNECT =
    "Dev's files changed: you'll be disconnected in about 10 seconds if you're on dev. Reconnect from the main menu (no need to quit the game).";
const WAY_IN = 'Connect to dev, then type ;forge for your areas, ;forge <area> to go in and ;forge back to come out.';

const minutes = secs => {
    const m = Math.max(1, Math.round(secs / 60));
    return `${m} minute${m === 1 ? '' : 's'}`;
};

/** Shows or hides the Try on dev button: only where the service takes trials, enabled once the check found no errors. */
function canTry() {
    const me = ctx.me();
    $('pubTry').hidden = !(state.enabled && me.team && me.publish && !me.package);
    $('pubTry').disabled = !state.checked || state.busy;
}

/** The time left, said again every 15 seconds while the dialog is open. */
function tick() {
    const left = Math.round((state.ends - Date.now()) / 1000);
    $('pubTrialLeft').textContent =
        left > 0
            ? `About ${minutes(left)} left. It ends by itself after an hour nobody keeps it.`
            : 'It has run out: dev puts your areas back by itself.';
}

/** A line with an area's `;forge` command and a Copy button. */
function commandRow(akey, command) {
    const copy = el('button', { type: 'button', className: 'trial-copy', textContent: 'Copy', title: `Copy ${command}` });
    copy.onclick = async () => {
        try {
            await navigator.clipboard.writeText(command);
            copy.textContent = 'Copied';
        } catch {
            copy.textContent = 'Select it to copy';
        }
    };
    return el('li', {}, el('code', { textContent: command }), ' ', copy, ' ', el('small', { textContent: akey }));
}

/** What went wrong or needs a look: each a line, `level` 'error' or 'warn' as in the check's list. */
function notes(lines) {
    const box = $('pubTrialNotes');
    box.replaceChildren();
    for (const [level, text] of lines) box.appendChild(el('li', { className: `finding ${level}`, textContent: text }));
    box.hidden = !lines.length;
}

/** Shows a trial: the service's answer to Try on dev, or this builder's trial as the status gives it (`akeys`, `commands`). */
function showTrial(t) {
    clearInterval(clock);
    $('pubTrial').hidden = !t;
    if (!t) return;
    const where = state.join ? `Dev is ${state.join}. ` : '';
    $('pubTrialText').textContent = `${where}${t.way_in || WAY_IN}`;
    $('pubTrialReconnect').hidden = !t.reconnect;
    $('pubTrialReconnect').textContent = RECONNECT;
    const list = $('pubTrialCommands');
    list.replaceChildren();
    const commands = t.commands ?? Object.fromEntries((t.akeys ?? []).map(a => [a, `;forge ${a}`]));
    for (const [akey, command] of Object.entries(commands)) list.appendChild(commandRow(akey, command));
    const lines = [
        ...(t.errors ?? []).map(e => ['error', `${e.akey}: not on dev. ${e.detail}`]),
        ...(t.areas ?? []).filter(a => a.dev && a.dev.applied === false && a.dev.message).map(a => ['warn', `${a.akey}: ${a.dev.message}`]),
        ...(t.warnings ?? []).map(w => ['warn', w]),
    ];
    if (t.skipped?.length) lines.push(['warn', `Unchanged since your last trial, so not sent again: ${t.skipped.join(', ')}.`]);
    if (t.dropped?.length) lines.push(['warn', `Back to live on dev (not in this trial): ${t.dropped.join(', ')}.`]);
    notes(lines);
    state.ends = Date.now() + (t.expires_in ?? 0) * 1000;
    tick();
    clock = setInterval(tick, 15_000);
}

/** This builder's trial from the engine (`touch`: keep it longer). Hides the button when the service takes no trials. */
async function status(touch) {
    const res = await api(`/api/dev-trial${touch ? '?touch=1' : ''}`);
    if (!res.ok) throw new Error(await failure(res));
    const r = await json(res);
    state.enabled = r.enabled === true;
    canTry();
    return r;
}

/** On opening the dialog: whether trials are on, and this builder's trial if there is one. Never touches it. */
export async function trialOpen() {
    state.checked = false;
    state.busy = false;
    showTrial(null);
    const me = ctx.me();
    if (!(me.team && me.publish && !me.package)) {
        state.enabled = false;
        canTry();
        return;
    }
    try {
        const r = await status(false);
        state.join = r.join ?? null;
        showTrial(r.enabled ? r.trial : null);
    } catch {
        // (The service doesn't answer: no button; Publish works without it.)
        state.enabled = false;
        canTry();
    }
}

/** The check's verdict: a trial is sent only when it found no errors. */
export function trialChecked(ok) {
    state.checked = ok;
    canTry();
}

/** Stops the clock (the dialog closed). */
export function trialClosed() {
    clearInterval(clock);
}

async function tryOnDev() {
    state.busy = true;
    canTry();
    $('pubWhole').disabled = true;
    const whole = ctx.whole();
    ctx.show(
        `Putting ${whole ? `module ${ctx.area().module}` : ctx.area().name} on dev (this can take a minute: it uploads the tile files)…`,
        'work',
    );
    try {
        const note = encodeURIComponent($('pubNote').value.trim());
        const res = await api(`/api/dev-trial?name=${encodeURIComponent(ctx.area().name)}&whole=${whole ? 1 : 0}&note=${note}`, {
            method: 'POST',
        });
        if (!res.ok) throw new Error(await failure(res));
        const t = await json(res);
        showTrial(t);
        ctx.show('On dev. Walk it in the game, then publish when you are happy with it. A new trial replaces this one.', 'ok');
    } catch (err) {
        ctx.show(`Couldn't put it on dev: ${err.message}`, 'err');
    }
    state.busy = false;
    $('pubWhole').disabled = false;
    canTry();
}

/** Wires the trial's buttons. `c`: { area(), me(), whole(), show(text, mode) } from publish.js. */
export function initTrial(c) {
    ctx = c;
    $('pubTry').onclick = tryOnDev;
    $('pubTrialKeep').onclick = async () => {
        $('pubTrialKeep').disabled = true;
        try {
            const r = await status(true);
            if (r.trial) {
                state.ends = Date.now() + (r.trial.expires_in ?? 0) * 1000;
                tick();
                ctx.show(`Kept: ${minutes(r.trial.expires_in ?? 0)} left.`, 'ok');
            } else {
                showTrial(null);
                ctx.show('You have no trial on dev now: it ran out or was released.', 'err');
            }
        } catch (err) {
            ctx.show(`Couldn't keep it: ${err.message}`, 'err');
        }
        $('pubTrialKeep').disabled = false;
    };
    $('pubTrialRelease').onclick = async () => {
        $('pubTrialRelease').disabled = true;
        ctx.show('Releasing the trial…', 'work');
        try {
            const res = await api('/api/dev-trial/release', { method: 'POST' });
            if (!res.ok) throw new Error(await failure(res));
            showTrial(null);
            ctx.show('Released: dev has the live areas again.', 'ok');
        } catch (err) {
            ctx.show(`Couldn't release it: ${err.message}`, 'err');
        }
        $('pubTrialRelease').disabled = false;
    };
}
