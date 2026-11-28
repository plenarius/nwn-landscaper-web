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
import { COLLAPSED_KEY, allCollapsed, categoriesOf, opened, readCollapsed, swatchHidden, toggled, writeCollapsed } from './palette.js';
import { stillThere } from './packs.js';
import { initMixPanel, mixClick, mixOn, mixPicked, setMixOn, currentMix, mixLibraryChanged } from './mixpanel.js';
import { initPacks } from './packsdialog.js';
import { ThingsTool } from './things.js';
import './thingprops.js'; // (adds the properties panel to ThingsTool)
import './newbp.js'; // (adds the builder's own blueprints to ThingsTool)
import { ask } from './ask.js';
import { THING_COLOURS, css } from './thingcolours.js';
import { openSettings } from './settings.js';
import { api, engine, json, NEEDS_ENGINE, viewing } from './api.js';
import { $, el, session, store, say } from './dom.js';
import { showNoGame } from './nogame.js';
import { initImport, reimport } from './import.js';
import { initSky, showAreaSky, refreshSky, skyShowsNight } from './sky.js';
import { initLightTool, showLightTool, lightPair } from './lighttool.js';
import { initMenus } from './menus.js';
import { initDesktop } from './help.js';
import { initWebDemo, linkedArea } from './webdemo.js';
import { web } from './web.js';
import { initUpdate } from './update.js';
import { showVersion } from './version.js';
import { initActivity } from './activity.js';
import { initPublish } from './publish.js';
import { initScripts } from './scripts.js';
import { initReport, showError } from './report.js';
import { initNewArea } from './newarea.js';
import { initShowcase } from './showcase.js';
import { unlistedOf, unlistedRows } from './unlisted.js';
import { initHeightmap } from './heightmap.js';
import { initUnderlay, underlayAreaChanged, underlayEscape, toggleUnderlay, showUnderlay, hideUnderlay } from './underlay.js';
import { initPlace, selectObject, removeObject, changeSelected, transformer, showPlaceables, models } from './place.js';
import { initScatter, showScatterables } from './scatter.js';
import { initAmbienceTool, setAmbienceOpen, showAmbienceTool, loadParticles } from './ambiencetool.js';
import { initWater } from './water.js';
import { keyBelongsTo } from './keys.js';
import { initEntranceTool, showEntrances } from './entrancetool.js';
import { initStrokes, currentStroke, endStroke, moving } from './strokes.js';
import {
    initSave,
    saveSoon,
    flushSave,
    moveBrowserAreas,
    loadCopies,
    browserCopy,
    browserCopies,
    noteSaved,
    loadArea,
    openCopy,
    openAtStart,
    noteOpen,
    lastOpen,
    unsaved,
} from './save.js';
import { canvasShown, initCanvas } from './canvasui.js';
import { initPieces, piecesShown } from './piecesui.js';
import { initLive, showLive, checkSoon } from './live.js';
import { initMissing, showMissing } from './missing.js';
import { initExport } from './export.js';
import { initMissingModels, showMissingModels } from './missingmodels.js';

/** An icon from icons.js: fixed SVG markup, written in this repository (no data reaches it). */
function setIcon(e, name) {
    // biome-ignore lint/plugin: ICONS holds fixed SVG markup from js/icons.js
    e.innerHTML = ICONS[name];
}
for (const e of document.querySelectorAll('[data-icon]')) setIcon(e, e.dataset.icon);
// A dialog's Close button names its dialog (`data-close`): the page's Content-Security-Policy runs no inline `onclick`.
for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => $(b.dataset.close).close();

// The desktop app's items and words (help.js) and its updates (update.js), before anything below can stop the page.
initDesktop();
initUpdate();

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

/** The strength slider's name: Cover while painting a mix, as it is how much of the ground the mix covers (mix.js). */
function showStrengthName() {
    const cover = mixOn() && tool === 'paint';
    $('strengthLabel').textContent = cover ? 'Cover' : 'Strength';
    $('strengthLabel').title = cover ? 'How much of the ground under the brush the mix covers, in patches' : '';
    // (a mix's soft edge is its panel's: the patches fade in by weight)
    $('softnessGroup').hidden = tool !== 'paint' || mixOn();
}

