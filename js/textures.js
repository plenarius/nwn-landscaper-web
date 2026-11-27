// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The texture library `landscaper serve` publishes under /textures/
// (built by landscaper's scripts/build_texture_library.py), and the GPU
// texture array the view paints with: one 512 px layer per palette entry.

import * as THREE from 'three';
import { api } from './api.js';

const LAYER = 512;

/** The texture library: its catalog from the engine, and each texture's pixels at the layer size, loaded once and kept. */
export class TextureLibrary {
    constructor() {
        this.catalog = []; // [{ id, name, category, render, swatch, ... }]
        this.byId = new Map();
        this.pixels = new Map(); // id -> Promise<Uint8ClampedArray> (LAYER² RGBA)
    }

    /** Loads the catalog; false when the page isn't served by landscaper. */
    async load() {
        try {
            const res = await api('textures/catalog.json');
            if (!res.ok) return false;
            this.catalog = (await res.json()).textures;
        } catch {
            return false;
        }
        // (Loaded again after a texture pack came or went: a texture that left, or a pack's that may have changed, is read anew.)
        const was = this.byId;
        this.byId = new Map();
        for (const t of this.catalog) this.byId.set(t.id, t);
        for (const id of [...this.pixels.keys()]) {
            const t = this.byId.get(id);
            if (!t || t.pack || JSON.stringify(t) !== JSON.stringify(was.get(id))) this.pixels.delete(id);
        }
        return this.catalog.length > 0;
    }

    swatchUrl(id) {
        return `textures/${this.byId.get(id).swatch}`;
    }

    /** RGBA pixels of a texture at the layer size. */
    layerPixels(id) {
        if (!this.pixels.has(id)) {
            const t = this.byId.get(id);
            const p = new Promise((resolve, reject) => {
                if (!t) {
                    reject(new Error(`no texture '${id}' in the library`));
                    return;
                }
                const img = new Image();
                img.onload = () => {
                    const c = document.createElement('canvas');
                    c.width = c.height = LAYER;
                    const ctx = c.getContext('2d');
                    ctx.drawImage(img, 0, 0, LAYER, LAYER);
                    resolve(ctx.getImageData(0, 0, LAYER, LAYER).data);
                };
                img.onerror = () => reject(new Error(`could not load texture '${id}'`));
                img.src = `textures/${t.render}`;
            });
            this.pixels.set(id, p);
        }
        return this.pixels.get(id);
    }

    /** A texture array with layer k = palette[k]; unknown ids are grey. */
    async buildArray(palette) {
        const data = new Uint8Array(LAYER * LAYER * 4 * palette.length);
        // Each layer's mean brightness (display values), as the bake's soft paint reads it (softpaint.js).
        const luma = new Float32Array(palette.length).fill(0.5);
        await Promise.all(
            palette.map(async (id, k) => {
                let px;
                try {
                    px = await this.layerPixels(id);
                } catch (err) {
                    console.warn(err.message);
                    px = null;
                }
                if (px) {
                    data.set(px, k * LAYER * LAYER * 4);
                    let sum = 0;
                    for (let p = 0; p < px.length; p += 4) sum += 0.3 * px[p] + 0.59 * px[p + 1] + 0.11 * px[p + 2];
                    luma[k] = sum / (LAYER * LAYER * 255);
                } else data.fill(128, k * LAYER * LAYER * 4, (k + 1) * LAYER * LAYER * 4);
            }),
        );
        const tex = new THREE.DataArrayTexture(data, LAYER, LAYER, palette.length);
        tex.format = THREE.RGBAFormat;
        tex.type = THREE.UnsignedByteType;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = 4;
        tex.needsUpdate = true;
        tex.userData.luma = luma;
        return tex;
    }
}
