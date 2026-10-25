// NWN Landscaper: sculpt an NWN area, export it with `landscaper serve`.

import { Area, TILE, DEFAULT_TEXTURE, SPACING, SHALLOW, CAVE_ROCK } from './area.js';
import { View } from './view.js';
import { TOOLS, stamp, roomRect, cutRoom } from './tools.js';
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
    $('entrancePanel').hidden = skyOpen || tool !== 'entrance';
    if (tool === 'entrance' && !skyOpen) showEntrances();
    $('scatterPanel').hidden = skyOpen || tool !== 'scatter';
    if (tool === 'scatter' && !skyOpen) showScatterables();
    if (tool !== 'place' && view.selected && typeof selectObject === 'function') selectObject(null);
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

const CATEGORY_ORDER = ['Grass', 'Flowers & leaves', 'Earth', 'Rock', 'Sand', 'Snow', 'Floors', 'Walls', 'Special'];

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

/** Search results as big swatches in `box`, each calling `pick(model)`. */
async function modelResults(box, query, pick) {
    await models.load();
    box.textContent = '';
    for (const p of models.search(query)) {
        const b = document.createElement('button');
        b.className = 'swatch';
        b.dataset.model = p.model;
        b.title = `${p.name} (${p.model})`;
        b.innerHTML = `<img class="thumb" alt=""><span>${p.name.replace(/</g, '&lt;')}</span>`;
        b.onclick = () => pick(p.model);
        box.appendChild(b);
        models.thumbnail(p.model).then(url => { if (url) b.querySelector('img').src = url; });
    }
}

let placeShown = null;
async function showPlaceables() {
    const query = $('placeSearch').value.trim() || 'rock';
    if (query === placeShown) return;
    placeShown = query;
    await modelResults($('placeResults'), query, selectPlaceable);
    selectPlaceable(placeModel);
}
function selectPlaceable(model) {
    placeModel = model;
    for (const b of $('placeResults').children) b.classList.toggle('active', b.dataset.model === model);
}
let searchTimer = null;
$('placeSearch').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(showPlaceables, 250); };
const showScale = () => { $('placeScaleOut').textContent = `${Math.round($('placeScale').value * 100)}%`; };
$('placeScale').oninput = () => {
    showScale();
    // The selected object takes the size too.
    if (view.selected && tool === 'place') changeSelected(o => { o.scale = +$('placeScale').value; });
};
showScale();

/** Ground under an object: the lowest point under its outline, so it doesn't float on a slope. */
/** Where object `o` sits: on the ground under it; an imported thing (a
 *  tree, a rock) on the ground at its middle, as the import stood it; an
 *  imported tile's cliffs and blocked ground (heights built in) where it is. */
function settle(o, flat) {
    if (flat.fixed) return o.z;
    return o.model.startsWith('@import:') ? area.heightAt(o.x, o.y) : groundUnder(o, flat);
}

function groundUnder(o, flat) {
    const c = Math.cos(o.bearing), s = Math.sin(o.bearing);
    const corners = [[flat.min[0], flat.min[1]], [flat.max[0], flat.min[1]], [flat.min[0], flat.max[1]], [flat.max[0], flat.max[1]], [0, 0]];
    return Math.min(...corners.map(([x, y]) => area.heightAt(o.x + (c * x - s * y) * o.scale, o.y + (s * x + c * y) * o.scale)));
}

function removeObject(o) {
    area.beginStroke();
    area.objects = area.objects.filter(x => x !== o);
    if (view.selected === o) selectObject(null);
    view.updateObjects();
    saveSoon();
}

/** The place mode the panel shows: baked (true) or object (false). */
const placeBaked = () => $('placeMode').querySelector('.active')?.dataset.baked !== '0';
function showPlaceMode(baked) {
    for (const b of $('placeMode').children) b.classList.toggle('active', (b.dataset.baked === '1') === baked);
}
for (const b of $('placeMode').children) {
    b.onclick = () => {
        showPlaceMode(b.dataset.baked === '1');
        // The selected object takes the mode too.
        if (view.selected) changeSelected(o => { o.baked = b.dataset.baked === '1'; }).then(() => view.select(view.selected));
    };
}

$('placeSolid').onchange = () => { if (view.selected && tool === 'place') changeSelected(o => { o.solid = $('placeSolid').checked; }); };

/** placeables.2da's row of a model (object mode's appearance). */
const appearanceOf = model => models.list?.find(p => p.model === model)?.row;

function selectObject(o) {
    view.select(o);
    if (o) {
        $('placeScale').value = o.scale;
        showScale();
        showPlaceMode(o.baked !== false);
        $('placeSolid').checked = o.solid !== false;
        $('statusMsg').textContent = `${o.model} (${o.baked === false ? `object, tag ${area.name}_p${o.id}` : 'baked'}): drag to move · Q/E to turn · size slider · Delete to remove · Esc to deselect`;
    } else {
        $('statusMsg').textContent = '';
    }
}

async function placeDown(e, p) {
    // On an object: Shift removes it, else select it and drag to move it.
    const hit = view.pickObject(e.clientX, e.clientY);
    if (hit && e.shiftKey) { removeObject(hit); return null; }
    if (hit) {
        selectObject(hit);
        area.beginStroke();
        return { object: hit, flat: await models.flat(hit.model), from: p, move: { dx: hit.x - p.x, dy: hit.y - p.y } };
    }
    if (e.shiftKey) {
        let best = null, bd = 2.5;
        for (const o of area.objects) { const d = Math.hypot(o.x - p.x, o.y - p.y); if (d < bd) { best = o; bd = d; } }
        if (best) removeObject(best);
        return null;
    }
    if (!placeModel) { $('statusMsg').textContent = 'Pick a placeable in the panel first.'; return null; }
    let flat;
    try { flat = await models.flat(placeModel); } catch { $('statusMsg').textContent = `${placeModel} can't be read.`; return null; }
    const o = {
        id: area.nextObjectId++, model: placeModel, appearance: appearanceOf(placeModel), x: p.x, y: p.y, z: 0,
        bearing: $('placeRandom').checked ? Math.random() * Math.PI * 2 : 0, scale: +$('placeScale').value,
        solid: $('placeSolid').checked, baked: placeBaked(),
    };
    o.z = groundUnder(o, flat);
    area.beginStroke();
    area.objects.push(o);
    // Not selected: the panel's settings are for the next one (selecting it
    // made changing them change this one instead). Click it to edit it.
    selectObject(null);
    view.updateObjects();
    saveSoon();
    return { object: o, flat, from: p };
}

