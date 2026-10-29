// The 3D view of one area: the terrain with its painted textures (or
// coloured by height until they load), tinted where NWN won't walk, the
// 10 m NWN tile grid draped on it, the brush cursor, and export warnings.
//
// Frames: NWN x = three x; NWN y (north) = size - three z, so north is -Z,
// away from the default camera; height is three y.

import { THING_COLOURS } from './thingcolours.js';
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
        vec2 extent = (uShadeCells - 1.0) * ${SHADE_STEP.toFixed(4)};
        if (all(greaterThanEqual(vArea, vec2(0.0))) && all(lessThanEqual(vArea, extent)))
            diffuseColor.rgb *= texture2D(uShade, (vArea / ${SHADE_STEP.toFixed(4)} + 0.5) / uShadeCells).r;
        if (vUp >= uVoid) diffuseColor.rgb = vec3(0.0);
    }`;

const SPLAT_VERTEX = `
    vArea = vec2(transformed.x, uSize.y - transformed.z);
    vUp = transformed.y;
    vNormalUp = normal.y;`;
const SPLAT_FRAGMENT = `
    if (uTextured) {
        vec2 f = clamp(vArea / ${SPACING.toFixed(4)}, vec2(0.0), uN - 1.0);
        vec2 base = min(floor(f), uN - 2.0);
        vec2 t = f - base;
        ivec2 b = ivec2(base);
        vec2 uv = vec2(vArea.x, -vArea.y) / ${TEXTURE_METRES.toFixed(1)};
        float m00 = floor(texelFetch(uMat, b, 0).r * 255.0 + 0.5);
        float m10 = floor(texelFetch(uMat, b + ivec2(1, 0), 0).r * 255.0 + 0.5);
        float m01 = floor(texelFetch(uMat, b + ivec2(0, 1), 0).r * 255.0 + 0.5);
        float m11 = floor(texelFetch(uMat, b + ivec2(1, 1), 0).r * 255.0 + 0.5);
        // An imported area's ground: its picture over the whole area; beyond
        // the edge, the border's outer 5 m mirrored out and back every 10 m
        // (as landscaper's edge models draw it).
        vec2 folded = vArea;
        for (int k = 0; k < 2; k++) {
            float c = folded[k];
            if (c < 0.0 || c > uSize[k]) {
                float m = mod(c < 0.0 ? -c : c - uSize[k], 10.0);
                m = m > 5.0 ? 10.0 - m : m;
                folded[k] = c < 0.0 ? m : uSize[k] - m;
            }
        }
        vec4 imported = texture2D(uImport, folded / uSize);
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
        this.renderer.localClippingEnabled = true;
        // Imported tiles' roofs and upper floors: cut away above this height (null: whole).
        this.cut = null;
        this.cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
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
            // Samples and metres, across and up.
            uN: { value: new THREE.Vector2(2, 2) },
            uSize: { value: new THREE.Vector2(1, 1) },
            uTextured: { value: false },
            // Baked shadows (shade.js): a grid SHADE_STEP apart over the area.
            uShade: { value: null },
            uShadeCells: { value: new THREE.Vector2(1, 1) },
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
        for (const o of [this.mesh, this.grid, this.markers, this.water, this.skirt, this.entranceGroup, this.objectGroup, this.thingGroup]) {
            if (o) { this.scene.remove(o); o.traverse?.(c => { c.geometry?.dispose(); c.material?.dispose?.(); }); }
        }
        this.markers = null;
        this.water = null;
        const { nx, ny, sizeX, sizeY } = area;
        const geo = new THREE.PlaneGeometry(sizeX, sizeY, nx - 1, ny - 1);
        geo.rotateX(-Math.PI / 2);
        geo.translate(sizeX / 2, 0, sizeY / 2);
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nx * ny * 3), 3));
        this.uniforms.uMat.value?.dispose();
        const mat = new THREE.DataTexture(area.materials, nx, ny, THREE.RedFormat, THREE.UnsignedByteType);
        mat.minFilter = mat.magFilter = THREE.NearestFilter;
        mat.unpackAlignment = 1;
        mat.needsUpdate = true;
        this.uniforms.uMat.value = mat;
        this.uniforms.uN.value.set(nx, ny);
        this.uniforms.uSize.value.set(sizeX, sizeY);
        this.uniforms.uVoid.value = area.enclosed() ? area.roof - 0.3 : 1e9;
        this.updateShade();
        this.mesh = new THREE.Mesh(geo, this.splatMaterial());
        this.scene.add(this.mesh);
        this.buildSkirt();
        this.grid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
        this.scene.add(this.grid);
        this.paletteKey = null;
        this.markDirty(this.everything());
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
                .replace('#include <common>', '#include <common>\nuniform vec2 uSize;\nvarying vec2 vArea;\nvarying float vUp;\nvarying float vNormalUp;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>' + SPLAT_VERTEX);
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray uTex;\nuniform sampler2D uMat;\nuniform vec2 uN;\nuniform bool uTextured;\nuniform sampler2D uShade;\nuniform vec2 uShadeCells;\nuniform float uVoid;\nuniform sampler2D uImport;\nuniform float uImportLayer;\nuniform vec2 uSize;\nvarying vec2 vArea;\nvarying float vUp;\nvarying float vNormalUp;')
                .replace('#include <color_fragment>', '#include <color_fragment>' + SPLAT_FRAGMENT + SHADE_FRAGMENT);
        };
        material.customProgramCacheKey = () => 'landscaper-splat';
        return material;
    }

    /** Bakes the shadows again (after the ground or their strength changed). */
    updateShade() {
        const { mx, my, data } = shadeArea(this.area, this.area.shadow);
        const old = this.uniforms.uShade.value;
        const tex = new THREE.DataTexture(data, mx, my, THREE.RedFormat, THREE.UnsignedByteType);
        tex.minFilter = tex.magFilter = THREE.LinearFilter;
        tex.unpackAlignment = 1;
        tex.needsUpdate = true;
        this.uniforms.uShade.value = tex;
        this.uniforms.uShadeCells.value.set(mx, my);
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
            this.markDirty(this.everything());
        }
    }

    frame() {
        const { sizeX: sx, sizeY: sy } = this.area, s = Math.max(sx, sy);
        // The whole area in view, from the south, tilted down ~40 degrees.
        const mid = this.area.heightAt(sx / 2, sy / 2);
        this.controls.target.set(sx / 2, mid, sy / 2);
        this.camera.position.set(sx / 2, mid + s * 0.95, sy / 2 + s * 1.15);
        this.controls.minDistance = 5;
        this.controls.maxDistance = s * 3 + 100;
        this.controls.update();
    }

    // --- The camera from the keyboard (the mouse's: right-drag turns, middle-drag moves, wheel zooms) ---------------

    /** Moves the view along the ground: `right` and `forward` in steps of a tenth of the distance to what it looks at. */
    panBy(right, forward) {
        const off = this.camera.position.clone().sub(this.controls.target);
        const away = new THREE.Vector3(-off.x, 0, -off.z);
        if (away.lengthSq() < 1e-6) away.set(0, 0, -1);
        away.normalize();
        const side = new THREE.Vector3().crossVectors(away, new THREE.Vector3(0, 1, 0)).normalize();
        const move = side.multiplyScalar(right * off.length() * 0.1).add(away.multiplyScalar(forward * off.length() * 0.1));
        this.camera.position.add(move);
        this.controls.target.add(move);
        this.controls.update();
    }

    /** Turns the view round what it looks at: `dTheta` about the vertical, `dPhi` up or down (radians). */
    orbitBy(dTheta, dPhi) {
        const off = this.camera.position.clone().sub(this.controls.target);
        const sph = new THREE.Spherical().setFromVector3(off);
        sph.theta += dTheta;
        sph.phi = Math.min(this.controls.maxPolarAngle, Math.max(0.02, sph.phi + dPhi));
        this.camera.position.copy(this.controls.target).add(off.setFromSpherical(sph));
        this.controls.update();
    }

    /** Moves in (factor < 1) or out, within the limits the wheel has. */
    zoomBy(factor) {
        const off = this.camera.position.clone().sub(this.controls.target);
        const d = Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, off.length() * factor));
        this.camera.position.copy(this.controls.target).add(off.setLength(d));
        this.controls.update();
    }

    /** Straight down on what it looks at, from where it is now. */
    topDown() {
        const off = this.camera.position.clone().sub(this.controls.target);
        const sph = new THREE.Spherical().setFromVector3(off);
        sph.phi = 0.02;
        this.camera.position.copy(this.controls.target).add(off.setFromSpherical(sph));
        this.controls.update();
    }

    /** The whole area, as a dirty range. */
    everything() {
        return { i0: 0, i1: this.area.nx - 1, j0: 0, j1: this.area.ny - 1 };
    }

    markDirty(r) {
        if (!r) return;
        this.dirty = this.dirty
            ? { i0: Math.min(this.dirty.i0, r.i0), i1: Math.max(this.dirty.i1, r.i1), j0: Math.min(this.dirty.j0, r.j0), j1: Math.max(this.dirty.j1, r.j1) }
            : { ...r };
    }

    /** Vertex index of sample (i, j): plane rows run north to south. */
    vertex(i, j) { return (this.area.ny - 1 - j) * this.area.nx + i; }

    flush() {
        const area = this.area, n = area.nx, d = this.dirty;
        this.dirty = null;
        const pos = this.mesh.geometry.attributes.position;
        const col = this.mesh.geometry.attributes.color;
        // Heights of the changed rows and a margin (walkability uses neighbours).
        const i0 = Math.max(0, d.i0 - 1), i1 = Math.min(n - 1, d.i1 + 1), j0 = Math.max(0, d.j0 - 1), j1 = Math.min(area.ny - 1, d.j1 + 1);
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
        const area = this.area, size = area.sizeY, height = (x, y) => area.heightAt(x, y);
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
            const bi = Math.min(area.nx - 1, Math.max(0, Math.round(bx / SPACING))), bj = Math.min(area.ny - 1, Math.max(0, Math.round(by / SPACING)));
            const hill = area.palette[area.materials[bj * area.nx + bi]];
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
        const size = this.area.sizeY;
        // All at once, each drawn as its model arrives.
        await Promise.all(this.area.objects.map(async o => {
            let model;
            try { model = await this.models.group(o.model); } catch { return; }
            if (group !== this.objectGroup) return; // rebuilt meanwhile
            const inst = model.clone();
            inst.position.set(o.x, o.z, size - o.y);
            inst.rotation.y = o.bearing;
            inst.scale.setScalar(o.scale);
            inst.userData.object = o;
            group.add(inst);
            this.addDecal(group, o, model.userData.flat);
            if (o === this.selected) this.showSelection(inst);
        }));
    }

    /** An imported thing's patch of ground, draped on the ground where it
     *  stands (turned and scaled with it), as the export paints it. */
    addDecal(group, o, flat) {
        const d = flat?.decal;
        if (!d) return;
        const name = o.model.slice('@import:'.length).split(':')[0];
        const [x0, y0, x1, y1] = d.rect, n = 8, c = Math.cos(o.bearing), s = Math.sin(o.bearing), area = this.area;
        const pos = [], uv = [], index = [];
        for (let j = 0; j <= n; j++) {
            for (let i = 0; i <= n; i++) {
                const u = x0 + (x1 - x0) * i / n, v = y0 + (y1 - y0) * j / n;
                const x = o.x + (c * u - s * v) * o.scale, y = o.y + (s * u + c * v) * o.scale;
                pos.push(x, area.heightAt(Math.min(area.sizeX, Math.max(0, x)), Math.min(area.sizeY, Math.max(0, y))) + 0.04, area.sizeY - y);
                uv.push(i / n, j / n);
            }
        }
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
            const a = j * (n + 1) + i;
            index.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(index);
        geo.computeVertexNormals();
        const map = this.models.picture(`/api/import-file/${encodeURIComponent(name)}/${encodeURIComponent(d.file)}`);
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }));
        mesh.renderOrder = 1;
        mesh.userData.object = o;
        mesh.userData.decal = true;
        group.add(mesh);
    }

    /** Adds one object's model to the view (painting many at once). */
    async addObject(o) {
        const group = this.objectGroup;
        if (!group || !this.models) return;
        let model;
        try { model = await this.models.group(o.model); } catch { return; }
        if (group !== this.objectGroup || !this.area.objects.includes(o)) return;
        const inst = model.clone();
        inst.position.set(o.x, o.z, this.area.sizeY - o.y);
        inst.rotation.y = o.bearing;
        inst.scale.setScalar(o.scale);
        inst.userData.object = o;
        group.add(inst);
        this.applyCut(inst);
        this.addDecal(group, o, model.userData.flat);
    }

    /** Cuts the imported tiles' roofs and upper floors away above `h` metres (null: shows them whole). Only imported tile
     *  models are cut: the ground, things and anything else stay as they are. */
    setCut(h) {
        this.cut = h;
        if (h != null) this.cutPlane.constant = h;
        if (this.objectGroup) for (const c of this.objectGroup.children) this.applyCut(c);
    }

    applyCut(inst) {
        if (!inst.userData.object?.model?.startsWith('@import:')) return;
        const planes = this.cut == null ? [] : [this.cutPlane];
        inst.traverse(m => {
            if (!m.material) return;
            for (const mat of Array.isArray(m.material) ? m.material : [m.material]) { mat.clippingPlanes = planes; mat.needsUpdate = true; }
        });
    }

    /** Takes objects (a Set) out of the view. */
    removeObjects(gone) {
        if (!this.objectGroup) return;
        for (const c of [...this.objectGroup.children]) if (gone.has(c.userData.object)) this.objectGroup.remove(c);
    }

    /**
     * The things placed in the area (creatures, waypoints, triggers, sounds...) and, greyed, the imported area's
     * own objects (`ghosts`): each kind has its own colour and shape, standing on the ground with an arrow for the
     * way it faces; a trigger's or encounter's outline is a filled, draped polygon with a ribbon round it and a post
     * at each corner. The one selected (`selectedId`/`selectedKey`) is white. `draft` is an outline being drawn. `inert`:
     * to look at only, nothing can be picked.
     */
    setThings(things, selectedId = null, draft = null, ghosts = [], selectedKey = null, inert = false) {
        if (this.thingGroup) {
            this.scene.remove(this.thingGroup);
            this.thingGroup.traverse(c => { c.geometry?.dispose(); c.material?.dispose?.(); });
        }
        const group = this.thingGroup = new THREE.Group();
        this.scene.add(group);
        if (!this.area) return;
        const area = this.area, size = area.sizeY;
        const at = (x, y, lift = 0) => new THREE.Vector3(x, area.heightAt(x, y) + lift, size - y);
        const GREY = new THREE.Color(0x8a929b);
        // The colour a thing is drawn in: its kind's, or white when selected; an original's is the kind's washed toward grey.
        const tone = (kind, sel, ghost) => {
            if (sel) return new THREE.Color(0xffffff);
            const c = new THREE.Color(THING_COLOURS[kind] ?? 0xffffff);
            return ghost ? c.lerp(GREY, 0.2) : c;
        };
        const solid = (c, ghost) => new THREE.MeshBasicMaterial({ color: c, transparent: ghost, opacity: ghost ? 0.8 : 1 });
        // (Out of the Things tool the markers are only to look at: nothing to pick.)
        this.thingsInert = inert;
        const tag = (m, id) => { m.userData.thing = id; return m; };

        /** A ribbon of `width` metres along the outline, draped on the ground (thin GL lines vanish at a distance). */
        const ribbon = (pts, width, c, closed = true, ghost = false) => {
            const n = pts.length, samples = [];
            for (let i = 0; i < (closed ? n : n - 1); i++) {
                const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
                const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
                for (let j = 0; j < k; j++) samples.push([ax + (bx - ax) * j / k, ay + (by - ay) * j / k]);
            }
            if (!closed) samples.push(pts[n - 1]);
            const m = samples.length, pos = [], idx = [];
            for (let i = 0; i < m; i++) {
                const prev = samples[(i - 1 + m) % m], next = samples[(i + 1) % m];
                const lo = closed || i > 0 ? prev : samples[i], hi = closed || i < m - 1 ? next : samples[i];
                let tx = hi[0] - lo[0], ty = hi[1] - lo[1];
                const len = Math.hypot(tx, ty) || 1;
                tx /= len; ty /= len;
                const [x, y] = samples[i], nx = -ty * width / 2, ny = tx * width / 2;
                for (const sgn of [1, -1]) {
                    const v = at(x + nx * sgn, y + ny * sgn, 0.2);
                    pos.push(v.x, v.y, v.z);
                }
                if (i < m - 1 || closed) {
                    const a = i * 2, b = ((i + 1) % m) * 2;
                    idx.push(a, a + 1, b, a + 1, b + 1, b);
                }
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setIndex(idx);
            const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, depthTest: false, transparent: ghost, opacity: ghost ? 0.9 : 1 }));
            mesh.renderOrder = 5;
            return mesh;
        };

        /** The polygon filled, draped: triangulated, then cut small enough to follow the ground. */
        const fill = (pts, c, opacity) => {
            const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, y]) => new THREE.Vector2(x, y)), []);
            const pos = [];
            const put = p => { const v = at(p[0], p[1], 0.12); pos.push(v.x, v.y, v.z); };
            const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
            const cut = (a, b, d, depth) => {
                if (depth >= 5 || Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - d[0], b[1] - d[1]), Math.hypot(d[0] - a[0], d[1] - a[1])) <= 2) { put(a); put(b); put(d); return; }
                const ab = mid(a, b), bd = mid(b, d), da = mid(d, a);
                cut(a, ab, da, depth + 1); cut(ab, b, bd, depth + 1); cut(da, bd, d, depth + 1); cut(ab, bd, da, depth + 1);
            };
            for (const [i, j, k] of tris) cut(pts[i], pts[j], pts[k], 0);
            if (!pos.length) return null;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
            mesh.renderOrder = 4;
            return mesh;
        };

        /** A marker of the kind's own shape standing at `p`; every part picks as `id`. */
        const marker = (kind, p, c, sel, ghost, id) => {
            const m = () => solid(c, ghost), k = (sel ? 1.25 : 1) * 1.35;
            const add = (geo, y, rot) => {
                const mesh = tag(new THREE.Mesh(geo, m()), id);
                mesh.position.set(p.x, p.y + y, p.z);
                if (rot) mesh.rotation.set(...rot);
                group.add(mesh);
                return mesh;
            };
            switch (kind) {
                case 'creature': add(new THREE.ConeGeometry(0.32 * k, 1.5 * k, 10), 0.75 * k); add(new THREE.SphereGeometry(0.27 * k, 10, 8), 1.75 * k); break;
                case 'waypoint': add(new THREE.CylinderGeometry(0.05 * k, 0.05 * k, 2 * k, 6), k); add(new THREE.OctahedronGeometry(0.35 * k), 2.2 * k); break;
                case 'trigger': case 'encounter': add(new THREE.CylinderGeometry(0.12 * k, 0.12 * k, 1.6 * k, 6), 0.8 * k); add(new THREE.OctahedronGeometry(0.3 * k), 1.8 * k); break;
                case 'sound': add(new THREE.TorusGeometry(0.7 * k, 0.07 * k, 6, 20), 1.2 * k, [Math.PI / 2, 0, 0]); add(new THREE.SphereGeometry(0.22 * k, 8, 6), 1.2 * k); break;
                case 'store': add(new THREE.BoxGeometry(0.9 * k, 0.9 * k, 0.9 * k), 0.45 * k); add(new THREE.ConeGeometry(0.55 * k, 0.5 * k, 4), 1.15 * k); break;
                case 'item': add(new THREE.OctahedronGeometry(0.28 * k), 0.45 * k); break;
                case 'door': add(new THREE.BoxGeometry(0.15 * k, 2 * k, 1.1 * k), k); break;
                case 'placeable': add(new THREE.BoxGeometry(0.55 * k, 0.55 * k, 0.55 * k), 0.28 * k); break;
                default: add(new THREE.SphereGeometry(0.3 * k, 8, 6), 0.5);
            }
        };

        /** The way a creature, door, placeable or waypoint faces: a line from the marker (bearing 0 faces east, as the game's). */
        const facing = (p, bearing, c, ghost) => {
            const dir = new THREE.Vector3(Math.cos(bearing ?? 0), 0, -Math.sin(bearing ?? 0));
            const a = p.clone().add(new THREE.Vector3(0, 0.3, 0)), b = a.clone().addScaledVector(dir, 1.6);
            const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: ghost, opacity: ghost ? 0.6 : 1 }));
            l.renderOrder = 5;
            group.add(l);
        };

        /** The whole of one thing, the editor's or an original's. */
        const draw = (t, id, sel, ghost) => {
            const c = tone(t.kind, sel, ghost);
            const hasOutline = t.outline?.length >= 3;
            const p = hasOutline ? at(t.outline[0][0], t.outline[0][1]) : at(t.x, t.y);
            marker(t.kind, p, c, sel, ghost, id);
            if (hasOutline) {
                const f = fill(t.outline, c, sel ? 0.42 : ghost ? 0.26 : 0.34);
                if (f) group.add(f);
                group.add(tag(ribbon(t.outline, sel ? 0.6 : 0.42, c, true, ghost), id));
                // A post at every corner, so the shape reads from far away; the selected one's are the handles.
                let corner = 0;
                for (const [x, y] of t.outline) {
                    if (sel) {
                        // A big invisible ball over the post: what a press on a corner grabs.
                        const grab = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
                        const gq = at(x, y, 0.5);
                        grab.position.copy(gq);
                        grab.userData.corner = { id, index: corner };
                        group.add(grab);
                    }
                    corner++;
                    const post = new THREE.Mesh(new THREE.CylinderGeometry(sel ? 0.18 : 0.1, sel ? 0.18 : 0.1, sel ? 1.2 : 0.8, 6), solid(c, ghost));
                    const q = at(x, y);
                    post.position.set(q.x, q.y + (sel ? 0.6 : 0.4), q.z);
                    group.add(post);
                }
            } else if (['creature', 'door', 'placeable', 'waypoint', 'store'].includes(t.kind)) {
                facing(p, t.bearing, c, ghost);
            }
        };
        for (const g of ghosts) draw(g, g.key, g.key === selectedKey, true);
        for (const t of things) draw(t, t.id, t.id === selectedId, false);
        if (draft?.length) {
            const white = new THREE.Color(0xffffff);
            if (draft.length >= 3) { const f = fill(draft, white, 0.2); if (f) group.add(f); }
            if (draft.length >= 2) group.add(ribbon(draft, 0.35, white, false));
            for (const [x, y] of draft) {
                const c = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
                c.position.copy(at(x, y, 0.3));
                c.renderOrder = 6;
                group.add(c);
            }
        }
    }

    /** The id of the thing whose marker is under the pointer, or null. Markers out of the Things tool are to look at, so
     *  they are only found with `any` (the right-click menu). */
    pickThing(clientX, clientY, any = false) {
        if (!this.thingGroup || (this.thingsInert && !any)) return null;
        const r = this.renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
        this.raycaster.setFromCamera(ndc, this.camera);
        this.raycaster.params.Line.threshold = 0.6;
        const hit = this.raycaster.intersectObject(this.thingGroup, true).find(h => h.object.userData.thing != null);
        this.raycaster.params.Line.threshold = 1;
        return hit?.object.userData.thing ?? null;
    }

    /** The corner of the selected outline under the pointer: { id, index }, or null. */
    pickCorner(clientX, clientY) {
        if (!this.thingGroup) return null;
        const r = this.renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
        this.raycaster.setFromCamera(ndc, this.camera);
        const hit = this.raycaster.intersectObject(this.thingGroup, true).find(h => h.object.userData.corner);
        return hit?.object.userData.corner ?? null;
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
        const inst = this.objectGroup?.children.find(c => c.userData.object === o && !c.userData.decal);
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
        const { nx, ny } = this.area;
        // Strips west and east (ny samples, two vertices each), south and
        // north (nx), then four corner quads.
        const strips = [ny, ny, nx, nx], first = [0, ny, 2 * ny, 2 * ny + nx], corners = 2 * (2 * ny + 2 * nx);
        const verts = corners + 4 * 4;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 3).fill(0.72), 3));
        const index = [];
        for (let s = 0; s < 4; s++) {
            for (let k = 0; k < strips[s] - 1; k++) {
                const a = (first[s] + k) * 2, b = a + 2;
                index.push(a, a + 1, b + 1, a, b + 1, b);
            }
        }
        for (let c = 0; c < 4; c++) {
            const a = corners + c * 4;
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
        const area = this.area, { nx, ny, sizeX: sx, sizeY: sy } = area, h = area.heights, D = 50;
        const pos = this.skirt.geometry.attributes.position;
        // Area point (x, y) at height z, as three.js wants it.
        const put = (v, x, y, z) => pos.setXYZ(v, x, z, sy - y);
        for (let k = 0; k < ny; k++) {
            const t = k * SPACING;
            put(k * 2, -D, t, h[k * nx]); put(k * 2 + 1, 0, t, h[k * nx]);
            put((ny + k) * 2, sx, t, h[k * nx + nx - 1]); put((ny + k) * 2 + 1, sx + D, t, h[k * nx + nx - 1]);
        }
        for (let k = 0; k < nx; k++) {
            const t = k * SPACING;
            put((2 * ny + k) * 2, t, -D, h[k]); put((2 * ny + k) * 2 + 1, t, 0, h[k]);
            put((2 * ny + nx + k) * 2, t, sy, h[(ny - 1) * nx + k]); put((2 * ny + nx + k) * 2 + 1, t, sy + D, h[(ny - 1) * nx + k]);
        }
        const first = 2 * (2 * ny + 2 * nx);
        const corners = [[0, 0, -D, -D], [0, sy, -D, sy + D], [sx, 0, sx + D, -D], [sx, sy, sx + D, sy + D]];
        corners.forEach(([x, y, fx, fy], c) => {
            const z = area.heightAt(x, y), a = first + c * 4;
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
        const area = this.area, n = area.nx, rows = area.ny, size = area.sizeY, sx = area.sizeX, L = area.waterLevel;
        if (this.water) { this.scene.remove(this.water); this.water.geometry.dispose(); }
        this.water = null;
        const pos = [];
        for (let j = 0; j < rows - 1; j++) {
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
        const lv = (a, b) => Math.max(Number.isNaN(a) ? -Infinity : a, Number.isNaN(b) ? -Infinity : b);
        let l;
        for (let k = 0; k < rows - 1; k++) {
            const t0 = k * SPACING, t1 = t0 + SPACING;
            if ((l = lv(wet(0, k), wet(0, k + 1))) > -Infinity) quad(-D, t0, 0, t1, l);
            if ((l = lv(wet(n - 1, k), wet(n - 1, k + 1))) > -Infinity) quad(sx, t0, sx + D, t1, l);
        }
        for (let k = 0; k < n - 1; k++) {
            const t0 = k * SPACING, t1 = t0 + SPACING;
            if ((l = lv(wet(k, 0), wet(k + 1, 0))) > -Infinity) quad(t0, -D, t1, 0, l);
            if ((l = lv(wet(k, rows - 1), wet(k + 1, rows - 1))) > -Infinity) quad(t0, size, t1, size + D, l);
        }
        for (const [i, j, x0, y0, x1, y1] of [[0, 0, -D, -D, 0, 0], [0, rows - 1, -D, size, 0, size + D], [n - 1, 0, sx, -D, sx + D, 0], [n - 1, rows - 1, sx, size, sx + D, size + D]]) {
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
        this.markDirty(this.everything());
    }

    /** The tile grid, draped 5 cm above the ground. */
    updateGrid() {
        const area = this.area, size = area.sizeY;
        const pts = [];
        // Lines of constant x (running north), then of constant y (running east).
        for (let t = 0; t <= area.tiles; t++) {
            const along = t * TILE;
            for (let k = 0; k < area.ny - 1; k++) {
                const a = k * SPACING, b = (k + 1) * SPACING;
                pts.push(along, area.heightAt(along, a) + 0.05, size - a, along, area.heightAt(along, b) + 0.05, size - b);
            }
        }
        for (let t = 0; t <= area.tilesY; t++) {
            const along = t * TILE;
            for (let k = 0; k < area.nx - 1; k++) {
                const a = k * SPACING, b = (k + 1) * SPACING;
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
        return { x: hit.point.x, y: this.area.sizeY - hit.point.z, z: hit.point.y };
    }

    /** The room being dragged out: its outline on the floor (or none). */
    setRoomOutline(r, z) {
        if (this.roomLine) { this.scene.remove(this.roomLine); this.roomLine.geometry.dispose(); this.roomLine = null; }
        if (!r) return;
        const s = this.area.sizeY, y = z + 0.1;
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
            pts.push(new THREE.Vector3(x, this.area.heightAt(x, y) + 0.15, this.area.sizeY - y));
        }
        this.cursor.geometry.setFromPoints(pts);
        this.cursor.visible = true;
    }

    /** Pillars at export warnings: red where a route stops (it breaks
     *  routes); orange to look at: a passage closed, a tile too winding. */
    setMarkers(warnings) {
        if (this.markers) { this.scene.remove(this.markers); this.markers.traverse(c => { c.geometry?.dispose(); c.material?.map?.dispose(); c.material?.dispose?.(); }); }
        this.markers = new THREE.Group();
        for (const w of warnings) {
            const failed = w.kind === 'failed_route', closed = w.kind === 'closed_passage';
            const at = failed ? w.stops_at : closed ? w.at : [(w.from[0] + w.to[0]) / 2, (w.from[1] + w.to[1]) / 2];
            const color = failed ? 0xe0402a : 0xff9a1f;
            const ground = this.area.heightAt(at[0], at[1]);
            const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 5, 12), new THREE.MeshBasicMaterial({ color }));
            pillar.position.set(at[0], ground + 2.5, this.area.sizeY - at[1]);
            this.markers.add(pillar);
            const label = makeLabel(failed ? 'Route stops here' : closed ? 'Passage closed' : `Tile ${w.tile[0]},${w.tile[1]}: too winding`, color);
            label.position.set(at[0], ground + 6, this.area.sizeY - at[1]);
            this.markers.add(label);
        }
        this.markers.visible = this.showMarkers !== false;
        this.scene.add(this.markers);
    }

    /** Shows or hides the markers (they stay, and update, either way). */
    setShowMarkers(on) {
        this.showMarkers = on;
        if (this.markers) this.markers.visible = on;
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
