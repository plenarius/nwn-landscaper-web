// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// A canvas's pieces (the engine's docs/DESIGN-canvas-cut.md, questions 2, 6 and 7): rectangles of whole tiles, 3 to 32 a side,
// that never overlap; ground no piece covers is a gap. Each edit here takes a list of pieces and gives a new one, or the reason
// it can't, so the editor shows the reason instead of making the change. Tiles count from the canvas's south-west corner, as the
// engine's header keeps them (`{ id, name, x, y, w, h }`, its src/canvas.rs check_pieces).

import { TILE } from './area.js';

/** A piece's least and most tiles a side: an NWN area's limits. */
export const PIECE_MIN = 3;
export const PIECE_MAX = 32;

/** Whether `name` can be a piece's (its areas' resref prefix): 1 to 9 lower case letters, digits or `_`. */
export const pieceNameOk = name => /^[a-z0-9_]{1,9}$/.test(name);

/** The default name of piece number `id` on canvas `canvas`: `rivl05`. */
export const defaultName = (canvas, id) => `${canvas}${String(id).padStart(2, '0')}`;

/** What a piece is called in the editor: its name in the game when it has one, else its resref name. */
export const pieceLabel = p => p.settings?.name || p.name;

const right = p => p.x + p.w;
const top = p => p.y + p.h;
const overlaps = (a, b) => a.x < right(b) && b.x < right(a) && a.y < top(b) && b.y < top(a);
const area = p => p.w * p.h;
const sameRect = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * Why `pieces` can't be a canvas's of `tiles` by `tilesY` tiles (each piece 3 to 32 a side, inside the canvas, none
 * overlapping), in words for the builder, naming the piece ("Riverford would be 36 tiles wide"); null when they can.
 */
export function whyNot(pieces, tiles, tilesY) {
    for (const p of pieces) {
        const n = pieceLabel(p);
        if (p.w > PIECE_MAX || p.h > PIECE_MAX) {
            const [what, size] = p.w > PIECE_MAX ? ['wide', p.w] : ['tall', p.h];
            return `${n} would be ${size} tiles ${what}; the game takes ${PIECE_MAX} at most.`;
        }
        if (p.w < PIECE_MIN || p.h < PIECE_MIN) {
            const [what, size] = p.w < PIECE_MIN ? ['wide', p.w] : ['tall', p.h];
            return `${n} would be ${size} tile${size === 1 ? '' : 's'} ${what}; a piece is ${PIECE_MIN} at least.`;
        }
        if (p.x < 0 || p.y < 0 || right(p) > tiles || top(p) > tilesY) return `${n} would go past the canvas's edge.`;
    }
    for (let a = 0; a < pieces.length; a++)
        for (let b = a + 1; b < pieces.length; b++)
            if (overlaps(pieces[a], pieces[b])) return `${pieceLabel(pieces[a])} would overlap ${pieceLabel(pieces[b])}.`;
    return null;
}

/** The pieces' state: `pieces` and the counter new numbers come from (a number is given once, never again). */
const next = (c, pieces, nextId) => ({ pieces, nextId: Math.max(nextId, c.nextId) });