// Dragging a new object turns it (towards the pointer); dragging a
// selected one moves it, kept on the ground.
function placeDrag(e) {
    const s = stroke.place, p = view.pick(e.clientX, e.clientY);
    if (!p) return;
    if (s.move) {
        s.object.x = Math.min(area.sizeX, Math.max(0, p.x + s.move.dx));
        s.object.y = Math.min(area.sizeY, Math.max(0, p.y + s.move.dy));
    } else {
        if (Math.hypot(p.x - s.from.x, p.y - s.from.y) < 0.3) return;
        s.object.bearing = Math.atan2(p.y - s.from.y, p.x - s.from.x);
    }
    s.object.z = settle(s.object, s.flat);
    view.updateObjects();
}

// The selected object: turn, resize, remove.
async function changeSelected(change) {
    const o = view.selected;
    if (!o) return false;
    area.beginStroke();
    change(o);
    o.z = settle(o, await models.flat(o.model));
    view.updateObjects();
    saveSoon();
    return true;
}

// --- Import an NWN area ----------------------------------------------------------------

let importChosen = null, importing = false, importSeq = 0, importTimer = null;
$('btnImport').onclick = async () => {
    if (readOnly) return;
    $('openDialog').close();
    $('importStatus').textContent = '';
    $('importDialog').showModal();
    $('importFind').value = '';
    importChosen = null;
    showImportList();
    $('importFind').focus();
};
// The server searches (a builder can't be sent the whole module's list).
$('importFind').oninput = () => { clearTimeout(importTimer); importTimer = setTimeout(showImportList, 250); };
// Not closed (Escape, Cancel) while an import runs: it opens the area when done.
$('importDialog').addEventListener('cancel', e => { if (importing) e.preventDefault(); });
$('importDialog').querySelector('button[value=cancel]').addEventListener('click', e => { if (importing) e.preventDefault(); });
$('importName').oninput = () => { $('importGo').disabled = importing || !importChosen || !$('importName').checkValidity() || !$('importName').value; };

/** While an import runs: its button, the list and the fields can't change it. */
function setImporting(on) {
    importing = on;
    $('importGo').textContent = on ? 'Importing…' : 'Import';
    $('importGo').classList.toggle('busy', on);
    for (const id of ['importFind', 'importName']) $(id).disabled = on;
    for (const b of $('importList').querySelectorAll('button')) b.disabled = on;
    $('importName').oninput();
}

async function showImportList() {
    const mine = ++importSeq;
    const box = $('importList');
    let r = { sources: [] };
    try { r = await (await fetch(`/api/import-sources?q=${encodeURIComponent($('importFind').value.trim())}`)).json(); } catch { /* none */ }
    if (mine !== importSeq) return; // a newer search is on its way
    box.textContent = '';
    const found = r.sources ?? [];
    for (const s of found) {
        const b = document.createElement('button');
        b.type = 'button';
        // An admin's entries say what they come from; a builder's say whether it is theirs.
        const kind = s.kind ?? (s.flags & 1 ? 'interior' : s.flags & 2 ? 'underground' : 'outdoors');
        const allowed = s.assigned !== false;
        const state = s.assigned === true ? ' · assigned to you' : allowed ? '' : ' · needs an assignment';
        b.innerHTML = `<span><b>${s.tag || s.area}</b> <small>${s.area}</small></span><small>${s.width}×${s.height} · ${s.tileset} · ${kind}${s.from ? ' · ' + s.from : ''}${state}</small>`;
        b.disabled = !allowed;
        if (!allowed) b.title = 'Ask an admin to assign this area to you';
        if (importChosen?.area === s.area) b.classList.add('selected');
        b.onclick = () => {
            importChosen = s;
            for (const o of box.children) o.classList.toggle('selected', o === b);
            // A name from its tag: lower case, letters, digits and _, 9 at most.
            $('importName').value = (s.tag || s.area).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 9) || 'imported';
            $('importName').oninput();
        };
        box.appendChild(b);
    }
    if (!found.length) box.textContent = r.note || 'No area matches.';
    else if (r.note) box.insertAdjacentHTML('afterbegin', `<p class="note">${r.note}</p>`);
    else if (r.total > found.length) box.insertAdjacentHTML('beforeend', `<p class="note">${r.total - found.length} more: narrow the search.</p>`);
}

$('importGo').onclick = async () => {
    if (!importChosen) return;
    if (importing) return;
    const name = $('importName').value;
    setImporting(true);
    $('importStatus').textContent = `Importing ${importChosen.tag || importChosen.area} as ${name}… (reading its tiles and the module's haks takes a little while)`;
    try {
        const res = await fetch(`/api/import?area=${encodeURIComponent(importChosen.area)}&name=${encodeURIComponent(name)}`, { method: 'POST' });
        const r = await res.json();
        if (!res.ok) throw new Error(r.error || res.statusText);
        setImporting(false);
        $('importDialog').close();
        await openArea({ name });
        $('statusMsg').textContent = `Imported ${importChosen.tag || importChosen.area} as ${name}: ${r.standing} tiles with trees or buildings, ${r.objects} objects (placed on export).${r.notes.length ? ' Notes: ' + r.notes.join('; ') : ''}`;
    } catch (err) {
        $('importStatus').textContent = `Couldn't import: ${err.message}`;
        setImporting(false);
    }
};

