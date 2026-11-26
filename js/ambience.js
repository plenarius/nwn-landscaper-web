// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Ambience tool's placements (nwn-landscaper's docs/DESIGN-ambience.md, "Placing them: the Ambience tool"): the particle
// pack's kinds, the particles they keep alive against the area's cap, Fill's rules and the brush. The engine bakes the list
// into the tiles on export (its `ambience` header: `{ kind, x, y, z, scale, seed, bearing }`, area metres, bearing in radians
// anticlockwise from east).

import { SPACING } from './area.js';
import { at as entranceAt } from './entrance.js';

/** The most particles an area's placements may keep alive together, by day or at night: the engine skips placements past it
 *  (its `ambience::AREA_LIVE_MAX`, the design's budget for a view). */
export const AREA_LIVE_MAX = 1500;
/** From this share of the cap the count is drawn as a warning. */
export const LIVE_WARN = 0.9;

/** The game's sun and moon shine from towards (4000, 4500) (view.js): the light shafts' tops lean that way, so the light falls
 *  away from it. */
export const SUN_BEARING = Math.atan2(4500, 4000);

/** Where the wind can blow towards, for the kinds that blow along their model's +x (snow, sand): bearing in radians. */
export const WINDS = [
    ['east', 0],
    ['north-east', Math.PI / 4],
    ['north', Math.PI / 2],
    ['north-west', (3 * Math.PI) / 4],
    ['west', Math.PI],
    ['south-west', (-3 * Math.PI) / 4],
    ['south', -Math.PI / 2],
    ['south-east', -Math.PI / 4],
];

/** The kinds the pack turns by a placement's bearing (its README, "Direction"): snow and sand blow along it, the shafts lean
 *  towards it. */
export const TURNS = { snow: 'wind', sand: 'wind', shafts: 'sun' };

/** Metres between placements of a kind at density 1 (Fill and the brush): about the reach of one placement's particles, so
 *  neighbours meet. A kind not listed takes DEFAULT_SPACING. */
export const SPACINGS = {
    mist: 6,
    waterfall: 5,
    rapids: 4,
    fireflies: 6,
    motes: 7,
    leaves: 4,
    snow: 9,
    sand: 6,
    embers: 2,
    shafts: 10,
    groundfog: 10,
};
const DEFAULT_SPACING = 8;

// Fill's measures (the design's rules, and what each needs to tell its places apart).
/** Water at least this far from its shore counts as wide: the most mist. */
const WIDE = 8;
/** Water levels that differ by this much where they meet make a waterfall; less (down to STEP_MIN) makes rapids. */
const FALL = 1;
const STEP_MIN = 0.25;
/** Two bodies of water "meet" when their water is this close (m): a dam or a lip between them. */
const MEET = 2.5;
/** A river's bed falling more than RAPID_DROP over RAPID_RUN metres is rapids, in water no wider than twice RIVER_HALF. */
const RAPID_RUN = 4;
const RAPID_DROP = 1;
const RIVER_HALF = 6;
/** Fireflies keep to grass within this many metres of water. */
const FIREFLY_REACH = 10;
/** Gaps in tree cover from GAP_MIN to GAP_MAX metres across get motes and light shafts. */
const GAP_MIN = 4;
const GAP_MAX = 12;
/** Ground fog lies in hollows lower than all ground within HOLLOW_REACH metres, by HOLLOW_RISE somewhere along every way out. */
const HOLLOW_REACH = 15;
const HOLLOW_RISE = 0.5;
/** How much lower nearby ground may be and still leave a point in a hollow's floor: a hollow's bottom is a point or a few, and
 *  Fill looks a metre apart. */
const HOLLOW_FLOOR = 0.25;
/** A dune crest stands this much over the ground CREST_RUN metres to either side; a snowy ridge RIDGE_RISE over RIDGE_RUN. */
const CREST_RUN = 3;
const CREST_RISE = 0.3;
const RIDGE_RUN = 5;
const RIDGE_RISE = 1;
/** Words of a placeable's name that make it a tree (models.js's tree chip), unless one of NOT_TREE is there too. */
const TREE_WORDS = new Set(['tree', 'trees']);
const NOT_TREE = new Set(['stump', 'log', 'logs', 'trunk', 'dead', 'fallen', 'sapling']);
/** Words that make a placeable a fire, for embers. */
const FIRE_WORDS = new Set(['fire', 'campfire', 'bonfire', 'firepit', 'brazier', 'pyre', 'fireplace']);