function selectTool(id) {
    tool = id;
    // (Sky & fog lies over the tool's panel.)
    skyOpen = false;
    showStrengthName();
    for (const c of document.querySelectorAll('canvas')) c.style.cursor = '';
    picking = false;
    $('btnPick')?.classList.remove('active');
    for (const b of document.querySelectorAll('#toolButtons .tool')) b.classList.toggle('active', b.dataset.tool === id);
    updatePanels();
}

// One panel over the left of the view: the sky's when open, else the
// texture picker while painting, the placeables while placing.
let skyOpen = false;
// The underlay's panel lies there too, in place of the sky's.
let underlayOpen = false;
function updatePanels() {
    if (underlayOpen && skyOpen) underlayOpen = false;
    $('underlayPanel').hidden = !underlayOpen;
    $('btnUnderlay').classList.toggle('active', underlayOpen);
    if (underlayOpen) showUnderlay();
    else hideUnderlay();
    $('skyPanel').hidden = !skyOpen;
    // (either lies over the tools' panels)
    const over = skyOpen || underlayOpen;
    $('palette').hidden = over || tool !== 'paint';
    $('placePanel').hidden = over || tool !== 'place';
    $('rampPanel').hidden = over || tool !== 'ramp';
    $('chasmPanel').hidden = over || tool !== 'chasm';
    $('lightPanel').hidden = over || tool !== 'light';
    if (tool === 'light' && !over) showLightTool();
    $('descentPanel').hidden = over || tool !== 'descent';
    $('entrancePanel').hidden = over || tool !== 'entrance';
    if (tool === 'entrance' && !over) showEntrances();
    $('scatterPanel').hidden = over || tool !== 'scatter';
    if (tool === 'scatter' && !over) showScatterables();
    $('ambiencePanel').hidden = over || tool !== 'ambience';
    setAmbienceOpen(tool === 'ambience' && !over);
    if (tool !== 'place' && view.selected) selectObject(null);
    if (tool === 'place' && !over) showPlaceables();
    showScenery();
    $('thingsPanel').hidden = over || tool !== 'things';
    if (tool === 'things' && !over) thingsTool.show();
    else thingsTool.hide();
    $('btnSky').classList.toggle('active', skyOpen);
}
// The Show menu's Scenery: unticked, the view hides what Place and Scatter put down (to work on the ground under a forest),
// but in the tools that place it or things among it. Remembered in this browser.
const SCENERY_KEY = 'landscaper.showScenery';
let sceneryTicked = store.get(SCENERY_KEY) !== 'off';
function showScenery() {
    view.setShowScenery(sceneryTicked || ['place', 'scatter', 'things'].includes(tool));
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
    strengthIn = $('brushStrength'),
    softnessIn = $('brushSoftness');
const showSliders = () => {
    $('sizeOut').textContent = `${(+sizeIn.value).toFixed(1)} m`;
    $('strengthOut').textContent = `${Math.round(strengthIn.value * 100)}%`;
    $('softnessOut').textContent = `${Math.round(softnessIn.value * 100)}%`;
};
sizeIn.oninput = strengthIn.oninput = softnessIn.oninput = showSliders;
showSliders();

$('btnWalk').onclick = () => {
    const on = !$('btnWalk').classList.contains('active');
    $('btnWalk').classList.toggle('active', on);
    view.setShowWalkability(on);
};

const library = new TextureLibrary();
let paintTexture = DEFAULT_TEXTURE;

// The categories collapsed in the Paint panel (palette.js), as this browser last left them.
let collapsed = readCollapsed(store.get(COLLAPSED_KEY));

function buildPalette() {
    const body = $('paletteBody');
    body.textContent = '';
    if (!library.catalog.length) {
        if (web.on) body.append(el('p', { textContent: "No texture library: the engine in this page didn't start." }));
        else
            body.innerHTML =
                '<p>No texture library. Run the page from <code>landscaper serve</code>: it builds a starter library from your game files the first time (or run <code>landscaper textures init</code>).</p>';
        return;
    }
    const categories = categoriesOf(library.catalog);
    body.append(
        el(
            'div',
            { className: 'palette-all' },
            el('button', {
                type: 'button',
                id: 'paletteCollapse',
                textContent: 'Collapse all',
                onclick: () => setCollapsed(allCollapsed(collapsed, categories)),
            }),
            el('button', { type: 'button', id: 'paletteExpand', textContent: 'Expand all', onclick: () => setCollapsed(new Set()) }),
        ),
    );
    categories.forEach((category, k) => {
        const textures = library.catalog.filter(t => t.category === category);
        const grid = el('div', { className: 'swatches', id: `paletteCategory${k}` });
        grid.dataset.category = category;
        for (const t of textures) {
            const b = document.createElement('button');
            b.className = 'swatch';
            b.dataset.texture = t.id;
            b.title = `${t.name} (${t.source})`;
            b.append(el('img', { loading: 'lazy', alt: '', src: library.swatchUrl(t.id) }), el('span', { textContent: t.name }));
            // (With Mix on, or with Shift, a click puts it in the mix or takes it out: mixpanel.js.)
            b.onclick = e => {
                if (!mixClick(t.id, e.shiftKey)) selectTexture(t.id, false);
            };
            grid.appendChild(b);
        }
        const head = el(
            'button',
            { type: 'button', className: 'category', onclick: () => setCollapsed(toggled(collapsed, category)) },
            el('span', { className: 'chevron', ariaHidden: 'true' }),
            el('span', { className: 'name', textContent: category }),
            el('span', { className: 'count', textContent: String(textures.length), title: `${textures.length} textures` }),
        );
        head.dataset.category = category;
        head.setAttribute('aria-controls', grid.id);
        body.append(el('h4', {}, head), grid);
    });
    selectTexture(paintTexture, false);
    mixLibraryChanged();
}

/** Collapses the Paint panel's categories in `next` (a set of their names) and opens the others, and keeps that in this browser. */
function setCollapsed(next) {
    collapsed = next;
    store.set(COLLAPSED_KEY, writeCollapsed(collapsed));
    showCollapsed();
}

/** Shows each category of the Paint panel open or collapsed as `collapsed` says. A collapsed one keeps the texture painted with. */
function showCollapsed() {
    const categories = [];
    for (const grid of document.querySelectorAll('#paletteBody .swatches')) {
        const category = grid.dataset.category;
        categories.push(category);
        let shown = 0;
        for (const b of grid.querySelectorAll('.swatch')) {
            // (A mix's textures show in its strip, above the categories.)
            b.hidden = swatchHidden(collapsed, category, b.dataset.texture, mixOn() ? null : paintTexture);
            if (!b.hidden) shown++;
        }
        grid.hidden = shown === 0;
        const head = document.querySelector(`#paletteBody .category[aria-controls="${grid.id}"]`);
        head.setAttribute('aria-expanded', String(!collapsed.has(category)));
    }
    if (!$('paletteCollapse')) return;
    $('paletteCollapse').disabled = categories.every(c => collapsed.has(c));
    $('paletteExpand').disabled = !categories.some(c => collapsed.has(c));
}

/** Paints with texture `id`. `reveal` (any route but a click on its swatch) opens its category and scrolls its swatch into view. */
function selectTexture(id, reveal = true) {
    paintTexture = id;
    const category = library.byId.get(id)?.category;
    if (reveal && collapsed.has(category)) setCollapsed(opened(collapsed, category));
    else showCollapsed();
    markSwatches();
    if (reveal) document.querySelector(`#paletteBody .swatch[data-texture="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
    // Start loading it now so the first dab shows at once.
    library.layerPixels(id).catch(() => {});
}

/** Marks the swatches the brush paints with: the mix's with Mix on, else the one texture. */
function markSwatches() {
    const mix = currentMix(),
        on = mixOn();
    const painted = new Set(on ? mix.textures.map(t => t.id) : [paintTexture]);
    for (const b of document.querySelectorAll('#paletteBody .swatch')) b.classList.toggle('active', painted.has(b.dataset.texture));
    showStrengthName();
}

initMixPanel({
    library,
    paintTexture: () => paintTexture,
    changed: () => {
        showCollapsed();
        markSwatches();
    },
});

// The library comes from the engine; it is loaded once /api/me has said whether there is one (see the start, at the end).
async function loadLibrary() {
    if (engine.up && (await library.load())) view.setLibrary(library);
    buildPalette();
    showMissing();
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

/** Picks the texture at area point `p` up: to paint with alone, or with `add` (Shift) into the mix. */
async function pickTexture(p, add = false) {
    const ground = area.textureAt(p.x, p.y);
    if (!ground) return;
    const picked = (id, name) => {
        if (add) {
            mixPicked(id);
            say(`Added ${name} to the mix. Shift-click more ground to add another; Esc ends picking.`);
            return;
        }
        setMixOn(false);
        selectTexture(id);
        say(`Picked ${name}.`);
    };
    if (!ground.startsWith('@import:')) {
        picked(ground, library.byId.get(ground)?.name ?? ground);
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
    picked(r.id, library.byId.get(r.id)?.name ?? r.name);
    if (r.added) say(`${$('statusMsg').textContent} It is in the Tileset textures now.`);
}

// A texture pack installed or removed, or starter textures added (missing.js): the library again, the view's textures, and the
// palette. A texture painted with that left gives way to the default; one the open area lacks shows as missing.
async function libraryChanged() {
    await library.load();
    view.setLibrary(library);
    if (!stillThere(library.catalog, paintTexture)) paintTexture = DEFAULT_TEXTURE;
    buildPalette();
    showMissing();
}
initPacks({ changed: libraryChanged });

initPlace(editor);
initMissingModels({ area: () => area, models });

initImport({ ...editor, openArea });

$('btnOpen').onclick = async () => {
    const list = $('openList');
    list.textContent = 'Loading…';
    $('openDialog').showModal();
    let areas = [];
    let unlisted = [];
    try {
        const answer = await (await api('/api/areas')).json();
        areas = answer.areas ?? [];
        unlisted = unlistedOf(answer);
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
    list.append(...unlistedRows(unlisted));
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

initScatter({ ...editor, busy: currentStroke });
initAmbienceTool({ ...editor, models: () => models, library, saveSoon: () => saveSoon(), say });

initSky({ ...editor, saveSoon });
initUnderlay({ ...editor, saveSoon });
initMenus();

$('btnSky').onclick = () => {
    skyOpen = !skyOpen;
    updatePanels();
};
$('btnUnderlay').onclick = () => {
    underlayOpen = !underlayOpen;
    skyOpen = false;
    updatePanels();
};
$('underlayClose').onclick = () => {
    underlayOpen = false;
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
    mixOn,
    currentMix,
    picking: () => picking,
    setPicking,
    pickTexture,
    library,
    sizeIn,
    strengthIn,
    softnessIn,
    lightPair,
});
initLightTool({ ...editor, night: skyShowsNight, saveSoon: () => saveSoon(), say });

// The Show menu: which kinds of thing are on the map out of the Things tool.
{
    const boxes = [...document.querySelectorAll('#menuShow input[data-kind]')];
    // In the Things tool everything shows, whatever is ticked: the button says so.
    const label = () => {
        $('btnShow').textContent = thingsTool.active ? 'Show: all' : `Show (${thingsTool.shown.size + (sceneryTicked ? 1 : 0)})`;
    };
    const scenery = $('showScenery');
    scenery.checked = sceneryTicked;
    const setScenery = on => {
        scenery.checked = sceneryTicked = on;
        store.set(SCENERY_KEY, on ? 'on' : 'off');
        showScenery();
        label();
    };
    scenery.onchange = () => setScenery(scenery.checked);
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
        setScenery(on);
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
    canvasShown(a);
    $('areaInfo').textContent = `${a.canvas ? 'canvas ' : ''}${a.name} · ${a.tiles}×${a.tilesY} tiles (${a.sizeX}×${a.sizeY} m)`;
    $('areaInfo').title = $('areaInfo').textContent;
    piecesShown(a);
    $('report').hidden = true;
    showAreaSky(a);
    showMissing();
    if (tool === 'entrance' && !skyOpen) showEntrances();
    if (tool === 'ambience' && !skyOpen) showAmbienceTool();
    if (tool === 'light' && !skyOpen) showLightTool();
    if (!blank) checkSoon();
    showMissingModels();
    underlayAreaChanged();
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
    showNoGame(engine.up && me.game === false, !!me.stock);
    showVersion(engine.up ? me.version : null);
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
    for (const id of ['btnExport', 'btnCheck', 'btnImport', 'btnDelete', 'btnShowcase']) if ($(id)) $(id).disabled = readOnly;
    $('btnActivity').hidden = !(me.team && me.admin);
    $('sepFile').hidden = $('btnActivity').hidden;
    $('btnVersion').hidden = !(me.team && me.versions);
    // Publish opens pull requests through a review service when there is one; without it, it makes a package to download.
    // (Not in the browser: a package is a module's source files for a team, and the page's export is its download.)
    $('btnPublish').hidden = !((me.team && me.publish) || me.package) || web.on;
    $('btnPublish').querySelector('span').textContent = me.package ? 'Package for your module…' : 'Publish to the team…';
    // Its dialog says the same: a package to download, or pull requests for the team.
    $('pubTitle').textContent = me.package ? 'Package for your module' : 'Publish to the team';
    $('pubGo').textContent = me.package ? 'Download the package' : 'Open the pull requests';
    $('btnPublish').disabled = readOnly;
    $('btnVersion').disabled = readOnly;
    if (area?.canvas) canvasShown(area);
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
initPublish({ ...editor, flushSave });
initScripts(editor);

// Save a version, Delete area, and autosave (save.js).
initSave({ ...editor, open: name => openArea({ name }, false), blank: showBlank });
initCanvas({ ...editor, setArea, flushSave, saveSoon: () => saveSoon() });
initPieces({ ...editor, flushSave, saveSoon: () => saveSoon() });

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
    if (area.band) view.markBand();
    for (const e of change.entrances) view.markEntrance(e);
    view.updateEntrances();
    view.syncObjects();
    view.updateShade(change.shadow);
    view.updateWater();
    view.syncPalette();
    thingsTool.refreshAll();
    // (its rows hold the entrances they were drawn for, which undo and redo replace with copies)
    if (tool === 'entrance' && !skyOpen) showEntrances();
    view.updateAmbience();
    if (tool === 'ambience' && !skyOpen) showAmbienceTool();
    view.updateLights();
    if (tool === 'light' && !skyOpen) showLightTool();
    refreshSky();
    showMissing();
    saveSoon();
}
initMissing({ ...editor, library, refresh: refreshAll, reload: libraryChanged });
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
        $('btnHeightmap').hidden = !area || area.enclosed();
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
initShowcase({ setArea });

// The engine in this browser (webdemo.js): Download area, Open area from a file, Help's source link.
initWebDemo({ area: () => area, setArea });

// Import heightmap (heightmap.js): the whole ground changes, so all of it is redrawn and saved.
initHeightmap({
    area: () => area,
    readOnly: () => readOnly,
    changed: () => {
        area.lastChange = null;
        refreshAll();
    },
});

initExport({ ...editor, flushSave });

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
    // Not while typing or choosing (a box, a list, a text area, an editor, a dialog; a slider's or radio button's own keys).
    if (keyBelongsTo(e.target, e)) return;
    // Letters work with Caps Lock on: the shortcuts compare lower case (Ctrl+Shift+Z still reads e.key's capital).
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // The camera: arrows move along the ground, Shift+arrows turn the view, + and - zoom, Home looks straight down (F frames).
    if (!moving() && !e.ctrlKey && !e.metaKey && !e.altKey && cameraKey(e)) {
        e.preventDefault();
        return;
    }
    // Escape stops the underlay's move or measure, then closes its panel.
    if (e.key === 'Escape' && underlayEscape()) return;
    if (e.key === 'Escape' && underlayOpen) {
        underlayOpen = false;
        updatePanels();
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
    else if (key === 'u') toggleUnderlay();
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
// (the particle pack's kinds draw the area's placements in their colours)
if (engine.up) loadParticles();
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
        const rest = new URLSearchParams(location.search);
        rest.delete('review');
        history.replaceState(null, '', `${location.pathname}${rest.size ? `?${rest}` : ''}`);
    }
}
// (the copies kept in this browser, read before anything asks for one)
await loadCopies();
if (!readOnly) await moveBrowserAreas();
{
    // (the browser page's ?area= link, from the showcase: that area instead of the last one)
    let linked = null;
    let linkFailed = null;
    try {
        linked = await linkedArea();
    } catch (err) {
        linkFailed = err;
    }
    const current = reviewArea ?? (readOnly ? null : lastOpen());
    const local = !reviewArea && current && browserCopy(current);
    // The engine's copy when it has one, with its version: without it, Delete took the area for one saved from another tab
    // since, and its next save went unchecked.
    const opened = linked ?? (current ? await openAtStart(current, local) : null);
    if (opened) setArea(opened);
    else showBlank();
    if (linked) noteOpen(linked.name);
    if (linkFailed) showError(linkFailed.message, "Couldn't open the area");
}
