// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// An NWN area being sculpted: its size in tiles and its heights in metres
// on landscaper's walkmesh sample grid (0.625 m, 16 cells a 10 m tile).
// Rows run from the south edge (NWN y = 0) north; each row west to east,
// the order `landscaper export` reads.

import { generateHeightMap } from './noise.js';
import { defaultAtmosphere, copyPreset, PRESETS } from './atmosphere.js';

export const TILE = 10;
export const DEFAULT_TEXTURE = 'grassMedium';
export const SPACING = 0.625;
const SAMPLES_PER_TILE = TILE / SPACING;
// landscaper's slope limit: a sample is walkable if no neighbour rises more
// than this over one spacing (normal z >= 0.64, about 50 degrees).
export const WALKABLE_NZ = 0.64;
export const MAX_RISE = (SPACING * Math.sqrt(1 - WALKABLE_NZ * WALKABLE_NZ)) / WALKABLE_NZ;
// Water deeper than this can't be walked (landscaper's SHALLOW).
export const SHALLOW = 0.5;
// Water shallower than this is dry ground (landscaper's WET_DEPTH): the game draws it almost clear, so it reads as dry.
export const WET_DEPTH = 0.15;
// A cave starts as rock this high over its floor; its tops (from VOID_BELOW
// under the roof up) are void, drawn black (landscaper's VOID_BELOW).
export const CAVE_ROCK = 6;
export const VOID_BELOW = 0.3;
// A chasm drops this far under its rim (the nearest ground that isn't chasm), and ground more than CHASM_BELOW under its rim is in
// it: nobody walks there. Its walls fade to black, all black from CHASM_DARK of the way down (landscaper's CHASM_DEPTH,
// CHASM_BELOW and CHASM_DARK).
export const CHASM_DEPTH = 20;
export const CHASM_BELOW = 0.3;
export const CHASM_DARK = 0.65;
// A tile's main lights are rows 0 to MAX_LIGHT of lightcolor.2da (the game's TILE_MAIN_LIGHT_COLOR_*; lights.js).
export const MAX_LIGHT = 31;
// Undo keeps this many steps.
export const UNDO_STEPS = 40;
// What undo brings back besides the ground's grids (heights, paint, chasm). Not `entranceNextId` (see the constructor).
const UNDO_FIELDS = [
    'palette',
    'water',
    'entrances',
    'objects',
    'things',
    'settings',
    'originals',
    'clearance',
    'atmosphere',
    'shadow',
    'ambience',
    'lights',
];

/** How bright a chasm wall is `t` of the way down (0 at the rim, 1 at the floor), in the game's colours: the fade landscaper
 *  bakes into its walls (shared.rs, chasm_fade). */
export function chasmFade(t) {
    return Math.max(0, 1 - t / CHASM_DARK) ** 1.6;
}

/** An area being edited: its ground (heights and textures on a 0.625 m grid), and the objects, water, entrances, things and
 *  settings on it, with undo. Saved and sent to the engine as JSON (toJSON, fromJSON). */