/** The pack's kinds (the engine's /api/particles, the pack's `pack.json`) as the tool uses them: `{ id, name, where, shows
 *  ('always', 'day' or 'night'), live: { day, night }, day, night (CSS colours of its first emitter's look) }`. */
export function kindsOf(pack) {
    const hex = c =>
        `#${(Array.isArray(c) ? c : [1, 1, 1])
            .slice(0, 3)
            .map(v =>
                Math.round(Math.min(Math.max(+v || 0, 0), 1) * 255)
                    .toString(16)
                    .padStart(2, '0'),
            )
            .join('')}`;
    return (pack?.kinds ?? [])
        .filter(k => typeof k?.id === 'string' && k.id)
        .map(k => {
            const look = Object.values(k.emitters ?? {})[0] ?? {};
            return {
                id: k.id.toLowerCase(),
                name: k.name || k.id,
                where: k.where ?? '',
                shows: ['day', 'night'].includes(k.shows) ? k.shows : 'always',
                live: { day: +k.live?.day || 0, night: +k.live?.night || 0 },
                day: hex(look.day?.colorStart),
                night: hex(look.night?.colorStart),
            };
        });
}

/** The particles `list`'s placements keep alive, `{ day, night }`, by the kinds of `kinds` (a kind it doesn't know counts 0: the
 *  engine skips it). */
export function liveOf(list, kinds) {
    const by = new Map(kinds.map(k => [k.id, k.live]));
    let day = 0,
        night = 0;
    for (const p of list) {
        const l = by.get(p.kind);
        if (l) {
            day += l.day;
            night += l.night;
        }
    }
    return { day, night };
}

/** Whether one more placement of `kind` keeps `live` within `cap`, by day and at night. */
export function fits(live, kind, cap = AREA_LIVE_MAX) {
    return live.day + kind.live.day <= cap + 1e-3 && live.night + kind.live.night <= cap + 1e-3;
}

/** The height a placement at (x, y) stands at: the water's surface where there is water (mist and spray float on it), else the
 *  ground. The engine bakes the model's root there. */
export function surfaceAt(area, x, y) {
    const { i, j } = area.sampleAt(x, y);
    const level = area.waterLevel[j * area.nx + i];
    const ground = area.heightAt(x, y);
    return Number.isNaN(level) ? ground : Math.max(level, ground);
}

/** The area's placements as the engine takes them (its header's `ambience`), each standing on the ground or water as they are
 *  now (sculpting after a Fill moves them with the ground); null when there are none. */
export function ambienceForExport(area) {
    if (!area.ambience?.length) return null;
    return area.ambience.map(p => ({ ...p, z: round(surfaceAt(area, p.x, p.y)) }));
}

const round = v => Math.round(v * 100) / 100;

/** A placement of kind `id` at (x, y), with a seed for the editor's drawing and the bearing its kind turns by. */
function placement(area, id, x, y, rand, { wind = 0, bearing = null } = {}) {
    const p = { kind: id, x: round(x), y: round(y), z: round(surfaceAt(area, x, y)), scale: 1, seed: Math.floor(rand() * 2 ** 31) };
    const turn = TURNS[id];
    if (turn) p.bearing = round(bearing ?? (turn === 'wind' ? wind : SUN_BEARING));
    return p;
}

/** A word list of a placeable's name, label and model, lower case. */
const wordsOf = text =>
    String(text ?? '')
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter(Boolean);
/** Whether a placeable named `text` is a tree with leaves (models.js's tree chip, without stumps, logs and dead trees). */
export const isTreeName = text => {
    const w = wordsOf(text);
    return w.some(x => TREE_WORDS.has(x)) && !w.some(x => NOT_TREE.has(x));
};
/** Whether a placeable named `text` is a fire. */
export const isFireName = text => wordsOf(text).some(x => FIRE_WORDS.has(x));

/** What Fill reads of the area that isn't in it: `nameOf(o)` (object `o`'s placeable's name, label and model), `crownOf(o)`
 *  (its crown's radius in metres, null when unknown) and `categoryOf(textureId)` (the texture library's category). */
