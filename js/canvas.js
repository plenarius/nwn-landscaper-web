// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// A canvas (the engine's docs/DESIGN-canvas-cut.md, step 5): a landscape larger than one area, up to 128 by 128 tiles, that is
// later cut into pieces. The editor holds its ground whole, as an area's (18 bytes a sample, 76 MB at 128), so every tool and
// the region undo work on it unchanged; the engine keeps it in fixed blocks of 16 by 16 tiles (its src/canvas.rs), and a save
// sends only the blocks a change reached.

import { Area, SPACING, TILE } from './area.js';
import { generateHeightMap } from './noise.js';

/** Tiles a block covers each way, and its samples a side less one (blocks share their edge row, as pieces do). */
export const BLOCK_TILES = 16;
export const BLOCK_STEP = BLOCK_TILES * (TILE / SPACING);
/** A canvas's least and most tiles each way (the engine's MIN_TILES and MAX_TILES). */
export const MIN_TILES = 3;
export const MAX_TILES = 128;
/** The version of a block the engine has no file for: flat ground at the header's `ground`. */
export const NONE = 'none';

/**
 * The per-sample grids a block carries, in the block file's order: the canvas's field, the save's key, its typed array and
 * values a sample, and for one a block may leave out, the block file's flag and when it counts as empty. The chasm mask is
 * left out without a chasm sample; the soft paint's blend layer (a second texture and its weight, 2 bytes a sample, the soft
 * paint format of 2026-11-28) without a weight. A new per-sample layer joins here like these.
 */
export const LAYERS = [
    { field: 'heights', key: 'heights', Type: Float32Array, per: 1 },
    { field: 'materials', key: 'paint', Type: Uint8Array, per: 1 },
    { field: 'chasm', key: 'chasm', Type: Uint8Array, per: 1, flag: 1, empty: a => !a.includes(1) },
    { field: 'blend', key: 'blend', Type: Uint8Array, per: 2, flag: 2, empty: a => !a.some((v, k) => k & 1 && v) },
];

/** Whether `name` can be a canvas's: 1 to 7 lower case letters, digits or `_` (a piece's default name adds two digits). */
export const canvasNameOk = name => /^[a-z0-9_]{1,7}$/.test(name);

/** Block (x, y)'s name, as the engine names its file: `b03_02`. */
export const blockKey = (x, y) => `b${String(x).padStart(2, '0')}_${String(y).padStart(2, '0')}`;

/** The area's fields the canvas header keeps (Area.toJSON's but the grids, the band and `lights`, which header() adds). */
const HEADER_FIELDS = [
    'name',
    'tiles',
    'tilesY',
    'palette',
    'atmosphere',
    'water',
    'shadow',
    'entrances',
    'objects',
    'nextObjectId',
    'ambience',
    'roof',
    'clearance',
    'module',
    'things',
    'nextThingId',
    'entranceNextId',
    'settings',
    'originals',
    'created',
    'underlay',
];

/** A canvas being edited: an Area over the whole canvas, with the engine's block versions and the blocks changed since the
 *  last save. */
export class CanvasArea extends Area {
    constructor(name, tiles, tilesY = tiles, ground = 0) {
        super(name, tiles, undefined, undefined, undefined, tilesY);
        this.canvas = {
            ground,
            // The header's version (null: not on the engine yet) and the header text last saved, to tell whether it changed.
            version: null,
            savedHeader: null,
            // Each block's version on the engine (a block left out is NONE).
            versions: new Map(),
            // Blocks changed since they were last saved: name to a count that moves on with each change, so a save answered
            // after a later change leaves the block to save again.
            dirty: new Map(),
            stamp: 0,
            // Cutting (step 6): the pieces, rectangles of tiles, and the counter their numbers come from.
            pieces: [],
            pieceNextId: 1,
        };
        this.module = name;
        // The soft paint's blend layer (LAYERS), null until a block or a brush gives it one.
        this.blend ??= null;
    }

    /** Blocks each way. */
    blocks() {
        return [Math.ceil(this.tiles / BLOCK_TILES), Math.ceil(this.tilesY / BLOCK_TILES)];
    }

    /** Block (bx, by)'s first sample and its width and height in samples. */
    blockRect(bx, by) {
        const i0 = bx * BLOCK_STEP,
            j0 = by * BLOCK_STEP;
        return { i0, j0, w: Math.min(BLOCK_STEP, this.nx - 1 - i0) + 1, h: Math.min(BLOCK_STEP, this.ny - 1 - j0) + 1 };
    }

    /** The names of the blocks holding any sample of rectangle `r` (i0..i1, j0..j1): a sample on a shared row is in both. */
    blocksOf(r) {
        const [bx, by] = this.blocks(),
            out = [];
        const range = (a, b, n) => [Math.max(0, Math.ceil(a / BLOCK_STEP) - 1), Math.min(n - 1, Math.floor(b / BLOCK_STEP))];
        const [x0, x1] = range(r.i0, r.i1, bx),
            [y0, y1] = range(r.j0, r.j1, by);
        for (let y = y0; y <= y1; y++)
            for (let x = x0; x <= x1; x++) {
                const b = this.blockRect(x, y);
                if (r.i1 >= b.i0 && r.i0 <= b.i0 + b.w - 1 && r.j1 >= b.j0 && r.j0 <= b.j0 + b.h - 1) out.push(blockKey(x, y));
            }
        return out;
    }

