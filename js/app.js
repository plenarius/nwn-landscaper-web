// Layonara Landscaper: sculpt an NWN area, export it with `landscaper serve`.

import { Area, TILE, DEFAULT_TEXTURE, SPACING, SHALLOW } from './area.js';
import { View } from './view.js';
import { TOOLS, stamp } from './tools.js';
import { ICONS } from './icons.js';
import { TextureLibrary } from './textures.js';
import { PRESETS, copyPreset } from './atmosphere.js';
import { carve, fitInTile, rockFor, at as entranceAt, nearest as nearestEntrance } from './entrance.js';
import { ModelLibrary } from './models.js';

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
    updatePanels();
}

// One panel over the left of the view: the sky's when open, else the
// texture picker while painting, the placeables while placing.
let skyOpen = false;
function updatePanels() {
    $('skyPanel').hidden = !skyOpen;
    $('palette').hidden = skyOpen || tool !== 'paint';
    $('placePanel').hidden = skyOpen || tool !== 'place';
    if (tool === 'place' && !skyOpen) showPlaceables();
    $('btnSky').classList.toggle('active', skyOpen);
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

// --- Textures ------------------------------------------------------------------

const library = new TextureLibrary();
let paintTexture = DEFAULT_TEXTURE;

const CATEGORY_ORDER = ['Grass', 'Flowers & leaves', 'Earth', 'Rock', 'Sand', 'Snow', 'Special'];

function buildPalette() {
    const body = $('paletteBody');
    body.textContent = '';
    if (!library.catalog.length) {
        body.innerHTML = '<p>No texture library. Run the page from <code>landscaper serve</code> after building the library (landscaper scripts/build_texture_library.py).</p>';
        return;
    }
    const categories = [...new Set(library.catalog.map(t => t.category))]
        .sort((a, b) => (CATEGORY_ORDER.indexOf(a) + 1 || 99) - (CATEGORY_ORDER.indexOf(b) + 1 || 99));
    for (const category of categories) {
        const h = document.createElement('h4');
        h.textContent = category;
        const grid = document.createElement('div');
        grid.className = 'swatches';
        for (const t of library.catalog.filter(t => t.category === category)) {
            const b = document.createElement('button');
            b.className = 'swatch';
            b.dataset.texture = t.id;
            b.title = `${t.name} (${t.source})`;
            b.innerHTML = `<img loading="lazy" alt="" src="${library.swatchUrl(t.id)}"><span>${t.name}</span>`;
            b.onclick = () => selectTexture(t.id);
            grid.appendChild(b);
        }
        body.append(h, grid);
    }
    selectTexture(paintTexture);
}

function selectTexture(id) {
    paintTexture = id;
    for (const b of document.querySelectorAll('#paletteBody .swatch')) b.classList.toggle('active', b.dataset.texture === id);
    // Start loading it now so the first dab shows at once.
    library.layerPixels(id).catch(() => {});
}

library.load().then(ok => {
    buildPalette();
    if (ok) view.setLibrary(library);
});

// --- Placeables --------------------------------------------------------------------

const models = new ModelLibrary();
view.models = models;
let placeModel = null;
const QUICK = ['rock', 'boulder', 'tree', 'bush', 'ruin', 'pillar', 'statue', 'fence'];
for (const q of QUICK) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = q;
    b.onclick = () => { $('placeSearch').value = q; showPlaceables(); };
    $('placeChips').appendChild(b);
}

let placeShown = null;
async function showPlaceables() {
    await models.load();
    const query = $('placeSearch').value.trim() || 'rock';
    if (query === placeShown) return;
    placeShown = query;
    const box = $('placeResults');
    box.textContent = '';
    for (const p of models.search(query)) {
        const b = document.createElement('button');
        b.className = 'swatch';
        b.dataset.model = p.model;
        b.title = `${p.name} (${p.model})`;
        b.innerHTML = `<img class="thumb" alt=""><span>${p.name.replace(/</g, '&lt;')}</span>`;
        b.onclick = () => selectPlaceable(p.model);
        box.appendChild(b);
        models.thumbnail(p.model).then(url => { if (url) b.querySelector('img').src = url; });
    }
    selectPlaceable(placeModel);
}
function selectPlaceable(model) {
    placeModel = model;
    for (const b of $('placeResults').children) b.classList.toggle('active', b.dataset.model === model);
}
let searchTimer = null;
$('placeSearch').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(showPlaceables, 250); };
const showScale = () => { $('placeScaleOut').textContent = `${Math.round($('placeScale').value * 100)}%`; };
$('placeScale').oninput = showScale;
showScale();