// --- Open, and where entrances lead ---------------------------------------------------

$('btnOpen').onclick = async () => {
    const list = $('openList');
    list.textContent = 'Loading…';
    $('openDialog').showModal();
    let areas = [];
    try { areas = (await (await fetch('/api/areas')).json()).areas; } catch { /* none */ }
    // An admin on a team server can look at anyone's workspace.
    const who = $('openWho');
    who.hidden = !(me.team && me.admin);
    if (!who.hidden && !who.firstChild) {
        let users = [];
        try { users = (await (await fetch('/api/users')).json()).users; } catch { /* none */ }
        const pick = document.createElement('select');
        pick.innerHTML = `<option value="">My workspace</option>` + users.filter(u => u.user !== me.user)
            .map(u => `<option value="${u.user}">${u.user}: ${u.areas} area${u.areas === 1 ? '' : 's'} (read-only)</option>`).join('');
        pick.value = me.viewing ?? '';
        pick.onchange = () => viewAs(pick.value);
        who.append('Workspace', pick);
    }
    // Areas only saved here (never exported) too.
    const local = Object.keys(localStorage).filter(k => k.startsWith('landscaper.area.')).map(k => k.slice(16));
    for (const name of local) if (!areas.some(a => a.name === name)) areas.push({ name, local: true });
    list.textContent = '';
    for (const a of areas) {
        const row = document.createElement('div');
        row.className = 'open-row';
        const b = document.createElement('button');
        b.type = 'button';
        const kind = a.kind === 'underground' ? ' cave' : a.kind === 'interior' ? ' interior' : '';
        const what = a.local ? 'only in this browser' : `${a.tiles}×${a.tilesY ?? a.tiles}${kind} · module ${a.module}${a.exported ? '' : ' · not exported yet'}`;
        b.innerHTML = `<span><b>${a.name}</b>${a.name === area.name ? ' (open)' : ''}</span><small>${what}</small>`;
        b.onclick = () => { $('openDialog').close(); openArea(a); };
        row.appendChild(b);
        if (a.imported && !readOnly) {
            // Import it again from the original it was imported from (with
            // whatever the importer now does better).
            const re = document.createElement('button');
            re.type = 'button';
            re.className = 'reimport';
            re.textContent = 'Re-import';
            re.title = 'Import this area again from its original: its ground, pictures and objects start over';
            re.onclick = () => reimport(a, re);
            row.appendChild(re);
        }
        list.appendChild(row);
    }
    if (!areas.length) list.textContent = 'No areas yet: export one first.';
};

/** Imports area `a` again from its kept original, then opens it. */
async function reimport(a, button) {
    if (readOnly) return;
    if (!confirm(`Import ${a.name} again from its original?\n\nYour changes to it here are replaced (the last copy is kept as a backup). Its next export puts the original's placeables, creatures and lighting into the module again, replacing what was changed there in the toolset.`)) return;
    // The whole dialog waits for it: every button off, no closing it.
    reimporting = true;
    for (const b of $('openDialog').querySelectorAll('button')) b.disabled = true;
    button.textContent = 'Importing…';
    button.classList.add('busy');
    try {
        const res = await fetch(`/api/reimport?name=${encodeURIComponent(a.name)}`, { method: 'POST' });
        const r = await res.json();
        if (!res.ok) throw new Error(r.error || res.statusText);
        reimporting = false;
        for (const b of $('openDialog').querySelectorAll('button')) b.disabled = false;
        $('openDialog').close();
        await openArea({ name: a.name });
        $('statusMsg').textContent = `Imported ${a.name} again: ${r.standing} tiles with trees or buildings, ${r.objects} objects (placed on export).${r.notes.length ? ' Notes: ' + r.notes.join('; ') : ''}`;
    } catch (err) {
        $('openDialog').close();
        showError(`Couldn't import ${a.name} again: ${err.message}`);
    } finally {
        reimporting = false;
        for (const b of $('openDialog').querySelectorAll('button')) b.disabled = false;
    }
}
let reimporting = false;
$('openDialog').addEventListener('cancel', e => { if (reimporting) e.preventDefault(); });
// (Escape itself too, wherever focus is with every button off: browsers let
// it close a dialog regardless when there was no click since the last time.)
document.addEventListener('keydown', e => { if ((reimporting || importing) && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); } }, true);

/** Opens area `a`: from landscaper (its saved copy, else its last export),
 *  or from this browser if it only lives here (a save that failed). */
async function openArea(a) {
    const local = localStorage.getItem(`landscaper.area.${a.name}`);
    try {
        if (local && a.local) {
            setArea(Area.fromJSON(JSON.parse(local)));
        } else {
            const res = await fetch(`/api/area?name=${encodeURIComponent(a.name)}`);
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || res.statusText);
            setArea(Area.fromJSON(json));
        }
        $('statusMsg').textContent = `Opened ${area.name} (module ${area.module}).`;
        saveSoon();
    } catch (err) {
        showError(`Couldn't open ${a.name}: ${err.message}`);
    }
}

/** The Entrance panel: this area's entrances and where each leads. */
let entranceRender = 0;
async function showEntrances() {
    // Only the latest of overlapping renders fills the panel.
    const mine = ++entranceRender;
    const box = $('entranceList');
    if (!area.entrances.length) { box.innerHTML = '<p class="note">No entrances yet.</p>'; return; }
    let doors = [];
    try { doors = (await (await fetch(`/api/doors?module=${encodeURIComponent(area.module || area.name)}`)).json()).doors; } catch { /* none */ }
    if (mine !== entranceRender) return;
    box.textContent = '';
    area.entrances.forEach((e, k) => {
        const tag = `${area.name}_ent${k + 1}`;
        const row = document.createElement('div');
        row.className = 'entrance-row';
        const others = doors.filter(d => !d.tag.startsWith(`${area.name}_ent`));
        const options = ['<option value="">(not linked here: the toolset\'s link stays)</option>']
            .concat(others.map(d => `<option value="${d.tag}"${e.link === d.tag ? ' selected' : ''}>${d.tag} (area ${d.area})</option>`));
        if (e.link && !others.some(d => d.tag === e.link)) options.push(`<option value="${e.link}" selected>${e.link}</option>`);
        row.innerHTML = `<b>Entrance ${k + 1}</b><span>door <code>${tag}</code> leads to</span><select>${options.join('')}</select>`;
        row.querySelector('select').onchange = ev => {
            area.beginStroke();
            e.link = ev.target.value || undefined;
            saveSoon();
        };
        box.appendChild(row);
    });
    if (!doors.length) box.insertAdjacentHTML('beforeend', `<p class="note">No other entrance doors in module ${area.module} yet: export the other area into it first.</p>`);
}

