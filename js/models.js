// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The game's placeables, the module's haks' with them, from landscaper serve
// (/api/placeables, /api/model/<resref>, /api/texture/<name>): the list to
// search, each model as a three.js group (its textured triangles, at rest),
// and small thumbnails.
//
// Models come in NWN axes (x east, y north, z up); a group has three.js's
// (x, z, -y), so an object stands with position (x, height, size - y) and
// turns by rotation.y = its bearing.

import * as THREE from 'three';
import { api, json } from './api.js';
import { thumbnail } from './thumbnail.js';

/** What a search shows at a time; "Show more" adds as many again. */
export const PAGE = 48;

/** The plant groups the engine measures (plants.rs), by the chip that shows each. */
export const GROUPS = { 'small plants': 'small', 'large plants': 'large' };
/** The quick buttons' searches match whole words, and these forms of them: `rock` finds rocks and rocky ground but not a
 *  rocking chair. Anything typed matches anywhere in a word, as before. */
export const WHOLE = {
    rock: ['rock', 'rocks', 'rocky'],
    boulder: ['boulder', 'boulders'],
    tree: ['tree', 'trees'],
    bush: ['bush', 'bushes', 'bushy'],
    cactus: ['cactus', 'cacti', 'cactuses'],
    ruin: ['ruin', 'ruins', 'ruined'],
    pillar: ['pillar', 'pillars'],
    statue: ['statue', 'statues'],
    fence: ['fence', 'fences', 'fencing'],
};

/** At most this many models in the mix a group's chip gives Scatter: enough variety, few enough to see and change. */
export const MIX = 12;
/** Kinds a group's mix leaves out: they grow in their own places (deserts, wet ground). Their chip or a search finds them. */
const OWN_PLACES = new Set(['cactus', 'reed']);

/** The game's placeable models from the engine: the list to search, each model's outline (`flat`), its 3D group, its textures
 *  and a thumbnail, each loaded once and kept. */
export class ModelLibrary {
    constructor() {
        this.list = null; // [{ row, label, name, model, source }]: source is a hak, `game`, or null for a model nowhere
        this.index = []; // one entry a model there is, in the list's order: { p, text (lower case), source }
        this.plants = null; // model -> { kind, height, width, large }, once asked for (loadGroups)
        this.flats = new Map(); // model -> Promise<flat JSON>
        this.groups = new Map(); // model -> Promise<THREE.Group>
        this.textures = new Map(); // name -> THREE.Texture
        this.loaded = new Map(); // name -> Promise (settles when the image is in)
        this.thumbs = new Map(); // model -> { url: Promise<data URL>, wants: [() => still wanted] }
    }

    /** The list, asked for until the engine gives it (so a search after it starts finds them). */
    async load() {
        if (this.list?.length) return this.list;
        const res = await api('/api/placeables');
        this.setList(res.ok ? ((await json(res)).placeables ?? []) : []);
        return this.list;
    }

    /** Takes the engine's list, and indexes it once for search: a module's haks give 21,201 rows, searched on every key. */
    setList(list) {
        this.list = list;
        this.index = [];
        const seen = new Set();
        for (const p of list) {
            // A row whose model is nowhere can't be drawn or baked (an engine before sources said none: all are there).
            if (p.source === null || seen.has(p.model)) continue;
            seen.add(p.model);
            const source = p.source ?? 'game';
            this.index.push({ p, source, text: `${p.name} ${p.label} ${p.model}`.toLowerCase() });
        }
    }

    /** The plants, measured by the engine once (it reads each plant's model for its size): asked for when a group's chip is
     *  first used, not at start. None from an engine without it. */
    async loadGroups() {
        if (this.plants) return this.plants;
        this.groupsAsked ??= api('/api/placeable-groups')
            .then(r => (r.ok ? json(r) : { plants: [] }))
            .catch(() => ({ plants: [] }));
        const { plants = [] } = await this.groupsAsked;
        this.plants = new Map(plants.map(p => [p.model, p]));
        return this.plants;
    }

    /** The group `group` (`small` or `large`) of model `model`, null when it is no plant (or the plants aren't loaded). */
    groupOf(model) {
        const p = this.plants?.get(model);
        return p ? (p.large ? 'large' : 'small') : null;
    }

