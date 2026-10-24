// The 3D view of one area: the terrain with its painted textures (or
// coloured by height until they load), tinted where NWN won't walk, the
// 10 m NWN tile grid draped on it, the brush cursor, and export warnings.
//
// Frames: NWN x = three x; NWN y (north) = size - three z, so north is -Z,
// away from the default camera; height is three y.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SPACING, TILE } from './area.js';
import { fogRange } from './atmosphere.js';
import { shadeArea, SHADE_STEP } from './shade.js';
import { at as entranceAt, scenery as entranceScenery } from './entrance.js';

const GRASS_LOW = new THREE.Color(0x4f7a32);
const GRASS_HIGH = new THREE.Color(0x7d9b4a);
const ROCK = new THREE.Color(0x8a8378);
const BLOCKED = new THREE.Color(0xc0503c);
// Multiplies the painted texture on ground too steep to walk.
const BLOCKED_TINT = new THREE.Color(1.0, 0.42, 0.36);
// Metres one texture repeat covers on the ground (landscaper's TEXTURE_METRES).
const TEXTURE_METRES = 4;
// Steeper than this (normal's up component) can't be walked (landscaper's WALKABLE_NZ).
const WALKABLE_NZ = 0.64;

// Splat shading, as landscaper bakes it into the NWN tiles: each sample has
// a texture (an index into the area palette, stored in uMat); a point
// blends its four surrounding samples' textures bilinearly, so painted
// edges soften over one 0.625 m sample. Ground too steep to walk takes its
// texture from the side (along x + y, and up) and from the nearest sample.
// v is negated: the texture array's rows run top first, NWN's bottom first.
// Baked shadows over the lit ground, as the game's shadow-map shader
// multiplies them (fog comes after, in three.js as in the game).
// Only over the area: the edge scenery has no shadow map.
const SHADE_FRAGMENT = `
    {
        float extent = (uShadeCells - 1.0) * ${SHADE_STEP.toFixed(4)};
        if (all(greaterThanEqual(vArea, vec2(0.0))) && all(lessThanEqual(vArea, vec2(extent))))
            diffuseColor.rgb *= texture2D(uShade, (vArea / ${SHADE_STEP.toFixed(4)} + 0.5) / uShadeCells).r;
        if (vUp >= uVoid) diffuseColor.rgb = vec3(0.0);
    }`;

const SPLAT_VERTEX = `
    vArea = vec2(transformed.x, uSize - transformed.z);
    vUp = transformed.y;
    vNormalUp = normal.y;`;
const SPLAT_FRAGMENT = `
    if (uTextured) {
        vec2 f = clamp(vArea / ${SPACING.toFixed(4)}, vec2(0.0), vec2(uN - 1.0));
        vec2 base = min(floor(f), vec2(uN - 2.0));
        vec2 t = f - base;
        ivec2 b = ivec2(base);
        vec2 uv = vec2(vArea.x, -vArea.y) / ${TEXTURE_METRES.toFixed(1)};
        float m00 = floor(texelFetch(uMat, b, 0).r * 255.0 + 0.5);
        float m10 = floor(texelFetch(uMat, b + ivec2(1, 0), 0).r * 255.0 + 0.5);
        float m01 = floor(texelFetch(uMat, b + ivec2(0, 1), 0).r * 255.0 + 0.5);
        float m11 = floor(texelFetch(uMat, b + ivec2(1, 1), 0).r * 255.0 + 0.5);
        // An imported area's ground: its picture over the whole area.
        vec4 imported = texture2D(uImport, vArea / uSize);
        vec4 splat;
        if (vNormalUp < ${WALKABLE_NZ.toFixed(2)}) {
            vec2 side = vec2(vArea.x + vArea.y, -vUp) / ${TEXTURE_METRES.toFixed(1)};
            float nearest = t.x < 0.5 ? (t.y < 0.5 ? m00 : m01) : (t.y < 0.5 ? m10 : m11);
            splat = nearest == uImportLayer ? imported : texture(uTex, vec3(side, nearest));
        } else {
            splat = (m00 == uImportLayer ? imported : texture(uTex, vec3(uv, m00))) * (1.0 - t.x) * (1.0 - t.y)
                  + (m10 == uImportLayer ? imported : texture(uTex, vec3(uv, m10))) * t.x * (1.0 - t.y)
                  + (m01 == uImportLayer ? imported : texture(uTex, vec3(uv, m01))) * (1.0 - t.x) * t.y
                  + (m11 == uImportLayer ? imported : texture(uTex, vec3(uv, m11))) * t.x * t.y;
        }
        diffuseColor.rgb *= splat.rgb;
    }`;

