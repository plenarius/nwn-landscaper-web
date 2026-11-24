// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The page's start-up and wiring: makes the view and the tools, gives each feature file what it needs of the editor through its
// init function, and handles the keys. Here: the tool buttons, the Paint tool's textures and eyedropper, Open, the Show menu, who
// is signed in, the area's undo and settings, the keys, and opening the last area at start. Elsewhere: placeables (place.js),
// importing (import.js), scatter (scatter.js), sky & fog (sky.js), the menus (menus.js), the pointer and its strokes (strokes.js),
// water (water.js), entrances (entrancetool.js), activity and publish (activity.js, publish.js),
// autosave (save.js), the live path check (live.js), New area (newarea.js), and Export and Check paths (export.js).

import { Area, DEFAULT_TEXTURE } from './area.js';
import { View } from './view.js';
import { TOOLS } from './tools.js';
import { ICONS } from './icons.js';
import { TextureLibrary } from './textures.js';
import { ThingsTool } from './things.js';
import './thingprops.js'; // (adds the properties panel to ThingsTool)
import './newbp.js'; // (adds the builder's own blueprints to ThingsTool)
import { ask } from './ask.js';
import { THING_COLOURS, css } from './thingcolours.js';
import { openSettings } from './settings.js';
import { api, engine, json, NEEDS_ENGINE, viewing } from './api.js';
import { $, el, session, store, say } from './dom.js';
import { initImport, reimport } from './import.js';
import { initSky, showAreaSky, refreshSky } from './sky.js';
import { initMenus } from './menus.js';
import { initActivity } from './activity.js';
import { initPublish } from './publish.js';
import { initScripts } from './scripts.js';
import { initReport, showError } from './report.js';
import { initNewArea } from './newarea.js';
import { initPlace, selectObject, removeObject, changeSelected, transformer, showPlaceables } from './place.js';
import { initScatter, showScatterables } from './scatter.js';
import { initWater } from './water.js';
import { initEntranceTool, showEntrances } from './entrancetool.js';
import { initStrokes, currentStroke, endStroke } from './strokes.js';
import {
    initSave,
    saveSoon,
    flushSave,
    moveBrowserAreas,
    browserCopy,
    browserCopies,
    noteSaved,
    loadArea,
    openCopy,
    noteOpen,
    lastOpen,
    unsaved,
} from './save.js';
import { initLive, showLive, checkSoon } from './live.js';
import { initExport } from './export.js';

/** An icon from icons.js: fixed SVG markup, written in this repository (no data reaches it). */
function setIcon(e, name) {
    // biome-ignore lint/plugin: ICONS holds fixed SVG markup from js/icons.js
    e.innerHTML = ICONS[name];
}
for (const e of document.querySelectorAll('[data-icon]')) setIcon(e, e.dataset.icon);
// A dialog's Close button names its dialog (`data-close`): the page's Content-Security-Policy runs no inline `onclick`.
for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => $(b.dataset.close).close();

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

/** What the feature files (import.js, sky.js, place.js, strokes.js, save.js, live.js, export.js and others) read of the editor.
 *  `area`, `tool`, `me` and `readOnly` change (another area opened, another tool picked, /api/me answered), so they are getters,
 *  read each time they are needed. */
const editor = { area: () => area, tool: () => tool, me: () => me, readOnly: () => readOnly, view };

for (const [id, t] of Object.entries(TOOLS)) {
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.tool = id;
    b.title = `${t.hint} (${t.key})`;
    const icon = el('span', { className: 'icon' });
    setIcon(icon, id);
    b.append(icon, el('span', { textContent: t.label }), el('span', { className: 'key', textContent: t.key }));
    b.onclick = () => selectTool(id);
    $('toolButtons').appendChild(b);
}

// Whether the next click on the ground in the Paint tool picks its texture up (see setPicking).
let picking = false;

