// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Thumbnails of what a blueprint looks like: a creature is baked by the server (nwn-bake, through the review service)
// into a scene of meshes and textures, which the thumbnail renderer (thumbnail.js) draws from the front into a small picture.
// One at a time (the server bakes one at a time too), each kept for the page's life; a creature it can't show
// resolves to null and its entry has no picture.

import * as THREE from 'three';
import { api } from './api.js';
import { thumbnail } from './thumbnail.js';

const SIZE = 112;
const cache = new Map();
let chain = Promise.resolve();

// (unlike api.js's json, which reads a failed answer as {}: here a failure means no picture)
const okJson = r => (r.ok ? r.json() : Promise.reject(new Error(r.statusText)));

function draw(scene, textures) {
    const three = new THREE.Scene();
    three.add(new THREE.HemisphereLight(0xffffff, 0x555560, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-2, 4, -5);
    three.add(sun);
    const group = new THREE.Group();
    const geometries = [],
        materials = [];
    for (const m of scene.meshes) {
        // NWN's axes (x east, y north, z up) to the editor's (x east, y up, z south).
        const pos = new Float32Array(m.position.length),
            nor = new Float32Array(m.normal.length);
        for (let i = 0; i < m.position.length; i += 3) {
            pos[i] = m.position[i];
            pos[i + 1] = m.position[i + 2];
            pos[i + 2] = -m.position[i + 1];
            nor[i] = m.normal[i];
            nor[i + 1] = m.normal[i + 2];
            nor[i + 2] = -m.normal[i + 1];
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
        g.setIndex(m.index);
        const mat = new THREE.MeshStandardMaterial({
            map: m.file ? (textures.get(m.file) ?? null) : null,
            color: m.file ? 0xffffff : new THREE.Color(...m.diffuse),
            roughness: 0.8,
            metalness: 0.05,
            alphaTest: m.alpha ? 0.5 : 0,
            transparent: m.hint > 0,
            opacity: m.materialAlpha,
            side: THREE.DoubleSide,
        });
        geometries.push(g);
        materials.push(mat);
        group.add(new THREE.Mesh(g, mat));
    }
    three.add(group);
    const box = new THREE.Box3().setFromObject(group);
    const c = box.getCenter(new THREE.Vector3()),
        size = box.getSize(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
    const dist = (Math.max(size.y, size.x, 0.5) / 2 / Math.tan(THREE.MathUtils.degToRad(15))) * 1.12;
    // A creature faces north (-z here): the camera stands in front of it, a little above.
    camera.position.set(c.x, c.y + size.y * 0.08, box.min.z - dist);
    camera.lookAt(c);
    const url = thumbnail(three, camera, SIZE);
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    return url;
}

async function make(resref) {
    const { key } = await api(`/api/preview/creature?resref=${encodeURIComponent(resref)}`).then(okJson);
    // The review service's name for the picture: 64 hexadecimal digits (anything else, `../` or a `?`, would make these
    // requests to other paths of the engine).
    if (!/^[0-9a-f]{64}$/.test(key ?? '')) throw new Error('no picture');
    const base = `/api/preview-file/${key}`;
    const scene = await api(`${base}/scene.json`).then(okJson);
    const loader = new THREE.TextureLoader();
    const textures = new Map();
    await Promise.all(
        [...new Set(scene.meshes.map(m => m.file).filter(Boolean))].map(async file => {
            try {
                const t = await loader.loadAsync(`${base}/tex/${encodeURIComponent(file)}`);
                t.colorSpace = THREE.SRGBColorSpace;
                t.wrapS = t.wrapT = THREE.RepeatWrapping;
                textures.set(file, t);
            } catch {
                /* a mesh without its picture is drawn in its colour */
            }
        }),
    );
    const url = draw(scene, textures);
    for (const t of textures.values()) t.dispose();
    return url;
}

/** A data URL of the creature blueprint `resref`, or null if it can't be shown. */
export function creaturePreview(resref) {
    if (!cache.has(resref)) {
        const job = chain.then(() => make(resref)).catch(() => null);
        chain = job.then(
            () => {},
            () => {},
        );
        cache.set(resref, job);
    }
    return cache.get(resref);
}

// Each placeable's or door's blueprint's model, asked for once: kind:resref -> Promise<name or null>.
const blueprintModels = new Map();

/** The model a placeable's or door's blueprint `resref` names (its appearance's): a name, null when it names none or the engine
 *  has no such blueprint, undefined when the engine couldn't be asked (asked again next time). Asked once a blueprint: the
 *  list's pictures and an area's hundreds of doors share it. */
export function blueprintModel(kind, resref) {
    const key = `${kind}:${resref}`;
    if (!blueprintModels.has(key))
        blueprintModels.set(
            key,
            api(`/api/blueprint-model?kind=${kind}&resref=${encodeURIComponent(resref)}`)
                .then(r => (r.ok ? r.json().then(j => j.model || null) : r.status < 500 ? null : Promise.reject(new Error())))
                .catch(() => {
                    blueprintModels.delete(key);
                    return undefined;
                }),
        );
    return blueprintModels.get(key);
}

/** What a placeable's or door's blueprint looks like: the model its appearance names, drawn by the model cache (the
 *  same small picture the Place tool's list has). `models` is the view's ModelCache. Null if it names none. */
export async function modelPreview(models, kind, resref) {
    const model = await blueprintModel(kind, resref);
    return model ? (await models.thumbnail(model)) || null : null;
}

// Each item's icon, asked for once.
const icons = new Map();

/** An item blueprint's inventory icon (the review service says which one it is and draws it): a URL, or null. */
export function itemPreview(resref) {
    if (!icons.has(resref)) {
        icons.set(
            resref,
            api(`/api/preview/item?resref=${encodeURIComponent(resref)}`)
                .then(okJson)
                .then(({ key }) => (key ? `/api/preview-icon/${encodeURIComponent(key)}.png` : null))
                .catch(() => null),
        );
    }
    return icons.get(resref);
}