export class View {
    constructor(container) {
        this.container = container;
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setClearColor(0x1d2228);
        container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 4000);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
        this.controls.maxPolarAngle = Math.PI / 2.05;
        // Left button sculpts; right orbits, middle pans, wheel zooms.
        this.controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
        this.renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

        // The working light, and the area's own (setAtmosphere).
        this.workSun = new THREE.DirectionalLight(0xffffff, 2.2);
        this.workSun.position.set(-0.6, 1.0, 0.5);
        this.workSky = new THREE.HemisphereLight(0xcfe3ff, 0x3a3226, 1.0);
        // The game's sun and moon shine from towards (4000, 4500, 7000).
        this.areaSun = new THREE.DirectionalLight(0xffffff, Math.PI);
        this.areaSun.position.set(4000, 7000, -4500).normalize();
        this.areaAmbient = new THREE.AmbientLight(0x000000, Math.PI);
        this.scene.add(this.workSun, this.workSky, this.areaSun, this.areaAmbient);
        this.areaSun.visible = this.areaAmbient.visible = false;
        this.fog = null; // { start, end } as the game's camera sees it

        this.cursor = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff }));
        this.cursor.visible = false;
        this.scene.add(this.cursor);

        this.showWalkability = true;
        this.library = null;
        this.textured = false;
        this.uniforms = {
            uTex: { value: new THREE.DataArrayTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, 1) },
            uMat: { value: null },
            uN: { value: 2 },
            uSize: { value: 1 },
            uTextured: { value: false },
            // Baked shadows (shade.js): a grid SHADE_STEP apart over the area.
            uShade: { value: null },
            uShadeCells: { value: 1 },
            // A cave's rock tops from here up are void: black.
            uVoid: { value: 1e9 },
            // An imported area's picture, and its palette index (-1: none).
            uImport: { value: null },
            uImportLayer: { value: -1 },
        };
        this.uniforms.uTex.value.needsUpdate = true;
        this.raycaster = new THREE.Raycaster();
        this.dirty = null;
        new ResizeObserver(() => this.resize()).observe(container);
        const loop = () => {
            requestAnimationFrame(loop);
            this.onFrame?.();
            if (this.dirty) this.flush();
            this.controls.update();
            this.updateFog();
            this.renderer.render(this.scene, this.camera);
        };
        requestAnimationFrame(loop);
    }

    /**
     * Lights the view as the game will (`atmosphere`, by day or `night`),
     * or with `null` the plain working light.
     */
    setAtmosphere(atmosphere, night) {
        const on = !!atmosphere;
        this.workSun.visible = this.workSky.visible = !on;
        this.areaSun.visible = this.areaAmbient.visible = on;
        if (!on) {
            this.fog = null;
            this.scene.fog = null;
            this.renderer.setClearColor(0x1d2228);
            return;
        }
        const s = night ? atmosphere.moon : atmosphere.sun;
        // Colours are gamma-space; three.js lights in linear and divides by pi.
        this.areaAmbient.color.set(s.ambient);
        this.areaSun.color.set(s.diffuse);
        const f = fogRange(atmosphere, night);
        this.fog = f;
        this.scene.fog = new THREE.Fog(new THREE.Color(f.color), f.start, f.end);
        this.renderer.setClearColor(new THREE.Color(f.color));
    }

    /** The game measures fog from its camera, which stays about 20 m from
     *  the player: the fog as such a camera at the view's target sees it
     *  (as Moonglow shows it), so pulling back doesn't fog everything. */
    updateFog() {
        if (!this.fog || !this.scene.fog) return;
        const beyond = Math.max(0, this.camera.position.distanceTo(this.controls.target) - 20);
        this.scene.fog.near = this.fog.start + beyond;
        this.scene.fog.far = this.fog.end + beyond;
    }

    resize() {
        const w = this.container.clientWidth, h = this.container.clientHeight;
        if (!w || !h) return;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    /** Shows a new area and frames the camera on it. */
    setArea(area) {
        this.area = area;
        for (const o of [this.mesh, this.grid, this.markers, this.water, this.skirt, this.entranceGroup, this.objectGroup]) {
            if (o) { this.scene.remove(o); o.traverse?.(c => { c.geometry?.dispose(); c.material?.dispose?.(); }); }
        }
        this.markers = null;
        this.water = null;
        const n = area.n, size = area.size;
        const geo = new THREE.PlaneGeometry(size, size, n - 1, n - 1);
        geo.rotateX(-Math.PI / 2);
        geo.translate(size / 2, 0, size / 2);
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
        this.uniforms.uMat.value?.dispose();
        const mat = new THREE.DataTexture(area.materials, n, n, THREE.RedFormat, THREE.UnsignedByteType);
        mat.minFilter = mat.magFilter = THREE.NearestFilter;
        mat.unpackAlignment = 1;
        mat.needsUpdate = true;
        this.uniforms.uMat.value = mat;
        this.uniforms.uN.value = n;
        this.uniforms.uSize.value = size;
        this.uniforms.uVoid.value = area.enclosed() ? area.roof - 0.3 : 1e9;
        this.updateShade();
        this.mesh = new THREE.Mesh(geo, this.splatMaterial());
        this.scene.add(this.mesh);
        this.buildSkirt();
        this.grid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
        this.scene.add(this.grid);
        this.paletteKey = null;
        this.markDirty({ i0: 0, i1: n - 1, j0: 0, j1: n - 1 });
        this.flush();
        this.updateWater();
        this.updateEntrances();
        this.updateObjects();
        this.frame();
        this.syncPalette();
    }

    splatMaterial() {
        const material = new THREE.MeshLambertMaterial({ vertexColors: true });
        material.onBeforeCompile = shader => {
            Object.assign(shader.uniforms, this.uniforms);
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nuniform float uSize;\nvarying vec2 vArea;\nvarying float vUp;\nvarying float vNormalUp;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>' + SPLAT_VERTEX);
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray uTex;\nuniform sampler2D uMat;\nuniform float uN;\nuniform bool uTextured;\nuniform sampler2D uShade;\nuniform float uShadeCells;\nuniform float uVoid;\nuniform sampler2D uImport;\nuniform float uImportLayer;\nuniform float uSize;\nvarying vec2 vArea;\nvarying float vUp;\nvarying float vNormalUp;')
                .replace('#include <color_fragment>', '#include <color_fragment>' + SPLAT_FRAGMENT + SHADE_FRAGMENT);
        };
        material.customProgramCacheKey = () => 'landscaper-splat';
        return material;
    }

    /** Bakes the shadows again (after the ground or their strength changed). */
    updateShade() {
        const { m, data } = shadeArea(this.area, this.area.shadow);
        const old = this.uniforms.uShade.value;
        const tex = new THREE.DataTexture(data, m, m, THREE.RedFormat, THREE.UnsignedByteType);
        tex.minFilter = tex.magFilter = THREE.LinearFilter;
        tex.unpackAlignment = 1;
        tex.needsUpdate = true;
        this.uniforms.uShade.value = tex;
        this.uniforms.uShadeCells.value = m;
        old?.dispose();
    }

    /** Uses the texture library to show painted textures. */
    setLibrary(library) {
        this.library = library;
        if (this.area) this.updateEntrances();
        this.paletteKey = null;
        this.syncPalette();
    }

    /** Rebuilds the texture array when the area's palette changed. */
    async syncPalette() {
        if (!this.library || !this.area) return;
        const key = this.area.palette.join(',');
        if (key === this.paletteKey) return;
        this.paletteKey = key;
        const tex = await this.library.buildArray(this.area.palette.slice());
        // An import's picture (exports/<name>.import.view.png).
        const at = this.area.palette.findIndex(id => id.startsWith('@import:'));
        let picture = null;
        if (at >= 0) {
            const name = this.area.palette[at].slice('@import:'.length);
            picture = await new Promise(resolve => new THREE.TextureLoader().load(`/api/import/${encodeURIComponent(name)}`, resolve, undefined, () => resolve(null)));
            if (picture) {
                picture.colorSpace = THREE.SRGBColorSpace;
                picture.wrapS = picture.wrapT = THREE.ClampToEdgeWrapping;
                picture.anisotropy = 4;
            }
        }
        if (key !== this.paletteKey) { tex.dispose(); picture?.dispose(); return; }
        this.uniforms.uImport.value?.dispose();
        this.uniforms.uImport.value = picture ?? new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
        this.uniforms.uImport.value.needsUpdate = !picture;
        this.uniforms.uImportLayer.value = picture ? at : -1;
        const old = this.uniforms.uTex.value;
        this.uniforms.uTex.value = tex;
        old.dispose();
        if (!this.textured) {
            this.textured = true;
            this.uniforms.uTextured.value = true;
            this.markDirty({ i0: 0, i1: this.area.n - 1, j0: 0, j1: this.area.n - 1 });
        }
    }

    frame() {
        const s = this.area.size;
        // The whole area in view, from the south, tilted down ~40 degrees.
        const mid = this.area.heightAt(s / 2, s / 2);
        this.controls.target.set(s / 2, mid, s / 2);
        this.camera.position.set(s / 2, mid + s * 0.95, s / 2 + s * 1.15);
        this.controls.minDistance = 5;
        this.controls.maxDistance = s * 3 + 100;
        this.controls.update();
    }

    markDirty(r) {
        if (!r) return;
        this.dirty = this.dirty
            ? { i0: Math.min(this.dirty.i0, r.i0), i1: Math.max(this.dirty.i1, r.i1), j0: Math.min(this.dirty.j0, r.j0), j1: Math.max(this.dirty.j1, r.j1) }
            : { ...r };
    }

    /** Vertex index of sample (i, j): plane rows run north to south. */
    vertex(i, j) { return (this.area.n - 1 - j) * this.area.n + i; }

    flush() {
        const area = this.area, n = area.n, d = this.dirty;
        this.dirty = null;
        const pos = this.mesh.geometry.attributes.position;
        const col = this.mesh.geometry.attributes.color;
        // Heights of the changed rows and a margin (walkability uses neighbours).
        const i0 = Math.max(0, d.i0 - 1), i1 = Math.min(n - 1, d.i1 + 1), j0 = Math.max(0, d.j0 - 1), j1 = Math.min(n - 1, d.j1 + 1);
        let lo = Infinity, hi = -Infinity;
        for (const v of area.heights) { if (v < lo) lo = v; if (v > hi) hi = v; }
        const span = Math.max(hi - lo, 1);
        const c = new THREE.Color();
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                const v = this.vertex(i, j), z = area.heights[j * n + i];
                pos.setY(v, z);
                // Under water the water shows it; no red tint.
                const wet = !Number.isNaN(area.waterLevel[j * n + i]);
                if (this.textured) {
                    // White leaves the painted texture as it is.
                    if (wet || area.walkable(i, j) || !this.showWalkability) c.setRGB(1, 1, 1);
                    else c.copy(BLOCKED_TINT);
                } else if (area.walkable(i, j)) {
                    c.copy(GRASS_LOW).lerp(GRASS_HIGH, (z - lo) / span);
                } else {
                    c.copy(this.showWalkability ? BLOCKED : ROCK);
                }
                col.setXYZ(v, c.r, c.g, c.b);
            }
        }
        pos.needsUpdate = true;
        col.needsUpdate = true;
        this.uniforms.uMat.value.needsUpdate = true;
        this.mesh.geometry.computeVertexNormals();
        this.mesh.geometry.computeBoundingSphere();
        this.mesh.geometry.computeBoundingBox();
        this.updateGrid();
        this.updateSkirt();
    }

    /** Entrances as the game will show them: the roof in the hill's paint,
     *  its rock, the dark back, and the door (orange) to link. */
    updateEntrances() {
        if (this.entranceGroup) {
            this.scene.remove(this.entranceGroup);
            this.entranceGroup.traverse(c => { c.geometry?.dispose(); if (c.material && !c.material.userData.shared) c.material.dispose(); });
        }
        this.entranceGroup = new THREE.Group();
        const area = this.area, size = area.size, height = (x, y) => area.heightAt(x, y);
        // Texture coordinates as landscaper writes them: from above, and
        // tilted with height for the rock.
        const flat = (x, y) => [x / 4, y / 4];
        const tilted = (x, y, z) => [(x + 0.6 * z) / 4, (y - 0.4 * z) / 4];
        const mesh = (tris, uvOf, material) => {
            const pos = [], uv = [];
            for (let k = 0; k < tris.length; k += 3) {
                const [x, y, z] = [tris[k], tris[k + 1], tris[k + 2]];
                pos.push(x, z, size - y);
                uv.push(...uvOf(x, y, z));
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
            g.computeVertexNormals();
            return new THREE.Mesh(g, material);
        };
        for (const e of area.entrances) {
            const sc = entranceScenery(e, height);
            const [bx, by] = entranceAt(e, e.depth + 2, 0);
            const bi = Math.min(area.n - 1, Math.max(0, Math.round(bx / SPACING))), bj = Math.min(area.n - 1, Math.max(0, Math.round(by / SPACING)));
            const hill = area.palette[area.materials[bj * area.n + bi]];
            this.blackMaterial ??= Object.assign(new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }), { userData: { shared: true } });
            this.entranceGroup.add(
                mesh(sc.top, flat, this.libraryMaterial(hill, 0x5d7a3a)),
                mesh(sc.rock, tilted, this.libraryMaterial(e.rock ?? 'rockCliff', 0x77716a)),
                mesh(sc.back, flat, this.blackMaterial),
            );
            const door = new THREE.Mesh(new THREE.PlaneGeometry(e.width * 0.8, 2.2), new THREE.MeshBasicMaterial({ color: 0xff9a1f, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
            const [dx, dy] = entranceAt(e, e.depth - 0.15, 0);
            door.position.set(dx, e.floor + 1.1, size - dy);
            door.rotation.y = e.dir + Math.PI / 2;
            this.entranceGroup.add(door);
        }
        this.scene.add(this.entranceGroup);
    }

    /** Placed objects, from the model library (set by the app). */
    async updateObjects() {
        if (this.objectGroup) this.scene.remove(this.objectGroup);
        const group = this.objectGroup = new THREE.Group();
        this.scene.add(group);
        if (!this.models) return;
        const size = this.area.size;
        for (const [i, o] of this.area.objects.entries()) {
            let model;
            try { model = await this.models.group(o.model); } catch { continue; }
            if (group !== this.objectGroup) return; // rebuilt meanwhile
            const inst = model.clone();
            inst.position.set(o.x, o.z, size - o.y);
            inst.rotation.y = o.bearing;
            inst.scale.setScalar(o.scale);
            inst.userData.object = o;
            group.add(inst);
            if (o === this.selected) this.showSelection(inst);
        }
    }

    /** Adds one object's model to the view (painting many at once). */
    async addObject(o) {
        const group = this.objectGroup;
        if (!group || !this.models) return;
        let model;
        try { model = await this.models.group(o.model); } catch { return; }
        if (group !== this.objectGroup || !this.area.objects.includes(o)) return;
        const inst = model.clone();
        inst.position.set(o.x, o.z, this.area.size - o.y);
        inst.rotation.y = o.bearing;
        inst.scale.setScalar(o.scale);
        inst.userData.object = o;
        group.add(inst);
    }

    /** Takes objects (a Set) out of the view. */
    removeObjects(gone) {
        if (!this.objectGroup) return;
        for (const c of [...this.objectGroup.children]) if (gone.has(c.userData.object)) this.objectGroup.remove(c);
    }

    /** The placed object under the pointer, or null. */
    pickObject(clientX, clientY) {
        if (!this.objectGroup) return null;
        const r = this.renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
        this.raycaster.setFromCamera(ndc, this.camera);
        const hit = this.raycaster.intersectObject(this.objectGroup, true)[0];
        let n = hit?.object;
        while (n && !n.userData.object) n = n.parent;
        return n?.userData.object ?? null;
    }

    /** Marks object `o` (or none) as selected: a box round it. */
    select(o) {
        this.selected = o;
        if (this.selectionBox) { this.scene.remove(this.selectionBox); this.selectionBox.geometry.dispose(); this.selectionBox = null; }
        const inst = this.objectGroup?.children.find(c => c.userData.object === o);
        if (inst) this.showSelection(inst);
    }

    showSelection(inst) {
        if (this.selectionBox) { this.scene.remove(this.selectionBox); this.selectionBox.geometry.dispose(); }
        // Gold for scenery, blue for a real placeable.
        this.selectionBox = new THREE.BoxHelper(inst, inst.userData.object?.baked === false ? 0x5aa0ff : 0xd8a24a);
        this.scene.add(this.selectionBox);
    }

    /** A library texture as a plain lit material (shared; `fallback` colour
     *  while the library isn't there). */
    libraryMaterial(id, fallback) {
        const entry = this.library?.byId.get(id);
        this.libraryMaterials ??= new Map();
        const key = entry ? id : `#${fallback}`;
        if (!this.libraryMaterials.has(key)) {
            let material;
            if (entry) {
                const t = new THREE.TextureLoader().load(`textures/${entry.render}`);
                t.colorSpace = THREE.SRGBColorSpace;
                t.wrapS = t.wrapT = THREE.RepeatWrapping;
                material = new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide });
            } else {
                material = new THREE.MeshLambertMaterial({ color: fallback, side: THREE.DoubleSide });
            }
            material.userData.shared = true;
            this.libraryMaterials.set(key, material);
        }
        return this.libraryMaterials.get(key);
    }

    /** What the game draws beyond the edge (landscaper's edge models): each
     *  boundary's profile carried 50 m straight out, and the corners flat
     *  at the corner's height; a little darker, as it can't be walked. The
     *  splat shading clamps to the edge, so its textures carry out too. */
    buildSkirt() {
        const n = this.area.n;
        // Four strips of n samples (two vertices each) and four corner quads.
        const verts = 4 * n * 2 + 4 * 4;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 3).fill(0.72), 3));
        const index = [];
        for (let s = 0; s < 4; s++) {
            for (let k = 0; k < n - 1; k++) {
                const a = (s * n + k) * 2, b = a + 2;
                index.push(a, a + 1, b + 1, a, b + 1, b);
            }
        }
        for (let c = 0; c < 4; c++) {
            const a = 8 * n + c * 4;
            index.push(a, a + 1, a + 2, a, a + 2, a + 3);
        }
        geo.setIndex(index);
        this.skirt = new THREE.Mesh(geo, this.mesh.material);
        // A cave has no edge scenery.
        this.skirt.visible = !this.area.enclosed();
        this.skirt.material.side = THREE.DoubleSide;
        this.scene.add(this.skirt);
    }

    updateSkirt() {
        if (!this.skirt) return;
        const area = this.area, n = area.n, size = area.size, h = area.heights, D = 50;
        const pos = this.skirt.geometry.attributes.position;
        // Area point (x, y) at height z, as three.js wants it.
        const put = (v, x, y, z) => pos.setXYZ(v, x, z, size - y);
        for (let k = 0; k < n; k++) {
            const t = k * SPACING;
            put((0 * n + k) * 2, -D, t, h[k * n]); put((0 * n + k) * 2 + 1, 0, t, h[k * n]);
            put((1 * n + k) * 2, size, t, h[k * n + n - 1]); put((1 * n + k) * 2 + 1, size + D, t, h[k * n + n - 1]);
            put((2 * n + k) * 2, t, -D, h[k]); put((2 * n + k) * 2 + 1, t, 0, h[k]);
            put((3 * n + k) * 2, t, size, h[(n - 1) * n + k]); put((3 * n + k) * 2 + 1, t, size + D, h[(n - 1) * n + k]);
        }
        const corners = [[0, 0, -D, -D], [0, size, -D, size + D], [size, 0, size + D, -D], [size, size, size + D, size + D]];
        corners.forEach(([x, y, fx, fy], c) => {
            const z = area.heightAt(x, y), a = 8 * n + c * 4;
            put(a, x, y, z); put(a + 1, fx, y, z); put(a + 2, fx, fy, z); put(a + 3, x, fy, z);
        });
        pos.needsUpdate = true;
        this.skirt.geometry.computeVertexNormals();
        this.skirt.geometry.computeBoundingSphere();
    }

    /** The water's surface: a flat quad at the level over each cell with a
     *  corner under water, as landscaper builds it (the ground hides it
     *  beyond the shore). */
    updateWater() {
        const area = this.area, n = area.n, size = area.size, L = area.waterLevel;
        if (this.water) { this.scene.remove(this.water); this.water.geometry.dispose(); }
        this.water = null;
        const pos = [];
        for (let j = 0; j < n - 1; j++) {
            for (let i = 0; i < n - 1; i++) {
                // The wet corners' highest level.
                let level = -Infinity;
                for (const k of [j * n + i, j * n + i + 1, (j + 1) * n + i, (j + 1) * n + i + 1]) if (!Number.isNaN(L[k])) level = Math.max(level, L[k]);
                if (level === -Infinity) continue;
                const x0 = i * SPACING, x1 = x0 + SPACING, z0 = size - j * SPACING, z1 = size - (j + 1) * SPACING;
                pos.push(x0, level, z0, x1, level, z0, x1, level, z1, x0, level, z0, x1, level, z1, x0, level, z1);
            }
        }
        // Carried out past the edge, as the edge scenery has it.
        const D = 50;
        const quad = (x0, y0, x1, y1, l) => pos.push(x0, l, size - y0, x1, l, size - y0, x1, l, size - y1, x0, l, size - y0, x1, l, size - y1, x0, l, size - y1);
        const wet = (i, j) => L[j * n + i];
        for (let k = 0; k < n - 1; k++) {
            const t0 = k * SPACING, t1 = t0 + SPACING;
            const lv = (a, b) => Math.max(Number.isNaN(a) ? -Infinity : a, Number.isNaN(b) ? -Infinity : b);
            let l;
            if ((l = lv(wet(0, k), wet(0, k + 1))) > -Infinity) quad(-D, t0, 0, t1, l);
            if ((l = lv(wet(n - 1, k), wet(n - 1, k + 1))) > -Infinity) quad(size, t0, size + D, t1, l);
            if ((l = lv(wet(k, 0), wet(k + 1, 0))) > -Infinity) quad(t0, -D, t1, 0, l);
            if ((l = lv(wet(k, n - 1), wet(k + 1, n - 1))) > -Infinity) quad(t0, size, t1, size + D, l);
        }
        for (const [i, j, x0, y0, x1, y1] of [[0, 0, -D, -D, 0, 0], [0, n - 1, -D, size, 0, size + D], [n - 1, 0, size, -D, size + D, 0], [n - 1, n - 1, size, size, size + D, size + D]]) {
            if (!Number.isNaN(wet(i, j))) quad(x0, y0, x1, y1, wet(i, j));
        }
        if (!pos.length) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.computeVertexNormals();
        this.water = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
            color: 0x2c6a86, specular: 0x557788, shininess: 60, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide,
        }));
        this.water.renderOrder = 1;
        this.scene.add(this.water);
    }

    setShowWalkability(on) {
        this.showWalkability = on;
        this.markDirty({ i0: 0, i1: this.area.n - 1, j0: 0, j1: this.area.n - 1 });
    }

    /** The tile grid, draped 5 cm above the ground. */
    updateGrid() {
        const area = this.area, n = area.n, size = area.size, tiles = area.tiles;
        const pts = [];
        const per = n - 1;
        for (let t = 0; t <= tiles; t++) {
            const along = t * TILE;
            for (let k = 0; k < per; k++) {
                const a = k * SPACING, b = (k + 1) * SPACING;
                // Line of constant x (running north) and of constant y.
                pts.push(along, area.heightAt(along, a) + 0.05, size - a, along, area.heightAt(along, b) + 0.05, size - b);
                pts.push(a, area.heightAt(a, along) + 0.05, size - along, b, area.heightAt(b, along) + 0.05, size - along);
            }
        }
        this.grid.geometry.dispose();
        this.grid.geometry = new THREE.BufferGeometry();
        this.grid.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    }

    /** Area point (NWN metres) under the mouse, or null. */
    pick(clientX, clientY) {
        const r = this.renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
        this.raycaster.setFromCamera(ndc, this.camera);
        const hit = this.raycaster.intersectObject(this.mesh)[0];
        if (!hit) return null;
        return { x: hit.point.x, y: this.area.size - hit.point.z, z: hit.point.y };
    }

    /** The room being dragged out: its outline on the floor (or none). */
    setRoomOutline(r, z) {
        if (this.roomLine) { this.scene.remove(this.roomLine); this.roomLine.geometry.dispose(); this.roomLine = null; }
        if (!r) return;
        const s = this.area.size, y = z + 0.1;
        const pts = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1], [r.x0, r.y0]].map(([x, yy]) => new THREE.Vector3(x, y, s - yy));
        this.roomLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xd8a24a, depthTest: false }));
        this.roomLine.renderOrder = 2;
        this.scene.add(this.roomLine);
    }

    /** Brush ring at area point p (or hide it). */
    setCursor(p, radius) {
        if (!p) { this.cursor.visible = false; return; }
        const pts = [];
        for (let k = 0; k <= 64; k++) {
            const a = (k / 64) * Math.PI * 2;
            const x = p.x + Math.cos(a) * radius, y = p.y + Math.sin(a) * radius;
            pts.push(new THREE.Vector3(x, this.area.heightAt(x, y) + 0.15, this.area.size - y));
        }
        this.cursor.geometry.setFromPoints(pts);
        this.cursor.visible = true;
    }

    /** Pillars at export warnings: red where a route stops, orange on winding tiles. */
    setMarkers(warnings) {
        if (this.markers) { this.scene.remove(this.markers); this.markers.traverse(c => { c.geometry?.dispose(); c.material?.map?.dispose(); c.material?.dispose?.(); }); }
        this.markers = new THREE.Group();
        for (const w of warnings) {
            const failed = w.kind === 'failed_route', closed = w.kind === 'closed_passage';
            const at = failed ? w.stops_at : closed ? w.at : [(w.from[0] + w.to[0]) / 2, (w.from[1] + w.to[1]) / 2];
            const color = failed || closed ? 0xe0402a : 0xff9a1f;
            const ground = this.area.heightAt(at[0], at[1]);
            const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 5, 12), new THREE.MeshBasicMaterial({ color }));
            pillar.position.set(at[0], ground + 2.5, this.area.size - at[1]);
            this.markers.add(pillar);
            const label = makeLabel(failed ? 'Route stops here' : closed ? 'Passage closed' : `Tile ${w.tile[0]},${w.tile[1]}: too winding`, color);
            label.position.set(at[0], ground + 6, this.area.size - at[1]);
            this.markers.add(label);
        }
        this.scene.add(this.markers);
    }
}

function makeLabel(text, color) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 40px system-ui, sans-serif';
    canvas.width = Math.ceil(ctx.measureText(text).width) + 24;
    canvas.height = 60;
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(20,22,26,0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.fillText(text, 12, 44);
    // A fixed size on screen, however near the camera is.
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, sizeAttenuation: false }));
    sprite.scale.set(0.024 * canvas.width / canvas.height, 0.024, 1);
    return sprite;
}