/** Ground under an object: the lowest point under its outline, so it doesn't float on a slope. */
function groundUnder(o, flat) {
    const c = Math.cos(o.bearing), s = Math.sin(o.bearing);
    const corners = [[flat.min[0], flat.min[1]], [flat.max[0], flat.min[1]], [flat.min[0], flat.max[1]], [flat.max[0], flat.max[1]], [0, 0]];
    return Math.min(...corners.map(([x, y]) => area.heightAt(o.x + (c * x - s * y) * o.scale, o.y + (s * x + c * y) * o.scale)));
}

async function placeDown(e, p) {
    if (e.shiftKey) {
        let best = null, bd = 2.5;
        for (const o of area.objects) { const d = Math.hypot(o.x - p.x, o.y - p.y); if (d < bd) { best = o; bd = d; } }
        if (!best) return null;
        area.beginStroke();
        area.objects = area.objects.filter(o => o !== best);
        view.updateObjects();
        saveSoon();
        return null;
    }
    if (!placeModel) { $('statusMsg').textContent = 'Pick a placeable in the panel first.'; return null; }
    let flat;
    try { flat = await models.flat(placeModel); } catch { $('statusMsg').textContent = `${placeModel} can't be read.`; return null; }
    const o = { model: placeModel, x: p.x, y: p.y, z: 0, bearing: $('placeRandom').checked ? Math.random() * Math.PI * 2 : 0, scale: +$('placeScale').value };
    o.z = groundUnder(o, flat);
    area.beginStroke();
    area.objects.push(o);
    view.updateObjects();
    saveSoon();
    return { object: o, flat, from: p };
}

// Dragging turns it: towards the pointer.
function placeDrag(e) {
    const s = stroke.place, p = view.pick(e.clientX, e.clientY);
    if (!p || Math.hypot(p.x - s.from.x, p.y - s.from.y) < 0.3) return;
    s.object.bearing = Math.atan2(p.y - s.from.y, p.x - s.from.x);
    s.object.z = groundUnder(s.object, s.flat);
    view.updateObjects();
}

// --- Sky & fog -------------------------------------------------------------------

let skyNight = false;

for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset';
    b.dataset.preset = p.id;
    const s = p.time === 'night' ? p.moon : p.sun;
    b.innerHTML = `<span class="look" style="background: linear-gradient(${s.diffuse}, ${s.fog} 70%, ${s.ambient})"></span><span>${p.name}</span>`;
    b.onclick = () => {
        area.atmosphere = copyPreset(p);
        skyNight = p.time === 'night';
        skyChanged();
    };
    $('skyPresets').appendChild(b);
}

/** The sun's settings by day, the moon's by night. */
const currentSky = () => (skyNight ? area.atmosphere.moon : area.atmosphere.sun);

function showSky() {
    const a = area.atmosphere, s = currentSky();
    for (const b of $('skyPresets').children) b.classList.toggle('active', b.dataset.preset === a.preset);
    for (const b of $('dayNight').children) b.classList.toggle('active', (b.dataset.night === '1') === skyNight);
    for (const r of document.querySelectorAll('[name=skyTime]')) r.checked = r.value === a.time;
    $('skyWhich').textContent = skyNight ? 'Moon (night)' : 'Sun (day)';
    $('skyAmbient').value = s.ambient;
    $('skyDiffuse').value = s.diffuse;
    $('skyFog').value = s.fog;
    $('skyFogAmount').value = s.fogAmount;
    $('skyFogOut').textContent = s.fogAmount === 0 ? 'light' : s.fogAmount < 10 ? `${s.fogAmount} · some` : s.fogAmount < 20 ? `${s.fogAmount} · heavy` : `${s.fogAmount} · thick`;
    $('skyShadows').checked = s.shadows;
    $('shadowStrength').value = area.shadow;
    $('shadowOut').textContent = area.shadow > 0 ? `${Math.round(area.shadow * 100)}%` : 'off';
    $('skyClip').value = a.fogClip;
    $('skyClipOut').textContent = `${a.fogClip} m`;
    view.setAtmosphere($('skyPreview').checked ? a : null, skyNight);
}