const NO_ENV = { nameOf: o => o.model ?? '', crownOf: () => null, categoryOf: () => '' };

/** The ground as Fill's rules read it, each measure worked out once when a rule first asks. */
class Ground {
    constructor(area, env) {
        this.area = area;
        this.env = { ...NO_ENV, ...env };
    }

    /** Sample (i, j)'s water level, NaN when dry. */
    level(i, j) {
        return this.area.waterLevel[j * this.area.nx + i];
    }

    wet(i, j) {
        return !Number.isNaN(this.level(i, j));
    }

    /** Whether nothing can be placed on sample (i, j): a cave's rock or a chasm. */
    blocked(i, j) {
        return this.area.void(i, j) || this.area.isChasm(i, j);
    }

    /** Metres from each sample to the nearest wet one (0 on water; Infinity with no water). */
    get toWater() {
        this._toWater ??= distance(this.area.nx, this.area.ny, k => !Number.isNaN(this.area.waterLevel[k]));
        return this._toWater;
    }

    /** Metres from each sample to the nearest dry one (0 on dry ground): how far out on the water. */
    get toShore() {
        this._toShore ??= distance(this.area.nx, this.area.ny, k => Number.isNaN(this.area.waterLevel[k]));
        return this._toShore;
    }

    /** The texture category at (x, y), with a guess from the texture's id when the library doesn't say. */
    category(x, y) {
        const id = this.area.textureAt(x, y) ?? '';
        const c = this.env.categoryOf(id);
        if (c) return c;
        const lower = id.toLowerCase();
        return lower.includes('snow') ? 'Snow' : lower.includes('sand') ? 'Sand' : lower.includes('grass') ? 'Grass' : '';
    }

    /** The baked and placed trees: `{ x, y, z, crown }` (crown: radius in metres; 3 m when the model's size is unknown). */
    get trees() {
        this._trees ??= this.area.objects
            .filter(o => isTreeName(this.env.nameOf(o)))
            .map(o => ({ x: o.x, y: o.y, z: o.z ?? this.area.heightAt(o.x, o.y), crown: this.env.crownOf(o) ?? 3 * (o.scale ?? 1) }));
        return this._trees;
    }

    /** The tree cover on a 1 m grid (`cover[y * w + x]` 1 under a crown) and each cell's distance to it, metres. */
    get cover() {
        if (this._cover) return this._cover;
        const w = Math.ceil(this.area.sizeX) + 1,
            h = Math.ceil(this.area.sizeY) + 1,
            cover = new Uint8Array(w * h);
        for (const t of this.trees) {
            const r = Math.max(t.crown, 0.5);
            for (let y = Math.max(0, Math.floor(t.y - r)); y <= Math.min(h - 1, Math.ceil(t.y + r)); y++)
                for (let x = Math.max(0, Math.floor(t.x - r)); x <= Math.min(w - 1, Math.ceil(t.x + r)); x++)
                    if (Math.hypot(x - t.x, y - t.y) <= r) cover[y * w + x] = 1;
        }
        // (distance() counts in grid steps; the grid is 1 m)
        const to = distance(w, h, k => cover[k] === 1, 1);
        this._cover = { w, h, cover, to };
        return this._cover;
    }

    /** Places where two bodies of water of different levels meet (within MEET metres): `{ x, y, drop }` at the lower one's
     *  edge, `drop` the difference in metres. */
    get steps() {
        if (this._steps) return this._steps;
        const a = this.area,
            reach = Math.round(MEET / SPACING),
            out = [];
        for (let j = 0; j < a.ny; j += 2)
            for (let i = 0; i < a.nx; i += 2) {
                const l = this.level(i, j);
                if (Number.isNaN(l)) continue;
                let drop = 0;
                for (let dj = -reach; dj <= reach; dj++)
                    for (let di = -reach; di <= reach; di++) {
                        const ii = i + di,
                            jj = j + dj;
                        if (ii < 0 || jj < 0 || ii >= a.nx || jj >= a.ny || di * di + dj * dj > reach * reach) continue;
                        const up = this.level(ii, jj);
                        if (up - l > drop) drop = up - l;
                    }
                if (drop >= STEP_MIN) out.push({ x: i * SPACING, y: j * SPACING, drop });
            }
        this._steps = out;
        return out;
    }

