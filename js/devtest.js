// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Test on the dev server: loads the builder's last export of a module onto the team's dev server, to walk it in the game.

import { api } from './api.js';
import { $, el, store } from './dom.js';
import { areaRow } from './import.js';

/** What app.js gives this file (initDevTest): `area()` and `readOnly()`. */
let ctx = null;

// One holder at a time (the review service keeps the claim). The dialog says who has it, loads your last export of this
// module with a temporary way in from an existing area, and gives it back.

let testPoll = null,
    testState = null,
    testPicked = null,
    testSeq = 0,
    testTimer = null;
const testSaysMinutes = secs => `${Math.max(1, Math.round(secs / 60))} minute${Math.round(secs / 60) === 1 ? '' : 's'}`;

async function testRefresh(touch = true) {
    let r;
    try {
        r = await (await api(`/api/dev-test${touch ? '?touch=1' : ''}`)).json();
    } catch {
        r = { error: 'the server did not answer' };
    }
    const st = $('testStatus');
    if (r.error || !r.status) {
        st.textContent = `Can't reach the dev test service: ${r.error ?? 'no answer'}`;
        st.className = 'note err';
        $('testGo').disabled = true;
        return;
    }
    testState = r;
    const claim = r.status.claim,
        busy = r.status.busy ?? [];
    const mine = claim && claim.user === r.me;
    st.className = 'note';
    $('testTakeRow').hidden = !(claim && !mine && r.admin);
    $('testRelease').hidden = !(claim && (mine || r.admin));
    $('testRelease').textContent = mine ? 'Give it back' : 'Release it';
    if (busy.length) {
        st.textContent = `Working: ${busy.join(', ')}. This takes a few minutes (build, upload, restart); the dev server comes back by itself.`;
        st.className = 'note work';
    } else if (claim && mine) {
        st.textContent = `You have the dev server with module ${claim.module} (${testSaysMinutes(claim.expires_in)} left). It is ready: join ${r.join ?? 'the dev server'} and walk in from ${claim.area} near ${claim.waypoint}.`;
        st.className = 'note ok';
    } else if (claim) {
        st.textContent = `${claim.user} has the dev server (module ${claim.module}), free in about ${testSaysMinutes(claim.expires_in)}.`;
    } else {
        st.textContent = 'The dev server is free.';
    }
    testCanGo();
}

function testCanGo() {
    const claim = testState?.status?.claim,
        busy = testState?.status?.busy ?? [];
    const free = !claim || claim.user === testState.me || ($('testTake').checked && testState.admin);
    $('testGo').disabled = !(free && !busy.length && testPicked && $('testWp').value);
    $('testGo').textContent = claim && claim.user !== testState?.me ? 'Take over and load' : 'Load on the dev server';
}

// How many times an area has been picked to walk in from (see testPickArea).
let wpSeq = 0;

/** Chooses the existing area you walk in from, and lists its waypoints (`waypoint` picked when it has it). */
async function testPickArea(name, waypoint = '') {
    testPicked = name;
    const mine = ++wpSeq,
        sel = $('testWp');
    sel.textContent = '';
    let wp = [];
    try {
        wp = (await (await api(`/api/dev-test/waypoints?area=${encodeURIComponent(name)}`)).json()).waypoints ?? [];
    } catch {
        /* none */
    }
    // Another area picked meanwhile: its list is the one to show (two answers mixed sent one area with the other's waypoint).
    if (mine !== wpSeq) return;
    for (const w of wp) sel.add(new Option(`${w.tag}  (${Math.round(w.x)}, ${Math.round(w.y)})`, w.tag));
    if (!wp.length) sel.add(new Option('this area has no waypoints: pick another', ''));
    if (waypoint && wp.some(w => w.tag === waypoint)) sel.value = waypoint;
    testCanGo();
}

/** The way in last used for a module, kept in this browser. */
const testWayKey = () => `landscaper.testway.${ctx.area()?.module || ctx.area()?.name}`;