function selectTool(id) {
    tool = id;
    for (const c of document.querySelectorAll('canvas')) c.style.cursor = '';
    picking = false;
    $('btnPick')?.classList.remove('active');
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
    $('rampPanel').hidden = skyOpen || tool !== 'ramp';
    $('descentPanel').hidden = skyOpen || tool !== 'descent';
    $('entrancePanel').hidden = skyOpen || tool !== 'entrance';
    if (tool === 'entrance' && !skyOpen) showEntrances();
    $('scatterPanel').hidden = skyOpen || tool !== 'scatter';
    if (tool === 'scatter' && !skyOpen) showScatterables();
    if (tool !== 'place' && view.selected) selectObject(null);
    if (tool === 'place' && !skyOpen) showPlaceables();
    $('thingsPanel').hidden = skyOpen || tool !== 'things';
    if (tool === 'things' && !skyOpen) thingsTool.show();
    else thingsTool.hide();
    $('btnSky').classList.toggle('active', skyOpen);
}
// Creatures, waypoints, triggers, sounds...: the Things tool.
let showLabel = () => {}; // the Show button's text, set with the Show menu below
const thingsTool = new ThingsTool({
    onActive: () => showLabel(),
    $,
    area: () => area,
    view,
    readOnly: () => readOnly,
    saveSoon: () => saveSoon(),
    say,
});
selectTool('raise');

const sizeIn = $('brushSize'),
    strengthIn = $('brushStrength');
const showSliders = () => {
    $('sizeOut').textContent = `${(+sizeIn.value).toFixed(1)} m`;
    $('strengthOut').textContent = `${Math.round(strengthIn.value * 100)}%`;
};
sizeIn.oninput = strengthIn.oninput = showSliders;
showSliders();

$('btnWalk').onclick = () => {
    const on = !$('btnWalk').classList.contains('on');
    $('btnWalk').classList.toggle('on', on);
    view.setShowWalkability(on);
};

const library = new TextureLibrary();
let paintTexture = DEFAULT_TEXTURE;

const CATEGORY_ORDER = ['Grass', 'Flowers & leaves', 'Earth', 'Rock', 'Sand', 'Snow', 'Floors', 'Walls', 'Special'];