    /** Whether the river bed at sample (i, j) falls faster than RAPID_DROP in RAPID_RUN metres: water no wider than twice
     *  RIVER_HALF, the bed a sample away from its banks at both ends (so a lake's steep shore isn't rapids). */
    steepBed(i, j) {
        const a = this.area,
            n = a.nx,
            k = j * n + i,
            shore = this.toShore,
            run = RAPID_RUN / SPACING;
        if (!this.wet(i, j) || shore[k] > RIVER_HALF || shore[k] < 2 * SPACING) return false;
        for (let d = 0; d < 8; d++) {
            const ii = Math.round(i + Math.cos((d * Math.PI) / 4) * run),
                jj = Math.round(j + Math.sin((d * Math.PI) / 4) * run);
            if (ii < 0 || jj < 0 || ii >= n || jj >= a.ny || !this.wet(ii, jj) || shore[jj * n + ii] < 2 * SPACING) continue;
            // (the same body's water: across a dam it is another's, and that is a fall or rapids between them)
            if (Math.abs(this.level(ii, jj) - this.level(i, j)) > 0.01) continue;
            if (Math.abs(a.heights[k] - a.heights[jj * n + ii]) > RAPID_DROP) return true;
        }
        return false;
    }

    /** Whether (x, y) is lower than all ground within HOLLOW_REACH metres: none of it lower, and along each of 16 ways out it
     *  rises HOLLOW_RISE over this point somewhere (so a flat or a valley open at one end isn't a hollow). */
    hollow(x, y) {
        const a = this.area,
            z = a.heightAt(x, y);
        // (most ground has lower ground within 2 m: a quick no before the 16 ways out)
        for (let d = 0; d < 8; d++) {
            const px = x + Math.cos((d * Math.PI) / 4) * 2,
                py = y + Math.sin((d * Math.PI) / 4) * 2;
            if (px >= 0 && py >= 0 && px <= a.sizeX && py <= a.sizeY && a.heightAt(px, py) < z - HOLLOW_FLOOR) return false;
        }
        for (let d = 0; d < 16; d++) {
            const c = Math.cos((d * Math.PI) / 8),
                s = Math.sin((d * Math.PI) / 8);
            let rises = false;
            for (let r = 1; r <= HOLLOW_REACH; r += 1) {
                const px = x + c * r,
                    py = y + s * r;
                if (px < 0 || py < 0 || px > a.sizeX || py > a.sizeY) break;
                const h = a.heightAt(px, py);
                if (h < z - HOLLOW_FLOOR) return false;
                if (h >= z + HOLLOW_RISE) rises = true;
            }
            if (!rises) return false;
        }
        return true;
    }

    /** Whether (x, y) stands `rise` metres over the ground `run` metres to either side along one of four axes: a crest. */
    crest(x, y, run, rise) {
        const a = this.area,
            z = a.heightAt(x, y);
        for (let d = 0; d < 4; d++) {
            const c = Math.cos((d * Math.PI) / 4) * run,
                s = Math.sin((d * Math.PI) / 4) * run;
            const inside = (px, py) => px >= 0 && py >= 0 && px <= a.sizeX && py <= a.sizeY;
            if (!inside(x + c, y + s) || !inside(x - c, y - s)) continue;
            if (a.heightAt(x + c, y + s) <= z - rise && a.heightAt(x - c, y - s) <= z - rise) return true;
        }
        return false;
    }

    /** The middles of gaps GAP_MIN to GAP_MAX metres across in the tree cover: open cells as far from it as anything near them,
     *  half a gap's width from it, with cover on at least six of eight ways out. `[{ x, y }]`. */
    get gaps() {
        if (this._gaps) return this._gaps;
        const out = [];
        if (this.trees.length) {
            const { w, h, cover, to } = this.cover;
            for (let y = 1; y < h - 1; y++)
                for (let x = 1; x < w - 1; x++) {
                    const k = y * w + x,
                        d = to[k];
                    if (cover[k] || d < GAP_MIN / 2 || d > GAP_MAX / 2) continue;
                    let top = true;
                    for (let dy = -1; dy <= 1 && top; dy++) for (let dx = -1; dx <= 1; dx++) if (to[k + dy * w + dx] > d) top = false;
                    if (!top) continue;
                    let shut = 0;
                    for (let r = 0; r < 8; r++) {
                        const c = Math.cos((r * Math.PI) / 4),
                            s = Math.sin((r * Math.PI) / 4);
                        for (let t = 1; t <= 2 * d + 2; t++) {
                            const px = Math.round(x + c * t),
                                py = Math.round(y + s * t);
                            if (px < 0 || py < 0 || px >= w || py >= h) break;
                            if (cover[py * w + px]) {
                                shut++;
                                break;
                            }
                        }
                    }
                    if (shut >= 6) out.push({ x, y });
                }
        }
        this._gaps = out;
        return out;
    }
}

