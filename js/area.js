// An NWN area being sculpted: its size in tiles and its heights in metres
// on landscaper's walkmesh sample grid (0.625 m, 16 cells a 10 m tile).
// Rows run from the south edge (NWN y = 0) north; each row west to east,
// the order `landscaper export` reads.

import { generateHeightMap } from './noise.js';
import { defaultAtmosphere, copyPreset, PRESETS } from './atmosphere.js';

export const TILE = 10;
export const DEFAULT_TEXTURE = 'grassMedium';
export const SPACING = 0.625;
export const SAMPLES_PER_TILE = TILE / SPACING;
// landscaper's slope limit: a sample is walkable if no neighbour rises more
// than this over one spacing (normal z >= 0.64, about 50 degrees).
const WALKABLE_NZ = 0.64;
export const MAX_RISE = SPACING * Math.sqrt(1 - WALKABLE_NZ * WALKABLE_NZ) / WALKABLE_NZ;
// Water deeper than this can't be walked (landscaper's SHALLOW).
export const SHALLOW = 0.5;
// A cave starts as rock this high over its floor; its tops (from VOID_BELOW
// under the roof up) are void, drawn black (landscaper's VOID_BELOW).
export const CAVE_ROCK = 6;
export const VOID_BELOW = 0.3;

export class Area {
    constructor(name, tiles, heights, materials, palette) {
        this.name = name;
        this.tiles = tiles;
        this.n = tiles * SAMPLES_PER_TILE + 1;
        this.size = tiles * TILE;
        this.heights = heights ?? new Float32Array(this.n * this.n);
        // The painted texture of each sample: an index into `palette`
        // (texture ids from the library catalog).
        this.materials = materials ?? new Uint8Array(this.n * this.n);
        this.palette = palette ?? [DEFAULT_TEXTURE];
        // Light and fog (see atmosphere.js).
        this.atmosphere = defaultAtmosphere();
        // Bodies of water, each filled from sample (i, j) to `level`; and
        // each sample's water level from them (NaN: dry), as landscaper
        // floods them.
        this.water = [];
        // Baked shadows' strength, 0 (none) to 1.
        this.shadow = 0.6;
        // Cave entrances (entrance.js).
        this.entrances = [];
        // Placeables: { id, model, appearance, x, y, z, bearing, scale,
        // solid, baked }; baked: false is a real placeable (object mode).
        this.objects = [];
        this.nextObjectId = 1;
        // 'surface', 'underground' (a cave dug out of rock up to `roof`) or
        // 'interior' (rooms cut out of a solid mass, the same way).
        this.kind = 'surface';
        this.roof = null;
        // The NWN module it is exported into (another area's, to link them).
        this.module = name;
        this.waterLevel = new Float32Array(this.n * this.n).fill(NaN);
        this.undoStack = [];
        this.redoStack = [];
    }

    /** Palette index of a texture id, adding it if new. */
    materialIndex(id) {
        let k = this.palette.indexOf(id);
        if (k < 0) {
            if (this.palette.length >= 255) throw new Error('at most 255 textures in one area');
            this.palette.push(id);
            k = this.palette.length - 1;
        }
        return k;
    }

    static create(name, tiles, start) {
        const area = new Area(name, tiles);
        const n = area.n;
        const base = 5;
        if (start === 'interior') {
            // A solid mass with walls of stone; rooms are cut out of it.
            area.kind = 'interior';
            area.roof = base + CAVE_ROCK;
            area.heights.fill(area.roof);
            area.palette = ['wallFieldstone'];
            area.atmosphere = copyPreset(PRESETS.find(p => p.id === 'indoors'));
            area.shadow = 0.6;
        } else if (start === 'cave') {
            // Solid rock to dig out: its floor at the base, its roof above.
            area.kind = 'underground';
            area.roof = base + CAVE_ROCK;
            area.heights.fill(area.roof);
            area.palette = ['rock'];
            area.atmosphere = copyPreset(PRESETS.find(p => p.id === 'cave'));
            area.shadow = 0.7;
        } else if (start === 'flat') {
            area.heights.fill(base);
        } else {
            // Rolling or rough hills from the upstream fBm noise, scaled to metres.
            const rough = start === 'rough';
            const noise = generateHeightMap({
                seed: Math.floor(Math.random() * 100000), mapSize: n,
                octaves: rough ? 6 : 4, persistence: rough ? 0.5 : 0.4, lacunarity: 2.1,
                scale: (rough ? 70 : 140) / SPACING, panX: 0, panY: 0, blackLevel: 0, whiteLevel: 1,
            });
            const amplitude = rough ? 14 : 6;
            for (let i = 0; i < n * n; i++) area.heights[i] = base + noise[i] * amplitude;
        }
        return area;
    }

    index(i, j) { return j * this.n + i; }

    /** Height at area metres (bilinear, clamped). */
    heightAt(x, y) {
        const n = this.n;
        const fx = Math.min(Math.max(x / SPACING, 0), n - 1);
        const fy = Math.min(Math.max(y / SPACING, 0), n - 1);
        const i = Math.min(Math.floor(fx), n - 2), j = Math.min(Math.floor(fy), n - 2);
        const tx = fx - i, ty = fy - j;
        const h = this.heights;
        const a = h[j * n + i] + (h[j * n + i + 1] - h[j * n + i]) * tx;
        const b = h[(j + 1) * n + i] + (h[(j + 1) * n + i + 1] - h[(j + 1) * n + i]) * tx;
        return a + (b - a) * ty;
    }

