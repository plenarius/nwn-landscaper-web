// An NWN area being sculpted: its size in tiles and its heights in metres
// on landscaper's walkmesh sample grid (0.625 m, 16 cells a 10 m tile).
// Rows run from the south edge (NWN y = 0) north; each row west to east,
// the order `landscaper export` reads.

import { generateHeightMap } from './noise.js';
import { defaultAtmosphere } from './atmosphere.js';

export const TILE = 10;
export const DEFAULT_TEXTURE = 'grassMedium';
export const SPACING = 0.625;
export const SAMPLES_PER_TILE = TILE / SPACING;
// landscaper's slope limit: a sample is walkable if no neighbour rises more
// than this over one spacing (normal z >= 0.64, about 50 degrees).
const WALKABLE_NZ = 0.64;
export const MAX_RISE = SPACING * Math.sqrt(1 - WALKABLE_NZ * WALKABLE_NZ) / WALKABLE_NZ;

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
        if (start === 'flat') {
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

    /** Whether ground at sample (i, j) is walkable by landscaper's rule. */
    walkable(i, j) {
        const n = this.n, h = this.heights, z = h[j * n + i];
        if (i > 0 && Math.abs(h[j * n + i - 1] - z) > MAX_RISE) return false;
        if (i < n - 1 && Math.abs(h[j * n + i + 1] - z) > MAX_RISE) return false;
        if (j > 0 && Math.abs(h[(j - 1) * n + i] - z) > MAX_RISE) return false;
        if (j < n - 1 && Math.abs(h[(j + 1) * n + i] - z) > MAX_RISE) return false;
        return true;
    }

    // Undo: a snapshot of heights and paint before each stroke.
    snapshot() { return { h: this.heights.slice(), m: this.materials.slice(), p: this.palette.slice() }; }
    restore(s) { this.heights.set(s.h); this.materials.set(s.m); this.palette = s.p.slice(); }

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
            atmosphere: this.atmosphere,
        };
    }

    static fromJSON(o) {
        const heights = new Float32Array(fromBase64(o.heights).buffer);
        const materials = o.materials ? fromBase64(o.materials) : undefined;
        const area = new Area(o.name, o.tiles, heights, materials, o.palette);
        if (o.atmosphere) area.atmosphere = o.atmosphere;
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