/** Each cell's distance (in `step` metres a cell, SPACING by default) to the nearest cell where `is(k)`, on a `w` by `h` grid
 *  (rows from the south): a two-pass chamfer, within 8% of the true distance. Infinity where there is none. */
function distance(w, h, is, step = SPACING) {
    const d = new Float32Array(w * h);
    for (let k = 0; k < d.length; k++) d[k] = is(k) ? 0 : Infinity;
    const D = Math.SQRT2;
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const k = y * w + x;
            let v = d[k];
            if (x > 0) v = Math.min(v, d[k - 1] + 1);
            if (y > 0) {
                v = Math.min(v, d[k - w] + 1);
                if (x > 0) v = Math.min(v, d[k - w - 1] + D);
                if (x < w - 1) v = Math.min(v, d[k - w + 1] + D);
            }
            d[k] = v;
        }
    for (let y = h - 1; y >= 0; y--)
        for (let x = w - 1; x >= 0; x--) {
            const k = y * w + x;
            let v = d[k];
            if (x < w - 1) v = Math.min(v, d[k + 1] + 1);
            if (y < h - 1) {
                v = Math.min(v, d[k + w] + 1);
                if (x < w - 1) v = Math.min(v, d[k + w + 1] + D);
                if (x > 0) v = Math.min(v, d[k + w - 1] + D);
            }
            d[k] = v;
        }
    for (let k = 0; k < d.length; k++) d[k] *= step;
    return d;
}

/** Points spread over the area about `spacing` metres apart: one at a random spot in each cell of a grid that size. */
function* spread(area, spacing, rand) {
    for (let y = 0; y < area.sizeY; y += spacing)
        for (let x = 0; x < area.sizeX; x += spacing) {
            const px = x + rand() * spacing,
                py = y + rand() * spacing;
            if (px > 0.5 && py > 0.5 && px < area.sizeX - 0.5 && py < area.sizeY - 0.5) yield [px, py];
        }
}

/** The points of a 1 m grid over the area where `test(x, y)` holds: for places that are lines or spots (a crest, a hollow's
 *  floor), which a spread at a kind's spacing would mostly miss. */
function scan(area, test) {
    const out = [];
    for (let y = 0.5; y < area.sizeY; y += 1) for (let x = 0.5; x < area.sizeX; x += 1) if (test(x, y)) out.push({ x, y });
    return out;
}

/** `points` thinned so none is nearer another than `spacing`, in a random order. */
function thin(points, spacing, rand) {
    const order = points.map(p => [rand(), p]).sort((a, b) => a[0] - b[0]);
    const kept = [];
    for (const [, p] of order) if (!kept.some(q => Math.hypot(q.x - p.x, q.y - p.y) < spacing)) kept.push(p);
    return kept;
}

/** Fill's rules (the design's "Placing them"): by kind id, where on `g` (a Ground) a kind belongs, as points `{ x, y, bearing? }`
 *  about `spacing` metres apart. */
