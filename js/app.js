// Layonara Landscaper: sculpt an NWN area, export it with `landscaper serve`.

import { Area, TILE } from './area.js';
import { View } from './view.js';
import { TOOLS, stamp } from './tools.js';
import { ICONS } from './icons.js';

const $ = id => document.getElementById(id);

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = ICONS[el.dataset.icon];

// No WebGL: say why instead of showing a blank page.
const probe = document.createElement('canvas');
if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) {
    $('nowebgl').hidden = false;
    $('nowebgl').querySelector('pre').textContent = $('nowebgl').querySelector('pre').textContent.replace('URL', location.href);
    throw new Error('WebGL unavailable');
}

const view = new View($('viewport'));
let area = null;
let tool = 'raise';

// --- Tools -----------------------------------------------------------------

for (const [id, t] of Object.entries(TOOLS)) {
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.tool = id;
    b.title = `${t.hint} (${t.key})`;
    b.innerHTML = `<span class="icon">${ICONS[id]}</span><span>${t.label}</span><span class="key">${t.key}</span>`;
    b.onclick = () => selectTool(id);
    $('toolButtons').appendChild(b);
}

function selectTool(id) {
    tool = id;
    for (const b of document.querySelectorAll('#toolButtons .tool')) b.classList.toggle('active', b.dataset.tool === id);
}
selectTool('raise');

const sizeIn = $('brushSize'), strengthIn = $('brushStrength');
const showSliders = () => { $('sizeOut').textContent = `${(+sizeIn.value).toFixed(1)} m`; $('strengthOut').textContent = `${Math.round(strengthIn.value * 100)}%`; };
sizeIn.oninput = strengthIn.oninput = showSliders;
showSliders();

$('btnWalk').onclick = () => {
    const on = !$('btnWalk').classList.contains('on');
    $('btnWalk').classList.toggle('on', on);
    view.setShowWalkability(on);
};

// --- Sculpting ---------------------------------------------------------------

// ?debug: show what the pointer is doing (to diagnose input on other machines).
const debug = new URLSearchParams(location.search).has('debug');
const dbg = { last: '-', downs: 0, strokes: 0, stamps: 0, note: '' };
function showDebug() {
    if (!debug) return;
    $('statusMsg').textContent = `[debug] last: ${dbg.last} · downs ${dbg.downs} · strokes ${dbg.strokes} · stamps ${dbg.stamps} ${dbg.note}`;
}
if (debug) {
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'lostpointercapture']) {
        view.renderer.domElement.addEventListener(type, e => {
            dbg.last = `${type} button=${e.button} buttons=${e.buttons} type=${e.pointerType ?? '-'}${e.ctrlKey ? ' ctrl' : ''}${e.altKey ? ' alt' : ''}`;
            if (type === 'pointerdown') dbg.downs++;
            showDebug();
        }, true);
    }
}

const canvas = view.renderer.domElement;
let stroke = null; // { flattenTo, last }
let mouse = null;  // last client position over the canvas

canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !area) { dbg.note = `(ignored: button ${e.button})`; showDebug(); return; }
    mouse = { x: e.clientX, y: e.clientY };
    const p = view.pick(e.clientX, e.clientY);
    if (!p) { dbg.note = '(down missed the terrain)'; showDebug(); return; }
    area.beginStroke();
    stroke = { flattenTo: area.heightAt(p.x, p.y), last: performance.now() };
    dbg.strokes++;
    dbg.note = '';
    showDebug();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { dbg.note = `(capture failed: ${err.message})`; showDebug(); }
});
canvas.addEventListener('pointermove', e => { mouse = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerleave', () => { mouse = null; view.setCursor(null); $('statusPos').textContent = ''; });
const endStroke = () => { if (stroke) { stroke = null; saveSoon(); } };
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);

view.onFrame = () => {
    if (!area || !mouse) return;
    const p = view.pick(mouse.x, mouse.y);
    const radius = +sizeIn.value;
    view.setCursor(p, radius);
    if (p) {
        const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
        const i = Math.round(p.x / 0.625), j = Math.round(p.y / 0.625);
        const walk = area.walkable(Math.min(i, area.n - 1), Math.min(j, area.n - 1));
        $('statusPos').textContent = `x ${p.x.toFixed(1)} m · y ${p.y.toFixed(1)} m · height ${p.z.toFixed(1)} m · tile ${tx},${ty} · ${walk ? 'walkable' : 'too steep to walk'}`;
    }
    if (stroke && p) {
        const now = performance.now();
        const dt = (now - stroke.last) / 1000;
        stroke.last = now;
        view.markDirty(stamp(area, tool, p.x, p.y, radius, +strengthIn.value, dt, stroke.flattenTo));
        dbg.stamps++;
        if (dbg.stamps % 10 === 0) showDebug();
    }
};

// --- Area: new, undo, autosave ------------------------------------------------

function setArea(a) {
    area = a;
    view.setArea(a);
    $('areaInfo').textContent = `${a.name} · ${a.tiles}×${a.tiles} tiles (${a.size} m)`;
    $('report').hidden = true;
}

let saveTimer = null;
function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try { localStorage.setItem('landscaper.area', JSON.stringify(area.toJSON())); } catch (err) { console.warn('autosave failed', err); }
    }, 800);
}