// --- Scatter --------------------------------------------------------------------------

const scatterMix = new Set();
for (const q of QUICK) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = q;
    b.onclick = () => { $('scatterSearch').value = q; showScatterables(); };
    $('scatterChips').appendChild(b);
}
let scatterShown = null;
async function showScatterables() {
    const query = $('scatterSearch').value.trim() || 'rock';
    if (query === scatterShown) return;
    scatterShown = query;
    await modelResults($('scatterResults'), query, model => {
        if (scatterMix.has(model)) scatterMix.delete(model); else scatterMix.add(model);
        markMix();
    });
    markMix();
}
function markMix() {
    for (const b of $('scatterResults').children) b.classList.toggle('active', scatterMix.has(b.dataset.model));
}
$('scatterSearch').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(showScatterables, 250); };
const showScatterSliders = () => {
    $('scatterDensityOut').textContent = `${$('scatterDensity').value} per 100 m²`;
    $('scatterMinOut').textContent = `${Math.round($('scatterMin').value * 100)}%`;
    $('scatterMaxOut').textContent = `${Math.round($('scatterMax').value * 100)}%`;
};
for (const id of ['scatterDensity', 'scatterMin', 'scatterMax']) $(id).oninput = showScatterSliders;
showScatterSliders();

/** A few tries a frame at a random point in the brush; a try is kept when
 *  no object is nearer than the density's spacing and the ground suits.
 *  (Synchronous, with the mix's models loaded when the stroke began: each
 *  object is in before the next try checks the spacing.) */
function scatterStamp(p, radius) {
    const s = stroke.scatter;
    if (s.erase) {
        const gone = new Set(area.objects.filter(o => Math.hypot(o.x - p.x, o.y - p.y) <= radius));
        if (gone.size) {
            area.objects = area.objects.filter(o => !gone.has(o));
            view.removeObjects(gone);
        }
        return;
    }
    const mix = s.flats;
    if (!mix?.length) return;
    const spacing = Math.sqrt(100 / +$('scatterDensity').value);
    const lo = Math.min(+$('scatterMin').value, +$('scatterMax').value), hi = Math.max(+$('scatterMin').value, +$('scatterMax').value);
    for (let k = 0; k < 4; k++) {
        const a = Math.random() * Math.PI * 2, d = radius * Math.sqrt(Math.random());
        const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
        if (x < 0.5 || y < 0.5 || x > area.sizeX - 0.5 || y > area.sizeY - 0.5) continue;
        if (area.objects.some(o => Math.hypot(o.x - x, o.y - y) < spacing)) continue;
        const i = Math.min(area.nx - 1, Math.round(x / SPACING)), j = Math.min(area.ny - 1, Math.round(y / SPACING));
        if ($('scatterSteep').checked && (!area.walkable(i, j) || area.depth(i, j) > 0)) continue;
        const [model, flat] = mix[Math.floor(Math.random() * mix.length)];
        const o = { id: area.nextObjectId++, model, appearance: appearanceOf(model), x, y, z: 0, bearing: Math.random() * Math.PI * 2, scale: lo + Math.random() * (hi - lo), solid: $('scatterSolid').checked, baked: true };
        o.z = groundUnder(o, flat);
        area.objects.push(o);
        view.addObject(o);
    }
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
// Whether the view shows the area's light and fog (else a plain working
// light, no fog), remembered.
$('skyPreview').checked = localStorage.getItem('landscaper.skyPreview') !== 'off';
$('skyPreview').onchange = () => {
    localStorage.setItem('landscaper.skyPreview', $('skyPreview').checked ? 'on' : 'off');
    showSky();
};
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
if (debug) window.landscaper = { area: () => area, view, live: () => live };

const canvas = view.renderer.domElement;
let stroke = null; // { flattenTo, last }
const live = { on: localStorage.getItem('landscaper.live') !== 'off', timer: null, running: false, again: false, edits: 0 };
let mouse = null;  // last client position over the canvas

// Water: a press starts a body (or takes the one clicked) and dragging up
// or down sets its level; Shift drains the one clicked.
const LEVEL_PER_PIXEL = 0.03;
function waterDown(e, p) {
    const i = Math.min(Math.max(Math.round(p.x / SPACING), 0), area.nx - 1);
    const j = Math.min(Math.max(Math.round(p.y / SPACING), 0), area.ny - 1);
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
        b = { i, j, level: area.heights[j * area.nx + i] + 0.3 };
        area.water.push(b);
        waterChanged();
    }
    return { body: b, startY: e.clientY, startLevel: b.level, ground: area.heights[b.j * area.nx + b.i] };
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
    view.markDirty(view.everything());
}

// Entrances: a click on a slope carves one facing into it (where it
// rises); on flat ground, facing away from the camera. Shift removes the
// one clicked (its carving stays: Undo takes it back).
/** In a cave, the direction from p to the nearest wall (ground a metre
 *  or more above the floor there) within 5 m, or null. */
function nearestWall(p) {
    const floor = area.heightAt(p.x, p.y);
    let best = null, bestD = Infinity;
    for (let k = 0; k < 32; k++) {
        const a = k * Math.PI / 16;
        for (let d = 0.3; d <= 5; d += 0.3) {
            if (area.heightAt(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d) > floor + 1) {
                if (d < bestD) { bestD = d; best = a; }
                break;
            }
        }
    }
    return best;
}