const RULES = {
    // On water, more where it is wide and still (rapids and falls churn it).
    mist(g, spacing, rand) {
        const out = [],
            a = g.area;
        for (const [x, y] of spread(a, spacing, rand)) {
            const { i, j } = a.sampleAt(x, y);
            if (!g.wet(i, j)) continue;
            const wide = Math.min(Math.max(g.toShore[j * a.nx + i] / WIDE, 0.15), 1);
            if (rand() < wide * (g.steepBed(i, j) ? 0.3 : 1)) out.push({ x, y });
        }
        return out;
    },
    // At the foot of a drop between two bodies of water.
    waterfall(g, spacing, rand) {
        return thin(
            g.steps.filter(s => s.drop >= FALL),
            spacing,
            rand,
        );
    },
    // Smaller steps between bodies of water, and a river's bed falling faster than RAPID_DROP in RAPID_RUN metres.
    rapids(g, spacing, rand) {
        const out = g.steps.filter(s => s.drop < FALL);
        for (const [x, y] of spread(g.area, spacing, rand)) {
            const { i, j } = g.area.sampleAt(x, y);
            if (g.steepBed(i, j)) out.push({ x, y });
        }
        return thin(out, spacing, rand);
    },
    // On walkable grass within FIREFLY_REACH metres of water.
    fireflies(g, spacing, rand) {
        const out = [],
            a = g.area;
        for (const [x, y] of spread(a, spacing, rand)) {
            const { i, j } = a.sampleAt(x, y);
            const k = j * a.nx + i;
            if (g.wet(i, j) || !a.walkable(i, j) || g.toWater[k] > FIREFLY_REACH || g.category(x, y) !== 'Grass') continue;
            out.push({ x, y });
        }
        return out;
    },
    // One under each tree's crown, near its trunk.
    leaves(g, _spacing, rand, density) {
        return g.trees
            .filter(() => rand() < density)
            .map(t => {
                const a = rand() * Math.PI * 2,
                    r = rand() * t.crown * 0.3;
                return { x: t.x + Math.cos(a) * r, y: t.y + Math.sin(a) * r };
            });
    },
    // In the gaps of the tree cover, and before each cave entrance.
    motes(g, spacing, rand, density) {
        return [...thin(g.gaps, spacing, rand), ...openings(g, rand, density, 1.5)];
    },
    // The same, the shafts leaning towards the sun; at a cave's mouth a little inside it, leaning out of it.
    shafts(g, spacing, rand, density) {
        return [...thin(g.gaps, spacing, rand), ...openings(g, rand, density, -0.5).map(p => ({ ...p, bearing: p.dir + Math.PI }))];
    },
    // Along sandy crests (dunes).
    sand(g, spacing, rand) {
        return crests(g, spacing, rand, 'Sand', CREST_RUN, CREST_RISE);
    },
    // Along snowy ridges.
    snow(g, spacing, rand) {
        return crests(g, spacing, rand, 'Snow', RIDGE_RUN, RIDGE_RISE);
    },
    // In hollows, on dry ground.
    groundfog(g, spacing, rand) {
        const a = g.area;
        const dry = (x, y) => {
            const { i, j } = a.sampleAt(x, y);
            return !g.wet(i, j);
        };
        return thin(
            scan(a, (x, y) => dry(x, y) && g.hollow(x, y)),
            spacing,
            rand,
        );
    },
    // Over each fire.
    embers(g, _spacing, rand, density) {
        return g.area.objects.filter(o => isFireName(g.env.nameOf(o)) && rand() < density).map(o => ({ x: o.x, y: o.y }));
    },
};

/** One point `out` metres before the mouth of each cave entrance (inside it when negative), kept at `density`. */
function openings(g, rand, density, out) {
    return g.area.entrances
        .filter(() => rand() < density)
        .map(e => {
            const [x, y] = entranceAt(e, -out, 0);
            return { x, y, dir: e.dir };
        });
}

function crests(g, spacing, rand, category, run, rise) {
    const a = g.area;
    const on = (x, y) => {
        const { i, j } = a.sampleAt(x, y);
        return !g.wet(i, j) && g.category(x, y) === category && g.crest(x, y, run, rise);
    };
    return thin(scan(a, on), spacing, rand);
}

/** The kinds Fill has a rule for. */
export const FILL_KINDS = Object.keys(RULES);

/** A random number generator from `seed`: the same numbers for the same seed (mulberry32), for tests and repeatable fills. */
export function seeded(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Where kind `id`'s Fill rule puts it on `area` at `density` (1: the kind's spacing), as placements, before the cap: for tests
 *  and Fill. `opts`: `wind` (bearing the wind blows towards), `rand`, `env` (see NO_ENV). */