async function testAreas() {
    const mine = ++testSeq,
        box = $('testAreas'),
        q = $('testFind').value.trim();
    box.textContent = '';
    if (q.length < 3) return;
    let r = { sources: [] };
    try {
        r = await (await api(`/api/import-sources?q=${encodeURIComponent(q)}`)).json();
    } catch {
        /* none */
    }
    if (mine !== testSeq) return;
    for (const s of (r.sources ?? []).slice(0, 12)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.append(...areaRow(s, `${s.width}×${s.height}`));
        if (testPicked === s.area) b.classList.add('selected');
        b.onclick = async () => {
            for (const o of box.children) o.classList.toggle('selected', o === b);
            await testPickArea(s.area);
        };
        box.appendChild(b);
    }
    if (!box.children.length) box.textContent = r.error || r.note || 'No area matches.';
}

/** Wires the dev test dialog. `c`: { area(), readOnly() } from app.js. */
export function initDevTest(c) {
    ctx = c;
    $('btnTest').onclick = async () => {
        if (ctx.readOnly() || !ctx.area()) return;
        testPicked = null;
        $('testFind').value = '';
        $('testAreas').textContent = '';
        $('testWp').textContent = '';
        $('testWp').add(new Option('Pick an area first', ''));
        $('testTake').checked = false;
        // The areas of this module you can lead to.
        const entry = $('testEntry');
        entry.textContent = '';
        entry.add(new Option('the first area', ''));
        try {
            const mine = (await (await api('/api/areas')).json()).areas ?? [];
            for (const a of mine.filter(a => a.exported && (a.module || a.name) === (ctx.area().module || ctx.area().name)))
                entry.add(new Option(a.name, a.name));
        } catch {
            /* the list fails to load: offer only "the first area" */
        }
        $('testStatus').textContent = 'Checking the dev server…';
        $('testDialog').showModal();
        // The way in used last time for this module, ready to go.
        try {
            const last = JSON.parse(store.get(testWayKey()) ?? 'null');
            if (last?.area) {
                if (last.entry && [...entry.options].some(o => o.value === last.entry)) entry.value = last.entry;
                $('testFind').value = last.area;
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'selected';
                b.append(el('span', {}, el('b', { textContent: last.area }), ' ', el('small', { textContent: 'used last time' })));
                $('testAreas').appendChild(b);
                await testPickArea(last.area, last.waypoint);
            }
        } catch {
            /* nothing remembered */
        }
        await testRefresh(false);
        clearInterval(testPoll);
        testPoll = setInterval(() => testRefresh(true), 10000);
    };
    $('testDialog').addEventListener('close', () => clearInterval(testPoll));
    $('testFind').oninput = () => {
        clearTimeout(testTimer);
        testTimer = setTimeout(testAreas, 300);
    };
    $('testWp').onchange = testCanGo;
    $('testTake').onchange = testCanGo;
    $('testGo').onclick = async () => {
        $('testGo').disabled = true;
        $('testStatus').textContent = 'Starting…';
        const q = `module=${encodeURIComponent(ctx.area().module || ctx.area().name)}&area=${encodeURIComponent(testPicked)}&waypoint=${encodeURIComponent($('testWp').value)}&entry=${encodeURIComponent($('testEntry').value)}&takeover=${$('testTake').checked ? 1 : 0}`;
        try {
            const res = await api(`/api/dev-test?${q}`, { method: 'POST' });
            const r = await res.json();
            if (!res.ok) throw new Error(r.error || res.statusText);
            store.set(testWayKey(), JSON.stringify({ area: testPicked, waypoint: $('testWp').value, entry: $('testEntry').value }));
        } catch (err) {
            $('testStatus').textContent = `Couldn't start: ${err.message}`;
            $('testStatus').className = 'note err';
            testCanGo();
            return;
        }
        await testRefresh(true);
    };
    $('testRelease').onclick = async () => {
        $('testRelease').disabled = true;
        try {
            const res = await api('/api/dev-test/release', { method: 'POST' });
            const r = await res.json();
            if (!res.ok) throw new Error(r.error || res.statusText);
        } catch (err) {
            $('testStatus').textContent = `Couldn't release: ${err.message}`;
            $('testStatus').className = 'note err';
        }
        $('testRelease').disabled = false;
        await testRefresh(false);
    };
}