    /** Notes that samples `r` changed: their blocks go with the next save. */
    markChanged(r) {
        if (!r) return;
        const c = this.canvas;
        c.stamp++;
        for (const k of this.blocksOf(r)) c.dirty.set(k, c.stamp);
    }

    /** Every block changed (a new canvas whose ground isn't flat). */
    markAll() {
        this.markChanged({ i0: 0, i1: this.nx - 1, j0: 0, j1: this.ny - 1 });
    }

    // A change found when an undo step settles, and one an undo or redo puts back, both reach blocks.
    changedSince(base) {
        const r = super.changedSince(base);
        this.markChanged(r);
        return r;
    }

    apply(s) {
        this.markChanged(s.rect);
        return super.apply(s);
    }

    /** Finds what changed since the last undo step began (into that step, as an undo would), so its blocks are dirty. */
    settleChanges() {
        this.settle(this.undoStack.at(-1));
    }

    /** Block `key`'s grids, copied out of the canvas, in the layers' order (null for a layer that may be left out and is
     *  empty there). */
    blockData(key) {
        const [x, y] = parseKey(key),
            { i0, j0, w, h } = this.blockRect(x, y);
        return LAYERS.map(({ field, Type, per, empty }) => {
            const src = this[field];
            if (!src) return empty ? null : new Type(w * h * per);
            const out = new Type(w * h * per);
            for (let j = 0; j < h; j++) {
                const a = ((j0 + j) * this.nx + i0) * per;
                out.set(src.subarray(a, a + w * per), j * w * per);
            }
            return empty?.(out) ? null : out;
        });
    }

    /** Puts block `key`'s grids (blockData's form) into the canvas. */
    setBlock(key, layers) {
        const [x, y] = parseKey(key),
            { i0, j0, w, h } = this.blockRect(x, y);
        LAYERS.forEach(({ field, Type, per, empty }, n) => {
            // (a layer a block leaves out is empty there: cleared where the canvas has it)
            const src = layers[n] ?? (empty && this[field] ? new Type(w * h * per) : null);
            if (!src) return;
            this[field] ??= new Type(this.nx * this.ny * per);
            for (let j = 0; j < h; j++) this[field].set(src.subarray(j * w * per, (j + 1) * w * per), ((j0 + j) * this.nx + i0) * per);
        });
    }

    /** The header the engine keeps (canvas.json): what an area's JSON holds besides its ground's grids, which are in the
     *  blocks. (Not Area.toJSON: it encodes the whole grid, 30 ms at 64 by 64, only to drop it.) */
    header() {
        const o = Object.fromEntries(HEADER_FIELDS.map(f => [f, this[f]]));
        o.lights = this.lightsForExport();
        return { ...o, kind: 'surface', ground: this.canvas.ground, pieces: this.canvas.pieces, pieceNextId: this.canvas.pieceNextId };
    }

    /** What the next save sends: the header when it changed (with its base), and each dirty block with its base; `stamps`, the
     *  count each block was sent at (see `dirty`). null when nothing changed. */
    saveBody() {
        this.settleChanges();
        const c = this.canvas,
            header = JSON.stringify(this.header()),
            blocks = [],
            stamps = new Map();
        for (const [key, stamp] of c.dirty) {
            const b = { block: key, base: c.versions.get(key) ?? NONE };
            this.blockData(key).forEach((data, n) => {
                if (data) b[LAYERS[n].key] = toB64(new Uint8Array(data.buffer));
            });
            blocks.push(b);
            stamps.set(key, stamp);
        }
        const headerChanged = header !== c.savedHeader;
        if (!headerChanged && !blocks.length) return null;
        const body = { blocks };
        if (headerChanged) Object.assign(body, { header: JSON.parse(header), base: c.version });
        return { body, header, stamps };
    }

    /** The engine saved `sent` (saveBody's) and answered `answer` (`{ version, blocks }`): its versions are the canvas's now,
     *  and the blocks not changed again since are clean. */
    saved(sent, answer) {
        const c = this.canvas;
        if (answer.version) c.version = answer.version;
        if (sent.body.header) c.savedHeader = sent.header;
        for (const [key, v] of Object.entries(answer.blocks ?? {})) c.versions.set(key, v);
        for (const [key, stamp] of sent.stamps) if (c.dirty.get(key) === stamp) c.dirty.delete(key);
    }