function skyChanged() {
    showSky();
    saveSoon();
}

// Hand edits make it the area's own look.
function editSky(change) {
    change(area.atmosphere, currentSky());
    area.atmosphere.preset = 'custom';
    skyChanged();
}
$('skyAmbient').oninput = e => editSky((a, s) => { s.ambient = e.target.value; });
$('skyDiffuse').oninput = e => editSky((a, s) => { s.diffuse = e.target.value; });
$('skyFog').oninput = e => editSky((a, s) => { s.fog = e.target.value; });
$('skyFogAmount').oninput = e => editSky((a, s) => { s.fogAmount = +e.target.value; });
$('skyShadows').onchange = e => editSky((a, s) => { s.shadows = e.target.checked; });
$('skyClip').oninput = e => editSky(a => { a.fogClip = +e.target.value; });
// Not part of the .are's settings: baked into the tiles.
let shadeTimer = null;
$('shadowStrength').oninput = e => {
    area.shadow = +e.target.value;
    showSky();
    clearTimeout(shadeTimer);
    shadeTimer = setTimeout(() => view.updateShade(), 150);
    saveSoon();
};
for (const r of document.querySelectorAll('[name=skyTime]')) {
    r.onchange = () => editSky(a => {
        a.time = r.value;
        // Show what the game will.
        if (r.value !== 'cycle') skyNight = r.value === 'night';
    });
}
for (const b of $('dayNight').children) b.onclick = () => { skyNight = b.dataset.night === '1'; showSky(); };
$('skyPreview').onchange = showSky;
$('btnSky').onclick = () => { skyOpen = !skyOpen; updatePanels(); };
$('skyClose').onclick = () => { skyOpen = false; updatePanels(); };

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

// ?debug: the editor's state for test scripts.
if (debug) window.landscaper = { area: () => area, view };

const canvas = view.renderer.domElement;
let stroke = null; // { flattenTo, last }
let mouse = null;  // last client position over the canvas

// Water: a press starts a body (or takes the one clicked) and dragging up
// or down sets its level; Shift drains the one clicked.
const LEVEL_PER_PIXEL = 0.03;
function waterDown(e, p) {
    const i = Math.min(Math.max(Math.round(p.x / SPACING), 0), area.n - 1);
    const j = Math.min(Math.max(Math.round(p.y / SPACING), 0), area.n - 1);
    const body = area.bodyAt(i, j);
    if (e.shiftKey) {
        if (!body) return null;
        area.beginStroke();
        area.water = area.water.filter(b => b !== body);
        waterChanged();
        saveSoon();
        return null;
    }
    area.beginStroke();
    let b = body;
    if (!b) {
        b = { i, j, level: area.heights[j * area.n + i] + 0.3 };
        area.water.push(b);
        waterChanged();
    }
    return { body: b, startY: e.clientY, startLevel: b.level, ground: area.heights[b.j * area.n + b.i] };
}

function waterDrag(e) {
    const w = stroke.water;
    w.body.level = Math.max(w.ground + 0.05, w.startLevel + (w.startY - e.clientY) * LEVEL_PER_PIXEL);
    waterChanged();
    $('statusMsg').textContent = `Water level ${w.body.level.toFixed(2)} m (${(w.body.level - w.ground).toFixed(1)} m deep where you clicked)`;
}

function waterChanged() {
    area.floodWater();
    view.updateWater();
    view.markDirty({ i0: 0, i1: area.n - 1, j0: 0, j1: area.n - 1 });
}