    /** A mix of group `group`'s models (from `source` alone when given) for Scatter: at most [`MIX`], a few of each kind in turn
     *  (bushes, ferns, flowers, grass, other plants), spread across each kind's models rather than its first few (often one
     *  model's variants side by side), without the kinds of [`OWN_PLACES`]. */
    groupMix(group, source = '', most = MIX) {
        const byKind = new Map();
        for (const e of this.index) {
            const p = this.plants?.get(e.p.model);
            if (!p || this.groupOf(e.p.model) !== group || (source && e.source !== source) || OWN_PLACES.has(p.kind)) continue;
            if (!byKind.has(p.kind)) byKind.set(p.kind, []);
            byKind.get(p.kind).push(e.p.model);
        }
        // Each kind's share: one each in turn until the mix is full (a kind with few models leaves the rest to the others).
        const kinds = [...byKind.values()];
        const share = kinds.map(() => 0);
        let n = 0;
        while (n < most && share.some((c, i) => c < kinds[i].length)) {
            for (let i = 0; i < kinds.length && n < most; i++) {
                if (share[i] < kinds[i].length) {
                    share[i]++;
                    n++;
                }
            }
        }
        // Spread evenly over each kind's list, the kinds taken in turn.
        const picks = kinds.map((k, i) => Array.from({ length: share[i] }, (_, j) => k[Math.floor((j * k.length) / share[i])]));
        const out = [];
        for (let j = 0; j < Math.max(0, ...share); j++) for (const p of picks) if (j < p.length) out.push(p[j]);
        return out;
    }

    /** Where the models come from, the game first, then each hak by how many it gives: [{ source, count }]. */
    sources() {
        const count = new Map();
        for (const e of this.index) count.set(e.source, (count.get(e.source) ?? 0) + 1);
        return [...count]
            .map(([source, n]) => ({ source, count: n }))
            .sort((a, b) => (a.source === 'game' ? -1 : b.source === 'game' ? 1 : b.count - a.count));
    }

    /** Placeables (one a model) whose name, label or model has every word of `query`, from `source` alone when one is
     *  given: `{ results, total }`, `limit` of them from the `offset`th, and how many match in all. A group's chip name
     *  (`small plants`) gives that group's models ([`GROUPS`]; loadGroups first). The models in `first` (a Set) come first. */
    search(query, { offset = 0, limit = PAGE, source = '', first = null } = {}) {
        const group = GROUPS[query.trim().toLowerCase()];
        const whole = WHOLE[query.trim().toLowerCase()];
        const matches = whole ? e => e.text.split(/[^a-z]+/).some(w => whole.includes(w)) : e => words.every(w => e.text.includes(w));
        // (An underscore parts words, as a space does: "saguaro_cactus" finds the label Saguaro_Cactus and the name "Saguaro cactus".)
        const words = group
            ? []
            : query
                  .toLowerCase()
                  .split(/[\s_]+/)
                  .filter(Boolean);
        const results = [];
        let total = 0;
        const order = first?.size
            ? [...this.index.filter(e => first.has(e.p.model)), ...this.index.filter(e => !first.has(e.p.model))]
            : this.index;
        for (const e of order) {
            if (source && e.source !== source) continue;
            if (group ? this.groupOf(e.p.model) !== group : !matches(e)) continue;
            if (total >= offset && results.length < limit) results.push(e.p);
            total++;
        }
        return { results, total };
    }

    flat(model) {
        if (!this.flats.has(model)) {
            this.flats.set(
                model,
                api(`/api/model/${encodeURIComponent(model)}`).then(r =>
                    r.ok ? r.json() : Promise.reject(new Error(`no model ${model}`)),
                ),
            );
        }
        return this.flats.get(model);
    }

    texture(name) {
        if (!this.textures.has(name)) {
            let done;
            this.loaded.set(
                name,
                new Promise(r => {
                    done = r;
                }),
            );
            const t = new THREE.TextureLoader().load(
                `/api/texture/${encodeURIComponent(name)}`,
                () => done(),
                undefined,
                () => done(),
            );
            t.colorSpace = THREE.SRGBColorSpace;
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            this.textures.set(name, t);
        }
        return this.textures.get(name);
    }

