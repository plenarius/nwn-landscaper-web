// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The 3D view of one area: the terrain with its painted textures (or
// coloured by height until they load), tinted where NWN won't walk, the
// 10 m NWN tile grid draped on it, the brush cursor, and export warnings.
//
// Frames: NWN x = three x; NWN y (north) = size - three z, so north is -Z,
// away from the default camera; height is three y.

import { THING_COLOURS } from './thingcolours.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SPACING, TILE, VOID_BELOW, WALKABLE_NZ, CHASM_DARK } from './area.js';
import { fogRange } from './atmosphere.js';
import { shadeArea, shadeChanged, SHADE_STEP } from './shade.js';
import { at as entranceAt, groundBehind, scenery as entranceScenery } from './entrance.js';

const GRASS_LOW = new THREE.Color(0x4f7a32);
const GRASS_HIGH = new THREE.Color(0x7d9b4a);
const ROCK = new THREE.Color(0x8a8378);
const BLOCKED = new THREE.Color(0xc0503c);
const WHITE = new THREE.Color(1, 1, 1);
/** The rectangle (i0..i1, j0..j1) covering rectangles `a` and `b`, either of which may be none (null or false). */
const union = (a, b) =>
    a && b ? { i0: Math.min(a.i0, b.i0), i1: Math.max(a.i1, b.i1), j0: Math.min(a.j0, b.j0), j1: Math.max(a.j1, b.j1) } : a || b || null;
// Multiplies the painted texture on ground too steep to walk.
const BLOCKED_TINT = new THREE.Color(1.0, 0.42, 0.36);
// Metres one texture repeat covers on the ground (landscaper's TEXTURE_METRES).
const TEXTURE_METRES = 4;

// Splat shading, as landscaper bakes it into the NWN tiles: each sample has
// a texture (an index into the area palette, stored in uMat); a point
// blends its four surrounding samples' textures bilinearly, so painted
// edges soften over one 0.625 m sample. Ground too steep to walk takes its
// texture from the side (along x + y, and up) and from the nearest sample.
// v is negated: the texture array's rows run top first, NWN's bottom first.
// Baked shadows over the lit ground, as the game's shadow-map shader
// multiplies them (fog comes after, in three.js as in the game).
// Only over the area: the edge scenery has no shadow map. With baked
// objects, their shadows from the view's shadow map join the terrain's as
// the engine joins them (landscaper shade.rs, combine; without the sky they
// hide, which it adds).
const SHADE_FRAGMENT = `
    {
        vec2 extent = (uShadeCells - 1.0) * ${SHADE_STEP.toFixed(4)};
        if (all(greaterThanEqual(vArea, vec2(0.0))) && all(lessThanEqual(vArea, extent)))
        {
            vec4 sh = texture2D(uShade, (vArea / ${SHADE_STEP.toFixed(4)} + 0.5) / uShadeCells);
            float s = sh.r;
            #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
            if (uObjectShadows) {
                float through = getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize,
                    directionalLightShadows[0].shadowIntensity, directionalLightShadows[0].shadowBias,
                    directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]);
                float lit = 1.0 - 0.6 * (1.0 - (1.0 - sh.g) * through);
                s = clamp(1.0 - uShadowStrength * (1.0 - lit * (1.0 - 0.8 * sh.b)), 0.15, 1.0) * sh.a;
            }
            #endif
            // (The game multiplies in display colours, three.js in linear ones: 0.64 there is about 0.37 here.)
            diffuseColor.rgb *= pow(s, 2.2);
        }
        if (vGap <= ${VOID_BELOW.toFixed(2)}) diffuseColor.rgb = vec3(0.0);
        // A chasm's walls fade to black going down, as landscaper's fade darkens them (chasmFade, in the game's colours).
        if (vDeep > 0.0) diffuseColor.rgb *= pow(pow(max(0.0, 1.0 - vDeep / ${CHASM_DARK.toFixed(2)}), 1.6), 2.2);
    }`;

// The underlay (underlay.js): a picture lying on the ground to trace over, blended over the ground's colour where it covers
// it. uUnderM maps area metres to the picture's 0..1; uUnderOpacity 0 hides it.
const UNDERLAY_FRAGMENT = `
    if (uUnderOpacity > 0.0) {
        vec2 uv = (uUnderM * vec3(vArea, 1.0)).xy;
        if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
            vec4 under = texture2D(uUnder, uv);
            diffuseColor.rgb = mix(diffuseColor.rgb, under.rgb, under.a * uUnderOpacity);
        }
    }`;