    /** Each body's samples: joined to its own (4-connected) through samples
     *  lower than its level. */
    flood(body) {
        const n = this.n, h = this.heights, wet = new Uint8Array(n * n);
        if (body.i < 0 || body.j < 0 || body.i >= n || body.j >= n) return wet;
        const stack = [body.j * n + body.i];
        while (stack.length) {
            const k = stack.pop();
            if (wet[k] || h[k] >= body.level) continue;
            wet[k] = 1;
            const x = k % n, y = (k / n) | 0;
            if (x > 0) stack.push(k - 1);
            if (x + 1 < n) stack.push(k + 1);
            if (y > 0) stack.push(k - n);
            if (y + 1 < n) stack.push(k + n);
        }
        return wet;
    }

    /** Recomputes waterLevel from the bodies (after the ground or water changed). */
    floodWater() {
        const level = this.waterLevel.fill(NaN);
        for (const b of this.water) {
            const wet = this.flood(b);
            for (let k = 0; k < wet.length; k++) {
                if (wet[k] && !(level[k] >= b.level)) level[k] = b.level;
            }
        }
    }

    /** The body of water over sample (i, j), if any (the highest). */
    bodyAt(i, j) {
        const k = j * this.n + i;
        let best = null;
        for (const b of this.water) if (this.flood(b)[k] && (!best || b.level > best.level)) best = b;
        return best;
    }

    /** Water depth over sample (i, j) (0 when dry). */
    depth(i, j) {
        const k = j * this.n + i, l = this.waterLevel[k];
        return Number.isNaN(l) ? 0 : l - this.heights[k];
    }

    /** Whether ground at sample (i, j) is walkable by landscaper's rule. */
    /** Whether sample (i, j) is a cave's void (rock at its roof). */
    void(i, j) {
        return this.enclosed() && this.heights[j * this.n + i] >= this.roof - VOID_BELOW;
    }

    /** A cave or an interior: dug out of a mass, its tops void, no sky. */
    enclosed() {
        return this.kind === 'underground' || this.kind === 'interior';
    }

    walkable(i, j) {
        const n = this.n, h = this.heights, z = h[j * n + i];
        if (this.depth(i, j) > SHALLOW || this.void(i, j)) return false;
        if (i > 0 && Math.abs(h[j * n + i - 1] - z) > MAX_RISE) return false;
        if (i < n - 1 && Math.abs(h[j * n + i + 1] - z) > MAX_RISE) return false;
        if (j > 0 && Math.abs(h[(j - 1) * n + i] - z) > MAX_RISE) return false;
        if (j < n - 1 && Math.abs(h[(j + 1) * n + i] - z) > MAX_RISE) return false;
        return true;
    }

    // Undo: a snapshot of heights and paint before each stroke.
    snapshot() { return { h: this.heights.slice(), m: this.materials.slice(), p: this.palette.slice(), w: this.water.map(b => ({ ...b })), e: this.entrances.map(e => ({ ...e })), o: this.objects.map(o => ({ ...o })) }; }
    restore(s) { this.heights.set(s.h); this.materials.set(s.m); this.palette = s.p.slice(); this.water = s.w.map(b => ({ ...b })); this.entrances = s.e.map(e => ({ ...e })); this.objects = s.o.map(o => ({ ...o })); this.floodWater(); }

    beginStroke() {
        this.undoStack.push(this.snapshot());
        if (this.undoStack.length > 40) this.undoStack.shift();
        this.redoStack = [];
    }

    undo() {
        if (!this.undoStack.length) return false;
        this.redoStack.push(this.snapshot());
        this.restore(this.undoStack.pop());
        return true;
    }

    redo() {
        if (!this.redoStack.length) return false;
        this.undoStack.push(this.snapshot());
        this.restore(this.redoStack.pop());
        return true;
    }

    // Saved in the browser between sessions.
    toJSON() {
        return {
            name: this.name, tiles: this.tiles,
            heights: toBase64(new Uint8Array(this.heights.buffer.slice(0))),
            materials: toBase64(this.materials), palette: this.palette,
            atmosphere: this.atmosphere, water: this.water, shadow: this.shadow, entrances: this.entrances, objects: this.objects, nextObjectId: this.nextObjectId, kind: this.kind, roof: this.roof, module: this.module,
        };
    }

    static fromJSON(o) {
        const heights = new Float32Array(fromBase64(o.heights).buffer);
        const materials = o.materials ? fromBase64(o.materials) : undefined;
        const area = new Area(o.name, o.tiles, heights, materials, o.palette);
        if (o.atmosphere) area.atmosphere = o.atmosphere;
        if (typeof o.shadow === 'number') area.shadow = o.shadow;
        if (o.entrances) area.entrances = o.entrances;
        if (o.objects) area.objects = o.objects;
        if (o.kind) { area.kind = o.kind; area.roof = o.roof; }
        if (o.module) area.module = o.module;
        area.nextObjectId = o.nextObjectId ?? Math.max(0, ...area.objects.map(x => x.id ?? 0)) + 1;
        if (o.water) { area.water = o.water; area.floodWater(); }
        return area;
    }
}

function toBase64(bytes) {
    let bin = '';
    for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
    return btoa(bin);
}

function fromBase64(text) {
    const bin = atob(text);
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    return bytes;
}
