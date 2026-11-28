// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Pieces mode and Open piece (the engine's docs/DESIGN-canvas-cut.md, question 11, mock-ups 1 to 3). Pieces mode shows the
// canvas from above, flat, so a cut lands on a tile line where the builder sees it; the 3D view stays for sculpting. Open piece
// draws one piece and an 8-tile ring of its neighbours at full detail, the ring dimmed, all of it editable, so a brush crosses
// a cut without the builder thinking about it.

import * as THREE from 'three';
import { SPACING, TILE } from './area.js';
import { api, engine, failure, json, NEEDS_ENGINE } from './api.js';
import { $, el, say } from './dom.js';
import {
    PIECE_MAX,
    PIECE_MIN,
    cut,
    cutNear,
    gapTiles,
    grid,
    join,
    moveCut,
    neighbours,
    pieceAt,
    pieceLabel,
    rectBetween,
    remove,
    rename,
    sameRect,
    whatMoves,
} from './pieces.js';

/** Tiles of neighbouring ground drawn round an open piece (question 1: a 32-tile piece and its ring fill the 48-tile window). */
export const RING = 8;
const PER_TILE = TILE / SPACING;
const UNDO_STEPS = 40;

/** What app.js gives this file: `area()`, `view`, `saveSoon()`, `flushSave()`, `readOnly()`. */
let ctx = null;
const st = {
    mode: 'sculpt',
    tool: 'cut',
    selected: null,
    joinFrom: null,
    drag: null,
    hover: null,
    open: null,
    undo: [],
    redo: [],
    // Each piece's rectangle when the canvas was opened (by id), to tell new and changed pieces from the rest.
    opened: new Map(),
    // The last path check per piece: `{ rect, state, why }`; and the engine's cut (`/api/canvas-cut`), null until asked.
    checks: new Map(),
    cutInfo: null,
    cutAsked: 0,
    picture: null,
};

const area = () => ctx.area();
const canvasOf = () => area()?.canvas ?? null;
const state = () => ({ canvas: area().name, pieces: canvasOf().pieces, nextId: canvasOf().pieceNextId });

export function initPieces(c) {
    ctx = c;
    $('btnModeSculpt').onclick = () => setMode('sculpt');
    $('btnModePieces').onclick = () => setMode('pieces');
    $('btnBackCanvas').onclick = () => closePiece();
    for (const b of document.querySelectorAll('#piecesTools [data-ptool]')) b.onclick = () => setTool(b.dataset.ptool);
    $('gridGo').onclick = makeGrid;
    $('gridAcross').oninput = $('gridUp').oninput = showGridSize;
    $('pieceOpen').onclick = () => st.selected && openPiece(st.selected);
    $('pieceRename').onclick = startRename;
    $('pieceRenameGo').onclick = doRename;
    $('pieceRemove').onclick = removeSelected;
    $('pieceCheck').onclick = () => st.selected && checkPaths([st.selected]);
    $('piecesCheckAll').onclick = () => checkPaths(null);
    $('openCheck').onclick = () => st.open && checkPaths([st.open]);
    const map = $('piecesMap');
    map.addEventListener('pointerdown', down);
    map.addEventListener('pointermove', move);
    map.addEventListener('pointerup', up);
    map.addEventListener('pointerleave', () => {
        st.hover = null;
        if (!st.drag) draw();
    });
    map.addEventListener('dblclick', e => {
        const p = pieceUnder(e);
        if (p) openPiece(p.name);
    });
    $('smallMap').addEventListener('click', e => {
        const r = $('smallMap').getBoundingClientRect(),
            m = st.small;
        if (!m) return;
        const tx = (e.clientX - r.left - m.ox) / m.s,
            ty = (m.oy - (e.clientY - r.top)) / m.s;
        const p = pieceAt(canvasOf().pieces, tx * TILE, ty * TILE);
        if (p && p.name !== st.open) openPiece(p.name);
    });
    new ResizeObserver(() => st.mode === 'pieces' && draw()).observe($('piecesMapBox'));
    // Undo and redo in Pieces mode undo cut changes: each one is a step (question 7). (Ahead of the buttons' own handlers,
    // which undo the ground.)
    document.addEventListener(
        'click',
        e => {
            const b = st.mode === 'pieces' && e.target.closest?.('#btnUndo, #btnRedo');
            if (!b) return;
            e.stopPropagation();
            if (b.id === 'btnUndo') undoPieces();
            else redoPieces();
        },
        true,
    );
    addEventListener('keydown', e => {
        if (st.mode !== 'pieces' || e.target.closest?.('input, textarea, dialog')) return;
        if (e.key === 'Escape' && st.drag) {
            st.drag = null;
            say('The cut stays where it was.');
            showPanel();
            draw();
        } else if (e.key === 'Enter' && st.selected) openPiece(st.selected);
        else if (e.key === 'Delete' && st.selected) removeSelected();
    });
}

const view = () => ctx.view;

/** The open area changed to `a`: the mode buttons show for a canvas, which opens on its sculpt view. */
export function piecesShown(a) {
    $('modeSwitch').hidden = !a.canvas;
    st.selected = st.joinFrom = st.drag = st.open = null;
    st.undo = [];
    st.redo = [];
    st.checks = new Map();
    st.cutInfo = null;
    st.picture = null;
    st.opened = new Map((a.canvas?.pieces ?? []).map(p => [p.id, { ...p }]));
    setOpenChrome(null);
    setMode('sculpt', true);
}

function setMode(mode, quiet = false) {
    if (mode === 'pieces' && !canvasOf()) return;
    if (mode === 'pieces' && st.open) closePiece(true);
    st.mode = mode;
    document.body.classList.toggle('pieces-mode', mode === 'pieces');
    $('piecesMode').hidden = mode !== 'pieces';
    view().covered = mode === 'pieces';
    for (const [id, m] of [
        ['btnModeSculpt', 'sculpt'],
        ['btnModePieces', 'pieces'],
    ]) {
        $(id).classList.toggle('active', mode === m);
        $(id).setAttribute('aria-pressed', String(mode === m));
    }
    if (mode !== 'pieces') return;
    area().settleChanges?.();
    st.picture = null;
    st.selected ??= canvasOf().pieces[0]?.name ?? null;
    showPanel();
    draw();
    askCut();
    if (!quiet) say(hint());
}

function setTool(t) {
    if (t === 'grid') {
        $('gridForm').hidden = !$('gridForm').hidden;
        showGridSize();
        return;
    }
    st.tool = t;
    st.joinFrom = t === 'join' ? st.selected : null;
    for (const b of document.querySelectorAll('#piecesTools [data-ptool]')) b.classList.toggle('active', b.dataset.ptool === t);
    say(hint());
    draw();
}