function buildPalette() {
    const body = $('paletteBody');
    body.textContent = '';
    if (!library.catalog.length) {
        body.innerHTML =
            '<p>No texture library. Run the page from <code>landscaper serve</code>: it builds a starter library from your game files the first time (or run <code>landscaper textures init</code>).</p>';
        return;
    }
    const categories = [...new Set(library.catalog.map(t => t.category))].sort(
        (a, b) => (CATEGORY_ORDER.indexOf(a) + 1 || 99) - (CATEGORY_ORDER.indexOf(b) + 1 || 99),
    );
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
            b.append(el('img', { loading: 'lazy', alt: '', src: library.swatchUrl(t.id) }), el('span', { textContent: t.name }));
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

// The library comes from the engine; it is loaded once /api/me has said whether there is one (see the start, at the end).
async function loadLibrary() {
    if (engine.up && (await library.load())) view.setLibrary(library);
    buildPalette();
}

// The eyedropper: click the ground to paint with what is there. Ground you painted gives its library texture; the ground of an
// imported area gives the tileset's own texture under the click, which the server puts in the library (as "Tileset") the first time.
function setPicking(on) {
    picking = on;
    $('btnPick').classList.toggle('active', on);
    canvas.style.cursor = on ? 'crosshair' : '';
    if (on) say('Click the ground to pick up its texture.');
}
$('btnPick').onclick = () => setPicking(!picking);

async function pickTexture(p) {
    const ground = area.textureAt(p.x, p.y);
    if (!ground) return;
    if (!ground.startsWith('@import:')) {
        selectTexture(ground);
        document.querySelector(`#paletteBody .swatch[data-texture="${CSS.escape(ground)}"]`)?.scrollIntoView({ block: 'nearest' });
        say(`Picked ${library.byId.get(ground)?.name ?? ground}.`);
        return;
    }
    if (readOnly) {
        say("You are looking at someone else's area: nothing can be picked up into the library.");
        return;
    }
    say('Picking up the ground texture…');
    let r = {};
    let ok = false;
    try {
        const res = await api(
            `/api/pick-texture?name=${encodeURIComponent(ground.slice('@import:'.length))}&x=${p.x.toFixed(2)}&y=${p.y.toFixed(2)}`,
            { method: 'POST' },
        );
        ok = res.ok;
        r = await res.json();
    } catch {
        /* r stays empty */
    }
    if (!ok) {
        say(r.error ?? 'Could not pick up that texture.');
        return;
    }
    if (r.added) {
        await library.load();
        buildPalette();
    }
    selectTexture(r.id);
    document.querySelector(`#paletteBody .swatch[data-texture="${CSS.escape(r.id)}"]`)?.scrollIntoView({ block: 'nearest' });
    say(r.added ? `Picked ${r.name}: added to the Tileset textures.` : `Picked ${library.byId.get(r.id)?.name ?? r.name}.`);
}

initPlace(editor);

initImport({ ...editor, openArea });

$('btnOpen').onclick = async () => {
    const list = $('openList');
    list.textContent = 'Loading…';
    $('openDialog').showModal();
    let areas = [];
    try {
        areas = (await (await api('/api/areas')).json()).areas ?? [];
    } catch {
        /* none */
    }
    // An admin on a team server can look at anyone's workspace.
    const who = $('openWho');
    who.hidden = !(me.team && me.admin);
    if (!who.hidden && !who.firstChild) {
        let users = [];
        try {
            users = (await (await api('/api/users')).json()).users ?? [];
        } catch {
            /* none */
        }
        const pick = document.createElement('select');
        pick.add(new Option('My workspace', ''));
        for (const u of users.filter(u => u.user !== me.user))
            pick.add(new Option(`${u.user}: ${u.areas} area${u.areas === 1 ? '' : 's'} (read-only)`, u.user));
        pick.value = me.viewing ?? '';
        pick.onchange = () => viewAs(pick.value);
        who.append('Workspace', pick);
    }
    noteSaved(areas);
    // Areas only saved here (never exported) too: yours, so not while looking at someone else's workspace.
    if (!readOnly) for (const name of browserCopies()) if (!areas.some(a => a.name === name)) areas.push({ name, local: true });
    list.textContent = '';
    for (const a of areas) {
        const row = document.createElement('div');
        row.className = 'open-row';
        const b = document.createElement('button');
        b.type = 'button';
        const kind = a.kind === 'underground' ? ' cave' : a.kind === 'interior' ? ' interior' : '';
        const what = a.local
            ? 'only in this browser'
            : `${a.tiles}×${a.tilesY ?? a.tiles}${kind} · module ${a.module}${a.exported ? '' : ' · not exported yet'}`;
        b.append(el('span', {}, el('b', { textContent: a.name }), a.name === area.name && ' (open)'), el('small', { textContent: what }));
        b.onclick = () => {
            $('openDialog').close();
            openArea(a);
        };
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
    if (!areas.length) list.textContent = engine.up ? 'No areas yet: export one first.' : NEEDS_ENGINE;
};

// How many times Open has been asked: each opening's answer counts only if no later one was asked meanwhile.
let opening = 0;

/** Opens area `a` (an entry of Open's list): from landscaper (its saved copy, else its last export), after the saves before
 *  it and its copy in this browser (loadArea); or from this browser if it only lives here (a save that failed). It isn't
 *  saved again: nothing has changed. `settle` false leaves the copy in this browser as it is (see loadArea). */
async function openArea(a, settle = true) {
    try {
        // (an area opened after this one, whose answer came first, stays open)
        const mine = ++opening;
        const opened = a.local ? openCopy(a.name) : await loadArea(a.name, settle);
        if (mine !== opening) return;
        // Reopened while it was still being changed here (during the load): what is open is newer than the answer.
        if (opened.name === area.name && unsaved(area)) {
            say(`${area.name} has changes the engine hasn't saved yet: kept as it is.`);
            return;
        }
        setArea(opened);
        noteOpen(area.name);
        say(`Opened ${area.name} (module ${area.module}).`);
    } catch (err) {
        showError(`Couldn't open ${a.name}: ${err.message}`, 'Open failed');
    }
}

initScatter(editor);

initSky({ ...editor, saveSoon });
initMenus();

$('btnSky').onclick = () => {
    skyOpen = !skyOpen;
    updatePanels();
};
$('skyClose').onclick = () => {
    skyOpen = false;
    updatePanels();
};

const canvas = view.renderer.domElement;
initWater(editor);
initEntranceTool({ ...editor, library, sizeIn });
initStrokes({
    ...editor,
    thingsTool,
    selectTool,
    paintTexture: () => paintTexture,
    picking: () => picking,
    setPicking,
    pickTexture,
    library,
    sizeIn,
    strengthIn,
});

// The Show menu: which kinds of thing are on the map out of the Things tool.
{
    const boxes = [...document.querySelectorAll('#menuShow input[data-kind]')];
    // In the Things tool everything shows, whatever is ticked: the button says so.
    const label = () => {
        $('btnShow').textContent = thingsTool.active ? 'Show: all (Things tool)' : `Show (${thingsTool.shown.size})`;
    };
    showLabel = label;
    for (const cb of boxes) {
        cb.checked = thingsTool.shown.has(cb.dataset.kind);
        cb.closest('label').style.setProperty('--kind', css(THING_COLOURS[cb.dataset.kind] ?? 0xffffff));
        cb.onchange = () => {
            thingsTool.setShown(cb.dataset.kind, cb.checked);
            label();
        };
    }
    const all = on => {
        for (const cb of boxes) {
            cb.checked = on;
            thingsTool.setShown(cb.dataset.kind, on);
        }
        label();
    };
    // Imported buildings: cut the roofs and upper floors away to see inside (the height is kept in this browser).
    const cutOn = $('showCut'),
        cutH = $('cutHeight'),
        cutOut = $('cutOut');
    try {
        const k = JSON.parse(store.get('landscaper.cut') ?? 'null');
        if (k) {
            cutOn.checked = !!k.on;
            cutH.value = k.h ?? 3;
        }
    } catch {
        /* default */
    }
    const cut = () => {
        cutOut.textContent = `${cutH.value} m`;
        $('cutRow').style.opacity = cutOn.checked ? '1' : '0.5';
        view.setCut(cutOn.checked ? +cutH.value : null);
        store.set('landscaper.cut', JSON.stringify({ on: cutOn.checked, h: +cutH.value }));
    };
    cutOn.onchange = cut;
    cutH.oninput = cut;
    cut();
    $('showAll').onclick = () => all(true);
    $('showNone').onclick = () => all(false);
    label();
}

/** Shows a new blank area: the one the page starts with when no area was open, or after the open one was deleted. */
function showBlank() {
    setArea(Area.create('untitled', 8, 'hills'), true);
}

/** Shows area `a`. `blank`: the area made when none was open, which the engine has never seen: nothing to look up or check
 *  until it is changed (saveSoon checks it then). */
function setArea(a, blank = false) {
    // A stroke under way ends on the area it began on: it never carries on into this one (with that area's textures, and its
    // undo step left behind).
    if (currentStroke()) endStroke();
    // The area open until now: its last change is saved before it goes (not 800 ms later, or never).
    flushSave();
    area = a;
    view.setArea(a);
    thingsTool.selectedId = null;
    if (!blank) thingsTool.loadOriginals();
    thingsTool.refresh();
    $('areaInfo').textContent = `${a.name} · ${a.tiles}×${a.tilesY} tiles (${a.sizeX}×${a.sizeY} m)`;
    $('report').hidden = true;
    showAreaSky(a);
    if (tool === 'entrance' && !skyOpen) showEntrances();
    if (!blank) checkSoon();
}

// Who is signed in (on a team server) and whose workspace is shown: your own,
// or for an admin looking, someone else's (read-only: it is never saved).
let me = { team: false, user: 'local', name: 'You', admin: true, viewing: null };
let readOnly = false;

async function loadMe() {
    const res = await api('/api/me');
    if (res.status === 401 || res.status === 403) showError((await json(res)).error || 'You are not signed in.', 'Not signed in');
    else if (res.ok) {
        try {
            me = await res.json();
        } catch {
            engine.up = false; // (a file server that answers every path with the page)
        }
    } else engine.up = false; // no engine: stopped (503 from api()), or a plain file server (404)
    readOnly = !!me.viewing;
    viewing.user = me.viewing || null;
    showWho();
    showEngine();
}

/** Without the engine the page sculpts; the banner says so once, and Live stays off. The texture library comes from the engine:
 *  loaded the first time it answers (without it, the Paint panel says why it is empty). */
function showEngine() {
    $('noEngine').hidden = engine.up;
    if (!engine.up) showLive('off');
    if (library.catalog.length) return;
    if (engine.up) loadLibrary();
    else buildPalette();
}
$('noEngineClose').onclick = () => {
    $('noEngine').hidden = true;
};

/** Which of the file menu's buttons show, and which are off while looking at someone else's workspace. */
function showButtons() {
    for (const id of ['btnExport', 'btnCheck', 'btnImport', 'btnDelete']) if ($(id)) $(id).disabled = readOnly;
    $('btnActivity').hidden = !(me.team && me.admin);
    $('sepFile').hidden = $('btnActivity').hidden;
    $('btnVersion').hidden = !(me.team && me.versions);
    // Publish opens pull requests through a review service when there is one; without it, it makes a package to download.
    $('btnPublish').hidden = !((me.team && me.publish) || me.package);
    $('btnPublish').querySelector('span').textContent = me.package ? 'Package for your module…' : 'Publish to the team…';
    // Its dialog says the same: a package to download, or pull requests for the team.
    $('pubTitle').textContent = me.package ? 'Package for your module' : 'Publish to the team';
    $('pubGo').textContent = me.package ? 'Download the package' : 'Open the pull requests';
    $('btnPublish').disabled = readOnly;
    $('btnVersion').disabled = readOnly;
}

function showWho() {
    showButtons();
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
}

initActivity();
initPublish(editor);
initScripts(editor);

// Save a version, Delete area, and autosave (save.js).
initSave({ ...editor, open: name => openArea({ name }, false), blank: showBlank });

/** An admin looks at `user`'s workspace ('' for their own), then the page reloads in it. */
async function viewAs(user) {
    await flushSave();
    await api(`/api/view-as?user=${encodeURIComponent(user)}`, { method: 'POST' });
    location.reload();
}

initLive({ ...editor, stroke: currentStroke, showEngine });

/** Redraws the area after undo or redo: the ground and its shadows only where they changed (area.lastChange). */
function refreshAll() {
    if (view.selected && !area.objects.includes(view.selected)) selectObject(null);
    const change = area.lastChange ?? { rect: view.everything(), heights: view.everything(), entrances: [], shadow: true };
    area.lastChange = null;
    view.markDirty(change.rect, false);
    view.markDirty(change.heights);
    for (const e of change.entrances) view.markEntrance(e);
    view.updateEntrances();
    view.syncObjects();
    view.updateShade(change.shadow);
    view.updateWater();
    view.syncPalette();
    thingsTool.refreshAll();
    // (its rows hold the entrances they were drawn for, which undo and redo replace with copies)
    if (tool === 'entrance' && !skyOpen) showEntrances();
    refreshSky();
    saveSoon();
}
let areaLists = null;
$('btnSettings').onclick = async () => {
    if (!area || readOnly) return;
    const meta = await thingsTool.loadMeta();
    // (a failed answer isn't kept: the next time asks again, and the settings show plain numbers meanwhile)
    areaLists ??= await api('/api/area-lists')
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null);
    openSettings(area, meta.template, areaLists ?? {}, () => {
        saveSoon();
        say('Area settings kept.');
    });
};
$('menuArea')
    .querySelector('.menu-btn')
    .addEventListener('click', () => {
        $('btnCeiling').hidden = !area?.enclosed();
    });
$('btnCeiling').onclick = async () => {
    if (!area?.enclosed() || readOnly) return;
    const text = await ask({
        title: 'Ceiling height',
        text: 'How many metres of headroom to keep over the floor everywhere, so a passage that descends keeps the same ceiling. Leave empty for one flat roof (the walls grow as the floor drops).',
        ok: 'Set',
        input: { label: 'Metres (2 to 20)', value: area.clearance ?? '', placeholder: 'flat roof' },
        submit: v => (v === '' || (+v >= 2 && +v <= 20) ? undefined : 'Between 2 and 20 metres, or empty.'),
    });
    if (text === null) return;
    area.clearance = text === '' ? null : +text;
    view.markDirty(view.everything(), false);
    saveSoon();
    say(area.clearance ? `The ceiling stays ${area.clearance} m over the floor.` : 'One flat roof.');
};
$('btnUndo').onclick = () => {
    if (area?.undo()) refreshAll();
};
$('btnRedo').onclick = () => {
    if (area?.redo()) refreshAll();
};

// The New area dialog (newarea.js).
initNewArea({ setArea, thingsTool, library });

initExport(editor);

// The report box (report.js).
initReport();

const STEP = Math.PI / 36; // 5 degrees
function cameraKey(e) {
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (arrow) {
        if (e.shiftKey) view.orbitBy(-arrow[0] * STEP, -arrow[1] * STEP);
        else view.panBy(arrow[0], arrow[1]);
        return true;
    }
    if (e.key === '+' || e.key === '=') {
        view.zoomBy(0.88);
        return true;
    }
    if (e.key === '-' || e.key === '_') {
        view.zoomBy(1 / 0.88);
        return true;
    }
    if (e.key === 'Home') {
        view.topDown();
        return true;
    }
    return false;
}

window.addEventListener('keydown', e => {
    // F5 / Ctrl+R reload. A browser tab does that itself; a window opened with `--app` (Chrome, Edge) has no reload key.
    if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) {
        e.preventDefault();
        // The last change first: a reload stops a save that is still waiting or on its way.
        flushSave().then(() => location.reload());
        return;
    }
    // Not while typing or choosing (a box, a list, a text area, an editor, a dialog).
    if (e.target.closest?.('input, select, textarea, dialog, [contenteditable]:not([contenteditable="false"])')) return;
    // Letters work with Caps Lock on: the shortcuts compare lower case (Ctrl+Shift+Z still reads e.key's capital).
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // The camera: arrows move along the ground, Shift+arrows turn the view, + and - zoom, Home looks straight down (F frames).
    if (!transformer.active && !e.ctrlKey && !e.metaKey && !e.altKey && cameraKey(e)) {
        e.preventDefault();
        return;
    }
    // Escape closes Sky & fog, which lies over the tools' panels.
    if (e.key === 'Escape' && skyOpen) {
        skyOpen = false;
        updatePanels();
        return;
    }
    if (tool === 'things' && !readOnly && thingsTool.key(e)) {
        e.preventDefault();
        return;
    }
    if (transformer.active) {
        if (transformer.key(e)) e.preventDefault();
        return;
    }
    // The selected placeable (Place tool).
    if (tool === 'place' && view.selected) {
        const start = { g: 'move', r: 'rotate', s: 'scale' }[e.key.toLowerCase()];
        if (start && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            transformer.begin(start);
            return;
        }
        const turn = { q: Math.PI / 12, e: -Math.PI / 12 }[e.key.toLowerCase()];
        if (turn) {
            changeSelected(o => {
                o.bearing += turn;
            });
            return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            removeObject(view.selected);
            return;
        }
        if (e.key === 'Escape') {
            selectObject(null);
            return;
        }
    }
    // (no other tool while a stroke is under way: it keeps the tool it started with)
    const t = !e.ctrlKey && !e.metaKey && !e.altKey && !currentStroke() && Object.entries(TOOLS).find(([, v]) => v.key === key);
    if (e.key === 'Escape' && picking) setPicking(false);
    else if (key === 'i' && !e.ctrlKey && !e.metaKey && !e.altKey && !currentStroke()) {
        selectTool('paint');
        setPicking(true);
    } else if (t) selectTool(t[0]);
    else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'z') {
        e.preventDefault();
        $('btnUndo').click();
    } else if ((e.ctrlKey || e.metaKey) && (key === 'y' || (e.shiftKey && key === 'z'))) {
        e.preventDefault();
        $('btnRedo').click();
    } else if (e.key === '[') {
        sizeIn.value = +sizeIn.value - 1;
        showSliders();
    } else if (e.key === ']') {
        sizeIn.value = +sizeIn.value + 1;
        showSliders();
    } else if (e.ctrlKey || e.metaKey || e.altKey) {
        /* the browser's own (Ctrl+F, Ctrl+N, Ctrl+O...) */
    } else if (key === 'w') $('btnWalk').click();
    else if (key === 'l') $('btnSky').click();
    else if (key === 'n' || key === 'o') {
        // (not typed into the dialog's first box as well)
        e.preventDefault();
        $(key === 'n' ? 'btnNew' : 'btnOpen').click();
    } else if (key === 'f') view.frame();
    else if (key === 'm') $('btnMarkers').click();
});