export function propose(area, id, { density = 1, wind = 0, rand = Math.random, env = {}, ground = null } = {}) {
    const rule = RULES[id];
    if (!rule) return [];
    const g = ground ?? new Ground(area, env);
    const spacing = (SPACINGS[id] ?? DEFAULT_SPACING) / Math.sqrt(Math.max(density, 0.05));
    return rule(g, spacing, rand, Math.min(density, 1))
        .filter(p => {
            if (p.x < 0 || p.y < 0 || p.x >= area.sizeX || p.y >= area.sizeY) return false;
            const { i, j } = area.sampleAt(p.x, p.y);
            return !g.blocked(i, j);
        })
        .map(p => placement(area, id, p.x, p.y, rand, { wind, bearing: p.bearing ?? null }));
}

/** Fills `area` with kinds `ids` (of `kinds`, the pack's) by Fill's rules: their placements there were replaced by the rules'
 *  (other kinds' stay). Placements past the cap are left out, evenly across the kinds (in a random order, not the rules').
 *  Returns `{ placed, proposed, byKind: Map(id -> placed) }`; the caller begins the undo step. */
export function fill(area, kinds, ids, opts = {}) {
    const rand = opts.rand ?? Math.random,
        want = new Set(ids),
        ground = new Ground(area, opts.env);
    const keep = area.ambience.filter(p => !want.has(p.kind));
    const proposals = [];
    for (const id of ids) proposals.push(...propose(area, id, { ...opts, rand, ground }));
    const order = proposals.map(p => [rand(), p]).sort((a, b) => a[0] - b[0]);
    const byId = new Map(kinds.map(k => [k.id, k]));
    const live = liveOf(keep, kinds),
        byKind = new Map(ids.map(id => [id, 0])),
        placed = [];
    for (const [, p] of order) {
        const k = byId.get(p.kind);
        if (!k || !fits(live, k, opts.cap)) continue;
        live.day += k.live.day;
        live.night += k.live.night;
        byKind.set(p.kind, byKind.get(p.kind) + 1);
        placed.push(p);
    }
    // (in the area's order: by kind, then where the rules put them, so a save reads predictably)
    placed.sort((a, b) => ids.indexOf(a.kind) - ids.indexOf(b.kind) || proposals.indexOf(a) - proposals.indexOf(b));
    area.ambience = [...keep, ...placed];
    return { placed: placed.length, proposed: proposals.length, byKind };
}

/** Removes kinds `ids`' placements from `area`; returns how many went. */
export function clearKinds(area, ids) {
    const want = new Set(ids),
        was = area.ambience.length;
    area.ambience = area.ambience.filter(p => !want.has(p.kind));
    return was - area.ambience.length;
}

/** The brush at (x, y), `radius` metres: Shift (`erase`) clears kind `kind`'s placements under it; else a few tries at a random
 *  point under it, kept when no placement of the kind is nearer than its spacing at `density`, the point isn't rock or chasm,
 *  and the area stays within the cap. Returns `{ added, removed, capped }` (capped: a try was refused for the cap). */
export function ambienceStamp(area, kinds, kind, x, y, radius, { erase = false, density = 1, wind = 0, rand = Math.random, cap } = {}) {
    if (erase) {
        const was = area.ambience.length;
        area.ambience = area.ambience.filter(p => p.kind !== kind.id || Math.hypot(p.x - x, p.y - y) > radius);
        return { added: 0, removed: was - area.ambience.length, capped: false };
    }
    const spacing = (SPACINGS[kind.id] ?? DEFAULT_SPACING) / Math.sqrt(Math.max(density, 0.05));
    let added = 0,
        capped = false;
    for (let t = 0; t < 3; t++) {
        const a = rand() * Math.PI * 2,
            d = radius * Math.sqrt(rand());
        const px = x + Math.cos(a) * d,
            py = y + Math.sin(a) * d;
        if (px < 0.25 || py < 0.25 || px > area.sizeX - 0.25 || py > area.sizeY - 0.25) continue;
        const { i, j } = area.sampleAt(px, py);
        if (area.void(i, j) || area.isChasm(i, j)) continue;
        if (area.ambience.some(p => p.kind === kind.id && Math.hypot(p.x - px, p.y - py) < spacing)) continue;
        if (!fits(liveOf(area.ambience, kinds), kind, cap)) {
            capped = true;
            break;
        }
        area.ambience.push(placement(area, kind.id, px, py, rand, { wind }));
        added++;
    }
    return { added, removed: 0, capped };
}