const hint = () =>
    st.tool === 'join'
        ? st.joinFrom
            ? `Join · click the piece to join to ${label(st.joinFrom)}`
            : 'Join · click a piece, then the one beside it to join them'
        : st.tool === 'move'
          ? 'Move a cut · drag a cut line; it snaps to tiles · Esc puts it back'
          : 'Pieces · drag to cut on tile lines · drag a cut to move it · double-click to open';

const label = name => {
    const p = canvasOf().pieces.find(q => q.name === name);
    return p ? pieceLabel(p) : name;
};

// --- Changes, with undo -----------------------------------------------------------------------------------------------

/** Makes `next` (`{ pieces, nextId }`) the canvas's pieces, as one undo step, and saves. */
function commit(next, message) {
    const c = canvasOf();
    st.undo.push({ pieces: c.pieces, nextId: c.pieceNextId, selected: st.selected });
    if (st.undo.length > UNDO_STEPS) st.undo.shift();
    st.redo = [];
    // (by number: the engine's canvas starts at the first piece unless told otherwise)
    c.pieces = [...next.pieces].sort((a, b) => a.id - b.id);
    c.pieceNextId = Math.max(c.pieceNextId, next.nextId);
    changed(message);
}

function changed(message) {
    if (st.selected && !canvasOf().pieces.some(p => p.name === st.selected)) st.selected = canvasOf().pieces[0]?.name ?? null;
    ctx.saveSoon();
    setOpenChrome(null);
    st.cutInfo = null;
    askCut(1500);
    showPanel();
    draw();
    if (message) say(message);
}

function undoPieces() {
    const s = st.undo.pop();
    if (!s) return say('Nothing to undo in the pieces.');
    const c = canvasOf();
    st.redo.push({ pieces: c.pieces, nextId: c.pieceNextId, selected: st.selected });
    c.pieces = s.pieces;
    st.selected = s.selected;
    changed('Undone.');
}

function redoPieces() {
    const s = st.redo.pop();
    if (!s) return say('Nothing to redo in the pieces.');
    const c = canvasOf();
    st.undo.push({ pieces: c.pieces, nextId: c.pieceNextId, selected: st.selected });
    c.pieces = s.pieces;
    c.pieceNextId = Math.max(c.pieceNextId, s.nextId);
    st.selected = s.selected;
    changed('Redone.');
}

function makeGrid() {
    const a = area(),
        r = grid(state(), Math.round(+$('gridAcross').value), Math.round(+$('gridUp').value), a.tiles, a.tilesY);
    if (r.error) {
        $('gridMsg').textContent = r.error;
        return;
    }
    $('gridForm').hidden = true;
    commit(r, `A grid of ${r.pieces.length} pieces.`);
    st.selected = r.pieces[0]?.name ?? null;
    showPanel();
}

function showGridSize() {
    const a = area(),
        across = Math.max(1, Math.round(+$('gridAcross').value) || 1),
        up = Math.max(1, Math.round(+$('gridUp').value) || 1);
    const w = Math.ceil(a.tiles / across),
        h = Math.ceil(a.tilesY / up),
        even = a.tiles % across === 0 && a.tilesY % up === 0;
    const n = canvasOf().pieces.length;
    $('gridSize').textContent = `${w}×${h} tiles${even ? ' (the canvas split evenly)' : ' at most'}`;
    $('gridReplaces').textContent = n
        ? `the ${n} piece${n === 1 ? '' : 's'} now; their things go to the new pieces by where they stand`
        : 'nothing: the canvas has no pieces yet';
    $('gridMsg').textContent =
        w > PIECE_MAX || h > PIECE_MAX ? `That makes pieces ${Math.max(w, h)} tiles a side; the game takes ${PIECE_MAX} at most.` : '';
}

function startRename() {
    const p = canvasOf().pieces.find(q => q.name === st.selected);
    if (!p) return;
    $('renameForm').hidden = false;
    $('renameName').value = p.name;
    $('renameGame').value = p.settings?.name ?? '';
    $('renameMsg').textContent = '';
    $('renameName').focus();
}

function doRename() {
    const from = st.selected,
        to = $('renameName').value.trim(),
        game = $('renameGame').value.trim();
    const r = rename(state(), from, to);
    if (r.error) {
        $('renameMsg').textContent = r.error;
        return;
    }
    r.pieces = r.pieces.map(p => {
        if (p.name !== to) return p;
        const settings = { ...(p.settings ?? {}) };
        if (game) settings.name = game;
        else delete settings.name;
        return { ...p, settings: Object.keys(settings).length ? settings : undefined };
    });
    $('renameForm').hidden = true;
    st.selected = to;
    commit(r, from === to ? `${to}'s name in the game is ${game || 'its own'}.` : `Renamed ${from} to ${to}.`);
}

function removeSelected() {
    const name = st.selected;
    if (!name) return;
    const moves = whatMoves(area(), canvasOf().pieces, remove(state(), name).pieces);
    commit(
        remove(state(), name),
        `${label(name)} is a gap now: not exported${moves.length ? `, with ${moves.length} kind${moves.length === 1 ? '' : 's'} of thing in it` : ''}. Undo brings it back.`,
    );
}

// --- The map ----------------------------------------------------------------------------------------------------------

/** Where the canvas sits on the map: `s` pixels a tile, tile (0, 0)'s corner at (ox, oy) (north up). */
function layout(w, h) {
    const a = area(),
        pad = 22,
        s = Math.max(1, Math.min((w - 2 * pad) / a.tiles, (h - 2 * pad) / a.tilesY));
    const ox = Math.round((w - a.tiles * s) / 2),
        oy = Math.round((h + a.tilesY * s) / 2);
    return { s, ox, oy };
}

/** The pointer's place on the map, in tiles (fractions kept). */
function tileOf(e) {
    const r = $('piecesMap').getBoundingClientRect(),
        { s, ox, oy } = st.lay;
    return [(e.clientX - r.left - ox) / s, (oy - (e.clientY - r.top)) / s];
}

function pieceUnder(e) {
    const [tx, ty] = tileOf(e);
    return pieceAt(canvasOf().pieces, tx * TILE, ty * TILE);
}

const snap = (v, n) => Math.max(0, Math.min(n, Math.round(v)));