    /** A new canvas: its ground as Area.create starts it ('flat', 'hills' or 'rough', at `base` metres), every block that
     *  isn't flat at `base` to save. */
    static create(name, tiles, start = 'flat', base = 5, tilesY = tiles) {
        const c = new CanvasArea(name, tiles, tilesY, base);
        c.created = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
        const { nx, ny } = c;
        c.heights.fill(base);
        if (start === 'hills' || start === 'rough') {
            const rough = start === 'rough';
            const noise = generateHeightMap({
                seed: Math.floor(Math.random() * 100000),
                width: nx,
                height: ny,
                octaves: rough ? 6 : 4,
                persistence: rough ? 0.5 : 0.4,
                lacunarity: 2.1,
                scale: (rough ? 70 : 140) / SPACING,
            });
            const amplitude = rough ? 14 : 6;
            for (let k = 0; k < nx * ny; k++) c.heights[k] = base + noise[k] * amplitude;
            c.markAll();
        }
        c.floodWater();
        return c;
    }

    /** The canvas from its header (the engine's `GET /api/canvas` answer: `header`, `version`, `blocks`) and its blocks' files
     *  (`files`: name to the block file's bytes, for those that have one; the rest are flat at the header's ground). */
    static fromHeader(answer, files) {
        const h = answer.header,
            c = new CanvasArea(h.name, h.tiles, h.tilesY ?? h.tiles, h.ground ?? 0);
        // (everything but the grids, read as an area's)
        const area = Area.fromJSON({
            ...h,
            tiles: 3,
            tilesY: 3,
            heights: toB64(new Uint8Array(new Float32Array(49 * 49).buffer)),
            materials: null,
            band: null,
            water: [],
        });
        for (const f of Object.keys(area)) {
            if (
                [
                    'name',
                    'tiles',
                    'tilesY',
                    'nx',
                    'ny',
                    'sizeX',
                    'sizeY',
                    'heights',
                    'materials',
                    'chasm',
                    'waterLevel',
                    'surfaceLevel',
                ].includes(f)
            )
                continue;
            if (['undoStack', 'redoStack', 'undoBase', 'band', 'bandBase', 'canvas'].includes(f)) continue;
            c[f] = area[f];
        }
        c.band = null;
        c.lights = Array.isArray(h.lights) && h.lights.length === c.tiles * c.tilesY ? h.lights : null;
        c.heights.fill(c.canvas.ground);
        const [bx, by] = c.blocks();
        for (let y = 0; y < by; y++)
            for (let x = 0; x < bx; x++) {
                const key = blockKey(x, y),
                    bytes = files[key];
                if (!bytes) continue;
                const { w, h: bh } = c.blockRect(x, y);
                c.setBlock(key, decodeBlock(bytes, w, bh));
            }
        c.canvas.version = answer.version;
        c.canvas.versions = new Map(Object.entries(answer.blocks ?? {}));
        c.canvas.pieces = Array.isArray(h.pieces) ? h.pieces : [];
        c.canvas.pieceNextId = h.pieceNextId ?? 1;
        c.water = Array.isArray(h.water) ? h.water : [];
        dropEmpty(c);
        c.floodWater();
        c.canvas.savedHeader = JSON.stringify(c.header());
        return c;
    }
}

/** Drops canvas `c`'s layers that may be left out and are empty everywhere (null: none), as an area keeps no chasm mask
 *  without a chasm. */
export function dropEmpty(c) {
    for (const { field, empty } of LAYERS) if (empty && c[field] && empty(c[field])) c[field] = null;
}

/** Block name `b03_02` as [3, 2]. */
function parseKey(key) {
    const m = /^b(\d{2})_(\d{2})$/.exec(key);
    if (!m) throw new Error(`bad block name ${key}`);
    return [+m[1], +m[2]];
}

/** The grids in block file `bytes` (the engine's format 1, src/canvas.rs), which must be `w` by `h` samples: [heights, paint,
 *  chasm or null]. Its check sum is the engine's to check: it read the file whole before sending it. */
export function decodeBlock(bytes, w, h) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (magic !== 'LSCB' || v.getUint16(4, true) !== 1) throw new Error('not a canvas block (format 1)');
    const flags = v.getUint16(6, true),
        n = w * h;
    if (v.getUint16(8, true) !== w || v.getUint16(10, true) !== h)
        throw new Error(`a block of ${v.getUint16(8, true)} by ${v.getUint16(10, true)} samples, not ${w} by ${h}`);
    const heights = new Float32Array(n);
    for (let k = 0; k < n; k++) heights[k] = v.getFloat32(12 + k * 4, true);
    let at = 12 + n * 4;
    const out = [heights];
    for (const layer of LAYERS.slice(1)) {
        if (layer.flag && !(flags & layer.flag)) {
            out.push(null);
            continue;
        }
        out.push(bytes.slice(at, at + n * layer.per));
        at += n * layer.per;
    }
    if (bytes.length !== at + 8) throw new Error('a block of the wrong length');
    return out;
}

/** Bytes as base64. */
export function toB64(bytes) {
    let bin = '';
    for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
    return btoa(bin);
}

/** Base64 as bytes. */
export function fromB64(text) {
    const bin = atob(text),
        out = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
    return out;
}