// The area last open: from landscaper, or this browser if it couldn't take it.
// (loadMe loads the texture library when the engine answers: showEngine)
await loadMe();
// A reviewer's link (?review=<builder>/<area>, in a pull request): an admin looks at that builder's area, read-only.
let reviewArea = null;
{
    const review = new URLSearchParams(location.search).get('review');
    const [who, name] = (review ?? '').split('/');
    if (review && me.team && me.admin && who && name) {
        if (me.viewing !== who && !session.get('landscaper.review')) {
            session.set('landscaper.review', '1');
            await api(`/api/view-as?user=${encodeURIComponent(who)}`, { method: 'POST' });
            location.reload();
            await new Promise(() => {}); // (the page is reloading)
        }
        session.remove('landscaper.review');
        if (me.viewing === who) reviewArea = name;
        history.replaceState(null, '', location.pathname);
    }
}
if (!readOnly) await moveBrowserAreas();
{
    const current = reviewArea ?? (readOnly ? null : lastOpen());
    const local = !reviewArea && current && browserCopy(current);
    let opened = null;
    // The engine's copy when it has one: a copy still in this browser is one the builder didn't decide on (moveBrowserAreas
    // asks again at the next start), or the engine isn't there.
    if (current) {
        try {
            const res = await api(`/api/area?name=${encodeURIComponent(current)}`);
            if (res.ok) opened = Area.fromJSON(await res.json());
        } catch {
            /* not served */
        }
    }
    try {
        opened ??= local ? openCopy(current) : null;
    } catch {
        opened = null;
    }
    if (opened) setArea(opened);
    else showBlank();
}