export class Area {
    /** `tiles` across (west to east), `tilesY` up (south to north). */
    constructor(name, tiles, heights, materials, palette, tilesY = tiles) {
        this.name = name;
        this.tiles = tiles;
        this.tilesY = tilesY;
        // Samples across and up (rows from the south, nx a row), and metres.
        this.nx = tiles * SAMPLES_PER_TILE + 1;
        this.ny = tilesY * SAMPLES_PER_TILE + 1;
        this.sizeX = tiles * TILE;
        this.sizeY = tilesY * TILE;
        this.heights = heights ?? new Float32Array(this.nx * this.ny);
        // The painted texture of each sample: an index into `palette`
        // (texture ids from the library catalog).
        this.materials = materials ?? new Uint8Array(this.nx * this.ny);
        this.palette = palette ?? [DEFAULT_TEXTURE];
        // Light and fog (see atmosphere.js).
        this.atmosphere = defaultAtmosphere();
        // Bodies of water, each filled from sample (i, j) to `level`; and
        // each sample's water level from them (NaN: dry), as landscaper
        // floods them.
        this.water = [];
        // The samples that drop away into a chasm (1), as a mask in the heights' order; null: none. Their heights stay as they
        // were (filling a chasm in brings the ground back); what is drawn and exported is chasmFit's.
        this.chasm = null;
        // Baked shadows' strength, 0 (none) to 1.
        this.shadow = 0.6;
        // Each tile's two main lights (the Light tool, lights.js): [light1, light2], rows of lightcolor.2da, tiles in rows from
        // the south, each west to east; null: all off (black).
        this.lights = null;
        // Cave entrances (entrance.js), each with an `id` that tags its door (`<area>_ent<id>`), and the next id to give.
        // An id is never given twice or changed: transitions and scripts name the door by its tag (the engine refuses an
        // export that reuses a taken-out entrance's id). So the counter only goes up: undo puts entrances back with their
        // ids but leaves it as it is.
        this.entrances = [];
        this.entranceNextId = 1;
        // Placeables: { id, model, appearance, x, y, z, bearing, scale,
        // solid, baked }; baked: false is a real placeable (object mode).
        this.objects = [];
        this.nextObjectId = 1;
        // Particles baked into the tiles on export (the Ambience tool, ambience.js): { kind, x, y, z, scale, seed, bearing }.
        this.ambience = [];
        // Creatures, waypoints, triggers, sounds... (things.js): { id, kind, blueprint, x, y, bearing, outline, tag, name,
        // vars, fields }. And the area's own settings (scripts, weather, music...): null until set.
        this.things = [];
        this.nextThingId = 1;
        this.settings = null;
        // A picture laid under the ground to trace over (underlay.js): where it lies { x, y, w, h, angle, opacity, shown };
        // the engine keeps the picture itself. null: none.
        this.underlay = null;
        // An imported area's own objects, as the editor changed them: { removed: ["Creature List:3"], moved: { "Placeable List:7": { x, y, bearing } } }.
        this.originals = { removed: [], moved: {}, edited: {} };
        // 'surface', 'underground' (a cave dug out of rock up to `roof`) or
        // 'interior' (rooms cut out of a solid mass, the same way).
        this.kind = 'surface';
        this.roof = null;
        // Metres of headroom the roof keeps over the floor everywhere (null: one flat roof, so a floor that drops gets more).
        this.clearance = null;
        // The NWN module it is exported into (another area's, to link them).
        this.module = name;
        this.waterLevel = new Float32Array(this.nx * this.ny).fill(NaN);
        // An id given when the area is made (New), kept in its saves: the engine refuses a save whose `created` differs from
        // its saved copy's, which is another area of the same name made since (from another tab or computer). null for an
        // area made before ids, or by the engine (an import).
        this.created = null;
        // Undo and redo: steps of the old values of what each changed (beginStroke), and the grids and fields as they were
        // when the last one began, to find what the next one changes (settle). null until the first step.
        this.undoStack = [];
        this.redoStack = [];
        this.undoBase = null;
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

    /** Whether texture `id` can be painted here: the area has it already, or room for one more (255 at most, as materials
     *  are bytes). materialIndex() throws otherwise. */
    canPaint(id) {
        return this.palette.includes(id) || this.palette.length < 255;
    }

    /** A new area; its ground (or a cave's floor) at `base` metres: start
     *  high to dig valleys and canyons down into it. */
    static create(name, tiles, start, base = 5, tilesY = tiles) {
        const area = new Area(name, tiles, undefined, undefined, undefined, tilesY);
        area.created = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
        const { nx, ny } = area;
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
                seed: Math.floor(Math.random() * 100000),
                width: nx,
                height: ny,
                octaves: rough ? 6 : 4,
                persistence: rough ? 0.5 : 0.4,
                lacunarity: 2.1,
                scale: (rough ? 70 : 140) / SPACING,
            });
            const amplitude = rough ? 14 : 6;
            for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) area.heights[j * nx + i] = base + noise[j * nx + i] * amplitude;
        }
        return area;
    }

    /** The sample nearest to area metres `x`, `y`: `{ i, j }`, clamped to the area. */
    sampleAt(x, y) {
        return {
            i: Math.min(Math.max(Math.round(x / SPACING), 0), this.nx - 1),
            j: Math.min(Math.max(Math.round(y / SPACING), 0), this.ny - 1),
        };
    }

    /** The texture id painted at the sample nearest to area metres `x`, `y`. */
    textureAt(x, y) {
        const { i, j } = this.sampleAt(x, y);
        return this.palette[this.materials[j * this.nx + i]];
    }

    /** Height at area metres (bilinear, clamped). */
    heightAt(x, y) {
        const n = this.nx;
        const fx = Math.min(Math.max(x / SPACING, 0), n - 1);
        const fy = Math.min(Math.max(y / SPACING, 0), this.ny - 1);
        const i = Math.min(Math.floor(fx), n - 2),
            j = Math.min(Math.floor(fy), this.ny - 2);
        const tx = fx - i,
            ty = fy - j;
        const h = this.heights;
        const a = h[j * n + i] + (h[j * n + i + 1] - h[j * n + i]) * tx;
        const b = h[(j + 1) * n + i] + (h[(j + 1) * n + i + 1] - h[(j + 1) * n + i]) * tx;
        return a + (b - a) * ty;
    }

    /** Each body's samples: joined to its own (4-connected) through samples
     *  lower than its level, within its bounds if it has them ([i0, j0, i1,
     *  j1]: an imported area's water stays where its tiles drew it). */
    flood(body) {
        const n = this.nx,
            rows = this.ny,
            h = this.heights,
            wet = new Uint8Array(n * rows);
        if (body.i < 0 || body.j < 0 || body.i >= n || body.j >= rows) return wet;
        const [i0, j0, i1, j1] = body.bounds ?? [0, 0, n - 1, rows - 1];
        const stack = [body.j * n + body.i];
        while (stack.length) {
            const k = stack.pop();
            const x = k % n,
                y = (k / n) | 0;
            // (water never runs into a chasm)
            if (wet[k] || h[k] >= body.level || x < i0 || x > i1 || y < j0 || y > j1 || this.chasm?.[k]) continue;
            wet[k] = 1;
            if (x > 0) stack.push(k - 1);
            if (x + 1 < n) stack.push(k + 1);
            if (y > 0) stack.push(k - n);
            if (y + 1 < rows) stack.push(k + n);
        }
        return wet;
    }

    /** Recomputes waterLevel from the bodies (after the ground or water changed); a sample under less than WET_DEPTH is
     *  dry, as landscaper exports it. */
    floodWater() {
        const level = this.waterLevel.fill(NaN),
            h = this.heights;
        for (const b of this.water) {
            const wet = this.flood(b);
            for (let k = 0; k < wet.length; k++) {
                if (wet[k] && !(level[k] >= b.level)) level[k] = b.level;
            }
        }
        for (let k = 0; k < level.length; k++) if (level[k] - h[k] < WET_DEPTH) level[k] = NaN;
    }

    /** The body of water over sample (i, j), if any (the highest); none where it is too shallow to show. */
    bodyAt(i, j) {
        const k = j * this.nx + i;
        if (Number.isNaN(this.waterLevel[k])) return null;
        let best = null;
        for (const b of this.water) if (this.flood(b)[k] && (!best || b.level > best.level)) best = b;
        return best;
    }

    /** Water depth over sample (i, j) (0 when dry). */
    depth(i, j) {
        const k = j * this.nx + i,
            l = this.waterLevel[k];
        return Number.isNaN(l) ? 0 : l - this.heights[k];
    }

    /** Whether sample (i, j) is a cave's void (rock at its roof). */
    void(i, j) {
        return this.enclosed() && this.heights[j * this.nx + i] >= this.roof - VOID_BELOW;
    }

    /** With a `clearance`, the roof follows the floor: each sample's ceiling is the nearest open ground's height plus the
     *  clearance, and the rock is cut down to it (as landscaper's fit_ceiling does). `ceiling` is each sample's roof and
     *  `shown` the heights with the rock cut down; null for one flat roof. */
    ceilingFit() {
        if (!this.enclosed() || !(this.clearance > 0)) return null;
        const { nx, ny, heights: h } = this,
            n = nx * ny,
            roof = this.roof;
        // (the two work arrays are kept between calls: the view fits the ceiling again on every frame of a stroke)
        if (this.fitWork?.from.length !== n) this.fitWork = { from: new Int32Array(n), queue: new Int32Array(n) };
        const { from, queue } = this.fitWork;
        from.fill(-1);
        let head = 0,
            tail = 0;
        for (let k = 0; k < n; k++)
            if (h[k] < roof - VOID_BELOW) {
                from[k] = k;
                queue[tail++] = k;
            }
        // Breadth first from all the open ground at once, the neighbours east, west, north, south in turn: this order decides
        // which of two open samples at the same distance gives the rock its ceiling, so it stays the same.
        while (head < tail) {
            const k = queue[head++],
                i = k % nx,
                f = from[k];
            if (i + 1 < nx && from[k + 1] < 0) {
                from[k + 1] = f;
                queue[tail++] = k + 1;
            }
            if (i > 0 && from[k - 1] < 0) {
                from[k - 1] = f;
                queue[tail++] = k - 1;
            }
            if (k + nx < n && from[k + nx] < 0) {
                from[k + nx] = f;
                queue[tail++] = k + nx;
            }
            if (k >= nx && from[k - nx] < 0) {
                from[k - nx] = f;
                queue[tail++] = k - nx;
            }
        }
        const ceiling = new Float32Array(n),
            shown = new Float32Array(h);
        for (let k = 0; k < n; k++) {
            ceiling[k] = from[k] < 0 ? roof : h[from[k]] + this.clearance;
            if (h[k] >= roof - VOID_BELOW) shown[k] = Math.min(ceiling[k], h[k]);
        }
        return { ceiling, shown };
    }

    /** Whether sample (i, j) drops away into a chasm. */
    isChasm(i, j) {
        return !!this.chasm?.[j * this.nx + i];
    }

    /** Whether any sample is in a chasm. */
    hasChasm() {
        return !!this.chasm?.includes(1);
    }

    /**
     * The chasm as it is drawn and exported (as landscaper's fit_chasm makes it), over `base` (the heights as drawn without it,
     * the ceiling's cut rock in a cave): each chasm sample's rim is the height of the nearest sample that isn't chasm (breadth
     * first, east, west, north, south in turn), and it lies CHASM_DEPTH under it. `shown` is the heights with the chasm dropped,
     * `deep` each sample's depth under its rim over CHASM_DEPTH (0 out of the chasm, 1 in it). null with no chasm.
     */
    chasmFit(base = this.heights) {
        if (!this.hasChasm()) return null;
        const { nx, chasm } = this,
            n = nx * this.ny;
        if (this.chasmWork?.from.length !== n) this.chasmWork = { from: new Int32Array(n), queue: new Int32Array(n) };
        const { from, queue } = this.chasmWork;
        from.fill(-1);
        let head = 0,
            tail = 0;
        for (let k = 0; k < n; k++)
            if (!chasm[k]) {
                from[k] = k;
                queue[tail++] = k;
            }
        while (head < tail) {
            const k = queue[head++],
                i = k % nx,
                f = from[k];
            if (i + 1 < nx && from[k + 1] < 0) {
                from[k + 1] = f;
                queue[tail++] = k + 1;
            }
            if (i > 0 && from[k - 1] < 0) {
                from[k - 1] = f;
                queue[tail++] = k - 1;
            }
            if (k + nx < n && from[k + nx] < 0) {
                from[k + nx] = f;
                queue[tail++] = k + nx;
            }
            if (k >= nx && from[k - nx] < 0) {
                from[k - nx] = f;
                queue[tail++] = k - nx;
            }
        }
        const shown = new Float32Array(base),
            deep = new Float32Array(n);
        for (let k = 0; k < n; k++) {
            if (!chasm[k]) continue;
            // (all of it chasm: no rim, so each sample its own)
            shown[k] = (from[k] < 0 ? base[k] : base[from[k]]) - CHASM_DEPTH;
            deep[k] = 1;
        }
        return { shown, deep };
    }

    /** The chasm as runs of samples, `[first, count]` each, for the engine (its header's `chasm`); null with none. */
    chasmRuns() {
        if (!this.hasChasm()) return null;
        const runs = [],
            c = this.chasm;
        for (let k = 0; k < c.length; k++) {
            if (!c[k]) continue;
            const first = k;
            while (k + 1 < c.length && c[k + 1]) k++;
            runs.push([first, k - first + 1]);
        }
        return runs;
    }

    /** A cave or an interior: dug out of a mass, its tops void, no sky. */
    enclosed() {
        return this.kind === 'underground' || this.kind === 'interior';
    }

    /** Whether ground at sample (i, j) is walkable by landscaper's rule. */
    walkable(i, j) {
        const n = this.nx,
            h = this.heights,
            z = h[j * n + i];
        if (this.depth(i, j) > SHALLOW || this.void(i, j)) return false;
        // In a chasm, or on its edge (the drop beside it is far steeper than MAX_RISE).
        const c = this.chasm,
            k = j * n + i;
        if (c && (c[k] || (i > 0 && c[k - 1]) || (i < n - 1 && c[k + 1]) || (j > 0 && c[k - n]) || (j < this.ny - 1 && c[k + n])))
            return false;
        if (i > 0 && Math.abs(h[j * n + i - 1] - z) > MAX_RISE) return false;
        if (i < n - 1 && Math.abs(h[j * n + i + 1] - z) > MAX_RISE) return false;
        if (j > 0 && Math.abs(h[(j - 1) * n + i] - z) > MAX_RISE) return false;
        if (j < this.ny - 1 && Math.abs(h[(j + 1) * n + i] - z) > MAX_RISE) return false;
        return true;
    }

    /** The state outside the ground's grids that undo brings back, as a copy: `before` for beginStroke, for a change confirmed
     *  later (a transform). The grids aren't copied: their changed rectangle is found when the step settles. */
    snapshot() {
        return { meta: structuredClone(pick(this, UNDO_FIELDS)) };
    }

    /**
     * Gives the entrances their ids when they have none (an area saved before ids): each its place in the list plus one, the
     * number its door's tag already had, so no tag changes. `next`: the counter saved with the area; it is raised past
     * every id there is, never lowered.
     */
    giveEntranceIds(next = 1) {
        const used = new Set(this.entrances.map(e => e.id).filter(id => Number.isInteger(id) && id > 0));
        let top = Math.max(0, ...used);
        this.entrances.forEach((e, k) => {
            if (Number.isInteger(e.id) && e.id > 0) return;
            // (one without an id among ones with: its place when free, else a new one)
            e.id = used.has(k + 1) ? ++top : k + 1;
            used.add(e.id);
            top = Math.max(top, e.id);
        });
        this.entranceNextId = Math.max(Number.isInteger(next) ? next : 1, top + 1);
    }

    /** A new entrance's id: the counter's, which then moves on. */
    newEntranceId() {
        return this.entranceNextId++;
    }

    /** Tile (tx, ty)'s two main lights, [light1, light2] (0: off). */
    lightAt(tx, ty) {
        return this.lights?.[ty * this.tiles + tx] ?? [0, 0];
    }

    /** Gives tile (tx, ty) the lights `pair`. Returns whether they changed. */
    setLight(tx, ty, pair) {
        const k = ty * this.tiles + tx,
            was = this.lightAt(tx, ty);
        if (was[0] === pair[0] && was[1] === pair[1]) return false;
        this.lights ??= Array.from({ length: this.tiles * this.tilesY }, () => [0, 0]);
        this.lights[k] = [pair[0], pair[1]];
        return true;
    }

    /** The tiles' lights as the engine takes them (its header's `lights`), null when every tile's are off. */
    lightsForExport() {
        return this.lights?.some(p => p[0] || p[1]) ? this.lights.map(p => [p[0], p[1]]) : null;
    }

    /** The tag of entrance `e`'s door, as the engine tags it (`entrance::door_tag`). */
    doorTag(e) {
        return `${this.name}_ent${e.id}`;
    }

    /**
     * One undo step begins: from the area as it is now, or from `before` (a snapshot() taken earlier, for a change confirmed
     * later; it holds only the state outside the grids, so the grids mustn't change between the two). A step keeps the old
     * values of the rectangle of samples it changed and of the fields it changed, never a copy of the whole area: 40 whole
     * copies of a 32×32 area held 63 MB. What it changed is found when the next step begins, or at undo (settle).
     */
    beginStroke(before = null) {
        this.settle(this.undoStack.at(-1), before?.meta);
        this.undoStack.push({ rect: null, h: null, m: null, ch: null, chNull: this.chasm === null, meta: {} });
        if (this.undoStack.length > UNDO_STEPS) this.undoStack.shift();
        this.redoStack = [];
    }

    undo() {
        return this.step(this.undoStack, this.redoStack);
    }

    redo() {
        return this.step(this.redoStack, this.undoStack);
    }

    /** Takes the last step off `from`, goes back to the state it holds, and puts the way back on `to`. */
    step(from, to) {
        if (!from.length) return false;
        this.settle(from.at(-1));
        to.push(this.apply(from.pop()));
        return true;
    }

    /**
     * Settles what changed since the undo base (`undoBase`: the grids and fields as they were when the last step began, or
     * the last undo or redo) into step `into`, then moves the base up to now. `into` is the step still being made, or the
     * last one when the change came without beginStroke: undo then takes it back with that step, as a whole snapshot did.
     * `meta`: the fields to settle, a snapshot()'s, instead of the area's own (beginStroke's `before`).
     */
    settle(into, meta = null) {
        const now = meta ?? this,
            n = this.nx * this.ny;
        const base = this.undoBase;
        if (base?.h.length !== n) {
            this.undoBase = {
                h: this.heights.slice(),
                m: this.materials.slice(),
                ch: this.chasm?.slice() ?? new Uint8Array(n),
                meta: structuredClone(pick(now, UNDO_FIELDS)),
            };
            return;
        }
        const rect = this.changedSince(base),
            fields = UNDO_FIELDS.filter(f => !same(now[f], base.meta[f]));
        if (into) {
            if (rect) widen(into, rect, base, this.nx);
            for (const f of fields) if (!(f in into.meta)) into.meta[f] = base.meta[f];
        }
        for (const f of fields) base.meta[f] = structuredClone(now[f]);
        if (!rect) return;
        const { nx } = this,
            c = this.chasm;
        for (let j = rect.j0; j <= rect.j1; j++) {
            const a = j * nx + rect.i0,
                b = j * nx + rect.i1 + 1;
            base.h.set(this.heights.subarray(a, b), a);
            base.m.set(this.materials.subarray(a, b), a);
            if (c) base.ch.set(c.subarray(a, b), a);
            else base.ch.fill(0, a, b);
        }
    }

    /** The samples whose height, paint or chasm differ from undo base `base` (i0..i1, j0..j1), null when none do. Heights are
     *  compared as bits, so a NaN is the same as itself. */
    changedSince(base) {
        const { nx, ny } = this,
            h = bits(this.heights),
            bh = bits(base.h),
            m = this.materials,
            bm = base.m,
            c = this.chasm,
            bc = base.ch;
        let i0 = nx,
            i1 = -1,
            j0 = -1,
            j1 = -1;
        for (let j = 0, k = 0; j < ny; j++) {
            let first = -1,
                last = -1;
            for (let i = 0; i < nx; i++, k++) {
                if (h[k] === bh[k] && m[k] === bm[k] && (c ? c[k] : 0) === bc[k]) continue;
                if (first < 0) first = i;
                last = i;
            }
            if (first < 0) continue;
            if (j0 < 0) j0 = j;
            j1 = j;
            if (first < i0) i0 = first;
            if (last > i1) i1 = last;
        }
        return j0 < 0 ? null : { i0, i1, j0, j1 };
    }

    /**
     * Goes back to the state step `s` holds, and returns the way back to now (a step of the same rectangle and fields). Notes
     * what changed in `lastChange`, for the view to redraw only that: `rect`, the samples whose height, paint or chasm differ
     * (i0..i1, j0..j1; null when none do, the whole area when the ceiling height differs); `heights`, those whose height or
     * chasm differ (the shadows follow the drawn heights, not the paint); `entrances`, the ones added, taken out or changed
     * (their dark mouths are in the shadows); and `shadow`, whether the shadows' strength differs.
     */
    apply(s) {
        const base = this.undoBase,
            { nx, ny } = this,
            back = { rect: s.rect, h: null, m: null, ch: null, chNull: this.chasm === null, meta: {} };
        let rect = null,
            heights = null;
        // (a state with a chasm array has one again, if only of zeros, as a whole snapshot gave it back)
        if (s.rect || !s.chNull) this.chasm ??= new Uint8Array(nx * ny);
        if (s.rect) {
            const { i0, i1, j0, j1 } = s.rect,
                size = (i1 - i0 + 1) * (j1 - j0 + 1);
            back.h = new Float32Array(size);
            back.m = new Uint8Array(size);
            back.ch = new Uint8Array(size);
            const h = this.heights,
                m = this.materials,
                c = this.chasm;
            for (let j = j0, r = 0; j <= j1; j++)
                for (let i = i0, k = j * nx + i0; i <= i1; i++, k++, r++) {
                    const oh = h[k],
                        om = m[k],
                        oc = c[k],
                        nh = s.h[r],
                        nm = s.m[r],
                        nc = s.ch[r];
                    back.h[r] = oh;
                    back.m[r] = om;
                    back.ch[r] = oc;
                    h[k] = base.h[k] = nh;
                    m[k] = base.m[k] = nm;
                    c[k] = base.ch[k] = nc;
                    const moved = oh !== nh || oc !== nc;
                    if (moved || om !== nm) rect = grow(rect, i, j);
                    // (a chasm opened or filled in moves the drawn ground, and so the shadows)
                    if (moved) heights = grow(heights, i, j);
                }
        }
        // (a state from before any chasm: none, once nothing is in one)
        if (s.chNull && this.chasm && !this.chasm.includes(1)) this.chasm = null;
        const was = this.entrances;
        let entrances = [],
            shadow = false;
        for (const f in s.meta) {
            if (f === 'clearance' && s.meta.clearance !== this.clearance) rect = { i0: 0, i1: nx - 1, j0: 0, j1: ny - 1 };
            if (f === 'shadow') shadow = s.meta.shadow !== this.shadow;
            if (f === 'entrances') {
                const key = e => JSON.stringify(e),
                    then = new Set(s.meta.entrances.map(key)),
                    now = new Set(was.map(key));
                entrances = [...s.meta.entrances.filter(e => !now.has(key(e))), ...was.filter(e => !then.has(key(e)))];
            }
            // (the base is a copy of now: it becomes the way back, and a new copy the base)
            back.meta[f] = base.meta[f];
            this[f] = s.meta[f];
            base.meta[f] = structuredClone(s.meta[f]);
        }
        this.floodWater();
        this.lastChange = { rect, heights, entrances, shadow };
        return back;
    }

    // Saved in the browser between sessions.
    toJSON() {
        return {
            name: this.name,
            tiles: this.tiles,
            tilesY: this.tilesY,
            heights: toBase64(new Uint8Array(this.heights.buffer.slice(0))),
            materials: toBase64(this.materials),
            chasm: this.hasChasm() ? toBase64(this.chasm) : null,
            palette: this.palette,
            atmosphere: this.atmosphere,
            water: this.water,
            shadow: this.shadow,
            lights: this.lightsForExport(),
            entrances: this.entrances,
            objects: this.objects,
            nextObjectId: this.nextObjectId,
            ambience: this.ambience,
            kind: this.kind,
            roof: this.roof,
            clearance: this.clearance,
            module: this.module,
            things: this.things,
            nextThingId: this.nextThingId,
            entranceNextId: this.entranceNextId,
            settings: this.settings,
            originals: this.originals,
            created: this.created,
            underlay: this.underlay,
        };
    }

    static fromJSON(o) {
        const heights = new Float32Array(fromBase64(o.heights).buffer);
        const materials = o.materials ? fromBase64(o.materials) : undefined;
        const area = new Area(o.name, o.tiles, heights, materials, o.palette, o.tilesY ?? o.tiles);
        if (typeof o.chasm === 'string' && o.chasm) {
            const chasm = fromBase64(o.chasm);
            if (chasm.length === area.nx * area.ny) area.chasm = chasm;
        }
        if (o.atmosphere) area.atmosphere = o.atmosphere;
        if (typeof o.shadow === 'number') area.shadow = o.shadow;
        if (validLights(o.lights, area.tiles * area.tilesY)) area.lights = o.lights;
        if (o.entrances) area.entrances = o.entrances;
        area.giveEntranceIds(o.entranceNextId);
        if (o.objects) area.objects = o.objects;
        if (validAmbience(o.ambience)) area.ambience = o.ambience;
        if (o.kind) {
            area.kind = o.kind;
            area.roof = o.roof;
            area.clearance = o.clearance ?? null;
        }
        if (o.module) area.module = o.module;
        if (typeof o.created === 'string' && o.created) area.created = o.created;
        if (Array.isArray(o.things)) area.things = o.things;
        area.nextThingId = o.nextThingId ?? Math.max(0, ...area.things.map(x => x.id ?? 0)) + 1;
        if (o.settings) area.settings = o.settings;
        if (o.underlay && typeof o.underlay === 'object') area.underlay = o.underlay;
        if (o.originals)
            area.originals = { removed: o.originals.removed ?? [], moved: o.originals.moved ?? {}, edited: o.originals.edited ?? {} };
        area.nextObjectId = o.nextObjectId ?? Math.max(0, ...area.objects.map(x => x.id ?? 0)) + 1;
        if (o.water) {
            area.water = o.water;
            area.floodWater();
        }
        return area;
    }
}