function refreshAll() {
    view.markDirty({ i0: 0, i1: area.n - 1, j0: 0, j1: area.n - 1 });
    saveSoon();
}
$('btnUndo').onclick = () => { if (area?.undo()) refreshAll(); };
$('btnRedo').onclick = () => { if (area?.redo()) refreshAll(); };

const SIZES = [4, 8, 12, 16, 20, 24, 28, 32];
let chosenSize = 8;
for (const s of SIZES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `${s}×${s}<small>${s * TILE} m</small>`;
    b.onclick = () => { chosenSize = s; for (const o of $('sizeChoices').children) o.classList.toggle('active', o === b); };
    if (s === chosenSize) b.classList.add('active');
    $('sizeChoices').appendChild(b);
}

$('btnNew').onclick = () => {
    if (area) $('newName').value = area.name;
    $('newDialog').showModal();
};
$('newDialog').addEventListener('close', () => {
    if ($('newDialog').returnValue !== 'ok') return;
    const start = new FormData($('newDialog').querySelector('form')).get('start');
    setArea(Area.create($('newName').value.trim().toLowerCase(), chosenSize, start));
    saveSoon();
});

// --- Export ---------------------------------------------------------------------

$('btnExport').onclick = async () => {
    if (!area) return;
    const btn = $('btnExport');
    btn.disabled = true;
    $('statusMsg').textContent = `Exporting ${area.name}…`;
    try {
        const res = await fetch(`/api/export?name=${encodeURIComponent(area.name)}&tiles=${area.tiles}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: area.heights.buffer.slice(0),
        });
        if (res.status === 404 || res.status === 501) throw new Error('This page is not being served by landscaper. Run: landscaper serve');
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || res.statusText);
        showReport(body);
        view.setMarkers(body.warnings || []);
        $('statusMsg').textContent = '';
    } catch (err) {
        $('statusMsg').textContent = '';
        showError(err.message);
    } finally {
        btn.disabled = false;
    }
};

function showReport(r) {
    const failed = r.warnings.filter(w => w.kind === 'failed_route').length;
    const winding = r.warnings.length - failed;
    const allGood = r.routes.ok === r.routes.total && !r.warnings.length;
    $('reportBody').innerHTML = `
        <h3>Exported ${r.name}</h3>
        <div class="big ${allGood ? 'good' : 'warn'}">${r.routes.ok} of ${r.routes.total} routes work</div>
        <p>NWN's pathfinding, simulated on random routes across the area.</p>
        ${failed ? `<p class="bad">● ${failed} route(s) stop short: red markers.</p>` : ''}
        ${winding ? `<p class="warn">● ${winding} tile(s) too winding for NWN: orange markers. Straighten or widen the passages there.</p>` : ''}
        <p>Walkable ground kept: ${(100 * r.coverage).toFixed(1)}%</p>
        <p>Ready to play: <b>${r.name}</b> is in your NWN modules list.<br><code>${r.installed_module || r.module}</code></p>`;
    $('report').hidden = false;
}

function showError(msg) {
    $('reportBody').innerHTML = `<h3 class="bad">Export failed</h3><p>${msg.replace(/</g, '&lt;')}</p>`;
    $('report').hidden = false;
}
$('reportClose').onclick = () => { $('report').hidden = true; };

// --- Keys -------------------------------------------------------------------------

window.addEventListener('keydown', e => {
    if (e.target.closest('input, dialog')) return;
    const t = Object.entries(TOOLS).find(([, v]) => v.key === e.key);
    if (t) selectTool(t[0]);
    else if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); $('btnUndo').click(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); $('btnRedo').click(); }
    else if (e.key === '[') { sizeIn.value = +sizeIn.value - 1; showSliders(); }
    else if (e.key === ']') { sizeIn.value = +sizeIn.value + 1; showSliders(); }
    else if (e.key === 'w') $('btnWalk').click();
    else if (e.key === 'n') $('btnNew').click();
    else if (e.key === 'f') view.frame();
});

// --- Start ---------------------------------------------------------------------------

const saved = localStorage.getItem('landscaper.area');
if (saved) {
    try { setArea(Area.fromJSON(JSON.parse(saved))); } catch { setArea(Area.create('myarea', 8, 'hills')); }
} else {
    setArea(Area.create('myarea', 8, 'hills'));
}