function down(e) {
    if (e.button !== 0 || ctx.readOnly()) return;
    const a = area(),
        [tx, ty] = tileOf(e),
        pieces = canvasOf().pieces;
    const p = pieceUnder(e);
    if (st.tool === 'join') {
        if (!p) return;
        if (!st.joinFrom || st.joinFrom === p.name) {
            st.joinFrom = st.selected = p.name;
            showPanel();
            say(hint());
            draw();
            return;
        }
        const r = join(state(), st.joinFrom, p.name, a.tiles, a.tilesY);
        if (r.error) return say(r.error);
        st.selected = r.made.name;
        st.joinFrom = null;
        commit(r, `Joined into ${pieceLabel(r.made)}: ${r.made.w}×${r.made.h} tiles.`);
        return;
    }
    const c = cutNear(pieces, tx, ty, Math.max(0.35, 8 / st.lay.s));
    $('piecesMap').setPointerCapture(e.pointerId);
    const from = [snap(tx, a.tiles), snap(ty, a.tilesY)];
    // On a cut with the Cut tool, the drag's direction decides: across the cut moves it, any other way cuts from here.
    if (c && st.tool === 'cut') st.drag = { kind: 'either', cut: c, from, at: [e.clientX, e.clientY], select: p?.name ?? null };
    else if (c) st.drag = { kind: 'move', cut: c, to: c.k, at: [e.clientX, e.clientY], moved: false };
    else if (st.tool === 'cut') st.drag = { kind: 'cut', from: [snap(tx, a.tiles), snap(ty, a.tilesY)], to: null, select: p?.name ?? null };
    else if (p) {
        st.selected = p.name;
        showPanel();
        draw();
    }
}

function move(e) {
    const a = area(),
        [tx, ty] = tileOf(e);
    st.hover = { tx, ty };
    let d = st.drag;
    if (d?.kind === 'either') {
        const dx = e.clientX - d.at[0],
            dy = e.clientY - d.at[1];
        if (Math.hypot(dx, dy) < 6) return;
        const [across, along] = d.cut.axis === 'x' ? [Math.abs(dx), Math.abs(dy)] : [Math.abs(dy), Math.abs(dx)];
        d = st.drag =
            across > 4 * along
                ? { kind: 'move', cut: d.cut, to: d.cut.k, at: d.at, moved: false }
                : { kind: 'cut', from: d.from, to: null, select: d.select };
    }
    if (d?.kind === 'cut') {
        d.to = [snap(tx, a.tiles), snap(ty, a.tilesY)];
        showDragPanel();
    } else if (d?.kind === 'move') {
        const to = d.cut.axis === 'x' ? snap(tx, a.tiles) : snap(ty, a.tilesY);
        if (to !== d.to || !d.moved) {
            d.to = to;
            d.moved ||= Math.hypot(e.clientX - d.at[0], e.clientY - d.at[1]) > 3;
            d.result = moveCut(state(), d.cut, to, a.tiles, a.tilesY);
            showDragPanel();
        }
    } else {
        const c = canvasOf().pieces.length && st.tool !== 'join' ? cutNear(canvasOf().pieces, tx, ty, Math.max(0.35, 8 / st.lay.s)) : null;
        $('piecesMap').style.cursor = c ? (c.axis === 'x' ? 'ew-resize' : 'ns-resize') : st.tool === 'join' ? 'pointer' : 'crosshair';
        const p = pieceAt(canvasOf().pieces, tx * TILE, ty * TILE);
        const inside = tx >= 0 && ty >= 0 && tx <= a.tiles && ty <= a.tilesY;
        $('statusPos').textContent = inside
            ? `${hint()} · tile ${Math.floor(tx)},${Math.floor(ty)} ${p ? `in ${pieceLabel(p)}` : 'in a gap (not exported)'}`
            : hint();
    }
    draw();
}

function up(e) {
    const d = st.drag;
    st.drag = null;
    if (!d) return;
    $('piecesMap').releasePointerCapture?.(e.pointerId);
    const a = area();
    if (d.kind === 'either') {
        if (d.select) st.selected = d.select;
        showPanel();
        return draw();
    }
    if (d.kind === 'cut') {
        const r = d.to && rectBetween(d.from, d.to);
        if (!r || r.w === 0 || r.h === 0) {
            // A click: selects the piece under it.
            if (d.select) st.selected = d.select;
            showPanel();
            return draw();
        }
        const res = cut(state(), r, a.tiles, a.tilesY);
        if (res.error) {
            showPanel();
            draw();
            return say(res.error);
        }
        st.selected = res.made.name;
        commit(res, `Cut out ${pieceLabel(res.made)}: ${res.made.w}×${res.made.h} tiles.`);
        return;
    }
    if (!d.moved || d.to === d.cut.k) {
        const p = pieceUnder(e);
        if (p) st.selected = p.name;
        showPanel();
        return draw();
    }
    if (d.result?.error) {
        showPanel();
        draw();
        return say(`${d.result.error} The cut stays where it was.`);
    }
    const moves = whatMoves(a, canvasOf().pieces, d.result.pieces);
    commit(d.result, `Moved the cut to ${d.cut.axis} = ${d.to}${moves.length ? `: ${movesShort(moves)} changed piece, tags kept` : ''}.`);
}

/** The ground as a picture, a pixel every QUARTER samples (2.5 m): the paint's colour shaded by the slope, water and chasms. */
function picture() {
    if (st.picture) return st.picture;
    const a = area(),
        step = 4,
        w = (a.nx - 1) / step + 1,
        h = (a.ny - 1) / step + 1;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d'),
        img = g.createImageData(w, h),
        d = img.data;
    const hs = a.heights,
        nx = a.nx;
    for (let cj = 0; cj < h; cj++)
        for (let ci = 0; ci < w; ci++) {
            const i = ci * step,
                j = cj * step,
                k = j * nx + i;
            const e = hs[j * nx + Math.min(nx - 1, i + step)] - hs[j * nx + Math.max(0, i - step)],
                n = hs[Math.min(a.ny - 1, j + step) * nx + i] - hs[Math.max(0, j - step) * nx + i];
            // Lit from the north-west, as the 3D view's sun mostly is.
            const shade = Math.max(0.5, Math.min(1.35, 1 + (-e + n) * 0.14));
            let r = 140,
                gg = 150,
                b = 96;
            const mat = a.palette[a.materials[k]] ?? '';
            if (/rock|cliff|stone/i.test(mat)) [r, gg, b] = [128, 124, 112];
            else if (/sand|dirt|road|mud/i.test(mat)) [r, gg, b] = [150, 132, 96];
            else if (/snow/i.test(mat)) [r, gg, b] = [222, 226, 232];
            else if (/dark|forest|moss/i.test(mat)) [r, gg, b] = [106, 124, 76];
            if (!a.walkable(i, j)) [r, gg, b] = [r * 0.85 + 20, gg * 0.85 + 16, b * 0.85 + 14];
            const o = ((h - 1 - cj) * w + ci) * 4;
            if (a.chasm?.[k]) [r, gg, b] = [28, 26, 24];
            else if (!Number.isNaN(a.waterLevel[k])) {
                const deep = Math.min(1, (a.waterLevel[k] - hs[k]) / 3);
                [r, gg, b] = [70 - 30 * deep, 120 - 40 * deep, 168 - 30 * deep];
                d.set([r, gg, b, 255], o);
                continue;
            }
            d.set([r * shade, gg * shade, b * shade, 255], o);
        }
    g.putImageData(img, 0, 0);
    st.picture = cv;
    return cv;
}