const SPLAT_VERTEX = `
    vArea = vec2(transformed.x, uSize.y - transformed.z);
    vUp = transformed.y;
    vGap = aGap;
    vDeep = aDeep;
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

// The things' markers (View.setThings): each kind's parts, made at MARKER_SIZE (a selected one is drawn a quarter bigger),
// standing `y` marker sizes up (`fixed`: metres), turned by `rot`. A trigger's and an encounter's are the same.
const MARKER_SIZE = 1.35;
const FLAG = [
    { geo: k => new THREE.CylinderGeometry(0.12 * k, 0.12 * k, 1.6 * k, 6), y: 0.8 },
    { geo: k => new THREE.OctahedronGeometry(0.3 * k), y: 1.8 },
];
const MARKER_PARTS = {
    creature: [
        { geo: k => new THREE.ConeGeometry(0.32 * k, 1.5 * k, 10), y: 0.75 },
        { geo: k => new THREE.SphereGeometry(0.27 * k, 10, 8), y: 1.75 },
    ],
    waypoint: [
        { geo: k => new THREE.CylinderGeometry(0.05 * k, 0.05 * k, 2 * k, 6), y: 1 },
        { geo: k => new THREE.OctahedronGeometry(0.35 * k), y: 2.2 },
    ],
    trigger: FLAG,
    encounter: FLAG,
    sound: [
        { geo: k => new THREE.TorusGeometry(0.7 * k, 0.07 * k, 6, 20), y: 1.2, rot: [Math.PI / 2, 0, 0] },
        { geo: k => new THREE.SphereGeometry(0.22 * k, 8, 6), y: 1.2 },
    ],
    store: [
        { geo: k => new THREE.BoxGeometry(0.9 * k, 0.9 * k, 0.9 * k), y: 0.45 },
        { geo: k => new THREE.ConeGeometry(0.55 * k, 0.5 * k, 4), y: 1.15 },
    ],
    item: [{ geo: k => new THREE.OctahedronGeometry(0.28 * k), y: 0.45 }],
    door: [{ geo: k => new THREE.BoxGeometry(0.15 * k, 2 * k, 1.1 * k), y: 1 }],
    placeable: [{ geo: k => new THREE.BoxGeometry(0.55 * k, 0.55 * k, 0.55 * k), y: 0.28 }],
};
const OTHER_MARKER = [{ geo: k => new THREE.SphereGeometry(0.3 * k, 8, 6), y: 0.5, fixed: true }];
// A corner post of an outline (a selected one's are 1.8 times as thick and 1.5 times as tall).
const POST = () => new THREE.CylinderGeometry(0.1, 0.1, 0.8, 6);

/** The 3D view in `container`: the ground, objects, water, things and markers of the area, the camera, and picking with the
 *  pointer. */
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
        // The baked objects' shadows, from the game's sun in either light: a light that lights nothing, only its shadow map
        // (the ground reads it, see SHADE_FRAGMENT). Drawn again only when the objects change (updateObjectShadows).
        this.shadowSun = new THREE.DirectionalLight(0xffffff, 0);
        this.shadowSun.shadow.radius = 3;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.shadowMap.autoUpdate = false;
        this.scene.add(this.workSun, this.workSky, this.areaSun, this.areaAmbient, this.shadowSun, this.shadowSun.target);
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
            // The baked objects' shadows (updateObjectShadows), and the area's shadow strength they are drawn at.
            uObjectShadows: { value: false },
            uShadowStrength: { value: 0 },
            // A cave's rock tops from here up are void: black.
            // An imported area's picture, and its palette index (-1: none).
            uImport: { value: null },
            uImportLayer: { value: -1 },
            // The underlay's picture, where it lies (area metres to its 0..1) and how opaque it is (0: not shown).
            uUnder: { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1) },
            uUnderM: { value: new THREE.Matrix3() },
            uUnderOpacity: { value: 0 },
        };
        this.uniforms.uUnder.value.needsUpdate = true;
        this.uniforms.uTex.value.needsUpdate = true;
        this.raycaster = new THREE.Raycaster();
        this.dirty = null;
        // Counts the ground's changes and redraws, so a kept pick (lastPick) or outline (setThings) knows the ground moved.
        this.groundVersion = 0;
        this.lastPick = null;
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
        const w = this.container.clientWidth,
            h = this.container.clientHeight;
        if (!w || !h) return;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    /** Shows a new area and frames the camera on it. */
    setArea(area) {
        this.area = area;
        for (const o of [
            this.mesh,
            this.grid,
            this.markers,
            this.water,
            this.skirt,
            this.entranceGroup,
            this.objectGroup,
            this.thingGroup,
        ]) {
            if (o) {
                this.scene.remove(o);
                o.traverse?.(c => {
                    c.geometry?.dispose();
                    // (a marker's label is a texture drawn for it, as setMarkers disposes it)
                    if (o === this.markers) c.material?.map?.dispose();
                    c.material?.dispose?.();
                });
            }
        }
        this.markers = null;
        this.water = null;
        this.lastPick = null;
        this.fit = null;
        this.chasmFit = null;
        this.drawn = null;
        const { nx, ny, sizeX, sizeY } = area;
        const geo = new THREE.PlaneGeometry(sizeX, sizeY, nx - 1, ny - 1);
        geo.rotateX(-Math.PI / 2);
        geo.translate(sizeX / 2, 0, sizeY / 2);
        // How far under its ceiling each sample is: the rock tops (0.3 or less) are void, drawn black.
        geo.setAttribute('aGap', new THREE.BufferAttribute(new Float32Array(nx * ny).fill(1e9), 1));
        // How far down a chasm each sample is, over its depth: 0 out of one, 1 on its floor (drawn black, its walls fading).
        geo.setAttribute('aDeep', new THREE.BufferAttribute(new Float32Array(nx * ny), 1));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nx * ny * 3), 3));
        this.uniforms.uMat.value?.dispose();
        const mat = new THREE.DataTexture(area.materials, nx, ny, THREE.RedFormat, THREE.UnsignedByteType);
        mat.minFilter = mat.magFilter = THREE.NearestFilter;
        mat.unpackAlignment = 1;
        mat.needsUpdate = true;
        this.uniforms.uMat.value = mat;
        this.uniforms.uN.value.set(nx, ny);
        this.uniforms.uSize.value.set(sizeX, sizeY);
        this.shadeDirty = null;
        this.updateShade(true);
        this.mesh = new THREE.Mesh(geo, this.splatMaterial());
        // (So three.js hands it the object shadows' map. Its own dimming darkens only the shadow light, which lights nothing.)
        this.mesh.receiveShadow = true;
        this.scene.add(this.mesh);
        this.buildSkirt();
        this.grid = new THREE.LineSegments(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
        );
        // (its lines are moved in place, so a bounding sphere worked out once would go stale)
        this.grid.frustumCulled = false;
        this.scene.add(this.grid);
        this.paletteKey = null;
        // (the shadows were baked whole above)
        this.markDirty(this.everything(), false);
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
                .replace(
                    '#include <common>',
                    '#include <common>\nuniform vec2 uSize;\nattribute float aGap;\nattribute float aDeep;\nvarying float vGap;\nvarying float vDeep;\nvarying vec2 vArea;\nvarying float vUp;\nvarying float vNormalUp;',
                )
                .replace('#include <begin_vertex>', `#include <begin_vertex>${SPLAT_VERTEX}`);
            shader.fragmentShader = shader.fragmentShader
                .replace(
                    '#include <common>',
                    '#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray uTex;\nuniform sampler2D uMat;\nuniform vec2 uN;\nuniform bool uTextured;\nuniform sampler2D uShade;\nuniform vec2 uShadeCells;\nuniform bool uObjectShadows;\nuniform float uShadowStrength;\nuniform sampler2D uImport;\nuniform float uImportLayer;\nuniform sampler2D uUnder;\nuniform mat3 uUnderM;\nuniform float uUnderOpacity;\nuniform vec2 uSize;\nvarying float vGap;\nvarying float vDeep;\nvarying vec2 vArea;\nvarying float vUp;\nvarying float vNormalUp;',
                )
                .replace('#include <color_fragment>', `#include <color_fragment>${SPLAT_FRAGMENT}${UNDERLAY_FRAGMENT}${SHADE_FRAGMENT}`);
        };
        material.customProgramCacheKey = () => 'landscaper-splat';
        return material;
    }

    /** Bakes the shadows again after the ground changed: where the changes since the last bake (markDirty) can reach.
     *  `all`: the whole area (another area, the shadows' strength or the entrances changed). */
    updateShade(all = false) {
        const r = this.shadeDirty,
            baked = this.uniforms.uShade.value;
        this.shadeDirty = null;
        if (!all && !r) return;
        if (!all && baked?.image.data && r) {
            shadeChanged(this.area, this.area.shadow, baked.image.data, {
                x0: r.i0 * SPACING,
                y0: r.j0 * SPACING,
                x1: r.i1 * SPACING,
                y1: r.j1 * SPACING,
            });
            baked.needsUpdate = true;
            return;
        }
        const { mx, my, data } = shadeArea(this.area, this.area.shadow);
        const old = this.uniforms.uShade.value;
        const tex = new THREE.DataTexture(data, mx, my, THREE.RGBAFormat, THREE.UnsignedByteType);
        tex.minFilter = tex.magFilter = THREE.LinearFilter;
        tex.unpackAlignment = 1;
        tex.needsUpdate = true;
        this.uniforms.uShade.value = tex;
        this.uniforms.uShadeCells.value.set(mx, my);
        old?.dispose();
        // (the strength or the kind of area may have changed)
        this.updateObjectShadows();
    }

    /** Draws the baked objects' shadows again (they moved, came or went, or the area changed): the shadow light's map over
     *  the area and its objects, about 6 cm a texel up to 4096 a side. None underground, at strength 0, or with no baked
     *  object (the engine bakes none then either). */
    updateObjectShadows() {
        const area = this.area,
            light = this.shadowSun,
            group = this.objectGroup;
        const casting = group?.children.some(c => c.userData.object?.baked !== false && !c.userData.decal);
        const on = !!(area && area.shadow > 0 && !area.enclosed() && casting);
        this.uniforms.uShadowStrength.value = area?.shadow ?? 0;
        this.uniforms.uObjectShadows.value = on;
        if (light.castShadow !== on) light.castShadow = on;
        if (!on) return;
        // Towards the game's sun, (4000, 4500, 7000) in NWN axes, from the middle of the area and everything in it.
        const box = new THREE.Box3().setFromObject(group);
        box.expandByPoint(new THREE.Vector3(0, box.min.y, 0)).expandByPoint(new THREE.Vector3(area.sizeX, box.max.y, area.sizeY));
        const centre = box.getCenter(new THREE.Vector3()),
            reach = box.getSize(new THREE.Vector3()).length();
        light.target.position.copy(centre);
        light.position.copy(centre).addScaledVector(new THREE.Vector3(4000, 7000, -4500).normalize(), reach);
        light.target.updateMatrixWorld();
        light.updateMatrixWorld();
        // The camera's box: the area's and objects' corners as the light sees them.
        const cam = light.shadow.camera;
        cam.position.copy(light.position);
        cam.lookAt(light.target.position);
        cam.updateMatrixWorld();
        const lo = new THREE.Vector3(Infinity, Infinity, Infinity),
            hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
        for (let k = 0; k < 8; k++) {
            const p = new THREE.Vector3(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z);
            p.applyMatrix4(cam.matrixWorldInverse);
            lo.min(p);
            hi.max(p);
        }
        Object.assign(cam, { left: lo.x, right: hi.x, bottom: lo.y, top: hi.y, near: Math.max(0.1, -hi.z - 1), far: -lo.z + 1 });
        cam.updateProjectionMatrix();
        const size = Math.min(
            4096,
            this.renderer.capabilities.maxTextureSize,
            2 ** Math.ceil(Math.log2(Math.max(hi.x - lo.x, hi.y - lo.y) / 0.06)),
        );
        if (light.shadow.mapSize.x !== size) {
            light.shadow.mapSize.set(size, size);
            light.shadow.map?.dispose();
            light.shadow.map = null;
        }
        this.renderer.shadowMap.needsUpdate = true;
        // Cut-outs cast through their pictures' alpha, so a picture still loading casts nothing: again once they are all in.
        const loading = [...(this.models?.loaded.values() ?? [])];
        Promise.all(loading).then(() => {
            if (this.uniforms.uObjectShadows.value) this.renderer.shadowMap.needsUpdate = true;
        });
    }

    /** Puts a copy of object `o`'s model where it stands; a baked one casts a shadow, a placeable (object mode) none, as the
     *  engine bakes them. */
    place(inst, o) {
        inst.position.set(o.x, o.z, this.area.sizeY - o.y);
        inst.rotation.y = o.bearing;
        inst.scale.setScalar(o.scale);
        const casts = o.baked !== false;
        inst.traverse(m => {
            if (m.isMesh) m.castShadow = casts;
        });
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
            picture = await new Promise(resolve =>
                new THREE.TextureLoader().load(`/api/import/${encodeURIComponent(name)}`, resolve, undefined, () => resolve(null)),
            );
            if (picture) {
                picture.colorSpace = THREE.SRGBColorSpace;
                picture.wrapS = picture.wrapT = THREE.ClampToEdgeWrapping;
                picture.anisotropy = 4;
            }
        }
        if (key !== this.paletteKey) {
            tex.dispose();
            picture?.dispose();
            return;
        }
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
            this.markDirty(this.everything(), false);
        }
    }

    frame() {
        const { sizeX: sx, sizeY: sy } = this.area,
            s = Math.max(sx, sy);
        // The whole area in view, from the south, tilted down ~40 degrees.
        const mid = this.area.heightAt(sx / 2, sy / 2);
        this.controls.target.set(sx / 2, mid, sy / 2);
        this.camera.position.set(sx / 2, mid + s * 0.95, sy / 2 + s * 1.15);
        this.controls.minDistance = 5;
        this.controls.maxDistance = s * 3 + 100;
        this.controls.update();
    }

    // --- The camera from the keyboard (the mouse's: right-drag turns, middle-drag moves, wheel zooms) ----------------

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

    /** Lays picture `image` (an HTMLImageElement or canvas; null: none) under the ground, as underlay.js keeps it. */
    setUnderlayPicture(image) {
        const old = this.uniforms.uUnder.value;
        const tex = image ? new THREE.Texture(image) : new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
        if (image) {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = 4;
            tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        }
        tex.needsUpdate = true;
        this.uniforms.uUnder.value = tex;
        old.dispose();
    }

    /** Where the underlay lies: `u` is { x, y (its middle, area metres), w, h (metres), angle (radians, anticlockwise),
     *  opacity (0 to 1), shown }, or null for none. */
    setUnderlayPlace(u) {
        if (!u?.shown || !(u.w > 0) || !(u.h > 0)) {
            this.uniforms.uUnderOpacity.value = 0;
            return;
        }
        const c = Math.cos(u.angle ?? 0),
            s = Math.sin(u.angle ?? 0);
        // Area point p: its offset from the middle turned back by the angle, over the size, plus a half.
        this.uniforms.uUnderM.value.set(
            c / u.w,
            s / u.w,
            -(c * u.x + s * u.y) / u.w + 0.5,
            -s / u.h,
            c / u.h,
            (s * u.x - c * u.y) / u.h + 0.5,
            0,
            0,
            1,
        );
        this.uniforms.uUnderOpacity.value = Math.min(1, Math.max(0, u.opacity ?? 0.6));
    }

    /** The whole area, as a dirty range. */
    everything() {
        return { i0: 0, i1: this.area.nx - 1, j0: 0, j1: this.area.ny - 1 };
    }

    /** Samples `r` (i0..i1, j0..j1) changed: redrawn at the next frame (flush), and their shadows at the next updateShade.
     *  `moved` false: only their colour changed (paint, water, walkability), which the shadows don't depend on; a later
     *  stroke's bake then covers its own change only (after one press of W it covered the whole area, 430 ms against 63). */
    markDirty(r, moved = true) {
        if (!r) return;
        const join = d =>
            d
                ? { i0: Math.min(d.i0, r.i0), i1: Math.max(d.i1, r.i1), j0: Math.min(d.j0, r.j0), j1: Math.max(d.j1, r.j1) }
                : { i0: r.i0, i1: r.i1, j0: r.j0, j1: r.j1 };
        this.dirty = join(this.dirty);
        if (!moved) return;
        this.shadeDirty = join(this.shadeDirty);
        this.groundVersion++;
    }

    /** Entrance `e`'s mouth darkens the shadows round it (entrance.js, darkness): the samples it reaches, as a change of the
     *  ground there, baked at the next updateShade. */
    markEntrance(e) {
        const reach = Math.hypot(e.depth + 1.5, e.width / 2 + 1.5) + SHADE_STEP,
            { nx, ny } = this.area;
        const r = {
            i0: Math.max(0, Math.floor((e.x - reach) / SPACING)),
            i1: Math.min(nx - 1, Math.ceil((e.x + reach) / SPACING)),
            j0: Math.max(0, Math.floor((e.y - reach) / SPACING)),
            j1: Math.min(ny - 1, Math.ceil((e.y + reach) / SPACING)),
        };
        const d = this.shadeDirty;
        this.shadeDirty = d
            ? { i0: Math.min(d.i0, r.i0), i1: Math.max(d.i1, r.i1), j0: Math.min(d.j0, r.j0), j1: Math.max(d.j1, r.j1) }
            : r;
    }

    /** Vertex index of sample (i, j): plane rows run north to south. */
    vertex(i, j) {
        return (this.area.ny - 1 - j) * this.area.nx + i;
    }

    flush() {
        this.groundVersion++;
        const area = this.area,
            n = area.nx,
            d = this.dirty;
        this.dirty = null;
        const pos = this.mesh.geometry.attributes.position;
        const col = this.mesh.geometry.attributes.color;
        // A roof that follows the floor (a ceiling height) can move far from an edit: fitted again whole, then redrawn where
        // the fit changed as well (a whole redraw took 86 ms a Dig frame on a 32×32 cave).
        const fit = area.ceilingFit(),
            chasm = area.chasmFit(fit ? fit.shown : area.heights),
            moved = union(fit && this.fitChanged(this.fit, fit), this.chasmChanged(this.chasmFit, chasm));
        this.fit = fit;
        this.chasmFit = chasm;
        const r = moved
            ? { i0: Math.min(d.i0, moved.i0), i1: Math.max(d.i1, moved.i1), j0: Math.min(d.j0, moved.j0), j1: Math.max(d.j1, moved.j1) }
            : d;
        // Heights of the changed rows and a margin (walkability uses neighbours).
        const i0 = Math.max(0, r.i0 - 1),
            i1 = Math.min(n - 1, r.i1 + 1),
            j0 = Math.max(0, r.j0 - 1),
            j1 = Math.min(area.ny - 1, r.j1 + 1);
        const gap = this.mesh.geometry.attributes.aGap,
            deep = this.mesh.geometry.attributes.aDeep,
            shownHeights = chasm ? chasm.shown : fit ? fit.shown : area.heights;
        // (the edge scenery carries these out)
        this.drawn = shownHeights;
        // The colour range of the untextured ground (with the library's textures it isn't used).
        let lo = Infinity,
            hi = -Infinity;
        if (!this.textured)
            for (const v of area.heights) {
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
        const span = Math.max(hi - lo, 1);
        const c = new THREE.Color();
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                const v = this.vertex(i, j),
                    z = area.heights[j * n + i],
                    shown = shownHeights[j * n + i];
                pos.setY(v, shown);
                gap.setX(v, !area.enclosed() ? 1e9 : fit ? fit.ceiling[j * n + i] - shown : area.roof - shown);
                deep.setX(v, chasm ? chasm.deep[j * n + i] : 0);
                // Under water the water shows it; no red tint. (Nor in a chasm: it is dark.)
                const wet = !Number.isNaN(area.waterLevel[j * n + i]);
                if (chasm?.deep[j * n + i]) c.copy(this.textured ? WHITE : ROCK);
                else if (this.textured) {
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
        gap.needsUpdate = true;
        deep.needsUpdate = true;
        col.needsUpdate = true;
        this.uniforms.uMat.value.needsUpdate = true;
        // Only what the change reaches: on a 32×32 area each of these over the whole mesh took most of a 245 ms frame.
        this.updateNormals(i0 - 1, i1 + 1, j0 - 1, j1 + 1);
        this.updateBounds(i0, i1, j0, j1);
        this.updateGrid({ i0, i1, j0, j1 });
        // (the edge scenery carries the outer rows and columns out: a fifth of a stroke's redraw, for a stroke far from them)
        if (i0 === 0 || j0 === 0 || i1 === n - 1 || j1 === area.ny - 1) this.updateSkirt();
    }

    /** The samples whose ceiling or drawn height differ between ceiling fits `was` and `now` (i0..i1, j0..j1), null when none
     *  do; the whole area when there was no fit before. */
    fitChanged(was, now) {
        const { nx } = this.area;
        if (!was || was.shown.length !== now.shown.length) return this.everything();
        let i0 = Infinity,
            i1 = -1,
            j0 = Infinity,
            j1 = -1;
        for (let k = 0; k < now.shown.length; k++) {
            if (was.shown[k] === now.shown[k] && was.ceiling[k] === now.ceiling[k]) continue;
            const i = k % nx,
                j = (k - i) / nx;
            if (i < i0) i0 = i;
            if (i > i1) i1 = i;
            if (j < j0) j0 = j;
            j1 = j;
        }
        return i1 < 0 ? null : { i0, i1, j0, j1 };
    }

    /** The samples whose drawn height differs between chasm fits `was` and `now` (i0..i1, j0..j1), null when none do: a chasm
     *  sample's rim is the nearest ground's, which can be far from an edit. The whole area when a chasm came or went. */
    chasmChanged(was, now) {
        if (!was && !now) return null;
        if (!was || !now || was.shown.length !== now.shown.length) return this.everything();
        const { nx } = this.area;
        let i0 = Infinity,
            i1 = -1,
            j0 = Infinity,
            j1 = -1;
        for (let k = 0; k < now.shown.length; k++) {
            if (was.shown[k] === now.shown[k] && was.deep[k] === now.deep[k]) continue;
            const i = k % nx,
                j = (k - i) / nx;
            if (i < i0) i0 = i;
            if (i > i1) i1 = i;
            if (j < j0) j0 = j;
            j1 = j;
        }
        return i1 < 0 ? null : { i0, i1, j0, j1 };
    }

    /** The ground's normals at samples i0..i1, j0..j1 (clamped to the area), from its drawn heights: each sample's slope
     *  between its neighbours, as a regular grid's averaged triangle normals give it. */
    updateNormals(i0, i1, j0, j1) {
        const { nx, ny } = this.area,
            geo = this.mesh.geometry,
            y = geo.attributes.position.array,
            nor = geo.attributes.normal;
        const h = (i, j) => y[this.vertex(i, j) * 3 + 1];
        for (let j = Math.max(0, j0); j <= Math.min(ny - 1, j1); j++) {
            for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) {
                const w = Math.max(i - 1, 0),
                    e = Math.min(i + 1, nx - 1),
                    s = Math.max(j - 1, 0),
                    n = Math.min(j + 1, ny - 1);
                // Rise per metre east and north; three.js's z runs south, so north's rise turns the normal towards +z.
                const east = (h(e, j) - h(w, j)) / ((e - w) * SPACING),
                    north = (h(i, n) - h(i, s)) / ((n - s) * SPACING);
                const len = Math.hypot(east, 1, north);
                nor.setXYZ(this.vertex(i, j), -east / len, 1 / len, north / len);
            }
        }
        nor.needsUpdate = true;
    }

    /** The ground's bounds (for picking): worked out whole when everything changed, else grown to the changed heights. A
     *  box that is too tall after the ground is lowered only costs the picking an early miss. */
    updateBounds(i0, i1, j0, j1) {
        const geo = this.mesh.geometry,
            { nx, ny } = this.area;
        if (!geo.boundingBox || (i0 === 0 && j0 === 0 && i1 === nx - 1 && j1 === ny - 1)) {
            geo.computeBoundingBox();
            geo.computeBoundingSphere();
            return;
        }
        const y = geo.attributes.position.array,
            box = geo.boundingBox;
        for (let j = j0; j <= j1; j++)
            for (let i = i0; i <= i1; i++) {
                const v = y[this.vertex(i, j) * 3 + 1];
                if (v < box.min.y) box.min.y = v;
                if (v > box.max.y) box.max.y = v;
            }
        box.getBoundingSphere(geo.boundingSphere);
    }

    /** Entrances as the game will show them: the roof in the hill's paint,
     *  its rock, the dark back, and the door (orange) to link. */
    updateEntrances() {
        if (this.entranceGroup) {
            this.scene.remove(this.entranceGroup);
            this.entranceGroup.traverse(c => {
                c.geometry?.dispose();
                if (c.material && !c.material.userData.shared) c.material.dispose();
            });
        }
        this.entranceGroup = new THREE.Group();
        const area = this.area,
            size = area.sizeY,
            height = (x, y) => area.heightAt(x, y);
        // Texture coordinates as landscaper writes them: from above, and
        // tilted with height for the rock.
        const flat = (x, y) => [x / 4, y / 4];
        const tilted = (x, y, z) => [(x + 0.6 * z) / 4, (y - 0.4 * z) / 4];
        const mesh = (tris, uvOf, material) => {
            const pos = [],
                uv = [];
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
            const hill = groundBehind(area, e);
            this.blackMaterial ??= Object.assign(new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }), {
                userData: { shared: true },
            });
            this.entranceGroup.add(
                mesh(sc.top, flat, this.libraryMaterial(hill, 0x5d7a3a)),
                mesh(sc.rock, tilted, this.libraryMaterial(e.rock ?? 'rockCliff', 0x77716a)),
                mesh(sc.back, flat, this.blackMaterial),
            );
            const door = new THREE.Mesh(
                new THREE.PlaneGeometry(e.width * 0.8, 2.2),
                new THREE.MeshBasicMaterial({ color: 0xff9a1f, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
            );
            const [dx, dy] = entranceAt(e, e.depth - 0.15, 0);
            door.position.set(dx, e.floor + 1.1, size - dy);
            door.rotation.y = e.dir + Math.PI / 2;
            this.entranceGroup.add(door);
        }
        this.scene.add(this.entranceGroup);
    }

    /** Placed objects, from the model library (set by the app). The models' geometry and materials are the library's,
     *  shared by every copy and kept; what this group made itself (the ground patches) is freed with it. */
    async updateObjects() {
        if (this.objectGroup) {
            this.scene.remove(this.objectGroup);
            for (const c of this.objectGroup.children) if (c.userData.decal) disposeDecal(c);
        }
        const group = new THREE.Group();
        this.objectGroup = group;
        this.scene.add(group);
        this.updateObjectShadows();
        if (!this.models) return;
        // All at once, each drawn as its model arrives. (syncObjects waits for this to end before matching what is drawn.)
        this.objectsLoading = group;
        await Promise.all(
            this.area.objects.map(async o => {
                let model;
                try {
                    model = await this.models.group(o.model);
                } catch {
                    return;
                }
                if (group !== this.objectGroup) return; // rebuilt meanwhile
                const inst = model.clone();
                this.place(inst, o);
                inst.userData.object = o;
                group.add(inst);
                this.addDecal(group, o, model.userData.flat);
                if (o === this.selected) this.showSelection(inst);
            }),
        );
        if (this.objectsLoading === group) this.objectsLoading = null;
        if (group === this.objectGroup) this.updateObjectShadows();
    }

    /** Draws the area's objects again after undo or redo, which gives the area new copies of them all: each one drawn is
     *  matched to its copy by id and moved if it moved, and only those added, taken out or given another model are drawn
     *  again or taken away (updateObjects cloned all 300 of an area's rocks again, 226 ms). */
    syncObjects() {
        const group = this.objectGroup,
            objects = this.area.objects,
            byId = new Map(objects.map(o => [o.id, o]));
        // (ids missing or given twice, or models still arriving for the objects drawn: all of them again)
        if (!group || !this.models || this.objectsLoading || byId.size !== objects.length || byId.has(undefined)) {
            this.updateObjects();
            return;
        }
        const gone = new Set(),
            moved = new Set(),
            drawn = new Set();
        for (const c of group.children) {
            const was = c.userData.object,
                now = byId.get(was.id);
            if (!now || now.model !== was.model) {
                gone.add(was);
                continue;
            }
            c.userData.object = now;
            if (!c.userData.decal) drawn.add(now);
            // (a ground patch follows the ground, which undo may have moved: drawn again with its object)
            if (c.userData.decal || ['x', 'y', 'z', 'bearing', 'scale'].some(k => now[k] !== was[k])) moved.add(now);
        }
        this.removeObjects(gone);
        for (const o of moved) if (drawn.has(o)) this.moveObject(o);
        for (const o of objects) if (!drawn.has(o)) this.addObject(o);
    }

    /** Draws object `o` where it now is (moved, turned or sized), its model and its ground patch, without rebuilding the
     *  others: a drag calls it on every pointer move. Rebuilds them all when `o` isn't drawn yet. */
    moveObject(o) {
        const group = this.objectGroup;
        const inst = group?.children.find(c => c.userData.object === o && !c.userData.decal);
        if (!inst) {
            this.updateObjects();
            return;
        }
        this.place(inst, o);
        const old = group.children.find(c => c.userData.object === o && c.userData.decal);
        if (old) {
            group.remove(old);
            disposeDecal(old);
        }
        this.addDecal(group, o, inst.userData.flat);
        if (o === this.selected) this.showSelection(inst);
        this.updateObjectShadows();
    }

    /** An imported thing's patch of ground, draped on the ground where it
     *  stands (turned and scaled with it), as the export paints it. */
    addDecal(group, o, flat) {
        const d = flat?.decal;
        if (!d) return;
        const name = o.model.slice('@import:'.length).split(':')[0];
        const [x0, y0, x1, y1] = d.rect,
            n = 8,
            c = Math.cos(o.bearing),
            s = Math.sin(o.bearing),
            area = this.area;
        const pos = [],
            uv = [],
            index = [];
        for (let j = 0; j <= n; j++) {
            for (let i = 0; i <= n; i++) {
                const u = x0 + ((x1 - x0) * i) / n,
                    v = y0 + ((y1 - y0) * j) / n;
                const x = o.x + (c * u - s * v) * o.scale,
                    y = o.y + (s * u + c * v) * o.scale;
                pos.push(
                    x,
                    area.heightAt(Math.min(area.sizeX, Math.max(0, x)), Math.min(area.sizeY, Math.max(0, y))) + 0.04,
                    area.sizeY - y,
                );
                uv.push(i / n, j / n);
            }
        }
        for (let j = 0; j < n; j++)
            for (let i = 0; i < n; i++) {
                const a = j * (n + 1) + i;
                index.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
            }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(index);
        geo.computeVertexNormals();
        const map = this.models.picture(`/api/import-file/${encodeURIComponent(name)}/${encodeURIComponent(d.file)}`);
        const mesh = new THREE.Mesh(
            geo,
            new THREE.MeshLambertMaterial({
                map,
                transparent: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                polygonOffsetUnits: -2,
                side: THREE.DoubleSide,
            }),
        );
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
        try {
            model = await this.models.group(o.model);
        } catch {
            return;
        }
        if (group !== this.objectGroup || !this.area.objects.includes(o)) return;
        const inst = model.clone();
        this.place(inst, o);
        inst.userData.object = o;
        group.add(inst);
        this.applyCut(inst);
        this.addDecal(group, o, model.userData.flat);
        this.updateObjectShadows();
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
            for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
                mat.clippingPlanes = planes;
                mat.needsUpdate = true;
            }
        });
    }

    /** Takes objects (a Set) out of the view. */
    removeObjects(gone) {
        if (!this.objectGroup) return;
        for (const c of [...this.objectGroup.children])
            if (gone.has(c.userData.object)) {
                this.objectGroup.remove(c);
                if (c.userData.decal) disposeDecal(c);
            }
        this.updateObjectShadows();
    }

    /**
     * The things placed in the area (creatures, waypoints, triggers, sounds...) and, greyed, the imported area's
     * own objects (`ghosts`): each kind has its own colour and shape, standing on the ground with an arrow for the
     * way it faces; a trigger's or encounter's outline is a filled, draped polygon with a ribbon round it and a post
     * at each corner. The one selected (`selectedId`/`selectedKey`) is white. `draft` is an outline being drawn. `inert`:
     * to look at only, nothing can be picked.
     */
    setThings(things, selectedId = null, draft = null, ghosts = [], selectedKey = null, inert = false) {
        // An outline's fill and ribbon are kept while its shape, colour, selection and the ground stay the same: a drag
        // makes only the dragged one again (500 triggers took 72 ms a frame).
        const free = c => {
            // (the markers' shapes are kept for the next time; a batch frees its copies' places and colours)
            if (!c.userData.sharedGeometry) c.geometry?.dispose();
            if (c.isInstancedMesh) c.dispose();
            c.material?.dispose?.();
        };
        const before = this.thingOutlines ?? new Map(),
            keep = new Set([...before.values()].flat());
        this.thingOutlines = new Map();
        if (this.thingGroup) {
            this.scene.remove(this.thingGroup);
            this.thingGroup.traverse(c => {
                if (!keep.has(c)) free(c);
            });
        }
        const group = new THREE.Group();
        this.thingGroup = group;
        this.scene.add(group);
        if (!this.area) {
            for (const m of keep) free(m);
            return;
        }
        const area = this.area,
            size = area.sizeY;
        const at = (x, y, lift = 0) => new THREE.Vector3(x, area.heightAt(x, y) + lift, size - y);
        const GREY = new THREE.Color(0x8a929b);
        // The colour a thing is drawn in: its kind's, or white when selected; an original's is the kind's washed toward grey.
        const tone = (kind, sel, ghost) => {
            if (sel) return new THREE.Color(0xffffff);
            const c = new THREE.Color(THING_COLOURS[kind] ?? 0xffffff);
            return ghost ? c.lerp(GREY, 0.2) : c;
        };
        // (Out of the Things tool the markers are only to look at: nothing to pick.)
        this.thingsInert = inert;
        const tag = (m, id) => {
            m.userData.thing = id;
            return m;
        };

        /** A ribbon of `width` metres along the outline, draped on the ground (thin GL lines vanish at a distance). */
        const ribbon = (pts, width, c, closed = true, ghost = false) => {
            const n = pts.length,
                samples = [];
            for (let i = 0; i < (closed ? n : n - 1); i++) {
                const [ax, ay] = pts[i],
                    [bx, by] = pts[(i + 1) % n];
                const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
                for (let j = 0; j < k; j++) samples.push([ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k]);
            }
            if (!closed) samples.push(pts[n - 1]);
            const m = samples.length,
                pos = [],
                idx = [];
            for (let i = 0; i < m; i++) {
                const prev = samples[(i - 1 + m) % m],
                    next = samples[(i + 1) % m];
                const lo = closed || i > 0 ? prev : samples[i],
                    hi = closed || i < m - 1 ? next : samples[i];
                let tx = hi[0] - lo[0],
                    ty = hi[1] - lo[1];
                const len = Math.hypot(tx, ty) || 1;
                tx /= len;
                ty /= len;
                const [x, y] = samples[i],
                    nx = (-ty * width) / 2,
                    ny = (tx * width) / 2;
                for (const sgn of [1, -1]) {
                    const v = at(x + nx * sgn, y + ny * sgn, 0.2);
                    pos.push(v.x, v.y, v.z);
                }
                if (i < m - 1 || closed) {
                    const a = i * 2,
                        b = ((i + 1) % m) * 2;
                    idx.push(a, a + 1, b, a + 1, b + 1, b);
                }
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setIndex(idx);
            const mesh = new THREE.Mesh(
                g,
                new THREE.MeshBasicMaterial({
                    color: c,
                    side: THREE.DoubleSide,
                    depthTest: false,
                    transparent: ghost,
                    opacity: ghost ? 0.9 : 1,
                }),
            );
            mesh.renderOrder = 5;
            return mesh;
        };

        /** The polygon filled, draped: triangulated, then cut small enough to follow the ground. */
        const fill = (pts, c, opacity) => {
            const tris = THREE.ShapeUtils.triangulateShape(
                pts.map(([x, y]) => new THREE.Vector2(x, y)),
                [],
            );
            const pos = [];
            const put = p => {
                const v = at(p[0], p[1], 0.12);
                pos.push(v.x, v.y, v.z);
            };
            const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
            const cut = (a, b, d, depth) => {
                if (
                    depth >= 5 ||
                    Math.max(
                        Math.hypot(a[0] - b[0], a[1] - b[1]),
                        Math.hypot(b[0] - d[0], b[1] - d[1]),
                        Math.hypot(d[0] - a[0], d[1] - a[1]),
                    ) <= 2
                ) {
                    put(a);
                    put(b);
                    put(d);
                    return;
                }
                const ab = mid(a, b),
                    bd = mid(b, d),
                    da = mid(d, a);
                cut(a, ab, da, depth + 1);
                cut(ab, b, bd, depth + 1);
                cut(da, bd, d, depth + 1);
                cut(ab, bd, da, depth + 1);
            };
            for (const [i, j, k] of tris) cut(pts[i], pts[j], pts[k], 0);
            if (!pos.length) return null;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            const mesh = new THREE.Mesh(
                g,
                new THREE.MeshBasicMaterial({
                    color: c,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity,
                    depthWrite: false,
                    polygonOffset: true,
                    polygonOffsetFactor: -2,
                }),
            );
            mesh.renderOrder = 4;
            return mesh;
        };

        // Markers, corner posts and facing lines go in batches: one draw for each shape, solid or see-through (the originals),
        // each copy with its own place and colour. As a mesh and a material for every part, 500 things were 1,800 objects
        // and 1,900 draws, all made again on every frame of a drag (54 ms).
        const batches = new Map(),
            lines = [
                { pos: [], col: [] },
                { pos: [], col: [] },
            ];
        const batch = (geo, ghost, matrix, c, id = null) => {
            const key = `${geo.uuid}:${ghost}`;
            if (!batches.has(key)) batches.set(key, { geo, ghost, items: [] });
            batches.get(key).items.push({ matrix, c, id });
        };
        const shape = make => {
            this.thingShapes ??= new Map();
            if (!this.thingShapes.has(make)) this.thingShapes.set(make, make(MARKER_SIZE));
            return this.thingShapes.get(make);
        };

        /** A marker of the kind's own shape standing at `p`; every part picks as `id`. */
        const marker = (kind, p, c, sel, ghost, id) => {
            const grow = sel ? 1.25 : 1,
                k = grow * MARKER_SIZE;
            for (const part of MARKER_PARTS[kind] ?? OTHER_MARKER) {
                const matrix = new THREE.Matrix4().compose(
                    new THREE.Vector3(p.x, p.y + (part.fixed ? part.y : part.y * k), p.z),
                    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rot ?? [0, 0, 0]))),
                    new THREE.Vector3(grow, grow, grow),
                );
                batch(shape(part.geo), ghost, matrix, c, id);
            }
        };

        /** The way a creature, door, placeable or waypoint faces: a line from the marker (bearing 0 faces east, as the game's). */
        const facing = (p, bearing, c, ghost) => {
            const dir = new THREE.Vector3(Math.cos(bearing ?? 0), 0, -Math.sin(bearing ?? 0));
            const a = p.clone().add(new THREE.Vector3(0, 0.3, 0)),
                b = a.clone().addScaledVector(dir, 1.6);
            const l = lines[ghost ? 1 : 0];
            l.pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
            l.col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        };

        /** The whole of one thing, the editor's or an original's. */
        const draw = (t, id, sel, ghost) => {
            const c = tone(t.kind, sel, ghost);
            const hasOutline = t.outline?.length >= 3;
            const p = hasOutline ? at(t.outline[0][0], t.outline[0][1]) : at(t.x, t.y);
            marker(t.kind, p, c, sel, ghost, id);
            if (hasOutline) {
                const key = `${this.groundVersion}|${id}|${sel}|${ghost}|${c.getHexString()}|${t.outline.join(';')}`;
                let meshes = before.get(key);
                if (meshes) before.delete(key);
                else
                    meshes = [
                        fill(t.outline, c, sel ? 0.42 : ghost ? 0.26 : 0.34),
                        tag(ribbon(t.outline, sel ? 0.6 : 0.42, c, true, ghost), id),
                    ].filter(Boolean);
                this.thingOutlines.set(key, meshes);
                group.add(...meshes);
                // A post at every corner, so the shape reads from far away; the selected one's are the handles.
                let corner = 0;
                for (const [x, y] of t.outline) {
                    if (sel) {
                        // A big invisible ball over the post: what a press on a corner grabs.
                        const grab = new THREE.Mesh(
                            new THREE.SphereGeometry(0.9, 8, 6),
                            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
                        );
                        const gq = at(x, y, 0.5);
                        grab.position.copy(gq);
                        grab.userData.corner = { id, index: corner };
                        group.add(grab);
                    }
                    corner++;
                    const q = at(x, y);
                    const matrix = new THREE.Matrix4().makeScale(sel ? 1.8 : 1, sel ? 1.5 : 1, sel ? 1.8 : 1);
                    matrix.setPosition(q.x, q.y + (sel ? 0.6 : 0.4), q.z);
                    batch(shape(POST), ghost, matrix, c);
                }
            } else if (['creature', 'door', 'placeable', 'waypoint', 'store'].includes(t.kind)) {
                facing(p, t.bearing, c, ghost);
            }
        };
        for (const g of ghosts) draw(g, g.key, g.key === selectedKey, true);
        for (const t of things) draw(t, t.id, t.id === selectedId, false);
        // (the outlines that changed or went: their old meshes)
        for (const meshes of before.values()) for (const m of meshes) free(m);
        for (const { geo, ghost, items } of batches.values()) {
            const mesh = new THREE.InstancedMesh(
                geo,
                new THREE.MeshBasicMaterial({ transparent: ghost, opacity: ghost ? 0.8 : 1 }),
                items.length,
            );
            items.forEach(({ matrix, c }, k) => {
                mesh.setMatrixAt(k, matrix);
                mesh.setColorAt(k, c);
            });
            mesh.computeBoundingSphere();
            // (what each copy picks as; the posts pick as nothing)
            if (items.some(it => it.id != null)) mesh.userData.things = items.map(it => it.id);
            mesh.userData.sharedGeometry = true;
            group.add(mesh);
        }
        lines.forEach(({ pos, col }, ghost) => {
            if (!pos.length) return;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
            const l = new THREE.LineSegments(
                g,
                new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: !!ghost, opacity: ghost ? 0.6 : 1 }),
            );
            l.renderOrder = 5;
            group.add(l);
        });
        if (draft?.length) {
            const white = new THREE.Color(0xffffff);
            if (draft.length >= 3) {
                const f = fill(draft, white, 0.2);
                if (f) group.add(f);
            }
            if (draft.length >= 2) group.add(ribbon(draft, 0.35, white, false));
            for (const [x, y] of draft) {
                const c = new THREE.Mesh(
                    new THREE.SphereGeometry(0.35, 8, 6),
                    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
                );
                c.position.copy(at(x, y, 0.3));
                c.renderOrder = 6;
                group.add(c);
            }
        }
    }

    /** Points the raycaster from the camera through the pointer at `clientX`, `clientY` (page pixels, as a pointer event gives
     *  them). */
    aim(clientX, clientY) {
        const r = this.renderer.domElement.getBoundingClientRect();
        this.raycaster.setFromCamera(
            new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1),
            this.camera,
        );
    }

    /** The id of the thing whose marker is under the pointer, or null. Markers out of the Things tool are to look at, so
     *  they are only found with `any` (the right-click menu). */
    pickThing(clientX, clientY, any = false) {
        if (!this.thingGroup || (this.thingsInert && !any)) return null;
        this.aim(clientX, clientY);
        this.raycaster.params.Line.threshold = 0.6;
        // (a marker in a batch picks as its copy's thing)
        const thing = h => h.object.userData.thing ?? h.object.userData.things?.[h.instanceId] ?? null;
        const hit = this.raycaster.intersectObject(this.thingGroup, true).find(h => thing(h) != null);
        this.raycaster.params.Line.threshold = 1;
        return hit ? thing(hit) : null;
    }

    /** The corner of the selected outline under the pointer: { id, index }, or null. */
    pickCorner(clientX, clientY) {
        if (!this.thingGroup) return null;
        this.aim(clientX, clientY);
        const hit = this.raycaster.intersectObject(this.thingGroup, true).find(h => h.object.userData.corner);
        return hit?.object.userData.corner ?? null;
    }

    /** The placed object under the pointer, or null. */
    pickObject(clientX, clientY) {
        if (!this.objectGroup) return null;
        this.aim(clientX, clientY);
        const hit = this.raycaster.intersectObject(this.objectGroup, true)[0];
        let n = hit?.object;
        while (n && !n.userData.object) n = n.parent;
        return n?.userData.object ?? null;
    }

    /** Marks object `o` (or none) as selected: a box round it. */
    select(o) {
        this.selected = o;
        if (this.selectionBox) this.selectionBox.visible = false;
        const inst = this.objectGroup?.children.find(c => c.userData.object === o && !c.userData.decal);
        if (inst) this.showSelection(inst);
    }

    /** The selection box round `inst`: one box, fitted again on each move of a drag (a new one each move kept its material). */
    showSelection(inst) {
        if (!this.selectionBox) {
            this.selectionBox = new THREE.BoxHelper(inst);
            this.scene.add(this.selectionBox);
        }
        const box = this.selectionBox;
        box.setFromObject(inst);
        // Gold for scenery, blue for a real placeable.
        box.material.color.set(inst.userData.object?.baked === false ? 0x5aa0ff : 0xd8a24a);
        box.visible = true;
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
        const strips = [ny, ny, nx, nx],
            first = [0, ny, 2 * ny, 2 * ny + nx],
            corners = 2 * (2 * ny + 2 * nx);
        const verts = corners + 4 * 4;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 3).fill(0.72), 3));
        geo.setAttribute('aDeep', new THREE.BufferAttribute(new Float32Array(verts), 1));
        // (no cave void out there: without it the shader read 0, under VOID_BELOW, and drew the edge scenery black)
        geo.setAttribute('aGap', new THREE.BufferAttribute(new Float32Array(verts).fill(1e9), 1));
        const index = [];
        for (let s = 0; s < 4; s++) {
            for (let k = 0; k < strips[s] - 1; k++) {
                const a = (first[s] + k) * 2,
                    b = a + 2;
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
        const area = this.area,
            { nx, ny, sizeX: sx, sizeY: sy } = area,
            h = this.drawn ?? area.heights,
            deep = this.chasmFit?.deep,
            D = 50;
        const pos = this.skirt.geometry.attributes.position,
            dark = this.skirt.geometry.attributes.aDeep;
        // Area point (x, y) at the height of sample k, as three.js wants it; a chasm on the boundary carries on out, dark as it.
        const put = (v, x, y, k) => {
            pos.setXYZ(v, x, h[k], sy - y);
            dark.setX(v, deep ? deep[k] : 0);
        };
        for (let k = 0; k < ny; k++) {
            const t = k * SPACING;
            put(k * 2, -D, t, k * nx);
            put(k * 2 + 1, 0, t, k * nx);
            put((ny + k) * 2, sx, t, k * nx + nx - 1);
            put((ny + k) * 2 + 1, sx + D, t, k * nx + nx - 1);
        }
        for (let k = 0; k < nx; k++) {
            const t = k * SPACING;
            put((2 * ny + k) * 2, t, -D, k);
            put((2 * ny + k) * 2 + 1, t, 0, k);
            put((2 * ny + nx + k) * 2, t, sy, (ny - 1) * nx + k);
            put((2 * ny + nx + k) * 2 + 1, t, sy + D, (ny - 1) * nx + k);
        }
        const first = 2 * (2 * ny + 2 * nx);
        const corners = [
            [0, 0, -D, -D],
            [0, sy, -D, sy + D],
            [sx, 0, sx + D, -D],
            [sx, sy, sx + D, sy + D],
        ];
        // (each corner flat at its corner sample's height)
        const cornerSample = [0, (ny - 1) * nx, nx - 1, ny * nx - 1];
        corners.forEach(([x, y, fx, fy], c) => {
            const k = cornerSample[c],
                a = first + c * 4;
            put(a, x, y, k);
            put(a + 1, fx, y, k);
            put(a + 2, fx, fy, k);
            put(a + 3, x, fy, k);
        });
        pos.needsUpdate = true;
        dark.needsUpdate = true;
        this.skirt.geometry.computeVertexNormals();
        this.skirt.geometry.computeBoundingSphere();
    }

    /** The water's surface: a flat quad at the level over each cell with a
     *  corner under water, as landscaper builds it (the ground hides it
     *  beyond the shore). */
    updateWater() {
        const area = this.area,
            n = area.nx,
            rows = area.ny,
            size = area.sizeY,
            sx = area.sizeX,
            L = area.waterLevel;
        if (this.water) {
            this.scene.remove(this.water);
            this.water.geometry.dispose();
            this.water.material.dispose();
        }
        this.water = null;
        const pos = [];
        // The higher of two levels, a dry one (NaN) counting as none.
        const top = (a, b) => (Number.isNaN(b) || b < a ? a : b);
        for (let j = 0; j < rows - 1; j++) {
            for (let i = 0; i < n - 1; i++) {
                // The wet corners' highest level. (Without a list of the four for each cell: it was most of a water drag's
                // redraw.)
                const k = j * n + i,
                    level = top(top(top(top(-Infinity, L[k]), L[k + 1]), L[k + n]), L[k + n + 1]);
                if (level === -Infinity) continue;
                const x0 = i * SPACING,
                    x1 = x0 + SPACING,
                    z0 = size - j * SPACING,
                    z1 = size - (j + 1) * SPACING;
                pos.push(x0, level, z0, x1, level, z0, x1, level, z1, x0, level, z0, x1, level, z1, x0, level, z1);
            }
        }
        // Carried out past the edge, as the edge scenery has it.
        const D = 50;
        const quad = (x0, y0, x1, y1, l) =>
            pos.push(x0, l, size - y0, x1, l, size - y0, x1, l, size - y1, x0, l, size - y0, x1, l, size - y1, x0, l, size - y1);
        const wet = (i, j) => L[j * n + i];
        const lv = (a, b) => Math.max(Number.isNaN(a) ? -Infinity : a, Number.isNaN(b) ? -Infinity : b);
        // A strip at the level l, when either of the two edge samples is wet.
        const strip = (l, x0, y0, x1, y1) => {
            if (l > -Infinity) quad(x0, y0, x1, y1, l);
        };
        for (let k = 0; k < rows - 1; k++) {
            const t0 = k * SPACING,
                t1 = t0 + SPACING;
            strip(lv(wet(0, k), wet(0, k + 1)), -D, t0, 0, t1);
            strip(lv(wet(n - 1, k), wet(n - 1, k + 1)), sx, t0, sx + D, t1);
        }
        for (let k = 0; k < n - 1; k++) {
            const t0 = k * SPACING,
                t1 = t0 + SPACING;
            strip(lv(wet(k, 0), wet(k + 1, 0)), t0, -D, t1, 0);
            strip(lv(wet(k, rows - 1), wet(k + 1, rows - 1)), t0, size, t1, size + D);
        }
        for (const [i, j, x0, y0, x1, y1] of [
            [0, 0, -D, -D, 0, 0],
            [0, rows - 1, -D, size, 0, size + D],
            [n - 1, 0, sx, -D, sx + D, 0],
            [n - 1, rows - 1, sx, size, sx + D, size + D],
        ]) {
            if (!Number.isNaN(wet(i, j))) quad(x0, y0, x1, y1, wet(i, j));
        }
        if (!pos.length) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.computeVertexNormals();
        this.water = new THREE.Mesh(
            geo,
            new THREE.MeshPhongMaterial({
                color: 0x2c6a86,
                specular: 0x557788,
                shininess: 60,
                transparent: true,
                opacity: 0.62,
                depthWrite: false,
                side: THREE.DoubleSide,
            }),
        );
        this.water.renderOrder = 1;
        this.scene.add(this.water);
    }

    setShowWalkability(on) {
        this.showWalkability = on;
        this.markDirty(this.everything(), false);
    }

    /** The tile grid, draped 5 cm above the ground: the lines along the tile edges, one segment between each two samples,
     *  moved where samples `r` (i0..i1, j0..j1; the whole area when not given) changed. */
    updateGrid(r = this.everything()) {
        const area = this.area,
            { nx, ny } = area,
            size = area.sizeY,
            h = area.heights,
            per = Math.round(TILE / SPACING); // samples along a tile
        // Segments: lines of constant x (running north, ny - 1 each), then of constant y (running east, nx - 1 each).
        const north = (area.tiles + 1) * (ny - 1),
            segments = north + (area.tilesY + 1) * (nx - 1);
        let attr = this.grid.geometry.attributes.position;
        if (attr?.count !== segments * 2) {
            this.grid.geometry.dispose();
            this.grid.geometry = new THREE.BufferGeometry();
            attr = new THREE.BufferAttribute(new Float32Array(segments * 6), 3);
            this.grid.geometry.setAttribute('position', attr);
            r = this.everything();
        }
        const a = attr.array;
        const put = (seg, x0, y0, z0, x1, y1, z1) => a.set([x0, z0 + 0.05, size - y0, x1, z1 + 0.05, size - y1], seg * 6);
        for (let t = Math.ceil(r.i0 / per); t * per <= r.i1 && t <= area.tiles; t++) {
            const i = t * per,
                along = t * TILE;
            for (let k = Math.max(0, r.j0 - 1); k <= Math.min(ny - 2, r.j1); k++)
                put(t * (ny - 1) + k, along, k * SPACING, h[k * nx + i], along, (k + 1) * SPACING, h[(k + 1) * nx + i]);
        }
        for (let t = Math.ceil(r.j0 / per); t * per <= r.j1 && t <= area.tilesY; t++) {
            const j = t * per,
                along = t * TILE;
            for (let k = Math.max(0, r.i0 - 1); k <= Math.min(nx - 2, r.i1); k++)
                put(north + t * (nx - 1) + k, k * SPACING, along, h[j * nx + k], (k + 1) * SPACING, along, h[j * nx + k + 1]);
        }
        attr.needsUpdate = true;
    }

    /** Area point (NWN metres) under the mouse, or null. The answer is kept while the pointer, the camera and the ground stay
     *  as they are: the view asks every frame, and a drag asks again on each pointer move. */
    pick(clientX, clientY) {
        this.aim(clientX, clientY);
        const { origin, direction } = this.raycaster.ray,
            last = this.lastPick;
        if (!last || last.ground !== this.groundVersion || !last.origin.equals(origin) || !last.direction.equals(direction)) {
            const hit = this.groundHit(origin, direction);
            this.lastPick = {
                ground: this.groundVersion,
                origin: origin.clone(),
                direction: direction.clone(),
                point: hit && { x: hit.x, y: this.area.sizeY - hit.z, z: hit.y },
            };
        }
        const p = this.lastPick.point;
        return p && { ...p };
    }

    /** Where the pointer at (clientX, clientY) meets the level `z` metres up (area metres, `z` that height), or null when it
     *  points away from it. The Chasm tool's brush follows the rim's level this way: on the ground it would drop into the chasm
     *  it opens, and away from where the pointer is. */
    pickLevel(clientX, clientY, z) {
        this.aim(clientX, clientY);
        const { origin, direction } = this.raycaster.ray;
        if (Math.abs(direction.y) < 1e-6) return null;
        const t = (z - origin.y) / direction.y;
        if (t <= 0) return null;
        return { x: origin.x + direction.x * t, y: this.area.sizeY - (origin.z + direction.z * t), z };
    }

    /** Where the ray from `o` along `d` first meets the ground as drawn, in three.js's frame (or null). It walks the cells the
     *  ray crosses in order (a 2D DDA over the sample grid) and tests each cell's two triangles, as PlaneGeometry splits it:
     *  three.js's raycast tests every triangle (524,288 on a 32×32 area, 41 ms a pick), this about as many cells as the ray
     *  crosses. */
    groundHit(o, d) {
        const { nx, ny, sizeX, sizeY } = this.area,
            y = this.mesh.geometry.attributes.position.array,
            box = this.mesh.geometry.boundingBox;
        // The part of the ray over the area, between the ground's lowest and highest point.
        let t0 = 0,
            t1 = Infinity;
        for (const [oa, da, lo, hi] of [
            [o.x, d.x, 0, sizeX],
            [o.y, d.y, box.min.y - 1e-3, box.max.y + 1e-3],
            [o.z, d.z, 0, sizeY],
        ]) {
            if (Math.abs(da) < 1e-12) {
                if (oa < lo || oa > hi) return null;
                continue;
            }
            const a = (lo - oa) / da,
                b = (hi - oa) / da;
            t0 = Math.max(t0, Math.min(a, b));
            t1 = Math.min(t1, Math.max(a, b));
        }
        if (t0 > t1) return null;
        // Cell (cx, cz) spans x from cx and z from cz spacings; its corner vertices are rows of nx, z = row × SPACING.
        const ex = o.x + d.x * t0,
            ez = o.z + d.z * t0;
        let cx = Math.min(nx - 2, Math.max(0, Math.floor(ex / SPACING))),
            cz = Math.min(ny - 2, Math.max(0, Math.floor(ez / SPACING)));
        const sx = Math.sign(d.x),
            sz = Math.sign(d.z),
            stepX = sx ? SPACING / Math.abs(d.x) : Infinity,
            stepZ = sz ? SPACING / Math.abs(d.z) : Infinity;
        let nextX = sx ? ((cx + (sx > 0 ? 1 : 0)) * SPACING - o.x) / d.x : Infinity,
            nextZ = sz ? ((cz + (sz > 0 ? 1 : 0)) * SPACING - o.z) / d.z : Infinity;
        const corner = (i, k) => {
            const v = (k * nx + i) * 3;
            return [y[v], y[v + 1], y[v + 2]];
        };
        for (;;) {
            const a = corner(cx, cz),
                b = corner(cx, cz + 1),
                c = corner(cx + 1, cz + 1),
                e = corner(cx + 1, cz);
            const t = Math.min(rayTriangle(o, d, a, b, e), rayTriangle(o, d, b, c, e));
            if (t < Infinity) return new THREE.Vector3().copy(o).addScaledVector(d, t);
            const across = nextX < nextZ;
            if ((across ? nextX : nextZ) > t1) return null;
            if (across) {
                cx += sx;
                nextX += stepX;
            } else {
                cz += sz;
                nextZ += stepZ;
            }
            if (cx < 0 || cz < 0 || cx > nx - 2 || cz > ny - 2) return null;
        }
    }

    /** The room being dragged out: its outline on the floor (or none). */
    setRoomOutline(r, z) {
        if (this.roomLine) {
            this.scene.remove(this.roomLine);
            this.roomLine.geometry.dispose();
            this.roomLine.material.dispose();
            this.roomLine = null;
        }
        if (!r) return;
        const s = this.area.sizeY,
            y = z + 0.1;
        const pts = [
            [r.x0, r.y0],
            [r.x1, r.y0],
            [r.x1, r.y1],
            [r.x0, r.y1],
            [r.x0, r.y0],
        ].map(([x, yy]) => new THREE.Vector3(x, y, s - yy));
        this.roomLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: 0xd8a24a, depthTest: false }),
        );
        this.roomLine.renderOrder = 2;
        this.scene.add(this.roomLine);
    }

    /** The descent being dragged: its box, each hall at its floor, and each ramp's line (null hides it; an error shows the box alone). */
    setDescentPreview(plan) {
        if (this.descentLine) {
            this.scene.remove(this.descentLine);
            this.descentLine.geometry.dispose();
            this.descentLine.material.dispose();
            this.descentLine = null;
        }
        if (!plan) return;
        const s = this.area.sizeY,
            pts = [];
        const rect = (r, z) => {
            const c = [
                [r.x0, r.y0],
                [r.x1, r.y0],
                [r.x1, r.y1],
                [r.x0, r.y1],
            ];
            for (let i = 0; i < 4; i++) for (const [x, y] of [c[i], c[(i + 1) % 4]]) pts.push(new THREE.Vector3(x, z + 0.1, s - y));
        };
        const top = plan.halls[0]?.floor ?? this.area.roof - 6;
        rect(plan.box, top);
        for (const h of plan.halls) rect(h.rect, h.floor);
        for (const r of plan.ramps)
            pts.push(new THREE.Vector3(r.a.x, top + 0.2, s - r.a.y), new THREE.Vector3(r.b.x, top + 0.2, s - r.b.y));
        this.descentLine = new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: plan.error ? 0xe08a3a : 0xd8a24a, depthTest: false }),
        );
        this.descentLine.renderOrder = 2;
        this.scene.add(this.descentLine);
    }

    /** The ramp being dragged: its outline at the heights it will have, and its centre line (null hides it). */
    setRampPreview(plan, width) {
        if (this.rampLine) {
            this.scene.remove(this.rampLine);
            this.rampLine.geometry.dispose();
            this.rampLine.material.dispose();
            this.rampLine = null;
        }
        if (!plan || plan.len < 0.1) return;
        const s = this.area.sizeY,
            half = width / 2,
            nx = -(plan.b.y - plan.a.y) / plan.len,
            ny = (plan.b.x - plan.a.x) / plan.len;
        const v = (x, y, z) => new THREE.Vector3(x, z + 0.15, s - y);
        const A = k => v(plan.a.x + nx * half * k, plan.a.y + ny * half * k, plan.hA),
            B = k => v(plan.b.x + nx * half * k, plan.b.y + ny * half * k, plan.hB);
        const pts = [A(1), B(1), B(0), B(-1), A(-1), A(0), A(1)];
        this.rampLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: plan.eased ? 0xe08a3a : 0xd8a24a, depthTest: false }),
        );
        this.rampLine.renderOrder = 2;
        this.scene.add(this.rampLine);
    }

    /** Brush ring at area point p (or hide it). */
    setCursor(p, radius) {
        if (!p) {
            this.cursor.visible = false;
            return;
        }
        const pts = [];
        for (let k = 0; k <= 64; k++) {
            const a = (k / 64) * Math.PI * 2;
            const x = p.x + Math.cos(a) * radius,
                y = p.y + Math.sin(a) * radius;
            pts.push(new THREE.Vector3(x, this.area.heightAt(x, y) + 0.15, this.area.sizeY - y));
        }
        this.cursor.geometry.setFromPoints(pts);
        this.cursor.visible = true;
    }

    /** Pillars at export warnings: red where a route stops (it breaks
     *  routes); orange to look at: a passage closed, a tile too winding. */
    setMarkers(warnings) {
        if (this.markers) {
            this.scene.remove(this.markers);
            this.markers.traverse(c => {
                c.geometry?.dispose();
                c.material?.map?.dispose();
                c.material?.dispose?.();
            });
        }
        this.markers = new THREE.Group();
        for (const w of warnings) {
            const failed = w.kind === 'failed_route',
                closed = w.kind === 'closed_passage';
            const at = failed ? w.stops_at : closed ? w.at : [(w.from[0] + w.to[0]) / 2, (w.from[1] + w.to[1]) / 2];
            const color = failed ? 0xe0402a : 0xff9a1f;
            const ground = this.area.heightAt(at[0], at[1]);
            const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 5, 12), new THREE.MeshBasicMaterial({ color }));
            pillar.position.set(at[0], ground + 2.5, this.area.sizeY - at[1]);
            this.markers.add(pillar);
            const label = makeLabel(
                failed ? 'Route stops here' : closed ? 'Passage closed' : `Tile ${w.tile[0]},${w.tile[1]}: too winding`,
                color,
            );
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
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.fillText(text, 12, 44);
    // A fixed size on screen, however near the camera is.
    const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, sizeAttenuation: false }),
    );
    sprite.scale.set((0.024 * canvas.width) / canvas.height, 0.024, 1);
    return sprite;
}