/** A new piece numbered from `c`'s counter, named `<canvas><number>` (unless that name is taken). */
function fresh(c, rect, taken) {
    let id = c.nextId++;
    let name = defaultName(c.canvas, id);
    while (taken.has(name)) {
        id = c.nextId++;
        name = defaultName(c.canvas, id);
    }
    taken.add(name);
    return { id, name, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
}

/** The rectangle of tiles between two tile corners (dragged from one to the other), each corner [tx, ty]. */
export function rectBetween([ax, ay], [bx, by]) {
    const x = Math.min(ax, bx),
        y = Math.min(ay, by);
    return { x, y, w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/**
 * Cuts rectangle `rect` out as a piece (`state`: `{ canvas, pieces, nextId }`). Over a gap it is a new piece; over pieces it
 * must run right across each one it touches, so what is left of each is still a rectangle (one or two): a piece split in two
 * keeps its number and name on its larger part (question 6). Resolves `{ pieces, nextId, made }` or `{ error }`.
 */
export function cut(state, rect, tiles, tilesY) {
    if (rect.w < 1 || rect.h < 1) return { error: 'Drag across the ground to cut out a piece.' };
    const c = { canvas: state.canvas, nextId: state.nextId };
    const taken = new Set(state.pieces.map(p => p.name));
    const out = [];
    // The piece whose larger part the new rectangle is, if any: it keeps that piece's number.
    let heir = null;
    const leftovers = [];
    for (const p of state.pieces) {
        if (!overlaps(p, rect)) {
            out.push(p);
            continue;
        }
        const across = rect.x <= p.x && right(rect) >= right(p),
            up = rect.y <= p.y && top(rect) >= top(p);
        let parts;
        if (across && up) parts = [];
        else if (across)
            parts = [
                { x: p.x, y: p.y, w: p.w, h: Math.max(0, rect.y - p.y) },
                { x: p.x, y: top(rect), w: p.w, h: Math.max(0, top(p) - top(rect)) },
            ];
        else if (up)
            parts = [
                { x: p.x, y: p.y, w: Math.max(0, rect.x - p.x), h: p.h },
                { x: right(rect), y: p.y, w: Math.max(0, right(p) - right(rect)), h: p.h },
            ];
        else return { error: `A cut runs right across ${pieceLabel(p)}, from one side to the other: drag past its edges.` };
        parts = parts.filter(r => r.w > 0 && r.h > 0);
        const inside = {
            x: Math.max(p.x, rect.x),
            y: Math.max(p.y, rect.y),
            w: Math.min(right(p), right(rect)) - Math.max(p.x, rect.x),
            h: Math.min(top(p), top(rect)) - Math.max(p.y, rect.y),
        };
        const biggest = parts.reduce((m, r) => (!m || area(r) > area(m) ? r : m), null);
        if (!heir && (!biggest || area(inside) > area(biggest))) {
            heir = p;
            leftovers.push(...parts.map(r => ({ from: p, r, keep: false })));
        } else leftovers.push(...parts.map(r => ({ from: p, r, keep: r === biggest })));
    }
    for (const { from, r, keep } of leftovers) out.push(keep ? { ...from, ...r } : fresh(c, r, taken));
    const made = heir ? { ...heir, ...rect } : fresh(c, rect, taken);
    out.push(made);
    const why = whyNot(out, tiles, tilesY);
    if (why) return { error: why };
    return { ...next(c, out, state.nextId), made };
}

/**
 * The cut through tile corner line `at` (an edge of some piece: `{ axis: 'x' | 'y', k, from, to }`, tiles), as a set: every
 * piece with an edge on that line which meets the ones already in it along the line, so moving it keeps them all rectangles.
 * `side`: for each piece, -1 when the line is its west (or south) edge, +1 its east (or north).
 */
export function cutAt(pieces, axis, k, along) {
    const lo = p => (axis === 'x' ? p.y : p.x),
        hi = p => (axis === 'x' ? top(p) : right(p)),
        start = p => (axis === 'x' ? p.x : p.y),
        end = p => (axis === 'x' ? right(p) : top(p));
    const on = pieces.filter(p => start(p) === k || end(p) === k);
    let span = [along, along];
    const members = new Set();
    for (let grew = true; grew; ) {
        grew = false;
        for (const p of on) {
            if (members.has(p)) continue;
            const meets = members.size ? lo(p) < span[1] && hi(p) > span[0] : lo(p) <= along && hi(p) >= along;
            if (!meets) continue;
            members.add(p);
            span = members.size === 1 ? [lo(p), hi(p)] : [Math.min(span[0], lo(p)), Math.max(span[1], hi(p))];
            grew = true;
        }
    }
    if (!members.size) return null;
    return { axis, k, span, members: [...members].map(p => ({ p, side: start(p) === k ? -1 : 1 })) };
}

/** The nearest piece edge to tile point (tx, ty) within `reach` tiles, as cutAt gives it; null when none is near. */
export function cutNear(pieces, tx, ty, reach = 0.6) {
    let best = null;
    for (const p of pieces)
        for (const [axis, k, d, along, lo, hi] of [
            ['x', p.x, Math.abs(tx - p.x), ty, p.y, top(p)],
            ['x', right(p), Math.abs(tx - right(p)), ty, p.y, top(p)],
            ['y', p.y, Math.abs(ty - p.y), tx, p.x, right(p)],
            ['y', top(p), Math.abs(ty - top(p)), tx, p.x, right(p)],
        ])
            if (d <= reach && along >= lo && along <= hi && (!best || d < best.d)) best = { axis, k, along, d };
    return best && cutAt(pieces, best.axis, best.k, best.along);
}

/**
 * Moves cut `c` (cutAt's) to line `to`: the pieces on both sides of it move their edge there (question 7). Resolves
 * `{ pieces, nextId }` or `{ error }` (a piece over 32 tiles or under 3, past the canvas, or over another piece).
 */
export function moveCut(state, c, to, tiles, tilesY) {
    if (to === c.k) return { pieces: state.pieces, nextId: state.nextId };
    const moved = new Map();
    for (const { p, side } of c.members) {
        const q = { ...p };
        if (c.axis === 'x') {
            if (side < 0) {
                q.w = right(p) - to;
                q.x = to;
            } else q.w = to - p.x;
        } else if (side < 0) {
            q.h = top(p) - to;
            q.y = to;
        } else q.h = to - p.y;
        moved.set(p, q);
    }
    const out = state.pieces.map(p => moved.get(p) ?? p);
    const why = whyNot(out, tiles, tilesY);
    return why ? { error: why, pieces: out } : { pieces: out, nextId: state.nextId };
}

/** Joins pieces `a` and `b` (names) into one when together they are a rectangle: the larger keeps its number and name. */
export function join(state, a, b, tiles, tilesY) {
    const pa = state.pieces.find(p => p.name === a),
        pb = state.pieces.find(p => p.name === b);
    if (!pa || !pb || pa === pb) return { error: 'Pick two pieces to join.' };
    const side =
        (pa.y === pb.y && pa.h === pb.h && (right(pa) === pb.x || right(pb) === pa.x)) ||
        (pa.x === pb.x && pa.w === pb.w && (top(pa) === pb.y || top(pb) === pa.y));
    if (!side) return { error: `${pieceLabel(pa)} and ${pieceLabel(pb)} don't make a rectangle together: they must share a whole side.` };
    const keep = area(pb) > area(pa) ? pb : pa,
        x = Math.min(pa.x, pb.x),
        y = Math.min(pa.y, pb.y);
    const joined = { ...keep, x, y, w: Math.max(right(pa), right(pb)) - x, h: Math.max(top(pa), top(pb)) - y };
    const out = state.pieces.filter(p => p !== pa && p !== pb).concat(joined);
    const why = whyNot(out, tiles, tilesY);
    return why ? { error: why } : { pieces: out, nextId: state.nextId, made: joined };
}

/**
 * An even grid of `across` by `up` pieces over the whole canvas, in place of the pieces there now: the canvas's tiles shared out
 * as evenly as they go (the extra tiles to the first columns and rows). Each new piece takes the number and name of the old
 * piece it holds most of, when that piece hasn't gone to another; the rest are new.
 */
export function grid(state, across, up, tiles, tilesY) {
    const split = (n, parts) => {
        const out = [];
        let at = 0;
        for (let k = 0; k < parts; k++) {
            const size = Math.floor(n / parts) + (k < n % parts ? 1 : 0);
            out.push([at, size]);
            at += size;
        }
        return out;
    };
    if (!(across >= 1 && up >= 1)) return { error: 'A grid has 1 piece or more each way.' };
    const c = { canvas: state.canvas, nextId: state.nextId };
    const rects = [];
    for (const [y, h] of split(tilesY, up)) for (const [x, w] of split(tiles, across)) rects.push({ x, y, w, h });
    const shared = (a, b) =>
        Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x)) * Math.max(0, Math.min(top(a), top(b)) - Math.max(a.y, b.y));
    const used = new Set(),
        names = new Set(),
        kept = rects.map(r => {
            const old = state.pieces.filter(p => !used.has(p)).reduce((m, p) => (shared(p, r) > (m ? shared(m, r) : 0) ? p : m), null);
            if (!old) return null;
            used.add(old);
            names.add(old.name);
            return { ...old, ...r };
        });
    const out = kept.map((p, n) => p ?? fresh(c, rects[n], names));
    const why = whyNot(out, tiles, tilesY);
    return why ? { error: why } : next(c, out, state.nextId);
}

/** Renames piece `name` to `to` (its areas' resref prefix, unique among the pieces). */
export function rename(state, name, to) {
    if (!pieceNameOk(to)) return { error: 'A piece name is 1 to 9 lower case letters, digits or _.' };
    if (to !== name && state.pieces.some(p => p.name === to)) return { error: `Another piece is called ${to}.` };
    return { pieces: state.pieces.map(p => (p.name === name ? { ...p, name: to } : p)), nextId: state.nextId };
}

/** Takes piece `name` out: its ground becomes a gap. Its number is never given again. */
export function remove(state, name) {
    return { pieces: state.pieces.filter(p => p.name !== name), nextId: state.nextId };
}

/** The piece holding canvas point (x, y) metres, or null in a gap. A point on a cut is the east or north piece's, as the
 *  engine's cut gives it; one on the canvas's far edge is the piece's there. */
export function pieceAt(pieces, x, y, tiles = Infinity, tilesY = Infinity) {
    const tx = x / TILE,
        ty = y / TILE;
    return (
        pieces.find(
            p =>
                tx >= p.x &&
                (tx < right(p) || (right(p) === tiles && tx <= tiles)) &&
                ty >= p.y &&
                (ty < top(p) || (top(p) === tilesY && ty <= tilesY)),
        ) ?? null
    );
}

/** The piece a thing belongs to: by its whole outline for a trigger or encounter (`across` when it spans two), else by its
 *  place. */
function ownerOf(pieces, t, tiles, tilesY) {
    if (t.outline?.length >= 3) {
        const owners = new Set(t.outline.map(([x, y]) => pieceAt(pieces, x, y, tiles, tilesY)?.id ?? null));
        return owners.size === 1 ? pieceAt(pieces, t.outline[0][0], t.outline[0][1], tiles, tilesY) : 'across';
    }
    return pieceAt(pieces, t.x, t.y, tiles, tilesY);
}

/** The pieces sharing a side with piece `p`, and how many tiles of it: `[{ piece, side: 'north'|..., tiles }]`. */
export function neighbours(pieces, p) {
    const out = [];
    for (const q of pieces) {
        if (q === p || q.id === p.id) continue;
        const alongX = Math.min(right(p), right(q)) - Math.max(p.x, q.x),
            alongY = Math.min(top(p), top(q)) - Math.max(p.y, q.y);
        if (top(p) === q.y && alongX > 0) out.push({ piece: q, side: 'north', tiles: alongX });
        else if (q.y + q.h === p.y && alongX > 0) out.push({ piece: q, side: 'south', tiles: alongX });
        else if (right(p) === q.x && alongY > 0) out.push({ piece: q, side: 'east', tiles: alongY });
        else if (right(q) === p.x && alongY > 0) out.push({ piece: q, side: 'west', tiles: alongY });
    }
    const order = { north: 0, west: 1, east: 2, south: 3 };
    return out.sort((a, b) => order[a.side] - order[b.side] || a.piece.x - b.piece.x || a.piece.y - b.piece.y);
}

/** Tiles no piece covers. */
export function gapTiles(pieces, tiles, tilesY) {
    return tiles * tilesY - pieces.reduce((s, p) => s + area(p), 0);
}

/**
 * What a change of pieces (`before` to `after`) does to canvas `a`'s contents (question 7, mock-up 2): every entrance, game
 * object and thing that ends up in another piece, or in a gap (not exported), or across a cut (refused at export), and the
 * baked objects, lakes and chasms counted by the pair of pieces they move between. Tags never change (they are the canvas's),
 * so the list says what each keeps. `[{ kind, label, tag?, from, to, count? }]`, `from` and `to` piece names or null for a gap.
 */
export function whatMoves(a, before, after) {
    const T = a.tiles,
        TY = a.tilesY,
        canvas = a.name;
    const name = p => (p === 'across' ? 'across' : (p?.name ?? null));
    const changed = (b, n) => (b?.id ?? b) !== (n?.id ?? n) || name(b) !== name(n);
    const out = [];
    for (const e of a.entrances ?? []) {
        const b = pieceAt(before, e.x, e.y, T, TY),
            n = pieceAt(after, e.x, e.y, T, TY);
        if (changed(b, n)) out.push({ kind: 'entrance', label: 'Cave entrance', tag: `${canvas}_ent${e.id}`, from: name(b), to: name(n) });
    }
    const counted = new Map();
    const count = (kind, label, b, n, what) => {
        const key = `${kind}|${name(b)}|${name(n)}`;
        const row = counted.get(key) ?? { kind, label, from: name(b), to: name(n), count: 0, names: [] };
        row.count++;
        if (what && row.names.length < 4) row.names.push(what);
        counted.set(key, row);
    };
    for (const o of a.objects ?? []) {
        const b = pieceAt(before, o.x, o.y, T, TY),
            n = pieceAt(after, o.x, o.y, T, TY);
        if (!changed(b, n)) continue;
        // A placed (not baked) object is a game placeable with a tag; a baked one is part of the ground's look.
        if (o.baked) count('object', 'baked object', b, n, o.model);
        else out.push({ kind: 'placeable', label: 'Placeable', tag: `${canvas}_p${o.id}`, from: name(b), to: name(n) });
    }
    for (const t of a.things ?? []) {
        const b = ownerOf(before, t, T, TY),
            n = ownerOf(after, t, T, TY);
        if (!changed(b, n)) continue;
        if (t.kind === 'creature') count('creature', 'creature', b, n, t.fields?.LocalizedName || t.name || t.resref);
        else out.push({ kind: t.kind, label: t.name || t.kind, tag: t.tag ?? t.fields?.Tag ?? null, from: name(b), to: name(n) });
    }
    out.push(...counted.values());
    for (const [kind, label, has] of [
        ['lake', 'Part of a lake', k => !Number.isNaN(a.waterLevel?.[k])],
        ['chasm', 'Part of a chasm', k => a.chasm?.[k] === 1],
    ]) {
        const seen = new Set();
        forChangedTiles(before, after, T, TY, (tx, ty, b, n) => {
            const key = `${name(b)}|${name(n)}`;
            if (seen.has(key) || !tileHas(a, tx, ty, has)) return;
            seen.add(key);
            out.push({ kind, label, from: name(b), to: name(n) });
        });
    }
    return out;
}

/** Calls `fn(tx, ty, before, after)` for each tile whose piece changes. */
function forChangedTiles(before, after, T, TY, fn) {
    const at = (list, tx, ty) => list.find(p => tx >= p.x && tx < right(p) && ty >= p.y && ty < top(p)) ?? null;
    for (let ty = 0; ty < TY; ty++)
        for (let tx = 0; tx < T; tx++) {
            const b = at(before, tx, ty),
                n = at(after, tx, ty);
            if ((b?.id ?? null) !== (n?.id ?? null) || b?.name !== n?.name) fn(tx, ty, b, n);
        }
}

/** Whether any sample of tile (tx, ty) of `a` passes `has(k)` (every fourth sample: enough to see a lake or chasm). */
function tileHas(a, tx, ty, has) {
    const per = (a.nx - 1) / a.tiles;
    for (let j = ty * per; j <= (ty + 1) * per; j += 4)
        for (let i = tx * per; i <= (tx + 1) * per; i += 4) if (has(j * a.nx + i)) return true;
    return false;
}

export { sameRect };