function entranceDown(e, p) {
    if (e.shiftKey) {
        const hit = nearestEntrance(area.entrances, p.x, p.y);
        if (!hit) return;
        area.beginStroke();
        area.entrances = area.entrances.filter(x => x !== hit);
        view.updateEntrances();
        showEntrances();
        view.updateShade();
        saveSoon();
        return;
    }
    // In a cave: on the floor beside a wall, not on the rock (the void).
    const ci = Math.min(area.nx - 1, Math.round(p.x / SPACING)), cj = Math.min(area.ny - 1, Math.round(p.y / SPACING));
    if (area.void(ci, cj)) {
        $('statusMsg').textContent = 'In a cave, click the floor right beside a wall: the entrance is carved into that wall.';
        return;
    }
    const gx = area.heightAt(p.x + 1, p.y) - area.heightAt(p.x - 1, p.y);
    const gy = area.heightAt(p.x, p.y + 1) - area.heightAt(p.x, p.y - 1);
    let dir;
    const wall = area.enclosed() ? nearestWall(p) : null;
    if (wall !== null) {
        dir = wall;
    } else if (Math.hypot(gx, gy) > 0.1) {
        dir = Math.atan2(gy, gx);
    } else {
        const c = view.camera.position;
        dir = Math.atan2((area.sizeY - c.z) - p.y, c.x - p.x) + Math.PI;
    }
    const ent = { x: p.x, y: p.y, dir, width: Math.min(8, Math.max(2.5, +sizeIn.value)), depth: 4, floor: 0 };
    // Inside one tile, for the game's pathfinding; the floor where it lands.
    const moved = fitInTile(ent, TILE, area.sizeX, area.sizeY);
    ent.floor = area.heightAt(ent.x, ent.y);
    area.beginStroke();
    area.entrances.push(ent);
    // Rock that suits the slope: what's painted just behind the mouth.
    const [bx, by] = entranceAt(ent, ent.depth + 2, 0);
    const bi = Math.min(area.nx - 1, Math.max(0, Math.round(bx / SPACING))), bj = Math.min(area.ny - 1, Math.max(0, Math.round(by / SPACING)));
    const ground = area.palette[area.materials[bj * area.nx + bi]];
    ent.rock = rockFor(library.byId.get(ground)?.category, ground, id => library.byId.has(id));
    const rock = ent.rock ? area.materialIndex(ent.rock) : undefined;
    view.markDirty(carve(area, ent, rock));
    view.syncPalette();
    if (area.water.length) waterChanged();
    view.updateEntrances();
    view.updateShade();
    showEntrances();
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
    if (tool === 'scatter') {
        if (!e.shiftKey && !scatterMix.size) { $('statusMsg').textContent = 'Add models to the mix in the panel first.'; return; }
        area.beginStroke();
        const scatter = { erase: e.shiftKey, flats: null };
        stroke = { scatter, last: 0 };
        Promise.all([...scatterMix].map(m => models.flat(m).then(f => [m, f], () => null)))
            .then(list => { scatter.flats = list.filter(Boolean); });
        try { canvas.setPointerCapture(e.pointerId); } catch { /* fine */ }
        return;
    }
    if (tool === 'place') {
        const pointerId = e.pointerId;
        // Placing waits for the model: a quick click may be released first,
        // and must not leave a drag running (it turned the next object).
        placePointer = pointerId;
        placeDown(e, p).then(s => {
            if (s && placePointer === pointerId) {
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
    if (tool === 'room') {
        // From here to where the button comes up; cut out then.
        // Started in a room: its floor (the lowest ground within 2 m, not a
        // point up its wall), else in the rock: the area's floor.
        let start = Infinity;
        for (let dy = -2; dy <= 2; dy += 0.5) {
            for (let dx = -2; dx <= 2; dx += 0.5) {
                if (dx * dx + dy * dy <= 4) start = Math.min(start, area.heightAt(Math.min(area.sizeX, Math.max(0, p.x + dx)), Math.min(area.sizeY, Math.max(0, p.y + dy))));
            }
        }
        stroke.room = { from: p, to: p, floor: area.enclosed() && start >= area.roof - 0.5 ? area.roof - CAVE_ROCK : start };
        const floorTexture = library.byId.get(paintTexture)?.category === 'Floors' ? paintTexture : 'woodOld';
        stroke.paintIndex = library.byId.has(floorTexture) ? area.materialIndex(floorTexture) : undefined;
        view.setRoomOutline(roomRect(p, p, area.sizeX, area.sizeY), stroke.room.floor);
    }
    if (tool === 'dig') {
        // Down to the floor, or to the level of dug ground where it starts;
        // the floor painted with the picked texture (dirt unless painted).
        const start = area.heightAt(p.x, p.y);
        stroke.flattenTo = area.enclosed() && start >= area.roof - 0.5 ? area.roof - CAVE_ROCK : start;
        stroke.paintIndex = area.materialIndex(paintTexture === DEFAULT_TEXTURE ? 'dirt' : paintTexture);
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
    if (stroke?.room) {
        const p = view.pick(e.clientX, e.clientY);
        if (p) {
            stroke.room.to = p;
            const r = roomRect(stroke.room.from, p, area.sizeX, area.sizeY);
            view.setRoomOutline(r, stroke.room.floor);
            $('statusMsg').textContent = `Room ${(r.x1 - r.x0).toFixed(2)} × ${(r.y1 - r.y0).toFixed(2)} m`;
        }
    }
});
canvas.addEventListener('pointerleave', () => { mouse = null; view.setCursor(null); $('statusPos').textContent = ''; });
let placePointer = null;
const endStroke = () => {
    placePointer = null;
    if (!stroke) return;
    if (stroke.room) {
        const r = roomRect(stroke.room.from, stroke.room.to, area.sizeX, area.sizeY);
        view.markDirty(cutRoom(area, r, stroke.room.floor, stroke.paintIndex));
        view.setRoomOutline(null);
        view.syncPalette();
        $('statusMsg').textContent = '';
    }
    // The ground moved: its shadows too.
    if (!stroke.water && !stroke.place && !stroke.scatter && tool !== 'paint') view.updateShade();
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
        const ci = Math.min(i, area.nx - 1), cj = Math.min(j, area.ny - 1);
        const walk = area.walkable(ci, cj), deep = area.depth(ci, cj);
        const what = deep > SHALLOW ? `water ${deep.toFixed(1)} m deep: too deep to walk` : deep > 0 ? `shallow water ${deep.toFixed(1)} m: wading` : walk ? 'walkable' : 'too steep to walk';
        $('statusPos').textContent = `x ${p.x.toFixed(1)} m · y ${p.y.toFixed(1)} m · height ${p.z.toFixed(1)} m · tile ${tx},${ty} · ${what}`;
    }
    if (stroke?.scatter && p) {
        scatterStamp(p, radius);
        dbg.stamps++;
        return;
    }
    if (stroke && p && !stroke.water && !stroke.place && !stroke.room) {
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
    $('areaInfo').textContent = `${a.name} · ${a.tiles}×${a.tilesY} tiles (${a.sizeX}×${a.sizeY} m)`;
    $('report').hidden = true;
    skyNight = a.atmosphere.time === 'night';
    showSky();
    checkSoon();
}

// Who is signed in (on a team server) and whose workspace is shown: your own,
// or for an admin looking, someone else's (read-only: it is never saved).
let me = { team: false, user: 'local', name: 'You', admin: true, viewing: null };
let readOnly = false;

async function loadMe() {
    try {
        const res = await fetch('/api/me');
        if (res.ok) me = await res.json();
        else if (res.status === 401 || res.status === 403) showError((await res.json().catch(() => ({}))).error || 'You are not signed in.');
    } catch { /* not served: a plain page */ }
    readOnly = !!me.viewing;
    showWho();
}

function showWho() {
    const who = $('who');
    who.textContent = '';
    who.classList.toggle('viewing', readOnly);
    if (!me.team) return;
    if (readOnly) {
        who.append(`Viewing ${me.viewing}'s workspace: read-only`);
        const back = document.createElement('button');
        back.type = 'button';
        back.textContent = 'Back to mine';
        back.onclick = () => viewAs('');
        who.append(back);
    } else {
        who.append(`${me.name}${me.admin ? ' (admin)' : ''}`);
    }
    for (const id of ['btnExport', 'btnCheck', 'btnImport']) if ($(id)) $(id).disabled = readOnly;

}

/** An admin looks at `user`'s workspace ('' for their own), then the page reloads in it. */
async function viewAs(user) {
    await fetch(`/api/view-as?user=${encodeURIComponent(user)}`, { method: 'POST' });
    location.reload();
}

// Autosave: each area to landscaper (areas/<name>.json on disk) a moment
// after each change. If that fails, into this browser until it works again,
// and the status line says so.
let saveTimer = null;
function saveSoon() {
    // Looking at someone else's workspace: nothing is saved (not into yours either).
    if (readOnly) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveArea(area), 800);
    checkSoon();
}

async function saveArea(a) {
    const json = JSON.stringify(a.toJSON());
    localStorage.setItem('landscaper.current', a.name);
    try {
        await putArea(a.name, json);
        localStorage.removeItem(`landscaper.area.${a.name}`);
        localStorage.removeItem(`landscaper.saved.${a.name}`);
        if ($('statusMsg').dataset.saveFailed) { $('statusMsg').textContent = 'Saved.'; delete $('statusMsg').dataset.saveFailed; }
    } catch (err) {
        try {
            localStorage.setItem(`landscaper.area.${a.name}`, json);
            localStorage.setItem(`landscaper.saved.${a.name}`, String(Date.now()));
            $('statusMsg').textContent = `Couldn't save ${a.name} to disk (${err.message}): kept in this browser for now.`;
        } catch {
            $('statusMsg').textContent = `Couldn't save ${a.name} anywhere (${err.message}): export it, or your latest changes may be lost.`;
        }
        $('statusMsg').dataset.saveFailed = '1';
    }
}

async function putArea(name, json) {
    const res = await fetch(`/api/save?name=${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: json });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
}

/** Areas kept in this browser (before landscaper saved to disk, or when a
 *  save failed) go to landscaper when newer than its copy, then leave the
 *  browser. */
async function moveBrowserAreas() {
    const names = Object.keys(localStorage).filter(k => k.startsWith('landscaper.area.')).map(k => k.slice(16));
    if (!names.length) return;
    let known = [];
    try { known = (await (await fetch('/api/areas')).json()).areas; } catch { return; }
    let moved = 0;
    for (const name of names) {
        const json = localStorage.getItem(`landscaper.area.${name}`);
        const at = +(localStorage.getItem(`landscaper.saved.${name}`) ?? 0);
        const there = known.find(a => a.name === name);
        const theirs = Math.max(there?.saved ?? 0, there?.exported ?? 0) * 1000;
        try {
            if (!there || at > theirs) { await putArea(name, json); moved++; }
            localStorage.removeItem(`landscaper.area.${name}`);
            localStorage.removeItem(`landscaper.saved.${name}`);
        } catch (err) { console.warn(`couldn't move ${name} to disk`, err); }
    }
    if (moved) $('statusMsg').textContent = `Moved ${moved} area${moved > 1 ? 's' : ''} from this browser to landscaper's folder.`;
}

// Live check: Check paths again a moment after each edit, one at a time
// (serve does one request at a time; an export waits behind it). A result
// for an area that has changed since is dropped and the check runs again.
const LIVE_DELAY = 1500;

function showLive(state, text, title) {
    const b = $('btnLive');
    b.className = `top-btn live ${live.on ? state : 'off'}`;
    $('liveText').textContent = live.on ? text : 'Live off';
    b.title = live.on ? `${title}\nClick to stop checking after each edit.` : 'Check paths after each edit (click to turn on)';
}

function checkSoon() {
    if (readOnly) return;
    live.edits++;
    clearTimeout(live.timer);
    if (!live.on || !area) return;
    showLive('busy', 'Live …', 'Waiting for you to stop editing.');
    live.timer = setTimeout(liveCheck, LIVE_DELAY);
}

async function liveCheck() {
    if (!live.on || !area) return;
    if (stroke) return; // its end schedules one
    if (live.running) { live.again = true; return; }
    live.running = true;
    const edits = live.edits, checked = area;
    showLive('busy', 'Checking…', 'Checking how NWN will path this area.');
    let report = null, error = null;
    try { report = await sendArea('check'); } catch (err) { error = err; }
    live.running = false;
    if (live.again || edits !== live.edits || checked !== area) {
        live.again = false;
        if (live.on && area) live.timer = setTimeout(liveCheck, LIVE_DELAY);
        return;
    }
    if (error) { showLive('bad', 'Live: error', error.message); return; }
    view.setMarkers(report.warnings || []);
    const { ok, total } = report.routes;
    const failed = total - ok, others = report.warnings.length - report.warnings.filter(w => w.kind === 'failed_route').length;
    if (failed) showLive('bad', `${failed} blocked`, `${ok} of ${total} test routes reach their goal; red pillars mark where they stop.`);
    else if (others) showLive('warn', `${others} spot${others > 1 ? 's' : ''}`, `All ${total} test routes work; orange pillars mark ${others} spot(s) to look at (Check paths explains).`);
    else showLive('ok', 'Paths OK', `All ${total} test routes work.`);
}

// The markers on the map: shown or hidden (M), remembered; the checks go on.
function showMarkers(on) {
    localStorage.setItem('landscaper.markers', on ? 'on' : 'off');
    view.setShowMarkers(on);
    $('btnMarkers').classList.toggle('active', on);
    $('btnMarkers').textContent = on ? 'Markers' : 'Markers hidden';
}
$('btnMarkers').onclick = () => showMarkers(!$('btnMarkers').classList.contains('active'));
showMarkers(localStorage.getItem('landscaper.markers') !== 'off');

$('btnLive').onclick = () => {
    live.on = !live.on;
    localStorage.setItem('landscaper.live', live.on ? 'on' : 'off');
    if (live.on) checkSoon();
    else { clearTimeout(live.timer); view.setMarkers([]); showLive('off'); }
};
showLive('off');

function refreshAll() {
    if (view.selected && !area.objects.includes(view.selected)) selectObject(null);
    view.markDirty(view.everything());
    view.updateEntrances();
    view.updateObjects();
    view.updateShade();
    view.updateWater();
    view.syncPalette();
    saveSoon();
}
$('btnUndo').onclick = () => { if (area?.undo()) refreshAll(); };
$('btnRedo').onclick = () => { if (area?.redo()) refreshAll(); };

// Square sizes to pick, or any width and height (2 to 32 tiles each).
const SIZES = [4, 8, 12, 16, 20, 24, 28, 32];
const showSize = () => {
    for (const o of $('sizeChoices').children) o.classList.toggle('active', +o.dataset.size === +$('newW').value && +o.dataset.size === +$('newH').value);
};
for (const s of SIZES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.size = s;
    b.innerHTML = `${s}×${s}<small>${s * TILE} m</small>`;
    b.onclick = () => { $('newW').value = $('newH').value = s; showSize(); };
    $('sizeChoices').appendChild(b);
}
$('newW').oninput = $('newH').oninput = showSize;
showSize();

$('btnNew').onclick = () => {
    if (area) $('newName').value = area.name;
    $('newDialog').showModal();
};
$('newDialog').addEventListener('close', () => {
    if ($('newDialog').returnValue !== 'ok') return;
    const start = new FormData($('newDialog').querySelector('form')).get('start');
    const base = Math.min(100, Math.max(0, Number($('newBase').value) || 0));
    const tiles = v => Math.min(32, Math.max(3, Math.round(+v || 8)));
    const created = Area.create($('newName').value.trim().toLowerCase(), tiles($('newW').value), start, base, tiles($('newH').value));
    created.module = $('newModule').value.trim().toLowerCase() || created.name;
    setArea(created);
    saveSoon();
});

// --- Export ---------------------------------------------------------------------

/** The area as landscaper serve takes it: heights (f32 a sample), each
 *  sample's palette index (u8), then JSON too long for the query (the
 *  objects); the rest in the query. */
function areaRequest() {
    const extra = new TextEncoder().encode(JSON.stringify({ objects: area.objects }));
    const body = new Uint8Array(area.heights.byteLength + area.materials.byteLength + extra.byteLength);
    body.set(new Uint8Array(area.heights.buffer, area.heights.byteOffset, area.heights.byteLength));
    body.set(area.materials, area.heights.byteLength);
    body.set(extra, area.heights.byteLength + area.materials.byteLength);
    const query = `name=${encodeURIComponent(area.name)}&tiles=${area.tiles}&tilesY=${area.tilesY}&palette=${encodeURIComponent(area.palette.join(','))}`
        + `&atmosphere=${encodeURIComponent(JSON.stringify(area.atmosphere))}`
        + `&water=${encodeURIComponent(JSON.stringify(area.water))}`
        + `&shadow=${area.shadow}`
        + `&entrances=${encodeURIComponent(JSON.stringify(area.entrances))}`
        + (area.enclosed() ? `&kind=${area.kind}&roof=${area.roof}` : '')
        + `&module=${encodeURIComponent(area.module || area.name)}`;
    return { query, body };
}

/** Sends the area to `what` (export or check); its report, or throws. */
async function sendArea(what) {
    const { query, body } = areaRequest();
    const res = await fetch(`/api/${what}?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body });
    if (res.status === 404 || res.status === 501) throw new Error('This page is not being served by landscaper. Run: landscaper serve');
    const report = await res.json();
    if (!res.ok) throw new Error(report.error || res.statusText);
    return report;
}

$('btnExport').onclick = async () => {
    if (readOnly) return;
    if (!area) return;
    const btn = $('btnExport');
    btn.disabled = true;
    $('statusMsg').textContent = `Exporting ${area.name}…`;
    try {
        const report = await sendArea('export');
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

// Check paths: the export's planning and route simulation, nothing built.
$('btnCheck').onclick = async () => {
    if (readOnly) return;
    if (!area) return;
    const btn = $('btnCheck');
    btn.disabled = true;
    $('statusMsg').textContent = 'Checking how NWN will path this area…';
    try {
        const report = await sendArea('check');
        showReport(report, true);
        view.setMarkers(report.warnings || []);
        $('statusMsg').textContent = '';
    } catch (err) {
        $('statusMsg').textContent = '';
        showError(err.message);
    } finally {
        btn.disabled = false;
    }
};

function showReport(r, checkOnly = false) {
    const failed = r.warnings.filter(w => w.kind === 'failed_route').length;
    const closed = r.warnings.filter(w => w.kind === 'closed_passage').length;
    const winding = r.warnings.length - failed - closed;
    const level = failed ? 'bad' : r.warnings.length ? 'warn' : 'good';
    const explain = text => `<details><summary>What this means</summary><p class="note">${text}</p></details>`;
    $('reportBody').innerHTML = `
        <h3>${checkOnly ? 'Path check' : `Exported ${r.name}`}</h3>
        <div class="big ${level}">${r.routes.ok} of ${r.routes.total} routes work</div>
        <p>NWN's pathfinding, simulated on random routes between places your ground joins.</p>
        ${failed ? `<p class="bad">● ${failed} route(s) stop short: red markers, where the walker stops.</p>
            ${explain(`The ground joins the two ends, but NWN's pathfinding finds no way through, so a player clicking past there stops short. NWN only crosses from one 10 m tile to the next at a few fixed points on each tile edge, so the usual causes are a passage the tiles can't use (see closed passages), a steep step between tile heights, or a narrow way along a tile edge or corner. Widen or straighten the way there, soften the slope, or keep openings away from tile edges and corners (every 10 m on the grid).`)}` : ''}
        ${closed ? `<p class="warn">● ${closed} passage(s) closed: orange markers.</p>
            ${explain(`Ground you can walk through, but no NWN tile layout can use it (a gap between obstacles at a tile corner, a strip along a tile edge), so the export made that bit unwalkable. Harmless where nobody needs to pass: a sliver beside a wall, a corner behind rocks. Where players should get through, move or widen the gap, away from tile corners and edges; if it cut a way off, routes through it show as red too.`)}` : ''}
        ${winding ? `<p class="warn">● ${winding} tile(s) too winding: orange markers.</p>
            ${explain(`NWN searches inside each tile with a time limit. Ground that twists within one tile (U-bends, zigzags, many small pockets) can take too long, so creatures there sometimes give up or go the long way. Usually it still works; if creatures misbehave there, straighten or widen the passages in that tile.`)}` : ''}
        <p>Walkable ground kept: ${(100 * r.coverage).toFixed(1)}%</p>
        ${checkOnly ? '<p class="note">Nothing was exported: this only checks.</p>' : `${updated(r.updated)}${r.added_to_module ? `<p>Added to module <b>${r.added_to_module.module}</b> as area ${r.added_to_module.area}: link its entrances to the others there (Entrance tool, Leads to).</p>` : ''}
        <p>Ready to play: <b>${r.name}</b> is in your NWN modules list.<br><code>${r.installed_module || r.module}</code></p>`}`;
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
    if (u.placeables_added || u.placeables_removed) html += `<p>Placeables (objects): ${u.placeables_added} added, ${u.placeables_removed} removed; the others moved where you put them, keeping what the toolset gave them.</p>`;
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
    // F5 / Ctrl+R reload, as in a browser (the app's window has no such keys).
    if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) { e.preventDefault(); location.reload(); return; }
    if (e.target.closest('input, dialog')) return;
    // The selected placeable (Place tool).
    if (tool === 'place' && view.selected) {
        const turn = { q: Math.PI / 12, e: -Math.PI / 12 }[e.key.toLowerCase()];
        if (turn) { changeSelected(o => { o.bearing += turn; }); return; }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeObject(view.selected); return; }
        if (e.key === 'Escape') { selectObject(null); return; }
    }
    const t = Object.entries(TOOLS).find(([, v]) => v.key === e.key);
    if (t) selectTool(t[0]);
    else if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); $('btnUndo').click(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); $('btnRedo').click(); }
    else if (e.key === '[') { sizeIn.value = +sizeIn.value - 1; showSliders(); }
    else if (e.key === ']') { sizeIn.value = +sizeIn.value + 1; showSliders(); }
    else if (e.key === 'w') $('btnWalk').click();
    else if (e.key === 'l') $('btnSky').click();
    else if (e.key === 'n') $('btnNew').click();
    else if (e.key === 'o') $('btnOpen').click();
    else if (e.key === 'f') view.frame();
    else if (e.key === 'm') $('btnMarkers').click();
});

// --- Start ---------------------------------------------------------------------------

// The area last open: from landscaper, or this browser if it couldn't take it.
await loadMe();
if (!readOnly) await moveBrowserAreas();
{
    const current = localStorage.getItem('landscaper.current');
    const local = current && localStorage.getItem(`landscaper.area.${current}`);
    let opened = null;
    if (current && !local) {
        try {
            const res = await fetch(`/api/area?name=${encodeURIComponent(current)}`);
            if (res.ok) opened = Area.fromJSON(await res.json());
        } catch { /* not served */ }
    }
    try { opened ??= local ? Area.fromJSON(JSON.parse(local)) : null; } catch { opened = null; }
    setArea(opened ?? Area.create('untitled', 8, 'hills'));
}