/** The distance along the ray from `o` along `d` to triangle (a, b, c), seen from either side (the ground's material is
 *  double-sided), or Infinity when it misses: Möller and Trumbore's test, as three.js's Ray.intersectTriangle. */
function rayTriangle(o, d, a, b, c) {
    const e1x = b[0] - a[0],
        e1y = b[1] - a[1],
        e1z = b[2] - a[2],
        e2x = c[0] - a[0],
        e2y = c[1] - a[1],
        e2z = c[2] - a[2];
    const px = d.y * e2z - d.z * e2y,
        py = d.z * e2x - d.x * e2z,
        pz = d.x * e2y - d.y * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return Infinity;
    const tx = o.x - a[0],
        ty = o.y - a[1],
        tz = o.z - a[2];
    const u = (tx * px + ty * py + tz * pz) / det;
    if (u < 0 || u > 1) return Infinity;
    const qx = ty * e1z - tz * e1y,
        qy = tz * e1x - tx * e1z,
        qz = tx * e1y - ty * e1x;
    const v = (d.x * qx + d.y * qy + d.z * qz) / det;
    if (v < 0 || u + v > 1) return Infinity;
    const t = (e2x * qx + e2y * qy + e2z * qz) / det;
    return t >= 0 ? t : Infinity;
}

/** Frees a ground patch made by addDecal: its geometry and material are its own (its picture is the model library's, shared). */
function disposeDecal(mesh) {
    mesh.geometry.dispose();
    mesh.material.dispose();
}