/** Whether `v` is a list of particle placements as an area keeps them (ambience.js): each a kind and a point. */
function validAmbience(v) {
    const n = x => typeof x === 'number' && Number.isFinite(x);
    return Array.isArray(v) && v.every(p => p && typeof p.kind === 'string' && p.kind && n(p.x) && n(p.y) && n(p.z));
}

/** Whether `v` is a whole area's tile lights: `tiles` pairs of rows of lightcolor.2da. */
function validLights(v, tiles) {
    const row = c => Number.isInteger(c) && c >= 0 && c <= MAX_LIGHT;
    return Array.isArray(v) && v.length === tiles && v.every(p => Array.isArray(p) && p.length === 2 && row(p[0]) && row(p[1]));
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

/** Fields `fields` of `o`, as an object of their own (not copied). */
function pick(o, fields) {
    return Object.fromEntries(fields.map(f => [f, o[f]]));
}

/** Whether `a` and `b` hold the same data: the same primitives, or arrays and plain objects with the same keys and values. */
function same(a, b) {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) if (!Object.hasOwn(b, k) || !same(a[k], b[k])) return false;
    return true;
}

/** Float32Array `a`'s bits, to compare samples exactly. */
const bits = a => new Uint32Array(a.buffer, a.byteOffset, a.length);