/** Draws the map: the ground, gaps hatched, each piece with its name and size, and what a drag would do. */
function draw() {
    if (st.mode !== 'pieces') return;
    const cv = $('piecesMap'),
        box = $('piecesMapBox'),
        dpr = devicePixelRatio || 1,
        W = box.clientWidth,
        H = box.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
    }
    const g = cv.getContext('2d'),
        a = area();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    st.lay = layout(W, H);
    const { s, ox, oy } = st.lay;
    const px = (tx, ty) => [ox + tx * s, oy - ty * s];
    const rect = p => [ox + p.x * s, oy - (p.y + p.h) * s, p.w * s, p.h * s];
    g.imageSmoothingEnabled = true;
    g.drawImage(picture(), ox, oy - a.tilesY * s, a.tiles * s, a.tilesY * s);
    // What the drag would make, drawn in place of the pieces it changes.
    const d = st.drag;
    let pieces = canvasOf().pieces;
    let was = null;
    if (d?.kind === 'move' && d.moved && d.result) {
        pieces = d.result.pieces;
        was = new Map(canvasOf().pieces.map((p, n) => [pieces[n], p]));
    }
    // Gaps: hatched, darker.
    g.save();
    g.beginPath();
    g.rect(ox, oy - a.tilesY * s, a.tiles * s, a.tilesY * s);
    for (const p of pieces) g.rect(...rect(p));
    g.clip('evenodd');
    g.fillStyle = 'rgba(20, 24, 28, 0.45)';
    g.fillRect(ox, oy - a.tilesY * s, a.tiles * s, a.tilesY * s);
    g.strokeStyle = 'rgba(230, 233, 238, 0.22)';
    g.lineWidth = 1;
    g.beginPath();
    for (let k = -a.tilesY * s; k < a.tiles * s; k += 9) {
        g.moveTo(ox + k, oy);
        g.lineTo(ox + k + a.tilesY * s, oy - a.tilesY * s);
    }
    g.stroke();
    g.restore();
    // The things on the canvas: entrances, game objects and things, small, so a cut can be put clear of them.
    drawContents(g, px);
    // The strip a moving cut sweeps.
    if (d?.kind === 'move' && d.moved && d.to !== d.cut.k) {
        const [lo, hi] = [Math.min(d.to, d.cut.k), Math.max(d.to, d.cut.k)];
        g.fillStyle = d.result?.error ? 'rgba(255, 106, 85, 0.22)' : 'rgba(216, 162, 74, 0.28)';
        if (d.cut.axis === 'x') {
            const [x0, y0] = px(lo, d.cut.span[1]);
            g.fillRect(x0, y0, (hi - lo) * s, (d.cut.span[1] - d.cut.span[0]) * s);
        } else {
            const [x0, y0] = px(d.cut.span[0], hi);
            g.fillRect(x0, y0, (d.cut.span[1] - d.cut.span[0]) * s, (hi - lo) * s);
        }
    }
    for (const p of pieces) {
        const sel = p.name === st.selected || p.name === st.joinFrom,
            wrong = tooBig(p);
        g.lineWidth = sel ? 2.5 : 1.5;
        g.strokeStyle = wrong ? '#ff6a55' : sel ? '#d8a24a' : 'rgba(240, 228, 170, 0.9)';
        if (sel) {
            g.fillStyle = 'rgba(216, 162, 74, 0.14)';
            g.fillRect(...rect(p));
        }
        const [x, y, w, h] = rect(p);
        g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    // A cut under the pointer, or being dragged.
    const c =
        d?.kind === 'move'
            ? { ...d.cut, k: d.to }
            : st.hover && !d && st.tool !== 'join'
              ? cutNear(canvasOf().pieces, st.hover.tx, st.hover.ty, Math.max(0.35, 8 / s))
              : null;
    if (c) {
        g.strokeStyle = d?.result?.error ? '#ff6a55' : '#d8a24a';
        g.lineWidth = 4;
        g.beginPath();
        if (c.axis === 'x') {
            g.moveTo(...px(c.k, c.span[0]));
            g.lineTo(...px(c.k, c.span[1]));
        } else {
            g.moveTo(...px(c.span[0], c.k));
            g.lineTo(...px(c.span[1], c.k));
        }
        g.stroke();
    }
    for (const p of pieces) drawLabel(g, p, rect(p), was?.get(p));
    // A cut being drawn.
    if (d?.kind === 'cut' && d.to) {
        const r = rectBetween(d.from, d.to);
        if (r.w && r.h) {
            const [x, y, w, h] = rect(r);
            const over = r.w > PIECE_MAX || r.h > PIECE_MAX;
            g.setLineDash([6, 4]);
            g.lineWidth = 2;
            g.strokeStyle = over ? '#ff6a55' : '#d8a24a';
            g.fillStyle = over ? 'rgba(255, 106, 85, 0.18)' : 'rgba(216, 162, 74, 0.18)';
            g.fillRect(x, y, w, h);
            g.strokeRect(x, y, w, h);
            g.setLineDash([]);
            tip(g, x + w / 2, y - 8, `${r.w}×${r.h} tiles`, over ? `over ${PIECE_MAX}: the game takes ${PIECE_MAX} at most` : null);
        }
    }
    if (d?.kind === 'move' && d.moved) {
        const [x, y] = d.cut.axis === 'x' ? px(d.to, (d.cut.span[0] + d.cut.span[1]) / 2) : px((d.cut.span[0] + d.cut.span[1]) / 2, d.to);
        tip(g, x, y - 40, `Cut at ${d.cut.axis} = ${d.to} (snapped to a tile)`, d.result?.error ?? null);
    }
    // North.
    g.fillStyle = 'rgba(38, 44, 52, 0.92)';
    const nx0 = ox + a.tiles * s - 34,
        ny0 = oy - 40;
    g.beginPath();
    g.roundRect(nx0, ny0, 28, 34, 5);
    g.fill();
    g.fillStyle = '#e6e9ee';
    g.font = '600 11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('N', nx0 + 14, ny0 + 13);
    g.fillStyle = '#d8a24a';
    g.beginPath();
    g.moveTo(nx0 + 14, ny0 + 17);
    g.lineTo(nx0 + 19, ny0 + 29);
    g.lineTo(nx0 + 14, ny0 + 26);
    g.lineTo(nx0 + 9, ny0 + 29);
    g.fill();
    // The scale along the top: 0 and the canvas's width in tiles.
    g.fillStyle = '#9aa4b2';
    g.font = '11px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText('0', ox, oy - a.tilesY * s - 6);
    g.textAlign = 'right';
    g.fillText(String(a.tiles), ox + a.tiles * s, oy - a.tilesY * s - 6);
}