// Entrances: a click on a slope carves one facing into it (where it
// rises); on flat ground, facing away from the camera. Shift removes the
// one clicked (its carving stays: Undo takes it back).
function entranceDown(e, p) {
    if (e.shiftKey) {
        const hit = nearestEntrance(area.entrances, p.x, p.y);
        if (!hit) return;
        area.beginStroke();
        area.entrances = area.entrances.filter(x => x !== hit);
        view.updateEntrances();
        view.updateShade();
        saveSoon();
        return;
    }
    const gx = area.heightAt(p.x + 1, p.y) - area.heightAt(p.x - 1, p.y);
    const gy = area.heightAt(p.x, p.y + 1) - area.heightAt(p.x, p.y - 1);
    let dir;
    if (Math.hypot(gx, gy) > 0.1) {
        dir = Math.atan2(gy, gx);
    } else {
        const c = view.camera.position;
        dir = Math.atan2((area.size - c.z) - p.y, c.x - p.x) + Math.PI;
    }
    const ent = { x: p.x, y: p.y, dir, width: Math.min(8, Math.max(2.5, +sizeIn.value)), depth: 4, floor: 0 };
    // Inside one tile, for the game's pathfinding; the floor where it lands.
    const moved = fitInTile(ent, TILE, area.size);
    ent.floor = area.heightAt(ent.x, ent.y);
    area.beginStroke();
    area.entrances.push(ent);
    // Rock that suits the slope: what's painted just behind the mouth.
    const [bx, by] = entranceAt(ent, ent.depth + 2, 0);
    const bi = Math.min(area.n - 1, Math.max(0, Math.round(bx / SPACING))), bj = Math.min(area.n - 1, Math.max(0, Math.round(by / SPACING)));
    const ground = area.palette[area.materials[bj * area.n + bi]];
    ent.rock = rockFor(library.byId.get(ground)?.category, ground, id => library.byId.has(id));
    const rock = ent.rock ? area.materialIndex(ent.rock) : undefined;
    view.markDirty(carve(area, ent, rock));
    view.syncPalette();
    if (area.water.length) waterChanged();
    view.updateEntrances();
    view.updateShade();
    $('statusMsg').textContent = `Entrance ${area.entrances.length}: its door will be tagged ${area.name}_ent${area.entrances.length}`
        + (moved > 0.05 ? ` (moved ${moved.toFixed(1)} m to sit inside one tile)` : '');
    saveSoon();
}

canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !area) { dbg.note = `(ignored: button ${e.button})`; showDebug(); return; }
    mouse = { x: e.clientX, y: e.clientY };
    const p = view.pick(e.clientX, e.clientY);
    if (!p) { dbg.note = '(down missed the terrain)'; showDebug(); return; }
    if (tool === 'entrance') {
        entranceDown(e, p);
        return;
    }
    if (tool === 'place') {
        const pointerId = e.pointerId;
        placeDown(e, p).then(s => {
            if (s) {
                stroke = { place: s };
                try { canvas.setPointerCapture(pointerId); } catch { /* fine */ }
            }
        });
        return;
    }
    if (tool === 'water') {
        const w = waterDown(e, p);
        if (w) {
            stroke = { water: w };
            try { canvas.setPointerCapture(e.pointerId); } catch { /* fine */ }
        }
        return;
    }
    area.beginStroke();
    stroke = { flattenTo: area.heightAt(p.x, p.y), last: performance.now() };
    if (tool === 'paint') {
        stroke.paintIndex = area.materialIndex(paintTexture);
        view.syncPalette();
    }
    dbg.strokes++;
    dbg.note = '';
    showDebug();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { dbg.note = `(capture failed: ${err.message})`; showDebug(); }
});
canvas.addEventListener('pointermove', e => {
    mouse = { x: e.clientX, y: e.clientY };
    if (stroke?.water) waterDrag(e);
    if (stroke?.place) placeDrag(e);
});
canvas.addEventListener('pointerleave', () => { mouse = null; view.setCursor(null); $('statusPos').textContent = ''; });
const endStroke = () => {
    if (!stroke) return;
    // The ground moved: its shadows too.
    if (!stroke.water && !stroke.place && tool !== 'paint') view.updateShade();
    // Sculpting may have flooded or drained hollows.
    if (!stroke.water && area.water.length && tool !== 'paint') waterChanged();
    if (stroke.water) $('statusMsg').textContent = '';
    stroke = null;
    saveSoon();
};
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
        const ci = Math.min(i, area.n - 1), cj = Math.min(j, area.n - 1);
        const walk = area.walkable(ci, cj), deep = area.depth(ci, cj);
        const what = deep > SHALLOW ? `water ${deep.toFixed(1)} m deep: too deep to walk` : deep > 0 ? `shallow water ${deep.toFixed(1)} m: wading` : walk ? 'walkable' : 'too steep to walk';
        $('statusPos').textContent = `x ${p.x.toFixed(1)} m · y ${p.y.toFixed(1)} m · height ${p.z.toFixed(1)} m · tile ${tx},${ty} · ${what}`;
    }
    if (stroke && p && !stroke.water && !stroke.place) {
        const now = performance.now();
        const dt = (now - stroke.last) / 1000;
        stroke.last = now;
        view.markDirty(stamp(area, tool, p.x, p.y, radius, +strengthIn.value, dt, stroke.flattenTo, stroke.paintIndex));
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
    skyNight = a.atmosphere.time === 'night';
    showSky();
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
    view.updateEntrances();
    view.updateObjects();
    view.updateShade();
    view.updateWater();
    view.syncPalette();
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
        // Heights (f32 per sample), then each sample's palette index (u8).
        // ... and JSON too long for the query: the objects.
        const extra = new TextEncoder().encode(JSON.stringify({ objects: area.objects }));
        const body = new Uint8Array(area.heights.byteLength + area.materials.byteLength + extra.byteLength);
        body.set(new Uint8Array(area.heights.buffer, area.heights.byteOffset, area.heights.byteLength));
        body.set(area.materials, area.heights.byteLength);
        body.set(extra, area.heights.byteLength + area.materials.byteLength);
        const query = `name=${encodeURIComponent(area.name)}&tiles=${area.tiles}&palette=${encodeURIComponent(area.palette.join(','))}`
            + `&atmosphere=${encodeURIComponent(JSON.stringify(area.atmosphere))}`
            + `&water=${encodeURIComponent(JSON.stringify(area.water))}`
            + `&shadow=${area.shadow}`
            + `&entrances=${encodeURIComponent(JSON.stringify(area.entrances))}`;
        const res = await fetch(`/api/export?${query}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body,
        });
        if (res.status === 404 || res.status === 501) throw new Error('This page is not being served by landscaper. Run: landscaper serve');
        const report = await res.json();
        if (!res.ok) throw new Error(report.error || res.statusText);
        showReport(report);
        view.setMarkers(report.warnings || []);
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
    const closed = r.warnings.filter(w => w.kind === 'closed_passage').length;
    const winding = r.warnings.length - failed - closed;
    const allGood = r.routes.ok === r.routes.total && !r.warnings.length;
    $('reportBody').innerHTML = `
        <h3>Exported ${r.name}</h3>
        <div class="big ${allGood ? 'good' : 'warn'}">${r.routes.ok} of ${r.routes.total} routes work</div>
        <p>NWN's pathfinding, simulated on random routes across the area.</p>
        ${failed ? `<p class="bad">● ${failed} route(s) stop short: red markers.</p>` : ''}
        ${closed ? `<p class="bad">● ${closed} passage(s) closed: NWN's tile pathfinding has no way through there, so the export made them unwalkable (red markers). Move or widen the gap, away from tile corners and edges.</p>` : ''}
        ${winding ? `<p class="warn">● ${winding} tile(s) too winding for NWN: orange markers. Straighten or widen the passages there.</p>` : ''}
        <p>Walkable ground kept: ${(100 * r.coverage).toFixed(1)}%</p>
        ${updated(r.updated)}
        <p>Ready to play: <b>${r.name}</b> is in your NWN modules list.<br><code>${r.installed_module || r.module}</code></p>`;
    $('report').hidden = false;
}

// What happened to a module that was already installed (and maybe built on).
function updated(u) {
    if (!u) return '';
    const esc = t => String(t).replace(/</g, '&lt;');
    let html = `<p>Updated your module: new ground, everything you placed kept (${u.objects} object${u.objects === 1 ? '' : 's'}`;
    html += u.ground_known ? `, ${u.moved} moved up or down with the ground).</p>` : `; the last ground wasn't found, so none were raised or lowered).</p>`;
    if (u.outside.length) {
        html += `<p class="warn">● ${u.outside.length} now outside the area: ${u.outside.slice(0, 5).map(o => `${esc(o.tag || '(no tag)')} at ${o.at[0].toFixed(0)}, ${o.at[1].toFixed(0)}`).join('; ')}${u.outside.length > 5 ? '…' : ''}</p>`;
    }
    if (u.doors_added) html += `<p>${u.doors_added} new entrance door(s) added: link their transitions in the toolset.</p>`;
    html += u.atmosphere ? '<p>Light and fog: set from the editor.</p>' : '<p>Light and fog: unchanged in the editor, so the module keeps its own.</p>';
    html += `<p class="note">Close the module in the toolset before exporting, or saving there will overwrite this update.</p>`;
    return html;
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
    else if (e.key === 'l') $('btnSky').click();
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
