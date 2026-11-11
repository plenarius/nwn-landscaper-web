// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The game's placeables, from landscaper serve (/api/placeables,
// /api/model/<resref>, /api/texture/<name>): the list, each model as a
// three.js group (its textured triangles, at rest), and small thumbnails.
//
// Models come in NWN axes (x east, y north, z up); a group has three.js's
// (x, z, -y), so an object stands with position (x, height, size - y) and
// turns by rotation.y = its bearing.

import * as THREE from 'three';
import { api } from './api.js';

export class ModelLibrary {
    constructor() {
        this.list = null; // [{ row, label, name, model }]
        this.flats = new Map(); // model -> Promise<flat JSON>
        this.groups = new Map(); // model -> Promise<THREE.Group>
        this.textures = new Map(); // name -> THREE.Texture
        this.loaded = new Map(); // name -> Promise (settles when the image is in)
        this.thumbs = new Map(); // model -> Promise<data URL>
    }

    async load() {
        if (this.list) return this.list;
        try {
            const res = await api('/api/placeables');
            this.list = res.ok ? (await res.json()).placeables : [];
        } catch {
            this.list = [];
        }
        return this.list;
    }

    /** Placeables whose name, label or model has every word of `query`. */
    search(query, limit = 48) {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const out = [],
            seen = new Set();
        for (const p of this.list ?? []) {
            const text = `${p.name} ${p.label} ${p.model}`.toLowerCase();
            if (words.every(w => text.includes(w)) && !seen.has(p.model)) {
                seen.add(p.model);
                out.push(p);
                if (out.length >= limit) break;
            }
        }
        return out;
    }

    flat(model) {
        if (!this.flats.has(model)) {
            this.flats.set(
                model,
                api(`/api/model/${model}`).then(r => (r.ok ? r.json() : Promise.reject(new Error(`no model ${model}`)))),
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
                `/api/texture/${name}`,
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

    /** A small picture of the model (a data URL), rendered once. */
    thumbnail(model) {
        if (!this.thumbs.has(model)) {
            this.thumbQueue = (this.thumbQueue ?? Promise.resolve()).then(() => this.render(model)).catch(() => '');
            this.thumbs.set(model, this.thumbQueue);
        }
        return this.thumbs.get(model);
    }

    async render(model) {
        const g = await this.group(model);
        if (!this.thumbRenderer) {
            this.thumbRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
            this.thumbRenderer.setSize(96, 96);
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
        this.thumbScene.add(g);
        this.thumbCamera.position.copy(centre).add(new THREE.Vector3(-0.6, 0.55, 0.75).normalize().multiplyScalar(size * 1.45));
        this.thumbCamera.lookAt(centre);
        this.thumbRenderer.render(this.thumbScene, this.thumbCamera);
        const url = this.thumbRenderer.domElement.toDataURL('image/png');
        this.thumbScene.remove(g);
        return url;
    }
}
