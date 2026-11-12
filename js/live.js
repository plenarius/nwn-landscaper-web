// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The live path check: Check paths again a moment after each edit, its result on the Live button and as markers on the map.

import { api, engine, NEEDS_ENGINE } from './api.js';
import { $, store } from './dom.js';
import { showError } from './report.js';
import { sendArea } from './export.js';

/** What app.js gives this file (initLive): `area()`, `readOnly()`, `view`, `stroke()` (the stroke under way, if any) and
 *  `showEngine()` (the banner when the engine is not running). */
let ctx = null;

/** Whether the check is on (remembered in this browser), its timer, and the edits it has seen. */
export const live = { on: store.get('landscaper.live') !== 'off', timer: null, running: false, again: false, edits: 0 };

// Live check: Check paths again a moment after each edit, one at a time
// (serve does one request at a time; an export waits behind it). A result
// for an area that has changed since is dropped and the check runs again.
const LIVE_DELAY = 1500;

/** Shows the live check on its button: `state` is 'ok', 'warn', 'bad', 'busy' or 'off', `text` its label and `title` its
 *  tooltip. Off (or no engine) shows "Live off" whatever is asked. */
export function showLive(state, text, title) {
    const b = $('btnLive'),
        on = live.on && engine.up;
    b.className = `top-btn live ${on ? state : 'off'}`;
    $('liveText').textContent = on ? text : 'Live off';
    b.title = on
        ? `${title}\nClick to stop checking after each edit.`
        : engine.up
          ? 'Check paths after each edit (click to turn on)'
          : 'The live path check needs the Landscaper engine, which is not running.';
}

/** Counts an edit and checks paths again a moment after the last one, when Live is on and the engine is there. */
export function checkSoon() {
    if (ctx.readOnly()) return;
    live.edits++;
    clearTimeout(live.timer);
    if (!live.on || !ctx.area() || !engine.up) return;
    showLive('busy', 'Live …', 'Waiting for you to stop editing.');
    live.timer = setTimeout(liveCheck, LIVE_DELAY);
}

async function liveCheck() {
    if (!live.on || !ctx.area() || !engine.up) return;
    if (ctx.stroke()) return; // its end schedules one
    if (live.running) {
        live.again = true;
        return;
    }
    live.running = true;
    const edits = live.edits,
        checked = ctx.area();
    showLive('busy', 'Checking…', 'Checking how NWN will path this area.');
    let report = null,
        error = null;
    try {
        report = await sendArea('check');
    } catch (err) {
        error = err;
    }
    live.running = false;
    if (live.again || edits !== live.edits || checked !== ctx.area()) {
        live.again = false;
        if (live.on && ctx.area()) live.timer = setTimeout(liveCheck, LIVE_DELAY);
        return;
    }
    if (error) {
        if (engine.up) showLive('bad', 'Live: error', error.message);
        else ctx.showEngine(); // (the engine stopped: Live goes off rather than red)
        return;
    }
    ctx.view.setMarkers(report.warnings || []);
    const { ok, total } = report.routes;
    const failed = total - ok,
        others = report.warnings.length - report.warnings.filter(w => w.kind === 'failed_route').length;
    if (failed) showLive('bad', `${failed} blocked`, `${ok} of ${total} test routes reach their goal; red pillars mark where they stop.`);
    else if (others)
        showLive(
            'warn',
            `${others} spot${others > 1 ? 's' : ''}`,
            `All ${total} test routes work; orange pillars mark ${others} spot(s) to look at (Check paths explains).`,
        );
    else showLive('ok', 'Paths OK', `All ${total} test routes work.`);
}

// The markers on the map: shown or hidden (M), remembered; the checks go on.
function showMarkers(on) {
    store.set('landscaper.markers', on ? 'on' : 'off');
    ctx.view.setShowMarkers(on);
    $('btnMarkers').classList.toggle('active', on);
    $('btnMarkers').textContent = on ? 'Markers' : 'Markers hidden';
}

/** Sets up the Live and Markers buttons. */
export function initLive(c) {
    ctx = c;
    $('btnMarkers').onclick = () => showMarkers(!$('btnMarkers').classList.contains('active'));
    showMarkers(store.get('landscaper.markers') !== 'off');

    $('btnLive').onclick = async () => {
        // Off for want of the engine: started since? (Asking again sets engine.up when it answers.) Then the click turns it on.
        const wasDown = !engine.up;
        if (wasDown && (await api('/api/me')).ok) ctx.showEngine();
        if (!engine.up) {
            showError(NEEDS_ENGINE, 'Live check needs the engine');
            return;
        }
        live.on = wasDown || !live.on;
        store.set('landscaper.live', live.on ? 'on' : 'off');
        if (live.on) checkSoon();
        else {
            clearTimeout(live.timer);
            ctx.view.setMarkers([]);
            showLive('off');
        }
    };
    showLive('off');
}
