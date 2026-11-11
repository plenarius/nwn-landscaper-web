// Thumbnails of what a blueprint looks like: a creature is baked by the server (nwn-bake, through the ops API)
// into a scene of meshes and textures, which one hidden WebGL renderer draws from the front into a small picture.
// One at a time (the server bakes one at a time too), each kept for the page's life; a creature it can't show
// resolves to null and its entry simply has no picture.

import * as THREE from 'three';

const SIZE = 112;
const cache = new Map();
let renderer = null;
let chain = Promise.resolve();

const json = r => (r.ok ? r.json() : Promise.reject(new Error(r.statusText)));

function draw(scene, textures) {
    renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
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
    renderer.render(three, camera);
    const url = renderer.domElement.toDataURL('image/png');
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    return url;
}

async function make(resref) {
    const { key } = await fetch(`/api/preview/creature?resref=${encodeURIComponent(resref)}`).then(json);
    const base = `/api/preview-file/${key}`;
    const scene = await fetch(`${base}/scene.json`).then(json);
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

/** What a placeable's or door's blueprint looks like: the model its appearance names, drawn by the model cache (the
 *  same small picture the Place tool's list has). `models` is the view's ModelCache. Null if it names none. */
export async function modelPreview(models, kind, resref) {
    try {
        const { model } = await fetch(`/api/blueprint-model?kind=${kind}&resref=${encodeURIComponent(resref)}`).then(json);
        return model ? (await models.thumbnail(model)) || null : null;
    } catch {
        return null;
    }
}

/** An item blueprint's inventory icon (the ops API says which one it is and draws it): a URL, or null. */
const icons = new Map();
export function itemPreview(resref) {
    if (!icons.has(resref)) {
        icons.set(
            resref,
            fetch(`/api/preview/item?resref=${encodeURIComponent(resref)}`)
                .then(json)
                .then(({ key }) => (key ? `/api/preview-icon/${encodeURIComponent(key)}.png` : null))
                .catch(() => null),
        );
    }
    return icons.get(resref);
}