/** Rectangle `r` (null: none) grown to take in sample (i, j). */
function grow(r, i, j) {
    if (!r) return { i0: i, i1: i, j0: j, j1: j };
    if (i < r.i0) r.i0 = i;
    if (i > r.i1) r.i1 = i;
    if (j < r.j0) r.j0 = j;
    if (j > r.j1) r.j1 = j;
    return r;
}

/** Undo step `s` widened to take in rectangle `r` of an area `nx` samples across: the samples it held keep its values, the
 *  new ones take the undo base's `base` (the state before them, which the step never changed). */
function widen(s, r, base, nx) {
    const was = s.rect;
    if (was && r.i0 >= was.i0 && r.i1 <= was.i1 && r.j0 >= was.j0 && r.j1 <= was.j1) return;
    const u = was
        ? { i0: Math.min(was.i0, r.i0), i1: Math.max(was.i1, r.i1), j0: Math.min(was.j0, r.j0), j1: Math.max(was.j1, r.j1) }
        : { ...r };
    const w = u.i1 - u.i0 + 1,
        size = w * (u.j1 - u.j0 + 1),
        h = new Float32Array(size),
        m = new Uint8Array(size),
        ch = new Uint8Array(size);
    for (let j = u.j0, q = 0; j <= u.j1; j++, q += w) {
        const a = j * nx + u.i0;
        h.set(base.h.subarray(a, a + w), q);
        m.set(base.m.subarray(a, a + w), q);
        ch.set(base.ch.subarray(a, a + w), q);
        if (!was || j < was.j0 || j > was.j1) continue;
        const ww = was.i1 - was.i0 + 1,
            p = (j - was.j0) * ww,
            at = q + was.i0 - u.i0;
        h.set(s.h.subarray(p, p + ww), at);
        m.set(s.m.subarray(p, p + ww), at);
        ch.set(s.ch.subarray(p, p + ww), at);
    }
    Object.assign(s, { rect: u, h, m, ch });
}