    /** A picture at `url` (an imported thing's ground patch), loaded once. */
    picture(url) {
        if (!this.textures.has(url)) {
            const t = new THREE.TextureLoader().load(url);
            t.colorSpace = THREE.SRGBColorSpace;
            t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
            this.textures.set(url, t);
        }
        return this.textures.get(url);
    }

    /** The model as a group to clone (shared geometry and materials). */
    group(model) {
        if (!this.groups.has(model)) {
            this.groups.set(
                model,
                this.flat(model).then(f => {
                    const g = new THREE.Group();
                    for (const [texture, first, count] of f.groups) {
                        const pos = new Float32Array(count * 9),
                            uv = new Float32Array(count * 6);
                        for (let k = 0; k < count * 3; k++) {
                            const [x, y, z] = f.positions[first * 3 + k];
                            pos.set([x, z, -y], k * 3);
                            uv.set(f.uvs[first * 3 + k], k * 2);
                        }
                        const geo = new THREE.BufferGeometry();
                        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
                        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
                        geo.computeVertexNormals();
                        // Cut-outs (leaves) as the game draws them; opaque ones are untouched.
                        const material = new THREE.MeshLambertMaterial({
                            map: this.texture(texture),
                            alphaTest: 0.3,
                            side: THREE.DoubleSide,
                        });
                        g.add(new THREE.Mesh(geo, material));
                    }
                    g.userData.flat = f;
                    return g;
                }),
            );
        }
        return this.groups.get(model);
    }

    /** A small picture of the model (a data URL), rendered once, one at a time. `wanted()` says whether it is still wanted when
     *  its turn comes: a search's results replaced by the next search's before their pictures were drawn are skipped ('', and
     *  asked again next time), so a few searches through a module's thousands of placeables don't queue hundreds of pictures. */
    thumbnail(model, wanted = () => true) {
        const kept = this.thumbs.get(model);
        if (kept) {
            kept.wants.push(wanted);
            return kept.url;
        }
        const entry = { wants: [wanted], url: null };
        entry.url = this.thumbQueue = (this.thumbQueue ?? Promise.resolve())
            .then(async () => {
                if (!entry.wants.some(w => w())) {
                    this.thumbs.delete(model);
                    return '';
                }
                // (A turn of the event loop between pictures: the page answers clicks and keys while a page of them is drawn.)
                await new Promise(r => setTimeout(r));
                return this.render(model);
            })
            .catch(() => '');
        this.thumbs.set(model, entry);
        return entry.url;
    }

    async render(model) {
        const g = await this.group(model);
        if (!this.thumbScene) {
            this.thumbScene = new THREE.Scene();
            this.thumbScene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
            const sun = new THREE.DirectionalLight(0xffffff, 1.6);
            sun.position.set(-1, 2, 1);
            this.thumbScene.add(sun);
            this.thumbCamera = new THREE.PerspectiveCamera(35, 1, 0.05, 500);
        }
        // Its textures in first: an untextured mesh draws black.
        await Promise.all(g.userData.flat.groups.map(([texture]) => this.loaded.get(texture)));
        const box = new THREE.Box3().setFromObject(g);
        const centre = box.getCenter(new THREE.Vector3()),
            size = box.getSize(new THREE.Vector3()).length() || 1;
        // Drawn as a copy that shares the model's arrays and pictures, freed from the thumbnail renderer afterwards: the model
        // stays in the view's renderer, and the thumbnail renderer keeps nothing.
        const copy = new THREE.Group(),
            made = [];
        for (const m of g.children) {
            const geo = new THREE.BufferGeometry();
            for (const [name, attribute] of Object.entries(m.geometry.attributes)) geo.setAttribute(name, attribute);
            geo.setIndex(m.geometry.index);
            const material = m.material.clone();
            if (material.map) material.map = material.map.clone();
            copy.add(new THREE.Mesh(geo, material));
            made.push(geo, material, material.map);
        }
        this.thumbScene.add(copy);
        this.thumbCamera.position.copy(centre).add(new THREE.Vector3(-0.6, 0.55, 0.75).normalize().multiplyScalar(size * 1.45));
        this.thumbCamera.lookAt(centre);
        const url = thumbnail(this.thumbScene, this.thumbCamera, 96);
        this.thumbScene.remove(copy);
        for (const x of made) x?.dispose();
        return url;
    }
}