function drawContents(g, px) {
    const a = area(),
        dot = (x, y, colour, shape) => {
            const [sx, sy] = px(x / TILE, y / TILE);
            g.fillStyle = colour;
            g.strokeStyle = 'rgba(0,0,0,0.6)';
            g.lineWidth = 1;
            g.beginPath();
            if (shape === 'square') g.rect(sx - 3, sy - 3, 6, 6);
            else if (shape === 'triangle') {
                g.moveTo(sx, sy - 4);
                g.lineTo(sx + 4, sy + 3);
                g.lineTo(sx - 4, sy + 3);
                g.closePath();
            } else g.arc(sx, sy, 3, 0, Math.PI * 2);
            g.fill();
            g.stroke();
        };
    for (const o of a.objects ?? []) if (!o.baked) dot(o.x, o.y, '#7ec46a', 'square');
    for (const t of a.things ?? []) dot(t.x, t.y, t.kind === 'creature' ? '#ff9a1f' : '#9ac2ff', 'circle');
    for (const e of a.entrances ?? []) dot(e.x, e.y, '#ff9a1f', 'triangle');
}

/** Whether piece `p` is outside the game's limits (while a cut is dragged). */
const tooBig = p => p.w > PIECE_MAX || p.h > PIECE_MAX || p.w < PIECE_MIN || p.h < PIECE_MIN;

/** Piece `p`'s name and size at its middle; `was`, its rectangle before the cut being dragged, shows what changes. */
function drawLabel(g, p, [x, y, w, h], was) {
    const name = pieceLabel(p),
        wrong = tooBig(p),
        resized = was && !sameRect(was, p);
    const sub = wrong
        ? `${p.w}×${p.h}: too ${p.w > PIECE_MAX || p.w < PIECE_MIN ? 'wide' : 'tall'}`
        : resized
          ? `${p.w}×${p.h} (was ${was.w}×${was.h})`
          : `${p.w}×${p.h} · ${p.name}`;
    g.font = '700 13px system-ui, sans-serif';
    const w1 = g.measureText(name).width;
    g.font = '11px system-ui, sans-serif';
    const w2 = g.measureText(sub).width,
        bw = Math.max(w1, w2) + 16;
    if (bw > w - 4 || h < 40) {
        // (too small for its label: the name only, if even that fits)
        if (w1 + 8 < w && h > 18) {
            g.font = '700 12px system-ui, sans-serif';
            g.textAlign = 'center';
            g.fillStyle = '#e6e9ee';
            g.fillText(name, x + w / 2, y + h / 2 + 4);
        }
        return;
    }
    const cx = x + w / 2,
        cy = y + h / 2;
    g.fillStyle = 'rgba(30, 34, 40, 0.86)';
    g.beginPath();
    g.roundRect(cx - bw / 2, cy - 19, bw, 36, 4);
    g.fill();
    g.textAlign = 'center';
    g.font = '700 13px system-ui, sans-serif';
    g.fillStyle = wrong ? '#ff6a55' : p.name === st.selected ? '#d8a24a' : '#e6e9ee';
    g.fillText(name, cx, cy - 3);
    g.font = '11px system-ui, sans-serif';
    g.fillStyle = wrong ? '#ff6a55' : '#9aa4b2';
    g.fillText(sub, cx, cy + 12);
}

function tip(g, x, y, line, warn) {
    g.font = '12px system-ui, sans-serif';
    const w = Math.max(g.measureText(line).width, warn ? g.measureText(warn).width : 0) + 16,
        h = warn ? 38 : 22;
    const W = $('piecesMapBox').clientWidth,
        left = Math.max(4, Math.min(W - w - 4, x - w / 2)),
        top = Math.max(4, y - h);
    g.fillStyle = 'rgba(20, 23, 28, 0.94)';
    g.beginPath();
    g.roundRect(left, top, w, h, 4);
    g.fill();
    g.textAlign = 'left';
    g.fillStyle = '#e6e9ee';
    g.fillText(line, left + 8, top + 15);
    if (warn) {
        g.fillStyle = '#ff6a55';
        g.fillText(warn, left + 8, top + 31);
    }
}

// --- The side panel ---------------------------------------------------------------------------------------------------

/** A piece's state for the list: its last check while its rectangle hasn't changed since, else new or changed. */
function stateOf(p) {
    const refused = st.cutInfo?.pieces?.find(q => q.name === p.name)?.refused;
    if (refused) return ['refused', 'bad', refused];
    const ch = st.checks.get(p.name);
    if (ch && sameRect(ch.rect, p)) return [ch.state, ch.state === 'checked' ? 'good' : 'bad', ch.why];
    const was = st.opened.get(p.id);
    if (!was) return ['new', 'new', 'Made since the canvas was opened'];
    if (!sameRect(was, p) || was.name !== p.name) return ['changed', 'warn', 'Its rectangle or name changed since the canvas was opened'];
    return ['not checked', 'new', 'Check paths to see whether players can walk in and across'];
}

function showPanel() {
    if (st.mode !== 'pieces') return;
    const a = area(),
        pieces = canvasOf().pieces,
        total = a.tiles * a.tilesY,
        gap = gapTiles(pieces, a.tiles, a.tilesY);
    $('piecesTitle').textContent = 'Pieces';
    $('piecesSummary').textContent = pieces.length
        ? `${(total - gap).toLocaleString('en')} of ${total.toLocaleString('en')} tiles${gap ? '; hatched ground is not exported' : ''}`
        : 'none yet: drag across the ground to cut one, or make a grid';
    for (const b of document.querySelectorAll('#piecesTools [data-ptool]')) b.classList.toggle('active', b.dataset.ptool === st.tool);
    $('piecesDrag').hidden = true;
    $('piecesNormal').hidden = false;
    const list = $('piecesList');
    list.textContent = '';
    const sorted = [...pieces].sort((p, q) => q.y + q.h - (p.y + p.h) || p.x - q.x);
    for (const p of sorted) {
        const [text, kind, why] = stateOf(p);
        const row = el(
            'button',
            { type: 'button', className: `piece-row${p.name === st.selected ? ' active' : ''}`, title: why ?? '' },
            el('span', { className: 'piece-name', textContent: pieceLabel(p) }),
            el('code', { textContent: p.name }),
            el('span', { className: 'piece-size', textContent: `${p.w}×${p.h}` }),
            el('span', { className: `chip ${kind}`, textContent: text }),
        );
        row.onclick = () => {
            st.selected = p.name;
            if (st.tool === 'join') st.joinFrom = p.name;
            showPanel();
            draw();
        };
        row.ondblclick = () => openPiece(p.name);
        list.append(row);
    }
    showDetails();
}

function showDetails() {
    const p = canvasOf().pieces.find(q => q.name === st.selected);
    $('pieceDetails').hidden = !p;
    $('renameForm').hidden = true;
    if (!p) return;
    $('pieceTitle').textContent = pieceLabel(p);
    $('pieceGame').textContent = p.settings?.name || `${p.name} (no name of its own yet)`;
    $('pieceTag').textContent = `${p.settings?.tag || p.name} · ${p.name} (kept on re-cuts)`;
    $('pieceTiles').textContent = `x ${p.x}–${p.x + p.w}, y ${p.y}–${p.y + p.h} (${p.w}×${p.h})`;
    const joins = $('pieceJoins');
    joins.textContent = '';
    const near = neighbours(canvasOf().pieces, p);
    const by = new Map();
    for (const n of near) by.set(n.side, [...(by.get(n.side) ?? []), `${pieceLabel(n.piece)} ${n.tiles} tile${n.tiles === 1 ? '' : 's'}`]);
    for (const [side, list] of by)
        joins.append(el('div', { textContent: `${side[0].toUpperCase()}${side.slice(1)}: ${list.join(' · ')}` }));
    const crossings = st.cutInfo?.crossings?.filter(x => x.from === p.name);
    joins.append(
        el('div', {
            className: 'muted',
            textContent: `${crossings ? `${crossings.length} crossing${crossings.length === 1 ? '' : 's'}; ` : ''}${near.length} neighbour${near.length === 1 ? '' : 's'}`,
        }),
    );
    if (!near.length) joins.firstChild?.before(el('div', { textContent: 'None: no piece shares a side with it.' }));
    const ch = st.checks.get(p.name);
    $('pieceCheckOut').textContent = ch && sameRect(ch.rect, p) ? ch.why : '';
}

/** The side panel while a cut is dragged: the rectangle, or the cut, what it moves, and why it can't be. */
function showDragPanel() {
    const d = st.drag,
        a = area();
    $('piecesNormal').hidden = true;
    $('piecesDrag').hidden = false;
    const list = $('dragMoves'),
        before = canvasOf().pieces;
    list.textContent = '';
    let after = null,
        error = null;
    if (d.kind === 'cut') {
        const r = d.to && rectBetween(d.from, d.to);
        $('dragTitle').textContent = r?.w && r.h ? `Cutting out ${r.w}×${r.h} tiles` : 'Cutting out a piece';
        if (r?.w && r.h) {
            const res = cut(state(), r, a.tiles, a.tilesY);
            after = res.pieces ?? null;
            error = res.error ?? null;
        }
        $('dragStrip').textContent = r?.w && r.h ? `x ${r.x}–${r.x + r.w}, y ${r.y}–${r.y + r.h}` : '';
    } else {
        const sides = [...new Set(d.cut.members.map(m => pieceLabel(m.p)))];
        $('dragTitle').textContent =
            `Moving the cut ${sides.length > 1 ? `between ${sides.slice(0, -1).join(', ')} and ${sides.at(-1)}` : `of ${sides[0]}`}`;
        after = d.result?.pieces ?? null;
        error = d.result?.error ?? null;
        const [lo, hi] = [Math.min(d.to, d.cut.k), Math.max(d.to, d.cut.k)];
        $('dragStrip').textContent =
            lo === hi ? 'Drag it to a new tile line.' : `This strip (${d.cut.axis} ${lo}–${hi}) would change piece:`;
    }
    const moves = after ? whatMoves(a, before, after) : [];
    for (const m of moves) list.append(moveRow(m));
    if (after && !moves.length) list.append(el('li', { className: 'muted', textContent: 'Nothing on the ground here changes piece.' }));
    $('dragError').hidden = !error;
    $('dragError').textContent = error
        ? `${error} ${d.kind === 'move' ? 'Let go here and it stays where it was.' : 'Let go here and nothing is cut.'}`
        : '';
}

const KIND_COLOUR = { entrance: 'warn', creature: 'warn', placeable: 'good', lake: 'water', chasm: 'muted' };

/** One row of the "what moves" list. */
function moveRow(m) {
    const where = m.to === 'across' ? 'across a cut: refused at export' : `${m.from ?? 'a gap'} → ${m.to ?? 'a gap (not exported)'}`;
    const kids = [el('span', { className: `dot ${KIND_COLOUR[m.kind] ?? 'other'}` })];
    if (m.count) {
        kids.push(`${m.count} ${m.label}${m.count === 1 ? '' : 's'} `);
        if (m.names.length)
            kids.push(el('span', { className: 'muted', textContent: `(${m.names.join(', ')}${m.count > m.names.length ? ', …' : ''}) ` }));
    } else {
        kids.push(`${m.label} `);
        if (m.tag)
            kids.push(
                el('code', { textContent: m.tag }),
                ' ',
                el('span', {
                    className: `chip${m.kind === 'entrance' ? ' warn' : ''}`,
                    textContent: m.kind === 'entrance' ? `door tag ${m.tag} stays` : 'tag kept',
                }),
            );
    }
    if (m.kind === 'lake' || m.kind === 'chasm')
        kids.push(el('span', { className: 'muted', textContent: '(both pieces keep their side of it) ' }));
    kids.push(el('div', { className: 'move-where', textContent: where }));
    return el('li', {}, ...kids);
}

const movesShort = moves =>
    moves.map(m => (m.count ? `${m.count} ${m.label}${m.count === 1 ? '' : 's'}` : m.label.toLowerCase())).join(', ');

// --- The engine: the cut and the path check -------------------------------------------------------------------------

let cutTimer = null;
/** Asks the engine for its cut (crossings, refusals) `wait` ms from now, after the pieces are saved. */
function askCut(wait = 0) {
    clearTimeout(cutTimer);
    if (!engine.up) return;
    cutTimer = setTimeout(async () => {
        try {
            await ctx.flushSave();
            const res = await api(`/api/canvas-cut?name=${encodeURIComponent(area().name)}`);
            if (res.status === 404 && !(await json(res.clone())).error) {
                st.cutInfo = { unsupported: true };
            } else if (res.ok) st.cutInfo = await json(res);
            else st.cutInfo = { error: await failure(res) };
        } catch (err) {
            st.cutInfo = { error: err.message };
        }
        if (st.mode === 'pieces') showPanel();
        if (st.open) showOpenPanel();
        draw();
        drawCrossings();
    }, wait);
}

/**
 * Checks paths in pieces `names` (null: every piece, and across the canvas) with the engine's canvas check (step 4): each
 * piece's own routes, then the pieces joined by their crossings, walked from the start piece.
 */
async function checkPaths(names) {
    if (!engine.up) return say(NEEDS_ENGINE);
    const c = canvasOf();
    if (!c.pieces.length) return say('Cut the canvas into pieces first: Grid… makes an even grid.');
    const out = st.open ? $('openCheckOut') : names ? $('pieceCheckOut') : $('piecesCheckOut');
    const what = names ? names.map(label).join(', ') : `all ${c.pieces.length} pieces`;
    out.textContent = `Checking paths in ${what}…`;
    say(`Checking paths in ${what}… (each piece takes a few seconds)`);
    try {
        await ctx.flushSave();
        const q = names ? `&pieces=${names.map(encodeURIComponent).join(',')}` : '';
        const res = await api(`/api/canvas-check?name=${encodeURIComponent(area().name)}${q}`, { method: 'POST' });
        if (!res.ok) {
            const why =
                res.status === 404 && !(await json(res.clone())).error
                    ? 'This engine has no canvas check yet: it needs the update that cuts canvases.'
                    : await failure(res);
            out.textContent = why;
            return say(`Couldn't check paths: ${why}`);
        }
        const r = await json(res);
        const problems = r.routes?.problems ?? [];
        for (const p of r.pieces ?? []) {
            const piece = c.pieces.find(q => q.name === p.name);
            if (!piece) continue;
            const mine = problems.filter(x => x.piece === p.name);
            const worst = mine.find(x => x.kind === 'no_way_in') ?? mine.find(x => x.kind === 'unreached') ?? mine[0];
            const warn = (p.report?.warnings ?? []).length;
            st.checks.set(p.name, {
                rect: { ...piece },
                state: worst
                    ? worst.kind === 'no_way_in'
                        ? 'no way in'
                        : worst.kind === 'unreached'
                          ? 'unreached'
                          : 'crossing off'
                    : 'checked',
                why: worst ? worst.why : `Paths checked${warn ? `: ${warn} warning${warn === 1 ? '' : 's'}` : ''}.`,
            });
        }
        if (r.crossings) st.cutInfo = { ...(st.cutInfo ?? {}), crossings: r.crossings };
        const reached = r.routes?.reached?.length;
        const sum = problems.length
            ? `${problems.length} problem${problems.length === 1 ? '' : 's'}: ${problems
                  .slice(0, 3)
                  .map(p => `${label(p.piece)}: ${p.why}`)
                  .join(' · ')}`
            : `No problems${reached ? `: ${reached} piece${reached === 1 ? '' : 's'} reached from ${label(r.routes.start)}` : ''}.`;
        out.textContent = sum;
        say(`Checked ${what}. ${sum}`);
    } catch (err) {
        out.textContent = err.message;
    }
    if (st.mode === 'pieces') showPanel();
    if (st.open) showOpenPanel();
    draw();
    drawCrossings();
}

// --- Open piece -------------------------------------------------------------------------------------------------------

/** Opens piece `name`: it and an 8-tile ring of the canvas round it at full detail, the ring dimmed, the camera on it. */
function openPiece(name) {
    const a = area(),
        p = canvasOf().pieces.find(q => q.name === name);
    if (!p) return;
    st.open = name;
    st.selected = name;
    setMode('sculpt', true);
    const x0 = Math.max(0, p.x - RING),
        y0 = Math.max(0, p.y - RING),
        x1 = Math.min(a.tiles, p.x + p.w + RING),
        y1 = Math.min(a.tilesY, p.y + p.h + RING);
    const v = view();
    v.setFocus({ i0: p.x * PER_TILE, i1: (p.x + p.w) * PER_TILE, j0: p.y * PER_TILE, j1: (p.y + p.h) * PER_TILE });
    v.setWindow({ i0: x0 * PER_TILE, j0: y0 * PER_TILE, nx: (x1 - x0) * PER_TILE + 1, ny: (y1 - y0) * PER_TILE + 1 }, true);
    $('btnDetail').hidden = true;
    v.frameOn?.((p.x + p.w / 2) * TILE, (p.y + p.h / 2) * TILE, Math.max(p.w, p.h) * TILE);
    setOpenChrome(p);
    drawOutline();
    drawCrossings();
    showOpenPanel();
    say(`${pieceLabel(p)} open: its neighbours' ground is dimmed round it, and a brush reaches across the cut into theirs.`);
}

/** Back to the canvas: the whole of it, the window following the camera again. */
function closePiece(quiet = false) {
    if (!st.open) return;
    const v = view();
    st.open = null;
    v.setFocus(null);
    v.setWindow(null);
    $('btnDetail').hidden = false;
    $('btnDetail').setAttribute('aria-pressed', 'false');
    $('btnDetail').classList.remove('active');
    setOpenChrome(null);
    drawOutline();
    drawCrossings();
    if (!quiet) setMode('pieces');
}

/** The top bar and the small map while a piece is open (`p`), or the canvas's (null). */
function setOpenChrome(p) {
    const a = area();
    $('btnBackCanvas').hidden = !p;
    $('modeSwitch').hidden = !!p || !a?.canvas;
    $('openPanel').hidden = !p;
    document.body.classList.toggle('piece-open', !!p);
    const info = $('areaInfo');
    if (!a) return;
    info.textContent = '';
    if (p) {
        info.append(
            el('span', { className: 'crumb', textContent: a.name }),
            ' › ',
            el('b', { textContent: pieceLabel(p) }),
            ` ${p.w}×${p.h}`,
        );
    } else if (a.canvas) {
        const n = a.canvas.pieces.length;
        info.textContent = `canvas ${a.name} · ${a.tiles}×${a.tilesY} tiles · ${n} piece${n === 1 ? '' : 's'}`;
    } else return;
    info.title = info.textContent;
}

function showOpenPanel() {
    const p = canvasOf()?.pieces.find(q => q.name === st.open);
    if (!p) return;
    drawSmallMap(p);
    const list = $('openCrossings');
    list.textContent = '';
    const xs = st.cutInfo?.crossings?.filter(x => x.from === p.name);
    const near = neighbours(canvasOf().pieces, p);
    const by = new Map();
    for (const n of near) {
        const count = xs ? xs.filter(x => x.to === n.piece.name).length : null;
        by.set(n.side, [...(by.get(n.side) ?? []), `${pieceLabel(n.piece)}${count === null ? ` (${n.tiles} tiles)` : ` ${count}`}`]);
    }
    for (const [side, names] of by)
        list.append(el('div', { textContent: `${side[0].toUpperCase()}${side.slice(1)} → ${names.join(' · ')}` }));
    if (!near.length) list.append(el('div', { textContent: 'No neighbours: nothing leads out of this piece but its entrances.' }));
    $('openCrossingsCount').textContent = xs ? String(xs.length) : '';
    $('openCrossingsNote').textContent = st.cutInfo?.unsupported
        ? 'This engine finds no crossings yet: it needs the update that cuts canvases.'
        : xs
          ? 'Drawn where open ground meets open ground; you arrive facing the way you walked.'
          : 'Counted by the engine once the canvas is saved.';
    const ch = st.checks.get(p.name);
    $('openCheckOut').textContent = ch && sameRect(ch.rect, p) ? ch.why : '';
}

/** The small map: the canvas's pieces, gaps hatched, the open piece lit; click a piece to open it. */
function drawSmallMap(open) {
    const cv = $('smallMap'),
        a = area(),
        W = 220,
        s = Math.max(1, Math.floor(Math.min(W / a.tiles, W / a.tilesY) * 10) / 10),
        w = Math.round(a.tiles * s),
        h = Math.round(a.tilesY * s),
        dpr = devicePixelRatio || 1;
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    st.small = { s, ox: 0, oy: h };
    g.fillStyle = '#2a2f36';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(230, 233, 238, 0.18)';
    g.beginPath();
    for (let k = -h; k < w; k += 6) {
        g.moveTo(k, h);
        g.lineTo(k + h, 0);
    }
    g.stroke();
    for (const p of canvasOf().pieces) {
        const x = p.x * s,
            y = h - (p.y + p.h) * s;
        g.fillStyle = p.name === open.name ? '#d8a24a' : '#55603e';
        g.fillRect(x + 1, y + 1, p.w * s - 2, p.h * s - 2);
    }
    // The full-detail window: the piece and its ring.
    const x0 = Math.max(0, open.x - RING),
        y0 = Math.max(0, open.y - RING),
        x1 = Math.min(a.tiles, open.x + open.w + RING),
        y1 = Math.min(a.tilesY, open.y + open.h + RING);
    g.strokeStyle = 'rgba(230, 233, 238, 0.7)';
    g.setLineDash([3, 3]);
    g.strokeRect(x0 * s + 0.5, h - y1 * s + 0.5, (x1 - x0) * s - 1, (y1 - y0) * s - 1);
    g.setLineDash([]);
}

// --- In the 3D view: the open piece's outline and its crossings -----------------------------------------------------

let outline = null;
let crossingLines = null;

function lineOnGround(points, close) {
    const a = area(),
        out = [];
    const n = points.length;
    for (let k = 0; k < (close ? n : n - 1); k++) {
        const [ax, ay] = points[k],
            [bx, by] = points[(k + 1) % n];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / SPACING));
        for (let s = 0; s <= steps; s++) {
            const x = ax + ((bx - ax) * s) / steps,
                y = ay + ((by - ay) * s) / steps;
            out.push(x, a.heightAt(Math.min(a.sizeX, Math.max(0, x)), Math.min(a.sizeY, Math.max(0, y))) + 0.25, a.sizeY - y);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    return geo;
}

function drawOutline() {
    const v = view();
    if (outline) {
        v.scene.remove(outline);
        outline.geometry.dispose();
        outline = null;
    }
    const p = st.open && canvasOf().pieces.find(q => q.name === st.open);
    if (!p) return;
    const [x0, y0, x1, y1] = [p.x * TILE, p.y * TILE, (p.x + p.w) * TILE, (p.y + p.h) * TILE];
    outline = new THREE.Line(
        lineOnGround(
            [
                [x0, y0],
                [x1, y0],
                [x1, y1],
                [x0, y1],
                [x0, y0],
            ],
            false,
        ),
        new THREE.LineBasicMaterial({ color: 0xd8a24a, depthTest: false, transparent: true }),
    );
    outline.renderOrder = 5;
    v.scene.add(outline);
}

function drawCrossings() {
    const v = view();
    if (crossingLines) {
        v.scene.remove(crossingLines);
        crossingLines.traverse(o => o.geometry?.dispose());
        crossingLines = null;
    }
    const xs = st.open && st.cutInfo?.crossings?.filter(x => x.from === st.open);
    if (!xs?.length) return;
    crossingLines = new THREE.Group();
    // Filled, as the mock-up draws them: a 1.5 m line beside the piece's outline didn't show.
    const mat = new THREE.LineBasicMaterial({ color: 0xffd27a, depthTest: false, transparent: true }),
        fill = new THREE.MeshBasicMaterial({ color: 0xd8a24a, depthTest: false, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
        a = area();
    for (const x of xs) {
        if (!(x.outline?.length >= 3)) continue;
        crossingLines.add(new THREE.Line(lineOnGround(x.outline, true), mat));
        const pts = x.outline.map(
            ([px, py]) =>
                new THREE.Vector3(
                    px,
                    a.heightAt(Math.min(a.sizeX, Math.max(0, px)), Math.min(a.sizeY, Math.max(0, py))) + 0.3,
                    a.sizeY - py,
                ),
        );
        const tris = [];
        for (let k = 1; k + 1 < pts.length; k++) tris.push(pts[0], pts[k], pts[k + 1]);
        crossingLines.add(new THREE.Mesh(new THREE.BufferGeometry().setFromPoints(tris), fill));
    }
    crossingLines.traverse(o => {
        o.renderOrder = 6;
    });
    v.scene.add(crossingLines);
}

/** In an open piece, where canvas point (x, y) metres is, on the canvas and in the piece under it, for the status line
 *  (strokes.js); null with no piece open. */
export function placeText(x, y) {
    const c = canvasOf();
    if (!st.open || !c) return null;
    const here = pieceAt(c.pieces, x, y, area().tiles, area().tilesY),
        on = `x ${x.toFixed(1)} m · y ${y.toFixed(1)} m on the canvas`;
    if (!here) return `a gap (not exported) · ${on}`;
    return `${pieceLabel(here)}${here.name === st.open ? '' : ' (a neighbour)'} · ${on} (x ${(x - here.x * TILE).toFixed(1)} m, y ${(y - here.y * TILE).toFixed(1)} m in the piece)`;
}
